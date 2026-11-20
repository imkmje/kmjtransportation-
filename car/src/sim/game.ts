// 카 컴퍼니 게임 본체: 상태, 1주 진행(tick), 명령(command), 저장(toJSON/fromJSON)
import { config } from '../config';
import { NAMES, RANDOM_EVENTS, RIVALS, TECHS, bodyById, techById } from '../data';
import { avgGrade, defectQMult, finalStats, grade, partStats, salaryOf, unitCost, zeroStats } from './cars';
import { specError, stepProject } from './dev';
import { capacityOf, costMultOf, devTeams, factoryExpandError, hqUpgradeError, isAway, isDevRole, linesOf, salesAwarenessBonus, severanceOf, staffCap, trainCost, trainError, upkeepOf } from './company';
import { loanLimit, loanRate } from './finance';
import { carriedEquity, faceliftEligibility, fullChangeEligibility, lookCandidates, latestGen, launchAvgGrade, nameplateById, rebuyPerMonth } from './lifecycle';
import { awarenessStart, awarenessTarget, currentEdition, firstRivalModel, monthlyDemand, toSaleCar, initRivals, updateRivals, rivalA, rivalBase } from './market';
import { addNews, monthStart, regulationError } from './events';
import { levelForTier, ptCostAdd, researchCost, researchError, researchWeek, worldFirstTechs } from './research';
import { criticScores, mean } from './reviews';
import { josa } from './josa';
import { Rng, hash32 } from './rng';
import { DIFFICULTIES, diffOf } from './difficulty';
import { dateLabel, isMonthEnd, monthLabel, monthOf, monthTime, yearOf } from './time';
import { STATS, type CarState, type Command, type CommandResult, type Edition, type GameEvent, type Generation, type LedgerEntry, type PendingChoice, type Project, type ProjectKind, type ProjectSpec, type Staff, type Stats, type Difficulty } from './types';

/** 저장 형식 번호. 2: 차종의 일생(페이스리프트·풀체인지·3D 시드·경쟁 차 교체). 3: 직원·본사·공장(9장). 4: 연구·시대 사건·조합 노트·차체 10종(10·11장, 5.5).
 *  형식 1·2·3은 fromJSON이 올린다 */
export const SAVE_VERSION = 4;
/** difficulty: 생략하면 'easy'(0.4.1 새 게임 기본) */
export interface GameOptions { seed: number; companyName?: string; difficulty?: Difficulty }

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
const priceError = (body: string, price: number): string | null => {
  const base = bodyById(body).basePrice;
  return !Number.isFinite(price) || price < base * config.price.min - 1e-6 || price > base * config.price.max + 1e-6
    ? `가격은 기준가(${base.toLocaleString()}만원)의 ${config.price.min}~${config.price.max}배 사이여야 합니다.` : null;
};
const seedError = (x: unknown): string | null =>
  x === undefined || (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 0xffffffff) ? null : '모양 시드가 올바르지 않습니다.';
const marketingError = (m: number): string | null =>
  !Number.isInteger(m) || m < 0 || m >= config.awareness.marketingCost.length ? `광고 등급은 0~${config.awareness.marketingCost.length - 1} 중에서 고르세요.` : null;

/** 판매 중(생산 라인을 차지하는) 세대: 단종 신청한 달까지 포함 */
export const sellingGens = (s: CarState): Generation[] =>
  s.nameplates.flatMap((n) => n.generations).filter((g) => g.status !== 'discontinued').sort((a, b) => a.id - b.id);
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
    const rng = new Rng(opts.seed);
    const pool = [...NAMES.staff];
    const staff: Staff[] = config.start.roles.map((role, i) => ({
      id: i + 1, name: pool.splice(rng.intIn(0, pool.length - 1), 1)[0], role,
      ability: rng.intIn(config.start.abilityMin, config.start.abilityMax), potential: 0, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false,
    }));
    const rivals = initRivals(rng, opts.seed);
    for (const x of staff) x.potential = rng.intIn(config.start.potentialMin, config.start.potentialMax); // 경쟁사 뒤에 뽑아 2단계까지의 난수 순서를 지킨다
    const state: CarState = {
      saveVersion: SAVE_VERSION, difficulty, seed: opts.seed, rng: rng.getState(), week: 0,
      companyName: opts.companyName?.trim() || NAMES.defaultCompany,
      reputation: config.start.reputation, cash: D.cash,
      loan: { balance: 0, limitMult: 1, bailoutUsed: D.bailouts <= 0, bailouts: 0 }, negMonths: 0, status: 'playing',
      staff, candidates: [], hqLevel: 1, factory: { level: 1, build: null },
      projects: [], nameplates: [], rivals, ledger: [], pendingDev: 0, pendingOneOff: 0, nextId: staff.length + 1,
      research: { done: [], active: [], early: [] }, events: { pending: [], mods: [], news: [] }, knownCombos: [], history: [],
    };
    return new Game(state);
  }

  // ---------- 1주 진행 ----------
  tick(): GameEvent[] {
    const s = this.state, ev: GameEvent[] = [];
    if (s.status !== 'playing') return ev;
    for (const p of [...s.projects].sort((a, b) => a.id - b.id)) {
      if (p.waiting) continue; // 출시 대기: 개발비·진행 없음
      const phase = p.phase, log = stepProject(s, p, this.rng);
      const made = log.staff.reduce((a, x) => a + STATS.reduce((b, k) => b + x.stats[k], 0), 0);
      ev.push({
        kind: 'devWeek', id: p.id, projectId: p.id, staff: log.staff, defectsAdded: log.defectsAdded, defectsRemoved: log.defectsRemoved,
        text: phase === 'design' ? `「${p.name}」 설계 ${p.weeksDone}주차: 점수 +${made.toFixed(1)}, 결함 +${log.defectsAdded.toFixed(1)}` : `「${p.name}」 시험 ${p.testWeeks}주차: 결함 −${log.defectsRemoved.toFixed(1)}`,
      });
      if (log.designDone) ev.push({ kind: 'designDone', id: p.id, text: `「${p.name}」 설계가 끝났습니다. 시험을 시작합니다.` });
      if (log.waitingNow) ev.push({ kind: 'advice', id: p.id, text: `「${p.name}」의 결함을 모두 잡았습니다. 이제 출시할 수 있습니다. 출시 대기 중에는 개발비가 들지 않습니다.` });
    }
    researchWeek(s, ev); // 10장: 쉬는 엔지니어·전담 연구원의 연구 점수(직원 컨디션 갱신 전, 이번 주 배치 기준)
    this.staffWeek(ev);
    if (isMonthEnd(s.week)) this.monthEnd(ev);
    if (s.status === 'playing') {
      s.week++;
      const gone = s.candidates.filter((c) => s.week >= c.expiresWeek);
      if (gone.length) { s.candidates = s.candidates.filter((c) => s.week < c.expiresWeek); ev.push({ kind: 'company', text: `채용 후보 ${gone.length}명이 다른 회사로 갔습니다.` }); }
      for (const pc of s.events.pending.filter((x) => s.week >= x.deadline).sort((a, b) => a.id - b.id)) // 답하지 않은 사건은 기본 선택
        this.applyChoice(pc, RANDOM_EVENTS.find((d) => d.id === pc.eventId)!.defaultChoice, ev, true);
      if (s.week % config.time.weeksPerMonth === 0) monthStart(s, ev); // 11장: 시대 사건 뉴스·무작위 사건
    }
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
      if (x.trainings.length && x.trainings[x.trainings.length - 1] + config.staff.train.weeks === next) ev.push({ kind: 'company', id: x.id, text: `${x.name} 교육을 마쳤습니다(능력 ${x.ability}).` });
      if (x.restUntil !== null && x.restUntil <= next) { x.restUntil = null; ev.push({ kind: 'company', id: x.id, text: `${x.name} 휴식을 마치고 돌아왔습니다.` }); }
    }
  }

  private addRep(d: number): void { this.state.reputation = Math.min(config.reputation.max, Math.max(config.reputation.min, this.state.reputation + d)); }

  /** 월말 정산: 판매·인지도·리콜·재무·장부·파산 */
  private monthEnd(ev: GameEvent[]): void {
    const s = this.state, m = monthOf(s.week), year = yearOf(s.week), wpm = config.time.weeksPerMonth, LC = config.lifecycle;
    updateRivals(s, m, ev); // 경쟁 차가 낡거나 새 모델로 바뀐다(진출·철수·히트작·대응 신차)
    const gens = sellingGens(s), t = monthTime(m), M = s.market;
    // 7.3·7.5 지역별 수요: 칸(지역 × 차체)마다 그 칸에서 파는 내 차들을 함께 계산한다(지역·차체 순)
    const regDemand: Record<string, number>[] = gens.map(() => ({}));
    const cells: { key: string; region: string; size: number; idx: number[]; rivals: { id: string; units: number }[] }[] = [];
    for (const region of REGIONS) for (const body of [...new Set(gens.map((g) => g.body))].sort()) {
      const idx = gens.flatMap((g, i) => (g.body === body && g.regions.includes(region) ? [i] : []));
      if (!idx.length) continue;
      const cs = cellSales(s, region, body, idx.map((i) => toSaleCar(gens[i], m, region)), t);
      idx.forEach((i, k) => { regDemand[i][region] = cs.mine[k]; });
      cells.push({ key: cellKey(region, body), region, size: cs.size, idx, rivals: cs.rivals });
    }
    const demand = gens.map((g, i) => {
      const rd = regDemand[i];
      let mult = 1;
      if (g.launchMonth === m) mult *= (m * wpm + wpm - g.launchWeek) / wpm; // 출시 달은 판매한 주만큼
      const ed = currentEdition(g);
      if (ed.kind === 'facelift' && monthOf(ed.launchWeek) === m) mult *= LC.facelift.switchMonthMult; // 페이스리프트 전환 달 생산 −30%
      if (g.status === 'ending') mult *= config.discontinue.lastMonthMult; // 단종 달: 재고 처분
      if (g.rebuy > 0 && m - g.launchMonth < LC.fullChange.rebuyMonths) { const r0 = g.regions.includes(REGION) ? REGION : g.regions[0]; rd[r0] = (rd[r0] ?? 0) + g.rebuy; } // 기존 고객 재구매(풀체인지 첫 12개월, 국내 우선)
      for (const r of Object.keys(rd)) rd[r] *= mult;
      return Object.values(rd).reduce((a, x) => a + x, 0);
    });
    // 9.3 생산 배분: 수동 몫이 있는 차는 한도 × 몫까지, 나머지 한도는 자동 차들에 수요 비례로. 한 차의 생산은 지역에 수요 비례로 나눈다
    const cap = capacityOf(s), manual = gens.reduce((a, g) => a + (g.allocShare ?? 0), 0), autoCap = Math.max(0, cap * (1 - manual));
    const autoTotal = gens.reduce((a, g, i) => a + (g.allocShare === null ? demand[i] : 0), 0);
    const fill = autoTotal > autoCap ? autoCap / autoTotal : 1, fx = fxMult(s);
    let revenue = 0, cogs = 0, marketing = 0, recall = 0, sold = 0, exported = 0;
    const regionSold: Record<string, number> = {};
    const soldIn: Record<string, number>[] = gens.map(() => ({}));
    gens.forEach((g, i) => {
      const n = Math.round(g.allocShare === null ? demand[i] * fill : Math.min(demand[i], cap * g.allocShare));
      const ed = currentEdition(g), uc = unitCost(g.body, g.powertrain, ed.tier, ed.options, costMultOf(s), ptCostAdd(s, g.powertrain));
      const mk = config.awareness.marketingCost[g.marketing], rs = REGIONS.filter((r) => g.regions.includes(r) || regDemand[i][r] !== undefined);
      let left = n, extra = 0; // extra: 물류비 + 환율(수출 차만)
      rs.forEach((r, k) => {
        const d = regDemand[i][r] ?? 0, nr = k === rs.length - 1 ? left : Math.min(left, demand[i] > 0 ? Math.round((n * d) / demand[i]) : 0);
        left -= nr; soldIn[i][r] = nr; regionSold[r] = (regionSold[r] ?? 0) + nr;
        if (r !== REGION) { extra += nr * (MARKET[r].logistics * bodyById(g.body).basePrice + uc * (fx - 1)); exported += nr; }
        const prev = g.markets[r];
        g.markets[r] = { demand: d, sold: nr, lost: Math.max(0, d - nr), total: (prev?.total ?? 0) + nr };
      });
      g.lastDemand = demand[i]; g.lostSales = Math.max(0, demand[i] - n);
      g.sales.push(n); g.totalSold += n; sold += n;
      revenue += n * ed.price; cogs += n * uc + extra; marketing += mk;
      g.profit += n * (ed.price - uc) - extra - mk;
      for (const r of g.regions) { // 인지도: 지역마다 목표값으로(해외는 목표가 낮다)
        const target = awarenessTarget(s.reputation, g.marketing, grade(ed.stats.Q, year), r), aw = awarenessIn(g, r);
        setAwarenessIn(g, r, aw + (target - aw) * (config.awareness.rate + salesAwarenessBonus(s))); // 영업 직원이 수렴을 빠르게(9.1)
      }
      if (ed.defects > 0) { // 6.3 리콜: 연 확률 min(40%, 결함 × 2%)을 달로 나눠 굴린다
        const pYear = Math.min(config.recall.maxYear, ed.defects * config.recall.perDefect);
        if (this.rng.next() < 1 - (1 - pYear) ** (1 / config.time.monthsPerYear)) {
          const cost = g.totalSold * config.recall.costPerCar * diffOf(s).recallMult;
          recall += cost; g.profit -= cost; g.recalls++;
          scaleAwareness(g, config.recall.awarenessMult); ed.defects = 0; // 전량 수리했으므로 결함은 없어진다
          this.addRep(config.recall.rep);
          ev.push({ kind: 'recall', id: g.id, text: `「${this.nameOf(g)}」 리콜 실시. 수리비 ${Math.round(cost).toLocaleString()}만원이 들고 평판이 ${-config.recall.rep} 떨어졌습니다.` });
        }
      }
      const dc = config.discontinue, last = g.sales.slice(-dc.adviceMonths); // 8.6: 월 10대 미만이 6개월째가 된 달에 한 번 조언
      if (g.status === 'onSale' && last.length === dc.adviceMonths && last.every((x) => x < dc.adviceSales) && !(g.sales.length > dc.adviceMonths && g.sales[g.sales.length - dc.adviceMonths - 1] < dc.adviceSales))
        ev.push({ kind: 'advice', id: g.id, text: `「${this.nameOf(g)}」 판매가 ${dc.adviceMonths}개월째 월 ${dc.adviceSales}대 미만입니다. 단종을 권합니다.` });
      if (g.status === 'ending') { g.status = 'discontinued'; ev.push({ kind: 'discontinued', id: g.id, text: `「${this.nameOf(g)}」 생산을 마쳤습니다. 다음 달부터 생산 라인이 빕니다.` }); }
    });
    this.marketMonth(cells, soldIn, exported, m, ev);
    const salaries = s.staff.reduce((a, x) => a + salaryOf(x.ability), 0);
    const upkeep = upkeepOf(s), dev = s.pendingDev, interest = s.loan.balance * loanRate(s), oneOff = s.pendingOneOff;
    const profit = revenue - cogs - salaries - upkeep - dev - marketing - interest - recall - oneOff;
    s.cash += profit + oneOff; s.pendingDev = 0; s.pendingOneOff = 0; // 일회성 지출은 명령 때 이미 현금에서 나갔다
    const e: LedgerEntry = { month: m, year, monthOfYear: (m % config.time.monthsPerYear) + 1, revenue, cogs, salaries, upkeep, dev, marketing, interest, recall, oneOff, profit, cash: s.cash, sold, regionSold };
    s.ledger.push(e);
    if (s.ledger.length > config.ledgerMonths) s.ledger.splice(0, s.ledger.length - config.ledgerMonths);
    ev.push({ kind: 'monthEnd', text: `${monthLabel(m)} 결산: 판매 ${sold}대, 이익 ${Math.round(profit).toLocaleString()}만원` });
    const b = s.factory.build; // 9.3 증설 공사: doneMonth 달부터 새 등급
    if (b && m + 1 >= b.doneMonth) {
      s.factory = { level: b.level, build: null };
      ev.push({ kind: 'company', text: `공장 ${b.level}등급 증설을 마쳤습니다. 한 달 생산 ${capacityOf(s).toLocaleString()}대, 생산 라인 ${linesOf(s)}개.` });
    }
    // 9.4 파산: 현금 음수로 난이도의 유예 개월(보통 12, 0.4.1에서 6 → 12) 연속이면 게임 오버
    if (s.cash < 0) {
      s.negMonths++;
      if (s.negMonths >= diffOf(s).bankruptcyMonths) { s.status = 'gameOver'; ev.push({ kind: 'gameOver', text: `현금 부족이 ${diffOf(s).bankruptcyMonths}개월 이어져 회사가 파산했습니다.` }); }
      else {
        const room = Math.max(0, loanLimit(s) - s.loan.balance); // 남은 대출 한도를 함께 알린다(0.4.1)
        ev.push({ kind: 'cashWarning', text: `현금이 ${s.negMonths}개월째 마이너스입니다. ${diffOf(s).bankruptcyMonths}개월이 되면 파산합니다.${room >= 10000 ? ` 대출 한도 ${Math.floor(room / 10000).toLocaleString()}억원이 남아 있습니다.` : ' 남은 대출 한도가 없습니다.'}` });
      }
    } else s.negMonths = 0;
  }

  /** 시장 정산(7.4·12장): 칸별 점유율·독점 감시(대응 신차), 연간 칸 판매, 누적 수출 단계 평판, 연말 지역 1위 평판 */
  private marketMonth(cells: { key: string; region: string; size: number; idx: number[]; rivals: { id: string; units: number }[] }[], soldIn: Record<string, number>[], exported: number, m: number, ev: GameEvent[]): void {
    const s = this.state, M = s.market, R = config.rivals;
    const live = new Set(cells.map((c) => c.key));
    for (const k of Object.keys(M.share)) if (!live.has(k)) { delete M.share[k]; M.dominance[k] = 0; }
    for (const c of cells) {
      const mine = c.idx.reduce((a, i) => a + (soldIn[i][c.region] ?? 0), 0), share = c.size > 0 ? mine / c.size : 0;
      M.share[c.key] = share;
      const yu = (M.yearUnits[c.key] ??= {});
      yu.me = (yu.me ?? 0) + mine;
      for (const r of c.rivals) yu[r.id] = (yu[r.id] ?? 0) + r.units;
      M.dominance[c.key] = share >= R.responseShare ? (M.dominance[c.key] ?? 0) + 1 : 0;
      if (M.dominance[c.key] >= R.responseMonths && !M.response[c.key]) { // 쉬운 독점 방지: 그 칸에 가장 강한 회사가 다음 교체 때 대응 신차
        const [region, body] = c.key.split(':');
        const best = s.rivals.filter((r) => r.models[c.key]).map((r) => ({ r, v: RIVALS.find((d) => d.id === r.id)?.strength[region]?.[body] ?? 0 })).sort((a, b) => b.v - a.v || (a.r.id < b.r.id ? -1 : 1))[0];
        if (best) {
          M.response[c.key] = best.r.id;
          const nm = best.r.name;
          addNews(s, ev, `[경쟁사 대응] ${nm}${josa(nm, '이/가')} ${MARKET[region].name} ${bodyById(body).name} 시장에서 우리 회사의 점유율이 1년 넘게 ${Math.round(R.responseShare * 100)}%를 넘자 대응 신차를 준비합니다. 다음 모델 교체 때 경쟁이 거세집니다.`, 'other');
        }
      }
    }
    // 누적 수출 단계(1만·10만·100만 대)마다 평판 +3
    const P = config.reputation;
    M.exportUnits += exported;
    while (M.exportSteps < P.exportSteps.length && M.exportUnits >= P.exportSteps[M.exportSteps]) {
      const n = P.exportSteps[M.exportSteps]; M.exportSteps++;
      this.addRep(P.exportStepRep);
      addNews(s, ev, `[수출] 누적 수출이 ${n.toLocaleString()}대를 넘었습니다. 평판이 ${P.exportStepRep} 올랐습니다.`, 'other');
    }
    // 연말: 지역마다 연간 판매 1위인 칸이 하나라도 있으면 평판 +1(연 최대 cellTopMax)
    if (m % config.time.monthsPerYear === config.time.monthsPerYear - 1) {
      const won = REGIONS.filter((region) => Object.entries(M.yearUnits).some(([k, yu]) => k.startsWith(`${region}:`) && (yu.me ?? 0) > 0 && Object.entries(yu).every(([id, v]) => id === 'me' || v < (yu.me ?? 0)))).slice(0, P.cellTopMax);
      if (won.length) {
        this.addRep(P.cellTop * won.length);
        const names = won.map((r) => MARKET[r].name).join('·');
        addNews(s, ev, `[연말 결산] ${names}에서 연간 판매 1위 차급을 차지해 평판이 ${P.cellTop * won.length} 올랐습니다.`, 'other');
      }
      M.yearUnits = {};
    }
  }

  private nameOf(g: Generation): string { return this.state.nameplates.find((n) => n.generations.includes(g))?.name ?? ''; }

  // ---------- 명령 ----------
  command(cmd: Command): CommandResult {
    const r = this.exec(cmd);
    if (r.ok) this.state.history.push({ week: this.state.week, cmd: JSON.parse(JSON.stringify(cmd)) });
    this.state.rng = this.rng.getState();
    return r;
  }

  private exec(cmd: Command): CommandResult {
    const s = this.state;
    if (s.status !== 'playing' && cmd?.type !== 'bailout') return fail('게임이 끝났습니다.'); // 9.4: 파산 화면에서도 구제 금융은 받을 수 있다
    switch (cmd?.type) {
      case 'startProject': {
        const team = this.teamFor(cmd.team), err = this.teamError() ?? specError(s, cmd) ?? seedError(cmd.chassisSeed) ?? seedError(cmd.faceSeed) ?? (typeof team === 'string' ? team : null);
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
          name: n.name, body: g.body, segment: g.segment, powertrain: g.powertrain, tier, options: cmd.options,
          direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.lifecycle.facelift.designWeeks,
        };
        const team = this.teamFor(cmd.team);
        const err = this.teamError() ?? specError(s, { ...spec, designWeeks: d.designWeeks[0] })
          ?? (tier < ed.tier || levelForTier(s, g.powertrain, tier) < ed.level ? '동력 등급은 낮출 수 없습니다(지금 등급이나 그보다 높은 등급만 고를 수 있습니다).' : null)
          ?? seedError(cmd.faceSeed) ?? (typeof team === 'string' ? team : null);
        if (err) return fail(err);
        const p = this.addProject('facelift', g.id, spec, g.chassisSeed, cmd.faceSeed ?? lookCandidates(s, n.id, 'face', 'facelift')[0], team as Staff[]);
        p.defects = ed.defects * config.lifecycle.facelift.defectKeep; // 남은 결함 × 0.5로 시작
        return OK;
      }
      case 'startFullChange': { // 8.3
        const el = fullChangeEligibility(s, cmd.nameplateId);
        if (!el.ok) return fail(el.reason!);
        const n = nameplateById(s, cmd.nameplateId)!;
        const spec: ProjectSpec = { name: n.name, body: cmd.body, segment: cmd.segment, powertrain: cmd.powertrain, tier: cmd.tier, options: cmd.options, direction: cmd.direction, budget: cmd.budget, designWeeks: cmd.designWeeks };
        const team = this.teamFor(cmd.team), err = this.teamError() ?? specError(s, spec) ?? seedError(cmd.chassisSeed) ?? seedError(cmd.faceSeed) ?? (typeof team === 'string' ? team : null);
        if (err) return fail(err);
        this.addProject('fullchange', n.id, spec, cmd.chassisSeed ?? lookCandidates(s, n.id, 'chassis')[0], cmd.faceSeed ?? lookCandidates(s, n.id, 'face', 'nextGen')[0], team as Staff[]);
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
        if (recent.length && peak > 0 && mean(recent) >= peak * d.wellSelling) this.addRep(d.rep); // 잘 팔리는 차의 "아쉬운 퇴장"
        g.status = 'ending'; g.endMonth = monthOf(s.week);
        return OK;
      }
      case 'setPrice':
      case 'setMarketing': {
        const g = allGens(s).find((x) => x.id === cmd.generationId);
        if (!g || g.status !== 'onSale') return fail('판매 중인 차가 아닙니다.');
        const bad = cmd.type === 'setPrice' ? priceError(g.body, cmd.price) : marketingError(cmd.marketing);
        if (bad) return fail(bad);
        if (cmd.type === 'setPrice') currentEdition(g).price = cmd.price; else g.marketing = cmd.marketing;
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
        this.addRep(config.bankruptcy.bailoutRep);
        if (s.status === 'gameOver') { s.status = 'playing'; s.week++; } // 파산한 주는 월말 정산까지 끝났으므로 다음 주부터 이어 간다
        return OK;
      }
      case 'postJob': { // 9.1 채용 공고: 후보 3명
        const H = config.staff.hire, cost = H.postCost[cmd.tier - 1];
        if (!(config.staff.roles as readonly string[]).includes(cmd.role)) return fail('없는 직무입니다.');
        if (cost === undefined || !Number.isInteger(cmd.tier)) return fail('공고 등급은 1~3 중에서 고르세요.');
        if (cmd.tier === 3 && s.reputation < H.tier3Rep) return fail(`3등급 공고는 평판 ${H.tier3Rep} 이상이어야 합니다.`);
        if (s.staff.length >= staffCap(s)) return fail(`정원(${staffCap(s)}명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.`);
        if (s.candidates.length) return fail('이미 공고한 후보가 있습니다. 먼저 채용하거나 돌려보내세요.');
        if (s.cash < cost) return fail('현금이 모자랍니다.');
        this.spend(cost);
        const bonus = Math.floor(Math.min(H.repBonusMax, s.reputation / H.repBonusDiv));
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
        if (s.staff.length >= staffCap(s)) return fail(`정원(${staffCap(s)}명)이 찼습니다. 본사 등급을 올리면 정원이 늘어납니다.`);
        s.candidates = s.candidates.filter((x) => x !== c);
        s.staff.push({ id: c.id, name: c.name, role: c.role, ability: c.ability, potential: c.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
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
        this.spend(severanceOf(salaryOf(x.ability)));
        s.staff = s.staff.filter((y) => y !== x);
        return OK;
      }
      case 'train': {
        const x = s.staff.find((y) => y.id === cmd.staffId);
        if (!x) return fail('없는 직원입니다.');
        const err = trainError(s, x);
        if (err) return fail(err);
        const T = config.staff.train;
        this.spend(trainCost(x.ability));
        x.ability = Math.min(x.potential, x.ability + this.rng.intIn(T.gainMin, T.gainMax)); // 능력은 바로 오르고, 4주 동안 산출 0
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
        if (cmd.projectId === 'lab') { // 10장 전담 연구원
          if (s.hqLevel < config.research.labHq) return fail(`전담 연구원은 본사 ${config.research.labHq}등급(${config.hq.levels[config.research.labHq - 1].name})부터 둘 수 있습니다.`);
          if (x.role !== 'engineer') return fail('전담 연구원은 엔지니어만 될 수 있습니다.');
          x.projectId = null; x.lab = true;
          return OK;
        }
        if (!isDevRole(x.role)) return fail('영업 직원은 개발에 배치할 수 없습니다.');
        if (cmd.projectId !== null && !s.projects.some((p) => p.id === cmd.projectId)) return fail('없는 개발 프로젝트입니다.');
        x.projectId = cmd.projectId; x.lab = false; // 프로젝트에 넣거나 빼면 연구소에서도 나온다
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
        s.factory.build = { level: s.factory.level + 1, doneMonth: monthOf(s.week) + config.factory.buildMonths };
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
        this.spend(c.money);
        s.research.active.push({ techId: cmd.techId, points: 0, need: c.points, startWeek: s.week });
        return OK;
      }
      case 'cancelResearch': {
        if (!s.research.active.some((a) => a.techId === cmd.techId)) return fail('진행 중인 연구가 아닙니다.');
        s.research.active = s.research.active.filter((a) => a.techId !== cmd.techId); // 쓴 돈은 돌아오지 않는다
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
      default: return fail('알 수 없는 명령입니다.');
    }
  }

  /** 무작위 사건의 선택 결과(11.2). auto: 4주 동안 답이 없어 기본 선택 */
  private applyChoice(pc: PendingChoice, idx: number, ev: GameEvent[], auto: boolean): void {
    const s = this.state, def = RANDOM_EVENTS.find((d) => d.id === pc.eventId)!, choice = def.choices[idx], m = monthOf(s.week);
    const g = pc.genId === null ? undefined : allGens(s).find((x) => x.id === pc.genId && x.status !== 'discontinued');
    const rev = s.ledger.slice(-config.events.revenueMonths), avgRev = rev.length ? rev.reduce((a, e) => a + e.revenue, 0) / rev.length : 0;
    const salaries = s.staff.reduce((a, x) => a + salaryOf(x.ability), 0);
    s.events.pending = s.events.pending.filter((x) => x !== pc);
    for (const e of choice.effects) switch (e.type) {
      case 'cash': this.spend(-(e.base + (e.revenue ?? 0) * avgRev + (e.salaries ?? 0) * salaries)); break;
      case 'rep': this.addRep(e.value); break;
      case 'awareness': for (const x of e.target === 'car' ? (g ? [g] : []) : sellingGens(s)) x.awareness = Math.min(1, x.awareness + e.value); break;
      case 'awarenessMult': if (g) g.awareness *= e.value; break;
      case 'condition': for (const x of s.staff) x.condition = Math.min(1, x.condition + e.value); break;
      case 'fixDefects': if (g) { this.spend(g.totalSold * config.recall.costPerCar * diffOf(s).recallMult * e.costShare); currentEdition(g).defects = 0; } break;
      case 'mod': s.events.mods.push({ kind: e.mod, value: e.value || (pc.fx ?? 1), untilMonth: m + e.months, label: def.name }); break;
      case 'hire': if (s.staff.length < staffCap(s)) {
        const ability = this.rng.intIn(e.abilityMin, e.abilityMax), id = s.nextId++;
        s.staff.push({ id, name: this.newName(), role: 'engineer', ability, potential: Math.min(100, ability + this.rng.intIn(config.staff.hire.potentialMin, config.staff.hire.potentialMax)), condition: 1, projectId: null, trainings: [], restUntil: null, lab: false });
      } break;
    }
    addNews(s, ev, `[${def.name}] ${choice.label}${auto ? '(답하지 않아 기본 선택)' : ''} — ${choice.result}`, 'result');
  }

  /** 일회성 지출: 현금에서 바로 빼고 장부(이달 oneOff)에 적는다 */
  private spend(cost: number): void { this.state.cash -= cost; this.state.pendingOneOff += cost; }
  /** 채용 후보 이름(성 + 이름, 지금 직원·후보와 겹치지 않게 최대 20번 다시 뽑는다) */
  private newName(): string {
    const s = this.state, used = new Set([...s.staff, ...s.candidates].map((x) => x.name));
    let name = '';
    for (let i = 0; i < 20 && (!name || used.has(name)); i++) name = NAMES.family[this.rng.intIn(0, NAMES.family.length - 1)] + NAMES.given[this.rng.intIn(0, NAMES.given.length - 1)];
    return name;
  }
  private teamError(): string | null { return this.state.projects.length >= devTeams(this.state) ? '개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.' : null; }
  /** 배치할 팀: 생략하면 쉬고 있는 개발 직무 전원. 문제가 있으면 이유(문자열) */
  private teamFor(ids?: number[]): Staff[] | string {
    const s = this.state;
    if (ids === undefined) {
      const idle = s.staff.filter((x) => x.projectId === null && isDevRole(x.role) && !x.lab);
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
      body: spec.body, segment: spec.segment, powertrain: spec.powertrain, tier: spec.tier, level: levelForTier(s, spec.powertrain, spec.tier), options: [...spec.options],
      direction: { ...spec.direction }, budget: spec.budget, designWeeks: spec.designWeeks,
      phase: 'design', weeksDone: 0, testWeeks: 0, points: zeroStats(), defects: 0, defectEst: 0, spent: 0,
    };
    s.projects.push(p);
    for (const x of team) x.projectId = id;
    return p;
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
    if (p.phase !== 'test' || p.testWeeks < config.dev.minTestWeeks) return fail(`시험을 최소 ${config.dev.minTestWeeks}주 해야 출시할 수 있습니다.`);
    const liftGen = p.kind === 'facelift' ? allGens(s).find((x) => x.id === p.targetId) : undefined;
    const np = p.kind === 'fullchange' ? nameplateById(s, p.targetId!) : undefined, prev = np?.generations.length ? latestGen(np) : undefined;
    if (p.kind === 'facelift' && liftGen?.status !== 'onSale') return fail('판매 중인 세대가 아니어서 페이스리프트를 출시할 수 없습니다. 개발을 취소하세요.');
    if (p.kind === 'fullchange' && !prev) return fail('없는 차종입니다.');
    const inherits = p.kind === 'facelift' || (prev !== undefined && prev.status !== 'discontinued'); // 같은 생산 라인을 이어 쓴다
    if (!inherits && sellingGens(s).length >= linesOf(s)) return fail('빈 생산 라인이 없습니다. 판매 중인 차를 단종하거나 공장을 증설하세요.');
    const base = bodyById(p.body).basePrice, bad = priceError(p.body, cmd.price) ?? marketingError(cmd.marketing);
    if (bad) return fail(bad);
    if (cmd.wheels !== 0 && cmd.wheels !== 1 && cmd.wheels !== 2) return fail('바퀴 모양은 0~2 중에서 고르세요.');
    if (typeof cmd.color !== 'string') return fail('색상을 고르세요.');
    const reg = regulationError(s, p); // 11장 규제: 유예가 끝나면 필수 옵션이 없는 신차는 출시 불가
    if (reg) return fail(reg);
    const year = yearOf(s.week), month = monthOf(s.week), events: GameEvent[] = [];
    const edition = (stats: Stats, kind: Edition['kind'], headline: string | null): Edition =>
      ({ id: s.nextId++, kind, launchWeek: s.week, tier: p.tier, level: p.level, options: [...p.options], stats, defects: p.defects, price: cmd.price, color: cmd.color, wheels: cmd.wheels, faceSeed: p.faceSeed, headline });

    if (liftGen) { // 8.2 페이스리프트: 새 판, 평론 재평가 없음
      const fl = config.lifecycle.facelift, g = liftGen;
      const stats = finalStats(g.body, g.powertrain, p.level, p.options, g.points, p.defects);
      stats.D += Math.min(bodyById(g.body).mult.D * p.points.D, fl.dCap * g.editions[0].stats.D); // 디자이너 점수(상한: 원래 D의 +15%)
      const age = month - g.lifeMonth, late = month - g.launchMonth >= fl.lateMonths;
      g.lifeMonth = month - age * (late ? fl.lateLifeKeep : fl.lifeKeep); // 수명 나이를 40%로(늦으면 70%로)
      g.awareness = Math.min(1, g.awareness + fl.awareness);
      g.marketing = cmd.marketing; g.devCost += p.spent;
      const text = `「${p.name}」 ${g.number}세대 페이스리프트 출시: 새 얼굴로 돌아왔다${late ? '(다소 늦은 변경)' : ''}`;
      g.editions.push(edition(stats, 'facelift', text));
      events.push({ kind: 'news', id: g.id, text, category: 'other' });
    } else {
      const stats = finalStats(p.body, p.powertrain, p.level, p.options, p.points, p.defects);
      const reviews = criticScores(stats, year, base, cmd.price, p.defects, () => this.rng.range(-1, 1), diffOf(s).manyDefects), c = config.critics, fc = config.lifecycle.fullChange;
      const first = worldFirstTechs(s, p); // 10장 "세계 최초": 먼저 연구한 기술을 쓴 첫 차는 평론 +1(기술마다 한 번)
      if (first.length) {
        for (let i = 0; i < reviews.length; i++) reviews[i] = Math.round(Math.min(c.max, reviews[i] + config.research.worldFirst) * 10) / 10;
        s.research.early = s.research.early.filter((id) => !first.includes(id));
        events.push({ kind: 'news', category: 'research', text: `「${p.name}」 세계 최초로 ${first.map((id) => `「${techById(id).name}」`).join(', ')} 기술을 담았다. 평론가들이 높이 평가했습니다.` });
      }
      const combo = `${p.body}:${p.segment}`;
      if (!s.knownCombos.includes(combo)) s.knownCombos.push(combo); // 5.5 조합 노트에 공개
      let headline: string | null = null, equity = 0, rebuy = 0;
      if (np && prev) { // 8.3 풀체인지: 전작 비교·차종 자산·재구매, 전 세대는 이번 달 말 단종
        const carried = carriedEquity(s, np.id, p.body), prevAvg = launchAvgGrade(prev), nowAvg = avgGrade(stats, year), no = prev.number + 1;
        const delta = nowAvg < prevAvg ? fc.worseReview : nowAvg > prevAvg ? fc.betterReview : 0;
        for (let i = 0; i < reviews.length; i++) reviews[i] = Math.round(Math.min(c.max, Math.max(c.min, reviews[i] + delta)) * 10) / 10;
        headline = `「${np.name}」 ${no}세대${carried.revival ? '로 부활,' : ','} ${delta < 0 ? '전작만 못하다' : delta > 0 ? '진화했다' : '전작과 비슷하다'}`;
        equity = carried.equity; rebuy = rebuyPerMonth(prev);
        if (prev.status === 'onSale') { prev.status = 'ending'; prev.endMonth = month; }
        events.push({ kind: 'news', id: prev.id, text: headline, category: 'other' });
      }
      const avg = mean(reviews);
      if (avg >= c.masterpiece) this.addRep(c.masterpieceRep); else if (avg <= c.flop) this.addRep(c.flopRep);
      const gen: Generation = {
        id: s.nextId++, number: prev ? prev.number + 1 : 1, body: p.body, segment: p.segment, powertrain: p.powertrain,
        launchWeek: s.week, launchMonth: month, lifeMonth: month, chassisSeed: p.chassisSeed, points: { ...p.points }, equity, rebuy,
        marketing: cmd.marketing, awareness: Math.min(1, awarenessStart(s.reputation, avg) + equity),
        status: 'onSale', endMonth: null, editions: [],
        reviews, reviewAvg: avg, masterpiece: avg >= c.masterpiece, sales: [], totalSold: 0, lastDemand: 0, lostSales: 0, allocShare: null, devCost: p.spent, profit: 0, recalls: 0,
      };
      gen.editions.push(edition(stats, 'initial', headline));
      if (np) np.generations.push(gen); else s.nameplates.push({ id: s.nextId++, name: p.name, generations: [gen] });
    }
    // 9.1 경험: 프로젝트를 마친(출시) 참여 직원 능력 +1~2(잠재력 상한), 직원 ID 순
    const ex = config.staff.exp;
    for (const x of s.staff.filter((y) => y.projectId === p.id || p.crew?.includes(y.id)).sort((a, b) => a.id - b.id)) // 출시 대기로 풀려난 직원 포함
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
    return new Game(st);
  }

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
 *  - 경쟁사의 새 차체 칸: 지금 달 기준 첫 모델(게임 난수를 쓰지 않는다) */
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
  const m = monthOf(st.week);
  st.rivals.forEach((r, ri) => {
    const def = RIVALS.find((x) => x.id === r.id);
    for (const body of Object.keys(def?.cells ?? {}).sort()) if (!r.models[body]) {
      r.models[body] = firstRivalModel(st.seed, ri, body, rivalBase(m) + def!.cells[body]);
      r.cells[body] = rivalA(r.models[body], m);
    }
  });
  st.saveVersion = 4;
}
