# Workflow

## Minimal Flow (`minimal-flow.ts`)

A simple, streamlined conversation flow that:

1. **Opens speech server** when hinge is activated
2. **Speaks welcome message** to user
3. **Listens for user input** continuously
4. **Posts user input to LLM** and gets response
5. **Speaks LLM response** back to user
6. **Repeats** the listen-respond cycle
7. **Stops** when hinge is deactivated

### Key Features

- **Simple conversation loop**: No complex intent classification or routing
- **Direct LLM interaction**: User input goes directly to LLM for response
- **Continuous listening**: Keeps listening for new input after each response
- **Graceful interruption**: Stops cleanly when hinge is closed
- **Error handling**: Continues conversation even if individual interactions fail
- **Conversation history**: Stores full conversation for analytics
- **Context-aware responses**: Sends last N messages to LLM for better context
- **Detailed logging**: Comprehensive conversation analytics and metrics

### Conversation History & Context

The flow maintains a complete conversation history and sends the most recent messages to the LLM for context:

- **Full history storage**: All user inputs and AI responses are stored
- **Context window**: Configurable number of recent messages sent to LLM (default: 10)
- **Analytics logging**: Detailed logs for each conversation turn
- **Session metrics**: Duration, message count, and timing information

### Configuration

```typescript
const CONVERSATION_CONFIG = {
  maxContextMessages: 10, // Context window size
  enableDetailedLogging: true, // Enable analytics logging
  logToFile: false, // Future: file logging
} as const;
```

### Analytics Output

The system provides rich analytics including:

- Turn-by-turn conversation logs
- Context window usage
- Session duration and timing
- Total message counts
- Session completion summaries

### Usage

The minimal flow is automatically triggered when the hinge is activated in `app/src/index.ts`. It replaces the complex `welcomeAndRoute` workflow with a simple, focused conversation experience that maintains context and provides analytics.

## Legacy Flow (`flow.ts`)

The original complex workflow with intent classification, multiple agents, and CLI menus. Kept for reference but no longer used by default.
