// server.js — local static server + transparent Gemini proxy.
//
// WHY THIS EXISTS (constraint H1): the API key must never live in the client bundle.
// The browser talks only to THIS server, same-origin, at /api/genai/*. This server reads
// GEMINI_API_KEY from the environment (.env, git-ignored) and injects it into the upstream
// request. The key is never sent to — or stored in — anything the browser downloads.
// Swapping this local proxy for a production proxy is a deployment change, not a code change.
//
// Zero npm dependencies on purpose (no build step — constraint H2): Node 18+ built-ins only.
// Run with:  node server.js   then open http://localhost:5173/

import { createServer } from "node:http";
import { readFile, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// --- Load .env into process.env without a dependency (only fills unset keys) ---
function loadEnv() {
  try {
    const raw = readFileSync(new URL(".env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, ""); // strip surrounding quotes
      }
    }
  } catch {
    /* no .env file — rely on the real environment */
  }
}
loadEnv();

const ROOT = fileURLToPath(new URL(".", import.meta.url)); // project dir served as web root
const PORT = process.env.PORT || 5173;
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const KEY = process.env.GEMINI_API_KEY; // server-side ONLY — never the VITE_-prefixed copy

if (!KEY) {
  console.error("FATAL: GEMINI_API_KEY is not set. Add it to .env (git-ignored) and retry.");
  process.exit(1);
}

// Content types for the small set of files this app serves.
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// Files that must never be served to the browser (defense-in-depth for H1).
const BLOCKED = /(^|[\\/])\.env|server\.js$/;

const server = createServer(async (req, res) => {
  try {
    // 1) PROXY — forward /api/genai/* to Gemini with the key injected.
    if (req.url.startsWith("/api/genai/")) {
      // Strip our prefix and any client-supplied ?key= (we always set the real one).
      const upstreamPath = req.url.slice("/api/genai".length).replace(/([?&])key=[^&]*/g, "$1");
      const body = await readBody(req);
      const upstream = await fetch(GEMINI_ORIGIN + upstreamPath, {
        method: req.method,
        headers: {
          "content-type": req.headers["content-type"] || "application/json",
          "x-goog-api-key": KEY, // injected here — the browser never sees it
        },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json",
      });
      res.end(buf);
      console.log(`[proxy] ${req.method} ${upstreamPath.split("?")[0]} -> ${upstream.status} (${buf.length}b)`);
      return;
    }

    // 2) STATIC — serve files from the project directory.
    let urlPath = decodeURIComponent(req.url.split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    if (BLOCKED.test(urlPath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      // path traversal attempt
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(`Not found: ${urlPath}`);
        return;
      }
      res.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(filePath)] || "application/octet-stream",
      });
      res.end(data);
    });
  } catch (err) {
    console.error("[server] error:", err);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Server error: ${err.message}`); // full error surfaced (per project rule)
  }
});

// Collect a request body into a Buffer.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

server.listen(PORT, () => {
  console.log(`Space Makeover Visualizer → http://localhost:${PORT}/`);
  console.log(`Proxy: /api/genai/* → ${GEMINI_ORIGIN} (key injected server-side)`);
});
