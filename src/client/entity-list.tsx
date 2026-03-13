import { createSignal, For, type JSX, Show } from "solid-js";

export type EntityAction<T> = {
	icon: JSX.Element;
	label: string;
	onClick: (item: T) => void;
	variant?: "default" | "danger";
};

export type EntityListItem<T> = {
	id: string;
	title: string;
	subtitle?: string;
	description?: string;
	status?: "enabled" | "disabled" | "success" | "error" | "warning";
	metadata?: string;
	data: T;
};

export function EntityList<T>(props: {
	items: EntityListItem<T>[];
	loading?: boolean;
	emptyMessage: string;
	actions?: EntityAction<T>[] | ((item: T) => EntityAction<T>[]);
	onItemClick?: (item: T) => void;
	customRenderer?: (
		item: EntityListItem<T>,
		actions?: EntityAction<T>[],
	) => JSX.Element;
}) {
	const getStatusColor = (status?: string) => {
		switch (status) {
			case "enabled":
				return "bg-green-500";
			case "disabled":
				return "bg-gray-400";
			case "success":
				return "bg-green-500";
			case "error":
				return "bg-red-500";
			case "warning":
				return "bg-yellow-500";
			default:
				return "bg-gray-400";
		}
	};

	const getActionsForItem = (item: EntityListItem<T>): EntityAction<T>[] => {
		if (typeof props.actions === "function") {
			return props.actions(item.data);
		}
		return props.actions || [];
	};

	return (
		<div class="space-y-3">
			{/* Items list */}
			<For each={props.items}>
				{(item) => {
					const actions = getActionsForItem(item);

					// Use custom renderer if provided
					if (props.customRenderer) {
						return props.customRenderer(item, actions);
					}

					// Default renderer
					return (
						<EntityCard
							item={item}
							actions={actions}
							statusColor={getStatusColor(item.status)}
							onClick={
								props.onItemClick
									? () => props.onItemClick?.(item.data)
									: undefined
							}
						/>
					);
				}}
			</For>

			{/* Empty state */}
			<Show when={props.items?.length === 0 && !props.loading}>
				<div class="text-center text-muted-foreground py-8">
					{props.emptyMessage}
				</div>
			</Show>

			{/* Loading state */}
			<Show when={props.loading}>
				<div class="text-center text-muted-foreground py-8">Loading...</div>
			</Show>
		</div>
	);
}

function EntityCard<T>(props: {
	item: EntityListItem<T>;
	actions?: EntityAction<T>[];
	statusColor: string;
	onClick?: () => void;
}) {
	return (
		<div
			class={`border border-border rounded-lg p-3 ${props.onClick ? "cursor-pointer active:bg-muted/30" : ""}`}
			onClick={props.onClick}
		>
			<div class="flex items-start justify-between gap-2">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<Show when={props.item.status}>
							<span class={`w-2 h-2 rounded-full ${props.statusColor}`} />
						</Show>
						<span class="font-medium truncate">{props.item.title}</span>
					</div>
					<Show when={props.item.subtitle}>
						<div class="text-xs text-muted-foreground mt-1 font-mono truncate">
							{props.item.subtitle}
						</div>
					</Show>
					<Show when={props.item.description}>
						<div class="text-xs text-muted-foreground mt-1">
							{props.item.description}
						</div>
					</Show>
					<Show when={props.item.metadata}>
						<div class="text-xs text-muted-foreground">
							{props.item.metadata}
						</div>
					</Show>
				</div>
				<Show when={props.actions && props.actions.length > 0}>
					<div class="flex items-center gap-1">
						<For each={props.actions}>
							{(action) => (
								<button
									type="button"
									onClick={() => action.onClick(props.item.data)}
									class={`p-1.5 hover:bg-muted rounded transition-colors ${
										action.variant === "danger" ? "text-red-500" : ""
									}`}
									title={action.label}
								>
									{action.icon}
								</button>
							)}
						</For>
					</div>
				</Show>
			</div>
		</div>
	);
}

// Floating action button for mobile-friendly add functionality
export function FloatingActionButton(props: {
	onClick: () => void;
	icon: JSX.Element;
	label?: string;
	disabled?: boolean;
}) {
	const [showLabel, setShowLabel] = createSignal(false);

	return (
		<div class="fixed bottom-6 right-6 z-50">
			<button
				type="button"
				onClick={props.onClick}
				disabled={props.disabled}
				onMouseEnter={() => setShowLabel(true)}
				onMouseLeave={() => setShowLabel(false)}
				class="w-12 h-12 rounded-full bg-foreground text-background shadow-lg hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
				title={props.label}
			>
				{props.icon}
			</button>

			<Show when={showLabel() && props.label}>
				<div class="absolute bottom-full right-0 mb-2 px-2 py-1 bg-foreground text-background text-xs rounded whitespace-nowrap">
					{props.label}
				</div>
			</Show>
		</div>
	);
}

// Common icons as SVG components for consistency
export const Icons = {
	Plus: () => (
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 4v16m8-8H4"
			/>
		</svg>
	),

	Play: () => (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
	),

	Pause: () => (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		</svg>
	),

	Edit: () => (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
			/>
		</svg>
	),

	Delete: () => (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
			/>
		</svg>
	),

	Copy: () => (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
			/>
		</svg>
	),

	Toggle: (enabled: boolean) => (
		<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d={
					enabled
						? "M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
						: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
				}
			/>
		</svg>
	),
};
