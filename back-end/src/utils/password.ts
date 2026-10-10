import bcrypt from "bcryptjs";

// Cheaper hashing in tests only; production keeps cost 12.
const SALT_ROUNDS = process.env.NODE_ENV === "test" ? 4 : 12;

export const hashPassword = async (rawPassword: string): Promise<string> => {
  return bcrypt.hash(rawPassword, SALT_ROUNDS);
};

export const comparePassword = async (
  rawPassword: string,
  hashedPassword: string,
): Promise<boolean> => {
  return bcrypt.compare(rawPassword, hashedPassword);
};