// 카 컴퍼니 게임 본체: 상태, 1주 진행(tick), 명령(command), 저장(toJSON/fromJSON)
import { won } from './won';
import { config } from '../config';
import { NAMES, RANDOM_EVENTS, RIVALS, TECHS, bodyById, optionById, techById } from '../data';
import { defectQMult, finalStats, grade, optionsAt, partStats, payOf, salaryOf, unitCost, zeroStats } from './cars';
import { specError, staffOn, stepProject, withRequired } from './dev';
import { derivativePlan, genCostMult, lineRoot, nameplateOfGen, variantById, variantStats } from './derive';
import { applyWinsToGen, rollWins, winStats } from './wins';
import { writeCritiques } from './critiques';
import { allocate, batteryPlantError, factoryBuildMonths, hqUpkeep, capacityOf, costMultOf, devTeams, factoryExpandError, hqUpgradeError, isAway, isDevRole, linesOf, repEffect, salesAwarenessBonus, severanceOf, staffCap, staffCount, staffTrainCost, teamsUsed, trainCap, trainError, trainWeeksOf, upkeepOf } from './company';
import { eliteBusy, eliteCommand, eliteLaunched, eliteWeek } from './elite';
import { loanLimit, loanRate } from './finance';
import { carriedEquity, compareToPrev, faceliftEligibility, faceliftRefresh, retrofitInfo, fullChangeEligibility, lookCandidates, latestGen, nameplateById, rebuyPerMonth } from './lifecycle';
import { equipOf, expectEffect, optPerCar, optWeights, stdOf, syncOptions } from './equip';
import { carBasePrice, genBasePrice, awarenessStart, awarenessTarget, currentEdition, firstRivalModel, monthlyDemand, toSaleCar, initRivals, rivalBase, rivalCellA, entryMonth, enterRival } from './market';
import { enterText, legacyModelName, rivalModelName, updateRivalsWithNews } from './rivals';
import { addNews, choiceMoney, monthStart, regulationError } from './events';
import { levelForTier, ptCostAdd, researchCost, researchError, researchWeek, worldFirstTechs } from './research';
import { criticScores, mean } from './reviews';
import { josa } from './josa';
import { Rng, hash32 } from './rng';
import { EV, chargeMinutes, expectedRange, platformUMult, projectPlatform, rangeKm } from './ev';
import { DIFFICULTIES, diffOf } from './difficulty';
import { applyLateStart, challengeError, eraStartOf, failChallenge, hasChallenge, startCash, startOptionsError } from './start';
import { bestPrice } from './queries';
import { ensureHist, newPnl, noteCar, pnlOf, startHist } from './history';
import { clearError, clearPriceOf, fixError, fixTeam } from './insight';
import { presidents, subCommand, subsMonthStart, subsSettle } from './subs';
import { noteLoss, settleGen, splitMade, worldCommand, worldDemand, worldPrep, worldSettle, type RegionSum } from './world';
import { applyRivalChoice, autoChoice, emptyRivalry, rivalryCommand, rivalryMonthEnd, rivalryMonthStart, warPriceMult } from './rivalry';
import { addReport, delegationOn } from './execs';
import { AUTO_KINDS, autoAnswerOk, autoHold, autoInitial, autoOn, autoPick } from './autodecide';
import { EXEC_TITLE, execCommand, execExpire, execMonth, execPay, execWeek, monthlyFixed, type ExecCtx } from './execs';
import { dateLabel, isMonthEnd, monthLabel, monthOf, monthTime, yearOf } from './time';
import { STATS, type CarState, type Command, type CommandResult, type Edition, type GameEvent, type Generation, type LedgerCar, type LedgerEntry, type PricePolicy, type PendingChoice, type Project, type YearLog, type ProjectKind, type ProjectSpec, type Staff, type Stats, type Difficulty, type StartCondition, type Challenge } from './types';

/** 저장 형식 번호. 2: 차종의 일생(페이스리프트·풀체인지·3D 시드·경쟁 차 교체). 3: 직원·본사·공장(9장). 4: 연구·시대 사건·조합 노트·차체 10종(10·11장, 5.5).
 *  형식 1·2·3은 fromJSON이 올린다 */
export const SAVE_VERSION = 12; // 12(4.1.0): 직속 전담팀(elite, 직원·개발·세대의 elite, 수작 opus), 전 직원(former), 도전 과제 실패(start.failed), 경쟁 모델 이름 일부 교체. 11(4.0.0): 세계 시장(world, 세대의 권역 수출 world·국내 우선 domFirst, 장부의 권역 몫), 경쟁사 6곳·모델 이름 교체.  10(3.5.0): 경쟁 2부(rivalry), 직원 월급 가산(pay)·영입한 경쟁사(from), 세대·자회사 모델 수상, 자회사 상장 지분·인수 브랜드.  9(3.0.0): 자회사(subs)·장부의 자회사 배당·투자. 8(1.5.0): 새 게임 선택지(start), 연 기록의 연말 평판(repEnd). 1.1.0: 장비 구성(equip). 6(1.2.0): 배터리 공장(batteryPlant), 전기차 배터리 용량·전용 플랫폼. 7(1.3.0): 평론가별 시승기·파생 모델·직원 성과·세대교체 위임
/** difficulty: 생략하면 'easy'(0.4.1 새 게임 기본) */
export interface GameOptions { seed: number; companyName?: string; difficulty?: Difficulty; startYear?: number; condition?: StartCondition; challenges?: Challenge[] } // 1.5.0 시작 연도(기본 1970)·조건(기본 보통)·도전 과제(기본 없음)

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
const priceError = (body: string, price: number): string | null => {
  const base = bodyById(body).basePrice;
  return !Number.isFinite(price) || price < base * config.price.min - 1e-6 || price > base * config.price.max + 1e-6
    ? `가격은 기준가(${base.toLocaleString()}만원)의 ${config.price.min}~${config.price.max}배 사이여야 합니다.` : null;
};
const seedError = (x: unknown): string | null =>
  x === undefined || (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 0xffffffff) ? null : '모양 시드가 올바르지 않습니다.';
/** 자동 가격 정책 검사(0.8.0): null(수동) / 기준가 pct%(정수, config 범위) / 최고 이익 */
const policyError = (x: PricePolicy | null): string | null => {
  const P = config.pricePolicy;
  if (x === null || x?.kind === 'best') return null;
  return x?.kind === 'base' && Number.isInteger(x.pct) && x.pct >= P.pctMin && x.pct <= P.pctMax ? null : `기준가 유지 비율은 ${P.pctMin}~${P.pctMax}% 사이 정수여야 합니다.`;
};
/** 정책이 정하는 이번 달 가격(허용 범위 안으로). 수동이면 null */
const policyPrice = (s: CarState, g: Generation): number | null => {
  const x = g.pricePolicy, b = bodyById(g.body).basePrice;
  if (!x) return null;
  const want = x.kind === 'best' ? bestPrice(s, g.id)!.price : Math.round((genBasePrice(s, g) * x.pct) / 100 / 10) * 10;
  return Math.min(Math.floor((b * config.price.max) / 10) * 10, Math.max(Math.ceil((b * config.price.min) / 10) * 10, want));
};
const marketingError = (m: number): string | null =>
  !Number.isInteger(m) || m < 0 || m >= config.awareness.marketingCost.length ? `광고 등급은 0~${config.awareness.marketingCost.length - 1} 중에서 고르세요.` : null;

/** 0.8.0 되돌리기: 같은 주 안의 직전 조작 하나(명령 종류 → 알림 이름). 여기 없는 명령이 성공하면 되돌리기는 사라진다
 *  (출시·개발 시작·사건 선택·구제 금융·개발자 메뉴는 결과를 보고 다시 고르는 꼼수가 되므로 일부러 뺐다) */
const UNDO_KIND: Record<string, string> = {
  fire: '해고', discontinue: '단종', expandFactory: '공장 증설', buildBatteryPlant: '배터리 공장 건설', upgradeHQ: '본사 승급', borrow: '대출', repay: '대출 상환',
  appointExec: '임원 임명', hireExec: '임원 채용', dismissExec: '임원 해임', hire: '채용', train: '교육', rest: '휴식',
  foundSubsidiary: '자회사 설립', setSubStrategy: '자회사 전략', setSubArea: '자회사 영역', setSubDividend: '자회사 배당', investSub: '자회사 투자', setSubPresident: '자회사 사장', // 3.0.0
  setSubShare: '자회사 공유 범위', subAddModel: '자회사 모델 추가', subDropModel: '자회사 모델 단종', renameSubModel: '자회사 모델 이름', sellSubsidiary: '자회사 매각',
  setSubMode: '자회사 운영 방식', setSubModelPrice: '자회사 모델 가격', setSubTarget: '자회사 목표', // 3.1.0(개발 시작에 해당하는 기획·지시·배지는 본사 개발처럼 뺐다)
  openRegion: '해외 진출', investOffice: '판매 법인 투자', setExport: '수출 목록', setRegionPrice: '권역 가격', setRegionAuto: '자동 수출', setDomFirst: '국내 우선', // 4.0.0
  hireRivalTalent: '경쟁사 인재 영입', allyRival: '기술 제휴', endAlliance: '기술 제휴 해지', buyRivalTech: '기술 구매', listSub: '자회사 상장', acquireRival: '경쟁사 인수', // 3.5.0
  hireElite: '전담팀 영입', setElite: '전담팀 옮기기', setEliteTrain: '전담팀 자동 교육', rehire: '전 직원 채용', // 4.1.0
  setPrice: '가격 변경', setPricePolicy: '가격 변경', renameNameplate: '이름 변경', setMarketing: '광고 변경', startResearch: '연구 시작', cancelResearch: '연구 취소', dismissCandidates: '후보 돌려보내기',
};
/** 명령 직전 상태(JSON)와 알림 이름. 상태 밖(WeakMap)에 두어 저장 파일에 들어가지 않는다(불러오면 되돌리기 없음) */
interface UndoRec { snap: string; week: number; kind: string; names: string[] }
const undos = new WeakMap<CarState, UndoRec>();
/** 되돌릴 수 있는 직전 조작(화면용): label 예 "해고: 김민수", 여럿을 한 번에 했으면 "교육: 김민수 외 2명" */
export function undoInfo(s: CarState): { available: boolean; label: string } {
  const u = undos.get(s);
  if (!u || u.week !== s.week) return { available: false, label: '' };
  return { available: true, label: u.names.length ? `${u.kind}: ${u.names[0]}${u.names.length > 1 ? ` 외 ${u.names.length - 1}명` : ''}` : u.kind };
}

/** 판매 중(생산 라인을 차지하는) 세대: 단종 신청한 달까지 포함 */
export const sellingGens = (s: CarState): Generation[] =>
  s.nameplates.flatMap((n) => n.generations).filter((g) => g.status !== 'discontinued').sort((a, b) => a.id - b.id);
/** 쓰고 있는 생산 라인 수(0.5.1): 판매 중인 차종 수. 풀체인지 달에 단종되는 전 세대는 새 세대와 같은 라인이라 한 번만 센다. 1.3.0: 파생 차종은 바탕 차종과 같은 라인 */
export const linesUsed = (s: CarState): number => new Set(sellingGens(s).map((g) => lineRoot(s.nameplates.find((n) => n.generations.includes(g))!))).size;
export const allGens = (s: CarState): Generation[] => s.nameplates.flatMap((n) => n.generations).sort((a, b) => a.id - b.id);

export class Game {
  state: CarState;
  private rng: Rng;

  private constructor(state: CarState) {
    this.state = state;
    this.rng = new Rng(0); this.rng.setState(state.rng);
  }

  static create(opts: GameOptions): Game {
    const difficulty = opts.difficulty ?? 'easy';
    if (!DIFFICULTIES.includes(difficulty)) throw new Error(`없는 난이도: ${difficulty}`);
    const D = config.difficulty[difficulty];
    const startYear = opts.startYear ?? config.time.startYear, condition = opts.condition ?? 'normal', challenges = [...(opts.challenges ?? [])];
    const se = startOptionsError(startYear, condition, challenges);
    if (se) throw new Error(se);
    const Y = eraStartOf(startYear);
    const rng = new Rng(opts.seed);
    const pool = [...NAMES.staff];
    const staff: Staff[] = [...config.start.roles, ...Y.roles].map((role, i) => ({
      id: i + 1, name: pool.splice(rng.intIn(0, pool.length - 1), 1)[0], role,
      ability: rng.intIn(config.start.abilityMin, config.start.abilityMax), potential: 0, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false,
    }));
    const rivals = initRivals(rng, opts.seed);
    for (const x of staff) { x.potential = rng.intIn(config.start.potentialMin, config.start.potentialMax); x.ability += Y.ability; x.potential = Math.min(100, x.potential + Y.ability); } // 경쟁사 뒤에 뽑아 2단계까지의 난수 순서를 지킨다
    const state: CarState = {
      saveVersion: SAVE_VERSION, difficulty, seed: opts.seed, rng: rng.getState(), week: 0,
      companyName: opts.companyName?.trim() || NAMES.defaultCompany,
      reputation: config.start.reputation, cash: 0,
      loan: { balance: 0, limitMult: 1, bailoutUsed: D.bailouts <= 0, bailouts: 0 }, negMonths: 0, status: 'playing',
      staff, candidates: [], hqLevel: Y.hq, factory: { level: Y.factory, build: null }, batteryPlant: { level: 0, build: null },
      projects: [], nameplates: [], rivals, ledger: [], pendingDev: 0, pendingOneOff: 0, nextId: staff.length + 1,
      research: { done: [], active: [], early: [] }, events: { pending: [], mods: [], news: [] }, knownCombos: [], history: [], rivalry: emptyRivalry(),
      ...(startYear !== config.time.startYear || condition !== 'normal' || challenges.length ? { start: { year: startYear, condition, challenges } } : {}),
    };
    state.cash = startCash(state); // 1.5.0 난이도 × 시작 연도 × 시작 조건
    applyLateStart(state, startYear);
    for (const x of staff) startHist(x, state.week);
    return new Game(state);
  }

  // ---------- 1주 진행 ----------
  tick(): GameEvent[] {
    const s = this.state, ev: GameEvent[] = [];
    undos.delete(s); // 시간이 흐르면 되돌리기는 사라진다
    if (s.status !== 'playing') return ev;
    for (const p of [...s.projects].sort((a, b) => a.id - b.id)) {
      if (p.waiting) continue; // 출시 대기: 개발비·진행 없음
      const phase = p.phase, team = staffOn(s, p), log = stepProject(s, p, this.rng);
      const made = log.staff.reduce((a, x) => a + STATS.reduce((b, k) => b + x.stats[k], 0), 0);
      ev.push({
        kind: 'devWeek', id: p.id, projectId: p.id, staff: log.staff, defectsAdded: log.defectsAdded, defectsRemoved: log.defectsRemoved,
        text: phase === 'design' ? `「${p.name}」 설계 ${p.weeksDone}주차: 점수 +${made.toFixed(1)}, 결함 +${log.defectsAdded.toFixed(1)}` : `「${p.name}」 시험 ${p.testWeeks}주차: 결함 −${log.defectsRemoved.toFixed(1)}`,
      });
      if (log.designDone) ev.push({ kind: 'designDone', id: p.id, text: `「${p.name}」 설계가 끝났습니다. 시험을 시작합니다.` });
      rollWins(s, p, team, phase, ev); // 1.3.0 직원 성과(시드 해시, 게임 난수를 쓰지 않는다)
      if (log.waitingNow) ev.push({ kind: 'advice', id: p.id, topic: 'dev', text: `「${p.name}」의 결함을 모두 잡았습니다. 이제 출시할 수 있습니다. 출시 대기 중에는 개발비가 들지 않습니다.` });
      if (p.kind === 'fix' && p.testWeeks >= config.rescue.fixWeeks) this.finishFix(p, ev);
    }
    this.researchWeek(ev); // 10장: 쉬는 엔지니어·전담 연구원의 연구 점수(직원 컨디션 갱신 전, 이번 주 배치 기준)
    this.staffWeek(ev);
    if (s.elite) eliteWeek(s, this.rng, (c) => this.spend(c), () => monthlyFixed(s), ev); // 4.1.0 전담팀 자동 교육
    if (isMonthEnd(s.week)) this.monthEnd(ev);
    if (s.status === 'playing') execWeek(this.execCtx(), ev); // 0.7.0 예약된 교체 고용(개발이 끝난 주에)
    if (s.status === 'playing') {
      s.week++;
      execExpire(s, ev);
      const gone = s.candidates.filter((c) => s.week >= c.expiresWeek);
      if (gone.length) { s.candidates = s.candidates.filter((c) => s.week < c.expiresWeek); ev.push({ kind: 'company', text: `채용 후보 ${gone.length}명이 다른 회사로 갔습니다.` }); }
      for (const pc of s.events.pending.filter((x) => s.week >= x.deadline).sort((a, b) => a.id - b.id)) // 답하지 않은 사건은 기본 선택
        this.applyChoice(pc, RANDOM_EVENTS.find((d) => d.id === pc.eventId)!.defaultChoice, ev, true);
      if (s.week % config.time.weeksPerMonth === 0) { monthStart(s, ev); rivalryMonthStart(s, ev); this.autoRivalry(ev); this.autoDecide(ev); } // 11장: 시대 사건 뉴스·무작위 사건. 3.5.0 경쟁 2부(가격 전쟁·이직 제안·인재 후보)
    }
    ev.push(...this.repEvents); this.repEvents = [];
    s.rng = this.rng.getState();
    return ev;
  }

  /** 9.1 주간 직원: 컨디션(프로젝트에서 일한 주 −, 아니면 +0.05), 교육·휴식 끝 알림. 직원 ID 순 */
  private staffWeek(ev: GameEvent[]): void {
    const s = this.state, c = config.staff.condition, next = s.week + 1;
    for (const x of [...s.staff].sort((a, b) => a.id - b.id)) {
      const p = x.projectId === null ? undefined : s.projects.find((q) => q.id === x.projectId);
      const d = p && !p.waiting && !isAway(x, s.week) ? -c.perWeek[p.budget] : c.recover;
      x.condition = Math.min(1, Math.max(0, x.condition + d));
      if (x.trainings.length && x.trainings[x.trainings.length - 1] + trainWeeksOf(x) === next && !x.elite) ev.push({ kind: 'company', id: x.id, topic: 'training', text: `${x.name} 교육을 마쳤습니다(능력 ${x.ability}).` });
      if (x.restUntil !== null && x.restUntil <= next) { x.restUntil = null; ev.push({ kind: 'company', id: x.id, topic: 'training', text: `${x.name} 휴식을 마치고 돌아왔습니다.` }); }
    }
  }

  /** 평판 변화: 감점(d < 0)은 난이도 감점 배수(repLossMult)를 곱한다(구제 금융 제외). 바뀐 만큼 이유와 함께 평판 이벤트를 쌓아 tick·명령 결과로 내보낸다(0.5.1) */
  private addRep(d: number, reason: string, scaleLoss = true): void {
    const s = this.state, before = s.reputation, dd = d < 0 && scaleLoss ? d * diffOf(s).repLossMult : d;
    s.reputation = Math.max(config.reputation.min, before + dd); // 1.0.0: 위쪽 상한 없음
    const delta = s.reputation - before;
    if (delta) { const r = this.yearLog().rep; r[reason] = (r[reason] ?? 0) + delta; } // 연 보고서: 이유별 합
    if (Math.abs(delta) >= 0.05) this.repEvents.push({ kind: 'reputation', delta, reason, text: `평판 ${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}(${reason})` });
  }
  private repEvents: GameEvent[] = [];
  /** 0.8.0 그해(생략하면 지금 해)의 연 보고서 기록. 없으면 만든다 */
  private yearLog(y = yearOf(this.state.week)): YearLog {
    const ys = (this.state.years ??= {});
    return (ys[y] ??= { rep: {}, cars: {}, research: [], revenue: 0, profit: 0, sold: 0, months: 0 });
  }
  /** 연구 진행 + 이번에 끝난 기술을 연 보고서 기록에 */
  private researchWeek(ev: GameEvent[]): void {
    const d = this.state.research.done, n0 = d.length;
    researchWeek(this.state, ev);
    if (d.length > n0) this.yearLog().research.push(...d.slice(n0));
  }

  /** 월말 정산: 판매·인지도·리콜·재무·장부·파산 */
  private monthEnd(ev: GameEvent[]): void {
    const s = this.state, m = monthOf(s.week), year = yearOf(s.week), wpm = config.time.weeksPerMonth, LC = config.lifecycle;
    updateRivalsWithNews(s, ev, m); // 경쟁 차가 낡거나 새 모델로 바뀐다(2.0.0 세대교체 뉴스)
    if (s.subs?.length) subsMonthStart(s, ev, m); // 3.0.0 자회사 라인업·이번 달 세기·사업 자회사 효과(본사 판매 계산 전)
    for (const g of sellingGens(s)) if (g.status === 'onSale' && g.pricePolicy) { const pr = policyPrice(s, g); if (pr !== null && !priceError(g.body, pr)) currentEdition(g).price = pr; } // 0.8.0 자동 가격(경쟁 차 갱신 뒤, 판매 계산 전)
    const gens = sellingGens(s), cars = gens.map((g) => { const c = toSaleCar(g, m), k = warPriceMult(s, g.body, m); return k === 1 ? c : { ...c, price: c.price * k }; }); // 3.5.0 가격 전쟁에서 따라 내린 가격
    const demand = gens.map((g, i) => {
      let d = monthlyDemand(s, cars[i], cars.filter((_, j) => j !== i), monthTime(m));
      if (g.rebuy > 0 && m - g.launchMonth < LC.fullChange.rebuyMonths) d += g.rebuy; // 기존 고객 재구매(풀체인지 첫 12개월)
      if (g.launchMonth === m) d *= (m * wpm + wpm - g.launchWeek) / wpm; // 출시 달은 판매한 주만큼
      const ed = currentEdition(g);
      if (ed.kind === 'facelift' && monthOf(ed.launchWeek) === m) d *= LC.facelift.switchMonthMult; // 페이스리프트 전환 달 생산 −30%
      if (g.status === 'ending') d *= config.discontinue.lastMonthMult; // 단종 달: 재고 처분
      if ((g.awardUntil ?? -1) > m) d *= 1 + config.rivalry.awards.salesBoost; // 3.5.0 수상 판매 보너스
      return d;
    });
    // 4.0.0 해외 권역 수요(자동 가격·자동 수출을 먼저). 생산 쪽 배수(출시 달 주 수·페이스리프트 전환·단종 달)는 수출에도 같다
    if (s.world) worldPrep(s, ev, gens, m, year);
    const wrows = s.world ? worldDemand(s, gens, m, year, gens.map((g) => { const ed = currentEdition(g); return (g.launchMonth === m ? (m * wpm + wpm - g.launchWeek) / wpm : 1) * (ed.kind === 'facelift' && monthOf(ed.launchWeek) === m ? LC.facelift.switchMonthMult : 1) * (g.status === 'ending' ? config.discontinue.lastMonthMult : 1); })) : null;
    const totals = wrows ? demand.map((d, i) => d + wrows[i].reduce((a, x) => a + x.d, 0)) : demand;
    // 9.3 생산 배분: 수동 몫이 있는 차는 한도 × 몫까지, 나머지 한도는 자동 차들에 수요 비례로(4.0.0 수출 주문 포함, 차 안에서는 대당 이익이 큰 곳부터)
    const made = allocate(capacityOf(s), totals, gens.map((g) => g.allocShare));
    const byRegion: Record<string, RegionSum> = {};
    let revenue = 0, cogs = 0, marketing = 0, recall = 0, sold = 0;
    const carRows: LedgerCar[] = [];
    const ylog = this.yearLog(year);
    gens.forEach((g, i) => {
      const p0 = g.profit, P = pnlOf(g); // 0.10.0 손익 누적(예전 저장은 여기서 추정으로 시작)
      const ed = currentEdition(g), op = optPerCar(equipOf(ed), g.body, g.segment, year, costMultOf(s)), uc = unitCost(g.body, g.powertrain, ed.tier, ed.options, genCostMult(s, g), ptCostAdd(s, g.powertrain, ed.battery, g.evPlatform)) + op.cost; // 1.2.0 배터리·플랫폼·배터리 공장. 1.1.0 선택 사양: 선택률만큼 대당 평균 매출·원가
      const mk = config.awareness.marketingCost[g.marketing], unitRev = ed.price * warPriceMult(s, g.body, m) + op.rev;
      const wr = wrows?.[i] ?? [], n = wr.length ? splitMade(made[i], demand[i], unitRev - uc, wr, !!g.domFirst) : made[i]; // 4.0.0 국내 몫
      g.lastDemand = totals[i]; g.lostSales = Math.max(0, totals[i] - made[i]);
      g.sales.push(n); g.totalSold += n; sold += n;
      revenue += n * unitRev; cogs += n * uc; marketing += mk;
      g.profit += n * (unitRev - uc) - mk;
      const row: LedgerCar = { id: g.id, sold: n, revenue: n * unitRev, cogs: n * uc, marketing: mk, recall: 0 }; carRows.push(row);
      P.rev += n * unitRev; P.cogs += n * uc; P.mk += mk;
      if (wrows && (wr.length || g.world)) { // 4.0.0 수출 정산: 매출·생산 원가는 합계에, 관세·운송비는 따로(세대 손익에서는 원가에 넣는다)
        const x = settleGen(g, wr, uc); noteLoss(g, wr);
        revenue += x.revenue; cogs += x.cogs; g.profit += x.revenue - x.cogs - x.landed; P.rev += x.revenue; P.cogs += x.cogs + x.landed;
        row.revenue += x.revenue; row.cogs += x.cogs; if (x.sold) row.exp = { sold: x.sold, revenue: x.revenue, landed: x.landed };
        for (const [rid, v] of Object.entries(x.by)) { const b = (byRegion[rid] ??= { sold: 0, revenue: 0, cogs: 0, landed: 0, tariff: 0, ship: 0 }); b.sold += v.sold; b.revenue += v.revenue; b.cogs += v.cogs; b.landed += v.landed; b.tariff += v.tariff; b.ship += v.ship; }
      }
      const target = awarenessTarget(s.reputation, g.marketing, grade(ed.stats.Q, year));
      g.awareness += (target - g.awareness) * (config.awareness.rate + salesAwarenessBonus(s)); // 영업 직원이 수렴을 빠르게(9.1)
      if (ed.defects > 0) { // 6.3 리콜: 연 확률 min(40%, 결함 × 2%)을 달로 나눠 굴린다
        const pYear = Math.min(config.recall.maxYear, ed.defects * config.recall.perDefect);
        if (this.rng.next() < 1 - (1 - pYear) ** (1 / config.time.monthsPerYear)) {
          const cost = g.totalSold * config.recall.costPerCar * diffOf(s).recallMult;
          recall += cost; row.recall = cost; g.profit -= cost; g.recalls++; P.recall += cost;
          g.awareness *= config.recall.awarenessMult; ed.defects = 0; // 전량 수리했으므로 결함은 없어진다
          const R = config.reputation, before = s.reputation; // 0.5.1: 평판 감점은 규모 비례(누적 판매 / 5,000, 0.5~3) × 난이도 배수
          this.addRep(-Math.min(-config.recall.rep, Math.max(R.recallMin, g.totalSold / R.recallPer)), `「${this.nameOf(g)}」 리콜`);
          ev.push({ kind: 'recall', id: g.id, text: `「${this.nameOf(g)}」 리콜 실시. 수리비 ${won(cost)}${josa(won(cost), '이/가')} 들고 평판이 ${(before - s.reputation).toFixed(1)} 떨어졌습니다.` });
        }
      }
      const dc = config.discontinue, last = g.sales.slice(-dc.adviceMonths); // 8.6: 월 10대 미만이 6개월째가 된 달에 한 번 조언
      if (g.status === 'onSale' && last.length === dc.adviceMonths && last.every((x) => x < dc.adviceSales) && !(g.sales.length > dc.adviceMonths && g.sales[g.sales.length - dc.adviceMonths - 1] < dc.adviceSales))
        ev.push({ kind: 'advice', id: g.id, text: `「${this.nameOf(g)}」 판매가 ${dc.adviceMonths}개월째 월 ${dc.adviceSales}대 미만입니다. 단종을 권합니다.` });
      ylog.cars[g.id] = (ylog.cars[g.id] ?? 0) + g.profit - p0;
      P.months.push(g.profit - p0);
      if (g.status === 'onSale' && g.clearance && m >= g.clearance.lastMonth) { // 0.10.0 가격 인하 판매가 끝나면 자동 단종(평판 감점 없음)
        g.status = 'discontinued'; g.endMonth = m; g.allocShare = null;
        ev.push({ kind: 'discontinued', id: g.id, text: `「${this.nameOf(g)}」 가격 인하 판매를 마치고 단종했습니다. 다음 달부터 생산 라인이 빕니다.` });
      }
      if (g.status === 'ending') { g.status = 'discontinued'; ev.push({ kind: 'discontinued', id: g.id, text: `「${this.nameOf(g)}」 생산을 마쳤습니다. 다음 달부터 생산 라인이 빕니다.` }); }
    });
    const xPay = execPay(s), salaries = s.staff.reduce((a, x) => a + payOf(x), 0) + xPay; // 0.7.0 임원 월급 포함. 3.5.0 월급 가산 포함
    const upkeep = upkeepOf(s), upkeepHq = hqUpkeep(s, s.hqLevel), dev = s.pendingDev, interest = s.loan.balance * loanRate(s), oneOff = s.pendingOneOff;
    const sub = s.subs?.length || s.pendingSubInv ? subsSettle(s, ev, m, { revenue, cogs }) : null; // 3.0.0 자회사 판매·이익·배당(배당은 본사 이익에 더한다)
    const ws = s.world ? worldSettle(s, ev, gens, m, byRegion) : null; // 4.0.0 권역 합계·판매 법인 유지비·인지도·평판
    const profit = revenue - cogs - salaries - upkeep - dev - marketing - interest - recall - oneOff + (sub?.dividend ?? 0) - (ws ? ws.tariff + ws.ship + ws.upkeep : 0);
    const research = s.pendingResearch ?? 0;
    s.cash += profit + oneOff; s.pendingDev = 0; s.pendingOneOff = 0; s.pendingResearch = 0; // 일회성 지출은 명령 때 이미 현금에서 나갔다
    const e: LedgerEntry = { month: m, year, monthOfYear: (m % config.time.monthsPerYear) + 1, revenue, cogs, salaries, upkeep, upkeepHq, dev, marketing, interest, recall, oneOff, profit, cash: s.cash, sold, ...(sub ? { subDiv: sub.dividend, subInv: s.pendingSubInv ?? 0 } : {}), ...(ws ? { world: ws.ledger, tariff: ws.tariff, ship: ws.ship, worldUpkeep: ws.upkeep, worldInv: s.pendingWorldInv ?? 0 } : {}), cars: carRows, execPay: xPay, research };
    if (ws) { s.pendingWorldInv = 0; const yw = (ylog.world ??= {}); for (const [rid, v] of Object.entries(ws.ledger)) { const y = (yw[rid] ??= { sold: 0, revenue: 0, profit: 0 }); y.sold += v.sold; y.revenue += v.revenue; y.profit += v.profit; } }
    if (sub) { s.pendingSubInv = 0; for (const r of sub.rep) this.addRep(r.value, r.reason ?? `자회사 「${r.name}」의 명성`); }
    s.ledger.push(e);
    ylog.revenue += revenue; ylog.profit += profit; ylog.sold += sold; ylog.months++; ylog.cash = s.cash;
    const everyone = [...s.staff, ...Object.values(s.execs?.seats ?? {}).map((x) => x!.staff), ...presidents(s)];
    for (const x of everyone) ensureHist(x, s.week); // 0.10.0 성장 기록(예전 저장은 지금부터)
    if (e.monthOfYear === config.time.monthsPerYear) for (const x of everyone) x.hist!.years[year] = x.ability;
    if (e.monthOfYear === config.time.monthsPerYear) { ylog.staff = s.staff.length; ylog.execs = Object.entries(s.execs?.seats ?? {}).map(([r, x]) => `${EXEC_TITLE[r as keyof typeof EXEC_TITLE]} ${x!.staff.name}`); }
    if (s.ledger.length > config.ledgerMonths) s.ledger.splice(0, s.ledger.length - config.ledgerMonths);
    if (s.former?.length) s.former = s.former.filter((f) => s.week - f.left < config.former.months * wpm); // 4.1.0 전 직원은 12개월까지
    ev.push({ kind: 'monthEnd', text: `${monthLabel(m)} 결산: 판매 ${sold}대, 이익 ${Math.round(profit).toLocaleString()}만원` });
    const R = config.reputation, total = allGens(s).reduce((a, x) => a + x.totalSold, 0); // 0.5.1 누적 판매 마일스톤
    R.milestones.forEach((n, i) => { if (total >= n && total - sold < n) this.addRep(R.milestoneRep[i], `누적 판매 ${n.toLocaleString()}대`); });
    if ((m + 1) % config.time.monthsPerYear === 0) { // 연간 판매 실적만큼 평판(9.5, 0.4.2), 판매 중인 차의 평론이 좋으면 +1(0.5.1)
      const yearSold = s.ledger.slice(-config.time.monthsPerYear).reduce((a, x) => a + x.sold, 0), gain = Math.min(R.yearMax, yearSold / R.yearSoldDiv);
      if (gain > 0) this.addRep(gain, `올해 판매 ${yearSold.toLocaleString()}대`);
      const on = sellingGens(s).filter((x) => x.status === 'onSale');
      if (on.length && mean(on.map((x) => x.reviewAvg)) >= R.yearGoodReview) this.addRep(R.yearGoodRep, '판매 중인 차들의 좋은 평판');
      ylog.repEnd = s.reputation; // 1.5.0 통계용 연말 평판
    }
    for (const r of rivalryMonthEnd(s, ev, m)) this.addRep(r.value, r.reason); // 3.5.0 대응 신차 예고·시상식(12월)
    const b = s.factory.build; // 9.3 증설 공사: doneMonth 달부터 새 등급
    if (b && m + 1 >= b.doneMonth) {
      s.factory = { level: b.level, build: null };
      ev.push({ kind: 'company', topic: 'factory', text: `공장 ${b.level}등급 증설을 마쳤습니다. 한 달 생산 ${capacityOf(s).toLocaleString()}대, 생산 라인 ${linesOf(s)}개.` });
    }
    const bb = s.batteryPlant.build; // 1.2.0 배터리 공장 공사
    if (bb && m + 1 >= bb.doneMonth) {
      s.batteryPlant = { level: bb.level, build: null };
      ev.push({ kind: 'company', topic: 'factory', text: `배터리 공장 ${bb.level}등급 공사를 마쳤습니다. 전기차 대당 원가가 ${Math.round(config.ev.plant.levels[bb.level - 1].cut * 100)}% 줄어듭니다.` });
    }
    // 9.4 파산: 현금 음수로 난이도의 유예 개월(보통 12, 0.4.1에서 6 → 12) 연속이면 게임 오버
    if (s.cash < 0) {
      s.negMonths++;
      if (s.negMonths >= diffOf(s).bankruptcyMonths) { s.status = 'gameOver'; ev.push({ kind: 'gameOver', text: `현금 부족이 ${diffOf(s).bankruptcyMonths}개월 이어져 회사가 파산했습니다.` }); }
      else {
        const room = Math.max(0, loanLimit(s) - s.loan.balance); // 남은 대출 한도를 함께 알린다(0.4.1)
        ev.push({ kind: 'cashWarning', text: `현금이 ${s.negMonths}개월째 마이너스입니다. ${diffOf(s).bankruptcyMonths}개월이 되면 파산합니다.${hasChallenge(s, 'noLoan') ? '' : room >= 10000 ? ` 대출 한도 ${won(Math.floor(room / 10000) * 10000)}${josa(won(Math.floor(room / 10000) * 10000), '이/가')} 남아 있습니다.` : ' 남은 대출 한도가 없습니다.'}` });
      }
    } else s.negMonths = 0;
    if (s.status === 'playing') execMonth(this.execCtx(), ev); // 0.7.0 위임 실행, 임원 제안(보고함)
  }
  /** 임원 모듈(execs.ts)에 넘기는 손잡이 */
  private execCtx(): ExecCtx { return { s: this.state, rng: this.rng, spend: (c) => this.spend(c), run: (cmd) => this.exec(cmd), newName: () => this.newName() }; }

  private nameOf(g: Generation): string { return this.state.nameplates.find((n) => n.generations.includes(g))?.name ?? ''; }

  // ---------- 명령 ----------
  /** chain: 일괄 조작(여러 명 교육 등)의 두 번째부터. 같은 주·같은 종류면 첫 명령 직전 상태를 그대로 두어 한 번에 되돌린다 */
  command(cmd: Command, chain = false): CommandResult {
    const s = this.state, kind = UNDO_KIND[cmd?.type], prev = undos.get(s);
    const keep = !!kind && chain && prev?.week === s.week && prev.kind === kind;
    const snap = kind && !keep ? JSON.stringify(s) : '', name = kind ? this.undoTarget(cmd) : '';
    const ce = challengeError(s, cmd); // 1.5.0 도전 과제
    let r = ce ? fail(ce) : this.exec(cmd);
    if (r.ok) {
      s.history.push({ week: s.week, cmd: JSON.parse(JSON.stringify(cmd)) });
      if (!kind) undos.delete(s);
      else if (keep) { if (name) prev!.names.push(name); }
      else undos.set(s, { snap, week: s.week, kind, names: name ? [name] : [] });
    }
    if (r.ok && this.repEvents.length) r = { ok: true, events: [...(r.events ?? []), ...this.repEvents] };
    this.repEvents = [];
    this.state.rng = this.rng.getState();
    return r;
  }

  /** 0.8.0 직전 조작 되돌리기: 명령 직전 상태(난수 상태·명령 기록 포함)로 그대로 돌아간다 */
  undoLast(): CommandResult {
    const s = this.state, u = undos.get(s);
    if (!u || u.week !== s.week) return fail('되돌릴 조작이 없습니다. 같은 주 안의 직전 조작만 되돌릴 수 있습니다.');
    const old = JSON.parse(u.snap) as CarState;
    for (const k of Object.keys(s)) delete (s as unknown as Record<string, unknown>)[k];
    Object.assign(s, old); // 같은 상태 객체를 고쳐 쓴다(화면이 들고 있는 game.state가 그대로 맞게)
    this.rng.setState(s.rng); this.repEvents = []; undos.delete(s);
    return OK;
  }
  /** 되돌리기 알림에 쓸 대상 이름(명령 실행 전에 읽는다) */
  private undoTarget(cmd: Command): string {
    const s = this.state, c = cmd as Record<string, unknown>, id = c.staffId ?? c.candidateId, gid = c.generationId;
    const gen = gid === undefined ? '' : `「${s.nameplates.find((n) => n.generations.some((g) => g.id === gid))?.name ?? ''}」`;
    switch (cmd.type) {
      case 'fire': case 'train': case 'rest': case 'appointExec': return s.staff.find((x) => x.id === id)?.name ?? '';
      case 'hire': return s.candidates.find((x) => x.id === id)?.name ?? '';
      case 'hireExec': return s.execs?.candidates.find((x) => x.id === id)?.name ?? '';
      case 'dismissExec': return s.execs?.seats[cmd.role]?.staff.name ?? '';
      case 'borrow': case 'repay': return Number.isFinite(cmd.amount) ? won(cmd.amount) : '';
      case 'startResearch': case 'cancelResearch': return TECHS.some((t) => t.id === cmd.techId) ? `「${techById(cmd.techId).name}」` : '';
      case 'renameNameplate': { const n = nameplateById(s, cmd.nameplateId); return n ? `「${n.name}」` : ''; }
      case 'foundSubsidiary': return '';
      default: { const sub = 'subId' in cmd ? s.subs?.find((x) => x.id === cmd.subId) : undefined; return sub ? `「${sub.name}」` : gen; }
    }
  }

  private exec(cmd: Command): CommandResult {
    const s = this.state;
    if (s.status !== 'playing' && cmd?.type !== 'bailout') return fail('게임이 끝났습니다.'); // 9.4: 파산 화면에서도 구제 금융은 받을 수 있다
    switch (cmd?.type) {
      case 'startProject': {
        syncOptions(cmd); // 1.1.0: equip을 주면 options는 기본 장비 목록
        const team = this.teamFor(cmd.team), err = this.teamError(team) ?? specError(s, cmd) ?? seedError(cmd.chassisSeed) ?? seedError(cmd.faceSeed) ?? (typeof team === 'string' ? team : null);
        if (err) return fail(err);
        this.addProject('new', null, { ...cmd, name: cmd.name?.trim() || `${NAMES.cars[s.nameplates.length % NAMES.cars.length]}` },
          cmd.chassisSeed ?? lookCandidates(s, 0, 'chassis')[0], cmd.faceSeed ?? lookCandidates(s, 0, 'face')[0], team as Staff[]);
        return OK;
      }
      case 'startFacelift': { // 8.2
        const el = faceliftEligibility(s, cmd.generationId);
        if (!el.ok) return fail(el.reason!);
        const n = s.nameplates.find((x) => x.generations.some((g) => g.id === cmd.generationId))!, g = n.generations.find((x) => x.id === cmd.generationId)!, ed = currentEdition(g);
        const tier = cmd.tier ?? ed.tier, d = config.dev;
        const spec: ProjectSpec = {
          name: n.name, body: g.body, segment: g.segment, powertrain: g.powertrain, tier, options: cmd.options, ...(cmd.equip ? { equip: cmd.equip } : {}), ...(ed.battery ? { battery: ed.battery } : {}), // 1.2.0 배터리는 그 세대 그대로
          direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.lifecycle.facelift.designWeeks,
        };
        syncOptions(spec);
        const team = this.teamFor(cmd.team);
        const err = this.teamError(team) ?? specError(s, { ...spec, designWeeks: d.designWeeks[0] })
          ?? (tier < ed.tier || levelForTier(s, g.powertrain, tier) < ed.level ? '동력 등급은 낮출 수 없습니다(지금 등급이나 그보다 높은 등급만 고를 수 있습니다).' : null)
          ?? seedError(cmd.faceSeed) ?? (typeof team === 'string' ? team : null);
        if (err) return fail(err);
        const p = this.addProject('facelift', g.id, spec, g.chassisSeed, cmd.faceSeed ?? lookCandidates(s, n.id, 'face', 'facelift')[0], team as Staff[]);
        p.defects = ed.defects * config.lifecycle.facelift.defectKeep; // 남은 결함 × 0.5로 시작
        if (g.variant) p.variant = g.variant; // 1.3.0 파생 차의 페이스리프트(시장 기준가·능력치 배수)
        return OK;
      }
      case 'startFullChange': { // 8.3
        const el = fullChangeEligibility(s, cmd.nameplateId);
        if (!el.ok) return fail(el.reason!);
        const n = nameplateById(s, cmd.nameplateId)!;
        const spec: ProjectSpec = { name: n.name, body: cmd.body, segment: cmd.segment, powertrain: cmd.powertrain, tier: cmd.tier, options: cmd.options, ...(cmd.equip ? { equip: cmd.equip } : {}), ...(cmd.battery ? { battery: cmd.battery } : {}), direction: cmd.direction, budget: cmd.budget, designWeeks: cmd.designWeeks };
        syncOptions(spec);
        const team = this.teamFor(cmd.team), err = this.teamError(team) ?? specError(s, spec) ?? seedError(cmd.chassisSeed) ?? seedError(cmd.faceSeed) ?? (typeof team === 'string' ? team : null);
        if (err) return fail(err);
        this.addProject('fullchange', n.id, spec, cmd.chassisSeed ?? lookCandidates(s, n.id, 'chassis')[0], cmd.faceSeed ?? lookCandidates(s, n.id, 'face', 'nextGen')[0], team as Staff[]);
        return OK;
      }
      case 'startDerivative': { // 1.3.0 파생 모델: 바탕 세대의 차대·장비, 짧은 설계(종류별), 비용은 바탕 세대 개발비의 일부
        const plan = derivativePlan(s, cmd.generationId, cmd.variant, { name: cmd.name, segment: cmd.segment, battery: cmd.battery });
        if (typeof plan === 'string') return fail(plan);
        syncOptions(plan.spec);
        const team = this.teamFor(cmd.team), err = this.teamError(team) ?? specError(s, { ...plan.spec, designWeeks: config.dev.designWeeks[0] }) ?? (typeof team === 'string' ? team : null);
        if (err) return fail(err);
        const p = this.addProject('derivative', plan.base.id, plan.spec, plan.base.chassisSeed, lookCandidates(s, plan.into?.id ?? 0, 'face', 'nextGen')[0], team as Staff[]);
        p.variant = plan.v.id;
        if (plan.into) p.into = plan.into.id;
        return OK;
      }
      case 'renameNameplate': { // 1.5.0 출시 뒤 이름 바꾸기: 계보·판매·이름값·명예의 전당은 차종 ID로 이어져 그대로, 지난 뉴스·보고 문장은 그대로 둔다
        const n = nameplateById(s, cmd.nameplateId);
        if (!n || !n.generations.length) return fail('출시한 차종만 이름을 바꿀 수 있습니다.');
        const old = n.name, name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
        if (name === old) return fail('지금 이름과 같습니다.');
        // 함께 바꿀 파생: 이름이 「바탕이름 + 띄어쓰기 + 접미사」 꼴인 것만(직접 지은 이름은 그대로). 개발 중인 첫 파생 프로젝트도 같다
        const kids = cmd.withDerivatives ? s.nameplates.filter((x) => x.baseOf === n.id && x.name.startsWith(`${old} `)) : [];
        const ren = new Map<{ name: string }, string>([[n, name], ...kids.map((k): [{ name: string }, string] => [k, name + k.name.slice(old.length)])]);
        const npOf = (p: Project) => p.kind === 'fullchange' ? p.targetId : p.kind === 'derivative' ? p.into : p.kind === 'new' ? undefined : nameplateOfGen(s, p.targetId)?.id; // execs.ts genAuto와 같은 규칙
        for (const p of s.projects) {
          const t = [n, ...kids].find((x) => x.id === npOf(p));
          if (t) ren.set(p, ren.get(t)!); // 개발 중인 페이스리프트·풀체인지·다음 세대 파생도 새 이름으로 출시
          else if (cmd.withDerivatives && p.kind === 'derivative' && p.into === undefined && nameplateOfGen(s, p.targetId)?.id === n.id && p.name.startsWith(`${old} `)) ren.set(p, name + p.name.slice(old.length));
        }
        const taken = new Set([...s.nameplates, ...s.projects.filter((p) => p.kind === 'new' || (p.kind === 'derivative' && p.into === undefined))].filter((x) => !ren.has(x)).map((x) => x.name));
        for (const nm of new Set(ren.values())) {
          if (!nm) return fail('이름을 입력하세요.');
          if ([...nm].length > config.nameMax) return fail(`이름은 ${config.nameMax}자까지 쓸 수 있습니다${nm === name ? '' : `(「${nm}」)`}.`);
          if (taken.has(nm)) return fail(`「${nm}」${josa(nm, '은/는')} 이미 있는 차종 이름입니다.`);
        }
        for (const [x, nm] of ren) x.name = nm;
        return OK;
      }
      case 'setProjectEquip': { // 1.1.0: 설계 단계에서만, 비용 없이
        const p = s.projects.find((x) => x.id === cmd.projectId);
        if (!p || p.kind === 'fix') return fail('없는 개발 프로젝트입니다.');
        if (p.phase !== 'design') return fail('장비 구성은 설계 단계에서만 바꿀 수 있습니다.');
        const spec = syncOptions({ ...p, options: [...p.options], equip: { ...cmd.equip } }), err = specError(s, { ...spec, designWeeks: config.dev.designWeeks[0] });
        if (err) return fail(err);
        p.equip = equipOf(spec, s); p.options = withRequired(s, stdOf(p.equip));
        return OK;
      }
      case 'cancelProject': {
        const p = s.projects.find((x) => x.id === cmd.projectId);
        if (!p) return fail('없는 개발 프로젝트입니다.');
        this.closeProject(p);
        return OK;
      }
      case 'launch': return this.launch(cmd);
      case 'discontinue': {
        const g = allGens(s).find((x) => x.id === cmd.generationId);
        if (!g || g.status !== 'onSale') return fail('판매 중인 차가 아닙니다.');
        const d = config.discontinue, recent = g.sales.slice(-d.recentMonths), peak = Math.max(0, ...g.sales);
        if (recent.length && peak > 0 && mean(recent) >= peak * d.wellSelling) this.addRep(d.rep, '잘 팔리던 차의 단종'); // 잘 팔리는 차의 "아쉬운 퇴장"
        g.status = 'ending'; g.endMonth = monthOf(s.week);
        return OK;
      }
      case 'setPrice':
      case 'setMarketing': {
        const g = allGens(s).find((x) => x.id === cmd.generationId);
        if (!g || g.status !== 'onSale') return fail('판매 중인 차가 아닙니다.');
        if (cmd.type === 'setPrice' && g.clearance) return fail('가격 인하 판매 중에는 값을 바꿀 수 없습니다.');
        const bad = cmd.type === 'setPrice' ? priceError(g.body, cmd.price) : marketingError(cmd.marketing);
        if (bad) return fail(bad);
        if (cmd.type === 'setPrice') { currentEdition(g).price = cmd.price; delete g.pricePolicy; } else g.marketing = cmd.marketing; // 수동 가격은 자동 가격을 끈다
        return OK;
      }
      case 'setPricePolicy': { // 0.8.0
        const g = allGens(s).find((x) => x.id === cmd.generationId);
        if (!g || g.status !== 'onSale') return fail('판매 중인 차가 아닙니다.');
        if (g.clearance) return fail('가격 인하 판매 중에는 값을 바꿀 수 없습니다.');
        const bad = policyError(cmd.policy ?? null);
        if (bad) return fail(bad);
        if (cmd.policy) g.pricePolicy = { ...cmd.policy }; else delete g.pricePolicy;
        return OK;
      }
      case 'retrofit': { // 0.4.2 의무 장비 추가: 일시 비용, 지금 판에 장비를 넣고 능력치(차체 배수 × 장비 점수, 품질은 결함 감점)를 더한다
        const info = retrofitInfo(s, cmd.generationId);
        if (!info.ok) return fail(info.reason!);
        const g = allGens(s).find((x) => x.id === cmd.generationId)!, ed = currentEdition(g), mult = bodyById(g.body).mult;
        this.spend(info.cost); pnlOf(g).dev.retro += info.cost;
        if (ed.equip) ed.equip = { ...ed.equip, ...Object.fromEntries(info.options.map((o) => [o, 'std' as const])) }; // 1.1.0: 새 객체(판매 계산 캐시가 구성 객체로 찾는다)
        for (const o of info.options) { const d = optionById(o); ed.options.push(o); ed.stats.U += mult.U * d.U; ed.stats.D += mult.D * d.D; ed.stats.Q += mult.Q * d.Q * defectQMult(ed.defects); }
        return OK;
      }
      case 'quickFix': { // 0.10.0 긴급 개선: 시험만 하는 짧은 프로젝트(끝나면 finishFix가 반영)
        const team = cmd.team === undefined ? fixTeam(s) : this.teamFor(cmd.team);
        const err = fixError(s, cmd.generationId) ?? this.teamError(team);
        if (err) return fail(err);
        if (typeof team === 'string') return fail(team);
        if (!team.length || team.some((x) => x.role !== 'tester' && x.role !== 'engineer')) return fail('긴급 개선에는 테스터나 엔지니어만 넣을 수 있습니다(쉬는 사람이 한 명 이상 필요).');
        const g = allGens(s).find((x) => x.id === cmd.generationId)!, ed = currentEdition(g);
        const spec: ProjectSpec = { name: this.nameOf(g), body: g.body, segment: g.segment, powertrain: g.powertrain, tier: ed.tier, options: [...ed.options], ...(ed.equip ? { equip: { ...ed.equip } } : {}), direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: 0 };
        const p = this.addProject('fix', g.id, spec, g.chassisSeed, ed.faceSeed, team);
        p.phase = 'test'; p.options = [...ed.options]; p.level = ed.level; p.defects = ed.defects; p.defectEst = Math.round(ed.defects);
        return OK;
      }
      case 'clearance': { // 0.10.0 가격 인하 판매: 기준가의 clearPct로 clearMonths개월, 인지도 가산, 끝나면 자동 단종
        const err = clearError(s, cmd.generationId);
        if (err) return fail(err);
        const g = allGens(s).find((x) => x.id === cmd.generationId)!, R = config.rescue, m = monthOf(s.week), price = clearPriceOf(s, g);
        currentEdition(g).price = price; delete g.pricePolicy;
        g.awareness = Math.min(1, g.awareness + R.clearAwareness);
        g.clearance = { startMonth: m, lastMonth: m + R.clearMonths - 1, price };
        return OK;
      }
      case 'borrow': {
        if (!Number.isFinite(cmd.amount) || cmd.amount <= 0) return fail('빌릴 금액이 올바르지 않습니다.');
        if (s.loan.balance + cmd.amount > loanLimit(s) + 1e-6) return fail('대출 한도를 넘습니다.');
        s.loan.balance += cmd.amount; s.cash += cmd.amount;
        return OK;
      }
      case 'repay': {
        if (!Number.isFinite(cmd.amount) || cmd.amount <= 0) return fail('갚을 금액이 올바르지 않습니다.');
        if (cmd.amount > s.loan.balance + 1e-6) return fail('남은 대출보다 많이 갚을 수 없습니다.');
        if (cmd.amount > s.cash) return fail('현금이 모자랍니다.');
        s.loan.balance = Math.max(0, s.loan.balance - cmd.amount); s.cash -= cmd.amount;
        return OK;
      }
      case 'bailout': {
        const maxB = diffOf(s).bailouts, usedB = s.loan.bailouts ?? (s.loan.bailoutUsed ? 1 : 0);
        if (maxB <= 0) return fail('이 난이도에서는 구제 금융을 받을 수 없습니다.');
        if (usedB >= maxB) return fail(maxB === 1 ? '구제 금융은 한 번만 받을 수 있습니다.' : `구제 금융은 ${maxB}번까지만 받을 수 있습니다.`);
        if (s.cash >= 0) return fail('현금이 마이너스일 때만 받을 수 있습니다.');
        s.cash = 0; s.negMonths = 0; s.loan.bailouts = usedB + 1; s.loan.bailoutUsed = usedB + 1 >= maxB; s.loan.limitMult *= config.loan.bailoutLimitMult;
        this.addRep(config.bankruptcy.bailoutRep, '구제 금융', false);
        failChallenge(s, 'noLoan', '구제 금융을 받았습니다'); // 4.1.0 되돌릴 수 없다
        if (s.status === 'gameOver') { s.status = 'playing'; s.week++; } // 파산한 주는 월말 정산까지 끝났으므로 다음 주부터 이어 간다
        return OK;
      }
      case 'postJob': { // 9.1 채용 공고: 후보 3명
        const H = config.staff.hire, cost = H.postCost[cmd.tier - 1];
        if (!(config.staff.roles as readonly string[]).includes(cmd.role)) return fail('없는 직무입니다.');
        if (cost === undefined || !Number.isInteger(cmd.tier)) return fail('공고 등급은 1~3 중에서 고르세요.');
        if (cmd.tier === 3 && s.reputation < H.tier3Rep) return fail(`3등급 공고는 평판 ${H.tier3Rep} 이상이어야 합니다.`);
        if (staffCount(s) >= staffCap(s)) return fail(`정원(${staffCap(s)}명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.`);
        if (s.candidates.length) return fail('이미 공고한 후보가 있습니다. 먼저 채용하거나 돌려보내세요.');
        if (s.cash < cost) return fail('현금이 모자랍니다.');
        this.spend(cost);
        const bonus = Math.floor(repEffect(s.reputation) / H.repBonusDiv);
        for (let i = 0; i < H.candidates; i++) {
          const ability = Math.min(100, this.rng.intIn(H.abilityMin[cmd.tier - 1], H.abilityMax[cmd.tier - 1]) + bonus);
          const potential = Math.min(100, ability + this.rng.intIn(H.potentialMin, H.potentialMax));
          s.candidates.push({ id: s.nextId++, name: this.newName(), role: cmd.role, ability, potential, salary: salaryOf(ability), expiresWeek: s.week + H.expireWeeks });
        }
        return OK;
      }
      case 'hire': {
        const c = s.candidates.find((x) => x.id === cmd.candidateId);
        if (!c) return fail('없는 후보입니다.');
        if (staffCount(s) >= staffCap(s)) return fail(`정원(${staffCap(s)}명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.`);
        s.candidates = s.candidates.filter((x) => x !== c);
        s.staff.push(startHist({ id: c.id, name: c.name, role: c.role, ability: c.ability, potential: c.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }, s.week));
        return OK;
      }
      case 'dismissCandidates': {
        if (!s.candidates.length) return fail('돌려보낼 후보가 없습니다.');
        s.candidates = [];
        return OK;
      }
      case 'fire': { // 퇴직금 = 월급 2개월분(현금이 모자라도 낸다), 배치 중이면 빠진다
        const x = s.staff.find((y) => y.id === cmd.staffId);
        if (!x) return fail('없는 직원입니다.');
        this.spend(severanceOf(payOf(x)));
        s.staff = s.staff.filter((y) => y !== x);
        noteFormer(s, x);
        return OK;
      }
      case 'rehire': { // 4.1.0 전 직원 다시 채용: 채용비 = 월급 × feeMonths, 능력·성장 한계·경력 그대로(전담팀원이었어도 일반 직원으로)
        const f = s.former?.find((y) => y.staff.id === cmd.staffId);
        if (!f || s.week - f.left >= config.former.months * config.time.weeksPerMonth) return fail(`다시 채용할 수 있는 전 직원이 아닙니다(나간 지 ${config.former.months}개월 안의 사람만).`);
        if (staffCount(s) >= staffCap(s)) return fail(`정원(${staffCap(s)}명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.`);
        const fee = rehireFee(f.staff);
        if (s.cash < fee) return fail('현금이 모자랍니다.');
        this.spend(fee);
        s.former = s.former!.filter((y) => y !== f);
        const x = f.staff; delete x.elite;
        s.staff.push({ ...x, condition: 1, projectId: null, trainings: x.trainings, restUntil: null, lab: false }); s.staff.sort((a, b) => a.id - b.id);
        return OK;
      }
      case 'train': {
        const x = s.staff.find((y) => y.id === cmd.staffId);
        if (!x) return fail('없는 직원입니다.');
        const err = trainError(s, x);
        if (err) return fail(err);
        const T = x.elite ? config.elite.train : config.staff.train; // 4.1.0 전담팀원은 전담 교육(짧고 한계가 높다)
        this.spend(staffTrainCost(x));
        x.ability = Math.min(trainCap(x), x.ability + this.rng.intIn(T.gainMin, T.gainMax)); // 능력은 바로 오르고, 4주 동안 산출 0(전담팀원은 성장 한계 + capAdd까지)
        x.trainings.push(s.week);
        return OK;
      }
      case 'rest': {
        const x = s.staff.find((y) => y.id === cmd.staffId);
        if (!x) return fail('없는 직원입니다.');
        if (!Number.isInteger(cmd.weeks) || cmd.weeks < 1 || cmd.weeks > config.staff.restMaxWeeks) return fail(`휴식은 1~${config.staff.restMaxWeeks}주 사이로 정하세요.`);
        if (isAway(x, s.week) && x.restUntil === null) return fail('교육 중에는 휴식할 수 없습니다.');
        x.restUntil = s.week + cmd.weeks;
        return OK;
      }
      case 'assign': {
        const x = s.staff.find((y) => y.id === cmd.staffId);
        if (!x) return fail('없는 직원입니다.');
        if (x.elite && cmd.projectId === 'lab') return fail('직속 전담팀원은 개발 전용이라 연구소에 둘 수 없습니다.');
        const tp = typeof cmd.projectId === 'number' ? s.projects.find((p) => p.id === cmd.projectId) : undefined; // 4.1.0 전담팀원이 들어가면 전담팀 개발(전담팀 자리는 한 팀)
        if (x.elite && tp && !tp.elite && eliteBusy(s)) return fail('전담팀이 이미 다른 차를 개발 중입니다.');
        if (cmd.projectId === 'lab') { // 10장 전담 연구원
          if (s.hqLevel < config.research.labHq) return fail(`전담 연구원은 본사 ${config.research.labHq}등급(${config.hq.levels[config.research.labHq - 1].name})부터 둘 수 있습니다.`);
          if (x.role !== 'engineer') return fail('전담 연구원은 엔지니어만 될 수 있습니다.');
          x.projectId = null; x.lab = true;
          return OK;
        }
        if (!isDevRole(x.role)) return fail('영업 직원은 개발에 배치할 수 없습니다.');
        if (cmd.projectId !== null && !s.projects.some((p) => p.id === cmd.projectId)) return fail('없는 개발 프로젝트입니다.');
        x.projectId = cmd.projectId; x.lab = false; // 프로젝트에 넣거나 빼면 연구소에서도 나온다
        if (x.elite && tp) tp.elite = true;
        return OK;
      }
      case 'upgradeHQ': {
        const err = hqUpgradeError(s);
        if (err) return fail(err);
        this.spend(config.hq.levels[s.hqLevel].cost);
        s.hqLevel++;
        return OK;
      }
      case 'expandFactory': {
        const err = factoryExpandError(s);
        if (err) return fail(err);
        this.spend(config.factory.levels[s.factory.level].cost);
        s.factory.build = { level: s.factory.level + 1, doneMonth: monthOf(s.week) + factoryBuildMonths(s.factory.level + 1) };
        return OK;
      }
      case 'buildBatteryPlant': { // 1.2.0 공장 증설과 같은 방식: 건설비는 바로, 공사가 끝난 달 초부터 새 등급
        const err = batteryPlantError(s);
        if (err) return fail(err);
        const L = config.ev.plant.levels[s.batteryPlant.level];
        this.spend(L.cost);
        s.batteryPlant.build = { level: s.batteryPlant.level + 1, doneMonth: monthOf(s.week) + L.buildMonths };
        return OK;
      }
      case 'setAllocation': {
        const g = allGens(s).find((x) => x.id === cmd.generationId);
        if (!g || g.status === 'discontinued') return fail('판매 중인 차가 아닙니다.');
        if (cmd.share !== null && (typeof cmd.share !== 'number' || !Number.isFinite(cmd.share) || cmd.share < 0 || cmd.share > 1)) return fail('배분 몫은 0~100% 사이여야 합니다.');
        const others = sellingGens(s).filter((x) => x !== g).reduce((a, x) => a + (x.allocShare ?? 0), 0);
        if (others + (cmd.share ?? 0) > 1 + 1e-9) return fail('차종별 배분의 합이 100%를 넘습니다.');
        g.allocShare = cmd.share;
        return OK;
      }
      case 'startResearch': { // 10장: 돈은 바로, 연구 점수가 쌓이는 만큼 진행
        const err = researchError(s, cmd.techId);
        if (err) return fail(err);
        const c = researchCost(s, techById(cmd.techId));
        this.spend(c.money); s.pendingResearch = (s.pendingResearch ?? 0) + c.money;
        s.research.active.push({ techId: cmd.techId, points: 0, need: c.points, startWeek: s.week });
        return OK;
      }
      case 'prioritizeResearch': { // 0.5.1: 맨 앞으로(주간 점수의 50%)
        const a = s.research.active.find((x) => x.techId === cmd.techId);
        if (!a) return fail('진행 중인 연구가 아닙니다.');
        s.research.active = [a, ...s.research.active.filter((x) => x !== a)]; s.research.priority = a.techId;
        return OK;
      }
      case 'cancelResearch': {
        if (!s.research.active.some((a) => a.techId === cmd.techId)) return fail('진행 중인 연구가 아닙니다.');
        s.research.active = s.research.active.filter((a) => a.techId !== cmd.techId); // 쓴 돈은 돌아오지 않는다
        if (s.research.priority === cmd.techId) delete s.research.priority;
        return OK;
      }
      case 'resolveEvent': {
        const pc = s.events.pending.find((x) => x.id === cmd.eventId);
        if (!pc) return fail('답할 사건이 없습니다.');
        const def = RANDOM_EVENTS.find((d) => d.id === pc.eventId)!;
        if (!Number.isInteger(cmd.choice) || cmd.choice < 0 || cmd.choice >= def.choices.length) return fail(`선택지는 0~${def.choices.length - 1} 중에서 고르세요.`);
        const events: GameEvent[] = [];
        this.applyChoice(pc, cmd.choice, events, false);
        return { ok: true, events };
      }
      case 'setAutoDecide': { // 3.7.0 결정 자동 승인(앞으로 생기는 결정부터)
        const kinds = cmd.kind === 'all' ? AUTO_KINDS.map((k) => k.id) : AUTO_KINDS.some((k) => k.id === cmd.kind) ? [cmd.kind] : null;
        if (!kinds) return fail('없는 결정 종류입니다.');
        const kd = AUTO_KINDS.find((k) => k.id === cmd.kind);
        if (cmd.choice !== undefined && !(kd && autoAnswerOk(kd, cmd.choice))) return fail('그 종류에서 고를 수 없는 답입니다.');
        const a = (s.autoDecide ??= { on: [] }), on = new Set(a.on);
        for (const k of kinds) if (cmd.on) on.add(k); else on.delete(k);
        a.on = AUTO_KINDS.map((k) => k.id).filter((k) => on.has(k));
        if (kd && cmd.choice !== undefined) { // 3.7.1 처음 값과 같으면 칸을 지워 3.7.0 저장과 같게 둔다
          const p: Record<string, number | 'rule'> = { ...a.pick, [kd.id]: cmd.choice };
          if (cmd.choice === autoInitial(kd)) delete p[kd.id];
          const keep = AUTO_KINDS.filter((k) => k.id in p).map((k) => [k.id, p[k.id]] as const);
          if (keep.length) a.pick = Object.fromEntries(keep); else delete a.pick;
        }
        return OK;
      }
      case 'setAutoDecideGuard': {
        const a = (s.autoDecide ??= { on: [] });
        if (cmd.on) delete a.guard; else a.guard = false;
        return OK;
      }
      case 'appointExec': case 'dismissExec': case 'postExecJob': case 'hireExec': case 'setDelegation': case 'dismissReport': case 'markReportsRead':
      case 'approveReplacement': case 'rejectReplacement': case 'cancelReplacement': case 'setGenAuto': return execCommand(this.execCtx(), cmd)!; // 0.7.0 임원, 1.3.0 세대교체 위임
      case 'hireElite': case 'setElite': case 'setEliteTrain': return eliteCommand({ s, spend: (c) => this.spend(c) }, cmd)!; // 4.1.0 직속 전담팀
      case 'openRegion': case 'setExport': case 'setRegionPrice': case 'investOffice': case 'setRegionAuto': case 'setDomFirst': return worldCommand({ s, spend: (c) => this.spend(c) }, cmd, [])!; // 4.0.0 세계 시장
      case 'foundSubsidiary': case 'setSubStrategy': case 'setSubArea': case 'setSubDividend': case 'investSub': case 'setSubPresident': case 'setSubShare':
      case 'subAddModel': case 'subDropModel': case 'renameSubModel': case 'sellSubsidiary':
      case 'setSubMode': case 'subPlanModel': case 'subOrderModel': case 'subBadgeModel': case 'subCancelOrder': case 'setSubModelPrice': case 'setSubTarget': return subCommand({ s, spend: (c) => this.spend(c) }, cmd, [])!; // 3.0.0 자회사
      case 'hireRivalTalent': case 'allyRival': case 'endAlliance': case 'buyRivalTech': case 'listSub': case 'acquireRival': return rivalryCommand({ s, spend: (c) => this.spend(c) }, cmd)!; // 3.5.0 경쟁 2부
      case 'devCheat': { // 개발자 메뉴(개발 단계용)
        const ev: GameEvent[] = [];
        switch (cmd.kind) {
          case 'cash': s.cash += config.devCheat.cash; break;
          case 'reputation': this.addRep(config.devCheat.reputation, '개발자 메뉴'); break;
          case 'finishResearch': for (const a of s.research.active) a.points = a.need; this.researchWeek(ev); break;
          case 'finishDev': for (const p of [...s.projects].sort((a, b) => a.id - b.id)) if (!p.waiting) {
            const team = s.staff.filter((x) => x.projectId === p.id).sort((a, b) => a.id - b.id);
            p.phase = 'test'; p.weeksDone = Math.max(p.weeksDone, p.designWeeks); p.testWeeks = Math.max(p.testWeeks, config.dev.minTestWeeks);
            p.defects = 0; p.defectEst = 0; p.waiting = true; p.crew = team.map((x) => x.id);
            for (const x of team) x.projectId = null;
          } break;
          case 'restStaff': for (const x of s.staff) x.condition = 1; break;
          default: return fail('알 수 없는 개발자 메뉴입니다.');
        }
        s.devUsed = true;
        return { ok: true, events: ev };
      }
      default: return fail('알 수 없는 명령입니다.');
    }
  }

  /** 무작위 사건의 선택 결과(11.2). auto: 4주 동안 답이 없어 기본 선택 */
  private applyChoice(pc: PendingChoice, idx: number, ev: GameEvent[], auto: boolean, approved = false): void {
    const s = this.state, def = RANDOM_EVENTS.find((d) => d.id === pc.eventId)!, choice = def.choices[idx], m = monthOf(s.week);
    const g = pc.genId === null ? undefined : allGens(s).find((x) => x.id === pc.genId && x.status !== 'discontinued');
    this.spend(-choiceMoney(s, pc, idx)); // 현금·결함 수리비(화면 pendingChoices의 cost와 같은 계산)
    s.events.pending = s.events.pending.filter((x) => x !== pc);
    for (const e of choice.effects) switch (e.type) {
      case 'cash': break;
      case 'rep': this.addRep(e.value, def.name); break;
      case 'awareness': for (const x of e.target === 'car' ? (g ? [g] : []) : sellingGens(s)) x.awareness = Math.min(1, x.awareness + e.value); break;
      case 'awarenessMult': if (g) g.awareness *= e.value; break;
      case 'condition': for (const x of s.staff) x.condition = Math.min(1, x.condition + e.value); break;
      case 'fixDefects': if (g) currentEdition(g).defects = 0; break;
      case 'mod': s.events.mods.push({ kind: e.mod, value: e.value || (pc.fx ?? 1), untilMonth: m + e.months, label: def.name }); break;
      case 'hire': if (staffCount(s) < staffCap(s)) {
        const ability = this.rng.intIn(e.abilityMin, e.abilityMax), id = s.nextId++;
        s.staff.push(startHist({ id, name: this.newName(), role: 'engineer', ability, potential: Math.min(100, ability + this.rng.intIn(config.staff.hire.potentialMin, config.staff.hire.potentialMax)), condition: 1, projectId: null, trainings: [], restUntil: null, lab: false }, s.week));
      } break;
      case 'warFollow': case 'retain': applyRivalChoice(s, pc, e.type); break; // 3.5.0
    }
    if (pc.rv && !choice.effects.length) applyRivalChoice(s, pc, 'none');
    const result = pc.rv?.results[idx] ?? choice.result;
    if (approved) addNews(s, ev, `자동 승인: ${def.name} → ${choice.label} 선택 — ${result}`, 'result', 'news', undefined, 'auto'); // 3.7.0
    else addNews(s, ev, `[${def.name}] ${choice.label}${auto ? '(답하지 않아 기본 선택)' : ''} — ${result}`, 'result', 'news', undefined, pc.rv ? 'rival' : undefined);
  }
  /** 3.5.0 위임: 재무 임원 '가격 전쟁 대응'·인사 임원 '이직 제안 대응'이 켜져 있으면 결정 창을 바로 처리하고 보고함에 남긴다 */
  private autoRivalry(ev: GameEvent[]): void {
    const s = this.state;
    for (const pc of s.events.pending.filter((p) => p.rv).sort((a, b) => a.id - b.id)) {
      const role = pc.eventId === 'priceWar' ? 'finance' : 'hr', key = pc.eventId === 'priceWar' ? 'autoPriceWar' : 'autoPoach';
      if (!delegationOn(s, role, key)) continue;
      const a = autoChoice(s, pc); if (!a) continue;
      const def = RANDOM_EVENTS.find((d) => d.id === pc.eventId)!, label = def.choices[a.choice].label;
      this.applyChoice(pc, a.choice, ev, false);
      addReport(s, role, key, `[${def.name}] ${label}. ${a.why}`, [pc.text], pc.eventId === 'priceWar' ? { tab: 'garage' } : { tab: 'company', sub: 'staff' }, true);
    }
  }

  /** 3.7.0 결정 자동 승인: 이번 주에 생긴 결정 가운데 켠 종류(임원이 처리하지 않은 것)를 바로 처리한다. 안전선에 걸리면 그대로 묻는다.
   *  임원·자동 승인이 처리한 결정의 '결정 대기' 이벤트는 내보내지 않는다(창·알림이 뜨지 않게) */
  private autoDecide(ev: GameEvent[]): void {
    const s = this.state;
    if (s.autoDecide?.on.length) for (const pc of s.events.pending.filter((p) => p.week === s.week && autoOn(s, p.eventId)).sort((a, b) => a.id - b.id)) {
      const a = autoPick(s, pc);
      if (!autoHold(s, pc, a.choice)) this.applyChoice(pc, a.choice, ev, false, true);
    }
    for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i]; if (e.kind === 'choice' && !s.events.pending.some((p) => p.id === e.id)) ev.splice(i, 1); }
  }
  /** 일회성 지출: 현금에서 바로 빼고 장부(이달 oneOff)에 적는다 */
  private spend(cost: number): void { this.state.cash -= cost; this.state.pendingOneOff += cost; }
  /** 채용 후보 이름(성 + 이름, 지금 직원·후보와 겹치지 않게 최대 20번 다시 뽑는다) */
  private newName(): string {
    const s = this.state, used = new Set([...s.staff, ...s.candidates, ...Object.values(s.execs?.seats ?? {}).map((x) => x.staff), ...(s.execs?.candidates ?? []), ...presidents(s)].map((x) => x.name));
    let name = '';
    for (let i = 0; i < 20 && (!name || used.has(name)); i++) name = NAMES.family[this.rng.intIn(0, NAMES.family.length - 1)] + NAMES.given[this.rng.intIn(0, NAMES.given.length - 1)];
    return name;
  }
  /** 4.1.0 전담팀원이 들어간 팀은 전담팀 자리(한 팀), 아니면 일반 개발팀 수 */
  private teamError(team: Staff[] | string): string | null {
    const s = this.state;
    if (typeof team !== 'string' && team.some((x) => x.elite)) return eliteBusy(s) ? '직속 전담팀이 이미 다른 차를 개발 중입니다. 전담팀원을 빼고 고르거나 그 개발을 끝내세요.' : null;
    return teamsUsed(s) >= devTeams(s) ? '개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.' : null;
  }
  /** 배치할 팀: 생략하면 쉬고 있는 개발 직무 전원. 문제가 있으면 이유(문자열) */
  private teamFor(ids?: number[]): Staff[] | string {
    const s = this.state;
    if (ids === undefined) {
      const idle = s.staff.filter((x) => x.projectId === null && isDevRole(x.role) && !x.lab && !x.elite); // 4.1.0 전담팀원은 직접 골라야 들어간다
      return idle.length ? idle : '배치할 직원이 없습니다.';
    }
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) return '배치할 직원을 한 명 이상, 겹치지 않게 고르세요.';
    const team: Staff[] = [];
    for (const id of ids) {
      const x = s.staff.find((y) => y.id === id);
      if (!x) return '없는 직원입니다.';
      if (!isDevRole(x.role)) return '영업 직원은 개발에 배치할 수 없습니다.';
      if (x.projectId !== null) return `${x.name}${josa(x.name, '은/는')} 이미 다른 개발에 배치되어 있습니다.`;
      if (x.lab) return `${x.name}${josa(x.name, '은/는')} 전담 연구원입니다. 먼저 연구소에서 빼세요.`;
      team.push(x);
    }
    return team;
  }
  /** 프로젝트를 만들고 팀을 배치한다(검증은 호출하는 쪽에서) */
  private addProject(kind: ProjectKind, targetId: number | null, spec: ProjectSpec, chassisSeed: number, faceSeed: number, team: Staff[]): Project {
    const s = this.state, id = s.nextId++;
    const p: Project = {
      id, startWeek: s.week, kind, targetId, chassisSeed, faceSeed, name: spec.name,
      body: spec.body, segment: spec.segment, powertrain: spec.powertrain, tier: spec.tier, level: levelForTier(s, spec.powertrain, spec.tier), options: withRequired(s, spec.options), ...(spec.equip ? { equip: equipOf(spec, s) } : {}), ...(spec.powertrain === EV && spec.battery ? { battery: spec.battery } : {}), // 1.2.0 배터리(전기차만). 의무 장비는 자동으로 넣는다(0.4.2). 1.1.0: 장비 구성도 의무 장비는 기본 장비로
      direction: { ...spec.direction }, budget: spec.budget, designWeeks: spec.designWeeks,
      phase: 'design', weeksDone: 0, testWeeks: 0, points: zeroStats(), defects: 0, defectEst: 0, spent: 0,
    };
    if (team.some((x) => x.elite)) p.elite = true; // 4.1.0
    s.projects.push(p);
    for (const x of team) x.projectId = id;
    return p;
  }

  /** 0.10.0 긴급 개선 끝: 지금 판의 남은 결함을 시험 결과로, 품질은 결함 감점을 다시 계산하고 × (1 + qGain). 평론·인지도·수명은 그대로 */
  private finishFix(p: Project, ev: GameEvent[]): void {
    const s = this.state, g = allGens(s).find((x) => x.id === p.targetId);
    if (g && g.status !== 'discontinued') {
      const ed = currentEdition(g), before = ed.defects;
      ed.stats.Q = (ed.stats.Q / defectQMult(before)) * (1 + config.rescue.qGain) * defectQMult(p.defects);
      ed.defects = p.defects; g.fixed = { week: s.week, cost: p.spent }; pnlOf(g).dev.fix += p.spent;
      noteCar(s.staff.filter((x) => x.projectId === p.id), s.week, g.id, 'fix');
      ev.push({ kind: 'news', id: g.id, category: 'other', text: `「${p.name}」 ${g.number}세대 개선판: 품질을 손보고 결함을 줄였습니다(리콜 위험 연 ${Math.round(Math.min(config.recall.maxYear, before * config.recall.perDefect) * 100)}% → ${Math.round(Math.min(config.recall.maxYear, p.defects * config.recall.perDefect) * 100)}%).` });
    }
    this.closeProject(p);
  }

  private closeProject(p: Project): void {
    const s = this.state;
    for (const x of s.staff) if (x.projectId === p.id) x.projectId = null;
    s.projects = s.projects.filter((x) => x !== p);
  }

  /** 출시(7.1~7.2): 능력치 확정 → 평론 → 평판 → 차종·세대·판 생성. 페이스리프트는 새 판, 풀체인지는 새 세대(8장) */
  private launch(cmd: Extract<Command, { type: 'launch' }>): CommandResult {
    const s = this.state, p = s.projects.find((x) => x.id === cmd.projectId);
    if (!p) return fail('없는 개발 프로젝트입니다.');
    if (p.kind === 'fix') return fail('긴급 개선은 끝나면 저절로 반영됩니다.');
    if (p.phase !== 'test' || p.testWeeks < config.dev.minTestWeeks) return fail(`시험을 최소 ${config.dev.minTestWeeks}주 해야 출시할 수 있습니다.`);
    const liftGen = p.kind === 'facelift' ? allGens(s).find((x) => x.id === p.targetId) : undefined;
    const deriv = p.kind === 'derivative' ? allGens(s).find((x) => x.id === p.targetId) : undefined; // 1.3.0 파생 모델의 바탕 세대
    if (p.kind === 'derivative' && !deriv) return fail('바탕 세대가 없습니다. 개발을 취소하세요.');
    const np = p.kind === 'fullchange' ? nameplateById(s, p.targetId!) : p.into !== undefined ? nameplateById(s, p.into) : undefined, prev = np?.generations.length ? latestGen(np) : undefined;
    if (p.kind === 'facelift' && liftGen?.status !== 'onSale') return fail('판매 중인 세대가 아니어서 페이스리프트를 출시할 수 없습니다. 개발을 취소하세요.');
    if (p.kind === 'fullchange' && !prev) return fail('없는 차종입니다.');
    const root = deriv ? nameplateOfGen(s, deriv.id)!.id : np ? lineRoot(np) : null; // 1.3.0 파생 차종은 바탕 차종의 생산 라인을 함께 쓴다
    const inherits = p.kind === 'facelift' || (prev !== undefined && prev.status !== 'discontinued') || (root !== null && sellingGens(s).some((g) => lineRoot(nameplateOfGen(s, g.id)!) === root)); // 같은 생산 라인을 이어 쓴다
    if (!inherits && linesUsed(s) >= linesOf(s)) return fail('빈 생산 라인이 없습니다. 판매 중인 차를 단종하거나 공장을 증설하세요.');
    const base = carBasePrice(s, p), bad = priceError(p.body, cmd.price) ?? marketingError(cmd.marketing); // 시장 기준가(의무 장비 원가 포함, 0.4.2)
    if (bad) return fail(bad);
    if (cmd.wheels !== 0 && cmd.wheels !== 1 && cmd.wheels !== 2) return fail('바퀴 모양은 0~2 중에서 고르세요.');
    if (typeof cmd.color !== 'string') return fail('색상을 고르세요.');
    const reg = regulationError(s, p); // 11장 규제: 의무 장비 기술을 연구하지 않았거나 금지된 동력이면 출시 불가
    if (reg) return fail(reg);
    p.options = withRequired(s, p.options); // 개발 중에 규제가 시행됐으면 의무 장비를 넣어 출시한다(0.4.2)
    if (p.equip) { p.equip = equipOf(p, s); syncOptions(p); } // 1.1.0
    const year = yearOf(s.week), month = monthOf(s.week), events: GameEvent[] = [], plat = projectPlatform(s, p); // 1.2.0 전기차 전용 플랫폼
    const edition = (stats: Stats, kind: Edition['kind'], headline: string | null): Edition =>
      ({ id: s.nextId++, kind, launchWeek: s.week, tier: p.tier, level: p.level, options: [...p.options], ...(p.equip ? { equip: { ...p.equip } } : {}), stats, defects: p.defects, price: cmd.price, color: cmd.color, wheels: cmd.wheels, faceSeed: p.faceSeed, headline, ...(p.battery ? { battery: p.battery } : {}) });

    if (liftGen) { // 8.2 페이스리프트: 새 판, 평론 재평가 없음
      const fl = config.lifecycle.facelift, g = liftGen;
      const stats = faceliftRefresh(variantStats(finalStats(g.body, g.powertrain, p.level, p.options, g.points, p.defects, optWeights(equipOf(p), g.body, g.segment, year), platformUMult(plat)), g.variant));
      stats.D += Math.min(bodyById(g.body).mult.D * p.points.D, fl.dCap * g.editions[0].stats.D); // 디자이너 점수(상한: 원래 D의 +10%)
      winStats(stats, p.wins); applyWinsToGen(g, p.wins); // 1.3.0 직원 성과
      const age = month - g.lifeMonth, late = month - g.launchMonth >= fl.lateMonths;
      g.lifeMonth = month - age * (late ? fl.lateLifeKeep : fl.lifeKeep); // 수명 나이를 40%로(늦으면 70%로)
      g.awareness = Math.min(1, g.awareness + fl.awareness);
      g.marketing = cmd.marketing; pnlOf(g).dev.lift += p.spent; g.devCost += p.spent;
      const text = `「${p.name}」 ${g.number}세대 페이스리프트 출시: 새 얼굴로 돌아왔다${late ? '(다소 늦은 변경)' : ''}`;
      g.editions.push(edition(stats, 'facelift', text));
      events.push({ kind: 'news', id: g.id, text, category: 'other' });
    } else {
      const pts = deriv ? deriv.points : p.points; // 1.3.0 파생 모델은 바탕 세대의 개발 점수에 종류별 배수
      const stats = winStats(variantStats(finalStats(p.body, p.powertrain, p.level, p.options, pts, p.defects, optWeights(equipOf(p), p.body, p.segment, year), platformUMult(plat)), p.variant), p.wins);
      const nm = p.elite ? config.elite.noise : 1; // 4.1.0 전담팀 차는 평론 흔들림이 작다(난수 순서는 같다)
      const reviews = criticScores(stats, year, base, cmd.price, p.defects, () => this.rng.range(-1, 1) * nm, diffOf(s).manyDefects), c = config.critics, fc = config.lifecycle.fullChange;
      const first = worldFirstTechs(s, p); // 10장 "세계 최초": 먼저 연구한 기술을 쓴 첫 차는 평론 +1(기술마다 한 번)
      if (first.length) {
        for (let i = 0; i < reviews.length; i++) reviews[i] = Math.round(Math.min(c.max, reviews[i] + config.research.worldFirst) * 10) / 10;
        s.research.early = s.research.early.filter((id) => !first.includes(id));
        events.push({ kind: 'news', category: 'research', text: `「${p.name}」 세계 최초로 ${first.map((id) => `「${techById(id).name}」`).join(', ')} 기술을 담았다. 평론가들이 높이 평가했습니다.` });
      }
      const fx = expectEffect(equipOf(p, s), p.body, year); // 1.1.0 시대의 기대: 기대 장비가 없으면 평론 감점, 드문 장비를 기본으로 넣으면 가점
      if (fx.review) for (let i = 0; i < reviews.length; i++) reviews[i] = Math.round(Math.min(c.max, Math.max(c.min, reviews[i] + fx.review)) * 10) / 10;
      if (fx.missing.length) { const names = fx.missing.map((id) => optionById(id).name).join('·'); events.push({ kind: 'news', category: 'other', text: `「${p.name}」 평론: 요즘 이 차급이면 있어야 할 ${names}${josa(names, '이/가')} 없다.` }); }
      if (p.powertrain === EV) { // 1.2.0 평론의 주행 거리·충전 한 줄
        const km = rangeKm(p.level, p.battery, plat), exp = expectedRange(p.body, year);
        events.push({ kind: 'news', category: 'other', text: `「${p.name}」 평론: 주행 거리 ${km}km로 이 차급의 기대(${exp}km)${km >= exp * 1.1 ? '보다 넉넉하다' : km >= exp ? '를 채운다' : '에 못 미친다'}. 10→80% 충전은 ${chargeMinutes(s, p.battery)}분${plat ? ', 전용 플랫폼이라 실내가 넓다' : ''}.` });
      }
      const combo = `${p.body}:${p.segment}`;
      if (!s.knownCombos.includes(combo)) s.knownCombos.push(combo); // 5.5 조합 노트에 공개
      let headline: string | null = null, equity = 0, rebuy = 0;
      if (np && prev) { // 8.3 풀체인지: 전작 비교·차종 자산·재구매, 전 세대는 이번 달 말 단종
        const carried = carriedEquity(s, np.id, p.body), cmp = compareToPrev(prev, stats, p.body), no = prev.number + 1; // 전작 비교는 원점수(절대 성능)로(0.4.2)
        const delta = cmp === 'worse' ? fc.worseReview : cmp === 'better' ? fc.betterReview : 0;
        for (let i = 0; i < reviews.length; i++) reviews[i] = Math.round(Math.min(c.max, Math.max(c.min, reviews[i] + delta)) * 10) / 10;
        headline = `「${np.name}」 ${no}세대${carried.revival ? '로 부활,' : ','} ${delta < 0 ? '전작만 못하다' : delta > 0 ? '진화했다' : '전작과 비슷하다'}`;
        equity = carried.equity; rebuy = rebuyPerMonth(prev);
        if (prev.status === 'onSale') { prev.status = 'ending'; prev.endMonth = month; }
        events.push({ kind: 'news', id: prev.id, text: headline, category: 'other' });
      }
      const avg = mean(reviews);
      if (avg >= c.masterpiece) this.addRep(c.masterpieceRep, `「${p.name}」 명차 선정`); else if (avg <= c.flop) this.addRep(c.flopRep, `「${p.name}」 혹평`);
      if (avg > config.reputation.launchBase) this.addRep((avg - config.reputation.launchBase) * config.reputation.launchPer, `「${p.name}」 좋은 평론`); // 평론이 좋으면 오른다(0.5.1: 5 미만이어도 감점하지 않는다)
      const vd = variantById(p.variant);
      if (vd?.rep && avg >= config.reputation.launchBase) this.addRep(vd.rep, `「${p.name}」 ${vd.name} 출시`); // 1.3.0 고성능판: 평판(브랜드) 가점
      if (deriv && !np) events.push({ kind: 'news', category: 'other', text: `「${p.name}」 출시: 「${this.nameOf(deriv)}」 ${deriv.number}세대를 바탕으로 한 ${vd!.name}` });
      const gen: Generation = {
        id: s.nextId++, number: prev ? prev.number + 1 : 1, body: p.body, segment: p.segment, powertrain: p.powertrain,
        launchWeek: s.week, launchMonth: month, lifeMonth: month, chassisSeed: p.chassisSeed, points: { ...pts }, equity, rebuy,
        marketing: cmd.marketing, awareness: Math.min(1, awarenessStart(s.reputation, avg) + equity),
        status: 'onSale', endMonth: null, editions: [],
        reviews, reviewAvg: avg, masterpiece: avg >= c.masterpiece, sales: [], totalSold: 0, lastDemand: 0, lostSales: 0, allocShare: null, devCost: p.spent, profit: 0, recalls: 0, pnl: newPnl(p.spent),
        plan: { direction: { ...p.direction }, budget: p.budget, designWeeks: p.designWeeks, opts: optionsAt(s).map((o) => o.id) }, // 0.8.0 풀체인지가 물려받을 기획 값
        ...(plat ? { evPlatform: true as const } : {}), ...(p.variant ? { variant: p.variant } : {}), ...(deriv ? { fromGen: deriv.id } : {}),
      };
      gen.editions.push(edition(stats, 'initial', headline));
      if (prev?.world) { const on = Object.entries(prev.world).filter(([, w]) => w.on).map(([rid]) => rid); if (on.length) gen.world = Object.fromEntries(on.map((rid) => [rid, { on: true, sold: 0, demand: 0, total: 0, rev: 0, profit: 0 }])); } // 4.0.0 풀체인지는 전 세대의 수출 권역을 이어받는다
      if (prev?.domFirst) gen.domFirst = true;
      applyWinsToGen(gen, p.wins); // 1.3.0 직원 성과(원가 인하·인지도)
      if (p.elite) { gen.elite = true; if (avg >= config.elite.opus) gen.opus = true; } // 4.1.0 전담팀 차·수작
      gen.critiques = writeCritiques(s, { name: p.name, genId: gen.id, stats, year, reviews, price: cmd.price, base, missing: fx.missing, fresh: fx.fresh, // 1.3.0 평론가별 시승기
        ev: p.powertrain === EV ? { km: rangeKm(p.level, p.battery, plat), exp: expectedRange(p.body, year) } : null });
      if (np) np.generations.push(gen); else s.nameplates.push({ id: s.nextId++, name: p.name, generations: [gen], ...(deriv ? { baseOf: root!, variant: p.variant } : {}) });
    }
    // 9.1 경험: 프로젝트를 마친(출시) 참여 직원 능력 +1~2(잠재력 상한), 직원 ID 순
    const ex = config.staff.exp, crew = s.staff.filter((y) => y.projectId === p.id || p.crew?.includes(y.id)).sort((a, b) => a.id - b.id);
    noteCar(crew, s.week, liftGen ? liftGen.id : allGens(s).at(-1)!.id, p.kind); // 0.10.0 직원 경력: 참여한 차
    if (p.elite) eliteLaunched(s, crew); // 4.1.0 팀 호흡
    for (const x of crew) // 출시 대기로 풀려난 직원 포함
      x.ability = Math.max(x.ability, Math.min(x.potential, x.ability + this.rng.intIn(ex.min, ex.max)));
    this.closeProject(p);
    return events.length ? { ok: true, events } : OK;
  }

  // ---------- 저장 ----------
  toJSON(): CarState { return JSON.parse(JSON.stringify(this.state)); }
  static fromJSON(data: unknown): Game {
    const d = data as Partial<CarState> | null;
    if (!d || typeof d !== 'object' || typeof d.saveVersion !== 'number') throw new Error('카 컴퍼니 저장 파일이 아닙니다');
    if (d.saveVersion > SAVE_VERSION) throw new Error('더 새로운 버전에서 저장한 파일입니다');
    if (typeof d.rng !== 'number' || typeof d.week !== 'number' || typeof d.cash !== 'number' || !Array.isArray(d.nameplates) || !Array.isArray(d.projects) || !Array.isArray(d.staff) || !Array.isArray(d.rivals))
      throw new Error('저장 파일이 손상되었습니다');
    const st = JSON.parse(JSON.stringify(d)) as CarState;
    if ((st.saveVersion as number) === 1) migrateV1(st);
    if ((st.saveVersion as number) === 2) migrateV2(st);
    if ((st.saveVersion as number) === 3) migrateV3(st);
    if ((st.saveVersion as number) === 4) migrateV4(st);
    if ((st.saveVersion as number) === 5) migrateV5(st);
    if ((st.saveVersion as number) === 6) migrateV6(st);
    if ((st.saveVersion as number) === 7) migrateV7(st);
    if ((st.saveVersion as number) === 8) (st as { saveVersion: number }).saveVersion = 9; // 형식 8 → 9(3.0.0): 자회사 없음(subs 없음과 같다)
    if ((st.saveVersion as number) === 9) { st.rivalry ??= emptyRivalry(); (st as { saveVersion: number }).saveVersion = 10; } // 형식 9 → 10(3.5.0): 경쟁 2부 빈 상태(다음 달부터 시작). 새 칸은 모두 빠질 수 있다
    if ((st.saveVersion as number) === 10) migrateV10(st);
    if ((st.saveVersion as number) === 11) migrateV11(st);
    fillRivalCells(st); // 0.6.0 소형·대형 SUV처럼 나중에 더한 칸(저장 형식은 그대로 4)
    return new Game(st);
  }

  /** 개발자 메뉴(개발 단계용): 명령 기록에 남는다(결정론·저장 왕복 유지) */
  devCheat(kind: 'cash' | 'reputation' | 'finishResearch' | 'finishDev' | 'restStaff'): CommandResult { return this.command({ type: 'devCheat', kind }); }

  /** 화면 표시용 날짜 */
  get dateLabel(): string { return dateLabel(this.state.week); }
}

/** 저장 형식 1 → 2: 새 필드를 채운다. 개발 원점수는 출시 능력치에서 거꾸로 계산(리콜로 결함이 0이 된 차는 품질 감점을 모르므로 0으로 본다) */
function migrateV1(st: CarState): void {
  const fill = <T extends object>(o: T, k: keyof T, v: T[keyof T]) => { if (o[k] === undefined) o[k] = v; };
  for (const n of st.nameplates) for (const g of n.generations) {
    const ed0 = g.editions[0], mult = bodyById(g.body).mult, part = partStats(g.powertrain, ed0.tier, ed0.options), pts = zeroStats();
    for (const k of STATS) pts[k] = Math.max(0, (k === 'Q' ? ed0.stats.Q / defectQMult(ed0.defects) : ed0.stats[k]) / mult[k] - part[k]);
    fill(g, 'points', pts); fill(g, 'lifeMonth', g.launchMonth); fill(g, 'equity', 0); fill(g, 'rebuy', 0);
    fill(g, 'chassisSeed', hash32(st.seed, n.id, 0, g.number, 1, 2, 0));
    g.editions.forEach((e, i) => { fill(e, 'faceSeed', hash32(st.seed, n.id, 0, g.number, i + 1, 1, 0)); fill(e, 'headline', null); });
  }
  for (const p of st.projects) {
    fill(p, 'kind', 'new'); fill(p, 'targetId', null);
    fill(p, 'chassisSeed', lookCandidates(st, 0, 'chassis')[0]); fill(p, 'faceSeed', lookCandidates(st, 0, 'face')[0]);
  }
  st.rivals.forEach((r, ri) => {
    fill(r, 'models', {});
    for (const body of Object.keys(r.cells).sort()) fill(r.models, body, firstRivalModel(st.seed, ri, body, r.cells[body]));
  });
  (st as { saveVersion: number }).saveVersion = 2;
}

/** 저장 형식 2 → 3: 직원(잠재력·교육·휴식), 채용 후보, 본사·공장 등급(1), 생산 배분(자동), 장부 일회성 지출.
 *  잠재력은 0.2.0의 임시 성장 상한 60과 지금 능력 중 큰 값 */
function migrateV2(st: CarState): void {
  for (const x of st.staff) { x.potential ??= Math.max(x.ability, 60); x.trainings ??= []; x.restUntil ??= null; }
  st.candidates ??= []; st.hqLevel ??= 1; st.factory ??= { level: 1, build: null }; st.pendingOneOff ??= 0;
  for (const n of st.nameplates) for (const g of n.generations) { g.lostSales ??= 0; g.allocShare ??= null; }
  for (const e of st.ledger) e.oneOff ??= 0;
  (st as { saveVersion: number }).saveVersion = 3;
}

/** 저장 형식 3 → 4: 연구·사건·조합 노트·차체 10종.
 *  - 이미 쓰고 있던(판매·개발한) 차체·옵션·동력을 여는 기술과 그 선행 기술을 연구 완료로 표시(연도 자동 해금이 없어졌으므로)
 *  - 판·프로젝트의 실제 동력 단계 = 등급(3단계까지는 등급이 곧 단계였다), 전담 연구원 없음, 출시한 조합은 공개
 *  - 경쟁사의 새 차체 칸은 fromJSON의 fillRivalCells가 채운다 */
function migrateV3(st: CarState): void {
  for (const x of st.staff) x.lab ??= false;
  const gens = st.nameplates.flatMap((n) => n.generations).sort((a, b) => a.id - b.id);
  for (const g of gens) for (const e of g.editions) e.level ??= e.tier;
  for (const p of st.projects) p.level ??= p.tier;
  st.knownCombos ??= [...new Set(gens.map((g) => `${g.body}:${g.segment}`))];
  st.events ??= { pending: [], mods: [], news: [] };
  const used = new Set<string>([...gens.flatMap((g) => [g.body, g.powertrain, ...g.editions.flatMap((e) => e.options)]), ...st.projects.flatMap((p) => [p.body, p.powertrain, ...p.options])]);
  const done = new Set(TECHS.filter((t) => !t.repeatable && t.effects.some((e) => (e.type === 'body' || e.type === 'option' || e.type === 'powertrain') && used.has(e.id))).map((t) => t.id));
  for (let grew = true; grew;) { grew = false; for (const id of [...done]) for (const q of techById(id).pre) if (!done.has(q)) { done.add(q); grew = true; } }
  st.research ??= { done: TECHS.filter((t) => done.has(t.id)).map((t) => t.id), active: [], early: [] };
  (st as { saveVersion: number }).saveVersion = 4;
}
/** 저장 형식 4 → 5(1.1.0): 판·프로젝트의 옵션 목록을 모두 기본 장비로 */
function migrateV4(st: CarState): void {
  const std = (o: string[]) => Object.fromEntries(o.map((id) => [id, 'std' as const]));
  for (const n of st.nameplates) for (const g of n.generations) for (const e of g.editions) { e.equip ??= std(e.options); e.equipLegacy = true; } // 옛 규칙(옵션이 적자·칸 2~4개)으로 낸 차라 기대 감점을 면제
  for (const p of st.projects) p.equip ??= std(p.options);
  (st as { saveVersion: number }).saveVersion = 5;
}
/** 저장 형식 5 → 6(1.2.0): 배터리 공장 없음. 배터리 용량이 없는 전기차는 표준, 전용 플랫폼 없음으로 읽힌다(필드를 채우지 않아도 같다) */
function migrateV5(st: CarState): void {
  st.batteryPlant ??= { level: 0, build: null };
  (st as { saveVersion: number }).saveVersion = 6;
}
/** 저장 형식 6 → 7(1.3.0): 출시된 세대에 평론가별 시승기를 붙인다(점수는 기존 평론 그대로, 글은 출시 때 능력치·가격으로 결정론적으로).
 *  시장 기준가는 지금 기준으로 어림한다. 파생 모델·직원 성과·세대교체 위임은 없음으로 읽힌다(필드를 채우지 않아도 같다) */
function migrateV6(st: CarState): void {
  for (const n of st.nameplates) for (const g of n.generations) {
    if (g.critiques) continue;
    const ed = g.editions[0], year = yearOf(g.launchWeek), fx = ed.equipLegacy ? { missing: [], fresh: [] } : expectEffect(equipOf(ed), g.body, year);
    g.critiques = writeCritiques(st, { name: n.name, genId: g.id, stats: ed.stats, year, reviews: g.reviews, price: ed.price, base: carBasePrice(st, { body: g.body, segment: g.segment, powertrain: g.powertrain, options: ed.options, battery: ed.battery }), missing: fx.missing, fresh: fx.fresh,
      ev: g.powertrain === EV ? { km: rangeKm(ed.level, ed.battery, !!g.evPlatform), exp: expectedRange(g.body, year) } : null });
  }
  (st as { saveVersion: number }).saveVersion = 7;
}
/** 저장 형식 7 → 8(1.5.0): 새 게임 선택지는 1970년·보통·도전 없음(start 없음과 같다), 지난 해의 연말 평판(repEnd)은 해마다의 평판 변화로 거꾸로 셈해 채운다 */
function migrateV7(st: CarState): void {
  let rep = st.reputation;
  const cur = yearOf(st.week);
  for (const y of Object.keys(st.years ?? {}).map(Number).sort((a, b) => b - a)) {
    const log = st.years![y], d = Object.values(log.rep).reduce((a, x) => a + x, 0);
    if (y < cur && log.months >= config.time.monthsPerYear) log.repEnd ??= rep;
    rep -= d; // rep: y년 초(= y − 1년 말) 평판
  }
  (st as { saveVersion: number }).saveVersion = 8;
}
/** 저장 형식 10 → 11(4.0.0): 경쟁 모델 옛 이름(시드로 섞은 지어낸 이름)을 새 이름으로(인수 브랜드 모델·시상식 기록, 플레이어가 바꾼 이름은 그대로),
 *  새 경쟁사(비엠브이·혼디, 등장 달이 지났으면 테슬러)를 지금 달 라인업으로 뒤에 더하고 뉴스 한 줄. 기존 회사 순번은 그대로. 세계 시장(world)은 없음 = 진출 전 */
function migrateV10(st: CarState): void {
  const m = monthOf(st.week);
  const ren = (rid: string | undefined, body: string, name: string): string => {
    const ri = rid ? st.rivals.findIndex((r) => r.id === rid) : -1;
    return ri >= 0 && name === legacyModelName(st.seed, ri, rid!, body) ? rivalModelName(st.seed, ri, rid!, body) : name;
  };
  for (const sub of st.subs ?? []) if (sub.from) for (const md of sub.models) md.name = ren(sub.from, md.body, md.name);
  for (const a of st.rivalry?.awards ?? []) a.car = ren(a.who === 'rival' ? RIVALS.find((r) => r.name === a.company)?.id : a.who === 'sub' ? st.subs?.find((x) => x.name === a.company)?.from : undefined, a.body, a.car);
  const n0 = st.rivals.length;
  for (const d of RIVALS) if (!st.rivals.some((r) => r.id === d.id) && m >= entryMonth(st.seed, d.id)) st.rivals.push(enterRival(st.seed, st.rivals.length, d.id, m));
  for (const r of st.rivals) for (const body of Object.keys(r.models).sort()) r.cells[body] = rivalCellA(st.rivals, st.seed, r, body, m); // 정규화(다음 월 결산부터 경쟁 2부 가감이 다시 붙는다)
  for (const r of st.rivals.slice(n0)) addNews(st, [], enterText(r), 'rival', 'news', undefined, 'rival');
  (st as { saveVersion: number }).saveVersion = 11;
}
/** 저장 형식 11 → 12(4.1.0): 전담팀·전 직원·도전 과제 실패는 없음으로 읽는다(빈칸). 실제 이름과 겹치던 경쟁 모델 이름(RENAMED_410)을 새 이름으로
 *  (인수 브랜드 모델·시상식 기록, 플레이어가 바꾼 이름은 그대로). 구제 금융을 이미 받은 '대출 없이' 판은 실패로 남긴다 */
function migrateV11(st: CarState): void {
  const ren = (rid: string | undefined, body: string, name: string): string => (rid && RENAMED_410[rid]?.[body] === name ? rivalModelName(st.seed, 0, rid, body) : name);
  for (const sub of st.subs ?? []) if (sub.from) for (const md of sub.models) md.name = ren(sub.from, md.body, md.name);
  for (const a of st.rivalry?.awards ?? []) a.car = ren(a.who === 'rival' ? RIVALS.find((r) => r.name === a.company)?.id : a.who === 'sub' ? st.subs?.find((x) => x.name === a.company)?.from : undefined, a.body, a.car);
  if ((st.loan.bailouts ?? (st.loan.bailoutUsed && diffOf(st).bailouts > 0 ? 1 : 0)) > 0) failChallenge(st, 'noLoan', '구제 금융을 받았습니다');
  (st as { saveVersion: number }).saveVersion = 12;
}
/** 4.1.0에 바꾼 경쟁 모델 이름(예전 이름, 경쟁사 → 차체 → 이름). 저장 변환에서 이 이름 그대로인 것만 새 이름으로 */
export const RENAMED_410: Record<string, Record<string, string>> = { bmv: { suvS: 'X-1', suv: 'X-5', suvL: 'X-7', sports: 'Z-4' }, hondi: { sports: 'S2100' }, porty: { pickup: 'F-160' } };
/** 4.1.0 해고·교체로 나간 직원을 전 직원 목록에(12개월 동안 다시 채용 가능) */
export function noteFormer(s: CarState, x: Staff): void {
  const y: Staff = JSON.parse(JSON.stringify(x)); delete y.elite; y.projectId = null; y.lab = false;
  (s.former ??= []).push({ left: s.week, staff: y });
}
/** 4.1.0 전 직원 다시 채용비 = 월급 × feeMonths */
export const rehireFee = (x: Staff): number => payOf({ ...x, elite: undefined }) * config.former.feeMonths;
/** 경쟁사 자료에 있는데 저장에 없는 칸: 지금 달 기준 첫 모델(게임 난수를 쓰지 않는다). 형식 3 변환과 0.6.0 새 차체 칸이 함께 쓴다 */
function fillRivalCells(st: CarState): void {
  const m = monthOf(st.week);
  st.rivals.forEach((r, ri) => {
    const def = RIVALS.find((x) => x.id === r.id);
    for (const body of Object.keys(def?.cells ?? {}).sort()) if (!r.models[body]) {
      r.models[body] = firstRivalModel(st.seed, ri, body, rivalBase(m) + def!.cells[body]);
      r.cells[body] = rivalCellA(st.rivals, st.seed, r, body, m);
    }
  });
}
