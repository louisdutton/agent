import { createSignal, For, onMount, Show } from "solid-js";

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

type Tool = {
	toolUseId: string;
	name: string;
	input: Record<string, unknown>;
	status: "running" | "complete" | "error";
};

type Message =
	| { type: "user"; id: string; content: string }
	| { type: "assistant"; id: string; content: string }
	| { type: "tools"; id: string; tools: Tool[] };

export function SessionManagerModal(props: {
	onClose: () => void;
	onSwitch: (
		messages: Message[],
		sessionId: string,
		isCompacted: boolean,
		firstPrompt?: string,
		cwd?: string,
	) => void;
	onNewSession: () => void;
}) {
	const [projects, setProjects] = createSignal<ProjectWithSessions[]>([]);
	const [currentProject, setCurrentProject] = createSignal<string>("");
	const [loading, setLoading] = createSignal(false);
	const [switching, setSwitching] = createSignal<string | null>(null);
	const [deleting, setDeleting] = createSignal<string | null>(null);
	const [starting, setStarting] = createSignal<string | null>(null);
	const [showProjectPicker, setShowProjectPicker] = createSignal(false);

	// Load projects when modal mounts
	onMount(() => {
		loadProjects();
		setShowProjectPicker(false);
	});

	const loadProjects = async () => {
		setLoading(true);
		try {
			const res = await fetch("/api/projects");
			const data = await res.json();
			setProjects(data.projects || []);
			setCurrentProject(data.currentProject || "");
			setActiveSessionId(data.activeSessionId || null);
		} catch (err) {
			console.error("Failed to load projects:", err);
		} finally {
			setLoading(false);
		}
	};

	const switchSession = async (sessionId: string, projectName: string) => {
		setSwitching(sessionId);
		try {
			// If switching to a session in a different project, switch project first
			if (projectName !== currentProject()) {
				const switchRes = await fetch("/api/projects/switch", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ project: projectName }),
				});
				const switchData = await switchRes.json();
				if (!switchData.ok) {
					alert(switchData.error || "Failed to switch project");
					return;
				}
				setCurrentProject(projectName);
			}

			// Fetch session history directly (stateless)
			const res = await fetch(
				`/api/sessions/${encodeURIComponent(sessionId)}/history`,
			);
			const data = await res.json();
			setActiveSessionId(sessionId);
			props.onSwitch(
				data.messages || [],
				sessionId,
				data.isCompacted || false,
				data.firstPrompt,
				data.cwd,
			);
		} catch (err) {
			console.error("Failed to switch session:", err);
			alert("Failed to switch session");
		} finally {
			setSwitching(null);
		}
	};

	const startNewSession = async (projectName: string) => {
		setStarting(projectName);
		try {
			// Switch to the project first
			const switchRes = await fetch("/api/projects/switch", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ project: projectName }),
			});
			const switchData = await switchRes.json();
			if (!switchData.ok) {
				alert(switchData.error || "Failed to switch project");
				return;
			}
			setCurrentProject(projectName);
			setActiveSessionId(null); // New session has no ID yet
			props.onNewSession();
		} catch (err) {
			console.error("Failed to start session:", err);
			alert("Failed to start session");
		} finally {
			setStarting(null);
			setShowProjectPicker(false);
		}
	};

	const deleteSession = async (
		sessionId: string,
		projectName: string,
		projectPath: string,
	) => {
		if (!confirm("Delete this session? This cannot be undone.")) return;

		setDeleting(sessionId);
		try {
			// Pass project path as query param so backend doesn't need to switch context
			const res = await fetch(
				`/api/sessions/${sessionId}?project=${encodeURIComponent(projectPath)}`,
				{ method: "DELETE" },
			);
			const data = await res.json();
			if (data.ok) {
				// Remove session from local state
				setProjects((prev) =>
					prev.map((p) =>
						p.name === projectName
							? {
									...p,
									sessions: p.sessions.filter((s) => s.sessionId !== sessionId),
								}
							: p,
					),
				);
				// If the deleted session was the active one, clear the UI
				if (data.wasActiveSession) {
					props.onNewSession();
				}
			} else {
				alert(data.error || "Failed to delete session");
			}
		} catch (err) {
			console.error("Failed to delete session:", err);
			alert("Failed to delete session");
		} finally {
			setDeleting(null);
		}
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

	const truncatePrompt = (prompt: string, maxLen = 50) => {
		if (prompt.length <= maxLen) return prompt;
		return `${prompt.slice(0, maxLen)}...`;
	};

	const [activeSessionId, setActiveSessionId] = createSignal<string | null>(
		null,
	);

	// Check if a session is the current active one
	const isActiveSession = (sessionId: string, projectName: string) => {
		// A session is active if it matches the tracked active session ID and is in the current project
		return projectName === currentProject() && sessionId === activeSessionId();
	};

	// Only show projects that have sessions
	const projectsWithSessions = () =>
		projects().filter((p) => p.sessions.length > 0);

	return (
		<div
			class="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
			onClick={(e) => {
				if (e.target === e.currentTarget) props.onClose();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") {
					if (showProjectPicker()) {
						setShowProjectPicker(false);
					} else {
						props.onClose();
					}
				}
			}}
		>
			<div class="h-full flex flex-col">
				{/* Top bar */}
				<div class="flex items-center justify-between px-4 pt-4 pb-2 max-w-2xl mx-auto w-full">
					<button
						type="button"
						onClick={() => {
							if (showProjectPicker()) {
								setShowProjectPicker(false);
							} else {
								props.onClose();
							}
						}}
						class="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
					>
						{showProjectPicker() ? "Back" : "Close"}
					</button>
					<Show when={!showProjectPicker()}>
						<button
							type="button"
							onClick={() => setShowProjectPicker(true)}
							class="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
						>
							New Session
						</button>
					</Show>
				</div>

				{/* Content - pinned to top */}
				<div class="flex-1 overflow-y-auto p-4">
					<Show when={loading()}>
						<div class="flex items-center justify-center h-32">
							<span class="text-muted-foreground">Loading...</span>
						</div>
					</Show>

					<Show when={!loading()}>
						{/* Project picker overlay */}
						<Show when={showProjectPicker()}>
							<div class="space-y-2 max-w-2xl mx-auto w-full max-h-[70vh] overflow-y-auto">
								<div class="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 sticky top-0 bg-background pb-2">
									Select project
								</div>
								<For each={projects()}>
									{(project) => (
										<button
											type="button"
											onClick={() => startNewSession(project.name)}
											disabled={starting() === project.name}
											class="w-full p-3 rounded-lg border border-border hover:border-primary hover:bg-muted/30 transition-colors text-left disabled:opacity-50"
										>
											<div class="text-sm font-medium">{project.name}</div>
											<div class="text-xs text-muted-foreground mt-1">
												{project.sessions.length} session
												{project.sessions.length !== 1 ? "s" : ""}
											</div>
										</button>
									)}
								</For>
							</div>
						</Show>

						{/* Sessions list */}
						<Show when={!showProjectPicker()}>
							<Show
								when={projectsWithSessions().length > 0}
								fallback={
									<div class="text-center text-muted-foreground py-8">
										No sessions found
									</div>
								}
							>
								<div class="space-y-4 max-w-2xl mx-auto w-full">
									<For each={projectsWithSessions()}>
										{(project, index) => (
											<>
												<Show when={index() > 0}>
													<hr class="border-border" />
												</Show>
												<div class="space-y-2">
													{/* Project header */}
													<div class="flex items-center gap-2">
														<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
															{project.name}
														</span>
														<Show when={project.name === currentProject()}>
															<span class="text-xs text-primary">
																(current)
															</span>
														</Show>
													</div>

													{/* Sessions */}
													<div class="space-y-1">
														<For each={project.sessions}>
															{(session) => (
																<div
																	onClick={() => {
																		if (
																			!isActiveSession(
																				session.sessionId,
																				project.name,
																			) &&
																			switching() !== session.sessionId
																		) {
																			switchSession(
																				session.sessionId,
																				project.name,
																			);
																		}
																	}}
																	class={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
																		isActiveSession(
																			session.sessionId,
																			project.name,
																		)
																			? "border-primary bg-muted/50 cursor-default"
																			: "border-border hover:bg-muted/30 cursor-pointer"
																	} ${switching() === session.sessionId ? "opacity-50" : ""}`}
																>
																	<div class="flex-1 min-w-0">
																		<div class="text-sm font-medium truncate">
																			{switching() === session.sessionId
																				? "Switching..."
																				: truncatePrompt(session.firstPrompt)}
																		</div>
																		<div class="flex items-center gap-2 text-xs text-muted-foreground mt-1">
																			<span>
																				{formatDate(session.modified)}
																			</span>
																			<Show when={session.gitBranch}>
																				<span>·</span>
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
																			deleteSession(
																				session.sessionId,
																				project.name,
																				project.path,
																			);
																		}}
																		disabled={deleting() === session.sessionId}
																		class="p-1.5 rounded-md text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
																		title="Delete session"
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
												</div>
											</>
										)}
									</For>
								</div>
							</Show>
						</Show>
					</Show>
				</div>
			</div>
		</div>
	);
}
