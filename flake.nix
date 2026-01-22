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

    # "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx"
    # "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json"

    ttsServer = pkgs:
      pkgs.writeShellScriptBin "tts-server" ''
        MODEL_DIR="''${MODELS_DIR:-$PWD/.models}/piper"
        MODEL="$MODEL_DIR/en_GB-alba-medium.onnx"
        ${pkgs.piper-tts}/bin/piper --model "$MODEL" --length-scale 0.7
      '';
  in {
    devShells = forEachSupportedSystem (
      {pkgs}:
        with pkgs; {
          default = mkShell {
            packages = [
              # client
              bun
              biome
              typescript-go
              tailwindcss-language-server

              # server
              whisper-cpp
              ffmpeg
              (ttsServer pkgs)
              piper-tts

              # misc
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
