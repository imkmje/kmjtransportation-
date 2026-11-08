import { describe, it, expect } from 'vitest';
import { Network } from '../src/sim/network';
import { Editor } from '../src/sim/editor';
import { config } from '../src/config';

const make = () => new Network(config);
const line = (n: Network, x1: number, y1: number, x2: number, y2: number, kind: 'road2' | 'road4' = 'road2') =>
  n.buildRoad({ x: x1, y: y1 }, { x: x2, y: y2 }, kind);
const err = (n: Network, x1: number, y1: number, x2: number, y2: number) => {
  const r = line(n, x1, y1, x2, y2);
  return r.ok ? 'ok' : r.error;
};

describe('도로 건설 기본', () => {
  it('직선 도로 1개 = 노드 2개, 도로 1개', () => {
    const n = make();
    const r = line(n, 0, 0, 100, 0);
    expect(r).toMatchObject({ ok: true, length: 100 });
    expect(n.nodes.size).toBe(2);
    expect(n.segments.size).toBe(1);
  });
  it('왕복 4차로도 건설되고 종류가 저장된다', () => {
    const n = make();
    line(n, 0, 0, 100, 0, 'road4');
    expect([...n.segments.values()][0].kind).toBe('road4');
  });
  it('같은 자리, 20m 미만은 거부, 정확히 20m는 허용', () => {
    expect(err(make(), 0, 0, 0, 0)).toBe('samePoint');
    expect(err(make(), 0, 0, 19, 0)).toBe('tooShort');
    expect(err(make(), 0, 0, 20, 0)).toBe('ok');
  });
});

describe('교차와 연결', () => {
  it('십자로 교차: 가운데 노드가 생기고 기존 도로가 둘로 나뉜다', () => {
    const n = make();
    line(n, -100, 0, 100, 0);
    line(n, 0, -100, 0, 100);
    expect(n.nodes.size).toBe(5);
    expect(n.segments.size).toBe(4);
    const center = [...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!;
    expect(n.segmentsAt(center.id).length).toBe(4);
  });
  it('T자 연결: 기존 도로 중간에서 끝나면 그 도로가 나뉜다', () => {
    const n = make();
    line(n, -100, 0, 100, 0);
    line(n, 0, -100, 0, 0);
    expect(n.nodes.size).toBe(4);
    expect(n.segments.size).toBe(3);
  });
  it('나뉜 도로는 원래 종류를 유지한다', () => {
    const n = make();
    line(n, -100, 0, 100, 0, 'road4');
    line(n, 0, -100, 0, 100, 'road2');
    const kinds = [...n.segments.values()].map((s) => s.kind).sort();
    expect(kinds).toEqual(['road2', 'road2', 'road4', 'road4']);
  });
  it('8m 안의 기존 노드에는 새 노드를 만들지 않고 합쳐진다', () => {
    const n = make();
    line(n, 0, 0, 100, 0);
    line(n, 3, 4, 0, 100); // (3,4)는 (0,0)에서 5m
    expect(n.nodes.size).toBe(3);
    expect(n.segmentsAt([...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id).length).toBe(2);
  });
  it('양쪽 끝이 기존 노드면 그 둘을 잇는다', () => {
    const n = make();
    line(n, 0, 0, 100, 0);
    line(n, 100, 0, 100, 100);
    line(n, 0, 0, 100, 100);
    expect(n.nodes.size).toBe(3);
    expect(n.segments.size).toBe(3);
  });
});

describe('기하 제약', () => {
  it('교차 각도 30° 미만은 거부, 45°는 허용, 정확히 30°도 허용', () => {
    const a = make();
    line(a, 0, 0, 200, 0);
    expect(err(a, 50, -20, 150, 20)).toBe('angle'); // 약 21.8°
    const b = make();
    line(b, 0, 0, 200, 0);
    expect(err(b, 50, -50, 150, 50)).toBe('ok'); // 45°
    const c = make();
    line(c, 0, 0, 200, 0);
    expect(err(c, 100 - 50 * Math.sqrt(3), -50, 100 + 50 * Math.sqrt(3), 50)).toBe('ok'); // 30°
  });
  it('같은 노드에서 같은 방향으로 겹치는 도로는 거부', () => {
    const n = make();
    line(n, 0, 0, 100, 0);
    expect(err(n, 0, 0, 200, 0)).toBe('nodeTooClose'); // 새 도로 위에 기존 끝점(100,0)이 올라탐
    expect(err(n, 0, 0, 100, 0)).toBe('angle'); // 같은 두 점을 또 잇기
    expect(err(n, 0, 0, 150, 1)).toBe('nodeTooClose'); // 거의 같은 방향도 마찬가지
  });
  it('기존 도로 위에 겹쳐 놓는 도로는 거부', () => {
    const n = make();
    line(n, 0, 0, 200, 0);
    expect(err(n, 50, 0, 150, 0)).toBe('angle');
    expect(err(n, -100, 0, 100, 0)).toBe('nodeTooClose');
  });
  it('기존 노드에서 8m 안을 스치는 도로는 거부, 멀면 허용', () => {
    const n = make();
    line(n, 0, 0, 100, 0);
    line(n, 100, 0, 100, 100);
    expect(err(n, 50, 6, 150, 6)).toBe('nodeTooClose'); // (100,0)에서 6m
    expect(err(n, 50, 40, 150, 40)).toBe('ok'); // (100,0)에서 40m, 수직 도로와 정상 교차
  });
  it('교차점이 기존 도로 끝점에서 20m 미만이면 거부(노드와는 8m 이상이어도)', () => {
    const n = make();
    line(n, 0, 0, 100, 0);
    expect(err(n, 90, -50, 90, 50)).toBe('tooShort'); // 끝점 (100,0)까지 10m
  });
  it('분할로 20m 미만 조각이 생기면 거부', () => {
    const n = make();
    line(n, 0, 0, 100, 0);
    expect(err(n, 15, -50, 15, 50)).toBe('tooShort'); // 시작점(0,0)에서 15m
  });
  it('교차로당 도로는 최대 6개', () => {
    const n = make();
    for (const deg of [0, 30, 60, 90, 120, 150]) {
      const r = (deg * Math.PI) / 180;
      expect(line(n, 0, 0, 100 * Math.cos(r), 100 * Math.sin(r)).ok).toBe(true);
    }
    const r7 = (190 * Math.PI) / 180;
    expect(err(n, 0, 0, 100 * Math.cos(r7), 100 * Math.sin(r7))).toBe('tooManyRoads');
  });
  it('planRoad는 도로망을 바꾸지 않는다(미리보기용)', () => {
    const n = make();
    line(n, -100, 0, 100, 0);
    const rev = n.revision;
    const plan = n.planRoad({ x: 0, y: -100 }, { x: 0, y: 100 }, 'road2');
    expect(plan.ok).toBe(true);
    expect(n.revision).toBe(rev);
    expect(n.segments.size).toBe(1);
  });
});

describe('철거', () => {
  it('끝에 있던 노드는 사라지고, 다른 도로와 이어진 노드는 남는다', () => {
    const n = make();
    line(n, -100, 0, 100, 0);
    line(n, 0, -100, 0, 100); // 4개 도로
    const first = [...n.segments.values()][0]; // 왼쪽 끝~중심
    expect(n.removeSegment(first.id)).toBe(true);
    expect(n.segments.size).toBe(3);
    expect(n.nodes.size).toBe(4); // 왼쪽 끝 노드만 사라짐
    expect(n.removeSegment(9999)).toBe(false);
  });
  it('마지막 도로를 지우면 노드도 모두 사라진다', () => {
    const n = make();
    const r = line(n, 0, 0, 100, 0);
    if (r.ok) n.removeSegment(r.ids[0]);
    expect(n.nodes.size).toBe(0);
  });
});

describe('저장·불러오기', () => {
  it('저장했다 불러오면 같은 도로망', () => {
    const a = make();
    line(a, -100, 0, 100, 0);
    line(a, 0, -100, 0, 100, 'road4');
    const b = make();
    b.load(Network.parse(JSON.parse(JSON.stringify(a.toJSON())), config));
    expect(b.toJSON()).toEqual(a.toJSON());
    // 불러온 뒤 이어서 건설해도 ID가 겹치지 않는다
    const r = line(b, 100, 100, 100, 200);
    expect(r.ok).toBe(true);
    expect(new Set([...b.segments.keys()]).size).toBe(b.segments.size);
  });
  it('같은 입력이면 같은 결과(결정론)', () => {
    const run = () => {
      const n = make();
      line(n, -100, 0, 100, 0);
      line(n, 0, -100, 0, 100);
      line(n, 50, 50, 200, 200);
      return JSON.stringify(n.toJSON());
    };
    expect(run()).toBe(run());
  });
  it('잘못된 파일은 쉬운 메시지로 거부', () => {
    expect(() => Network.parse(null, config)).toThrow('도로망 파일이 아닙니다');
    expect(() => Network.parse({ formatVersion: 3, nodes: [], segments: [] }, config)).toThrow('더 새로운');
    expect(() => Network.parse({ formatVersion: 1, nodes: [], segments: [{ id: 1, a: 1, b: 2, kind: 'road2' }] }, config)).toThrow('손상');
    expect(() => Network.parse({ formatVersion: 1, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 9, y: 0, z: 0 }], segments: [{ id: 1, a: 1, b: 2, kind: 'ufo' }] }, config)).toThrow('손상');
  });
});

describe('실행 취소/다시 실행', () => {
  it('건설 → 취소 → 다시 실행', () => {
    const e = new Editor(config);
    expect(e.canUndo).toBe(false);
    e.build({ x: 0, y: 0 }, { x: 100, y: 0 }, 'road2');
    e.build({ x: 100, y: 0 }, { x: 100, y: 100 }, 'road2');
    expect(e.network.segments.size).toBe(2);
    expect(e.undo()).toBe(true);
    expect(e.network.segments.size).toBe(1);
    expect(e.undo()).toBe(true);
    expect(e.network.segments.size).toBe(0);
    expect(e.undo()).toBe(false);
    expect(e.redo()).toBe(true);
    expect(e.redo()).toBe(true);
    expect(e.network.segments.size).toBe(2);
    expect(e.redo()).toBe(false);
  });
  it('취소 후 새로 건설하면 다시 실행 기록은 사라진다', () => {
    const e = new Editor(config);
    e.build({ x: 0, y: 0 }, { x: 100, y: 0 }, 'road2');
    e.undo();
    e.build({ x: 0, y: 0 }, { x: 0, y: 100 }, 'road2');
    expect(e.canRedo).toBe(false);
  });
  it('실패한 건설과 철거는 기록에 남지 않는다', () => {
    const e = new Editor(config);
    e.build({ x: 0, y: 0 }, { x: 5, y: 0 }, 'road2'); // 너무 짧음
    expect(e.canUndo).toBe(false);
    expect(e.demolish(123)).toBe(false);
    expect(e.canUndo).toBe(false);
  });
  it('철거도 취소할 수 있다. 불러오기도 취소할 수 있다', () => {
    const e = new Editor(config);
    const r = e.build({ x: 0, y: 0 }, { x: 100, y: 0 }, 'road2');
    const saved = e.exportText();
    if (r.ok) e.demolish(r.ids[0]);
    expect(e.network.segments.size).toBe(0);
    e.undo();
    expect(e.network.segments.size).toBe(1);
    e.demolish([...e.network.segments.keys()][0]);
    e.loadText(saved);
    expect(e.network.segments.size).toBe(1);
    e.undo();
    expect(e.network.segments.size).toBe(0);
    expect(() => e.loadText('이건 JSON이 아님')).toThrow('도로망 파일이 아닙니다');
  });
  it('기록 개수 제한을 넘으면 오래된 것부터 버린다', () => {
    const e = new Editor({ ...config, editor: { ...config.editor, historyLimit: 3 } });
    for (let i = 0; i < 6; i++) e.build({ x: i * 100, y: 0 }, { x: i * 100 + 50, y: 0 }, 'road2');
    let undos = 0;
    while (e.undo()) undos++;
    expect(undos).toBe(2); // 보관 3개 → 취소 2번
  });
});

describe('정지·양보 표지와 저장 형식 2', () => {
  const cross = () => { const n = make(); line(n, -100, 0, 100, 0); line(n, 0, -100, 0, 100); return n; };
  const center = (n: Network) => [...n.nodes.values()].find((p) => p.x === 0 && p.y === 0)!.id;

  it('교차로로 들어오는 방향에만 표지를 놓을 수 있다', () => {
    const n = cross();
    const c = center(n);
    const seg = n.segmentsAt(c)[0];
    expect(n.setSign(seg.id, c, 'stop')).toEqual({ ok: true });
    expect(n.signAt(seg.id, c)).toBe('stop');
    const end = [...n.nodes.values()].find((p) => p.x === -100)!.id; // 막다른 끝
    const other = [...n.segments.values()].find((s) => s.a !== end && s.b !== end)!; // 그 끝점을 갖지 않은 도로
    expect(n.setSign(other.id, end, 'stop')).toEqual({ ok: false, error: 'noSuchEnd' });
    const endSeg = n.segmentsAt(end)[0];
    expect(n.setSign(endSeg.id, end, 'yield')).toEqual({ ok: false, error: 'notIntersection' });
    expect(n.setSign(seg.id, c, null)).toEqual({ ok: true });
    expect(n.signAt(seg.id, c)).toBe(null);
  });
  it('표지가 있는 도로를 나누면 표지는 원래 끝에 남는다', () => {
    const n = make();
    line(n, -200, 0, 200, 0); line(n, 0, -100, 0, 0); // T자: 가로 도로가 가운데에서 나뉨
    const c = center(n);
    const east = [...n.segments.values()].find((s) => n.nodes.get(s.b)!.x === 200)!;
    expect(n.setSign(east.id, c, 'yield').ok).toBe(true); // 중심으로 들어오는 동쪽 조각의 a쪽 끝이 아님 → a쪽(중심)
    line(n, 100, -100, 100, 100); // 동쪽 조각을 한 번 더 가른다
    const pieces = [...n.segments.values()].filter((s) => n.nodes.get(s.a)!.x >= 0 && s.kind && n.nodes.get(s.a)!.y === 0);
    expect(pieces.filter((s) => s.signA === 'yield').length).toBe(1); // 표지는 중심 쪽 끝에 그대로
    expect(pieces.filter((s) => s.signB === 'yield').length).toBe(0);
  });
  it('저장했다 불러와도 표지가 남는다. 되돌리기도 된다', () => {
    const e = new Editor(config);
    e.build({ x: -100, y: 0 }, { x: 100, y: 0 }, 'road2');
    e.build({ x: 0, y: -100 }, { x: 0, y: 100 }, 'road2');
    const c = center(e.network);
    const seg = e.network.segmentsAt(c)[0];
    expect(e.setSign(seg.id, c, 'stop').ok).toBe(true);
    const text = e.exportText();
    const e2 = new Editor(config);
    e2.loadText(text);
    expect(e2.network.signAt(seg.id, c)).toBe('stop');
    e.undo();
    expect(e.network.signAt(seg.id, c)).toBe(null);
  });
  it('형식 1(표지 필드 없음) 파일도 열린다', () => {
    const v1 = { formatVersion: 1, nextNodeId: 3, nextSegmentId: 2,
      nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 100, y: 0, z: 0 }],
      segments: [{ id: 1, a: 1, b: 2, kind: 'road2', structure: 'ground', playerSpeedKmh: null }] };
    const d = Network.parse(v1, config);
    expect(d.formatVersion).toBe(2);
    expect(d.segments[0]).toMatchObject({ signA: null, signB: null });
    const e = new Editor(config);
    e.loadText(JSON.stringify(v1));
    expect(e.network.segments.size).toBe(1);
  });
  it('잘못된 표지 값은 거부', () => {
    const bad = { formatVersion: 2, nodes: [{ id: 1, x: 0, y: 0, z: 0 }, { id: 2, x: 50, y: 0, z: 0 }], segments: [{ id: 1, a: 1, b: 2, kind: 'road2', signA: 'ufo', signB: null }] };
    expect(() => Network.parse(bad, config)).toThrow('손상');
  });
});
