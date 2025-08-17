import type { RunnableConfig } from "@langchain/core/runnables";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { AgentStateAnnotation } from "./state";

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
        const result = await agent.invoke(state);
        return result;
      })
      .addEdge(START, "route")
      .addEdge("route", END)
      .compile({ checkpointer: new MemorySaver() });
  }
}
