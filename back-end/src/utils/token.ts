import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import type { JwtPayload } from "../types/auth";

type TokenIdentity = Omit<JwtPayload, "type">;

export const signAccessToken = (identity: TokenIdentity): string => {
  return jwt.sign(
    {
      ...identity,
      type: "access",
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_EXPIRES_IN as SignOptions["expiresIn"],
    },
  );
};

export const signRefreshToken = (identity: TokenIdentity): string => {
  return jwt.sign(
    {
      ...identity,
      type: "refresh",
    },
    env.JWT_REFRESH_SECRET,
    {
      expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions["expiresIn"],
    },
  );
};

export const verifyAccessToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
  if (payload.type !== "access") {
    throw new Error("Invalid access token type");
  }
  return payload;
};

export const verifyRefreshToken = (token: string): JwtPayload => {
  const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
  if (payload.type !== "refresh") {
    throw new Error("Invalid refresh token type");
  }
  return payload;
};