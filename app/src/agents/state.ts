import type { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (acc: BaseMessage[] = [], update: BaseMessage[] = []) => [
      ...acc,
      ...update,
    ],
    default: () => [],
  }),
  prompt: Annotation<string | undefined>(),
  intent: Annotation<string | undefined>(),
});

export type AgentState = typeof AgentStateAnnotation.State;
