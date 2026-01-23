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
}) {
	const [sessions, setSessions] = createSignal<SessionListItem[]>([]);
	const [loading, setLoading] = createSignal(false);
	const [switching, setSwitching] = createSignal<string | null>(null);
	const [deleting, setDeleting] = createSignal<string | null>(null);

	// Load sessions when modal opens
	createEffect(() => {
		if (props.show) {
			loadSessions();
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
				<div class="h-full flex flex-col">
					{/* Header */}
					<div class="p-4 border-b border-border">
						<h2 class="text-lg font-medium">Sessions</h2>
						<p class="text-sm text-muted-foreground">
							Switch between or manage your conversation sessions
						</p>
					</div>

					{/* Content */}
					<div class="flex-1 overflow-y-auto p-4">
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
							<div class="space-y-2 max-w-2xl mx-auto">
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
													<Show when={index() === 0}>
														<span class="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
															Current
														</span>
													</Show>
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
													class="px-3 py-1.5 text-sm rounded-md text-red-400 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
												>
													{deleting() === session.sessionId ? "..." : "Delete"}
												</button>
											</div>
										</div>
									)}
								</For>
							</div>
						</Show>
					</div>

					{/* Bottom bar */}
					<div class="flex items-center justify-end p-4 border-t border-border">
						<button
							type="button"
							onClick={props.onClose}
							class="btn-secondary px-4 py-2 text-sm"
						>
							Close
						</button>
					</div>
				</div>
			</div>
		</Show>
	);
}
