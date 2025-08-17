import type { RunnableConfig } from "@langchain/core/runnables";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { AgentStateAnnotation } from "./state";
import { registerLangchainOperation, createAbortController } from "../utils/cleanup";

export interface CompiledAgentGraph {
  invoke(
    input: typeof AgentStateAnnotation.State,
    config?: RunnableConfig,
  ): Promise<typeof AgentStateAnnotation.State>;
}

type AgentGraph = CompiledAgentGraph;

export class CoordinatorBuilder {
  private readonly agents: Record<string, AgentGraph>;

  constructor(agents: Record<string, AgentGraph>) {
    this.agents = agents;
  }

  compile() {
    return new StateGraph(AgentStateAnnotation)
      .addNode("route", async (state: typeof AgentStateAnnotation.State) => {
        const intent = state.intent ?? "story_teller";
        const agent = this.agents[intent] ?? this.agents["story_teller"];
        
        // Create abort controller for this operation
        const abortController = createAbortController();
        
        const operation = agent.invoke(state, { signal: abortController.signal });
        
        // Register the operation for cleanup tracking
        const trackedOperation = registerLangchainOperation(operation);
        
        try {
          const result = await trackedOperation;
          return result;
        } catch (error) {
          // Check if operation was aborted
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error("Agent coordination was interrupted");
          }
          throw error;
        }
      })
      .addEdge(START, "route")
      .addEdge("route", END)
      .compile({ checkpointer: new MemorySaver() });
  }
}
