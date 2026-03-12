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
      pkgs = import nixpkgs {inherit system;};
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
          ffmpeg

          # misc
          nixd
          alejandra
        ];

        WHISPER_URL = "http://localhost:9371";
      };

      apps = {
        default = {
          type = "app";
          program = toString (pkgs.writeShellScript "agent" ''
            echo "Starting Agent on :9370..."
            ${pkgs.bun}/bin/bun serve --port 9370
          '');
        };
      };
    });
}
