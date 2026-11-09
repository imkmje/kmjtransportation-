import { config } from '../config';
import type { Editor } from '../sim/editor';
import { EMPTY_NETWORK } from './sample';

/** 지도 가장자리의 외부 연결점과, 거기서 들어오는 철거 불가 도로 하나. 도시의 시작점이다 */
export function addExternalGate(editor: Editor, roadEndY: number): void {
  const { x, y } = config.external;
  const r = editor.build({ x, y }, { x, y: roadEndY }, 'road4');
  if (!r.ok) throw new Error(`외부 연결 도로 건설 실패(${r.error})`);
  for (const id of r.ids) editor.network.lockSegment(id);
  editor.network.addExternal(x, y);
}

/** 새 도시: 외부에서 들어오는 도로 하나만 있다 */
export function buildStartMap(editor: Editor): void {
  editor.loadData(EMPTY_NETWORK);
  addExternalGate(editor, config.external.roadEndY);
  editor.resetHistory();
}
