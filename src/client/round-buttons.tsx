import type { JSX, Setter } from "solid-js";
import { For, Show } from "solid-js";
import { permission, requestNotificationPermission } from "./notifications";

export type VoiceStatus =
	| "idle"
	| "recording"
	| "transcribing"
	| "thinking"
	| "speaking";

export function MicButton(props: {
	status: VoiceStatus;
	audioLevels: number[];
	disabled?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={props.onClick}
			disabled={props.disabled}
			class={`w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg ${
				props.status === "recording"
					? "bg-foreground scale-110"
					: props.status === "speaking"
						? "bg-green-500"
						: props.status === "thinking"
							? "bg-red-500 hover:scale-105 active:scale-95"
							: props.status === "transcribing"
								? "bg-yellow-500"
								: "bg-foreground hover:scale-105 active:scale-95"
			}`}
		>
			{props.status === "recording" ? (
				<div class="flex items-center justify-center gap-1 w-12 h-12 bg-white/20 rounded-full">
					<For each={props.audioLevels}>
						{(level) => (
							<div
								class="w-1.5 bg-black rounded-full transition-all duration-75"
								style={{ height: `${8 + level * 24}px` }}
							/>
						)}
					</For>
				</div>
			) : (
				<svg
					class={`w-8 h-8 ${props.status === "idle" ? "text-background" : "text-white"}`}
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					{props.status === "thinking" ? (
						<rect
							x="6"
							y="6"
							width="12"
							height="12"
							rx="2"
							fill="currentColor"
						/>
					) : props.status === "speaking" ? (
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.5 8.5l5-3.5v14l-5-3.5H4a1 1 0 01-1-1v-5a1 1 0 011-1h2.5z"
						/>
					) : (
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
						/>
					)}
				</svg>
			)}
		</button>
	);
}

export function OptionsMenuButton(props: {
	menuRef?: HTMLDivElement;
	showMenu: boolean;
	setShowMenu: Setter<boolean>;
	children: JSX.Element;
}) {
	return (
		<div ref={props.menuRef} class="relative">
			<button
				type="button"
				onClick={() => props.setShowMenu(!props.showMenu)}
				class="w-20 h-20 rounded-full flex items-center justify-center bg-background border border-white/30 hover:bg-muted transition-colors shadow-lg"
				title="Options"
			>
				<svg
					class="w-8 h-8 text-muted-foreground"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
					/>
				</svg>
			</button>

			<Show when={props.showMenu}>{props.children}</Show>
		</div>
	);
}

export function OptionsMenu(props: {
	showTextInput: boolean;
	onToggleTextInput: () => void;
	onCompact: () => void;
	onClear: () => void;
	isCompacting: boolean;
	isClearing: boolean;
	isLoading: boolean;
}) {
	return (
		<div class="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 bg-background border border-border rounded-lg shadow-lg min-w-48">
			<button
				type="button"
				onClick={props.onToggleTextInput}
				class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm rounded-t-lg"
			>
				{props.showTextInput ? "Hide Text Input" : "Show Text Input"}
			</button>
			<button
				type="button"
				onClick={props.onCompact}
				disabled={props.isCompacting || props.isClearing || props.isLoading}
				class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm disabled:opacity-50"
			>
				{props.isCompacting ? "Compacting..." : "Compact Context"}
			</button>
			<button
				type="button"
				onClick={props.onClear}
				disabled={props.isCompacting || props.isClearing || props.isLoading}
				class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm disabled:opacity-50"
			>
				{props.isClearing ? "Clearing..." : "Clear Context"}
			</button>
			<button
				type="button"
				onClick={() => requestNotificationPermission()}
				class="w-full text-left px-4 py-2 hover:bg-muted transition-colors text-sm rounded-b-lg flex items-center justify-between"
			>
				<span>Notifications</span>
				<span
					class={`text-xs px-1.5 py-0.5 rounded ${
						permission() === "granted"
							? "bg-green-500/20 text-green-400"
							: permission() === "denied"
								? "bg-red-500/20 text-red-400"
								: "bg-muted text-muted-foreground"
					}`}
				>
					{permission() === "granted"
						? "On"
						: permission() === "denied"
							? "Blocked"
							: "Off"}
				</span>
			</button>
		</div>
	);
}
