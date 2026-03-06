// Collapsible background workers panel
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";

type WorkerSession = {
	sessionId: string;
	type: "worker";
	status: "idle" | "running" | "error" | "completed" | "stopped";
	projectPath: string;
	pid: number | null;
	startTime: number;
	parentSession: string;
	task: string;
};

export function WorkerListPanel(props: {
	onSelectWorker: (worker: WorkerSession) => void;
	onSpawnWorker: () => void;
}) {
	const [workers, setWorkers] = createSignal<WorkerSession[]>([]);
	const [expanded, setExpanded] = createSignal(false);
	const [loading, setLoading] = createSignal(false);

	let pollInterval: ReturnType<typeof setInterval> | null = null;

	const loadWorkers = async () => {
		try {
			const res = await fetch("/api/workers");
			const data = await res.json();
			setWorkers(data.workers || []);
		} catch (err) {
			console.error("Failed to load workers:", err);
		}
	};

	onMount(() => {
		loadWorkers();
		// Poll for updates every 5 seconds
		pollInterval = setInterval(loadWorkers, 5000);
	});

	onCleanup(() => {
		if (pollInterval) clearInterval(pollInterval);
	});

	const activeWorkers = () =>
		workers().filter((w) => w.status === "running" || w.status === "idle");

	const formatRuntime = (startTime: number) => {
		const elapsed = Date.now() - startTime;
		const seconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(seconds / 60);
		if (minutes > 0) {
			return `${minutes}m`;
		}
		return `${seconds}s`;
	};

	const statusColor = (status: WorkerSession["status"]) => {
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

	const handleStop = async (sessionId: string, e: Event) => {
		e.stopPropagation();
		try {
			await fetch(`/api/workers/${sessionId}/stop`, { method: "POST" });
			loadWorkers();
		} catch (err) {
			console.error("Failed to stop worker:", err);
		}
	};

	// Don't render if no workers
	if (workers().length === 0 && !expanded()) {
		return null;
	}

	return (
		<div class="fixed bottom-24 left-4 right-4 z-20 max-w-2xl mx-auto">
			{/* Collapsed bar */}
			<Show when={!expanded() && activeWorkers().length > 0}>
				<button
					type="button"
					onClick={() => setExpanded(true)}
					class="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-muted border border-border shadow-lg"
				>
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
						<span class="text-sm font-medium">
							{activeWorkers().length} worker
							{activeWorkers().length !== 1 ? "s" : ""} running
						</span>
					</div>
					<svg
						class="w-4 h-4 text-muted-foreground"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M5 15l7-7 7 7"
						/>
					</svg>
				</button>
			</Show>

			{/* Expanded panel */}
			<Show when={expanded()}>
				<div class="rounded-xl bg-muted border border-border shadow-lg overflow-hidden">
					{/* Header */}
					<div class="flex items-center justify-between px-4 py-3 border-b border-border">
						<span class="text-sm font-medium">Background Workers</span>
						<div class="flex items-center gap-2">
							<button
								type="button"
								onClick={props.onSpawnWorker}
								class="px-3 py-1 text-xs rounded-lg bg-foreground text-background"
							>
								New
							</button>
							<button
								type="button"
								onClick={() => setExpanded(false)}
								class="p-1 rounded-lg hover:bg-background/50"
							>
								<svg
									class="w-4 h-4"
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
						</div>
					</div>

					{/* Workers list */}
					<div class="max-h-64 overflow-y-auto">
						<Show
							when={workers().length > 0}
							fallback={
								<div class="px-4 py-6 text-center text-sm text-muted-foreground">
									No workers running
								</div>
							}
						>
							<For each={workers()}>
								{(worker) => (
									<button
										type="button"
										onClick={() => props.onSelectWorker(worker)}
										class="w-full flex items-center gap-3 px-4 py-3 hover:bg-background/50 transition-colors text-left border-b border-border/50 last:border-b-0"
									>
										<span
											class={`w-2 h-2 rounded-full ${statusColor(worker.status)}`}
										/>
										<div class="flex-1 min-w-0">
											<div class="text-sm font-medium truncate">
												{worker.task.slice(0, 40)}
												{worker.task.length > 40 ? "..." : ""}
											</div>
											<div class="text-xs text-muted-foreground">
												{worker.projectPath.split("/").pop()} |{" "}
												{formatRuntime(worker.startTime)}
											</div>
										</div>
										<Show when={worker.status === "running"}>
											<button
												type="button"
												onClick={(e) => handleStop(worker.sessionId, e)}
												class="p-1.5 rounded-lg bg-red-950 text-red-400 hover:bg-red-900"
												title="Stop worker"
											>
												<svg
													class="w-3 h-3"
													fill="none"
													stroke="currentColor"
													viewBox="0 0 24 24"
												>
													<path
														stroke-linecap="round"
														stroke-linejoin="round"
														stroke-width="2"
														d="M6 18L18 6M6 6l12 12"
													/>
												</svg>
											</button>
										</Show>
									</button>
								)}
							</For>
						</Show>
					</div>
				</div>
			</Show>
		</div>
	);
}

// Dialog for spawning a new worker
export function SpawnWorkerDialog(props: {
	projectPath: string;
	parentSession: string;
	onClose: () => void;
	onSpawn: (worker: WorkerSession) => void;
}) {
	const [task, setTask] = createSignal("");
	const [spawning, setSpawning] = createSignal(false);

	const handleSpawn = async () => {
		const taskText = task().trim();
		if (!taskText || spawning()) return;

		setSpawning(true);
		try {
			const res = await fetch("/api/workers/spawn", {
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
				props.onSpawn(data.session);
			} else {
				alert(data.error || "Failed to spawn worker");
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

				<h3 class="text-xl font-medium mb-4">Spawn Background Worker</h3>

				<div class="mb-4">
					<label class="block text-sm text-muted-foreground mb-2">Task</label>
					<textarea
						value={task()}
						onInput={(e) => setTask(e.currentTarget.value)}
						placeholder="Describe what the worker should do..."
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
						{spawning() ? "Starting..." : "Start Worker"}
					</button>
				</div>
			</div>
		</div>
	);
}
