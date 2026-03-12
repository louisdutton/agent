import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../api";
import { PageLayout } from "../page-layout";
import { formatRelativeTime } from "../util";

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

export function WebhooksPage(props: {
	defaultProject: string;
	onMenuClick: () => void;
}) {
	const [showWebhookForm, setShowWebhookForm] = createSignal(false);
	const [editingWebhook, setEditingWebhook] = createSignal<Webhook | null>(
		null,
	);

	const [webhooks, { refetch: refetchWebhooks }] = createResource(async () => {
		const { data } = await api.automations.webhooks.get();
		return (data as Webhook[]) || [];
	});

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

	return (
		<PageLayout title="Webhooks" onMenuClick={props.onMenuClick}>
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
										<span class="font-medium truncate">{webhook.name}</span>
									</div>
									<div class="text-xs text-muted-foreground mt-1 font-mono truncate">
										{window.location.origin}
										{webhook.url}
									</div>
									<div class="text-xs text-muted-foreground">
										{webhook.triggerCount} triggers
										<Show when={webhook.lastTrigger}>
											{(lastTrigger) => (
												<> · Last: {formatRelativeTime(lastTrigger())}</>
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
		</PageLayout>
	);
}

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
