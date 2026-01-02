import * as cornerstone from "cornerstone-core";
import * as cornerstoneWADOImageLoader from "cornerstone-wado-image-loader";
import * as dicomParser from "dicom-parser";

// Wire external dependencies for the classic Cornerstone stack
cornerstoneWADOImageLoader.external.cornerstone = cornerstone;
cornerstoneWADOImageLoader.external.dicomParser = dicomParser;

// We use the fileManager from the WADO-URI loader so that imageIds
// look like "dicomfile:0", "dicomfile:1", etc.
const fileManager = cornerstoneWADOImageLoader.wadouri.fileManager;

export interface LoadedSlice {
  index: number;
  imageId: string;
}

/**
 * Convert a FileList or File[] into an array of LoadedSlice.
 * Each file is registered with the Cornerstone fileManager and
 * returns an imageId like "dicomfile:0".
 */
export function loadDicomFiles(files: FileList | File[]): LoadedSlice[] {
  const arr = Array.from(files as any as File[]);
  return arr.map((file, index) => {
    const imageId = fileManager.add(file);
    return { index, imageId };
  });
}

export interface SimpleViewportState {
  invert: boolean;
  hflip: boolean;
  vflip: boolean;
  windowWidth?: number;
  windowCenter?: number;
}

/**
 * Safely display an image with the requested viewport state.
 * Fixes the "Cannot set properties of undefined (setting 'invert')" error by
 * creating a default viewport when none exists for the element yet.
 */
export async function displayImageWithViewport(
  element: HTMLDivElement,
  imageId: string,
  state: SimpleViewportState
): Promise<void> {
  if (!element) {
    throw new Error("displayImageWithViewport: element is null");
  }

  // Make sure Cornerstone knows about this element
  try {
    cornerstone.getEnabledElement(element);
  } catch {
    cornerstone.enable(element);
  }

  // Load the DICOM image
  const image = await cornerstone.loadAndCacheImage(imageId);

  // Try to get current viewport, otherwise create a default one
  let viewport: any;
  try {
    viewport = cornerstone.getViewport(element);
  } catch {
    viewport = undefined;
  }

  if (!viewport) {
    viewport = cornerstone.getDefaultViewportForImage(element, image);
  }

  // Apply state flags
  viewport.invert = state.invert;
  viewport.hflip = state.hflip;
  viewport.vflip = state.vflip;

  if (state.windowWidth != null && state.windowCenter != null) {
    viewport.voi = {
      windowWidth: state.windowWidth,
      windowCenter: state.windowCenter,
    };
  }

  // Finally display the image
  cornerstone.displayImage(element, image, viewport);
}

// Optional helper in case you want to poke Cornerstone from the console
export function getCornerstone() {
  return cornerstone;
}
