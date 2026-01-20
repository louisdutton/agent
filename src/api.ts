import { sendMessage, clearSession } from "./claude";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/^\/api/, "");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // Send message
    if (path === "/messages" && req.method === "POST") {
      const body = (await req.json()) as { message: string };
      console.log(`POST /api/messages:`, body.message?.slice(0, 50));

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
              controller.enqueue(
                encoder.encode(`data: {"error": "${String(err)}"}\n\n`)
              );
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

    // Clear session
    if (path === "/session" && req.method === "DELETE") {
      clearSession();
      console.log("Session cleared");
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    return Response.json(
      { error: "Not found" },
      { status: 404, headers: corsHeaders }
    );
  },
};
