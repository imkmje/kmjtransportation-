// 카 컴퍼니 게임 본체: 상태, 1주 진행(tick), 명령(command), 저장(toJSON/fromJSON)
import { config } from '../config';
import { BODIES, NAMES, OPTIONS, POWERTRAINS, bodyById } from '../data';
import { avgGrade, defectQMult, finalStats, grade, partStats, salaryOf, unitCost, zeroStats } from './cars';
import { specError, stepProject } from './dev';
import { loanLimit, loanRate } from './finance';
import { carriedEquity, faceliftEligibility, fullChangeEligibility, lookCandidates, latestGen, launchAvgGrade, nameplateById, rebuyPerMonth } from './lifecycle';
import { awarenessStart, awarenessTarget, currentEdition, firstRivalModel, monthlyDemand, toSaleCar, initRivals, updateRivals } from './market';
import { criticScores, mean } from './reviews';
import { Rng, hash32 } from './rng';
import { dateLabel, isMonthEnd, isYearStart, monthLabel, monthOf, monthTime, yearOf } from './time';
import { STATS, type CarState, type Command, type CommandResult, type Edition, type GameEvent, type Generation, type LedgerEntry, type Project, type ProjectKind, type ProjectSpec, type Stats } from './types';

/** 저장 형식 번호. 2: 차종의 일생(페이스리프트·풀체인지·3D 시드·경쟁 차 교체). 형식 1은 fromJSON이 올린다 */
export const SAVE_VERSION = 2;
export interface GameOptions { seed: number; companyName?: string }

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
  !Number.isInteger(m) || m < 0 || m >= config.awareness.marketingCost.length ? `마케팅 등급은 0~${config.awareness.marketingCost.length - 1} 중에서 고르세요.` : null;

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
    const rng = new Rng(opts.seed);
    const pool = [...NAMES.staff];
    const staff = config.start.roles.map((role, i) => ({
      id: i + 1, name: pool.splice(rng.intIn(0, pool.length - 1), 1)[0], role,
      ability: rng.intIn(config.start.abilityMin, config.start.abilityMax), condition: 1, projectId: null,
    }));
    const rivals = initRivals(rng, opts.seed);
    const state: CarState = {
      saveVersion: SAVE_VERSION, seed: opts.seed, rng: rng.getState(), week: 0,
      companyName: opts.companyName?.trim() || NAMES.defaultCompany,
      reputation: config.start.reputation, cash: config.start.cash,
      loan: { balance: 0, limitMult: 1, bailoutUsed: false }, negMonths: 0, status: 'playing',
      staff, projects: [], nameplates: [], rivals, ledger: [], pendingDev: 0, nextId: staff.length + 1, history: [],
    };
    return new Game(state);
  }

  // ---------- 1주 진행 ----------
  tick(): GameEvent[] {
    const s = this.state, ev: GameEvent[] = [];
    if (s.status !== 'playing') return ev;
    for (const p of [...s.projects].sort((a, b) => a.id - b.id)) {
      const phase = p.phase, log = stepProject(s, p, this.rng);
      const made = log.staff.reduce((a, x) => a + STATS.reduce((b, k) => b + x.stats[k], 0), 0);
      ev.push({
        kind: 'devWeek', id: p.id, projectId: p.id, staff: log.staff, defectsAdded: log.defectsAdded, defectsRemoved: log.defectsRemoved,
        text: phase === 'design' ? `「${p.name}」 설계 ${p.weeksDone}주차: 점수 +${made.toFixed(1)}, 결함 +${log.defectsAdded.toFixed(1)}` : `「${p.name}」 시험 ${p.testWeeks}주차: 결함 −${log.defectsRemoved.toFixed(1)}`,
      });
      if (log.designDone) ev.push({ kind: 'designDone', id: p.id, text: `「${p.name}」 설계가 끝났습니다. 시험을 시작합니다.` });
    }
    if (isMonthEnd(s.week)) this.monthEnd(ev);
    if (s.status === 'playing') {
      s.week++;
      if (isYearStart(s.week)) {
        const y = yearOf(s.week);
        for (const x of [...BODIES, ...POWERTRAINS, ...OPTIONS]) if (x.year === y) ev.push({ kind: 'unlock', text: `${y}년: 「${x.name}」을(를) 쓸 수 있게 되었습니다.` });
      }
    }
    s.rng = this.rng.getState();
    return ev;
  }

  private addRep(d: number): void { this.state.reputation = Math.min(config.reputation.max, Math.max(config.reputation.min, this.state.reputation + d)); }

  /** 월말 정산: 판매·인지도·리콜·재무·장부·파산 */
  private monthEnd(ev: GameEvent[]): void {
    const s = this.state, m = monthOf(s.week), year = yearOf(s.week), wpm = config.time.weeksPerMonth, LC = config.lifecycle;
    updateRivals(s.rivals, s.seed, m); // 경쟁 차가 낡거나 새 모델로 바뀐다
    const gens = sellingGens(s), cars = gens.map((g) => toSaleCar(g, m));
    const demand = gens.map((g, i) => {
      let d = monthlyDemand(s, cars[i], cars.filter((_, j) => j !== i), monthTime(m));
      if (g.rebuy > 0 && m - g.launchMonth < LC.fullChange.rebuyMonths) d += g.rebuy; // 기존 고객 재구매(풀체인지 첫 12개월)
      if (g.launchMonth === m) d *= (m * wpm + wpm - g.launchWeek) / wpm; // 출시 달은 판매한 주만큼
      const ed = currentEdition(g);
      if (ed.kind === 'facelift' && monthOf(ed.launchWeek) === m) d *= LC.facelift.switchMonthMult; // 페이스리프트 전환 달 생산 −30%
      if (g.status === 'ending') d *= config.discontinue.lastMonthMult; // 단종 달: 재고 처분
      return d;
    });
    const total = demand.reduce((a, b) => a + b, 0);
    const fill = total > config.factory.capacity ? config.factory.capacity / total : 1; // 생산 상한을 수요 비례로 나눈다
    let revenue = 0, cogs = 0, marketing = 0, recall = 0, sold = 0;
    gens.forEach((g, i) => {
      const ed = currentEdition(g), n = Math.round(demand[i] * fill), uc = unitCost(g.body, g.powertrain, ed.tier, ed.options);
      const mk = config.awareness.marketingCost[g.marketing];
      g.lastDemand = demand[i];
      g.sales.push(n); g.totalSold += n; sold += n;
      revenue += n * ed.price; cogs += n * uc; marketing += mk;
      g.profit += n * (ed.price - uc) - mk;
      const target = awarenessTarget(s.reputation, g.marketing, grade(ed.stats.Q, year));
      g.awareness += (target - g.awareness) * config.awareness.rate;
      if (ed.defects > 0) { // 6.3 리콜: 연 확률 min(40%, 결함 × 2%)을 달로 나눠 굴린다
        const pYear = Math.min(config.recall.maxYear, ed.defects * config.recall.perDefect);
        if (this.rng.next() < 1 - (1 - pYear) ** (1 / config.time.monthsPerYear)) {
          const cost = g.totalSold * config.recall.costPerCar;
          recall += cost; g.profit -= cost; g.recalls++;
          g.awareness *= config.recall.awarenessMult; ed.defects = 0; // 전량 수리했으므로 결함은 없어진다
          this.addRep(config.recall.rep);
          ev.push({ kind: 'recall', id: g.id, text: `「${this.nameOf(g)}」 리콜! 수리비 ${Math.round(cost).toLocaleString()}만원, 평판 ${config.recall.rep}.` });
        }
      }
      const dc = config.discontinue, last = g.sales.slice(-dc.adviceMonths); // 8.6: 월 10대 미만이 6개월째가 된 달에 한 번 조언
      if (g.status === 'onSale' && last.length === dc.adviceMonths && last.every((x) => x < dc.adviceSales) && !(g.sales.length > dc.adviceMonths && g.sales[g.sales.length - dc.adviceMonths - 1] < dc.adviceSales))
        ev.push({ kind: 'advice', id: g.id, text: `「${this.nameOf(g)}」 판매가 ${dc.adviceMonths}개월째 월 ${dc.adviceSales}대 미만입니다. 단종을 권합니다.` });
      if (g.status === 'ending') { g.status = 'discontinued'; ev.push({ kind: 'discontinued', id: g.id, text: `「${this.nameOf(g)}」 생산을 마쳤습니다. 다음 달부터 생산 라인이 빕니다.` }); }
    });
    const salaries = s.staff.reduce((a, x) => a + salaryOf(x.ability), 0);
    const upkeep = config.factory.upkeep + config.hq.upkeep, dev = s.pendingDev, interest = s.loan.balance * loanRate(s);
    const profit = revenue - cogs - salaries - upkeep - dev - marketing - interest - recall;
    s.cash += profit; s.pendingDev = 0;
    const e: LedgerEntry = { month: m, year, monthOfYear: (m % config.time.monthsPerYear) + 1, revenue, cogs, salaries, upkeep, dev, marketing, interest, recall, profit, cash: s.cash, sold };
    s.ledger.push(e);
    if (s.ledger.length > config.ledgerMonths) s.ledger.splice(0, s.ledger.length - config.ledgerMonths);
    ev.push({ kind: 'monthEnd', text: `${monthLabel(m)} 결산: 판매 ${sold}대, 이익 ${Math.round(profit).toLocaleString()}만원` });
    // 9.4 파산: 현금 음수로 6개월 연속이면 게임 오버
    if (s.cash < 0) {
      s.negMonths++;
      if (s.negMonths >= config.bankruptcy.months) { s.status = 'gameOver'; ev.push({ kind: 'gameOver', text: `현금 부족이 ${config.bankruptcy.months}개월 이어져 회사가 파산했습니다.` }); }
      else ev.push({ kind: 'cashWarning', text: `현금이 ${s.negMonths}개월째 마이너스입니다. ${config.bankruptcy.months}개월이 되면 파산합니다.` });
    } else s.negMonths = 0;
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
        const err = this.teamError() ?? specError(s, cmd) ?? seedError(cmd.chassisSeed) ?? seedError(cmd.faceSeed) ?? this.staffError();
        if (err) return fail(err);
        this.addProject('new', null, { ...cmd, name: cmd.name?.trim() || `${NAMES.cars[s.nameplates.length % NAMES.cars.length]}` },
          cmd.chassisSeed ?? lookCandidates(s, 0, 'chassis')[0], cmd.faceSeed ?? lookCandidates(s, 0, 'face')[0]);
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
        const err = this.teamError() ?? specError(s, { ...spec, designWeeks: d.designWeeks[0] }) ?? (tier < ed.tier ? '동력 단계는 낮출 수 없습니다(같은 종류의 최신 단계로만 바꿀 수 있습니다).' : null)
          ?? seedError(cmd.faceSeed) ?? this.staffError();
        if (err) return fail(err);
        const p = this.addProject('facelift', g.id, spec, g.chassisSeed, cmd.faceSeed ?? lookCandidates(s, n.id, 'face', 'facelift')[0]);
        p.defects = ed.defects * config.lifecycle.facelift.defectKeep; // 남은 결함 × 0.5로 시작
        return OK;
      }
      case 'startFullChange': { // 8.3
        const el = fullChangeEligibility(s, cmd.nameplateId);
        if (!el.ok) return fail(el.reason!);
        const n = nameplateById(s, cmd.nameplateId)!;
        const spec: ProjectSpec = { name: n.name, body: cmd.body, segment: cmd.segment, powertrain: cmd.powertrain, tier: cmd.tier, options: cmd.options, direction: cmd.direction, budget: cmd.budget, designWeeks: cmd.designWeeks };
        const err = this.teamError() ?? specError(s, spec) ?? seedError(cmd.chassisSeed) ?? seedError(cmd.faceSeed) ?? this.staffError();
        if (err) return fail(err);
        this.addProject('fullchange', n.id, spec, cmd.chassisSeed ?? lookCandidates(s, n.id, 'chassis')[0], cmd.faceSeed ?? lookCandidates(s, n.id, 'face', 'nextGen')[0]);
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
        if (s.loan.bailoutUsed) return fail('구제 금융은 한 번만 받을 수 있습니다.');
        if (s.cash >= 0) return fail('현금이 마이너스일 때만 받을 수 있습니다.');
        s.cash = 0; s.negMonths = 0; s.loan.bailoutUsed = true; s.loan.limitMult *= config.loan.bailoutLimitMult;
        this.addRep(config.bankruptcy.bailoutRep);
        if (s.status === 'gameOver') { s.status = 'playing'; s.week++; } // 파산한 주는 월말 정산까지 끝났으므로 다음 주부터 이어 간다
        return OK;
      }
      default: return fail('알 수 없는 명령입니다.');
    }
  }

  private teamError(): string | null { return this.state.projects.length >= config.dev.teams ? '개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.' : null; }
  private staffError(): string | null { return this.state.staff.some((x) => x.projectId === null) ? null : '배치할 직원이 없습니다.'; }
  /** 프로젝트를 만들고 쉬는 직원을 모두 배치한다(검증은 호출하는 쪽에서) */
  private addProject(kind: ProjectKind, targetId: number | null, spec: ProjectSpec, chassisSeed: number, faceSeed: number): Project {
    const s = this.state, id = s.nextId++;
    const p: Project = {
      id, startWeek: s.week, kind, targetId, chassisSeed, faceSeed, name: spec.name,
      body: spec.body, segment: spec.segment, powertrain: spec.powertrain, tier: spec.tier, options: [...spec.options],
      direction: { ...spec.direction }, budget: spec.budget, designWeeks: spec.designWeeks,
      phase: 'design', weeksDone: 0, testWeeks: 0, points: zeroStats(), defects: 0, defectEst: 0, spent: 0,
    };
    s.projects.push(p);
    for (const x of s.staff) if (x.projectId === null) x.projectId = id;
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
    if (!inherits && sellingGens(s).length >= config.factory.lines) return fail('생산 라인이 없습니다. 기존 차를 단종하세요.');
    const base = bodyById(p.body).basePrice, bad = priceError(p.body, cmd.price) ?? marketingError(cmd.marketing);
    if (bad) return fail(bad);
    if (cmd.wheels !== 0 && cmd.wheels !== 1 && cmd.wheels !== 2) return fail('바퀴 모양은 0~2 중에서 고르세요.');
    if (typeof cmd.color !== 'string') return fail('색상을 고르세요.');
    const year = yearOf(s.week), month = monthOf(s.week), events: GameEvent[] = [];
    const edition = (stats: Stats, kind: Edition['kind'], headline: string | null): Edition =>
      ({ id: s.nextId++, kind, launchWeek: s.week, tier: p.tier, options: [...p.options], stats, defects: p.defects, price: cmd.price, color: cmd.color, wheels: cmd.wheels, faceSeed: p.faceSeed, headline });

    if (liftGen) { // 8.2 페이스리프트: 새 판, 평론 재평가 없음
      const fl = config.lifecycle.facelift, g = liftGen;
      const stats = finalStats(g.body, g.powertrain, p.tier, p.options, g.points, p.defects);
      stats.D += Math.min(bodyById(g.body).mult.D * p.points.D, fl.dCap * g.editions[0].stats.D); // 디자이너 점수(상한: 원래 D의 +15%)
      const age = month - g.lifeMonth, late = month - g.launchMonth >= fl.lateMonths;
      g.lifeMonth = month - age * (late ? fl.lateLifeKeep : fl.lifeKeep); // 수명 나이를 40%로(늦으면 70%로)
      g.awareness = Math.min(1, g.awareness + fl.awareness);
      g.marketing = cmd.marketing; g.devCost += p.spent;
      const text = `「${p.name}」 ${g.number}세대 페이스리프트 출시: 새 얼굴로 돌아왔다${late ? '(다소 늦은 변경)' : ''}`;
      g.editions.push(edition(stats, 'facelift', text));
      events.push({ kind: 'news', id: g.id, text });
    } else {
      const stats = finalStats(p.body, p.powertrain, p.tier, p.options, p.points, p.defects);
      const reviews = criticScores(stats, year, base, cmd.price, p.defects, () => this.rng.range(-1, 1)), c = config.critics, fc = config.lifecycle.fullChange;
      let headline: string | null = null, equity = 0, rebuy = 0;
      if (np && prev) { // 8.3 풀체인지: 전작 비교·차종 자산·재구매, 전 세대는 이번 달 말 단종
        const carried = carriedEquity(s, np.id, p.body), prevAvg = launchAvgGrade(prev), nowAvg = avgGrade(stats, year), no = prev.number + 1;
        const delta = nowAvg < prevAvg ? fc.worseReview : nowAvg > prevAvg ? fc.betterReview : 0;
        for (let i = 0; i < reviews.length; i++) reviews[i] = Math.round(Math.min(c.max, Math.max(c.min, reviews[i] + delta)) * 10) / 10;
        headline = `「${np.name}」 ${no}세대${carried.revival ? '로 부활!' : ','} ${delta < 0 ? '전작만 못하다' : delta > 0 ? '진화했다' : '전작과 비슷하다'}`;
        equity = carried.equity; rebuy = rebuyPerMonth(prev);
        if (prev.status === 'onSale') { prev.status = 'ending'; prev.endMonth = month; }
        events.push({ kind: 'news', id: prev.id, text: headline });
      }
      const avg = mean(reviews);
      if (avg >= c.masterpiece) this.addRep(c.masterpieceRep); else if (avg <= c.flop) this.addRep(c.flopRep);
      const gen: Generation = {
        id: s.nextId++, number: prev ? prev.number + 1 : 1, body: p.body, segment: p.segment, powertrain: p.powertrain,
        launchWeek: s.week, launchMonth: month, lifeMonth: month, chassisSeed: p.chassisSeed, points: { ...p.points }, equity, rebuy,
        marketing: cmd.marketing, awareness: Math.min(1, awarenessStart(s.reputation, avg) + equity),
        status: 'onSale', endMonth: null, editions: [],
        reviews, reviewAvg: avg, masterpiece: avg >= c.masterpiece, sales: [], totalSold: 0, lastDemand: 0, devCost: p.spent, profit: 0, recalls: 0,
      };
      gen.editions.push(edition(stats, 'initial', headline));
      if (np) np.generations.push(gen); else s.nameplates.push({ id: s.nextId++, name: p.name, generations: [gen] });
    }
    // 9.1 최소 구현(3단계 전 임시): 프로젝트를 마친 직원 능력 +1~2(상한 60), 직원 ID 순
    const sg = config.staffGrowth;
    for (const x of s.staff.filter((y) => y.projectId === p.id).sort((a, b) => a.id - b.id))
      x.ability = Math.max(x.ability, Math.min(sg.cap, x.ability + this.rng.intIn(sg.min, sg.max)));
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
  st.saveVersion = 2;
}
