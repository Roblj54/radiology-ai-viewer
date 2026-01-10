import React, { useEffect, useMemo, useRef, useState } from "react";

type RAIState = {
  sliceIndex: number; // 1-based
  total: number;
  wl: number;
  ww: number;
  zoom: number; // multiplier relative to fit-to-screen
  panX: number; // screen px
  panY: number; // screen px
  cinePlaying: boolean;
  cineFps: number;
  cineDir: number; // 1 or -1
  tool: "zoom" | "pan" | "wl" | "measure";
};

type RAIMessage =
  | { type: "RAI_READY"; payload?: any }
  | { type: "RAI_STATE"; payload?: Partial<RAIState> }
  | { type: "RAI_SLICE"; payload?: { index?: number } }
  | { type: "RAI_WLWW"; payload?: { wl?: number; ww?: number } }
  | { type: "RAI_ZOOM"; payload?: { zoom?: number } }
  | { type: "RAI_PAN"; payload?: { dx?: number; dy?: number } }
  | { type: "RAI_CINE"; payload?: { playing?: boolean; fps?: number; dir?: number } }
  | { type: "RAI_TOOL"; payload?: { tool?: string } }
  | { type: "RAI_OPEN_STUDY"; payload?: any };

type DicomFrame = {
  rows: number;
  cols: number;
  samplesPerPixel: number;
  bitsAllocated: number; // 8 or 16
  pixelRepresentation: 0 | 1; // 0 unsigned, 1 signed
  photometric: string; // MONOCHROME1 or MONOCHROME2
  slope: number;
  intercept: number;
  windowCenter?: number;
  windowWidth?: number;
  instanceNumber?: number;
  pixels: Uint8Array | Uint16Array | Int16Array;
};

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function firstNumberFromMultiValue(s: string): number | undefined {
  const t = (s || "").split("\\")[0].trim();
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
}

function readAscii(u8: Uint8Array, off: number, len: number) {
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(u8[off + i] || 0);
  return out;
}

function readStr(u8: Uint8Array, off: number, len: number) {
  const s = readAscii(u8, off, len);
  return s.replace(/\0/g, "").trim();
}

function tagKey(group: number, elem: number) {
  const g = group.toString(16).padStart(4, "0");
  const e = elem.toString(16).padStart(4, "0");
  return (g + e).toUpperCase();
}

const LONG_VR = new Set(["OB", "OW", "OF", "SQ", "UT", "UN"]);

function readElementExplicitLE(dv: DataView, u8: Uint8Array, off: number) {
  const group = dv.getUint16(off, true);
  const elem = dv.getUint16(off + 2, true);
  const vr = readAscii(u8, off + 4, 2);
  let length = 0;
  let valueOffset = 0;
  let nextOffset = 0;

  if (LONG_VR.has(vr)) {
    // 2 reserved bytes, then 4-byte length
    length = dv.getUint32(off + 8, true);
    valueOffset = off + 12;
    nextOffset = valueOffset + length;
  } else {
    length = dv.getUint16(off + 6, true);
    valueOffset = off + 8;
    nextOffset = valueOffset + length;
  }

  return { group, elem, vr, length, valueOffset, nextOffset };
}

function readElementImplicitLE(dv: DataView, off: number) {
  const group = dv.getUint16(off, true);
  const elem = dv.getUint16(off + 2, true);
  const length = dv.getUint32(off + 4, true);
  const valueOffset = off + 8;
  const nextOffset = valueOffset + length;
  return { group, elem, vr: "IM", length, valueOffset, nextOffset };
}

function parseDicomUncompressed(buffer: ArrayBuffer): DicomFrame {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  let offset = 0;
  let hasPreamble = false;
  if (u8.byteLength >= 132 && readAscii(u8, 128, 4) === "DICM") {
    hasPreamble = true;
    offset = 132;
  }

  // Meta header parsing (explicit VR little endian)
  let transferSyntax = "1.2.840.10008.1.2.1"; // default explicit LE
  let metaEnd = offset;

  if (hasPreamble) {
    // Expect (0002,0000) meta group length
    const el0 = readElementExplicitLE(dv, u8, offset);
    if (el0.group === 0x0002 && el0.elem === 0x0000 && el0.length === 4) {
      const metaLen = dv.getUint32(el0.valueOffset, true);
      metaEnd = el0.nextOffset + metaLen;

      offset = el0.nextOffset;
      while (offset + 8 <= metaEnd && offset + 8 <= u8.byteLength) {
        const el = readElementExplicitLE(dv, u8, offset);
        const k = tagKey(el.group, el.elem);

        if (k === "00020010") {
          transferSyntax = readStr(u8, el.valueOffset, el.length);
        }

        offset = el.nextOffset;
        // safety: avoid infinite loops
        if (el.nextOffset <= el.valueOffset) break;
      }
      offset = metaEnd;
    } else {
      offset = 132;
    }
  }

  // Transfer syntax support (uncompressed only)
  // Implicit VR Little Endian: 1.2.840.10008.1.2
  // Explicit VR Little Endian: 1.2.840.10008.1.2.1
  // Reject big endian and compressed/encapsulated for now.
  let explicitVR = true;
  if (transferSyntax === "1.2.840.10008.1.2") explicitVR = false;
  if (transferSyntax !== "1.2.840.10008.1.2" && transferSyntax !== "1.2.840.10008.1.2.1") {
    throw new Error(`Unsupported TransferSyntaxUID (compressed or non-LE): ${transferSyntax}`);
  }

  // Tags we need
  let rows = 0;
  let cols = 0;
  let samplesPerPixel = 1;
  let bitsAllocated = 0;
  let pixelRepresentation: 0 | 1 = 0;
  let photometric = "MONOCHROME2";
  let slope = 1;
  let intercept = 0;
  let windowCenter: number | undefined;
  let windowWidth: number | undefined;
  let instanceNumber: number | undefined;

  let pixelOffset = -1;
  let pixelLength = 0;

  // Dataset loop
  while (offset + 8 <= u8.byteLength) {
    const el = explicitVR ? readElementExplicitLE(dv, u8, offset) : readElementImplicitLE(dv, offset);
    const k = tagKey(el.group, el.elem);

    // undefined length usually means sequences or encapsulated pixel data (compressed)
    if (el.length === 0xffffffff) {
      throw new Error(`Undefined length element encountered (likely compressed or sequence): ${k}`);
    }

    if (k === "00280010") rows = dv.getUint16(el.valueOffset, true); // Rows (US)
    else if (k === "00280011") cols = dv.getUint16(el.valueOffset, true); // Columns (US)
    else if (k === "00280002") samplesPerPixel = dv.getUint16(el.valueOffset, true); // SamplesPerPixel (US)
    else if (k === "00280100") bitsAllocated = dv.getUint16(el.valueOffset, true); // BitsAllocated (US)
    else if (k === "00280103") pixelRepresentation = (dv.getUint16(el.valueOffset, true) ? 1 : 0); // PixelRepresentation (US)
    else if (k === "00280004") photometric = readStr(u8, el.valueOffset, el.length) || photometric; // PhotometricInterpretation (CS)
    else if (k === "00281052") intercept = firstNumberFromMultiValue(readStr(u8, el.valueOffset, el.length)) ?? intercept; // RescaleIntercept (DS)
    else if (k === "00281053") slope = firstNumberFromMultiValue(readStr(u8, el.valueOffset, el.length)) ?? slope; // RescaleSlope (DS)
    else if (k === "00281050") windowCenter = firstNumberFromMultiValue(readStr(u8, el.valueOffset, el.length)); // WindowCenter (DS)
    else if (k === "00281051") windowWidth = firstNumberFromMultiValue(readStr(u8, el.valueOffset, el.length)); // WindowWidth (DS)
    else if (k === "00200013") instanceNumber = firstNumberFromMultiValue(readStr(u8, el.valueOffset, el.length)); // InstanceNumber (IS)
    else if (k === "7FE00010") {
      pixelOffset = el.valueOffset;
      pixelLength = el.length;
      break;
    }

    offset = el.nextOffset;
    if (el.nextOffset <= el.valueOffset) break;
  }

  if (!rows || !cols) throw new Error("Missing Rows/Columns tags (0028,0010 and 0028,0011).");
  if (samplesPerPixel !== 1) throw new Error(`Only SamplesPerPixel=1 supported. Got ${samplesPerPixel}.`);
  if (bitsAllocated !== 8 && bitsAllocated !== 16) throw new Error(`Only BitsAllocated 8 or 16 supported. Got ${bitsAllocated}.`);
  if (pixelOffset < 0) throw new Error("Missing PixelData tag (7FE0,0010).");

  const nPixels = rows * cols * samplesPerPixel;
  const bytesPerPixel = bitsAllocated / 8;
  const needBytes = nPixels * bytesPerPixel;

  if (pixelLength < needBytes) {
    throw new Error(`PixelData too short. Need ${needBytes} bytes, got ${pixelLength} bytes.`);
  }

  // TypedArray views require aligned offsets.
  if (bitsAllocated === 8) {
    const px = new Uint8Array(buffer, pixelOffset, nPixels);
    return {
      rows, cols, samplesPerPixel, bitsAllocated,
      pixelRepresentation, photometric,
      slope, intercept, windowCenter, windowWidth, instanceNumber,
      pixels: px
    };
  }

  // 16-bit
  if (pixelOffset % 2 !== 0) {
    // fallback copy if misaligned (rare)
    const tmp = new Uint8Array(needBytes);
    tmp.set(new Uint8Array(buffer, pixelOffset, needBytes));
    const tmpBuf = tmp.buffer;
    const px16 = pixelRepresentation === 1 ? new Int16Array(tmpBuf) : new Uint16Array(tmpBuf);
    return {
      rows, cols, samplesPerPixel, bitsAllocated,
      pixelRepresentation, photometric,
      slope, intercept, windowCenter, windowWidth, instanceNumber,
      pixels: px16
    };
  } else {
    const px16 = pixelRepresentation === 1
      ? new Int16Array(buffer, pixelOffset, nPixels)
      : new Uint16Array(buffer, pixelOffset, nPixels);

    return {
      rows, cols, samplesPerPixel, bitsAllocated,
      pixelRepresentation, photometric,
      slope, intercept, windowCenter, windowWidth, instanceNumber,
      pixels: px16
    };
  }
}

function toGrayscaleByte(v: number, wl: number, ww: number) {
  // Simple linear window
  const w = Math.max(1, ww);
  const lo = wl - w / 2;
  const hi = wl + w / 2;
  const t = (v - lo) / (hi - lo);
  return Math.round(clamp(t, 0, 1) * 255);
}

export default function BilingualShell() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [ready, setReady] = useState(false);

  const [st, setSt] = useState<RAIState>({
    sliceIndex: 1,
    total: 1,
    wl: 40,
    ww: 400,
    zoom: 1,
    panX: 0,
    panY: 0,
    cinePlaying: false,
    cineFps: 10,
    cineDir: 1,
    tool: "zoom",
  });

  const [loadStatus, setLoadStatus] = useState<{ msg: string; isError?: boolean }>({ msg: "No study loaded." });

  const framesRef = useRef<DicomFrame[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Offscreen image buffer (where we put ImageData), then we draw it with transforms using drawImage()
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const imgDataRef = useRef<ImageData | null>(null);

  const rafRef = useRef<number | null>(null);
  const cineTimerRef = useRef<number | null>(null);

  const shellUrl = useMemo(() => {
    const base = (import.meta as any).env?.BASE_URL || "/";
    const url = new URL(`${base}ui_shell_bilingual.html`, window.location.origin);
    url.searchParams.set("embedded", "1");
    return url.toString();
  }, []);

  function postToIFrame(msg: RAIMessage) {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;
    w.postMessage(msg, "*");
  }

  function sendStateToShell(next: RAIState) {
    postToIFrame({ type: "RAI_STATE", payload: next });
  }

  function ensureCanvas() {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc) return;

    const dicom = doc.getElementById("dicom");
    if (!dicom) return;

    if (canvasRef.current && canvasRef.current.isConnected) return;

    const c = doc.createElement("canvas");
    c.id = "raiCanvas";
    c.style.position = "absolute";
    c.style.inset = "0";
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.zIndex = "2";
    c.style.pointerEvents = "none";

    const dicomEl = dicom as HTMLElement;
    dicomEl.style.position = "relative";
    dicomEl.appendChild(c);

    canvasRef.current = c;
  }

  function resizeCanvasToDisplaySize() {
    const c = canvasRef.current;
    if (!c) return false;
    const rect = c.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      return true;
    }
    return false;
  }

  function ensureOffscreen(w: number, h: number) {
    if (!offscreenRef.current) offscreenRef.current = document.createElement("canvas");
    const oc = offscreenRef.current!;
    if (oc.width !== w || oc.height !== h) {
      oc.width = w;
      oc.height = h;
      imgDataRef.current = null;
    }
    if (!imgDataRef.current) {
      const ctx = oc.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Offscreen 2D context not available.");
      imgDataRef.current = ctx.createImageData(w, h);
    }
  }

  function renderFrameToOffscreen(frame: DicomFrame, wl: number, ww: number) {
    ensureOffscreen(frame.cols, frame.rows);
    const oc = offscreenRef.current!;
    const ctx = oc.getContext("2d", { willReadFrequently: true })!;
    const imgData = imgDataRef.current!;
    const out = imgData.data;

    const px = frame.pixels;
    const slope = frame.slope || 1;
    const intercept = frame.intercept || 0;
    const invert = (frame.photometric || "").toUpperCase() === "MONOCHROME1";

    const n = frame.rows * frame.cols;

    for (let i = 0; i < n; i++) {
      const raw = (px as any)[i] as number;
      const v = raw * slope + intercept;
      let g = toGrayscaleByte(v, wl, ww);
      if (invert) g = 255 - g;
      const o = i * 4;
      out[o + 0] = g;
      out[o + 1] = g;
      out[o + 2] = g;
      out[o + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
  }

  function draw(next: RAIState) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    resizeCanvasToDisplaySize();

    const w = c.width;
    const h = c.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#07161c";
    ctx.fillRect(0, 0, w, h);

    const frames = framesRef.current;
    const idx0 = clamp(next.sliceIndex, 1, Math.max(1, next.total)) - 1;
    const frame = frames[idx0];

    if (!frame) {
      // status text
      ctx.save();
      ctx.fillStyle = "#cfe6ef";
      ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(loadStatus.msg, 18, 28);
      ctx.restore();
      return;
    }

    try {
      renderFrameToOffscreen(frame, next.wl, next.ww);
    } catch (e: any) {
      ctx.save();
      ctx.fillStyle = "#ffdddd";
      ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(String(e?.message || e), 18, 28);
      ctx.restore();
      return;
    }

    const oc = offscreenRef.current!;
    const imgW = frame.cols;
    const imgH = frame.rows;

    // Fit-to-screen scale, then multiply by zoom
    const baseScale = Math.min(w / imgW, h / imgH);
    const scale = clamp(baseScale * next.zoom, baseScale * 0.05, baseScale * 20);

    ctx.save();
    ctx.translate(w / 2 + next.panX * (window.devicePixelRatio || 1), h / 2 + next.panY * (window.devicePixelRatio || 1));
    ctx.scale(scale, scale);
    ctx.translate(-imgW / 2, -imgH / 2);
    (ctx as any).imageSmoothingEnabled = false;
    ctx.drawImage(oc, 0, 0);
    ctx.restore();
  }

  function scheduleDraw(next: RAIState) {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => draw(next));
  }

  function stopCine() {
    if (cineTimerRef.current != null) {
      window.clearInterval(cineTimerRef.current);
      cineTimerRef.current = null;
    }
  }

  function startCine(next: RAIState) {
    stopCine();
    const fps = clamp(next.cineFps, 1, 60);
    const ms = Math.round(1000 / fps);

    cineTimerRef.current = window.setInterval(() => {
      setSt((prev) => {
        if (!prev.cinePlaying) return prev;
        const dir = prev.cineDir >= 0 ? 1 : -1;
        const total = Math.max(1, prev.total);
        let n = prev.sliceIndex + dir;
        if (n > total) n = 1;
        if (n < 1) n = total;
        const updated = { ...prev, sliceIndex: n };
        if (ready) sendStateToShell(updated);
        scheduleDraw(updated);
        return updated;
      });
    }, ms);
  }

  async function loadDicomFiles(files: File[]) {
    setLoadStatus({ msg: `Loading ${files.length} file(s)...` });

    // Sort by filename first, then InstanceNumber if we can parse it
    const byName = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

    const frames: DicomFrame[] = [];
    const errors: string[] = [];

    for (const f of byName) {
      try {
        const buf = await f.arrayBuffer();
        const frame = parseDicomUncompressed(buf);
        frames.push(frame);
      } catch (e: any) {
        errors.push(`${f.name}: ${String(e?.message || e)}`);
      }
    }

    // If InstanceNumber exists on most slices, use it
    const withInst = frames.filter((x) => Number.isFinite(x.instanceNumber)).length;
    if (withInst >= Math.floor(frames.length * 0.6)) {
      frames.sort((a, b) => (a.instanceNumber || 0) - (b.instanceNumber || 0));
    }

    framesRef.current = frames;

    if (frames.length === 0) {
      setSt((prev) => {
        const next = { ...prev, total: 1, sliceIndex: 1, cinePlaying: false };
        stopCine();
        if (ready) sendStateToShell(next);
        scheduleDraw(next);
        return next;
      });
      setLoadStatus({ msg: errors.length ? errors[0] : "No readable DICOM files found.", isError: true });
      return;
    }

    // Init WL/WW from first frame if available
    const f0 = frames[0];
    const initWl = f0.windowCenter ?? st.wl;
    const initWw = f0.windowWidth ?? st.ww;

    setSt((prev) => {
      const next = {
        ...prev,
        total: frames.length,
        sliceIndex: 1,
        wl: Number.isFinite(initWl) ? initWl : prev.wl,
        ww: Number.isFinite(initWw) ? Math.max(1, initWw) : prev.ww,
        zoom: 1,
        panX: 0,
        panY: 0,
        cinePlaying: false,
      };
      stopCine();
      if (ready) sendStateToShell(next);
      scheduleDraw(next);
      return next;
    });

    if (errors.length) {
      setLoadStatus({ msg: `Loaded ${frames.length} slice(s). Skipped ${errors.length} file(s). First error: ${errors[0]}`, isError: true });
    } else {
      setLoadStatus({ msg: `Loaded ${frames.length} slice(s).` });
    }
  }

  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data as RAIMessage;
      if (!d || typeof d.type !== "string") return;

      if (d.type === "RAI_READY") {
        setReady(true);
        ensureCanvas();
        // push current state
        sendStateToShell(st);
        scheduleDraw(st);
        return;
      }

      if (d.type === "RAI_OPEN_STUDY") {
        fileRef.current?.click();
        return;
      }

      setSt((prev) => {
        let next = { ...prev };

        if (d.type === "RAI_SLICE") {
          const idx = d.payload?.index ?? prev.sliceIndex;
          next.sliceIndex = clamp(Math.round(idx), 1, Math.max(1, prev.total));
          next.cinePlaying = false;
          stopCine();
        } else if (d.type === "RAI_WLWW") {
          const wl2 = d.payload?.wl;
          const ww2 = d.payload?.ww;
          if (typeof wl2 === "number") next.wl = wl2;
          if (typeof ww2 === "number") next.ww = Math.max(1, ww2);
        } else if (d.type === "RAI_ZOOM") {
          const z = d.payload?.zoom;
          if (typeof z === "number") next.zoom = clamp(z, 0.05, 20);
        } else if (d.type === "RAI_PAN") {
          const dx = d.payload?.dx ?? 0;
          const dy = d.payload?.dy ?? 0;
          next.panX = prev.panX + dx;
          next.panY = prev.panY + dy;
        } else if (d.type === "RAI_CINE") {
          const playing = d.payload?.playing;
          const fps = d.payload?.fps;
          const dir = d.payload?.dir;
          if (typeof fps === "number") next.cineFps = clamp(fps, 1, 60);
          if (typeof dir === "number") next.cineDir = dir >= 0 ? 1 : -1;
          if (typeof playing === "boolean") next.cinePlaying = playing;

          if (next.cinePlaying) startCine(next);
          else stopCine();
        } else if (d.type === "RAI_TOOL") {
          const tool = (d.payload?.tool || "").toLowerCase();
          if (tool === "zoom" || tool === "pan" || tool === "wl" || tool === "measure") {
            next.tool = tool as any;
          }
        }

        if (ready) sendStateToShell(next);
        scheduleDraw(next);
        return next;
      });
    }

    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  function onIFrameLoad() {
    ensureCanvas();
    postToIFrame({ type: "RAI_STATE", payload: st });
    scheduleDraw(st);
  }

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;

    const files = Array.from(list);
    // allow re-selecting same files later
    e.target.value = "";

    await loadDicomFiles(files);
  }

  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, overflow: "hidden", background: "#0b1b23" }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={onFilesSelected}
        accept=".dcm,application/dicom,application/octet-stream"
      />

      <iframe
        ref={iframeRef}
        src={shellUrl}
        title="Radiology AI UI Shell"
        onLoad={onIFrameLoad}
        style={{ width: "100%", height: "100%", border: "0", display: "block", background: "transparent" }}
      />
    </div>
  );
}