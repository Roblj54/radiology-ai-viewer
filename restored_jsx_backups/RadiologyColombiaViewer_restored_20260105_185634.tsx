import React, { useMemo, useRef, useState, useEffect } from "react";
import "./RadiologyColombiaViewer.css";
import { loadDicomFiles, displayImageWithViewport, getLoadedCount, ViewerViewport } from './dicomLoader';


import { attachCornerstoneMouseControls } from "./mouseControls";

import { attachKeyboardShortcuts } from "./keyboardShortcuts";
type Lang = 'ES' | 'EN';

const WL_PRESETS = {
  soft: { windowCenter: 40, windowWidth: 400 },
  lung: { windowCenter: -600, windowWidth: 1500 },
  bone: { windowCenter: 300, windowWidth: 2000 },
};

export default function RadiologyColombiaViewer() {
{/* UI_SHELL_LOGIC_START */}
// ------------------------------
// UI Shell: professional layout scaffolding (Study rail, Viewer, AI Review rail)
// ------------------------------
type UiShellStatus = "ready" | "loading" | "running" | "error";
type UiShellDecision = "accept" | "reject" | "review" | null;
type UiShellConfidence = "High" | "Medium" | "Low";
type UiShellSeverity = "Critical" | "Review" | "Info";

type UiShellFinding = {
  id: string;
  label: string;
  location?: string;
  confidence: UiShellConfidence;
  severity?: UiShellSeverity;
  evidenceText?: string;
  sliceStart?: number;
  sliceEnd?: number;
  decision?: UiShellDecision;
  note?: string;
};

const [uiShellLeftOpen, setUiShellLeftOpen] = useState(true);
const [uiShellRightOpen, setUiShellRightOpen] = useState(true);

// If true, the old fixed "?" button block will be hidden and the Top bar Help is used instead
const uiShellUseTopbarHelp = true;

const [uiShellStatus, setUiShellStatus] = useState<UiShellStatus>("ready");
const [uiShellStatusMsg, setUiShellStatusMsg] = useState<string>("");
const [uiShellSummary, setUiShellSummary] = useState<string>("");
const [uiShellFindings, setUiShellFindings] = useState<UiShellFinding[]>([]);
const [uiShellModelName] = useState<string>("Radiology AI");
const [uiShellModelVersion] = useState<string>("v0.1");
const [uiShellLangTick, setUiShellLangTick] = useState(0);

const uiShellNowIso = () => new Date().toISOString();

// Language source of truth for UI shell: document language
const uiShellIsES = (() => {
  const lang = (document?.documentElement?.lang || "").toLowerCase();
  return lang.startsWith("es");
})();

const uiShellT = (en: string, es: string) => (uiShellIsES ? es : en);

const uiShellSetLang = (lang: "en" | "es") => {
  if (document?.documentElement) document.documentElement.lang = lang;
  setUiShellLangTick((x) => x + 1); // force refresh of uiShellIsES-dependent labels
};

const uiShellStatusLabel = (() => {
  if (uiShellStatus === "loading") return uiShellT("Loading files", "Cargando archivos");
  if (uiShellStatus === "running") return uiShellT("Running AI", "Ejecutando IA");
  if (uiShellStatus === "error") return uiShellT("Error", "Error");
  return uiShellT("Ready", "Listo");
})();

const uiShellStatusDetail = uiShellStatusMsg || (uiShellStatus === "ready"
  ? uiShellT("Load images to begin.", "Cargue imÃ¡genes para comenzar.")
  : "");

const uiShellUpdateDecision = (id: string, decision: UiShellDecision) => {
  setUiShellFindings((prev) =>
    prev.map((f) => (f.id === id ? { ...f, decision } : f))
  );
};

const uiShellSetNote = (id: string, note: string) => {
  setUiShellFindings((prev) =>
    prev.map((f) => (f.id === id ? { ...f, note } : f))
  );
};

const uiShellExportJson = () => {
  const payload = {
    exportedAt: uiShellNowIso(),
    model: { name: uiShellModelName, version: uiShellModelVersion },
    summary: uiShellSummary,
    findings: uiShellFindings,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "radiology-ai-review.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// AI call stub: backend should accept study context and return { summary, findings[] }
const uiShellRunAI = async () => {
  try {
    setUiShellStatus("running");
    setUiShellStatusMsg(uiShellT("Sending study to AI", "Enviando estudio a IA"));

    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Future: include identifiers or selected series metadata here
      body: JSON.stringify({ client: "radiology-ai-viewer", requestedAt: uiShellNowIso() }),
    });

    if (!res.ok) {
      throw new Error("AI HTTP " + res.status);
    }

    const data = await res.json();

    const summary = (data?.summary && String(data.summary)) || uiShellT("Results received.", "Resultados recibidos.");
    const findingsRaw = Array.isArray(data?.findings) ? data.findings : [];

    const findings: UiShellFinding[] = findingsRaw.map((x: any, idx: number) => ({
      id: String(x?.id ?? idx),
      label: String(x?.label ?? x?.name ?? uiShellT("Finding", "Hallazgo")),
      location: x?.location ? String(x.location) : undefined,
      confidence: (x?.confidenceLabel === "High" || x?.confidenceLabel === "Medium" || x?.confidenceLabel === "Low")
        ? x.confidenceLabel
        : (x?.confidence === "High" || x?.confidence === "Medium" || x?.confidence === "Low")
          ? x.confidence
          : "Medium",
      severity: (x?.severity === "Critical" || x?.severity === "Review" || x?.severity === "Info")
        ? x.severity
        : undefined,
      evidenceText: x?.evidenceText ? String(x.evidenceText) : undefined,
      sliceStart: Number.isFinite(x?.sliceStart) ? Number(x.sliceStart) : undefined,
      sliceEnd: Number.isFinite(x?.sliceEnd) ? Number(x.sliceEnd) : undefined,
      decision: null,
      note: "",
    }));

    setUiShellSummary(summary);
    setUiShellFindings(findings);
    setUiShellStatus("ready");
    setUiShellStatusMsg(uiShellT("AI analysis complete.", "AnÃ¡lisis de IA completo."));
  } catch (e: any) {
    setUiShellStatus("error");
    setUiShellStatusMsg(uiShellT(
      "AI service unavailable. Check backend and retry.",
      "Servicio de IA no disponible. Verifique backend y reintente."
    ));
    // keep prior results visible if any
    console.error("AI error", e);
  }
};

// Styles (simple, clean, clinical)
const uiShellZ = 90000;
const uiShellTopH = 52;
const uiShellLeftW = uiShellLeftOpen ? 320 : 56;
const uiShellRightW = uiShellRightOpen ? 360 : 56;

const uiShellBtnBase: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.92)",
  borderRadius: 10,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: "16px",
  userSelect: "none",
};

const uiShellPill: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(0,0,0,0.35)",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  lineHeight: "16px",
  color: "rgba(255,255,255,0.92)",
};

const uiShellPanel: React.CSSProperties = {
  background: "rgba(18,18,18,0.92)",
  backdropFilter: "blur(10px)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
  color: "rgba(255,255,255,0.92)",
};

const uiShellSectionTitle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(255,255,255,0.70)",
  margin: "12px 0 6px 0",
};

const uiShellMuted: React.CSSProperties = { color: "rgba(255,255,255,0.70)", fontSize: 12, lineHeight: "16px" };


{/* UI_SHELL_STUDY_WIRING_START */}
// ------------------------------
// Left rail wiring: build real Series cards from existing state
// ------------------------------
type UiShellSeriesCard = {
  id: string;
  label: string;
  modality: string;
  count: number;
  imageIds: string[] | null;
  thumbImageId?: string;
};

const uiShellActiveSeriesIdx = sliceIndex;
const uiShellSetActiveSeriesIdx = setSliceIndex;

const uiShellSeriesItems: any[] = [];

const uiShellThumbUrl = (_id?: string) => null;

const uiShellStudySummary = () => {
  const seriesCount = uiShellSeriesItems.length;
  const totalImages = uiShellSeriesItems.reduce((acc, s) => acc + (Number.isFinite(s.count) ? s.count : 0), 0);
  const modality = uiShellSeriesItems.find((s) => s.modality)?.modality || uiShellT("-", "-");
  return { seriesCount, totalImages, modality };
};

const uiShellSelectSeries = (idx: number) => {
  if (idx < 0 || idx >= uiShellSeriesItems.length) return;

  uiShellSetActiveSeriesIdx(idx);

  const s: any = uiShellSeriesItems[idx];
  const ids: any = s?.imageIds;
  const firstImageId = (Array.isArray(ids) && ids.length) ? String(ids[0]) : undefined;

  // 1) Load series into the viewer stack (if your app exposes a setter)
  try {
    const nextIds = (ids && Array.isArray(ids)) ? ids : null;
    if (nextIds) { setImageIds(nextIds); }
  } catch (e) { }

  // 2) Jump to first slice (if your app exposes an image index setter)
  try { setCurrentImageIndex(0); } catch (e) { }

  // Remember which imageId to apply VOI against
  setUiShellVoiImageId(firstImageId || null);

  // 3) Prefer DICOM VOI pairs first
  const dicomPresets = uiShellGetVoiFromDicom(firstImageId);
  if (dicomPresets.length > 0) {
    setUiShellVoiPresets(dicomPresets);
    setUiShellVoiIdx(0);
    uiShellApplyVoiPreset(dicomPresets[0], firstImageId);
    setUiShellStatusMsg(uiShellT("Active series updated (DICOM window applied).", "Serie activa actualizada (ventana DICOM aplicada)."));
    return;
  }

  // 4) If no DICOM VOI exists, try automatic VOI if Cornerstone supports it
  // (best for keeping contrast usable when no window tags are present)
  setUiShellVoiPresets([]);
  setUiShellVoiIdx(0);
  uiShellApplyAutoVoi(firstImageId);

  // 5) Final fallback: keep your existing modality defaults (do not block the user)
  const mod = String(s?.modality || "").toUpperCase();
  const voi = (() => {
    if (mod === "CT") return { ww: 350, wc: 50 };
    if (mod === "MR") return { ww: 1500, wc: 750 };
    if (mod === "PT" || mod === "NM") return { ww: 2000, wc: 1000 };
    if (mod === "CR" || mod === "DX" || mod === "DR") return { ww: 2000, wc: 1000 };
    return null;
  })();

  if (voi && firstImageId) {
    uiShellApplyVoiPreset({ name: uiShellT("Default", "Predeterminado"), ww: voi.ww, wc: voi.wc }, firstImageId);
  }

  setUiShellStatusMsg(uiShellT("Active series updated.", "Serie activa actualizada."));
};


{/* UI_SHELL_STUDY_WIRING_END */}

{/* UI_SHELL_VOI_PRESETS_START */}
// ------------------------------
// VOI presets (Window/Level) driven by DICOM metadata when available
// ------------------------------
type UiShellVoiPreset = { name: string; wc: number; ww: number };

const [uiShellVoiPresets, setUiShellVoiPresets] = useState<UiShellVoiPreset[]>([]);
const [uiShellVoiIdx, setUiShellVoiIdx] = useState(0);
const [uiShellVoiImageId, setUiShellVoiImageId] = useState<string | null>(null);

const uiShellToNumberList = (v: any): number[] => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (typeof v === "number") return Number.isFinite(v) ? [v] : [];
  if (typeof v === "string") {
    // DICOM DS may appear like "40\\80" or "40"
    const parts = v.split("\\\\").map((s) => s.trim()).filter(Boolean);
    return parts.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  }
  return [];
};

const uiShellToStringList = (v: any): string[] => {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string") return v.split("\\\\").map((s) => s.trim()).filter(Boolean);
  return [];
};

const uiShellGetVoiFromDicom = (imageId?: string): UiShellVoiPreset[] => {
  try {
    const cs = (window as any).cornerstone;
    if (!cs || !cs.metaData || typeof cs.metaData.get !== "function" || !imageId) return [];

    // Common cornerstone metadata keys from WADO image loaders
    const m =
      cs.metaData.get("voiLutModule", imageId) ||
      cs.metaData.get("voiLUTModule", imageId) ||
      cs.metaData.get("windowLevelModule", imageId) ||
      null;

    const wc = uiShellToNumberList(m?.windowCenter ?? m?.WindowCenter);
    const ww = uiShellToNumberList(m?.windowWidth ?? m?.WindowWidth);
    const expl = uiShellToStringList(
      m?.windowCenterWidthExplanation ??
      m?.WindowCenterWidthExplanation ??
      m?.windowCenterWidthExplanation
    );

    const n = Math.min(wc.length, ww.length);
    if (n <= 0) return [];

    const presets: UiShellVoiPreset[] = [];
    for (let i = 0; i < n; i++) {
      const name = expl[i] || uiShellT("Window " + (i + 1), "Ventana " + (i + 1));
      presets.push({ name, wc: wc[i], ww: ww[i] });
    }
    return presets;
  } catch (e) {
    return [];
  }
};

const uiShellFindCornerstoneElement = (): any => {
  // Best effort to locate a cornerstone-enabled element
  return (
    (document.querySelector(".cornerstone-element") as any) ||
    (document.querySelector("[data-cornerstone-enabled]") as any) ||
    (document.querySelector("canvas") as any)?.parentElement ||
    null
  );
};

const uiShellApplyVoiPreset = (preset: UiShellVoiPreset | null, imageId?: string) => {
  if (!preset) return;
  try {
    const cs = (window as any).cornerstone;
    const el = uiShellFindCornerstoneElement();
    if (cs && el && typeof cs.getViewport === "function" && typeof cs.setViewport === "function") {
      const vp = cs.getViewport(el);
      if (vp && vp.voi) {
        vp.voi.windowWidth = preset.ww;
        vp.voi.windowCenter = preset.wc;
        cs.setViewport(el, vp);
        if (typeof cs.updateImage === "function") cs.updateImage(el);
      }
    }
  } catch (e) { }

    try {
      // If your viewer uses updateViewport state, apply VOI there as well (best effort)
      updateViewport({
        index: 0,
        imageId,
        windowWidth: preset.ww,
        windowCenter: preset.wc,
        invert: false,
        hflip: false,
        vflip: false,
        rotation: 0,
      });
    } catch (e) { }
};

const uiShellApplyAutoVoi = async (imageId?: string) => {
  try {
    const cs = (window as any).cornerstone;
    const el = uiShellFindCornerstoneElement();
    if (!cs || !el || !imageId) return;

    if (typeof cs.loadAndCacheImage !== "function") return;
    if (typeof cs.getViewport !== "function" || typeof cs.setViewport !== "function") return;
    if (typeof cs.computeAutoVoi !== "function") return;

    const img = await cs.loadAndCacheImage(imageId);
    const vp = cs.getViewport(el);
    cs.computeAutoVoi(vp, img);
    cs.setViewport(el, vp);
    if (typeof cs.updateImage === "function") cs.updateImage(el);
  } catch (e) { }
};
{/* UI_SHELL_VOI_PRESETS_END */}

{/* UI_SHELL_THUMB_STRIP_CONST_START */}
// Center filmstrip height (px). Keep it slim to avoid covering image area.
const uiShellThumbStripH = 78;
{/* UI_SHELL_THUMB_STRIP_CONST_END */}

{/* UI_SHELL_FILMSTRIP_AUTOSCROLL_START */}
// ------------------------------
// Filmstrip polish: keep active series centered (smooth)
// ------------------------------
const uiShellFilmstripRef = useRef<HTMLDivElement | null>(null);
const uiShellFilmstripItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

useEffect(() => {
  const raf = requestAnimationFrame(() => {
    const container = uiShellFilmstripRef.current;
    const item = uiShellFilmstripItemRefs.current[uiShellActiveSeriesIdx] || null;
    if (!container || !item) return;

    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();

    // delta needed to place item center onto container center
    const delta = (iRect.left - cRect.left) - (cRect.width / 2 - iRect.width / 2);
    const target = container.scrollLeft + delta;

    container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  });

  return () => cancelAnimationFrame(raf);
}, [uiShellActiveSeriesIdx, uiShellSeriesItems.length, uiShellLeftOpen, uiShellRightOpen]);
{/* UI_SHELL_FILMSTRIP_AUTOSCROLL_END */}

{/* UI_SHELL_FINDING_JUMP_START */}
// ------------------------------
// AI Finding navigation: switch series (seriesId) then jump to sliceStart + highlight flash
// ------------------------------
type UiShellSliceRange = { start: number; end: number };
type UiShellPendingJump = { seriesIdx: number; idx0: number; start: number; end: number };

const [uiShellTmpImageIndex, setUiShellTmpImageIndex] = useState(0);
const [uiShellTmpSeriesIdx, setUiShellTmpSeriesIdx] = useState(0);

const uiShellSetImageIndex = (idx0: number) => { try { setUiShellTmpImageIndex(idx0); } catch (e) { } };
const uiShellSetSeriesIndex = (sidx: number) => { try { setUiShellTmpSeriesIdx(sidx); } catch (e) { } };

const [uiShellHighlightedSlices, setUiShellHighlightedSlices] = useState<UiShellSliceRange | null>(null);
const [uiShellPendingJump, setUiShellPendingJump] = useState<UiShellPendingJump | null>(null);

const uiShellFindViewerElement = (): HTMLElement | null => {
  return (
    (document.querySelector(".cornerstone-element") as any) ||
    (document.querySelector("[data-cornerstone-enabled]") as any) ||
    ((document.querySelector("canvas") as any)?.parentElement as any) ||
    (document.querySelector("canvas") as any) ||
    null
  ) as any;
};

const uiShellFlashViewer = () => {
  try {
    const el = uiShellFindViewerElement();
    if (!el) return;

    const prevOutline = (el as any).style?.outline;
    const prevOutlineOffset = (el as any).style?.outlineOffset;

    (el as any).style.outline = "2px solid rgba(255,255,255,0.35)";
    (el as any).style.outlineOffset = "2px";

    window.setTimeout(() => {
      try {
        (el as any).style.outline = prevOutline || "";
        (el as any).style.outlineOffset = prevOutlineOffset || "";
      } catch (e) { }
    }, 650);
  } catch (e) { }
};

const uiShellNormalizeKey = (v: any): string => {
  try { return String(v ?? "").trim().toLowerCase(); } catch (e) { return ""; }
};

const uiShellResolveSeriesIndexForFinding = (f: any): number | null => {
  try {
    const wantedRaw =
      f?.seriesId ??
      f?.seriesIdx ??
      f?.seriesIndex ??
      f?.seriesUID ??
      f?.seriesUid ??
      f?.seriesInstanceUID ??
      f?.seriesInstanceUid ??
      f?.SeriesInstanceUID ??
      f?.SeriesInstanceUid ??
      null;

    if (wantedRaw === null || wantedRaw === undefined || wantedRaw === "") return null;

    // Numeric index support
    if (typeof wantedRaw === "number" && Number.isFinite(wantedRaw)) {
      const n = Math.trunc(wantedRaw);
      if (n >= 0 && n < (uiShellSeriesItems?.length || 0)) return n;
    }

    const wanted = uiShellNormalizeKey(wantedRaw);

    // Numeric string index support
    const asNum = Number(wanted);
    if (Number.isFinite(asNum) && String(Math.trunc(asNum)) === wanted) {
      const n = Math.trunc(asNum);
      if (n >= 0 && n < (uiShellSeriesItems?.length || 0)) return n;
    }

    const items = uiShellSeriesItems || [];
    for (let i = 0; i < items.length; i++) {
      const s: any = items[i];
      const keys = [
        s?.seriesId, s?.id, s?.uid,
        s?.seriesUid, s?.seriesUID,
        s?.seriesInstanceUid, s?.seriesInstanceUID, s?.SeriesInstanceUID, s?.SeriesInstanceUid
      ].map(uiShellNormalizeKey).filter(Boolean);

      // Also allow comparing against i
      keys.push(uiShellNormalizeKey(i));

      if (keys.includes(wanted)) return i;
    }

    return null;
  } catch (e) {
    return null;
  }
};

const uiShellApplyJumpUI = (start: number, end: number) => {
  try { setUiShellHighlightedSlices({ start, end }); } catch (e) { }
  try { uiShellFlashViewer(); } catch (e) { }
  try {
    setUiShellStatusMsg(
      uiShellT(
        "Jumped to slices " + start + "-" + end + ".",
        "SaltÃ³ a cortes " + start + "-" + end + "."
      )
    );
  } catch (e) { }

  window.setTimeout(() => {
    try { setUiShellHighlightedSlices(null); } catch (e) { }
  }, 3500);
};

// When we switch series first, complete the jump after the active series updates
useEffect(() => {
  try {
    if (!uiShellPendingJump) return;
    if (uiShellPendingJump.seriesIdx !== (uiShellTmpSeriesIdx as any)) return;

    const pj = uiShellPendingJump;
    setUiShellPendingJump(null);

    uiShellSetImageIndex(pj.idx0);
    void goTo(pj.idx0);
    uiShellApplyJumpUI(pj.start, pj.end);
  } catch (e) { }
}, [uiShellPendingJump, uiShellTmpSeriesIdx]);

const uiShellGoToFinding = (f: any) => {
  try {
    const s1 = Number(f?.sliceStart);
    const e1raw = Number(f?.sliceEnd);
    const e1 = Number.isFinite(e1raw) ? e1raw : s1;

    if (!Number.isFinite(s1)) {
      setUiShellStatusMsg(uiShellT("No slice info available for this finding.", "Este hallazgo no tiene cortes disponibles."));
      return;
    }

    const start0 = (s1 > 0) ? (s1 - 1) : 0;

    // Resolve target series (supports seriesId / SeriesInstanceUID / seriesIndex)
    const resolvedSeriesIdx = uiShellResolveSeriesIndexForFinding(f);
    const targetSeriesIdx = (resolvedSeriesIdx === null || resolvedSeriesIdx === undefined) ? (uiShellTmpSeriesIdx as any) : resolvedSeriesIdx;

    const count = Number(uiShellSeriesItems?.[targetSeriesIdx]?.count || 1);
    const max0 = Math.max(0, count - 1);
    const idx0 = Math.max(0, Math.min(start0, max0));

    // If finding belongs to another series, switch series first then jump (via effect)
    if (targetSeriesIdx !== (uiShellTmpSeriesIdx as any)) {
      setUiShellPendingJump({ seriesIdx: targetSeriesIdx, idx0, start: s1, end: e1 });
      uiShellSetSeriesIndex(targetSeriesIdx);

      setUiShellStatusMsg(
        uiShellT(
          "Switching series and jumping to slices " + s1 + "-" + e1 + "...",
          "Cambiando de serie y saltando a cortes " + s1 + "-" + e1 + "..."
        )
      );
      return;
    }

    // Same series: jump now
    uiShellSetImageIndex(idx0);
    void goTo(idx0);
    uiShellApplyJumpUI(s1, e1);
  } catch (e) {
    setUiShellStatusMsg(uiShellT("Could not jump to that finding.", "No se pudo saltar a ese hallazgo."));
  }
};
{/* UI_SHELL_FINDING_JUMP_END */}
{/* UI_SHELL_LOGIC_END */}

/* CONTROLS_OVERLAY_MANUAL_OPEN_START */
const controlsOverlayCardRef = useRef<HTMLDivElement | null>(null);
const controlsHelpBtnRef = useRef<HTMLButtonElement | null>(null);

const openControlsOverlay = () => setShowControlsOverlay(true);
const closeControlsOverlay = () => setShowControlsOverlay(false);
const toggleControlsOverlay = () => setShowControlsOverlay((v) => !v);

useEffect(() => {
  // Show once on mount (keep open until user closes it)
  openControlsOverlay();

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeControlsOverlay();
  };
  window.addEventListener("keydown", onKeyDown);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

useEffect(() => {
  if (!showControlsOverlay) return;

  const onMouseDown = (e: MouseEvent) => {
    const t = e.target as Node | null;
    if (!t) return;

    const card = controlsOverlayCardRef.current;
    if (!card) return; // outside click close only when ref is wired in JSX

    if (card.contains(t)) return;

    const btn = controlsHelpBtnRef.current;
    if (btn && btn.contains(t)) return;

    closeControlsOverlay();
  };

  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("touchstart", onMouseDown as any);

  return () => {
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("touchstart", onMouseDown as any);
  };
}, [showControlsOverlay]);
/* CONTROLS_OVERLAY_MANUAL_OPEN_END */

  const viewportRef = useRef<HTMLDivElement | null>
    {/* UI_SHELL_RENDER_START */}
    <div style={{ zIndex: 9999, fontWeight: 900, marginBottom: 10 }}>
      {uiShellT("AI Findings", "Hallazgos de IA")}

    {uiShellFindings.length === 0 ? (
      <div style={{ ...uiShellMuted, fontSize: 12, padding: 10 }}>
        {uiShellT("No AI findings available.", "No hay hallazgos de IA.")}
    ) : (
      <div>
        {uiShellFindings.map((f: any, idx: number) => (
          <div
            key={String(f.id ?? idx)}
            style={{
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.18)",
              borderRadius: 14,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 800 }}>
              {f.label}
              {f.location ? ` (${f.location})` : ""}

            <div
              style={{
                fontSize: 12,
                lineHeight: "16px",
                opacity: 0.9,
                marginTop: 4,
              }}
            >
              {uiShellT("Confidence:", "Confianza:")} {f.confidence}
              {f.severity
                ? ` (${uiShellT("Severity", "Severidad")}: ${f.severity})`
                : ""}

            {Number.isFinite(f.sliceStart) &&
            Number.isFinite(f.sliceEnd) ? (
              <div
                style={{
                  fontSize: 12,
                  lineHeight: "16px",
                  opacity: 0.9,
                  marginTop: 4,
                }}
              >
                {uiShellT("Slices", "Cortes")}: {f.sliceStart} -{" "}
                {f.sliceEnd}
            ) : null}

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={() => uiShellUpdateDecision(f.id, "accept")}
                style={uiShellBtnBase}
              >
                {uiShellT("Accept", "Aceptar")}
              <button
                onClick={() => uiShellUpdateDecision(f.id, "reject")}
                style={uiShellBtnBase}
              >
                {uiShellT("Reject", "Rechazar")}
              <button
                onClick={() => uiShellUpdateDecision(f.id, "review")}
                style={uiShellBtnBase}
              >
                {uiShellT("Needs review", "Requiere revisión")}
        ))}
    )}
    {/* UI_SHELL_RENDER_END */}

/* CONTROLS_OVERLAY_HELP_BUTTON_START */
null;
/* CONTROLS_OVERLAY_HELP_BUTTON_END */
const [lang, setLang] = useState<Lang>('ES');
  const [err, setErr] = useState<string>('');
  const [sliceIndex, setSliceIndex] = useState<number>(0);
  const [sliceCount, setSliceCount] = useState<number>(0);

  const [vp, setVp] = useState<ViewerViewport>({
    invert: false,
    hflip: false,
    vflip: false,
    rotation: 0,
    windowCenter: WL_PRESETS.soft.windowCenter,
    windowWidth: WL_PRESETS.soft.windowWidth,
  });

  const t = useMemo(() => {
    const ES = {
      title: 'Radiology AI Colombia Health',
      upload: 'Subir DICOM',
      select: 'Seleccionar archivos DICOM',
      loaded: (n: number) => `Serie cargada con ${n} cortes.`,
      study: 'Lista de estudios (demo)',
      patient: 'Paciente 001 CT Chest',
      invert: 'Invertir',
      rot: 'Rotar 90',
      flipH: 'Voltear H',
      flipV: 'Voltear V',
      soft: 'Tejido blando',
      lung: 'PulmÃ³n',
      bone: 'Hueso',
      slice: (i: number, n: number) => `Corte ${i} / ${n}`,
    };
    const EN = {
      title: 'Radiology AI Colombia Health',
      upload: 'Upload DICOM',
      select: 'Select DICOM files',
      loaded: (n: number) => `Loaded series with ${n} slices.`,
      study: 'Study list (demo)',
      patient: 'Patient 001 CT Chest',
      invert: 'Invert',
      rot: 'Rotate 90',
      flipH: 'Flip H',
      flipV: 'Flip V',
      soft: 'Soft tissue',
      lung: 'Lung',
      bone: 'Bone',
      slice: (i: number, n: number) => `Slice ${i} / ${n}`,
    };
    return lang === 'ES' ? ES : EN;
  }, [lang]);

  async function renderCurrent(nextIndex: number, nextVp: ViewerViewport) {
    const el = viewportRef.current;
    if (!el) return;

    await displayImageWithViewport(el, nextIndex, nextVp);
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      setErr('');
      const files = e.target.files;
      const arr = files ? Array.from(files) : [];
      e.target.value = '';
      if (!arr.length) return;

      await loadDicomFiles(arr);
      const n = getLoadedCount();
      setSliceCount(n);
      setSliceIndex(0);

      const nextVp: ViewerViewport = { ...vp };
      setVp(nextVp);

      await renderCurrent(0, nextVp);
    } catch (ex: any) {
      setErr(ex?.message || String(ex));
    }
  }

  async function updateViewport(patch: Partial<ViewerViewport>) {
    try {
      setErr('');
      const next = { ...vp, ...patch };
      setVp(next);
      await renderCurrent(sliceIndex, next);
    } catch (ex: any) {
      setErr(ex?.message || String(ex));
    }
  }

  async function goTo(i: number) {
    try {
      setErr('');
      if (!sliceCount) return;
      const nextIndex = Math.max(0, Math.min(i, sliceCount - 1));
      setSliceIndex(nextIndex);
      await renderCurrent(nextIndex, vp);
    } catch (ex: any) {
      setErr(ex?.message || String(ex));
    }
  }

  // === Controls hook: mouse + keyboard (auto-added) ===
(() => {
    const el = viewportRef.current as any;
    if (!el) return;
  
    const detachMouse = attachCornerstoneMouseControls(el, {
      isSeriesLoaded: () => (imageIds && imageIds.length > 0),
      onWheelSlice: (dir) => {
        setSliceIndex((i) => {
          const len = imageIds ? imageIds.length : 0;
          if (!len) return 0;
          const next = i + dir;
          return Math.max(0, Math.min(len - 1, next));
        });
      },
    });
  
    const detachKeys = attachKeyboardShortcuts(el, {
      isSeriesLoaded: () => (imageIds && imageIds.length > 0),
      getIndex: () => sliceIndex,
      getLength: () => (imageIds ? imageIds.length : 0),
      setIndex: (fn) => setSliceIndex(fn),
    });
  // === Controls overlay: bilingual (auto-added) ===
  const _controlsHelpShownRef = useRef(false);
  const [showControlsHelp, setShowControlsHelp] = useState(false);

  const __controlsLang = (() => {
    try {
      const l = String(lang || "").toLowerCase();
      return l.startsWith("es") ? "es" : "en";
    } catch (e) {
      return "en";
    }
  })();
  const __controlsIsES = __controlsLang === "es";

  useEffect(() => {
    const loaded = (imageIds && imageIds.length > 0);
    if (!loaded) return;
    if (_controlsHelpShownRef.current) return;

    _controlsHelpShownRef.current = true;
    setShowControlsHelp(true);

    const t = window.setTimeout(() => setShowControlsHelp(false), 9000);
    return () => window.clearTimeout(t);
  }, [imageIds ? imageIds.length : 0]);
  // === End controls overlay ===
  
    return () => {
      try { detachMouse && detachMouse(); } catch (e) { }
      try { detachKeys && detachKeys(); } catch (e) { }
    };
  }, [imageIds]);
  // === End controls hook ===

  return (
    <div>
{/* Spacer so fixed topbar does not cover content */}
// //       <div style={{ height: uiShellTopH }} />
// //       <div style={{ height: uiShellThumbStripH }} />
      
      
{showControlsHelp && (
      
      
    <div
      
      
      style={{
      
      
        position: "fixed",
      
      
        top: 88,
      
      
        right: 12,
      
      
        width: 360,
      
      
        maxWidth: "92vw",
      
      
        padding: 12,
      
      
        borderRadius: 16,
      
      
        border: "1px solid rgba(255,255,255,0.10)",
      
      
        background: "rgba(12,12,12,0.92)",
      
      
        color: "rgba(255,255,255,0.92)",
      
      
        zIndex: 10000,
      
      
      }}
      
      
    >
      
      
      <div style={{ fontWeight: 900, marginBottom: 8 }}>
      
      
{lang === "ES" ? "Controles" : "Controls"}
      
      
      
      
      <div style={{ fontSize: 12, lineHeight: "16px", opacity: 0.9 }}>
      
      
{lang === "ES"
      
      
          ? "Rueda: zoom. Arrastrar: mover. Doble clic: reiniciar. Teclas:   para navegar."
      
      
          : "Wheel: zoom. Drag: pan. Double click: reset. Keys:   to navigate."}
      
      
      
      
      
      
  )}
          <button
            onClick={() => setLang((p) => (p === 'ES' ? 'EN' : 'ES'))}
            style={{
              background: 'transparent',
              color: '#e5e7eb',
              border: '1px solid #334155',
              padding: '6px 10px',
              borderRadius: 8,
              cursor: 'pointer',
            }}
          >
            ES / EN

{err ? (
          <div
            style={{
              border: '1px solid #ef4444',
              background: 'rgba(239,68,68,0.08)',
              color: '#fecaca',
              padding: 10,
              borderRadius: 10,
              marginBottom: 12,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 12,
            }}
          >
            Load error: {err}
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
              <label
                style={{
                  display: 'inline-block',
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid #0ea5a6',
                  color: '#d1fae5',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
{t.select}
// //                 <input type="file" multiple accept=".dcm,application/dicom" onChange={onFiles} style={{ display: 'none' }} />
//               </label>

              <div style={{ marginTop: 10, color: '#93a4b8', fontSize: 12 }}>
{sliceCount ? t.loaded(sliceCount) : 'No series loaded yet.'}


//               <button onClick={() => updateViewport({ invert: !vp.invert })}>{t.invert}</button>
//               <button onClick={() => updateViewport({ rotation: ((vp.rotation ?? 0) + 90) % 360 })}>{t.rot}</button>
//               <button onClick={() => updateViewport({ hflip: !vp.hflip })}>{t.flipH}</button>
//               <button onClick={() => updateViewport({ vflip: !vp.vflip })}>{t.flipV}</button>


//               <button onClick={() => updateViewport(WL_PRESETS.soft)}>{t.soft}</button>
//               <button onClick={() => updateViewport(WL_PRESETS.lung)}>{t.lung}</button>
//               <button onClick={() => updateViewport(WL_PRESETS.bone)}>{t.bone}</button>

              <div
                ref={viewportRef}
                id="dicomImage"
                style={{
                  width: '100%',
                  height: 520,
                  background: '#060a16',
                  borderRadius: 10,
                  border: '1px solid #1f2a44',
                  overflow: 'hidden',
                }}
// //               />

            <div style={{ marginTop: 10 }}>
              <input
                type="range"
                min={0}
                max={Math.max(0, sliceCount - 1)}
                value={sliceIndex}
                onChange={(e) => goTo(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
                disabled={!sliceCount}
// //               />
              <div style={{ color: '#93a4b8', fontSize: 12, marginTop: 6 }}>
{sliceCount ? t.slice(sliceIndex + 1, sliceCount) : t.slice(0, 0)}

  );
}



