import * as THREE from 'three';
import type { Traffic } from '../sim/traffic';
import { toThree } from './coords';

// 디버그용: 차선 중심선(하늘색)과 교차로 연결선(주황)을 선으로 보여 준다
export function createLaneDebug(scene: THREE.Scene, traffic: Traffic) {
  let lines: THREE.LineSegments | null = null;
  let shown = -1;
  const laneC = new THREE.Color(0x4aa8ff), connC = new THREE.Color(0xff9a2e);

  function rebuild() {
    if (lines) { scene.remove(lines); lines.geometry.dispose(); (lines.material as THREE.Material).dispose(); }
    const pos: number[] = [], col: number[] = [];
    for (const t of traffic.graph.tracks) {
      const c = t.kind === 'lane' ? laneC : connC;
      for (let i = 1; i < t.pts.length; i++) {
        for (const p of [t.pts[i - 1], t.pts[i]]) {
          const q = toThree(p.x, p.y, 0.4);
          pos.push(q.x, q.y, q.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    lines.frustumCulled = false;
    scene.add(lines);
    shown = traffic.graph.revision;
  }

  return {
    update(visible: boolean) {
      if (!visible) { if (lines) lines.visible = false; return; }
      if (shown !== traffic.graph.revision || !lines) rebuild();
      lines!.visible = true;
    },
  };
}
