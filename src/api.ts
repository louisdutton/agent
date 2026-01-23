import { homedir } from "os";
import { join } from "path";
import { clearSession, sendMessage } from "./claude";

const corsHeaders = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:8080";
const KOKORO_URL = process.env.KOKORO_URL || "http://localhost:8880";

// Get Claude session history from ~/.claude/projects/
async function getSessionHistory() {
	const cwd = process.cwd();
	const projectFolder = cwd.replace(/\//g, "-");
	const claudeDir = join(homedir(), ".claude", "projects", projectFolder);
	const indexPath = join(claudeDir, "sessions-index.json");

	try {
		const indexFile = Bun.file(indexPath);
		if (!(await indexFile.exists())) return [];

		const index = await indexFile.json();
		const sessions = index.entries
			.filter((e: { isSidechain: boolean }) => !e.isSidechain)
			.sort(
				(a: { modified: string }, b: { modified: string }) =>
					new Date(b.modified).getTime() - new Date(a.modified).getTime(),
			);

		if (sessions.length === 0) return [];

		const latestSession = sessions[0];
		const transcriptPath = latestSession.fullPath;
		const transcriptFile = Bun.file(transcriptPath);
		if (!(await transcriptFile.exists())) return [];

		const content = await transcriptFile.text();
		const lines = content.trim().split("\n").filter(Boolean);

		type Message = { type: "user" | "assistant"; id: string; content: string };
		const messages: Message[] = [];

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "user" && entry.message?.content) {
					const textBlocks = entry.message.content.filter(
						(b: { type: string }) => b.type === "text",
					);
					const text = textBlocks.map((b: { text: string }) => b.text).join("");
					if (text) {
						messages.push({ type: "user", id: entry.uuid, content: text });
					}
				} else if (entry.type === "assistant" && entry.message?.content) {
					const textBlocks = entry.message.content.filter(
						(b: { type: string }) => b.type === "text",
					);
					const text = textBlocks.map((b: { text: string }) => b.text).join("");
					if (text) {
						messages.push({ type: "assistant", id: entry.uuid, content: text });
					}
				}
			} catch {
				// Skip invalid JSON lines
			}
		}

		return messages;
	} catch (err) {
		console.error("Error reading session history:", err);
		return [];
	}
}

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
								encoder.encode(`data: {"error": "${String(err)}"}\n\n`),
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
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Get session history
		if (path === "/history" && req.method === "GET") {
			const messages = await getSessionHistory();
			return Response.json({ messages }, { headers: corsHeaders });
		}

		// Clear session
		if ((path === "/session" && req.method === "DELETE") || (path === "/clear" && req.method === "POST")) {
			clearSession();
			console.log("Session cleared");
			return Response.json({ ok: true }, { headers: corsHeaders });
		}

		// Transcribe audio via Whisper
		if (path === "/transcribe" && req.method === "POST") {
			try {
				const formData = await req.formData();
				const audioFile = formData.get("audio") as File;

				if (!audioFile) {
					return Response.json(
						{ error: "No audio file" },
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(`POST /api/transcribe: ${audioFile.size} bytes`);

				// Convert WebM to WAV using FFmpeg (whisper.cpp requires WAV)
				const inputBuffer = await audioFile.arrayBuffer();
				const ffmpeg = Bun.spawn(
					[
						"ffmpeg",
						"-i",
						"pipe:0",
						"-ar",
						"16000",
						"-ac",
						"1",
						"-f",
						"wav",
						"pipe:1",
					],
					{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
				);
				ffmpeg.stdin.write(new Uint8Array(inputBuffer));
				ffmpeg.stdin.end();
				const wavBuffer = await new Response(ffmpeg.stdout).arrayBuffer();
				const exitCode = await ffmpeg.exited;
				if (exitCode !== 0) {
					const stderr = await new Response(ffmpeg.stderr).text();
					console.error("FFmpeg error:", stderr);
					return Response.json(
						{ error: "Audio conversion failed" },
						{ status: 500, headers: corsHeaders },
					);
				}

				// Forward to Whisper server (whisper.cpp format)
				const whisperForm = new FormData();
				whisperForm.append(
					"file",
					new Blob([wavBuffer], { type: "audio/wav" }),
					"audio.wav",
				);
				whisperForm.append("response_format", "json");

				const whisperRes = await fetch(`${WHISPER_URL}/inference`, {
					method: "POST",
					body: whisperForm,
				});

				if (!whisperRes.ok) {
					const errText = await whisperRes.text();
					console.error("Whisper error:", errText);
					return Response.json(
						{ error: "Transcription failed" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const result = await whisperRes.json();
				const text = result.text || "";

				console.log(`Transcribed: "${text.slice(0, 50)}..."`);
				return Response.json({ text }, { headers: corsHeaders });
			} catch (err) {
				console.error("Transcribe error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		// Text-to-speech via Kokoro
		if (path === "/tts" && req.method === "POST") {
			try {
				const { text } = (await req.json()) as { text: string };

				if (!text) {
					return Response.json(
						{ error: "No text provided" },
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(`POST /api/tts: "${text.slice(0, 50)}..."`);

				// Forward to TTS server (Piper)
				const ttsRes = await fetch(KOKORO_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text }),
				});

				if (!ttsRes.ok) {
					const errText = await ttsRes.text();
					console.error("TTS error:", errText);
					return Response.json(
						{ error: "TTS failed" },
						{ status: 500, headers: corsHeaders },
					);
				}

				const audioBuffer = await ttsRes.arrayBuffer();
				console.log(`TTS response: ${audioBuffer.byteLength} bytes`);
				return new Response(audioBuffer, {
					headers: {
						...corsHeaders,
						"Content-Type": "audio/wav",
					},
				});
			} catch (err) {
				console.error("TTS error:", err);
				return Response.json(
					{ error: String(err) },
					{ status: 500, headers: corsHeaders },
				);
			}
		}

		return Response.json(
			{ error: "Not found" },
			{ status: 404, headers: corsHeaders },
		);
	},
};
