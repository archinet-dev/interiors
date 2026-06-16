// server/index.js — Bun static server + transparent Gemini proxy.
//
// WHY THIS EXISTS (constraints H1 + H6):
//  - H1: the API key must never live in the client bundle. The browser talks only to THIS
//    server, same-origin, at /api/genai/*. The key is read from the environment and injected
//    into the upstream request — never sent to, or stored in, anything the browser downloads.
//  - H6: all server-side code runs under Bun, not Node. This uses Bun.serve() and Bun.file()
//    (no node:http, no Express/Vite, no dotenv). The only node:* import is node:path, which
//    Bun fully supports.
//
// Bun auto-loads .env (git-ignored) — no dependency needed. No build step (H2).
// Run with:  bun run start    (or directly:  bun server/index.js ;  bun --watch for reload)

import { join, normalize } from "node:path"; // supported under Bun's Node-compat layer

// Project root is the parent of /server/. Static client files are served from here.
const ROOT = normalize(join(import.meta.dir, ".."));
const PORT = Number(process.env.PORT) || 5173;
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";

// Bun populated this from .env automatically. Server-side ONLY — never the VITE_-prefixed copy.
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("FATAL: GEMINI_API_KEY is not set. Add it to .env (git-ignored) and retry.");
  process.exit(1);
}

// Never serve server code, env files, or git internals to the browser (defense-in-depth, H1/H6).
const BLOCKED = /^\/(server\/|\.env|\.git\/)/;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);

    // 1) PROXY — forward /api/genai/* to Gemini with the key injected.
    if (path.startsWith("/api/genai/")) {
      const upstreamPath = path.slice("/api/genai".length);
      // Drop any client-supplied ?key= — we always set the real key server-side.
      const search = url.search.replace(/([?&])key=[^&]*/g, "$1");
      const upstream = await fetch(GEMINI_ORIGIN + upstreamPath + search, {
        method: req.method,
        headers: {
          "content-type": req.headers.get("content-type") || "application/json",
          "x-goog-api-key": KEY, // injected here — the browser never sees it
        },
        // Buffer the body (simple + safe for JSON/image payloads; no duplex streaming needed).
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      });
      const buf = await upstream.arrayBuffer();
      console.log(`[proxy] ${req.method} ${upstreamPath} -> ${upstream.status} (${buf.byteLength}b)`);
      return new Response(buf, {
        status: upstream.status,
        headers: { "content-type": upstream.headers.get("content-type") || "application/json" },
      });
    }

    // 2) STATIC — Bun.file() sets Content-Type from the extension (text/javascript for .js,
    //    so ES-module imports load correctly). Bun.file is lazy, so guard with exists().
    if (path === "/") path = "/index.html";
    if (BLOCKED.test(path)) return new Response("Not found", { status: 404 });
    const filePath = normalize(join(ROOT, path));
    if (!filePath.startsWith(ROOT)) return new Response("Forbidden", { status: 403 }); // traversal
    const file = Bun.file(filePath);
    if (await file.exists()) return new Response(file);
    return new Response(`Not found: ${path}`, {
      status: 404,
      headers: { "content-type": "text/plain;charset=utf-8" },
    });
  },
  // Surface the full error to the user (per project rule) instead of a blank 500.
  error(err) {
    console.error("[server] error:", err);
    return new Response(`Server error: ${err.message}`, {
      status: 500,
      headers: { "content-type": "text/plain;charset=utf-8" },
    });
  },
});

console.log(`Space Makeover Visualizer → ${server.url}`);
console.log(`Proxy: /api/genai/* → ${GEMINI_ORIGIN} (key injected server-side, running under Bun)`);
