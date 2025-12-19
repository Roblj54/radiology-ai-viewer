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
