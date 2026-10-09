import fs from "node:fs";
import { spawnSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const entryFile = path.join(rootDir, ".output", "server", "index.mjs");

if (!fs.existsSync(entryFile)) {
  console.log("[StepOut] Production bundle (.output/server/index.mjs) was not found.");
  console.log("[StepOut] Triggering build step now (npm run build)...");

  const buildResult = spawnSync("npm", ["run", "build"], {
    stdio: "inherit",
    cwd: rootDir,
    shell: true,
  });

  if (buildResult.status !== 0) {
    console.error("[StepOut Error] Build step failed with status:", buildResult.status);
    process.exit(buildResult.status ?? 1);
  }
}

if (!fs.existsSync(entryFile)) {
  console.error("[StepOut Error] Expected server bundle not found at:", entryFile);
  process.exit(1);
}

console.log("[StepOut] Launching production server from:", entryFile);
console.log("[StepOut] Listening on port:", process.env.PORT || 3000);

const child = spawn(process.execPath, [entryFile], {
  stdio: "inherit",
  cwd: rootDir,
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
