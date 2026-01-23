import tailwind from "bun-plugin-tailwind";
import { SolidPlugin } from "@dschz/bun-plugin-solid";

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  minify: true,
  plugins: [tailwind, SolidPlugin()],
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("Frontend built successfully");
