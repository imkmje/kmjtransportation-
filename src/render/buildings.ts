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
  let shown = '';

  const place = (m: THREE.Mesh, x: number, y: number, w: number, h: number, bottom = 0) => {
    const p = toThree(x, y, bottom + h / 2);
    m.position.set(p.x, p.y, p.z);
    m.scale.set(w, h, w);
  };
  const size = (kind: BuildingKind, s: BuildingSize, variant = 0, density = 0) => ({
    half: config.buildings.footprint[s],
    h: config.buildings.height[kind === 'office' ? 'office' : kind === 'shop' || kind === 'factory' || kind === 'school' ? kind : 'home'][s] * (variant === 0 ? 1 : 0.8 + ((variant >> 2) % 5) * 0.1) * (kind === 'home' ? config.densityHeight[density] : 1), // 자란 건물은 높이가 조금씩 다르고, 고밀 주거는 더 높다
  });

  // 건물 몸체·지붕·연결선·경고 표지는 종류별로 InstancedMesh 하나로 모아 그린다(건물이 수백 채여도 그리기 호출이 몇 번뿐이다)
  type Inst = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; rz: number; color: THREE.Color | null };
  const white = new THREE.MeshLambertMaterial({ color: 0xffffff });
  function flush(geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[], colored: boolean) {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    m.frustumCulled = false;
    const d = new THREE.Object3D();
    list.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z); d.scale.set(it.sx, it.sy, it.sz); d.rotation.set(0, it.ry, it.rz); d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
      if (colored && it.color) m.setColorAt(i, it.color);
    });
    group.add(m);
  }

  function rebuild() {
    group.children.forEach((c) => (c as THREE.InstancedMesh).dispose?.());
    group.clear();
    const bodies: Inst[] = [], roofs: Inst[] = [], links: Inst[] = [], warns: Inst[] = [];
    // 상자 하나: 바닥 높이 bottom 위에 w×h×w(sx·sz로 바꿔 쓸 수도 있다)
    const box = (mat: THREE.MeshLambertMaterial, x: number, y: number, w: number, h: number, bottom = 0, sx = w, sz = w) => {
      const p = toThree(x, y, bottom + h / 2);
      bodies.push({ x: p.x, y: p.y, z: p.z, sx, sy: h, sz, ry: 0, rz: 0, color: mat.color });
    };
    for (const b of net.buildings.values()) {
      if (b.kind === 'external') { // 외부 연결점: 분홍 표지판이 달린 문(지도에 하나뿐이라 따로 그린다)
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
      const pal = b.kind === 'home' ? HOME_COLORS : b.kind === 'shop' ? SHOP_COLORS : b.kind === 'factory' ? FACTORY_COLORS : b.kind === 'school' ? SCHOOL_COLORS : OFFICE_COLORS;
      box(pal[pick % pal.length], b.x, b.y, half * 2, h);
      if (b.kind === 'factory') for (const dx of [-0.45, 0.2]) box(DARK, b.x + dx * half, b.y - 0.3 * half, half * 0.35, h * 0.9, h); // 굴뚝 둘
      if (b.kind === 'school') box(WHITE, b.x, b.y, half * 0.6, h * 0.8, h); // 흰 시계탑
      if (b.kind === 'shop') box(AWNING, b.x, b.y + half + 0.8, half * 2.1, 0.5, h * 0.55, half * 2.1, 3); // 붉은 차양
      if (b.kind === 'office' && b.variant % 2 === 1) box(OFFICE_COLORS[(pick + 1) % OFFICE_COLORS.length], b.x, b.y, half * 1.2, h * 0.35, h); // 위층이 좁아지는 계단형 탑
      if (b.kind === 'home' && b.variant % 3 !== 2) { // 지붕(변형 2는 평평한 지붕)
        const p = toThree(b.x, b.y, h + half * 0.35);
        roofs.push({ x: p.x, y: p.y, z: p.z, sx: half * 1.45, sy: half * (b.variant % 3 === 1 ? 1.1 : 0.7), sz: half * 1.45, ry: Math.PI / 4, rz: 0, color: HOME_ROOFS[pick % HOME_ROOFS.length].color });
      }
      const acc = net.accessOf(b.id);
      if (acc) { // 연결된 도로 접속 지점까지 가는 가는 선
        const p = toThree((acc.x + b.x) / 2, (acc.y + b.y) / 2, 0.35);
        links.push({ x: p.x, y: p.y, z: p.z, sx: Math.hypot(acc.x - b.x, acc.y - b.y), sy: 0.15, sz: 0.7, ry: Math.atan2(acc.y - b.y, acc.x - b.x), rz: 0, color: null });
      } else { // 미연결 경고(꼭짓점이 아래로)
        const p = toThree(b.x, b.y, h + (b.kind === 'home' ? half * 0.7 : 0) + 4);
        warns.push({ x: p.x, y: p.y, z: p.z, sx: 2.4, sy: 5, sz: 2.4, ry: 0, rz: Math.PI, color: null });
      }
    }
    flush(unitBox, white, bodies, true);
    flush(cone, white, roofs, true);
    flush(unitBox, linkMat, links, false);
    flush(cone, warnMat, warns, false);
  }

  return {
    /** 도로망이 바뀌었으면 다시 그린다 */
    sync() { const key = `${net.revision}:${net.buildingsRevision}`; if (key !== shown) { rebuild(); shown = key; } },
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
