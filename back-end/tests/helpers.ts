import request from "supertest";
import { Types } from "mongoose";
import { app } from "../src/app";
import { DoctorModel } from "../src/models/Doctor";
import { PatientModel } from "../src/models/Patient";
import { UserModel } from "../src/models/User";
import type { AuthUser, UserRole } from "../src/types/auth";

export const api = () => request(app);
export const API = "/api/v1";
export const PASSWORD = "CorrectHorse1";

export interface TestSession {
  id: string;
  email: string;
  role: UserRole;
  token: string;
  /** "refreshToken=..." cookie pair, ready for a Cookie header. */
  cookie: string;
  actor: AuthUser;
}

let counter = 0;
const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${(counter += 1)}`;

export function refreshCookieFrom(res: request.Response): string {
  const header = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith("refreshToken="));
  if (!cookie) {
    throw new Error("Response did not set a refreshToken cookie");
  }
  return cookie.split(";")[0];
}

export async function login(email: string, password = PASSWORD): Promise<request.Response> {
  return api().post(`${API}/auth/login`).send({ email, password });
}

/** Creates a user straight in the database and signs in through the real login route. */
export async function createSession(role: UserRole, name = `Test ${role}`): Promise<TestSession> {
  const email = `${unique(role)}@test.io`;
  const user = await UserModel.create({ name, email, password: PASSWORD, role });
  const res = await login(email);
  if (res.status !== 200) {
    throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    id: user._id.toString(),
    email,
    role,
    token: res.body.data.accessToken,
    cookie: refreshCookieFrom(res),
    actor: { id: user._id.toString(), role, email, name },
  };
}

export async function createPatient(input: {
  createdBy: string;
  assignedStaff?: string[];
  firstName?: string;
  lastName?: string;
  pathologies?: string[];
}) {
  return PatientModel.create({
    firstName: input.firstName ?? "Ana",
    lastName: input.lastName ?? "Test",
    cin: unique("CIN").toUpperCase(),
    pathologies: input.pathologies ?? [],
    assignedStaff: (input.assignedStaff ?? []).map((id) => new Types.ObjectId(id)),
    createdBy: new Types.ObjectId(input.createdBy),
  });
}

export async function createDoctor(createdBy: string) {
  return DoctorModel.create({
    fullName: "Dr Test",
    specialty: "General",
    createdBy: new Types.ObjectId(createdBy),
  });
}

export const auth = (session: TestSession) => ({ Authorization: `Bearer ${session.token}` });
