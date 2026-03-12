import { For, Show } from "solid-js";
import { navigate, useLocation, type ViewType } from "./router";

type NavItem = {
	type: ViewType["type"];
	label: string;
	icon: string;
};

const navItems: NavItem[] = [
	{ type: "home", label: "Chat", icon: "chat" },
	{ type: "tasks", label: "Tasks", icon: "tasks" },
	{ type: "schedules", label: "Schedules", icon: "clock" },
	{ type: "webhooks", label: "Webhooks", icon: "webhook" },
	{ type: "history", label: "History", icon: "history" },
	{ type: "settings", label: "Settings", icon: "settings" },
];

function NavIcon(props: { icon: string; class?: string }) {
	const icons: Record<string, () => import("solid-js").JSX.Element> = {
		chat: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
			/>
		),
		tasks: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
			/>
		),
		clock: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
			/>
		),
		webhook: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
			/>
		),
		history: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0zM9 12h6"
			/>
		),
		folder: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
			/>
		),
		settings: () => (
			<path
				stroke-linecap="round"
				stroke-linejoin="round"
				stroke-width="2"
				d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
			/>
		),
	};

	const IconPath = icons[props.icon];
	return (
		<svg
			class={props.class || "w-5 h-5"}
			fill="none"
			stroke="currentColor"
			viewBox="0 0 24 24"
		>
			<Show when={IconPath}>
				<IconPath />
			</Show>
			<Show when={props.icon === "settings"}>
				<circle cx="12" cy="12" r="3" stroke-width="2" />
			</Show>
		</svg>
	);
}

export function HamburgerButton(props: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={props.onClick}
			class="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
			title="Menu"
		>
			<svg
				class="w-6 h-6 text-muted-foreground"
				fill="none"
				stroke="currentColor"
				viewBox="0 0 24 24"
			>
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M4 6h16M4 12h16M4 18h16"
				/>
			</svg>
		</button>
	);
}

export function Drawer(props: { open: boolean; onClose: () => void }) {
	const location = useLocation();

	const currentType = (): ViewType["type"] => {
		const loc = location();
		if (loc.page) return loc.page as ViewType["type"];
		if (loc.project) return "chat";
		if (loc.taskId) return "task";
		return "home";
	};

	const handleNav = (type: ViewType["type"]) => {
		props.onClose();
		if (type === "home") {
			navigate({ type: "home" });
		} else if (
			type === "tasks" ||
			type === "schedules" ||
			type === "webhooks" ||
			type === "history" ||
			type === "settings"
		) {
			navigate({ type });
		}
	};

	return (
		<Show when={props.open}>
			{/* Backdrop */}
			<div
				class="fixed inset-0 bg-black/50 z-40"
				onClick={props.onClose}
				onKeyDown={(e) => e.key === "Escape" && props.onClose()}
			/>

			{/* Drawer */}
			<div class="fixed inset-y-0 left-0 w-64 bg-background z-50 shadow-xl flex flex-col">
				{/* Header */}
				<div class="flex items-center justify-between px-4 py-3 border-b border-border">
					<span class="font-semibold">Menu</span>
					<button
						type="button"
						onClick={props.onClose}
						class="w-10 h-10 flex items-center justify-center hover:bg-muted rounded-lg transition-colors"
					>
						<svg
							class="w-5 h-5"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>

				{/* Nav items */}
				<nav class="flex-1 p-2 space-y-1">
					<For each={navItems}>
						{(item) => (
							<button
								type="button"
								onClick={() => handleNav(item.type)}
								class={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors ${
									currentType() === item.type
										? "bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted/50"
								}`}
							>
								<NavIcon icon={item.icon} />
								<span>{item.label}</span>
							</button>
						)}
					</For>
				</nav>
			</div>
		</Show>
	);
}
