// 카 컴퍼니 sim의 자료 구조. 금액 단위는 만원, 시간 단위는 주(week, 0부터).

/** 능력치 5개: 성능·연비·실용·디자인·품질 */
export type Stat = 'P' | 'E' | 'U' | 'D' | 'Q';
export const STATS: Stat[] = ['P', 'E', 'U', 'D', 'Q'];
export type Stats = Record<Stat, number>;

// ---------- 자료(JSON) ----------
export interface BodyDef { id: string; name: string; year: number; cost: number; basePrice: number; mult: Stats }
export interface PowertrainDef { id: string; name: string; year: number; split: { P: number; E: number }; costAdd: number; tiers: { name: string; costAdd: number }[] }
export interface OptionDef { id: string; name: string; year: number; U: number; D: number; Q: number; cost: number }
export interface SegmentDef { id: string; name: string; w: Stats; eps: number }
export interface RegionMarket { name: string; years: number[]; annual: number[]; bodyShare: Record<string, number[]>; mix: Record<string, Record<string, number>> }
export interface RivalDef { id: string; name: string; trait: string; cells: Record<string, number> }

// ---------- 상태 ----------
export type Role = 'designer' | 'engineer' | 'tester';
export interface Staff { id: number; name: string; role: Role; ability: number; condition: number; projectId: number | null }

export type Budget = 'low' | 'normal' | 'high';
/** 신차 기획(6.1): 기획 단계에서 정하는 것 전부 */
export interface ProjectSpec {
  name: string; body: string; segment: string; powertrain: string;
  tier: number; // 동력 단계 1~3(보급형/표준/고급)
  options: string[]; direction: Stats; budget: Budget; designWeeks: number;
}
/** 프로젝트 종류(8장): 새 차종 / 페이스리프트 / 풀체인지 */
export type ProjectKind = 'new' | 'facelift' | 'fullchange';
export interface Project extends ProjectSpec {
  id: number; startWeek: number;
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
  tier: number; options: string[]; stats: Stats; // 출시 시 확정된 원점수(결함 감점 포함)
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
  profit: number; cash: number; sold: number;
}

export interface CarState {
  saveVersion: 2;
  seed: number; rng: number;
  week: number;
  companyName: string;
  reputation: number;
  cash: number;
  loan: { balance: number; limitMult: number; bailoutUsed: boolean };
  negMonths: number; // 현금 음수로 끝난 연속 달 수
  status: 'playing' | 'gameOver';
  staff: Staff[];
  projects: Project[];
  nameplates: Nameplate[];
  rivals: RivalState[];
  ledger: LedgerEntry[]; // 최근 24개월
  pendingDev: number; // 이번 달에 쌓인 개발비(월말 정산)
  nextId: number;
  history: { week: number; cmd: Command }[]; // 성공한 명령 기록
}

// ---------- 명령 ----------
export type Command =
  | ({ type: 'startProject'; chassisSeed?: number; faceSeed?: number } & ProjectSpec) // 시드를 빼면 lookCandidates의 첫 후보
  | { type: 'startFacelift'; generationId: number; options: string[]; tier?: number; faceSeed?: number }
  | ({ type: 'startFullChange'; nameplateId: number; chassisSeed?: number; faceSeed?: number } & Omit<ProjectSpec, 'name'>)
  | { type: 'cancelProject'; projectId: number }
  | { type: 'launch'; projectId: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }
  | { type: 'discontinue'; generationId: number }
  | { type: 'setPrice'; generationId: number; price: number } // 다음 월말 정산부터 반영
  | { type: 'setMarketing'; generationId: number; marketing: number }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'bailout' };
/** 성공하면 events에 그 명령이 낸 소식(출시 기사 등)이 올 수 있다 */
export type CommandResult = { ok: true; events?: GameEvent[] } | { ok: false; reason: string };

export type EventKind = 'designDone' | 'monthEnd' | 'recall' | 'discontinued' | 'unlock' | 'cashWarning' | 'gameOver' | 'news' | 'advice';
export interface BasicEvent { kind: EventKind; text: string; id?: number }
/** 주간 개발 기록(사무실 화면용): 직원별로 그 주에 실제로 쌓은 점수와 결함 증감 */
export interface DevWeekEvent {
  kind: 'devWeek'; text: string; id: number; projectId: number;
  staff: { id: number; stats: Stats }[]; defectsAdded: number; defectsRemoved: number;
}
export type GameEvent = BasicEvent | DevWeekEvent;
