// Thread list - shows all threads (assistant sessions and background threads)
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { Thread, ThreadStatus } from "./types";

type SessionInfo = {
	sessionId: string;
	firstPrompt: string;
	created: string;
	modified: string;
	gitBranch?: string;
};

type WorkerInfo = {
	sessionId: string;
	type: "worker";
	status: ThreadStatus;
	projectPath: string;
	pid: number | null;
	startTime: number;
	parentSession: string;
	task: string;
};

type UnifiedThread = {
	id: string;
	type: "assistant" | "worker";
	name: string;
	status: ThreadStatus;
	projectPath: string;
	timestamp: number; // For sorting
	// Worker-specific
	pid?: number | null;
	parentSession?: string;
	// Assistant-specific
	gitBranch?: string;
};

export function ThreadListPanel(props: {
	projectPath: string;
	currentSessionId: string | null;
	onSelectThread: (thread: Thread) => void;
	onStopThread: (sessionId: string) => Promise<void>;
	onSpawnThread: () => void;
	onClose: () => void;
}) {
	const [threads, setThreads] = createSignal<UnifiedThread[]>([]);
	const [loading, setLoading] = createSignal(true);

	let pollInterval: ReturnType<typeof setInterval> | null = null;

	const loadData = async () => {
		try {
			// Fetch both worker threads and assistant sessions
			const [workersRes, sessionsRes] = await Promise.all([
				fetch("/api/threads"),
				fetch(`/api/sessions?project=${encodeURIComponent(props.projectPath)}`),
			]);

			const workersData = await workersRes.json();
			const sessionsData = await sessionsRes.json();

			const unified: UnifiedThread[] = [];

			// Add worker threads
			for (const w of workersData.threads || []) {
				unified.push({
					id: w.sessionId,
					type: "worker",
					name: w.task,
					status: w.status,
					projectPath: w.projectPath,
					timestamp: w.startTime,
					pid: w.pid,
					parentSession: w.parentSession,
				});
			}

			// Add assistant sessions
			for (const s of sessionsData.sessions || []) {
				unified.push({
					id: s.sessionId,
					type: "assistant",
					name: s.firstPrompt || "Untitled",
					status: "idle" as ThreadStatus, // Sessions are always idle
					projectPath: props.projectPath,
					timestamp: new Date(s.modified).getTime(),
					gitBranch: s.gitBranch,
				});
			}

			// Sort by timestamp, newest first
			unified.sort((a, b) => b.timestamp - a.timestamp);

			setThreads(unified);
		} catch (err) {
			console.error("Failed to load threads:", err);
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		loadData();
		pollInterval = setInterval(loadData, 5000);
	});

	onCleanup(() => {
		if (pollInterval) clearInterval(pollInterval);
	});

	const handleSelectThread = (thread: UnifiedThread) => {
		const projectName =
			thread.projectPath.split("/").pop() || thread.projectPath;
		props.onSelectThread({
			id: thread.id,
			type: thread.type,
			projectPath: thread.projectPath,
			projectName,
			status: thread.status,
			name: thread.name,
			startTime: thread.timestamp,
			parentSession: thread.parentSession,
			pid: thread.pid,
		});
	};

	const handleStop = async (e: Event, sessionId: string) => {
		e.stopPropagation();
		await props.onStopThread(sessionId);
		await loadData();
	};

	const formatTime = (timestamp: number) => {
		const now = Date.now();
		const diff = now - timestamp;
		const mins = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (mins > 0) return `${mins}m ago`;
		return "now";
	};

	const statusColor = (status: ThreadStatus, type: "assistant" | "worker") => {
		if (type === "assistant") return "bg-muted-foreground";
		switch (status) {
			case "running":
				return "bg-green-500";
			case "completed":
				return "bg-blue-500";
			case "error":
				return "bg-red-500";
			case "stopped":
				return "bg-yellow-500";
			default:
				return "bg-muted-foreground";
		}
	};

	const isActive = (thread: UnifiedThread) =>
		thread.type === "worker" &&
		(thread.status === "running" || thread.status === "idle");

	const truncate = (text: string, len = 50) =>
		text.length > len ? `${text.slice(0, len)}...` : text;

	// Separate active and inactive threads
	const activeThreads = () => threads().filter((t) => isActive(t));
	const inactiveThreads = () => threads().filter((t) => !isActive(t));

	return (
		<div class="fixed inset-0 z-50 bg-background flex flex-col">
			{/* Header */}
			<div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
				<button
					type="button"
					onClick={props.onClose}
					class="h-11 px-5 text-base rounded-xl border border-border active:bg-muted"
				>
					Close
				</button>
				<h1 class="text-lg font-medium">Threads</h1>
				<button
					type="button"
					onClick={props.onSpawnThread}
					class="h-11 px-5 text-base rounded-xl bg-foreground text-background"
				>
					New
				</button>
			</div>

			{/* Content */}
			<div class="flex-1 overflow-y-auto p-4">
				<Show when={loading()}>
					<div class="flex items-center justify-center h-32">
						<span class="text-muted-foreground">Loading...</span>
					</div>
				</Show>

				<Show when={!loading()}>
					<Show
						when={threads().length > 0}
						fallback={
							<div class="text-center text-muted-foreground py-8">
								<p class="mb-4">No threads</p>
								<p class="text-sm">Start a new thread to get started.</p>
							</div>
						}
					>
						<div class="space-y-6 max-w-2xl mx-auto">
							{/* Active threads section */}
							<Show when={activeThreads().length > 0}>
								<div class="space-y-2">
									<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
										Active
									</div>
									<For each={activeThreads()}>
										{(thread) => (
											<div
												onClick={() => handleSelectThread(thread)}
												class="w-full flex items-center gap-3 p-4 rounded-xl border border-border active:bg-muted/30 text-left cursor-pointer"
											>
												<span
													class={`w-2 h-2 rounded-full ${statusColor(thread.status, thread.type)} ${thread.status === "running" ? "animate-pulse" : ""}`}
												/>
												<div class="flex-1 min-w-0">
													<div class="font-medium truncate">
														{truncate(thread.name)}
													</div>
													<div class="text-xs text-muted-foreground mt-1">
														{thread.type === "worker"
															? "Background"
															: "Session"}{" "}
														· {formatTime(thread.timestamp)}
													</div>
												</div>
												<Show when={thread.status === "running"}>
													<button
														type="button"
														onClick={(e) => handleStop(e, thread.id)}
														class="p-2 rounded-lg bg-red-950 text-red-400"
													>
														<svg
															class="w-4 h-4"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<rect
																x="6"
																y="6"
																width="12"
																height="12"
																rx="2"
																fill="currentColor"
															/>
														</svg>
													</button>
												</Show>
											</div>
										)}
									</For>
								</div>
							</Show>

							{/* Inactive/sessions section */}
							<Show when={inactiveThreads().length > 0}>
								<div class="space-y-2">
									<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
										Sessions
									</div>
									<For each={inactiveThreads()}>
										{(thread) => {
											const isCurrent =
												thread.type === "assistant" &&
												thread.id === props.currentSessionId;
											return (
												<div
													onClick={() => handleSelectThread(thread)}
													class={`w-full flex items-center gap-3 p-4 rounded-xl border text-left cursor-pointer transition-opacity ${
														isCurrent
															? "border-foreground/30 bg-muted/40"
															: "border-border/50 bg-muted/20 opacity-70 hover:opacity-100"
													}`}
												>
													<span
														class={`w-2 h-2 rounded-full ${statusColor(thread.status, thread.type)}`}
													/>
													<div class="flex-1 min-w-0">
														<div class="font-medium truncate">
															{truncate(thread.name)}
														</div>
														<div class="text-xs text-muted-foreground mt-1">
															{thread.type === "worker" && (
																<span class="text-yellow-500">
																	{thread.status} ·{" "}
																</span>
															)}
															{thread.gitBranch && (
																<span>{thread.gitBranch} · </span>
															)}
															{formatTime(thread.timestamp)}
														</div>
													</div>
													<Show when={isCurrent}>
														<span class="text-xs text-muted-foreground">
															current
														</span>
													</Show>
												</div>
											);
										}}
									</For>
								</div>
							</Show>
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
}

// Dialog for spawning a new thread
export function SpawnThreadDialog(props: {
	projectPath: string;
	parentSession: string;
	onClose: () => void;
	onSpawn: (thread: Thread) => void;
}) {
	const [task, setTask] = createSignal("");
	const [spawning, setSpawning] = createSignal(false);

	const handleSpawn = async () => {
		const taskText = task().trim();
		if (!taskText || spawning()) return;

		setSpawning(true);
		try {
			const res = await fetch("/api/threads/spawn", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					projectPath: props.projectPath,
					task: taskText,
					parentSession: props.parentSession,
				}),
			});
			const data = await res.json();
			if (data.session) {
				const projectName =
					props.projectPath.split("/").pop() || props.projectPath;
				props.onSpawn({
					id: data.session.sessionId,
					type: "worker",
					projectPath: props.projectPath,
					projectName,
					status: data.session.status,
					name: taskText,
					startTime: data.session.startTime,
					parentSession: props.parentSession,
					pid: data.session.pid,
				});
			} else {
				alert(data.error || "Failed to spawn thread");
			}
		} catch (err) {
			alert(String(err));
		} finally {
			setSpawning(false);
		}
	};

	return (
		<div
			class="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
			onClick={(e) => {
				if (e.target === e.currentTarget) props.onClose();
			}}
		>
			<div class="w-full bg-background border-t border-border rounded-t-2xl p-6 pb-8 safe-area-inset-bottom">
				<div class="w-12 h-1 bg-muted-foreground/30 rounded-full mx-auto mb-6" />

				<h3 class="text-xl font-medium mb-4">New Thread</h3>

				<div class="mb-4">
					<label class="block text-sm text-muted-foreground mb-2">Task</label>
					<textarea
						value={task()}
						onInput={(e) => setTask(e.currentTarget.value)}
						placeholder="Describe what the thread should do..."
						class="w-full px-4 py-3 bg-muted border border-border rounded-xl text-base resize-none"
						rows={4}
						autofocus
					/>
				</div>

				<div class="text-sm text-muted-foreground mb-6">
					Project: {props.projectPath.split("/").pop()}
				</div>

				<div class="flex items-center gap-3">
					<button
						type="button"
						onClick={props.onClose}
						class="flex-1 h-14 text-base rounded-xl border border-border active:bg-muted"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={handleSpawn}
						disabled={!task().trim() || spawning()}
						class="flex-1 h-14 text-base font-medium rounded-xl bg-foreground text-background active:opacity-80 disabled:opacity-50"
					>
						{spawning() ? "Starting..." : "Start"}
					</button>
				</div>
			</div>
		</div>
	);
}
