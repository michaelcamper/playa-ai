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

export function buildStoryTeller() {
  const llm = buildChatModel({ temperature: 0.7 });

  const system = new SystemMessage(
    "You are a witty, concise story-telling wizard. Keep responses short and playful.",
  );

  return new StateGraph(AgentStateAnnotation)
    .addNode("tell", async (state: typeof AgentStateAnnotation.State) => {
      const prompt = ChatPromptTemplate.fromMessages([
        system,
        new HumanMessage(
          typeof state.prompt === "string"
            ? state.prompt
            : "Tell me a short tale.",
        ),
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
          throw new Error("Story telling was interrupted");
        }
        throw error;
      }
    })
    .addEdge(START, "tell")
    .addEdge("tell", END)
    .compile({ checkpointer: new MemorySaver() });
}
