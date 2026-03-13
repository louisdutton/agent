import { createSignal, For, onMount, Show } from "solid-js";
import { api } from "../api";
import {
	EntityList,
	type EntityListItem,
	FloatingActionButton,
	Icons,
} from "../entity-list";
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

	const handleDeleteTask = async (task: TaskItem) => {
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

	// Transform tasks data into EntityListItem format
	const entityItems = (): EntityListItem<TaskItem>[] => {
		return tasks().map((task) => {
			const isCurrent = task.id === props.currentSessionId;
			const branchInfo = task.gitBranch ? ` · ${task.gitBranch}` : "";
			const metadata = `${task.projectName}${branchInfo} · ${formatRelativeTime(task.timestamp)}`;

			return {
				id: task.id,
				title: truncate(task.name),
				description: metadata,
				status: isCurrent ? "success" : undefined,
				data: task,
			};
		});
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
						<div class="space-y-2 mb-20">
							{" "}
							{/* Extra margin for FAB */}
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
						<div class="mb-20">
							{" "}
							{/* Extra margin for FAB */}
							<EntityList
								items={entityItems()}
								loading={false}
								emptyMessage="No tasks yet"
								actions={[]}
							>
								{/* Custom item rendering with click handler */}
								<For each={entityItems()}>
									{(item) => {
										const isCurrent = item.data.id === props.currentSessionId;
										return (
											<div
												onClick={() => handleSelectTask(item.data)}
												class={`border border-border rounded-lg p-3 cursor-pointer transition-colors ${
													isCurrent
														? "border-foreground/30 bg-muted/40"
														: "hover:bg-muted/20 active:bg-muted/30"
												}`}
											>
												<div class="flex items-start justify-between gap-2">
													<div class="flex-1 min-w-0">
														<div class="flex items-center gap-2">
															<Show when={isCurrent}>
																<span class="w-2 h-2 rounded-full bg-green-500" />
															</Show>
															<span class="font-medium truncate">
																{item.title}
															</span>
														</div>
														<Show when={item.description}>
															<div class="text-xs text-muted-foreground mt-1">
																{item.description}
															</div>
														</Show>
													</div>
													<div class="flex items-center gap-1">
														<Show when={isCurrent}>
															<span class="text-xs text-muted-foreground">
																current
															</span>
														</Show>
														<Show when={!isCurrent}>
															<button
																type="button"
																onClick={(e) => {
																	e.stopPropagation();
																	handleDeleteTask(item.data);
																}}
																disabled={deleting() === item.data.id}
																class="p-1.5 hover:bg-muted rounded transition-colors text-red-500"
																title="Delete task"
															>
																{deleting() === item.data.id ? (
																	<div class="w-4 h-4 text-xs">...</div>
																) : (
																	Icons.Delete()
																)}
															</button>
														</Show>
													</div>
												</div>
											</div>
										);
									}}
								</For>
							</EntityList>
						</div>
					</Show>
				</Show>

				{/* Mobile-friendly floating action button */}
				<Show when={!showProjectPicker()}>
					<FloatingActionButton
						icon={Icons.Plus()}
						label="New task"
						onClick={() => setShowProjectPicker(true)}
					/>
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
