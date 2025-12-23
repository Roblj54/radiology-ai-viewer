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
;(() => {
  try {
    if (window.__aiMock) return;

    let btn = document.getElementById("btnAIMock");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btnAIMock";
      btn.type = "button";
      btn.textContent = "AI Overlay (mock)";
      btn.style.cssText = "position:fixed; top:12px; right:12px; z-index:9999; padding:8px 10px; border-radius:10px; border:1px solid #999; background:#fff; cursor:pointer;";
      document.body.appendChild(btn);
    }

    const canvas = document.querySelector("canvas");
    const container =
      (typeof viewportElement !== "undefined" && viewportElement) ||
      (typeof element !== "undefined" && element) ||
      document.getElementById("viewport") ||
      document.querySelector("[data-viewport]") ||
      (canvas ? canvas.parentElement : null);

    if (!container) {
      console.warn("AI overlay: could not find viewport container");
      return;
    }

    window.__rav_viewport = element;
    const aiMock = setupAIMockOverlay({ viewport: element, container: container });
    btn.addEventListener("click", () => aiMock.toggle());
    window.__aiMock = aiMock;
  } catch (e) {
    console.warn("AI overlay init failed:", e);
  }
})();

    const toolGroupId = 'tg1';
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
  // __aiMockInstaller_v1
  function ensureBtn() {
    let btn = document.getElementById("btnAIMock");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "btnAIMock";
      btn.type = "button";
      btn.textContent = "AI Overlay (mock)";
      btn.style.cssText =
        "position:fixed; top:12px; right:12px; z-index:999999; padding:8px 10px; border-radius:10px; border:1px solid #999; background:#fff; cursor:pointer;";
      document.body.appendChild(btn);
    }
    return btn;
  }

  function findContainer() {
    const canvas =
      document.querySelector("#viewport canvas") ||
      document.querySelector("[data-viewport] canvas") ||
      document.querySelector("canvas");
    return (
      document.getElementById("viewport") ||
      document.querySelector("[data-viewport]") ||
      (canvas ? canvas.parentElement : null)
    );
  }

  function installIfReady() {
    if (window.__aiMock) return window.__aiMock;

    const container = findContainer();
    if (!container) return null;

    // If your app exposes a real Cornerstone viewport, use it. Otherwise overlay still works in pixel mode.
    const viewport =
      window.__rav_viewport ||
      window.__cornerstoneViewport ||
      null;

    try {
      const ai = setupAIMockOverlay({ viewport, container });
      window.__aiMock = ai;
      return ai;
    } catch (e) {
      console.warn("AI overlay install failed:", e);
      return null;
    }
  }

  function start() {
    const btn = ensureBtn();

    btn.addEventListener("click", () => {
      const ai = installIfReady();
      if (!ai) {
        alert("Viewport not ready yet. Load a DICOM series first, then click again.");
        return;
      }
      ai.toggle();
    });

    // Auto-install once a canvas appears
    const mo = new MutationObserver(() => {
      if (!window.__aiMock) {
        const c = findContainer();
        if (c && c.querySelector("canvas")) installIfReady();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
