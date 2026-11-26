import * as THREE from 'three';
import type { BodyId, CarLook } from './look';
import { RIM_RATIO, eraOf, eraStyle, type WheelKind } from './shapes';
import { chassisOf, faceOf } from './variant';
import { carBody, KS } from './carBody';

export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
  crease: THREE.MeshPhysicalMaterial; // 캐릭터 라인(차체색을 같은 Color 객체로 공유)
  glass: THREE.MeshPhysicalMaterial;
  tire: THREE.MeshStandardMaterial;
  rim: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  lamp: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
  gloss: THREE.MeshPhysicalMaterial; // 유광 검정(창틀·필러·램프 테)
  rotor: THREE.MeshStandardMaterial; caliper: THREE.MeshStandardMaterial; // 브레이크 디스크·캘리퍼(스포츠는 빨강)
  lens: THREE.MeshPhysicalMaterial; // 전조등 유리 덮개(짙은 유리, 안쪽 발광체는 lamp)
  tailLens: THREE.MeshPhysicalMaterial; // 후미등 붉은 유리 덮개(안쪽 발광체는 tail)
  accent: THREE.MeshStandardMaterial; // 1.5.0 전기차판 청록 포인트
}

export function createCarMaterials(color: string): CarMaterials {
  const std = THREE.MeshStandardMaterial, pp = { metalness: .35, roughness: .22, envMapIntensity: 1.5, clearcoat: 1, clearcoatRoughness: .05 };
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), ...pp }), crease = new THREE.MeshPhysicalMaterial({ ...pp, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
  crease.color = paint.color; // 무대가 차체색을 바꾸면(paint.color.lerp) 함께 바뀐다
  return {
    paint, crease,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x2a3a4c, metalness: .55, roughness: .04, envMapIntensity: 1.8, clearcoat: 1, clearcoatRoughness: .02 }),
    tire: new std({ color: 0x1d1f22, roughness: .88, envMapIntensity: .35 }),
    rim: new std({ color: 0xeef1f5, metalness: .8, roughness: .2, envMapIntensity: 1.6 }),
    dark: new std({ color: 0x101215, roughness: .75, metalness: .1 }),
    trim: new std({ color: 0x1a1c20, roughness: .62, metalness: .05, side: THREE.DoubleSide }),
    lamp: new std({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 1.5 }),
    tail: new std({ color: 0xd01010, emissive: 0xe01008, emissiveIntensity: .9 }),
    chrome: new std({ color: 0xf2f4f7, metalness: 1, roughness: .1, side: THREE.DoubleSide }),
    plate: new std({ color: 0x30353d, roughness: .5 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x06080a, roughness: .16, metalness: .1, clearcoat: 1, clearcoatRoughness: .04, side: THREE.DoubleSide }),
    rotor: new std({ color: 0x5c6066, metalness: .8, roughness: .45 }), caliper: new std({ color: 0xb3201c, roughness: .4, metalness: .2 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x2a3038, metalness: .6, roughness: .08, clearcoat: 1, clearcoatRoughness: .03, envMapIntensity: 1.6 }),
    tailLens: new THREE.MeshPhysicalMaterial({ color: 0x6e0710, emissive: 0x4a0004, metalness: .3, roughness: .08, clearcoat: 1, clearcoatRoughness: .03 }),
    accent: new std({ color: 0x00b8d4, emissive: 0x0092b0, emissiveIntensity: .8, roughness: .35, side: THREE.DoubleSide }),
  };
}

export function disposeCar(group: THREE.Object3D): void {
  group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}

// 차급별 타이어 폭(m): 경차는 좁고 스포츠카·SUV는 넓다
const TIRE_W: Record<BodyId, number> = { sedanS: .195, hatch: .2, sedanM: .215, coupe: .235, suvS: .215, suv: .235, suvL: .25, sedanL: .225, minivan: .215, kei: .155, pickup: .245, sports: .26 };

type P2 = [number, number]; // 얼굴 평면 좌표 [가로 m(가운데 0, 모서리를 넘으면 옆으로 감김), 높이 m]
type Outline = P2[] & { rect?: [number, number, number, number, number] };
const roundRect = (z0: number, z1: number, y0: number, y1: number, r: number, n = 3): Outline => {
  if (z1 < z0) [z0, z1] = [z1, z0];
  r = Math.min(r, (z1 - z0) / 2, (y1 - y0) / 2);
  const out: Outline = [], C: [number, number, number][] = [[z1 - r, y0 + r, -Math.PI / 2], [z1 - r, y1 - r, 0], [z0 + r, y1 - r, Math.PI / 2], [z0 + r, y0 + r, Math.PI]];
  for (const [cz, cy, a0] of C) for (let i = 0; i <= n; i++) { const a = a0 + Math.PI / 2 * i / n; out.push([cz + r * Math.cos(a), cy + r * Math.sin(a)]); }
  out.rect = [z0, z1, y0, y1, r];
  return out;
};
const ellipse = (zc: number, yc: number, rz: number, ry: number, n = 20): P2[] => Array.from({ length: n }, (_, i) => [zc + rz * Math.cos(i / n * Math.PI * 2), yc + ry * Math.sin(i / n * Math.PI * 2)] as P2);
/** 꼭짓점 목록을 가장자리 길이에 맞춰 촘촘하게(곡면에 잘 붙게) */
const dense = (pts: P2[], step = .04): P2[] => {
  const out: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
};

/* 5.2.0 차 생성기: carBody(아래 몸통·온실 곡면) + 곡면에 붙인 입체 부품(전조등·그릴·흡기구·범퍼·후미등) + 옆·윗면 부품 + 바퀴.
   같은 입력이면 같은 모양(순수 함수). 얼굴·휠은 faceSeed, 차체 윤곽은 chassisSeed와 시대만 따른다. */
export function buildCar(look: CarLook, M: CarMaterials): THREE.Group {
  const carG = new THREE.Group();
  const p = chassisOf(look), fc = faceOf(look), sd = p.side, era = eraOf(look), id = look.bodyId, E = eraStyle(look);
  const ev = look.powertrain === 'ev', gt = look.variant === 'gt', evV = look.variant === 'ev' && ev;
  const tw = TIRE_W[id] + (gt ? .02 : 0);
  const B = carBody(p, E, { gt, era, tireW: tw });
  const h = B.h, hw = B.hw;
  let miss = 0;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; carG.add(m); return m;
  };
  const pair = (fn: (g: 1 | -1) => void) => { fn(1); fn(-1); };

  // ── 차체 곡면(아래 몸통 + 온실 한 메시) ──
  {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(B.position, 3));
    geo.setIndex(B.index);
    for (const g of B.groups) geo.addGroup(g.start, g.count, g.mat);
    geo.computeVertexNormals();
    add(geo, [M.paint, M.glass, M.dark, M.gloss, M.trim, M.chrome]);
  }

  // ── 부품 모으기: 재질마다 한 메시(그리기 호출을 줄인다) ──
  const bins = new Map<THREE.Material, { pos: number[]; idx: number[] }>();
  const bin = (mat: THREE.Material) => { let b = bins.get(mat); if (!b) bins.set(mat, b = { pos: [], idx: [] }); return b; };
  /** 삼각형 하나를 바깥 방향(out)으로 향하게 넣는다 */
  const triOut = (b: { pos: number[]; idx: number[] }, i0: number, i1: number, i2: number, out: number[]) => {
    const P = b.pos, ax = P[i1 * 3] - P[i0 * 3], ay = P[i1 * 3 + 1] - P[i0 * 3 + 1], az = P[i1 * 3 + 2] - P[i0 * 3 + 2], bx = P[i2 * 3] - P[i0 * 3], by = P[i2 * 3 + 1] - P[i0 * 3 + 1], bz = P[i2 * 3 + 2] - P[i0 * 3 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) b.idx.push(i0, i1, i2); else b.idx.push(i0, i2, i1);
  };
  const vert = (b: { pos: number[] }, q: number[]) => { b.pos.push(q[0], q[1], q[2]); return b.pos.length / 3 - 1; };

  // 얼굴 곡면 위 점: 앞(+1)·뒤(−1) 끝에서 가로 zm(m)·높이 y. e만큼 법선 방향으로 띄운다
  type HP = { p: number[]; n: number[] };
  const hitMemo = new Map<string, HP | null>();
  const at = (s: 1 | -1, zm: number, y: number): HP | null => {
    const key = `${s}|${zm.toFixed(4)}|${y.toFixed(4)}`;
    if (hitMemo.has(key)) return hitMemo.get(key)!;
    let H = B.hit(s, Math.atan2(zm, B.Rc(s)), y);
    for (let k = 1; !H && k <= 8; k++) H = B.hit(s, Math.atan2(zm, B.Rc(s)), y - .01 * k); // 끝선(보닛·트렁크 모서리) 위로 살짝 넘친 점은 끝선 아래로 내린다
    const r = H ? { p: H.p, n: H.n } : null;
    hitMemo.set(key, r); return r;
  };
  const off = (q: HP, e: number) => [q.p[0] + q.n[0] * e, q.p[1] + q.n[1] * e, q.p[2] + q.n[2] * e];
  /** 채운 입체 부품: 윤곽(별 모양) 안을 채운 윗면을 e만큼 띄우고, 가장자리에 벽을 세운다(wall이 없으면 벽 없음) */
  const fill = (s: 1 | -1, outline: Outline, e: number, mat: THREE.Material, wall: THREE.Material | null = M.gloss, rings = 2) => {
    if (outline.rect) return fillRect(s, outline.rect, e, mat, wall);
    const o = dense(outline), c: P2 = [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length];
    rings = Math.max(rings, Math.ceil(Math.max(...o.map(q => Math.hypot(q[0] - c[0], q[1] - c[1]))) / .06)); // 넓은 부품은 고리를 늘려 곡면을 따라가게
    const H: HP[][] = [];
    const hc = at(s, c[0], c[1]); if (!hc) { miss++; return; }
    for (let r = 1; r <= rings; r++) {
      const row: HP[] = [];
      for (const q of o) { const v = r / rings, hp = at(s, c[0] + (q[0] - c[0]) * v, c[1] + (q[1] - c[1]) * v); if (!hp) { miss++; return; } row.push(hp); }
      H.push(row);
    }
    const b = bin(mat), n = o.length, i0 = vert(b, off(hc, e)), ids = H.map(row => row.map(q => vert(b, off(q, e))));
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      triOut(b, i0, ids[0][i], ids[0][j], H[0][i].n);
      for (let r = 0; r < rings - 1; r++) { triOut(b, ids[r][i], ids[r + 1][i], ids[r + 1][j], H[r + 1][i].n); triOut(b, ids[r][i], ids[r + 1][j], ids[r][j], H[r][i].n); }
    }
    if (wall) wallOf(H[rings - 1], hc, e, wall);
  };
  /** 둥근 사각형 부품: 고른 격자(4cm)로 곡면을 따라간다 */
  const fillRect = (s: 1 | -1, [z0, z1, y0, y1, r]: [number, number, number, number, number], e: number, mat: THREE.Material, wall: THREE.Material | null) => {
    const nu = Math.max(2, Math.ceil((z1 - z0) / .045)), nv = Math.max(1, Math.ceil((y1 - y0) / .045)), G: HP[][] = [];
    for (let j = 0; j <= nv; j++) {
      const row: HP[] = [];
      for (let i = 0; i <= nu; i++) {
        let z = z0 + (z1 - z0) * i / nu, y = y0 + (y1 - y0) * j / nv;
        const cz = Math.min(Math.max(z, z0 + r), z1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r), dz = z - cz, dy = y - cy, l = Math.hypot(dz, dy);
        if (l > r && l > 0) { z = cz + dz * r / l; y = cy + dy * r / l; }
        const hp = at(s, z, y); if (!hp) { miss++; return; } row.push(hp);
      }
      G.push(row);
    }
    const b = bin(mat), ids = G.map(row => row.map(q => vert(b, off(q, e))));
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { triOut(b, ids[j][i], ids[j][i + 1], ids[j + 1][i + 1], G[j][i].n); triOut(b, ids[j][i], ids[j + 1][i + 1], ids[j + 1][i], G[j][i].n); }
    if (wall) {
      const edge: HP[] = [...G[0], ...G.slice(1, -1).map(r2 => r2[nu]), ...[...G[nv]].reverse(), ...G.slice(1, -1).map(r2 => r2[0]).reverse()];
      wallOf(edge, G[nv >> 1][nu >> 1], e, wall);
    }
  };
  const wallOf = (edge: HP[], hc: HP, e: number, mat: THREE.Material, e0 = -.002, inward = false) => {
    const b = bin(mat), n = edge.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, a = edge[i], c = edge[j];
      const out = [a.p[0] - hc.p[0], a.p[1] - hc.p[1], a.p[2] - hc.p[2]].map(v => inward ? -v : v);
      const k0 = vert(b, off(a, e)), k1 = vert(b, off(c, e)), k2 = vert(b, off(c, e0)), k3 = vert(b, off(a, e0));
      triOut(b, k0, k1, k2, out); triOut(b, k0, k2, k3, out);
    }
  };
  /** 테두리(고리) 부품: 바깥 윤곽에서 안쪽으로 w(m) 폭, e만큼 띄우고 안팎에 벽 */
  const frame = (s: 1 | -1, outline: P2[], w: number, e: number, mat: THREE.Material) => {
    const o = dense(outline), c: P2 = [o.reduce((a, q) => a + q[0], 0) / o.length, o.reduce((a, q) => a + q[1], 0) / o.length];
    const inn = o.map(q => { const dz = q[0] - c[0], dy = q[1] - c[1], l = Math.hypot(dz, dy) || 1, k = Math.max(0, 1 - w / l); return [c[0] + dz * k, c[1] + dy * k] as P2; });
    const hc = at(s, c[0], c[1]), A = o.map(q => at(s, q[0], q[1])), I = inn.map(q => at(s, q[0], q[1]));
    if (!hc || A.some(q => !q) || I.some(q => !q)) { miss++; return; }
    const b = bin(mat), n = o.length, ia = A.map(q => vert(b, off(q!, e))), ii = I.map(q => vert(b, off(q!, e)));
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; triOut(b, ia[i], ii[i], ii[j], A[i]!.n); triOut(b, ia[i], ii[j], ia[j], A[i]!.n); }
    wallOf(A as HP[], hc, e, mat); wallOf(I as HP[], hc, e, mat, -.002, true);
  };
  const pairFill = (s: 1 | -1, outline: Outline, e: number, mat: THREE.Material, wall: THREE.Material | null = M.gloss) => pair(g => { const o: Outline = outline.map(q => [g * q[0], q[1]] as P2); if (outline.rect) { const [a, b2, c, d, r] = outline.rect; o.rect = g > 0 ? [a, b2, c, d, r] : [-b2, -a, c, d, r]; } fill(s, o, e, mat, wall); });
  const pairFrame = (s: 1 | -1, outline: P2[], w: number, e: number, mat: THREE.Material) => pair(g => frame(s, outline.map(q => [g * q[0], q[1]] as P2), w, e, mat));

  // ── 옆면 띠: (x, y) 점 줄을 옆면에 붙인 리본(폭 hh, 법선 방향 e) ──
  const sideRibbon = (pts: P2[], hh: number, e: number, mat: THREE.Material, vertical = false) => pair(g => {
    const b = bin(mat), A: number[] = [], C: number[] = [];
    for (const [x, y] of pts) {
      const q0: P2 = vertical ? [x - hh, y] : [x, y + hh], q1: P2 = vertical ? [x + hh, y] : [x, y - hh];
      A.push(vert(b, [q0[0], q0[1], g * (B.sideZ(q0[0], q0[1]) + e)])); C.push(vert(b, [q1[0], q1[1], g * (B.sideZ(q1[0], q1[1]) + e)]));
    }
    for (let i = 0; i < pts.length - 1; i++) { const out = [0, 0, g]; triOut(b, A[i], C[i], C[i + 1], out); triOut(b, A[i], C[i + 1], A[i + 1], out); }
  });
  // ── 윗면 띠: (x, z) 점 줄을 윗면에 붙인 리본 ──
  const topRibbon = (pts: P2[], hh: number, e: number, mat: THREE.Material, alongX = true) => {
    const b = bin(mat), A: number[] = [], C: number[] = [];
    for (const [x, z] of pts) {
      const q0: P2 = alongX ? [x, z - hh] : [x - hh, z], q1: P2 = alongX ? [x, z + hh] : [x + hh, z];
      A.push(vert(b, [q0[0], B.topY(q0[0], q0[1]) + e, q0[1]])); C.push(vert(b, [q1[0], B.topY(q1[0], q1[1]) + e, q1[1]]));
    }
    for (let i = 0; i < pts.length - 1; i++) { triOut(b, A[i], C[i], C[i + 1], [0, 1, 0]); triOut(b, A[i], C[i + 1], A[i + 1], [0, 1, 0]); }
  };
  const lineX = (x0: number, x1: number, f: (x: number) => number, step = .05): P2[] => { const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step)); return Array.from({ length: n + 1 }, (_, i) => { const x = x0 + (x1 - x0) * i / n; return [x, f(x)] as P2; }); };

  // ── 얼굴 기준 높이 ──
  const yNF = B.yN(1), yNR = B.yN(-1), fw = hw * .93;
  const faceTop = B.yHF - .03; // 보닛 끝선 바로 아래
  const tall = p.suv || p.bed != null || id === 'minivan', sporty = id === 'sports' || id === 'coupe';
  const lampH0 = Math.min(.15, Math.max(.07, (faceTop - yNF) * (tall ? .5 : .42))) * (sporty ? .75 : 1);
  const lampH = lampH0 * (fc.lamp === 'slim' ? .72 : 1), lampY = faceTop - lampH / 2 - .012 + fc.lampDy;
  const plateY0 = Math.max(p.clr + .1, yNF - .16), plateY1 = plateY0 + .11;
  let lampIn = fw * .55, lampTop = lampY + lampH / 2;

  // ── 전조등 ──
  const lens = (ol: P2[], e = .007) => pairFill(1, ol, e, M.lens, M.gloss);
  const glow = (ol: P2[], e = .011, mat: THREE.Material = M.lamp) => pairFill(1, ol, e, mat, null);
  const lw = fc.lampW * (sporty ? 1.1 : 1);
  const wrapOut = era >= 1990 ? 1.16 : 1.0; // 1990년대부터 전조등이 모서리를 감싼다
  switch (fc.lamp) {
    case 'round': case 'twin': {
      const r = (fc.lamp === 'twin' ? .062 : .085) * Math.min(1.2, lw), zs = fc.lamp === 'twin' ? [fw * .56, fw * .8] : [fw * .7];
      for (const zc of zs) { pairFill(1, roundRect(zc - r - .03, zc + r + .03, lampY - r - .025, lampY + r + .025, .02), .006, M.gloss, M.gloss); pairFrame(1, ellipse(zc, lampY, r + .012, r + .012), .014, .014, M.chrome); pairFill(1, ellipse(zc, lampY, r, r), .009, M.lens, null); pairFill(1, ellipse(zc, lampY, r * .45, r * .45), .013, M.lamp, null); }
      lampIn = zs[0] - r - .04; lampTop = lampY + r + .025; break;
    }
    case 'oval': {
      const rz = Math.min(.2 * lw, fw * .32), ry = lampH * .68, zc = fw * .76;
      lens(ellipse(zc, lampY, rz, ry, 24)); glow(ellipse(zc + rz * .2, lampY + .005, rz * .35, ry * .45)); glow(ellipse(zc - rz * .45, lampY, rz * .22, ry * .4));
      lampIn = zc - rz; lampTop = lampY + ry; break;
    }
    case 'vertical': {
      const z0 = fw * (1.02 - .2 * lw), z1 = fw * 1.08, y0 = lampY - lampH * 1.1, y1 = lampY + lampH * .5;
      lens(roundRect(z0, z1, y0, y1, .02)); glow(roundRect(z0 + .012, z1 - .015, y1 - (y1 - y0) * .45, y1 - .012, .01));
      lampIn = z0; lampTop = y1; break;
    }
    case 'swept': { // 안쪽은 낮고 가늘게, 바깥은 높고 두껍게 치켜 올라가며 옆으로 감싼다
      const z0 = fw * Math.max(.36, .82 - .4 * lw), z1 = fw * 1.24, ya = lampY - lampH * .2, yb = lampY + lampH * .5;
      const ol: P2[] = [[z0, ya - lampH * .15], [z0 + (z1 - z0) * .55, ya - lampH * .32], [z1, ya + lampH * .05], [z1 - .02, yb + lampH * .08], [z0 + (z1 - z0) * .5, yb], [z0 + .02, ya + lampH * .22]];
      lens(ol); glow([[z0 + .03, ya + lampH * .02], [z1 - .05, yb - lampH * .02], [z1 - .06, yb + lampH * .04], [z0 + .03, ya + lampH * .1]], .012);
      glow(ellipse(z0 + (z1 - z0) * .42, (ya + yb) / 2 - lampH * .08, lampH * .22, lampH * .22, 14), .012);
      lampIn = z0; lampTop = yb + lampH * .08; break;
    }
    case 'slim': { // 얇은 일자 LED: 모서리를 감싼다
      const z0 = fw * Math.max(.32, .8 - .45 * lw), z1 = fw * wrapOut * 1.05, y0 = lampY - lampH / 2, y1 = lampY + lampH / 2;
      lens(roundRect(z0, z1, y0, y1 + .006, .012)); glow(roundRect(z0 + .006, z1 - .01, y1 - lampH * .38, y1 - .004, .004), .012);
      lampIn = z0; lampTop = y1; break;
    }
    case 'popup': { // 닫힌 팝업 램프: 보닛 앞쪽 덮개 선 + 범퍼 위 얇은 등
      const x1 = h - E.endT - .02, x0 = x1 - .26, z0 = fw * .42, z1 = fw * .84;
      for (const g of [1, -1]) { topRibbon(lineX(x0, x1, () => g * z0), .004, .002, M.trim); topRibbon(lineX(x0, x1, () => g * z1), .004, .002, M.trim); topRibbon(lineX(z0, z1, () => x0, .03).map(q => [q[1], g * q[0]] as P2), .004, .002, M.trim, false); }
      const y = lampY - .03; lens(roundRect(fw * .55, fw * .98, y - .02, y + .02, .01)); glow(roundRect(fw * .58, fw * .95, y - .008, y + .01, .006));
      lampIn = fw * .55; lampTop = y + .02; break;
    }
    case 'projector': { // 어두운 램프 칸 안에 둥근 렌즈 2개 + 아래 주간등
      const z0 = fw * Math.max(.38, .86 - .42 * lw), z1 = fw * wrapOut, y0 = lampY - lampH / 2, y1 = lampY + lampH / 2, r = Math.min(.045, (z1 - z0) * .17, lampH * .32);
      lens(roundRect(z0, z1, y0, y1, Math.min(.03, lampH * .3)));
      for (const t of [.3, .62]) { const zc = z0 + (z1 - z0) * t; pairFrame(1, ellipse(zc, lampY + .006, r + .008, r + .008, 16), .009, .013, M.chrome); glow(ellipse(zc, lampY + .006, r, r, 16), .012); }
      glow(roundRect(z0 + .015, z1 - .02, y0 + .008, y0 + .02, .005), .012);
      lampIn = z0; break;
    }
    case 'pixel': {
      const z0 = fw * Math.max(.38, .86 - .4 * lw), z1 = fw * 1.06, y0 = lampY - lampH / 2, y1 = lampY + lampH / 2, cw = (z1 - z0) / 5, ch = (y1 - y0) / 2;
      lens(roundRect(z0, z1, y0, y1, .01));
      for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) glow(roundRect(z0 + cw * i + cw * .2, z0 + cw * (i + 1) - cw * .2, y0 + ch * j + ch * .22, y0 + ch * (j + 1) - ch * .22, .002), .012);
      lampIn = z0; break;
    }
    case 'split': { // 보닛 끝 가는 주간등(위, 감쌈) + 아래 작은 본등
      const z0 = fw * Math.max(.34, .82 - .42 * lw), z1 = fw * 1.14, yd = faceTop - .018, yl = Math.max(yNF + .02, lampY - lampH * .9);
      glow(roundRect(z0, z1, yd - .011, yd + .009, .006), .01);
      lens(roundRect(fw * .66, fw * 1.0, yl - lampH * .38, yl + lampH * .38, .02)); glow(ellipse(fw * .83, yl, Math.min(.04, lampH * .3), Math.min(.04, lampH * .3), 14));
      lampIn = z0; lampTop = yd + .01; break;
    }
    default: { // rect: 1980년대 네모 전조등(평평, 테두리)
      const z0 = fw * Math.max(.36, .9 - .46 * lw), z1 = fw * (E.classic ? .95 : .99), y0 = lampY - lampH / 2, y1 = lampY + lampH / 2;
      pairFill(1, roundRect(z0 - .012, z1 + .012, y0 - .012, y1 + .012, .01), .005, era <= 1980 ? M.chrome : M.gloss, M.gloss);
      lens(roundRect(z0, z1, y0, y1, .008), .009);
      glow(roundRect(z0 + (z1 - z0) * .52, z1 - .015, y0 + .012, y1 - .012, .006), .012); glow(roundRect(z0 + .015, z0 + (z1 - z0) * .45, y0 + .02, y1 - .02, .006), .012);
      lampIn = z0;
    }
  }
  if (fc.bar) fill(1, roundRect(-lampIn, lampIn, lampTop - .014, lampTop, .006), .008, M.lamp, M.gloss);

  // ── 그릴(테두리 + 어두운 속 + 살) ──
  const gH = fc.grilleH * (tall ? 1.25 : 1), gW = fc.grilleW * (tall ? 1.1 : 1);
  if (!ev || fc.grille === 'panel') {
    const gz = Math.min(fw * (E.classic ? .44 : .36) * gW, lampIn - .035);
    const g1 = fc.bar ? lampTop - .028 : Math.min(lampTop - .005, faceTop - .01), g0 = Math.max(plateY1 + .025, g1 - (lampH0 + .05) * gH);
    const chromeFrame = era <= 2000 || fc.grille === 'kidney' ? M.chrome : M.gloss;
    const box = (z0: number, z1: number, y0: number, y1: number, r = .015) => { fill(1, roundRect(z0, z1, y0, y1, r), .004, M.trim, null); frame(1, roundRect(z0 - .014, z1 + .014, y0 - .014, y1 + .014, r + .01), .016, .012, chromeFrame); };
    const barsH = (z0: number, z1: number, y0: number, y1: number, n: number, t = .007, mat: THREE.Material = chromeFrame) => { for (let i = 1; i <= n; i++) { const y = y0 + (y1 - y0) * i / (n + 1); fill(1, roundRect(z0, z1, y - t, y + t, .003), .009, mat, null); } };
    const barsV = (z0: number, z1: number, y0: number, y1: number, n: number, t = .005, mat: THREE.Material = chromeFrame) => { for (let i = 1; i <= n; i++) { const z = z0 + (z1 - z0) * i / (n + 1); fill(1, roundRect(z - t, z + t, y0, y1, .002), .009, mat, null); } };
    switch (fc.grille) {
      case 'hex': { // 위는 좁고 아래로 넓게 범퍼까지 내려오는 큰 육각
        const y0 = Math.max(p.clr + .1, g0 - .06), ol: P2[] = [[-gz * .78, g1], [gz * .78, g1], [gz, (g1 + y0) / 2 + .02], [gz * .82, y0], [-gz * .82, y0], [-gz, (g1 + y0) / 2 + .02]];
        fill(1, ol, .004, M.trim, null); frame(1, ol.map(q => [q[0] * 1.06, (q[1] - (g1 + y0) / 2) * 1.12 + (g1 + y0) / 2] as P2), .018, .013, chromeFrame);
        for (let i = 1; i <= 4; i++) { const y = y0 + (g1 - y0) * i / 5, wz = gz * (.8 + .18 * Math.sin(Math.PI * i / 5)); fill(1, roundRect(-wz + .01, wz - .01, y - .005, y + .005, .002), .009, M.gloss, null); }
        break;
      }
      case 'twin': box(-gz * .85, gz * .85, (g0 + g1) / 2 + .01, g1); box(-gz, gz, g0, (g0 + g1) / 2 - .02); barsH(-gz * .8, gz * .8, (g0 + g1) / 2 + .01, g1, 2, .004); break;
      case 'bars': box(-gz, gz, g0, g1); barsH(-gz + .01, gz - .01, g0, g1, 3); break;
      case 'none': fill(1, roundRect(-gz * .8, gz * .8, lampY - .012, lampY + .006, .006), .004, M.gloss, null); break;
      case 'mesh': box(-gz, gz, g0, g1); barsH(-gz, gz, g0, g1, 3, .003, M.gloss); barsV(-gz, gz, g0, g1, 7, .003, M.gloss); break;
      case 'vertical': box(-gz, gz, g0, g1); barsV(-gz, gz, g0, g1, 9, .005); break;
      case 'kidney': { const kz = Math.max(gz, .15), w2 = kz * .45, gap = .02; for (const g of [1, -1]) { const ol = roundRect(g * gap + (g > 0 ? 0 : -w2 * 2), g * gap + (g > 0 ? w2 * 2 : 0), g0, g1, .04); fill(1, ol, .004, M.trim, null); frame(1, roundRect(Math.min(ol[0][0], ol[6][0]) - .012, Math.max(ol[0][0], ol[6][0]) + .012, g0 - .012, g1 + .012, .05), .015, .013, M.chrome); barsV(g * gap + (g > 0 ? 0 : -w2 * 2), g * gap + (g > 0 ? w2 * 2 : 0), g0, g1, 4, .004); } break; }
      case 'wide': { const y0 = lampY - lampH * .6, y1 = lampY + lampH * .55; fill(1, roundRect(-fw * .97, fw * .97, y0, y1, .01), .003, M.trim, null); barsH(-lampIn + .02, lampIn - .02, y0, y1, 2, .005, M.chrome); break; }
      case 'panel': { const pz = Math.min(fw * .7 * gW, lampIn + .08), y1 = Math.min(g1, lampTop - .02), y0 = Math.max(lampY - lampH * gH, plateY1 + .03); fill(1, roundRect(-pz, pz, y0, y1, .025), .006, M.lens, M.gloss); fill(1, roundRect(-pz + .02, pz - .02, y1 - .014, y1 - .006, .004), .009, M.lamp, null); break; }
      default: box(-gz, gz, g0, g1); barsH(-gz, gz, g0, g1, 2, .004, M.gloss);
    }
  }
  // ── 아래 흡기구(어두운 속 + 유광 테) ──
  const iy0 = p.clr + .07 - (gt ? .02 : 0), iy1 = Math.min(plateY0 - .02, yNF - .04) + (gt ? .03 : 0);
  const intake = (z0: number, z1: number, y0: number, y1: number) => { if (y1 - y0 < .03) return; fill(1, roundRect(z0, z1, y0, y1, .02), .003, M.trim, null); frame(1, roundRect(z0 - .01, z1 + .01, y0 - .01, y1 + .01, .025), .012, .008, M.gloss); };
  switch (fc.intake) {
    case 'wide': intake(-fw * (ev ? .4 : .55), fw * (ev ? .4 : .55), iy0, iy1); break;
    case 'slim': intake(-fw * .45, fw * .45, iy0, iy0 + Math.max(.035, (iy1 - iy0) * .5)); break;
    case 'three': intake(-fw * .3, fw * .3, iy0, iy1); for (const g of [1, -1]) intake(g > 0 ? fw * .5 : -fw * .82, g > 0 ? fw * .82 : -fw * .5, iy0 + .01, iy1 + .03); break;
    case 'fog': intake(-fw * .32, fw * .32, iy0, iy1); for (const g of [1, -1]) { const zc = g * fw * .7, yc = (iy0 + iy1) / 2 + .01, r = Math.min(.045, (iy1 - iy0) * .45); frame(1, ellipse(zc, yc, r + .014, r + .014, 16), .016, .008, M.gloss); fill(1, ellipse(zc, yc, r, r, 16), .006, M.lamp, null); } break;
  }
  // ── 범퍼: 1970 크롬 막대, 검은 수지 범퍼(옆까지 감쌈), 차체색 범퍼는 분할선만 ──
  const bumperBand = (s: 1 | -1, y0: number, y1: number, e: number, mat: THREE.Material, zx = 1.22) => fill(s, roundRect(-fw * zx, fw * zx, y0, y1, Math.min(.03, (y1 - y0) / 2)), e, mat, mat);
  if (E.classic) for (const s of [1, -1] as const) bumperBand(s, (s > 0 ? yNF : yNR) - .1, (s > 0 ? yNF : yNR) - .02, .045, M.chrome, 1.12);
  else if (fc.bumper === 'black') for (const s of [1, -1] as const) bumperBand(s, p.clr + .05, s > 0 ? yNF + .03 : yNR - .04, .02, M.trim);
  else for (const s of [1, -1] as const) { const y = (s > 0 ? yNF : yNR) + .045; fill(s, roundRect(-fw * 1.18, fw * 1.18, y - .0025, y + .0025, .002), .0015, M.dark, null); }
  if (!E.classic && era >= 2000) fill(1, roundRect(-fw * .75, fw * .75, p.clr + .015, p.clr + .045, .01), .012, M.gloss, M.gloss); // 앞 아래 립
  if (p.suv || p.bed != null) for (const s of [1, -1] as const) fill(s, roundRect(-fw * .45, fw * .45, p.clr + .03, p.clr + .1, .015), .014, M.rim, M.gloss); // 스키드 플레이트
  // 번호판·엠블럼
  const pz = fc.plateF === 'offset' ? fw * .4 : 0;
  fill(1, roundRect(pz - .26, pz + .26, plateY0, plateY1, .008), .008, M.plate, M.gloss);
  const emblem = (s: 1 | -1, y: number) => { frame(s, ellipse(0, y, .034, .026, 18), .008, .012, evV ? M.accent : M.chrome); fill(s, ellipse(0, y, .026, .018, 18), .008, M.chrome, null); };
  if (!E.classic) emblem(1, ev || fc.grille === 'none' ? lampY : Math.max(plateY1 + .05, Math.min(lampY, lampTop - .03)));

  // ── 뒷모습 ──
  const deckR = B.yDR - .03, tailH = Math.min(.12, Math.max(.06, (deckR - yNR) * .38)), tailY = deckR - tailH / 2 - .015 + fc.tailDy;
  const rearHatch = !p.deck && p.bed == null;
  const tl = (ol: P2[], inner?: P2[]) => { pairFill(-1, ol, .008, M.tailLens, M.gloss); if (inner) pairFill(-1, inner, .011, M.tail, null); };
  let tailIn = .55, tailTop = tailY + tailH / 2;
  const T0 = tailY - tailH / 2, T1 = tailY + tailH / 2;
  switch (fc.tail) {
    case 'vertical': { const y0 = tailY - tailH * 1.4, y1 = T1; tl(roundRect(fw * .86, fw * 1.14, y0, y1, .02), roundRect(fw * .9, fw * 1.1, y1 - (y1 - y0) * .4, y1 - .012, .01)); tailIn = .86; break; }
    case 'L': tl([[fw * .5, T1 - tailH * .5], [fw * 1.16, T1 - tailH * .5], [fw * 1.16, T0 - tailH * .7], [fw * .98, T0 - tailH * .7], [fw * .98, T1 - tailH * .05], [fw * .5, T1]].reverse() as P2[], roundRect(fw * .55, fw * 1.1, T1 - tailH * .4, T1 - tailH * .15, .005)); tailIn = .5; break;
    case 'split': tl(roundRect(fw * .82, fw * 1.15, T0, T1, .015), roundRect(fw * .86, fw * 1.1, tailY - tailH * .15, tailY + tailH * .2, .006)); if (p.deck || rearHatch) tl(roundRect(fw * .5, fw * .78, T0 + tailH * .2, T1, .012)); tailIn = .5; break;
    case 'full': tl(roundRect(fw * .5, fw * 1.15, T0, T1, .015), roundRect(fw * .55, fw * 1.1, tailY, tailY + tailH * .28, .006)); fill(-1, roundRect(-fw * .5, fw * .5, T1 - .022, T1 - .004, .004), .009, M.tail, M.gloss); tailIn = .5; break;
    case 'round': for (const zc of [.64, .86]) { const r = Math.min(.06, tailH * .62); pairFrame(-1, ellipse(fw * zc, tailY, r + .01, r + .01, 18), .012, .012, M.chrome); pairFill(-1, ellipse(fw * zc, tailY, r, r, 18), .01, M.tail, null); } tailIn = .55; tailTop = tailY + .07; break;
    case 'pixel': fill(-1, roundRect(-fw * 1.12, fw * 1.12, T0 + tailH * .2, T1 - tailH * .2, .01), .008, M.tailLens, M.gloss); for (let i = 0; i < 7; i++) { const z = .42 + i * .1; pairFill(-1, roundRect(fw * z, fw * (z + .06), T0 + tailH * .32, T1 - tailH * .32, .002), .011, M.tail, null); } tailIn = .4; break;
    default: tl(roundRect(fw * .6, fw * 1.14, T0, T1, .015), roundRect(fw * .66, fw * 1.08, tailY - tailH * .12, tailY + tailH * .18, .006));
  }
  if (ev && fc.tail !== 'full' && fc.tail !== 'pixel') fill(-1, roundRect(-fw * tailIn, fw * tailIn, T1 - .02, T1 - .006, .004), .009, M.tail, M.gloss);
  if (!E.classic) emblem(-1, Math.min(tailTop + .05, deckR - .045));
  const ry0 = fc.plateR === 'high' ? Math.max(T0 - .17, yNR + .02) : Math.max(p.clr + .1, yNR - .14);
  fill(-1, roundRect(-.29, .29, ry0 - .015, ry0 + .125, .015), .003, M.gloss, null); // 번호판 자리(오목한 어두운 판)
  fill(-1, roundRect(-.26, .26, ry0, ry0 + .11, .008), .007, M.plate, M.gloss);
  if (!E.classic) fill(-1, roundRect(-fw * .7, fw * .7, p.clr + .02, p.clr + .075, .015), .01, M.trim, M.trim); // 뒤 아래 디퓨저
  // 트렁크 덮개 선(옆·뒤)
  if (p.deck && p.bed == null) {
    const zl = B.zIn0(xdMid()) - .01;
    for (const g of [1, -1]) topRibbon(lineX(B.xd + .03, -h + E.endT * .55, () => g * zl, .05), .0025, .0015, M.dark);
    topRibbon(lineX(-zl, zl, () => B.xd + .03, .05).map(q => [q[1], q[0]] as P2), .0025, .0015, M.dark, false);
  }
  function xdMid() { return (B.xd + -h) / 2; }
  if (rearHatch) { const y = deckR + .01; fill(-1, roundRect(-fw * .95, fw * .95, y - .002, y + .002, .002), .0015, M.dark, null); } // 뒷문 아래 선

  // ── 보닛 선: 펜더와 보닛 사이 ──
  if (p.bed == null || true) {
    const zl = B.zIn0(B.xc + .1) - .02;
    for (const g of [1, -1]) topRibbon(lineX(B.xc + .02, h - E.endT * .7, () => g * zl * (1 - .0), .05), .0025, .0015, M.dark);
  }
  // ── 문 이음선: 옆판(로커 위 ~ 어깨), 위는 온실 창틀이 잇는다 ──
  for (const xd0 of p.doors) {
    if (Math.abs(xd0) > h - .2) continue;
    const r = B.ring(xd0), y0 = r.P[KS.lip * 2] + .01, y1 = r.ys - .005;
    sideRibbon(lineX(y0, y1, () => xd0, .04).map(q => [q[1], q[0]] as P2), .002, .0015, M.dark, true);
  }
  // 문 아래 선(문턱 위)
  { const xa = p.doors[p.doors.length - 1], xb = p.doors[0], y = B.ring(0).P[KS.lip * 2] + .012; if (xb > xa) sideRibbon(lineX(xa, xb, () => y), .002, .0015, M.dark); }
  // ── 손잡이 ──
  for (let i = 1; i < p.doors.length; i++) {
    const x = p.doors[i] + .12, y = B.beltLine(x) - .085;
    if (era >= 2020) sideRibbon(lineX(x - .07, x + .07, () => y, .035), .006, .002, M.gloss);
    else sideRibbon(lineX(x - .07, x + .07, () => y, .035), .009, .007, M.chrome);
  }
  // ── 캐릭터 라인: 위는 빛, 아래는 그늘(법선만 기울인 얇은 띠 2장) ──
  const yLip = B.ring(0).P[KS.lip * 2];
  if (sd.crease.length) {
    const cp: number[] = [], cn: number[] = [], ci: number[] = [];
    for (const t of sd.crease) for (const sgn of [1, -1]) for (const [d0, d1, ny] of [[0, .01, .55], [-.01, 0, -.5]] as const) {
      let run: number[] = [];
      const flush = () => { for (let j = 0; j + 2 < run.length; j += 2) { const a = run[j], b = run[j + 1]; if (sgn > 0) ci.push(a, b, a + 2, b, b + 2, a + 2); else ci.push(a, a + 2, b, b, a + 2, b + 2); } run = []; };
      for (let x = -h + .5; x <= h - .5; x += .05) {
        const r = B.ring(x), yc = yLip + (r.ys - yLip) * (.35 + .45 * t) + sd.kick * (h - x) / p.L;
        if (r.arch && yc - .03 < B.archAt(x) + .03 || yc > r.ys - .04) { flush(); continue; }
        const nz = Math.sqrt(1 - ny * ny);
        for (const y of [yc + d1, yc + d0]) { run.push(cp.length / 3); cp.push(x, y, sgn * (B.sideZ(x, y) + .0025)); cn.push(0, ny, sgn * nz); }
      }
      flush();
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3)); cg.setIndex(ci);
    add(cg, M.crease).castShadow = false;
  }
  if (sd.strip !== 'none') sideRibbon(lineX(-h + .45, h - .45, x => yLip + (B.ring(x).ys - yLip) * .38).filter(q => !B.archAt(q[0]) || q[1] > B.archAt(q[0]) + .04), .012, .004, sd.strip === 'chrome' ? M.chrome : M.trim);

  // ── 휠 아치 테(펜더 립): SUV·픽업·클래딩은 넓은 검은 테, 나머지는 얇은 차체색 테 ──
  const flareW = sd.clad || p.suv || p.bed != null ? Math.max(.05, p.archTrim) : gt ? .05 : .022, flareMat = sd.clad || p.suv || p.bed != null || gt ? M.trim : M.paint, flareE = flareMat === M.paint ? .007 : .016;
  for (const xw of [-p.wb, p.wb]) pair(g => {
    const b = bin(flareMat), rows: number[][] = [[], [], []];
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t = Math.PI * (.02 + .96 * i / n), c = Math.cos(t), s2 = Math.sin(t);
      const yTop = (x: number) => B.ring(x).ys - .02;
      for (const [j, rr, e] of [[0, p.archR - .004, flareE * .6], [1, p.archR + flareW * .45, flareE], [2, p.archR + flareW, 0]] as const) {
        const x = xw + c * rr, y = Math.min(p.archY + s2 * rr, yTop(x));
        rows[j].push(vert(b, [x, y, g * (B.sideZ(x, Math.max(y, yLip + .01)) + e + .0015)]));
      }
    }
    for (let j = 0; j < 2; j++) for (let i = 0; i < n; i++) { const out = [0, 0, g]; triOut(b, rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], out); triOut(b, rows[j][i], rows[j + 1][i + 1], rows[j][i + 1], out); }
  });

  // ── 사이드 미러: 위에서 본 날개 모양을 위아래로 뽑아 모서리를 둥글린 하우징 + 뒤 거울 + 짧은 다리 ──
  {
    const mx = B.xc - .16, my = B.beltLine(mx) + .06, mz = B.zIn0(mx) - .01, L = id === 'kei' ? .09 : .11, D = .07, Hh = id === 'kei' || sporty ? .055 : tall ? .085 : .068;
    const sh = new THREE.Shape(); // 위에서 본 모양(x 앞뒤, y 바깥쪽)
    sh.moveTo(-D * .35, 0); sh.bezierCurveTo(D * .45, 0, D * .55, L * .55, D * .25, L); sh.lineTo(-D * .45, L * .96); sh.lineTo(-D * .45, 0); sh.closePath();
    const mg = new THREE.ExtrudeGeometry(sh, { depth: Hh, bevelEnabled: true, bevelThickness: .012, bevelSize: .01, bevelSegments: 2, curveSegments: 8 });
    mg.translate(0, 0, -Hh / 2); mg.rotateX(Math.PI / 2); // 뽑은 방향을 위아래로
    const gl = new THREE.BoxGeometry(.006, Hh * .85, L * .82), stem = new THREE.BoxGeometry(.05, .03, .07);
    pair(g => {
      const m = add(mg, sporty || era >= 2010 ? M.paint : M.gloss, mx, my, g * (mz + .05)); m.scale.z = g; m.rotation.y = g * .08;
      add(gl, M.glass, mx - D * .47, my, g * (mz + .05 + L * .48));
      add(stem, M.gloss, mx + .005, my - Hh * .42, g * (mz + .03));
    });
      }

  // ── 휠하우스: 아래 몸통 단면 홈이 벽·천장. 여기서는 바퀴 뒤쪽 어두운 막(안쪽이 비어 보이지 않게) ──
  // ── 지붕: 루프랙 ──
  const rx0 = B.cR + .12, rx1 = p.cF - .1;
  if ((sd.rack || look.variant === 'wagon') && rx1 - rx0 > .5) { // 왜건은 늘 루프 레일
    const zr = B.gRing((rx0 + rx1) / 2).Q[7 * 2 + 1] * .86, lx = [rx0 + .06, rx1 - .06], ly = Math.max(...lx.map(x => B.topY(x, zr))) + .05;
    pair(g => {
      add(new THREE.BoxGeometry(rx1 - rx0, .022, .03), M.gloss, (rx0 + rx1) / 2, ly, g * zr);
      for (const x of lx) { const y0 = B.topY(x, zr); add(new THREE.BoxGeometry(.06, ly - y0 + .01, .035), M.gloss, x, (ly + y0) / 2, g * zr); }
    });
  }
  // ── 스포일러·배기구 ──
  if (look.sporty || p.spoiler) {
    const sx = p.deck ? -h + (gt ? .24 : .2) : B.cR - (gt ? .1 : .06), zl = hw - .42, sy = p.deck ? B.topY(sx, 0) + (gt ? .17 : .08) : Math.max(B.topY(sx, 0), B.topY(sx, zl));
    const ww = p.W - (gt ? .26 : .42), wc = gt ? .3 : .2;
    add(new THREE.BoxGeometry(wc, gt ? .035 : .028, ww), M.dark, sx, sy, 0);
    if (gt) pair(sgn => add(new THREE.BoxGeometry(wc + .02, .09, .014), M.dark, sx, sy - .02, sgn * ww / 2));
    if (p.deck) pair(sgn => { const y0 = B.topY(sx + .03, zl) - .015; add(new THREE.BoxGeometry(.05, sy - y0, .04), M.dark, sx + .03, (sy + y0) / 2, sgn * zl); });
  }
  if (!ev) { // 배기구: 뒤 범퍼 아래(스포티·고성능판은 크고 2개씩)
    const big = look.sporty || gt, r = big ? .042 : .03, zs = gt ? [.36, .5] : big ? [.48] : [.52];
    const tip = new THREE.CylinderGeometry(r, r, .1, 16, 1, true), cap = new THREE.CircleGeometry(r * .78, 16);
    pair(g => { if (!big && g < 0) return; for (const z of zs) { const H = at(-1, g * z * fw, p.clr + .05), x = (H ? H.p[0] : -h) + .02; const t = add(tip, M.chrome, x, p.clr + .045, g * z * fw); t.rotation.z = Math.PI / 2; const c = add(cap, M.dark, x - .045, p.clr + .045, g * z * fw); c.rotation.y = -Math.PI / 2; } });
  }
  if (gt) { // 고성능판 에어로: 사이드 스커트, 뒤 디퓨저 지느러미, 보닛 통풍구
    const sx0 = -p.wb + p.archR + .03, sx1 = p.wb - p.archR - .03;
    if (sx1 > sx0) sideRibbon(lineX(sx0, sx1, () => yLip + .02), .022, .02, M.gloss);
    const rx = at(-1, 0, p.clr + .05);
    for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(.2, .08, .012), M.dark, (rx ? rx.p[0] : -h) + .09, p.clr + .04, i * fw * .14);
    const vx1 = h - E.endT - .15, vx0 = Math.max(B.xc + .12, vx1 - .3);
    if (vx1 - vx0 > .12 && p.bed == null) for (const g of [1, -1]) for (let k = 0; k < 3; k++) topRibbon(lineX(vx0, vx1, () => g * hw * (.2 + k * .055)), .012, .004, M.gloss);
  }
  if (evV) { // 1.5.0 전기차판: 옆 하단 청록 줄, 앞뒤 아래 청록 줄, 충전구
    sideRibbon(lineX(-h + .5, h - .5, () => yLip + (sd.clad ? .1 : .05)).filter(q => !B.archAt(q[0])), .012, .004, M.accent);
    for (const s of [1, -1] as const) fill(s, roundRect(-fw * .62, fw * .62, p.clr + .09, p.clr + .112, .006), .012, M.accent, null);
    const cx = p.wb - p.archR - .14, cy = B.beltLine(cx) - .1;
    sideRibbon(lineX(cx - .06, cx + .06, () => cy, .03), .04, .003, M.trim); sideRibbon(lineX(cx - .02, cx + .02, () => cy, .02), .012, .006, M.accent);
  }
  // ── 차종 고유 ──
  if (p.bed != null) { // 픽업: 짐칸 벽 위 레일, 꼬리문 선
    const P = B.ring((B.bedF + B.bedB) / 2).P, yw = P[13 * 2], zw = P[13 * 2 + 1] - .03;
    pair(g => add(new THREE.BoxGeometry(B.bedF - B.bedB - .04, .018, .05), M.gloss, (B.bedF + B.bedB) / 2, yw + .008, g * zw));
    const ty = yw - .04; fill(-1, roundRect(-fw * 1.05, fw * 1.05, ty - .0025, ty + .0025, .002), .0015, M.dark, null);
  }
  if (id === 'minivan') sideRibbon(lineX(p.doors[p.doors.length - 1] - .02, p.doors[1] + .3, () => B.beltLine(0) - .03), .008, .004, M.gloss); // 슬라이딩 도어 레일
  if (id === 'sports') sideRibbon(lineX(-p.wb + p.archR + .12, -p.wb + p.archR + .42, () => yLip + (B.ring(-p.wb + p.archR + .25).ys - yLip) * .5), .035, .002, M.gloss); // 뒷바퀴 앞 흡기구
  if (id === 'hatch' && !look.sporty) { const x = B.cR - .02, zw = B.gRing(x).Q[7 * 2 + 1] * .95; add(new THREE.BoxGeometry(.12, .025, 2 * zw), M.paint, x - .02, B.roofAt(x) + .006, 0); } // 지붕 끝 립 스포일러

  // ── 바퀴: 옆면이 평평한 타이어 + 림(살 사이가 뚫린 판) + 브레이크 디스크 ──
  const R = p.wr, rimR = R * RIM_RATIO[look.wheel ?? 1], ht = tw / 2, shR = Math.min(.028, R * .09), wk: WheelKind = fc.wheel;
  const tire = new THREE.LatheGeometry(([[rimR + .004, -ht * .82], [rimR + .014, -ht], [R - shR, -ht - .004], [R - shR * .3, -ht + shR * .3], [R, -ht + shR], [R, ht - shR], [R - shR * .3, ht - shR * .3], [R - shR, ht + .004], [rimR + .014, ht], [rimR + .004, ht * .82]] as [number, number][]).map(q => new THREE.Vector2(q[0], q[1])), 40);
  const barrel = new THREE.LatheGeometry([[rimR * .96, ht * .62], [rimR * .96, -ht * .8]].map(q => new THREE.Vector2(q[0], q[1])), 32);
  const lip = new THREE.LatheGeometry([[rimR * .9, ht * .66], [rimR * .98, ht * .86], [rimR + .006, ht * .84], [rimR + .006, ht * .6]].map(q => new THREE.Vector2(q[0], q[1])), 40);
  // 림 판: 원판에서 살 사이 창을 뚫는다
  const face = new THREE.Shape(); face.absarc(0, 0, rimR * .91, 0, Math.PI * 2, false);
  const hole = (a: number, r0: number, r1: number, w0: number, w1: number, skew = 0, n = 5) => {
    const pts: THREE.Vector2[] = [], h0 = Math.max(.02, w0), h1 = Math.max(.03, w1);
    for (let i = 0; i <= n; i++) { const t = a - h1 + 2 * h1 * i / n + skew; pts.push(new THREE.Vector2(r1 * Math.cos(t), r1 * Math.sin(t))); }
    for (let i = 0; i <= n; i++) { const t = a + h0 - 2 * h0 * i / n; pts.push(new THREE.Vector2(r0 * Math.cos(t), r0 * Math.sin(t))); }
    face.holes.push(new THREE.Path(pts));
  };
  const spokeHoles = (n: number, sw: number, r0: number, r1: number, skew = 0, a0 = 0) => { for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI * 2; hole(a + Math.PI / n, r0 * rimR, r1 * rimR, Math.PI / n - Math.asin(Math.min(.9, sw * rimR / 2 / (r0 * rimR))), Math.PI / n - Math.asin(Math.min(.9, sw * rimR / 2 / (r1 * rimR))), skew); } };
  let open = true, faceMat: THREE.Material = M.rim;
  switch (wk) {
    case 'spoke5': spokeHoles(5, .22, .34, .84); break;
    case 'twin5': spokeHoles(5, .34, .34, .84); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; hole(a, .42 * rimR, .8 * rimR, .035, .04, 0, 2); } break;
    case 'multi': spokeHoles(10, .1, .38, .85); break;
    case 'mesh': spokeHoles(14, .07, .58, .86); spokeHoles(14, .07, .32, .52, 0, Math.PI / 14); break;
    case 'turbine': spokeHoles(9, .14, .36, .84, .32); break;
    case 'steel': for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2, pth = new THREE.Path(); pth.absarc(.66 * rimR * Math.cos(a), .66 * rimR * Math.sin(a), .07 * rimR, 0, Math.PI * 2, true); face.holes.push(pth); } faceMat = M.dark; break;
    case 'aero': spokeHoles(5, .62, .7, .86); faceMat = M.rim; break;
    case 'cover': for (let i = 0; i < 3; i++) hole(i / 3 * Math.PI * 2, .3 * rimR, .78 * rimR, .025, .02, .25, 3); faceMat = M.rim; open = false; break;
  }
  const faceGeo = new THREE.ExtrudeGeometry(face, { depth: .016, bevelEnabled: true, bevelThickness: .006, bevelSize: .005, bevelSegments: 1, curveSegments: 28 });
  faceGeo.rotateX(-Math.PI / 2); // 판의 앞(+z)을 바퀴 바깥(+y)으로
  const capGeo = new THREE.CylinderGeometry(rimR * (wk === 'steel' ? .46 : .17), rimR * (wk === 'steel' ? .5 : .2), .03, 24);
  const rotor = new THREE.CylinderGeometry(rimR * .68, rimR * .68, .02, 28), hat = new THREE.CylinderGeometry(rimR * .3, rimR * .3, .05, 16), caliper = new THREE.BoxGeometry(rimR * .48, .05, rimR * .2);
  const back = new THREE.CircleGeometry(rimR * .95, 24); back.rotateX(Math.PI / 2);
  for (const [ai, x] of [[0, -p.wb], [1, p.wb]] as const) for (const sgn of [1, -1]) {
    const w = new THREE.Group(); w.position.set(x, p.wr, sgn * B.tireZ[ai]); w.rotation.x = sgn * Math.PI / 2; carG.add(w);
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, y = 0) => { const mm = new THREE.Mesh(g, mat); mm.position.y = y; mm.castShadow = true; w.add(mm); return mm; };
    part(tire, M.tire); part(barrel, M.dark); part(lip, evV ? M.accent : faceMat === M.dark ? M.dark : M.rim);
    part(faceGeo, faceMat, ht * .42);
    part(back, M.dark, -ht * .55).castShadow = false;
    part(capGeo, wk === 'steel' ? M.chrome : evV ? M.accent : M.rim, ht * .42 + .02);
    if (open) { part(rotor, M.rotor, ht * .1); part(hat, M.rotor, ht * .2); const cp = part(caliper, look.sporty || gt ? M.caliper : M.dark, ht * .12); cp.position.set(-rimR * .2, ht * .12, -sgn * rimR * .6); }
  }

  for (const [mat, b] of bins) {
    if (!b.idx.length) continue;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setIndex(b.idx); g.computeVertexNormals();
    add(g, mat).castShadow = mat !== M.dark && mat !== M.crease;
  }
  carG.userData.decalMiss = miss;
  return carG;
}
