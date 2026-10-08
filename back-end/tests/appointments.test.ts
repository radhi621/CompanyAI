import { DateTime } from "luxon";
import { beforeAll, describe, expect, it } from "vitest";
import { AppointmentModel } from "../src/models/Appointment";
import { doctorsService } from "../src/modules/doctors/doctors.service";
import { API, type TestSession, api, auth, createDoctor, createPatient, createSession } from "./helpers";

const TZ = "Africa/Casablanca";
const tomorrow = DateTime.now().setZone(TZ).plus({ days: 1 }).startOf("day");
const at = (hour: number, minute = 0) => tomorrow.set({ hour, minute }).toUTC().toISO()!;

let admin: TestSession;
let secretary: TestSession;
let doctorId: string;
let patientId: string;

beforeAll(async () => {
  admin = await createSession("admin");
  secretary = await createSession("secretary");
  const doctor = await createDoctor(admin.id);
  doctorId = doctor._id.toString();
  patientId = (await createPatient({ createdBy: admin.id, assignedStaff: [secretary.id] }))._id.toString();

  await doctorsService.upsertSchedule({
    actor: admin.actor,
    doctorId,
    timezone: TZ,
    weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "08:00", endTime: "18:00" })),
    unavailableBlocks: [{ startAt: new Date(at(14)), endAt: new Date(at(15)), reason: "meeting" }],
  });
});

const book = (session: TestSession, startAt: string, extra: Record<string, unknown> = {}) =>
  api()
    .post(`${API}/appointments`)
    .set(auth(session))
    .send({ patientId, doctorId, startAt, estimatedDurationMinutes: 30, reason: "Checkup", ...extra });

describe("booking rules", () => {
  it("rejects bookings in the past", async () => {
    const res = await book(secretary, DateTime.now().minus({ days: 1 }).toISO()!);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/past/i);
  });

  it("rejects bookings outside working hours or during unavailable blocks", async () => {
    expect((await book(secretary, at(7))).status).toBe(400);
    expect((await book(secretary, at(17, 45))).status).toBe(400); // would end after 18:00
    const blocked = await book(secretary, at(14, 30));
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/unavailable/i);
  });

  it("accepts a valid slot and rejects an overlapping one", async () => {
    expect((await book(secretary, at(9))).status).toBe(201);
    expect((await book(secretary, at(9, 15))).status).toBe(409);
  });

  it("does not double-book a patient, even with a different doctor", async () => {
    const otherDoctorId = (await createDoctor(admin.id))._id.toString();
    expect((await book(secretary, at(16))).status).toBe(201);

    const clash = await book(secretary, at(16, 15), { doctorId: otherDoctorId });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/patient/i);
  });

  it("lets only admins book outside working hours", async () => {
    expect((await book(secretary, at(21), { allowOutsideSchedule: true })).status).toBe(403);
    expect((await book(admin, at(21))).status).toBe(400);
    expect((await book(admin, at(21), { allowOutsideSchedule: true })).status).toBe(201);
  });
});

describe("status changes", () => {
  it("cancels despite an overlapping appointment, but blocks reinstating into the overlap", async () => {
    const created = await book(secretary, at(11));
    const id = created.body.data._id;

    // An overlapping record, as could exist from old data.
    await AppointmentModel.create({
      patientId, doctorId, startAt: at(11), endAt: at(11, 30), estimatedDurationMinutes: 30, reason: "legacy",
      status: "planned", source: "manual", createdBy: admin.id, createdByRole: "admin",
    });

    const cancel = await api().patch(`${API}/appointments/${id}`).set(auth(secretary)).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);

    const reinstate = await api().patch(`${API}/appointments/${id}`).set(auth(secretary)).send({ status: "planned" });
    expect(reinstate.status).toBe(409);
  });

  it("allows completing an appointment that is already in the past", async () => {
    const past = await AppointmentModel.create({
      patientId, doctorId,
      startAt: DateTime.now().minus({ days: 2 }).toJSDate(),
      endAt: DateTime.now().minus({ days: 2 }).plus({ minutes: 30 }).toJSDate(),
      estimatedDurationMinutes: 30, reason: "old visit", status: "planned", source: "manual",
      createdBy: secretary.id, createdByRole: "secretary",
    });

    const res = await api().patch(`${API}/appointments/${past._id}`).set(auth(secretary)).send({ status: "completed", notes: "Seen" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("completed");
  });
});

describe("available slots", () => {
  it("never offers a slot that has already started", async () => {
    const today = DateTime.now().setZone(TZ).toISODate();
    const res = await api().get(`${API}/doctors/${doctorId}/slots?date=${today}&days=2`).set(auth(secretary));

    expect(res.status).toBe(200);
    const now = Date.now();
    expect(res.body.data.every((slot: { startAtUtc: string }) => Date.parse(slot.startAtUtc) >= now)).toBe(true);
  });
});
