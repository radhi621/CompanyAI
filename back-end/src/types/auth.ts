export type UserRole = "admin" | "doctor" | "nurse" | "secretary";

export interface JwtPayload {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
  type: "access" | "refresh";
}

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
  name: string;
}