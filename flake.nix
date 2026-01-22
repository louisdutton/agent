{
  description = "Agent Mobile - SolidJS frontend for Agent sessions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    nixpkgs,
    flake-utils,
    ...
  }:
    flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {inherit system;};

      # Models fetched from Hugging Face
      whisperModel = pkgs.fetchurl {
        url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
        sha256 = "00nhqqvgwyl9zgyy7vk9i3n017q2wlncp5p7ymsk0cpkdp47jdx0";
      };

      piperModel = pkgs.linkFarm "piper-alba-medium" [
        {
          name = "en_GB-alba-medium.onnx";
          path = pkgs.fetchurl {
            url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx";
            sha256 = "0fyhdak36wagsvicsrk4qvfdn4888ijcii9jdkcgs28xm326j4s0";
          };
        }
        {
          name = "en_GB-alba-medium.onnx.json";
          path = pkgs.fetchurl {
            url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alba/medium/en_GB-alba-medium.onnx.json";
            sha256 = "1x49vmrqr4a5m5y5dasz4rgxdxmz5g3iykk9q8rddkpc08pmm5ma";
          };
        }
      ];

      # Fallback TTS server using piper-tts binary (stdin/stdout mode)
      ttsServerScript = pkgs.writeShellScriptBin "tts-server" ''
        ${pkgs.piper-tts}/bin/piper --model "${piperModel}/en_GB-alba-medium.onnx" --length-scale 0.7
      '';
    in {
      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
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
          ttsServerScript
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

          # Set library paths if libpiper is built locally
          if [ -d "$PWD/tts/.build/install/lib" ]; then
            export LD_LIBRARY_PATH="$PWD/tts/.build/install/lib:$LD_LIBRARY_PATH"
          fi
        '';
      };

      apps = {
        whisper = {
          type = "app";
          program = toString (pkgs.writeShellScript "whisper-server" ''
            echo "Starting Whisper server on :8080..."
            ${pkgs.whisper-cpp}/bin/whisper-server \
              --model "${whisperModel}" \
              --port 8080
          '');
        };

        tts = {
          type = "app";
          program = "${ttsServerScript}/bin/tts-server";
        };

        # Odin TTS server (requires ./tts/build.sh to be run first)
        tts-odin = {
          type = "app";
          program = toString (pkgs.writeShellScript "tts-odin" ''
            if [ -d "$PWD/tts/.build/install/lib" ]; then
              export LD_LIBRARY_PATH="$PWD/tts/.build/install/lib:$LD_LIBRARY_PATH"
            fi
            if [ ! -f "$PWD/tts/tts-server" ]; then
              echo "Odin TTS server not built. Run: cd tts && ./build.sh"
              exit 1
            fi
            echo "Starting Odin TTS server on :8880..."
            export PIPER_MODEL="${piperModel}/en_GB-alba-medium.onnx"
            exec $PWD/tts/tts-server
          '');
        };

        services = {
          type = "app";
          program = toString (pkgs.writeShellScript "all-services" ''
            trap 'kill $(jobs -p)' EXIT

            echo "Starting Whisper on :8080..."
            ${pkgs.whisper-cpp}/bin/whisper-server \
              --model "${whisperModel}" \
              --port 8080 &

            echo "Starting Piper TTS on :8880..."
            ${ttsServerScript}/bin/tts-server &

            echo "Starting Bun on :3000.."
            bun serve &

            wait
          '');
        };
      };
    });
}
