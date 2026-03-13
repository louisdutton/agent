import { createResource, createSignal, For, Show } from "solid-js";
import { api } from "../api";
import {
	type EntityAction,
	EntityList,
	type EntityListItem,
	FloatingActionButton,
	Icons,
} from "../entity-list";
import { PageLayout } from "../page-layout";

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

export function SchedulesPage(props: {
	defaultProject: string;
	onMenuClick: () => void;
}) {
	const [showJobForm, setShowJobForm] = createSignal(false);
	const [editingJob, setEditingJob] = createSignal<CronJob | null>(null);

	const [jobs, { refetch: refetchJobs }] = createResource(async () => {
		const { data } = await api.automations.jobs.get();
		return (data as CronJob[]) || [];
	});

	const deleteJob = async (job: CronJob) => {
		if (!confirm("Delete this scheduled job?")) return;
		await api.automations.jobs({ id: job.id }).delete();
		refetchJobs();
	};

	const toggleJob = async (job: CronJob) => {
		await api.automations.jobs({ id: job.id }).patch({ enabled: !job.enabled });
		refetchJobs();
	};

	const runJobNow = async (job: CronJob) => {
		await api.automations.jobs({ id: job.id }).run.post();
	};

	const formatDate = (ts: number) => {
		const date = new Date(ts);
		return date.toLocaleString();
	};

	// Transform jobs data into EntityListItem format
	const entityItems = (): EntityListItem<CronJob>[] => {
		return (jobs() || []).map((job) => ({
			id: job.id,
			title: job.name,
			subtitle: job.scheduleDescription,
			description: job.nextRun
				? `Next: ${formatDate(new Date(job.nextRun).getTime())}`
				: undefined,
			status: job.enabled ? "enabled" : "disabled",
			data: job,
		}));
	};

	// Define actions function that returns actions for each job
	const getActionsForJob = (job: CronJob): EntityAction<CronJob>[] => [
		{
			icon: Icons.Play(),
			label: "Run now",
			onClick: runJobNow,
		},
		{
			icon: Icons.Toggle(job.enabled),
			label: job.enabled ? "Disable" : "Enable",
			onClick: toggleJob,
		},
		{
			icon: Icons.Edit(),
			label: "Edit",
			onClick: (job) => setEditingJob(job),
		},
		{
			icon: Icons.Delete(),
			label: "Delete",
			onClick: deleteJob,
			variant: "danger",
		},
	];

	return (
		<PageLayout title="Schedules" onMenuClick={props.onMenuClick}>
			<EntityList
				items={entityItems()}
				loading={jobs.loading}
				emptyMessage="No scheduled jobs yet"
				addButtonText="+ Add scheduled job"
				showAddButton={!showJobForm() && !editingJob()}
				onAdd={() => setShowJobForm(true)}
				actions={getActionsForJob}
			>
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
			</EntityList>

			{/* Mobile-friendly floating action button - shown only when form is not visible */}
			<Show when={!showJobForm() && !editingJob()}>
				<FloatingActionButton
					icon={Icons.Plus()}
					label="Add scheduled job"
					onClick={() => setShowJobForm(true)}
				/>
			</Show>
		</PageLayout>
	);
}

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
			class="border border-border rounded-lg p-3 space-y-3 mb-20" // Extra margin bottom for mobile FAB
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
