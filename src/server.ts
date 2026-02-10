import { parseArgs } from "util";
import app from "./index.html";
import { apiFallback, routes } from "./server/api";

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		port: { type: "string", short: "p", default: "3000" },
	},
});

const server = Bun.serve({
	port: Number(values.port),
	idleTimeout: 120,

	routes: {
		"/": app,
		...routes,
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

	fetch: apiFallback,
});

console.info(`Server running at ${server.url}`);
