# Agent Refactor Plan: Provider-Agnostic Implementation

Replace Claude CLI spawning with direct API calls, enabling parallel sessions and notifications.

## Current Problems

1. **Claude CLI dependency** - spawns `claude` binary for each message
2. **No parallelism** - one session at a time, no background work
3. **No notifications** - can't alert when sessions need attention
4. **Tight coupling** - locked to Claude Code's event format

## Goals

1. **Direct API calls** - use @anthropic-ai/sdk (and others) directly
2. **Parallel sessions** - multiple sessions across projects
3. **Push notifications** - alert when input needed
4. **Provider agnostic** - support Anthropic, OpenAI, etc.

---

## Architecture (inspired by Ghost)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Session Manager                          │
│  - Tracks all active sessions                                   │
│  - Emits notifications via WS                                   │
│  - Routes messages to correct session                           │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│   Session A   │     │   Session B   │     │   Session C   │
│  project: foo │     │  project: bar │     │  project: foo │
│  status: busy │     │  status: idle │     │  status: wait │
└───────────────┘     └───────────────┘     └───────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                        Agent Loop                              │
│  1. Send messages to LLM                                      │
│  2. Parse response (text, tool_calls)                         │
│  3. Execute tools (with approval if needed)                   │
│  4. Loop until done or input needed                           │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────────────┐
│                      Provider Layer                            │
│  - Anthropic (streaming, tool_use)                            │
│  - OpenAI (streaming, function_calling)                       │
│  - Common interface for all                                   │
└───────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/server/
├── agent/
│   ├── index.ts           # Re-exports
│   ├── types.ts           # Core types (Message, Tool, Session, etc.)
│   ├── session.ts         # Session state & history management
│   ├── session-manager.ts # Multi-session orchestration
│   ├── agent-loop.ts      # Turn execution logic
│   ├── context.ts         # Context window management, compaction
│   └── tools/
│       ├── index.ts       # Tool registry
│       ├── types.ts       # Tool interface
│       ├── bash.ts        # Shell execution
│       ├── read.ts        # File reading
│       ├── write.ts       # File writing
│       ├── glob.ts        # File search
│       ├── grep.ts        # Content search
│       └── ...
├── providers/
│   ├── index.ts           # Provider factory
│   ├── types.ts           # Provider interface
│   ├── anthropic.ts       # Anthropic implementation
│   └── openai.ts          # OpenAI implementation (future)
├── wire/
│   ├── types.ts           # Event types (like Ghost's wire protocol)
│   ├── emitter.ts         # Event emission to subscribers
│   └── transcript.ts      # JSONL persistence
└── routes/
    ├── sessions.ts        # Updated for new session model
    └── ...
```

---

## Core Types

### Provider Interface

```ts
// src/server/providers/types.ts

export type StreamChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: string }
  | { type: "tool_call_delta"; id: string; args: string }
  | { type: "usage"; input: number; output: number }
  | { type: "done" }
  | { type: "error"; error: string };

export type StreamCallback = (chunk: StreamChunk) => void;

export interface Provider {
  name: string;
  model: string;
  maxContextTokens: number;

  stream(
    messages: Message[],
    tools: ToolDefinition[],
    systemPrompt: string,
    callback: StreamCallback,
    signal?: AbortSignal,
  ): Promise<void>;

  countTokens(messages: Message[]): Promise<number>;
}
```

### Session & Messages

```ts
// src/server/agent/types.ts

export type MessageRole = "user" | "assistant" | "tool";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: string; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export type Message = {
  role: MessageRole;
  content: string | ContentPart[];
};

export type SessionStatus =
  | "idle"           // Ready for input
  | "running"        // Agent loop active
  | "waiting"        // Needs user input (approval, etc.)
  | "completed"      // Turn finished
  | "error";         // Error state

export type Session = {
  id: string;
  projectPath: string;
  status: SessionStatus;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  title?: string;

  // Runtime state
  abortController?: AbortController;
  pendingApproval?: ApprovalRequest;
};
```

### Wire Events (for streaming to client)

```ts
// src/server/wire/types.ts

export type WireEvent =
  | { type: "turn_begin"; sessionId: string }
  | { type: "turn_end"; sessionId: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolCallId: string; content: string; isError?: boolean }
  | { type: "status"; sessionId: string; status: SessionStatus }
  | { type: "approval_needed"; sessionId: string; request: ApprovalRequest }
  | { type: "error"; error: string }
  | { type: "usage"; inputTokens: number; outputTokens: number };
```

---

## Key Components

### 1. Provider: Anthropic

```ts
// src/server/providers/anthropic.ts

import Anthropic from "@anthropic-ai/sdk";

export function createAnthropicProvider(config: {
  apiKey?: string;
  model?: string;
}): Provider {
  const client = new Anthropic({ apiKey: config.apiKey });
  const model = config.model ?? "claude-sonnet-4-20250514";

  return {
    name: "anthropic",
    model,
    maxContextTokens: 200_000,

    async stream(messages, tools, systemPrompt, callback, signal) {
      const stream = client.messages.stream({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: toAnthropicMessages(messages),
        tools: toAnthropicTools(tools),
      }, { signal });

      for await (const event of stream) {
        // Map Anthropic events to our StreamChunk type
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            callback({ type: "text", text: event.delta.text });
          } else if (event.delta.type === "input_json_delta") {
            callback({ type: "tool_call_delta", id: currentToolId, args: event.delta.partial_json });
          }
        }
        // ... handle other event types
      }

      callback({ type: "done" });
    },

    async countTokens(messages) {
      const result = await client.messages.countTokens({
        model,
        messages: toAnthropicMessages(messages),
      });
      return result.input_tokens;
    },
  };
}
```

### 2. Agent Loop

```ts
// src/server/agent/agent-loop.ts

export async function runAgentLoop(
  session: Session,
  provider: Provider,
  tools: ToolRegistry,
  emit: (event: WireEvent) => void,
): Promise<void> {
  const maxSteps = 50;

  for (let step = 0; step < maxSteps; step++) {
    // Check context size, compact if needed
    const tokenCount = await provider.countTokens(session.messages);
    if (tokenCount > provider.maxContextTokens * 0.5) {
      await compactContext(session, provider);
    }

    // Stream LLM response
    const { text, toolCalls } = await streamStep(session, provider, emit);

    // Append assistant message
    session.messages.push({
      role: "assistant",
      content: buildAssistantContent(text, toolCalls),
    });

    // If no tool calls, we're done
    if (toolCalls.length === 0) {
      break;
    }

    // Execute tools
    for (const call of toolCalls) {
      const tool = tools.get(call.name);

      // Check approval if needed
      if (tool.requiresApproval) {
        session.status = "waiting";
        emit({ type: "approval_needed", sessionId: session.id, request: { ... } });

        // Wait for approval (or rejection)
        const approved = await waitForApproval(session);
        if (!approved) {
          // Add rejection result and continue
          session.messages.push({
            role: "tool",
            content: [{ type: "tool_result", toolUseId: call.id, content: "User rejected", isError: true }],
          });
          continue;
        }
      }

      session.status = "running";

      // Execute tool
      const result = await tool.execute(call.input, { workDir: session.projectPath });

      emit({ type: "tool_result", toolCallId: call.id, content: result.content, isError: result.isError });

      session.messages.push({
        role: "tool",
        content: [{ type: "tool_result", toolUseId: call.id, ...result }],
      });
    }
  }

  session.status = "completed";
  emit({ type: "turn_end", sessionId: session.id });
}
```

### 3. Session Manager

```ts
// src/server/agent/session-manager.ts

class SessionManager {
  private sessions = new Map<string, Session>();
  private subscribers = new Set<(event: WireEvent) => void>();

  // Create new session
  create(projectPath: string): Session { ... }

  // Get session by ID
  get(id: string): Session | undefined { ... }

  // List all sessions
  list(): Session[] { ... }

  // Send message to session (starts agent loop)
  async sendMessage(sessionId: string, message: string, images?: string[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // Add user message
    session.messages.push({ role: "user", content: buildUserContent(message, images) });
    session.status = "running";

    // Run agent loop (non-blocking)
    this.runInBackground(session);
  }

  // Respond to approval request
  async respondToApproval(sessionId: string, approved: boolean): Promise<void> { ... }

  // Cancel session
  cancel(sessionId: string): void { ... }

  // Subscribe to all events (for WS push)
  subscribe(callback: (event: WireEvent) => void): () => void { ... }

  // Emit event to all subscribers
  private emit(event: WireEvent): void {
    for (const cb of this.subscribers) cb(event);
  }
}

export const sessionManager = new SessionManager();
```

### 4. WebSocket Notifications

```ts
// src/server.ts (updated)

// On WS connect, subscribe to session events
websocket: {
  open(ws) {
    const unsubscribe = sessionManager.subscribe((event) => {
      // Filter to events that need notification
      if (event.type === "approval_needed" ||
          event.type === "status" ||
          event.type === "error") {
        ws.send(JSON.stringify(event));
      }
    });
    ws.data.unsubscribe = unsubscribe;
  },
  close(ws) {
    ws.data.unsubscribe?.();
  },
}
```

---

## Migration Path

### Phase 1: Provider Layer
1. Create `src/server/providers/` with types and Anthropic implementation
2. Test streaming independently

### Phase 2: Agent Loop
1. Create `src/server/agent/` with session and loop logic
2. Implement basic tools (read, write, bash, glob, grep)
3. Test single session end-to-end

### Phase 3: Session Manager
1. Multi-session support
2. WS notifications for status changes
3. Approval flow

### Phase 4: Client Updates
1. Session list showing all active sessions
2. Notifications when approval needed
3. Session switching

### Phase 5: Cleanup
1. Remove old `src/server/claude/`
2. Remove Claude CLI spawning
3. Update routes to use new session manager

---

## Tools to Implement

Priority order:
1. **read** - Read file contents
2. **write** - Write/create files
3. **bash** - Execute shell commands (requires approval)
4. **glob** - Find files by pattern
5. **grep** - Search file contents
6. **edit** - String replacement in files
7. **web_fetch** - HTTP requests (requires approval)

Each tool follows the interface:
```ts
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  requiresApproval: boolean;
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>;
}
```

---

## Configuration

```ts
// Config from env or ~/.agent/config.json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "anthropic": {
    "apiKey": "sk-ant-..." // or use ANTHROPIC_API_KEY env
  },
  "tools": {
    "bash": { "requiresApproval": true },
    "write": { "requiresApproval": false },
    "web_fetch": { "requiresApproval": true }
  },
  "maxStepsPerTurn": 50,
  "contextCompactionThreshold": 0.5
}
```

---

## Decisions

1. **Context persistence** - JSONL (like Ghost)
2. **Tool approval UX** - Colocated with input area (not modal)
3. **System prompt** - AGENTS.md support (per-project instructions)
4. **MCP support** - Later phase
