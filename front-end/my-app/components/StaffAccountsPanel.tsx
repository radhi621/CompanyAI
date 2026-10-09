"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";
import { useCallback, useEffect, useState } from "react";
import type { ApiRequest, AuthUser, ManagedUser, UserRole } from "../lib/types";
import { extractErrorMessage, roleBadgeClass } from "../lib/utils";

interface StaffAccountsPanelProps {
  apiRequest: ApiRequest;
  currentUser: AuthUser;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setFeedback: Dispatch<SetStateAction<string | null>>;
}

export default function StaffAccountsPanel({ apiRequest, currentUser, busy, setBusy, setFeedback }: StaffAccountsPanelProps) {
  const [staffForm, setStaffForm] = useState<{
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }>({
    name: "",
    email: "",
    password: "",
    role: "secretary",
  });
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [resetPasswordDrafts, setResetPasswordDrafts] = useState<Record<string, string>>({});

  const loadManagedUsers = useCallback(async () => {
    try {
      const users = await apiRequest<ManagedUser[]>("/users?limit=200");
      setManagedUsers(users);
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    }
  }, [apiRequest, setFeedback]);

  const isAdmin = currentUser?.role === "admin";

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    const timerId = window.setTimeout(() => {
      void loadManagedUsers();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [isAdmin, loadManagedUsers]);

  const handleCreateStaff = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFeedback(null);

    try {
      const user = await apiRequest<AuthUser>("/auth/users", {
        method: "POST",
        body: JSON.stringify(staffForm),
      });

      setFeedback(`Staff account created for ${user.email} (${user.role}).`);
      setStaffForm({ name: "", email: "", password: "", role: "secretary" });
      await loadManagedUsers();
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdateManagedUser = async (
    user: ManagedUser,
    patch: Partial<Pick<ManagedUser, "role" | "isActive">>,
  ) => {
    setBusy(true);
    setFeedback(null);

    try {
      const updated = await apiRequest<ManagedUser>(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });

      setManagedUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setFeedback(`Updated ${updated.email}.`);
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleResetManagedUserPassword = async (user: ManagedUser) => {
    const newPassword = resetPasswordDrafts[user.id] ?? "";
    if (newPassword.length < 8) {
      setFeedback("The new password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    setFeedback(null);

    try {
      await apiRequest<ManagedUser>(`/users/${user.id}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ newPassword }),
      });

      setResetPasswordDrafts((current) => ({ ...current, [user.id]: "" }));
      setFeedback(`Password reset for ${user.email}. They have been signed out everywhere.`);
    } catch (error) {
      setFeedback(extractErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form className="grid gap-2" onSubmit={(event) => void handleCreateStaff(event)}>
        <input
          className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
          placeholder="Full name"
          value={staffForm.name}
          onChange={(event) =>
            setStaffForm((current) => ({ ...current, name: event.target.value }))
          }
          minLength={2}
          required
        />
        <input
          type="email"
          className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
          placeholder="Email"
          value={staffForm.email}
          onChange={(event) =>
            setStaffForm((current) => ({ ...current, email: event.target.value }))
          }
          required
        />
        <input
          type="password"
          autoComplete="new-password"
          className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
          placeholder="Temporary password (min 8 chars)"
          value={staffForm.password}
          onChange={(event) =>
            setStaffForm((current) => ({ ...current, password: event.target.value }))
          }
          minLength={8}
          required
        />
        <select
          className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-2 text-xs"
          value={staffForm.role}
          onChange={(event) =>
            setStaffForm((current) => ({ ...current, role: event.target.value as UserRole }))
          }
        >
          <option value="secretary">Secretary</option>
          <option value="nurse">Nurse</option>
          <option value="doctor">Doctor</option>
          <option value="admin">Admin</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-[#2f2a21] px-3 py-2 text-xs font-semibold text-[#f8f4ec]"
          disabled={busy}
        >
          {busy ? "Creating..." : "Create Account"}
        </button>
      </form>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a7c62]">
          Team ({managedUsers.length})
        </p>
        <button
          type="button"
          onClick={() => void loadManagedUsers()}
          className="rounded-md border border-[#d2c6b1] px-2 py-1 text-[10px] text-[#6a5b43] hover:bg-[#fff8ed]"
          disabled={busy}
        >
          Refresh
        </button>
      </div>
      <div className="mt-2 max-h-[320px] space-y-2 overflow-y-auto pr-1">
        {managedUsers.map((user) => {
          const isSelf = user.id === currentUser.id;

          return (
            <details
              key={user.id}
              className={`rounded-lg border px-2 py-2 ${
                user.isActive ? "border-[#d9ceb9] bg-[#faf6ee]" : "border-[#e3c9c3] bg-[#fbf1ef]"
              }`}
            >
              <summary className="flex cursor-pointer items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-[#352d21]">
                    {user.name}
                    {isSelf ? " (you)" : ""}
                  </span>
                  <span className="block truncate text-[10px] text-[#7e7058]">{user.email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleBadgeClass(user.role)}`}>
                    {user.role}
                  </span>
                  {!user.isActive && (
                    <span className="rounded-full bg-[#f3d9d4] px-2 py-0.5 text-[10px] font-semibold text-[#7f3f3f]">
                      inactive
                    </span>
                  )}
                </span>
              </summary>

              <div className="mt-2 grid gap-2">
                <label className="grid gap-1 text-[10px] text-[#6a5b43]">
                  Role
                  <select
                    className="rounded-lg border border-[#d7ccb8] bg-white px-2 py-1 text-xs"
                    value={user.role}
                    disabled={busy || isSelf}
                    onChange={(event) =>
                      void handleUpdateManagedUser(user, { role: event.target.value as UserRole })
                    }
                  >
                    <option value="secretary">Secretary</option>
                    <option value="nurse">Nurse</option>
                    <option value="doctor">Doctor</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => void handleUpdateManagedUser(user, { isActive: !user.isActive })}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    user.isActive
                      ? "border border-[#d9b3ab] text-[#7f3f3f] hover:bg-[#fff1ef]"
                      : "bg-[#0f5a4f] text-white"
                  }`}
                  disabled={busy || isSelf}
                >
                  {user.isActive ? "Deactivate account" : "Reactivate account"}
                </button>

                {isSelf ? (
                  <p className="text-[10px] text-[#8a7c62]">
                    Change your own password from the Account section.
                  </p>
                ) : (
                  <div className="flex gap-1">
                    <input
                      type="password"
                      autoComplete="new-password"
                      className="min-w-0 flex-1 rounded-lg border border-[#d7ccb8] bg-white px-2 py-1 text-xs"
                      placeholder="New password (min 8)"
                      value={resetPasswordDrafts[user.id] ?? ""}
                      onChange={(event) =>
                        setResetPasswordDrafts((current) => ({ ...current, [user.id]: event.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => void handleResetManagedUserPassword(user)}
                      className="rounded-lg bg-[#2f2a21] px-2 py-1 text-[10px] font-semibold text-[#f8f4ec]"
                      disabled={busy}
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
