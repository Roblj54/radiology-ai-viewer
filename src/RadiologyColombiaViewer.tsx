import React, { useMemo, useRef, useState } from 'react';
import { loadDicomFiles, displayImageWithViewport, getLoadedCount, ViewerViewport } from './dicomLoader';

type Lang = 'ES' | 'EN';

const WL_PRESETS = {
  soft: { windowCenter: 40, windowWidth: 400 },
  lung: { windowCenter: -600, windowWidth: 1500 },
  bone: { windowCenter: 300, windowWidth: 2000 },
};

export default function RadiologyColombiaViewer() {
  const viewportRef = useRef<HTMLDivElement | null>(null);

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
      lung: 'Pulmón',
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

  return (
    <div style={{ minHeight: '100vh', background: '#050914', color: '#e5e7eb', padding: 24 }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{t.title}</div>
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
          </button>
        </div>

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
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16 }}>
          <div>
            <div style={{ border: '1px solid #1f2a44', borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>{t.upload}</div>
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
                <input type="file" multiple accept=".dcm,application/dicom" onChange={onFiles} style={{ display: 'none' }} />
              </label>

              <div style={{ marginTop: 10, color: '#93a4b8', fontSize: 12 }}>
                {sliceCount ? t.loaded(sliceCount) : 'No series loaded yet.'}
              </div>
            </div>

            <div style={{ border: '1px solid #1f2a44', borderRadius: 12, padding: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.study}</div>
              <div style={{ color: '#93a4b8', fontSize: 12 }}>{t.patient}</div>
            </div>
          </div>

          <div style={{ border: '1px solid #1f2a44', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <button onClick={() => updateViewport({ invert: !vp.invert })}>{t.invert}</button>
              <button onClick={() => updateViewport({ rotation: ((vp.rotation ?? 0) + 90) % 360 })}>{t.rot}</button>
              <button onClick={() => updateViewport({ hflip: !vp.hflip })}>{t.flipH}</button>
              <button onClick={() => updateViewport({ vflip: !vp.vflip })}>{t.flipV}</button>

              <div style={{ width: 12 }} />

              <button onClick={() => updateViewport(WL_PRESETS.soft)}>{t.soft}</button>
              <button onClick={() => updateViewport(WL_PRESETS.lung)}>{t.lung}</button>
              <button onClick={() => updateViewport(WL_PRESETS.bone)}>{t.bone}</button>
            </div>

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
            />

            <div style={{ marginTop: 10 }}>
              <input
                type="range"
                min={0}
                max={Math.max(0, sliceCount - 1)}
                value={sliceIndex}
                onChange={(e) => goTo(parseInt(e.target.value, 10))}
                style={{ width: '100%' }}
                disabled={!sliceCount}
              />
              <div style={{ color: '#93a4b8', fontSize: 12, marginTop: 6 }}>
                {sliceCount ? t.slice(sliceIndex + 1, sliceCount) : t.slice(0, 0)}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        button{
          background:#0b1220;
          color:#e5e7eb;
          border:1px solid #334155;
          padding:6px 10px;
          border-radius:8px;
          cursor:pointer;
        }
        button:hover{ border-color:#64748b; }
        button:disabled{ opacity:0.5; cursor:not-allowed; }
      `}</style>
    </div>
  );
}
