import { createResource, createSignal, Show } from "solid-js";
import { api } from "../api";
import { permission, requestNotificationPermission } from "../notifications";
import { PageLayout } from "../page-layout";

export function SettingsPage(props: { onMenuClick: () => void }) {
	const [config, { refetch }] = createResource(async () => {
		const { data } = await api.config.get();
		return data;
	});

	const [saving, setSaving] = createSignal(false);

	const updateRequireApproval = async (value: boolean) => {
		setSaving(true);
		await api.config.patch({ requireApproval: value });
		await refetch();
		setSaving(false);
	};

	return (
		<PageLayout title="Settings" onMenuClick={props.onMenuClick}>
			<div class="space-y-2">
				{/* Notifications */}
				<button
					type="button"
					onClick={() => requestNotificationPermission()}
					class="w-full flex items-center justify-between px-4 py-3 bg-muted rounded-lg active:bg-muted/70 transition-colors"
				>
					<span>Notifications</span>
					<span
						class={`text-sm px-2 py-1 rounded-lg ${
							permission() === "granted"
								? "bg-green-950 text-green-400"
								: permission() === "denied"
									? "bg-red-950 text-red-400"
									: "bg-background text-muted-foreground"
						}`}
					>
						{permission() === "granted"
							? "On"
							: permission() === "denied"
								? "Blocked"
								: "Off"}
					</span>
				</button>

				{/* Require Approval */}
				<Show when={!config.loading && config()}>
					<button
						type="button"
						onClick={() => updateRequireApproval(!config()?.requireApproval)}
						disabled={saving()}
						class="w-full flex items-center justify-between px-4 py-3 bg-muted rounded-lg active:bg-muted/70 transition-colors disabled:opacity-50"
					>
						<span>Require Approval</span>
						<span
							class={`text-sm px-2 py-1 rounded-lg ${
								config()?.requireApproval
									? "bg-green-950 text-green-400"
									: "bg-background text-muted-foreground"
							}`}
						>
							{config()?.requireApproval ? "On" : "Off"}
						</span>
					</button>
				</Show>
			</div>
		</PageLayout>
	);
}
