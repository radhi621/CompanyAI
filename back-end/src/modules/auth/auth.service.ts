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

const REFRESH_REUSE_GRACE_MS = 30 * 1000;

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

/**
 * Whether the one-time setup (creating the first admin) still has to be done. Only
 * reveals that no admin exists yet, which the setup screen needs to know.
 */
export const getSetupStatus = async (): Promise<{ needsSetup: boolean }> => {
  const adminExists = await UserModel.exists({ role: "admin" });
  return { needsSetup: !adminExists };
};

export const bootstrapAdmin = async (input: BootstrapAdminInput): Promise<AuthUser & { isActive: boolean }> => {
  if (input.bootstrapKey !== env.BOOTSTRAP_ADMIN_KEY) {
    throw new ApiError(403, "Invalid setup key");
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
    // A token that was rotated away is being presented again. Outside a short grace
    // window (two tabs refreshing at the same moment) that means a copy of it leaked,
    // so end every session for this user and force a fresh login.
    const rotatedAgoMs = Date.now() - tokenDoc.revokedAt.getTime();
    if (tokenDoc.replacedByTokenHash && rotatedAgoMs > REFRESH_REUSE_GRACE_MS) {
      await revokeUserRefreshTokens(tokenDoc.userId.toString());
      console.warn(`[auth] Refresh token reuse detected for user ${tokenDoc.userId}; all sessions revoked`);
      throw new ApiError(401, "Session ended for security reasons. Please log in again.");
    }

    throw new ApiError(401, "Refresh token has already been revoked");
  }

  if (tokenDoc.expiresAt.getTime() < Date.now()) {
    throw new ApiError(401, "Refresh token has expired");
  }

  const user = await UserModel.findById(decoded.sub).select("+password");
  if (!user || !user.isActive) {
    throw new ApiError(401, "User no longer available");
  }

  // Claim the token atomically so two concurrent refreshes cannot both rotate it.
  const claimed = await RefreshTokenModel.updateOne(
    { _id: tokenDoc._id, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  if (claimed.modifiedCount === 0) {
    throw new ApiError(401, "Refresh token has already been revoked");
  }

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

/**
 * Revokes all of a user's active refresh tokens, optionally keeping one (the caller's
 * current session). Used when an account is deactivated or its password changes.
 */
export const revokeUserRefreshTokens = async (userId: string, exceptRefreshToken?: string): Promise<void> => {
  const filter: Record<string, unknown> = {
    userId: new Types.ObjectId(userId),
    revokedAt: { $exists: false },
  };

  if (exceptRefreshToken) {
    filter.tokenHash = { $ne: hashRefreshToken(exceptRefreshToken) };
  }

  await RefreshTokenModel.updateMany(filter, { $set: { revokedAt: new Date() } });
};

export const changeOwnPassword = async (input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  currentRefreshToken?: string;
}): Promise<void> => {
  const user = await UserModel.findById(input.userId).select("+password");
  if (!user || !user.isActive) {
    throw new ApiError(404, "User not found");
  }

  const matches = await user.comparePassword(input.currentPassword);
  if (!matches) {
    throw new ApiError(400, "Current password is incorrect");
  }

  if (input.currentPassword === input.newPassword) {
    throw new ApiError(400, "New password must be different from the current password");
  }

  user.password = input.newPassword;
  await user.save();

  // Sign out every other session; the session making this request stays signed in.
  await revokeUserRefreshTokens(input.userId, input.currentRefreshToken);
};

export const getCurrentUser = async (userId: string): Promise<AuthUser & { isActive: boolean }> => {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return toSafeUser(user);
};