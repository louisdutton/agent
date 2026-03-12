import { createResource, For, Show } from "solid-js";
import { api } from "../api";
import { PageLayout } from "../page-layout";
import { navigate } from "../router";

type RunHistory = {
	id: string;
	type: "cron" | "webhook";
	automationName: string;
	sessionId: string;
	startedAt: number;
	completedAt?: number;
	status: "running" | "success" | "error";
	error?: string;
};

export function HistoryPage(props: {
	defaultProject: string;
	onMenuClick: () => void;
}) {
	const [history] = createResource(async () => {
		const { data } = await api.automations.history.get();
		return (data as RunHistory[]) || [];
	});

	const formatRelative = (ts: number) => {
		const diff = Date.now() - ts;
		if (diff < 60000) return "just now";
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		return `${Math.floor(diff / 86400000)}d ago`;
	};

	const openSession = (project: string, sessionId: string) => {
		navigate({ type: "chat", project, sessionId });
	};

	return (
		<PageLayout title="History" onMenuClick={props.onMenuClick}>
			<div class="space-y-2">
				<For each={history()}>
					{(run) => (
						<button
							type="button"
							onClick={() => openSession(props.defaultProject, run.sessionId)}
							class="w-full text-left border border-border rounded-lg p-3 hover:bg-muted transition-colors"
						>
							<div class="flex items-center justify-between gap-2">
								<div class="flex items-center gap-2">
									<span
										class={`w-2 h-2 rounded-full ${
											run.status === "running"
												? "bg-yellow-500 animate-pulse"
												: run.status === "success"
													? "bg-green-500"
													: "bg-red-500"
										}`}
									/>
									<span class="font-medium truncate">{run.automationName}</span>
									<span class="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
										{run.type}
									</span>
								</div>
								<span class="text-xs text-muted-foreground">
									{formatRelative(run.startedAt)}
								</span>
							</div>
							<Show when={run.error}>
								<div class="text-xs text-red-500 mt-1 truncate">
									{run.error}
								</div>
							</Show>
						</button>
					)}
				</For>

				<Show when={history()?.length === 0}>
					<div class="text-center text-muted-foreground py-8">
						No run history yet
					</div>
				</Show>
			</div>
		</PageLayout>
	);
}
