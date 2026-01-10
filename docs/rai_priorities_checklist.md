# Radiology AI Viewer Priorities Checklist

## Priority 1: Dev workflow stability
- [ ] npm install succeeds
- [ ] npm run dev runs from repo root
- [ ] dev URL loads under /radiology-ai-viewer/

## Priority 2: GitHub Pages base path
- [ ] vite.config.mjs has base: '/radiology-ai-viewer/'
- [ ] npm run build succeeds
- [ ] npm run preview serves index at /radiology-ai-viewer/

## Priority 3: Viewer stability (uncompressed)
- [ ] No ReferenceError at runtime
- [ ] slice navigation and cine do not crash
- [ ] Safe defaults when no study loaded

## Priority 4: postMessage control bridge
- [ ] UI sends messages (WL/WW, zoom, pan, cine)
- [ ] React receives messages and updates canvas immediately
- [ ] UI reflects viewer state (optional but recommended)

## Priority 5: Input and study handling polish
- [ ] Multi-file selection works reliably
- [ ] Clear loading and error states
- [ ] Guardrails for unexpected file sets

## Priority 6: Compressed DICOM capability
- [ ] Decide library and approach
- [ ] Add decoding path without breaking uncompressed flow
- [ ] Add tests for compressed samples