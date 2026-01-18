import { createSignal, For, Show } from "solid-js";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface Session {
  id: string;
  name: string;
  messages: Message[];
  createdAt: Date;
}

export default function App() {
  const [sessions, setSessions] = createSignal<Session[]>([]);
  const [activeSession, setActiveSession] = createSignal<Session | null>(null);
  const [input, setInput] = createSignal("");
  const [showSidebar, setShowSidebar] = createSignal(false);

  const createSession = () => {
    const session: Session = {
      id: crypto.randomUUID(),
      name: `Session ${sessions().length + 1}`,
      messages: [],
      createdAt: new Date(),
    };
    setSessions([session, ...sessions()]);
    setActiveSession(session);
    setShowSidebar(false);
  };

  const sendMessage = () => {
    const text = input().trim();
    if (!text || !activeSession()) return;

    const message: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };

    const updated = {
      ...activeSession()!,
      messages: [...activeSession()!.messages, message],
    };

    setActiveSession(updated);
    setSessions(sessions().map((s) => (s.id === updated.id ? updated : s)));
    setInput("");

    // TODO: Connect to Claude Code CLI backend
  };

  return (
    <div class="h-dvh flex flex-col bg-background">
      {/* Header */}
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <button
          class="p-2 -ml-2 rounded-lg hover:bg-muted"
          onClick={() => setShowSidebar(!showSidebar())}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 class="font-semibold">
          {activeSession()?.name || "Claude Code"}
        </h1>
        <button class="p-2 -mr-2 rounded-lg hover:bg-muted" onClick={createSession}>
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </header>

      {/* Sidebar */}
      <Show when={showSidebar()}>
        <div class="fixed inset-0 z-50 flex">
          <div class="absolute inset-0 bg-black/50" onClick={() => setShowSidebar(false)} />
          <aside class="relative w-72 max-w-[80vw] bg-background border-r border-border h-full overflow-y-auto">
            <div class="p-4 border-b border-border">
              <button class="btn w-full" onClick={createSession}>
                New Session
              </button>
            </div>
            <div class="p-2">
              <For each={sessions()}>
                {(session) => (
                  <button
                    class={`w-full text-left px-3 py-2 rounded-lg mb-1 transition-colors ${
                      activeSession()?.id === session.id
                        ? "bg-primary/20 text-primary"
                        : "hover:bg-muted"
                    }`}
                    onClick={() => {
                      setActiveSession(session);
                      setShowSidebar(false);
                    }}
                  >
                    <div class="font-medium truncate">{session.name}</div>
                    <div class="text-xs text-muted-foreground">
                      {session.messages.length} messages
                    </div>
                  </button>
                )}
              </For>
              <Show when={sessions().length === 0}>
                <p class="text-center text-muted-foreground text-sm py-8">
                  No sessions yet
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
            <div class="h-full flex flex-col items-center justify-center p-8 text-center">
              <div class="w-16 h-16 mb-4 rounded-2xl bg-primary/20 flex items-center justify-center">
                <svg class="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <h2 class="text-xl font-semibold mb-2">Claude Code</h2>
              <p class="text-muted-foreground mb-6 max-w-xs">
                Mobile interface for managing Claude Code sessions
              </p>
              <button class="btn" onClick={createSession}>
                Start New Session
              </button>
            </div>
          }
        >
          <div class="p-4 space-y-4">
            <For each={activeSession()!.messages}>
              {(message) => (
                <div
                  class={`card ${
                    message.role === "user" ? "ml-8 bg-primary/10" : "mr-8"
                  }`}
                >
                  <div class="text-xs text-muted-foreground mb-1">
                    {message.role === "user" ? "You" : "Claude"}
                  </div>
                  <div class="whitespace-pre-wrap">{message.content}</div>
                </div>
              )}
            </For>
            <Show when={activeSession()!.messages.length === 0}>
              <p class="text-center text-muted-foreground py-8">
                Send a message to start
              </p>
            </Show>
          </div>
        </Show>
      </main>

      {/* Input */}
      <Show when={activeSession()}>
        <div class="p-4 border-t border-border">
          <form
            class="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <input
              type="text"
              class="input flex-1"
              placeholder="Type a message..."
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
            />
            <button type="submit" class="btn" disabled={!input().trim()}>
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      </Show>
    </div>
  );
}
