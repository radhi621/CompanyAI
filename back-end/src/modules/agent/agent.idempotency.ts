import crypto from "crypto";
import { Types } from "mongoose";
import { env } from "../../config/env";
import {
  AgentIdempotencyModel,
  type AgentIdempotencyScope,
  type IAgentIdempotencyDocument,
} from "../../models/AgentIdempotency";
import { ApiError } from "../../utils/apiError";

interface AcquireIdempotencyInput {
  actorId: string;
  scope: AgentIdempotencyScope;
  key?: string;
  requestPayload: unknown;
}

type AcquireIdempotencyResult =
  | { mode: "disabled" }
  | { mode: "replay"; responsePayload: unknown }
  | { mode: "acquired"; record: IAgentIdempotencyDocument };

const IDEMPOTENCY_KEY_REGEX = /^[a-zA-Z0-9:_\-.]{8,128}$/;

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item));
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
      .map(([key, nested]) => [key, sortObjectKeys(nested)] as const);

    return Object.fromEntries(entries);
  }

  return value;
}

function buildRequestHash(payload: unknown): string {
  const normalized = JSON.stringify(sortObjectKeys(payload));
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

function parseIdempotencyKey(key?: string): string | undefined {
  if (!key) {
    return undefined;
  }

  const normalized = key.trim();
  if (!normalized) {
    return undefined;
  }

  if (!IDEMPOTENCY_KEY_REGEX.test(normalized)) {
    throw new ApiError(
      400,
      "Invalid Idempotency-Key format. Use 8-128 characters: letters, numbers, colon, underscore, dash, or dot.",
    );
  }

  return normalized;
}

export const acquireIdempotency = async (
  input: AcquireIdempotencyInput,
): Promise<AcquireIdempotencyResult> => {
  const normalizedKey = parseIdempotencyKey(input.key);
  if (!normalizedKey) {
    return { mode: "disabled" };
  }

  const requestHash = buildRequestHash(input.requestPayload);
  const expiresAt = new Date(Date.now() + env.AGENT_IDEMPOTENCY_TTL_MINUTES * 60 * 1000);
  const actorObjectId = new Types.ObjectId(input.actorId);

  try {
    const record = await AgentIdempotencyModel.create({
      actorId: actorObjectId,
      scope: input.scope,
      key: normalizedKey,
      requestHash,
      status: "processing",
      expiresAt,
    });

    return {
      mode: "acquired",
      record,
    };
  } catch (error) {
    const duplicateKeyErrorCode = 11000;
    const maybeCode = (error as { code?: number }).code;
    if (maybeCode !== duplicateKeyErrorCode) {
      throw error;
    }

    const existing = await AgentIdempotencyModel.findOne({
      actorId: actorObjectId,
      scope: input.scope,
      key: normalizedKey,
    });

    if (!existing) {
      throw new ApiError(409, "Idempotency key conflict. Retry with a new key.");
    }

    if (existing.requestHash !== requestHash) {
      throw new ApiError(
        409,
        "Idempotency key was already used with a different request payload. Use a new key.",
      );
    }

    if (existing.status === "completed") {
      return {
        mode: "replay",
        responsePayload: existing.responsePayload,
      };
    }

    if (existing.status === "processing") {
      throw new ApiError(409, "A request with this idempotency key is already being processed.");
    }

    const reset = await AgentIdempotencyModel.findOneAndUpdate(
      {
        _id: existing._id,
        status: "failed",
      },
      {
        $set: {
          status: "processing",
          responsePayload: undefined,
          errorMessage: undefined,
          expiresAt,
        },
      },
      {
        new: true,
      },
    );

    if (!reset) {
      throw new ApiError(409, "A request with this idempotency key is already being processed.");
    }

    return {
      mode: "acquired",
      record: reset,
    };
  }
};

export const completeIdempotency = async (recordId: Types.ObjectId, payload: unknown): Promise<void> => {
  await AgentIdempotencyModel.updateOne(
    {
      _id: recordId,
    },
    {
      $set: {
        status: "completed",
        responsePayload: payload,
        errorMessage: undefined,
      },
    },
  );
};

export const failIdempotency = async (recordId: Types.ObjectId, errorMessage: string): Promise<void> => {
  await AgentIdempotencyModel.updateOne(
    {
      _id: recordId,
    },
    {
      $set: {
        status: "failed",
        responsePayload: undefined,
        errorMessage,
      },
    },
  );
};