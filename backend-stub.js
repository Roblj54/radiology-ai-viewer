const http = require("http");
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "radiology-ai-backend-stub" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "Not Found", path: req.url }));
});
server.listen(8787, "127.0.0.1", () => {
  console.log("Backend stub listening on http://127.0.0.1:8787");
});
