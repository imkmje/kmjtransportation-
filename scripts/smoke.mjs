// 실제 브라우저로 빌드 결과를 열어 기본 동작을 확인한다. 사용: npm run build && npm run smoke
import { createRequire } from 'node:module';
import { preview } from 'vite';
const { chromium } = createRequire(import.meta.url)('playwright');

const server = await preview({ preview: { port: 4173, strictPort: true } });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
// 새 화면 구성: 도구는 아래쪽 분류 상자 안에, 저장·불러오기 등은 오른쪽 위 메뉴 안에 있다. 클릭하기 전에 알맞은 상자·메뉴를 열어 주는 보조 장치
const patch = (pg) => {
  const click = pg.click.bind(pg), sel = pg.selectOption.bind(pg);
  const menuIds = /^#(save|load|export|import|sample|newcity|gridcity|hillcity|terraincity|terrainType|slot|about)$/;
  const prep = async (s) => {
    if (menuIds.test(s)) { if (!(await pg.locator('#filebar').isVisible())) await click('#menubtn'); }
    else if (s.startsWith('button[data-tool=')) {
      const cat = await pg.evaluate((q) => document.querySelector(q)?.closest('[data-cat]')?.dataset.cat ?? null, s);
      if (cat && !(await pg.locator(`#sub-${cat}`).isVisible())) await click(`button[data-catbtn="${cat}"]`);
    } else if (/^#(grid|ortho|angle|heat|shadow|trees|cb|debugToggle|count|clearveh|sgreen)$/.test(s)) {
      const cat = await pg.evaluate((q) => document.querySelector(q)?.closest('[data-cat]')?.dataset.cat ?? null, s);
      if (cat && !(await pg.locator(`#sub-${cat}`).isVisible())) await click(`button[data-catbtn="${cat}"]`);
    }
  };
  pg.click = async (s, o) => { await prep(s); return click(s, o); };
  pg.selectOption = async (s, v, o) => { await prep(s); return sel(s, v, o); };
};
patch(page);
await page.addInitScript(() => { try { localStorage.setItem('shadows', '0'); localStorage.setItem('trees', '0'); } catch { /* 무시 */ } }); // 소프트웨어 렌더에서는 그림자가 너무 느려 점검 시간 기준이 어긋난다
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) fails.push(name); };

await page.goto('http://localhost:4173/');
await page.waitForSelector('canvas');
await page.waitForTimeout(1500);

// ---- 시작 화면 ----
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-title.png') });
await page.click('#title details.histwrap > summary'); // 업데이트 내역은 접혀 있다
const titleText = await page.locator('#title').innerText();
check('시작 화면: 제목·버전·업데이트 내역(최신 버전)이 보임', (await page.locator('#title').isVisible()) && titleText.includes('교통 시뮬레이션') && titleText.includes('v2.3.0') && titleText.includes('업데이트 내역') && titleText.includes('그림자'), titleText.slice(0, 120).replace(/\n/g, ' '));
const tk0 = await page.evaluate(() => window.__game.sim.tickCount);
await page.waitForTimeout(600);
check('시작 화면이 떠 있는 동안 시간이 멈춰 있음', (await page.evaluate(() => window.__game.sim.tickCount)) === tk0);
await page.click('#t-start');
check('시작하기를 누르면 화면이 닫히고 시간이 흐름', !(await page.locator('#title').isVisible()) && await page.waitForFunction((t) => window.__game.sim.tickCount > t, tk0, { timeout: 3000 }).then(() => true).catch(() => false));
await page.click('#about');
check('업데이트 내역 버튼으로 다시 열면 멈춤', (await page.locator('#title').isVisible()) && (await page.evaluate(() => window.__game.getSpeed())) === 0);
await page.click('#t-start');
check('사고·날씨 이벤트는 기본으로 꺼져 있음', !(await page.evaluate(() => window.__game.sim.traffic.eventsOn)));
await page.keyboard.press('f');
check('F 키로 사고·날씨를 켬', (await page.evaluate(() => window.__game.sim.traffic.eventsOn)) && (await page.locator('#msg').innerText()).includes('켰습니다'), await page.locator('#msg').innerText());
await page.keyboard.press('f'); // 이후 검사는 꺼진 상태에서
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-start.png') });
// ---- 화면 구성(시티즈 스카이라인식): 위쪽 바, 아래쪽 분류 버튼, 위로 열리는 도구 상자 ----
check('위쪽 바: 시계·배속·메뉴 버튼이 있음', (await page.locator('#hud #clock').isVisible()) && (await page.locator('#hud button[data-speed]').count()) === 4 && (await page.locator('#menubtn').isVisible()));
check('아래쪽 분류 버튼 7개(도로·구역·교통·시설·철거·보기·도구)', (await page.locator('#toolbar .cats button[data-catbtn], #toolbar .cats button[data-tool="demolish"]').count()) === 7);
await page.click('button[data-catbtn="road"]');
check('분류를 누르면 도구 상자가 열림', await page.locator('#sub-road').isVisible() && !(await page.locator('#sub-zone').isVisible()));
await page.click('button[data-catbtn="road"]');
check('다시 누르면 닫힘', !(await page.locator('#sub-road').isVisible()));

check('캔버스 존재', (await page.locator('canvas').count()) === 1);
check('버전 표시', /v\d+\.\d+\.\d+/.test(await page.locator('#version').innerText()), await page.locator('#version').innerText());
check('시계 표시(1일차 월요일)', (await page.locator('#clock').innerText()).startsWith('1일차 월요일'), await page.locator('#clock').innerText());

const ticks = () => page.evaluate(() => window.__game.sim.tickCount);
const t1 = await ticks();
await page.waitForTimeout(1000);
const t2 = await ticks();
check('1×에서 약 1초에 20 tick', t2 - t1 >= 15 && t2 - t1 <= 25, `(${t2 - t1} tick)`);

await page.click('button[data-speed="4"]');
const t3 = await ticks();
await page.waitForTimeout(1000);
const t4 = await ticks();
check('4×에서 약 1초에 80 tick', t4 - t3 >= 55 && t4 - t3 <= 90, `(${t4 - t3} tick)`);

await page.click('button[data-speed="0"]');
const t5 = await ticks();
await page.waitForTimeout(500);
check('일시정지', (await ticks()) === t5);

await page.click('button[data-speed="2"]');
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
check('탭 숨김 시 자동 일시정지', (await page.evaluate(() => window.__game.getSpeed())) === 0);
await page.waitForTimeout(200);
check('자동 일시정지 안내 문구', (await page.locator('#note').innerText()).includes('자동 일시정지'));

// ---- 새 도시: 외부에서 들어오는 철거 불가 도로 하나로 시작 ----
const startInfo = await page.evaluate(() => { const n = window.__game.editor.network; return { s: n.segments.size, locked: [...n.segments.values()].every((x) => x.locked), b: [...n.buildings.values()].map((b) => b.kind) }; });
check('새 도시: 잠긴 도로 1개와 외부 연결점 1개', startInfo.s === 1 && startInfo.locked && startInfo.b.join() === 'external', JSON.stringify(startInfo));
await page.click('button[data-tool="demolish"]');
{
  const p0 = await page.evaluate(() => window.__game.project({ x: 0, y: -500 }));
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.click(p0.x, p0.y);
}
check('외부 연결 도로는 철거할 수 없다(쉬운 안내)', (await page.locator('#msg').innerText()).includes('철거할 수 없습니다') && (await page.evaluate(() => window.__game.editor.network.segments.size)) === 1, await page.locator('#msg').innerText());
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// 이후 검사들은 빈 지도에서 시작한다
await page.evaluate(() => {
  const g = window.__game;
  g.editor.loadData({ formatVersion: 11, nextNodeId: 1, nextSegmentId: 1, nodes: [], segments: [], nextBuildingId: 1, buildings: [], zones: [] });
  g.editor.resetHistory(); g.sim.reset(); g.focus({ x: 0, y: 0 });
});
await page.waitForTimeout(200);

// ---- 2단계: 도로 건설 (드래그) ----
const counts = () => page.evaluate(() => ({ n: window.__game.editor.network.nodes.size, s: window.__game.editor.network.segments.size }));
const toScreen = (x, y) => page.evaluate(([x, y]) => window.__game.project({ x, y }), [x, y]);
// 화면 위 도구 모음·통계 패널에 가려지지 않는 지점을 후보 중에서 고른다(패널이 지도 일부를 덮기 때문)
const freeSpot = async (cands) => {
  for (const [x, y] of cands) {
    const p = await toScreen(x, y);
    if (p.x > 80 && p.x < 980 && p.y > 110 && p.y < 430) return [x, y];
  }
  throw new Error('가려지지 않는 지점이 없음');
};
const clickWorld = async (x, y) => {
  const p = await toScreen(x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
};
// 누른 채로 끌기. release=false면 버튼을 누른 채로 두어 "그리는 중" 화면을 확인할 수 있다
const dragWorld = async (x1, y1, x2, y2, release = true) => {
  const a = await toScreen(x1, y1), b = await toScreen(x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  if (release) { await page.mouse.up(); await page.waitForTimeout(80); } else await page.waitForTimeout(100);
};

await page.click('button[data-tool="road2"]');
await dragWorld(-100, 0, 100, 0, false);
check('그리는 중 길이 표시', /^200 m$/.test(await page.locator('#tip').innerText()), await page.locator('#tip').innerText());
await page.mouse.up();
await page.waitForTimeout(80);
let c = await counts();
check('드래그로 도로 1개 건설(노드 2, 도로 1)', c.n === 2 && c.s === 1, JSON.stringify(c));

await dragWorld(0, -60, 0, 100);
c = await counts();
check('십자 교차(노드 5, 도로 4)', c.n === 5 && c.s === 4, JSON.stringify(c));

const [bx, by] = await freeSpot([[-60, -160], [60, 160], [-160, 60], [160, -60], [0, 200], [0, -200]]);
await dragWorld(bx, by, bx, by + 5, false);
check('잘못된 입력은 빨간 안내', (await page.locator('#tip').innerText()).includes('시작점과 같은') && (await page.locator('#tip').getAttribute('class')) === 'bad');
await page.mouse.up();
await page.waitForTimeout(80);
check('잘못된 드래그는 건설되지 않음', (await counts()).s === 4);

await dragWorld(160, 200, 260, 200, false);
await page.keyboard.press('Escape'); // 그리는 중 Esc = 취소
await page.mouse.up();
await page.waitForTimeout(80);
check('드래그 중 Esc로 취소', (await counts()).s === 4);
await page.click('button[data-tool="road2"]'); // Esc가 도구도 해제했을 수 있으니 다시 선택
if (!(await page.locator('button[data-tool="road2"].on').count())) await page.click('button[data-tool="road2"]');

await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-roads.png') });

await page.keyboard.press('Control+z');
c = await counts();
check('실행 취소: 십자 건설 한 번이 통째로 되돌아감(도로 4→1)', c.s === 1 && c.n === 2, JSON.stringify(c));
await page.keyboard.press('Control+y');
c = await counts();
check('다시 실행(도로 1→4)', c.s === 4, JSON.stringify(c));

await page.click('#save');
await page.waitForTimeout(300);
check('슬롯 저장 안내', (await page.locator('#msg').innerText()).includes('저장했습니다'), await page.locator('#msg').innerText());
await page.keyboard.press('x');
await clickWorld(50, 0);
c = await counts();
check('철거(도로 4→3)', c.s === 3, JSON.stringify(c));
await page.click('#load');
await page.waitForTimeout(300);
c = await counts();
check('슬롯 불러오기(도로 3→4)', c.s === 4 && c.n === 5, JSON.stringify(c));
await page.keyboard.press('Control+z');
c = await counts();
check('불러오기도 실행 취소 가능(도로 4→3)', c.s === 3, JSON.stringify(c));
await page.keyboard.press('Escape');

// 카메라가 움직였는지(이동·회전 모두) 보려면 원점에서 떨어진 점 여러 개를 본다. 회전은 원점을 제자리에 두기 때문에 원점만 보면 놓친다
const refPts = () => page.evaluate(() => [[300, 0], [0, 300], [-300, 0], [0, 0]].map(([x, y]) => window.__game.project({ x, y })));
const moved = (a, b) => Math.max(...a.map((p, i) => Math.hypot(b[i].x - p.x, b[i].y - p.y)));

// 도로 도구에서 왼쪽 드래그는 그리기이고 카메라는 이동도 회전도 하지 않는다. 가운데 버튼 = 이동, 오른쪽 버튼 = 회전
await page.click('button[data-tool="road2"]');
const camBefore = await refPts();
const segsBeforeDrag = (await counts()).s;
await page.mouse.move(400, 560);
await page.mouse.down();
await page.mouse.move(520, 600, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
check('도로 도구의 왼쪽 드래그는 카메라를 움직이지도 돌리지도 않음', moved(camBefore, await refPts()) < 1, String(moved(camBefore, await refPts())));
if ((await counts()).s > segsBeforeDrag) await page.keyboard.press('Control+z'); // 그려진 도로는 되돌려 다음 시나리오를 같게 유지

const camPan0 = await refPts();
await page.mouse.move(640, 300);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(740, 330, { steps: 6 });
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(400);
const camPan1 = await refPts();
check('가운데 버튼 드래그는 화면 이동', moved(camPan0, camPan1) > 20, String(moved(camPan0, camPan1)));

await page.mouse.move(640, 300);
await page.mouse.down({ button: 'right' });
await page.mouse.move(700, 320, { steps: 6 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(400);
const camRot1 = await refPts();
check('오른쪽 버튼 드래그는 회전(원점 기준 회전이라 먼 점이 움직임)', moved(camPan1, camRot1) > 20, String(moved(camPan1, camRot1)));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// ---- 터치 화면: 한 손가락으로 도로를 그릴 때 카메라가 같이 돌아가면 안 된다 ----
{
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  const tp = await tctx.newPage();
  patch(tp);
  const cdp = await tctx.newCDPSession(tp);
  await tp.goto('http://localhost:4173/');
  await tp.waitForSelector('canvas');
  await tp.click('#t-start');
  await tp.click('button[data-speed="0"]');
  const tref = () => tp.evaluate(() => [[300, 0], [0, 300], [-300, 0], [0, 0]].map(([x, y]) => window.__game.project({ x, y })));
  const tsegs = () => tp.evaluate(() => window.__game.editor.network.segments.size);
  const tt = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tbase = await tsegs(); // 새 도시는 외부 연결 도로 1개로 시작
  await tp.click('button[data-tool="road2"]');
  let t0 = await tref();
  await tt('touchStart', [{ x: 500, y: 220 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 500 + i * 25, y: 220 + i * 5 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(400);
  check('터치: 한 손가락 드래그로 도로가 그려짐', (await tsegs()) === tbase + 1, String(await tsegs()));
  check('터치: 도로를 그리는 동안 카메라가 이동도 회전도 안 함', moved(t0, await tref()) < 1, String(moved(t0, await tref())));
  await tp.keyboard.press('Escape');
  t0 = await tref();
  await tt('touchStart', [{ x: 500, y: 300 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 500 + i * 15, y: 300 + i * 5 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(500);
  check('터치: 도구가 없을 때 한 손가락 드래그는 화면 이동', moved(t0, await tref()) > 20 && (await tsegs()) === tbase + 1, String(moved(t0, await tref())));
  t0 = await tref();
  await tt('touchStart', [{ x: 560, y: 360 }, { x: 720, y: 360 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 560 - i * 15, y: 360 }, { x: 720 + i * 15, y: 360 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(500);
  check('터치: 두 손가락 벌리기는 확대', moved(t0, await tref()) > 20, String(moved(t0, await tref())));
  // 두 손가락 비틀기 = 회전(손가락이 시계 방향으로 돌면 지도도 같은 방향으로 돈다)
  await tp.evaluate(() => window.__game.focus({ x: 0, y: 0 }));
  await tp.waitForTimeout(300);
  const trot = () => tp.evaluate(() => { const q = window.__game.project({ x: 0, y: 300 }); return Math.atan2(q.y - 360, q.x - 640); });
  const a0 = await trot();
  const at = (a) => [{ x: 640 + 80 * Math.cos(a), y: 360 + 80 * Math.sin(a) }, { x: 640 - 80 * Math.cos(a), y: 360 - 80 * Math.sin(a) }];
  await tt('touchStart', at(0));
  for (let i = 1; i <= 10; i++) { await tt('touchMove', at(i * 0.1)); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(400);
  const dRot = ((await trot()) - a0 + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  check('터치: 두 손가락 비틀기는 같은 방향으로 회전', dRot > 0.3 && dRot < 1.2, dRot.toFixed(2));
  // 두 손가락을 같이 위로 밀면 기울기가 커지고(눕는다), 아래로 밀면 줄어든다
  const tilt0 = await tp.evaluate(() => window.__game.getTilt());
  await tt('touchStart', [{ x: 560, y: 420 }, { x: 720, y: 420 }]);
  for (let i = 1; i <= 12; i++) { await tt('touchMove', [{ x: 560, y: 420 - i * 10 }, { x: 720, y: 420 - i * 10 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(300);
  const tilt1 = await tp.evaluate(() => window.__game.getTilt());
  check('터치: 두 손가락을 위로 밀면 기울기가 바뀜', tilt1 - tilt0 > 5, `${tilt0.toFixed(0)} → ${tilt1.toFixed(0)}`);
  // 두 손가락을 같이 오른쪽으로 끌면 지도가 손가락을 따라 오른쪽으로 움직인다
  const o0 = await tp.evaluate(() => window.__game.project({ x: 0, y: 0 }));
  await tt('touchStart', [{ x: 400, y: 360 }, { x: 560, y: 360 }]);
  for (let i = 1; i <= 12; i++) { await tt('touchMove', [{ x: 400 + i * 12, y: 360 }, { x: 560 + i * 12, y: 360 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(300);
  const o1 = await tp.evaluate(() => window.__game.project({ x: 0, y: 0 }));
  check('터치: 두 손가락을 좌우로 끌면 지도가 손가락을 따라 이동', o1.x - o0.x > 60 && Math.abs(o1.y - o0.y) < 40, `${(o1.x - o0.x).toFixed(0)}, ${(o1.y - o0.y).toFixed(0)}`);
  await tctx.close();
}

// ---- 4단계: 정지·양보 표지 ----
const signCount = (kind) => page.evaluate((k) => [...window.__game.editor.network.segments.values()].filter((s) => s.signA === k || s.signB === k).length, kind);
await page.keyboard.press('s');
await clickWorld(-95, 0); // 막다른 끝 근처: 교차로가 아니라 거부
check('교차로가 아닌 곳에는 표지를 못 놓음', (await page.locator('#msg').innerText()).includes('교차로') && (await signCount('stop')) === 0, await page.locator('#msg').innerText());
await clickWorld(-20, 0); // 서쪽 팔의 교차로 쪽
check('정지 표지 설치', (await signCount('stop')) === 1, String(await signCount('stop')));
await clickWorld(-20, 0);
check('같은 곳을 다시 누르면 표지 제거', (await signCount('stop')) === 0);
await page.keyboard.press('y');
await clickWorld(-20, 0);
check('양보 표지 설치', (await signCount('yield')) === 1);
await page.keyboard.press('s');
await clickWorld(-20, 0);
check('다른 표지로 교체', (await signCount('stop')) === 1 && (await signCount('yield')) === 0);

// ---- 3단계+4단계: 차량 주행, 정지 표지 앞 정지, 교차로 통과 ----
const stats = () => page.evaluate(() => ({ ...window.__game.sim.traffic.stats, live: window.__game.sim.traffic.vehicles.size }));
await page.click('button[data-speed="4"]');
await page.keyboard.press('v');
await page.selectOption('#count', '10');
await clickWorld(-60, 0);
await clickWorld(0, 60);
let sawStop = false;
for (let i = 0; i < 400 && (await stats()).arrived < 10; i++) {
  if (await page.evaluate(() => [...window.__game.sim.traffic.vehicles.values()].some((v) => v.status === '정지 표지'))) sawStop = true;
  await page.waitForTimeout(150);
}
let st = await stats();
check('정지 표지 앞에서 서는 차량이 있었다', sawStop);
check('10대 모두 표지·교차로를 지나 도착', st.arrived === 10 && st.live === 0, JSON.stringify(st));
check('안전망 개입 0건, 충돌 점유 0건, 교착 0건', st.interventions === 0 && st.conflicts === 0 && st.deadlocks === 0, JSON.stringify(st));

await page.selectOption('#count', '50');
await clickWorld(-60, 0);
await clickWorld(0, 60);
await page.keyboard.press('d');
await page.waitForTimeout(6000);
check('디버그 패널(FPS·차량 수·충돌·차선변경)', /FPS \d+/.test(await page.locator('#debug').innerText()) && (await page.locator('#debug').innerText()).includes('충돌점유') && (await page.locator('#debug').innerText()).includes('차선변경'), (await page.locator('#debug').innerText()).replace(/\n/g, ' | '));
check('디버그 라벨(차선 ID·차량 상태)', (await page.locator('#labels .lane').count()) > 0 && (await page.locator('#labels .veh').count()) > 0, `lane=${await page.locator('#labels .lane').count()} veh=${await page.locator('#labels .veh').count()}`);
st = await stats();
check('주행 중 차량 있음', st.live >= 3, JSON.stringify(st));
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-vehicles.png') });

await page.keyboard.press('Escape');
await page.keyboard.press('2');
const segsBefore = (await counts()).s;
const idsBefore = await page.evaluate(() => [...window.__game.sim.traffic.vehicles.keys()]);
const arrivedBefore = (await stats()).arrived;
// 빈 땅(화면 위쪽, 도구 모음에 가려지지 않는 곳)을 드래그
await page.mouse.move(560, 170);
await page.mouse.down();
await page.mouse.move(700, 210, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
check('새 도로가 건설됨(테스트 전제)', (await counts()).s === segsBefore + 1, `${segsBefore} -> ${(await counts()).s}`);
st = await stats();
const idsAfter = await page.evaluate(() => [...window.__game.sim.traffic.vehicles.keys()]);
const lostIds = idsBefore.filter((id) => !idsAfter.includes(id)).length;
check('다른 곳에 도로를 놓아도 달리던 차량은 사라지지 않음(도착한 차량만 빠짐)', lostIds <= st.arrived - arrivedBefore, `사라진 ${lostIds}, 새로 도착 ${st.arrived - arrivedBefore}`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.keyboard.press('d');

// ---- 5·6단계: 샘플 맵, 건물, 통계, 전체 상태 저장·자동 저장, 하루 기록 ----
const game = () => page.evaluate(() => ({ tick: window.__game.sim.tickCount, live: window.__game.sim.traffic.vehicles.size, arrived: window.__game.sim.traffic.stats.arrived, clock: document.getElementById('clock').textContent }));
const bcount = () => page.evaluate(() => window.__game.editor.network.buildings.size);
const ff = (day, hour) => page.evaluate(([day, hour]) => { const s = window.__game.sim; const t = Math.round(((((day - 1) * 86400 + hour * 3600) - 5 * 3600) / 24) * 20); while (s.tickCount < t) s.step(); }, [day, hour]);

await page.click('button[data-speed="0"]');
await page.click('#sample');
await page.waitForTimeout(300);
check('샘플 맵 열기: 건물 23채 + 상점 3채 + 학교 + 외부 연결점, 미연결 0', (await bcount()) === 28 && (await page.evaluate(() => window.__game.sim.demand.unconnected().length)) === 0, String(await bcount()));
await ff(1, 8);
await page.waitForTimeout(400);
let g0 = await game();
check('아침 8시 출근: 차량이 달리고 있음', g0.live > 10 && g0.clock.includes('08:00'), JSON.stringify(g0));
await page.waitForTimeout(600);
const ciText = await page.locator('#st-ci').innerText();
check('통계 패널에 정체 지수·완료율이 표시됨', /^\d+$/.test(ciText) && (await page.locator('#stats').innerText()).includes('완료율'), `CI=${ciText}`);

// 도로 정보 창: 도구가 없을 때 도로를 클릭하면 열린다
{
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape'); // 한 번 더: 도로 도구 해제
  await page.evaluate(() => window.__game.focus({ x: 0, y: 0 }));
  await page.waitForTimeout(300);
  await page.click('button[data-speed="0"]'); // 차량이 끼어들지 않게 잠깐 정지
  // 차량이 가까이 있으면 차량 정보가 열리므로, 도로 정보가 열릴 때까지 지점을 바꿔 가며 누른다
  for (const [x, y] of [[-60, 0], [60, 0], [-180, 0], [180, 0], [-90, 0], [90, 0], [-150, 0], [150, 0], [-30, 0], [30, 0]]) {
    const p = await toScreen(x, y);
    if (!(p.x > 80 && p.x < 980 && p.y > 110 && p.y < 430)) continue;
    await clickWorld(x, y);
    if ((await page.locator('#info').isVisible()) && (await page.locator('#info').innerText()).includes('도로 정보')) break;
  }
  const infoText = await page.locator('#info').innerText();
  check('도로를 클릭하면 도로 정보 창이 열림(종류·제한속도·통과 차량·정체 지수)', (await page.locator('#info').isVisible()) && infoText.includes('도로 정보') && infoText.includes('왕복 6차로') && infoText.includes('제한속도') && infoText.includes('정체 지수'), infoText.replace(/\n/g, ' ').slice(0, 140));
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-info.png') });
  await page.click('#in-close');
  check('닫기 버튼으로 닫힘', !(await page.locator('#info').isVisible()));
  await page.evaluate(() => { const s = window.__game.sim; const t = s.tickCount + 20 * 40; while (s.tickCount < t) s.step(); });
  await page.waitForTimeout(400);
  const topN = await page.locator('#st-top li[data-seg]').count();
  const topText = await page.locator('#st-top').innerText();
  check('막히는 곳 TOP 5 목록이 표시됨(있으면 5개 이하)', topN <= 5 && (topN > 0 || topText.includes('없습니다')), `${topN}개 / ${topText.replace(/\n/g, ' | ')}`);
  if (topN > 0) {
    await page.locator('#st-top li[data-seg]').first().click();
    check('목록 항목을 누르면 그 도로의 정보 창이 열림', await page.locator('#info').isVisible());
    await page.click('#in-close');
    await page.evaluate(() => window.__game.focus({ x: 0, y: 0 })); // 목록 항목을 누르면 카메라가 그곳으로 옮겨 가므로 되돌린다
    await page.waitForTimeout(200);
  }
}
// 차량 정보 창: 달리는 차량을 클릭하면 출발·목적지·속도·상태가 나오고 남은 경로가 그려진다
{
  await page.keyboard.press('Escape');
  const target = await page.evaluate(() => {
    const g = window.__game;
    for (const v of g.sim.traffic.vehicles.values()) {
      if (v.meta?.kind !== 'commute') continue;
      const p = g.project({ x: v.x, y: v.y });
      const nodes = [...g.editor.network.nodes.values()]; // 교차로 안쪽은 교차로가 먼저 선택되므로 피한다
      if (nodes.some((n) => Math.hypot(n.x - v.x, n.y - v.y) < g.editor.network.plateRadius(n.id) + 14)) continue;
      if (p.x > 120 && p.x < 940 && p.y > 130 && p.y < 460) return { id: v.id, x: p.x, y: p.y };
    }
    return null;
  });
  check('화면 안에 클릭할 출근 차량이 있음', !!target);
  if (target) {
    await page.mouse.move(target.x, target.y);
    await page.mouse.click(target.x, target.y);
    const t = await page.locator('#info').innerText();
    check('차량을 클릭하면 차량 정보 창(차종·이동·출발·목적지·속도·상태)이 열림', (await page.locator('#info').isVisible()) && t.includes('차량 정보') && t.includes('승용차') && t.includes('출근') && t.includes('출발') && t.includes('km/h'), t.replace(/\n/g, ' ').slice(0, 140));
    await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-vehicle.png') });
    await page.click('#in-follow');
    check('따라가기 버튼', (await page.locator('#in-follow').innerText()).includes('끄기'));
    await page.click('#in-close');
    check('차량 정보 창 닫힘', !(await page.locator('#info').isVisible()));
  }
}
// 교차로 정보 창: 신호 방식 고르기, 단계별 녹색 시간 편집
{
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const g = window.__game.sim; for (let i = 0; i < 600 && g.traffic.vehicleNear({ x: 0, y: 0 }, 9); i++) g.step(); }); // 교차로 위의 차량이 지나갈 때까지 손으로 진행
  await clickWorld(0, 0);
  check('교차로를 클릭하면 교차로 정보 창이 열림', (await page.locator('#info').isVisible()) && (await page.locator('#info').innerText()).includes('교차로 정보'), (await page.locator('#info').innerText()).replace(/\n/g, ' ').slice(0, 80));
  await page.click('#info button[data-mode="fix"]');
  const prog = () => page.evaluate(() => { const n = [...window.__game.editor.network.nodes.values()].find((x) => x.x === 0 && x.y === 0); return { on: window.__game.editor.network.hasSignal(n.id), act: window.__game.editor.network.isActuated(n.id), greens: n.sigGreens }; });
  let pr = await prog();
  check('창에서 고정식 신호를 켬', pr.on && !pr.act);
  await page.click('#info button[data-g="0"][data-d="5"]');
  pr = await prog();
  check('단계 녹색 시간을 5초 늘림', pr.greens.length === 2 && pr.greens[0] % 5 === 0, JSON.stringify(pr));
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-node.png') });
  await page.click('#info button[data-mode="act"]');
  pr = await prog();
  check('감응식으로 바꿈', pr.on && pr.act);
  await page.click('#info button[data-mode="off"]');
  pr = await prog();
  check('신호등 끄기', !pr.on);
  await page.click('#in-close');
}
// 직각 맞추기: 큰길 위에서 약간 비스듬하게 끌어도 큰길에 정확히 직각으로 나간다
await page.click('button[data-tool="road2"]');
await dragWorld(-120, 0, -105, -120);
const perp = await page.evaluate(() => { const n = window.__game.editor.network; const sg = [...n.segments.values()].pop(); const A = n.nodes.get(sg.a), B = n.nodes.get(sg.b); return { dx: Math.abs(A.x - B.x), dy: Math.abs(A.y - B.y) }; });
check('직각 맞추기: 비스듬하게 끌어도 직각 도로가 만들어짐', perp.dx < 0.01 && perp.dy > 60, JSON.stringify(perp));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__game.editor.undo());
// 반대로: 큰길 근처에서 끝낼 때도 큰길에 직각으로 닿는다
await page.click('button[data-tool="road2"]');
await dragWorld(-160, -100, -150, -10); // 건물(x=-190, -130)에서 30m 떨어진 곳
const perp2 = await page.evaluate(() => { const n = window.__game.editor.network; const sg = [...n.segments.values()].filter((x) => { const A = n.nodes.get(x.a), B = n.nodes.get(x.b); return Math.abs(A.y + 100) < 0.5 || Math.abs(B.y + 100) < 0.5; }).pop(); const A = n.nodes.get(sg.a), B = n.nodes.get(sg.b); return { dx: Math.abs(A.x - B.x), dy: Math.abs(A.y - B.y) }; });
check('직각 맞추기: 큰길 근처에서 끝내도 직각으로 닿음', perp2.dx < 0.01 && perp2.dy > 50, JSON.stringify(perp2));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__game.editor.undo());
// 일방통행: 도로를 클릭할 때마다 양방향 → 한쪽 → 반대쪽 → 양방향
{
  const ow = () => page.evaluate(() => [...window.__game.editor.network.segments.values()].map((s) => s.oneWay).filter(Boolean));
  await page.keyboard.press('w');
  const [wx, wy] = await freeSpot([[-120, 0], [120, 0], [-60, 0]]);
  await clickWorld(wx, wy);
  check('일방통행: 첫 클릭은 한쪽 방향', JSON.stringify(await ow()) === '["ab"]' && (await page.locator('#msg').innerText()).includes('일방통행'), JSON.stringify(await ow()));
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-oneway.png') });
  await clickWorld(wx, wy);
  check('일방통행: 두 번째 클릭은 반대 방향', JSON.stringify(await ow()) === '["ba"]');
  await clickWorld(wx, wy);
  check('일방통행: 세 번째 클릭은 양방향으로 복귀', (await ow()).length === 0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
}
// 통행 제한: 좌회전 금지·진입 금지를 교차로 쪽 도로 끝에 놓고 다시 눌러 푼다
const resCount = (k) => page.evaluate((kk) => [...window.__game.editor.network.segments.values()].filter((x) => x.restrictA === kk || x.restrictB === kk).length, k);
await page.keyboard.press('n');
await clickWorld(-30, 0);
check('좌회전 금지 놓기', (await resCount('noLeft')) === 1 && (await page.locator('#msg').innerText()).includes('좌회전을 금지'), await page.locator('#msg').innerText());
await clickWorld(-30, 0);
check('다시 누르면 좌회전 금지 해제', (await resCount('noLeft')) === 0);
await page.keyboard.press('b');
await clickWorld(-30, 0);
check('진입 금지 놓기', (await resCount('noEntry')) === 1 && (await page.locator('#msg').innerText()).includes('진입을 금지'), await page.locator('#msg').innerText());
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-restrict.png') });
await clickWorld(-30, 0);
check('진입 금지 해제', (await resCount('noEntry')) === 0);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// 평행한 두 도로(큰길 y=0과 가로 길 y=-200)를 서로 어긋나게 끌어서 이어도 직각으로 이어진다
await page.click('button[data-tool="road2"]');
const countBefore = await page.evaluate(() => window.__game.editor.network.segments.size);
await dragWorld(-280, 0, -270, -192);
const link = await page.evaluate((nb) => { const n = window.__game.editor.network; const segs = [...n.segments.values()]; if (segs.length <= nb) return null; const sg = segs.filter((x) => { const A = n.nodes.get(x.a), B = n.nodes.get(x.b); return Math.abs(A.y + 200) < 0.5 || Math.abs(B.y + 200) < 0.5; }).filter((x) => { const A = n.nodes.get(x.a), B = n.nodes.get(x.b); return Math.abs(A.y - B.y) > 50; }).pop(); if (!sg) return null; const A = n.nodes.get(sg.a), B = n.nodes.get(sg.b); return { dx: Math.abs(A.x - B.x), dy: Math.abs(A.y - B.y) }; }, countBefore);
check('평행한 두 도로를 어긋나게 끌어 이어도 직각', !!link && link.dx < 0.01 && link.dy > 150, JSON.stringify(link));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.evaluate(() => window.__game.editor.undo());
// 분류 버튼을 다시 누르면 그 분류에서 고른 도구도 해제된다
await page.click('button[data-catbtn="zone"]');
await page.keyboard.press('o');
check('직장 구역 도구가 선택됨', await page.locator('button[data-tool="zoneOffice"].on').count() === 1);
await page.click('button[data-catbtn="zone"]');
check('분류 버튼을 다시 누르면 도구 상자가 닫히고 선택도 풀림', !(await page.locator('#sub-zone').isVisible()) && (await page.locator('button[data-tool="zoneOffice"].on').count()) === 0);
// 도로 넓히기: 왕복 2차로 구간을 클릭하면 4차로가 되고, 실행 취소로 돌아온다
const road4Count = () => page.evaluate(() => [...window.__game.editor.network.segments.values()].filter((s) => s.kind === 'road4').length);
const r4before = await road4Count();
const r6before = await page.evaluate(() => [...window.__game.editor.network.segments.values()].filter((x) => x.kind === 'road6').length);
await page.keyboard.press('u');
const [ux, uy] = await freeSpot([[240, -100], [-240, -100], [240, 100], [-240, 100], [0, 100]]); // 가운데 세로 길(0,100)도 후보
await clickWorld(ux, uy);
check('도로 넓히기: 2차로가 4차로가 됨', (await road4Count()) > r4before && (await page.locator('#msg').innerText()).includes('넓혔습니다'), `${r4before} → ${await road4Count()} / ${await page.locator('#msg').innerText()}`);
await clickWorld(ux, uy);
check('한 번 더 누르면 6차로로', (await page.locator('#msg').innerText()).includes('6차로') && (await page.evaluate(() => [...window.__game.editor.network.segments.values()].filter((x) => x.kind === 'road6').length)) === r6before + 1, await page.locator('#msg').innerText());
await clickWorld(ux, uy);
check('6차로에서는 더 넓힐 수 없음 안내', (await page.locator('#msg').innerText()).includes('더 넓힐 수 없습니다'), await page.locator('#msg').innerText());
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.evaluate(() => { window.__game.editor.undo(); window.__game.editor.undo(); });
check('도로 넓히기도 실행 취소됨', (await road4Count()) === r4before, String(await road4Count()));
// 신호등: 큰길과 세로 길이 만나는 교차로를 클릭하면 켜지고, 다시 클릭하면 꺼진다
const sigCount = () => page.evaluate(() => [...window.__game.editor.network.nodes.values()].filter((n) => window.__game.editor.network.hasSignal(n.id)).length);
await page.keyboard.press('g');
await clickWorld(0, 0);
check('신호등 켜기', (await sigCount()) === 1 && (await page.locator('#msg').innerText()).includes('켰습니다'), await page.locator('#msg').innerText());
await page.evaluate(() => { const s = window.__game.sim; const t = s.tickCount + 20 * 60; while (s.tickCount < t) s.step(); });
await page.waitForTimeout(300);
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-signal.png') });
await clickWorld(0, 0);
check('신호등 다시 클릭: 감응식으로 바뀜', (await sigCount()) === 1 && (await page.evaluate(() => [...window.__game.editor.network.nodes.values()].some((n) => n.sigMode === 'actuated' && n.signal))) && (await page.locator('#msg').innerText()).includes('감응식'), await page.locator('#msg').innerText());
await page.evaluate(() => { const s = window.__game.sim; const t = s.tickCount + 20 * 120; while (s.tickCount < t) s.step(); });
await clickWorld(0, 0);
check('신호등 끄기', (await sigCount()) === 0, String(await sigCount()));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
// 구역: 도로 옆을 드래그해서 칠하고, 지우고, 건물이 자라는지 본다
const zcount = () => page.evaluate(() => window.__game.editor.network.zones.size);
const z0 = await zcount(); // 샘플에는 빈 땅에 구역이 8칸 칠해져 있다
const [zx, zy] = await freeSpot([[-160, -220], [160, -220], [-160, 220], [160, 220], [-120, -220], [120, 220]]); // 큰길(6차로) 옆 줄은 도로로 막히므로 가로 길(y=±200) 옆 빈 땅
await page.keyboard.press('h');
await dragWorld(zx, zy, zx + 60, zy);
check('주거 구역 드래그로 4칸 칠함', (await zcount()) === z0 + 4 && (await page.locator('#msg').innerText()).includes('주거(저밀) 구역 4칸'), `${await zcount()} / ${await page.locator('#msg').innerText()} / z0=${z0}`);
await page.keyboard.press('e');
await dragWorld(zx, zy, zx + 60, zy);
check('구역 지우기 도구로 구역이 사라짐', (await zcount()) === z0, String(await zcount()));
await page.keyboard.press('k');
await dragWorld(zx, zy, zx + 60, zy);
check('주거 고밀 구역(K) 칠하기', (await zcount()) === z0 + 4 && (await page.locator('#msg').innerText()).includes('주거(고밀) 구역 4칸'), `${await zcount()} / ${await page.locator('#msg').innerText()} / z0=${z0}`);
await page.keyboard.press('e');
await dragWorld(zx, zy, zx + 60, zy);
check('고밀 구역도 지워짐', (await zcount()) === z0);
await page.keyboard.press('h');
await dragWorld(zx, zy, zx + 60, zy);
await page.evaluate(() => { const s = window.__game.sim; const t = s.tickCount + 20 * 120; while (s.tickCount < t) s.step(); }); // 시뮬 2분
await page.waitForTimeout(300);
const grown = await page.evaluate(() => [...window.__game.editor.network.buildings.values()].filter((b) => b.source === 'auto').length);
check('수요가 있으면 구역에 건물이 자람', grown >= 1, String(grown));
check('위쪽 바에 수요 막대(주거 저·중·고밀, 상업, 사무, 산업, 혼합) 표시', (await page.locator('#rci .rb').count()) === 7 && (await page.locator('#st-dh').evaluate((e) => e.style.height)) !== '', '');
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-zones.png') });
// 이후 검사(하루 완료율 등)는 구역을 칠하지 않은 샘플로 다시 시작해서 본다
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.click('#sample');
await page.waitForTimeout(300);
await ff(1, 8);
await page.waitForTimeout(400);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// 전체 상태 저장 → 더 진행 → 불러오기: 시계·차량 수가 저장한 순간으로 돌아온다
const gSave = await game();
await page.selectOption('#slot', '1');
await page.click('#save');
await page.waitForTimeout(500);
await page.evaluate(() => { for (let i = 0; i < 3000; i++) window.__game.sim.step(); });
const gMid = await game();
await page.click('#load');
await page.waitForTimeout(500);
const gLoad = await game();
check('전체 상태 저장·불러오기: 시계와 차량이 저장한 순간으로 복원', gMid.tick > gSave.tick && gLoad.tick === gSave.tick && gLoad.live === gSave.live && gLoad.arrived === gSave.arrived, JSON.stringify({ gSave, gMid, gLoad }));

// 자동 저장(탭을 떠날 때) → 새로고침해도 자동 저장이 있다고 알려 줌
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(500);
const autoTick = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('kmj-transportation', 1); r.onsuccess = () => { const q = r.result.transaction('slots').objectStore('slots').get(0); q.onsuccess = () => res(q.result ? JSON.parse(q.result).sim.tickCount : -1); }; }));
check('자동 저장 슬롯에 전체 상태가 저장됨', autoTick === gSave.tick, `자동 저장 tick ${autoTick}`);

// 하루가 끝나면(다음 날 04:00) 어제 요약이 기록되고 통계 패널에 표시된다
await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
await ff(2, 4.5);
await page.waitForTimeout(800);
const yday = await page.locator('#st-yesterday').innerText();
const rec = await page.evaluate(() => window.__game.sim.metrics.history[0]);
check('하루가 끝나면 어제 요약이 표시됨(완료율 95% 이상)', yday.includes('어제(1일차)') && rec.completion >= 95 && rec.generated > 504, `${yday} / ${JSON.stringify(rec)}`);
check('샘플 하루 동안 안전망 개입·교착·충돌 점유 0', await page.evaluate(() => { const s = window.__game.sim.traffic.stats; return s.interventions === 0 && s.deadlocks === 0 && s.conflicts === 0; }));

await page.reload();
await page.waitForSelector('canvas');
await page.click('#t-start');
await page.waitForTimeout(800);
check('다시 열면 자동 저장이 있다고 알려 줌', (await page.locator('#msg').innerText()).includes('자동 저장'), await page.locator('#msg').innerText());

// ---- 1.1.0 1단계: 정체 히트맵, 색약 친화 색상, 속도 제한 ----
await page.click('button[data-speed="0"]');
await page.click('#sample');
await ff(1, 8);
await page.keyboard.press('m');
check('히트맵 켜기: 범례가 나타남(등급 5 + 통행 적음)', (await page.locator('#legend').isVisible()) && (await page.locator('#legend span').count()) === 6, String(await page.locator('#legend span').count()));
const legendColor = () => page.locator('#legend i').first().evaluate((e) => getComputedStyle(e).backgroundColor);
const c1 = await legendColor();
await page.click('#cb');
const c2 = await legendColor();
check('색약 친화 색상으로 바꾸면 범례 색이 달라짐', c1 !== c2, `${c1} → ${c2}`);
await page.click('#cb');
await page.click('button[data-speed="1"]');
await page.waitForTimeout(2500);
const heatColors = await page.evaluate(() => [...window.__game.heat.colors().values()]);
check('출근 중에는 통행이 있는 도로가 회색이 아닌 등급 색으로 칠해짐', heatColors.some((c) => c !== '#9aa0a6') && heatColors.some((c) => c === '#9aa0a6'), JSON.stringify([...new Set(heatColors)]));
await page.click('button[data-speed="0"]');
await page.keyboard.press('m');
check('히트맵 끄기: 범례가 사라짐', !(await page.locator('#legend').isVisible()));

await page.keyboard.press('l');
await clickWorld(60, 0); // 큰길(왕복 6차로, 기본 70, 상한 100)
const limits = () => page.evaluate(() => [...window.__game.editor.network.segments.values()].filter((sg) => sg.playerSpeedKmh !== null).map((sg) => sg.playerSpeedKmh));
check('속도 제한 도구: 첫 클릭은 한 단계 올라감(70→80)', JSON.stringify(await limits()) === '[80]', JSON.stringify(await limits()));
await clickWorld(60, 0);
check('한 번 더 누르면 상한(100)', JSON.stringify(await limits()) === '[100]', JSON.stringify(await limits()));
await clickWorld(60, 0);
check('상한 다음 클릭은 가장 낮은 값(30)으로 돌아감', JSON.stringify(await limits()) === '[30]', JSON.stringify(await limits()));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
check('속도 제한도 실행 취소됨', JSON.stringify(await limits()) === '[100]', JSON.stringify(await limits()));
await page.keyboard.press('Escape');

// 카메라 조작: 휠 줌과 드래그 후에도 오류 없이 렌더
await page.mouse.move(640, 360);
await page.mouse.wheel(0, -400);
await page.mouse.down({ button: 'right' });
await page.mouse.move(760, 330, { steps: 8 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2] ?? 'smoke.png' });

// ---- 새 도시에서 1.6.0 기능: 곡선·회전교차로·차선 방향·이름·학교·단축키 도움말 ----
{
  await page.click('#newcity');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__game.sim.setEvents(false));
  const segs = () => page.evaluate(() => window.__game.editor.network.segments.size);
  // 곡선: Q로 곡선 모드, 2로 2차로, 세 번 클릭
  await page.keyboard.press('q');
  await page.keyboard.press('2');
  const base = await segs();
  await clickWorld(60, -450); await clickWorld(130, -380); await clickWorld(200, -450);
  check('곡선 모드: 세 번 클릭으로 곡선 도로가 여러 구간으로 만들어짐', (await segs()) >= base + 3 && (await page.locator('#msg').innerText()).includes('곡선 도로를 만들었습니다'), `${base} -> ${await segs()} / ${await page.locator('#msg').innerText()}`);
  await page.keyboard.press('q');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // 교차로를 만들어 두고(편집 API) 회전교차로 도구와 정보 창을 쓴다
  await page.evaluate(() => { const e = window.__game.editor; e.build({ x: 300, y: -700 }, { x: 300, y: -500 }, 'road4'); e.build({ x: 200, y: -600 }, { x: 400, y: -600 }, 'road4'); window.__game.focus({ x: 300, y: -600 }); });
  await page.waitForTimeout(300);
  await clickWorld(250, -600); // 도구 없음: 가로 도로 조각 클릭 → 도로 정보
  const infoT = await page.locator('#info').innerText();
  check('도로 정보 창에 이름 입력·넓히기·차선 방향이 있음', infoT.includes('이름 저장') && infoT.includes('차선 방향') && infoT.includes('1차선') && infoT.includes('2차선'), infoT.replace(/\n/g, ' ').slice(0, 120));
  await page.fill('#in-name', '중앙로');
  await page.click('#in-name-ok');
  check('도로 이름 저장', await page.evaluate(() => [...window.__game.editor.network.segments.values()].some((x) => x.name === '중앙로')));
  await page.locator('[data-ld-auto]').first().click();
  check('차선 방향 자동 배정(오른쪽 직진·우회전, 왼쪽 좌회전·직진)', await page.evaluate(() => [...window.__game.editor.network.segments.values()].some((x) => JSON.stringify(x.laneDirsA) === '[6,3]' || JSON.stringify(x.laneDirsB) === '[6,3]')));
  await page.click('#in-close');
  await page.keyboard.press('r');
  await clickWorld(300, -600);
  check('회전교차로 도구: 교차로가 환형(일방통행 4조각)으로 바뀜', (await page.evaluate(() => [...window.__game.editor.network.segments.values()].filter((x) => x.oneWay).length)) === 4 && (await page.locator('#msg').innerText()).includes('회전교차로를 만들었습니다'), await page.locator('#msg').innerText());
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-roundabout.png') });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // 학교 놓기
  await page.keyboard.press('p');
  await page.selectOption('#bsize', 'small');
  await clickWorld(100, -500);
  check('학교 도구(P): 학교 건물이 놓임', await page.evaluate(() => [...window.__game.editor.network.buildings.values()].some((b) => b.kind === 'school' && b.source === 'player')), await page.locator('#msg').innerText());
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // 좁히기(Shift+U)
  await page.keyboard.press('Shift+U');
  check('Shift+U로 좁히기 도구가 선택됨', await page.locator('button[data-tool="downgrade"].on').count() === 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  // 단축키 도움말
  await page.keyboard.press('?');
  check('? 키로 단축키 도움말이 열림(키 이름과 설명 표시)', (await page.locator('#help').isVisible()) && (await page.locator('#help').innerText()).includes('회전교차로') && (await page.locator('#help').innerText()).includes('Shift + U'));
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-help.png') });
  await page.keyboard.press('Escape');
  check('Esc로 도움말이 닫힘', !(await page.locator('#help').isVisible()));
  // 교차로 정보 창: 좌표 대신 방향 이름, 차선 카드, 교차로 선택 표시
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game.focus({ x: 0, y: -300 }));
  await page.waitForTimeout(300);
  await page.evaluate(() => { const g = window.__game; const n = [...g.editor.network.nodes.values()].find((v) => g.editor.network.segmentsAt(v.id).length >= 3); window.__selNode = n ? { x: n.x, y: n.y } : null; });
  const sn = await page.evaluate(() => window.__selNode);
  if (sn) {
    await page.evaluate((p) => window.__game.focus(p), sn);
    await page.waitForTimeout(300);
    await clickWorld(sn.x, sn.y);
    const nt = await page.locator('#info').innerText();
    check('교차로 정보 창: 방향 이름(쪽)과 차선 카드(1차선…)가 있고 좌표가 없음', nt.includes('교차로 정보') && /쪽에서 들어오는 길/.test(nt) && !/\(-?\d+, -?\d+\)/.test(nt), nt.replace(/\n/g, ' ').slice(0, 140));
  }
  // 격자 도시
  await page.click('#gridcity');
  await page.waitForTimeout(300);
  const gi = await page.evaluate(() => { const n = window.__game.editor.network; return { sig: [...n.nodes.values()].filter((x) => n.hasSignal(x.id)).length, zones: n.zones.size, ring: [...n.segments.values()].filter((s) => s.oneWay).length }; });
  check('격자 도시: 신호등 3곳, 회전교차로, 구역 300칸 이상', gi.sig === 3 && gi.zones > 300 && gi.ring >= 3, JSON.stringify(gi));
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-grid.png') });
  // 구릉 도시: 지형·강·다리, 입체교차(T), 업적 줄
  await page.click('#hillcity');
  await page.waitForTimeout(500);
  const hi = await page.evaluate(() => { const n = window.__game.editor.network; return { terrain: !!n.terrain, bridge: [...n.segments.values()].filter((x) => x.structure === 'bridge').length, zs: new Set([...n.nodes.values()].map((x) => Math.round(x.z))).size }; });
  check('구릉 도시: 지형이 있고 다리가 있으며 도로 높이가 다양함', hi.terrain && hi.bridge >= 1 && hi.zs > 1, JSON.stringify(hi));
  await page.evaluate(() => window.__game.focus({ x: 200, y: 0 }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-hills.png') });
  await page.click('button[data-catbtn="road"]');
  await page.keyboard.press('2'); await page.keyboard.press('t');
  check('T 키로 입체 모드 체크상자가 켜짐', await page.locator('#over').isChecked());
  const ov = await page.evaluate(() => window.__game.editor.buildOver({ x: -100, y: -200 }, { x: -100, y: 200 }, 'road2'));
  check('입체교차(고가)가 지형 위에서 건설됨', ov.ok === true, JSON.stringify(ov));
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  check('통계 패널에 점수·업적 줄이 있음', (await page.locator('#st-goal').innerText()).includes('/12'));
  await page.click('#st-goal');
  check('업적 줄을 누르면 목록이 열림', (await page.locator('#st-goals li').count()) === 12);
  await page.click('#sample');
  await page.waitForTimeout(400);
  // 지형 유형 고르기
  check('지형 유형이 8종', (await page.locator('#terrainType option').count()) === 8);
  await page.selectOption('#terrainType', 'coast');
  await page.click('#terraincity');
  await page.waitForTimeout(400);
  const ti = await page.evaluate(() => { const n = window.__game.editor.network; return { sea: n.terrain?.sea, ext: n.externalId() !== null }; });
  check('지형 도시(해안): 바다가 있는 지형에서 외부 연결 도로가 놓임', ti.sea === 'e' && ti.ext, JSON.stringify(ti));
  await page.click('#sample');
  await page.waitForTimeout(300);
  check('샘플 맵으로 돌아오면 지형이 사라짐', await page.evaluate(() => window.__game.editor.network.terrain === null));
}
check('콘솔 오류 0건', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
process.exit(fails.length ? 1 : 0);
