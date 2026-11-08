// 실제 브라우저로 빌드 결과를 열어 기본 동작을 확인한다. 사용: npm run build && npm run smoke
import { createRequire } from 'node:module';
import { preview } from 'vite';
const { chromium } = createRequire(import.meta.url)('playwright');

const server = await preview({ preview: { port: 4173, strictPort: true } });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));

const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) fails.push(name); };

await page.goto('http://localhost:4173/');
await page.waitForSelector('canvas');
await page.waitForTimeout(1500);

await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-start.png') });
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

// ---- 2단계: 도로 건설 (드래그) ----
const counts = () => page.evaluate(() => ({ n: window.__game.editor.network.nodes.size, s: window.__game.editor.network.segments.size }));
const toScreen = (x, y) => page.evaluate(([x, y]) => window.__game.project({ x, y }), [x, y]);
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

await dragWorld(0, -100, 0, 100);
c = await counts();
check('십자 교차(노드 5, 도로 4)', c.n === 5 && c.s === 4, JSON.stringify(c));

await dragWorld(200, 200, 200, 205, false);
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
  const cdp = await tctx.newCDPSession(tp);
  await tp.goto('http://localhost:4173/');
  await tp.waitForSelector('canvas');
  await tp.click('button[data-speed="0"]');
  const tref = () => tp.evaluate(() => [[300, 0], [0, 300], [-300, 0], [0, 0]].map(([x, y]) => window.__game.project({ x, y })));
  const tsegs = () => tp.evaluate(() => window.__game.editor.network.segments.size);
  const tt = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await tp.click('button[data-tool="road2"]');
  let t0 = await tref();
  await tt('touchStart', [{ x: 500, y: 520 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 500 + i * 25, y: 520 + i * 5 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(400);
  check('터치: 한 손가락 드래그로 도로가 그려짐', (await tsegs()) === 1, String(await tsegs()));
  check('터치: 도로를 그리는 동안 카메라가 이동도 회전도 안 함', moved(t0, await tref()) < 1, String(moved(t0, await tref())));
  await tp.keyboard.press('Escape');
  t0 = await tref();
  await tt('touchStart', [{ x: 500, y: 400 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 500 + i * 15, y: 400 + i * 5 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(500);
  check('터치: 도구가 없을 때 한 손가락 드래그는 화면 이동', moved(t0, await tref()) > 20 && (await tsegs()) === 1, String(moved(t0, await tref())));
  t0 = await tref();
  await tt('touchStart', [{ x: 560, y: 360 }, { x: 720, y: 360 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 560 - i * 15, y: 360 }, { x: 720 + i * 15, y: 360 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(500);
  check('터치: 두 손가락 벌리기는 확대', moved(t0, await tref()) > 20, String(moved(t0, await tref())));
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
await page.keyboard.press('r');
const segsBefore = (await counts()).s;
// 빈 땅(화면 아래쪽)을 드래그
await page.mouse.move(560, 580);
await page.mouse.down();
await page.mouse.move(700, 620, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
check('새 도로가 건설됨(테스트 전제)', (await counts()).s === segsBefore + 1, `${segsBefore} -> ${(await counts()).s}`);
st = await stats();
check('도로를 고치면 달리던 차량은 모두 제거', st.live === 0, JSON.stringify(st));
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.keyboard.press('d');

// 카메라 조작: 휠 줌과 드래그 후에도 오류 없이 렌더
await page.mouse.move(640, 360);
await page.mouse.wheel(0, -400);
await page.mouse.down({ button: 'right' });
await page.mouse.move(760, 330, { steps: 8 });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(500);
await page.screenshot({ path: process.argv[2] ?? 'smoke.png' });

check('콘솔 오류 0건', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
process.exit(fails.length ? 1 : 0);
