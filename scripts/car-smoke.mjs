// 카 컴퍼니 브라우저 점검: 타이틀 → 새 게임 → 기획 → 개발 → 출시 → 리뷰 → 판매 → 가격 변경 → 저장 → 새로 고침 → 이어 하기 → 단종 → 두 번째 차.
// 사용: npm run build && node scripts/car-smoke.mjs [스크린샷경로.png]  (경로를 주면 화면마다 -이름.png로 찍는다)
import { createRequire } from 'node:module';
import { preview } from 'vite';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await preview({ preview: { port: 4191, strictPort: true } });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
const page = await ctx.newPage();
const URL0 = 'http://localhost:4191/car/';
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const fails = [];
let checks = 0;
const done = async (code) => { await browser.close(); await new Promise((r) => server.httpServer.close(r)); process.exit(code); };
const halt = async (e) => { console.log(`FAIL 점검이 중간에 멈춤(${checks}번째 항목 뒤): ${String(e?.message ?? e).split('\n').slice(0, 6).join(' | ')}`); await done(1); };
process.on('uncaughtException', halt); process.on('unhandledRejection', halt);
const check = (name, ok, detail = '') => { checks++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) fails.push(name); };
const shot = (n) => !process.argv[2] ? Promise.resolve() : page.screenshot({ path: process.argv[2].replace('.png', `-${n}.png`), timeout: 60000 }).catch((e) => console.log('WARN 스크린샷 실패:', n, String(e.message).split('\n')[0]));
const G = (fn, arg) => page.evaluate(fn, arg);
const tick = (n) => G((k) => window.__car.tick(k), n);
const act = async (a, extra = '') => { await page.locator(`[data-act="${a}"]${extra}`).first().click(); };
const overflow = () => G(() => { const p = document.getElementById('panel'); return Math.max(document.documentElement.scrollWidth - window.innerWidth, document.body.scrollHeight - window.innerHeight, p.scrollWidth - p.clientWidth); }); // 화면 가로 넘침, 본문 세로 스크롤, 패널 안 가로 넘침
/** 시험이 출시 가능해질 때까지 진행 */
const untilReady = () => G(() => { const c = window.__car; let i = 0; while (i++ < 60) { const p = c.game.state.projects[0]; if (p.phase === 'test' && p.testWeeks >= 2) break; c.tick(1); } c.render(); });

await page.goto(URL0);
await page.waitForSelector('#title:not([hidden])');
const titleText = await page.locator('#title').innerText();
check('타이틀: 게임 이름·버전·새 게임 버튼', titleText.includes('카 컴퍼니') && /v\d+\.\d+\.\d+/.test(titleText) && (await page.locator('[data-act="titleNew"]').count()) === 1, titleText.split('\n')[0]);
check('타이틀: 처음 열면 이어 하기 없음', (await page.locator('[data-act="continue"]').count()) === 0);
await shot('title');
await act('titleNew');
await page.fill('#t-co', '테스트 모터스');
await act('startNew');
check('새 게임: 회사 이름·날짜·현금 표시', (await page.locator('#co').innerText()) === '테스트 모터스' && (await page.locator('#date').innerText()).startsWith('1970년 1월') && (await page.locator('#cash').innerText()).includes('억'), `${await page.locator('#date').innerText()} ${await page.locator('#cash').innerText()}`);
check('차고(빈): 첫 차 안내와 신차 기획 버튼', (await page.locator('#ov').innerText()).includes('첫 차를 만들어 보세요') && (await page.locator('#ov [data-act="plan"]').count()) === 1);
check('3D 캔버스가 있음', await page.locator('#cv').isVisible());
await page.waitForTimeout(600);
await shot('garage-empty');

// ---- 기획 ----
await act('plan', '');
check('기획 화면: 결정 중 자동 멈춤', (await G(() => window.__car.screen)) === 'plan' && (await G(() => window.__car.held())) && (await page.locator('#held').isVisible()));
await page.fill('#pname', '미라지');
check('기획: 이름 입력이 무대 글자에 반영', (await page.locator('#ov .model').innerText()).includes('미라지'));
await act('ptab', '[data-v="seg"]'); await act('pick', '[data-k="segment"][data-v="family"]');
await act('ptab', '[data-v="power"]'); await act('pick', '[data-k="tier"][data-v="3"]');
await act('ptab', '[data-v="opt"]'); await act('opt', '[data-v="radio"]');
await act('ptab', '[data-v="dir"]');
check('개발 방향: 10점을 다 쓰면 + 버튼이 막힘', await page.locator('[data-act="dir"][data-k="P"][data-v="1"]').isDisabled());
await act('dir', '[data-k="E"][data-v="-1"]');
check('개발 방향: 점수가 남으면 개발 시작이 막힘', await page.locator('[data-act="startDev"]').isDisabled());
await act('dir', '[data-k="P"][data-v="1"]');
check('개발 방향: 합계 10점이면 개발 시작 가능', !(await page.locator('[data-act="startDev"]').isDisabled()));
await act('ptab', '[data-v="budget"]');
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
check('4배속: 실제 시간으로 주가 흐름(1주 = 0.375초)', w1 - w0 >= 4 && w1 - w0 <= 8, `${w0} → ${w1}`);
await page.click('#speeds button[data-speed="0"]');
await tick(3);
check('개발 진행: 단계·능력치 막대·결함·주간 기록', (await page.locator('#panel').innerText()).includes('남은 결함') && (await page.locator('#panel .log li').count()) >= 3 && (await page.locator('#panel .stat').count()) === 5);
await page.waitForTimeout(400);
await shot('dev');
check('설계 중에는 출시 준비 버튼이 막힘', await page.locator('[data-act="toLaunch"]').isDisabled());
await untilReady();
check('시험 2주 뒤 출시 준비 버튼이 열림', !(await page.locator('[data-act="toLaunch"]').isDisabled()));

// ---- 출시 ----
await act('toLaunch');
check('출시 화면: 결정 중 멈춤, 예상 평점·예상 월 판매', (await G(() => window.__car.held())) && (await page.locator('#panel').innerText()).includes('예상 월 판매'));
await page.$eval('#lprice', (el) => { el.value = '1300'; el.dispatchEvent(new Event('input', { bubbles: true })); });
check('가격 슬라이더가 가격 표시를 바꿈', (await page.locator('#lp-out').innerText()).includes('1,300'));
await act('lset', '[data-k="color"][data-v="#1f4fd1"]');
await act('lset', '[data-k="wheels"][data-v="2"]');
check('색·휠 선택이 무대 글자에 반영', (await page.locator('#ov .spec').innerText()).includes('코발트') && (await page.locator('#ov .spec').innerText()).includes('큰 휠'));
await page.waitForTimeout(900);
await shot('launch');
await act('doLaunch');
await page.waitForSelector('#sheet:not([hidden])');
await page.waitForTimeout(4200);
const rv = await page.locator('#sheet').innerText();
check('리뷰: 평론가 4명·평균·신문', (await page.locator('#sheet .critic').count()) === 4 && (await page.locator('#sheet .critic.wait').count()) === 0 && rv.includes('모터 데일리') && rv.includes('평균'));
check('출시: 판매 중 차 1대, 가격 1300·코발트·큰 휠', await G(() => { const g = window.__car.game.state.nameplates[0]?.generations[0]; const e = g?.editions[0]; return g?.status === 'onSale' && e.price === 1300 && e.color === '#1f4fd1' && e.wheels === 2; }));
await shot('review');
await act('closeReview');
await page.waitForTimeout(300);
check('출시 순간 3D 사진이 저장 데이터에 들어감', await G(() => Object.values(window.__car.ui.photos).some((x) => x.startsWith('data:image/jpeg'))));

// ---- 판매 ----
await tick(16);
const gen = await G(() => window.__car.game.state.nameplates[0].generations[0]);
check('몇 달 진행: 판매 발생', gen.totalSold > 0 && gen.sales.length >= 3, `누적 ${gen.totalSold}대, 달별 ${gen.sales.join(',')}`);
const gtext = await page.locator('#panel').innerText();
check('차고 카드: 판매·누적·대당 이익·평론·수명·조언·단종 버튼', ['지난달 판매', '누적 판매', '대당 이익', '평론 평균', '수명'].every((t) => gtext.includes(t)) && (await page.locator('#panel .advice').count()) === 1 && (await page.locator('[data-act="discontinue"]').count()) === 1);
check('페이스리프트·풀체인지는 비활성(2단계)', gtext.includes('2단계에서 열립니다'));
await page.$eval('#gprice', (el) => { el.value = '1500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await act('setPrice');
check('가격 변경: 1500만원 반영', (await G(() => window.__car.game.state.nameplates[0].generations[0].editions[0].price)) === 1500);
await act('setMk', '[data-v="2"]');
check('마케팅 변경', (await G(() => window.__car.game.state.nameplates[0].generations[0].marketing)) === 2);
await page.waitForTimeout(500);
await shot('garage');

// ---- 회사·기록 ----
await page.click('#tabs button[data-tab="company"]');
const ctext = await page.locator('#panel').innerText();
check('회사 탭: 재무·직원 4명·공장·경쟁사', ctext.includes('재무') && (await page.locator('#panel .tbl').first().count()) === 1 && ctext.includes('직원 4명') && ctext.includes('공장') && ctext.includes('도요다'));
const cash0 = await G(() => window.__car.game.state.cash);
await act('borrow', '[data-v="10000"]');
check('대출 1억 받기', (await G(() => window.__car.game.state.cash)) - cash0 === 10000 && (await G(() => window.__car.game.state.loan.balance)) === 10000);
await act('repay', '[data-v="all"]');
check('대출 모두 갚기', (await G(() => window.__car.game.state.loan.balance)) === 0);
await shot('company');
await page.click('#tabs button[data-tab="records"]');
check('기록 탭: 낸 차와 출시 사진', (await page.locator('#panel .rec').count()) === 1 && (await page.locator('#panel .rec img').count()) === 1);
await shot('records');
await page.click('#tabs button[data-tab="garage"]');

// ---- 저장 → 새로 고침 → 이어 하기 ----
await page.click('#menubtn');
await act('saveSlot', '[data-v="slot1"]');
await page.waitForTimeout(400);
const snap = await G(() => JSON.stringify(window.__car.game.toJSON()));
await act('closeSheet');
await page.reload();
await page.waitForSelector('#title:not([hidden])');
check('새로 고침 뒤 타이틀에 이어 하기·저장 칸 1', (await page.locator('[data-act="continue"]').count()) === 1 && (await page.locator('[data-act="loadSlot"][data-v="slot1"]').count()) === 1);
await act('loadSlot', '[data-v="slot1"]');
check('저장 칸 1 불러오기: 상태 일치', (await G(() => JSON.stringify(window.__car.game.toJSON()))) === snap);
check('불러온 뒤에도 출시 사진 유지', await G(() => Object.keys(window.__car.ui.photos).length === 1));

// ---- 단종 → 두 번째 차 ----
await act('discontinue');
check('단종 확인 창(화면 안)', await page.locator('#ask').isVisible() && (await page.locator('#ask-text').innerText()).includes('생산 라인'));
await page.click('#ask-yes');
check('단종 신청: 이번 달 말 단종', (await G(() => window.__car.game.state.nameplates[0].generations[0].status)) === 'ending');
await act('plan');
await page.fill('#pname', '솔라');
await act('startDev');
await untilReady();
await act('toLaunch');
check('두 번째 차 출시 화면', (await G(() => window.__car.screen)) === 'launch');
await act('doLaunch');
await page.waitForSelector('#sheet:not([hidden])');
await act('closeReview');
check('두 번째 차 출시: 차종 2개, 첫 차는 단종', await G(() => { const n = window.__car.game.state.nameplates; return n.length === 2 && n[0].generations[0].status === 'discontinued' && n[1].generations[0].status === 'onSale'; }));

// ---- 생산 라인이 없을 때 출시 막기 ----
await act('plan'); await act('startDev'); await untilReady(); await act('toLaunch');
check('생산 라인이 없으면 출시 버튼이 막히고 이유 표시', (await page.locator('[data-act="doLaunch"]').isDisabled()) && (await page.locator('#panel').innerText()).includes('생산 라인이 모두 차 있습니다'));
await page.click('#tabs button[data-tab="dev"]');
await act('cancelDev'); await page.click('#ask-yes');
check('개발 취소(확인 창)', (await G(() => window.__car.game.state.projects.length)) === 0);

// ---- 가로 넘침 ----
for (const [w, h] of [[1366, 1024], [1480, 925], [400, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  const res = [];
  for (const t of ['garage', 'dev', 'company', 'records']) { await page.click(`#tabs button[data-tab="${t}"]`); await page.waitForTimeout(80); res.push(await overflow()); }
  await page.click('#tabs button[data-tab="dev"]'); await act('plan'); await page.waitForTimeout(80); res.push(await overflow());
  if (w === 400) { await shot('phone-plan'); await page.click('#tabs button[data-tab="garage"]'); await page.waitForTimeout(400); await shot('phone-garage'); }
  else await page.click('#tabs button[data-tab="garage"]');
  check(`가로 넘침·본문 스크롤 없음 ${w}×${h}`, res.every((x) => x <= 0), res.join(','));
}
await page.setViewportSize({ width: 1366, height: 1024 });

// ---- 파산 화면(점검용으로 상태를 직접 바꿈) ----
await G(() => { window.__car.game.state.status = 'gameOver'; window.__car.render(); });
check('파산 화면: 버틴 기간·낸 차·누적 판매·구제 금융·새 게임', (await page.locator('#title').innerText()).includes('파산') && (await page.locator('#title').innerText()).includes('버틴 기간') && (await page.locator('#title').innerText()).includes('구제 금융') && (await page.locator('#title [data-act="newGame"]').count()) === 1);
await shot('gameover');

check('콘솔 오류 0건', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fails.length ? `FAIL ${fails.length}건 / ${checks}항목` : `ALL PASS ${checks}항목`);
await done(fails.length ? 1 : 0);
