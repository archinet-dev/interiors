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

import { join, normalize, sep } from "node:path"; // supported under Bun's Node-compat layer

// Project root is the parent of /server/. Static client files are served from here.
const ROOT = normalize(join(import.meta.dir, ".."));
const PORT = Number(process.env.PORT) || 5173;
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const GEMINI_WS_ORIGIN = "wss://generativelanguage.googleapis.com";

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
  async fetch(req, server) {
    const url = new URL(req.url);
    // decodeURIComponent throws on malformed percent-encoding (e.g. a bare "%"). Guard it so a
    // bad URL returns 400 instead of bubbling out of fetch() and crashing the request handler.
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    // 0) LIVE WEBSOCKET PROXY — the SDK opens ws://<origin>/api/genai/ws/...BidiGenerateContent
    //    ?key=<placeholder>. Upgrade it, then pipe to the upstream wss with the REAL key injected.
    //    The browser never holds the key (H1); the key lives only in this Bun process.
    if (path.startsWith("/api/genai/ws/")) {
      const upstreamPath = path.slice("/api/genai".length); // /ws/google.ai.generativelanguage...
      // Preserve any client query params, drop the placeholder key, and set the real key.
      const params = new URLSearchParams(url.search);
      params.delete("key");
      params.set("key", KEY);
      const upstreamUrl = `${GEMINI_WS_ORIGIN}${upstreamPath}?${params}`;
      if (server.upgrade(req, { data: { upstreamUrl } })) return; // success → undefined
      return new Response("WebSocket upgrade failed", { status: 426 });
    }

    // 1) REST PROXY — forward /api/genai/* to Gemini with the key injected.
    if (path.startsWith("/api/genai/")) {
      const upstreamPath = path.slice("/api/genai".length);
      // Preserve client query params but drop any client-supplied key (we set it server-side).
      const params = new URLSearchParams(url.search);
      params.delete("key");
      const search = params.toString() ? `?${params}` : "";
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
    // Resolve to an absolute path and NORMALIZE FIRST. Normalizing before any security check
    // collapses URL-encoded traversal (e.g. /foo/%2e%2e/.env -> ROOT/.env), so a decoded "../"
    // can't slip past BLOCKED and then escape upward after the fact.
    const filePath = normalize(join(ROOT, path));
    // Separator-aware containment: require an exact ROOT match or ROOT + path separator, so a
    // sibling dir sharing ROOT's name prefix (e.g. ROOT=/app vs /app2) cannot be served.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      return new Response("Forbidden", { status: 403 }); // traversal / escaped root
    }
    // Run the blocklist on the NORMALIZED path relative to ROOT, so encoded traversal that
    // resolves into /server, /.env*, or /.git is caught here (not on the pre-normalized path).
    const rel = filePath.slice(ROOT.length) || "/";
    if (BLOCKED.test(rel)) return new Response("Not found", { status: 404 });
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

  // Live WebSocket reverse-proxy handlers. Each client connection opens one upstream WS to
  // Gemini (with the real key) and pipes frames both ways, buffering client frames until the
  // upstream handshake completes. Text-as-text, binary-as-binary (R2).
  websocket: {
    open(ws) {
      const queue = [];
      ws.data.queue = queue;
      const up = new WebSocket(ws.data.upstreamUrl); // Bun's global client WebSocket
      up.binaryType = "arraybuffer";
      ws.data.up = up;

      up.onopen = () => {
        for (const m of queue) up.send(m);
        queue.length = 0;
      };
      up.onmessage = (e) => ws.send(e.data); // upstream → client (text or ArrayBuffer)
      up.onerror = () => {
        queue.length = 0; // never sent — free buffered frames
        try { ws.close(1011, "upstream error"); } catch {}
      };
      up.onclose = (e) => {
        try { ws.close(e.code && e.code >= 1000 ? e.code : 1000, e.reason || ""); } catch {}
      };
      console.log("[ws] client connected → opening upstream Live session");
    },
    message(ws, msg) {
      const up = ws.data.up;
      if (up && up.readyState === WebSocket.OPEN) up.send(msg); // client → upstream
      else ws.data.queue.push(msg); // buffer until upstream open
    },
    close(ws) {
      try { ws.data.up?.close(); } catch {} // propagate close upstream
      console.log("[ws] client disconnected → upstream closed");
    },
  },
});

console.log(`Space Makeover Visualizer → ${server.url}`);
console.log(`Proxy: /api/genai/* → ${GEMINI_ORIGIN} (key injected server-side, running under Bun)`);
