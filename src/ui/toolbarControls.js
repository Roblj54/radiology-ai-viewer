/**
 * Toolbar Controls Pack (updated)
 * - Results button + badge
 * - Reset View button
 * - Transform controls: Invert, Rotate 90, Flip H, Flip V
 * - Modality badge (CT/MR/OTHER)
 * - Series selector (switch series without reload)
 * - Slice counter "current / total"
 * - Cine controls (Play/Pause + FPS + Prev/Next)
 * - Window/Level presets dropdown + manual WL/WW sliders (modality adaptive)
 * - DICOM HUD overlay (patient/study/series + spacing/thickness)
 * - AI overlay drawing (bbox markers) + click-to-jump via HUD list
 * - Auto-publish AI results by intercepting fetch() JSON responses
 *
 * Required for most controls:
 *   window.__CS_RENDERING_ENGINE__ = renderingEngine;
 *   window.__CS_VIEWPORT_ID__ = viewportId;
 * Optional (better overlay mounting and slice event hooks):
 *   window.__CS_ELEMENT__ = elementUsedToEnableTheViewport;
 *
 * Series selector inputs (pick one):
 *   window.__SERIES_CATALOG__ = [{ id, label, imageIds: [...] }, ...]
 *   window.__ALL_IMAGE_IDS__ = [...]  (will group by SeriesInstanceUID if metadata exists)
 */

function $(sel, root = document){ return root.querySelector(sel); }
function $all(sel, root = document){ return Array.from(root.querySelectorAll(sel)); }

function safeArray(x){ return Array.isArray(x) ? x : []; }
function toLower(x){ return String(x ?? "").toLowerCase(); }
function normMod(x){ return String(x ?? "").trim().toUpperCase(); }

const store = {
  get(key, fallback = ""){
    try{
      if (typeof localStorage === "undefined" || !localStorage.getItem) return fallback;
      const v = localStorage.getItem(key);
      return (v === null || v === undefined || v === "") ? fallback : v;
    }catch(e){ return fallback; }
  },
  set(key, val){
    try{
      if (typeof localStorage === "undefined" || !localStorage.setItem) return;
      localStorage.setItem(key, String(val));
    }catch(e){}
  }
};

function getCornerstoneContext(){
  return {
    renderingEngine: window.__CS_RENDERING_ENGINE__ || null,
    viewportId: window.__CS_VIEWPORT_ID__ || null
  };
}

function getViewport(){
  const ctx = getCornerstoneContext();
  if (!ctx.renderingEngine || !ctx.viewportId) return null;
  try{
    return ctx.renderingEngine.getViewport(ctx.viewportId) || null;
  }catch(e){
    return null;
  }
}

function getViewportElement(vp){
  if (vp && vp.element) return vp.element;
  if (window.__CS_ELEMENT__) return window.__CS_ELEMENT__;
  return null;
}

/* -------------------------
   Helpers: current imageId, dims
   ------------------------- */
function getStackSize(vp){
  try{
    if (vp && typeof vp.getImageIds === "function") return safeArray(vp.getImageIds()).length;
  }catch(e){}
  if (Array.isArray(window.__STACK_IMAGE_IDS__)) return window.__STACK_IMAGE_IDS__.length;
  try{
    if (vp && typeof vp.getStack === "function") {
      const st = vp.getStack();
      if (st && Array.isArray(st.imageIds)) return st.imageIds.length;
    }
  }catch(e){}
  return 0;
}

function getCurrentIndex(vp){
  try{
    if (vp && typeof vp.getCurrentImageIdIndex === "function") return Number(vp.getCurrentImageIdIndex()) || 0;
    if (vp && typeof vp.getImageIdIndex === "function") return Number(vp.getImageIdIndex()) || 0;
    if (vp && typeof vp.getCurrentImageIndex === "function") return Number(vp.getCurrentImageIndex()) || 0;
  }catch(e){}
  return 0;
}

function getCurrentImageId(vp){
  try{
    const ids = (vp && typeof vp.getImageIds === "function") ? safeArray(vp.getImageIds()) : [];
    if (!ids.length) return null;
    const idx = Math.min(Math.max(0, getCurrentIndex(vp)), ids.length - 1);
    return ids[idx] || null;
  }catch(e){
    return null;
  }
}

function getImageDims(vp){
  // best effort
  try{
    if (vp && typeof vp.getImageData === "function") {
      const d = vp.getImageData();
      if (d && d.dimensions && d.dimensions.length >= 2) {
        const cols = Number(d.dimensions[0]) || 0;
        const rows = Number(d.dimensions[1]) || 0;
        if (cols > 0 && rows > 0) return { cols, rows };
      }
    }
  }catch(e){}
  // fallback: try metadata rows/cols
  const imageId = getCurrentImageId(vp);
  const cs = window.cornerstone || window.cornerstonejs || window.cornerstone3d || null;
  const mdGet = cs && cs.metaData && typeof cs.metaData.get === "function" ? cs.metaData.get.bind(cs.metaData) : null;
  if (mdGet && imageId) {
    try{
      const rows = Number(mdGet("x00280010", imageId)); // Rows
      const cols = Number(mdGet("x00280011", imageId)); // Columns
      if (rows > 0 && cols > 0) return { cols, rows };
    }catch(e){}
  }
  return { cols: 512, rows: 512 };
}

/* -------------------------
   AI Results badge wiring
   ------------------------- */
function setBadgeCount(n){
  const el = document.getElementById("aiResultsDockCount");
  if (!el) return;
  el.textContent = String(Math.max(0, Number(n) || 0));
}

function installBadgeWiring(){
  window.addEventListener("ai:results", (e) => {
    const arr = e && e.detail ? e.detail : [];
    const list = safeArray(arr);
    window.__AI_FINDINGS__ = list;
    setBadgeCount(list.length);
  });

  const t = setInterval(() => {
    if (window.__AI_RESULTS_WRAPPED__) { clearInterval(t); return; }
    if (typeof window.setAIResults === "function") {
      const orig = window.setAIResults;
      window.setAIResults = (findings) => {
        const arr = safeArray(findings);
        window.__AI_FINDINGS__ = arr;
        setBadgeCount(arr.length);
        return orig(arr);
      };
      window.__AI_RESULTS_WRAPPED__ = true;
      clearInterval(t);
    }
  }, 400);
}

function toggleResultsPanel(){
  const panel = document.getElementById("aiResultsPanel");
  if (!panel) return;

  panel.classList.toggle("is-collapsed");
  const collapsed = panel.classList.contains("is-collapsed");
  panel.style.pointerEvents = collapsed ? "none" : "auto";
  panel.style.opacity = collapsed ? "0" : "1";
}

/* -------------------------
   Slice Counter
   ------------------------- */
function formatCounter(cur, total){
  if (!total || total < 1) return "-- / --";
  const c = Math.min(Math.max(0, cur), total - 1);
  return (c + 1) + " / " + total;
}

function updateSliceCounter(counterEl){
  if (!counterEl) return;
  const vp = getViewport();
  if (!vp) {
    if (counterEl.textContent !== "-- / --") counterEl.textContent = "-- / --";
    return;
  }
  const total = getStackSize(vp);
  const cur = getCurrentIndex(vp);
  const nextText = formatCounter(cur, total);
  if (counterEl.textContent !== nextText) counterEl.textContent = nextText;
}

function installSliceCounterWiring(counterEl){
  updateSliceCounter(counterEl);

  if (window.__SLICE_COUNTER_TIMER__) clearInterval(window.__SLICE_COUNTER_TIMER__);
  window.__SLICE_COUNTER_TIMER__ = setInterval(() => updateSliceCounter(counterEl), 200);

  const tryHook = () => {
    const vp = getViewport();
    const el = getViewportElement(vp);
    if (!el || !el.addEventListener) return;
    if (window.__SLICE_COUNTER_EVENTS_HOOKED__) return;
    window.__SLICE_COUNTER_EVENTS_HOOKED__ = true;

    const events = [
      "CORNERSTONE_STACK_NEW_IMAGE",
      "CORNERSTONE_STACK_VIEWPORT_SCROLL",
      "CORNERSTONE_VIEWPORT_NEW_IMAGE_SET",
      "CORNERSTONE_IMAGE_RENDERED",
      "CORNERSTONE_VOLUME_NEW_IMAGE"
    ];
    events.forEach(evt => { try{ el.addEventListener(evt, () => updateSliceCounter(counterEl)); }catch(e){} });
  };

  setTimeout(tryHook, 300);
  setTimeout(tryHook, 1200);

  document.addEventListener("wheel", () => updateSliceCounter(counterEl), { passive: true });
  document.addEventListener("keydown", (e) => {
    const k = String(e.key || "");
    if (k === "ArrowUp" || k === "ArrowDown" || k === "PageUp" || k === "PageDown") updateSliceCounter(counterEl);
  });
}

/* -------------------------
   Reset View
   ------------------------- */
function resetView(){
  const vp = getViewport();
  if (!vp) {
    console.warn("[Reset View] Missing viewport. Set window.__CS_RENDERING_ENGINE__ and window.__CS_VIEWPORT_ID__.");
    return;
  }
  try{
    if (typeof vp.resetCamera === "function") vp.resetCamera();
    if (typeof vp.resetProperties === "function") vp.resetProperties();
    if (typeof vp.setZoom === "function") vp.setZoom(1);
    if (typeof vp.setPan === "function") vp.setPan({ x: 0, y: 0 });
    if (typeof vp.render === "function") vp.render();
  }catch(e){
    console.warn("[Reset View] failed:", e);
  }
}

/* -------------------------
   Modality detection
   ------------------------- */
function modalityClass(mod){
  const m = normMod(mod);
  if (m.startsWith("CT")) return "CT";
  if (m.startsWith("MR")) return "MR";
  return m || "OTHER";
}

function detectModality(){
  const forced = window.__DICOM_MODALITY__ || window.__CS_MODALITY__ || window.__MODALITY__;
  if (forced) return modalityClass(forced);

  const vp = getViewport();
  if (!vp) return "OTHER";

  const imageId = getCurrentImageId(vp);
  if (!imageId) return "OTHER";

  const cs = window.cornerstone || window.cornerstonejs || window.cornerstone3d || null;
  const mdGet = cs && cs.metaData && typeof cs.metaData.get === "function" ? cs.metaData.get.bind(cs.metaData) : null;

  if (mdGet) {
    try{
      const gsm = mdGet("generalSeriesModule", imageId);
      if (gsm && (gsm.modality || gsm.Modality)) return modalityClass(gsm.modality || gsm.Modality);
    }catch(e){}
    try{
      const m = mdGet("x00080060", imageId);
      if (m) return modalityClass(m);
    }catch(e){}
  }
  if (window.__CS_METADATA__ && window.__CS_METADATA__.modality) return modalityClass(window.__CS_METADATA__.modality);
  return "OTHER";
}

/* -------------------------
   Transform controls (Invert, Rotate, Flip)
   ------------------------- */
function getPropBool(vp, name){
  try{
    if (vp && typeof vp.getProperties === "function") {
      const p = vp.getProperties();
      if (p && typeof p[name] === "boolean") return p[name];
    }
  }catch(e){}
  return null;
}

function setProp(vp, patch){
  try{
    if (vp && typeof vp.setProperties === "function") {
      vp.setProperties(patch);
      if (typeof vp.render === "function") vp.render();
      return true;
    }
  }catch(e){}
  return false;
}

function getViewPresentation(vp){
  try{
    if (vp && typeof vp.getViewPresentation === "function") return vp.getViewPresentation();
  }catch(e){}
  return null;
}

function setViewPresentation(vp, pres){
  try{
    if (vp && typeof vp.setViewPresentation === "function") {
      vp.setViewPresentation(pres);
      if (typeof vp.render === "function") vp.render();
      return true;
    }
  }catch(e){}
  return false;
}

function toggleInvert(btn){
  const vp = getViewport();
  if (!vp) return;

  const cur = getPropBool(vp, "invert");
  if (cur !== null) {
    const next = !cur;
    setProp(vp, { invert: next });
    if (btn) btn.classList.toggle("is-active", next);
    return;
  }

  const pres = getViewPresentation(vp);
  if (!pres) return;
  const next = !Boolean(pres.invert);
  pres.invert = next;
  setViewPresentation(vp, pres);
  if (btn) btn.classList.toggle("is-active", next);
}

function rotate90(){
  const vp = getViewport();
  if (!vp) return;

  try{
    if (typeof vp.getProperties === "function" && typeof vp.setProperties === "function") {
      const p = vp.getProperties() || {};
      const rot = Number(p.rotation) || 0;
      const next = (rot + 90) % 360;
      vp.setProperties({ rotation: next });
      if (typeof vp.render === "function") vp.render();
      return;
    }
  }catch(e){}

  const pres = getViewPresentation(vp);
  if (!pres) return;
  const rot = Number(pres.rotation) || 0;
  pres.rotation = (rot + 90) % 360;
  setViewPresentation(vp, pres);
}

function flipH(btn){
  const vp = getViewport();
  if (!vp) return;

  const pres = getViewPresentation(vp);
  if (!pres) {
    try{
      if (typeof vp.getProperties === "function" && typeof vp.setProperties === "function") {
        const p = vp.getProperties() || {};
        const next = !Boolean(p.flipHorizontal);
        vp.setProperties({ flipHorizontal: next });
        if (typeof vp.render === "function") vp.render();
        if (btn) btn.classList.toggle("is-active", next);
      }
    }catch(e){}
    return;
  }

  const next = !Boolean(pres.flipHorizontal);
  pres.flipHorizontal = next;
  setViewPresentation(vp, pres);
  if (btn) btn.classList.toggle("is-active", next);
}

function flipV(btn){
  const vp = getViewport();
  if (!vp) return;

  const pres = getViewPresentation(vp);
  if (!pres) {
    try{
      if (typeof vp.getProperties === "function" && typeof vp.setProperties === "function") {
        const p = vp.getProperties() || {};
        const next = !Boolean(p.flipVertical);
        vp.setProperties({ flipVertical: next });
        if (typeof vp.render === "function") vp.render();
        if (btn) btn.classList.toggle("is-active", next);
      }
    }catch(e){}
    return;
  }

  const next = !Boolean(pres.flipVertical);
  pres.flipVertical = next;
  setViewPresentation(vp, pres);
  if (btn) btn.classList.toggle("is-active", next);
}

/* -------------------------
   Window/Level helpers
   ------------------------- */
function getCurrentVOI(vp){
  if (!vp) return null;
  try{
    if (typeof vp.getProperties === "function") {
      const p = vp.getProperties();
      if (p && p.voiRange && Number.isFinite(p.voiRange.lower) && Number.isFinite(p.voiRange.upper)) {
        return { lower: Number(p.voiRange.lower), upper: Number(p.voiRange.upper) };
      }
    }
  }catch(e){}

  try{
    if (typeof vp.getVOI === "function") {
      const v = vp.getVOI();
      if (v) {
        if (Number.isFinite(v.lower) && Number.isFinite(v.upper)) return { lower: Number(v.lower), upper: Number(v.upper) };
        if (Number.isFinite(v.windowCenter) && Number.isFinite(v.windowWidth)) {
          const lower = Number(v.windowCenter) - (Number(v.windowWidth) / 2);
          const upper = Number(v.windowCenter) + (Number(v.windowWidth) / 2);
          return { lower, upper };
        }
      }
    }
  }catch(e){}

  try{
    if (typeof vp.getWindowLevel === "function") {
      const v = vp.getWindowLevel();
      if (v && Number.isFinite(v.windowCenter) && Number.isFinite(v.windowWidth)) {
        const lower = Number(v.windowCenter) - (Number(v.windowWidth) / 2);
        const upper = Number(v.windowCenter) + (Number(v.windowWidth) / 2);
        return { lower, upper };
      }
    }
  }catch(e){}

  return null;
}

function voiToWL(voi){
  if (!voi || !Number.isFinite(voi.lower) || !Number.isFinite(voi.upper)) return null;
  const ww = voi.upper - voi.lower;
  const wl = (voi.upper + voi.lower) / 2;
  if (!Number.isFinite(ww) || !Number.isFinite(wl) || ww <= 0) return null;
  return { ww, wl };
}

function applyVOIRangeFromWL(ww, wl){
  const vp = getViewport();
  if (!vp) {
    console.warn("[W/L] Missing viewport. Set window.__CS_RENDERING_ENGINE__ and window.__CS_VIEWPORT_ID__.");
    return;
  }

  const width = Number(ww);
  const level = Number(wl);
  if (!Number.isFinite(width) || !Number.isFinite(level) || width <= 0) return;

  const lower = level - (width / 2);
  const upper = level + (width / 2);

  try{
    if (typeof vp.setProperties === "function") {
      vp.setProperties({ voiRange: { lower, upper } });
    } else if (typeof vp.setVOI === "function") {
      vp.setVOI({ windowWidth: width, windowCenter: level });
    } else if (typeof vp.setWindowLevel === "function") {
      vp.setWindowLevel(level, width);
    }
    if (typeof vp.render === "function") vp.render();
  }catch(e){
    console.warn("[W/L] apply failed:", e);
  }
}

function ctPresetToWL(key){
  if (key === "brain")   return { ww: 70,   wl: 35 };
  if (key === "soft")    return { ww: 350,  wl: 50 };
  if (key === "lung")    return { ww: 1500, wl: -600 };
  if (key === "bone")    return { ww: 2500, wl: 500 };
  if (key === "abdomen") return { ww: 400,  wl: 50 };
  if (key === "liver")   return { ww: 150,  wl: 30 };
  return null;
}

function setSliderRanges(mod, wlSlider, wwSlider){
  if (!wlSlider || !wwSlider) return;

  const vp = getViewport();
  const current = voiToWL(getCurrentVOI(vp));

  if (mod === "CT") {
    wlSlider.min = "-1024";
    wlSlider.max = "3071";
    wlSlider.step = "1";
    wwSlider.min = "1";
    wwSlider.max = "4000";
    wwSlider.step = "1";
    return;
  }

  const wl = current ? current.wl : 0;
  const ww = current ? current.ww : 800;

  const wlMin = Math.floor(wl - 2000);
  const wlMax = Math.ceil(wl + 2000);
  const wwMax = Math.ceil(Math.max(2000, ww * 3));

  wlSlider.min = String(wlMin);
  wlSlider.max = String(wlMax);
  wlSlider.step = "1";

  wwSlider.min = "1";
  wwSlider.max = String(wwMax);
  wwSlider.step = "1";
}

function storageKey(mod, base){
  return "wl_" + base + "_" + (mod || "OTHER");
}

/* -------------------------
   Cine controls
   ------------------------- */
async function setIndex(vp, idx){
  if (!vp) return;
  try{
    if (typeof vp.setImageIdIndex === "function") {
      await vp.setImageIdIndex(idx);
    } else if (typeof vp.setImageIndex === "function") {
      await vp.setImageIndex(idx);
    } else if (typeof vp.scroll === "function") {
      const cur = getCurrentIndex(vp);
      vp.scroll(idx - cur);
    }
    if (typeof vp.render === "function") vp.render();
  }catch(e){
    console.warn("[Cine] set index failed:", e);
  }
  if (window.__SLICE_COUNTER_EL__) updateSliceCounter(window.__SLICE_COUNTER_EL__);
}

function installCineControls(groupEl){
  let playing = false;
  let timer = null;

  const cineBtn = document.createElement("button");
  cineBtn.className = "btn small";
  cineBtn.type = "button";
  cineBtn.textContent = "Cine";

  const stepBack = document.createElement("button");
  stepBack.className = "btn small";
  stepBack.type = "button";
  stepBack.textContent = "Prev";

  const stepFwd = document.createElement("button");
  stepFwd.className = "btn small";
  stepFwd.type = "button";
  stepFwd.textContent = "Next";

  const fpsWrap = document.createElement("span");
  fpsWrap.className = "cineFps";
  fpsWrap.innerHTML = '<span class="cineMini">FPS</span>';

  const slider = document.createElement("input");
  slider.className = "cineSlider";
  slider.type = "range";
  slider.min = "1";
  slider.max = "30";
  slider.step = "1";
  slider.value = "12";

  const fpsVal = document.createElement("span");
  fpsVal.className = "cineMini";
  fpsVal.textContent = slider.value;

  fpsWrap.appendChild(slider);
  fpsWrap.appendChild(fpsVal);

  function stop(){
    playing = false;
    cineBtn.textContent = "Cine";
    if (timer) { clearInterval(timer); timer = null; }
  }

  async function tick(){
    const vp = getViewport();
    if (!vp) { stop(); return; }
    const n = getStackSize(vp);
    if (!n) { stop(); return; }
    const cur = getCurrentIndex(vp);
    const next = (cur + 1) % n;
    await setIndex(vp, next);
  }

  function start(){
    const vp = getViewport();
    if (!vp) { console.warn("[Cine] Missing viewport context."); return; }
    const n = getStackSize(vp);
    if (!n) { console.warn("[Cine] No stack loaded."); return; }

    playing = true;
    cineBtn.textContent = "Pause";

    const fps = Number(slider.value) || 12;
    const interval = Math.max(20, Math.round(1000 / fps));

    if (timer) clearInterval(timer);
    timer = setInterval(() => { tick(); }, interval);
  }

  cineBtn.addEventListener("click", () => { if (playing) stop(); else start(); });
  slider.addEventListener("input", () => {
    fpsVal.textContent = slider.value;
    if (playing) { stop(); start(); }
  });

  stepBack.addEventListener("click", async () => {
    const vp = getViewport();
    if (!vp) return;
    const n = getStackSize(vp);
    if (!n) return;
    const cur = getCurrentIndex(vp);
    const next = (cur - 1 + n) % n;
    await setIndex(vp, next);
  });

  stepFwd.addEventListener("click", async () => {
    const vp = getViewport();
    if (!vp) return;
    const n = getStackSize(vp);
    if (!n) return;
    const cur = getCurrentIndex(vp);
    const next = (cur + 1) % n;
    await setIndex(vp, next);
  });

  groupEl.appendChild(cineBtn);
  groupEl.appendChild(stepBack);
  groupEl.appendChild(stepFwd);
  groupEl.appendChild(fpsWrap);
}

/* -------------------------
   AI results auto-wire (fetch interceptor)
   ------------------------- */
function normalizeFindings(data){
  if (Array.isArray(data)) return data.map((d, idx) => normalizeOne(d, idx));

  const root = data && typeof data === "object" ? data : {};
  const list =
    root.findings ??
    root.detections ??
    root.predictions ??
    root.results ??
    root.output ??
    [];
  return safeArray(list).map((d, idx) => normalizeOne(d, idx));
}

function normalizeOne(d, idx){
  const o = d && typeof d === "object" ? d : {};
  const id = o.id ?? o.uid ?? o.nameId ?? ("f" + (idx + 1));
  const label = o.label ?? o.type ?? o.class ?? o.name ?? "Finding";
  const score =
    (typeof o.score === "number") ? o.score :
    (typeof o.confidence === "number") ? o.confidence :
    (typeof o.prob === "number") ? o.prob :
    null;

  const sliceIndex = (o.sliceIndex ?? o.slice ?? o.z ?? o.frame ?? null);
  const bbox = (o.bbox ?? o.box ?? o.boundingBox ?? null);

  return { id: String(id), label: String(label), score, sliceIndex, bbox };
}

function publishResults(findings){
  const arr = safeArray(findings);
  window.__AI_FINDINGS__ = arr;
  window.dispatchEvent(new CustomEvent("ai:results", { detail: arr }));
  if (typeof window.setAIResults === "function") {
    try{ window.setAIResults(arr); }catch(e){}
  }
}

function installFetchInterceptor(){
  if (window.__AI_FETCH_INTERCEPTOR__) return;
  window.__AI_FETCH_INTERCEPTOR__ = true;

  const origFetch = window.fetch;
  if (typeof origFetch !== "function") return;

  window.fetch = async (...args) => {
    const res = await origFetch(...args);

    try{
      const ct = (res.headers && res.headers.get) ? (res.headers.get("content-type") || "") : "";
      if (!ct.toLowerCase().includes("application/json")) return res;

      const clone = res.clone();
      const data = await clone.json();

      const root = data && typeof data === "object" ? data : null;
      const hasLikelyKeys = root && (("findings" in root) || ("detections" in root) || ("predictions" in root) || ("results" in root));
      if (hasLikelyKeys || Array.isArray(data)) {
        const findings = normalizeFindings(data);
        if (findings.length) publishResults(findings);
      }
    }catch(e){
      // ignore
    }

    return res;
  };
}

/* -------------------------
   DICOM HUD
   ------------------------- */
function dicomValueToString(v){
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.map(dicomValueToString).filter(Boolean).join("\\");
  if (typeof v === "object") {
    // try PersonName style: { Alphabetic: "..." }
    if (v.Alphabetic) return String(v.Alphabetic);
    // some loaders return { Value: [...] }
    if (Array.isArray(v.Value)) return v.Value.map(dicomValueToString).filter(Boolean).join("\\");
    return JSON.stringify(v);
  }
  return String(v);
}

function formatDicomDate(s){
  const t = String(s || "").trim();
  if (!t) return "";
  // YYYYMMDD -> YYYY-MM-DD
  if (/^\d{8}$/.test(t)) return t.slice(0,4) + "-" + t.slice(4,6) + "-" + t.slice(6,8);
  return t;
}

function getTag(imageId, tag){
  const cs = window.cornerstone || window.cornerstonejs || window.cornerstone3d || null;
  const mdGet = cs && cs.metaData && typeof cs.metaData.get === "function" ? cs.metaData.get.bind(cs.metaData) : null;
  if (!mdGet || !imageId) return "";
  try{ return dicomValueToString(mdGet(tag, imageId)); }catch(e){ return ""; }
}

function buildHud(hostEl){
  if (document.getElementById("dicomHud")) return;

  const hud = document.createElement("div");
  hud.id = "dicomHud";
  hud.className = "dicomHud";

  const header = document.createElement("div");
  header.className = "dicomHudHeader";

  const title = document.createElement("div");
  title.className = "dicomHudTitle";
  title.textContent = "DICOM HUD";

  const toggle = document.createElement("button");
  toggle.className = "dicomHudToggle";
  toggle.type = "button";
  toggle.textContent = "Hide";
  toggle.addEventListener("click", () => {
    hud.classList.toggle("is-collapsed");
    const collapsed = hud.classList.contains("is-collapsed");
    toggle.textContent = collapsed ? "Show" : "Hide";
  });

  header.appendChild(title);
  header.appendChild(toggle);

  const body = document.createElement("div");
  body.className = "dicomHudBody";

  const grid = document.createElement("div");
  grid.className = "dicomHudGrid";
  grid.id = "dicomHudGrid";

  const findingsWrap = document.createElement("div");
  findingsWrap.className = "dicomHudFindings";

  const fTitle = document.createElement("div");
  fTitle.className = "dicomHudFindingsTitle";
  fTitle.textContent = "Findings (click to jump)";

  const fList = document.createElement("div");
  fList.id = "dicomHudFindingsList";

  findingsWrap.appendChild(fTitle);
  findingsWrap.appendChild(fList);

  body.appendChild(grid);
  body.appendChild(findingsWrap);

  hud.appendChild(header);
  hud.appendChild(body);

  hostEl.appendChild(hud);
}

function setHudFields(fields){
  const grid = document.getElementById("dicomHudGrid");
  if (!grid) return;
  grid.innerHTML = "";

  fields.forEach(f => {
    const wrap = document.createElement("div");
    wrap.className = "dicomHudField";

    const k = document.createElement("div");
    k.className = "dicomHudKey";
    k.textContent = f.key;

    const v = document.createElement("div");
    v.className = "dicomHudVal";
    v.textContent = f.val || "--";

    wrap.appendChild(k);
    wrap.appendChild(v);
    grid.appendChild(wrap);
  });
}

function updateHud(){
  const vp = getViewport();
  const host = getOverlayHost(vp);
  if (!vp || !host) return;

  buildHud(host);

  const imageId = getCurrentImageId(vp);
  if (!imageId) return;

  // Key tags (best-effort):
  // PatientName (0010,0010) -> x00100010
  // PatientID   (0010,0020) -> x00100020
  // StudyDate   (0008,0020) -> x00080020
  // StudyDesc   (0008,1030) -> x00081030
  // SeriesDesc  (0008,103E) -> x0008103e
  // Modality    (0008,0060) -> x00080060
  // SeriesNo    (0020,0011) -> x00200011
  // InstanceNo  (0020,0013) -> x00200013
  // SliceThick  (0018,0050) -> x00180050
  // PixelSpace  (0028,0030) -> x00280030
  const patientName = getTag(imageId, "x00100010");
  const patientId   = getTag(imageId, "x00100020");
  const studyDate   = formatDicomDate(getTag(imageId, "x00080020"));
  const studyDesc   = getTag(imageId, "x00081030");
  const seriesDesc  = getTag(imageId, "x0008103e");
  const modality    = getTag(imageId, "x00080060");
  const seriesNo    = getTag(imageId, "x00200011");
  const instNo      = getTag(imageId, "x00200013");
  const thick       = getTag(imageId, "x00180050");
  const pxSpacing   = getTag(imageId, "x00280030");

  setHudFields([
    { key: "Patient", val: patientName },
    { key: "Patient ID", val: patientId },
    { key: "Study Date", val: studyDate },
    { key: "Study", val: studyDesc },
    { key: "Series", val: seriesDesc },
    { key: "Modality", val: modalityClass(modality) },
    { key: "Series No", val: seriesNo },
    { key: "Instance No", val: instNo },
    { key: "Slice Thick", val: thick },
    { key: "Pixel Spacing", val: pxSpacing }
  ]);

  // findings list for current slice
  updateHudFindingsList();
}

function updateHudFindingsList(){
  const listEl = document.getElementById("dicomHudFindingsList");
  if (!listEl) return;

  const vp = getViewport();
  if (!vp) { listEl.innerHTML = ""; return; }

  const cur = getCurrentIndex(vp);
  const findings = safeArray(window.__AI_FINDINGS__);

  // prefer exact slice match if sliceIndex exists
  const sliceFindings = findings.filter(f => {
    if (f && f.sliceIndex !== null && f.sliceIndex !== undefined && f.sliceIndex !== "") {
      return Number(f.sliceIndex) === Number(cur);
    }
    return true; // show always if sliceIndex missing
  });

  if (!sliceFindings.length) {
    listEl.innerHTML = '<div class="dicomHudKey">No findings on this slice.</div>';
    return;
  }

  listEl.innerHTML = "";
  sliceFindings.slice(0, 25).forEach(f => {
    const row = document.createElement("div");
    row.className = "dicomHudFinding";

    const left = document.createElement("div");
    left.style.minWidth = "0";
    left.style.flex = "1 1 auto";
    left.textContent = f.label || "Finding";

    const meta = document.createElement("div");
    meta.className = "dicomHudFindingMeta";
    const score = (typeof f.score === "number") ? (" " + Math.round(f.score * 100) + "%") : "";
    const s = (f.sliceIndex !== null && f.sliceIndex !== undefined && f.sliceIndex !== "") ? ("S" + (Number(f.sliceIndex) + 1)) : ("S" + (cur + 1));
    meta.textContent = s + score;

    row.appendChild(left);
    row.appendChild(meta);

    row.addEventListener("click", async () => {
      const vp2 = getViewport();
      if (!vp2) return;
      const idx = (f.sliceIndex !== null && f.sliceIndex !== undefined && f.sliceIndex !== "") ? Number(f.sliceIndex) : cur;
      await setIndex(vp2, idx);
    });

    listEl.appendChild(row);
  });
}

/* -------------------------
   AI Overlay drawing
   ------------------------- */
function parseBBox(bbox){
  // Returns {x,y,w,h} or null
  if (!bbox) return null;

  // array forms
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const a = bbox.map(Number);
    if (a.some(n => !Number.isFinite(n))) return null;

    // Heuristic: if looks like x1,y1,x2,y2 (x2 > x1 and y2 > y1), convert
    const x1 = a[0], y1 = a[1], x2 = a[2], y2 = a[3];
    if (x2 > x1 && y2 > y1 && (a.length === 4)) {
      return { x: x1, y: y1, w: (x2 - x1), h: (y2 - y1) };
    }
    // else treat as x,y,w,h
    return { x: a[0], y: a[1], w: a[2], h: a[3] };
  }

  // object forms
  if (typeof bbox === "object") {
    const x = Number(bbox.x ?? bbox.left ?? bbox.x1);
    const y = Number(bbox.y ?? bbox.top ?? bbox.y1);
    const w = Number(bbox.w ?? bbox.width);
    const h = Number(bbox.h ?? bbox.height);

    const x2 = Number(bbox.x2);
    const y2 = Number(bbox.y2);

    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)) return { x, y, w, h };
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(x2) && Number.isFinite(y2) && x2 > x && y2 > y) {
      return { x, y, w: (x2 - x), h: (y2 - y) };
    }
  }

  return null;
}

function normalizeRect(rect, dims){
  // If values are <= 1, treat as normalized already
  const maxV = Math.max(rect.x, rect.y, rect.w, rect.h);
  if (maxV <= 1.0) return rect;

  const cols = Math.max(1, Number(dims.cols) || 1);
  const rows = Math.max(1, Number(dims.rows) || 1);

  return {
    x: rect.x / cols,
    y: rect.y / rows,
    w: rect.w / cols,
    h: rect.h / rows
  };
}

function ensureOverlayCanvas(hostEl){
  let c = document.getElementById("aiOverlayCanvas");
  if (c) return c;

  c = document.createElement("canvas");
  c.id = "aiOverlayCanvas";
  c.className = "aiOverlayCanvas";
  hostEl.appendChild(c);
  return c;
}

function getOverlayHost(vp){
  const el = getViewportElement(vp);
  if (!el) return null;

  // If element is a canvas, mount overlay on parent
  const tag = String(el.tagName || "").toLowerCase();
  const host = (tag === "canvas" && el.parentElement) ? el.parentElement : el;

  // Ensure the overlay host is position:relative
  const style = window.getComputedStyle(host);
  if (style.position === "static") host.style.position = "relative";

  return host;
}

function drawOverlay(){
  const vp = getViewport();
  if (!vp) return;

  const host = getOverlayHost(vp);
  if (!host) return;

  const canvas = ensureOverlayCanvas(host);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = Math.max(1, host.clientWidth);
  const h = Math.max(1, host.clientHeight);
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  } else {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, w, h);

  const cur = getCurrentIndex(vp);
  const dims = getImageDims(vp);
  const findings = safeArray(window.__AI_FINDINGS__);

  const onSlice = findings.filter(f => {
    if (!f) return false;
    if (f.sliceIndex === null || f.sliceIndex === undefined || f.sliceIndex === "") return true;
    return Number(f.sliceIndex) === Number(cur);
  });

  if (!onSlice.length) return;

  // Simple visual style
  ctx.lineWidth = 2;
  ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
  ctx.textBaseline = "top";

  onSlice.forEach((f) => {
    const r0 = parseBBox(f.bbox);
    if (!r0) return;

    const r = normalizeRect(r0, dims);
    const x = Math.max(0, Math.min(1, r.x)) * w;
    const y = Math.max(0, Math.min(1, r.y)) * h;
    const rw = Math.max(0, Math.min(1, r.w)) * w;
    const rh = Math.max(0, Math.min(1, r.h)) * h;

    // draw
    ctx.strokeStyle = "rgba(34,197,94,0.95)";
    ctx.fillStyle = "rgba(34,197,94,0.18)";
    ctx.strokeRect(x, y, rw, rh);
    ctx.fillRect(x, y, rw, rh);

    const label = (f.label || "Finding") + ((typeof f.score === "number") ? (" " + Math.round(f.score * 100) + "%") : "");
    const pad = 4;
    const tw = ctx.measureText(label).width;
    const th = 16;

    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x, Math.max(0, y - th), tw + pad * 2, th);

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(label, x + pad, Math.max(0, y - th) + 2);
  });
}

/* -------------------------
   Series selector
   ------------------------- */
function groupSeriesFromAllIds(allIds){
  const ids = safeArray(allIds);
  const cs = window.cornerstone || window.cornerstonejs || window.cornerstone3d || null;
  const mdGet = cs && cs.metaData && typeof cs.metaData.get === "function" ? cs.metaData.get.bind(cs.metaData) : null;

  if (!mdGet || !ids.length) return [];

  const map = new Map(); // uid -> { uid, label, imageIds }
  ids.forEach((imageId) => {
    try{
      const uid = dicomValueToString(mdGet("x0020000e", imageId)); // Series Instance UID
      const desc = dicomValueToString(mdGet("x0008103e", imageId)); // Series Description
      const num  = dicomValueToString(mdGet("x00200011", imageId)); // Series Number
      const key = uid || ("series-" + desc + "-" + num);

      if (!map.has(key)) {
        const label = (desc ? desc : "Series") + (num ? (" #" + num) : "");
        map.set(key, { id: key, label, imageIds: [] });
      }
      map.get(key).imageIds.push(imageId);
    }catch(e){}
  });

  const out = Array.from(map.values()).filter(s => s.imageIds && s.imageIds.length);
  out.sort((a,b) => String(a.label).localeCompare(String(b.label)));
  return out;
}

async function applySeriesToViewport(series){
  const vp = getViewport();
  if (!vp || !series || !series.imageIds || !series.imageIds.length) return;

  const ids = series.imageIds;

  try{
    if (typeof vp.setStack === "function") {
      // StackViewport style
      await vp.setStack(ids, 0);
    } else if (typeof vp.setImageIds === "function") {
      await vp.setImageIds(ids);
    } else if (typeof vp.setImages === "function") {
      await vp.setImages(ids);
    } else {
      console.warn("[Series] No supported method found on viewport to set new imageIds.");
      return;
    }

    window.__STACK_IMAGE_IDS__ = ids;

    if (typeof vp.render === "function") vp.render();
  }catch(e){
    console.warn("[Series] failed to apply series:", e);
  }
}

/* -------------------------
   Insert toolbar controls
   ------------------------- */
function findAIAnalyzeButton(){
  const buttons = $all("button");
  return buttons.find(b => toLower(b.textContent).replace(/\s+/g, " ").includes("ai analyze")) || null;
}

function insertToolbarControls(){
  if (document.getElementById("toolbarControlsGroup")) return;

  const analyzeBtn = findAIAnalyzeButton();
  const host = analyzeBtn ? (analyzeBtn.parentElement || document.body) : document.body;

  const group = document.createElement("span");
  group.id = "toolbarControlsGroup";
  group.className = "toolbarControlsGroup";

  // Results button
  const resultsBtn = document.createElement("button");
  resultsBtn.id = "aiResultsDockBtn";
  resultsBtn.className = "btn small aiResultsDockBtn";
  resultsBtn.type = "button";
  resultsBtn.title = "AI Results";
  resultsBtn.innerHTML = 'Results <span id="aiResultsDockCount" class="aiResultsDockCount">0</span>';
  resultsBtn.addEventListener("click", () => toggleResultsPanel());

  // Reset View button
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn small";
  resetBtn.type = "button";
  resetBtn.title = "Reset view (zoom, pan, window level)";
  resetBtn.textContent = "Reset View";
  resetBtn.addEventListener("click", () => resetView());

  // Transform buttons
  const invertBtn = document.createElement("button");
  invertBtn.className = "btn small";
  invertBtn.type = "button";
  invertBtn.title = "Invert";
  invertBtn.textContent = "Invert";
  invertBtn.addEventListener("click", () => toggleInvert(invertBtn));

  const rotBtn = document.createElement("button");
  rotBtn.className = "btn small";
  rotBtn.type = "button";
  rotBtn.title = "Rotate 90 degrees";
  rotBtn.textContent = "Rotate";
  rotBtn.addEventListener("click", () => rotate90());

  const flipHBtn = document.createElement("button");
  flipHBtn.className = "btn small";
  flipHBtn.type = "button";
  flipHBtn.title = "Flip horizontal";
  flipHBtn.textContent = "Flip H";
  flipHBtn.addEventListener("click", () => flipH(flipHBtn));

  const flipVBtn = document.createElement("button");
  flipVBtn.className = "btn small";
  flipVBtn.type = "button";
  flipVBtn.title = "Flip vertical";
  flipVBtn.textContent = "Flip V";
  flipVBtn.addEventListener("click", () => flipV(flipVBtn));

  // Series selector
  const seriesSelect = document.createElement("select");
  seriesSelect.id = "seriesSelect";
  seriesSelect.className = "seriesSelect";
  seriesSelect.title = "Select series";

  // Modality badge
  const modalityBadge = document.createElement("span");
  modalityBadge.id = "modalityBadge";
  modalityBadge.className = "modalityBadge";
  modalityBadge.textContent = "OTHER";

  // W/L wrap: dropdown + sliders
  const wlWrap = document.createElement("span");
  wlWrap.className = "wlWrap";

  const wlSelect = document.createElement("select");
  wlSelect.className = "wlSelect";
  wlSelect.title = "Window/Level preset";

  const wlSliders = document.createElement("span");
  wlSliders.className = "wlSliders";

  const wlSliderWrap = document.createElement("span");
  wlSliderWrap.className = "wlSliderWrap";
  wlSliderWrap.innerHTML = '<span class="wlMini">WL</span>';

  const wlSlider = document.createElement("input");
  wlSlider.className = "wlSlider";
  wlSlider.type = "range";

  const wlVal = document.createElement("span");
  wlVal.className = "wlMini";
  wlVal.textContent = "0";

  wlSliderWrap.appendChild(wlSlider);
  wlSliderWrap.appendChild(wlVal);

  const wwSliderWrap = document.createElement("span");
  wwSliderWrap.className = "wlSliderWrap";
  wwSliderWrap.innerHTML = '<span class="wlMini">WW</span>';

  const wwSlider = document.createElement("input");
  wwSlider.className = "wlSlider";
  wwSlider.type = "range";

  const wwVal = document.createElement("span");
  wwVal.className = "wlMini";
  wwVal.textContent = "0";

  wwSliderWrap.appendChild(wwSlider);
  wwSliderWrap.appendChild(wwVal);

  wlSliders.appendChild(wlSliderWrap);
  wlSliders.appendChild(wwSliderWrap);

  wlWrap.appendChild(wlSelect);
  wlWrap.appendChild(wlSliders);

  // Slice counter
  const counterEl = document.createElement("span");
  counterEl.id = "sliceCounter";
  counterEl.className = "sliceCounter";
  counterEl.textContent = "-- / --";
  window.__SLICE_COUNTER_EL__ = counterEl;

  group.appendChild(resultsBtn);
  group.appendChild(resetBtn);
  group.appendChild(invertBtn);
  group.appendChild(rotBtn);
  group.appendChild(flipHBtn);
  group.appendChild(flipVBtn);
  group.appendChild(seriesSelect);
  group.appendChild(modalityBadge);
  group.appendChild(wlWrap);
  group.appendChild(counterEl);

  // Cine controls
  installCineControls(group);

  if (analyzeBtn && analyzeBtn.parentElement) analyzeBtn.insertAdjacentElement("afterend", group);
  else host.appendChild(group);

  installBadgeWiring();
  installSliceCounterWiring(counterEl);

  // W/L logic
  let dragging = false;

  function setSelectOptions(mod){
    const options = [];
    options.push({ key: "default", label: "W/L: Default" });
    if (mod === "CT") {
      options.push({ key: "brain",   label: "CT Brain (70/35)" });
      options.push({ key: "soft",    label: "Soft Tissue (350/50)" });
      options.push({ key: "lung",    label: "Lung (1500/-600)" });
      options.push({ key: "bone",    label: "Bone (2500/500)" });
      options.push({ key: "abdomen", label: "Abdomen (400/50)" });
      options.push({ key: "liver",   label: "Liver (150/30)" });
      options.push({ key: "custom",  label: "Custom (sliders)" });
    } else if (mod === "MR") {
      options.push({ key: "mr_low",  label: "MR Low contrast" });
      options.push({ key: "mr_high", label: "MR High contrast" });
      options.push({ key: "custom",  label: "Custom (sliders)" });
    } else {
      options.push({ key: "custom",  label: "Custom (sliders)" });
    }
    wlSelect.innerHTML = options.map(o => '<option value="' + o.key + '">' + o.label + '</option>').join("");
  }

  function setSliderDisplays(){
    wlVal.textContent = String(Math.round(Number(wlSlider.value) || 0));
    wwVal.textContent = String(Math.round(Number(wwSlider.value) || 0));
  }

  function loadSaved(mod){
    const preset = store.get(storageKey(mod, "preset"), "default");
    const wl = Number(store.get(storageKey(mod, "wl"), "0"));
    const ww = Number(store.get(storageKey(mod, "ww"), "800"));
    return { preset, wl, ww };
  }

  function saveManual(mod){
    store.set(storageKey(mod, "wl"), wlSlider.value);
    store.set(storageKey(mod, "ww"), wwSlider.value);
    store.set(storageKey(mod, "preset"), "custom");
  }

  function applyMRContrast(kind){
    const vp = getViewport();
    const current = voiToWL(getCurrentVOI(vp));
    if (!current) return;

    const factor = (kind === "mr_high") ? 0.7 : 1.4;
    const ww = Math.max(1, current.ww * factor);
    const wl = current.wl;

    wwSlider.value = String(Math.round(ww));
    wlSlider.value = String(Math.round(wl));
    setSliderDisplays();

    applyVOIRangeFromWL(wwSlider.value, wlSlider.value);
  }

  function applyPreset(mod, key){
    if (key === "default") {
      resetView();
      store.set(storageKey(mod, "preset"), "default");
      setTimeout(() => syncFromViewport(mod), 250);
      return;
    }

    if (mod === "CT") {
      if (key === "custom") {
        const saved = loadSaved(mod);
        if (Number.isFinite(saved.ww) && saved.ww > 0) wwSlider.value = String(Math.round(saved.ww));
        if (Number.isFinite(saved.wl)) wlSlider.value = String(Math.round(saved.wl));
        setSliderDisplays();
        applyVOIRangeFromWL(wwSlider.value, wlSlider.value);
        store.set(storageKey(mod, "preset"), "custom");
        return;
      }

      const wl = ctPresetToWL(key);
      if (!wl) return;

      wwSlider.value = String(wl.ww);
      wlSlider.value = String(wl.wl);
      setSliderDisplays();
      applyVOIRangeFromWL(wl.ww, wl.wl);
      store.set(storageKey(mod, "preset"), key);
      return;
    }

    if (mod === "MR") {
      if (key === "custom") {
        const saved = loadSaved(mod);
        if (Number.isFinite(saved.ww) && saved.ww > 0) wwSlider.value = String(Math.round(saved.ww));
        if (Number.isFinite(saved.wl)) wlSlider.value = String(Math.round(saved.wl));
        setSliderDisplays();
        applyVOIRangeFromWL(wwSlider.value, wlSlider.value);
        store.set(storageKey(mod, "preset"), "custom");
        return;
      }

      if (key === "mr_low" || key === "mr_high") {
        applyMRContrast(key);
        store.set(storageKey(mod, "preset"), key);
      }
      return;
    }

    // OTHER
    if (key === "custom") {
      const saved = loadSaved(mod);
      if (Number.isFinite(saved.ww) && saved.ww > 0) wwSlider.value = String(Math.round(saved.ww));
      if (Number.isFinite(saved.wl)) wlSlider.value = String(Math.round(saved.wl));
      setSliderDisplays();
      applyVOIRangeFromWL(wwSlider.value, wlSlider.value);
      store.set(storageKey(mod, "preset"), "custom");
    }
  }

  function syncFromViewport(mod){
    const vp = getViewport();
    const wl = voiToWL(getCurrentVOI(vp));
    if (!wl) return;
    if (dragging) return;

    const curWL = Number(wlSlider.value);
    const curWW = Number(wwSlider.value);

    const nextWL = Math.round(wl.wl);
    const nextWW = Math.round(wl.ww);

    setSliderRanges(mod, wlSlider, wwSlider);

    if (Math.abs(curWL - nextWL) > 2) wlSlider.value = String(nextWL);
    if (Math.abs(curWW - nextWW) > 2) wwSlider.value = String(nextWW);
    setSliderDisplays();
  }

  function initWL(){
    const mod = detectModality();
    window.__WL_MODALITY__ = mod;
    modalityBadge.textContent = mod;

    setSelectOptions(mod);
    setSliderRanges(mod, wlSlider, wwSlider);

    const saved = loadSaved(mod);

    const vp = getViewport();
    const current = voiToWL(getCurrentVOI(vp));
    const seedWL = current ? Math.round(current.wl) : (Number.isFinite(saved.wl) ? Math.round(saved.wl) : 0);
    const seedWW = current ? Math.round(current.ww) : (Number.isFinite(saved.ww) && saved.ww > 0 ? Math.round(saved.ww) : 800);

    wlSlider.value = String(seedWL);
    wwSlider.value = String(seedWW);
    setSliderDisplays();

    const preset = saved.preset || "default";
    wlSelect.value = preset;

    setTimeout(() => applyPreset(mod, wlSelect.value || "default"), 300);
  }

  wlSlider.addEventListener("pointerdown", () => { dragging = true; });
  wwSlider.addEventListener("pointerdown", () => { dragging = true; });
  window.addEventListener("pointerup", () => { dragging = false; });

  wlSlider.addEventListener("input", () => {
    setSliderDisplays();
    const mod = detectModality();
    if (wlSelect.value !== "custom") wlSelect.value = "custom";
    applyVOIRangeFromWL(wwSlider.value, wlSlider.value);
    saveManual(mod);
  });

  wwSlider.addEventListener("input", () => {
    setSliderDisplays();
    const mod = detectModality();
    if (wlSelect.value !== "custom") wlSelect.value = "custom";
    applyVOIRangeFromWL(wwSlider.value, wlSlider.value);
    saveManual(mod);
  });

  wlSelect.addEventListener("change", () => {
    const mod = detectModality();
    store.set(storageKey(mod, "preset"), wlSelect.value || "default");
    applyPreset(mod, wlSelect.value || "default");
  });

  // Series selector population + switching
  function populateSeries(){
    let catalog = safeArray(window.__SERIES_CATALOG__);
    if (!catalog.length) {
      const all = safeArray(window.__ALL_IMAGE_IDS__);
      if (all.length) catalog = groupSeriesFromAllIds(all);
    }
    // fallback: current series only
    const vp = getViewport();
    if (!catalog.length && vp && typeof vp.getImageIds === "function") {
      const ids = safeArray(vp.getImageIds());
      if (ids.length) catalog = [{ id: "current", label: "Current series", imageIds: ids }];
    }

    window.__SERIES_CATALOG_RESOLVED__ = catalog;

    seriesSelect.innerHTML = catalog.map(s => '<option value="' + s.id + '">' + (s.label || s.id) + '</option>').join("");
    if (!catalog.length) seriesSelect.innerHTML = '<option value="none">No series</option>';
  }

  seriesSelect.addEventListener("change", async () => {
    const catalog = safeArray(window.__SERIES_CATALOG_RESOLVED__);
    const id = String(seriesSelect.value || "");
    const s = catalog.find(x => String(x.id) === id);
    if (!s) return;
    await applySeriesToViewport(s);
    // refresh UI after series load
    setTimeout(() => {
      updateSliceCounter(counterEl);
      updateHud();
      drawOverlay();
    }, 250);
  });

  populateSeries();

  // Hotkeys
  document.addEventListener("keydown", (e) => {
    const k = String(e.key || "").toLowerCase();
    if (k === "i") toggleInvert(invertBtn);
    if (k === "r") rotate90();
    if (k === "h") flipH(flipHBtn);
    if (k === "v") flipV(flipVBtn);
  });

  // Keep UI synced, detect modality changes, and update HUD + overlay
  let lastMod = detectModality();
  let lastImageId = null;

  setInterval(() => {
    const vp = getViewport();
    const mod = detectModality();

    if (mod !== lastMod) {
      lastMod = mod;
      window.__WL_MODALITY__ = mod;
      modalityBadge.textContent = mod;

      setSelectOptions(mod);
      setSliderRanges(mod, wlSlider, wwSlider);

      const saved = loadSaved(mod);
      wlSelect.value = saved.preset || "default";
      applyPreset(mod, wlSelect.value || "default");
    } else {
      modalityBadge.textContent = mod;
    }

    syncFromViewport(mod);

    // update HUD and overlay when image changes
    const curId = vp ? getCurrentImageId(vp) : null;
    if (curId && curId !== lastImageId) {
      lastImageId = curId;
      updateHud();
      drawOverlay();
    } else {
      // still redraw overlay occasionally in case findings arrive
      drawOverlay();
    }
  }, 350);

  initWL();

  // When new results arrive, refresh HUD list and overlay
  window.addEventListener("ai:results", () => {
    updateHudFindingsList();
    drawOverlay();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  try{
    insertToolbarControls();
    installFetchInterceptor();
  }catch(e){
    console.warn("[Toolbar Controls] init failed:", e);
  }
});
