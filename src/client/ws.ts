// Notification subscription via SSE (replaces WebSocket)

import type { SessionStatus } from "../server/wire/types";

type NotificationEvent =
	| {
			type: "session_status";
			sessionId: string;
			projectPath: string;
			status: SessionStatus;
			title?: string;
	  }
	| {
			type: "approval_needed";
			sessionId: string;
			projectPath: string;
			request: {
				id: string;
				toolCallId: string;
				toolName: string;
				input: unknown;
				description: string;
			};
	  }
	| {
			type: "session_error";
			sessionId: string;
			projectPath: string;
			error: string;
	  };

type Subscriber = (event: NotificationEvent) => void;

const subscribers = new Set<Subscriber>();
let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
	if (eventSource) return;

	eventSource = new EventSource("/api/sessions/notifications");

	eventSource.onmessage = (e) => {
		try {
			const data = JSON.parse(e.data);
			if (data.type === "connected") return;

			for (const subscriber of subscribers) {
				try {
					subscriber(data as NotificationEvent);
				} catch (err) {
					console.error("Notification subscriber error:", err);
				}
			}
		} catch {
			// Ignore parse errors
		}
	};

	eventSource.onerror = () => {
		eventSource?.close();
		eventSource = null;

		// Reconnect after 2 seconds
		if (!reconnectTimer) {
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				if (subscribers.size > 0) {
					connect();
				}
			}, 2000);
		}
	};
}

export function initWebSocket(): void {
	connect();
}

export function subscribeToNotifications(callback: Subscriber): () => void {
	subscribers.add(callback);

	// Connect if not already connected
	if (!eventSource) {
		connect();
	}

	return () => {
		subscribers.delete(callback);

		// Disconnect if no more subscribers
		if (subscribers.size === 0 && eventSource) {
			eventSource.close();
			eventSource = null;
		}
	};
}
