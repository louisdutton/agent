import { createResource, createSignal, Show } from "solid-js";
import { api } from "../api";
import {
	type EntityAction,
	EntityList,
	type EntityListItem,
	FloatingActionButton,
	Icons,
} from "../entity-list";
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

	const deleteWebhook = async (webhook: Webhook) => {
		if (!confirm("Delete this webhook?")) return;
		await api.automations.webhooks({ id: webhook.id }).delete();
		refetchWebhooks();
	};

	const toggleWebhook = async (webhook: Webhook) => {
		await api.automations
			.webhooks({ id: webhook.id })
			.patch({ enabled: !webhook.enabled });
		refetchWebhooks();
	};

	const copyWebhookUrl = async (webhook: Webhook) => {
		await navigator.clipboard.writeText(
			`${window.location.origin}${webhook.url}`,
		);
	};

	// Transform webhooks data into EntityListItem format
	const entityItems = (): EntityListItem<Webhook>[] => {
		return (webhooks() || []).map((webhook) => {
			const triggerInfo = `${webhook.triggerCount} triggers`;
			const lastTriggerInfo = webhook.lastTrigger
				? ` · Last: ${formatRelativeTime(webhook.lastTrigger)}`
				: "";

			return {
				id: webhook.id,
				title: webhook.name,
				subtitle: `${window.location.origin}${webhook.url}`,
				description: triggerInfo + lastTriggerInfo,
				status: webhook.enabled ? "enabled" : "disabled",
				data: webhook,
			};
		});
	};

	// Define actions function that returns actions for each webhook
	const getActionsForWebhook = (webhook: Webhook): EntityAction<Webhook>[] => [
		{
			icon: Icons.Copy(),
			label: "Copy URL",
			onClick: copyWebhookUrl,
		},
		{
			icon: Icons.Toggle(webhook.enabled),
			label: webhook.enabled ? "Disable" : "Enable",
			onClick: toggleWebhook,
		},
		{
			icon: Icons.Edit(),
			label: "Edit",
			onClick: (webhook) => setEditingWebhook(webhook),
		},
		{
			icon: Icons.Delete(),
			label: "Delete",
			onClick: deleteWebhook,
			variant: "danger",
		},
	];

	return (
		<PageLayout title="Webhooks" onMenuClick={props.onMenuClick}>
			<EntityList
				items={entityItems()}
				loading={webhooks.loading}
				emptyMessage="No webhooks yet"
				actions={getActionsForWebhook}
			>
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
			</EntityList>

			{/* Mobile-friendly floating action button - shown only when form is not visible */}
			<Show when={!showWebhookForm() && !editingWebhook()}>
				<FloatingActionButton
					icon={Icons.Plus()}
					label="Add webhook"
					onClick={() => setShowWebhookForm(true)}
				/>
			</Show>
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
			class="border border-border rounded-lg p-3 space-y-3 mb-20" // Extra margin bottom for mobile FAB
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
