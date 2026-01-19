import { createSession, runClaude, sessions } from "./claude";

// HTTP server
export default {
  port: 3001,
  hostname: "0.0.0.0",
  idleTimeout: 120, // 2 minutes for long-running Claude requests

  async fetch(req) {
    const url = new URL(req.url);

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Create session
    if (url.pathname === "/sessions" && req.method === "POST") {
      const body = await req.json() as { cwd?: string };
      const cwd = body.cwd || process.cwd();
      const session = createSession(cwd);

      return Response.json(
        { id: session.id, cwd: session.cwd, createdAt: session.createdAt },
        { headers: corsHeaders }
      );
    }

    // List sessions
    if (url.pathname === "/sessions" && req.method === "GET") {
      const list = Array.from(sessions.values()).map(s => ({
        id: s.id,
        cwd: s.cwd,
        createdAt: s.createdAt,
      }));
      return Response.json(list, { headers: corsHeaders });
    }

    // Send message
    const messageMatch = url.pathname.match(/^\/sessions\/([^/]+)\/messages$/);
    if (messageMatch && req.method === "POST") {
      const sessionId = messageMatch[1];
      const body = await req.json() as { message: string };
      console.log(`POST /sessions/${sessionId}/messages:`, body.message?.slice(0, 50));

      const session = sessions.get(sessionId);
      if (!session) {
        return Response.json(
          { error: "Session not found" },
          { status: 404, headers: corsHeaders }
        );
      }

      try {
        const lines = await runClaude(session.cwd, body.message);
        console.log(`Got ${lines.length} lines from claude`);

        // Return SSE stream with all lines
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const line of lines) {
              controller.enqueue(encoder.encode(`data: ${line}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      } catch (err) {
        console.error("Error running claude:", err);
        return Response.json(
          { error: String(err) },
          { status: 500, headers: corsHeaders }
        );
      }
    }

    // Delete session
    const deleteMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (deleteMatch && req.method === "DELETE") {
      const sessionId = deleteMatch[1];
      const session = sessions.get(sessionId);
      if (session) {
        session.process.kill();
        sessions.delete(sessionId);
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: corsHeaders }
    );
  },
} satisfies Bun.Serve.Options<{}>

