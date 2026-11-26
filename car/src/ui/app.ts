// 카 컴퍼니 화면(바닐라 TS + DOM, 에어 게임 방식). sim 상태는 읽기만 하고 바꿀 때는 game.command(...)만 쓴다.
import { config } from '../config';
import { BODIES, OPTIONS, POWERTRAINS, RIVALS, SEGMENTS, SUB_DATA, TECHS, bodyById, optionById, powertrainById, segmentById } from '../data';
import { Game, SAVE_VERSION, allGens, sellingGens } from '../sim/game';
import * as Q from '../sim/queries';
import * as WD from '../sim/world';
import { currentEdition } from '../sim/market';
import { monthOf, yearOf, yearOfMonth } from '../sim/time';
import { diffOf } from '../sim/difficulty';
import { STATS, type Challenge, type StartCondition, type ExecRole, type Battery, type Budget, type CommandResult, type Difficulty, type NewsCategory, type DevWeekEvent, type GameEvent, type Generation, type NotifyTopic, type PricePolicy, type Project, type ProjectSpec, type Role, type Staff, type StaffWin, type Stat, type Stats, type SubKind, type SubStrategy, type SubCharacter, type PriceBand, type Subsidiary } from '../sim/types';
import { Stage } from '../render/stage';
import { silhouetteSvg } from '../render/silhouette';
import { describeLook } from '../render/variant';
import type { CarLook } from '../render/look';
import { createOffice, type Office, type OfficeEvent, type OfficeView } from './office/office';
import * as LP from './lookpick';
import { applyEra } from './era';
import { REVEAL_KEY, playReveal, revealWanted } from './reveal';
import { CAR_VERSION } from '../version';
import * as S from '../io/saves';
import * as PN from '../io/pastnames';
import * as CL from '../io/cloud';
import { BUDGET, MARKETING, ROLE_NAME, ROLE_SKILL, STAT_NAME, TIER_SUB, esc, josa, longCls, money, moneyText, num, qty, score } from './fmt';
import { DEFAULT_LOGO, LOGO_BG, LOGO_FG, LOGO_MARKS, LOGO_SHAPES, PAINT, RIVAL_PAINT, WHEELS, cleanLogo, logo, logoSvg, lookOf, paintName, ring, type LogoSpec } from './art';
import { infoOf } from './glossary';
import { createSound, type Sfx } from './sound';
import { testCut } from '../sim/dev';
import * as I from './insight';
import * as V from './views';
import * as EQ from './equip';

type Screen = 'garage' | 'start' | 'plan' | 'lift' | 'derive' | 'dev' | 'launch' | 'research' | 'company' | 'fin' | 'records'; // derive: 1.3.0 파생 모델 고르기
type Tab = 'garage' | 'dev' | 'research' | 'company' | 'fin' | 'records'; // 0.9.0 큰 메뉴 6개(연구·재무를 회사 안쪽에서 꺼냄)
type PlanTab = 'sum' | 'prev' | 'body' | 'look' | 'seg' | 'power' | 'opt' | 'dir' | 'budget';
/** 기획 초안. nameplateId 0 = 새 차종, 아니면 그 차종의 풀체인지 */
type Draft = ProjectSpec & { equip?: EQ.Equip; equipMode?: 'rec' | 'prev' | 'custom'; color: string; nameplateId: number; chassisSeed: number; faceSeed: number; team: number[]; year?: number; mode?: 'sum' | 'step'; subId?: number }; // subId(3.1.0): 자회사 신차 기획(가상 팀, 영역 안) // year: 초안을 만든(마지막으로 맞춘) 해, mode: 한 화면 요약(0.8.0 기본) / 단계별
/** 페이스리프트 기획 */
interface LiftSet { genId: number; faceSeed: number; options: string[]; tier: number; team: number[]; equip?: EQ.Equip } // 1.1.0 equip: 장비 구성(options는 sim에 넘기는 파생값)
type RecTab = 'cars' | 'hall' | 'awards' | 'combo' | 'news' | 'years' | 'stats' | 'past'; // awards: 3.5.0 시상식 // stats·past: 1.5.0 통계·지난 판의 차
type CoTab = 'sum' | 'staff' | 'hq' | 'factory' | 'exec' | 'sub' | 'world'; // 4.0.0 'world': 세계 시장 // 1.0.0 첫 화면 'sum'(요약 칸)
type GSort = 'name' | 'launch' | 'price' | 'sold' | 'unit' | 'profit' | 'life' | 'review'; // 0.9.0 차고 요약 표 정렬
type View = { ov: string; panel: string; look?: CarLook | null; office?: OfficeView; keys?: string }; // keys: 0.9.0 무대 아래 핵심 수치 띠
interface LaunchSet { pid: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }
/** 1.3.0 파생 모델 고르기: 바탕 세대, 고른 종류, 이름(새 파생 차종일 때만), 팀, 전기차판 배터리 */
interface DeriveSet { genId: number; variant: string | null; name: string; team: number[]; battery?: Battery }

const WEEK_MS = 3000; // 보통(1배): 1주 = 3초. 0.4.2 사용자 불만(너무 빠름)으로 1.5초 → 3초. 빠름 2배 1.5초, 아주 빠름 4배 0.75초
const PAUSE_KEY = 'car-company-autopause'; // 자동 멈춤 설정(기기 저장소, 디버그 표시와 같은 방식)
const PAUSE_ITEMS = [['cands', '채용 후보가 왔을 때'], ['ready', '개발한 차가 출시 대기가 됐을 때'], ['choice', '결정할 사건이 생겼을 때(선택 창을 띄움)'], ['yearReport', '12월 결산 뒤 연 보고서·10년 회고(창을 띄움)']] as const;
// 0.8.0 자동 저장 설정(기기 저장소): 간격, 큰 결정 뒤 저장
const SAVE_SET_KEY = 'car-company-autosave';
const SAVE_EVERY = [['week', '매주'], ['month', '매달'], ['quarter', '석 달마다'], ['off', '끔']] as const;
type SaveEvery = typeof SAVE_EVERY[number][0];
/** 큰 결정(성공하면 자동 저장): 출시, 개발 시작, 증설·승급, 해고·채용, 임원 임명 */
const BIG_ACTS = new Set(['doLaunch', 'startDev', 'startLift', 'dvStart', 'expandFactory', 'upgradeHQ', 'fire', 'hire', 'execAppoint', 'execHire', 'subFoundDo', 'subSell']);
// 0.8.0 직원 표 정렬·필터(기기 저장소)
const STAFF_VIEW_KEY = 'car-company-staffview';
const STAFF_SORTS = ['name', 'role', 'abil', 'grow', 'pay', 'cond', 'do'] as const;
type StaffSort = typeof STAFF_SORTS[number];
const STAFF_FILTERS = [['', '전체'], ['designer', '디자이너'], ['engineer', '엔지니어'], ['tester', '테스터'], ['sales', '영업'], ['idle', '쉬는 중'], ['working', '개발 중'], ['trainable', '교육 가능'], ['tired', '지친 직원'], ['exec', '임원']] as const;
type StaffFilter = typeof STAFF_FILTERS[number][0];
type PauseKey = typeof PAUSE_ITEMS[number][0];
// 1.3.0 알림 유형(기기 저장소, 1.0.0과 같은 키): sim의 10종(경고는 끌 수 없음) + 화면 쪽 안내. [키, 설정 화면 이름, 'fixed'면 끌 수 없음, 알림·기록함에 쓰는 짧은 이름]
// 끈 유형은 화면에 뜨는 알림과 그 효과음만 빠지고 알림 기록에는 남는다. 시간 멈춤(자동 멈춤)은 시간 설정에서 따로 정한다
const NOTE_KEY = 'car-company-notify';
type NoteCat = NotifyTopic | 'pause' | 'act' | 'pauseStop' | 'choice';
const NOTE_CATS: [NoteCat, string, '' | 'fixed', string][] = [...Q.NOTIFY_TOPICS.map((t): [NoteCat, string, '' | 'fixed', string] => [t.id, t.name, t.locked ? 'fixed' : '', t.name.replace(/\(.*\)$/, '')]),
  ['pause', '자동 멈춤을 꺼 둔 항목의 안내(채용 후보·출시 대기)', '', '자동 멈춤'], ['act', '조작 직후 [되돌리기] 안내', '', '조작'],
  ['pauseStop', '자동 멈춤(시간을 멈춘 때)', 'fixed', '자동 멈춤'], ['choice', '결정 대기', 'fixed', '결정 대기']];
const TOPIC_N = Q.NOTIFY_TOPICS.length;
/** 같은 종류가 연달아 오면 한 알림으로 묶는 종류 */
const GROUPED = new Set<string>(['training', 'hiring', 'research', 'dev', 'launch', 'market', 'factory']);
/** 1.3.0 조작 직후 알림의 유형(그 유형을 끄면 알림과 조작 효과음이 나지 않는다) */
const ACT_TOPIC: Record<string, NoteCat> = { train: 'training', trainPicked: 'training', rest: 'training', restPicked: 'training', hire: 'hiring', fire: 'hiring', dismissCands: 'hiring' };
const OFFICE_GAP_MS = 1800; // 사무실 점수 연출 최소 간격(점수 글자가 떠 있는 시간)
const MAX_TICKS_PER_FRAME = 4;
const SKIP_SPEED = 8; // [다음 일까지] 진행 중 표시용 빠르기(빠르기 버튼 어느 것과도 같지 않게). 실제로는 프레임마다 tick 상한만큼
const SKIP_MAX_WEEKS = 2 * 48; // [다음 일까지] 최대 진행: 2년
type ExecReport = ReturnType<typeof Q.execReports>[number];
const PICKUP_YAW = 0.75; // 픽업 무대·썸네일 기본 각도: 뒤 3/4(짐칸이 보이게)
const DEBUG_KEY = 'car-company-debug';
const ALL_TABS: [PlanTab, string][] = [['prev', '전 세대'], ['body', '차체'], ['look', '모양'], ['seg', '고객층'], ['power', '동력'], ['opt', '장비'], ['dir', '개발 방향'], ['budget', '예산·기간']];
const planTabs = (d: Draft): [PlanTab, string][] => (d.nameplateId ? ALL_TABS : ALL_TABS.slice(1));
const PLANNED_KEY = 'car-company-planned'; // 한 번이라도 개발을 시작한 기기(첫 게임의 첫 차만 단계별 기획이 기본, 0.8.0)
const CRITIC_SUB: Record<string, string> = { performance: '성능과 디자인을 봅니다', household: '실용·연비·품질을 봅니다', design: '디자인과 품질을 봅니다', value: '가격 대비 가치를 봅니다' };
const MARK_WORD: Record<string, string> = { '◎': '잘 맞는 조합', '○': '무난한 조합', '△': '덜 맞는 조합', '×': '안 맞는 조합' };
/** 연구로 여는 차체·옵션·동력 → 그 기술(자료 조회, "연구 필요: ○○" 표시용) */
const UNLOCK_TECH = new Map<string, { id: string; name: string; year: number }>();
for (const t of TECHS) for (const e of t.effects) if (e.type === 'body' || e.type === 'option' || e.type === 'powertrain') UNLOCK_TECH.set(`${e.type}:${e.id}`, t);
const EV = config.events.charging.powertrain;

const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector<T>(s)!;
/** 용어 설명 버튼(ⓘ). 타일 같은 버튼 안에도 넣을 수 있게 span으로 만든다 */
const ib = (key: string, label = key.slice(key.indexOf(':') + 1)) => `<span class="ib" role="button" tabindex="0" data-info="${esc(key)}" aria-label="${esc(label)} 설명"></span>`;


// 3.1.0 운영 전환 화면의 강조색: 자회사 로고 색. 흰 글자·흰 바탕과의 대비가 모자라면 어둡게 한다
const hexRgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lumOf = (c: number[]): number => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const toHex = (c: number[]): string => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
/** 흰색과의 대비가 min 이상이 될 때까지 어둡게 */
const deepen = (h: string, min: number): string => { let c = hexRgb(h); for (let i = 0; i < 40 && 1.05 / (lumOf(c) + 0.05) < min; i++) c = c.map((v) => v * 0.93); return toHex(c); };
const tint = (h: string, k: number): string => toHex(hexRgb(h).map((v) => v + (255 - v) * k));
let themed = '';
function subTheme(x: { kind: string; color: string } | null): void {
  const key = x ? `${x.kind}:${x.color}` : '';
  if (key === themed) return;
  themed = key;
  const r = document.documentElement.style, b = document.body.classList;
  b.remove('sub-premium', 'sub-value', 'sub-biz', 'sub-on');
  for (const k of ['--accent', '--accent2', '--accent-l', '--accent-bg']) r.removeProperty(k);
  if (!x || !/^#[0-9a-f]{6}$/i.test(x.color)) return;
  b.add('sub-on', x.kind === 'premium' ? 'sub-premium' : x.kind === 'value' || x.kind === 'acquired' ? 'sub-value' : 'sub-biz');
  r.setProperty('--accent', deepen(x.color, 3.2)); r.setProperty('--accent2', deepen(x.color, 4.8)); r.setProperty('--accent-l', tint(x.color, 0.45)); r.setProperty('--accent-bg', tint(x.color, 0.86));
}

export function startApp(): void {
  let game: Game | null = null;
  let ui: S.UiExtra = { photos: {}, colors: {}, logo: { ...DEFAULT_LOGO } };
  let logoDraft: LogoSpec = { ...DEFAULT_LOGO }; // 새 게임 화면에서 꾸미는 로고
  let diffSel: Difficulty = Q.difficultyInfo().find((d) => d.isDefault)?.id ?? 'easy'; // 새 게임 화면에서 고른 난이도
  const diffName = (id: Difficulty | undefined) => Q.difficultyInfo().find((d) => d.id === (id ?? 'normal'))?.name ?? '';
  /** 구제 금융: 난이도별 횟수, 받은 횟수, 못 받는 이유(sim의 거절 문구와 같게) */
  const bailInfo = () => {
    const s = game!.state, max = diffOf(s).bailouts, used = s.loan.bailouts ?? (s.loan.bailoutUsed ? 1 : 0);
    const why = max <= 0 ? '이 난이도에서는 구제 금융을 받을 수 없습니다.' : used >= max ? (max === 1 ? '구제 금융은 한 번만 받을 수 있습니다.' : `구제 금융은 ${max}번까지만 받을 수 있습니다.`) : '';
    return { max, used, left: Math.max(0, max - used), why, line: max <= 0 ? '이 난이도에는 구제 금융이 없습니다' : `구제 금융 ${used}/${max}번 받음` };
  };
  let draftNote = ''; // 낡은 초안을 고친 내용 한 줄(다음 조작까지 보인다)
  /** 저장용 화면 정보: 기획 초안·출시 준비 값까지(탭을 옮기거나 다시 불러와도 이어서 하도록) */
  const uiSnap = (): S.UiExtra => ({ ...ui, plan: draft || lift || launch ? JSON.parse(JSON.stringify({ draft, planTab, lift, launch })) as S.PlanSave : undefined });
  let screen: Screen = 'garage';
  let speed = 1, acc = 0, garageId = -1, garageSum = true, planTab: PlanTab = 'body'; // garageId: 차고 상세에서 보는 세대, garageSum: 0.9.0 차고 첫 화면(전 차종 표)
  let draft: Draft | null = null, launch: LaunchSet | null = null, lift: LiftSet | null = null, derive: DeriveSet | null = null;
  let startSel: 'full' | 'lift' | null = null; // 기획 첫 화면에서 고른 갈래(목록의 해당 버튼을 강조)
  let execPick: ExecRole | null = null; // 임원 화면: 직원 임명 목록을 펼친 자리
  let coTab: CoTab = 'sum', staffSel: number | null = null, hireRole: Role = 'designer', allocWhy = ''; // 회사 탭 안쪽 탭, 고른 직원, 채용 직무, 배분 거부 이유
  let staffPick = new Set<number>(); // 일괄 교육·휴식용으로 체크한 직원
  let recTab: RecTab = 'cars'; // 기록 탭 안쪽 탭
  let statsRange: Q.StatsRange = 'all', pastSort: 'recent' | 'sold' = 'recent'; // 1.5.0 통계 기간, 지난 이름 정렬
  let nsYear: number = config.time.startYear, nsCond: StartCondition = 'normal', nsChal = new Set<Challenge>(); // 1.5.0 새 게임 화면의 시작 연도·조건·도전 과제
  let devSel: number | null = null; // 개발 탭에서 고른 프로젝트(동시 개발)
  let officeSent = -Infinity; // 마지막으로 점수·결함 연출을 보낸 시각
  let office: Office | null = null, officeOn = false, officeLast: OfficeView | null = null, officeScores = 0; // officeLast·officeScores: 점검용
  const officeEvents: OfficeEvent[] = []; // 다음에 사무실을 그릴 때 보낼 연출(주간 점수·결함·말풍선)
  const thumbs = new Map<string, string>(); // 모양 후보 썸네일 캐시
  const garagePrice = new Map<number, number>(); // 차고 가격 슬라이더(적용 전 값)
  let bestNote: { key: string; price: number; text: string } | null = null; // [최고 이익 가격으로]를 누른 결과(슬라이더가 그 값일 때만 보인다)
  const devLog = new Map<number, string[]>(), devPrev = new Map<number, number>();
  let stage: Stage | null = null, lookKey = '';
  let debugOn = (() => { try { return localStorage.getItem(DEBUG_KEY) === '1'; } catch { return false; } })();
  const pauseOn = ((): Record<PauseKey, boolean> => { // 기본 모두 켬. 저장값이 깨졌으면 켬
    let o: Record<string, unknown> = {}; try { o = JSON.parse(localStorage.getItem(PAUSE_KEY) ?? '{}') ?? {}; } catch { /* 저장 불가 */ }
    return Object.fromEntries(PAUSE_ITEMS.map(([k]) => [k, o[k] !== false])) as Record<PauseKey, boolean>;
  })();
  const saveSet = ((): { every: SaveEvery; big: boolean } => { // 기본 매달·큰 결정 뒤 저장 켬. 깨진 값은 기본값
    let o: Record<string, unknown> = {}; try { o = JSON.parse(localStorage.getItem(SAVE_SET_KEY) ?? '{}') ?? {}; } catch { /* 저장 불가 */ }
    return { every: SAVE_EVERY.some(([k]) => k === o.every) ? o.every as SaveEvery : 'month', big: o.big !== false };
  })();
  const staffView = ((): { sort: StaffSort; desc: boolean; filter: StaffFilter } => {
    let o: Record<string, unknown> = {}; try { o = JSON.parse(localStorage.getItem(STAFF_VIEW_KEY) ?? '{}') ?? {}; } catch { /* 저장 불가 */ }
    return { sort: STAFF_SORTS.includes(o.sort as StaffSort) ? o.sort as StaffSort : 'role', desc: o.desc === true, filter: STAFF_FILTERS.some(([k]) => k === o.filter) ? o.filter as StaffFilter : '' };
  })();
  const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } };
  const candSeen = new Set<number>(); // 알림을 띄운 채용 후보
  let pxHold: HTMLInputElement | null = null; // 손가락·−/+ 버튼으로 조절 중인 가격 슬라이더(그동안 패널을 다시 그리지 않고 숫자만 바꾼다)
  let titleMode: 'home' | 'new' = 'home', gameOverShown = false, reviewTimers: number[] = [];
  let lastPanel = '', lastOv = '', dragging = false;

  const panel = $('#panel'), ov = $('#ov'), sheet = $('#sheet'), sheetBody = $('#sheet-body'), title = $('#title');
  const myLogo = (z = 26) => logoSvg(ui.logo, z);

  // ---------- 소리 ----------
  const sound = createSound();
  let skipping = false; // 1년 건너뛰기 동안은 효과음을 내지 않는다
  /** 효과음 한 곳. 아주 빠름에서는 매주·매달 반복음을 뺀다 */
  const sfx = (n: Sfx) => { if (!skipping && !(speed >= 4 && (n === 'weekTick' || n === 'monthClose'))) sound.play(n); }; // [다음 일까지]는 빠르기 SKIP_SPEED(8)라 아주 빠름 규칙을 따른다
  // 브라우저는 사용자 조작 안에서만 소리를 켤 수 있다(터치는 pointerup이 조작으로 인정되는 브라우저가 있어 둘 다)
  for (const ev of ['pointerdown', 'pointerup', 'keydown'] as const) document.addEventListener(ev, () => sound.unlock(), true);
  // 버튼 소리: 문서 전체 click 하나에서. 탭 전환·스위치·가격 −/+는 따로, 나머지 버튼은 tap
  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button, [role=button], summary, input[type=checkbox]');
    if (!b || b.matches(':disabled') || b.classList.contains('px-step')) return;
    sfx(b.closest('#tabs') || b.getAttribute('role') === 'tab' || b.dataset.act === 'ptab' || b.dataset.act === 'cotab' || b.dataset.act === 'rectab' ? 'tabSwitch'
      : b.matches('[data-act="autoPause"],[data-act="debug"],[data-act="snd"],#mutebtn,input[type=checkbox]') ? 'toggle' : 'tap');
  }, true);
  // 창 열기·닫기: 결과 창과 확인 창의 hidden이 바뀌는 한 곳에서
  for (const el of [sheet, $('#ask')]) new MutationObserver((ms) => { if ((ms[0].oldValue === null) === el.hidden) sfx(el.hidden ? 'close' : 'open'); }).observe(el, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true });

  // ---------- 알림 ----------
  const keyed = new Map<string, HTMLElement>();
  const closers = new WeakMap<HTMLElement, () => void>();
  const TOAST_MAX = 2; // 한 번에 보이는 알림 수. 넘으면 오래된 보통 알림부터 닫는다(중요한 알림은 "+N"으로 접어 둔다)
  /** 키로 띄운 알림을 닫는다(그 알림이 가리키던 일을 이미 한 경우) */
  const dropToast = (key: string) => { const t = keyed.get(key); if (t?.isConnected) closers.get(t)?.(); };
  // ----- 1.0.0 알림 종류: 켜고 끄기(경고·결정 대기·시간을 멈춘 자동 멈춤은 늘 띄움), 기록함(최근 100건), 같은 종류 묶기 -----
  const noteSet = ((): Record<string, boolean> => { // 기본 모두 켬. 깨진 값은 켬
    let o: Record<string, unknown> = {}; try { o = JSON.parse(localStorage.getItem(NOTE_KEY) ?? '{}') ?? {}; } catch { /* 저장 불가 */ }
    return Object.fromEntries(NOTE_CATS.map(([k]) => [k, o[k] !== false]));
  })();
  const noteFixed = (c: NoteCat) => NOTE_CATS.find(([k]) => k === c)![2] === 'fixed';
  const noteOn = (c: NoteCat) => noteFixed(c) || noteSet[c] !== false;
  const catName = (c: NoteCat) => NOTE_CATS.find(([k]) => k === c)![3];
  interface NoteLog { id: number; week: number; cat: NoteCat; head: string; text: string; open?: { label: string; fn: () => void } }
  let noteLog: NoteLog[] = [], noteId = 0, noteSeen = 0; // noteSeen: 기록함을 마지막으로 연 때의 id
  const toastTimers = new WeakMap<HTMLElement, number>();
  // ----- 3.6.0 알림 묶기: 같은 주(빠른 배속이면 한 화면 갱신에 지나간 여러 주)에 같은 유형 알림이 2개 이상이면 "경쟁사 신차·동향 3건" 하나로.
  // 경고·결정 대기·자동 멈춤(끌 수 없는 유형)과 키 알림(월 결산 등)은 묶지 않는다. 기록함에는 하나씩 남고, 묶은 알림의 [펼쳐 보기]는 그 유형으로 거른 기록함을 연다. 화면 전용(sim 상태와 무관)
  type Queued = { text: string; kind: '' | 'alert' | 'bad'; head: string; ms: number; open?: { label: string; fn: () => void }; cat: NoteCat };
  let batchQ: Queued[] | null = null, relay = false;
  const grpItems = new Map<NoteCat, Queued[]>(); // 떠 있는 묶음 알림의 항목(묶음이 닫히면 새로 시작)
  const solo = new Map<NoteCat, { el: HTMLElement; item: Queued }>(); // 유형마다 마지막으로 하나만 띄운 알림(다음에 같은 유형이 오면 묶음으로 바꾼다)
  /** fn 동안의 알림을 모았다가 유형별로 띄운다(안쪽에서 다시 불리면 바깥 묶음에 합친다) */
  function batched<T>(fn: () => T): T {
    if (batchQ) return fn();
    batchQ = [];
    try { return fn(); } finally { const q = batchQ; batchQ = null; flushToasts(q); }
  }
  function flushToasts(q: Queued[]): void {
    const cats = [...new Set(q.map((x) => x.cat))];
    relay = true;
    try {
      for (const c of cats) {
        const items = q.filter((x) => x.cat === c), key = `grp-${c}`, live = keyed.get(key), on = !!live?.isConnected && !live.classList.contains('out');
        const one = solo.get(c), oneOn = !on && !!one?.el.isConnected && !one.el.classList.contains('out') && one.el.dataset.cat === c && !one.el.querySelector('[data-undo]');
        if (items.length === 1 && !on && !oneOn) { const x = items[0]; toast(x.text, x.kind, x.head, x.ms, '', x.open, x.cat); const el = $('#toasts').lastElementChild as HTMLElement | null; if (el?.dataset.cat === c) solo.set(c, { el, item: x }); continue; }
        if (oneOn) closers.get(one!.el)?.(); // 앞 화면 갱신에 하나로 띄운 같은 유형 알림도 묶음에 넣는다
        const all = [...(on ? grpItems.get(c) ?? [] : oneOn ? [one!.item] : []), ...items]; grpItems.set(c, all);
        const cut = (v: string) => (v.length > 46 ? `${v.slice(0, 45)}…` : v);
        const same = all.every((x) => x.head === all[0].head), text = all.slice(-3).reverse().map((x) => `· ${cut(x.head && !same ? `${x.head}: ${x.text}` : x.text)}`).join('\n') + (all.length > 3 ? `\n외 ${all.length - 3}건` : '');
        toast(text, all.some((x) => x.kind === 'alert') ? 'alert' : '', `${catName(c)} ${all.length}건`, Math.max(...all.map((x) => x.ms)), key, { label: '펼쳐 보기', fn: () => { noteTopic = c; showTodo('notes'); } }, c);
        const el = keyed.get(key); if (el) el.dataset.grp = '1';
      }
    } finally { relay = false; }
  }
  /** 작은 알림. key가 같은 알림은 새로 쌓지 않고 그 자리에서 내용만 바꾼다(월 결산처럼 자주 오는 것). 12초 이상 두는 알림(자동 멈춤·현금 경고·결정 대기·리콜·규제)은 중요한 알림.
   *  cat(1.0.0): 알림 종류. 주면 기록함에 남고, 꺼 둔 종류는 띄우지 않으며, 같은 종류가 떠 있는 동안 또 오면 "평판 변화 3건"으로 묶는다 */
  function toast(text: string, kind: '' | 'alert' | 'bad' = '', head = '', ms = kind ? 9000 : 4000, key = '', open?: { label: string; fn: () => void }, cat?: NoteCat): void {
    if (!cat && kind !== 'bad' && actHist >= 0) cat = ACT_TOPIC[curAct]; // 1.3.0 교육 보내기·채용 같은 조작 직후 알림도 유형을 따른다
    if (cat && game && cat !== 'act' && !relay) { noteLog.unshift({ id: ++noteId, week: game.state.week, cat, head: head || catName(cat), text, open }); if (noteLog.length > 100) noteLog.length = 100; }
    if (cat && !noteOn(cat)) { if (actHist >= 0) undoShown = true; return; } // 끈 유형: 조작 직후라도 따로 [되돌리기] 한 줄을 띄우지 않는다(메뉴의 되돌리기는 그대로)
    if (batchQ && cat && !relay && !key && kind !== 'bad' && !noteFixed(cat) && cat !== 'act' && cat !== 'pause') { batchQ.push({ text, kind, head, ms, open, cat }); return; } // 3.6.0 알림 묶기: 시간 진행 중의 알림은 모았다가 한 번에
    const box = $('#toasts');
    setVar(box, '--tt', `${Math.round($('#top').getBoundingClientRect().bottom + 8)}px`); // 폰: 상단바 바로 아래
    const undo = !open && undoFresh(); // 0.8.0: 되돌릴 수 있는 조작 직후의 알림에 [되돌리기]
    if (undo) { dropUndoBtns(); open = { label: '되돌리기', fn: doUndo }; ms = Math.max(ms, 8000); undoShown = true; } // 되돌릴 수 있는 것은 하나뿐: 이전 알림의 버튼은 없앤다
    const live = (x: HTMLElement | undefined) => !!x?.isConnected && !x.classList.contains('out');
    let n = 1, t = key ? keyed.get(key) : undefined;
    if (!live(t) && cat && !undo && GROUPED.has(cat) && !key.startsWith('grp-')) { // 같은 종류 묶기: 떠 있는 같은 종류 알림을 그 자리에서 바꾼다
      t = [...box.querySelectorAll<HTMLElement>('.toast')].find((x) => x.dataset.cat === cat && live(x) && !x.querySelector('[data-undo]'));
      if (t) { n = Number(t.dataset.n ?? 1) + 1; head = `${catName(cat)} ${n}건`; }
    }
    const fresh = !live(t);
    if (fresh) t = document.createElement('div'); else clearTimeout(toastTimers.get(t!));
    const el = t!;
    if (key) keyed.set(key, el);
    el.className = `toast ${kind}${fresh ? '' : ' seen'}`; // 바꿔 끼운 알림은 등장 움직임을 다시 하지 않는다
    if (cat) { el.dataset.cat = cat; el.dataset.n = String(n); }
    el.innerHTML = `<div>${head ? `<b>${esc(head)}</b>` : ''}${esc(text)}${open ? `<button class="open"${undo ? ' data-undo' : ''}>${esc(open.label)}</button>` : ''}</div><button class="x" aria-label="닫기">×</button>`;
    const close = () => { if (el.classList.contains('out')) return; el.classList.add('out'); foldToasts(); setTimeout(() => { el.remove(); foldToasts(); }, 300); };
    closers.set(el, close); if (ms >= 12000) el.dataset.imp = '1'; else delete el.dataset.imp;
    if (open) (el.querySelector('.open') as HTMLElement).onclick = () => { close(); open.fn(); };
    if (open && key === 'month') { el.classList.add('tap'); (el.firstElementChild as HTMLElement).onclick = (e) => { if (!(e.target as Element).closest('button')) { close(); open.fn(); } }; } // 월 결산 알림은 글을 눌러도 펼친다
    (el.querySelector('.x') as HTMLElement).onclick = close;
    if (fresh) { el.addEventListener('animationend', () => el.classList.add('seen'), { once: true }); box.appendChild(el); } // 등장 움직임은 한 번만(접었다 펼 때 다시 하지 않게)
    for (let lv = [...box.querySelectorAll<HTMLElement>('.toast:not(.out)')], c = lv.length; c > TOAST_MAX; c--) { const o = lv.find((x) => !x.dataset.imp && !x.classList.contains('out') && x !== el); if (!o) break; closers.get(o)!(); lv = lv.filter((x) => x !== o); }
    while (box.querySelectorAll('.toast').length > 6) box.querySelector('.toast')!.remove();
    foldToasts();
    toastTimers.set(el, window.setTimeout(close, ms));
  }
  /** 값이 바뀔 때만 CSS 변수를 쓴다(매 주 다시 쓰지 않게) */
  function setVar(el: HTMLElement, k: string, v: string): void { if (el.style.getPropertyValue(k) !== v) el.style.setProperty(k, v); }
  /** 좁은 자리(폰·사무실 칸·무대 없는 화면 오른쪽 위)에서는 알림을 2개만 보이고 나머지는 "+N" 한 줄로 접는다 */
  function foldToasts(): void {
    const box = $('#toasts'), list = [...box.querySelectorAll<HTMLElement>('.toast:not(.out)')];
    const keep = box.classList.contains('open') ? 99 : TOAST_MAX, n = list.length - keep;
    // 1.0.0 접을 때는 버튼 없는 알림부터(오래된 순). 월 결산처럼 [펼쳐 보기]가 있는 알림이 새 알림 둘에 밀려 "+N" 속에 숨던 일(점검의 '안정 대기 30초 초과' 원인)을 줄인다
    const fold = new Set([...list.filter((t) => !t.querySelector('.open')), ...list.filter((t) => t.querySelector('.open'))].slice(0, Math.max(0, n)));
    list.forEach((t) => t.classList.toggle('folded', fold.has(t)));
    let more = box.querySelector<HTMLElement>('.more');
    if (n <= 0) { more?.remove(); if (list.length <= 2) box.classList.remove('open'); return; }
    if (!more) { more = document.createElement('button'); more.className = 'more'; more.onclick = () => { box.classList.add('open'); foldToasts(); }; box.prepend(more); }
    const mt = `+${n} 알림 더 보기`; if (more.textContent !== mt) more.textContent = mt;
  }
  const err = (reason: string) => { sfx('error'); toast(reason, 'bad', '할 수 없습니다'); };
  // ----- 0.8.0 되돌리기: 조작(act) 중에 되돌릴 수 있는 명령이 성공했으면 그 알림에 버튼, 알림이 없었으면 따로 한 줄 -----
  let actHist = -1, undoShown = false;
  const dropUndoBtns = () => { for (const b of document.querySelectorAll('#toasts [data-undo]')) b.remove(); };
  const undoFresh = () => !!game && actHist >= 0 && !undoShown && game.state.history.length > actHist && Q.undoInfo(game.state).available;
  function doUndo(): void {
    if (!game) return;
    const label = Q.undoInfo(game.state).label, r = game.undoLast();
    if (!r.ok) return err(r.reason);
    sheet.hidden = true; dirty = true; lastPanel = ''; staffPick.clear();
    dropUndoBtns();
    toast(`되돌렸습니다: ${label}`, '', '되돌리기', 5000, 'undo');
    if (saveSet.big) autoSave();
    render();
  }
  /** 넓은 사무실 배치(태블릿 가로)에서는 알림을 사무실 칸 오른쪽 위(띠 아래)에 작게, 최대 2개 띄워 사람들과 패널 버튼을 가리지 않는다 */
  function placeToasts(): void {
    const box = $('#toasts'), wide = $('#main').classList.contains('wide') && innerWidth >= 900, corner = $('#main').classList.contains('full') && innerWidth >= 900;
    box.classList.toggle('inofc', wide); box.classList.toggle('corner', corner); // 무대 없는 화면(회사·기록): 오른쪽 위(상단바 아래)
    if (corner) setVar(box, '--ct', `${Math.round($('#top').getBoundingClientRect().bottom + 8)}px`);
    foldToasts();
    const st = $('#stage').getBoundingClientRect();
    if (!wide) { setVar(box, '--tw', `${Math.round(Math.max(260, Math.min(400, st.width - (document.querySelector('#ov .ov.br') ? 200 : 24))))}px`); setVar(box, '--tb', `${Math.round(Math.max(16, innerHeight - st.bottom + 12))}px`); return; } // 0.9.0 무대 안 아래쪽(아래 핵심 수치 띠를 가리지 않게)
    const band = document.querySelector<HTMLElement>('#ov .ofc')?.getBoundingClientRect();
    setVar(box, '--ot', `${Math.round((band?.bottom ?? st.top) + 8)}px`);
    setVar(box, '--or', `${Math.round(innerWidth - st.right + 12)}px`);
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

  // ---------- 용어 설명(ⓘ 누르기 · 길게 누르기 · 마우스 올려 두기) ----------
  const tip = document.createElement('div');
  tip.id = 'tip'; tip.className = 'tip'; tip.hidden = true; tip.setAttribute('role', 'dialog'); tip.setAttribute('aria-live', 'polite');
  document.body.append(tip);
  let tipAnchor: HTMLElement | null = null, tipHover = false;
  /** 설명 글. 기술은 연구 화면과 같은 자료(설명 전체 + 효과) */
  function infoText(key: string): { title: string; text: string } | null {
    if (key.startsWith('tech:') && game) {
      const t = Q.researchInfo(game.state).fields.flatMap((f) => f.techs).find((x) => x.id === key.slice(5));
      const base = infoOf(key);
      if (t) return { title: t.name, text: base ? `${base.text} (${t.year}년 기술)` : `${t.desc} 효과: ${t.effects}. ${t.year}년 기술.` };
    }
    if (key === 'term:평판' && game) { // 1.0.0 평판 ⓘ: 지금 평판의 효과 목록과 다음 문턱(평판에는 위 상한이 없다)
      const base = infoOf(key), R = Q.reputationInfo(game.state);
      return { title: `평판 ${Math.round(R.value)}`, text: `${base ? `${base.text} ` : ''}지금 효과: ${R.effects.map((e) => `${e.label} ${e.text}`).join(' · ')}.${R.soft ? ` 100을 넘어 효과가 완만하게 늘어납니다(효과 ${Math.round(R.effect)}).` : ''}${R.next ? ` 다음 문턱: 평판 ${R.next.rep} — ${R.next.text}.` : ''}` };
    }
    return infoOf(key);
  }
  function showTip(key: string, anchor: HTMLElement, hover = false): void {
    const inf = infoText(key);
    if (!inf) return;
    tip.innerHTML = `<b>${esc(inf.title)}</b><p>${esc(inf.text)}</p>${hover ? '' : '<button class="btn tip-x" data-tipclose>닫기</button>'}`;
    tip.classList.toggle('hover', hover); tip.dataset.key = key; tip.hidden = false; tipAnchor = anchor; tipHover = hover;
    if (innerWidth < 600) { tip.classList.add('sheetlike'); tip.style.left = tip.style.top = ''; return; } // 폰: 아래에서 올라오는 카드
    tip.classList.remove('sheetlike');
    const r = anchor.getBoundingClientRect(), w = Math.min(340, innerWidth - 24), h = tip.offsetHeight;
    tip.style.width = `${w}px`;
    tip.style.left = `${Math.round(Math.max(12, Math.min(innerWidth - w - 12, r.left + r.width / 2 - w / 2)))}px`;
    tip.style.top = `${Math.round(r.bottom + 8 + h > innerHeight - 8 ? Math.max(8, r.top - h - 8) : r.bottom + 8)}px`;
  }
  const hideTip = () => { tip.hidden = true; tipAnchor = null; tipHover = false; };
  const tipKeyOf = (el: Element | null): [HTMLElement, string] | null => { const t = el?.closest<HTMLElement>('[data-info],[data-tip]'); return t ? [t, (t.dataset.info ?? t.dataset.tip)!] : null; };
  let press = 0, pressAt = [0, 0], swallowClick = false, hoverT = 0;
  // 클릭은 화면 조작보다 먼저(캡처) 본다: ⓘ면 설명만, 길게 누른 뒤의 클릭은 버린다, 설명 밖을 누르면 닫는다
  document.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopPropagation(); return; }
    if (t.closest('[data-tipclose]')) { hideTip(); e.stopPropagation(); return; }
    const i = t.closest<HTMLElement>('[data-info]');
    if (i) { e.preventDefault(); e.stopPropagation(); if (!tip.hidden && !tipHover && tipAnchor === i) hideTip(); else showTip(i.dataset.info!, i); return; }
    if (!tip.hidden && !tip.contains(t)) hideTip();
  }, true);
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[data-info]')) { e.preventDefault(); e.stopPropagation(); showTip(t.dataset.info!, t); }
    else if (e.key === 'Escape' && !tip.hidden) { hideTip(); e.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    clearTimeout(hoverT); clearTimeout(press); swallowClick = false;
    const k = e.button === 0 ? tipKeyOf(e.target as Element) : null;
    if (!k) return;
    pressAt = [e.clientX, e.clientY];
    press = window.setTimeout(() => { press = 0; showTip(k[1], k[0]); swallowClick = true; setTimeout(() => { swallowClick = false; }, 800); }, 500);
  }, true);
  document.addEventListener('pointermove', (e) => { if (press && Math.hypot(e.clientX - pressAt[0], e.clientY - pressAt[1]) > 10) { clearTimeout(press); press = 0; } }, true); // 끌기·스크롤이면 취소
  const endPress = () => { clearTimeout(press); press = 0; };
  document.addEventListener('pointerup', endPress, true); document.addEventListener('pointercancel', endPress, true);
  document.addEventListener('contextmenu', (e) => { if (tipKeyOf(e.target as Element)) e.preventDefault(); }); // 길게 누르기의 기본 메뉴 대신 설명
  // PC: 마우스를 0.6초 올려 두면 설명(누를 수 없는 작은 말풍선), 벗어나면 닫힘
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const k = tipKeyOf(e.target as Element), from = tipKeyOf(e.relatedTarget as Element | null);
    if (!k || from?.[0] === k[0]) return;
    clearTimeout(hoverT);
    hoverT = window.setTimeout(() => { if (tip.hidden || tipHover) showTip(k[1], k[0], true); }, 600);
  });
  document.addEventListener('pointerout', (e) => {
    if (e.pointerType !== 'mouse') return;
    const k = tipKeyOf(e.target as Element), to = e.relatedTarget as Element | null;
    if (!k || (to && k[0].contains(to))) return;
    clearTimeout(hoverT); if (tipHover && tipAnchor === k[0]) hideTip();
  });

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
      // 점수 글자는 약 1.8초 떠 있으므로 그보다 자주 보내지 않는다(아주 빠름이면 한 주가 0.75초라 겹친다). 못 보낸 것은 다음 주 기록이 바꿔 끼운다
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
  addEventListener('resize', () => { if (officeOn) setOfficeInset(); placeToasts(); if (game && title.hidden && (screen === 'garage' || screen === 'launch')) { lastPanel = ''; render(); } }); // 사무실의 크기 감시(ResizeObserver)보다 먼저 돈다
  function officeView(p?: Project): OfficeView {
    const s = game!.state;
    return {
      level: Math.min(config.hq.levels.length, Math.max(1, s.hqLevel)) as OfficeView['level'], phase: p && !p.waiting ? p.phase : 'rest', budget: p?.budget ?? 'normal',
      // 출시 대기면 쉬는 모습. 교육·휴식 중이면 일하지 않는 자세. 영업 직원은 프로젝트 없이도 일하는 중
      staff: Q.staffInfo(s).map((x) => ({ id: String(x.id), name: x.name, role: x.role, condition: x.condition, working: x.status === 'working' || x.status === 'sales' })),
      projectName: p ? `${p.name}${p.kind === 'facelift' ? ' 페이스리프트' : ''}` : undefined,
      carSvg: p ? silhouetteSvg(projLook(p, ui.colors[p.id] ?? PAINT[0][1]), { color: ui.colors[p.id] ?? PAINT[0][1] }) : undefined,
      progress: p ? (p.phase === 'design' ? p.weeksDone / p.designWeeks : 1) : undefined, defects: p?.defectEst, logo: myLogo(32),
      year: yearOf(s.week), execs: Q.execInfo(s).roles.flatMap((r) => r.holder ? [{ id: `x${r.holder.staffId}`, name: r.holder.name, title: r.title }] : []), // M3 시대별 집기, 임원실
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
        if (look.bodyId === 'pickup' && !lookKey.includes('"bodyId":"pickup"')) stage.setYaw(PICKUP_YAW); // 픽업은 짐칸이 보이게 뒤 3/4에서 시작
        stage.setCar(look);
      } else stage.setColor(look.color);
      stage.aim(screen === 'lift' || (screen === 'plan' && planTab === 'look') ? LP.aimYaw() : null); // 1.0.0 외관을 고를 때는 고르는 부품이 보이는 각도로
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
  const deciding = () => screen === 'start' || screen === 'plan' || screen === 'lift' || screen === 'derive' || screen === 'launch';
  const isHeld = (): boolean => !game || !title.hidden || !sheet.hidden || !$('#ask').hidden || deciding() || game.state.status !== 'playing';
  const decisionHeld = (): boolean => !!game && title.hidden && (!sheet.hidden || !$('#ask').hidden || deciding());

  const waitSeen = new Set<number>(); // 출시 대기 알림을 띄운 프로젝트
  let skipPause = false; // 개발자 메뉴 1년 건너뛰기: 자동 멈춤 무시
  let quietChoice = false; // 점검용 __car.tick: 사건 창을 띄우지 않는다(popups를 주면 띄움)
  let weekFresh = false; // 한 주에 여러 프로젝트의 주간 기록이 오면 모두 모은다
  let weekReports = 0; // 이번 주(월 결산)에 새로 온 임원 보고 수
  function tickOnce(): GameEvent[] { return batched(tickRaw); }
  function tickRaw(): GameEvent[] {
    if (!game) return [];
    const eds = new Set(allGens(game.state).flatMap((g) => g.editions.map((x) => x.id))); // 1.3.0 위임한 차의 자동 출시를 알아보려고
    const ev = game.tick();
    weekReports = ev.reduce((a, e) => a + (e.kind === 'execReport' ? e.count : 0), 0);
    logDev(); weekFresh = true; sfx('weekTick'); dirty = true;
    dropUndoBtns(); // 주가 바뀌면 되돌릴 수 없다
    for (const e of ev) onEvent(e);
    for (const g of allGens(game.state)) for (const x of g.editions) if (!eds.has(x.id)) autoLaunched(g, x);
    if (saveSet.every === 'week') autoSave();
    return ev;
  }
  /** 1.3.0 이 개발이 '출시까지 위임'인가(sim의 autoLaunch와 같은 차종 기준) */
  const autoLaunchOn = (p: Project): boolean => { const s = game!.state, id = p.kind === 'fullchange' ? p.targetId : p.kind === 'derivative' ? p.into : Q.nameplateOf(s, p.targetId ?? -1)?.id; return id !== undefined && id !== null && !!s.execs?.genAuto?.[id]?.launch && Q.genAutoInfo(s).available; };
  /** 1.3.0 세대교체 위임으로 자동 출시된 차: 게임을 끊지 않고 알림만. 누르면 그 차의 공개 장면·시승기(페이스리프트는 신문) */
  function autoLaunched(g: Generation, ed: Generation['editions'][number]): void {
    const lift = ed.kind === 'facelift', what = `「${nameOf(g)}」 ${g.number}세대${lift ? ' 페이스리프트' : ''}`;
    toast(`${what}${josa(what, '을/를')} 기획 임원이 출시했습니다(세대교체 위임).${lift ? '' : ` 평론 평균 ${score(g.reviewAvg)}.`}`, 'alert', '위임한 차 출시', 12000, '', { label: lift ? '신문 보기' : '공개 장면·시승기', fn: () => {
      if (!sellingGens(game!.state).includes(g)) { if (lift) showNews(ed.headline ?? '', '', monthOf(ed.launchWeek)); else showReview(g); return; }
      garageAt(g.id); const k = lift ? `e${ed.id}` : g.id; if (!ui.photos[k]) snapPhoto(k);
      launchScene(g, lift ? ed : undefined);
    } }, 'launch');
  }
  /** 출시 공개 장면(설정이 켜져 있고 3D 무대가 있으면) → 평론 창(새 세대) 또는 신문(페이스리프트). 무대에는 그 차가 올라가 있어야 한다 */
  function launchScene(g: Generation, ed?: Generation['editions'][number], rep?: number, news?: string): void {
    const after = () => { if (ed) showNews(ed.headline ?? news ?? '', `${nameOf(g)}${josa(nameOf(g), '이/가')} 새 얼굴로 돌아왔다. 판매가 되살아나고 인지도도 오를 것으로 보인다.`, undefined, undefined, true); else showReview(g, rep); };
    const vn = Q.variantById(g.variant)?.name;
    if (stage && revealWanted(stage)) playReveal({ stage, sheet, body: sheetBody, kind: ed ? 'facelift' : 'new', name: nameOf(g), sub: `${g.number}세대${ed ? ' 페이스리프트' : ''}${vn ? ` · ${vn}` : ''} · ${bodyById(g.body).name} · ${segName(g.segment)}용`, sound: () => sfx('launch'), done: after });
    else after();
  }
  // ----- 0.8.0 자동 저장: 연속 요청은 묶어 한 번(프레임을 끊지 않게), 실패는 한 번만 알림 -----
  let saveTimer = 0, saveFailNoted = false, lastAuto: number | null = null; // lastAuto: 마지막 자동 저장의 게임 주
  function autoSave(now = false): void {
    if (!game || game.state.status !== 'playing') return;
    if (now) { clearTimeout(saveTimer); saveTimer = 0; void saveAuto(); return; }
    if (!saveTimer) saveTimer = window.setTimeout(() => { saveTimer = 0; void saveAuto(); }, 700);
  }
  const notePast = (g: Game) => PN.recordPast(g.state, Q.startYearOf(g.state), yearOfMonth, Date.now()); // 1.5.0 지난 판의 차 이름(이 기기)
  async function saveAuto(): Promise<void> {
    const g = game; if (!g) return;
    notePast(g);
    const week = g.state.week, ok = await S.put('auto', S.makeSave(g, uiSnap()));
    if (ok) { if (g === game) lastAuto = week; if (sync?.id) syncSoon(); return; }
    if (!saveFailNoted) { saveFailNoted = true; toast('자동 저장에 실패했습니다. 브라우저 저장 공간이 부족하거나 저장이 막혀 있습니다. 메뉴에서 파일로 내보내 두세요.', 'bad', '자동 저장', 12000, 'savefail', undefined, 'warning'); }
  }
  // ----- 1.6.0 기기 연동(GitHub 비밀 Gist): 자동 저장 뒤 60초에 한 번까지 올리고, 처음 화면에서 서버 rev가 다르면 불러올지 묻는다. 실패는 메뉴의 한 줄과 알림으로만 -----
  let sync = CL.loadCfg(), syncBusy = false, syncConflict: CL.CloudMeta | null = null, syncChecked = false, syncDev = '';
  const net = (u: string, i?: RequestInit) => fetch(u, i);
  const guessDevice = () => (matchMedia('(pointer: coarse)').matches ? '태블릿' : 'PC');
  const syncTime = (iso: string) => { const t = new Date(iso), p = (n: number) => String(n).padStart(2, '0'); return Number.isNaN(t.getTime()) ? '' : `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`; };
  const metaLine = (m: CL.CloudMeta) => `${m.company}, ${m.date}, ${syncTime(m.at)} 저장`;
  const syncLine = () => !sync ? '연동하지 않았습니다.'
    : syncConflict ? `서버에 다른 기기(${syncConflict.device})의 저장이 있어 올리기를 멈췄습니다(${metaLine(syncConflict)}). 아래에서 고르세요.`
    : syncBusy ? '서버와 주고받는 중입니다.'
    : sync.fail ? `실패: ${sync.fail}. 저장은 이 기기에 남아 있습니다.${sync.last ? ` 마지막으로 올린 시각 ${syncTime(sync.last)}.` : ''}`
    : sync.last ? `마지막으로 올린 시각 ${syncTime(sync.last)}` : '아직 올리지 않았습니다.';
  function syncShow(): void { const b = document.querySelector('.sync-box'); if (b) b.outerHTML = syncBox(); }
  function syncFail(e: unknown): void {
    const why = CL.failText(e);
    if (sync && sync.fail !== why) toast(`${why}. 게임은 그대로 진행되고 저장은 이 기기에 남습니다.`, 'bad', '기기 연동', 9000, 'sync', { label: '메뉴', fn: () => void showMenu() }, 'warning'); // 같은 실패는 한 번만 알린다
    if (sync) { sync.fail = why; CL.saveCfg(sync); }
  }
  /** 자동 저장 칸의 판을 올린다(force: 서버 rev가 달라도 덮어씀) */
  async function syncUp(force = false): Promise<void> {
    if (!sync?.id || syncBusy || (syncConflict && !force)) return;
    syncBusy = true; syncShow();
    try {
      const save = await S.get('auto'); if (!save?.game) return;
      const r = await CL.upload(net, sync, { save, past: PN.loadPast() }, { date: Q.dateLabel(save.game.week), gameVersion: CAR_VERSION }, new Date(), force);
      if (r.conflict) { syncConflict = r.meta; toast(`서버에 다른 기기(${r.meta.device})의 저장이 있어 올리지 않았습니다. 메뉴의 기기 연동에서 고르세요.`, 'alert', '기기 연동', 12000, 'sync', { label: '메뉴', fn: () => void showMenu() }, 'warning'); }
      else syncConflict = null;
      CL.saveCfg(sync);
    } catch (e) { syncFail(e); } finally { syncBusy = false; syncShow(); }
  }
  const syncSoon = CL.throttle(() => void syncUp());
  /** 서버 저장 확인 → 불러올지 묻기. manual: 메뉴의 [서버에서 불러오기](rev가 같아도 묻는다) */
  async function syncCheck(manual: boolean): Promise<void> {
    if (!sync?.id || syncBusy) return;
    let m: CL.CloudMeta;
    try { m = await CL.peek(net, sync); } catch (e) { syncFail(e); syncShow(); return; }
    if (m.rev === 0) { if (manual) toast('서버에 아직 올린 저장이 없습니다.', '', '기기 연동'); return; }
    if (!manual && m.rev === (sync.rev ?? 0)) return;
    if (m.saveVersion > SAVE_VERSION) { toast(CL.NEWER_TEXT, 'bad', '기기 연동', 15000, 'sync'); return; }
    const q = manual ? `서버의 저장(${m.device}: ${metaLine(m)})을 불러올까요?` : `다른 기기(${m.device})의 저장이 더 최신입니다(${metaLine(m)}). 불러올까요?`;
    if (!(await ask(`${q}\n이 기기의 자동 저장은 '연동 전 백업'으로 한 벌 남깁니다.${game && title.hidden && dirty ? ' 지금 판에서 저장하지 않은 진행은 사라집니다.' : ''}`, '불러오기'))) return;
    syncBusy = true; syncShow();
    try {
      const d = await CL.download(net, sync), r = S.parse(d.body.save);
      if (!r.ok) throw new CL.CloudError(r.error);
      const cur = await S.get('auto'); if (cur) await S.put('backup', cur);
      await S.put('auto', d.body.save); PN.mergePast(d.body.past);
      sync.rev = d.meta.rev; sync.fail = undefined; syncConflict = null; CL.saveCfg(sync);
      syncBusy = false; adopt(r.game, r.ui); toast(`${d.meta.device}의 저장을 불러왔습니다(${metaLine(d.meta)}).`, '', '기기 연동', 6000);
    } catch (e) { syncFail(e); }
    syncBusy = false; syncShow();
  }
  /** 메뉴의 기기 연동 칸 */
  function syncBox(): string {
    const dev = `<label class="lbl" for="sy-dev">이 기기 이름</label><input class="namein" id="sy-dev" type="text" maxlength="12" value="${esc(sync?.device ?? (syncDev || guessDevice()))}" autocomplete="off">`;
    return `<div class="sync-box"><p class="lbl sync-h">기기 연동 ${ib('term:기기 연동')}</p>${sync ? `${dev}<p class="hint sync-line">${esc(syncLine())}</p>
      ${syncConflict ? '<div class="row"><button class="btn danger" data-act="syncForce">이 기기 것으로 덮어쓰기</button><button class="btn ink" data-act="syncDown">서버 것 불러오기</button></div>' : ''}
      <div class="row"><button class="btn ink" data-act="syncUp" ${syncBusy ? 'disabled' : ''}>지금 올리기</button><button class="btn" data-act="syncDown" ${syncBusy ? 'disabled' : ''}>서버에서 불러오기</button><button class="btn" data-act="syncOff">연동 끄기</button></div>`
      : `<label class="lbl" for="sy-token">GitHub 토큰(gist 권한)</label><input class="namein" id="sy-token" type="password" autocomplete="off" spellcheck="false">${dev}<button class="btn ink" data-act="syncOn" ${syncBusy ? 'disabled' : ''}>연동 켜기</button><p class="hint sync-line">${esc(syncLine())}</p>`}</div>`;
  }
  const hideSave = () => { if (game && title.hidden && saveSet.every !== 'off') autoSave(true); }; // 탭을 숨기거나 닫을 때
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideSave(); });
  addEventListener('pagehide', hideSave);
  // ----- 0.8.0 연 보고서 -----
  function yearReportDue(y: number): void {
    if (skipping) return; // 개발자 메뉴 1년 건너뛰기 중에는 띄우지 않는다
    const dec = (y + 1) % 10 === 0 ? y - 9 : null; // 0.10.0 10년 회고: 1979·1989·… 12월 결산 뒤(신문을 먼저, 연 보고서는 알림으로)
    if (pauseOn.yearReport && !quietChoice && sheet.hidden && $('#ask').hidden && title.hidden) {
      if (skip) endSkip('');
      if (dec !== null) { showDecade(dec); toast(`${y}년 연 보고서도 나왔습니다.`, 'alert', '연 보고서', 9000, 'year', { label: '보기', fn: () => showYearReport(y) }, 'finance'); } else showYearReport(y);
      return;
    }
    if (dec !== null) toast(`${dec}년대 10년 회고 신문이 나왔습니다. 기록 탭에서도 볼 수 있습니다.`, 'alert', '10년 회고', 9000, 'decade', { label: '보기', fn: () => showDecade(dec) }, 'finance');
    toast(`${y}년 연 보고서가 나왔습니다. 기록 탭에서도 볼 수 있습니다.`, 'alert', '연 보고서', 9000, 'year', { label: '보기', fn: () => showYearReport(y) }, 'finance');
  }
  const pctDiff = (a: number, b: number | null | undefined) => (b === null || b === undefined || !b ? '' : ` <small class="${a >= b ? 'pos' : 'neg'}">전년 대비 ${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / Math.abs(b)) * 100))}%</small>`);
  const amtDiff = (a: number, b: number | null | undefined) => (b === null || b === undefined ? '' : ` <small class="${a >= b ? 'pos' : 'neg'}">전년 대비 ${money(a - b, true)}</small>`);
  /** 0.10.0 10년 회고 신문 창 */
  function showDecade(d: number): void {
    if (!game) return;
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="yr">${I.decadePaper(game.state, d, myLogo(22))}</div>`;
    sheet.hidden = false; renderTop();
  }
  /** 4.0.0 연 보고서의 해외 비중(연 기록) */
  function yearWorld(y: number): string {
    const L = game!.state.years?.[y], w = L?.world; if (!L || !w) return '';
    const ids = Object.keys(w), ov = ids.reduce((a, k) => a + w[k].revenue, 0);
    return `<p class="lbl">해외 <small class="hint">매출의 ${L.revenue > 0 ? Math.round((ov / L.revenue) * 100) : 0}%</small></p><table class="tbl yr-world"><tr><th>권역</th><th class="r">판매</th><th class="r">매출</th><th class="r">이익</th></tr>${ids.map((k) => `<tr><td>${esc(WD.regionName(k))}</td><td class="r">${num(w[k].sold)}대</td><td class="r">${money(w[k].revenue)}</td><td class="r ${w[k].profit >= 0 ? 'pos' : 'neg'}">${money(w[k].profit, true)}</td></tr>`).join('')}</table>`;
  }
  function showYearReport(y: number): void {
    if (!game) return;
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    const r = Q.yearReport(game.state, y), m = r.money, li = (xs: string[], none: string) => (xs.length ? `<ul class="yr-list">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="hint">${none}</p>`);
    const kp = (label: string, v: string, extra: string, cls = '') => `<div class="kpi"><small>${label}</small><b class="${longCls(cls, v)}">${v}</b>${extra}</div>`;
    const money4 = m ? `<div class="kpis yr-kpis">${kp('연 매출', money(m.revenue), pctDiff(m.revenue, r.prev?.revenue))}${kp('연 이익', money(m.profit, true), amtDiff(m.profit, r.prev?.profit), m.profit >= 0 ? 'pos' : 'neg')}${kp('연말 현금', m.cash === null ? '—' : money(m.cash), m.cash === null ? '' : amtDiff(m.cash, r.prevCash))}${kp('판매', `${num(m.sold)}<span>대</span>`, pctDiff(m.sold, r.prev?.sold))}</div>` : '<p class="hint">이 해의 장부가 남아 있지 않습니다.</p>';
    const cars = r.cars.length ? `<table class="tbl yr-cars"><tr><th>차종</th><th class="r">판매</th><th class="r">이익</th></tr>${r.cars.map((c) => `<tr><td>${esc(c.name)}</td><td class="r">${num(c.sold)}대</td><td class="r ${c.profit === null ? '' : c.profit >= 0 ? 'pos' : 'neg'}">${c.profit === null ? '—' : money(c.profit, true)}</td></tr>`).join('')}</table>` : '<p class="hint">이 해에 판 차가 없습니다.</p>';
    const rep = `<p class="yr-rep">평판 <b class="${r.repChange >= 0 ? 'pos' : 'neg'}">${r.repChange >= 0 ? '+' : '−'}${Math.abs(r.repChange).toFixed(1)}</b></p>${r.repReasons.length ? `<table class="tbl"><tr><th>이유</th><th class="r">합계</th></tr>${r.repReasons.slice(0, 8).map((x) => `<tr><td>${esc(x.reason)}</td><td class="r ${x.delta >= 0 ? 'pos' : 'neg'}">${x.delta >= 0 ? '+' : '−'}${Math.abs(x.delta).toFixed(1)}</td></tr>`).join('')}</table>` : '<p class="hint">평판이 바뀐 일이 없습니다.</p>'}`;
    sheetBody.innerHTML = `<div class="yr"><div class="eyebrow"><i></i>${esc(game.state.companyName)} · 연 보고서</div><h2>${y}년 연 보고서</h2>${money4}
      <div class="yr-cols"><section><p class="lbl">차종별 판매와 이익</p>${cars}${r.best ? `<p class="hint">가장 잘 팔린 차: <b>${esc(r.best.name)}</b> ${num(r.best.sold)}대</p>` : ''}
        <p class="lbl">직원</p><p class="hint">직원 ${r.staff}명${r.execs.length ? ` · 임원 ${r.execs.map(esc).join(', ')}` : ' · 임원 없음'}</p>
        <p class="lbl">올해 출시</p>${li(r.launches, '없음')}<p class="lbl">올해 단종</p>${li(r.discontinued, '없음')}<p class="lbl">올해 끝낸 연구</p>${li(r.research, '없음')}</section>
      <section>${yearWorld(y)}<p class="lbl">평판 변화와 이유</p>${rep}<p class="lbl">주요 사건</p>${li(r.events.map(newsLine), '없음')}${r.next.length ? `<p class="lbl">내년에 볼 것</p>${li(r.next, '')}` : ''}</section></div>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  // ----- 0.9.0 월 결산 창: 장부 한 달 그대로(차종별 판매·매출·원가·이익, 지출 내역, 전월 대비). i = 장부 위치(최근 24개월) -----
  function showMonth(i: number): void {
    if (!game) return;
    const s = game.state, led = s.ledger; if (!led.length) return;
    i = Math.max(0, Math.min(led.length - 1, Math.round(i)));
    const L = led[i], P = led[i - 1], ml = (e: typeof L) => `${e.year}년 ${e.monthOfYear}월`;
    const hqOf = (e: typeof L) => e.upkeepHq ?? Math.min(e.upkeep, Q.hqInfo(s).current.upkeep); // 0.5.1 전 장부는 지금 본사 유지비로 나눈다(재무 화면과 같게)
    // 지출 줄: [이름, 이번 달, 전월]. 임원·연구는 0.9.0부터 장부에 따로 있다(예전 달은 월급·일회성에 들어 있음)
    const costs = (e: typeof L): [string, number][] => [['차 원가', e.cogs], [e.execPay === undefined ? '직원·임원 월급' : '직원 월급', e.salaries - (e.execPay ?? 0)], ['임원 월급', e.execPay ?? 0], ['본사 유지비', hqOf(e)], [s.batteryPlant.level || s.batteryPlant.build ? '공장 유지비(배터리 공장 포함)' : '공장 유지비', e.upkeep - hqOf(e)],
      ['개발비', e.dev], ['광고비', e.marketing], ['연구 시작 비용', e.research ?? 0], ['대출 이자', e.interest], ['리콜', e.recall], ['자회사 투자(설립·추가 투자)', e.subInv ?? 0], ['관세', e.tariff ?? 0], ['운송비', e.ship ?? 0], ['판매 법인 유지비', e.worldUpkeep ?? 0], ['해외 진출·판매 법인 투자', e.worldInv ?? 0], ['일회성 지출(채용 공고·교육·퇴직금·승급·건설 등)', (e.oneOff || 0) - (e.research ?? 0) - (e.subInv ?? 0) - (e.worldInv ?? 0)]]; // 4.0.0 해외 항목
    const cur = costs(L), prev = P ? costs(P) : null;
    const dd = (a: number, b: number | undefined, cost = false) => b === undefined ? '<td class="r d">—</td>' : Math.round(a - b) === 0 ? '<td class="r d">±0</td>' : `<td class="r d ${(a > b) !== cost ? 'pos' : 'neg'}">${money(a - b, true)}</td>`;
    const kp = (label: string, v: string, a: number, b: number | undefined, cls = '') => `<div class="kpi"><small>${label}</small><b class="${longCls(cls, v)}">${v}</b>${b === undefined ? '' : `<small class="${a >= b ? 'pos' : 'neg'}">전월 대비 ${label === '판매' ? `${a - b >= 0 ? '+' : '−'}${num(Math.abs(a - b))}대` : money(a - b, true)}</small>`}</div>`;
    const wSold = (e: typeof L) => e.sold + Object.values(e.world ?? {}).reduce((a, x) => a + x.sold, 0); // 4.0.0 국내 + 수출
    const cars = L.cars?.length ? `<table class="tbl mon-cars"><tr><th>차종</th><th class="r">판매</th><th class="r">매출</th><th class="r">${L.world ? '원가(관세·운송 포함)' : '원가'}</th><th class="r">광고·리콜</th><th class="r">이익</th><th class="r">전월 대비</th></tr>${L.cars.map((c) => {
        const g = Q.generationById(s, c.id), pr = c.revenue - c.cogs - c.marketing - c.recall - (c.exp?.landed ?? 0), pc = P?.cars?.find((x) => x.id === c.id), pp = pc ? pc.revenue - pc.cogs - pc.marketing - pc.recall - (pc.exp?.landed ?? 0) : undefined;
        return `<tr><td>${g ? `${esc(nameOf(g))} <small class="hint">${g.number}세대</small>` : '단종한 차'}</td><td class="r">${num(c.sold + (c.exp?.sold ?? 0))}대${c.exp ? `<br><small class="hint">수출 ${num(c.exp.sold)}</small>` : ''}</td><td class="r">${money(c.revenue)}</td><td class="r">${money(c.cogs + (c.exp?.landed ?? 0))}</td><td class="r">${money(c.marketing + c.recall)}</td><td class="r ${pr >= 0 ? 'pos' : 'neg'}">${money(pr, true)}</td>${dd(pr, pp)}</tr>`; }).join('')}</table>`
      : `<p class="hint">${L.cars ? '이 달에는 판 차가 없습니다.' : '이 달은 0.9.0 전 장부라 차종별 내역이 없습니다.'}</p>`;
    const rows = cur.filter(([, v], k) => v || (prev?.[k][1] ?? 0)).map(([n, v]) => { const k = cur.findIndex((x) => x[0] === n); return `<tr><td>${n}</td><td class="r">${money(v)}</td>${dd(v, prev?.[k][1], true)}</tr>`; }).join('');
    const nav = `<div class="row mon-nav"><button class="btn" data-act="monthOpen" data-v="${i - 1}" ${i > 0 ? '' : 'disabled'}>‹ 이전 달</button><button class="btn" data-act="monthOpen" data-v="${i + 1}" ${i < led.length - 1 ? '' : 'disabled'}>다음 달 ›</button><button class="btn ink" data-act="closeSheet">닫기</button></div>`;
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="mon"><div class="eyebrow"><i></i>${esc(s.companyName)} · 월 결산</div><h2>${ml(L)} 결산${P ? ` <small class="hint">전월(${ml(P)})과 비교</small>` : ''}</h2>
      <div class="kpis mon-kpis">${kp('판매', `${num(wSold(L))}<span>대</span>`, wSold(L), P ? wSold(P) : undefined)}${kp('매출', money(L.revenue), L.revenue, P?.revenue)}${kp('이익', money(L.profit, true), L.profit, P?.profit, L.profit >= 0 ? 'pos' : 'neg')}${kp('월말 현금', money(L.cash), L.cash, P?.cash, L.cash < 0 ? 'neg' : '')}</div>
      <div class="mon-cols"><section><p class="lbl">차종별 판매와 이익</p>${cars}<p class="note">차종 이익 = 매출 − 원가 − 광고 − 리콜${L.world ? ' − 관세·운송비' : ''}(직원 월급·유지비·개발비 전).</p>${L.world ? monWorld(L, P) : ''}</section>
      <section><p class="lbl">지출 내역</p><table class="tbl mon-costs"><tr><th>항목</th><th class="r">금액</th><th class="r">전월 대비</th></tr><tr><td>판매 수입</td><td class="r pos">${money(L.revenue)}</td>${dd(L.revenue, P?.revenue)}</tr>${L.subDiv !== undefined ? `<tr class="mon-subdiv"><td>자회사 배당</td><td class="r pos">${money(L.subDiv ?? 0)}</td>${dd(L.subDiv ?? 0, P ? P.subDiv ?? 0 : undefined)}</tr>` : ''}${rows}<tr class="sum"><td>이익</td><td class="r ${L.profit >= 0 ? 'pos' : 'neg'}">${money(L.profit, true)}</td>${dd(L.profit, P?.profit)}</tr></table></section></div>${nav}</div>`;
    sheet.hidden = false; renderTop();
  }
  /** 4.0.0 월 결산의 해외 권역 표 */
  function monWorld(L: Game['state']['ledger'][number], P?: Game['state']['ledger'][number]): string {
    const w = L.world!, ids = Object.keys(w);
    return `<p class="lbl" style="margin-top:10px">해외 권역 <small class="hint">해외 매출 ${money(ids.reduce((a, k) => a + w[k].revenue, 0))} · 전체의 ${Math.round(WD.overseasShare(L.revenue, w) * 100)}%</small></p><div class="tblwrap"><table class="tbl mon-world"><tr><th>권역</th><th class="r">판매</th><th class="r">매출</th><th class="r">관세·운송</th><th class="r">법인 유지비</th><th class="r">이익</th><th class="r">전월 대비</th></tr>${ids.map((k) => { const x = w[k], p = P?.world?.[k]; return `<tr><td>${esc(WD.regionName(k))}</td><td class="r">${num(x.sold)}대</td><td class="r">${money(x.revenue)}</td><td class="r">${money(x.tariff + x.ship)}</td><td class="r">${money(x.upkeep)}</td><td class="r ${x.profit >= 0 ? 'pos' : 'neg'}">${money(x.profit, true)}</td><td class="r d">${p ? money(x.profit - p.profit, true) : '—'}</td></tr>`; }).join('')}</table></div><p class="note">권역 이익 = 매출 − 원가 − 관세 − 운송비 − 판매 법인 유지비.</p>`;
  }
  function onEvent(e: GameEvent): void {
    const s = game!.state, reg = e.kind === 'news' && (e.category === 'regulation' || (e.category === 'preview' && e.text.includes('규제')));
    const tp: NoteCat = reg ? 'warning' : Q.eventTopic(e), fx = (n: Sfx) => { if (noteOn(tp)) sfx(n); }; // 1.3.0 끈 유형은 효과음도 내지 않는다
    switch (e.kind) {
      case 'execReport': break; // 보고는 튀어나오지 않는다: 월 결산 알림 한 줄과 '할 일' 배지로만
      case 'replacement': toast(e.text, '', '임원', 7000, '', undefined, tp); break;
      case 'monthEnd': {
        const L = s.ledger[s.ledger.length - 1];
        if (L) { const m = L.month; toast(`판매 ${num(L.sold)}대 · 이익 ${money(L.profit, true)} · 현금 ${money(L.cash)}${weekReports ? ` · 임원 보고 ${weekReports}건` : ''}`, '', `${L.year}년 ${L.monthOfYear}월 결산`, 6000, 'month', { label: '펼쳐 보기', fn: () => showMonth(s.ledger.findIndex((x) => x.month === m)) }, tp); } // 0.9.0 누르면 월 결산 창(기록함에서 눌러도 그달)
        // 큰 흑자 = 10억 이상이면서 최근 24개월 최고 이익인 달(늘 버는 후반에 매달 울리지 않게)
        fx(L && L.profit >= 100000 && s.ledger.every((x) => x.profit <= L.profit) ? 'cashIn' : 'monthClose');
        if (L && (saveSet.every === 'month' || (saveSet.every === 'quarter' && L.monthOfYear % 3 === 0))) autoSave(); // 매주는 tickOnce에서
        if (L?.monthOfYear === 12) yearReportDue(L.year);
        break;
      }
      case 'designDone': fx('designDone'); toast(e.text, 'alert', '설계 끝', 9000, '', { label: '개발 화면', fn: () => go('dev') }, tp); officeEvents.push({ kind: 'say', text: '설계 끝났어요. 이제 시험입니다', mood: 'test' }); break;
      case 'devWeek': { // 알림으로 띄우지 않고 사무실 연출로. 여러 주가 한 번에 지나면 마지막 주 점수·결함만(글자가 겹치지 않게)
        if (weekFresh) { const keep = officeEvents.filter((x) => x.kind === 'say'); officeEvents.length = 0; officeEvents.push(...keep); weekFresh = false; }
        officeEvents.push(...officeFromWeek(e));
        break;
      }
      case 'company': if (e.text.startsWith('공장')) fx('factoryBuilt'); toast(moneyText(e.text), 'alert', '회사', 7000, '', { label: '회사 화면', fn: () => goCo('sum') }, tp); break;
      case 'news': { // 규제 예고·시행은 중요한 알림(오래 둔다)
        const k = e.category ?? 'other', pid = e.id;
        if (reg || k === 'start' || k === 'end' || k === 'preview') fx(reg ? 'regulation' : 'event');
        if (tp === 'dev') { toast(e.text, 'alert', '직원 성과', 9000, '', pid !== undefined && Q.projectById(s, pid) ? { label: '개발 화면', fn: () => { devSel = pid; go('dev'); } } : undefined, tp); break; } // 1.3.0 개발 중 직원 성과
        { const wk = s.week; toast(newsLine(e.text).replace(/^자동 승인: /, ''), 'alert', tp === 'auto' ? '자동 승인' : NEWS_KIND[k], reg ? 15000 : 9000, '', { label: '신문 보기', fn: () => showNewsItem(e.text, wk, k) }, tp); } break;
      }
      case 'choice': // 화면 안 창이 떠 있는 동안 시간이 멈춘다. 자동 멈춤을 끄면 창 대신 알림만
        if (quietChoice) break;
        fx('event');
        if (!pauseOn.choice) toast(newsLine(e.text), 'alert', '결정 대기', 12000, 'choice', { label: '결정하기', fn: () => showChoice() }, 'choice');
        else if (sheet.hidden && $('#ask').hidden && title.hidden) showChoice();
        break;
      case 'advice': { // 출시 대기가 된 주의 안내는 눈에 띄게, 누르면 출시 준비 화면
        const w = s.projects.find((p) => p.waiting && !waitSeen.has(p.id));
        if (w?.auto && autoLaunchOn(w)) { waitSeen.add(w.id); break; } // 1.3.0 출시까지 위임한 개발: 다음 주에 기획 임원이 출시하므로 멈추지 않는다
        if (w) { waitSeen.add(w.id); sfx('readyToLaunch'); autoPause('ready', e.text, `「${w.name}」 출시 대기`, { label: '출시 준비', fn: () => openLaunch(w.id) }); }
        else toast(e.text, 'alert', '조언', 9000, '', undefined, tp);
        break;
      }
      case 'recall': fx('recall'); toast(moneyText(e.text), 'bad', '리콜', 12000, '', { label: '차고', fn: () => garageAt() }, tp); break;
      case 'unlock': fx('researchDone'); toast(e.text, 'alert', '연구 완료', 9000, '', { label: '연구 화면', fn: () => go('research') }, tp); break;
      case 'cashWarning': fx('warning'); toast(`${e.text}${s.loan.bailoutUsed ? '' : ' 재무 화면에서 대출이나 구제 금융을 받을 수 있습니다.'}`, 'bad', '현금 경고', 12000, '', { label: '재무 화면', fn: () => go('fin') }, tp); break;
      case 'discontinued': toast(e.text, '', '단종', 4000, '', undefined, tp); break;
      case 'reputation': toast(`${e.reason}: ${repWord(e.delta)}`, '', '평판', 5000, '', undefined, tp); break; // 이유를 앞에: "「아리아」 리콜: 평판 −1.5"
      case 'gameOver': sfx('bankrupt'); break; // render()에서 파산 화면을 띄운다
    }
  }
  function logDev(): void {
    const s = game!.state;
    for (const p of s.projects) {
      const pv = devGrades(p);
      if (!pv) continue;
      // 페이스리프트는 판매 중인 판의 등급이 출시 전까지 그대로라, 대신 이번 리프트에 쌓인 디자인 점수를 보인다
      const fl = p.kind === 'facelift', val = fl ? p.points.D : pv.avg, prev = devPrev.get(p.id) ?? 0, d = val - prev, list = devLog.get(p.id) ?? [];
      const phase = p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`;
      const what = fl ? `디자인 점수 ${num(val)}${p.phase === 'design' ? ` (+${num(d)})` : ''}` : `등급 ${score(pv.avg)}${p.phase === 'design' ? ` (${d >= 0 ? '+' : '−'}${score(Math.abs(d))})` : ''}`;
      list.unshift(`${Q.dateLabel(s.week)} · ${phase} · ${what} · 결함 약 ${p.defectEst}개`);
      devLog.set(p.id, list.slice(0, 14)); devPrev.set(p.id, val);
    }
  }
  function setSpeed(v: number): void { if (v !== SKIP_SPEED) skip = null; speed = v; acc = 0; sound.setTempo(v >= 4 ? 3 : v >= 2 ? 2 : v >= 1 ? 1 : 0); renderTop(); }
  /** 자동 멈춤(설정에서 항목별로 끔): 알림은 늘 띄우고, 켜져 있으면 시간을 멈춘다 */
  function autoPause(k: PauseKey, text: string, head: string, open?: { label: string; fn: () => void }): void {
    const stop = pauseOn[k] && speed > 0 && !skipPause;
    if (stop) setSpeed(0);
    toast(`${text}${stop ? ' 시간을 멈췄습니다.' : ''}`, 'alert', head, 20000, `pause-${k}`, open, stop ? 'pauseStop' : 'pause');
  }
  /** 새 채용 후보가 오면 알림(+자동 멈춤). 기한 안에 채용하지 않으면 후보가 떠난다 */
  function watchCands(): void {
    const s = game!.state, fresh = s.candidates.filter((c) => !candSeen.has(c.id));
    if (!fresh.length) return;
    for (const c of fresh) candSeen.add(c.id);
    const wk = Math.max(1, Math.min(...fresh.map((c) => c.expiresWeek)) - s.week);
    autoPause('cands', `${ROLE_NAME[fresh[0].role]} 후보 ${fresh.length}명이 왔습니다. ${wk}주 안에 채용하지 않으면 다른 회사로 갑니다.`, '채용 후보', screen === 'company' && coTab === 'staff' ? undefined : { label: '채용 화면', fn: () => goCo('staff') }); // 이미 채용 화면이면 바로 가기 버튼 없이
  }

  // ---------- 0.7.0 할 일 목록 · 다음 일까지 ----------
  let todoMemo: { g: Game; k: string; list: Q.TodoItem[] } | null = null;
  /** 할 일 목록(한 주·명령마다 한 번 계산) */
  const todos = (): Q.TodoItem[] => {
    const s = game!.state, k = `${s.week}:${s.history.length}:${s.cash}:${s.candidates.length}:${s.projects.length}:${s.events.pending.length}:${s.staff.length}:${execUnread(s)}`;
    if (todoMemo?.g !== game || todoMemo.k !== k) todoMemo = { g: game!, k, list: Q.todoItems(s) };
    return todoMemo.list;
  };
  /** 다음 일까지: seen = 시작할 때와 진행 중에 이미 본 할 일 키(새 키가 생기면 멈춤) */
  let skip: { seen: Set<string>; from: number } | null = null;
  function startSkip(): void {
    if (!game || game.state.status !== 'playing') return;
    if (skip) { setSpeed(0); toast('진행을 멈췄습니다.', '', '다음 일까지', 3000, 'skip'); return; } // 진행 중 다시 누르면 중단
    if (isHeld()) return;
    skip = { seen: new Set(todos().map((t) => t.key)), from: game.state.week }; closeDrawer(); // 진행 중에는 서랍을 닫는다
    setSpeed(SKIP_SPEED);
  }
  function endSkip(text: string, open?: { label: string; fn: () => void }): void { setSpeed(0); if (text) toast(text, 'alert', '다음 일까지 · 멈춤', 9000, 'skip', open); }
  /** 자동 멈춤을 꺼 둔 항목(채용 후보·출시 대기·결정할 사건)은 새로 생겨도 멈추지 않는다 */
  const skipStops = (k: Q.TodoKind) => !todoMute.has(k) && (!(k === 'cands' || k === 'ready' || k === 'choice') || pauseOn[k]); // 1.0.0 '다시 알리지 않기'한 종류에서는 멈추지 않는다
  /** 한 주 진행 뒤 멈춤 조건. 자동 멈춤(출시 대기·채용 후보)과 사건 창은 이미 시간을 멈춰 skip이 풀린 상태로 온다 */
  function skipCheck(ev: GameEvent[]): void {
    const s = game!.state, sk = skip!;
    if (s.status !== 'playing') { setSpeed(0); return; }
    if (ev.some((e) => e.kind === 'cashWarning')) { endSkip(''); return; } // 현금 경고 알림이 이미 떴다
    if (weekReports) { endSkip(`임원 보고 ${weekReports}건이 왔습니다.`, { label: '보고 보기', fn: () => showTodo('reports') }); return; }
    const list = todos(), fresh = list.find((t) => !sk.seen.has(t.key) && skipStops(t.kind));
    for (const t of list) sk.seen.add(t.key);
    if (fresh) { endSkip(`${fresh.title}.`, { label: '할 일 보기', fn: () => showTodo('todo') }); return; }
    if (s.week - sk.from >= SKIP_MAX_WEEKS) endSkip('2년 동안 새로 할 일이 없어 멈췄습니다.');
  }

  // ----- 할 일·보고 창 -----
  const execReports = Q.execReports, execUnread = Q.execUnread;
  const hasExec = (s: Game['state']): boolean => Q.execInfo(s).used > 0;
  const EXEC_ROLE = (r: ExecReport['role']) => Q.EXEC_TITLE[r].replace(/ 임원$/, ''); // 필터 칩: "인사", "연구소장"
  const execTitle = (r: ExecReport['role']) => Q.EXEC_TITLE[r];
  let todoTab: 'todo' | 'reports' | 'notes' = 'todo', repRole: ExecReport['role'] | '' = '', repFresh = new Set<number>(); // repFresh: 이번에 열기 전까지 읽지 않았던 보고(읽음 처리 뒤에도 표시)
  const REP_STATUS: Record<NonNullable<ExecReport['replacement']>['status'], string> = { proposed: '승인을 기다립니다', approved: '승인함 · 곧 진행합니다', waiting: '예약됨 · 기다리는 중', done: '진행했습니다', cancelled: '취소했습니다', failed: '진행하지 못했습니다' };
  function reportCard(r: ExecReport): string {
    const rp = r.replacement, when = Q.monthLabel(monthOf(r.week));
    const on = rp && (rp.status === 'approved' || rp.status === 'waiting'), wf = rp?.waitingFor ?? ''; // waitingFor: "「아리아」 개발이 끝나면", "현금이 늘면", "4주 뒤 다시 공고"
    const st = rp ? `<p class="rep-st">${on && wf ? esc(wf.endsWith('면') ? `${wf} 진행합니다` : `예약됨 · ${wf}`) : REP_STATUS[rp.status]}${on ? ` · 능력 ${rp.minAbility} 이상 후보면 다시 묻지 않고 뽑습니다` : ''}</p>` : '';
    const btns = [r.goto ? `<button class="btn" data-act="repGo" data-id="${r.id}">해당 화면으로</button>` : '',
      rp?.status === 'proposed' ? `<button class="btn ink" data-act="repOk" data-id="${rp.id}">승인</button><button class="btn" data-act="repNo" data-id="${rp.id}">거절</button>` : '',
      rp && (rp.status === 'approved' || rp.status === 'waiting') ? `<button class="btn danger" data-act="repCancel" data-id="${rp.id}">예약 취소</button>` : '',
      `<button class="btn" data-act="repClose" data-id="${r.id}">이 보고 닫기</button>`].join('');
    return `<div class="rep-card${r.auto ? ' auto' : ''}${repFresh.has(r.id) ? ' unread' : ''}" data-id="${r.id}"><div class="rep-h"><b>${esc(execTitle(r.role))} ${esc(r.execName)}</b><small>${esc(when)}${r.auto ? ' · 위임한 일 기록' : ''}${repFresh.has(r.id) ? ' · 새 보고' : ''}</small></div>
      <h3>${esc(r.title)}</h3><p>${esc(r.text)}</p>${r.facts.length ? `<ul class="rep-facts">${r.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}${st}<div class="row">${btns}</div></div>`;
  }
  // ----- 1.0.0 할 일 서랍: 급한 일 / 지금 할 수 있는 일 / 참고(접힘), '나중에'(다음 달까지 숨김), '다시 알리지 않기'(종류별, 설정 → 알림에서 되돌림) -----
  const TODO_MUTE_KEY = 'car-company-todomute';
  const todoMute = new Set<string>((() => { try { const a = JSON.parse(localStorage.getItem(TODO_MUTE_KEY) ?? '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; } })());
  const todoSnooze = new Map<string, number>(); // 항목 키 → 이 달(포함)까지 숨김. 화면 메모리에만(불러오면 다시 보인다)
  const REF_KINDS = new Set<string>(['exec', 'team', 'research', 'hire']); // 늘 떠 있는 참고 항목
  const NO_MUTE = new Set<string>(['choice', 'cash', 'ready', 'regulation']); // 끌 수 없는 종류
  const TODO_TAG: Record<Q.TodoKind, string> = { choice: '결정', ready: '출시', cands: '채용', cash: '현금', regulation: '규제', reports: '보고', exec: '임원', retrofit: '장비', capacity: '생산', equip: '장비', facelift: '얼굴', fullchange: '세대', team: '개발', research: '연구', tired: '휴식', hire: '정원' };
  const TODO_KIND_NAME: Record<Q.TodoKind, string> = { choice: '결정할 사건', ready: '출시 대기', cands: '채용 후보', cash: '현금 마이너스', regulation: '규제', reports: '임원 보고', exec: '빈 임원 자리', retrofit: '의무 장비', capacity: '생산 한도', equip: '장비 기대 미달', facelift: '페이스리프트 적기', fullchange: '풀체인지', team: '빈 개발팀', research: '빈 연구 칸', tired: '지친 직원', hire: '정원 여유' };
  /** 서랍·배지에 보이는 할 일(숨긴 것 빼고) */
  const shownTodos = () => { const m = monthOf(game!.state.week); return todos().filter((t) => !todoMute.has(t.kind) && !((todoSnooze.get(t.key) ?? -1) >= m)); };
  /** 배지 숫자: 급한 일 + 지금 할 수 있는 일(참고 제외) */
  const todoCount = () => shownTodos().filter((t) => t.urgent || !REF_KINDS.has(t.kind));
  let refOpen = false, autoOpen = false;
  function todoBody(): string {
    const all = todos(), list = shownTodos(), hid = all.length - list.length;
    const row = (t: Q.TodoItem) => `<div class="todo-row${t.urgent ? ' urgent' : ''}"><button class="todo-it${t.urgent ? ' urgent' : ''}" data-act="todoGo" data-k="${esc(t.key)}" data-kind="${t.kind}"><span class="ti t-${t.kind}" aria-hidden="true">${TODO_TAG[t.kind]}</span><span class="tt"><b>${esc(t.title)}</b><small>${esc(t.detail)}</small></span><span class="tg" aria-hidden="true">→</span></button>
      <div class="todo-acts">${t.kind === 'choice' ? '' : `<button class="tl" data-act="todoLater" data-k="${esc(t.key)}">나중에</button>`}${NO_MUTE.has(t.kind) ? '' : `<button class="tl" data-act="todoMute" data-v="${t.kind}">다시 알리지 않기</button>`}</div></div>`;
    const urgent = list.filter((t) => t.urgent), now = list.filter((t) => !t.urgent && !REF_KINDS.has(t.kind)), ref = list.filter((t) => !t.urgent && REF_KINDS.has(t.kind));
    const grp = (title: string, xs: Q.TodoItem[]) => (xs.length ? `<p class="lbl todo-g">${title} ${xs.length}</p><div class="todo-list">${xs.map(row).join('')}</div>` : '');
    const refs = ref.length ? `<details class="todo-ref"${refOpen ? ' open' : ''}><summary><span class="lbl">참고 ${ref.length}</span><small>늘 있는 여유(빈 자리·칸·정원)</small></summary><div class="todo-list">${ref.map(row).join('')}</div></details>` : '';
    const more = hid ? `<p class="hint todo-hid">숨긴 항목 ${hid}개${todoSnooze.size ? ' · <button class="lnk" data-act="todoUnsnooze">나중에로 숨긴 것 다시 보기</button>' : ''}${todoMute.size ? ' · 다시 알리지 않는 종류는 메뉴 → 설정 → 알림에서 되돌립니다' : ''}</p>` : '';
    const al = autoLogHtml(), autos = al ? `<details class="todo-ref todo-auto"${autoOpen ? ' open' : ''}><summary><span class="lbl">최근 자동 승인</span><small>결정 창 없이 처리한 결정</small></summary>${al}<button class="lnk" data-act="autoSettings">설정 › 결정</button></details>` : ''; // 3.7.0
    if (!urgent.length && !now.length && !ref.length) return `<p class="todo-empty">지금 할 일이 없습니다. 시간을 진행하세요.</p>${autos}${more}`;
    return grp('급한 일', urgent) + grp('지금 할 수 있는 일', now) + (urgent.length || now.length ? '' : '<p class="todo-empty small">급한 일과 지금 할 일은 없습니다.</p>') + refs + autos + more;
  }
  function reportsBody(): string {
    const s = game!.state, all = execReports(s);
    if (!hasExec(s) && !all.length) return '<div class="todo-empty rep-none"><p>임원을 두면 제안을 받을 수 있습니다.</p><button class="btn ink" data-act="todoGoCo" data-v="exec">임원 화면</button></div>';
    const roles = [...new Set(all.map((r) => r.role))], list = all.filter((r) => !repRole || r.role === repRole);
    const chips = roles.length > 1 ? `<div class="seg rep-roles" role="tablist" aria-label="임원별">${[['', '전체'] as const, ...roles.map((r) => [r, EXEC_ROLE(r)] as const)].map(([k, n]) => `<button role="tab" data-act="repRole" data-v="${k}" aria-selected="${repRole === k}">${n}</button>`).join('')}</div>` : '';
    return chips + (list.length ? `<div class="rep-list">${list.map(reportCard).join('')}</div>` : '<p class="todo-empty">아직 받은 보고가 없습니다. 임원은 월 결산 때 보고합니다.</p>');
  }
  /** 할 일·보고 창. 보고 탭을 열면 읽음 처리(이번에 새로 온 것은 창을 닫을 때까지 '새 보고'로 표시) */
  /** 1.0.0 지난 알림 기록함(최근 100건): 날짜·종류, 누르면 그 알림의 화면으로 */
  let noteTopic: NoteCat | '' = ''; // 1.3.0 알림 기록을 유형으로 거르기
  function notesBody(): string {
    const setBtn = '<button class="btn" data-act="noteSettings">알림 설정</button>';
    if (!noteLog.length) return `<p class="todo-empty">아직 지난 알림이 없습니다. 월 결산·평판 변화·사건 같은 알림이 여기 쌓입니다.</p><div class="row end">${setBtn}</div>`;
    const cats = NOTE_CATS.map(([k]) => k).filter((k) => noteLog.some((x) => x.cat === k));
    if (noteTopic && !cats.includes(noteTopic)) noteTopic = '';
    const chips = `<div class="note-bar"><div class="s-chips note-cats" role="group" aria-label="알림 유형으로 거르기">${[['', '전체'] as [NoteCat | '', string], ...cats.map((k): [NoteCat | '', string] => [k, catName(k)])].map(([k, n]) => `<button class="s-chip" data-act="noteTopic" data-v="${k}" aria-pressed="${noteTopic === k}">${esc(n)}${k && !noteOn(k) ? '<small>끔</small>' : `<small>${noteLog.filter((x) => !k || x.cat === k).length}</small>`}</button>`).join('')}</div>${setBtn}</div>`;
    const row = (x: NoteLog) => { const go = !!x.open, tag = `<span class="chip n-${x.cat}">${esc(catName(x.cat))}</span>`, body = `<span class="nt-t"><b>${esc(x.head)}</b><small>${esc(x.text)}</small></span>`;
      return go ? `<button class="note-it${x.id > noteSeen ? ' new' : ''}" data-act="noteGo" data-v="${x.id}"><small class="nd">${esc(Q.dateLabel(x.week))}</small>${tag}${body}<span class="ng">${esc(x.open!.label)} →</span></button>`
        : `<div class="note-it${x.id > noteSeen ? ' new' : ''}"><small class="nd">${esc(Q.dateLabel(x.week))}</small>${tag}${body}<span class="ng"></span></div>`; };
    return `${chips}<div class="note-list">${noteLog.filter((x) => !noteTopic || x.cat === noteTopic).map(row).join('')}</div><p class="note">최근 ${noteLog.length}건(최대 100건)입니다. 끈 유형의 알림도 여기에는 남습니다. 알림 유형은 [알림 설정](메뉴 → 설정 → 알림)에서 켜고 끕니다. 게임을 불러오면 비워집니다.</p>`;
  }
  function showTodo(t: 'todo' | 'reports' | 'notes' = todoTab): void {
    if (!game) return;
    const s = game.state;
    if (t === 'reports' && todoTab !== 'reports') repFresh = new Set(execReports(s).filter((r) => r.unread).map((r) => r.id));
    todoTab = t;
    if (t === 'reports' && execUnread(s) > 0) game.command({ type: 'markReportsRead' });
    const n = todoCount().length, un = execUnread(s), nn = noteLog.filter((x) => x.id > noteSeen).length;
    const y = t === todoTab && !drawer.hidden ? drawer.querySelector('.drawer-body')?.scrollTop ?? 0 : 0;
    drawer.innerHTML = `<div class="todo-sheet"><div class="drawer-h"><div class="eyebrow"><i></i>${esc(game.dateLabel)}</div><button class="btn drawer-x" data-act="drawerClose" aria-label="할 일 닫기">닫기</button></div><div class="seg todo-tabs" role="tablist" aria-label="할 일·보고·알림"><button role="tab" data-act="todoTab" data-v="todo" aria-selected="${t === 'todo'}">할 일 ${n}</button><button role="tab" data-act="todoTab" data-v="reports" aria-selected="${t === 'reports'}">보고${un ? ` ${un}` : ''}</button><button role="tab" data-act="todoTab" data-v="notes" aria-selected="${t === 'notes'}">알림${nn && t !== 'notes' ? ` ${nn}` : ''}</button></div>
      <div class="drawer-body">${t === 'todo' ? todoBody() : t === 'reports' ? reportsBody() : notesBody()}</div></div>`;
    if (t === 'notes') noteSeen = noteId; // 열었으면 읽음(이번 창에서는 '새' 표시 유지)
    drawer.hidden = false; drawerHtml = t === 'todo' ? todoBody() : ''; const bd = drawer.querySelector<HTMLElement>('.drawer-body'); if (bd) bd.scrollTop = y;
    renderTop();
  }
  /** 1.0.0 오른쪽 서랍(할 일·보고·알림): 시간은 멈추지 않는다. 바깥을 누르거나 항목으로 이동하면 닫힌다 */
  const drawer = document.createElement('aside');
  drawer.id = 'drawer'; drawer.className = 'drawer'; drawer.hidden = true; drawer.setAttribute('aria-label', '할 일·보고·알림');
  document.body.append(drawer);
  let drawerHtml = ''; // 할 일 탭 내용(바뀔 때만 다시 그린다)
  const closeDrawer = () => { if (drawer.hidden) return; drawer.hidden = true; todoTab = 'todo'; renderTop(); };
  /** 주가 지나 할 일이 바뀌면 열린 서랍의 할 일 목록만 고친다 */
  function refreshDrawer(): void {
    if (drawer.hidden || todoTab !== 'todo' || !game) return;
    const h = todoBody(); if (h === drawerHtml) return;
    showTodo('todo');
  }
  document.addEventListener('pointerdown', (e) => { const t = e.target as Element; if (!drawer.hidden && !drawer.contains(t) && !t.closest('#todobtn, #ask, #sheet, #tip')) closeDrawer(); }, true);
  drawer.addEventListener('toggle', (e) => { const d = e.target as HTMLDetailsElement; if (d.matches('details.todo-auto')) autoOpen = d.open; else if (d.matches('details.todo-ref')) refOpen = d.open; }, true);
  /** 할 일·보고의 바로 가기 */
  function goTarget(t: { tab: string; sub?: string; id?: number }): void {
    if (!game) return;
    const s = game.state; sheet.hidden = true; closeDrawer(); todoTab = 'todo';
    switch (t.tab) {
      case 'garage': garageAt(t.id); return;
      case 'dev':
        if (t.sub === 'launch' && t.id !== undefined && Q.projectById(s, t.id)) { openLaunch(t.id); return; }
        if (t.sub === 'plan') { void act('plan', document.createElement('i')); return; }
        if (t.id !== undefined && Q.projectById(s, t.id)) devSel = t.id;
        go(devScreen()); return;
      case 'company': goCo(t.sub, t.id); return;
      case 'records': go('records'); return;
      case 'choice': showChoice(); return;
      case 'reports': showTodo('reports'); return;
      default: go(screen);
    }
  }

  /** 회사 안쪽 화면으로 이동하는 한 곳. 0.9.0: 연구·재무는 큰 메뉴로 나갔으므로 예전 이동({company, research|fin})은 그 화면으로. 직원 대상이면 그 직원을 고른(자세히 열린) 상태로 */
  function goCo(sub = 'staff', id?: number): void {
    if (sub === 'research' || sub === 'fin') { go(sub); return; }
    coTab = CO_TABS.some(([k]) => k === sub) ? sub as CoTab : 'staff';
    if (coTab === 'staff' && id !== undefined && game?.state.staff.some((x) => x.id === id)) staffSel = id;
    go('company');
    if (coTab === 'staff' && id !== undefined && staffSel === id) document.getElementById('staff-card')?.scrollIntoView({ block: 'nearest' });
  }

  let last = performance.now(), frames = 0, fps = 0, fpsT = last;
  function frame(now: number): void {
    requestAnimationFrame(frame);
    const dt = Math.min(250, now - last); last = now;
    frames++; if (now - fpsT >= 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; renderDebug(); }
    if (isHeld() || speed === 0) { acc = 0; if (skip) setSpeed(0); return; } // 창이 뜨면(선택 사건 등) [다음 일까지]도 끝
    acc = skip ? WEEK_MS * MAX_TICKS_PER_FRAME : acc + dt * speed; // 다음 일까지: 프레임마다 tick 상한만큼(화면 갱신은 유지)
    let n = 0;
    batched(() => { while (acc >= WEEK_MS && n < MAX_TICKS_PER_FRAME) { acc -= WEEK_MS; const ev = tickOnce(); n++; if (skip) skipCheck(ev); if (isHeld() || !speed) { acc = 0; break; } } }); // 3.6.0 한 화면 갱신에 지나간 주들의 알림을 묶는다
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
  let musicPaused: boolean | null = null;
  /** 상단바 스피커 버튼(음소거 켬/끔) */
  function renderMute(): void {
    const m = sound.settings().muted, b = $('#mutebtn');
    if (b.dataset.m === String(m)) return;
    b.dataset.m = String(m); b.setAttribute('aria-pressed', String(m)); b.setAttribute('aria-label', m ? '소리 켜기(지금 꺼짐)' : '소리 끄기');
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/>${m ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
  }
  function renderTop(): void {
    stageOn();
    const mp = !game || !title.hidden || speed === 0 || game.state.status !== 'playing'; // 배경 음악: 멈춤·처음 화면·파산 화면에서 쉰다
    if (mp !== musicPaused) { musicPaused = mp; sound.setPaused(mp); }
    renderMute();
    if (!sheet.hidden) requestAnimationFrame(() => markMore(sheetBody)); // 창 내용을 바꾼 뒤 renderTop()을 부른다
    if (!game) return;
    const s = game.state;
    sound.setEra(yearOf(s.week)); applyEra(yearOf(s.week), stage); // M3 시대별 화면 분위기
    // 바뀐 값만 고친다(매 주 상단바를 통째로 다시 쓰면 누르는 순간 버튼이 다시 만들어져 터치가 씹힐 수 있다)
    const put = (el: HTMLElement, v: string, html = false) => { if (el.dataset.v !== v) { el.dataset.v = v; if (html) el.innerHTML = v; else el.textContent = v; } };
    const sx = curSub(); subTheme(sx); // 3.1.0 운영 전환: 머리글에 자회사 로고·이름, 강조색은 자회사 색
    put($('#co'), sx ? sx.name : s.companyName); $('#co').title = sx ? `${sx.name} · ${s.companyName}의 자회사` : s.companyName;
    put($('#mylogo'), sx ? subMark(sx.name, sx.color, 26) : myLogo(26), true);
    $('#hqback').hidden = !sx;
    for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.hidden = !!sx && (b.dataset.tab === 'research' || b.dataset.tab === 'fin' || (!isBrandK(sx.kind) && (b.dataset.tab === 'garage' || b.dataset.tab === 'dev')));
    put($('#date'), game.dateLabel);
    // 1.0.0 좁은 상단 바(1240px 이하)에서는 1조 이상을 "3.4조"로 줄인다(전체 금액은 title·aria)
    const topMoney = (v: number) => (innerWidth <= 1240 && Math.abs(v) >= 1e8 ? `${v < 0 ? '−' : ''}${(Math.abs(v) / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조` : money(v));
    const c = $('#cash'), hc = $('#hqcash'); put($('#cash-l'), sx ? '자본' : '현금');
    if (sx) { put(c, topMoney(sx.capital)); c.classList.remove('neg'); c.title = `${sx.name} 자본 ${money(sx.capital)} · 본사 현금 ${money(s.cash)}`; $('#hqback').title = `본사 화면으로 돌아가기 · 본사 현금 ${money(s.cash)}`; put(hc, `본사 ${topMoney(s.cash)}`); hc.classList.toggle('neg', s.cash < 0); hc.hidden = false; }
    else { put(c, topMoney(s.cash)); c.classList.toggle('neg', s.cash < 0); c.title = money(s.cash); hc.hidden = true; }
    put($('#rep'), String(Math.round(s.reputation)));
    { const L = s.ledger.at(-1), pc = $('#plchip'), pb = $('#pl'); pc.hidden = !L || !!sx; // 3.1.0 운영 전환 중에는 본사 손익 칩을 숨긴다(머리글 자리) // 0.9.0 지난달 손익: ▲3.4억 / ▼1.1억(누르면 재무)
      if (L) { put(pb, `${L.profit >= 0 ? '▲' : '▼'}${topMoney(Math.abs(L.profit))}`); pb.className = L.profit >= 0 ? 'pos' : 'neg'; pc.setAttribute('aria-label', `${L.year}년 ${L.monthOfYear}월 손익 ${money(L.profit, true)}. 눌러서 재무 화면 보기`); pc.title = `${L.year}년 ${L.monthOfYear}월 손익(영업 이익 아님, 일회성 지출 포함)`; } }
    for (const b of document.querySelectorAll<HTMLElement>('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
    const held = decisionHeld(); $('#held').hidden = !held; $('#speeds').classList.toggle('held', held); // 좁은 화면에서는 글자 대신 빠르기 버튼 테두리로
    const AE = Q.activeEvents(s), ae = AE.events, up = Q.upcomingEvents(s), pc = Q.pendingChoices(s).length, chip = $('#evchip');
    const lead = ae.find((x) => x.monthsLeft !== null) ?? ae[0];
    chip.hidden = !lead && !up.length;
    const reg = lead && AE.regulations.find((x) => x.name === lead.name), regAt = reg ? `${Q.monthLabel(Math.floor(reg.enforceWeek / config.time.weeksPerMonth))} 시행` : ''; // 규제는 "계속" 대신 시행 시점
    const full = lead ? `${lead.name} · ${lead.monthsLeft === null ? regAt || '계속' : `앞으로 ${lead.monthsLeft}개월`}${ae.length > 1 ? ` 외 ${ae.length - 1}` : ''}` : `사건 예고 ${up.length}`;
    put(chip, lead ? `<span class="ev-n">${esc(lead.name)}</span><span class="ev-m">${lead.monthsLeft === null ? (regAt ? ` · ${regAt}` : '') : ` · ${lead.monthsLeft}개월`}${ae.length > 1 ? ` +${ae.length - 1}` : ''}</span>` : `<span class="ev-n">사건 예고 ${up.length}</span>`, true);
    chip.title = full; chip.setAttribute('aria-label', `시대 사건: ${full}. 눌러서 효과 보기`);
    const pd = $('#pend'); pd.hidden = !pc; put(pd, `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 20h20z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 10v4M12 17v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg><b>${pc}</b><span class="pd-t">결정 대기</span>`, true);
    pd.setAttribute('aria-label', `결정 대기 ${pc}건 보기`);
    { const T = todoCount(), tb = $('#todobtn'); put($('#todo-n'), String(T.length)); tb.setAttribute('aria-expanded', String(!drawer.hidden)); tb.classList.toggle('urgent', T.some((x) => x.urgent)); tb.classList.toggle('none', !T.length);
      const un = execUnread(s); tb.classList.toggle('has-rep', un > 0); tb.setAttribute('aria-label', `할 일 ${T.length}건${un ? `, 읽지 않은 임원 보고 ${un}건` : ''} 보기`); }
    { const sb = $('#skipbtn'); sb.classList.toggle('on', !!skip); sb.setAttribute('aria-pressed', String(!!skip)); put(sb, skip ? '<span class="sk-l">진행 중 · </span>멈추기' : '<span class="sk-l">다음 일까지</span><span class="sk-s" aria-hidden="true">다음 일</span>', true); sb.setAttribute('aria-label', skip ? '진행 중, 멈추기' : '다음 일까지'); } // 0.9.0 좁은 상단 바에서는 짧게
    const tab: Tab = deciding() ? 'dev' : (screen as Tab);
    for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    { const dv = document.querySelector<HTMLElement>('#tabs button[data-tab="dev"]')!, on = !!(draft || lift); dv.classList.toggle('has-draft', on); if (on) dv.title = '기획 중인 차가 있습니다'; else dv.removeAttribute('title'); }
    { // 0.9.0 큰 메뉴 점 하나: 연구(빈 연구 칸·규제 필수 미연구), 재무(현금 마이너스). 할 일 목록과 같은 판단
      const T = todos(), dot = (t: string, on: boolean, why: string) => { const el = document.querySelector<HTMLElement>(`#tabs button[data-tab="${t}"]`)!; el.classList.toggle('has-dot', on); if (on) el.title = why; else el.removeAttribute('title'); };
      const reg = T.some((x) => x.kind === 'regulation'), slot = T.some((x) => x.kind === 'research');
      dot('research', reg || slot, reg ? '규제에 필요한 연구가 있습니다' : '비어 있는 연구 칸이 있습니다');
      dot('fin', T.some((x) => x.kind === 'cash'), '현금이 마이너스입니다'); }
  }
  function renderDebug(): void {
    const d = $('#debug');
    d.hidden = !debugOn || !game;
    if (!d.hidden) d.textContent = `초당 화면 ${fps.toFixed(0)} · ${game!.state.week}주차 · 시드 ${game!.state.seed} · 빠르기 ${speed}배${isHeld() ? '(멈춤)' : ''}`;
  }

  // ---------- 화면 그리기 ----------
  function render(): void {
    if (!game) return;
    watchCands();
    renderTop();
    const s = game.state;
    if (s.status === 'gameOver') { if (!gameOverShown) showGameOver(); return; }
    if (screen === 'launch' && (!launch || !Q.projectById(s, launch.pid))) screen = 'dev';
    if (screen === 'plan' && !draft) screen = 'dev';
    if (screen === 'lift' && (!lift || !Q.generationById(s, lift.genId))) screen = 'garage';
    if (screen === 'derive' && (!derive || Q.generationById(s, derive.genId)?.status !== 'onSale')) { derive = null; screen = 'garage'; }
    if (screen === 'launch') dropToast('pause-ready'); // 알림이 가리키던 화면에 왔으면 그 알림은 닫는다
    if (screen === 'company' && coTab === 'staff') dropToast('pause-cands');
    if (draft?.subId !== undefined && !s.subs?.some((x) => x.id === draft!.subId)) { draft = null; if (screen === 'plan') screen = 'dev'; }
    const sx = curSub();
    if (sx) { // 3.1.0 운영 전환: 자회사에 맞는 탭만(차고·개발·회사·기록)
      if (screen === 'plan' && draft?.subId !== sx.id) screen = 'dev';
      if (!['garage', 'dev', 'plan', 'company', 'records'].includes(screen) || (!isBrandK(sx.kind) && (screen === 'garage' || screen === 'dev' || screen === 'plan'))) screen = 'company';
    }
    const v: View = sx && screen !== 'plan' ? (screen === 'garage' ? subGarageView(sx.id) : screen === 'dev' ? subDevView(sx.id) : screen === 'records' ? subRecordsView(sx.id) : { ov: '', panel: subBar(sx) + subDetailView(sx.id), look: undefined })
      : screen === 'garage' ? (garageSub && s.subs?.some((x) => x.id === garageSub!.id) ? subGarageView(garageSub.id, true) : garageView()) : screen === 'start' ? startView() : screen === 'plan' ? planView() : screen === 'lift' ? liftView() : screen === 'derive' ? deriveView()
      : screen === 'dev' ? devView() : screen === 'launch' ? launchView()
      : { ov: '', panel: screen === 'company' ? companyView() : screen === 'research' ? researchTab() : screen === 'fin' ? finTab() : recordsView(), look: undefined };
    $('#main').classList.toggle('full', v.look === undefined && !v.office);
    $('#main').classList.toggle('wide', !!v.office); // 개발 탭 사무실: 위에 넓게, 아래에 패널 세 칸
    if (v.ov !== lastOv) { ov.innerHTML = v.ov; lastOv = v.ov; } // 띠 높이를 사무실보다 먼저 정한다(--office-top-inset)
    { const kb = $('#keys'), kh = v.look !== undefined && !v.office ? v.keys ?? '' : ''; if (kb.dataset.v !== kh) { kb.dataset.v = kh; kb.innerHTML = kh; } kb.hidden = !kh; $('#main').classList.toggle('haskeys', !!kh); } // 0.9.0 무대 아래 핵심 수치 띠
    placeToasts();
    showOffice(v.office ?? null);
    if (v.look !== undefined && !v.office) showLook(v.look);
    const ae = document.activeElement as HTMLElement | null;
    const busy = (!!ae && panel.contains(ae) && (ae.matches('input[type=text]') || (dragging && ae.matches('input[type=range]')))) || !!pxHold?.isConnected;
    if (v.panel !== lastPanel) {
      if (!busy) { const y = panel.scrollTop; panel.innerHTML = v.panel; panel.scrollTop = y; lastPanel = v.panel; }
      else patchLive(v.panel);
    }
    if (tipHover && tipAnchor && !tipAnchor.isConnected) hideTip();
    markMore(panel); refreshDrawer();
  }
  /** 아래로 더 볼 내용이 있으면 .more(아래쪽 흐림 표시) */
  function markMore(el: HTMLElement): void { el.classList.toggle('more', el.scrollHeight - el.scrollTop - el.clientHeight > 8); }
  panel.addEventListener('scroll', () => markMore(panel), { passive: true });
  sheetBody.addEventListener('scroll', () => markMore(sheetBody), { passive: true });
  title.addEventListener('scroll', () => markMore(title), { passive: true });
  addEventListener('resize', () => { markMore(panel); if (!sheet.hidden) markMore(sheetBody); });
  /** 조절 중에는 data-live 칸(id로 짝)만 새 내용으로 바꿔 끼운다(슬라이더 자신은 그대로 두어 손가락이 놓치지 않게) */
  function patchLive(html: string): void {
    const t = document.createElement('template'); t.innerHTML = html;
    for (const n of [...t.content.querySelectorAll<HTMLElement>('[data-live]')]) { const o = document.getElementById(n.id); if (o && o.outerHTML !== n.outerHTML) o.replaceWith(n); }
  }
  const go = (sc: Screen) => { screen = sc; lastPanel = ''; panel.scrollTop = 0; render(); };

  const tierName = (pt: string, tier: number) => powertrainById(pt).tiers[tier - 1]?.name ?? '';
  const segName = (id: string) => SEGMENTS.find((x) => x.id === id)?.name ?? id;
  const specLine = (body: string, pt: string, tier: number, seg: string) => `${bodyById(body).name} · ${powertrainById(pt).name} ${tierName(pt, tier)} · ${segName(seg)}용`;
  const statBars = (g: Stats) => STATS.map((k) => `<div class="stat"><span>${STAT_NAME[k]}${ib(`stat:${k}`, STAT_NAME[k])}</span><div class="track"><u style="width:${Math.min(100, g[k] * 10).toFixed(1)}%"></u></div><b>${score(g[k])}</b></div>`).join('');
  const kpi = (label: string, value: string, cls = '', box = '') => `<div class="kpi${box ? ` ${box}` : ''}"><small>${label}</small><b class="${longCls(cls, value)}">${value.replace(/(만원|억)$/, '<span>$1</span>')}</b></div>`; // 단위는 작게
  /** 판매 가격 조절(출시·차고 공용): 가격·기준가 대비, −/+ 버튼과 슬라이더, 대당 이익·예상 월 판매·예상 월 이익을 한 덩어리로(태블릿 가로에서 스크롤 없이) */
  // body: 차체 기준가(가격 허용 범위, sim 검사와 같게), 기준가 표시·눈금·대비 %는 시장 기준가(차체 + 의무 장비 원가, 판매·평론 계산 기준)
  const priceBlock = (id: string, o: { price: number; body: string; up: number; sales: string; profit: string; pcls: string; gen?: number; ref?: number }) => { // ref: 출시 화면의 차별 기준가(옵션 포함)
    const b = bodyById(o.body).basePrice, og = o.gen === undefined ? undefined : Q.generationById(game!.state, o.gen), ref = o.ref ?? (og ? Q.genBasePrice(game!.state, og) : Q.basePriceOf(game!.state, o.body)), min = Math.ceil(b * config.price.min), max = Math.floor(b * config.price.max), d = Math.round((o.price / ref - 1) * 100);
    return `<div class="pricerow" id="${id}-row" data-live><b id="${id}-out">${num(o.price)}<span>만원</span></b><span class="vsbase">기준가${ib('term:기준가')} ${num(Math.round(ref))}만원 대비 ${d > 0 ? '+' : d < 0 ? '−' : '±'}${Math.abs(d)}%</span></div>
      <div class="px-ctl"><button class="px-step" data-step="-1" aria-label="가격 10만원 내리기">−</button><div class="px-track" style="--base:${Math.max(0, Math.min(1, (ref - min) / Math.max(1, max - min))).toFixed(3)}"><input type="range" class="px-r" id="${id}"${o.gen === undefined ? '' : ` data-gen="${o.gen}"`} min="${min}" max="${max}" step="10" value="${o.price}" aria-label="판매 가격(만원)"><i class="px-base" aria-hidden="true"></i></div><button class="px-step" data-step="1" aria-label="가격 10만원 올리기">+</button></div>
      <div class="kpis px-kpis" id="${id}-kpis" data-live>${kpi(`대당 이익${ib('term:대당 이익')}`, money(o.up, true), o.up >= 0 ? 'pos' : 'neg')}${kpi(`예상 월 판매${ib('term:예상 월 판매')}`, o.sales, '', 'px-sales')}${kpi('예상 월 이익', o.profit, o.pcls, 'px-profit')}</div>`;
  };
  /** [최고 이익 가격으로] 줄(출시·차고 공용). key: g+세대 ID / l+프로젝트 ID */
  const bestRow = (id: string, key: string, price: number, attr: string) => `<div class="row best-row" id="${id}-best" data-live style="margin-top:8px"><button class="btn" data-act="bestPx"${attr}>최고 이익 가격으로</button>${ib('term:최고 이익 가격')}${bestNote?.key === key && bestNote.price === price ? `<span class="hint best-note">${bestNote.text}</span>` : ''}</div>`;
  const policyName = (x: PricePolicy) => (x.kind === 'best' ? '최고 이익 가격 유지' : `기준가 ${x.pct}% 유지`);
  const policyText = (x: PricePolicy) => (x.kind === 'best' ? '매달 결산 직전에 그달 월 이익이 가장 큰 값으로 바꿉니다.' : `매달 결산 직전에 시장 기준가의 ${x.pct}%로 값을 맞춥니다.`);
  /** 자동 가격 고르기(차고): 수동 / 기준가 ○% 유지 / 최고 이익 가격 유지 */
  const policyBox = (g: Generation) => {
    const x = g.pricePolicy ?? null, pcts = [...new Set([...config.pricePolicy.pctChoices, ...(x?.kind === 'base' ? [x.pct] : [])])].sort((a, b) => a - b);
    const b = (v: string, label: string, sub: string, on: boolean) => `<button data-act="pxPolicy" data-id="${g.id}" data-v="${v}" aria-pressed="${on}">${label}<small>${sub}</small></button>`;
    return `<p class="lbl" style="margin-top:12px">자동 가격${ib('term:자동 가격')}</p><div class="seg px-policy" style="margin-bottom:6px">${b('manual', '수동', '직접', !x)}${pcts.map((p) => b(`base:${p}`, `기준가 ${p}%`, '유지', x?.kind === 'base' && x.pct === p)).join('')}${b('best', '최고 이익', '매달', x?.kind === 'best')}</div>
      <p class="hint policy-now">${x ? `지금: ${policyName(x)}. ${policyText(x)}` : '지금: 수동. 가격은 직접 바꿀 때만 바뀝니다.'}</p>`;
  };
  /** 예상 월 이익 = 판매 × 대당 이익 − 광고비(직원 월급·본사 유지비는 빼고) */
  const monthProfit = (n: number, up: number, mk: number) => n * up - config.awareness.marketingCost[mk];
  const ovTop = (eyebrow: string, model: string, spec: string, when = '') => `<div class="ov tl"><div class="eyebrow"><i></i>${eyebrow}</div><div class="model">${model}</div><div class="spec">${esc(spec)}</div>${when ? `<div class="spec when">${esc(when)}</div>` : ''}</div>`;
  const ovScore = (label: string, v: number | null) => v === null ? '' : `<div class="ov br">${ring(v)}<div><small>${label}</small><b>${score(v)}</b></div></div>`;
  const ovHint = '<div class="ov bl">끌어서 돌려 보기</div>';
  /** 0.9.0 넓어진 패널의 두 칸(좁으면 한 칸으로 쌓인다) */
  const pcols = (a: string, b: string) => `<div class="pcols"><div class="pcol">${a}</div><div class="pcol">${b}</div></div>`;
  /** 접어 두는 카드(차고 상세의 판매 요인·손익). 펼친 것은 다시 그려도 펼친 채(foldOpen) */
  const foldOpen = new Set<string>();
  const fold = (k: string, label: string, sum: string, body: string) => body ? `<details class="fold" data-fold="${k}"${foldOpen.has(k) ? ' open' : ''}><summary><p class="lbl">${label}</p><span>${sum}</span></summary>${body}</details>` : '';
  document.addEventListener('toggle', (e) => { const d = e.target as HTMLElement; if (d.matches?.('details.fold')) { if ((d as HTMLDetailsElement).open) foldOpen.add(d.dataset.fold!); else foldOpen.delete(d.dataset.fold!); lastPanel = ''; } }, true);
  /** 무대 아래에 카드 하나를 더 둘 만큼 키 큰 가로 화면인가(아이패드 1366×1024) */
  const tallStage = () => innerWidth >= 900 && innerHeight >= 900;
  const unitSmall = (v: string) => v.replace(/(만원|억)$/, '<span>$1</span>');
  const paints = (act: string, cur: string) => `<div class="paints">${PAINT.map(([n, c]) => `<button class="paint" data-act="${act}" data-k="color" data-v="${c}" aria-pressed="${cur === c}"><i style="background:${c}"></i>${n}</button>`).join('')}</div>`;
  const nameOf = (g: Generation) => Q.nameplateOf(game!.state, g.id)?.name ?? '';
  const genYear = (g: Generation) => Math.floor(g.launchMonth / 12) + config.time.startYear;
  /** 세대의 모습: 세대의 차대 시드 + 판(edId를 주면 그 판, 아니면 현재 판)의 얼굴 시드. 시대는 세대 출시 연도 */
  const genLook = (g: Generation, edId?: number): CarLook => {
    const e = g.editions.find((x) => x.id === edId) ?? currentEdition(g);
    return lookOf({ body: g.body, powertrain: g.powertrain, tier: e.tier, color: e.color, wheels: e.wheels, year: genYear(g), chassisSeed: g.chassisSeed, faceSeed: e.faceSeed, variant: g.variant });
  };
  /** 페이스리프트 얼굴 후보: 지금 얼굴·서로와 앞모습이 겹치지 않게 고른 시드 3개 */
  /** 1.0.0 페이스리프트 얼굴 후보의 기준: 지금 모습, sim 후보 첫 시드에서 이어지는 시드 줄, 지금 얼굴은 피함 */
  const liftCtx = (g: Generation): LP.LookCtx => { const cur = genLook(g), np = Q.nameplateOf(game!.state, g.id)!; return { base: cur, s0: Q.lookCandidates(game!.state, np.id, 'face', 'facelift')[0], avoid: [cur] }; };
  /** 1.0.0 기획 외관 후보의 기준(풀체인지면 전작 차대·얼굴은 피함) */
  const planCtx = (d: Draft, kind: 'face' | 'chassis', base: CarLook): LP.LookCtx => {
    const s = game!.state, prev = d.nameplateId ? s.nameplates.find((x) => x.id === d.nameplateId)?.generations.at(-1) : undefined;
    const avoid = prev ? [kind === 'face' ? { ...base, faceSeed: currentEdition(prev).faceSeed } : { ...base, chassisSeed: prev.chassisSeed }] : [];
    return { base, s0: kind === 'face' ? Q.lookCandidates(s, d.nameplateId, 'face', 'nextGen')[0] : Q.lookCandidates(s, d.nameplateId, 'chassis')[0], avoid };
  };
  /** 개발 중인 차의 모습. 페이스리프트는 그 세대의 시대를 따른다 */
  const projLook = (p: Project, color: string, wheels: 0 | 1 | 2 = 1): CarLook => {
    const g = p.kind === 'facelift' ? Q.generationById(game!.state, p.targetId ?? -1) : undefined;
    return lookOf({ body: p.body, powertrain: p.powertrain, tier: p.tier, color, wheels, year: g ? genYear(g) : yearOf(p.startWeek), chassisSeed: p.chassisSeed, faceSeed: p.faceSeed, variant: p.variant });
  };
  /** 출시 연월 한 줄: "1972년 3월 출시 · 2년 4개월째 · 1975년 6월 페이스리프트" */
  const launchWhen = (g: Generation): string => {
    const m = monthOf(game!.state.week) - g.launchMonth, y = Math.floor(m / 12), mo = m % 12, lift = g.editions.find((e) => e.kind === 'facelift');
    const age = m <= 0 ? '이번 달 출시' : `${[y ? `${y}년` : '', mo ? `${mo}개월` : ''].filter(Boolean).join(' ')} 지남`; // "3년째"는 36개월을 넷째 해로 읽게 해서 "3년 지남"으로
    return `${Q.monthLabel(g.launchMonth)} 출시 · ${age}${lift ? ` · ${Q.monthLabel(monthOf(lift.launchWeek))} 페이스리프트` : ''}`;
  };
  const editionName = (g: Generation) => `${g.number}세대${currentEdition(g).kind === 'facelift' ? ' · 페이스리프트' : ''}`;
  const busyReason = (): string | null => {
    const s = game!.state, n = Q.devTeams(s); if (s.projects.length < n) return null;
    const w = s.projects.filter((p) => p.waiting).map((p) => `「${p.name}」`).join(', ');
    return `개발팀 ${n}개가 모두 바쁩니다. 진행 중인 개발이 끝나야 합니다.${w ? ` 출시 대기 중인 ${w}${josa(w.slice(-2, -1), '을/를')} 출시하거나 취소하면 자리가 납니다.` : ''}${s.hqLevel < config.hq.levels.length ? ' 본사를 키우면 개발팀이 늘어납니다.' : ''}`;
  };
  /** 조건 버튼: 안 되면 흐리게 + 이유 */
  const elig = (e: Q.Eligibility) => { const b = busyReason(); return b && e.ok ? { ok: false, reason: b } : { ok: e.ok, reason: e.reason }; };

  /** 차고 카드의 주문 상황 한 줄(지난달 생산 한도 때문에 못 판 차가 있을 때) */
  const orderLine = (g: Generation): string => g.lostSales < 1 ? ''
    : `<div class="warnbox order-line" style="margin-top:10px">지난달 주문 ${num(g.lastDemand)}대 중 ${num(g.sales.at(-1) ?? 0)}대만 만들었습니다. ${game!.state.factory.build ? '공장 증설 공사가 진행 중입니다.' : '공장 증설을 고려하세요.'}<button class="btn" data-act="goCo" data-v="factory" style="width:100%;margin-top:8px">공장 보기</button></div>`;

  /** 조언 한 줄. 주문 상황 줄(orderLine)이 같은 말(주문이 생산을 넘음)을 하면 생략 */
  const adviceLine = (g: Generation): string => { const a = Q.advice(g, game!.state); return g.lostSales >= 1 && a.startsWith('주문이') ? '' : `<div class="advice">${esc(a)}</div>`; };

  // ----- 차고 -----
  // 0.9.0: 판매 중인 차가 2대 이상이면 첫 화면은 전 차종 한 줄 요약 표(정렬·비교). 줄을 누르면 상세(무대 + 패널), 상세에서 [← 전 차종]
  const gSort: { k: GSort; desc: boolean } = { k: 'launch', desc: false };
  const cmpSel = new Set<number>(); // 비교 보기에 고른 세대(2~4대)
  /** 지난달 이 차의 장부 한 줄(0.9.0 전 장부면 없음) */
  const lastCarRow = (g: Generation) => game!.state.ledger.at(-1)?.cars?.find((c) => c.id === g.id);
  /** 지난달 이 차의 월 이익: 장부 값(매출 − 원가 − 광고 − 리콜). 예전 장부면 지난달 판매 × 대당 이익 − 광고비 */
  const carMonthProfit = (g: Generation): number => { const r = lastCarRow(g); return r ? r.revenue - r.cogs - r.marketing - r.recall : (g.sales.at(-1) ?? 0) * Q.generationUnitProfit(g, game!.state) - config.awareness.marketingCost[g.marketing]; };
  const gVal = (g: Generation, k: GSort): number | string => k === 'name' ? nameOf(g) : k === 'launch' ? g.launchWeek : k === 'price' ? currentEdition(g).price : k === 'sold' ? g.sales.at(-1) ?? 0
    : k === 'unit' ? Q.generationUnitProfit(g, game!.state) : k === 'profit' ? carMonthProfit(g) : k === 'life' ? Q.lifeBar(game!.state, g) : g.reviewAvg;
  /** 차고에서 넘겨 보는 순서 = 요약 표의 정렬 순서(같으면 ID 순) */
  const garageList = (): Generation[] => {
    const s = game!.state, k = gSort.k, d = gSort.desc ? -1 : 1, npOf = (g: Generation) => Q.nameplateOf(s, g.id)!;
    const L = [...sellingGens(s)].sort((a, b) => { const x = gVal(a, k), y = gVal(b, k); return d * (typeof x === 'string' ? x.localeCompare(y as string, 'ko') : x - (y as number)) || a.id - b.id; });
    // 1.3.0 파생 차는 판매 중인 바탕 차 바로 아래(계보가 보이게)
    const out: Generation[] = [], seen = new Set<number>(), shown = new Set(L.map((g) => npOf(g).id));
    for (const g of L) { const n = npOf(g); if (n.baseOf !== undefined && shown.has(n.baseOf)) continue; out.push(g); if (n.baseOf === undefined && !seen.has(n.id)) { seen.add(n.id); out.push(...L.filter((x) => npOf(x).baseOf === n.id)); } }
    return out;
  };
  /** 1.3.0 파생 차 한 줄 설명: "왜건 · 「아리아」 2세대 바탕" */
  const derivLine = (g: Generation): string => { const s = game!.state, n = Q.nameplateOf(s, g.id), b = n?.baseOf !== undefined ? s.nameplates.find((x) => x.id === n.baseOf) : undefined, fg = g.fromGen !== undefined ? Q.generationById(s, g.fromGen) : undefined;
    return b ? `${Q.variantById(g.variant)?.name ?? '파생'} · 「${b.name}」${fg ? ` ${fg.number}세대` : ''} 바탕` : ''; };
  // ----- 1.3.0 세대교체 위임(기획 임원): 한 주·명령마다 한 번 계산 -----
  let gaMemo: { g: Game; k: string; v: ReturnType<typeof Q.genAutoInfo> } | null = null;
  const gaInfo = () => { const s = game!.state, k = `${s.week}:${s.history.length}:${s.projects.length}:${s.cash}:${JSON.stringify(s.execs?.genAuto ?? {})}:${JSON.stringify(s.execs?.seats.product ?? null)}`; if (gaMemo?.g !== game || gaMemo.k !== k) gaMemo = { g: game!, k, v: Q.genAutoInfo(s) }; return gaMemo.v; };
  const gaCar = (npId: number) => gaInfo().cars.find((c) => c.nameplateId === npId);
  /** 위임 상태 한 줄: 다음 예정·기다림 */
  const gaLine = (c: ReturnType<typeof gaCar>): string => { if (!c) return ''; const w = c.waitingSince !== null ? Math.floor((game!.state.week - c.waitingSince) / config.time.weeksPerMonth) : 0;
    return !c.on ? (c.next ? `지금 할 때: ${c.next}` : '꺼짐') : !c.active ? '멈춤 · 기획 임원에게 위임할 수 없습니다' : c.next ? `다음: ${c.next}${w >= 1 ? ` · ${w}개월째 기다림${c.why ? ` · ${c.why}` : '(이유는 임원 보고)'}` : c.why ? ` · ${c.why}` : c.waitingSince !== null ? ' · 조건을 기다림' : ''}` : `지금은 할 일 없음${c.launch ? ' · 출시까지 위임' : ' · 출시는 직접'}`; };
  /** 위임 켜기/끄기 버튼(차고 요약 표·상세·임원 화면 공용) */
  const gaBtn = (npId: number, small = false) => { const c = gaCar(npId), A = gaInfo(); if (!c) return ''; return `<button class="${small ? 'g-auto' : 'btn'}" data-act="genAuto" data-np="${npId}" data-v="${c.on ? 0 : 1}" aria-pressed="${c.on}" ${A.available || c.on ? '' : 'disabled'} aria-label="${esc(c.name)} 세대교체 위임 ${c.on ? '끄기' : '켜기'}"${small ? ` title="${esc(gaLine(c))}"` : ''}>${small ? '위임' : c.on ? '켜짐' : '꺼짐'}</button>`; };
  const gaLaunchBtn = (npId: number) => { const c = gaCar(npId); return c?.on ? `<button class="btn ga-launch" data-act="genAutoLaunch" data-np="${npId}" data-v="${c.launch ? 0 : 1}" aria-pressed="${c.launch}">${c.launch ? '출시까지 위임' : '출시는 직접'}</button>` : ''; };
  /** 그 차의 상세로(없는 ID면 전 차종 표) */
  const garageAt = (id?: number) => { const ok = id !== undefined && sellingGens(game!.state).some((g) => g.id === id); garageId = ok ? id! : -1; garageSum = !ok; go('garage'); };
  const ageText = (g: Generation) => { const m = monthOf(game!.state.week) - g.launchMonth, y = Math.floor(m / 12), mo = m % 12; return m <= 0 ? '이번 달 출시' : `${[y ? `${y}년` : '', mo ? `${mo}개월` : ''].filter(Boolean).join(' ')} 지남`; };
  const policyShort = (g: Generation) => (g.pricePolicy ? `자동 · ${g.pricePolicy.kind === 'best' ? '최고 이익' : `기준가 ${g.pricePolicy.pct}%`}` : '수동');
  /** 상태 배지(할 일 목록과 같은 판단 + 개발 중·단종 예정) */
  function genBadges(g: Generation): string {
    const s = game!.state, T = new Map(todos().map((t) => [t.key, t])), np = Q.nameplateOf(s, g.id), b: [string, string][] = [];
    if (g.status === 'ending') b.push(['이번 달 단종', 'bad']);
    if (s.projects.some((p) => (p.targetId === (p.kind === 'fullchange' ? np?.id : g.id) && (p.kind === 'facelift' || p.kind === 'fullchange')) || (p.kind === 'derivative' && p.into === np?.id))) b.push(['개발 중', 'dev']);
    if (np && gaCar(np.id)?.on) b.push(['위임', 'on']); // 1.3.0 세대교체 위임
    if (s.projects.some((p) => p.kind === 'fix' && p.targetId === g.id)) b.push(['개선 중', 'dev']);
    if (g.clearance) b.push(['가격 인하 판매 중', 'warn']);
    else { const R = Q.rescueOptions(s, g.id); if (R && R.target === null && (R.fix.ok || R.clearance.ok)) b.push(['수습 가능', 'bad']); } // 0.10.0 혹평·부진 차의 긴급 개선·가격 인하 판매
    if (T.has(`retrofit:${g.id}`)) b.push(['의무 장비 필요', 'bad']);
    if (g.status === 'onSale') { const ei = genEquipInfo(g); if (ei.legacy) b.push(['옛 구성', '']); else if (ei.totals.missingExpected.length) b.push(['장비 기대 미달', 'warn']); } // 1.1.0 옛 구성(legacy) 차는 감점이 없어 배지도 없다
    if (T.has(`capacity:${g.id}`)) b.push(['생산 한도', 'warn']);
    if (T.has(`facelift:${g.id}`)) b.push(['페이스리프트 적기', 'on']);
    if (np && T.get(`full:${np.id}`)?.title.includes('권장')) b.push(['풀체인지 권장', 'on']);
    return b.map(([t, c]) => `<span class="gb ${c}">${t}</span>`).join('');
  }
  /** 1.2.0 전기차 한 줄: 주행 거리(기대)·배터리·충전·전용 플랫폼 */
  const evLine = (g: Generation): string => { const e = Q.genEvInfo(game!.state, g.id); return e ? `<p class="hint ev-line" style="margin:-6px 0 10px">주행 거리 <b class="${e.short ? 'neg' : ''}">${num(e.rangeKm)}km</b>(이 차급 기대 ${num(e.expectedKm)}km)${ib('term:주행 거리')} · ${e.batteryName} 배터리 · 10→80% 충전 ${e.chargeMinutes}분 · 전용 플랫폼 ${e.platform ? '적용' : '미적용'}</p>` : ''; };
  const lifeMini = (v: number) => `<span class="g-life g-opt"><i class="life"><u style="width:${(v * 100).toFixed(1)}%"></u></i><small>${Math.round(v * 100)}%</small></span>`;
  /** 전 차종 한 줄 요약 표 + 개발 중·단종 구역 + 비교 줄 */
  function garageTable(): View {
    const s = game!.state, L = garageList(), all = allGens(s), gaCol = gaInfo().available || gaInfo().cars.some((c) => c.on); // 1.3.0 위임 칸(위임할 수 있거나 위임한 차가 있을 때)
    for (const id of cmpSel) if (!L.some((g) => g.id === id)) cmpSel.delete(id);
    const H = (k: GSort | '', label: string, cls = '') => k ? `<button class="sh${cls ? ` ${cls}` : ''}" data-act="gSort" data-v="${k}" aria-pressed="${gSort.k === k}">${label}${gSort.k === k ? `<i aria-hidden="true">${gSort.desc ? '▼' : '▲'}</i>` : ''}</button>` : `<span class="${cls}">${label}</span>`;
    const head = `<div class="gtr-w head"><span class="s-pick"></span><div class="gtr head"><span></span>${H('name', '차종')}${H('launch', '출시', 'g-opt')}${H('price', '가격', 'r g-opt')}${H('sold', '지난달 판매', 'r')}${H('unit', '대당 이익', 'r g-opt')}${H('profit', '월 이익', 'r')}${H('life', '수명', 'g-opt')}${H('review', '평론', 'r g-opt')}${H('', '상태', 'g-opt')}</div>${gaCol ? `<span class="g-auto hd">위임${ib('term:세대교체 위임')}</span>` : ''}</div>`;
    const row = (g: Generation) => {
      const e = currentEdition(g), up = Q.generationUnitProfit(g, s), mp = carMonthProfit(g), name = nameOf(g);
      const dl = derivLine(g), np = Q.nameplateOf(s, g.id)!;
      return `<div class="gtr-w${dl ? ' deriv' : ''}"><button class="s-pick" data-act="cmpPick" data-id="${g.id}" aria-pressed="${cmpSel.has(g.id)}" aria-label="${esc(name)} 비교에 넣기"></button><button class="gtr" data-act="gopen" data-id="${g.id}">
        <span class="g-th">${thumb(genLook(g), -0.65, 160, 100)}</span><span class="g-name" title="${esc(EQ.equipLine(edEquip(e)))}"><b>${dl ? '<i class="d-mark" aria-hidden="true">↳</i>' : ''}${esc(name)}</b><small>${g.number}세대 · ${dl ? esc(dl) : bodyById(g.body).name}</small></span>
        <span class="g-when g-opt">${Q.monthLabel(g.launchMonth)}<small>${ageText(g)}</small></span><span class="g-num g-opt">${num(e.price)}<small>${policyShort(g)}</small></span>
        <span class="g-num">${qty(g.sales.at(-1) ?? 0)}대</span><span class="g-num g-opt ${up >= 0 ? 'pos' : 'neg'}">${money(up, true)}</span><span class="g-num ${mp >= 0 ? 'pos' : 'neg'}">${money(mp, true)}</span>
        ${lifeMini(Q.lifeBar(s, g))}<span class="g-num g-opt">${score(g.reviewAvg)}${g.masterpiece ? '<small>명차</small>' : ''}${g.awards?.length ? '<small class="aw-s">수상</small>' : ''}</span><span class="g-st">${genBadges(g)}</span></button>${gaCol ? (g.status === 'onSale' ? gaBtn(np.id, true) : '<span class="g-auto" aria-hidden="true"></span>') : ''}</div>`;
    };
    // 1.0.0 같은 네모로 비교(2~4대)와 여러 대 한 번에 바꾸기(자동 가격·광고)
    const n = cmpSel.size, every = n === L.length, bar = `<div class="cmp-bar"><span>고른 차 <small>표 왼쪽 네모로 고릅니다 · 비교는 2~4대, 1대면 경쟁 차와</small></span><b>${n}대 고름</b>
      <button class="btn" data-act="${every ? 'cmpClear' : 'cmpAll'}">${every ? '고르기 해제' : `모두 고르기(${L.length}대)`}</button>${n && !every ? '<button class="btn" data-act="cmpClear">해제</button>' : ''}
      <button class="btn" data-act="cmpOpen" ${n >= 1 && n <= 4 ? '' : 'disabled'}>${n === 1 ? '경쟁 차와 비교' : '비교 보기'}</button><button class="btn ink" data-act="bulkOpen" ${n ? '' : 'disabled'}>한 번에 바꾸기</button></div>`;
    const tot = L.reduce((a, g) => a + (g.sales.at(-1) ?? 0), 0), totP = L.reduce((a, g) => a + carMonthProfit(g), 0), lines = Q.linesOf(s);
    const main = `<div class="card gtable"><h3>판매 중인 차 ${L.length}대 <small class="hint">지난달 ${num(tot)}대 · 차종 이익 합 ${money(totP, true)} · 생산 라인 ${L.length}/${lines}</small></h3>${bar}${head}${L.map(row).join('')}
      <p class="note">줄을 누르면 그 차의 무대와 가격·다음 단계 화면으로 갑니다. 머리글을 누르면 정렬, 다시 누르면 반대로 정렬합니다. 월 이익은 지난달 장부의 그 차 몫(매출 − 원가 − 광고 − 리콜)이고 직원 월급·유지비는 넣지 않았습니다.</p></div>`;
    const dev = s.projects.length ? `<div class="card gsec"><h3>개발 중 ${s.projects.length}대</h3>${s.projects.map((p) => `<button class="gsr" data-act="devSel" data-id="${p.id}"><span class="g-th">${thumb(projLook(p, ui.colors[p.id] ?? PAINT[0][1]), -0.65, 160, 100)}</span><span class="g-name"><b>${esc(p.name)}</b><small>${kindLabel(p)}</small></span><span>${p.waiting ? '<span class="gb on">출시 대기</span>' : phaseText(p)}</span><span>결함 약 ${num(p.defectEst)}개</span><span aria-hidden="true">→</span></button>`).join('')}</div>` : '';
    const gone = all.filter((g) => g.status === 'discontinued').sort((a, b) => b.launchMonth - a.launchMonth || b.id - a.id);
    const old = gone.length ? `<details class="card gsec gone"><summary><h3>단종된 차 ${gone.length}대</h3></summary>${gone.map((g) => `<div class="gsr"><span class="g-th">${thumb(genLook(g), -0.65, 160, 100)}</span><span class="g-name"><b>${esc(nameOf(g))}</b><small>${g.number}세대 · ${bodyById(g.body).name}</small></span><span>${Q.monthLabel(g.launchMonth)} 출시${g.endMonth !== null && g.endMonth !== undefined ? ` · ${Q.monthLabel(g.endMonth)} 단종` : ''}</span><span>누적 ${num(g.totalSold)}대 · 평론 ${score(g.reviewAvg)}</span><span></span></div>`).join('')}</details>` : '';
    const plan = s.projects.length < Q.devTeams(s) ? `<div class="row g-plan"><button class="btn ink" data-act="plan">+ 신차 기획</button></div>` : '';
    return { ov: '', panel: main + subCarsCard() + dev + old + plan, look: undefined };
  }
  /** 내 차 비교(2~4대): 능력치 5개·가격·판매·이익·수명·평론, 경쟁사는 차급별 세기 한 줄 */
  function showCompare(): void {
    const s = game!.state, G = garageList().filter((g) => cmpSel.has(g.id));
    if (G.length < 2) return err('비교할 차를 2대 이상 고르세요.');
    const grades = G.map((g) => Q.generationGrades(s, g)), ev = G.map((g) => Q.genEvInfo(s, g.id));
    const line = (label: string, vals: number[], fmt: (v: number) => string, hi = true) => { const best = hi ? Math.max(...vals) : Math.min(...vals); return `<tr><th>${label}</th>${vals.map((v) => `<td class="r${v === best && vals.some((x) => x !== v) ? ' best' : ''}">${fmt(v)}</td>`).join('')}</tr>`; };
    const rival = (body: string) => { const R = Q.rivalModelsIn(s, body).sort((a, b) => b.share - a.share)[0]; return R ? `${esc(R.company)} ${esc(R.name)} ${R.number}세대<br><small>추정 평론 ${score(R.critic)} · 점유 약 ${Math.round(R.share * 100)}%</small>` : '—'; }; // 2.0.0 모델 단위
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="cmp"><div class="eyebrow"><i></i>내 차 비교 · ${esc(game!.dateLabel)}</div><h2>${G.length}대 나란히 보기</h2><div class="tblwrap"><table class="tbl cmp-t">
      <tr><th></th>${G.map((g) => `<th class="r"><span class="g-th">${thumb(genLook(g), -0.65, 160, 100)}</span><b>${esc(nameOf(g))}</b><small>${g.number}세대 · ${bodyById(g.body).name}</small></th>`).join('')}</tr>
      ${STATS.map((k) => line(STAT_NAME[k], grades.map((x) => x[k]), score)).join('')}
      ${line('가격', G.map((g) => currentEdition(g).price), (v) => `${num(v)}만원`, false)}${line('지난달 판매', G.map((g) => g.sales.at(-1) ?? 0), (v) => `${num(v)}대`)}
      ${line('대당 이익', G.map((g) => Q.generationUnitProfit(g, s)), (v) => money(v, true))}${line('월 이익', G.map(carMonthProfit), (v) => money(v, true))}
      ${line('수명', G.map((g) => Q.lifeBar(s, g)), (v) => `${Math.round(v * 100)}%`)}${line('평론 평균', G.map((g) => g.reviewAvg), score)}
      ${ev.some((e) => e) ? `<tr><th>주행 거리</th>${ev.map((e) => `<td class="r">${e ? `${num(e.rangeKm)}km<br><small>${e.batteryName} 배터리 · 충전 ${e.chargeMinutes}분${e.platform ? ' · 전용 플랫폼' : ''}</small>` : '—'}</td>`).join('')}</tr>` : ''}
      <tr class="rival"><th>가장 많이 팔리는 경쟁 차</th>${G.map((g) => `<td class="r">${rival(g.body)}</td>`).join('')}</tr>${G.some((g) => Q.subModelsIn(s, g.body).length) ? `<tr class="rival"><th>같은 차급의 내 자회사 모델</th>${G.map((g) => `<td class="r">${Q.subModelsIn(s, g.body).map((v) => `<i class="sub-own">내 자회사</i> ${esc(v.company)} ${esc(v.name)} ${v.number}세대<br><small>추정 평론 ${score(v.critic)} · 점유 약 ${Math.round(v.share * 100)}%</small>`).join('<br>') || '—'}</td>`).join('')}</tr>` : ''}</table></div>
      <p class="note">능력치는 그해 다른 차와 비교한 등급(0~10, 5가 보통)입니다. 굵은 칸이 그 줄에서 가장 좋은 값입니다(가격은 낮은 쪽). 한 대만 고르면 같은 차급의 경쟁 차와 나란히 봅니다.</p>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 2.0.0 경쟁 모델의 썸네일: 차체·출시 연도·모델 시드로 그리고, 색은 회사 경향에서 */
  const rivalLook = (v: Q.RivalModelView): CarLook => { const c = RIVAL_PAINT[v.rivalId] ?? [PAINT[4][1]]; return lookOf({ body: v.body, powertrain: 'gasoline', tier: 2, color: c[v.seed % c.length], wheels: 1, year: v.year, chassisSeed: v.seed, faceSeed: v.seed >>> 3 }); };
  /** 4.0.0 차 상세의 권역별 판매(진출한 권역이 있을 때) */
  function genWorldCard(g: Generation): string {
    const s = game!.state, rows = WD.genWorldRows(s, g);
    if (!rows.length) return '';
    return `<p class="lbl" style="margin-top:12px">권역별 판매 <small class="hint">지난달 · 국내 ${num(g.sales.at(-1) ?? 0)}대</small></p><div class="tblwrap"><table class="tbl w-regs"><tr><th>권역</th><th>수출</th><th class="r">권역 가격</th><th class="r">지난달</th><th class="r">누적</th><th class="r">누적 이익</th></tr>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.on ? '수출 중' : '<span class="hint">안 함</span>'}</td><td class="r">${money(r.price)}</td><td class="r">${num(r.sold)}대</td><td class="r">${num(r.total)}대</td><td class="r ${r.profit >= 0 ? 'pos' : 'neg'}">${money(r.profit, true)}</td></tr>`).join('')}</table></div>
      <button class="lnk" data-act="goWorld" data-v="${rows[0].rid}">세계 화면에서 수출·권역 가격 바꾸기</button>`;
  }
  /** 2.0.0 내 차 한 대와 같은 차급의 경쟁 모델(모델 단위 비교): 이름·세대·출시 연도·평론(경쟁 차는 추정)·가격·점유·능력치 막대 */
  function showRivalCompare(id: number): void { // 4.0.0 경쟁사 6곳: 경쟁 모델은 그 차급 점유 상위 3종
    const s = game!.state, g = Q.generationById(s, id);
    if (!g) return;
    const R = [...Q.rivalModelsIn(s, g.body)].sort((a, b) => b.share - a.share || (a.rivalId < b.rivalId ? -1 : 1)).slice(0, 3), M = Q.subModelsIn(s, g.body), cols = [{ gr: Q.generationGrades(s, g), price: currentEdition(g).price, rev: g.reviewAvg, share: Q.myCellShare(s, g.body) }, ...M.map((v) => ({ gr: v.grades, price: v.price, rev: v.critic, share: v.share })), ...R.map((v) => ({ gr: v.grades, price: v.price, rev: v.critic, share: v.share }))]; // 3.0.0 내 자회사 모델은 내 차 바로 옆
    const bar = (v: number) => `<span class="abil"><u style="width:${Math.min(100, v * 10).toFixed(1)}%"></u></span>${score(v)}`;
    const line = (label: string, vals: number[], fmt: (v: number) => string, hi = true) => { const best = hi ? Math.max(...vals) : Math.min(...vals); return `<tr><th>${label}</th>${vals.map((v) => `<td class="r${v === best && vals.some((x) => x !== v) ? ' best' : ''}">${fmt(v)}</td>`).join('')}</tr>`; };
    const top = (k: Stat) => Math.max(...R.map((v) => v.grades[k])), mine = cols[0].gr;
    const ahead = STATS.filter((k) => mine[k] >= top(k)), behind = STATS.filter((k) => mine[k] < top(k) - 0.5), nm = (ks: Stat[]) => ks.map((k) => STAT_NAME[k]).join('·') || '없음';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="cmp"><div class="eyebrow"><i></i>경쟁 차와 비교 · ${esc(game!.dateLabel)}</div><h2>${esc(nameOf(g))}${josa(nameOf(g), '과/와')} 같은 ${bodyById(g.body).name}</h2><div class="tblwrap"><table class="tbl cmp-t rv-cmp">
      <tr><th></th><th class="r"><span class="g-th">${thumb(genLook(g), -0.65, 160, 100)}</span><b>${esc(nameOf(g))}</b><small>내 차 · ${g.number}세대 · ${genYear(g)}년</small></th>${M.map((v) => `<th class="r own-sub"><span class="g-th">${thumb(subLook(v), -0.65, 160, 100)}</span><b>${esc(v.name)}</b><small><i class="sub-own">내 자회사</i> ${esc(v.company)} · ${v.number}세대 · ${v.year}년</small></th>`).join('')}${R.map((v) => `<th class="r"><span class="g-th">${thumb(rivalLook(v), -0.65, 160, 100)}</span><b>${esc(v.name)}</b><small>${esc(v.company)} · ${v.number}세대 · ${v.year}년${v.hit ? '<i class="rv-hit">히트작</i>' : ''}</small></th>`).join('')}</tr>
      ${STATS.map((k) => line(STAT_NAME[k], cols.map((c) => c.gr[k]), bar)).join('')}
      ${line(`평론${ib('term:추정 평론')}`, cols.map((c) => c.rev), score)}${line('가격', cols.map((c) => c.price), (v) => `${num(v)}만원`, false)}${line('차급 점유(대략)', cols.map((c) => c.share), (v) => `${Math.round(v * 100)}%`)}</table></div>
      <p class="hint rv-sum">가장 센 경쟁 차와 견주면 앞서는 능력치: <b class="pos">${nm(ahead)}</b> · 뒤지는 능력치: <b class="neg">${nm(behind)}</b></p>
      <p class="note">경쟁 차${M.length ? '와 내 자회사 모델' : ''}의 평론·능력치·가격·점유는 시장에서 보이는 세기로 어림한 추정값입니다. 능력치는 그해 기준 등급(0~10, 5가 보통)이고, 굵은 칸이 그 줄에서 가장 좋은 값입니다(가격은 낮은 쪽). 내 차의 평론은 출시 때 받은 평균입니다.</p>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 2.0.0 경쟁사 라인업: 모델마다 차체·세대·출시 연도·추정 평론·히트작, 누르면 지난 세대 */
  function showRivalLineup(id: string): void {
    const s = game!.state, L = Q.rivalLineup(s, id);
    if (!L) return;
    const ri = s.rivals.findIndex((r) => r.id === id);
    const row = (v: Q.RivalModelView) => `<details class="rv-model"><summary><span class="g-th">${thumb(rivalLook(v), -0.65, 160, 100)}</span><span class="rv-n"><b>${esc(v.name)}</b><small>${bodyById(v.body).name} · ${v.number}세대 · ${v.year}년 출시</small></span><span class="rv-c">추정 평론 <b>${score(v.critic)}</b>${v.hit ? '<i class="rv-hit">히트작</i>' : ''}</span></summary>
      <table class="tbl rv-hist"><tr><th>세대</th><th class="r">출시</th><th class="r">추정 평론</th></tr>${[...Q.rivalHistory(s, ri, v.body)].reverse().map((h) => `<tr><td>${h.number}세대${h.n === v.n ? ' <small>지금</small>' : ''}</td><td class="r">${h.year}년</td><td class="r">${score(h.critic)}${(h.n === v.n ? v.hit : h.hit) ? ' <i class="rv-hit">히트작</i>' : ''}</td></tr>`).join('')}</table></details>`;
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="rv-sheet"><div class="eyebrow"><i></i>경쟁사 · ${esc(game!.dateLabel)}</div><div class="rv-head">${logo(id, 36)}<div><h2>${esc(L.name)} <small class="hint">${esc(L.trait)}</small></h2><p class="hint">${esc(L.desc)}</p></div></div>
      ${rivalActions(id)}
      <p class="lbl" style="margin-top:12px">라인업</p><div class="rv-list">${L.models.map(row).join('')}</div>
      <p class="note">모델을 누르면 지난 세대가 펼쳐집니다. 추정 평론${ib('term:추정 평론')}은 시장에서 보이는 세기로 어림한 값입니다. 첫 세대의 추정 평론은 회사의 차급별 강약만으로 어림합니다.</p>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 3.5.0 경쟁사와의 관계 표시(제휴 중·가격 전쟁 중·대응 신차 준비 중) */
  function relTags(x: Q.RivalRelation): string {
    const t = [x.alliance ? '<i class="rv-tag ally">제휴 중</i>' : '', x.war ? '<i class="rv-tag war">가격 전쟁 중</i>' : '', x.counters.length ? '<i class="rv-tag ctr">대응 신차 준비 중</i>' : ''].join('');
    return t ? `<span class="rv-tags">${t}</span>` : '';
  }
  /** 3.5.0 경쟁사 창의 관계·행동: 지금 관계, 기술 제휴(기술 사 오기), 경쟁사 인재 영입, 인수 */
  function rivalActions(id: string): string {
    const s = game!.state, x = Q.rivalRelations(s).find((r) => r.id === id)!, pc = (v: number) => `${Math.round(v * 100)}%`;
    const now = [
      x.war ? `<li><b>가격 전쟁</b> ${esc(x.war.bodyName)} 가격 ${pc(x.war.cut)} 인하 중 · ${x.war.monthsLeft}개월 남음 · ${x.war.follow === null ? '답을 기다리는 중' : x.war.follow ? '나도 따라 내림' : '나는 가격 유지'}</li>` : '',
      ...x.counters.map((c) => `<li><b>대응 신차 준비 중</b> ${esc(c.bodyName)} 차급, 「${esc(c.target)}」 겨냥 · 약 ${c.monthsLeft}개월 뒤</li>`),
      x.alliance ? `<li><b>기술 제휴 중</b> ${x.alliance.monthsLeft}개월 남음 · 연구 속도 +${pc(config.rivalry.alliance.speed)}</li>` : '',
      x.weak ? `<li><b>인재 유출</b> 내가 영입한 인재만큼 이 회사의 차가 ${pc(x.weak)} 약해졌습니다.</li>` : '',
    ].filter(Boolean).join('');
    const techs = x.alliance ? (x.buyable.length ? `<div class="rv-techs">${x.buyable.map((t) => `<div class="rv-tech"><span><b>${esc(t.name)}</b><small>${t.year}년 · ${esc(t.desc)}</small></span><button class="btn" data-act="buyTech" data-v="${id}" data-t="${t.id}" ${s.cash < t.cost ? 'disabled' : ''}>사 오기 · ${money(t.cost)}</button></div>`).join('')}</div>` : `<p class="hint">이 회사가 앞선 ${esc(x.field)} 분야에서 지금 사 올 수 있는 기술이 없습니다(이미 연구했거나 선행 기술이 필요합니다).</p>`) : '';
    const ally = `<div class="card rv-card"><h3>기술 제휴${ib('term:기술 제휴')}</h3><p class="hint">앞선 분야: <b>${esc(x.field)}</b> · 계약 ${config.rivalry.alliance.months}개월 · 계약금 ${money(x.allianceFee)} · 연구 속도 +${pc(config.rivalry.alliance.speed)}</p>
      ${x.alliance ? `${techs}<button class="btn" data-act="endAlly" data-v="${id}" style="margin-top:8px">제휴 끝내기</button>` : `<button class="btn ink" data-act="allyRival" data-v="${id}" ${x.allianceError ? 'disabled' : ''} style="margin-top:6px">기술 제휴 맺기 · ${money(x.allianceFee)}</button>${x.allianceError ? `<p class="hint neg">${esc(x.allianceError)}</p>` : ''}`}</div>`;
    const tal = `<div class="card rv-card"><h3>경쟁사 인재${ib('term:경쟁사 인재')}</h3>${x.talent.length ? `<div class="rv-tals">${x.talent.map((t) => `<div class="rv-tal"><span><b>${esc(t.name)}</b><small>${esc(t.roleName)} · 능력 ${t.ability}(성장 한계 ${t.potential}) · ${t.monthsLeft}개월 뒤 사라짐</small><small>월급 ${money(t.salary)}(웃돈 ${money(t.pay)} 포함) · 영입비 ${money(t.fee)}</small></span><button class="btn ink" data-act="talentHire" data-id="${t.id}" ${t.reason ? 'disabled' : ''}>영입</button>${t.reason ? `<small class="neg">${esc(t.reason)}</small>` : ''}</div>`).join('')}</div>` : `<p class="hint">지금 이 회사에서 영입할 수 있는 인재가 없습니다. 본사 ${config.rivalry.talent.hqMin}등급부터 ${config.rivalry.talent.refreshMonths}개월마다 후보가 바뀝니다.</p>`}
      <p class="note">영입하면 이 회사의 차가 조금 약해집니다(한 명에 ${pc(config.rivalry.talent.weaken)}, 최대 ${pc(config.rivalry.talent.weakMax)}).</p></div>`;
    const acq = `<div class="card rv-card"><h3>인수${ib('term:경쟁사 인수')}</h3><p class="hint">지금 값 <b>${money(x.acquire.price)}</b>${x.acquire.reason ? ` · <span class="neg">${esc(x.acquire.reason)}</span>` : ''}</p><button class="btn" data-act="acqOpen" data-v="${id}" style="margin-top:6px">인수 검토</button></div>`;
    return `${now ? `<ul class="rv-now">${now}</ul>` : '<p class="hint rv-now0">지금 이 회사와 걸린 일은 없습니다.</p>'}<div class="rv-acts">${ally}${tal}${acq}</div>`;
  }
  /** 3.5.0 인수 창: 평가액·웃돈·값, 인수 뒤 예상 실적 */
  function showAcquire(id: string): void {
    const s = game!.state, a = Q.acquireInfo(s, id);
    if (!a) return;
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="rv-sheet acq-sheet"><div class="eyebrow"><i></i>경쟁사 인수 · ${esc(game!.dateLabel)}</div><div class="rv-head">${logo(id, 36)}<div><h2>${esc(a.name)} 인수${ib('term:경쟁사 인수')}</h2><p class="hint">인수하면 경쟁사 목록에서 빠지고 인수 브랜드${ib('term:인수 브랜드')} 「${esc(a.newName)}」(모델 ${a.models}종)가 됩니다.</p></div></div>
      <div class="tblwrap"><table class="tbl acq-t"><tr><th>연 매출 어림</th><td class="r">${money(a.revenue)}</td></tr><tr><th>평가액(연 매출 × ${config.rivalry.acquire.salesMult})</th><td class="r">${money(a.value)}</td></tr><tr><th>웃돈(${Math.round(config.rivalry.acquire.premium * 100)}%)</th><td class="r">${money(a.premium)}</td></tr><tr class="acq-sum"><th>인수 값</th><td class="r"><b>${money(a.price)}</b></td></tr></table></div>
      <p class="lbl" style="margin-top:12px">인수 뒤 예상 실적(지금 시장 기준 어림)</p>
      <div class="kpis">${kpi('월 판매', `${num(a.monthly)}<span>대</span>`)}${kpi('연 매출', money(a.yearRevenue))}${kpi('연 이익', money(a.yearProfit, true), a.yearProfit >= 0 ? 'pos' : 'neg')}${kpi('연 배당(본사)', money(a.yearDividend))}</div>
      <p class="lbl" style="margin-top:12px">본사 판매 변화 예상</p>
      <div class="kpis">${kpi('본사 월 판매', `${num(a.hqMonthly)} → ${num(a.hqMonthlyAfter)}<span>대</span>`)}${kpi('변화', `${Math.round(a.hqMonthlyAfter - a.hqMonthly) > 0 ? '+' : Math.round(a.hqMonthlyAfter - a.hqMonthly) < 0 ? '−' : ''}${num(Math.abs(a.hqMonthlyAfter - a.hqMonthly))}<span>대/월</span>`, Math.round(a.hqMonthlyAfter - a.hqMonthly) > 0 ? 'pos' : Math.round(a.hqMonthlyAfter - a.hqMonthly) < 0 ? 'neg' : '')}${kpi('본사 연 이익 변화', money(a.hqYearProfit, true), Math.round(a.hqYearProfit) > 0 ? 'pos' : Math.round(a.hqYearProfit) < 0 ? 'neg' : '')}</div>
      <p class="note">인수 브랜드 자체의 이익은 얇을 수 있지만, 경쟁사 하나가 빠지면 그 손님 일부가 본사 차로 옮겨 와 본사 판매가 늘어납니다(공장 생산 한도 안, 지금 시장 기준 어림).</p>
      <p class="note">지금 이 회사는 한 달 약 ${num(a.rivalMonthly)}대를 팝니다. 인수하면 손님 일부가 남은 경쟁사로 옮겨 가 브랜드 판매는 그보다 적게 잡았습니다. 자본 ${money(a.capital)}으로 시작하고(인수 값의 ${Math.round(config.rivalry.acquire.capital * 100)}%), 브랜드 평판 ${Math.round(a.rep)}, 전략은 성장 중심, 배당 비율 ${config.subs.defaultSub.dividend}%입니다. 자회사 수에 들어갑니다.</p>
      ${a.reason ? `<div class="badbox" style="margin-top:10px">${esc(a.reason)}</div>` : ''}
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="rivalOpen" data-v="${id}">← ${esc(a.name)}</button><button class="btn ink" data-act="acqDo" data-v="${id}" ${a.reason ? 'disabled' : ''}>인수하기 · ${money(a.price)}</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 1.0.0 고른 차 여러 대에 자동 가격 또는 광고를 한 번에(한 번에 한 종류: 되돌리기가 한 번에 되도록) */
  let bulk: { kind: 'policy' | 'mk'; v: string } | null = null;
  const bulkPolicy = (v: string): PricePolicy | null => (v === 'best' ? { kind: 'best' } : v.startsWith('base:') ? { kind: 'base', pct: Number(v.slice(5)) } : null);
  /** 고른 차마다: 바꿀 수 있는지, 이유, 지금 값 → 바꿀 값 */
  function bulkPlan(): { g: Generation; name: string; from: string; to: string; why: string | null; same: boolean }[] {
    const G = garageList().filter((g) => cmpSel.has(g.id));
    return G.map((g) => {
      const name = `「${nameOf(g)}」 ${g.number}세대`, pol = g.pricePolicy ?? null;
      if (!bulk) return { g, name, from: '', to: '', why: null, same: true };
      if (bulk.kind === 'mk') { const m = Number(bulk.v); return { g, name, from: `광고 ${MARKETING[g.marketing]}`, to: `광고 ${MARKETING[m]}`, why: g.status !== 'onSale' ? '이번 달 말 단종 예정이라 바꿀 수 없습니다' : null, same: g.marketing === m }; }
      const p = bulkPolicy(bulk.v), pn = (x: PricePolicy | null) => (x ? policyName(x) : '수동 가격');
      return { g, name, from: pn(pol), to: pn(p), why: g.status !== 'onSale' ? '이번 달 말 단종 예정이라 바꿀 수 없습니다' : g.clearance ? '가격 인하 판매 중이라 가격을 바꿀 수 없습니다' : null, same: JSON.stringify(pol) === JSON.stringify(p) };
    });
  }
  function showBulk(): void {
    if (!game) return;
    const G = garageList().filter((g) => cmpSel.has(g.id));
    if (!G.length) return err('바꿀 차를 표 왼쪽 네모로 고르세요.');
    const plan = bulkPlan(), ok = plan.filter((x) => !x.why && !x.same), pcts = config.pricePolicy.pctChoices;
    const b = (k: 'policy' | 'mk', v: string, label: string, sub: string) => `<button data-act="bulkPick" data-k="${k}" data-v="${v}" aria-pressed="${bulk?.kind === k && bulk.v === v}">${label}<small>${sub}</small></button>`;
    const rows = G.map((g) => { const x = plan.find((y) => y.g === g)!; return `<tr><td>${esc(nameOf(g))} <small class="hint">${g.number}세대</small></td><td>${policyShort(g)}</td><td>${MARKETING[g.marketing]}</td><td class="${x.why ? 'neg' : ''}">${!bulk ? '' : x.why ? `바꿀 수 없음 · ${esc(x.why)}` : x.same ? '이미 같음' : `→ ${esc(x.to)}`}</td></tr>`; }).join('');
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="bulk-sheet"><div class="eyebrow"><i></i>차고 · 여러 대 한 번에</div><h2>고른 ${G.length}대 한 번에 바꾸기</h2>
      <p class="hint">자동 가격과 광고 중 하나를 고르세요. 한 번에 한 가지를 바꾸며, 바꾼 뒤 같은 주 안에는 메뉴나 알림의 [되돌리기]로 한 번에 되돌릴 수 있습니다.</p>
      <p class="lbl" style="margin-top:12px">자동 가격${ib('term:자동 가격')}</p><div class="seg px-policy">${b('policy', 'manual', '수동', '직접')}${pcts.map((p) => b('policy', `base:${p}`, `기준가 ${p}%`, '유지')).join('')}${b('policy', 'best', '최고 이익', '매달')}</div>
      <p class="lbl">광고${ib('term:광고')} · 한 대에 매달</p><div class="seg">${MARKETING.map((m, i) => b('mk', String(i), m, i ? money(config.awareness.marketingCost[i]) : '0원')).join('')}</div>
      <div class="tblwrap"><table class="tbl bulk-t"><tr><th>차종</th><th>지금 가격</th><th>지금 광고</th><th>바뀌는 것</th></tr>${rows}</table></div>
      ${bulk?.kind === 'policy' && bulk.v === 'manual' ? '<p class="note">수동으로 바꾸면 지금 가격을 그대로 두고, 앞으로는 직접 바꿀 때만 바뀝니다.</p>' : ''}
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="closeSheet">닫기</button><button class="btn ink" data-act="bulkApply" ${ok.length ? '' : 'disabled'}>${ok.length ? `${ok.length}대에 적용` : '바꿀 차가 없습니다'}</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  async function applyBulk(): Promise<void> {
    if (!game || !bulk) return;
    const plan = bulkPlan(), ok = plan.filter((x) => !x.why && !x.same), no = plan.filter((x) => x.why), same = plan.filter((x) => !x.why && x.same), k = bulk;
    if (!ok.length) return err('바꿀 수 있는 차가 없습니다.');
    const what = k.kind === 'mk' ? `광고를 '${MARKETING[Number(k.v)]}'(한 대에 매달 ${Number(k.v) ? money(config.awareness.marketingCost[Number(k.v)]) : '0원'})${josa(MARKETING[Number(k.v)].slice(-1), '으로/로')}` : `자동 가격을 '${ok[0].to}'${josa(ok[0].to.slice(-1), '으로/로')}`;
    const text = `${ok.length}대의 ${what} 바꿀까요?\n\n대상\n${ok.map((x) => `${x.name}: ${x.from} → ${x.to}`).join('\n')}${no.length ? `\n\n바꿀 수 없는 ${no.length}대(그대로 둠)\n${no.map((x) => `${x.name}: ${x.why}`).join('\n')}` : ''}${same.length ? `\n\n이미 같은 ${same.length}대: ${same.map((x) => x.name).join(', ')}` : ''}`;
    if (!(await ask(text, `${ok.length}대에 적용`))) return;
    let n = 0;
    for (const x of ok) { // 같은 종류 명령을 이어서(chain) 보내 한 번에 되돌린다
      const r = k.kind === 'mk' ? game.command({ type: 'setMarketing', generationId: x.g.id, marketing: Number(k.v) }, n > 0) : game.command({ type: 'setPricePolicy', generationId: x.g.id, policy: bulkPolicy(k.v) }, n > 0);
      if (run(r)) { n++; if (k.kind === 'policy') garagePrice.delete(x.g.id); }
    }
    sheet.hidden = true; bulk = null;
    if (n) toast(`${n}대의 ${k.kind === 'mk' ? '광고' : '자동 가격'}를 바꿨습니다.${no.length ? ` 바꿀 수 없는 ${no.length}대는 그대로 뒀습니다.` : ''}`);
    render();
  }
  function garageView(): View {
    const s = game!.state, gens = sellingGens(s), p = s.projects[0];
    const devCard = s.projects.map((p) => `<div class="card"><p class="lbl">개발 중</p><h2>${esc(p.name)}</h2><p class="hint">${p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`} · 남은 결함 약 ${p.defectEst}개</p><div class="row" style="margin-top:10px"><button class="btn" data-act="devSel" data-id="${p.id}">개발 화면 보기</button></div></div>`).join('');
    if (!gens.length) {
      const any = allGens(s).length > 0;
      const ovh = `<div class="ov empty"><div><h3>${p ? '개발 중인 차가 있습니다' : any ? '판매 중인 차가 없습니다' : '첫 차를 기획할 차례입니다'}</h3><p>${p ? `「${esc(p.name)}」${josa(p.name, '을/를')} 개발하고 있습니다. 시험이 끝나면 출시할 수 있습니다.` : '차체와 고객층을 정하면 직원들이 1년 가까이 설계와 시험을 합니다.'}</p>${p ? '<button class="go dark" data-act="devHome">개발 보기</button>' : '<button class="go" data-act="plan">신차 기획</button>'}</div></div>`;
      const intro = `<div class="card"><p class="lbl">${esc(s.companyName)}</p><h2>${p ? '개발이 끝나면 출시할 수 있습니다' : '차고가 비어 있습니다'}</h2><p class="hint" style="margin-top:8px">회사의 한 바퀴: <b>기획</b> → <b>설계</b>(${config.dev.designWeeks[0]}~${config.dev.designWeeks[config.dev.designWeeks.length - 1]}주) → <b>시험</b>(결함 줄이기) → <b>출시</b>(가격·색) → 매달 <b>판매</b>. 현금이 ${diffOf(s).bankruptcyMonths}개월 넘게 마이너스면 파산합니다.</p>${p ? '<p class="hint" style="margin-top:6px">개발을 기다리는 동안 회사 화면에서 직원을 뽑거나 연구 화면에서 연구를 시작할 수 있습니다.</p>' : '<button class="go" data-act="plan">신차 기획 시작</button>'}</div>`;
      return { ov: ovh, panel: intro + devCard + subCarsCard(), look: null };
    }
    if (garageSum && gens.length >= 2) return garageTable();
    const GL = garageList(), g = GL.find((x) => x.id === garageId) ?? GL[0], e = currentEdition(g), name = nameOf(g), gi = GL.indexOf(g);
    garageId = g.id;
    const price = garagePrice.get(g.id) ?? e.price, up = Q.unitProfit(g.body, g.powertrain, e.tier, e.options, price, Q.genCostMult(s, g), Q.ptCostAdd(s, g.powertrain, e.battery, g.evPlatform)), lines = Q.linesOf(s);
    const lastSale = g.sales.length ? g.sales[g.sales.length - 1] : null, lb = Q.lifeBar(s, g), ending = g.status === 'ending';
    const ovh = ovTop(`차고 · ${ending ? '이번 달 말 단종' : '판매 중'}${lines >= 2 ? ` · 생산 라인 <span class="lines">${gens.length}/${lines}</span>` : ''}`, `${esc(name)}<small>${editionName(g)}</small><button class="btn rn-btn" data-act="renameOpen" data-id="${Q.nameplateOf(s, g.id)?.id ?? -1}">이름 변경</button>`, `${derivLine(g) ? `${derivLine(g)} · ` : ''}${specLine(g.body, g.powertrain, e.tier, g.segment)} · ${paintName(e.color)}`, launchWhen(g))
      + ovHint
      + (gens.length > 1 ? `<button class="switch l" data-act="gprev" aria-label="이전 차">‹</button><button class="switch r" data-act="gnext" aria-label="다음 차">›</button><div class="ov tr gnav"><button class="btn" data-act="gsum">← 전 차종</button><span>${gi + 1}/${GL.length}</span></div>` : '');
    const sales = g.sales.slice(-12), mx = Math.max(1, ...sales);
    const chart = sales.length ? `<svg class="mini" viewBox="0 0 300 64" preserveAspectRatio="none" role="img" aria-label="최근 월별 판매">${sales.map((v, i) => { const w = 300 / 12, h = (v / mx) * 56; return `<rect x="${(i * w + 2).toFixed(1)}" y="${(60 - h).toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" class="${i === sales.length - 1 ? 'b-now' : 'b-ink'}"/>`; }).join('')}</svg>` : '';
    // 0.9.0 핵심 수치 4개(지난달 판매·대당 이익·수명·평론)는 무대 아래 띠에, 패널의 성적 카드는 누적·월 이익·판매 그래프·조언
    const gup = Q.generationUnitProfit(g, s), gmp = carMonthProfit(g);
    const keys = `<div class="key"><small>지난달 판매</small><b>${lastSale === null ? '—' : `${qty(lastSale)}<span>대</span>`}</b></div><div class="key"><small>대당 이익${ib('term:대당 이익')}</small><b class="${gup >= 0 ? 'pos' : 'neg'}">${unitSmall(money(gup, true))}</b></div>
      <div class="key key-life"><small>수명${ib('term:수명')}</small><div class="life" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(lb * 100)}" aria-label="수명"><u style="width:${(lb * 100).toFixed(1)}%"></u></div><b>${Math.round(lb * 100)}<span>%</span></b></div>
      <div class="key key-rv">${ring(g.reviewAvg)}<div><small>평론 평균${ib('term:평론 평균')}</small><b>${score(g.reviewAvg)}${g.masterpiece ? '<span>명차</span>' : ''}${g.awards?.length ? `<span class="aw-chip">수상 ${g.awards.length}</span>` : ''}</b></div></div>`;
    const card1 = `<div class="card perf-card"><p class="lbl">이 차의 성적</p><p class="hint launch-when" style="margin:-4px 0 4px">${launchWhen(g)}</p><p class="hint eq-line" style="margin:0 0 10px">${esc(EQ.equipLine(edEquip(e)))}${(() => { const ei = genEquipInfo(g); return ei.legacy ? `<br><span class="eq-legacy">${esc(ei.legacyText)}</span>` : ei.totals.missingExpected.length ? `<br><span class="why">장비 기대 미달: ${esc(ei.totals.missingExpected.join('·'))}</span>` : ''; })()}</p>${evLine(g)}<div class="kpis">${kpi('누적 판매', `${qty(g.totalSold)}<span>대</span>`)}${kpi('지난달 월 이익', money(gmp, true), gmp >= 0 ? 'pos' : 'neg')}</div>
      ${chart ? `<p class="lbl" style="margin-top:12px">최근 판매(달마다)</p>${chart}` : ''}
      <p class="hint">수명은 출시 뒤 시간이 지날수록 줄고, 줄수록 판매가 줄어듭니다.</p>${genWorldCard(g)}
      <button class="btn rv-cmp-btn" data-act="rivalCmp" data-id="${g.id}" style="width:100%;margin-top:8px">같은 차급의 경쟁 차와 비교</button>
      ${g.awards?.length ? `<p class="hint aw-line" style="margin-top:8px"><b>수상${ib('term:시상식')}</b> ${g.awards.map(esc).join(' · ')}${(g.awardUntil ?? -1) > monthOf(s.week) ? ` <small>(판매 +${Math.round(config.rivalry.awards.salesBoost * 100)}%, ${(g.awardUntil ?? 0) - monthOf(s.week)}개월 남음)</small>` : ''}</p>` : ''}
      ${(() => { const w = Q.activeWar(s); if (!w || w.body !== g.body) return ''; const rn = s.rivals.find((r) => r.id === w.rivalId)?.name ?? ''; return `<div class="warnbox ev-line" style="margin-top:8px">가격 전쟁${ib('term:가격 전쟁')}: ${esc(rn)}${josa(rn, '이/가')} 이 차급 가격을 ${Math.round(w.cut * 100)}% 내렸습니다(${w.until - monthOf(s.week)}개월 남음). ${w.follow ? `나도 따라 내려 이 차는 ${num(Math.round(e.price * (1 - w.cut)))}만원에 팔리고, 끝나면 ${num(e.price)}만원으로 돌아갑니다.` : w.follow === false ? '가격을 지키고 있습니다. 그동안 판매가 조금 줄어듭니다.' : '답을 기다리고 있습니다.'}</div>`; })()}
      ${adviceLine(g)}${orderLine(g)}${Q.eventImpactOn(s, g.id).map((t) => `<div class="warnbox ev-line" style="margin-top:8px">${esc(t)}</div>`).join('')}</div>`;
    const gn = Q.priceForecast(s, g.id, price) ?? 0, gpr = monthProfit(gn, up, g.marketing);
    const card2 = ending ? '' : `<div class="card price-card"><p class="lbl">판매 가격</p>${priceBlock('gprice', { price, body: g.body, up, sales: `약 ${num(gn)}<span>대</span>`, profit: money(gpr, true), pcls: gpr >= 0 ? 'pos' : 'neg', gen: g.id })}
      <p class="hint px-note">이번 달 어림입니다(공장 한도 ${num(Q.capacityOf(s))}대). 월 이익은 광고비를 빼고 직원 월급·유지비는 넣지 않은 값입니다.</p>
      <div class="row" id="gprice-apply" data-live style="margin-top:8px"><button class="btn ink" data-act="setPrice" data-id="${g.id}" ${price === e.price ? 'disabled' : ''}>가격 바꾸기</button><span class="hint">지금 가격 ${num(e.price)}만원 · 다음 결산부터 반영</span></div>${bestRow('gprice', `g${g.id}`, price, ` data-id="${g.id}"`)}${policyBox(g)}
      <hr><p class="lbl">광고${ib('term:광고')} · 매달 광고비가 듭니다</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="setMk" data-id="${g.id}" data-v="${i}" aria-pressed="${g.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div></div>`;
    const np = Q.nameplateOf(s, g.id)!, fl = elig(Q.faceliftEligibility(s, g.id)), fc = elig(Q.fullChangeEligibility(s, np.id)), rf = Q.retrofitInfo(s, g.id);
    // 1.3.0 파생 차종: 풀체인지 자리는 "다음 세대(파생)"(바탕 차의 지금 세대로 다시 만든다). 바탕 차에는 [파생 모델]
    const bnp = np.baseOf !== undefined ? s.nameplates.find((x) => x.id === np.baseOf) : undefined, bg = bnp?.generations.at(-1), busy = busyReason();
    const dn = (() => { if (!bnp) return null; if (!bg || bg.status !== 'onSale') return { ok: false, reason: `바탕 차 「${bnp.name}」${josa(bnp.name, '이/가')} 판매 중이 아닙니다.` }; const o = Q.derivativeOptions(s, bg.id).find((x) => x.id === np.variant); return busy && o?.ok ? { ok: false, reason: busy } : { ok: !!o?.ok, reason: o?.reason ?? null }; })();
    const blk = Q.planEntries(s).blockedBy, why = (k: string, e: { ok: boolean; reason: string | null }) => e.ok || e.reason === blk ? '' : `<p class="note why" data-for="${k === '페이스리프트' ? 'lift' : 'full'}">${k}: ${esc(e.reason ?? '')}</p>`; // 규제로 막힌 이유는 아래 한 번만
    const rfNames = rf.options.map((o) => esc(optionById(o).name)).join('·');
    const card3 = `<div class="card next-step"><p class="lbl">이 차의 다음 단계 <span class="lblterms">페이스리프트${ib('term:페이스리프트')} 풀체인지${ib('term:풀체인지')}</span></p><div class="row"><button class="btn" data-act="goLift" data-id="${g.id}" ${fl.ok ? '' : 'disabled'}>페이스리프트</button>${dn ? `<button class="btn" data-act="goDerive" data-id="${bg?.id ?? -1}" data-v="${np.variant}" ${dn.ok ? '' : 'disabled'}>다음 세대(파생)</button>` : `<button class="btn" data-act="goFull" data-id="${np.id}" ${fc.ok ? '' : 'disabled'}>풀체인지</button><button class="btn" data-act="goDerive" data-id="${g.id}" ${g.status === 'onSale' && !busy ? '' : 'disabled'}>파생 모델</button>`}${ib('term:파생 모델')}</div>
      ${why('페이스리프트', fl)}${dn ? why('다음 세대(파생)', dn) : why('풀체인지', fc)}${blk ? `<div class="warnbox reg-block" style="margin-top:10px">${esc(blk)}<button class="btn" data-act="goCo" data-v="research" style="width:100%;margin-top:8px">연구 화면</button></div>` : ''}
      ${rf.needed ? `<hr><div class="retrofit"><p class="lbl">의무 장비${ib('term:유예 기간')}</p><p class="hint">규제로 의무가 된 <b>${rfNames}</b>${josa(rfNames, '을/를')} 판매 중인 이 차에 넣습니다. 한 번에 ${money(rf.cost)}, 대당 원가 +${num(rf.unitCostAdd)}만원.</p><button class="btn ink" data-act="retrofit" data-id="${g.id}" ${rf.ok ? '' : 'disabled'} style="width:100%;margin-top:8px">의무 장비 넣기</button>${rf.ok || rf.reason === blk ? '' : `<p class="note why">${esc(rf.reason ?? '')}</p>`}</div>` : ''}
      <hr><div class="toggle ga-one"><span>세대교체 위임${ib('term:세대교체 위임')}<small>${esc(gaLine(gaCar(np.id)))}</small></span><span class="ga-btns">${gaLaunchBtn(np.id)}${gaBtn(np.id)}</span></div>${!gaInfo().available && !gaCar(np.id)?.on ? `<p class="note why">${esc(gaInfo().whyNot ?? '')}</p>` : ''}
      ${I.rescueBlock(s, g.id)}
      <hr><button class="btn danger" data-act="discontinue" data-id="${g.id}" ${ending ? 'disabled' : ''} style="width:100%">${ending ? '이번 달 말에 단종됩니다' : '단종하기'}</button></div>`;
    const planCard = s.projects.length < Q.devTeams(s) ? `<div class="card"><p class="lbl">다음 차</p><p class="hint">판매하는 동안 다음 차를 미리 개발할 수 있습니다. ${Q.hasFreeLine(s) ? `생산 라인이 ${lines - gens.length}개 비어 있어 새 차를 함께 팔 수 있습니다.` : `생산 라인 ${lines}개가 모두 차 있어, 새 차를 내려면 지금 차를 단종하거나 공장을 증설해야 합니다.`}</p><button class="go dark" data-act="plan">신차 기획</button></div>` : '';
    // 0.9.0 넓어진 패널은 두 칸: 왼쪽 가격 카드 + 판매 요인(접힘), 오른쪽 성적 + 이 차의 손익(접힘)·다음 단계(태블릿 가로에서 가격과 성적이 스크롤 없이 함께 보이게)
    const F = Q.salesFactors(s, g.id), P = Q.modelPnL(s, g.id);
    const fac = F ? fold('fac', '판매 요인', esc(F.summary ?? '판매를 크게 깎거나 올리는 요인이 없습니다'), I.factorsCard(s, g.id)) : '';
    const pnl = (P ? fold('pnl', '이 차의 손익', `개발비 뺀 이익 <b class="${P.net >= 0 ? 'pos' : 'neg'}">${money(P.net, true)}</b>${P.recovered ? ' · 회수함' : ''}`, I.pnlCard(s, g.id)) : '')
      + fold('crit', '평론가 시승기', `평론 평균 ${score(g.reviewAvg)}`, critiqueList(g.id)) + (g.wins?.length ? fold('wins', '직원 성과', `개발 중 ${g.wins.length}건`, winsList(g.wins)) : ''); // 1.3.0
    // 키 큰 화면(1366×1024 등): 성적 카드(판매 그래프·조언)를 무대 아래로 옮겨 무대를 차에 맞는 비율로 줄이고 오른쪽 칸 스크롤을 줄인다
    const t = tallStage(), c1 = t ? '' : card1;
    return { ov: ovh, panel: card2 ? pcols(card2 + fac, c1 + pnl + card3 + devCard + planCard + subCarsCard()) : c1 + fac + pnl + card3 + devCard + planCard + subCarsCard(), look: genLook(g), keys: keys + (t ? `<div class="key-more">${card1}</div>` : '') };
  }

  // ----- 신차 기획 첫 화면(8.7) -----
  const EQ_WORD = (q: number) => (q < 0.03 ? '아직 없음' : q < 0.1 ? '조금' : q < 0.18 ? '보통' : '높음');
  const equityBar = (q: number) => `<div class="equity" title="이름값 ${Math.round(q * 100)}점"><span>이름값${ib('term:이름값')}</span><div class="life"><u style="width:${Math.min(100, (q / 0.3) * 100).toFixed(1)}%"></u></div><b>${EQ_WORD(q)}</b></div>`;
  /** 갈래(풀체인지·페이스리프트) 카드의 가능 여부: 차종 하나라도 되면 가능, 아니면 가장 빨리 풀리는 차종의 이유 */
  function branchOk(list: Q.NameplateEntry[], k: 'fullChange' | 'facelift'): { ok: boolean; reason: string | null } {
    const busy = busyReason();
    if (busy) return { ok: false, reason: busy };
    if (list.some((e) => e[k].ok)) return { ok: true, reason: null };
    const e = [...list].sort((a, b) => (a[k].monthsLeft || 1e9) - (b[k].monthsLeft || 1e9))[0];
    return { ok: false, reason: e ? `「${e.name}」 ${e[k].reason}` : '아직 낸 차종이 없습니다.' };
  }
  function startView(): View {
    const s = game!.state, ent = Q.planEntries(s), list = ent.nameplates, fc = branchOk(list, 'fullChange'), fl = branchOk(list, 'facelift');
    const choice = (act: string, v: string, ok: boolean, head: string, sub: string, why: string | null) =>
      `<button class="choice" data-act="${act}" data-v="${v}" ${ok ? '' : 'disabled'} aria-pressed="${startSel === v}"><b>${head}</b><small>${sub}</small>${ok || !why || ent.blockedBy && why.endsWith(ent.blockedBy) ? '' : `<em class="why">${esc(why)}</em>`}</button>`;
    const blocked = ent.blockedBy ? `<div class="badbox reg-block" style="margin-bottom:12px">지금은 개발을 시작할 수 없습니다. ${esc(ent.blockedBy)}<button class="btn" data-act="goCo" data-v="research" style="width:100%;margin-top:8px">연구 화면</button></div>` : '';
    const card1 = `<div class="card"><p class="lbl">신차 기획</p><h2>어디서 시작할까요?</h2>${blocked}<div class="choices">
      ${choice('pickNew', 'new', ent.newModel.ok, '새 차종 만들기', '새 이름으로 1세대를 만듭니다.', ent.newModel.reason)}
      ${choice('startSel', 'full', fc.ok, '풀체인지', '이름과 이름값을 이어받아 다음 세대를 새로 만듭니다.', fc.reason)}
      ${choice('startSel', 'lift', fl.ok, '페이스리프트', '판매 중인 차의 얼굴과 옵션만 바꿉니다.', fl.reason)}</div></div>`;
    const rows = list.map((e) => {
      const f = elig(e.fullChange), l = elig(e.facelift);
      return `<div class="np" data-np="${e.nameplateId}"><div class="nphead"><b>${esc(e.name)}</b><small>${e.generation}세대 · ${e.status === 'onSale' ? '판매 중' : e.status === 'ending' ? '이번 달 단종' : '단종'}</small></div>
        <p class="hint">최근 평론 <b>${score(e.reviewAvg)}</b> · 누적 판매 <b>${num(e.totalSold)}</b>대</p>${equityBar(e.equity)}
        <div class="row"><button class="btn ${startSel === 'full' ? 'ink' : ''}" data-act="goFull" data-id="${e.nameplateId}" ${f.ok ? '' : 'disabled'}>풀체인지</button><button class="btn ${startSel === 'lift' ? 'ink' : ''}" data-act="goLift" data-id="${e.generationId}" ${l.ok ? '' : 'disabled'}>페이스리프트</button></div>
        ${f.ok || f.reason === ent.blockedBy ? '' : `<p class="note why">풀체인지: ${esc(f.reason ?? '')}</p>`}${l.ok || l.reason === ent.blockedBy ? '' : `<p class="note why">페이스리프트: ${esc(l.reason ?? '')}</p>`}</div>`;
    }).join('');
    const card2 = `<div class="card" id="np-list"><p class="lbl">내 차종 ${list.length}개</p><div class="nps">${rows}</div><p class="note">이름값은 평론과 누적 판매로 쌓입니다. 이름값이 높을수록 풀체인지한 다음 세대의 출시 초기 인지도가 높습니다.</p>
      <button class="btn" data-act="cancelPlan" style="width:100%;margin-top:8px">돌아가기</button></div>`;
    const sel = sellingGens(s)[0];
    return { ov: ovTop('신차 기획', '어디서 시작할까요?', '새 차종 · 풀체인지 · 페이스리프트'), panel: card1 + card2, look: sel ? genLook(sel) : null };
  }

  // ----- 기획 초안 유지(탭 이동·저장·불러오기) -----
  /** 개발 탭을 누르면: 기획 중이면 하던 기획 단계로, 아니면 개발 화면 */
  const devScreen = (): Screen => (draft ? 'plan' : lift ? 'lift' : 'dev');
  const draftName = (): string => draft ? (draft.nameplateId ? game!.state.nameplates.find((n) => n.id === draft!.nameplateId)?.name ?? '' : draft.name.trim() || defaultName()) : lift ? nameOf(Q.generationById(game!.state, lift.genId)!) : '';
  /** 새 기획을 시작하기 전에 지금 초안을 버릴지 묻는다 */
  const dropDraft = async (): Promise<boolean> => {
    if (!draft && !lift) return true;
    if (!(await ask(`기획 중인 「${draftName()}」${lift ? ' 페이스리프트' : ''} 초안을 버리고 새로 기획할까요?`, '새로 기획', true))) return false;
    draft = null; lift = null; draftNote = ''; return true;
  };
  /** 저장 데이터의 초안 → 화면 상태(모양만 검사하고, 값이 맞는지는 fixDraft·fixLift가 화면을 그릴 때 본다) */
  function restorePlan(p: S.PlanSave | undefined): void {
    if (!p || typeof p !== 'object') return;
    const obj = (x: unknown) => !!x && typeof x === 'object';
    if (obj(p.draft) && typeof p.draft!.body === 'string' && obj(p.draft!.direction) && Array.isArray(p.draft!.options) && Array.isArray(p.draft!.team)) {
      draft = p.draft as unknown as Draft; planTab = (p.planTab === 'sum' || ALL_TABS.some(([k]) => k === p.planTab) ? p.planTab : 'body') as PlanTab;
    } else if (obj(p.lift) && Number.isInteger(p.lift!.genId) && Array.isArray(p.lift!.options) && Array.isArray(p.lift!.team)) { const L = p.lift as unknown as LiftSet; if (Number.isInteger(L.faceSeed) && Number.isInteger(L.tier)) lift = L; }
    if (obj(p.launch) && Number.isInteger(p.launch!.pid) && Q.projectById(game!.state, p.launch!.pid)) { const L = p.launch as unknown as LaunchSet; if ([L.price, L.marketing, L.wheels].every(Number.isFinite) && typeof L.color === 'string') launch = L; }
  }
  /** 낡은 초안 맞추기: 맞지 않는 값만 기본값으로 바꾸고 무엇을 바꿨는지 한 줄로 남긴다 */
  function fixDraft(d: Draft): void {
    const s = game!.state, y = yearOf(s.week), out: string[] = [];
    // 저장 파일에서 온 값의 모양부터 맞춘다(틀리면 기본값)
    const base = newDraft(), int = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 0xffffffff;
    if (typeof d.name !== 'string') d.name = '';
    if (!SEGMENTS.some((g) => g.id === d.segment)) d.segment = base.segment;
    if (!(d.budget in BUDGET)) d.budget = base.budget;
    if (!config.dev.designWeeks.includes(d.designWeeks)) d.designWeeks = base.designWeeks;
    if (!STATS.every((k) => Number.isInteger(d.direction[k]) && d.direction[k] >= 0 && d.direction[k] <= config.dev.dirMax)) d.direction = { ...base.direction };
    if (!int(d.chassisSeed)) d.chassisSeed = base.chassisSeed;
    if (!int(d.faceSeed)) d.faceSeed = base.faceSeed;
    if (typeof d.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(d.color)) d.color = base.color;
    if (!Number.isInteger(d.nameplateId) || (d.nameplateId && !s.nameplates.some((n) => n.id === d.nameplateId))) { d.nameplateId = 0; out.push('대상 차종을 찾을 수 없어 새 차종으로'); }
    d.options = d.options.filter((o) => typeof o === 'string'); d.team = d.team.filter((x) => Number.isInteger(x));
    const bodies = Q.bodiesAt(s).map((b) => b.id), pts = Q.powertrainsAt(s).map((x) => x.id), opts = new Set(Q.optionsAt(s).map((o) => o.id));
    if (!bodies.includes(d.body)) { out.push(`차체를 ${bodyById(bodies[0]).name}${josa(bodyById(bodies[0]).name, '으로/로')}`); d.body = bodies[0]; }
    if (!pts.includes(d.powertrain)) { out.push(`동력을 ${powertrainById(pts[0]).name}${josa(powertrainById(pts[0]).name, '으로/로')}`); d.powertrain = pts[0]; }
    if (d.battery !== undefined && !Q.BATTERIES.includes(d.battery)) delete d.battery; // 1.2.0 저장 파일에서 온 배터리 값
    const nt = powertrainById(d.powertrain).tiers.length; if (!(d.tier >= 1 && d.tier <= nt)) { d.tier = Math.min(2, nt); out.push('동력 등급을 표준으로'); }
    { const e = eqOf(d), lost = Object.keys(e).filter((o) => !opts.has(o)); setEquip(d, Object.fromEntries(Object.entries(e).filter(([o]) => opts.has(o)))); if (lost.length) out.push(`쓸 수 없는 장비 ${lost.length}개를 뺌`); } // 1.1.0 장비 구성 기준(options는 파생)
    const team = keepIdle(d.team); if (team.length !== d.team.length) { out.push(`다른 일을 맡았거나 회사를 떠난 직원 ${d.team.length - team.length}명을 팀에서 뺌`); d.team = team; }
    if (d.year !== undefined && d.year !== y) out.push(`해가 바뀌어(${d.year}년 → ${y}년) 예상 등급을 다시 계산함`);
    d.year = y;
    if (out.length) draftNote = `초안을 지금 상황에 맞췄습니다: ${out.join(', ')}.`;
  }
  function fixLift(L: LiftSet): void {
    const s = game!.state, opts = new Set(Q.optionsAt(s).map((o) => o.id)), out: string[] = [];
    { const e = eqOf(L), lost = Object.keys(e).filter((o) => !opts.has(o)); setEquip(L, Object.fromEntries(Object.entries(e).filter(([o]) => opts.has(o)))); if (lost.length) out.push(`쓸 수 없는 장비 ${lost.length}개를 뺌`); }
    const team = keepIdle(L.team); if (team.length !== L.team.length) { out.push(`다른 일을 맡았거나 회사를 떠난 직원 ${L.team.length - team.length}명을 팀에서 뺌`); L.team = team; }
    if (out.length) draftNote = `초안을 지금 상황에 맞췄습니다: ${out.join(', ')}.`;
  }
  const noteBox = () => (draftNote ? `<div class="warnbox draft-note" style="margin-bottom:12px">${esc(draftNote)}</div>` : '');

  // ----- 신차 기획(새 차종·풀체인지) -----
  function newDraft(npId = 0): Draft {
    const s = game!.state, n = npId ? s.nameplates.find((x) => x.id === npId) : undefined, prev = n?.generations.at(-1);
    const seeds = { nameplateId: npId, chassisSeed: Q.lookCandidates(s, npId, 'chassis')[0], faceSeed: Q.lookCandidates(s, npId, 'face', 'nextGen')[0], team: idleDev().map((x) => x.id) };
    if (n && prev) { // 0.8.0 전작 그대로: 고객층·동력·옵션에 개발 방향·예산·설계 기간까지(예전 저장의 세대는 기본값). 쓸 수 없게 된 값은 fixDraft가 맞춘다
      const e = currentEdition(prev), opts = new Set(Q.optionsAt(s).map((o) => o.id)), pl = prev.plan, req = new Set(Q.requiredOptions(s));
      const d: Draft = { name: n.name, body: prev.body, segment: prev.segment, powertrain: prev.powertrain, tier: e.tier, options: e.options.filter((o) => opts.has(o) && !req.has(o)), direction: pl ? { ...pl.direction } : { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: pl?.budget ?? 'normal', designWeeks: pl?.designWeeks ?? config.dev.designWeeks[1] ?? config.dev.designWeeks[0], color: PAINT[(Math.max(0, PAINT.findIndex((p) => p[1] === e.color)) + 3) % PAINT.length][1], mode: 'sum', ...seeds }; // 1.0.0 풀체인지는 새 색을 제안
      // 1.0.0 풀체인지 기본 모양: 전작과 충분히 다른 첫 후보(옆모습·얼굴)
      const base = lookOf({ body: d.body, powertrain: d.powertrain, tier: d.tier, color: d.color, wheels: 1, year: yearOf(s.week), chassisSeed: d.chassisSeed, faceSeed: d.faceSeed });
      d.chassisSeed = LP.firstDistinct('chassis', planCtx(d, 'chassis', base)); d.faceSeed = LP.firstDistinct('face', planCtx(d, 'face', { ...base, chassisSeed: d.chassisSeed }));
      setEquip(d, edEquip(e, d.options), 'prev'); // 1.1.0 풀체인지는 전작 구성을 물려받는다
      if (e.battery) d.battery = e.battery; // 1.2.0 전작 배터리 용량
      return d;
    }
    const first = !s.nameplates.length && !s.projects.length && (() => { try { return localStorage.getItem(PLANNED_KEY) !== '1'; } catch { return true; } })();
    const d0: Draft = { name: '', body: Q.bodiesAt(s)[0].id, segment: 'worker', powertrain: Q.powertrainsAt(s)[0].id, tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.dev.designWeeks[1] ?? config.dev.designWeeks[0], color: PAINT[0][1], mode: first ? 'step' : 'sum', ...seeds };
    d0.segment = Q.planPreview(s, d0).bestSegment; // 기본 고객층: 이 차가 가장 매력적인 고객층
    setEquip(d0, EQ.recommendedEquip(s, d0.body, d0.segment, d0.powertrain), 'rec'); // 1.1.0 새 기획은 추천 구성으로 시작
    return d0;
  }
  // ----- 1.1.0 장비 구성: equip이 기준, options(넣은 장비 전부)는 지금 sim에 넘기는 파생값 -----
  /** 판의 장비 구성(sim에 equip이 없으면 옵션 = 모두 기본 장비) */
  const edEquip = (e: { options: string[] }, fallback?: string[]): EQ.Equip => { const x = (e as { equip?: EQ.Equip }).equip; return x ? { ...x } : EQ.fromOptions(fallback ?? e.options); };
  function setEquip(o: { equip?: EQ.Equip; options: string[]; equipMode?: string }, e: EQ.Equip, mode?: 'rec' | 'prev' | 'custom'): void {
    const req = new Set(Q.requiredOptions(game!.state)); o.equip = Object.fromEntries(Object.entries(e).filter(([k]) => !req.has(k))); o.options = EQ.toOptions(o.equip);
    if (mode && 'equipMode' in o || mode) o.equipMode = mode;
  }
  const eqOf = (o: { equip?: EQ.Equip; options: string[] }): EQ.Equip => (o.equip ??= EQ.fromOptions(o.options));
  /** 판매 중인 세대의 장비 정보(지금 판의 구성). legacy는 판에 붙은 표시도 본다 */
  const genEquipInfo = (g: Generation) => { const ed = currentEdition(g), ei = EQ.equipInfo(game!.state, { body: g.body, segment: g.segment, powertrain: g.powertrain, equip: edEquip(ed), equipLegacy: !!ed.equipLegacy }); return { ...ei, legacy: !!ei.totals.legacy, legacyText: ei.totals.legacyText ?? '옛 구성 · 다음 페이스리프트부터 장비 기대가 적용됩니다' }; };
  const MODE_WORD = { rec: '추천 구성', prev: '전작 구성', custom: '직접 고름' } as const;
  /** 전작 이후 기대가 바뀐 장비(규제 의무 장비는 자동으로 들어가므로 빼고 보인다) */
  const eqChanges = (e: EQ.Equip, body: string, seg: string) => { const req = new Set(Q.requiredOptions(game!.state)); return EQ.equipChanges(game!.state, e, body, seg).filter((c) => !req.has(c.id)); };
  /** 1.1.0 개발 중(설계 단계) 장비 다시 고르기 창 */
  let projEq: { pid: number; options: string[]; equip?: EQ.Equip; equipMode?: string } | null = null;
  function showProjEquip(): void {
    const s = game!.state, p = projEq && Q.projectById(s, projEq.pid); if (!p || !projEq) return;
    sheetBody.innerHTML = `<div class="proj-eq"><div class="eyebrow"><i></i>개발 중 · ${esc(p.name)}</div><h2>장비 다시 고르기</h2><p class="hint">설계 단계에서만 바꿀 수 있고 비용은 들지 않습니다.</p>
      ${EQ.equipPicker(s, { body: p.body, segment: p.segment, powertrain: p.powertrain, tier: p.tier, equip: eqOf(projEq) }, 'proj', ib)}
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="closeSheet">닫기</button><button class="btn ink" data-act="projEquipApply">이 구성으로 바꾸기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 장비 고르기 칸(기획·페이스리프트 공통) */
  function equipView(t: 'plan' | 'lift'): string {
    const s = game!.state;
    if (t === 'plan' && draft) { const e = eqOf(draft), prev = draft.nameplateId ? s.nameplates.find((n) => n.id === draft!.nameplateId)?.generations.at(-1) : undefined;
      return EQ.equipPicker(s, { ...draft, equip: e }, 'plan', ib, prev ? eqChanges(e, draft.body, draft.segment) : [], MODE_WORD[draft.equipMode ?? 'custom']); }
    if (t === 'lift' && lift) { const g = Q.generationById(s, lift.genId); if (!g) return ''; const e = eqOf(lift);
      return EQ.equipPicker(s, { body: g.body, segment: g.segment, powertrain: g.powertrain, tier: lift.tier, equip: e }, 'lift', ib, eqChanges(e, g.body, g.segment)); }
    return '';
  }
  /** 팀으로 고를 수 있는 직원: 프로젝트에 배치되지 않은 개발 직무(교육·휴식 중이면 그동안 일하지 않음) */
  const idleDev = () => { const lab = new Set(game!.state.staff.filter((x) => x.lab).map((x) => x.id)); return Q.staffInfo(game!.state).filter((x) => x.projectId === null && x.role !== 'sales' && !lab.has(x.id)); }; // 전담 연구원은 개발에 넣지 않는다
  /** 팀 고르기(기획 마지막 단계·페이스리프트). 고를 수 없게 된 직원은 빼고 돌려준다 */
  // 1.0.0 고객층에 맞는 자동 배치: 선택(엔지니어 1명 연구에 남기기·다른 개발 중인 직원 포함)과 마지막 결과 요약(팀이 그대로일 때만 보인다)
  const teamOpt = { keepEng: true, busy: false };
  let autoNote: { act: string; team: string; html: string } | null = null;
  /** 고를 수 있는 직원: 쉬는 개발 직원 + (선택) 다른 개발 중인 직원. 전담 연구원은 넣지 않는다 */
  const pickable = () => { const lab = new Set(game!.state.staff.filter((x) => x.lab).map((x) => x.id)); return Q.staffInfo(game!.state).filter((x) => x.role !== 'sales' && !lab.has(x.id) && (x.projectId === null || teamOpt.busy)); };
  /** 페이스리프트 팀 고르기용 기획 값(그 세대의 차체·고객층·동력, 방향은 고르게). shortcut: 페이스리프트는 디자인 점수만 쌓이므로 매력 추정은 근사 */
  const liftSpec = (L: LiftSet): ProjectSpec | null => { const g = Q.generationById(game!.state, L.genId); if (!g) return null; const w = Q.faceliftPreview(game!.state, L.genId, { options: L.options, tier: L.tier })?.designWeeks ?? config.dev.designWeeks[0];
    const even = Math.floor(config.dev.dirTotal / STATS.length); return { name: nameOf(g), body: g.body, segment: g.segment, powertrain: g.powertrain, tier: L.tier, options: L.options, direction: Object.fromEntries(STATS.map((k) => [k, even])) as Stats, budget: 'normal', designWeeks: w }; };
  function teamPicker(team: number[], act: string, spec?: ProjectSpec | null): string {
    const list = pickable(), busy = busyReason(), s = game!.state, pname = (id: number | null) => s.projects.find((p) => p.id === id)?.name ?? '';
    const sw = (k: 'keepEng' | 'busy', label: string) => `<label class="chk"><input type="checkbox" data-topt="${k}" ${teamOpt[k] ? 'checked' : ''}> ${label}</label>`;
    const auto = spec ? `<div class="auto-team"><button class="btn ink" data-act="autoTeam" data-v="${act}">고객층에 맞게 자동 배치</button>${sw('keepEng', '연구에 엔지니어 1명 남기기')}${sw('busy', '다른 개발 중인 직원도 포함')}</div>
      ${autoNote?.act === act && autoNote.team === [...team].sort((a, b) => a - b).join() ? autoNote.html : ''}` : '';
    return `<div class="team-pick"><p class="lbl" style="margin-top:14px">개발팀 구성 <span class="team-n">${team.length}명</span></p>
      ${busy ? `<div class="badbox">${esc(busy)}</div>` : ''}${auto}
      ${list.length ? `<div class="picks">${list.map((x) => `<button class="pick" data-act="${act}" data-id="${x.id}" aria-pressed="${team.includes(x.id)}"><i aria-hidden="true"></i><span><b>${esc(x.name)}</b><small>${ROLE_NAME[x.role]} · ${ROLE_SKILL[x.role]} ${x.ability}${x.projectId !== null ? ` · 「${esc(pname(x.projectId))}」 개발 중(넣으면 그 개발에서 빠짐)` : x.status === 'training' ? ` · 교육 중(${x.weeksLeft}주 동안 일 못 함)` : x.status === 'resting' ? ` · 휴식 중(${x.weeksLeft}주)` : x.conditionMult < 1 ? ' · 지침' : ''}</small></span></button>`).join('')}</div>`
        : '<div class="warnbox">쉬고 있는 개발 직원이 없습니다. 회사 탭에서 채용하거나 다른 개발에서 직원을 빼야 합니다.</div>'}
      <p class="note">${teamOpt.busy ? '다른 차를 개발 중인 직원을 넣으면 개발을 시작할 때 그 개발에서 빠집니다.' : '다른 차를 개발 중인 직원은 고를 수 없습니다(위 선택을 켜면 고를 수 있습니다).'} 인원을 줄이면 예상 등급이 내려가고 개발비(인건비)는 줄어듭니다.</p></div>`;
  }
  /** [고객층에 맞게 자동 배치]: Q.bestTeam 결과로 팀을 바꾸고 요약(고른 사람, 매력 전→후, 개발비·기간)을 남긴다 */
  function autoTeam(act: string): void {
    const s = game!.state, o = act === 'liftTeam' ? lift : act === 'dvTeam' ? derive : draft, spec = act === 'liftTeam' ? (lift ? liftSpec(lift) : null) : act === 'dvTeam' ? (derive ? deriveSpec(derive) : null) : draft;
    if (!o || !spec) return;
    const before = Q.teamPreview(s, o.team, spec), r = Q.bestTeam(s, spec, { keepEngineer: teamOpt.keepEng, includeBusy: teamOpt.busy });
    if (!r.team.length) return err('배치할 수 있는 직원이 없습니다. 교육·휴식 중이거나 다른 개발에 배치된 직원은 넣지 않습니다.');
    o.team = r.team;
    const names = r.team.map((id) => { const x = s.staff.find((y) => y.id === id)!; return `${esc(x.name)}(${ROLE_NAME[x.role]}${x.projectId !== null ? ' · 다른 개발에서 옮김' : ''})`; }).join(', ');
    autoNote = { act, team: r.team.join(), html: `<div class="okbox auto-note"><b>자동 배치 ${r.team.length}명</b>: ${names}<br>고객층 매력 ${score(before.segmentScore)} → <b>${score(r.segmentScore)}</b> · 예상 개발비 ${money(before.cost)} → <b>${money(r.cost)}</b> · 기간 약 ${r.weeks}주${r.reason.length ? `<ul>${r.reason.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}<small>그대로 쓰거나 아래에서 직접 고칠 수 있습니다(고치면 이 요약은 사라집니다).</small></div>` };
    render();
  }
  /** 개발 시작 직전: 다른 개발에서 옮겨 올 직원을 먼저 빼고, 시작이 실패하면 원래 개발로 돌려놓는다 */
  function withMoved(team: number[], start: () => boolean): boolean {
    const g = game!, moved = g.state.staff.filter((x) => team.includes(x.id) && x.projectId !== null).map((x) => [x.id, x.projectId as number] as const);
    for (const [id] of moved) g.command({ type: 'assign', staffId: id, projectId: null });
    const ok = start();
    if (!ok) for (const [id, pid] of moved) g.command({ type: 'assign', staffId: id, projectId: pid });
    return ok;
  }
  const keepIdle = (team: number[]) => { const ok = new Set(pickable().map((x) => x.id)); return team.filter((id) => ok.has(id)); };
  const defaultName = () => { const n = game!.state.nameplates.length, list = ['아리아', '노바', '솔라', '루나', '벨로', '오로라', '테라', '시리우스', '카덴', '에르타']; return list[n % list.length]; };
  const dirLeft = (d: Draft) => config.dev.dirTotal - STATS.reduce((a, k) => a + d.direction[k], 0);
  const COMPARE = { better: '전작보다 좋음', worse: '전작만 못함', same: '전작과 비슷함' } as const;
  function planView(): View {
    const s = game!.state, d = draft!, y = yearOf(s.week), full = d.nameplateId > 0;
    const n = full ? s.nameplates.find((x) => x.id === d.nameplateId) : undefined, prev = n?.generations.at(-1);
    fixDraft(d);
    const sub = d.subId === undefined ? undefined : s.subs?.find((x) => x.id === d.subId), steam = sub ? Q.subTeam(s, sub) : []; // 3.1.0 자회사 신차 기획: 가상 팀, 영역 안
    const teamPv = (spec: ProjectSpec) => (sub ? Q.planPreview(s, spec, steam) : Q.teamPreview(s, d.team, spec)), spv = sub ? Q.subPlanPreview(s, sub, d) : null;
    const fcp = full ? Q.fullChangePreview(s, d.nameplateId, d) : null, name = full ? n!.name : d.name.trim() || defaultName();
    const tp = teamPv(d), est = { ...tp, cost: spv ? spv.cost : tp.cost * (fcp?.costMult ?? 1) }; // 고른 팀 기준(풀체인지는 개발비 할인 반영)
    if (sub) { const segs = (SUBS.kinds[sub.kind] as { segments?: string[] }).segments ?? []; tp.bestSegment = [...segs].sort((a, b) => teamPv({ ...d, segment: b }).segmentScore - teamPv({ ...d, segment: a }).segmentScore || (a < b ? -1 : 1))[0] ?? d.segment; } // 더 맞는 고객층도 영역 안에서
    const compare = fcp ? (est.avg > fcp.prevAvg ? 'better' : est.avg < fcp.prevAvg ? 'worse' : 'same') : 'same';
    const lk = (o: Partial<Draft> = {}) => { const x = { ...d, ...o }; return lookOf({ body: x.body, powertrain: x.powertrain, tier: x.tier, color: x.color, wheels: 1, year: y, chassisSeed: x.chassisSeed, faceSeed: x.faceSeed }); };
    const look = lk(), tabs = planTabs(d);
    if (planTab !== 'sum' && !tabs.some(([k]) => k === planTab)) planTab = d.mode === 'step' ? tabs[0][0] : 'sum';
    const onSum = planTab === 'sum', sumMode = d.mode !== 'step';
    const ovh = ovTop(sub ? `${esc(sub.name)} 신차 기획 · 직접 운영` : full ? `풀체인지 기획 · ${(prev?.number ?? 0) + 1}세대` : '새 차 기획 · 설계 전', `<span id="pname-ov">${esc(name)}</span>${full ? `<small>${(prev?.number ?? 0) + 1}세대</small>` : ''}`, specLine(d.body, d.powertrain, d.tier, d.segment)) + ovScore(`예상 등급${ib('term:예상 등급')}`, est.avg) + ovHint;
    const bodyWarn = fcp?.bodyChanged ? `<div class="warnbox body-warn" style="margin-top:10px">차체를 바꾸면 이름값이 절반만 이어집니다(${EQ_WORD(fcp.equityBase)} → ${EQ_WORD(fcp.equity)}). 개발비 할인도 없어집니다.</div>` : '';
    let body = '';
    if (onSum) body = planSummary(d, est, tp, fcp, compare, look);
    else if (planTab === 'prev' && prev) {
      const e = currentEdition(prev), sold = n!.generations.reduce((a, g) => a + g.totalSold, 0);
      body = `<div class="prevsum"><div class="ph">${thumb(genLook(prev), -0.65, 240, 150)}</div><div><b>${esc(n!.name)} ${prev.number}세대${e.kind === 'facelift' ? ' · 페이스리프트' : ''}</b><p class="hint">${Q.monthLabel(prev.launchMonth)} 출시 · ${bodyById(prev.body).name} · ${segName(prev.segment)}용</p></div></div>
        <div class="kpis" style="margin-top:10px">${kpi(`평론 평균${ib('term:평론 평균')}`, score(prev.reviewAvg))}${kpi('누적 판매', `${qty(sold)}<span>대</span>`)}${kpi('예상 재구매', `월 ${num(fcp?.rebuyPerMonth ?? 0)}<span>대</span>`)}</div>
        ${equityBar(fcp?.equityBase ?? 0)}
        <p class="lbl" style="margin-top:12px">이어받는 것</p><ul class="inherit"><li>차 이름 「${esc(n!.name)}」${josa(n!.name, '과/와')} 이름값(출시 초기 인지도 가산)</li><li>전 세대 고객의 재구매(첫 12개월, 매달 약 ${num(fcp?.rebuyPerMonth ?? 0)}대)</li><li>같은 차체면 개발비 ${Math.round(config.lifecycle.fullChange.sameBodyCost * 100)}%만 듭니다</li></ul>
        <div class="okbox" style="margin-top:10px">새 세대를 출시하면 ${prev.number}세대는 그 달 말에 단종됩니다(생산 라인을 이어 씁니다).</div>`;
    } else if (planTab === 'body') {
      const open = new Set(Q.bodiesAt(s).map((b) => b.id).filter((b) => !sub || sub.bodies.includes(b)));
      body = `${sub ? `<p class="hint" style="margin-bottom:8px">${esc(sub.name)}${josa(sub.name, '이/가')} 맡은 영역의 차급만 고를 수 있습니다.</p>` : ''}<div class="opts">${BODIES.filter((b) => open.has(b.id)).map((b) => `<button class="opt" data-act="pick" data-k="body" data-v="${b.id}" data-tip="body:${b.id}" aria-pressed="${d.body === b.id}">${ib(`body:${b.id}`, b.name)}${silhouetteSvg(lk({ body: b.id }))}<b>${esc(b.name)}</b><small>기준 가격 ${money(b.basePrice)}</small><span class="cost">원가 ${money(b.cost)}</span></button>`).join('')}</div>${!sub && BODIES.some((b) => !open.has(b.id)) ? `<p class="lbl" style="margin-top:12px">연구로 여는 차체</p><div class="locked-row">${BODIES.filter((b) => !open.has(b.id)).map((b) => lockedOpt('body', b.id, `<b>${esc(b.name)}</b>`, 'lock-chip')).join('')}</div>` : ''}<p class="note">아직 못 쓰는 차체는 연구로 엽니다. 누르면 연구 화면으로 갑니다.</p>${bodyWarn}
      <p class="lbl" style="margin-top:14px">색상(출시 때 바꿀 수 있음)</p>${paints('pick', d.color)}`;
    }
    else if (planTab === 'look') {
      // 1.0.0 후보 6개 + 다른 후보 보기 + 직접 고르기, 풀체인지는 전작과 나란히
      LP.lookKey(`plan:${d.nameplateId}:${d.body}`);
      const cmp = full && prev ? `<p class="lbl">${prev.number}세대 → 새 세대</p>${LP.compareHtml({ ...genLook(prev), color: look.color }, look, thumb, true, [`${prev.number}세대`, `${prev.number + 1}세대(고른 모양)`])}` : '';
      body = `${cmp}<p class="lbl"${cmp ? ' style="margin-top:14px"' : ''}>옆모습(차대) 후보</p>${LP.candHtml('chassis', planCtx(d, 'chassis', look), d.chassisSeed, thumb, 'pick')}
        <p class="lbl" style="margin-top:14px">얼굴(앞뒤 모습) 후보</p>${LP.candHtml('face', planCtx(d, 'face', look), d.faceSeed, thumb, 'pick')}
        <p class="note">모양은 겉모습만 바꾸며 능력치와는 관계가 없습니다. 고른 모양은 무대의 차에 바로 반영됩니다.</p>`;
    } else if (planTab === 'seg') body = `<div class="opts">${SEGMENTS.filter((g) => !sub || (SUBS.kinds[sub.kind] as { segments?: string[] }).segments?.includes(g.id)).map((g) => {
      const top = (Object.entries(g.w) as [Stat, number][]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => STAT_NAME[k]).join('·');
      const mk = Q.comboMark(s, d.body, g.id), tag = mk ? `<span class="tag mk">${mk} ${MARK_WORD[mk]}</span>` : '<span class="tag q">? 출시해 보면 알 수 있습니다</span>';
      return `<button class="opt" data-act="pick" data-k="segment" data-v="${g.id}" data-tip="seg:${g.id}" aria-pressed="${d.segment === g.id}">${ib(`seg:${g.id}`, g.name)}<b>${esc(g.name)}</b><small class="appeal">매력 <b>${score(teamPv({ ...d, segment: g.id }).segmentScore)}</b>${g.id === tp.bestSegment ? ' · 가장 맞음' : ''}</small><small>중시: ${top}</small><small>${g.eps >= 2 ? '가격에 민감함' : '가격보다 만족도 중시'}</small>${tag}</button>`;
    }).join('')}</div><p class="note">궁합${ib('term:궁합')} 차체와 고객층에는 궁합(◎ 잘 맞음 · ○ 무난 · △ 덜 맞음 · × 안 맞음)이 있습니다. 한 번 출시해 본 조합만 궁합이 보입니다. 기록 탭의 조합 노트에 모입니다.</p>`;
    else if (planTab === 'power') {
      const open = new Set(Q.powertrainsAt(s).map((x) => x.id)), pt = powertrainById(d.powertrain), add = Q.ptCostAdd(s, d.powertrain, d.battery, Q.projectPlatform(s, d));
      body = `<p class="lbl">동력 종류 <span class="lblterms">동력 단계${ib('term:동력 단계')}</span></p><div class="seg pts">${POWERTRAINS.map((x) => { const t = UNLOCK_TECH.get(`powertrain:${x.id}`); return open.has(x.id) || !t
        ? `<button data-act="pick" data-k="powertrain" data-v="${x.id}" data-tip="pt:${x.id}" aria-pressed="${d.powertrain === x.id}">${esc(x.name)}${ib(`pt:${x.id}`, x.name)}<small>${Q.ptLevel(s, x.id)}단계까지 연구</small></button>`
        : `<button class="locked" data-act="goResearch" data-v="${t.id}" data-lock="powertrain:${x.id}" data-tip="pt:${x.id}">${esc(x.name)}${ib(`pt:${x.id}`, x.name)}<small>연구 필요</small></button>`; }).join('')}</div>
        <p class="lbl">${esc(pt.name)} 등급${ib('term:동력 등급')}</p><div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="pick" data-k="tier" data-v="${i + 1}" data-tip="tier:${i + 1}" aria-pressed="${d.tier === i + 1}">${ib(`tier:${i + 1}`, t.name)}<b>${esc(t.name)}</b><small class="lv">${esc(pt.name)} ${Q.levelForTier(s, d.powertrain, i + 1)}단계</small><small>${TIER_SUB[i] ?? ''}</small><span class="cost">${t.costAdd ? `원가 +${Math.round(t.costAdd * 100)}%` : '원가 기본'}</span></button>`).join('')}</div>
        ${add ? `<p class="hint pt-add" style="margin-top:10px">${esc(pt.name)} 동력은 차 원가가 <b>${Math.round(add * 100)}%</b> 더 듭니다.${pt.minCostAdd !== undefined ? ' 배터리를 연구하면 줄어듭니다.' : ''}</p>` : ''}${d.powertrain === EV ? batteryBox(d) + chargeBox() : ''}
        <p class="note">단계는 연구로 오릅니다. 등급은 연구한 가장 높은 단계(고급)에서 한두 단계 낮춘 것입니다. 고급 동력을 고르면 차에 스포일러가 붙습니다.</p>`;
    } else if (planTab === 'opt') body = equipView('plan');
    else if (planTab === 'dir') {
      const left = dirLeft(d);
      body = `<p class="left">남은 점수 <b>${left}</b> / ${config.dev.dirTotal}점${ib('term:개발 방향')}</p>${STATS.map((k) => `<div class="dir"><span>${STAT_NAME[k]}${ib(`stat:${k}`, STAT_NAME[k])}</span><button data-act="dir" data-k="${k}" data-v="-1" aria-label="${STAT_NAME[k]} 빼기" ${d.direction[k] <= 0 ? 'disabled' : ''}>−</button><div class="dots" aria-label="${STAT_NAME[k]} ${d.direction[k]}점">${Array.from({ length: config.dev.dirMax }, (_, i) => `<i class="${i < d.direction[k] ? 'on' : ''}"></i>`).join('')}</div><button data-act="dir" data-k="${k}" data-v="1" aria-label="${STAT_NAME[k]} 더하기" ${d.direction[k] >= config.dev.dirMax || left <= 0 ? 'disabled' : ''}>+</button></div>`).join('')}<p class="note">한 능력치에 0~${config.dev.dirMax}점을 줄 수 있습니다. 2점이 보통이며, 많이 줄수록 그 능력치가 더 크게 오릅니다. ${config.dev.dirTotal}점을 모두 나눠야 개발을 시작할 수 있습니다.</p>`;
    } else body = `<p class="lbl">예산</p><div class="opts">${(Object.keys(BUDGET) as Budget[]).map((b) => `<button class="opt" data-act="pick" data-k="budget" data-v="${b}" aria-pressed="${d.budget === b}"><b>${BUDGET[b].name}</b><small>${BUDGET[b].sub}</small></button>`).join('')}</div>
      <p class="lbl" style="margin-top:14px">설계 기간</p><div class="opts">${config.dev.designWeeks.map((w, i) => `<button class="opt" data-act="pick" data-k="designWeeks" data-v="${w}" aria-pressed="${d.designWeeks === w}"><b>${w}주</b><small>${['빠르지만 점수가 적음', '보통', '오래 걸리지만 점수가 많음'][i] ?? ''}</small></button>`).join('')}</div>${bodyWarn}${sub ? `<div class="okbox" style="margin-top:14px">개발은 ${esc(sub.name)}의 가상 개발팀(${steam.length}명, 능력 ${steam[0]?.ability ?? 0})이 합니다. 자회사에는 자체 직원이 없어 본사 개발 직원 평균 능력으로 계산하고, 사장이 있으면 능력이 조금 오릅니다. 본사 직원은 빠지지 않습니다.</div>` : teamPicker(d.team, 'teamPick', d)}`;
    const ti = tabs.findIndex(([k]) => k === planTab), last = ti === tabs.length - 1 && !sumMode, left = dirLeft(d), dirNo = tabs.findIndex(([k]) => k === 'dir') + 1;
    const nameBox = full ? `<p class="lbl">차 이름(이어받음)</p><p class="namefix">${esc(name)} <small>${(prev?.number ?? 0) + 1}세대</small></p>`
      : `<p class="lbl">차 이름</p><div class="name-row"><input class="namein" id="pname" type="text" maxlength="12" value="${esc(d.name)}" placeholder="${esc(defaultName())}" aria-label="차 이름">${pastBtn('pname')}</div>`;
    const card1 = `<div class="card">${nameBox}
      ${onSum ? '' : `<div class="seg steps" role="tablist" style="margin-top:12px">${sumMode ? '<button role="tab" data-act="ptab" data-v="sum" aria-selected="false">≡<small>요약</small></button>' : ''}${tabs.map(([k, l], i) => `<button role="tab" data-act="ptab" data-v="${k}" aria-selected="${planTab === k}">${i + 1}<small>${l}</small></button>`).join('')}</div>`}
      ${noteBox()}${regBox(d)}${onSum ? '' : `<h3>${tabs[ti][1]}</h3>`}${body}
      ${last && left ? `<div class="warnbox" style="margin-top:12px">개발 방향 점수가 ${left}점 남았습니다(${dirNo}번 단계).</div>` : ''}
      ${fcp && !fcp.eligibility.ok ? `<div class="badbox" style="margin-top:12px">${esc(fcp.eligibility.reason ?? '')}</div>` : ''}
      ${onSum ? '' : sumMode ? '<div class="row" style="margin-top:12px"><button class="btn" data-act="ptab" data-v="sum">← 요약으로</button><button class="go" data-act="startDev">개발 시작 <span aria-hidden="true">→</span></button></div>'
        : `<div class="row" style="margin-top:12px">${ti > 0 ? `<button class="btn" data-act="ptab" data-v="${tabs[ti - 1][0]}">← 이전</button>` : ''}${last ? '<button class="go" data-act="startDev">개발 시작 <span aria-hidden="true">→</span></button>' : `<button class="btn" data-act="ptab" data-v="${tabs[ti + 1][0]}">다음 →</button>`}</div><button class="btn ink plan-mode" data-act="planMode" data-v="sum" style="width:100%;margin-top:8px">한 화면 요약으로 보기</button>`}</div>`;
    const fcKpis = fcp ? `${kpi('전작 대비', COMPARE[compare], compare === 'worse' ? 'neg' : compare === 'better' ? 'pos' : '')}${kpi('이어받는 이름값', EQ_WORD(fcp.equity))}${kpi('예상 재구매', `월 ${num(fcp.rebuyPerMonth)}<span>대</span>`)}${kpi('개발비 할인', fcp.costMult < 1 ? `${Math.round((1 - fcp.costMult) * 100)}<span>%</span>` : '없음')}` : '';
    const subBox = spv ? `<div class="kpis" style="margin-top:10px;grid-template-columns:repeat(2,1fr)">${kpi('예상 평론', score(spv.critic))}${kpi('개발 기간', `${spv.months}<span>개월</span>`)}${kpi('쓸 수 있는 자본', money(Q.subDetail(s, sub!.id)!.funds))}${kpi('공유 범위', `${Q.SHARE_NAMES[sub!.share]}`)}</div>${spv.error || spv.fundError ? `<div class="badbox" style="margin-top:8px">${esc(spv.error ?? spv.fundError ?? '')}</div>` : ''}` : '';
    const card2 = `<div class="card plan-est" data-avg="${est.avg.toFixed(3)}" data-max="${est.max.toFixed(3)}"><p class="lbl">예상(대략) · ${sub ? `${esc(sub.name)} 가상 개발팀 ${steam.length}명 기준` : `고른 직원 ${d.team.length}명 기준`}</p>${statBars(est.grades)}
      <div class="kpis" style="margin-top:10px;grid-template-columns:repeat(2,1fr)">${kpi(`예상 등급${ib('term:예상 등급')}`, `${score(est.min)}~${score(est.max)}`)}${kpi('예상 개발비', money(est.cost))}${fcKpis}${kpi('대당 원가', money(Q.unitCost(d.body, d.powertrain, d.tier, d.options, Q.costMultOf(s, d.powertrain), Q.ptCostAdd(s, d.powertrain, d.battery, Q.projectPlatform(s, d)))))}${sub ? '' : kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}</div>${subBox}
      ${fcp ? `<p class="hint" style="margin-top:8px">전 세대 출시 때 등급 ${score(fcp.prevAvg)} → 이번 예상 ${score(est.avg)}. ${compare === 'worse' ? '전작보다 못하면 평론가 모두 점수를 깎고 "전작만 못하다" 기사가 납니다.' : compare === 'better' ? '전작보다 좋으면 평론가 점수가 조금 오르고 "진화했다" 기사가 납니다.' : ''}${fcp.revival ? ' 오래 쉰 이름이라 "부활"로 이름값이 절반만 이어집니다.' : ''}</p>` : ''}
      ${fcp?.hints.length ? `<div class="warnbox fc-hints" style="margin-top:8px"><b>전작보다 낫게 하려면</b><ul>${fcp.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      ${sub ? `<p class="note">자회사 차는 기술을 공유 범위만큼 본사 것을 씁니다(나온 지 ${SUBS.shareLag[sub.share]}년이 안 된 동력·장비는 못 씀, 동력 등급 ${SUBS.shareTier[sub.share]}까지). 개발비는 자회사 자본에서 나가고, 기간이 지나면 시험까지 마친 상태로 출시합니다.</p>` : ''}
      <p class="note">등급은 그해 다른 차와 비교한 점수(0~10, 5가 보통)입니다. 낮은 쪽은 직원 컨디션이 나쁘고 최소 시험만 한 경우, 높은 쪽은 컨디션이 좋고 결함을 다 없앤 경우입니다. 개발비는 설계와 최소 시험 ${config.dev.minTestWeeks}주 기준이며, 시험을 길게 하면 더 듭니다.</p>
      <button class="btn" data-act="cancelPlan" style="width:100%;margin-top:8px">기획 그만두기</button></div>`;
    // 패널 위에 붙는 요약(스크롤해도 보인다): 예상 등급, 고른 고객층의 매력, 더 맞는 고객층
    const sum = `<div class="plan-sum" id="plan-sum" data-live><span>예상 등급${ib('term:예상 등급')} <b>${score(est.min)}~${score(est.max)}</b></span><span>고객층 매력${ib('term:고객층 매력')} <b>${score(tp.segmentScore)}</b> · ${esc(segName(d.segment))}</span>${tp.bestSegment !== d.segment ? `<button class="btn sum-best" data-act="pick" data-k="segment" data-v="${tp.bestSegment}">더 맞는 고객층: ${esc(segName(tp.bestSegment))}</button>` : ''}</div>`;
    return { ov: ovh, panel: (onSum ? '' : sum) + card1 + card2, look };
  }
  /** 0.8.0 한 화면 요약: 항목마다 한 줄(누르면 그 항목 화면), 예상, [단계별로]·[프리셋]·[개발 시작] */
  function planSummary(d: Draft, est: { min: number; max: number; cost: number }, tp: ReturnType<typeof Q.teamPreview>, fcp: Q.FullChangePreview | null, compare: keyof typeof COMPARE, look: CarLook): string {
    const s = game!.state, pt = powertrainById(d.powertrain), left = dirLeft(d), reg = Q.regulationError(s, d), block = Q.regulationBlock(s), req = Q.requiredOptions(s).filter((o) => !d.options.includes(o));
    const staff = s.staff.filter((x) => d.team.includes(x.id)), busy = d.subId === undefined ? busyReason() : null, minT = config.dev.minTestWeeks, sub = d.subId === undefined ? undefined : s.subs?.find((x) => x.id === d.subId);
    const roles = (['designer', 'engineer', 'tester'] as const).map((r) => [r, staff.filter((x) => x.role === r).length] as const).filter(([, n]) => n).map(([r, n]) => `${ROLE_NAME[r]} ${n}`).join(' · ');
    const rows: { tab: PlanTab; k: string; label: string; value: string; note?: string; bad?: boolean }[] = [
      { tab: 'body', k: 'body', label: '차체', value: bodyById(d.body).name, note: fcp?.bodyChanged ? '전작과 다른 차체: 이름값 절반' : '' },
      { tab: 'seg', k: 'seg', label: '고객층', value: `${segName(d.segment)} · 매력 ${score(tp.segmentScore)}`, note: tp.bestSegment !== d.segment ? `더 맞는 고객층: ${segName(tp.bestSegment)}` : '가장 맞는 고객층' },
      { tab: 'power', k: 'power', label: '동력', value: `${pt.name} ${tierName(d.powertrain, d.tier)} · ${Q.levelForTier(s, d.powertrain, d.tier)}단계${d.powertrain === EV ? (({ c }) => ` · ${c.name} 배터리 ${num(c.rangeKm)}km`)(batteryOf(d)) : ''}`, note: reg && !block ? reg : '', bad: !!reg && !block },
      { tab: 'opt', k: 'opt', label: `장비 · ${MODE_WORD[d.equipMode ?? 'custom']}`, value: EQ.equipLine(eqOf(d)), note: block ? '규제 의무 장비 연구 필요' : req.length ? `의무 장비 ${req.length}개 자동 포함` : '', bad: !!block },
      { tab: 'dir', k: 'dir', label: '개발 방향', value: STATS.every((k) => d.direction[k] === d.direction.P) ? `고르게 ${d.direction.P}점씩` : `${STATS.filter((k) => d.direction[k] > 2).sort((a, b) => d.direction[b] - d.direction[a]).map((k) => `${STAT_NAME[k]} ${d.direction[k]}`).join(' · ') || '낮춘 능력치 있음'} 중시`, note: left ? `${left}점 남음` : STATS.filter((k) => d.direction[k] < 2).map((k) => `${STAT_NAME[k]} ${d.direction[k]}`).join(' · '), bad: left > 0 },
      { tab: 'look', k: 'look', label: '외관', value: `${paintName(d.color)} · ${describeLook(look).chassis}` },
      sub ? { tab: 'budget', k: 'team', label: '개발팀', value: `${esc(sub.name)} 가상 팀 ${SUBS.team.roles.length}명`, note: `능력 ${Q.subTeam(s, sub)[0].ability}` } : { tab: 'budget', k: 'team', label: '개발팀', value: `${d.team.length}명`, note: busy ?? (d.team.length ? roles : '고른 직원이 없습니다'), bad: !!busy || !d.team.length },
      { tab: 'budget', k: 'weeks', label: '설계 기간', value: `${d.designWeeks}주 + 시험 ${minT}주부터` },
      { tab: 'budget', k: 'budget', label: '예산', value: `${BUDGET[d.budget].name} · ${BUDGET[d.budget].sub}` },
    ];
    const nt = full(d) ? newTech(d) : null;
    const ntBox = nt && (nt.items.length || nt.info.length) ? `<div class="okbox new-tech" style="margin-bottom:10px"><b>전작 이후 새로 가능</b><ul>${[...nt.items, ...nt.info].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${nt.items.length ? '<button class="btn ink" data-act="applyNew" style="width:100%;margin-top:6px">새 기술 반영</button>' : ''}</div>` : '';
    const k4 = `<div class="kpis sum-kpis" style="margin-top:10px">${kpi(`예상 등급${ib('term:예상 등급')}`, `${score(est.min)}~${score(est.max)}`)}${fcp ? kpi('전작 대비', ({ better: '더 좋음', worse: '못함', same: '비슷함' } as const)[compare], compare === 'worse' ? 'neg' : compare === 'better' ? 'pos' : '') : kpi(`고객층 매력${ib('term:고객층 매력')}`, score(tp.segmentScore))}${kpi('예상 개발비', money(est.cost))}${kpi('기간', `약 ${d.designWeeks + minT}<span>주</span>`)}</div>`;
    return `${ntBox}<div class="sumrows">${rows.map((r) => `<button class="sumrow${r.bad ? ' bad' : ''}" data-act="ptab" data-v="${r.tab}" data-row="${r.k}"><small>${r.label}</small><b>${esc(r.value)}</b>${r.note ? `<em>${esc(r.note)}</em>` : ''}</button>`).join('')}</div>${k4}
      ${fcp?.hints.length ? `<div class="warnbox fc-hints" style="margin-top:8px"><b>전작보다 낫게 하려면</b><ul>${fcp.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      <div class="row sum-go" style="margin-top:10px"><button class="btn" data-act="planMode" data-v="step">단계별로</button>${sub ? '' : '<button class="btn" data-act="presets">프리셋</button>'}<button class="go" data-act="startDev">개발 시작 <span aria-hidden="true">→</span></button></div>`;
  }
  const full = (d: Draft) => d.nameplateId > 0;
  /** 풀체인지: 전작 이후 새로 가능해진 것. items는 [새 기술 반영]이 적용하는 것(새 옵션), info는 알림만(의무 장비·연구로 오른 동력 단계) */
  function newTech(d: Draft): { items: string[]; info: string[]; opts: string[] } {
    const s = game!.state, n = s.nameplates.find((x) => x.id === d.nameplateId), prev = n?.generations.at(-1), out = { items: [] as string[], info: [] as string[], opts: [] as string[] };
    if (!prev) return out;
    const e = currentEdition(prev), pt = powertrainById(d.powertrain), lv = (t: number) => Q.levelForTier(s, d.powertrain, t);
    // 동력 등급은 연구한 최신 단계 기준이라, 연구로 단계가 오르면 같은 등급이 곧 더 높은 단계다(따로 반영할 것 없음)
    if (d.powertrain === prev.powertrain && lv(d.tier) > e.level) out.info.push(`${pt.name} 동력이 전작 ${e.level}단계에서 ${lv(d.tier)}단계로 오릅니다(연구).`);
    const req = new Set(Q.requiredOptions(s)), known = prev.plan?.opts;
    if (known) {
      const fresh = Q.optionsAt(s).filter((o) => !known.includes(o.id) && !req.has(o.id) && !d.options.includes(o.id));
      if (fresh.length) { out.opts = fresh.map((o) => o.id); out.items.push(`새 장비(선택 사양으로): ${fresh.map((o) => o.name).join(', ')}`); } // 1.1.0 장비 수 제한 없음
    }
    const newReq = [...req].filter((o) => !e.options.includes(o));
    if (newReq.length) out.info.push(`새 의무 장비: ${newReq.map((o) => optionById(o).name).join(', ')}(자동으로 들어갑니다)`);
    if (!out.opts.length) { out.info.unshift(...out.items); out.items = []; } // 적용할 것이 없으면 알림만
    return out;
  }
  /** 아직 연구 안 한 차체·옵션·동력 칸: 흐리게 + "연구 필요: ○○", 누르면 그 기술의 연구 화면으로 */
  function lockedOpt(type: 'body' | 'option', id: string, inner: string, cls = ''): string {
    const t = UNLOCK_TECH.get(`${type}:${id}`);
    return `<button class="opt locked${cls ? ` ${cls}` : ''}" data-act="goResearch" data-v="${t?.id ?? ''}" data-lock="${type}:${id}" data-tip="${type === 'option' ? 'opt' : 'body'}:${id}">${inner}<small class="need">연구 필요: ${esc(t?.name ?? '')}${t && t.year > yearOf(game!.state.week) ? ` (${t.year}년쯤)` : ''}</small></button>`;
  }
  /** 규제 경고(11장): 의무 장비 기술을 연구하지 않았거나 금지된 동력이면 */
  function regBox(car: { options: string[]; powertrain: string }): string {
    const reg = Q.regulationError(game!.state, car);
    return reg ? `<div class="badbox reg-warn" style="margin-bottom:12px">${esc(reg)} ${ib('term:유예 기간')}</div>` : '';
  }
  /** 1.2.0 기획의 배터리 용량 선택지(지금 고른 차체·등급·전용 플랫폼 기준)와 고른 것 */
  const batteryOf = (d: Pick<ProjectSpec, 'body' | 'powertrain' | 'tier' | 'battery'>) => { const s = game!.state, plat = Q.projectPlatform(s, d), C = Q.batteryChoices(s, { body: d.body, level: Q.levelForTier(s, d.powertrain, d.tier), platform: plat, tier: d.tier }); return { C, c: C.find((x) => x.id === (d.battery ?? 'std'))!, plat }; };
  /** 1.2.0 배터리 용량 고르기(전기차 기획): 선택지마다 주행 거리·표준 대비 원가·기준가·매력 한 줄, 아래 고른 배터리의 주행 거리·충전·전용 플랫폼 */
  const batteryBox = (d: Pick<ProjectSpec, 'body' | 'powertrain' | 'tier' | 'battery'>, act = 'pick'): string => {
    const { C, c, plat } = batteryOf(d), sg = (v: number) => `${Math.round(v) > 0 ? '+' : Math.round(v) < 0 ? '−' : '±'}${num(Math.abs(Math.round(v)))}만원`;
    const ap = (v: number) => { const p = Math.round((v - 1) * 100); return p ? `매력 ${p > 0 ? '+' : '−'}${Math.abs(p)}%` : '매력 그대로'; };
    return `<p class="lbl" style="margin-top:14px">배터리 용량${ib('term:배터리 용량')}</p><div class="opts bat-opts">${C.map((x) => `<button class="opt" data-act="${act}" data-k="battery" data-v="${x.id}" aria-pressed="${c.id === x.id}"><b>${esc(x.name)}${x.id === 'std' ? ' <small>기본</small>' : ''}</b><small class="bat-km">주행 거리 ${num(x.rangeKm)}km</small><small>원가 ${sg(x.costDelta)} · 기준가 ${sg(x.priceDelta)} · ${ap(x.appeal)}</small></button>`).join('')}</div>
      <p class="hint ev-sum" style="margin-top:8px">주행 거리 <b>${num(c.rangeKm)}km</b>(이 차급의 기대 ${num(c.expectedKm)}km)${ib('term:주행 거리')} · 10→80% 충전 ${c.chargeMinutes}분 · 전용 플랫폼${ib('term:전용 플랫폼')} ${plat ? '적용' : '미적용'}</p>`;
  };
  /** 전기차 충전 인프라 안내(전기 동력을 고를 때) */
  const chargeBox = (): string => {
    const c = Q.activeEvents(game!.state).chargingInfra, pct = Math.round(c * 100);
    return `<div class="warnbox charge" style="margin-top:10px">${c <= 0 ? `충전 인프라 보급률이 ${pct}%여서 전기차는 거의 팔리지 않습니다. 전기차 시대가 열리면 해마다 오릅니다.` : c < 1 ? `충전 인프라 보급률이 ${pct}%여서 전기차 수요가 그만큼 제한됩니다. 보급률은 해마다 오릅니다.` : '충전 인프라가 충분히 갖춰졌습니다.'} ${ib('term:충전 인프라')}</div>`;
  };

  // ----- 0.8.0 기획 프리셋(게임마다 저장 칸의 UiExtra에) -----
  const presetLine = (p: S.PlanPreset) => [p.body ? BODIES.find((b) => b.id === p.body)?.name ?? p.body : '차체 제외', segName(p.segment), `${POWERTRAINS.find((x) => x.id === p.powertrain)?.name ?? p.powertrain} ${tierName(p.powertrain, p.tier)}`, `장비 ${Object.keys((p as { equip?: object }).equip ?? p.options).length}개`, `${p.designWeeks}주`, BUDGET[p.budget as Budget]?.name ?? ''].join(' · ');
  // ----- 1.5.0 출시 뒤 이름 바꾸기(차고 상세의 [이름 변경]) -----
  function showRename(id: number): void {
    const s = game!.state, n = s.nameplates.find((x) => x.id === id); if (!n) return;
    const kids = s.nameplates.filter((x) => x.baseOf === n.id && x.name.startsWith(`${n.name} `));
    sheetBody.innerHTML = `<div class="rename-sheet"><div class="eyebrow"><i></i>차고 · 이름 변경</div><h2>「${esc(n.name)}」 이름 바꾸기</h2>
      <p class="hint">계보·판매 기록·이름값·명예의 전당은 그대로 이어집니다. 지난 뉴스와 보고의 문장은 바뀌지 않습니다.</p>
      <label class="lbl" for="rn-name">새 이름</label><div class="name-row"><input class="namein" id="rn-name" type="text" maxlength="${config.nameMax}" value="${esc(n.name)}" autocomplete="off">${pastBtn('rn-name')}</div>
      ${kids.length ? `<label class="chk"><input type="checkbox" id="rn-kids" checked> 파생 모델 이름도 함께 바꾸기(${kids.map((k) => `「${esc(k.name)}」`).join(', ')})</label>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn ink" data-act="renameDo" data-id="${n.id}">이름 바꾸기</button><button class="btn" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
    const inp = $<HTMLInputElement>('#rn-name'); inp?.focus(); inp?.select();
  }
  function showPresets(): void {
    if (!draft) return;
    const list = ui.presets ?? [], bn = bodyById(draft.body).name;
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>기획 프리셋</div><h2>조합 저장·불러오기</h2><p class="hint">고객층·동력·옵션·개발 방향·설계 기간·예산을 이름을 붙여 저장합니다. 이 게임의 저장 칸에 함께 저장됩니다(최대 ${S.PRESET_MAX}개).</p>
      <div class="preset-new"><input class="namein" id="preset-name" type="text" maxlength="16" placeholder="프리셋 ${list.length + 1}" aria-label="프리셋 이름"><label class="chk"><input type="checkbox" id="preset-body" checked> 차체도 저장(${esc(bn)})</label><button class="btn ink" data-act="presetSave">지금 조합 저장</button></div>
      ${list.length ? `<div class="menu-slots presets">${list.map((p, i) => `<div class="slot preset"><div><b>${esc(p.name)}</b><small>${esc(presetLine(p))}</small></div><div class="row"><button class="btn ink" data-act="presetLoad" data-v="${i}">불러오기</button><button class="btn" data-act="presetDel" data-v="${i}">지우기</button></div></div>`).join('')}</div>` : '<p class="note">저장한 프리셋이 없습니다.</p>'}
      <p class="note">불러올 때 지금 쓸 수 없는 차체·동력·옵션(연구 전 등)은 빼고 알려 줍니다.</p><button class="btn" data-act="closeSheet" style="width:100%;margin-top:10px">닫기</button>`;
    sheet.hidden = false;
  }
  /** 프리셋을 초안에 넣는다. 지금 쓸 수 없는 것은 빼고 그 이름 목록을 돌려준다 */
  function applyPreset(d: Draft, p: S.PlanPreset): string[] {
    const s = game!.state, out: string[] = [], opts = new Set(Q.optionsAt(s).map((o) => o.id)), req = new Set(Q.requiredOptions(s));
    if (p.body) { if (Q.bodiesAt(s).some((b) => b.id === p.body)) d.body = p.body; else out.push(`차체 ${BODIES.find((b) => b.id === p.body)?.name ?? p.body}`); }
    if (SEGMENTS.some((x) => x.id === p.segment)) d.segment = p.segment;
    if (Q.powertrainsAt(s).some((x) => x.id === p.powertrain)) { d.powertrain = p.powertrain; d.tier = Math.max(1, Math.min(powertrainById(p.powertrain).tiers.length, Math.round(p.tier) || 2)); }
    else out.push(`동력 ${POWERTRAINS.find((x) => x.id === p.powertrain)?.name ?? p.powertrain}`);
    // 1.1.0 프리셋의 장비 구성(equip). 옛 프리셋(options만)은 모두 기본 장비로 읽는다
    const pe = (p as { equip?: EQ.Equip }).equip ?? EQ.fromOptions(p.options ?? []);
    for (const o of Object.keys(pe)) if (!opts.has(o)) out.push(`장비 ${OPTIONS.find((x) => x.id === o)?.name ?? o}`);
    setEquip(d, Object.fromEntries(Object.entries(pe).filter(([o, v]) => opts.has(o) && !req.has(o) && (v === 'std' || v === 'opt'))), 'custom');
    const dir = p.direction as Partial<Stats>;
    if (STATS.every((k) => Number.isInteger(dir[k]) && dir[k]! >= 0 && dir[k]! <= config.dev.dirMax) && STATS.reduce((a, k) => a + dir[k]!, 0) === config.dev.dirTotal) d.direction = { ...(dir as Stats) };
    if (config.dev.designWeeks.includes(p.designWeeks)) d.designWeeks = p.designWeeks;
    if (p.budget in BUDGET) d.budget = p.budget as Budget;
    { const b = (p as { battery?: Battery }).battery; if (b && Q.BATTERIES.includes(b)) d.battery = b; else delete d.battery; } // 1.2.0 배터리 용량(없으면 표준)
    return out;
  }

  // ----- 페이스리프트 기획(8.2) -----
  function liftView(): View {
    const s = game!.state, L = lift!, g = Q.generationById(s, L.genId)!, e = currentEdition(g), np = Q.nameplateOf(s, g.id)!;
    fixLift(L);
    const pv = Q.faceliftPreview(s, g.id, { options: L.options, tier: L.tier, ...{ equip: eqOf(L) } })!, cur = genLook(g);
    LP.lookKey(`lift:${g.id}`);
    const dBefore = Q.grades(e.stats, yearOf(s.week + pv.designWeeks + pv.minTestWeeks)).D, pt = powertrainById(g.powertrain), ok = elig(pv.eligibility);
    const ovh = ovTop('페이스리프트 기획 · 지금 모습', `${esc(np.name)}<small>${editionName(g)}</small>`, specLine(g.body, g.powertrain, e.tier, g.segment)) + ovHint;
    // 1.0.0 지금 얼굴과 고른 새 얼굴을 나란히(달라진 부품 한 줄) + 후보 6개·다른 후보 보기·직접 고르기
    const card1 = `<div class="card">${noteBox()}<p class="lbl">1. 새 얼굴 고르기</p><div class="faces lift-cmp">${LP.compareHtml(cur, { ...cur, faceSeed: L.faceSeed }, thumb, false, ['지금 얼굴', '새 얼굴'])}</div>
      ${LP.candHtml('face', liftCtx(g), L.faceSeed, thumb, 'liftPick', 'face')}
      <p class="note">차대(옆모습·차체 크기)는 그대로 두고 앞뒤 모습만 바꿉니다.</p></div>`;
    const card2 = `<div class="card"><p class="lbl">2. 옵션 갱신</p>${equipView('lift')}
      <p class="lbl" style="margin-top:14px">3. 동력 등급(${esc(pt.name)})</p><div class="opts">${pt.tiers.map((t, i) => `<button class="opt" data-act="liftPick" data-k="tier" data-v="${i + 1}" aria-pressed="${L.tier === i + 1}" ${i + 1 < e.tier ? 'disabled' : ''}><b>${esc(t.name)}</b><small class="lv">${esc(pt.name)} ${Q.levelForTier(s, g.powertrain, i + 1)}단계</small><small>${i + 1 < e.tier ? '낮출 수 없음' : i + 1 === e.tier ? '지금 등급' : '한 등급 올리기'}</small></button>`).join('')}</div>
      <p class="note">동력 종류와 차체는 바꿀 수 없습니다. 바꾸려면 풀체인지가 필요합니다.</p></div>`;
    const bar = (label: string, a: number, b: number, term = '') => `<p class="lbl" style="margin-top:12px">${label}${term ? ib(`term:${term}`) : ''}</p><div class="ba"><span>지금</span><div class="life"><u style="width:${(a * 100).toFixed(1)}%"></u></div><b>${Math.round(a * 100)}%</b></div><div class="ba"><span>바꾼 뒤</span><div class="life"><u style="width:${(b * 100).toFixed(1)}%"></u></div><b>${Math.round(b * 100)}%</b></div>`;
    const card3 = `<div class="card lift-est"><p class="lbl">4. 예상</p><div class="kpis">${kpi('비용', money(pv.cost))}${kpi('기간', `${pv.designWeeks + pv.minTestWeeks}<span>주~</span>`)}${kpi('디자인', `${score(dBefore)}→${score(pv.grades.D)}`)}${kpi('평균 등급', `${score(pv.avgBefore)}→${score(pv.avg)}`)}</div>
      <p class="hint" style="margin-top:6px">설계 ${pv.designWeeks}주 + 시험 ${pv.minTestWeeks}주 이상. 디자이너만 일하고 점수는 디자인에만 쌓입니다. 남은 결함은 절반으로 줄어 시작합니다.</p>
      <div class="kpis lift-money" style="margin-top:10px">${kpi(`예상 월 판매${ib('term:예상 월 판매')}`, `${num(pv.salesBefore)}→${num(pv.salesAfter)}<span>대</span>`)}${kpi('예상 월 이익', `${money(pv.profitBefore, true)}→${money(pv.profitAfter, true)}`, pv.profitAfter >= pv.profitBefore ? 'pos' : 'neg')}${kpi('비용 회수', pv.paybackMonths === null ? '회수 못 함' : `약 ${pv.paybackMonths}<span>개월</span>`, pv.paybackMonths === null ? 'neg' : '')}</div>
      <p class="note" style="margin-top:4px">지금 달 시장·같은 가격·광고 기준 어림입니다. 월 이익은 광고비를 빼고 직원 월급·유지비는 넣지 않은 값입니다.</p>
      ${pv.tooEarly ? `<div class="warnbox lift-early" style="margin-top:8px">출시 ${config.lifecycle.facelift.goodFromMonths}개월 전이라 지금은 효과가 작습니다. 수명이 덜 되돌아갑니다.</div>` : ''}
      ${bar('수명', pv.lifeBefore, pv.lifeAfter, '수명')}${bar('인지도', pv.awarenessBefore, pv.awarenessAfter, '인지도')}
      <p class="note">평론가는 다시 평가하지 않고 신문에 기사가 실립니다. 바꾸는 달에는 생산이 30% 줄어듭니다.</p>
      ${teamPicker(L.team, 'liftTeam', liftSpec(L))}<p class="note">페이스리프트는 디자이너가 점수를 내고 테스터가 결함을 잡습니다. 처음에는 추천 팀(쉬는 디자이너·테스터, 엔지니어는 연구에 남김)이 골라져 있습니다.</p>
      ${ok.ok ? '' : `<div class="badbox" style="margin-top:10px">${esc(ok.reason ?? '')}</div>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="cancelPlan">그만두기</button><button class="go" data-act="startLift" ${ok.ok ? '' : 'disabled'}>페이스리프트 시작 <span aria-hidden="true">→</span></button></div></div>`;
    return { ov: ovh, panel: card1 + card2 + card3, look: cur };
  }

  // ----- 1.3.0 파생 모델 고르기: 4종 카드(특색·개발비·기간·고객층·불가 이유) → 이름·팀·(전기차판) 배터리 → 개발 시작 -----
  /** 파생 모델의 모습(바탕 세대의 차대, 이 파생 차종의 첫 얼굴 후보, 지금 연도): 개발을 시작하면 실제로 이 모습이 된다 */
  const deriveLook = (g: Generation, o: ReturnType<typeof Q.derivativeOptions>[number]): CarLook => { const e = currentEdition(g);
    return lookOf({ body: g.body, powertrain: o.powertrain ?? g.powertrain, tier: e.tier, color: e.color, wheels: e.wheels, year: yearOf(game!.state.week), chassisSeed: g.chassisSeed, faceSeed: Q.lookCandidates(game!.state, o.into ?? 0, 'face', 'nextGen')[0], variant: o.id }); };
  /** 파생 개발 기획 값(팀 자동 배치·예상용). 고르지 않았거나 안 되면 null */
  const deriveSpec = (D: DeriveSet): ProjectSpec | null => { if (!D.variant) return null; const p = Q.derivativePlan(game!.state, D.genId, D.variant, { name: D.name, ...(D.battery ? { battery: D.battery } : {}) }); return typeof p === 'string' ? null : p.spec; };
  const multLine = (id: string) => { const v = Q.variantById(id); return v ? STATS.filter((k) => Math.abs(v.mult[k] - 1) >= 0.005).map((k) => `${STAT_NAME[k]} ${v.mult[k] > 1 ? '+' : '−'}${Math.round(Math.abs(v.mult[k] - 1) * 100)}%`).join(' · ') || '능력치는 바탕 차와 같음' : ''; };
  function openDerive(genId: number, variant: string | null = null): void {
    derive = { genId, variant: null, name: '', team: [] };
    if (variant) pickDerive(variant);
    go('derive');
  }
  function pickDerive(v: string): void {
    const D = derive!, o = Q.derivativeOptions(game!.state, D.genId).find((x) => x.id === v);
    if (!o?.ok) return;
    D.variant = v; D.name = o.into === null ? o.defaultName : ''; D.battery = undefined;
    const spec = deriveSpec(D), t = spec ? Q.bestTeam(game!.state, spec, { keepEngineer: teamOpt.keepEng }).team : [];
    D.team = t.length ? t : idleDev().map((x) => x.id); // 기본: 고객층에 맞는 자동 배치
  }
  function deriveView(): View {
    const s = game!.state, D = derive!, g = Q.generationById(s, D.genId)!, np = Q.nameplateOf(s, g.id)!, O = Q.derivativeOptions(s, g.id), o = O.find((x) => x.id === D.variant && x.ok);
    if (D.variant && !o) D.variant = null;
    const team = keepIdle(D.team); if (team.length !== D.team.length) D.team = team;
    const look = o ? deriveLook(g, o) : genLook(g), first = (t: string) => `${t.split('. ')[0].replace(/\.$/, '')}.`;
    const title = o ? (o.into !== null ? s.nameplates.find((n) => n.id === o.into)?.name ?? '' : D.name.trim() || o.defaultName) : np.name;
    const ovh = ovTop('파생 모델 기획', `<span id="dname-ov">${esc(title)}</span><small>${o ? esc(o.name) : `${g.number}세대 바탕`}</small>`, `「${np.name}」 ${g.number}세대 바탕 · ${bodyById(o?.id === 'coupe' ? 'coupe' : g.body).name}${o?.powertrain ? ` · ${powertrainById(o.powertrain).name}` : ''}`) + ovHint;
    const cards = O.map((x) => `<button class="opt dv" data-act="dvPick" data-v="${x.id}" aria-pressed="${D.variant === x.id}" ${x.ok ? '' : 'disabled'}><span class="dv-th">${thumb(deriveLook(g, x), -0.65, 200, 124)}</span><b>${esc(x.name)}${x.into !== null ? ' <small>다음 세대</small>' : ''}</b><small class="dv-info">${esc(first(x.info))}</small><small class="dv-mult">${esc(multLine(x.id))}</small>
      ${x.ok ? `<small>개발비 약 ${money(x.cost)} · ${x.weeks}주~ · 고객층 ${esc(segName(x.segment ?? g.segment))}</small>` : `<em class="why">${esc(x.reason ?? '')}</em>`}</button>`).join('');
    const card1 = `<div class="card dv-card"><p class="lbl">1. 파생 모델 고르기${ib('term:파생 모델')}</p><div class="opts dv-opts">${cards}</div>
      <p class="note">바탕 차(「${esc(np.name)}」 ${g.number}세대)의 차대·장비를 그대로 쓰고 일부만 바꿔 짧게 개발합니다. 별도 차종으로 팔리며 바탕 차와 생산 라인을 함께 씁니다.</p></div>`;
    if (!o) return { ov: ovh, panel: card1 + `<div class="card"><div class="row"><button class="btn" data-act="dvCancel">그만두기</button></div></div>`, look };
    const spec = deriveSpec(D), into = o.into !== null ? s.nameplates.find((n) => n.id === o.into) : undefined;
    const nameBox = into ? `<p class="hint">「${esc(into.name)}」의 다음 세대로 개발합니다(이름은 그대로).</p>` : `<label class="lbl" for="dname">이름</label><div class="name-row"><input class="namein" id="dname" type="text" maxlength="16" value="${esc(D.name)}" placeholder="${esc(o.defaultName)}" autocomplete="off">${pastBtn('dname')}</div><p class="note">비우면 「${esc(o.defaultName)}」${josa(o.defaultName, '으로/로')} 합니다.</p>`;
    const bat = o.powertrain === 'ev' ? batteryBox({ body: g.body, powertrain: 'ev', tier: currentEdition(g).tier, battery: D.battery }, 'dvBattery') : '';
    const busy = busyReason();
    const card2 = `<div class="card dv-go"><p class="lbl">2. ${into ? '다음 세대' : '이름'}</p>${nameBox}${bat}
      <div class="kpis" style="margin-top:10px">${kpi('개발비(설계 + 최소 시험)', money(o.cost))}${kpi('기간', `${o.weeks}<span>주~</span>`)}${kpi('고객층', esc(segName(spec?.segment ?? o.segment ?? g.segment)))}</div>
      ${teamPicker(D.team, 'dvTeam', spec)}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="dvCancel">그만두기</button><button class="go" data-act="dvStart" ${busy ? 'disabled' : ''}>파생 모델 개발 시작 <span aria-hidden="true">→</span></button></div></div>`;
    return { ov: ovh, panel: pcols(card1, card2), look };
  }

  // ----- 개발 진행(사무실) -----
  const kindLabel = (p: Project) => p.kind === 'fix' ? '긴급 개선 중' : p.kind === 'facelift' ? '페이스리프트 중' : p.kind === 'fullchange' ? `풀체인지 중 · ${(prevOf(p)?.number ?? 0) + 1}세대` : p.kind === 'derivative' ? `파생 모델 개발 중 · ${Q.variantById(p.variant)?.name ?? ''}${p.into !== undefined ? ` ${(prevOf(p)?.number ?? 0) + 1}세대` : ''}` : '개발 중';
  /** 개발 중 표시 등급. shortcut: 페이스리프트는 sim의 projectPreview가 디자인 점수만 보고 계산해 등급이 0에 가깝게 나오므로, 지금 판매 중인 판의 등급을 보여 준다(sim에 페이스리프트용 미리보기가 생기면 바꿀 것) */
  function devGrades(p: Project): { grades: Stats; avg: number } | null {
    const s = game!.state, g = p.kind === 'facelift' || p.kind === 'fix' ? Q.generationById(s, p.targetId ?? -1) : undefined;
    return g ? { grades: Q.generationGrades(s, g), avg: Q.avgGrade(currentEdition(g).stats, yearOf(s.week)) } : Q.projectPreview(s, p.id);
  }
  /** 개발 탭에서 보는 프로젝트(고른 것, 없으면 첫 프로젝트) */
  const curProj = (): Project | undefined => { const s = game!.state; return s.projects.find((p) => p.id === devSel) ?? s.projects[0]; };
  const phaseText = (p: Project) => p.phase === 'design' ? `설계 ${p.weeksDone}/${p.designWeeks}주` : `시험 ${p.testWeeks}주째`;
  /** 개발 화면 맨 위: 기획 중인 초안 알림 */
  const draftCard = (): string => {
    if (!draft && !lift) return '';
    const tabs = draft ? planTabs(draft) : [], i = draft ? Math.max(0, tabs.findIndex(([k]) => k === planTab)) : 0;
    const what = draft ? (planTab === 'sum' ? '한 화면 요약' : `${i + 1}/${tabs.length}단계 · ${tabs[i][1]}`) : '페이스리프트 기획';
    return `<div class="card draft-card"><p class="lbl">기획 중</p><p class="draft-line"><b>기획 중인 차가 있습니다: 「${esc(draftName())}」</b> · ${what}</p><div class="row" style="margin-top:8px"><button class="btn ink" data-act="resumePlan">이어서 하기</button><button class="btn" data-act="cancelPlan">그만두기</button></div></div>`;
  };
  function devView(): View {
    const s = game!.state, p = curProj(), teams = Q.devTeams(s), free = s.projects.length < teams;
    if (!p) {
      return { ov: `<div class="ov ofc"><div class="ofc-t"><div class="eyebrow"><i></i>개발팀 · 쉬는 중</div><b>진행 중인 개발이 없습니다</b><span class="ofc-s">새 차를 기획하면 직원들이 설계를 시작합니다.</span></div>${free ? '<button class="go" data-act="plan">신차 기획</button>' : ''}</div>`,
        panel: `<div class="card"><p class="lbl">개발</p><h2>개발팀이 쉬고 있습니다</h2><p class="hint" style="margin-top:8px">직원 ${s.staff.length}명 가운데 기획 때 고른 개발 직원이 그 차를 맡습니다. 개발팀은 ${teams}개라 한 번에 ${teams}대까지 개발할 수 있습니다.${s.hqLevel < config.hq.levels.length ? ' 본사를 키우면 개발팀이 늘어납니다.' : ''}</p>${free ? '<button class="go" data-act="plan">신차 기획 시작</button>' : ''}</div>${draftCard()}`, office: officeView() };
    }
    // 동시 개발: 위쪽에 프로젝트 전환 칩. 빈 개발팀이 있으면 [신차 기획]
    const chips = s.projects.length >= 2 || free ? `<div class="pchips"><span class="lbl">개발팀 ${s.projects.length}/${teams}</span>${s.projects.length >= 2 ? s.projects.map((x) => `<button class="pchip" data-act="devSel" data-id="${x.id}" aria-pressed="${x.id === p.id}"><b>${esc(x.name)}</b><small>${phaseText(x)}</small></button>`).join('') : ''}${free ? '<button class="btn ink" data-act="plan">+ 신차 기획</button>' : ''}</div>` : '';
    const pv = devGrades(p)!, minT = config.dev.minTestWeeks, ready = p.kind !== 'fix' && p.phase === 'test' && p.testWeeks >= minT, adv = Q.defectAdvice(p, s);
    const phase = phaseText(p);
    const pi = s.projects.indexOf(p), nav = s.projects.length >= 2 ? `<div class="ofc-nav" role="group" aria-label="프로젝트 넘기기"><button class="btn" data-act="devStep" data-v="-1" aria-label="이전 프로젝트">‹</button><span>${pi + 1}/${s.projects.length}</span><button class="btn" data-act="devStep" data-v="1" aria-label="다음 프로젝트">›</button></div>` : ''; // 1.0.0 동시 개발: 띠에서도 넘긴다
    const ovh = `<div class="ov ofc"><div class="ofc-t"><div class="eyebrow"><i></i>${kindLabel(p)} · ${phase}</div><b>${esc(p.name)}</b><span class="ofc-s">${STATS.map((k) => `${STAT_NAME[k]} ${score(pv.grades[k])}`).join(' · ')} · 결함 약 ${num(p.defectEst)}개</span></div>${nav}<div class="ofc-g"><small>지금 등급${ib('term:지금 등급')}</small><b>${score(pv.avg)}</b></div></div>`;
    const pct = p.phase === 'design' ? (p.weeksDone / p.designWeeks) * 100 : 100;
    const log = devLog.get(p.id) ?? [];
    // 넓은 화면에서는 사무실 아래에 [진행·능력치] [결함·개발비·버튼] [주간 기록] 세 칸으로 나란히
    const team = s.staff.filter((x) => x.projectId === p.id);
    const card1 = `<div class="card dev-prog"><p class="lbl">${kindLabel(p)} · ${p.phase === 'design' ? '설계 단계' : '시험 단계'}</p><h2>${esc(p.name)}<small>${phase}</small></h2>
      ${devSteps(p, pct, team)}
      <p class="hint team-line">${p.waiting && !team.length ? '출시 대기 중이라 팀이 풀려났습니다. 엔지니어는 연구를 합니다.' : `만드는 사람 ${team.length}명: ${team.map((x) => `${esc(x.name)}(${ROLE_NAME[x.role]})`).join(', ') || '없음 — 회사 탭에서 직원을 넣으세요'}`}</p>
      <p class="lbl" style="margin-top:12px">${p.kind === 'facelift' ? '지금 판매 중인 판의 능력치(출시하면 디자인이 오릅니다)' : '지금 능력치(등급)'}</p>${statBars(pv.grades)}${winsList(p.wins)}</div>`;
    const ps = Q.projectStatus(s, p.id), wait = !!ps?.waiting;
    const costLine = ps && !wait ? `<p class="hint cost-line" style="margin-top:8px">${esc(ps.costNote)}</p>` : '';
    // 태블릿 가로(1024×768)에서 [출시 준비]가 스크롤 없이 보이게 버튼을 수치 바로 아래에 둔다
    const card2 = `<div class="card"><div class="kpis">${kpi(`남은 결함${ib('term:결함')}`, `약 ${num(p.defectEst)}<span>개</span>`)}${kpi('지금까지 쓴 개발비', money(p.spent))}</div>
      ${wait ? '<div class="okbox wait-badge" style="margin-top:10px"><b>출시 대기</b> · 개발비가 들지 않습니다</div>' : ''}
      <button class="go${wait && ready ? ' pulse' : ''}" data-act="toLaunch" ${ready ? '' : 'disabled'}>${ready ? '출시 준비 →' : p.phase === 'design' ? '설계가 끝나면 시험을 시작합니다' : `시험 ${minT}주 뒤 출시할 수 있습니다`}</button>
      ${p.phase === 'test' ? defectBox(adv) : `<p class="hint" style="margin-top:10px">${p.kind === 'facelift' ? '디자이너가 새 얼굴을 그리고 있습니다. 점수는 디자인에만 쌓입니다.' : '직원들이 매주 능력치를 쌓고 있습니다. 결함도 함께 생깁니다.'}</p>`}${costLine}
      ${p.phase === 'design' && p.kind !== 'fix' && !p.equip ? '<p class="hint eq-legacy" style="margin-top:8px">새 장비 규칙이 생겼습니다. 출시 전에 장비를 다시 고를 수 있습니다.</p>' : ''}
      ${p.phase === 'design' && p.kind !== 'fix' ? `<button class="btn" data-act="projEquip" data-id="${p.id}" style="width:100%;margin-top:10px">장비 다시 고르기 <small>설계 단계에서만 · 비용 없음</small></button>` : ''}
      <button class="btn danger" data-act="cancelDev" style="width:100%;margin-top:10px">개발 취소</button>
      ${p.phase === 'test' && !wait ? '<p class="note">시험을 길게 할수록 결함이 줄어 리콜 위험이 낮아지지만 그동안 개발비가 계속 듭니다. 출시 시점은 직접 정합니다.</p>' : ''}</div>`;
    const card3 = `<div class="card dev-side"><p class="lbl">주간 기록</p>${log.length ? `<ul class="log">${log.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">한 주가 지나면 기록이 쌓입니다. 위쪽 빠르기 버튼으로 시간을 진행합니다.</p>'}${waitTodo(free)}</div>`;
    return { ov: ovh, panel: draftCard() + chips + card1 + card2 + card3, office: officeView(p) };
  }

  /** 진행 단계(설계 → 시험 → 결함 잡기), 출시까지 남은 기간 어림, 팀 컨디션 */
  function devSteps(p: Project, pct: number, team: Staff[]): string {
    const minT = config.dev.minTestWeeks, wait = !!p.waiting, test = p.phase === 'test', fix = test && p.testWeeks >= minT;
    const cls = (done: boolean, on: boolean) => (done ? 'done' : on ? 'on' : '');
    const steps = `<ol class="dsteps" aria-label="개발 단계"><li class="${cls(test, !test)}" style="--p:${pct.toFixed(0)}%">1 설계<b>${p.weeksDone}/${p.designWeeks}주</b></li>
      <li class="${cls(fix, test && !fix)}" style="--p:${((p.testWeeks / minT) * 100).toFixed(0)}%">2 시험<b>${test ? `${Math.min(p.testWeeks, minT)}/${minT}주` : `최소 ${minT}주`}</b></li>
      <li class="${cls(wait, fix && !wait)}" style="--p:50%">3 결함 잡기<b>${wait ? '끝' : `약 ${num(p.defectEst)}개 남음`}</b></li></ol>`;
    const rate = testCut(team, game!.state.week), ok = config.critics.okDefects; // 시험 주당 결함 감소(sim과 같은 식)
    const fixLine = (n: number) => rate <= 0 ? '시험할 테스터·엔지니어가 없어 결함이 줄지 않습니다' : `결함 ${ok}개 이하까지 약 <b>${Math.ceil(Math.max(0, n - ok) / rate)}주</b> · 0개까지 약 <b>${Math.ceil(n / rate)}주</b>${ib('term:출시 기준 결함', '출시 기준 결함')}`;
    const mins = (w: number) => { const m = Math.round((w * WEEK_MS) / 60000); return m >= 1 ? ` · 보통 빠르기로 약 ${m}분` : ''; };
    const left = p.designWeeks - p.weeksDone + minT;
    const eta = wait ? '<b>출시 대기</b> · 언제든 출시할 수 있습니다'
      : !test ? `출시까지 최소 <b>${left}주</b>(설계 ${p.designWeeks - p.weeksDone}주 + 시험 ${minT}주)${mins(left)}${rate > 0 ? ` · 시험에서 결함이 한 주 약 ${(Math.round(rate * 10) / 10).toLocaleString('ko-KR')}개씩 줄어듭니다` : ''}`
      : `${fix ? '' : `시험 <b>${minT - p.testWeeks}주</b> 뒤 출시할 수 있습니다 · `}${fixLine(p.defectEst)}`;
    const avg = team.length ? team.reduce((a, x) => a + x.condition, 0) / team.length : 0, w = condWord(avg);
    const cond = team.length ? `<div class="team-cond">팀 컨디션 <span class="cbar c${w === '좋음' ? 0 : w === '보통' ? 1 : 2}"><u style="width:${Math.round(avg * 100)}%"></u></span><b>${w}</b>${w === '지침' ? '<span>· 회사 탭 직원 화면에서 휴식을 줄 수 있습니다</span>' : ''}</div>` : '';
    return `${steps}<p class="eta"><span>${eta}</span></p>${cond}`;
  }
  /** 개발을 기다리는 동안 할 수 있는 일: 채용, 연구, 다음 차 기획 */
  function waitTodo(free: boolean): string {
    const s = game!.state, h = Q.hiringInfo(s), r = Q.researchInfo(s);
    const b = (act: string, v: string, name: string, sub: string) => `<button class="btn" data-act="${act}" data-v="${v}"><span>${name}<small>${sub}</small></span><span aria-hidden="true">→</span></button>`;
    return `<p class="lbl wait-lbl">기다리는 동안 할 수 있는 일</p><div class="wait-todo">${b('goCo', 'staff', '직원 채용', h.candidates.length ? `후보 ${h.candidates.length}명이 기다립니다` : h.full ? `정원 ${h.staffCount}/${h.capacity}명이 찼습니다` : `정원 ${h.staffCount}/${h.capacity}명 · 공고를 낼 수 있습니다`)}
      ${b('goCo', 'research', '연구', r.pointsPerWeek <= 0 ? '일할 수 있는 엔지니어가 없어 지금은 연구 점수가 0입니다' : r.used < r.slots ? `연구 칸 ${r.slots - r.used}개가 비어 있습니다 · 개발 중에도 연구가 조금씩 됩니다` : `연구 ${r.used}개 진행 중 · 한 주 ${pts1(r.pointsPerWeek)}점`)}
      ${draft || lift ? b('resumePlan', '', '다음 차 기획', '기획 중인 초안을 이어서 합니다') : free ? b('plan', '', '다음 차 기획', '비어 있는 개발팀이 있습니다') : sellingGens(s).length ? b('tab', 'garage', '판매 중인 차 살피기', '가격·광고를 조정합니다') : b('goCo', 'hq', '본사', '본사를 키우면 정원과 개발팀이 늘어납니다')}</div>`;
  }
  /** 1.3.0 개발 중 직원 성과 목록(언제·누가·무엇을). 글에 이름이 들어 있다 */
  const winsList = (ws: StaffWin[] | undefined) => ws?.length ? `<div class="wins"><p class="lbl">직원 성과 ${ws.length}건${ib('term:직원 성과')}</p><ul class="log wins-list">${ws.map((w) => `<li>${esc(w.text)} <small>${ROLE_NAME[w.role]} · ${esc(Q.dateLabel(w.week))}</small></li>`).join('')}</ul></div>` : '';
  /** 1.3.0 평론가별 시승기(평론가 이름·매체·점수·글) */
  const critiqueList = (genId: number) => { const C = Q.critiquesOf(game!.state, genId); return C.length ? `<div class="crits">${C.map((c) => `<div class="crit"><div class="crit-h"><b>${esc(c.name)}</b><small>${esc(c.outlet)}</small><span class="crit-s">${score(c.score)}</span></div><p>${esc(c.text)}</p></div>`).join('')}</div>` : ''; };
  /** 결함 안내 한 줄(시험 단계·출시 화면) */
  const defectBox = (a: ReturnType<typeof Q.defectAdvice>) => `<div class="${a.level === 'many' ? 'badbox' : a.level === 'some' ? 'warnbox' : 'okbox'} defect-adv" data-level="${a.level}" style="margin-top:10px">${esc(a.text)}</div>`;

  // ----- 출시 -----
  /** 새 생산 라인 없이 이어서 낼 수 있는가(페이스리프트, 판매 중인 전 세대가 있는 풀체인지) */
  const prevOf = (p: Project) => { const id = p.kind === 'fullchange' ? p.targetId : p.kind === 'derivative' ? p.into : undefined; return id === undefined ? undefined : game!.state.nameplates.find((n) => n.id === id)?.generations.at(-1); }; // 1.3.0 파생의 다음 세대는 그 파생 차종의 전 세대
  /** 1.3.0 파생 모델 개발의 바탕 세대(파생이 아니면 없음) */
  const derivBase = (p: Project) => (p.kind === 'derivative' ? Q.generationById(game!.state, p.targetId ?? -1) : undefined);
  /** 1.3.0 출시 예상 원가 배수: 파생 종류 배수와 개발 중 직원 성과(원가 인하)까지(페이스리프트는 그 세대의 값에 더한다) */
  const projCostMult = (p: Project) => { const tg = p.kind === 'facelift' ? Q.generationById(game!.state, p.targetId ?? -1) : undefined, cut = (p.wins ?? []).filter((w) => w.kind === 'cost').reduce((a, w) => a + w.value, 0);
    return Q.genCostMult(game!.state, { powertrain: p.powertrain, variant: p.variant, costCut: Math.min(config.staffWins.costCutMax, (tg?.costCut ?? 0) + cut) }); };
  function launchView(): View {
    const s = game!.state, L = launch!, p = Q.projectById(s, L.pid)!, fl = p.kind === 'facelift', prev = prevOf(p), db = derivBase(p);
    const inherits = fl || (!!prev && prev.status !== 'discontinued') || (!!db && sellingGens(s).some((g) => Q.lineRoot(Q.nameplateOf(s, g.id)!) === Q.lineRoot(Q.nameplateOf(s, db.id)!))); // 1.3.0 파생 차종은 바탕 차종의 생산 라인을 함께 쓴다
    const up = Q.unitProfit(p.body, p.powertrain, p.tier, p.options, L.price, projCostMult(p), Q.ptCostAdd(s, p.powertrain, p.battery, Q.projectPlatform(s, p))), ex = fl ? null : Q.expectedReviews(s, p.id, L.price), fc = fl ? null : Q.salesForecast(s, p.id, L.price, L.marketing), free = inherits || Q.hasFreeLine(s), reg = Q.regulationError(s, p);
    const look = projLook(p, L.color, L.wheels);
    const ovh = ovTop(fl ? '페이스리프트 출시 준비' : p.kind === 'fullchange' ? '풀체인지 출시 준비' : db ? `파생 모델 출시 준비 · ${esc(Q.variantById(p.variant)?.name ?? '')}` : '출시 준비', esc(p.name) + (fl ? '<small>페이스리프트</small>' : ''), `${specLine(p.body, p.powertrain, p.tier, p.segment)} · ${paintName(L.color)} · ${WHEELS[L.wheels].name}`) + ovHint;
    const adv = Q.defectAdvice(p, s);
    // 혹평 예고: 예상 평점이 혹평 기준 + 0.5 이하면(실제 평론은 ±0.7 안팎) "출시해도 좋습니다" 대신 붉은 경고
    const flopRisk = !!ex && ex.avg <= config.critics.flop + 0.5, rd = ex ? repDelta(ex.avg) : 0;
    // 0.9.0 출시 전 점검 수치는 무대 아래 띠(결함·리콜 위험·평판 변화·예상 평점), 패널에는 경고 글만
    const keys = `<div class="key"><small>남은 결함${ib('term:결함')}</small><b>약 ${num(p.defectEst)}<span>개</span></b></div><div class="key"><small>리콜 위험(연)${ib('term:리콜')}</small><b class="${adv.level === 'many' ? 'neg' : ''}">연 ${Math.round(adv.recallYear * 100)}<span>%</span></b></div>
      ${ex ? `<div class="key"><small>평판 변화${ib('term:평판')}</small><b class="${rd < 0 ? 'neg' : rd > 0 ? 'pos' : ''}">${repWord(rd).replace('평판 ', '')}</b></div><div class="key key-rv">${ring(ex.avg)}<div><small>예상 평점${ib('term:예상 평점')}</small><b>${score(ex.avg)}</b></div></div>` : ''}`;
    const card0 = `<div class="card launch-check"><p class="lbl">출시 전 점검</p>
      ${flopRisk ? `<div class="badbox flop-risk" style="margin-top:10px">예상 평점 ${score(ex!.avg)}점으로 혹평(${config.critics.flop}점 이하) 위험이 큽니다. 혹평이면 평판이 ${(Math.round(-config.critics.flopRep * diffOf(s).repLossMult * 10) / 10).toLocaleString('ko-KR')} 떨어지고 판매도 부진합니다. 가격을 낮추거나 개발을 더 하는 편이 낫습니다.</div>${adv.level === 'ok' ? '' : defectBox(adv)}` : defectBox(adv)}${reg ? `<div class="badbox reg-why" style="margin-top:10px">${esc(reg)}</div>` : ''}</div>`;
    const fln = fl ? Q.priceForecast(s, p.targetId ?? -1, L.price) : null, mk = fl ? (Q.generationById(s, p.targetId ?? -1)?.marketing ?? 0) : L.marketing; // 페이스리프트: 지금 차 기준 어림
    const pr = fc ? [monthProfit(fc.min, up, mk), monthProfit(fc.max, up, mk)] : fln !== null ? [monthProfit(fln, up, mk)] : null;
    const card1 = `<div class="card price-card"><p class="lbl">판매 가격${fl ? '(다시 정하기)' : ''}</p>${priceBlock('lprice', { ref: (() => { const tg = fl ? Q.generationById(s, p.targetId ?? -1) : undefined; return tg ? Q.genBasePrice(s, tg) : Q.carBasePrice(s, p); })(), price: L.price, body: p.body, up,
      sales: fc ? `${fc.min === fc.max ? num(fc.min) : `${num(fc.min)}~${num(fc.max)}`}<span>대</span>` : fln !== null ? `약 ${num(fln)}<span>대</span>` : '—', profit: pr ? [...new Set(pr.map((x) => `<span class="nw">${money(x, true).replace(/(만원|억)$/, '<span>$1</span>')}</span>`))].join('~<wbr>') : '—', pcls: !pr ? '' : pr.every((x) => x >= 0) ? 'pos' : pr.every((x) => x < 0) ? 'neg' : '' })}
      ${fc ? `<p class="hint sales-fc px-note" id="lprice-fc" data-live>출시 ${config.forecast.months}개월째 기준 어림: 한 달에 약 <b>${num(fc.min)}~${num(fc.max)}대</b>(±${Math.round(config.forecast.spread * 100)}%, 공장 한도 ${num(Q.capacityOf(s))}대). 월 이익은 광고비를 빼고 직원 월급·유지비는 넣지 않은 값입니다.</p>` : `<p class="hint px-note">가격을 낮추면 판매량은 늘지만 대당 이익이 줄어듭니다. 월 이익은 광고비를 빼고 직원 월급·유지비는 넣지 않은 값입니다.</p>`}
      ${bestRow('lprice', `l${p.id}`, L.price, '')}
      ${fl ? '' : `<p class="lbl" style="margin-top:10px">광고${ib('term:광고')} · 매달 광고비가 듭니다 · 처음에는 '조금'</p><div class="seg">${MARKETING.map((m, i) => `<button data-act="lset" data-k="marketing" data-v="${i}" aria-pressed="${L.marketing === i}">${m}<small>${i ? money(config.awareness.marketingCost[i]) : '0원'}</small></button>`).join('')}</div>`}</div>`;
    const card2 = `<div class="card"><p class="lbl">색상${fl ? '(그대로 두거나 바꾸기)' : ''}</p>${paints('lset', L.color)}
      <p class="lbl" style="margin-top:14px">휠</p><div class="opts">${WHEELS.map((w, i) => `<button class="opt" data-act="lset" data-k="wheels" data-v="${i}" aria-pressed="${L.wheels === i}" style="min-height:0"><svg viewBox="0 0 80 42" aria-hidden="true"><circle cx="40" cy="21" r="${13 + i * 3}" fill="none" stroke="currentColor" stroke-width="${5 - i}"/><circle cx="40" cy="21" r="2.5" fill="currentColor"/></svg><b>${w.name}</b><small>${w.sub} · 겉모습만</small></button>`).join('')}</div></div>`;
    const critics = config.critics.list;
    const card3 = ex ? `<div class="card"><p class="lbl">예상 평론</p>
      ${critics.map((c, i) => `<div class="stat"><span>${c.name}${ib(`critic:${c.id}`, c.name)}</span><div class="track"><u style="width:${ex.scores[i] * 10}%"></u></div><b>${score(ex.scores[i])}</b></div>`).join('')}
      <p class="note">예상 월 판매는 인지도가 어느 정도 오른 출시 ${config.forecast.months}개월째를 기준으로 한 어림이며 ±${Math.round(config.forecast.spread * 100)}% 범위로 보입니다. 출시 직후는 이보다 적게 팔립니다. 실제 평론 점수는 예상과 0.7점 안팎 차이가 날 수 있습니다.${prev ? ' 풀체인지는 전작과 비교해 평론이 조금 오르내립니다.' : ''}</p></div>` : '';
    const sum = fl ? `새 얼굴로 바꿔 내놓습니다: <b>${num(L.price)}만원</b>(대당 이익 ${money(up, true)}) · 결함 약 ${num(p.defectEst)}개. 평론가는 다시 평가하지 않고 신문에 기사가 납니다.`
      : `이 조건으로 출시합니다: <b>${num(L.price)}만원</b>(대당 이익 ${money(up, true)}) · 광고 ${MARKETING[L.marketing]} · 예상 평점 ${ex ? score(ex.avg) : '—'} · 월 ${fc ? `${num(fc.min)}~${num(fc.max)}대` : '—'} · 결함 약 ${num(p.defectEst)}개`;
    const card4 = `<div class="card launch-go"><p class="lbl">출시 요약</p><p class="hint launch-sum">${sum}</p>
      ${prev && prev.status === 'onSale' ? `<div class="warnbox prev-end" style="margin-top:10px">출시하면 ${prev.number}세대는 이번 달 말에 단종됩니다(재고 처분 1개월).</div>` : ''}
      ${free ? '' : `<div class="badbox" style="margin-top:10px">공장의 생산 라인 ${Q.linesOf(s)}개를 모두 쓰고 있습니다. 판매 중인 차를 단종하면 그달 말부터 라인이 빕니다. 공장을 증설하면 라인이 늘어납니다.</div><div class="row line-fix" style="margin-top:8px">${weakest() ? `<button class="btn" data-act="goWeak">가장 안 팔리는 「${esc(nameOf(weakest()!))}」 보기 · 단종</button>` : ''}<button class="btn" data-act="goCo" data-v="factory">공장 증설 보기</button></div>`}
      <div class="row" style="margin-top:12px"><button class="btn" data-act="devHome">← 개발 화면으로</button><button class="go" data-act="doLaunch" ${free && !reg ? '' : 'disabled'}>출시하기 <span aria-hidden="true">→</span></button></div></div>`;
    const t = tallStage(); // 키 큰 화면: 예상 평론 카드를 무대 아래로
    return { ov: ovh, panel: pcols(card1, card4 + card0 + (t ? '' : card3) + card2), look, keys: keys + (t && card3 ? `<div class="key-more">${card3}</div>` : '') }; // 0.9.0 왼쪽: 가격, 오른쪽 위: 출시 요약·[출시하기](태블릿 가로에서 스크롤 없이), 그 아래 점검·평론·색
  }

  /** 판매 중인 차 가운데 지난달 판매가 가장 적은 차(라인 막힘 해결 바로 가기) */
  const weakest = (): Generation | undefined => sellingGens(game!.state).filter((g) => g.status === 'onSale').sort((a, b) => (a.sales.at(-1) ?? 0) - (b.sales.at(-1) ?? 0))[0];
  /** 출시 준비 화면 열기. 고르던 값(가격·광고·색·휠)이 있으면 그대로 */
  function openLaunch(pid: number): void {
    const s = game!.state, p = Q.projectById(s, pid); if (!p) return;
    devSel = pid;
    if (launch?.pid === p.id) { go('launch'); return; }
    const g = p.kind === 'facelift' ? Q.generationById(s, p.targetId ?? -1) : undefined, e = g && currentEdition(g); // 페이스리프트: 지금 가격·색·휠·광고에서 시작
        launch = e ? { pid: p.id, price: e.price, marketing: g!.marketing, color: e.color, wheels: e.wheels } : { pid: p.id, price: Math.round(Q.carBasePrice(s, p) / 10) * 10, marketing: 1, color: ui.colors[p.id] ?? PAINT[0][1], wheels: 1 };
    go('launch');
  }

  // ----- 리뷰 -----
  /** 평론 평균 → 출시 때 평판 변화(sim과 같은 식: 5 넘는 만큼 +, 명차 +4, 혹평 −3 × 난이도 감점 배수) */
  const repDelta = (avg: number) => { const c = config.critics, R = config.reputation; return Math.max(0, avg - R.launchBase) * R.launchPer + (avg >= c.masterpiece ? c.masterpieceRep : avg <= c.flop ? c.flopRep * diffOf(game!.state).repLossMult : 0); };
  const repWord = (d: number) => `평판 ${d >= 0.05 ? '+' : d <= -0.05 ? '−' : '±'}${(Math.round(Math.abs(d) * 10) / 10).toLocaleString('ko-KR')}`;
  function showReview(g: Generation, repChange = repDelta(g.reviewAvg)): void {
    const s = game!.state, name = nameOf(g), list = config.critics.list, avg = g.reviewAvg, c = config.critics, crit = Q.critiquesOf(s, g.id); // 1.3.0 평론가별 시승기
    const best = g.reviews.indexOf(Math.max(...g.reviews)), worst = g.reviews.indexOf(Math.min(...g.reviews));
    const head = g.editions[0].headline ?? (avg >= c.masterpiece ? `「${name}」 명차 탄생, 평론가들 극찬` : avg >= 6 ? `「${name}」 순조로운 데뷔` : avg > c.flop ? `「${name}」 무난하지만 아쉬움 남겨` : `「${name}」 혹평 쏟아져, "다시 만들어라"`);
    const bodyTxt = `${list[best].name}${josa(list[best].name, '은/는')} ${score(g.reviews[best])}점으로 가장 후한 점수를 줬고, ${list[worst].name}${josa(list[worst].name, '은/는')} ${score(g.reviews[worst])}점에 그쳤다. ${avg >= 6 ? '전시장에는 첫 주부터 손님이 몰렸다.' : avg > c.flop ? '업계는 가격과 입소문이 판매를 가를 것으로 본다.' : '판매 담당자들의 표정이 어둡다.'}`;
    const rival = [...s.rivals].sort((a, b) => (b.cells[g.body] ?? 0) - (a.cells[g.body] ?? 0))[0];
    const quote = avg >= 7 ? '긴장하고 있다' : avg >= 5 ? '지켜보겠다' : '걱정하지 않는다';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>출시 평가 · ${esc(Q.monthLabel(g.launchMonth))}</div><h2>「${esc(name)}」 평론가 4명의 점수</h2>
      <div class="rgrid"><div><div class="critics">${list.map((cr, i) => { const t = crit.find((x) => x.critic === cr.id); return `<div class="critic wait" data-i="${i}" data-tip="critic:${cr.id}"><small>${cr.name}${ib(`critic:${cr.id}`, cr.name)}</small><em>${t ? `${esc(t.name)} · ${esc(t.outlet)}` : CRITIC_SUB[cr.id] ?? ''}</em><b>${score(g.reviews[i])}<span> / 10</span></b>${t ? `<p class="crit-t">${esc(t.text)}</p>` : ''}</div>`; }).join('')}</div>
      <div class="avgline later" id="rv-avg"><div><small class="hint">평균</small><b>${score(avg)}</b></div>${g.masterpiece ? `<span class="badge">명차 등록 · ${repWord(repChange)}</span>` : avg <= c.flop ? `<span class="badge flop">혹평 · ${repWord(repChange)}</span>` : avg >= 6 ? `<span class="chip on">호평 · ${repWord(repChange)}</span>` : `<span class="chip">무난한 평가 · ${repWord(repChange)}</span>`}</div></div>
      <div class="later" id="rv-news"><div class="news"><div class="mast"><span>모터 데일리</span><span>${esc(Q.monthLabel(g.launchMonth))}</span></div><h3>${esc(head)}</h3><p>${esc(bodyTxt)}</p>${rival ? `<div class="rv">${logo(rival.id, 22)}<span>${esc(rival.name)} 관계자: "${quote}"</span></div>` : ''}</div>
      ${winsList(g.wins)}<button class="go dark" data-act="closeReview">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches, gap = still ? 0 : 650;
    list.forEach((_, i) => reviewTimers.push(window.setTimeout(() => { const el = sheetBody.querySelector(`.critic[data-i="${i}"]`); el?.classList.remove('wait'); el?.classList.add('pop'); }, gap * (i + 1))));
    reviewTimers.push(window.setTimeout(() => { $('#rv-avg').classList.add('show'); sfx(avg >= 7 ? 'reviewGood' : avg >= 4.5 ? 'reviewMid' : 'reviewBad'); }, gap * (list.length + 1)));
    reviewTimers.push(window.setTimeout(() => { $('#rv-news').classList.add('show'); sheetBody.querySelector<HTMLElement>('[data-act="closeReview"]')?.focus(); }, gap * (list.length + 2)));
  }

  /** 신문 한 장(페이스리프트 출시 기사, 소식 알림) */
  function showNews(head: string, body = '', month = monthOf(game!.state.week), label = '신문', byMe = false): void {
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>${esc(label)} · ${esc(Q.monthLabel(month))}</div><div class="news paper"><div class="mast"><span>모터 데일리</span><span>${esc(Q.monthLabel(month))}</span></div><h3>${esc(head)}</h3>${body ? `<p>${esc(body)}</p>` : ''}${byMe ? `<div class="rv me-by">${myLogo(22)}<span>${esc(game!.state.companyName)}</span></div>` : ''}</div>
      <button class="go dark" data-act="closeReview">닫기</button>`;
    sheet.hidden = false; renderTop();
    sheetBody.querySelector<HTMLElement>('[data-act="closeReview"]')?.focus();
  }

  // ----- 시대 사건(11장) -----
  /** 뉴스 한 줄: 앞의 [사건 이름]은 본문이 그 이름으로 시작하거나 예고면 떼고, 아니면 "사건 이름: 본문" */
  const newsLine = (text: string) => { const m = text.match(/^\[([^\]]*)\]\s*/), rest = m ? text.slice(m[0].length) : text; return !m || m[1] === '예고' || rest.startsWith(m[1]) ? rest : `${m[1]}: ${rest}`; };
  const NEWS_KIND: Record<NewsCategory, string> = { preview: '예고', start: '사건 시작', end: '사건 끝', regulation: '규제 시행', choice: '선택 사건', result: '결정 결과', research: '연구', rival: '경쟁사 동향', sub: '자회사', world: '세계 시장', other: '모터 데일리' };
  /** 뉴스 한 줄 → 신문 한 장. 시작 기사면 지금 걸린 효과를 본문에 */
  function showNewsItem(text: string, week: number, k: NewsCategory = 'other'): void {
    const head = text.replace(/^\[[^\]]*\]\s*/, ''), tag = text.match(/^\[([^\]]*)\]/)?.[1] ?? '';
    const ev = k === 'start' || k === 'regulation' ? Q.activeEvents(game!.state).events.find((x) => x.name === tag) : undefined;
    showNews(head, ev ? `지금 걸려 있는 효과: ${ev.effects.join(' ')}` : k === 'preview' ? '아직 시작되지 않은 사건입니다. 몇 달 안에 일어날 수 있습니다.' : '', monthOf(week), `${NEWS_KIND[k]}${tag && tag !== '예고' ? ` · ${tag}` : ''}`);
  }
  /** 3.7.1 자동 승인을 켠 종류인데 결정 창이 뜬 이유 */
  const heldWhy = (id: number): string => { const s = game!.state, pc = s.events.pending.find((p) => p.id === id)!, why = Q.autoHold(s, pc, Q.autoPick(s, pc).choice);
    return why ? `자동 승인을 켠 종류지만 정한 답을 바로 하지 않고 묻습니다: ${why}(설정 › 결정).` : '자동 승인을 켜기 전에 생긴 결정이라 묻습니다.'; };
  /** 답을 기다리는 무작위 사건(맨 앞 것) 창: 선택지와 결과, 남은 주, [나중에] */
  function showChoice(): void {
    const list = Q.pendingChoices(game!.state), c = list[0];
    if (!c) { sheet.hidden = true; render(); return; }
    const def = c.choices[c.defaultChoice]?.label ?? '';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="choice-sheet" data-id="${c.id}"><div class="eyebrow"><i></i>결정이 필요합니다${list.length > 1 ? ` · ${list.length}건 중 1` : ''}</div><h2>${esc(c.name)}</h2><p class="ev-text">${esc(c.text)}</p>
      <div class="evchoices">${c.choices.map((x, i) => `<button class="evc" data-act="resolveEv" data-id="${c.id}" data-v="${i}"><b>${esc(x.label)}${i === c.defaultChoice ? ' <small>(고르지 않으면 이것)</small>' : ''}</b><small>${esc(x.result)}</small>${x.costText ? `<span class="ev-cost ${x.cost > 0 ? 'neg' : 'pos'}">${esc(x.costText)}</span>` : ''}</button>`).join('')}</div>
      <p class="hint" style="margin-top:10px">${c.weeksLeft}주 안에 고르지 않으면 「${esc(def)}」${josa(def, '으로/로')} 정해집니다. 이 창이 떠 있는 동안 시간이 멈춥니다.</p>
      ${Q.autoOn(game!.state, c.eventId) ? `<p class="hint auto-held">${esc(heldWhy(c.id))}</p>` : `<label class="chk auto-chk"><input type="checkbox" data-ad="${esc(c.eventId)}"> 이 종류(${esc(c.name)})는 앞으로 지금 고르는 답으로 자동 승인 ${ib('term:결정 자동 승인')}</label>`}
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="later">나중에</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 진행 중인 사건 창: 효과, 충전 인프라 보급률, 필수 옵션, 다가오는 사건 */
  function showEvents(): void {
    const s = game!.state, a = Q.activeEvents(s), up = Q.upcomingEvents(s);
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="events-sheet"><div class="eyebrow"><i></i>시대 사건 · ${esc(game!.dateLabel)}</div><h2>지금 걸려 있는 사건 ${a.events.length}개</h2>
      ${a.events.length ? `<div class="evlist">${a.events.map((x) => `<div class="evbox"><div class="prod-h"><b>${esc(x.name)}</b><small>${x.monthsLeft === null ? '계속 이어짐' : `앞으로 ${x.monthsLeft}개월`}</small></div>${x.kind === 'era' ? `<p class="hint">${esc(x.text)}</p>` : ''}<ul>${x.effects.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>` : '<p class="hint">지금 걸려 있는 사건이 없습니다.</p>'}
      <div class="kpis" style="margin-top:12px">${kpi(`충전 인프라 보급률${ib('term:충전 인프라')}`, `${Math.round(a.chargingInfra * 100)}<span>%</span>`)}${kpi(`출시에 꼭 필요한 옵션${ib('term:유예 기간')}`, a.requiredOptions.length ? a.requiredOptions.map((o) => esc(optionById(o).name)).join('·') : '없음')}</div>
      ${up.length ? `<p class="lbl" style="margin-top:14px">다가오는 사건(예고)</p><ul class="uplist">${up.map((x) => `<li>${esc(x.warn)} <small class="hint">· 약 ${x.monthsLeft}개월 뒤</small></li>`).join('')}</ul>` : ''}
      <p class="note">이 게임의 역사 사건과 시장 수치는 게임에 맞게 어림한 것이라 실제와 다를 수 있습니다.</p>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }

  // ----- 회사(9장): 안쪽 탭 재무 / 직원 / 본사 / 공장 -----
  const CO_TABS: [CoTab, string][] = [['sum', '요약'], ['staff', '직원'], ['exec', '임원'], ['hq', '본사'], ['factory', '공장'], ['sub', '자회사'], ['world', '세계']];
  const ROLE_ORDER: Role[] = ['designer', 'engineer', 'tester', 'sales'];
  const condWord = (c: number) => (c < config.staff.condition.low ? '지침' : c < config.staff.condition.mid ? '보통' : '좋음');
  const growWord = (gap: number) => (gap >= 25 ? '성장 여지 큼' : gap >= 15 ? '성장 여지 보통' : '성장 여지 작음');
  const SALES_EFFECT = '영업 직원이 있으면 인지도가 빨리 오르고 법인 판매가 늘어납니다.';
  /** 비교 줄. cost = 늘면 나쁜 값(유지비) */
  const cmpRow = (label: string, a: string, b: string, cost = false) => `<tr><td>${label}</td><td class="r">${a}</td><td class="r"><b class="${a === b ? '' : cost ? 'neg' : 'pos'}">${b}</b></td></tr>`;
  function companyView(): string {
    const tabs = `<div class="seg cotabs" role="tablist" aria-label="회사">${CO_TABS.map(([k, l]) => `<button role="tab" data-act="cotab" data-v="${k}" aria-selected="${coTab === k}">${l}</button>`).join('')}</div>`;
    return tabs + (coTab === 'sum' ? V.companySummary(game!.state) : coTab === 'exec' ? execTab() : coTab === 'hq' ? hqTab() : coTab === 'factory' ? factoryTab() : coTab === 'sub' ? subTab() : coTab === 'world' ? worldTab() : staffTab());
  }
  // ----- 4.0.0 세계 시장 -----
  let worldSel = 'na';
  /** 지도 도형(코드로 그린 단순 윤곽, 실제 국경과 다르다). 권역 ID → 경로 */
  const WMAP: Record<string, string> = {
    na: 'M18 40 C30 22 70 14 104 20 C122 24 128 36 118 48 C110 58 102 62 96 72 C88 84 76 92 66 96 C58 88 52 78 44 72 C30 66 14 58 18 40 Z',
    eu: 'M160 30 C170 20 196 18 210 24 C220 30 216 42 208 48 C200 56 186 60 176 58 C166 56 156 46 160 30 Z',
    em: 'M86 104 C98 98 114 102 118 116 C122 132 112 152 100 164 C94 156 90 140 86 128 C82 118 80 110 86 104 Z M170 72 C184 66 204 68 214 78 C222 90 216 112 204 128 C196 140 186 146 180 136 C174 122 166 108 164 92 C162 82 164 76 170 72 Z M244 76 C256 70 270 74 274 86 C276 98 266 108 258 112 C250 104 242 94 244 76 Z',
    rest: 'M214 22 C240 12 300 10 330 18 C346 24 344 38 330 44 C318 50 300 48 286 54 C270 60 254 62 240 58 C226 54 216 44 214 22 Z M290 120 C304 112 330 114 336 126 C340 138 324 146 306 144 C292 142 284 130 290 120 Z',
    domestic: 'M300 58 C304 56 308 58 308 63 C308 69 305 73 302 72 C299 70 298 62 300 58 Z',
  };
  const WLABEL: Record<string, [number, number]> = { na: [66, 52], eu: [188, 40], em: [194, 104], domestic: [320, 82] };
  function worldMap(views: WD.RegionView[]): string {
    const s = game!.state, dom = sellingGens(s).reduce((a, g) => a + (g.sales.at(-1) ?? 0), 0);
    const shape = (id: string, cls: string, label: string, sub: string) => { const [x, y] = WLABEL[id]; return `<g class="wm-r ${cls}" ${id === 'domestic' ? '' : `data-act="wSel" data-v="${id}" role="button" tabindex="0" aria-label="${esc(label)} ${esc(sub)}"`}><path d="${WMAP[id]}"/><text x="${x}" y="${y}" text-anchor="middle">${esc(label)}</text><text class="wm-sub" x="${x}" y="${y + 11}" text-anchor="middle">${esc(sub)}</text></g>`; };
    const st = (v: WD.RegionView) => (v.open ? (v.office ? `판매 법인 ${v.office}등급` : '수출') : '진출 전');
    return `<svg class="wmap" viewBox="0 0 360 172" role="group" aria-label="세계 지도"><path class="wm-rest" d="${WMAP.rest}"/>${views.map((v) => shape(v.id, `${v.open ? 'open' : v.error ? 'shut' : 'ready'}${worldSel === v.id ? ' sel' : ''}`, v.name, st(v))).join('')}${shape('domestic', 'home', '국내', `${num(dom)}대`)}</svg>`;
  }
  function worldTab(): string {
    const s = game!.state, views = WD.regionViews(s);
    if (!views.some((v) => v.id === worldSel)) worldSel = views[0].id;
    const domSold = sellingGens(s).reduce((a, g) => a + (g.sales.at(-1) ?? 0), 0), L = s.ledger.at(-1);
    const rows = views.map((v) => `<tr class="${worldSel === v.id ? 'on' : ''}" data-act="wSel" data-v="${v.id}"><td><b>${esc(v.name)}</b></td><td>${v.open ? (v.office ? `법인 ${v.office}등급` : '수출') : '<span class="hint">진출 전</span>'}</td><td class="r">${v.open ? `${num(v.sold)}대` : '—'}</td><td class="r">${v.open ? `${(v.share * 100).toFixed(1)}%` : '—'}</td><td class="r ${v.profit >= 0 ? 'pos' : 'neg'}">${v.open ? money(v.profit, true) : '—'}</td></tr>`).join('');
    const head = `<div class="card w-head"><h3>세계 시장 ${ib('term:해외 진출')}</h3>${worldMap(views)}
      <table class="tbl w-sum"><tr><th>권역</th><th>상태</th><th class="r">지난달 판매</th><th class="r">점유</th><th class="r">지난달 이익</th></tr><tr><td><b>국내</b></td><td>본사</td><td class="r">${num(domSold)}대</td><td class="r">—</td><td class="r">—</td></tr>${rows}</table>
      ${L?.world ? `<p class="hint">지난달 해외 매출 ${money(Object.values(L.world).reduce((a, x) => a + x.revenue, 0))} · 전체 매출의 ${Math.round(WD.overseasShare(L.revenue, L.world) * 100)}% · 관세 ${money(L.tariff ?? 0)} · 운송비 ${money(L.ship ?? 0)}</p>` : '<p class="hint">권역을 누르면 시장 규모와 취향, 진출 조건을 봅니다. 진출하면 국내 공장에서 만든 차를 수출합니다.</p>'}</div>`;
    return `<div class="w-wrap">${head}${regionCard(views.find((v) => v.id === worldSel)!)}</div>`;
  }
  function regionCard(v: WD.RegionView): string {
    const s = game!.state, mx = Math.max(...v.bodies.map((b) => b.share));
    const taste = `<p class="lbl">시장 취향 · 차급 비중</p><div class="w-bars">${v.bodies.slice(0, 8).map((b) => `<div class="w-bar"><span>${esc(bodyById(b.body).name)}</span><i><u style="width:${((b.share / mx) * 100).toFixed(0)}%"></u></i><small>${Math.round(b.share * 100)}%</small></div>`).join('')}</div>
      <p class="hint">${esc(v.taste)}</p><p class="hint">한 달 시장 약 ${num(v.market)}대 · 관세 ${Math.round(v.tariffRate * 100)}%(대당 원가에)${ib('term:관세')} · 운송비 대당 ${money(v.shipCost)}${ib('term:운송비')}</p>`;
    if (!v.open) return `<div class="card w-reg"><h3>${esc(v.name)} <small class="hint">진출 전</small></h3>${taste}
      <div class="kpis">${kpi('진출 조건', esc(v.rule))}${kpi('진출비', money(v.entry))}${kpi('시작 권역 평판', String(Math.round(v.rep)))}</div>
      ${v.error ? `<div class="badbox">${esc(v.error)}</div>` : ''}<button class="go" data-act="wOpen" data-v="${v.id}" ${v.error ? 'disabled' : ''}>${esc(v.name)} 진출 · ${money(v.entry)}</button></div>`;
    const cars = WD.regionCars(s, v.id), nx = v.officeNext;
    const kp = `<div class="kpis">${kpi('지난달 판매', `${num(v.sold)}<span>대</span>`)}${kpi(`판매 상한${ib('term:판매 상한')}`, `${num(v.cap)}<span>대</span>`)}${kpi('점유', `${(v.share * 100).toFixed(1)}<span>%</span>`)}${kpi('지난달 이익', money(v.profit, true), v.profit >= 0 ? 'pos' : 'neg')}${kpi(`권역 인지도${ib('term:권역 인지도')}`, `${Math.round(v.aw * 100)}<span>%</span>`)}${kpi(`권역 평판${ib('term:권역 평판')}`, String(Math.round(v.rep)))}</div>`;
    const office = `<div class="w-office"><p class="lbl">판매 법인${ib('term:판매 법인')} · ${v.office ? `${v.office}등급 · 월 유지비 ${money(v.upkeep)}` : '없음(수출만)'}</p>
      ${nx ? `<p class="hint">${nx.level}등급: 투자비 ${money(nx.cost)}, 월 유지비 ${money(nx.upkeep)}, 판매 상한 시장의 ${Math.round(v.capShare * 100)}% → ${Math.round(nx.capShare * 100)}%, 인지도가 더 빨리 오릅니다.</p><button class="btn" data-act="wOffice" data-v="${v.id}" ${nx.error ? 'disabled' : ''}>판매 법인 ${nx.level}등급 투자 · ${money(nx.cost)}</button>${nx.error ? `<p class="hint">${esc(nx.error)}</p>` : ''}` : '<p class="hint">가장 높은 등급입니다.</p>'}</div>`;
    const auto = `<label class="chk w-auto"><input type="checkbox" data-act="wAuto" data-v="${v.id}" ${v.auto ? 'checked' : ''}> 자동 수출${ib('term:자동 수출')} <small class="hint">이익이 나는 새 차를 넣고 단종·적자 차를 뺍니다</small></label>`;
    const list = cars.length ? `<div class="tblwrap"><table class="tbl w-cars"><tr><th>차종</th><th>수출</th><th class="r">권역 가격</th><th class="r">지난달</th><th class="r">대당 이익</th><th class="r">누적 이익</th></tr>${cars.map((c) => `<tr><td>${esc(c.name)} <small class="hint">${esc(bodyById(c.body).name)}</small>${c.block ? `<br><small class="neg">${esc(c.block)}</small>` : ''}</td>
      <td><button class="btn sm ${c.on ? 'ink' : ''}" data-act="wExp" data-id="${c.id}" data-k="${v.id}" data-v="${c.on ? 'off' : 'on'}" ${c.block && !c.on ? 'disabled' : ''} aria-pressed="${c.on}">${c.on ? '수출 중' : '켜기'}</button></td>
      <td class="r"><button class="lnk" data-act="wPrice" data-id="${c.id}" data-k="${v.id}">${money(c.price)}</button><br><small class="hint">${c.manual ? '수동' : '자동'}</small></td><td class="r">${num(c.sold)}대</td><td class="r ${c.unit >= 0 ? 'pos' : 'neg'}">${money(c.unit, true)}</td><td class="r ${c.profit >= 0 ? 'pos' : 'neg'}">${money(c.profit, true)}</td></tr>`).join('')}</table></div>`
      : '<p class="hint">판매 중인 차가 없습니다.</p>';
    const rk = WD.regionRanking(s, v.id), top = Math.max(...rk.map((x) => x.share), 1e-9);
    const rank = `<p class="lbl">${esc(v.name)} 경쟁사 순위 <small class="hint">대략 점유</small></p><div class="w-bars w-rank">${rk.map((x, i) => `<div class="w-bar ${x.mine ? 'me' : ''}"><span>${i + 1}. ${x.mine || x.local ? esc(x.name) : `${logo(x.id, 16)}${esc(x.name)}`}${x.local ? ib('term:기타 현지 업체') : ''}</span><i><u style="width:${((x.share / top) * 100).toFixed(0)}%"></u></i><small>${(x.share * 100).toFixed(1)}%</small></div>`).join('')}</div>`;
    return `<div class="card w-reg"><h3>${esc(v.name)} <small class="hint">${monthLabelOf(v.since!)} 진출 · 누적 ${num(v.total)}대 · 누적 이익 ${money(v.totalProfit, true)}</small></h3>${kp}${office}${auto}
      <p class="lbl">수출 차종 <small class="hint">관세 ${money(v.tariff)} · 운송비 ${money(v.ship)}(지난달)</small></p>${list}${taste}${rank}</div>`;
  }
  const monthLabelOf = (m: number) => `${yearOfMonth(m)}년 ${(m % 12) + 1}월`;
  function showWorldOpen(id: string): void {
    const s = game!.state, v = WD.regionViews(s).find((x) => x.id === id)!;
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>세계 시장</div><h2>${esc(v.name)} 진출</h2><p>${esc(v.taste)}</p>
      <table class="tbl"><tr><td>진출비</td><td class="r">${money(v.entry)}</td></tr><tr><td>한 달 시장 규모</td><td class="r">약 ${num(v.market)}대</td></tr><tr><td>판매 상한(판매 법인 없음)</td><td class="r">${num(v.cap)}대(시장의 ${Math.round(v.capShare * 100)}%)</td></tr><tr><td>관세·운송비</td><td class="r">원가의 ${Math.round(v.tariffRate * 100)}% + ${money(v.shipCost)}/대</td></tr><tr><td>시작 권역 평판·인지도</td><td class="r">${Math.round(v.rep)} · ${Math.round(config.world.awStart * 100)}%</td></tr></table>
      <p class="note">국내 공장에서 만들어 보내므로 생산 한도를 국내와 나눠 씁니다. 생산이 모자라면 대당 이익이 큰 곳부터 채웁니다. 자동 수출과 자동 권역 가격이 켜진 채로 시작하며, 다음 월 결산부터 팔립니다.</p>
      ${v.error ? `<div class="badbox">${esc(v.error)}</div>` : ''}<div class="row end" style="margin-top:12px"><button class="btn" data-act="closeSheet">취소</button><button class="btn ink" data-act="wOpenDo" data-v="${id}" ${v.error ? 'disabled' : ''}>진출 · ${money(v.entry)}</button></div>`;
    sheet.hidden = false;
  }
  function showOfficeInvest(id: string): void {
    const s = game!.state, v = WD.regionViews(s).find((x) => x.id === id)!, n = v.officeNext; if (!n) return;
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>세계 시장</div><h2>${esc(v.name)} 판매 법인 ${n.level}등급</h2>
      <table class="tbl"><tr><th>무엇이 바뀌나</th><th class="r">지금</th><th class="r">투자 뒤</th></tr>${cmpRow('판매 상한', `${num(v.cap)}대`, `${num(v.market * n.capShare)}대`)}${cmpRow('인지도 목표 가산', `+${Math.round(config.world.office.aw[v.office] * 100)}%`, `+${Math.round(config.world.office.aw[n.level] * 100)}%`)}${cmpRow('월 유지비', money(v.upkeep), money(n.upkeep), true)}</table>
      <div class="kpis" style="margin-top:10px">${kpi('투자비', money(n.cost))}${kpi('지난달 판매', `${num(v.sold)}<span>대</span>`)}${kpi('지난달 권역 이익', money(v.profit, true), v.profit >= 0 ? 'pos' : 'neg')}</div>
      ${n.error ? `<div class="badbox">${esc(n.error)}</div>` : ''}<div class="row end" style="margin-top:12px"><button class="btn" data-act="closeSheet">취소</button><button class="btn ink" data-act="wOfficeDo" data-v="${id}" ${n.error ? 'disabled' : ''}>투자 · ${money(n.cost)}</button></div>`;
    sheet.hidden = false;
  }
  let wPriceSet: { gen: number; rid: string } | null = null;
  function showRegionPrice(gen: number, rid: string): void {
    const s = game!.state, c = WD.regionCars(s, rid).find((x) => x.id === gen); if (!c) return;
    wPriceSet = { gen, rid };
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>${esc(WD.regionName(rid))} 권역 가격${ib('term:권역 가격')}</div><h2>${esc(c.name)}</h2>
      <p class="hint">권역 기준가 ${money(c.base)} · 지금 ${money(c.price)}(${c.manual ? '수동' : '자동'}) · 대당 관세 ${money(c.tariff)} · 운송비 ${money(c.ship)}</p>
      <label class="lbl" for="w-price">권역 가격(만원)</label><input class="namein" id="w-price" type="number" inputmode="numeric" step="10" value="${c.price}">
      <label class="chk w-auto"><input type="checkbox" data-act="wDomFirst" data-id="${gen}" ${Q.generationById(s, gen)?.domFirst ? 'checked' : ''}> 생산이 모자라면 국내 우선${ib('term:국내 우선')}</label>
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="wPriceAuto">자동으로</button><button class="btn" data-act="closeSheet">취소</button><button class="btn ink" data-act="wPriceDo">이 값으로</button></div>`;
    sheet.hidden = false;
  }


  /** 경쟁사가 강한 차급: 점유 점수가 높은 순 최대 3개 + "외 n"(초반에 모두 같으면 "모든 차급 고르게") */
  const rivalStrong = (cells: Record<string, number>): string => {
    const e = Object.entries(cells).sort((a, b) => b[1] - a[1]), top = e.filter(([, v]) => v >= e[0][1] * 0.97);
    if (!e.length || top.length === e.length) return '모든 차급 고르게';
    return `${top.slice(0, 3).map(([b]) => bodyById(b).name).join('·')}${top.length > 3 ? ` 외 ${top.length - 3}` : ''} 강함`;
  };
  let finRange: V.FinRange = '1y'; // 1.0.0 재무 기간(1년=달마다 / 5년 / 전체)
  function finTab(): string {
    const s = game!.state, L = s.ledger.at(-1), limit = Q.loanLimit(s), rate = Q.loanRate(s), led = s.ledger;
    const hqUp = Q.hqInfo(s).current.upkeep, fUp = Q.factoryInfo(s).current.upkeep, bUp = Q.batteryPlantInfo(s).upkeep, y = yearOf(s.week), ys = led.filter((e) => e.year === y), ytd = ys.reduce((a, e) => a + e.profit, 0);
    const sum = `<div class="card fin-sum"><h3>재무</h3><div class="kpis">${kpi('현금', money(s.cash), s.cash < 0 ? 'neg' : '')}${L ? kpi(`지난달 이익 <small>${L.monthOfYear}월</small>`, money(L.profit, true), L.profit >= 0 ? 'pos' : 'neg') : ''}${ys.length ? kpi(`올해 이익 <small>${ys.length}개월</small>`, money(ytd, true), ytd >= 0 ? 'pos' : 'neg') : ''}</div>
      <p class="hint" style="margin-top:8px">매달 고정비: 본사 유지비 ${money(hqUp)} · 공장 유지비 ${money(fUp)}${bUp ? ` · 배터리 공장 유지비 ${money(bUp)}` : ''} · 직원 월급 ${money(s.staff.reduce((a, x) => a + Q.salaryOf(x.ability), 0))}</p>
      ${L ? `<button class="btn" data-act="monthOpen" data-v="${led.length - 1}" style="width:100%;margin-top:8px">지난달 결산 펼쳐 보기(차종별·지출 내역·전월 대비)</button>` : ''}</div>`;
    // 대출·구제 금융 조작은 한 카드에
    const loan = `<div class="card fin-loan"><h3>대출·구제 금융</h3><div class="kpis">${kpi('대출', money(s.loan.balance))}${kpi('대출 한도', money(limit))}${kpi(`월 이자${ib('term:대출 이자')}`, `${(rate * 100).toFixed(1)}<span>%</span>`)}</div>
      <div class="row" style="margin-top:10px">${[10000, 50000, 100000].map((a) => `<button class="btn" data-act="borrow" data-v="${a}" ${s.loan.balance + a > limit ? 'disabled' : ''}>${money(a)} 빌리기</button>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="btn" data-act="repay" data-v="10000" ${s.loan.balance < 10000 || s.cash < 10000 ? 'disabled' : ''}>1억 갚기</button><button class="btn" data-act="repay" data-v="all" ${s.loan.balance <= 0 || s.cash < s.loan.balance ? 'disabled' : ''}>모두 갚기</button></div>
      <p class="note">한도는 ${money(diffOf(s).loanBase)}에 최근 1년 매출의 ${Math.round(config.loan.revenueRatio * 100)}%를 더한 값입니다. 한도의 ${Math.round(config.loan.highUse * 100)}% 넘게 빌리면 이자가 올라갑니다. 현금이 ${diffOf(s).bankruptcyMonths}개월 넘게 마이너스면 파산합니다.</p>
      <p class="hint bail-line" style="margin-top:6px">${bailInfo().line} · 난이도 ${esc(diffName(s.difficulty))}</p>
      ${s.cash < 0 && !s.loan.bailoutUsed ? `<div class="badbox" style="margin-top:10px">현금이 ${s.negMonths}개월째 마이너스입니다. 구제 금융(남은 ${bailInfo().left}번)을 받으면 현금이 0이 되지만 평판이 ${-config.bankruptcy.bailoutRep} 떨어지고 대출 한도가 절반이 됩니다.</div><button class="btn danger" data-act="bailout" style="width:100%;margin-top:8px">구제 금융 받기</button>` : ''}</div>`;
    const mine = sellingGens(s).reduce((a, g) => a + (g.sales[g.sales.length - 1] ?? 0), 0);
    const rel = Q.rivalRelations(s);
    const rivals = `<div class="card"><h3>경쟁사</h3><div class="rivals">${s.rivals.map((r, i) => rel[i].out ? `<div class="rv-co rv-out">${logo(r.id, 26)}<span>${esc(r.name)}<br><small>인수함 · 내 자회사</small></span><small class="rv-strong">${esc(s.subs?.find((x) => x.from === r.id)?.name ?? '')}</small></div>` : `<button class="rv-co" data-act="rivalOpen" data-v="${r.id}" aria-label="${esc(r.name)} 라인업 보기">${logo(r.id, 26)}<span>${esc(r.name)}<br><small>${esc(RIVALS.find((x) => x.id === r.id)?.trait ?? '')}</small>${relTags(rel[i])}</span><small class="rv-strong">${rivalStrong(r.cells)}<br>라인업 ${Object.keys(r.models).length}종 ›</small></button>`).join('')}<div class="me">${myLogo(26)}<span>${esc(s.companyName)}<br><small>평판 ${Math.round(s.reputation)}</small></span><span>지난달 ${num(mine)}대</span></div></div><p class="note">회사를 누르면 모델 라인업과 지난 세대, 기술 제휴·인재 영입·인수를 봅니다. 경쟁사 이름·모델 이름·로고는 실제 브랜드를 본뜬 가상의 것이며, 도형은 새로 그렸습니다.</p></div>`;
    // 0.9.0 지난 달들: 누르면 월 결산 창(장부 24개월)
    const months = led.length ? `<div class="card mon-list"><h3>월 결산 <small class="hint">최근 ${led.length}개월 · 누르면 펼쳐 봅니다</small></h3>${[...new Set(led.map((e) => e.year))].reverse().map((y) => `<p class="lbl mon-y">${y}년</p><div class="mbtns">${led.map((e, i) => [e, i] as const).filter(([e]) => e.year === y).reverse().map(([e, i]) => `<button class="btn mbtn" data-act="monthOpen" data-v="${i}" aria-label="${y}년 ${e.monthOfYear}월 결산 보기"><b>${e.monthOfYear}월</b><small class="${e.profit >= 0 ? 'pos' : 'neg'}">${money(e.profit, true)}</small></button>`).join('')}</div>`).join('')}</div>` : '';
    return `<div class="fin-wrap"><div class="fin-l">${V.finMain(s, finRange)}${groupCard()}</div><div class="colstack">${sum}${loan}${months}${rivals}${s.subs?.length ? subHqCard(true) : ''}</div></div>`;
  }

  // ----- 0.8.0 직원 표 정렬·필터 -----
  const STATUS_RANK: Record<Q.StaffRow['status'], number> = { working: 0, idle: 1, training: 2, resting: 3, sales: 4 };
  const staffFits = (x: Q.StaffRow, f: StaffFilter): boolean => f === '' ? true : f === 'exec' ? false : f === 'idle' ? x.status === 'idle' : f === 'working' ? x.status === 'working' : f === 'trainable' ? x.canTrain
    : f === 'tired' ? x.condition < config.staff.condition.low && x.status !== 'resting' && x.status !== 'training' : x.role === f; // 지친 직원: 할 일 목록과 같은 기준
  /** 필터로 보이는 직원(정렬 적용, 같으면 ID 순) */
  function visibleStaff(): Q.StaffRow[] {
    const k = staffView.sort, cmp = (a: Q.StaffRow, b: Q.StaffRow): number => k === 'name' ? a.name.localeCompare(b.name, 'ko') : k === 'role' ? ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
      : k === 'abil' ? a.ability - b.ability : k === 'grow' ? (a.potential - a.ability) - (b.potential - b.ability) : k === 'pay' ? a.salary - b.salary : k === 'cond' ? a.condition - b.condition
      : STATUS_RANK[a.status] - STATUS_RANK[b.status] || (a.projectId ?? 0) - (b.projectId ?? 0);
    return Q.staffInfo(game!.state).filter((x) => staffFits(x, staffView.filter)).sort((a, b) => (staffView.desc ? -1 : 1) * cmp(a, b) || a.id - b.id);
  }
  const sortBtn = (k: StaffSort, label: string) => { const on = staffView.sort === k; return `<button class="sh" data-act="staffSort" data-v="${k}" aria-pressed="${on}"${on ? ` aria-label="${label} ${staffView.desc ? '내림차순' : '오름차순'} 정렬됨"` : ''}>${label}${on ? `<i aria-hidden="true">${staffView.desc ? '▼' : '▲'}</i>` : ''}</button>`; };
  const staffFilterChips = (rows: Q.StaffRow[], execN: number) => `<div class="s-chips" role="group" aria-label="직원 거르기">${STAFF_FILTERS.map(([k, l]) => `<button class="s-chip" data-act="staffFilter" data-v="${k}" aria-pressed="${staffView.filter === k}">${l}<small>${k === 'exec' ? execN : rows.filter((x) => staffFits(x, k)).length}</small></button>`).join('')}</div>`;
  function staffTab(): string {
    const s = game!.state, rows = Q.staffInfo(s), h = Q.hiringInfo(s), T = config.staff.train;
    if (staffSel !== null && !rows.some((x) => x.id === staffSel)) staffSel = null;
    const pname = (id: number | null) => s.projects.find((p) => p.id === id)?.name ?? '';
    const lab = new Set(s.staff.filter((x) => x.lab).map((x) => x.id));
    const doing = (x: Q.StaffRow) => x.status === 'working' ? `「${esc(pname(x.projectId))}」 개발${x.role === 'engineer' ? ` · 연구 ${Math.round(config.research.projectShare * 100)}%` : ''}` : x.status === 'training' ? `교육 중 · ${x.weeksLeft}주 남음` : x.status === 'resting' ? `휴식 중 · ${x.weeksLeft}주 남음` : x.status === 'sales' ? '영업' : lab.has(x.id) ? '전담 연구원' : x.role === 'engineer' ? '쉬는 중 · 연구' : '쉬는 중';
    const abil = (x: Q.StaffRow) => `<span class="abil2" title="능력 ${x.ability} · 잠재력 ${x.potential}"><u style="width:${x.ability}%"></u><em style="left:${x.potential}%"></em></span><b>${x.ability}</b>${x.atPotential ? '<small class="cap">더 못 큼</small>' : ''}`;
    const cond = (c: number) => { const w = condWord(c); return `<span class="cbar c${w === '좋음' ? 0 : w === '보통' ? 1 : 2}"><u style="width:${Math.round(c * 100)}%"></u></span>${w}`; };
    const vis = visibleStaff(), f = staffView.filter, srow = (x: Q.StaffRow) => `<div class="srow-w"><button class="s-pick" data-act="staffPick" data-id="${x.id}" aria-pressed="${staffPick.has(x.id)}" aria-label="${esc(x.name)} 고르기"></button><button class="srow" data-act="staffSel" data-id="${x.id}" aria-pressed="${staffSel === x.id}"><span class="s-name"><b>${esc(x.name)}</b><small>${ROLE_NAME[x.role]}</small></span><span class="s-abil">${abil(x)}</span><span class="s-pay">${money(x.salary)}</span><span class="s-cond">${cond(x.condition)}</span><span class="s-do s-${x.status}">${doing(x)}</span></button></div>`;
    const list = vis.map((x, i) => (staffView.sort === 'role' && x.role !== vis[i - 1]?.role ? `<p class="lbl grp">${ROLE_NAME[x.role]} ${vis.filter((y) => y.role === x.role).length}명</p>` : '') + srow(x)).join(''); // 직무순이면 직무 머리줄
    const ex = Q.execInfo(s).roles.filter((r) => r.holder); // 0.7.0 임원은 직함으로(누르면 임원 화면)
    const execRows = ex.length && (f === '' || f === 'exec') ? `<p class="lbl grp">임원 ${ex.length}명</p>${ex.map((r) => `<div class="srow-w"><span class="s-pick" aria-hidden="true"></span><button class="srow s-exec" data-act="cotab" data-v="exec"><span class="s-name"><b>${esc(r.holder!.name)}</b><small>${esc(r.title)}</small></span><span class="s-abil">임원 능력 <b>${r.holder!.skill}</b></span><span class="s-pay">${money(r.holder!.pay)}</span><span class="s-cond"></span><span class="s-do">${r.holder!.hired ? '외부 임원' : `${ROLE_NAME[r.holder!.staffRole]} 출신`}</span></button></div>`).join('')}` : '';
    const pay = rows.reduce((a, x) => a + x.salary, 0), salesN = rows.filter((x) => x.role === 'sales').length;
    for (const id of staffPick) if (!rows.some((x) => x.id === id)) staffPick.delete(id); // 해고·퇴사한 직원은 뺀다
    const nPick = staffPick.size, bulk = `<div class="row bulk"><button class="btn" data-act="pickVisible" ${vis.length ? '' : 'disabled'}>보이는 ${vis.length}명 모두 고르기</button><button class="btn ink" data-act="trainPicked" ${nPick ? '' : 'disabled'}>고른 ${nPick}명 교육 보내기</button><button class="btn" data-act="restPicked" ${nPick ? '' : 'disabled'}>고른 ${nPick}명 2주 쉬기</button>${nPick ? '<button class="btn" data-act="pickNone">고르기 해제</button>' : ''}</div>`;
    const card1 = `<div class="card staff-list"><h3>직원 ${rows.length}명 <small class="hint">정원 ${h.staffCount}/${h.capacity}명 · 월급 합계 ${money(pay)}/월</small></h3>${Q.presidents(s).length ? `<p class="hint sub-pres-n">자회사 사장 ${Q.presidents(s).length}명은 직원 목록과 정원에서 빠져 있습니다. <button class="btn" data-act="cotab" data-v="sub">자회사 보기</button></p>` : ''}${rows.length ? bulk : ''}
      ${rows.length ? staffFilterChips(rows, ex.length) : ''}<div class="srow-w head"><span class="s-pick"></span><div class="srow head"><span class="sh2">${sortBtn('name', '이름')}${sortBtn('role', '직무')}</span><span class="sh2">${sortBtn('abil', '능력')}${sortBtn('grow', '성장 여지')}</span><span>${sortBtn('pay', '월급')}</span><span>${sortBtn('cond', '컨디션')}</span><span>${sortBtn('do', '하는 일')}</span></div></div>${execRows}${list || `<p class="hint" style="margin:8px 10px">${rows.length ? (f === 'exec' && ex.length ? '' : '조건에 맞는 직원이 없습니다.') : '직원이 없습니다. 채용에서 공고를 내면 후보 3명이 옵니다.'}</p>`}
      <p class="note">${salesN ? SALES_EFFECT : `영업 직원이 없습니다. ${SALES_EFFECT}`} 능력 막대의 점선은 성장 한계입니다. 머리글을 누르면 정렬, 다시 누르면 반대로 정렬합니다. 직원을 누르면 교육·휴식·배치·해고를 할 수 있습니다. 왼쪽 네모를 눌러 여러 명을 고르면 한 번에 교육·휴식을 보낼 수 있습니다.</p></div>`;
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
          : s.hqLevel >= config.research.labHq ? `<button class="btn lab-btn" data-act="assign" data-id="${x.id}" data-v="lab" style="width:100%;margin-top:8px">전담 연구원으로 <small>(연구 점수 1.5배, 개발에는 못 넣음)</small></button>` : `<p class="note">본사 ${config.research.labHq}등급부터 전담 연구원으로 둘 수 있습니다. 엔지니어는 그냥 두어도 연구합니다(개발 중이면 ${Math.round(config.research.projectShare * 100)}% 속도).</p>`}
        ${I.careerBlock(s, x.id)}
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

  // ----- 임원(0.7.0) -----
  const EXEC_DESC: Record<Q.ExecInfo['roles'][number]['role'], string> = {
    hr: '해고·교육·휴식·채용을 권하고, 교체 고용을 제안합니다. 위임하면 휴식·교육·채용·해고를 대신 합니다.', product: '페이스리프트·풀체인지 적기와 단종을 권하고, 위임하면 세대교체를 대신 합니다.',
    finance: '현금 부족을 미리 알리고 대출 상환·가격 조정을 권합니다.', production: '공장 증설·생산 라인·생산 배분을 권합니다.',
    research: '규제 대비 연구와 다음 연구를 권합니다.', market: '무엇을 만들지(차급·고객층·예상 판매)와 광고 수준을 권합니다.',
  };
  const TIER_WORD = ['', '뭉뚱그려 말함', '대상을 짚어 말함', '수치까지 말함'];
  function execTab(): string {
    const s = game!.state, e = Q.execInfo(s);
    const sum = `<div class="card exec-sum"><p class="lbl">임원</p><h2>임원 자리 ${e.used}/${e.seats}석</h2>
      <p class="hint" style="margin-top:6px">임원은 월 결산 때 분야별로 제안을 보고함에 올립니다(임원마다 한 달 최대 ${config.exec.perExec}건). 화면에 튀어나오지 않으니 상단의 할 일 버튼에서 보고를 확인하세요. 임원은 직원 정원 밖이라, 직원을 임원으로 임명하면 그 자리에 한 명을 더 뽑을 수 있습니다.${e.used >= e.seats && e.nextSeatHq ? ` 본사 ${e.nextSeatHq}등급이 되면 자리가 늘어납니다.` : ''}</p>
      <p class="note">임원 능력${ib('term:임원 능력')}이 높을수록 제안이 구체적입니다${ib('term:제안의 구체성')}. 능력 ${e.delegateSkill} 이상이면 일부 일을 위임할 수 있습니다(위임한 일도 보고함에 기록됩니다). 가격은 차마다 자동 가격 정책으로 정하고, 해고·출시는 따로 켠 경우에만 임원이 합니다.</p></div>`;
    // 1.3.0 기획 임원 카드의 세대교체 위임: 차종별 켜기/끄기, 출시까지 자동, 전체 켜기/끄기, 다음 예정·기다림
    const GA = gaInfo(), gaSec = GA.cars.length || GA.whyNot ? `<div class="ga-sec"><p class="lbl" style="margin-top:12px">세대교체 위임${ib('term:세대교체 위임')}</p>${GA.whyNot ? `<p class="note why ga-why">${esc(GA.whyNot)}</p>` : ''}
      ${GA.cars.length ? `<div class="row ga-all"><button class="btn" data-act="genAutoAll" data-v="1" ${GA.available && GA.cars.some((c) => !c.on) ? '' : 'disabled'}>모두 켜기</button><button class="btn" data-act="genAutoAll" data-v="0" ${GA.cars.some((c) => c.on) ? '' : 'disabled'}>모두 끄기</button></div>
      ${GA.cars.map((c) => `<div class="toggle ga-row${c.derivative ? ' deriv' : ''}" data-np="${c.nameplateId}"><span>${c.derivative ? '↳ ' : ''}${esc(c.name)}<small>${esc(gaLine(c))}</small></span><span class="ga-btns">${gaLaunchBtn(c.nameplateId)}${gaBtn(c.nameplateId)}</span></div>`).join('')}
      <p class="note">켜 둔 차종은 때가 되면 기획 임원이 전작 그대로의 기획으로 페이스리프트·풀체인지(파생 차종은 바탕 차의 새 세대로 다음 세대)를 시작하고 보고합니다. '출시까지 위임'이면 개발이 끝난 뒤 출시도 하며, 출시 장면 없이 알림으로만 알립니다.</p>` : '<p class="hint">아직 낸 차종이 없습니다.</p>'}</div>` : '';
    const card = (r: Q.ExecInfo['roles'][number]) => {
      const h = r.holder, head = `<p class="lbl">${esc(r.title)}</p>`, desc = `<p class="hint">${esc(EXEC_DESC[r.role])}</p>`, ga = r.role === 'product' ? gaSec : '';
      if (h) {
        const del = r.delegations.length ? `<p class="lbl" style="margin-top:12px">위임</p>${r.delegations.map((d) => `<div class="toggle deleg" data-k="${d.key}" style="margin-top:6px"><span>${esc(d.label)}${d.note ? `<small>${esc(d.note)}</small>` : ''}${d.warn ? `<small class="deleg-warn">${esc(d.warn)}</small>` : ''}</span><button class="btn" data-act="execDeleg" data-role="${r.role}" data-k="${d.key}" data-v="${d.on ? '0' : '1'}" aria-pressed="${d.on}" aria-label="${esc(d.label)} ${d.on ? '끄기' : '켜기'}" ${d.available ? '' : 'disabled'}>${d.on ? '켜짐' : '꺼짐'}</button></div>${d.whyNot ? `<p class="note why">${esc(d.whyNot)}</p>` : ''}`).join('')}` : r.role === 'product' ? '' : '<p class="note">이 자리는 제안만 합니다(위임할 일이 없습니다).</p>';
        return `<div class="card exec-card filled" data-role="${r.role}">${head}<h2>${esc(h.name)}<small>${h.hired ? '외부 임원' : `${ROLE_NAME[h.staffRole]} 출신`}</small></h2>${desc}
          <div class="kpis" style="margin-top:8px">${kpi(`임원 능력${ib('term:임원 능력')}`, String(h.skill))}${kpi(`제안${ib('term:제안의 구체성')}`, TIER_WORD[h.tier], '', 'kpi-word')}${kpi('월급', money(h.pay))}</div>${del}${ga}
          <button class="btn danger" data-act="execDismiss" data-role="${r.role}" style="width:100%;margin-top:12px">해임${h.hired ? ` · 퇴직금 ${money(h.pay * config.staff.severanceMonths)}` : ' · 원래 직무로 복귀'}</button></div>`;
      }
      if (!r.canFill) return `<div class="card exec-card locked" data-role="${r.role}">${head}<h2>잠긴 자리</h2>${desc}<p class="note">임원 자리 ${e.seats}석이 모두 찼습니다.${e.nextSeatHq ? ` 본사 ${e.nextSeatHq}등급(${esc(config.hq.levels[e.nextSeatHq - 1].name)})부터 자리가 늘어납니다.` : ' 다른 임원을 해임하면 이 자리를 채울 수 있습니다.'}</p></div>`;
      const pick = execPick === r.role ? `<div class="exec-pick">${r.internal.slice(0, 8).map((x) => `<button class="opt" data-act="execAppoint" data-role="${r.role}" data-id="${x.staffId}"><b>${esc(x.name)}</b><small>${ROLE_NAME[x.role]} · 임원 능력 ${x.skill} · ${TIER_WORD[Q.execTier(x.skill)]}</small>${x.busyWith ? `<small class="neg">${esc(x.busyWith)} · 임명하면 빠집니다</small>` : ''}</button>`).join('') || '<p class="hint">임명할 직원이 없습니다.</p>'}</div>` : '';
      const cands = r.candidates.length ? `<div class="cands">${r.candidates.map((c) => `<div class="cand"><b>${esc(c.name)}</b><small>임원 능력 <b>${c.skill}</b> · ${TIER_WORD[c.tier]}</small><small>월급 ${money(c.pay)} · ${c.weeksLeft}주 남음</small><button class="btn ink" data-act="execHire" data-role="${r.role}" data-id="${c.id}">채용</button></div>`).join('')}</div>` : '';
      return `<div class="card exec-card empty" data-role="${r.role}">${head}<h2>빈 자리</h2>${desc}
        <div class="row" style="margin-top:8px"><button class="btn ink" data-act="execPick" data-v="${r.role}" aria-pressed="${execPick === r.role}">직원 임명</button>${r.candidates.length ? '' : `<button class="btn" data-act="execPost" data-role="${r.role}">공고 내기 · ${money(e.postCost)}</button>`}</div>
        ${pick}${cands}${ga}<p class="note">임명한 직원은 개발·연구에서 빠지고 월 수당 ${money(config.exec.allowance)}이 붙습니다. 외부 임원은 바로 쓸 수 있지만 월급이 ${config.exec.hiredPayMult}배입니다. 임원이 ${config.exec.seatAllowance.findIndex((x) => x > 0) + 1}명 이상이면 임원마다 수당이 더 붙습니다(${config.exec.seatAllowance.map((x, i) => x > 0 ? `${i + 1}명 ${money(x)}` : '').filter(Boolean).join(', ')}).</p></div>`;
    };
    return `<div class="exec">${sum}<div class="exec-grid">${e.roles.map(card).join('')}</div></div>`;
  }

  // ----- 3.0.0 자회사 -----
  let subSel: number | null = null, subPick: '' | 'pres' | 'add' = '', foundKind: SubKind = 'premium', foundColor = '';
  let subView: number | null = null, subCar = '', garageSub: { id: number; body: string } | null = null, ordSet: { id: number; body: string; character: SubCharacter; band: PriceBand } | null = null, tgtKind: 'sold' | 'profit' = 'sold'; // 3.1.0 운영 전환(UI 상태, 저장하지 않음)
  const SUBS = config.subs;
  const subMark = (name: string, color: string, z = 40) => `<span class="sub-mark" style="--c:${color};width:${z}px;height:${z}px${/^#[0-9a-f]{6}$/i.test(color) && 1.05 / (lumOf(hexRgb(color)) + 0.05) < 4.5 ? ';color:#14171c' : ''}" aria-hidden="true">${esc([...name][0] ?? '')}</span>`; // 3.1.1 밝은 로고 색(보급형 기본 주황 등)은 흰 글자 대비가 모자라 어두운 글자로
  /** 자회사 모델 썸네일: 경쟁 모델과 같은 방식, 색은 자회사 로고 색 */
  const subLook = (v: Q.SubModelView): CarLook => lookOf({ body: v.body, powertrain: v.powertrain, tier: v.tier, color: v.color, wheels: 1, year: v.year, chassisSeed: v.chassisSeed, faceSeed: v.faceSeed }); // 3.1.0 실제 사양이 있으면 그 동력·등급·모양
  function subTab(): string {
    const s = game!.state, info = Q.subsInfo(s);
    if (subSel !== null && !s.subs?.some((x) => x.id === subSel)) subSel = null;
    if (subSel !== null) return subDetailView(subSel);
    const rows = info.list.map((x) => `<button class="gsr sub-row" data-act="subSel" data-id="${x.id}">${subMark(x.name, x.color)}<span class="g-name"><b>${esc(x.name)}</b><small>${esc(x.kindName)} · ${esc(x.strategyName)}${x.switching ? ' <i class="sub-sw">전환 중</i>' : ''}</small></span><span>${isBrandK(x.kind) ? `모델 ${x.models}개` : '사업 자회사'}<br><small>사장 ${x.president ? esc(x.president) : '없음'}</small></span><span>최근 12개월 이익 <b class="${x.profit12 >= 0 ? 'pos' : 'neg'}">${money(x.profit12, true)}</b><br><small>배당 ${money(x.dividend12)}</small></span><span aria-hidden="true">→</span></button><button class="btn sub-go" data-act="subOpen" data-id="${x.id}">운영 전환</button>`).join('');
    const canFound = info.found.some((f) => f.ok);
    const why = canFound ? '' : `<ul class="sub-why">${info.found.map((f) => `<li><b>${esc(f.name)}</b> ${esc(f.reason ?? '')}</li>`).join('')}</ul>`;
    const pres = Q.presidents(s).length;
    return `<div class="cols co-sub"><div class="card sub-list"><h3>자회사${ib('term:자회사')} <small class="hint">${info.used}/${info.max}곳</small></h3>
      ${rows ? `<div class="sub-rows">${rows}</div>` : `<p class="hint" style="margin:8px 0">아직 자회사가 없습니다. 자회사는 본사 ${SUBS.hqMin}등급부터 세울 수 있고, 본사 등급마다 둘 수 있는 수가 정해져 있습니다(${SUBS.maxByHq.map((n, i) => (n ? `${i + 1}등급 ${n}곳` : '')).filter(Boolean).join(' · ')}).</p>`}
      <button class="go" data-act="subFoundOpen" ${canFound ? '' : 'disabled'}>자회사 설립</button>${why}
      <p class="note">자회사는 본사가 전략과 큰 방향만 지시하고 운영은 위임합니다(전반 위임${ib('term:전반 위임')}). 고급·보급형 브랜드는 직접 운영${ib('term:직접 운영')}으로 바꿔 신차를 직접 기획할 수 있고, [운영 전환]을 누르면 화면이 그 자회사 것으로 바뀝니다. 이익의 일부는 배당으로 본사에 들어오고(장부의 '자회사 배당'), 설립비·추가 투자는 '자회사 투자'로 적습니다.${pres ? ` 자회사 사장 ${pres}명은 본사 직원 목록에 없습니다.` : ''}</p></div>
      ${info.list.length ? subHqCard() : ''}</div>`;
  }
  /** 본사가 자회사에서 받은 효과(자회사 목록·재무 화면) */
  function subHqCard(link = false): string {
    const s = game!.state, e = Q.subHqEffects(s), info = Q.subsInfo(s);
    return `<div class="card sub-hq"><h3>자회사가 본사에 준 것</h3><div class="kpis">${kpi('최근 12개월 배당', money(e.dividend12), 'pos')}${kpi('최근 12개월 투자', money(e.invest12))}${e.costCut ? kpi('본사 차 대당 원가', `−${(e.costCut * 100).toFixed(1)}<span>%</span>`, 'pos') : ''}${e.salesBoost ? kpi('본사 판매(할부)', `+${(e.salesBoost * 100).toFixed(1)}<span>%</span>`, 'pos') : ''}</div>
      <table class="tbl" style="margin-top:8px"><tr><th>자회사</th><th class="r">최근 12개월 이익</th><th class="r">배당</th></tr>${info.list.map((x) => `<tr><td>${esc(x.name)} <small class="hint">${esc(x.kindName)}</small></td><td class="r ${x.profit12 >= 0 ? 'pos' : 'neg'}">${money(x.profit12, true)}</td><td class="r">${money(x.dividend12)}</td></tr>`).join('')}</table>${link ? '<button class="btn" data-act="goCo" data-v="sub" style="width:100%;margin-top:8px">자회사 화면</button>' : ''}</div>`;
  }
  /** 3.5.0 상장: 판 지분, 평가액, 다음 단계 단추(못 하면 이유) */
  function subListCard(d: Q.SubDetail): string {
    const s = game!.state, sub = s.subs!.find((x) => x.id === d.id)!, v = Q.subValue(sub), cur = Math.round(d.listed * 100);
    const steps = config.rivalry.ipo.steps.filter((p) => p > cur).map((p) => { const why = Q.listError(s, sub, p); return `<button class="btn${why ? '' : ' ink'}" data-act="listSub" data-id="${d.id}" data-v="${p}" ${why ? 'disabled' : ''}>${p}%까지 · 약 ${money(Math.round(v * (p / 100 - d.listed)))}</button>`; }).join('');
    const why = config.rivalry.ipo.steps.filter((p) => p > cur).map((p) => Q.listError(s, sub, p)).find(Boolean);
    return `<div class="card sub-ipo"><h3>상장${ib('term:상장')}</h3><div class="kpis">${kpi('판 지분', `${cur}<span>%</span>`)}${kpi('본사 지분', `${100 - cur}<span>%</span>`)}${kpi('평가액', money(v))}</div>
      ${steps ? `<div class="row sub-ipo-b" style="margin-top:8px">${steps}</div>` : `<p class="hint">팔 수 있는 지분(${config.rivalry.ipo.steps.at(-1)}%)을 모두 팔았습니다.</p>`}${why ? `<p class="hint">${esc(why)}</p>` : ''}
      <p class="note">평가액 = 자본 + 지난 12개월 이익 × ${config.rivalry.ipo.per}. 상장한 지분만큼 앞으로 배당과 매각 대금이 줄어듭니다. 판 지분은 되사지 않습니다.</p></div>`;
  }
  function subDetailView(id: number): string {
    const s = game!.state, d = Q.subDetail(s, id)!, B = d.brand;
    const head = `<div class="card sub-head">${subView === id ? '' : `<div class="row sub-top"><button class="btn" data-act="subBack">← 자회사 목록</button><button class="btn ink" data-act="subOpen" data-id="${id}">운영 전환</button></div>`}<div class="rv-head">${subMark(d.name, d.color, 48)}<div><h2>${esc(d.name)} <small class="hint">${esc(d.kindName)} · ${d.foundedYear}년 설립</small></h2><p class="hint">${esc(d.kindDesc)}</p></div></div>
      <div class="kpis">${kpi('자본', money(d.capital))}${B ? kpi('월 생산 한도', `${num(d.capacity)}<span>대</span>`) + kpi('모델', `${d.models.length}/${d.modelCap}<span>개</span>`) + kpi('브랜드 평판', String(Math.round(d.rep))) : ''}${d.hqEffect ? kpi('본사에 주는 효과', esc(d.hqEffect.text), 'pos', 'kpi-word') : ''}</div></div>`;
    return `<div class="sub-detail">${head}<div class="cols">${subModeCard(d)}${subTargetCard(d)}</div>${subView === id ? '' : subWorkCard(d)}${subStrategyCard(d)}<div class="cols">${subSettingsCard(d)}${subPresidentCard(d)}</div>${B ? subLineupCard(d) : ''}${subResultCard(d)}
      ${B ? subListCard(d) : ''}
      <div class="card sub-sell"><h3>매각</h3><p class="hint">지금 매각하면 자본의 ${Math.round(SUBS.sellShare * 100)}%${d.listed ? `에서 상장한 지분(${Math.round(d.listed * 100)}%)을 뺀` : ''} <b>${money(d.sellPrice)}</b>을 받습니다. 매각은 같은 주 안의 되돌리기 말고는 되돌릴 수 없고, 모델과 실적 기록이 사라집니다. 사장은 본사 직원으로 돌아옵니다.${d.from ? ' 인수한 회사는 다시 독립 경쟁사가 됩니다.' : ''}</p><button class="btn danger" data-act="subSell" data-id="${d.id}" style="width:100%;margin-top:8px">「${esc(d.name)}」 매각 · ${money(d.sellPrice)}</button></div></div>`;
  }
  function subStrategyCard(d: Q.SubDetail): string {
    const s = game!.state, list = d.brand ? d.strategies : d.strategies.filter((x) => (SUBS.business as readonly string[]).includes(x.id));
    const txt = (k: SubStrategy) => d.brand ? { desc: SUB_DATA.strategies[k], gain: SUB_DATA.gain[k], cost: SUB_DATA.cost[k] } : SUB_DATA.biz[k];
    const card = (x: Q.SubStrategyChoice) => { const t = txt(x.id); return `<button class="opt sub-st${x.ok ? '' : ' locked'}" data-act="subStrat" data-id="${d.id}" data-v="${x.id}" aria-pressed="${x.current}" ${x.ok && !x.current ? '' : x.current ? '' : 'disabled'}><b>${esc(x.name)}${x.current ? ' <i class="sub-now">지금</i>' : ''}</b><small>${esc(t.desc)}</small>${x.ok ? `<small class="pos">얻는 것: ${esc(t.gain)}</small><small class="neg">치르는 것: ${esc(t.cost)}</small>` : `<small class="need">${esc(x.reason ?? '')}</small>`}</button>`; };
    const tr = d.transition ? `<div class="build sub-tr"><p class="lbl">전환 중${ib('term:전환 기간')} · ${esc(d.transition.from.map((f) => f.name).join('·'))} → ${esc(d.strategyName)}</p><div class="prog"><u style="width:${(d.transition.progress * 100).toFixed(1)}%"></u></div><p class="hint">${d.transition.monthsLeft}개월 남았습니다. 전환 기간 동안 효과가 서서히 바뀝니다.</p></div>` : '';
    const rv = d.rival ? `<p class="lbl" style="margin-top:12px">상대 경쟁사</p><div class="row sub-rv"><button class="btn" data-act="subRival" data-id="${d.id}" data-v="" aria-pressed="${!d.rival.chosen}">자동(가장 큰 경쟁사)</button>${s.rivals.map((r) => `<button class="btn" data-act="subRival" data-id="${d.id}" data-v="${r.id}" aria-pressed="${d.rival!.chosen && d.rival!.id === r.id}">${esc(r.name)}</button>`).join('')}</div>
      <p class="hint" style="margin-top:6px">지금 상대: <b>${esc(d.rival.name)}</b> · 그 회사의 주력 차급(맡은 영역 안): <b>${d.rival.bodies.map((b) => bodyById(b).name).join('·') || '없음'}</b></p>` : '';
    return `<div class="card sub-strat"><p class="lbl">전략 지시</p><h2>지금 전략: ${esc(d.strategyName)}</h2>${tr}<div class="opts sub-opts">${list.map(card).join('')}</div>${rv}
      <p class="note">전략을 바꾸면 ${SUBS.switchMonths}개월에 걸쳐 효과가 새 전략으로 옮겨 갑니다. 모델 수·세대교체 같은 행동은 바로 새 전략을 따릅니다. 경쟁사 대응의 상대만 바꾸면 전환 기간이 없습니다.</p></div>`;
  }
  function subSettingsCard(d: Q.SubDetail): string {
    const s = game!.state, area = d.brand ? `<p class="lbl">맡을 영역 · 차급</p><div class="row sub-bodies">${d.bodyChoices.map((b) => { const on = d.bodies.includes(b), ready = d.areaReady.includes(b); return `<button class="btn" data-act="subBody" data-id="${d.id}" data-v="${b}" aria-pressed="${on}">${bodyById(b).name}${ready ? '' : ' <small>연구 전</small>'}</button>`; }).join('')}</div>
      <p class="lbl" style="margin-top:10px">고객층</p><div class="seg sub-segs">${d.segmentChoices.map((g) => `<button data-act="subSeg" data-id="${d.id}" data-v="${g}" aria-pressed="${d.segment === g}">${esc(segmentById(g).name)}</button>`).join('')}</div>
      <p class="note">영역에서 뺀 차급의 모델은 이번 달 말에 단종합니다. 본사가 연구하지 않은 차급은 영역에 넣어도 모델을 내지 않습니다.</p><hr>` : '';
    const capAfter = (a: number) => d.brand ? ` <small>생산 한도 ${num(Math.floor((d.capital + a) / SUBS.capPerCar))}대 · 모델 상한 ${Math.max(1, Math.min(d.areaReady.length, Math.floor((d.capital + a) / SUBS.capitalPerModel)))}개</small>` : '';
    const inv = [5000000, 10000000, 30000000].map((a) => `<button class="btn sub-inv" data-act="subInvest" data-id="${d.id}" data-v="${a}" ${s.cash >= a ? '' : 'disabled'}>${money(a)} 투자${capAfter(a)}</button>`).join('');
    const share = d.brand ? `<hr><p class="lbl">공유 범위${ib('term:공유 범위')}</p><div class="seg sub-share">${Q.SHARE_NAMES.map((n, i) => { const f = SUBS.shareFx[i]; return `<button data-act="subShare" data-id="${d.id}" data-v="${i}" aria-pressed="${d.share === i}">${n}<small>평론 ${f.a > 0 ? '+' : f.a < 0 ? '−' : '±'}${Math.abs(f.a * 10).toFixed(1)}</small><small>개발비 ×${f.dev} · 원가 ×${f.cost}</small></button>`; }).join('')}</div><p class="note">원가·개발비는 바로 바뀌고, 모델 세기(평론)는 다음 세대부터 바뀝니다.</p>` : '';
    return `<div class="card sub-set">${area}<p class="lbl">배당 비율${ib('term:배당')}</p><div class="row sub-div"><button class="btn" data-act="subDivi" data-id="${d.id}" data-v="${Math.max(0, d.dividend - 10)}" ${d.dividend > 0 ? '' : 'disabled'} aria-label="배당 비율 10%p 내리기">−10</button><b class="sub-divv">${d.dividend}%</b><button class="btn" data-act="subDivi" data-id="${d.id}" data-v="${Math.min(100, d.dividend + 10)}" ${d.dividend < 100 ? '' : 'disabled'} aria-label="배당 비율 10%p 올리기">+10</button></div>
      <p class="hint" style="margin-top:6px">실제 배당률 <b>${Math.round(d.payout * 100)}%</b>(전략의 배당 배수를 곱한 값). 나머지 이익은 자회사 자본으로 남아 생산 한도와 모델 수를 늘립니다.</p><hr>
      <p class="lbl">추가 투자</p><div class="sub-invs">${inv}</div><p class="note">투자한 돈은 자회사 자본이 되어 본사 현금으로 돌아오지 않습니다(매각하면 자본의 ${Math.round(SUBS.sellShare * 100)}%). ${d.brand ? '본사가 넣은 돈이 설립비의 두 배가 될 때마다 새 모델이 조금 더 셉니다.' : '자본이 클수록 본사에 주는 효과와 이익이 커집니다(설립비의 9배에서 최대).'}</p>${share}</div>`;
  }
  function subPresidentCard(d: Q.SubDetail): string {
    const s = game!.state, p = d.president;
    const pick = subPick === 'pres' ? `<div class="exec-pick">${[...s.staff].sort((a, b) => b.ability - a.ability || a.id - b.id).slice(0, 8).map((x) => `<button class="opt" data-act="subPresSet" data-id="${d.id}" data-v="${x.id}"><b>${esc(x.name)}</b><small>${ROLE_NAME[x.role]} · 능력 ${x.ability}</small>${x.projectId !== null ? `<small class="neg">「${esc(s.projects.find((q) => q.id === x.projectId)?.name ?? '')}」 개발 중 · 임명하면 빠집니다</small>` : ''}</button>`).join('') || '<p class="hint">임명할 직원이 없습니다.</p>'}</div>` : '';
    return `<div class="card sub-pres"><p class="lbl">사장</p>${p ? `<h2>${esc(p.name)}<small>${ROLE_NAME[p.role]} 출신 · 능력 ${p.ability}</small></h2>` : '<h2>사장 없음</h2><p class="hint">사장이 없어도 운영되지만 새 모델이 약하고 원가가 높습니다(능력 25인 사장과 같습니다).</p>'}
      <div class="row" style="margin-top:8px"><button class="btn ink" data-act="subPresPick" aria-pressed="${subPick === 'pres'}">${p ? '다른 직원으로 바꾸기' : '직원 임명'}</button>${p ? `<button class="btn danger" data-act="subPresSet" data-id="${d.id}" data-v="">해임 · 원래 직무로 복귀</button>` : ''}</div>${pick}
      <p class="note">사장이 된 직원은 본사 직원 목록(정원)에서 빠지고 개발·연구를 하지 않습니다. 월급에 수당 ${money(SUBS.presAllowance)}을 더해 자회사가 냅니다. 능력이 높을수록 새 모델이 세고 원가가 낮습니다${d.brand ? '' : '(사업 자회사는 규모가 커집니다)'}.</p></div>`;
  }
  function subLineupCard(d: Q.SubDetail): string {
    const free = d.areaReady.filter((b) => !d.models.some((m) => m.body === b));
    const row = (v: Q.SubModelView) => `<details class="rv-model"><summary><span class="g-th">${thumb(subLook(v), -0.65, 160, 100)}</span><span class="rv-n"><b>${esc(v.name)}</b><small>${v.bodyName} · ${v.number}세대 · ${v.year}년 출시${v.ev ? ' · 전기차' : ''}${v.keep ? ' · 본사 지시' : ''}</small></span><span class="rv-c">추정 평론 <b>${score(v.critic)}</b>${v.awards.length ? ' <small class="aw-s">수상</small>' : ''}<br>${num(v.price)}만원 · 점유 약 ${Math.round(v.share * 100)}% · 지난달 ${num(v.sold)}대</span></summary>
      <div class="row sub-mact"><button class="btn" data-act="subRenameOpen" data-id="${d.id}" data-k="${v.body}">이름 변경</button><button class="btn danger" data-act="subDrop" data-id="${d.id}" data-k="${v.body}">단종</button></div></details>`;
    const add = subPick === 'add' ? `<div class="row sub-add">${free.map((b) => `<button class="btn" data-act="subAdd" data-id="${d.id}" data-v="${b}">${bodyById(b).name}</button>`).join('') || '<p class="hint">새 모델을 낼 수 있는 차급이 없습니다. 맡을 영역에 차급을 넣거나 본사가 차급을 연구해야 합니다.</p>'}</div>` : '';
    return `<div class="card sub-lineup"><h3>라인업 <small class="hint">모델 ${d.models.length}/${d.modelCap}개</small></h3>${d.models.length ? `<div class="rv-list">${d.models.map(row).join('')}</div>` : '<p class="hint">아직 모델이 없습니다. 첫 모델은 설립한 달 말에 나옵니다.</p>'}
      <div class="row" style="margin-top:10px"><button class="btn ink" data-act="subAddPick" aria-pressed="${subPick === 'add'}" ${d.models.length < d.modelCap ? '' : 'disabled'}>모델 추가</button></div>${d.models.length >= d.modelCap ? `<p class="note why">자본이 모자라 모델을 더 둘 수 없습니다. 모델 하나에 자본 ${money(SUBS.capitalPerModel)}이 필요하고, 추가 투자로 늘어납니다.</p>` : ''}${add}
      <p class="note">모델을 누르면 이름 변경·단종을 할 수 있습니다. 추가를 지시한 모델은 전략이 줄이지 않고, 단종을 지시한 차급에는 전략이 다시 내지 않습니다(추가 지시로 풀립니다). 추정 평론${ib('term:추정 평론')}은 경쟁 모델과 같은 방식으로 어림한 값입니다.</p></div>`;
  }
  function subResultCard(d: Q.SubDetail): string {
    const s = game!.state, L = d.lastMonth, Y = d.last12, T = d.total;
    const can = d.cannibal.length ? `<table class="tbl" style="margin-top:6px"><tr><th>본사 차</th><th class="r">줄어든 한 달 수요</th><th class="r">비율</th></tr>${d.cannibal.map((c) => { const g = Q.generationById(s, c.generationId); return `<tr><td>${g ? esc(nameOf(g)) : '—'} <small class="hint">${bodyById(c.body).name}</small></td><td class="r">${c.lost < 1 ? '1대 미만' : `약 ${c.lost >= 10 ? num(Math.round(c.lost)) : c.lost.toFixed(1)}대`}</td><td class="r">${(c.share * 100).toFixed(1)}%</td></tr>`; }).join('')}</table>` : '<p class="hint">같은 차급에서 겹치는 본사 차가 없습니다.</p>';
    return `<div class="cols"><div class="card sub-res"><h3>실적</h3>
      ${L ? `<p class="lbl">지난달</p><div class="kpis">${d.brand ? kpi('판매', `${num(L.sold)}<span>대</span>`) : ''}${kpi('매출', money(L.revenue))}${kpi('이익', money(L.profit, true), L.profit >= 0 ? 'pos' : 'neg')}${kpi('배당', money(L.dividend))}</div>` : '<p class="hint">아직 결산한 달이 없습니다.</p>'}
      <p class="lbl" style="margin-top:10px">최근 ${Y.months}개월</p><div class="kpis">${d.brand ? kpi('판매', `${num(Y.sold)}<span>대</span>`) : ''}${kpi('매출', money(Y.revenue))}${kpi('이익', money(Y.profit, true), Y.profit >= 0 ? 'pos' : 'neg')}${kpi('배당', money(Y.dividend))}</div>
      <p class="lbl" style="margin-top:10px">설립 뒤 누적</p><div class="kpis">${kpi('본사 투자', money(T.invested))}${kpi('이익', money(T.profit, true), T.profit >= 0 ? 'pos' : 'neg')}${kpi('배당', money(T.dividend))}${T.hqRep ? kpi('본사 평판', `+${T.hqRep.toFixed(1)}`, 'pos') : ''}</div>
      ${d.brand ? `<p class="lbl" style="margin-top:12px">자기 잠식${ib('term:자기 잠식')}</p>${can}` : ''}</div>
      <div class="card sub-rep"><h3>분기 보고 <small class="hint">최근 ${d.reports.length}건</small></h3>${d.reports.length ? `<ul class="sub-reports">${d.reports.map((r) => `<li><small>${yearOf(r.week)}년 ${(monthOf(r.week) % config.time.monthsPerYear) + 1}월</small>${esc(r.text)}</li>`).join('')}</ul>` : '<p class="hint">아직 보고가 없습니다. 분기마다 전략에 따른 행동과 실적을 보고합니다.</p>'}</div></div>`;
  }
  function showSubFound(): void {
    const s = game!.state, info = Q.subsInfo(s), f = info.found.find((x) => x.kind === foundKind) ?? info.found[0], brand = f.kind === 'premium' || f.kind === 'value';
    const prevName = ($<HTMLInputElement>('#sub-name')?.dataset.kind === f.kind ? $<HTMLInputElement>('#sub-name')?.value : null) ?? f.defaultName;
    if (!foundColor) foundColor = f.color;
    const kinds = info.found.map((x) => `<button class="opt" data-act="subFoundKind" data-v="${x.kind}" aria-pressed="${x.kind === f.kind}"><b>${esc(x.name)}</b><small>${esc(x.desc)}</small><small>평판 ${x.rep} 이상 · 본사 ${SUBS.hqMin}등급부터</small>${x.ok ? '' : `<small class="need">${esc(x.reason ?? '')}</small>`}<span class="cost">설립비 ${money(x.cost)}</span></button>`).join('');
    const colors = [...new Set([f.color, ...LOGO_BG.filter((c) => !['#ffffff', '#efeae0'].includes(c))])].map((c) => `<button class="lg-c" data-act="subColor" data-v="${c}" aria-pressed="${foundColor === c}" aria-label="${c}"><i style="background:${c}"></i></button>`).join('');
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="sub-found"><div class="eyebrow"><i></i>회사 · 자회사 설립</div><h2>자회사 설립 <small class="hint">${info.used}/${info.max}곳</small></h2>
      <div class="opts sub-kinds">${kinds}</div>
      <label class="lbl" for="sub-name" style="margin-top:12px">이름</label><input class="namein" id="sub-name" data-kind="${f.kind}" type="text" maxlength="${config.nameMax}" value="${esc(prevName)}" autocomplete="off">
      ${brand ? `<p class="lbl" style="margin-top:12px">로고 색</p><div class="lg-sw">${colors}</div>` : ''}
      ${f.ok ? '' : `<div class="badbox" style="margin-top:10px">${esc(f.reason ?? '')}</div>`}
      <div class="row" style="margin-top:12px"><button class="btn ink" data-act="subFoundDo" ${f.ok ? '' : 'disabled'}>${esc(f.name)} 설립 · ${money(f.cost)}</button><button class="btn" data-act="closeSheet">닫기</button></div>
      <p class="note">설립비는 현금에서 바로 나가고 장부에 '자회사 투자'로 적습니다. 처음 전략은 ${brand ? '성장 중심' : '안정 유지'}, 배당 비율 ${SUBS.defaultSub.dividend}%이며 설립 뒤 바꿀 수 있습니다.</p></div>`;
    sheet.hidden = false; renderTop();
  }
  function showSubRename(id: number, body: string): void {
    const d = Q.subDetail(game!.state, id), m = d?.models.find((x) => x.body === body); if (!d || !m) return;
    sheetBody.innerHTML = `<div class="rename-sheet"><div class="eyebrow"><i></i>${esc(d.name)} · 이름 변경</div><h2>「${esc(m.name)}」 이름 바꾸기</h2><p class="hint">${m.bodyName} · ${m.number}세대. 지난 뉴스와 보고의 문장은 바뀌지 않습니다.</p>
      <label class="lbl" for="sub-rn">새 이름</label><input class="namein" id="sub-rn" type="text" maxlength="${config.nameMax}" value="${esc(m.name)}" autocomplete="off">
      <div class="row" style="margin-top:12px"><button class="btn ink" data-act="subRenameDo" data-id="${id}" data-k="${body}">이름 바꾸기</button><button class="btn" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
    const inp = $<HTMLInputElement>('#sub-rn'); inp?.focus(); inp?.select();
  }

  // ---------- 3.1.0 자회사 직접 운영·운영 전환 ----------
  const HOW_NAME: Record<string, string> = { plan: '직접 기획', order: '제작 지시', badge: '본사 차 배지' };
  const CHARS: [SubCharacter, string, string][] = [['luxury', '고급', '디자인·품질 중심'], ['sport', '스포츠', '성능·디자인 중심'], ['value', '실속', '연비·실용 중심']];
  const BANDS: [PriceBand, string, string][] = [['low', '낮게', '동력 1등급·낮은 예산·가격 ×0.9'], ['mid', '보통', '동력 2등급·보통 예산'], ['high', '높게', '동력 3등급·높은 예산·가격 ×1.1']];
  /** 지금 운영 전환 중인 자회사(없어졌으면 본사로) */
  const curSub = (): Subsidiary | null => { if (subView === null || !game) return null; const x = game.state.subs?.find((y) => y.id === subView); if (!x) subView = null; return x ?? null; };
  const isBrandK = (k: SubKind) => k === 'premium' || k === 'value' || k === 'acquired';
  /** 운영 전환: 화면이 그 자회사 것으로 바뀐다(UI 상태일 뿐, 저장하지 않는다) */
  function openSub(id: number, sc: Screen = 'company'): void {
    const x = game?.state.subs?.find((y) => y.id === id); if (!x) return;
    subView = id; subCar = ''; garageSub = null; subPick = ''; go(isBrandK(x.kind) ? sc : sc === 'records' ? 'records' : 'company');
  }
  function closeSub(): void { const id = subView; subView = null; subCar = ''; subSel = id; coTab = 'sub'; go('company'); }
  /** 자회사 화면 위 띠: 다른 자회사로 바로 전환 */
  function subBar(x: Subsidiary): string {
    const others = (game!.state.subs ?? []).filter((y) => y.id !== x.id);
    return `<div class="sub-bar"><span class="sub-bar-t">${subMark(x.name, x.color, 22)}<b>${esc(x.name)}</b><small>${esc(SUBS.kinds[x.kind].name)} · ${isBrandK(x.kind) ? (Q.isDirect(x) ? '직접 운영' : '전반 위임') : '전반 위임'}</small></span>${others.length ? `<span class="sub-bar-o"><small>다른 자회사</small>${others.map((y) => `<button class="btn" data-act="subOpen" data-id="${y.id}">${subMark(y.name, y.color, 18)}${esc(y.name)}</button>`).join('')}</span>` : ''}</div>`;
  }
  /** 자회사 차고(운영 전환 화면, 본사 차고에서 자회사 차 보기): 모델 목록·고른 모델의 3D·능력치·평론·가격 */
  function subGarageView(id: number, fromHq = false): View {
    const s = game!.state, x = s.subs!.find((y) => y.id === id)!, d = Q.subDetail(s, id)!, direct = d.mode === 'direct';
    const back = fromHq ? '<div class="row"><button class="btn" data-act="gsubBack">← 본사 차고</button></div>' : '';
    if (!d.models.length) return { ov: `<div class="ov empty"><div><h3>${esc(d.name)} 차고가 비어 있습니다</h3><p>${d.orders.length ? `개발 중인 차가 ${d.orders.length}대 있습니다.` : direct ? '개발 탭에서 신차를 기획하거나 제작을 지시하세요.' : '전략에 따라 이번 달 말에 첫 모델이 나옵니다.'}</p></div></div>`, panel: (fromHq ? back : subBar(x)) + `<div class="card"><p class="hint">아직 판매 중인 모델이 없습니다.</p></div>`, look: null };
    const v = d.models.find((m) => m.body === (fromHq ? garageSub?.body : subCar)) ?? d.models[0];
    if (fromHq) garageSub = { id, body: v.body }; else subCar = v.body;
    const list = d.models.map((m) => `<button class="gsr sub-car" data-act="${fromHq ? 'gsubOpen' : 'subCarSel'}" data-id="${id}" data-k="${m.body}" aria-pressed="${m.body === v.body}"><span class="g-th">${thumb(subLook(m), -0.65, 160, 100)}</span><span class="g-name"><b>${esc(m.name)}</b><small>${m.bodyName} · ${m.number}세대 · ${esc(m.how ? HOW_NAME[m.how] : '자체 개발')}</small></span><span>평론 ${score(m.critic)}${m.awards.length ? '<small class="aw-s">수상</small>' : ''}</span><span>지난달 ${num(m.sold)}대</span></button>`).join('');
    const crit = v.reviews ? `<p class="lbl" style="margin-top:12px">평론가 4명</p><div class="kpis">${config.critics.list.map((c, i) => kpi(esc(c.name), score(v.reviews![i] ?? 0))).join('')}</div>` : `<p class="note">이 모델은 자회사가 전략에 따라 스스로 개발했습니다. 평론은 추정 평론${ib('term:추정 평론')}입니다.</p>`;
    const pct = v.pricePct ?? null, step = (dv: number) => Math.min(SUBS.modelPrice.max, Math.max(SUBS.modelPrice.min, (pct ?? Math.round(v.price / Math.max(1, v.stdPrice) * 100)) + dv));
    const price = direct && !fromHq ? `<hr><p class="lbl">가격 · 브랜드 기준 가격 ${num(v.stdPrice)}만원</p><div class="row sub-px"><button class="btn" data-act="subPrice" data-id="${id}" data-k="${v.body}" data-v="${step(-5)}">−5%</button><b class="sub-divv">${pct === null ? '전략대로' : `${pct}%`}</b><button class="btn" data-act="subPrice" data-id="${id}" data-k="${v.body}" data-v="${step(5)}">+5%</button><button class="btn" data-act="subPrice" data-id="${id}" data-k="${v.body}" data-v="" ${pct === null ? 'disabled' : ''}>전략대로</button></div>
      <p class="note">가격은 브랜드 기준 가격의 ${SUBS.modelPrice.min}~${SUBS.modelPrice.max}%로 정합니다. 비싸게 받으면 대당 이익이 늘고 판매가 줄어듭니다. 정하지 않으면 전략이 정합니다.</p>` : '';
    const acts = fromHq ? `<button class="btn ink" data-act="subOpen" data-id="${id}" data-v="garage" style="width:100%;margin-top:10px">${esc(d.name)} 운영 전환</button>` : `<div class="row sub-mact" style="margin-top:10px"><button class="btn" data-act="subRenameOpen" data-id="${id}" data-k="${v.body}">이름 변경</button><button class="btn danger" data-act="subDrop" data-id="${id}" data-k="${v.body}">단종</button></div>`;
    const card = `<div class="card sub-car-card"><p class="lbl"><i class="sub-own">${fromHq ? '내 자회사' : esc(v.how ? HOW_NAME[v.how] : '자체 개발')}</i> ${esc(d.name)}</p><h2>${esc(v.name)} <small class="hint">${v.bodyName} · ${v.number}세대 · ${v.year}년</small></h2>${v.fromName ? `<p class="hint">본사 「${esc(v.fromName)}」의 배지 모델${ib('term:배지 모델')}</p>` : ''}
      ${statBars(v.grades)}<div class="kpis" style="margin-top:10px">${kpi('평론', score(v.critic))}${kpi('가격', `${num(v.price)}<span>만원</span>`)}${kpi('대당 원가', `${num(v.unitCost)}<span>만원</span>`)}${kpi('지난달 판매', `${num(v.sold)}<span>대</span>`)}${kpi('차급 점유', `${Math.round(v.share * 100)}<span>%</span>`)}${kpi('다음 세대교체', v.cycleLeft ? `${v.cycleLeft}<span>개월 뒤</span>` : '이번 달')}</div>
      ${v.awards.length ? `<p class="hint aw-line" style="margin-top:8px"><b>수상${ib('term:시상식')}</b> ${v.awards.map(esc).join(' · ')}${v.awardLeft ? ` <small>(판매 +${Math.round(config.rivalry.awards.salesBoost * 100)}%, ${v.awardLeft}개월 남음)</small>` : ''}</p>` : ''}
      ${crit}${price}${acts}</div>`;
    const ovh = ovTop(`${esc(d.name)} 차고 · ${fromHq ? '내 자회사' : esc(SUBS.kinds[x.kind].name)}`, `${esc(v.name)}<small>${v.number}세대</small>`, specLine(v.body, v.powertrain, v.tier, v.segment)) + ovScore('평론', v.critic) + ovHint;
    return { ov: ovh, panel: (fromHq ? back : subBar(x)) + `<div class="card gsec"><h3>${esc(d.name)} 모델 ${d.models.length}대</h3>${list}</div>` + card, look: subLook(v) };
  }
  /** 개발 중인 차와 새 차 내기(본사 자회사 상세·운영 전환의 개발 탭 공통) */
  function subWorkCard(d: Q.SubDetail): string {
    if (!d.brand) return '';
    const direct = d.mode === 'direct', inSub = subView === d.id;
    const ords = d.orders.length ? `<div class="sub-orders">${d.orders.map((o) => `<div class="sub-ord"><div><b>${esc(o.name || `${o.bodyName} 신차`)}</b><small>${o.bodyName} · ${HOW_NAME[o.how]}${o.character ? ` · ${o.character}·가격 ${o.band}` : ''}${o.replaces ? ` · 「${esc(o.replaces)}」 다음 세대` : ''}</small></div><div class="prog"><u style="width:${(((o.months - o.monthsLeft) / Math.max(1, o.months)) * 100).toFixed(1)}%"></u></div><span class="sub-ord-m">개발 중 · ${o.monthsLeft ? `${o.monthsLeft}개월 남음` : '이번 달 말 출시'}</span><button class="btn" data-act="subCancelOrd" data-id="${d.id}" data-v="${o.id}">취소</button></div>`).join('')}</div>` : '<p class="hint">개발 중인 차가 없습니다.</p>';
    return `<div class="card sub-work"><h3>개발 <small class="hint">자본 중 쓸 수 있는 돈 ${money(d.funds)} · 가상 개발팀 ${SUBS.team.roles.length}명, 능력 ${d.team}</small></h3>${ords}
      <div class="row sub-new" style="margin-top:10px"><button class="btn ink" data-act="subPlanNew" data-id="${d.id}" ${direct ? '' : 'disabled'}>신차 기획</button><button class="btn" data-act="subOrderOpen" data-id="${d.id}">제작 지시${ib('term:제작 지시')}</button><button class="btn" data-act="subBadgeOpen" data-id="${d.id}">본사 차 배지${ib('term:배지 모델')}</button></div>
      ${direct ? '' : `<p class="note why">신차를 직접 기획하려면 직접 운영${ib('term:직접 운영')}으로 바꾸세요. 제작 지시와 배지는 전반 위임에서도 쓸 수 있습니다.</p>`}
      <p class="note">개발비는 자회사 자본에서 그달 비용으로 나가고, 개발 기간이 지나면 그달 말에 출시합니다. 같은 차급에 모델이 있으면 그 다음 세대가 됩니다. 자본이 모자라면 본사에서 추가 투자하세요.${inSub ? '' : ' 신차 기획은 운영 전환 화면에서 합니다.'} 취소해도 낸 개발비는 돌아오지 않습니다.</p></div>`;
  }
  /** 운영 방식 카드 */
  function subModeCard(d: Q.SubDetail): string {
    const go2 = subView === d.id ? '' : `<button class="btn ink" data-act="subOpen" data-id="${d.id}" style="width:100%;margin-top:8px">운영 전환 · ${esc(d.name)} 화면으로</button>`;
    if (!d.brand) return `<div class="card sub-mode"><p class="lbl">운영 방식</p><h2>전반 위임${ib('term:전반 위임')}</h2><p class="hint">부품 회사·할부 금융은 전반 위임으로만 운영합니다.</p>${go2}</div>`;
    const direct = d.mode === 'direct';
    return `<div class="card sub-mode"><p class="lbl">운영 방식</p><div class="seg sub-modes"><button data-act="subMode" data-id="${d.id}" data-v="delegate" aria-pressed="${!direct}">전반 위임${ib('term:전반 위임')}<small>전략이 모델 수·세대교체·가격을 정함</small></button><button data-act="subMode" data-id="${d.id}" data-v="direct" aria-pressed="${direct}">직접 운영${ib('term:직접 운영')}<small>신차 기획·가격·단종을 직접</small></button></div>
      <p class="note">${direct ? '직접 운영 중에는 자회사가 스스로 모델을 늘리거나 줄이지 않습니다. 손대지 않은 차는 전략 주기에 맞춰 세대교체하고, 가격을 정하지 않은 차는 전략이 가격을 정합니다.' : '전략이 모델을 늘리거나 줄입니다. 직접 운영으로 바꾸면 그때부터 모델 수를 본사가 정합니다.'}</p>${go2}</div>`;
  }
  /** 연간 목표 카드 */
  function subTargetCard(d: Q.SubDetail): string {
    const t = d.target, unit = (k: 'sold' | 'profit', v: number) => (k === 'sold' ? `${num(v)}대` : money(v, true));
    const last = d.last12, kind = d.brand ? tgtKind : 'profit', guess = kind === 'sold' ? Math.max(100, Math.round(last.sold * 1.1 / 100) * 100) : Math.max(10000, Math.round(last.profit * 1.1 / 10000) * 10000);
    const cur = t ? `<p class="hint">${t.year}년 목표 <b>${t.kind === 'sold' ? '판매' : '이익'} ${unit(t.kind, t.value)}</b> · 지금까지 ${unit(t.kind, t.progress)}(${Math.round(Math.min(1, Math.max(0, t.progress / t.value)) * 100)}%)</p><div class="prog"><u style="width:${(Math.min(1, Math.max(0, t.progress / t.value)) * 100).toFixed(1)}%"></u></div>` : '<p class="hint">정한 목표가 없습니다.</p>';
    return `<div class="card sub-target"><p class="lbl">연간 목표${ib('term:자회사 목표')}</p>${cur}
      ${d.brand ? `<div class="seg" style="margin-top:8px"><button data-act="tgtKind" data-v="sold" aria-pressed="${kind === 'sold'}">판매 대수</button><button data-act="tgtKind" data-v="profit" aria-pressed="${kind === 'profit'}">이익</button></div>` : ''}
      <div class="row" style="margin-top:8px"><input class="namein sub-tgt-in" id="sub-tgt" type="number" min="1" step="${kind === 'sold' ? 100 : 10000}" value="${guess}" aria-label="목표 값(${kind === 'sold' ? '대' : '만원'})"><span class="hint">${kind === 'sold' ? '대' : '만원'}</span><button class="btn ink" data-act="tgtSet" data-id="${d.id}" data-v="${kind}">목표 정하기</button>${t ? `<button class="btn" data-act="tgtClear" data-id="${d.id}">지우기</button>` : ''}</div>
      <p class="note">최근 12개월 ${d.brand ? `판매 ${num(last.sold)}대, ` : ''}이익 ${money(last.profit, true)}. 12월 결산에서 목표를 이루면 브랜드 평판 +${SUBS.target.subRep}, 본사 평판 +${SUBS.target.hqRep}입니다. 못 미쳐도 벌칙은 없습니다.</p></div>`;
  }
  /** 운영 전환의 개발 탭 */
  function subDevView(id: number): View {
    const s = game!.state, x = s.subs!.find((y) => y.id === id)!, d = Q.subDetail(s, id)!;
    const draftCard2 = draft?.subId === id ? `<div class="card"><p class="lbl">기획 중</p><h2>${esc(draft.name.trim() || '이름 없음')}</h2><button class="go" data-act="tab" data-v="plan">기획 이어 하기</button></div>` : '';
    return { ov: '', panel: subBar(x) + draftCard2 + subWorkCard(d) + subModeCard(d), look: undefined };
  }
  /** 운영 전환의 기록 탭: 분기 보고와 이 자회사의 뉴스 */
  function subRecordsView(id: number): View {
    const s = game!.state, x = s.subs!.find((y) => y.id === id)!, d = Q.subDetail(s, id)!;
    const news = s.events.news.filter((n) => n.category === 'sub' && n.text.includes(`「${x.name}」`) && !n.text.startsWith('[')).slice(-30).reverse();
    return { ov: '', panel: subBar(x) + `<div class="card"><h3>출시·전략 뉴스 <small class="hint">최근 ${news.length}건</small></h3>${news.length ? `<ul class="sub-reports">${news.map((n) => `<li><small>${yearOf(n.week)}년 ${(monthOf(n.week) % 12) + 1}월</small>${esc(n.text)}</li>`).join('')}</ul>` : '<p class="hint">아직 뉴스가 없습니다.</p>'}</div>`
      + `<div class="card sub-rep"><h3>분기 보고 <small class="hint">최근 ${d.reports.length}건</small></h3>${d.reports.length ? `<ul class="sub-reports">${d.reports.map((r) => `<li><small>${yearOf(r.week)}년 ${(monthOf(r.week) % 12) + 1}월</small>${esc(r.text)}</li>`).join('')}</ul>` : '<p class="hint">아직 보고가 없습니다.</p>'}</div>`, look: undefined };
  }
  /** 제작 지시 창 */
  function showSubOrder(): void {
    const s = game!.state, o = ordSet, x = o && s.subs?.find((y) => y.id === o.id); if (!o || !x) return;
    const d = Q.subDetail(s, o.id)!, bodies = d.areaReady;
    if (!bodies.includes(o.body)) o.body = bodies.find((b) => !Q.subSlotError(s, x, b)) ?? bodies[0] ?? '';
    const err0 = o.body ? Q.subSlotError(s, x, o.body) : '맡은 영역에 연구한 차급이 없습니다.';
    const pv = o.body ? Q.subPlanPreview(s, x, Q.subAutoSpec(s, x, o.body, o.character, o.band)) : null;
    const why = err0 ?? pv?.fundError ?? null;
    sheetBody.innerHTML = `<div class="sub-order"><div class="eyebrow"><i></i>${esc(x.name)} · 제작 지시${ib('term:제작 지시')}</div><h2>${esc(x.name)}에 차 만들기 지시</h2>
      <p class="lbl" style="margin-top:10px">차급</p><div class="row sub-bodies">${bodies.map((b) => { const has = d.models.find((m) => m.body === b), busy = d.orders.some((x) => x.body === b); return `<button class="btn" data-act="ordPick" data-k="body" data-v="${b}" aria-pressed="${o.body === b}" ${busy ? 'disabled' : ''}>${bodyById(b).name}${busy ? '<small>개발 중</small>' : has ? `<small>「${esc(has.name)}」 다음 세대</small>` : ''}</button>`; }).join('') || '<p class="hint">맡은 영역에 본사가 연구한 차급이 없습니다.</p>'}</div>
      <p class="lbl" style="margin-top:10px">성격</p><div class="seg">${CHARS.map(([k, n, sub]) => `<button data-act="ordPick" data-k="character" data-v="${k}" aria-pressed="${o.character === k}">${n}<small>${sub}</small></button>`).join('')}</div>
      <p class="lbl" style="margin-top:10px">가격대</p><div class="seg">${BANDS.map(([k, n, sub]) => `<button data-act="ordPick" data-k="band" data-v="${k}" aria-pressed="${o.band === k}">${n}<small>${sub}</small></button>`).join('')}</div>
      <label class="lbl" for="ord-name" style="margin-top:10px">차 이름(비우면 자회사가 정함)</label><input class="namein" id="ord-name" type="text" maxlength="${config.nameMax}" value="${esc(($<HTMLInputElement>('#ord-name')?.value) ?? '')}" autocomplete="off">
      ${pv ? `<div class="kpis" style="margin-top:12px">${kpi('예상 평론', score(pv.critic))}${kpi('개발비', money(pv.cost))}${kpi('기간', `${pv.months}<span>개월</span>`)}${kpi('쓸 수 있는 자본', money(d.funds))}</div>` : ''}
      ${why ? `<div class="badbox" style="margin-top:10px">${esc(why)}</div>` : ''}
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="closeSheet">닫기</button><button class="btn ink" data-act="subOrderDo" ${why ? 'disabled' : ''}>제작 지시</button></div>
      <p class="note">자회사가 공유 범위 안의 본사 기술로 사양을 짜 개발합니다. 예상 평론은 평론가의 흔들림을 뺀 값입니다.</p></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 본사 차 배지 창 */
  function showSubBadge(id: number): void {
    const s = game!.state, x = s.subs?.find((y) => y.id === id); if (!x) return;
    const list = Q.badgeChoices(s, x);
    sheetBody.innerHTML = `<div class="sub-badge"><div class="eyebrow"><i></i>${esc(x.name)} · 본사 차 배지${ib('term:배지 모델')}</div><h2>본사 차를 「${esc(x.name)}」 이름으로 내기</h2>
      <p class="hint">본사가 판매 중인 차 가운데 ${esc(x.name)}${josa(x.name, '이/가')} 맡은 차급의 차만 낼 수 있습니다. 개발비 ${Math.round(SUBS.badge.costShare * 100)}%·기간 약 ${Math.round(1 / SUBS.badge.timeShare)}분의 1, 평론 −${Math.abs(SUBS.badge.critic)}점, 본사 원본의 판매가 일반 자회사 모델보다 많이 줄어듭니다.</p>
      ${list.length ? `<div class="sub-badges">${list.map((b) => { const g = Q.generationById(s, b.generationId); return `<div class="sub-bd${b.ok ? '' : ' locked'}"><span class="g-th">${g ? thumb({ ...genLook(g), color: x.color }, -0.65, 140, 88) : ''}</span><span class="g-name"><b>${esc(b.name)}</b><small>${b.bodyName} · 본사 평론 ${score(b.hqCritic)} → ${score(b.critic)}${b.replaces ? ` · 「${esc(b.replaces)}」 다음 세대` : ''}</small><small>개발비 ${money(b.cost)} · ${b.months}개월</small>${b.reason ? `<small class="need">${esc(b.reason)}</small>` : ''}</span><button class="btn ink" data-act="subBadgeDo" data-id="${id}" data-v="${b.generationId}" ${b.ok ? '' : 'disabled'}>배지 모델로 내기</button></div>`; }).join('')}</div>` : '<div class="warnbox">맡은 차급에서 본사가 판매 중인 차가 없습니다.</div>'}
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 자회사 신차 기획 초안: 본사 기획 화면을 그대로 쓰고 차급·고객층은 그 자회사 영역 안, 개발팀은 가상 팀 */
  function newSubDraft(id: number): Draft | null {
    const s = game!.state, x = s.subs?.find((y) => y.id === id); if (!x) return null;
    const body = Q.subDetail(s, id)!.areaReady.find((b) => !Q.subSlotError(s, x, b)); if (!body) { err(Q.subSlotError(s, x, Q.subDetail(s, id)!.areaReady[0] ?? '') ?? '새 차를 낼 수 있는 차급이 없습니다.'); return null; }
    const sp = Q.subAutoSpec(s, x, body, x.kind === 'premium' ? 'luxury' : 'value', 'mid', Q.subModelName(s, x, body));
    return { ...sp, color: x.color, nameplateId: 0, chassisSeed: Q.lookCandidates(s, 0, 'chassis')[0], faceSeed: Q.lookCandidates(s, 0, 'face', 'nextGen')[0], team: [], mode: 'sum', equipMode: 'rec', subId: id };
  }
  /** 그룹 종합(재무 화면) */
  function groupCard(): string {
    const s = game!.state, G = Q.groupSummary(s); if (!G) return '';
    const T = G.total, share = (v: number) => (T.profit > 0 ? `${Math.round((v / T.profit) * 100)}%`.replace('-', '−') : '—'), shareS = (v: number) => (T.sold > 0 ? `${Math.round((v / T.sold) * 100)}%` : '—');
    const rows = G.months.map((m) => ({ label: Q.monthLabel(m.month), short: `${(m.month % 12) + 1}월`, profit: m.profit, sold: m.sold }));
    return `<div class="card group-card"><h3>그룹 종합${ib('term:그룹 종합')} <small class="hint">본사 + 자회사 ${G.companies.length - 1}곳</small></h3>
      <div class="kpis">${kpi('최근 12개월 판매', `${num(T.sold)}<span>대</span>`)}${kpi('매출', money(T.revenue))}${kpi('이익', money(T.profit, true), T.profit >= 0 ? 'pos' : 'neg')}${kpi('지난달 이익', money(G.last.profit, true), G.last.profit >= 0 ? 'pos' : 'neg')}</div>
      <div class="tblwrap"><table class="tbl" style="margin-top:8px"><tr><th>회사</th><th class="r">판매(12개월)</th><th class="r">매출</th><th class="r">이익</th><th class="r">이익 비중</th></tr>${G.companies.map((c) => `<tr><td>${c.kind === 'hq' ? '<b>본사</b> ' : subMark(c.name, c.color, 16) + ' '}${esc(c.name)}</td><td class="r">${c.kind === 'hq' || isBrandK(c.kind) ? `${num(c.sold)}대 <small class="hint">${shareS(c.sold)}</small>` : '—'}</td><td class="r">${money(c.revenue)}</td><td class="r ${c.profit >= 0 ? 'pos' : 'neg'}">${money(c.profit, true)}</td><td class="r">${share(c.profit)}</td></tr>`).join('')}</table></div>
      <div class="pcols"><div class="pcol"><p class="lbl" style="margin-top:10px">그룹 월 이익</p>${V.barChart(rows, (r) => r.profit, '그룹 월 이익')}</div><div class="pcol"><p class="lbl" style="margin-top:10px">그룹 월 판매</p>${V.barChart(rows, (r) => r.sold, '그룹 월 판매', (v) => `${num(v)}대`, (v) => `${num(v)}대`)}</div></div>
      ${(() => { const L12 = s.ledger.slice(-12), rev = L12.reduce((a, e) => a + e.revenue, 0), ov = L12.reduce((a, e) => a + Object.values(e.world ?? {}).reduce((b, x) => b + x.revenue, 0), 0); return ov > 0 ? `<p class="hint">본사 매출 중 해외 비중(최근 12개월): <b>${Math.round((ov / rev) * 100)}%</b> · 해외 매출 ${money(ov)}</p>` : ''; })()}
      <p class="note">본사 이익에서 자회사 배당은 빼고 자회사 설립·투자는 되돌려(그룹 안에서 옮겨 간 돈) 자회사 이익과 더했습니다. 이익 비중은 그룹 이익 대비입니다.</p></div>`;
  }
  /** 본사 차고의 자회사 차(구분 표시, 누르면 무대에 3D) */
  function subCarsCard(): string {
    const s = game!.state, list = (s.subs ?? []).flatMap((x) => (Q.subDetail(s, x.id)?.models ?? []).map((m) => ({ x, m })));
    if (!list.length) return '';
    return `<div class="card gsec sub-cars"><h3>자회사 차 ${list.length}대 <small class="hint">누르면 무대에서 봅니다</small></h3>${list.map(({ x, m }) => `<button class="gsr" data-act="gsubOpen" data-id="${x.id}" data-k="${m.body}"><span class="g-th">${thumb(subLook(m), -0.65, 160, 100)}</span><span class="g-name"><b>${esc(m.name)}</b><small><i class="sub-own">내 자회사</i> ${esc(x.name)} · ${m.bodyName} · ${m.number}세대</small></span><span>평론 ${score(m.critic)}${m.awards.length ? '<small class="aw-s">수상</small>' : ''}</span><span>지난달 ${num(m.sold)}대</span><span aria-hidden="true">→</span></button>`).join('')}</div>`;
  }

  function hqTab(): string {
    const s = game!.state, h = Q.hqInfo(s), c = h.current, n = h.next;
    const steps = `<ol class="lv5">${config.hq.levels.map((l, i) => `<li class="${i + 1 < c.level ? 'done' : i + 1 === c.level ? 'on' : ''}"><b>${i + 1}</b><small>${esc(l.name)}</small></li>`).join('')}</ol>`;
    const cur = `<div class="card hq-cur"><p class="lbl">지금 본사 · ${c.level}등급</p><h2>${esc(c.name)}</h2>${steps}
      <div class="kpis">${kpi('정원', `${h.staffCount}/${c.staffCap}<span>명</span>`)}${kpi('동시에 개발할 수 있는 차', `${c.teams}<span>대</span>`)}${kpi('월 유지비', money((c.upkeep)))}</div>
      <p class="note">본사가 클수록 직원을 더 뽑고, 여러 차를 함께 개발하고, 차에 옵션을 더 넣을 수 있습니다. 개발 탭의 사무실도 넓어집니다.</p></div>`;
    const next = n ? `<div class="card hq-next"><p class="lbl">다음 등급 · ${n.level}등급</p><h2>${esc(n.name)}</h2>
      <table class="tbl" style="margin-top:8px"><tr><th>무엇이 늘어나나</th><th class="r">지금</th><th class="r">키우면</th></tr>${cmpRow('정원', `${c.staffCap}명`, `${n.staffCap}명`)}${cmpRow('동시에 개발할 수 있는 차', `${c.teams}대`, `${n.teams}대`)}${cmpRow('월 유지비', money((c.upkeep)), money((n.upkeep)), true)}</table>
      <div class="kpis" style="margin-top:10px">${kpi('승급 비용', money(n.cost))}${kpi('필요한 평판', n.rep ? `${n.rep}<span>이상 (지금 ${Math.floor(s.reputation)})</span>` : '없음')}</div>
      ${h.canUpgrade ? '' : `<div class="badbox" style="margin-top:10px">${esc(h.reason ?? '')}</div>`}
      <button class="go" data-act="upgradeHQ" ${h.canUpgrade ? '' : 'disabled'}>본사 키우기 · ${money(n.cost)}</button></div>`
      : '<div class="card"><h3>최고 등급입니다</h3><p class="hint">본사가 가장 큰 등급입니다.</p></div>';
    return `<div class="cols">${cur}${next}</div>`;
  }

  function factoryTab(): string {
    const s = game!.state, f = Q.factoryInfo(s), c = f.current, n = f.next, b = f.building, BM = Q.factoryBuildMonths(b?.level ?? n?.level ?? c.level);
    const cut = (m: number) => (m < 1 ? `${Math.round((1 - m) * 100)}%` : '없음');
    const build = b ? `<div class="build"><p class="lbl">증설 공사 중 · ${b.level}등급</p><div class="prog"><u style="width:${(Math.min(1, Math.max(0, (BM - b.monthsLeft) / BM)) * 100).toFixed(1)}%"></u></div><p class="hint">${b.monthsLeft}개월 남았습니다.${n ? ` 끝나면 한 달 생산 ${num(n.capacity)}대, 생산 라인 ${n.lines}개가 됩니다.` : ''}</p></div>` : '';
    const cur = `<div class="card fac-cur"><p class="lbl">지금 공장 · ${c.level}등급</p><div class="kpis">${kpi('한 달 생산', `${num(c.capacity)}<span>대</span>`)}${kpi(`생산 라인${ib('term:생산 라인')}`, `${f.linesUsed}/${c.lines}<span>개 사용</span>`)}${kpi('월 유지비', money((c.upkeep)))}${kpi('원가 절감', cut(c.costMult))}</div>${build}
      <p class="note">생산 라인 하나에 차 한 종류를 만듭니다. 주문이 생산량보다 많으면 나머지는 못 팝니다(재고는 없습니다).</p></div>`;
    const next = n ? `<div class="card fac-next"><p class="lbl">${b ? '공사 중인 등급' : '증설하면'} · ${n.level}등급</p>
      <table class="tbl"><tr><th>무엇이 늘어나나</th><th class="r">지금</th><th class="r">증설 뒤</th></tr>${cmpRow('한 달 생산', `${num(c.capacity)}대`, `${num(n.capacity)}대`)}${cmpRow('생산 라인', `${c.lines}개`, `${n.lines}개`)}${cmpRow('월 유지비', money((c.upkeep)), money((n.upkeep)), true)}${cmpRow('원가 절감', cut(c.costMult), cut(n.costMult))}</table>
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
      <p class="note">막대: 진한 부분은 만든 차, 주황 부분은 주문을 받고도 못 만든 차입니다.</p>` : '<p class="hint">판매 중인 차가 없습니다. 차를 출시하면 여기서 차종별 생산량과 못 판 주문을 봅니다.</p>'}</div>`;
    return `<div class="cols">${cur}${next}${batteryPlantCard()}${prod}</div>`;
  }
  /** 1.2.0 배터리 공장: 공장 등급 카드와 같은 모양. 전기차 연구 전에는 숨김 */
  function batteryPlantCard(): string {
    const s = game!.state; if (!s.research.done.includes(config.ev.plant.tech)) return '';
    const B = Q.batteryPlantInfo(s), c = B.current, n = B.next, b = B.building, pct = (v: number | undefined) => (v ? `${Math.round(v * 100)}%` : '없음');
    // 다음 등급 어림: 지난달 전기차 원가(절감 전)에 다음 등급 절감률
    const gens = new Map(allGens(s).map((g) => [g.id, g])), evCogs = (s.ledger.at(-1)?.cars ?? []).reduce((a, x) => a + (gens.get(x.id)?.powertrain === EV ? x.cogs : 0), 0), raw = evCogs / (1 - (c?.cut ?? 0));
    const net = B.lastMonth.saving - B.upkeep, nNet = n ? raw * n.cut - n.upkeep : 0;
    const BM = b ? B.levels[b.level - 1].buildMonths : 0;
    const build = b ? `<div class="build"><p class="lbl">건설 공사 중 · ${b.level}등급</p><div class="prog"><u style="width:${(Math.min(1, Math.max(0, (BM - b.monthsLeft) / BM)) * 100).toFixed(1)}%"></u></div><p class="hint">${b.monthsLeft}개월 남았습니다. 끝나면 전기차 대당 원가가 ${pct(B.levels[b.level - 1].cut)} 줄어듭니다.</p></div>` : '';
    const gain = c ? `<p class="hint bat-net" style="margin-top:8px">지난달 전기차 ${num(B.lastMonth.evSold)}대 · 절감액 ${money(B.lastMonth.saving)} − 유지비 ${money(B.upkeep)} = <b class="${net >= 0 ? 'pos' : 'neg'}">${money(net, true)}</b> ${net >= 0 ? '이득' : '손해'}</p>` : '';
    const nx = n ? `<table class="tbl" style="margin-top:10px"><tr><th>${b ? '공사 중인 등급' : c ? '증설하면' : '지으면'} · ${n.level}등급</th><th class="r">지금</th><th class="r">${c ? '증설 뒤' : '건설 뒤'}</th></tr>${cmpRow('전기차 원가 절감', pct(c?.cut), pct(n.cut))}${cmpRow('월 유지비', money(B.upkeep), money(n.upkeep), true)}</table>
      <div class="kpis" style="margin-top:10px">${kpi('건설비', money(n.cost))}${kpi('공사 기간', `${n.buildMonths}<span>개월</span>`)}</div>
      <p class="hint bat-est" style="margin-top:8px">지난달 전기차 ${num(B.lastMonth.evSold)}대로 어림하면 ${n.level}등급의 월 절감 ${money(raw * n.cut)} − 유지비 ${money(n.upkeep)} = <b class="${nNet >= 0 ? 'pos' : 'neg'}">${money(nNet, true)}</b></p>
      ${B.canBuild || b ? '' : `<div class="badbox" style="margin-top:10px">${esc(B.reason ?? '')}</div>`}
      ${b ? '' : `<button class="go" data-act="buildBatteryPlant" ${B.canBuild ? '' : 'disabled'}>${c ? '배터리 공장 증설' : '배터리 공장 건설'} · ${money(n.cost)}</button>`}` : '<p class="hint" style="margin-top:10px">배터리 공장이 최고 등급입니다.</p>';
    return `<div class="card fac-bat"><p class="lbl">배터리 공장${ib('term:배터리 공장')} · ${c ? `${c.level}등급` : '없음'}</p><div class="kpis">${kpi('전기차 원가 절감', pct(c?.cut))}${kpi('월 유지비', money(B.upkeep))}</div>${build}${gain}${nx}</div>`;
  }

  // ----- 연구(10장) -----
  const ST_BADGE: Record<Q.TechStatus, string> = { done: '✓ 완료', active: '진행 중', available: '가능', locked: '먼저 할 연구 있음', hidden: '아직 먼 기술' };
  const pts1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString('ko-KR');
  /** 비용 배수를 말로: "2배", "25% 더", "절반" */
  const multWord = (m: number) => (m === 0.5 ? '절반' : m < 1 ? `${Math.round((1 - m) * 100)}% 덜` : Number.isInteger(+m.toFixed(2)) ? `${+m.toFixed(2)}배` : `${Math.round((m - 1) * 100)}% 더`);
  /** 비용 배수 표시: 등장 연도보다 일찍(할증) / 8년 지나 따라잡기(할인) / 반복 기술 */
  const multTag = (t: Q.TechRow): string => {
    const m = t.cost.mult, y = yearOf(game!.state.week), x = `비용 ${multWord(m)}`;
    return m > 1 && y < t.year ? `일찍 연구: ${x}` : m < 1 ? `따라잡기: ${x}` : m > 1 ? `반복 연구: ${x}` : '';
  };
  const preNeed = (t: Q.TechRow) => t.pre.filter((p) => !p.done).map((p) => `「${p.name}」`).join(', ');
  /** 규제 필수 표시: "규제 필수 · 1975년 3월 시행" */
  const regTag = (r: { week: number }) => `규제 필수 · ${Q.monthLabel(Math.floor(r.week / config.time.weeksPerMonth))} 시행`;
  function techCard(t: Q.TechRow): string {
    if (t.status === 'hidden') return `<button class="tc hidden" data-act="techSel" data-v="${t.id}" data-tip="tech:${t.id}"><span class="tc-h"><b>${esc(t.name)}</b>${ib(`tech:${t.id}`, t.name)}</span><small class="yr">${t.year}년쯤 · 아직 먼 기술</small></button>`;
    const mt = multTag(t), prog = t.status === 'active' ? Math.min(1, 1 - t.pointsLeft / Math.max(1, t.cost.points)) : 0;
    return `<button class="tc ${t.status}" data-act="techSel" data-v="${t.id}" data-tip="tech:${t.id}"><span class="tc-h"><b>${esc(t.name)}</b>${ib(`tech:${t.id}`, t.name)}<em>${t.repeatable && t.count ? `✓ ${t.count}번` : ST_BADGE[t.status]}</em></span>
      <small class="yr">${t.year}년 기술</small>${t.requiredBy ? `<small class="req">${regTag(t.requiredBy)}</small>` : ''}<small class="desc">${esc(t.desc)}</small><small class="eff">${esc(t.effects)}</small>
      ${t.status === 'done' ? '' : t.status === 'active' ? `<span class="prog"><u style="width:${(prog * 100).toFixed(1)}%"></u></span><small class="left">${t.weeksLeft === null ? '연구 점수가 없어 멈춤' : `약 ${t.weeksLeft}주 남음`}</small>`
        : `<small class="cost">${money(t.cost.money)} + ${num(t.cost.points)}점${mt ? ` · <i>${mt}</i>` : ''}</small>`}
      ${t.status === 'locked' ? `<small class="why">${esc(preNeed(t))} 먼저</small>` : t.status === 'available' && t.reason ? `<small class="why">${esc(t.reason)}</small>` : ''}</button>`;
  }
  function researchTab(): string {
    const s = game!.state, r = Q.researchInfo(s), engs = s.staff.filter((x) => x.role === 'engineer'), labN = s.staff.filter((x) => x.lab).length;
    const back = draft || lift ? `<button class="btn ink back-plan" data-act="backPlan" style="width:100%;margin-top:10px">← 기획으로 돌아가기</button>` : '';
    const zero = r.pointsPerWeek > 0 ? '' : `<div class="warnbox r-zero" style="margin-top:10px">${engs.length ? '엔지니어가 모두 교육·휴식 중이라 지금 연구 점수가 0입니다. 교육·휴식이 끝나면 다시 연구합니다.' : '엔지니어가 없어 연구 점수가 0입니다. 직원 탭에서 엔지니어를 뽑으세요.'}</div>`;
    const act = r.active.map((a) => `<div class="ract${a.priority ? ' pri' : ''}"><div class="prod-h"><b>${esc(a.name)}${a.priority ? ' <span class="chip on">먼저 하는 중</span>' : ''}${a.requiredBy ? ` <span class="chip bad">${regTag(a.requiredBy)}</span>` : ''}</b><small>${num(a.points)} / ${num(a.need)}점 · 한 주 ${pts1(a.pointsPerWeek)}점 · ${a.weeksLeft === null ? '연구 점수가 없어 멈춤' : `약 ${a.weeksLeft}주 남음`}</small></div><div class="prog"><u style="width:${((a.points / Math.max(1, a.need)) * 100).toFixed(1)}%"></u></div><div class="row">${r.active.length > 1 && !a.priority ? `<button class="btn ink" data-act="priRes" data-v="${a.techId}">먼저 하기 <small>(점수의 ${Math.round(config.research.priorityShare * 100)}%)</small></button>` : ''}<button class="btn" data-act="techSel" data-v="${a.techId}">자세히 · 취소</button></div></div>`).join('');
    const sum = `<div class="card r-sum"><p class="lbl">연구</p><h2 class="r-pts">엔지니어가 연구합니다. 지금 한 주에 ${pts1(r.pointsPerWeek)}점</h2>
      <div class="kpis" style="margin-top:10px">${kpi('한 주 연구 점수', `${pts1(r.pointsPerWeek)}<span>점</span>`)}${kpi('연구 칸', `${r.used}/${r.slots}<span>개 사용</span>`)}${kpi('완료한 기술', `${r.doneCount}<span>개</span>`)}${kpi('전담 연구원', `${labN}<span>명</span>`)}</div>
      ${zero}${s.research.done.includes(config.ev.plant.tech) ? (({ minutes, nextMinutes }) => `<p class="hint r-charge" style="margin-top:10px">전기차 충전 속도: 10→80% ${minutes}분(표준 배터리)${nextMinutes === null ? ' · 마지막 단계' : ` · 다음 충전 연구를 마치면 약 ${nextMinutes}분`}${Q.platformReady(s) ? ' · 전용 플랫폼 연구 완료' : ''}</p>`)(Q.chargeInfo(s)) : ''}${act ? `<p class="lbl" style="margin-top:12px">진행 중인 연구</p>${act}` : '<p class="hint" style="margin-top:10px">진행 중인 연구가 없습니다. 아래에서 "가능" 표시가 있는 기술을 눌러 시작합니다.</p>'}
      <p class="note">엔지니어가 매주 능력의 10분의 1만큼 점수를 냅니다. 개발에 들어간 엔지니어는 그 ${Math.round(config.research.projectShare * 100)}%만 냅니다. 돈은 시작할 때 내고, 점수가 다 쌓이면 완성됩니다. ${s.hqLevel >= config.research.labHq ? '직원 탭에서 엔지니어를 전담 연구원으로 두면 점수가 1.5배입니다.' : `본사 ${config.research.labHq}등급부터 전담 연구원(점수 1.5배)을 둘 수 있습니다.`} 본사 등급이 오르면 연구 칸이 늘어납니다(지금 ${r.slots}칸). 점수는 진행 중인 연구가 고르게 나눠 받고, [먼저 하기]를 누른 연구는 ${Math.round(config.research.priorityShare * 100)}%를 받습니다. 규제에 필요한 연구는 자동으로 먼저 합니다. 기술이 나오는 해보다 일찍 연구하면 비싸지만, 그 기술을 처음 쓰는 차가 "세계 최초"${ib('term:세계 최초')}로 평론 점수를 1점씩 더 받습니다. 나온 지 8년이 지나면 절반 값입니다.</p>${back}</div>`;
    const fields = r.fields.map((f) => `<div class="card rfield" data-field="${f.id}"><h3>${esc(f.name)} <small class="hint">${f.techs.filter((t) => t.status === 'done' || t.count).length}/${f.techs.length} 완료</small></h3><div class="techs">${f.techs.map(techCard).join('')}</div></div>`).join('');
    return `<div class="research">${sum}${fields}</div>`;
  }
  /** 기술 자세히(화면 안 창): 설명·효과·비용·선행·이유, [연구 시작]/[연구 취소] */
  function showTech(id: string): void {
    const s = game!.state, t = Q.researchInfo(s).fields.flatMap((f) => f.techs).find((x) => x.id === id);
    if (!t) return;
    const y = yearOf(s.week), mt = multTag(t), ppw = Q.weeklyResearchPoints(s);
    const why = t.status === 'active' || t.status === 'done' ? null : t.reason;
    const costNote = mt.startsWith('일찍') ? `${t.year}년에 나올 기술을 ${t.year - y}년 일찍 연구해서 비용이 ${multWord(t.cost.mult)}${t.cost.mult >= 2 && Number.isInteger(+t.cost.mult.toFixed(2)) ? '입니다' : ' 듭니다'}. 먼저 완성하면 이 기술을 처음 쓰는 차가 "세계 최초"로 평론 점수를 1점씩 더 받습니다.` : mt.startsWith('따라잡기') ? `나온 지 ${config.research.lateYears}년이 지난 기술이라 비용이 절반입니다(따라잡기).` : mt ? '반복 연구할 때마다 비용이 늘어납니다.' : '';
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="tech-sheet" data-tech="${t.id}"><div class="eyebrow"><i></i>연구 · ${esc(Q.FIELD_NAMES[t.field])} · ${t.year}년 기술</div><h2>${esc(t.name)} <span class="chip ${t.status === 'done' ? 'on' : ''}">${ST_BADGE[t.status]}</span></h2>
      ${t.status === 'hidden' ? '' : `<p class="tech-desc">${esc(t.desc)}</p><p class="hint tech-eff" style="margin-top:6px"><b>효과</b> · ${esc(t.effects)}</p>
      <div class="kpis" style="margin-top:12px">${t.status === 'done' ? '' : `${kpi(t.status === 'active' ? '남은 점수' : '비용', t.status === 'active' ? `${num(t.pointsLeft)}<span>점</span>` : money(t.cost.money))}${t.status === 'active' ? '' : kpi('연구 점수', `${num(t.cost.points)}<span>점</span>`)}${kpi('예상 기간', t.weeksLeft === null ? '점수 0' : `약 ${t.weeksLeft}<span>주</span>`)}`}</div>
      ${costNote && t.status !== 'done' && t.status !== 'active' ? `<p class="hint" style="margin-top:8px">${esc(costNote)}</p>` : ''}
      ${t.pre.length ? `<p class="lbl" style="margin-top:12px">먼저 할 연구</p><ul class="pre">${t.pre.map((p) => `<li class="${p.done ? 'ok' : ''}">${p.done ? '✓' : '✗'} ${esc(p.name)}</li>`).join('')}</ul>` : ''}`}
      ${t.requiredBy ? `<div class="warnbox tech-req" style="margin-top:12px">${esc(t.requiredBy.eventName)}: ${regTag(t.requiredBy)}. 이 기술이 없으면 시행 뒤에는 신차를 출시할 수 없습니다. 진행 중이면 자동으로 먼저 연구합니다.</div>` : ''}
      ${why ? `<div class="badbox tech-why" style="margin-top:12px">${esc(why)}</div>` : ''}
      ${t.status === 'active' ? `<p class="hint" style="margin-top:10px">지금 한 주에 ${pts1(ppw)}점씩 쌓이고 있습니다.</p>` : ''}
      <div class="row end" style="margin-top:14px"><button class="btn" data-act="closeSheet">닫기</button>${t.status === 'active' ? `<button class="btn danger" data-act="cancelResearch" data-v="${t.id}">연구 취소</button>` : t.status === 'done' ? '' : `<button class="go" data-act="startResearch" data-v="${t.id}" ${why ? 'disabled' : ''}>연구 시작</button>`}</div></div>`;
    sheet.hidden = false; renderTop();
  }

  // ----- 기록 -----
  const REC_TABS: [RecTab, string][] = [['cars', '차종 계보'], ['hall', '명예의 전당'], ['awards', '시상식'], ['stats', '통계'], ['years', '연 보고서'], ['combo', '조합 노트'], ['news', '뉴스'], ['past', '지난 판의 차']];
  const LIN_KEY = 'car-company-lineage';
  const LIN_SORTS = [['launch', '출시 순'], ['sold', '많이 팔린 순'], ['profit', '이익 큰 순'], ['review', '평론 높은 순'], ['long', '판매 기간 긴 순']] as const;
  const linView = ((): { sort: typeof LIN_SORTS[number][0]; filter: '' | 'on' | 'off' } => {
    let o: Record<string, unknown> = {}; try { o = JSON.parse(localStorage.getItem(LIN_KEY) ?? '{}') ?? {}; } catch { /* 저장 불가 */ }
    return { sort: LIN_SORTS.some(([k]) => k === o.sort) ? o.sort as typeof LIN_SORTS[number][0] : 'launch', filter: o.filter === 'on' || o.filter === 'off' ? o.filter : '' };
  })();
  /** 3.5.0 시상식 이력(최근 해가 앞): 부문·수상 차·회사, 내 차와 내 자회사 차는 강조 */
  function awardsTab(): string {
    const s = game!.state, h = Q.awardHistory(s), mine = (s.rivalry?.awards ?? []).filter((a) => a.who === 'mine').length, sub = (s.rivalry?.awards ?? []).filter((a) => a.who === 'sub').length;
    if (!h.length) return `<div class="card"><h3>시상식${ib('term:시상식')}</h3><p class="hint">아직 시상식이 없었습니다. 해마다 12월 결산에 그해 나온 차 가운데 부문별로 한 대를 고릅니다.</p></div>`;
    const who = (a: (typeof h)[number]['list'][number]) => (a.who === 'mine' ? '<i class="aw-me">내 차</i>' : a.who === 'sub' ? '<i class="sub-own">내 자회사</i>' : '');
    return `<div class="card aw-card"><h3>시상식${ib('term:시상식')} <small class="hint">내 차 수상 ${mine}번 · 내 자회사 차 ${sub}번</small></h3>${h.map((y) => `<p class="lbl aw-y">${y.year}년</p><div class="tblwrap"><table class="tbl aw-t">${y.list.map((a) => `<tr class="${a.who === 'rival' ? '' : 'aw-own'}"><th>${esc(a.name)}</th><td><b>「${esc(a.car)}」</b> ${who(a)}<small class="hint"> ${esc(a.company)} · ${bodyById(a.body).name}</small></td></tr>`).join('')}</table></div>`).join('')}
      <p class="note">기록은 최근 ${config.rivalry.awards.keep}건까지 남습니다. 올해의 차와 차급 부문은 평론, 기술상은 성능·연비·품질 등급, 디자인상은 디자인 등급으로 겨룹니다(심사위원 취향에 따라 조금씩 흔들립니다).</p></div>`;
  }
  /** 1.0.0 명예의 전당: 우리 회사 역대 기록(누르면 그 차종 계보로). 불명예는 접어 둔다 */
  function hallTab(): string {
    const s = game!.state, h = Q.hallOfFame(s);
    if (h.empty) return startCard() + '<div class="card hall"><h3>명예의 전당</h3><p class="hint">아직 낸 차가 없습니다. 차를 출시하면 가장 많이 팔린 차, 가장 비싼 차 같은 기록이 여기 쌓입니다.</p></div>';
    const fmtV = (k: string, v: number, m?: number) => k === 'sold' || k === 'soldName' ? `${num(v)}대` : k === 'pricey' || k === 'cheap' ? `${num(v)}만원` : k === 'review' || k === 'worstReview' || k === 'grade' ? `${score(v)}점`
      : k === 'profit' || k === 'loss' ? money(v, true) : k === 'payback' ? `출시 ${v}개월째` : k === 'long' ? `${v}개월` : k === 'month' ? `${num(v)}대 · ${Q.monthLabel(m ?? 0)}` : String(v);
    const card = (x: Q.HallCar) => { const g = Q.generationById(s, x.genId), n = s.nameplates.find((y) => y.id === x.nameplateId);
      return g ? `<button class="hall-it" data-act="hallGo" data-v="${x.nameplateId}"><span class="g-th">${thumb(genLook(g), -0.65, 160, 100)}</span><span class="hall-t"><small>${esc(x.label)}</small><b>${esc(n?.name ?? '')}${x.key === 'soldName' ? '' : ` <em>${g.number}세대</em>`}</b><span>${x.key === 'soldName' ? `${n?.generations.length ?? 0}세대 합계` : `${genYear(g)}년 출시`}</span></span><span class="hall-v ${x.key === 'loss' ? 'neg' : x.key === 'profit' ? 'pos' : ''}">${fmtV(x.key, x.value, x.month)}</span></button>` : ''; };
    const co = h.company.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${r.key === 'yearRev' || r.key === 'yearProfit' ? money(r.value, r.key === 'yearProfit') : r.key === 'rep' ? Math.round(r.value) : r.key === 'totalSold' ? `${num(r.value)}대` : r.key === 'names' ? `${r.value}개` : r.key === 'staff' ? `${esc(r.text ?? '')} · ${Math.floor(r.value / 12) ? `${Math.floor(r.value / 12)}년 ` : ''}${r.value % 12}개월` : num(r.value)}${r.year ? ` <small class="hint">${r.year}년</small>` : ''}</td></tr>`).join('');
    return `${startCard()}<div class="card hall"><h3>명예의 전당 <small class="hint">누르면 그 차종 계보로 갑니다</small></h3><div class="hall-grid">${h.cars.map(card).join('')}</div>
      ${h.shame.length ? `<details class="hall-shame"><summary><span class="lbl">불명예 ${h.shame.length}</span></summary><div class="hall-grid">${h.shame.map(card).join('')}</div></details>` : ''}</div>
      <div class="card"><h3>회사 기록</h3><table class="tbl hall-co">${co}</table><p class="note">연 매출·이익은 연 기록과 장부로 셉니다. 최고 평판은 해마다의 평판 변화로 거꾸로 셈한 연말 값과 지금 값 중 가장 높은 값입니다.</p></div>`;
  }
  /** 1.5.0 이 판의 시작 선택(시작 연도·조건)과 도전 과제 진행. 기본 선택(1970년·보통·도전 없음)이면 비운다 */
  function startCard(): string {
    const s = game!.state, st = Q.startOf(s), ch = Q.challengeInfo(s);
    if (!s.start) return '';
    const cond = config.newGame.conditions[st.condition].name;
    return `<div class="card st-start"><p class="lbl">이 판의 시작</p><p><b>${st.year}년 시작</b> · ${esc(diffName(s.difficulty))} · ${esc(cond)}</p>
      ${ch.length ? `<p class="lbl" style="margin-top:8px">도전 과제</p><ul class="ch-list">${ch.map((c) => `<li><b>${esc(c.name)}</b> <span class="chip on">지켜지는 중 · ${c.years ? `${c.years}년째` : '첫해'}</span><small>${esc(c.desc)}</small></li>`).join('')}</ul>` : '<p class="hint">도전 과제 없음</p>'}</div>`;
  }
  function statsTab(): string {
    const nm = <T extends { id: string; name: string }>(list: T[]) => (id: string) => list.find((x) => x.id === id)?.name ?? id;
    return V.statsMain(game!.state, statsRange, { pt: nm(POWERTRAINS), body: nm(BODIES) }, startCard());
  }
  /** 1.5.0 지난 판의 차(이 기기에 모아 둔 목록) */
  const pastRuns = () => { const id = game ? PN.runId(game.state) : ''; return PN.loadPast().filter((r) => r.id !== id); };
  const pastLine = (c: PN.PastCar) => `${esc(BODIES.find((b) => b.id === c.body)?.name ?? c.body)} · ${esc(segName(c.segment))} · ${c.year}년 출시 · ${num(c.sold)}대`;
  function pastTab(): string {
    const runs = pastRuns();
    return `<div class="card past-card"><h3>지난 판의 차 ${ib('term:지난 판의 차')} <small class="hint">${runs.length}판</small></h3>
      ${runs.length ? runs.map((r) => `<details class="past-run" open><summary><b>${esc(r.company)}</b> <small class="hint">${r.startYear}년 시작 · 차종 ${r.cars.length}개</small></summary><div class="tblwrap"><table class="tbl"><tr><th>이름</th><th>차체 · 고객층 · 출시 · 누적 판매</th></tr>${[...r.cars].sort((a, b) => b.sold - a.sold).map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${pastLine(c)}</td></tr>`).join('')}</table></div></details>`).join('')
        : '<p class="hint" style="margin-top:8px">아직 모아 둔 이름이 없습니다. 차를 출시한 판을 저장하면 그 판의 차 이름이 이 기기에 모입니다.</p>'}
      ${runs.length ? '<div class="row end" style="margin-top:10px"><button class="btn danger" data-act="pastClear">목록 비우기</button></div>' : ''}</div>`;
  }
  /** [지난 이름] 고르기 창: 판별로 묶음(최근 판 순) 또는 전부 많이 팔린 순. 지금 판에서 쓰는 이름은 흐리게(고를 수 없음) */
  function showPastPick(target: string): void {
    const s = game!.state, used = new Set([...s.nameplates.map((n) => n.name), ...s.projects.map((p) => p.name)]), runs = pastRuns();
    const item = (c: PN.PastCar, co = '') => { const u = used.has(c.name); return `<button class="past-it" data-act="pastPick" data-k="${esc(target)}" data-v="${esc(c.name)}" ${u ? 'disabled aria-disabled="true"' : ''}><b>${esc(c.name)}</b><small>${pastLine(c)}${co ? ` · ${esc(co)}` : ''}${u ? ' · 지금 판에서 쓰는 중' : ''}</small></button>`; };
    const body = !runs.length ? '<p class="hint">아직 모아 둔 이름이 없습니다.</p>' : pastSort === 'sold'
      ? `<div class="past-list">${runs.flatMap((r) => r.cars.map((c) => ({ c, co: r.company }))).sort((a, b) => b.c.sold - a.c.sold).map((x) => item(x.c, x.co)).join('')}</div>`
      : runs.map((r) => `<p class="lbl" style="margin-top:8px">${esc(r.company)} <small class="hint">${r.startYear}년 시작</small></p><div class="past-list">${r.cars.map((c) => item(c)).join('')}</div>`).join('');
    $('#pick-body').innerHTML = `<h3>지난 판의 차 이름 ${ib('term:지난 판의 차')}</h3><div class="seg" role="group" aria-label="정렬" style="margin:8px 0">${([['recent', '최근 판 순'], ['sold', '많이 팔린 순']] as const).map(([k, l]) => `<button data-act="pastSort" data-k="${esc(target)}" data-v="${k}" aria-pressed="${pastSort === k}">${l}</button>`).join('')}</div>
      <div class="past-scroll">${body}</div><div class="row end" style="margin-top:10px"><button class="btn" data-act="pastClose">닫기</button></div>`;
    $('#pick').hidden = false; renderTop();
  }
  const pastBtn = (target: string) => `<button class="btn past-btn" data-act="pastOpen" data-v="${target}">지난 이름</button>`;
  function recordsView(): string {
    const tabs = `<div class="seg cotabs rectabs" role="tablist" aria-label="기록">${REC_TABS.map(([k, l]) => `<button role="tab" data-act="rectab" data-v="${k}" aria-selected="${recTab === k}">${l}</button>`).join('')}</div>`;
    return tabs + (recTab === 'combo' ? comboTab() : recTab === 'news' ? newsTab() : recTab === 'years' ? yearsTab() : recTab === 'hall' ? hallTab() : recTab === 'awards' ? awardsTab() : recTab === 'stats' ? statsTab() : recTab === 'past' ? pastTab() : carsTab());
  }
  /** 지난 연 보고서 목록(0.8.0): 누르면 그해 보고서 창 */
  function yearsTab(): string {
    const ys = Q.reportYears(game!.state);
    return `<div class="card years-card"><h3>연 보고서 <small class="hint">${ys.length}건</small></h3>${ys.length ? `<div class="yr-years">${ys.map((y) => { const m = Q.yearReport(game!.state, y).money; return `<button class="btn" data-act="yearOpen" data-v="${y}"><b>${y}년</b><small>${m ? `판매 ${num(m.sold)}대 · 이익 ${money(m.profit, true)}` : ''}</small></button>`; }).join('')}</div>` : '<p class="hint" style="margin-top:8px">첫 해가 끝나면(12월 결산 뒤) 연 보고서가 여기 쌓입니다.</p>'}</div>${I.decadeButtons(game!.state)}`;
  }
  /** 조합 노트(5.5): 차체(세로) × 고객층(가로). 출시해 본 칸만 궁합·차 이름·평론, 나머지는 "?" */
  function comboTab(): string {
    const s = game!.state, notes = Q.comboNotes(s), open = new Set(Q.bodiesAt(s).map((b) => b.id));
    const cell = (b: string, g: string) => { const n = notes.find((x) => x.body === b && x.segment === g); return n ? `<td class="cn k${'◎○△×'.indexOf(n.mark)}"><b>${n.mark}</b><small>${esc(n.carName)}</small><small>평론 ${score(n.reviewAvg)}</small></td>` : '<td class="cn q">?</td>'; };
    return `<div class="card combo-card"><h3>조합 노트${ib('term:궁합')} <small class="hint">알아낸 조합 ${notes.length} / ${BODIES.length * SEGMENTS.length}칸</small></h3>
      <p class="hint" style="margin:6px 0 10px">차체와 고객층의 궁합(◎ 잘 맞음 · ○ 무난 · △ 덜 맞음 · × 안 맞음)은 그 조합으로 차를 한 번 출시해 봐야 알 수 있습니다. 칸에는 처음 낸 차와 평론이 적힙니다.</p>
      <div class="tblwrap"><table class="combo"><tr><th></th>${SEGMENTS.map((g) => `<th>${esc(g.name)}</th>`).join('')}</tr>${BODIES.map((b) => `<tr class="${open.has(b.id) ? '' : 'off'}"><th>${esc(b.name)}${open.has(b.id) ? '' : '<small>연구 필요</small>'}</th>${SEGMENTS.map((g) => cell(b.id, g.id)).join('')}</tr>`).join('')}</table></div></div>`;
  }
  /** 뉴스 목록(최신이 위): 예고·시작·끝·규제·결정 결과 구분, 누르면 신문 한 장 */
  function newsTab(): string {
    const list = Q.newsLog(game!.state), up = Q.upcomingEvents(game!.state);
    return `<div class="card news-card"><h3>뉴스 <small class="hint">${list.length}건</small></h3>
      ${up.length ? `<div class="warnbox" style="margin:8px 0">다가오는 사건: ${up.map((x) => `${esc(x.warn)}(약 ${x.monthsLeft}개월 뒤)`).join(' / ')}</div>` : ''}
      ${list.length ? `<ul class="newslist">${list.map((n, i) => { const k = n.category; return `<li><button class="nl k-${k}" data-act="newsOpen" data-v="${i}"><span class="chip">${NEWS_KIND[k]}</span><small>${esc(n.date)}</small><span class="nt">${esc(newsLine(n.text))}</span></button></li>`; }).join('')}</ul>` : '<p class="hint" style="margin-top:8px">아직 뉴스가 없습니다. 시대 사건의 예고·시작·끝과 회사에 생긴 일이 여기 모입니다.</p>'}</div>`;
  }
  function carsTab(): string {
    const s = game!.state, gens = allGens(s);
    if (!gens.length) return `<div class="card"><div class="rec-co">${myLogo(36)}<b>${esc(s.companyName)}</b></div><h3>기록</h3><p class="hint">아직 낸 차가 없습니다. 차를 출시하면 그 순간의 사진과 평론, 판매 기록이 여기 남습니다.</p></div>`;
    const total = gens.reduce((a, g) => a + g.totalSold, 0);
    // 1.0.0 정렬·필터(기기에 기억): 출시 순(첫 세대)·많이 팔린 순·이익(개발비 뺀) 큰 순·평론(가장 좋은 세대) 높은 순·판매 기간 긴 순
    const onSale = (n: typeof s.nameplates[number]) => n.generations.some((g) => g.status !== 'discontinued');
    const val = (n: typeof s.nameplates[number]): number => linView.sort === 'sold' ? n.generations.reduce((a, g) => a + g.totalSold, 0) : linView.sort === 'profit' ? Q.nameplatePnL(s, n.id)?.net ?? 0
      : linView.sort === 'review' ? Math.max(...n.generations.map((g) => g.reviewAvg)) : linView.sort === 'long' ? n.generations.reduce((a, g) => a + g.sales.length, 0) : -n.generations[0].launchMonth;
    const nps0 = [...s.nameplates].filter((n) => n.generations.length && (linView.filter === '' || (linView.filter === 'on') === onSale(n))).sort((a, b) => val(b) - val(a) || a.id - b.id);
    const nps = nps0.flatMap((n) => n.baseOf !== undefined && nps0.some((x) => x.id === n.baseOf) ? [] : [n, ...(n.baseOf === undefined ? nps0.filter((x) => x.baseOf === n.id) : [])]); // 1.3.0 파생 차종은 바탕 차종 바로 아래
    const bar = `<div class="card lin-bar"><div class="seg lin-sort" role="group" aria-label="정렬">${LIN_SORTS.map(([k, l]) => `<button data-act="linSort" data-v="${k}" aria-pressed="${linView.sort === k}">${l}</button>`).join('')}</div>
      <div class="s-chips" role="group" aria-label="거르기">${([['', '전체'], ['on', '판매 중'], ['off', '단종']] as const).map(([k, l]) => `<button class="s-chip" data-act="linFilter" data-v="${k}" aria-pressed="${linView.filter === k}">${l}</button>`).join('')}</div></div>`;
    const genCard = (l: ReturnType<typeof Q.lineage>[number]) => {
      const g = Q.generationById(s, l.generationId)!, ph = ui.photos[g.id], lift = g.editions.find((e) => e.kind === 'facelift'), lph = lift ? ui.photos[`e${lift.id}`] : undefined;
      return `<article class="rec" data-gen="${g.id}"><div class="ph">${ph ? `<img src="${ph}" alt="${esc(nameOf(g))} ${g.number}세대 출시 사진">` : thumb(genLook(g, g.editions[0].id), -0.65, 320, 200)}
        ${lift ? `<div class="lift-ph" title="페이스리프트 뒤 모습">${lph ? `<img src="${lph}" alt="페이스리프트 뒤 사진">` : thumb(genLook(g, lift.id), -0.65, 160, 100)}<span>바뀐 얼굴</span></div>` : ''}</div>
        <div class="bd"><h3>${l.number}세대 <small class="hint">${bodyById(g.body).name}</small></h3>
        <div class="meta">${Q.monthLabel(l.launchMonth)} 출시 · 평론 ${score(l.reviewAvg)} · 누적 ${num(l.totalSold)}대<br>${esc(EQ.equipLine(edEquip(currentEdition(g))))}${lift ? `<br>페이스리프트 ${Q.monthLabel(monthOf(lift.launchWeek))}` : ''}</div>
        <div class="row">${g.masterpiece ? '<span class="chip gold">명차</span>' : ''}<span class="chip ${l.status === 'onSale' ? 'on' : ''}">${esc(l.label)}</span>${lift ? '<span class="chip">페이스리프트</span>' : ''}${g.recalls ? `<span class="chip bad">리콜 ${g.recalls}번</span>` : ''}${l.variant ? `<span class="chip">${esc(Q.variantById(l.variant)?.name ?? '')}</span>` : ''}</div>
        ${l.fromGen !== null ? `<p class="hint rec-from">${esc(derivLine(g))}</p>` : ''}
        ${l.critiques.length ? `<details class="rec-crit"><summary>평론가 시승기 ${l.critiques.length}명</summary>${critiqueList(g.id)}</details>` : ''}${l.wins.length ? `<details class="rec-crit"><summary>직원 성과 ${l.wins.length}건</summary>${winsList(l.wins)}</details>` : ''}</div></article>`;
    };
    return `<div class="card"><div class="rec-co">${myLogo(36)}<b>${esc(s.companyName)}</b></div><h3>지금까지 낸 차 ${gens.length}대</h3><div class="kpis">${kpi('누적 판매', `${qty(total)}<span>대</span>`)}${kpi('차종', `${nps.length}<span>개</span>`)}${kpi('명차', `${gens.filter((g) => g.masterpiece).length}<span>대</span>`)}${kpi('평판', String(Math.round(s.reputation)))}</div></div>
      ${bar}${nps.length ? '' : '<div class="card"><p class="hint">조건에 맞는 차종이 없습니다.</p></div>'}${nps.map((n) => `<div class="card lineage-card${n.baseOf !== undefined ? ' deriv' : ''}" data-np="${n.id}" id="np-${n.id}"><p class="lbl">${n.baseOf !== undefined ? `↳ 「${esc(s.nameplates.find((x) => x.id === n.baseOf)?.name ?? '')}」의 파생 모델 · ${esc(Q.variantById(n.variant)?.name ?? '')}` : '차종 계보'}</p><h3>${esc(n.name)} <small class="hint">${n.generations.length}세대 · 누적 ${num(n.generations.reduce((a, g) => a + g.totalSold, 0))}대 · 이름값 ${EQ_WORD(Q.nameplateEquity(s, n.id))}</small></h3>
        ${I.nameplatePnlLine(s, n.id)}<div class="lineage">${Q.lineage(s, n.id).map(genCard).join('<span class="arrow" aria-hidden="true">→</span>')}</div></div>`).join('')}`;
  }

  // ----- 파산 -----
  function showGameOver(): void {
    gameOverShown = true; $('#toasts').innerHTML = '';
    const s = game!.state, months = Math.floor(s.week / config.time.weeksPerMonth), gens = allGens(s);
    title.className = 'cover over'; title.hidden = false;
    title.innerHTML = `<div class="inner"><div class="eyebrow"><i></i>${esc(s.companyName)} · ${esc(game!.dateLabel)}</div><div class="big">회사가 파산했습니다</div><p class="tag">현금이 ${diffOf(s).bankruptcyMonths}개월 넘게 마이너스였습니다.</p>
      <div class="kpis">${kpi('버틴 기간', `${Math.floor(months / 12)}<span>년</span> ${months % 12}<span>개월</span>`)}${kpi('낸 차', `${gens.length}<span>대</span>`)}${kpi('누적 판매', `${num(gens.reduce((a, g) => a + g.totalSold, 0))}<span>대</span>`)}</div>
      <button class="btn ${s.loan.bailoutUsed ? '' : 'ink'}" data-act="bailout" ${s.loan.bailoutUsed ? 'disabled' : ''}>${s.loan.bailoutUsed ? '구제 금융을 받을 수 없습니다' : `구제 금융 받고 계속하기(남은 ${bailInfo().left}번)`}</button>
      <p class="note">${bailInfo().line}. ${s.loan.bailoutUsed ? `${bailInfo().why} ` : `구제 금융을 받으면 현금이 0이 되고, 평판이 ${-config.bankruptcy.bailoutRep} 떨어지며, 대출 한도가 절반이 됩니다. `}이전 저장 칸을 불러와 다시 해 볼 수도 있습니다.</p>
      <div class="row"><button class="go" data-act="newGame" style="flex:1">새 게임</button><button class="btn" data-act="home" style="flex:1;min-height:56px">처음 화면(불러오기)</button></div></div><div class="ver">v${CAR_VERSION}</div>`;
    renderTop();
  }

  // ---------- 로고 만들기(새 게임 화면·메뉴) ----------
  /** 지금 꾸미는 로고: 새 게임 화면이면 초안, 게임 중이면 이 게임의 로고 */
  const logoTarget = (): LogoSpec => (!title.hidden && titleMode === 'new' ? logoDraft : ui.logo);
  function logoMaker(L: LogoSpec): string {
    const sw = (k: 'bg' | 'fg', list: string[]) => `<div class="lg-sw" role="group" aria-label="${k === 'bg' ? '바탕색' : '금속색'}">${list.map((c) => `<button class="lg-c" data-act="lg" data-k="${k}" data-v="${c}" aria-pressed="${L[k] === c}" aria-label="${c}"><i style="background:${c}"></i></button>`).join('')}</div>`;
    const shapes = (Object.keys(LOGO_SHAPES) as (keyof typeof LOGO_SHAPES)[]).map((k) => `<button class="lg-o" data-act="lg" data-k="shape" data-v="${k}" aria-pressed="${L.shape === k}" title="${LOGO_SHAPES[k]}">${logoSvg({ ...L, shape: k }, 34)}<small>${LOGO_SHAPES[k]}</small></button>`).join('');
    const marks = (Object.keys(LOGO_MARKS) as (keyof typeof LOGO_MARKS)[]).map((k) => `<button class="lg-o" data-act="lg" data-k="mark" data-v="${k}" aria-pressed="${L.mark === k}" title="${LOGO_MARKS[k]}">${logoSvg({ ...L, mark: k, text: k === 'text' && !L.text ? '가' : L.text }, 34)}<small>${LOGO_MARKS[k]}</small></button>`).join('');
    return `<div class="logo-maker"><div class="lg-head"><div class="lg-prev" aria-label="로고 미리 보기">${logoSvg(L, 72)}</div><div class="lg-side"><b>회사 로고</b><button class="btn" data-act="lgRand">무작위</button><label class="lg-bd"><input type="checkbox" id="lg-border" ${L.border ? 'checked' : ''}> 안쪽 테두리</label></div></div>
      <p class="lbl">엠블럼 틀</p><div class="lg-grid">${shapes}</div>
      <p class="lbl">바탕색</p>${sw('bg', LOGO_BG)}
      <p class="lbl">안쪽 문양</p><div class="lg-grid">${marks}</div>
      ${L.mark === 'text' ? `<label class="lbl" for="lg-text">이니셜(한두 글자, 한글·영문)</label><input class="namein lg-text" id="lg-text" type="text" maxlength="2" value="${esc(L.text)}" placeholder="가" autocomplete="off">` : ''}
      <p class="lbl">금속색(테두리·문양)</p>${sw('fg', LOGO_FG)}</div>`;
  }
  /** 로고를 바꾼 뒤: 만들기 칸만 다시 그리고(입력 중인 회사 이름은 그대로) 상단바도 바꾼다 */
  function logoChanged(light = false): void {
    const box = document.querySelector('.logo-maker'), L = logoTarget();
    if (box && light) { // 글자 입력 중: 입력 칸을 바꾸지 않는다(한글 조합이 끊기지 않게)
      box.querySelector('.lg-prev')!.innerHTML = logoSvg(L, 72);
      const tb = box.querySelector('[data-k="mark"][data-v="text"]'); if (tb) tb.innerHTML = `${logoSvg({ ...L, mark: 'text', text: L.text || '가' }, 34)}<small>${LOGO_MARKS.text}</small>`;
      for (const b of box.querySelectorAll<HTMLElement>('[data-k="shape"]')) { const k = b.dataset.v as LogoSpec['shape']; b.innerHTML = `${logoSvg({ ...L, shape: k }, 34)}<small>${LOGO_SHAPES[k]}</small>`; } // 틀 미리 보기에도 바꾼 이니셜
    } else if (box) box.outerHTML = logoMaker(L);
    const mini = document.querySelector('.lg-mini'); if (mini) mini.innerHTML = logoSvg(L, 30);
    if (game) renderTop();
  }
  function showLogoSheet(): void {
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>메뉴</div><h2>회사 로고 바꾸기</h2>${logoMaker(ui.logo)}<div class="row end" style="margin-top:12px"><button class="btn" data-act="settings">← 설정</button><button class="btn ink" data-act="closeSheet">완료</button></div>`;
    sheet.hidden = false; renderTop();
  }

  // ---------- 1.5.0 새 게임 선택지(시작 연도·조건·도전 과제) ----------
  /** 고른 시작 연도·조건으로 시작할 때의 한 줄(시작 현금은 고른 난이도 기준) */
  const nsLine = () => {
    const Y = config.newGame.byYear[String(nsYear) as keyof typeof config.newGame.byYear], cash = config.difficulty[diffSel].cash * Y.cash * config.newGame.conditions[nsCond].cash;
    return `${nsYear}년 1월 시작 · 시작 현금 ${money(cash)} · 본사 ${Y.hq}등급 · 공장 ${Y.factory}등급 · 직원 ${config.start.roles.length + Y.roles.length}명${nsYear > config.time.startYear ? ` · ${nsYear - config.newGame.techSlackYears}년까지 나온 기술은 연구를 마친 상태` : ''}`;
  };
  function newGameOpts(): string {
    const C = config.newGame;
    return `<div id="ns-box"><p class="lbl" style="margin-top:6px">시작 연도</p><div class="seg ns-year" role="group" aria-label="시작 연도">${Q.START_YEARS.map((y) => `<button data-act="nsYear" data-v="${y}" aria-pressed="${nsYear === y}">${y}년${y === config.time.startYear ? '<small>기본</small>' : ''}</button>`).join('')}</div>
      <p class="lbl">시작 조건</p><div class="seg ns-cond" role="group" aria-label="시작 조건">${Q.CONDITIONS.map((k) => `<button data-act="nsCond" data-v="${k}" aria-pressed="${nsCond === k}">${esc(C.conditions[k].name)}<small>현금 ×${C.conditions[k].cash}</small></button>`).join('')}</div>
      <p class="hint ns-line" id="ns-line">${esc(nsLine())}</p>
      <details class="ns-chal"${nsChal.size ? ' open' : ''}><summary>도전 과제 <small>(선택, 여러 개 가능 · 보상 없이 기록에만 남습니다)</small></summary><div class="ns-cg">${Q.CHALLENGES.map((k) => { const c = C.challenges[k], off = !!c.minYear && nsYear < c.minYear;
        return `<label class="chk ns-c${off ? ' off' : ''}"><input type="checkbox" data-ch="${k}" ${nsChal.has(k) && !off ? 'checked' : ''} ${off ? 'disabled' : ''}> <b>${esc(c.name)}</b><small>${esc(c.desc)}</small></label>`; }).join('')}</div></details></div>`;
  }
  /** 연도·조건을 바꾼 뒤: 입력 중인 회사 이름·시드는 그대로 두고 선택지 칸만 다시 그린다 */
  function nsChanged(): void {
    for (const k of Q.CHALLENGES) { const m = config.newGame.challenges[k].minYear; if (m && nsYear < m) nsChal.delete(k); }
    const box = document.getElementById('ns-box'), open = !!box?.querySelector<HTMLDetailsElement>('.ns-chal')?.open;
    if (box) box.outerHTML = newGameOpts();
    if (open) document.querySelector<HTMLDetailsElement>('.ns-chal')!.open = true; // 펼친 도전 과제는 펼친 채로
  }

  // ---------- 처음 화면 ----------
  async function showTitle(): Promise<void> {
    sheet.hidden = true;
    const saves = await S.list(), newest = saves.filter((x) => x.key !== 'backup').sort((a, b) => b.when.localeCompare(a.when))[0];
    const info = (x: S.SlotInfo) => `${esc(x.company)} · ${esc(diffName(x.difficulty))} · ${esc(Q.dateLabel(x.week))} · 차 ${x.cars}종`;
    const home = `<div class="row">${newest ? `<button class="go" data-act="continue" data-v="${newest.key}">이어 하기 <small style="font-weight:600;font-size:12px">${info(newest)}</small></button>` : ''}<button class="go ${newest ? 'dark' : ''}" data-act="titleNew">새 게임</button></div>
      ${saves.length ? `<p class="lbl" style="margin-top:8px">저장된 게임</p><div class="menu-slots">${saves.map((x) => `<div class="slot wl">${logoSvg(x.logo, 32)}<div><b>${slotName(x.key)}</b><small>${info(x)} · ${esc(x.when.slice(0, 16).replace('T', ' '))}</small></div><button class="btn" data-act="loadSlot" data-v="${x.key}">불러오기</button></div>`).join('')}</div>` : ''}
      <button class="btn" data-act="import" style="margin-top:4px">파일에서 불러오기</button>`;
    // 이름·난이도·[회사 세우기]가 첫 화면에 보이게 로고 꾸미기는 접어 둔다
    const form = `<div class="ns-cols"><div class="ns-col"><label for="t-co">회사 이름</label><input class="namein" id="t-co" type="text" maxlength="16" placeholder="새 회사" autocomplete="off">
      <details class="logo-det"><summary><span class="lg-mini">${logoSvg(logoDraft, 30)}</span>회사 로고 꾸미기 <small>(나중에 메뉴에서도 바꿀 수 있습니다)</small></summary>${logoMaker(logoDraft)}</details>
      <p class="lbl" style="margin-top:6px">난이도</p><div class="opts diffs">${Q.difficultyInfo().map((d) => `<button class="opt diff" data-act="diff" data-v="${d.id}" aria-pressed="${diffSel === d.id}"><b>${esc(d.name)}${d.isDefault ? ' <small>(기본)</small>' : ''}</b><small>${esc(d.desc)}</small><small>시작 현금 ${money(d.cash)} · 대출 기본 한도 ${money(d.loanBase)}</small><small>파산까지 ${d.bankruptcyMonths}개월 · 구제 금융 ${d.bailouts ? `${d.bailouts}번` : '없음'}</small></button>`).join('')}</div></div>
      <div class="ns-col">${newGameOpts()}
      <details class="seed-det"><summary>자세히: 시드(같은 시드면 같은 판)</summary><input class="namein" id="t-seed" type="text" inputmode="numeric" placeholder="비우면 무작위" autocomplete="off"></details>
      <button class="go" data-act="startNew">회사 세우기 <span aria-hidden="true">→</span></button><button class="btn" data-act="titleHome">돌아가기</button></div></div>`;
    title.innerHTML = `<div class="inner${titleMode === 'new' ? ' wide' : ''}"><div class="gname">${logoSvg(DEFAULT_LOGO, 64)}카 컴퍼니</div><p class="tag">${titleMode === 'new' ? '작은 자동차 회사를 세워 차를 기획·개발·출시해 판매하며 회사를 키웁니다. 1970년부터 시작하거나, 더 늦은 해를 골라 그 시대에 맞는 자금·기술로 시작할 수 있습니다.' : '1970년, 직원 4명의 작은 공장에서 시작합니다. 차를 기획·개발·출시해 판매하며 회사를 키웁니다.'}</p>${titleMode === 'new' ? form : home}<p class="note">게임 이름은 가칭입니다. 경쟁사 이름과 로고는 실제 브랜드를 본뜬 가상의 것입니다.</p></div><div class="ver">v${CAR_VERSION}</div>`;
    title.className = 'cover'; title.hidden = false; markMore(title);
    if (titleMode === 'new') $('#t-co').focus();
    renderTop();
    if (!syncChecked && sync?.id) { syncChecked = true; void syncCheck(false); } // 1.6.0 게임을 열 때 한 번
  }
  const slotName = (k: S.SlotKey) => (k === 'auto' ? '자동 저장' : k === 'backup' ? '연동 전 백업' : `저장 칸 ${k.slice(-1)}`);
  function adopt(g: Game, extra: S.UiExtra): void {
    game = g; ui = extra; screen = 'garage'; subView = null; garageSub = null; subSel = null; ordSet = null; // 3.1.0 운영 전환은 UI 상태(불러오면 본사 화면)
    draft = null; launch = null; lift = null; draftNote = '';
    restorePlan(extra.plan); garageId = -1; garageSum = true; cmpSel.clear(); gameOverShown = false; officeEvents.length = 0; thumbs.clear();
    coTab = 'sum'; recTab = 'cars'; staffSel = null; devSel = null; allocWhy = ''; staffPick = new Set();
    garagePrice.clear(); devLog.clear(); devPrev.clear(); lastPanel = ''; lastOv = ''; dirty = false; noteLog = []; noteSeen = noteId;
    logDev(); // 주간 기록은 화면 메모리에만 있어 불러오면 비므로, 지금 상태 한 줄로 시작한다
    candSeen.clear(); for (const c of g.state.candidates) candSeen.add(c.id); // 불러온 판에 이미 있던 후보는 알리지 않는다
    title.hidden = true; sheet.hidden = true; makeStage(); setSpeed(1);
    $('#toasts').innerHTML = ''; $('#toasts').classList.remove('open'); keyed.clear(); // 전 게임의 알림을 남기지 않는다
    render();
  }
  async function loadKey(k: S.SlotKey): Promise<void> {
    const d = await S.get(k);
    const r = d ? S.parse(d) : { ok: false as const, error: '빈 칸입니다' };
    if (!r.ok) return err(r.error);
    adopt(r.game, r.ui); { const n = slotName(k); toast(`${n}${josa(n, '을/를')} 불러왔습니다.`); }
  }
  function importFile(): void {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files?.[0]; if (!f) return;
      const r = S.parseText(await f.text());
      if (!r.ok) return err(r.error);
      if (game && title.hidden && dirty && !(await ask('마지막 저장 뒤의 진행은 사라집니다. 파일을 불러올까요?', '불러오기'))) return;
      adopt(r.game, r.ui); toast('파일에서 불러왔습니다');
    };
    inp.click();
  }

  // ---------- 메뉴(저장·불러오기·내보내기·설정·되돌리기·처음 화면) ----------
  async function showMenu(): Promise<void> {
    if (!game) return;
    const saves = await S.list(), by = new Map(saves.map((x) => [x.key, x]));
    const line = (k: S.SlotKey) => { const x = by.get(k); return x ? `${esc(x.company)} · ${esc(diffName(x.difficulty))} · ${esc(Q.dateLabel(x.week))} · ${esc(x.when.slice(0, 16).replace('T', ' '))}` : '비어 있음'; };
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>메뉴</div><h2>저장과 불러오기</h2><p class="hint menu-diff" style="margin:-4px 0 10px">이 게임의 난이도: <b>${esc(diffName(game.state.difficulty))}</b> (게임 중에는 바꿀 수 없습니다)</p><div class="menu-slots">
      ${S.SLOT_KEYS.map((k, i) => `<div class="slot"><div><b>저장 칸 ${i + 1}</b><small>${line(k)}</small></div><div class="row"><button class="btn ink" data-act="saveSlot" data-v="${k}">저장</button><button class="btn" data-act="loadSlot" data-v="${k}" ${by.has(k) ? '' : 'disabled'}>불러오기</button></div></div>`).join('')}
      <div class="slot"><div><b>자동 저장</b><small>${esc(saveWhen())} · ${line('auto')}</small></div><button class="btn" data-act="loadSlot" data-v="auto" ${by.has('auto') ? '' : 'disabled'}>불러오기</button></div></div>
      <div class="row" style="margin-top:10px"><button class="btn" data-act="export">파일로 내보내기</button><button class="btn" data-act="import">파일에서 가져오기</button></div>
      <p class="note">브라우저 저장소는 지워질 수 있으니 파일로 내보내 두는 것이 안전합니다.</p>
      ${syncBox()}
      ${undoLine()}
      <button class="btn menu-set" data-act="settings" style="width:100%;margin-top:10px">설정 <small>시간·알림·소리·저장·화면</small></button>
      <p class="note help-line">이 게임의 역사 사건과 시장 수치는 게임에 맞게 어림한 것이라 실제와 다를 수 있습니다.</p>
      <div class="row" style="margin-top:12px"><button class="btn" data-act="home">처음 화면으로</button><button class="btn ink" data-act="closeSheet">닫기</button></div>`;
    sheet.hidden = false; renderTop();
  }
  // ---------- 1.0.0 설정 화면: 시간(자동 멈춤)·알림(종류별)·소리·저장(자동 저장)·화면(로고·디버그). 값은 예전과 같은 기기 저장소 키 ----------
  const SET_TABS = [['time', '시간'], ['note', '알림'], ['decide', '결정'], ['sound', '소리'], ['save', '저장'], ['view', '화면']] as const;
  type SetTab = typeof SET_TABS[number][0];
  let setTab: SetTab = 'time';
  const onOff = (act: string, v: string, label: string, on: boolean, sub = '', dis = false) => `<div class="toggle"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span><button class="btn" data-act="${act}" data-v="${v}" aria-pressed="${on}" ${dis ? 'disabled' : ''}>${on ? '켜짐' : '꺼짐'}</button></div>`;
  const revealOn = () => { try { return localStorage.getItem(REVEAL_KEY) !== '0'; } catch { return true; } };
  function showSettings(t: SetTab = setTab): void {
    if (!game) return;
    setTab = t;
    const auto = lastAuto !== null ? Q.monthLabel(monthOf(lastAuto)) : '아직 없음';
    const body = t === 'time' ? `<p class="lbl">자동 멈춤</p><div class="set-list">${PAUSE_ITEMS.map(([k, n]) => onOff('autoPause', k, n, pauseOn[k])).join('')}</div>
        <p class="note">켜 둔 항목이 생기면 시간을 멈추고 알림을 띄웁니다. 끄면 알림만 띄우고 시간은 계속 흐릅니다. [다음 일까지]도 켜 둔 항목에서 멈춥니다.</p>`
      : t === 'note' ? `<p class="lbl">알림 유형</p><div class="set-list note-topics">${NOTE_CATS.slice(0, TOPIC_N).map(([k, n, f]) => onOff('noteCat', k, n, noteOn(k), f ? '끌 수 없습니다' : '', !!f)).join('')}</div>
        <p class="lbl">그 밖의 안내</p><div class="set-list">${NOTE_CATS.slice(TOPIC_N).filter(([k]) => k !== 'pauseStop').map(([k, n, f]) => onOff('noteCat', k, n, noteOn(k), f ? '끌 수 없습니다' : '', !!f)).join('')}</div>
        <p class="note">끈 유형은 화면에 뜨는 알림과 그 효과음만 나오지 않고, 상단 '할 일' 창의 알림 탭(지난 알림 기록)과 기록 탭에는 그대로 남습니다. 같은 주(빠른 배속이면 한꺼번에 지나간 여러 주)에 같은 유형 알림이 2개 이상 오면 "경쟁사 신차·동향 3건"처럼 한 알림으로 묶고, [펼쳐 보기]를 누르면 그 유형의 지난 알림 기록이 열립니다. 경고·결정 대기·시간을 멈춘 알림은 묶지 않습니다. 시간 멈춤은 시간 설정의 자동 멈춤으로 따로 정하며, 시간을 멈춘 때의 알림은 늘 띄웁니다.</p>
        <p class="lbl">할 일에서 다시 알리지 않는 종류</p>${todoMute.size ? `<div class="set-list todo-muted">${[...todoMute].map((k) => `<div class="toggle"><span>${esc(TODO_KIND_NAME[k as Q.TodoKind] ?? k)}</span><button class="btn" data-act="todoUnmute" data-v="${esc(k)}">다시 알리기</button></div>`).join('')}</div>` : '<p class="hint">없습니다. 할 일 서랍의 [다시 알리지 않기]로 종류별로 끌 수 있습니다.</p>'}`
      : t === 'decide' ? decideSet()
      : t === 'sound' ? soundSet()
      : t === 'save' ? `<p class="lbl">자동 저장 <small class="hint auto-last">마지막 자동 저장: ${auto}</small></p>
        <div class="seg auto-every" role="group" aria-label="자동 저장 간격">${SAVE_EVERY.map(([k, n]) => `<button data-act="saveEvery" data-v="${k}" aria-pressed="${saveSet.every === k}">${n}</button>`).join('')}</div>
        <div class="set-list">${onOff('saveBig', '', '큰 결정 뒤 저장', saveSet.big, '출시·개발 시작·증설·승급·해고·채용·임원 임명')}</div>
        <p class="note">끄지 않았으면 탭을 숨기거나 닫을 때도 저장합니다. 이 기기에 저장됩니다. 저장 칸과 파일 내보내기는 메뉴에 있습니다.</p>`
      : `<p class="lbl">화면</p><div class="set-list"><button class="btn" data-act="logoSheet" style="width:100%">회사 로고 바꾸기</button>${onOff('reveal', '', '출시 공개 장면', revealOn(), '출시할 때 무대의 공개 연출(누르면 건너뜀)')}${onOff('debug', '', '디버그 표시', debugOn, '화면 속도·주 번호·시드')}</div>`;
    sheetBody.innerHTML = `<div class="settings"><div class="eyebrow"><i></i>메뉴 · 설정</div><h2>설정</h2><div class="seg set-tabs" role="tablist" aria-label="설정 묶음">${SET_TABS.map(([k, n]) => `<button role="tab" data-act="setTab" data-v="${k}" aria-selected="${t === k}">${n}</button>`).join('')}</div>
      <div class="set-body" data-tab="${t}">${body}</div><p class="note">${t === 'decide' ? '결정 설정은 지금 판에 저장됩니다(판마다 따로). 나머지 설정은 이 기기에 저장되며 모든 게임에 함께 쓰입니다.' : '설정은 이 기기에 저장되며 모든 게임에 함께 쓰입니다.'}</p>
      <div class="row end" style="margin-top:12px"><button class="btn" data-act="menuBack">← 메뉴</button><button class="btn ink" data-act="closeSheet">닫기</button></div></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 3.7.0 최근 자동 승인 기록(뉴스에서). 없으면 빈 문자열 */
  const autoLogHtml = () => { const l = Q.autoLog(game!.state); return l.length ? `<ul class="auto-log">${l.map((x) => `<li><small class="nd">${esc(Q.dateLabel(x.week))}</small> ${esc(x.text.replace(/^자동 승인: /, ''))}</li>`).join('')}</ul>` : ''; };
  /** 3.7.0 설정 › 결정: 종류별 자동 승인, 모두 켜기·끄기, 안전선, 최근 기록 */
  function decideSet(): string {
    const s = game!.state, all = Q.AUTO_KINDS.every((k) => Q.autoOn(s, k.id)), none = !Q.AUTO_KINDS.some((k) => Q.autoOn(s, k.id)), pct = Math.round(config.autoDecide.guardShare * 100);
    const rule = (k: typeof Q.AUTO_KINDS[number]) => { // 3.7.1 지금 정한 답과 한 줄 효과
      const ans = Q.autoAnswer(s, k.id), init = ans === Q.autoInitial(k) ? '(기본 선택)' : '';
      if (ans === 'rule') return `임원 위임과 같은 규칙으로 고릅니다${init}${k.id === 'priceWar' ? ': 버틸 때 줄어드는 판매가 인하 폭보다 크면 따라 내림' : ': 그 직원 능력이 같은 직무 평균 이상이면 붙잡음'}`;
      const c = k.choices[ans]; return `「${c.label}」${josa(c.label, '을/를')} 고릅니다${init}: ${c.result}`;
    };
    const pick = (k: typeof Q.AUTO_KINDS[number]) => { const ans = Q.autoAnswer(s, k.id), init = Q.autoInitial(k);
      const opts: [number | 'rule', string][] = [...(k.rule === 'exec' ? [['rule', '규칙대로'] as [number | 'rule', string]] : []), ...k.choices.map((c, i) => [i, c.label] as [number, string])];
      return `<div class="seg auto-pick" role="group" aria-label="${esc(k.name)}: 자동으로 고를 답">${opts.map(([v, l]) => `<button data-act="autoPick" data-k="${esc(k.id)}" data-v="${v}" aria-pressed="${ans === v}">${esc(l)}${v === init ? '<small>기본 선택</small>' : ''}</button>`).join('')}</div>`; };
    const log = autoLogHtml();
    return `<p class="lbl">결정 자동 승인 ${ib('term:결정 자동 승인')}</p><div class="row auto-all"><button class="btn" data-act="autoAll" data-v="1" ${all ? 'disabled' : ''}>모두 켜기</button><button class="btn" data-act="autoAll" data-v="0" ${none ? 'disabled' : ''}>모두 끄기</button></div>
      <div class="set-list auto-kinds">${Q.AUTO_KINDS.map((k) => `<div class="auto-kind">${onOff('autoKind', k.id, k.name, Q.autoOn(s, k.id), esc(rule(k)))}${pick(k)}</div>`).join('')}</div>
      <p class="lbl">안전선</p><div class="set-list">${onOff('autoGuard', '', '큰돈이 드는 결정은 묻기', Q.autoGuardOn(s), `고른 선택지의 지출이 지금 현금의 ${pct}% 이상이거나 현금이 모자라면 자동으로 하지 않고 결정 창을 띄웁니다`)}</div>
      <p class="note">켠 종류의 결정은 창을 띄우지 않고 생기자마자 처리하며 시간도 멈추지 않습니다. 결과는 '자동 승인' 알림과 뉴스에 남습니다. 임원이 위임으로 처리하는 결정은 지금처럼 임원이 처리합니다.</p>
      <p class="lbl">최근 자동 승인</p>${log || '<p class="hint">아직 없습니다.</p>'}`;
  }
  const saveWhen = () => saveSet.every === 'off' ? '자동 저장 꺼짐' : `${SAVE_EVERY.find(([k]) => k === saveSet.every)![1]} 저장`;
  /** 메뉴의 되돌리기 한 줄(같은 주 안의 직전 조작) */
  const undoLine = () => { const u = Q.undoInfo(game!.state); return `<button class="btn undo-line" data-act="undo" ${u.available ? '' : 'disabled'} style="width:100%;margin-top:10px">직전 조작 되돌리기${u.available ? ` · ${esc(u.label)}` : ' · 없음(같은 주 안의 조작만)'}</button>`; };
  /** 메뉴의 소리 설정: 음량 슬라이더 3개, 음소거, 주 넘김 소리. 값은 sound.set()이 이 기기에 저장한다 */
  const SND_LEVELS = [['master', '전체 음량'], ['sfx', '효과음'], ['music', '배경 음악']] as const;
  function soundSet(): string {
    const st = sound.settings(), sw = (k: 'muted' | 'weekTick', n: string) => onOff('snd', k, n, st[k]);
    return `<p class="lbl">소리</p><div class="snd-set">${SND_LEVELS.map(([k, n]) => `<label class="snd-row"><span>${n}</span><input type="range" class="snd-r" data-k="${k}" min="0" max="100" step="5" value="${Math.round(st[k] * 100)}"><b>${Math.round(st[k] * 100)}%</b></label>`).join('')}
      ${sw('muted', '음소거')}${sw('weekTick', '주 넘김 소리(한 주가 지날 때마다 짧게)')}</div>
      <p class="note">이 기기에 저장됩니다. 상단바의 스피커 버튼으로도 소리를 끄고 켤 수 있습니다.</p>`;
  }
  // ---------- 개발자 메뉴(시험용): 상단바 로고를 두 번 톡 ----------
  const DEV_CHEATS = [['cash', '현금 +500억'], ['reputation', '평판 +10'], ['finishResearch', '진행 중 연구 즉시 완료'], ['finishDev', '진행 중 개발 즉시 완료'], ['restStaff', '직원 컨디션 회복']] as const;
  function showDevMenu(): void {
    if (!game || !title.hidden) return;
    reviewTimers.forEach(clearTimeout); reviewTimers = [];
    sheetBody.innerHTML = `<div class="eyebrow"><i></i>개발자 메뉴 (시험용)</div><h2>개발자 메뉴</h2><div class="menu-slots dev-menu">${DEV_CHEATS.map(([k, n]) => `<button class="btn" data-act="devCheat" data-v="${k}">${n}</button>`).join('')}<button class="btn" data-act="devYear">1년 건너뛰기(48주)</button></div>
      <div class="row end" style="margin-top:12px"><button class="btn ink" data-act="closeSheet">닫기</button></div>`;
    sheet.hidden = false; renderTop();
  }
  /** 내보내기 파일 이름: "카컴퍼니-한빛자동차-1973년04월.json"(파일 이름에 못 쓰는 글자는 뺀다) */
  const saveFileName = () => { const s = game!.state, y = yearOf(s.week), m = (monthOf(s.week) % 12) + 1; return `카컴퍼니-${s.companyName.replace(/[\\/:*?"<>|\s]+/g, '') || '회사'}-${y}년${String(m).padStart(2, '0')}월.json`; };
  function download(name: string, text: string): void {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- 조작 ----------
  /** 명령이 성공했을 때의 소리(누른 버튼의 data-act 기준). 실패는 err()가 error 소리 */
  const ACT_SFX: Record<string, Sfx> = { startDev: 'devStart', startLift: 'devStart', dvStart: 'devStart', doLaunch: 'launch', hire: 'hire', fire: 'fire', train: 'train', upgradeHQ: 'hqUpgrade', expandFactory: 'cashOut', borrow: 'cashIn', repay: 'cashOut', retrofit: 'cashOut' };
  let curAct = '';
  let dirty = false; // 마지막 저장·불러오기 뒤에 진행·변경이 있었나(불러오기 경고용)
  function run(r: CommandResult): boolean {
    if (!r.ok) { err(r.reason); return false; }
    if (ACT_SFX[curAct] && !(curAct === 'doLaunch' && revealWanted(stage)) && !(ACT_TOPIC[curAct] && !noteOn(ACT_TOPIC[curAct]))) sfx(ACT_SFX[curAct]); // 1.3.0 끈 유형의 조작 효과음은 내지 않는다 // 출시 공개 장면이 켜져 있으면 효과음은 장면이 불을 켤 때 낸다
    dirty = true;
    if (saveSet.big && BIG_ACTS.has(curAct)) autoSave(); // 0.8.0 큰 결정 뒤 자동 저장
    if (curAct !== 'doLaunch') for (const e of r.events ?? []) if (e.kind === 'reputation') onEvent(e); // 출시는 평론 창 배지가 평판 변화를 보여 준다
    return true;
  }
  async function act(a: string, el: HTMLElement): Promise<void> {
    const v = el.dataset.v ?? '', s = game?.state;
    switch (a) {
      case 'tab': if (v === 'garage') garageSum = true; go(v === 'dev' ? devScreen() : v as Screen); return; // 기획 초안·출시 준비 값은 탭을 옮겨도 남긴다
      case 'plan': // 8.7: 차종이 있으면 먼저 어디서 시작할지 고른다. 기획 중인 초안이 있으면 그것을 이어서
        if (!s) return;
        if (draft || lift) { go(draft ? 'plan' : 'lift'); return; }
        { const b = busyReason(); if (b) return err(b); }
        if (Q.planEntries(s).nameplates.length) { startSel = null; go('start'); return; }
        draft = newDraft(); planTab = draft.mode === 'step' ? 'body' : 'sum'; go('plan'); return;
      case 'pickNew': if (!(await dropDraft())) return; draft = newDraft(); planTab = draft.mode === 'step' ? 'body' : 'sum'; go('plan'); return;
      case 'startSel': startSel = v as 'full' | 'lift'; render(); document.getElementById('np-list')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); return;
      case 'goFull': {
        if (!s) return; const id = Number(el.dataset.id), e = elig(Q.fullChangeEligibility(s, id));
        if (!e.ok) return err(e.reason ?? '');
        if (draft?.nameplateId === id) { go('plan'); return; }
        if (!(await dropDraft())) return;
        draft = newDraft(id); planTab = 'sum'; go('plan'); return; // 0.8.0 전작 값을 물려받은 요약에서 시작
      }
      case 'goLift': {
        if (!s) return; const id = Number(el.dataset.id), e = elig(Q.faceliftEligibility(s, id)), g = Q.generationById(s, id);
        if (!e.ok || !g) return err(e.reason ?? '');
        if (lift?.genId === id) { go('lift'); return; }
        if (!(await dropDraft())) return;
        const ed = currentEdition(g), opts = new Set(Q.optionsAt(s).map((o) => o.id));
        lift = { genId: id, faceSeed: LP.firstDistinct('face', liftCtx(g)), equip: Object.fromEntries(Object.entries(edEquip(ed)).filter(([o]) => opts.has(o))), options: ed.options.filter((o) => opts.has(o)), tier: ed.tier, team: Q.faceliftPreview(s, id, { options: ed.options, tier: ed.tier })?.recommendedTeam ?? idleDev().map((x) => x.id) }; // 기본은 추천 팀(디자이너·테스터)
        go('lift'); return;
      }
      // ---- 1.3.0 파생 모델 ----
      case 'goDerive': {
        if (!s) return; const b = busyReason(); if (b) return err(b);
        const id = Number(el.dataset.id); if (Q.generationById(s, id)?.status !== 'onSale') return err('판매 중인 세대만 바탕으로 쓸 수 있습니다.');
        if (v) { const o = Q.derivativeOptions(s, id).find((x) => x.id === v); if (!o?.ok) return err(o?.reason ?? '만들 수 없습니다.'); }
        openDerive(id, v || null); return;
      }
      case 'dvPick': if (derive) { pickDerive(v); render(); } return;
      case 'dvBattery': if (derive && Q.BATTERIES.includes(v as Battery)) { derive.battery = v as Battery; render(); } return;
      case 'dvCancel': { const id = derive?.genId; derive = null; garageAt(id); return; }
      case 'dvStart': {
        if (!game || !derive?.variant) return; const D = derive, g = Q.generationById(game.state, D.genId), o = Q.derivativeOptions(game.state, D.genId).find((x) => x.id === D.variant);
        if (!g || !o) return;
        let r: CommandResult = { ok: false, reason: '' };
        withMoved(D.team, () => (r = game!.command({ type: 'startDerivative', generationId: D.genId, variant: D.variant!, ...(o.into === null && D.name.trim() ? { name: D.name.trim() } : {}), ...(o.powertrain === 'ev' && D.battery ? { battery: D.battery } : {}), team: D.team })).ok);
        if (!run(r)) return;
        const p = game.state.projects[game.state.projects.length - 1];
        ui.colors[p.id] = currentEdition(g).color; devPrev.set(p.id, 0); derive = null; devSel = p.id;
        toast(`「${p.name}」(${o.name}) 개발을 시작했습니다. ${o.weeks}주쯤 걸립니다.`); go('dev'); return;
      }
      // ---- 1.3.0 세대교체 위임 ----
      case 'genAuto': case 'genAutoLaunch': {
        if (!game) return; const id = Number(el.dataset.np), c = gaCar(id); if (!c) return;
        const on = a === 'genAuto' ? v === '1' : true, launch = a === 'genAutoLaunch' ? v === '1' : c.launch;
        if (run(game.command({ type: 'setGenAuto', nameplateId: id, on, launch }))) { if (a === 'genAuto') toast(on ? `「${c.name}」 세대교체를 기획 임원에게 위임했습니다.${launch ? ' 개발이 끝나면 출시까지 합니다.' : ' 출시는 직접 합니다.'}` : `「${c.name}」 세대교체 위임을 껐습니다.`); render(); }
        return;
      }
      case 'genAutoAll': {
        if (!game) return; const on = v === '1'; let n = 0;
        for (const c of gaInfo().cars.filter((x) => x.on !== on)) if (run(game.command({ type: 'setGenAuto', nameplateId: c.nameplateId, on, launch: c.launch }, n > 0))) n++;
        if (n) toast(on ? `차종 ${n}개의 세대교체를 기획 임원에게 위임했습니다.` : `차종 ${n}개의 세대교체 위임을 껐습니다.`); render(); return;
      }
      case 'liftPick': if (lift) { (lift as unknown as Record<string, number>)[el.dataset.k!] = Number(v); render(); } return;
      case 'autoTeam': autoTeam(v); return;
      case 'teamPick': case 'liftTeam': case 'dvTeam': { const o = a === 'teamPick' ? draft : a === 'dvTeam' ? derive : lift, id = Number(el.dataset.id); if (o) { o.team = o.team.includes(id) ? o.team.filter((x) => x !== id) : [...o.team, id]; render(); } return; }
      case 'startLift': {
        if (!game || !lift) return; const L = lift, g = Q.generationById(game.state, L.genId);
        let r: CommandResult = { ok: false, reason: '없는 차입니다.' };
        if (g) withMoved(L.team, () => (r = game!.command({ type: 'startFacelift', generationId: L.genId, options: L.options, tier: L.tier, faceSeed: L.faceSeed, team: L.team, ...{ equip: eqOf(L) } })).ok);
        if (!g || !run(r)) return;
        const p = game.state.projects[game.state.projects.length - 1];
        ui.colors[p.id] = currentEdition(g).color; devPrev.set(p.id, 0); lift = null; devSel = p.id;
        toast(`「${p.name}」 페이스리프트를 시작했습니다. 디자이너가 새 얼굴을 그립니다.`); go('dev'); return;
      }
      case 'ptab': draftNote = ''; planTab = v as PlanTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      // ---- 0.8.0 기획 편의 ----
      case 'planMode': if (!draft) return; draft.mode = v === 'step' ? 'step' : 'sum'; draftNote = ''; planTab = draft.mode === 'sum' ? 'sum' : planTabs(draft)[0][0]; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'applyNew': {
        if (!draft) return; const nt = newTech(draft); if (!nt.items.length) return;
        { const e = { ...eqOf(draft) }; for (const o of nt.opts) e[o] ??= 'opt'; setEquip(draft, e, 'custom'); }
        toast(`새 기술을 반영했습니다: ${nt.items.join(' / ')}`); render(); return;
      }
      case 'presets': showPresets(); return;
      case 'presetSave': {
        if (!draft) return; const list = ui.presets ?? [], name = ($<HTMLInputElement>('#preset-name')?.value ?? '').trim() || `프리셋 ${list.length + 1}`, withBody = !!$<HTMLInputElement>('#preset-body')?.checked;
        const i = list.findIndex((x) => x.name === name);
        if (i < 0 && list.length >= S.PRESET_MAX) return err(`프리셋은 ${S.PRESET_MAX}개까지 저장할 수 있습니다. 하나를 지우고 저장하세요.`);
        const d = draft, ps: S.PlanPreset = { name, ...(withBody ? { body: d.body } : {}), segment: d.segment, powertrain: d.powertrain, tier: d.tier, options: [...d.options], direction: { ...d.direction }, designWeeks: d.designWeeks, budget: d.budget, ...{ equip: { ...eqOf(d) }, ...(d.battery ? { battery: d.battery } : {}) } as object }; // 1.1.0 장비 구성도 함께(옛 판은 options만 읽음)
        ui.presets = i < 0 ? [...list, ps] : list.map((x, k) => (k === i ? ps : x)); dirty = true;
        toast(`프리셋 「${name}」${josa(name, '을/를')} ${i < 0 ? '저장' : '덮어쓰기'}했습니다. 게임을 저장하면 저장 칸에 함께 남습니다.`); showPresets(); return;
      }
      case 'presetLoad': {
        const ps = ui.presets?.[Number(v)]; if (!draft || !ps) return;
        const dropped = applyPreset(draft, ps); sheet.hidden = true; if (draft.mode !== 'step') planTab = 'sum'; lastPanel = ''; render();
        toast(`프리셋 「${ps.name}」${josa(ps.name, '을/를')} 불러왔습니다.${dropped.length ? ` 지금 쓸 수 없어 뺀 것: ${dropped.join(', ')}.` : ''}`, dropped.length ? 'alert' : '', '', dropped.length ? 9000 : 4000); return;
      }
      case 'presetDel': {
        const ps = ui.presets?.[Number(v)]; if (!ps) return;
        if (!(await ask(`프리셋 「${ps.name}」${josa(ps.name, '을/를')} 지울까요?`, '지우기', true))) { showPresets(); return; }
        ui.presets = (ui.presets ?? []).filter((x) => x !== ps); dirty = true; showPresets(); return;
      }
      case 'bestPx': {
        if (!game) return; const s1 = game.state;
        if (el.dataset.id) { // 차고
          const id = Number(el.dataset.id), b = Q.bestPrice(s1, id); if (!b) return;
          garagePrice.set(id, b.price); bestNote = { key: `g${id}`, price: b.price, text: `이번 달 이익 기준 · 예상 월 이익 ${money(b.profit, true)}` };
        } else if (launch) {
          const p = Q.projectById(s1, launch.pid); if (!p) return;
          const b = p.kind === 'facelift' ? Q.bestPrice(s1, p.targetId ?? -1) : Q.bestLaunchPrice(s1, p.id, launch.marketing); if (!b) return;
          launch.price = b.price; bestNote = { key: `l${p.id}`, price: b.price, text: `${p.kind === 'facelift' ? '이번 달 이익 기준' : `출시 ${config.forecast.months}개월째 수요 기준`} · 예상 월 이익 ${money(b.profit, true)}` };
        }
        render(); return;
      }
      case 'pxPolicy': {
        if (!game) return; const id = Number(el.dataset.id), policy: PricePolicy | null = v === 'best' ? { kind: 'best' } : v.startsWith('base:') ? { kind: 'base', pct: Number(v.slice(5)) } : null;
        if (run(game.command({ type: 'setPricePolicy', generationId: id, policy }))) { garagePrice.delete(id); toast(policy ? `자동 가격을 켰습니다. ${policyText(policy)}` : '자동 가격을 껐습니다. 가격은 직접 바꿀 때만 바뀝니다.'); render(); }
        return;
      }
      case 'lookPage': LP.onPage(el.dataset.t as 'face' | 'chassis', v); render(); return; // 1.0.0 외관 후보 다음 묶음
      case 'lookWant': { // 1.0.0 직접 고르기: 조건에 맞는 시드를 찾아 바로 반영
        const t = el.dataset.t as 'face' | 'chassis', key = t === 'face' ? 'faceSeed' : 'chassisSeed';
        if (screen === 'lift' && lift) { const g = Q.generationById(game!.state, lift.genId); if (g) lift.faceSeed = LP.onWant('face', el.dataset.k!, v, liftCtx(g)); }
        else if (draft) { const base = lookOf({ body: draft.body, powertrain: draft.powertrain, tier: draft.tier, color: draft.color, wheels: 1, year: yearOf(game!.state.week), chassisSeed: draft.chassisSeed, faceSeed: draft.faceSeed }); draft[key] = LP.onWant(t, el.dataset.k!, v, planCtx(draft, t, base)); }
        render(); return;
      }
      case 'pick': {
        if (!draft) return; const k = el.dataset.k as keyof Draft;
        (draft as unknown as Record<string, unknown>)[k] = k === 'tier' || k === 'designWeeks' || k === 'chassisSeed' || k === 'faceSeed' ? Number(v) : v;
        if (k === 'powertrain') draft.tier = Math.min(draft.tier, powertrainById(v).tiers.length);
        render(); return;
      }
      // 1.1.0 장비: 단계 바꾸기·추천 구성·모두 빼기·전작 이후 기대 변화 반영(data-t: plan | lift)
      case 'eqSet': case 'eqRec': case 'eqNone': case 'eqApply': {
        if (!game) return; const o = el.dataset.t === 'lift' ? lift : el.dataset.t === 'proj' ? projEq : draft; if (!o) return;
        const g = lift && o === lift ? Q.generationById(game.state, lift.genId) : undefined, P = o === projEq ? Q.projectById(game.state, projEq!.pid) : undefined;
        const body = g?.body ?? P?.body ?? (o as Draft).body, seg = g?.segment ?? P?.segment ?? (o as Draft).segment, pt = g?.powertrain ?? P?.powertrain ?? (o as Draft).powertrain;
        const e = { ...eqOf(o) };
        if (a === 'eqSet') { const k = el.dataset.k!; if (v === 'opt' || v === 'std') e[k] = v; else delete e[k]; setEquip(o, e, 'custom'); }
        else if (a === 'eqRec') setEquip(o, EQ.recommendedEquip(game.state, body, seg, pt), 'rec');
        else if (a === 'eqNone') setEquip(o, {}, 'custom');
        else { for (const c of eqChanges(e, body, seg)) { if (c.to) e[c.id] = c.to; else delete e[c.id]; } setEquip(o, e, 'custom'); toast('기대가 바뀐 장비를 한 번에 반영했습니다.'); }
        if (o === projEq) showProjEquip(); else render(); return;
      }
      case 'projEquip': if (game) { const p = Q.projectById(game.state, Number(el.dataset.id)); if (p) { projEq = { pid: p.id, options: [...p.options], equip: edEquip(p) }; showProjEquip(); } } return;
      case 'projEquipApply': { // 1.1.0 설계 단계 프로젝트의 장비 다시 고르기(sim setProjectEquip, 비용 없음)
        if (!game || !projEq) return;
        if (run(game.command({ type: 'setProjectEquip', projectId: projEq.pid, equip: eqOf(projEq) }))) { projEq = null; sheet.hidden = true; toast('장비 구성을 바꿨습니다. 예상 등급과 원가에 반영됩니다.'); render(); }
        return;
      }
      case 'dir': { if (!draft) return; const k = el.dataset.k as Stat, n = draft.direction[k] + Number(v); if (n < 0 || n > config.dev.dirMax || (Number(v) > 0 && dirLeft(draft) <= 0)) return; draft.direction[k] = n; render(); return; }
      case 'cancelPlan': draft = null; lift = null; draftNote = ''; go('garage'); return;
      case 'startDev': {
        if (!game || !draft) return;
        // 점수가 남았으면 문제 단계(개발 방향)로 데려가서 이유를 보여 준다
        if (dirLeft(draft) > 0) { planTab = 'dir'; lastPanel = ''; render(); panel.scrollTop = 0; return err(`개발 방향 점수가 ${dirLeft(draft)}점 남았습니다. ${config.dev.dirTotal}점을 모두 나눠야 합니다.`); }
        const { color, nameplateId, team, year: _y, subId, equipMode: _e, mode: _m, ...spec } = draft; void _y; void _e; void _m;
        if (subId !== undefined) { // 3.1.0 자회사 신차 기획
          const nm = spec.name.trim() || Q.subModelName(game.state, game.state.subs!.find((x) => x.id === subId)!, spec.body);
          if (!run(game.command({ type: 'subPlanModel', subId, ...spec, name: nm }))) return;
          void color; draft = null; toast(`「${nm}」 개발을 지시했습니다. 개발비는 ${game.state.subs!.find((x) => x.id === subId)?.name ?? '자회사'} 자본에서 나갑니다.`); subView = subId; go('dev'); return;
        }
        let r: CommandResult = { ok: false, reason: '' };
        withMoved(team, () => { r = nameplateId ? game!.command({ type: 'startFullChange', nameplateId, body: spec.body, segment: spec.segment, powertrain: spec.powertrain, tier: spec.tier, options: spec.options, direction: spec.direction, budget: spec.budget, designWeeks: spec.designWeeks, chassisSeed: spec.chassisSeed, faceSeed: spec.faceSeed, team , ...{ equip: spec.equip }, ...(spec.battery ? { battery: spec.battery } : {}) })
          : game!.command({ type: 'startProject', ...spec, name: spec.name.trim() || defaultName(), team }); return r.ok; });
        if (!run(r)) return;
        const p = game.state.projects[game.state.projects.length - 1] as Project;
        ui.colors[p.id] = color; devPrev.set(p.id, 0); draft = null; devSel = p.id;
        try { localStorage.setItem(PLANNED_KEY, '1'); } catch { /* 저장 불가 */ }
        toast(`「${p.name}」 개발을 시작했습니다. 위쪽 빠르기 버튼으로 시간을 진행합니다.`); go('dev'); return;
      }
      case 'cancelDev': {
        const p = s && curProj(); if (!p || !game) return;
        if (!(await ask(`「${p.name}」 개발을 취소할까요?\n지금까지 쓴 개발비 ${money(p.spent)}${josa(money(p.spent), '은/는')} 돌아오지 않습니다.`, '개발 취소', true))) return;
        if (run(game.command({ type: 'cancelProject', projectId: p.id }))) { delete ui.colors[p.id]; if (launch?.pid === p.id) launch = null; toast('개발을 취소했습니다'); go('dev'); }
        return;
      }
      case 'toLaunch': { const p = s && curProj(); if (p) openLaunch(p.id); return; }
      case 'lset': if (!launch) return; (launch as unknown as Record<string, unknown>)[el.dataset.k!] = el.dataset.k === 'color' ? v : Number(v); render(); return;
      case 'doLaunch': {
        if (!game || !launch) return;
        const L = launch, p = Q.projectById(game.state, L.pid), adv = p && Q.defectAdvice(p, game.state);
        if (adv?.level === 'many' && !(await ask(`남은 결함이 약 ${p!.defectEst}개로 아직 많습니다.\n지금 출시하면 평론가 4명이 모두 ${config.critics.manyDefectsPenalty}점씩 깎고, 리콜 위험이 연 ${Math.round(adv.recallYear * 100)}%입니다. 몇 주 더 시험하면 결함이 줄어듭니다.`, '그래도 출시', true, '시험 더 하기'))) { launch = null; go('dev'); return; }
        if (launch !== L) return;
        const before = new Set(allGens(game.state).map((g) => g.id)), proj = p!, rep0 = game.state.reputation;
        stage?.setColor(L.color);
        const r: CommandResult = game.command({ type: 'launch', projectId: L.pid, price: L.price, marketing: L.marketing, color: L.color, wheels: L.wheels });
        if (!run(r)) return;
        const lifted = proj.kind === 'facelift' ? Q.generationById(game.state, proj.targetId ?? -1) : undefined;
        const g = lifted ?? allGens(game.state).find((x) => !before.has(x.id)), ed = lifted ? currentEdition(lifted) : undefined;
        if (ed) snapPhoto(`e${ed.id}`); else if (g) snapPhoto(g.id);
        if (g) { const c = config.critics; officeEvents.push({ kind: 'say', mood: lifted ? 'launch' : g.reviewAvg >= c.masterpiece ? 'masterpiece' : g.reviewAvg <= c.flop ? 'badReview' : 'launch' }); }
        devLog.delete(L.pid); delete ui.colors[L.pid]; launch = null; screen = 'garage'; garageId = g?.id ?? -1; garageSum = false; lastPanel = '';
        render();
        const news = r.ok ? r.events?.find((e) => e.kind === 'news') : undefined;
        // M3 출시 공개 장면(설정 'car-company-reveal'). 끝나면 평론 창·신문. 1.3.0: 사용자가 닫을 때까지 떠 있다
        if (g) launchScene(g, lifted ? ed : undefined, game.state.reputation - rep0, news?.text);
        return;
      }
      case 'closeReview': reviewTimers.forEach(clearTimeout); sheet.hidden = true; go('garage'); return;
      case 'goWeak': { const w = weakest(); if (w) garageAt(w.id); return; }
      case 'gprev': case 'gnext': { const L = garageList(), i = L.findIndex((g) => g.id === garageId); if (L.length) garageId = L[((i < 0 ? 0 : i) + (a === 'gnext' ? 1 : -1) + L.length) % L.length].id; lastPanel = ''; render(); return; }
      case 'gopen': garageAt(Number(el.dataset.id)); return;
      case 'gsum': garageSum = true; go('garage'); return;
      case 'gSort': { const k = v as GSort; if (gSort.k === k) gSort.desc = !gSort.desc; else { gSort.k = k; gSort.desc = k !== 'name' && k !== 'launch'; } render(); return; }
      case 'cmpPick': { const id = Number(el.dataset.id); if (!cmpSel.delete(id)) cmpSel.add(id); render(); return; }
      case 'cmpAll': if (game) { for (const g of garageList()) cmpSel.add(g.id); render(); } return;
      case 'bulkOpen': bulk = null; showBulk(); return;
      case 'bulkPick': bulk = bulk?.v === v ? null : { kind: el.dataset.k as 'policy' | 'mk', v }; showBulk(); return;
      case 'bulkApply': await applyBulk(); return; // 기다려야 [되돌리기] 알림이 붙는다
      case 'cmpClear': cmpSel.clear(); render(); return;
      case 'cmpOpen': if (cmpSel.size === 1) showRivalCompare([...cmpSel][0]); else showCompare(); return;
      case 'rivalOpen': showRivalLineup(v); return;
      case 'allyRival': if (game && run(game.command({ type: 'allyRival', rivalId: v }))) { toast('기술 제휴를 맺었습니다. 연구 속도가 빨라지고, 이 회사의 앞선 기술을 사 올 수 있습니다.'); showRivalLineup(v); } return;
      case 'endAlly': if (game && await ask('제휴를 끝낼까요? 계약금은 돌아오지 않습니다.', '제휴 끝내기', true) && run(game.command({ type: 'endAlliance', rivalId: v }))) showRivalLineup(v); return;
      case 'buyTech': if (game && run(game.command({ type: 'buyRivalTech', rivalId: v, techId: el.dataset.t ?? '' }))) { toast('기술을 사 와 연구를 마친 것으로 처리했습니다.'); showRivalLineup(v); } return;
      case 'talentHire': { if (!game) return; const t = game.state.rivalry?.talent.find((x) => x.id === Number(el.dataset.id)), rid = t?.rivalId ?? ''; if (t && run(game.command({ type: 'hireRivalTalent', talentId: t.id }))) { toast(`${t.name}${josa(t.name, '을/를')} 영입했습니다. 직원 목록에 있습니다.`); showRivalLineup(rid); } return; }
      case 'acqOpen': showAcquire(v); return;
      case 'acqDo': { if (!game) return; const a = Q.acquireInfo(game.state, v); if (!a || !(await ask(`${a.name}${josa(a.name, '을/를')} ${money(a.price)}에 인수할까요?\n인수하면 경쟁사 목록에서 빠지고 자회사 「${a.newName}」가 됩니다.`, '인수하기'))) return;
        if (run(game.command({ type: 'acquireRival', rivalId: v }))) { sheet.hidden = true; toast(`${a.name}${josa(a.name, '을/를')} 인수했습니다. 회사 › 자회사에서 「${a.newName}」${josa(a.newName, '을/를')} 운영합니다.`, 'alert', '경쟁사 인수', 9000); subSel = game.state.subs?.at(-1)?.id ?? null; render(); } return; }
      case 'listSub': { if (!game) return; const sub = game.state.subs?.find((x) => x.id === Number(el.dataset.id)); if (!sub) return; const pct = Number(v), add = Math.round(Q.subValue(sub) * (pct / 100 - (sub.listed ?? 0)));
        if (!(await ask(`「${sub.name}」 지분을 ${pct}%까지 상장해 약 ${money(add)}을 받을까요?\n상장한 지분만큼 앞으로 배당과 매각 대금이 줄어듭니다.`, '상장하기'))) return;
        if (run(game.command({ type: 'listSub', subId: sub.id, pct }))) { toast(`「${sub.name}」 지분을 상장해 ${money(add)}을 받았습니다.`); render(); } return; }
      case 'rivalCmp': showRivalCompare(Number(el.dataset.id)); return;
      case 'setPrice': { if (!game) return; const id = Number(el.dataset.id), price = garagePrice.get(id), pol = Q.generationById(game.state, id)?.pricePolicy; if (price === undefined) return;
        if (pol && !(await ask(`가격을 직접 바꾸면 자동 가격(${policyName(pol)})이 꺼지고 수동으로 돌아갑니다.\n가격을 ${num(price)}만원으로 바꿀까요?`, '가격 바꾸기'))) return;
        if (run(game.command({ type: 'setPrice', generationId: id, price }))) { garagePrice.delete(id); toast(`가격을 ${num(price)}만원으로 바꿨습니다. 다음 결산부터 반영됩니다.`); render(); } return; }
      case 'renameOpen': if (game) showRename(Number(el.dataset.id)); return;
      case 'renameDo': { if (!game) return; const id = Number(el.dataset.id), name = ($<HTMLInputElement>('#rn-name')?.value ?? '').trim();
        if (run(game.command({ type: 'renameNameplate', nameplateId: id, name, withDerivatives: !!$<HTMLInputElement>('#rn-kids')?.checked }))) { sheet.hidden = true; toast(`이름을 「${name}」${josa(name, '으로/로')} 바꿨습니다.`); render(); } return; }
      case 'setMk': if (game && run(game.command({ type: 'setMarketing', generationId: Number(el.dataset.id), marketing: Number(v) }))) render(); return;
      case 'quickFix': case 'clearance': { // 0.10.0 실패한 차의 수습(확인 창에 예상 효과)
        const id = Number(el.dataset.id), kind = a as 'quickFix' | 'clearance';
        if (!game) return;
        void ask(I.rescueConfirm(game.state, id, kind), kind === 'quickFix' ? '긴급 개선 시작' : '가격 인하 판매 시작').then((yes) => {
          if (yes && game && run(game.command({ type: kind, generationId: id }))) { toast(kind === 'quickFix' ? `긴급 개선을 시작했습니다. ${config.rescue.fixWeeks}주 뒤 개선판이 나옵니다.` : `가격 인하 판매를 시작했습니다. ${config.rescue.clearMonths}개월 뒤 단종합니다.`); render(); }
        });
        return;
      }
      case 'retrofit': if (game && run(game.command({ type: 'retrofit', generationId: Number(el.dataset.id) }))) { toast('의무 장비를 넣었습니다. 대당 원가가 그만큼 오릅니다.'); render(); } return;
      case 'discontinue': {
        if (!game) return; const g = Q.generationById(game.state, Number(el.dataset.id)); if (!g) return;
        if (!(await ask(`「${nameOf(g)}」${josa(nameOf(g), '을/를')} 단종할까요?\n이번 달 말까지만 팔고(마지막 달은 재고 처분이라 판매가 절반), 다음 달부터 생산 라인이 빕니다. 잘 팔리는 차를 단종하면 평판이 ${-config.discontinue.rep} 떨어집니다. 차 이름은 기록에 남습니다.`, '단종하기', true))) return;
        if (run(game.command({ type: 'discontinue', generationId: g.id }))) { toast(`「${nameOf(g)}」 단종을 정했습니다. 이번 달 말에 생산을 마칩니다.`); render(); }
        return;
      }
      // ---- 회사(9장) ----
      case 'techSel': showTech(v); return;
      case 'priRes': if (game && run(game.command({ type: 'prioritizeResearch', techId: v }))) { toast(`이 연구가 주간 연구 점수의 ${Math.round(config.research.priorityShare * 100)}%를 받습니다. 나머지는 다른 연구가 나눠 받습니다.`); render(); } return;
      case 'resolveEv': {
        if (!game) return; const ad = document.querySelector<HTMLInputElement>('#sheet .auto-chk input:checked')?.dataset.ad; // 3.7.1 체크한 채 고르면 그 답으로 자동 승인
        const r = game.command({ type: 'resolveEvent', eventId: Number(el.dataset.id), choice: Number(v) });
        if (!r.ok) return err(r.reason);
        const n = r.events?.find((e) => e.kind === 'news'); if (n) toast(newsLine(n.text), 'alert', '결정 결과', 9000);
        if (ad && game.command({ type: 'setAutoDecide', kind: ad, on: true, choice: Number(v) }).ok) { const k = Q.AUTO_KINDS.find((x) => x.id === ad)!, l = k.choices[Number(v)].label;
          toast(`「${k.name}」 결정은 앞으로 「${l}」${josa(l, '으로/로')} 자동 승인합니다. 설정 › 결정에서 바꿀 수 있습니다.`, '', '자동 승인', 6000); }
        if (Q.pendingChoices(game.state).length) showChoice(); else { sheet.hidden = true; render(); }
        return;
      }
      case 'later': sheet.hidden = true; render(); return;
      case 'newsOpen': if (s) { const n = Q.newsLog(s)[Number(v)]; if (n) showNewsItem(n.text, n.week, n.category); } return;
      case 'finRange': if (V.FIN_RANGES.some(([k]) => k === v)) { finRange = v as V.FinRange; render(); } return;
      case 'linSort': if (LIN_SORTS.some(([k]) => k === v)) { linView.sort = v as typeof LIN_SORTS[number][0]; keep(LIN_KEY, linView); render(); } return;
      case 'linFilter': if (v === '' || v === 'on' || v === 'off') { linView.filter = v; keep(LIN_KEY, linView); render(); } return;
      case 'hallGo': recTab = 'cars'; linView.filter = ''; lastPanel = ''; render(); document.getElementById(`np-${v}`)?.scrollIntoView({ block: 'start' }); return;
      case 'rectab': recTab = v as RecTab; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'statsRange': statsRange = v as Q.StatsRange; lastPanel = ''; render(); return;
      case 'pastOpen': showPastPick(v); return;
      case 'pastSort': pastSort = v === 'sold' ? 'sold' : 'recent'; showPastPick(el.dataset.k ?? ''); return;
      case 'pastClose': $('#pick').hidden = true; renderTop(); return;
      case 'pastPick': { const inp = document.getElementById(el.dataset.k ?? '') as HTMLInputElement | null; $('#pick').hidden = true; renderTop();
        if (inp) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); } return; }
      case 'pastClear': if (await ask('이 기기에 모아 둔 지난 판의 차 이름을 모두 지울까요? 게임 저장은 그대로입니다.', '지우기', true)) { PN.clearPast(); lastPanel = ''; render(); } return;
      case 'goResearch': go('research'); if (v) showTech(v); return;
      case 'backPlan': go(draft ? 'plan' : lift ? 'lift' : 'garage'); return;
      case 'startResearch': {
        if (!game) return; const t = Q.researchInfo(game.state).fields.flatMap((f) => f.techs).find((x) => x.id === v); if (!t) return;
        if (!(await ask(`「${t.name}」 연구를 시작할까요?\n${money(t.cost.money)}${josa(money(t.cost.money), '이/가')} 바로 나가고, 연구 점수 ${num(t.cost.points)}점이 쌓이면 완성됩니다${t.weeksLeft === null ? '' : `(지금 점수로 약 ${t.weeksLeft}주)`}.`, '연구 시작'))) return;
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
      // ---- 4.0.0 세계 시장 ----
      case 'wSel': worldSel = v; lastPanel = ''; render(); return;
      case 'goWorld': worldSel = v || worldSel; goCo('world'); return;
      case 'wOpen': showWorldOpen(v); return;
      case 'wOpenDo': if (game && run(game.command({ type: 'openRegion', region: v }))) { sheet.hidden = true; worldSel = v; toast(`${WD.regionName(v)}에 진출했습니다. 다음 월 결산부터 자동 수출 목록의 차가 팔립니다.`); lastPanel = ''; render(); } return;
      case 'wOffice': showOfficeInvest(v); return;
      case 'wOfficeDo': if (game && run(game.command({ type: 'investOffice', region: v }))) { sheet.hidden = true; toast(`${WD.regionName(v)} 판매 법인 ${WD.regionOf(game.state, v)?.office}등급에 투자했습니다.`); lastPanel = ''; render(); } return;
      case 'wAuto': if (game && run(game.command({ type: 'setRegionAuto', region: v, on: (el as HTMLInputElement).checked }))) { lastPanel = ''; render(); } return;
      case 'wExp': if (game && run(game.command({ type: 'setExport', generationId: Number(el.dataset.id), region: el.dataset.k ?? '', on: v === 'on' }))) { lastPanel = ''; render(); } return;
      case 'wPrice': showRegionPrice(Number(el.dataset.id), el.dataset.k ?? ''); return;
      case 'wDomFirst': if (game) run(game.command({ type: 'setDomFirst', generationId: Number(el.dataset.id), on: (el as HTMLInputElement).checked })); return;
      case 'wPriceAuto': case 'wPriceDo': { if (!game || !wPriceSet) return; const w = wPriceSet, price = a === 'wPriceAuto' ? null : Number($<HTMLInputElement>('#w-price')?.value);
        if (run(game.command({ type: 'setRegionPrice', generationId: w.gen, region: w.rid, price }))) { sheet.hidden = true; wPriceSet = null; toast(price === null ? '권역 가격을 자동으로 돌렸습니다. 다음 월 결산에 다시 셉니다.' : `권역 가격을 ${money(price)}으로 정했습니다.`); lastPanel = ''; render(); } return; }
      // ---- 3.0.0 자회사 ----
      case 'subSel': subSel = Number(el.dataset.id); subPick = ''; lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'subBack': subSel = null; subPick = ''; lastPanel = ''; render(); panel.scrollTop = 0; return;
      // ---- 3.1.0 운영 전환·직접 운영 ----
      case 'subOpen': sheet.hidden = true; openSub(Number(el.dataset.id), (v || 'company') as Screen); return;
      case 'subCarSel': subCar = el.dataset.k ?? ''; lastPanel = ''; render(); return;
      case 'gsubOpen': garageSub = { id: Number(el.dataset.id), body: el.dataset.k ?? '' }; if (screen !== 'garage') { go('garage'); return; } lastPanel = ''; render(); panel.scrollTop = 0; return;
      case 'gsubBack': garageSub = null; garageSum = true; lastPanel = ''; render(); return;
      case 'subMode': { if (!game) return; const id = Number(el.dataset.id), d = Q.subDetail(game.state, id); if (!d || d.mode === v) return;
        if (v === 'delegate' && !(await ask(`「${d.name}」${josa(d.name, '을/를')} 전반 위임으로 돌릴까요?\n정한 모델 가격은 풀리고, 앞으로는 전략이 모델을 늘리거나 줄입니다. 개발 중인 차는 그대로 출시합니다.`, '전반 위임으로'))) return;
        if (run(game.command({ type: 'setSubMode', subId: id, mode: v as 'direct' | 'delegate' }))) { toast(v === 'direct' ? `「${d.name}」${josa(d.name, '을/를')} 직접 운영합니다. 개발 탭에서 신차를 기획할 수 있습니다.` : `「${d.name}」${josa(d.name, '을/를')} 전반 위임으로 돌렸습니다.`); render(); } return; }
      case 'subPrice': if (game && run(game.command({ type: 'setSubModelPrice', subId: Number(el.dataset.id), body: el.dataset.k ?? '', pct: v === '' ? null : Number(v) }))) render(); return;
      case 'subPlanNew': { if (!game) return; const id = Number(el.dataset.id), d = Q.subDetail(game.state, id); if (!d) return;
        if (d.mode !== 'direct') return err('신차를 직접 기획하려면 먼저 직접 운영으로 바꾸세요.');
        if (draft?.subId === id) { subView = id; go('plan'); return; }
        if (!(await dropDraft())) return;
        const nd = newSubDraft(id); if (!nd) return;
        draft = nd; planTab = 'sum'; subView = id; go('plan'); return; }
      case 'subOrderOpen': { if (!game) return; const id = Number(el.dataset.id), x = game.state.subs?.find((y) => y.id === id); if (!x) return;
        ordSet = { id, body: '', character: x.kind === 'premium' ? 'luxury' : 'value', band: 'mid' }; showSubOrder(); return; }
      case 'ordPick': if (ordSet) { (ordSet as Record<string, unknown>)[el.dataset.k ?? ''] = v; showSubOrder(); } return;
      case 'subOrderDo': { if (!game || !ordSet) return; const o = ordSet, name = ($<HTMLInputElement>('#ord-name')?.value ?? '').trim();
        if (run(game.command({ type: 'subOrderModel', subId: o.id, body: o.body, character: o.character, priceBand: o.band, ...(name ? { name } : {}) }))) { sheet.hidden = true; ordSet = null; const od = Q.subDetail(game.state, o.id)!.orders.at(-1); toast(`${bodyById(o.body).name} 제작을 지시했습니다. ${od ? `${od.monthsLeft}개월 뒤 출시합니다.` : ''}`); render(); } return; }
      case 'subBadgeOpen': showSubBadge(Number(el.dataset.id)); return;
      case 'subBadgeDo': { if (!game) return; const id = Number(el.dataset.id), g = Q.generationById(game.state, Number(v)); if (!g) return;
        if (run(game.command({ type: 'subBadgeModel', subId: id, modelId: g.id }))) { sheet.hidden = true; const od = Q.subDetail(game.state, id)!.orders.at(-1); toast(`「${nameOf(g)}」${josa(nameOf(g), '을/를')} 배지 모델로 내기로 했습니다. ${od ? `${od.monthsLeft}개월 뒤 출시합니다.` : ''}`); render(); } return; }
      case 'subCancelOrd': { if (!game) return; const id = Number(el.dataset.id), o = Q.subDetail(game.state, id)?.orders.find((x) => x.id === Number(v)); if (!o) return;
        if (!(await ask(`${o.name ? `「${o.name}」` : `${o.bodyName} 신차`} 개발을 취소할까요?\n이미 낸 개발비 ${money(o.cost)}${josa(money(o.cost), '은/는')} 돌아오지 않습니다.`, '개발 취소', true))) return;
        if (run(game.command({ type: 'subCancelOrder', subId: id, orderId: o.id }))) { toast('개발을 취소했습니다.'); render(); } return; }
      case 'tgtKind': tgtKind = v === 'profit' ? 'profit' : 'sold'; lastPanel = ''; render(); return;
      case 'tgtSet': { if (!game) return; const val = Math.round(Number($<HTMLInputElement>('#sub-tgt')?.value ?? ''));
        if (run(game.command({ type: 'setSubTarget', subId: Number(el.dataset.id), target: { kind: v === 'profit' ? 'profit' : 'sold', value: val } }))) { toast(`올해 목표를 ${v === 'profit' ? `이익 ${money(val)}` : `판매 ${num(val)}대`}${josa(v === 'profit' ? money(val) : '대', '으로/로')} 정했습니다.`); lastPanel = ''; render(); } return; }
      case 'tgtClear': if (game && run(game.command({ type: 'setSubTarget', subId: Number(el.dataset.id), target: null }))) { toast('목표를 지웠습니다.'); lastPanel = ''; render(); } return;
      case 'subFoundOpen': { if (!s) return; const f = Q.subsInfo(s).found; foundKind = (f.find((x) => x.ok) ?? f[0]).kind; foundColor = ''; showSubFound(); return; }
      case 'subFoundKind': if (Q.SUB_KINDS.includes(v as SubKind)) { foundKind = v as SubKind; foundColor = ''; showSubFound(); } return;
      case 'subColor': foundColor = v; for (const b of sheetBody.querySelectorAll<HTMLElement>('[data-act="subColor"]')) b.setAttribute('aria-pressed', String(b.dataset.v === v)); return;
      case 'subFoundDo': {
        if (!game) return; const f = Q.subsInfo(game.state).found.find((x) => x.kind === foundKind); if (!f) return;
        const name = ($<HTMLInputElement>('#sub-name')?.value ?? '').trim() || f.defaultName, brand = f.kind === 'premium' || f.kind === 'value';
        if (!(await ask(`${f.name} 「${name}」${josa(name, '을/를')} 세울까요?\n설립비 ${money(f.cost)}${josa(money(f.cost), '이/가')} 현금에서 바로 나갑니다. 설립비는 자회사 자본이 되어 본사 현금으로 돌아오지 않습니다(매각하면 자본의 ${Math.round(SUBS.sellShare * 100)}%).`, '설립하기'))) { showSubFound(); return; }
        if (run(game.command({ type: 'foundSubsidiary', kind: f.kind, name, ...(brand ? { color: foundColor || f.color } : {}) }))) { sheet.hidden = true; subSel = game.state.subs!.at(-1)!.id; coTab = 'sub'; toast(`${f.name} 「${name}」${josa(name, '을/를')} 세웠습니다.${brand ? ' 첫 모델은 이번 달 말에 나옵니다.' : ''}`); go('company'); }
        else showSubFound();
        return;
      }
      case 'subStrat': { if (!game) return; const id = Number(el.dataset.id), k = v as SubStrategy;
        if (run(game.command({ type: 'setSubStrategy', subId: id, strategy: k }))) { toast(`${Q.subDetail(game.state, id)!.strategyName} 전략을 지시했습니다. ${SUBS.switchMonths}개월에 걸쳐 효과가 바뀝니다.`); render(); } return; }
      case 'subRival': if (game && run(game.command({ type: 'setSubStrategy', subId: Number(el.dataset.id), strategy: 'rival', rivalId: v || null }))) render(); return;
      case 'subBody': { if (!game) return; const id = Number(el.dataset.id), d = Q.subDetail(game.state, id); if (!d) return;
        const bodies = d.bodies.includes(v) ? d.bodies.filter((b) => b !== v) : [...d.bodies, v];
        if (run(game.command({ type: 'setSubArea', subId: id, bodies, segment: d.segment }))) render(); return; }
      case 'subSeg': { if (!game) return; const id = Number(el.dataset.id), d = Q.subDetail(game.state, id); if (d && run(game.command({ type: 'setSubArea', subId: id, bodies: [...d.bodies], segment: v }))) render(); return; }
      case 'subDivi': if (game && run(game.command({ type: 'setSubDividend', subId: Number(el.dataset.id), pct: Number(v) }))) render(); return;
      case 'subInvest': { if (!game) return; const id = Number(el.dataset.id), amt = Number(v), d = Q.subDetail(game.state, id); if (!d) return;
        if (!(await ask(`「${d.name}」에 ${money(amt)}${josa(money(amt), '을/를')} 투자할까요?\n현금에서 바로 나가고 자회사 자본이 됩니다.`, '투자하기'))) return;
        if (run(game.command({ type: 'investSub', subId: id, amount: amt }))) { toast(`「${d.name}」에 ${money(amt)}${josa(money(amt), '을/를')} 투자했습니다.`); render(); } return; }
      case 'subShare': if (game && run(game.command({ type: 'setSubShare', subId: Number(el.dataset.id), share: Number(v) as 0 | 1 | 2 }))) render(); return;
      case 'subPresPick': subPick = subPick === 'pres' ? '' : 'pres'; render(); return;
      case 'subAddPick': subPick = subPick === 'add' ? '' : 'add'; render(); return;
      case 'subPresSet': { if (!game) return; const id = Number(el.dataset.id), x = v ? game.state.staff.find((y) => y.id === Number(v)) : null;
        if (run(game.command({ type: 'setSubPresident', subId: id, staffId: x ? x.id : null }))) { subPick = ''; toast(x ? `${x.name}${josa(x.name, '을/를')} 사장으로 임명했습니다. 본사 직원 목록에서 빠집니다.` : '사장을 해임했습니다. 원래 직무로 돌아옵니다.'); render(); } return; }
      case 'subAdd': if (game && run(game.command({ type: 'subAddModel', subId: Number(el.dataset.id), body: v }))) { subPick = ''; toast(`${bodyById(v).name} 모델을 냈습니다.`); render(); } return;
      case 'subRenameOpen': if (game) showSubRename(Number(el.dataset.id), el.dataset.k ?? ''); return;
      case 'subRenameDo': { if (!game) return; const name = ($<HTMLInputElement>('#sub-rn')?.value ?? '').trim();
        if (run(game.command({ type: 'renameSubModel', subId: Number(el.dataset.id), body: el.dataset.k ?? '', name }))) { sheet.hidden = true; toast(`이름을 「${name}」${josa(name, '으로/로')} 바꿨습니다.`); render(); } return; }
      case 'subDrop': { if (!game) return; const id = Number(el.dataset.id), m = Q.subDetail(game.state, id)?.models.find((x) => x.body === el.dataset.k); if (!m) return;
        if (!(await ask(`「${m.name}」${josa(m.name, '을/를')} 단종할까요?\n이 차급에는 전략이 다시 모델을 내지 않습니다. 다시 내려면 모델 추가를 지시하세요.`, '단종하기', true))) return;
        if (run(game.command({ type: 'subDropModel', subId: id, body: m.body }))) { toast(`「${m.name}」${josa(m.name, '을/를')} 단종했습니다.`); render(); } return; }
      case 'subSell': { if (!game) return; const id = Number(el.dataset.id), d = Q.subDetail(game.state, id); if (!d) return;
        if (!(await ask(`「${d.name}」${josa(d.name, '을/를')} ${money(d.sellPrice)}에 매각할까요?\n매각은 같은 주 안의 되돌리기 말고는 되돌릴 수 없습니다. 모델과 실적 기록이 사라지고, 사장은 본사 직원으로 돌아옵니다.${d.from ? ' 인수한 회사는 다시 독립 경쟁사가 됩니다.' : ''}`, '매각하기', true))) return;
        if (run(game.command({ type: 'sellSubsidiary', subId: id }))) { subSel = null; if (subView === id) { subView = null; screen = 'company'; } toast(`「${d.name}」${josa(d.name, '을/를')} 매각했습니다. ${money(d.sellPrice)}${josa(money(d.sellPrice), '이/가')} 들어왔습니다.`); lastPanel = ''; render(); } return; }
      // ---- 임원(0.7.0) ----
      case 'execPick': execPick = execPick === v ? null : v as ExecRole; render(); return;
      case 'execAppoint': { if (!game) return; const x = game.state.staff.find((y) => y.id === Number(el.dataset.id)), role = el.dataset.role as ExecRole; if (x && run(game.command({ type: 'appointExec', role, staffId: x.id }))) { execPick = null; toast(`${x.name}${josa(x.name, '을/를')} ${Q.EXEC_TITLE[role]}${josa(Q.EXEC_TITLE[role], '으로/로')} 임명했습니다.`); render(); } return; }
      case 'execPost': if (game && run(game.command({ type: 'postExecJob', role: el.dataset.role as ExecRole }))) { toast('임원 공고를 냈습니다. 후보 3명이 왔습니다.'); render(); } return;
      case 'execHire': { if (!game) return; const role = el.dataset.role as ExecRole, c = game.state.execs?.candidates.find((x) => x.id === Number(el.dataset.id)); if (c && run(game.command({ type: 'hireExec', role, candidateId: c.id }))) { toast(`${c.name}${josa(c.name, '을/를')} ${Q.EXEC_TITLE[role]}${josa(Q.EXEC_TITLE[role], '으로/로')} 뽑았습니다.`); render(); } return; }
      case 'execDeleg': if (game && run(game.command({ type: 'setDelegation', role: el.dataset.role as ExecRole, key: el.dataset.k!, on: v === '1' }))) render(); return;
      case 'execDismiss': {
        if (!game) return; const role = el.dataset.role as ExecRole, h = Q.execInfo(game.state).roles.find((r) => r.role === role)?.holder; if (!h) return;
        if (!(await ask(`${h.name}${josa(h.name, '을/를')} ${Q.EXEC_TITLE[role]}에서 해임할까요?\n${h.hired ? `외부 임원이라 회사를 떠납니다. 퇴직금 ${money(h.pay * config.staff.severanceMonths)}이 나갑니다.` : `원래 직무(${ROLE_NAME[h.staffRole]})로 돌아갑니다.`} 위임한 일은 모두 꺼집니다.`, '해임', true))) return;
        if (run(game.command({ type: 'dismissExec', role }))) { toast(`${h.name}${josa(h.name, '을/를')} 해임했습니다.`); render(); }
        return;
      }
      case 'goCo': goCo(v); return;
      case 'devSel': devSel = Number(el.dataset.id); go('dev'); return;
      case 'devStep': if (s && s.projects.length) { const P = s.projects, i = Math.max(0, P.findIndex((p) => p.id === curProj()?.id)); devSel = P[(i + Number(v) + P.length) % P.length].id; lastPanel = ''; render(); } return;
      case 'devHome': go('dev'); return; // 기획 중이어도 개발 화면(사무실)으로
      case 'resumePlan': go(draft ? 'plan' : lift ? 'lift' : 'dev'); return;
      case 'staffSel': { const id = Number(el.dataset.id); staffSel = staffSel === id ? null : id; render(); if (staffSel !== null) document.getElementById('staff-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      case 'hireRole': hireRole = v as Role; render(); return;
      case 'postJob': if (game && run(game.command({ type: 'postJob', role: hireRole, tier: Number(v) as 1 | 2 | 3 }))) { if (!game.state.candidates.length) toast(`${ROLE_NAME[hireRole]} 공고를 냈습니다.`); render(); } return; // 후보가 오면 watchCands가 알린다
      case 'hire': {
        if (!game) return; const c = game.state.candidates.find((x) => x.id === Number(el.dataset.id));
        if (c && run(game.command({ type: 'hire', candidateId: c.id }))) { toast(`${c.name}${josa(c.name, '을/를')} ${ROLE_NAME[c.role]}${josa(ROLE_NAME[c.role], '으로/로')} 채용했습니다.`); render(); }
        return;
      }
      case 'dismissCands': if (game && (await ask('후보를 모두 돌려보낼까요?\n공고에 쓴 돈은 돌아오지 않습니다.', '돌려보내기', true)) && run(game.command({ type: 'dismissCandidates' }))) { toast('후보를 모두 돌려보냈습니다'); render(); } return;
      case 'train': {
        if (!game) return; const x = game.state.staff.find((y) => y.id === Number(el.dataset.id)); if (!x) return; const a0 = x.ability;
        if (run(game.command({ type: 'train', staffId: x.id }))) { toast(`${x.name} 교육을 보냈습니다. 능력 ${a0} → ${x.ability}. ${config.staff.train.weeks}주 동안 일하지 않습니다.`); render(); }
        return;
      }
      case 'rest': { if (!game) return; const x = game.state.staff.find((y) => y.id === Number(el.dataset.id)); if (x && run(game.command({ type: 'rest', staffId: x.id, weeks: Number(v) }))) { toast(`${x.name}에게 ${v}주 휴식을 줬습니다.`); render(); } return; }
      case 'staffPick': { const id = Number(el.dataset.id); if (!staffPick.delete(id)) staffPick.add(id); render(); return; }
      case 'pickNone': staffPick.clear(); render(); return;
      case 'pickVisible': if (game) { staffPick = new Set(visibleStaff().map((x) => x.id)); render(); } return; // 필터로 보이는 사람만
      case 'staffSort': { // 같은 머리글을 다시 누르면 역순. 처음 누를 때 능력·성장·월급은 큰 것부터
        const k = v as StaffSort; if (!STAFF_SORTS.includes(k)) return;
        if (staffView.sort === k) staffView.desc = !staffView.desc; else { staffView.sort = k; staffView.desc = k === 'abil' || k === 'grow' || k === 'pay'; }
        keep(STAFF_VIEW_KEY, staffView); render(); return;
      }
      case 'staffFilter': if (STAFF_FILTERS.some(([k]) => k === v)) { staffView.filter = v as StaffFilter; keep(STAFF_VIEW_KEY, staffView); render(); } return;
      case 'trainPicked': { // 기존 train 명령을 ID 순으로 차례로. 현금은 앞사람 교육비를 빼며 따진다
        if (!game) return; const T = config.staff.train, rows = Q.staffInfo(game.state).filter((x) => staffPick.has(x.id));
        let cash = game.state.cash; const ok: Q.StaffRow[] = [], no: string[] = [];
        for (const x of rows) { const why = x.trainReason ?? (cash < x.trainCost ? '현금이 모자랍니다.' : null); if (why) no.push(`${x.name}: ${why}`); else { ok.push(x); cash -= x.trainCost; } }
        const noText = no.length ? `\n\n교육할 수 없는 ${no.length}명(보내지 않음)\n${no.join('\n')}` : '';
        if (!ok.length) return err(`고른 직원 중 교육을 보낼 수 있는 사람이 없습니다. ${no.join(' / ')}`);
        const busy = ok.filter((x) => x.status === 'working').length, cost = ok.reduce((a, x) => a + x.trainCost, 0);
        if (!(await ask(`${ok.length}명을 교육 보낼까요?\n총 비용 ${money(cost)}, ${T.weeks}주 동안 일하지 않습니다(능력 +${T.gainMin}~${T.gainMax}).${busy ? `\n개발 중인 직원 ${busy}명이 교육받는 동안 그 개발이 느려집니다.` : ''}${noText}`, '교육 보내기'))) return;
        let n = 0; for (const x of ok) if (run(game.command({ type: 'train', staffId: x.id }, n > 0))) n++; // 한 번에 되돌린다
        staffPick.clear(); toast(`${n}명을 교육 보냈습니다. ${T.weeks}주 동안 일하지 않습니다.`); render(); return;
      }
      case 'restPicked': { // 기존 rest 명령(2주)을 차례로. 교육 중인 직원은 쉴 수 없다
        if (!game) return; const rows = Q.staffInfo(game.state).filter((x) => staffPick.has(x.id)), skip = rows.filter((x) => x.status === 'training');
        let n = 0; for (const x of rows) if (x.status !== 'training' && run(game.command({ type: 'rest', staffId: x.id, weeks: 2 }, n > 0))) n++;
        staffPick.clear(); if (n) toast(`${n}명에게 2주 휴식을 줬습니다.${skip.length ? ` 교육 중인 ${skip.length}명은 쉴 수 없어 뺐습니다.` : ''}`); else err('교육 중인 직원은 쉴 수 없습니다.'); render(); return;
      }
      case 'assign': if (game && run(game.command({ type: 'assign', staffId: Number(el.dataset.id), projectId: v === '' ? null : v === 'lab' ? 'lab' : Number(v) }))) render(); return;
      case 'fire': {
        if (!game) return; const x = Q.staffInfo(game.state).find((y) => y.id === Number(el.dataset.id)); if (!x) return;
        if (!(await ask(`${x.name}(${ROLE_NAME[x.role]}, 능력 ${x.ability})${josa(x.name, '을/를')} 해고할까요?\n퇴직금 ${money(x.severance)}이 바로 나갑니다. 되돌릴 수 없습니다.`, '해고', true))) return;
        if (run(game.command({ type: 'fire', staffId: x.id }))) { staffSel = null; toast(`${x.name}${josa(x.name, '을/를')} 해고했습니다. 퇴직금 ${money(x.severance)}`); render(); }
        return;
      }
      case 'upgradeHQ': {
        if (!game) return; const h = Q.hqInfo(game.state); if (!h.next) return;
        if (!(await ask(`본사를 ${h.next.level}등급 「${h.next.name}」${josa(h.next.name, '으로/로')} 키울까요?\n비용 ${money(h.next.cost)}이 바로 나가고, 매달 유지비가 ${money((h.current.upkeep))}에서 ${money((h.next.upkeep))}${josa(money((h.next.upkeep)), '으로/로')} 늘어납니다.`, '본사 키우기'))) return;
        if (run(game.command({ type: 'upgradeHQ' }))) { toast(`본사가 「${h.next.name}」${josa(h.next.name, '으로/로')} 커졌습니다. 정원 ${h.next.staffCap}명, 동시에 개발할 수 있는 차 ${h.next.teams}대.`, 'alert', '본사'); render(); }
        return;
      }
      case 'expandFactory': {
        if (!game) return; const f = Q.factoryInfo(game.state); if (!f.next) return;
        if (!(await ask(`공장을 ${f.next.level}등급으로 증설할까요?\n건설비 ${money(f.next.cost)}${josa(money(f.next.cost), '이/가')} 바로 나갑니다. 공사는 ${f.next.buildMonths}개월 걸리고, 그동안은 지금 공장으로 생산합니다. 다 지으면 공장 유지비가 매달 ${money((f.current.upkeep))}에서 ${money((f.next.upkeep))}${josa(money((f.next.upkeep)), '으로/로')} 늘어납니다.`, '증설하기'))) return;
        if (run(game.command({ type: 'expandFactory' }))) { toast(`공장 증설 공사를 시작했습니다. ${f.next.buildMonths}개월 뒤 끝납니다.`, 'alert', '공장'); render(); }
        return;
      }
      case 'buildBatteryPlant': { // 1.2.0
        if (!game) return; const B = Q.batteryPlantInfo(game.state), n = B.next; if (!n) return;
        if (!(await ask(`배터리 공장을 ${n.level}등급으로 ${B.level ? '증설' : '건설'}할까요?\n건설비 ${money(n.cost)}${josa(money(n.cost), '이/가')} 바로 나갑니다. 공사는 ${n.buildMonths}개월 걸리고, 다 지으면 전기차 대당 원가가 ${Math.round(n.cut * 100)}% 줄고 유지비가 매달 ${money(n.upkeep)} 듭니다.`, B.level ? '증설하기' : '건설하기'))) return;
        if (run(game.command({ type: 'buildBatteryPlant' }))) { toast(`배터리 공장 공사를 시작했습니다. ${n.buildMonths}개월 뒤 끝납니다.`, 'alert', '배터리 공장'); render(); }
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
      case 'borrow': if (game && run(game.command({ type: 'borrow', amount: Number(v) }))) { toast(`${money(Number(v))}${josa(money(Number(v)), '을/를')} 빌렸습니다.`); render(); } return;
      case 'repay': if (game && (v !== 'all' || (await ask(`대출 ${money(game.state.loan.balance)}${josa(money(game.state.loan.balance), '을/를')} 모두 갚을까요?\n현금이 ${money(game.state.cash)}에서 ${money(game.state.cash - game.state.loan.balance)}${josa(money(game.state.cash - game.state.loan.balance), '으로/로')} 줄어듭니다.`, '모두 갚기'))) && run(game.command({ type: 'repay', amount: v === 'all' ? game.state.loan.balance : Number(v) }))) { toast('대출을 갚았습니다'); render(); } return;
      case 'bailout': {
        if (!game) return;
        if (!(await ask(`구제 금융을 받을까요? (${bailInfo().line}, 남은 ${bailInfo().left}번)\n현금이 0이 되고, 평판이 ${-config.bankruptcy.bailoutRep} 떨어지며, 대출 한도가 절반이 됩니다.`, '받기', true))) return;
        const r = game.command({ type: 'bailout' });
        if (!r.ok) return err(r.reason);
        if (gameOverShown) { gameOverShown = false; title.hidden = true; title.className = 'cover'; screen = 'garage'; lastPanel = ''; lastOv = ''; }
        toast('구제 금융을 받았습니다. 현금이 0이 되었습니다.', 'alert'); render(); return;
      }
      case 'titleNew': titleMode = 'new'; logoDraft = { ...DEFAULT_LOGO }; diffSel = Q.difficultyInfo().find((d) => d.isDefault)?.id ?? 'easy'; nsYear = config.time.startYear; nsCond = 'normal'; nsChal.clear(); void showTitle(); return;
      case 'titleHome': titleMode = 'home'; void showTitle(); return;
      case 'newGame': titleMode = 'new'; logoDraft = { ...DEFAULT_LOGO }; void showTitle(); return;
      case 'home': if (game && game.state.status === 'playing' && dirty && !(await ask('처음 화면으로 갈까요? 저장하지 않은 진행은 마지막 자동 저장까지만 남습니다.', '처음 화면'))) return; titleMode = 'home'; sheet.hidden = true; void showTitle(); return;
      case 'startNew': {
        const co = $<HTMLInputElement>('#t-co').value.trim(), sd = ($<HTMLInputElement>('#t-seed').value || '').trim();
        const seed = /^\d+$/.test(sd) ? Number(sd) % 4294967296 : Math.floor(Math.random() * 1e9);
        adopt(Game.create({ seed, companyName: co, difficulty: diffSel, startYear: nsYear, condition: nsCond, challenges: Q.CHALLENGES.filter((k) => nsChal.has(k)) }), { photos: {}, colors: {}, logo: cleanLogo(logoDraft) }); toast(`「${game!.state.companyName}」${josa(game!.state.companyName, '을/를')} 세웠습니다(${nsYear}년). 첫 차를 기획할 차례입니다.`); return;
      }
      case 'continue': case 'loadSlot': {
        if (a === 'loadSlot' && game && title.hidden && dirty && !(await ask('마지막 저장 뒤의 진행은 사라집니다. 불러올까요?', '불러오기'))) return;
        await loadKey(v as S.SlotKey); return;
      }
      case 'saveSlot': {
        if (!game) return;
        const has = (await S.list()).some((x) => x.key === v);
        if (has && !(await ask(`저장 칸 ${v.slice(-1)}${josa(v.slice(-1), '을/를')} 덮어쓸까요?`, '덮어쓰기'))) return;
        notePast(game);
        if (await S.put(v as S.SlotKey, S.makeSave(game, uiSnap()))) dirty = false, toast(`저장 칸 ${v.slice(-1)}에 저장했습니다`); else err('저장하지 못했습니다(브라우저 저장 공간 부족)');
        void showMenu(); return;
      }
      case 'export': if (game) { download(saveFileName(), JSON.stringify(S.makeSave(game, uiSnap()))); dirty = false; toast('파일로 내보냈습니다'); } return;
      case 'import': importFile(); return;
      case 'syncOn': { // 1.6.0 연동 켜기: 보관함을 찾거나 만들고, 서버에 저장이 있으면 불러올지 묻는다. 없으면 지금 판을 올린다
        const token = $<HTMLInputElement>('#sy-token').value.trim(), device = $<HTMLInputElement>('#sy-dev').value.trim() || guessDevice();
        if (!token || /\s/.test(token)) return err('GitHub에서 만든 토큰을 붙여 넣으세요.');
        syncBusy = true; syncShow();
        try { const id = await CL.findBox(net, token); sync = { token, device, id }; syncConflict = null; CL.saveCfg(sync); toast('기기 연동을 켰습니다.', '', '기기 연동', 4000, 'sync'); }
        catch (e) { syncBusy = false; syncShow(); toast(`연동을 켜지 못했습니다: ${CL.failText(e)}.`, 'bad', '기기 연동', 9000, 'sync'); return; }
        syncBusy = false; syncShow();
        const m = await CL.peek(net, sync).catch(() => null);
        if (m && m.rev > 0) await syncCheck(false); else if (game && game.state.status === 'playing') { await saveAuto(); await syncUp(); }
        return;
      }
      case 'syncUp': if (game && game.state.status === 'playing') { clearTimeout(saveTimer); saveTimer = 0; await saveAuto(); } await syncUp(); return; // 지금 판을 먼저 자동 저장 칸에
      case 'syncForce': if (await ask('서버의 저장을 이 기기의 자동 저장으로 덮어쓸까요?\n다른 기기에서 한 진행은 서버에서 사라집니다.', '덮어쓰기', true)) await syncUp(true); return;
      case 'syncDown': await syncCheck(true); return;
      case 'syncOff': if (await ask('이 기기의 기기 연동을 끌까요?\n이 기기에 넣은 토큰을 지웁니다. 서버의 보관함과 이 기기의 저장은 그대로 남습니다.', '연동 끄기')) { CL.clearCfg(); sync = null; syncConflict = null; syncShow(); toast('기기 연동을 껐습니다.', '', '기기 연동'); } return;
      case 'debug': debugOn = !debugOn; try { localStorage.setItem(DEBUG_KEY, debugOn ? '1' : '0'); } catch { /* 저장 불가 */ } renderDebug(); showSettings(); return;
      case 'saveEvery': if (SAVE_EVERY.some(([k]) => k === v)) { saveSet.every = v as SaveEvery; keep(SAVE_SET_KEY, saveSet); showSettings(); } return;
      case 'saveBig': saveSet.big = !saveSet.big; keep(SAVE_SET_KEY, saveSet); showSettings(); return;
      case 'undo': doUndo(); return;
      case 'yearOpen': showYearReport(Number(v)); return;
      case 'monthOpen': showMonth(Number(v)); return;
      case 'decadeOpen': showDecade(Number(v)); return;
      case 'autoPause': { const k = v as PauseKey; if (!(k in pauseOn)) return; pauseOn[k] = !pauseOn[k]; try { localStorage.setItem(PAUSE_KEY, JSON.stringify(pauseOn)); } catch { /* 저장 불가 */ } showSettings(); return; }
      case 'noteCat': { const k = v as NoteCat; if (!NOTE_CATS.some(([c]) => c === k) || noteFixed(k)) return; noteSet[k] = !noteOn(k); keep(NOTE_KEY, noteSet); showSettings(); return; }
      case 'settings': showSettings(); return;
      case 'autoSettings': closeDrawer(); showSettings('decide'); return;
      case 'reveal': try { localStorage.setItem(REVEAL_KEY, revealOn() ? '0' : '1'); } catch { /* 저장 불가 */ } showSettings(); return;
      case 'autoKind': case 'autoAll': { // 3.7.0 결정 자동 승인(판 상태에 저장)
        if (!game) return; const kind = a === 'autoAll' ? 'all' : v, on = a === 'autoAll' ? v === '1' : !Q.autoOn(game.state, v);
        if (run(game.command({ type: 'setAutoDecide', kind, on }))) showSettings(); return;
      }
      case 'autoPick': { // 3.7.1 자동으로 고를 답(켜기·끄기는 그대로)
        const k = el.dataset.k; if (!game || !k) return;
        if (run(game.command({ type: 'setAutoDecide', kind: k, on: Q.autoOn(game.state, k), choice: v === 'rule' ? 'rule' : Number(v) }))) showSettings(); return;
      }
      case 'autoGuard': if (game && run(game.command({ type: 'setAutoDecideGuard', on: !Q.autoGuardOn(game.state) }))) showSettings(); return;
      case 'setTab': if (SET_TABS.some(([k]) => k === v)) showSettings(v as SetTab); return;
      case 'menuBack': void showMenu(); return;
      case 'snd': { const k = v as 'muted' | 'weekTick'; if (k !== 'muted' && k !== 'weekTick') return; sound.set({ [k]: !sound.settings()[k] }); renderMute(); showSettings(); return; }
      case 'closeSheet': sheet.hidden = true; todoTab = 'todo'; render(); return;
      case 'todoTab': showTodo(v as 'todo' | 'reports' | 'notes'); return;
      case 'noteTopic': noteTopic = NOTE_CATS.some(([k]) => k === v) ? v as NoteCat : ''; showTodo('notes'); return;
      case 'noteSettings': closeDrawer(); showSettings('note'); return;
      case 'drawerClose': closeDrawer(); return;
      case 'todoLater': if (game) { todoSnooze.set(v || el.dataset.k!, monthOf(game.state.week)); showTodo('todo'); } return; // 이번 달 동안 숨김(다음 달에 다시)
      case 'todoMute': todoMute.add(v); keep(TODO_MUTE_KEY, [...todoMute]); showTodo('todo'); toast(`'${TODO_KIND_NAME[v as Q.TodoKind] ?? v}' 항목을 더는 알리지 않습니다. 메뉴 → 설정 → 알림에서 되돌릴 수 있습니다.`); return;
      case 'todoUnmute': todoMute.delete(v); keep(TODO_MUTE_KEY, [...todoMute]); showSettings('note'); return;
      case 'todoUnsnooze': todoSnooze.clear(); showTodo('todo'); return;
      case 'noteGo': { const x = noteLog.find((y) => y.id === Number(v)); if (x?.open) { sheet.hidden = true; closeDrawer(); x.open.fn(); } return; }
      case 'todoGo': { const t = game && todos().find((x) => x.key === el.dataset.k); if (t) goTarget(t.goto); else if (game) showTodo('todo'); return; }
      case 'todoGoCo': goTarget({ tab: 'company', sub: v }); return;
      case 'repRole': repRole = v as ExecReport['role'] | ''; showTodo('reports'); return;
      case 'repGo': { const r = game && execReports(game.state).find((x) => x.id === Number(el.dataset.id)); if (r?.goto) goTarget(r.goto); return; }
      case 'repClose': case 'repOk': case 'repNo': case 'repCancel': {
        if (!game) return;
        const type: 'dismissReport' | 'approveReplacement' | 'rejectReplacement' | 'cancelReplacement' = a === 'repClose' ? 'dismissReport' : a === 'repOk' ? 'approveReplacement' : a === 'repNo' ? 'rejectReplacement' : 'cancelReplacement';
        if (a === 'repCancel' && !(await ask('교체 고용 예약을 취소할까요?', '예약 취소', true))) return;
        if (run(game.command({ type, id: Number(el.dataset.id) }))) { if (a === 'repOk') toast('교체 고용을 승인했습니다. 조건이 맞으면 진행합니다.'); showTodo('reports'); }
        return;
      }
      case 'logoSheet': showLogoSheet(); return;
      case 'devCheat': {
        if (!game) return; const r = game.devCheat(v as typeof DEV_CHEATS[number][0]);
        if (!r.ok) return err(r.reason);
        for (const e of r.events ?? []) onEvent(e); // 연구 완료 소식 등
        toast(`${DEV_CHEATS.find((x) => x[0] === v)?.[1] ?? v} 적용`, '', '개발자 메뉴', 2500); lastPanel = ''; render(); return;
      }
      case 'devYear': { // 화면 갱신 없이 48주. 사건 창·자동 멈춤 없이
        if (!game) return; quietChoice = skipPause = skipping = true;
        try { batched(() => { for (let i = 0; i < 48 && game!.state.status === 'playing'; i++) tickOnce(); }); } finally { quietChoice = skipPause = skipping = false; }
        toast('48주를 건너뛰었습니다.', '', '개발자 메뉴', 2500); lastPanel = ''; render(); return;
      }
      case 'diff': diffSel = v as Difficulty; for (const b of document.querySelectorAll<HTMLElement>('[data-act="diff"]')) b.setAttribute('aria-pressed', String(b.dataset.v === v)); { const l = document.getElementById('ns-line'); if (l) l.textContent = nsLine(); } return;
      case 'nsYear': nsYear = Number(v); nsChanged(); return;
      case 'nsCond': nsCond = v as StartCondition; nsChanged(); return;
      case 'lg': { const L = logoTarget(), k = el.dataset.k as 'shape' | 'mark' | 'bg' | 'fg'; (L as unknown as Record<string, string>)[k] = v; if (k === 'mark' && v === 'text' && !L.text) L.text = [...(game?.state.companyName || ($<HTMLInputElement>('#t-co')?.value ?? '')).trim()][0] ?? '가'; logoChanged(); return; }
      case 'lgRand': {
        const L = logoTarget(), pick = <T>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)]; // 화면 전용 무작위(sim과 무관)
        L.shape = pick(Object.keys(LOGO_SHAPES) as LogoSpec['shape'][]); L.mark = pick(Object.keys(LOGO_MARKS).filter((k) => k !== 'text') as LogoSpec['mark'][]);
        L.bg = pick(LOGO_BG); do L.fg = pick(LOGO_FG); while (L.fg === L.bg); L.border = Math.random() < 0.4; logoChanged(); return;
      }
    }
  }

  document.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    if (!b || b.hasAttribute('disabled')) return;
    curAct = b.dataset.act!; actHist = game?.state.history.length ?? -1; undoShown = false;
    void act(curAct, b).finally(() => { // 0.8.0 되돌릴 수 있는 조작인데 알림이 없었으면 [되돌리기] 한 줄
      if (game && game.state.history.length > actHist && !Q.undoInfo(game.state).available) dropUndoBtns(); // 되돌릴 수 없는 조작을 했으면 이전 버튼도 무효
      if (undoFresh()) toast(Q.undoInfo(game!.state).label, '', '조작함', 8000, 'undo', undefined, 'act');
      actHist = -1;
    });
  });
  document.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === 'lg-text') { logoTarget().text = [...t.value.trim()].slice(0, 2).join(''); logoChanged(true); return; }
    if (t.id === 'lg-border') { logoTarget().border = t.checked; logoChanged(); return; }
    if (t.id === 'sy-dev') { const d = t.value.trim(); if (sync) { sync.device = d || guessDevice(); CL.saveCfg(sync); } else syncDev = d; return; } // 1.6.0 기기 이름
    if (t.dataset.ch) { const k = t.dataset.ch as Challenge; if (t.checked) nsChal.add(k); else nsChal.delete(k); return; } // 1.5.0 새 게임 도전 과제
    if (t.id === 'dname' && derive) { derive.name = t.value; const o = document.getElementById('dname-ov'); if (o) o.textContent = t.value.trim() || (t.placeholder ?? ''); return; } // 1.3.0 파생 모델 이름
    if (t.id === 'pname' && draft) { draft.name = t.value; const o = document.getElementById('pname-ov'); if (o) o.textContent = t.value.trim() || defaultName(); }
    else if (t.id === 'lprice' && launch) { launch.price = Number(t.value); render(); }
    else if (t.id === 'gprice') { garagePrice.set(Number(t.dataset.gen), Number(t.value)); render(); }
    else if (t.classList.contains('alloc-r')) { const o = t.parentElement?.querySelector('.alloc-v'); if (o) o.textContent = `${t.value}%`; sfx('sliderTick'); }
    else if (t.classList.contains('snd-r')) { sound.set({ [t.dataset.k!]: Number(t.value) / 100 }); const o = t.parentElement?.querySelector('b'); if (o) o.textContent = `${t.value}%`; sfx('sliderTick'); }
  });
  // 가격 슬라이더: 손가락 위치를 직접 값으로 바꾼다(브라우저 기본 슬라이더는 작은 손잡이만 잡히고, 패널 스크롤·다시 그리기와 다퉈 놓치기 쉬웠다).
  // −/+ 버튼은 한 번에 한 단계, 길게 누르면 연속. 키보드는 기본 슬라이더 그대로
  let pxMove = false, pxRep = 0;
  const setPx = (r: HTMLInputElement, v: number) => {
    const min = Number(r.min), max = Number(r.max), st = Number(r.step) || 1, x = Math.max(min, Math.min(max, min + Math.round((v - min) / st) * st));
    if (String(x) !== r.value) { r.value = String(x); r.dispatchEvent(new Event('input', { bubbles: true })); sfx('sliderTick'); }
  };
  const pxAt = (r: HTMLInputElement, x: number) => { const b = r.getBoundingClientRect(), k = Math.max(0, Math.min(1, (x - b.left - 22) / Math.max(1, b.width - 44))); return Number(r.min) + k * (Number(r.max) - Number(r.min)); }; // 22: 손잡이 반지름(CSS 44px)
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Element, tr = t.closest<HTMLElement>('.px-track'), stp = t.closest<HTMLElement>('.px-step');
    const r = (tr ?? stp?.parentElement)?.querySelector<HTMLInputElement>('.px-r');
    if (!r || e.button !== 0) return;
    e.preventDefault(); pxHold = r;
    if (tr) { tr.setPointerCapture(e.pointerId); pxMove = true; setPx(r, pxAt(r, e.clientX)); return; }
    const d = Number(stp!.dataset.step) * (Number(r.step) || 1), once = () => setPx(r, Number(r.value) + d);
    once(); pxRep = window.setTimeout(function rep() { once(); pxRep = window.setTimeout(rep, 70); }, 420);
  });
  document.addEventListener('pointermove', (e) => { if (pxMove && pxHold) setPx(pxHold, pxAt(pxHold, e.clientX)); });
  const pxEnd = () => { if (!pxHold) return; const r = pxHold; pxHold = null; pxMove = false; clearTimeout(pxRep); r.dispatchEvent(new Event('change', { bubbles: true })); };
  document.addEventListener('pointerup', pxEnd); document.addEventListener('pointercancel', pxEnd);
  document.addEventListener('click', (e) => { const b = (e.target as Element).closest<HTMLElement>('.px-step'); if (b && e.detail === 0) { const r = b.parentElement?.querySelector<HTMLInputElement>('.px-r'); if (r) setPx(r, Number(r.value) + Number(b.dataset.step) * (Number(r.step) || 1)); } }); // 키보드(Enter·Space)로 누른 −/+
  // 두 번 톡·핀치로 게임 화면 전체가 확대되지 않게(CSS touch-action·viewport와 함께. 사무실은 자체 핀치를 쓴다)
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => { if (!(e.target as Element).closest?.('#office')) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && !(e.target as Element).closest('#office')) e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerdown', () => { dragging = true; });
  document.addEventListener('pointerup', () => { dragging = false; });
  document.addEventListener('pointercancel', () => { dragging = false; });
  document.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.topt === 'keepEng' || t.dataset.topt === 'busy') { teamOpt[t.dataset.topt] = t.checked; lastPanel = ''; render(); return; } // 1.0.0 자동 배치 선택
    if (t.classList.contains('px-r')) render(); // 놓으면 패널 전체를 다시 그린다(예상 평론 등)
    else if (t.classList.contains('alloc-r') && game) { // 직접 배분: 놓을 때 적용. 합이 100%를 넘으면 sim의 이유를 그대로 보여 준다
      const r = game.command({ type: 'setAllocation', generationId: Number(t.dataset.gen), share: Number(t.value) / 100 });
      allocWhy = r.ok ? '' : r.reason; if (!r.ok) err(r.reason); dragging = false; lastPanel = ''; render();
    }
  });
  for (const b of document.querySelectorAll<HTMLElement>('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
  $('#hqback').addEventListener('click', () => { if (game && subView !== null) closeSub(); }); // 3.1.0 운영 전환에서 본사로
  for (const b of document.querySelectorAll<HTMLElement>('#tabs button')) b.addEventListener('click', () => { if (!game) return; if (b.dataset.tab === 'garage') garageSum = true; go(b.dataset.tab === 'dev' ? devScreen() : b.dataset.tab as Screen); }); // 차고를 누르면 전 차종 표부터
  $('#menubtn').addEventListener('click', () => void showMenu());
  $('#mutebtn').addEventListener('click', () => { sound.set({ muted: !sound.settings().muted }); renderMute(); });
  { let lastTap = -1e9; $('#mylogo').addEventListener('click', (e) => { if (e.timeStamp - lastTap < 550) { lastTap = -1e9; showDevMenu(); } else lastTap = e.timeStamp; }); } // 두 번 톡(확대 막기는 dblclick 기본 동작만 막으므로 click 두 번은 그대로 온다)
  $('#evchip').addEventListener('click', () => { if (game) showEvents(); });
  $('#plchip').addEventListener('click', () => { if (game) { sheet.hidden = true; go('fin'); } });
  $('#pend').addEventListener('click', () => { if (game) showChoice(); });
  $('#todobtn').addEventListener('click', () => { if (!game) return; if (skip) setSpeed(0); showTodo(execUnread(game.state) && !todoCount().length ? 'reports' : 'todo'); });
  $('#skipbtn').addEventListener('click', () => startSkip());
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#ask').hidden) $('#ask-no').click();
    else if (sheet.hidden && !drawer.hidden) closeDrawer();
    else if (!sheet.hidden) { const close = sheetBody.querySelector<HTMLElement>('[data-act="closeReview"],[data-act="closeSheet"],[data-act="later"]'); close?.click(); }
  });
  // 1.0.0 창 바깥(어두운 영역)을 누르면 닫기: 누르기 시작과 뗀 곳이 모두 바깥일 때만(창 안에서 시작한 끌기·스크롤은 닫지 않음).
  // 확인 창은 [아니요](취소)와 같게. 결정할 사건 창·출시 공개 장면·내용이 있는 입력 칸이 있는 창은 닫지 않는다. 닫기는 창의 닫기 버튼을 누른 것과 같은 경로
  let downOn: EventTarget | null = null;
  document.addEventListener('pointerdown', (e) => { downOn = e.target; }, true);
  for (const box of [sheet, $('#ask')]) box.addEventListener('click', (e) => {
    if (e.target !== box || downOn !== box) return;
    if (box !== sheet) { $('#ask-no').click(); return; }
    if (!$('#ask').hidden || sheet.classList.contains('rvl-on') || sheetBody.querySelector('.choice-sheet')) return;
    if ([...sheetBody.querySelectorAll<HTMLInputElement>('input[type=text]')].some((x) => x.value.trim())) return;
    sheetBody.querySelector<HTMLElement>('[data-act="closeReview"],[data-act="closeSheet"],[data-act="later"]')?.click();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target as HTMLElement;
    if (t.id === 't-co') $('[data-act="startNew"]').click();
    else if (!e.isComposing && t.matches('.rename-sheet input.namein')) { e.preventDefault(); t.closest('.rename-sheet')?.querySelector<HTMLElement>('.btn.ink')?.click(); } // 3.1.1 이름 변경 창(본사 차·자회사 모델): Enter로 [이름 바꾸기]. 한글 조합 중 Enter는 조합만 끝낸다
  });

  // 스모크 테스트·디버그용
  (window as unknown as { __car: unknown }).__car = {
    get game() { return game; }, get screen() { return screen; }, get ui() { return ui; }, get speed() { return speed; }, get stage() { return stage; },
    tick(n = 1, popups = false) { quietChoice = !popups; try { for (let i = 0; i < n && game && game.state.status === 'playing'; i++) tickOnce(); } finally { quietChoice = false; } render(); },
    get look() { return lookKey; },
    events: (list: GameEvent[], frames = 1) => { for (let k = 0; k < frames; k++) batched(() => list.forEach(onEvent)); }, // 3.6.0 알림 묶기 점검: 한 화면 갱신에 온 이벤트처럼(frames번 되풀이)
    get draft() { return draft; }, get lift() { return lift; }, get launch() { return launch; }, get planTab() { return planTab; },
    genLook: (id: number) => { const g = game && Q.generationById(game.state, id); return g ? genLook(g) : null; },
    get tip() { return tip.hidden ? null : { key: tip.dataset.key, hover: tipHover, text: tip.innerText }; },
    setSpeed, render, held: isHeld, toast, get sound() { return sound.settings(); },
    get office() { return { on: officeOn, view: officeLast, scores: officeScores }; },
    get skip() { return !!skip; }, todos: () => (game ? todos() : []), Q,
    get garageId() { return garageId; }, get garageSum() { return garageSum; }, goTarget, showMonth, goCo, // goCo(4.0.0 점검용)
    get noteSet() { return noteSet; }, // 1.3.0 점검용: 알림 유형 켜고 끄기(기기 저장소에는 쓰지 않음)
  };

  makeStage();
  void showTitle();
}
