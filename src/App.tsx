import {
	createEffect,
	createSignal,
	For,
	onMount,
	Show,
} from "solid-js";
import Markdown from "./Markdown";
import { FileBrowserModal, FileViewerModal, GitDiffModal, GitStatusIndicator, InlineDiffView, useGitStatus } from "./Git";
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

function ToolGroup(props: { tools: Tool[]; defaultExpanded?: boolean; onOpenFile?: (path: string) => void }) {
  // Check if tool has a file path that can be opened
  const getFilePath = (tool: Tool): string | null => {
    if (["Read", "Edit", "Write"].includes(tool.name) && tool.input.file_path) {
      return String(tool.input.file_path);
    }
    return null;
  };

  // Check if tool has diff content to show
  const getToolDiff = (tool: Tool): { filePath: string; oldContent?: string; newContent: string; isNewFile: boolean } | null => {
    if (tool.name === "Edit" && tool.input.file_path && tool.input.new_string) {
      return {
        filePath: String(tool.input.file_path),
        oldContent: tool.input.old_string ? String(tool.input.old_string) : undefined,
        newContent: String(tool.input.new_string),
        isNewFile: false,
      };
    }
    if (tool.name === "Write" && tool.input.file_path && tool.input.content) {
      return {
        filePath: String(tool.input.file_path),
        newContent: String(tool.input.content),
        isNewFile: true,
      };
    }
    return null;
  };

  return (
    <div class="text-sm space-y-2">
      <For each={props.tools}>
        {(tool) => {
          const filePath = getFilePath(tool);
          const diffData = getToolDiff(tool);
          return (
            <div>
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
                  {filePath && props.onOpenFile ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onOpenFile!(filePath);
                      }}
                      class="text-muted-foreground opacity-60 ml-2 break-all hover:text-foreground hover:opacity-100 transition-colors text-left"
                    >
                      {getToolSummary(tool.name, tool.input)}
                    </button>
                  ) : (
                    <span class="text-muted-foreground opacity-60 ml-2 break-all">
                      {getToolSummary(tool.name, tool.input)}
                    </span>
                  )}
                </div>
              </div>
              {/* Inline diff for Edit/Write tools */}
              <Show when={diffData}>
                <InlineDiffView
                  filePath={diffData!.filePath}
                  oldContent={diffData!.oldContent}
                  newContent={diffData!.newContent}
                  isNewFile={diffData!.isNewFile}
                />
              </Show>
            </div>
          );
        }}
      </For>
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
  const [pendingVoiceInput, setPendingVoiceInput] = createSignal(false);
  const [playingId, setPlayingId] = createSignal<string | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [showMenu, setShowMenu] = createSignal(false);
  const [showSessionModal, setShowSessionModal] = createSignal(false);
  const [cwd, setCwd] = createSignal("");
  const [isCompacting, setIsCompacting] = createSignal(false);
  const [isCompacted, setIsCompacted] = createSignal(false);
  const [showTextInput, setShowTextInput] = createSignal(false);
  const [sessionName, setSessionName] = createSignal("");

  // Git state
  const gitStatus = useGitStatus();
  const [showDiffModal, setShowDiffModal] = createSignal(false);
  const [audioLevels, setAudioLevels] = createSignal<number[]>([0, 0, 0, 0]);

  // File viewer state
  const [showFileBrowser, setShowFileBrowser] = createSignal(false);
  const [showFileViewer, setShowFileViewer] = createSignal(false);
  const [fileViewerPath, setFileViewerPath] = createSignal("");

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

  // Extract first user message from events as session name
  const getSessionNameFromEvents = (messages: EventItem[]) => {
    const firstUser = messages.find((m) => m.type === "user");
    if (firstUser && firstUser.type === "user") {
      const content = firstUser.content;
      return content.length > 50 ? content.slice(0, 50) + "..." : content;
    }
    return "";
  };

  // Load chat history and cwd
  const loadHistory = async (sessionId?: string | null) => {
    try {
      const storedSessionId = sessionId ?? localStorage.getItem("sessionId");
      if (storedSessionId) {
        const res = await fetch(`${API_URL}/api/session/${encodeURIComponent(storedSessionId)}/history`);
        const data = await res.json();
        const messages = data.messages?.length ? data.messages : [];
        setEvents(messages);
        setCwd(data.cwd || "");
        setIsCompacted(data.isCompacted || false);
        setSessionName(data.firstPrompt || getSessionNameFromEvents(messages));
        idCounter = messages.length || 0;
      } else {
        // No session stored - fetch cwd and check for latest session
        const res = await fetch(`${API_URL}/api/cwd`);
        const data = await res.json();
        setCwd(data.cwd || "");

        // If there's a latest session available, load it
        if (data.latestSessionId) {
          localStorage.setItem("sessionId", data.latestSessionId);
          const historyRes = await fetch(`${API_URL}/api/session/${encodeURIComponent(data.latestSessionId)}/history`);
          const historyData = await historyRes.json();
          const messages = historyData.messages?.length ? historyData.messages : [];
          setEvents(messages);
          setIsCompacted(historyData.isCompacted || false);
          setSessionName(historyData.firstPrompt || getSessionNameFromEvents(messages));
          idCounter = messages.length || 0;
        } else {
          setEvents([]);
          setIsCompacted(false);
          setSessionName("");
          idCounter = 0;
        }
      }

      // Check if the backend is busy processing a request for this session
      const currentSessionId = localStorage.getItem("sessionId");
      if (currentSessionId) {
        const statusRes = await fetch(`${API_URL}/api/session/${encodeURIComponent(currentSessionId)}/status`);
        const statusData = await statusRes.json();
        if (statusData.busy) {
          setIsLoading(true);
        }
      }
    } catch (err) {
      console.error("Failed to load history:", err);
      setEvents([]);
      idCounter = 0;
    }
  };

  onMount(() => loadHistory());

  const handleCommit = () => {
    setShowDiffModal(false);
    sendMessage("Commit the current changes");
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
        setPendingVoiceInput(true);
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

  const sendMessage = async (directMessage?: string) => {
    const text = directMessage ?? input().trim();
    if (!text || isLoading()) return;

    // Set session name from first message if not set
    if (!sessionName()) {
      setSessionName(text.length > 50 ? text.slice(0, 50) + "..." : text);
    }

    addEvent({ type: "user", id: String(++idCounter), content: text });
    if (!directMessage) setInput("");
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
                // Capture session_id from result to persist across refreshes
                if (parsed.session_id) {
                  localStorage.setItem("sessionId", parsed.session_id);
                }

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

  // Auto-send after voice transcription only
  createEffect(() => {
    const text = input();
    if (text && pendingVoiceInput() && !isTranscribing() && !isLoading()) {
      setPendingVoiceInput(false);
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
      {/* Header */}
      <Show when={cwd()}>
        <header class="flex-none px-4 py-2 border-b border-border">
          <div class="max-w-2xl mx-auto">
            <button
              type="button"
              onClick={() => setShowSessionModal(true)}
              class="text-sm hover:text-foreground transition-colors text-left w-full overflow-hidden"
            >
              <Show when={sessionName()}>
                <div class="text-foreground font-medium truncate">{sessionName()}</div>
              </Show>
              <div class="text-muted-foreground font-mono text-xs truncate">{cwd()}</div>
            </button>
          </div>
        </header>
      </Show>

      {/* Scrollable chat history */}
      <main ref={mainRef} class="flex-1 overflow-y-auto p-4 border-b border-border">
        <div class="max-w-2xl mx-auto space-y-4 w-full pb-4">
          {/* Compacted context indicator */}
          <Show when={isCompacted()}>
            <div class="flex items-center gap-2 text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 bg-muted/30">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span>Previous context has been compacted</span>
            </div>
          </Show>
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
                    onOpenFile={(path) => {
                      setFileViewerPath(path);
                      setShowFileViewer(true);
                    }}
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

          <Show when={isCompacting()}>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <span class="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span>Compacting context...</span>
            </div>
          </Show>
        </div>
      </main>

      {/* Bottom controls */}
      <div class="flex flex-col items-center pt-2 pb-6 gap-3">
        {/* Text input */}
        <Show when={showTextInput()}>
          <div class="w-full max-w-2xl px-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              class="flex gap-2"
            >
              <input
                type="text"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                placeholder="Type a message..."
                disabled={isLoading() || isRecording() || isTranscribing()}
                class="input flex-1"
              />
              <button
                type="submit"
                disabled={!input().trim() || isLoading() || isRecording() || isTranscribing()}
                class="px-4 py-2 rounded-lg bg-foreground text-background disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
          </div>
        </Show>

        <div class="flex items-center justify-center gap-6">
          {/* Options menu button */}
          <div ref={menuRef} class="relative">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu())}
              class="w-20 h-20 rounded-full flex items-center justify-center bg-background border border-white/30 hover:bg-muted transition-colors shadow-lg"
              title="Options"
            >
              <svg
                class="w-8 h-8 text-muted-foreground"
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
              <div class="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-background border border-border rounded-lg shadow-lg min-w-48">
                <button
                  type="button"
                  onClick={() => {
                    setShowTextInput(!showTextInput());
                    setShowMenu(false);
                  }}
                  class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm rounded-t-lg"
                >
                  {showTextInput() ? "Hide Text Input" : "Show Text Input"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setShowMenu(false);
                    const sessionId = localStorage.getItem("sessionId");
                    if (!sessionId) {
                      alert("No active session to compact");
                      return;
                    }
                    setIsCompacting(true);
                    try {
                      const res = await fetch(`${API_URL}/api/session/${encodeURIComponent(sessionId)}/compact`, {
                        method: "POST",
                      });
                      const data = await res.json();
                      if (data.ok) {
                        // Clear the events and show compacted indicator
                        setEvents([]);
                        setIsCompacted(true);
                        idCounter = 0;
                      } else {
                        alert(data.error || "Failed to compact session");
                      }
                    } catch (err) {
                      console.error("Compact failed:", err);
                      alert("Failed to compact session");
                    } finally {
                      setIsCompacting(false);
                    }
                  }}
                  disabled={isCompacting() || isLoading()}
                  class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm rounded-b-lg disabled:opacity-50"
                >
                  {isCompacting() ? "Compacting..." : "Compact Context"}
                </button>
              </div>
            </Show>
          </div>

          {/* Mic button */}
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

          {/* Git status button - tap for diff, hold for file browser */}
          <GitStatusIndicator
            gitStatus={gitStatus()}
            onClick={() => setShowDiffModal(true)}
            onLongPress={() => setShowFileBrowser(true)}
          />
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
        onSwitch={(messages, sessionId, compacted, firstPrompt) => {
          localStorage.setItem("sessionId", sessionId);
          setEvents(messages);
          setIsCompacted(compacted);
          setSessionName(firstPrompt || getSessionNameFromEvents(messages));
          idCounter = messages.length;
          setShowSessionModal(false);
        }}
        onNewSession={async () => {
          localStorage.removeItem("sessionId");
          setEvents([]);
          setIsCompacted(false);
          setSessionName("");
          idCounter = 0;
          setShowSessionModal(false);
          // Fetch cwd without loading a session
          await loadHistory(null);
        }}
      />

      {/* File Browser Modal */}
      <FileBrowserModal
        show={showFileBrowser()}
        onClose={() => setShowFileBrowser(false)}
        onSelectFile={(path) => {
          setShowFileBrowser(false);
          setFileViewerPath(path);
          setShowFileViewer(true);
        }}
      />

      {/* File Viewer Modal */}
      <FileViewerModal
        show={showFileViewer()}
        filePath={fileViewerPath()}
        onClose={() => setShowFileViewer(false)}
      />
    </div>
  );
}
