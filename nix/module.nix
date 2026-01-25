{
  config,
  lib,
  pkgs,
  ...
}:
with lib; let
  cfg = config.services.agent;
  models = import ./models.nix {inherit pkgs;};
  inherit (models) whisperModel piperModel piperHttpServer;
in {
  options.services.agent = {
    enable = mkEnableOption "Agent Mobile service";

    port = mkOption {
      type = types.port;
      default = 9370;
      description = "Port for the main Agent server";
    };

    whisperPort = mkOption {
      type = types.port;
      default = 9371;
      description = "Port for the Whisper speech-to-text server";
    };

    ttsPort = mkOption {
      type = types.port;
      default = 9372;
      description = "Port for the Piper text-to-speech server";
    };

    user = mkOption {
      type = types.str;
      default = "agent";
      description = "User to run the Agent services as";
    };

    group = mkOption {
      type = types.str;
      default = "agent";
      description = "Group to run the Agent services as";
    };

    package = mkOption {
      type = types.package;
      default = pkgs.callPackage ./package.nix {};
      description = "The Agent Mobile package to use";
    };
  };

  config = mkIf cfg.enable {
    users.users.${cfg.user} = mkIf (cfg.user == "agent") {
      isSystemUser = true;
      group = cfg.group;
      home = "/var/lib/agent";
      createHome = true;
    };

    users.groups.${cfg.group} = mkIf (cfg.group == "agent") {};

    systemd.services.agent-whisper = {
      description = "Whisper Speech-to-Text Server";
      wantedBy = ["multi-user.target"];
      after = ["network.target"];

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${pkgs.whisper-cpp}/bin/whisper-server --model ${whisperModel} --port ${toString cfg.whisperPort}";
        Restart = "on-failure";
        RestartSec = 5;
      };
    };

    systemd.services.agent-tts = {
      description = "Piper Text-to-Speech Server";
      wantedBy = ["multi-user.target"];
      after = ["network.target"];

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${piperHttpServer}/bin/piper-http-server --model ${piperModel}/en_GB-alba-medium.onnx --port ${toString cfg.ttsPort} --length-scale 0.7";
        Restart = "on-failure";
        RestartSec = 5;
      };
    };

    systemd.services.agent = {
      description = "Agent Mobile Server";
      wantedBy = ["multi-user.target"];
      after = ["network.target" "agent-whisper.service" "agent-tts.service"];
      wants = ["agent-whisper.service" "agent-tts.service"];

      environment = {
        WHISPER_URL = "http://localhost:${toString cfg.whisperPort}";
        KOKORO_URL = "http://localhost:${toString cfg.ttsPort}";
        PORT = toString cfg.port;
      };

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = "${cfg.package}/bin/agent-server";
        Restart = "on-failure";
        RestartSec = 5;
      };
    };
  };
}
