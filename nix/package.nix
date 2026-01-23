{
  lib,
  stdenv,
  bun,
  makeWrapper,
  cacert,
}: let
  src = ./..;

  # Fixed-output derivation to fetch dependencies with network access
  node_modules = stdenv.mkDerivation {
    pname = "agent-mobile-deps";
    version = "0.1.0";
    inherit src;

    nativeBuildInputs = [bun cacert];

    buildPhase = ''
      export HOME=$(mktemp -d)
      bun install --frozen-lockfile --ignore-scripts
    '';

    installPhase = ''
      mkdir -p $out
      cp -r node_modules $out/
    '';

    # Fixed-output derivation - allows network access
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-MhQc2Y6kzcZFMhoOkBbY9S93ZOzdQk9A2bsqY0IYV6A=";
  };
in
  stdenv.mkDerivation {
    pname = "agent-mobile";
    version = "0.1.0";
    inherit src;

    nativeBuildInputs = [bun makeWrapper];

    buildPhase = ''
      runHook preBuild

      export HOME=$(mktemp -d)

      # Link pre-fetched dependencies
      ln -s ${node_modules}/node_modules node_modules

      # Build frontend with plugins (SolidJS + Tailwind)
      bun run build.ts

      # Build API for the static server
      bun build --target=bun --minify src/api.ts --outdir=dist

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/bin $out/share/agent-mobile/dist

      # Install built frontend and API
      cp -r dist/* $out/share/agent-mobile/dist/
      cp -r public $out/share/agent-mobile/dist/

      # Install static server
      cp server.static.ts $out/share/agent-mobile/dist/server.ts

      # Create wrapper
      makeWrapper ${bun}/bin/bun $out/bin/agent-server \
        --add-flags "$out/share/agent-mobile/dist/server.ts"

      runHook postInstall
    '';

    meta = with lib; {
      description = "Agent Mobile - SolidJS frontend for managing Agent sessions";
      license = licenses.mit;
      platforms = platforms.all;
      mainProgram = "agent-server";
    };
  }
