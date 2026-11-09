import * as THREE from 'three';
import type { Pt } from '../sim/network';
import { toThree } from './coords';

const MAX_ROUTE = 600, MAX_FLOW = 120;

/**
 * 차량 정보·이동 흐름용 덧그림: (1) 선택한 차량의 남은 경로(파란 선), 출발·도착 건물 표시(초록·빨강 기둥),
 * (2) 선택한 도로를 지나는 차량들의 출발지 → 목적지 선(주황)
 */
export function createOverlay(scene: THREE.Scene) {
  const mk = (n: number, color: number) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setDrawRange(0, 0);
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
    l.frustumCulled = false; l.renderOrder = 5;
    scene.add(l);
    return l;
  };
  const route = mk(MAX_ROUTE * 2, 0x2f6fe0), flows = mk(MAX_FLOW * 2, 0xf08a3c);
  const post = (color: number) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 40, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthTest: false })); m.visible = false; m.renderOrder = 5; scene.add(m); return m; };
  const from = post(0x2fbf5a), to = post(0xe0443c);

  const fill = (l: THREE.LineSegments, segs: [Pt, Pt][], z: number, max: number) => {
    const a = l.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(segs.length, max);
    for (let i = 0; i < n; i++) {
      const p = toThree(segs[i][0].x, segs[i][0].y, z), q = toThree(segs[i][1].x, segs[i][1].y, z);
      a.setXYZ(i * 2, p.x, p.y, p.z); a.setXYZ(i * 2 + 1, q.x, q.y, q.z);
    }
    a.needsUpdate = true;
    l.geometry.setDrawRange(0, n * 2);
  };
  const put = (m: THREE.Mesh, p: Pt | null) => { m.visible = !!p; if (p) { const t = toThree(p.x, p.y, 20); m.position.set(t.x, t.y, t.z); } };

  return {
    /** 경로 점 목록(없으면 지운다)과 출발·도착 위치 */
    setRoute(pts: Pt[] | null, origin: Pt | null, dest: Pt | null) {
      fill(route, pts ? pts.slice(1).map((q, i): [Pt, Pt] => [pts[i], q]) : [], 0.9, MAX_ROUTE);
      put(from, pts ? origin : null); put(to, pts ? dest : null);
    },
    /** 출발지 → 목적지 선들(없으면 지운다) */
    setFlows(lines: [Pt, Pt][] | null) { fill(flows, lines ?? [], 1.2, MAX_FLOW); },
  };
}
export type Overlay = ReturnType<typeof createOverlay>;
