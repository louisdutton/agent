import { sendMessage } from "./claude";

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

    // Send message
    if (url.pathname === "/messages" && req.method === "POST") {
      const body = await req.json() as { message: string };
      console.log(`POST /messages:`, body.message?.slice(0, 50));

      try {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            try {
              for await (const line of sendMessage(body.message)) {
                controller.enqueue(encoder.encode(`data: ${line}\n\n`));
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            } catch (err) {
              console.error("Stream error:", err);
              controller.enqueue(encoder.encode(`data: {"error": "${String(err)}"}\n\n`));
            } finally {
              controller.close();
            }
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

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: corsHeaders }
    );
  },
} satisfies Bun.Serve.Options<{}>



