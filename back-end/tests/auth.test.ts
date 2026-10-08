import { describe, expect, it } from "vitest";
import { RefreshTokenModel } from "../src/models/RefreshToken";
import { UserModel } from "../src/models/User";
import { API, PASSWORD, api, auth, createSession, login, refreshCookieFrom } from "./helpers";

const refresh = (cookie: string) => api().post(`${API}/auth/refresh`).set("Cookie", cookie).send({});

describe("bootstrap and login", () => {
  it("reports setup as needed until the first admin exists, and bootstraps only once", async () => {
    const body = { name: "Boot Admin", email: "boot@test.io", password: PASSWORD };
    const setupStatus = async () => (await api().get(`${API}/auth/setup-status`)).body.data.needsSetup;

    expect(await setupStatus()).toBe(true);
    expect((await api().post(`${API}/auth/bootstrap-admin`).send({ ...body, bootstrapKey: "wrong-key" })).status).toBe(403);
    expect(await setupStatus()).toBe(true);

    expect((await api().post(`${API}/auth/bootstrap-admin`).send({ ...body, bootstrapKey: "test-bootstrap-key" })).status).toBe(201);
    expect(await setupStatus()).toBe(false);

    const again = await api()
      .post(`${API}/auth/bootstrap-admin`)
      .send({ ...body, email: "boot2@test.io", bootstrapKey: "test-bootstrap-key" });
    expect(again.status).toBe(409);
  });

  it("returns only the access token in the body and sets the refresh token as an httpOnly cookie", async () => {
    const session = await createSession("nurse");
    const res = await login(session.email);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("accessToken");
    expect(res.body.data).not.toHaveProperty("refreshToken");
    const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("refreshToken="));
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("handles two logins in the same second without colliding (unique jwtid)", async () => {
    const session = await createSession("doctor");
    const [a, b] = await Promise.all([login(session.email), login(session.email)]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(refreshCookieFrom(a)).not.toBe(refreshCookieFrom(b));
  });

  it("rejects a wrong password", async () => {
    const session = await createSession("secretary");
    expect((await login(session.email, "WrongPassword9")).status).toBe(401);
  });
});

describe("refresh token rotation", () => {
  it("rotates using only the cookie and issues a working access token", async () => {
    const session = await createSession("nurse");
    const res = await refresh(session.cookie);

    expect(res.status).toBe(200);
    const me = await api().get(`${API}/auth/me`).set("Authorization", `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it("lets only one of two concurrent refreshes of the same token win", async () => {
    const session = await createSession("nurse");
    const statuses = (await Promise.all([refresh(session.cookie), refresh(session.cookie)])).map((r) => r.status);

    expect(statuses.sort()).toEqual([200, 401]);
  });

  it("treats reuse within the grace window as a plain 401 and keeps the new session", async () => {
    const session = await createSession("doctor");
    const rotated = await refresh(session.cookie);

    expect((await refresh(session.cookie)).status).toBe(401);
    expect((await refresh(refreshCookieFrom(rotated))).status).toBe(200);
  });

  it("revokes every session when a rotated token is replayed after the grace window", async () => {
    const session = await createSession("doctor");
    const rotated = await refresh(session.cookie);
    const otherDevice = await login(session.email);

    // Simulate the original token having been rotated away a minute ago.
    await RefreshTokenModel.updateMany(
      { revokedAt: { $exists: true } },
      { $set: { revokedAt: new Date(Date.now() - 60_000) } },
    );

    const replay = await refresh(session.cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.message).toMatch(/security reasons/i);
    expect((await refresh(refreshCookieFrom(rotated))).status).toBe(401);
    expect((await refresh(refreshCookieFrom(otherDevice))).status).toBe(401);
  });

  it("revokes the token on logout", async () => {
    const session = await createSession("secretary");
    await api().post(`${API}/auth/logout`).set("Cookie", session.cookie).send({});

    expect((await refresh(session.cookie)).status).toBe(401);
  });
});

describe("account state", () => {
  it("locks out a deactivated user immediately, even with a valid access token", async () => {
    const session = await createSession("nurse");
    expect((await api().get(`${API}/auth/me`).set(auth(session))).status).toBe(200);

    await UserModel.updateOne({ _id: session.id }, { $set: { isActive: false } });
    expect((await api().get(`${API}/auth/me`).set(auth(session))).status).toBe(401);
  });

  it("changes the own password, keeping this session and ending the others", async () => {
    const session = await createSession("doctor");
    const otherDevice = await login(session.email);

    const wrong = await api()
      .post(`${API}/auth/me/password`)
      .set(auth(session))
      .set("Cookie", session.cookie)
      .send({ currentPassword: "not-the-password", newPassword: "BrandNewPass2" });
    expect(wrong.status).toBe(400);

    const ok = await api()
      .post(`${API}/auth/me/password`)
      .set(auth(session))
      .set("Cookie", session.cookie)
      .send({ currentPassword: PASSWORD, newPassword: "BrandNewPass2" });
    expect(ok.status).toBe(200);

    expect((await refresh(session.cookie)).status).toBe(200);
    expect((await refresh(refreshCookieFrom(otherDevice))).status).toBe(401);
    expect((await login(session.email, PASSWORD)).status).toBe(401);
    expect((await login(session.email, "BrandNewPass2")).status).toBe(200);
  });
});

// Keep last: the limiter is in-memory and shared by every request in this file.
describe("rate limiting", () => {
  it("blocks the 11th failed login in the window", async () => {
    const session = await createSession("secretary");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await login(session.email, "WrongPassword9")).status);
    }

    // Earlier failures in this file (wrong password, wrong current password) share the budget.
    expect(statuses).toContain(429);
    expect(statuses.at(-1)).toBe(429);
  });
});
