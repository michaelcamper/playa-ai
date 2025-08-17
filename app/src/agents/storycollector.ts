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

export function buildStoryCollector() {
  const llm = buildChatModel({ temperature: 0.3 });
  const system = new SystemMessage(
    "You collect short, factual details from the user in a friendly tone. Ask one clarifying question if needed.",
  );

  return new StateGraph(AgentStateAnnotation)
    .addNode("collect", async (state: typeof AgentStateAnnotation.State) => {
      const msgs = state.messages ?? [];
      const last = msgs[msgs.length - 1] as BaseMessage | undefined;
      const lastText = last?.content as string | undefined;
      const prompt = ChatPromptTemplate.fromMessages([
        system,
        new HumanMessage(lastText ?? "What is your story idea?"),
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
          throw new Error("Story collection was interrupted");
        }
        throw error;
      }
    })
    .addEdge(START, "collect")
    .addEdge("collect", END)
    .compile({ checkpointer: new MemorySaver() });
}
