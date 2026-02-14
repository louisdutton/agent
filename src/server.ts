import type { ServerWebSocket } from "bun";
import { parseArgs } from "util";
import app from "./index.html";
import { apiFallback, routes } from "./server/api";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		port: { type: "string", short: "p", default: "3000" },
	},
});

// Single client WebSocket connection
let clientWs: ServerWebSocket<unknown> | null = null;

// Send message to connected client (if any)
export function wsSend(data: object) {
	if (clientWs?.readyState === WebSocket.OPEN) {
		clientWs.send(JSON.stringify(data));
	}
}

const server = Bun.serve({
	port: Number(values.port),
	idleTimeout: 120,
	development: { console: true },

	routes: {
		"/": app,
		...routes,
		// Serve SW from root so it can control the whole site
		"/sw.js": () =>
			new Response(Bun.file("./public/sw.js"), {
				headers: { "Content-Type": "application/javascript" },
			}),
		"/ws": (req, server) => {
			if (server.upgrade(req)) {
				return undefined;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		},
		"/public/*": (req) => {
			const url = new URL(req.url);
			try {
				const file = Bun.file(`.${url.pathname}`);
				return new Response(file);
			} catch {
				return new Response(null, { status: 404 });
			}
		},
	},

	websocket: {
		open(ws) {
			clientWs = ws;
			console.debug("WebSocket client connected");
		},
		close() {
			clientWs = null;
			console.debug("WebSocket client disconnected");
		},
		message(ws, message) {
			if (message === "ping") {
				ws.send("pong");
			}
		},
	},

	fetch: apiFallback,
});

console.info(`Server running at ${server.url}`);
