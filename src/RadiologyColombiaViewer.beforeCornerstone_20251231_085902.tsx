import React, { useEffect, useMemo, useRef, useState } from "react";
import "./radiology-colombia.css";

type Lang = "es" | "en";
type ResultState = "pending" | "analyzing" | "finding";

type LangStrings = {
  profileRole: string;
  sidebarTitle1: string;
  sidebarTitle2: string;
  uploadTitle: string;
  uploadSubtitle: string;

  study1Primary: string;
  study1Secondary: string;
  study2Primary: string;
  study2Secondary: string;

  toolbarImageGroup: string;
  toolbarContrastGroup: string;
  btnInvert: string;
  btnRotate90: string;
  btnFlipH: string;
  btnFlipV: string;
  btnSoftTissue: string;
  btnLung: string;
  btnBone: string;

  statusConnected: string;
  badgeCollab: string;
  btnCine: string;
  btnAI: string;

  metaPatient: string;
  metaStudy: string;
  metaTechnical: string;

  sliceLabel: string;
  feedbackLabel: string;
  feedbackAccept: string;
  feedbackReject: string;
  feedbackComment: string;

  footerMainHtml: string;
  footerSupport: string;
  footerTerms: string;
  footerPrivacy: string;

  resultPending: string;
  resultAnalyzing: string;
  resultFinding: string;
};

const LANG_STRINGS: Record<Lang, LangStrings> = {
  es: {
    profileRole: "Analista de radiología",

    sidebarTitle1: "Estudios",
    sidebarTitle2: "Lista de estudios",
    uploadTitle: "Cargar DICOM",
    uploadSubtitle:
      "Arrastra archivos de Rayos X, RM o TC aquí<br />o haz clic para explorar",

    study1Primary: "Paciente 001 - TC Tórax",
    study1Secondary: "2025-12-31  120 cortes  ID: ST001",
    study2Primary: "Paciente 002 - Rx Tórax",
    study2Secondary: "2025-12-30  1 imagen  ID: ST002",

    toolbarImageGroup: "Imagen",
    toolbarContrastGroup: "Contraste",
    btnInvert: "Invertir",
    btnRotate90: "Rotar 90",
    btnFlipH: "Flip H",
    btnFlipV: "Flip V",
    btnSoftTissue: "Tejido blando",
    btnLung: "Pulmón",
    btnBone: "Hueso",

    statusConnected: "Conectado al motor de IA",
    badgeCollab: "Modo colaborativo con radiólogo",
    btnCine: "Cine",
    btnAI: "Analizar con IA",

    metaPatient: " Paciente: 001",
    metaStudy: " Estudio: TC Tórax  Serie 1",
    metaTechnical: " 120 kVp  1.2 mm",

    sliceLabel: "Cortes",
    feedbackLabel: "Feedback del radiólogo",
    feedbackAccept: "Aceptar hallazgos IA",
    feedbackReject: "Rechazar hallazgos IA",
    feedbackComment: "Añadir comentario",

    footerMainHtml:
      '<span class="highlight">Radiology AI</span> - versión 1.0  Integración EPS Colombia',
    footerSupport: "Soporte",
    footerTerms: "Términos",
    footerPrivacy: "Privacidad",

    resultPending: "IA: En espera de análisis",
    resultAnalyzing: "IA: Analizando...",
    resultFinding: "IA: Posible neumonía - revisar zonas marcadas",
  },
  en: {
    profileRole: "Radiology analyst",

    sidebarTitle1: "Studies",
    sidebarTitle2: "Study list",
    uploadTitle: "Upload DICOM",
    uploadSubtitle:
      "Drag and drop X Ray, MRI or CT files here<br />or click to browse",

    study1Primary: "Patient 001 - CT Chest",
    study1Secondary: "2025-12-31  120 slices  ID: ST001",
    study2Primary: "Patient 002 - Chest X Ray",
    study2Secondary: "2025-12-30  1 image  ID: ST002",

    toolbarImageGroup: "Image",
    toolbarContrastGroup: "Contrast",
    btnInvert: "Invert",
    btnRotate90: "Rotate 90",
    btnFlipH: "Flip H",
    btnFlipV: "Flip V",
    btnSoftTissue: "Soft tissue",
    btnLung: "Lung",
    btnBone: "Bone",

    statusConnected: "Connected to AI engine",
    badgeCollab: "Collaborative mode with radiologist",
    btnCine: "Cine",
    btnAI: "Analyze with AI",

    metaPatient: " Patient: 001",
    metaStudy: " Study: CT Chest  Series 1",
    metaTechnical: " 120 kVp  1.2 mm",

    sliceLabel: "Slices",
    feedbackLabel: "Radiologist feedback",
    feedbackAccept: "Accept AI findings",
    feedbackReject: "Reject AI findings",
    feedbackComment: "Add comment",

    footerMainHtml:
      '<span class="highlight">Radiology AI</span> - version 1.0  EPS Colombia integration',
    footerSupport: "Support",
    footerTerms: "Terms",
    footerPrivacy: "Privacy",

    resultPending: "AI: Waiting for analysis",
    resultAnalyzing: "AI: Analyzing...",
    resultFinding: "AI: Possible pneumonia - review highlighted areas",
  },
};

type ViewerState = {
  sliceCurrent: number;
  sliceMax: number;
  invert: boolean;
  hflip: boolean;
  vflip: boolean;
  rotation: number;
};

export interface ViewerController {
  setStack: (imageIds: string[]) => void;
  goToSlice: (index1Based: number) => void;
  nextSlice: () => void;
  prevSlice: () => void;
  toggleInvert: () => void;
  toggleFlipH: () => void;
  toggleFlipV: () => void;
  rotate90: () => void;
  setWindowPreset: (preset: "soft-tissue" | "lung" | "bone") => void;
  toggleCine: () => void;
}

/**
 * Viewer controller.
 * Plug Cornerstone or your DICOM viewer into updateViewport.
 */
function createViewerController(
  getElement: () => HTMLDivElement | null,
  setViewerState: React.Dispatch<React.SetStateAction<ViewerState>>
): ViewerController {
  let imageIds: string[] = [];
  let currentIndex = 0; // zero based
  let invert = false;
  let hflip = false;
  let vflip = false;
  let rotation = 0;
  let cineTimer: number | null = null;
  const cineFPS = 10;

  function syncSliceState(maxOverride?: number) {
    setViewerState(prev => ({
      ...prev,
      sliceCurrent: currentIndex + 1,
      sliceMax: maxOverride ?? prev.sliceMax,
      invert,
      hflip,
      vflip,
      rotation,
    }));
  }

  function updateViewport(isFirstImage: boolean) {
    const element = getElement();
    if (!element || imageIds.length === 0) return;

    const imageId = imageIds[currentIndex];
    console.log("[updateViewport]", {
      index: currentIndex,
      imageId,
      invert,
      hflip,
      vflip,
      rotation,
      isFirstImage,
    });

    // TODO: plug your real DICOM stack here.
    // Example Cornerstone style (pseudo):
    //
    // import * as cornerstone from "cornerstone-core";
    //
    // if (isFirstImage) {
    //   cornerstone.enable(element);
    // }
    //
    // cornerstone.loadAndCacheImage(imageId).then(image => {
    //   let vp = cornerstone.getDefaultViewportForImage(element, image);
    //   try {
    //     const existing = cornerstone.getViewport(element);
    //     vp = { ...existing };
    //   } catch {}
    //
    //   vp.invert = invert;
    //   vp.hflip = hflip;
    //   vp.vflip = vflip;
    //   vp.rotation = rotation;
    //
    //   cornerstone.displayImage(element, image, vp);
    // }).catch(err => console.error("display error", err));
  }

  const controller: ViewerController = {
    setStack(newImageIds) {
      if (!newImageIds || newImageIds.length === 0) return;
      imageIds = newImageIds.slice();
      currentIndex = 0;
      syncSliceState(imageIds.length);
      updateViewport(true);
    },
    goToSlice(index1Based) {
      if (!imageIds.length) return;
      const max = imageIds.length;
      const clamped = Math.max(1, Math.min(index1Based, max));
      currentIndex = clamped - 1;
      syncSliceState();
      updateViewport(false);
    },
    nextSlice() {
      if (!imageIds.length) return;
      const idx1 = currentIndex + 2;
      this.goToSlice(idx1);
    },
    prevSlice() {
      if (!imageIds.length) return;
      const idx1 = currentIndex;
      this.goToSlice(idx1);
    },
    toggleInvert() {
      invert = !invert;
      syncSliceState();
      updateViewport(false);
    },
    toggleFlipH() {
      hflip = !hflip;
      syncSliceState();
      updateViewport(false);
    },
    toggleFlipV() {
      vflip = !vflip;
      syncSliceState();
      updateViewport(false);
    },
    rotate90() {
      rotation = (rotation + 90) % 360;
      syncSliceState();
      updateViewport(false);
    },
    setWindowPreset(preset) {
      console.log("Set WL preset:", preset);
      // Optionally set VOI values here then call updateViewport.
      updateViewport(false);
    },
    toggleCine() {
      if (!imageIds.length) return;
      if (cineTimer != null) {
        window.clearInterval(cineTimer);
        cineTimer = null;
        console.log("Cine stopped");
        return;
      }
      const interval = 1000 / cineFPS;
      cineTimer = window.setInterval(() => {
        const nextIndex = (currentIndex + 1) % imageIds.length;
        controller.goToSlice(nextIndex + 1);
      }, interval);
      console.log("Cine started at", cineFPS, "fps");
    },
  };

  return controller;
}

export const RadiologyColombiaViewer: React.FC = () => {
  const [lang, setLang] = useState<Lang>("es");
  const [resultState, setResultState] = useState<ResultState>("pending");

  const [viewerState, setViewerState] = useState<ViewerState>({
    sliceCurrent: 1,
    sliceMax: 120,
    invert: false,
    hflip: false,
    vflip: false,
    rotation: 0,
  });

  const dicomRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<ViewerController | null>(null);

  const strings = useMemo(() => LANG_STRINGS[lang], [lang]);

  // Create viewer controller once
  useEffect(() => {
    controllerRef.current = createViewerController(
      () => dicomRef.current,
      setViewerState
    );
  }, []);

  // Expose to window so existing DICOM loader can call setStack(imageIds)
  useEffect(() => {
    if (controllerRef.current) {
      (window as any).viewerController = controllerRef.current;
    }
  }, []);

  const handleSliceSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const max = viewerState.sliceMax || 1;
    const clamped = Math.max(1, Math.min(val, max));
    controllerRef.current?.goToSlice(clamped);
  };

  const handleToolbarAction = (action: string | null) => {
    if (!action || !controllerRef.current) return;
    const c = controllerRef.current;

    switch (action) {
      case "invert":
        c.toggleInvert();
        break;
      case "rotate90":
        c.rotate90();
        break;
      case "flipH":
        c.toggleFlipH();
        break;
      case "flipV":
        c.toggleFlipV();
        break;
      case "wl-soft-tissue":
        c.setWindowPreset("soft-tissue");
        break;
      case "wl-lung":
        c.setWindowPreset("lung");
        break;
      case "wl-bone":
        c.setWindowPreset("bone");
        break;
      case "cine-toggle":
        c.toggleCine();
        break;
      case "prev-slice":
        c.prevSlice();
        break;
      case "next-slice":
        c.nextSlice();
        break;
      case "feedback-accept":
        console.log("Radiologist feedback: accept AI findings");
        break;
      case "feedback-reject":
        console.log("Radiologist feedback: reject AI findings");
        break;
      case "feedback-comment":
        console.log("Radiologist feedback: add comment");
        break;
      default:
        break;
    }
  };

  const handleAIAnalyze = () => {
    setResultState("analyzing");
    // TODO: replace with real fetch to your AI backend
    setTimeout(() => {
      setResultState("finding");
    }, 1500);
  };

  const resultBadgeClass =
    resultState === "finding"
      ? "result-badge result-alert"
      : "result-badge result-pending";

  const resultText =
    resultState === "pending"
      ? strings.resultPending
      : resultState === "analyzing"
      ? strings.resultAnalyzing
      : strings.resultFinding;

  return (
    <div className="app-shell">
      {/* NAVBAR */}
      <header className="navbar">
        <div className="navbar-logo">
          Radiology AI <span>Colombia Health</span>
        </div>
        <div className="navbar-spacer" />
        <div className="lang-toggle" aria-label="Language toggle">
          <button
            className={lang === "es" ? "is-active" : ""}
            onClick={() => setLang("es")}
          >
            ES
          </button>
          <button
            className={lang === "en" ? "is-active" : ""}
            onClick={() => setLang("en")}
          >
            EN
          </button>
        </div>
        <div className="profile-chip">
          <div className="profile-chip-icon">JR</div>
          <span>{strings.profileRole}</span>
        </div>
      </header>

      <div className="layout">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <section>
            <div className="sidebar-section-title">{strings.sidebarTitle1}</div>
            <label className="upload-area">
              <div className="upload-title">{strings.uploadTitle}</div>
              <div
                className="upload-subtitle"
                dangerouslySetInnerHTML={{ __html: strings.uploadSubtitle }}
              />
              <input id="file-input" type="file" multiple />
            </label>
          </section>

          <section>
            <div
              className="sidebar-section-title"
              style={{ marginBottom: "0.2rem" }}
            >
              {strings.sidebarTitle2}
            </div>
            <div className="study-list" id="study-list">
              <div className="study-item selected">
                <div className="study-item-primary">
                  {strings.study1Primary}
                </div>
                <div className="study-item-secondary">
                  {strings.study1Secondary}
                </div>
              </div>
              <div className="study-item">
                <div className="study-item-primary">
                  {strings.study2Primary}
                </div>
                <div className="study-item-secondary">
                  {strings.study2Secondary}
                </div>
              </div>
            </div>
          </section>
        </aside>

        {/* MAIN COLUMN */}
        <main className="main">
          {/* TOOLBAR */}
          <section className="toolbar" aria-label="Image tools">
            <span className="toolbar-group-label">
              {strings.toolbarImageGroup}
            </span>

            <button
              className="toolbar-button"
              onClick={() => handleToolbarAction("invert")}
            >
              <span className="icon"></span>
              <span>{strings.btnInvert}</span>
            </button>
            <button
              className="toolbar-button"
              onClick={() => handleToolbarAction("rotate90")}
            >
              <span className="icon"></span>
              <span>{strings.btnRotate90}</span>
            </button>
            <button
              className="toolbar-button"
              onClick={() => handleToolbarAction("flipH")}
            >
              <span className="icon"></span>
              <span>{strings.btnFlipH}</span>
            </button>
            <button
              className="toolbar-button"
              onClick={() => handleToolbarAction("flipV")}
            >
              <span className="icon"></span>
              <span>{strings.btnFlipV}</span>
            </button>

            <span
              className="toolbar-group-label"
              style={{ marginLeft: "0.75rem" }}
            >
              {strings.toolbarContrastGroup}
            </span>

            <button
              className="toolbar-button secondary"
              onClick={() => handleToolbarAction("wl-soft-tissue")}
            >
              {strings.btnSoftTissue}
            </button>
            <button
              className="toolbar-button secondary"
              onClick={() => handleToolbarAction("wl-lung")}
            >
              {strings.btnLung}
            </button>
            <button
              className="toolbar-button secondary"
              onClick={() => handleToolbarAction("wl-bone")}
            >
              {strings.btnBone}
            </button>

            <span className="toolbar-spacer" />

            <div className="toolbar-status">
              <span className="status-dot" />
              <span>{strings.statusConnected}</span>
            </div>
            <span className="toolbar-badge">{strings.badgeCollab}</span>

            <button
              className="toolbar-button"
              style={{ marginLeft: "0.5rem" }}
              onClick={() => handleToolbarAction("cine-toggle")}
            >
              <span className="icon"></span>
              <span>{strings.btnCine}</span>
            </button>

            <button
              className="toolbar-button"
              style={{ background: "var(--col-blue)" }}
              onClick={handleAIAnalyze}
            >
              <span className="icon"></span>
              <span>{strings.btnAI}</span>
            </button>
          </section>

          {/* VIEWER CARD */}
          <section className="viewer-card">
            <div className="viewer-inner">
              <div className="modality-badge">
                <span className="icon"></span>
                <span className="modality-pill">CT</span>
              </div>

              <div className={resultBadgeClass}>
                <span className="result-badge-dot" />
                <span>{resultText}</span>
              </div>

              <div className="dicom-viewport">
                <div id="dicom-viewport" ref={dicomRef} />
                <canvas id="ai-overlay" ref={overlayRef} />
              </div>
            </div>

            <div className="viewer-meta">
              <span>{strings.metaPatient}</span>
              <span>{strings.metaStudy}</span>
              <span>{strings.metaTechnical}</span>
            </div>
          </section>

          {/* SLICE CONTROLS */}
          <section className="slice-controls" aria-label="Slice controls">
            <span className="slice-label">{strings.sliceLabel}</span>
            <div className="slice-buttons">
              <button
                className="slice-btn"
                onClick={() => handleToolbarAction("prev-slice")}
              >
                
              </button>
              <button
                className="slice-btn"
                onClick={() => handleToolbarAction("next-slice")}
              >
                
              </button>
            </div>
            <div className="slice-slider">
              <input
                type="range"
                min={1}
                max={viewerState.sliceMax}
                value={viewerState.sliceCurrent}
                onChange={handleSliceSliderChange}
              />
            </div>
            <div className="slice-index">
              {viewerState.sliceCurrent} / {viewerState.sliceMax}
            </div>
          </section>

          {/* FEEDBACK STRIP */}
          <section className="feedback-strip">
            <span className="label">{strings.feedbackLabel}</span>
            <button
              className="accept"
              onClick={() => handleToolbarAction("feedback-accept")}
            >
              {strings.feedbackAccept}
            </button>
            <button
              className="reject"
              onClick={() => handleToolbarAction("feedback-reject")}
            >
              {strings.feedbackReject}
            </button>
            <button
              onClick={() => handleToolbarAction("feedback-comment")}
            >
              {strings.feedbackComment}
            </button>
          </section>
        </main>
      </div>

      <footer className="footer">
        <span
          dangerouslySetInnerHTML={{ __html: strings.footerMainHtml }}
        />
        <div className="footer-links">
          <a href="#support">{strings.footerSupport}</a>
          <a href="#terms">{strings.footerTerms}</a>
          <a href="#privacy">{strings.footerPrivacy}</a>
        </div>
      </footer>
    </div>
  );
};
