import * as THREE from 'three';
import { config } from '../config';
import type { Network, Pt, RoadKind } from '../sim/network';
import { toThree } from './coords';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitDisk = new THREE.CylinderGeometry(1, 1, 1, 24);
const octagon = new THREE.CylinderGeometry(1, 1, 0.12, 8);
const triangle = new THREE.CylinderGeometry(1, 1, 0.12, 3);
const poleGeo = new THREE.BoxGeometry(0.18, 2.4, 0.18);
const poleMat = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });
const redMat = new THREE.MeshLambertMaterial({ color: 0xd63a31 });
const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf6f6f6 });
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

// 속도 제한 표지판: 하얀 원에 빨간 테두리, 가운데 숫자. 같은 숫자는 한 번만 만든다
const limitMats = new Map<number, THREE.SpriteMaterial>();
function limitMaterial(kmh: number): THREE.SpriteMaterial {
  let m = limitMats.get(kmh);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d63a31'; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1d2630'; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(kmh), 64, 68);
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false });
    limitMats.set(kmh, m);
  }
  return m;
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
    // 정지·양보 표지: 교차로로 들어오는 방향의 오른쪽 길가, 노드에서 조금 떨어진 곳에 세운다
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (const [kind, node, dir] of [[s.signB, b, 1], [s.signA, a, -1]] as const) {
        if (!kind) continue;
        const hw = roadWidth(s.kind) / 2;
        // 들어오는 진행 방향(노드를 향함) = dir*(ux,uy). 오른쪽 = (uy, -ux) 방향
        const tx = dir * ux, ty = dir * uy;
        const x = node.x - tx * (hw + 3) + ty * (hw + 1.2), y = node.y - ty * (hw + 3) - tx * (hw + 1.2);
        const g = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.2;
        g.add(pole);
        const head = new THREE.Group();
        head.position.y = 2.7;
        head.rotation.x = Math.PI / 2; // 원판이 진행 방향 쪽을 향하게 눕힌다
        if (kind === 'stop') {
          const m = new THREE.Mesh(octagon, redMat);
          m.scale.set(0.95, 1, 0.95);
          m.rotation.y = Math.PI / 8;
          head.add(m);
        } else {
          const outer = new THREE.Mesh(triangle, redMat);
          outer.scale.set(1.15, 1, 1.15);
          outer.rotation.y = 0; // 꼭짓점이 아래로(양보 표지)
          const inner = new THREE.Mesh(triangle, whiteMat);
          inner.scale.set(0.72, 1.4, 0.72);
          inner.rotation.y = 0;
          head.add(outer, inner);
        }
        g.add(head);
        const p = toThree(x, y, 0);
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = Math.atan2(-tx, ty); // 표지 앞면이 달려오는 차량 쪽(-진행방향)을 향한다
        group.add(g);
      }
    }
    // 속도를 바꾼 도로: 도로 가운데 위에 제한속도 표지판
    for (const s of net.segments.values()) {
      if (s.playerSpeedKmh === null) continue;
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const sp = new THREE.Sprite(limitMaterial(s.playerSpeedKmh));
      const p = toThree((a.x + b.x) / 2, (a.y + b.y) / 2, 7);
      sp.position.set(p.x, p.y, p.z);
      sp.scale.set(9, 9, 1);
      group.add(sp);
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
