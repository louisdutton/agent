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

    # Piper voice model URLs:
    # "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx"
    # "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json"

    # Fallback TTS server using piper-tts binary (stdin/stdout mode)
    ttsServerScript = pkgs:
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
              odin
              ols
              whisper-cpp
              ffmpeg
              (ttsServerScript pkgs)
              piper-tts

              # libpiper build dependencies
              cmake
              pkg-config
              git

              # misc
              nixd
              alejandra
            ];

            shellHook = ''
              export WHISPER_URL="http://localhost:8080"
              export KOKORO_URL="http://localhost:8880"
              export MODELS_DIR="$PWD/.models"
              mkdir -p $MODELS_DIR

              # Set library paths if libpiper is built locally
              if [ -d "$PWD/tts/.build/install/lib" ]; then
                export LD_LIBRARY_PATH="$PWD/tts/.build/install/lib:$LD_LIBRARY_PATH"
              fi

              # Download whisper model if not present
              if [ ! -f "$MODELS_DIR/ggml-base.en.bin" ]; then
                echo "Downloading whisper base.en model..."
                curl -L -o "$MODELS_DIR/ggml-base.en.bin" \
                  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
              fi

              # Download piper model if not present
              mkdir -p "$MODELS_DIR/piper"
              if [ ! -f "$MODELS_DIR/piper/en_GB-alba-medium.onnx" ]; then
                echo "Downloading piper voice model..."
                curl -L -o "$MODELS_DIR/piper/en_GB-alba-medium.onnx" \
                  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx"
                curl -L -o "$MODELS_DIR/piper/en_GB-alba-medium.onnx.json" \
                  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json"
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
          program = "${ttsServerScript pkgs}/bin/tts-server";
        };

        # Odin TTS server (requires ./tts/build.sh to be run first)
        tts-odin = {
          type = "app";
          program = toString (pkgs.writeShellScript "tts-odin" ''
            export MODELS_DIR="''${MODELS_DIR:-$PWD/.models}"
            if [ -d "$PWD/tts/.build/install/lib" ]; then
              export LD_LIBRARY_PATH="$PWD/tts/.build/install/lib:$LD_LIBRARY_PATH"
            fi
            if [ ! -f "$PWD/tts/tts-server" ]; then
              echo "Odin TTS server not built. Run: cd tts && ./build.sh"
              exit 1
            fi
            echo "Starting Odin TTS server on :8880..."
            exec $PWD/tts/tts-server
          '');
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
            ${ttsServerScript pkgs}/bin/tts-server &

            echo "Starting Bun on :3000.."
            bun serve &

            wait
          '');
        };
      }
    );
  };
}
