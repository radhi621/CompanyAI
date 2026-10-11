import { UserModel, type IUserDocument } from "../../models/User";
import type { AuthUser, UserRole } from "../../types/auth";
import { ApiError } from "../../utils/apiError";
import { revokeUserRefreshTokens } from "../auth/auth.service";

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ListUsersInput {
  role?: UserRole;
  isActive?: boolean;
  search?: string;
  limit: number;
}

interface UpdateUserInput {
  actor: AuthUser;
  userId: string;
  name?: string;
  role?: UserRole;
  isActive?: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toManagedUser(user: IUserDocument): ManagedUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function getUserOrThrow(userId: string): Promise<IUserDocument> {
  const user = await UserModel.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }
  return user;
}

export const usersService = {
  async list(input: ListUsersInput): Promise<ManagedUser[]> {
    const query: Record<string, unknown> = {};

    if (input.role) {
      query.role = input.role;
    }

    if (input.isActive !== undefined) {
      query.isActive = input.isActive;
    }

    if (input.search) {
      const pattern = new RegExp(escapeRegex(input.search), "i");
      query.$or = [{ name: pattern }, { email: pattern }];
    }

    const users = await UserModel.find(query).sort({ name: 1 }).limit(input.limit);
    return users.map(toManagedUser);
  },

  async update(input: UpdateUserInput): Promise<ManagedUser> {
    const user = await getUserOrThrow(input.userId);

    const nextRole = input.role ?? user.role;
    const nextActive = input.isActive ?? user.isActive;
    const losesAdminAccess = user.role === "admin" && user.isActive && (nextRole !== "admin" || !nextActive);

    if (losesAdminAccess) {
      // Guard against locking everyone out of user management.
      if (user._id.toString() === input.actor.id) {
        throw new ApiError(400, "You cannot demote or deactivate your own admin account");
      }

      const otherActiveAdmins = await UserModel.countDocuments({
        _id: { $ne: user._id },
        role: "admin",
        isActive: true,
      });
      if (otherActiveAdmins === 0) {
        throw new ApiError(409, "At least one active admin account is required");
      }
    }

    if (input.name !== undefined) {
      user.name = input.name;
    }
    user.role = nextRole;
    user.isActive = nextActive;
    await user.save();

    // A deactivated account must not be able to mint new access tokens.
    if (!nextActive) {
      await revokeUserRefreshTokens(user._id.toString());
    }

    return toManagedUser(user);
  },

  async resetPassword(userId: string, newPassword: string): Promise<ManagedUser> {
    const user = await getUserOrThrow(userId);
    user.password = newPassword;
    await user.save();

    // Sign the user out everywhere so the new password takes effect immediately.
    await revokeUserRefreshTokens(user._id.toString());
    return toManagedUser(user);
  },
};
