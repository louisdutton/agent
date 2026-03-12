import { parseArgs } from "node:util";
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

	fetch: elysiaApp.fetch,
});

console.info(`Server running at ${server.url}`);
