// 카 컴퍼니 sim의 자료 구조. 금액 단위는 만원, 시간 단위는 주(week, 0부터).

/** 능력치 5개: 성능·연비·실용·디자인·품질 */
export type Stat = 'P' | 'E' | 'U' | 'D' | 'Q';
export const STATS: Stat[] = ['P', 'E', 'U', 'D', 'Q'];
export type Stats = Record<Stat, number>;

// ---------- 자료(JSON) ----------
export interface BodyDef { id: string; name: string; info: string; year: number; cost: number; basePrice: number; mult: Stats }
/** startLevel: 해금 때의 동력 단계(5.3, 연구로 오른다). minCostAdd: 연구로 줄일 수 있는 원가 가산의 바닥(전기) */
export interface PowertrainDef { id: string; name: string; info: string; year: number; split: { P: number; E: number }; costAdd: number; startLevel: number; minCostAdd?: number; tiers: { name: string; costAdd: number }[] }
export interface OptionDef { id: string; name: string; info: string; year: number; U: number; D: number; Q: number; cost: number }
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
}
/** 채용 후보(공고 1회에 3명, 4주 뒤 사라짐). salary = 요구 월급(= 250 + 능력 × 12) */
export interface Candidate { id: number; name: string; role: Role; ability: number; potential: number; salary: number; expiresWeek: number }

export type Budget = 'low' | 'normal' | 'high';
/** 신차 기획(6.1): 기획 단계에서 정하는 것 전부 */
export interface ProjectSpec {
  name: string; body: string; segment: string; powertrain: string;
  tier: number; // 동력 등급 1~3(보급형/표준/고급) = 연구한 최신 단계에서 −2/−1/0 단계(4단계부터)
  options: string[]; direction: Stats; budget: Budget; designWeeks: number;
}
/** 프로젝트 종류(8장): 새 차종 / 페이스리프트 / 풀체인지 */
export type ProjectKind = 'new' | 'facelift' | 'fullchange';
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
}

/** 판: 초기형 / 페이스리프트(2단계). 가격·옵션·능력치는 판마다 다를 수 있다 */
export interface Edition {
  id: number; kind: 'initial' | 'facelift'; launchWeek: number;
  tier: number; level: number; options: string[]; stats: Stats; // tier: 동력 등급 1~3, level: 실제 동력 단계. stats: 출시 시 확정된 원점수(결함 감점 포함)
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
}
/** 차종: 이름이 같은 세대들의 묶음 */
export interface Nameplate { id: number; name: string; generations: Generation[] }

/** 경쟁 차 한 대(칸 하나): n번째 모델, start 달에 출시, cycle개월 뒤 교체, base = 새 차일 때의 기본 A */
export interface RivalModel { n: number; start: number; cycle: number; base: number }
export interface RivalState { id: string; name: string; cells: Record<string, number>; models: Record<string, RivalModel> } // cells: 칸(차체)별 지금 점유 점수 A

export interface LedgerEntry {
  month: number; year: number; monthOfYear: number;
  revenue: number; cogs: number; salaries: number; upkeep: number; dev: number; marketing: number; interest: number; recall: number;
  oneOff: number; // 일회성 지출(채용 공고·교육·퇴직금·본사 승급·공장 건설). 명령 때 현금에서 바로 나가고, 장부에는 그달 지출로 적는다
  profit: number; cash: number; sold: number;
}

/** 연구 상태(10장). done: 완료한 기술 ID(반복 기술은 여러 번), active: 진행 중(시작 순), early: 등장 연도보다 먼저 완료해 "세계 최초"를 아직 쓰지 않은 기술 */
export interface ResearchState {
  done: string[];
  active: { techId: string; points: number; need: number; startWeek: number }[];
  early: string[];
}
/** 무작위 사건의 답을 기다리는 선택(4주 뒤 기본 선택) */
export interface PendingChoice { id: number; eventId: string; text: string; week: number; deadline: number; genId: number | null; fx: number | null }
/** 무작위 사건이 남긴 기간 효과(생산·원가 배수, 경쟁 차 히트작) */
export interface EventMod { kind: 'production' | 'cost' | 'rivalHit'; value: number; untilMonth: number; body?: string; rivalId?: string; label: string }
/** 뉴스 종류: 예고 / 사건 시작 / 사건 끝 / 규제 시행 / 선택 사건(답 기다림) / 선택 결과 / 연구 / 그 밖(출시 기사 등) */
export type NewsCategory = 'preview' | 'start' | 'end' | 'regulation' | 'choice' | 'result' | 'research' | 'other';
export interface NewsItem { week: number; text: string; category?: NewsCategory } // category가 없는 예전 항목은 'other'로 본다
export interface EventsState { pending: PendingChoice[]; mods: EventMod[]; news: NewsItem[] }

export interface CarState {
  saveVersion: 4;
  seed: number; rng: number;
  week: number;
  companyName: string;
  reputation: number;
  cash: number;
  loan: { balance: number; limitMult: number; bailoutUsed: boolean };
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
  nextId: number;
  research: ResearchState; // 10장
  events: EventsState; // 11장 무작위 사건·뉴스(고정 사건은 시드와 날짜로 계산)
  knownCombos: string[]; // 5.5 조합 노트: 출시해 본 "차체:고객층"
  history: { week: number; cmd: Command }[]; // 성공한 명령 기록
}

// ---------- 명령 ----------
export type Command =
  // team: 배치할 직원 ID(생략하면 쉬고 있는 개발 직무 전원). 시드를 빼면 lookCandidates의 첫 후보
  | ({ type: 'startProject'; chassisSeed?: number; faceSeed?: number; team?: number[] } & ProjectSpec)
  | { type: 'startFacelift'; generationId: number; options: string[]; tier?: number; faceSeed?: number; team?: number[] }
  | ({ type: 'startFullChange'; nameplateId: number; chassisSeed?: number; faceSeed?: number; team?: number[] } & Omit<ProjectSpec, 'name'>)
  | { type: 'cancelProject'; projectId: number }
  | { type: 'launch'; projectId: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }
  | { type: 'discontinue'; generationId: number }
  | { type: 'setPrice'; generationId: number; price: number } // 다음 월말 정산부터 반영
  | { type: 'setMarketing'; generationId: number; marketing: number }
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
  | { type: 'resolveEvent'; eventId: number; choice: number };
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
export type GameEvent = BasicEvent | DevWeekEvent;
