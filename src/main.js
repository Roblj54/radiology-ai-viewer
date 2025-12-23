import { setupAIMockOverlay } from "./aiOverlayMock.js";
const element = document.getElementById('dicomViewport');
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('dicomFiles');

let renderingEngine;
let viewport;
let wadouri;

function setStatus(msg) { if (statusEl) statusEl.textContent = msg; }
function errToText(err) { return err?.stack || err?.message || String(err); }

setStatus('main.js running. Loading Cornerstone modules...');

async function boot() {
  try {
    const csCore = await import('@cornerstonejs/core');
    const csTools = await import('@cornerstonejs/tools');
    const dicomImageLoader = await import('@cornerstonejs/dicom-image-loader');

    setStatus('Initializing Cornerstone...');

    await csCore.init();
    await csTools.init();

    // Cornerstone migration guide: use init(); dicomParser is internal now
    dicomImageLoader.init({ maxWebWorkers: navigator.hardwareConcurrency || 1 });
    wadouri = dicomImageLoader.wadouri;

    if (!wadouri?.fileManager?.add) {
      throw new Error('wadouri.fileManager.add is missing. DICOM image loader did not initialize.');
    }

    const {
      addTool,
      ToolGroupManager,
      PanTool,
      ZoomTool,
      WindowLevelTool,
      StackScrollTool,
      LengthTool,
      Enums: toolsEnums
    } = csTools;

    addTool(PanTool);
    addTool(ZoomTool);
    addTool(WindowLevelTool);
    addTool(StackScrollTool);
    addTool(LengthTool);

    const renderingEngineId = 're1';
    const viewportId = 'vp1';

    renderingEngine = new csCore.RenderingEngine(renderingEngineId);
    renderingEngine.enableElement({
      viewportId,
      type: csCore.Enums.ViewportType.STACK,
      element
    });

    viewport = renderingEngine.getViewport(viewportId);
window.__rav_viewport = viewport;const toolGroupId = 'tg1';
    const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

    toolGroup.addTool(StackScrollTool.toolName);
    toolGroup.addTool(WindowLevelTool.toolName);
    toolGroup.addTool(PanTool.toolName);
    toolGroup.addTool(ZoomTool.toolName);
    toolGroup.addTool(LengthTool.toolName);
    toolGroup.addViewport(viewportId, renderingEngineId);

    const MouseBindings = toolsEnums?.MouseBindings ?? null;
    const KeyboardBindings = toolsEnums?.KeyboardBindings ?? null;

    if (MouseBindings) {
      toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
      toolGroup.setToolActive(PanTool.toolName,        { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
      toolGroup.setToolActive(ZoomTool.toolName,       { bindings: [{ mouseButton: MouseBindings.Secondary }] });
      toolGroup.setToolActive(StackScrollTool.toolName,{ bindings: [{ mouseButton: MouseBindings.Wheel }] });

      if (KeyboardBindings?.Shift != null) {
        toolGroup.setToolActive(LengthTool.toolName, {
          bindings: [{ mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift }]
        });
      } else {
        toolGroup.setToolPassive(LengthTool.toolName);
      }
    } else {
      toolGroup.setToolActive(StackScrollTool.toolName);
      toolGroup.setToolActive(WindowLevelTool.toolName);
      toolGroup.setToolPassive(PanTool.toolName);
      toolGroup.setToolPassive(ZoomTool.toolName);
      toolGroup.setToolPassive(LengthTool.toolName);
    }

    viewport.render();
    setStatus('Ready. Choose DICOM files (one series) to load.');
  } catch (e) {
    console.error(e);
    setStatus('Initialization failed:\\n' + errToText(e));
  }
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f && f.size > 0);
  if (files.length === 0) return;

  if (!viewport) {
    setStatus('Viewer not initialized yet. See error above.');
    return;
  }

  try {
    // helpful when filenames are like IM-0001-0001.dcm, IM-0001-0002.dcm, etc
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    setStatus('Indexing files...');
    const imageIds = files.map(f => wadouri.fileManager.add(f));

    setStatus('Loading stack...');
    await viewport.setStack(imageIds);
    viewport.render();

    setStatus('Loaded ' + imageIds.length + ' slices. Wheel scroll, left drag window/level, middle pan, right zoom.');
  } catch (e) {
    console.error(e);
    setStatus('Load failed:\\n' + errToText(e) + '\\nTry selecting only one series.');
  }
}

fileInput?.addEventListener('change', (e) => loadFiles(e.target.files));
element?.addEventListener('dragover', (e) => { e.preventDefault(); });
element?.addEventListener('drop', (e) => { e.preventDefault(); loadFiles(e.dataTransfer.files); });

boot();
;(() => {
  // __ravAIMock_v2
  function getContainer() {
    return (
      (typeof element !== "undefined" && element) ||
      document.getElementById("dicomViewport") ||
      document.getElementById("viewport") ||
      document.querySelector("[data-viewport]") ||
      (document.querySelector("canvas") ? document.querySelector("canvas").parentElement : null)
    );
  }

  function getViewportObj() {
    try {
      if (window.__rav_viewport) return window.__rav_viewport;
      if (typeof viewport !== "undefined" && viewport) return viewport;
    } catch {}
    return null;
  }

  function hasImages(vp) {
    try {
      if (vp && typeof vp.getImageIds === "function") return (vp.getImageIds() || []).length > 0;
    } catch {}
    return false;
  }

  function ensureBtn() {
    let btn = document.getElementById("btnAIMock");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btnAIMock";
      btn.type = "button";
      btn.textContent = "AI Overlay";
      btn.setAttribute("aria-label", "Toggle AI overlay");
      document.body.appendChild(btn);
    }

    // Force readable styling (in case global CSS overrides)
    btn.style.setProperty("position", "fixed", "important");
    btn.style.setProperty("top", "56px", "important");
    btn.style.setProperty("right", "12px", "important");
    btn.style.setProperty("z-index", "1000000", "important");
    btn.style.setProperty("padding", "8px 10px", "important");
    btn.style.setProperty("border-radius", "10px", "important");
    btn.style.setProperty("border", "1px solid rgba(255,255,255,0.35)", "important");
    btn.style.setProperty("background", "rgba(255,255,255,0.92)", "important");
    btn.style.setProperty("color", "#111", "important");
    btn.style.setProperty("font-weight", "700", "important");
    btn.style.setProperty("font-size", "13px", "important");
    btn.style.setProperty("line-height", "1", "important");
    btn.style.setProperty("cursor", "pointer", "important");
    btn.style.setProperty("backdrop-filter", "blur(6px)", "important");
    return btn;
  }

  function installWheelGuard() {
    const container = getContainer();
    if (!container || container.__ravWheelGuard) return;
    container.__ravWheelGuard = true;

    // Prevent StackScroll errors when no images are loaded yet
    container.addEventListener("wheel", (ev) => {
      const vp = getViewportObj();
      if (!hasImages(vp)) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    }, { capture: true, passive: false });
  }

  function installOverlay() {
    if (window.__aiMock) return window.__aiMock;

    const container = getContainer();
    if (!container) return null;

    const vp = getViewportObj(); // can be null, aiOverlayMock still works in pixel mode
    try {
      const ai = setupAIMockOverlay({ viewport: vp, container });
      window.__aiMock = ai;
      return ai;
    } catch (e) {
      console.warn("AI overlay install failed:", e);
      return null;
    }
  }

  function start() {
    const btn = ensureBtn();
    installWheelGuard();

    btn.addEventListener("click", () => {
      const ai = installOverlay();
      if (!ai) {
        alert("Load a DICOM series first, then click AI Overlay again.");
        return;
      }
      ai.toggle();
    });

    const mo = new MutationObserver(() => {
      installWheelGuard();
      const vp = getViewportObj();
      if (!window.__aiMock && hasImages(vp)) installOverlay();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

