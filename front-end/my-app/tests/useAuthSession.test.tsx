import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { useAuthSession } from "../hooks/useAuthSession";
import { CONVERSATIONS_STORAGE_KEY, WORKSPACE_OWNER_STORAGE_KEY } from "../lib/config";
import { authHeader, jsonResponse, stubFetch } from "./helpers";

const API = "http://api.test/api/v1";
const USER = { id: "u1", name: "Dr Amrani", email: "amrani@example.com", role: "doctor" as const };
const formEvent = { preventDefault: () => {} } as FormEvent<HTMLFormElement>;

function renderAuth() {
  const setBusy = vi.fn();
  const setFeedback = vi.fn();
  const hook = renderHook(() => useAuthSession({ setBusy, setFeedback }));
  return { ...hook, setBusy, setFeedback };
}

describe("useAuthSession", () => {
  it("resumes the session from the refresh cookie on load", async () => {
    const calls = stubFetch((url) => {
      if (url === `${API}/auth/refresh`) return jsonResponse(200, { accessToken: "token-1", user: USER });
      if (url === `${API}/auth/me`) return jsonResponse(200, USER);
      throw new Error(`unexpected ${url}`);
    });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.currentUser?.id).toBe("u1"));
    expect(result.current.token).toBe("token-1");
    expect(authHeader(calls.find((call) => call.url.endsWith("/auth/me"))?.init)).toBe("Bearer token-1");
    expect(window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY)).toBe("u1");
  });

  it("shows sign-in when there is no session and the app is set up", async () => {
    stubFetch((url) => {
      if (url === `${API}/auth/refresh`) return jsonResponse(401, null, "No session");
      if (url === `${API}/auth/setup-status`) return jsonResponse(200, { needsSetup: false });
      throw new Error(`unexpected ${url}`);
    });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.setupStatus).toBe("done"));
    expect(result.current.token).toBeNull();
    expect(result.current.currentUser).toBeNull();
  });

  it("shows first-run setup on a fresh install", async () => {
    stubFetch((url) => {
      if (url === `${API}/auth/refresh`) return jsonResponse(401, null);
      if (url === `${API}/auth/setup-status`) return jsonResponse(200, { needsSetup: true });
      throw new Error(`unexpected ${url}`);
    });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.setupStatus).toBe("needed"));
  });

  it("signs in and clears another user's saved chats", async () => {
    window.localStorage.setItem(WORKSPACE_OWNER_STORAGE_KEY, "someone-else");
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, "their patient chats");

    stubFetch((url, init) => {
      if (url === `${API}/auth/refresh`) return jsonResponse(401, null);
      if (url === `${API}/auth/setup-status`) return jsonResponse(200, { needsSetup: false });
      if (url === `${API}/auth/login`) {
        expect(JSON.parse(String(init?.body))).toEqual({ email: USER.email, password: "secret-pass" });
        return jsonResponse(200, { accessToken: "token-1", user: USER });
      }
      if (url === `${API}/auth/me`) return jsonResponse(200, USER);
      throw new Error(`unexpected ${url}`);
    });

    const { result, setFeedback } = renderAuth();
    await waitFor(() => expect(result.current.setupStatus).toBe("done"));

    act(() => result.current.setLoginForm({ email: USER.email, password: "secret-pass" }));
    await act(() => result.current.handleLogin(formEvent));

    expect(result.current.currentUser?.id).toBe("u1");
    expect(result.current.loginForm).toEqual({ email: "", password: "" });
    expect(setFeedback).toHaveBeenLastCalledWith("Welcome back.");
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY)).toBe("u1");
  });

  it("refreshes an expired access token once and retries the request", async () => {
    let refreshCount = 0;
    const calls = stubFetch((url, init) => {
      if (url === `${API}/auth/refresh`) {
        refreshCount += 1;
        return jsonResponse(200, { accessToken: `token-${refreshCount}`, user: USER });
      }
      if (url === `${API}/auth/me`) return jsonResponse(200, USER);
      if (url === `${API}/patients`) {
        return authHeader(init) === "Bearer token-2"
          ? jsonResponse(200, [{ id: "p1" }])
          : jsonResponse(401, null, "Token expired");
      }
      throw new Error(`unexpected ${url}`);
    });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.currentUser).not.toBeNull());

    // Two requests fail at once: they must share a single refresh, since refresh tokens rotate.
    let responses: unknown[] = [];
    await act(async () => {
      responses = await Promise.all([
        result.current.apiRequest("/patients"),
        result.current.apiRequest("/patients"),
      ]);
    });

    expect(responses).toEqual([[{ id: "p1" }], [{ id: "p1" }]]);
    expect(refreshCount).toBe(2); // one on load, one for the expired token
    expect(calls.filter((call) => call.url.endsWith("/patients")).map((call) => authHeader(call.init))).toEqual([
      "Bearer token-1",
      "Bearer token-1",
      "Bearer token-2",
      "Bearer token-2",
    ]);
  });

  it("signs out when the session cannot be refreshed", async () => {
    let refreshAllowed = true;
    stubFetch((url) => {
      if (url === `${API}/auth/refresh`) {
        return refreshAllowed ? jsonResponse(200, { accessToken: "token-1", user: USER }) : jsonResponse(401, null);
      }
      if (url === `${API}/auth/me`) return jsonResponse(200, USER);
      if (url === `${API}/auth/setup-status`) return jsonResponse(200, { needsSetup: false });
      if (url === `${API}/patients`) return jsonResponse(401, null, "Token expired");
      throw new Error(`unexpected ${url}`);
    });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.currentUser).not.toBeNull());

    refreshAllowed = false;
    await act(async () => {
      await expect(result.current.apiRequest("/patients")).rejects.toThrow("Token expired | HTTP 401 GET");
    });

    expect(result.current.token).toBeNull();
    expect(result.current.currentUser).toBeNull();
  });

  it("does not try to refresh after a wrong password", async () => {
    const calls = stubFetch((url) => {
      if (url === `${API}/auth/refresh`) return jsonResponse(401, null);
      if (url === `${API}/auth/setup-status`) return jsonResponse(200, { needsSetup: false });
      if (url === `${API}/auth/login`) return jsonResponse(401, null, "Invalid credentials");
      throw new Error(`unexpected ${url}`);
    });

    const { result, setFeedback } = renderAuth();
    await waitFor(() => expect(result.current.setupStatus).toBe("done"));
    const refreshesBefore = calls.filter((call) => call.url.endsWith("/auth/refresh")).length;

    await act(() => result.current.handleLogin(formEvent));

    expect(setFeedback).toHaveBeenLastCalledWith("Invalid credentials");
    expect(calls.filter((call) => call.url.endsWith("/auth/refresh"))).toHaveLength(refreshesBefore);
  });

  it("clears the saved workspace on sign-out", async () => {
    stubFetch((url) => {
      if (url === `${API}/auth/refresh`) return jsonResponse(200, { accessToken: "token-1", user: USER });
      if (url === `${API}/auth/me`) return jsonResponse(200, USER);
      if (url === `${API}/auth/logout`) return jsonResponse(200, null);
      if (url === `${API}/auth/setup-status`) return jsonResponse(200, { needsSetup: false });
      throw new Error(`unexpected ${url}`);
    });

    const { result } = renderAuth();
    await waitFor(() => expect(result.current.currentUser).not.toBeNull());
    window.localStorage.setItem(CONVERSATIONS_STORAGE_KEY, "patient chats");

    await act(() => result.current.handleLogout());

    expect(result.current.currentUser).toBeNull();
    expect(window.localStorage.getItem(CONVERSATIONS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY)).toBeNull();
  });
});
