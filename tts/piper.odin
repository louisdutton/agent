package tts

import "core:c"

// Return codes
PIPER_OK :: 0
PIPER_DONE :: 1
PIPER_ERR_GENERIC :: -1

// Opaque synthesizer type
Piper_Synthesizer :: struct {}

// Chunk of synthesized audio samples
Piper_Audio_Chunk :: struct {
	// Raw samples returned from the voice model
	samples:         [^]f32,
	// Number of samples in the audio chunk
	num_samples:     c.size_t,
	// Sample rate in Hertz
	sample_rate:     c.int,
	// True if this is the last audio chunk
	is_last:         bool,
	// Phoneme codepoints that produced this audio chunk (char32_t = u32)
	phonemes:        [^]u32,
	// Number of codepoints in phonemes
	num_phonemes:    c.size_t,
	// Phoneme ids that produced this audio chunk
	phoneme_ids:     [^]c.int,
	// Number of ids in phoneme_ids
	num_phoneme_ids: c.size_t,
	// Audio sample count for each phoneme id
	alignments:      [^]c.int,
	// Number of alignments (same as num_phoneme_ids)
	num_alignments:  c.size_t,
}

// Options for synthesis
Piper_Synthesize_Options :: struct {
	// Id of speaker to use (multi-speaker models only, 0 = first speaker)
	speaker_id:    c.int,
	// Speech speed (0.5 = 2x faster, 2.0 = 2x slower, default 1.0)
	length_scale:  c.float,
	// Noise during synthesis (single: 0.667, multi: 0.333)
	noise_scale:   c.float,
	// Phoneme length variation (single: 0.8, multi: 0.333)
	noise_w_scale: c.float,
}

foreign import piper "system:piper"

@(default_calling_convention = "c")
foreign piper {
	// Create a Piper text-to-speech synthesizer from a voice model
	// model_path: path to ONNX voice model file
	// config_path: path to JSON voice config file or NULL (uses model_path + .json)
	// espeak_data_path: path to the espeak-ng data directory
	@(link_name = "piper_create")
	create :: proc(model_path: cstring, config_path: cstring, espeak_data_path: cstring) -> ^Piper_Synthesizer ---

	// Free resources for Piper synthesizer
	@(link_name = "piper_free")
	free :: proc(synth: ^Piper_Synthesizer) ---

	// Get the default synthesis options for a Piper synthesizer
	@(link_name = "piper_default_synthesize_options")
	default_synthesize_options :: proc(synth: ^Piper_Synthesizer) -> Piper_Synthesize_Options ---

	// Start text-to-speech synthesis
	// Returns PIPER_OK or error code
	@(link_name = "piper_synthesize_start")
	synthesize_start :: proc(synth: ^Piper_Synthesizer, text: cstring, options: ^Piper_Synthesize_Options) -> c.int ---

	// Synthesize next chunk of audio
	// Returns PIPER_DONE when complete, otherwise PIPER_OK or error code
	@(link_name = "piper_synthesize_next")
	synthesize_next :: proc(synth: ^Piper_Synthesizer, chunk: ^Piper_Audio_Chunk) -> c.int ---
}
