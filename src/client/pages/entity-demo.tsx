import { createSignal, Show } from "solid-js";
import {
	type EntityAction,
	EntityList,
	type EntityListItem,
	FloatingActionButton,
	Icons,
} from "../entity-list";
import { PageLayout } from "../page-layout";

type DemoItem = {
	id: string;
	name: string;
	type: string;
	enabled: boolean;
	created: Date;
};

export function EntityDemoPage(props: { onMenuClick: () => void }) {
	const [items, setItems] = createSignal<DemoItem[]>([
		{
			id: "1",
			name: "Sample Schedule",
			type: "schedule",
			enabled: true,
			created: new Date(Date.now() - 86400000), // Yesterday
		},
		{
			id: "2",
			name: "GitHub Webhook",
			type: "webhook",
			enabled: false,
			created: new Date(Date.now() - 3600000), // 1 hour ago
		},
		{
			id: "3",
			name: "Daily Backup Task",
			type: "task",
			enabled: true,
			created: new Date(), // Now
		},
	]);

	const [showForm, setShowForm] = createSignal(false);
	const [editingItem, setEditingItem] = createSignal<DemoItem | null>(null);
	const [loading, setLoading] = createSignal(false);

	const deleteItem = async (item: DemoItem) => {
		if (!confirm(`Delete ${item.name}?`)) return;
		setItems(items().filter((i) => i.id !== item.id));
	};

	const toggleItem = async (item: DemoItem) => {
		setItems(
			items().map((i) =>
				i.id === item.id ? { ...i, enabled: !i.enabled } : i,
			),
		);
	};

	const copyItem = async (item: DemoItem) => {
		await navigator.clipboard.writeText(`${item.type}: ${item.name}`);
		alert("Copied to clipboard!");
	};

	// Transform data to EntityListItem format
	const entityItems = (): EntityListItem<DemoItem>[] => {
		return items().map((item) => ({
			id: item.id,
			title: item.name,
			subtitle: `Type: ${item.type}`,
			description: `Created: ${item.created.toLocaleDateString()}`,
			status: item.enabled ? "enabled" : "disabled",
			data: item,
		}));
	};

	// Define actions for each item
	const getActionsForItem = (item: DemoItem): EntityAction<DemoItem>[] => [
		{
			icon: Icons.Copy(),
			label: "Copy",
			onClick: copyItem,
		},
		{
			icon: Icons.Toggle(item.enabled),
			label: item.enabled ? "Disable" : "Enable",
			onClick: toggleItem,
		},
		{
			icon: Icons.Edit(),
			label: "Edit",
			onClick: (item) => {
				setEditingItem(item);
				setShowForm(true);
			},
		},
		{
			icon: Icons.Delete(),
			label: "Delete",
			onClick: deleteItem,
			variant: "danger",
		},
	];

	const handleSave = () => {
		const editing = editingItem();
		if (editing) {
			// Update existing item
			setItems(items().map((i) => (i.id === editing.id ? editing : i)));
		} else {
			// Add new item
			const newItem: DemoItem = {
				id: Date.now().toString(),
				name: "New Item",
				type: "demo",
				enabled: true,
				created: new Date(),
			};
			setItems([...items(), newItem]);
		}
		setShowForm(false);
		setEditingItem(null);
	};

	const handleCancel = () => {
		setShowForm(false);
		setEditingItem(null);
	};

	return (
		<PageLayout title="Entity List Demo" onMenuClick={props.onMenuClick}>
			<div class="space-y-4">
				<div class="text-sm text-muted-foreground">
					This demonstrates the standardized EntityList component with:
					<ul class="list-disc list-inside mt-2 space-y-1">
						<li>Consistent card-based layout</li>
						<li>Status indicators (enabled/disabled)</li>
						<li>Action buttons (copy, toggle, edit, delete)</li>
						<li>Mobile-friendly floating action button</li>
						<li>Inline form support</li>
					</ul>
				</div>

				<EntityList
					items={entityItems()}
					loading={loading()}
					emptyMessage="No demo items yet"
					addButtonText="+ Add demo item"
					showAddButton={!showForm()}
					onAdd={() => setShowForm(true)}
					actions={getActionsForItem}
				>
					<Show when={showForm()}>
						<DemoForm
							item={editingItem()}
							onSave={handleSave}
							onCancel={handleCancel}
						/>
					</Show>
				</EntityList>

				{/* Mobile floating action button */}
				<Show when={!showForm()}>
					<FloatingActionButton
						icon={Icons.Plus()}
						label="Add demo item"
						onClick={() => setShowForm(true)}
					/>
				</Show>
			</div>
		</PageLayout>
	);
}

function DemoForm(props: {
	item: DemoItem | null;
	onSave: () => void;
	onCancel: () => void;
}) {
	const [name, setName] = createSignal(props.item?.name || "");
	const [type, setType] = createSignal(props.item?.type || "demo");

	const handleSubmit = (e: Event) => {
		e.preventDefault();
		// In a real app, you'd update the item here
		props.onSave();
	};

	return (
		<form
			onSubmit={handleSubmit}
			class="border border-border rounded-lg p-3 space-y-3 mb-20"
		>
			<h3 class="text-sm font-medium">
				{props.item ? "Edit Item" : "Add New Item"}
			</h3>

			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Name</span>
				<input
					type="text"
					value={name()}
					onInput={(e) => setName(e.currentTarget.value)}
					placeholder="Item name"
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
					required
				/>
			</label>

			<label class="block">
				<span class="block text-xs text-muted-foreground mb-1">Type</span>
				<select
					value={type()}
					onChange={(e) => setType(e.currentTarget.value)}
					class="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
				>
					<option value="demo">Demo</option>
					<option value="schedule">Schedule</option>
					<option value="webhook">Webhook</option>
					<option value="task">Task</option>
				</select>
			</label>

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
					class="px-3 py-1.5 text-sm rounded-lg bg-foreground text-background"
				>
					{props.item ? "Update" : "Add"}
				</button>
			</div>
		</form>
	);
}
