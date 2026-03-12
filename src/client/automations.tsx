// Automations panel - manage cron jobs and webhooks

import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "./api";

type CronJob = {
	id: string;
	name: string;
	schedule: string;
	scheduleDescription: string;
	prompt: string;
	project: string;
	enabled: boolean;
	nextRun: string | null;
	lastRun?: number;
	lastResult?: "success" | "error";
};

type Webhook = {
	id: string;
	name: string;
	url: string;
	prompt: string;
	project: string;
	enabled: boolean;
	lastTrigger?: number;
	triggerCount: number;
};

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

type Tab = "jobs" | "webhooks" | "history";

export function AutomationsPanel(props: {
	defaultProject: string;
	onClose: () => void;
	onOpenSession: (project: string, sessionId: string) => void;
}) {
	const [tab, setTab] = createSignal<Tab>("jobs");
	const [showJobForm, setShowJobForm] = createSignal(false);
	const [showWebhookForm, setShowWebhookForm] = createSignal(false);
	const [editingJob, setEditingJob] = createSignal<CronJob | null>(null);
	const [editingWebhook, setEditingWebhook] = createSignal<Webhook | null>(
		null,
	);

	const [jobs, { refetch: refetchJobs }] = createResource(async () => {
		const { data } = await api.automations.jobs.get();
		return (data as CronJob[]) || [];
	});

	const [webhooks, { refetch: refetchWebhooks }] = createResource(async () => {
		const { data } = await api.automations.webhooks.get();
		return (data as Webhook[]) || [];
	});

	const [history, { refetch: refetchHistory }] = createResource(async () => {
		const { data } = await api.automations.history.get();
		return (data as RunHistory[]) || [];
	});

	const deleteJob = async (id: string) => {
		if (!confirm("Delete this scheduled job?")) return;
		await api.automations.jobs({ id }).delete();
		refetchJobs();
	};

	const toggleJob = async (job: CronJob) => {
		await api.automations.jobs({ id: job.id }).patch({ enabled: !job.enabled });
		refetchJobs();
	};

	const runJobNow = async (id: string) => {
		await api.automations.jobs({ id }).run.post();
		refetchHistory();
	};

	const deleteWebhook = async (id: string) => {
		if (!confirm("Delete this webhook?")) return;
		await api.automations.webhooks({ id }).delete();
		refetchWebhooks();
	};

	const toggleWebhook = async (webhook: Webhook) => {
		await api.automations
			.webhooks({ id: webhook.id })
			.patch({ enabled: !webhook.enabled });
		refetchWebhooks();
	};

	const formatDate = (ts: number) => {
		const date = new Date(ts);
		return date.toLocaleString();
	};

	const formatRelative = (ts: number) => {
		const diff = Date.now() - ts;
		if (diff < 60000) return "just now";
		if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
		if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
		return `${Math.floor(diff / 86400000)}d ago`;
	};

	return (
		<div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
			<div class="bg-background w-full max-w-lg max-h-[85vh] rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden">
				{/* Header */}
				<div class="flex items-center justify-between px-4 py-3 border-b border-border">
					<h2 class="text-lg font-semibold">Automations</h2>
					<button
						type="button"
						onClick={props.onClose}
						class="p-2 hover:bg-muted rounded-lg transition-colors"
					>
						<svg
							class="w-5 h-5"
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

				{/* Tabs */}
				<div class="flex border-b border-border">
					<button
						type="button"
						onClick={() => setTab("jobs")}
						class={`flex-1 px-4 py-2 text-sm font-medium ${tab() === "jobs" ? "text-foreground border-b-2 border-foreground" : "text-muted-foreground"}`}
					>
						Scheduled
					</button>
					<button
						type="button"
						onClick={() => setTab("webhooks")}
						class={`flex-1 px-4 py-2 text-sm font-medium ${tab() === "webhooks" ? "text-foreground border-b-2 border-foreground" : "text-muted-foreground"}`}
					>
						Webhooks
					</button>
					<button
						type="button"
						onClick={() => {
							setTab("history");
							refetchHistory();
						}}
						class={`flex-1 px-4 py-2 text-sm font-medium ${tab() === "history" ? "text-foreground border-b-2 border-foreground" : "text-muted-foreground"}`}
					>
						History
					</button>
				</div>

				{/* Content */}
				<div class="flex-1 overflow-y-auto p-4">
					{/* Jobs Tab */}
					<Show when={tab() === "jobs"}>
						<div class="space-y-3">
							<Show when={!showJobForm() && !editingJob()}>
								<button
									type="button"
									onClick={() => setShowJobForm(true)}
									class="w-full py-2 px-4 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
								>
									+ Add scheduled job
								</button>
							</Show>

							<Show when={showJobForm() || editingJob()}>
								<JobForm
									job={editingJob()}
									defaultProject={props.defaultProject}
									onSave={() => {
										setShowJobForm(false);
										setEditingJob(null);
										refetchJobs();
									}}
									onCancel={() => {
										setShowJobForm(false);
										setEditingJob(null);
									}}
								/>
							</Show>

							<For each={jobs()}>
								{(job) => (
									<div class="border border-border rounded-lg p-3">
										<div class="flex items-start justify-between gap-2">
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<span
														class={`w-2 h-2 rounded-full ${job.enabled ? "bg-green-500" : "bg-gray-400"}`}
													/>
													<span class="font-medium truncate">{job.name}</span>
												</div>
												<div class="text-xs text-muted-foreground mt-1">
													{job.scheduleDescription}
												</div>
												<Show when={job.nextRun}>
													{(nextRun) => (
														<div class="text-xs text-muted-foreground">
															Next: {formatDate(new Date(nextRun()).getTime())}
														</div>
													)}
												</Show>
											</div>
											<div class="flex items-center gap-1">
												<button
													type="button"
													onClick={() => runJobNow(job.id)}
													class="p-1.5 hover:bg-muted rounded transition-colors"
													title="Run now"
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
															d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
														/>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															stroke-width="2"
															d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
														/>
													</svg>
												</button>
												<button
													type="button"
													onClick={() => toggleJob(job)}
													class="p-1.5 hover:bg-muted rounded transition-colors"
													title={job.enabled ? "Disable" : "Enable"}
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
															d={
																job.enabled
																	? "M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
																	: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
															}
														/>
													</svg>
												</button>
												<button
													type="button"
													onClick={() => setEditingJob(job)}
													class="p-1.5 hover:bg-muted rounded transition-colors"
													title="Edit"
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
															d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
														/>
													</svg>
												</button>
												<button
													type="button"
													onClick={() => deleteJob(job.id)}
													class="p-1.5 hover:bg-muted rounded transition-colors text-red-500"
													title="Delete"
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
										</div>
									</div>
								)}
							</For>

							<Show when={jobs()?.length === 0 && !showJobForm()}>
								<div class="text-center text-muted-foreground py-8">
									No scheduled jobs yet
								</div>
							</Show>
						</div>
					</Show>

					{/* Webhooks Tab */}
					<Show when={tab() === "webhooks"}>
						<div class="space-y-3">
							<Show when={!showWebhookForm() && !editingWebhook()}>
								<button
									type="button"
									onClick={() => setShowWebhookForm(true)}
									class="w-full py-2 px-4 border border-dashed border-border rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
								>
									+ Add webhook
								</button>
							</Show>

							<Show when={showWebhookForm() || editingWebhook()}>
								<WebhookForm
									webhook={editingWebhook()}
									defaultProject={props.defaultProject}
									onSave={() => {
										setShowWebhookForm(false);
										setEditingWebhook(null);
										refetchWebhooks();
									}}
									onCancel={() => {
										setShowWebhookForm(false);
										setEditingWebhook(null);
									}}
								/>
							</Show>

							<For each={webhooks()}>
								{(webhook) => (
									<div class="border border-border rounded-lg p-3">
										<div class="flex items-start justify-between gap-2">
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<span
														class={`w-2 h-2 rounded-full ${webhook.enabled ? "bg-green-500" : "bg-gray-400"}`}
													/>
													<span class="font-medium truncate">
														{webhook.name}
													</span>
												</div>
												<div class="text-xs text-muted-foreground mt-1 font-mono truncate">
													{window.location.origin}
													{webhook.url}
												</div>
												<div class="text-xs text-muted-foreground">
													{webhook.triggerCount} triggers
													<Show when={webhook.lastTrigger}>
														{(lastTrigger) => (
															<> · Last: {formatRelative(lastTrigger())}</>
														)}
													</Show>
												</div>
											</div>
											<div class="flex items-center gap-1">
												<button
													type="button"
													onClick={() => {
														navigator.clipboard.writeText(
															`${window.location.origin}${webhook.url}`,
														);
													}}
													class="p-1.5 hover:bg-muted rounded transition-colors"
													title="Copy URL"
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
															d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
														/>
													</svg>
												</button>
												<button
													type="button"
													onClick={() => toggleWebhook(webhook)}
													class="p-1.5 hover:bg-muted rounded transition-colors"
													title={webhook.enabled ? "Disable" : "Enable"}
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
															d={
																webhook.enabled
																	? "M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
																	: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
															}
														/>
													</svg>
												</button>
												<button
													type="button"
													onClick={() => setEditingWebhook(webhook)}
													class="p-1.5 hover:bg-muted rounded transition-colors"
													title="Edit"
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
															d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
														/>
													</svg>
												</button>
												<button
													type="button"
													onClick={() => deleteWebhook(webhook.id)}
													class="p-1.5 hover:bg-muted rounded transition-colors text-red-500"
													title="Delete"
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
										</div>
									</div>
								)}
							</For>

							<Show when={webhooks()?.length === 0 && !showWebhookForm()}>
								<div class="text-center text-muted-foreground py-8">
									No webhooks yet
								</div>
							</Show>
						</div>
					</Show>

					{/* History Tab */}
					<Show when={tab() === "history"}>
						<div class="space-y-2">
							<For each={history()}>
								{(run) => (
									<button
										type="button"
										onClick={() =>
											props.onOpenSession(props.defaultProject, run.sessionId)
										}
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
												<span class="font-medium truncate">
													{run.automationName}
												</span>
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
					</Show>
				</div>
			</div>
		</div>
	);
}

// Job creation/edit form
function JobForm(props: {
	job: CronJob | null;
	defaultProject: string;
	onSave: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = createSignal(props.job?.name || "");
	const [schedule, setSchedule] = createSignal(
		props.job?.schedule || "0 9 * * *",
	);
	const [prompt, setPrompt] = createSignal(props.job?.prompt || "");
	const [project, setProject] = createSignal(
		props.job?.project || props.defaultProject,
	);
	const [error, setError] = createSignal("");
	const [saving, setSaving] = createSignal(false);

	const presets = [
		{ label: "Every hour", value: "0 * * * *" },
		{ label: "Daily 9am", value: "0 9 * * *" },
		{ label: "Weekdays 9am", value: "0 9 * * 1-5" },
		{ label: "Weekly Sunday", value: "0 0 * * 0" },
		{ label: "Monthly 1st", value: "0 0 1 * *" },
	];

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError("");
		setSaving(true);

		try {
			if (props.job) {
				const { data } = await api.automations
					.jobs({ id: props.job.id })
					.patch({
						name: name(),
						schedule: schedule(),
						prompt: prompt(),
						project: project(),
					});
				if ((data as { error?: string })?.error) {
					setError((data as { error: string }).error);
					return;
				}
			} else {
				const { data } = await api.automations.jobs.post({
					name: name(),
					schedule: schedule(),
					prompt: prompt(),
					project: project(),
					enabled: true,
				});
				if ((data as { error?: string })?.error) {
					setError((data as { error: string }).error);
					return;
				}
			}
			props.onSave();
		} catch (err) {
			setError(String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			onSubmit={handleSubmit}
			class="border border-border rounded-lg p-3 space-y-3"
		>
			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Name</span>
				<input
					type="text"
					value={name()}
					onInput={(e) => setName(e.currentTarget.value)}
					placeholder="Daily code review"
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
					required
				/>
			</label>

			<div>
				<span class="block text-xs text-muted-foreground mb-1">Schedule</span>
				<div class="flex flex-wrap gap-1 mb-2">
					<For each={presets}>
						{(preset) => (
							<button
								type="button"
								onClick={() => setSchedule(preset.value)}
								class={`px-2 py-1 text-xs rounded ${schedule() === preset.value ? "bg-foreground text-background" : "bg-muted"}`}
							>
								{preset.label}
							</button>
						)}
					</For>
				</div>
				<label class="sr-only" for="schedule-input">
					Schedule cron expression
				</label>
				<input
					id="schedule-input"
					type="text"
					value={schedule()}
					onInput={(e) => setSchedule(e.currentTarget.value)}
					placeholder="0 9 * * *"
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background font-mono"
					required
				/>
			</div>

			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Prompt</span>
				<textarea
					value={prompt()}
					onInput={(e) => setPrompt(e.currentTarget.value)}
					placeholder="Review recent commits and summarize changes..."
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background min-h-[80px]"
					required
				/>
			</label>

			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Project</span>
				<input
					type="text"
					value={project()}
					onInput={(e) => setProject(e.currentTarget.value)}
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background font-mono"
					required
				/>
			</label>

			<Show when={error()}>
				<div class="text-xs text-red-500">{error()}</div>
			</Show>

			<div class="flex gap-2 justify-end">
				<button
					type="button"
					onClick={props.onCancel}
					class="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={saving()}
					class="px-3 py-1.5 text-sm rounded-lg bg-foreground text-background disabled:opacity-50"
				>
					{saving() ? "Saving..." : props.job ? "Update" : "Create"}
				</button>
			</div>
		</form>
	);
}

// Webhook creation/edit form
function WebhookForm(props: {
	webhook: Webhook | null;
	defaultProject: string;
	onSave: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = createSignal(props.webhook?.name || "");
	const [prompt, setPrompt] = createSignal(
		props.webhook?.prompt || "Process this webhook payload:\n\n{{payload}}",
	);
	const [project, setProject] = createSignal(
		props.webhook?.project || props.defaultProject,
	);
	const [error, setError] = createSignal("");
	const [saving, setSaving] = createSignal(false);

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		setError("");
		setSaving(true);

		try {
			if (props.webhook) {
				const { data } = await api.automations
					.webhooks({ id: props.webhook.id })
					.patch({
						name: name(),
						prompt: prompt(),
						project: project(),
					});
				if ((data as { error?: string })?.error) {
					setError((data as { error: string }).error);
					return;
				}
			} else {
				const { data } = await api.automations.webhooks.post({
					name: name(),
					prompt: prompt(),
					project: project(),
					enabled: true,
				});
				const errData = data as unknown as { error?: string };
				if (errData?.error) {
					setError(errData.error);
					return;
				}
			}
			props.onSave();
		} catch (err) {
			setError(String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			onSubmit={handleSubmit}
			class="border border-border rounded-lg p-3 space-y-3"
		>
			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Name</span>
				<input
					type="text"
					value={name()}
					onInput={(e) => setName(e.currentTarget.value)}
					placeholder="GitHub PR webhook"
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
					required
				/>
			</label>

			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">
					Prompt template
				</span>
				<div class="text-xs text-muted-foreground mb-1">
					Use {"{{payload}}"} to include the webhook payload
				</div>
				<textarea
					value={prompt()}
					onInput={(e) => setPrompt(e.currentTarget.value)}
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background min-h-[100px] font-mono"
					required
				/>
			</label>

			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Project</span>
				<input
					type="text"
					value={project()}
					onInput={(e) => setProject(e.currentTarget.value)}
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background font-mono"
					required
				/>
			</label>

			<Show when={error()}>
				<div class="text-xs text-red-500">{error()}</div>
			</Show>

			<div class="flex gap-2 justify-end">
				<button
					type="button"
					onClick={props.onCancel}
					class="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={saving()}
					class="px-3 py-1.5 text-sm rounded-lg bg-foreground text-background disabled:opacity-50"
				>
					{saving() ? "Saving..." : props.webhook ? "Update" : "Create"}
				</button>
			</div>
		</form>
	);
}
