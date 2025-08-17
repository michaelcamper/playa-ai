import {
  BaseMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { END, MemorySaver, START, StateGraph } from "@langchain/langgraph";

import { buildChatModel } from "../llm/chat";
import { AgentStateAnnotation } from "./state";

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
      const ai = await chain.invoke({});
      return { messages: [ai as BaseMessage] };
    })
    .addEdge(START, "collect")
    .addEdge("collect", END)
    .compile({ checkpointer: new MemorySaver() });
}
