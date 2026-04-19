import mongoose from "mongoose";
import { env } from "./env";

export const connectDatabase = async (): Promise<void> => {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI);
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
};