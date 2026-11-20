// 테스트 공용 도우미(테스트 파일이 아니라 직접 실행되지 않는다)
import { config } from '../src/config';
import { Game, allGens } from '../src/sim/game';
import { TECHS, techById } from '../src/data';
import type { Generation, ProjectSpec } from '../src/sim/types';

/** 테스트용: 기술을 연구 완료로 표시(선행 기술 포함, 이미 한 것은 건너뜀). ids를 빼면 반복 기술을 뺀 전부 */
export function grant(g: Game, ...ids: string[]): void {
  const add = (id: string) => { if (g.state.research.done.includes(id)) return; for (const q of techById(id).pre) add(q); g.state.research.done.push(id); };
  for (const id of ids.length ? ids : TECHS.filter((t) => !t.repeatable).map((t) => t.id)) add(id);
}

export const SPEC: ProjectSpec = { name: '테스트카', body: 'sedanS', segment: 'worker', powertrain: 'gasoline', tier: 2, options: [], direction: { P: 2, E: 2, U: 2, D: 2, Q: 2 }, budget: 'normal', designWeeks: config.dev.designWeeks[1] };

export function ok(r: { ok: boolean; reason?: string }): void { if (!r.ok) throw new Error(r.reason); }

/** 개발을 시작해 시험 testWeeks주까지 진행한 게임 */
export function devReady(seed = 1, testWeeks = 2, spec: Partial<ProjectSpec> = {}): { g: Game; pid: number } {
  const g = Game.create({ difficulty: 'normal', seed });
  ok(g.command({ type: 'startProject', ...SPEC, ...spec }));
  const pid = g.state.projects[0].id;
  while (!g.state.projects[0].waiting && (g.state.projects[0].phase === 'design' || g.state.projects[0].testWeeks < testWeeks)) g.tick(); // 결함을 다 잡으면 출시 대기(시험 주가 더 늘지 않는다)
  return { g, pid };
}

/** 첫 차를 출시한 게임 */
export function launched(seed = 1, price = 1200, marketing = 1, testWeeks = 2): { g: Game; gen: Generation } {
  const { g, pid } = devReady(seed, testWeeks);
  ok(g.command({ type: 'launch', projectId: pid, price, marketing, color: 'red', wheels: 0 }));
  return { g, gen: allGens(g.state)[0] };
}

/** 다음 월말 정산까지 진행 */
export function toMonthEnd(g: Game): void { do g.tick(); while (g.state.week % 4 !== 0); }
