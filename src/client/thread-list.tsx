// Unified thread list - shows both assistant sessions and workers
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

type ProjectWithSessions = {
	name: string;
	path: string;
	sessions: SessionInfo[];
};

export function ThreadListPanel(props: {
	currentProjectPath: string;
	currentSessionId: string | null;
	onSelectThread: (thread: Thread) => void;
	onNewSession: (projectPath: string) => void;
	onDeleteSession: (sessionId: string, projectPath: string) => Promise<void>;
	onStopWorker: (sessionId: string) => Promise<void>;
	onSpawnWorker: () => void;
	onClose: () => void;
}) {
	const [projects, setProjects] = createSignal<ProjectWithSessions[]>([]);
	const [workers, setWorkers] = createSignal<WorkerInfo[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [showProjectPicker, setShowProjectPicker] = createSignal(false);
	const [switching, setSwitching] = createSignal<string | null>(null);
	const [deleting, setDeleting] = createSignal<string | null>(null);

	let pollInterval: ReturnType<typeof setInterval> | null = null;

	const loadData = async () => {
		try {
			const [projectsRes, workersRes] = await Promise.all([
				fetch("/api/projects"),
				fetch("/api/workers"),
			]);
			const projectsData = await projectsRes.json();
			const workersData = await workersRes.json();
			setProjects(projectsData.projects || []);
			setWorkers(workersData.workers || []);
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

	const handleSelectSession = async (
		session: SessionInfo,
		project: ProjectWithSessions,
	) => {
		if (switching()) return;
		setSwitching(session.sessionId);
		try {
			props.onSelectThread({
				id: session.sessionId,
				type: "assistant",
				projectPath: project.path,
				projectName: project.name,
				status: "idle",
				name: session.firstPrompt,
				startTime: new Date(session.created).getTime(),
			});
		} finally {
			setSwitching(null);
		}
	};

	const handleSelectWorker = (worker: WorkerInfo) => {
		const projectName =
			worker.projectPath.split("/").pop() || worker.projectPath;
		props.onSelectThread({
			id: worker.sessionId,
			type: "worker",
			projectPath: worker.projectPath,
			projectName,
			status: worker.status,
			name: worker.task,
			startTime: worker.startTime,
			parentSession: worker.parentSession,
			pid: worker.pid,
		});
	};

	const handleDelete = async (
		e: Event,
		sessionId: string,
		projectPath: string,
	) => {
		e.stopPropagation();
		if (!confirm("Delete this thread? This cannot be undone.")) return;
		setDeleting(sessionId);
		try {
			await props.onDeleteSession(sessionId, projectPath);
			await loadData();
		} finally {
			setDeleting(null);
		}
	};

	const handleStop = async (e: Event, sessionId: string) => {
		e.stopPropagation();
		await props.onStopWorker(sessionId);
		await loadData();
	};

	const formatDate = (dateStr: string) => {
		const date = new Date(dateStr);
		return date.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const formatRuntime = (startTime: number) => {
		const elapsed = Date.now() - startTime;
		const seconds = Math.floor(elapsed / 1000);
		const minutes = Math.floor(seconds / 60);
		if (minutes > 0) return `${minutes}m`;
		return `${seconds}s`;
	};

	const statusColor = (status: ThreadStatus) => {
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

	const truncate = (text: string, len = 50) =>
		text.length > len ? `${text.slice(0, len)}...` : text;

	// Get workers for a specific project
	const workersForProject = (projectPath: string) =>
		workers().filter((w) => w.projectPath === projectPath);

	// Projects that have sessions or active workers
	const activeProjects = () =>
		projects().filter(
			(p) => p.sessions.length > 0 || workersForProject(p.path).length > 0,
		);

	return (
		<div class="fixed inset-0 z-50 bg-background flex flex-col">
			{/* Header */}
			<div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
				<button
					type="button"
					onClick={() => {
						if (showProjectPicker()) {
							setShowProjectPicker(false);
						} else {
							props.onClose();
						}
					}}
					class="h-11 px-5 text-base rounded-xl border border-border active:bg-muted"
				>
					{showProjectPicker() ? "Back" : "Close"}
				</button>
				<h1 class="text-lg font-medium">Threads</h1>
				<Show when={!showProjectPicker()} fallback={<div class="w-20" />}>
					<button
						type="button"
						onClick={() => setShowProjectPicker(true)}
						class="h-11 px-5 text-base rounded-xl bg-foreground text-background"
					>
						New
					</button>
				</Show>
			</div>

			{/* Content */}
			<div class="flex-1 overflow-y-auto p-4">
				<Show when={loading()}>
					<div class="flex items-center justify-center h-32">
						<span class="text-muted-foreground">Loading...</span>
					</div>
				</Show>

				<Show when={!loading()}>
					{/* Project picker for new thread */}
					<Show when={showProjectPicker()}>
						<div class="space-y-3 max-w-2xl mx-auto">
							<div class="text-sm text-muted-foreground mb-4">
								Select project for new thread
							</div>
							<For each={projects()}>
								{(project) => (
									<div class="space-y-2">
										<button
											type="button"
											onClick={() => {
												props.onNewSession(project.path);
												setShowProjectPicker(false);
											}}
											class="w-full p-4 rounded-xl border border-border active:bg-muted/30 text-left"
										>
											<div class="font-medium">{project.name}</div>
											<div class="text-sm text-muted-foreground mt-1">
												New assistant thread
											</div>
										</button>
										<button
											type="button"
											onClick={() => {
												props.onSpawnWorker();
												setShowProjectPicker(false);
											}}
											class="w-full p-4 rounded-xl border border-dashed border-border active:bg-muted/30 text-left"
										>
											<div class="font-medium text-muted-foreground">
												+ Spawn worker
											</div>
											<div class="text-sm text-muted-foreground mt-1">
												Background task in {project.name}
											</div>
										</button>
									</div>
								)}
							</For>
						</div>
					</Show>

					{/* Thread list */}
					<Show when={!showProjectPicker()}>
						<Show
							when={activeProjects().length > 0}
							fallback={
								<div class="text-center text-muted-foreground py-8">
									No threads found
								</div>
							}
						>
							<div class="space-y-6 max-w-2xl mx-auto">
								<For each={activeProjects()}>
									{(project) => (
										<div class="space-y-2">
											{/* Project header */}
											<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
												{project.name}
											</div>

											{/* Workers for this project */}
											<For each={workersForProject(project.path)}>
												{(worker) => (
													<div
														onClick={() => handleSelectWorker(worker)}
														class="w-full flex items-center gap-3 p-4 rounded-xl border border-border active:bg-muted/30 text-left cursor-pointer"
													>
														<span
															class={`w-2 h-2 rounded-full ${statusColor(worker.status)} ${worker.status === "running" ? "animate-pulse" : ""}`}
														/>
														<div class="flex-1 min-w-0">
															<div class="font-medium truncate">
																{truncate(worker.task)}
															</div>
															<div class="text-xs text-muted-foreground mt-1">
																Worker · {formatRuntime(worker.startTime)}
															</div>
														</div>
														<Show when={worker.status === "running"}>
															<button
																type="button"
																onClick={(e) => handleStop(e, worker.sessionId)}
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

											{/* Sessions for this project */}
											<For each={project.sessions}>
												{(session) => (
													<div
														onClick={() => {
															if (switching() !== session.sessionId) {
																handleSelectSession(session, project);
															}
														}}
														class={`w-full flex items-center gap-3 p-4 rounded-xl border text-left cursor-pointer ${
															session.sessionId === props.currentSessionId &&
															project.path === props.currentProjectPath
																? "border-foreground bg-muted/50"
																: "border-border active:bg-muted/30"
														} ${switching() === session.sessionId ? "opacity-50 pointer-events-none" : ""}`}
													>
														<span class="w-2 h-2 rounded-full bg-muted-foreground" />
														<div class="flex-1 min-w-0">
															<div class="font-medium truncate">
																{switching() === session.sessionId
																	? "Loading..."
																	: truncate(session.firstPrompt)}
															</div>
															<div class="text-xs text-muted-foreground mt-1">
																{formatDate(session.modified)}
																<Show when={session.gitBranch}>
																	{" "}
																	·{" "}
																	<span class="font-mono">
																		{session.gitBranch}
																	</span>
																</Show>
															</div>
														</div>
														<button
															type="button"
															onClick={(e) => {
																e.stopPropagation();
																handleDelete(
																	e,
																	session.sessionId,
																	project.path,
																);
															}}
															disabled={deleting() === session.sessionId}
															class="p-2 rounded-lg text-red-400 hover:bg-red-950 disabled:opacity-50"
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
																	d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
																/>
															</svg>
														</button>
													</div>
												)}
											</For>
										</div>
									)}
								</For>
							</div>
						</Show>
					</Show>
				</Show>
			</div>
		</div>
	);
}

// Dialog for spawning a new worker (reused from worker-list.tsx)
export function SpawnWorkerDialog(props: {
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

				<h3 class="text-xl font-medium mb-4">Spawn Worker Thread</h3>

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
