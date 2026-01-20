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
    "/api/*": api.fetch,
    "/": app,
  },
});

console.log(`Server running at ${server.url}`);
