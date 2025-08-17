import { close, open } from "./api/speech";

import "./env";

import { hingeSwitch$ } from "./io/hinge";
import { cleanupLangchain } from "./utils/cleanup";
import { welcomeAndRoute } from "./workflow/flow";

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  try {
    // Clean up langchain pipeline
    // await cleanupLangchain();
    console.log("Langchain cleanup completed");
  } catch (error) {
    console.error("Error during cleanup:", error);
  }

  console.log("Graceful shutdown completed");
  process.exit(0);
}

// Handle process termination signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGQUIT", () => gracefulShutdown("SIGQUIT"));

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  console.error("Uncaught Exception:", error);
  await gracefulShutdown("uncaughtException");
});

// Handle unhandled promise rejections
process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  await gracefulShutdown("unhandledRejection");
});

hingeSwitch$().subscribe(async (active) => {
  if (active) {
    open();
    welcomeAndRoute();
  } else {
    close();
    await cleanupLangchain();
  }
});
