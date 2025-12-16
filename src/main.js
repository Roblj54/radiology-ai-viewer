import * as csCore from '@cornerstonejs/core';
import * as csTools from '@cornerstonejs/tools';
import dicomImageLoader from '@cornerstonejs/dicom-image-loader';
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

  // Recommended pattern: init loader with dicomParser, and configure decode behavior if needed
  dicomImageLoader.init({ dicomParser });
  dicomImageLoader.configure({
    decodeConfig: {
      // Matches common Cornerstone3D usage to avoid forcing float pixel data into ints
      convertFloatPixelDataToInt: false
    }
  });

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

  const toolGroupId = 'tg1';
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  toolGroup.addTool(StackScrollTool.toolName);
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(LengthTool.toolName);

  toolGroup.addViewport(viewportId, renderingEngineId);

  const MouseBindings = toolsEnums && toolsEnums.MouseBindings ? toolsEnums.MouseBindings : null;
  const KeyboardBindings = toolsEnums && toolsEnums.KeyboardBindings ? toolsEnums.KeyboardBindings : null;

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
      toolGroup.setToolPassive(LengthTool.toolName);
    }
  } else {
    // Safe fallback if enums are unavailable
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
