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
const shot = (n) => page.screenshot({ path: (process.argv[2] ?? 'air.png').replace('.png', `-${n}.png`), timeout: 60000 }).catch((e) => console.log('WARN 스크린샷 실패(참고용이라 계속 진행):', n, String(e.message).split('\n')[0]));

await page.goto('http://localhost:4190/air/');
await page.waitForSelector('canvas');
check('시작 화면: 제목과 새 게임 버튼', (await page.locator('#title').isVisible()) && (await page.locator('#title').innerText()).includes('The Air'));
await shot('title');
await page.click('#t-new');
check('새 게임 설정 화면: 시나리오 7개·난이도 3개', (await page.locator('#setup-scen button').count()) === 7 && (await page.locator('#setup-diff button').count()) === 3);
await page.click('#setup-scen button[data-sc="europe"]');
check('유럽 시나리오는 시작 도시가 프랑크푸르트로 고정됨', (await page.locator('#setup-base').inputValue()) === 'FRA' && (await page.locator('#setup-base').isDisabled()));
await page.click('#setup-diff button[data-d="hard"]'); await page.click('#setup-go');
check('시나리오·난이도가 적용됨(유럽·어려움, 현금 $28.0M, 힌트가 프랑크푸르트)', (await page.evaluate(() => { const s = window.__air.game.state; return s.scenario === 'europe' && s.base === 'FRA' && s.difficulty === 'hard'; })) && (await page.locator('#cash').innerText()) === '$28.0M' && (await page.locator('#hint-text').innerText()).includes('프랑크푸르트'), await page.locator('#hint-text').innerText());
await page.click('#menubtn'); await page.click('#menu button[data-m="new"]');
await page.click('#setup-scen button[data-sc="free"]'); await page.click('#setup-diff button[data-d="normal"]'); await page.selectOption('#setup-base', 'ICN');
await page.click('#setup-go'); // 자유 경영·서울·보통
check('새 게임: 시작 화면이 닫히고 현금 $20.0M', !(await page.locator('#title').isVisible()) && (await page.locator('#cash').innerText()) === '$20.0M', await page.locator('#cash').innerText());

check('첫 5분 안내: 새 게임에서 힌트 띠가 서울을 누르라고 안내함', (await page.locator('#hint').isVisible()) && (await page.locator('#hint-text').innerText()).includes('서울'), await page.locator('#hint-text').innerText());
check('경기 칩이 위쪽 바에 보임', (await page.locator('#eco').innerText()).startsWith('경기'));
const tapCity = async (id) => { const p = await page.evaluate((i) => window.__air.screenOf(i), id); await page.mouse.click(p.x, p.y); };
await tapCity('ICN');
check('힌트가 ②단계(열기)로 바뀌고 해당 버튼이 반짝임', (await page.locator('#hint-text').innerText()).includes('②') && (await page.locator('#panel button[data-act="open"].pulse').count()) === 1, await page.locator('#hint-text').innerText());
check('도시 정보에 공항 슬롯 칸이 있음', (await page.locator('#panel').innerText()).includes('공항 슬롯'));
check('도시를 누르면 도시 정보와 노선 열기 목록이 나옴', (await page.locator('#panel').innerText()).includes('서울에서 노선 열기') && (await page.locator('#panel button[data-act="open"]').count()) === 40); // 도시 41개 중 자기 자신 제외
await shot('city');
await page.locator('#panel button[data-act="open"][data-b="CJU"]').click(); // 제주(서울에서 가장 가까운 국내 노선)
check('노선 열기: 노선 탭으로 이동하고 서울 ⇄ 제주가 보임', (await page.locator('#panel').innerText()).includes('서울 ⇄ 제주'));
await page.locator('#panel button[data-act="assign"]').first().click();
check('항공기 배정: 배정 목록에 보임, 탑승률이 표시됨', (await page.locator('#panel').innerText()).includes('주') && (await page.locator('#panel').innerText()).includes('탑승률'), (await page.locator('#panel').innerText()).replace(/\n/g, ' ').slice(0, 120));
await page.evaluate(() => { window.__air.game.advanceDays(4); window.__air.render(); });
check('노선 화면: 일일 그래프(이익·탑승률)가 있음', (await page.locator('#panel svg.spark').count()) === 2);
await page.locator('#panel button[data-act="cabin"][data-share="0.2"]').first().click();
check('노선 화면: 정시율과 공항 우선순위(★1~3)가 있음', (await page.locator('#panel').innerText()).includes('정시율') && (await page.locator('#panel button[data-act="priority"]').count()) === 3);
await page.locator('#panel button[data-act="priority"][data-v="2"]').click();
check('우선순위 ★2로 바뀜', (await page.evaluate(() => window.__air.game.state.routes[0].priority)) === 2);
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
await page.evaluate(() => window.__air.report());
check('월간 보고서 카드가 지도 위에 나타남(월 이익·최고 노선)', (await page.locator('#report').isVisible()) && (await page.locator('#report').innerText()).includes('개월차 보고') && (await page.locator('#report').innerText()).includes('최고 노선'), (await page.locator('#report').innerText()).replace(/\n/g, ' ').slice(0, 80));
await page.click('#report [data-act="closeReport"]');
check('보고서 닫기', !(await page.locator('#report').isVisible()));
await page.click('#tabs button[data-tab="money"]');
check('재무 탭: 월별 정산이 보임', (await page.locator('#panel').innerText()).includes('월말 정산') && (await page.locator('#panel .chart i').count()) >= 2);
await shot('money');
await page.click('#tabs button[data-tab="fleet"]');
check('기단 탭: 정비 상태 막대와 정비 점검 버튼', (await page.locator('#panel .condbar').count()) >= 1 && (await page.locator('#panel button[data-act="service"]').count()) >= 1);
check('기단 탭: 항공기 구매 목록(6종)과 매각 버튼', (await page.locator('#panel button[data-act="buy"]').count()) === 6 && (await page.locator('#panel button[data-act="sell"]').count()) >= 1);
await page.click('#tabs button[data-tab="money"]');
await page.locator('#panel button[data-act="hedge"]').click();
check('재무 탭: 연료 계약을 맺을 수 있음(상단 칩에 계약 표시)', (await page.evaluate(() => window.__air.game.state.hedge !== null)) && (await page.locator('#fuel').innerText()).includes('계약'));
await page.locator('#panel button[data-act="borrow"]').click();
check('재무 탭: 대출을 받으면 잔액·현금이 늘어남', (await page.evaluate(() => window.__air.game.state.loan)) === 10);
await page.locator('#panel button[data-act="repay"]').click();
check('대출 상환', (await page.evaluate(() => window.__air.game.state.loan)) === 0);
await page.evaluate(() => { window.__air.game.state.events.push({ def: 'fuel', monthsLeft: 2 }); window.__air.render(); });
check('알림 띠: 알림 탭에 들어가지 않아도 지도 위에 진행 중 사건과 대응 버튼이 보임', (await page.locator('#alerts .chip').count()) >= 1 && (await page.locator('#alerts button[data-act="respond"]').count()) >= 1 && (await page.locator('#tabs button[data-tab="news"]').getAttribute('data-badge')) !== null);
await page.locator('#alerts button[data-act="respond"]').last().click(); // 방금 넣은 연료비 사건은 마지막
check('알림 탭: 사건 대응 버튼이 동작', await page.evaluate(() => window.__air.game.state.events.at(-1).handled === true));
// 두 손가락: 같은 간격으로 함께 움직이면 이동, 벌리면 확대 — 확대한 채로도 이동되어야 한다(사용자 보고)
const touch = (type, id, x, y) => page.evaluate(([t, i, px, py]) => { const c = document.querySelector('#map'); const r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent(t, { pointerId: i, pointerType: 'touch', isPrimary: i === 1, clientX: r.left + px, clientY: r.top + py, bubbles: true })); }, [type, id, x, y]);
const v0 = await page.evaluate(() => window.__air.mapView());
await touch('pointerdown', 1, 300, 300); await touch('pointerdown', 2, 400, 300);
for (let i = 1; i <= 10; i++) { await touch('pointermove', 1, 300 + 6 * i, 300 + 3 * i); await touch('pointermove', 2, 400 + 6 * i, 300 + 3 * i); } // 간격 그대로 오른쪽 아래로 이동(손가락은 번갈아 조금씩 움직인다)
const v1 = await page.evaluate(() => window.__air.mapView());
check('두 손가락 이동: 간격이 같으면 확대는 그대로고 지도만 움직임', Math.abs(v1.scale - v0.scale) < 1e-6 && (Math.abs(v1.cx - v0.cx) > 0.1 || Math.abs(v1.cy - v0.cy) > 0.1), JSON.stringify([v0, v1]));
for (let i = 1; i <= 10; i++) { await touch('pointermove', 1, 360 - 3 * i, 330); await touch('pointermove', 2, 460 + 5 * i, 330); } // 벌리면서(확대) 가운데가 오른쪽으로 이동
const v2 = await page.evaluate(() => window.__air.mapView());
check('두 손가락 확대하면서 이동: 확대되고 가운데 좌표도 함께 움직임', v2.scale > v1.scale && Math.abs(v2.cx - v1.cx) > 0.01, JSON.stringify([v1, v2]));
await touch('pointerup', 1, 330, 330); await touch('pointerup', 2, 510, 330);
// 도시 화면에서 이미 운항 중인 도시 행을 누르면 그 노선으로 이동(사용자 요청)
await page.click('#tabs button[data-tab="map"]'); await tapCity('ICN');
await page.locator('#panel .row.clickable').first().click();
check('운항 중인 도시 행을 누르면 노선 화면으로 이동', (await page.locator('#tabs button.on').getAttribute('data-tab')) === 'routes' && (await page.locator('#panel').innerText()).includes('서울 ⇄') && (await page.locator('#panel button[data-act="routesHome"]').count()) === 1);
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
await page.keyboard.press('Escape'); await page.click('#tabs button[data-tab="map"]');
const sb = await page.locator('#panel').innerText();
check('자유 모드에서도 경쟁사 목록이 보임', sb.includes('자유 모드') && sb.includes('경쟁사'), sb.slice(0, 200));
await page.click('#tabs button[data-tab="news"]');
check('알림 탭에 업적 목록', (await page.locator('#panel').innerText()).includes('업적'));
await page.click('#menubtn');
await page.click('#menu button[data-m="sound"]');
check('메뉴: 소리 끄기', (await page.locator('#menu button[data-m="sound"]').innerText()).includes('꺼짐'));
await page.click('#menu button[data-m="night"]');
check('메뉴: 낮밤 표시 끄기', (await page.locator('#menu button[data-m="night"]').innerText()).includes('꺼짐') && (await page.evaluate(() => localStorage.getItem('the-air-night'))) === 'off');
await page.click('#menubtn');
await page.evaluate(() => window.__air.setSpeed(0)); await page.locator('#map').focus().catch(() => {}); await page.keyboard.press('2');
check('단축키 2: 2배속', (await page.locator('#speeds button.on').getAttribute('data-speed')) === '2');
await page.evaluate(() => window.__air.setSpeed(0));
// 0.15.0: 탭 초기화·패널 접기·임대·제휴
page.on('dialog', (d) => d.accept());
await page.click('#tabs button[data-tab="routes"]');
await page.locator('#panel button[data-act="goRoute"]').first().click();
const inDetail = (await page.locator('#panel button[data-act="close"]').count()) === 1;
await page.click('#tabs button[data-tab="routes"]');
check('하단 탭을 다시 누르면 그 탭의 첫 화면(노선 목록)으로 돌아감', inDetail && (await page.locator('#panel button[data-act="close"]').count()) === 0 && (await page.locator('#panel h2').innerText()).startsWith('노선'));
const w0 = (await page.locator('#map').boundingBox()).width + (await page.locator('#map').boundingBox()).height;
await page.click('#fold');
await page.waitForTimeout(200);
const w1 = (await page.locator('#map').boundingBox()).width + (await page.locator('#map').boundingBox()).height;
check('패널 접기: 패널이 숨고 지도가 커짐', !(await page.locator('#panel').isVisible()) && w1 > w0, `${w0} -> ${w1}`);
await page.click('#tabs button[data-tab="fleet"]');
check('탭을 누르면 패널이 다시 펴짐', await page.locator('#panel').isVisible());
const n0 = await page.evaluate(() => window.__air.game.state.planes.length);
await page.locator('#panel button[data-act="lease"]').first().click();
check('임대: 현금 없이 항공기가 1대 늘고 임대로 표시됨', (await page.evaluate(() => window.__air.game.state.planes.length)) === n0 + 1 && (await page.locator('#panel').innerText()).includes('임대'));
check('임대기에 매입·반납 버튼이 있음', (await page.locator('#panel button[data-act="buyOut"]').count()) === 1);
await page.evaluate(() => { window.__air.game.state.cash = 200; window.__air.render(); }); // 매입에는 현금이 필요하다
await page.locator('#panel button[data-act="buyOut"]').click();
check('임대기 매입: 내 항공기가 됨(임대 표시 사라짐)', (await page.evaluate(() => window.__air.game.state.planes.every((p) => !p.leased))) && (await page.locator('#panel button[data-act="buyOut"]').count()) === 0);
await page.click('#tabs button[data-tab="map"]');
await page.locator('#panel button[data-act="ally"]').first().click();
check('제휴: 경쟁사와 제휴 중으로 표시됨', (await page.evaluate(() => window.__air.game.state.ally)) !== null && (await page.locator('#panel').innerText()).includes('제휴 중'));
await shot('fold');
await page.click('#tabs button[data-tab="money"]');
await page.click('#panel button[data-act="autoMaint"]');
check('재무 탭: 자동 정비 켜기', (await page.evaluate(() => window.__air.game.state.autoMaint)) === true && (await page.locator('#panel').innerText()).includes('자동 정비: 켜짐'));
// 0.17.0: 도움말·기록·자동 운임·소리 렌더링
await page.click('#menubtn'); await page.click('#menu button[data-m="help"]');
check('도움말 화면이 열림', await page.locator('#info').isVisible() && (await page.locator('#info-body').innerText()).includes('운임 전쟁'));
await page.click('#info-close');
await page.click('#menubtn'); await page.click('#menu button[data-m="records"]');
check('기록 화면: 시나리오 7개 제목', (await page.locator('#info-body h4').count()) === 7);
await page.click('#info-close');
await page.click('#tabs button[data-tab="routes"]');
await page.click('#panel button[data-act="autoFare"]');
check('노선 탭: 자동 운임 켜기', (await page.evaluate(() => window.__air.game.state.autoFare)) === true);
const peaks = await page.evaluate(() => window.__air.soundPeaks());
const bad = Object.entries(peaks).filter(([, v]) => !(v > 0.005 && v < 1));
check('소리 13종(효과음 11·음악·전부 동시)이 무음도 깨짐도 아님', Object.keys(peaks).length === 13 && bad.length === 0, JSON.stringify(Object.fromEntries(Object.entries(peaks).map(([k, v]) => [k, +v.toFixed(3)]))));
// 0.18.0: 업그레이드, 늘 보이는 예상 이익
await page.evaluate(() => { window.__air.game.state.cash = 200; window.__air.render(); });
await page.click('#tabs button[data-tab="money"]');
await page.locator('#panel button[data-act="upgrade"]').first().click();
check('재무 탭: 업그레이드 5종이 있고 사면 1단계가 됨', (await page.locator('#panel .pips').count()) === 5 && (await page.evaluate(() => window.__air.game.upgradeLevel('marketing'))) === 1 && (await page.locator('#panel .pips i.on').count()) === 1);
await page.click('#tabs button[data-tab="routes"]');
await page.locator('#panel button[data-act="goRoute"]').first().click();
const pb = await page.locator('#panel').boundingBox(), lb = await page.locator('#live').boundingBox();
const liveBefore = await page.locator('#live').innerText();
await page.locator('#fare').evaluate((el) => { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); });
check('노선 화면: 예상 월 이익이 패널 아래에 늘 보이고, 운임을 움직이면 바로 바뀜', liveBefore.includes('예상 월 이익') && lb.y + lb.height <= pb.y + pb.height + 1 && lb.y >= pb.y && (await page.locator('#live').innerText()) !== liveBefore, `${liveBefore} -> ${await page.locator('#live').innerText()}`);
await shot('live');
check('아이콘: 하단 탭 5개에 직접 그린 아이콘이 있고, 화면에 이모지가 없음', (await page.locator('#tabs button svg.ic').count()) === 5 && !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(await page.locator('#app').innerText()));
await page.click('#tabs button[data-tab="news"]'); await shot('icons');
check('콘솔 오류 0건', errors.length === 0, errors.join(' | '));
await browser.close();
await server.close();
process.exit(fails.length ? 1 : 0);
