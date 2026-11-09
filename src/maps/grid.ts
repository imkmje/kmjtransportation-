import { config } from '../config';
import type { Editor } from '../sim/editor';
import { addExternalGate } from './start';
import { EMPTY_NETWORK } from './sample';

/**
 * 격자 도시: 큰길(왕복 4차로) 세 줄과 세로 길(왕복 2차로) 다섯 줄이 만나는 도시. 북쪽에서 외부 연결 도로가 들어온다.
 * 중앙 교차로는 감응식, 큰길의 두 교차로는 고정식(녹색파로 맞춤) 신호등이고, 한 곳은 회전교차로다.
 * 구역(주거 저·중·고밀, 상업, 사무, 산업)이 칠해져 있어 시간이 지나면 건물이 자란다. 학교 두 채가 놓여 있다.
 * 새 도시와 달리 처음부터 도로·신호·구역이 갖춰져 있어 신호 효과와 병목 찾기를 바로 시험할 수 있다.
 */
export function buildGridMap(editor: Editor): void {
  editor.loadData(EMPTY_NETWORK);
  const road = (x1: number, y1: number, x2: number, y2: number, kind: 'road2' | 'road4') => {
    const r = editor.build({ x: x1, y: y1 }, { x: x2, y: y2 }, kind);
    if (!r.ok) throw new Error(`격자 도시 도로 건설 실패(${r.error}): ${x1},${y1} → ${x2},${y2}`);
  };
  for (const y of [-300, 0, 300]) road(-520, y, 520, y, 'road4');
  for (const x of [-400, -200, 0, 200, 400]) road(x, -500, x, 500, 'road2');
  addExternalGate(editor, -500);
  const net = editor.network, node = (x: number, y: number) => [...net.nodes.values()].find((n) => Math.abs(n.x - x) < 1 && Math.abs(n.y - y) < 1)!.id;
  // 신호: 중앙은 감응식, 큰길의 양옆 교차로는 고정식 + 녹색파
  net.setSignal(node(0, 0), true, 'actuated');
  for (const x of [-200, 200]) net.setSignal(node(x, 0), true, 'fixed', 20);
  // 회전교차로: 아래쪽 큰길과 가운데 세로 길
  const r = net.makeRoundabout(node(0, 300));
  if (!r.ok) throw new Error(`격자 도시 회전교차로 실패(${r.error})`);
  // 구역: 큰길(y=-300, 0, 300) 양쪽 20·40m 칸. 서쪽부터 주거 저밀 → 중밀 → 상업 → 사무 → 산업 순
  const c = config.zones.cell;
  const bands: [number, number, 'home' | 'homeMid' | 'homeHigh' | 'shop' | 'office' | 'industrial'][] = [
    [-26, -21, 'home'], [-19, -11, 'homeMid'], [-9, -1, 'homeHigh'], [1, 9, 'shop'], [11, 19, 'office'], [21, 26, 'industrial'],
  ];
  for (const y of [-300, 0, 300]) for (const [i0, i1, type] of bands) {
    const j = Math.round(y / c);
    net.paintZone(i0, j - 2, i1, j - 1, type);
    net.paintZone(i0, j + 1, i1, j + 2, type);
  }
  // 학교 두 채(직접 놓는 건물)
  for (const [x, y] of [[-100, -260], [300, 260]]) editor.addBuilding('school', 'medium', x, y, 'player', true);
  editor.resetHistory();
}
