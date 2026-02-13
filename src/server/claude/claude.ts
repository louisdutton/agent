import { type Subprocess, spawn } from "bun";
import { endSession, getCwd, startSession } from "../session";
import type {
	ContentBlock,
	ImageBlock,
	SDKMessage,
	SDKUserMessage,
	TextBlock,
} from "./claude-cli-types";

// Build message content with images
function buildMessageContent(
	message: string,
	images?: string[],
): string | ContentBlock[] {
	if (!images?.length) {
		return message;
	}

	const content: ContentBlock[] = [];

	// Add images first
	for (const img of images) {
		// Parse data URL: data:image/png;base64,<data>
		const match = img.match(/^data:([^;]+);base64,(.+)$/);
		if (match) {
			content.push({
				type: "image",
				source: {
					type: "base64",
					media_type: match[1],
					data: match[2],
				},
			} as ImageBlock);
		}
	}

	// Add text message
	if (message) {
		content.push({ type: "text", text: message } as TextBlock);
	}

	return content;
}

// Parse newline-delimited JSON from the CLI output using Bun.JSONL
async function* parseNDJSON(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SDKMessage> {
	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });

		// Parse complete JSON lines using Bun's native JSONL parser
		const result = Bun.JSONL.parseChunk(buffer);
		for (const message of result.values as SDKMessage[]) {
			yield message;
		}

		// Keep unparsed remainder in buffer
		buffer = buffer.slice(result.read);
	}

	// Process any remaining content
	if (buffer.trim()) {
		const result = Bun.JSONL.parseChunk(buffer);
		for (const message of result.values as SDKMessage[]) {
			yield message;
		}
	}
}

// Spawn the Claude CLI process with the given arguments
function spawnClaudeProcess(
	args: string[],
	cwd: string,
): Subprocess<"pipe", "pipe", "pipe"> {
	return spawn(["nix", "develop", "--command", "claude", ...args], {
		cwd,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
}

// Send a slash command to a session
async function sendSlashCommand(
	command: string,
	sessionId: string,
): Promise<{ success: boolean; error?: string }> {
	const cwd = getCwd();

	console.debug(`Sending ${command} to session: ${sessionId}`);

	try {
		const args = [
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--permission-mode",
			"bypassPermissions",
			"--dangerously-skip-permissions",
			"--resume",
			sessionId,
			command,
		];

		const proc = spawnClaudeProcess(args, cwd);

		// Close stdin immediately since we're passing the command as an argument
		proc.stdin.end();

		// Wait for the process to complete
		const exitCode = await proc.exited;

		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			console.error(`${command} failed with exit code ${exitCode}:`, stderr);
			return { success: false, error: stderr || `Exit code: ${exitCode}` };
		}

		console.debug(`${command} complete`);
		return { success: true };
	} catch (err) {
		console.error(`${command} failed:`, err);
		return { success: false, error: String(err) };
	}
}

// Compact a session's context
export async function compactSession(
	sessionId: string,
): Promise<{ success: boolean; error?: string }> {
	return sendSlashCommand("/compact", sessionId);
}

// Generator that yields session_id when available
// Supports concurrent sessions - each session tracked independently
export async function* sendMessage(
	message: string,
	sessionId: string | null,
	images?: string[],
): AsyncGenerator<string> {
	console.debug(
		`Sending: ${message.slice(0, 50)}...`,
		images?.length ? `(${images.length} images)` : "",
	);

	const cwd = getCwd();

	// Track the actual session ID (may be assigned by Claude for new sessions)
	let actualSessionId = sessionId;

	try {
		const hasImages = images?.length;

		// Build CLI arguments
		const args = [
			"-p",
			"--output-format",
			"stream-json",
			"--verbose",
			"--permission-mode",
			"bypassPermissions",
			"--dangerously-skip-permissions",
			"--include-partial-messages",
			"--append-system-prompt",
			"Your reponses must always be accurate and concise.",
		];

		// Resume existing session if sessionId provided
		if (sessionId) {
			args.push("--resume", sessionId);
		}

		// For text-only messages, pass the message as an argument
		// For messages with images, we need to use stream-json input
		if (hasImages) {
			args.push("--input-format", "stream-json");
		} else {
			// Pass message as the prompt argument
			args.push(message);
		}

		const proc = spawnClaudeProcess(args, cwd);

		// Track session with PID for 1:1 process mapping
		if (sessionId) {
			startSession(sessionId, proc.pid);
		}

		// If we have images, send the message via stdin
		if (hasImages) {
			const userMessage: SDKUserMessage = {
				type: "user",
				session_id: sessionId ?? "",
				message: {
					role: "user",
					content: buildMessageContent(message, images),
				},
				parent_tool_use_id: null,
			};

			proc.stdin.write(`${JSON.stringify(userMessage)}\n`);
			proc.stdin.end();
		} else {
			// Close stdin since we passed the message as an argument
			proc.stdin.end();
		}

		// Read and yield messages from stdout
		const reader = proc.stdout.getReader();

		for await (const event of parseNDJSON(reader)) {
			// Extract session_id from events (for new sessions)
			if (!actualSessionId && "session_id" in event && event.session_id) {
				actualSessionId = event.session_id;
				// Start tracking this new session with PID
				startSession(actualSessionId, proc.pid);
			}
			yield JSON.stringify(event);
		}

		// Check for errors
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			console.error(`Claude process exited with code ${exitCode}:`, stderr);
		}
	} finally {
		// Clean up session tracking
		if (actualSessionId) {
			endSession(actualSessionId);
		}
	}
}
