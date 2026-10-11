import { beforeAll, describe, expect, it } from "vitest";
import { API, PASSWORD, type TestSession, api, auth, createSession, login, refreshCookieFrom } from "./helpers";

let admin: TestSession;

beforeAll(async () => {
  admin = await createSession("admin", "Admin One");
});

describe("user management", () => {
  it("is admin-only", async () => {
    const secretary = await createSession("secretary");

    expect((await api().get(`${API}/users`).set(auth(admin))).status).toBe(200);
    expect((await api().get(`${API}/users`).set(auth(secretary))).status).toBe(403);
  });

  it("creates staff through /auth/users and lists them with filters", async () => {
    const created = await api()
      .post(`${API}/auth/users`)
      .set(auth(admin))
      .send({ name: "Nadia Nurse", email: "nadia@test.io", password: PASSWORD, role: "nurse" });
    expect(created.status).toBe(201);

    const nurses = await api().get(`${API}/users?role=nurse&search=nadia`).set(auth(admin));
    expect(nurses.body.data.map((u: { email: string }) => u.email)).toEqual(["nadia@test.io"]);
  });

  it("prevents an admin from demoting or deactivating their own account", async () => {
    const demote = await api().patch(`${API}/users/${admin.id}`).set(auth(admin)).send({ role: "doctor" });
    const deactivate = await api().patch(`${API}/users/${admin.id}`).set(auth(admin)).send({ isActive: false });

    expect(demote.status).toBe(400);
    expect(deactivate.status).toBe(400);
  });

  it("applies role changes immediately", async () => {
    const promoted = await createSession("secretary");
    await api().patch(`${API}/users/${promoted.id}`).set(auth(admin)).send({ role: "admin" });

    // Same access token as before: the role is read from the database on every request.
    expect((await api().get(`${API}/users`).set(auth(promoted))).status).toBe(200);
  });

  it("signs a deactivated user out of every session", async () => {
    const nurse = await createSession("nurse");
    const res = await api().patch(`${API}/users/${nurse.id}`).set(auth(admin)).send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect((await api().get(`${API}/auth/me`).set(auth(nurse))).status).toBe(401);
    expect((await api().post(`${API}/auth/refresh`).set("Cookie", nurse.cookie).send({})).status).toBe(401);
    expect((await login(nurse.email)).status).toBe(403);
  });

  it("resets a password and ends the user's sessions", async () => {
    const doctor = await createSession("doctor");
    const otherDevice = refreshCookieFrom(await login(doctor.email));

    const res = await api()
      .post(`${API}/users/${doctor.id}/reset-password`)
      .set(auth(admin))
      .send({ newPassword: "ResetByAdmin3" });
    expect(res.status).toBe(200);

    expect((await api().post(`${API}/auth/refresh`).set("Cookie", otherDevice).send({})).status).toBe(401);
    expect((await login(doctor.email, PASSWORD)).status).toBe(401);
    expect((await login(doctor.email, "ResetByAdmin3")).status).toBe(200);
  });
});
