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
check('차고(빈): 첫 차 안내와 신차 기획 버튼', (await page.locator('#ov').innerText()).includes('첫 차를 기획할 차례입니다') && (await page.locator('#ov [data-act="plan"]').count()) === 1);
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
await act('ptab', '[data-v="opt"]');
check('옵션: 1970년 시작엔 연구한 옵션이 없어 라디오는 흐리게 "연구 필요"', (await page.locator('.opt.locked[data-lock="option:radio"]').innerText()).includes('연구 필요') && (await page.locator('[data-act="opt"][data-v="radio"]').count()) === 0);
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
check('회사 탭: 안쪽 탭 5개(재무·직원·본사·공장·연구), 처음은 재무·경쟁사', (await page.locator('#panel .cotabs button').allInnerTexts()).join() === '재무,직원,본사,공장,연구' && ctext.includes('재무') && (await page.locator('#panel .tbl').first().count()) === 1 && ctext.includes('도요다') && ctext.includes('본사') && ctext.includes('공장'));
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
  for (const t of ['garage', 'dev', 'company', 'records']) {
    await page.click(`#tabs button[data-tab="${t}"]`); await page.waitForTimeout(80); res.push(await overflow());
    if (t === 'company') for (const c of ['staff', 'hq', 'factory', 'fin']) { await act('cotab', `[data-v="${c}"]`); await page.waitForTimeout(60); res.push(await overflow()); }
  }
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
await page.click('#tabs button[data-tab="garage"]');
check('차고로 가면 사무실을 멈추고 3D를 다시 그림', await G(() => !window.__car.office.on && window.__car.stage?.active === true));
await page.click('#tabs button[data-tab="dev"]');
await page.waitForTimeout(300);
check('개발 탭 → 차고 → 개발 탭: 사무실이 살아 있음(보이고, 직원이 그려지고, 무대 칸이 넓은 배치)', await G(() => { const o = document.getElementById('office'), svg = o.querySelector('svg'), r = o.getBoundingClientRect(); return window.__car.office.on && !o.hidden && !!svg?.getAttribute('viewBox') && o.querySelectorAll('.pp').length === 4 && r.width >= innerWidth * 0.8 && r.height > 300; }));
await act('cancelDev'); await page.click('#ask-yes');

// ---- 페이스리프트(출시 18개월 뒤) ----
await page.click('#tabs button[data-tab="garage"]');
await G(() => { const c = window.__car, s = c.game.state, g = s.nameplates[0].generations[0]; while (Math.floor(s.week / 4) - g.launchMonth < 18) c.tick(1); c.render(); });
const life0 = Number(await page.locator('#panel .life').first().getAttribute('aria-valuenow'));
check('18개월 뒤 차고 [페이스리프트]가 열림', await page.locator('[data-act="goLift"]').isEnabled(), `출시 ${await monthsSinceLaunch()}개월`);
await act('goLift');
check('페이스리프트 화면: 지금 얼굴 + 새 얼굴 후보 3개(정면 썸네일)', (await G(() => window.__car.screen)) === 'lift' && (await page.locator('.faces .face.now').count()) === 1 && (await page.locator('.faces .opt.face img, .faces .opt.face svg').count()) === 3);
const ltext = await page.locator('#panel').innerText();
check('페이스리프트 예상: 비용·기간·디자인·수명 전후·인지도 전후', ['비용', '기간', '디자인', '수명', '인지도', '바꾼 뒤'].every((t) => ltext.includes(t)));
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

// ---- 3단계: 회사(직원·본사·공장), 팀 고르기, 동시 개발 ----
const S3 = (fn, arg) => G(fn, arg);
const staffN = () => S3(() => window.__car.game.state.staff.length);
await openMenu(); await act('home'); await page.click('#ask-yes'); await page.waitForSelector('#title:not([hidden])');
await act('titleNew'); await page.fill('#t-co', '삼단 모터스'); await page.click('#title details summary'); await page.fill('#t-seed', '3'); await act('startNew');
await page.click('#speeds button[data-speed="0"]');
await page.click('#tabs button[data-tab="dev"]'); await page.waitForTimeout(300);
const vb1 = await S3(() => document.querySelector('#office svg')?.getAttribute('viewBox') ?? '');
await page.click('#tabs button[data-tab="company"]');
check('회사 탭: 안쪽 탭 5개', (await page.locator('#panel .cotabs [role="tab"]').count()) === 5);
await act('cotab', '[data-v="staff"]');
const st0 = await page.locator('#panel').innerText();
check('직원 탭: 직원 4명 표(이름·직무·능력·월급·컨디션·하는 일), 정원 4/4', (await page.locator('#panel .srow:not(.head)').count()) === 4 && st0.includes('4/4') && ['디자이너', '엔지니어', '테스터', '컨디션', '쉬는 중'].every((t) => st0.includes(t)));
check('정원이 찼으면 공고 대신 이유 + 본사 탭으로 가는 버튼', (await page.locator('.hire-full').innerText()).includes('정원(4명)이 찼습니다') && (await page.locator('.hire-card [data-act="cotab"][data-v="hq"]').count()) === 1 && (await page.locator('[data-act="postJob"]').count()) === 0);
check('정원이 찼으면 공고 명령도 거부 이유', await S3(() => { const r = window.__car.game.command({ type: 'postJob', role: 'designer', tier: 1 }); return !r.ok && r.reason.includes('정원'); }));
await page.locator('.hire-card [data-act="cotab"][data-v="hq"]').click();
const hq0 = await page.locator('#panel').innerText();
check('본사 탭: 5등급 단계·지금 등급(정원·개발 차 수·옵션 칸·유지비)·다음 등급 비교', (await page.locator('.lv5 li').count()) === 5 && (await page.locator('.lv5 li.on').innerText()).includes('창고 공장') && ['정원', '동시에 개발할 수 있는 차', '옵션 칸', '월 유지비', '승급 비용', '소형 사옥'].every((t) => hq0.includes(t)));
await G(() => { const s = window.__car.game.state; s.cash = 5000000; s.reputation = 40; window.__car.render(); }); // 점검용: 현금 500억·평판 40
await act('upgradeHQ');
check('본사 키우기: 확인 창', (await page.locator('#ask').isVisible()) && (await page.locator('#ask-text').innerText()).includes('본사'));
await page.click('#ask-yes');
await act('upgradeHQ'); await page.click('#ask-yes');
const hq3 = await S3(() => { const s = window.__car.game.state; return { lv: s.hqLevel }; });
check('본사 3등급: 정원 12·개발팀 2', hq3.lv === 3 && (await page.locator('#panel .hq-cur').innerText()).includes('4/12') && (await page.locator('.lv5 li.on').innerText()).includes('본사 빌딩'), JSON.stringify(hq3));
await shot('co-hq');
await act('cotab', '[data-v="staff"]');
await act('postJob', '[data-v="2"]');
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
await page.click('#tabs button[data-tab="garage"]');
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
check('6개월 뒤 공장 2등급: 월 생산 1,000·생산 라인 2', fac.level === 2 && !fac.build && (await page.locator('.fac-cur').innerText()).includes('1,000') && /1\/2/.test(await page.locator('.fac-cur').innerText()), JSON.stringify(fac));
check('증설 완료 알림(회사)', (await page.locator('#toasts').innerText()).includes('증설을 마쳤습니다'));
await page.click('#tabs button[data-tab="dev"]');
await page.locator('.pchip').last().click().catch(() => {});
await act('toLaunch'); await launchNow(); await page.waitForSelector('#sheet:not([hidden])'); await act('closeReview');
check('두 번째 차 동시 판매(생산 라인 2/2)', (await S3(() => window.__car.game.state.nameplates.filter((n) => n.generations.some((g) => g.status === 'onSale')).length)) === 2 && (await page.locator('#ov .lines').innerText()) === '2/2');
await tick(5);
await page.click('#tabs button[data-tab="company"]'); await act('cotab', '[data-v="factory"]');
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
await act('cotab', '[data-v="fin"]');
check('재무: 일회성 지출 줄, 유지비 본사·공장 나눔', (await page.locator('#panel').innerText()).includes('본사 유지비') && (await page.locator('#panel').innerText()).includes('공장 유지비') && (await page.locator('#panel').innerText()).includes('본사'));
await shot('co-fin');
for (const [w, h] of [[1366, 1024], [1480, 925], [400, 800]]) {
  await page.setViewportSize({ width: w, height: h });
  const res = [];
  for (const c of ['fin', 'staff', 'hq', 'factory']) { await act('cotab', `[data-v="${c}"]`); await page.waitForTimeout(100); res.push(await overflow()); if (w !== 1366 && (c === 'staff' || c === 'factory')) await shot(`${w === 400 ? 'phone' : 'w1480'}-${c}`); }
  await page.click('#tabs button[data-tab="dev"]'); await page.waitForTimeout(300); res.push(await overflow());
  await page.click('#tabs button[data-tab="company"]');
  check(`3단계 회사 탭·동시 개발 ${w}×${h}: 본문 스크롤·가로 넘침 없음`, res.every((x) => x <= 0), res.join(','));
}
await page.setViewportSize({ width: 1366, height: 1024 });
await page.click('#tabs button[data-tab="dev"]');
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
await page.click('#tabs button[data-tab="dev"]'); await page.click('#tabs button[data-tab="records"]'); await page.click('#tabs button[data-tab="garage"]');
check('0.1.0 형식 저장(형식 1) 불러와 이어 하기', await G(() => { const c = window.__car, s = c.game.state; return s.saveVersion === 4 && s.nameplates.length > 0 && typeof c.ui.photos === 'object' && typeof c.ui.colors === 'object'; }) && (await page.locator('#panel').isVisible()));
await openMenu();
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
await chooser2.setFiles('car/tests/fixtures/save-v2.json');
await page.waitForSelector('#ask:not([hidden])'); await page.click('#ask-yes');
await page.waitForFunction(() => window.__car.game?.state.companyName === '변환테스트2');
await tick(4);
for (const t of ['dev', 'records', 'company']) await page.click(`#tabs button[data-tab="${t}"]`);
for (const c of ['staff', 'hq', 'factory', 'fin']) await act('cotab', `[data-v="${c}"]`);
await page.click('#tabs button[data-tab="garage"]');
check('0.2.0 형식 저장(형식 2) 불러와 이어 하기', await G(() => { const s = window.__car.game.state; return s.saveVersion === 4 && s.hqLevel === 1 && s.staff.every((x) => typeof x.potential === 'number'); }) && (await page.locator('#panel').isVisible()));

await openMenu();
const [chooser3] = await Promise.all([page.waitForEvent('filechooser'), act('import')]);
await chooser3.setFiles('car/tests/fixtures/save-v3.json');
await page.waitForSelector('#ask:not([hidden])'); await page.click('#ask-yes');
await page.waitForFunction(() => window.__car.game?.state.saveVersion === 4 && window.__car.game.state.week > 0);
await tick(4);
for (const t of ['dev', 'records', 'company']) await page.click(`#tabs button[data-tab="${t}"]`);
for (const c of ['staff', 'hq', 'factory', 'research', 'fin']) await act('cotab', `[data-v="${c}"]`);
await page.click('#tabs button[data-tab="records"]'); for (const r of ['combo', 'news', 'cars']) await act('rectab', `[data-v="${r}"]`);
await page.click('#tabs button[data-tab="garage"]');
check('0.3.0 형식 저장(형식 3) 불러와 이어 하기(연구·사건·조합 노트 채워짐)', await G(() => { const s = window.__car.game.state; return s.saveVersion === 4 && Array.isArray(s.research.done) && Array.isArray(s.knownCombos) && !!s.events; }) && (await page.locator('#panel').isVisible()));

// ---- 4단계: 연구·시대 사건·조합 노트·차체 10종 ----
const S4 = (fn, arg) => G(fn, arg);
await openMenu();
check('메뉴: 역사 사건·시장 수치는 게임에 맞게 어림한 것이라는 한 줄', (await page.locator('#sheet .help-line').innerText()).includes('어림한 것'));
await act('home'); await page.click('#ask-yes'); await page.waitForSelector('#title:not([hidden])');
await act('titleNew'); await page.fill('#t-co', '사단 모터스'); await page.click('#title details summary'); await page.fill('#t-seed', '4'); await act('startNew');
await page.click('#speeds button[data-speed="0"]');
await page.click('#tabs button[data-tab="company"]');
check('회사 탭 안쪽 탭 5개(마지막이 연구)', (await page.locator('#panel .cotabs button').allInnerTexts()).join() === '재무,직원,본사,공장,연구');
await act('cotab', '[data-v="research"]');
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
check('연구 칸이 차면 다른 기술은 시작 거부 이유', (await page.locator('.tc[data-v="el_radio"] .why').innerText()).includes('연구 칸이 찼습니다'));
await tick(3); await page.waitForTimeout(100);
await shot('research-active');
await S4(() => { const c = window.__car; let i = 0; while (i++ < 200 && c.game.state.research.active.length) c.tick(1); c.render(); });
check('연구 완료 알림', (await page.locator('#toasts').innerText()).includes('연구 완료') && (await S4(() => window.__car.game.state.research.done.includes('bd_hatch'))));
await shot('unlock-toast');
check('연구 완료 알림 문장: 이름이 겹치지 않음', (await page.locator('#toasts').innerText()).includes('「해치백 차체」 연구를 마쳤습니다. 이제 해치백을 만들 수 있습니다.'));
check('연구 완료 뒤 카드 ✓ 완료', (await page.locator('.tc.done[data-v="bd_hatch"]').count()) === 1);
// 기획: 연구한 차체만 열림, 나머지는 흐리게 "연구 필요"
await page.click('#tabs button[data-tab="garage"]'); await planNew();
check('기획 차체: 연구한 해치백이 열림', (await page.locator('[data-act="pick"][data-k="body"][data-v="hatch"]').count()) === 1);
check('기획 차체 10종: 미해금은 흐리게 "연구 필요: ○○"', (await page.locator('.opt[data-k="body"], .opt.locked[data-lock^="body:"]').count()) === 10 && (await page.locator('.opt.locked[data-lock="body:sedanM"]').innerText()).includes('연구 필요: 중형 세단 차체'));
await page.waitForTimeout(400); await shot('plan-bodies');
await page.locator('.opt.locked[data-lock="body:sedanM"]').click();
check('흐린 차체를 누르면 연구 화면의 그 기술 상세로', (await S4(() => window.__car.screen)) === 'company' && (await page.locator('.tech-sheet[data-tech="bd_sedanM"]').count()) === 1);
await act('closeSheet');
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
check('옵션: 해금한 옵션 전부(8개) + 아직 먼 옵션은 개수 안내', (await page.locator('[data-act="opt"]').count()) === 8 && (await page.locator('#panel').innerText()).includes('그 밖에 8개 옵션'));
await shot('plan-options');
await act('pick', '[data-k="body"][data-v="sedanS"]').catch(() => {});
await page.fill('#pname', '조합');
await startDev();
await untilReady(); await act('toLaunch'); await launchNow(); await page.waitForSelector('#sheet:not([hidden])'); await page.waitForTimeout(4200); await act('closeReview');
await page.click('#tabs button[data-tab="records"]'); await act('rectab', '[data-v="combo"]');
check('출시 뒤 조합 노트에 궁합 기호·차 이름·평론', (await page.locator('.combo td.cn:not(.q)').count()) === 1 && /[◎○△×]/.test(await page.locator('.combo td.cn:not(.q)').innerText()) && (await page.locator('.combo td.cn:not(.q)').innerText()).includes('조합') && (await page.locator('.combo tr.off').count()) >= 7);
await shot('combo-notes');
await page.click('#tabs button[data-tab="garage"]'); await planNew(); await act('ptab', '[data-v="seg"]');
check('기획 고객층: 출시해 본 조합은 궁합 기호로', (await page.locator('.opt .tag.mk').count()) === 1 && /[◎○△×]/.test(await page.locator('.opt .tag.mk').innerText()));
await act('cancelPlan');
// 선택 사건: 시간을 보내 무작위 사건을 발생시킨다(창 띄우기 켬)
await S4(() => { const c = window.__car; let i = 0; while (i++ < 400 && !c.game.state.events.pending.length) c.tick(1, true); });
await page.waitForTimeout(300);
check('선택 사건: 자동 멈춤 + 화면 안 창(제목·설명·선택지·남은 주)', (await page.locator('#sheet .choice-sheet').isVisible()) && (await page.locator('.evc').count()) >= 2 && /\d+주 안에 고르지 않으면 「.+」(으)?로 정해집니다/.test(await page.locator('.choice-sheet').innerText()) && (await S4(() => window.__car.held())));
await page.waitForTimeout(600); await shot('choice');
await act('later');
check('[나중에]: 창이 닫히고 상단바에 "결정 대기 1"', (await page.locator('#sheet').isHidden()) && (await page.locator('#pend').innerText()) === '결정 대기 1');
await shot('pending');
await page.click('#pend');
const pick0 = await page.locator('.evc b').first().innerText();
await page.locator('.evc').first().click();
check('선택: 대기 0, 결과 알림, 뉴스에 결과', (await S4(() => window.__car.game.state.events.pending.length)) === 0 && (await page.locator('#toasts').innerText()).includes('결정 결과') && (await S4(() => window.__car.game.state.events.news.at(-1).text)).includes(pick0.split(' (')[0].split('\n')[0]) && (await page.locator('#pend').isHidden()));
// 진행 중 사건 칩(1차 오일쇼크)
await S4(() => { const c = window.__car; let i = 0; while (i++ < 600 && !document.getElementById('evchip').textContent.includes('오일쇼크')) c.tick(1); c.render(); });
if (await page.locator('#sheet').isVisible()) await page.locator('#sheet [data-act="later"],#sheet [data-act="closeSheet"],#sheet [data-act="closeReview"]').first().click();
check('상단바 사건 칩: "1차 오일쇼크 · 앞으로 N개월"', /1차 오일쇼크 · 앞으로 \d+개월/.test(await page.locator('#evchip').innerText()), await page.locator('#evchip').innerText());
await page.click('#evchip');
check('사건 창: 효과(쉬운 말)·충전소 보급률·필수 옵션', (await page.locator('.events-sheet').innerText()).includes('연비') && (await page.locator('.events-sheet').innerText()).includes('충전 인프라') && (await page.locator('.events-sheet').innerText()).includes('꼭 필요한 옵션'));
await page.waitForTimeout(600); await shot('events');
await act('closeSheet');
await page.click('#tabs button[data-tab="garage"]');
await S4(() => { const g = window.__car.game.state.nameplates[0].generations[0]; g.body = 'sedanL'; window.__car.render(); }); // 점검용: 차고 카드의 사건 영향 줄
check('차고 카드: 이 차가 받는 사건 영향 한 줄', (await page.locator('.ev-line').allInnerTexts()).some((t) => t.includes('1차 오일쇼크: 이 차는 대형 세단이라 35% 덜 팔립니다.')));
await page.waitForTimeout(400); await shot('garage-event');
await S4(() => { const g = window.__car.game.state.nameplates[0].generations[0]; g.body = 'sedanS'; window.__car.render(); });
await page.click('#tabs button[data-tab="records"]'); await act('rectab', '[data-v="news"]');
check('기록 뉴스: 최신이 위, 예고와 사건 시작 구분', (await page.locator('.nl').count()) >= 2 && (await page.locator('.nl.k-preview').count()) >= 1 && (await page.locator('.nl.k-start').count()) >= 1 && (await S4(() => window.__car.game.state.events.news.at(-1).text)).endsWith(await page.locator('.nl .nt').first().innerText().then((t) => t.replace(/^[^:]*: /, ''))));
await page.locator('.nl.k-start').first().click();
check('뉴스를 누르면 신문 한 장(지금 걸린 효과)', (await page.locator('#sheet .news.paper').isVisible()) && (await page.locator('#sheet').innerText()).includes('효과'));
await page.waitForTimeout(600); await shot('news-paper');
await act('closeReview');
await page.click('#tabs button[data-tab="records"]'); await page.waitForTimeout(200);
await shot('news-list');
// 알림 정리: 회사 탭에서 최대 2개 + "+N"
await page.click('#tabs button[data-tab="company"]'); await act('cotab', '[data-v="fin"]');
await G(() => { document.getElementById('toasts').innerHTML = ''; for (let i = 1; i <= 4; i++) window.__car.toast(`점검 알림 ${i}`, 'alert', '점검', 20000); });
await page.waitForTimeout(400);
const tpos = await G(() => { const vis = [...document.querySelectorAll('#toasts .toast')].filter((x) => getComputedStyle(x).display !== 'none'), r = document.getElementById('toasts').getBoundingClientRect(), top = document.getElementById('top').getBoundingClientRect(); return { n: vis.length, more: document.querySelector('#toasts .more')?.textContent ?? '', top: Math.round(r.top), topBar: Math.round(top.bottom), right: Math.round(innerWidth - r.right) }; });
check('회사 탭 알림: 오른쪽 위(상단바 아래)에 최대 2개 + "+N"', tpos.n === 2 && tpos.more.startsWith('+2 ') && tpos.top >= tpos.topBar && tpos.right <= 24, JSON.stringify(tpos));
await shot('co-toasts');
await G(() => document.querySelectorAll('#toasts .toast .x').forEach((b) => b.click()));
// 전담 연구원(본사 4등급)
await S4(() => { const s = window.__car.game.state; s.hqLevel = 4; window.__car.render(); });
await act('cotab', '[data-v="staff"]');
const eng = await S4(() => window.__car.game.state.staff.find((x) => x.role === 'engineer' && x.projectId === null)?.id);
await page.locator(`.srow[data-id="${eng}"]`).click();
await act('assign', `[data-id="${eng}"][data-v="lab"]`);
check('본사 4등급: [전담 연구원으로] → 전담 연구원', (await S4((id) => window.__car.game.state.staff.find((x) => x.id === id).lab, eng)) && (await page.locator(`.srow[data-id="${eng}"]`).innerText()).includes('전담 연구원'));
// 1990년쯤 연구 화면
await S4(() => { const s = window.__car.game.state; s.week = 20 * 48; s.research.done.push('bd_sedanM', 'pr_line', 'pr_qc', 'bd_sedanL', 'el_leather'); window.__car.render(); });
await act('cotab', '[data-v="research"]'); await page.waitForTimeout(200);
await shot('research-mid');
check('선행이 필요한 기술: 이유 "「미니밴 차체」 먼저"', (await page.locator('.tc[data-v="bd_suv"]').innerText()).includes('「미니밴 차체」 먼저') && (await page.locator('.tc[data-v="bd_suv"]').getAttribute('class')).includes('locked'), await page.locator('.tc[data-v="bd_suv"]').innerText());
await page.locator('.tc[data-v="bd_suv"]').click();
check('선행 필요 기술 상세: 연구 시작 막힘 + 거부 이유', (await page.locator('.tech-sheet [data-act="startResearch"]').isDisabled()) && (await page.locator('.tech-why').innerText()).includes('먼저'));
await act('closeSheet');
// 규제(1997년): 기획 경고·출시 거부 이유
await S4(() => { const s = window.__car.game.state; s.week = 27 * 48; s.factory.level = 2; window.__car.render(); }); // 점검용: 생산 라인 2개(규제 이유만 남게)
await page.click('#tabs button[data-tab="garage"]');
await planNew();
check('규제 경고(기획): "ABS·에어백이 없는 차는 출시할 수 없습니다. 옵션 단계에서 …"', (await page.locator('.reg-warn').innerText()).includes('ABS·에어백이 없는 차는 출시할 수 없습니다. 옵션 단계에서'));
await act('ptab', '[data-v="opt"]');
check('규제 옵션 강조', (await page.locator('.opt.req').count()) >= 1 && (await page.locator('.opt .reqtag').count()) >= 1);
await shot('reg-plan');
await page.fill('#pname', '규제'); await startDev();
await untilReady(); await act('toLaunch');
check('출시 화면: 규제 거부 이유(개발을 취소하고 다시 기획) + [출시하기] 막힘', (await page.locator('.reg-why').innerText()).includes('개발을 취소하고 신차 기획을 다시') && (await page.locator('[data-act="doLaunch"]').isDisabled()));
check('sim 출시 명령도 같은 이유로 거부', await S4(() => { const c = window.__car, p = c.game.state.projects[0], r = c.game.command({ type: 'launch', projectId: p.id, price: 1000, marketing: 0, color: '#c8202f', wheels: 1 }); return !r.ok && r.reason.includes('ABS'); }));
await shot('reg-launch');
await act('tab', '[data-v="dev"]'); await act('cancelDev'); await page.click('#ask-yes');
// 새 차체 5종 3D
await S4(() => { const s = window.__car.game.state; s.research.done.push('bd_minivan', 'bd_kei', 'bd_suv', 'bd_pickup', 'bd_coupe', 'bd_sports'); window.__car.render(); });
await planNew();
for (const b of ['sedanL', 'minivan', 'kei', 'pickup', 'sports']) {
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
  await page.click('#tabs button[data-tab="company"]'); await act('cotab', '[data-v="research"]'); await page.waitForTimeout(200); res.push(await overflow());
  if (w !== 1366) await shot(`${w === 400 ? 'phone' : 'w1480'}-research`);
  await page.click('#tabs button[data-tab="records"]');
  for (const r of ['combo', 'news', 'cars']) { await act('rectab', `[data-v="${r}"]`); res.push(await overflow()); }
  await page.click('#evchip'); await page.waitForTimeout(600); if (w === 400) await shot('phone-events'); await act('closeSheet');
  await page.click('#tabs button[data-tab="garage"]'); await page.waitForTimeout(200); res.push(await overflow());
  check(`4단계 화면(기획·연구·기록·차고) ${w}×${h}: 본문 스크롤·가로 넘침 없음`, res.every((x) => x <= 0), res.join(','));
  await planNew();
}
await act('cancelPlan');
// 폰: 선택 사건 창
await S4(() => { const c = window.__car; let i = 0; while (i++ < 600 && !c.game.state.events.pending.length) c.tick(1, true); });
if (await page.locator('.choice-sheet').count()) { await page.waitForTimeout(700); await shot('phone-choice'); check('폰: 선택 사건 창 가로 넘침 없음', (await G(() => document.querySelector('#sheet-body').scrollWidth - document.querySelector('#sheet-body').clientWidth)) <= 0); await act('later'); }
await page.setViewportSize({ width: 1366, height: 1024 });

// 전기차 앞모습(막힌 그릴): 점검용으로 판매 중인 차를 전기로 바꿔 차고 무대를 정면으로 돌린다
await page.click('#tabs button[data-tab="garage"]');
await S4(() => { const c = window.__car, g = c.game.state.nameplates.flatMap((n) => n.generations).find((x) => x.status === 'onSale'); if (!g) return; g.powertrain = 'ev'; c.render(); c.stage?.setAutoRotate(false); c.stage?.setYaw(-Math.PI / 2); });
await page.waitForTimeout(900);
check('전기차 앞모습: 무대에 전기차(막힌 그릴 모양 값)', (await S4(() => window.__car.look)).includes('"powertrain":"ev"'));
await shot('ev-front');

check('콘솔 오류 0건', errors.length === 0, errors.slice(0, 3).join(' | '));
console.log(fails.length ? `FAIL ${fails.length}건 / ${checks}항목` : `ALL PASS ${checks}항목`);
await done(fails.length ? 1 : 0);
