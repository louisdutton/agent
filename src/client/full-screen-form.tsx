import { For, type JSX, Show } from "solid-js";

// Full-screen mobile form container
export function FullScreenForm(props: {
	title: string;
	onSubmit: (e: Event) => void;
	onCancel: () => void;
	submitText?: string;
	saving?: boolean;
	error?: string;
	children: JSX.Element;
}) {
	return (
		<div class="fixed inset-0 z-50 bg-background flex flex-col">
			{/* Header */}
			<div class="flex items-center justify-center px-4 py-3 border-b border-border">
				<h1 class="text-lg font-medium">{props.title}</h1>
			</div>

			{/* Scrollable content */}
			<form
				id="fullscreen-form"
				onSubmit={props.onSubmit}
				class="flex-1 overflow-y-auto px-4 py-4 space-y-4"
			>
				{props.children}

				<Show when={props.error}>
					<div class="text-sm text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">
						{props.error}
					</div>
				</Show>
			</form>

			{/* Fixed footer */}
			<div class="flex gap-3 px-4 py-4 border-t border-border">
				<button
					type="button"
					onClick={props.onCancel}
					class="flex-1 py-3 rounded-xl border border-border font-medium active:bg-muted transition-colors"
				>
					Cancel
				</button>
				<button
					type="submit"
					form="fullscreen-form"
					disabled={props.saving}
					class="flex-1 py-3 rounded-xl bg-foreground text-background font-medium disabled:opacity-50 active:scale-[0.98] transition-transform"
				>
					{props.saving ? "Saving..." : props.submitText || "Save"}
				</button>
			</div>
		</div>
	);
}

// Standardized form field wrapper
export function FormField(props: {
	label: string;
	hint?: string;
	children: JSX.Element;
}) {
	return (
		<label class="block">
			<span class="block text-sm font-medium mb-1.5">{props.label}</span>
			<Show when={props.hint}>
				<span class="block text-xs text-muted-foreground mb-1.5">
					{props.hint}
				</span>
			</Show>
			{props.children}
		</label>
	);
}

// Text input
export function TextInput(props: {
	value: string;
	onInput: (value: string) => void;
	placeholder?: string;
	required?: boolean;
	monospace?: boolean;
}) {
	return (
		<input
			type="text"
			value={props.value}
			onInput={(e) => props.onInput(e.currentTarget.value)}
			placeholder={props.placeholder}
			required={props.required}
			class={`w-full px-4 py-3 text-base rounded-xl border border-border bg-background ${
				props.monospace ? "font-mono text-sm" : ""
			}`}
		/>
	);
}

// Textarea
export function TextArea(props: {
	value: string;
	onInput: (value: string) => void;
	placeholder?: string;
	required?: boolean;
	rows?: number;
	monospace?: boolean;
}) {
	return (
		<textarea
			value={props.value}
			onInput={(e) => props.onInput(e.currentTarget.value)}
			placeholder={props.placeholder}
			required={props.required}
			rows={props.rows || 4}
			class={`w-full px-4 py-3 text-base rounded-xl border border-border bg-background resize-none ${
				props.monospace ? "font-mono text-sm" : ""
			}`}
		/>
	);
}

// Chip selector for presets
export function ChipSelect(props: {
	options: { label: string; value: string }[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div class="flex flex-wrap gap-2">
			<For each={props.options}>
				{(option) => (
					<button
						type="button"
						onClick={() => props.onChange(option.value)}
						class={`px-3 py-1.5 text-sm rounded-full transition-colors ${
							props.value === option.value
								? "bg-foreground text-background"
								: "bg-muted hover:bg-muted/80"
						}`}
					>
						{option.label}
					</button>
				)}
			</For>
		</div>
	);
}
