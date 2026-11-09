import * as THREE from 'three';
import { config } from '../config';
import type { Network, ZoneType } from '../sim/network';
import { toThree } from './coords';

const COLORS: Record<ZoneType | 'erase', number> = { home: 0x6fcf7e, homeMid: 0x3fae5a, homeHigh: 0x1f8a45, shop: 0x4f86d6, office: 0x9a6fd1, industrial: 0xe8b93c, mixed: 0x4fc7b0, erase: 0xe0443c };
const mat = (c: number, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });

/** 구역 칸을 지면 위에 색 칸으로 그린다(주거 = 초록, 직장 = 파랑). 드래그 중인 사각형은 따로 보여 준다 */
export function createZoneLayer(scene: THREE.Scene, net: Network) {
  const group = new THREE.Group();
  scene.add(group);
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ghost = new THREE.Mesh(plane, mat(COLORS.home, 0.4));
  ghost.visible = false; ghost.renderOrder = 2;
  scene.add(ghost);
  const c = config.zones.cell;
  let shown = -1;

  function rebuild() {
    group.clear();
    for (const type of ['home', 'homeMid', 'homeHigh', 'shop', 'office', 'industrial', 'mixed'] as const) {
      const cells = net.zoneList().filter((z) => z.type === type);
      if (!cells.length) continue;
      const pos = new Float32Array(cells.length * 18);
      cells.forEach((z, n) => {
        const h = c / 2 - 0.5; // 칸 사이에 1m 틈을 두어 칸이 보이게
        const q = [[-h, -h], [h, -h], [h, h], [-h, -h], [h, h], [-h, h]].flatMap(([dx, dy]) => { const p = toThree(z.i * c + dx, z.j * c + dy, 0.12); return [p.x, p.y, p.z]; });
        pos.set(q, n * 18);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, mat(COLORS[type], 0.45));
      m.renderOrder = 1;
      group.add(m);
    }
  }

  return {
    sync() { if (net.zonesRevision !== shown) { rebuild(); shown = net.zonesRevision; } },
    /** 드래그 중인 사각형(칸 번호 범위). type이 null이면 지우기(빨강) */
    setGhost(i0: number, j0: number, i1: number, j1: number, type: ZoneType | null) {
      const a = Math.min(i0, i1), b = Math.max(i0, i1), d = Math.min(j0, j1), e = Math.max(j0, j1);
      const p = toThree(((a + b) / 2) * c, ((d + e) / 2) * c, 0.3);
      ghost.position.set(p.x, p.y, p.z);
      ghost.scale.set((b - a + 1) * c, 1, (e - d + 1) * c);
      (ghost.material as THREE.MeshBasicMaterial).color.setHex(COLORS[type ?? 'erase']);
      ghost.visible = true;
    },
    clearGhost() { ghost.visible = false; },
  };
}
export type ZoneLayer = ReturnType<typeof createZoneLayer>;
