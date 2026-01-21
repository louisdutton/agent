import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import Markdown from "./Markdown";

const API_URL = "";

type ToolStatus = "running" | "complete" | "error";

type Tool = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  status: ToolStatus;
};

type EventItem =
  | { type: "user"; id: string; content: string }
  | { type: "assistant"; id: string; content: string }
  | { type: "tools"; id: string; tools: Tool[] }
  | { type: "error"; id: string; message: string };

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
      return String(input.file_path || "")
        .split("/")
        .slice(-2)
        .join("/");
    case "Edit":
    case "Write":
      return String(input.file_path || "")
        .split("/")
        .slice(-2)
        .join("/");
    case "Bash": {
      const cmd = String(input.command || "");
      return cmd.length > 50 ? `${cmd.slice(0, 50)}...` : cmd;
    }
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `${input.pattern || ""} ${input.path ? `in ${String(input.path).split("/").pop()}` : ""}`;
    case "Task":
      return String(input.description || input.prompt || "").slice(0, 40);
    case "WebFetch":
      return String(input.url || "")
        .replace(/^https?:\/\//, "")
        .slice(0, 40);
    case "WebSearch":
      return String(input.query || "");
    default:
      if (input.file_path)
        return String(input.file_path).split("/").pop() || "";
      if (input.path) return String(input.path).split("/").pop() || "";
      if (input.command) return String(input.command).slice(0, 30);
      if (input.query) return String(input.query).slice(0, 30);
      return "";
  }
}

function ToolGroup(props: { tools: Tool[]; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? false);

  const allComplete = createMemo(() =>
    props.tools.every((t) => t.status === "complete"),
  );
  const hasError = createMemo(() =>
    props.tools.some((t) => t.status === "error"),
  );
  const runningCount = createMemo(
    () => props.tools.filter((t) => t.status === "running").length,
  );

  return (
    <div class="text-sm">
      <button
        type="button"
        class="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(!expanded())}
      >
        <span
          class={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${hasError()
              ? "bg-red-500"
              : allComplete()
                ? "bg-green-500"
                : "bg-yellow-500"
            }`}
        />
        <span>
          {runningCount() > 0
            ? `Running ${runningCount()} action${runningCount() > 1 ? "s" : ""}...`
            : `${props.tools.length} action${props.tools.length > 1 ? "s" : ""}`}
        </span>
        <svg
          class={`w-3 h-3 transition-transform ${expanded() ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      <Show when={expanded()}>
        <div class="ml-4 mt-1 space-y-1 border-l border-border pl-3">
          <For each={props.tools}>
            {(tool) => (
              <div class="flex items-start gap-2">
                <span
                  class={`inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${tool.status === "running"
                      ? "bg-yellow-500"
                      : tool.status === "error"
                        ? "bg-red-500"
                        : "bg-green-500"
                    }`}
                />
                <div class="min-w-0 flex-1">
                  <span class="font-mono text-muted-foreground">
                    {tool.name}
                  </span>
                  <span class="text-muted-foreground opacity-60 ml-2 break-all">
                    {getToolSummary(tool.name, tool.input)}
                  </span>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

export default function App() {
  const [events, setEvents] = createSignal<EventItem[]>([]);
  const [input, setInput] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [streamingContent, setStreamingContent] = createSignal("");
  const [isRecording, setIsRecording] = createSignal(false);
  const [isTranscribing, setIsTranscribing] = createSignal(false);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [showTextInput, setShowTextInput] = createSignal(false);

  let mainRef: HTMLElement | undefined;
  let idCounter = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let currentAudio: HTMLAudioElement | null = null;

  createEffect(() => {
    events();
    streamingContent();
    if (mainRef) {
      mainRef.scrollTop = mainRef.scrollHeight;
    }
  });

  const addEvent = (event: EventItem) => {
    setEvents((prev) => [...prev, event]);
  };

  const addOrUpdateToolGroup = (tool: Tool) => {
    setEvents((prev) => {
      const last = prev[prev.length - 1];
      if (last?.type === "tools") {
        return [
          ...prev.slice(0, -1),
          { ...last, tools: [...last.tools, tool] },
        ];
      }
      return [
        ...prev,
        { type: "tools", id: String(++idCounter), tools: [tool] },
      ];
    });
  };

  const updateToolStatus = (toolUseId: string, status: ToolStatus) => {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.type === "tools") {
          return {
            ...e,
            tools: e.tools.map((t) =>
              t.toolUseId === toolUseId ? { ...t, status } : t,
            ),
          };
        }
        return e;
      }),
    );
  };

  const markAllToolsComplete = () => {
    setEvents((prev) =>
      prev.map((e) => {
        if (e.type === "tools") {
          return {
            ...e,
            tools: e.tools.map((t) =>
              t.status === "running"
                ? { ...t, status: "complete" as ToolStatus }
                : t,
            ),
          };
        }
        return e;
      }),
    );
  };

  const startRecording = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Microphone requires HTTPS. Use 'bun serve' or localhost.");
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/mp4",
      });
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (audioChunks.length === 0) return;

        const audioBlob = new Blob(audioChunks, {
          type: mediaRecorder?.mimeType || "audio/webm",
        });
        await transcribeAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Mic access error:", err);
      alert("Could not access microphone. Check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder?.state === "recording") {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async (audioBlob: Blob) => {
    setIsTranscribing(true);
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");

      const res = await fetch(`${API_URL}/api/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) throw new Error("Transcription failed");

      const { text } = await res.json();
      if (text?.trim()) {
        setInput(text.trim());
      }
    } catch (err) {
      console.error("Transcription error:", err);
    } finally {
      setIsTranscribing(false);
    }
  };

  const playTTS = async (id: string, text: string) => {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    if (playingId() === id) {
      setPlayingId(null);
      setIsPlaying(false);
      return;
    }

    setPlayingId(id);
    setIsPlaying(true);
    try {
      const res = await fetch(`${API_URL}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error("TTS failed");

      const audioBlob = await res.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudio = new Audio(audioUrl);

      currentAudio.onended = () => {
        setPlayingId(null);
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
      };

      currentAudio.onerror = () => {
        setPlayingId(null);
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        currentAudio = null;
      };

      await currentAudio.play();
    } catch (err) {
      console.error("TTS error:", err);
      setPlayingId(null);
      setIsPlaying(false);
    }
  };

  const sendMessage = async () => {
    const text = input().trim();
    if (!text || isLoading()) return;

    addEvent({ type: "user", id: String(++idCounter), content: text });
    setInput("");
    setIsLoading(true);
    setStreamingContent("");

    try {
      const res = await fetch(`${API_URL}/api/messages`, {
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

              if (parsed.type === "assistant" && parsed.message?.content) {
                if (assistantContent) {
                  addEvent({
                    type: "assistant",
                    id: String(++idCounter),
                    content: assistantContent,
                  });
                  assistantContent = "";
                  setStreamingContent("");
                }

                for (const block of parsed.message.content) {
                  if (block.type === "tool_use") {
                    addOrUpdateToolGroup({
                      toolUseId: block.id,
                      name: block.name,
                      input: block.input || {},
                      status: "running",
                    });
                  }
                }
              }

              if (parsed.type === "user") {
                const content = parsed.message?.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === "tool_result" && block.tool_use_id) {
                      updateToolStatus(
                        block.tool_use_id,
                        block.is_error ? "error" : "complete",
                      );
                    }
                  }
                }
              }

              if (parsed.type === "result") {
                if (assistantContent) {
                  addEvent({
                    type: "assistant",
                    id: String(++idCounter),
                    content: assistantContent,
                  });
                  assistantContent = "";
                  setStreamingContent("");
                }

                markAllToolsComplete();

                if (parsed.subtype !== "success") {
                  addEvent({
                    type: "error",
                    id: String(++idCounter),
                    message: parsed.errors?.join(", ") || parsed.subtype,
                  });
                }
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }

      if (assistantContent && streamingContent()) {
        addEvent({
          type: "assistant",
          id: String(++idCounter),
          content: assistantContent,
        });
      }
    } catch (err) {
      addEvent({
        type: "error",
        id: String(++idCounter),
        message: String(err),
      });
    } finally {
      setIsLoading(false);
      setStreamingContent("");
    }
  };

  // Status helpers for mic button
  const status = () => {
    if (isRecording()) return "recording";
    if (isTranscribing()) return "transcribing";
    if (isLoading()) return "thinking";
    if (isPlaying()) return "speaking";
    return "idle";
  };

  const handleMicClick = () => {
    if (isRecording()) {
      stopRecording();
    } else if (isPlaying() && currentAudio) {
      currentAudio.pause();
      currentAudio = null;
      setPlayingId(null);
      setIsPlaying(false);
    } else if (!isLoading() && !isTranscribing()) {
      startRecording();
    }
  };

  // Auto-send after transcription
  createEffect(() => {
    const text = input();
    if (text && !isTranscribing() && !isLoading()) {
      setTimeout(() => {
        if (input().trim()) {
          sendMessage();
        }
      }, 100);
    }
  });

  return (
    <div class="h-dvh flex flex-col bg-background">
      {/* Scrollable chat history */}
      <main ref={mainRef} class="flex-1 overflow-y-auto p-4 mask-fade">
        <div class="max-w-2xl mx-auto space-y-4 w-full pb-4">
          <For each={events()}>
            {(event) => (
              <>
                {event.type === "user" && (
                  <div class="flex justify-end">
                    <div class="p-3 rounded-2xl bg-foreground text-background max-w-[85%]">
                      {event.content}
                    </div>
                  </div>
                )}

                {event.type === "assistant" && (
                  <div class="prose prose-sm max-w-none group relative">
                    <Markdown content={event.content} />
                    <button
                      type="button"
                      class="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-background border border-border hover:bg-muted"
                      onClick={() => playTTS(event.id, event.content)}
                    >
                      <svg
                        class="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        {playingId() === event.id ? (
                          <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                        ) : (
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.5 8.5l5-3.5v14l-5-3.5H4a1 1 0 01-1-1v-5a1 1 0 011-1h2.5z"
                          />
                        )}
                      </svg>
                    </button>
                  </div>
                )}

                {event.type === "tools" && (
                  <ToolGroup
                    tools={event.tools}
                    defaultExpanded={event.tools.some(
                      (t) => t.status === "running",
                    )}
                  />
                )}

                {event.type === "error" && (
                  <div class="text-sm text-red-500">{event.message}</div>
                )}
              </>
            )}
          </For>

          <Show when={streamingContent()}>
            <div class="prose prose-sm max-w-none">
              <Markdown content={streamingContent()} />
            </div>
          </Show>

          <Show when={isLoading() && !streamingContent()}>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span class="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              <span>Thinking...</span>
            </div>
          </Show>
        </div>
      </main>

      {/* Bottom controls */}
      <div class="flex flex-col items-center py-4 gap-3">
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isTranscribing() || isLoading()}
          class={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg ${status() === "recording"
              ? "bg-red-500 scale-110"
              : status() === "speaking"
                ? "bg-green-500"
                : status() === "thinking" || status() === "transcribing"
                  ? "bg-yellow-500"
                  : "bg-foreground hover:scale-105 active:scale-95"
            }`}
        >
          <svg
            class={`w-8 h-8 ${status() === "idle" ? "text-background" : "text-white"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {status() === "recording" ? (
              <rect
                x="6"
                y="6"
                width="12"
                height="12"
                rx="2"
                fill="currentColor"
              />
            ) : status() === "speaking" ? (
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.5 8.5l5-3.5v14l-5-3.5H4a1 1 0 01-1-1v-5a1 1 0 011-1h2.5z"
              />
            ) : (
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            )}
          </svg>
        </button>

        {/* Text input toggle */}
        <button
          type="button"
          onClick={() => setShowTextInput(!showTextInput())}
          class="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showTextInput() ? "Hide keyboard" : "Type instead"}
        </button>

        {/* Collapsible text input */}
        <Show when={showTextInput()}>
          <form
            class="flex gap-2 w-full max-w-md px-4"
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
              disabled={isLoading() || isTranscribing()}
            />
            <button
              type="submit"
              class="btn px-4"
              disabled={!input().trim() || isLoading() || isTranscribing()}
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
        </Show>
      </div>
    </div>
  );
}
