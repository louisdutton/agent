import { createResource, createSignal, Show } from "solid-js";
import { api } from "../api";
import {
	type EntityAction,
	EntityList,
	type EntityListItem,
	FloatingActionButton,
	Icons,
} from "../entity-list";
import {
	FormField,
	FullScreenForm,
	TextArea,
	TextInput,
} from "../full-screen-form";
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

	const closeForm = () => {
		setShowWebhookForm(false);
		setEditingWebhook(null);
	};

	const handleSave = () => {
		closeForm();
		refetchWebhooks();
	};

	return (
		<>
			<PageLayout title="Webhooks" onMenuClick={props.onMenuClick}>
				<EntityList
					items={entityItems()}
					loading={webhooks.loading}
					emptyMessage="No webhooks yet"
					actions={getActionsForWebhook}
				/>

				<Show when={!showWebhookForm() && !editingWebhook()}>
					<FloatingActionButton
						icon={Icons.Plus()}
						label="Add webhook"
						onClick={() => setShowWebhookForm(true)}
					/>
				</Show>
			</PageLayout>

			<Show when={showWebhookForm() || editingWebhook()}>
				<WebhookForm
					webhook={editingWebhook()}
					defaultProject={props.defaultProject}
					onSave={handleSave}
					onCancel={closeForm}
				/>
			</Show>
		</>
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
		<FullScreenForm
			title={props.webhook ? "Edit Webhook" : "New Webhook"}
			onSubmit={handleSubmit}
			onCancel={props.onCancel}
			submitText={props.webhook ? "Update" : "Create"}
			saving={saving()}
			error={error()}
		>
			<FormField label="Name">
				<TextInput
					value={name()}
					onInput={setName}
					placeholder="GitHub PR webhook"
					required
				/>
			</FormField>

			<FormField
				label="Prompt template"
				hint="Use {{payload}} to include the webhook payload"
			>
				<TextArea
					value={prompt()}
					onInput={setPrompt}
					required
					rows={6}
					monospace
				/>
			</FormField>

			<FormField label="Project">
				<TextInput value={project()} onInput={setProject} required monospace />
			</FormField>
		</FullScreenForm>
	);
}
