// Production static file server
import api from "./src/api";

const distDir = import.meta.dir;

Bun.serve({
  port: Number(Bun.env.PORT) || 9370,
  idleTimeout: 120,

  async fetch(req) {
    const url = new URL(req.url);

    // API routes
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(req);
    }

    // Static files
    const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(distDir + filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    // SPA fallback
    return new Response(Bun.file(distDir + "/index.html"));
  }
});

console.log(`Server running on port ${Bun.env.PORT || 9370}`);
