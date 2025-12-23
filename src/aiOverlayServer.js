function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function getApiBase() {
  const qs = new URLSearchParams(location.search);
  const fromQS = qs.get("api");
  if (fromQS) return fromQS;

  try {
    if (import.meta?.env?.VITE_AI_API_BASE) return import.meta.env.VITE_AI_API_BASE;
  } catch {}

  const fromLS = localStorage.getItem("AI_API_BASE");
  if (fromLS) return fromLS;

  return "http://localhost:8787";
}

function setApiBase(v) {
  localStorage.setItem("AI_API_BASE", v);
}

function getContainer() {
  return (
    document.getElementById("dicomViewport") ||
    document.getElementById("viewport") ||
    document.querySelector("[data-viewport]") ||
    (document.querySelector("canvas") ? document.querySelector("canvas").parentElement : null)
  );
}

function getCanvas(container) {
  if (!container) return null;
  return container.querySelector("canvas") || document.querySelector("canvas");
}

function ensureOverlay(container) {
  let ol = container.querySelector(".ai-server-overlay");
  if (!ol) {
    container.style.position = container.style.position || "relative";
    ol = document.createElement("div");
    ol.className = "ai-server-overlay";
    ol.style.cssText = "position:absolute; inset:0; pointer-events:none; z-index:9999;";
    container.appendChild(ol);
  }
  return ol;
}

function clearOverlay(container) {
  const ol = container?.querySelector?.(".ai-server-overlay");
  if (ol) ol.innerHTML = "";
}

function drawBoxes(container, boxes) {
  const ol = ensureOverlay(container);
  ol.innerHTML = "";

  const rect = container.getBoundingClientRect();
  const W = rect.width;
  const H = rect.height;

  (boxes || []).forEach((b) => {
    const x = b.x, y = b.y, w = b.w, h = b.h;
    const normalized = (x <= 1 && y <= 1 && w <= 1 && h <= 1);

    const px = normalized ? clamp01(x) * W : x;
    const py = normalized ? clamp01(y) * H : y;
    const pw = normalized ? clamp01(w) * W : w;
    const ph = normalized ? clamp01(h) * H : h;

    const el = document.createElement("div");
    el.style.cssText =
      `position:absolute; left:${px}px; top:${py}px; width:${pw}px; height:${ph}px;` +
      "border:2px solid rgba(0,255,255,0.95); border-radius:8px;" +
      "box-shadow:0 0 0 1px rgba(0,0,0,0.25) inset;";

    const label = document.createElement("div");
    const score = (typeof b.score === "number") ? ` (${Math.round(b.score * 100)}%)` : "";
    label.textContent = (b.label || "Finding") + score;
    label.style.cssText =
      "position:absolute; left:0; top:-22px; padding:3px 6px; border-radius:8px;" +
      "background:rgba(255,255,255,0.92); color:#111; font:700 12px/1 system-ui;" +
      "border:1px solid rgba(255,255,255,0.35);";
    el.appendChild(label);

    ol.appendChild(el);
  });
}

async function analyze() {
  const container = getContainer();
  if (!container) { alert("Viewport container not found."); return; }

  const canvas = getCanvas(container);
  if (!canvas || typeof canvas.toDataURL !== "function") {
    alert("Canvas not ready. Load a DICOM series first.");
    return;
  }

  const apiBase = (getApiBase() || "").replace(/\/+$/,"");
  const url = apiBase + "/analyze";

  const image = canvas.toDataURL("image/png");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, meta: { ts: Date.now() } })
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`API error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    drawBoxes(container, data.boxes || []);
  } catch (e) {
    console.warn(e);
    alert("AI API call failed. Check API URL and CORS, then try again.");
  }
}

function ensurePanel() {
  let panel = document.getElementById("aiServerPanel");
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = "aiServerPanel";
  panel.style.cssText =
    "position:fixed; top:12px; right:12px; z-index:1000000;" +
    "display:flex; gap:8px; align-items:center;" +
    "background:rgba(15,23,42,0.55); border:1px solid rgba(148,163,184,0.35);" +
    "padding:10px; border-radius:14px; backdrop-filter:blur(8px);";

  const input = document.createElement("input");
  input.type = "text";
  input.value = getApiBase();
  input.placeholder = "AI API base URL";
  input.style.cssText =
    "width:320px; max-width:45vw; padding:8px 10px; border-radius:10px;" +
    "border:1px solid rgba(148,163,184,0.45); background:rgba(255,255,255,0.92);" +
    "color:#111; font:600 12px/1 system-ui; outline:none;";

  const save = document.createElement("button");
  save.textContent = "Save API";
  save.style.cssText =
    "padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,0.35);" +
    "background:rgba(255,255,255,0.92); color:#111; font:800 12px/1 system-ui; cursor:pointer;";
  save.onclick = () => { setApiBase(input.value.trim()); alert("Saved API URL."); };

  const run = document.createElement("button");
  run.textContent = "AI Analyze";
  run.style.cssText =
    "padding:8px 10px; border-radius:10px; border:1px solid rgba(0,255,255,0.55);" +
    "background:rgba(255,255,255,0.92); color:#111; font:900 12px/1 system-ui; cursor:pointer;";
  run.onclick = () => analyze();

  const clr = document.createElement("button");
  clr.textContent = "Clear";
  clr.style.cssText =
    "padding:8px 10px; border-radius:10px; border:1px solid rgba(148,163,184,0.45);" +
    "background:rgba(255,255,255,0.92); color:#111; font:800 12px/1 system-ui; cursor:pointer;";
  clr.onclick = () => clearOverlay(getContainer());

  panel.appendChild(input);
  panel.appendChild(save);
  panel.appendChild(run);
  panel.appendChild(clr);

  document.body.appendChild(panel);
  return panel;
}

export function installAIServerPanel() {
  ensurePanel();
}
