import * as cornerstone from "cornerstone-core";

type WheelDir = -1 | 1;

const WL_PRESETS = [
  { name: "Soft tissue", ww: 400, wc: 40 },
  { name: "Lung", ww: 1500, wc: -600 },
  { name: "Bone", ww: 2000, wc: 300 },
];

export function attachKeyboardShortcuts(
  element: HTMLElement,
  opts: {
    isSeriesLoaded: () => boolean;
    getIndex: () => number;
    getLength: () => number;
    setIndex: (fn: (i: number) => number) => void;
  }
) {
  // Make it focusable so it can receive key events
  if (!element.getAttribute("tabindex")) element.setAttribute("tabindex", "0");

  let wlPresetIdx = 0;

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const setInvert = (invert: boolean) => {
    try {
      const vp: any = cornerstone.getViewport(element);
      if (!vp) return;
      vp.invert = invert;
      cornerstone.setViewport(element, vp);
    } catch (e) {}
  };

  const toggleInvert = () => {
    try {
      const vp: any = cornerstone.getViewport(element);
      const cur = !!(vp && vp.invert);
      setInvert(!cur);
    } catch (e) {}
  };

  const applyWL = (ww: number, wc: number) => {
    try {
      const vp: any = cornerstone.getViewport(element);
      if (!vp) return;
      if (!vp.voi) vp.voi = { windowWidth: 1, windowCenter: 0 };
      vp.voi.windowWidth = Math.max(1, ww);
      vp.voi.windowCenter = wc;
      cornerstone.setViewport(element, vp);
    } catch (e) {}
  };

  const cycleWL = () => {
    wlPresetIdx = (wlPresetIdx + 1) % WL_PRESETS.length;
    const p = WL_PRESETS[wlPresetIdx];
    applyWL(p.ww, p.wc);
  };

  const stepSlice = (dir: WheelDir) => {
    if (!opts.isSeriesLoaded()) return;
    opts.setIndex((i) => {
      const len = opts.getLength();
      if (!len) return 0;
      return clamp(i + dir, 0, len - 1);
    });
  };

  const reset = () => {
    try {
      cornerstone.reset(element);
    } catch (e) {}
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Only act if the viewport has focus (or a child inside it)
    const active = document.activeElement;
    if (!(active === element || (active && element.contains(active)))) return;

    const k = e.key;

    if (k === "ArrowUp" || k === "ArrowLeft") {
      e.preventDefault();
      stepSlice(-1);
      return;
    }
    if (k === "ArrowDown" || k === "ArrowRight") {
      e.preventDefault();
      stepSlice(1);
      return;
    }
    if (k === "r" || k === "R") {
      e.preventDefault();
      reset();
      return;
    }
    if (k === "w" || k === "W") {
      e.preventDefault();
      cycleWL();
      return;
    }
    if (k === "l" || k === "L") {
      e.preventDefault();
      toggleInvert();
      return;
    }
  };

  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
}
