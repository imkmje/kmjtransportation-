import * as THREE from 'three';
import { config } from '../config';
import type { Network } from '../sim/network';
import type { Light, Signals } from '../sim/signals';
import { toThree } from './coords';

const box = new THREE.BoxGeometry(1, 1, 1);
const mats: Record<Light, THREE.MeshBasicMaterial> = {
  green: new THREE.MeshBasicMaterial({ color: 0x2fcf5a }),
  yellow: new THREE.MeshBasicMaterial({ color: 0xf5c518 }),
  red: new THREE.MeshBasicMaterial({ color: 0xe0382e }),
};
const poleMat = new THREE.MeshLambertMaterial({ color: 0x4a4f57 });

/** 신호가 켜진 교차로의 각 접근로 오른쪽에 기둥과 신호등(녹/황/적)을 세운다. 색은 매 프레임 시뮬레이션 tick에서 읽는다 */
export function createSignalLayer(scene: THREE.Scene, net: Network, signals: Signals, getTick: () => number) {
  const group = new THREE.Group();
  scene.add(group);
  let shown = -1;
  let heads: { m: THREE.Mesh; node: number; seg: number }[] = [];

  function rebuild() {
    group.clear();
    heads = [];
    for (const n of net.nodes.values()) {
      if (!net.hasSignal(n.id)) continue;
      for (const s of net.segmentsAt(n.id)) {
        const o = net.nodes.get(s.a === n.id ? s.b : s.a)!;
        const len = Math.hypot(o.x - n.x, o.y - n.y);
        const ux = (o.x - n.x) / len, uy = (o.y - n.y) / len; // 교차로에서 바깥으로
        const r = config.roads[s.kind], half = r.lanesPerDir * r.laneWidth;
        const x = n.x + ux * 9 + -uy * (half + 1.5), y = n.y + uy * 9 + ux * (half + 1.5); // 들어오는 차량의 오른쪽
        const pole = new THREE.Mesh(box, poleMat);
        const p = toThree(x, y, 2.5);
        pole.position.set(p.x, p.y, p.z); pole.scale.set(0.25, 5, 0.25);
        const head = new THREE.Mesh(box, mats.red);
        const q = toThree(x, y, 5.6);
        head.position.set(q.x, q.y, q.z); head.scale.set(1.3, 1.3, 1.3);
        group.add(pole, head);
        heads.push({ m: head, node: n.id, seg: s.id });
      }
    }
  }

  return {
    update() {
      if (net.revision !== shown) { rebuild(); shown = net.revision; }
      const t = getTick();
      for (const h of heads) h.m.material = mats[signals.light(h.node, h.seg, t)];
    },
  };
}
