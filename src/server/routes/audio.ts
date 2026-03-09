import { Elysia, t } from "elysia";

const WHISPER_URL = process.env.WHISPER_URL || "http://localhost:9371";
const KOKORO_URL = process.env.KOKORO_URL || "http://localhost:9372";

export const audioRoutes = new Elysia()
	.post(
		"/transcribe",
		async ({ body }) => {
			if (!body.audio) {
				return { error: "No audio file" };
			}

			const whisperForm = new FormData();
			whisperForm.append("file", body.audio);
			whisperForm.append("response_format", "json");
			whisperForm.append("language", "en");
			whisperForm.append(
				"prompt",
				"A software engineer is discussing code, programming, and AI with Claude.",
			);

			const whisperRes = await fetch(`${WHISPER_URL}/inference`, {
				method: "POST",
				body: whisperForm,
			});

			if (!whisperRes.ok) {
				return { error: "Transcription failed" };
			}

			const result = (await whisperRes.json()) as { text?: string };
			return { text: result.text || "" };
		},
		{ body: t.Object({ audio: t.File() }) },
	)

	.post(
		"/tts",
		async ({ body }) => {
			const ttsRes = await fetch(KOKORO_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: body.text }),
			});

			if (!ttsRes.ok) {
				return new Response("TTS failed", { status: 500 });
			}

			return new Response(await ttsRes.arrayBuffer(), {
				headers: { "Content-Type": "audio/wav" },
			});
		},
		{ body: t.Object({ text: t.String() }) },
	);
