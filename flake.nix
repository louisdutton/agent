{
  description = "Agent Mobile - SolidJS frontend for Agent sessions";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    ...
  }:
    {
      nixosModules = rec {
        default = agent;
        agent = import ./nix/module.nix;
      };
    }
    // flake-utils.lib.eachDefaultSystem (system: let
      pkgs = import nixpkgs {
        inherit system;
        overlays = [
          (final: prev: {
            bun = prev.bun.overrideAttrs rec {
              __intentionallyOverridingVersion = true;
              version = "1.3.9";
              passthru.sources.aarch64-linux = prev.fetchurl {
                url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-aarch64.zip";
                hash = "sha256-osKGK8wf0cCzqNzcjH77XirNhx6yDtLxdheITt6ByEQ=";
              };
            };
          })
        ];
      };
      models = import ./nix/models.nix {inherit pkgs;};
      inherit (models) whisperModel piperModel piperHttpServer;
    in {
      packages = rec {
        default = agent-mobile;
        agent-mobile = pkgs.callPackage ./nix/package.nix {};
      };

      devShells.default = pkgs.mkShell {
        packages = with pkgs; [
          # client
          bun
          biome
          typescript-go
          tailwindcss-language-server

          # server
          whisper-cpp
          ffmpeg
          piper-tts

          # libpiper build dependencies
          cmake
          pkg-config
          git

          # misc
          nixd
          alejandra
        ];

        WHISPER_URL = "http://localhost:9371";
        KOKORO_URL = "http://localhost:9372";
      };

      apps = {
        whisper = {
          type = "app";
          program = toString (pkgs.writeShellScript "whisper-server" ''
            echo "Starting Whisper server on :9371..."
            ${pkgs.whisper-cpp}/bin/whisper-server \
              --model "${whisperModel}" \
              --port 9371
          '');
        };

        tts = {
          type = "app";
          program = toString (pkgs.writeShellScript "piper-http" ''
            echo "Starting Piper TTS server on :9372..."
            exec ${piperHttpServer}/bin/piper-http-server \
              --model "${piperModel}/en_GB-alba-medium.onnx" \
              --port 9372 \
              --length-scale 0.7
          '');
        };

        default = {
          type = "app";
          program = toString (pkgs.writeShellScript "all-services" ''
            trap 'kill $(jobs -p)' EXIT

            echo "Starting Whisper on :9371..."
            ${pkgs.whisper-cpp}/bin/whisper-server \
              --model "${whisperModel}" \
              --port 9371 &

            echo "Starting Piper TTS on :9372..."
            ${piperHttpServer}/bin/piper-http-server \
              --model "${piperModel}/en_GB-alba-medium.onnx" \
              --port 9372 \
              --length-scale 0.7 &

            echo "Starting Agent on :9370..."
            PORT=9370 ${pkgs.bun}/bin/bun serve &

            wait
          '');
        };
      };
    });
}
