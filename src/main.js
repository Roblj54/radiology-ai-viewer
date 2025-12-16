import { RenderingEngine, Enums as CoreEnums, init as csInit } from '@cornerstonejs/core';
import {
  init as csToolsInit,
  addTool,
  ToolGroupManager,
  PanTool,
  ZoomTool,
  WindowLevelTool,
  StackScrollTool,
  LengthTool
} from '@cornerstonejs/tools';

import MouseBindings from '@cornerstonejs/tools/enums/MouseBindings';
import KeyboardBindings from '@cornerstonejs/tools/enums/KeyboardBindings';

import * as dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';

const element = document.getElementById('dicomViewport');
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('dicomFiles');

let renderingEngine;
let viewport;

function setStatus(msg) { statusEl.textContent = msg; }

async function boot() {
  setStatus('Initializing Cornerstone...');
  await csInit();
  await csToolsInit();

  dicomImageLoader.init({ dicomParser });

  addTool(PanTool);
  addTool(ZoomTool);
  addTool(WindowLevelTool);
  addTool(StackScrollTool);
  addTool(LengthTool);

  const renderingEngineId = 're1';
  const viewportId = 'vp1';

  renderingEngine = new RenderingEngine(renderingEngineId);
  renderingEngine.enableElement({
    viewportId,
    type: CoreEnums.ViewportType.STACK,
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

  // Left drag: window level
  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Primary }]
  });

  // Middle drag: pan
  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Auxiliary }]
  });

  // Right drag: zoom
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Secondary }]
  });

  // Mouse wheel: stack scroll
  toolGroup.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Wheel }]
  });

  // Shift + left: length measurement
  toolGroup.setToolActive(LengthTool.toolName, {
    bindings: [{ mouseButton: MouseBindings.Primary, modifierKey: KeyboardBindings.Shift }]
  });

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

  setStatus(
    'Loaded ' + imageIds.length +
    ' slices. Wheel scroll, left drag window/level, middle pan, right zoom, Shift+left length.'
  );
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

boot().catch((e) => { console.error(e); setStatus('Initialization failed. Check console.'); });
