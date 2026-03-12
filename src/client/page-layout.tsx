import type { JSX } from "solid-js";
import { HamburgerButton } from "./drawer";

export function PageLayout(props: {
	title: string;
	onMenuClick: () => void;
	children: JSX.Element;
}) {
	return (
		<div class="h-dvh flex flex-col bg-background">
			{/* Header */}
			<header class="flex-none px-4 py-2 border-b border-border z-20 bg-background">
				<div class="max-w-2xl mx-auto flex items-center gap-2">
					<HamburgerButton onClick={props.onMenuClick} />
					<span class="text-foreground font-medium">{props.title}</span>
				</div>
			</header>

			{/* Content */}
			<main class="flex-1 overflow-y-auto p-4">
				<div class="max-w-2xl mx-auto">{props.children}</div>
			</main>
		</div>
	);
}
