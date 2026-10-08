import type { Plugin } from "vite";
import { handleApiRequest } from "./api";

export function apiDevPlugin(): Plugin {
  return {
    name: "stepout-api-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const urlPath = req.url?.split("?")[0] ?? "";
        if (!urlPath.startsWith("/api")) {
          return next();
        }

        try {
          const host = req.headers.host || "localhost:3000";
          const fullUrl = `http://${host}${req.url}`;
          const method = req.method || "GET";

          const headers = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value) {
              if (Array.isArray(value)) {
                value.forEach((v) => headers.append(key, v));
              } else {
                headers.set(key, value);
              }
            }
          }

          let body: string | undefined;
          if (method !== "GET" && method !== "HEAD") {
            const chunks: Uint8Array[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
            }
            body = Buffer.concat(chunks).toString("utf-8");
          }

          const requestInit: RequestInit = {
            method,
            headers,
          };
          if (body) {
            requestInit.body = body;
          }

          const webRequest = new Request(fullUrl, requestInit);

          const webResponse = await handleApiRequest(webRequest);

          res.statusCode = webResponse.status;
          webResponse.headers.forEach((val, key) => {
            res.setHeader(key, val);
          });

          const arrayBuffer = await webResponse.arrayBuffer();
          res.end(Buffer.from(arrayBuffer));
        } catch (error) {
          console.error("[Vite Dev API Error]", error);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
      });
    },
  };
}
