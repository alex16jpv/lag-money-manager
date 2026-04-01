import mongoose from "mongoose";
import { ENVIRONMENT } from "../shared/constants";
import logger from "../shared/logger";

export async function connectMongo(): Promise<void> {
  const uri = (ENVIRONMENT as { MONGO_URI: string }).MONGO_URI;
  await mongoose.connect(uri);
  logger.info("Connected to MongoDB");
}
