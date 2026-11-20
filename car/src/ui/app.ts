// 카 컴퍼니 화면(바닐라 TS + DOM, 에어 게임 방식). sim 상태는 읽기만 하고 바꿀 때는 game.command(...)만 쓴다.
import { config } from '../config';
import { RIVALS, SEGMENTS, COMPAT, bodyById, powertrainById } from '../data';
import { Game, allGens, sellingGens } from '../sim/game';
import * as Q from '../sim/queries';
import { currentEdition } from '../sim/market';
import { yearOf } from '../sim/time';
import { STATS, type Budget, type GameEvent, type Generation, type Project, type ProjectSpec, type Stat, type Stats } from '../sim/types';
import { Stage } from '../render/stage';
import { silhouetteSvg } from '../render/silhouette';
import type { CarLook } from '../render/look';
import { CAR_VERSION } from '../version';
import * as S from '../io/saves';
import { BUDGET, MARKETING, ROLE_NAME, ROLE_SKILL, STAT_NAME, TIER_SUB, esc, eulReul, money, num, score } from './fmt';
import { PAINT, WHEELS, logo, lookOf, paintName, ring } from './art';

type Screen = 'garage' | 'plan' | 'dev' | 'launch' | 'company' | 'records';
type Tab = 'garage' | 'dev' | 'company' | 'records';
type PlanTab = 'body' | 'seg' | 'power' | 'opt' | 'dir' | 'budget';
type Draft = ProjectSpec & { color: string };
interface LaunchSet { pid: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }

const WEEK_MS = 1500; // 1배속: 1주 = 1.5초(설계서 4장)
const MAX_TICKS_PER_FRAME = 4;
const DEBUG_KEY = 'car-company-debug';
const PLAN_TABS: [PlanTab, string][] = [['body', '차체'], ['seg', '고객층'], ['power', '동력'], ['opt', '옵션'], ['dir', '개발 방향'], ['budget', '예산·기간']];
const CRITIC_SUB: Record<string, string> = { performance: '힘과 멋을 봅니다', household: '쓸모·연비·품질을 봅니다', design: '디자인과 마감을 봅니다', value: '값에 비해 좋은지 봅니다' };
const COMPAT_TEXT: [number, string][] = [[1.15, '◎ 잘 맞는 조합'], [0.95, '○ 무난한 조합'], [0.75, '△ 덜 맞는 조합'], [0, '× 안 맞는 조합']];

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector<T>(s)!;

export function startApp(): void {
  let game: Game | null = null;
  let ui: S.UiExtra = { photos: {}, colors: {} };
  let screen: Screen = 'garage';
  let speed = 1, acc = 0, garageIdx = 0, planTab: PlanTab = 'body';
  let draft: Draft | null = null, launch: LaunchSet | null = null;
  const garagePrice = new Map<number, number>(); // 차고 가격 슬라이더(적용 전 값)
  const devLog = new Map<number, string[]>(), devPrev = new Map<number, number>();
  let stage: Stage | null = null, lookKey = '';
  let debugOn = (() => { try { return localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; } })();
  let titleMode: 'home' | 'new' = 'home', gameOverShown = false, reviewTimers: number[] = [];
  let lastPanel = '', lastOv = '', dragging = false;

  const panel = $('#panel'), ov = $('#ov'), sheet = $('#sheet'), sheetBody = $('#sheet-body'), title = $('#title');
  $('#mylogo').innerHTML = logo('me', 26);

  // ---------- 알림 ----------
  const keyed = new Map<string, HTMLElement>();
  /** 작은 알림. key가 같은 알림은 새로 쌓지 않고 바꿔 끼운다(월 결산처럼 자주 오는 것) */
  function toast(text: string, kind: '' | 'alert' | 'bad' = '', head = '', ms = kind ? 9000 : 4000, key = ''): void {
    const box = $('#toasts'), t = document.createElement('div');
    const old = key ? keyed.get(key) : undefined;
    if (old?.isConnected) old.remove();
    if (key) keyed.set(key, t);
    t.className = `toast ${kind}`;
    t.innerHTML = `<div>${head ? `<b>${esc(head)}</b>` : ''}${esc(text)}</div><button class="x" aria-label="닫기">×</button>`;
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    (t.querySelector('.x') as HTMLElement).onclick = close;
    box.appendChild(t);
    while (box.children.length > 4) box.firstElementChild!.remove();
    setTimeout(close, ms);
  }
  const err = (reason: string) => toast(reason, 'bad', '할 수 없습니다');

  /** 화면 안 확인 창(alert/confirm 대신) */
  function ask(text: string, yes = '예', danger = false, no = '아니요'): Promise<boolean> {
    const box = $('#ask'), y = $('#ask-yes'), n = $('#ask-no');
    $('#ask-text').textContent = text; y.textContent = yes; y.className = `btn ${danger ? 'danger' : 'ink'}`; n.textContent = no;
    box.hidden = false; renderTop(); y.focus();
    return new Promise((res) => {
      const done = (v: boolean) => { box.hidden = true; y.onclick = n.onclick = null; renderTop(); res(v); };
      y.onclick = () => done(true); n.onclick = () => done(false);
    });
  }

  // ---------- 3D 무대 ----------
  function makeStage(): void {
    stage?.dispose(); stage = null; lookKey = '';
    const old = $<HTMLCanvasElement>('#cv'), cv = old.cloneNode() as HTMLCanvasElement;
    old.replaceWith(cv);
    if (Stage.supported()) { try { stage = new Stage(cv, $('#stage')); } catch { stage = null; } }
    cv.hidden = !stage;
    $('#fb').hidden = true;
  }
  /** 무대에 차를 올린다. null이면 빈 원판 */
  function showLook(look: CarLook | null): void {
    const key = look ? JSON.stringify({ ...look, color: '' }) : '';
    if (!look) { stage?.clear(); $('#fb').hidden = true; lookKey = ''; return; }
    if (stage) { if (key !== lookKey) stage.setCar(look); else stage.setColor(look.color); }
    else { const fb = $('#fb'); fb.hidden = false; fb.innerHTML = silhouetteSvg(look, { color: look.color }); }
    lookKey = key;
  }
  /** 출시 순간 무대 사진(작은 JPEG로 줄여 저장 데이터에 넣는다) */
  function snapPhoto(genId: number): void {
    if (!stage) return;
    let url = '';
    try { url = stage.snapshot(); } catch { return; }
    const img = new Image();
    img.onload = () => {
      const W = 400, H = 250, c = document.createElement('canvas'); c.width = W; c.height = H;
      const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
      const g = c.getContext('2d')!;
      g.fillStyle = '#e4e8ed'; g.fillRect(0, 0, W, H);
      g.drawImage(img, (W - w) / 2, Math.min(0, Math.max(H - h, H * 0.55 - h * 0.55)), w, h);
      ui.photos[genId] = c.toDataURL('image/jpeg', 0.82);
    };
    img.src = url;
  }

  // ---------- 시간 ----------
  const isHeld = (): boolean => !game || !title.hidden || !sheet.hidden || !$('#ask').hidden || screen === 'plan' || screen === 'launch' || game.state.status !== 'playing';
  const decisionHeld = (): boolean => !!game && title.hidden && (!sheet.hidden || !$('#ask').hidden || screen === 'plan' || screen === 'launch');

  function tickOnce(): void {
    if (!game) return;
    const ev = game.tick();
    logDev();
    for (const e of ev) onEvent(e);
  }
  function onEvent(e: GameEvent): void {
    const s = game!.state;
    switch (e.kind) {
      case 'monthEnd': {
        const L = s.ledger[s.ledger.length - 1];
        if (L) toast(`판매 ${num(L.sold)}대 · 이익 ${money(L.profit, true)} · 현금 ${money(L.cash)}`, '', `${L.year}년 ${L.monthOfYear}월 결산`, 3500, 'month');
        void S.put('auto', S.makeSave(game!, ui)); // 매월 자동 저장
        break;
      }
      case 'designDone': toast(e.text, 'alert', '설계 끝'); break;
      case 'recall': toast(e.text, 'bad', '리콜'); break;
      case 'unlock': toast(e.text, 'alert', '새로 쓸 수 있음'); break;
      case 'cashWarning': toast(`${e.text}${s.loan.bailoutUsed ? '' : ' 회사 탭에서 대출이나 구제 금융을 받을 수 있습니다.'}`, 'bad', '현금 경고', 12000); break;
      case 'discontinued': toast(e.text, '', '단종'); break;
      case 'gameOver': break; // render()에서 파산 화면을 띄운다
    }
  }
  function logDev(): void {
    const s = game!.state;
    for (const p of s.projects) {
      const pv = Q.projectPreview(s, p.id);
      if (!pv) continue;
      const prev = devPrev.get(p.id) ?? 0, d = pv.avg - prev, list = devLog.get(p.id) ?? [];
      const phase = p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`;
      list.unshift(`${Q.dateLabel(s.week)} · ${phase} · 등급 ${score(pv.avg)}${p.phase === 'design' ? ` (${d >= 0 ? '+' : '−'}${score(Math.abs(d))})` : ''} · 결함 약 ${p.defectEst}개`);
      devLog.set(p.id, list.slice(0, 14)); devPrev.set(p.id, pv.avg);
    }
  }
  function setSpeed(v: number): void { speed = v; acc = 0; renderTop(); }

  let last = performance.now(), frames = 0, fps = 0, fpsT = last;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dt = Math.min(250, now - last); last = now;
    frames++; if (now - fpsT >= 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; renderDebug(); }
    if (isHeld() || speed === 0) { acc = 0; return; }
    acc += dt * speed;
    let n = 0;
    while (acc >= WEEK_MS && n < MAX_TICKS_PER_FRAME) { acc -= WEEK_MS; tickOnce(); n++; if (isHeld()) { acc = 0; break; } }
    if (n) render();
  }
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { if (document.hidden && speed) setSpeed(0); stageOn(); });
  /** 무대가 보일 때만 3D를 그린다(회사·기록 탭, 처음 화면, 숨은 문서에서는 멈춤) */
  const stageOn = () => stage?.setActive(!document.hidden && title.hidden && !$('#main').classList.contains('full'));

  // ---------- 상단바·탭 ----------
  function renderTop(): void {
    stageOn();
    if (!game) return;
    const s = game.state;
    $('#co').textContent = s.companyName;
    $('#date').textContent = game.dateLabel;
    const c = $('#cash'); c.textContent = money(s.cash); c.classList.toggle('neg', s.cash < 0);
    $('#rep').textContent = String(Math.round(s.reputation));
    for (const b of document.querySelectorAll<HTMLElement>('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
    $('#held').hidden = !decisionHeld();
    const tab: Tab = screen === 'plan' || screen === 'launch' ? 'dev' : screen;
    for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  }
  function renderDebug(): void {
    const d = $('#debug');
    d.hidden = !debugOn || !game;
    if (!d.hidden) d.textContent = `초당 화면 ${fps.toFixed(0)} · ${game!.state.week}주차 · 시드 ${game!.state.seed} · 빠르기 ${speed}배${isHeld() ? '(멈춤)' : ''}`;
  }

  // ---------- 화면 그리기 ----------
  function render(): void {
    if (!game) return;
    renderTop();
    const s = game.state;
    if (s.status === 'gameOver') { if (!gameOverShown) showGameOver(); return; }
    if (screen === 'launch' && (!launch || !Q.projectById(s, launch.pid))) screen = 'dev';
    if (screen === 'plan' && !draft) screen = 'dev';
    const v = screen === 'garage' ? garageView() : screen === 'plan' ? planView() : screen === 'dev' ? devView() : screen === 'launch' ? launchView()
      : { ov: '', panel: screen === 'company' ? companyView() : recordsView(), look: undefined };
    $('#main').classList.toggle('full', v.look === undefined); stageOn();
    if (v.look !== undefined) showLook(v.look);
    if (v.ov !== lastOv) { ov.innerHTML = v.ov; lastOv = v.ov; }
    const ae = document.activeElement as HTMLElement | null;
    const busy = !!ae && panel.contains(ae) && (ae.matches('input[type=text]') || (dragging && ae.matches('input[type=range]')));
    if (!busy && v.panel !== lastPanel) { const y = panel.scrollTop; panel.innerHTML = v.panel; panel.scrollTop = y; lastPanel = v.panel; }
  }
  const go = (sc: Screen) => { screen = sc; lastPanel = ''; panel.scrollTop = 0; render(); };

  const tierName = (pt: string, tier: number) => powertrainById(pt).tiers[tier - 1]?.name ?? '';
  const segName = (id: string) => SEGMENTS.find((x) => x.id === id)?.name ?? id;
  const specLine = (body: string, pt: string, tier: number, seg: string) => `${bodyById(body).name} · ${powertrainById(pt).name} ${tierName(pt, tier)} · ${segName(seg)}용`;
  const statBars = (g: Stats) => STATS.map((k) => `<div class="stat"><span>${STAT_NAME[k]}</span><div class="track"><u style="width:${Math.min(100, g[k] * 10).toFixed(1)}%"></u></div><b>${score(g[k])}</b></div>`).join('');
  const kpi = (label: string, value: string, cls = '') => `<div class="kpi"><small>${label}</small><b class="${cls}">${value.replace(/(만원|억)$/, '<span>$1</span>')}</b></div>`; // 단위는 작게
  const ovTop = (eyebrow: string, model: string, spec: string) => `<div class="ov tl"><div class="eyebrow"><i></i>${eyebrow}</div><div class="model">${model}</div><div class="spec">${esc(spec)}</div></div>`;
  const ovScore = (label: string, v: number | null) => v === null ? '' : `<div class="ov br">${ring(v)}<div><small>${label}</small><b>${score(v)}</b></div></div>`;
  const ovHint = '<div class="ov bl">끌어서 돌려 보기</div>';
  const paints = (act: string, cur: string) => `<div class="paints">${PAINT.map(([n, c]) => `<button class="paint" data-act="${act}" data-k="color" data-v="${c}" aria-pressed="${cur === c}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>`;
  const nameOf = (g: Generation) => Q.nameplateOf(game!.state, g.id)?.name ?? '';
  const genLook = (g: Generation): CarLook => { const e = currentEdition(g); return lookOf({ body: g.body, powertrain: g.powertrain, tier: e.tier, color: e.color, wheels: e.wheels, year: Math.floor(g.launchMonth / 12) + config.time.startYear }); };

  // ----- 차고 -----
  function garageView() {
    const s = game!.state, gens = sellingGens(s), p = s.projects[0];
    const devCard = p ? `<div class="card"><p class="lbl">개발 중</p><h2>${esc(p.name)}</h2><p class="hint">${p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`} · 남은 결함 약 ${p.defectEst}개</p><div class="row" style="margin-top:10px"><button class="btn" data-act="tab" data-v="dev">개발 화면 보기</button></div></div>` : '';
    if (!gens.length) {
      const any = allGens(s).length > 0;
      const ovh = `<div class="ov empty"><div><h3>${p ? '개발 중인 차가 있습니다' : any ? '판매 중인 차가 없습니다' : '첫 차를 만들어 보세요'}</h3><p>${p ? `「${esc(p.name)}」${eulReul(p.name)} 개발하고 있습니다. 시험이 끝나면 출시할 수 있습니다.` : '차체와 고객층을 고르고, 직원들이 몇 주 동안 차를 설계합니다.'}</p>${p ? '<button class="go dark" data-act="tab" data-v="dev">개발 보기</button>' : '<button class="go" data-act="plan">신차 기획</button>'}</div></div>`;
      const intro = `<div class="card"><p class="lbl">${esc(s.companyName)}</p><h2>${p ? '개발이 끝나면 출시하세요' : '차고가 비어 있습니다'}</h2><p class="hint" style="margin-top:8px">회사의 한 바퀴: <b>기획</b> → <b>설계</b>(몇 주) → <b>시험</b>(결함 줄이기) → <b>출시</b>(가격·색) → 매달 <b>판매</b>. 돈이 6개월 넘게 마이너스면 파산합니다.</p>${p ? '' : '<button class="go" data-act="plan">신차 기획 시작</button>'}</div>`;
      return { ov: ovh, panel: intro + devCard, look: null };
    }
    garageIdx = ((garageIdx % gens.length) + gens.length) % gens.length;
    const g = gens[garageIdx], e = currentEdition(g), name = nameOf(g), base = bodyById(g.body).basePrice;
    const price = garagePrice.get(g.id) ?? e.price, up = Q.unitProfit(g.body, g.powertrain, e.tier, e.options, price);
    const lastSale = g.sales.length ? g.sales[g.sales.length - 1] : null, lb = Q.lifeBar(s, g), ending = g.status === 'ending';
    const ovh = ovTop(`차고 · ${ending ? '이번 달 말 단종' : '판매 중'}`, `${esc(name)}<small>${g.number}세대</small>`, `${specLine(g.body, g.powertrain, e.tier, g.segment)} · ${paintName(e.color)}`)
      + ovScore('평론 평균', g.reviewAvg) + ovHint
      + (gens.length > 1 ? `<button class="switch l" data-act="gprev" aria-label="이전 차">‹</button><button class="switch r" data-act="gnext" aria-label="다음 차">›</button>` : '');
    const sales = g.sales.slice(-12), mx = Math.max(1, ...sales);
    const chart = sales.length ? `<svg class="mini" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="최근 월별 판매">${sales.map((v, i) => { const w = 300 / 12, h = (v / mx) * 56; return `<rect x="${(i * w + 2).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${i === sales.length - 1 ? '#ff5a1f' : '#14171c'}"/>`; }).join('')}</svg>` : '';
    const card1 = `<div class="card"><p class="lbl">이 차의 성적</p><div class="kpis">${kpi('지난달 판매', lastSale === null ? '—' : `${num(lastSale)}<span>대</span>`)}${kpi('누적 판매', `${num(g.totalSold)}<span>대</span>`)}${kpi('대당 이익', money(Q.generationUnitProfit(g), true), Q.generationUnitProfit(g) >= 0 ? 'pos' : 'neg')}${kpi('평론 평균', `${score(g.reviewAvg)}${g.masterpiece ? '<span>명차</span>' : ''}`)}</div>
      ${chart ? `<p class="lbl" style="margin-top:12px">최근 판매(달마다)</p>${chart}` : ''}
      <p class="lbl" style="margin-top:12px">수명</p><div class="life" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lb * 100)}" aria-label="수명"><u style="width:${(lb * 100).toFixed(1)}%"></u></div>
      <p class="hint">${Math.round(lb * 100)}% · 차는 나이를 먹을수록, 해가 갈수록 덜 팔립니다.</p>
      <div class="advice">${esc(Q.advice(g))}</div></div>`;
    const card2 = ending ? '' : `<div class="card"><p class="lbl">판매 가격</p><div class="pricerow"><b id="gp-out">${num(price)}<span>만원</span></b><span class="margin ${up >= 0 ? 'pos' : 'neg'}" id="gp-margin">대당 이익 ${money(up, true)}</span></div>
      <input type="range" id="gprice" data-gen="${g.id}" min="${Math.ceil(base * config.price.min)}" max="${Math.floor(base * config.price.max)}" step="10" value="${price}" aria-label="판매 가격(만원)">
      <div class="row"><button class="btn ink" data-act="setPrice" data-id="${g.id}" ${price === e.price ? 'disabled' : ''}>가격 바꾸기</button><span class="hint">지금 가격 ${num(e.price)}만원 · 다음 결산부터 반영</span></div>
      <hr><p class="lbl">마케팅(매달 광고비)</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="setMk" data-id="${g.id}" data-v="${i}" aria-pressed="${g.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div></div>`;
    const card3 = `<div class="card"><p class="lbl">이 차의 다음 단계</p><div class="row"><button class="btn" disabled>페이스리프트<small>(부분 변경)</small></button><button class="btn" disabled>풀체인지<small>(세대 교체)</small></button></div><p class="note">페이스리프트와 풀체인지는 2단계에서 열립니다.</p>
      <hr><button class="btn danger" data-act="discontinue" data-id="${g.id}" ${ending ? 'disabled' : ''} style="width:100%">${ending ? '이번 달 말에 단종됩니다' : '단종하기'}</button></div>`;
    const planCard = !p && s.projects.length < config.dev.teams ? `<div class="card"><p class="lbl">다음 차</p><p class="hint">판매하는 동안 다음 차를 미리 개발할 수 있습니다. 공장 생산 라인은 ${config.factory.lines}개라, 새 차를 내려면 지금 차를 단종해야 합니다.</p><button class="go dark" data-act="plan">신차 기획</button></div>` : '';
    return { ov: ovh, panel: card1 + card2 + devCard + planCard + card3, look: genLook(g) };
  }

  // ----- 신차 기획 -----
  function newDraft(): Draft {
    const s = game!.state, y = yearOf(s.week);
    return { name: '', body: Q.bodiesAt(y)[0].id, segment: 'worker', powertrain: Q.powertrainsAt(y)[0].id, tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 12, color: PAINT[0][1] };
  }
  const defaultName = () => { const n = game!.state.nameplates.length, list = ['아리아', '노바', '솔라', '루나', '벨로', '오로라', '테라', '시리우스', '카덴', '에르타']; return list[n % list.length]; };
  const knownCompat = (body: string, seg: string) => allGens(game!.state).some((g) => g.body === body && g.segment === seg);
  const dirLeft = (d: Draft) => config.dev.dirTotal - STATS.reduce((a, k) => a + d.direction[k], 0);
  function planView() {
    const s = game!.state, d = draft!, y = yearOf(s.week), est = Q.planPreview(s, d), name = d.name.trim() || defaultName();
    const look = lookOf({ body: d.body, powertrain: d.powertrain, tier: d.tier, color: d.color, wheels: 1, year: y });
    const ovh = ovTop('새 차 기획 · 설계 전', `<span id="pname-ov">${esc(name)}</span>`, specLine(d.body, d.powertrain, d.tier, d.segment)) + ovScore('예상 등급', est.avg) + ovHint;
    let body = '';
    if (planTab === 'body') body = `<div class="opts">${Q.bodiesAt(y).map((b) => `<button class="opt" data-act="pick" data-k="body" data-v="${b.id}" aria-pressed="${d.body === b.id}">${silhouetteSvg(lookOf({ body: b.id, powertrain: d.powertrain, tier: d.tier, color: d.color, wheels: 1, year: y }))}<b>${esc(b.name)}</b><small>기준 가격 ${money(b.basePrice)}</small><span class="cost">원가 ${money(b.cost)}</span></button>`).join('')}</div><p class="note">다른 차체는 해가 지나면 열립니다.</p>
      <p class="lbl" style="margin-top:14px">색상(출시 때 바꿀 수 있음)</p>${paints('pick', d.color)}`;
    else if (planTab === 'seg') body = `<div class="opts">${SEGMENTS.map((g) => {
      const top = (Object.entries(g.w) as [Stat, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => STAT_NAME[k]).join('·');
      const cv = COMPAT[d.body]?.[g.id], tag = knownCompat(d.body, g.id) && cv !== undefined ? COMPAT_TEXT.find(([t]) => cv >= t)![1] : '';
      return `<button class="opt" data-act="pick" data-k="segment" data-v="${g.id}" aria-pressed="${d.segment === g.id}"><b>${esc(g.name)}</b><small>중시: ${top}</small><small>${g.eps >= 2 ? '값에 민감함' : '값보다 만족을 봄'}</small>${tag ? `<span class="tag">${tag}</span>` : ''}</button>`;
    }).join('')}</div><p class="note">차체와 고객층에는 궁합이 있습니다. 한 번 출시해 본 조합은 궁합이 표시됩니다.</p>`;
    else if (planTab === 'power') {
      const pts = Q.powertrainsAt(y), pt = powertrainById(d.powertrain);
      body = (pts.length > 1 ? `<div class="seg">${pts.map((x) => `<button data-act="pick" data-k="powertrain" data-v="${x.id}" aria-pressed="${d.powertrain === x.id}">${esc(x.name)}</button>`).join('')}</div>` : `<p class="hint" style="margin-bottom:10px">동력: <b>${esc(pt.name)}</b> (다른 동력은 해가 지나면 열립니다)</p>`)
        + `<div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="pick" data-k="tier" data-v="${i + 1}" aria-pressed="${d.tier === i + 1}"><b>${esc(t.name)}</b><small>${TIER_SUB[i] ?? ''}</small><span class="cost">${t.costAdd ? `원가 +${Math.round(t.costAdd * 100)}%` : '원가 기본'}</span></button>`).join('')}</div><p class="note">고급 동력을 고르면 차에 스포일러가 붙습니다.</p>`;
    } else if (planTab === 'opt') {
      const max = config.dev.maxOptions;
      body = `<p class="left">옵션 <b>${d.options.length}</b> / ${max}개</p><div class="opts">${Q.optionsAt(y).map((o) => { const on = d.options.includes(o.id); return `<button class="opt" data-act="opt" data-v="${o.id}" aria-pressed="${on}" ${!on && d.options.length >= max ? 'disabled' : ''}><b>${esc(o.name)}</b><small>${(['U', 'D', 'Q'] as const).filter((k) => o[k]).map((k) => `${STAT_NAME[k]} +${o[k]}`).join(' · ')}</small><span class="cost">대당 +${num(o.cost)}만원</span></button>`; }).join('')}</div><p class="note">옵션은 안 골라도 됩니다. 새 옵션은 해가 지나면 열립니다.</p>`;
    } else if (planTab === 'dir') {
      const left = dirLeft(d);
      body = `<p class="left">남은 점수 <b>${left}</b> / ${config.dev.dirTotal}점</p>${STATS.map((k) => `<div class="dir"><span>${STAT_NAME[k]}</span><button data-act="dir" data-k="${k}" data-v="-1" aria-label="${STAT_NAME[k]} 빼기" ${d.direction[k] <= 0 ? 'disabled' : ''}>−</button><div class="dots" aria-label="${STAT_NAME[k]} ${d.direction[k]}점">${Array.from({ length: config.dev.dirMax }, (_, i) => `<i class="${i < d.direction[k] ? 'on' : ''}"></i>`).join('')}</div><button data-act="dir" data-k="${k}" data-v="1" aria-label="${STAT_NAME[k]} 더하기" ${d.direction[k] >= config.dev.dirMax || left <= 0 ? 'disabled' : ''}>+</button></div>`).join('')}<p class="note">한 능력치에 0~${config.dev.dirMax}점. 2점이 보통이고, 많이 줄수록 그 능력치가 더 자랍니다. 10점을 모두 나눠야 시작할 수 있습니다.</p>`;
    } else body = `<p class="lbl">예산</p><div class="opts">${(Object.keys(BUDGET) as Budget[]).map((b) => `<button class="opt" data-act="pick" data-k="budget" data-v="${b}" aria-pressed="${d.budget === b}"><b>${BUDGET[b].name}</b><small>${BUDGET[b].sub}</small></button>`).join('')}</div>
      <p class="lbl" style="margin-top:14px">설계 기간</p><div class="opts">${config.dev.designWeeks.map((w, i) => `<button class="opt" data-act="pick" data-k="designWeeks" data-v="${w}" aria-pressed="${d.designWeeks === w}"><b>${w}주</b><small>${['빠르지만 점수가 적음', '보통', '오래 걸리지만 점수가 많음'][i] ?? ''}</small></button>`).join('')}</div>`;
    const ti = PLAN_TABS.findIndex(([k]) => k === planTab);
    const card1 = `<div class="card"><p class="lbl">차 이름</p><input class="namein" id="pname" type="text" maxlength="12" value="${esc(d.name)}" placeholder="${esc(defaultName())}" aria-label="차 이름">
      <div class="seg" role="tablist" style="margin-top:12px">${PLAN_TABS.map(([k, l], i) => `<button role="tab" data-act="ptab" data-v="${k}" aria-selected="${planTab === k}">${i + 1}<small>${l}</small></button>`).join('')}</div>
      <h3>${PLAN_TABS[ti][1]}</h3>${body}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="ptab" data-v="${PLAN_TABS[Math.max(0, ti - 1)][0]}" ${ti === 0 ? 'disabled' : ''}>← 이전</button><button class="btn" data-act="ptab" data-v="${PLAN_TABS[Math.min(PLAN_TABS.length - 1, ti + 1)][0]}" ${ti === PLAN_TABS.length - 1 ? 'disabled' : ''}>다음 →</button></div></div>`;
    const left = dirLeft(d);
    const card2 = `<div class="card"><p class="lbl">예상(대략)</p>${statBars(est.grades)}
      <div class="kpis" style="margin-top:10px;grid-template-columns:repeat(2,1fr)">${kpi('예상 등급', `${score(est.min)}~${score(est.max)}`)}${kpi('예상 개발비', money(est.cost))}${kpi('대당 원가', money(Q.unitCost(d.body, d.powertrain, d.tier, d.options)))}${kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}</div>
      <p class="note">등급은 그해 다른 차와 비교한 점수(0~10, 5가 보통)입니다. 낮은 쪽은 직원 컨디션이 나쁘고 최소 시험만 한 경우, 높은 쪽은 컨디션이 좋고 결함을 다 없앤 경우입니다. 개발비는 설계와 최소 시험 ${config.dev.minTestWeeks}주 기준이며, 시험을 길게 하면 더 듭니다.</p>
      <button class="btn" data-act="cancelPlan" style="width:100%;margin-top:8px">기획 그만두기</button></div>`;
    const bar = `<div class="actbar">${left ? `<div class="warnbox">개발 방향 점수가 ${left}점 남았습니다(5번 탭).</div>` : ''}<button class="go" data-act="startDev" ${left ? 'disabled' : ''}>개발 시작 <span aria-hidden="true">→</span></button></div>`;
    return { ov: ovh, panel: card1 + card2 + bar, look };
  }

  // ----- 개발 진행 -----
  function devView() {
    const s = game!.state, p = s.projects[0];
    if (!p) {
      const canPlan = s.projects.length < config.dev.teams;
      return { ov: `<div class="ov empty"><div><h3>진행 중인 개발이 없습니다</h3><p>새 차를 기획하면 직원들이 설계를 시작합니다.</p>${canPlan ? '<button class="go" data-act="plan">신차 기획</button>' : ''}</div></div>`, panel: `<div class="card"><p class="lbl">개발</p><h2>개발팀이 쉬고 있습니다</h2><p class="hint" style="margin-top:8px">직원 ${s.staff.length}명이 모두 한 차에 매달립니다. 개발팀은 1개라 한 번에 한 차만 개발할 수 있습니다.</p>${canPlan ? '<button class="go" data-act="plan">신차 기획 시작</button>' : ''}</div>`, look: null };
    }
    const pv = Q.projectPreview(s, p.id)!, minT = config.dev.minTestWeeks, ready = p.phase === 'test' && p.testWeeks >= minT;
    const color = ui.colors[p.id] ?? PAINT[0][1], adv = Q.defectAdvice(p);
    const look = lookOf({ body: p.body, powertrain: p.powertrain, tier: p.tier, color, wheels: 1, year: yearOf(s.week) });
    const phase = p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`;
    const ovh = ovTop(`개발 중 · ${phase}`, esc(p.name), specLine(p.body, p.powertrain, p.tier, p.segment)) + ovScore('지금 등급', pv.avg) + ovHint;
    const pct = p.phase === 'design' ? (p.weeksDone / p.designWeeks) * 100 : 100;
    const log = devLog.get(p.id) ?? [];
    const card1 = `<div class="card"><p class="lbl">${p.phase === 'design' ? '설계 단계' : '시험 단계'}</p><h2>${esc(p.name)}<small>${phase}</small></h2>
      <div class="prog ${p.phase === 'test' ? 'test' : ''}"><u style="width:${pct.toFixed(1)}%"></u></div>
      <p class="hint">${p.phase === 'design' ? '직원들이 매주 능력치를 쌓고 있습니다. 결함도 함께 생깁니다.' : '시험할수록 결함이 줄어 리콜 위험이 낮아집니다. 대신 개발비가 계속 듭니다. 출시 시점은 직접 정합니다.'}</p>
      <hr><p class="lbl">지금 능력치(등급)</p>${statBars(pv.grades)}
      <div class="kpis" style="margin-top:10px">${kpi('남은 결함', `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('지금까지 쓴 개발비', money(p.spent))}</div>
      ${p.phase === 'test' ? defectBox(adv) : ''}
      <button class="go" data-act="toLaunch" ${ready ? '' : 'disabled'}>${ready ? '출시 준비 →' : p.phase === 'design' ? '설계가 끝나면 시험을 시작합니다' : `시험 ${minT}주 뒤 출시할 수 있습니다`}</button>
      <button class="btn danger" data-act="cancelDev" style="width:100%;margin-top:8px">개발 취소</button></div>`;
    const card2 = `<div class="card"><p class="lbl">주간 기록</p>${log.length ? `<ul class="log">${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">한 주가 지나면 기록이 쌓입니다. 위쪽에서 빠르기를 고르세요.</p>'}</div>`;
    return { ov: ovh, panel: card1 + card2, look };
  }

  /** 결함 안내 한 줄(시험 단계·출시 화면) */
  const defectBox = (a: ReturnType<typeof Q.defectAdvice>) => `<div class="${a.level === 'many' ? 'badbox' : a.level === 'some' ? 'warnbox' : 'okbox'} defect-adv" data-level="${a.level}" style="margin-top:10px">${esc(a.text)}</div>`;

  // ----- 출시 -----
  function launchView() {
    const s = game!.state, L = launch!, p = Q.projectById(s, L.pid)!, base = bodyById(p.body).basePrice;
    const up = Q.unitProfit(p.body, p.powertrain, p.tier, p.options, L.price), ex = Q.expectedReviews(s, p.id, L.price), fc = Q.salesForecast(s, p.id, L.price, L.marketing), free = Q.hasFreeLine(s);
    const look = lookOf({ body: p.body, powertrain: p.powertrain, tier: p.tier, color: L.color, wheels: L.wheels, year: yearOf(s.week) });
    const ovh = ovTop('출시 준비', esc(p.name), `${specLine(p.body, p.powertrain, p.tier, p.segment)} · ${paintName(L.color)} · ${WHEELS[L.wheels].name}`) + ovScore('예상 평점', ex?.avg ?? null) + ovHint;
    const adv = Q.defectAdvice(p);
    const card0 = `<div class="card"><p class="lbl">남은 결함</p><div class="kpis">${kpi('남은 결함', `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('예상 리콜 위험', `연 ${Math.round(adv.recallYear * 100)}<span>%</span>`, adv.level === 'many' ? 'neg' : '')}</div>${defectBox(adv)}</div>`;
    const card1 = `<div class="card"><p class="lbl">판매 가격</p><div class="pricerow"><b id="lp-out">${num(L.price)}<span>만원</span></b><span class="margin ${up >= 0 ? 'pos' : 'neg'}">대당 이익 ${money(up, true)}</span></div>
      <input type="range" id="lprice" min="${Math.ceil(base * config.price.min)}" max="${Math.floor(base * config.price.max)}" step="10" value="${L.price}" aria-label="판매 가격(만원)">
      <p class="hint">기준 가격 ${money(base)}. 싸게 팔면 많이 팔리지만 대당 이익이 줄어듭니다.</p>
      <hr><p class="lbl">마케팅(매달 광고비)</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="lset" data-k="marketing" data-v="${i}" aria-pressed="${L.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div></div>`;
    const card2 = `<div class="card"><p class="lbl">색상</p>${paints('lset', L.color)}
      <p class="lbl" style="margin-top:14px">휠</p><div class="opts">${WHEELS.map((w, i) => `<button class="opt" data-act="lset" data-k="wheels" data-v="${i}" aria-pressed="${L.wheels === i}" style="min-height:0"><svg viewBox="0 0 80 42" aria-hidden="true"><circle cx="40" cy="21" r="${13 + i * 3}" fill="none" stroke="currentColor" stroke-width="${5 - i}"/><circle cx="40" cy="21" r="2.5" fill="currentColor"/></svg><b>${w.name}</b><small>${w.sub} · 겉모습만</small></button>`).join('')}</div></div>`;
    const critics = config.critics.list;
    const card3 = `<div class="card"><p class="lbl">예상(난수 없이 계산)</p>
      ${ex ? critics.map((c, i) => `<div class="stat"><span>${c.name}</span><div class="track"><u style="width:${ex.scores[i] * 10}%"></u></div><b>${score(ex.scores[i])}</b></div>`).join('') : ''}
      <div class="kpis" style="margin-top:10px">${kpi('예상 평점', ex ? score(ex.avg) : '—')}${kpi('예상 월 판매', fc ? `${num(fc.min)}~${num(fc.max)}<span>대</span>` : '—')}</div>
      ${fc ? `<p class="hint sales-fc" style="margin-top:8px">한 달에 약 <b>${num(fc.min)}~${num(fc.max)}대</b> 팔릴 것으로 보입니다(공장 한도 ${num(config.factory.capacity)}대).</p>` : ''}
      <p class="note">적은 쪽은 출시 직후(아직 덜 알려짐), 많은 쪽은 몇 달 뒤 알려지고 나서입니다. 실제 평론은 ±0.7 정도 달라집니다.</p>
      <button class="btn" data-act="tab" data-v="dev" style="width:100%;margin-top:8px">시험 더 하기(돌아가기)</button></div>`;
    const bar = `<div class="actbar">${free ? '' : `<div class="badbox">생산 라인이 모두 차 있습니다(공장 라인 ${config.factory.lines}개). 차고에서 판매 중인 차를 단종하면 그달 말부터 라인이 빕니다.</div><button class="btn" data-act="tab" data-v="garage">차고로 가서 단종하기</button>`}<button class="go" data-act="doLaunch" ${free ? '' : 'disabled'}>출시하기 <span aria-hidden="true">→</span></button></div>`;
    return { ov: ovh, panel: card0 + card1 + card2 + card3 + bar, look };
  }

  // ----- 리뷰 -----
  function showReview(g: Generation): void {
    const s = game!.state, name = nameOf(g), list = config.critics.list, avg = g.reviewAvg, c = config.critics;
    const best = g.reviews.indexOf(Math.max(...g.reviews)), worst = g.reviews.indexOf(Math.min(...g.reviews));
    const head = avg >= c.masterpiece ? `「${name}」 명차 탄생, 평론가들 극찬` : avg >= 6 ? `「${name}」 순조로운 데뷔` : avg > c.flop ? `「${name}」 무난하지만 아쉬움 남겨` : `「${name}」 혹평 쏟아져, "다시 만들어라"`;
    const bodyTxt = `${list[best].name}는 ${score(g.reviews[best])}점으로 가장 후한 점수를 줬고, ${list[worst].name}는 ${score(g.reviews[worst])}점에 그쳤다. ${avg >= 6 ? '전시장에는 첫 주부터 손님이 몰렸다.' : avg > c.flop ? '업계는 가격과 입소문이 판매를 가를 것으로 본다.' : '판매 담당자들의 표정이 어둡다.'}`;
    const rival = [...s.rivals].sort((a, b) => (b.cells[g.body] ?? 0) - (a.cells[g.body] ?? 0))[0];
    const quote = avg >= 7 ? '긴장하고 있다' : avg >= 5 ? '지켜보겠다' : '걱정하지 않는다';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>출시 평가 · ${esc(Q.monthLabel(g.launchMonth))}</div><h2>「${esc(name)}」 평론가 4명의 점수</h2>
      <div class="rgrid"><div><div class="critics">${list.map((cr, i) => `<div class="critic wait" data-i="${i}"><small>${cr.name}</small><em>${CRITIC_SUB[cr.id] ?? ''}</em><b>${score(g.reviews[i])}<span> / 10</span></b></div>`).join('')}</div>
      <div class="avgline later" id="rv-avg"><div><small class="hint">평균</small><b>${score(avg)}</b></div>${g.masterpiece ? '<span class="badge">명차 등록 · 평판 +' + c.masterpieceRep + '</span>' : avg <= c.flop ? `<span class="badge flop">혹평 · 평판 ${c.flopRep}</span>` : '<span class="chip">평범한 평가</span>'}</div></div>
      <div class="later" id="rv-news"><div class="news"><div class="mast"><span>모터 데일리</span><span>${esc(Q.monthLabel(g.launchMonth))}</span></div><h3>${esc(head)}</h3><p>${esc(bodyTxt)}</p>${rival ? `<div class="rv">${logo(rival.id, 22)}<span>${esc(rival.name)} 관계자: "${quote}"</span></div>` : ''}</div>
      <button class="go dark" data-act="closeReview">차고로 가기</button></div></div>`;
    sheet.hidden = false; renderTop();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, gap = still ? 0 : 650;
    list.forEach((_, i) => reviewTimers.push(window.setTimeout(() => { const el = sheetBody.querySelector(`.critic[data-i="${i}"]`); el?.classList.remove('wait'); el?.classList.add('pop'); }, gap * (i + 1))));
    reviewTimers.push(window.setTimeout(() => $('#rv-avg').classList.add('show'), gap * (list.length + 1)));
    reviewTimers.push(window.setTimeout(() => { $('#rv-news').classList.add('show'); sheetBody.querySelector<HTMLElement>('[data-act="closeReview"]')?.focus(); }, gap * (list.length + 2)));
  }

  // ----- 회사 -----
  function companyView(): string {
    const s = game!.state, L = s.ledger[s.ledger.length - 1], limit = Q.loanLimit(s), rate = Q.loanRate(s);
    const led = s.ledger, mx = Math.max(1, ...led.map((e) => Math.abs(e.profit)));
    const W = 480, H = 150, X0 = 56, bw = (W - X0) / 24;
    const chart = led.length ? `<svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="최근 24개월 이익"><line x1="${X0}" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#d8dde4"/>${led.map((e, i) => { const h = (Math.abs(e.profit) / mx) * (H / 2 - 4), y = e.profit >= 0 ? H / 2 - h : H / 2; return `<rect x="${(X0 + i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${e.profit >= 0 ? '#12915a' : '#d43c3c'}"><title>${e.year}년 ${e.monthOfYear}월 ${money(e.profit, true)}</title></rect>`; }).join('')}
      <text x="${X0 - 6}" y="12" font-size="11" fill="#8b94a1" text-anchor="end">+${money(mx)}</text><text x="${X0 - 6}" y="${H / 2 + 4}" font-size="11" fill="#8b94a1" text-anchor="end">0</text><text x="${X0 - 6}" y="${H - 2}" font-size="11" fill="#8b94a1" text-anchor="end">−${money(mx)}</text><text x="${W - 2}" y="${H + 14}" font-size="11" fill="#8b94a1" text-anchor="end">${led[led.length - 1].year}년 ${led[led.length - 1].monthOfYear}월</text><text x="${X0}" y="${H + 14}" font-size="11" fill="#8b94a1">${led[0].year}년 ${led[0].monthOfYear}월</text></svg>` : '<p class="hint">첫 달 결산이 끝나면 그래프가 나옵니다.</p>';
    const rows: [string, number][] = L ? [['차 원가', L.cogs], ['직원 월급', L.salaries], ['공장·본사 유지비', L.upkeep], ['개발비', L.dev], ['마케팅', L.marketing], ['대출 이자', L.interest], ['리콜', L.recall]] : [];
    const table = L ? `<table class="tbl"><tr><th>${L.year}년 ${L.monthOfYear}월</th><th class="r">금액</th></tr><tr><td>판매 수입 (${num(L.sold)}대)</td><td class="r pos">${money(L.revenue, true)}</td></tr>${rows.filter(([, v]) => v).map(([n, v]) => `<tr><td>${n}</td><td class="r neg">${money(-v)}</td></tr>`).join('')}<tr class="sum"><td>이익</td><td class="r ${L.profit >= 0 ? 'pos' : 'neg'}">${money(L.profit, true)}</td></tr></table>` : '';
    const fin = `<div class="card"><h3>재무</h3><div class="kpis">${kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}${kpi('대출', money(s.loan.balance))}${kpi('대출 한도', money(limit))}${kpi('월 이자', `${(rate * 100).toFixed(1)}<span>%</span>`)}</div>
      <p class="lbl" style="margin-top:14px">최근 24개월 이익</p>${chart}${table ? `<p class="lbl" style="margin-top:14px">지난달 수입과 지출</p>${table}` : ''}
      <p class="lbl" style="margin-top:14px">대출</p><div class="row">${[10000, 50000, 100000].map((a) => `<button class="btn" data-act="borrow" data-v="${a}" ${s.loan.balance + a > limit ? 'disabled' : ''}>${money(a)} 빌리기</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="repay" data-v="10000" ${s.loan.balance < 10000 || s.cash < 10000 ? 'disabled' : ''}>1억 갚기</button><button class="btn" data-act="repay" data-v="all" ${s.loan.balance <= 0 || s.cash < s.loan.balance ? 'disabled' : ''}>모두 갚기</button></div>
      <p class="note">한도는 20억에 최근 1년 매출의 30%를 더한 값입니다. 한도의 70% 넘게 빌리면 이자가 올라갑니다. 현금이 6개월 넘게 마이너스면 파산합니다.</p>
      ${s.cash < 0 && !s.loan.bailoutUsed ? `<div class="badbox" style="margin-top:10px">현금이 ${s.negMonths}개월째 마이너스입니다. 구제 금융(한 번만)을 받으면 현금이 0이 되지만 평판이 ${-config.bankruptcy.bailoutRep} 떨어지고 대출 한도가 절반이 됩니다.</div><button class="btn danger" data-act="bailout" style="width:100%;margin-top:8px">구제 금융 받기</button>` : ''}</div>`;
    const staff = `<div class="card"><h3>직원 ${s.staff.length}명</h3><table class="tbl"><tr><th>이름</th><th>직무</th><th>능력</th><th class="r">컨디션</th><th class="r">하는 일</th></tr>${s.staff.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${ROLE_NAME[x.role]}<br><small class="hint">${ROLE_SKILL[x.role]}</small></td><td><span class="abil"><u style="width:${x.ability}%"></u></span>${x.ability}</td><td class="r">${Math.round(x.condition * 100)}%</td><td class="r">${x.projectId === null ? '쉬는 중' : '개발 중'}</td></tr>`).join('')}</table>
      <p class="hint" style="margin-top:8px">월급 합계 ${money(s.staff.reduce((a, x) => a + Q.salaryOf(x.ability), 0))}/월</p><button class="btn" disabled style="width:100%;margin-top:8px">직원 채용 · 교육 (3단계에서 열립니다)</button></div>`;
    const used = sellingGens(s).length;
    const factory = `<div class="card"><h3>공장</h3><div class="kpis">${kpi('공장 등급', '1<span>등급</span>')}${kpi('한 달 생산', `${num(config.factory.capacity)}<span>대</span>`)}${kpi('생산 라인', `${used} / ${config.factory.lines}<span>개 사용</span>`)}${kpi('월 유지비', money(config.factory.upkeep + config.hq.upkeep))}</div>
      <p class="note">생산 라인 하나에 차 한 종류를 만듭니다. 주문이 생산량보다 많으면 나머지는 못 팝니다.</p><button class="btn" disabled style="width:100%;margin-top:8px">공장 증설 (3단계에서 열립니다)</button></div>`;
    const mine = sellingGens(s).reduce((a, g) => a + (g.sales[g.sales.length - 1] ?? 0), 0);
    const rivals = `<div class="card"><h3>경쟁사</h3><div class="rivals">${s.rivals.map((r) => `<div>${logo(r.id, 26)}<span>${esc(r.name)}<br><small>${esc(RIVALS.find((x) => x.id === r.id)?.trait ?? '')}</small></span><small>${Object.entries(r.cells).filter(([, v]) => v >= 1.05).map(([b]) => bodyById(b).name).join('·') || '고르게'} 강함</small></div>`).join('')}<div class="me">${logo('me', 26)}<span>${esc(s.companyName)}<br><small style="color:#fffa">평판 ${Math.round(s.reputation)}</small></span><span>지난달 ${num(mine)}대</span></div></div><p class="note">회사 이름과 로고는 실제 브랜드를 비튼 가짜이며, 도형은 새로 그렸습니다.</p></div>`;
    return `<div class="cols">${fin}<div style="display:flex;flex-direction:column;gap:12px">${staff}${factory}${rivals}</div></div>`;
  }

  // ----- 기록 -----
  function recordsView(): string {
    const s = game!.state, gens = allGens(s).sort((a, b) => b.launchWeek - a.launchWeek);
    if (!gens.length) return '<div class="card"><h3>기록</h3><p class="hint">아직 낸 차가 없습니다. 차를 출시하면 그 순간의 사진과 평론, 판매 기록이 여기 남습니다.</p></div>';
    const total = gens.reduce((a, g) => a + g.totalSold, 0);
    return `<div class="card"><h3>지금까지 낸 차 ${gens.length}대</h3><div class="kpis">${kpi('누적 판매', `${num(total)}<span>대</span>`)}${kpi('명차', `${gens.filter((g) => g.masterpiece).length}<span>대</span>`)}${kpi('평판', String(Math.round(s.reputation)))}</div></div>
      <div class="recs">${gens.map((g) => { const ph = ui.photos[g.id]; return `<article class="rec"><div class="ph">${ph ? `<img src="${ph}" alt="${esc(nameOf(g))} 출시 사진">` : silhouetteSvg(genLook(g), { color: currentEdition(g).color })}</div><div class="bd"><h3>${esc(nameOf(g))} <small class="hint">${g.number}세대</small></h3>
        <div class="meta">${Q.monthLabel(g.launchMonth)} 출시 · ${bodyById(g.body).name} · ${segName(g.segment)}용<br>평론 ${score(g.reviewAvg)} · 누적 ${num(g.totalSold)}대 · 이익 ${money(g.profit, true)}</div>
        <div class="row">${g.masterpiece ? '<span class="chip gold">명차</span>' : ''}${g.status === 'onSale' ? '<span class="chip on">판매 중</span>' : g.status === 'ending' ? '<span class="chip">이번 달 단종</span>' : `<span class="chip">단종 ${g.endMonth === null ? '' : Q.monthLabel(g.endMonth)}</span>`}${g.recalls ? `<span class="chip bad">리콜 ${g.recalls}번</span>` : ''}</div></div></article>`; }).join('')}</div>`;
  }

  // ----- 파산 -----
  function showGameOver(): void {
    gameOverShown = true; $('#toasts').innerHTML = '';
    const s = game!.state, months = Math.floor(s.week / config.time.weeksPerMonth), gens = allGens(s);
    title.className = 'cover over'; title.hidden = false;
    title.innerHTML = `<div class="inner"><div class="eyebrow"><i></i>${esc(s.companyName)} · ${esc(game!.dateLabel)}</div><div class="big">회사가 파산했습니다</div><p class="tag">현금이 ${config.bankruptcy.months}개월 넘게 마이너스였습니다.</p>
      <div class="kpis">${kpi('버틴 기간', `${Math.floor(months / 12)}<span>년</span> ${months % 12}<span>개월</span>`)}${kpi('낸 차', `${gens.length}<span>대</span>`)}${kpi('누적 판매', `${num(gens.reduce((a, g) => a + g.totalSold, 0))}<span>대</span>`)}</div>
      <button class="btn ${s.loan.bailoutUsed ? '' : 'ink'}" data-act="bailout" ${s.loan.bailoutUsed ? 'disabled' : ''}>${s.loan.bailoutUsed ? '구제 금융은 이미 받았습니다' : '구제 금융 받고 계속하기(한 번만)'}</button>
      <p class="note">${s.loan.bailoutUsed ? '구제 금융은 한 판에 한 번만 받을 수 있습니다. ' : `구제 금융을 받으면 현금이 0이 되고, 평판이 ${-config.bankruptcy.bailoutRep} 떨어지며, 대출 한도가 절반이 됩니다. `}이전 저장 칸을 불러와 다시 해 볼 수도 있습니다.</p>
      <div class="row"><button class="go" data-act="newGame" style="flex:1">새 게임</button><button class="btn" data-act="home" style="flex:1;min-height:56px">처음 화면(불러오기)</button></div></div><div class="ver">v${CAR_VERSION}</div>`;
    renderTop();
  }

  // ---------- 처음 화면 ----------
  async function showTitle(): Promise<void> {
    sheet.hidden = true;
    const saves = await S.list(), newest = [...saves].sort((a, b) => b.when.localeCompare(a.when))[0];
    const slotName = (k: S.SlotKey) => (k === 'auto' ? '자동 저장' : `저장 칸 ${k.slice(-1)}`);
    const info = (x: S.SlotInfo) => `${esc(x.company)} · ${esc(Q.dateLabel(x.week))} · 차 ${x.cars}종`;
    const home = `<div class="row">${newest ? `<button class="go" data-act="continue" data-v="${newest.key}">이어 하기 <small style="font-weight:600;font-size:12px">${info(newest)}</small></button>` : ''}<button class="go ${newest ? 'dark' : ''}" data-act="titleNew">새 게임</button></div>
      ${saves.length ? `<p class="lbl" style="margin-top:8px">저장된 게임</p><div class="menu-slots">${saves.map((x) => `<div class="slot"><div><b>${slotName(x.key)}</b><small>${info(x)} · ${esc(x.when.slice(0, 16).replace('T', ' '))}</small></div><button class="btn" data-act="loadSlot" data-v="${x.key}">불러오기</button></div>`).join('')}</div>` : ''}
      <button class="btn" data-act="import" style="margin-top:4px">파일에서 불러오기</button>`;
    const form = `<label for="t-co">회사 이름</label><input class="namein" id="t-co" type="text" maxlength="16" placeholder="새 회사" autocomplete="off">
      <details><summary>자세히: 시드(같은 시드면 같은 판)</summary><input class="namein" id="t-seed" type="text" inputmode="numeric" placeholder="비우면 무작위" autocomplete="off"></details>
      <button class="go" data-act="startNew">회사 세우기 <span aria-hidden="true">→</span></button><button class="btn" data-act="titleHome">돌아가기</button>`;
    title.innerHTML = `<div class="inner"><div class="gname">${logo('me', 64)}카 컴퍼니</div><p class="tag">1970년, 직원 4명의 작은 공장에서 시작합니다. 차를 기획하고, 개발하고, 출시해서 팔아 회사를 키우세요.</p>${titleMode === 'new' ? form : home}<p class="note">가칭입니다. 회사 이름과 로고는 실제 브랜드를 비튼 가짜입니다.</p></div><div class="ver">v${CAR_VERSION}</div>`;
    title.className = 'cover'; title.hidden = false;
    if (titleMode === 'new') $('#t-co').focus();
    renderTop();
  }
  function adopt(g: Game, extra: S.UiExtra): void {
    game = g; ui = extra; screen = 'garage'; draft = null; launch = null; garageIdx = 0; gameOverShown = false;
    garagePrice.clear(); devLog.clear(); devPrev.clear(); lastPanel = ''; lastOv = '';
    title.hidden = true; sheet.hidden = true; makeStage(); speed = 1; acc = 0;
    render();
  }
  async function loadKey(k: S.SlotKey): Promise<void> {
    const d = await S.get(k);
    const r = d ? S.parse(d) : { ok: false as const, error: '빈 칸입니다' };
    if (!r.ok) return err(r.error);
    adopt(r.game, r.ui); toast(`${k === 'auto' ? '자동 저장' : `저장 칸 ${k.slice(-1)}`}을 불러왔습니다`);
  }
  function importFile(): void {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const r = S.parseText(await f.text());
      if (!r.ok) return err(r.error);
      if (game && title.hidden && !(await ask('지금 하던 게임은 저장하지 않으면 사라집니다. 파일을 불러올까요?', '불러오기'))) return;
      adopt(r.game, r.ui); toast('파일에서 불러왔습니다');
    };
    inp.click();
  }

  // ---------- 메뉴(저장·설정) ----------
  async function showMenu(): Promise<void> {
    if (!game) return;
    const saves = await S.list(), by = new Map(saves.map((x) => [x.key, x]));
    const line = (k: S.SlotKey) => { const x = by.get(k); return x ? `${esc(x.company)} · ${esc(Q.dateLabel(x.week))} · ${esc(x.when.slice(0, 16).replace('T', ' '))}` : '비어 있음'; };
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>메뉴</div><h2>저장과 설정</h2><div class="menu-slots">
      ${S.SLOT_KEYS.map((k, i) => `<div class="slot"><div><b>저장 칸 ${i + 1}</b><small>${line(k)}</small></div><div class="row"><button class="btn ink" data-act="saveSlot" data-v="${k}">저장</button><button class="btn" data-act="loadSlot" data-v="${k}" ${by.has(k) ? '' : 'disabled'}>불러오기</button></div></div>`).join('')}
      <div class="slot"><div><b>자동 저장</b><small>매달 결산 때 저장 · ${line('auto')}</small></div><button class="btn" data-act="loadSlot" data-v="auto" ${by.has('auto') ? '' : 'disabled'}>불러오기</button></div></div>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="export">파일로 내보내기</button><button class="btn" data-act="import">파일에서 가져오기</button></div>
      <p class="note">브라우저 저장소는 지워질 수 있으니 가끔 파일로 내보내 두세요.</p>
      <div class="toggle" style="margin-top:10px"><span>디버그 표시(화면 속도·주 번호·시드)</span><button class="btn" data-act="debug" aria-pressed="${debugOn}">${debugOn ? '켜짐' : '꺼짐'}</button></div>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="home">처음 화면으로</button><button class="btn ink" data-act="closeSheet">닫기</button></div>`;
    sheet.hidden = false; renderTop();
  }
  function download(name: string, text: string): void {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- 조작 ----------
  function run(r: { ok: true } | { ok: false; reason: string }): boolean { if (!r.ok) err(r.reason); return r.ok; }
  async function act(a: string, el: HTMLElement): Promise<void> {
    const v = el.dataset.v ?? '', s = game?.state;
    switch (a) {
      case 'tab': screen = v as Screen; if (v === 'dev' && launch) launch = null; go(screen); return;
      case 'plan': if (!s) return; if (s.projects.length >= config.dev.teams) return err('개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.'); draft = newDraft(); planTab = 'body'; go('plan'); return;
      case 'ptab': planTab = v as PlanTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'pick': {
        if (!draft) return; const k = el.dataset.k as keyof Draft;
        (draft as unknown as Record<string, unknown>)[k] = k === 'tier' || k === 'designWeeks' ? Number(v) : v;
        if (k === 'powertrain') draft.tier = Math.min(draft.tier, powertrainById(v).tiers.length);
        render(); return;
      }
      case 'opt': if (!draft) return; draft.options = draft.options.includes(v) ? draft.options.filter((x) => x !== v) : [...draft.options, v].slice(0, config.dev.maxOptions); render(); return;
      case 'dir': { if (!draft) return; const k = el.dataset.k as Stat, n = draft.direction[k] + Number(v); if (n < 0 || n > config.dev.dirMax || (Number(v) > 0 && dirLeft(draft) <= 0)) return; draft.direction[k] = n; render(); return; }
      case 'cancelPlan': draft = null; go('garage'); return;
      case 'startDev': {
        if (!game || !draft) return;
        const { color, ...spec } = draft;
        if (!run(game.command({ type: 'startProject', ...spec, name: spec.name.trim() || defaultName() }))) return;
        const p = game.state.projects[game.state.projects.length - 1] as Project;
        ui.colors[p.id] = color; devPrev.set(p.id, 0); draft = null;
        toast(`「${p.name}」 개발을 시작했습니다. 위쪽에서 빠르기를 골라 시간을 보내세요.`); go('dev'); return;
      }
      case 'cancelDev': {
        const p = s?.projects[0]; if (!p || !game) return;
        if (!(await ask(`「${p.name}」 개발을 취소할까요?\n지금까지 쓴 개발비 ${money(p.spent)}는 돌아오지 않습니다.`, '개발 취소', true))) return;
        if (run(game.command({ type: 'cancelProject', projectId: p.id }))) { delete ui.colors[p.id]; toast('개발을 취소했습니다'); go('dev'); }
        return;
      }
      case 'toLaunch': {
        const p = s?.projects[0]; if (!p) return;
        launch = { pid: p.id, price: bodyById(p.body).basePrice, marketing: 1, color: ui.colors[p.id] ?? PAINT[0][1], wheels: 1 }; go('launch'); return;
      }
      case 'lset': if (!launch) return; (launch as unknown as Record<string, unknown>)[el.dataset.k!] = el.dataset.k === 'color' ? v : Number(v); render(); return;
      case 'doLaunch': {
        if (!game || !launch) return;
        const L = launch, p = Q.projectById(game.state, L.pid), adv = p && Q.defectAdvice(p);
        if (adv?.level === 'many' && !(await ask(`남은 결함이 약 ${p!.defectEst}개로 아직 많습니다.\n지금 출시하면 평론가 4명이 모두 ${config.critics.manyDefectsPenalty}점씩 깎고, 리콜 위험이 연 ${Math.round(adv.recallYear * 100)}%입니다. 몇 주 더 시험하면 결함이 줄어듭니다.`, '그래도 출시', true, '시험 더 하기'))) { launch = null; go('dev'); return; }
        if (launch !== L) return;
        const before = new Set(allGens(game.state).map((g) => g.id));
        stage?.setColor(L.color);
        if (!run(game.command({ type: 'launch', projectId: L.pid, price: L.price, marketing: L.marketing, color: L.color, wheels: L.wheels }))) return;
        const g = allGens(game.state).find((x) => !before.has(x.id));
        if (g) snapPhoto(g.id);
        devLog.delete(L.pid); delete ui.colors[L.pid]; launch = null; screen = 'garage'; garageIdx = g ? sellingGens(game.state).findIndex((x) => x.id === g.id) : 0; lastPanel = '';
        render(); if (g) showReview(g); return;
      }
      case 'closeReview': reviewTimers.forEach(clearTimeout); sheet.hidden = true; go('garage'); return;
      case 'gprev': garageIdx--; render(); return;
      case 'gnext': garageIdx++; render(); return;
      case 'setPrice': { if (!game) return; const id = Number(el.dataset.id), price = garagePrice.get(id); if (price === undefined) return; if (run(game.command({ type: 'setPrice', generationId: id, price }))) { garagePrice.delete(id); toast(`가격을 ${num(price)}만원으로 바꿨습니다. 다음 결산부터 반영됩니다.`); render(); } return; }
      case 'setMk': if (game && run(game.command({ type: 'setMarketing', generationId: Number(el.dataset.id), marketing: Number(v) }))) render(); return;
      case 'discontinue': {
        if (!game) return; const g = Q.generationById(game.state, Number(el.dataset.id)); if (!g) return;
        if (!(await ask(`「${nameOf(g)}」${eulReul(nameOf(g))} 단종할까요?\n이번 달 말까지만 팔고(마지막 달은 재고 처분이라 판매가 절반), 다음 달부터 생산 라인이 빕니다. 잘 팔리는 차를 단종하면 평판이 ${-config.discontinue.rep} 떨어집니다. 차 이름은 기록에 남습니다.`, '단종하기', true))) return;
        if (run(game.command({ type: 'discontinue', generationId: g.id }))) { toast(`「${nameOf(g)}」 단종을 정했습니다. 이번 달 말에 생산을 마칩니다.`); render(); }
        return;
      }
      case 'borrow': if (game && run(game.command({ type: 'borrow', amount: Number(v) }))) { toast(`${money(Number(v))}을 빌렸습니다`); render(); } return;
      case 'repay': if (game && run(game.command({ type: 'repay', amount: v === 'all' ? game.state.loan.balance : Number(v) }))) { toast('대출을 갚았습니다'); render(); } return;
      case 'bailout': {
        if (!game) return;
        if (!(await ask(`구제 금융을 받을까요? (한 번만)\n현금이 0이 되고, 평판이 ${-config.bankruptcy.bailoutRep} 떨어지며, 대출 한도가 절반이 됩니다.`, '받기', true))) return;
        const r = game.command({ type: 'bailout' });
        if (!r.ok) return err(r.reason);
        if (gameOverShown) { gameOverShown = false; title.hidden = true; title.className = 'cover'; screen = 'garage'; lastPanel = ''; lastOv = ''; }
        toast('구제 금융을 받았습니다. 현금이 0이 되었습니다.', 'alert'); render(); return;
      }
      case 'titleNew': titleMode = 'new'; void showTitle(); return;
      case 'titleHome': titleMode = 'home'; void showTitle(); return;
      case 'newGame': titleMode = 'new'; void showTitle(); return;
      case 'home': if (game && game.state.status === 'playing' && !(await ask('처음 화면으로 갈까요? 저장하지 않은 진행은 자동 저장(매달)까지만 남습니다.', '처음 화면'))) return; titleMode = 'home'; sheet.hidden = true; void showTitle(); return;
      case 'startNew': {
        const co = $<HTMLInputElement>('#t-co').value.trim(), sd = ($<HTMLInputElement>('#t-seed').value || '').trim();
        const seed = /^\d+$/.test(sd) ? Number(sd) % 4294967296 : Math.floor(Math.random() * 1e9);
        adopt(Game.create({ seed, companyName: co }), { photos: {}, colors: {} }); toast(`「${game!.state.companyName}」을(를) 세웠습니다. 첫 차를 기획해 보세요.`); return;
      }
      case 'continue': case 'loadSlot': {
        if (a === 'loadSlot' && game && title.hidden && !(await ask('지금 하던 게임은 저장하지 않으면 사라집니다. 불러올까요?', '불러오기'))) return;
        await loadKey(v as S.SlotKey); return;
      }
      case 'saveSlot': {
        if (!game) return;
        const has = (await S.list()).some((x) => x.key === v);
        if (has && !(await ask(`저장 칸 ${v.slice(-1)}을 덮어쓸까요?`, '덮어쓰기'))) return;
        if (await S.put(v as S.SlotKey, S.makeSave(game, ui))) toast(`저장 칸 ${v.slice(-1)}에 저장했습니다`); else err('저장하지 못했습니다(브라우저 저장 공간 부족)');
        void showMenu(); return;
      }
      case 'export': if (game) { download(`car-company-${game.state.week}w.json`, JSON.stringify(S.makeSave(game, ui))); toast('파일로 내보냈습니다'); } return;
      case 'import': importFile(); return;
      case 'debug': debugOn = !debugOn; try { localStorage.setItem(DEBUG_KEY, debugOn ? '1' : '0'); } catch { /* 저장 불가 */ } renderDebug(); void showMenu(); return;
      case 'closeSheet': sheet.hidden = true; render(); return;
    }
  }

  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (b && !b.hasAttribute('disabled')) void act(b.dataset.act!, b);
  });
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'pname' && draft) { draft.name = t.value; const o = document.getElementById('pname-ov'); if (o) o.textContent = t.value.trim() || defaultName(); }
    else if (t.id === 'lprice' && launch) { launch.price = Number(t.value); render(); }
    else if (t.id === 'gprice') { garagePrice.set(Number(t.dataset.gen), Number(t.value)); updateGaragePrice(t); }
  });
  /** 끄는 중에는 패널 전체를 다시 그리지 않고 숫자만 바꾼다 */
  function updateGaragePrice(t: HTMLInputElement): void {
    const g = game && Q.generationById(game.state, Number(t.dataset.gen)); if (!g) return;
    const e = currentEdition(g), price = Number(t.value), up = Q.unitProfit(g.body, g.powertrain, e.tier, e.options, price);
    $('#gp-out').innerHTML = `${num(price)}<span>만원</span>`;
    const m = $('#gp-margin'); m.textContent = `대당 이익 ${money(up, true)}`; m.className = `margin ${up >= 0 ? 'pos' : 'neg'}`;
    const btn = panel.querySelector<HTMLButtonElement>('[data-act="setPrice"]'); if (btn) btn.disabled = price === e.price;
  }
  document.addEventListener('pointerdown', () => { dragging = true; });
  document.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('pointercancel', () => { dragging = false; });
  document.addEventListener('change', (e) => { if ((e.target as HTMLElement).id === 'lprice') render(); });
  for (const b of document.querySelectorAll<HTMLElement>('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
  for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.addEventListener('click', () => { if (!game) return; if (screen === 'plan' && b.dataset.tab !== 'dev') draft = null; launch = null; go(b.dataset.tab as Screen); });
  $('#menubtn').addEventListener('click', () => void showMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#ask').hidden) $('#ask-no').click();
    else if (!sheet.hidden) { const close = sheetBody.querySelector<HTMLElement>('[data-act="closeReview"],[data-act="closeSheet"]'); close?.click(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target as HTMLElement).id === 't-co') $('[data-act="startNew"]').click(); });

  // 스모크 테스트·디버그용
  (window as unknown as { __car: unknown }).__car = {
    get game() { return game; }, get screen() { return screen; }, get ui() { return ui; }, get speed() { return speed; }, get stage() { return stage; },
    tick(n = 1) { for (let i = 0; i < n && game && game.state.status === 'playing'; i++) tickOnce(); render(); },
    setSpeed, render, held: isHeld,
  };

  makeStage();
  void showTitle();
}
