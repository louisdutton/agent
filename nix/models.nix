# Shared model definitions for Agent services
{pkgs}: {
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

  piperHttpServer = pkgs.runCommand "piper-http-server" {} ''
    mkdir -p $out/bin
    head -3 ${pkgs.piper-tts}/bin/.piper-wrapped > $out/bin/piper-http-server
    cat >> $out/bin/piper-http-server << 'EOF'
    from piper.http_server import main
    main()
    EOF
    chmod +x $out/bin/piper-http-server
  '';
}
