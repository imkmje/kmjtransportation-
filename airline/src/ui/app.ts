import { config } from '../config';
import { AIRCRAFT, CITIES, EVENTS, cityById, typeById } from '../data';
import { Game } from '../sim/game';
import { baseFare, canFly, distanceKm, maxWeeklyRoundTrips, rawMonthlyDemand } from '../sim/model';
import { fillFare } from '../sim/strategies';
import { AIR_VERSION } from '../version';
import { createMapView } from './mapview';
import { esc, fare, km, money, num, pct } from './fmt';

type Tab = 'map' | 'routes' | 'fleet' | 'money' | 'news';
const SAVE_KEY = 'the-air-save';
const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const SECONDS_PER_DAY = 3; // 1× 속도에서 하루가 흐르는 실제 시간

const $ = <T extends HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;

export function startApp(): void {
  let game = new Game(1);
  let tab: Tab = 'map';
  let selCity: string | null = null, selRoute: number | null = null;
  let speed = 0, acc = 0, last = performance.now(), lastMonth = 0;
  let toastTimer = 0;

  const panel = $('#panel'), top = { date: $('#date'), cash: $('#cash'), rep: $('#rep') };
  const toast = (msg: string) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600); };

  // ---- 저장 ----
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); } catch { /* 저장 불가 환경 */ } };
  const hasSave = (): boolean => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } };
  const load = (): boolean => {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; game = Game.fromJSON(JSON.parse(raw)); lastMonth = game.monthsPassed; return true; } catch { toast('저장 파일을 불러오지 못했습니다'); return false; }
  };

  const map = createMapView($<HTMLCanvasElement>('#map'), () => game, {
    onCity: (id) => { selCity = id; selRoute = null; if (id) { tab = 'map'; } syncMap(); render(); },
    onRoute: (id) => { selRoute = id; selCity = null; tab = 'routes'; syncMap(); render(); },
  });
  const syncMap = () => map.select(selCity, selRoute);

  // ---- 위쪽 바 ----
  function renderTop() {
    const s = game.state;
    top.date.textContent = `${Math.floor(game.monthsPassed / 12) + 1}년차 ${MONTH_NAMES[game.month - 1]} ${(s.day % config.daysPerMonth) + 1}일`;
    top.cash.textContent = money(s.cash);
    top.cash.classList.toggle('neg', s.cash < 0);
    top.rep.textContent = `평판 ${pct(s.reputation)}`;
    document.querySelectorAll<HTMLElement>('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  }

  // ---- 패널 내용 ----
  function routeLabel(a: string, b: string) { return `${cityById(a).name} ⇄ ${cityById(b).name}`; }

  function viewMap(): string {
    const s = game.state;
    if (!selCity) {
      const served = new Set<string>();
      for (const r of s.routes) if (r.open && game.planesOn(r.id).length) { served.add(r.a); served.add(r.b); }
      if (s.sandbox) return `<h2>지도</h2><p class="hint">자유 모드입니다. 목표와 기한 없이 계속 운영합니다. 파산만 조심하세요.</p>`;
      return `<h2>지도</h2>
        <p class="hint">지도에서 <b>도시를 눌러</b> 보세요. 서울에서 시작합니다. 도시를 누르면 그곳에서 갈 수 있는 노선과 예상 수요가 나옵니다.</p>
        <div class="goal"><div><b>목표</b> (24개월 안에 둘 중 하나)</div>
          <div class="bar"><i style="width:${Math.min(100, (s.cumProfit / config.rules.winProfit) * 100)}%"></i></div><small>누적 이익 ${money(s.cumProfit)} / ${money(config.rules.winProfit)}</small>
          <div class="bar"><i style="width:${(served.size / config.rules.winCities) * 100}%"></i></div><small>운항 중인 도시 ${served.size} / ${config.rules.winCities}</small>
          <small>남은 기간 ${Math.max(0, config.rules.timeLimitMonths - game.monthsPassed)}개월</small></div>
        <h3>시작하기</h3><ol class="steps"><li>서울이나 제주를 눌러 <b>노선을 엽니다</b>.</li><li>노선 탭에서 <b>항공기를 배정</b>합니다.</li><li>▶ 를 눌러 시간을 흘리고, <b>운임</b>을 조절해 이익을 냅니다.</li></ol>`;
    }
    const c = cityById(selCity);
    const dests = CITIES.filter((d) => d.id !== c.id).map((d) => {
      const dist = distanceKm(c, d), ex = s.routes.find((r) => r.open && ((r.a === c.id && r.b === d.id) || (r.a === d.id && r.b === c.id)));
      return { d, dist, demand: rawMonthlyDemand(c, d, game.month) * (1 + config.demand.repBoost * s.reputation), ex };
    }).sort((x, y) => y.demand - x.demand);
    const peak = c.peak.months.map((m) => `${m}월`).join('·');
    return `<h2>${esc(c.name)} <small>${c.id}</small></h2>
      <div class="kv"><div>시장 규모</div><div>인구 ${c.pop}백만 · 소득 ${c.income}배</div><div>활주로</div><div>${num(c.runway)} m</div><div>성수기</div><div>${peak} (수요 ×${c.peak.factor})</div></div>
      <h3>${esc(c.name)}에서 노선 열기</h3><p class="hint">월 수요가 큰 순서입니다(기준 운임일 때). 먼 거리는 큰 비행기가 필요합니다.</p>
      <div class="list">${dests.map(({ d, dist, demand, ex }) => `<div class="row"><div class="grow"><b>${esc(d.name)}</b><small>${km(dist)} · 기준 운임 ${fare(baseFare(dist))} · 월 수요 ${num(demand)}명</small></div>
        ${ex ? `<button data-act="goRoute" data-id="${ex.id}" class="ghost">운항 중</button>` : `<button data-act="open" data-a="${c.id}" data-b="${d.id}">열기</button>`}</div>`).join('')}</div>`;
  }

  function routeSummary(rId: number): string {
    const r = game.route(rId)!, d = game.routeDay(r), planes = game.planesOn(rId), profit = (d.revenue - d.cost) * config.daysPerMonth;
    const lf = d.seats > 0 ? d.pax / d.seats : 0;
    return `<div class="row"><div class="grow"><b>${routeLabel(r.a, r.b)}</b><small>${km(distanceKm(cityById(r.a), cityById(r.b)))} · 항공기 ${planes.length}대 · 탑승률 ${planes.length ? pct(lf) : '-'}</small></div>
      <div class="right ${profit >= 0 ? 'pos' : 'neg'}">${planes.length ? money(profit) + '/월' : '배정 필요'}</div></div>`;
  }

  function viewRoutes(): string {
    const s = game.state, open = s.routes.filter((r) => r.open);
    if (selRoute !== null && game.route(selRoute)?.open) return viewRouteDetail(selRoute);
    if (!open.length) return `<h2>노선</h2><p class="hint">아직 열린 노선이 없습니다. <b>지도 탭</b>에서 도시를 눌러 노선을 열어 보세요.</p>`;
    return `<h2>노선</h2><div class="list">${open.map((r) => `<button class="card" data-act="goRoute" data-id="${r.id}">${routeSummary(r.id)}</button>`).join('')}</div>`;
  }

  function viewRouteDetail(rId: number): string {
    const r = game.route(rId)!, d = game.routeDay(r), planes = game.planesOn(rId), A = cityById(r.a), B = cityById(r.b), dist = distanceKm(A, B);
    const base = game.routeBaseFare(r), lf = d.seats > 0 ? d.pax / d.seats : 0, profit = (d.revenue - d.cost) * config.daysPerMonth;
    const idle = s_idlePlanes().filter((p) => canFly(typeById(p.type), A, B).ok);
    const lo = Math.round(base * config.fare.minRatio), hi = Math.round(base * config.fare.maxRatio);
    return `<button class="back" data-act="routesHome">← 노선 목록</button>
      <h2>${routeLabel(r.a, r.b)}</h2>
      <div class="kv"><div>거리</div><div>${km(dist)}</div><div>월 수요</div><div>${num(d.demand * config.daysPerMonth)}명</div><div>월 좌석</div><div>${num(d.seats * config.daysPerMonth)}석</div>
        <div>탑승률</div><div>${planes.length ? pct(lf) : '-'}</div><div>예상 월 수익</div><div>${money(d.revenue * config.daysPerMonth)}</div><div>예상 월 비용</div><div>${money(d.cost * config.daysPerMonth)}</div>
        <div>예상 월 이익</div><div class="${profit >= 0 ? 'pos' : 'neg'}"><b>${money(profit)}</b></div></div>
      <h3>운임 <b>${fare(r.fare)}</b> <small>(기준 ${fare(base)})</small></h3>
      <input type="range" id="fare" min="${lo}" max="${hi}" step="1" value="${r.fare}" />
      <div class="two"><small>${fare(lo)}</small><small class="right">${fare(hi)}</small></div>
      <button class="wide" data-act="fillFare">자리를 꽉 채우는 운임으로 맞추기</button>
      <p class="hint">운임이 높으면 수익은 늘지만 손님이 줄어요. 비행기가 비면 내리고, 자리가 모자라면 올려 보세요.</p>
      <h3>배정된 항공기</h3>
      ${planes.length ? planes.map((p) => { const t = typeById(p.type), max = maxWeeklyRoundTrips(dist, t); return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.seats}석 · 주 ${p.weekly}회 왕복 (최대 ${max})</small></div>
        <div class="stepper"><button data-act="weekly" data-id="${p.id}" data-d="-1" aria-label="횟수 줄이기">−</button><button data-act="weekly" data-id="${p.id}" data-d="1" aria-label="횟수 늘리기">+</button><button class="ghost" data-act="unassign" data-id="${p.id}">빼기</button></div></div>`; }).join('') : '<p class="hint">배정된 항공기가 없습니다.</p>'}
      ${idle.length ? `<h3>대기 중인 항공기 배정</h3>${idle.map((p) => { const t = typeById(p.type); return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.seats}석 · 최대 주 ${maxWeeklyRoundTrips(dist, t)}회</small></div><button data-act="assign" data-id="${p.id}">배정</button></div>`; }).join('')}` : ''}
      <button class="wide danger" data-act="close">노선 닫기</button>`;
  }
  const s_idlePlanes = () => game.state.planes.filter((p) => p.routeId === null);

  function viewFleet(): string {
    const s = game.state;
    const owned = s.planes.map((p) => { const t = typeById(p.type), r = p.routeId ? game.route(p.routeId) : null;
      return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.cls} · ${t.seats}석 · 장부가 ${money(p.book)} · ${p.age}개월 사용(정비비 +${Math.round((game.agingMult(p) - 1) * 100)}%)</small></div><div class="right">${r ? routeLabel(r.a, r.b) : '<span class="warn">대기 중</span>'}<br><button class="ghost small" data-act="sell" data-id="${p.id}">매각 ${money(p.book * config.sale.ratio)}</button></div></div>`; }).join('');
    const shop = AIRCRAFT.map((t) => `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.cls} · ${t.seats}석 · 항속 ${km(t.range)} · 활주로 ${num(t.runway)}m 필요</small></div>
      <button data-act="buy" data-id="${t.id}" ${s.cash < t.price ? 'disabled' : ''}>${money(t.price)} 구매</button></div>`).join('');
    return `<h2>기단 <small>${s.planes.length}대</small></h2><div class="list">${owned}</div><h3>항공기 구매</h3><p class="hint">구매한 비행기는 노선 탭에서 배정해야 돈을 벌어요.</p><div class="list">${shop}</div>`;
  }

  function viewMoney(): string {
    const s = game.state, h = s.history.slice(-24), mx = Math.max(1, ...h.map((m) => Math.abs(m.profit)));
    const bars = h.map((m) => `<i class="${m.profit >= 0 ? 'p' : 'n'}" style="height:${Math.max(4, (Math.abs(m.profit) / mx) * 54)}px" title="${m.month}개월: ${money(m.profit)}"></i>`).join('');
    const cur = s.cur;
    return `<h2>재무</h2>
      <div class="kv"><div>현금</div><div><b class="${s.cash < 0 ? 'neg' : ''}">${money(s.cash)}</b></div><div>이번 달 수익</div><div>${money(cur.revenue)}</div><div>이번 달 비용</div><div>${money(cur.cost)}</div>
        <div>월 고정비</div><div>${money(game.fixedMonthly)}</div><div>누적 이익</div><div>${money(s.cumProfit)}</div></div>
      <h3>대출</h3><div class="kv"><div>대출 잔액</div><div><b>${money(s.loan)}</b></div><div>한도</div><div>${money(game.loanLimit)}</div><div>월 이율</div><div>${(game.loanRate * 100).toFixed(1)}% <small>(한도를 많이 쓸수록 비쌈)</small></div><div>월 이자</div><div>${money(s.loan * game.loanRate)}</div></div>
      <div class="two"><button data-act="borrow" ${s.loan + config.loan.step > game.loanLimit ? 'disabled' : ''}>+${money(config.loan.step)} 대출</button><button class="ghost" data-act="repay" ${s.loan <= 0 || s.cash < Math.min(config.loan.step, s.loan) ? 'disabled' : ''}>${money(Math.min(config.loan.step, s.loan || config.loan.step))} 상환</button></div>
      <h3>월별 이익</h3>${h.length ? `<div class="chart">${bars}</div>` : '<p class="hint">첫 달이 끝나면 그래프가 나옵니다.</p>'}
      <h3>월말 정산</h3>${s.history.length ? `<div class="list">${[...s.history].reverse().slice(0, 12).map((m) => `<div class="row"><div class="grow"><b>${m.month}개월차</b><small>수익 ${money(m.revenue)} · 비용 ${money(m.cost + m.fixed)} · 탑승률 ${pct(m.loadFactor)}</small></div><div class="right ${m.profit >= 0 ? 'pos' : 'neg'}">${money(m.profit)}</div></div>`).join('')}</div>` : '<p class="hint">아직 정산한 달이 없습니다.</p>'}
      <p class="hint">월 이익 = 수익 − 운영비 − 감가상각 − 고정비. 현금이 ${money(config.rules.bankruptCash)} 아래로 ${config.rules.bankruptMonths}개월 이어지면 파산입니다.</p>`;
  }

  function viewNews(): string {
    const log = [...game.state.log].reverse();
    const ev = game.state.events.map((e, i) => { const def = EVENTS.find((x) => x.id === e.def)!; return `<div class="row"><div class="grow"><b>진행 중: ${esc(def.name)}${e.city ? ` (${esc(cityById(e.city).name)})` : ''}</b><small>${e.monthsLeft}개월 남음${e.handled ? ' · 대응함' : def.option ? ` · ${esc(def.option.text)}` : ''}</small></div>${def.option && !e.handled ? `<button data-act="respond" data-id="${i}" ${game.state.cash < def.option.cost ? 'disabled' : ''}>${esc(def.option.label)} ${money(def.option.cost)}</button>` : ''}</div>`; }).join('');
    return `<h2>알림</h2>${ev}${log.length ? `<div class="list">${log.map((l) => `<div class="row"><div class="grow">${esc(l)}</div></div>`).join('')}</div>` : '<p class="hint">아직 알림이 없습니다. 가끔 연료비·불황·폭설 같은 사건이 일어납니다.</p>'}`;
  }
  
  function render() {
    renderTop();
    document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const html = tab === 'map' ? viewMap() : tab === 'routes' ? viewRoutes() : tab === 'fleet' ? viewFleet() : tab === 'money' ? viewMoney() : viewNews();
    if (html !== lastHtml) { const y = panel.scrollTop; panel.innerHTML = html; panel.scrollTop = y; lastHtml = html; }
    renderEnd();
  }
  let lastHtml = '';

  // ---- 끝난 게임 ----
  function renderEnd() {
    const el = $('#end'), s = game.state;
    el.hidden = s.status === 'playing';
    $('#end-continue').hidden = !(s.status === 'won' || s.status === 'timeup');
    if (s.status === 'playing') return;
    const title = s.status === 'won' ? '🎉 목표를 달성했습니다!' : s.status === 'bankrupt' ? '파산했습니다' : '제한 기간이 끝났습니다';
    $('#end-title').textContent = title;
    $('#end-body').textContent = `${game.monthsPassed}개월 · 누적 이익 ${money(s.cumProfit)} · 현금 ${money(s.cash)} · 항공기 ${s.planes.length}대 · 열린 노선 ${s.routes.filter((r) => r.open).length}개`;
  }

  // ---- 행동(패널 안의 버튼) ----
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act!, id = Number(b.dataset.id);
    const done = (m?: string) => { if (m) toast(m); lastHtml = ''; render(); };
    if (act === 'open') { const r = game.openRoute(b.dataset.a!, b.dataset.b!); if (!r.ok) return toast(r.error); selRoute = r.routeId; selCity = null; tab = 'routes'; syncMap(); done('노선을 열었습니다. 항공기를 배정하세요.'); }
    else if (act === 'goRoute') { selRoute = id; selCity = null; tab = 'routes'; syncMap(); done(); }
    else if (act === 'routesHome') { selRoute = null; syncMap(); done(); }
    else if (act === 'fillFare' && selRoute !== null) { fillFare(game, selRoute); done('운임을 맞췄습니다'); }
    else if (act === 'close' && selRoute !== null) { game.closeRoute(selRoute); selRoute = null; syncMap(); done('노선을 닫았습니다'); }
    else if (act === 'unassign') { game.unassign(id); done(); }
    else if (act === 'weekly') { const p = game.plane(id)!; const r = game.assign(id, p.routeId!, p.weekly + Number(b.dataset.d)); if (!r.ok) toast(r.error); done(); }
    else if (act === 'assign' && selRoute !== null) { const r = game.route(selRoute)!, p = game.plane(id)!; const max = maxWeeklyRoundTrips(distanceKm(cityById(r.a), cityById(r.b)), typeById(p.type)); const res = game.assign(id, selRoute, max); if (!res.ok) return toast(res.error); fillFare(game, selRoute); done('배정했습니다 (운임도 자동으로 맞췄어요)'); }
    else if (act === 'borrow') { const r = game.borrow(config.loan.step); if (!r.ok) return toast(r.error); done(`${money(config.loan.step)}를 대출받았습니다`); }
    else if (act === 'repay') { const r = game.repay(config.loan.step); if (!r.ok) return toast(r.error); done('대출을 갚았습니다'); }
    else if (act === 'sell') { const p = game.plane(id); if (!p) return; if (!window.confirm(`${typeById(p.type).name}을(를) ${money(p.book * config.sale.ratio)}에 팔까요?`)) return; const r = game.sellPlane(id); if (!r.ok) return toast(r.error); done(`항공기를 ${money(r.price)}에 팔았습니다`); }
    else if (act === 'respond') { const r = game.respondEvent(id); if (!r.ok) return toast(r.error); done('사건에 대응했습니다'); }
    else if (act === 'buy') { const r = game.buyPlane(b.dataset.id!); if (!r.ok) return toast(r.error); done('항공기를 샀습니다. 노선에 배정하세요.'); }
  });
  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'fare' && selRoute !== null) { game.setFare(selRoute, Number(t.value)); const h3 = panel.querySelector('h3 b'); if (h3) h3.textContent = fare(game.route(selRoute)!.fare); }
  });
  panel.addEventListener('change', (e) => { if ((e.target as HTMLElement).id === 'fare') { lastHtml = ''; render(); } });

  // ---- 탭·속도·메뉴 ----
  $('#tabs').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (!b) return; tab = b.dataset.tab as Tab; lastHtml = ''; render(); });
  $('#speeds').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]'); if (!b) return; speed = Number(b.dataset.speed); renderTop(); });
  const menu = $('#menu');
  $('#menubtn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'save') { save(); toast('저장했습니다'); }
    else if (m === 'load') { if (load()) { selCity = selRoute = null; syncMap(); lastHtml = ''; toast('불러왔습니다'); } else toast('저장된 게임이 없습니다'); }
    else if (m === 'new') { newGame(); }
    else if (m === 'title') { showTitle(); }
    menu.hidden = true; render();
  });
  $('#end-new').addEventListener('click', () => newGame());
  $('#end-continue').addEventListener('click', () => { const r = game.continuePlay(); if (r.ok) { lastHtml = ''; render(); toast('자유 모드로 계속합니다'); } });

  function newGame() { game = new Game((Date.now() & 0x7fffffff) || 1); selCity = selRoute = null; speed = 0; lastMonth = 0; tab = 'map'; syncMap(); lastHtml = ''; $('#title').hidden = true; render(); toast('새 게임을 시작했습니다. 지도에서 도시를 눌러 보세요.'); }

  // ---- 시작 화면 ----
  function showTitle() {
    speed = 0; $('#title').hidden = false;
    $('#t-version').textContent = `v${AIR_VERSION}`;
    $('#t-continue').hidden = !hasSave();
  }
  $('#t-new').addEventListener('click', () => newGame());
  $('#t-continue').addEventListener('click', () => { if (load()) { $('#title').hidden = true; selCity = selRoute = null; syncMap(); lastHtml = ''; render(); } });

  // ---- 시간 흐름 ----
  function frame(now: number) {
    const dt = Math.min(0.5, (now - last) / 1000); last = now;
    if (speed > 0 && game.state.status === 'playing' && document.visibilityState === 'visible') {
      acc += dt * speed;
      let n = 0;
      while (acc >= SECONDS_PER_DAY && n < 8) { acc -= SECONDS_PER_DAY; game.advanceDay(); n++; }
      if (n) {
        if (game.monthsPassed !== lastMonth) { lastMonth = game.monthsPassed; save(); const h = game.state.history[game.state.history.length - 1]; if (h) toast(`${h.month}개월차 정산: 이익 ${money(h.profit)}`); const lg = game.state.log[game.state.log.length - 1]; if (lg && lg.startsWith(`${game.monthsPassed + 1}개월차`)) toast(lg); }
        lastHtml = tab === 'map' && !selCity ? '' : lastHtml; render();
        if (game.state.status !== 'playing') speed = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') { speed = 0; renderTop(); } });

  (window as unknown as { __air: unknown }).__air = { get game() { return game; }, render, setSpeed: (s: number) => { speed = s; renderTop(); }, screenOf: (id: string) => map.screenOf(id) };
  showTitle();
  render();
  requestAnimationFrame(frame);
}
