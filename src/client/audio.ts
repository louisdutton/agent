import type { Accessor, Setter } from "solid-js";

export type AudioState = {
	isRecording: Accessor<boolean>;
	setIsRecording: Setter<boolean>;
	isTranscribing: Accessor<boolean>;
	setIsTranscribing: Setter<boolean>;
	isPlaying: Accessor<boolean>;
	setIsPlaying: Setter<boolean>;
	playingId: Accessor<string | null>;
	setPlayingId: Setter<string | null>;
	audioLevels: Accessor<number[]>;
	setAudioLevels: Setter<number[]>;
	pendingVoiceInput: Accessor<boolean>;
	setPendingVoiceInput: Setter<boolean>;
	setInput: Setter<string>;
};

export type AudioRefs = {
	mediaRecorder: MediaRecorder | null;
	audioChunks: Blob[];
	currentAudio: HTMLAudioElement | null;
	audioContext: AudioContext | null;
	analyser: AnalyserNode | null;
	animationFrame: number | null;
};

export function createAudioRefs(): AudioRefs {
	return {
		mediaRecorder: null,
		audioChunks: [],
		currentAudio: null,
		audioContext: null,
		analyser: null,
		animationFrame: null,
	};
}

export async function transcribeAudio(
	audioBlob: Blob,
	state: Pick<
		AudioState,
		"setIsTranscribing" | "setInput" | "setPendingVoiceInput"
	>,
): Promise<void> {
	state.setIsTranscribing(true);
	try {
		const formData = new FormData();
		formData.append("audio", audioBlob, "recording.webm");

		const res = await fetch("/api/transcribe", {
			method: "POST",
			body: formData,
		});

		if (!res.ok) throw new Error("Transcription failed");

		const { text } = await res.json();
		if (text?.trim()) {
			state.setInput(text.trim());
			state.setPendingVoiceInput(true);
		}
	} catch (err) {
		console.error("Transcription error:", err);
	} finally {
		state.setIsTranscribing(false);
	}
}

export async function startRecording(
	refs: AudioRefs,
	state: Pick<
		AudioState,
		| "setIsRecording"
		| "setAudioLevels"
		| "setIsTranscribing"
		| "setInput"
		| "setPendingVoiceInput"
	>,
): Promise<void> {
	try {
		if (!navigator.mediaDevices?.getUserMedia) {
			alert("Microphone requires HTTPS. Use 'bun serve' or localhost.");
			return;
		}

		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		refs.mediaRecorder = new MediaRecorder(stream, {
			mimeType: MediaRecorder.isTypeSupported("audio/webm")
				? "audio/webm"
				: "audio/mp4",
		});
		refs.audioChunks = [];

		// Set up audio analyser for visualization
		refs.audioContext = new AudioContext();
		refs.analyser = refs.audioContext.createAnalyser();
		refs.analyser.fftSize = 32;
		const source = refs.audioContext.createMediaStreamSource(stream);
		source.connect(refs.analyser);

		const dataArray = new Uint8Array(refs.analyser.frequencyBinCount);
		const updateLevels = () => {
			if (!refs.analyser) return;
			refs.analyser.getByteFrequencyData(dataArray);
			// Pick 4 frequency bands and normalize to 0-1
			const levels = [
				dataArray[1] / 255,
				dataArray[3] / 255,
				dataArray[5] / 255,
				dataArray[7] / 255,
			];
			state.setAudioLevels(levels);
			refs.animationFrame = requestAnimationFrame(updateLevels);
		};
		updateLevels();

		refs.mediaRecorder.ondataavailable = (e) => {
			if (e.data.size > 0) refs.audioChunks.push(e.data);
		};

		refs.mediaRecorder.onstop = async () => {
			stream.getTracks().forEach((t) => t.stop());
			// Clean up audio visualizer
			if (refs.animationFrame) cancelAnimationFrame(refs.animationFrame);
			if (refs.audioContext) refs.audioContext.close();
			refs.audioContext = null;
			refs.analyser = null;
			refs.animationFrame = null;
			state.setAudioLevels([0, 0, 0, 0]);

			if (refs.audioChunks.length === 0) return;

			const audioBlob = new Blob(refs.audioChunks, {
				type: refs.mediaRecorder?.mimeType || "audio/webm",
			});
			await transcribeAudio(audioBlob, state);
		};

		refs.mediaRecorder.start();
		state.setIsRecording(true);
	} catch (err) {
		console.error("Mic access error:", err);
		alert("Could not access microphone. Check permissions.");
	}
}

export function stopRecording(
	refs: AudioRefs,
	state: Pick<AudioState, "setIsRecording">,
): void {
	if (refs.mediaRecorder?.state === "recording") {
		refs.mediaRecorder.stop();
		state.setIsRecording(false);
	}
}

export async function playTTS(
	id: string,
	text: string,
	refs: AudioRefs,
	state: Pick<AudioState, "playingId" | "setPlayingId" | "setIsPlaying">,
): Promise<void> {
	if (refs.currentAudio) {
		refs.currentAudio.pause();
		refs.currentAudio = null;
	}

	if (state.playingId() === id) {
		state.setPlayingId(null);
		state.setIsPlaying(false);
		return;
	}

	state.setPlayingId(id);
	state.setIsPlaying(true);
	try {
		const res = await fetch("/api/tts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text }),
		});

		if (!res.ok) throw new Error("TTS failed");

		const audioBlob = await res.blob();
		const audioUrl = URL.createObjectURL(audioBlob);
		refs.currentAudio = new Audio(audioUrl);

		refs.currentAudio.onended = () => {
			state.setPlayingId(null);
			state.setIsPlaying(false);
			URL.revokeObjectURL(audioUrl);
			refs.currentAudio = null;
		};

		refs.currentAudio.onerror = () => {
			state.setPlayingId(null);
			state.setIsPlaying(false);
			URL.revokeObjectURL(audioUrl);
			refs.currentAudio = null;
		};

		await refs.currentAudio.play();
	} catch (err) {
		console.error("TTS error:", err);
		state.setPlayingId(null);
		state.setIsPlaying(false);
	}
}

export function stopPlayback(
	refs: AudioRefs,
	state: Pick<AudioState, "setPlayingId" | "setIsPlaying">,
): void {
	if (refs.currentAudio) {
		refs.currentAudio.pause();
		refs.currentAudio = null;
		state.setPlayingId(null);
		state.setIsPlaying(false);
	}
}
