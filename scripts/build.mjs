import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const watchMode = process.argv.includes("--watch");

const targets = [
  { outDir: resolve(rootDir, "dist"), manifest: "extension/manifest.chrome.json" },
  { outDir: resolve(rootDir, "dist-firefox"), manifest: "extension/manifest.firefox.json" },
];

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  logLevel: "info",
};

function copyStaticFiles(outDir, manifestSource) {
  mkdirSync(outDir, { recursive: true });
  cpSync(resolve(rootDir, "extension/popup.html"), resolve(outDir, "popup.html"));
  cpSync(resolve(rootDir, "extension/popup.css"), resolve(outDir, "popup.css"));
  cpSync(resolve(rootDir, manifestSource), resolve(outDir, "manifest.json"));
}

async function run() {
  for (const target of targets) {
    if (!watchMode && existsSync(target.outDir)) {
      rmSync(target.outDir, { recursive: true, force: true });
    }
    copyStaticFiles(target.outDir, target.manifest);

    const config = {
      ...shared,
      entryPoints: {
        background: resolve(rootDir, "src/background/index.ts"),
        content: resolve(rootDir, "src/content/index.ts"),
        page: resolve(rootDir, "src/page/index.ts"),
        popup: resolve(rootDir, "src/popup/index.ts"),
      },
      outdir: target.outDir,
    };

    if (watchMode) {
      const ctx = await context(config);
      await ctx.watch();
      console.log(`Watching -> ${target.outDir}`);
    } else {
      await build(config);
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
