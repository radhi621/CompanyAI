import { DateTime } from "luxon";
import { beforeAll, describe, expect, it } from "vitest";
import { UserModel } from "../src/models/User";
import { executeToolCall } from "../src/modules/agent/agent.tools";
import { doctorsService } from "../src/modules/doctors/doctors.service";
import { API, PASSWORD, type TestSession, api, auth, createDoctor, createSession } from "./helpers";

let admin: TestSession;

beforeAll(async () => {
  admin = await createSession("admin");
});

const createProfile = (userId: string) =>
  api().post(`${API}/doctors`).set(auth(admin)).send({ fullName: "Dr Linked", specialty: "Cardiology", userId });

describe("doctor profile linking", () => {
  it("links a profile only to an active doctor account, once", async () => {
    const doctor = await createSession("doctor");

    expect((await createProfile(doctor.id)).status).toBe(201);
    expect((await createProfile(doctor.id)).status).toBe(409);
  });

  it("rejects accounts that are not doctors, deactivated, or missing", async () => {
    const nurse = await createSession("nurse");
    const inactive = await UserModel.create({ name: "Old Doc", email: "olddoc@test.io", password: PASSWORD, role: "doctor", isActive: false });

    expect((await createProfile(nurse.id)).status).toBe(400);
    expect((await createProfile(inactive._id.toString())).status).toBe(400);
    expect((await createProfile("0123456789abcdef01234567")).status).toBe(404);
  });

  it("still allows a profile without a linked account", async () => {
    const res = await api().post(`${API}/doctors`).set(auth(admin)).send({ fullName: "Dr Unlinked", specialty: "General" });
    expect(res.status).toBe(201);
  });
});

describe("agent availability timezone", () => {
  it("reads the requested time in the doctor's schedule timezone", async () => {
    const doctorId = (await createDoctor(admin.id))._id.toString();
    await doctorsService.upsertSchedule({
      actor: admin.actor,
      doctorId,
      timezone: "Asia/Tokyo",
      weeklyAvailability: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: "09:00", endTime: "17:00" })),
    });
    const date = DateTime.now().setZone("Asia/Tokyo").plus({ days: 2 }).toISODate()!;

    const result = (await executeToolCall(
      { tool: "check_availability", args: { doctorId, date, time: "10:00", estimatedDurationMinutes: 30 } },
      { actor: admin.actor },
    )) as { isAvailable: boolean; timezone: string; requestedStartAtUtc: string };

    // 10:00 in Tokyo (UTC+9) is 01:00 UTC; read in the clinic timezone it would be 09:00 or 10:00 UTC.
    expect(result.timezone).toBe("Asia/Tokyo");
    expect(result.requestedStartAtUtc).toBe(`${date}T01:00:00.000Z`);
    expect(result.isAvailable).toBe(true);
  });
});
