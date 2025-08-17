// Global reference to track if workflow is active
let isWorkflowActive = false;

/**
 * Check if the workflow is currently active
 */
export function isWorkflowRunning(): boolean {
  return isWorkflowActive;
}

/**
 * Set the workflow as active
 */
export function setWorkflowActive(active: boolean): void {
  isWorkflowActive = active;
}

/**
 * Force stop the workflow if it's running
 */
export function stopWorkflow(): void {
  isWorkflowActive = false;
}
