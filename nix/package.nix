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

      # Build the server binary (embeds the frontend via index.html import)
      bun build --compile --minify server.ts --outfile agent-server

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      mkdir -p $out/bin $out/share/agent-mobile

      # Install the binary
      cp agent-server $out/bin/

      # Install public assets
      cp -r public $out/share/agent-mobile/

      # Wrap binary to set working directory for public assets
      wrapProgram $out/bin/agent-server \
        --chdir $out/share/agent-mobile

      runHook postInstall
    '';

    # Don't strip - it corrupts Bun's embedded bytecode
    dontStrip = true;

    meta = with lib; {
      description = "Agent Mobile - SolidJS frontend for managing Agent sessions";
      license = licenses.mit;
      platforms = platforms.all;
      mainProgram = "agent-server";
    };
  }
