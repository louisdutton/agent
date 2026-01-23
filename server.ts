import api from "./src/api";
import app from "./index.html";

const tls = {
  cert: Bun.file(`${Bun.env.HOME}/.local/share/tailscale/certs/mini.taila65fcf.ts.net.crt`),
  key: Bun.file(`${Bun.env.HOME}/.local/share/tailscale/certs/mini.taila65fcf.ts.net.key`),
};

const server = Bun.serve({
  port: 3000,
  hostname: "0.0.0.0",
  idleTimeout: 120,
  tls: (await tls.cert.exists()) && (await tls.key.exists()) ? tls : undefined,

  routes: {
    "/": app,
    "/api/*": api.fetch,
    "/public/*": (req) => {
      const url = new URL(req.url)
      try {
        const file = Bun.file(`.${url.pathname}`);
        return new Response(file);
      } catch {
        return new Response(null, { status: 404 });
      }
    },
  },

  development: {
    hmr: true,
    console: true
  }
});

console.log(`Server running at ${server.url}`);
