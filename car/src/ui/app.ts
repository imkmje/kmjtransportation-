// 카 컴퍼니 화면(바닐라 TS + DOM, 에어 게임 방식). sim 상태는 읽기만 하고 바꿀 때는 game.command(...)만 쓴다.
import { config } from '../config';
import { BODIES, ERA_EVENTS, OPTIONS, POWERTRAINS, RANDOM_EVENTS, RIVALS, SEGMENTS, TECHS, bodyById, optionById, powertrainById } from '../data';
import { Game, allGens, sellingGens } from '../sim/game';
import * as Q from '../sim/queries';
import { currentEdition } from '../sim/market';
import { monthOf, yearOf } from '../sim/time';
import { STATS, type Budget, type CommandResult, type DevWeekEvent, type GameEvent, type Generation, type Project, type ProjectSpec, type Role, type Stat, type Stats } from '../sim/types';
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
type Draft = ProjectSpec & { color: string; nameplateId: number; chassisSeed: number; faceSeed: number; team: number[] };
/** 페이스리프트 기획 */
interface LiftSet { genId: number; faceSeed: number; options: string[]; tier: number; team: number[] }
type RecTab = 'cars' | 'combo' | 'news';
type CoTab = 'fin' | 'staff' | 'hq' | 'factory' | 'research';
type View = { ov: string; panel: string; look?: CarLook | null; office?: OfficeView };
interface LaunchSet { pid: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }

const WEEK_MS = 1500; // 1배속: 1주 = 1.5초(설계서 4장)
const OFFICE_GAP_MS = 1800; // 사무실 점수 연출 최소 간격(점수 글자가 떠 있는 시간)
const MAX_TICKS_PER_FRAME = 4;
const PICKUP_YAW = 0.75; // 픽업 무대·썸네일 기본 각도: 뒤 3/4(짐칸이 보이게)
const DEBUG_KEY = 'car-company-debug';
const ALL_TABS: [PlanTab, string][] = [['prev', '전 세대'], ['body', '차체'], ['look', '모양'], ['seg', '고객층'], ['power', '동력'], ['opt', '옵션'], ['dir', '개발 방향'], ['budget', '예산·기간']];
const planTabs = (d: Draft): [PlanTab, string][] => (d.nameplateId ? ALL_TABS : ALL_TABS.slice(1));
const CRITIC_SUB: Record<string, string> = { performance: '힘과 멋을 봅니다', household: '쓸모·연비·품질을 봅니다', design: '디자인과 마감을 봅니다', value: '값에 비해 좋은지 봅니다' };
const MARK_WORD: Record<string, string> = { '◎': '잘 맞는 조합', '○': '무난한 조합', '△': '덜 맞는 조합', '×': '안 맞는 조합' };
/** 연구로 여는 차체·옵션·동력 → 그 기술(자료 조회, "연구 필요: ○○" 표시용) */
const UNLOCK_TECH = new Map<string, { id: string; name: string; year: number }>();
for (const t of TECHS) for (const e of t.effects) if (e.type === 'body' || e.type === 'option' || e.type === 'powertrain') UNLOCK_TECH.set(`${e.type}:${e.id}`, t);
const EV = config.events.charging.powertrain;

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector<T>(s)!;

export function startApp(): void {
  let game: Game | null = null;
  let ui: S.UiExtra = { photos: {}, colors: {} };
  let screen: Screen = 'garage';
  let speed = 1, acc = 0, garageIdx = 0, planTab: PlanTab = 'body';
  let draft: Draft | null = null, launch: LaunchSet | null = null, lift: LiftSet | null = null;
  let startSel: 'full' | 'lift' | null = null; // 기획 첫 화면에서 고른 갈래(목록의 해당 버튼을 강조)
  let coTab: CoTab = 'fin', staffSel: number | null = null, hireRole: Role = 'designer', allocWhy = ''; // 회사 탭 안쪽 탭, 고른 직원, 채용 직무, 배분 거부 이유
  let recTab: RecTab = 'cars'; // 기록 탭 안쪽 탭
  let devSel: number | null = null; // 개발 탭에서 고른 프로젝트(동시 개발)
  let officeSent = -Infinity; // 마지막으로 점수·결함 연출을 보낸 시각
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
    const close = () => { t.classList.add('out'); foldToasts(); setTimeout(() => { t.remove(); foldToasts(); }, 300); };
    if (open) (t.querySelector('.open') as HTMLElement).onclick = () => { close(); open.fn(); };
    (t.querySelector('.x') as HTMLElement).onclick = close;
    box.appendChild(t);
    while (box.querySelectorAll('.toast').length > 6) box.querySelector('.toast')!.remove();
    foldToasts();
    setTimeout(close, ms);
  }
  /** 좁은 자리(폰·사무실 칸·무대 없는 화면 오른쪽 위)에서는 알림을 2개만 보이고 나머지는 "+N" 한 줄로 접는다 */
  function foldToasts(): void {
    const box = $('#toasts'), list = [...box.querySelectorAll<HTMLElement>('.toast:not(.out)')];
    const tight = box.classList.contains('corner') || box.classList.contains('inofc') || innerWidth < 900, keep = box.classList.contains('open') ? 99 : tight ? 2 : 3, n = list.length - keep;
    list.forEach((t, i) => t.classList.toggle('folded', i < n));
    let more = box.querySelector<HTMLElement>('.more');
    if (n <= 0) { more?.remove(); if (list.length <= 2) box.classList.remove('open'); return; }
    if (!more) { more = document.createElement('button'); more.className = 'more'; more.onclick = () => { box.classList.add('open'); foldToasts(); }; box.prepend(more); }
    more.textContent = `+${n} 알림 더 보기`;
  }
  const err = (reason: string) => toast(reason, 'bad', '할 수 없습니다');
  /** 넓은 사무실 배치(태블릿 가로)에서는 알림을 사무실 칸 오른쪽 위(띠 아래)에 작게, 최대 2개 띄워 사람들과 패널 버튼을 가리지 않는다 */
  function placeToasts(): void {
    const box = $('#toasts'), wide = $('#main').classList.contains('wide') && innerWidth >= 900, corner = $('#main').classList.contains('full') && innerWidth >= 900;
    box.classList.toggle('inofc', wide); box.classList.toggle('corner', corner); // 무대 없는 화면(회사·기록): 오른쪽 위(상단바 아래)
    if (corner) box.style.setProperty('--ct', `${Math.round($('#top').getBoundingClientRect().bottom + 8)}px`);
    foldToasts();
    if (!wide) return;
    const st = $('#stage').getBoundingClientRect(), band = document.querySelector<HTMLElement>('#ov .ofc')?.getBoundingClientRect();
    box.style.setProperty('--ot', `${Math.round((band?.bottom ?? st.top) + 8)}px`);
    box.style.setProperty('--or', `${Math.round(innerWidth - st.right + 12)}px`);
  }

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
      $('#fb').hidden = true; setOfficeInset();
      office ??= createOffice(host);
      office.update(v); officeLast = v; // update → emit 순서
      // 점수 글자는 약 1.8초 떠 있으므로 그보다 자주 보내지 않는다(빠르기 4배면 한 주가 0.375초라 겹친다). 못 보낸 것은 다음 주 기록이 바꿔 끼운다
      const now = performance.now(), due = now - officeSent >= OFFICE_GAP_MS, ev = officeEvents.filter((e) => due || e.kind === 'say');
      if (ev.length) {
        if (due) officeSent = now;
        const left = officeEvents.filter((e) => !ev.includes(e)); officeEvents.length = 0; officeEvents.push(...left);
        officeScores += ev.filter((e) => e.kind === 'score').length; office.emit(ev);
      }
    } else { const keep = officeEvents.filter((e) => e.kind === 'say').slice(-2); officeEvents.length = 0; officeEvents.push(...keep); } // 주간 점수는 버리고 말풍선만 남긴다
    stageOn();
  }
  /** 사무실 모듈이 위쪽 띠 아래 공간의 가운데에 맞추도록 띠의 실제 높이를 알려 준다 */
  function setOfficeInset(): void {
    const band = document.querySelector<HTMLElement>('#ov .ofc');
    $('#office').style.setProperty('--office-top-inset', `${band ? Math.round(band.getBoundingClientRect().height) : 0}px`);
  }
  addEventListener('resize', () => { if (officeOn) setOfficeInset(); placeToasts(); }); // 사무실의 크기 감시(ResizeObserver)보다 먼저 돈다
  function officeView(p?: Project): OfficeView {
    const s = game!.state;
    return {
      level: Math.min(5, Math.max(1, s.hqLevel)) as OfficeView['level'], phase: p ? p.phase : 'rest', budget: p?.budget ?? 'normal',
      // 교육·휴식 중이면 일하지 않는 자세. 영업 직원은 프로젝트 없이도 일하는 중
      staff: Q.staffInfo(s).map((x) => ({ id: String(x.id), name: x.name, role: x.role, condition: x.condition, working: x.status === 'working' || x.status === 'sales' })),
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
    if (yaw === -0.65 && look.bodyId === 'pickup') yaw = PICKUP_YAW; // 픽업은 기본 각도에서 짐칸이 안 보인다
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
    if (stage) {
      if (key !== lookKey) {
        // shortcut: Stage에 회전을 정하는 공개 함수가 없어 내부 table을 직접 돌린다. render/stage.ts에 setYaw가 생기면 바꿀 것
        if (look.bodyId === 'pickup' && !lookKey.includes('"bodyId":"pickup"')) (stage as unknown as { table: { rotation: { y: number } } }).table.rotation.y = PICKUP_YAW;
        stage.setCar(look);
      } else stage.setColor(look.color);
    }
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

  let quietChoice = false; // 점검용 __car.tick: 사건 창을 띄우지 않는다(popups를 주면 띄움)
  let weekFresh = false; // 한 주에 여러 프로젝트의 주간 기록이 오면 모두 모은다
  function tickOnce(): void {
    if (!game) return;
    const ev = game.tick();
    logDev(); weekFresh = true;
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
        if (weekFresh) { const keep = officeEvents.filter((x) => x.kind === 'say'); officeEvents.length = 0; officeEvents.push(...keep); weekFresh = false; }
        officeEvents.push(...officeFromWeek(e)); break;
      }
      case 'company': toast(e.text, 'alert', '회사', 7000); break;
      case 'news': toast(e.text, 'alert', NEWS_KIND[newsKind(e.text)], 9000, '', { label: '신문 보기', fn: () => showNewsItem(e.text, s.week) }); break;
      case 'choice': if (!quietChoice && sheet.hidden && $('#ask').hidden && title.hidden) showChoice(); break; // 화면 안 창이 떠 있는 동안 시간이 멈춘다
      case 'advice': toast(e.text, 'alert', '조언', 9000); break;
      case 'recall': toast(e.text, 'bad', '리콜'); break;
      case 'unlock': toast(e.text, 'alert', '연구 완료', 9000, '', { label: '연구 화면', fn: () => { coTab = 'research'; launch = null; go('company'); } }); break;
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
    const ae = Q.activeEvents(s).events, up = Q.upcomingEvents(s), pc = Q.pendingChoices(s).length, chip = $('#evchip');
    const lead = ae.find((x) => x.monthsLeft !== null) ?? ae[0];
    chip.hidden = !lead && !up.length;
    chip.textContent = lead ? `${lead.name} · ${lead.monthsLeft === null ? '계속' : `앞으로 ${lead.monthsLeft}개월`}${ae.length > 1 ? ` 외 ${ae.length - 1}` : ''}` : `사건 예고 ${up.length}`;
    const pd = $('#pend'); pd.hidden = !pc; pd.textContent = `결정 대기 ${pc}`;
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
    $('#main').classList.toggle('wide', !!v.office); // 개발 탭 사무실: 위에 넓게, 아래에 패널 세 칸
    if (v.ov !== lastOv) { ov.innerHTML = v.ov; lastOv = v.ov; } // 띠 높이를 사무실보다 먼저 정한다(--office-top-inset)
    placeToasts();
    showOffice(v.office ?? null);
    if (v.look !== undefined && !v.office) showLook(v.look);
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
  const busyReason = (): string | null => { const s = game!.state, n = Q.devTeams(s); return s.projects.length >= n ? `개발팀 ${n}개가 모두 바쁩니다. 진행 중인 개발이 끝나야 합니다.${s.hqLevel < 5 ? ' 본사를 키우면 개발팀이 늘어납니다.' : ''}` : null; };
  /** 조건 버튼: 안 되면 흐리게 + 이유 */
  const elig = (e: Q.Eligibility) => { const b = busyReason(); return b && e.ok ? { ok: false, reason: b } : { ok: e.ok, reason: e.reason }; };

  /** 차고 카드의 주문 상황 한 줄(지난달 생산 한도 때문에 못 판 차가 있을 때) */
  const orderLine = (g: Generation): string => g.lostSales < 1 ? ''
    : `<div class="warnbox order-line" style="margin-top:10px">지난달 주문 ${num(g.lastDemand)}대 중 ${num(g.sales.at(-1) ?? 0)}대만 만들었습니다. ${game!.state.factory.build ? '공장 증설 공사가 진행 중입니다.' : '공장 증설을 고려하세요.'}<button class="btn" data-act="goCo" data-v="factory" style="width:100%;margin-top:8px">공장 보기</button></div>`;

  /** 조언 한 줄. 주문 상황 줄(orderLine)이 같은 말(주문이 생산을 넘음)을 하면 생략 */
  const adviceLine = (g: Generation): string => { const a = Q.advice(g, game!.state); return g.lostSales >= 1 && a.startsWith('주문이') ? '' : `<div class="advice">${esc(a)}</div>`; };

  // ----- 차고 -----
  function garageView() {
    const s = game!.state, gens = sellingGens(s), p = s.projects[0];
    const devCard = s.projects.map((p) => `<div class="card"><p class="lbl">개발 중</p><h2>${esc(p.name)}</h2><p class="hint">${p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`} · 남은 결함 약 ${p.defectEst}개</p><div class="row" style="margin-top:10px"><button class="btn" data-act="devSel" data-id="${p.id}">개발 화면 보기</button></div></div>`).join('');
    if (!gens.length) {
      const any = allGens(s).length > 0;
      const ovh = `<div class="ov empty"><div><h3>${p ? '개발 중인 차가 있습니다' : any ? '판매 중인 차가 없습니다' : '첫 차를 만들어 보세요'}</h3><p>${p ? `「${esc(p.name)}」${eulReul(p.name)} 개발하고 있습니다. 시험이 끝나면 출시할 수 있습니다.` : '차체와 고객층을 고르고, 직원들이 몇 주 동안 차를 설계합니다.'}</p>${p ? '<button class="go dark" data-act="tab" data-v="dev">개발 보기</button>' : '<button class="go" data-act="plan">신차 기획</button>'}</div></div>`;
      const intro = `<div class="card"><p class="lbl">${esc(s.companyName)}</p><h2>${p ? '개발이 끝나면 출시하세요' : '차고가 비어 있습니다'}</h2><p class="hint" style="margin-top:8px">회사의 한 바퀴: <b>기획</b> → <b>설계</b>(몇 주) → <b>시험</b>(결함 줄이기) → <b>출시</b>(가격·색) → 매달 <b>판매</b>. 돈이 6개월 넘게 마이너스면 파산합니다.</p>${p ? '' : '<button class="go" data-act="plan">신차 기획 시작</button>'}</div>`;
      return { ov: ovh, panel: intro + devCard, look: null };
    }
    garageIdx = ((garageIdx % gens.length) + gens.length) % gens.length;
    const g = gens[garageIdx], e = currentEdition(g), name = nameOf(g), base = bodyById(g.body).basePrice;
    const price = garagePrice.get(g.id) ?? e.price, up = Q.unitProfit(g.body, g.powertrain, e.tier, e.options, price, Q.costMultOf(s), Q.ptCostAdd(s, g.powertrain)), lines = Q.linesOf(s);
    const lastSale = g.sales.length ? g.sales[g.sales.length - 1] : null, lb = Q.lifeBar(s, g), ending = g.status === 'ending';
    const ovh = ovTop(`차고 · ${ending ? '이번 달 말 단종' : '판매 중'}${lines >= 2 ? ` · 생산 라인 <span class="lines">${gens.length}/${lines}</span>` : ''}`, `${esc(name)}<small>${editionName(g)}</small>`, `${specLine(g.body, g.powertrain, e.tier, g.segment)} · ${paintName(e.color)}`)
      + ovScore('평론 평균', g.reviewAvg) + ovHint
      + (gens.length > 1 ? `<button class="switch l" data-act="gprev" aria-label="이전 차">‹</button><button class="switch r" data-act="gnext" aria-label="다음 차">›</button>` : '');
    const sales = g.sales.slice(-12), mx = Math.max(1, ...sales);
    const chart = sales.length ? `<svg class="mini" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="최근 월별 판매">${sales.map((v, i) => { const w = 300 / 12, h = (v / mx) * 56; return `<rect x="${(i * w + 2).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${i === sales.length - 1 ? '#ff5a1f' : '#14171c'}"/>`; }).join('')}</svg>` : '';
    const card1 = `<div class="card"><p class="lbl">이 차의 성적</p><div class="kpis">${kpi('지난달 판매', lastSale === null ? '—' : `${num(lastSale)}<span>대</span>`)}${kpi('누적 판매', `${num(g.totalSold)}<span>대</span>`)}${kpi('대당 이익', money(Q.generationUnitProfit(g, s), true), Q.generationUnitProfit(g, s) >= 0 ? 'pos' : 'neg')}${kpi('평론 평균', `${score(g.reviewAvg)}${g.masterpiece ? '<span>명차</span>' : ''}`)}</div>
      ${chart ? `<p class="lbl" style="margin-top:12px">최근 판매(달마다)</p>${chart}` : ''}
      <p class="lbl" style="margin-top:12px">수명</p><div class="life" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lb * 100)}" aria-label="수명"><u style="width:${(lb * 100).toFixed(1)}%"></u></div>
      <p class="hint">${Math.round(lb * 100)}% · 차는 나이를 먹을수록, 해가 갈수록 덜 팔립니다.</p>
      ${adviceLine(g)}${orderLine(g)}${carEventLines(g).map((t) => `<div class="warnbox ev-line" style="margin-top:8px">${esc(t)}</div>`).join('')}</div>`;
    const card2 = ending ? '' : `<div class="card"><p class="lbl">판매 가격</p><div class="pricerow"><b id="gp-out">${num(price)}<span>만원</span></b><span class="margin ${up >= 0 ? 'pos' : 'neg'}" id="gp-margin">대당 이익 ${money(up, true)}</span></div>
      <input type="range" id="gprice" data-gen="${g.id}" min="${Math.ceil(base * config.price.min)}" max="${Math.floor(base * config.price.max)}" step="10" value="${price}" aria-label="판매 가격(만원)">
      <div class="row"><button class="btn ink" data-act="setPrice" data-id="${g.id}" ${price === e.price ? 'disabled' : ''}>가격 바꾸기</button><span class="hint">지금 가격 ${num(e.price)}만원 · 다음 결산부터 반영</span></div>
      <hr><p class="lbl">마케팅(매달 광고비)</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="setMk" data-id="${g.id}" data-v="${i}" aria-pressed="${g.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div></div>`;
    const np = Q.nameplateOf(s, g.id)!, fl = elig(Q.faceliftEligibility(s, g.id)), fc = elig(Q.fullChangeEligibility(s, np.id));
    const card3 = `<div class="card next-step"><p class="lbl">이 차의 다음 단계</p><div class="row"><button class="btn" data-act="goLift" data-id="${g.id}" ${fl.ok ? '' : 'disabled'}>페이스리프트<small>(얼굴·옵션 손보기)</small></button><button class="btn" data-act="goFull" data-id="${np.id}" ${fc.ok ? '' : 'disabled'}>풀체인지<small>(다음 세대)</small></button></div>
      ${fl.ok ? '' : `<p class="note why" data-for="lift">페이스리프트: ${esc(fl.reason ?? '')}</p>`}${fc.ok ? '' : `<p class="note why" data-for="full">풀체인지: ${esc(fc.reason ?? '')}</p>`}
      <hr><button class="btn danger" data-act="discontinue" data-id="${g.id}" ${ending ? 'disabled' : ''} style="width:100%">${ending ? '이번 달 말에 단종됩니다' : '단종하기'}</button></div>`;
    const planCard = s.projects.length < Q.devTeams(s) ? `<div class="card"><p class="lbl">다음 차</p><p class="hint">판매하는 동안 다음 차를 미리 개발할 수 있습니다. ${Q.hasFreeLine(s) ? `생산 라인이 ${lines - gens.length}개 비어 있어 새 차를 함께 팔 수 있습니다.` : `생산 라인 ${lines}개가 모두 차 있어, 새 차를 내려면 지금 차를 단종하거나 공장을 증설해야 합니다.`}</p><button class="go dark" data-act="plan">신차 기획</button></div>` : '';
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
    const s = game!.state, n = npId ? s.nameplates.find((x) => x.id === npId) : undefined, prev = n?.generations.at(-1);
    const seeds = { nameplateId: npId, chassisSeed: Q.lookCandidates(s, npId, 'chassis')[0], faceSeed: Q.lookCandidates(s, npId, 'face', 'nextGen')[0], team: idleDev().map((x) => x.id) };
    if (n && prev) {
      const e = currentEdition(prev), opts = new Set(Q.optionsAt(s).map((o) => o.id));
      return { name: n.name, body: prev.body, segment: prev.segment, powertrain: prev.powertrain, tier: e.tier, options: e.options.filter((o) => opts.has(o)), direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 12, color: e.color, ...seeds };
    }
    return { name: '', body: Q.bodiesAt(s)[0].id, segment: 'worker', powertrain: Q.powertrainsAt(s)[0].id, tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 12, color: PAINT[0][1], ...seeds };
  }
  /** 팀으로 고를 수 있는 직원: 프로젝트에 배치되지 않은 개발 직무(교육·휴식 중이면 그동안 일하지 않음) */
  const idleDev = () => { const lab = new Set(game!.state.staff.filter((x) => x.lab).map((x) => x.id)); return Q.staffInfo(game!.state).filter((x) => x.projectId === null && x.role !== 'sales' && !lab.has(x.id)); }; // 전담 연구원은 개발에 넣지 않는다
  /** 팀 고르기(기획 마지막 단계·페이스리프트). 고를 수 없게 된 직원은 빼고 돌려준다 */
  function teamPicker(team: number[], act: string): string {
    const list = idleDev(), busy = busyReason();
    return `<div class="team-pick"><p class="lbl" style="margin-top:14px">누가 만들까요? <span class="team-n">${team.length}명</span></p>
      ${busy ? `<div class="badbox">${esc(busy)}</div>` : ''}
      ${list.length ? `<div class="picks">${list.map((x) => `<button class="pick" data-act="${act}" data-id="${x.id}" aria-pressed="${team.includes(x.id)}"><i aria-hidden="true"></i><span><b>${esc(x.name)}</b><small>${ROLE_NAME[x.role]} · ${ROLE_SKILL[x.role]} ${x.ability}${x.status === 'training' ? ` · 교육 중(${x.weeksLeft}주 동안 일 못 함)` : x.status === 'resting' ? ` · 휴식 중(${x.weeksLeft}주)` : x.conditionMult < 1 ? ' · 지침' : ''}</small></span></button>`).join('')}</div>`
        : '<div class="warnbox">쉬고 있는 개발 직원이 없습니다. 회사 탭에서 채용하거나, 다른 개발에서 직원을 빼세요.</div>'}
      <p class="note">다른 차를 개발 중인 직원은 고를 수 없습니다. 사람을 빼면 예상 등급이 내려가고 개발비(월급)는 줄어듭니다.</p></div>`;
  }
  const keepIdle = (team: number[]) => { const ok = new Set(idleDev().map((x) => x.id)); return team.filter((id) => ok.has(id)); };
  const defaultName = () => { const n = game!.state.nameplates.length, list = ['아리아', '노바', '솔라', '루나', '벨로', '오로라', '테라', '시리우스', '카덴', '에르타']; return list[n % list.length]; };
  const dirLeft = (d: Draft) => config.dev.dirTotal - STATS.reduce((a, k) => a + d.direction[k], 0);
  const COMPARE = { better: '전작보다 좋음', worse: '전작만 못함', same: '전작과 비슷함' } as const;
  function planView(): View {
    const s = game!.state, d = draft!, y = yearOf(s.week), full = d.nameplateId > 0;
    const n = full ? s.nameplates.find((x) => x.id === d.nameplateId) : undefined, prev = n?.generations.at(-1);
    d.team = keepIdle(d.team);
    const fcp = full ? Q.fullChangePreview(s, d.nameplateId, d) : null, name = full ? n!.name : d.name.trim() || defaultName();
    const tp = Q.teamPreview(s, d.team, d), est = { ...tp, cost: tp.cost * (fcp?.costMult ?? 1) }; // 고른 팀 기준(풀체인지는 개발비 할인 반영)
    const compare = fcp ? (est.avg > fcp.prevAvg ? 'better' : est.avg < fcp.prevAvg ? 'worse' : 'same') : 'same';
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
    } else if (planTab === 'body') {
      const open = new Set(Q.bodiesAt(s).map((b) => b.id));
      body = `<div class="opts">${BODIES.map((b) => open.has(b.id)
        ? `<button class="opt" data-act="pick" data-k="body" data-v="${b.id}" aria-pressed="${d.body === b.id}">${silhouetteSvg(lk({ body: b.id }))}<b>${esc(b.name)}</b><small>기준 가격 ${money(b.basePrice)}</small><span class="cost">원가 ${money(b.cost)}</span></button>`
        : lockedOpt('body', b.id, `${silhouetteSvg(lk({ body: b.id }))}<b>${esc(b.name)}</b>`)).join('')}</div><p class="note">흐린 차체는 연구로 엽니다. 누르면 연구 화면으로 갑니다.</p>${bodyWarn}
      <p class="lbl" style="margin-top:14px">색상(출시 때 바꿀 수 있음)</p>${paints('pick', d.color)}`;
    }
    else if (planTab === 'look') {
      const ch = Q.lookCandidates(s, d.nameplateId, 'chassis'), fa = Q.lookCandidates(s, d.nameplateId, 'face', 'nextGen');
      body = `<p class="lbl">옆모습(차대) 후보</p><div class="opts looks">${ch.map((v, i) => { const l = lk({ chassisSeed: v }); return `<button class="opt look" data-act="pick" data-k="chassisSeed" data-v="${v}" aria-pressed="${d.chassisSeed === v}">${thumb(l, 0)}<b>옆모습 ${i + 1}</b><small>${esc(describeLook(l).chassis)}</small></button>`; }).join('')}</div>
        <p class="lbl" style="margin-top:14px">얼굴(앞뒤 모습) 후보</p><div class="opts looks">${fa.map((v, i) => { const l = lk({ faceSeed: v }); return `<button class="opt look" data-act="pick" data-k="faceSeed" data-v="${v}" aria-pressed="${d.faceSeed === v}">${thumb(l, -1.05)}<b>얼굴 ${i + 1}</b><small>${esc(describeLook(l).face)}</small></button>`; }).join('')}</div>
        <p class="note">모양은 겉모습만 바꿉니다(능력치와 무관). 고른 모양은 무대의 차에 바로 보입니다.</p>`;
    } else if (planTab === 'seg') body = `<div class="opts">${SEGMENTS.map((g) => {
      const top = (Object.entries(g.w) as [Stat, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => STAT_NAME[k]).join('·');
      const mk = Q.comboMark(s, d.body, g.id), tag = mk ? `<span class="tag mk">${mk} ${MARK_WORD[mk]}</span>` : '<span class="tag q">? 출시해 보면 알 수 있습니다</span>';
      return `<button class="opt" data-act="pick" data-k="segment" data-v="${g.id}" aria-pressed="${d.segment === g.id}"><b>${esc(g.name)}</b><small>중시: ${top}</small><small>${g.eps >= 2 ? '값에 민감함' : '값보다 만족을 봄'}</small>${tag}</button>`;
    }).join('')}</div><p class="note">차체와 고객층에는 궁합(◎ 잘 맞음 · ○ 무난 · △ 덜 맞음 · × 안 맞음)이 있습니다. 한 번 출시해 본 조합만 궁합이 보입니다. 기록 탭의 조합 노트에 모입니다.</p>`;
    else if (planTab === 'power') {
      const open = new Set(Q.powertrainsAt(s).map((x) => x.id)), pt = powertrainById(d.powertrain), add = Q.ptCostAdd(s, d.powertrain);
      body = `<p class="lbl">동력 종류</p><div class="seg pts">${POWERTRAINS.map((x) => { const t = UNLOCK_TECH.get(`powertrain:${x.id}`); return open.has(x.id) || !t
        ? `<button data-act="pick" data-k="powertrain" data-v="${x.id}" aria-pressed="${d.powertrain === x.id}">${esc(x.name)}<small>${Q.ptLevel(s, x.id)}단계까지 연구</small></button>`
        : `<button class="locked" data-act="goResearch" data-v="${t.id}" data-lock="powertrain:${x.id}">${esc(x.name)}<small>연구 필요</small></button>`; }).join('')}</div>
        <p class="lbl">${esc(pt.name)} 등급</p><div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="pick" data-k="tier" data-v="${i + 1}" aria-pressed="${d.tier === i + 1}"><b>${esc(t.name)}</b><small class="lv">${esc(pt.name)} ${Q.levelForTier(s, d.powertrain, i + 1)}단계</small><small>${TIER_SUB[i] ?? ''}</small><span class="cost">${t.costAdd ? `원가 +${Math.round(t.costAdd * 100)}%` : '원가 기본'}</span></button>`).join('')}</div>
        ${add ? `<p class="hint pt-add" style="margin-top:10px">${esc(pt.name)} 동력은 차 원가가 <b>${Math.round(add * 100)}%</b> 더 듭니다.${pt.minCostAdd !== undefined ? ' 배터리를 연구하면 줄어듭니다.' : ''}</p>` : ''}${d.powertrain === EV ? chargeBox() : ''}
        <p class="note">단계는 연구로 오릅니다. 등급은 연구한 가장 높은 단계(고급)에서 한두 단계 낮춘 것입니다. 고급 동력을 고르면 차에 스포일러가 붙습니다.</p>`;
    } else if (planTab === 'opt') body = optTiles(d.options);
    else if (planTab === 'dir') {
      const left = dirLeft(d);
      body = `<p class="left">남은 점수 <b>${left}</b> / ${config.dev.dirTotal}점</p>${STATS.map((k) => `<div class="dir"><span>${STAT_NAME[k]}</span><button data-act="dir" data-k="${k}" data-v="-1" aria-label="${STAT_NAME[k]} 빼기" ${d.direction[k] <= 0 ? 'disabled' : ''}>−</button><div class="dots" aria-label="${STAT_NAME[k]} ${d.direction[k]}점">${Array.from({ length: config.dev.dirMax }, (_, i) => `<i class="${i < d.direction[k] ? 'on' : ''}"></i>`).join('')}</div><button data-act="dir" data-k="${k}" data-v="1" aria-label="${STAT_NAME[k]} 더하기" ${d.direction[k] >= config.dev.dirMax || left <= 0 ? 'disabled' : ''}>+</button></div>`).join('')}<p class="note">한 능력치에 0~${config.dev.dirMax}점. 2점이 보통이고, 많이 줄수록 그 능력치가 더 자랍니다. 10점을 모두 나눠야 시작할 수 있습니다.</p>`;
    } else body = `<p class="lbl">예산</p><div class="opts">${(Object.keys(BUDGET) as Budget[]).map((b) => `<button class="opt" data-act="pick" data-k="budget" data-v="${b}" aria-pressed="${d.budget === b}"><b>${BUDGET[b].name}</b><small>${BUDGET[b].sub}</small></button>`).join('')}</div>
      <p class="lbl" style="margin-top:14px">설계 기간</p><div class="opts">${config.dev.designWeeks.map((w, i) => `<button class="opt" data-act="pick" data-k="designWeeks" data-v="${w}" aria-pressed="${d.designWeeks === w}"><b>${w}주</b><small>${['빠르지만 점수가 적음', '보통', '오래 걸리지만 점수가 많음'][i] ?? ''}</small></button>`).join('')}</div>${bodyWarn}${teamPicker(d.team, 'teamPick')}`;
    const ti = tabs.findIndex(([k]) => k === planTab), last = ti === tabs.length - 1, left = dirLeft(d), dirNo = tabs.findIndex(([k]) => k === 'dir') + 1;
    const nameBox = full ? `<p class="lbl">차 이름(이어받음)</p><p class="namefix">${esc(name)} <small>${(prev?.number ?? 0) + 1}세대</small></p>`
      : `<p class="lbl">차 이름</p><input class="namein" id="pname" type="text" maxlength="12" value="${esc(d.name)}" placeholder="${esc(defaultName())}" aria-label="차 이름">`;
    const card1 = `<div class="card">${nameBox}
      <div class="seg steps" role="tablist" style="margin-top:12px">${tabs.map(([k, l], i) => `<button role="tab" data-act="ptab" data-v="${k}" aria-selected="${planTab === k}">${i + 1}<small>${l}</small></button>`).join('')}</div>
      ${regBox(d)}<h3>${tabs[ti][1]}</h3>${body}
      ${last && left ? `<div class="warnbox" style="margin-top:12px">개발 방향 점수가 ${left}점 남았습니다(${dirNo}번 단계).</div>` : ''}
      ${fcp && !fcp.eligibility.ok ? `<div class="badbox" style="margin-top:12px">${esc(fcp.eligibility.reason ?? '')}</div>` : ''}
      <div class="row" style="margin-top:12px">${ti > 0 ? `<button class="btn" data-act="ptab" data-v="${tabs[ti - 1][0]}">← 이전</button>` : ''}${last ? '<button class="go" data-act="startDev">개발 시작 <span aria-hidden="true">→</span></button>' : `<button class="btn" data-act="ptab" data-v="${tabs[ti + 1][0]}">다음 →</button>`}</div></div>`;
    const fcKpis = fcp ? `${kpi('전작 대비', COMPARE[compare], compare === 'worse' ? 'neg' : compare === 'better' ? 'pos' : '')}${kpi('이어받는 이름값', EQ_WORD(fcp.equity))}${kpi('예상 재구매', `월 ${num(fcp.rebuyPerMonth)}<span>대</span>`)}${kpi('개발비 할인', fcp.costMult < 1 ? `${Math.round((1 - fcp.costMult) * 100)}<span>%</span>` : '없음')}` : '';
    const card2 = `<div class="card plan-est" data-avg="${est.avg.toFixed(3)}" data-max="${est.max.toFixed(3)}"><p class="lbl">예상(대략) · 고른 직원 ${d.team.length}명 기준</p>${statBars(est.grades)}
      <div class="kpis" style="margin-top:10px;grid-template-columns:repeat(2,1fr)">${kpi('예상 등급', `${score(est.min)}~${score(est.max)}`)}${kpi('예상 개발비', money(est.cost))}${fcKpis}${kpi('대당 원가', money(Q.unitCost(d.body, d.powertrain, d.tier, d.options, Q.costMultOf(s), Q.ptCostAdd(s, d.powertrain))))}${kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}</div>
      ${fcp ? `<p class="hint" style="margin-top:8px">전 세대 출시 때 등급 ${score(fcp.prevAvg)} → 이번 예상 ${score(est.avg)}. ${compare === 'worse' ? '전작보다 못하면 평론가 모두 점수를 깎고 "전작만 못하다" 기사가 납니다.' : compare === 'better' ? '전작보다 좋으면 평론가 점수가 조금 오르고 "진화했다" 기사가 납니다.' : ''}${fcp.revival ? ' 오래 쉰 이름이라 "부활"로 이름값이 절반만 이어집니다.' : ''}</p>` : ''}
      <p class="note">등급은 그해 다른 차와 비교한 점수(0~10, 5가 보통)입니다. 낮은 쪽은 직원 컨디션이 나쁘고 최소 시험만 한 경우, 높은 쪽은 컨디션이 좋고 결함을 다 없앤 경우입니다. 개발비는 설계와 최소 시험 ${config.dev.minTestWeeks}주 기준이며, 시험을 길게 하면 더 듭니다.</p>
      <button class="btn" data-act="cancelPlan" style="width:100%;margin-top:8px">기획 그만두기</button></div>`;
    return { ov: ovh, panel: card1 + card2, look };
  }
  /** 옵션 고르기 타일(기획·페이스리프트 공용). act: 누르면 부를 조작 이름 */
  function optTiles(chosen: string[], act = 'opt'): string {
    const s = game!.state, max = Q.optionSlots(s), open = Q.optionsAt(s), req = new Set(Q.activeEvents(s).requiredOptions), st = techStatus();
    const eff = (o: (typeof OPTIONS)[number]) => (['U', 'D', 'Q'] as const).filter((k) => o[k]).map((k) => `${STAT_NAME[k]} +${o[k]}`).join(' · ');
    const locked = OPTIONS.filter((o) => !open.includes(o)), soon = locked.filter((o) => st.get(UNLOCK_TECH.get(`option:${o.id}`)?.id ?? '') !== 'hidden');
    return `<p class="left">옵션 <b>${chosen.length}</b> / ${max}개</p><div class="opts">${open.map((o) => { const on = chosen.includes(o.id); return `<button class="opt${req.has(o.id) ? ' req' : ''}" data-act="${act}" data-v="${o.id}" aria-pressed="${on}" ${!on && chosen.length >= max ? 'disabled' : ''}><b>${esc(o.name)}</b>${req.has(o.id) ? '<small class="reqtag">규제: 꼭 넣어야 출시</small>' : ''}<small>${eff(o)}</small><span class="cost">대당 +${num(o.cost)}만원</span></button>`; }).join('')}
      ${soon.map((o) => lockedOpt('option', o.id, `<b>${esc(o.name)}</b>${req.has(o.id) ? '<small class="reqtag">규제: 꼭 넣어야 출시</small>' : ''}<small>${eff(o)}</small>`)).join('')}</div>
      <p class="note">옵션은 안 골라도 됩니다. 흐린 옵션은 연구로 엽니다.${locked.length > soon.length ? ` 그 밖에 ${locked.length - soon.length}개 옵션은 시대가 흐르면 연구할 수 있습니다.` : ''}${(Q.hqInfo(s).next?.optionSlots ?? 0) > max ? ' 본사를 키우면 옵션 칸이 늘어납니다.' : ''}</p>`;
  }
  /** 연구 기술의 상태(연구 화면과 같은 판단: sim researchInfo) */
  const techStatus = () => new Map(Q.researchInfo(game!.state).fields.flatMap((f) => f.techs.map((t) => [t.id, t.status] as const)));
  /** 아직 연구 안 한 차체·옵션·동력 칸: 흐리게 + "연구 필요: ○○", 누르면 그 기술의 연구 화면으로 */
  function lockedOpt(type: 'body' | 'option', id: string, inner: string): string {
    const t = UNLOCK_TECH.get(`${type}:${id}`);
    return `<button class="opt locked" data-act="goResearch" data-v="${t?.id ?? ''}" data-lock="${type}:${id}">${inner}<small class="need">연구 필요: ${esc(t?.name ?? '')}${t && t.year > yearOf(game!.state.week) ? ` (${t.year}년쯤)` : ''}</small></button>`;
  }
  /** 규제 경고(11장): 유예가 끝난 필수 옵션이 빠졌으면 */
  function regBox(car: { options: string[]; powertrain: string }): string {
    const s = game!.state, reg = Q.regulationError(s, car);
    if (!reg) return '';
    const miss = Q.activeEvents(s).requiredOptions.filter((o) => !car.options.includes(o)).map((o) => optionById(o).name).join('·');
    return `<div class="badbox reg-warn" style="margin-bottom:12px">${esc(reg.split(':')[0])}: ${miss ? `${esc(miss)}${eulReul(miss) === '을' ? '이' : '가'} 있어야 출시할 수 있습니다. 옵션 단계에서 넣으세요.` : esc(reg)}</div>`;
  }
  /** 전기차 충전 인프라 안내(전기 동력을 고를 때) */
  const chargeBox = (): string => {
    const c = Q.activeEvents(game!.state).chargingInfra, pct = Math.round(c * 100);
    return `<div class="warnbox charge" style="margin-top:10px">${c <= 0 ? `충전소가 아직 없어 전기차는 거의 팔리지 않습니다(지금 ${pct}%). 전기차 시대가 열리면 해마다 늘어납니다.` : c < 1 ? `충전소가 아직 적어 수요가 제한됩니다(지금 ${pct}%). 해마다 늘어납니다.` : '충전소가 충분합니다.'}</div>`;
  };

  // ----- 페이스리프트 기획(8.2) -----
  function liftView(): View {
    const s = game!.state, L = lift!, g = Q.generationById(s, L.genId)!, e = currentEdition(g), np = Q.nameplateOf(s, g.id)!;
    L.team = keepIdle(L.team);
    const pv = Q.faceliftPreview(s, g.id, { options: L.options, tier: L.tier })!, cur = genLook(g), cands = Q.lookCandidates(s, np.id, 'face', 'facelift');
    const front = -Math.PI / 2, dBefore = Q.grades(e.stats, yearOf(s.week + pv.designWeeks + pv.minTestWeeks)).D, pt = powertrainById(g.powertrain), ok = elig(pv.eligibility);
    const ovh = ovTop('페이스리프트 기획 · 지금 모습', `${esc(np.name)}<small>${editionName(g)}</small>`, specLine(g.body, g.powertrain, e.tier, g.segment)) + ovHint;
    const card1 = `<div class="card"><p class="lbl">1. 새 얼굴 고르기</p><div class="faces"><div class="face now">${thumb(cur, front, 200, 140)}<b>지금 얼굴</b><small>${esc(describeLook(cur).face)}</small></div>
      ${cands.map((v, i) => { const l = { ...cur, faceSeed: v }; return `<button class="opt face" data-act="liftPick" data-k="faceSeed" data-v="${v}" aria-pressed="${L.faceSeed === v}">${thumb(l, front, 200, 140)}<b>새 얼굴 ${i + 1}</b><small>${esc(describeLook(l).face)}</small></button>`; }).join('')}</div>
      <p class="note">뼈대(옆모습·차체 크기)는 그대로이고 앞뒤 모습만 바뀝니다.</p></div>`;
    const card2 = `<div class="card"><p class="lbl">2. 옵션 갱신</p>${optTiles(L.options, 'liftOpt')}
      <p class="lbl" style="margin-top:14px">3. 동력 단계(${esc(pt.name)})</p><div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="liftPick" data-k="tier" data-v="${i + 1}" aria-pressed="${L.tier === i + 1}" ${i + 1 < e.tier ? 'disabled' : ''}><b>${esc(t.name)}</b><small class="lv">${esc(pt.name)} ${Q.levelForTier(s, g.powertrain, i + 1)}단계</small><small>${i + 1 < e.tier ? '낮출 수 없음' : i + 1 === e.tier ? '지금 단계' : '한 단계 올리기'}</small></button>`).join('')}</div>
      <p class="note">동력 종류와 차체는 바꿀 수 없습니다. 바꾸려면 풀체인지를 하세요.</p></div>`;
    const bar = (label: string, a: number, b: number) => `<p class="lbl" style="margin-top:12px">${label}</p><div class="ba"><span>지금</span><div class="life"><u style="width:${(a * 100).toFixed(1)}%"></u></div><b>${Math.round(a * 100)}%</b></div><div class="ba"><span>손본 뒤</span><div class="life"><u style="width:${(b * 100).toFixed(1)}%"></u></div><b>${Math.round(b * 100)}%</b></div>`;
    const card3 = `<div class="card lift-est"><p class="lbl">4. 예상</p><div class="kpis">${kpi('비용', money(pv.cost))}${kpi('기간', `${pv.designWeeks + pv.minTestWeeks}<span>주~</span>`)}${kpi('디자인', `${score(dBefore)}→${score(pv.grades.D)}`)}${kpi('평균 등급', `${score(pv.avgBefore)}→${score(pv.avg)}`)}</div>
      <p class="hint" style="margin-top:6px">설계 ${pv.designWeeks}주 + 시험 ${pv.minTestWeeks}주 이상. 디자이너만 일하고 점수는 디자인에만 쌓입니다. 남은 결함은 절반으로 줄어 시작합니다.</p>
      ${bar('수명(판매 힘)', pv.lifeBefore, pv.lifeAfter)}${bar('인지도', pv.awarenessBefore, pv.awarenessAfter)}
      <p class="note">평론가는 다시 평가하지 않고 신문에 기사가 한 줄 납니다. 바꾸는 달은 생산이 30% 줄어듭니다.</p>
      ${teamPicker(L.team, 'liftTeam')}<p class="note">페이스리프트는 디자이너만 점수를 냅니다. 위 예상은 쉬고 있는 직원 전원 기준입니다.</p>
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
  /** 개발 탭에서 보는 프로젝트(고른 것, 없으면 첫 프로젝트) */
  const curProj = (): Project | undefined => { const s = game!.state; return s.projects.find((p) => p.id === devSel) ?? s.projects[0]; };
  const phaseText = (p: Project) => p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`;
  function devView(): View {
    const s = game!.state, p = curProj(), teams = Q.devTeams(s), free = s.projects.length < teams;
    if (!p) {
      return { ov: `<div class="ov ofc"><div class="ofc-t"><div class="eyebrow"><i></i>개발팀 · 쉬는 중</div><b>진행 중인 개발이 없습니다</b><span class="ofc-s">새 차를 기획하면 직원들이 설계를 시작합니다.</span></div>${free ? '<button class="go" data-act="plan">신차 기획</button>' : ''}</div>`,
        panel: `<div class="card"><p class="lbl">개발</p><h2>개발팀이 쉬고 있습니다</h2><p class="hint" style="margin-top:8px">직원 ${s.staff.length}명 중 개발 직원이 기획 때 고른 차에 매달립니다. 개발팀은 ${teams}개라 한 번에 ${teams}대까지 개발할 수 있습니다.${s.hqLevel < 5 && teams < 3 ? ' 본사를 키우면 개발팀이 늘어납니다.' : ''}</p>${free ? '<button class="go" data-act="plan">신차 기획 시작</button>' : ''}</div>`, office: officeView() };
    }
    // 동시 개발: 위쪽에 프로젝트 전환 칩. 빈 개발팀이 있으면 [신차 기획]
    const chips = s.projects.length >= 2 || free ? `<div class="pchips"><span class="lbl">개발팀 ${s.projects.length}/${teams}</span>${s.projects.length >= 2 ? s.projects.map((x) => `<button class="pchip" data-act="devSel" data-id="${x.id}" aria-pressed="${x.id === p.id}"><b>${esc(x.name)}</b><small>${phaseText(x)}</small></button>`).join('') : ''}${free ? '<button class="btn ink" data-act="plan">+ 신차 기획</button>' : ''}</div>` : '';
    const pv = devGrades(p)!, minT = config.dev.minTestWeeks, ready = p.phase === 'test' && p.testWeeks >= minT, adv = Q.defectAdvice(p);
    const phase = phaseText(p);
    const ovh = `<div class="ov ofc"><div class="ofc-t"><div class="eyebrow"><i></i>${kindLabel(p)} · ${phase}</div><b>${esc(p.name)}</b><span class="ofc-s">${STATS.map((k) => `${STAT_NAME[k]} ${score(pv.grades[k])}`).join(' · ')} · 결함 약 ${num(p.defectEst)}개</span></div><div class="ofc-g"><small>지금 등급</small><b>${score(pv.avg)}</b></div></div>`;
    const pct = p.phase === 'design' ? (p.weeksDone / p.designWeeks) * 100 : 100;
    const log = devLog.get(p.id) ?? [];
    // 넓은 화면에서는 사무실 아래에 [진행·능력치] [결함·개발비·버튼] [주간 기록] 세 칸으로 나란히
    const team = s.staff.filter((x) => x.projectId === p.id);
    const card1 = `<div class="card"><p class="lbl">${kindLabel(p)} · ${p.phase === 'design' ? '설계 단계' : '시험 단계'}</p><h2>${esc(p.name)}<small>${phase}</small></h2>
      <p class="hint team-line">만드는 사람 ${team.length}명: ${team.map((x) => `${esc(x.name)}(${ROLE_NAME[x.role]})`).join(', ') || '없음 — 회사 탭에서 직원을 넣으세요'}</p>
      <div class="prog ${p.phase === 'test' ? 'test' : ''}"><u style="width:${pct.toFixed(1)}%"></u></div>
      <p class="lbl" style="margin-top:12px">${p.kind === 'facelift' ? '지금 판매 중인 판의 능력치(출시하면 디자인이 오릅니다)' : '지금 능력치(등급)'}</p>${statBars(pv.grades)}</div>`;
    const card2 = `<div class="card"><div class="kpis">${kpi('남은 결함', `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('지금까지 쓴 개발비', money(p.spent))}</div>
      ${p.phase === 'test' ? defectBox(adv) : `<p class="hint" style="margin-top:10px">${p.kind === 'facelift' ? '디자이너가 새 얼굴을 그리고 있습니다. 점수는 디자인에만 쌓입니다.' : '직원들이 매주 능력치를 쌓고 있습니다. 결함도 함께 생깁니다.'}</p>`}
      <button class="go" data-act="toLaunch" ${ready ? '' : 'disabled'}>${ready ? '출시 준비 →' : p.phase === 'design' ? '설계가 끝나면 시험을 시작합니다' : `시험 ${minT}주 뒤 출시할 수 있습니다`}</button>
      <button class="btn danger" data-act="cancelDev" style="width:100%;margin-top:8px">개발 취소</button>
      ${p.phase === 'test' ? '<p class="note">시험할수록 결함이 줄어 리콜 위험이 낮아집니다. 대신 개발비가 계속 듭니다. 출시 시점은 직접 정합니다.</p>' : ''}</div>`;
    const card3 = `<div class="card"><p class="lbl">주간 기록</p>${log.length ? `<ul class="log">${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">한 주가 지나면 기록이 쌓입니다. 위쪽에서 빠르기를 고르세요.</p>'}</div>`;
    return { ov: ovh, panel: chips + card1 + card2 + card3, office: officeView(p) };
  }

  /** 결함 안내 한 줄(시험 단계·출시 화면) */
  const defectBox = (a: ReturnType<typeof Q.defectAdvice>) => `<div class="${a.level === 'many' ? 'badbox' : a.level === 'some' ? 'warnbox' : 'okbox'} defect-adv" data-level="${a.level}" style="margin-top:10px">${esc(a.text)}</div>`;

  // ----- 출시 -----
  /** 새 생산 라인 없이 이어서 낼 수 있는가(페이스리프트, 판매 중인 전 세대가 있는 풀체인지) */
  const prevOf = (p: Project) => p.kind === 'fullchange' ? game!.state.nameplates.find((n) => n.id === p.targetId)?.generations.at(-1) : undefined;
  function launchView(): View {
    const s = game!.state, L = launch!, p = Q.projectById(s, L.pid)!, base = bodyById(p.body).basePrice, fl = p.kind === 'facelift', prev = prevOf(p);
    const inherits = fl || (!!prev && prev.status !== 'discontinued');
    const up = Q.unitProfit(p.body, p.powertrain, p.tier, p.options, L.price, Q.costMultOf(s), Q.ptCostAdd(s, p.powertrain)), ex = fl ? null : Q.expectedReviews(s, p.id, L.price), fc = fl ? null : Q.salesForecast(s, p.id, L.price, L.marketing), free = inherits || Q.hasFreeLine(s), reg = Q.regulationError(s, p);
    const look = projLook(p, L.color, L.wheels);
    const ovh = ovTop(fl ? '페이스리프트 출시 준비' : p.kind === 'fullchange' ? '풀체인지 출시 준비' : '출시 준비', esc(p.name) + (fl ? '<small>페이스리프트</small>' : ''), `${specLine(p.body, p.powertrain, p.tier, p.segment)} · ${paintName(L.color)} · ${WHEELS[L.wheels].name}`) + (ex ? ovScore('예상 평점', ex.avg) : '') + ovHint;
    const adv = Q.defectAdvice(p);
    const card0 = `<div class="card"><p class="lbl">남은 결함</p><div class="kpis">${kpi('남은 결함', `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('예상 리콜 위험', `연 ${Math.round(adv.recallYear * 100)}<span>%</span>`, adv.level === 'many' ? 'neg' : '')}</div>${defectBox(adv)}${reg ? `<div class="badbox reg-why" style="margin-top:10px">${esc(reg)}</div>` : ''}</div>`;
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
      ${fc ? `<p class="hint sales-fc" style="margin-top:8px">한 달에 약 <b>${num(fc.min)}~${num(fc.max)}대</b> 팔릴 것으로 보입니다(공장 한도 ${num(Q.capacityOf(s))}대).</p>` : ''}
      <p class="note">적은 쪽은 출시 직후(아직 덜 알려짐), 많은 쪽은 몇 달 뒤 알려지고 나서입니다. 실제 평론은 ±0.7 정도 달라집니다.${prev ? ' 풀체인지는 전작과 비교해 평론이 조금 오르내립니다.' : ''}</p></div>` : '';
    const sum = fl ? `새 얼굴로 바꿔 내놓습니다: <b>${num(L.price)}만원</b>(대당 이익 ${money(up, true)}) · 결함 약 ${num(p.defectEst)}개. 평론가는 다시 평가하지 않고 신문에 기사가 납니다.`
      : `이 조건으로 출시합니다: <b>${num(L.price)}만원</b>(대당 이익 ${money(up, true)}) · 광고 ${MARKETING[L.marketing]} · 예상 평점 ${ex ? score(ex.avg) : '—'} · 월 ${fc ? `${num(fc.min)}~${num(fc.max)}대` : '—'} · 결함 약 ${num(p.defectEst)}개`;
    const card4 = `<div class="card launch-go"><p class="lbl">출시 요약</p><p class="hint launch-sum">${sum}</p>
      ${prev && prev.status === 'onSale' ? `<div class="warnbox prev-end" style="margin-top:10px">출시하면 ${prev.number}세대는 이번 달 말에 단종됩니다(재고 처분 1개월).</div>` : ''}
      ${free ? '' : `<div class="badbox" style="margin-top:10px">생산 라인이 모두 차 있습니다(공장 라인 ${Q.linesOf(s)}개). 차고에서 판매 중인 차를 단종하면 그달 말부터 라인이 빕니다. 공장을 증설하면 라인이 늘어납니다.</div><button class="btn" data-act="tab" data-v="garage" style="width:100%;margin-top:8px">차고로 가서 단종하기</button>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="tab" data-v="dev">← 개발 화면으로</button><button class="go" data-act="doLaunch" ${free && !reg ? '' : 'disabled'}>출시하기 <span aria-hidden="true">→</span></button></div></div>`;
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
  function showNews(head: string, body = '', month = monthOf(game!.state.week), label = '신문'): void {
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>${esc(label)} · ${esc(Q.monthLabel(month))}</div><div class="news paper"><div class="mast"><span>모터 데일리</span><span>${esc(Q.monthLabel(month))}</span></div><h3>${esc(head)}</h3>${body ? `<p>${esc(body)}</p>` : ''}</div>
      <button class="go dark" data-act="closeReview">닫기</button>`;
    sheet.hidden = false; renderTop();
    sheetBody.querySelector<HTMLElement>('[data-act="closeReview"]')?.focus();
  }

  // ----- 시대 사건(11장) -----
  type NewsKind = 'warn' | 'start' | 'end' | 'rule' | 'result' | 'ask' | 'other';
  const NEWS_KIND: Record<NewsKind, string> = { warn: '예고', start: '사건 시작', end: '사건 끝', rule: '규제 시행', result: '결정 결과', ask: '선택 사건', other: '모터 데일리' };
  /** 뉴스 종류: 예고 / 시작 / 끝 / 규제 시행 / 무작위 사건 결과 (sim 문구와 사건 자료로 구분) */
  function newsKind(text: string): NewsKind {
    if (text.startsWith('[예고]')) return 'warn';
    if (ERA_EVENTS.some((d) => d.end && text.endsWith(d.end))) return 'end';
    if (ERA_EVENTS.some((d) => text.endsWith(d.start))) return 'start';
    if (text.includes('오늘부터')) return 'rule';
    if (/ — /.test(text)) return 'result';
    if (RANDOM_EVENTS.some((d) => text.startsWith(`[${d.name}]`))) return 'ask';
    return 'other';
  }
  /** 뉴스 한 줄 → 신문 한 장. 시작 기사면 지금 걸린 효과를 본문에 */
  function showNewsItem(text: string, week: number): void {
    const head = text.replace(/^\[[^\]]*\]\s*/, ''), tag = text.match(/^\[([^\]]*)\]/)?.[1] ?? '', k = newsKind(text);
    const ev = k === 'start' || k === 'rule' ? Q.activeEvents(game!.state).events.find((x) => x.name === tag) : undefined;
    showNews(head, ev ? `지금 걸려 있는 효과: ${ev.effects.join(', ')}.` : k === 'warn' ? '아직 시작되지 않은 사건입니다. 몇 달 안에 일어날 수 있으니 미리 대비하세요.' : '', monthOf(week), `${NEWS_KIND[k]}${tag && tag !== '예고' ? ` · ${tag}` : ''}`);
  }
  const ro = (w: string) => { const c = w.charCodeAt(w.length - 1), b = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 : 0; return b && b !== 8 ? '으로' : '로'; };
  /** 답을 기다리는 무작위 사건(맨 앞 것) 창: 선택지와 결과, 남은 주, [나중에] */
  function showChoice(): void {
    const list = Q.pendingChoices(game!.state), c = list[0];
    if (!c) { sheet.hidden = true; render(); return; }
    const def = c.choices[c.defaultChoice]?.label ?? '';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="choice-sheet" data-id="${c.id}"><div class="eyebrow"><i></i>결정이 필요합니다${list.length > 1 ? ` · ${list.length}건 중 1` : ''}</div><h2>${esc(c.name)}</h2><p class="ev-text">${esc(c.text)}</p>
      <div class="evchoices">${c.choices.map((x, i) => `<button class="evc" data-act="resolveEv" data-id="${c.id}" data-v="${i}"><b>${esc(x.label)}${i === c.defaultChoice ? ' <small>(고르지 않으면 이것)</small>' : ''}</b><small>${esc(x.result)}</small></button>`).join('')}</div>
      <p class="hint" style="margin-top:10px">${c.weeksLeft}주 안에 고르지 않으면 「${esc(def)}」${ro(def)} 처리됩니다. 이 창이 떠 있는 동안 시간이 멈춥니다.</p>
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="later">나중에</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 진행 중인 사건 창: 효과(쉬운 말), 충전소 보급률, 필수 옵션, 다가오는 사건 */
  function showEvents(): void {
    const s = game!.state, a = Q.activeEvents(s), up = Q.upcomingEvents(s);
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="events-sheet"><div class="eyebrow"><i></i>시대 사건 · ${esc(game!.dateLabel)}</div><h2>지금 걸려 있는 사건 ${a.events.length}개</h2>
      ${a.events.length ? `<div class="evlist">${a.events.map((x) => `<div class="evbox"><div class="prod-h"><b>${esc(x.name)}</b><small>${x.monthsLeft === null ? '계속 이어짐' : `앞으로 ${x.monthsLeft}개월`}</small></div>${x.kind === 'era' ? `<p class="hint">${esc(x.text)}</p>` : ''}<ul>${x.effects.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>` : '<p class="hint">지금 걸려 있는 사건이 없습니다.</p>'}
      <div class="kpis" style="margin-top:12px">${kpi('전기차 충전소 보급', `${Math.round(a.chargingInfra * 100)}<span>%</span>`)}${kpi('출시에 꼭 필요한 옵션', a.requiredOptions.length ? a.requiredOptions.map((o) => esc(optionById(o).name)).join('·') : '없음')}</div>
      ${up.length ? `<p class="lbl" style="margin-top:14px">다가오는 사건(예고)</p><ul class="uplist">${up.map((x) => `<li>${esc(x.warn)} <small class="hint">· 약 ${x.monthsLeft}개월 뒤</small></li>`).join('')}</ul>` : ''}
      <p class="note">이 게임의 역사 사건과 시장 수치는 실제와 다를 수 있는 게임용 근사입니다.</p>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 차고 카드: 이 차가 받는 사건 영향(sim의 효과 문구 중 이 차의 차체·동력 이름이 들어간 것) */
  function carEventLines(g: Generation): string[] {
    const b = bodyById(g.body).name, p = powertrainById(g.powertrain).name;
    return Q.activeEvents(game!.state).events.flatMap((x) => x.effects.filter((t) => t.includes(b) || t.includes(p)).map((t) => `${x.name}: ${t}`));
  }

  // ----- 회사(9장): 안쪽 탭 재무 / 직원 / 본사 / 공장 -----
  const CO_TABS: [CoTab, string][] = [['fin', '재무'], ['staff', '직원'], ['hq', '본사'], ['factory', '공장'], ['research', '연구']];
  const ROLE_ORDER: Role[] = ['designer', 'engineer', 'tester', 'sales'];
  const condWord = (c: number) => (c < config.staff.condition.low ? '지침' : c < config.staff.condition.mid ? '보통' : '좋음');
  const growWord = (gap: number) => (gap >= 25 ? '성장 여지 큼' : gap >= 15 ? '성장 여지 보통' : '성장 여지 작음');
  const SALES_EFFECT = '영업 직원이 있으면 차가 더 빨리 알려지고 법인 판매가 늘어납니다.';
  /** 비교 줄. cost = 늘면 나쁜 값(유지비) */
  const cmpRow = (label: string, a: string, b: string, cost = false) => `<tr><td>${label}</td><td class="r">${a}</td><td class="r"><b class="${a === b ? '' : cost ? 'neg' : 'pos'}">${b}</b></td></tr>`;
  function companyView(): string {
    const tabs = `<div class="seg cotabs" role="tablist" aria-label="회사">${CO_TABS.map(([k, l]) => `<button role="tab" data-act="cotab" data-v="${k}" aria-selected="${coTab === k}">${l}</button>`).join('')}</div>`;
    return tabs + (coTab === 'staff' ? staffTab() : coTab === 'hq' ? hqTab() : coTab === 'factory' ? factoryTab() : coTab === 'research' ? researchTab() : finTab());
  }

  function finTab(): string {
    const s = game!.state, L = s.ledger[s.ledger.length - 1], limit = Q.loanLimit(s), rate = Q.loanRate(s);
    const hqUp = Q.hqInfo(s).current.upkeep, fUp = Q.factoryInfo(s).current.upkeep;
    const led = s.ledger, mx = Math.max(1, ...led.map((e) => Math.abs(e.profit)));
    const W = 480, H = 150, X0 = 56, bw = (W - X0) / 24;
    const chart = led.length ? `<svg viewBox="0 0 ${W} ${H + 18}" width="100%" role="img" aria-label="최근 24개월 이익"><line x1="${X0}" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#d8dde4"/>${led.map((e, i) => { const h = (Math.abs(e.profit) / mx) * (H / 2 - 4), y = e.profit >= 0 ? H / 2 - h : H / 2; return `<rect x="${(X0 + i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="${e.profit >= 0 ? '#12915a' : '#d43c3c'}"><title>${e.year}년 ${e.monthOfYear}월 ${money(e.profit, true)}</title></rect>`; }).join('')}
      <text x="${X0 - 6}" y="12" font-size="11" fill="#8b94a1" text-anchor="end">+${money(mx)}</text><text x="${X0 - 6}" y="${H / 2 + 4}" font-size="11" fill="#8b94a1" text-anchor="end">0</text><text x="${X0 - 6}" y="${H - 2}" font-size="11" fill="#8b94a1" text-anchor="end">−${money(mx)}</text><text x="${W - 2}" y="${H + 14}" font-size="11" fill="#8b94a1" text-anchor="end">${led[led.length - 1].year}년 ${led[led.length - 1].monthOfYear}월</text><text x="${X0}" y="${H + 14}" font-size="11" fill="#8b94a1">${led[0].year}년 ${led[0].monthOfYear}월</text></svg>` : '<p class="hint">첫 달 결산이 끝나면 그래프가 나옵니다.</p>';
    // shortcut: 장부에는 유지비 합계만 있어 지금 본사 등급의 유지비로 나눠 보인다(그달에 승급했으면 조금 다를 수 있음), sim 장부가 나눠 적게 되면 바꿀 것
    const hqPart = L ? Math.min(L.upkeep, hqUp) : 0;
    const rows: [string, number][] = L ? [['차 원가', L.cogs], ['직원 월급', L.salaries], ['본사 유지비', hqPart], ['공장 유지비', L.upkeep - hqPart], ['개발비', L.dev], ['마케팅', L.marketing], ['대출 이자', L.interest], ['리콜', L.recall], ['일회성 지출(채용 공고·교육·퇴직금·본사 승급·공장 건설)', L.oneOff || 0]] : [];
    const table = L ? `<table class="tbl"><tr><th>${L.year}년 ${L.monthOfYear}월</th><th class="r">금액</th></tr><tr><td>판매 수입 (${num(L.sold)}대)</td><td class="r pos">${money(L.revenue, true)}</td></tr>${rows.filter(([, v]) => v).map(([n, v]) => `<tr><td>${n}</td><td class="r neg">${money(-v)}</td></tr>`).join('')}<tr class="sum"><td>이익</td><td class="r ${L.profit >= 0 ? 'pos' : 'neg'}">${money(L.profit, true)}</td></tr></table>` : '';
    const fin = `<div class="card"><h3>재무</h3><div class="kpis">${kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}${kpi('대출', money(s.loan.balance))}${kpi('대출 한도', money(limit))}${kpi('월 이자', `${(rate * 100).toFixed(1)}<span>%</span>`)}</div>
      <p class="hint" style="margin-top:8px">매달 유지비 ${money(hqUp + fUp)}: 본사 ${money(hqUp)} + 공장 ${money(fUp)} · 직원 월급 ${money(s.staff.reduce((a, x) => a + Q.salaryOf(x.ability), 0))}</p>
      <p class="lbl" style="margin-top:14px">최근 24개월 이익</p>${chart}${table ? `<p class="lbl" style="margin-top:14px">지난달 수입과 지출</p>${table}` : ''}
      <p class="lbl" style="margin-top:14px">대출</p><div class="row">${[10000, 50000, 100000].map((a) => `<button class="btn" data-act="borrow" data-v="${a}" ${s.loan.balance + a > limit ? 'disabled' : ''}>${money(a)} 빌리기</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="repay" data-v="10000" ${s.loan.balance < 10000 || s.cash < 10000 ? 'disabled' : ''}>1억 갚기</button><button class="btn" data-act="repay" data-v="all" ${s.loan.balance <= 0 || s.cash < s.loan.balance ? 'disabled' : ''}>모두 갚기</button></div>
      <p class="note">한도는 20억에 최근 1년 매출의 30%를 더한 값입니다. 한도의 70% 넘게 빌리면 이자가 올라갑니다. 현금이 6개월 넘게 마이너스면 파산합니다. 공고·교육·퇴직금·승급·건설비는 낼 때 현금에서 바로 나가고, 그달 장부에 일회성 지출로 적힙니다.</p>
      ${s.cash < 0 && !s.loan.bailoutUsed ? `<div class="badbox" style="margin-top:10px">현금이 ${s.negMonths}개월째 마이너스입니다. 구제 금융(한 번만)을 받으면 현금이 0이 되지만 평판이 ${-config.bankruptcy.bailoutRep} 떨어지고 대출 한도가 절반이 됩니다.</div><button class="btn danger" data-act="bailout" style="width:100%;margin-top:8px">구제 금융 받기</button>` : ''}</div>`;
    const mine = sellingGens(s).reduce((a, g) => a + (g.sales[g.sales.length - 1] ?? 0), 0);
    const rivals = `<div class="card"><h3>경쟁사</h3><div class="rivals">${s.rivals.map((r) => `<div>${logo(r.id, 26)}<span>${esc(r.name)}<br><small>${esc(RIVALS.find((x) => x.id === r.id)?.trait ?? '')}</small></span><small>${Object.entries(r.cells).filter(([, v]) => v >= 1.05).map(([b]) => bodyById(b).name).join('·') || '고르게'} 강함</small></div>`).join('')}<div class="me">${logo('me', 26)}<span>${esc(s.companyName)}<br><small style="color:#fffa">평판 ${Math.round(s.reputation)}</small></span><span>지난달 ${num(mine)}대</span></div></div><p class="note">회사 이름과 로고는 실제 브랜드를 비튼 가짜이며, 도형은 새로 그렸습니다.</p></div>`;
    return `<div class="cols">${fin}${rivals}</div>`;
  }

  function staffTab(): string {
    const s = game!.state, rows = Q.staffInfo(s), h = Q.hiringInfo(s), T = config.staff.train;
    if (staffSel !== null && !rows.some((x) => x.id === staffSel)) staffSel = null;
    const pname = (id: number | null) => s.projects.find((p) => p.id === id)?.name ?? '';
    const lab = new Set(s.staff.filter((x) => x.lab).map((x) => x.id));
    const doing = (x: Q.StaffRow) => x.status === 'working' ? `「${esc(pname(x.projectId))}」 개발` : x.status === 'training' ? `교육 중 · ${x.weeksLeft}주 남음` : x.status === 'resting' ? `휴식 중 · ${x.weeksLeft}주 남음` : x.status === 'sales' ? '영업' : lab.has(x.id) ? '전담 연구원' : x.role === 'engineer' ? '쉬는 중 · 연구' : '쉬는 중';
    const abil = (x: Q.StaffRow) => `<span class="abil2" title="능력 ${x.ability} · 잠재력 ${x.potential}"><u style="width:${x.ability}%"></u><em style="left:${x.potential}%"></em></span><b>${x.ability}</b>${x.atPotential ? '<small class="cap">더 못 큼</small>' : ''}`;
    const cond = (c: number) => { const w = condWord(c); return `<span class="cbar c${w === '좋음' ? 0 : w === '보통' ? 1 : 2}"><u style="width:${Math.round(c * 100)}%"></u></span>${w}`; };
    const list = ROLE_ORDER.map((r) => {
      const g = rows.filter((x) => x.role === r);
      return g.length ? `<p class="lbl grp">${ROLE_NAME[r]} ${g.length}명</p>${g.map((x) => `<button class="srow" data-act="staffSel" data-id="${x.id}" aria-pressed="${staffSel === x.id}"><span class="s-name"><b>${esc(x.name)}</b><small>${ROLE_NAME[x.role]}</small></span><span class="s-abil">${abil(x)}</span><span class="s-pay">${money(x.salary)}</span><span class="s-cond">${cond(x.condition)}</span><span class="s-do s-${x.status}">${doing(x)}</span></button>`).join('')}` : '';
    }).join('');
    const pay = rows.reduce((a, x) => a + x.salary, 0), salesN = rows.filter((x) => x.role === 'sales').length;
    const card1 = `<div class="card staff-list"><h3>직원 ${rows.length}명 <small class="hint">정원 ${h.staffCount}/${h.capacity}명 · 월급 합계 ${money(pay)}/월</small></h3>
      <div class="srow head" aria-hidden="true"><span>이름</span><span>능력(점선 = 성장 한계)</span><span>월급</span><span>컨디션</span><span>지금 하는 일</span></div>${list}
      <p class="note">${salesN ? SALES_EFFECT : `영업 직원이 없습니다. ${SALES_EFFECT}`} 직원을 누르면 교육·휴식·배치·해고를 할 수 있습니다.</p></div>`;
    const x = rows.find((y) => y.id === staffSel);
    let card2 = '';
    if (x) {
      const assign = x.role === 'sales' ? `<p class="hint">영업 직원은 개발에 넣지 않습니다. 회사에 있는 것만으로 판매를 돕습니다.</p>`
        : x.projectId !== null ? `<button class="btn" data-act="assign" data-id="${x.id}" data-v="" style="width:100%">「${esc(pname(x.projectId))}」 개발에서 빼기</button>`
        : s.projects.length ? `<div class="row">${s.projects.map((p) => `<button class="btn" data-act="assign" data-id="${x.id}" data-v="${p.id}">「${esc(p.name)}」 개발에 넣기</button>`).join('')}</div>` : '<p class="hint">개발 중인 차가 없습니다. 신차를 기획할 때 팀을 고릅니다.</p>';
      card2 = `<div class="card staff-card" id="staff-card"><p class="lbl">직원 자세히</p><h2>${esc(x.name)}<small>${ROLE_NAME[x.role]} · ${ROLE_SKILL[x.role]} ${x.ability}</small></h2>
        <div class="kpis" style="margin-top:10px">${kpi('능력', `${x.ability}<span>/ 한계 ${x.potential}</span>`)}${kpi('월급', money(x.salary))}${kpi('컨디션', condWord(x.condition))}${kpi('올해 교육', `${x.trainingsThisYear}<span>/ ${T.perYear}번</span>`)}</div>
        <p class="hint" style="margin-top:8px">지금 하는 일: <b>${doing(x)}</b>. ${x.atPotential ? '성장 한계에 닿아 더 크지 못합니다.' : `앞으로 ${x.potential - x.ability}만큼 더 클 수 있습니다.`}</p>
        <p class="lbl" style="margin-top:14px">교육</p><button class="btn ink" data-act="train" data-id="${x.id}" ${x.canTrain ? '' : 'disabled'} style="width:100%">교육 보내기 · ${money(x.trainCost)} <small>(능력 +${T.gainMin}~${T.gainMax}, ${T.weeks}주 동안 일 못 함)</small></button>${x.canTrain ? '' : `<p class="note why">${esc(x.trainReason ?? '')}</p>`}
        <p class="lbl" style="margin-top:14px">휴식</p><div class="row">${[2, 4].map((w) => `<button class="btn" data-act="rest" data-id="${x.id}" data-v="${w}" ${x.status === 'training' ? 'disabled' : ''}>${w}주 쉬기</button>`).join('')}</div><p class="note">쉬는 동안 일하지 않고 컨디션이 회복됩니다. 개발에서 빠지지는 않습니다.</p>
        <p class="lbl" style="margin-top:14px">개발 배치</p>${assign}${x.role !== 'engineer' ? '' : lab.has(x.id) ? `<p class="hint" style="margin-top:8px">전담 연구원입니다. 개발에 넣지 않고 연구 점수를 1.5배로 냅니다.</p><button class="btn" data-act="assign" data-id="${x.id}" data-v="" style="width:100%;margin-top:6px">연구소에서 빼기</button>`
          : s.hqLevel >= config.research.labHq ? `<button class="btn lab-btn" data-act="assign" data-id="${x.id}" data-v="lab" style="width:100%;margin-top:8px">전담 연구원으로 <small>(연구 점수 1.5배, 개발에는 못 넣음)</small></button>` : `<p class="note">본사 ${config.research.labHq}등급부터 전담 연구원으로 둘 수 있습니다. 개발에 넣지 않은 엔지니어는 그냥 두어도 연구합니다.</p>`}
        <hr><button class="btn danger" data-act="fire" data-id="${x.id}" style="width:100%">해고 · 퇴직금 ${money(x.severance)}</button>
        <button class="btn" data-act="staffSel" data-id="${x.id}" style="width:100%;margin-top:8px">닫기</button></div>`;
    }
    const post = `<p class="lbl">어떤 직원을 뽑을까요?</p><div class="seg">${ROLE_ORDER.map((r) => `<button data-act="hireRole" data-v="${r}" aria-pressed="${hireRole === r}">${ROLE_NAME[r]}<small>${ROLE_SKILL[r]}</small></button>`).join('')}</div>
      ${hireRole === 'sales' ? `<p class="hint" style="margin:-6px 0 10px">${SALES_EFFECT}</p>` : ''}
      <div class="opts">${h.tiers.map((t) => `<button class="opt" data-act="postJob" data-v="${t.tier}"><b>공고 ${['작게', '보통', '크게'][t.tier - 1]}</b><small>기대 능력 ${t.abilityMin}~${t.abilityMax}</small><span class="cost">${money(t.cost)}</span></button>`).join('')}</div>
      <p class="note">공고를 내면 후보 3명이 옵니다. 평판이 높을수록 조금 더 나은 사람이 옵니다.</p>`;
    const cands = `<p class="hint">후보 ${h.candidates.length}명이 기다립니다. 고르지 않으면 ${Math.max(0, ...h.candidates.map((c) => c.weeksLeft))}주 뒤 다른 회사로 갑니다.</p><div class="cands">${h.candidates.map((c) => `<div class="cand"><b>${esc(c.name)}</b><small>${ROLE_NAME[c.role]} · ${ROLE_SKILL[c.role]} <b>${c.ability}</b></small><span class="chip">${growWord(c.potential - c.ability)}</span><small>요구 월급 ${money(c.salary)} · ${c.weeksLeft}주 남음</small><button class="btn ink" data-act="hire" data-id="${c.id}">채용</button></div>`).join('')}</div>
      <button class="btn" data-act="dismissCands" style="width:100%;margin-top:8px">모두 돌려보내기</button>`;
    const fullBox = `<div class="warnbox hire-full">${esc(h.reason ?? '')}</div><p class="hint" style="margin-top:8px">본사를 키우면 더 뽑을 수 있습니다.</p><button class="btn ink" data-act="cotab" data-v="hq" style="width:100%;margin-top:8px">본사 보기</button>`;
    const card3 = `<div class="card hire-card"><h3>채용 <small class="hint">정원 <b class="cap-n">${h.staffCount}/${h.capacity}</b>명</small></h3>${h.candidates.length ? cands + (h.full ? fullBox : '') : h.full ? fullBox : post}</div>`;
    return `<div class="cols co-staff">${card1}<div class="colstack">${card2}${card3}</div></div>`;
  }

  function hqTab(): string {
    const s = game!.state, h = Q.hqInfo(s), c = h.current, n = h.next;
    const steps = `<ol class="lv5">${config.hq.levels.map((l, i) => `<li class="${i + 1 < c.level ? 'done' : i + 1 === c.level ? 'on' : ''}"><b>${i + 1}</b><small>${esc(l.name)}</small></li>`).join('')}</ol>`;
    const cur = `<div class="card hq-cur"><p class="lbl">지금 본사 · ${c.level}등급</p><h2>${esc(c.name)}</h2>${steps}
      <div class="kpis">${kpi('정원', `${h.staffCount}/${c.staffCap}<span>명</span>`)}${kpi('동시에 개발할 수 있는 차', `${c.teams}<span>대</span>`)}${kpi('옵션 칸', `${c.optionSlots}<span>개</span>`)}${kpi('월 유지비', money(c.upkeep))}</div>
      <p class="note">본사가 클수록 직원을 더 뽑고, 여러 차를 함께 개발하고, 차에 옵션을 더 넣을 수 있습니다. 개발 탭의 사무실도 넓어집니다.</p></div>`;
    const next = n ? `<div class="card hq-next"><p class="lbl">다음 등급 · ${n.level}등급</p><h2>${esc(n.name)}</h2>
      <table class="tbl" style="margin-top:8px"><tr><th>무엇이 늘어나나</th><th class="r">지금</th><th class="r">키우면</th></tr>${cmpRow('정원', `${c.staffCap}명`, `${n.staffCap}명`)}${cmpRow('동시에 개발할 수 있는 차', `${c.teams}대`, `${n.teams}대`)}${cmpRow('옵션 칸', `${c.optionSlots}개`, `${n.optionSlots}개`)}${cmpRow('월 유지비', money(c.upkeep), money(n.upkeep), true)}</table>
      <div class="kpis" style="margin-top:10px">${kpi('승급 비용', money(n.cost))}${kpi('필요한 평판', n.rep ? `${n.rep}<span>이상 (지금 ${Math.floor(s.reputation)})</span>` : '없음')}</div>
      ${h.canUpgrade ? '' : `<div class="badbox" style="margin-top:10px">${esc(h.reason ?? '')}</div>`}
      <button class="go" data-act="upgradeHQ" ${h.canUpgrade ? '' : 'disabled'}>본사 키우기 · ${money(n.cost)}</button></div>`
      : '<div class="card"><h3>최고 등급입니다</h3><p class="hint">본사가 가장 큰 등급입니다.</p></div>';
    return `<div class="cols">${cur}${next}</div>`;
  }

  function factoryTab(): string {
    const s = game!.state, f = Q.factoryInfo(s), c = f.current, n = f.next, b = f.building, BM = config.factory.buildMonths;
    const cut = (m: number) => (m < 1 ? `${Math.round((1 - m) * 100)}%` : '없음');
    const build = b ? `<div class="build"><p class="lbl">증설 공사 중 · ${b.level}등급</p><div class="prog"><u style="width:${(Math.min(1, Math.max(0, (BM - b.monthsLeft) / BM)) * 100).toFixed(1)}%"></u></div><p class="hint">${b.monthsLeft}개월 남았습니다.${n ? ` 끝나면 한 달 생산 ${num(n.capacity)}대, 생산 라인 ${n.lines}개가 됩니다.` : ''}</p></div>` : '';
    const cur = `<div class="card fac-cur"><p class="lbl">지금 공장 · ${c.level}등급</p><div class="kpis">${kpi('한 달 생산', `${num(c.capacity)}<span>대</span>`)}${kpi('생산 라인', `${f.linesUsed}/${c.lines}<span>개 사용</span>`)}${kpi('월 유지비', money(c.upkeep))}${kpi('원가 절감', cut(c.costMult))}</div>${build}
      <p class="note">생산 라인 하나에 차 한 종류를 만듭니다. 주문이 생산량보다 많으면 나머지는 못 팝니다(재고는 없습니다).</p></div>`;
    const next = n ? `<div class="card fac-next"><p class="lbl">${b ? '공사 중인 등급' : '증설하면'} · ${n.level}등급</p>
      <table class="tbl"><tr><th>무엇이 늘어나나</th><th class="r">지금</th><th class="r">증설 뒤</th></tr>${cmpRow('한 달 생산', `${num(c.capacity)}대`, `${num(n.capacity)}대`)}${cmpRow('생산 라인', `${c.lines}개`, `${n.lines}개`)}${cmpRow('월 유지비', money(c.upkeep), money(n.upkeep), true)}${cmpRow('원가 절감', cut(c.costMult), cut(n.costMult))}</table>
      <div class="kpis" style="margin-top:10px">${kpi('건설비', money(n.cost))}${kpi('공사 기간', `${BM}<span>개월</span>`)}</div>
      ${f.canExpand ? '' : `<div class="badbox" style="margin-top:10px">${esc(f.reason ?? '')}</div>`}
      <button class="go" data-act="expandFactory" ${f.canExpand ? '' : 'disabled'}>공장 증설 · ${money(n.cost)}</button></div>`
      : '<div class="card"><h3>최고 등급입니다</h3><p class="hint">공장이 가장 큰 등급입니다.</p></div>';
    const manualSum = f.cars.reduce((a, x) => a + (x.manual ?? 0), 0);
    const rows = f.cars.map((x) => {
      const mx = Math.max(x.demand, x.produced, 1), auto = x.manual === null, pct = Math.round((x.manual ?? 0) * 100);
      return `<div class="prod" data-gen="${x.generationId}"><div class="prod-h"><b>${esc(x.name)}</b><small>지난달 주문 ${num(x.demand)}대 · 생산 ${num(x.produced)}대${x.backlog >= 1 ? ` · <span class="neg">못 판 ${num(x.backlog)}대</span>` : ''}</small></div>
        <div class="pbar" role="img" aria-label="주문 ${num(x.demand)}대 중 ${num(x.produced)}대 생산"><u style="width:${((x.produced / mx) * 100).toFixed(1)}%"></u><i style="width:${((Math.max(0, x.backlog) / mx) * 100).toFixed(1)}%"></i></div>
        <div class="alloc"><div class="seg"><button data-act="allocAuto" data-id="${x.generationId}" aria-pressed="${auto}">자동</button><button data-act="allocManual" data-id="${x.generationId}" aria-pressed="${!auto}">직접</button></div>
        ${auto ? `<span class="hint">주문에 맞춰 나눕니다(지난달 ${Math.round(x.share * 100)}%)</span>` : `<input type="range" class="alloc-r" data-gen="${x.generationId}" min="0" max="100" step="5" value="${pct}" aria-label="${esc(x.name)} 생산 몫(%)"><b class="alloc-v">${pct}%</b>`}</div></div>`;
    }).join('');
    const prod = `<div class="card fac-prod"><h3>차종별 생산</h3>${f.cars.length ? `<div class="advice" style="margin:0 0 10px">${esc(Q.capacityAdvice(s))}</div>${rows}
      <p class="hint" style="margin-top:8px">직접 정한 몫 합계 <b class="alloc-sum">${Math.round(manualSum * 100)}%</b> (100%를 넘을 수 없습니다. 나머지는 자동인 차가 주문에 맞춰 나눕니다)</p>${allocWhy ? `<div class="badbox alloc-why" style="margin-top:8px">${esc(allocWhy)}</div>` : ''}
      <p class="note">막대: 진한 부분은 만든 차, 주황 부분은 주문을 받고도 못 만든 차입니다.</p>` : '<p class="hint">판매 중인 차가 없습니다.</p>'}</div>`;
    return `<div class="cols">${cur}${next}${prod}</div>`;
  }

  // ----- 연구(10장) -----
  const ST_BADGE: Record<Q.TechStatus, string> = { done: '✓ 완료', active: '진행 중', available: '가능', locked: '선행 필요', hidden: '아직 먼 기술' };
  const pts1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('ko-KR');
  /** 비용 배수 표시: 등장 연도보다 일찍(할증) / 8년 지나 따라잡기(할인) / 반복 기술 */
  const multTag = (t: Q.TechRow): string => {
    const m = t.cost.mult, y = yearOf(game!.state.week), x = `×${+m.toFixed(2)}`;
    return m > 1 && y < t.year ? `일찍 연구 ${x}` : m < 1 ? `따라잡기 ${x}` : m > 1 ? `반복 연구 ${x}` : '';
  };
  const preNeed = (t: Q.TechRow) => t.pre.filter((p) => !p.done).map((p) => `「${p.name}」`).join(', ');
  function techCard(t: Q.TechRow): string {
    if (t.status === 'hidden') return `<button class="tc hidden" data-act="techSel" data-v="${t.id}"><span class="tc-h"><b>${esc(t.name)}</b></span><small class="yr">${t.year}년쯤 · 아직 먼 기술</small></button>`;
    const mt = multTag(t), prog = t.status === 'active' ? Math.min(1, 1 - t.pointsLeft / Math.max(1, t.cost.points)) : 0;
    return `<button class="tc ${t.status}" data-act="techSel" data-v="${t.id}"><span class="tc-h"><b>${esc(t.name)}</b><em>${t.repeatable && t.count ? `✓ ${t.count}번` : ST_BADGE[t.status]}</em></span>
      <small class="yr">${t.year}년 기술</small><small class="desc">${esc(t.desc)}</small><small class="eff">${esc(t.effects)}</small>
      ${t.status === 'done' ? '' : t.status === 'active' ? `<span class="prog"><u style="width:${(prog * 100).toFixed(1)}%"></u></span><small class="left">${t.weeksLeft === null ? '연구 점수가 없어 멈춤' : `약 ${t.weeksLeft}주 남음`}</small>`
        : `<small class="cost">${money(t.cost.money)} + ${num(t.cost.points)}점${mt ? ` · <i>${mt}</i>` : ''}</small>`}
      ${t.status === 'locked' ? `<small class="why">${esc(preNeed(t))} 먼저</small>` : t.status === 'available' && t.reason ? `<small class="why">${esc(t.reason)}</small>` : ''}</button>`;
  }
  function researchTab(): string {
    const s = game!.state, r = Q.researchInfo(s), engs = s.staff.filter((x) => x.role === 'engineer'), labN = s.staff.filter((x) => x.lab).length;
    const back = draft || lift ? `<button class="btn ink back-plan" data-act="backPlan" style="width:100%;margin-top:10px">← 기획으로 돌아가기</button>` : '';
    const zero = r.pointsPerWeek > 0 ? '' : `<div class="warnbox r-zero" style="margin-top:10px">${engs.length ? '엔지니어가 모두 개발 중이거나 교육·휴식 중이라 지금 연구 점수가 0입니다. 직원 탭이나 개발 기획에서 엔지니어 한두 명을 개발에서 빼면 연구가 진행됩니다.' : '엔지니어가 없어 연구 점수가 0입니다. 직원 탭에서 엔지니어를 뽑으세요.'}</div>`;
    const act = r.active.map((a) => `<div class="ract"><div class="prod-h"><b>${esc(a.name)}</b><small>${num(a.points)} / ${num(a.need)}점 · ${a.weeksLeft === null ? '연구 점수가 없어 멈춤' : `약 ${a.weeksLeft}주 남음`}</small></div><div class="prog"><u style="width:${((a.points / Math.max(1, a.need)) * 100).toFixed(1)}%"></u></div><button class="btn" data-act="techSel" data-v="${a.techId}">자세히 · 취소</button></div>`).join('');
    const sum = `<div class="card r-sum"><p class="lbl">연구</p><h2 class="r-pts">놀고 있는 엔지니어가 연구합니다. 지금 주당 ${pts1(r.pointsPerWeek)}점</h2>
      <div class="kpis" style="margin-top:10px">${kpi('주당 연구 점수', `${pts1(r.pointsPerWeek)}<span>점</span>`)}${kpi('연구 칸', `${r.used}/${r.slots}<span>개 사용</span>`)}${kpi('완료한 기술', `${r.doneCount}<span>개</span>`)}${kpi('전담 연구원', `${labN}<span>명</span>`)}</div>
      ${zero}${act ? `<p class="lbl" style="margin-top:12px">진행 중인 연구</p>${act}` : '<p class="hint" style="margin-top:10px">진행 중인 연구가 없습니다. 아래에서 "가능"한 기술을 눌러 시작하세요.</p>'}
      <p class="note">개발에 넣지 않은 엔지니어가 매주 능력의 10분의 1만큼 점수를 냅니다. 돈은 시작할 때 내고, 점수가 다 쌓이면 완성됩니다. ${s.hqLevel >= config.research.labHq ? '직원 탭에서 엔지니어를 전담 연구원으로 두면 점수가 1.5배입니다.' : `본사 ${config.research.labHq}등급부터 전담 연구원(점수 1.5배)을 둘 수 있고, 2개를 함께 연구할 수 있습니다.`} 등장 연도보다 일찍 하면 비싸지만 "세계 최초"로 평론 +1, 8년 늦으면 절반 값입니다.</p>${back}</div>`;
    const fields = r.fields.map((f) => `<div class="card rfield" data-field="${f.id}"><h3>${esc(f.name)} <small class="hint">${f.techs.filter((t) => t.status === 'done' || t.count).length}/${f.techs.length} 완료</small></h3><div class="techs">${f.techs.map(techCard).join('')}</div></div>`).join('');
    return `<div class="research">${sum}${fields}</div>`;
  }
  /** 기술 자세히(화면 안 창): 설명·효과·비용·선행·이유, [연구 시작]/[연구 취소] */
  function showTech(id: string): void {
    const s = game!.state, t = Q.researchInfo(s).fields.flatMap((f) => f.techs).find((x) => x.id === id);
    if (!t) return;
    const y = yearOf(s.week), mt = multTag(t), ppw = Q.weeklyResearchPoints(s);
    const why = t.status === 'active' || t.status === 'done' ? null : t.reason;
    const costNote = mt.startsWith('일찍') ? `등장(${t.year}년)보다 ${t.year - y}년 일찍 연구해서 비용이 ${mt.slice(6)}입니다. 먼저 완성하면 이 기술을 쓴 첫 차가 "세계 최초"로 평론 +1을 받습니다.` : mt.startsWith('따라잡기') ? `등장한 지 ${config.research.lateYears}년이 지나 비용이 절반입니다(따라잡기).` : mt ? '반복 연구할 때마다 비용이 늘어납니다.' : '';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="tech-sheet" data-tech="${t.id}"><div class="eyebrow"><i></i>연구 · ${esc(Q.FIELD_NAMES[t.field])} · ${t.year}년 기술</div><h2>${esc(t.name)} <span class="chip ${t.status === 'done' ? 'on' : ''}">${ST_BADGE[t.status]}</span></h2>
      ${t.status === 'hidden' ? '' : `<p class="tech-desc">${esc(t.desc)}</p>
      <div class="kpis" style="margin-top:12px">${kpi('효과', esc(t.effects))}${t.status === 'done' ? '' : `${kpi(t.status === 'active' ? '남은 점수' : '비용', t.status === 'active' ? `${num(t.pointsLeft)}<span>점</span>` : money(t.cost.money))}${t.status === 'active' ? '' : kpi('연구 점수', `${num(t.cost.points)}<span>점</span>`)}${kpi('예상 기간', t.weeksLeft === null ? '점수 0' : `약 ${t.weeksLeft}<span>주</span>`)}`}</div>
      ${costNote && t.status !== 'done' && t.status !== 'active' ? `<p class="hint" style="margin-top:8px">${esc(costNote)}</p>` : ''}
      ${t.pre.length ? `<p class="lbl" style="margin-top:12px">먼저 할 연구</p><ul class="pre">${t.pre.map((p) => `<li class="${p.done ? 'ok' : ''}">${p.done ? '✓' : '✗'} ${esc(p.name)}</li>`).join('')}</ul>` : ''}`}
      ${why ? `<div class="badbox tech-why" style="margin-top:12px">${esc(why)}</div>` : ''}
      ${t.status === 'active' ? `<p class="hint" style="margin-top:10px">지금 주당 ${pts1(ppw)}점이 쌓이고 있습니다.</p>` : ''}
      <div class="row end" style="margin-top:14px"><button class="btn" data-act="closeSheet">닫기</button>${t.status === 'active' ? `<button class="btn danger" data-act="cancelResearch" data-v="${t.id}">연구 취소</button>` : t.status === 'done' ? '' : `<button class="go" data-act="startResearch" data-v="${t.id}" ${why ? 'disabled' : ''}>연구 시작</button>`}</div></div>`;
    sheet.hidden = false; renderTop();
  }

  // ----- 기록 -----
  const REC_TABS: [RecTab, string][] = [['cars', '차종 계보'], ['combo', '조합 노트'], ['news', '뉴스']];
  function recordsView(): string {
    const tabs = `<div class="seg cotabs rectabs" role="tablist" aria-label="기록">${REC_TABS.map(([k, l]) => `<button role="tab" data-act="rectab" data-v="${k}" aria-selected="${recTab === k}">${l}</button>`).join('')}</div>`;
    return tabs + (recTab === 'combo' ? comboTab() : recTab === 'news' ? newsTab() : carsTab());
  }
  /** 조합 노트(5.5): 차체(세로) × 고객층(가로). 출시해 본 칸만 궁합·차 이름·평론, 나머지는 "?" */
  function comboTab(): string {
    const s = game!.state, notes = Q.comboNotes(s), open = new Set(Q.bodiesAt(s).map((b) => b.id));
    const cell = (b: string, g: string) => { const n = notes.find((x) => x.body === b && x.segment === g); return n ? `<td class="cn k${'◎○△×'.indexOf(n.mark)}"><b>${n.mark}</b><small>${esc(n.carName)}</small><small>평론 ${score(n.reviewAvg)}</small></td>` : '<td class="cn q">?</td>'; };
    return `<div class="card combo-card"><h3>조합 노트 <small class="hint">알아낸 조합 ${notes.length} / ${BODIES.length * SEGMENTS.length}칸</small></h3>
      <p class="hint" style="margin:6px 0 10px">차체와 고객층의 궁합(◎ 잘 맞음 · ○ 무난 · △ 덜 맞음 · × 안 맞음)은 그 조합으로 차를 한 번 출시해 봐야 알 수 있습니다. 칸에는 처음 낸 차와 평론이 적힙니다.</p>
      <div class="tblwrap"><table class="combo"><tr><th></th>${SEGMENTS.map((g) => `<th>${esc(g.name)}</th>`).join('')}</tr>${BODIES.map((b) => `<tr class="${open.has(b.id) ? '' : 'off'}"><th>${esc(b.name)}${open.has(b.id) ? '' : '<small>연구 필요</small>'}</th>${SEGMENTS.map((g) => cell(b.id, g.id)).join('')}</tr>`).join('')}</table></div></div>`;
  }
  /** 뉴스 목록(최신이 위): 예고·시작·끝·규제·결정 결과 구분, 누르면 신문 한 장 */
  function newsTab(): string {
    const list = Q.newsLog(game!.state), up = Q.upcomingEvents(game!.state);
    return `<div class="card news-card"><h3>뉴스 <small class="hint">${list.length}건</small></h3>
      ${up.length ? `<div class="warnbox" style="margin:8px 0">다가오는 사건: ${up.map((x) => `${esc(x.warn)}(약 ${x.monthsLeft}개월 뒤)`).join(' / ')}</div>` : ''}
      ${list.length ? `<ul class="newslist">${list.map((n, i) => { const k = newsKind(n.text); return `<li><button class="nl k-${k}" data-act="newsOpen" data-v="${i}"><span class="chip">${NEWS_KIND[k]}</span><small>${esc(n.date)}</small><span class="nt">${esc(n.text.replace(/^\[[^\]]*\]\s*/, ''))}</span></button></li>`; }).join('')}</ul>` : '<p class="hint" style="margin-top:8px">아직 뉴스가 없습니다. 시대 사건의 예고·시작·끝과 회사에 생긴 일이 여기 모입니다.</p>'}</div>`;
  }
  function carsTab(): string {
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
    coTab = 'fin'; recTab = 'cars'; staffSel = null; devSel = null; allocWhy = '';
    garagePrice.clear(); devLog.clear(); devPrev.clear(); lastPanel = ''; lastOv = '';
    title.hidden = true; sheet.hidden = true; makeStage(); speed = 1; acc = 0;
    $('#toasts').innerHTML = ''; $('#toasts').classList.remove('open'); keyed.clear(); // 전 게임의 알림을 남기지 않는다
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
      <p class="note help-line">이 게임의 역사 사건과 시장 수치는 실제와 다를 수 있는 게임용 근사입니다.</p>
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
        if (!s) return; { const b = busyReason(); if (b) return err(b); }
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
        const ed = currentEdition(g), np = Q.nameplateOf(s, id)!, opts = new Set(Q.optionsAt(s).map((o) => o.id));
        lift = { genId: id, faceSeed: Q.lookCandidates(s, np.id, 'face', 'facelift')[0], options: ed.options.filter((o) => opts.has(o)), tier: ed.tier, team: idleDev().map((x) => x.id) };
        go('lift'); return;
      }
      case 'liftPick': if (lift) { (lift as unknown as Record<string, number>)[el.dataset.k!] = Number(v); render(); } return;
      case 'liftOpt': if (lift && s) { lift.options = lift.options.includes(v) ? lift.options.filter((x) => x !== v) : [...lift.options, v].slice(0, Q.optionSlots(s)); render(); } return;
      case 'teamPick': case 'liftTeam': { const o = a === 'teamPick' ? draft : lift, id = Number(el.dataset.id); if (o) { o.team = o.team.includes(id) ? o.team.filter((x) => x !== id) : [...o.team, id]; render(); } return; }
      case 'startLift': {
        if (!game || !lift) return; const L = lift, g = Q.generationById(game.state, L.genId);
        if (!g || !run(game.command({ type: 'startFacelift', generationId: L.genId, options: L.options, tier: L.tier, faceSeed: L.faceSeed, team: L.team }))) return;
        const p = game.state.projects[game.state.projects.length - 1];
        ui.colors[p.id] = currentEdition(g).color; devPrev.set(p.id, 0); lift = null; devSel = p.id;
        toast(`「${p.name}」 페이스리프트를 시작했습니다. 디자이너가 새 얼굴을 그립니다.`); go('dev'); return;
      }
      case 'ptab': planTab = v as PlanTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'pick': {
        if (!draft) return; const k = el.dataset.k as keyof Draft;
        (draft as unknown as Record<string, unknown>)[k] = k === 'tier' || k === 'designWeeks' || k === 'chassisSeed' || k === 'faceSeed' ? Number(v) : v;
        if (k === 'powertrain') draft.tier = Math.min(draft.tier, powertrainById(v).tiers.length);
        render(); return;
      }
      case 'opt': if (!draft || !s) return; draft.options = draft.options.includes(v) ? draft.options.filter((x) => x !== v) : [...draft.options, v].slice(0, Q.optionSlots(s)); render(); return;
      case 'dir': { if (!draft) return; const k = el.dataset.k as Stat, n = draft.direction[k] + Number(v); if (n < 0 || n > config.dev.dirMax || (Number(v) > 0 && dirLeft(draft) <= 0)) return; draft.direction[k] = n; render(); return; }
      case 'cancelPlan': draft = null; lift = null; go('garage'); return;
      case 'startDev': {
        if (!game || !draft) return;
        // 점수가 남았으면 문제 단계(개발 방향)로 데려가서 이유를 보여 준다
        if (dirLeft(draft) > 0) { planTab = 'dir'; lastPanel = ''; render(); panel.scrollTop = 0; return err(`개발 방향 점수가 ${dirLeft(draft)}점 남았습니다. ${config.dev.dirTotal}점을 모두 나눠 주세요.`); }
        const { color, nameplateId, team, ...spec } = draft;
        const r = nameplateId ? game.command({ type: 'startFullChange', nameplateId, body: spec.body, segment: spec.segment, powertrain: spec.powertrain, tier: spec.tier, options: spec.options, direction: spec.direction, budget: spec.budget, designWeeks: spec.designWeeks, chassisSeed: spec.chassisSeed, faceSeed: spec.faceSeed, team })
          : game.command({ type: 'startProject', ...spec, name: spec.name.trim() || defaultName(), team });
        if (!run(r)) return;
        const p = game.state.projects[game.state.projects.length - 1] as Project;
        ui.colors[p.id] = color; devPrev.set(p.id, 0); draft = null; devSel = p.id;
        toast(`「${p.name}」 개발을 시작했습니다. 위쪽에서 빠르기를 골라 시간을 보내세요.`); go('dev'); return;
      }
      case 'cancelDev': {
        const p = s && curProj(); if (!p || !game) return;
        if (!(await ask(`「${p.name}」 개발을 취소할까요?\n지금까지 쓴 개발비 ${money(p.spent)}는 돌아오지 않습니다.`, '개발 취소', true))) return;
        if (run(game.command({ type: 'cancelProject', projectId: p.id }))) { delete ui.colors[p.id]; toast('개발을 취소했습니다'); go('dev'); }
        return;
      }
      case 'toLaunch': {
        const p = s && curProj(); if (!p) return;
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
      // ---- 회사(9장) ----
      case 'techSel': showTech(v); return;
      case 'resolveEv': {
        if (!game) return; const r = game.command({ type: 'resolveEvent', eventId: Number(el.dataset.id), choice: Number(v) });
        if (!r.ok) return err(r.reason);
        const n = r.events?.find((e) => e.kind === 'news'); if (n) toast(n.text.replace(/^\[[^\]]*\]\s*/, ''), 'alert', '결정 결과', 9000);
        if (Q.pendingChoices(game.state).length) showChoice(); else { sheet.hidden = true; render(); }
        return;
      }
      case 'later': sheet.hidden = true; render(); return;
      case 'newsOpen': if (s) { const n = Q.newsLog(s)[Number(v)]; if (n) showNewsItem(n.text, n.week); } return;
      case 'rectab': recTab = v as RecTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'goResearch': coTab = 'research'; go('company'); if (v) showTech(v); return;
      case 'backPlan': go(draft ? 'plan' : lift ? 'lift' : 'garage'); return;
      case 'startResearch': {
        if (!game) return; const t = Q.researchInfo(game.state).fields.flatMap((f) => f.techs).find((x) => x.id === v); if (!t) return;
        if (!(await ask(`「${t.name}」 연구를 시작할까요?\n${money(t.cost.money)}이 바로 나가고, 연구 점수 ${num(t.cost.points)}점이 쌓이면 완성됩니다${t.weeksLeft === null ? '' : `(지금 점수로 약 ${t.weeksLeft}주)`}.`, '연구 시작'))) return;
        if (run(game.command({ type: 'startResearch', techId: v }))) { sheet.hidden = true; toast(`「${t.name}」 연구를 시작했습니다.`); render(); }
        return;
      }
      case 'cancelResearch': {
        if (!game) return; const t = Q.researchInfo(game.state).active.find((x) => x.techId === v); if (!t) return;
        if (!(await ask(`「${t.name}」 연구를 취소할까요?\n이미 낸 돈은 돌아오지 않고, 쌓은 점수도 사라집니다.`, '연구 취소', true))) return;
        if (run(game.command({ type: 'cancelResearch', techId: v }))) { sheet.hidden = true; toast(`「${t.name}」 연구를 취소했습니다.`); render(); }
        return;
      }
      case 'cotab': coTab = v as CoTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'goCo': coTab = v as CoTab; go('company'); return;
      case 'devSel': devSel = Number(el.dataset.id); launch = null; go('dev'); return;
      case 'staffSel': { const id = Number(el.dataset.id); staffSel = staffSel === id ? null : id; render(); if (staffSel !== null) document.getElementById('staff-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      case 'hireRole': hireRole = v as Role; render(); return;
      case 'postJob': if (game && run(game.command({ type: 'postJob', role: hireRole, tier: Number(v) as 1 | 2 | 3 }))) { toast(`${ROLE_NAME[hireRole]} 공고를 냈습니다. 후보 3명 중에서 고르세요.`); render(); } return;
      case 'hire': {
        if (!game) return; const c = game.state.candidates.find((x) => x.id === Number(el.dataset.id));
        if (c && run(game.command({ type: 'hire', candidateId: c.id }))) { toast(`${c.name}${eulReul(c.name)} ${ROLE_NAME[c.role]}로 채용했습니다.`); render(); }
        return;
      }
      case 'dismissCands': if (game && run(game.command({ type: 'dismissCandidates' }))) { toast('후보를 모두 돌려보냈습니다'); render(); } return;
      case 'train': {
        if (!game) return; const x = game.state.staff.find((y) => y.id === Number(el.dataset.id)); if (!x) return; const a0 = x.ability;
        if (run(game.command({ type: 'train', staffId: x.id }))) { toast(`${x.name} 교육을 보냈습니다. 능력 ${a0} → ${x.ability}. ${config.staff.train.weeks}주 동안 일하지 않습니다.`); render(); }
        return;
      }
      case 'rest': { if (!game) return; const x = game.state.staff.find((y) => y.id === Number(el.dataset.id)); if (x && run(game.command({ type: 'rest', staffId: x.id, weeks: Number(v) }))) { toast(`${x.name}에게 ${v}주 휴식을 줬습니다.`); render(); } return; }
      case 'assign': if (game && run(game.command({ type: 'assign', staffId: Number(el.dataset.id), projectId: v === '' ? null : v === 'lab' ? 'lab' : Number(v) }))) render(); return;
      case 'fire': {
        if (!game) return; const x = Q.staffInfo(game.state).find((y) => y.id === Number(el.dataset.id)); if (!x) return;
        if (!(await ask(`${x.name}(${ROLE_NAME[x.role]}, 능력 ${x.ability})${eulReul(x.name)} 해고할까요?\n퇴직금 ${money(x.severance)}이 바로 나갑니다. 되돌릴 수 없습니다.`, '해고', true))) return;
        if (run(game.command({ type: 'fire', staffId: x.id }))) { staffSel = null; toast(`${x.name}${eulReul(x.name)} 해고했습니다. 퇴직금 ${money(x.severance)}`); render(); }
        return;
      }
      case 'upgradeHQ': {
        if (!game) return; const h = Q.hqInfo(game.state); if (!h.next) return;
        if (!(await ask(`본사를 ${h.next.level}등급 「${h.next.name}」(으)로 키울까요?\n비용 ${money(h.next.cost)}이 바로 나가고, 매달 유지비가 ${money(h.current.upkeep)}에서 ${money(h.next.upkeep)}로 늘어납니다.`, '본사 키우기'))) return;
        if (run(game.command({ type: 'upgradeHQ' }))) { toast(`본사가 「${h.next.name}」(으)로 커졌습니다. 정원 ${h.next.staffCap}명, 동시에 개발할 수 있는 차 ${h.next.teams}대.`, 'alert', '본사'); render(); }
        return;
      }
      case 'expandFactory': {
        if (!game) return; const f = Q.factoryInfo(game.state); if (!f.next) return;
        if (!(await ask(`공장을 ${f.next.level}등급으로 증설할까요?\n건설비 ${money(f.next.cost)}이 바로 나갑니다. 공사는 ${config.factory.buildMonths}개월 걸리고, 그동안은 지금 공장으로 생산합니다.`, '증설하기'))) return;
        if (run(game.command({ type: 'expandFactory' }))) { toast(`공장 증설 공사를 시작했습니다. ${config.factory.buildMonths}개월 뒤 끝납니다.`, 'alert', '공장'); render(); }
        return;
      }
      case 'allocAuto': if (game && run(game.command({ type: 'setAllocation', generationId: Number(el.dataset.id), share: null }))) { allocWhy = ''; render(); } return;
      case 'allocManual': {
        if (!game) return; const f = Q.factoryInfo(game.state), id = Number(el.dataset.id), c = f.cars.find((x) => x.generationId === id); if (!c || c.manual !== null) return;
        const others = f.cars.reduce((a, x) => a + (x.generationId === id ? 0 : x.manual ?? 0), 0);
        const share = Math.max(0, Math.min(1 - others, Math.round((c.share || 1 / f.cars.length) * 20) / 20)); // 지난달 몫에서 시작(5% 단위)
        const r = game.command({ type: 'setAllocation', generationId: id, share });
        allocWhy = r.ok ? '' : r.reason; run(r); render(); return;
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
    else if (t.classList.contains('alloc-r')) { const o = t.parentElement?.querySelector('.alloc-v'); if (o) o.textContent = `${t.value}%`; }
  });
  /** 끄는 중에는 패널 전체를 다시 그리지 않고 숫자만 바꾼다 */
  function updateGaragePrice(t: HTMLInputElement): void {
    const g = game && Q.generationById(game.state, Number(t.dataset.gen)); if (!g) return;
    const e = currentEdition(g), price = Number(t.value), up = Q.unitProfit(g.body, g.powertrain, e.tier, e.options, price, Q.costMultOf(game!.state), Q.ptCostAdd(game!.state, g.powertrain));
    $('#gp-out').innerHTML = `${num(price)}<span>만원</span>`;
    const m = $('#gp-margin'); m.textContent = `대당 이익 ${money(up, true)}`; m.className = `margin ${up >= 0 ? 'pos' : 'neg'}`;
    const btn = panel.querySelector<HTMLButtonElement>('[data-act="setPrice"]'); if (btn) btn.disabled = price === e.price;
  }
  document.addEventListener('pointerdown', () => { dragging = true; });
  document.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('pointercancel', () => { dragging = false; });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'lprice') render();
    else if (t.classList.contains('alloc-r') && game) { // 직접 배분: 놓을 때 적용. 합이 100%를 넘으면 sim의 이유를 그대로 보여 준다
      const r = game.command({ type: 'setAllocation', generationId: Number(t.dataset.gen), share: Number(t.value) / 100 });
      allocWhy = r.ok ? '' : r.reason; if (!r.ok) err(r.reason); dragging = false; lastPanel = ''; render();
    }
  });
  for (const b of document.querySelectorAll<HTMLElement>('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
  for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.addEventListener('click', () => { if (!game) return; if ((screen === 'plan' && b.dataset.tab !== 'dev') || screen === 'company') draft = null; launch = null; lift = null; go(b.dataset.tab as Screen); });
  $('#menubtn').addEventListener('click', () => void showMenu());
  $('#evchip').addEventListener('click', () => { if (game) showEvents(); });
  $('#pend').addEventListener('click', () => { if (game) showChoice(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#ask').hidden) $('#ask-no').click();
    else if (!sheet.hidden) { const close = sheetBody.querySelector<HTMLElement>('[data-act="closeReview"],[data-act="closeSheet"],[data-act="later"]'); close?.click(); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.target as HTMLElement).id === 't-co') $('[data-act="startNew"]').click(); });

  // 스모크 테스트·디버그용
  (window as unknown as { __car: unknown }).__car = {
    get game() { return game; }, get screen() { return screen; }, get ui() { return ui; }, get speed() { return speed; }, get stage() { return stage; },
    tick(n = 1, popups = false) { quietChoice = !popups; try { for (let i = 0; i < n && game && game.state.status === 'playing'; i++) tickOnce(); } finally { quietChoice = false; } render(); },
    get look() { return lookKey; },
    setSpeed, render, held: isHeld, toast,
    get office() { return { on: officeOn, view: officeLast, scores: officeScores }; },
  };

  makeStage();
  void showTitle();
}
