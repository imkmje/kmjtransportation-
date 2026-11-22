// 1.3.0 개발 중 직원 성과: 배치된 직원이 가끔 내는 항상 긍정적인 성과(고르기 없이 자동 적용, 다른 곳에서 상쇄하지 않음).
// 확률·크기는 그 직원 능력에 비례, 프로젝트당 횟수와 종류별 합계에 상한. 게임 난수를 쓰지 않고 시드 해시로 정한다(기존 난수 순서를 바꾸지 않는다)
import { config } from '../config';
import { STAFF_WINS } from '../data';
import { isAway } from './company';
import { addNews } from './events';
import { ensureHist } from './history';
import { josa } from './josa';
import { hash01 } from './rng';
import { STATS, type CarState, type GameEvent, type Generation, type Project, type Staff, type StaffWin, type Stat, type Stats, type WinKind } from './types';

const W = config.staffWins;
const group = (k: WinKind): keyof typeof W.caps | 'defects' => (k.startsWith('stat:') ? 'stat' : (k as 'defects' | 'time' | 'cost' | 'acclaim'));
const used = (p: Project, g: string): number => (p.wins ?? []).filter((w) => group(w.kind) === g).reduce((a, w) => a + w.value, 0);
const lerp = ([a, b]: number[], f: number) => a + (b - a) * f;
const pctText = (v: number) => String(Math.round(v * 1000) / 10);

/** 이번 주 성과 굴리기. team: 이번 주 이 프로젝트에서 일한 직원(진행 전 배치), phase: 진행 전 단계. 긴급 개선(fix)은 없다 */
export function rollWins(s: CarState, p: Project, team: Staff[], phase: Project['phase'], ev: GameEvent[]): void {
  if (p.kind === 'fix') return;
  for (const x of [...team].sort((a, b) => a.id - b.id)) {
    if ((p.wins?.length ?? 0) >= W.maxPerProject) return;
    if (isAway(x, s.week) || x.role === 'sales' || hash01(s.seed, 73, p.id, s.week, x.id) >= W.chance * x.ability) continue;
    const ok = (k: WinKind): boolean => {
      const g = group(k);
      if (g === 'time') return phase === 'design' && p.phase === 'design' && p.weeksDone > 0 && p.weeksDone + 1 < p.designWeeks && used(p, g) < W.caps.time;
      if (g === 'defects') return p.defects >= 1;
      return used(p, g) < W.caps[g] - 1e-9;
    };
    const kinds = (STAFF_WINS.roles[x.role] as WinKind[]).filter(ok);
    if (!kinds.length) continue;
    const k = kinds[Math.floor(hash01(s.seed, 74, p.id, s.week, x.id) * kinds.length)], g = group(k), f = x.ability / 100;
    let value: number;
    if (g === 'time') { // 한 주 앞당김: 지금까지의 주 평균 점수를 한 주 치 더한다(결함은 늘지 않는다)
      value = 1;
      for (const st of STATS) p.points[st] += p.points[st] / p.weeksDone;
      p.weeksDone++;
    } else if (g === 'defects') {
      value = Math.max(1, Math.min(Math.floor(p.defects), Math.round(lerp(W.size.defects, f))));
      p.defects = Math.max(0, p.defects - value); p.defectEst = Math.max(0, Math.round(p.defectEst - value));
    } else value = Math.round(Math.min(lerp(W.size[g], f), W.caps[g] - used(p, g)) * 10000) / 10000;
    const text = STAFF_WINS.text[k].replace('{who}', `${x.name}${josa(x.name, '이/가')}`).replace('{v}', g === 'time' || g === 'defects' ? String(value) : pctText(value));
    const win: StaffWin = { week: s.week, staffId: x.id, name: x.name, role: x.role, kind: k, value, text };
    (p.wins ??= []).push(win);
    (ensureHist(x, s.week).wins ??= []).push({ ...win, project: p.name });
    addNews(s, ev, `「${p.name}」 개발: ${text}`, 'other', 'news', p.id, 'dev');
  }
}

/** 출시 때 성과 반영: 능력치 배수(바꾼 값을 돌려준다) */
export function winStats(st: Stats, wins: StaffWin[] | undefined): Stats {
  for (const w of wins ?? []) if (w.kind.startsWith('stat:')) st[w.kind.slice(5) as Stat] *= 1 + w.value;
  return st;
}
/** 출시 때 성과 반영: 세대의 원가 인하(합계 costCutMax)·인지도 가산, 기록 */
export function applyWinsToGen(g: Generation, wins: StaffWin[] | undefined): void {
  if (!wins?.length) return;
  const cut = wins.filter((w) => w.kind === 'cost').reduce((a, w) => a + w.value, 0), aw = wins.filter((w) => w.kind === 'acclaim').reduce((a, w) => a + w.value, 0);
  if (cut) g.costCut = Math.min(W.costCutMax, (g.costCut ?? 0) + cut);
  if (aw) g.awareness = Math.min(1, g.awareness + aw);
  (g.wins ??= []).push(...wins);
}
