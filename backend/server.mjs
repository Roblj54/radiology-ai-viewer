import http from "http";
import url from "url";

const PORT = process.env.PORT || 8787;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Api-Key"
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname || "/";

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Api-Key"
    });
    return res.end();
  }

  if (path === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "radiology-ai-backend-stub",
      ts: new Date().toISOString()
    });
  }

  if (path === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "radiology-ai-backend-stub",
      via: "/api/health",
      ts: new Date().toISOString()
    });
  }

  if (path === "/api/analyze" && req.method === "POST") {
    const chunks = [];
    req.on("data", chunk => chunks.push(chunk));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      console.log(`Received analyze request with ${buf.length} bytes`);

      // Simple stub payload. Adjust fields later if frontend expects more.
      const result = {
        ok: true,
        endpoint: "/api/analyze",
        bytesReceived: buf.length,
        note: "Stub AI analysis. ONNX model not loaded.",
        findings: [
          {
            id: "stub-1",
            label: "No suspicious finding (stub)",
            score: 0.01
          }
        ]
      };

      sendJson(res, 200, result);
    });
    return;
  }

  // Fallback 404
  sendJson(res, 404, {
    ok: false,
    error: "Not found",
    path
  });
});

server.listen(PORT, () => {
  console.log(`Backend stub listening on http://127.0.0.1:${PORT}`);
});
