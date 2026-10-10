#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOllamaProxyServer } from "../src/server/proxy/ollama-proxy.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// Load .env if present and variable not already in process.env
const envPath = path.join(rootDir, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed
        .slice(eqIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const token = process.env["OLLAMA_PROXY_TOKEN"] || process.env["OLLAMA_API_KEY"] || process.argv[2];

if (!token || token.trim().length < 8) {
  console.error("================================================================================");
  console.error("[Ollama Proxy Error] Missing or weak secret token!");
  console.error("================================================================================");
  console.error(
    "To securely run the proxy, generate a token and supply it via OLLAMA_PROXY_TOKEN:\n",
  );
  console.error("  1. Generate a strong token (PowerShell):");
  console.error(
    "     $env:OLLAMA_PROXY_TOKEN = node -e \"console.log(crypto.randomBytes(32).toString('hex'))\"\n",
  );
  console.error("  2. Start the proxy:");
  console.error("     npm run proxy:ollama\n");
  console.error("  3. Or pass it as an argument:");
  console.error("     node scripts/ollama-proxy.mjs <your-token>\n");
  console.error("================================================================================");
  process.exit(1);
}

const port = parseInt(process.env["OLLAMA_PROXY_PORT"] || process.env["PORT"] || "11435", 10);
const targetUrl = process.env["OLLAMA_TARGET_URL"] || "http://127.0.0.1:11434";

try {
  const server = createOllamaProxyServer({
    token: token.trim(),
    targetUrl,
  });

  server.listen(port, "127.0.0.1", () => {
    console.log("================================================================================");
    console.log("  StepOut Authenticated Ollama Proxy Running");
    console.log("================================================================================");
    console.log(`  Local Address     : http://127.0.0.1:${port}`);
    console.log(`  Forwarding Target : ${targetUrl}`);
    console.log("  Authentication    : Bearer Token REQUIRED on all requests");
    console.log("  Allowed Endpoints : POST /api/chat, GET /api/tags, GET /api/version");
    console.log("--------------------------------------------------------------------------------");
    console.log("  NEXT STEP - Tunnel this proxy to Render with cloudflared:");
    console.log(
      `  & "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe" tunnel --url http://127.0.0.1:${port}`,
    );
    console.log("--------------------------------------------------------------------------------");
    console.log("  RENDER CONFIGURATION (Set in Render Dashboard Environment):");
    console.log("    OLLAMA_BASE_URL  = https://<your-generated-subdomain>.trycloudflare.com");
    console.log("    OLLAMA_API_KEY   = <your-secret-token>");
    console.log("    OLLAMA_MODEL     = gemma3:latest");
    console.log("================================================================================");
    console.log("[Proxy] Listening for requests... (Press Ctrl+C to stop)");
  });

  const shutdown = () => {
    console.log("\n[Proxy] Shutting down gracefully...");
    server.close(() => {
      console.log("[Proxy] Stopped.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (err) {
  console.error("[Ollama Proxy Startup Failed]:", err instanceof Error ? err.message : err);
  process.exit(1);
}
