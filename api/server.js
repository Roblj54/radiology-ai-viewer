import express from "express";
import cors from "cors";

const app = express();

// Comma-separated list, example:
// ALLOWED_ORIGINS=https://roblj54.github.io,http://localhost:5173
const allowed = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    if (allowed.includes("*")) return cb(null, true);
    return cb(null, allowed.includes(origin));
  }
}));

app.use(express.json({ limit: "25mb" }));

app.get("/health", (req, res) => res.json({ ok: true }));

// POST /analyze
// body: { image: "data:image/png;base64,...", meta?: {...} }
// returns: { boxes: [{x,y,w,h,label,score}] } where coords are normalized 0..1
app.post("/analyze", async (req, res) => {
  try {
    const { image } = req.body || {};
    if (!image || typeof image !== "string" || !image.startsWith("data:image/")) {
      return res.status(400).json({ error: "Missing or invalid 'image' data URL." });
    }

    // TODO: Replace this mock with your real Radiology AI integration.
    // For now, return deterministic sample boxes.
    const boxes = [
      { x: 0.58, y: 0.22, w: 0.22, h: 0.18, label: "Finding A (mock)", score: 0.88 },
      { x: 0.30, y: 0.55, w: 0.18, h: 0.14, label: "Finding B (mock)", score: 0.73 }
    ];

    return res.json({ boxes });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(`ALLOWED_ORIGINS=${process.env.ALLOWED_ORIGINS || "*"}`);
});
