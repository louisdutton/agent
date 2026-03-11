// Session status bar - floating indicator for active sessions

import { createSignal, For, Show } from "solid-js";
import {
	type ActiveSession,
	activeSessions,
	approvalQueue,
	type QueuedApproval,
} from "./session-state";

type Props = {
	currentSessionId: string | null;
	onSelectSession: (session: ActiveSession) => void;
	onApprove: (approval: QueuedApproval, approved: boolean) => void;
};

export function SessionStatusBar(props: Props) {
	const [expanded, setExpanded] = createSignal(false);

	const otherSessions = () => {
		const all = Array.from(activeSessions().values());
		return all.filter(
			(s) =>
				s.id !== props.currentSessionId &&
				(s.status === "running" || s.status === "waiting"),
		);
	};

	const otherApprovals = () => {
		return approvalQueue().filter(
			(a) => a.sessionId !== props.currentSessionId,
		);
	};

	const runningCount = () =>
		otherSessions().filter((s) => s.status === "running").length;
	const waitingCount = () => otherApprovals().length;

	const hasActivity = () => runningCount() > 0 || waitingCount() > 0;

	return (
		<Show when={hasActivity()}>
			<div class="fixed top-2 left-1/2 -translate-x-1/2 z-30">
				{/* Collapsed indicator */}
				<Show when={!expanded()}>
					<button
						type="button"
						onClick={() => setExpanded(true)}
						class="flex items-center gap-2 px-3 py-1.5 bg-muted border border-border rounded-full shadow-lg hover:bg-muted/80 transition-colors"
					>
						<Show when={runningCount() > 0}>
							<span class="flex items-center gap-1 text-xs">
								<span class="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
								<span class="text-muted-foreground">{runningCount()}</span>
							</span>
						</Show>
						<Show when={waitingCount() > 0}>
							<span class="flex items-center gap-1 text-xs">
								<span class="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
								<span class="text-muted-foreground">{waitingCount()}</span>
							</span>
						</Show>
					</button>
				</Show>

				{/* Expanded panel */}
				<Show when={expanded()}>
					<div class="bg-muted border border-border rounded-xl shadow-lg min-w-[280px] max-w-[400px]">
						{/* Header */}
						<div class="flex items-center justify-between px-3 py-2 border-b border-border">
							<span class="text-sm font-medium">Active Sessions</span>
							<button
								type="button"
								onClick={() => setExpanded(false)}
								class="p-1 hover:bg-background rounded"
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
										d="M6 18L18 6M6 6l12 12"
									/>
								</svg>
							</button>
						</div>

						{/* Sessions list */}
						<div class="max-h-[300px] overflow-y-auto">
							<For each={otherSessions()}>
								{(session) => (
									<button
										type="button"
										onClick={() => {
											props.onSelectSession(session);
											setExpanded(false);
										}}
										class="w-full px-3 py-2 flex items-start gap-2 hover:bg-background/50 transition-colors text-left border-b border-border/50 last:border-b-0"
									>
										<span
											class={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
												session.status === "running"
													? "bg-yellow-500 animate-pulse"
													: session.status === "waiting"
														? "bg-orange-500 animate-pulse"
														: "bg-gray-400"
											}`}
										/>
										<div class="flex-1 min-w-0">
											<div class="text-sm truncate">
												{session.title || "Untitled"}
											</div>
											<div class="text-xs text-muted-foreground truncate">
												{session.projectName}
											</div>
										</div>
									</button>
								)}
							</For>

							{/* Pending approvals from other sessions */}
							<For each={otherApprovals()}>
								{(approval) => (
									<div class="px-3 py-2 border-b border-border/50 last:border-b-0 bg-orange-500/5">
										<div class="flex items-center gap-2 mb-1">
											<span class="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
											<span class="text-sm font-medium">
												{approval.request.toolName}
											</span>
										</div>
										<div class="text-xs text-muted-foreground mb-2 truncate">
											{approval.projectName}
										</div>
										<div class="flex gap-2">
											<button
												type="button"
												onClick={() => props.onApprove(approval, false)}
												class="flex-1 px-2 py-1 text-xs rounded border border-border hover:bg-background transition-colors"
											>
												Reject
											</button>
											<button
												type="button"
												onClick={() => props.onApprove(approval, true)}
												class="flex-1 px-2 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors"
											>
												Approve
											</button>
										</div>
									</div>
								)}
							</For>
						</div>
					</div>
				</Show>
			</div>
		</Show>
	);
}
