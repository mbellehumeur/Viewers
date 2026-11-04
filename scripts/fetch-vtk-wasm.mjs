#!/usr/bin/env node
/**
 * Download Kitware vtk-wasm bundles into platform/app/public/vtk-wasm/ for
 * same-origin serving:
 *
 *   jspi/   — dist/latest (unified JSPI; PC / Chromium / JSPI Android)
 *   compat/ — releases/9.7.0 split (non-JSPI sync WebGL; iOS Safari)
 *
 * Usage (from Viewers repo root):
 *   node scripts/fetch-vtk-wasm.mjs
 *
 * Env overrides:
 *   VTK_WASM_JSPI_BUNDLE_URL
 *   VTK_WASM_COMPAT_BUNDLE_URL
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '../platform/app/public/vtk-wasm');

const JSPI_URL =
  process.env.VTK_WASM_JSPI_BUNDLE_URL ||
  'https://raw.githubusercontent.com/Kitware/vtk-wasm/dist/latest/vtk-wasm32-emscripten.tar.gz';

const COMPAT_URL =
  process.env.VTK_WASM_COMPAT_BUNDLE_URL ||
  'https://raw.githubusercontent.com/Kitware/vtk-wasm/dist/releases/9.7.0/vtk-9.7.0-wasm32-emscripten.tar.gz';

const BUNDLES = [
  {
    id: 'jspi',
    url: JSPI_URL,
    outDir: path.join(OUT_ROOT, 'jspi'),
    tarName: 'vtk-wasm32-emscripten.tar.gz',
    requireSuspending: true,
    requireAsyncBinary: false,
  },
  {
    id: 'compat',
    url: COMPAT_URL,
    outDir: path.join(OUT_ROOT, 'compat'),
    tarName: 'vtk-9.7.0-wasm32-emscripten.tar.gz',
    requireSuspending: false,
    requireAsyncBinary: true,
  },
];

async function fetchBundle({
  id,
  url,
  outDir,
  tarName,
  requireSuspending,
  requireAsyncBinary,
}) {
  fs.mkdirSync(outDir, { recursive: true });
  const tarPath = path.join(outDir, tarName);
  console.log(`[${id}] Fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[${id}] Fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tarPath, buf);
  console.log(
    `[${id}] Wrote ${tarPath} (${(buf.length / (1024 * 1024)).toFixed(1)} MiB)`
  );

  execFileSync('tar', ['-xzf', tarName], {
    cwd: outDir,
    stdio: 'inherit',
  });

  const mjs = path.join(outDir, 'vtkWebAssembly.mjs');
  const wasm = path.join(outDir, 'vtkWebAssembly.wasm');
  if (!fs.existsSync(mjs) || !fs.existsSync(wasm) || !fs.existsSync(tarPath)) {
    throw new Error(`[${id}] Bundle incomplete after fetch/extract`);
  }

  const glue = fs.readFileSync(mjs, 'utf8');
  const hasSuspending = glue.includes('WebAssembly.Suspending');
  if (requireSuspending && !hasSuspending) {
    throw new Error(
      `[${id}] Expected JSPI glue (WebAssembly.Suspending) in vtkWebAssembly.mjs`
    );
  }
  if (!requireSuspending && hasSuspending) {
    throw new Error(
      `[${id}] Expected non-JSPI sync glue, but found WebAssembly.Suspending`
    );
  }

  if (requireAsyncBinary) {
    const asyncMjs = path.join(outDir, 'vtkWebAssemblyAsync.mjs');
    const asyncWasm = path.join(outDir, 'vtkWebAssemblyAsync.wasm');
    if (!fs.existsSync(asyncMjs) || !fs.existsSync(asyncWasm)) {
      throw new Error(
        `[${id}] Expected vtkWebAssemblyAsync.{mjs,wasm} in split compat bundle`
      );
    }
  }

  console.log(
    `[${id}] OK suspending=${hasSuspending} → /vtk-wasm/${id}/${tarName}`
  );
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  for (const bundle of BUNDLES) {
    await fetchBundle(bundle);
  }
  console.log(
    'Ready: JSPI browsers use /vtk-wasm/jspi/…; non-JSPI use /vtk-wasm/compat/…'
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
