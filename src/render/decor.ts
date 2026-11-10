import * as THREE from 'three';
import { config } from '../config';
import type { Network } from '../sim/network';
import { isWater } from '../sim/terrain';
import { toThree } from './coords';

/**
 * 나무 같은 소품(보기 전용). 위치는 격자 칸 번호에서 정해지는 고정된 난수(해시)라 항상 같은 숲이 나오고,
 * 도로·건물·칠해 둔 구역·물을 피한다. 도로나 건물이 바뀌면 다시 계산한다(너무 자주 하지 않도록 0.4초 간격)
 */
const hash = (i: number, j: number, k = 0): number => {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function createDecorLayer(scene: THREE.Scene, net: Network) {
  const MAX = 2600, CELL = 22;
  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 2.4, 4).translate(0, 1.2, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1, 0).scale(2.3, 2.1, 2.3).translate(0, 4.4, 0);
  const pineGeo = new THREE.ConeGeometry(1.7, 6.2, 5).translate(0, 5.0, 0);
  const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x7a5a3c }), MAX);
  const round = new THREE.InstancedMesh(roundGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX);
  const pine = new THREE.InstancedMesh(pineGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), MAX);
  for (const m of [trunk, round, pine]) { m.frustumCulled = false; m.castShadow = true; m.receiveShadow = false; m.count = 0; scene.add(m); }
  const GREENS = [0x6bbf5f, 0x5fae5a, 0x7ccb6c, 0x4f9d55].map((c) => new THREE.Color(c));
  const PINES = [0x3f8a5a, 0x367c52, 0x4b9564].map((c) => new THREE.Color(c));
  const d = new THREE.Object3D();
  let key = '', dirty = 0, last = 0;

  function rebuild() {
    const half = config.buildings.worldHalf - 40, T = net.terrain;
    // 도로 구간을 100m 칸에 나눠 담아 가까운 것만 비교한다
    const B = 100, bucket = new Map<number, { ax: number; ay: number; bx: number; by: number; w: number }[]>();
    const bk = (i: number, j: number) => i * 4096 + j;
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!, r = config.roads[s.kind], w = r.lanesPerDir * r.laneWidth + 9;
      const x0 = Math.floor((Math.min(a.x, b.x) - w) / B), x1 = Math.floor((Math.max(a.x, b.x) + w) / B), y0 = Math.floor((Math.min(a.y, b.y) - w) / B), y1 = Math.floor((Math.max(a.y, b.y) + w) / B);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) { const k = bk(i, j); (bucket.get(k) ?? bucket.set(k, []).get(k)!).push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, w }); }
    }
    const nearRoad = (x: number, y: number) => {
      for (const s of bucket.get(bk(Math.floor(x / B), Math.floor(y / B))) ?? []) {
        const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1, u = Math.min(1, Math.max(0, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
        if (Math.hypot(x - (s.ax + dx * u), y - (s.ay + dy * u)) < s.w) return true;
      }
      return false;
    };
    const zoned = new Set(net.zoneList().map((z) => `${z.i},${z.j}`));
    const bl = [...net.buildings.values()].map((b) => ({ x: b.x, y: b.y, r: config.buildings.footprint[b.size] + 7 }));
    let n = 0, nr = 0, np = 0;
    const lo = Math.floor(-half / CELL), hi = Math.floor(half / CELL);
    for (let i = lo; i <= hi && n < MAX; i++) for (let j = lo; j <= hi && n < MAX; j++) {
      const cluster = 0.12 + 0.88 * hash(Math.floor(i / 9), Math.floor(j / 9), 7); // 숲 덩어리: 200m쯤의 구역마다 밀도가 다르다
      if (hash(i, j, 1) > 0.5 * cluster * cluster) continue;
      const x = (i + 0.15 + 0.7 * hash(i, j, 2)) * CELL, y = (j + 0.15 + 0.7 * hash(i, j, 3)) * CELL;
      if (T && (isWater(T, x, y) || net.heightAt(x, y) < T.waterLevel + 1.5)) continue;
      if (nearRoad(x, y) || zoned.has(`${Math.round(x / config.zones.cell)},${Math.round(y / config.zones.cell)}`)) continue;
      if (bl.some((b) => Math.abs(b.x - x) < b.r && Math.abs(b.y - y) < b.r)) continue;
      const p = toThree(x, y, 0), sc = 0.8 + 0.7 * hash(i, j, 4);
      const isPine = T ? net.heightAt(x, y) > T.amp * 0.55 || hash(i, j, 5) < 0.25 : hash(i, j, 5) < 0.25;
      d.position.set(p.x, p.y, p.z); d.rotation.set(0, hash(i, j, 6) * 6.28, 0); d.scale.set(sc, sc * (0.9 + 0.3 * hash(i, j, 8)), sc); d.updateMatrix();
      trunk.setMatrixAt(n, d.matrix);
      if (isPine) { pine.setMatrixAt(np, d.matrix); pine.setColorAt(np++, PINES[(i + j + 9999) % PINES.length]); trunk.setColorAt(n, new THREE.Color(0x6a4d36)); }
      else { round.setMatrixAt(nr, d.matrix); round.setColorAt(nr++, GREENS[(i * 3 + j + 9999) % GREENS.length]); trunk.setColorAt(n, new THREE.Color(0x7a5a3c)); }
      n++;
    }
    trunk.count = n; round.count = nr; pine.count = np;
    for (const m of [trunk, round, pine]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  return {
    /** 매 프레임 호출: 도로망·건물·구역·지형이 바뀌었으면 0.4초 안에 다시 계산 */
    sync(now: number) {
      const k = `${net.revision}:${net.buildingsRevision}:${net.zonesRevision}:${net.terrain ? JSON.stringify(net.terrain) : ''}`;
      if (k !== key) { key = k; dirty = 1; }
      if (dirty && now - last > 400) { rebuild(); dirty = 0; last = now; }
    },
    setVisible(v: boolean) { for (const m of [trunk, round, pine]) m.visible = v; },
  };
}
export type DecorLayer = ReturnType<typeof createDecorLayer>;
