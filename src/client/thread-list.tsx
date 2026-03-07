// Thread list - shows all project-based Claude sessions (threads)
// These are discovered from transcript files in ~/.claude/projects/
import { createSignal, For, onMount, Show } from "solid-js";
import type { Thread, ThreadStatus } from "./types";

type SessionInfo = {
	sessionId: string;
	firstPrompt: string;
	created: string;
	modified: string;
	gitBranch?: string;
};

type ProjectWithSessions = {
	name: string;
	path: string;
	sessions: SessionInfo[];
};

type ThreadItem = {
	id: string;
	name: string;
	projectPath: string;
	projectName: string;
	timestamp: number;
	gitBranch?: string;
};

export function ThreadListPanel(props: {
	currentSessionId: string | null;
	onSelectThread: (thread: Thread) => void;
	onNewThread: (projectPath: string) => void;
	onClose: () => void;
}) {
	const [threads, setThreads] = createSignal<ThreadItem[]>([]);
	const [projects, setProjects] = createSignal<ProjectWithSessions[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [showProjectPicker, setShowProjectPicker] = createSignal(false);
	const [deleting, setDeleting] = createSignal<string | null>(null);
	const [confirmDelete, setConfirmDelete] = createSignal<ThreadItem | null>(
		null,
	);

	const loadData = async () => {
		try {
			const res = await fetch("/api/projects");
			const data = await res.json();

			const projectList = (data.projects || []) as ProjectWithSessions[];
			setProjects(projectList);

			const items: ThreadItem[] = [];

			// Collect all sessions from all projects as threads
			for (const project of projectList) {
				for (const s of project.sessions || []) {
					items.push({
						id: s.sessionId,
						name: s.firstPrompt || "Untitled",
						projectPath: project.path,
						projectName: project.name,
						timestamp: new Date(s.modified).getTime(),
						gitBranch: s.gitBranch,
					});
				}
			}

			// Sort by timestamp, newest first
			items.sort((a, b) => b.timestamp - a.timestamp);

			setThreads(items);
		} catch (err) {
			console.error("Failed to load threads:", err);
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		loadData();
	});

	const handleSelectThread = (thread: ThreadItem) => {
		props.onSelectThread({
			id: thread.id,
			type: "assistant",
			projectPath: thread.projectPath,
			projectName: thread.projectName,
			status: "idle" as ThreadStatus,
			name: thread.name,
			startTime: thread.timestamp,
		});
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

	const truncate = (text: string, len = 50) =>
		text.length > len ? `${text.slice(0, len)}...` : text;

	const handleDeleteClick = (e: Event, thread: ThreadItem) => {
		e.stopPropagation();
		setConfirmDelete(thread);
	};

	const handleConfirmDelete = async () => {
		const thread = confirmDelete();
		if (!thread || deleting()) return;

		setDeleting(thread.id);
		setConfirmDelete(null);
		try {
			const res = await fetch(
				`/api/sessions/${thread.id}?project=${encodeURIComponent(thread.projectPath)}`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				setThreads(threads().filter((t) => t.id !== thread.id));
			}
		} catch (err) {
			console.error("Failed to delete thread:", err);
		} finally {
			setDeleting(null);
		}
	};

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
						<div class="space-y-2 max-w-2xl mx-auto">
							<div class="text-sm text-muted-foreground mb-4">
								Select a project for the new thread
							</div>
							<For each={projects()}>
								{(project) => (
									<button
										type="button"
										onClick={() => props.onNewThread(project.path)}
										class="w-full p-4 rounded-xl border border-border active:bg-muted/30 text-left"
									>
										<div class="font-medium">{project.name}</div>
										<div class="text-sm text-muted-foreground mt-1">
											{project.sessions.length} thread
											{project.sessions.length !== 1 ? "s" : ""}
										</div>
									</button>
								)}
							</For>
						</div>
					</Show>

					{/* Thread list */}
					<Show when={!showProjectPicker()}>
						<Show
							when={threads().length > 0}
							fallback={
								<div class="text-center text-muted-foreground py-8">
									<p>No threads yet</p>
								</div>
							}
						>
							<div class="space-y-2 max-w-2xl mx-auto">
								<For each={threads()}>
									{(thread) => {
										const isCurrent = thread.id === props.currentSessionId;
										return (
											<div
												onClick={() => handleSelectThread(thread)}
												class={`w-full flex items-center gap-3 p-4 rounded-xl border text-left cursor-pointer ${
													isCurrent
														? "border-foreground/30 bg-muted/40"
														: "border-border active:bg-muted/30"
												}`}
											>
												<div class="flex-1 min-w-0">
													<div class="font-medium truncate">
														{truncate(thread.name)}
													</div>
													<div class="text-xs text-muted-foreground mt-1">
														{thread.projectName}
														{thread.gitBranch && (
															<span class="font-mono">
																{" "}
																· {thread.gitBranch}
															</span>
														)}
														{" · "}
														{formatTime(thread.timestamp)}
													</div>
												</div>
												<Show when={isCurrent}>
													<span class="text-xs text-muted-foreground">
														current
													</span>
												</Show>
												<Show when={!isCurrent}>
													<button
														type="button"
														onClick={(e) => handleDeleteClick(e, thread)}
														disabled={deleting() === thread.id}
														class="h-10 w-10 flex items-center justify-center rounded-lg text-muted-foreground active:bg-red-500/20 active:text-red-500"
														title="Delete thread"
													>
														{deleting() === thread.id ? "..." : "×"}
													</button>
												</Show>
											</div>
										);
									}}
								</For>
							</div>
						</Show>
					</Show>
				</Show>
			</div>

			{/* Delete confirmation dialog */}
			<Show when={confirmDelete()}>
				<div
					class="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-4"
					onClick={() => setConfirmDelete(null)}
				>
					<div
						class="bg-background rounded-2xl p-6 max-w-sm w-full border border-border"
						onClick={(e) => e.stopPropagation()}
					>
						<h2 class="text-lg font-medium mb-2">Delete thread?</h2>
						<p class="text-sm text-muted-foreground mb-6">
							This will permanently delete this thread and its history.
						</p>
						<div class="flex gap-3">
							<button
								type="button"
								onClick={() => setConfirmDelete(null)}
								class="flex-1 h-12 rounded-xl border border-border active:bg-muted"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleConfirmDelete}
								class="flex-1 h-12 rounded-xl bg-red-500 text-white active:bg-red-600"
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			</Show>
		</div>
	);
}
