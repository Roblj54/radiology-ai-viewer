import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  loadDicomFiles,
  displayImageWithViewport,
  LoadedSlice,
} from "./dicomLoader";

type Language = "es" | "en";
type WLPresetKey = "soft-tissue" | "lung" | "bone";

const WL_PRESETS: Record<
  WLPresetKey,
  { label: string; ww: number; wc: number }
> = {
  "soft-tissue": { label: "Soft tissue", ww: 400, wc: 40 },
  lung: { label: "Lung", ww: 1500, wc: -600 },
  bone: { label: "Bone", ww: 2000, wc: 300 },
};

interface ViewportState {
  index: number;
  invert: boolean;
  hflip: boolean;
  vflip: boolean;
  wlPreset: WLPresetKey;
}

const RadiologyColombiaViewer: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [language, setLanguage] = useState<Language>("es");
  const [stack, setStack] = useState<LoadedSlice[]>([]);
  const [viewport, setViewport] = useState<ViewportState>({
    index: 0,
    invert: false,
    hflip: false,
    vflip: false,
    wlPreset: "soft-tissue",
  });
  const [cinePlaying, setCinePlaying] = useState(false);
  const cineTimerRef = useRef<number | null>(null);

  const hasImages = stack.length > 0;
  const currentSlice = hasImages ? stack[viewport.index] : null;

  const currentPreset = useMemo(
    () => WL_PRESETS[viewport.wlPreset],
    [viewport.wlPreset]
  );

  const stopCine = useCallback(() => {
    if (cineTimerRef.current != null) {
      window.clearInterval(cineTimerRef.current);
      cineTimerRef.current = null;
    }
    setCinePlaying(false);
    console.log("Cine stopped");
  }, []);

  const goToSlice = useCallback(
    async (index: number) => {
      if (!hasImages) return;

      const clamped = Math.max(0, Math.min(stack.length - 1, index));
      const slice = stack[clamped];
      const element = canvasRef.current;
      if (!element || !slice) return;

      const state = {
        invert: viewport.invert,
        hflip: viewport.hflip,
        vflip: viewport.vflip,
        windowWidth: currentPreset.ww,
        windowCenter: currentPreset.wc,
      };

      console.log("[updateViewport]", {
        index: clamped,
        imageId: slice.imageId,
        ...state,
      });

      try {
        await displayImageWithViewport(element, slice.imageId, state);
      } catch (err) {
        console.error("display error", err);
        stopCine();
      }

      setViewport((prev) => ({ ...prev, index: clamped }));
    },
    [
      hasImages,
      stack,
      viewport.invert,
      viewport.hflip,
      viewport.vflip,
      currentPreset,
      stopCine,
    ]
  );

  const nextSlice = useCallback(() => {
    if (!hasImages) return;
    const next = viewport.index + 1;
    if (next >= stack.length) {
      goToSlice(0);
    } else {
      goToSlice(next);
    }
  }, [hasImages, viewport.index, stack.length, goToSlice]);

  const prevSlice = useCallback(() => {
    if (!hasImages) return;
    const prev = viewport.index - 1;
    if (prev < 0) {
      goToSlice(stack.length - 1);
    } else {
      goToSlice(prev);
    }
  }, [hasImages, viewport.index, stack.length, goToSlice]);

  const toggleCine = useCallback(() => {
    if (!hasImages) return;

    if (cinePlaying) {
      stopCine();
      return;
    }

    const fps = 10;
    const intervalMs = 1000 / fps;
    console.log("Cine started at", fps, "fps");
    setCinePlaying(true);

    cineTimerRef.current = window.setInterval(() => {
      nextSlice();
    }, intervalMs);
  }, [cinePlaying, hasImages, nextSlice, stopCine]);

  const applyViewportAndRedisplay = useCallback(() => {
    if (!hasImages) return;
    goToSlice(viewport.index);
  }, [hasImages, viewport.index, goToSlice]);

  const handleToolbarAction = useCallback(
    (action: string, value?: any) => {
      switch (action) {
        case "invert":
          setViewport((prev) => ({ ...prev, invert: !prev.invert }));
          break;
        case "flipH":
          setViewport((prev) => ({ ...prev, hflip: !prev.hflip }));
          break;
        case "flipV":
          setViewport((prev) => ({ ...prev, vflip: !prev.vflip }));
          break;
        case "rotate90":
          console.log("Rotate 90 requested (placeholder, no-op)");
          break;
        case "wl":
          setViewport((prev) => ({ ...prev, wlPreset: value as WLPresetKey }));
          break;
        case "cine":
          toggleCine();
          return;
        default:
          break;
      }
    },
    [toggleCine]
  );

  // Re-apply viewport when invert / flips / preset change
  useEffect(() => {
    if (!hasImages) return;
    applyViewportAndRedisplay();
  }, [
    viewport.invert,
    viewport.hflip,
    viewport.vflip,
    viewport.wlPreset,
    hasImages,
    applyViewportAndRedisplay,
  ]);

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const slices = loadDicomFiles(files);
    setStack(slices);
    setViewport((prev) => ({ ...prev, index: 0 }));
    stopCine();

    // Let React paint, then draw the first slice
    window.setTimeout(() => {
      goToSlice(0);
    }, 0);
  };

  // Expose a tiny debug API in the browser console as window.viewerController
  useEffect(() => {
    const global: any = window as any;
    global.viewerController = {
      setStackFromFiles(files: FileList | File[]) {
        const slices = loadDicomFiles(files);
        setStack(slices);
        setViewport((prev: ViewportState) => ({ ...prev, index: 0 }));
        stopCine();
        setTimeout(() => {
          goToSlice(0);
        }, 0);
      },
      goToSlice,
      nextSlice,
      prevSlice,
      toggleCine,
      toggleInvert() {
        setViewport((prev: ViewportState) => ({ ...prev, invert: !prev.invert }));
      },
    };

    return () => {
      if (global.viewerController) {
        delete global.viewerController;
      }
    };
  }, [goToSlice, nextSlice, prevSlice, toggleCine, stopCine]);

  const t = useCallback(
    (es: string, en: string) => (language === "es" ? es : en),
    [language]
  );

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-emerald-700 text-white flex items-center justify-between px-6 py-3 shadow">
        <div className="font-semibold tracking-wide">
          Radiology AI Colombia Health
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div className="flex rounded-full bg-emerald-900 px-1 py-0.5">
            <button
              className={`px-2 rounded-full ${
                language === "es" ? "bg-white text-emerald-700" : "text-white"
              }`}
              onClick={() => setLanguage("es")}
            >
              ES
            </button>
            <button
              className={`px-2 rounded-full ${
                language === "en" ? "bg-white text-emerald-700" : "text-white"
              }`}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
          </div>
          <span className="text-xs bg-emerald-600 px-3 py-1 rounded-full">
            {t("Analista de radiologia", "Radiology analyst")}
          </span>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-4 border-b border-slate-200">
            <div className="text-xs font-semibold text-slate-500 mb-2">
              {t("ESTUDIOS", "STUDIES")}
            </div>
            <label className="block border border-dashed border-emerald-400 rounded-lg p-3 text-center text-xs cursor-pointer hover:bg-emerald-50">
              <span className="font-medium text-emerald-700">
                {t("Cargar DICOM", "Upload DICOM")}
              </span>
              <span className="block mt-1 text-[11px] text-slate-500">
                {t(
                  "Arrastra y suelta archivos o haz clic para buscar",
                  "Drag and drop DICOM files or click to browse"
                )}
              </span>
              <input
                type="file"
                multiple
                accept=".dcm,application/dicom"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </div>

          <div className="flex-1 overflow-auto p-4">
            <div className="text-xs font-semibold text-slate-500 mb-1">
              {t("LISTA DE ESTUDIOS", "STUDY LIST")}
            </div>
            {hasImages ? (
              <div className="space-y-2">
                <div className="border border-emerald-500 rounded-md px-2 py-1 text-xs bg-emerald-50">
                  <div className="font-semibold">
                    {t("Paciente 001 - CT Tórax", "Patient 001 - CT Chest")}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {stack.length} {t("cortes DICOM", "DICOM slices")}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                {t(
                  "No hay estudios cargados. Carga una serie DICOM para comenzar.",
                  "No studies loaded. Upload a DICOM series to begin."
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Main viewer */}
        <main className="flex-1 flex flex-col">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-slate-200">
            <div className="flex items-center gap-2">
              <button
                className="px-3 py-1 text-xs border rounded-full hover:bg-slate-100"
                onClick={() => handleToolbarAction("invert")}
              >
                Invert
              </button>
              <button
                className="px-3 py-1 text-xs border rounded-full hover:bg-slate-100"
                onClick={() => handleToolbarAction("rotate90")}
              >
                Rotate 90
              </button>
              <button
                className="px-3 py-1 text-xs border rounded-full hover:bg-slate-100"
                onClick={() => handleToolbarAction("flipH")}
              >
                Flip H
              </button>
              <button
                className="px-3 py-1 text-xs border rounded-full hover:bg-slate-100"
                onClick={() => handleToolbarAction("flipV")}
              >
                Flip V
              </button>

              <div className="ml-4 flex gap-1">
                {(Object.keys(WL_PRESETS) as WLPresetKey[]).map((key) => (
                  <button
                    key={key}
                    className={`px-3 py-1 text-xs border rounded-full ${
                      viewport.wlPreset === key
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "hover:bg-slate-100"
                    }`}
                    onClick={() => handleToolbarAction("wl", key)}
                  >
                    {WL_PRESETS[key].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px]">
              <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">
                {t("Conectado al motor de IA", "Connected to AI engine")}
              </span>
              <span className="px-2 py-1 rounded-full bg-sky-100 text-sky-700">
                {t(
                  "Modo colaborativo con radiologo",
                  "Collaborative mode with radiologist"
                )}
              </span>
              <button
                className={`px-3 py-1 text-xs border rounded-full ${
                  cinePlaying ? "bg-slate-800 text-white" : "hover:bg-slate-100"
                }`}
                onClick={() => handleToolbarAction("cine")}
                disabled={!hasImages}
              >
                Cine
              </button>
              <button
                className="px-3 py-1 text-xs rounded-full bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                disabled={!hasImages}
              >
                {t("Analizar con IA", "Analyze with AI")}
              </button>
            </div>
          </div>

          {/* Image area */}
          <div className="flex-1 bg-slate-900 relative flex items-center justify-center">
            <div
              ref={canvasRef}
              className="w-[80%] h-[80%] bg-black rounded-lg overflow-hidden shadow-inner relative"
            />
            {hasImages && (
              <div className="absolute top-4 left-4 text-xs text-white bg-sky-600/80 px-3 py-1 rounded-full">
                CT
              </div>
            )}
            {hasImages && (
              <div className="absolute top-4 right-4 text-xs text-red-100 bg-red-600/90 px-3 py-1 rounded-full">
                {t(
                  "IA: Posible neumonia, revisar zonas marcadas",
                  "AI: Possible pneumonia. Review highlighted areas."
                )}
              </div>
            )}
            {!hasImages && (
              <div className="text-sm text-slate-300">
                {t(
                  "Carga una serie DICOM para visualizar las imagenes.",
                  "Upload a DICOM series to view images."
                )}
              </div>
            )}
          </div>

          {/* Bottom panel */}
          <div className="bg-white border-t border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3 text-xs text-slate-600">
                <span>{t("Paciente", "Patient")}: 001</span>
                <span className="text-slate-400">|</span>
                <span>{t("Estudio", "Study")}: CT Chest</span>
                <span className="text-slate-400">|</span>
                <span>
                  {t("Serie", "Series")} 1
                </span>
                {hasImages && (
                  <>
                    <span className="text-slate-400">|</span>
                    <span>
                      {viewport.index + 1} / {stack.length} slices
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-500">{t("Cortes", "Slices")}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, stack.length - 1)}
                  value={viewport.index}
                  disabled={!hasImages}
                  className="w-64 accent-emerald-600"
                  onChange={(e) => goToSlice(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 mr-2">
                {t(
                  "Retroalimentacion del radiologo",
                  "Radiologist feedback"
                )}
              </span>
              <button className="px-3 py-1 text-xs rounded-full bg-emerald-600 text-white hover:bg-emerald-700">
                {t("Aceptar hallazgos de IA", "Accept AI findings")}
              </button>
              <button className="px-3 py-1 text-xs rounded-full bg-red-500 text-white hover:bg-red-600">
                {t("Rechazar hallazgos de IA", "Reject AI findings")}
              </button>
              <button className="px-3 py-1 text-xs rounded-full border border-slate-300 hover:bg-slate-100">
                {t("Agregar comentario", "Add comment")}
              </button>
            </div>
          </div>
        </main>
      </div>

      <footer className="px-4 py-2 text-[11px] text-slate-400 bg-slate-50 border-t border-slate-200">
        Radiology AI 1.0 EPS Colombia integration
      </footer>
    </div>
  );
};

export default RadiologyColombiaViewer;
