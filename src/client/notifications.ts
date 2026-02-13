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

export async function sendNotification(
	title: string,
	options?: NotificationOptions,
): Promise<void> {
	if (permission() !== "granted") return;

	// Only notify if page is not visible (user switched away)
	if (document.visibilityState === "visible") return;

	// Use service worker notification for Android PWA support
	const registration = await navigator.serviceWorker?.ready;
	if (registration) {
		await registration.showNotification(title, {
			icon: "/public/icon.svg",
			badge: "/public/icon.svg",
			tag: "claude-response",
			...options,
		});
	} else {
		// Fallback for desktop browsers without service worker
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
}

export async function notifyClaudeFinished(preview?: string): Promise<void> {
	await sendNotification("Claude finished", {
		body: preview ? preview.slice(0, 100) : "Response ready",
	});
}

export async function notifyClaudeError(error: string): Promise<void> {
	await sendNotification("Claude error", {
		body: error.slice(0, 100),
	});
}
