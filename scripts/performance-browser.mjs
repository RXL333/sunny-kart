import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const endpoint = 'http://127.0.0.1:4183';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root, env: { ...process.env, PORT: '4183' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk; });
server.stderr.on('data', chunk => { serverOutput += chunk; });
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (!process.env.CI && existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
let browser;
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${serverOutput}`)), 15000);
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${serverOutput}`)); });
    server.stdout.on('data', () => { if (serverOutput.includes('listening on')) { clearTimeout(timeout); resolve(); } });
  });
  browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.addInitScript(() => localStorage.setItem('sunny-settings-v1', JSON.stringify({ graphics: 'smooth' })));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const modelRequests = [];
  page.on('request', request => { if (/\/models\/.*\.glb$/.test(request.url())) modelRequests.push(request.url()); });
  const began = performance.now();
  await page.goto(endpoint);
  await page.locator('.start-button').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.start-button')?.disabled);
  const firstPlayableMs = Math.round(performance.now() - began);
  const rendering = await page.evaluate(async () => {
    const gl = document.querySelector('#game').getContext('webgl2');
    if (!gl) throw new Error('WebGL2 renderer unavailable');
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const samples = [];
    await new Promise(resolve => {
      let last;
      const frame = now => { if (last !== undefined) samples.push(now - last); last = now; if (samples.length < 40) requestAnimationFrame(frame); else resolve(); };
      requestAnimationFrame(frame);
    });
    samples.sort((a, b) => a - b);
    return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      sampleFrames: samples.length, frameMedianMs: samples[Math.floor(samples.length * .5)], frameP95Ms: samples[Math.floor(samples.length * .95)] };
  });
  const switchTimes = [];
  for (const course of ['candy-hills', 'bay-loop', 'sunny-island']) {
    await page.locator('.course-picker-button').click();
    const start = performance.now();
    await page.locator(`[data-course="${course}"]`).click();
    await page.waitForFunction(() => !document.querySelector('.start-button')?.disabled);
    switchTimes.push({ course, readyMs: Math.round(performance.now() - start) });
  }
  const report = {
    measuredAt: new Date().toISOString(), browser: browser.version(), viewport: '960x540', quality: 'smooth',
    note: 'Cloud Chromium with SwiftShader software WebGL. Timings describe this machine and are not phone GPU performance or a before/after claim.',
    firstPlayableMs, ...rendering, switchTimes,
    modelNetworkRequests: modelRequests.length,
    resources: await page.evaluate(() => performance.getEntriesByType('resource').filter(item => /\/assets\/|\/models\//.test(item.name)).map(item => ({ path: new URL(item.name).pathname, bytes: item.transferSize, durationMs: Math.round(item.duration) }))),
    errors,
  };
  assert.deepEqual(errors, []);
  assert.equal(modelRequests.length, 3, 'Course switches must reuse the three already loaded model sources');
  await mkdir(new URL('logs/performance/', root), { recursive: true });
  await page.screenshot({ path: new URL('logs/performance/current-scene.png', root).pathname });
  await writeFile(new URL('logs/performance/current.json', root), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}
