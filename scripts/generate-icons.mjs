import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(rootDir, "logo.png");
const outDir = resolve(rootDir, "extension/icons");

// Extension toolbar/store icons + favicons all derive from the same square logo.
const sizes = [16, 32, 48, 128, 256];

async function run() {
  mkdirSync(outDir, { recursive: true });

  for (const size of sizes) {
    const target = resolve(outDir, `icon-${size}.png`);
    await sharp(source).resize(size, size, { fit: "cover" }).png().toFile(target);
    console.log(`icon-${size}.png`);
  }

  // Favicons for the popup / full-tab view.
  await sharp(source).resize(32, 32, { fit: "cover" }).png().toFile(resolve(outDir, "favicon-32.png"));
  await sharp(source).resize(16, 16, { fit: "cover" }).png().toFile(resolve(outDir, "favicon-16.png"));
  console.log("favicon-16.png, favicon-32.png");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
