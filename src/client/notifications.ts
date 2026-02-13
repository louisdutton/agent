import { createSignal } from "solid-js";

export type NotificationPermission = "default" | "granted" | "denied";

const [permission, setPermission] = createSignal<NotificationPermission>(
	typeof Notification !== "undefined" ? Notification.permission : "default",
);

export { permission };

export async function requestNotificationPermission(): Promise<NotificationPermission> {
	if (typeof Notification === "undefined") {
		return "denied";
	}

	const result = await Notification.requestPermission();
	setPermission(result);
	return result;
}

export function sendNotification(
	title: string,
	options?: NotificationOptions,
): void {
	if (permission() !== "granted") return;

	// Only notify if page is not visible (user switched away)
	if (document.visibilityState === "visible") return;

	const notification = new Notification(title, {
		icon: "/public/icon.svg",
		badge: "/public/icon.svg",
		tag: "claude-response",
		...options,
	});

	notification.onclick = () => {
		window.focus();
		notification.close();
	};
}

export function notifyClaudeFinished(preview?: string): void {
	sendNotification("Claude finished", {
		body: preview ? preview.slice(0, 100) : "Response ready",
	});
}

export function notifyClaudeError(error: string): void {
	sendNotification("Claude error", {
		body: error.slice(0, 100),
	});
}
