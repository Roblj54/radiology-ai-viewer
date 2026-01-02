import * as cornerstone from 'cornerstone-core';
import dicomParser from 'dicom-parser';
import * as cornerstoneWADOImageLoader from 'cornerstone-wado-image-loader';

export type ViewerViewport = {
  invert?: boolean;
  hflip?: boolean;
  vflip?: boolean;
  rotation?: number;
  windowCenter?: number;
  windowWidth?: number;
};

let initialized = false;
let currentImageIds: string[] = [];

function raf(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForLayout(): Promise<void> {
  // Two frames helps React layout settle before Cornerstone draws.
  await raf();
  await raf();
}

function ensureInitialized() {
  if (initialized) return;

  // IMPORTANT: do NOT overwrite `.external` (can be getter-only).
  (cornerstoneWADOImageLoader as any).external.cornerstone = cornerstone;
  (cornerstoneWADOImageLoader as any).external.dicomParser = dicomParser;

  // Avoid web workers in dev (prevents CSP/eval related issues)
  if (typeof (cornerstoneWADOImageLoader as any).configure === 'function') {
    (cornerstoneWADOImageLoader as any).configure({ useWebWorkers: false });
  }

  initialized = true;
}

function isEnabled(el: HTMLElement): boolean {
  const cs: any = cornerstone as any;
  try {
    if (typeof cs.getEnabledElement === 'function') {
      cs.getEnabledElement(el);
      return true;
    }
  } catch {}
  return false;
}

function getViewportSafe(el: HTMLElement): any {
  const cs: any = cornerstone as any;
  try {
    if (typeof cs.getViewport === 'function') return cs.getViewport(el);
  } catch {}
  return {};
}

export async function loadDicomFiles(files: File[] | FileList): Promise<string[]> {
  ensureInitialized();

  const arr: File[] = Array.isArray(files) ? files.slice() : Array.from(files || []);
  if (!arr.length) return [];

  arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));

  const fm = (cornerstoneWADOImageLoader as any).wadouri?.fileManager;
  if (!fm || typeof fm.add !== 'function') {
    throw new Error('DICOM loader not ready: wadouri.fileManager.add not available');
  }

  currentImageIds = arr.map((f) => fm.add(f));
  return currentImageIds;
}

export async function displayImageWithViewport(
  element: HTMLElement,
  index: number,
  viewportState: ViewerViewport
): Promise<void> {
  ensureInitialized();

  if (!currentImageIds.length) throw new Error('No DICOM images loaded');

  if (!isEnabled(element)) {
    cornerstone.enable(element as any);
    await waitForLayout();
  }

  const safeIndex = Math.max(0, Math.min(index, currentImageIds.length - 1));
  const imageId = currentImageIds[safeIndex];

  const image = await cornerstone.loadImage(imageId);
  cornerstone.displayImage(element as any, image);

  const base = getViewportSafe(element);
  const viewport: any = {
    ...base,
    invert: !!viewportState.invert,
    hflip: !!viewportState.hflip,
    vflip: !!viewportState.vflip,
    rotation: viewportState.rotation ?? 0,
    voi: {
      windowCenter: viewportState.windowCenter ?? base?.voi?.windowCenter ?? 40,
      windowWidth: viewportState.windowWidth ?? base?.voi?.windowWidth ?? 400,
    },
  };

  cornerstone.setViewport(element as any, viewport);

  const cs: any = cornerstone as any;
  if (typeof cs.resize === 'function') cs.resize(element as any, true);
}

export function getLoadedCount(): number {
  return currentImageIds.length;
}
