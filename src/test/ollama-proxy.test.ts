import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createOllamaProxyServer, timingSafeTokenCheck } from "../server/proxy/ollama-proxy";
import { OllamaProvider } from "../server/ai/ollama";

describe("timingSafeTokenCheck", () => {
  it("returns true for matching tokens", () => {
    expect(timingSafeTokenCheck("secret123456", "secret123456")).toBe(true);
  });

  it("returns false for non-matching tokens of same length", () => {
    expect(timingSafeTokenCheck("secret123456", "secret123457")).toBe(false);
  });

  it("returns false for non-matching tokens of different length", () => {
    expect(timingSafeTokenCheck("short", "secret123456")).toBe(false);
  });

  it("returns false for empty or nullish strings", () => {
    expect(timingSafeTokenCheck("", "secret123456")).toBe(false);
    expect(timingSafeTokenCheck("secret", "")).toBe(false);
  });
});

describe("Ollama Authenticated Proxy Server", () => {
  const TEST_TOKEN = "test-super-secret-token-12345";
  let mockUpstreamServer: http.Server | null = null;
  let mockUpstreamPort = 0;
  let proxyServer: http.Server | null = null;
  let proxyPort = 0;
  let lastUpstreamHeaders: http.IncomingHttpHeaders | null = null;
  let lastUpstreamBody = "";

  beforeEach(async () => {
    lastUpstreamHeaders = null;
    lastUpstreamBody = "";

    // 1. Create Mock Upstream Ollama Server
    mockUpstreamServer = http.createServer((req, res) => {
      lastUpstreamHeaders = req.headers;
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        lastUpstreamBody = body;
        if (req.url === "/api/tags" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ models: [{ name: "gemma3:latest" }] }));
          return;
        }

        if (req.url === "/api/chat" && req.method === "POST") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  tasks: [
                    {
                      title: "Test task",
                      priority: "medium",
                      evidence: "Evidence",
                    },
                  ],
                  memories: [],
                }),
              },
            }),
          );
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
      });
    });

    await new Promise<void>((resolve) => {
      mockUpstreamServer!.listen(0, "127.0.0.1", () => {
        mockUpstreamPort = (mockUpstreamServer!.address() as AddressInfo).port;
        resolve();
      });
    });

    // 2. Create Proxy Server pointing to Mock Upstream
    proxyServer = createOllamaProxyServer({
      token: TEST_TOKEN,
      targetUrl: `http://127.0.0.1:${mockUpstreamPort}`,
      maxBodyBytes: 1024, // 1KB for testing size limit
      timeoutMs: 3000,
    });

    await new Promise<void>((resolve) => {
      proxyServer!.listen(0, "127.0.0.1", () => {
        proxyPort = (proxyServer!.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (proxyServer) {
      await new Promise<void>((resolve) => proxyServer!.close(() => resolve()));
      proxyServer = null;
    }
    if (mockUpstreamServer) {
      await new Promise<void>((resolve) => mockUpstreamServer!.close(() => resolve()));
      mockUpstreamServer = null;
    }
  });

  it("fails to initialize with empty or weak token (< 8 chars)", () => {
    expect(() => createOllamaProxyServer({ token: "short" })).toThrow(
      "Ollama proxy requires a strong secret token",
    );
  });

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/tags`);
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain("Bearer");
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Unauthorized");
  });

  it("rejects requests with invalid bearer token with 401 Unauthorized", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/tags`, {
      headers: { Authorization: "Bearer wrong-token-12345" },
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Unauthorized");
  });

  it("forwards valid authenticated requests to upstream and returns response", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/tags`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { models: { name: string }[] };
    expect(json.models[0]?.name).toBe("gemma3:latest");
  });

  it("rejects disallowed endpoints (e.g. POST /api/pull) with 403 Forbidden", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/pull`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "evil-model" }),
    });
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string; allowed: string[] };
    expect(json.error).toContain("Forbidden");
    expect(json.allowed).toContain("POST /api/chat");
  });

  it("rejects requests exceeding payload size limit with 413 Payload Too Large", async () => {
    const oversizedBody = "x".repeat(2048); // limit is 1024 bytes
    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: oversizedBody }),
    });
    expect(res.status).toBe(413);
  });

  it("returns 502 Bad Gateway when upstream Ollama server is unreachable", async () => {
    // Close mock upstream to simulate connection refusal
    await new Promise<void>((resolve) => mockUpstreamServer!.close(() => resolve()));

    const res = await fetch(`http://127.0.0.1:${proxyPort}/api/tags`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(502);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("Bad Gateway");
  });
});

describe("OllamaProvider with Bearer Authentication", () => {
  let mockServer: http.Server | null = null;
  let serverPort = 0;
  let receivedAuthHeader: string | null = null;

  beforeEach(async () => {
    receivedAuthHeader = null;
    mockServer = http.createServer((req, res) => {
      receivedAuthHeader = req.headers["authorization"] || null;
      if (req.headers["authorization"] !== "Bearer valid-token") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              tasks: [
                {
                  title: "Buy groceries",
                  priority: "low",
                  evidence: "Buy groceries today",
                },
              ],
              memories: [],
            }),
          },
        }),
      );
    });

    await new Promise<void>((resolve) => {
      mockServer!.listen(0, "127.0.0.1", () => {
        serverPort = (mockServer!.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = null;
    }
  });

  it("sends Authorization: Bearer <apiKey> when apiKey option is provided", async () => {
    const provider = new OllamaProvider({
      baseUrl: `http://127.0.0.1:${serverPort}`,
      apiKey: "valid-token",
    });

    const result = await provider.extract("Buy groceries today");
    expect(receivedAuthHeader).toBe("Bearer valid-token");
    expect(result.tasks.length).toBe(1);
    expect(result.tasks[0]?.title).toBe("Buy groceries");
  });

  it("omits Authorization header when apiKey is not provided", async () => {
    const provider = new OllamaProvider({
      baseUrl: `http://127.0.0.1:${serverPort}`,
    });

    // Should fail with 401 because server requires token
    await expect(provider.extract("Buy groceries today")).rejects.toMatchObject({
      statusCode: 401,
      message: expect.stringContaining("Ollama returned HTTP 401"),
    });

    expect(receivedAuthHeader).toBeNull();
  });

  it("reads OLLAMA_API_KEY from environment variables by default", async () => {
    const origEnv = process.env["OLLAMA_API_KEY"];
    try {
      process.env["OLLAMA_API_KEY"] = "valid-token";
      const provider = new OllamaProvider({
        baseUrl: `http://127.0.0.1:${serverPort}`,
      });

      const result = await provider.extract("Buy groceries today");
      expect(receivedAuthHeader).toBe("Bearer valid-token");
      expect(result.tasks[0]?.title).toBe("Buy groceries");
    } finally {
      process.env["OLLAMA_API_KEY"] = origEnv;
    }
  });
});
