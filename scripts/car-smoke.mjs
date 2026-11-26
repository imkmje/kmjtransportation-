// 카 컴퍼니 브라우저 점검: 타이틀 → 새 게임 → 기획 → 개발 → 출시 → 리뷰 → 판매 → 가격 변경 → 저장 → 새로 고침 → 이어 하기 → 단종 → 두 번째 차.
// 사용: npm run build && node scripts/car-smoke.mjs [스크린샷경로.png]  (경로를 주면 화면마다 -이름.png로 찍는다)
import { createRequire } from 'node:module';
import { preview } from 'vite';
const { chromium } = createRequire(import.meta.url)('playwright');
// 같은 저장소에서 점검을 동시에 돌릴 때: CAR_SMOKE_PORT(기본 4191), CAR_SMOKE_DIST(빌드 폴더, 기본 dist)
const PORT = Number(process.env.CAR_SMOKE_PORT) || 4191;
const server = await preview({ preview: { port: PORT, strictPort: true }, ...(process.env.CAR_SMOKE_DIST ? { build: { outDir: process.env.CAR_SMOKE_DIST } } : {}) });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// 1.0.0 출시 공개 장면(약 5초)은 기본으로 끄고(기기 저장소 car-company-reveal = '0'), 공개 장면 점검에서만 켠다
{ const nc = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { if (localStorage.getItem('car-company-reveal') === null) localStorage.setItem('car-company-reveal', '0'); } catch { /* 저장 불가 */ } }); return c; }; }
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
const page = await ctx.newPage();
const URL0 = `http://localhost:${PORT}/car/`;
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const fails = [];
let checks = 0;
const done = async (code) => { await browser.close(); await new Promise((r) => server.httpServer.close(r)); process.exit(code); };
const halt = async (e) => { if (process.argv[2]) await page.screenshot({ path: process.argv[2].replace('.png', '-halt.png') }).catch(() => {}); console.log(`FAIL 점검이 중간에 멈춤(${checks}번째 항목 뒤): ${String(e?.message ?? e).split('\n').slice(0, 6).join(' | ')}`); await done(1); };
process.on('uncaughtException', halt); process.on('unhandledRejection', halt);
const check = (name, ok, detail = '') => { checks++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) fails.push(name); };
const shot = (n) => !process.argv[2] ? Promise.resolve() : page.screenshot({ path: process.argv[2].replace('.png', `-${n}.png`), timeout: 60000 }).catch((e) => console.log('WARN 스크린샷 실패:', n, String(e.message).split('\n')[0]));
const G = (fn, arg) => page.evaluate(fn, arg);
const tick = (n) => G((k) => window.__car.tick(k), n);
// ---- 5.1.0 새 뼈대를 직접 누르는 도우미: 아래 주 메뉴 7탭(오늘·차·연구·사람·그룹·시장·재무) + 탭 안 구역 줄 + 위쪽 [메뉴] ----
const SEC_TAB = (a, v) => (a === 'psec' ? 'people' : a === 'cotab' ? (v === 'exec' ? 'people' : v === 'world' ? 'market' : 'group') : a === 'rectab' ? (v === 'awards' ? 'market' : 'fin') : v === 'office' ? 'people' : v === 'rivals' ? 'market' : 'fin');
/** 탭(없으면 구역으로 정함)을 누르고 그 탭의 구역 단추를 누른다. 기록은 [재무] › [기록] 다음 칸을 누른다. 운영 전환 중에는 탭만 */
async function tab5(pg, tab, a, v) {
  const t = tab ?? SEC_TAB(a === 'cotab' && v === 'staff' ? 'psec' : a, v); if (a === 'cotab' && v === 'staff') a = 'psec';
  const on = ((await pg.locator(`#tabs button[data-tab="${t}"]`).getAttribute('class')) ?? '').includes('on');
  if (!on) await pg.click(`#tabs button[data-tab="${t}"]`);
  if (await pg.evaluate(() => !document.querySelector('#hqback').hidden)) return;
  if (a === 'rectab' && t === 'fin' && !(await pg.locator('#panel .sec2').count())) await pg.click('#panel [data-act="sec"][data-v="records"]');
  if (a) await pg.click(`#panel [data-act="${a}"][data-v="${v}"]`);
}
/** 차 탭(판매 중인 차가 2대 이상이면 왼쪽 목록 [전 차종 비교]까지). 운영 전환 중이면 구역 줄 [차고] */
async function carTable(pg, tap = false) { const c = (q) => (tap ? pg.tap(q) : pg.click(q)); await c('#tabs button[data-tab="car"]'); if (await pg.locator('#side:not([hidden]) [data-act="gsum"]').count()) await c('#side [data-act="gsum"]'); else if (await pg.locator('#panel .secbar [data-act="tab"][data-v="garage"]').count()) await c('#panel .secbar [data-act="tab"][data-v="garage"]'); }
/** 차 탭 › 왼쪽 목록 [개발 현황](기획 중이면 그 초안). 운영 전환 중이면 구역 줄 [개발] */
async function devHome(pg, tap = false) { const c = (q) => (tap ? pg.tap(q) : pg.click(q)); await c('#tabs button[data-tab="car"]'); await c((await pg.locator('#side:not([hidden]) [data-act="devTab"]').count()) ? '#side [data-act="devTab"]' : '#panel .secbar [data-act="tab"][data-v="dev"]'); }
const topOpen = async (pg) => { if (await pg.locator('#topmenu').isHidden()) await pg.click('#menubtn'); };
/** 위쪽 [메뉴] 안 항목(회사 로고·평판·시대 사건·결정 대기·할 일·소리) */
async function menuItem(pg, q, dbl = false) { await topOpen(pg); return dbl ? pg.dblclick(q) : pg.click(q); }
/** [메뉴] › [저장·설정] 창 */
async function openSave(pg) { await topOpen(pg); await pg.click('#menusave'); }
const toRivals = (pg) => tab5(pg, 'market', 'sec', 'rivals');
const act = async (a, extra = '') => { await page.locator(`[data-act="${a}"]${extra}`).filter({ visible: true }).first().click(); }; // 같은 단추가 숨은 목록(차 탭 왼쪽 등)에도 있으면 보이는 것
/** 차고 탭(0.9.0): 판매 중인 차가 2대 이상이면 첫 화면이 전 차종 표라, 예전처럼 마지막으로 보던 차의 상세로 들어간다(그 줄을 누른다) */
const toGarage = async (p = page) => { await carTable(p); if (await p.locator('[data-act="gopen"]').count()) { const id = await p.evaluate(() => window.__car.garageId); await p.locator(id >= 0 && (await p.locator(`[data-act="gopen"][data-id="${id}"]`).count()) ? `[data-act="gopen"][data-id="${id}"]` : '[data-act="gopen"]').first().click(); } };
const overflowOf = (pg) => pg.evaluate(() => { const p = document.getElementById('panel'); return Math.max(document.documentElement.scrollWidth - window.innerWidth, p.scrollWidth - p.clientWidth); }); // 1.3.0 가로 넘침만(화면·패널)
const overflow = () => G(() => { const p = document.getElementById('panel'); return Math.max(document.documentElement.scrollWidth - window.innerWidth, document.body.scrollHeight - window.innerHeight, p.scrollWidth - p.clientWidth); }); // 화면 가로 넘침, 본문 세로 스크롤, 패널 안 가로 넘침
/** 시험이 출시 가능해질 때까지 진행 */
/** 출시하기: 결함이 많다는 확인 창이 뜨면 "그래도 출시" */
const launchNow = async () => { await act('doLaunch'); if (await page.locator('#ask').isVisible()) await page.click('#ask-yes'); };
/** 기획 마지막 단계(예산·기간)로 가서 개발 시작 */
const startDev = async () => { await act('ptab', '[data-v="budget"]'); await act('startDev'); };
/** [신차 기획] → (차종이 있으면 첫 화면에서) 새 차종 만들기 */
const planNew = async () => { await act('plan'); if ((await G(() => window.__car.screen)) === 'start') await act('pickNew'); if ((await G(() => window.__car.planTab)) === 'sum') await act('ptab', '[data-v="body"]'); }; // 0.8.0: 요약에서 시작하면 첫 단계(차체)로
/** 메뉴 열기: 혹시 열린 결과 창이 있으면 먼저 닫는다(가려진 #menubtn을 누르려고 끝없이 기다리는 일을 막음) */
const openMenu = async () => { if (await page.locator('#sheet').isVisible()) await page.locator('#sheet [data-act="closeReview"],#sheet [data-act="closeSheet"]').first().click(); await openSave(page); await page.waitForSelector('#sheet:not([hidden])'); };
const monthsSinceLaunch = () => G(() => { const s = window.__car.game.state, g = s.nameplates[0].generations.at(-1); return Math.floor(s.week / 4) - g.launchMonth; });
/** 두 그림(data URL)의 화소 차이: 채널당 평균 절댓값(0~255). 크기가 다르면 999 */
const imgDiff = (a, b) => G(async ([a, b]) => {
  const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
  const [A, B] = await Promise.all([load(a), load(b)]), w = A.width, h = A.height;
  if (B.width !== w || B.height !== h) return 999;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.drawImage(A, 0, 0); const da = g.getImageData(0, 0, w, h).data; g.clearRect(0, 0, w, h); g.drawImage(B, 0, 0); const db = g.getImageData(0, 0, w, h).data;
  let s = 0; for (let i = 0; i < da.length; i++) s += Math.abs(da[i] - db[i]); return s / da.length;
}, [a, b]);
const frontOf = (genId) => G((id) => window.__car.stage.renderThumb(window.__car.genLook(id), 200, 140, -Math.PI / 2), genId);
const untilReady = () => G(() => { const c = window.__car; let i = 0; while (i++ < 60) { const p = c.game.state.projects[0]; if (p.phase === 'test' && p.testWeeks >= 2) break; c.tick(1); } c.render(); });

await page.goto(URL0);
await page.waitForSelector('#title:not([hidden])');
const titleText = await page.locator('#title').innerText();
check('타이틀: 게임 이름·버전·새 게임 버튼', titleText.includes('카 컴퍼니') && /v\d+\.\d+\.\d+/.test(titleText) && (await page.locator('[data-act="titleNew"]').count()) === 1, titleText.split('\n')[0]);
check('타이틀: 처음 열면 이어 하기 없음', (await page.locator('[data-act="continue"]').count()) === 0);
await shot('title');
await act('titleNew');
await page.fill('#t-co', '테스트 모터스');
// ---- 로고 만들기 ----
await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(200);
check('새 게임(1024×768): 이름·난이도·[회사 세우기]가 스크롤 없이 첫 화면에', await G(() => ['#t-co', '[data-act="diff"]', '[data-act="startNew"]'].every((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })));
await page.setViewportSize({ width: 1366, height: 1024 });
await page.click('.logo-det summary');
const lg0 = await page.locator('.lg-prev').innerHTML();
check('로고 만들기: 처음은 기본 로고(둥근 사각·사선 줄무늬)', lg0.includes('#14171c') && lg0.includes('#ff5a1f') && (await page.locator('[data-act="lg"][data-k="shape"]').count()) >= 6 && (await page.locator('[data-act="lg"][data-k="mark"]').count()) >= 9);
await act('lgRand');
check('로고 [무작위]: 미리 보기가 바뀜', (await page.locator('.lg-prev').innerHTML()) !== lg0);
await act('lg', '[data-k="shape"][data-v="shield"]'); await act('lg', '[data-k="bg"][data-v="#1f4fd1"]'); await act('lg', '[data-k="fg"][data-v="#ffffff"]');
await act('lg', '[data-k="mark"][data-v="text"]');
await page.fill('#lg-text', 'TM');
const lg1 = await page.locator('.lg-prev').innerHTML();
check('로고 만들기: 모양·색·글자를 바꾸면 미리 보기가 바뀜', lg1.includes('>TM<') && lg1.includes('#1f4fd1') && lg1.includes('data-shape="shield"'), lg1.slice(0, 80));
check('로고 만들기: 회사 이름 입력은 그대로', (await page.inputValue('#t-co')) === '테스트 모터스');
await shot('logo-maker');
// ---- 난이도 ----
check('새 게임: 난이도 세 개(쉬움·보통·어려움), 기본은 쉬움', (await page.locator('[data-act="diff"]').count()) === 3 && (await page.locator('[data-act="diff"][data-v="easy"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('.diffs').innerText()).includes('구제 금융'));
await act('diff', '[data-v="normal"]'); // 아래 점검 수치는 "보통" 기준
await act('startNew');
check('고른 난이도가 상태에 들어감(보통)', (await G(() => window.__car.game.state.difficulty)) === 'normal');
check('새 게임: 상단바 로고 = 만든 로고', (await page.locator('#mylogo').innerHTML()).includes('>TM<') && (await page.locator('#mylogo').innerHTML()).includes('#1f4fd1'));
check('새 게임: 회사 이름·날짜·현금 표시', (await page.locator('#co').innerText()) === '테스트 모터스' && (await page.locator('#date').innerText()).startsWith('1970년 1월') && (await page.locator('#cash').innerText()).includes('억'), `${await page.locator('#date').innerText()} ${await page.locator('#cash').innerText()}`);
// ---- 5.0.0 새 뼈대: 새 판의 첫 화면은 오늘 탭, 아래 주 메뉴 7탭, 오늘 탭 두 칸(가로) ----
check('5.0.0 새 판의 첫 화면은 오늘 탭', (await G(() => window.__car.screen)) === 'today' && (await page.locator('#tabs button[data-tab="today"]').getAttribute('aria-current')) === 'page');
check('5.0.0 아래 주 메뉴 7탭(오늘·차·연구·사람·그룹·시장·재무), 모두 button·44px 이상', (await page.locator('#tabs button').allInnerTexts()).map((t) => t.trim()).join() === '오늘,차,연구,사람,그룹,시장,재무' && await G(() => [...document.querySelectorAll('#tabs button')].every((b) => b.tagName === 'BUTTON' && b.getBoundingClientRect().height >= 44)));
check('5.0.0 위쪽 줄: 날짜·현금·빠르기·다음 일까지·메뉴만(회사 이름·평판·할 일·소리는 메뉴 안)', await G(() => ['#date', '#cash', '#speeds', '#skipbtn', '#menubtn'].every((q) => document.querySelector(q).getBoundingClientRect().width > 0) && ['#co', '#rep', '#todobtn', '#mutebtn'].every((q) => document.querySelector(q).getBoundingClientRect().width === 0)));
check('5.0.0 오늘 탭(1366×1024): 두 칸(왼쪽 내가 정할 일 + 오른쪽 상세), 맨 위 일이 골라져 있음', (await page.locator('#panel .today.wide .td-l').count()) === 1 && (await page.locator('#panel .td-r').count()) === 1 && (await page.locator('.td-wrap.on').count()) === 1 && (await page.locator('.td-wrap').first().getAttribute('class')).includes('on'));
await shot('today-start');
await page.click('#tabs button[data-tab="car"]');
check('5.0.0 차 탭: 왼쪽 목록(개발 현황·새 차 기획)과 무대', (await page.locator('#side .cl-new').isVisible()) && (await page.locator('#side [data-act="devTab"]').count()) === 1 && (await page.locator('#stage').isVisible()));
check('차고(빈): 첫 차 안내와 신차 기획 버튼', (await page.locator('#ov').innerText()).includes('첫 차를 기획할 차례입니다') && (await page.locator('#ov [data-act="plan"]').count()) === 1);
check('3D 캔버스가 있음', await page.locator('#cv').isVisible());
await page.waitForTimeout(600);
await shot('garage-empty');

// ---- 기획 ----
await act('plan', '');
check('차종이 없으면 [신차 기획]이 첫 화면 없이 바로 새 차종 기획으로', (await G(() => window.__car.screen)) === 'plan' && (await page.locator('.choice').count()) === 0);
check('첫 게임의 첫 차: 단계별 기획이 기본, [한 화면 요약으로 보기] 버튼', (await G(() => window.__car.draft.mode)) === 'step' && (await G(() => window.__car.planTab)) === 'body' && (await page.locator('[data-act="planMode"][data-v="sum"]').count()) === 1);
check('기획 화면: 결정 중 자동 멈춤', (await G(() => window.__car.screen)) === 'plan' && (await G(() => window.__car.held())) && ((await page.locator('#held').isVisible()) || (await page.locator('#speeds.held').count()) === 1)); // 0.9.0 1400px 이하는 빠르기 테두리로 표시
check('기획 첫 단계: [이전] 없음, [다음]만 있고 [개발 시작] 없음', (await page.locator('#panel [data-act="ptab"]:not([role])').allInnerTexts()).join() === '다음 →' && (await page.locator('[data-act="startDev"]').count()) === 0);
check('새 차종 기획 단계에 "모양" 단계가 차체 다음', (await page.locator('#panel [role="tab"]').allInnerTexts()).map((t) => t.replace(/\s+/g, '')).slice(0, 3).join() === '1차체,2모양,3고객층');
await page.fill('#pname', '미라지');
check('기획: 이름 입력이 무대 글자에 반영', (await page.locator('#ov .model').innerText()).includes('미라지'));
await act('ptab', '[data-v="seg"]'); await act('pick', '[data-k="segment"][data-v="family"]');
// ---- 용어 설명(ⓘ · 길게 누르기) ----
const famOn = () => page.locator('[data-k="segment"][data-v="family"]').getAttribute('aria-pressed');
await page.locator('[data-k="segment"][data-v="youth"] .ib').click();
check('ⓘ 누르기: 설명 창이 뜨고 선택은 그대로', (await G(() => window.__car.tip?.key)) === 'seg:youth' && (await page.locator('#tip').isVisible()) && (await famOn()) === 'true', (await G(() => window.__car.tip?.text ?? '')).slice(0, 40));
await shot('info-seg');
await page.locator('#tip [data-tipclose]').click();
check('설명 창 [닫기]', (await G(() => window.__car.tip)) === null);
await page.locator('[data-k="segment"][data-v="rich"] .ib').click();
await page.locator('#panel h3').first().click();
check('설명 창 바깥을 누르면 닫힘', (await G(() => window.__car.tip)) === null);
{ const b = await page.locator('[data-k="segment"][data-v="youth"]').boundingBox(); await page.mouse.move(b.x + 20, b.y + b.height - 14); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.waitForTimeout(100); }
check('타일 길게 누르기: 설명 창이 뜨고 선택은 바뀌지 않음', (await G(() => window.__car.tip?.key)) === 'seg:youth' && (await famOn()) === 'true');
await page.locator('#panel h3').first().click();
await act('pick', '[data-k="segment"][data-v="youth"]');
check('타일 짧게 누르기: 선택됨', (await page.locator('[data-k="segment"][data-v="youth"]').getAttribute('aria-pressed')) === 'true' && (await G(() => window.__car.tip)) === null);
await act('pick', '[data-k="segment"][data-v="family"]');
check('능력치 이름 옆 ⓘ(성능·연비·실용·디자인·품질)', (await page.locator('.plan-est [data-info^="stat:"]').count()) === 5);
await act('ptab', '[data-v="power"]'); await act('pick', '[data-k="tier"][data-v="3"]');
await act('ptab', '[data-v="opt"]');
check('장비(1.1.0): 1970년 시작엔 연구한 장비가 없어 라디오는 흐리게 이유, 3단계 버튼 없음', (await page.locator('.eq-row.off[data-eq="radio"]').innerText()).includes('연구') && (await page.locator('[data-act="eqSet"][data-k="radio"]').count()) === 0);
await act('ptab', '[data-v="dir"]');
check('개발 방향: 10점을 다 쓰면 + 버튼이 막힘', await page.locator('[data-act="dir"][data-k="P"][data-v="1"]').isDisabled());
await act('dir', '[data-k="E"][data-v="-1"]');
check('중간 단계: [이전]·[다음]이 있고 [개발 시작]은 안 보임', (await page.locator('#panel [data-act="ptab"]:not([role])').allInnerTexts()).join() === '← 이전,다음 →' && (await page.locator('[data-act="startDev"]').count()) === 0);
await startDev();
check('점수가 남은 채 개발 시작: 개발 방향 단계로 이동 + 이유 표시, 개발 안 됨', (await G(() => window.__car.game.state.projects.length)) === 0 && (await page.locator('#panel [role="tab"][data-v="dir"]').getAttribute('aria-selected')) === 'true' && (await page.locator('#toasts').innerText()).includes('점 남았습니다'));
await act('dir', '[data-k="P"][data-v="1"]');
await act('ptab', '[data-v="budget"]');
check('마지막 단계: [이전]·[개발 시작]만 있고 비활성 [다음] 없음', (await page.locator('#panel [data-act="ptab"]:not([role])').allInnerTexts()).join() === '← 이전' && (await page.locator('#panel [data-act="startDev"]').isEnabled()) && (await page.locator('#panel button:disabled').count()) === 0);
await page.waitForTimeout(500);
await shot('plan');
const estText = await page.locator('#panel').innerText();
check('기획: 예상 등급·예상 개발비 표시', estText.includes('예상 등급') && estText.includes('예상 개발비'));
await act('startDev');
check('개발 시작: 프로젝트 1개, 개발 화면', (await G(() => window.__car.game.state.projects.length)) === 1 && (await G(() => window.__car.screen)) === 'dev' && (await G(() => window.__car.game.state.projects[0].name)) === '미라지');

// ---- 시간 진행(실제 빠르기) ----
await page.click('#speeds button[data-speed="4"]');
const w0 = await G(() => window.__car.game.state.week);
await page.waitForTimeout(2300);
const w1 = await G(() => window.__car.game.state.week);
check('아주 빠름(4배): 실제 시간으로 주가 흐름(1주 = 0.75초)', w1 - w0 >= 2 && w1 - w0 <= 4, `${w0} → ${w1}`);
check('빠르기 버튼: 멈춤·보통·빠름·아주 빠름', (await page.locator('#speeds button').allInnerTexts()).join() === '멈춤,보통,빠름,아주 빠름');
await page.click('#speeds button[data-speed="0"]');
await tick(3);
check('개발 진행: 단계·능력치 막대·결함·주간 기록', (await page.locator('#panel').innerText()).includes('남은 결함') && (await page.locator('#panel .log li').count()) >= 3 && (await page.locator('#panel .stat').count()) === 5);
await page.waitForTimeout(400);
await shot('dev');
check('설계 중에는 출시 준비 버튼이 막힘', await page.locator('[data-act="toLaunch"]').isDisabled());
await untilReady();
check('시험 2주 뒤 출시 준비 버튼이 열림', !(await page.locator('[data-act="toLaunch"]').isDisabled()));
check('시험 단계: 결함이 많으면 "아직 많습니다" 경고', (await page.locator('#panel .defect-adv[data-level="many"]').count()) === 1 && (await page.locator('#panel .defect-adv').innerText()).includes('아직 많습니다'), `결함 약 ${await G(() => window.__car.game.state.projects[0].defectEst)}개`);
check('시험 단계: 남은 기간 어림(결함 5개 이하까지·0개까지 주 수, 출시 기준 ⓘ)', /결함 5개 이하까지 약 \d+주 · 0개까지 약 \d+주/.test(await page.locator('#panel .eta').innerText()) && (await page.locator('#panel .eta [data-info="term:출시 기준 결함"]').count()) === 1, await page.locator('#panel .eta').innerText());
await page.waitForTimeout(400);
await shot('dev-test');

// ---- 출시 ----
await act('toLaunch');
check('출시 화면: 결정 중 멈춤, 예상 평점·예상 월 판매', (await G(() => window.__car.held())) && (await page.locator('#panel').innerText()).includes('예상 월 판매'));
const ltop = `${await page.locator('#keys').innerText()}\n${await page.locator('#panel .launch-check').innerText()}`; // 0.9.0 점검 수치는 무대 아래 띠, 경고는 오른쪽 칸
check('출시 화면 점검(무대 아래 띠 + 경고 카드): 남은 결함·경고·예상 리콜 위험', ltop.includes('남은 결함') && ltop.includes('아직 많습니다') && /연 \d+\s*%/.test(ltop.replace(/\n/g, ' ')), ltop.replace(/\n/g, ' ').slice(0, 80));
check('예상 월 판매: 출시 3개월째 기준 어림임을 표시', /출시 3개월째 기준 어림: 한 달에 약 \d+~\d+대\(±30%, 공장 한도 300대\)/.test(await page.locator('#panel .sales-fc').innerText()));
check('출시 화면: 화면에 붙어 있는(sticky·fixed) 버튼 줄 없음', await G(() => [...document.querySelectorAll('#panel *')].every((el) => !['sticky', 'fixed'].includes(getComputedStyle(el).position))));
check('출시 화면(0.9.0): [출시하기]가 오른쪽 칸 맨 위 출시 요약 카드의 마지막 버튼 줄(바로 위 요약)', await G(() => { const card = document.querySelector('#panel .pcol:nth-child(2) > .card:first-child'), rows = card ? card.querySelectorAll('.row') : [], last = rows[rows.length - 1]; return !!last && card?.contains(last) && last.lastElementChild?.dataset.act === 'doLaunch' && last.firstElementChild?.dataset.act === 'devHome' && card.querySelector('.launch-sum')?.textContent.includes('이 조건으로 출시합니다'); }));
await page.locator('#panel [data-act="devHome"]').click();
check('출시 화면 [← 개발 화면으로]: 개발 화면으로 돌아감', (await G(() => window.__car.screen)) === 'dev');
await act('toLaunch');
await page.waitForTimeout(600);
await shot('launch-many');
await act('doLaunch');
check('결함이 많으면 출시 전에 확인 창', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-yes').innerText()) === '그래도 출시' && (await page.locator('#ask-no').innerText()) === '시험 더 하기' && (await page.locator('#ask-text').innerText()).includes('결함'));
await shot('launch-ask');
await page.click('#ask-no');
check('확인 창 "시험 더 하기": 출시하지 않고 개발 화면으로', (await G(() => window.__car.screen)) === 'dev' && (await G(() => window.__car.game.state.nameplates.length)) === 0);
await act('toLaunch');
const basePx = await G(() => window.__car.launch.price); // 출시 화면 기본값 = 시장 기준가(10만원 단위)
await page.$eval('#lprice', (el) => { el.value = '1300'; el.dispatchEvent(new Event('input', { bubbles: true })); });
check('가격 슬라이더가 가격 표시를 바꿈', (await page.locator('#lprice-out').innerText()).includes('1,300'));
await act('lset', '[data-k="color"][data-v="#1f4fd1"]');
await act('lset', '[data-k="wheels"][data-v="2"]');
await carTable(page); await page.click('#tabs button[data-tab="group"]'); await devHome(page); await act('toLaunch');
check('출시 준비 값(가격·색·휠)이 다른 탭에 다녀와도 유지', (await page.locator('#lprice-out').innerText()).includes('1,300') && (await G(() => { const l = window.__car.launch; return l?.color === '#1f4fd1' && l.wheels === 2; })));
await act('bestPx');
{ const r = await G(() => { const c = window.__car, s = c.game.state, L = c.launch; return { got: L.price, want: c.Q.bestLaunchPrice(s, L.pid, L.marketing).price, slider: Number(document.getElementById('lprice').value) }; });
  check('출시 화면 [최고 이익 가격으로]: 슬라이더가 bestLaunchPrice로, "출시 3개월째 수요 기준 · 예상 월 이익" 표시', r.got === r.want && r.slider === r.want && (await page.locator('#lprice-best .best-note').innerText()).includes('출시 3개월째 수요 기준 · 예상 월 이익') && (await page.locator('#lprice-best [data-info="term:최고 이익 가격"]').count()) === 1, JSON.stringify(r)); }
await page.$eval('#lprice', (el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, basePx); // 판매 점검은 기준가로 낸다
check('색·휠 선택이 무대 글자에 반영', (await page.locator('#ov .spec').innerText()).includes('코발트') && (await page.locator('#ov .spec').innerText()).includes('큰 휠'));
await page.waitForTimeout(900);
await shot('launch');
await G(() => localStorage.setItem('car-company-reveal', '1')); // 1.3.0: 장면은 글자 단계에서 누를 때까지 기다린다
await act('doLaunch');
await page.click('#ask-yes');
await page.waitForSelector('#sheet:not([hidden])');
// ---- 1.0.0 출시 공개 장면: 어두운 무대·실루엣 → 스포트라이트 → 이름 글자, 시간 멈춤, 건너뛰기로 평론 창 ----
{ const wk0 = await G(() => window.__car.game.state.week);
  check('출시 공개 장면이 뜸(무대 캔버스가 장면 안으로 옮겨짐)', (await page.locator('#sheet .rvl').isVisible()) && (await page.locator('#sheet .rvl canvas').count()) === 1);
  await page.waitForSelector('#sheet .rvl[data-phase="title"]', { timeout: 20000 });
  await shot('reveal');
  check('공개 장면: 불이 켜지고 이름·세대 글자, 시간은 멈춤', (await page.locator('#sheet .rvl.lit.txt').count()) === 1 && (await page.locator('#sheet .rvl-txt').innerText()).includes('1세대') && (await G(() => window.__car.game.state.week)) === wk0);
  // 1.3.1 글자 단계에서 무대를 끌면 차가 돌고(마우스·터치) 장면은 닫히지 않으며, 버튼은 계속 눌린다
  { const yaw = () => G(() => window.__car.stage.table.rotation.y), bb = await page.locator('#sheet .rvl-cv').boundingBox(), cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 3;
    await G(() => window.__car.stage.setAutoRotate(false)); // 자동 회전이 섞이지 않게
    let y0 = await yaw();
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 150, cy, { steps: 8 }); await page.mouse.up();
    const ym = await yaw();
    check('공개 장면(머무는 단계): 마우스로 끌면 차가 돌고 장면은 그대로', Math.abs(ym - y0) > 0.8 && (await page.locator('#sheet .rvl').count()) === 1, `${y0.toFixed(2)} → ${ym.toFixed(2)}`);
    const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + i * 20, y: cy }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(150);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    const yt = await yaw();
    check('공개 장면(머무는 단계): 터치로 끌면 차가 돌고 장면은 그대로', Math.abs(yt - ym) > 0.8 && (await page.locator('#sheet .rvl').count()) === 1, `${ym.toFixed(2)} → ${yt.toFixed(2)}`); }
  await page.click('#sheet .rvl-skip');
  check('공개 장면 [평론 보기] 버튼은 끌기 뒤에도 눌림', await page.waitForSelector('#sheet .critic', { timeout: 10000 }).then(() => true, () => false));
  const st = await G(() => ({ ...window.__reveal }));
  check('건너뛰기 → 평론 창, 무대 캔버스는 제자리', (await page.locator('#sheet .rvl').count()) === 0 && (await page.locator('#stage #cv').count()) === 1 && st.skipped, `${JSON.stringify(st)}(프레임은 소프트웨어 렌더 참고값)`); }
// ---- 1.3.1 할 일 창이 열려 있을 때 알림이 창을 가리지 않음(세 화면 크기) ----
for (const [w, h] of [[1366, 1024], [1024, 768], [800, 1200]]) {
  const dp = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await dp.goto(URL0); await dp.waitForSelector('#title:not([hidden])');
  await dp.click('[data-act="titleNew"]'); await dp.fill('#t-co', '겹침 시험'); await dp.click('[data-act="startNew"]'); await dp.click('#tabs button[data-tab="car"]'); await dp.evaluate(() => window.__car.setSpeed(0));
  await menuItem(dp, '#todobtn'); await dp.waitForSelector('#drawer:not([hidden])');
  await dp.evaluate(() => window.__car.toast('겹침 시험 알림', 'alert', '알림', 60000, 'ov', { label: '펼쳐 보기', fn: () => {} })); await dp.waitForTimeout(600);
  const r = await dp.evaluate(() => { const a = document.getElementById('drawer').getBoundingClientRect(); return [...document.querySelectorAll('#toasts .toast:not(.out), #toasts .more')].map((x) => x.getBoundingClientRect()).filter((b) => b.width).reduce((m, b) => Math.max(m, Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))), 0); });
  check(`할 일 창과 알림이 겹치지 않음(${w}×${h})`, r === 0 && (await dp.locator('#toasts .toast .open').first().isVisible()), `겹침 ${Math.round(r)}px²`);
  await dp.context().close();
}
await G(() => localStorage.setItem('car-company-reveal', '0'));
await page.waitForTimeout(4200);
const rv = await page.locator('#sheet').innerText();
check('리뷰: 평론가 4명·평균·신문', (await page.locator('#sheet .critic').count()) === 4 && (await page.locator('#sheet .critic.wait').count()) === 0 && rv.includes('모터 데일리') && rv.includes('평균'));
check('출시: 판매 중 차 1대, 가격 기준가·코발트·큰 휠', await G((bp) => { const g = window.__car.game.state.nameplates[0]?.generations[0]; const e = g?.editions[0]; return g?.status === 'onSale' && e.price === bp && e.color === '#1f4fd1' && e.wheels === 2; }, basePx), `기준가 ${basePx}만원`);
await shot('review');
await act('closeReview');
await page.waitForTimeout(300);
check('차고: 이름 아래 줄과 카드에 출시 연월', /^\d{4}년 \d+월 출시 · /.test(await page.locator('#ov .spec.when').innerText()) && /\d{4}년 \d+월 출시/.test(await page.locator('#keys .launch-when, #panel .launch-when').innerText()), await page.locator('#ov .spec.when').innerText());
check('출시 순간 3D 사진이 저장 데이터에 들어감', await G(() => Object.values(window.__car.ui.photos).some((x) => x.startsWith('data:image/jpeg'))));

// ---- 판매 ----
await tick(12);
const gen = await G(() => window.__car.game.state.nameplates[0].generations[0]);
check('기준가로 출시: 석 달 안에 판매 발생', gen.totalSold > 0 && gen.sales.length >= 2, `누적 ${gen.totalSold}대, 달별 ${gen.sales.join(',')}`);
await tick(4);
const gtext = `${await page.locator('#keys').innerText()}\n${await page.locator('#panel').innerText()}`; // 0.9.0 핵심 수치는 무대 아래 띠
check('차고 카드: 판매·누적·대당 이익·평론·수명·조언·단종 버튼', ['지난달 판매', '누적 판매', '대당 이익', '평론 평균', '수명'].every((t) => gtext.includes(t)) && (await page.locator('#keys .advice, #panel .advice').count()) === 1 && (await page.locator('[data-act="discontinue"]').count()) === 1);
check('차고: 출시 직후 [페이스리프트][풀체인지]는 흐리게 + 이유·남은 개월', (await page.locator('[data-act="goLift"]').isDisabled()) && (await page.locator('[data-act="goFull"]').isDisabled()) && /페이스리프트: 출시 후 18개월이 지나야 합니다\. 앞으로 \d+개월/.test(gtext) && /풀체인지: 출시 후 36개월이 지나야 합니다\. 앞으로 \d+개월/.test(gtext));
await page.$eval('#gprice', (el) => { el.value = '1500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await act('setPrice');
check('가격 변경: 1500만원 반영', (await G(() => window.__car.game.state.nameplates[0].generations[0].editions[0].price)) === 1500);
await act('setMk', '[data-v="2"]');
check('마케팅 변경', (await G(() => window.__car.game.state.nameplates[0].generations[0].marketing)) === 2);
await page.waitForTimeout(500);
await shot('garage');
// ---- 0.8.0 최고 이익 가격·자동 가격 ----
await act('bestPx', '[data-id]');
{ const r = await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; return { slider: Number(document.getElementById('gprice').value), want: c.Q.bestPrice(s, g.id).price }; });
  check('차고 [최고 이익 가격으로]: 슬라이더가 bestPrice로, "이번 달 이익 기준 · 예상 월 이익" 표시', r.slider === r.want && (await page.locator('#gprice-best .best-note').innerText()).includes('이번 달 이익 기준 · 예상 월 이익'), JSON.stringify(r)); }
await shot('garage-best');
const toMonthEnd = () => G(() => { const c = window.__car; do c.tick(1); while (c.game.state.week % 4 !== 0); });
await act('pxPolicy', '[data-v="base:105"]');
check('자동 가격 "기준가 105%": 상태에 정책, 화면에 지금 정책', await G(() => { const p = window.__car.game.state.nameplates[0].generations[0].pricePolicy; return p?.kind === 'base' && p.pct === 105; }) && (await page.locator('.policy-now').innerText()).includes('기준가 105% 유지'));
await toMonthEnd();
check('한 달 진행: 가격이 시장 기준가의 105%로 맞춰짐', await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; return g.editions.at(-1).price === Math.round(c.Q.basePriceOf(s, g.body) * 1.05 / 10) * 10; }), String(await G(() => window.__car.game.state.nameplates[0].generations[0].editions.at(-1).price)));
await act('pxPolicy', '[data-v="best"]');
const pB = await G(() => window.__car.game.state.nameplates[0].generations[0].editions.at(-1).price);
await toMonthEnd();
check('자동 가격 "최고 이익": 한 달 뒤에도 정책 유지, 가격이 10만원 단위로 갱신', await G(() => { const g = window.__car.game.state.nameplates[0].generations[0]; return g.pricePolicy?.kind === 'best' && g.editions.at(-1).price % 10 === 0; }) && (await page.locator('[data-act="pxPolicy"][data-v="best"]').getAttribute('aria-pressed')) === 'true', `${pB} → ${await G(() => window.__car.game.state.nameplates[0].generations[0].editions.at(-1).price)}`);
await page.$eval('#gprice', (el) => { el.value = '1500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await act('setPrice');
check('자동 가격 중 [가격 바꾸기]: "수동으로 돌아갑니다" 확인 창', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-text').innerText()).includes('수동으로 돌아갑니다'));
await page.click('#ask-yes');
check('확인하면 가격 1500만원·정책 수동', await G(() => { const g = window.__car.game.state.nameplates[0].generations[0]; return !g.pricePolicy && g.editions.at(-1).price === 1500; }) && (await page.locator('[data-act="pxPolicy"][data-v="manual"]').getAttribute('aria-pressed')) === 'true');

// ---- 회사·기록 ----
await page.click('#tabs button[data-tab="group"]');
check('회사 화면(5.0.0 그룹 탭): 구역 줄 그룹 종합·본사·공장·자회사, 처음은 그룹 종합. 직원·임원·사무실은 사람 탭, 세계는 시장 탭', (await page.locator('#panel .secbar button').allInnerTexts()).join() === '그룹 종합,본사,공장,자회사' && (await page.locator('#panel [data-act="cotab"][data-v="sum"]').getAttribute('aria-selected')) === 'true'
  && await (async () => { await page.click('#tabs button[data-tab="people"]'); const a = (await page.locator('#panel .secbar button').allInnerTexts()).join(); await page.click('#tabs button[data-tab="market"]'); const b = (await page.locator('#panel .secbar button').allInnerTexts()).join(); await page.click('#tabs button[data-tab="group"]'); return a === '직원,채용,직속 전담팀,임원,사무실' && b === '경쟁사,세계,시상식'; })());
await page.click('#tabs button[data-tab="fin"]');
const ctext = await page.locator('#panel').innerText();
check('재무 화면(큰 메뉴): 재무·지난달 표, 경쟁사는 시장 탭(5.0.0)', (await G(() => window.__car.screen)) === 'fin' && ctext.includes('재무') && (await page.locator('#panel .tbl').first().count()) === 1 && !ctext.includes('도요다') && ctext.includes('본사') && ctext.includes('공장')
  && await (async () => { await page.click('#tabs button[data-tab="market"]'); await page.click('#panel [data-act="sec"][data-v="rivals"]'); const t = await page.locator('#panel').innerText(); await page.click('#tabs button[data-tab="fin"]'); return t.includes('도요다'); })());
const cash0 = await G(() => window.__car.game.state.cash);
await act('borrow', '[data-v="10000"]');
check('대출 1억 받기', (await G(() => window.__car.game.state.cash)) - cash0 === 10000 && (await G(() => window.__car.game.state.loan.balance)) === 10000);
await act('repay', '[data-v="all"]');
check('모두 갚기: 확인 창(금액·남는 현금)', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-text').innerText()).includes('모두 갚을까요'));
await page.click('#ask-yes');
check('대출 모두 갚기', (await G(() => window.__car.game.state.loan.balance)) === 0);
await shot('company');
await tab5(page, 'fin', 'sec', 'records');
check('기록 탭: 낸 차와 출시 사진', (await page.locator('#panel .rec').count()) === 1 && (await page.locator('#panel .rec img').count()) === 1);
await shot('records');
await toGarage();

// ---- 저장 → 새로 고침 → 이어 하기 ----
await openMenu();
await act('saveSlot', '[data-v="slot1"]');
await page.waitForTimeout(400);
const snap = await G(() => JSON.stringify(window.__car.game.toJSON()));
await act('closeSheet');
await page.reload();
await page.waitForSelector('#title:not([hidden])');
check('타이틀 저장 칸에 회사 로고', (await page.locator('.slot.wl svg.clogo').count()) >= 1);
check('새로 고침 뒤 타이틀에 이어 하기·저장 칸 1', (await page.locator('[data-act="continue"]').count()) === 1 && (await page.locator('[data-act="loadSlot"][data-v="slot1"]').count()) === 1);
await act('loadSlot', '[data-v="slot1"]');
await page.waitForFunction(() => window.__car.game); // 불러오기는 비동기(IndexedDB)
await page.click('#speeds button[data-speed="0"]'); // 실제 시간은 멈춘다: 1배속으로 두면 점검이 길어질 때 회사가 실제로 파산해 파산 화면이 #menubtn 등을 가린다
check('저장 칸 1 불러오기: 상태 일치', (await G(() => JSON.stringify(window.__car.game.toJSON()))) === snap);
check('불러온 뒤에도 로고 유지', (await page.locator('#mylogo').innerHTML()).includes('>TM<'));
check('불러온 뒤에도 출시 사진 유지', await G(() => Object.keys(window.__car.ui.photos).length === 1));

// ---- 단종 → 두 번째 차 ----
await act('discontinue');
check('단종 확인 창(화면 안)', await page.locator('#ask').isVisible() && (await page.locator('#ask-text').innerText()).includes('생산 라인'));
await page.click('#ask-yes');
check('단종 신청: 이번 달 말 단종', (await G(() => window.__car.game.state.nameplates[0].generations[0].status)) === 'ending');
await act('plan');
check('기획 첫 화면: 3갈래 선택 + 내 차종 목록(세대·평론·누적 판매·이름값)', (await G(() => window.__car.screen)) === 'start' && (await page.locator('.choice').count()) === 3 && (await page.locator('.np').count()) === 1 && (await page.locator('.np').innerText()).includes('이름값') && (await page.locator('.np').innerText()).includes('1세대'));
check('기획 첫 화면: 단종한 차종은 다음 세대 가능, 손보기는 흐리게 + 이유', (await page.locator('.choice[data-v="full"]').isEnabled()) && (await page.locator('.choice[data-v="lift"]').isDisabled()) && (await page.locator('.choice[data-v="lift"]').innerText()).includes('판매 중인 세대만'));
await page.waitForTimeout(400);
await shot('start-discontinued');
await act('pickNew');
// ---- 0.8.0 한 화면 요약·프리셋 ----
check('두 번째 기획부터 한 화면 요약이 기본: 9줄(차체·고객층·동력·옵션·방향·외관·팀·기간·예산)과 [개발 시작], 단계 탭 없음', (await G(() => window.__car.planTab)) === 'sum' && (await page.locator('#panel .sumrow').count()) === 9 && (await page.locator('#panel [data-act="startDev"]').count()) === 1 && (await page.locator('#panel [role="tab"]').count()) === 0);
{ await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(300);
  check('1024×768: 요약 화면이 스크롤 없이 [개발 시작]까지', await G(() => { const p = document.getElementById('panel'), b = p.querySelector('[data-act="startDev"]').getBoundingClientRect(), r = p.getBoundingClientRect(); return p.scrollTop === 0 && b.bottom <= Math.min(r.bottom, innerHeight); }));
  await shot('plan-sum-1024'); await page.setViewportSize({ width: 1366, height: 1024 }); await page.waitForTimeout(200); await shot('plan-sum'); }
const seg0 = await G(() => window.__car.draft.segment), seg1 = seg0 === 'family' ? 'youth' : 'family';
await act('ptab', '[data-row="seg"]');
check('요약 줄 누르기 → 그 항목 화면(고객층), 위에 [요약] 탭', (await G(() => window.__car.planTab)) === 'seg' && (await page.locator('#panel [role="tab"][data-v="sum"]').count()) === 1);
await act('pick', `[data-k="segment"][data-v="${seg1}"]`);
await act('ptab', '[data-v="sum"]');
check('고르고 요약으로 돌아오면 그 줄에 바뀐 값', (await G(() => window.__car.planTab)) === 'sum' && (await page.locator('#panel .sumrow[data-row="seg"]').innerText()).includes(await G((id) => ({ family: '가족', youth: '청년' })[id] ?? '', seg1)));
await act('presets');
await page.fill('#preset-name', '시험 조합'); await act('presetSave');
check('프리셋 저장: 이름·고객층·차체(포함)가 UiExtra에', await G((sg) => { const p = window.__car.ui.presets; return p?.length === 1 && p[0].name === '시험 조합' && p[0].segment === sg && !!p[0].body; }, seg1) && (await page.locator('#sheet .preset').count()) === 1);
await shot('plan-presets');
await act('closeSheet');
await act('ptab', '[data-row="seg"]'); await act('pick', `[data-k="segment"][data-v="${seg0}"]`); await act('ptab', '[data-v="sum"]');
await act('presets'); await act('presetLoad', '[data-v="0"]');
check('프리셋 불러오기: 고객층이 저장한 값으로, 요약 화면으로', await G((sg) => window.__car.draft.segment === sg && window.__car.planTab === 'sum', seg1) && (await page.locator('#sheet').isHidden()));
await page.fill('#pname', '솔라');
await act('startDev');
check('요약 화면에서 바로 개발 시작', (await G(() => window.__car.game.state.projects.length)) === 1 && (await G(() => window.__car.game.state.projects[0].name)) === '솔라');
await untilReady();
await act('toLaunch');
check('두 번째 차 출시 화면', (await G(() => window.__car.screen)) === 'launch');
await launchNow();
await page.waitForSelector('#sheet:not([hidden])');
await act('closeReview');
check('두 번째 차 출시: 차종 2개, 첫 차는 단종', await G(() => { const n = window.__car.game.state.nameplates; return n.length === 2 && n[0].generations[0].status === 'discontinued' && n[1].generations[0].status === 'onSale'; }));

// ---- 생산 라인이 없을 때 출시 막기 ----
await planNew(); await startDev(); await untilReady(); await act('toLaunch');
check('생산 라인이 없으면 출시 버튼이 막히고 이유 표시', (await page.locator('[data-act="doLaunch"]').isDisabled()) && (await page.locator('#panel').innerText()).includes('모두 쓰고 있습니다') && (await page.locator('.line-fix [data-act="goWeak"]').count()) === 1 && (await page.locator('.line-fix [data-act="goCo"][data-v="factory"]').count()) === 1);
await act('goWeak');
check('라인 막힘 → [가장 안 팔리는 차 보기]: 차고의 그 차, 단종 버튼', (await G(() => window.__car.screen)) === 'garage' && (await page.locator('[data-act="discontinue"]').count()) >= 1);
await devHome(page); await act('toLaunch');
await devHome(page);
await act('cancelDev'); await page.click('#ask-yes');
check('개발 취소(확인 창)', (await G(() => window.__car.game.state.projects.length)) === 0);

// ---- 가로 넘침 ----
for (const [w, h] of [[1366, 1024], [1480, 925], [400, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  const res = [];
  for (const t of ['today', 'car', 'research', 'people', 'group', 'market', 'fin']) {
    await page.click(`#tabs button[data-tab="${t}"]`); await page.waitForTimeout(80); res.push(await overflow());
    if (t === 'group') for (const c of ['staff', 'hq', 'factory']) { await tab5(page, null, 'cotab', c); await page.waitForTimeout(60); res.push(await overflow()); }
  }
  await devHome(page); await act('plan'); await page.waitForTimeout(80); res.push(await overflow());
  if (w === 400) { await shot('phone-plan'); await carTable(page); await page.waitForTimeout(400); await shot('phone-garage'); }
  else await carTable(page);
  check(`가로 넘침·본문 스크롤 없음 ${w}×${h}`, res.every((x) => x <= 0), res.join(','));
}
await page.setViewportSize({ width: 1366, height: 1024 });

// ---- 무대 그리기: 회사·기록 탭에서는 멈춤 ----
await page.click('#tabs button[data-tab="group"]');
const offCo = await G(() => window.__car.stage?.active);
await toGarage();
check('무대가 안 보이면(회사 탭) 3D 그리기 멈춤, 차고로 오면 다시 그림', offCo === false && (await G(() => window.__car.stage?.active)) === true);

// ---- 파산 화면(점검용으로 상태를 직접 바꿈) ----
await G(() => { const s = window.__car.game.state; s.status = 'gameOver'; s.cash = -50000; s.negMonths = 6; window.__car.render(); });
check('파산 화면: 버틴 기간·낸 차·누적 판매·구제 금융·새 게임', (await page.locator('#title').innerText()).includes('파산') && (await page.locator('#title').innerText()).includes('버틴 기간') && (await page.locator('#title').innerText()).includes('구제 금융') && (await page.locator('#title [data-act="newGame"]').count()) === 1);
await page.waitForTimeout(300);
await shot('gameover');
check('파산 화면: 무대 그리기 멈춤', (await G(() => window.__car.stage?.active)) === false);

// ---- 구제 금융 → 계속 플레이 ----
const rep0 = await G(() => window.__car.game.state.reputation), wk0 = await G(() => window.__car.game.state.week);
await act('bailout');
check('구제 금융 확인 창', await page.locator('#ask').isVisible() && (await page.locator('#ask-text').innerText()).includes('구제 금융'));
await page.click('#ask-yes');
check('구제 금융: 파산 화면이 닫히고 현금 0·평판 −20으로 계속', await G(([r]) => { const s = window.__car.game.state; return s.status === 'playing' && s.cash === 0 && s.negMonths === 0 && s.loan.bailoutUsed && s.reputation === Math.max(0, r - 20); }, [rep0]) && (await page.locator('#title').isHidden()) && (await page.locator('#cash').innerText()).includes('0'));
await tick(8);
check('구제 금융 뒤 시간이 다시 흐름', (await G(() => window.__car.game.state.week)) >= wk0 + 8 && (await page.locator('#panel').isVisible()));
await G(() => { const s = window.__car.game.state; s.status = 'gameOver'; s.cash = -1; window.__car.render(); });
check('두 번째 파산: 구제 금융 버튼 비활성 + 이유', (await page.locator('#title [data-act="bailout"]').isDisabled()) && (await page.locator('#title').innerText()).includes('한 번만 받을 수 있습니다'));

// ---- 시험을 충분히 한 차(시드 1, 균등·12주·보통·표준 동력·기준가): 평론 4.0 이상, 6개월 뒤 월 30대 이상 ----
await act('newGame');
await page.fill('#t-co', '시험 모터스');
await page.click('#title details.seed-det summary');
await page.fill('#t-seed', '1');
await act('diff', '[data-v="normal"]'); await act('startNew');
await page.click('#speeds button[data-speed="0"]'); // 실제 시간은 멈추고 tick으로만 진행(시드 고정 측정)
await act('plan'); await act('ptab', '[data-v="body"]'); // 요약으로 시작하면 차체 단계로(색은 차체 단계에)
await page.locator('[data-act="pick"][data-k="color"][data-v="#1f5c4a"]').click();
check('기획 차체 단계에 색상 8가지, 고른 색 표시', (await page.locator('#panel [data-act="pick"][data-k="color"]').count()) === 8 && (await G(() => document.querySelector('[data-k="color"][aria-pressed="true"]')?.dataset.v)) === '#1f5c4a');
await startDev();
await G(() => { const c = window.__car; let i = 0; while (i++ < 80) { const p = c.game.state.projects[0]; if (p.phase === 'test' && p.testWeeks >= 2 && p.defectEst <= 5) break; c.tick(1); } c.render(); });
check('결함 5개 이하: "출시해도 좋습니다"', (await page.locator('#panel .defect-adv[data-level="ok"]').innerText()).includes('출시해도 좋습니다'), `결함 약 ${await G(() => window.__car.game.state.projects[0].defectEst)}개, 시험 ${await G(() => window.__car.game.state.projects[0].testWeeks)}주`);
// 저장 → 불러오기 뒤에도 기획 색 유지
await openMenu(); await act('saveSlot', '[data-v="slot2"]'); await page.waitForTimeout(300); await act('closeSheet');
await openMenu(); await act('loadSlot', '[data-v="slot2"]'); await page.waitForTimeout(200);
check('방금 저장했으면 불러오기 때 "사라집니다" 확인 창이 없음', !(await page.locator('#ask').isVisible())); await page.waitForTimeout(300);
await page.click('#speeds button[data-speed="0"]');
await devHome(page);
await act('toLaunch');
check('개발 중 차의 기획 색이 불러오기 뒤에도 출시 화면 기본색', (await page.locator('#ov .spec').innerText()).includes('포레스트'));
await page.waitForTimeout(600);
await shot('launch-ok');
await act('doLaunch');
check('결함이 적으면 확인 창 없이 바로 출시', !(await page.locator('#ask').isVisible()));
await page.waitForSelector('#sheet:not([hidden])');
await act('closeReview');
const good = await G(() => window.__car.game.state.nameplates[0].generations[0]);
check('충분히 시험한 차: 평론 평균 4.0 이상', good.reviewAvg >= 4, `평론 ${good.reviews.join('/')} 평균 ${good.reviewAvg.toFixed(2)}`);
await G(() => { const c = window.__car, g = c.game.state.nameplates[0].generations[0]; let i = 0; while (g.sales.length < 7 && i++ < 60) c.tick(1); });
const good6 = await G(() => window.__car.game.state.nameplates[0].generations[0].sales);
check('출시 6개월 뒤 월 판매 30대 이상', good6[6] >= 30, `달별 ${good6.join(',')}`);

// ---- 2단계: 기획 첫 화면 → 모양 고르기(시드 반영) → 사무실 ----
await devHome(page);
await page.waitForTimeout(300);
check('개발 탭(개발 없음): 쉬는 사무실 + [신차 기획]', await G(() => { const o = window.__car.office; return o.on && o.view?.phase === 'rest' && o.view.staff.length === 4; }) && (await page.locator('#office:not([hidden]) svg').count()) >= 1 && (await page.locator('#ov [data-act="plan"]').count()) === 1 && (await page.locator('#cv').isHidden()));
check('사무실이 보이면 3D 무대 그리기 멈춤', (await G(() => window.__car.stage?.active)) === false);
await page.waitForTimeout(800);
await shot('office-rest');
await act('plan');
check('기획 첫 화면(차종 있음): 3갈래, 풀체인지·손보기는 남은 개월과 함께 흐림', (await page.locator('.choice').count()) === 3 && (await page.locator('.choice[data-v="new"]').isEnabled()) && (await page.locator('.choice[data-v="full"]').isDisabled()) && /앞으로 \d+개월/.test(await page.locator('.choice[data-v="full"]').innerText()) && /앞으로 \d+개월/.test(await page.locator('.np .why').first().innerText()));
await page.waitForTimeout(400);
await shot('start');
await act('pickNew');
await act('ptab', '[data-v="look"]');
await page.waitForTimeout(300);
const looks = await G(() => [...document.querySelectorAll('.opt.look')].map((b) => ({ k: b.dataset.k, v: Number(b.dataset.v), t: b.querySelector('small')?.textContent ?? '', img: !!b.querySelector('img,svg') })));
check('모양 단계(1.0.0): 옆모습 후보 6개 + 얼굴 후보 6개, 썸네일과 한 줄 설명', looks.filter((x) => x.k === 'chassisSeed').length === 6 && looks.filter((x) => x.k === 'faceSeed').length === 6 && looks.every((x) => x.img && x.t.length > 2), looks.map((x) => x.t).join(' / '));
const pickC = looks.filter((x) => x.k === 'chassisSeed')[1].v, pickF = looks.filter((x) => x.k === 'faceSeed')[2].v;
await act('pick', `[data-k="chassisSeed"][data-v="${pickC}"]`); await act('pick', `[data-k="faceSeed"][data-v="${pickF}"]`);
await page.waitForTimeout(600);
await shot('look');
await startDev();
check('고른 모양 시드가 개발 명령에 들어감', await G(([c, f]) => { const p = window.__car.game.state.projects[0]; return p?.chassisSeed === c && p.faceSeed === f; }, [pickC, pickF]));
await tick(1);
check('개발 탭: 사무실(직원 4명, 설계 중)', await G(() => { const o = window.__car.office; return o.on && o.view?.phase === 'design' && o.view.staff.length === 4 && o.view.staff.every((x) => x.working); }));
const sc0 = await G(() => window.__car.office.scores);
await page.waitForTimeout(1900); // 점수 연출은 1.8초에 한 번까지
await tick(2);
check('한 주가 지나면 사무실에 점수 연출이 나감', (await G(() => window.__car.office.scores)) > sc0, `${sc0} → ${await G(() => window.__car.office.scores)}`);
check('사무실 칸에 위쪽 띠 높이(--office-top-inset)를 넣음', await G(() => { const v = parseFloat(document.getElementById('office').style.getPropertyValue('--office-top-inset')), h = document.querySelector('#ov .ofc').getBoundingClientRect().height; return v > 0 && Math.abs(v - h) <= 1; }));
check('사무실 위 글자는 위쪽 가장자리에만(무대 위 1/3 안)', await G(() => { const o = document.querySelector('#ov .ofc').getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(); return o.bottom <= st.top + st.height / 3; }));
check('개발 탭 배치(1366×1024): 사무실이 패널 위에 화면 폭 80% 이상으로', await G(() => { const st = document.getElementById('stage').getBoundingClientRect(), pn = document.getElementById('panel').getBoundingClientRect(); return st.bottom <= pn.top + 1 && st.width >= innerWidth * 0.8; }));
await page.waitForTimeout(1200);
await shot('office-design');
for (const [w, h] of [[1366, 1024], [1480, 925], [400, 800]]) {
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500);
  check(`개발 탭 ${w}×${h}: 본문 스크롤·가로 넘침 없음`, (await overflow()) <= 0);
  if (w === 1480) await shot('office-1480');
}
await page.setViewportSize({ width: 1366, height: 1024 });
await toGarage();
check('차고로 가면 사무실을 멈추고 3D를 다시 그림', await G(() => !window.__car.office.on && window.__car.stage?.active === true));
await devHome(page);
await page.waitForTimeout(300);
check('개발 탭 → 차고 → 개발 탭: 사무실이 살아 있음(보이고, 직원이 그려지고, 무대 칸이 넓은 배치)', await G(() => { const o = document.getElementById('office'), svg = o.querySelector('svg'), r = o.getBoundingClientRect(); return window.__car.office.on && !o.hidden && !!svg?.getAttribute('viewBox') && o.querySelectorAll('.pp').length === 4 && r.width >= innerWidth * 0.8 && r.height > 300; }));
await act('cancelDev'); await page.click('#ask-yes');

// ---- 페이스리프트(출시 18개월 뒤) ----
await toGarage();
await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; while (Math.floor(s.week / 4) - g.launchMonth < 18) c.tick(1); c.render(); });
check('18개월 뒤 차고 [페이스리프트]가 열림', await page.locator('[data-act="goLift"]').isEnabled(), `출시 ${await monthsSinceLaunch()}개월`);
// 0.4.2 수명: 출시 30개월까지 100% 유지 뒤 매달 줄어든다. 30개월이 지난 뒤에 리프트해야 수명 회복을 볼 수 있다
await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; while (Math.floor(s.week / 4) - g.launchMonth < 31) c.tick(1); c.render(); });
await act('goLift');
check('페이스리프트 화면(1.0.0): 지금 얼굴과 새 얼굴 나란히 + 새 얼굴 후보 6개', (await G(() => window.__car.screen)) === 'lift' && (await page.locator('.faces .look-cmp .cmp-col').count()) === 2 && (await page.locator('.opt.face img, .opt.face svg').count()) === 6 && (await page.locator('.look-diff').innerText()).includes('달라진 점'));
const ltext = await page.locator('#panel').innerText();
check('페이스리프트 예상: 비용·기간·디자인·수명 전후·인지도 전후', ['비용', '기간', '디자인', '수명', '인지도', '바꾼 뒤'].every((t) => ltext.includes(t)));
check('동력 단계는 낮출 수 없음', await G(() => { const g = window.__car.game.state.nameplates[0].generations[0], t = g.editions[0].tier; return [...document.querySelectorAll('[data-act="liftPick"][data-k="tier"]')].every((b) => b.disabled === Number(b.dataset.v) < t); }));
const faceImgs = await G(() => [document.querySelector('.faces .cmp-col img')?.src, ...[...document.querySelectorAll('.opt.face img')].map((i) => i.src)].filter(Boolean));
{ const d = []; for (let i = 0; i < faceImgs.length; i++) for (let j = i + 1; j < faceImgs.length; j++) d.push(await imgDiff(faceImgs[i], faceImgs[j]));
  check('페이스리프트 후보: 지금 얼굴과 후보 6개의 그림이 서로 다름', faceImgs.length === 7 && d.every((x) => x > 0.3), `최소 ${Math.min(...d).toFixed(2)}`); }
check('페이스리프트 후보: 얼굴 설명이 서로 겹치지 않음', await G(() => { const t = [...document.querySelectorAll('.opt.face small')].map((x) => x.textContent); return t.length === 6 && new Set(t).size === 6; }));
// 1.0.0 [다른 후보 보기] → 다른 6개(결정론), [처음 후보] → 처음 6개
{ const seeds = () => G(() => [...document.querySelectorAll('.opt.face')].map((b) => b.dataset.v).join());
  const p0 = await seeds(); await act('lookPage', '[data-t="face"][data-v="next"]'); const p1 = await seeds(); await act('lookPage', '[data-t="face"][data-v="first"]'); const p0b = await seeds();
  check('페이스리프트 [다른 후보 보기]: 다른 6개, [처음 후보]로 같은 6개', p1.split(',').length === 6 && p1.split(',').every((x) => !p0.split(',').includes(x)) && p0b === p0); }
// 1.0.0 직접 고르기: 전조등 칩을 누르면 그 전조등의 얼굴을 찾아 미리보기·달라진 점에 반영
await page.locator('details.lpick[data-t="face"] summary').click();
const lampChip = page.locator('details.lpick[data-t="face"] [data-act="lookWant"][data-k="lamp"]:not([disabled]):not(.now):not([data-v=""])').first();
const lampWant = await lampChip.getAttribute('data-v'), lampLabel = (await lampChip.innerText()).trim();
await lampChip.click(); await page.waitForTimeout(300);
const face2 = await G(() => window.__car.lift.faceSeed);
check('직접 고르기: 전조등을 고르면 그 전조등의 얼굴로, 달라진 점에 전조등', (await page.locator('details.lpick[data-t="face"]').getAttribute('open')) !== null && (await page.locator('.look-diff').innerText()).includes('전조등') && (await page.locator('.faces .cmp-col').nth(1).innerText()).length > 0 && (await page.locator('.pick-miss').first().innerText()).includes('찾았습니다'), `${lampWant}(${lampLabel}) → 시드 ${face2}`);
const liftGenId = await G(() => window.__car.game.state.nameplates[0].generations[0].id);
const frontBefore = await frontOf(liftGenId), candFront = await G(([id, f]) => window.__car.stage.renderThumb({ ...window.__car.genLook(id), faceSeed: f }, 200, 140, -Math.PI / 2), [liftGenId, face2]);
await page.waitForTimeout(500);
await shot('lift');
await page.locator('.lift-est').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
check('페이스리프트 예상 칸 숫자가 잘리지 않음', await G(() => [...document.querySelectorAll('.lift-est .kpi b')].every((b) => b.scrollWidth <= b.clientWidth)));
await shot('lift-est');
await act('startLift');
check('페이스리프트 시작: 종류·고른 얼굴 시드', await G(([f]) => { const p = window.__car.game.state.projects[0]; return p?.kind === 'facelift' && p.faceSeed === f; }, [face2]) && (await page.locator('#ov').innerText()).includes('페이스리프트 중'));
await untilReady();
await toGarage();
const life0 = Number(await page.locator('#keys .life').first().getAttribute('aria-valuenow')); // 리프트 출시 직전(출시 30개월 넘음)
await devHome(page);
await page.waitForTimeout(800);
await shot('office-test');
check('개발 탭: 시험 중 사무실(결함을 다 잡아 출시 대기면 쉬는 모습)', await G(() => { const p = window.__car.game.state.projects[0], ph = window.__car.office.view?.phase; return p?.waiting ? ph === 'rest' : ph === 'test'; }));
await act('toLaunch');
const fltext = await page.locator('#panel').innerText();
check('페이스리프트 출시 화면: 가격·색·휠만, 평론 예상 없음', fltext.includes('판매 가격') && fltext.includes('색상') && !fltext.includes('예상 평점') && fltext.includes('신문'));
await page.waitForTimeout(600);
await shot('lift-launch');
await launchNow();
await page.waitForSelector('#sheet:not([hidden]) .news.paper');
check('페이스리프트 출시: 평론가 대신 신문 기사 한 장', (await page.locator('#sheet .critic').count()) === 0 && (await page.locator('#sheet .news h3').innerText()).includes('페이스리프트'));
await page.waitForTimeout(300);
await shot('news');
await act('closeReview');
const lifted = await G(() => { const g = window.__car.game.state.nameplates[0].generations[0]; return { n: g.editions.length, f0: g.editions[0].faceSeed, f1: g.editions[1]?.faceSeed, id: g.editions[1]?.id }; });
check('판(edition) 2개, 얼굴 시드가 바뀜', lifted.n === 2 && lifted.f1 === face2 && lifted.f1 !== lifted.f0);
{ const frontAfter = await frontOf(liftGenId), dBA = await imgDiff(frontBefore, frontAfter), dCA = await imgDiff(candFront, frontAfter);
  check('페이스리프트 출시 뒤 차고 3D의 얼굴 시드 = 고른 후보', JSON.parse(await G(() => window.__car.look)).faceSeed === face2);
  check('페이스리프트 전·후 정면 그림이 다름', dBA > 0.3, dBA.toFixed(2));
  check('기획 때 고른 후보 썸네일 = 출시 뒤 정면 그림', dCA < 0.05, dCA.toFixed(3)); }
check('차고: 페이스리프트 연월 표시', /\d{4}년 \d+월 페이스리프트/.test(await page.locator('#ov .spec.when').innerText()), await page.locator('#ov .spec.when').innerText());
await page.waitForTimeout(300);
const life1 = Number(await page.locator('#keys .life').first().getAttribute('aria-valuenow'));
check('30개월 뒤 페이스리프트: 수명 막대 상승', life1 > life0, `${life0} → ${life1}`);
check('차고 표시: "1세대 · 페이스리프트", 페이스리프트 사진 저장', (await page.locator('#ov .model').innerText()).includes('페이스리프트') && await G((id) => !!window.__car.ui.photos['e' + id], lifted.id));
await page.waitForTimeout(500);
await shot('garage-lift');

// ---- 풀체인지(출시 36개월 뒤) ----
await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; while (Math.floor(s.week / 4) - g.launchMonth < 36) c.tick(1); c.render(); });
check('36개월 뒤 차고 [풀체인지]가 열리고, [페이스리프트]는 "세대당 1회"로 흐림', (await page.locator('[data-act="goFull"]').isEnabled()) && (await page.locator('[data-act="goLift"]').isDisabled()) && (await page.locator('#panel').innerText()).includes('세대당 1회'));
await page.waitForTimeout(400);
await shot('garage-buttons');
await act('goFull');
check('풀체인지: 전작 값(고객층·동력·등급·옵션·개발 방향·예산·설계 기간)을 물려받은 한 화면 요약에서 시작', await G(() => { const c = window.__car, d = c.draft, g = c.game.state.nameplates[0].generations.at(-1), e = g.editions.at(-1); return c.screen === 'plan' && c.planTab === 'sum' && d.segment === g.segment && d.powertrain === g.powertrain && d.tier === e.tier && JSON.stringify(d.direction) === JSON.stringify(g.plan.direction) && d.budget === g.plan.budget && d.designWeeks === g.plan.designWeeks && e.options.filter((o) => !['abs', 'airbag'].includes(o)).every((o) => d.options.includes(o)); }) && (await page.locator('#panel [data-act="startDev"]').count()) === 1 && (await page.locator('#panel').innerText()).includes('전작 대비'));
await page.waitForTimeout(500);
await shot('fullchange');
await act('ptab', '[data-v="body"]'); await act('ptab', '[data-v="prev"]');
const prevText = await page.locator('#panel').innerText();
check('풀체인지 [전 세대] 단계: 전 세대 요약(평론·누적 판매·이름값·이어받는 것)', ['평론 평균', '누적 판매', '이름값', '이어받는 것', '전작 대비'].every((t) => prevText.includes(t)) && (await page.locator('#pname').count()) === 0);
await shot('fullchange-prev');
await act('ptab', '[data-v="body"]');
const otherBody = await G(() => [...document.querySelectorAll('[data-act="pick"][data-k="body"]')].find((b) => b.getAttribute('aria-pressed') !== 'true')?.dataset.v);
const sameBody = await G(() => document.querySelector('[data-act="pick"][data-k="body"][aria-pressed="true"]')?.dataset.v);
if (otherBody) { await act('pick', `[data-k="body"][data-v="${otherBody}"]`); check('차체를 바꾸면 "이름값이 절반만" 경고', (await page.locator('.body-warn').innerText()).includes('절반만')); await act('pick', `[data-k="body"][data-v="${sameBody}"]`); }
await act('ptab', '[data-v="look"]');
check('풀체인지 모양(1.0.0): 전작과 새 모양 나란히(정면·옆) + 달라진 점, 후보 6+6, 기본 색은 전작과 다른 새 색', (await page.locator('.look-cmp .cmp-col').count()) === 2 && (await page.locator('.look-cmp img').count()) === 4 && (await page.locator('.look-diff').innerText()).includes('달라진 점') && (await page.locator('[data-act="pick"][data-k="faceSeed"]').count()) === 6
  && (await G(() => { const c = window.__car, g = c.game.state.nameplates[0].generations.at(-1); return c.draft.color !== g.editions.at(-1).color && c.draft.chassisSeed !== g.chassisSeed; })));
await shot('fullchange-look');
const fcC = Number(await page.locator('[data-act="pick"][data-k="chassisSeed"]').nth(1).getAttribute('data-v')), fcF = Number(await page.locator('[data-act="pick"][data-k="faceSeed"]').nth(2).getAttribute('data-v'));
await act('pick', `[data-k="chassisSeed"][data-v="${fcC}"]`); await act('pick', `[data-k="faceSeed"][data-v="${fcF}"]`);
await startDev();
check('풀체인지 개발 시작', await G(() => window.__car.game.state.projects[0]?.kind === 'fullchange'));
await untilReady();
await act('toLaunch');
check('풀체인지 출시 화면: 전 세대 단종 안내, 생산 라인을 이어 써서 출시 가능', (await page.locator('.prev-end').innerText()).includes('단종') && (await page.locator('[data-act="doLaunch"]').isEnabled()));
await launchNow();
await page.waitForSelector('#sheet:not([hidden])');
await page.waitForTimeout(4200);
check('풀체인지 리뷰 신문 제목: 전작 비교', /전작|진화/.test(await page.locator('#sheet .news h3').innerText()), await page.locator('#sheet .news h3').innerText());
await shot('review-full');
await act('closeReview');
{ const lk = JSON.parse(await G(() => window.__car.look)), g2 = await G(() => { const g = window.__car.game.state.nameplates[0].generations[1]; return { c: g.chassisSeed, f: g.editions[0].faceSeed }; });
  check('풀체인지: 고른 차대·얼굴 후보가 출시 뒤 차고에 그대로', lk.chassisSeed === fcC && lk.faceSeed === fcF && g2.c === fcC && g2.f === fcF, JSON.stringify([fcC, fcF, lk.chassisSeed, lk.faceSeed])); }
const fc = await G(() => { const s = window.__car.game.state, n = s.nameplates[0]; return { gens: n.generations.length, st: n.generations[0].status, end: n.generations[0].endMonth, m: Math.floor(s.week / 4), no: n.generations[1]?.number }; });
check('풀체인지 출시: 세대 2, 전 세대는 이번 달 말 단종 예정', fc.gens === 2 && fc.no === 2 && fc.st === 'ending' && fc.end === fc.m, JSON.stringify(fc));
await G(() => { const c = window.__car, s = c.game.state, m = Math.floor(s.week / 4); while (Math.floor(s.week / 4) === m) c.tick(1); c.render(); });
check('다음 달: 전 세대 단종', (await G(() => window.__car.game.state.nameplates[0].generations[0].status)) === 'discontinued');
await tab5(page, 'fin', 'sec', 'records');
await page.waitForTimeout(400);
check('기록 탭 차종 계보: 세대 2개, 단종(연·월)·판매 중·페이스리프트 표시', await G(() => { const c = document.querySelector('.lineage-card'); const t = c?.innerText ?? ''; return c?.querySelectorAll('.rec').length === 2 && /단종\(\d+년 \d+월\)/.test(t) && t.includes('판매 중') && t.includes('페이스리프트'); }));
await shot('lineage');

// ---- 폰: 알림이 맨 아래 버튼 줄을 가리지 않음 ----
await page.setViewportSize({ width: 400, height: 800 });
for (const [t, n] of [['garage', 'phone-garage2'], ['dev', 'phone-office']]) {
  if (t === 'garage') await carTable(page); else await devHome(page);
  await G(() => { window.__car.toast('알림 위치 점검 1', 'alert', '점검'); window.__car.toast('알림 위치 점검 2'); });
  await page.waitForTimeout(500);
  const pos = await G(() => { const b = document.getElementById('toasts').getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(), tabs = document.getElementById('tabs').getBoundingClientRect(); return { tb: Math.round(b.bottom), sb: Math.round(st.bottom), tabsTop: Math.round(tabs.top) }; });
  check(`폰(${t}): 알림이 무대 위쪽에 떠서 패널 버튼 줄·탭을 가리지 않음`, pos.tb <= pos.sb + 1 && pos.tb < pos.tabsTop, JSON.stringify(pos));
  await shot(n);
}
await act('plan');
await page.waitForTimeout(300);
await shot('phone-start');
check('폰: 기획 첫 화면 가로 넘침 없음', (await overflow()) <= 0);
await act('cancelPlan');
await page.setViewportSize({ width: 1366, height: 1024 });
await toGarage();

// ---- 차고가 비면 무대도 빈 원판 ----
check('판매 중인 차가 있으면 무대에 차가 있음', (await G(() => window.__car.stage?.empty)) === false);
await act('discontinue'); await page.click('#ask-yes');
await G(() => { const c = window.__car; c.tick(1); while (c.game.state.week % 4 !== 0) c.tick(1); c.tick(1); });
check('단종 뒤 차고가 비면 무대에서 차를 치움(빈 원판)', (await G(() => window.__car.stage?.empty)) === true && (await page.locator('#ov').innerText()).includes('판매 중인 차가 없습니다') && (await page.locator('#cv').isVisible()));
await shot('garage-cleared');

// ---- 3단계: 회사(직원·본사·공장), 팀 고르기, 동시 개발 ----
const S3 = (fn, arg) => G(fn, arg);
const staffN = () => S3(() => window.__car.game.state.staff.length);
await openMenu(); await act('home'); await page.waitForTimeout(150); if (await page.locator('#ask').isVisible()) await page.click('#ask-yes'); await page.waitForSelector('#title:not([hidden])');
await act('titleNew'); await page.fill('#t-co', '삼단 모터스'); await page.click('#title details.seed-det summary'); await page.fill('#t-seed', '3'); await act('diff', '[data-v="normal"]'); await act('startNew');
await page.click('#speeds button[data-speed="0"]');
await devHome(page); await page.waitForTimeout(300);
const vb1 = await S3(() => document.querySelector('#office svg')?.getAttribute('viewBox') ?? '');
await page.click('#tabs button[data-tab="group"]');
check('회사 안쪽 화면 7개(3.0.0 자회사, 4.0.0 세계)가 5.0.0 사람·그룹·시장 탭 구역 줄에 모두 있음', await (async () => { const got = []; for (const t of ['people', 'group', 'market']) { await page.click(`#tabs button[data-tab="${t}"]`); got.push(...(await page.locator('#panel .secbar [data-act="cotab"], #panel .secbar [data-act="psec"]').evaluateAll((b) => b.map((x) => x.dataset.v)))); } return ['sum', 'staff', 'exec', 'hq', 'factory', 'sub', 'world'].every((k) => got.includes(k)); })());
await tab5(page, 'people', 'psec', 'staff');
const st0 = await page.locator('#panel').innerText();
check('직원 탭: 직원 4명 표(이름·직무·능력·월급·컨디션·하는 일), 정원 4/6(0.5.0 본사 1등급 정원 6)', (await page.locator('#panel .srow:not(.head)').count()) === 4 && st0.includes('4/6') && ['디자이너', '엔지니어', '테스터', '컨디션', '쉬는 중'].every((t) => st0.includes(t)));
check('정원이 남았으면 채용 공고 3단계', (await page.locator('.hire-card [data-act="postJob"]').count()) === 3 && (await page.locator('.hire-full').count()) === 0);
await tab5(page, 'group', 'cotab', 'hq');
const hq0 = await page.locator('#panel').innerText();
check('본사 탭: 7등급 단계(3.0.0 6·7등급)·지금 등급(정원·개발 차 수·유지비, 1.1.0 옵션 칸 없음)·다음 등급 비교', (await page.locator('.lv5 li').count()) === 7 && (await page.locator('.lv5 li.on').innerText()).includes('창고 공장') && !hq0.includes('옵션 칸') && ['정원', '동시에 개발할 수 있는 차', '월 유지비', '승급 비용', '소형 사옥'].every((t) => hq0.includes(t)));
await G(() => { const s = window.__car.game.state; s.cash = 5000000; s.reputation = 40; window.__car.render(); }); // 점검용: 현금 500억·평판 40
await act('upgradeHQ');
check('본사 키우기: 확인 창', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-text').innerText()).includes('본사'));
await page.click('#ask-yes');
await act('upgradeHQ'); await page.click('#ask-yes');
const hq3 = await S3(() => { const s = window.__car.game.state; return { lv: s.hqLevel }; });
check('본사 3등급: 정원 12·개발팀 2', hq3.lv === 3 && (await page.locator('#panel .hq-cur').innerText()).includes('4/12') && (await page.locator('.lv5 li.on').innerText()).includes('본사 빌딩'), JSON.stringify(hq3));
await shot('co-hq');
await tab5(page, 'people', 'psec', 'staff');
await G(() => window.__car.setSpeed(1));
await act('postJob', '[data-v="2"]');
check('채용 후보가 오면 자동 멈춤 + 알림(남은 주)', (await G(() => window.__car.speed)) === 0 && /후보 3명이 왔습니다\. \d+주 안에 채용하지 않으면.*시간을 멈췄습니다/.test(await page.locator('#toasts').innerText()));
check('공고 → 후보 3명 카드(이름·능력·성장 여지·요구 월급·남은 주)', (await page.locator('.cand').count()) === 3 && /성장 여지 (큼|보통|작음)/.test(await page.locator('.cand').first().innerText()) && (await page.locator('.cand').first().innerText()).includes('요구 월급') && (await page.locator('[data-act="dismissCands"]').count()) === 1);
await page.waitForTimeout(300);
await shot('co-cands');
await page.locator('.cand [data-act="hire"]').first().click();
check('채용: 직원 5명, 정원 5/12 표시', (await staffN()) === 5 && (await page.locator('.hire-card .cap-n').innerText()) === '5/12');
for (let i = 0; i < 2; i++) await page.locator('.cand [data-act="hire"]').first().click();
await act('hireRole', '[data-v="sales"]');
check('영업 직무를 고르면 영업 효과 한 줄', (await page.locator('.hire-card').innerText()).includes('인지도가 빨리 오르고 법인 판매가 늘어납니다'));
await act('postJob', '[data-v="1"]');
for (let i = 0; i < 3; i++) await page.locator('.cand [data-act="hire"]').first().click();
await act('hireRole', '[data-v="engineer"]'); await act('postJob', '[data-v="1"]');
for (let i = 0; i < 2; i++) await page.locator('.cand [data-act="hire"]').first().click();
await page.locator('.cand [data-act="hire"]').first().click();
check('정원 12명이 차면 채용 거부 이유(정원)', (await staffN()) === 12 && (await page.locator('#toasts').innerText()).includes('정원(12명)이 찼습니다') && (await page.locator('.hire-full').count()) === 1);
check('정원이 찼으면 본사 탭으로 가는 버튼, 공고 명령도 거부 이유', (await page.locator('.hire-card [data-act="cotab"][data-v="hq"]').count()) === 1 && await S3(() => { const r = window.__car.game.command({ type: 'postJob', role: 'designer', tier: 1 }); return !r.ok && r.reason.includes('정원'); }));
const last = await S3(() => window.__car.game.state.staff.at(-1).id);
await page.locator(`.srow[data-id="${last}"]`).click();
await act('fire');
check('해고: 화면 안 확인 창(퇴직금)', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-text').innerText()).includes('퇴직금'));
await page.click('#ask-no');
check('해고 확인 창 "아니요": 그대로', (await staffN()) === 12);
await act('fire'); await page.click('#ask-yes');
await page.locator('.cand [data-act="hire"]').first().click();
check('해고 뒤 빈자리에 남은 후보 채용 → 12명', (await staffN()) === 12 && (await page.locator('.cand').count()) === 0);
const d1 = await S3(() => window.__car.game.state.staff.find((x) => x.role === 'designer' && x.ability < x.potential - 6));
await page.locator(`.srow[data-id="${d1.id}"]`).click();
const card = await page.locator('#staff-card').innerText();
check('직원 상세 카드: 교육(비용·효과)·휴식·배치·해고(퇴직금)', ['교육 보내기', '능력 +', '2주 쉬기', '개발 배치', '해고', '퇴직금'].every((t) => card.includes(t)));
await act('train', `[data-id="${d1.id}"]`);
const d1b = await S3((id) => window.__car.game.state.staff.find((x) => x.id === id), d1.id);
check('교육: 능력 상승 + 표에 "교육 중 n주 남음"', d1b.ability > d1.ability && (await page.locator(`.srow[data-id="${d1.id}"]`).innerText()).includes('교육 중'), `${d1.ability} → ${d1b.ability}`);
await page.waitForTimeout(300);
await shot('co-staff');
// 기획: 팀 고르기
await toGarage();
await planNew(); await page.fill('#pname', '하나'); await act('ptab', '[data-v="budget"]');
const picks = await page.locator('.pick').count();
const avg0 = Number(await page.locator('.plan-est').getAttribute('data-avg'));
const pid = await page.locator('.pick[aria-pressed="true"]').last().getAttribute('data-id');
await page.locator(`.pick[data-id="${pid}"]`).click();
const avg1 = Number(await page.locator('.plan-est').getAttribute('data-avg'));
check('기획 팀 고르기: 놀고 있는 개발 직원(영업 제외) 목록, 한 명 빼면 예상 등급이 내려감', picks === 9 && avg1 < avg0, `${picks}명, ${avg0.toFixed(2)} → ${avg1.toFixed(2)}`);
await page.waitForTimeout(400);
await shot('plan-team');
// 반만 데리고 개발 → 남은 직원으로 두 번째 차
const half = await S3(() => [...document.querySelectorAll('.pick[aria-pressed="true"]')].slice(4).map((b) => b.dataset.id));
for (const id of half) await page.locator(`.pick[data-id="${id}"]`).click();
await act('startDev');
check('고른 팀만 배치', await S3(() => { const s = window.__car.game.state, p = s.projects[0]; return s.staff.filter((x) => x.projectId === p.id).length === 4; }));
check('개발 중 빈 개발팀이 있으면 개발 탭에 [신차 기획]', (await page.locator('#panel .pchips [data-act="plan"]').count()) === 1);
await page.locator('#panel .pchips [data-act="plan"]').click(); if ((await G(() => window.__car.screen)) === 'start') await act('pickNew');
await page.fill('#pname', '두울'); await startDev();
check('개발팀 2개: 프로젝트 2개 동시 진행 + 전환 칩 2개', (await S3(() => window.__car.game.state.projects.length)) === 2 && (await page.locator('.pchip').count()) === 2 && (await page.locator('#panel .pchips [data-act="plan"]').count()) === 0);
await page.locator('.pchip').first().click();
check('전환 칩: 고른 프로젝트의 띠·사무실 표지판', (await page.locator('#ov .ofc-t b').innerText()) === '하나' && (await S3(() => window.__car.office.view.projectName)) === '하나');
await tick(2); await page.waitForTimeout(400);
const ov3 = await S3(() => ({ lv: window.__car.office.view.level, n: window.__car.office.view.staff.length, sales: window.__car.office.view.staff.some((x) => x.role === 'sales'), vb: document.querySelector('#office svg')?.getAttribute('viewBox') ?? '' }));
const vbw = (v) => Number(v.split(/\s+/)[2] ?? 0);
check('사무실: 본사 3등급·직원 12명(영업 포함)·방이 넓어짐', ov3.lv === 3 && ov3.n === 12 && ov3.sales && vbw(ov3.vb) > vbw(vb1), `${vb1} → ${ov3.vb}`);
await page.waitForTimeout(1200);
await shot('dev-two');
// 출시: 라인 1개 → 공장 증설 → 두 번째 차
await G(() => { const c = window.__car; let i = 0; while (i++ < 80 && !c.game.state.projects.every((p) => p.phase === 'test' && p.testWeeks >= 2)) c.tick(1); c.render(); });
await act('toLaunch'); await launchNow(); await page.waitForSelector('#sheet:not([hidden])'); await act('closeReview');
await tick(9);
await G(() => { const g = window.__car.game.state.nameplates[0].generations[0]; g.lastDemand = 520; g.lostSales = 520 - (g.sales.at(-1) ?? 0); window.__car.render(); }); // 점검용: 주문이 생산을 넘은 달
check('차고: 주문 상황 한 줄 + 공장 보기 버튼', /지난달 주문 520대 중 \d+대만 만들었습니다/.test(await page.locator('.order-line').innerText()));
await page.waitForTimeout(400);
await shot('garage-order');
await act('goCo', '[data-v="factory"]');
check('주문 상황 [공장 보기] → 회사 탭 공장', (await G(() => window.__car.screen)) === 'company' && (await page.locator('#panel .fac-cur').count()) === 1);
const f0 = await page.locator('#panel').innerText();
check('공장 탭: 지금 등급(월 생산·생산 라인·유지비·원가 절감)·다음 등급 비교·차종별 생산·조언', ['한 달 생산', '생산 라인', '월 유지비', '원가 절감', '증설 뒤', '차종별 생산', '지난달 주문'].every((t) => f0.includes(t)) && (await page.locator('.prod').count()) === 1);
await act('expandFactory');
check('공장 증설: 확인 창(공사 6개월)', (await page.locator('#ask-text').innerText()).includes('6개월'));
await page.click('#ask-yes');
check('공사 중 표시(남은 달·진행 막대), 다시 증설 버튼은 막힘', (await page.locator('.build').innerText()).includes('개월 남았습니다') && (await page.locator('[data-act="expandFactory"]').isDisabled()));
await page.waitForTimeout(300);
await shot('co-factory-build');
await G(() => { const c = window.__car; let i = 0; while (i++ < 40 && c.game.state.factory.level < 2) c.tick(1); c.render(); });
const fac = await S3(() => window.__car.game.state.factory);
check('6개월 뒤 공장 2등급: 월 생산 1,000·생산 라인 3(0.5.1)', fac.level === 2 && !fac.build && (await page.locator('.fac-cur').innerText()).includes('1,000') && /1\/3/.test(await page.locator('.fac-cur').innerText()), JSON.stringify(fac));
check('증설 완료 알림(회사)', (await page.locator('#toasts').innerText()).includes('증설을 마쳤습니다'));
await devHome(page);
await page.locator('.pchip').last().click().catch(() => {});
await act('toLaunch'); await launchNow(); await page.waitForSelector('#sheet:not([hidden])'); await act('closeReview');
check('두 번째 차 동시 판매(생산 라인 2/3)', (await S3(() => window.__car.game.state.nameplates.filter((n) => n.generations.some((g) => g.status === 'onSale')).length)) === 2 && (await page.locator('#ov .lines').innerText()) === '2/3');
await tick(5);
await tab5(page, 'group', 'cotab', 'factory');
const gids = await S3(() => window.__car.game.state.nameplates.map((n) => n.generations[0].id));
await act('allocManual', `[data-id="${gids[0]}"]`);
check('직접 배분: 슬라이더가 나옴', (await page.locator(`.alloc-r[data-gen="${gids[0]}"]`).count()) === 1);
await page.$eval(`.alloc-r[data-gen="${gids[0]}"]`, (el) => { el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
check('직접 배분 80% 적용', (await S3((id) => window.__car.game.state.nameplates[0].generations[0].allocShare, gids[0])) === 0.8);
await act('allocManual', `[data-id="${gids[1]}"]`);
await page.$eval(`.alloc-r[data-gen="${gids[1]}"]`, (el) => { el.value = '50'; el.dispatchEvent(new Event('change', { bubbles: true })); });
check('직접 배분 합이 100%를 넘으면 이유 표시, 적용 안 됨', (await page.locator('.alloc-why').innerText()).includes('100%') && (await S3(() => window.__car.game.state.nameplates[1].generations[0].allocShare)) <= 0.2);
await page.waitForTimeout(300);
await shot('co-factory');
await page.click('#tabs button[data-tab="fin"]');
check('재무: 일회성 지출 줄, 유지비 본사·공장 나눔', (await page.locator('#panel').innerText()).includes('본사 유지비') && (await page.locator('#panel').innerText()).includes('공장 유지비') && (await page.locator('#panel').innerText()).includes('본사'));
await shot('co-fin');
for (const [w, h] of [[1366, 1024], [1480, 925], [400, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  const res = [];
  for (const c of ['fin', 'staff', 'hq', 'factory']) { if (c === 'fin') await page.click('#tabs button[data-tab="fin"]'); else { await page.click('#tabs button[data-tab="group"]'); await tab5(page, null, 'cotab', c); } await page.waitForTimeout(100); res.push(await overflow()); if (w !== 1366 && (c === 'staff' || c === 'factory')) await shot(`${w === 400 ? 'phone' : 'w1480'}-${c}`); }
  await devHome(page); await page.waitForTimeout(300); res.push(await overflow());
  await page.click('#tabs button[data-tab="group"]');
  check(`3단계 회사 탭·동시 개발 ${w}×${h}: 본문 스크롤·가로 넘침 없음`, res.every((x) => x <= 0), res.join(','));
}
await page.setViewportSize({ width: 1366, height: 1024 });
await devHome(page);
await G(() => { window.__car.toast('알림 1', 'alert', '점검'); window.__car.toast('알림 2'); window.__car.toast('알림 3'); });
await page.waitForTimeout(400);
check('넓은 개발 탭: 알림은 사무실 칸 오른쪽 위(띠 아래)에 최대 2개', await G(() => { const t = [...document.querySelectorAll('#toasts .toast')].filter((x) => getComputedStyle(x).display !== 'none'), st = document.getElementById('stage').getBoundingClientRect(), band = document.querySelector('#ov .ofc').getBoundingClientRect(), r = document.getElementById('toasts').getBoundingClientRect(); return t.length === 2 && r.top >= band.bottom - 1 && r.right <= st.right && r.left > st.left + st.width / 2 && r.bottom < st.bottom; }));
await shot('dev-toasts');

// ---- 0.1.0 형식 저장 불러오기 ----
await openMenu();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
await chooser.setFiles('car/tests/fixtures/save-v1.json');
await page.waitForSelector('#ask:not([hidden])'); await page.click('#ask-yes');
await page.waitForFunction(() => window.__car.game?.state.companyName === '변환테스트');
await tick(4);
await devHome(page); await tab5(page, 'fin', 'sec', 'records'); await toGarage();
check('0.1.0 형식 저장(형식 1) 불러와 이어 하기', await G(() => { const c = window.__car, s = c.game.state; return s.saveVersion >= 4 && s.nameplates.length > 0 && typeof c.ui.photos === 'object' && typeof c.ui.colors === 'object'; }) && (await page.locator('#panel').isVisible()));
await openMenu();
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
await chooser2.setFiles('car/tests/fixtures/save-v2.json');
await page.waitForSelector('#ask:not([hidden])'); await page.click('#ask-yes');
await page.waitForFunction(() => window.__car.game?.state.companyName === '변환테스트2');
await tick(4);
for (const t of ['car', 'fin', 'research', 'market', 'people', 'group']) await page.click(`#tabs button[data-tab="${t}"]`);
for (const c of ['staff', 'hq', 'factory']) await tab5(page, null, 'cotab', c);
await toGarage();
check('0.2.0 형식 저장(형식 2) 불러와 이어 하기', await G(() => { const s = window.__car.game.state; return s.saveVersion >= 4 && s.hqLevel === 1 && s.staff.every((x) => typeof x.potential === 'number'); }) && (await page.locator('#panel').isVisible()));

await openMenu();
const [chooser3] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
await chooser3.setFiles('car/tests/fixtures/save-v3.json');
await page.waitForSelector('#ask:not([hidden])'); await page.click('#ask-yes');
await page.waitForFunction(() => window.__car.game?.state.saveVersion >= 4 && window.__car.game.state.week > 0);
await tick(4);
for (const t of ['car', 'fin', 'research', 'market', 'people', 'group']) await page.click(`#tabs button[data-tab="${t}"]`);
for (const c of ['staff', 'hq', 'factory']) await tab5(page, null, 'cotab', c);
await tab5(page, 'fin', 'sec', 'records'); for (const r of ['combo', 'news', 'cars']) await tab5(page, null, 'rectab', r);
await toGarage();
check('0.3.0 형식 저장(형식 3) 불러와 이어 하기(연구·사건·조합 노트 채워짐)', await G(() => { const s = window.__car.game.state; return s.saveVersion >= 4 && Array.isArray(s.research.done) && Array.isArray(s.knownCombos) && !!s.events; }) && (await page.locator('#panel').isVisible()));

// ---- 4단계: 연구·시대 사건·조합 노트·차체 10종 ----
const S4 = (fn, arg) => G(fn, arg);
await openMenu();
check('메뉴: 역사 사건·시장 수치는 게임에 맞게 어림한 것이라는 한 줄', (await page.locator('#sheet .help-line').innerText()).includes('어림한 것'));
await act('home'); await page.waitForTimeout(150); if (await page.locator('#ask').isVisible()) await page.click('#ask-yes'); await page.waitForSelector('#title:not([hidden])');
await act('titleNew'); await page.fill('#t-co', '사단 모터스'); await page.click('#title details.seed-det summary'); await page.fill('#t-seed', '4'); await act('diff', '[data-v="normal"]'); await act('startNew');
await page.click('#speeds button[data-speed="0"]');
await page.click('#tabs button[data-tab="group"]');
check('5.0.0 주 메뉴 7탭(오늘·차·연구·사람·그룹·시장·재무), 버튼 44px 이상', (await page.locator('#tabs button').allInnerTexts()).map((x) => x.trim()).join() === '오늘,차,연구,사람,그룹,시장,재무' && await G(() => [...document.querySelectorAll('#tabs button')].every((b) => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })));
await page.click('#tabs button[data-tab="research"]');
const r0 = await page.locator('#panel').innerText();
check('연구 화면: 분야 5개와 기술 카드 40개 이상', (await page.locator('.rfield').count()) === 5 && (await page.locator('.tc').count()) >= 40 && ['동력', '차체·안전', '편의 장비', '생산', '친환경'].every((t) => r0.includes(t)));
check('연구 화면: 놀고 있는 엔지니어의 주간 연구 점수가 0보다 큼', /한 주에 [\d.]+점/.test(r0) && (await S4(() => window.__car.game.state.staff.some((x) => x.role === 'engineer'))) && !r0.includes('연구 점수가 0'), r0.match(/한 주에 [\d.]+점/)?.[0]);
check('연구 카드: 일찍 연구 할증 표시(해치백 차체 비용 2배)', (await page.locator('.tc[data-v="bd_hatch"]').innerText()).includes('일찍 연구: 비용 2배'));
check('아직 먼 기술은 이름만 흐리게', (await page.locator('.tc.hidden[data-v="ec_ev"]').count()) === 1 && !(await page.locator('.tc[data-v="ec_ev"]').innerText()).includes('배터리'));
await page.waitForTimeout(200); await shot('research-early');
await page.locator('.tc[data-v="bd_hatch"]').click();
const td = await page.locator('.tech-sheet').innerText();
check('기술 상세 글자: 효과·비용·연구 점수·예상 기간·"세계 최초" 안내', ['효과', '비용', '연구 점수', '예상 기간', '세계 최초'].every((t) => td.includes(t)), td.replace(/\n/g, ' ').slice(0, 90));
await page.waitForTimeout(600); await shot('tech-detail');
await act('startResearch');
check('연구 시작: 화면 안 확인 창', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-text').innerText()).includes('연구를 시작할까요'));
await page.waitForTimeout(600); await shot('tech-ask');
await page.click('#ask-yes');
check('연구 시작: 진행 중 1개, 카드에 진행 막대와 남은 주', (await S4(() => window.__car.game.state.research.active.length)) === 1 && (await page.locator('.tc.active[data-v="bd_hatch"] .prog').count()) === 1 && /약 \d+주 남음/.test(await page.locator('.tc.active[data-v="bd_hatch"]').innerText()) && (await page.locator('.ract').count()) === 1);
// 0.4.2: 연구 칸은 본사 등급별(1등급 3칸). 1970년에는 연구할 수 있는 기술이 적어, 점검용으로 진행 중 연구 2개를 상태에 직접 넣어 칸을 채운다
const filled = await S4(() => { const c = window.__car, s = c.game.state, ids = ['ec_light', 'pw_carb'].filter((v) => !s.research.done.includes(v)); for (const v of ids) s.research.active.push({ techId: v, points: 0, need: 9999, startWeek: s.week }); c.render(); return ids; });
const fullWhy = await S4(() => { const r = window.__car.game.command({ type: 'startResearch', techId: 'el_radio' }); return r.ok ? 'ok' : r.reason; });
check('연구 칸(1등급 3칸)이 차면 다른 기술은 시작 거부 이유(화면·명령)', (await S4(() => window.__car.game.state.research.active.length)) === 3 && fullWhy.includes('연구 칸') && (await page.locator('.tc[data-v="el_radio"] .why').innerText()).includes('연구 칸이 찼습니다'), fullWhy);
await S4((ids) => { const s = window.__car.game.state; s.research.active = s.research.active.filter((a) => !ids.includes(a.techId)); window.__car.render(); }, filled);
await tick(3); await page.waitForTimeout(100);
await shot('research-active');
await S4(() => { const c = window.__car; let i = 0; while (i++ < 200 && c.game.state.research.active.length) c.tick(1); c.render(); });
check('연구 완료 알림', (await page.locator('#toasts').innerText()).includes('연구 완료') && (await S4(() => window.__car.game.state.research.done.includes('bd_hatch'))));
await shot('unlock-toast');
check('연구 완료 알림 문장: 이름이 겹치지 않음', (await page.locator('#toasts').innerText()).includes('「해치백 차체」 연구를 마쳤습니다. 이제 해치백을 만들 수 있습니다.'));
check('연구 완료 뒤 카드 ✓ 완료', (await page.locator('.tc.done[data-v="bd_hatch"]').count()) === 1);
// 기획: 연구한 차체만 열림, 나머지는 흐리게 "연구 필요"
await toGarage(); await planNew();
check('기획 차체: 연구한 해치백이 열림', (await page.locator('[data-act="pick"][data-k="body"][data-v="hatch"]').count()) === 1);
check('기획 차체 12종(0.6.0 SUV 소·중·대): 미해금은 흐리게 "연구 필요: ○○"', (await page.locator('.opt[data-k="body"], .opt.locked[data-lock^="body:"]').count()) === 12 && (await page.locator('.opt.locked[data-lock="body:sedanM"]').innerText()).includes('연구 필요: 중형 세단 차체'));
await page.waitForTimeout(400); await shot('plan-bodies');
await page.locator('.opt.locked[data-lock="body:sedanM"]').click();
check('흐린 차체를 누르면 연구 화면의 그 기술 상세로', (await S4(() => window.__car.screen)) === 'research' && (await page.locator('.tech-sheet[data-tech="bd_sedanM"]').count()) === 1);
await act('techClose');
check('연구 화면에 [← 기획으로 돌아가기]', (await page.locator('[data-act="backPlan"]').count()) === 1);
await act('backPlan');
check('기획으로 돌아감(초안 유지)', (await S4(() => window.__car.screen)) === 'plan' && (await page.locator('#pname').count()) === 1);
// 동력 종류: 상태를 맞춰 디젤·전기 해금
await S4(() => { const s = window.__car.game.state; s.research.done.push('pw_carb', 'pw_diesel', 'ec_light', 'pw_efi', 'ec_hybrid', 'ec_ev', 'el_radio', 'el_aircon', 'el_powerSteering', 'el_autoTrans', 'el_leather', 'bd_abs'); s.cash = 3000000; window.__car.render(); });
await act('ptab', '[data-v="power"]');
check('동력 종류 4개(가솔린·디젤·하이브리드·전기) 선택', (await page.locator('.seg.pts [data-act="pick"][data-k="powertrain"]').count()) === 4);
await act('pick', '[data-k="powertrain"][data-v="ev"]');
await page.waitForTimeout(500);
const pv = await page.locator('#panel').innerText();
check('전기 동력: 원가 가산·충전소 안내·실제 단계 표시', (await page.locator('.pt-add').innerText()).includes('35%') && (await page.locator('.charge').innerText()).includes('충전 인프라') && /전기 \d+단계/.test(await page.locator('.opt .lv').first().innerText()), (await page.locator('.charge').innerText()).slice(0, 40));
check('전기차 3D(막힌 그릴 모양 값)·원가 표시', (await S4(() => window.__car.look)).includes('"powertrain":"ev"') && pv.includes('대당 원가'));
const costEv = await page.locator('.plan-est').innerText();
await act('pick', '[data-k="powertrain"][data-v="gasoline"]');
check('가솔린으로 바꾸면 대당 원가가 내려감(전기 가산 반영)', costEv !== (await page.locator('.plan-est').innerText()));
await act('pick', '[data-k="powertrain"][data-v="ev"]'); await page.waitForTimeout(400);
await shot('plan-ev');
await act('pick', '[data-k="powertrain"][data-v="gasoline"]');
await act('ptab', '[data-v="seg"]');
check('궁합: 출시해 본 적 없는 조합은 "?" + "출시해 보면 알 수 있습니다"', (await page.locator('.opt .tag.q').count()) === 6 && (await page.locator('.opt .tag.q').first().innerText()).includes('출시해 보면 알 수 있습니다'));
await shot('plan-combo');
await act('ptab', '[data-v="opt"]');
check('장비(1.1.0): 해금한 장비 8개는 3단계 버튼, 나머지는 흐리게', (await page.locator('.eq-row:not(.off):not(.req)').count()) === 8 && (await page.locator('.eq-row:not(.off):not(.req) [data-act="eqSet"]').count()) === 24);
await shot('plan-options');
await act('pick', '[data-k="body"][data-v="sedanS"]').catch(() => {});
await page.fill('#pname', '조합');
await startDev();
await untilReady(); await act('toLaunch'); await launchNow(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(4200); await act('closeReview');
await tab5(page, 'fin', 'rectab', 'combo');
check('출시 뒤 조합 노트에 궁합 기호·차 이름·평론', (await page.locator('.combo td.cn:not(.q)').count()) === 1 && /[◎○△×]/.test(await page.locator('.combo td.cn:not(.q)').innerText()) && (await page.locator('.combo td.cn:not(.q)').innerText()).includes('조합') && (await page.locator('.combo tr.off').count()) >= 7);
await shot('combo-notes');
await toGarage(); await planNew(); await act('ptab', '[data-v="seg"]');
check('기획 고객층: 출시해 본 조합은 궁합 기호로', (await page.locator('.opt .tag.mk').count()) === 1 && /[◎○△×]/.test(await page.locator('.opt .tag.mk').innerText()));
await act('cancelPlan');
// 선택 사건: 시간을 보내 무작위 사건을 발생시킨다(창 띄우기 켬)
await S4(() => { const c = window.__car; let i = 0; while (i++ < 400 && !c.game.state.events.pending.length) c.tick(1, true); });
await page.waitForTimeout(300);
check('5.0.0 선택 사건: 창 없이 자동 멈춤 + 위쪽 [정할 일 n건]', (await page.locator('#sheet').isHidden()) && (await S4(() => window.__car.speed)) === 0 && (await page.locator('#decbtn').isVisible()) && (await page.locator('#toasts').innerText()).includes('결정 대기'));
await page.click('#decbtn');
check('선택 사건: 오늘 탭 상세에 창 없이 열림(제목·설명·선택지·효과·남은 주, 자동 승인 체크)', (await G(() => window.__car.screen)) === 'today' && (await page.locator('#panel .td-r .choice-sheet').isVisible()) && (await page.locator('#sheet').isHidden()) && (await page.locator('.evc').count()) >= 2 && /\d+주 안에 고르지 않으면 「.+」(으)?로 정해집니다/.test(await page.locator('.choice-sheet').innerText()) && (await page.locator('#panel .auto-chk input').count()) === 1);
await page.waitForTimeout(600); await shot('choice');
await act('later');
check('[나중에]: 오늘 탭의 다음 일로, 메뉴 안 "결정 대기 1"', (await page.locator('#panel .choice-sheet').count()) === 0 && (await page.locator('#pend').getAttribute('aria-label')).startsWith('결정 대기 1건') && (await page.locator('#pend b').innerText()) === '1');
await shot('pending');
await menuItem(page, '#pend');
const pick0 = await page.locator('.evc b').first().innerText();
await page.locator('.evc').first().click();
check('선택: 대기 0, 결과 알림, 뉴스에 결과', (await S4(() => window.__car.game.state.events.pending.length)) === 0 && (await page.locator('#toasts').innerText()).includes('결정 결과') && (await S4(() => window.__car.game.state.events.news.at(-1).text)).includes(pick0.split(' (')[0].split('\n')[0]) && (await page.locator('#pend').isHidden()));
// 진행 중 사건 칩(1차 오일쇼크)
await S4(() => { const c = window.__car; let i = 0; while (i++ < 600 && !document.getElementById('evchip').textContent.includes('오일쇼크')) c.tick(1); c.render(); });
if (await page.locator('#sheet').isVisible()) await page.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click();
await topOpen(page);
check('메뉴 안 사건 칩(5.0.0): 사건 이름(0.9.0: 1400px 이하는 "사건 · N개월"로 줄이고 이름·전체 문구는 title)', ((await page.locator('#evchip').innerText()).startsWith('1차 오일쇼크') || (await G(() => getComputedStyle(document.getElementById('evchip'), '::before').content)) === '"사건"') && (await page.locator('#evchip .ev-n').textContent()).startsWith('1차 오일쇼크') && (await page.locator('#evchip').getAttribute('title')).startsWith('1차 오일쇼크 · '), `${await page.locator('#evchip').innerText()} / ${await page.locator('#evchip').getAttribute('title')}`);
await menuItem(page, '#evchip');
check('사건 창: 효과(쉬운 말)·충전소 보급률·필수 옵션', (await page.locator('.events-sheet').innerText()).includes('연비') && (await page.locator('.events-sheet').innerText()).includes('충전 인프라') && (await page.locator('.events-sheet').innerText()).includes('꼭 필요한 옵션'));
await page.waitForTimeout(600); await shot('events');
await act('closeSheet');
await toGarage();
await S4(() => { const g = window.__car.game.state.nameplates[0].generations[0]; g.body = 'sedanL'; window.__car.render(); }); // 점검용: 차고 카드의 사건 영향 줄
check('차고 카드: 이 차가 받는 사건 영향 한 줄', (await page.locator('.ev-line').allInnerTexts()).some((t) => t.includes('1차 오일쇼크: 이 차는 대형 세단이라 35% 덜 팔립니다.')));
await page.waitForTimeout(400); await shot('garage-event');
await S4(() => { const g = window.__car.game.state.nameplates[0].generations[0]; g.body = 'sedanS'; window.__car.render(); });
await tab5(page, 'fin', 'rectab', 'news');
check('기록 뉴스: 최신이 위, 예고와 사건 시작 구분', (await page.locator('.nl').count()) >= 2 && (await page.locator('.nl.k-preview').count()) >= 1 && (await page.locator('.nl.k-start').count()) >= 1 && (await S4(() => window.__car.game.state.events.news.at(-1).text)).endsWith(await page.locator('.nl .nt').first().innerText().then((t) => t.replace(/^[^:]*: /, ''))));
await page.locator('.nl.k-start').first().click();
check('뉴스를 누르면 신문 한 장(지금 걸린 효과)', (await page.locator('#sheet .news.paper').isVisible()) && (await page.locator('#sheet').innerText()).includes('효과'));
await page.waitForTimeout(600); await shot('news-paper');
await act('closeReview');
await tab5(page, 'fin', 'sec', 'records'); await page.waitForTimeout(200);
await shot('news-list');
// 알림 정리: 회사 탭에서 최대 2개 + "+N"
await page.click('#tabs button[data-tab="fin"]');
await G(() => { document.getElementById('toasts').innerHTML = ''; for (let i = 1; i <= 4; i++) window.__car.toast(`점검 알림 ${i}`, 'alert', '점검', 20000); });
await page.waitForTimeout(400);
const tpos = await G(() => { const vis = [...document.querySelectorAll('#toasts .toast')].filter((x) => getComputedStyle(x).display !== 'none'), r = document.getElementById('toasts').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(); return { n: vis.length, more: document.querySelector('#toasts .more')?.textContent ?? '', top: Math.round(r.top), topBar: Math.round(top.bottom), right: Math.round(innerWidth - r.right) }; });
check('회사 탭 알림: 오른쪽 위(상단바 아래)에 최대 2개 + "+N"', tpos.n === 2 && tpos.more.startsWith('+2 ') && tpos.top >= tpos.topBar && tpos.right <= 24, JSON.stringify(tpos));
await shot('co-toasts');
await G(() => document.querySelectorAll('#toasts .toast .x').forEach((b) => b.click()));
// 전담 연구원(본사 4등급)
await S4(() => { const s = window.__car.game.state; s.hqLevel = 4; window.__car.render(); });
await tab5(page, 'people', 'psec', 'staff');
const eng = await S4(() => window.__car.game.state.staff.find((x) => x.role === 'engineer' && x.projectId === null)?.id);
await page.locator(`.srow[data-id="${eng}"]`).click();
await act('assign', `[data-id="${eng}"][data-v="lab"]`);
check('본사 4등급: [전담 연구원으로] → 전담 연구원', (await S4((id) => window.__car.game.state.staff.find((x) => x.id === id).lab, eng)) && (await page.locator(`.srow[data-id="${eng}"]`).innerText()).includes('전담 연구원'));
// 일괄 교육(0.6.0): 두 명을 골라 한 번에 교육 → 둘 다 교육 중
{ const two = await S4(() => { const s = window.__car.game.state; s.cash = Math.max(s.cash, 1e6); const xs = s.staff.slice(0, 2); for (const x of xs) { x.trainings = []; x.restUntil = null; x.ability = Math.min(x.ability, x.potential - 3); } window.__car.render(); return xs.map((x) => x.id); });
  const box = await page.locator(`.s-pick[data-id="${two[0]}"]`).boundingBox();
  for (const id of two) await page.locator(`.s-pick[data-id="${id}"]`).click();
  await act('trainPicked'); const askT = await page.locator('#ask-text').innerText(); await page.click('#ask-yes');
  check('일괄 교육: 두 명을 골라 교육 보내기 → 둘 다 교육 중, 확인 창에 인원·총 비용', await S4((ids) => { const s = window.__car.game.state; return ids.every((id) => s.staff.find((x) => x.id === id).trainings.includes(s.week)); }, two) && /2명을 교육 보낼까요\?\n총 비용/.test(askT) && (await page.locator(`.srow[data-id="${two[0]}"]`).innerText()).includes('교육 중'), askT.replace(/\n/g, ' | '));
  check('일괄 교육 고르기 칸: 터치 44px 이상', box.width >= 44 && box.height >= 44, `${box.width}×${box.height}`); }
// 1990년쯤 연구 화면
await S4(() => { const s = window.__car.game.state; s.week = 20 * 48; s.research.done.push('bd_sedanM', 'pr_line', 'pr_qc', 'bd_sedanL', 'el_leather'); window.__car.render(); });
await page.click('#tabs button[data-tab="research"]'); await page.waitForTimeout(200);
await shot('research-mid');
check('선행이 필요한 기술: 이유 "「미니밴 차체」 먼저"', (await page.locator('.tc[data-v="bd_suv"]').innerText()).includes('「미니밴 차체」 먼저') && (await page.locator('.tc[data-v="bd_suv"]').getAttribute('class')).includes('locked'), await page.locator('.tc[data-v="bd_suv"]').innerText());
await page.locator('.tc[data-v="bd_suv"]').click();
check('선행 필요 기술 상세: 연구 시작 막힘 + 거부 이유', (await page.locator('.tech-sheet [data-act="startResearch"]').isDisabled()) && (await page.locator('.tech-why').innerText()).includes('먼저'));
await act('techClose');
// 규제(1997년, 0.4.2): 의무 장비 기술을 연구하지 않았으면 개발 시작이 막힘 → 연구 → 기본 장비로 자동 포함(옵션 칸 밖) → 판매 중 차에 의무 장비 넣기
await S4(() => { const s = window.__car.game.state; s.week = 27 * 48; s.factory.level = 2; s.cash = 3000000; s.research.done = s.research.done.filter((x) => x !== 'bd_airbag'); if (!s.research.done.includes('bd_abs')) s.research.done.push('bd_abs'); window.__car.render(); }); // 점검용: 생산 라인 2개
await toGarage();
check('규제 미연구: 차 카드에 막힌 이유 한 번 + [연구 화면], 페이스리프트·풀체인지·의무 장비 넣기 막힘', (await page.locator('#panel .reg-block').innerText()).includes('「에어백」 연구가 필요합니다') && (await page.locator('#panel .reg-block [data-act="goCo"][data-v="research"]').count()) === 1 && (await page.locator('[data-act="goFull"]').isDisabled()) && (await page.locator('[data-act="retrofit"]').isDisabled()));
await shot('reg-garage');
await page.locator('#panel [data-act="plan"]').first().click();
check('규제 미연구: 기획 첫 화면에 이유 한 번, 새 차종·풀체인지·페이스리프트 모두 흐림', (await G(() => window.__car.screen)) === 'start' && (await page.locator('#panel .reg-block').innerText()).includes('지금은 개발을 시작할 수 없습니다') && (await page.locator('.choice:disabled').count()) === 3 && (await page.locator('.choice .why').count()) === 0);
await shot('reg-start');
check('sim 개발 시작 명령도 같은 이유로 거부', await S4(() => { const r = window.__car.game.command({ type: 'startProject', name: '규제', body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28, team: [] }); return !r.ok && r.reason.includes('에어백'); }));
// 에어백 연구 시작 → 개발자 메뉴(로고 두 번 누르기) [진행 중 연구 즉시 완료]
await S4(() => { const s = window.__car.game.state; s.research.active = []; const r = window.__car.game.command({ type: 'startResearch', techId: 'bd_airbag' }); window.__car.render(); return r; });
await menuItem(page, '#mylogo', true);
await page.waitForSelector('#sheet:not([hidden])'); await page.locator('#sheet [data-act="devCheat"][data-v="finishResearch"]').click(); await act('closeSheet');
check('개발자 메뉴로 에어백 연구 완료 → 기획 첫 화면이 다시 열림', (await S4(() => window.__car.game.state.research.done.includes('bd_airbag'))) && (await page.locator('#panel .reg-block').count()) === 0 && (await page.locator('.choice[data-v="new"]').isEnabled()));
await act('pickNew'); await act('ptab', '[data-v="opt"]');
const slots = await S4(() => window.__car.game.state.hqLevel);
check('기획 장비(1.1.0): ABS·에어백은 기본 장비로 고정(잠금 표시), 단계 버튼 없음', (await page.locator('.eq-row.req[data-eq="abs"] .eq-lock, .eq-row.req[data-eq="airbag"] .eq-lock').count()) === 2 && (await page.locator('[data-act="eqSet"][data-k="abs"], [data-act="eqSet"][data-k="airbag"]').count()) === 0, `본사 ${slots}등급`);
await shot('reg-plan');
await page.fill('#pname', '규제'); await startDev();
check('개발 시작: 의무 장비가 자동으로 들어감', await S4(() => { const o = window.__car.game.state.projects[0]?.options ?? []; return o.includes('abs') && o.includes('airbag'); }));
await devHome(page); await act('cancelDev'); await page.click('#ask-yes');
await toGarage();
await page.locator('[data-act="retrofit"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
await shot('reg-retrofit');
const rfId = Number(await page.locator('[data-act="retrofit"]').getAttribute('data-id'));
check('판매 중 차: [의무 장비 넣기]가 열림(비용·대당 원가 안내)', (await page.locator('[data-act="retrofit"]').isEnabled()) && /ABS·에어백.*대당 원가 \+\d+만원/.test(await page.locator('.retrofit').innerText()));
await act('retrofit');
check('의무 장비 넣기: 판매 중 차의 옵션에 ABS·에어백, 버튼 사라짐', await S4((id) => { const s = window.__car.game.state, g = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === id), o = g.editions.at(-1).options; return o.includes('abs') && o.includes('airbag'); }, rfId) && (await page.locator('[data-act="retrofit"]').count()) === 0);
// 페이스리프트·풀체인지 옵션 추가(0.6.0 버그): 판 옵션에 의무 장비가 들어 있어도 빈 칸만큼 새 옵션을 고를 수 있다(본사 4등급 칸 4개 중 2개 사용 + 의무 장비 2개)
{ const want = await S4((id) => { const c = window.__car, s = c.game.state, g = s.nameplates.flatMap((n) => n.generations).find((x) => x.id === id), ed = g.editions.at(-1);
    g.launchMonth = Math.min(g.launchMonth, Math.floor(s.week / 4) - 40); ed.options = ['radio', 'leather', 'abs', 'airbag']; ed.equip = { leather: 'std' }; delete ed.equipLegacy; /* 1.1.0 판의 구성은 equip(라디오는 빠진 채: 풀체인지에서 기대 변화로 나오게) */ for (const t of ['el_radio', 'el_aircon', 'el_leather']) if (!s.research.done.includes(t)) s.research.done.push(t); c.render(); return 'aircon'; }, rfId);
  await page.locator(`[data-act="goLift"][data-id="${rfId}"]`).click();
  const lv = (v) => page.locator(`[data-act="eqSet"][data-t="lift"][data-k="${want}"][data-v="${v}"]`), est = () => page.locator('.lift-est').innerText();
  await lv('').click(); const pv0 = await est();
  await lv('std').click(); const pvStd = await est();
  check('페이스리프트(의무 장비 있는 차): 장비를 기본 장비로 넣을 수 있음(1.1.0 장비 수 제한 없음)', (await lv('std').getAttribute('aria-pressed')) === 'true' && await S4((w) => window.__car.lift.equip?.[w] === 'std' && window.__car.lift.options.includes(w), want), JSON.stringify(await S4(() => window.__car.lift.equip)));
  check('페이스리프트 장비 추가가 예상(등급·이익)에 반영', pv0 !== pvStd);
  await lv('opt').click(); const pvOpt = await est(), live = await S4(() => typeof window.__car.Q.equipInfo === 'function');
  check('1.1.0 3단계 전환(안 넣음·선택 사양·기본 장비)이 예상에 반영(규칙 연결 뒤에는 선택 사양도 따로)', (await lv('opt').getAttribute('aria-pressed')) === 'true' && (!live || (pvOpt !== pvStd && pvOpt !== pv0)), live ? '규칙 연결됨' : '규칙 연결 전(선택 사양은 어림값)');
  await act('cancelPlan');
  const np = await S4((id) => window.__car.game.state.nameplates.find((n) => n.generations.some((g) => g.id === id)).id, rfId);
  await page.locator(`[data-act="goFull"][data-id="${np}"]`).click(); await act('ptab', '[data-v="opt"]');
  check('1.1.0 풀체인지: 전작 장비 구성을 물려받음(전작 구성)', await S4(() => window.__car.draft.equipMode === 'prev' && window.__car.draft.equip?.leather === 'std'), JSON.stringify(await S4(() => window.__car.draft.equip)));
  if (await page.locator('.eq-chg').count()) { await page.click('.eq-chg [data-act="eqApply"]'); check('1.1.0 풀체인지: 전작 이후 기대가 바뀐 장비 상자 → [한 번에 반영]하면 상자가 사라짐', (await page.locator('.eq-chg').count()) === 0); }
  else check('1.1.0 풀체인지: 전작 이후 기대가 바뀐 장비 상자', false, '상자가 없음');
  await page.locator(`[data-act="eqSet"][data-t="plan"][data-k="${want}"][data-v="std"]`).click();
  check('풀체인지(의무 장비 있는 차): 장비를 기본 장비로 넣을 수 있음', await S4((w) => window.__car.draft.options.includes(w), want), JSON.stringify(await S4(() => window.__car.draft.options)));
  await page.click('[data-act="eqNone"][data-t="plan"]');
  check('1.1.0 [모두 빼기] → 빠진 기대 장비 경고("판매와 평론이 깎입니다")', (await page.locator('.eq-miss').innerText().catch(() => '')).includes('깎입니다') && await S4(() => Object.keys(window.__car.draft.equip).length === 0));
  await page.click('[data-act="eqRec"][data-t="plan"]');
  check('1.1.0 [추천 구성으로] → 장비가 다시 들어가고 "추천 구성" 표시, 경고 사라짐', await S4(() => window.__car.draft.equipMode === 'rec' && Object.keys(window.__car.draft.equip).length > 0) && (await page.locator('.eq-miss').count()) === 0 && (await page.locator('.eq-mode').innerText()) === '추천 구성');
  { await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(200);
    const cut = await G(() => [...document.querySelectorAll('.eq-row')].filter((r) => r.scrollWidth > r.clientWidth + 1 || [...r.querySelectorAll('button, b, .eq-eff')].some((x) => x.scrollWidth > x.clientWidth + 1)).map((r) => r.dataset.eq));
    check('1.1.0 장비 줄(1024×768): 이름·버튼·효과가 잘리지 않음, 버튼 44px', !cut.length && await G(() => [...document.querySelectorAll('.eq-row [data-act="eqSet"]')].every((b) => b.getBoundingClientRect().height >= 44)), JSON.stringify(cut));
    if (process.argv[3]) await page.screenshot({ path: `${process.argv[3]}/o2/fullchange-equip-1024x768.png` }).catch(() => {});
    await page.setViewportSize({ width: 1366, height: 1024 }); }
  await act('cancelPlan'); }
// 새 차체 7종 3D(0.6.0 소형·대형 SUV 포함)
await S4(() => { const s = window.__car.game.state; s.research.done.push('bd_minivan', 'bd_kei', 'bd_suv', 'bd_suvS', 'bd_suvL', 'bd_pickup', 'bd_coupe', 'bd_sports'); window.__car.render(); });
await planNew();
{ const order = await page.locator('[data-k="body"]').evaluateAll((els) => els.map((e) => e.dataset.v).join(','));
  check('차체 줄: 세단·SUV가 크기 순으로 묶임', order.includes('sedanS,sedanM,sedanL') && order.includes('suvS,suv,suvL'), order); }
for (const b of ['sedanL', 'minivan', 'kei', 'suvS', 'suvL', 'pickup', 'sports']) {
  await act('pick', `[data-k="body"][data-v="${b}"]`); await page.waitForTimeout(700);
  check(`새 차체 ${b}: 기획 화면 3D에 그려짐`, (await S4(() => window.__car.look)).includes(`"bodyId":"${b}"`) && (await S4(() => window.__car.stage?.empty)) === false);
  await shot(`body-${b}`);
}
await act('ptab', '[data-v="power"]'); await shot('plan-power');
// 넘침 점검
for (const [w, h] of [[1366, 1024], [1480, 925], [400, 800]]) {
  await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300);
  const res = [];
  for (const t of ['body', 'power', 'seg', 'opt']) { await act('ptab', `[data-v="${t}"]`); res.push(await overflow()); }
  if (w !== 1366) await shot(`${w === 400 ? 'phone' : 'w1480'}-plan`);
  await act('cancelPlan');
  await page.click('#tabs button[data-tab="research"]'); await page.waitForTimeout(200); res.push(await overflow());
  if (w !== 1366) await shot(`${w === 400 ? 'phone' : 'w1480'}-research`);
  await tab5(page, 'fin', 'sec', 'records');
  for (const r of ['combo', 'news', 'cars']) { await tab5(page, null, 'rectab', r); res.push(await overflow()); }
  await menuItem(page, '#evchip'); await page.waitForTimeout(600); if (w === 400) await shot('phone-events'); await act('closeSheet');
  await carTable(page); await page.waitForTimeout(200); res.push(await overflow());
  check(`4단계 화면(기획·연구·기록·차고) ${w}×${h}: 본문 스크롤·가로 넘침 없음`, res.every((x) => x <= 0), res.join(','));
  await planNew();
}
await act('cancelPlan');
// 폰: 선택 사건 창
await S4(() => { const c = window.__car; let i = 0; while (i++ < 600 && !c.game.state.events.pending.length) c.tick(1, true); });
if (await page.locator('#decbtn').isVisible()) await page.click('#decbtn');
if (await page.locator('.choice-sheet').count()) { await page.waitForTimeout(700); await shot('phone-choice'); check('폰: 선택 사건(오늘 탭 한 칸, 그 자리에서 펼침) 가로 넘침 없음', (await page.locator('#panel .today.narrow .td-in .choice-sheet').count()) === 1 && (await overflowOf(page)) <= 0); await act('later'); }
await page.setViewportSize({ width: 1366, height: 1024 });

// 전기차 앞모습(막힌 그릴): 점검용으로 판매 중인 차를 전기로 바꿔 차고 무대를 정면으로 돌린다
await toGarage();
await S4(() => { const c = window.__car, g = c.game.state.nameplates.flatMap((n) => n.generations).find((x) => x.status === 'onSale'); if (!g) return; g.powertrain = 'ev'; c.render(); c.stage?.setAutoRotate(false); c.stage?.setYaw(-Math.PI / 2); });
await page.waitForTimeout(900);
check('전기차 앞모습: 무대에 전기차(막힌 그릴 모양 값)', (await S4(() => window.__car.look)).includes('"powertrain":"ev"'));
await shot('ev-front');

// ---- 9. 기획 초안: 탭을 옮겨도·저장했다 불러와도 남고, [그만두기]로만 사라짐 ----
await S4(() => window.__car.stage?.setAutoRotate(true));
await toGarage();
if (await G(() => window.__car.game.state.projects.length)) { await devHome(page); while (await G(() => window.__car.game.state.projects.length)) { await act('cancelDev'); await page.click('#ask-yes'); } }
await planNew();
await page.fill('#pname', '초안차');
await act('ptab', '[data-v="look"]'); await page.locator('[data-act="pick"][data-k="faceSeed"]').nth(2).click();
await act('ptab', '[data-v="opt"]'); if (await page.locator('[data-act="eqSet"][data-v="std"][aria-pressed="false"]').count()) await page.locator('[data-act="eqSet"][data-v="std"][aria-pressed="false"]').first().click();
await act('ptab', '[data-v="dir"]'); await act('dir', '[data-k="E"][data-v="-1"]'); await act('dir', '[data-k="P"][data-v="1"]');
const draft0 = await G(() => JSON.stringify(window.__car.draft));
await toGarage();
check('기획 중 다른 탭: 차 탭에 "기획 중" 점(5.0.0)', await G(() => document.querySelector('#tabs button[data-tab="car"]').classList.contains('has-draft')));
await page.click('#tabs button[data-tab="research"]'); await tab5(page, 'fin', 'sec', 'records');
await devHome(page);
const keep = (d) => { const a = JSON.parse(d), b = JSON.parse(draft0); delete a.year; delete b.year; return JSON.stringify(a) === JSON.stringify(b); };
check('기획 → 차고 → 회사(연구) → 기록 → 개발 탭: 하던 단계·이름·모양·옵션·방향 그대로', (await G(() => window.__car.screen)) === 'plan' && (await G(() => window.__car.planTab)) === 'dir' && keep(await G(() => JSON.stringify(window.__car.draft))) && (await page.inputValue('#pname')) === '초안차');
await tick(6); await toGarage(); await tick(6); await devHome(page);
check('시간이 흘러도 초안 유지', keep(await G(() => JSON.stringify(window.__car.draft))));
await openMenu(); await act('saveSlot', '[data-v="slot3"]'); await page.waitForTimeout(300); if (await page.locator('#ask').isVisible()) await page.click('#ask-yes'); await page.waitForTimeout(300); await act('closeSheet');
await page.reload(); await page.waitForSelector('#title:not([hidden])');
await act('loadSlot', '[data-v="slot3"]'); await page.waitForFunction(() => window.__car.game); await page.click('#speeds button[data-speed="0"]');
check('저장 → 새로 고침 → 불러오기 뒤 초안 유지(개발 탭 점)', keep(await G(() => JSON.stringify(window.__car.draft))) && await G(() => document.querySelector('#tabs button[data-tab="car"]').classList.contains('has-draft')));
await devHome(page);
check('불러온 뒤 개발 탭: 하던 단계에서 이어짐', (await G(() => window.__car.screen)) === 'plan' && (await G(() => window.__car.planTab)) === 'dir');
await G(() => { const b = document.createElement('button'); b.dataset.act = 'devHome'; document.body.append(b); b.click(); b.remove(); });
await page.waitForTimeout(200);
check('개발 화면(사무실): "기획 중인 차가 있습니다 · 단계" 카드와 [이어서 하기]', (await page.locator('.draft-card').innerText()).includes('기획 중인 차가 있습니다: 「초안차」') && (await page.locator('.draft-card').innerText()).includes('단계') && (await page.locator('.draft-card [data-act="resumePlan"]').count()) === 1);
await shot('draft-card');
await act('resumePlan');
await act('cancelPlan');
check('[기획 그만두기]를 눌러야 초안이 사라짐', (await G(() => window.__car.draft)) === null && !(await G(() => document.querySelector('#tabs button[data-tab="car"]').classList.contains('has-draft'))));

// ---- 메뉴 → 회사 로고 바꾸기, 예전 저장은 기본 로고 ----
const myLg0 = await page.locator('#mylogo').innerHTML();
await openMenu(); await act('settings'); await act('setTab', '[data-v="view"]'); await act('logoSheet'); await act('lg', '[data-k="mark"][data-v="star"]');
check('메뉴 → 회사 로고 바꾸기: 상단바 로고가 바로 바뀜', (await page.locator('#mylogo').innerHTML()) !== myLg0 && (await G(() => window.__car.ui.logo.mark)) === 'star');
await shot('logo-sheet');
await act('closeSheet');
// ---- 설정: 자동 멈춤 항목별 켬/끔(기기 저장소). 1.0.0 메뉴 → 설정 화면(시간 묶음) ----
await openMenu();
check('1.0.0 메뉴: 저장·불러오기·내보내기·설정·되돌리기·처음 화면만(설정 항목은 설정 화면으로)', (await page.locator('#sheet [data-act="settings"]').count()) === 1 && (await page.locator('#sheet [data-act="autoPause"], #sheet [data-act="snd"], #sheet [data-act="debug"], #sheet [data-act="saveEvery"]').count()) === 0 && (await page.locator('#sheet [data-act="undo"], #sheet [data-act="home"], #sheet [data-act="export"]').count()) === 3);
await act('settings'); await act('setTab', '[data-v="time"]');
check('1.0.0 설정 화면: 묶음 6개(시간·알림·결정(3.7.0)·소리·저장·화면)', (await page.locator('#sheet [data-act="setTab"]').allInnerTexts()).join() === '시간,알림,결정,소리,저장,화면');
check('설정 시간: 자동 멈춤 4항목(후보·출시 대기·결정 사건·연 보고서), 기본 켬', (await page.locator('#sheet [data-act="autoPause"]').count()) === 4 && (await page.locator('#sheet [data-act="autoPause"][aria-pressed="true"]').count()) === 4);
await act('autoPause', '[data-v="cands"]'); await page.locator('#sheet [data-act="autoPause"][data-v="cands"][aria-pressed="false"]').waitFor({ timeout: 3000 }).catch(() => {});
check('자동 멈춤 끄기: 버튼 꺼짐·기기 저장소에 저장', (await page.locator('#sheet [data-act="autoPause"][data-v="cands"]').getAttribute('aria-pressed')) === 'false' && (await G(() => JSON.parse(localStorage.getItem('car-company-autopause')).cands)) === false);
await act('autoPause', '[data-v="cands"]'); await page.locator('#sheet [data-act="autoPause"][data-v="cands"][aria-pressed="true"]').waitFor({ timeout: 3000 }).catch(() => {});
// ---- 소리 설정(헤드리스에는 실제 소리가 없으니 저장·표시·예외 없음만) ----
await act('setTab', '[data-v="sound"]');
check('설정 소리: 소리 설정(전체·효과음·배경 음악 슬라이더, 음소거, 주 넘김 소리)', (await page.locator('#sheet .snd-r').count()) === 3 && (await page.locator('#sheet [data-act="snd"]').count()) === 2);
await page.locator('#sheet .snd-r[data-k="music"]').fill('20');
await act('snd', '[data-v="weekTick"]'); await page.locator('#sheet [data-act="snd"][data-v="weekTick"][aria-pressed="true"]').waitFor({ timeout: 3000 }).catch(() => {});
const snd = await G(() => JSON.parse(localStorage.getItem('car-company-sound') ?? 'null'));
check('소리 설정: 배경 음악 20%·주 넘김 소리 켬이 기기 저장소에 저장', snd?.music === 0.2 && snd?.weekTick === true && (await G(() => window.__car.sound.weekTick)) === true, JSON.stringify(snd));
await act('snd', '[data-v="weekTick"]'); await act('closeSheet');
await topOpen(page); const mb = await page.locator('#mutebtn').boundingBox(); // 상단바가 시간 진행으로 다시 그려져 Playwright의 '안정' 대기가 드물게 끝나지 않아 직접 클릭
await G(() => document.getElementById('mutebtn').click());
check('메뉴 안 음소거 버튼(5.0.0): 44px 이상, 누르면 음소거·저장, 다시 누르면 해제', mb.width >= 44 && mb.height >= 44 && (await page.locator('#mutebtn').getAttribute('aria-pressed')) === 'true' && (await G(() => JSON.parse(localStorage.getItem('car-company-sound')).muted)) === true
  && await (async () => { await G(() => document.getElementById('mutebtn').click()); return (await G(() => window.__car.sound.muted)) === false; })());
await G(() => { const t = window.__car.toast; t('중요한 경고', 'bad', '현금 경고', 12000); for (let i = 0; i < 4; i++) t(`보통 알림 ${i}`); });
await page.waitForTimeout(500);
const tv = await G(() => [...document.querySelectorAll('#toasts .toast')].filter((x) => getComputedStyle(x).display !== 'none' && !x.classList.contains('out')).map((x) => x.innerText));
check('알림: 한 번에 최대 2개, 오래된 보통 알림부터 닫히고 중요한 알림은 남음', tv.length <= 2 && tv.some((x) => x.includes('중요한 경고')) && tv.some((x) => x.includes('보통 알림 3')), JSON.stringify(tv));
{ const raw = await G(() => { const o = window.__car.game.toJSON(); delete o.difficulty; return JSON.stringify(o); }); await openMenu();
  const [fch] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#sheet [data-act="import"]').click()]);
  await fch.setFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await page.waitForTimeout(400); if (await page.locator('#ask').isVisible()) { await page.click('#ask-yes'); await page.waitForTimeout(400); } // 마지막 저장 뒤 변경이 있을 때만 확인 창
  check('예전 저장(로고 정보 없음)을 불러오면 기본 로고', await G(() => { const l = window.__car.ui.logo; return l.shape === 'round' && l.mark === 'stripes' && l.bg === '#14171c' && l.fg === '#ff5a1f'; }) && (await page.locator('#mylogo').innerHTML()).includes('#ff5a1f'));
  await openMenu(); check('예전 저장(난이도 없음)은 메뉴에 "보통"', (await page.locator('.menu-diff').innerText()).includes('보통')); await act('closeSheet'); }
// ---- 난이도별 시작 현금 ----
{ const cash = {};
  for (const d of ['easy', 'normal', 'hard']) {
    await openMenu(); await act('home'); if (await page.locator('#ask').isVisible()) await page.click('#ask-yes');
    await page.waitForSelector('#title:not([hidden])'); await act('titleNew'); await page.fill('#t-co', `난이도 ${d}`); await act('diff', `[data-v="${d}"]`); await act('startNew');
    await page.click('#speeds button[data-speed="0"]'); cash[d] = await page.locator('#cash').innerText();
  }
  check('난이도별 시작 현금 50억 / 30억 / 22억', cash.easy === '50억' && cash.normal === '30억' && cash.hard === '22억', JSON.stringify(cash));
  await openMenu(); check('메뉴에 진행 중인 게임의 난이도', (await page.locator('.menu-diff').innerText()).includes('어려움')); await act('closeSheet'); }

// ---- 8. 두 번 톡·핀치 확대 막기(터치 화면, 헤드리스 크로미움) ----
{ const tctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const tp = await tctx.newPage(); tp.on('pageerror', (e) => errors.push(String(e))); tp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await tctx.newCDPSession(tp), TG = (fn, a) => tp.evaluate(fn, a);
  const dtap = async (sel) => { const b = await tp.locator(sel).first().boundingBox(), x = b.x + b.width / 2, y = b.y + Math.min(b.height / 2, 120);
    for (let i = 0; i < 2; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tp.waitForTimeout(80); }
    await tp.waitForTimeout(500); return TG(() => visualViewport.scale); };
  await tp.goto(URL0); await tp.waitForSelector('#title:not([hidden])');
  await tp.tap('[data-act="titleNew"]'); await tp.fill('#t-co', '터치'); await tp.tap('[data-act="startNew"]'); await tp.tap('#tabs button[data-tab="car"]'); await TG(() => window.__car.setSpeed(0));
  const sc = [];
  sc.push(await dtap('#panel .card'));
  await tp.tap('#ov [data-act="plan"]'); sc.push(await dtap('#panel .card')); await tp.tap('#panel [data-act="cancelPlan"]');
  await tp.tap('#tabs button[data-tab="group"]'); sc.push(await dtap('#panel .card'));
  await devHome(tp, true); await tp.waitForTimeout(400);
  check('터치: 차고·기획·회사 탭에서 두 번 톡 → 화면 확대 없음', sc.every((x) => x === 1), sc.join(','));
  const vb = () => TG(() => document.querySelector('#office svg').getAttribute('viewBox'));
  const vb0 = await vb(); const s4 = await dtap('#office svg');
  check('터치: 사무실 두 번 톡 → 화면 확대 없음, 사무실 배율·위치 그대로', s4 === 1 && (await vb()) === vb0, `${s4} ${vb0}`);
  const ob = await tp.locator('#office').boundingBox();
  await cdp.send('Input.synthesizePinchGesture', { x: ob.x + ob.width / 2, y: ob.y + ob.height / 2, scaleFactor: 1.8, gestureSourceType: 'touch' }); await tp.waitForTimeout(400);
  const vb1 = await vb(), s5 = await TG(() => visualViewport.scale);
  check('터치: 사무실 핀치 → 사무실만 확대(페이지 배율 1)', vb1 !== vb0 && s5 === 1, `${vb0} → ${vb1}, ${s5}`);
  check('사무실을 옮기면 "원위치" 버튼이 나타남', await tp.locator('#office .ofc-home').isVisible());
  await tp.tap('#office .ofc-home'); await tp.waitForTimeout(300);
  check('"원위치"를 누르면 기본 화면으로 돌아가고 버튼이 사라짐', (await vb()) === vb0 && !(await tp.locator('#office .ofc-home').isVisible()));
  const pb = await tp.locator('#panel').boundingBox();
  await cdp.send('Input.synthesizePinchGesture', { x: pb.x + pb.width / 2, y: pb.y + 100, scaleFactor: 2, gestureSourceType: 'touch' }); await tp.waitForTimeout(400);
  check('터치: 패널에서 핀치 → 페이지 확대 없음', (await TG(() => visualViewport.scale)) === 1);
  // ---- 개발자 메뉴: 상단바 로고 두 번 톡 ----
  await topOpen(tp); // 5.0.0 로고는 위쪽 [메뉴] 안
  { const c0 = await TG(() => window.__car.game.state.cash), sc0 = await dtap('#mylogo');
    check('터치: 로고 두 번 톡 → 개발자 메뉴(화면 확대 없음)', sc0 === 1 && (await tp.locator('#sheet').isVisible()) && (await tp.locator('#sheet').innerText()).includes('개발자 메뉴 (시험용)'));
    await tp.locator('#sheet [data-act="devCheat"][data-v="cash"]').tap();
    const c1 = await TG(() => window.__car.game.state.cash);
    check('개발자 메뉴 현금 +500억 → 현금 증가', c1 - c0 >= 4_900_000, `${c0} → ${c1}`);
    await tp.locator('#sheet [data-act="devCheat"][data-v="cash"]').tap(); await tp.waitForTimeout(150);
    check('큰 금액 표기: 1,000억 넘으면 천 단위 쉼표(예: 1,050억)', /^\d{1,3}(,\d{3})+(\.\d)?억$|^\d+조/.test(await tp.locator('#cash').innerText()), await tp.locator('#cash').innerText());
    await tp.locator('#sheet [data-act="devCheat"][data-v="reputation"]').tap(); await tp.waitForTimeout(200);
    check('평판이 바뀌면 이유와 함께 알림(개발자 메뉴: 평판 +10)', /개발자 메뉴: 평판 \+10(?!\.)/.test(await tp.locator('#toasts').textContent()), await tp.locator('#toasts').textContent());
    check('상단바(1024×768): 넘치지 않음·누를 수 있는 칩은 44px', await TG(() => { const t = document.getElementById('top'); return t.scrollWidth <= t.clientWidth + 1 && [...t.querySelectorAll('button')].filter((b) => b.offsetParent).every((b) => b.getBoundingClientRect().height >= 44); }));
    await tp.locator('#sheet [data-act="closeSheet"]').tap(); }
  // ---- 출시 대기 자동 멈춤, 가격 화면(1024×768 터치·1366×1024) ----
  await carTable(tp, true); await tp.tap('#ov [data-act="plan"]'); await tp.tap('[data-act="ptab"][data-v="budget"]');
  if (await tp.locator('[data-act="pick"][data-k="designWeeks"][aria-pressed="true"]').count() === 0) await tp.locator('[data-act="pick"][data-k="designWeeks"]').first().tap();
  await tp.tap('[data-act="startDev"]');
  const rdy = await TG(() => { const c = window.__car; c.setSpeed(1); for (let i = 0; i < 400; i++) { const p = c.game.state.projects[0]; if (!p || p.waiting) break; c.tick(1); } return { waiting: !!c.game.state.projects[0]?.waiting, speed: c.speed }; });
  check('출시 대기가 되면 자동 멈춤 + 알림', rdy.waiting && rdy.speed === 0 && /출시 대기[\s\S]*시간을 멈췄습니다/.test(await tp.locator('#toasts').innerText()), JSON.stringify(rdy));
  await tp.locator('#toasts .toast .open').filter({ hasText: '출시 준비' }).first().tap(); await tp.waitForTimeout(300);
  const inView = () => TG(() => { const pr = document.getElementById('panel').getBoundingClientRect(); return ['.px-r', '.vsbase', '.px-base', '.px-sales', '.px-profit', '.px-step'].every((q) => { const r = document.querySelector('#panel ' + q)?.getBoundingClientRect(); return !!r && r.top >= pr.top - 1 && r.bottom <= pr.bottom + 1; }) && document.getElementById('panel').scrollTop === 0; });
  check('가격 화면(1024×768): 스크롤 없이 슬라이더·기준가 대비·예상 월 판매·예상 월 이익이 한 화면', (await TG(() => window.__car.screen)) === 'launch' && await inView());
  const noClip = () => TG(() => [...document.querySelectorAll('#panel .px-kpis .kpi b')].map((b) => [b.textContent, b.scrollWidth - b.clientWidth]));
  { const c = await noClip(); check('가격 카드(출시, 1024×768): 대당 이익·예상 월 판매·예상 월 이익 값이 말줄임되지 않음', c.length === 3 && c.every(([, d]) => d <= 0), JSON.stringify(c)); }
  check('가격 슬라이더: 손잡이 터치 영역 44px 이상·touch-action none·−/+ 버튼 44px 이상', await TG(() => { const t = document.querySelector('.px-track'), b = document.querySelector('.px-step').getBoundingClientRect(); return t.getBoundingClientRect().height >= 44 && getComputedStyle(t).touchAction === 'none' && b.width >= 44 && b.height >= 44; }));
  const tb = await tp.locator('.px-track').boundingBox(), ty = tb.y + tb.height / 2, p0 = await TG(() => window.__car.launch.price);
  await TG(() => { window.__pxEl = document.getElementById('lprice'); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tb.x + tb.width * 0.3, y: ty }] });
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tb.x + tb.width * (0.3 + i * 0.08), y: ty + i * 3 }] });
  const mid = await TG(() => ({ same: window.__pxEl === document.getElementById('lprice') && window.__pxEl.isConnected, out: document.getElementById('lprice-out').textContent, price: window.__car.launch.price, kp: document.querySelector('#lprice-kpis').textContent }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await tp.waitForTimeout(100);
  check('터치로 슬라이더 끌기: 끄는 동안 같은 슬라이더를 계속 잡고, 가격·예상 수치가 바로 바뀜', mid.same && mid.price > p0 && mid.out.includes(mid.price.toLocaleString()) && mid.kp.includes('예상 월 이익'), `${p0} → ${mid.price}`);
  const p1 = await TG(() => window.__car.launch.price);
  await tp.locator('.px-step[data-step="1"]').tap(); const p2 = await TG(() => window.__car.launch.price);
  await tp.locator('.px-step[data-step="-1"]').tap(); await tp.locator('.px-step[data-step="-1"]').tap(); const p3 = await TG(() => window.__car.launch.price);
  check('−/+ 버튼: 한 번에 10만원', p2 === p1 + 10 && p3 === p1 - 10, `${p1} ${p2} ${p3}`);
  const sb = await tp.locator('.px-step[data-step="1"]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 }] }); await tp.waitForTimeout(1100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); const p4 = await TG(() => window.__car.launch.price);
  check('+ 길게 누르기: 연속으로 오름', p4 >= p3 + 30, `${p3} → ${p4}`);
  if (process.argv[2]) await tp.screenshot({ path: process.argv[2].replace('.png', '-price-1024x768.png') });
  await tp.setViewportSize({ width: 1366, height: 1024 }); await tp.waitForTimeout(300);
  check('가격 화면(1366×1024): 스크롤 없이 한 화면', await inView());
  if (process.argv[2]) await tp.screenshot({ path: process.argv[2].replace('.png', '-price-1366x1024.png') });
  await tp.setViewportSize({ width: 1024, height: 768 });
  await tp.locator('[data-act="doLaunch"]').tap(); if (await tp.locator('#ask').isVisible()) await tp.tap('#ask-yes');
  await tp.waitForSelector('#sheet:not([hidden])'); await TG(() => document.querySelector('#sheet [data-act="closeReview"]').click());
  await TG(() => window.__car.tick(8)); await carTable(tp, true); await tp.waitForTimeout(300);
  await tp.locator('#ov [data-act="carJump"][data-v="price"]').tap(); await tp.waitForTimeout(700);
  check('차고 가격 카드(1024×768, 5.0.0 무대 [가격·광고]로 내려감): 패널 맨 위 카드, 슬라이더·기준가 대비·예상 월 판매·예상 월 이익이 한 화면에', (await TG(() => document.querySelector('#panel .pcol:first-child > .card')?.classList.contains('price-card') && !!document.getElementById('gprice')))
    && await TG(() => { const top = document.getElementById('top').getBoundingClientRect().bottom, bot = document.getElementById('tabs').getBoundingClientRect().top; return ['.px-r', '.vsbase', '.px-base', '.px-sales', '.px-profit', '.px-step'].every((q) => { const r = document.querySelector('#panel ' + q)?.getBoundingClientRect(); return !!r && r.top >= top - 1 && r.bottom <= bot + 1; }); }));
  { const c = await noClip(); check('가격 카드(차고, 1024×768): 값이 말줄임되지 않음', c.length === 3 && c.every(([, d]) => d <= 0), JSON.stringify(c)); }
  if (process.argv[2]) await tp.screenshot({ path: process.argv[2].replace('.png', '-garage-price-1024x768.png') });
  await tctx.close(); }

// ---- 0.7.0 할 일·보고·다음 일까지(새 게임, 1366×1024 → 1024×768) ----
{ const ectx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const ep = await ectx.newPage(); ep.on('pageerror', (e) => errors.push(String(e))); ep.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const closeAny = async () => { if (await ep.locator('#sheet').isVisible()) await ep.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click(); }; // 선택 사건 창이 떠 있으면 닫기
  const EG = (fn, a) => ep.evaluate(fn, a), eshot = (n) => process.argv[2] ? ep.screenshot({ path: process.argv[2].replace('.png', `-${n}.png`) }) : Promise.resolve();
  await ep.goto(URL0); await ep.waitForSelector('#title:not([hidden])');
  await ep.click('[data-act="titleNew"]'); await ep.fill('#t-co', '할일 시험'); await ep.click('[data-act="startNew"]'); await ep.click('#tabs button[data-tab="car"]'); await EG(() => window.__car.setSpeed(0));
  const n0 = await EG(() => window.__car.todos().length), nb = await EG(() => window.__car.todos().filter((t) => t.urgent || !['exec', 'team', 'research', 'hire'].includes(t.kind)).length);
  await topOpen(ep);
  check('할 일 버튼(5.0.0 메뉴 안): 배지 = 급한 일 + 지금 할 수 있는 일(1.0.0 참고 제외), 높이 44px 이상', n0 > 0 && (await ep.locator('#todo-n').innerText()) === String(nb) && (await ep.locator('#todobtn').boundingBox()).height >= 44, `${nb}/${n0}건`);
  await menuItem(ep, '#todobtn'); await ep.waitForSelector('#drawer:not([hidden]) .todo-it', { state: 'attached' });
  check('1.0.0 할 일은 오른쪽 서랍(시간은 멈추지 않음), 참고는 접혀 있음', (await ep.locator('#sheet').isHidden()) && !(await EG(() => window.__car.held())) && (await ep.locator('#drawer details.todo-ref:not([open])').count()) === 1);
  await ep.click('#drawer details.todo-ref > summary');
  check('할 일 창: 항목 수 = 배지, 새 게임에는 개발팀·정원 여유 항목', (await ep.locator('.todo-it').count()) === n0 && (await ep.locator('.todo-it[data-kind="team"]').count()) === 1 && (await ep.locator('.todo-it[data-kind="hire"]').count()) === 1, (await ep.locator('.todo-list').innerText()).replace(/\n/g, ' / ').slice(0, 160));
  await eshot('todo-1366x1024');
  await ep.click('.todo-it[data-kind="team"]');
  check('할 일 항목 누르기(개발팀) → 신차 기획, 서랍 닫힘', ['plan', 'start'].includes(await EG(() => window.__car.screen)) && !(await ep.locator('#sheet').isVisible()) && (await ep.locator('#drawer').isHidden()));
  await menuItem(ep, '#todobtn'); await ep.click('.todo-it[data-kind="hire"]');
  check('할 일 항목 누르기(정원 여유) → 회사 탭', (await EG(() => window.__car.screen)) === 'company' && (await ep.locator('#panel [data-act="psec"][data-v="staff"]').getAttribute('aria-selected')) === 'true');
  await menuItem(ep, '#todobtn'); await ep.click('[data-act="todoTab"][data-v="reports"]');
  check('보고 탭: 임원이 없으면 안내와 [임원 화면] 버튼', (await ep.locator('#drawer').innerText()).includes('임원을 두면 제안을 받을 수 있습니다') && (await ep.locator('#drawer [data-act="todoGoCo"][data-v="exec"]').count()) === 1);
  await eshot('reports-empty-1366x1024');
  await ep.click('#drawer [data-act="todoGoCo"]');
  check('[임원 화면] → 회사 탭, 서랍 닫힘', (await EG(() => window.__car.screen)) === 'company' && (await ep.locator('#drawer').isHidden()));
  // 개발 시작 → [다음 일까지]로 출시 대기까지
  await toGarage(ep); await ep.click('#ov [data-act="plan"]'); await ep.click('[data-act="ptab"][data-v="budget"]'); await ep.click('[data-act="startDev"]');
  const w0 = await EG(() => window.__car.game.state.week), stops = [];
  check('[다음 일까지] 버튼 44px 이상', (await ep.locator('#skipbtn').boundingBox()).height >= 44);
  await ep.click('#skipbtn'); check('[다음 일까지] 누르면 진행 중 표시', (await EG(() => window.__car.skip)) && (await ep.locator('#skipbtn').getAttribute('aria-pressed')) === 'true');
  await ep.click('#skipbtn'); check('진행 중 다시 누르면 즉시 중단(빠르기 멈춤)', !(await EG(() => window.__car.skip)) && (await EG(() => window.__car.speed)) === 0);
  for (let i = 0; i < 12; i++) {
    if (await EG(() => window.__car.game.state.projects[0]?.waiting)) break;
    if (await ep.locator('#sheet').isVisible()) await ep.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click();
    await ep.click('#skipbtn');
    await ep.waitForFunction(() => !window.__car.skip, null, { timeout: 60000 });
    stops.push(`${await EG(() => window.__car.game.dateLabel)}: ${(await ep.locator('#toasts').innerText()).replace(/\s+/g, ' ').slice(-90)}`);
  }
  const rdy = await EG(() => ({ waiting: !!window.__car.game.state.projects[0]?.waiting, speed: window.__car.speed, week: window.__car.game.state.week }));
  check('[다음 일까지]로 출시 대기까지 넘어가 멈춤(알림에 이유)', rdy.waiting && rdy.speed === 0 && rdy.week > w0 && /출시 대기/.test(await ep.locator('#toasts').innerText()), `${w0}주 → ${rdy.week}주, 멈춘 곳 ${stops.length}번: ${stops.join(' | ')}`);
  check('출시 대기 → 할 일에 출시 항목(급함), 누르면 출시 준비 화면', await EG(() => window.__car.todos()[0]?.kind === 'ready' && window.__car.todos()[0].urgent));
  await menuItem(ep, '#todobtn'); await ep.click('.todo-it[data-kind="ready"]');
  check('출시 항목 → 출시 준비 화면', (await EG(() => window.__car.screen)) === 'launch');
  // 1024×768: 상단바 넘침·새 버튼 44px(진행 중 표시 포함)
  await ep.setViewportSize({ width: 1024, height: 768 }); await ep.waitForTimeout(200);
  const topOk = () => EG(() => { const t = document.getElementById('top'); return t.scrollWidth <= t.clientWidth + 1 && t.getBoundingClientRect().height < 80 && ['#skipbtn', '#menubtn', ...(document.getElementById('decbtn').hidden ? [] : ['#decbtn'])].every((q) => { const r = document.querySelector(q).getBoundingClientRect(); return r.height >= 44 && r.right <= innerWidth; }); });
  await toGarage(ep);
  check('상단바(1024×768): 정할 일·다음 일까지·메뉴 버튼이 넘치지 않고 44px(5.0.0 할 일은 메뉴 안)', await topOk());
  await EG(() => { window.__car.game.state.cash = -5; window.__car.render(); }); // 급한 일 표시 점검용
  await EG(() => document.getElementById('skipbtn').click()); const onOk = await topOk(); await EG(() => window.__car.skip && document.getElementById('skipbtn').click());
  check('상단바(1024×768): 진행 중 표시일 때도 넘치지 않음', onOk);
  await eshot('top-1024x768');
  await closeAny(); await menuItem(ep, '#todobtn'); await ep.waitForTimeout(200);
  { const ks = await ep.locator('.todo-it').evaluateAll((l) => l.map((b) => [b.dataset.kind, b.classList.contains('urgent')]));
    check('할 일 창(1024×768): 급한 일(출시 대기·현금)이 맨 위에 모임', ks.some(([k, u]) => k === 'cash' && u) && ks.slice(0, ks.filter(([, u]) => u).length).every(([, u]) => u), JSON.stringify(ks)); }
  await eshot('todo-1024x768');
  // 임원 보고: 임원을 두고 [다음 일까지] → 월 결산 보고에서 멈춤, 알림은 한 줄, 보고 탭에 카드
  await ep.locator('#drawer [data-act="drawerClose"]').click(); await ep.setViewportSize({ width: 1366, height: 1024 });
  await toGarage(ep);
  await EG(() => { const g = window.__car.game; g.state.cash = 1e8; g.state.negMonths = 0; g.command({ type: 'appointExec', role: 'hr', staffId: g.state.staff.find((x) => x.projectId === null).id }); window.__car.render(); });
  const sk = await EG(() => window.__car.todos().map((t) => t.key));
  for (let i = 0; i < 5 && !(await EG(() => window.__car.game.state.execs.reports.length)); i++) { await closeAny(); await ep.click('#skipbtn'); await ep.waitForFunction(() => !window.__car.skip, null, { timeout: 60000 }); }
  const tt = await ep.locator('#toasts').textContent(), reps = await EG(() => window.__car.game.state.execs.reports.filter((r) => r.unread).length);
  check('임원 보고: 월 결산에 보고가 오면 [다음 일까지]가 멈추고 결산 알림에 "임원 보고 N건"만(보고 창은 뜨지 않음)', reps > 0 && tt.includes(`임원 보고 ${reps}건`) && (await ep.locator('#sheet .rep-card').count()) === 0, `${reps}건, 시작 할 일 ${sk.length}개`);
  check('임원 보고: 할 일에 읽지 않은 보고 항목', await EG(() => window.__car.todos().some((t) => t.kind === 'reports')));
  await closeAny(); await menuItem(ep, '#todobtn'); await ep.click('[data-act="todoTab"][data-v="reports"]');
  check('보고 탭: 카드(직함·이름·본문·[이 보고 닫기]), 열면 읽음 처리', (await ep.locator('.rep-card').count()) >= reps && (await ep.locator('.rep-card').first().innerText()).includes('인사 임원') && (await EG(() => window.__car.game.state.execs.reports.every((r) => !r.unread))) && (await ep.locator('.rep-card.unread').count()) >= reps);
  await eshot('reports-1366x1024');
  const c0 = await ep.locator('.rep-card').count(); await ep.locator('.rep-card [data-act="repClose"]').first().click();
  check('[이 보고 닫기] → 카드 하나 줄어듦', (await ep.locator('.rep-card').count()) === c0 - 1);
  await ectx.close(); }

// ---- 0.7.0 임원 화면(회사 탭): 임명 → 월 결산 보고 → 위임 켬 → 해임 ----
{ const xctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const xp = await xctx.newPage(); xp.on('pageerror', (e) => errors.push(String(e))); xp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const XG = (fn, a) => xp.evaluate(fn, a), xshot = (n) => process.argv[2] ? xp.screenshot({ path: process.argv[2].replace('.png', `-${n}.png`) }) : Promise.resolve();
  await xp.goto(URL0); await xp.waitForSelector('#title:not([hidden])');
  await xp.click('[data-act="titleNew"]'); await xp.fill('#t-co', '임원 시험'); await xp.click('[data-act="startNew"]'); await xp.click('#tabs button[data-tab="car"]'); await XG(() => window.__car.setSpeed(0));
  await tab5(xp, 'people', 'cotab', 'exec');
  check('임원 화면: 자리 카드 6개(빈 자리 1, 잠긴 자리 5와 필요 본사 등급)', (await xp.locator('.exec-card').count()) === 6 && (await xp.locator('.exec-card.empty').count()) === 6 && (await xp.locator('.exec-sum').innerText()).includes('0/1석'));
  await xp.click('.exec-card[data-role="research"] [data-act="execPick"]');
  { const sk = await xp.locator('.exec-card[data-role="research"] .exec-pick .opt').evaluateAll((l) => l.map((b) => Number((b.innerText.match(/임원 능력 (\d+)/) ?? [])[1])));
    check('임명 목록: 관련 능력(임원 능력) 높은 순', sk.length > 0 && sk.every((v, i) => i === 0 || sk[i - 1] >= v), JSON.stringify(sk)); } // 1.1.0: 시작 직원 구성이 바뀌어 '엔지니어가 맨 위'는 늘 맞지 않아 정렬 자체를 본다
  await xp.locator('.exec-card[data-role="research"] [data-act="execAppoint"]').first().click();
  check('임명: 자리가 채워지고 나머지는 잠김(본사 2등급 안내)', (await xp.locator('.exec-card.filled[data-role="research"]').count()) === 1 && (await xp.locator('.exec-card.locked').count()) === 5 && (await xp.locator('.exec-card.locked').first().innerText()).includes('본사 2등급'));
  await xshot('exec-1366x1024');
  await tab5(xp, 'people', 'psec', 'staff');
  check('직원 표: 임원은 직함(연구소장)으로', (await xp.locator('.srow.s-exec').innerText()).includes('연구소장'));
  await XG(() => window.__car.tick(4));
  const nrep = await XG(() => window.__car.game.state.execs.reports.length);
  check('월 결산 → 임원 보고가 보고함에 쌓임(창은 뜨지 않음)', nrep > 0 && !(await xp.locator('#sheet .rep-card').isVisible()), `${nrep}건`);
  await tab5(xp, 'people', 'cotab', 'exec');
  check('위임: 능력이 모자라면 스위치가 잠기고 이유 표시', (await xp.locator('.exec-card[data-role="research"] [data-act="execDeleg"]').isDisabled()) && (await xp.locator('.exec-card[data-role="research"] .why').innerText()).includes('이상이어야'));
  await XG(() => { window.__car.game.state.execs.seats.research.staff.ability = 70; window.__car.render(); });
  await xp.click('.exec-card[data-role="research"] [data-act="execDeleg"]');
  check('위임 켬: 스위치 켜짐·상태 반영', (await xp.locator('.exec-card[data-role="research"] [data-act="execDeleg"]').getAttribute('aria-pressed')) === 'true' && await XG(() => window.__car.game.state.execs.delegations.research.includes('autoResearch')));
  await xp.setViewportSize({ width: 1024, height: 768 }); await xp.waitForTimeout(200);
  check('임원 화면(1024×768): 가로 넘침 없음, 버튼 44px 이상', await XG(() => { const p = document.getElementById('panel'); return p.scrollWidth <= p.clientWidth + 1 && [...document.querySelectorAll('.exec-card .btn')].every((b) => b.getBoundingClientRect().height >= 44); }));
  await xshot('exec-1024x768');
  await xp.click('.exec-card[data-role="research"] [data-act="execDismiss"]'); await xp.click('#ask-yes');
  check('해임: 확인 창 → 원래 직무로 복귀, 빈 자리', (await xp.locator('.exec-card.empty').count()) === 6 && await XG(() => window.__car.game.state.staff.length === 4));
  await xctx.close(); }

// ---- 0.8.0 직원 표 정렬·필터, 되돌리기, 자동 저장, 연 보고서, 교체 고용 버튼, 보고 → 직원 선택 ----
{ const cctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const cp = await cctx.newPage(); cp.on('pageerror', (e) => errors.push(String(e))); cp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const CG = (fn, a) => cp.evaluate(fn, a), C2 = process.argv[3]; // 두 번째 인자: 0.8.0 캡처 폴더
  const cshot = (n) => (C2 ? cp.screenshot({ path: `${C2}/${n}.png` }) : Promise.resolve());
  const closeAny = async () => { if (await cp.locator('#sheet').isVisible()) await cp.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click(); };
  await cp.goto(URL0); await cp.waitForSelector('#title:not([hidden])');
  await cp.click('[data-act="titleNew"]'); await cp.fill('#t-co', '편의 시험'); await cp.click('[data-act="startNew"]'); await cp.click('#tabs button[data-tab="car"]'); await CG(() => window.__car.setSpeed(0));
  // 직원 20명(점검용으로 상태에 직접 넣는다): 몇 명은 지치게
  await CG(() => { const s = window.__car.game.state, roles = ['designer', 'engineer', 'tester', 'sales']; s.hqLevel = 5; s.cash = 1e7;
    for (let i = s.staff.length; i < 20; i++) s.staff.push({ id: s.nextId++, name: `직원${String(i).padStart(2, '0')}`, role: roles[i % 4], ability: 20 + ((i * 7) % 50), potential: 80, condition: i % 5 === 0 ? 0.2 : 0.9, projectId: null, trainings: [], restUntil: null, lab: false });
    window.__car.render(); });
  await tab5(cp, 'people', 'psec', 'staff');
  const chipN = await cp.locator('.s-chip').count(), sh = await cp.locator('.srow.head .sh').evaluateAll((l) => l.map((b) => b.getBoundingClientRect().height));
  check('직원 표: 필터 칩 10개, 정렬 머리글 7개(44px 이상)', chipN === 10 && sh.length === 7 && sh.every((h) => h >= 44), `${chipN}개, ${sh.join(',')}`);
  const abil = () => cp.locator('.srow:not(.head):not(.s-exec) .s-abil b').evaluateAll((l) => l.map((b) => Number(b.textContent)));
  await cp.click('[data-act="staffSort"][data-v="abil"]'); const a1 = await abil();
  await cp.click('[data-act="staffSort"][data-v="abil"]'); const a2 = await abil();
  check('직원 표: 능력 머리글 → 큰 순, 다시 누르면 작은 순', a1.length === 20 && a1.every((v, i) => !i || a1[i - 1] >= v) && a2.every((v, i) => !i || a2[i - 1] <= v), `${a1.slice(0, 4)} / ${a2.slice(0, 4)}`);
  await cp.click('[data-act="staffFilter"][data-v="tired"]');
  const tiredN = await CG(() => window.__car.game.state.staff.filter((x) => x.condition < 0.4).length), rowsN = await cp.locator('.srow:not(.head)').count();
  await cp.click('[data-act="pickVisible"]');
  check('필터 "지친 직원": 지친 사람만 보이고 [보이는 N명 모두 고르기]는 그 사람만', rowsN === tiredN && rowsN > 0 && (await cp.locator('.s-pick[aria-pressed="true"]').count()) === tiredN && (await cp.locator('[data-act="restPicked"]').innerText()).includes(`${tiredN}명`), `${rowsN}/${tiredN}`);
  check('정렬·필터는 기기 저장소에 기억', await CG(() => { const o = JSON.parse(localStorage.getItem('car-company-staffview')); return o.sort === 'abil' && o.filter === 'tired'; }));
  await cp.click('[data-act="restPicked"]');
  const restU = await cp.locator('#toasts [data-undo]').count();
  await cp.click('[data-act="staffFilter"][data-v=""]');
  await cp.setViewportSize({ width: 1024, height: 768 }); await cp.waitForTimeout(200);
  await CG(() => { document.getElementById('panel').scrollTop = 600; });
  check('직원 표(1024×768, 20명): 패널을 내려도 머리글이 위에 붙어 있음, 가로 넘침 없음', await CG(() => { const p = document.getElementById('panel'), h = document.querySelector('.srow-w.head').getBoundingClientRect(), pr = p.getBoundingClientRect(); return h.top >= pr.top - 1 && h.top <= pr.top + 40 && p.scrollWidth <= p.clientWidth + 1; }));
  await cshot('staff-filter-1024x768');
  await CG(() => { document.getElementById('panel').scrollTop = 0; });
  await cp.click('[data-act="staffFilter"][data-v="tired"]'); await cshot('staff-filter-tired-1024x768'); await cp.click('[data-act="staffFilter"][data-v=""]');
  await cp.setViewportSize({ width: 1366, height: 1024 });
  // 되돌리기: 일괄 휴식(여러 명)은 한 번에, 해고는 알림의 [되돌리기]로
  check('일괄 휴식 → 알림에 [되돌리기], 라벨 "휴식: ○○ 외 N명"', restU === 1 && await CG((n) => window.__car.Q.undoInfo(window.__car.game.state).label.includes(`외 ${n - 1}명`), tiredN));
  await cp.locator('#toasts [data-undo]').first().click();
  check('[되돌리기] → 고른 직원 모두 휴식 전으로', await CG(() => window.__car.game.state.staff.every((x) => x.restUntil === null)) && (await cp.locator('#toasts').innerText()).includes('되돌렸습니다'));
  const before = await CG(() => JSON.stringify(window.__car.game.toJSON())), victim = await CG(() => window.__car.game.state.staff[2].id);
  await cp.locator(`.srow[data-id="${victim}"]`).click(); await cp.click(`[data-act="fire"][data-id="${victim}"]`); await cp.click('#ask-yes'); await cp.waitForTimeout(400);
  await cshot('undo-toast-1366x1024');
  check('해고 → 알림에 [되돌리기]', (await cp.locator('#toasts [data-undo]').count()) === 1 && !(await CG((id) => window.__car.game.state.staff.some((x) => x.id === id), victim)));
  await cp.locator('#toasts [data-undo]').click();
  check('[되돌리기] → 상태가 해고 전과 완전히 같음, "되돌렸습니다: 해고: ○○" 알림', (await CG(() => JSON.stringify(window.__car.game.toJSON()))) === before && /되돌렸습니다: 해고: /.test(await cp.locator('#toasts').innerText()));
  await cshot('undo-done-1366x1024');
  await cp.click('#tabs button[data-tab="fin"]'); await cp.locator('[data-act="borrow"]').first().click();
  await openSave(cp); await cp.waitForSelector('#sheet:not([hidden])');
  check('메뉴: "직전 조작 되돌리기 · 대출: 1억원"', (await cp.locator('[data-act="undo"]').innerText()).includes('대출: 1억원') && !(await cp.locator('[data-act="undo"]').isDisabled()));
  await cp.click('[data-act="undo"]');
  check('메뉴에서 되돌리기 → 대출 0, 창 닫힘', (await CG(() => window.__car.game.state.loan.balance)) === 0 && !(await cp.locator('#sheet').isVisible()));
  await cp.locator('[data-act="borrow"]').first().click(); await cp.locator('[data-act="borrow"]').first().click();
  check('조작을 두 번 하면 [되돌리기] 버튼은 마지막 알림 하나에만', (await cp.locator('#toasts [data-undo]').count()) === 1);
  await cp.locator('#toasts [data-undo]').click();
  check('그 버튼 → 마지막 대출만 되돌림(1억 남음), 버튼 모두 사라짐', (await CG(() => window.__car.game.state.loan.balance)) === 10000 && (await cp.locator('#toasts [data-undo]').count()) === 0);
  await cp.locator('[data-act="borrow"]').first().click(); await CG(() => window.__car.tick(1));
  check('한 주가 지나면 되돌리기 버튼이 사라짐', (await cp.locator('#toasts [data-undo]').count()) === 0 && !(await CG(() => window.__car.Q.undoInfo(window.__car.game.state).available)));
  // 자동 저장: 큰 결정(증설) 뒤 저장 → 메뉴에 마지막 자동 저장 연월, 간격 설정은 기기 저장소에
  await openSave(cp); await cp.waitForSelector('#sheet:not([hidden])'); await cp.click('#sheet [data-act="settings"]'); await cp.click('#sheet [data-act="setTab"][data-v="save"]');
  check('설정 저장: 자동 저장 간격 4개(기본 매달)·큰 결정 뒤 저장(기본 켬)·해고(큰 결정) 뒤 저장한 연월', (await cp.locator('[data-act="saveEvery"]').count()) === 4 && (await cp.locator('[data-act="saveEvery"][data-v="month"]').getAttribute('aria-pressed')) === 'true' && (await cp.locator('[data-act="saveBig"]').getAttribute('aria-pressed')) === 'true' && (await cp.locator('.auto-last').innerText()).includes('1970년 1월'));
  await closeAny(); await tab5(cp, 'group', 'cotab', 'factory'); await cp.click('[data-act="expandFactory"]'); await cp.click('#ask-yes'); await cp.waitForTimeout(1200);
  await openSave(cp); await cp.waitForSelector('#sheet:not([hidden])'); await cp.click('#sheet [data-act="settings"]');
  check('증설(큰 결정) 뒤 자동 저장 → 설정 저장 묶음에 "마지막 자동 저장: 1970년 1월"', (await cp.locator('.auto-last').innerText()).includes('1970년 1월'), await cp.locator('.auto-last').innerText());
  await cp.click('[data-act="saveEvery"][data-v="week"]'); await cp.waitForTimeout(300);
  check('간격 "매주" → 기기 저장소에', await CG(() => JSON.parse(localStorage.getItem('car-company-autosave')).every === 'week') && (await cp.locator('[data-act="saveEvery"][data-v="week"]').getAttribute('aria-pressed')) === 'true');
  await closeAny();
  // 저장 실패(저장소를 막아 흉내): 알림 한 번
  await CG(() => { IDBObjectStore.prototype.put = () => { throw new Error('막힘'); }; Storage.prototype.setItem = () => { throw new Error('가득 참'); }; window.__car.tick(1); });
  await cp.waitForTimeout(1200); await CG(() => window.__car.tick(1)); await cp.waitForTimeout(1200);
  check('자동 저장 실패 → "자동 저장에 실패" 알림 한 번', (await cp.locator('#toasts .toast', { hasText: '자동 저장에 실패' }).count()) === 1);
  await cp.reload(); await cp.waitForSelector('#title:not([hidden])');
  // 연 보고서: 11월 말까지 진행 → [다음 일까지]가 12월 결산 뒤 연 보고서 창에서 멈춤
  await cp.click('[data-act="continue"]'); await cp.waitForFunction(() => window.__car.game && document.getElementById('title').hidden); await CG(() => window.__car.setSpeed(0));
  await CG(() => { const c = window.__car; c.tick(44 - c.game.state.week); });
  for (let i = 0; i < 8 && !(await cp.locator('#sheet .yr').isVisible()) && (await CG(() => window.__car.game.state.week)) < 52; i++) {
    await closeAny(); await cp.click('#skipbtn'); await cp.waitForFunction(() => !window.__car.skip, null, { timeout: 60000 }); await cp.waitForTimeout(100);
  }
  const yr = await cp.locator('#sheet .yr').innerText().catch(() => '');
  check('[다음 일까지] → 12월 결산 뒤 "1970년 연 보고서" 창에서 멈춤(연 매출·이익·현금·평판·직원·내년에 볼 것)', yr.includes('1970년 연 보고서') && ['연 매출', '연 이익', '연말 현금', '평판 변화', '직원'].every((w) => yr.includes(w)) && (await CG(() => window.__car.speed)) === 0, yr.replace(/\s+/g, ' ').slice(0, 160));
  await cshot('year-report-1366x1024');
  await cp.setViewportSize({ width: 1024, height: 768 }); await cp.waitForTimeout(200); await cshot('year-report-1024x768');
  check('연 보고서(1024×768): 창 가로 넘침 없음', await CG(() => { const b = document.getElementById('sheet-body'); return b.scrollWidth <= b.clientWidth + 1; }));
  await cp.setViewportSize({ width: 1366, height: 1024 }); await closeAny();
  await tab5(cp, 'fin', 'rectab', 'years');
  await cp.click('[data-act="yearOpen"][data-v="1970"]');
  check('기록 탭 → 연 보고서 → 1970년 다시 열림', (await cp.locator('#sheet .yr h2').innerText()) === '1970년 연 보고서');
  await closeAny();
  await menuItem(cp, '#mylogo'); await menuItem(cp, '#mylogo'); await cp.waitForSelector('#sheet:not([hidden]) [data-act="devYear"]'); await cp.click('[data-act="devYear"]');
  check('1년 건너뛰기 중에는 연 보고서 창을 띄우지 않음', !(await cp.locator('#sheet .yr').isVisible()) && (await CG(() => window.__car.Q.reportYears(window.__car.game.state)[0])) === 1971);
  // 교체 고용: 인사 임원 → 제안(상태 직접 구성) → [승인] → 예약 → [예약 취소], 다른 제안은 [거절], [해당 화면으로] → 그 직원이 고른 상태
  const mk = () => CG(() => { const s = window.__car.game.state, x = s.staff.find((y) => y.role === 'designer'), id = s.nextId++;
    s.execs.replacements.push({ id, staffId: x.id, staffName: x.name, staffRole: x.role, ability: x.ability, minAbility: x.ability + 5, status: 'proposed', tries: 0, nextWeek: s.week, waitingFor: null, held: false });
    s.execs.reports.push({ id: s.nextId++, week: s.week, role: 'hr', execName: s.execs.seats.hr.staff.name, kind: 'replace', key: String(x.id), text: `${x.name}을 바꿀까요?`, facts: [], goto: { tab: 'company', sub: 'staff', id: x.id }, unread: true, auto: false, replacementId: id });
    window.__car.render(); return { id, staff: x.id, name: x.name }; });
  await closeAny(); await CG(() => { const g = window.__car.game; g.command({ type: 'appointExec', role: 'hr', staffId: g.state.staff.find((x) => x.role === 'sales').id }); window.__car.render(); });
  const r1 = await mk();
  await menuItem(cp, '#todobtn'); await cp.click('[data-act="todoTab"][data-v="reports"]');
  await cp.locator(`[data-act="repOk"][data-id="${r1.id}"]`).click();
  const st = (id) => CG((i) => window.__car.game.state.execs.replacements.find((r) => r.id === i).status, id);
  check('교체 고용 [승인] → 예약 상태, 카드에 [예약 취소]', (await st(r1.id)) === 'approved' && (await cp.locator(`[data-act="repCancel"][data-id="${r1.id}"]`).count()) === 1);
  await cp.locator(`[data-act="repCancel"][data-id="${r1.id}"]`).click(); await cp.click('#ask-yes');
  check('[예약 취소] → 취소됨, 버튼 사라짐', (await st(r1.id)) === 'cancelled' && (await cp.locator(`[data-act="repCancel"][data-id="${r1.id}"]`).count()) === 0);
  await closeAny(); const r2 = await mk(); await menuItem(cp, '#todobtn'); await cp.click('[data-act="todoTab"][data-v="reports"]');
  await cp.locator(`[data-act="repNo"][data-id="${r2.id}"]`).click();
  check('교체 고용 [거절] → 취소, 다시 제안 금지 기간', (await st(r2.id)) === 'cancelled' && await CG((sid) => window.__car.game.state.execs.rejected[sid] > window.__car.game.state.week, r2.staff));
  await cp.locator('.rep-card', { hasText: r2.name }).first().locator('[data-act="repGo"]').click();
  check('보고 [해당 화면으로](직원) → 직원 탭에서 그 직원이 고른 상태(자세히 열림)', (await CG(() => window.__car.screen)) === 'company' && (await cp.locator('#staff-card h2').innerText()).includes(r2.name) && (await cp.locator(`.srow[data-id="${r2.staff}"]`).getAttribute('aria-pressed')) === 'true');
  // 임원 화면 캡처(두 해상도)
  await tab5(cp, 'people', 'cotab', 'exec'); await cshot('exec-1366x1024');
  check('임원 카드(1366×1024): KPI 값이 말줄임되지 않음', await CG(() => [...document.querySelectorAll('.exec-card .kpi b')].every((b) => b.scrollWidth <= b.clientWidth + 1)));
  await CG(() => { window.__car.game.state.hqLevel = 1; window.__car.render(); }); await cshot('exec-locked-1366x1024'); // 잠긴 자리 5개
  check('잠긴 자리: 카드 5개에 필요한 본사 등급 안내', (await cp.locator('.exec-card.locked').count()) === 5 && (await cp.locator('.exec-card.locked').first().innerText()).includes('본사 2등급'));
  await cp.setViewportSize({ width: 1024, height: 768 }); await cp.waitForTimeout(200); await cshot('exec-locked-1024x768');
  await CG(() => { window.__car.game.state.hqLevel = 5; window.__car.render(); }); await cshot('exec-1024x768');
  check('임원 화면(1024×768): 가로 넘침 없음, 버튼 44px 이상', await CG(() => { const p = document.getElementById('panel'); return p.scrollWidth <= p.clientWidth + 1 && [...document.querySelectorAll('#panel .exec .btn, #panel .exec .opt')].every((b) => b.getBoundingClientRect().height >= 44); }));
  await cctx.close(); }

// 0.10.0 정보와 수습 수단: 이 차의 손익·판매 요인 카드, 긴급 개선·가격 인하 판매(확인 창), 직원 경력, 차종 손익 줄, 10년 회고(자동 창·다시 보기)
{ const ictx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const ip = await ictx.newPage(); ip.on('pageerror', (e) => errors.push(String(e))); ip.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const IG = (fn, a) => ip.evaluate(fn, a), I2 = process.argv[3];
  const ishot = (n) => (I2 ? ip.screenshot({ path: `${I2}/${n}.png` }) : Promise.resolve());
  const iclose = async () => { if (await ip.locator('#sheet').isVisible()) await ip.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click(); };
  await ip.goto(URL0); await ip.waitForSelector('#title:not([hidden])');
  await ip.click('[data-act="titleNew"]'); await ip.fill('#t-co', '수습 시험'); await ip.click('[data-act="startNew"]'); await ip.click('#tabs button[data-tab="car"]'); await IG(() => window.__car.setSpeed(0));
  await IG(() => { const g = window.__car.game; g.state.cash = 1e7;
    g.command({ type: 'startProject', name: '수습카', body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    window.__car.tick(36); const p = g.state.projects[0]; g.command({ type: 'launch', projectId: p.id, price: 1300, marketing: 1, color: '#c8102e', wheels: 0 });
    window.__car.tick(24); });
  await iclose(); await toGarage(ip);
  check('0.9.0 차고 상세: 판매 요인(왼쪽 칸)·이 차의 손익(오른쪽 칸)은 접혀 있고 한 줄 요약', (await ip.locator('.pcol:first-child details.fold[data-fold="fac"]:not([open]) > summary').count()) === 1 && (await ip.locator('.pcol:nth-child(2) details.fold[data-fold="pnl"]:not([open]) > summary').innerText()).includes('개발비 뺀 이익'));
  await ip.click('details.fold[data-fold="pnl"] > summary'); await ip.click('details.fold[data-fold="fac"] > summary'); await IG(() => window.__car.tick(1));
  check('0.9.0 접힘 카드: 펼친 상태가 다음 주에도 유지', (await ip.locator('details.fold[open]').count()) === 2);
  check('0.10.0 차고: 이 차의 손익 카드(누적 매출·개발비·월별 이익)', (await ip.locator('#panel .pnl-card').count()) === 1 && (await ip.locator('#panel .pnl-card').innerText()).includes('개발비 합') && (await ip.locator('#panel .pnl-card svg').count()) === 1);
  const facN = await ip.locator('#panel .factors-card .fac-row').count();
  check('0.10.0 차고: 판매 요인 카드(막대, 가격 요인 포함)', facN >= 1 && (await ip.locator('#panel .factors-card .fac-row[data-key="price"]').count()) === 1, `${facN}줄`);
  await ip.locator('#panel .factors-card').scrollIntoViewIfNeeded(); await ishot('insight-garage-1366x1024');
  await IG(() => { const g = window.__car.game.state.nameplates[0].generations[0]; g.reviewAvg = 3.2; g.editions[0].defects = 18; window.__car.render(); });
  check('0.10.0 혹평 차: 다음 단계에 [긴급 개선] 켜짐', await ip.locator('[data-act="quickFix"]').isEnabled());
  await ip.click('[data-act="quickFix"]');
  check('0.10.0 긴급 개선 확인 창: 예상 효과(리콜 위험·품질 등급·비용)', (await ip.locator('#ask').isVisible()) && /리콜 위험.*품질 등급/.test(await ip.locator('#ask').innerText()));
  await ip.click('#ask-yes');
  check('0.10.0 긴급 개선 시작: 개발 프로젝트(fix), 가격 인하 판매는 막힘과 이유', (await IG(() => window.__car.game.state.projects[0]?.kind)) === 'fix' && !(await ip.locator('[data-act="clearance"]').isEnabled()) && (await ip.locator('.rescue .why').count()) >= 1);
  await IG(() => window.__car.tick(8)); await iclose(); await toGarage(ip);
  check('0.10.0 긴급 개선 8주 뒤 개선판 반영(결함 감소)', await IG(() => { const g = window.__car.game.state.nameplates[0].generations[0]; return !!g.fixed && g.editions.at(-1).defects < 18; }));
  await ip.click('[data-act="clearance"]'); await ip.click('#ask-yes');
  check('0.10.0 가격 인하 판매: 기준가의 88%로 고정', await IG(() => { const s = window.__car.game.state, g = s.nameplates[0].generations[0]; return !!g.clearance && g.editions.at(-1).price === g.clearance.price; }));
  await tab5(ip, 'people', 'psec', 'staff');
  await ip.locator('.srow:not(.head):not(.s-exec)').first().click();
  check('0.10.0 직원 상세: 경력(입사·능력 꺾은선·참여한 차)', (await ip.locator('#staff-card .career').innerText()).includes('입사') && (await ip.locator('#staff-card .career-cars').innerText()).includes('수습카'));
  await tab5(ip, 'fin', 'rectab', 'cars');
  check('0.10.0 기록 탭 차종 계보: 차종 손익 한 줄', (await ip.locator('#panel .np-pnl').count()) === 1);
  await IG(() => { window.__car.game.state.week = 9 * 48 + 11 * 4; window.__car.tick(4, true); }); // 1979년 12월 결산
  check('0.10.0 1979년 12월 결산 뒤 10년 회고 신문 창(자동 멈춤 연 보고서·10년 회고)', (await ip.locator('#sheet .decade-paper').isVisible()) && (await ip.locator('#sheet .decade-paper h3').innerText()).includes('1970년대'));
  await ip.waitForTimeout(500); await ishot('insight-decade-1366x1024');
  await iclose(); await tab5(ip, 'fin', 'rectab', 'years'); await ip.click('[data-act="decadeOpen"][data-v="1970"]');
  check('0.10.0 기록 탭에서 10년 회고 다시 보기', await ip.locator('#sheet .decade-paper').isVisible());
  await ictx.close(); }

// 0.9.0 화면 개편: 큰 메뉴 6개, 차고 전 차종 표 → 상세 → 돌아오기, 내 차 비교, 상단 손익 칩, 월 결산 창, 연구·재무 이동 호환, 1024×768 차 상세 두 칸
{ const gctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const gp = await gctx.newPage(); gp.on('pageerror', (e) => errors.push(String(e))); gp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const GG = (fn, a) => gp.evaluate(fn, a), G2 = process.argv[3];
  const gshot = (n) => (G2 ? gp.screenshot({ path: `${G2}/${n}.png` }) : Promise.resolve());
  const gclose = async () => { if (await gp.locator('#sheet').isVisible()) await gp.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click(); };
  await gp.goto(URL0); await gp.waitForSelector('#title:not([hidden])');
  await gp.click('[data-act="titleNew"]'); await gp.fill('#t-co', '개편 시험'); await gp.click('[data-act="startNew"]'); await gp.click('#tabs button[data-tab="car"]'); await GG(() => window.__car.setSpeed(0));
  check('5.0.0 주 메뉴 7탭, 1024×768 높이 안에 44px 이상', await (async () => { await gp.setViewportSize({ width: 1024, height: 768 }); const ok = await GG(() => { const b = [...document.querySelectorAll('#tabs button')]; return b.map((x) => x.dataset.tab).join() === 'today,car,research,people,group,market,fin' && b.every((x) => { const r = x.getBoundingClientRect(); return r.height >= 44 && r.width >= 44 && r.bottom <= innerHeight; }); }); await gp.setViewportSize({ width: 1366, height: 1024 }); return ok; })());
  // 연구·재무로 가는 예전 이동({company, research|fin})이 새 자리로
  await GG(() => window.__car.goTarget({ tab: 'company', sub: 'research' }));
  const r1 = await GG(() => window.__car.screen);
  await GG(() => window.__car.goTarget({ tab: 'company', sub: 'fin' }));
  const r2 = await GG(() => window.__car.screen);
  await GG(() => window.__car.goTarget({ tab: 'company', sub: 'factory' }));
  check('0.9.0 이동 호환: 할 일·보고의 {회사, 연구}→연구 화면, {회사, 재무}→재무 화면, {회사, 공장}→회사 공장', r1 === 'research' && r2 === 'fin' && (await GG(() => window.__car.screen)) === 'company' && (await gp.locator('#panel [data-act="cotab"][data-v="factory"]').getAttribute('aria-selected')) === 'true', `${r1} ${r2}`);
  // 차 3대 판매 + 1대 단종 + 1대 개발 중
  await GG(() => { const c = window.__car, g = c.game, s = g.state, Q = c.Q; s.hqLevel = 3; s.factory.level = 2; s.cash += 3000000;
    const mk = (i) => { const team = s.staff.filter((x) => x.projectId === null && x.role !== 'sales').map((x) => x.id); const r = g.command({ type: 'startProject', name: ['가람', '나래', '다솜', '라온', '마루'][i], body: 'sedanS', segment: ['worker', 'family', 'youth', 'rich'][i % 4], powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 20, team }); if (!r.ok) throw new Error(r.reason); return s.projects.at(-1).id; };
    const launch = (pid) => { let k = 0; while (k++ < 80) { const p = s.projects.find((x) => x.id === pid); if (p.phase === 'test' && p.testWeeks >= 4) break; c.tick(1); } g.devCheat('finishDev'); const r = g.command({ type: 'launch', projectId: pid, price: 1200, marketing: 1, color: '#1f4fd1', wheels: 1 }); if (!r.ok) throw new Error(r.reason); };
    for (let i = 0; i < 4; i++) { if (i === 3) { g.command({ type: 'discontinue', generationId: s.nameplates[1].generations[0].id }); c.tick(5); } launch(mk(i)); c.tick(4); }
    c.tick(8); mk(4); c.tick(2); c.render(); });
  await gclose(); await GG(() => { document.getElementById('toasts').innerHTML = ''; });
  await devHome(gp);
  await gp.locator('[data-act="goCo"][data-v="research"]').first().click();
  check('0.9.0 기다리는 동안 [연구] → 연구 화면(큰 메뉴 연구가 켜짐)', (await GG(() => window.__car.screen)) === 'research' && (await gp.locator('#tabs button[data-tab="research"]').getAttribute('class')).includes('on'));
  await carTable(gp);
  const rows = await gp.locator('.gtable [data-act="gopen"]').count(), head = (await gp.locator('.gtable .gtr.head').innerText()).replace(/\s+/g, ' ');
  check('0.9.0 차고 첫 화면: 전 차종 표 3줄(썸네일·차종·출시·가격·판매·대당 이익·월 이익·수명·평론·상태), 개발 중·단종 구역', rows === 3 && ['차종', '출시', '가격', '지난달 판매', '대당 이익', '월 이익', '수명', '평론', '상태'].every((t) => head.includes(t)) && (await gp.locator('.gtable .g-th img, .gtable .g-th svg').count()) === 3 && (await gp.locator('.gsec [data-act="devSel"]').count()) === 1 && (await gp.locator('details.gone .gsr').count()) === 1 && !(await gp.locator('#stage').isVisible()), `${rows} ${head}`);
  check('0.9.0 표 상태 배지: 수습 가능(긴급 개선·가격 인하 판매 조건)과 개수가 같음', await GG(() => { const c = window.__car, s = c.game.state, want = s.nameplates.flatMap((n) => n.generations).filter((g) => g.status === 'onSale' && !g.clearance && (() => { const R = c.Q.rescueOptions(s, g.id); return R && R.target === null && (R.fix.ok || R.clearance.ok); })()).length; return document.querySelectorAll('.gtable .gb').length >= 0 && [...document.querySelectorAll('.gtable .gb')].filter((b) => b.textContent === '수습 가능').length === want; }));
  await GG(() => { const s = window.__car.game.state, g = s.nameplates[0].generations[0]; g.clearance = { startMonth: 0, lastMonth: 9999, price: g.editions.at(-1).price }; window.__car.render(); });
  check('0.9.0 표 상태 배지: 가격 인하 판매 중', (await gp.locator('.gtable .gb', { hasText: '가격 인하 판매 중' }).count()) === 1);
  await GG(() => { delete window.__car.game.state.nameplates[0].generations[0].clearance; window.__car.render(); });
  await gshot('garage-table-1366x1024');
  await gp.click('.gtable [data-act="gSort"][data-v="profit"]');
  const pr = await GG(() => [...document.querySelectorAll('.gtable [data-act="gopen"]')].map((b) => b.dataset.id).join());
  const want = await GG(() => { const s = window.__car.game.state, L = s.ledger.at(-1).cars; return [...L].filter((c) => s.nameplates.some((n) => n.generations.some((g) => g.id === c.id && g.status === 'onSale'))).sort((a, b) => (b.revenue - b.cogs - b.marketing - b.recall) - (a.revenue - a.cogs - a.marketing - a.recall) || a.id - b.id).map((c) => c.id).join(); });
  check('0.9.0 표 머리글 [월 이익] 누르면 큰 순 정렬(장부 값)', pr === want && (await gp.locator('.gtable [data-act="gSort"][data-v="profit"]').getAttribute('aria-pressed')) === 'true', `${pr} / ${want}`);
  const first = pr.split(',')[0], second = pr.split(',')[1];
  await gp.locator(`.gtable [data-act="gopen"][data-id="${first}"]`).click(); await gp.waitForTimeout(300);
  { const parts = [(await GG(() => window.__car.garageId)) === Number(first), await gp.locator('#stage').isVisible(), await gp.locator('#keys').isVisible(), (await gp.locator('#keys').innerText()).includes('지난달 판매'), (await gp.locator('#keys').innerText()).includes('평론'), (await gp.locator('#panel .price-card').count()) === 1, (await gp.locator('#side [data-act="gsum"]').count()) === 1];
  check('0.9.0 줄 누르기 → 그 차 상세(무대·핵심 수치 띠·가격 카드·5.0.0 왼쪽 목록 [전 차종 비교])', parts.every(Boolean), JSON.stringify(parts)); }
  await gp.click(`#side [data-act="carOpen"][data-id="${second}"]`);
  check('5.0.0 왼쪽 목록은 표 순서, 다음 차를 누르면 그 차', (await GG(() => window.__car.garageId)) === Number(second));
  await gshot('garage-detail-1366x1024');
  await gp.click('#side [data-act="gsum"]');
  check('0.9.0 [← 전 차종] → 표로 돌아옴', (await gp.locator('.gtable').count()) === 1 && (await GG(() => window.__car.garageSum)) === true);
  // 내 차 비교
  check('0.9.0 비교 보기: 1대만 고르면 [경쟁 차와 비교](2.0.0)', await (async () => { await gp.locator('.gtable [data-act="cmpPick"]').nth(0).click(); const b = gp.locator('[data-act="cmpOpen"]'); return !(await b.isDisabled()) && (await b.innerText()) === '경쟁 차와 비교'; })());
  await gp.locator('.gtable [data-act="cmpPick"]').nth(1).click(); await gp.locator('.gtable [data-act="cmpPick"]').nth(2).click();
  await gp.click('[data-act="cmpOpen"]');
  const ct = await gp.locator('#sheet .cmp').innerText();
  check('0.9.0 내 차 비교: 3대 나란히, 능력치 5개·가격·판매·이익·수명·평론·경쟁 차 줄(2.0.0 모델 단위)', (await gp.locator('#sheet .cmp-t tr:first-child th').count()) === 4 && ['성능', '연비', '실용', '디자인', '품질', '가격', '지난달 판매', '대당 이익', '월 이익', '수명', '평론 평균', '가장 많이 팔리는 경쟁 차', '세대'].every((t) => ct.includes(t)));
  await gshot('compare-1366x1024'); await gclose();
  // 상단 손익 칩·월 결산 창
  const pl = await GG(() => { const L = window.__car.game.state.ledger.at(-1), b = document.getElementById('pl'); return { t: b.innerText, up: L.profit >= 0, cls: b.className }; });
  check('0.9.0 상단 바 지난달 손익 칩: 화살표·금액·색', /^[▲▼][\d,.]+(억|만원)|^[▲▼]0원/.test(pl.t) && (pl.t[0] === '▲') === pl.up && pl.cls === (pl.up ? 'pos' : 'neg'), JSON.stringify(pl));
  await gp.click('#plchip');
  check('0.9.0 손익 칩 누르기 → 재무 화면', (await GG(() => window.__car.screen)) === 'fin');
  await gp.locator('.mon-list [data-act="monthOpen"]').first().click();
  const mt = await gp.locator('#sheet .mon').innerText(), led = await GG(() => { const L = window.__car.game.state.ledger.at(-1); return { y: L.year, m: L.monthOfYear, n: L.cars.length }; });
  check('0.9.0 재무 → 월 결산 창: 그달 차종별 줄·지출 내역·전월 대비', mt.includes(`${led.y}년 ${led.m}월 결산`) && (await gp.locator('#sheet .mon-cars tr').count()) === led.n + 1 && ['직원 월급', '본사 유지비', '공장 유지비', '광고비', '전월 대비'].every((t) => mt.includes(t)), JSON.stringify(led));
  await gp.click('#sheet [data-act="monthOpen"]:has-text("이전 달")');
  check('0.9.0 월 결산 창 [이전 달]', (await gp.locator('#sheet .mon h2').innerText()).includes(led.m === 1 ? '12월' : `${led.m - 1}월`));
  await gshot('month-1366x1024'); await gclose();
  await GG(() => { document.getElementById('toasts').innerHTML = ''; window.__car.tick(4, true); });
  const mtoast = gp.locator('#toasts .toast', { hasText: '결산' });
  check('0.9.0 월 결산 알림에 [펼쳐 보기]', (await mtoast.count()) === 1 && (await mtoast.locator('.open').innerText()) === '펼쳐 보기');
  if (await gp.locator('#toasts .more').isVisible()) await gp.click('#toasts .more'); // 같은 주에 알림이 셋 이상이면 "+N"을 펼친다
  await GG(() => window.__car.setSpeed(0)); // 클릭 직전에 멈춤. 알림이 이미 닫혔으면(6초) 재무 화면의 월 결산 목록에서 연다
  if (await gp.locator('#toasts .toast:not(.out)', { hasText: '결산' }).count()) await mtoast.locator('.open').click({ timeout: 8000 }).catch(() => {});
  if (!(await gp.locator('#sheet .mon').isVisible())) { await gclose(); await GG(() => document.querySelector('#tabs button[data-tab="fin"]').click()); await gp.locator('.mon-list [data-act="monthOpen"]').first().click(); }
  check('0.9.0 월 결산 알림 [펼쳐 보기] → 이번 달 결산 창', await gp.locator('#sheet .mon').isVisible());
  await gclose();
  // 1024×768: 차 상세 패널이 스크롤 없이 가격 카드와 성적 카드를 함께 보이고, 상단 바가 넘치지 않음
  await gp.setViewportSize({ width: 1024, height: 768 }); await gp.waitForTimeout(200);
  await carTable(gp); await gp.locator('.gtable [data-act="gopen"]').first().click(); await gp.waitForTimeout(300); await gp.click('#ov [data-act="carJump"][data-v="price"]'); await gp.waitForTimeout(700); // 5.0.0 무대 [가격·광고]로 아래 칸
  const fit = await GG(() => { const p = { top: document.getElementById('top').getBoundingClientRect().bottom, bottom: document.getElementById('tabs').getBoundingClientRect().top }, a = document.querySelector('#panel .price-card').getBoundingClientRect(), b = document.querySelector('#panel .perf-card').getBoundingClientRect(), top = document.getElementById('top'); return { ok: a.top >= p.top - 1 && b.top >= p.top - 1 && a.top + 160 <= p.bottom && b.top + 160 <= p.bottom, topOver: top.scrollWidth > top.clientWidth + 1 }; });
  check('0.9.0 1024×768 차 상세: 무대 [가격·광고]를 누르면 패널 두 칸에 가격 카드와 성적 카드가 한 화면에 함께, 상단 바 넘침 없음', fit.ok && !fit.topOver, JSON.stringify(fit));
  await gshot('garage-detail-1024x768');
  // 상단 바 최악 조건(사건 칩·결정 대기·손익 칩·결정 중 표시를 모두 띄움): 각 요소가 화면 안, 서로 겹치지 않고 잘리지 않음
  const topWorst = () => GG(() => (() => {
  const s = window.__car.game.state; window.__car.setSpeed(0);
  if (!s.ledger.length) s.ledger.push({ month: 0, year: 1970, monthOfYear: 1, revenue: 0, cogs: 0, salaries: 0, upkeep: 0, dev: 0, marketing: 0, interest: 0, recall: 0, oneOff: 0, profit: -123456, cash: 0, sold: 0 });
  window.__car.render();
  const ch = document.getElementById('evchip'); ch.hidden = false; ch.dataset.v = 'x'; ch.innerHTML = '<span class="ev-n">포티 소형 세단 히트작</span><span class="ev-m"> · 13개월 +1</span>';
  const pd = document.getElementById('pend'); pd.hidden = false; pd.dataset.v = 'x'; pd.innerHTML = '<svg viewBox="0 0 24 24"></svg><b>2</b><span class="pd-t">결정 대기</span>';
  document.getElementById('held').hidden = false;
  const q = ['#date', '#cashpill', '#plchip', '#decbtn', '#speeds', '#held', '#skipbtn', '#menubtn']; // 5.0.0 위쪽 줄(회사 이름·사건·결정 대기·할 일·평판·소리는 메뉴 안)
  const R = q.map((x) => { const e = document.querySelector(x); if (!e || e.hidden || getComputedStyle(e).display === 'none' || !e.getBoundingClientRect().width) return null; const r = e.getBoundingClientRect(); return { q: x, l: r.left, r: r.right, clip: getComputedStyle(e).overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1 && x !== '#evchip' && x !== '#co' }; }).filter(Boolean);
  const bad = [];
  R.forEach((a, i) => { if (a.l < 0 || a.r > innerWidth) bad.push(`${a.q} 화면 밖`); if (a.clip) bad.push(`${a.q} 잘림`); const b = R[i + 1]; if (b && a.r > b.l + 0.5) bad.push(`${a.q}·${b.q} 겹침`); });
  return { bad, h: document.getElementById('top').getBoundingClientRect().height };
})());
  const tw = {}; for (const [w, h] of [[1024, 768], [1180, 820], [1280, 800], [1366, 1024]]) { await gp.setViewportSize({ width: w, height: h }); await gp.waitForTimeout(150); tw[w] = await topWorst(); if (w === 1024) await gshot('topbar-worst-1024x768'); }
  check('0.9.0 상단 바 최악 조건(1024·1180·1280·1366): 로고~메뉴가 화면 안, 겹침·잘림 없음, 한 줄', Object.values(tw).every((x) => !x.bad.length && x.h < 80), JSON.stringify(tw));
  { await GG(() => { const s = window.__car.game.state; s.cash = 340120000; s.reputation = 432; s.ledger.at(-1).profit = 12340000; window.__car.render(); }); // 1.0.0 조 단위 현금·천억대 손익·세 자리 평판
    const tw2 = {}; for (const [w, h] of [[1024, 768], [1180, 820], [1280, 800], [1366, 1024]]) { await gp.setViewportSize({ width: w, height: h }); await gp.waitForTimeout(150); tw2[w] = { ...(await topWorst()), cash: await gp.locator('#cash').innerText(), pl: await gp.locator('#pl').innerText(), rep: await gp.locator('#rep').innerText() }; if (w === 1024 && G2) await gp.screenshot({ path: `${G2}/topbar-jo-1024x768.png` }); }
    check('1.0.0 상단 바 최악 조건 + 조 단위 현금(3조 4,012억)·손익 ▲1,234억·평판 432(1024~1366): 겹침·잘림 없음, 좁으면 "3.4조"', Object.values(tw2).every((x) => !x.bad.length && x.h < 80 && x.rep === '432') && tw2[1024].cash === '3.4조', JSON.stringify(tw2));
    await GG(() => { const s = window.__car.game.state; s.cash = 1e6; s.reputation = 50; window.__car.render(); }); }
  await gp.setViewportSize({ width: 1024, height: 768 }); await GG(() => window.__car.render());
  check('0.9.0 1024×768: 본문·패널 가로 넘침 없음(표·상세·재무·연구)', await (async () => { const r = []; for (const t of ['car', 'fin', 'research']) { await gp.click(`#tabs button[data-tab="${t}"]`); await gp.waitForTimeout(100); r.push(await GG(() => { const p = document.getElementById('panel'); return Math.max(document.documentElement.scrollWidth - innerWidth, p.scrollWidth - p.clientWidth); })); } return r.every((x) => x <= 0); })());
  // ---- 1.0.0 화면 정리 ----
  const M2 = process.argv[3] ? `${process.argv[3]}/m2` : '';
  const mshot = async (n) => { if (M2) { const { mkdirSync } = await import('node:fs'); mkdirSync(M2, { recursive: true }); await gp.screenshot({ path: `${M2}/${n}.png` }); } };
  await gp.setViewportSize({ width: 1180, height: 820 }); await gp.waitForTimeout(200); await GG(() => { window.__car.setSpeed(0); document.getElementById('toasts').innerHTML = ''; });
  // L4 1180×820: 차 상세 두 칸(가격·성적 카드가 스크롤 없이), 상단 바 넘침 없음
  await carTable(gp); await gp.locator('.gtable [data-act="gopen"]').first().click(); await gp.waitForTimeout(300); await gp.click('#ov [data-act="carJump"][data-v="price"]'); await gp.waitForTimeout(700); // 5.0.0 무대 [가격·광고]로 아래 칸
  const fit2 = await GG(() => { const p = { top: document.getElementById('top').getBoundingClientRect().bottom, bottom: document.getElementById('tabs').getBoundingClientRect().top }, a = document.querySelector('#panel .price-card').getBoundingClientRect(), b = document.querySelector('#panel .perf-card').getBoundingClientRect(), top = document.getElementById('top'); return { ok: a.top >= p.top - 1 && b.top >= p.top - 1 && a.top + 160 <= p.bottom && b.top + 160 <= p.bottom, topOver: top.scrollWidth > top.clientWidth + 1 }; });
  check('1.0.0 1180×820 차 상세: 무대 [가격·광고]를 누르면 패널 두 칸에 가격 카드와 성적 카드가 한 화면에 함께, 상단 바 넘침 없음', fit2.ok && !fit2.topOver, JSON.stringify(fit2));
  await mshot('garage-detail-1180x820');
  // U4 차고 표에서 여러 대 한 번에: 모두 고르기 → 자동 가격(최고 이익) → 확인 창(대상·바꿀 수 없는 차와 이유) → 적용 → 한 번에 되돌리기
  await gp.click('#side [data-act="gsum"]'); await gp.locator('[data-act="cmpClear"]').first().click().catch(() => {});
  await GG(() => { const s = window.__car.game.state, g = s.nameplates.flatMap((n) => n.generations).find((x) => x.status === 'onSale'); for (const x of s.nameplates.flatMap((n) => n.generations)) delete x.pricePolicy; g.clearance = { startMonth: 0, lastMonth: 9999, price: g.editions.at(-1).price }; window.__car.render(); });
  const nSell = await gp.locator('.gtable [data-act="gopen"]').count();
  await gp.click('[data-act="cmpAll"]');
  check('1.0.0 차고 표 [모두 고르기]: 판매 중인 차 모두(비교와 같은 네모), [한 번에 바꾸기] 켜짐', (await gp.locator('.gtable [data-act="cmpPick"][aria-pressed="true"]').count()) === nSell && (await gp.locator('[data-act="bulkOpen"]').isEnabled()));
  await gp.click('[data-act="bulkOpen"]'); await gp.click('#sheet [data-act="bulkPick"][data-k="policy"][data-v="best"]');
  check('1.0.0 일괄 창: 차마다 지금 가격·광고·바뀌는 것, 가격 인하 판매 중인 차는 "바꿀 수 없음"', (await gp.locator('#sheet .bulk-t tr').count()) === nSell + 1 && (await gp.locator('#sheet .bulk-t').innerText()).includes('바꿀 수 없음'));
  await mshot('bulk-1180x820');
  await gp.click('#sheet [data-act="bulkApply"]');
  const askT = await gp.locator('#ask-text').innerText();
  check('1.0.0 일괄 확인 창: 대상과 변경 내용, 적용 불가 차와 이유', askT.includes('최고 이익 가격 유지') && askT.includes('바꿀 수 없는 1대') && askT.includes('가격 인하 판매 중'), askT.replace(/\n/g, ' / '));
  await mshot('bulk-confirm-1180x820');
  await gp.click('#ask-yes'); await gp.waitForTimeout(200);
  const pol = () => GG(() => window.__car.game.state.nameplates.flatMap((n) => n.generations).filter((g) => g.status === 'onSale').map((g) => g.pricePolicy?.kind ?? '-').join());
  const p1 = await pol();
  check('1.0.0 일괄 적용: 바꿀 수 있는 차만 최고 이익 가격', p1.split(',').filter((x) => x === 'best').length === nSell - 1, p1);
  await gp.locator('#toasts [data-undo]').first().click();
  check('1.0.0 일괄 적용을 [되돌리기] 한 번으로 모두 되돌림', (await pol()).split(',').every((x) => x === '-'), await pol());
  await GG(() => { for (const g of window.__car.game.state.nameplates.flatMap((n) => n.generations)) delete g.clearance; document.getElementById('toasts').innerHTML = ''; window.__car.render(); });
  // U3 설정 화면 · U2 알림 종류 켜고 끄기, 묶기, 기록함
  await openSave(gp); await gp.click('#sheet [data-act="settings"]'); await gp.click('#sheet [data-act="setTab"][data-v="note"]');
  check('1.3.0 설정 알림: 유형 14개(2.0.0 경쟁사 신차, 3.0.0 자회사, 3.7.0 자동 승인, 4.0.0 세계 시장) + 그 밖 3개, 경고·결정 대기는 끌 수 없음', (await gp.locator('#sheet .note-topics [data-act="noteCat"]').count()) === 14 && (await gp.locator('#sheet [data-act="noteCat"]').count()) === 17 && (await gp.locator('#sheet [data-act="noteCat"]:disabled').count()) === 2);
  await mshot('settings-note-1180x820');
  await gp.click('#sheet [data-act="noteCat"][data-v="launch"]');
  check('1.0.0 알림 종류 끄기(출시·평론) → 기기 저장소', (await GG(() => JSON.parse(localStorage.getItem('car-company-notify')).launch)) === false && (await gp.locator('#sheet [data-act="noteCat"][data-v="launch"]').getAttribute('aria-pressed')) === 'false');
  await gp.click('#sheet [data-act="closeSheet"]');
  await GG(() => window.__car.toast('점검 평판 변화', '', '평판', 5000, '', undefined, 'launch'));
  check('1.0.0 꺼 둔 종류는 띄우지 않음', (await gp.locator('#toasts .toast', { hasText: '점검 평판 변화' }).count()) === 0);
  await GG(() => { localStorage.removeItem('car-company-notify'); });
  await openSave(gp); await gp.click('#sheet [data-act="settings"]'); await gp.click('#sheet [data-act="noteCat"][data-v="launch"]'); await gp.click('#sheet [data-act="closeSheet"]');
  await GG(() => { for (let i = 1; i <= 3; i++) window.__car.toast(`평판 묶음 ${i}`, '', '평판', 5000, '', undefined, 'launch'); });
  const grp = await GG(() => [...document.querySelectorAll('#toasts .toast[data-cat="launch"]:not(.out)')].map((x) => x.innerText));
  check('1.0.0 같은 종류가 연달아 오면 묶음("출시·평론 3건", 마지막 내용)', grp.length === 1 && grp[0].includes('출시·평론 3건') && grp[0].includes('평판 묶음 3'), JSON.stringify(grp));
  // 월 결산 알림: 다음 달에는 같은 자리에서 내용만 바뀜(새로 만들지 않음, 등장 움직임 한 번)
  // 1.3.0 흔들림 원인: 두 달 사이에 (1) 다른 알림 둘 이상이 오면 화면 알림 수 상한(2개)으로 오래된 월 결산 알림이 닫히고, (2) 점검 호출 사이 실제 시간이 6초를 넘으면 알림이 저절로 닫혔다.
  // 그래서 이 점검 동안만 재무·결산 말고 끌 수 있는 유형을 끄고(경고는 그대로), 두 달 진행과 확인을 한 번의 호출 안에서 한다(실제 시간에 기대지 않음)
  const same = await GG(() => { const c = window.__car, N = c.noteSet, keep = { ...N }; for (const k of Object.keys(N)) if (k !== 'finance') N[k] = false;
    try { document.getElementById('toasts').innerHTML = ''; c.tick(4, true);
      const t0 = [...document.querySelectorAll('#toasts .toast')].find((x) => x.innerText.includes('결산')); if (t0) t0.dataset.probe = '1'; c.tick(4, true);
      const t = [...document.querySelectorAll('#toasts .toast:not(.out)')].filter((x) => x.innerText.includes('결산')); return { n: t.length, probe: t[0]?.dataset.probe ?? '', seen: t[0]?.classList.contains('seen') ?? false, first: !!t0 };
    } finally { Object.assign(N, keep); } });
  check('1.0.0 월 결산 알림은 다음 달에 같은 자리에서 바뀜(다시 등장하지 않음)', same.n === 1 && same.probe === '1' && same.seen, JSON.stringify(same));
  { if (await gp.locator('#toasts .more').isVisible()) await gp.click('#toasts .more');
    // 알림은 6초 뒤 닫힌다. 느린 소프트웨어 렌더에서 그 전에 못 누르면(이미 닫히는 중) 흔들림이 아니라 시간 초과로 보고 건너뛴다
    const t0 = Date.now(), mt = gp.locator('#toasts .toast:not(.out)', { hasText: '결산' });
    if (await mt.count()) { let e = null; await mt.locator('.open').click({ timeout: 8000 }).catch((x) => { e = x; });
      const gone = e && !(await gp.locator('#toasts .toast:not(.out)', { hasText: '결산' }).count());
      // 1.3.1 벽시계 5초 기준은 부하가 있으면 0.01초 차이로 실패해, Playwright 클릭이 시간 초과 없이 성공하고 결산 창이 보이는지만 본다(느린 렌더에서 알림이 안정되는 데 5초를 넘긴 적이 있어 클릭 제한은 8초. 알림이 6초에 닫히면 gone으로 따로 본다)
      check('1.0.0 월 결산 [펼쳐 보기] 클릭이 바로 됨(재시도 시간 초과 없이)', gone || (!e && (await gp.locator('#sheet .mon').isVisible())), gone ? '알림이 6초가 지나 닫혀 확인 못 함(느린 렌더)' : `${Date.now() - t0}ms`); }
    else console.log('WARN 월 결산 알림이 이미 닫혀(6초) 클릭 확인을 건너뜀'); }
  await gclose();
  await menuItem(gp, '#todobtn'); await gp.click('#drawer [data-act="todoTab"][data-v="notes"]');
  const nN = await gp.locator('#drawer .note-it').count(), nTxt = await gp.locator('#drawer .note-list').innerText();
  check('1.0.0 할 일 창 세 번째 탭 "알림": 지난 알림 기록(날짜·종류), 꺼 둔 종류도 남음', nN >= 4 && nTxt.includes('월 결산') && nTxt.includes('점검 평판 변화') && /\d{4}년 \d+월/.test(nTxt), `${nN}건`);
  await mshot('notes-1180x820');
  await gp.locator('#drawer .note-it[data-act="noteGo"]', { hasText: '결산' }).first().click();
  check('1.0.0 기록함 항목 누르기 → 그 화면(월 결산 창)', await gp.locator('#sheet .mon').isVisible());
  await gclose();
  // 평판 ⓘ: 지금 효과 목록과 다음 문턱(1.0.0 Q.reputationInfo)
  await menuItem(gp, '#top [data-info="term:평판"]');
  { const t = await GG(() => window.__car.tip?.text ?? ''); check('1.0.0 상단 평판 ⓘ: 지금 효과 목록과 다음 문턱', t.includes('지금 효과') && t.includes('인지도') && t.includes('채용 후보'), t.replace(/\n/g, ' ').slice(0, 120)); }
  await gp.click('#tabs button[data-tab="group"]');
  // L2 회사 요약
  await tab5(gp, 'group', 'cotab', 'sum');
  const coT = await gp.locator('#panel .co-sum').innerText();
  check('1.0.0 회사 요약: 직원·임원·본사·공장·자회사(3.0.0)·세계 시장(4.0.0)·월 고정비 칸', (await gp.locator('#panel .co-sum .co-box').count()) === 7 && ['직원', '임원', '본사', '공장', '자회사', '세계 시장', '월 고정비', '가동률', '생산 라인'].every((w) => coT.includes(w)));
  await mshot('company-sum-1180x820');
  await gp.click('#panel .co-box[data-v="factory"]');
  check('1.0.0 회사 요약 칸 누르기 → 그 안쪽 탭(공장)', (await gp.locator('#panel [data-act="cotab"][data-v="factory"]').getAttribute('aria-selected')) === 'true');
  // L3 재무: 기간 선택, 표, 그래프 3개, 대출 카드
  await gp.click('#tabs button[data-tab="fin"]');
  const ft = await gp.locator('#panel .fin-t tr').first().innerText();
  check('1.0.0 재무(1년): 달마다 표(매출·원가·판매관리·개발·이익·현금)와 그래프 3개, 대출·구제 금융 카드', (await gp.locator('#panel .fin-t tr').count()) >= 2 && (await gp.locator('#panel .fin-chart').count()) === 3 && ['매출', '원가', '판매관리', '개발', '이익', '현금'].every((w) => ft.includes(w)) && (await gp.locator('#panel .fin-loan [data-act="borrow"]').count()) === 3);
  await mshot('fin-1y-1180x820');
  await gp.click('[data-act="finRange"][data-v="all"]');
  const yrs = await GG(() => { const s = window.__car.game.state, y = s.ledger.at(-1)?.year; return window.__car.Q.reportYears(s).length + (y !== undefined && !window.__car.Q.reportYears(s).includes(y) ? 1 : 0); });
  check('1.0.0 재무(전체): 해마다 한 줄', (await gp.locator('#panel .fin-t tr').count()) === yrs + 1, `${await gp.locator('#panel .fin-t tr').count()} / ${yrs + 1}`);
  await mshot('fin-all-1180x820');
  // L1 개발: 프로젝트 두 개면 띠의 ‹ ›로 넘김, 1024에서 카드 수치가 말줄임되지 않음
  await GG(() => { const g = window.__car.game, s = g.state, p = s.projects[0], team = s.staff.filter((x) => x.projectId === p.id && x.role !== 'sales').slice(0, 2); for (const x of team) g.command({ type: 'assign', staffId: x.id, projectId: null });
    g.command({ type: 'startProject', name: '바다', body: 'sedanS', segment: 'family', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 20, team: team.map((x) => x.id) }); window.__car.render(); });
  await devHome(gp); await gp.waitForTimeout(300);
  const nP = await GG(() => window.__car.game.state.projects.length);
  if (nP >= 2) { const a = await gp.locator('#ov .ofc-t b').innerText(); await gp.click('#ov [data-act="devStep"][data-v="1"]'); check('1.0.0 개발: 동시 개발이면 위쪽 띠의 › 로 다음 프로젝트', (await gp.locator('#ov .ofc-t b').innerText()) !== a); }
  else check('1.0.0 개발: 동시 개발 준비(프로젝트 2개)', false, `${nP}개`);
  await mshot('dev-1180x820');
  await gp.setViewportSize({ width: 1024, height: 768 }); await gp.waitForTimeout(300);
  check('1.0.0 개발(1024×768): 카드 수치·제목이 말줄임·넘침 없음', await GG(() => [...document.querySelectorAll('#panel .kpi b, #panel .card h2, #panel .dsteps li')].every((b) => b.scrollWidth <= b.clientWidth + 1)));
  await mshot('dev-1024x768');
  // 1.0.0 고객층에 맞게 자동 배치: [자동 배치] → Q.bestTeam 결과가 팀에 반영, 요약(매력 전→후·개발비·기간), 엔지니어 1명은 연구에
  await gp.setViewportSize({ width: 1180, height: 820 }); await gclose();
  await GG(() => { const s = window.__car.game.state, b = s.staff[0]; s.hqLevel = 5; const roles = ['designer', 'engineer', 'tester', 'designer', 'engineer', 'tester', 'engineer'];
    roles.forEach((r, i) => s.staff.push({ ...b, id: 8800 + i, name: `자동${i}`, role: r, ability: 35 + i * 7, projectId: null, trainings: [], restUntil: null, lab: false })); window.__car.render(); });
  await devHome(gp); await gp.locator('[data-act="plan"]').first().click();
  if ((await GG(() => window.__car.screen)) === 'start') await gp.click('[data-act="pickNew"]');
  await gp.click('[data-act="ptab"][data-v="budget"]');
  await gp.click('[data-act="autoTeam"]');
  const at = await GG(() => { const c = window.__car, d = c.draft, r = c.Q.bestTeam(c.game.state, d, { keepEngineer: true }); return { got: [...d.team].sort((a, b) => a - b).join(), want: r.team.join(), reserved: r.reserved, n: r.team.length, idle: c.game.state.staff.filter((x) => x.projectId === null && x.role !== 'sales' && !x.lab).length }; });
  const an = await gp.locator('#panel .auto-note').innerText().catch(() => '');
  check('1.0.0 [고객층에 맞게 자동 배치] → bestTeam 팀이 기획에 반영, 요약(매력 전→후·개발비·기간), 엔지니어 1명은 연구에 남김', at.got === at.want && at.n > 0 && at.reserved !== null && !at.got.split(',').includes(String(at.reserved)) && /고객층 매력 [\d.]+ → [\d.]+/.test(an) && an.includes('개발비') && an.includes('엔지니어'), JSON.stringify(at));
  await mshot('auto-team-1180x820');
  await gp.locator('#panel .pick[aria-pressed="true"]').first().click();
  check('1.0.0 자동 배치 뒤 손으로 고치면 그대로 반영(요약은 사라짐)', (await GG(() => window.__car.draft.team.length)) === at.n - 1 && (await gp.locator('#panel .auto-note').count()) === 0);
  await gp.click('[data-act="cancelPlan"]');
  // 1.0.0 창 바깥 누르기: 할 일·설정·월 결산·비교 창은 닫히고, 결정할 사건 창은 안 닫히고, 확인 창은 취소로
  const outside = async () => { await gp.mouse.click(6, 816); await gp.waitForTimeout(150); };
  const open = async (name, fn) => { await fn(); await gp.waitForSelector('#sheet:not([hidden])'); await outside(); return [name, await gp.locator('#sheet').isHidden()]; };
  const R = [];
  await menuItem(gp, '#todobtn'); await gp.waitForSelector('#drawer:not([hidden])'); await gp.mouse.click(300, 400); await gp.waitForTimeout(150);
  R.push(['할 일 서랍', await gp.locator('#drawer').isHidden()]);
  R.push(await open('설정', async () => { await openSave(gp); await gp.click('#sheet [data-act="settings"]'); }));
  R.push(await open('월 결산', () => GG(() => window.__car.showMonth(window.__car.game.state.ledger.length - 1))));
  await carTable(gp); await gp.locator('[data-act="cmpClear"]').first().click().catch(() => {});
  await gp.locator('.gtable [data-act="cmpPick"]').nth(0).click(); await gp.locator('.gtable [data-act="cmpPick"]').nth(1).click();
  R.push(await open('비교', () => gp.click('[data-act="cmpOpen"]')));
  check('1.0.0 창 바깥을 누르면 닫힘(할 일·설정·월 결산·비교)', R.every(([, h]) => h), JSON.stringify(R));
  await GG(() => { const c = window.__car, s = c.game.state; s.events.pending.push({ id: s.nextId++, eventId: 'motorshow', text: '점검용 결정', week: s.week, deadline: s.week + 8, genId: null, fx: null }); c.render(); });
  await menuItem(gp, '#pend'); await gp.waitForSelector('#panel .choice-sheet'); await outside();
  check('1.0.0 결정할 사건(5.0.0 오늘 탭 상세)은 바깥을 눌러도 닫히지 않음', await gp.locator('#panel .choice-sheet').isVisible());
  await gp.click('#panel [data-act="later"]'); await carTable(gp); // 5.0.0 결정은 오늘 탭에서 열렸으므로 차고(차 탭 전 차종 표)로 돌아간다
  const gid = await GG(() => window.__car.game.state.nameplates.flatMap((n) => n.generations).find((g) => g.status === 'onSale').id);
  await gp.locator(`.gtable [data-act="gopen"][data-id="${gid}"]`).click(); await gp.click('[data-act="discontinue"]'); await gp.waitForSelector('#ask:not([hidden])');
  await gp.mouse.click(6, 816); await gp.waitForTimeout(150);
  check('1.0.0 확인 창(단종) 바깥 누르기 = 취소(창 닫힘, 단종 안 됨)', (await gp.locator('#ask').isHidden()) && (await GG((id) => window.__car.game.state.nameplates.flatMap((n) => n.generations).find((g) => g.id === id).status, gid)) === 'onSale');
  // ---- 1.0.0 추가: 조 단위 금액 KPI, 할 일 서랍(나중에·다시 알리지 않기), 계보 정렬, 명예의 전당 ----
  await gclose(); await GG(() => { const s = window.__car.game.state, g = s.nameplates.flatMap((n) => n.generations).find((x) => x.status === 'onSale');
    g.profit = 117140000; if (g.pnl) g.pnl.rev = 234560000; s.cash = 123450000; const L = s.ledger.at(-1); L.revenue = 123450000; L.profit = -123450000; L.cash = 123450000; window.__car.render(); });
  const clipped = (root) => GG((q) => [...document.querySelectorAll(`${q} .kpi b, ${q} .co-box > b`)].filter((b) => b.offsetParent && (b.scrollWidth > b.clientWidth + 1 || getComputedStyle(b).textOverflow === 'ellipsis' && b.scrollWidth > b.clientWidth)).map((b) => b.innerText), root);
  const longRes = {};
  for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024]]) {
    await gp.setViewportSize({ width: w, height: h }); await gp.waitForTimeout(150);
    await carTable(gp); const gid0 = await GG(() => window.__car.game.state.nameplates.flatMap((n) => n.generations).find((x) => x.status === 'onSale').id);
    await gp.locator(`.gtable [data-act="gopen"][data-id="${gid0}"]`).click(); await gp.waitForTimeout(200);
    if (!(await gp.locator('details.fold[data-fold="pnl"][open]').count())) await gp.click('details.fold[data-fold="pnl"] > summary');
    await gp.locator('#panel .pnl-card').scrollIntoViewIfNeeded(); const a1 = await clipped('#panel');
    if (M2) await gp.screenshot({ path: `${M2}/pnl-long-${w}x${h}.png` });
    await gp.click('#tabs button[data-tab="fin"]'); const a2 = await clipped('#panel');
    await tab5(gp, 'group', 'cotab', 'sum'); const a3 = await clipped('#panel');
    await GG(() => window.__car.showMonth(window.__car.game.state.ledger.length - 1)); const a4 = await clipped('#sheet'); await gclose();
    longRes[w] = [...a1, ...a2, ...a3, ...a4];
  }
  check('1.0.0 조 단위 금액(1조 1,714억·−1조 2,345억)이 KPI 칸에서 말줄임·넘침 없음(차 손익·성적·재무·회사 요약·월 결산, 세 해상도)', Object.values(longRes).every((x) => !x.length), JSON.stringify(longRes));
  await GG(() => { const s = window.__car.game.state; s.cash = 1e6; window.__car.render(); });
  // 할 일 서랍: 나중에(이번 달 숨김), 다시 알리지 않기(설정에서 되돌림), 1024에서 화면을 다 덮지 않음, 항목 56px·글자 14px
  await gp.setViewportSize({ width: 1024, height: 768 }); await gp.waitForTimeout(150);
  await menuItem(gp, '#todobtn'); await gp.waitForSelector('#drawer:not([hidden])');
  const dw = await GG(() => { const d = document.getElementById('drawer').getBoundingClientRect(), it = [...document.querySelectorAll('#drawer .todo-it')].filter((x) => x.offsetParent); return { w: d.width, left: d.left, minH: Math.min(...it.map((x) => x.getBoundingClientRect().height)), fs: Math.min(...it.map((x) => parseFloat(getComputedStyle(x.querySelector('b')).fontSize))) }; });
  check('1.0.0 할 일 서랍(1024×768): 오른쪽 380~420px, 게임 화면이 옆에 보임, 항목 56px·글자 14px 이상', dw.w >= 380 && dw.w <= 421 && dw.left >= 500 && dw.minH >= 56 && dw.fs >= 14, JSON.stringify(dw));
  if (M2) for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024]]) { await gp.setViewportSize({ width: w, height: h }); await gp.waitForTimeout(150); await gp.screenshot({ path: `${M2}/todo-drawer-${w}x${h}.png` }); }
  await gp.locator('#drawer details.todo-ref > summary').click().catch(() => {}); // 참고도 펼쳐서
  const tFirst = await gp.locator('#drawer .todo-row:has([data-act="todoLater"]) .todo-it').first().getAttribute('data-k');
  await gp.locator(`#drawer [data-act="todoLater"][data-k="${tFirst}"]`).click();
  check('1.0.0 할 일 [나중에] → 이번 달 동안 숨김', (await gp.locator(`#drawer .todo-it[data-k="${tFirst}"]`).count()) === 0, tFirst);
  const mk2 = await gp.locator('#drawer [data-act="todoMute"]').first().getAttribute('data-v');
  await gp.locator('#drawer [data-act="todoMute"]').first().click();
  check('1.0.0 할 일 [다시 알리지 않기] → 그 종류 사라짐·기기 저장소', (await gp.locator(`#drawer .todo-it[data-kind="${mk2}"]`).count()) === 0 && (await GG(() => JSON.parse(localStorage.getItem('car-company-todomute')))).includes(mk2));
  await gp.click('#drawer [data-act="drawerClose"]'); await openSave(gp); await gp.click('#sheet [data-act="settings"]'); await gp.click('#sheet [data-act="setTab"][data-v="note"]');
  await gp.click(`#sheet [data-act="todoUnmute"][data-v="${mk2}"]`);
  check('1.0.0 설정 → 알림에서 다시 알리기', !(await GG(() => JSON.parse(localStorage.getItem('car-company-todomute')))).includes(mk2)); await gclose();
  // 차종 계보 정렬·필터, 명예의 전당
  await gp.setViewportSize({ width: 1180, height: 820 }); await tab5(gp, 'fin', 'rectab', 'cars');
  await gp.click('[data-act="linSort"][data-v="sold"]');
  const order = await GG(() => [...document.querySelectorAll('.lineage-card')].map((x) => Number(x.dataset.np)));
  const want2 = await GG(() => [...window.__car.game.state.nameplates].filter((n) => n.generations.length).sort((a, b) => b.generations.reduce((x, g) => x + g.totalSold, 0) - a.generations.reduce((x, g) => x + g.totalSold, 0) || a.id - b.id).map((n) => n.id));
  check('1.0.0 차종 계보 정렬(많이 팔린 순)·기기에 기억', order.join() === want2.join() && (await GG(() => JSON.parse(localStorage.getItem('car-company-lineage')).sort)) === 'sold', `${order} / ${want2}`);
  if (M2) await gp.screenshot({ path: `${M2}/lineage-sort-1180x820.png` });
  await gp.click('[data-act="linFilter"][data-v="off"]');
  check('1.0.0 차종 계보 필터(단종): 판매 중인 차종이 없음', await GG(() => [...document.querySelectorAll('.lineage-card')].every((x) => window.__car.game.state.nameplates.find((n) => n.id === Number(x.dataset.np)).generations.every((g) => g.status === 'discontinued'))));
  await gp.click('[data-act="linFilter"][data-v=""]');
  await tab5(gp, 'fin', 'rectab', 'hall');
  const hall = await GG(() => ({ n: document.querySelectorAll('.hall > .hall-grid > .hall-it').length, want: window.__car.Q.hallOfFame(window.__car.game.state).cars.length, t: document.querySelector('.hall')?.innerText ?? '' }));
  check('1.0.0 명예의 전당: 차 기록 카드(가장 많이 팔린 차·가장 비싼 차 등)와 회사 기록', hall.n === hall.want && hall.t.includes('가장 많이 팔린 차') && (await gp.locator('.hall-co').innerText()).includes('누적 판매'), `${hall.n}/${hall.want}`);
  if (M2) for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024]]) { await gp.setViewportSize({ width: w, height: h }); await gp.waitForTimeout(150); await gp.screenshot({ path: `${M2}/hall-${w}x${h}.png` }); }
  const hid = await gp.locator('.hall-it').first().getAttribute('data-v'); await gp.locator('.hall-it').first().click();
  check('1.0.0 명예의 전당 항목 누르기 → 그 차종 계보', (await gp.locator(`.lineage-card[data-np="${hid}"]`).count()) === 1 && (await gp.locator('[data-act="rectab"][data-v="cars"]').getAttribute('aria-selected')) === 'true');
  // 1.1.0 개발 중(설계 단계) [장비 다시 고르기] → setProjectEquip
  { await gclose(); await gp.setViewportSize({ width: 1180, height: 820 });
    const pid = await GG(() => { const c = window.__car, g = c.game, s = g.state; s.hqLevel = 5; for (const t of ['el_radio', 'el_aircon']) if (!s.research.done.includes(t)) s.research.done.push(t); const team = s.staff.filter((x) => x.projectId === null && x.role !== 'sales' && !x.lab).slice(0, 2).map((x) => x.id);
      if (!team.length) { const b = s.staff[0]; s.staff.push({ ...b, id: 9900, name: '장비', role: 'designer', projectId: null, trainings: [], restUntil: null, lab: false }); team.push(9900); }
      const r = g.command({ type: 'startProject', name: '장비시험', body: 'sedanS', segment: 'family', powertrain: 'gasoline', tier: 2, options: [], equip: {}, direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 20, team }); c.render(); return r.ok ? s.projects.at(-1).id : r.reason; });
    await GG((id) => { window.__car.goTarget({ tab: 'dev', id }); }, pid); await gp.waitForTimeout(300);
    await gp.locator(`[data-act="projEquip"][data-id="${pid}"]`).click();
    const k = await gp.locator('#sheet [data-act="eqSet"][data-t="proj"][data-v="std"][aria-pressed="false"]').first().getAttribute('data-k');
    await gp.click(`#sheet [data-act="eqSet"][data-t="proj"][data-k="${k}"][data-v="std"]`); await gp.click('#sheet [data-act="projEquipApply"]');
    check('1.1.0 개발 중(설계 단계) [장비 다시 고르기] → 프로젝트 장비가 바뀜', await GG(([id, k]) => window.__car.game.state.projects.find((p) => p.id === id)?.equip?.[k] === 'std', [pid, k]), `${pid} ${k}`); }
  await gctx.close(); }

// ---- 1.2.0 전기차 시대(2025년 상태를 직접 만듦): 배터리 용량 고르기, 배터리 공장, 전기차 상세 ----
{ const ectx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const ep = await ectx.newPage(); ep.on('pageerror', (e) => errors.push(String(e))); ep.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const EG = (fn, a) => ep.evaluate(fn, a), E3 = process.env.CAR_SMOKE_EV ?? '';
  const eshot = async (n, sel) => { if (!E3) return; if (sel) await ep.locator(sel).first().scrollIntoViewIfNeeded(); await ep.screenshot({ path: `${E3}/${n}.png` }); };
  const eact = async (a, extra = '') => { await ep.locator(`[data-act="${a}"]${extra}`).first().click(); };
  await ep.goto(URL0); await ep.waitForSelector('#title:not([hidden])');
  await ep.click('[data-act="titleNew"]'); await ep.fill('#t-co', '전기 시험'); await ep.click('[data-act="startNew"]'); await ep.click('#tabs button[data-tab="car"]'); await EG(() => window.__car.setSpeed(0));
  await EG(() => { const c = window.__car, s = c.game.state; s.week = (2025 - 1970) * 48; s.cash = 1e8; s.hqLevel = 5;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2025 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id); c.render(); });
  await eact('plan'); if ((await EG(() => window.__car.screen)) === 'start') await eact('pickNew');
  await eact('ptab', '[data-v="power"]');
  await ep.click('[data-act="pick"][data-k="powertrain"][data-v="ev"]');
  const evRead = () => EG(() => ({ cost: [...document.querySelectorAll('.plan-est .kpi')].find((k) => k.querySelector('small')?.innerText.includes('대당 원가'))?.querySelector('b')?.innerText ?? '', sum: document.querySelector('.ev-sum')?.innerText ?? '', n: document.querySelectorAll('.bat-opts .opt').length, std: document.querySelector('.bat-opts [data-v="std"]')?.getAttribute('aria-pressed') }));
  const e0 = await evRead();
  check('1.2.0 전기차 기획: 배터리 용량 3종(소형·표준·대형), 기본 표준, 주행 거리·충전·전용 플랫폼 줄', e0.n === 3 && e0.std === 'true' && /주행 거리 [\d,]+km/.test(e0.sum) && e0.sum.includes('충전') && e0.sum.includes('전용 플랫폼'), JSON.stringify(e0));
  await ep.click('.bat-opts [data-act="pick"][data-v="large"]');
  const e1 = await evRead(), km = (t) => Number((t.match(/주행 거리 ([\d,]+)km/)?.[1] ?? '0').replace(/,/g, ''));
  check('1.2.0 대형 배터리를 고르면 주행 거리가 늘고 대당 원가가 바뀜', km(e1.sum) > km(e0.sum) && e1.cost !== e0.cost && (await EG(() => window.__car.draft.battery)) === 'large', `${e0.cost}→${e1.cost} / ${km(e0.sum)}→${km(e1.sum)}`);
  await eshot('plan-battery-1366x1024', '.bat-opts');
  for (const [w, h] of [[1024, 768], [800, 1200]]) { await ep.setViewportSize({ width: w, height: h }); await ep.waitForTimeout(150);
    const cut = await EG(() => [...document.querySelectorAll('.bat-opts .opt, .ev-sum')].filter((x) => x.scrollWidth > x.clientWidth + 1).length + Math.max(0, document.documentElement.scrollWidth - innerWidth));
    check(`1.2.0 배터리 선택(${w}×${h}): 넘침 없음`, cut === 0, String(cut)); if (w === 800) await eshot('plan-battery-800x1200', '.bat-opts'); }
  await ep.setViewportSize({ width: 1366, height: 1024 });
  await eact('ptab', '[data-v="budget"]'); await eact('startDev');
  check('1.2.0 개발 시작: 프로젝트에 대형 배터리', (await EG(() => window.__car.game.state.projects.at(-1)?.battery)) === 'large', JSON.stringify(await EG(() => window.__car.game.state.projects.map((p) => [p.powertrain, p.battery]))));
  const evGen = await EG(() => { const c = window.__car, g = c.game, s = g.state, p = s.projects.at(-1); g.devCheat('finishDev'); const r = g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#c0392b', wheels: 1 }); c.render(); return r.ok ? s.nameplates.flatMap((n) => n.generations).at(-1).id : r.reason; });
  await EG((id) => window.__car.goTarget({ tab: 'garage', id }), evGen); await ep.waitForTimeout(200); await ep.locator('#sheet [data-act="closeReview"],#sheet [data-act="closeSheet"]').first().click({ timeout: 2000 }).catch(() => {});
  const evl = await ep.locator('.ev-line').first().innerText().catch(() => '');
  check('1.2.0 전기차 상세: 주행 거리·기대·대형 배터리·충전 시간·전용 플랫폼', /주행 거리 [\d,]+km/.test(evl) && evl.includes('대형 배터리') && evl.includes('충전') && evl.includes('전용 플랫폼'), evl);
  await eshot('ev-garage-1366x1024', '.ev-line');
  await EG(() => window.__car.goTarget({ tab: 'company', sub: 'factory' })); await ep.waitForTimeout(150);
  check('1.2.0 공장 화면: 배터리 공장 구역(없음, 건설 버튼)', (await ep.locator('.fac-bat').innerText()).includes('없음') && (await ep.locator('.fac-bat [data-act="buildBatteryPlant"]:not([disabled])').count()) === 1);
  await ep.click('.fac-bat [data-act="buildBatteryPlant"]'); await ep.waitForSelector('#ask:not([hidden])'); await ep.click('#ask-yes'); await ep.waitForTimeout(150);
  const bt = await ep.locator('.fac-bat').innerText();
  check('1.2.0 배터리 공장 건설 → 공사 중 표시(남은 개월), 건설 버튼 없음, 이유 상자 없음', (await EG(() => window.__car.game.state.batteryPlant.build?.level)) === 1 && bt.includes('개월 남았습니다') && bt.includes('공사 중') && (await ep.locator('.fac-bat [data-act="buildBatteryPlant"]:not([disabled])').count()) === 0 && (await ep.locator('.fac-bat .badbox').count()) === 0, bt.split('\n').slice(0, 4).join(' / '));
  await eshot('battery-plant-1366x1024', '.fac-bat');
  await ep.setViewportSize({ width: 800, height: 1200 }); await ep.waitForTimeout(150); await eshot('battery-plant-800x1200', '.fac-bat');
  check('1.2.0 배터리 공장(800×1200): 가로 넘침 없음', (await EG(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
  await ep.setViewportSize({ width: 1024, height: 768 }); await ep.click('#tabs button[data-tab="research"]'); await ep.waitForTimeout(150);
  const rc = await ep.locator('.r-charge').innerText().catch(() => '');
  check('1.2.0 연구 화면: 충전 속도 현재 단계(10→80% N분)', /10→80% \d+분/.test(rc), rc);
  const rOver = await EG(() => [...document.querySelectorAll('.tc')].filter((x) => x.getBoundingClientRect().right > innerWidth + 1 || x.scrollWidth > x.clientWidth + 1).length);
  check('1.2.0 연구 트리(1024×768): 기술 칸 넘침 없음', rOver === 0, String(rOver));
  await eshot('research-1024x768', '[data-field="eco"]');
  await ectx.close(); }

// ---- 1.3.0 차 만들기: 출시 화면 유지·시승기, 파생 모델, 세대교체 위임, 알림 유형 ----
// CAR_SMOKE_130=폴더 를 주면 화면을 그 폴더에 찍는다
{ const mctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const mp = await mctx.newPage(); mp.on('pageerror', (e) => errors.push(String(e))); mp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const MG = (fn, a) => mp.evaluate(fn, a), M3 = process.env.CAR_SMOKE_130 ?? '';
  const mshot3 = async (n) => { if (M3) await mp.screenshot({ path: `${M3}/${n}.png` }); };
  const mact = async (a, extra = '') => { await mp.locator(`[data-act="${a}"]${extra}`).first().click(); };
  await mp.goto(URL0); await mp.waitForSelector('#title:not([hidden])');
  await mp.click('[data-act="titleNew"]'); await mp.fill('#t-co', '파생 시험'); await mp.click('[data-act="startNew"]'); await mp.click('#tabs button[data-tab="car"]'); await MG(() => window.__car.setSpeed(0));
  await MG(() => { const c = window.__car, s = c.game.state; s.week = (2025 - 1970) * 48; s.cash = 1e8; s.hqLevel = 5;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2025 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id); c.render(); });
  await mact('plan'); if ((await MG(() => window.__car.screen)) === 'start') await mact('pickNew');
  await mp.fill('#pname', '아리아'); await mact('ptab', '[data-v="seg"]'); await mact('pick', '[data-k="segment"][data-v="family"]'); await mact('ptab', '[data-v="budget"]'); await mact('startDev');
  // (c)(e) 출시 화면: 공개 장면과 평론 창은 닫기 전까지 떠 있고 시간도 멈춤, 평론가 4명 시승기
  const pid = await MG(() => { const c = window.__car; c.game.devCheat('finishDev'); return c.game.state.projects.at(-1).id; });
  await MG((id) => window.__car.goTarget({ tab: 'dev', sub: 'launch', id }), pid);
  await MG(() => { localStorage.setItem('car-company-reveal', '1'); window.__car.setSpeed(1); });
  await mact('doLaunch'); if (await mp.locator('#ask').isVisible()) await mp.click('#ask-yes');
  await mp.waitForSelector('#sheet .rvl'); const wk0 = await MG(() => window.__car.game.state.week);
  await mp.waitForTimeout(10000);
  check('1.3.0 출시 공개 장면: 10초 뒤에도 열려 있음(저절로 넘어가지 않음), 시간 멈춤', (await mp.locator('#sheet .rvl').isVisible()) && (await MG(() => window.__car.game.state.week)) === wk0, await mp.locator('#sheet .rvl').getAttribute('data-phase'));
  await mp.click('#sheet .rvl-skip'); await mp.waitForSelector('#sheet .critic');
  await mp.waitForTimeout(10000);
  const crit = await MG(() => [...document.querySelectorAll('#sheet .critic')].map((x) => ({ who: x.querySelector('em')?.innerText ?? '', t: x.querySelector('.crit-t')?.innerText ?? '' })));
  check('1.3.0 평론 창: 10초 뒤에도 열려 있음, 시간 멈춤', (await mp.locator('#sheet:not([hidden]) .critic').count()) === 4 && (await MG(() => window.__car.game.state.week)) === wk0);
  check('1.3.0 시승기: 평론가 4명의 이름·매체·글', crit.length === 4 && crit.every((x) => x.who.includes('·') && x.t.length > 15) && crit.some((x) => x.who.includes('월간 모터라인')), JSON.stringify(crit.map((x) => x.who)));
  await mshot3('review-critiques-1366x1024');
  await mp.locator('#sheet [data-act="closeReview"]').click();
  check('1.3.0 평론 창 [닫기]로 닫힘', await mp.locator('#sheet').isHidden());
  await MG(() => { localStorage.setItem('car-company-reveal', '0'); window.__car.setSpeed(0); });
  const gid = await MG(() => window.__car.game.state.nameplates[0].generations[0].id);
  check('1.3.0 차고 상세: 평론가 시승기 접힘 칸', (await mp.locator('.fold[data-fold="crit"]').count()) === 1);
  // (a) 파생 모델: 4종 카드 → 이름 바꿔 개발 시작 → 출시하면 차고에서 바탕 차 아래
  await mact('goDerive', `[data-id="${gid}"]`);
  const cards = await MG(() => [...document.querySelectorAll('.dv')].map((x) => ({ v: x.dataset.v, ok: !x.disabled, t: x.innerText })));
  check('1.3.0 파생 모델 4종 카드(특색·개발비·기간·고객층 또는 불가 이유)', cards.length === 4 && cards.map((x) => x.v).join() === 'wagon,coupe,gt,ev' && cards.every((x) => x.ok ? /개발비 약 .+ · \d+주~ · 고객층/.test(x.t) : x.t.length > 20), JSON.stringify(cards.map((x) => [x.v, x.ok])));
  await mshot3('derive-pick-1366x1024');
  await mact('dvPick', '[data-v="wagon"]');
  check('1.3.0 파생 고르기: 이름 칸에 기본 제안, 팀 자동 배치', (await mp.inputValue('#dname')) === '아리아 왜건' && (await MG(() => window.__car.game.state.staff.length)) > 0 && (await mp.locator('.team-pick [data-act="dvTeam"][aria-pressed="true"]').count()) > 0);
  await mp.fill('#dname', '아리아 투어러');
  check('1.3.0 이름을 바꾸면 무대 글자도 바뀜', (await mp.locator('#dname-ov').innerText()) === '아리아 투어러');
  await mshot3('derive-wagon-1366x1024');
  await mact('dvStart');
  const dp = await MG(() => { const p = window.__car.game.state.projects.at(-1); return p && { kind: p.kind, name: p.name, variant: p.variant, scr: window.__car.screen }; });
  check('1.3.0 파생 개발 시작: 바꾼 이름·왜건·개발 화면', dp?.kind === 'derivative' && dp.name === '아리아 투어러' && dp.variant === 'wagon' && dp.scr === 'dev', JSON.stringify(dp));
  check('1.3.0 개발 화면: 파생 모델 개발 중 표시', (await mp.locator('#ov').innerText()).includes('파생 모델 개발 중'));
  await MG(() => { const c = window.__car, g = c.game, s = g.state, p = s.projects.at(-1); p.wins = [{ week: s.week, staffId: s.staff[0].id, name: s.staff[0].name, role: s.staff[0].role, kind: 'cost', value: 0.01, text: `${s.staff[0].name}이 부품을 바꿔 원가를 1% 줄였습니다.` }]; c.render(); }); // 직원 성과 표시 점검용(드물게 생기므로 직접 넣음)
  check('1.3.0 개발 화면: 직원 성과 목록', (await mp.locator('#panel .wins-list li').count()) === 1);
  await MG(() => { const c = window.__car, g = c.game, s = g.state, p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); c.render(); });
  await carTable(mp); await mp.waitForTimeout(200);
  const rows = await MG(() => [...document.querySelectorAll('.gtable .gtr-w:not(.head)')].map((x) => ({ d: x.classList.contains('deriv'), t: x.querySelector('.g-name')?.innerText ?? '' })));
  check('1.3.0 차고 표: 파생 차는 바탕 차 바로 아래 들여 씀', rows.length === 2 && !rows[0].d && rows[0].t.includes('아리아') && rows[1].d && rows[1].t.includes('아리아 투어러') && rows[1].t.includes('왜건'), JSON.stringify(rows));
  await mshot3('garage-derive-1366x1024');
  await tab5(mp, 'fin', 'sec', 'records');
  check('1.3.0 기록 탭: 파생 차종 계보가 바탕 아래, 시승기 펼침', (await mp.locator('.lineage-card.deriv').innerText()).includes('아리아」의 파생 모델') && (await mp.locator('.rec-crit').count()) >= 2);
  // 파생 4종 3D 외관(바탕 차와 나란히)
  if (M3) { await MG((id) => { const c = window.__car, s = c.game.state, g = c.Q.generationById(s, id), O = c.Q.derivativeOptions(s, id), st = c.stage; const base = c.genLook(id);
      const box = document.createElement('div'); box.id = 'vcmp'; box.style.cssText = 'position:fixed;inset:0;z-index:99;background:#eef1f4;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:12px;font:700 16px sans-serif';
      const cell = (look, t) => `<div style="background:#fff;border-radius:12px;padding:6px;text-align:center"><img src="${st.renderThumb(look, 420, 260, -0.65)}" style="width:100%"><div>${t}</div></div>`;
      box.innerHTML = cell(base, '바탕: 아리아(세단)') + O.map((o) => cell({ ...base, ...(o.id === 'coupe' ? { bodyId: 'coupe' } : {}), ...(o.id === 'gt' ? { variant: 'gt', sporty: true, wheel: 2 } : {}), ...(o.id === 'wagon' ? { variant: 'wagon' } : {}), ...(o.id === 'ev' ? { powertrain: 'ev', variant: 'ev' } : {}) }, o.name)).join('') + cell(c.genLook(c.game.state.nameplates.at(-1).generations[0].id), '출시한 「아리아 투어러」(왜건)'); document.body.append(box); void g; }, gid);
    await mshot3('derive-4-looks'); await MG(() => document.getElementById('vcmp').remove()); }
  // (b) 세대교체 위임: 기획 임원이 없으면 이유, 임명하면 켜고 끔
  await MG(() => window.__car.goTarget({ tab: 'company', sub: 'exec' })); await mp.waitForTimeout(150);
  check('1.3.0 위임: 기획 임원이 없으면 이유', (await mp.locator('.exec-card[data-role="product"] .ga-why').innerText()).includes('기획 임원이 없습니다') && (await mp.locator('.exec-card[data-role="product"] [data-act="genAuto"]:not([disabled])').count()) === 0);
  await MG(() => { const c = window.__car, s = c.game.state, x = s.staff.find((y) => y.role === 'designer'); x.ability = x.potential = 90; c.game.command({ type: 'appointExec', role: 'product', staffId: x.id }); c.render(); });
  const npA = await MG(() => window.__car.game.state.nameplates[0].id);
  await mp.click(`.exec-card[data-role="product"] [data-act="genAuto"][data-np="${npA}"]`);
  const on1 = await MG((id) => window.__car.game.state.execs?.genAuto?.[id] ?? null, npA);
  check('1.3.0 위임 켜짐(출시까지 위임이 기본)', on1?.launch === true && (await mp.locator(`.exec-card[data-role="product"] [data-act="genAuto"][data-np="${npA}"]`).getAttribute('aria-pressed')) === 'true', JSON.stringify(on1));
  await mp.click(`.exec-card[data-role="product"] [data-act="genAutoLaunch"][data-np="${npA}"]`);
  check('1.3.0 위임: 출시는 직접으로 바꿈', (await MG((id) => window.__car.game.state.execs.genAuto[id].launch, npA)) === false);
  await mp.click('.exec-card[data-role="product"] [data-act="genAutoAll"][data-v="1"]');
  check('1.3.0 위임: 모두 켜기', (await MG(() => Object.keys(window.__car.game.state.execs.genAuto).length)) === 2);
  await mp.locator('.exec-card[data-role="product"] .ga-sec').scrollIntoViewIfNeeded(); await mshot3('exec-genauto-1366x1024');
  await mp.click(`.exec-card[data-role="product"] [data-act="genAuto"][data-np="${npA}"]`);
  check('1.3.0 위임 꺼짐', (await MG((id) => window.__car.game.state.execs.genAuto[id] ?? null, npA)) === null);
  await MG((id) => window.__car.goTarget({ tab: 'garage', id }), gid);
  check('1.3.0 차고 상세: 위임 토글', (await mp.locator('.ga-one [data-act="genAuto"]').count()) === 1);
  // 위임한 차의 자동 출시: 공개 장면으로 게임을 끊지 않고 알림만, 알림을 누르면 시승기
  await mp.click(`.ga-one [data-act="genAuto"][data-np="${npA}"]`);
  const auto = await MG((id) => { const c = window.__car, s = c.game.state, g = s.nameplates.find((n) => n.id === id).generations[0]; g.launchMonth -= 60; g.lifeMonth -= 60; s.cash = 1e9;
    if (!s.staff.some((x) => x.role === 'designer')) s.staff.push({ id: s.nextId++, name: '보충 디자이너', role: 'designer', ability: 60, potential: 70, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }); // 1.6.1: 위임은 디자이너가 없는 팀으로 시작하지 않는다(유일한 디자이너를 기획 임원으로 올렸다)
    for (let i = 0; i < 160 && s.nameplates.find((n) => n.id === id).generations.length < 2; i++) c.tick(1);
    return { gens: s.nameplates.find((n) => n.id === id).generations.length, sheet: !document.getElementById('sheet').hidden, rvl: !!document.querySelector('#sheet .rvl'), screen: c.screen }; }, npA);
  await menuItem(mp, '#todobtn'); await mp.click('#drawer [data-act="todoTab"][data-v="notes"]'); // 알림은 12초 뒤 닫히므로(느린 렌더) 알림 기록에서 누른다
  const autoNote = await mp.locator('#drawer .note-it', { hasText: '기획 임원이 출시했습니다' }).count();
  check('1.3.0 위임한 차 자동 출시: 공개 장면·창 없이 알림만', auto.gens === 2 && !auto.sheet && !auto.rvl && autoNote >= 1, JSON.stringify({ ...auto, autoNote }));
  if (autoNote) { await mp.locator('#drawer .note-it', { hasText: '기획 임원이 출시했습니다' }).first().click(); await mp.waitForSelector('#sheet .critic', { timeout: 5000 }).catch(() => {});
    check('1.3.0 자동 출시 알림을 누르면 평론 창(시승기)', (await mp.locator('#sheet .crit-t').count()) === 4);
    await mp.locator('#sheet [data-act="closeReview"]').click().catch(() => {}); }
  // (d) 알림 유형: 교육 알림을 끄면 교육 보내기 알림이 뜨지 않고 기록에는 남음, 경고는 못 끔
  await openSave(mp); await mp.click('#sheet [data-act="settings"]'); await mp.click('#sheet [data-act="setTab"][data-v="note"]');
  check('1.3.0 알림 설정: 유형 14종(2.0.0 경쟁사 신차, 3.0.0 자회사, 3.7.0 자동 승인, 4.0.0 세계 시장 포함), 경고는 끌 수 없음', (await mp.locator('#sheet .note-topics [data-act="noteCat"]').count()) === 14 && (await mp.locator('#sheet [data-act="noteCat"][data-v="world"]').count()) === 1 && (await mp.locator('#sheet [data-act="noteCat"][data-v="sub"]').count()) === 1 && (await mp.locator('#sheet [data-act="noteCat"][data-v="rival"]').count()) === 1 && (await mp.locator('#sheet [data-act="noteCat"][data-v="warning"]').isDisabled()));
  await mp.click('#sheet [data-act="noteCat"][data-v="training"]');
  check('1.3.0 교육 알림 끄기 → 기기 저장소', (await MG(() => JSON.parse(localStorage.getItem('car-company-notify')).training)) === false);
  await mshot3('settings-notify-1366x1024');
  await mp.click('#sheet [data-act="closeSheet"]');
  await MG(() => { document.getElementById('toasts').innerHTML = ''; window.__car.goTarget({ tab: 'company', sub: 'staff' }); });
  const sid = await MG(() => { const c = window.__car, s = c.game.state; s.cash = 1e9; const x = c.Q.staffInfo(s).find((y) => y.canTrain); return x?.id ?? -1; });
  await mp.click(`[data-act="staffSel"][data-id="${sid}"]`); await mp.click(`[data-act="train"][data-id="${sid}"]`); await mp.waitForTimeout(200);
  check('1.3.0 교육 알림을 끄면 교육 보내기 알림이 뜨지 않음', (await MG((id) => window.__car.game.state.staff.find((x) => x.id === id).trainings.length, sid)) > 0 && (await mp.locator('#toasts .toast:not(.out)', { hasText: '교육' }).count()) === 0);
  await menuItem(mp, '#todobtn'); await mp.click('#drawer [data-act="todoTab"][data-v="notes"]');
  check('1.3.0 알림 기록에는 남고 유형 칩·[알림 설정]', (await mp.locator('#drawer .note-list').innerText()).includes('교육을 보냈습니다') && (await mp.locator('#drawer [data-act="noteTopic"][data-v="training"]').count()) === 1 && (await mp.locator('#drawer [data-act="noteSettings"]').count()) === 1);
  await mp.click('#drawer [data-act="noteTopic"][data-v="training"]');
  check('1.3.0 알림 기록 유형 거르기', (await mp.locator('#drawer .note-it').count()) >= 1 && (await mp.locator('#drawer .note-it .chip').allInnerTexts()).every((t) => t === '직원 교육·휴식'));
  await mp.click('#drawer [data-act="drawerClose"]');
  // 태블릿 세로(800×1200)·가로(1024×768): 넘침 없음
  for (const [w, h] of [[1024, 768], [800, 1200]]) {
    await mp.setViewportSize({ width: w, height: h }); await MG(() => { document.getElementById('toasts').innerHTML = ''; window.__car.goTarget({ tab: 'garage' }); }); await mp.waitForTimeout(150);
    const o1 = await overflowOf(mp); if (w === 800) await mshot3('garage-800x1200');
    const gl = await MG(() => window.__car.game.state.nameplates[0].generations.at(-1).id); await MG((id) => window.__car.goTarget({ tab: 'garage', id }), gl);
    await mact('goDerive', `[data-id="${gl}"]`); await mact('dvPick', '[data-v="coupe"]'); await mp.waitForTimeout(200);
    const o2 = await overflowOf(mp), dsc = await MG(() => window.__car.screen); if (w === 800) await mshot3('derive-800x1200');
    check(`1.3.0 ${w}×${h}: 파생 고르기 화면`, dsc === 'derive', dsc);
    await mact('dvCancel').catch(() => {}); await MG(() => window.__car.goTarget({ tab: 'company', sub: 'exec' })); await mp.waitForTimeout(150);
    const o3 = await overflowOf(mp); if (w === 800) { await mp.locator('.exec-card[data-role="product"] .ga-sec').scrollIntoViewIfNeeded(); await mshot3('exec-genauto-800x1200'); }
    check(`1.3.0 ${w}×${h}: 차고 표·파생 고르기·임원 위임 넘침 없음`, o1 <= 0 && o2 <= 0 && o3 <= 0, `${o1}/${o2}/${o3}`);
  }
  // 1.4.0 용어 '위임': 차고(표·상세)·임원 화면(기획 임원 카드 포함)·설정의 글자에 "맡기기"·"맡김"이 없다
  { const OLD = /맡기기|맡김/, bad = [], gl = await MG(() => window.__car.game.state.nameplates[0].generations.at(-1).id);
    for (const t of [{ tab: 'garage' }, { tab: 'garage', id: gl }, { tab: 'company', sub: 'exec' }]) { await MG((x) => window.__car.goTarget(x), t); await mp.waitForTimeout(150); if (OLD.test(await MG(() => document.body.innerText))) bad.push(JSON.stringify(t)); }
    const prod = await mp.locator('.exec-card[data-role="product"]').innerText();
    if (!prod.includes('세대교체 위임')) bad.push('기획 임원 카드에 세대교체 위임 없음');
    await openSave(mp); await mp.click('#sheet [data-act="settings"]');
    for (const v of await mp.locator('#sheet [data-act="setTab"]').evaluateAll((l) => l.map((b) => b.dataset.v))) { await mp.click(`#sheet [data-act="setTab"][data-v="${v}"]`); if (OLD.test(await mp.locator('#sheet').innerText())) bad.push(`설정 ${v}`); }
    await mp.click('#sheet [data-act="closeSheet"]');
    check('1.4.0 용어: 차고·임원 화면·기획 임원 카드·설정에 "맡기기"·"맡김" 없음', bad.length === 0, bad.join(', ')); }
  await mctx.close(); }

// ---- 1.4.0 인사 임원 자동 채용·자동 해고(위임) ----
{ const hctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const hp = await hctx.newPage(); hp.on('pageerror', (e) => errors.push(String(e))); hp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const HG = (fn, a) => hp.evaluate(fn, a), H4 = process.env.CAR_SMOKE_140 ?? '';
  const hrCard = hp.locator('.exec-card[data-role="hr"]');
  const hshot = async (n) => { if (H4) { await hrCard.scrollIntoViewIfNeeded(); await hp.screenshot({ path: `${H4}/${n}.png` }); } };
  const pressed = async (k) => (await hrCard.locator(`[data-act="execDeleg"][data-k="${k}"]`).getAttribute('aria-pressed')) === 'true';
  const dels = () => HG(() => window.__car.game.state.execs.delegations.hr ?? []);
  await hp.goto(URL0); await hp.waitForSelector('#title:not([hidden])');
  await hp.click('[data-act="titleNew"]'); await hp.fill('#t-co', '인사 시험'); await hp.click('[data-act="startNew"]'); await hp.click('#tabs button[data-tab="car"]'); await HG(() => window.__car.setSpeed(0));
  await HG(() => { const c = window.__car, g = c.game, s = g.state; s.cash = 1e8; g.command({ type: 'postExecJob', role: 'hr' }); g.command({ type: 'hireExec', role: 'hr', candidateId: s.execs.candidates[0].id });
    const x = s.execs.seats.hr.staff; x.ability = x.potential = 90; for (const y of s.staff) y.ability = 20; c.goTarget({ tab: 'company', sub: 'exec' }); });
  await hp.waitForTimeout(150);
  check('1.4.0 인사 임원 위임 목록: 자동 채용·자동 해고(기본 꺼짐, 한 줄 설명, 해고는 되돌릴 수 없다는 안내)', !(await pressed('autoHire')) && !(await pressed('autoFire')) && (await hrCard.locator('.deleg[data-k="autoHire"] small').count()) === 1
    && (await hrCard.locator('.deleg[data-k="autoFire"] .deleg-warn').innerText()).includes('되돌릴 수 없습니다'));
  for (const k of ['autoHire', 'autoFire']) await hrCard.locator(`[data-act="execDeleg"][data-k="${k}"]`).click();
  check('1.4.0 두 항목 켬: 스위치·상태 반영', (await pressed('autoHire')) && (await pressed('autoFire')) && (await dels()).includes('autoHire') && (await dels()).includes('autoFire'));
  await hshot('hr-card-1366x1024');
  await hrCard.locator('[data-act="execDeleg"][data-k="autoFire"]').click();
  check('1.4.0 자동 해고 끔', !(await pressed('autoFire')) && !(await dels()).includes('autoFire'));
  const n0 = await HG(() => window.__car.game.state.staff.length);
  await HG(() => window.__car.tick(4));
  const hired = await HG(() => { const s = window.__car.game.state, r = s.execs.reports.find((x) => x.kind === 'autoHire'); return r ? { n: s.staff.length, name: s.staff.find((x) => x.id === r.goto.id)?.name } : null; });
  check('1.4.0 자동 채용: 월 결산에 한 명을 뽑고 보고', !!hired && hired.n === n0 + 1 && !!hired.name, JSON.stringify(hired));
  await menuItem(hp, '#todobtn'); await hp.click('[data-act="todoTab"][data-v="reports"]');
  const card = hp.locator('.rep-card', { hasText: '뽑았습니다' }).first(), ct = await card.innerText();
  check('1.4.0 보고함: 자동 채용 보고(위임한 일 기록, 기준)', ct.includes('위임한 일 기록') && ct.includes(hired?.name ?? '?') && ct.includes('기준'), ct.slice(0, 200));
  await card.locator('[data-act="repGo"]').click(); await hp.waitForTimeout(200);
  check('1.4.0 보고 → 해당 화면으로: 직원 화면에 새 직원', (await HG(() => window.__car.screen)) !== 'title' && (await hp.locator('#panel').innerText()).includes(hired?.name ?? '?'));
  await HG(() => window.__car.goTarget({ tab: 'company', sub: 'exec' })); await hp.waitForTimeout(150);
  check('1.4.0 임원 화면에 "맡기기"·"맡김" 없음', !/맡기기|맡김/.test(await HG(() => document.body.innerText)));
  for (const [w, h] of [[1024, 768], [800, 1200]]) {
    await hp.setViewportSize({ width: w, height: h }); await HG(() => { document.getElementById('toasts').innerHTML = ''; window.__car.goTarget({ tab: 'company', sub: 'exec' }); }); await hp.waitForTimeout(150);
    const o = await overflowOf(hp); if (w === 800) await hshot('hr-card-800x1200');
    check(`1.4.0 ${w}×${h}: 인사 임원 카드 넘침 없음`, o <= 0, String(o));
  }
  await hctx.close(); }

// ---- 1.5.0 출시 뒤 이름 바꾸기: 차고 상세 [이름 변경] → 새 이름이 차고·기록 탭에, 파생 이름도 함께, 800×1200 넘침 없음 ----
// CAR_SMOKE_150=폴더 를 주면 화면을 그 폴더에 찍는다
{ const rctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const rp = await rctx.newPage(); rp.on('pageerror', (e) => errors.push(String(e))); rp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const RG = (fn, a) => rp.evaluate(fn, a), R5 = process.env.CAR_SMOKE_150 ?? '';
  const rshot = async (n) => { if (R5) await rp.screenshot({ path: `${R5}/${n}.png` }); };
  await rp.goto(URL0); await rp.waitForSelector('#title:not([hidden])');
  await rp.click('[data-act="titleNew"]'); await rp.fill('#t-co', '이름 시험'); await rp.click('[data-act="startNew"]'); await rp.click('#tabs button[data-tab="car"]'); await RG(() => window.__car.setSpeed(0));
  const gid = await RG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2025 - 1970) * 48; s.cash = 1e8; s.hqLevel = 5;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2025 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    const go = (cmd) => { g.command(cmd); const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); };
    go({ type: 'startProject', name: '아리아', body: 'sedanM', segment: 'family', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const base = s.nameplates[0].generations[0].id; go({ type: 'startDerivative', generationId: base, variant: 'wagon' }); c.render(); return base; });
  await RG((id) => window.__car.goTarget({ tab: 'garage', id }), gid); await rp.waitForTimeout(150);
  check('1.5.0 차고 상세: 이름 옆 [이름 변경]', (await rp.locator('.ov.tl .model [data-act="renameOpen"]').count()) === 1);
  await rp.click('.ov.tl [data-act="renameOpen"]');
  check('1.5.0 이름 변경 창: 지금 이름이 든 입력칸, 파생 이름 함께 바꾸기(기본 켬)', (await rp.inputValue('#rn-name')) === '아리아' && (await rp.locator('#rn-kids').isChecked()) && (await rp.locator('#sheet .rename-sheet').innerText()).includes('아리아 왜건'));
  await rp.fill('#rn-name', ''); await rp.click('[data-act="renameDo"]');
  check('1.5.0 빈 이름은 거절(이름 그대로)', (await RG(() => window.__car.game.state.nameplates[0].name)) === '아리아');
  await rp.fill('#rn-name', '세레나'); await rshot('rename-sheet-1366x1024'); await rp.click('[data-act="renameDo"]'); await rp.waitForTimeout(150);
  const names = await RG(() => window.__car.game.state.nameplates.map((n) => n.name));
  check('1.5.0 이름 바꾸기: 바탕·파생 이름이 바뀜, 창 닫힘', names.join() === '세레나,세레나 왜건' && (await rp.locator('#sheet').isHidden()), names.join());
  check('1.5.0 차고 상세 무대에 새 이름', (await rp.locator('.ov.tl .model').innerText()).includes('세레나'));
  await rshot('garage-renamed-1366x1024');
  await RG(() => window.__car.goTarget({ tab: 'garage' })); await carTable(rp); await rp.waitForTimeout(150);
  const gt = await RG(() => [...document.querySelectorAll('.gtable .gtr-w:not(.head) .g-name')].map((x) => x.innerText).join('|'));
  check('1.5.0 차고 표에 새 이름', gt.includes('세레나') && gt.includes('세레나 왜건') && !/아리아/.test(gt), gt);
  await tab5(rp, 'fin', 'sec', 'records'); await rp.waitForTimeout(150);
  const rec = await rp.locator('.lineage-card').allInnerTexts();
  check('1.5.0 기록 탭 계보에 새 이름(파생은 바탕 아래 그대로)', rec.some((t) => t.includes('세레나')) && (await rp.locator('.lineage-card.deriv').innerText()).includes('세레나」의 파생 모델'), rec.map((t) => t.split('\n')[1]).join('|'));
  for (const [w, h] of [[800, 1200]]) {
    await rp.setViewportSize({ width: w, height: h }); await RG((id) => { document.getElementById('toasts').innerHTML = ''; window.__car.goTarget({ tab: 'garage', id }); }, gid); await rp.waitForTimeout(150);
    const o1 = await overflowOf(rp); await rshot('garage-renamed-800x1200');
    await rp.click('.ov.tl [data-act="renameOpen"]'); await rp.waitForTimeout(100);
    const o2 = await overflowOf(rp); await rshot('rename-sheet-800x1200'); await rp.click('#sheet [data-act="closeSheet"]');
    check(`1.5.0 ${w}×${h}: 차고 상세·이름 변경 창 넘침 없음`, o1 <= 0 && o2 <= 0, `${o1}/${o2}`);
  }
  await rctx.close(); }

// ---- 1.5.0 새 게임 선택지·통계·지난 판의 차 이름: 첫 판에서 차를 내고 자동 저장 → 새 판(2000년·넉넉한 자금·대출 없이)에서 [지난 이름]으로 이름 채움, 바로 기획·개발,
// 기록 탭 통계 그래프·도전 과제 표시·지난 판의 차, 세 화면 크기 넘침 없음. CAR_SMOKE_150=폴더 를 주면 화면을 그 폴더에 찍는다
{ const nctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const np = await nctx.newPage(); np.on('pageerror', (e) => errors.push(String(e))); np.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const NG = (fn, a) => np.evaluate(fn, a), N5 = process.env.CAR_SMOKE_150 ?? '';
  const nshot = async (n) => { if (N5) await np.screenshot({ path: `${N5}/${n}.png` }); };
  const ovAll = () => NG(() => { const p = document.getElementById('panel'), t = document.getElementById('title'); return Math.max(document.documentElement.scrollWidth - innerWidth, p ? p.scrollWidth - p.clientWidth : 0, t && !t.hidden ? t.scrollWidth - t.clientWidth : 0); });
  const quickCar = (name) => NG((nm) => { const c = window.__car, g = c.game, s = g.state;
    g.command({ type: 'startProject', name: nm, body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); g.devCheat('finishDev'); return g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }).ok; }, name);
  await np.goto(URL0); await np.waitForSelector('#title:not([hidden])');
  await np.click('[data-act="titleNew"]'); await np.fill('#t-co', '지난판 모터스'); await np.click('[data-act="startNew"]'); await np.click('#tabs button[data-tab="car"]'); await NG(() => window.__car.setSpeed(0));
  check('1.5.0 첫 판(기본 선택): start 없음, 1970년', await NG(() => { const s = window.__car.game.state; return s.start === undefined && s.week === 0; }));
  const launchedOk = await quickCar('누리'); await NG(() => window.__car.tick(4)); await np.waitForTimeout(1500);
  const past = await NG(() => JSON.parse(localStorage.getItem('car-company-past-names') ?? '[]'));
  check('1.5.0 자동 저장 때 이 기기에 지난 판의 차 이름 기록', launchedOk && past.length === 1 && past[0].company === '지난판 모터스' && past[0].cars[0]?.name === '누리', JSON.stringify(past).slice(0, 160));
  await np.goto(URL0); await np.waitForSelector('#title:not([hidden])');
  await np.click('[data-act="titleNew"]'); await np.fill('#t-co', '통계 시험');
  check('1.5.0 새 게임: 시작 연도 4개(기본 1970)·시작 조건 3개(기본 보통)·도전 과제 4개(기본 없음)', (await np.locator('[data-act="nsYear"]').count()) === 4 && (await np.locator('[data-act="nsYear"][data-v="1970"]').getAttribute('aria-pressed')) === 'true'
    && (await np.locator('[data-act="nsCond"]').count()) === 3 && (await np.locator('[data-act="nsCond"][data-v="normal"]').getAttribute('aria-pressed')) === 'true' && (await np.locator('input[data-ch]').count()) === 4 && (await np.locator('input[data-ch]:checked').count()) === 0);
  await np.click('.ns-chal summary');
  check('1.5.0 전기차만: 1970년 시작에서는 고를 수 없음', await np.locator('input[data-ch="evOnly"]').isDisabled());
  await np.click('[data-act="nsYear"][data-v="2015"]'); await np.check('input[data-ch="evOnly"]');
  await np.click('[data-act="nsYear"][data-v="2000"]'); await np.click('[data-act="nsCond"][data-v="rich"]'); await np.check('input[data-ch="noLoan"]');
  check('1.5.0 연도를 2000년으로 바꾸면 전기차만은 풀리고 막힘, 이름은 그대로, 한 줄 안내가 바뀜', (await np.locator('input[data-ch="evOnly"]').isDisabled()) && !(await np.locator('input[data-ch="evOnly"]').isChecked()) && (await np.inputValue('#t-co')) === '통계 시험' && (await np.locator('#ns-line').innerText()).includes('2000년 1월'));
  for (const [w, h] of [[1366, 1024], [1024, 768], [800, 1200]]) {
    await np.setViewportSize({ width: w, height: h }); await np.waitForTimeout(150);
    const o = await ovAll(), vis = await NG(() => { const r = document.querySelector('[data-act="startNew"]').getBoundingClientRect(); return r.bottom <= innerHeight; });
    if (w !== 1366) await nshot(`new-game-${w}x${h}`);
    check(`1.5.0 새 게임 ${w}×${h}: 가로 넘침 없음${w === 1024 ? ', [회사 세우기]가 스크롤 없이' : ''}`, o <= 0 && (w !== 1024 || vis), String(o));
  }
  await np.setViewportSize({ width: 1366, height: 1024 });
  await np.click('[data-act="startNew"]'); await np.click('#tabs button[data-tab="car"]'); await NG(() => window.__car.setSpeed(0));
  const st = await NG(() => { const s = window.__car.game.state; return { start: s.start, year: window.__car.Q.dateOf(s.week).year, block: window.__car.Q.regulationBlock(s) }; });
  check('1.5.0 2000년·넉넉한 자금·대출 없이로 시작(저장되는 상태에 선택 포함), 규제 막힘 없음', st.year === 2000 && st.start?.condition === 'rich' && st.start?.challenges.join() === 'noLoan' && st.block === null, JSON.stringify(st));
  await devHome(np); await np.locator('[data-act="plan"]').first().click(); await np.waitForTimeout(150);
  if ((await NG(() => window.__car.screen)) === 'start') await np.locator('[data-act="pickNew"]').first().click();
  if ((await NG(() => window.__car.planTab)) === 'sum') await np.locator('[data-act="ptab"][data-v="body"]').first().click();
  await np.locator('[data-act="pastOpen"][data-v="pname"]').click(); await np.waitForTimeout(100);
  const pick = await np.locator('#pick').innerText();
  check('1.5.0 [지난 이름]: 지난 판 목록(회사·이름·차체)', (await np.locator('#pick').isVisible()) && pick.includes('지난판 모터스') && pick.includes('누리') && pick.includes('소형 세단'), pick.slice(0, 120));
  await nshot('past-pick-1366x1024');
  await np.click('[data-act="pastSort"][data-v="sold"]');
  check('1.5.0 [지난 이름]: 많이 팔린 순으로 바꿔도 목록', (await np.locator('#pick [data-act="pastSort"][data-v="sold"]').getAttribute('aria-pressed')) === 'true' && (await np.locator('#pick .past-it').count()) >= 1);
  await np.locator('#pick .past-it', { hasText: '누리' }).first().click();
  check('1.5.0 지난 이름을 누르면 입력칸에 채워지고 창이 닫힘', (await np.inputValue('#pname')) === '누리' && (await np.locator('#pick').isHidden()) && (await NG(() => window.__car.draft?.name)) === '누리');
  await np.locator('[data-act="ptab"][data-v="budget"]').first().click(); await np.locator('[data-act="startDev"]').first().click(); await np.waitForTimeout(150);
  check('1.5.0 2000년 시작: 바로 기획해 개발 시작(이름 누리)', await NG(() => { const p = window.__car.game.state.projects; return p.length === 1 && p[0].name === '누리'; }));
  await NG(() => { const c = window.__car, g = c.game, s = g.state, p = s.projects[0]; for (let i = 0; i < 120 && !p.waiting && (p.phase === 'design' || p.testWeeks < 30); i++) c.tick(1); // 실제로 개발(판매가 쌓이게)
    g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); });
  await NG(() => { document.getElementById('sheet').hidden = true; window.__car.tick(4 * 48 - window.__car.game.state.week % 48); document.getElementById('sheet').hidden = true; document.getElementById('toasts').innerHTML = ''; });
  check('1.5.0 대출 없이: 대출 명령 거절(도전 과제 안내)', await NG(() => { const r = window.__car.game.command({ type: 'borrow', amount: 1000 }); return !r.ok && r.reason.includes('도전 과제'); }));
  await tab5(np, 'fin', 'rectab', 'hall'); await np.waitForTimeout(150);
  const hall = await np.locator('.st-start').innerText().catch(() => '');
  check('1.5.0 명예의 전당: 이 판의 시작·도전 과제(지켜지는 중, 햇수)', hall.includes('2000년 시작') && hall.includes('넉넉한 자금') && hall.includes('대출 없이') && /지켜지는 중 · [45]년째/.test(hall), hall.replace(/\n/g, ' ').slice(0, 120));
  await tab5(np, 'fin', 'rectab', 'stats'); await np.waitForTimeout(150);
  const stx = await np.locator('#panel').innerText(), svgs = await np.locator('#panel .st-card svg.fin-chart').count();
  check('1.5.0 통계 탭: 요약 숫자·연도별 그래프 6개·차종별·시대별 비중·도전 과제', svgs >= 6 && stx.includes('누적 판매') && stx.includes('최다 판매 차') && (await np.locator('.st-sum .kpi').last().innerText()).includes('누리') && stx.includes('2000년대') && stx.includes('대출 없이') && (await np.locator('.st-bars').count()) === 2, `svg ${svgs}`);
  check('1.5.0 통계 그래프: 손가락을 대면 그해 값(제목)', await NG(() => [...document.querySelectorAll('#panel .st-card svg rect title')].some((t) => /^2002년 판매 [\d,]+대$/.test(t.textContent) && !/ 0대$/.test(t.textContent))));
  await np.click('[data-act="statsRange"][data-v="10y"]');
  check('1.5.0 통계 기간: 최근 10년으로 바꿈', (await np.locator('[data-act="statsRange"][data-v="10y"]').getAttribute('aria-selected')) === 'true');
  await nshot('stats-1366x1024');
  for (const [w, h] of [[1024, 768], [800, 1200]]) {
    await np.setViewportSize({ width: w, height: h }); await np.waitForTimeout(150);
    const o1 = await ovAll(); await nshot(`stats-${w}x${h}`);
    await tab5(np, 'fin', 'rectab', 'past'); await np.waitForTimeout(100); const o2 = await ovAll(); if (w === 800) await nshot('past-tab-800x1200');
    await tab5(np, 'fin', 'rectab', 'stats');
    check(`1.5.0 ${w}×${h}: 통계·지난 판의 차 넘침 없음, 재무 탭 구역 줄이 넘치지 않음(5.0.0)`, o1 <= 0 && o2 <= 0 && await NG(() => { const t = document.querySelector('.secbar'); return t.scrollWidth <= t.clientWidth + 1; }), `${o1}/${o2}`);
  }
  await np.setViewportSize({ width: 1366, height: 1024 }); await tab5(np, 'fin', 'rectab', 'past');
  check('1.5.0 지난 판의 차: 지난 판 목록(지금 판은 빼고)·[목록 비우기]', (await np.locator('.past-card').innerText()).includes('지난판 모터스') && !(await np.locator('.past-card').innerText()).includes('통계 시험') && (await np.locator('[data-act="pastClear"]').count()) === 1);
  await np.click('[data-act="pastClear"]'); await np.click('#ask-yes'); await np.waitForTimeout(100);
  check('1.5.0 [목록 비우기] 확인 뒤 목록이 빔', (await NG(() => localStorage.getItem('car-company-past-names'))) === null && (await np.locator('.past-card').innerText()).includes('아직 모아 둔 이름이 없습니다'));
  await nctx.close(); }

// ---- 1.6.0 기기 연동: api.github.com·gist.githubusercontent.com을 가짜 보관함(메모리)으로 받아, 기기 A(PC 1366×1024)·B(태블릿 800×1200 터치) 두 컨텍스트가 같은 보관함을 쓴다.
// A 연동 켜기·올리기 → B 연동 켜기 물음(아니요) → B 새로 열기 물음 → 불러오면 같은 회사·날짜 → A 진행·올리기 → B 올리기 충돌 → 서버 것 불러오기 → 401 실패 줄 → 연동 끄기.
// CAR_SMOKE_160=폴더 를 주면 화면을 그 폴더에 찍는다. 실제 GitHub에는 연결하지 않는다
{ const { gunzipSync } = await import('node:zlib');
  const S6 = process.env.CAR_SMOKE_160 ?? '', TOKEN = 'smoke-token-123';
  const gists = new Map(); let gseq = 0, down = null;
  const LIMIT = 2000; // 실제 GitHub는 1MB. 브라우저에서 raw_url 경로를 타게 작게(사진 없는 초반 판은 수 KB)
  const view = (id) => ({ id, public: false, files: Object.fromEntries([...gists.get(id)].map(([n, c]) => [n, { filename: n, size: c.length, raw_url: `https://gist.githubusercontent.com/me/${id}/raw/${gseq}/${n}`, truncated: c.length > LIMIT, content: c.slice(0, LIMIT) }])) });
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Authorization, Content-Type, Accept', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
  const rawSeen = [];
  const fake = async (route) => {
    const r = route.request(), url = r.url(), method = r.method(), json = (status, b) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (down) return json(down, { message: 'error' });
    const raw = url.match(/^https:\/\/gist\.githubusercontent\.com\/me\/([^/]+)\/raw\/\d+\/(.+)$/);
    if (raw) { rawSeen.push(r.headers().authorization ?? ''); return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/plain' }, body: gists.get(raw[1])?.get(raw[2]) ?? '' }); }
    if (r.headers().authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
    const body = r.postData() ? JSON.parse(r.postData()) : null;
    if (method === 'GET' && url.startsWith('https://api.github.com/gists?')) return json(200, [...gists.keys()].map((id) => ({ id, files: Object.fromEntries([...gists.get(id).keys()].map((n) => [n, { filename: n }])) })));
    if (method === 'POST' && url === 'https://api.github.com/gists') { const id = `g${++gseq}`; gists.set(id, new Map(Object.entries(body.files).map(([n, x]) => [n, x.content]))); return json(201, view(id)); }
    const m = url.match(/^https:\/\/api\.github\.com\/gists\/([^/?]+)$/);
    if (m && gists.has(m[1])) { if (method === 'GET') return json(200, view(m[1])); if (method === 'PATCH') { gseq++; for (const [n, x] of Object.entries(body.files)) gists.get(m[1]).set(n, x.content); return json(200, view(m[1])); } }
    return json(404, { message: 'Not Found' });
  };
  const meta = () => { const g = [...gists.values()][0]; return g ? JSON.parse(g.get('carcompany-sync-meta.json')) : null; };
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  const open = async (opt) => { const c = await browser.newContext(opt); await c.route('https://api.github.com/**', fake); await c.route('https://gist.githubusercontent.com/**', fake);
    const p = await c.newPage(); p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => m.type() === 'error' && !/Failed to load resource.*40[13]/.test(m.text()) && errors.push(m.text())); return { c, p }; };
  const menuOf = async (p) => { await p.evaluate(() => { document.getElementById('sheet').hidden = true; document.getElementById('toasts').innerHTML = ''; }); await openSave(p); await p.waitForSelector('#sheet:not([hidden]) .sync-box'); };
  const shotS = async (p, n, sel = '.sync-box') => { if (!S6) return; const { mkdirSync } = await import('node:fs'); mkdirSync(S6, { recursive: true }); if (sel) await p.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); await p.screenshot({ path: `${S6}/${n}.png` }); };
  const where = (p) => p.evaluate(() => { const s = window.__car.game?.state; return s ? { co: s.companyName, week: s.week, title: !document.getElementById('title').hidden } : null; });
  const quick = (p) => p.evaluate(() => { const c = window.__car, g = c.game, s = g.state; c.setSpeed(0);
    g.command({ type: 'startProject', name: '연동카', body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const pr = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: pr.id, price: Math.round(c.Q.carBasePrice(s, pr) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); c.tick(20); c.setSpeed(0); });

  // 기기 A(PC)
  const A = await open({ viewport: { width: 1366, height: 1024 } });
  await A.p.goto(URL0); await A.p.waitForSelector('#title:not([hidden])');
  await A.p.click('[data-act="titleNew"]'); await A.p.fill('#t-co', '연동 모터스'); await A.p.click('[data-act="startNew"]'); await A.p.click('#tabs button[data-tab="car"]'); await quick(A.p);
  { // 출시 사진 한 장의 크기(400×250 JPEG 0.82, 저장 데이터에 들어가는 모양 그대로)
    await A.p.evaluate((id) => window.__car.goTarget({ tab: 'garage', id }), await A.p.evaluate(() => window.__car.game.state.nameplates[0].generations[0].id)); await A.p.waitForTimeout(300);
    const n = await A.p.evaluate(() => new Promise((res) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = 400; c.height = 250; const k = Math.max(400 / i.width, 250 / i.height); c.getContext('2d').drawImage(i, 0, 0, i.width * k, i.height * k); res(c.toDataURL('image/jpeg', 0.82).length); }; i.src = window.__car.stage.snapshot(); }));
    console.log(`INFO 1.6.0 출시 사진 한 장 data URL ${n}자`); }
  await menuOf(A.p);
  const boxA = await A.p.locator('.sync-box').innerText();
  check('1.6.0 메뉴 기기 연동 칸: 토큰(비밀번호 칸)·기기 이름(PC 추정)·[연동 켜기]·ⓘ', (await A.p.locator('#sy-token').getAttribute('type')) === 'password' && (await A.p.inputValue('#sy-dev')) === 'PC' && (await A.p.locator('[data-act="syncOn"]').count()) === 1 && (await A.p.locator('.sync-box [data-info="term:기기 연동"]').count()) === 1, boxA.replace(/\n/g, ' ').slice(0, 100));
  await A.p.click('.sync-box [data-info="term:기기 연동"]'); const tipA = await A.p.evaluate(() => window.__car.tip?.text ?? '');
  check('1.6.0 ⓘ: 토큰 만드는 법(gist 권한 하나)·숨김 상태·나중 저장', tipA.includes('Tokens (classic)') && tipA.includes('gist 하나만') && tipA.includes('주소를 아는 사람은 볼 수 있는') && tipA.includes('나중 저장이 남는다'));
  await shotS(A.p, 'menu-off-1366x1024', '');
  await A.p.keyboard.press('Escape').catch(() => {}); await A.p.evaluate(() => { const t = document.getElementById('tip'); if (t) t.hidden = true; });
  await A.p.fill('#sy-token', 'wrong'); await A.p.click('[data-act="syncOn"]'); await A.p.waitForTimeout(300);
  check('1.6.0 틀린 토큰: 켜지지 않고 이유 알림, 이 기기에 토큰을 남기지 않음', (await A.p.evaluate(() => localStorage.getItem('car-company-sync'))) === null && (await A.p.locator('#toasts').innerText()).includes('토큰이 틀렸거나'));
  await A.p.fill('#sy-token', TOKEN); await A.p.click('[data-act="syncOn"]');
  const up1 = await until(() => meta()?.rev === 1);
  const wA1 = await where(A.p), m1 = meta();
  check('1.6.0 A 연동 켜기: 비밀 보관함을 만들고 지금 판을 올림(rev 1, 기기·회사·날짜·형식·버전)', up1 && gists.size === 1 && m1.device === 'PC' && m1.company === '연동 모터스' && m1.saveVersion === 12 && /^\d+\.\d+\.\d+$/.test(m1.gameVersion) && m1.date.includes('1970'), JSON.stringify(m1));
  await until(async () => (await A.p.locator('.sync-line').innerText()).includes('마지막으로 올린 시각'));
  check('1.6.0 A 상태 줄: 마지막으로 올린 시각, [지금 올리기]·[서버에서 불러오기]·[연동 끄기]', (await A.p.locator('.sync-line').innerText()).includes('마지막으로 올린 시각') && (await A.p.locator('.sync-box [data-act="syncUp"],.sync-box [data-act="syncDown"],.sync-box [data-act="syncOff"]').count()) === 3);
  await shotS(A.p, 'menu-on-1366x1024');
  await A.p.setViewportSize({ width: 800, height: 1200 }); await A.p.waitForTimeout(150);
  check('1.6.0 800×1200: 메뉴 기기 연동 칸 가로 넘침 없음', (await overflowOf(A.p)) <= 0 && await A.p.evaluate(() => { const b = document.querySelector('.sync-box'), r = b.getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && r.right <= innerWidth; }));
  await shotS(A.p, 'menu-on-800x1200'); await A.p.setViewportSize({ width: 1366, height: 1024 });
  const body = gunzipSync(Buffer.from([...gists.values()][0].get('carcompany-sync-save.txt'), 'base64')).toString();
  check('1.6.0 보관함 본문(gzip+base64): 자동 저장 한 판·지난 판 목록, 토큰 없음', body.includes('"companyName":"연동 모터스"') && body.includes('"past"') && !body.includes(TOKEN) && !JSON.stringify(m1).includes(TOKEN));

  // 기기 B(태블릿): 자기 판이 있는 상태에서 연동 켜기 → 물음(아니요) → 새로 열면 다시 물음 → 불러오기
  const B = await open({ viewport: { width: 800, height: 1200 }, hasTouch: true });
  await B.p.goto(URL0); await B.p.waitForSelector('#title:not([hidden])');
  await B.p.click('[data-act="titleNew"]'); await B.p.fill('#t-co', '다른 회사'); await B.p.click('[data-act="startNew"]'); await B.p.click('#tabs button[data-tab="car"]'); await B.p.evaluate(() => { window.__car.setSpeed(0); window.__car.tick(6); });
  await B.p.evaluate(() => window.__car.setSpeed(0)); await menuOf(B.p);
  check('1.6.0 B 기기 이름 기본값: 터치 화면이면 태블릿', (await B.p.inputValue('#sy-dev')) === '태블릿');
  await B.p.fill('#sy-token', TOKEN); await B.p.click('[data-act="syncOn"]');
  await until(() => B.p.locator('#ask').isVisible());
  const askB = await B.p.locator('#ask-text').innerText();
  check('1.6.0 B 연동 켜기: 서버 저장이 있으면 불러올지 물음(기기·회사·날짜·저장 시각, 백업 안내)', askB.includes('다른 기기(PC)의 저장이 더 최신입니다') && askB.includes('연동 모터스') && askB.includes(m1.date) && /\d{4}-\d\d-\d\d \d\d:\d\d 저장/.test(askB) && askB.includes('연동 전 백업'), askB.replace(/\n/g, ' '));
  await B.p.click('#ask-no');
  check('1.6.0 B 아니요: 자기 판 그대로', (await where(B.p)).co === '다른 회사');
  await B.p.evaluate(() => window.__car.tick(4)); await B.p.waitForTimeout(1200); // 자동 저장(매달) → 올리기는 rev가 달라 멈춤
  await B.p.reload(); await B.p.waitForSelector('#title:not([hidden])');
  const askT = await until(() => B.p.locator('#ask').isVisible());
  check('1.6.0 B 새로 열기(처음 화면): 다른 기기 저장이 더 최신이라며 물음', askT && (await B.p.locator('#ask-text').innerText()).includes('다른 기기(PC)'));
  await B.p.waitForTimeout(500); await shotS(B.p, 'title-ask-800x1200', ''); // 창이 떠오르는 동안 기다림
  await B.p.setViewportSize({ width: 1366, height: 1024 }); await B.p.waitForTimeout(150); await shotS(B.p, 'title-ask-1366x1024', ''); await B.p.setViewportSize({ width: 800, height: 1200 });
  await B.p.click('#ask-yes');
  await until(async () => (await where(B.p))?.co === '연동 모터스');
  const wB1 = await where(B.p);
  check('1.6.0 B 불러오기: A와 같은 회사·같은 날짜(주), 게임 화면으로', wB1?.co === '연동 모터스' && wB1.week === wA1.week && !wB1.title, `${JSON.stringify(wA1)} / ${JSON.stringify(wB1)}`);
  check('1.6.0 B 불러오기: 원격 판의 raw_url(1MB 넘김 경로)을 토큰 없이 받음', rawSeen.length >= 1 && rawSeen.every((x) => x === ''), String(rawSeen.length));
  await B.p.evaluate(() => window.__car.setSpeed(0)); await menuOf(B.p); await B.p.click('[data-act="home"]'); await B.p.waitForSelector('#title:not([hidden])');
  check('1.6.0 처음 화면: 이 기기의 이전 자동 저장이 "연동 전 백업"으로 남음, 이어 하기는 받은 판', (await B.p.locator('#title').innerText()).includes('연동 전 백업') && (await B.p.locator('[data-act="continue"]').innerText()).includes('연동 모터스'));
  await B.p.click('[data-act="continue"]'); await B.p.evaluate(() => window.__car.setSpeed(0));

  // A가 더 진행해 올림 → B가 올리려면 충돌 → 서버 것 불러오기
  await A.p.evaluate(() => { document.getElementById('sheet').hidden = true; window.__car.tick(8); window.__car.setSpeed(0); });
  await menuOf(A.p); await A.p.click('.sync-box [data-act="syncUp"]');
  const up2 = await until(() => meta()?.rev >= 2 && meta().date !== m1.date);
  const wA2 = await where(A.p); await A.c.close();
  await menuOf(B.p); await B.p.click('.sync-box [data-act="syncUp"]');
  await until(async () => (await B.p.locator('[data-act="syncForce"]').count()) === 1);
  const lineB = await B.p.locator('.sync-line').innerText(), revBefore = meta().rev;
  check('1.6.0 B 올리기 충돌: 자동으로 덮어쓰지 않고 멈춤, [이 기기 것으로 덮어쓰기]·[서버 것 불러오기]', up2 && lineB.includes('올리기를 멈췄습니다') && lineB.includes('PC') && (await B.p.locator('.sync-box [data-act="syncDown"]').count()) === 2 && meta().device === 'PC' && meta().rev === revBefore, lineB);
  await shotS(B.p, 'conflict-800x1200');
  await B.p.setViewportSize({ width: 1366, height: 1024 }); await B.p.waitForTimeout(150); await shotS(B.p, 'conflict-1366x1024'); await B.p.setViewportSize({ width: 800, height: 1200 });
  await B.p.locator('.sync-box [data-act="syncDown"]').first().click(); await until(() => B.p.locator('#ask').isVisible());
  check('1.6.0 서버 것 불러오기: 확인 창(PC, 회사)', (await B.p.locator('#ask-text').innerText()).includes('서버의 저장(PC:'));
  await B.p.click('#ask-yes'); await until(async () => (await where(B.p))?.week === wA2.week);
  const wB2 = await where(B.p);
  check('1.6.0 서버 것 불러오기: A가 마지막으로 올린 날짜(주)', wB2.co === '연동 모터스' && wB2.week === wA2.week && wB2.week > wB1.week, `${wA2.week}/${wB2.week}`);

  // 실패: 401(토큰 만료) → 게임은 그대로, 상태 줄과 알림
  down = 401; await B.p.evaluate(() => window.__car.setSpeed(0)); await menuOf(B.p); await B.p.click('.sync-box [data-act="syncUp"]');
  await until(async () => (await B.p.locator('.sync-line').innerText()).includes('실패'));
  const failLine = await B.p.locator('.sync-line').innerText();
  check('1.6.0 401: 상태 줄에 실패 이유(토큰), 알림, 플레이를 막는 창 없음', failLine.includes('토큰이 틀렸거나 만료') && failLine.includes('이 기기에 남아') && (await B.p.locator('#toasts').innerText()).includes('토큰이 틀렸거나') && (await B.p.locator('#ask').isHidden()) && !(await where(B.p)).title, failLine);
  await shotS(B.p, 'fail-800x1200'); down = null;
  const lsAll = await B.p.evaluate((t) => Object.keys(localStorage).filter((k) => k !== 'car-company-sync' && (localStorage.getItem(k) ?? '').includes(t)), TOKEN);
  check('1.6.0 토큰은 연동 설정 한 곳에만(다른 기기 저장소 값에 없음)', lsAll.length === 0, lsAll.join());
  await B.p.click('.sync-box [data-act="syncOff"]'); await B.p.click('#ask-yes'); await B.p.waitForTimeout(150);
  check('1.6.0 연동 끄기: 이 기기의 토큰·id를 지우고 입력칸으로, 서버 보관함은 그대로', (await B.p.evaluate(() => localStorage.getItem('car-company-sync'))) === null && (await B.p.locator('#sy-token').count()) === 1 && gists.size === 1 && meta().rev >= 2);
  await B.c.close(); }

// ---- 2.0.0 경쟁 1부: 차고 상세 [같은 차급의 경쟁 차와 비교] → 경쟁 모델 이름, 재무의 경쟁사 → 라인업·지난 세대, 뉴스에 세대교체 한 줄 ----
// CAR_SMOKE_200=폴더 를 주면 1366×1024·800×1200 화면을 그 폴더에 찍는다
{ const vctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const vp = await vctx.newPage(); vp.on('pageerror', (e) => errors.push(String(e))); vp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const VG = (fn, a) => vp.evaluate(fn, a), V2 = process.env.CAR_SMOKE_200 ?? '';
  const vshot = async (n) => { if (V2) await vp.screenshot({ path: `${V2}/${n}.png` }); };
  const both = async (n, fn) => { for (const [w, h] of [[1366, 1024], [800, 1200]]) { await vp.setViewportSize({ width: w, height: h }); await vp.waitForTimeout(250); if (fn) await fn(); await vshot(`${n}-${w}x${h}`); } await vp.setViewportSize({ width: 1366, height: 1024 }); };
  await vp.goto(URL0); await vp.waitForSelector('#title:not([hidden])');
  await vp.click('[data-act="titleNew"]'); await vp.fill('#t-co', '경쟁 시험'); await vp.click('[data-act="startNew"]'); await vp.click('#tabs button[data-tab="car"]'); await VG(() => window.__car.setSpeed(0));
  const gid = await VG(() => { const c = window.__car, g = c.game, s = g.state; s.cash = 1e9; c.tick(48 * 8); s.cash = 1e9; s.events.pending.length = 0;
    g.command({ type: 'startProject', name: '아리아', body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); for (let i = 0; i < 80 && !p.waiting && (p.phase === 'design' || p.testWeeks < 8); i++) { s.events.pending.length = 0; c.tick(1); } // 실제 개발(능력치가 0이 아닌 차)
    g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); c.render(); return s.nameplates[0]?.generations[0]?.id ?? -1; });
  const want = await VG(() => [...window.__car.Q.rivalModelsIn(window.__car.game.state, 'sedanS')].sort((a, b) => b.share - a.share || (a.rivalId < b.rivalId ? -1 : 1)).slice(0, 3).map((v) => v.name)); // 4.0.0 점유 상위 3종
  await VG((id) => { document.getElementById('toasts').innerHTML = ''; window.__car.goTarget({ tab: 'garage', id }); }, gid); await vp.waitForTimeout(150);
  check('2.0.0 차고 상세: [같은 차급의 경쟁 차와 비교]', gid >= 0 && (await vp.locator('[data-act="rivalCmp"]').count()) === 1, String(gid));
  await vp.click('[data-act="rivalCmp"]'); await vp.waitForSelector('#sheet .rv-cmp');
  const ct = await vp.locator('#sheet .rv-cmp').innerText();
  check('2.0.0 경쟁 차와 비교: 내 차 + 같은 차급 경쟁 모델 3종(이름·세대·출시 연도), 능력치 막대, 추정 평론·가격·점유', want.length === 3 && want.every((n) => ct.includes(n)) && ct.includes('아리아') && /\d세대 · \d{4}년/.test(ct) && (await vp.locator('#sheet .rv-cmp .abil').count()) === 20 && ct.includes('차급 점유') && (await vp.locator('#sheet .rv-sum').innerText()).includes('앞서는 능력치'), want.join());
  await both('compare', async () => { await vp.locator('#sheet .rv-sum').scrollIntoViewIfNeeded(); });
  await vp.click('#sheet [data-act="closeSheet"]');
  await toRivals(vp); await vp.waitForTimeout(150);
  check('2.0.0 재무의 경쟁사: 회사 줄을 누르면 라인업(4.0.0 경쟁사 6곳, 이 판은 5곳)', (await vp.locator('[data-act="rivalOpen"]').count()) === await VG(() => window.__car.game.state.rivals.length));
  await vp.click('[data-act="rivalOpen"][data-v="toyoda"]'); await vp.waitForSelector('#panel .rv-sheet');
  const lt = await vp.locator('#panel .rv-sheet').innerText(), lineup = await VG(() => window.__car.Q.rivalLineup(window.__car.game.state, 'toyoda'));
  check('2.0.0 라인업: 모델 12종(이름·차체·세대·출시 연도·추정 평론), 한 줄 성격', (await vp.locator('#panel .rv-sheet .rv-model').count()) === 12 && lineup.models.every((m) => lt.includes(m.name)) && lt.includes(lineup.desc) && lt.includes('추정 평론'), String(await vp.locator('#panel .rv-sheet .rv-model').count()));
  const old = lineup.models.reduce((a, m) => (m.n > a.n ? m : a));
  await vp.locator('#panel .rv-sheet .rv-model summary', { hasText: old.name }).click();
  const hist = vp.locator('#panel .rv-sheet .rv-model[open] .rv-hist tr');
  check('2.0.0 모델을 누르면 지난 세대(세대별 출시 연도·추정 평론)', (await hist.count()) === old.n + 2, `${old.name} ${await hist.count()}`);
  await both('lineup', async () => { await vp.locator('#panel .rv-sheet .rv-model[open]').scrollIntoViewIfNeeded(); });
  await vp.click('#panel [data-act="rivalClose"]');
  // 뉴스: 내 차와 같은 칸의 세대교체가 나올 때까지 진행(최대 8년) → 뉴스 탭에 "「아리아」와 같은 …" 한 줄과 알림
  const nw = await VG(() => { const c = window.__car, s = c.game.state; for (let i = 0; i < 96; i++) { s.cash = Math.max(s.cash, 1e8); s.events.pending.length = 0; c.tick(4); const n = s.events.news.filter((x) => x.category === 'rival'); if (n.at(-1)?.text.includes('「아리아」')) return n.at(-1).text; } return ''; });
  const noteHit = await VG(() => [...document.querySelectorAll('#toasts .toast')].some((t) => t.innerText.includes('경쟁사 신차')));
  await menuItem(vp, '#todobtn'); await vp.click('#drawer [data-act="todoTab"][data-v="notes"]');
  const inLog = await vp.locator('#drawer .note-it', { hasText: '「아리아」' }).count();
  await vp.click('#drawer [data-act="drawerClose"]');
  check('2.0.0 세대교체 알림: 내 차와 같은 칸이면 "「아리아」와 같은 소형 세단" 알림(기록함)', nw.includes('세대 출시.') && nw.includes('「아리아」와 같은') && (noteHit || inLog >= 1), nw);
  await tab5(vp, 'fin', 'rectab', 'news'); await vp.waitForTimeout(150);
  const nl = await vp.locator('.nl.k-rival').count(), nt = nl ? await vp.locator('.nl.k-rival').first().innerText() : '';
  check('2.0.0 뉴스 탭: 경쟁사 신차 줄(3.5.0 분류 이름 경쟁사 동향)(회사, 모델 n세대 출시)', nl >= 1 && nt.includes('경쟁사 동향') && /세대 출시/.test(nt), nt);
  await both('news');
  for (const [w, h] of [[1366, 1024], [800, 1200]]) { await vp.setViewportSize({ width: w, height: h }); await VG(() => { document.getElementById('toasts').innerHTML = ''; }); await toRivals(vp); await vp.waitForTimeout(150); await vp.locator('.rv-co').last().scrollIntoViewIfNeeded(); const o = await overflowOf(vp); await vshot(`fin-${w}x${h}`); check(`2.0.0 ${w}×${h}: 재무(경쟁사 카드) 넘침 없음`, o <= 0, String(o)); }
  await vctx.close(); }

// ---- 3.0.0 자회사와 본사 6·7등급: 2005년 상태(본사 5등급·평판 150·현금 넉넉, 중형 세단 출시)를 직접 만들고 화면으로 설립 → 전략(전환 표시) → 영역·배당·투자·공유·사장 →
// 모델 추가·이름 변경 → 비교 창 "내 자회사" → 월 결산 자회사 배당 줄 → 매각. 본사 6·7등급 건설·정원 30·40, 사무실·직원 목록 40명
// CAR_SMOKE_300=폴더 를 주면 1366×1024·1024×768·800×1200 화면을 그 폴더에 찍는다
{ const sctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const sp = await sctx.newPage(); sp.on('pageerror', (e) => errors.push(String(e))); sp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const SG = (fn, a) => sp.evaluate(fn, a), S3 = process.env.CAR_SMOKE_300 ?? '';
  const sshot = async (n) => { if (S3) await sp.screenshot({ path: `${S3}/${n}.png` }); };
  const SIZES = [[1366, 1024], [1024, 768], [800, 1200]];
  /** 세 크기에서: 크기를 바꾸고 fn(보일 곳으로 스크롤)을 한 뒤 가로 넘침을 재고 찍는다 */
  const three = async (n, fn) => { for (const [w, h] of SIZES) { await sp.setViewportSize({ width: w, height: h }); await SG(() => { document.getElementById('toasts').innerHTML = ''; }); await sp.waitForTimeout(250); if (fn) await fn(); const o = await overflowOf(sp); check(`3.0.0 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); await sshot(`${n}-${w}x${h}`); } await sp.setViewportSize({ width: 1366, height: 1024 }); };
  const yes = async () => { await sp.waitForSelector('#ask:not([hidden])'); await sp.click('#ask-yes'); };
  const sub = () => SG(() => window.__car.game.state.subs?.[0] ?? null);
  /** 회사 > 자회사로 가서 첫 자회사 상세(이미 열려 있으면 그대로) */
  const openSub = async () => { await tab5(sp, 'group', 'cotab', 'sub'); if (await sp.locator('#panel [data-act="subSel"]').count()) await sp.locator('#panel [data-act="subSel"]').first().click(); await sp.waitForSelector('#panel .sub-strat'); };
  await sp.goto(URL0); await sp.waitForSelector('#title:not([hidden])');
  await sp.click('[data-act="titleNew"]'); await sp.fill('#t-co', '자회사 시험'); await sp.click('[data-act="startNew"]'); await sp.click('#tabs button[data-tab="car"]'); await SG(() => window.__car.setSpeed(0));
  const gid = await SG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 5; s.reputation = 150;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2005 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    g.command({ type: 'startProject', name: '아리아', body: 'sedanM', segment: 'family', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 });
    s.events.pending.length = 0; c.render(); return s.nameplates[0].generations[0].id; });
  await tab5(sp, 'group', 'cotab', 'sub');
  const l0 = await sp.locator('#panel .sub-list').innerText();
  check('3.0.0 회사 탭 자회사 칸: 0/3곳, 안내, [자회사 설립], 자회사 ⓘ', l0.includes('0/3곳') && l0.includes('아직 자회사가 없습니다') && !(await sp.locator('[data-act="subFoundOpen"]').isDisabled()) && (await sp.locator('#panel [data-info="term:자회사"]').count()) === 1, l0.slice(0, 80));
  // 설립 창
  await sp.click('[data-act="subFoundOpen"]'); await sp.waitForSelector('#sheet .sub-found');
  const ft = await sp.locator('#sheet .sub-found').innerText();
  check('3.0.0 설립 창: 종류 4개(설명·설립비·조건), 기본 이름, 로고 색', (await sp.locator('#sheet [data-act="subFoundKind"]').count()) === 4 && ['고급 브랜드', '보급형 브랜드', '부품 회사', '할부 금융', '설립비', '평판 120 이상'].every((t) => ft.includes(t)) && (await sp.inputValue('#sub-name')) === '엘리온' && (await sp.locator('#sheet [data-act="subColor"]').count()) >= 8);
  await three('found', async () => { await sp.locator('#sheet .sub-found .lg-sw').scrollIntoViewIfNeeded(); });
  await sp.fill('#sub-name', '루미에르'); await sp.click('#sheet [data-act="subColor"][data-v="#7a1f2b"]');
  await sp.click('#sheet [data-act="subFoundDo"]'); await yes(); await sp.waitForSelector('#panel .sub-strat');
  const s0 = await sub();
  check('3.0.0 설립: 이름·로고 색·설립비, 상세(전략 지시)로', s0?.name === '루미에르' && s0.color === '#7a1f2b' && (await SG(() => window.__car.game.state.cash)) === 1e9 - 20000000);
  // 전략: 기술 선도 → 전환 표시
  check('3.0.0 전략 카드 9개(고급 브랜드는 점유율 중심·전동화 전환이 흐리고 이유)', (await sp.locator('#panel .sub-st').count()) === 9 && (await sp.locator('#panel .sub-st.locked').count()) === 2 && (await sp.locator('#panel .sub-st.locked').first().innerText()).length > 20);
  await sp.click('#panel [data-act="subStrat"][data-v="tech"]');
  const tr = await sp.locator('#panel .sub-tr').innerText().catch(() => '');
  check('3.0.0 전략 변경: 전환 중 · 남은 개월 · "전환 기간 동안 효과가 서서히 바뀝니다", 전환 기간 ⓘ', tr.includes('6개월 남았습니다') && tr.includes('전환 기간 동안 효과가 서서히 바뀝니다') && tr.includes('기술 선도') && (await sp.locator('#panel [data-info="term:전환 기간"]').count()) === 1, tr);
  await sp.click('#panel [data-act="subStrat"][data-v="rival"]');
  await sp.click('#panel [data-act="subRival"][data-v="toyoda"]');
  check('3.0.0 경쟁사 대응: 상대 고르기(자동/지정)와 상대의 주력 차급', (await sub()).rivalId === 'toyoda' && (await sp.locator('#panel .sub-strat').innerText()).includes('주력 차급'));
  await three('detail-strategy', async () => { await sp.locator('#panel .sub-strat').scrollIntoViewIfNeeded(); });
  // 영역·배당·투자·공유·사장
  await sp.click('#panel [data-act="subBody"][data-v="sports"]'); await sp.click('#panel [data-act="subSeg"][data-v="enthusiast"]');
  const a1 = await sub();
  check('3.0.0 맡을 영역: 차급 빼기·고객층 바꾸기', !a1.bodies.includes('sports') && a1.segment === 'enthusiast');
  await sp.click('#panel .sub-div [data-act="subDivi"]:last-child');
  check('3.0.0 배당 비율 +10 → 60%, 실제 배당률 표시', (await sub()).dividend === 60 && (await sp.locator('#panel .sub-set').innerText()).includes('실제 배당률'));
  const invT = await sp.locator('#panel [data-act="subInvest"]').first().innerText();
  await sp.click('#panel [data-act="subInvest"]'); await yes();
  check('3.0.0 추가 투자: 투자 뒤 생산 한도·모델 상한 표시, 자본 +500억', invT.includes('생산 한도') && invT.includes('모델 상한') && (await sub()).capital === 25000000, invT);
  await sp.click('#panel [data-act="subShare"][data-v="2"]');
  check('3.0.0 공유 범위: 넓게(효과 표시)', (await sub()).share === 2 && (await sp.locator('#panel .sub-share').innerText()).includes('개발비'));
  const n0 = await SG(() => window.__car.game.state.staff.length);
  await sp.click('#panel [data-act="subPresPick"]'); await sp.locator('#panel .sub-pres [data-act="subPresSet"]').first().click();
  check('3.0.0 사장 임명: 본사 직원에서 빠짐(직원 화면에 "자회사 사장 1명")', !!(await sub()).president && (await SG(() => window.__car.game.state.staff.length)) === n0 - 1 && (await sp.locator('#panel .sub-pres').innerText()).includes('능력'));
  await tab5(sp, 'people', 'psec', 'staff');
  check('3.0.0 직원 화면: 자회사 사장 n명 한 줄', (await sp.locator('#panel .sub-pres-n').innerText()).includes('자회사 사장 1명'));
  // 한 달 뒤: 첫 모델, 모델 추가(중형 세단)·이름 변경
  await SG(() => { const c = window.__car; c.game.state.events.pending.length = 0; c.tick(4); });
  await openSub();
  check('3.0.0 첫 월말에 첫 모델(라인업 썸네일·추정 평론·가격·점유)', (await sp.locator('#panel .sub-lineup .rv-model').count()) === 1 && (await sp.locator('#panel .sub-lineup').innerText()).includes('추정 평론'));
  if (!(await sub()).models.some((m) => m.body === 'sedanM')) { await sp.click('#panel [data-act="subAddPick"]'); await sp.click('#panel [data-act="subAdd"][data-v="sedanM"]'); }
  else { await sp.click('#panel [data-act="subAddPick"]'); await sp.locator('#panel [data-act="subAdd"]').first().click(); }
  check('3.0.0 모델 추가: 2개, 중형 세단 포함', (await sub()).models.length === 2 && (await sub()).models.some((m) => m.body === 'sedanM'));
  await sp.locator('#panel .sub-lineup .rv-model summary').first().click();
  await sp.locator('#panel .sub-lineup .rv-model[open] [data-act="subRenameOpen"]').click(); await sp.fill('#sub-rn', '루미 세단'); await sp.click('#sheet [data-act="subRenameDo"]');
  check('3.0.0 모델 이름 변경', (await sub()).models.some((m) => m.name === '루미 세단') && (await sp.locator('#panel .sub-lineup').innerText()).includes('루미 세단'));
  await SG(() => { const c = window.__car; c.game.state.events.pending.length = 0; c.tick(12 * 4 + 4); }); // 1년여: 실적·분기 보고·자기 잠식
  await tab5(sp, 'group', 'cotab', 'sub').catch(() => {}); await SG(() => window.__car.render());
  const rt = await sp.locator('#panel .sub-res').innerText();
  check('3.0.0 실적: 지난달·최근 12개월·누적, 자기 잠식, 분기 보고', ['지난달', '최근 12개월', '설립 뒤 누적', '자기 잠식'].every((t) => rt.includes(t)) && (await sp.locator('#panel .sub-reports li').count()) >= 4, rt.slice(0, 120));
  await three('detail-lineup', async () => { await sp.locator('#panel .sub-lineup').scrollIntoViewIfNeeded(); });
  await three('detail-result', async () => { await sp.locator('#panel .sub-res').scrollIntoViewIfNeeded(); });
  await sp.click('#panel [data-act="subBack"]');
  const lt = await sp.locator('#panel .co-sub').innerText();
  check('3.0.0 자회사 목록: 이름·종류·전략·모델 수·최근 12개월 이익과 배당·사장, 1/3곳, 본사에 준 것', (await sp.locator('#panel .sub-row').count()) === 1 && ['루미에르', '고급 브랜드', '경쟁사 대응', '모델 2개', '최근 12개월 이익', '사장', '1/3곳', '자회사가 본사에 준 것'].every((t) => lt.includes(t)), lt.slice(0, 160));
  await three('company-sub');
  // 비교 창: 내 자회사
  await SG((id) => window.__car.goTarget({ tab: 'garage', id }), gid); await sp.waitForTimeout(150);
  await sp.click('[data-act="rivalCmp"]'); await sp.waitForSelector('#sheet .rv-cmp');
  const ct = await sp.locator('#sheet .rv-cmp').innerText();
  check('3.0.0 비교 창: 같은 차급의 내 자회사 모델이 "내 자회사"로', (await sp.locator('#sheet .rv-cmp th.own-sub').count()) === 1 && ct.includes('내 자회사') && ct.includes('루미에르'), ct.slice(0, 100));
  await three('compare', async () => { await sp.locator('#sheet th.own-sub').scrollIntoViewIfNeeded(); });
  await sp.click('#sheet [data-act="closeSheet"]');
  // 월 결산: 자회사 배당 줄, 설립한 달은 자회사 투자 줄. 재무의 자회사 요약
  await sp.click('#tabs button[data-tab="fin"]'); await sp.waitForTimeout(150);
  check('3.0.0 재무: 자회사 요약 카드', (await sp.locator('#panel .sub-hq').count()) === 1);
  await sp.locator('#panel .mbtns [data-act="monthOpen"]').first().click(); await sp.waitForSelector('#sheet .mon');
  const mt = await sp.locator('#sheet .mon').innerText();
  check('3.0.0 월 결산: 자회사 배당 수입 줄', (await sp.locator('#sheet .mon-subdiv').count()) === 1 && mt.includes('자회사 배당'), mt.slice(0, 80));
  const fi = await SG(() => window.__car.game.state.ledger.findIndex((e) => (e.subInv ?? 0) > 0));
  await SG((i) => { document.querySelector('#sheet [data-act="monthOpen"]')?.setAttribute('data-v', String(i)); }, fi); await sp.locator('#sheet [data-act="monthOpen"]').first().click();
  check('3.0.0 월 결산: 설립한 달 자회사 투자 지출 줄', (await sp.locator('#sheet .mon').innerText()).includes('자회사 투자'));
  const prevSub = await SG(() => { const s = window.__car.game.state, i = s.ledger.findIndex((e) => e.subDiv !== undefined); return i > 0 ? i - 1 : -1; });
  if (prevSub >= 0) { await SG((i) => { document.querySelector('#sheet [data-act="monthOpen"]')?.setAttribute('data-v', String(i)); }, prevSub); await sp.locator('#sheet [data-act="monthOpen"]').first().click(); check('3.0.0 월 결산: 자회사가 없던 달은 자회사 배당 줄 없음', (await sp.locator('#sheet .mon-subdiv').count()) === 0); }
  await sp.click('#sheet [data-act="closeSheet"]');
  // 뉴스 탭 '자회사' 분류, 용어 ⓘ
  await tab5(sp, 'fin', 'rectab', 'news'); await sp.waitForTimeout(150);
  check('3.0.0 뉴스 탭: 자회사 분류', (await sp.locator('.nl.k-sub').count()) >= 3 && (await sp.locator('.nl.k-sub').first().innerText()).includes('자회사'));
  // 매각(그 전에 상세의 용어 ⓘ: 자기 잠식)
  await openSub();
  check('3.0.0 용어 ⓘ: 배당·공유 범위·자기 잠식', (await sp.locator('#panel [data-info="term:배당"]').count()) === 1 && (await sp.locator('#panel [data-info="term:공유 범위"]').count()) === 1 && (await sp.locator('#panel [data-info="term:자기 잠식"]').count()) === 1);
  await sp.locator('#panel [data-info="term:자기 잠식"]').click(); await sp.waitForSelector('#tip:not([hidden])');
  const tipT = await sp.locator('#tip').innerText();
  check('3.0.0 자기 잠식 ⓘ: 정식 용어와 "제 살 깎기" 풀이', tipT.includes('자기 잠식') && tipT.includes('제 살 깎기'), tipT.slice(0, 60));
  await sp.keyboard.press('Escape'); await sp.locator('#panel .sub-head h2').click();
  const c0 = await SG(() => window.__car.game.state.cash), n1 = await SG(() => window.__car.game.state.staff.length);
  await sp.click('#panel [data-act="subSell"]'); await sp.waitForSelector('#ask:not([hidden])');
  const askT = await sp.locator('#ask-text').innerText(); await sp.click('#ask-yes');
  check('3.0.0 매각: 확인 창(대금·되돌릴 수 없음), 현금 +, 사장 복귀, 목록 0곳', askT.includes('매각할까요') && askT.includes('되돌릴 수 없습니다') && (await SG(() => window.__car.game.state.subs.length)) === 0 && (await SG(() => window.__car.game.state.cash)) > c0 && (await SG(() => window.__car.game.state.staff.length)) === n1 + 1);
  // 본사 6·7등급: 건설·정원 30·40, 사무실 장면, 직원 목록 40명
  const fill = (n) => SG((n) => { const s = window.__car.game.state, sur = '김이박최정강조윤장임', giv = ['민수', '서연', '지훈', '하은', '도윤', '수아', '예준', '지민'], roles = ['designer', 'engineer', 'engineer', 'tester', 'sales'];
    for (let i = s.staff.length; s.staff.length < n; i++) s.staff.push({ ...s.staff[0], id: s.nextId++, name: `${sur[i % 10]}${giv[Math.floor(i / 10) % 8]}`, role: roles[i % 5], projectId: null, lab: false, ability: 30 + (i * 7) % 50, potential: 90 });
    window.__car.render(); }, n);
  await SG(() => { const s = window.__car.game.state; s.cash = 1e10; s.reputation = 180; window.__car.render(); });
  for (const [lv, cap] of [[6, 30], [7, 40]]) {
    await tab5(sp, 'group', 'cotab', 'hq'); await sp.click('#panel [data-act="upgradeHQ"]'); await yes();
    const ht = await sp.locator('#panel .hq-cur').innerText();
    check(`3.0.0 본사 ${lv}등급 건설: 정원 ${cap}, 7단계 표`, (await SG(() => window.__car.game.state.hqLevel)) === lv && ht.includes(`/${cap}`) && ht.includes(lv === 6 ? '그룹 본사' : '글로벌 캠퍼스') && (await sp.locator('.lv5 li').count()) === 7, ht.slice(0, 80));
    await fill(cap);
    await devHome(sp); await sp.waitForTimeout(600);
    const ov = await SG(() => ({ lv: window.__car.office.view?.level, n: window.__car.office.view?.staff.length, torso: document.querySelectorAll('#office .torso').length }));
    check(`3.0.0 사무실 ${lv}등급: 직원 ${cap}명이 모두 그려짐`, ov.lv === lv && ov.n === cap && ov.torso >= cap, JSON.stringify(ov));
    await three(`office-${cap}`);
  }
  await tab5(sp, 'people', 'psec', 'staff');
  check('3.0.0 직원 목록 40명(정원 40/40)', (await sp.locator('#panel .srow:not(.head):not(.s-exec)').count()) === 40 && (await sp.locator('.hire-card .cap-n').innerText()) === '40/40');
  await three('staff-40', async () => { await sp.locator('#panel .staff-list .srow-w').nth(20).scrollIntoViewIfNeeded(); });
  await sctx.close(); }

// ---- 3.1.0 자회사 직접 운영: 2005년 상태에서 고급·보급형 자회사를 세우고 운영 전환(머리글·강조색·탭) → 직접 운영 → 신차 기획(본사 기획 화면) → 제작 지시 → 다른 자회사로 전환 → 배지 →
// 목표 → 1년 뒤 자회사 차고(3D·평론가·가격) → 본사로 → 본사 차고의 자회사 차 → 재무 그룹 종합. CAR_SMOKE_310=폴더 를 주면 세 크기 화면을 찍는다
{ const sctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const sp = await sctx.newPage(); sp.on('pageerror', (e) => errors.push(String(e))); sp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const SG = (fn, a) => sp.evaluate(fn, a), S3 = process.env.CAR_SMOKE_310 ?? '';
  const SIZES = [[1366, 1024], [1024, 768], [800, 1200]];
  const three = async (n, fn) => { for (const [w, h] of SIZES) { await sp.setViewportSize({ width: w, height: h }); await SG(() => { document.getElementById('toasts').innerHTML = ''; }); await sp.waitForTimeout(250); if (fn) await fn(); const o = await overflowOf(sp); check(`3.1.0 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (S3) await sp.screenshot({ path: `${S3}/${n}-${w}x${h}.png` }); } await sp.setViewportSize({ width: 1366, height: 1024 }); };
  const subs = () => SG(() => window.__car.game.state.subs ?? []);
  const top = () => SG(() => ({ co: document.getElementById('co').textContent, back: !document.getElementById('hqback').hidden, cashL: document.getElementById('cash-l').textContent, hq: document.getElementById('hqcash').hidden ? '' : document.getElementById('hqcash').textContent,
    tabs: [...document.querySelectorAll('#tabs button')].filter((b) => !b.hidden).map((b) => b.dataset.tab).join(), cls: document.body.className, accent: document.documentElement.style.getPropertyValue('--accent') }));
  await sp.goto(URL0); await sp.waitForSelector('#title:not([hidden])');
  await sp.click('[data-act="titleNew"]'); await sp.fill('#t-co', '직접 운영 시험'); await sp.click('[data-act="startNew"]'); await sp.click('#tabs button[data-tab="car"]'); await SG(() => window.__car.setSpeed(0));
  await SG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 5; s.reputation = 150;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2005 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    g.command({ type: 'startProject', name: '아리아', body: 'sedanM', segment: 'family', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 });
    { const g0 = s.nameplates[0].generations[0]; g0.devCost = 3000000; g0.reviews = [7.4, 7.8, 7.1, 7.6]; g0.reviewAvg = 7.475; } // 점검용: 개발자 메뉴로 끝낸 개발이라 개발비·평론을 보통 차처럼
    g.command({ type: 'foundSubsidiary', kind: 'premium', name: '엘리온', color: '#2b3a55' }); g.command({ type: 'foundSubsidiary', kind: 'value', name: '모아', color: '#d9822b' });
    s.events.pending.length = 0; c.tick(4); s.events.pending.length = 0; c.render(); });
  await tab5(sp, 'group', 'cotab', 'sub');
  check('3.1.0 자회사 목록: 자회사마다 [운영 전환], 전반 위임·직접 운영 ⓘ', (await sp.locator('#panel .sub-rows [data-act="subOpen"]').count()) === 2 && (await sp.locator('#panel [data-info="term:직접 운영"]').count()) === 1);
  await sp.locator('#panel .sub-rows [data-act="subOpen"]').first().click(); await sp.waitForSelector('#panel .sub-bar');
  const t1 = await top();
  check('3.1.0 운영 전환(고급): 머리글 이름·[본사로]·자본(본사 현금 작게)·5.0.0 탭 3개(차·그룹·재무)·어두운 톤·강조색', t1.co === '엘리온' && t1.back && t1.cashL === '자본' && t1.hq.startsWith('본사') && t1.tabs === 'car,group,fin' && t1.cls.includes('sub-premium') && t1.accent !== '', JSON.stringify(t1));
  await sp.click('#panel [data-act="subMode"][data-v="direct"]');
  check('3.1.0 직접 운영으로 바꾸기', (await subs())[0].mode === 'direct');
  await three('switch-premium');
  await devHome(sp); await sp.waitForSelector('#panel .sub-work');
  await sp.click('#panel [data-act="subPlanNew"]'); await sp.waitForSelector('#panel .plan-est');
  const pt = await sp.locator('#panel').innerText(), ovt = await sp.locator('#ov').innerText();
  check('3.1.0 자회사 신차 기획: 본사 기획 화면(요약·예상 등급)에 가상 개발팀·예상 평론·개발 기간', ovt.includes('엘리온 신차 기획') && ['가상 개발팀', '예상 평론', '개발 기간', '예상 등급'].every((w) => pt.includes(w)), ovt.slice(0, 60));
  await three('plan');
  await sp.click('#panel [data-act="ptab"][data-v="body"]');
  const bodyN = await sp.locator('#panel [data-act="pick"][data-k="body"]').count();
  check('3.1.0 기획 차체: 그 자회사 영역의 차급만', bodyN > 0 && bodyN <= 6, String(bodyN));
  await sp.click('#panel [data-act="ptab"][data-v="sum"]').catch(() => {}); await sp.locator('#panel [data-act="startDev"]').first().click(); await sp.waitForSelector('#panel .sub-work');
  const o1 = (await subs())[0].orders ?? [];
  check('3.1.0 기획 개발 시작: 개발 중 · n개월 남음', o1.length === 1 && o1[0].how === 'plan' && (await sp.locator('#panel .sub-ord-m').first().innerText()).includes('개월 남음'));
  await sp.click('#panel [data-act="subOrderOpen"]'); await sp.waitForSelector('#sheet .sub-order');
  await sp.click('#sheet [data-act="ordPick"][data-k="character"][data-v="sport"]'); await sp.click('#sheet [data-act="ordPick"][data-k="band"][data-v="high"]');
  const ot = await sp.locator('#sheet .sub-order').innerText();
  check('3.1.0 제작 지시 창: 차급·성격·가격대·이름, 예상 평론·개발비·기간', ['차급', '성격', '가격대', '예상 평론', '개발비', '기간'].every((w) => ot.includes(w)) && (await sp.locator('#sheet [data-info="term:제작 지시"]').count()) === 1);
  await three('order', async () => { await sp.locator('#sheet .sub-order .kpis').scrollIntoViewIfNeeded(); });
  await sp.click('#sheet [data-act="subOrderDo"]');
  check('3.1.0 제작 지시: 개발 중 2대(지시는 스포츠·높게)', ((await subs())[0].orders ?? []).length === 2 && (await subs())[0].orders[1].character === 'sport');
  await sp.locator('#panel .sub-bar [data-act="subOpen"]').first().click(); await sp.waitForTimeout(150);
  const t2 = await top();
  check('3.1.0 다른 자회사로 바로 전환(보급형): 밝은 톤·이름', t2.co === '모아' && t2.cls.includes('sub-value'), JSON.stringify(t2));
  await three('switch-value');
  await devHome(sp); await sp.click('#panel [data-act="subBadgeOpen"]'); await sp.waitForSelector('#sheet .sub-badge');
  const bt = await sp.locator('#sheet .sub-badge').innerText();
  check('3.1.0 배지 창: 본사 판매 중인 차(아리아)·평론 감점·개발비·ⓘ', bt.includes('아리아') && bt.includes('배지 모델로 내기') && (await sp.locator('#sheet [data-info="term:배지 모델"]').count()) === 1);
  await three('badge');
  await sp.locator('#sheet [data-act="subBadgeDo"]:not([disabled])').first().click();
  check('3.1.0 배지: 개발 중(배지)', ((await subs())[1].orders ?? []).some((o) => o.how === 'badge'));
  await sp.click('#tabs button[data-tab="group"]'); await sp.waitForSelector('#panel .sub-target');
  await sp.fill('#sub-tgt', '5000'); await sp.click('#panel [data-act="tgtSet"]');
  check('3.1.0 목표: 판매 5,000대, 진행 막대', (await subs())[1].target?.value === 5000 && (await sp.locator('#panel .sub-target .prog').count()) === 1 && (await sp.locator('#panel [data-info="term:자회사 목표"]').count()) === 1);
  await three('target', async () => { await sp.locator('#panel .sub-target').scrollIntoViewIfNeeded(); });
  await SG(() => { const c = window.__car; for (let i = 0; i < 13; i++) { c.game.state.events.pending.length = 0; c.tick(4); } c.render(); });
  await sp.locator('#panel .sub-bar [data-act="subOpen"]').first().click(); await carTable(sp); await sp.waitForSelector('#panel .sub-car-card');
  const hasPlan = await SG(() => window.__car.game.state.subs[0].models.some((m) => m.car?.how === 'plan'));
  await sp.locator('#panel [data-act="subCarSel"]').first().click();
  const gt = await sp.locator('#panel .sub-car-card').innerText();
  check('3.1.0 1년 뒤 자회사 차고: 직접 기획한 차 출시, 모델 목록·능력치·가격', hasPlan && (await sp.locator('#panel [data-act="subCarSel"]').count()) >= 2 && gt.includes('대당 원가'), gt.slice(0, 80));
  const planBody = await SG(() => window.__car.game.state.subs[0].models.find((m) => m.car?.how === 'plan').body);
  await sp.click(`#panel [data-act="subCarSel"][data-k="${planBody}"]`);
  check('3.1.0 직접 기획한 차: 평론가 4명 점수', (await sp.locator('#panel .sub-car-card').innerText()).includes('평론가 4명'));
  await sp.locator('#panel [data-act="subPrice"]').nth(1).click();
  check('3.1.0 직접 운영 가격 +5%', (await SG((b) => window.__car.game.state.subs[0].models.find((m) => m.body === b).price, planBody)) > 0);
  await three('sub-garage');
  await sp.click('#hqback'); await sp.waitForTimeout(150);
  const t3 = await top();
  check('3.1.0 [본사로]: 본사 이름·현금·5.0.0 탭 7개·강조색 원래대로', t3.co === '직접 운영 시험' && !t3.back && t3.cashL === '현금' && t3.tabs.split(',').length === 7 && !t3.cls.includes('sub-on') && t3.accent === '', JSON.stringify(t3));
  await carTable(sp); await sp.waitForSelector('#panel .sub-cars');
  check('3.1.0 본사 차고: 자회사 차 칸(내 자회사 표시)', (await sp.locator('#panel .sub-cars [data-act="gsubOpen"]').count()) >= 2 && (await sp.locator('#panel .sub-cars').innerText()).includes('내 자회사'));
  await sp.locator('#panel .sub-cars [data-act="gsubOpen"]').first().click(); await sp.waitForSelector('#panel .sub-car-card');
  check('3.1.0 본사 차고에서 자회사 차를 무대에(구분 표시·운영 전환 단추)', (await sp.locator('#ov').innerText()).includes('내 자회사') && (await sp.locator('#panel [data-act="gsubBack"]').count()) === 1);
  await three('hq-garage-sub');
  await sp.click('#panel [data-act="gsubBack"]');
  await sp.click('#tabs button[data-tab="fin"]'); await sp.waitForSelector('#panel .group-card');
  const grt = await sp.locator('#panel .group-card').innerText();
  check('3.1.0 재무 그룹 종합: 본사+자회사 2곳, 회사별 비중·그래프', ['그룹 종합', '본사', '엘리온', '모아', '이익 비중'].every((w) => grt.includes(w)) && (await sp.locator('#panel .group-card svg').count()) === 2, grt.slice(0, 80));
  await three('group', async () => { await sp.locator('#panel .group-card').scrollIntoViewIfNeeded(); });
  await sctx.close(); }

// ---- 3.1.1 패치: 운영 전환 중 머리글(사건 칩·결정 대기·[본사로]) 넘침, 640px 이하 할 일 창과 알림, 이름 변경 Enter, 자기 잠식 작은 수요, 밝은 로고 색 글자 대비.
// CAR_SMOKE_311=폴더 를 주면 화면을 찍는다
{ const pctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const pp = await pctx.newPage(); pp.on('pageerror', (e) => errors.push(String(e))); pp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const PG = (fn, a) => pp.evaluate(fn, a), P3 = process.env.CAR_SMOKE_311 ?? '', pshot = async (n) => { if (P3) await pp.screenshot({ path: `${P3}/${n}.png` }); };
  await pp.goto(URL0); await pp.waitForSelector('#title:not([hidden])');
  await pp.click('[data-act="titleNew"]'); await pp.fill('#t-co', '패치 시험'); await pp.click('[data-act="startNew"]'); await pp.click('#tabs button[data-tab="car"]'); await PG(() => window.__car.setSpeed(0));
  await PG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 5; s.reputation = 150;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2005 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    g.command({ type: 'startProject', name: '아리아', body: 'sedanM', segment: 'family', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 });
    g.command({ type: 'foundSubsidiary', kind: 'premium', name: '엘리온프리미엄', color: '#2b3a55' }); g.command({ type: 'foundSubsidiary', kind: 'value', name: '모아', color: '#d9822b' });
    s.events.pending.length = 0; c.tick(8); s.events.pending.length = 0; c.render(); });
  // 자기 잠식: 개발자 메뉴로 끝낸 차라 수요가 한 달 1대도 안 된다 → "1대 미만"(전에는 "약 0.0대"와 비율 7%)
  await tab5(pp, 'group', 'cotab', 'sub');
  await pp.locator('#panel .sub-rows [data-act="subOpen"]').first().click(); await pp.waitForSelector('#panel .sub-bar');
  await pp.click('#tabs button[data-tab="group"]'); await pp.waitForTimeout(150);
  const canT = await PG(() => [...document.querySelectorAll('#panel table')].find((t) => t.innerText.includes('줄어든 한 달 수요'))?.innerText ?? '');
  check('3.1.1 자기 잠식: 한 달 1대가 안 되면 "1대 미만"("약 0.0대" 없음)', canT.includes('1대 미만') && !canT.includes('0.0대'), canT.replace(/\s+/g, ' ').slice(0, 80));
  // 운영 전환 중 머리글 최악 조건(사건 칩·결정 대기 12건·긴 날짜·조 단위 본사 현금). 사건 칩은 overflow가 보이게라 내용이 칸보다 넓으면 옆 칸 위로 넘친다(잘림으로 셈)
  const subTop = () => PG(() => { const s = window.__car.game.state; s.cash = 340120000; window.__car.render();
    const ch = document.getElementById('evchip'); ch.hidden = false; ch.dataset.v = 'x'; ch.innerHTML = '<span class="ev-n">포티 소형 세단 히트작</span><span class="ev-m"> · 13개월 +1</span>';
    const pd = document.getElementById('pend'); pd.hidden = false; pd.dataset.v = 'x'; pd.innerHTML = '<svg viewBox="0 0 24 24"></svg><b>12</b><span class="pd-t">결정 대기</span>';
    const d = document.getElementById('date'); d.dataset.v = 'x'; d.textContent = '2005년 12월 4주'; document.getElementById('held').hidden = false; document.getElementById('toasts').innerHTML = '';
    const q = ['#date', '#cashpill', '#plchip', '#hqback', '#decbtn', '#speeds', '#held', '#skipbtn', '#menubtn']; // 5.0.0 위쪽 줄
    const R = q.map((x) => { const e = document.querySelector(x); if (!e || e.hidden || getComputedStyle(e).display === 'none' || !e.getBoundingClientRect().width) return null; const r = e.getBoundingClientRect(); return { q: x, l: r.left, r: r.right, t: Math.round(r.top), clip: x === '#evchip' ? e.scrollWidth > e.clientWidth + 2 : x !== '#co' && getComputedStyle(e).overflow !== 'visible' && e.scrollWidth > e.clientWidth + 1 }; }).filter(Boolean);
    const bad = []; R.forEach((a, i) => { if (a.l < 0 || a.r > innerWidth) bad.push(`${a.q} 화면 밖`); if (a.clip) bad.push(`${a.q} 잘림`); const b = R[i + 1]; if (b && b.t === a.t && a.r > b.l + 0.5) bad.push(`${a.q}·${b.q} 겹침`); });
    return bad; });
  const stw = {}; for (const [w, h] of [[800, 1200], [1024, 768], [1366, 1024]]) { await pp.setViewportSize({ width: w, height: h }); await pp.waitForTimeout(200); stw[w] = await subTop(); await pp.waitForTimeout(50); if (P3) await pp.screenshot({ path: `${P3}/subtop-${w}.png`, clip: { x: 0, y: 0, width: w, height: 130 } }); }
  check('3.1.1 운영 전환 머리글 최악 조건(800·1024·1366): 사건 칩 잘림·칸 겹침 없음', Object.values(stw).every((x) => !x.length), JSON.stringify(stw));
  check('3.1.1 고급 머리글: 결정 대기 칩이 머리글 색에 묻히지 않음(본사와 같은 주황)', await PG(() => getComputedStyle(document.getElementById('pend')).backgroundColor === 'rgb(201, 63, 12)'));
  // 밝은 로고 색(보급형 기본 주황)의 자회사 표시: 글자 대비 4.5 이상
  const markCr = await PG(() => { const lum = (c) => { const v = c.match(/\d+/g).slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    return [...document.querySelectorAll('.sub-mark')].map((e) => { const cs = getComputedStyle(e), a = lum(cs.color), b = lum(cs.backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }); });
  check('3.1.1 자회사 표시 글자 대비 4.5 이상(주황 #d9822b 포함)', markCr.length >= 2 && markCr.every((x) => x >= 4.5), markCr.map((x) => x.toFixed(2)).join(','));
  // 이름 변경 창: Enter로 확인(자회사 모델, 본사 차)
  await pp.setViewportSize({ width: 1366, height: 1024 }); await pp.click('#tabs button[data-tab="group"]'); await pp.waitForTimeout(150);
  await PG(() => document.querySelector('#panel [data-act="subRenameOpen"]').click()); await pp.waitForSelector('#sub-rn');
  await pp.fill('#sub-rn', '엔터자회사'); await pp.press('#sub-rn', 'Enter'); await pp.waitForTimeout(150);
  check('3.1.1 자회사 모델 이름 변경 창: Enter로 바뀌고 창이 닫힘', (await PG(() => window.__car.game.state.subs.some((x) => x.models.some((m) => m.name === '엔터자회사')))) && !(await pp.locator('#sheet').isVisible()));
  await pp.click('#hqback'); await carTable(pp); await pp.waitForTimeout(150);
  if (await pp.locator('[data-act="gopen"]').count()) await pp.locator('[data-act="gopen"]').first().click();
  await pp.locator('[data-act="renameOpen"]').first().click(); await pp.waitForSelector('#rn-name');
  await pp.fill('#rn-name', '엔터시험'); await pp.press('#rn-name', 'Enter'); await pp.waitForTimeout(150);
  check('3.1.1 본사 차 이름 변경 창: Enter로 바뀌고 창이 닫힘', (await PG(() => window.__car.game.state.nameplates.some((n) => n.name === '엔터시험'))) && !(await pp.locator('#sheet').isVisible()));
  // 640px 이하: 할 일 창이 화면 전체면 보통 알림은 숨고(창을 가리지 않음) 경고 알림만 아래쪽에
  const dt = {}; for (const [w, h] of [[640, 900], [400, 800]]) {
    await pp.setViewportSize({ width: w, height: h }); await pp.waitForTimeout(200); await menuItem(pp, '#todobtn'); await pp.waitForTimeout(300);
    await PG(() => { for (let i = 0; i < 3; i++) window.__car.toast(`알림 시험 ${i + 1}: 경쟁사 신차가 나왔습니다.`); }); await pp.waitForTimeout(200);
    dt[w] = await PG(() => { const d = document.getElementById('drawer').getBoundingClientRect(); return [...document.querySelectorAll('#toasts .toast')].filter((t) => getComputedStyle(t).display !== 'none').map((t) => { const r = t.getBoundingClientRect(); return Math.max(0, Math.min(r.right, d.right) - Math.max(r.left, d.left)) * Math.max(0, Math.min(r.bottom, d.bottom) - Math.max(r.top, d.top)); }).reduce((a, b) => a + b, 0); });
    await pshot(`drawer-toast-${w}`); await PG(() => { document.getElementById('toasts').innerHTML = ''; }); await pp.keyboard.press('Escape'); await pp.waitForTimeout(150); }
  check('3.1.1 640·400px 할 일 창: 보통 알림이 창을 가리지 않음', Object.values(dt).every((x) => x === 0), JSON.stringify(dt));
  await pctx.close(); }

// ---- 3.5.0 경쟁 2부: 2005년 상태(본사 5등급·현금 넉넉·중형 세단 판매)를 만들고 재무 › 경쟁사 카드(관계 표시) → 경쟁사 창(제휴·인재·인수) → 기술 제휴·기술 사 오기 →
// 경쟁사 인재 영입 → 대응 신차 예고 알림 → 가격 전쟁·이직 제안 결정 창 → 시상식(기록 탭·차고 수상 표시) → 자회사 상장 → 인수 창 → 인수 뒤 자회사 목록.
// CAR_SMOKE_350=폴더 를 주면 1366×1024·1024×768·800×1200 화면을 그 폴더에 찍는다
{ const rctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const rp = await rctx.newPage(); rp.on('pageerror', (e) => errors.push(String(e))); rp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const RG = (fn, a) => rp.evaluate(fn, a), R3 = process.env.CAR_SMOKE_350 ?? '';
  const SIZES = [[1366, 1024], [1024, 768], [800, 1200]];
  const three = async (n, fn) => { for (const [w, h] of SIZES) { await rp.setViewportSize({ width: w, height: h }); await RG(() => { document.getElementById('toasts').innerHTML = ''; }); await rp.waitForTimeout(250); if (fn) await fn(); const o = await overflowOf(rp); check(`3.5.0 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (R3) await rp.screenshot({ path: `${R3}/${n}-${w}x${h}.png` }); } await rp.setViewportSize({ width: 1366, height: 1024 }); };
  const yes = async () => { await rp.waitForSelector('#ask:not([hidden])'); await rp.click('#ask-yes'); };
  const sheetTop = () => RG(() => { document.querySelector('#sheet .sheet-body, #sheet')?.scrollTo?.(0, 0); });
  await rp.goto(URL0); await rp.waitForSelector('#title:not([hidden])');
  await rp.click('[data-act="titleNew"]'); await rp.fill('#t-co', '경쟁 시험'); await rp.click('[data-act="startNew"]'); await rp.click('#tabs button[data-tab="car"]'); await RG(() => window.__car.setSpeed(0));
  const gid = await RG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 5; s.reputation = 150;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2003 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    g.command({ type: 'startProject', name: '아리아', body: 'sedanM', segment: 'family', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 });
    s.events.pending.length = 0; c.render(); return s.nameplates[0].generations[0].id; });
  await RG(() => window.__car.tick(4)); await RG(() => { window.__car.game.state.events.pending.length = 0; window.__car.render(); });
  check('3.5.0 경쟁사 인재 후보: 본사 3등급 이상이면 월초에 2명', (await RG(() => window.__car.game.state.rivalry.talent.length)) === 2);
  // 대응 신차 예고(알림·관계 표시): 예고를 직접 넣고 알림을 띄운다
  await RG(() => { const s = window.__car.game.state, m = Math.floor(s.week / 4); s.rivalry.counters.push({ id: s.nextId++, rivalId: 'toyoda', body: 'sedanM', announced: m, launch: m + 17, target: '아리아' });
    const t = `[대응 신차 예고] 도요다, 중형 세단 차급에 「아리아」를 겨냥한 신차를 준비 중. 약 17개월 뒤(${2005 + Math.floor((m + 17 - 420) / 12)}년 ${((m + 17) % 12) + 1}월) 출시 예정.`;
    s.events.news.push({ week: s.week, text: t, category: 'rival', topic: 'rival' }); window.__car.render(); });
  await toRivals(rp); await rp.waitForSelector('#panel .rivals');
  const finR = await rp.locator('#panel .rivals').innerText();
  check('3.5.0 재무 경쟁사 카드: 대응 신차 준비 중 표시', finR.includes('대응 신차 준비 중'), finR.replace(/\s+/g, ' ').slice(0, 120));
  await three('counter-toast', async () => { await RG(() => window.__car.toast(window.__car.game.state.events.news.at(-1).text, 'alert', '경쟁사 신차·동향')); await rp.waitForTimeout(150); });
  // 경쟁사 창
  await rp.locator('#panel [data-act="rivalOpen"][data-v="toyoda"]').click(); await rp.waitForSelector('#panel .rv-acts');
  const rv0 = await rp.locator('#panel .rv-sheet').innerText();
  check('3.5.0 경쟁사 창: 지금 관계·기술 제휴·경쟁사 인재·인수 단추와 ⓘ', ['대응 신차 준비 중', '기술 제휴', '경쟁사 인재', '인수', '앞선 분야', '계약금'].every((t) => rv0.includes(t)) && (await rp.locator('#panel [data-act="allyRival"]').count()) === 1 && (await rp.locator('#panel [data-act="acqOpen"]').count()) === 1 && (await rp.locator('#panel .rv-sheet [data-info="term:기술 제휴"]').count()) === 1, rv0.replace(/\s+/g, ' ').slice(0, 160) + ` ⓘ ${await rp.locator('#panel .rv-sheet [data-info="term:기술 제휴"]').count()} 제휴 ${await rp.locator('#panel [data-act="allyRival"]').count()} 인수 ${await rp.locator('#panel [data-act="acqOpen"]').count()}`);
  await three('rival-sheet');
  // 기술 제휴 → 기술 사 오기(도요다: 친환경). 친환경 기술 하나를 연구 전으로 돌려 둔다
  await RG(() => { const s = window.__car.game.state, T = window.__car.Q.researchInfo(s).fields.find((f) => f.id === 'eco').techs.filter((t) => t.status === 'done' && t.year <= 2005); const leaf = T.find((t) => !window.__car.Q.researchInfo(s).fields.flatMap((f) => f.techs).some((u) => u.pre.some((q) => q.id === t.id) && u.status === 'done')) ?? T[0]; s.research.done = s.research.done.filter((x) => x !== leaf.id); window.__car.render(); });
  await rp.locator('#panel [data-act="allyRival"]').click(); await rp.waitForSelector('#panel [data-act="endAlly"]');
  check('3.5.0 기술 제휴: 맺으면 제휴 중·남은 개월·사 올 기술 목록', (await RG(() => window.__car.game.state.rivalry.alliances.length)) === 1 && (await rp.locator('#panel .rv-now').innerText()).includes('기술 제휴 중') && (await rp.locator('#panel [data-act="buyTech"]').count()) >= 1);
  await three('alliance');
  const tid = await rp.locator('#panel [data-act="buyTech"]').first().getAttribute('data-t');
  await rp.locator('#panel [data-act="buyTech"]').first().click(); await rp.waitForTimeout(200);
  check('3.5.0 기술 사 오기: 연구 완료로 처리', await RG((id) => window.__car.game.state.research.done.includes(id), tid));
  // 경쟁사 인재 영입(후보가 있는 회사의 창에서)
  const trid = await RG(() => window.__car.game.state.rivalry.talent[0].rivalId);
  await RG(() => { const s = window.__car.game.state; while (s.staff.length >= window.__car.Q.staffCap(s)) s.staff.pop(); });
  await RG((id) => { document.querySelector('[data-act="closeSheet"]')?.click(); }, 0);
  await rp.locator(`#panel [data-act="rivalOpen"][data-v="${trid}"]`).click(); await rp.waitForSelector('#panel .rv-tal');
  await three('talent', async () => { await RG(() => document.querySelector('#panel .rv-tal')?.scrollIntoView({ block: 'center' })); });
  const nStaff = await RG(() => window.__car.game.state.staff.length);
  await rp.locator('#panel [data-act="talentHire"]').first().click(); await rp.waitForTimeout(200);
  check('3.5.0 경쟁사 인재 영입: 직원 +1, 그 경쟁사 인재 유출 표시', (await RG(() => window.__car.game.state.staff.length)) === nStaff + 1 && (await rp.locator('#panel .rv-now').innerText()).includes('인재 유출'));
  await RG(() => document.querySelector('[data-act="closeSheet"]')?.click());
  // 가격 전쟁·이직 제안 결정 창
  await RG(() => { const s = window.__car.game.state, m = Math.floor(s.week / 4), id = s.nextId++;
    s.rivalry.wars.push({ id, rivalId: 'hyundae', body: 'sedanM', from: m, until: m + 5, cut: 0.06, follow: null });
    s.events.pending.push({ id: s.nextId++, eventId: 'priceWar', text: '현다이가 중형 세단 차급 가격을 6% 내렸습니다(5개월, 2005년 12월까지). 이 차급의 내 차는 「아리아」입니다. 따라 내릴까요?', week: s.week, deadline: s.week + 4, genId: null, fx: null,
      rv: { rivalId: 'hyundae', war: id, results: ['5개월 동안 「아리아」 가격을 6% 내리고, 끝나면 원래대로 돌립니다. 판매는 지키지만 한 달 매출이 약 12.3억원 줄어듭니다.', '가격은 그대로 둡니다. 그 기간 이 차급의 내 차 판매가 약 4% 줄어듭니다.'] } });
    const x = s.staff[0]; s.events.pending.push({ id: s.nextId++, eventId: 'poach', text: `도요다가 ${x.name}(디자이너, 능력 ${x.ability})에게 이직을 제안했습니다. 회사에 남을 생각이지만 처우를 기대하고 있습니다.`, week: s.week, deadline: s.week + 4, genId: null, fx: null,
      rv: { rivalId: 'toyoda', staffId: x.id, raise: 90, results: [`월급을 90만원 올립니다(지금 900만원). ${x.name}의 능력이 2 오르고 컨디션이 좋아집니다.`, '제안을 거절하고 남습니다. 달라지는 것은 없습니다.'] } });
    window.__car.render(); });
  await menuItem(rp, '#pend'); await rp.waitForSelector('#panel .choice-sheet');
  const wt = await rp.locator('#panel .choice-sheet').innerText();
  check('3.5.0 가격 전쟁 결정 창: 따라 내린다·버틴다와 결과 문장', wt.includes('가격 전쟁') && wt.includes('따라 내린다') && wt.includes('버틴다') && wt.includes('판매가 약 4% 줄어듭니다'), wt.replace(/\s+/g, ' ').slice(0, 120));
  await three('pricewar');
  await rp.locator('#panel [data-act="resolveEv"][data-v="0"]').click(); await rp.waitForSelector('#panel .choice-sheet');
  check('3.5.0 따라 내리면 그 기간 그 차급 가격 배수 0.94', await RG(() => window.__car.game.state.rivalry.wars.at(-1).follow === true && Math.abs(window.__car.Q.warPriceMult(window.__car.game.state, 'sedanM', Math.floor(window.__car.game.state.week / 4)) - 0.94) < 1e-9));
  const pt = await rp.locator('#panel .choice-sheet').innerText();
  check('3.5.0 이직 제안 결정 창: 붙잡는다·그대로 둔다', pt.includes('이직 제안') && pt.includes('연봉을 올려 붙잡는다') && pt.includes('그대로 둔다') && pt.includes('남습니다'), pt.replace(/\s+/g, ' ').slice(0, 120));
  await three('poach');
  const pay0 = await RG(() => window.__car.game.state.staff[0].pay ?? 0);
  await rp.locator('#panel [data-act="resolveEv"][data-v="0"]').click(); await rp.waitForTimeout(200);
  check('3.5.0 붙잡으면 월급 가산 +90만원, 직원 그대로', (await RG(() => window.__car.game.state.staff[0].pay)) === pay0 + 90);
  // 시상식: 기록 탭과 차고 수상 표시
  await RG((gid) => { const s = window.__car.game.state, g = s.nameplates[0].generations[0]; g.awards = ['2005년 올해의 차', '2005년 올해의 패밀리카']; g.awardUntil = Math.floor(s.week / 4) + 12;
    const A = (cat, name, who, company, car, body) => ({ year: 2005, cat, name, who, company, car, body, score: 7.5 });
    const R = (id, body) => window.__car.Q.rivalModelsIn(s, body).find((v) => v.rivalId === id).name; // 그 회사·그 차급의 실제 모델 이름
    s.rivalry.awards.push(A('overall', '올해의 차', 'mine', s.companyName, '아리아', 'sedanM'), A('small', '올해의 소형차', 'rival', '현다이', R('hyundae', 'hatch'), 'hatch'), A('family', '올해의 패밀리카', 'mine', s.companyName, '아리아', 'sedanM'), A('fun', '올해의 스포츠·레저', 'rival', '포티', R('porty', 'pickup'), 'pickup'), A('tech', '올해의 기술상', 'rival', '도요다', R('toyoda', 'sedanS'), 'sedanS'), A('design', '올해의 디자인상', 'rival', '현다이', R('hyundae', 'coupe'), 'coupe'));
    window.__car.render(); }, gid);
  await tab5(rp, 'market', 'rectab', 'awards'); await rp.waitForSelector('#panel .aw-card');
  const awT = await rp.locator('#panel .aw-card').innerText();
  check('3.5.0 기록 › 시상식: 연도·부문·수상 차·내 차 표시', awT.includes('2005년') && awT.includes('올해의 차') && awT.includes('아리아') && awT.includes('내 차') && (await rp.locator('#panel .aw-t tr.aw-own').count()) === 2, awT.replace(/\s+/g, ' ').slice(0, 120));
  await three('awards');
  await toGarage(rp); await rp.waitForTimeout(200);
  check('3.5.0 차고: 수상 표시(수상 2)와 수상 줄', (await rp.locator('.aw-chip').first().innerText()).includes('수상 2') && (await rp.locator('.aw-line').first().innerText()).includes('2005년 올해의 차'));
  // 자회사 상장: 3년 전 설립·흑자인 보급형 브랜드
  await RG(() => { const c = window.__car, g = c.game, s = g.state; g.command({ type: 'foundSubsidiary', kind: 'value' }); const sub = s.subs.at(-1), m = Math.floor(s.week / 4);
    sub.founded = m - 40; for (let i = 12; i >= 1; i--) sub.months.push({ month: m - i, sold: 3000, demand: 3000, revenue: 6e6, profit: 4e5, dividend: 2e5 }); c.render(); });
  await tab5(rp, 'group', 'cotab', 'sub'); await rp.locator('#panel [data-act="subSel"]').first().click(); await rp.waitForSelector('#panel .sub-ipo');
  const ipT = await rp.locator('#panel .sub-ipo').innerText();
  check('3.5.0 상장 카드: 판 지분·평가액·20/30/49% 단추', ipT.includes('평가액') && (await rp.locator('#panel .sub-ipo [data-act="listSub"]').count()) === 3 && !(await rp.locator('#panel .sub-ipo [data-act="listSub"][data-v="20"]').isDisabled()), ipT.replace(/\s+/g, ' ').slice(0, 100));
  await three('ipo', async () => { await RG(() => document.querySelector('#panel .sub-ipo')?.scrollIntoView({ block: 'center' })); });
  const cashI = await RG(() => window.__car.game.state.cash);
  await rp.locator('#panel .sub-ipo [data-act="listSub"][data-v="20"]').click(); await yes(); await rp.waitForTimeout(200);
  check('3.5.0 상장: 20% 팔고 현금이 늘어남, 다음 단추는 30·49%', (await RG(() => window.__car.game.state.subs.at(-1).listed)) === 0.2 && (await RG(() => window.__car.game.state.cash)) > cashI && (await rp.locator('#panel .sub-ipo [data-act="listSub"]').count()) === 2);
  // 인수 창 → 인수 → 자회사 목록
  await toRivals(rp); await rp.locator('#panel [data-act="rivalOpen"][data-v="porty"]').click(); await rp.waitForSelector('#panel [data-act="acqOpen"]');
  await rp.locator('#panel [data-act="acqOpen"]').click(); await rp.waitForSelector('#sheet .acq-sheet');
  const aqT = await rp.locator('#sheet .acq-sheet').innerText();
  check('3.5.0 인수 창: 평가액·웃돈·인수 값·예상 실적(월 판매·연 매출·연 이익·연 배당)', ['평가액', '웃돈', '인수 값', '월 판매', '연 매출', '연 이익', '연 배당'].every((t) => aqT.includes(t)) && !(await rp.locator('#sheet [data-act="acqDo"]').isDisabled()), aqT.replace(/\s+/g, ' ').slice(0, 160));
  await three('acquire');
  await rp.locator('#sheet [data-act="acqDo"]').click(); await yes(); await rp.waitForTimeout(300);
  check('3.5.0 인수: 포티가 경쟁사에서 빠지고 인수 브랜드 자회사(이름·색·모델)가 됨', await RG(() => { const s = window.__car.game.state, x = s.subs.find((y) => y.from === 'porty'); return s.rivalry.out.includes('porty') && !!x && x.kind === 'acquired' && x.name === '포티' && x.models.length >= 10; }));
  await tab5(rp, 'group', 'cotab', 'sub'); await RG(() => document.querySelector('#panel [data-act="subBack"]')?.click()); await rp.waitForSelector('#panel .sub-rows');
  const slT = await rp.locator('#panel .sub-list').innerText();
  check('3.5.0 인수 뒤 자회사 목록: 포티 · 인수 브랜드 · 모델 수', slT.includes('포티') && slT.includes('인수 브랜드'), slT.replace(/\s+/g, ' ').slice(0, 160));
  await three('subs-after');
  await toRivals(rp); await rp.waitForSelector('#panel .rivals');
  check('3.5.0 재무 경쟁사 카드: 인수한 회사는 "인수함", 라인업 단추 없음', (await rp.locator('#panel .rivals .rv-out').innerText()).includes('인수함') && (await rp.locator('#panel [data-act="rivalOpen"][data-v="porty"]').count()) === 0);
  // 마지막 한 곳 금지: 현다이도 사고(4.0.0 나머지 경쟁사는 판 것으로 둔다) 도요다만 남으면 막힌다
  await RG(() => { const s = window.__car.game.state; window.__car.game.command({ type: 'acquireRival', rivalId: 'hyundae' }); for (const r of s.rivals) if (r.id !== 'toyoda' && !s.rivalry.out.includes(r.id)) s.rivalry.out.push(r.id); window.__car.render(); });
  await rp.locator('#panel [data-act="rivalOpen"][data-v="toyoda"]').click(); await rp.waitForSelector('#panel [data-act="acqOpen"]'); await rp.locator('#panel [data-act="acqOpen"]').click(); await rp.waitForSelector('#sheet .acq-sheet');
  check('3.5.0 마지막 남은 경쟁사: 인수 단추가 막히고 독점 규제 문구', (await rp.locator('#sheet [data-act="acqDo"]').isDisabled()) && (await rp.locator('#sheet .acq-sheet').innerText()).includes('독점 규제'));
  await three('acquire-last');
  await RG(() => window.__car.tick(8)); // 인수 브랜드 두 곳이 돌아가는 판에서 두 달
  check('3.5.0 인수 브랜드가 팔린다(두 달 뒤 판매 > 0)', await RG(() => window.__car.game.state.subs.filter((x) => x.kind === 'acquired').every((x) => (x.months.at(-1)?.sold ?? 0) > 0)));
  // ---- 3.6.0 안정화: 인수 창의 본사 판매 변화, 자회사 차 수상 표시, 인수 브랜드 매각 뒤 경쟁사 복귀, 알림 묶기(CAR_SMOKE_360=폴더면 640·800·1366 캡처) ----
  { const P6 = process.env.CAR_SMOKE_360 ?? '';
    await RG(() => { const b = document.querySelector('#sheet [data-act="closeSheet"]'); if (b) b.click(); else document.getElementById('sheet').hidden = true; window.__car.render(); });
    await RG(() => window.__car.game.command({ type: 'sellSubsidiary', subId: window.__car.game.state.subs.find((x) => x.from === 'hyundae').id }));
    await RG(() => window.__car.render()); await toRivals(rp); await rp.waitForSelector('#panel .rivals');
    check('3.6.0 인수 브랜드 매각: 현다이가 경쟁사로 돌아와 라인업 단추가 다시 보임', (await rp.locator('#panel [data-act="rivalOpen"][data-v="hyundae"]').count()) === 1 && !(await RG(() => window.__car.game.state.rivalry.out.includes('hyundae'))));
    await rp.locator('#panel [data-act="rivalOpen"][data-v="toyoda"]').click(); await rp.waitForSelector('#panel [data-act="acqOpen"]'); await rp.locator('#panel [data-act="acqOpen"]').click(); await rp.waitForSelector('#sheet .acq-sheet');
    const a6 = await rp.locator('#sheet .acq-sheet').innerText();
    check('3.6.0 인수 창: 본사 판매 변화 예상(월 판매 전 → 후, 본사 연 이익 변화)과 설명', ['본사 판매 변화 예상', '본사 월 판매', '본사 연 이익 변화', '본사 판매가 늘어납니다'].every((x) => a6.includes(x)) && !/NaN|undefined/.test(a6), a6.replace(/\s+/g, ' ').slice(-220));
    if (P6) for (const [w, h] of [[640, 900], [1366, 1024]]) { await rp.setViewportSize({ width: w, height: h }); await rp.waitForTimeout(250); await RG(() => document.querySelector('#sheet .acq-sheet .lbl:nth-of-type(2)')?.scrollIntoView({ block: 'center' })); await rp.screenshot({ path: `${P6}/after-acquire-hq-${w}x${h}.png` }); }
    await rp.setViewportSize({ width: 1366, height: 1024 }); await RG(() => document.querySelector('#sheet [data-act="closeSheet"], #sheet [data-act="rivalOpen"]') && (document.getElementById('sheet').hidden = true));
    await RG(() => { const s = window.__car.game.state, md = s.subs.find((x) => x.kind === 'acquired').models[0]; md.awards = ['2005년 올해의 디자인상']; md.awardUntil = Math.floor(s.week / 4) + 5; window.__car.render(); });
    await carTable(rp); await rp.waitForSelector('#panel .sub-cars');
    check('3.6.0 본사 차고의 자회사 차: 수상 표시', (await rp.locator('#panel .sub-cars .aw-s').count()) === 1);
    await rp.locator('#panel .sub-cars [data-act="gsubOpen"]:has(.aw-s)').click(); await rp.waitForSelector('#panel .sub-car-card');
    check('3.6.0 자회사 차고 카드: 수상 줄(부문·남은 개월)', (await rp.locator('#panel .sub-car-card .aw-line').innerText()).includes('2005년 올해의 디자인상') && (await rp.locator('#panel .gsec .aw-s').count()) === 1);
    if (P6) for (const [w, h] of [[640, 900], [1366, 1024]]) { await rp.setViewportSize({ width: w, height: h }); await rp.waitForTimeout(300); await RG(() => document.querySelector('#panel .sub-car-card .aw-line')?.scrollIntoView({ block: 'center' })); await rp.screenshot({ path: `${P6}/after-subaward-${w}x${h}.png` }); }
    await rp.setViewportSize({ width: 1366, height: 1024 });
    await tab5(rp, 'group', 'cotab', 'sub'); await RG(() => document.querySelector('#panel [data-act="subBack"]')?.click());
    await RG(() => { const s = window.__car.game.state; document.querySelector(`#panel [data-act="subSel"][data-id="${s.subs.find((x) => x.kind === 'acquired').id}"], #panel [data-act="subOpenD"][data-id="${s.subs.find((x) => x.kind === 'acquired').id}"]`)?.click(); });
    await rp.waitForTimeout(300);
    const lu = await rp.locator('#panel .sub-lineup').count() ? await rp.locator('#panel .sub-lineup .aw-s').count() : -1;
    check('3.6.0 자회사 라인업: 수상 표시', lu === 1, String(lu));
    // 알림 묶기: 같은 화면 갱신에 경쟁사 뉴스 3건 + 현금 경고 1건 → 경쟁사 묶음 1개(3건) + 경고 따로
    const nw = (t) => ({ kind: 'news', text: t, category: 'rival', topic: 'rival' });
    for (const [w, h] of [[640, 900], [800, 1200], [1366, 1024]]) {
      await rp.setViewportSize({ width: w, height: h }); await carTable(rp); await RG(() => { document.getElementById('toasts').innerHTML = ''; }); await rp.waitForTimeout(200);
      await RG((l) => window.__car.events(l), [nw('도요다, 카리나 5세대 출시. 중형 세단, 추정 평론 6.8.'), nw('포티, 머스탱 3세대 출시. 스포츠카, 추정 평론 7.1.'), nw('현다이, 소나투 4세대 출시. 중형 세단, 추정 평론 6.5.'), { kind: 'cashWarning', text: '현금이 1개월째 마이너스입니다.' }]);
      await rp.waitForTimeout(400);
      const tt = await RG(() => [...document.querySelectorAll('#toasts .toast:not(.out)')].map((x) => x.innerText.replace(/\s+/g, ' ')));
      check(`3.6.0 알림 묶기 ${w}×${h}: 경쟁사 3건이 한 알림, 경고는 따로`, tt.filter((x) => x.includes('경쟁사 신차·동향 3건')).length === 1 && tt.filter((x) => x.includes('카리나') || x.includes('머스탱')).length === 1 && tt.some((x) => x.includes('현금 경고')) && tt.length === 2, tt.join(' | ').slice(0, 200));
      if (P6) await rp.screenshot({ path: `${P6}/after-toastgroup-${w}x${h}.png` });
    }
    await RG((l) => window.__car.events(l, 3), [nw('도요다, 크라운 6세대 출시. 대형 세단, 추정 평론 7.0.')]); await rp.waitForTimeout(300);
    check('3.6.0 알림 묶기: 빠른 배속으로 이어 온 같은 유형도 떠 있는 묶음에 더해짐(6건, 경쟁사 알림 1개)', await RG(() => [...document.querySelectorAll('#toasts .toast:not(.out)')].filter((x) => x.dataset.cat === 'rival').length === 1 && document.querySelector('#toasts .toast[data-grp]').innerText.includes('6건')));
    await rp.locator('#toasts .toast[data-grp] .open').click(); await rp.waitForSelector('#drawer:not([hidden]) .note-list');
    const nl6 = await rp.locator('#drawer .note-list').innerText();
    check('3.6.0 묶은 알림 [펼쳐 보기]: 경쟁사 유형으로 거른 지난 알림 기록(항목마다 한 줄)', nl6.includes('카리나') && nl6.includes('머스탱') && nl6.includes('크라운') && !nl6.includes('현금이 1개월째') && (await rp.locator('#drawer .note-cats [aria-pressed="true"]').innerText()).includes('경쟁사'), nl6.replace(/\s+/g, ' ').slice(0, 160));
    await RG(() => document.querySelector('[data-act="drawerClose"]')?.click());
    await rp.setViewportSize({ width: 1366, height: 1024 });
  }
  await rctx.close(); }

// ---- 3.7.0 결정 자동 승인: 설정 › 결정, 결정 창의 체크, 자동 승인 알림(묶음 포함), 최근 자동 승인 내역(CAR_SMOKE_370=폴더면 640·800·1366 캡처) ----
{ const actx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const ap = await actx.newPage(); ap.on('pageerror', (e) => errors.push(String(e))); ap.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const AG = (fn, a) => ap.evaluate(fn, a), P7 = process.env.CAR_SMOKE_370 ?? '';
  const SZ7 = [[640, 900], [800, 1200], [1366, 1024]];
  const shots = async (n, fn) => { for (const [w, h] of SZ7) { await ap.setViewportSize({ width: w, height: h }); await ap.waitForTimeout(250); if (fn) await fn(); const o = await overflowOf(ap); check(`3.7.0 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (P7) await ap.screenshot({ path: `${P7}/${n}-${w}x${h}.png` }); } await ap.setViewportSize({ width: 1366, height: 1024 }); };
  await ap.goto(URL0); await ap.waitForSelector('#title:not([hidden])');
  await ap.click('[data-act="titleNew"]'); await ap.fill('#t-co', '자동 승인 시험'); await ap.click('[data-act="startNew"]'); await ap.click('#tabs button[data-tab="car"]'); await AG(() => window.__car.setSpeed(0));
  await AG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2005 - 1970) * 48; s.cash = 1e9; s.hqLevel = 4;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2003 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    g.command({ type: 'startProject', name: '아리아', body: 'sedanM', segment: 'family', powertrain: 'gasoline', tier: 1, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
    const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 });
    s.events.pending.length = 0; c.render(); });
  // 설정 › 결정
  await openSave(ap); await ap.click('#sheet [data-act="settings"]'); await ap.click('#sheet [data-act="setTab"][data-v="decide"]'); await ap.waitForSelector('#sheet .auto-kinds');
  const st7 = await ap.locator('#sheet .set-body').innerText();
  check('3.7.0 설정 › 결정: 종류 10개(모두 꺼짐)·모두 켜기/끄기·안전선(켜짐)·ⓘ', (await ap.locator('#sheet [data-act="autoKind"]').count()) === 10 && (await ap.locator('#sheet [data-act="autoKind"][aria-pressed="true"]').count()) === 0
    && (await ap.locator('#sheet [data-act="autoAll"]').count()) === 2 && (await ap.locator('#sheet [data-act="autoGuard"]').getAttribute('aria-pressed')) === 'true' && (await ap.locator('#sheet [data-info="term:결정 자동 승인"]').count()) === 1
    && ['노조 파업', '가격 전쟁', '임원 위임과 같은 규칙', '기본 선택', '큰돈이 드는 결정은 묻기', '10%'].every((x) => st7.includes(x)), st7.replace(/\s+/g, ' ').slice(0, 200));
  await ap.click('#sheet [data-act="autoAll"][data-v="1"]');
  check('3.7.0 [모두 켜기]: 판 상태에 10종 모두 켜짐', (await AG(() => window.__car.game.state.autoDecide.on.length)) === 10 && (await ap.locator('#sheet [data-act="autoKind"][aria-pressed="true"]').count()) === 10);
  await ap.click('#sheet [data-act="autoGuard"]');
  check('3.7.0 안전선 끄기 → 판 상태 guard false', (await AG(() => window.__car.game.state.autoDecide.guard)) === false);
  await ap.click('#sheet [data-act="autoGuard"]'); await ap.click('#sheet [data-act="autoAll"][data-v="0"]');
  check('3.7.0 [모두 끄기]: 모두 꺼짐, 안전선 다시 켜짐', (await AG(() => window.__car.game.state.autoDecide.on.length)) === 0 && (await AG(() => window.__car.game.state.autoDecide.guard)) === undefined);
  await ap.click('#sheet [data-act="autoKind"][data-v="strike"]');
  check('3.7.0 종류 하나 켜기(노조 파업)', JSON.stringify(await AG(() => window.__car.game.state.autoDecide.on)) === '["strike"]');
  await shots('settings', () => AG(() => document.querySelector('#sheet .set-tabs')?.scrollIntoView({ block: 'start' })));
  // 3.7.1 종류마다 자동으로 고를 답(CAR_SMOKE_371=폴더면 640·800·1366 캡처)
  const P71 = process.env.CAR_SMOKE_371 ?? '';
  const shots71 = async (n, fn) => { for (const [w, h] of SZ7) { await ap.setViewportSize({ width: w, height: h }); await ap.waitForTimeout(250); if (fn) await fn(); const o = await overflowOf(ap); check(`3.7.1 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (P71) await ap.screenshot({ path: `${P71}/${n}-${w}x${h}.png` }); } await ap.setViewportSize({ width: 1366, height: 1024 }); };
  const ms = '#sheet [data-act="autoPick"][data-k="motorshow"]';
  check('3.7.1 설정 › 결정: 종류마다 답 고르기(선택지 수 + 규칙 종류는 "규칙대로"), 처음 값에 "기본 선택"', (await ap.locator('#sheet .auto-pick').count()) === 10 && (await ap.locator(ms).count()) === 2
    && (await ap.locator('#sheet [data-act="autoPick"][data-v="rule"]').count()) === 2 && (await ap.locator(`${ms}[aria-pressed="true"]`).innerText()).includes('이번엔 불참') && (await ap.locator(`${ms}[aria-pressed="true"]`).innerText()).includes('기본 선택')
    && (await ap.locator('#sheet [data-act="autoPick"][data-k="poach"][aria-pressed="true"]').innerText()).includes('규칙대로'));
  await ap.click(`${ms}[data-v="0"]`);
  const mrow = await ap.locator('#sheet .auto-kind:has([data-v="motorshow"]) .toggle').innerText();
  check('3.7.1 모터쇼 초청 답을 "콘셉트카 출품"으로 → 판 상태 pick, 줄에 한 줄 효과, 켜기·끄기는 그대로', JSON.stringify(await AG(() => window.__car.game.state.autoDecide)) === '{"on":["strike"],"pick":{"motorshow":0}}'
    && mrow.includes('콘셉트카 출품') && mrow.includes('평판이 3 오릅니다') && !mrow.includes('기본 선택'), mrow.replace(/\s+/g, ' ').slice(0, 160));
  await ap.click('#sheet [data-act="autoAll"][data-v="1"]');
  check('3.7.1 [모두 켜기]는 정한 답을 건드리지 않는다', JSON.stringify(await AG(() => window.__car.game.state.autoDecide.pick)) === '{"motorshow":0}' && (await AG(() => window.__car.game.state.autoDecide.on.length)) === 10);
  await ap.click('#sheet [data-act="autoAll"][data-v="0"]'); await ap.click('#sheet [data-act="autoKind"][data-v="strike"]');
  await shots71('settings-pick', () => AG(() => document.querySelector('#sheet .auto-kind:has([data-v="motorshow"])')?.scrollIntoView({ block: 'center' })));
  await ap.click(`${ms}[data-v="1"]`);
  check('3.7.1 처음 값(이번엔 불참)으로 되돌리면 pick 칸이 지워진다', JSON.stringify(await AG(() => window.__car.game.state.autoDecide)) === '{"on":["strike"]}');
  // 결정 창의 체크
  await AG(() => { const c = window.__car, s = c.game.state; document.getElementById('sheet').hidden = true; const id = s.nextId++;
    s.events.pending.push({ id, eventId: 'motorshow', text: '국제 모터쇼에서 콘셉트카 출품을 요청해 왔습니다.', week: s.week, deadline: s.week + 4, genId: null, fx: null });
    c.events([{ kind: 'choice', text: '[모터쇼 초청] 국제 모터쇼에서 콘셉트카 출품을 요청해 왔습니다.', id, category: 'choice' }]); });
  if (await ap.locator('#decbtn').isVisible()) await ap.click('#decbtn'); else await ap.click('#tabs button[data-tab="today"]');
  await ap.waitForSelector('#panel .choice-sheet');
  check('3.7.1 결정 창: "이 종류(모터쇼 초청)는 앞으로 지금 고르는 답으로 자동 승인" 체크', (await ap.locator('#panel .auto-chk input[data-ad="motorshow"]').count()) === 1 && (await ap.locator('#panel .auto-chk').innerText()).includes('모터쇼 초청') && (await ap.locator('#panel .auto-chk').innerText()).includes('지금 고르는 답으로'));
  await shots('choice', () => AG(() => document.querySelector('#panel .auto-chk')?.scrollIntoView({ block: 'center' })));
  await ap.locator('#panel .auto-chk input').check();
  await shots71('choice-check', () => AG(() => document.querySelector('#panel .auto-chk')?.scrollIntoView({ block: 'center' })));
  check('3.7.1 체크만으로는 아직 켜지지 않는다(답을 고를 때 저장)', !(await AG(() => window.__car.game.state.autoDecide.on.includes('motorshow'))) && (await ap.locator('#panel .choice-sheet').count()) === 1);
  await ap.locator('#panel [data-act="resolveEv"][data-v="0"]').click(); await ap.waitForTimeout(200);
  check('3.7.1 체크한 채 "콘셉트카 출품" → 모터쇼 초청 켜짐 + 답 콘셉트카 출품, 알림 한 줄', JSON.stringify(await AG(() => window.__car.game.state.autoDecide)) === '{"on":["strike","motorshow"],"pick":{"motorshow":0}}'
    && (await AG(() => [...document.querySelectorAll('#toasts .toast')].some((x) => x.innerText.includes('「모터쇼 초청」 결정은 앞으로 「콘셉트카 출품」으로 자동 승인합니다')))), JSON.stringify(await AG(() => [window.__car.game.state.autoDecide, [...document.querySelectorAll('#toasts .toast')].map((x) => x.innerText.slice(0, 60))])));
  // 실제 진행: 모두 켜고 몇 년 돌리면 결정 창 없이 자동 승인 기록이 쌓인다
  const real = await AG(() => { const g = window.__car.game, s = g.state; g.command({ type: 'setAutoDecide', kind: 'all', on: true }); let n = 0, waits = 0;
    for (let i = 0; i < 48 * 8; i++) { s.cash = Math.max(s.cash, 1e9); const ev = g.tick(); n += ev.filter((e) => e.topic === 'auto').length; waits += ev.filter((e) => e.kind === 'choice').length; }
    window.__car.render(); return { n, waits, pending: s.events.pending.length }; });
  check('3.7.0 모두 켜고 8년 진행: 자동 승인 기록이 쌓이고 결정 대기가 남지 않음', real.n > 0 && real.waits === 0 && real.pending === 0, JSON.stringify(real));
  // 자동 승인 알림(하나, 묶음)
  const an = (t) => ({ kind: 'news', text: `자동 승인: ${t}`, category: 'result', topic: 'auto' });
  for (const [w, h] of SZ7) {
    await ap.setViewportSize({ width: w, height: h }); await AG(() => { document.getElementById('sheet').hidden = true; document.getElementById('toasts').innerHTML = ''; }); await ap.waitForTimeout(200);
    await AG((l) => window.__car.events(l), [an('노조 파업 → 임금 인상 수용 선택 — 직원 컨디션이 좋아집니다.')]); await ap.waitForTimeout(300);
    const one = await AG(() => [...document.querySelectorAll('#toasts .toast:not(.out)')].map((x) => x.innerText.replace(/\s+/g, ' ')));
    check(`3.7.0 자동 승인 알림 ${w}×${h}: 제목 '자동 승인', 내용 한 줄`, one.length === 1 && one[0].includes('자동 승인') && one[0].includes('노조 파업 → 임금 인상 수용 선택'), one.join(' | ').slice(0, 160));
    if (P7) await ap.screenshot({ path: `${P7}/toast-${w}x${h}.png` });
    await AG(() => { document.getElementById('toasts').innerHTML = ''; }); await ap.waitForTimeout(100);
    await AG((l) => window.__car.events(l), [an('모터쇼 초청 → 이번엔 불참 선택 — 달라지는 것은 없습니다.'), an('환율 변동 → 그냥 두기 선택 — 원가가 바뀔 수 있습니다.'), an('가격 전쟁 → 버틴다 선택 — 판매가 조금 줄어듭니다.')]); await ap.waitForTimeout(300);
    const grp7 = await AG(() => [...document.querySelectorAll('#toasts .toast:not(.out)')].map((x) => x.innerText.replace(/\s+/g, ' ')));
    check(`3.7.0 자동 승인 알림 묶기 ${w}×${h}: "자동 승인 3건" 한 알림`, grp7.length === 1 && grp7[0].includes('자동 승인 3건'), grp7.join(' | ').slice(0, 160));
    const o = await overflowOf(ap); check(`3.7.0 자동 승인 알림 ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o));
    if (P7) await ap.screenshot({ path: `${P7}/toastgroup-${w}x${h}.png` });
  }
  await ap.setViewportSize({ width: 1366, height: 1024 }); await AG(() => { document.getElementById('toasts').innerHTML = ''; });
  // 내역: 할 일 창의 '최근 자동 승인', 설정 › 결정의 최근 기록
  await menuItem(ap, '#todobtn'); await ap.waitForSelector('#drawer:not([hidden]) .todo-auto');
  await AG(() => { document.querySelector('#drawer .todo-auto').open = true; });
  const dl = await ap.locator('#drawer .todo-auto').innerText();
  check('3.7.0 할 일 창: 최근 자동 승인 목록(날짜·"→ … 선택")', (await ap.locator('#drawer .todo-auto .auto-log li').count()) >= 1 && dl.includes('선택') && !dl.includes('자동 승인: '), dl.replace(/\s+/g, ' ').slice(0, 160));
  await shots('log-todo', () => AG(() => { const d = document.querySelector('#drawer .todo-auto'); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); } }));
  await ap.locator('#drawer .todo-auto [data-act="autoSettings"]').click(); await ap.waitForSelector('#sheet .auto-kinds');
  check('3.7.0 설정 › 결정: 최근 자동 승인 기록', (await ap.locator('#sheet .auto-log li').count()) >= 1);
  await shots('log-settings', () => AG(() => document.querySelector('#sheet .auto-log')?.scrollIntoView({ block: 'center' })));
  await actx.close(); }

// ---- 4.0.0 세계 시장 1부·경쟁사 6곳: 세계 화면(진출 전·후), 권역 상세, 진출 창, 판매 법인 투자, 차 상세 권역별 판매, 월 결산 해외 항목, 알림(CAR_SMOKE_400=폴더면 640·800·1024·1366 캡처) ----
{ const wctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const wp = await wctx.newPage(); wp.on('pageerror', (e) => errors.push(String(e))); wp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const WG = (fn, a) => wp.evaluate(fn, a), P4 = process.env.CAR_SMOKE_400 ?? '';
  const SZ4 = [[640, 900], [800, 1200], [1024, 768], [1366, 1024]];
  const shots4 = async (n, fn) => { for (const [w, h] of SZ4) { await wp.setViewportSize({ width: w, height: h }); await wp.waitForTimeout(250); await WG(() => { document.getElementById('toasts').innerHTML = ''; }); if (fn) await fn(); const o = await overflowOf(wp); check(`4.0.0 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (P4) await wp.screenshot({ path: `${P4}/${n}-${w}x${h}.png` }); } await wp.setViewportSize({ width: 1366, height: 1024 }); };
  await wp.goto(URL0); await wp.waitForSelector('#title:not([hidden])');
  await wp.click('[data-act="titleNew"]'); await wp.fill('#t-co', '세계 시험'); await wp.click('[data-act="startNew"]'); await wp.click('#tabs button[data-tab="car"]'); await WG(() => window.__car.setSpeed(0));
  await WG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2011 - 1970) * 48 + 44; s.cash = 5e9; s.hqLevel = 5; s.reputation = 90; s.factory.level = 5;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2010 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    for (const [name, body, seg] of [['아리아', 'sedanM', 'family'], ['노바', 'suvL', 'family'], ['솔라', 'hatch', 'youth']]) {
      g.command({ type: 'startProject', name, body, segment: seg, powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 28 });
      const p = s.projects.at(-1); g.devCheat('finishDev'); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); }
    for (const g2 of s.nameplates.flatMap((n) => n.generations)) { const ed = g2.editions.at(-1); for (const k of Object.keys(ed.stats)) ed.stats[k] = 1500; ed.equipLegacy = true; g2.awareness = 0.9; } // 점검용: 판매가 나도록 능력치를 올린다
    s.events.pending.length = 0; c.tick(8); c.render(); });
  check('4.0.0 경쟁사 6곳(2011년이면 테슬러 등장)', (await WG(() => window.__car.game.state.rivals.map((r) => r.id).join())) === 'hyundae,porty,toyoda,bmv,hondi,tesler');
  await WG(() => window.__car.goCo('world')); await wp.waitForSelector('.wmap');
  check('4.0.0 회사 › 세계: 지도(권역 3 + 국내)·권역 표 4줄·진출 전', (await wp.locator('.wmap .wm-r[data-act="wSel"]').count()) === 3 && (await wp.locator('.w-sum tr').count()) === 5 && (await wp.locator('.w-reg [data-act="wOpen"]').count()) === 1);
  await shots4('world-before');
  for (const r of ['na', 'eu', 'em']) { await wp.locator(`.wmap [data-act="wSel"][data-v="${r}"]`).click(); await wp.waitForTimeout(100); check(`4.0.0 지도에서 ${r} 고르면 그 권역 상세(취향 막대·진출 단추)`, (await wp.locator('.w-reg .w-bar').count()) >= 5 && (await wp.locator(`.w-reg [data-act="wOpen"][data-v="${r}"]`).count()) === 1); }
  await wp.locator('.wmap [data-act="wSel"][data-v="na"]').click(); await wp.locator('.w-reg [data-act="wOpen"]').click(); await wp.waitForSelector('#sheet [data-act="wOpenDo"]');
  check('4.0.0 진출 창: 진출비·시장 규모·판매 상한·관세·운송비', /진출비/.test(await wp.locator('#sheet').innerText()) && /관세/.test(await wp.locator('#sheet').innerText()));
  await shots4('open-sheet');
  await wp.locator('#sheet [data-act="wOpenDo"]').click(); await wp.waitForTimeout(200);
  check('4.0.0 [진출] → 북미 진출(판 상태), 자동 수출 켜짐', (await WG(() => JSON.stringify(window.__car.game.state.world.regions.map((r) => [r.id, r.auto])))) === '[["na",true]]');
  await WG(() => { const c = window.__car, g = c.game; g.command({ type: 'openRegion', region: 'eu' }); g.command({ type: 'openRegion', region: 'em' }); c.tick(12); c.goCo('world'); });
  const wst = await WG(() => { const s = window.__car.game.state; return { sold: s.world.regions.map((r) => r.sold), on: s.nameplates.flatMap((n) => n.generations).filter((g) => g.world).length, led: !!s.ledger.at(-1).world }; });
  check('4.0.0 세 권역 진출 뒤 3개월: 수출 차가 있고 장부에 권역 칸', wst.on > 0 && wst.led && wst.sold.some((x) => x > 0), JSON.stringify(wst));
  for (const r of ['na', 'eu', 'em']) { await wp.locator(`.wmap [data-act="wSel"][data-v="${r}"]`).click(); await wp.waitForTimeout(100); check(`4.0.0 ${r} 상세: 판매·상한·인지도·수출 차종 표·경쟁사 순위`, (await wp.locator('.w-reg .kpi').count()) >= 6 && (await wp.locator('.w-reg .w-cars tr').count()) >= 2 && (await wp.locator('.w-reg .w-rank .w-bar').count()) >= 5); await shots4(`region-${r}`, () => WG(() => document.querySelector('.w-reg')?.scrollIntoView({ block: 'start' }))); }
  await wp.locator('.wmap [data-act="wSel"][data-v="na"]').click(); await shots4('world-after', () => WG(() => document.querySelector('.w-head')?.scrollIntoView({ block: 'start' })));
  await wp.locator('.w-reg [data-act="wOffice"]').click(); await wp.waitForSelector('#sheet [data-act="wOfficeDo"]');
  check('4.0.0 판매 법인 투자 창: 상한·인지도·유지비 비교', /판매 상한/.test(await wp.locator('#sheet').innerText()));
  await shots4('office-sheet');
  await wp.locator('#sheet [data-act="wOfficeDo"]').click(); await wp.waitForTimeout(200);
  check('4.0.0 [투자] → 북미 판매 법인 1등급', (await WG(() => window.__car.game.state.world.regions[0].office)) === 1);
  const gid = await WG(() => window.__car.game.state.nameplates.flatMap((n) => n.generations).find((g) => g.world?.na)?.id);
  if (gid !== undefined) { await wp.locator(`.w-reg [data-act="wPrice"][data-id="${gid}"]`).click(); await wp.waitForSelector('#sheet #w-price');
    await wp.fill('#sheet #w-price', String((await WG((id) => window.__car.game.state.nameplates.flatMap((n) => n.generations).find((g) => g.id === id).world.na.ap, gid)) + 50));
    await wp.locator('#sheet [data-act="wPriceDo"]').click(); await wp.waitForTimeout(150);
    check('4.0.0 권역 가격 수동 지정', (await WG((id) => window.__car.game.state.nameplates.flatMap((n) => n.generations).find((g) => g.id === id).world.na.price, gid)) > 0); }
  await WG((id) => { const c = window.__car; c.goTarget({ tab: 'garage', id }); }, gid); await WG(() => { window.__car.render(); }); await wp.waitForTimeout(200);
  await WG((id) => { const b = document.querySelector('[data-act="gsum"]'); if (window.__car.garageSum) document.querySelector(`[data-act="gpick"][data-id="${id}"], [data-act="gopen"][data-id="${id}"]`)?.click(); }, gid); await wp.waitForTimeout(200);
  check('4.0.0 차 상세: 권역별 판매 표', (await wp.locator('.w-regs').count()) >= 1);
  await shots4('car-detail', () => WG(() => document.querySelector('.w-regs')?.scrollIntoView({ block: 'center' })));
  await WG(() => { const c = window.__car; c.showMonth(c.game.state.ledger.length - 1); }); await wp.waitForSelector('#sheet .mon-world');
  const mtxt = await wp.locator('#sheet').innerText();
  check('4.0.0 월 결산: 해외 권역 표·관세·운송비·판매 법인 항목', /관세/.test(mtxt) && /운송비/.test(mtxt) && (await wp.locator('#sheet .mon-world tr').count()) === 4);
  await shots4('month', () => WG(() => document.querySelector('#sheet .mon-world')?.scrollIntoView({ block: 'center' })));
  await WG(() => { document.getElementById('sheet').hidden = true; });
  const wn = (t) => ({ kind: 'news', text: t, category: 'world', topic: 'world' });
  for (const [w, h] of SZ4) { await wp.setViewportSize({ width: w, height: h }); await WG(() => { document.getElementById('toasts').innerHTML = ''; }); await wp.waitForTimeout(150);
    await WG((l) => window.__car.events(l), [wn('자동 수출: 「아리아」를 북미 수출 목록에 넣었습니다(권역 가격 3,120만원, 예상 월 420대).'), wn('자동 수출: 「솔라」를 유럽 수출 목록에 넣었습니다(권역 가격 1,430만원, 예상 월 380대).')]); await wp.waitForTimeout(300);
    const tt = await WG(() => [...document.querySelectorAll('#toasts .toast:not(.out)')].map((x) => x.innerText.replace(/\s+/g, ' ')));
    check(`4.0.0 세계 시장 알림 묶기 ${w}×${h}`, tt.length === 1 && tt[0].includes('세계 시장') && tt[0].includes('2건'), tt.join(' | ').slice(0, 160));
    const o = await overflowOf(wp); check(`4.0.0 알림 ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (P4) await wp.screenshot({ path: `${P4}/toast-${w}x${h}.png` }); }
  await wp.setViewportSize({ width: 1366, height: 1024 }); await WG(() => { document.getElementById('toasts').innerHTML = ''; });
  await toRivals(wp); await wp.waitForTimeout(200);
  check('4.0.0 재무: 경쟁사 카드 6장', (await wp.locator('.rivals .rv-co').count()) === 6);
  await shots4('fin-rivals', () => WG(() => document.querySelector('.rivals')?.scrollIntoView({ block: 'center' })));
  await WG(() => window.__car.goCo('sum')); await wp.waitForTimeout(150);
  check('4.0.0 회사 요약: 세계 시장 칸', (await wp.locator('.co-box[data-v="world"]').count()) === 1);
  await wctx.close(); }

// ---- 4.1.0 직속 전담팀·전 직원·수작·도전 과제 실패·새 로고(CAR_SMOKE_410=폴더면 800×1200·1024×768·1366×1024 캡처) ----
{ const ectx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
  const ep = await ectx.newPage(); ep.on('pageerror', (e) => errors.push(String(e))); ep.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const EG = (fn, a) => ep.evaluate(fn, a), P5 = process.env.CAR_SMOKE_410 ?? '', SZ5 = [[800, 1200], [1024, 768], [1366, 1024]];
  const shots5 = async (n, fn) => { for (const [w, h] of SZ5) { await ep.setViewportSize({ width: w, height: h }); await ep.waitForTimeout(250); await EG(() => { document.getElementById('toasts').innerHTML = ''; }); if (fn) await fn(); await ep.waitForTimeout(100); const o = await overflowOf(ep); check(`4.1.0 ${n} ${w}×${h}: 가로 넘침 없음`, o <= 0, String(o)); if (P5) await ep.screenshot({ path: `${P5}/${n}-${w}x${h}.png` }); } await ep.setViewportSize({ width: 1366, height: 1024 }); };
  await ep.goto(URL0); await ep.waitForSelector('#title:not([hidden])');
  await ep.click('[data-act="titleNew"]'); await ep.fill('#t-co', '전담 시험');
  await ep.locator('details.ns-chal').evaluate((d) => { d.open = true; }); await ep.locator('[data-ch="noLoan"]').check();
  await ep.click('[data-act="startNew"]'); await ep.click('#tabs button[data-tab="car"]'); await EG(() => window.__car.setSpeed(0));
  await EG(() => { const c = window.__car, g = c.game, s = g.state; s.week = (2013 - 1970) * 48 + 44; s.cash = 5e9; s.hqLevel = 5; s.reputation = 120; s.factory.level = 5;
    for (const t of c.Q.researchInfo(s).fields.flatMap((f) => f.techs)) if (t.year <= 2012 && !t.repeatable && !s.research.done.includes(t.id)) s.research.done.push(t.id);
    for (const k of c.Q.eliteInfo(s).cands.slice(0, 3)) g.command({ type: 'hireElite', key: k.key });
    const eng = s.staff.find((x) => !x.elite && x.role === 'engineer'); g.command({ type: 'setElite', staffId: eng.id, on: true });
    for (const x of s.staff) if (x.elite) { x.ability = 92; x.potential = 92; }
    g.command({ type: 'fire', staffId: s.staff.find((x) => !x.elite && x.role === 'designer').id });
    s.cash = -100; g.command({ type: 'bailout' }); s.cash = 5e9; s.events.pending.length = 0; c.render(); });
  await tab5(ep, 'people', 'psec', 'elite'); await ep.waitForSelector('.elite-card'); // 5.1.0 사람 › 직속 전담팀 구역
  check('4.1.0 직원 화면: 직속 전담팀 구역(자리 n/상한·팀원·호흡·자동 교육·전용 후보)', (await ep.locator('.elite-card .e-row').count()) === 4 && (await ep.locator('.elite-card [data-etrain]').count()) === 1 && (await ep.locator('.elite-card [data-act="hireElite"]').count()) >= 1 && /자리 4\/7명/.test(await ep.locator('.elite-card h3').innerText()));
  await shots5('elite-staff', () => EG(() => document.querySelector('.elite-card')?.scrollIntoView({ block: 'start' })));
  await shots5('elite-cands', () => EG(() => document.querySelector('.elite-card .e-cand')?.scrollIntoView({ block: 'center' })));
  await tab5(ep, 'people', 'psec', 'staff');
  check('4.1.0 일반 직원 목록에 전담팀원이 없다', (await EG(() => [...document.querySelectorAll('.staff-list .srow[data-id]')].map((b) => Number(b.dataset.id)).filter((id) => window.__car.game.state.staff.find((x) => x.id === id)?.elite).length)) === 0);
  await shots5('elite-staff', () => EG(() => document.querySelector('.elite-card')?.scrollIntoView({ block: 'start' })));
  await shots5('elite-cands', () => EG(() => document.querySelector('.elite-card .e-cand')?.scrollIntoView({ block: 'center' })));
  check('4.1.0 채용: 전 직원 목록(다시 채용)', (await ep.locator('.hire-card .former [data-act="rehire"]').count()) === 1);
  await shots5('former', () => EG(() => { const d = document.querySelector('.hire-card .former'); if (d) d.open = true; d?.scrollIntoView({ block: 'center' }); }));
  const fid = await EG(() => window.__car.game.state.former[0].staff.id); await ep.locator(`[data-act="rehire"][data-id="${fid}"]`).click(); await ep.waitForTimeout(150);
  check('4.1.0 전 직원을 다시 채용하면 직원 목록으로 돌아온다', await EG((id) => window.__car.game.state.staff.some((x) => x.id === id), fid));
  // 기획: 팀 고르기에서 [직속 전담팀]
  await devHome(ep); await ep.waitForTimeout(150); await ep.locator('[data-act="plan"]').first().click(); await ep.waitForTimeout(150); if ((await EG(() => window.__car.screen)) === 'start') { await ep.locator('[data-act="pickNew"]').first().click(); await ep.waitForTimeout(150); }
  await EG(() => { const b = document.querySelector('[data-act="ptab"][data-v="budget"]'); b?.click(); }); await ep.waitForTimeout(150);
  await ep.locator('[data-act="eliteTeam"]').first().click(); await ep.waitForTimeout(150);
  check('4.1.0 기획 화면: [직속 전담팀]을 누르면 쉬는 전담팀원 전원이 골라진다', (await EG(() => { const d = window.__car.draft, s = window.__car.game.state; return d.team.length === s.staff.filter((x) => x.elite).length && d.team.every((id) => s.staff.find((x) => x.id === id).elite); })));
  await shots5('elite-plan', () => EG(() => document.querySelector('.elite-pick')?.scrollIntoView({ block: 'center' })));
  await ep.locator('[data-act="startDev"]').first().click(); await ep.waitForTimeout(150);
  check('4.1.0 전담팀 개발이 시작되고 전담팀 자리를 쓴다', await EG(() => window.__car.game.state.projects.some((p) => p.elite)));
  await EG(() => window.__car.tick(1)); await ep.waitForTimeout(400);
  check('4.1.0 사무실: 전담팀원은 금색 자리에 앉는다', (await EG(() => document.querySelector('#office svg, .office svg')?.getAttribute('aria-label') ?? '')).includes('직속 전담팀 4명'));
  await shots5('office');
  await EG(() => { const c = window.__car, g = c.game, s = g.state; g.devCheat('finishDev'); const p = s.projects.find((x) => x.elite); g.command({ type: 'launch', projectId: p.id, price: Math.round(c.Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: '#2e7d5b', wheels: 1 }); const gen = s.nameplates.flatMap((n) => n.generations).at(-1); gen.opus = true; gen.elite = true; gen.reviews = [9.8, 9.6, 9.7, 9.7]; gen.reviewAvg = 9.7; document.getElementById('sheet').hidden = true; c.render(); });
  await carTable(ep); await ep.waitForTimeout(200);
  check('4.1.0 차고: 수작 표시', (await ep.locator('.opus-chip, .opus-s').count()) >= 1);
  await shots5('opus-garage', () => EG(() => document.querySelector('.opus-chip, .opus-s')?.scrollIntoView({ block: 'center' })));
  await tab5(ep, 'fin', 'sec', 'records').catch(() => {}); await ep.waitForTimeout(200);
  await EG(() => document.querySelector('[data-act="rectab"][data-v="stats"]')?.click()); await ep.waitForTimeout(200);
  check('4.1.0 통계: 도전 과제 실패 표시', (await ep.locator('.ch-list li.failed').count()) === 1);
  await shots5('challenge-failed', () => EG(() => document.querySelector('.ch-list')?.scrollIntoView({ block: 'center' })));
  await EG(() => { window.__car.tick(4); document.getElementById('sheet').hidden = true; }); // 월 결산: 테슬러 등장(등장 달이 지났다)
  await toRivals(ep); await ep.waitForTimeout(200);
  check('4.1.0 재무: 경쟁사 6곳 로고(새 도형)', (await ep.locator('.rivals .rv-co svg').count()) === 6);
  await shots5('logos', () => EG(() => document.querySelector('.rivals')?.scrollIntoView({ block: 'center' })));
  await ectx.close(); }

// ---- 5.0.0 UI 개편 1단계: 7탭·오늘 탭(두 칸/한 칸)·창 없는 결정·차 탭 무대 렌더·여러 크기 가로 넘침(CAR_SMOKE_500=폴더면 캡처) ----
{ const vctx = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  const vp = await vctx.newPage(); vp.on('pageerror', (e) => errors.push(String(e))); vp.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const VG = (fn, a) => vp.evaluate(fn, a), P5 = process.env.CAR_SMOKE_500 || '';
  const s5 = async (n) => { if (P5) await vp.screenshot({ path: `${P5}/${n}.png` }); };
  await vp.goto(URL0); await vp.waitForSelector('#title:not([hidden])');
  const [fc] = await Promise.all([vp.waitForEvent('filechooser'), vp.click('[data-act="import"]')]); await fc.setFiles('car/tests/fixtures/save-v11.json');
  await vp.waitForSelector('#title', { state: 'hidden' }); await VG(() => { window.__car.setSpeed(0); document.getElementById('toasts').innerHTML = ''; });
  await vp.click('#tabs button[data-tab="car"]'); await vp.waitForTimeout(800);
  const st = await VG(() => { const c = window.__car, url = c.stage.snapshot(); return { empty: c.stage.empty, show: document.getElementById('main').classList.contains('show'), url }; });
  const lit = await VG(async (u) => { const i = new Image(); await new Promise((r) => { i.onload = r; i.src = u; }); const c = document.createElement('canvas'); c.width = 120; c.height = 80; const g = c.getContext('2d'); g.drawImage(i, 0, 0, 120, 80); const d = g.getImageData(0, 0, 120, 80).data; let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k + 3] > 0 && d[k] + d[k + 1] + d[k + 2] > 120) n++; return n; }, st.url);
  check('5.0.0 차 탭: 고른 차의 어두운 무대(왼쪽 목록·무대 캔버스에 차가 그려짐·수치 카드·행동 단추 4개)', !st.empty && st.show && lit > 200 && (await vp.locator('#side .cl-it[aria-current="true"]').count()) === 1 && (await vp.locator('#ov .show-k').isVisible()) && (await vp.locator('#ov .show-a button').count()) === 4 && (await VG(() => getComputedStyle(document.getElementById('stage')).backgroundImage.includes('rgb(18, 22, 29)'))), `밝은 화소 ${lit}`);
  await s5('car-1194x834');
  await vp.click('#ov [data-act="carJump"][data-v="fac"]'); await vp.waitForTimeout(700);
  check('5.0.0 무대 [판매 분석] → 판매 요인 카드가 펴져 보임', (await vp.locator('#panel details.fold[data-fold="fac"][open]').count()) === 1 && await VG(() => { const r = document.querySelector('#panel details.fold[data-fold="fac"]').getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }));
  // 5.1.0 오늘 탭: 같은 종류 묶기, 급하지 않은 일은 참고(건수에 안 셈)
  await vp.click('#tabs button[data-tab="today"]'); await vp.waitForTimeout(200);
  { const r = await VG(() => { const T = window.__car.todos(), rows = [...document.querySelectorAll('#panel .td-l > .td-list .td-item')].map((b) => b.dataset.k); return { cap: T.filter((t) => t.kind === 'capacity').length, rows, refs: document.querySelectorAll('#panel .td-ref .td-item').length, n: document.querySelector('#panel .td-l > .td-h').textContent }; });
    check('5.1.0 오늘 탭: 같은 종류는 한 줄(주문이 생산을 넘는 차 n종), 보고·임원 자리·생산은 참고로 내려 정할 일 건수에 안 셈', r.cap >= 2 && !r.rows.some((k) => /^(capacity|reports|exec|grp:capacity)/.test(k)) && r.refs >= 2 && (await vp.locator('#panel .td-ref .td-item[data-k="grp:capacity"]').count()) === 1 && r.n.includes(`${r.rows.length}건`), JSON.stringify(r)); }
  await vp.click('#panel .td-ref summary'); await vp.click('#panel .td-item[data-k="grp:capacity"]');
  check('5.1.0 묶음 줄을 누르면 오른쪽에 차별 목록(차마다 바로 가기)', (await vp.locator('#panel .td-r .td-grp .td-card').count()) >= 2);
  // 5.1.0 자동 멈춤 띠: 다른 탭에서 결정이 오면 위쪽 줄 아래 한 줄 + [지금 보기], [정할 일] 강조, 창 없음
  await vp.click('#tabs button[data-tab="car"]'); await VG(() => window.__car.setSpeed(1));
  await VG(() => { const c = window.__car, s = c.game.state, id = s.nextId++; s.events.pending.push({ id, eventId: 'motorshow', text: '국제 모터쇼에서 콘셉트카 출품을 요청해 왔습니다.', week: s.week, deadline: s.week + 8, genId: null, fx: null }); c.events([{ kind: 'choice', text: '[모터쇼 초청] 국제 모터쇼에서 콘셉트카 출품을 요청해 왔습니다.', id, category: 'choice' }]); c.render(); });
  check('5.1.0 자동 멈춤 띠: 시간 멈춤·위쪽 줄 아래 한 줄(무슨 결정인지 + [지금 보기])·[정할 일] 강조·창 없음', (await VG(() => window.__car.speed)) === 0 && (await vp.locator('#alertbar').isVisible()) && (await vp.locator('#alertbar').innerText()).includes('모터쇼') && (await vp.locator('#decbtn.flash').count()) === 1 && (await vp.locator('#sheet').isHidden()));
  await s5('alertbar-1194x834');
  await vp.click('#alertbar [data-act="alertGo"]');
  check('5.1.0 [지금 보기] → 오늘 탭 그 결정, 띠는 닫힘', (await VG(() => window.__car.screen)) === 'today' && (await vp.locator('#panel .td-r .choice-sheet').count()) === 1 && (await vp.locator('#alertbar').isHidden()));
  await VG(() => { window.__car.game.state.events.pending.length = 0; window.__car.render(); });
  // 5.1.0 연구: 기술 자세히는 창 없이 오른쪽 칸
  await vp.click('#tabs button[data-tab="research"]'); await vp.locator('#panel .tc.available').first().click();
  check('5.1.0 연구: 기술을 누르면 창 없이 오른쪽 칸에 자세히·[연구 시작], 분야는 접고 펼침', (await vp.locator('#sheet').isHidden()) && (await vp.locator('#panel .split .sp-r .tech-sheet [data-act="startResearch"]').count()) === 1 && (await vp.locator('#panel details.rfield').count()) === 5);
  // 5.1.0 사람: 구역(직원·채용·직속 전담팀·임원·사무실), 머리 한 줄
  await vp.click('#tabs button[data-tab="people"]');
  check('5.1.0 사람 탭: 머리(상태 한 줄 + 핵심 숫자)와 구역 다섯', (await vp.locator('#panel .tab-head .kpi').count()) >= 3 && (await vp.locator('#panel .secbar button').allInnerTexts()).join() === '직원,채용,직속 전담팀,임원,사무실');
  await vp.click('#panel [data-act="psec"][data-v="elite"]');
  check('5.1.0 사람 › 직속 전담팀 구역(직원 표 아래에 묻히지 않음)', (await vp.locator('#panel .elite-card').count()) === 1 && (await vp.locator('#panel .staff-list').count()) === 0);
  // 5.1.0 그룹: 다음 본사 등급 조건 막대
  await vp.click('#tabs button[data-tab="group"]');
  check('5.1.0 그룹 탭: 본사 등급 진행(다음 등급 현금·평판 막대)', (await vp.locator('#panel .tab-head .th-bar').count()) === 2 || (await VG(() => window.__car.game.state.hqLevel)) === 7);
  // 5.1.0 시장: 경쟁사 상세는 오른쪽 칸
  await vp.click('#tabs button[data-tab="market"]'); await vp.click('#panel [data-act="sec"][data-v="rivals"]'); await vp.locator('#panel [data-act="rivalOpen"]').first().click();
  check('5.1.0 시장: 경쟁사를 누르면 창 없이 오른쪽 칸에 라인업·관계', (await vp.locator('#sheet').isHidden()) && (await vp.locator('#panel .split .sp-r .rv-sheet .rv-model').count()) >= 1);
  // 5.1.0 재무: 재무 / 기록 두 묶음
  await vp.click('#tabs button[data-tab="fin"]');
  check('5.1.0 재무 탭: 구역 재무·기록, 기록 안에서 고르기', (await vp.locator('#panel .secbar:not(.sec2) button').allInnerTexts()).join() === '재무,기록' && await (async () => { await vp.click('#panel [data-act="sec"][data-v="records"]'); return (await vp.locator('#panel .sec2 [data-act="rectab"]').count()) === 7; })());
  await VG(() => { const c = window.__car, s = c.game.state; s.events.pending.push({ id: s.nextId++, eventId: 'motorshow', text: '국제 모터쇼에서 콘셉트카 출품을 요청해 왔습니다.', week: s.week, deadline: s.week + 8, genId: null, fx: null }); c.render(); });
  check('5.0.0 다른 탭에서 결정이 생기면 위쪽 [정할 일 n건](노랑)', await vp.locator('#decbtn').isVisible() && (await vp.locator('#decbtn').innerText()).includes('정할 일'));
  await vp.click('#decbtn');
  check('5.0.0 [정할 일 n건] → 오늘 탭 두 칸, 결정이 창 없이 오른쪽 상세에(선택지·효과)', (await VG(() => window.__car.screen)) === 'today' && (await vp.locator('#sheet').isHidden()) && (await vp.locator('#panel .today.wide .td-r .choice-sheet .evc').count()) === 2 && (await vp.locator('#panel .td-r .ev-cost').count()) >= 1);
  await s5('today-choice-1194x834');
  await vp.setViewportSize({ width: 834, height: 1194 }); await vp.waitForTimeout(300);
  check('5.0.0 오늘 탭 세로(834×1194): 한 칸, 맨 위 일(결정)이 그 자리에서 펼쳐짐', (await vp.locator('#panel .today.narrow').count()) === 1 && (await vp.locator('#panel .td-r').count()) === 0 && (await vp.locator('#panel .td-wrap.on .td-in .choice-sheet').count()) === 1);
  await vp.click('#panel .td-wrap:nth-child(2) [data-act="tdSel"]');
  check('5.0.0 세로: 다른 일을 누르면 그 자리에서 펼쳐지고 결정은 접힘', (await vp.locator('#panel .td-wrap:nth-child(2).on .td-in').count()) === 1 && (await vp.locator('#panel .td-wrap.on').count()) === 1);
  await s5('today-834x1194');
  await VG(() => { const s = window.__car.game.state; s.events.pending.length = 0; s.research.active.length = 0; window.__car.render(); });
  await vp.setViewportSize({ width: 1194, height: 834 }); await vp.waitForTimeout(300);
  await vp.click('#panel [data-act="tdSel"][data-k="research"]');
  check('5.0.0 오늘 탭 빈 연구 칸: 추천 연구와 [바로 시작]', (await vp.locator('#panel .td-r [data-act="startResearch"]').count()) === 1);
  { const n0 = await VG(() => window.__car.game.state.research.active.length); await vp.click('#panel .td-r [data-act="startResearch"]'); await vp.click('#ask-yes'); await vp.waitForTimeout(150); check('5.0.0 [바로 시작] → 연구가 시작됨', (await VG(() => window.__car.game.state.research.active.length)) === n0 + 1); }
  const sizes = [[1194, 834], [834, 1194], [1280, 800], [800, 1280], [1366, 1024], [1024, 768], [640, 900]], bad = [];
  for (const [w, h] of sizes) { await vp.setViewportSize({ width: w, height: h }); await vp.waitForTimeout(150);
    for (const t of ['today', 'car', 'research', 'people', 'group', 'market', 'fin']) { await vp.click(`#tabs button[data-tab="${t}"]`); await vp.waitForTimeout(120);
      const o = await VG(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...['#panel', '#main', '#top', '#tabs'].map((q) => { const e = document.querySelector(q); return e.scrollWidth - e.clientWidth; })));
      const small = await VG(() => [...document.querySelectorAll('#tabs button, #top button, #side button, .secbar button')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44).length);
      if (o > 0 || small) bad.push(`${w}×${h} ${t} 넘침 ${o} 작은 단추 ${small}`); } }
  check('5.0.0 7탭 × 7가지 크기(1194×834·834×1194·1280×800·800×1280·1366×1024·1024×768·640×900): 가로 넘침 0, 위쪽 줄·탭·목록·구역 단추 44px 이상', !bad.length, bad.slice(0, 4).join(' | '));
  await vctx.close(); }

check('콘솔 오류 0건', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fails.length ? `FAIL ${fails.length}건 / ${checks}항목: ${fails.join(' / ')}` : `ALL PASS ${checks}항목`); // 실패한 항목 이름을 로그 끝에
await done(fails.length ? 1 : 0);
