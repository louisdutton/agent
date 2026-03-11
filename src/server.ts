import { parseArgs } from "util";
import html from "./index.html";
import { app as elysiaApp } from "./server/app";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		port: { type: "string", short: "p", default: "3000" },
	},
});

const server = Bun.serve({
	port: Number(values.port),
	idleTimeout: 120,
	development: { console: true },

	routes: {
		"/": html,
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
		open() {
			console.debug("WebSocket client connected");
		},
		close() {
			console.debug("WebSocket client disconnected");
		},
		message(ws, message) {
			if (message === "ping") {
				ws.send("pong");
			}
		},
	},

	fetch: elysiaApp.fetch,
});

console.info(`Server running at ${server.url}`);
