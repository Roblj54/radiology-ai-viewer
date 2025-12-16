import { RenderingEngine, Enums, init as csInit } from '@cornerstonejs/core';
import {
  init as csToolsInit,
  addTool,
  ToolGroupManager,
  PanTool,
  ZoomTool,
  WindowLevelTool,
  StackScrollMouseWheelTool,
  LengthTool
} from '@cornerstonejs/tools';

import * as dicomImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';

const element = document.getElementById('dicomViewport');
const statusEl = document.getElementById('status');
const fileInput = document.getElementById('dicomFiles');

function setStatus(msg) {
  statusEl.textContent = msg;
}

async function boot() {
  setStatus('Initializing Cornerstone...');
  await csInit();
  await csToolsInit();

  // Initialize DICOM image loader
  dicomImageLoader.init({ dicomParser });

  // Register tools
  addTool(PanTool);
  addTool(ZoomTool);
  addTool(WindowLevelTool);
  addTool(StackScrollMouseWheelTool);
  addTool(LengthTool);

  const renderingEngineId = 're1';
  const viewportId = 'vp1';

  const renderingEngine = new RenderingEngine(renderingEngineId);

  renderingEngine.enableElement({
    viewportId,
    type: Enums.ViewportType.STACK,
    element
  });

  const viewport = renderingEngine.getViewport(viewportId);

  const toolGroupId = 'tg1';
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  toolGroup.addTool(StackScrollMouseWheelTool.toolName);
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(LengthTool.toolName);

  toolGroup.addViewport(viewportId, renderingEngineId);

  // Mouse bindings
  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: Enums.MouseBindings.Primary }]
  });
  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }]
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: Enums.MouseBindings.Secondary }]
  });
  toolGroup.setToolActive(StackScrollMouseWheelTool.toolName);

  toolGroup.setToolActive(LengthTool.toolName, {
    bindings: [{ mouseButton: Enums.MouseBindings.Primary, modifierKey: Enums.KeyboardBindings.Shift }]
  });

  viewport.render();
  setStatus('Ready. Choose DICOM files (a series) to load.');
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || []);
  if (files.length === 0) return;

  setStatus('Indexing files...');
  // Convert local files to imageIds using the loader fileManager
  const imageIds = files
    .filter(f => f && f.size > 0)
    .map(f => dicomImageLoader.wadouri.fileManager.add(f));

  // Sort is optional. Many series will still work without it.
  // For best results, use metadata to sort by InstanceNumber later.

  const renderingEngineId = 're1';
  const viewportId = 'vp1';
  const renderingEngine = RenderingEngine.getRenderingEngine(renderingEngineId);
  const viewport = renderingEngine.getViewport(viewportId);

  setStatus('Loading stack...');
  await viewport.setStack(imageIds);
  viewport.render();
  setStatus(Loaded  slices. Mouse wheel to scroll. Left drag = window/level. Middle drag = pan. Right drag = zoom. Shift + left = length.);
}

fileInput.addEventListener('change', async (e) => {
  try {
    await loadFiles(e.target.files);
  } catch (err) {
    console.error(err);
    setStatus('Load failed. Try selecting only one series folder or only .dcm files from the same series.');
  }
});

// Drag and drop support
element.addEventListener('dragover', (e) => { e.preventDefault(); });
element.addEventListener('drop', async (e) => {
  e.preventDefault();
  try {
    await loadFiles(e.dataTransfer.files);
  } catch (err) {
    console.error(err);
    setStatus('Drop failed. Try selecting only one series.');
  }
});

boot().catch((e) => {
  console.error(e);
  setStatus('Initialization failed. Check console for details.');
});
