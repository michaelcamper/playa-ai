import path from "path";
import { createEnv } from "@t3-oss/env-core";
import dotenv from "dotenv";
import { z } from "zod";

// Load .env file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const env = createEnv({
  server: {
    // Service Configuration
    LLM_HOST: z.string(),
    LLM_PORT: z.string(),
    SPEECH_HOST: z.string(),
    SPEECH_PORT: z.string(),

    // App Configuration
    INTENT_CLI: z.string().optional(),
  },
  client: {},
  clientPrefix: "",
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
