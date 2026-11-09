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
  g.editor.loadData({ formatVersion: 6, nextNodeId: 1, nextSegmentId: 1, nodes: [], segments: [], nextBuildingId: 1, buildings: [], zones: [] });
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
    if (p.x > 210 && p.x < 990 && p.y > 120 && p.y < 640) return [x, y];
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

await dragWorld(0, -100, 0, 100);
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
  const cdp = await tctx.newCDPSession(tp);
  await tp.goto('http://localhost:4173/');
  await tp.waitForSelector('canvas');
  await tp.click('button[data-speed="0"]');
  const tref = () => tp.evaluate(() => [[300, 0], [0, 300], [-300, 0], [0, 0]].map(([x, y]) => window.__game.project({ x, y })));
  const tsegs = () => tp.evaluate(() => window.__game.editor.network.segments.size);
  const tt = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tbase = await tsegs(); // 새 도시는 외부 연결 도로 1개로 시작
  await tp.click('button[data-tool="road2"]');
  let t0 = await tref();
  await tt('touchStart', [{ x: 500, y: 520 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 500 + i * 25, y: 520 + i * 5 }]); await tp.waitForTimeout(20); }
  await tt('touchEnd', []);
  await tp.waitForTimeout(400);
  check('터치: 한 손가락 드래그로 도로가 그려짐', (await tsegs()) === tbase + 1, String(await tsegs()));
  check('터치: 도로를 그리는 동안 카메라가 이동도 회전도 안 함', moved(t0, await tref()) < 1, String(moved(t0, await tref())));
  await tp.keyboard.press('Escape');
  t0 = await tref();
  await tt('touchStart', [{ x: 500, y: 400 }]);
  for (let i = 1; i <= 8; i++) { await tt('touchMove', [{ x: 500 + i * 15, y: 400 + i * 5 }]); await tp.waitForTimeout(20); }
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
const idsBefore = await page.evaluate(() => [...window.__game.sim.traffic.vehicles.keys()]);
const arrivedBefore = (await stats()).arrived;
// 빈 땅(화면 아래쪽)을 드래그
await page.mouse.move(560, 580);
await page.mouse.down();
await page.mouse.move(700, 620, { steps: 6 });
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
check('샘플 맵 열기: 건물 23채 + 외부 연결점, 미연결 0', (await bcount()) === 24 && (await page.evaluate(() => window.__game.sim.demand.unconnected().length)) === 0, String(await bcount()));
await ff(1, 8);
await page.waitForTimeout(400);
let g0 = await game();
check('아침 8시 출근: 차량이 달리고 있음', g0.live > 10 && g0.clock.includes('08:00'), JSON.stringify(g0));
await page.waitForTimeout(600);
const ciText = await page.locator('#st-ci').innerText();
check('통계 패널에 정체 지수·완료율이 표시됨', /^\d+$/.test(ciText) && (await page.locator('#stats').innerText()).includes('완료율'), `CI=${ciText}`);

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
const [zx, zy] = await freeSpot([[-160, -20], [160, -20], [-160, 20], [160, 20]]);
await page.keyboard.press('h');
await dragWorld(zx, zy, zx + 60, zy);
check('주거 구역 드래그로 4칸 칠함', (await zcount()) === 4 && (await page.locator('#msg').innerText()).includes('주거 구역 4칸'), `${await zcount()} / ${await page.locator('#msg').innerText()}`);
await page.keyboard.press('e');
await dragWorld(zx, zy, zx + 60, zy);
check('구역 지우기 도구로 구역이 사라짐', (await zcount()) === 0, String(await zcount()));
await page.keyboard.press('h');
await dragWorld(zx, zy, zx + 60, zy);
await page.evaluate(() => { const s = window.__game.sim; const t = s.tickCount + 20 * 120; while (s.tickCount < t) s.step(); }); // 시뮬 2분
await page.waitForTimeout(300);
const grown = await page.evaluate(() => [...window.__game.editor.network.buildings.values()].filter((b) => b.source === 'auto').length);
check('수요가 있으면 구역에 건물이 자람', grown >= 1, String(grown));
check('통계 패널에 수요 막대 표시', (await page.locator('#stats').innerText()).includes('주거 수요') && (await page.locator('#st-dh').evaluate((e) => e.style.width)) !== '', '');
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
await clickWorld(60, 0); // 큰길(왕복 4차로, 기본 60, 상한 80)
const limits = () => page.evaluate(() => [...window.__game.editor.network.segments.values()].filter((sg) => sg.playerSpeedKmh !== null).map((sg) => sg.playerSpeedKmh));
check('속도 제한 도구: 첫 클릭은 한 단계 올라감(60→80)', JSON.stringify(await limits()) === '[80]', JSON.stringify(await limits()));
await clickWorld(60, 0);
check('상한 다음 클릭은 가장 낮은 값(30)으로 돌아감', JSON.stringify(await limits()) === '[30]', JSON.stringify(await limits()));
await page.keyboard.press('Escape');
await page.keyboard.press('Control+z');
check('속도 제한도 실행 취소됨', JSON.stringify(await limits()) === '[80]', JSON.stringify(await limits()));
await page.keyboard.press('Escape');

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
