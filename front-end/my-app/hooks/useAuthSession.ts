"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope, ApiRequest, AuthUser, LoginResponse } from "../lib/types";
import { NO_REFRESH_PATHS, TOKEN_STORAGE_KEY, buildApiUrl } from "../lib/config";
import { extractErrorMessage, formatApiErrorMessage, readableAuthError } from "../lib/utils";
import { claimWorkspace, releaseWorkspace } from "../lib/workspaceStorage";

export type SetupStatus = "checking" | "needed" | "done";

const EMPTY_BOOTSTRAP_FORM = { bootstrapKey: "", name: "", email: "", password: "" };
const EMPTY_LOGIN_FORM = { email: "", password: "" };

interface UseAuthSessionOptions {
  setBusy: (busy: boolean) => void;
  setFeedback: (feedback: string | null) => void;
}

/**
 * Sign-in state and the authenticated request helper.
 *
 * The access token lives in memory only, so injected scripts cannot read it from storage.
 * After a reload the session is restored through the httpOnly refresh cookie instead.
 */
export function useAuthSession({ setBusy, setFeedback }: UseAuthSessionOptions) {
  const [token, setToken] = useState<string | null>(null);
  const [sessionRestoreDone, setSessionRestoreDone] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  // "needed" only on a fresh install with no admin yet; then the setup screen replaces sign-in.
  const [setupStatus, setSetupStatus] = useState<SetupStatus>("checking");
  const [bootstrapForm, setBootstrapForm] = useState(EMPTY_BOOTSTRAP_FORM);
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN_FORM);

  const clearSession = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setFeedback(null);

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  }, [setFeedback]);

  const refreshPromiseRef = useRef<Promise<string | null> | null>(null);

  // Exchanges the httpOnly refresh cookie for a new access token. Concurrent callers
  // share one request, because the backend rotates (and revokes) the refresh token.
  const refreshAccessToken = useCallback((): Promise<string | null> => {
    if (!refreshPromiseRef.current) {
      refreshPromiseRef.current = (async () => {
        try {
          const response = await fetch(buildApiUrl("/auth/refresh"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            credentials: "include",
            cache: "no-store",
          });

          if (!response.ok) {
            return null;
          }

          const payload = (await response.json().catch(() => null)) as ApiEnvelope<LoginResponse> | null;
          const nextToken = payload?.data?.accessToken ?? null;
          if (nextToken) {
            setToken(nextToken);
          }

          return nextToken;
        } catch {
          return null;
        } finally {
          refreshPromiseRef.current = null;
        }
      })();
    }

    return refreshPromiseRef.current;
  }, []);

  const apiRequest: ApiRequest = useCallback(
    async <T,>(path: string, options?: RequestInit & { idempotencyKey?: string }): Promise<T> => {
      const isFormDataBody =
        typeof FormData !== "undefined" && options?.body instanceof FormData;

      const buildHeaders = (accessToken: string | null): Headers => {
        const headers = new Headers(options?.headers ?? {});

        if (accessToken) {
          headers.set("Authorization", `Bearer ${accessToken}`);
        }

        if (options?.body && !isFormDataBody && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }

        if (options?.idempotencyKey) {
          headers.set("Idempotency-Key", options.idempotencyKey);
        }

        return headers;
      };

      const requestMethod = options?.method ?? "GET";
      const requestUrl = buildApiUrl(path);

      const send = async (accessToken: string | null): Promise<Response> => {
        try {
          return await fetch(requestUrl, {
            ...options,
            headers: buildHeaders(accessToken),
            credentials: "include",
            cache: "no-store",
          });
        } catch (error) {
          throw new Error(
            `Network error for ${requestMethod} ${requestUrl}: ${extractErrorMessage(error)}`,
          );
        }
      };

      let response = await send(token);

      // Access tokens last 15 minutes: refresh once and retry instead of logging out.
      if (response.status === 401 && token && !NO_REFRESH_PATHS.has(path)) {
        const refreshedToken = await refreshAccessToken();
        if (refreshedToken) {
          response = await send(refreshedToken);
        }
      }

      const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

      if (!response.ok) {
        if (response.status === 401 && token) {
          clearSession();
        }

        const baseMessage =
          formatApiErrorMessage(payload) ??
          payload?.message ??
          `Request failed with status ${response.status}`;

        throw new Error(`${baseMessage} | HTTP ${response.status} ${requestMethod} ${requestUrl}`);
      }

      if (!payload) {
        throw new Error(`Empty API response for ${requestMethod} ${requestUrl}`);
      }

      return payload.data;
    },
    [clearSession, refreshAccessToken, token],
  );

  const loadCurrentUser = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      const user = await apiRequest<AuthUser>("/auth/me");
      claimWorkspace(user.id);
      setCurrentUser(user);
    } catch (error) {
      clearSession();
      // An expired or revoked saved session just leads back to sign-in; only explain other
      // failures (such as the backend being unreachable).
      if (!extractErrorMessage(error).includes("| HTTP 401 ")) {
        setFeedback(readableAuthError(error));
      }
    }
  }, [apiRequest, clearSession, setFeedback, token]);

  // On first load, try to resume the session from the refresh cookie before showing sign-in.
  useEffect(() => {
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      // Tokens saved by older versions of the app should not linger in storage.
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);

      void refreshAccessToken().finally(() => {
        if (!cancelled) {
          setSessionRestoreDone(true);
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [refreshAccessToken]);

  useEffect(() => {
    if (!token || typeof window === "undefined") {
      return;
    }

    const timerId = window.setTimeout(() => {
      void loadCurrentUser();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [loadCurrentUser, token]);

  // Ask the backend whether this is a fresh install, to show either first-run setup or sign-in.
  useEffect(() => {
    if (token || !sessionRestoreDone) {
      return;
    }

    let cancelled = false;
    const timerId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(buildApiUrl("/auth/setup-status"), { cache: "no-store" });
          const payload = (await response.json().catch(() => null)) as ApiEnvelope<{ needsSetup: boolean }> | null;
          if (!cancelled) {
            setSetupStatus(response.ok && payload?.data?.needsSetup ? "needed" : "done");
          }
        } catch {
          // Backend unreachable: show sign-in, which reports the connection problem on submit.
          if (!cancelled) {
            setSetupStatus("done");
          }
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [sessionRestoreDone, token]);

  const signIn = (result: LoginResponse) => {
    claimWorkspace(result.user.id);
    setToken(result.accessToken);
    setCurrentUser(result.user);
  };

  const handleBootstrapAdmin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      await apiRequest<AuthUser>("/auth/bootstrap-admin", {
        method: "POST",
        body: JSON.stringify(bootstrapForm),
      });

      // Sign the new admin straight in instead of making them retype their credentials.
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: bootstrapForm.email, password: bootstrapForm.password }),
      });

      signIn(result);
      setBootstrapForm(EMPTY_BOOTSTRAP_FORM);
      setSetupStatus("done");
      setFeedback("Setup complete. Welcome to MediAssist.");
    } catch (error) {
      setFeedback(readableAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      const result = await apiRequest<LoginResponse>("/auth/login", {
        method: "POST",
        body: JSON.stringify(loginForm),
      });

      signIn(result);
      setLoginForm(EMPTY_LOGIN_FORM);
      setFeedback("Welcome back.");
    } catch (error) {
      setFeedback(readableAuthError(error));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);

    try {
      await apiRequest<null>("/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
    } catch {
      // Ignore logout errors and clear local session anyway.
    } finally {
      clearSession();
      releaseWorkspace();
      setBusy(false);
    }
  };

  return {
    token,
    currentUser,
    setupStatus,
    bootstrapForm,
    setBootstrapForm,
    loginForm,
    setLoginForm,
    apiRequest,
    refreshAccessToken,
    handleBootstrapAdmin,
    handleLogin,
    handleLogout,
  };
}
