import http, { type IncomingMessage, type ServerResponse } from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";

export interface OllamaProxyOptions {
  token: string;
  targetUrl?: string;
  maxBodyBytes?: number;
  timeoutMs?: number;
  allowedEndpoints?: { method: string; path: string }[];
}

export const DEFAULT_ALLOWED_ENDPOINTS = [
  { method: "POST", path: "/api/chat" },
  { method: "GET", path: "/api/tags" },
  { method: "GET", path: "/api/version" },
];

export function timingSafeTokenCheck(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    // Constant time dummy compare to mitigate timing variance
    crypto.timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export function createOllamaProxyServer(options: OllamaProxyOptions): http.Server {
  const {
    token,
    targetUrl = "http://127.0.0.1:11434",
    maxBodyBytes = 5 * 1024 * 1024, // 5MB
    timeoutMs = 120000, // 120s
    allowedEndpoints = DEFAULT_ALLOWED_ENDPOINTS,
  } = options;

  if (!token || typeof token !== "string" || token.trim().length < 8) {
    throw new Error("Ollama proxy requires a strong secret token (at least 8 characters).");
  }

  const upstreamUrl = new URL(targetUrl);

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const startTime = Date.now();
    const reqMethod = (req.method || "GET").toUpperCase();
    const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
    const reqPath = parsedUrl.pathname;

    const sendJson = (
      statusCode: number,
      data: Record<string, unknown>,
      extraHeaders: Record<string, string> = {},
    ) => {
      if (res.headersSent) return;
      res.writeHead(statusCode, {
        "Content-Type": "application/json",
        Connection: "close",
        ...extraHeaders,
      });
      res.end(JSON.stringify(data));
      const duration = Date.now() - startTime;
      console.log(`[Proxy] ${reqMethod} ${reqPath} -> ${statusCode} (${duration}ms)`);
    };

    // 1. Authenticate Request with Bearer Token
    const authHeader = req.headers["authorization"] || "";
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const providedToken = bearerMatch ? bearerMatch[1]?.trim() : null;

    if (!providedToken || !timingSafeTokenCheck(providedToken, token)) {
      return sendJson(
        401,
        { error: "Unauthorized: Invalid or missing bearer token" },
        { "WWW-Authenticate": 'Bearer realm="ollama-proxy"' },
      );
    }

    // 2. Restrict to whitelisted endpoints & methods
    const isAllowed = allowedEndpoints.some((ep) => ep.method === reqMethod && ep.path === reqPath);

    if (!isAllowed) {
      return sendJson(403, {
        error: `Forbidden: Endpoint '${reqMethod} ${reqPath}' is not permitted by proxy policy`,
        allowed: allowedEndpoints.map((e) => `${e.method} ${e.path}`),
      });
    }

    // 3. Prepare Upstream Request
    const forwardHeaders: http.OutgoingHttpHeaders = {};
    if (req.headers["content-type"]) forwardHeaders["content-type"] = req.headers["content-type"];
    if (req.headers["accept"]) forwardHeaders["accept"] = req.headers["accept"];
    if (req.headers["user-agent"]) forwardHeaders["user-agent"] = req.headers["user-agent"];
    if (req.headers["content-length"])
      forwardHeaders["content-length"] = req.headers["content-length"];

    const upstreamReq = http.request(
      {
        hostname: upstreamUrl.hostname,
        port: upstreamUrl.port || 80,
        path: req.url, // includes path + query
        method: reqMethod,
        headers: forwardHeaders,
        timeout: timeoutMs,
      },
      (upstreamRes) => {
        // Forward upstream status and headers
        res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);

        // Pipe upstream stream directly to client
        upstreamRes.pipe(res);

        upstreamRes.on("end", () => {
          const duration = Date.now() - startTime;
          console.log(
            `[Proxy] ${reqMethod} ${reqPath} -> ${upstreamRes.statusCode} (${duration}ms)`,
          );
        });

        upstreamRes.on("error", (err) => {
          console.error(`[Proxy Upstream Stream Error] ${reqMethod} ${reqPath}:`, err.message);
          if (!res.headersSent) {
            sendJson(502, { error: "Bad Gateway: Upstream response error" });
          }
        });
      },
    );

    upstreamReq.on("timeout", () => {
      upstreamReq.destroy(new Error("Upstream timeout"));
      sendJson(504, { error: "Gateway Timeout: Upstream Ollama request timed out" });
    });

    upstreamReq.on("error", (err) => {
      console.error(`[Proxy Upstream Connection Error] ${reqMethod} ${reqPath}:`, err.message);
      if (!res.headersSent) {
        sendJson(502, {
          error: `Bad Gateway: Unable to connect to Ollama at ${targetUrl} (${err.message})`,
        });
      }
    });

    // 4. Stream Client Request Body with Size Guard
    let receivedBytes = 0;
    let limitExceeded = false;

    req.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBodyBytes) {
        limitExceeded = true;
        req.pause();
        upstreamReq.destroy();
        sendJson(413, { error: "Payload Too Large: Request exceeds maximum allowed size" });
        return;
      }
      upstreamReq.write(chunk);
    });

    req.on("end", () => {
      if (!limitExceeded) {
        upstreamReq.end();
      }
    });

    req.on("error", (err) => {
      upstreamReq.destroy(err);
      if (!res.headersSent) {
        sendJson(400, { error: `Client request error: ${err.message}` });
      }
    });
  });

  return server;
}
