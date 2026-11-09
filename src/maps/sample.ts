import type { Editor } from '../sim/editor';
import { addExternalGate } from './start';
import type { BuildingKind, BuildingSize, NetworkData } from '../sim/network';

/** 비어 있는 도로망(새로 시작하거나 샘플 맵을 열기 전에) */
export const EMPTY_NETWORK: NetworkData = { formatVersion: 6, nextNodeId: 1, nextSegmentId: 1, nodes: [], segments: [], nextBuildingId: 1, buildings: [], zones: [] };

type B = [BuildingKind, BuildingSize, number, number];
// 큰길 양쪽(y=±40)에 서쪽은 주거, 동쪽은 직장. 작은 길 옆에도 몇 채 두어 정지 표지 쪽 흐름도 생기게 한다
const HOME_SIZES: BuildingSize[] = ['large', 'medium', 'large', 'small', 'medium', 'medium', 'medium', 'small', 'small', 'medium'];
const OFFICE_SIZES: BuildingSize[] = ['large', 'large', 'medium', 'medium', 'large', 'large', 'medium', 'medium', 'large', 'medium'];
const HOME_X = [-390, -330, -190, -130, -70];
const OFFICE_X = [70, 130, 190, 290, 350];
const BUILDINGS: B[] = [
  ...HOME_X.flatMap((x, i): B[] => [['home', HOME_SIZES[i * 2], x, 40], ['home', HOME_SIZES[i * 2 + 1], x, -40]]),
  ...OFFICE_X.flatMap((x, i): B[] => [['office', OFFICE_SIZES[i * 2], x, 40], ['office', OFFICE_SIZES[i * 2 + 1], x, -40]]),
  ['home', 'medium', -290, 160], ['home', 'small', -100, -160], ['office', 'medium', 290, 160],
  ['shop', 'medium', -100, 160], ['shop', 'small', 100, -160], ['shop', 'medium', 150, 160], // 점심·쇼핑·여가 이동의 목적지
];

/**
 * 샘플 맵: 큰길(동서, 왕복 4차로) 하나와 가로 2개·세로 3개의 작은 길(왕복 2차로)이 만나는 격자 도시.
 * 큰길과 만나는 세로 길의 접근로 6곳에 정지 표지. 서쪽·남쪽에 주거, 동쪽에 직장.
 * 도로·건물·표지를 Editor를 통해 놓으므로 실제 건설과 같은 규칙(기하 제약 등)을 거친다.
 */
export function buildSampleMap(editor: Editor): void {
  editor.loadData(EMPTY_NETWORK);
  const road = (x1: number, y1: number, x2: number, y2: number, kind: 'road2' | 'road4') => {
    const r = editor.build({ x: x1, y: y1 }, { x: x2, y: y2 }, kind);
    if (!r.ok) throw new Error(`샘플 맵 도로 건설 실패(${r.error}): ${x1},${y1} → ${x2},${y2}`);
  };
  road(-420, 0, 420, 0, 'road4'); // 큰길
  for (const x of [-240, 0, 240]) road(x, -300, x, 300, 'road2'); // 세로 길
  for (const y of [-200, 200]) road(-420, y, 420, y, 'road2'); // 가로 길
  // 큰길 교차로로 들어오는 세로 길 접근로에 정지 표지
  const net = editor.network;
  for (const x of [-240, 0, 240]) {
    const node = [...net.nodes.values()].find((n) => n.x === x && n.y === 0)!;
    for (const seg of net.segmentsAt(node.id)) {
      const other = net.nodes.get(seg.a === node.id ? seg.b : seg.a)!;
      if (other.x === x) editor.setSign(seg.id, node.id, 'stop'); // 세로 길 쪽(큰길이 아닌 쪽)
    }
  }
  addExternalGate(editor, -300); // 외부 연결 도로: 가운데 세로 길의 북쪽 끝으로 이어진다
  for (const [kind, size, x, y] of BUILDINGS) {
    const r = editor.addBuilding(kind, size, x, y, 'map', true);
    if (!r.ok) throw new Error(`샘플 맵 건물 배치 실패(${r.error}): ${kind} ${x},${y}`);
  }
  editor.resetHistory(); // 샘플을 만든 과정이 취소 기록에 남지 않게
}
