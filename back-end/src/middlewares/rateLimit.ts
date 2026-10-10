import type { Request } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../config/env";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

// Failed logins only: successful sign-ins do not consume the budget.
export const loginRateLimit = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many failed login attempts. Try again in 15 minutes." },
});

export const bootstrapAdminRateLimit = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many bootstrap attempts. Try again later." },
});

export const refreshRateLimit = rateLimit({
  windowMs: FIFTEEN_MINUTES_MS,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many token refresh requests. Try again later." },
});

// The AI routes below share one Gemini/Groq quota, so one user (or one script) must not be
// able to spend it for everyone. They run after authenticate, so they count per user.
const ONE_MINUTE_MS = 60 * 1000;

function perUser(req: Request): string {
  return req.user?.id ?? "anonymous";
}

export const agentRateLimit = rateLimit({
  windowMs: ONE_MINUTE_MS,
  limit: () => env.AGENT_RATE_LIMIT_PER_MINUTE,
  keyGenerator: perUser,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many assistant requests. Wait a minute and try again." },
});

export const aiRecordRateLimit = rateLimit({
  windowMs: ONE_HOUR_MS,
  limit: () => env.AI_RECORD_RATE_LIMIT_PER_HOUR,
  keyGenerator: perUser,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many AI record uploads or generations. Try again later." },
});
