package tts

import "core:c"
import "core:encoding/json"
import "core:fmt"
import "core:mem"
import "core:net"
import "core:os"
import "core:slice"
import "core:strconv"
import "core:strings"

// WAV file header structure (44 bytes)
WAV_Header :: struct #packed {
	riff:            [4]u8, // "RIFF"
	file_size:       u32le, // File size - 8
	wave:            [4]u8, // "WAVE"
	fmt_marker:      [4]u8, // "fmt "
	fmt_length:      u32le, // 16 for PCM
	audio_format:    u16le, // 1 for PCM
	num_channels:    u16le, // 1 for mono
	sample_rate:     u32le, // e.g., 22050
	byte_rate:       u32le, // sample_rate * num_channels * bits_per_sample / 8
	block_align:     u16le, // num_channels * bits_per_sample / 8
	bits_per_sample: u16le, // 16 for 16-bit PCM
	data_marker:     [4]u8, // "data"
	data_size:       u32le, // Number of bytes in data
}

// TTS request JSON structure
TTS_Request :: struct {
	text: string,
}

// Global synthesizer (initialized once)
g_synth: ^Piper_Synthesizer
g_options: Piper_Synthesize_Options

main :: proc() {
	model_dir := os.get_env("MODELS_DIR", context.temp_allocator)
	if model_dir == "" {
		model_dir = ".models"
	}

	model_path := strings.concatenate(
		{model_dir, "/piper/en_GB-alba-medium.onnx"},
		context.temp_allocator,
	)
	espeak_data := strings.concatenate(
		{model_dir, "/piper/espeak-ng-data"},
		context.temp_allocator,
	)

	fmt.printfln("Loading model: %s", model_path)
	fmt.printfln("Espeak data: %s", espeak_data)

	g_synth = create(
		strings.clone_to_cstring(model_path),
		nil,
		strings.clone_to_cstring(espeak_data),
	)
	if g_synth == nil {
		fmt.eprintln("Failed to create piper synthesizer")
		os.exit(1)
	}
	defer free(g_synth)

	g_options = default_synthesize_options(g_synth)
	g_options.length_scale = 0.7 // Match the shell script speed

	port := 8880
	endpoint := net.Endpoint {
		address = net.IP4_Address{0, 0, 0, 0},
		port    = port,
	}

	listen_socket, listen_err := net.listen_tcp(endpoint)
	if listen_err != nil {
		fmt.eprintfln("Failed to bind to port %d: %v", port, listen_err)
		os.exit(1)
	}
	defer net.close(listen_socket)

	fmt.printfln("TTS server listening on :%d", port)

	for {
		client, _, accept_err := net.accept_tcp(listen_socket)
		if accept_err != nil {
			fmt.eprintfln("Accept error: %v", accept_err)
			continue
		}

		// Handle each connection (single-threaded for simplicity with synthesizer)
		handle_connection(client)
	}
}

handle_connection :: proc(client: net.TCP_Socket) {
	defer net.close(client)

	// Read request
	buf: [8192]u8
	total_read := 0

	for {
		bytes_read, recv_err := net.recv_tcp(client, buf[total_read:])
		if recv_err != nil || bytes_read == 0 {
			break
		}
		total_read += bytes_read

		// Check for end of HTTP headers
		request := string(buf[:total_read])
		if strings.contains(request, "\r\n\r\n") {
			// Parse Content-Length and read body if needed
			if cl_idx := strings.index(request, "Content-Length:"); cl_idx >= 0 {
				cl_line := request[cl_idx:]
				cl_end := strings.index(cl_line, "\r\n")
				if cl_end > 0 {
					cl_str := strings.trim_space(cl_line[15:cl_end])
					content_length, ok := strconv.parse_int(cl_str)
					if ok {
						header_end := strings.index(request, "\r\n\r\n") + 4
						body_read := total_read - header_end
						// Read remaining body
						for body_read < content_length && total_read < len(buf) {
							n2, _ := net.recv_tcp(client, buf[total_read:])
							if n2 <= 0 {break}
							total_read += n2
							body_read += n2
						}
					}
				}
			}
			break
		}
	}

	if total_read == 0 {
		return
	}

	request := string(buf[:total_read])

	// Parse HTTP request
	if !strings.has_prefix(request, "POST") {
		send_response(client, 405, "text/plain", "Method Not Allowed")
		return
	}

	// Find body
	body_start := strings.index(request, "\r\n\r\n")
	if body_start < 0 {
		send_response(client, 400, "text/plain", "Bad Request")
		return
	}
	body := request[body_start + 4:]

	// Parse JSON
	tts_req: TTS_Request
	json_err := json.unmarshal_string(body, &tts_req)
	if json_err != nil {
		send_response(client, 400, "text/plain", "Invalid JSON")
		return
	}

	if tts_req.text == "" {
		send_response(client, 400, "text/plain", "Missing text field")
		return
	}

	// Synthesize audio
	audio_data, sample_rate, synth_ok := synthesize_text(tts_req.text)
	if !synth_ok {
		send_response(client, 500, "text/plain", "Synthesis failed")
		return
	}
	defer delete(audio_data)

	// Convert to WAV
	wav_data := create_wav(audio_data, sample_rate)
	defer delete(wav_data)

	// Send response
	send_binary_response(client, 200, "audio/wav", wav_data)
}

synthesize_text :: proc(text: string) -> ([]i16, int, bool) {
	text_cstr := strings.clone_to_cstring(text, context.temp_allocator)

	result := synthesize_start(g_synth, text_cstr, &g_options)
	if result != PIPER_OK {
		fmt.eprintfln("synthesize_start failed: %d", result)
		return nil, 0, false
	}

	// Collect all audio chunks
	samples: [dynamic]i16
	sample_rate := 22050 // default

	chunk: Piper_Audio_Chunk
	for {
		result = synthesize_next(g_synth, &chunk)
		if result == PIPER_ERR_GENERIC {
			fmt.eprintln("synthesize_next error")
			delete(samples)
			return nil, 0, false
		}

		sample_rate = int(chunk.sample_rate)

		// Convert float samples to 16-bit PCM
		for i in 0 ..< chunk.num_samples {
			sample := chunk.samples[i]
			// Clamp and convert to i16
			clamped := clamp(sample, -1.0, 1.0)
			pcm := i16(clamped * 32767.0)
			append(&samples, pcm)
		}

		if result == PIPER_DONE || chunk.is_last {
			break
		}
	}

	return samples[:], sample_rate, true
}

create_wav :: proc(samples: []i16, sample_rate: int) -> []u8 {
	data_size := u32(len(samples) * 2) // 2 bytes per sample
	file_size := 36 + data_size

	header := WAV_Header {
		riff            = {'R', 'I', 'F', 'F'},
		file_size       = u32le(file_size),
		wave            = {'W', 'A', 'V', 'E'},
		fmt_marker      = {'f', 'm', 't', ' '},
		fmt_length      = 16,
		audio_format    = 1, // PCM
		num_channels    = 1, // Mono
		sample_rate     = u32le(sample_rate),
		byte_rate       = u32le(sample_rate * 2), // sample_rate * channels * bytes_per_sample
		block_align     = 2, // channels * bytes_per_sample
		bits_per_sample = 16,
		data_marker     = {'d', 'a', 't', 'a'},
		data_size       = u32le(data_size),
	}

	// Allocate output buffer
	total_size := size_of(WAV_Header) + int(data_size)
	output := make([]u8, total_size)

	// Copy header
	header_bytes := mem.ptr_to_bytes(&header)
	mem.copy(&output[0], &header_bytes[0], size_of(WAV_Header))

	// Copy samples (already in correct byte order on little-endian systems)
	sample_bytes := slice.reinterpret([]u8, samples)
	mem.copy(&output[size_of(WAV_Header)], &sample_bytes[0], int(data_size))

	return output
}

send_response :: proc(client: net.TCP_Socket, status: int, content_type: string, body: string) {
	status_text :=
		status == 200 ? "OK" : status == 400 ? "Bad Request" : status == 405 ? "Method Not Allowed" : "Error"
	response := fmt.tprintf(
		"HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s",
		status,
		status_text,
		content_type,
		len(body),
		body,
	)
	net.send_tcp(client, transmute([]u8)response)
}

send_binary_response :: proc(
	client: net.TCP_Socket,
	status: int,
	content_type: string,
	body: []u8,
) {
	header := fmt.tprintf(
		"HTTP/1.1 %d OK\r\nContent-Type: %s\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
		status,
		content_type,
		len(body),
	)
	net.send_tcp(client, transmute([]u8)header)
	net.send_tcp(client, body)
}
