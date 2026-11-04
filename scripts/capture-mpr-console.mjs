/**
 * Capture vtkWasm console logs from the MPR viewer.
 * Usage: node scripts/capture-mpr-console.mjs
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

const url =
  process.env.MPR_URL ||
  'http://localhost:3000/viewer?StudyInstanceUIDs=1.2.840.113704.1.111.6232.1780654237.1&hangingProtocolId=mpr';

const waitMs = Number(process.env.MPR_WAIT_MS || 45000);
const minPresentLogs = Number(process.env.MPR_MIN_PRESENT || 3);
const minMeanLuminance = Number(process.env.MPR_MIN_LUMINANCE || 8);

const localAppData = process.env.LOCALAPPDATA || '';
const chromiumDir = path.join(localAppData, 'ms-playwright', 'chromium-1194', 'chrome-win64');
const chromeExeCandidates = [
  path.join(chromiumDir, 'chrome.exe'),
  'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
];

const executablePath = chromeExeCandidates.find((p) => fs.existsSync(p));

const logs = [];
const interesting = [];

function isInteresting(text) {
  return /vtkWasm|MPR |ImageMapper|ImageReslice|heap\.alloc|null function|scalars ready/i.test(
    text
  );
}

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

const page = await browser.newPage();
page.on('console', (msg) => {
  const text = msg.text();
  const line = `[${msg.type()}] ${text}`;
  logs.push(line);
  if (isInteresting(text)) {
    interesting.push(line);
    console.log(line);
  }
});
page.on('pageerror', (err) => {
  const line = `[pageerror] ${err.message}`;
  logs.push(line);
  interesting.push(line);
  console.log(line);
});

console.log(`Navigating to ${url}`);
console.log(`Using browser: ${executablePath || 'playwright default'}`);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

const deadline = Date.now() + waitMs;
while (Date.now() < deadline) {
  const presentCount = interesting.filter((l) => /MPR present/i.test(l)).length;
  if (presentCount >= minPresentLogs) {
    await page.waitForTimeout(3000);
    break;
  }
  await page.waitForTimeout(1000);
}

const viewportStats = await page.evaluate(() => {
  const cpuCanvases = Array.from(
    document.querySelectorAll('canvas.vtk-wasm-planar-canvas-cpu')
  );
  const overlays = Array.from(document.querySelectorAll('[class*="ViewportOverlay"], .viewport-overlay'));
  const overlayText = overlays.map((el) => el.textContent || '').join('\n');
  const wMatch = overlayText.match(/W:\s*([\d.]+)/g) || [];
  const lMatch = overlayText.match(/L:\s*([\d.]+)/g) || [];

  return {
    cpuCanvasCount: cpuCanvases.length,
    overlayWindowLevels: wMatch.slice(0, 6),
    overlayLevels: lMatch.slice(0, 6),
  };
});

const luminanceStats = await page.$$eval(
  'canvas.vtk-wasm-planar-canvas-cpu',
  (canvases) =>
    canvases.map((canvas, index) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return { index, mean: 0, nonBlackRatio: 0, width: canvas.width, height: canvas.height };
      }
      const w = canvas.width;
      const h = canvas.height;
      const cropW = Math.max(1, Math.floor(w * 0.5));
      const cropH = Math.max(1, Math.floor(h * 0.5));
      const x0 = Math.floor((w - cropW) / 2);
      const y0 = Math.floor((h - cropH) / 2);
      const imageData = ctx.getImageData(x0, y0, cropW, cropH);
      const { data } = imageData;
      let sum = 0;
      let nonBlack = 0;
      const pixels = cropW * cropH;
      for (let i = 0; i < data.length; i += 4) {
        const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
        sum += lum;
        if (lum > 2) {
          nonBlack += 1;
        }
      }
      return {
        index,
        mean: pixels ? sum / pixels : 0,
        nonBlackRatio: pixels ? nonBlack / pixels : 0,
        width: w,
        height: h,
      };
    })
);

const presentCount = interesting.filter((l) => /MPR present/i.test(l)).length;
const meanLuminance =
  luminanceStats.length > 0
    ? luminanceStats.reduce((acc, s) => acc + s.mean, 0) / luminanceStats.length
    : 0;
const assertions = {
  presentLogs: presentCount >= minPresentLogs,
  cpuCanvasCount: viewportStats.cpuCanvasCount >= minPresentLogs,
  meanLuminance: meanLuminance >= minMeanLuminance,
};
const passed = Object.values(assertions).every(Boolean);

const outDir = path.join(os.tmpdir(), 'vtk-wasm-mpr-capture');
fs.mkdirSync(outDir, { recursive: true });
const shot = path.join(outDir, 'mpr.png');
const logFile = path.join(outDir, 'console.txt');
const reportFile = path.join(outDir, 'report.json');

await page.screenshot({ path: shot, fullPage: true });

const report = {
  url,
  passed,
  assertions,
  presentCount,
  viewportStats,
  luminanceStats,
  meanLuminance,
};

fs.writeFileSync(
  logFile,
  [
    `report: ${JSON.stringify(report, null, 2)}`,
    '',
    ...interesting,
    '',
    '--- all ---',
    ...logs,
  ].join('\n'),
  'utf8'
);
fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');

console.log(`\nScreenshot: ${shot}`);
console.log(`Logs: ${logFile}`);
console.log(`Report: ${reportFile}`);
console.log(`Interesting lines: ${interesting.length}`);
console.log(`MPR present logs: ${presentCount}`);
console.log(`CPU canvases: ${viewportStats.cpuCanvasCount}`);
console.log(`Mean center luminance: ${meanLuminance.toFixed(1)}`);
console.log(`Overlay W: ${viewportStats.overlayWindowLevels.join(', ') || 'n/a'}`);
console.log(`Overlay L: ${viewportStats.overlayLevels.join(', ') || 'n/a'}`);
console.log(`Assertions: ${JSON.stringify(assertions)}`);
console.log(passed ? 'PASS' : 'FAIL');

await browser.close();
process.exitCode = passed ? 0 : 1;
