import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "1.0.0";
const releaseDir = resolve(rootDir, "release");

function zipFolder(sourceDir, zipPath) {
  if (!existsSync(sourceDir)) {
    throw new Error(`Build output missing: ${sourceDir}. Run npm run build first.`);
  }
  if (existsSync(zipPath)) {
    rmSync(zipPath, { force: true });
  }
  const escapedSource = `${sourceDir}\\*`;
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${escapedSource}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: "inherit", cwd: rootDir },
  );
}

mkdirSync(releaseDir, { recursive: true });

zipFolder(
  resolve(rootDir, "dist-firefox"),
  resolve(releaseDir, `google-photos-empty-album-cleaner-${version}-firefox.zip`),
);
zipFolder(
  resolve(rootDir, "dist"),
  resolve(releaseDir, `google-photos-empty-album-cleaner-${version}-chrome.zip`),
);

console.log(`Release zips written to ${releaseDir}`);
