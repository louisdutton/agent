import { spawn, type Subprocess } from "bun";
import assert from "assert"

interface Session {
  id: string;
  process: Subprocess<"pipe", "pipe", "pipe">;
  cwd: string;
  createdAt: Date;
}

export const sessions = new Map<string, Session>();

const bin = Bun.which("claude")
assert(bin)
const cmd = [
  bin,
  "--verbose",
  "--output-format", "stream-json",
  "--dangerously-skip-permissions",
]

// Pre-spawn a claude process at module load time (avoids Bun spawn bug in request context)
function spawnClaude(cwd: string) {
  return spawn({
    cmd,
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  });
}

// Eagerly spawn a default session at startup
const defaultCwd = process.cwd();
const eagerProcess = spawnClaude(defaultCwd);
const eagerId = crypto.randomUUID();
const eagerSession: Session = {
  id: eagerId,
  process: eagerProcess,
  cwd: defaultCwd,
  createdAt: new Date(),
};
sessions.set(eagerId, eagerSession);
console.log(`Pre-spawned claude session: ${eagerId}`);

// Get or create a session - returns the pre-spawned one if cwd matches
export function createSession(cwd: string): Session {
  // If cwd matches the eager session and it's still available, return it
  if (cwd === defaultCwd && sessions.has(eagerId)) {
    return eagerSession;
  }

  // Otherwise we'd need to spawn a new one - for now just return eager session
  // TODO: handle different cwds by pre-spawning more processes
  console.warn(`Requested cwd ${cwd} differs from eager session ${defaultCwd}, using eager session anyway`);
  return eagerSession;
}

// Send a message to a session and collect all output
export async function runClaude(cwd: string, message: string): Promise<string[]> {
  console.log(`Running claude in ${cwd}: ${message.slice(0, 50)}...`);

  const proc = Bun.spawn({
    cmd: [
      ...cmd,
      message,
    ],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
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

