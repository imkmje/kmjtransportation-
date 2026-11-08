import * as THREE from 'three';
import { config } from '../config';
import type { Network, Pt, RoadKind } from '../sim/network';
import { toThree } from './coords';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitDisk = new THREE.CylinderGeometry(1, 1, 1, 24);
const roadMat = new THREE.MeshLambertMaterial({ color: 0x585d66 });
const goodMat = new THREE.MeshBasicMaterial({ color: 0x3fae5a, transparent: true, opacity: 0.55, depthWrite: false });
const markMat = new THREE.MeshBasicMaterial({ color: 0x2f6fe0, transparent: true, opacity: 0.8, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: 0xe0443c, transparent: true, opacity: 0.6, depthWrite: false });

const roadWidth = (kind: RoadKind) => config.roads[kind].lanesPerDir * 2 * config.roads[kind].laneWidth;

// 두 점 사이에 가로×세로×높이 상자를 놓는다(상자의 긴 쪽이 두 점 방향)
function place(m: THREE.Mesh, a: Pt, b: Pt, width: number, height: number, bottom: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const c = toThree((a.x + b.x) / 2, (a.y + b.y) / 2, bottom + height / 2);
  m.position.set(c.x, c.y, c.z);
  m.scale.set(len, height, width);
  m.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
}

export function createRoadLayer(scene: THREE.Scene, net: Network) {
  const group = new THREE.Group();
  scene.add(group);
  const ghost = new THREE.Mesh(unitBox, goodMat);
  const hover = new THREE.Mesh(unitBox, badMat);
  const cursor = new THREE.Mesh(unitDisk, goodMat);
  const mark = new THREE.Mesh(unitDisk, markMat);
  for (const m of [ghost, hover, cursor, mark]) { m.visible = false; m.renderOrder = 1; scene.add(m); }
  let shown = -1;

  function rebuild() {
    group.clear();
    const radius = new Map<number, number>();
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const m = new THREE.Mesh(unitBox, roadMat);
      place(m, a, b, roadWidth(s.kind), 0.2, 0);
      group.add(m);
      for (const id of [s.a, s.b]) radius.set(id, Math.max(radius.get(id) ?? 0, roadWidth(s.kind) / 2));
    }
    // 교차로·끝점은 둥근 판으로 덮어 이음새를 가린다(조금 더 높게: 겹침 깜빡임 방지)
    for (const [id, r] of radius) {
      const n = net.nodes.get(id)!;
      const d = new THREE.Mesh(unitDisk, roadMat);
      const c = toThree(n.x, n.y, 0.15);
      d.position.set(c.x, c.y, c.z);
      d.scale.set(r, 0.3, r);
      group.add(d);
    }
  }

  return {
    /** 도로망이 바뀌었으면 다시 그린다. 매 프레임 호출해도 싸다 */
    sync() {
      if (net.revision !== shown) { rebuild(); shown = net.revision; }
    },
    setGhost(a: Pt, b: Pt, kind: RoadKind, valid: boolean) {
      place(ghost, a, b, roadWidth(kind), 0.5, 0);
      ghost.material = valid ? goodMat : badMat;
      ghost.visible = true;
    },
    clearGhost() { ghost.visible = false; },
    setHover(segId: number | null) {
      const s = segId === null ? undefined : net.segments.get(segId);
      hover.visible = !!s;
      if (s) place(hover, net.nodes.get(s.a)!, net.nodes.get(s.b)!, roadWidth(s.kind) + 2, 0.6, 0);
    },
    /** 차량 투입 도구의 출발점 표시(파랑) */
    setMark(p: Pt | null) {
      mark.visible = !!p;
      if (!p) return;
      const c = toThree(p.x, p.y, 0.3);
      mark.position.set(c.x, c.y, c.z);
      mark.scale.set(5, 0.6, 5);
    },
    setCursor(p: Pt | null, valid: boolean) {
      cursor.visible = !!p;
      if (!p) return;
      const c = toThree(p.x, p.y, 0.25);
      cursor.position.set(c.x, c.y, c.z);
      cursor.scale.set(4, 0.5, 4);
      cursor.material = valid ? goodMat : badMat;
    },
  };
}
export type RoadLayer = ReturnType<typeof createRoadLayer>;
