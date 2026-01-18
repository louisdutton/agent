import { createSignal, For, Show } from "solid-js";
import Markdown from "./Markdown";

const API_URL = "http://localhost:3001";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Session {
  id: string;
  cwd: string;
  messages: Message[];
  createdAt: Date;
}

export default function App() {
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
  const [input, setInput] = createSignal("");
  const [showSidebar, setShowSidebar] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal("");

  const activeSession = () => sessions().find(s => s.id === activeSessionId()) || null;

  const createSession = async () => {
    try {
      const res = await fetch(`${API_URL}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: "/Users/louis/projects/personal/agent" }),
      });
      const data = await res.json();

      const session: Session = {
        id: data.id,
        cwd: data.cwd,
        messages: [],
        createdAt: new Date(data.createdAt),
      };

      setSessions([session, ...sessions()]);
      setActiveSessionId(session.id);
      setShowSidebar(false);
    } catch (err) {
      console.error("Failed to create session:", err);
    }
  };

  const sendMessage = async () => {
    const text = input().trim();
    const session = activeSession();
    if (!text || !session || isLoading()) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    // Add user message
    setSessions(sessions().map(s =>
      s.id === session.id
        ? { ...s, messages: [...s.messages, userMessage] }
        : s
    ));
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    try {
      const res = await fetch(`${API_URL}/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              // Handle assistant message
              if (parsed.type === "assistant" && parsed.message?.content) {
                for (const block of parsed.message.content) {
                  if (block.type === "text") {
                    assistantContent = block.text;
                    setStreamingContent(assistantContent);
                  }
                }
              }

              // Handle final result
              if (parsed.type === "result" && parsed.result) {
                assistantContent = parsed.result;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      // Add assistant message
      if (assistantContent) {
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date(),
        };

        setSessions(sessions().map(s =>
          s.id === session.id
            ? { ...s, messages: [...s.messages, assistantMessage] }
            : s
        ));
      }
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  };

  return (
    <div class="h-dvh flex flex-col bg-background">
      {/* Header */}
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <button class="p-2 -ml-2" onClick={() => setShowSidebar(!showSidebar())}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="text-sm text-muted-foreground truncate max-w-[200px]">
          {activeSession()?.cwd.split("/").pop() || "Claude"}
        </span>
        <button class="p-2 -mr-2" onClick={createSession}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </header>

      {/* Sidebar */}
      <Show when={showSidebar()}>
        <div class="fixed inset-0 z-50 flex">
          <div class="absolute inset-0 bg-black/80" onClick={() => setShowSidebar(false)} />
          <aside class="relative w-64 max-w-[80vw] bg-background h-full overflow-y-auto">
            <div class="p-3 border-b border-border">
              <button class="btn w-full text-sm" onClick={createSession}>
                New Session
              </button>
            </div>
            <div class="p-2">
              <For each={sessions()}>
                {(session) => (
                  <button
                    class={`w-full text-left px-3 py-2 rounded-lg mb-1 text-sm ${
                      activeSessionId() === session.id ? "bg-muted" : ""
                    }`}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      setShowSidebar(false);
                    }}
                  >
                    <div class="truncate">{session.cwd.split("/").pop()}</div>
                    <div class="text-xs text-muted-foreground">
                      {session.messages.length} msgs
                    </div>
                  </button>
                )}
              </For>
              <Show when={sessions().length === 0}>
                <p class="text-center text-muted-foreground text-xs py-8">
                  No sessions
                </p>
              </Show>
            </div>
          </aside>
        </div>
      </Show>

      {/* Main content */}
      <main class="flex-1 overflow-y-auto">
        <Show
          when={activeSession()}
          fallback={
            <div class="h-full flex flex-col items-center justify-center p-6">
              <p class="text-muted-foreground text-sm mb-4">No active session</p>
              <button class="btn text-sm" onClick={createSession}>
                New Session
              </button>
            </div>
          }
        >
          <div class="p-3 space-y-3">
            <For each={activeSession()!.messages}>
              {(message) => (
                <div class={message.role === "user" ? "ml-8" : "mr-4"}>
                  {message.role === "assistant" ? (
                    <Markdown content={message.content} />
                  ) : (
                    <div class="card text-sm">{message.content}</div>
                  )}
                </div>
              )}
            </For>

            <Show when={streamingContent()}>
              <div class="mr-4">
                <Markdown content={streamingContent()} />
              </div>
            </Show>

            <Show when={isLoading() && !streamingContent()}>
              <div class="text-muted-foreground text-sm">...</div>
            </Show>
          </div>
        </Show>
      </main>

      {/* Input */}
      <Show when={activeSession()}>
        <div class="p-3 border-t border-border">
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <input
              type="text"
              class="input flex-1 text-sm"
              placeholder="Message..."
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              disabled={isLoading()}
            />
            <button type="submit" class="btn px-3" disabled={!input().trim() || isLoading()}>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </form>
        </div>
      </Show>
    </div>
  );
}
