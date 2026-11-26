// 할 일 목록(0.7.0): 지금 플레이어가 할 수 있는 일을 한곳에 모은다(순수 함수, 상태를 바꾸지 않는다)
import { config } from '../config';
import { TECHS, optionById } from '../data';
import { sellingGens } from './game';
import { devTeams, isResting, isTraining, isDevRole, staffCap, staffCount } from './company';
import { activeEvents, pendingChoices, regulationBlock } from './events';
import { faceliftEligibility, fullChangeEligibility, latestGen, retrofitInfo } from './lifecycle';
import { currentEdition } from './market';
import { researchError, researchSlots } from './research';
import { diffOf } from './difficulty';
import { monthLabel, yearOf } from './time';
import { equipOf, expectEffect } from './equip';
import { autoLaunching, delegationOn } from './execs';
import { josa } from './josa';
import { faceliftPreview, advice } from './queries';
import type { CarState } from './types';

export type TodoKind = 'choice' | 'ready' | 'cands' | 'cash' | 'regulation' | 'reports' | 'exec' | 'retrofit' | 'capacity' | 'equip' | 'facelift' | 'fullchange' | 'team' | 'research' | 'tired' | 'hire';
/** goto.tab: garage(id = 세대) · dev(sub 'launch' + id = 프로젝트, sub 'plan' = 신차 기획) · company(sub = 회사 안쪽 탭) · choice(id = 선택 사건) · reports(보고함) */
export interface TodoGoto { tab: string; sub?: string; id?: number }
export interface TodoItem { key: string; kind: TodoKind; title: string; detail: string; goto: TodoGoto; urgent: boolean }

/** 임원(E1) 쪽에서 받는 값: 빈 임원 자리 수, 읽지 않은 보고 수와 가장 최근 읽지 않은 보고 ID(키를 바꿔 새 항목으로 보이게) */
export interface TodoExec { vacant: number; unread: number; lastUnread: number }
const NO_EXEC: TodoExec = { vacant: 0, unread: 0, lastUnread: 0 };

const ORDER: TodoKind[] = ['choice', 'ready', 'cands', 'cash', 'regulation', 'reports', 'exec', 'retrofit', 'capacity', 'equip', 'facelift', 'fullchange', 'team', 'research', 'tired', 'hire'];
const nameOfGen = (s: CarState, genId: number) => s.nameplates.find((n) => n.generations.some((g) => g.id === genId))?.name ?? '';

export function todoItems(s: CarState, exec: TodoExec = NO_EXEC): TodoItem[] {
  const out: TodoItem[] = [], T = config.todo, W = config.time.weeksPerMonth;
  const add = (key: string, kind: TodoKind, title: string, detail: string, goto: TodoGoto, urgent = false) => out.push({ key, kind, title, detail, goto, urgent });

  const def = (c: ReturnType<typeof pendingChoices>[number]) => c.choices[c.defaultChoice]?.label ?? '';
  for (const c of pendingChoices(s)) add(`choice:${c.id}`, 'choice', `결정할 사건: ${c.name}`, `${c.weeksLeft}주 안에 고르지 않으면 「${def(c)}」${josa(def(c), '으로/로')} 정해집니다.`, { tab: 'choice', id: c.id }, true);
  for (const p of s.projects) if (p.waiting && !autoLaunching(s, p)) add(`ready:${p.id}`, 'ready', `「${p.name}」 출시 준비가 끝났습니다`, '결함을 다 잡았습니다. 가격을 정해 출시할 수 있습니다.', { tab: 'dev', sub: 'launch', id: p.id }, true);
  if (s.candidates.length) {
    const wk = Math.max(0, Math.min(...s.candidates.map((c) => c.expiresWeek)) - s.week);
    add(`cands:${Math.min(...s.candidates.map((c) => c.id))}`, 'cands', `채용 후보 ${s.candidates.length}명이 기다립니다`, `${wk}주 안에 채용하지 않으면 다른 회사로 갑니다.`, { tab: 'company', sub: 'staff' }, wk <= T.candUrgentWeeks);
  }
  if (s.cash < 0) {
    const max = diffOf(s).bankruptcyMonths;
    add('cash', 'cash', s.negMonths ? `현금이 ${s.negMonths}개월째 마이너스입니다` : '현금이 마이너스입니다', `${max}개월 이어지면 파산합니다. 대출이나 구제 금융, 비용 줄이기를 검토하세요.`, { tab: 'company', sub: 'fin' }, true);
  }
  const blk = regulationBlock(s);
  if (blk) add('regblock', 'regulation', '규제 때문에 새 개발을 시작할 수 없습니다', blk, { tab: 'company', sub: 'research' }, true);
  for (const r of activeEvents(s).regulations) if (r.missingTechs.length) {
    const left = r.enforceWeek - s.week;
    add(`reg:${r.name}`, 'regulation', `${r.name}: ${r.missingTechs.join(', ')} 연구 필요`, `${monthLabel(Math.floor(r.enforceWeek / W))} 시행. 그때까지 연구하지 않으면 새 개발을 시작할 수 없습니다.`, { tab: 'company', sub: 'research' }, left <= T.regUrgentMonths * W);
  }
  if (exec.unread > 0) add(`reports:${exec.lastUnread}`, 'reports', `읽지 않은 임원 보고 ${exec.unread}건`, '임원이 올린 제안과 기록을 볼 수 있습니다.', { tab: 'reports' });
  if (exec.vacant > 0) add('exec', 'exec', `비어 있는 임원 자리 ${exec.vacant}개`, '임원을 두면 매달 제안을 받고 일을 위임할 수 있습니다.', { tab: 'company', sub: 'exec' });

  const freeTeams = blk ? 0 : devTeams(s) - s.projects.filter((p) => !p.elite).length;
  for (const g of sellingGens(s)) {
    if (g.status !== 'onSale') continue;
    const name = nameOfGen(s, g.id), rf = retrofitInfo(s, g.id);
    if (rf.needed) { const list = rf.options.map((o) => optionById(o).name).join('·'); add(`retrofit:${g.id}`, 'retrofit', `「${name}」에 의무 장비 넣기`, `${list}${josa(list, '이/가')} 빠져 있습니다. 판매 중인 차에 바로 넣을 수 있습니다.`, { tab: 'garage', id: g.id }); }
    { const ed = currentEdition(g), fx = expectEffect(equipOf(ed), g.body, yearOf(s.week)); // 1.1.0 장비 기대 미달(옛 구성 판은 면제)
      if (!ed.equipLegacy && fx.missing.length) { const list = fx.missing.map((o) => optionById(o).name).join('·'); add(`equip:${g.id}:${fx.missing.join(',')}`, 'equip', `「${name}」에 기대되는 장비가 없습니다`, `이 차급에서 기대되는 ${list}${josa(list, '이/가')} 빠져 판매가 약 ${Math.round((1 - fx.mult) * 100)}% 줄고 있습니다. 페이스리프트로 넣을 수 있습니다.`, { tab: 'garage', id: g.id }); } }
    if (g.lostSales >= 1) add(`capacity:${g.id}`, 'capacity', `「${name}」 주문이 생산을 넘습니다`, `지난달 주문 ${Math.round(g.lastDemand).toLocaleString()}대 중 ${(g.sales.at(-1) ?? 0).toLocaleString()}대만 만들었습니다. 공장 증설이나 생산 배분을 검토하세요.`, { tab: 'company', sub: 'factory' });
    if (freeTeams > 0 && faceliftEligibility(s, g.id).ok) {
      const fp = faceliftPreview(s, g.id, { options: currentEdition(g).options });
      if (fp && !fp.tooEarly && fp.paybackMonths !== null) add(`facelift:${g.id}`, 'facelift', `「${name}」 페이스리프트 적기`, `비용은 약 ${fp.paybackMonths}개월이면 회수할 것으로 보입니다.`, { tab: 'garage', id: g.id });
    }
  }
  if (freeTeams > 0) for (const n of s.nameplates) {
    if (!n.generations.length) continue;
    const g = latestGen(n);
    if (g.status !== 'onSale' || !fullChangeEligibility(s, n.id).ok) continue;
    const down = advice(g, s).includes('풀체인지');
    add(`full:${n.id}`, 'fullchange', `「${n.name}」 풀체인지 ${down ? '권장' : '가능'}`, down ? '판매가 정점보다 크게 줄었습니다. 다음 세대를 준비할 때입니다.' : `${g.number}세대 출시 뒤 ${config.lifecycle.fullChange.afterMonths}개월이 지나 다음 세대를 만들 수 있습니다.`, { tab: 'garage', id: g.id });
  }
  const idleDev = s.staff.filter((x) => x.projectId === null && !x.lab && isDevRole(x.role)).length;
  if (freeTeams > 0 && idleDev > 0) add('team', 'team', `비어 있는 개발팀 ${freeTeams}개`, `쉬고 있는 개발 직원 ${idleDev}명으로 새 차를 기획할 수 있습니다.`, { tab: 'dev', sub: 'plan' });
  const slotsLeft = researchSlots(s) - s.research.active.length;
  if (slotsLeft > 0 && TECHS.some((t) => researchError(s, t.id) === null)) add('research', 'research', `비어 있는 연구 칸 ${slotsLeft}개`, '지금 시작할 수 있는 기술이 있습니다.', { tab: 'company', sub: 'research' });
  const tired = s.staff.filter((x) => x.condition < config.staff.condition.low && !isResting(x, s.week) && !isTraining(x, s.week)).length;
  if (tired) add('tired', 'tired', `지친 직원 ${tired}명`, '컨디션이 낮아 일의 성과가 줄었습니다. 휴식을 줄 수 있습니다.', { tab: 'company', sub: 'staff' });
  if (!s.candidates.length && staffCount(s) < staffCap(s) && !delegationOn(s, 'hr', 'autoHire')) add('hire', 'hire', `정원에 여유가 있습니다(${staffCount(s)}/${staffCap(s)}명)`, '채용 공고를 낼 수 있습니다.', { tab: 'company', sub: 'staff' });

  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
