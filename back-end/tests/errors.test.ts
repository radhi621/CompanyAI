import { beforeAll, describe, expect, it } from "vitest";
import { API, type TestSession, api, auth, createSession } from "./helpers";

let admin: TestSession;

beforeAll(async () => {
  admin = await createSession("admin");
});

describe("error responses", () => {
  it("answers malformed JSON with 400 instead of 500", async () => {
    const res = await api()
      .post(`${API}/patients`)
      .set(auth(admin))
      .set("Content-Type", "application/json")
      .send("{not json");

    expect(res.status).toBe(400);
  });

  it("maps a duplicate CIN to 409 without echoing the value", async () => {
    const body = { firstName: "Dup", lastName: "Licate", cin: "DUPLICATE01" };
    const results = await Promise.all([1, 2].map(() => api().post(`${API}/patients`).set(auth(admin)).send(body)));

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(JSON.stringify(conflict.body)).not.toContain("DUPLICATE01");
  });

  it("treats regex characters in the doctor specialty filter as plain text", async () => {
    const res = await api().get(`${API}/doctors?specialty=${encodeURIComponent("(")}`).set(auth(admin));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("returns 404 JSON for unknown routes", async () => {
    const res = await api().get(`${API}/does-not-exist`).set(auth(admin));
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Route not found");
  });

  it("requires authentication", async () => {
    expect((await api().get(`${API}/patients`)).status).toBe(401);
  });
});
