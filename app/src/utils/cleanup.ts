import { cleanupSpeech } from "../api/speech";
import { cleanupLLMInstances } from "../llm/chat";
import { isWorkflowRunning, stopWorkflow } from "../workflow/state";
import { activity } from "./activity";

// Global references to track active langchain operations
let activeAbortController: AbortController | null = null;
let activeLangchainOperations: Set<Promise<any>> = new Set();

/**
 * Cleanup function to properly terminate langchain pipeline operations
 * This ensures all active agents, chains, and connections are properly closed
 */
export async function cleanupLangchain(): Promise<void> {
  try {
    activity("cleanup", "start");

    // 1. Stop the workflow if it's running
    if (isWorkflowRunning()) {
      activity("cleanup", "stopping_workflow");
      stopWorkflow();
    }

    // 2. Abort any ongoing langchain operations
    if (activeAbortController) {
      activity("cleanup", "aborting_operations");
      activeAbortController.abort();
      activeAbortController = null;
    }

    // 3. Wait for all active operations to complete or timeout
    if (activeLangchainOperations.size > 0) {
      activity("cleanup", "waiting_for_operations", {
        count: activeLangchainOperations.size,
      });

      const timeoutPromise = new Promise((resolve) =>
        setTimeout(resolve, 5000),
      ); // 5 second timeout
      const operationsPromise = Promise.allSettled(
        Array.from(activeLangchainOperations),
      );

      await Promise.race([operationsPromise, timeoutPromise]);
      activeLangchainOperations.clear();
    }

    // 4. Clean up any remaining langchain resources
    await cleanupLangchainResources();

    // 5. Clean up speech operations
    await cleanupSpeech();

    // 6. Save logs
    await saveLogs();

    activity("cleanup", "complete");
  } catch (error) {
    activity("cleanup", "error", { error: String(error) });
    console.error("Error during langchain cleanup:", error);
  }
}

/**
 * Clean up langchain-specific resources
 */
async function cleanupLangchainResources(): Promise<void> {
  try {
    activity("cleanup", "cleanup_resources:start");

    // Clean up LLM instances
    await cleanupLLMInstances();

    // TODO: Implement additional cleanup when full langchain pipeline is active
    // This would include:
    // - Cleaning up agent checkpoints
    // - Terminating any streaming operations
    // - Clearing memory and caches

    activity("cleanup", "cleanup_resources:complete");
  } catch (error) {
    activity("cleanup", "cleanup_resources:error", { error: String(error) });
    console.error("Error cleaning up langchain resources:", error);
  }
}

/**
 * Save conversation logs and state for future reference
 */
async function saveLogs(): Promise<void> {
  try {
    activity("cleanup", "save_logs:start");

    // TODO: Implement log saving logic
    // This could save to a file, database, or cloud storage

    activity("cleanup", "save_logs:complete");
  } catch (error) {
    activity("cleanup", "save_logs:error", { error: String(error) });
    console.error("Error saving logs:", error);
  }
}

/**
 * Register an active langchain operation for cleanup tracking
 */
export function registerLangchainOperation<T>(
  operation: Promise<T>,
): Promise<T> {
  activeLangchainOperations.add(operation);

  // Remove from tracking when operation completes
  operation.finally(() => {
    activeLangchainOperations.delete(operation);
  });

  return operation;
}

/**
 * Create a new abort controller for langchain operations
 */
export function createAbortController(): AbortController {
  // Clean up previous controller if it exists
  if (activeAbortController) {
    activeAbortController.abort();
  }

  activeAbortController = new AbortController();
  return activeAbortController;
}

/**
 * Get the current active abort controller
 */
export function getActiveAbortController(): AbortController | null {
  return activeAbortController;
}
