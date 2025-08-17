import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { buildChatModel } from "../llm/chat";
import { AgentStateAnnotation } from "./state";
import { registerLangchainOperation, createAbortController } from "../utils/cleanup";

export function buildPlayaGuide() {
  const llm = buildChatModel({ temperature: 0.2 });
  const system = new SystemMessage(
    "You are a helpful Playa guide for Burning Man. Answer succinctly with practical tips.",
  );

  return new StateGraph(AgentStateAnnotation)
    .addNode("guide", async (state: typeof AgentStateAnnotation.State) => {
      const msgs = state.messages ?? [];
      const last = msgs[msgs.length - 1] as BaseMessage | undefined;
      const lastText = last?.content as string | undefined;
      const prompt = ChatPromptTemplate.fromMessages([
        system,
        new HumanMessage(lastText ?? "How can you help me prepare?"),
      ]);
      const chain = prompt.pipe(llm);
      
      // Create abort controller for this operation
      const abortController = createAbortController();
      
      const operation = chain.invoke({}, { signal: abortController.signal });
      
      // Register the operation for cleanup tracking
      const trackedOperation = registerLangchainOperation(operation);
      
      try {
        const ai = await trackedOperation;
        return { messages: [ai as BaseMessage] };
      } catch (error) {
        // Check if operation was aborted
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error("Playa guide was interrupted");
        }
        throw error;
      }
    })
    .addEdge(START, "guide")
    .addEdge("guide", END)
    .compile({ checkpointer: new MemorySaver() });
}
