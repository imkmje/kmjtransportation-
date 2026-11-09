// 그리기 호출 수와 틱·렌더 시간을 재는 점검(소프트웨어 렌더라 프레임 수는 참고용): npm run build 후 node scripts/perf-render.mjs
import { createRequire } from 'node:module';
import { preview } from 'vite';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await preview({ preview: { port: 4178, strictPort: true } });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4178/'); await page.waitForTimeout(1000);
await page.click('#t-start');
await page.click('#menubtn'); await page.click('#gridcity'); await page.waitForTimeout(300);
await page.click('button[data-speed="0"]');
const days = Number(process.argv[2] ?? 3);
const rows = [];
for (let d = 0; d <= days; d++) {
  const r = await page.evaluate(async (d) => {
    const g = window.__game; const s = g.sim;
    const t0 = performance.now();
    if (d > 0) { const end = s.tickCount + 20 * 3600; while (s.tickCount < end) s.step(); } // 시뮬 1시간(= 시계 하루)
    const simMs = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const info = g.renderInfo();
    const n = g.editor.network;
    return { day: d, buildings: n.buildings.size, vehicles: s.traffic.vehicles.size, calls: info.calls, triangles: info.triangles, simMsPerHour: Math.round(simMs), msPerTick: (simMs / (20 * 3600)).toFixed(2) };
  }, d);
  rows.push(r); console.log(JSON.stringify(r));
}
await browser.close(); server.httpServer.close();
