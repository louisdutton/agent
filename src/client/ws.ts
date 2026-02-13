import { createSignal } from "solid-js";

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

const [status, setStatus] = createSignal<ConnectionStatus>("disconnected");
export { status as connectionStatus };

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;

const RECONNECT_DELAY = 2000;
const PING_INTERVAL = 30000;

function cleanup() {
	if (pingInterval) {
		clearInterval(pingInterval);
		pingInterval = null;
	}
	if (reconnectTimeout) {
		clearTimeout(reconnectTimeout);
		reconnectTimeout = null;
	}
}

function connect() {
	cleanup();
	setStatus("connecting");

	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

	ws.onopen = () => {
		setStatus("connected");
		// Start ping interval to detect dead connections
		pingInterval = setInterval(() => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send("ping");
			}
		}, PING_INTERVAL);
	};

	ws.onclose = () => {
		setStatus("disconnected");
		cleanup();
		// Auto-reconnect
		reconnectTimeout = setTimeout(connect, RECONNECT_DELAY);
	};

	ws.onerror = () => {
		// onclose will be called after onerror, triggering reconnect
		ws?.close();
	};

	ws.onmessage = (event) => {
		// Handle server-pushed messages here if needed
		if (event.data === "pong") return;

		try {
			const data = JSON.parse(event.data);
			// Future: handle server push events (session status, etc.)
			console.debug("WS message:", data);
		} catch {
			// Ignore non-JSON messages
		}
	};
}

export function initWebSocket() {
	connect();
}

export function disconnectWebSocket() {
	cleanup();
	if (ws) {
		ws.onclose = null; // Prevent auto-reconnect
		ws.close();
		ws = null;
	}
	setStatus("disconnected");
}
