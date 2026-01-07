import * as cornerstone from "cornerstone-core";

type WheelDir = -1 | 1;

export function attachCornerstoneMouseControls(
  element: HTMLElement,
  opts?: {
    isSeriesLoaded?: () => boolean;
    onWheelSlice?: (dir: WheelDir) => void;
    wlSensitivity?: number;   // default 0.5
    zoomSensitivity?: number; // default 0.01
    panSensitivity?: number;  // default 1
  }
) {
  const wlK = opts?.wlSensitivity ?? 0.5;
  const zoomK = opts?.zoomSensitivity ?? 0.01;
  const panK = opts?.panSensitivity ?? 1;

  let dragging = false;
  let mode: "wl" | "zoom" | "pan" | null = null;
  let lastX = 0;
  let lastY = 0;
  let pointerId: number | null = null;

  // Prevent browser gestures on touchpads / touch
  try {
    (element as any).style.touchAction = "none";
  } catch (e) {}

  const getViewport = () => {
    try {
      return cornerstone.getViewport(element);
    } catch (e) {
      return undefined;
    }
  };

  const setViewport = (vp: any) => {
    try {
      cornerstone.setViewport(element, vp);
    } catch (e) {}
  };

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== null) return;

    // 0 left, 1 middle, 2 right
    if (e.button === 0) mode = "wl";
    else if (e.button === 1) mode = "pan";
    else if (e.button === 2) mode = "zoom";
    else return;

    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    pointerId = e.pointerId;

    e.preventDefault();
    try {
      (element as any).setPointerCapture(e.pointerId);
    } catch (err) {}
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || pointerId !== e.pointerId || !mode) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    const vp: any = getViewport();
    if (!vp) return;

    if (mode === "wl") {
      if (!vp.voi) vp.voi = { windowWidth: 1, windowCenter: 0 };
      const ww = Number(vp.voi.windowWidth ?? 1);
      const wc = Number(vp.voi.windowCenter ?? 0);

      // Horizontal drag adjusts window width, vertical drag adjusts window center
      vp.voi.windowWidth = Math.max(1, ww + dx * wlK);
      vp.voi.windowCenter = wc + dy * wlK;

      setViewport(vp);
      return;
    }

    if (mode === "zoom") {
      const scale = Number(vp.scale ?? 1);
      const factor = Math.exp(dx * zoomK);
      vp.scale = Math.max(0.05, Math.min(50, scale * factor));

      setViewport(vp);
      return;
    }

    if (mode === "pan") {
      if (!vp.translation) vp.translation = { x: 0, y: 0 };
      vp.translation.x = Number(vp.translation.x ?? 0) + dx * panK;
      vp.translation.y = Number(vp.translation.y ?? 0) + dy * panK;

      setViewport(vp);
      return;
    }
  };

  const endDrag = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return;
    dragging = false;
    mode = null;
    pointerId = null;

    e.preventDefault();
    try {
      (element as any).releasePointerCapture(e.pointerId);
    } catch (err) {}
  };

  const onWheel = (e: WheelEvent) => {
    if (!opts?.onWheelSlice) return;
    const ok = opts.isSeriesLoaded ? opts.isSeriesLoaded() : true;
    if (!ok) return;

    e.preventDefault();
    const dir: WheelDir = e.deltaY > 0 ? 1 : -1;
    opts.onWheelSlice(dir);
  };

  const onDblClick = (e: MouseEvent) => {
    e.preventDefault();
    try {
      cornerstone.reset(element);
    } catch (err) {}
  };

  element.addEventListener("contextmenu", onContextMenu);
  element.addEventListener("pointerdown", onPointerDown);
  element.addEventListener("pointermove", onPointerMove);
  element.addEventListener("pointerup", endDrag);
  element.addEventListener("pointercancel", endDrag);
  element.addEventListener("wheel", onWheel, { passive: false });
  element.addEventListener("dblclick", onDblClick);

  return () => {
    element.removeEventListener("contextmenu", onContextMenu);
    element.removeEventListener("pointerdown", onPointerDown);
    element.removeEventListener("pointermove", onPointerMove);
    element.removeEventListener("pointerup", endDrag);
    element.removeEventListener("pointercancel", endDrag);
    element.removeEventListener("wheel", onWheel as any);
    element.removeEventListener("dblclick", onDblClick);
  };
}
