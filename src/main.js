import * as csCore from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import * as dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';

const element = document.getElementById('dicomViewport');
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('dicomFiles');

let renderingEngine;
let viewport;

function setStatus(msg) { statusEl.textContent = msg; }

function showFatal(err) {
  console.error(err);
  const msg = (err && err.message) ? err.message : String(err);
  setStatus('Initialization failed: ' + msg + ' (open DevTools Console for details)');
}

async function boot() {
  setStatus('Initializing Cornerstone...');

  await csCore.init();
  await csTools.init();

  // DICOM loader wiring (common pattern)
  dicomImageLoader.external.cornerstone = csCore;
  dicomImageLoader.external.dicomParser = dicomParser;
  dicomImageLoader.init();

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

  // Some builds expose these enums via csTools.Enums
  const MouseBindings = (toolsEnums && toolsEnums.MouseBindings) ? toolsEnums.MouseBindings : null;
  const KeyboardBindings = (toolsEnums && toolsEnums.KeyboardBindings) ? toolsEnums.KeyboardBindings : null;

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

  const toolGroupId = 'tg1';
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  toolGroup.addTool(StackScrollTool.toolName);
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(LengthTool.toolName);

  toolGroup.addViewport(viewportId, renderingEngineId);

  // Bindings: if enums exist, use them; otherwise fall back to "tool defaults" safely
  if (MouseBindings) {
    toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: MouseBindings.Primary }] });
    toolGroup.setToolActive(PanTool.toolName,        { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
    toolGroup.setToolActive(ZoomTool.toolName,       { bindings: [{ mouseButton: MouseBindings.Secondary }] });
    toolGroup.setToolActive(StackScrollTool.toolName,{ bindings: [{ mouseButton: MouseBindings.Wheel }] });

    if (KeyboardBindings && KeyboardBindings.Shift != null) {
      toolGroup.setToolActive(LengthTool.toolName, {
        bindings: [{ mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift }]
      });
    } else {
      // If keyboard enum is unavailable, keep the tool added but not activated
      toolGroup.setToolPassive(LengthTool.toolName);
    }
  } else {
    // No enums: avoid crashing, keep viewer usable
    toolGroup.setToolActive(StackScrollTool.toolName);
    toolGroup.setToolActive(WindowLevelTool.toolName);
    toolGroup.setToolPassive(PanTool.toolName);
    toolGroup.setToolPassive(ZoomTool.toolName);
    toolGroup.setToolPassive(LengthTool.toolName);
  }

  viewport.render();
  setStatus('Ready. Choose DICOM files (one series) to load.');
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f && f.size > 0);
  if (files.length === 0) return;

  setStatus('Indexing files...');
  const imageIds = files.map(f => dicomImageLoader.wadouri.fileManager.add(f));

  setStatus('Loading stack...');
  await viewport.setStack(imageIds);
  viewport.render();

  setStatus('Loaded ' + imageIds.length + ' slices. Wheel scroll, left drag window/level, middle pan, right zoom.');
}

fileInput.addEventListener('change', async (e) => {
  try { await loadFiles(e.target.files); }
  catch (err) { console.error(err); setStatus('Load failed. Try selecting only one series.'); }
});

element.addEventListener('dragover', (e) => { e.preventDefault(); });
element.addEventListener('drop', async (e) => {
  e.preventDefault();
  try { await loadFiles(e.dataTransfer.files); }
  catch (err) { console.error(err); setStatus('Drop failed. Try selecting only one series.'); }
});

boot().catch(showFatal);
