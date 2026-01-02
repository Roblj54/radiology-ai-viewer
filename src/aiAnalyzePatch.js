(async function () {
  const log = (msg) => (window.__rvDiagPush ? window.__rvDiagPush(msg) : console.log(msg));

  function findApiInput() {
    const inputs = Array.from(document.querySelectorAll("input"));
    // pick the input that looks like a URL field
    return inputs.find(i => (i.value || "").includes("http")) || inputs.find(i => (i.placeholder || "").includes("http")) || null;
  }

  function getApiBase() {
    const saved = localStorage.getItem("rv_api_base");
    if (saved) return saved;
    const inp = findApiInput();
    return inp ? (inp.value || "").trim() : "";
  }

  function setApiBase(v) {
    localStorage.setItem("rv_api_base", v);
  }

  function normalizeBase(s) {
    s = (s || "").trim();
    s = s.replace(/\/+$/, "");
    // If user pastes ".../api", keep it, backend accepts both /analyze and /api/analyze via proxy too.
    return s;
  }

  function analyzeUrl(base) {
    base = normalizeBase(base);
    // If user enters relative "/api" or "http://host:port/api"
    if (base.endsWith("/api")) return base + "/analyze";
    // If user enters just "http://host:port"
    return base + "/analyze";
  }

  function getLargestCanvas() {
    const canvases = Array.from(document.querySelectorAll("canvas")).filter(c => c.width > 0 && c.height > 0);
    canvases.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    return canvases[0] || null;
  }

  function ensureOverlayCanvas(targetCanvas) {
    const parent = targetCanvas.parentElement;
    if (!parent) return null;
    parent.style.position = parent.style.position || "relative";

    let ov = parent.querySelector("#rv-ai-overlay2");
    if (!ov) {
      ov = document.createElement("canvas");
      ov.id = "rv-ai-overlay2";
      ov.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;z-index:50;";
      parent.appendChild(ov);
    }
    ov.width = targetCanvas.width;
    ov.height = targetCanvas.height;
    ov.style.width = targetCanvas.style.width || (targetCanvas.width + "px");
    ov.style.height = targetCanvas.style.height || (targetCanvas.height + "px");
    return ov;
  }

  function drawDetections(targetCanvas, detections) {
    const ov = ensureOverlayCanvas(targetCanvas);
    if (!ov) return;
    const ctx = ov.getContext("2d");
    ctx.clearRect(0, 0, ov.width, ov.height);
    ctx.lineWidth = 2;
    ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textBaseline = "top";

    for (const d of (detections || [])) {
      const b = d.box || d.bbox || d;
      const x = Math.round((b.x ?? b[0] ?? 0) * ov.width);
      const y = Math.round((b.y ?? b[1] ?? 0) * ov.height);
      const w = Math.round((b.w ?? ((b[2] ?? 0) - (b[0] ?? 0))) * ov.width);
      const h = Math.round((b.h ?? ((b[3] ?? 0) - (b[1] ?? 0))) * ov.height);

      ctx.strokeStyle = "#22c55e";
      ctx.strokeRect(x, y, w, h);

      const label = (d.label || "Object") + " " + (d.score != null ? Number(d.score).toFixed(2) : "");
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x, y, ctx.measureText(label).width + 8, 18);
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(label, x + 4, y + 2);
    }
  }

  async function testHealth(base) {
    base = normalizeBase(base);
    const url = base.startsWith("http") ? (base + "/health") : (base + "/health");
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) throw new Error("Health check failed: HTTP " + r.status);
    const j = await r.json();
    return j;
  }

  async function sendCurrentSlicePng() {
    const base = getApiBase() || "/api";
    const url = analyzeUrl(base.startsWith("http") ? base : base);

    const canvas = getLargestCanvas();
    if (!canvas) throw new Error("No canvas found to capture. Viewer likely not initialized.");

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error("canvas.toBlob failed")), "image/png");
    });

    log("AI Analyze URL: " + url);
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: blob });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { throw new Error("Non-JSON response (HTTP " + r.status + "): " + txt.slice(0, 200)); }
    if (!r.ok || !j.ok) throw new Error("Analyze failed (HTTP " + r.status + "): " + (j.error || j.message || "unknown"));

    // If backend returned stats
    if (j.kind === "png-stats") {
      log("PNG stats: " + JSON.stringify(j.stats));
      return;
    }

    // If backend returned detections
    const dets = j.detections || j.boxes || [];
    if (dets.length) {
      log("Detections: " + dets.map(d => (d.label + ":" + d.score)).join(", "));
      drawDetections(canvas, dets);
    } else {
      log("Analyze OK, but no detections returned.");
    }
  }

  function hookButtons() {
    // Hook Save API
    const btns = Array.from(document.querySelectorAll("button"));
    const saveBtn = btns.find(b => (b.textContent || "").trim().toLowerCase() === "save api");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        try {
          const inp = findApiInput();
          if (!inp) return;
          const base = normalizeBase(inp.value || "");
          setApiBase(base);
          const h = await testHealth(base.startsWith("http") ? base : base);
          log("API saved. Health OK: " + JSON.stringify(h));
        } catch (e) {
          log("Save API health failed: " + (e?.message || e));
        }
      }, { capture: true });
    }

    // Hook AI Analyze
    const aiBtn = btns.find(b => (b.textContent || "").trim().toLowerCase() === "ai analyze");
    if (aiBtn) {
      aiBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        try {
          await sendCurrentSlicePng();
        } catch (e) {
          log("AI Analyze error: " + (e?.message || e));
          alert("AI Analyze failed. See Diagnostics box (bottom right) and DevTools Console.");
        }
      }, { capture: true });
      log("AI Analyze hook installed (sends PNG slice to backend).");
    } else {
      log("AI Analyze button not found yet. If UI renders later, refresh once.");
    }
  }

  window.addEventListener("load", () => {
    try {
      // default to proxy path for dev (no CORS)
      if (!localStorage.getItem("rv_api_base")) localStorage.setItem("rv_api_base", "/api");
      hookButtons();
    } catch (e) {
      log("Hook init error: " + (e?.message || e));
    }
  });
})();
