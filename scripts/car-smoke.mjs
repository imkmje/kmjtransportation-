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
const halt = async (e) => { if (process.argv[2]) await page.screenshot({ path: process.argv[2].replace('.png', '-halt.png') }).catch(() => {}); console.log(`FAIL 점검이 중간에 멈춤(${checks}번째 항목 뒤): ${String(e?.message ?? e).split('\n').slice(0, 6).join(' | ')}`); await done(1); };
process.on('uncaughtException', halt); process.on('unhandledRejection', halt);
const check = (name, ok, detail = '') => { checks++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) fails.push(name); };
const shot = (n) => !process.argv[2] ? Promise.resolve() : page.screenshot({ path: process.argv[2].replace('.png', `-${n}.png`), timeout: 60000 }).catch((e) => console.log('WARN 스크린샷 실패:', n, String(e.message).split('\n')[0]));
const G = (fn, arg) => page.evaluate(fn, arg);
const tick = (n) => G((k) => window.__car.tick(k), n);
const act = async (a, extra = '') => { await page.locator(`[data-act="${a}"]${extra}`).first().click(); };
const overflow = () => G(() => { const p = document.getElementById('panel'); return Math.max(document.documentElement.scrollWidth - window.innerWidth, document.body.scrollHeight - window.innerHeight, p.scrollWidth - p.clientWidth); }); // 화면 가로 넘침, 본문 세로 스크롤, 패널 안 가로 넘침
/** 시험이 출시 가능해질 때까지 진행 */
/** 출시하기: 결함이 많다는 확인 창이 뜨면 "그래도 출시" */
const launchNow = async () => { await act('doLaunch'); if (await page.locator('#ask').isVisible()) await page.click('#ask-yes'); };
/** 기획 마지막 단계(예산·기간)로 가서 개발 시작 */
const startDev = async () => { await act('ptab', '[data-v="budget"]'); await act('startDev'); };
/** [신차 기획] → (차종이 있으면 첫 화면에서) 새 차종 만들기 */
const planNew = async () => { await act('plan'); if ((await G(() => window.__car.screen)) === 'start') await act('pickNew'); };
/** 메뉴 열기: 혹시 열린 결과 창이 있으면 먼저 닫는다(가려진 #menubtn을 누르려고 끝없이 기다리는 일을 막음) */
const openMenu = async () => { if (await page.locator('#sheet').isVisible()) await page.locator('#sheet [data-act="closeReview"],#sheet [data-act="closeSheet"]').first().click(); await page.click('#menubtn', { timeout: 5000 }); await page.waitForSelector('#sheet:not([hidden])'); };
const monthsSinceLaunch = () => G(() => { const s = window.__car.game.state, g = s.nameplates[0].generations.at(-1); return Math.floor(s.week / 4) - g.launchMonth; });
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
check('차종이 없으면 [신차 기획]이 첫 화면 없이 바로 새 차종 기획으로', (await G(() => window.__car.screen)) === 'plan' && (await page.locator('.choice').count()) === 0);
check('기획 화면: 결정 중 자동 멈춤', (await G(() => window.__car.screen)) === 'plan' && (await G(() => window.__car.held())) && (await page.locator('#held').isVisible()));
check('기획 첫 단계: [이전] 없음, [다음]만 있고 [개발 시작] 없음', (await page.locator('#panel [data-act="ptab"]:not([role])').allInnerTexts()).join() === '다음 →' && (await page.locator('[data-act="startDev"]').count()) === 0);
check('새 차종 기획 단계에 "모양" 단계가 차체 다음', (await page.locator('#panel [role="tab"]').allInnerTexts()).map((t) => t.replace(/\s+/g, '')).slice(0, 3).join() === '1차체,2모양,3고객층');
await page.fill('#pname', '미라지');
check('기획: 이름 입력이 무대 글자에 반영', (await page.locator('#ov .model').innerText()).includes('미라지'));
await act('ptab', '[data-v="seg"]'); await act('pick', '[data-k="segment"][data-v="family"]');
await act('ptab', '[data-v="power"]'); await act('pick', '[data-k="tier"][data-v="3"]');
await act('ptab', '[data-v="opt"]'); await act('opt', '[data-v="radio"]');
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
check('4배속: 실제 시간으로 주가 흐름(1주 = 0.375초)', w1 - w0 >= 4 && w1 - w0 <= 8, `${w0} → ${w1}`);
await page.click('#speeds button[data-speed="0"]');
await tick(3);
check('개발 진행: 단계·능력치 막대·결함·주간 기록', (await page.locator('#panel').innerText()).includes('남은 결함') && (await page.locator('#panel .log li').count()) >= 3 && (await page.locator('#panel .stat').count()) === 5);
await page.waitForTimeout(400);
await shot('dev');
check('설계 중에는 출시 준비 버튼이 막힘', await page.locator('[data-act="toLaunch"]').isDisabled());
await untilReady();
check('시험 2주 뒤 출시 준비 버튼이 열림', !(await page.locator('[data-act="toLaunch"]').isDisabled()));
check('시험 단계: 결함이 많으면 "아직 많습니다" 경고', (await page.locator('#panel .defect-adv[data-level="many"]').count()) === 1 && (await page.locator('#panel .defect-adv').innerText()).includes('아직 많습니다'), `결함 약 ${await G(() => window.__car.game.state.projects[0].defectEst)}개`);
await page.waitForTimeout(400);
await shot('dev-test');

// ---- 출시 ----
await act('toLaunch');
check('출시 화면: 결정 중 멈춤, 예상 평점·예상 월 판매', (await G(() => window.__car.held())) && (await page.locator('#panel').innerText()).includes('예상 월 판매'));
const ltop = await page.locator('#panel .card').first().innerText();
check('출시 화면 맨 위: 남은 결함·경고·예상 리콜 위험', ltop.includes('남은 결함') && ltop.includes('아직 많습니다') && /연 \d+\s*%/.test(ltop.replace(/\n/g, ' ')), ltop.replace(/\n/g, ' ').slice(0, 80));
check('예상 월 판매를 쉬운 말로', /한 달에 약 \d+~\d+대 팔릴 것으로 보입니다\(공장 한도 300대\)/.test(await page.locator('#panel .sales-fc').innerText()));
check('출시 화면: 화면에 붙어 있는(sticky·fixed) 버튼 줄 없음', await G(() => [...document.querySelectorAll('#panel *')].every((el) => !['sticky', 'fixed'].includes(getComputedStyle(el).position))));
check('출시 화면: [출시하기]가 패널 내용 마지막 버튼 줄에 있음(바로 위 요약)', await G(() => { const rows = document.querySelectorAll('#panel .row'), last = rows[rows.length - 1], card = document.querySelector('#panel > .card:last-child'); return !!last && card?.contains(last) && last.lastElementChild?.dataset.act === 'doLaunch' && last.firstElementChild?.dataset.v === 'dev' && card.querySelector('.launch-sum')?.textContent.includes('이 조건으로 출시합니다'); }));
await page.locator('#panel [data-act="tab"][data-v="dev"]').click();
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
await page.$eval('#lprice', (el) => { el.value = '1300'; el.dispatchEvent(new Event('input', { bubbles: true })); });
check('가격 슬라이더가 가격 표시를 바꿈', (await page.locator('#lp-out').innerText()).includes('1,300'));
await act('lset', '[data-k="color"][data-v="#1f4fd1"]');
await act('lset', '[data-k="wheels"][data-v="2"]');
check('색·휠 선택이 무대 글자에 반영', (await page.locator('#ov .spec').innerText()).includes('코발트') && (await page.locator('#ov .spec').innerText()).includes('큰 휠'));
await page.waitForTimeout(900);
await shot('launch');
await act('doLaunch');
await page.click('#ask-yes');
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
check('차고: 출시 직후 [페이스리프트][풀체인지]는 흐리게 + 이유·남은 개월', (await page.locator('[data-act="goLift"]').isDisabled()) && (await page.locator('[data-act="goFull"]').isDisabled()) && /페이스리프트: 출시 후 18개월이 지나야 합니다\. 앞으로 \d+개월/.test(gtext) && /풀체인지: 출시 후 36개월이 지나야 합니다\. 앞으로 \d+개월/.test(gtext));
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
await openMenu();
await act('saveSlot', '[data-v="slot1"]');
await page.waitForTimeout(400);
const snap = await G(() => JSON.stringify(window.__car.game.toJSON()));
await act('closeSheet');
await page.reload();
await page.waitForSelector('#title:not([hidden])');
check('새로 고침 뒤 타이틀에 이어 하기·저장 칸 1', (await page.locator('[data-act="continue"]').count()) === 1 && (await page.locator('[data-act="loadSlot"][data-v="slot1"]').count()) === 1);
await act('loadSlot', '[data-v="slot1"]');
await page.waitForFunction(() => window.__car.game); // 불러오기는 비동기(IndexedDB)
await page.click('#speeds button[data-speed="0"]'); // 실제 시간은 멈춘다: 1배속으로 두면 점검이 길어질 때 회사가 실제로 파산해 파산 화면이 #menubtn 등을 가린다
check('저장 칸 1 불러오기: 상태 일치', (await G(() => JSON.stringify(window.__car.game.toJSON()))) === snap);
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
await page.fill('#pname', '솔라');
await startDev();
await untilReady();
await act('toLaunch');
check('두 번째 차 출시 화면', (await G(() => window.__car.screen)) === 'launch');
await launchNow();
await page.waitForSelector('#sheet:not([hidden])');
await act('closeReview');
check('두 번째 차 출시: 차종 2개, 첫 차는 단종', await G(() => { const n = window.__car.game.state.nameplates; return n.length === 2 && n[0].generations[0].status === 'discontinued' && n[1].generations[0].status === 'onSale'; }));

// ---- 생산 라인이 없을 때 출시 막기 ----
await planNew(); await startDev(); await untilReady(); await act('toLaunch');
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

// ---- 무대 그리기: 회사·기록 탭에서는 멈춤 ----
await page.click('#tabs button[data-tab="company"]');
const offCo = await G(() => window.__car.stage?.active);
await page.click('#tabs button[data-tab="garage"]');
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
check('두 번째 파산: 구제 금융 버튼 비활성 + 이유', (await page.locator('#title [data-act="bailout"]').isDisabled()) && (await page.locator('#title').innerText()).includes('이미 받았습니다'));

// ---- 시험을 충분히 한 차(시드 1, 균등·12주·보통·표준 동력·기준가): 평론 4.0 이상, 6개월 뒤 월 30대 이상 ----
await act('newGame');
await page.fill('#t-co', '시험 모터스');
await page.click('#title details summary');
await page.fill('#t-seed', '1');
await act('startNew');
await page.click('#speeds button[data-speed="0"]'); // 실제 시간은 멈추고 tick으로만 진행(시드 고정 측정)
await act('plan');
await page.locator('[data-act="pick"][data-k="color"][data-v="#1f5c4a"]').click();
check('기획 차체 단계에 색상 8가지, 고른 색 표시', (await page.locator('#panel [data-act="pick"][data-k="color"]').count()) === 8 && (await G(() => document.querySelector('[data-k="color"][aria-pressed="true"]')?.dataset.v)) === '#1f5c4a');
await startDev();
await G(() => { const c = window.__car; let i = 0; while (i++ < 80) { const p = c.game.state.projects[0]; if (p.phase === 'test' && p.testWeeks >= 2 && p.defectEst <= 5) break; c.tick(1); } c.render(); });
check('결함 5개 이하: "출시해도 좋습니다"', (await page.locator('#panel .defect-adv[data-level="ok"]').innerText()).includes('출시해도 좋습니다'), `결함 약 ${await G(() => window.__car.game.state.projects[0].defectEst)}개, 시험 ${await G(() => window.__car.game.state.projects[0].testWeeks)}주`);
// 저장 → 불러오기 뒤에도 기획 색 유지
await openMenu(); await act('saveSlot', '[data-v="slot2"]'); await page.waitForTimeout(300); await act('closeSheet');
await openMenu(); await act('loadSlot', '[data-v="slot2"]'); await page.click('#ask-yes'); await page.waitForTimeout(300);
await page.click('#speeds button[data-speed="0"]');
await page.click('#tabs button[data-tab="dev"]');
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
await page.click('#tabs button[data-tab="dev"]');
await page.waitForTimeout(300);
check('개발 탭(개발 없음): 쉬는 사무실 + [신차 기획]', await G(() => { const o = window.__car.office; return o.on && o.view?.phase === 'rest' && o.view.staff.length === 4; }) && (await page.locator('#office:not([hidden]) svg').count()) >= 1 && (await page.locator('#ov [data-act="plan"]').count()) === 1 && (await page.locator('#cv').isHidden()));
check('사무실이 보이면 3D 무대 그리기 멈춤', (await G(() => window.__car.stage?.active)) === false);
await shot('office-rest');
await act('plan');
check('기획 첫 화면(차종 있음): 3갈래, 풀체인지·손보기는 남은 개월과 함께 흐림', (await page.locator('.choice').count()) === 3 && (await page.locator('.choice[data-v="new"]').isEnabled()) && (await page.locator('.choice[data-v="full"]').isDisabled()) && /앞으로 \d+개월/.test(await page.locator('.choice[data-v="full"]').innerText()) && /앞으로 \d+개월/.test(await page.locator('.np .why').first().innerText()));
await page.waitForTimeout(400);
await shot('start');
await act('pickNew');
await act('ptab', '[data-v="look"]');
await page.waitForTimeout(300);
const looks = await G(() => [...document.querySelectorAll('.opt.look')].map((b) => ({ k: b.dataset.k, v: Number(b.dataset.v), t: b.querySelector('small')?.textContent ?? '', img: !!b.querySelector('img,svg') })));
check('모양 단계: 옆모습 후보 3개 + 얼굴 후보 3개, 썸네일과 한 줄 설명', looks.filter((x) => x.k === 'chassisSeed').length === 3 && looks.filter((x) => x.k === 'faceSeed').length === 3 && looks.every((x) => x.img && x.t.length > 2), looks.map((x) => x.t).join(' / '));
const pickC = looks.filter((x) => x.k === 'chassisSeed')[1].v, pickF = looks.filter((x) => x.k === 'faceSeed')[2].v;
await act('pick', `[data-k="chassisSeed"][data-v="${pickC}"]`); await act('pick', `[data-k="faceSeed"][data-v="${pickF}"]`);
await page.waitForTimeout(600);
await shot('look');
await startDev();
check('고른 모양 시드가 개발 명령에 들어감', await G(([c, f]) => { const p = window.__car.game.state.projects[0]; return p?.chassisSeed === c && p.faceSeed === f; }, [pickC, pickF]));
await tick(1);
check('개발 탭: 사무실(직원 4명, 설계 중)', await G(() => { const o = window.__car.office; return o.on && o.view?.phase === 'design' && o.view.staff.length === 4 && o.view.staff.every((x) => x.working); }));
const sc0 = await G(() => window.__car.office.scores);
await tick(2);
check('한 주가 지나면 사무실에 점수 연출이 나감', (await G(() => window.__car.office.scores)) > sc0, `${sc0} → ${await G(() => window.__car.office.scores)}`);
check('사무실 위 글자는 위쪽 가장자리에만(무대 위 1/3 안)', await G(() => { const o = document.querySelector('#ov .ofc').getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect(); return o.bottom <= st.top + st.height / 3; }));
await page.waitForTimeout(1200);
await shot('office-design');
await page.setViewportSize({ width: 1480, height: 925 }); await page.waitForTimeout(800); await shot('office-1480');
await page.setViewportSize({ width: 1366, height: 1024 });
await page.click('#tabs button[data-tab="garage"]');
check('차고로 가면 사무실을 멈추고 3D를 다시 그림', await G(() => !window.__car.office.on && window.__car.stage?.active === true));
await page.click('#tabs button[data-tab="dev"]');
await act('cancelDev'); await page.click('#ask-yes');

// ---- 페이스리프트(출시 18개월 뒤) ----
await page.click('#tabs button[data-tab="garage"]');
await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; while (Math.floor(s.week / 4) - g.launchMonth < 18) c.tick(1); c.render(); });
const life0 = Number(await page.locator('#panel .life').first().getAttribute('aria-valuenow'));
check('18개월 뒤 차고 [페이스리프트]가 열림', await page.locator('[data-act="goLift"]').isEnabled(), `출시 ${await monthsSinceLaunch()}개월`);
await act('goLift');
check('페이스리프트 화면: 지금 얼굴 + 새 얼굴 후보 3개(정면 썸네일)', (await G(() => window.__car.screen)) === 'lift' && (await page.locator('.faces .face.now').count()) === 1 && (await page.locator('.faces .opt.face img, .faces .opt.face svg').count()) === 3);
const ltext = await page.locator('#panel').innerText();
check('페이스리프트 예상: 비용·기간·디자인·수명 전후·인지도 전후', ['비용', '기간', '디자인', '수명', '인지도', '손본 뒤'].every((t) => ltext.includes(t)));
check('동력 단계는 낮출 수 없음', await G(() => { const g = window.__car.game.state.nameplates[0].generations[0], t = g.editions[0].tier; return [...document.querySelectorAll('[data-act="liftPick"][data-k="tier"]')].every((b) => b.disabled === Number(b.dataset.v) < t); }));
const face2 = Number(await page.locator('.faces .opt.face').nth(1).getAttribute('data-v'));
await page.locator('.faces .opt.face').nth(1).click();
await page.waitForTimeout(500);
await shot('lift');
await page.locator('.lift-est').scrollIntoViewIfNeeded(); await page.waitForTimeout(200);
check('페이스리프트 예상 칸 숫자가 잘리지 않음', await G(() => [...document.querySelectorAll('.lift-est .kpi b')].every((b) => b.scrollWidth <= b.clientWidth)));
await shot('lift-est');
await act('startLift');
check('페이스리프트 시작: 종류·고른 얼굴 시드', await G(([f]) => { const p = window.__car.game.state.projects[0]; return p?.kind === 'facelift' && p.faceSeed === f; }, [face2]) && (await page.locator('#ov').innerText()).includes('페이스리프트 중'));
await untilReady();
await page.waitForTimeout(800);
await shot('office-test');
check('개발 탭: 시험 중 사무실', await G(() => window.__car.office.view?.phase === 'test'));
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
await page.waitForTimeout(300);
const life1 = Number(await page.locator('#panel .life').first().getAttribute('aria-valuenow'));
check('수명 막대 상승', life1 > life0, `${life0} → ${life1}`);
check('차고 표시: "1세대 · 페이스리프트", 페이스리프트 사진 저장', (await page.locator('#ov .model').innerText()).includes('페이스리프트') && await G((id) => !!window.__car.ui.photos['e' + id], lifted.id));
await page.waitForTimeout(500);
await shot('garage-lift');

// ---- 풀체인지(출시 36개월 뒤) ----
await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; while (Math.floor(s.week / 4) - g.launchMonth < 36) c.tick(1); c.render(); });
check('36개월 뒤 차고 [풀체인지]가 열리고, [페이스리프트]는 "세대당 1회"로 흐림', (await page.locator('[data-act="goFull"]').isEnabled()) && (await page.locator('[data-act="goLift"]').isDisabled()) && (await page.locator('#panel').innerText()).includes('세대당 1회'));
await page.waitForTimeout(400);
await shot('garage-buttons');
await act('goFull');
const prevText = await page.locator('#panel').innerText();
check('풀체인지 첫 단계: 전 세대 요약(평론·누적 판매·이름값·이어받는 것)', (await G(() => window.__car.screen)) === 'plan' && ['평론 평균', '누적 판매', '이름값', '이어받는 것', '전작 대비'].every((t) => prevText.includes(t)) && (await page.locator('#pname').count()) === 0);
await page.waitForTimeout(500);
await shot('fullchange');
await act('ptab', '[data-v="body"]');
const otherBody = await G(() => [...document.querySelectorAll('[data-act="pick"][data-k="body"]')].find((b) => b.getAttribute('aria-pressed') !== 'true')?.dataset.v);
const sameBody = await G(() => document.querySelector('[data-act="pick"][data-k="body"][aria-pressed="true"]')?.dataset.v);
if (otherBody) { await act('pick', `[data-k="body"][data-v="${otherBody}"]`); check('차체를 바꾸면 "이름값이 절반만" 경고', (await page.locator('.body-warn').innerText()).includes('절반만')); await act('pick', `[data-k="body"][data-v="${sameBody}"]`); }
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
const fc = await G(() => { const s = window.__car.game.state, n = s.nameplates[0]; return { gens: n.generations.length, st: n.generations[0].status, end: n.generations[0].endMonth, m: Math.floor(s.week / 4), no: n.generations[1]?.number }; });
check('풀체인지 출시: 세대 2, 전 세대는 이번 달 말 단종 예정', fc.gens === 2 && fc.no === 2 && fc.st === 'ending' && fc.end === fc.m, JSON.stringify(fc));
await G(() => { const c = window.__car, s = c.game.state, m = Math.floor(s.week / 4); while (Math.floor(s.week / 4) === m) c.tick(1); c.render(); });
check('다음 달: 전 세대 단종', (await G(() => window.__car.game.state.nameplates[0].generations[0].status)) === 'discontinued');
await page.click('#tabs button[data-tab="records"]');
await page.waitForTimeout(400);
check('기록 탭 차종 계보: 세대 2개, 단종(연·월)·판매 중·페이스리프트 표시', await G(() => { const c = document.querySelector('.lineage-card'); const t = c?.innerText ?? ''; return c?.querySelectorAll('.rec').length === 2 && /단종\(\d+년 \d+월\)/.test(t) && t.includes('판매 중') && t.includes('페이스리프트'); }));
await shot('lineage');

// ---- 폰: 알림이 맨 아래 버튼 줄을 가리지 않음 ----
await page.setViewportSize({ width: 400, height: 800 });
for (const [t, n] of [['garage', 'phone-garage2'], ['dev', 'phone-office']]) {
  await page.click(`#tabs button[data-tab="${t}"]`);
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
await page.click('#tabs button[data-tab="garage"]');

// ---- 차고가 비면 무대도 빈 원판 ----
check('판매 중인 차가 있으면 무대에 차가 있음', (await G(() => window.__car.stage?.empty)) === false);
await act('discontinue'); await page.click('#ask-yes');
await G(() => { const c = window.__car; c.tick(1); while (c.game.state.week % 4 !== 0) c.tick(1); c.tick(1); });
check('단종 뒤 차고가 비면 무대에서 차를 치움(빈 원판)', (await G(() => window.__car.stage?.empty)) === true && (await page.locator('#ov').innerText()).includes('판매 중인 차가 없습니다') && (await page.locator('#cv').isVisible()));
await shot('garage-cleared');

// ---- 0.1.0 형식 저장 불러오기 ----
await openMenu();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
await chooser.setFiles('car/tests/fixtures/save-v1.json');
await page.waitForSelector('#ask:not([hidden])'); await page.click('#ask-yes');
await page.waitForFunction(() => window.__car.game?.state.companyName === '변환테스트');
await tick(4);
await page.click('#tabs button[data-tab="dev"]'); await page.click('#tabs button[data-tab="records"]'); await page.click('#tabs button[data-tab="garage"]');
check('0.1.0 형식 저장(형식 1) 불러와 이어 하기', await G(() => { const c = window.__car, s = c.game.state; return s.saveVersion === 2 && s.nameplates.length > 0 && typeof c.ui.photos === 'object' && typeof c.ui.colors === 'object'; }) && (await page.locator('#panel').isVisible()));

check('콘솔 오류 0건', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fails.length ? `FAIL ${fails.length}건 / ${checks}항목` : `ALL PASS ${checks}항목`);
await done(fails.length ? 1 : 0);
