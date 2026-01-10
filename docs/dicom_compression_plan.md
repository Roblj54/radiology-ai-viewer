# Compressed DICOM Support Plan (Placeholder)

## Goal
Add support for common compressed transfer syntaxes without breaking the current uncompressed mini-decoder flow.

## Recommended approach
- Keep uncompressed path as the default and always working.
- Detect transfer syntax and route to the correct decoder.
- Add a small set of known compressed test studies.

## Steps
1. Inventory which transfer syntaxes you see in real studies.
2. Choose a decoder strategy:
   - JS decoder libraries, or
   - WASM-based decoders, or
   - A proven viewer stack integration
3. Add decode tests and performance checks.
4. Add fallback and error messaging (never crash).

## Acceptance
- Uncompressed studies still load and render.
- Compressed studies render correctly.
- No runtime crashes.