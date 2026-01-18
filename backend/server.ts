import { spawn, type Subprocess } from "bun";

interface Session {
  id: string;
  process: Subprocess<"pipe", "pipe", "pipe">;
  cwd: string;
  createdAt: Date;
}

const sessions = new Map<string, Session>();

// Spawn a new Claude CLI session
function createSession(cwd: string): Session {
  const id = crypto.randomUUID();

  const process = spawn({
    cmd: [
      "claude",
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ],
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const session: Session = {
    id,
    process,
    cwd,
    createdAt: new Date(),
  };

  sessions.set(id, session);
  return session;
}

// Send a message to a session and collect all output
async function runClaude(cwd: string, message: string): Promise<string[]> {
  console.log(`Running claude in ${cwd}: ${message.slice(0, 50)}...`);

  const proc = Bun.spawn({
    cmd: [
      "claude",
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      message,
    ],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  console.log(`Spawned claude process, pid:`, proc.pid);

  // Read all stdout
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  console.log(`stdout length:`, stdout.length);
  if (stderr) console.error(`stderr:`, stderr);

  const exitCode = await proc.exited;
  console.log(`Process exited with code:`, exitCode);

  // Split into lines
  return stdout.split("\n").filter(line => line.trim());
}

// HTTP server
const server = Bun.serve({
  port: 3001,
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
});

console.log(`Backend server running at http://localhost:${server.port}`);
