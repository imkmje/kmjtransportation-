import * as THREE from 'three';
import { config } from '../config';
import type { BuildingKind, BuildingSize, Network } from '../sim/network';
import { toThree } from './coords';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cone = new THREE.ConeGeometry(1, 1, 4);
const HOME_COLORS = [0xecc9a0, 0xe5a99b, 0xf2dcae, 0xd9bda3, 0xefb98a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const HOME_ROOFS = [0xc9a07a, 0xc3837a, 0xd0b988, 0xb89b82, 0xcf9560].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const SHOP_COLORS = [0x6f9fe0, 0x5b8fd6, 0x8db3e8, 0x4f86d6].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const FACTORY_COLORS = [0xf0c24f, 0xe8b93c, 0xf4d37a, 0xdca62e].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const SCHOOL_COLORS = [0x3fc0b2, 0x2fb5a8, 0x5fd0c4, 0x28a094].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const DARK = new THREE.MeshLambertMaterial({ color: 0x4a4f57 });
const WHITE = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
const AWNING = new THREE.MeshLambertMaterial({ color: 0xd4503c });
const OFFICE_COLORS = [0xa88ae0, 0x9a6fd1, 0xb9a0e8, 0x8a62c4].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const gateMat = new THREE.MeshLambertMaterial({ color: 0xe0508f }); // 외부 연결점은 분홍(주거 초록·상업 파랑·사무 보라·산업 노랑과 구분)
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
  const size = (kind: BuildingKind, s: BuildingSize, variant = 0, density = 0) => ({
    half: config.buildings.footprint[s],
    h: config.buildings.height[kind === 'office' ? 'office' : kind === 'shop' || kind === 'factory' || kind === 'school' ? kind : 'home'][s] * (variant === 0 ? 1 : 0.8 + ((variant >> 2) % 5) * 0.1) * (kind === 'home' ? config.densityHeight[density] : 1), // 자란 건물은 높이가 조금씩 다르고, 고밀 주거는 더 높다
  });

  function rebuild() {
    group.clear();
    for (const b of net.buildings.values()) {
      if (b.kind === 'external') { // 외부 연결점: 노란 표지판이 달린 문
        const pad = new THREE.Mesh(unitBox, gateMat);
        place(pad, b.x, b.y, 16, 0.4);
        const sign = new THREE.Mesh(unitBox, gateMat);
        place(sign, b.x, b.y, 3, 14);
        sign.scale.set(14, 4, 1.2);
        const p = toThree(b.x, b.y, 12);
        sign.position.set(p.x, p.y, p.z);
        group.add(pad, sign);
        continue;
      }
      const { half, h } = size(b.kind, b.size, b.variant, b.density);
      const pick = b.id + b.variant;
      const body = new THREE.Mesh(unitBox, b.kind === 'home' ? HOME_COLORS[pick % HOME_COLORS.length] : b.kind === 'shop' ? SHOP_COLORS[pick % SHOP_COLORS.length] : b.kind === 'factory' ? FACTORY_COLORS[pick % FACTORY_COLORS.length] : b.kind === 'school' ? SCHOOL_COLORS[pick % SCHOOL_COLORS.length] : OFFICE_COLORS[pick % OFFICE_COLORS.length]);
      place(body, b.x, b.y, half * 2, h);
      group.add(body);
      if (b.kind === 'factory') { // 굴뚝 둘(어두운 상자)
        for (const dx of [-0.45, 0.2]) {
          const ch = new THREE.Mesh(unitBox, DARK);
          place(ch, b.x + dx * half, b.y - 0.3 * half, half * 0.35, h * 0.9, h);
          group.add(ch);
        }
      }
      if (b.kind === 'school') { // 흰 시계탑
        const tw = new THREE.Mesh(unitBox, WHITE);
        place(tw, b.x, b.y, half * 0.6, h * 0.8, h);
        group.add(tw);
      }
      if (b.kind === 'shop') { // 붉은 차양(앞쪽으로 튀어나온 얇은 판)
        const aw = new THREE.Mesh(unitBox, AWNING);
        place(aw, b.x, b.y + half + 0.8, half * 2.1, 0.5, h * 0.55);
        aw.scale.set(half * 2.1, 0.5, 3);
        group.add(aw);
      }
      if (b.kind === 'office' && b.variant % 2 === 1) { // 위층이 좁아지는 계단형 탑
        const top = new THREE.Mesh(unitBox, OFFICE_COLORS[(pick + 1) % OFFICE_COLORS.length]);
        place(top, b.x, b.y, half * 1.2, h * 0.35, h);
        group.add(top);
      }
      if (b.kind === 'home' && b.variant % 3 !== 2) { // 지붕(변형 2는 평평한 지붕)
        const roof = new THREE.Mesh(cone, HOME_ROOFS[pick % HOME_ROOFS.length]);
        const p = toThree(b.x, b.y, h + half * 0.35);
        roof.position.set(p.x, p.y, p.z);
        roof.scale.set(half * 1.45, half * (b.variant % 3 === 1 ? 1.1 : 0.7), half * 1.45);
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
