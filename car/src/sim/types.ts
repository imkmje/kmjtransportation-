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
export interface Project extends ProjectSpec {
  id: number; startWeek: number;
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
}
/** 세대: 차체·동력 종류·고객층이 같은 한 묶음 */
export interface Generation {
  id: number; number: number; body: string; segment: string; powertrain: string;
  launchWeek: number; launchMonth: number; // launchMonth: 월 번호(0 = 1970년 1월)
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

export interface RivalState { id: string; name: string; cells: Record<string, number> } // 칸(차체)별 점유 점수 A

export interface LedgerEntry {
  month: number; year: number; monthOfYear: number;
  revenue: number; cogs: number; salaries: number; upkeep: number; dev: number; marketing: number; interest: number; recall: number;
  profit: number; cash: number; sold: number;
}

export interface CarState {
  saveVersion: 1;
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
  | ({ type: 'startProject' } & ProjectSpec)
  | { type: 'cancelProject'; projectId: number }
  | { type: 'launch'; projectId: number; price: number; marketing: number; color: string; wheels: 0 | 1 | 2 }
  | { type: 'discontinue'; generationId: number }
  | { type: 'setPrice'; generationId: number; price: number } // 다음 월말 정산부터 반영
  | { type: 'setMarketing'; generationId: number; marketing: number }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'bailout' };
export type CommandResult = { ok: true } | { ok: false; reason: string };

export type EventKind = 'designDone' | 'monthEnd' | 'recall' | 'discontinued' | 'unlock' | 'cashWarning' | 'gameOver';
export interface GameEvent { kind: EventKind; text: string; id?: number }
