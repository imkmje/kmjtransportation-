// 4.1.0 직속 전담팀(설계서 9.10): 본사 3등급부터 정원과 따로 두는 플레이어 전용 최정예 팀. 개발팀 수와 별개인 한 팀이고,
// 임원 위임·세대교체 위임·자회사·봇의 자동 처리는 이 팀원을 쓰지 않는다. 전용 후보는 시드 해시(게임 난수를 쓰지 않는다)라 전담팀을 쓰지 않은 판의 결과는 그대로다.
// 수치는 config.elite
import { config } from '../config';
import { COMPAT, NAMES } from '../data';
import { salaryOf } from './cars';
import { isAway, repEffect, staffCount, staffCap, staffTrainCost, trainCap, trainError } from './company';
import { startHist } from './history';
import { josa } from './josa';
import { Rng, hash32 } from './rng';
import { monthOf } from './time';
import { won } from './won';
import type { CarState, CommandResult, EliteState, GameEvent, ProjectSpec, Role, Staff } from './types';

const E = config.elite;
const fail = (reason: string): CommandResult => ({ ok: false, reason });
const OK: CommandResult = { ok: true };
const DEV_ROLES: Role[] = ['designer', 'engineer', 'tester'];
const ROLE_KO: Record<Role, string> = { designer: '디자이너', engineer: '엔지니어', tester: '테스터', sales: '영업' };

export const eliteOpen = (s: CarState): boolean => s.hqLevel >= E.hq;
export const eliteSeats = (s: CarState): number => E.seats[s.hqLevel - 1] ?? 0;
export const eliteMembers = (s: CarState): Staff[] => s.staff.filter((x) => x.elite).sort((a, b) => a.id - b.id);
export const eliteState = (s: CarState): EliteState => (s.elite ??= { train: true, chem: 0, crew: [], taken: [], cars: 0 });
/** 전담팀 개발이 진행 중인가(전담팀 자리는 한 팀) */
export const eliteBusy = (s: CarState): boolean => s.projects.some((p) => p.elite);
const lockedWhy = (s: CarState): string | null => (eliteOpen(s) ? null : `직속 전담팀은 본사 ${E.hq}등급(${config.hq.levels[E.hq - 1].name})부터 둘 수 있습니다.`);

/** 기획 궁합(0~1): 차체·고객층 궁합(1 이상이면 1)^compatExp × 동력 등급(최신 연구 단계 = 3등급이면 1). 전담팀 가산에만 곱한다(팀 때문에 깎이는 일은 없다) */
export const eliteFit = (spec: Pick<ProjectSpec, 'body' | 'segment' | 'tier'>): number =>
  Math.min(1, COMPAT[spec.body]?.[spec.segment] ?? 1) ** E.compatExp * (E.tierFit[spec.tier - 1] ?? 1);
/** 전담팀원의 산출 배수(1 이상) */
export const eliteMult = (s: CarState, spec: Pick<ProjectSpec, 'body' | 'segment' | 'tier'>): number => 1 + (E.out + (s.elite?.chem ?? 0)) * eliteFit(spec);
/** 직원별 산출 배수 함수(전담팀원만 배수, 나머지 1). 전담팀원이 없으면 undefined(계산이 예전과 같다) */
export function boostOf(s: CarState, spec: Pick<ProjectSpec, 'body' | 'segment' | 'tier'>, team: Staff[]): ((x: Staff) => number) | undefined {
  if (!team.some((x) => x.elite)) return undefined;
  const m = eliteMult(s, spec);
  return (x) => (x.elite ? m : 1);
}

// ---------- 전용 후보 ----------
export interface EliteCand { key: string; name: string; role: Role; ability: number; potential: number; pay: number; fee: number; monthsLeft: number }
const periodOf = (s: CarState): number => Math.floor(monthOf(s.week) / E.cand.refreshMonths);
/** 이번 주기의 전용 후보(데려간 사람 제외). 이름은 지금 직원·후보와 겹치지 않게 */
export function eliteCands(s: CarState): EliteCand[] {
  if (!eliteOpen(s)) return [];
  const per = periodOf(s), rng = new Rng(hash32(s.seed, 4101, per)), bonus = Math.floor(repEffect(s.reputation) / E.cand.repDiv);
  const used = new Set([...s.staff, ...s.candidates, ...(s.former ?? []).map((f) => f.staff)].map((x) => x.name)), out: EliteCand[] = [];
  const left = (per + 1) * E.cand.refreshMonths - monthOf(s.week);
  for (let i = 0; i < E.cand.count; i++) {
    let name = '';
    for (let k = 0; k < 20 && (!name || used.has(name)); k++) name = NAMES.family[rng.intIn(0, NAMES.family.length - 1)] + NAMES.given[rng.intIn(0, NAMES.given.length - 1)];
    used.add(name);
    const ability = Math.min(E.cand.maxAbility, rng.intIn(E.cand.abilityMin, E.cand.abilityMax) + bonus), potential = Math.min(100, ability + rng.intIn(E.cand.potMin, E.cand.potMax));
    const role = DEV_ROLES[(per + i) % DEV_ROLES.length], key = `${per}:${i}`;
    if (s.elite?.taken.includes(key)) continue;
    out.push({ key, name, role, ability, potential, pay: Math.round(salaryOf(ability) * E.payMult), fee: eliteFee(), monthsLeft: left });
  }
  return out;
}
export const eliteFee = (): number => Math.round(config.staff.hire.postCost[2] * E.feeMult);

/** 빈 자리가 없으면 이유 */
const seatError = (s: CarState): string | null => (eliteMembers(s).length >= eliteSeats(s) ? `전담팀 자리(${eliteSeats(s)}명)가 찼습니다.${s.hqLevel < E.seats.length ? ' 본사 등급을 올리면 자리가 늘어납니다.' : ''}` : null);
/** 이 직원을 전담팀으로 옮길 수 없는 이유 */
export function moveInError(s: CarState, x: Staff): string | null {
  return lockedWhy(s) ?? (x.elite ? '이미 전담팀원입니다.' : null) ?? (x.role === 'sales' ? '영업 직원은 전담팀에 넣을 수 없습니다(개발 직무만).' : null)
    ?? (x.projectId !== null ? '개발 중인 직원은 개발이 끝난 뒤에 옮길 수 있습니다.' : null) ?? (x.lab ? '전담 연구원은 먼저 연구소에서 빼세요.' : null) ?? seatError(s);
}
export function moveOutError(s: CarState, x: Staff): string | null {
  return (!x.elite ? '전담팀원이 아닙니다.' : null) ?? (x.projectId !== null ? '개발 중인 팀원은 개발이 끝난 뒤에 뺄 수 있습니다.' : null)
    ?? (staffCount(s) >= staffCap(s) ? `일반 직원 정원(${staffCap(s)}명)이 찼습니다. 빼려면 정원에 빈자리가 있어야 합니다.` : null);
}

/** 전담팀 명령(아니면 null) */
export function eliteCommand(c: { s: CarState; spend(cost: number): void }, cmd: { type: string; key?: string; staffId?: number; on?: boolean }): CommandResult | null {
  const s = c.s;
  switch (cmd.type) {
    case 'hireElite': {
      const err = lockedWhy(s) ?? seatError(s); if (err) return fail(err);
      const cd = eliteCands(s).find((x) => x.key === cmd.key); if (!cd) return fail('없는 후보입니다. 후보는 주기마다 바뀝니다.');
      if (s.cash < cd.fee) return fail(`영입비 ${won(cd.fee)}${josa(won(cd.fee), '이/가')} 모자랍니다.`);
      c.spend(cd.fee);
      const st = eliteState(s);
      st.taken = [...st.taken.filter((k) => k.startsWith(`${periodOf(s)}:`)), cd.key];
      s.staff.push(startHist({ id: s.nextId++, name: cd.name, role: cd.role, ability: cd.ability, potential: cd.potential, condition: 1, projectId: null, trainings: [], restUntil: null, lab: false, elite: true }, s.week));
      return OK;
    }
    case 'setElite': {
      const x = s.staff.find((y) => y.id === cmd.staffId); if (!x) return fail('없는 직원입니다.');
      const err = cmd.on ? moveInError(s, x) : moveOutError(s, x); if (err) return fail(err);
      eliteState(s);
      if (cmd.on) x.elite = true; else delete x.elite;
      return OK;
    }
    case 'setEliteTrain': eliteState(s).train = !!cmd.on; return OK;
    default: return null;
  }
}

/** 매주(직원 컨디션 갱신 전): 자동 교육. 개발에 들어가 있지 않고 자리를 비우지 않은 전담팀원을 교육 한계까지(현금이 운영비 cashMonths개월 치 이상 남을 때). 전담팀원이 있는 판만 난수를 쓴다 */
export function eliteWeek(s: CarState, rng: Rng, spend: (cost: number) => void, fixed: () => number, ev: GameEvent[]): void {
  if (!s.elite?.train) return;
  for (const x of eliteMembers(s)) {
    if (x.projectId !== null || isAway(x, s.week) || trainError(s, x)) continue;
    const cost = staffTrainCost(x);
    if (s.cash - cost < fixed() * E.train.cashMonths) break;
    spend(cost);
    const a0 = x.ability;
    x.ability = Math.min(trainCap(x), x.ability + rng.intIn(E.train.gainMin, E.train.gainMax)); // 성장 한계는 그대로(교육 한계 = 성장 한계 + capAdd)
    x.trainings.push(s.week);
    ev.push({ kind: 'company', id: x.id, topic: 'training', text: `전담팀 ${x.name} 자동 교육(${a0} → ${x.ability}, 교육비 ${won(cost)}).` });
  }
}

/** 출시 때: 전담팀원이 들어간 차면 팀 호흡을 갱신한다(같은 구성이면 +step, 바뀌면 겹치는 비율만 남기고 +step) */
export function eliteLaunched(s: CarState, crew: Staff[]): void {
  const ids = crew.filter((x) => x.elite).map((x) => x.id).sort((a, b) => a - b);
  if (!ids.length) return;
  const st = eliteState(s), prev = new Set(st.crew), union = new Set([...st.crew, ...ids]);
  const keep = union.size ? ids.filter((id) => prev.has(id)).length / union.size : 0;
  st.chem = Math.min(E.chem.max, st.chem * keep + E.chem.step); st.crew = ids; st.cars++;
}
/** 지금 전담팀원과 마지막 완성 구성이 같은 비율(0~1, 화면 안내) */
export const chemKeep = (s: CarState): number => {
  const st = s.elite, now = eliteMembers(s).map((x) => x.id);
  if (!st?.crew.length) return 1;
  const prev = new Set(st.crew), union = new Set([...st.crew, ...now]);
  return now.filter((id) => prev.has(id)).length / union.size;
};

/** 화면용: 자리·팀원·호흡·자동 교육·후보·빠진 직무 */
export function eliteInfo(s: CarState) {
  const members = eliteMembers(s), have = new Set(members.map((x) => x.role));
  return {
    open: eliteOpen(s), locked: lockedWhy(s), seats: eliteSeats(s), used: members.length, members: members.map((x) => x.id), busy: eliteBusy(s),
    chem: s.elite?.chem ?? 0, chemMax: E.chem.max, keep: chemKeep(s), cars: s.elite?.cars ?? 0, train: s.elite?.train ?? true,
    missing: DEV_ROLES.filter((r) => !have.has(r)).map((r) => ROLE_KO[r]), cands: eliteCands(s), fee: eliteFee(), payMult: E.payMult,
    nextSeatHq: E.seats.findIndex((n, i) => i >= s.hqLevel && n > eliteSeats(s)) + 1 || null,
  };
}
