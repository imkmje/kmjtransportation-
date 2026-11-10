// The Air 브라우저 점검: 시작 → 도시 누르기 → 노선 열기 → 항공기 배정 → 시간 진행 → 저장·불러오기. 사용: npm run build && node scripts/air-smoke.mjs [스크린샷 경로]
import { createRequire } from 'node:module';
import { preview } from 'vite';
const { chromium } = createRequire(import.meta.url)('playwright');
const server = await preview({ preview: { port: 4190, strictPort: true } });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const fails = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); if (!ok) fails.push(name); };
const shot = (n) => page.screenshot({ path: (process.argv[2] ?? 'air.png').replace('.png', `-${n}.png`) });

await page.goto('http://localhost:4190/air/');
await page.waitForSelector('canvas');
check('시작 화면: 제목과 새 게임 버튼', (await page.locator('#title').isVisible()) && (await page.locator('#title').innerText()).includes('The Air'));
await shot('title');
await page.click('#t-new');
check('새 게임: 시작 화면이 닫히고 현금 $20.0M', !(await page.locator('#title').isVisible()) && (await page.locator('#cash').innerText()) === '$20.0M', await page.locator('#cash').innerText());

check('첫 5분 안내: 새 게임에서 힌트 띠가 서울을 누르라고 안내함', (await page.locator('#hint').isVisible()) && (await page.locator('#hint-text').innerText()).includes('서울'), await page.locator('#hint-text').innerText());
check('경기 칩이 위쪽 바에 보임', (await page.locator('#eco').innerText()).startsWith('경기'));
const tapCity = async (id) => { const p = await page.evaluate((i) => window.__air.screenOf(i), id); await page.mouse.click(p.x, p.y); };
await tapCity('ICN');
check('힌트가 ②단계(제주 열기)로 바뀌고 버튼이 반짝임', (await page.locator('#hint-text').innerText()).includes('제주') && (await page.locator('#panel button[data-act="open"][data-b="CJU"].pulse').count()) === 1);
check('도시 정보에 공항 슬롯 칸이 있음', (await page.locator('#panel').innerText()).includes('공항 슬롯'));
check('도시를 누르면 도시 정보와 노선 열기 목록이 나옴', (await page.locator('#panel').innerText()).includes('서울에서 노선 열기') && (await page.locator('#panel button[data-act="open"]').count()) === 33); // 도시 34개 중 자기 자신 제외
await shot('city');
await page.locator('#panel button[data-act="open"][data-b="CJU"]').click();
check('노선 열기: 노선 탭으로 이동하고 서울 ⇄ 제주가 보임', (await page.locator('#panel').innerText()).includes('서울 ⇄ 제주'));
await page.locator('#panel button[data-act="assign"]').first().click();
check('항공기 배정: 배정 목록에 보임, 탑승률이 표시됨', (await page.locator('#panel').innerText()).includes('주') && (await page.locator('#panel').innerText()).includes('탑승률'), (await page.locator('#panel').innerText()).replace(/\n/g, ' ').slice(0, 120));
await page.evaluate(() => { window.__air.game.advanceDays(4); window.__air.render(); });
check('노선 화면: 일일 그래프(이익·탑승률)가 있음', (await page.locator('#panel svg.spark').count()) === 2);
await page.locator('#panel button[data-act="cabin"][data-share="0.2"]').first().click();
check('객실 설정: 비즈니스 20%로 바뀌고 비즈니스 운임 슬라이더가 나타남', (await page.evaluate(() => window.__air.game.state.planes[0].bizShare)) === 0.2 && (await page.locator('#fareBiz').count()) === 1);
await shot('route');
check('배정 후 힌트가 ④단계(시간 흘리기)로 바뀜', (await page.locator('#hint-text').innerText()).includes('1×'), await page.locator('#hint-text').innerText());
await page.click('#hint-off');
check('힌트 끄기: 띠가 사라짐', !(await page.locator('#hint').isVisible()));

// 운임 슬라이더
const before = await page.evaluate(() => window.__air.game.state.routes[0].fare);
await page.locator('#fare').fill(String(before + 20));
check('운임 슬라이더가 운임을 바꿈', (await page.evaluate(() => window.__air.game.state.routes[0].fare)) === before + 20);
// 시간 진행(속도 4×로 몇 초) + 직접 진행
await page.click('#speeds button[data-speed="4"]');
await page.waitForTimeout(2500);
await page.evaluate(() => { window.__air.setSpeed(0); window.__air.game.advanceDays(65); window.__air.render(); });
const st = await page.evaluate(() => ({ day: window.__air.game.state.day, hist: window.__air.game.state.history.length, cash: window.__air.game.state.cash }));
check('시간이 흘러 월 정산이 쌓임', st.day >= 60 && st.hist >= 2, JSON.stringify(st));
await page.click('#tabs button[data-tab="money"]');
check('재무 탭: 월별 정산이 보임', (await page.locator('#panel').innerText()).includes('월말 정산') && (await page.locator('#panel .chart i').count()) >= 2);
await shot('money');
await page.click('#tabs button[data-tab="fleet"]');
check('기단 탭: 항공기 구매 목록(6종)과 매각 버튼', (await page.locator('#panel button[data-act="buy"]').count()) === 6 && (await page.locator('#panel button[data-act="sell"]').count()) >= 1);
await page.click('#tabs button[data-tab="money"]');
await page.locator('#panel button[data-act="borrow"]').click();
check('재무 탭: 대출을 받으면 잔액·현금이 늘어남', (await page.evaluate(() => window.__air.game.state.loan)) === 10);
await page.locator('#panel button[data-act="repay"]').click();
check('대출 상환', (await page.evaluate(() => window.__air.game.state.loan)) === 0);
await page.evaluate(() => { window.__air.game.state.events.push({ def: 'fuel', monthsLeft: 2 }); window.__air.render(); });
check('알림 띠: 알림 탭에 들어가지 않아도 지도 위에 진행 중 사건과 대응 버튼이 보임', (await page.locator('#alerts .chip').count()) >= 1 && (await page.locator('#alerts button[data-act="respond"]').count()) >= 1 && (await page.locator('#tabs button[data-tab="news"]').getAttribute('data-badge')) !== null);
await page.locator('#alerts button[data-act="respond"]').last().click(); // 방금 넣은 연료비 사건은 마지막
check('알림 탭: 사건 대응 버튼이 동작', await page.evaluate(() => window.__air.game.state.events.at(-1).handled === true));
// 슬롯 구매(지도 탭의 도시 화면)
await page.click('#tabs button[data-tab="map"]'); await tapCity('CJU');
const cap0 = await page.evaluate(() => window.__air.game.slotCapacity('CJU'));
await page.locator('#panel button[data-act="buySlot"]').click();
check('슬롯 구매: 제주 슬롯 한도가 1 늘어남', (await page.evaluate(() => window.__air.game.slotCapacity('CJU'))) === cap0 + 1);
await page.evaluate(() => { window.__air.setSpeed(0); });
await page.click('#tabs button[data-tab="map"]');
// 저장·불러오기
await page.click('#menubtn'); await page.click('#menu button[data-m="save"]');
const saved = await page.evaluate(() => window.__air.game.state.day);
await page.evaluate(() => window.__air.game.advanceDays(30));
await page.click('#menubtn'); await page.click('#menu button[data-m="load"]');
check('저장·불러오기: 저장한 날짜로 돌아감', (await page.evaluate(() => window.__air.game.state.day)) === saved);
await tapCity('JFK');
await shot('map');
// 종료 후 계속하기
await page.evaluate(() => { window.__air.game.state.status = 'won'; window.__air.render(); });
check('목표 달성 화면에 계속하기 버튼', await page.locator('#end-continue').isVisible());
await page.click('#end-continue');
check('계속하기: 자유 모드로 이어짐', (await page.evaluate(() => window.__air.game.state.sandbox)) === true && !(await page.locator('#end').isVisible()));
check('콘솔 오류 0건', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
process.exit(fails.length ? 1 : 0);
