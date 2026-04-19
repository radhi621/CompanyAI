import crypto from "crypto";
import { Types } from "mongoose";
import { env } from "../../config/env";
import { RefreshTokenModel } from "../../models/RefreshToken";
import { UserModel, type IUserDocument } from "../../models/User";
import type { AuthUser, UserRole } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/token";

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface BootstrapAdminInput {
  bootstrapKey: string;
  name: string;
  email: string;
  password: string;
}

interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface LoginInput {
  email: string;
  password: string;
}

const refreshTokenTtlMs = toMilliseconds(env.JWT_REFRESH_EXPIRES_IN, 7 * 24 * 60 * 60 * 1000);

function toMilliseconds(value: string, defaultMs: number): number {
  const regex = /^(\d+)([smhd])$/i;
  const match = regex.exec(value.trim());
  if (!match) {
    return defaultMs;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return amount * (multipliers[unit] ?? defaultMs);
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function toSafeUser(user: IUserDocument): AuthUser & { isActive: boolean } {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
}

async function issueTokens(user: IUserDocument, userAgent?: string, ipAddress?: string): Promise<AuthTokens> {
  const identity = {
    sub: user._id.toString(),
    role: user.role,
    email: user.email,
    name: user.name,
  };

  const accessToken = signAccessToken(identity);
  const refreshToken = signRefreshToken(identity);

  await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(Date.now() + refreshTokenTtlMs),
    userAgent,
    ipAddress,
  });

  return {
    accessToken,
    refreshToken,
  };
}

export const bootstrapAdmin = async (input: BootstrapAdminInput): Promise<AuthUser & { isActive: boolean }> => {
  if (input.bootstrapKey !== env.BOOTSTRAP_ADMIN_KEY) {
    throw new ApiError(403, "Invalid bootstrap key");
  }

  const existingAdmin = await UserModel.exists({ role: "admin" });
  if (existingAdmin) {
    throw new ApiError(409, "Admin already bootstrapped");
  }

  const existingEmail = await UserModel.exists({ email: input.email.toLowerCase() });
  if (existingEmail) {
    throw new ApiError(409, "User with this email already exists");
  }

  const user = await UserModel.create({
    name: input.name,
    email: input.email.toLowerCase(),
    password: input.password,
    role: "admin",
  });

  return toSafeUser(user);
};

export const createUser = async (input: CreateUserInput): Promise<AuthUser & { isActive: boolean }> => {
  const existingEmail = await UserModel.exists({ email: input.email.toLowerCase() });
  if (existingEmail) {
    throw new ApiError(409, "User with this email already exists");
  }

  const user = await UserModel.create({
    name: input.name,
    email: input.email.toLowerCase(),
    password: input.password,
    role: input.role,
  });

  return toSafeUser(user);
};

export const login = async (
  input: LoginInput,
  userAgent?: string,
  ipAddress?: string,
): Promise<{ user: AuthUser & { isActive: boolean } } & AuthTokens> => {
  const user = await UserModel.findOne({ email: input.email.toLowerCase() }).select("+password");
  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  if (!user.isActive) {
    throw new ApiError(403, "User account is deactivated");
  }

  const matches = await user.comparePassword(input.password);
  if (!matches) {
    throw new ApiError(401, "Invalid credentials");
  }

  const tokens = await issueTokens(user, userAgent, ipAddress);
  return {
    user: toSafeUser(user),
    ...tokens,
  };
};

export const rotateRefreshToken = async (
  refreshToken: string,
  userAgent?: string,
  ipAddress?: string,
): Promise<{ user: AuthUser & { isActive: boolean } } & AuthTokens> => {
  const decoded = verifyRefreshToken(refreshToken);
  const tokenHash = hashRefreshToken(refreshToken);

  const tokenDoc = await RefreshTokenModel.findOne({ tokenHash });
  if (!tokenDoc) {
    throw new ApiError(401, "Refresh token is invalid");
  }

  if (tokenDoc.revokedAt) {
    throw new ApiError(401, "Refresh token has already been revoked");
  }

  if (tokenDoc.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, "Refresh token has expired");
  }

  const user = await UserModel.findById(decoded.sub).select("+password");
  if (!user || !user.isActive) {
    throw new ApiError(401, "User no longer available");
  }

  tokenDoc.revokedAt = new Date();
  await tokenDoc.save();

  const tokens = await issueTokens(user, userAgent, ipAddress);
  tokenDoc.replacedByTokenHash = hashRefreshToken(tokens.refreshToken);
  await tokenDoc.save();

  return {
    user: toSafeUser(user),
    ...tokens,
  };
};

export const logout = async (refreshToken: string): Promise<void> => {
  const tokenHash = hashRefreshToken(refreshToken);
  const tokenDoc = await RefreshTokenModel.findOne({ tokenHash });
  if (!tokenDoc) {
    return;
  }

  tokenDoc.revokedAt = new Date();
  await tokenDoc.save();
};

export const getCurrentUser = async (userId: string): Promise<AuthUser & { isActive: boolean }> => {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return toSafeUser(user);
};