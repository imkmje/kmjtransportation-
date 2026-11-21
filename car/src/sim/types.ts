// 카 컴퍼니 sim의 자료 구조. 금액 단위는 만원, 시간 단위는 주(week, 0부터).

/** 능력치 5개: 성능·연비·실용·디자인·품질 */
export type Stat = 'P' | 'E' | 'U' | 'D' | 'Q';
export const STATS: Stat[] = ['P', 'E', 'U', 'D', 'Q'];
export type Stats = Record<Stat, number>;

// ---------- 자료(JSON) ----------
export interface BodyDef { id: string; name: string; info: string; year: number; cost: number; basePrice: number; mult: Stats }
/** startLevel: 해금 때의 동력 단계(5.3, 연구로 오른다). minCostAdd: 연구로 줄일 수 있는 원가 가산의 바닥(전기) */
export interface PowertrainDef { id: string; name: string; info: string; year: number; split: { P: number; E: number }; costAdd: number; startLevel: number; minCostAdd?: number; premium?: { years: number[]; values: number[] }; tiers: { name: string; costAdd: number }[] }
export interface OptionDef { id: string; name: string; info: string; year: number; U: number; D: number; Q: number; cost: number; expect?: Record<'big' | 'mid' | 'small', [number, number]> } // expect(1.1.0): 차급별 [흔해지는 해, 기대되는 해](9999 = 그런 때가 오지 않음)
export type EquipLevel = 'opt' | 'std'; // 1.1.0 선택 사양 / 기본 장비(없으면 안 넣음)
export type Equip = Record<string, EquipLevel>;
export interface SegmentDef { id: string; name: string; info: string; w: Stats; eps: number }
export interface RegionMarket { name: string; years: number[]; annual: number[]; bodyShare: Record<string, number[]>; mix: Record<string, Record<string, number>>; trend?: Record<string, number[]> } // trend: 차체·동력의 연대별 유행 계수(없으면 1)
export interface RivalDef { id: string; name: string; trait: string; cells: Record<string, number> }

/** 연구 분야 5개(10장) */
export type TechField = 'powertrain' | 'body' | 'electronics' | 'production' | 'eco';
/** 기술 효과: 해금(차체·옵션·동력 종류), 동력 단계 +amount, 비율 효과(원가·결함·공장 유지비 인하, 개발 속도, 전기 원가 가산 인하) */
export type TechEffect =
  | { type: 'body' | 'option' | 'powertrain'; id: string }
  | { type: 'ptLevel'; id: string; amount: number }
  | { type: 'costCut' | 'defectCut' | 'upkeepCut' | 'devSpeed' | 'evCostCut'; value: number };
/** info: 설명 창(ⓘ)용 사전식 풀이(자료 5종 모두에 있다) */
export interface TechDef {
  id: string; name: string; desc: string; info: string; field: TechField; year: number; pre: string[]; effects: TechEffect[];
  cost: { money: number; points: number }; repeatable?: boolean; // repeatable: 2035년 이후 반복 연구(할 때마다 비용 증가)
}
/** 시대 사건 효과(11장). months가 null인 사건은 영구 */
export type EraEffect =
  | { type: 'statWeight'; stat: Stat; mult: number } // 모든 고객층의 그 능력치 가중치 배수(가중치 합 1로 다시 맞춘다)
  | { type: 'bodyDemand'; bodies: string[]; mult: number } // 차체 칸 수요 배수
  | { type: 'ptDemand'; powertrain: string; mult: number } // 그 동력 차의 수요 배수
  | { type: 'segDemand'; segment: string; mult: number } // 고객층 비중 배수
  | { type: 'marketSize'; region: string; mult: number } // 지역 시장 규모 배수('all' = 전 지역)
  | { type: 'trend'; id: string; add: number; perYear?: number } // 유행 가산(perYear: 시작부터 해마다 더하는 값)
  | { type: 'loanRate'; mult: number }
  | { type: 'production'; mult: number } // 전 공장 생산 배수
  | { type: 'regulation'; region: string; options?: string[]; powertrains?: string[]; graceMonths: number } // 유예 뒤 옵션이 없거나 그 동력이면 신규 출시 불가
  | { type: 'charging' } // 충전 인프라가 이 사건부터 쌓인다
  | { type: 'exportEase'; mult: number }; // 수출 지역 해금 조건 완화(5단계 수출 전까지 효과 없음)
export interface EraEventDef { id: string; name: string; year: number; month: number; months: number | null; warn: string; start: string; end: string; effects: EraEffect[] }
/** 무작위 사건 선택지 효과 */
export type ChoiceEffect =
  | { type: 'cash'; base: number; revenue?: number; salaries?: number } // 돈 = base + 최근 월평균 매출 × revenue + 월급 합 × salaries (음수면 지출)
  | { type: 'rep'; value: number }
  | { type: 'awareness'; value: number; target: 'car' | 'all' } // 인지도 가산
  | { type: 'awarenessMult'; value: number } // 대상 차 인지도 배수
  | { type: 'condition'; value: number } // 전 직원 컨디션 가산
  | { type: 'fixDefects'; costShare: number } // 대상 차 결함 수리(누적 판매 × 리콜 대당 비용 × costShare), 리콜 위험 0
  | { type: 'mod'; mod: 'production' | 'cost'; value: number; months: number } // 기간 배수(생산·원가). value 0이면 사건이 정한 값(환율)
  | { type: 'hire'; abilityMin: number; abilityMax: number }; // 인재 영입(정원 안에서)
export interface RandomEventDef {
  id: string; name: string; text: string; // text의 {car}는 대상 차 이름
  needs: 'none' | 'carOnSale' | 'defectCar' | 'staffRoom' | 'rivalCell';
  choices: { label: string; result: string; effects: ChoiceEffect[] }[];
  defaultChoice: number;
  onFire?: { type: 'rivalHit'; add: number; months: number } | { type: 'fxRoll'; good: number; bad: number; goodShare: number }; // 사건이 뜰 때 바로 생기는 일
}

// ---------- 상태 ----------
export type Role = 'designer' | 'engineer' | 'tester' | 'sales';
/** 개발 직무(프로젝트에 배치할 수 있는 직무). 영업은 배치하지 않는다 */
export type DevRole = Exclude<Role, 'sales'>;
export interface Staff {
  id: number; name: string; role: Role; ability: number;
  potential: number; // 개인별 능력 상한(9.1)
  condition: number; // 0~1
  projectId: number | null;
  trainings: number[]; // 교육을 시작한 주(연 2회 제한·교육 중 판정). 마지막 값 + 4주 전까지 교육 중
  restUntil: number | null; // 이 주 전까지 강제 휴식(산출 0, 회복)
  lab: boolean; // 전담 연구원(10장, 본사 4등급부터): 프로젝트에 배치되지 않고 연구 점수 ×1.5
  hist?: StaffHist; // 0.10.0 성장 기록(없으면 예전 저장: 다음 월 결산부터 쌓는다)
}
/** 직원 성장 기록(0.10.0). join·joinAbility: 입사 주·입사 때 능력(예전 저장은 null, since부터 기록), years: 연도 → 그해 12월 결산 때 능력,
 *  cars: 참여해 출시한 차(세대 ID, 프로젝트 종류), execs: 임원 경력(to null = 지금 임원) */
export interface StaffHist { join: number | null; joinAbility: number | null; since: number; years: Record<string, number>; cars: { gen: number; kind: ProjectKind }[]; execs: { role: ExecRole; from: number; to: number | null }[] }
/** 채용 후보(공고 1회에 3명, 4주 뒤 사라짐). salary = 요구 월급(= 250 + 능력 × 12) */
export interface Candidate { id: number; name: string; role: Role; ability: number; potential: number; salary: number; expiresWeek: number }

export type Budget = 'low' | 'normal' | 'high';
/** 신차 기획(6.1): 기획 단계에서 정하는 것 전부 */
export interface ProjectSpec {
  name: string; body: string; segment: string; powertrain: string;
  tier: number; // 동력 등급 1~3(보급형/표준/고급) = 연구한 최신 단계에서 −2/−1/0 단계(4단계부터)
  options: string[]; direction: Stats; budget: Budget; designWeeks: number;
  equip?: Equip; // 1.1.0 장비 구성(안 넣음/선택 사양/기본 장비). 주면 options는 기본 장비 목록으로 맞춰진다(없으면 options가 모두 기본 장비)
}
/** 프로젝트 종류(8장): 새 차종 / 페이스리프트 / 풀체인지 */
export type ProjectKind = 'new' | 'facelift' | 'fullchange' | 'fix'; // fix: 0.10.0 긴급 개선(targetId = 세대 ID, 설계 없이 시험만, 끝나면 저절로 반영)
export interface Project extends ProjectSpec {
  id: number; startWeek: number;
  level: number; // 실제 동력 단계(개발을 시작할 때 tier와 연구 단계로 정해 고정)
  kind: ProjectKind;
  targetId: number | null; // facelift: 세대 ID, fullchange: 차종 ID, new: null
  chassisSeed: number; faceSeed: number; // 3D 모양 시드(sim은 숫자만 보관)
  phase: 'design' | 'test';
  weeksDone: number; // 설계 주 수
  testWeeks: number;
  points: Stats; // 개발로 쌓은 원점수(차체 배수 적용 전)
  defects: number; // 실제 결함(화면에는 defectEst만)
  defectEst: number; // 화면용 "약 N개"(±15% 오차, 매주 다시 뽑음)
  spent: number; // 지금까지 쓴 개발비
  waiting?: boolean; // 출시 대기(0.4.1): 시험 중 실제 결함이 0이 되고 최소 시험 주를 채우면 true. 그 뒤로는 주간 개발비 0, 직원은 풀려난다(없으면 false)
  crew?: number[]; // 출시 대기가 될 때 풀려난 직원 ID(출시 때 경험을 받는다)
}

/** 판: 초기형 / 페이스리프트(2단계). 가격·옵션·능력치는 판마다 다를 수 있다 */
export interface Edition {
  id: number; kind: 'initial' | 'facelift'; launchWeek: number;
  tier: number; level: number; options: string[]; stats: Stats; equip?: Equip; equipLegacy?: boolean; // equipLegacy(1.1.0): 형식 4에서 올라온 출시된 판. 시대의 기대 감점·가점을 받지 않는다. options: 기본 장비(의무 장비 포함), equip(1.1.0): 선택 사양까지 든 구성(없으면 options가 모두 기본 장비)
  // tier: 동력 등급 1~3, level: 실제 동력 단계. stats: 출시 시 확정된 원점수(결함 감점 포함)
  defects: number; // 출시 때 남은 결함(리콜 확률), 리콜 뒤 0
  price: number; color: string; wheels: 0 | 1 | 2;
  faceSeed: number; // 얼굴(전조등·그릴 등) 3D 시드
  headline: string | null; // 출시 기사 한 줄(페이스리프트·전작 비교·부활), 없으면 null
}
/** 세대: 차체·동력 종류·고객층이 같은 한 묶음 */
export interface Generation {
  id: number; number: number; body: string; segment: string; powertrain: string;
  launchWeek: number; launchMonth: number; // launchMonth: 월 번호(0 = 1970년 1월)
  lifeMonth: number; // 수명 나이의 기준 달(수명 나이 = 지금 달 − lifeMonth). 출시 때 launchMonth, 페이스리프트가 되돌린다(소수 가능)
  chassisSeed: number; // 차대(차 전체 모양) 3D 시드
  points: Stats; // 개발로 쌓은 원점수(차체 배수 적용 전). 페이스리프트가 다시 계산할 때 쓴다
  equity: number; // 출시 때 이어받은 차종 자산(인지도 가산, 0~0.3)
  rebuy: number; // 기존 고객 재구매: 첫 12개월 동안 매달 더해지는 수요(대)
  marketing: number; // 0~3
  awareness: number; // 인지도 0~1
  status: 'onSale' | 'ending' | 'discontinued';
  endMonth: number | null; // 단종한 달(월 번호)
  editions: Edition[];
  reviews: number[]; reviewAvg: number; masterpiece: boolean;
  sales: number[]; // 출시 달부터 월별 판매 대수
  totalSold: number;
  lastDemand: number; // 지난달 수요(생산 상한 적용 전, 조언용)
  lostSales: number; // 지난달 생산 한도 때문에 못 판 대수(= 수요 − 판매, 0 이상)
  allocShare: number | null; // 생산 배분 수동 몫(0~1, 공장 한도 대비). null = 수요 비례 자동
  devCost: number; // 이 세대 개발에 쓴 돈
  profit: number; // 누적 이익(판매가 − 원가 − 마케팅 − 리콜)
  recalls: number;
  pricePolicy?: PricePolicy | null; // 0.8.0 자동 가격(없거나 null = 수동)
  plan?: GenPlan; // 0.8.0 출시 때의 기획 값(풀체인지가 물려받는다). 예전 저장에는 없다
  pnl?: GenPnl; // 0.10.0 손익 누적(없으면 예전 저장: 다음 결산 때 판매 기록으로 추정해 만든다)
  fixed?: { week: number; cost: number }; // 0.10.0 긴급 개선을 마친 주와 든 돈(세대당 1회)
  clearance?: { startMonth: number; lastMonth: number; price: number }; // 0.10.0 가격 인하 판매: lastMonth 결산 뒤 자동 단종
}
/** 세대 손익 누적(0.10.0): 매출·원가·광고비·리콜비, 개발비(처음·페이스리프트·의무 장비·긴급 개선), 월별 이익(sales와 같은 길이). est: 예전 저장에서 추정한 값이 섞임 */
export interface GenPnl { rev: number; cogs: number; mk: number; recall: number; dev: { base: number; lift: number; retro: number; fix: number }; months: number[]; est?: true }
/** 자동 가격(0.8.0): 시장 기준가의 pct% 유지 / 매달 최고 이익 가격. 월 결산 직전에 적용 */
export type PricePolicy = { kind: 'base'; pct: number } | { kind: 'best' };
/** 세대 기획 값(0.8.0): 개발 방향·예산·설계 기간, 출시 때 쓸 수 있던 옵션(풀체인지에서 "새로 가능" 판단용) */
export interface GenPlan { direction: Stats; budget: Budget; designWeeks: number; opts: string[] }
/** 차종: 이름이 같은 세대들의 묶음 */
export interface Nameplate { id: number; name: string; generations: Generation[] }

/** 경쟁 차 한 대(칸 하나): n번째 모델, start 달에 출시, cycle개월 뒤 교체, base = 새 차일 때의 기본 A */
export interface RivalModel { n: number; start: number; cycle: number; base: number }
export interface RivalState { id: string; name: string; cells: Record<string, number>; models: Record<string, RivalModel> } // cells: 칸(차체)별 지금 점유 점수 A

export interface LedgerEntry {
  month: number; year: number; monthOfYear: number;
  revenue: number; cogs: number; salaries: number; upkeep: number; dev: number; marketing: number; interest: number; recall: number;
  upkeepHq?: number; // 0.5.1: upkeep 중 본사 몫(공장 몫 = upkeep − upkeepHq). 예전 장부에는 없다
  oneOff: number; // 일회성 지출(채용 공고·교육·퇴직금·본사 승급·공장 건설). 명령 때 현금에서 바로 나가고, 장부에는 그달 지출로 적는다
  profit: number; cash: number; sold: number;
  cars?: LedgerCar[]; execPay?: number; research?: number; // 0.9.0 월 결산 창용(예전 장부에는 없다): 차종별 한 줄, salaries 중 임원 몫, oneOff 중 연구 시작 비용
}
/** 0.9.0 장부의 차종별 한 줄(세대 ID). 이익 = 매출 − 원가 − 광고 − 리콜 */
export interface LedgerCar { id: number; sold: number; revenue: number; cogs: number; marketing: number; recall: number }

/** 연구 상태(10장). done: 완료한 기술 ID(반복 기술은 여러 번), active: 진행 중(시작 순), early: 등장 연도보다 먼저 완료해 "세계 최초"를 아직 쓰지 않은 기술 */
export interface ResearchState {
  done: string[];
  active: { techId: string; points: number; need: number; startWeek: number }[];
  early: string[];
  priority?: string; // 0.5.1 우선 연구(맨 앞, 주간 점수의 50%). 없으면 고르게 나눈다
}
/** 무작위 사건의 답을 기다리는 선택(4주 뒤 기본 선택) */
export interface PendingChoice { id: number; eventId: string; text: string; week: number; deadline: number; genId: number | null; fx: number | null }
/** 무작위 사건이 남긴 기간 효과(생산·원가 배수, 경쟁 차 히트작) */
export interface EventMod { kind: 'production' | 'cost' | 'rivalHit'; value: number; untilMonth: number; body?: string; rivalId?: string; label: string }
/** 뉴스 종류: 예고 / 사건 시작 / 사건 끝 / 규제 시행 / 선택 사건(답 기다림) / 선택 결과 / 연구 / 그 밖(출시 기사 등) */
export type NewsCategory = 'preview' | 'start' | 'end' | 'regulation' | 'choice' | 'result' | 'research' | 'other';
export interface NewsItem { week: number; text: string; category?: NewsCategory } // category가 없는 예전 항목은 'other'로 본다
export interface EventsState { pending: PendingChoice[]; mods: EventMod[]; news: NewsItem[] }

// ---------- 임원(0.7.0) ----------
/** 임원 6자리: 인사·기획·재무·생산·연구소장·시장 조사 */
export type ExecRole = 'hr' | 'product' | 'finance' | 'production' | 'research' | 'market';
/** 임원 자리: 임명한 직원(직원 목록에서 빠져 여기 있다) 또는 외부에서 뽑은 사람(hired) */
export interface ExecSeat { staff: Staff; hired: boolean; since: number }
export interface ExecCandidate { id: number; name: string; role: ExecRole; skill: number; pay: number; expiresWeek: number }
/** 이동할 화면(tab: 회사·차고 등, sub: 회사 탭 안쪽, id: 직원·세대 ID 등) */
export interface ExecGoto { tab: string; sub?: string; id?: number }
/** 보고 한 건. key: 제안 대상(직원·차·기술 ID 등, 재발행 금지에 쓴다). auto: 맡기기·교체 고용이 실행한 일의 기록 */
export interface ExecReport { id: number; week: number; role: ExecRole; execName: string; kind: string; key: string; text: string; facts: string[]; goto: ExecGoto | null; unread: boolean; auto: boolean; replacementId: number | null }
/** 교체 고용(인사): 제안 → 승인(예약) → 대상이 개발 중이면 대기 → 실행(완료·실패) / 취소 */
export interface Replacement {
  id: number; staffId: number; staffName: string; staffRole: Role; ability: number; minAbility: number;
  status: 'proposed' | 'approved' | 'waiting' | 'done' | 'cancelled' | 'failed';
  tries: number; nextWeek: number; waitingFor: string | null; held: boolean;
}
export interface ExecState {
  seats: Partial<Record<ExecRole, ExecSeat>>;
  delegations: Partial<Record<ExecRole, string[]>>; // 켠 맡기기 키
  candidates: ExecCandidate[];
  reports: ExecReport[]; // 오래된 것이 앞
  cooldown: Record<string, number>; // "자리:종류:대상" → 다시 제안할 수 있는 주
  replacements: Replacement[];
  rejected: Record<string, number>; // 직원 ID → 교체를 다시 제안할 수 있는 주
}

/** 난이도(0.4.1). 새 게임 기본 easy, 필드가 없는 예전 저장은 normal */
export type Difficulty = 'easy' | 'normal' | 'hard';
export interface CarState {
  saveVersion: 5;
  difficulty?: Difficulty;
  seed: number; rng: number;
  week: number;
  companyName: string;
  reputation: number;
  cash: number;
  loan: { balance: number; limitMult: number; bailoutUsed: boolean; bailouts?: number }; // bailoutUsed: 구제 금융을 더 받을 수 없음(난이도의 횟수를 다 씀, 어려움은 처음부터 true), bailouts: 받은 횟수(없으면 bailoutUsed로 0/1)
  negMonths: number; // 현금 음수로 끝난 연속 달 수
  status: 'playing' | 'gameOver';
  staff: Staff[];
  candidates: Candidate[]; // 채용 후보(공고를 내면 3명)
  hqLevel: number; // 본사 등급 1~5(9.2)
  factory: { level: number; build: { level: number; doneMonth: number } | null }; // 공장 등급 1~5, 증설 공사(doneMonth 달 초부터 새 등급)
  projects: Project[];
  nameplates: Nameplate[];
  rivals: RivalState[];
  ledger: LedgerEntry[]; // 최근 24개월
  pendingDev: number; // 이번 달에 쌓인 개발비(월말 정산)
  pendingOneOff: number; // 이번 달 일회성 지출(이미 현금에서 나감, 장부 기록용)
  pendingResearch?: number; // 0.9.0 이번 달 연구 시작 비용(pendingOneOff에 들어 있음, 장부의 research 칸용)
  nextId: number;
  research: ResearchState; // 10장
  events: EventsState; // 11장 무작위 사건·뉴스(고정 사건은 시드와 날짜로 계산)
  knownCombos: string[]; // 5.5 조합 노트: 출시해 본 "차체:고객층"
  history: { week: number; cmd: Command }[]; // 성공한 명령 기록
  execs?: ExecState; // 0.7.0 임원(처음 임원 명령을 쓸 때 생긴다. 없으면 임원 없음, 저장 형식은 그대로 4)
  devUsed?: true; // 개발자 메뉴를 한 번이라도 쓴 게임(업적 제외용). 없으면 안 씀
  years?: Record<string, YearLog>; // 0.8.0 연 보고서용 해마다의 기록(연도 → 기록). 없으면(예전 저장) 장부·차 기록으로 계산할 수 있는 것만 보인다. 저장 형식은 그대로 4
}
/** 한 해의 기록(0.8.0): 평판 이유별 합, 세대 ID별 이익, 연구 완료, 월 결산 합계(months개월), 연말(12월 결산) 현금·직원 수·임원 */
export interface YearLog { rep: Record<string, number>; cars: Record<string, number>; research: string[]; revenue: number; profit: number; sold: number; months: number; cash?: number; staff?: number; execs?: string[] }

// ---------- 명령 ----------
export type Command =
  // team: 배치할 직원 ID(생략하면 쉬고 있는 개발 직무 전원). 시드를 빼면 lookCandidates의 첫 후보
  | ({ type: 'startProject'; chassisSeed?: number; faceSeed?: number; team?: number[] } & ProjectSpec)
  | { type: 'setProjectEquip'; projectId: number; equip: Equip } // 1.1.0 설계 단계 프로젝트의 장비 구성 바꾸기(비용 없음)
  | { type: 'startFacelift'; generationId: number; options: string[]; equip?: Equip; tier?: number; faceSeed?: number; team?: number[] }
  | ({ type: 'startFullChange'; nameplateId: number; chassisSeed?: number; faceSeed?: number; team?: number[] } & Omit<ProjectSpec, 'name'>)
  | { type: 'cancelProject'; projectId: number }
  | { type: 'launch'; projectId: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }
  | { type: 'discontinue'; generationId: number }
  | { type: 'setPrice'; generationId: number; price: number } // 다음 월말 정산부터 반영
  | { type: 'setMarketing'; generationId: number; marketing: number }
  | { type: 'setPricePolicy'; generationId: number; policy: PricePolicy | null } // 0.8.0 자동 가격(수동 setPrice는 정책을 끈다)
  | { type: 'quickFix'; generationId: number; team?: number[] } // 0.10.0 긴급 개선(테스터·엔지니어, 생략하면 쉬는 테스터·엔지니어 전원)
  | { type: 'clearance'; generationId: number } // 0.10.0 가격 인하 판매(정한 기간 뒤 자동 단종)
  | { type: 'retrofit'; generationId: number } // 0.4.2: 판매 중인 차에 지금 의무 장비를 추가(일시 비용 + 원가 상승, 바로 반영)
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'bailout' }
  // ---------- 회사(9장) ----------
  | { type: 'postJob'; role: Role; tier: 1 | 2 | 3 }
  | { type: 'hire'; candidateId: number }
  | { type: 'dismissCandidates' }
  | { type: 'fire'; staffId: number }
  | { type: 'train'; staffId: number }
  | { type: 'rest'; staffId: number; weeks: number }
  | { type: 'assign'; staffId: number; projectId: number | null | 'lab' } // 'lab': 전담 연구원(본사 4등급부터, 엔지니어만)
  | { type: 'upgradeHQ' }
  | { type: 'expandFactory' }
  | { type: 'setAllocation'; generationId: number; share: number | null }
  // ---------- 연구(10장)·사건(11장) ----------
  | { type: 'startResearch'; techId: string }
  | { type: 'cancelResearch'; techId: string } // 쓴 돈은 돌아오지 않는다
  | { type: 'prioritizeResearch'; techId: string } // 0.5.1: 그 연구를 맨 앞으로(주간 점수의 50%를 받는다)
  | { type: 'resolveEvent'; eventId: number; choice: number }
  // ---------- 임원(0.7.0) ----------
  | { type: 'appointExec'; role: ExecRole; staffId: number }
  | { type: 'dismissExec'; role: ExecRole }
  | { type: 'postExecJob'; role: ExecRole }
  | { type: 'hireExec'; role: ExecRole; candidateId: number }
  | { type: 'setDelegation'; role: ExecRole; key: string; on: boolean }
  | { type: 'dismissReport'; id: number }
  | { type: 'markReportsRead' }
  | { type: 'approveReplacement'; id: number }
  | { type: 'rejectReplacement'; id: number }
  | { type: 'cancelReplacement'; id: number }
  | { type: 'devCheat'; kind: DevCheatKind }; // 개발자 메뉴(개발 단계용). 쓰면 상태에 devUsed가 선다
/** 개발자 메뉴: 현금 추가 / 평판 추가 / 진행 중 연구 완료 / 진행 중 개발을 결함 0·출시 대기로 / 전 직원 컨디션 최대 */
export type DevCheatKind = 'cash' | 'reputation' | 'finishResearch' | 'finishDev' | 'restStaff';
/** 성공하면 events에 그 명령이 낸 소식(출시 기사 등)이 올 수 있다 */
export type CommandResult = { ok: true; events?: GameEvent[] } | { ok: false; reason: string };

// unlock: 연구 완료, news: 시대 사건 예고·시작·끝, choice: 답을 기다리는 무작위 사건(id = 선택 ID)
export type EventKind = 'designDone' | 'monthEnd' | 'recall' | 'discontinued' | 'unlock' | 'cashWarning' | 'gameOver' | 'news' | 'advice' | 'company' | 'choice';
export interface BasicEvent { kind: EventKind; text: string; id?: number; category?: NewsCategory } // category: news·choice·unlock의 뉴스 종류
/** 주간 개발 기록(사무실 화면용): 직원별로 그 주에 실제로 쌓은 점수와 결함 증감 */
export interface DevWeekEvent {
  kind: 'devWeek'; text: string; id: number; projectId: number;
  staff: { id: number; stats: Stats }[]; defectsAdded: number; defectsRemoved: number;
}
/** 평판 변화(0.5.1, 화면 알림용): delta 실제 변화량(상한·하한 적용 뒤), reason 이유 한 줄, text = "평판 +2(이유)" */
export interface ReputationEvent { kind: 'reputation'; text: string; delta: number; reason: string }
/** 임원(0.7.0): 월 결산 때 새 보고 수, 교체 고용 실행 결과 */
export interface ExecReportEvent { kind: 'execReport'; text: string; count: number }
export interface ReplacementEvent { kind: 'replacement'; text: string }
export type GameEvent = BasicEvent | DevWeekEvent | ReputationEvent | ExecReportEvent | ReplacementEvent;
