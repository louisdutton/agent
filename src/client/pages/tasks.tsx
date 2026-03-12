import { createSignal, For, onMount, Show } from "solid-js";
import { api } from "../api";
import { PageLayout } from "../page-layout";
import { navigate } from "../router";
import { formatRelativeTime } from "../util";

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

type TaskItem = {
	id: string;
	name: string;
	projectPath: string;
	projectName: string;
	timestamp: number;
	gitBranch?: string;
};

export function TasksPage(props: {
	currentSessionId: string | null;
	onMenuClick: () => void;
}) {
	const [tasks, setTasks] = createSignal<TaskItem[]>([]);
	const [projects, setProjects] = createSignal<ProjectWithSessions[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [showProjectPicker, setShowProjectPicker] = createSignal(false);
	const [deleting, setDeleting] = createSignal<string | null>(null);
	const [confirmDelete, setConfirmDelete] = createSignal<TaskItem | null>(null);

	const loadData = async () => {
		try {
			const { data } = await api.projects.get();
			const projectList = (data?.projects || []) as ProjectWithSessions[];
			setProjects(projectList);

			const items: TaskItem[] = [];

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

			items.sort((a, b) => b.timestamp - a.timestamp);
			setTasks(items);
		} catch (err) {
			console.error("Failed to load tasks:", err);
		} finally {
			setLoading(false);
		}
	};

	onMount(() => {
		loadData();
	});

	const handleSelectTask = (task: TaskItem) => {
		navigate({
			type: "chat",
			project: task.projectPath,
			sessionId: task.id,
		});
	};

	const handleNewTask = (projectPath: string) => {
		navigate({ type: "chat", project: projectPath });
	};

	const truncate = (text: string, len = 50) =>
		text.length > len ? `${text.slice(0, len)}...` : text;

	const handleDeleteClick = (e: Event, task: TaskItem) => {
		e.stopPropagation();
		setConfirmDelete(task);
	};

	const handleConfirmDelete = async () => {
		const task = confirmDelete();
		if (!task || deleting()) return;

		setDeleting(task.id);
		setConfirmDelete(null);
		try {
			const res = await fetch(
				`/api/sessions/${task.id}?project=${encodeURIComponent(task.projectPath)}`,
				{ method: "DELETE" },
			);
			if (res.ok) {
				setTasks(tasks().filter((t) => t.id !== task.id));
			}
		} catch (err) {
			console.error("Failed to delete task:", err);
		} finally {
			setDeleting(null);
		}
	};

	return (
		<>
			<PageLayout title="Tasks" onMenuClick={props.onMenuClick}>
				<Show when={loading()}>
					<div class="flex items-center justify-center h-32">
						<span class="text-muted-foreground">Loading...</span>
					</div>
				</Show>

				<Show when={!loading()}>
					{/* Project picker for new task */}
					<Show when={showProjectPicker()}>
						<div class="space-y-2">
							<div class="flex items-center justify-between mb-4">
								<span class="text-sm text-muted-foreground">
									Select a project for the new task
								</span>
								<button
									type="button"
									onClick={() => setShowProjectPicker(false)}
									class="text-sm text-muted-foreground hover:text-foreground"
								>
									Cancel
								</button>
							</div>
							<For each={projects()}>
								{(project) => (
									<button
										type="button"
										onClick={() => handleNewTask(project.path)}
										class="w-full p-4 rounded-xl border border-border active:bg-muted/30 text-left"
									>
										<div class="font-medium">{project.name}</div>
										<div class="text-sm text-muted-foreground mt-1">
											{project.sessions.length} task
											{project.sessions.length !== 1 ? "s" : ""}
										</div>
									</button>
								)}
							</For>
						</div>
					</Show>

					{/* Task list */}
					<Show when={!showProjectPicker()}>
						<div class="space-y-3">
							<button
								type="button"
								onClick={() => setShowProjectPicker(true)}
								class="w-full py-2 px-4 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
							>
								+ New task
							</button>

							<Show
								when={tasks().length > 0}
								fallback={
									<div class="text-center text-muted-foreground py-8">
										No tasks yet
									</div>
								}
							>
								<For each={tasks()}>
									{(task) => {
										const isCurrent = task.id === props.currentSessionId;
										return (
											<div
												onClick={() => handleSelectTask(task)}
												class={`w-full flex items-center gap-3 p-4 rounded-xl border text-left cursor-pointer ${
													isCurrent
														? "border-foreground/30 bg-muted/40"
														: "border-border active:bg-muted/30"
												}`}
											>
												<div class="flex-1 min-w-0">
													<div class="font-medium truncate">
														{truncate(task.name)}
													</div>
													<div class="text-xs text-muted-foreground mt-1">
														{task.projectName}
														{task.gitBranch && (
															<span class="font-mono"> · {task.gitBranch}</span>
														)}
														{" · "}
														{formatRelativeTime(task.timestamp)}
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
														onClick={(e) => handleDeleteClick(e, task)}
														disabled={deleting() === task.id}
														class="h-10 w-10 flex items-center justify-center rounded-lg text-muted-foreground active:bg-red-500/20 active:text-red-500"
														title="Delete task"
													>
														{deleting() === task.id ? "..." : "×"}
													</button>
												</Show>
											</div>
										);
									}}
								</For>
							</Show>
						</div>
					</Show>
				</Show>
			</PageLayout>

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
						<h2 class="text-lg font-medium mb-2">Delete task?</h2>
						<p class="text-sm text-muted-foreground mb-6">
							This will permanently delete this task and its history.
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
		</>
	);
}
