{
  description = "Agent Mobile - SolidJS frontend for Agent sessions";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    inherit (nixpkgs) lib;
    supportedSystems = [
      "x86_64-linux"
      "aarch64-linux"
      "aarch64-darwin"
    ];

    forEachSupportedSystem = f:
      lib.genAttrs supportedSystems (
        system:
          f {
            pkgs = import nixpkgs {
              inherit system;
            };
          }
      );

    ttsServer = pkgs:
      pkgs.writeShellScriptBin "tts-server" ''
        MODEL_DIR="''${MODELS_DIR:-$PWD/.models}/piper"
        MODEL="$MODEL_DIR/en_GB-alba-medium.onnx"

        if [ ! -f "$MODEL" ]; then
          echo "Downloading Piper voice model..."
          mkdir -p "$MODEL_DIR"
          ${pkgs.curl}/bin/curl -L -o "$MODEL" \
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx"
          ${pkgs.curl}/bin/curl -L -o "$MODEL.json" \
            "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json"
        fi

        export MODEL
        echo "Piper TTS ready on http://localhost:8880"
        ${pkgs.socat}/bin/socat TCP-LISTEN:8880,reuseaddr,fork EXEC:"${pkgs.writeShellScript "piper-handler" ''
          read -r REQUEST_LINE
          while read -r header; do
            header=$(echo "$header" | tr -d '\r')
            [ -z "$header" ] && break
            case "$header" in Content-Length:*) LENGTH=''${header#*: } ;; esac
          done

          BODY=$(head -c "$LENGTH")
          TEXT=$(echo "$BODY" | ${pkgs.jq}/bin/jq -r '.input // empty')

          if [ -n "$TEXT" ]; then
            TMPFILE=$(mktemp --suffix=.wav)
            echo "$TEXT" | ${pkgs.piper-tts}/bin/piper --model "$MODEL" --length-scale 0.7 --output_file "$TMPFILE" 2>/dev/null
            LEN=$(stat -f%z "$TMPFILE" 2>/dev/null || stat -c%s "$TMPFILE")
            printf "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: %d\r\n\r\n" "$LEN"
            cat "$TMPFILE"
            rm -f "$TMPFILE"
          else
            printf "HTTP/1.1 400 Bad Request\r\n\r\n"
          fi
        ''}"
      '';
  in {
    devShells = forEachSupportedSystem (
      {pkgs}:
        with pkgs; {
          default = mkShell {
            packages = [
              bun
              biome
              typescript-go
              tailwindcss-language-server
              whisper-cpp
              ffmpeg
              (ttsServer pkgs)
              nixd
              alejandra
            ];

            shellHook = ''
              export WHISPER_URL="http://localhost:8080"
              export KOKORO_URL="http://localhost:8880"
              export MODELS_DIR="$PWD/.models"
              mkdir -p $MODELS_DIR

              # Download whisper model if not present
              if [ ! -f "$MODELS_DIR/ggml-base.en.bin" ]; then
                echo "Downloading whisper base.en model..."
                curl -L -o "$MODELS_DIR/ggml-base.en.bin" \
                  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
              fi
            '';
          };
        }
    );

    apps = forEachSupportedSystem (
      {pkgs}: {
        whisper = {
          type = "app";
          program = toString (pkgs.writeShellScript "whisper-server" ''
            export MODELS_DIR="''${MODELS_DIR:-$PWD/.models}"
            echo "Starting Whisper server on :8080..."
            ${pkgs.whisper-cpp}/bin/whisper-server \
              --model "$MODELS_DIR/ggml-base.en.bin" \
              --port 8080
          '');
        };

        tts = {
          type = "app";
          program = "${ttsServer pkgs}/bin/tts-server";
        };

        services = {
          type = "app";
          program = toString (pkgs.writeShellScript "all-services" ''
            trap 'kill $(jobs -p)' EXIT

            export MODELS_DIR="''${MODELS_DIR:-$PWD/.models}"

            echo "Starting Whisper on :8080..."
            ${pkgs.whisper-cpp}/bin/whisper-server \
              --model "$MODELS_DIR/ggml-base.en.bin" \
              --port 8080 &

            echo "Starting Piper TTS on :8880..."
            ${ttsServer pkgs}/bin/tts-server &

            echo "Starting Bun on :3000.."
            bun serve &

            wait
          '');
        };
      }
    );
  };
}
