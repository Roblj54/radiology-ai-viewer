export function setupAIMockOverlay(opts) {
  const viewport = opts && opts.viewport;
  const container = opts && opts.container;
  if (!container) throw new Error("setupAIMockOverlay: container is required");

  // Ensure container is positioned
  const cs = window.getComputedStyle(container);
  if (cs.position === "static") container.style.position = "relative";

  // Overlay canvas
  const overlay = document.createElement("canvas");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9998";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  container.appendChild(overlay);

  const ctx = overlay.getContext("2d");

  let enabled = false;
  let boxes = [];
  let heat = [];
  let measures = [];

  const hasWorld = !!(viewport && typeof viewport.canvasToWorld === "function" && typeof viewport.worldToCanvas === "function");
  const toWorld  = (x, y) => hasWorld ? viewport.canvasToWorld([x, y]) : [x, y, 0];
  const toCanvas = (p) => hasWorld ? viewport.worldToCanvas(p) : [p[0], p[1]];
  const dist3    = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], (a[2]||0)-(b[2]||0));

  function resize() {
    const base = (viewport && typeof viewport.getCanvas === "function" && viewport.getCanvas()) || container.querySelector("canvas");
    const w = (base && base.width)  ? base.width  : container.clientWidth;
    const h = (base && base.height) ? base.height : container.clientHeight;
    if (overlay.width !== w) overlay.width = w;
    if (overlay.height !== h) overlay.height = h;
  }

  function worldFromNorm(nx, ny) {
    resize();
    const x = nx * overlay.width;
    const y = ny * overlay.height;
    return toWorld(x, y);
  }

  function seedMock() {
    boxes = [
      { a: worldFromNorm(0.28, 0.30), b: worldFromNorm(0.55, 0.58), label: "Nodule 0.87" },
      { a: worldFromNorm(0.62, 0.22), b: worldFromNorm(0.82, 0.40), label: "Mass 0.73" },
    ];

    heat = [
      (() => {
        const c = worldFromNorm(0.48, 0.52);
        const e = worldFromNorm(0.56, 0.52);
        return { c, e, w: 0.55 };
      })(),
      (() => {
        const c = worldFromNorm(0.70, 0.35);
        const e = worldFromNorm(0.76, 0.35);
        return { c, e, w: 0.35 };
      })(),
    ];

    measures = [
      (() => {
        const p1 = worldFromNorm(0.30, 0.72);
        const p2 = worldFromNorm(0.52, 0.72);
        return { p1, p2, label: "AI length" };
      })(),
    ];
  }

  function clear() { ctx.clearRect(0, 0, overlay.width, overlay.height); }

  function draw() {
    resize();
    clear();
    if (!enabled) return;

    ctx.save();
    ctx.lineWidth = 2;
    ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.textBaseline = "top";

    // Heatmap
    for (const h of heat) {
      const c2 = toCanvas(h.c);
      const e2 = toCanvas(h.e);
      const r = Math.hypot(c2[0] - e2[0], c2[1] - e2[1]);

      const g = ctx.createRadialGradient(c2[0], c2[1], 0, c2[0], c2[1], r);
      g.addColorStop(0, "rgba(255,0,0," + (0.35 * h.w) + ")");
      g.addColorStop(1, "rgba(255,0,0,0)");
      ctx.fillStyle = g;

      ctx.beginPath();
      ctx.arc(c2[0], c2[1], r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Boxes
    ctx.strokeStyle = "rgba(0,255,0,0.9)";
    ctx.fillStyle = "rgba(0,255,0,0.9)";
    for (const b of boxes) {
      const a = toCanvas(b.a);
      const c = toCanvas(b.b);

      const x = Math.min(a[0], c[0]);
      const y = Math.min(a[1], c[1]);
      const w = Math.abs(a[0] - c[0]);
      const hh = Math.abs(a[1] - c[1]);

      ctx.strokeRect(x, y, w, hh);
      ctx.fillText(b.label, x + 3, y + 3);
    }

    // Measurement line
    ctx.strokeStyle = "rgba(255,255,0,0.95)";
    ctx.fillStyle = "rgba(255,255,0,0.95)";
    for (const m of measures) {
      const p1 = toCanvas(m.p1);
      const p2 = toCanvas(m.p2);

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.stroke();

      const mm = dist3(m.p1, m.p2).toFixed(1);
      ctx.fillText(m.label + ": " + mm + " mm", (p1[0] + p2[0]) / 2 + 6, (p1[1] + p2[1]) / 2 + 6);
    }

    ctx.restore();
  }

  const redraw = () => window.requestAnimationFrame(draw);
  window.addEventListener("resize", redraw, { passive: true });
  container.addEventListener("wheel", redraw, { passive: true });
  container.addEventListener("pointermove", redraw, { passive: true });
  container.addEventListener("pointerup", redraw, { passive: true });

  return {
    start() { enabled = true; seedMock(); draw(); },
    stop() { enabled = false; draw(); },
    toggle() { enabled ? this.stop() : this.start(); },
    redraw: draw,
    destroy() {
      try { overlay.remove(); } catch {}
      window.removeEventListener("resize", redraw);
    }
  };
}
