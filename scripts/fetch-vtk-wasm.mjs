#!/usr/bin/env node
/**
 * Download the Kitware vtk-wasm WebGL bundle into
 * platform/app/public/vtk-wasm/ for same-origin serving.
 *
 * Keeps the .tar.gz (preferred — embeds types/ for the method table) and also
 * extracts vtkWebAssembly.mjs/.wasm for optional directory loads.
 *
 * Usage (from Viewers repo root):
 *   node scripts/fetch-vtk-wasm.mjs
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT_DIR = path.resolve(__dirname, '../platform/app/public/vtk-wasm');
const BUNDLE_URL =
  process.env.VTK_WASM_BUNDLE_URL ||
  'https://raw.githack.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz';
const TAR_PATH = path.join(OUT_DIR, 'vtk-wasm32-emscripten.tar.gz');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Fetching ${BUNDLE_URL}`);
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(TAR_PATH, buf);
  console.log(`Wrote ${TAR_PATH} (${(buf.length / (1024 * 1024)).toFixed(1)} MiB)`);

  execFileSync('tar', ['-xzf', TAR_PATH, '-C', OUT_DIR], { stdio: 'inherit' });

  const mjs = path.join(OUT_DIR, 'vtkWebAssembly.mjs');
  const wasm = path.join(OUT_DIR, 'vtkWebAssembly.wasm');
  if (!fs.existsSync(mjs) || !fs.existsSync(wasm) || !fs.existsSync(TAR_PATH)) {
    throw new Error('Bundle incomplete after fetch/extract');
  }
  console.log(
    'Ready: point rendering.vtkWasm.url at /vtk-wasm/vtk-wasm32-emscripten.tar.gz (urlIsGzip: true).'
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
