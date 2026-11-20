// 카 컴퍼니 화면(바닐라 TS + DOM, 에어 게임 방식). sim 상태는 읽기만 하고 바꿀 때는 game.command(...)만 쓴다.
import { config } from '../config';
import { RIVALS, SEGMENTS, COMPAT, bodyById, powertrainById } from '../data';
import { Game, allGens, sellingGens } from '../sim/game';
import * as Q from '../sim/queries';
import { currentEdition } from '../sim/market';
import { monthOf, yearOf } from '../sim/time';
import { STATS, type Budget, type CommandResult, type DevWeekEvent, type GameEvent, type Generation, type Project, type ProjectSpec, type Stat, type Stats } from '../sim/types';
import { Stage } from '../render/stage';
import { silhouetteSvg } from '../render/silhouette';
import { describeLook } from '../render/variant';
import type { CarLook } from '../render/look';
import { createOffice, type Office, type OfficeEvent, type OfficeView } from './office/office';
import { CAR_VERSION } from '../version';
import * as S from '../io/saves';
import { BUDGET, MARKETING, ROLE_NAME, ROLE_SKILL, STAT_NAME, TIER_SUB, esc, eulReul, money, num, score } from './fmt';
import { PAINT, WHEELS, logo, lookOf, paintName, ring } from './art';

type Screen = 'garage' | 'start' | 'plan' | 'lift' | 'dev' | 'launch' | 'company' | 'records';
type Tab = 'garage' | 'dev' | 'company' | 'records';
type PlanTab = 'prev' | 'body' | 'look' | 'seg' | 'power' | 'opt' | 'dir' | 'budget';
/** 기획 초안. nameplateId 0 = 새 차종, 아니면 그 차종의 풀체인지 */
type Draft = ProjectSpec & { color: string; nameplateId: number; chassisSeed: number; faceSeed: number };
/** 페이스리프트 기획 */
interface LiftSet { genId: number; faceSeed: number; options: string[]; tier: number }
type View = { ov: string; panel: string; look?: CarLook | null; office?: OfficeView };
interface LaunchSet { pid: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }

const WEEK_MS = 1500; // 1배속: 1주 = 1.5초(설계서 4장)
const MAX_TICKS_PER_FRAME = 4;
const DEBUG_KEY = 'car-company-debug';
const ALL_TABS: [PlanTab, string][] = [['prev', '전 세대'], ['body', '차체'], ['look', '모양'], ['seg', '고객층'], ['power', '동력'], ['opt', '옵션'], ['dir', '개발 방향'], ['budget', '예산·기간']];
const planTabs = (d: Draft): [PlanTab, string][] => (d.nameplateId ? ALL_TABS : ALL_TABS.slice(1));
const CRITIC_SUB: Record<string, string> = { performance: '힘과 멋을 봅니다', household: '쓸모·연비·품질을 봅니다', design: '디자인과 마감을 봅니다', value: '값에 비해 좋은지 봅니다' };
const COMPAT_TEXT: [number, string][] = [[1.15, '◎ 잘 맞는 조합'], [0.95, '○ 무난한 조합'], [0.75, '△ 덜 맞는 조합'], [0, '× 안 맞는 조합']];

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector<T>(s)!;

export function startApp(): void {
  let game: Game | null = null;
  let ui: S.UiExtra = { photos: {}, colors: {} };
  let screen: Screen = 'garage';
  let speed = 1, acc = 0, garageIdx = 0, planTab: PlanTab = 'body';
  let draft: Draft | null = null, launch: LaunchSet | null = null, lift: LiftSet | null = null;
  let startSel: 'full' | 'lift' | null = null; // 기획 첫 화면에서 고른 갈래(목록의 해당 버튼을 강조)
  let office: Office | null = null, officeOn = false, officeLast: OfficeView | null = null, officeScores = 0; // officeLast·officeScores: 점검용
  const officeEvents: OfficeEvent[] = []; // 다음에 사무실을 그릴 때 보낼 연출(주간 점수·결함·말풍선)
  const thumbs = new Map<string, string>(); // 모양 후보 썸네일 캐시
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
  function toast(text: string, kind: '' | 'alert' | 'bad' = '', head = '', ms = kind ? 9000 : 4000, key = '', open?: { label: string; fn: () => void }): void {
    const box = $('#toasts'), t = document.createElement('div');
    box.style.setProperty('--tt', `${Math.round($('#top').getBoundingClientRect().bottom + 8)}px`); // 폰: 상단바 바로 아래

    const old = key ? keyed.get(key) : undefined;
    if (old?.isConnected) old.remove();
    if (key) keyed.set(key, t);
    t.className = `toast ${kind}`;
    t.innerHTML = `<div>${head ? `<b>${esc(head)}</b>` : ''}${esc(text)}${open ? `<button class="open">${esc(open.label)}</button>` : ''}</div><button class="x" aria-label="닫기">×</button>`;
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    if (open) (t.querySelector('.open') as HTMLElement).onclick = () => { close(); open.fn(); };
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
  /** 개발 탭의 사무실(13.1). null이면 사무실을 숨기고 3D 무대로 돌아간다 */
  function showOffice(v: OfficeView | null): void {
    officeOn = !!v;
    const host = $('#office');
    host.hidden = !v; $<HTMLCanvasElement>('#cv').hidden = !stage || !!v;
    if (v) {
      $('#fb').hidden = true;
      office ??= createOffice(host);
      office.update(v); officeLast = v; // update → emit 순서
      if (officeEvents.length) { const ev = officeEvents.splice(0); officeScores += ev.filter((e) => e.kind === 'score').length; office.emit(ev); }
    } else { const keep = officeEvents.filter((e) => e.kind === 'say').slice(-2); officeEvents.length = 0; officeEvents.push(...keep); } // 주간 점수는 버리고 말풍선만 남긴다
    stageOn();
  }
  function officeView(p?: Project): OfficeView {
    const s = game!.state;
    return {
      level: 1, phase: p ? p.phase : 'rest', budget: p?.budget ?? 'normal',
      staff: s.staff.map((x) => ({ id: String(x.id), name: x.name, role: x.role, condition: x.condition, working: x.projectId !== null })),
      projectName: p ? `${p.name}${p.kind === 'facelift' ? ' 페이스리프트' : ''}` : undefined,
      carSvg: p ? silhouetteSvg(projLook(p, ui.colors[p.id] ?? PAINT[0][1]), { color: ui.colors[p.id] ?? PAINT[0][1] }) : undefined,
      progress: p ? (p.phase === 'design' ? p.weeksDone / p.designWeeks : 1) : undefined, defects: p?.defectEst,
    };
  }
  /** 주간 개발 기록 → 사무실 연출: 직원마다 가장 큰 능력치 1개(정수, 0이면 생략), 결함 증감 */
  function officeFromWeek(e: DevWeekEvent): OfficeEvent[] {
    const out: OfficeEvent[] = [];
    for (const x of e.staff) {
      const [k, v] = STATS.map((k) => [k, Math.round(x.stats[k])] as [Stat, number]).sort((a, b) => b[1] - a[1])[0];
      if (v > 0) out.push({ kind: 'score', staffId: String(x.id), stat: STAT_NAME[k], amount: v });
    }
    if (e.defectsAdded >= 0.5) out.push({ kind: 'defectFound' });
    if (e.defectsRemoved >= 0.5) out.push({ kind: 'defectFixed' });
    return out;
  }
  /** 모양 후보 썸네일(한 번 만든 것은 캐시). WebGL이 없으면 옆모습 SVG */
  function thumb(look: CarLook, yaw = -0.65, w = 240, h = 150): string {
    if (!stage) return silhouetteSvg(look, { color: look.color });
    const key = JSON.stringify([look, yaw, w, h]);
    let url = thumbs.get(key);
    if (!url) { try { url = stage.renderThumb(look, w, h, yaw); } catch { return silhouetteSvg(look, { color: look.color }); } thumbs.set(key, url); }
    return `<img src="${url}" alt="" width="${w}" height="${h}">`;
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
  function snapPhoto(key: string | number): void {
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
      ui.photos[key] = c.toDataURL('image/jpeg', 0.82);
    };
    img.src = url;
  }

  // ---------- 시간 ----------
  const deciding = () => screen === 'start' || screen === 'plan' || screen === 'lift' || screen === 'launch';
  const isHeld = (): boolean => !game || !title.hidden || !sheet.hidden || !$('#ask').hidden || deciding() || game.state.status !== 'playing';
  const decisionHeld = (): boolean => !!game && title.hidden && (!sheet.hidden || !$('#ask').hidden || deciding());

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
      case 'designDone': toast(e.text, 'alert', '설계 끝'); officeEvents.push({ kind: 'say', text: '설계 끝! 이제 시험이에요', mood: 'test' }); break;
      case 'devWeek': { // 알림으로 띄우지 않고 사무실 연출로. 여러 주가 한 번에 지나면 마지막 주 점수·결함만(글자가 겹치지 않게)
        const keep = officeEvents.filter((x) => x.kind === 'say'); officeEvents.length = 0; officeEvents.push(...keep, ...officeFromWeek(e)); break;
      }
      case 'news': toast(e.text, 'alert', '모터 데일리', 9000, '', { label: '신문 보기', fn: () => showNews(e.text) }); break;
      case 'advice': toast(e.text, 'alert', '조언', 9000); break;
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
      const pv = devGrades(p);
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
  const stageOn = () => {
    const vis = !document.hidden && title.hidden && !$('#main').classList.contains('full');
    stage?.setActive(vis && !officeOn); office?.setActive(vis && officeOn);
  };

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
    const tab: Tab = deciding() ? 'dev' : (screen as Tab);
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
    if (screen === 'lift' && (!lift || !Q.generationById(s, lift.genId))) screen = 'garage';
    const v: View = screen === 'garage' ? garageView() : screen === 'start' ? startView() : screen === 'plan' ? planView() : screen === 'lift' ? liftView()
      : screen === 'dev' ? devView() : screen === 'launch' ? launchView()
      : { ov: '', panel: screen === 'company' ? companyView() : recordsView(), look: undefined };
    $('#main').classList.toggle('full', v.look === undefined && !v.office);
    showOffice(v.office ?? null);
    if (v.look !== undefined && !v.office) showLook(v.look);
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
  const genYear = (g: Generation) => Math.floor(g.launchMonth / 12) + config.time.startYear;
  /** 세대의 모습: 세대의 차대 시드 + 판(edId를 주면 그 판, 아니면 현재 판)의 얼굴 시드. 시대는 세대 출시 연도 */
  const genLook = (g: Generation, edId?: number): CarLook => {
    const e = g.editions.find((x) => x.id === edId) ?? currentEdition(g);
    return lookOf({ body: g.body, powertrain: g.powertrain, tier: e.tier, color: e.color, wheels: e.wheels, year: genYear(g), chassisSeed: g.chassisSeed, faceSeed: e.faceSeed });
  };
  /** 개발 중인 차의 모습. 페이스리프트는 그 세대의 시대를 따른다 */
  const projLook = (p: Project, color: string, wheels: 0 | 1 | 2 = 1): CarLook => {
    const g = p.kind === 'facelift' ? Q.generationById(game!.state, p.targetId ?? -1) : undefined;
    return lookOf({ body: p.body, powertrain: p.powertrain, tier: p.tier, color, wheels, year: g ? genYear(g) : yearOf(p.startWeek), chassisSeed: p.chassisSeed, faceSeed: p.faceSeed });
  };
  const editionName = (g: Generation) => `${g.number}세대${currentEdition(g).kind === 'facelift' ? ' · 페이스리프트' : ''}`;
  const busyReason = (): string | null => { const s = game!.state; return s.projects.length >= config.dev.teams ? '개발팀이 바쁩니다. 진행 중인 개발이 끝나야 합니다.' : null; };
  /** 조건 버튼: 안 되면 흐리게 + 이유 */
  const elig = (e: Q.Eligibility) => { const b = busyReason(); return b && e.ok ? { ok: false, reason: b } : { ok: e.ok, reason: e.reason }; };

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
    const ovh = ovTop(`차고 · ${ending ? '이번 달 말 단종' : '판매 중'}`, `${esc(name)}<small>${editionName(g)}</small>`, `${specLine(g.body, g.powertrain, e.tier, g.segment)} · ${paintName(e.color)}`)
      + ovScore('평론 평균', g.reviewAvg) + ovHint
      + (gens.length > 1 ? `<button class="switch l" data-act="gprev" aria-label="이전 차">‹</button><button class="switch r" data-act="gnext" aria-label="다음 차">›</button>` : '');
    const sales = g.sales.slice(-12), mx = Math.max(1, ...sales);
    const chart = sales.length ? `<svg class="mini" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="최근 월별 판매">${sales.map((v, i) => { const w = 300 / 12, h = (v / mx) * 56; return `<rect x="${(i * w + 2).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${i === sales.length - 1 ? '#ff5a1f' : '#14171c'}"/>`; }).join('')}</svg>` : '';
    const card1 = `<div class="card"><p class="lbl">이 차의 성적</p><div class="kpis">${kpi('지난달 판매', lastSale === null ? '—' : `${num(lastSale)}<span>대</span>`)}${kpi('누적 판매', `${num(g.totalSold)}<span>대</span>`)}${kpi('대당 이익', money(Q.generationUnitProfit(g), true), Q.generationUnitProfit(g) >= 0 ? 'pos' : 'neg')}${kpi('평론 평균', `${score(g.reviewAvg)}${g.masterpiece ? '<span>명차</span>' : ''}`)}</div>
      ${chart ? `<p class="lbl" style="margin-top:12px">최근 판매(달마다)</p>${chart}` : ''}
      <p class="lbl" style="margin-top:12px">수명</p><div class="life" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lb * 100)}" aria-label="수명"><u style="width:${(lb * 100).toFixed(1)}%"></u></div>
      <p class="hint">${Math.round(lb * 100)}% · 차는 나이를 먹을수록, 해가 갈수록 덜 팔립니다.</p>
      <div class="advice">${esc(Q.advice(g, s))}</div></div>`;
    const card2 = ending ? '' : `<div class="card"><p class="lbl">판매 가격</p><div class="pricerow"><b id="gp-out">${num(price)}<span>만원</span></b><span class="margin ${up >= 0 ? 'pos' : 'neg'}" id="gp-margin">대당 이익 ${money(up, true)}</span></div>
      <input type="range" id="gprice" data-gen="${g.id}" min="${Math.ceil(base * config.price.min)}" max="${Math.floor(base * config.price.max)}" step="10" value="${price}" aria-label="판매 가격(만원)">
      <div class="row"><button class="btn ink" data-act="setPrice" data-id="${g.id}" ${price === e.price ? 'disabled' : ''}>가격 바꾸기</button><span class="hint">지금 가격 ${num(e.price)}만원 · 다음 결산부터 반영</span></div>
      <hr><p class="lbl">마케팅(매달 광고비)</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="setMk" data-id="${g.id}" data-v="${i}" aria-pressed="${g.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div></div>`;
    const np = Q.nameplateOf(s, g.id)!, fl = elig(Q.faceliftEligibility(s, g.id)), fc = elig(Q.fullChangeEligibility(s, np.id));
    const card3 = `<div class="card next-step"><p class="lbl">이 차의 다음 단계</p><div class="row"><button class="btn" data-act="goLift" data-id="${g.id}" ${fl.ok ? '' : 'disabled'}>페이스리프트<small>(얼굴·옵션 손보기)</small></button><button class="btn" data-act="goFull" data-id="${np.id}" ${fc.ok ? '' : 'disabled'}>풀체인지<small>(다음 세대)</small></button></div>
      ${fl.ok ? '' : `<p class="note why" data-for="lift">페이스리프트: ${esc(fl.reason ?? '')}</p>`}${fc.ok ? '' : `<p class="note why" data-for="full">풀체인지: ${esc(fc.reason ?? '')}</p>`}
      <hr><button class="btn danger" data-act="discontinue" data-id="${g.id}" ${ending ? 'disabled' : ''} style="width:100%">${ending ? '이번 달 말에 단종됩니다' : '단종하기'}</button></div>`;
    const planCard = !p && s.projects.length < config.dev.teams ? `<div class="card"><p class="lbl">다음 차</p><p class="hint">판매하는 동안 다음 차를 미리 개발할 수 있습니다. 공장 생산 라인은 ${config.factory.lines}개라, 새 차를 내려면 지금 차를 단종해야 합니다.</p><button class="go dark" data-act="plan">신차 기획</button></div>` : '';
    return { ov: ovh, panel: card1 + card3 + card2 + devCard + planCard, look: genLook(g) };
  }

  // ----- 신차 기획 첫 화면(8.7) -----
  const EQ_WORD = (q: number) => (q < 0.03 ? '아직 없음' : q < 0.1 ? '조금' : q < 0.18 ? '보통' : '높음');
  const equityBar = (q: number) => `<div class="equity" title="이름값 ${Math.round(q * 100)}점"><span>이름값</span><div class="life"><u style="width:${Math.min(100, (q / 0.3) * 100).toFixed(1)}%"></u></div><b>${EQ_WORD(q)}</b></div>`;
  /** 갈래(풀체인지·페이스리프트) 카드의 가능 여부: 차종 하나라도 되면 가능, 아니면 가장 빨리 풀리는 차종의 이유 */
  function branchOk(list: Q.NameplateEntry[], k: 'fullChange' | 'facelift'): { ok: boolean; reason: string | null } {
    const busy = busyReason();
    if (busy) return { ok: false, reason: busy };
    if (list.some((e) => e[k].ok)) return { ok: true, reason: null };
    const e = [...list].sort((a, b) => (a[k].monthsLeft || 1e9) - (b[k].monthsLeft || 1e9))[0];
    return { ok: false, reason: e ? `「${e.name}」 ${e[k].reason}` : '아직 낸 차종이 없습니다.' };
  }
  function startView(): View {
    const s = game!.state, list = Q.planEntries(s).nameplates, fc = branchOk(list, 'fullChange'), fl = branchOk(list, 'facelift');
    const choice = (act: string, v: string, ok: boolean, head: string, sub: string, why: string | null) =>
      `<button class="choice" data-act="${act}" data-v="${v}" ${ok ? '' : 'disabled'} aria-pressed="${startSel === v}"><b>${head}</b><small>${sub}</small>${ok || !why ? '' : `<em class="why">${esc(why)}</em>`}</button>`;
    const card1 = `<div class="card"><p class="lbl">신차 기획</p><h2>어디서 시작할까요?</h2><div class="choices">
      ${choice('pickNew', 'new', true, '새 차종 만들기', '새 이름으로 1세대를 만듭니다.', null)}
      ${choice('startSel', 'full', fc.ok, '기존 차종의 다음 세대', '풀체인지: 이름과 이름값을 이어받아 차를 새로 만듭니다.', fc.reason)}
      ${choice('startSel', 'lift', fl.ok, '기존 차종 손보기', '페이스리프트: 판매 중인 차의 얼굴과 옵션을 바꿉니다.', fl.reason)}</div></div>`;
    const rows = list.map((e) => {
      const f = elig(e.fullChange), l = elig(e.facelift);
      return `<div class="np" data-np="${e.nameplateId}"><div class="nphead"><b>${esc(e.name)}</b><small>${e.generation}세대 · ${e.status === 'onSale' ? '판매 중' : e.status === 'ending' ? '이번 달 단종' : '단종'}</small></div>
        <p class="hint">최근 평론 <b>${score(e.reviewAvg)}</b> · 누적 판매 <b>${num(e.totalSold)}</b>대</p>${equityBar(e.equity)}
        <div class="row"><button class="btn ${startSel === 'full' ? 'ink' : ''}" data-act="goFull" data-id="${e.nameplateId}" ${f.ok ? '' : 'disabled'}>다음 세대 만들기</button><button class="btn ${startSel === 'lift' ? 'ink' : ''}" data-act="goLift" data-id="${e.generationId}" ${l.ok ? '' : 'disabled'}>손보기</button></div>
        ${f.ok ? '' : `<p class="note why">다음 세대: ${esc(f.reason ?? '')}</p>`}${l.ok ? '' : `<p class="note why">손보기: ${esc(l.reason ?? '')}</p>`}</div>`;
    }).join('');
    const card2 = `<div class="card" id="np-list"><p class="lbl">내 차종 ${list.length}개</p><div class="nps">${rows}</div><p class="note">이름값은 평론과 누적 판매로 쌓입니다. 다음 세대가 처음부터 더 잘 알려집니다.</p>
      <button class="btn" data-act="cancelPlan" style="width:100%;margin-top:8px">돌아가기</button></div>`;
    const sel = sellingGens(s)[0];
    return { ov: ovTop('신차 기획', '어디서 시작할까요?', '새 차종 · 다음 세대 · 손보기 중에서 고르세요'), panel: card1 + card2, look: sel ? genLook(sel) : null };
  }

  // ----- 신차 기획(새 차종·풀체인지) -----
  function newDraft(npId = 0): Draft {
    const s = game!.state, y = yearOf(s.week), n = npId ? s.nameplates.find((x) => x.id === npId) : undefined, prev = n?.generations.at(-1);
    const seeds = { nameplateId: npId, chassisSeed: Q.lookCandidates(s, npId, 'chassis')[0], faceSeed: Q.lookCandidates(s, npId, 'face', 'nextGen')[0] };
    if (n && prev) {
      const e = currentEdition(prev), opts = new Set(Q.optionsAt(y).map((o) => o.id));
      return { name: n.name, body: prev.body, segment: prev.segment, powertrain: prev.powertrain, tier: e.tier, options: e.options.filter((o) => opts.has(o)), direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 12, color: e.color, ...seeds };
    }
    return { name: '', body: Q.bodiesAt(y)[0].id, segment: 'worker', powertrain: Q.powertrainsAt(y)[0].id, tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 12, color: PAINT[0][1], ...seeds };
  }
  const defaultName = () => { const n = game!.state.nameplates.length, list = ['아리아', '노바', '솔라', '루나', '벨로', '오로라', '테라', '시리우스', '카덴', '에르타']; return list[n % list.length]; };
  const knownCompat = (body: string, seg: string) => allGens(game!.state).some((g) => g.body === body && g.segment === seg);
  const dirLeft = (d: Draft) => config.dev.dirTotal - STATS.reduce((a, k) => a + d.direction[k], 0);
  const COMPARE = { better: '전작보다 좋음', worse: '전작만 못함', same: '전작과 비슷함' } as const;
  function planView(): View {
    const s = game!.state, d = draft!, y = yearOf(s.week), full = d.nameplateId > 0;
    const n = full ? s.nameplates.find((x) => x.id === d.nameplateId) : undefined, prev = n?.generations.at(-1);
    const fcp = full ? Q.fullChangePreview(s, d.nameplateId, d) : null, est = fcp ?? Q.planPreview(s, d), name = full ? n!.name : d.name.trim() || defaultName();
    const lk = (o: Partial<Draft> = {}) => { const x = { ...d, ...o }; return lookOf({ body: x.body, powertrain: x.powertrain, tier: x.tier, color: x.color, wheels: 1, year: y, chassisSeed: x.chassisSeed, faceSeed: x.faceSeed }); };
    const look = lk(), tabs = planTabs(d);
    if (!tabs.some(([k]) => k === planTab)) planTab = tabs[0][0];
    const ovh = ovTop(full ? `풀체인지 기획 · ${(prev?.number ?? 0) + 1}세대` : '새 차 기획 · 설계 전', `<span id="pname-ov">${esc(name)}</span>${full ? `<small>${(prev?.number ?? 0) + 1}세대</small>` : ''}`, specLine(d.body, d.powertrain, d.tier, d.segment)) + ovScore('예상 등급', est.avg) + ovHint;
    const bodyWarn = fcp?.bodyChanged ? `<div class="warnbox body-warn" style="margin-top:10px">차체를 바꾸면 이름값이 절반만 이어집니다(${EQ_WORD(fcp.equityBase)} → ${EQ_WORD(fcp.equity)}). 개발비 할인도 없어집니다.</div>` : '';
    let body = '';
    if (planTab === 'prev' && prev) {
      const e = currentEdition(prev), sold = n!.generations.reduce((a, g) => a + g.totalSold, 0);
      body = `<div class="prevsum"><div class="ph">${thumb(genLook(prev), -0.65, 240, 150)}</div><div><b>${esc(n!.name)} ${prev.number}세대${e.kind === 'facelift' ? ' · 페이스리프트' : ''}</b><p class="hint">${Q.monthLabel(prev.launchMonth)} 출시 · ${bodyById(prev.body).name} · ${segName(prev.segment)}용</p></div></div>
        <div class="kpis" style="margin-top:10px">${kpi('평론 평균', score(prev.reviewAvg))}${kpi('누적 판매', `${num(sold)}<span>대</span>`)}${kpi('예상 재구매', `월 ${num(fcp?.rebuyPerMonth ?? 0)}<span>대</span>`)}</div>
        ${equityBar(fcp?.equityBase ?? 0)}
        <p class="lbl" style="margin-top:12px">이어받는 것</p><ul class="inherit"><li>차 이름 「${esc(n!.name)}」과 이름값(처음부터 더 잘 알려짐)</li><li>전 세대 고객의 재구매(첫 12개월, 매달 약 ${num(fcp?.rebuyPerMonth ?? 0)}대)</li><li>같은 차체면 개발비 ${Math.round(config.lifecycle.fullChange.sameBodyCost * 100)}%만 듭니다</li></ul>
        <div class="okbox" style="margin-top:10px">새 세대를 출시하면 ${prev.number}세대는 그 달 말에 단종됩니다(생산 라인을 이어 씁니다).</div>`;
    } else if (planTab === 'body') body = `<div class="opts">${Q.bodiesAt(y).map((b) => `<button class="opt" data-act="pick" data-k="body" data-v="${b.id}" aria-pressed="${d.body === b.id}">${silhouetteSvg(lk({ body: b.id }))}<b>${esc(b.name)}</b><small>기준 가격 ${money(b.basePrice)}</small><span class="cost">원가 ${money(b.cost)}</span></button>`).join('')}</div><p class="note">다른 차체는 해가 지나면 열립니다.</p>${bodyWarn}
      <p class="lbl" style="margin-top:14px">색상(출시 때 바꿀 수 있음)</p>${paints('pick', d.color)}`;
    else if (planTab === 'look') {
      const ch = Q.lookCandidates(s, d.nameplateId, 'chassis'), fa = Q.lookCandidates(s, d.nameplateId, 'face', 'nextGen');
      body = `<p class="lbl">옆모습(차대) 후보</p><div class="opts looks">${ch.map((v, i) => { const l = lk({ chassisSeed: v }); return `<button class="opt look" data-act="pick" data-k="chassisSeed" data-v="${v}" aria-pressed="${d.chassisSeed === v}">${thumb(l, 0)}<b>옆모습 ${i + 1}</b><small>${esc(describeLook(l).chassis)}</small></button>`; }).join('')}</div>
        <p class="lbl" style="margin-top:14px">얼굴(앞뒤 모습) 후보</p><div class="opts looks">${fa.map((v, i) => { const l = lk({ faceSeed: v }); return `<button class="opt look" data-act="pick" data-k="faceSeed" data-v="${v}" aria-pressed="${d.faceSeed === v}">${thumb(l, -1.05)}<b>얼굴 ${i + 1}</b><small>${esc(describeLook(l).face)}</small></button>`; }).join('')}</div>
        <p class="note">모양은 겉모습만 바꿉니다(능력치와 무관). 고른 모양은 무대의 차에 바로 보입니다.</p>`;
    } else if (planTab === 'seg') body = `<div class="opts">${SEGMENTS.map((g) => {
      const top = (Object.entries(g.w) as [Stat, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => STAT_NAME[k]).join('·');
      const cv = COMPAT[d.body]?.[g.id], tag = knownCompat(d.body, g.id) && cv !== undefined ? COMPAT_TEXT.find(([t]) => cv >= t)![1] : '';
      return `<button class="opt" data-act="pick" data-k="segment" data-v="${g.id}" aria-pressed="${d.segment === g.id}"><b>${esc(g.name)}</b><small>중시: ${top}</small><small>${g.eps >= 2 ? '값에 민감함' : '값보다 만족을 봄'}</small>${tag ? `<span class="tag">${tag}</span>` : ''}</button>`;
    }).join('')}</div><p class="note">차체와 고객층에는 궁합이 있습니다. 한 번 출시해 본 조합은 궁합이 표시됩니다.</p>`;
    else if (planTab === 'power') {
      const pts = Q.powertrainsAt(y), pt = powertrainById(d.powertrain);
      body = (pts.length > 1 ? `<div class="seg">${pts.map((x) => `<button data-act="pick" data-k="powertrain" data-v="${x.id}" aria-pressed="${d.powertrain === x.id}">${esc(x.name)}</button>`).join('')}</div>` : `<p class="hint" style="margin-bottom:10px">동력: <b>${esc(pt.name)}</b> (다른 동력은 해가 지나면 열립니다)</p>`)
        + `<div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="pick" data-k="tier" data-v="${i + 1}" aria-pressed="${d.tier === i + 1}"><b>${esc(t.name)}</b><small>${TIER_SUB[i] ?? ''}</small><span class="cost">${t.costAdd ? `원가 +${Math.round(t.costAdd * 100)}%` : '원가 기본'}</span></button>`).join('')}</div><p class="note">고급 동력을 고르면 차에 스포일러가 붙습니다.</p>`;
    } else if (planTab === 'opt') body = optTiles(d.options, y);
    else if (planTab === 'dir') {
      const left = dirLeft(d);
      body = `<p class="left">남은 점수 <b>${left}</b> / ${config.dev.dirTotal}점</p>${STATS.map((k) => `<div class="dir"><span>${STAT_NAME[k]}</span><button data-act="dir" data-k="${k}" data-v="-1" aria-label="${STAT_NAME[k]} 빼기" ${d.direction[k] <= 0 ? 'disabled' : ''}>−</button><div class="dots" aria-label="${STAT_NAME[k]} ${d.direction[k]}점">${Array.from({ length: config.dev.dirMax }, (_, i) => `<i class="${i < d.direction[k] ? 'on' : ''}"></i>`).join('')}</div><button data-act="dir" data-k="${k}" data-v="1" aria-label="${STAT_NAME[k]} 더하기" ${d.direction[k] >= config.dev.dirMax || left <= 0 ? 'disabled' : ''}>+</button></div>`).join('')}<p class="note">한 능력치에 0~${config.dev.dirMax}점. 2점이 보통이고, 많이 줄수록 그 능력치가 더 자랍니다. 10점을 모두 나눠야 시작할 수 있습니다.</p>`;
    } else body = `<p class="lbl">예산</p><div class="opts">${(Object.keys(BUDGET) as Budget[]).map((b) => `<button class="opt" data-act="pick" data-k="budget" data-v="${b}" aria-pressed="${d.budget === b}"><b>${BUDGET[b].name}</b><small>${BUDGET[b].sub}</small></button>`).join('')}</div>
      <p class="lbl" style="margin-top:14px">설계 기간</p><div class="opts">${config.dev.designWeeks.map((w, i) => `<button class="opt" data-act="pick" data-k="designWeeks" data-v="${w}" aria-pressed="${d.designWeeks === w}"><b>${w}주</b><small>${['빠르지만 점수가 적음', '보통', '오래 걸리지만 점수가 많음'][i] ?? ''}</small></button>`).join('')}</div>${bodyWarn}`;
    const ti = tabs.findIndex(([k]) => k === planTab), last = ti === tabs.length - 1, left = dirLeft(d), dirNo = tabs.findIndex(([k]) => k === 'dir') + 1;
    const nameBox = full ? `<p class="lbl">차 이름(이어받음)</p><p class="namefix">${esc(name)} <small>${(prev?.number ?? 0) + 1}세대</small></p>`
      : `<p class="lbl">차 이름</p><input class="namein" id="pname" type="text" maxlength="12" value="${esc(d.name)}" placeholder="${esc(defaultName())}" aria-label="차 이름">`;
    const card1 = `<div class="card">${nameBox}
      <div class="seg steps" role="tablist" style="margin-top:12px">${tabs.map(([k, l], i) => `<button role="tab" data-act="ptab" data-v="${k}" aria-selected="${planTab === k}">${i + 1}<small>${l}</small></button>`).join('')}</div>
      <h3>${tabs[ti][1]}</h3>${body}
      ${last && left ? `<div class="warnbox" style="margin-top:12px">개발 방향 점수가 ${left}점 남았습니다(${dirNo}번 단계).</div>` : ''}
      ${fcp && !fcp.eligibility.ok ? `<div class="badbox" style="margin-top:12px">${esc(fcp.eligibility.reason ?? '')}</div>` : ''}
      <div class="row" style="margin-top:12px">${ti > 0 ? `<button class="btn" data-act="ptab" data-v="${tabs[ti - 1][0]}">← 이전</button>` : ''}${last ? '<button class="go" data-act="startDev">개발 시작 <span aria-hidden="true">→</span></button>' : `<button class="btn" data-act="ptab" data-v="${tabs[ti + 1][0]}">다음 →</button>`}</div></div>`;
    const fcKpis = fcp ? `${kpi('전작 대비', COMPARE[fcp.compare], fcp.compare === 'worse' ? 'neg' : fcp.compare === 'better' ? 'pos' : '')}${kpi('이어받는 이름값', EQ_WORD(fcp.equity))}${kpi('예상 재구매', `월 ${num(fcp.rebuyPerMonth)}<span>대</span>`)}${kpi('개발비 할인', fcp.costMult < 1 ? `${Math.round((1 - fcp.costMult) * 100)}<span>%</span>` : '없음')}` : '';
    const card2 = `<div class="card plan-est"><p class="lbl">예상(대략)</p>${statBars(est.grades)}
      <div class="kpis" style="margin-top:10px;grid-template-columns:repeat(2,1fr)">${kpi('예상 등급', `${score(est.min)}~${score(est.max)}`)}${kpi('예상 개발비', money(est.cost))}${fcKpis}${kpi('대당 원가', money(Q.unitCost(d.body, d.powertrain, d.tier, d.options)))}${kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}</div>
      ${fcp ? `<p class="hint" style="margin-top:8px">전 세대 출시 때 등급 ${score(fcp.prevAvg)} → 이번 예상 ${score(fcp.avg)}. ${fcp.compare === 'worse' ? '전작보다 못하면 평론가 모두 점수를 깎고 "전작만 못하다" 기사가 납니다.' : fcp.compare === 'better' ? '전작보다 좋으면 평론가 점수가 조금 오르고 "진화했다" 기사가 납니다.' : ''}${fcp.revival ? ' 오래 쉰 이름이라 "부활"로 이름값이 절반만 이어집니다.' : ''}</p>` : ''}
      <p class="note">등급은 그해 다른 차와 비교한 점수(0~10, 5가 보통)입니다. 낮은 쪽은 직원 컨디션이 나쁘고 최소 시험만 한 경우, 높은 쪽은 컨디션이 좋고 결함을 다 없앤 경우입니다. 개발비는 설계와 최소 시험 ${config.dev.minTestWeeks}주 기준이며, 시험을 길게 하면 더 듭니다.</p>
      <button class="btn" data-act="cancelPlan" style="width:100%;margin-top:8px">기획 그만두기</button></div>`;
    return { ov: ovh, panel: card1 + card2, look };
  }
  /** 옵션 고르기 타일(기획·페이스리프트 공용). act: 누르면 부를 조작 이름 */
  function optTiles(chosen: string[], y: number, act = 'opt'): string {
    const max = config.dev.maxOptions;
    return `<p class="left">옵션 <b>${chosen.length}</b> / ${max}개</p><div class="opts">${Q.optionsAt(y).map((o) => { const on = chosen.includes(o.id); return `<button class="opt" data-act="${act}" data-v="${o.id}" aria-pressed="${on}" ${!on && chosen.length >= max ? 'disabled' : ''}><b>${esc(o.name)}</b><small>${(['U', 'D', 'Q'] as const).filter((k) => o[k]).map((k) => `${STAT_NAME[k]} +${o[k]}`).join(' · ')}</small><span class="cost">대당 +${num(o.cost)}만원</span></button>`; }).join('')}</div><p class="note">옵션은 안 골라도 됩니다. 새 옵션은 해가 지나면 열립니다.</p>`;
  }

  // ----- 페이스리프트 기획(8.2) -----
  function liftView(): View {
    const s = game!.state, L = lift!, g = Q.generationById(s, L.genId)!, e = currentEdition(g), np = Q.nameplateOf(s, g.id)!, y = yearOf(s.week);
    const pv = Q.faceliftPreview(s, g.id, { options: L.options, tier: L.tier })!, cur = genLook(g), cands = Q.lookCandidates(s, np.id, 'face', 'facelift');
    const front = -Math.PI / 2, dBefore = Q.grades(e.stats, yearOf(s.week + pv.designWeeks + pv.minTestWeeks)).D, pt = powertrainById(g.powertrain), ok = elig(pv.eligibility);
    const ovh = ovTop('페이스리프트 기획 · 지금 모습', `${esc(np.name)}<small>${editionName(g)}</small>`, specLine(g.body, g.powertrain, e.tier, g.segment)) + ovHint;
    const card1 = `<div class="card"><p class="lbl">1. 새 얼굴 고르기</p><div class="faces"><div class="face now">${thumb(cur, front, 200, 140)}<b>지금 얼굴</b><small>${esc(describeLook(cur).face)}</small></div>
      ${cands.map((v, i) => { const l = { ...cur, faceSeed: v }; return `<button class="opt face" data-act="liftPick" data-k="faceSeed" data-v="${v}" aria-pressed="${L.faceSeed === v}">${thumb(l, front, 200, 140)}<b>새 얼굴 ${i + 1}</b><small>${esc(describeLook(l).face)}</small></button>`; }).join('')}</div>
      <p class="note">뼈대(옆모습·차체 크기)는 그대로이고 앞뒤 모습만 바뀝니다.</p></div>`;
    const card2 = `<div class="card"><p class="lbl">2. 옵션 갱신</p>${optTiles(L.options, y, 'liftOpt')}
      <p class="lbl" style="margin-top:14px">3. 동력 단계(${esc(pt.name)})</p><div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="liftPick" data-k="tier" data-v="${i + 1}" aria-pressed="${L.tier === i + 1}" ${i + 1 < e.tier ? 'disabled' : ''}><b>${esc(t.name)}</b><small>${i + 1 < e.tier ? '낮출 수 없음' : i + 1 === e.tier ? '지금 단계' : '한 단계 올리기'}</small></button>`).join('')}</div>
      <p class="note">동력 종류와 차체는 바꿀 수 없습니다. 바꾸려면 풀체인지를 하세요.</p></div>`;
    const bar = (label: string, a: number, b: number) => `<p class="lbl" style="margin-top:12px">${label}</p><div class="ba"><span>지금</span><div class="life"><u style="width:${(a * 100).toFixed(1)}%"></u></div><b>${Math.round(a * 100)}%</b></div><div class="ba"><span>손본 뒤</span><div class="life"><u style="width:${(b * 100).toFixed(1)}%"></u></div><b>${Math.round(b * 100)}%</b></div>`;
    const card3 = `<div class="card lift-est"><p class="lbl">4. 예상</p><div class="kpis">${kpi('비용', money(pv.cost))}${kpi('기간', `${pv.designWeeks + pv.minTestWeeks}<span>주~</span>`)}${kpi('디자인', `${score(dBefore)}→${score(pv.grades.D)}`)}${kpi('평균 등급', `${score(pv.avgBefore)}→${score(pv.avg)}`)}</div>
      <p class="hint" style="margin-top:6px">설계 ${pv.designWeeks}주 + 시험 ${pv.minTestWeeks}주 이상. 디자이너만 일하고 점수는 디자인에만 쌓입니다. 남은 결함은 절반으로 줄어 시작합니다.</p>
      ${bar('수명(판매 힘)', pv.lifeBefore, pv.lifeAfter)}${bar('인지도', pv.awarenessBefore, pv.awarenessAfter)}
      <p class="note">평론가는 다시 평가하지 않고 신문에 기사가 한 줄 납니다. 바꾸는 달은 생산이 30% 줄어듭니다.</p>
      ${ok.ok ? '' : `<div class="badbox" style="margin-top:10px">${esc(ok.reason ?? '')}</div>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="cancelPlan">그만두기</button><button class="go" data-act="startLift" ${ok.ok ? '' : 'disabled'}>손보기 시작 <span aria-hidden="true">→</span></button></div></div>`;
    return { ov: ovh, panel: card1 + card2 + card3, look: cur };
  }

  // ----- 개발 진행(사무실) -----
  const kindLabel = (p: Project) => p.kind === 'facelift' ? '페이스리프트 중' : p.kind === 'fullchange' ? `풀체인지 중 · ${(prevOf(p)?.number ?? 0) + 1}세대` : '개발 중';
  /** 개발 중 표시 등급. shortcut: 페이스리프트는 sim의 projectPreview가 디자인 점수만 보고 계산해 등급이 0에 가깝게 나오므로, 지금 판매 중인 판의 등급을 보여 준다(sim에 페이스리프트용 미리보기가 생기면 바꿀 것) */
  function devGrades(p: Project): { grades: Stats; avg: number } | null {
    const s = game!.state, g = p.kind === 'facelift' ? Q.generationById(s, p.targetId ?? -1) : undefined;
    return g ? { grades: Q.generationGrades(s, g), avg: Q.avgGrade(currentEdition(g).stats, yearOf(s.week)) } : Q.projectPreview(s, p.id);
  }
  function devView(): View {
    const s = game!.state, p = s.projects[0];
    if (!p) {
      const canPlan = s.projects.length < config.dev.teams;
      return { ov: `<div class="ov ofc"><div class="ofc-t"><div class="eyebrow"><i></i>개발팀 · 쉬는 중</div><b>진행 중인 개발이 없습니다</b><span class="ofc-s">새 차를 기획하면 직원들이 설계를 시작합니다.</span></div>${canPlan ? '<button class="go" data-act="plan">신차 기획</button>' : ''}</div>`,
        panel: `<div class="card"><p class="lbl">개발</p><h2>개발팀이 쉬고 있습니다</h2><p class="hint" style="margin-top:8px">직원 ${s.staff.length}명이 모두 한 차에 매달립니다. 개발팀은 1개라 한 번에 한 차만 개발할 수 있습니다.</p>${canPlan ? '<button class="go" data-act="plan">신차 기획 시작</button>' : ''}</div>`, office: officeView() };
    }
    const pv = devGrades(p)!, minT = config.dev.minTestWeeks, ready = p.phase === 'test' && p.testWeeks >= minT, adv = Q.defectAdvice(p);
    const phase = p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`;
    const ovh = `<div class="ov ofc"><div class="ofc-t"><div class="eyebrow"><i></i>${kindLabel(p)} · ${phase}</div><b>${esc(p.name)}</b><span class="ofc-s">${STATS.map((k) => `${STAT_NAME[k]} ${score(pv.grades[k])}`).join(' · ')} · 결함 약 ${num(p.defectEst)}개</span></div><div class="ofc-g"><small>지금 등급</small><b>${score(pv.avg)}</b></div></div>`;
    const pct = p.phase === 'design' ? (p.weeksDone / p.designWeeks) * 100 : 100;
    const log = devLog.get(p.id) ?? [];
    const card1 = `<div class="card"><p class="lbl">${kindLabel(p)} · ${p.phase === 'design' ? '설계 단계' : '시험 단계'}</p><h2>${esc(p.name)}<small>${phase}</small></h2>
      <div class="prog ${p.phase === 'test' ? 'test' : ''}"><u style="width:${pct.toFixed(1)}%"></u></div>
      <p class="hint">${p.phase === 'design' ? (p.kind === 'facelift' ? '디자이너가 새 얼굴을 그리고 있습니다. 점수는 디자인에만 쌓입니다.' : '직원들이 매주 능력치를 쌓고 있습니다. 결함도 함께 생깁니다.') : '시험할수록 결함이 줄어 리콜 위험이 낮아집니다. 대신 개발비가 계속 듭니다. 출시 시점은 직접 정합니다.'}</p>
      <hr><p class="lbl">${p.kind === 'facelift' ? '지금 판매 중인 판의 능력치(출시하면 디자인이 오릅니다)' : '지금 능력치(등급)'}</p>${statBars(pv.grades)}
      <div class="kpis" style="margin-top:10px">${kpi('남은 결함', `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('지금까지 쓴 개발비', money(p.spent))}</div>
      ${p.phase === 'test' ? defectBox(adv) : ''}
      <button class="go" data-act="toLaunch" ${ready ? '' : 'disabled'}>${ready ? '출시 준비 →' : p.phase === 'design' ? '설계가 끝나면 시험을 시작합니다' : `시험 ${minT}주 뒤 출시할 수 있습니다`}</button>
      <button class="btn danger" data-act="cancelDev" style="width:100%;margin-top:8px">개발 취소</button></div>`;
    const card2 = `<div class="card"><p class="lbl">주간 기록</p>${log.length ? `<ul class="log">${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">한 주가 지나면 기록이 쌓입니다. 위쪽에서 빠르기를 고르세요.</p>'}</div>`;
    return { ov: ovh, panel: card1 + card2, office: officeView(p) };
  }

  /** 결함 안내 한 줄(시험 단계·출시 화면) */
  const defectBox = (a: ReturnType<typeof Q.defectAdvice>) => `<div class="${a.level === 'many' ? 'badbox' : a.level === 'some' ? 'warnbox' : 'okbox'} defect-adv" data-level="${a.level}" style="margin-top:10px">${esc(a.text)}</div>`;

  // ----- 출시 -----
  /** 새 생산 라인 없이 이어서 낼 수 있는가(페이스리프트, 판매 중인 전 세대가 있는 풀체인지) */
  const prevOf = (p: Project) => p.kind === 'fullchange' ? game!.state.nameplates.find((n) => n.id === p.targetId)?.generations.at(-1) : undefined;
  function launchView(): View {
    const s = game!.state, L = launch!, p = Q.projectById(s, L.pid)!, base = bodyById(p.body).basePrice, fl = p.kind === 'facelift', prev = prevOf(p);
    const inherits = fl || (!!prev && prev.status !== 'discontinued');
    const up = Q.unitProfit(p.body, p.powertrain, p.tier, p.options, L.price), ex = fl ? null : Q.expectedReviews(s, p.id, L.price), fc = fl ? null : Q.salesForecast(s, p.id, L.price, L.marketing), free = inherits || Q.hasFreeLine(s);
    const look = projLook(p, L.color, L.wheels);
    const ovh = ovTop(fl ? '페이스리프트 출시 준비' : p.kind === 'fullchange' ? '풀체인지 출시 준비' : '출시 준비', esc(p.name) + (fl ? '<small>페이스리프트</small>' : ''), `${specLine(p.body, p.powertrain, p.tier, p.segment)} · ${paintName(L.color)} · ${WHEELS[L.wheels].name}`) + (ex ? ovScore('예상 평점', ex.avg) : '') + ovHint;
    const adv = Q.defectAdvice(p);
    const card0 = `<div class="card"><p class="lbl">남은 결함</p><div class="kpis">${kpi('남은 결함', `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('예상 리콜 위험', `연 ${Math.round(adv.recallYear * 100)}<span>%</span>`, adv.level === 'many' ? 'neg' : '')}</div>${defectBox(adv)}</div>`;
    const card1 = `<div class="card"><p class="lbl">판매 가격${fl ? '(다시 정하기)' : ''}</p><div class="pricerow"><b id="lp-out">${num(L.price)}<span>만원</span></b><span class="margin ${up >= 0 ? 'pos' : 'neg'}">대당 이익 ${money(up, true)}</span></div>
      <input type="range" id="lprice" min="${Math.ceil(base * config.price.min)}" max="${Math.floor(base * config.price.max)}" step="10" value="${L.price}" aria-label="판매 가격(만원)">
      <p class="hint">기준 가격 ${money(base)}. 싸게 팔면 많이 팔리지만 대당 이익이 줄어듭니다.</p>
      ${fl ? '' : `<hr><p class="lbl">마케팅(매달 광고비)</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="lset" data-k="marketing" data-v="${i}" aria-pressed="${L.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div>`}</div>`;
    const card2 = `<div class="card"><p class="lbl">색상${fl ? '(그대로 두거나 바꾸기)' : ''}</p>${paints('lset', L.color)}
      <p class="lbl" style="margin-top:14px">휠</p><div class="opts">${WHEELS.map((w, i) => `<button class="opt" data-act="lset" data-k="wheels" data-v="${i}" aria-pressed="${L.wheels === i}" style="min-height:0"><svg viewBox="0 0 80 42" aria-hidden="true"><circle cx="40" cy="21" r="${13 + i * 3}" fill="none" stroke="currentColor" stroke-width="${5 - i}"/><circle cx="40" cy="21" r="2.5" fill="currentColor"/></svg><b>${w.name}</b><small>${w.sub} · 겉모습만</small></button>`).join('')}</div></div>`;
    const critics = config.critics.list;
    const card3 = ex ? `<div class="card"><p class="lbl">예상(난수 없이 계산)</p>
      ${critics.map((c, i) => `<div class="stat"><span>${c.name}</span><div class="track"><u style="width:${ex.scores[i] * 10}%"></u></div><b>${score(ex.scores[i])}</b></div>`).join('')}
      <div class="kpis" style="margin-top:10px">${kpi('예상 평점', score(ex.avg))}${kpi('예상 월 판매', fc ? `${num(fc.min)}~${num(fc.max)}<span>대</span>` : '—')}</div>
      ${fc ? `<p class="hint sales-fc" style="margin-top:8px">한 달에 약 <b>${num(fc.min)}~${num(fc.max)}대</b> 팔릴 것으로 보입니다(공장 한도 ${num(config.factory.capacity)}대).</p>` : ''}
      <p class="note">적은 쪽은 출시 직후(아직 덜 알려짐), 많은 쪽은 몇 달 뒤 알려지고 나서입니다. 실제 평론은 ±0.7 정도 달라집니다.${prev ? ' 풀체인지는 전작과 비교해 평론이 조금 오르내립니다.' : ''}</p></div>` : '';
    const sum = fl ? `새 얼굴로 바꿔 내놓습니다: <b>${num(L.price)}만원</b>(대당 이익 ${money(up, true)}) · 결함 약 ${num(p.defectEst)}개. 평론가는 다시 평가하지 않고 신문에 기사가 납니다.`
      : `이 조건으로 출시합니다: <b>${num(L.price)}만원</b>(대당 이익 ${money(up, true)}) · 광고 ${MARKETING[L.marketing]} · 예상 평점 ${ex ? score(ex.avg) : '—'} · 월 ${fc ? `${num(fc.min)}~${num(fc.max)}대` : '—'} · 결함 약 ${num(p.defectEst)}개`;
    const card4 = `<div class="card launch-go"><p class="lbl">출시 요약</p><p class="hint launch-sum">${sum}</p>
      ${prev && prev.status === 'onSale' ? `<div class="warnbox prev-end" style="margin-top:10px">출시하면 ${prev.number}세대는 이번 달 말에 단종됩니다(재고 처분 1개월).</div>` : ''}
      ${free ? '' : `<div class="badbox" style="margin-top:10px">생산 라인이 모두 차 있습니다(공장 라인 ${config.factory.lines}개). 차고에서 판매 중인 차를 단종하면 그달 말부터 라인이 빕니다.</div><button class="btn" data-act="tab" data-v="garage" style="width:100%;margin-top:8px">차고로 가서 단종하기</button>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="tab" data-v="dev">← 개발 화면으로</button><button class="go" data-act="doLaunch" ${free ? '' : 'disabled'}>출시하기 <span aria-hidden="true">→</span></button></div></div>`;
    return { ov: ovh, panel: card0 + card1 + card2 + card3 + card4, look };
  }

  // ----- 리뷰 -----
  function showReview(g: Generation): void {
    const s = game!.state, name = nameOf(g), list = config.critics.list, avg = g.reviewAvg, c = config.critics;
    const best = g.reviews.indexOf(Math.max(...g.reviews)), worst = g.reviews.indexOf(Math.min(...g.reviews));
    const head = g.editions[0].headline ?? (avg >= c.masterpiece ? `「${name}」 명차 탄생, 평론가들 극찬` : avg >= 6 ? `「${name}」 순조로운 데뷔` : avg > c.flop ? `「${name}」 무난하지만 아쉬움 남겨` : `「${name}」 혹평 쏟아져, "다시 만들어라"`);
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

  /** 신문 한 장(페이스리프트 출시 기사, 소식 알림) */
  function showNews(head: string, body = '', month = monthOf(game!.state.week)): void {
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>신문 · ${esc(Q.monthLabel(month))}</div><div class="news paper"><div class="mast"><span>모터 데일리</span><span>${esc(Q.monthLabel(month))}</span></div><h3>${esc(head)}</h3>${body ? `<p>${esc(body)}</p>` : ''}</div>
      <button class="go dark" data-act="closeReview">닫기</button>`;
    sheet.hidden = false; renderTop();
    sheetBody.querySelector<HTMLElement>('[data-act="closeReview"]')?.focus();
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
    const s = game!.state, gens = allGens(s);
    if (!gens.length) return '<div class="card"><h3>기록</h3><p class="hint">아직 낸 차가 없습니다. 차를 출시하면 그 순간의 사진과 평론, 판매 기록이 여기 남습니다.</p></div>';
    const total = gens.reduce((a, g) => a + g.totalSold, 0);
    const nps = [...s.nameplates].filter((n) => n.generations.length).sort((a, b) => a.id - b.id);
    const genCard = (l: ReturnType<typeof Q.lineage>[number]) => {
      const g = Q.generationById(s, l.generationId)!, ph = ui.photos[g.id], lift = g.editions.find((e) => e.kind === 'facelift'), lph = lift ? ui.photos[`e${lift.id}`] : undefined;
      return `<article class="rec" data-gen="${g.id}"><div class="ph">${ph ? `<img src="${ph}" alt="${esc(nameOf(g))} ${g.number}세대 출시 사진">` : thumb(genLook(g, g.editions[0].id), -0.65, 320, 200)}
        ${lift ? `<div class="lift-ph" title="페이스리프트 뒤 모습">${lph ? `<img src="${lph}" alt="페이스리프트 뒤 사진">` : thumb(genLook(g, lift.id), -0.65, 160, 100)}<span>바뀐 얼굴</span></div>` : ''}</div>
        <div class="bd"><h3>${l.number}세대 <small class="hint">${bodyById(g.body).name}</small></h3>
        <div class="meta">${Q.monthLabel(l.launchMonth)} 출시 · 평론 ${score(l.reviewAvg)} · 누적 ${num(l.totalSold)}대${lift ? `<br>페이스리프트 ${Q.monthLabel(monthOf(lift.launchWeek))}` : ''}</div>
        <div class="row">${g.masterpiece ? '<span class="chip gold">명차</span>' : ''}<span class="chip ${l.status === 'onSale' ? 'on' : ''}">${esc(l.label)}</span>${lift ? '<span class="chip">페이스리프트</span>' : ''}${g.recalls ? `<span class="chip bad">리콜 ${g.recalls}번</span>` : ''}</div></div></article>`;
    };
    return `<div class="card"><h3>지금까지 낸 차 ${gens.length}대</h3><div class="kpis">${kpi('누적 판매', `${num(total)}<span>대</span>`)}${kpi('차종', `${nps.length}<span>개</span>`)}${kpi('명차', `${gens.filter((g) => g.masterpiece).length}<span>대</span>`)}${kpi('평판', String(Math.round(s.reputation)))}</div></div>
      ${nps.map((n) => `<div class="card lineage-card" data-np="${n.id}"><p class="lbl">차종 계보</p><h3>${esc(n.name)} <small class="hint">${n.generations.length}세대 · 누적 ${num(n.generations.reduce((a, g) => a + g.totalSold, 0))}대 · 이름값 ${EQ_WORD(Q.nameplateEquity(s, n.id))}</small></h3>
        <div class="lineage">${Q.lineage(s, n.id).map(genCard).join('<span class="arrow" aria-hidden="true">→</span>')}</div></div>`).join('')}`;
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
    game = g; ui = extra; screen = 'garage'; draft = null; launch = null; lift = null; garageIdx = 0; gameOverShown = false; officeEvents.length = 0; thumbs.clear();
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
      case 'tab': screen = v as Screen; if (v === 'dev' && launch) launch = null; lift = null; go(screen); return;
      case 'plan': // 8.7: 차종이 있으면 먼저 어디서 시작할지 고른다
        if (!s) return; if (s.projects.length >= config.dev.teams) return err('개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.');
        if (Q.planEntries(s).nameplates.length) { startSel = null; go('start'); return; }
        draft = newDraft(); planTab = 'body'; go('plan'); return;
      case 'pickNew': draft = newDraft(); planTab = 'body'; go('plan'); return;
      case 'startSel': startSel = v as 'full' | 'lift'; render(); document.getElementById('np-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return;
      case 'goFull': {
        if (!s) return; const id = Number(el.dataset.id), e = elig(Q.fullChangeEligibility(s, id));
        if (!e.ok) return err(e.reason ?? '');
        draft = newDraft(id); planTab = 'prev'; go('plan'); return;
      }
      case 'goLift': {
        if (!s) return; const id = Number(el.dataset.id), e = elig(Q.faceliftEligibility(s, id)), g = Q.generationById(s, id);
        if (!e.ok || !g) return err(e.reason ?? '');
        const ed = currentEdition(g), np = Q.nameplateOf(s, id)!, opts = new Set(Q.optionsAt(yearOf(s.week)).map((o) => o.id));
        lift = { genId: id, faceSeed: Q.lookCandidates(s, np.id, 'face', 'facelift')[0], options: ed.options.filter((o) => opts.has(o)), tier: ed.tier };
        go('lift'); return;
      }
      case 'liftPick': if (lift) { (lift as unknown as Record<string, number>)[el.dataset.k!] = Number(v); render(); } return;
      case 'liftOpt': if (lift) { lift.options = lift.options.includes(v) ? lift.options.filter((x) => x !== v) : [...lift.options, v].slice(0, config.dev.maxOptions); render(); } return;
      case 'startLift': {
        if (!game || !lift) return; const L = lift, g = Q.generationById(game.state, L.genId);
        if (!g || !run(game.command({ type: 'startFacelift', generationId: L.genId, options: L.options, tier: L.tier, faceSeed: L.faceSeed }))) return;
        const p = game.state.projects[game.state.projects.length - 1];
        ui.colors[p.id] = currentEdition(g).color; devPrev.set(p.id, 0); lift = null;
        toast(`「${p.name}」 페이스리프트를 시작했습니다. 디자이너가 새 얼굴을 그립니다.`); go('dev'); return;
      }
      case 'ptab': planTab = v as PlanTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'pick': {
        if (!draft) return; const k = el.dataset.k as keyof Draft;
        (draft as unknown as Record<string, unknown>)[k] = k === 'tier' || k === 'designWeeks' || k === 'chassisSeed' || k === 'faceSeed' ? Number(v) : v;
        if (k === 'powertrain') draft.tier = Math.min(draft.tier, powertrainById(v).tiers.length);
        render(); return;
      }
      case 'opt': if (!draft) return; draft.options = draft.options.includes(v) ? draft.options.filter((x) => x !== v) : [...draft.options, v].slice(0, config.dev.maxOptions); render(); return;
      case 'dir': { if (!draft) return; const k = el.dataset.k as Stat, n = draft.direction[k] + Number(v); if (n < 0 || n > config.dev.dirMax || (Number(v) > 0 && dirLeft(draft) <= 0)) return; draft.direction[k] = n; render(); return; }
      case 'cancelPlan': draft = null; lift = null; go('garage'); return;
      case 'startDev': {
        if (!game || !draft) return;
        // 점수가 남았으면 문제 단계(개발 방향)로 데려가서 이유를 보여 준다
        if (dirLeft(draft) > 0) { planTab = 'dir'; lastPanel = ''; render(); panel.scrollTop = 0; return err(`개발 방향 점수가 ${dirLeft(draft)}점 남았습니다. ${config.dev.dirTotal}점을 모두 나눠 주세요.`); }
        const { color, nameplateId, ...spec } = draft;
        const r = nameplateId ? game.command({ type: 'startFullChange', nameplateId, body: spec.body, segment: spec.segment, powertrain: spec.powertrain, tier: spec.tier, options: spec.options, direction: spec.direction, budget: spec.budget, designWeeks: spec.designWeeks, chassisSeed: spec.chassisSeed, faceSeed: spec.faceSeed })
          : game.command({ type: 'startProject', ...spec, name: spec.name.trim() || defaultName() });
        if (!run(r)) return;
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
        const g = p.kind === 'facelift' ? Q.generationById(s!, p.targetId ?? -1) : undefined, e = g && currentEdition(g); // 페이스리프트: 지금 가격·색·휠·광고에서 시작
        launch = e ? { pid: p.id, price: e.price, marketing: g!.marketing, color: e.color, wheels: e.wheels } : { pid: p.id, price: bodyById(p.body).basePrice, marketing: 1, color: ui.colors[p.id] ?? PAINT[0][1], wheels: 1 };
        go('launch'); return;
      }
      case 'lset': if (!launch) return; (launch as unknown as Record<string, unknown>)[el.dataset.k!] = el.dataset.k === 'color' ? v : Number(v); render(); return;
      case 'doLaunch': {
        if (!game || !launch) return;
        const L = launch, p = Q.projectById(game.state, L.pid), adv = p && Q.defectAdvice(p);
        if (adv?.level === 'many' && !(await ask(`남은 결함이 약 ${p!.defectEst}개로 아직 많습니다.\n지금 출시하면 평론가 4명이 모두 ${config.critics.manyDefectsPenalty}점씩 깎고, 리콜 위험이 연 ${Math.round(adv.recallYear * 100)}%입니다. 몇 주 더 시험하면 결함이 줄어듭니다.`, '그래도 출시', true, '시험 더 하기'))) { launch = null; go('dev'); return; }
        if (launch !== L) return;
        const before = new Set(allGens(game.state).map((g) => g.id)), proj = p!;
        stage?.setColor(L.color);
        const r: CommandResult = game.command({ type: 'launch', projectId: L.pid, price: L.price, marketing: L.marketing, color: L.color, wheels: L.wheels });
        if (!run(r)) return;
        const lifted = proj.kind === 'facelift' ? Q.generationById(game.state, proj.targetId ?? -1) : undefined;
        const g = lifted ?? allGens(game.state).find((x) => !before.has(x.id)), ed = lifted ? currentEdition(lifted) : undefined;
        if (ed) snapPhoto(`e${ed.id}`); else if (g) snapPhoto(g.id);
        if (g) { const c = config.critics; officeEvents.push({ kind: 'say', mood: lifted ? 'launch' : g.reviewAvg >= c.masterpiece ? 'masterpiece' : g.reviewAvg <= c.flop ? 'badReview' : 'launch' }); }
        devLog.delete(L.pid); delete ui.colors[L.pid]; launch = null; screen = 'garage'; garageIdx = g ? Math.max(0, sellingGens(game.state).findIndex((x) => x.id === g.id)) : 0; lastPanel = '';
        render();
        const news = r.ok ? r.events?.find((e) => e.kind === 'news') : undefined;
        if (lifted && ed) showNews(ed.headline ?? news?.text ?? '', `${nameOf(lifted)}이(가) 새 얼굴로 돌아왔다. 판매 힘이 되살아나고 더 많은 사람이 이 차를 알게 될 것으로 보인다.`);
        else if (g) showReview(g);
        return;
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
  for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.addEventListener('click', () => { if (!game) return; if (screen === 'plan' && b.dataset.tab !== 'dev') draft = null; launch = null; lift = null; go(b.dataset.tab as Screen); });
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
    setSpeed, render, held: isHeld, toast,
    get office() { return { on: officeOn, view: officeLast, scores: officeScores }; },
  };

  makeStage();
  void showTitle();
}
