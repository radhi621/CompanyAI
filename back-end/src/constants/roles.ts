import type { UserRole } from "../types/auth";

export const ROLE_LEVEL: Record<UserRole, number> = {
  secretary: 1,
  nurse: 2,
  doctor: 3,
  admin: 4,
};

export const isHigherRole = (candidateRole: UserRole, targetRole: UserRole): boolean => {
  return ROLE_LEVEL[candidateRole] > ROLE_LEVEL[targetRole];
};

export const hasRoleOrHigher = (candidateRole: UserRole, minimumRole: UserRole): boolean => {
  return ROLE_LEVEL[candidateRole] >= ROLE_LEVEL[minimumRole];
};