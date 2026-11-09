import * as THREE from 'three';
import { config } from '../config';
import { CI_GRADES } from '../sim/metrics';
import type { Metrics } from '../sim/metrics';
import { roadSpan, type Network } from '../sim/network';
import { toThree } from './coords';

// 등급(원활~심각) 색. 기본: 초록→빨강. 색약 친화: 파랑→주황→진한 빨강(초록-빨강 구분이 어려운 경우에도 밝기와 색상 축이 다르다)
const PALETTES = {
  normal: ['#3fae5a', '#9ccf4a', '#f0b13a', '#e8743a', '#b3302a'],
  colorblind: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#7a0019'],
};
const NONE = '#9aa0a6'; // 통과 차량이 적어 판정 없음

const unitBox = new THREE.BoxGeometry(1, 1, 1);

/** 도로를 최근 정체 지수 등급 색으로 칠한다(rules.md 1항: 도로 단위에도 같은 식. 통과 차량 5대 미만이면 회색) */
export function createHeatmap(scene: THREE.Scene, net: Network, metrics: Metrics, legend: HTMLElement) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const meshes = new Map<number, THREE.Mesh>();
  let shown = -1, on = false, palette: keyof typeof PALETTES = 'normal';

  function rebuild() {
    for (const m of meshes.values()) (m.material as THREE.Material).dispose();
    group.clear();
    meshes.clear();
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const r = config.roads[s.kind];
      const m = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color: NONE, transparent: true, opacity: 0.8, depthWrite: false }));
      const sp = roadSpan(r, !!s.oneWay), L = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const p = toThree((a.x + b.x) / 2 - uy * sp.shift, (a.y + b.y) / 2 + ux * sp.shift, 0.38); // 비대칭 도로는 몸체가 중앙선에서 치우쳐 있다
      m.position.set(p.x, p.y, p.z);
      m.scale.set(L, 0.08, sp.width);
      m.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
      m.renderOrder = 1;
      group.add(m);
      meshes.set(s.id, m);
    }
  }

  const colorOf = (ci: number | null | undefined) => (ci === null || ci === undefined ? NONE : PALETTES[palette][CI_GRADES.findIndex((g) => ci < g.max)]);

  function drawLegend() {
    legend.hidden = !on;
    if (!on) return;
    legend.innerHTML = [...CI_GRADES.map((g, i) => [PALETTES[palette][i], g.name]), [NONE, '통행 적음']]
      .map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
  }

  return {
    setVisible(v: boolean) { on = v; group.visible = v; drawLegend(); },
    setColorblind(v: boolean) { palette = v ? 'colorblind' : 'normal'; drawLegend(); },
    /** 몇 프레임에 한 번 호출하면 된다 */
    update() {
      if (!on) return;
      if (net.revision !== shown) { rebuild(); shown = net.revision; }
      const cis = metrics.segmentCIs();
      for (const [id, m] of meshes) (m.material as THREE.MeshBasicMaterial).color.set(colorOf(cis.get(id)));
    },
    /** 테스트·디버깅용: 도로별 현재 색 */
    colors(): Map<number, string> {
      const cis = metrics.segmentCIs();
      return new Map([...meshes.keys()].map((id) => [id, colorOf(cis.get(id))]));
    },
  };
}
