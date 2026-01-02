(function () {
  const box = document.createElement("div");
  box.id = "rv-diag";
  box.style.cssText = [
    "position:fixed",
    "right:12px",
    "bottom:12px",
    "z-index:99999",
    "max-width:520px",
    "background:rgba(0,0,0,0.72)",
    "color:#e5e7eb",
    "padding:10px 12px",
    "border:1px solid rgba(255,255,255,0.18)",
    "border-radius:10px",
    "font:12px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    "white-space:pre-wrap"
  ].join(";");

  const lines = [];
  function push(msg) {
    const s = String(msg || "");
    lines.unshift(s);
    while (lines.length > 12) lines.pop();
    box.textContent = "Diagnostics (latest on top)\n\n" + lines.join("\n");
    console.log("[RV-DIAG]", s);
  }

  window.addEventListener("error", (e) => push("ERROR: " + (e?.message || e)));
  window.addEventListener("unhandledrejection", (e) => push("UNHANDLED: " + (e?.reason?.message || e?.reason || e)));
  window.addEventListener("load", () => push("UI loaded. If DICOM fails, check console + network for the first red error."));

  document.body.appendChild(box);
  window.__rvDiagPush = push;
})();
