import { vi } from "vitest";

/** A JSON response shaped like the backend's envelope ({ message, data }). */
export function jsonResponse(status: number, data: unknown, message = "ok"): Response {
  return new Response(JSON.stringify({ message, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type FetchHandler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

/** Replaces global fetch; each call goes to the handler, and calls are recorded. */
export function stubFetch(handler: FetchHandler) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

export function authHeader(init: RequestInit | undefined): string | null {
  return new Headers(init?.headers).get("Authorization");
}
