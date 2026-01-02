import http from "node:http";
import { URL } from "node:url";

const HOST = "127.0.0.1";
const PORT = 8787;

function applyCors(req, res, headersObj) {
  const origin = req.headers.origin;

  // If browser sends Origin, reflect it back (safe for local dev) and allow credentials.
  // If no Origin (curl, PowerShell), allow everyone.
  if (origin) {
    headersObj["Access-Control-Allow-Origin"] = origin;
    headersObj["Vary"] = "Origin";
    headersObj["Access-Control-Allow-Credentials"] = "true";
  } else {
    headersObj["Access-Control-Allow-Origin"] = "*";
  }

  headersObj["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
  const reqHdrs = req.headers["access-control-request-headers"];
  headersObj["Access-Control-Allow-Headers"] = reqHdrs || "Content-Type, Authorization";
  headersObj["Access-Control-Max-Age"] = "86400";
}

function normalizePath(p) {
  if (!p) return "/";
  // Accept GitHub Pages style base prefix
  p = p.replace(/^\/radiology-ai-viewer(?=\/)/, "");
  // Accept /api prefix (either /api or /api/xxx)
  if (p === "/api") return "/";
  if (p.startsWith("/api/")) return p.slice(4);
  return p;
}

function readAll(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function sendJson(req, res, status, obj) {
  const headers = { "Content-Type": "application/json" };
  applyCors(req, res, headers);
  res.writeHead(status, headers);
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    const headers = {};
    applyCors(req, res, headers);
    res.writeHead(204, headers);
    return res.end();
  }

  const u = new URL(req.url, `http://${HOST}:${PORT}`);
  const rawPath = u.pathname || "/";
  const path = normalizePath(rawPath);

  console.log(`${new Date().toISOString()} ${req.method} ${rawPath} -> ${path}`);

  // Health
  if (path === "/health") {
    return sendJson(req, res, 200, { ok: true, service: "backend-stub", time: new Date().toISOString() });
  }

  // Treat any of these as "analyze" so the UI works even if it calls different routes
  const isAi = ["/", "/analyze", "/predict", "/infer", "/ai", "/v1/analyze"].includes(path);

  if (isAi) {
    await readAll(req);

    // Provide multiple common response shapes to maximize compatibility
    const x1 = 0.35, y1 = 0.35, x2 = 0.60, y2 = 0.60;
    const det = { label: "demo", score: 0.91, box: { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, x1, y1, x2, y2 };

    return sendJson(req, res, 200, {
      ok: true,
      model: "stub",
      path,
      detections: [det],
      results: [det],
      boxes: [[x1, y1, x2, y2]],
      scores: [det.score],
      labels: [det.label],
    });
  }

  return sendJson(req, res, 404, { ok: false, error: "Not Found", rawPath, normalizedPath: path });
});

server.listen(PORT, HOST, () => {
  console.log(`Backend listening on http://${HOST}:${PORT}`);
});
