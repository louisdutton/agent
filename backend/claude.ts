import { spawn, type Subprocess } from "bun";

interface Session {
  id: string;
  process: Subprocess<"pipe", "pipe", "pipe">;
  cwd: string;
  createdAt: Date;
}

export const sessions = new Map<string, Session>();

// Spawn a new Claude CLI session
export function createSession(cwd: string): Session {
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
export async function runClaude(cwd: string, message: string): Promise<string[]> {
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

