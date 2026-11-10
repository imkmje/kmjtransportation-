import { config } from '../config';
import { AIRCRAFT, CITIES, EVENTS, SCENARIOS, cityById, scenarioById, typeById } from '../data';
import { Game, type GameOptions } from '../sim/game';
import type { Difficulty } from '../sim/types';
import { baseFare, canFly, distanceKm, maxWeeklyRoundTrips, rawMonthlyDemand } from '../sim/model';
import { fillFare } from '../sim/strategies';
import { advise, type Advice } from '../sim/advice';
import { ACHIEVEMENTS, achieved } from '../sim/achievements';
import { AIR_VERSION } from '../version';
import { createMapView } from './mapview';
import { musicOn, play, setMusic, setSound, soundOn } from './sound';
import { bestWorst, routeMonthStats } from '../sim/report';
import { esc, eulReul, fare, km, money, num, pct } from './fmt';

type Tab = 'map' | 'routes' | 'fleet' | 'money' | 'news';
const SAVE_KEY = 'the-air-save';
const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'];
const HINT_KEY = 'the-air-hints';
const REC_KEY = 'the-air-records';
const DIFF_NAME: Record<Difficulty, string> = { easy: '쉬움', normal: '보통', hard: '어려움' };
interface Rec { score: number; status: string; months: number; base: string; diff: Difficulty; when: string }
const SECONDS_PER_DAY = 3; // 1× 속도에서 하루가 흐르는 실제 시간

/** 작은 선 그래프(값 배열 → SVG). zero가 true면 0선을 그린다 */
function spark(values: number[], color: string, opts: { zero?: boolean; min?: number; max?: number } = {}): string {
  if (values.length < 2) return '<div class="hint">하루가 지나면 그래프가 나옵니다.</div>';
  const mn = opts.min ?? Math.min(0, ...values), mx = opts.max ?? Math.max(0.0001, ...values), W = 300, H = 56;
  const y = (v: number) => (H - 4 - ((v - mn) / (mx - mn || 1)) * (H - 8)).toFixed(1);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${y(v)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="none">${opts.zero ? `<line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="#9fb0bf" stroke-dasharray="3 3"/>` : ''}<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`;
}

const $ = <T extends HTMLElement>(s: string, root: ParentNode = document) => root.querySelector<T>(s)!;

export function startApp(): void {
  let game = new Game(1);
  let tab: Tab = 'map';
  let selCity: string | null = null, selRoute: number | null = null;
  let speed = 0, acc = 0, last = performance.now(), lastMonth = 0, prevLog = 0;
  let toastTimer = 0, seenLog = 0, seenEvents = new Set<string>();
  let hintsOn = (() => { try { return localStorage.getItem(HINT_KEY) !== 'off'; } catch { return true; } })();
  let autoPause = (() => { try { return localStorage.getItem('the-air-autopause') !== '0'; } catch { return true; } })();

  const panel = $('#panel'), top = { date: $('#date'), cash: $('#cash'), rep: $('#rep') };
  const toast = (msg: string, ms = 2600) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('show'), ms); };

  // ---- 저장 ----
  const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(game.toJSON())); } catch { /* 저장 불가 환경 */ } };
  const hasSave = (): boolean => { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } };
  const load = (): boolean => {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; game = Game.fromJSON(JSON.parse(raw)); lastMonth = game.monthsPassed; seenLog = game.state.log.length; seenEvents = new Set(); achSeen = new Set(achieved(game)); recorded = game.state.status !== 'playing'; return true; } catch { toast('저장 파일을 불러오지 못했습니다'); return false; }
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
    top.rep.textContent = `평판 ${pct(s.reputation)} · 정시 ${pct(game.avgOtp)}`;
    const eco = $('#eco'); eco.textContent = `경기 ${game.economyLabel}${s.economy > 1.02 ? ' ▲' : s.economy < 0.98 ? ' ▼' : ''}`; eco.className = game.economyLabel === '호황' ? 'good' : game.economyLabel === '불황' ? 'bad' : '';
    const fu = $('#fuel'); fu.textContent = `연료 ${game.fuelLabel}${s.hedge ? ' (계약)' : s.fuel > 1.04 ? ' ▲' : s.fuel < 0.96 ? ' ▼' : ''}`; fu.className = game.fuelLabel === '비쌈' && !s.hedge ? 'bad' : game.fuelLabel === '저렴' ? 'good' : '';
    renderAlerts();
    document.querySelectorAll<HTMLElement>('#speeds button').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === speed));
  }

  // ---- 알림 띠(지도 위에 항상 보임)와 탭 표시 ----
  function renderAlerts() {
    const s = game.state, el = $('#alerts');
    const unread = Math.max(0, s.log.length - seenLog), open = s.events.filter((e) => { const d = EVENTS.find((x) => x.id === e.def)!; return !!d.option && !e.handled; }).length;
    const newsBtn = $('#tabs button[data-tab="news"]');
    const n = tab === 'news' ? 0 : Math.max(unread, open);
    if (n > 0) newsBtn.dataset.badge = String(n); else delete newsBtn.dataset.badge;
    const html = s.events.map((e, i) => {
      const def = EVENTS.find((x) => x.id === e.def)!, key = `${e.def}:${e.city ?? ''}:${s.day - (def.months - e.monthsLeft) * config.daysPerMonth}`, fresh = !seenEvents.has(key);
      return `<div class="chip${fresh ? ' new' : ''}" data-key="${key}"><span>⚠</span><div class="grow" data-act="goNews"><b>${esc(def.name)}${e.city ? ` · ${esc(cityById(e.city).name)}` : ''}</b> <small>${e.monthsLeft}개월 남음${e.handled ? ' · 대응함' : ''}</small></div>${def.option && !e.handled ? `<button data-act="respond" data-id="${i}" ${s.cash < def.option.cost ? 'disabled' : ''}>${esc(def.option.label)} ${money(def.option.cost)}</button>` : ''}</div>`;
    }).join('');
    if (el.innerHTML !== html) { el.innerHTML = html; el.querySelectorAll<HTMLElement>('.chip').forEach((c) => seenEvents.add(c.dataset.key!)); }
  }
  $('#alerts').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!b) return;
    if (b.dataset.act === 'goNews') { tab = 'news'; seenLog = game.state.log.length; lastHtml = ''; render(); }
    else if (b.dataset.act === 'respond') { const r = game.respondEvent(Number(b.dataset.id)); if (!r.ok) return toast(r.error); toast('사건에 대응했습니다'); lastHtml = ''; render(); }
  });

  // ---- 패널 내용 ----
  function routeLabel(a: string, b: string) { return `${cityById(a).name} ⇄ ${cityById(b).name}`; }

  let advList: Advice[] = [], achSeen = new Set<string>();
  const ADV_ICON = { bad: '🔴', warn: '🟠', info: '🔵' };
  function viewMap(): string {
    const s = game.state;
    if (!selCity) {
      advList = advise(game);
      const todo = advList.length ? `<h3>지금 할 일 <small>(눌러서 이동)</small></h3><div class="list">${advList.map((a, i) => `<button class="card" data-act="advice" data-i="${i}"><div class="row"><div class="grow">${ADV_ICON[a.level]} ${esc(a.text)}</div></div></button>`).join('')}</div>` : '';
      const comp = `<h3>경쟁사</h3><div class="list">${s.competitors.map((k) => `<div class="row"><div class="grow"><b>${esc(k.name)}</b><small>${k.style === 'low' ? '저가형' : '프리미엄형'} · 거점 ${esc(cityById(k.hub).name)} · 항공기 ${k.planes}대 · 노선 ${k.routes.length}개${s.ally === k.id ? ' · <b class="pos">제휴 중</b>' : ''}</small></div><button class="ghost small" data-act="ally" data-id="${k.id}">${s.ally === k.id ? '제휴 해지' : `제휴 ${money(config.ally.fee)}/월`}</button></div>`).join('')}<p class="hint">제휴(공동 운항)하면 그 항공사가 같은 노선에서 우리 손님을 덜 빼앗고, 운임 경쟁도 걸어오지 않습니다. 한 번에 한 곳만.</p>${s.routes.some((r) => r.open) ? `<div class="row"><div class="grow"><b>우리 시장 점유율</b><small>경쟁사와 겹치는 노선에서의 좌석 점유</small></div><div class="right">${pct(game.marketShare)}</div></div>` : ''}</div>`;
      if (s.sandbox) return `<h2>지도</h2><p class="hint">자유 모드입니다. 목표와 기한 없이 계속 운영합니다. 파산만 조심하세요.</p>${todo}${comp}`;
      return `<h2>지도</h2>
        <p class="hint"><b>${esc(game.scenario.name)}</b> · ${esc(cityById(s.base).name)} 시작 · 난이도 ${DIFF_NAME[s.difficulty ?? 'normal']}<br>${esc(game.scenario.desc)}</p>
        <div class="goal"><div><b>목표</b> (${game.scenario.mode === 'all' ? '모두 달성하면 승리' : game.scenario.goals.length > 1 ? '하나만 달성해도 승리' : '달성하면 승리'})</div>
          ${game.goalProgress().map((g) => `<div class="bar"><i style="width:${Math.min(100, Math.max(0, (g.value / g.target) * 100))}%"></i></div><small>${esc(g.label)} ${g.unit === 'M' ? money(g.value) : num(g.value)}${g.unit === 'M' ? '' : g.unit} / ${g.unit === 'M' ? money(g.target) : num(g.target)}${g.unit === 'M' ? '' : g.unit}${g.done ? ' ✔' : ''}</small>`).join('')}
          <small>남은 기간 ${Math.max(0, game.scenario.timeLimit - game.monthsPassed)}개월 · 현재 점수 ${num(game.score)}</small></div>
        ${todo}${comp}
        <h3>시작하기</h3><ol class="steps"><li>${esc(eulReul(cityById(s.base).name))} 눌러 <b>노선을 엽니다</b>.</li><li>노선 탭에서 <b>항공기를 배정</b>합니다.</li><li>▶ 를 눌러 시간을 흘리고, <b>운임</b>을 조절해 이익을 냅니다.</li></ol>`;
    }
    const c = cityById(selCity);
    const dests = CITIES.filter((d) => d.id !== c.id).map((d) => {
      const dist = distanceKm(c, d), ex = s.routes.find((r) => r.open && ((r.a === c.id && r.b === d.id) || (r.a === d.id && r.b === c.id)));
      return { d, dist, demand: rawMonthlyDemand(c, d, game.month) * (1 + config.demand.repBoost * s.reputation), ex };
    }).sort((x, y) => y.demand - x.demand);
    const peak = c.peak.months.map((m) => `${m}월`).join('·');
    return `<h2>${esc(c.name)} <small>${c.id}</small></h2>
      <div class="kv"><div>시장 규모</div><div>인구 ${c.pop}백만 · 소득 ${c.income}배</div><div>시장 성장</div><div>${s.growth[c.id] ? `${(s.growth[c.id] >= 1 ? '+' : '') + Math.round((s.growth[c.id] - 1) * 100)}%` : '0%'}</div><div>활주로</div><div>${num(c.runway)} m</div><div>성수기</div><div>${peak} (수요 ×${c.peak.factor})</div><div>허브 효과</div><div>${game.linksAt(c.id)}개 노선 · 수요 +${Math.round(game.hubBonus(c.id) * 100)}%</div></div>
      <div class="goal"><div><b>공항 슬롯</b> <small>하루 이착륙 한도</small></div><div class="bar"><i style="width:${Math.min(100, (game.slotsUsed(c.id) / game.slotCapacity(c.id)) * 100)}%"></i></div><small>${game.slotsUsed(c.id).toFixed(1)} / ${game.slotCapacity(c.id)}${(s.slots[c.id] ?? 0) ? ` (구매 ${s.slots[c.id]}개 포함)` : ''}</small><button data-act="buySlot" data-city="${c.id}" ${s.cash < game.slotPrice(c.id) ? 'disabled' : ''}>슬롯 1개 구매 ${money(game.slotPrice(c.id))} <small>(월 임대 ${money(config.slot.lease)})</small></button></div>
      ${s.competitors.filter((k) => k.routes.some((r) => r.a === c.id || r.b === c.id)).map((k) => `<p class="hint">경쟁: <b>${esc(k.name)}</b>이(가) ${esc(c.name)}에 취항 중입니다.</p>`).join('')}
      <h3>${esc(c.name)}에서 노선 열기</h3><p class="hint">월 수요가 큰 순서입니다(기준 운임일 때). 먼 거리는 큰 비행기가 필요합니다.</p>
      <div class="list">${dests.map(({ d, dist, demand, ex }) => `<div class="row${ex ? ' clickable' : ''}"${ex ? ` data-act="goRoute" data-id="${ex.id}" title="눌러서 이 노선으로 이동"` : ''}><div class="grow"><b>${esc(d.name)}</b><small>${km(dist)} · 기준 운임 ${fare(baseFare(dist))} · 월 수요 ${num(demand)}명</small></div>
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
        <div>예상 월 이익</div><div class="${profit >= 0 ? 'pos' : 'neg'}"><b>${money(profit)}</b></div>
        <div>정시율</div><div class="${d.otp < 0.85 ? 'neg' : d.otp < 0.95 ? 'warn' : 'pos'}"><b>${pct(d.otp)}</b>${d.compensation > 0 ? ` <small>(보상금 월 ${money(d.compensation * config.daysPerMonth)})</small>` : ''}</div>
        ${d.transfer > 0 ? `<div>환승 수요</div><div class="pos"><b>+${num(d.transfer)}명/월</b> <small>(우리 다른 노선에서 갈아타는 손님)</small></div>` : ''}
        ${d.share < 1 ? `<div>경쟁 점유율</div><div class="warn"><b>${pct(d.share)}</b></div>` : ''}${game.competitorsOn(r.a, r.b).map(({ comp, route }) => `<div>${esc(comp.name)}</div><div>기준 운임의 ${pct(route.fareRatio)} · 하루 ${num(route.seatsDay)}석</div>`).join('')}${d.seatsB > 0 ? `<div>비즈니스 탑승</div><div>${num(d.paxB * config.daysPerMonth)} / ${num(d.seatsB * config.daysPerMonth)}석</div>` : ''}${d.cargoCap > 0 ? `<div>화물</div><div>${num(d.cargoT * config.daysPerMonth)}t / ${num(d.cargoCap * config.daysPerMonth)}t · ${money(d.cargoRevenue * config.daysPerMonth)}</div>` : ''}</div>
      <h3>공항 우선순위 <small>(혼잡할 때 덜 지연됨 · 월 수수료)</small></h3>
      <div class="seg">${[1, 2, 3].map((lv) => `<button data-act="priority" data-v="${lv}" class="${(r.priority ?? 1) === lv ? 'on' : ''}">${'★'.repeat(lv)}${lv > 1 ? ` ${money((lv - 1) * config.delay.priorityFee)}` : ' 무료'}</button>`).join('')}</div>
      <p class="hint">정시율이 낮으면 손님이 줄고 보상금이 나가며 평판이 떨어집니다. 원인: 공항 슬롯 혼잡(${esc(cityById(r.a).name)} ${pct(game.slotsUsed(r.a) / game.slotCapacity(r.a))}, ${esc(cityById(r.b).name)} ${pct(game.slotsUsed(r.b) / game.slotCapacity(r.b))}), 정비 상태, 폭설·파업.</p>
      <h3>최근 ${r.daily.length}일</h3><div class="chartlabel"><small>일 이익(${money(r.daily.at(-1)?.profit ?? 0)})</small></div>${spark(r.daily.map((x) => x.profit), '#1f9d57', { zero: true })}
      <div class="chartlabel"><small>탑승률(${pct(r.daily.at(-1) && r.daily.at(-1)!.seats ? r.daily.at(-1)!.pax / r.daily.at(-1)!.seats : 0)})</small></div>${spark(r.daily.map((x) => (x.seats ? x.pax / x.seats : 0)), '#1f7ae0', { min: 0, max: 1 })}
      <h3>운임 <b>${fare(r.fare)}</b> <small>(기준 ${fare(base)})</small></h3>
      <input type="range" id="fare" min="${lo}" max="${hi}" step="1" value="${r.fare}" />
      <div class="two"><small>${fare(lo)}</small><small class="right">${fare(hi)}</small></div>
      <button class="wide" data-act="fillFare">자리를 꽉 채우는 운임으로 맞추기</button>
      ${d.seatsB > 0 || planes.some((p) => p.bizShare > 0) ? `<h3>비즈니스 운임 <b>${fare(r.fareBiz)}</b> <small>(기준 ${fare(game.routeBaseFareBiz(r))})</small></h3><input type="range" id="fareBiz" min="${Math.round(game.routeBaseFareBiz(r) * config.fare.minRatio)}" max="${Math.round(game.routeBaseFareBiz(r) * config.fare.maxRatio)}" step="1" value="${r.fareBiz}" />` : ''}
      ${d.cargoCap > 0 ? `<h3>화물 운임 배율 <b>×${r.cargoRatio.toFixed(2)}</b></h3><input type="range" id="cargoRatio" min="${config.fare.minRatio}" max="${config.fare.maxRatio}" step="0.05" value="${r.cargoRatio}" />` : ''}
      <p class="hint">운임이 높으면 수익은 늘지만 손님이 줄어요. 비행기가 비면 내리고, 자리가 모자라면 올려 보세요.</p>
      <h3>배정된 항공기</h3>
      ${planes.length ? planes.map((p) => { const t = typeById(p.type), max = maxWeeklyRoundTrips(dist, t); return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.seats}석${t.seats ? ` (비즈니스 ${Math.round(p.bizShare * 100)}%)` : ' · 화물기'} · 주 ${p.weekly}회 왕복 (최대 ${max})</small></div>
        <div class="stepper"><button data-act="weekly" data-id="${p.id}" data-d="-1" aria-label="횟수 줄이기">−</button><button data-act="weekly" data-id="${p.id}" data-d="1" aria-label="횟수 늘리기">+</button><button class="ghost" data-act="unassign" data-id="${p.id}">빼기</button></div></div>${t.seats ? `<div class="cabin"><small>객실:</small>${config.cabin.shares.map((sh) => `<button class="ghost small ${p.bizShare === sh ? 'on' : ''}" data-act="cabin" data-id="${p.id}" data-share="${sh}">${sh === 0 ? '일반석만' : `비즈 ${sh * 100}%`}</button>`).join('')}</div>` : ''}`; }).join('') : '<p class="hint">배정된 항공기가 없습니다.</p>'}
      ${idle.length ? `<h3>대기 중인 항공기 배정</h3>${idle.map((p) => { const t = typeById(p.type); return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.seats}석 · 최대 주 ${maxWeeklyRoundTrips(dist, t)}회</small></div><button data-act="assign" data-id="${p.id}">배정</button></div>`; }).join('')}` : ''}
      <button class="wide danger" data-act="close">노선 닫기</button>`;
  }
  const s_idlePlanes = () => game.state.planes.filter((p) => p.routeId === null);

  function viewFleet(): string {
    const s = game.state;
    const owned = s.planes.map((p) => { const t = typeById(p.type), r = p.routeId ? game.route(p.routeId) : null;
      return `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.cls} · ${t.seats}석 · ${p.leased ? `<b>임대</b> 월 ${money(t.price * config.lease.rate)}` : `장부가 ${money(p.book)}`} · ${p.age}개월 사용(정비비 +${Math.round((game.agingMult(p) - 1) * 100)}%)</small><div class="condbar" title="정비 상태 ${pct(p.cond)}"><i class="${p.cond < 0.45 ? 'low' : p.cond < 0.7 ? 'mid' : ''}" style="width:${Math.round(p.cond * 100)}%"></i></div><small>정비 상태 ${pct(p.cond)}${p.shop > 0 ? ` · <b class="warn">정비·수리 중 ${p.shop}일</b>` : p.cond < 0.45 ? ' · <b class="neg">고장 위험!</b>' : ''}</small></div><div class="right">${r ? routeLabel(r.a, r.b) : '<span class="warn">대기 중</span>'}<br><button class="ghost small" data-act="service" data-id="${p.id}" ${p.shop > 0 || s.cash < game.serviceCost(p) ? 'disabled' : ''}>정비 ${money(game.serviceCost(p))}</button><br><button class="ghost small" data-act="sell" data-id="${p.id}">${p.leased ? '반납' : `매각 ${money(p.book * config.sale.ratio)}`}</button></div></div>`; }).join('');
    const shop = AIRCRAFT.map((t) => `<div class="row"><div class="grow"><b>${esc(t.name)}</b><small>${t.cls} · ${t.seats ? `${t.seats}석` : '좌석 없음'} · 화물 ${t.cargo}t · 항속 ${km(t.range)} · 활주로 ${num(t.runway)}m 필요</small></div>
      <div class="right"><button data-act="buy" data-id="${t.id}" ${s.cash < t.price ? 'disabled' : ''}>새것 ${money(t.price)}</button><br><button class="ghost small" data-act="buyUsed" data-id="${t.id}" ${s.cash < t.price * config.used.price ? 'disabled' : ''}>중고 ${money(t.price * config.used.price)}</button><br><button class="ghost small" data-act="lease" data-id="${t.id}">임대 ${money(t.price * config.lease.rate)}/월</button></div></div>`).join('');
    return `<h2>기단 <small>${s.planes.length}대</small></h2><div class="list">${owned}</div><h3>항공기 구매</h3><p class="hint">구매한 비행기는 노선 탭에서 배정해야 돈을 벌어요.<br><b>중고</b>: 싸지만 8년 된 기체라 운영비가 더 들고 정비 상태가 70%입니다. <b>임대</b>: 살 돈 없이 바로 쓰지만 매달 임대료가 나가고, 대출 담보가 되지 않습니다. 반납하면 임대료 1개월치 위약금.</p><div class="list">${shop}</div>`;
  }

  function viewMoney(): string {
    const s = game.state, h = s.history.slice(-24), mx = Math.max(1, ...h.map((m) => Math.abs(m.profit)));
    const bars = h.map((m) => `<i class="${m.profit >= 0 ? 'p' : 'n'}" style="height:${Math.max(4, (Math.abs(m.profit) / mx) * 54)}px" title="${m.month}개월: ${money(m.profit)}"></i>`).join('');
    const cur = s.cur;
    return `<h2>재무</h2>
      <div class="kv"><div>현금</div><div><b class="${s.cash < 0 ? 'neg' : ''}">${money(s.cash)}</b></div><div>이번 달 수익</div><div>${money(cur.revenue)}</div><div>이번 달 비용</div><div>${money(cur.cost)}</div>
        <div>월 고정비</div><div>${money(game.fixedMonthly)}</div><div>누적 이익</div><div>${money(s.cumProfit)}</div></div>
      <h3>연료</h3><div class="kv"><div>연료 가격</div><div><b>${game.fuelLabel}</b> (${(s.fuel * 100).toFixed(0)}%)</div><div>연료 계약</div><div>${s.hedge ? `${(s.hedge.price * 100).toFixed(0)}%로 고정 · ${s.hedge.monthsLeft}개월 남음` : '없음'}</div></div>
      <button class="wide" data-act="hedge" ${s.hedge || s.cash < config.fuel.hedgeCost ? 'disabled' : ''}>연료 계약 ${money(config.fuel.hedgeCost)} <small>(지금 가격으로 ${config.fuel.hedgeMonths}개월 고정)</small></button>
      <h3>대출</h3>${s.freeze > 0 ? `<p class="hint"><b class="neg">경기 악화로 은행이 새 대출을 중단했습니다 (${s.freeze}개월 남음)</b></p>` : ''}<div class="kv"><div>대출 잔액</div><div><b>${money(s.loan)}</b></div><div>한도</div><div>${money(game.loanLimit)}</div><div>월 이율</div><div>${(game.loanRate * 100).toFixed(1)}% <small>(한도를 많이 쓸수록 비쌈)</small></div><div>월 이자</div><div>${money(s.loan * game.loanRate)}</div></div>
      <div class="two"><button data-act="borrow" ${s.loan + config.loan.step > game.loanLimit ? 'disabled' : ''}>+${money(config.loan.step)} 대출</button><button class="ghost" data-act="repay" ${s.loan <= 0 || s.cash < Math.min(config.loan.step, s.loan) ? 'disabled' : ''}>${money(Math.min(config.loan.step, s.loan || config.loan.step))} 상환</button></div>
      <h3>월별 이익</h3>${h.length ? `<div class="chart">${bars}</div>` : '<p class="hint">첫 달이 끝나면 그래프가 나옵니다.</p>'}
      <h3>월말 정산</h3>${s.history.length ? `<div class="list">${[...s.history].reverse().slice(0, 12).map((m) => `<div class="row"><div class="grow"><b>${m.month}개월차</b><small>수익 ${money(m.revenue)} · 비용 ${money(m.cost + m.fixed)} · 탑승률 ${pct(m.loadFactor)}</small></div><div class="right ${m.profit >= 0 ? 'pos' : 'neg'}">${money(m.profit)}</div></div>`).join('')}</div>` : '<p class="hint">아직 정산한 달이 없습니다.</p>'}
      <p class="hint">월 이익 = 수익 − 운영비 − 감가상각 − 고정비. 현금이 ${money(config.rules.bankruptCash)} 아래로 ${config.rules.bankruptMonths}개월 이어지면 파산입니다.</p>`;
  }

  function viewNews(): string {
    const log = [...game.state.log].reverse();
    const ev = game.state.events.map((e, i) => { const def = EVENTS.find((x) => x.id === e.def)!; return `<div class="row"><div class="grow"><b>진행 중: ${esc(def.name)}${e.city ? ` (${esc(cityById(e.city).name)})` : ''}</b><small>${e.monthsLeft}개월 남음${e.handled ? ' · 대응함' : def.option ? ` · ${esc(def.option.text)}` : ''}</small></div>${def.option && !e.handled ? `<button data-act="respond" data-id="${i}" ${game.state.cash < def.option.cost ? 'disabled' : ''}>${esc(def.option.label)} ${money(def.option.cost)}</button>` : ''}</div>`; }).join('');
    const got = new Set(achieved(game)), ach = `<h3>업적 ${got.size}/${ACHIEVEMENTS.length}</h3><div class="list">${ACHIEVEMENTS.map((a) => `<div class="row"${got.has(a.id) ? '' : ' style="opacity:.45"'}><div class="grow"><b>${got.has(a.id) ? '🏅' : '🔒'} ${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')}</div>`;
    return `<h2>알림</h2>${ev}${log.length ? `<div class="list">${log.map((l) => `<div class="row"><div class="grow">${esc(l)}</div></div>`).join('')}</div>` : '<p class="hint">아직 알림이 없습니다. 가끔 연료비·불황·폭설 같은 사건이 일어납니다.</p>'}${ach}`;
  }
  
  function render() {
    renderTop();
    document.querySelectorAll<HTMLElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'news') seenLog = game.state.log.length;
    const html = tab === 'map' ? viewMap() : tab === 'routes' ? viewRoutes() : tab === 'fleet' ? viewFleet() : tab === 'money' ? viewMoney() : viewNews();
    if (html !== lastHtml) { const y = panel.scrollTop; panel.innerHTML = html; panel.scrollTop = y; lastHtml = html; }
    renderEnd();
    renderHint();
  }
  let lastHtml = '';

  // ---- 첫 5분 안내: 말풍선 없이, 지도 아래 한 줄 + 눌러야 할 곳이 반짝임 ----
  /** 힌트용 첫 목적지: 시작 기종으로 갈 수 있는 가장 가까운 큰 도시(수요가 큰 곳 중 2,500km 안) */
  function hintDest(base: string): string {
    const A = cityById(base), t = typeById(game.state.planes[0]?.type ?? 'B737');
    let best: { id: string; sc: number } | null = null;
    for (const c of CITIES) { if (c.id === base || !canFly(t, A, c).ok || distanceKm(A, c) > 2500) continue; const sc = rawMonthlyDemand(A, c, game.month); if (!best || sc > best.sc) best = { id: c.id, sc }; }
    return best?.id ?? CITIES.find((c) => c.id !== base)!.id;
  }
  function hintStep(): { text: string; city?: string; sel?: string } | null {
    const s = game.state;
    if (!hintsOn || s.status !== 'playing' || s.history.length >= 1 || s.sandbox) return null;
    const openRoutes = s.routes.filter((r) => r.open), assigned = openRoutes.some((r) => game.planesOn(r.id).length > 0);
    if (!openRoutes.length) {
      const base = s.base, dest = hintDest(base);
      if (selCity === base && tab === 'map') return { text: `② ${esc(cityById(dest).name)} 옆의 ‘열기’ 버튼을 눌러 노선을 만드세요`, sel: `button[data-act="open"][data-b="${dest}"]` };
      return { text: `① 지도에서 ${esc(eulReul(cityById(base).name))} 눌러 보세요`, city: base };
    }
    if (!assigned) return tab === 'routes' && selRoute !== null ? { text: '③ ‘배정’ 버튼으로 항공기를 이 노선에 보내세요', sel: '#panel button[data-act="assign"]' } : { text: '③ 아래 ‘노선’ 탭에서 항공기를 배정하세요', sel: '#tabs button[data-tab="routes"]' };
    if (speed === 0) return { text: '④ 위쪽 ‘1×’ 버튼을 눌러 시간을 흘려 보세요', sel: '#speeds button[data-speed="1"]' };
    return { text: '⑤ 시간이 흐르는 동안 ‘노선’ 탭의 운임 슬라이더를 움직여 보세요. 탑승률이 꽉 차면 올리고, 비면 내리세요', sel: tab === 'routes' ? '#fare' : '#tabs button[data-tab="routes"]' };
  }
  function renderHint() {
    const h = hintStep(), el = $('#hint');
    document.querySelectorAll('.pulse').forEach((e) => e.classList.remove('pulse'));
    map.setPulse(h?.city ?? null);
    el.hidden = !h;
    if (!h) return;
    $('#hint-text').textContent = h.text;
    if (h.sel) { const els = document.querySelectorAll<HTMLElement>(h.sel); els.forEach((e) => e.classList.add('pulse')); if (els[0] && panel.contains(els[0])) els[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); } // 패널 안에 있으면 보이는 곳으로 스크롤
  }
  $('#hint-off').addEventListener('click', () => { hintsOn = false; try { localStorage.setItem(HINT_KEY, 'off'); } catch { /* 저장 불가 */ } renderHint(); toast('힌트를 껐습니다. 메뉴에서 다시 켤 수 있어요'); });

  // ---- 월간 보고서: 월말마다 지도 위에 요약 카드(닫기 또는 다음 달에 갱신) ----
  let prevComp = '';
  function showReport() {
    const s = game.state, h = s.history.at(-1), el = $('#report');
    if (!h || s.status !== 'playing') { el.hidden = true; return; }
    const { best, worst } = bestWorst(routeMonthStats(game));
    const evs = s.log.filter((l) => l.startsWith(`${h.month}개월차`) || l.startsWith(`${h.month + 1}개월차`)).slice(-3);
    const comp = s.competitors.map((k) => `${k.name} ${k.planes}대·${k.routes.length}노선`).join(', ');
    const compNote = prevComp && prevComp !== comp ? `<div class="rl"><span>경쟁사 변화</span><span>${esc(comp)}</span></div>` : '';
    prevComp = comp;
    el.hidden = false;
    el.innerHTML = `<h4><span>📋 ${h.month}개월차 보고</span><button class="ghost" data-act="closeReport">닫기</button></h4>
      <div class="rl"><span>월 이익</span><span class="${h.profit >= 0 ? 'pos' : 'neg'}">${money(h.profit)}</span></div>
      <div class="rl"><span>탑승률 · 정시율</span><span>${pct(h.loadFactor)} · ${pct(game.avgOtp)}</span></div>
      <div class="rl"><span>현금</span><span>${money(h.cash)}</span></div>
      ${best ? `<div class="rl"><span>최고 노선</span><span class="pos">${esc(best.label)} ${money(best.profit)}</span></div>` : ''}
      ${worst && best && worst.routeId !== best.routeId ? `<div class="rl"><span>최저 노선</span><span class="${worst.profit >= 0 ? '' : 'neg'}">${esc(worst.label)} ${money(worst.profit)}</span></div>` : ''}
      <div class="rl"><span>경기 · 연료</span><span>${game.economyLabel} · ${game.fuelLabel}</span></div>
      ${compNote}${evs.map((e) => `<small>• ${esc(e)}</small><br>`).join('')}`;
  }
  $('#report').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-act="closeReport"]')) $('#report').hidden = true; });

  // ---- 끝난 게임 ----
  let recorded = false;
  function records(): Record<string, Rec[]> { try { return JSON.parse(localStorage.getItem(REC_KEY) ?? '{}'); } catch { return {}; } }
  function saveRecord() {
    const s = game.state, all = records(), id = s.scenario ?? 'free';
    const list = [...(all[id] ?? []), { score: game.score, status: s.status, months: game.monthsPassed, base: s.base, diff: s.difficulty ?? 'normal', when: new Date().toISOString().slice(0, 10) } as Rec].sort((a, b) => b.score - a.score).slice(0, 5);
    all[id] = list;
    try { localStorage.setItem(REC_KEY, JSON.stringify(all)); } catch { /* 저장 불가 */ }
  }
  function renderRecords() {
    const all = records();
    $('#records').innerHTML = SCENARIOS.map((sc) => { const b = all[sc.id]?.[0]; return b ? `<div>${esc(sc.name)} 최고 <b>${num(b.score)}점</b> (${DIFF_NAME[b.diff]}, ${esc(cityById(b.base).name)}, ${b.when})</div>` : ''; }).join('') || '<div>아직 기록이 없습니다.</div>';
  }
  function renderEnd() {
    const el = $('#end'), s = game.state;
    el.hidden = s.status === 'playing';
    $('#end-continue').hidden = !(s.status === 'won' || s.status === 'timeup');
    if (s.status === 'playing') return;
    if (!recorded) play(s.status === 'bankrupt' ? 'lose' : 'win');
    const title = s.status === 'won' ? '🎉 목표를 달성했습니다!' : s.status === 'bankrupt' ? '파산했습니다' : '제한 기간이 끝났습니다';
    $('#end-title').textContent = title;
    if (!recorded) { recorded = true; saveRecord(); }
    const best = records()[s.scenario ?? 'free']?.[0];
    $('#end-body').textContent = `${game.scenario.name} · ${DIFF_NAME[s.difficulty ?? 'normal']} · ${game.monthsPassed}개월 · 누적 이익 ${money(s.cumProfit)} · 현금 ${money(s.cash)} · 항공기 ${s.planes.length}대 · 점수 ${num(game.score)}${best ? ` (이 시나리오 최고 ${num(best.score)})` : ''}`;
  }

  // ---- 행동(패널 안의 버튼) ----
  panel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    const act = b.dataset.act!, id = Number(b.dataset.id);
    const done = (m?: string) => { if (m) { toast(m); play(act === 'open' || act === 'buy' ? 'ok' : 'tap'); } else play('tap'); lastHtml = ''; render(); };
    if (act === 'open') { const r = game.openRoute(b.dataset.a!, b.dataset.b!); if (!r.ok) return toast(r.error); selRoute = r.routeId; selCity = null; tab = 'routes'; syncMap(); done('노선을 열었습니다. 항공기를 배정하세요.'); }
    else if (act === 'advice') { const a = advList[Number(b.dataset.i)]; if (!a) return; selRoute = a.routeId ?? null; selCity = a.routeId === undefined ? a.cityId ?? null : null; tab = a.tab ?? 'map'; syncMap(); if (a.cityId) map.focusCity(a.cityId); done(); }
    else if (act === 'goRoute') { selRoute = id; selCity = null; tab = 'routes'; syncMap(); done(); }
    else if (act === 'routesHome') { selRoute = null; syncMap(); done(); }
    else if (act === 'fillFare' && selRoute !== null) { fillFare(game, selRoute); done('운임을 맞췄습니다'); }
    else if (act === 'close' && selRoute !== null) { const cr = game.route(selRoute)!; if (!window.confirm(`${routeLabel(cr.a, cr.b)} 노선을 닫을까요? 배정된 항공기는 대기 상태가 됩니다.`)) return; game.closeRoute(selRoute); selRoute = null; syncMap(); done('노선을 닫았습니다'); }
    else if (act === 'unassign') { game.unassign(id); done(); }
    else if (act === 'weekly') { const p = game.plane(id)!; const r = game.assign(id, p.routeId!, p.weekly + Number(b.dataset.d)); if (!r.ok) toast(r.error); done(); }
    else if (act === 'assign' && selRoute !== null) { const r = game.route(selRoute)!, p = game.plane(id)!; const max = maxWeeklyRoundTrips(distanceKm(cityById(r.a), cityById(r.b)), typeById(p.type)); const res = game.assign(id, selRoute, max); if (!res.ok) return toast(res.error); fillFare(game, selRoute); done('배정했습니다 (운임도 자동으로 맞췄어요)'); }
    else if (act === 'priority' && selRoute !== null) { const r = game.setPriority(selRoute, Number(b.dataset.v)); if (!r.ok) return toast(r.error); done(`공항 우선순위를 ★${b.dataset.v}로 바꿨습니다`); }
    else if (act === 'service') { const r = game.service(id); if (!r.ok) return toast(r.error); done(`정비를 시작했습니다 (${money(r.cost)}, 7일간 운항 불가)`); }
    else if (act === 'hedge') { const r = game.hedgeFuel(); if (!r.ok) return toast(r.error); done('연료 계약을 맺었습니다'); }
    else if (act === 'buySlot') { const r = game.buySlot(b.dataset.city!); if (!r.ok) return toast(r.error); done(`슬롯을 샀습니다 (${money(r.price)})`); }
    else if (act === 'cabin') { const r = game.setCabin(id, Number(b.dataset.share)); if (!r.ok) return toast(r.error); done(); }
    else if (act === 'borrow') { const r = game.borrow(config.loan.step); if (!r.ok) return toast(r.error); done(`${money(config.loan.step)}를 대출받았습니다`); }
    else if (act === 'repay') { const r = game.repay(config.loan.step); if (!r.ok) return toast(r.error); done('대출을 갚았습니다'); }
    else if (act === 'sell') { const p = game.plane(id); if (!p) return; if (!window.confirm(p.leased ? `${typeById(p.type).name}을(를) 반납할까요? 위약금 ${money(typeById(p.type).price * config.lease.rate * config.lease.returnMonths)}이 나갑니다.` : `${typeById(p.type).name}을(를) ${money(p.book * config.sale.ratio)}에 팔까요?`)) return; const r = game.sellPlane(id); if (!r.ok) return toast(r.error); done(p.leased ? '임대기를 반납했습니다' : `항공기를 ${money(r.price)}에 팔았습니다`); }
    else if (act === 'buyUsed') { const r = game.buyPlane(b.dataset.id!, true); if (!r.ok) return toast(r.error); done('중고 항공기를 샀습니다. 노선에 배정하세요.'); }
    else if (act === 'lease') { const r = game.leasePlane(b.dataset.id!); if (!r.ok) return toast(r.error); done('항공기를 임대했습니다. 노선에 배정하세요.'); }
    else if (act === 'ally') { const on = game.state.ally === id, r = game.setAlly(on ? null : id); if (!r.ok) return toast(r.error); done(on ? '제휴를 해지했습니다' : '제휴를 맺었습니다'); }
    else if (act === 'respond') { const r = game.respondEvent(id); if (!r.ok) return toast(r.error); done('사건에 대응했습니다'); }
    else if (act === 'buy') { const r = game.buyPlane(b.dataset.id!); if (!r.ok) return toast(r.error); done('항공기를 샀습니다. 노선에 배정하세요.'); }
  });
  panel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'fareBiz' && selRoute !== null) { game.setFareBiz(selRoute, Number(t.value)); const hs = panel.querySelectorAll('h3 b'); hs.forEach((h) => { if (h.parentElement?.textContent?.includes('비즈니스 운임')) h.textContent = fare(game.route(selRoute!)!.fareBiz); }); }
    if (t.id === 'cargoRatio' && selRoute !== null) { game.setCargoRatio(selRoute, Number(t.value)); panel.querySelectorAll('h3').forEach((h) => { if (h.textContent?.includes('화물 운임 배율')) h.querySelector('b')!.textContent = `×${game.route(selRoute!)!.cargoRatio.toFixed(2)}`; }); }
    if (t.id === 'fare' && selRoute !== null) { game.setFare(selRoute, Number(t.value)); const h3 = panel.querySelector('h3 b'); if (h3) h3.textContent = fare(game.route(selRoute)!.fare); }
  });
  panel.addEventListener('change', (e) => { if (['fare', 'fareBiz', 'cargoRatio'].includes((e.target as HTMLElement).id)) { lastHtml = ''; render(); } });

  // ---- 탭·속도·메뉴 ----
  $('#tabs').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (!b) return; tab = b.dataset.tab as Tab; $('#stage').classList.remove('full'); selCity = selRoute = null; syncMap(); panel.scrollTop = 0; lastHtml = ''; render(); }); // 탭을 누르면 항상 그 탭의 첫 화면
  $('#fold').addEventListener('click', () => { $('#stage').classList.toggle('full'); });
  $('#speeds').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-speed]'); if (!b) return; speed = Number(b.dataset.speed); renderTop(); renderHint(); });
  const menu = $('#menu');
  let nightOn = (() => { try { return localStorage.getItem('the-air-night') !== 'off'; } catch { return true; } })();
  map.setNight(nightOn);
  /** 메뉴 글자를 저장된 설정과 맞춘다(새로 열 때 꺼 둔 설정이 '켜짐'으로 보이지 않게) */
  const menuLabels = () => { const set = (m: string, t: string, v: boolean) => { menu.querySelector(`[data-m="${m}"]`)!.textContent = `${t}: ${v ? '켜짐' : '꺼짐'}`; }; set('hints', '힌트', hintsOn); set('autopause', '사건 시 자동 정지', autoPause); set('sound', '소리', soundOn()); set('night', '낮밤 표시', nightOn); set('music', '배경 음악', musicOn()); };
  addEventListener('pointerdown', () => { if (musicOn()) setMusic(true); }, { once: true }); // 음악은 첫 터치 뒤에 시작(브라우저 규칙)
  $('#menubtn').addEventListener('click', () => { menuLabels(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]'); if (!b) return;
    const m = b.dataset.m;
    if (m === 'save') { save(); toast('저장했습니다'); }
    else if (m === 'load') { if (load()) { selCity = selRoute = null; syncMap(); lastHtml = ''; toast('불러왔습니다'); } else toast('저장된 게임이 없습니다'); }
    else if (m === 'new') { openSetup(); }
    else if (m === 'hints') { hintsOn = !hintsOn; try { localStorage.setItem(HINT_KEY, hintsOn ? 'on' : 'off'); } catch { /* 저장 불가 */ } b.textContent = `힌트: ${hintsOn ? '켜짐' : '꺼짐'}`; toast(hintsOn ? '힌트를 켰습니다' : '힌트를 껐습니다'); menu.hidden = false; render(); return; }
    else if (m === 'autopause') { autoPause = !autoPause; try { localStorage.setItem('the-air-autopause', autoPause ? '1' : '0'); } catch { /* 저장 불가 */ } b.textContent = `사건 시 자동 정지: ${autoPause ? '켜짐' : '꺼짐'}`; toast(autoPause ? '사건이 생기면 시간이 멈춥니다' : '사건이 생겨도 시간이 계속 흐릅니다'); menu.hidden = false; render(); return; }
    else if (m === 'sound') { setSound(!soundOn()); b.textContent = `소리: ${soundOn() ? '켜짐' : '꺼짐'}`; play('ok'); menu.hidden = false; return; }
    else if (m === 'music') { setMusic(!musicOn()); menuLabels(); menu.hidden = false; return; }
    else if (m === 'night') { nightOn = !nightOn; try { localStorage.setItem('the-air-night', nightOn ? 'on' : 'off'); } catch { /* 저장 불가 */ } map.setNight(nightOn); menuLabels(); menu.hidden = false; return; }
    else if (m === 'help') { toast('스페이스: 정지/재생 · 1·2·3: 배속 · Esc: 선택 해제 · 지도: 두 손가락으로 확대·이동', 9000); }
    else if (m === 'title') { showTitle(); }
    menu.hidden = true; render();
  });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); speed = speed === 0 ? 1 : 0; renderTop(); renderHint(); }
    else if (e.key === '1' || e.key === '2' || e.key === '3') { speed = e.key === '3' ? 4 : Number(e.key); renderTop(); renderHint(); }
    else if (e.key === 'Escape') { selCity = selRoute = null; menu.hidden = true; syncMap(); lastHtml = ''; render(); }
  });
  $('#end-new').addEventListener('click', () => openSetup());
  $('#end-continue').addEventListener('click', () => { const r = game.continuePlay(); if (r.ok) { lastHtml = ''; render(); toast('자유 모드로 계속합니다'); } });

  function newGame(opts: GameOptions = {}) { recorded = false; prevComp = ''; $('#report').hidden = true; game = new Game((Date.now() & 0x7fffffff) || 1, undefined, opts); seenLog = 0; seenEvents = new Set(); achSeen = new Set(); selCity = selRoute = null; speed = 0; lastMonth = 0; tab = 'map'; syncMap(); lastHtml = ''; $('#title').hidden = true; $('#setup').hidden = true; map.focusCity(game.state.base); prevLog = game.state.log.length; render(); toast(`${game.scenario.name} 시작! 지도에서 ${eulReul(cityById(game.state.base).name)} 눌러 보세요.`); }

  // ---- 새 게임 설정(시나리오·시작 도시·난이도) ----
  let setupScen = 'free', setupDiff: Difficulty = 'normal', setupBase = 'ICN';
  function renderSetup() {
    const sc = scenarioById(setupScen);
    $('#setup-scen').innerHTML = SCENARIOS.map((x) => `<button data-sc="${x.id}" class="${x.id === setupScen ? 'on' : ''}">${esc(x.name)}<small>${esc(x.desc)}</small></button>`).join('');
    const sel = $<HTMLSelectElement>('#setup-base'); sel.innerHTML = CITIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    sel.value = sc.lockBase && sc.base ? sc.base : setupBase; sel.disabled = sc.lockBase; $('#setup-baselock').textContent = sc.lockBase ? '이 시나리오는 시작 도시가 정해져 있습니다.' : '어느 도시에서 시작해도 됩니다. 시장이 큰 도시일수록 슬롯과 수요가 유리합니다.';
    document.querySelectorAll<HTMLElement>('#setup-diff button').forEach((b) => b.classList.toggle('on', b.dataset.d === setupDiff));
    $('#setup-diffnote').textContent = setupDiff === 'easy' ? '시작 현금 1.5배, 사건 적음, 이율 낮음(점수 ×0.7)' : setupDiff === 'hard' ? '시작 현금 0.7배, 사건 많음, 이율·고정비 높음(점수 ×1.5)' : '기본 설정(점수 ×1)';
  }
  function openSetup() { $('#setup').hidden = false; $('#end').hidden = true; renderSetup(); }
  $('#setup-scen').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sc]'); if (!b) return; setupScen = b.dataset.sc!; renderSetup(); });
  $('#setup-diff').addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-d]'); if (!b) return; setupDiff = b.dataset.d as Difficulty; renderSetup(); });
  $('#setup-base').addEventListener('change', (e) => { setupBase = (e.target as HTMLSelectElement).value; });
  $('#setup-go').addEventListener('click', () => newGame({ scenario: setupScen, difficulty: setupDiff, base: $<HTMLSelectElement>('#setup-base').value }));
  $('#setup-cancel').addEventListener('click', () => { $('#setup').hidden = true; render(); });

  // ---- 시작 화면 ----
  function showTitle() {
    speed = 0; $('#title').hidden = false;
    $('#t-version').textContent = `v${AIR_VERSION}`;
    $('#t-continue').hidden = !hasSave();
    renderRecords();
  }
  $('#t-new').addEventListener('click', () => openSetup());
  $('#t-continue').addEventListener('click', () => { if (load()) { $('#title').hidden = true; selCity = selRoute = null; syncMap(); lastHtml = ''; render(); } });

  // ---- 시간 흐름 ----
  function frame(now: number) {
    const dt = Math.min(0.5, (now - last) / 1000); last = now;
    if (speed > 0 && game.state.status === 'playing' && document.visibilityState === 'visible') {
      acc += dt * speed;
      let n = 0;
      while (acc >= SECONDS_PER_DAY && n < 8) { acc -= SECONDS_PER_DAY; game.advanceDay(); n++; }
      if (n) {
        if (game.monthsPassed !== lastMonth) { lastMonth = game.monthsPassed; save(); showReport(); play('coin'); for (const a of ACHIEVEMENTS) if (!achSeen.has(a.id) && a.test(game)) { achSeen.add(a.id); toast(`🏅 업적: ${a.name}`, 3500); play('win'); } const h = game.state.history[game.state.history.length - 1]; if (h) toast(`${h.month}개월차 정산: 이익 ${money(h.profit)}`); }
        const lg = game.state.log;
        if (lg.length > prevLog) { // 새 알림: 눈에 띄게 알리고(알림 띠·탭 표시), 설정에 따라 시간을 멈춘다
          const msg = lg[lg.length - 1]; toast(msg, 6000); play('alert');
          if (autoPause && game.state.status === 'playing') { speed = 0; renderTop(); }
        }
        prevLog = lg.length;
        lastHtml = tab === 'map' && !selCity ? '' : lastHtml; render();
        if (game.state.status !== 'playing') speed = 0;
      }
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') { speed = 0; renderTop(); } });

  prevLog = game.state.log.length;
  (window as unknown as { __air: unknown }).__air = { get game() { return game; }, render, report: showReport, setSpeed: (s: number) => { speed = s; renderTop(); }, screenOf: (id: string) => map.screenOf(id), mapView: () => map.view() };
  showTitle();
  render();
  requestAnimationFrame(frame);
}
