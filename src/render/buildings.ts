import * as THREE from 'three';
import { config } from '../config';
import type { BuildingKind, BuildingSize, Network } from '../sim/network';
import { toThree } from './coords';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(1, 1, 4);
const HOME_COLORS = [0xecc9a0, 0xe5a99b, 0xf2dcae, 0xd9bda3, 0xefb98a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const HOME_ROOFS = [0xc9a07a, 0xc3837a, 0xd0b988, 0xb89b82, 0xcf9560].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const OFFICE_COLORS = [0x8da9c6, 0x7d9bb9, 0xa1b6cb, 0x6f8fb0].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const linkMat = new THREE.MeshBasicMaterial({ color: 0x6c7480, transparent: true, opacity: 0.55 });
const warnMat = new THREE.MeshBasicMaterial({ color: 0xe0443c });
const goodMat = new THREE.MeshBasicMaterial({ color: 0x3fae5a, transparent: true, opacity: 0.55, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: 0xe0443c, transparent: true, opacity: 0.6, depthWrite: false });

/** 주거(따뜻한 색, 낮음)와 직장(푸른색, 높음)을 상자로 그린다. 도로에 연결되지 않은 건물은 위에 빨간 표시 */
export function createBuildingLayer(scene: THREE.Scene, net: Network) {
  const group = new THREE.Group();
  scene.add(group);
  const ghost = new THREE.Mesh(unitBox, goodMat);
  const hover = new THREE.Mesh(unitBox, badMat);
  for (const m of [ghost, hover]) { m.visible = false; m.renderOrder = 1; scene.add(m); }
  let shown = -1;

  const place = (m: THREE.Mesh, x: number, y: number, w: number, h: number, bottom = 0) => {
    const p = toThree(x, y, bottom + h / 2);
    m.position.set(p.x, p.y, p.z);
    m.scale.set(w, h, w);
  };
  const size = (kind: BuildingKind, s: BuildingSize) => ({ half: config.buildings.footprint[s], h: config.buildings.height[kind][s] });

  function rebuild() {
    group.clear();
    for (const b of net.buildings.values()) {
      const { half, h } = size(b.kind, b.size);
      const body = new THREE.Mesh(unitBox, b.kind === 'home' ? HOME_COLORS[b.id % HOME_COLORS.length] : OFFICE_COLORS[b.id % OFFICE_COLORS.length]);
      place(body, b.x, b.y, half * 2, h);
      group.add(body);
      if (b.kind === 'home') { // 지붕
        const roof = new THREE.Mesh(cone, HOME_ROOFS[b.id % HOME_ROOFS.length]);
        const p = toThree(b.x, b.y, h + half * 0.35);
        roof.position.set(p.x, p.y, p.z);
        roof.scale.set(half * 1.45, half * 0.7, half * 1.45);
        roof.rotation.y = Math.PI / 4;
        group.add(roof);
      }
      const acc = net.accessOf(b.id);
      if (acc) { // 연결된 도로 접속 지점까지 가는 가는 선
        const len = Math.hypot(acc.x - b.x, acc.y - b.y);
        const link = new THREE.Mesh(unitBox, linkMat);
        const p = toThree((acc.x + b.x) / 2, (acc.y + b.y) / 2, 0.35);
        link.position.set(p.x, p.y, p.z);
        link.scale.set(len, 0.15, 0.7);
        link.rotation.y = Math.atan2(acc.y - b.y, acc.x - b.x);
        group.add(link);
      } else { // 미연결 경고
        const w = new THREE.Mesh(cone, warnMat);
        const p = toThree(b.x, b.y, h + (b.kind === 'home' ? half * 0.7 : 0) + 4);
        w.position.set(p.x, p.y, p.z);
        w.scale.set(2.4, 5, 2.4);
        w.rotation.z = Math.PI; // 꼭짓점이 아래로(경고 표지)
        group.add(w);
      }
    }
  }

  return {
    /** 도로망이 바뀌었으면 다시 그린다 */
    sync() { if (net.revision !== shown) { rebuild(); shown = net.revision; } },
    setGhost(kind: BuildingKind, s: BuildingSize, x: number, y: number, valid: boolean) {
      const { half, h } = size(kind, s);
      place(ghost, x, y, half * 2, h);
      ghost.material = valid ? goodMat : badMat;
      ghost.visible = true;
    },
    clearGhost() { ghost.visible = false; },
    setHover(id: number | null) {
      const b = id === null ? undefined : net.buildings.get(id);
      hover.visible = !!b;
      if (b) { const { half, h } = size(b.kind, b.size); place(hover, b.x, b.y, half * 2 + 1, h + 1, -0.2); }
    },
  };
}
export type BuildingLayer = ReturnType<typeof createBuildingLayer>;
