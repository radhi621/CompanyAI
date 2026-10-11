import { WORKSPACE_OWNER_STORAGE_KEY, WORKSPACE_STORAGE_KEYS } from "./config";

// Saved chats and patient folders can contain patient data, so they belong to the user who
// created them. The workspace UI reads this storage when it mounts after sign-in.

/** Removes saved chats and patient folders from this browser. */
export function clearWorkspaceStorage(): void {
  if (typeof window === "undefined") {
    return;
  }

  WORKSPACE_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
}

/** Marks the saved workspace as this user's; a different user starts clean. */
export function claimWorkspace(userId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const owner = window.localStorage.getItem(WORKSPACE_OWNER_STORAGE_KEY);
  if (owner && owner !== userId) {
    clearWorkspaceStorage();
  }

  window.localStorage.setItem(WORKSPACE_OWNER_STORAGE_KEY, userId);
}

/** Clears the workspace and its owner, used on sign-out. */
export function releaseWorkspace(): void {
  if (typeof window === "undefined") {
    return;
  }

  clearWorkspaceStorage();
  window.localStorage.removeItem(WORKSPACE_OWNER_STORAGE_KEY);
}
