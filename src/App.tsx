import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import Markdown from "./Markdown";
import { GitDiffModal, GitStatusIndicator, useGitStatus } from "./Git";
import { SessionManagerModal } from "./SessionManager";

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
          class={`inline-block w-2 h-2 rounded-full shrink-0 ${hasError()
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
  const [showMenu, setShowMenu] = createSignal(false);
  const [showSessionModal, setShowSessionModal] = createSignal(false);

  // Git state
  const gitStatus = useGitStatus();
  const [showDiffModal, setShowDiffModal] = createSignal(false);
  const [audioLevels, setAudioLevels] = createSignal<number[]>([0, 0, 0, 0]);

  let mainRef: HTMLElement | undefined;
  let menuRef: HTMLDivElement | undefined;
  let idCounter = 0;
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let currentAudio: HTMLAudioElement | null = null;
  let abortController: AbortController | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let animationFrame: number | null = null;

  // Load chat history
  const loadHistory = async () => {
    try {
      const res = await fetch(`${API_URL}/api/history`);
      const { messages } = await res.json();
      setEvents(messages?.length ? messages : []);
      idCounter = messages?.length || 0;
    } catch (err) {
      console.error("Failed to load history:", err);
      setEvents([]);
      idCounter = 0;
    }
  };

  onMount(loadHistory);

  const handleCommit = () => {
    setShowDiffModal(false);
    setInput("Commit the current changes");
  };

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

      // Set up audio analyser for visualization
      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 32;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevels = () => {
        if (!analyser) return;
        analyser.getByteFrequencyData(dataArray);
        // Pick 4 frequency bands and normalize to 0-1
        const levels = [
          dataArray[1] / 255,
          dataArray[3] / 255,
          dataArray[5] / 255,
          dataArray[7] / 255,
        ];
        setAudioLevels(levels);
        animationFrame = requestAnimationFrame(updateLevels);
      };
      updateLevels();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        // Clean up audio visualizer
        if (animationFrame) cancelAnimationFrame(animationFrame);
        if (audioContext) audioContext.close();
        audioContext = null;
        analyser = null;
        animationFrame = null;
        setAudioLevels([0, 0, 0, 0]);

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

    abortController = new AbortController();

    try {
      const res = await fetch(`${API_URL}/api/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
        signal: abortController.signal,
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

              // Skip replayed messages - history is loaded from /api/history
              if (parsed.isReplay) continue;

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
      // Don't show error if request was aborted
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        addEvent({
          type: "error",
          id: String(++idCounter),
          message: String(err),
        });
      }
    } finally {
      setIsLoading(false);
      setStreamingContent("");
      abortController = null;
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

  const handleMicClick = async () => {
    if (isRecording()) {
      stopRecording();
    } else if (isLoading()) {
      // Cancel the AI response on both frontend and backend
      if (abortController) {
        abortController.abort();
      }
      // Tell the backend to cancel the Claude request
      try {
        await fetch(`${API_URL}/api/cancel`, { method: "POST" });
      } catch {
        // Ignore errors - the request may have already finished
      }
      setIsLoading(false);
      setStreamingContent("");
    } else if (isPlaying() && currentAudio) {
      currentAudio.pause();
      currentAudio = null;
      setPlayingId(null);
      setIsPlaying(false);
    } else if (!isTranscribing()) {
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

  // Close menu when clicking outside
  createEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef && !menuRef.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu()) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
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
                    <div class="px-4 py-2 rounded-xl bg-foreground text-background max-w-[85%]">
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
                          <rect
                            x="6"
                            y="6"
                            width="12"
                            height="12"
                            rx="2"
                            fill="currentColor"
                          />
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
      <div class="flex flex-col items-center pt-2 pb-6 gap-3">
        <div class="flex items-center justify-center gap-12 relative w-full">
          {/* Left buttons */}
          <div class="absolute left-4 flex items-center gap-2">
            {/* Options menu */}
            <div ref={menuRef} class="relative">
              <button
                type="button"
                onClick={() => setShowMenu(!showMenu())}
                class="p-2 rounded-lg bg-background border border-border hover:bg-muted transition-colors shadow-lg"
                title="Options"
              >
                <svg
                  class="w-5 h-5 text-muted-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                  />
                </svg>
              </button>

              <Show when={showMenu()}>
                <div class="absolute left-0 bottom-full mb-2 bg-background border border-border rounded-lg shadow-lg min-w-48">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSessionModal(true);
                      setShowMenu(false);
                    }}
                    class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm"
                  >
                    Manage Sessions
                  </button>
                </div>
              </Show>
            </div>

          </div>

          {/* Git status indicator on the right */}
          <GitStatusIndicator
            gitStatus={gitStatus()}
            onClick={() => setShowDiffModal(true)}
          />

          {/* Centered mic button */}
          <button
            type="button"
            onClick={handleMicClick}
            disabled={isTranscribing()}
            class={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg ${status() === "recording"
                ? "bg-foreground scale-110"
                : status() === "speaking"
                  ? "bg-green-500"
                  : status() === "thinking"
                    ? "bg-red-500 hover:scale-105 active:scale-95"
                    : status() === "transcribing"
                      ? "bg-yellow-500"
                      : "bg-foreground hover:scale-105 active:scale-95"
              }`}
          >
            {status() === "recording" ? (
              <div class="flex items-center justify-center gap-1 w-12 h-12 bg-white/20 rounded-full">
                <For each={audioLevels()}>
                  {(level) => (
                    <div
                      class="w-1.5 bg-black rounded-full transition-all duration-75"
                      style={{ height: `${8 + level * 24}px` }}
                    />
                  )}
                </For>
              </div>
            ) : (
            <svg
              class={`w-8 h-8 ${status() === "idle" ? "text-background" : "text-white"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {status() === "thinking" ? (
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
            )}
          </button>
        </div>

      </div>

      {/* Git Diff Modal */}
      <GitDiffModal
        show={showDiffModal()}
        onClose={() => setShowDiffModal(false)}
        onCommit={handleCommit}
      />

      {/* Session Manager Modal */}
      <SessionManagerModal
        show={showSessionModal()}
        onClose={() => setShowSessionModal(false)}
        onSwitch={(messages) => {
          setEvents(messages);
          idCounter = messages.length;
          setShowSessionModal(false);
        }}
        onNewSession={async () => {
          setShowSessionModal(false);
          await loadHistory();
        }}
      />
    </div>
  );
}
