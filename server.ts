import api from "./src/api";
import app from "./index.html";

const server = Bun.serve({
  port: Number(Bun.env.PORT) || 3000,
  idleTimeout: 120,

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
  }
});

console.log(`Server running at ${server.url}`);
