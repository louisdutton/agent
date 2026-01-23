import { createEffect, createSignal, For, Show } from "solid-js";

const API_URL = "";

type SessionListItem = {
	sessionId: string;
	firstPrompt: string;
	messageCount: number;
	created: string;
	modified: string;
	gitBranch?: string;
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
	show: boolean;
	onClose: () => void;
	onSwitch: (messages: Message[]) => void;
	onNewSession: () => void;
}) {
	const [sessions, setSessions] = createSignal<SessionListItem[]>([]);
	const [projects, setProjects] = createSignal<string[]>([]);
	const [currentProject, setCurrentProject] = createSignal<string>("");
	const [loading, setLoading] = createSignal(false);
	const [switching, setSwitching] = createSignal<string | null>(null);
	const [deleting, setDeleting] = createSignal<string | null>(null);
	const [creating, setCreating] = createSignal(false);
	const [switchingProject, setSwitchingProject] = createSignal<string | null>(null);

	// Load sessions and projects when modal opens
	createEffect(() => {
		if (props.show) {
			loadSessions();
			loadProjects();
		}
	});

	const loadSessions = async () => {
		setLoading(true);
		try {
			const res = await fetch(`${API_URL}/api/sessions`);
			const data = await res.json();
			setSessions(data.sessions || []);
		} catch (err) {
			console.error("Failed to load sessions:", err);
		} finally {
			setLoading(false);
		}
	};

	const loadProjects = async () => {
		try {
			const res = await fetch(`${API_URL}/api/projects`);
			const data = await res.json();
			setProjects(data.projects || []);
			setCurrentProject(data.currentProject || "");
		} catch (err) {
			console.error("Failed to load projects:", err);
		}
	};

	const switchProject = async (project: string) => {
		if (project === currentProject()) return;

		setSwitchingProject(project);
		try {
			const res = await fetch(`${API_URL}/api/projects/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ project }),
			});
			const data = await res.json();
			if (data.ok) {
				setCurrentProject(project);
				props.onNewSession();
			} else {
				alert(data.error || "Failed to switch project");
			}
		} catch (err) {
			console.error("Failed to switch project:", err);
			alert("Failed to switch project");
		} finally {
			setSwitchingProject(null);
		}
	};

	const switchSession = async (sessionId: string) => {
		setSwitching(sessionId);
		try {
			const res = await fetch(`${API_URL}/api/sessions/switch`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId }),
			});
			const data = await res.json();
			if (data.ok) {
				props.onSwitch(data.messages || []);
			} else {
				alert(data.error || "Failed to switch session");
			}
		} catch (err) {
			console.error("Failed to switch session:", err);
			alert("Failed to switch session");
		} finally {
			setSwitching(null);
		}
	};

	const deleteSession = async (sessionId: string) => {
		if (!confirm("Delete this session? This cannot be undone.")) return;

		setDeleting(sessionId);
		try {
			const res = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
				method: "DELETE",
			});
			const data = await res.json();
			if (data.ok) {
				setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
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

	const truncatePrompt = (prompt: string, maxLen = 60) => {
		if (prompt.length <= maxLen) return prompt;
		return prompt.slice(0, maxLen) + "...";
	};

	const createNewSession = async () => {
		setCreating(true);
		try {
			const res = await fetch(`${API_URL}/api/clear`, { method: "POST" });
			const data = await res.json();
			if (data.ok) {
				props.onNewSession();
			} else {
				alert(data.error || "Failed to create session");
			}
		} catch (err) {
			console.error("Failed to create session:", err);
			alert("Failed to create session");
		} finally {
			setCreating(false);
		}
	};

	return (
		<Show when={props.show}>
			<div
				class="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm"
				onClick={(e) => {
					if (e.target === e.currentTarget) props.onClose();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") props.onClose();
				}}
			>
				<div class="h-full flex flex-col justify-end">
					{/* Content - pinned to bottom */}
					<div class="flex-1 overflow-y-auto p-4 flex flex-col justify-end">
						<Show when={loading()}>
							<div class="flex items-center justify-center h-32">
								<span class="text-muted-foreground">Loading sessions...</span>
							</div>
						</Show>

						<Show when={!loading() && sessions().length === 0}>
							<div class="text-center text-muted-foreground py-8">
								No sessions found
							</div>
						</Show>

						<Show when={!loading() && sessions().length > 0}>
							<div class="space-y-2 max-w-2xl mx-auto w-full">
								<For each={sessions()}>
									{(session, index) => (
										<div
											class={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
												index() === 0
													? "border-primary bg-muted/50"
													: "border-border hover:bg-muted/30"
											}`}
										>
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<span class="text-sm font-medium truncate">
														{truncatePrompt(session.firstPrompt)}
													</span>
												</div>
												<div class="flex items-center gap-2 text-xs text-muted-foreground mt-1">
													<span>{formatDate(session.modified)}</span>
													<span>·</span>
													<span>{session.messageCount} messages</span>
													<Show when={session.gitBranch}>
														<span>·</span>
														<span class="font-mono">{session.gitBranch}</span>
													</Show>
												</div>
											</div>

											<div class="flex items-center gap-2">
												<Show when={index() !== 0}>
													<button
														type="button"
														onClick={() => switchSession(session.sessionId)}
														disabled={switching() === session.sessionId}
														class="px-3 py-1.5 text-sm rounded-md bg-muted hover:bg-muted-foreground/20 disabled:opacity-50 transition-colors"
													>
														{switching() === session.sessionId
															? "..."
															: "Switch"}
													</button>
												</Show>
												<button
													type="button"
													onClick={() => deleteSession(session.sessionId)}
													disabled={deleting() === session.sessionId}
													class="p-1.5 rounded-md text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
													title="Delete session"
												>
													<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
													</svg>
												</button>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>

					{/* Project picker */}
					<Show when={projects().length > 0}>
						<div class="px-4 pb-4 max-w-2xl mx-auto w-full">
							<div class="flex items-center gap-2 overflow-x-auto pb-2">
								<span class="text-xs text-muted-foreground shrink-0">Project:</span>
								<For each={projects()}>
									{(project) => (
										<button
											type="button"
											onClick={() => switchProject(project)}
											disabled={switchingProject() === project}
											class={`px-3 py-1.5 text-sm rounded-md shrink-0 transition-colors ${
												project === currentProject()
													? "bg-primary text-primary-foreground"
													: "bg-muted hover:bg-muted-foreground/20"
											} disabled:opacity-50`}
										>
											{switchingProject() === project ? "..." : project}
										</button>
									)}
								</For>
							</div>
						</div>
					</Show>

					{/* Bottom bar - secondary on left, primary on right */}
					<div class="flex items-center justify-between px-4 pb-6 pt-2">
						<button
							type="button"
							onClick={props.onClose}
							class="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
						>
							Close
						</button>
						<button
							type="button"
							onClick={createNewSession}
							disabled={creating()}
							class="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						>
							{creating() ? "Creating..." : "New Session"}
						</button>
					</div>
				</div>
			</div>
		</Show>
	);
}
