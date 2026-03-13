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
	ChipSelect,
	FormField,
	FullScreenForm,
	TextArea,
	TextInput,
} from "../full-screen-form";
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

	const closeForm = () => {
		setShowJobForm(false);
		setEditingJob(null);
	};

	const handleSave = () => {
		closeForm();
		refetchJobs();
	};

	return (
		<>
			<PageLayout title="Schedules" onMenuClick={props.onMenuClick}>
				<EntityList
					items={entityItems()}
					loading={jobs.loading}
					emptyMessage="No scheduled jobs yet"
					actions={getActionsForJob}
				/>

				<Show when={!showJobForm() && !editingJob()}>
					<FloatingActionButton
						icon={Icons.Plus()}
						label="Add scheduled job"
						onClick={() => setShowJobForm(true)}
					/>
				</Show>
			</PageLayout>

			<Show when={showJobForm() || editingJob()}>
				<JobForm
					job={editingJob()}
					defaultProject={props.defaultProject}
					onSave={handleSave}
					onCancel={closeForm}
				/>
			</Show>
		</>
	);
}

const SCHEDULE_PRESETS = [
	{ label: "Hourly", value: "0 * * * *" },
	{ label: "Daily 9am", value: "0 9 * * *" },
	{ label: "Weekdays", value: "0 9 * * 1-5" },
	{ label: "Weekly", value: "0 0 * * 0" },
	{ label: "Monthly", value: "0 0 1 * *" },
];

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
		<FullScreenForm
			title={props.job ? "Edit Schedule" : "New Schedule"}
			onSubmit={handleSubmit}
			onCancel={props.onCancel}
			submitText={props.job ? "Update" : "Create"}
			saving={saving()}
			error={error()}
		>
			<FormField label="Name">
				<TextInput
					value={name()}
					onInput={setName}
					placeholder="Daily code review"
					required
				/>
			</FormField>

			<FormField label="Schedule">
				<ChipSelect
					options={SCHEDULE_PRESETS}
					value={schedule()}
					onChange={setSchedule}
				/>
				<div class="mt-2">
					<TextInput
						value={schedule()}
						onInput={setSchedule}
						placeholder="0 9 * * *"
						required
						monospace
					/>
				</div>
			</FormField>

			<FormField label="Prompt">
				<TextArea
					value={prompt()}
					onInput={setPrompt}
					placeholder="Review recent commits and summarize changes..."
					required
					rows={5}
				/>
			</FormField>

			<FormField label="Project">
				<TextInput value={project()} onInput={setProject} required monospace />
			</FormField>
		</FullScreenForm>
	);
}
