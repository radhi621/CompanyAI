"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useState } from "react";
import type { ApiRequest, AuthUser } from "../lib/types";
import { extractErrorMessage, roleBadgeClass } from "../lib/utils";

interface AccountPanelProps {
  apiRequest: ApiRequest;
  currentUser: AuthUser;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setFeedback: Dispatch<SetStateAction<string | null>>;
  handleLogout: () => Promise<void>;
}

export default function AccountPanel({ apiRequest, currentUser, busy, setBusy, setFeedback, handleLogout }: AccountPanelProps) {
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  const handleChangeOwnPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setFeedback("New password and confirmation do not match.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      await apiRequest<null>("/auth/me/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });

      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setFeedback("Password changed. Your other sessions have been signed out.");
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm font-semibold text-[#352d21]">{currentUser.name}</p>
      <p className="mt-1 text-xs text-[#7e7058]">{currentUser.email}</p>
      <span
        className={`mt-2 inline-block rounded-full px-2 py-1 text-[11px] font-semibold ${roleBadgeClass(
          currentUser.role,
        )}`}
      >
        {currentUser.role}
      </span>
      <details className="mt-3 rounded-lg border border-[#d9ceb9] bg-[#faf6ee] px-2 py-2">
        <summary className="cursor-pointer text-xs font-medium text-[#6a5b43]">Change password</summary>
        <form className="mt-2 grid gap-2" onSubmit={(event) => void handleChangeOwnPassword(event)}>
          <input
            type="password"
            autoComplete="current-password"
            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
            placeholder="Current password"
            value={passwordForm.currentPassword}
            onChange={(event) =>
              setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
            }
            required
          />
          <input
            type="password"
            autoComplete="new-password"
            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
            placeholder="New password (min 8 chars)"
            value={passwordForm.newPassword}
            onChange={(event) =>
              setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
            }
            minLength={8}
            required
          />
          <input
            type="password"
            autoComplete="new-password"
            className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
            placeholder="Confirm new password"
            value={passwordForm.confirmPassword}
            onChange={(event) =>
              setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
            }
            minLength={8}
            required
          />
          <button
            type="submit"
            className="rounded-lg bg-[#2f2a21] px-3 py-2 text-xs font-semibold text-[#f8f4ec]"
            disabled={busy}
          >
            Update Password
          </button>
        </form>
      </details>
      <button
        type="button"
        onClick={() => void handleLogout()}
        className="mt-3 w-full rounded-lg border border-[#cdbfa8] px-3 py-2 text-xs font-medium hover:bg-[#f7efe1]"
        disabled={busy}
      >
        Logout
      </button>
    </>
  );
}
