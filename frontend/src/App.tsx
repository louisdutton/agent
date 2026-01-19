import { createSignal, For, Show } from "solid-js";
import Markdown from "./Markdown";

const API_URL = `http://${window.location.hostname}:3001`;

let msgId = 0;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export default function App() {
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [input, setInput] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal("");

  const sendMessage = async () => {
    const text = input().trim();
    if (!text || isLoading()) return;

    const userMessage: Message = {
      id: String(++msgId),
      role: "user",
      content: text,
    };

    setMessages([...messages(), userMessage]);
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    try {
      const res = await fetch(`${API_URL}/messages`, {
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

              // Handle streaming text deltas
              if (parsed.type === "stream_event" && parsed.event) {
                const event = parsed.event;
                if (
                  event.type === "content_block_delta" &&
                  event.delta?.type === "text_delta"
                ) {
                  assistantContent += event.delta.text;
                  setStreamingContent(assistantContent);
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
          id: String(++msgId),
          role: "assistant",
          content: assistantContent,
        };
        setMessages([...messages(), assistantMessage]);
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
      <main class="flex-1 overflow-y-auto p-4 mask-fade">
        <div class="max-w-2xl mx-auto space-y-4 w-full">
          <For each={messages()}>
            {(message) => (
              <div class={message.role === "user" ? "flex justify-end" : ""}>
                {message.role === "assistant" ? (
                  <Markdown content={message.content} />
                ) : (
                  <div class="p-3 rounded-lg bg-foreground text-background w-fit max-w-[80%] pop-in">
                    {message.content}
                  </div>
                )}
              </div>
            )}
          </For>

          <Show when={streamingContent()}>
            <div>
              <Markdown content={streamingContent()} />
            </div>
          </Show>

          <Show when={isLoading() && !streamingContent()}>
            <div class="text-muted-foreground">...</div>
          </Show>
        </div>
      </main>

      {/* Input */}
      <form
        class="max-w-2xl mx-auto flex gap-2 w-full py-4 px-2"
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
      >
        <input
          type="text"
          class="input flex-1"
          placeholder="Message..."
          value={input()}
          onInput={(e) => setInput(e.currentTarget.value)}
          disabled={isLoading()}
        />
        <button
          type="submit"
          class="btn px-4"
          disabled={!input().trim() || isLoading()}
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M5 12h14M12 5l7 7-7 7"
            />
          </svg>
        </button>
      </form>
    </div>
  );
}
