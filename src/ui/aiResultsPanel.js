/**
 * AI Results Panel
 * - Listens for results via:
 *   1) window.setAIResults(findingsArray)
 *   2) window.dispatchEvent(new CustomEvent("ai:results", { detail: findingsArray }))
 *
 * Finding shape example:
 * { id:"f1", label:"Nodule", score:0.87, sliceIndex:42, bbox:{x:0.3,y:0.4,w:0.2,h:0.2} }
 */

function $(id){ return document.getElementById(id); }

function safeNumber(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function getCornerstoneContext(){
  // Your main app can set these for jump-to-slice support:
  // window.__CS_RENDERING_ENGINE__ = renderingEngine;
  // window.__CS_VIEWPORT_ID__ = viewportId;
  return {
    renderingEngine: window.__CS_RENDERING_ENGINE__ || null,
    viewportId: window.__CS_VIEWPORT_ID__ || null
  };
}

async function jumpToFinding(f){
  const ctx = getCornerstoneContext();
  if (!ctx.renderingEngine || !ctx.viewportId){
    console.warn("[AI Results] Missing Cornerstone context. Set window.__CS_RENDERING_ENGINE__ and window.__CS_VIEWPORT_ID__ in your main code.");
    return;
  }

  const viewport = ctx.renderingEngine.getViewport(ctx.viewportId);
  if (!viewport){
    console.warn("[AI Results] Viewport not found:", ctx.viewportId);
    return;
  }

  // Jump to slice index if supported by your viewport implementation
  const sliceIndex = safeNumber(f.sliceIndex);
  if (sliceIndex !== null){
    try{
      if (typeof viewport.setImageIdIndex === "function"){
        await viewport.setImageIdIndex(sliceIndex);
      } else if (typeof viewport.setImageIndex === "function"){
        await viewport.setImageIndex(sliceIndex);
      } else if (typeof viewport.scroll === "function"){
        // fallback: try scrolling delta to reach target (best effort)
        const current = (typeof viewport.getCurrentImageIdIndex === "function") ? viewport.getCurrentImageIdIndex() : null;
        if (current !== null){
          viewport.scroll(sliceIndex - current);
        }
      }
    }catch(e){
      console.warn("[AI Results] Slice jump failed:", e);
    }
  }

  // Zoom in a bit if supported
  try{
    if (typeof viewport.getZoom === "function" && typeof viewport.setZoom === "function"){
      const z = viewport.getZoom() || 1;
      viewport.setZoom(z * 1.6);
    } else if (typeof viewport.getCamera === "function" && typeof viewport.setCamera === "function"){
      const cam = viewport.getCamera();
      if (cam && cam.parallelScale){
        viewport.setCamera({ parallelScale: cam.parallelScale / 1.6 });
      }
    }
  }catch(e){
    console.warn("[AI Results] Zoom failed:", e);
  }

  try{
    if (typeof viewport.render === "function") viewport.render();
  }catch(e){}

  // Let your overlay know what is active (optional)
  window.dispatchEvent(new CustomEvent("ai:select", { detail: f }));
}

export function initAIResultsPanel(){
  const panel = $("aiResultsPanel");
  const listEl = $("aiResultsList");
  const countEl = $("aiResultsCount");
  const dockBtn = $("aiResultsDockBtn");
  const toggleBtn = $("aiResultsToggleBtn");
  const clearBtn = $("aiResultsClearBtn");
  const searchEl = $("aiResultsSearch");
  const filterEl = $("aiResultsFilter");

  if (!panel || !listEl || !countEl || !dockBtn || !toggleBtn || !clearBtn || !searchEl || !filterEl){
    console.warn("[AI Results] Missing panel elements. Did index.html injection run?");
    return null;
  }

  let allFindings = [];

  function openPanel(){
    panel.classList.remove("is-collapsed");
    panel.style.pointerEvents = "auto";
    panel.style.opacity = "1";
  }
  function togglePanel(){
    const collapsed = panel.classList.toggle("is-collapsed");
    panel.style.pointerEvents = collapsed ? "none" : "auto";
    panel.style.opacity = collapsed ? "0" : "1";
  }

  function clear(){
    allFindings = [];
    render();
  }

  function uniqueLabels(findings){
    const s = new Set();
    findings.forEach(f => s.add(String(f.label || "Unknown").toLowerCase()));
    return Array.from(s).sort();
  }

  function renderFilterOptions(){
    const labels = uniqueLabels(allFindings);
    const current = String(filterEl.value || "all").toLowerCase();

    const options = ['<option value="all">All</option>']
      .concat(labels.map(l => `<option value="${l}">${l}</option>`))
      .join("");

    filterEl.innerHTML = options;

    const hasCurrent = Array.from(filterEl.options).some(o => String(o.value).toLowerCase() === current);
    filterEl.value = hasCurrent ? current : "all";
  }

  function applySearchAndFilter(findings){
    const q = String(searchEl.value || "").trim().toLowerCase();
    const flt = String(filterEl.value || "all").trim().toLowerCase();

    return findings.filter(f => {
      const label = String(f.label || "Unknown").toLowerCase();
      const id = String(f.id || "").toLowerCase();
      const passFilter = (flt === "all") ? true : (label === flt);
      const passSearch = (!q) ? true : (label.includes(q) || id.includes(q));
      return passFilter && passSearch;
    });
  }

  function renderList(){
    const shown = applySearchAndFilter(allFindings);
    countEl.textContent = String(shown.length);

    listEl.innerHTML = shown.map(f => {
      const label = String(f.label || "Unknown");
      const id = String(f.id || "");
      const score = (typeof f.score === "number") ? `${Math.round(f.score * 100)}%` : "NA";
      const sliceIndex = safeNumber(f.sliceIndex);
      const slice = (sliceIndex !== null) ? `Slice ${sliceIndex}` : "Slice NA";

      return `
        <div class="aiResultItem" data-id="${id}">
          <div class="aiResultTop">
            <div class="aiResultLabel">${label}</div>
            <div class="aiResultBadge">${score}</div>
          </div>
          <div class="aiResultMeta">
            <span>${slice}</span>
            ${id ? `<span>${id}</span>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function render(){
    renderFilterOptions();
    renderList();
  }

  // Event delegation for clicks
  listEl.addEventListener("click", (ev) => {
    const item = ev.target.closest(".aiResultItem");
    if (!item) return;
    const id = item.getAttribute("data-id") || "";
    const found = allFindings.find(x => String(x.id || "") === id) || null;
    if (found) jumpToFinding(found);
  });

  // Wire UI
  dockBtn.addEventListener("click", togglePanel);
  toggleBtn.addEventListener("click", togglePanel);
  clearBtn.addEventListener("click", clear);
  searchEl.addEventListener("input", render);
  filterEl.addEventListener("change", render);

  // Allow external push
  function setResults(findings){
    allFindings = Array.isArray(findings) ? findings : [];
    openPanel();
    render();
  }

  // Listen for app events
  window.addEventListener("ai:results", (e) => {
    setResults((e && e.detail) ? e.detail : []);
  });

  // Convenience API
  window.setAIResults = setResults;

  // Start collapsed
  render();
  return { setResults, clear, togglePanel, openPanel };
}

// Auto-init when loaded
document.addEventListener("DOMContentLoaded", () => {
  try{
    initAIResultsPanel();
  }catch(e){
    console.warn("[AI Results] init failed:", e);
  }
});

