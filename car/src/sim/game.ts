// 카 컴퍼니 게임 본체: 상태, 1주 진행(tick), 명령(command), 저장(toJSON/fromJSON)
import { config } from '../config';
import { BODIES, NAMES, OPTIONS, POWERTRAINS, bodyById } from '../data';
import { finalStats, grade, salaryOf, unitCost, zeroStats } from './cars';
import { specError, stepProject } from './dev';
import { loanLimit, loanRate } from './finance';
import { awarenessStart, awarenessTarget, currentEdition, monthlyDemand, toSaleCar, initRivals } from './market';
import { criticScores, mean } from './reviews';
import { Rng } from './rng';
import { dateLabel, isMonthEnd, isYearStart, monthLabel, monthOf, yearOf } from './time';
import type { CarState, Command, CommandResult, GameEvent, Generation, LedgerEntry, Project } from './types';

export const SAVE_VERSION = 1;
export interface GameOptions { seed: number; companyName?: string }

const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
const priceError = (body: string, price: number): string | null => {
  const base = bodyById(body).basePrice;
  return !Number.isFinite(price) || price < base * config.price.min - 1e-6 || price > base * config.price.max + 1e-6
    ? `가격은 기준가(${base.toLocaleString()}만원)의 ${config.price.min}~${config.price.max}배 사이여야 합니다.` : null;
};
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
    const rivals = initRivals(rng);
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
    for (const p of [...s.projects].sort((a, b) => a.id - b.id))
      if (stepProject(s, p, this.rng)) ev.push({ kind: 'designDone', id: p.id, text: `「${p.name}」 설계가 끝났습니다. 시험을 시작합니다.` });
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
    const s = this.state, m = monthOf(s.week), year = yearOf(s.week), wpm = config.time.weeksPerMonth;
    const gens = sellingGens(s), cars = gens.map((g) => toSaleCar(g, m));
    const demand = gens.map((g, i) => {
      let d = monthlyDemand(s, cars[i], cars.filter((_, j) => j !== i), year);
      if (g.launchMonth === m) d *= (m * wpm + wpm - g.launchWeek) / wpm; // 출시 달은 판매한 주만큼
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
    if (s.status !== 'playing') return fail('게임이 끝났습니다.');
    switch (cmd?.type) {
      case 'startProject': {
        if (s.projects.length >= config.dev.teams) return fail('개발팀이 모두 바쁩니다. 진행 중인 개발을 끝내거나 취소하세요.');
        const err = specError(s, cmd);
        if (err) return fail(err);
        const free = s.staff.filter((x) => x.projectId === null);
        if (!free.length) return fail('배치할 직원이 없습니다.');
        const id = s.nextId++;
        const p: Project = {
          id, startWeek: s.week, name: cmd.name?.trim() || `${NAMES.cars[s.nameplates.length % NAMES.cars.length]}`,
          body: cmd.body, segment: cmd.segment, powertrain: cmd.powertrain, tier: cmd.tier, options: [...cmd.options],
          direction: { ...cmd.direction }, budget: cmd.budget, designWeeks: cmd.designWeeks,
          phase: 'design', weeksDone: 0, testWeeks: 0, points: zeroStats(), defects: 0, defectEst: 0, spent: 0,
        };
        s.projects.push(p);
        for (const x of free) x.projectId = id;
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
        return OK;
      }
      default: return fail('알 수 없는 명령입니다.');
    }
  }

  private closeProject(p: Project): void {
    const s = this.state;
    for (const x of s.staff) if (x.projectId === p.id) x.projectId = null;
    s.projects = s.projects.filter((x) => x !== p);
  }

  /** 출시(7.1~7.2): 능력치 확정 → 평론 → 평판 → 차종·세대·판 생성 */
  private launch(cmd: Extract<Command, { type: 'launch' }>): CommandResult {
    const s = this.state, p = s.projects.find((x) => x.id === cmd.projectId);
    if (!p) return fail('없는 개발 프로젝트입니다.');
    if (p.phase !== 'test' || p.testWeeks < config.dev.minTestWeeks) return fail(`시험을 최소 ${config.dev.minTestWeeks}주 해야 출시할 수 있습니다.`);
    if (sellingGens(s).length >= config.factory.lines) return fail('생산 라인이 없습니다. 기존 차를 단종하세요.');
    const base = bodyById(p.body).basePrice, bad = priceError(p.body, cmd.price) ?? marketingError(cmd.marketing);
    if (bad) return fail(bad);
    if (cmd.wheels !== 0 && cmd.wheels !== 1 && cmd.wheels !== 2) return fail('바퀴 모양은 0~2 중에서 고르세요.');
    if (typeof cmd.color !== 'string') return fail('색상을 고르세요.');
    const year = yearOf(s.week), month = monthOf(s.week);
    const stats = finalStats(p.body, p.powertrain, p.tier, p.options, p.points, p.defects);
    const reviews = criticScores(stats, year, base, cmd.price, p.defects, () => this.rng.range(-1, 1));
    const avg = mean(reviews), c = config.critics;
    if (avg >= c.masterpiece) this.addRep(c.masterpieceRep); else if (avg <= c.flop) this.addRep(c.flopRep);
    const gen: Generation = {
      id: s.nextId++, number: 1, body: p.body, segment: p.segment, powertrain: p.powertrain,
      launchWeek: s.week, launchMonth: month, marketing: cmd.marketing, awareness: awarenessStart(s.reputation, avg),
      status: 'onSale', endMonth: null,
      editions: [{ id: s.nextId++, kind: 'initial', launchWeek: s.week, tier: p.tier, options: [...p.options], stats, defects: p.defects, price: cmd.price, color: cmd.color, wheels: cmd.wheels }],
      reviews, reviewAvg: avg, masterpiece: avg >= c.masterpiece, sales: [], totalSold: 0, lastDemand: 0, devCost: p.spent, profit: 0, recalls: 0,
    };
    s.nameplates.push({ id: s.nextId++, name: p.name, generations: [gen] });
    this.closeProject(p);
    return OK;
  }

  // ---------- 저장 ----------
  toJSON(): CarState { return JSON.parse(JSON.stringify(this.state)); }
  static fromJSON(data: unknown): Game {
    const d = data as Partial<CarState> | null;
    if (!d || typeof d !== 'object' || typeof d.saveVersion !== 'number') throw new Error('카 컴퍼니 저장 파일이 아닙니다');
    if (d.saveVersion > SAVE_VERSION) throw new Error('더 새로운 버전에서 저장한 파일입니다');
    if (typeof d.rng !== 'number' || typeof d.week !== 'number' || typeof d.cash !== 'number' || !Array.isArray(d.nameplates) || !Array.isArray(d.projects) || !Array.isArray(d.staff))
      throw new Error('저장 파일이 손상되었습니다');
    return new Game(JSON.parse(JSON.stringify(d)) as CarState);
  }

  /** 화면 표시용 날짜 */
  get dateLabel(): string { return dateLabel(this.state.week); }
}
