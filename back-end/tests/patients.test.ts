import { beforeAll, describe, expect, it } from "vitest";
import { API, type TestSession, api, auth, createPatient, createSession } from "./helpers";

let admin: TestSession;
let secretary: TestSession;
let nurse: TestSession;
let doctor: TestSession;

beforeAll(async () => {
  admin = await createSession("admin");
  secretary = await createSession("secretary");
  nurse = await createSession("nurse");
  doctor = await createSession("doctor");
});

describe("patient access", () => {
  it("lists and reads only assigned patients for non-admins", async () => {
    const mine = await createPatient({ createdBy: admin.id, assignedStaff: [nurse.id] });
    const other = await createPatient({ createdBy: admin.id });

    const list = await api().get(`${API}/patients`).set(auth(nurse));
    const ids = list.body.data.map((p: { _id: string }) => p._id);
    expect(ids).toContain(mine._id.toString());
    expect(ids).not.toContain(other._id.toString());
    expect((await api().get(`${API}/patients/${other._id}`).set(auth(nurse))).status).toBe(404);
  });

  it("lets a secretary update only assigned patients", async () => {
    const assigned = await createPatient({ createdBy: admin.id, assignedStaff: [secretary.id] });
    const unassigned = await createPatient({ createdBy: admin.id });

    const ok = await api().patch(`${API}/patients/${assigned._id}`).set(auth(secretary)).send({ phone: "0611111111" });
    const denied = await api().patch(`${API}/patients/${unassigned._id}`).set(auth(secretary)).send({ phone: "0622222222" });

    expect(ok.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  it("edits names and adds/removes pathologies case-insensitively", async () => {
    const patient = await createPatient({ createdBy: admin.id, pathologies: ["Diabetes", "Asthma"] });

    const res = await api()
      .patch(`${API}/patients/${patient._id}`)
      .set(auth(admin))
      .send({ firstName: "Anna", lastName: "Benali", removePathologies: ["asthma"], pathologies: ["Hypertension", "diabetes"] });

    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe("Anna");
    expect(res.body.data.lastName).toBe("Benali");
    expect(res.body.data.pathologies).toEqual(["Diabetes", "Hypertension"]);
  });

  it("rejects an empty update", async () => {
    const patient = await createPatient({ createdBy: admin.id });
    expect((await api().patch(`${API}/patients/${patient._id}`).set(auth(admin)).send({})).status).toBe(400);
  });
});

describe("patient notes", () => {
  it("allows assigned staff to add and read notes, and blocks unassigned staff", async () => {
    const patient = await createPatient({ createdBy: admin.id, assignedStaff: [nurse.id] });

    const created = await api().post(`${API}/patients/${patient._id}/notes`).set(auth(nurse)).send({ content: "BP 12/8, stable." });
    expect(created.status).toBe(201);

    const list = await api().get(`${API}/patients/${patient._id}/notes`).set(auth(nurse));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].createdBy.name).toBeDefined();

    expect((await api().get(`${API}/patients/${patient._id}/notes`).set(auth(secretary))).status).toBe(403);
  });

  it("lets only the author or an admin edit and delete a note", async () => {
    const patient = await createPatient({ createdBy: admin.id, assignedStaff: [nurse.id, doctor.id] });
    const note = await api().post(`${API}/patients/${patient._id}/notes`).set(auth(nurse)).send({ content: "Initial note" });
    const notePath = `${API}/patients/${patient._id}/notes/${note.body.data._id}`;

    expect((await api().patch(notePath).set(auth(doctor)).send({ content: "Doctor edit" })).status).toBe(403);
    expect((await api().patch(notePath).set(auth(admin)).send({ content: "Admin edit" })).status).toBe(200);
    expect((await api().delete(notePath).set(auth(doctor))).status).toBe(403);
    expect((await api().delete(notePath).set(auth(nurse))).status).toBe(200);

    const after = await api().get(`${API}/patients/${patient._id}/notes`).set(auth(nurse));
    expect(after.body.data).toHaveLength(0);
  });
});
