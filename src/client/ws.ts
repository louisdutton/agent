// Connection management - WebSocket for keepalive, SSE for notifications

import { createSignal } from "solid-js";
import type { NotificationEvent } from "../server/wire/types";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

const [status, setStatus] = createSignal<ConnectionStatus>("disconnected");
export { status as connectionStatus };

// WebSocket for ping/pong keepalive
let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// SSE for notifications
let eventSource: EventSource | null = null;
let sseReconnectTimeout: ReturnType<typeof setTimeout> | null = null;

const RECONNECT_DELAY = 2000;
const PING_INTERVAL = 30000;

// Notification handlers
type NotificationHandler = (event: NotificationEvent) => void;
const handlers = new Set<NotificationHandler>();

export function subscribeToNotifications(
	handler: NotificationHandler,
): () => void {
	handlers.add(handler);
	return () => handlers.delete(handler);
}

function cleanupWs() {
	if (pingInterval) {
		clearInterval(pingInterval);
		pingInterval = null;
	}
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}
}

function cleanupSse() {
	if (sseReconnectTimeout) {
		clearTimeout(sseReconnectTimeout);
		sseReconnectTimeout = null;
	}
}

function connectWs() {
	cleanupWs();
	setStatus("connecting");

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

	ws.onopen = () => {
		setStatus("connected");
		pingInterval = setInterval(() => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send("ping");
			}
		}, PING_INTERVAL);
	};

	ws.onclose = () => {
		setStatus("disconnected");
		cleanupWs();
		reconnectTimeout = setTimeout(connectWs, RECONNECT_DELAY);
	};

	ws.onerror = () => {
		ws?.close();
	};

	ws.onmessage = () => {
		// Just ping/pong, no notifications here
	};
}

function connectSse() {
	cleanupSse();

	eventSource = new EventSource("/api/sessions/notifications");

	eventSource.onmessage = (event) => {
		try {
			const data = JSON.parse(event.data);
			// Skip connection confirmation
			if (data.type === "connected") return;

			for (const handler of handlers) {
				try {
					handler(data as NotificationEvent);
				} catch (err) {
					console.error("Notification handler error:", err);
				}
			}
		} catch {
			// Ignore parse errors
		}
	};

	eventSource.onerror = () => {
		eventSource?.close();
		eventSource = null;
		sseReconnectTimeout = setTimeout(connectSse, RECONNECT_DELAY);
	};
}

export function initWebSocket() {
	connectWs();
	connectSse();
}

export function disconnectWebSocket() {
	cleanupWs();
	cleanupSse();

	if (ws) {
		ws.onclose = null;
		ws.close();
		ws = null;
	}

	if (eventSource) {
		eventSource.close();
		eventSource = null;
	}

	setStatus("disconnected");
}
