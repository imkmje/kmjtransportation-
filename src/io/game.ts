import { config } from '../config';
import { Network } from '../sim/network';
import type { Editor } from '../sim/editor';
import type { Sim } from '../sim/sim';

/** 저장 파일 형식 번호. 3: 전체 상태(도로망 + 건물 + 시뮬레이션) / 4: 구역·외부 연결·건물 성장 상태 추가(형식 3 파일도 열리고, 구역은 비어 있다). 도로망만 있는 옛 파일(형식 1·2·3)도 열린다 */
export const GAME_FORMAT_VERSION = 4;

/** 도로망 + 건물 + 시뮬레이션 전체 상태를 글자 하나로 */
export function exportGame(editor: Editor, sim: Sim): string {
  return JSON.stringify({ formatVersion: GAME_FORMAT_VERSION, kind: 'game', savedAt: new Date().toISOString(), network: editor.network.toJSON(), sim: sim.getState() });
}

/** 저장 파일을 열어 도로망과 시뮬레이션을 복원한다. 도로망만 있는 옛 파일이면 시뮬레이션은 처음부터. 문제가 있으면 쉬운 한국어 메시지로 Error */
export function importGame(text: string, editor: Editor, sim: Sim): 'game' | 'network' {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('저장 파일이 아닙니다'); }
  const o = raw as { kind?: string; formatVersion?: number; network?: unknown; sim?: ReturnType<Sim['getState']> } | null;
  if (o && o.kind === 'game') {
    if (typeof o.formatVersion !== 'number' || o.formatVersion > GAME_FORMAT_VERSION) throw new Error('더 새로운 버전에서 저장한 파일입니다');
    if (!o.sim || typeof o.sim.tickCount !== 'number' || !o.sim.traffic || !o.sim.demand || !o.sim.metrics) throw new Error('저장 파일이 손상되었습니다');
    const net = Network.parse(o.network, config); // 문제가 있으면 여기서 Error
    editor.loadData(net);
    sim.setState(o.sim);
    return 'game';
  }
  editor.loadText(text); // 도로망만 있는 파일(옛 형식 포함)
  sim.reset();
  return 'network';
}
