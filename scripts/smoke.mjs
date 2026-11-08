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

// ---- 2단계: 도로 건설 (실제 마우스 클릭) ----
const counts = () => page.evaluate(() => ({ n: window.__game.editor.network.nodes.size, s: window.__game.editor.network.segments.size }));
const clickWorld = async (x, y) => {
  const p = await page.evaluate(([x, y]) => window.__game.project({ x, y }), [x, y]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
};
const hoverWorld = async (x, y) => {
  const p = await page.evaluate(([x, y]) => window.__game.project({ x, y }), [x, y]);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(100);
};

await page.click('button[data-tool="road2"]');
await clickWorld(-100, 0);
await hoverWorld(100, 0);
check('길이 표시', /^200 m$/.test(await page.locator('#tip').innerText()), await page.locator('#tip').innerText());
await clickWorld(100, 0);
let c = await counts();
check('도로 1개 건설(노드 2, 도로 1)', c.n === 2 && c.s === 1, JSON.stringify(c));
await page.keyboard.press('Escape'); // 이어 그리기 종료

await clickWorld(0, -100);
await clickWorld(0, 100);
c = await counts();
check('십자 교차(노드 5, 도로 4)', c.n === 5 && c.s === 4, JSON.stringify(c));
await page.keyboard.press('Escape');

await clickWorld(200, 200);
await hoverWorld(200, 205);
check('잘못된 입력은 빨간 안내', (await page.locator('#tip').innerText()).includes('시작점과 같은') && (await page.locator('#tip').getAttribute('class')) === 'bad');
await page.keyboard.press('Escape');

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

// 끌기(카메라 이동)는 건설 클릭으로 오인되지 않는다
await page.click('button[data-tool="road2"]');
await page.mouse.move(400, 400);
await page.mouse.down();
await page.mouse.move(520, 380, { steps: 6 });
await page.mouse.up();
await page.mouse.move(700, 300);
await page.waitForTimeout(100);
check('드래그는 건설이 아님', await page.locator('#tip').isHidden());
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// ---- 3단계: 차량 주행 ----
const stats = () => page.evaluate(() => ({ ...window.__game.sim.traffic.stats, live: window.__game.sim.traffic.vehicles.size }));
await page.click('button[data-speed="4"]');
await page.keyboard.press('v');
await page.selectOption('#count', '10');
await clickWorld(-60, 0);
await clickWorld(0, 60);
await page.waitForTimeout(1500);
let st = await stats();
check('차량 투입됨', st.spawned >= 1, JSON.stringify(st));
for (let i = 0; i < 40 && (await stats()).arrived < 10; i++) await page.waitForTimeout(500);
st = await stats();
check('10대 모두 교차로를 지나 도착', st.arrived === 10 && st.live === 0, JSON.stringify(st));
check('안전망 개입 0건', st.interventions === 0, String(st.interventions));

await page.selectOption('#count', '50');
await clickWorld(-60, 0);
await clickWorld(0, 60);
await page.keyboard.press('d');
await page.waitForTimeout(6000);
check('디버그 패널(FPS·차량 수)', /FPS \d+/.test(await page.locator('#debug').innerText()) && (await page.locator('#debug').innerText()).includes('차량'), (await page.locator('#debug').innerText()).replace(/\n/g, ' | '));
check('디버그 라벨(차선 ID·차량 상태)', (await page.locator('#labels .lane').count()) > 0 && (await page.locator('#labels .veh').count()) > 0, `lane=${await page.locator('#labels .lane').count()} veh=${await page.locator('#labels .veh').count()}`);
st = await stats();
check('주행 중 차량 있음', st.live >= 3, JSON.stringify(st));
await page.screenshot({ path: (process.argv[2] ?? 'smoke.png').replace('.png', '-vehicles.png') });

await page.keyboard.press('Escape');
await page.keyboard.press('r');
const segsBefore = (await counts()).s;
// 카메라가 움직였을 수 있으니 월드 좌표 대신 화면 아래쪽(빈 땅)을 직접 클릭
await page.mouse.click(560, 560);
await page.mouse.click(720, 600);
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
