import * as THREE from 'three';
import type { CarLook } from './look';
import { FACE, RIM_RATIO, eraStyle, type WheelKind } from './shapes';
import { chassisOf, faceOf } from './variant';

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
}

// 데칼(표면에 붙인 얇은 면)이 차체와 깊이 싸움을 하지 않게 앞으로 당긴다
const decalOpts = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 };

export function createCarMaterials(color: string): CarMaterials {
  const std = THREE.MeshStandardMaterial, pp = { metalness: .3, roughness: .4, envMapIntensity: .75, clearcoat: 1, clearcoatRoughness: .06 };
  const paint = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), ...pp }), crease = new THREE.MeshPhysicalMaterial({ ...pp, ...decalOpts });
  crease.color = paint.color; // 무대가 차체색을 바꾸면(paint.color.lerp) 함께 바뀐다
  return {
    paint, crease,
    glass: new THREE.MeshPhysicalMaterial({ color: 0x24303c, metalness: .45, roughness: .07, envMapIntensity: 1.1, clearcoat: .6 }), // 짙은 청회색 + 약한 반사
    tire: new std({ color: 0x121417, roughness: .92 }),
    rim: new std({ color: 0xd4d9e0, metalness: .95, roughness: .22 }),
    dark: new std({ color: 0x15181c, roughness: .6, metalness: .3 }),
    trim: new std({ color: 0x0e1013, roughness: .8, side: THREE.DoubleSide, ...decalOpts }),
    lamp: new std({ color: 0xffffff, emissive: 0xfff3d0, emissiveIntensity: 1.4, ...decalOpts }),
    tail: new std({ color: 0xc00000, emissive: 0xd00000, emissiveIntensity: .7, ...decalOpts }),
    chrome: new std({ color: 0xeef1f4, metalness: 1, roughness: .12, ...decalOpts }),
    plate: new std({ color: 0xf4f5f2, roughness: .5, ...decalOpts }),
  };
}

export function disposeCar(group: THREE.Object3D): void {
  group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}

/* 차체: 앞뒤 방향으로 단면(고리)을 185장 세워 이어 붙인 곡면(데모 방식).
   ring(x)를 함수로 빼 두어 얼굴 데칼·도어 선·아치 테를 같은 곡면 위에 정확히 붙인다. */
export function buildCar(look: CarLook, M: CarMaterials): THREE.Group {
  const carG = new THREE.Group();
  const p = chassisOf(look), fc = faceOf(look), sd = p.side;
  const E0 = eraStyle(look), ek = p.edge ?? 1, E = { ...E0, re: E0.re * ek, rpF: E0.rpF * ek, rpR: E0.rpR * ek };
  const ev = look.powertrain === 'ev', F = FACE;
  let decalMiss = 0; // 데칼 점이 차체 곡면을 못 찾은 횟수(검사용, 0이어야 정상)
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; carG.add(m); return m;
  };
  const h = p.L / 2, hw = p.W / 2, NU = 184, J = 32, RN = 2 * J, ar = p.archR, ay = p.archY, mid = (p.cR + p.cF) / 2;
  const ym = p.clr + (p.belt - p.clr) * .55;
  const pils = (p.pil ?? [.5]).map(t => p.cR + (p.cF - p.cR) * t); // 옆 창을 나누는 필러 x
  // 픽업 짐칸: 객실 뒤 벽부터 꼬리문(끝 둥글림 + .1m) 앞까지
  const bedF = p.cR - p.rr - .1, bedB = -h + E.re + .1, bedAt = (x: number) => p.bed != null && x > bedB && x < bedF;

  // 옆모습 윗선: 꺾은선을 찍고 두 번 문질러 둥글린다
  const ctl = [[-h, p.belt - .02], [p.cR - p.rr - .08, p.belt + .03], [p.cR, p.roof], [mid, p.roof + .025], [p.cF, p.roof], [p.cF + p.rf, p.belt + .04], [h - .55, p.belt - .05], [h, p.belt - (p.nose ?? .2)]];
  const lin = (x: number) => {
    for (let i = 1; i < ctl.length; i++) if (x <= ctl[i][0]) { const [x0, y0] = ctl[i - 1], [x1, y1] = ctl[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return ctl[ctl.length - 1][1];
  };
  // 윗선은 고른 격자(NU)에서 문지르고, 곡면 고리는 아치·앞뒤 끝에서만 촘촘하게 놓는다(삼각형 수 절약)
  let Ts = Array.from({ length: NU + 1 }, (_, i) => lin(Math.max(-h + .004, Math.min(h - .004, -h + p.L * i / NU))));
  for (let k = 0; k < E.smooth; k++) Ts = Ts.map((_, i) => { let a = 0; for (let j = -4; j <= 4; j++) a += Ts[Math.max(0, Math.min(NU, i + j))]; return a / 9; });
  const Tat = (x: number) => { const f = Math.max(0, Math.min(NU, (x + h) / p.L * NU)), i = Math.min(NU - 1, Math.floor(f)); return Ts[i] + (Ts[i + 1] - Ts[i]) * (f - i); };
  const archEdges = [-p.wb - ar, -p.wb + ar, p.wb - ar, p.wb + ar];
  const brk = [...archEdges.flatMap(e => [e - .003, e + .003]), ...pils.flatMap(px => [px - .062, px - .045, px + .045, px + .062]), ...(p.bed != null ? [bedB, bedF] : [])];
  let xs: number[] = [];
  for (let x = -h + .004; x < h - .004;) {
    xs.push(x);
    const near = Math.min(...archEdges.map(e => Math.abs(x - e))), d = Math.min(x + h, h - x);
    x += near < .09 || d < E.re + .06 ? .024 : .08;
  }
  xs.push(h - .004);
  xs = [...xs, ...brk.filter(x => Math.abs(x) < h - .01)].sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > .004 || i === a.length - 1);
  const N = xs.length - 1;

  // 단면 반쪽(z≥0): [y0,z0,y1,z1,…] 33점. 바닥 가운데 → 옆 → 지붕 가운데
  const ringMemo = new Map<number, { P: number[]; g: number; ys: number; T: number }>(); // 같은 x 단면을 여러 장식이 다시 찾는다
  const ring = (x: number) => { let r = ringMemo.get(x); if (!r) ringMemo.set(x, r = ring0(x)); return r; };
  const ring0 = (x: number) => {
    const d = Math.min(x + h, h - x);
    let arch = 0;
    for (const xw of [-p.wb, p.wb]) { const dx = Math.abs(x - xw); if (dx < ar) arch = ay + Math.sqrt(ar * ar - dx * dx); }
    let yb = Math.max(p.clr, arch, d < .4 ? p.clr + E.chin * (1 - d / .4) ** 2 : 0), ys = p.belt + .03 - p.wedge * (x + h) / p.L, T = Tat(x); // 앞뒤 끝은 바닥을 말아 올린다(턱)
    // 부푼 펜더(fenders): 옆 윗선만 아치 위로 솟고 보닛 가운데는 낮게 남아 펜더 사이가 골이 된다
    const fen = p.fenders && arch ? arch + .08 : 0;
    if (arch && !p.fenders) ys = Math.max(ys, arch + .08);
    T = Math.max(T, ys + .09);
    const e = d < E.re ? Math.sqrt(1 - (1 - d / E.re) ** 2) : 1;
    T = ym + (T - ym) * e; yb = ym - (ym - yb) * e;
    const y0 = ym - (ym - p.clr) * e; // 옆판 최소 높이는 아치가 아닌 차체 바닥 기준(아치 위 창틀이 솟지 않게)
    ys = Math.max(Math.min(ys, T - .09 * e), y0 + .35 * (T - y0), fen);
    const rp = x > 0 ? E.rpF : E.rpR;
    let w = hw * (1 - E.taper * (x / h) ** 4) + .018 * Math.exp(-(((Math.abs(x) - p.wb) / .4) ** 2));
    if (d < rp) w -= rp - Math.sqrt(rp * rp - (rp - d) ** 2);
    w = Math.max(w, .05);
    // wS: 옆판 윗끝 폭(배부른 옆판이면 안쪽), 그 위 옆 유리는 시대별 텀블홈만큼 안쪽으로 눕는다
    const bow = E.bow * e, wS = w - bow, g = T - ys, gg = Math.max(g, .03), ledge = Math.min(.035, gg * .3), wroof = Math.max(.06, wS - ledge - E.tumble * Math.max(0, g - .09));
    const rc = Math.min(E.rc, gg * .6, wroof * .6), rb = Math.min(E.rb, (ys - yb) * .3), tuck = E.tuck * e, wB = w - tuck - bow;
    const P: number[] = [];
    for (const f of [0, .33, .66, 1]) P.push(yb, (wB - rb) * f);
    for (const a of [Math.PI / 6, Math.PI / 3]) P.push(yb + rb - rb * Math.cos(a), wB - rb + rb * Math.sin(a));
    for (let k = 0; k <= 10; k++) { const u = k / 10; P.push(yb + rb + u * (ys - yb - rb), w - tuck * (1 - u) ** 2 - bow * (2 * u - 1) ** 2); }
    if (bedAt(x)) { // 짐칸 단면: 옆 → 벽 윗면 → 안쪽 벽 → 바닥(뒷바퀴 위에서는 바닥이 솟아 휠하우스가 된다)
      const yw = Math.min(T, ys + .1), zi = wS - .07, yf = Math.min(Math.max(p.bed!, yb + .06), yw - .06);
      P.push(ys + (yw - ys) * .5, wS - .004, yw - .012, wS - .01, yw, wS - .03, yw, zi + .012);
      for (let k = 0; k <= 4; k++) P.push(yw - .02 - (yw - .05 - yf) * k / 4, zi);
      P.push(yf, zi - .03);
      for (let k = 0; k <= 5; k++) P.push(yf, (zi - .06) * (1 - k / 5));
      return { P, g: 0, ys, T };
    }
    const b0 = ys + ledge * .8, b1 = Math.max(b0, T - rc);
    for (let k = 0; k <= 6; k++) { const u = k / 6; P.push(b0 + u * (b1 - b0), wS - ledge + u * (wroof - wS + ledge)); }
    for (const a of [Math.PI / 8, Math.PI / 4, Math.PI * 3 / 8]) P.push(b1 + rc * Math.sin(a), wroof - rc + rc * Math.cos(a));
    const wt = wroof - rc, crown = E.crown * e * (.4 + .6 * Math.min(1, Math.max(0, g) / .3)), valley = Math.max(0, b1 + rc - T - crown);
    for (let k = 0; k <= 5; k++) { const z = wt * (1 - k / 5), q = (z / wt) ** 2; P.push(T + crown * (1 - q) + valley * q, z); }
    return { P, g, ys, T };
  };
  // (y,|z|)가 단면 안에 있는가(반쪽 다각형. 첫 점과 끝 점이 축 위라 축으로 닫힌다)
  const inside = (P: number[], y: number, z: number) => {
    z = Math.abs(z); let c = false;
    for (let i = 0, j = J; i <= J; j = i++) {
      const yi = P[i * 2], zi = P[i * 2 + 1], yj = P[j * 2], zj = P[j * 2 + 1];
      if ((yi > y) !== (yj > y) && z < (zj - zi) * (y - yi) / (yj - yi) + zi) c = !c;
    }
    return c;
  };
  // 앞(+1)·뒤(-1) 끝면의 x: 바퀴 아치 바깥부터 끝까지 이분 탐색
  const loOf = (s: 1 | -1) => Math.max(p.wb + ar + .01, s < 0 && p.bed != null ? -bedB + .005 : 0); // 짐칸 차는 뒤 데칼을 꼬리문에서만 찾는다
  const surfX = (y: number, z: number, s: 1 | -1) => {
    let lo = loOf(s), hi = h - .004;
    if (inside(ring(s * hi).P, y, z)) return s * hi;
    if (!inside(ring(s * lo).P, y, z)) { decalMiss++; return s * lo; }
    for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (inside(ring(s * m).P, y, z)) lo = m; else hi = m; }
    return s * lo;
  };
  // 옆면의 z(그 x 단면에서 높이 y의 옆 점을 보간)
  const sideZ = (x: number, y: number) => {
    const P = ring(x).P;
    for (let k = 4; k <= 22; k++) if (P[k * 2] >= y) {
      const y0 = P[k * 2 - 2], y1 = P[k * 2];
      return y1 - y0 < 1e-6 ? P[k * 2 + 1] : P[k * 2 - 1] + (P[k * 2 + 1] - P[k * 2 - 1]) * (y - y0) / (y1 - y0);
    }
    return P[22 * 2 + 1];
  };
  // 앞뒤 끝면에 붙는 데칼: 평면 도형(x→가로, y→높이)을 곡면에 투영
  const decal = (geo: THREE.BufferGeometry, mat: THREE.Material, s: 1 | -1, lift: number = F.lift) => {
    const pa = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const gz = pa.getX(i), gy = pa.getY(i); pa.setXYZ(i, surfX(gy, gz, s), gy, -s * gz); }
    // 곡면의 법선 방향으로 띄운다(아래로 말려 들어가는 범퍼 끝에서도 차체에 묻히지 않게)
    geo.computeVertexNormals();
    const na = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const sn = na.getX(i) * s < 0 ? -1 : 1; // 감김과 상관없이 바깥(앞이면 +x) 쪽으로
      pa.setXYZ(i, pa.getX(i) + sn * na.getX(i) * lift, pa.getY(i) + sn * na.getY(i) * lift, pa.getZ(i) + sn * na.getZ(i) * lift);
    }
    geo.computeVertexNormals();
    return add(geo, mat);
  };
  // 평면 격자를 f(u,v)→[가로,높이]로 휘어 만든 도형(곡면에 투영되도록 잘게 나눈다). 감김 방향은 PlaneGeometry와 같게 맞춘다
  const grid = (sz: number, sy: number, f: (u: number, v: number) => number[]) => {
    const vs: number[] = [], ix: number[] = [], [za, ya] = f(.4, .5), [zb, yb] = f(.6, .5), [zc, yc] = f(.4, .6);
    const flip = (zb - za) * (yc - ya) - (yb - ya) * (zc - za) < 0;
    for (let iy = 0; iy <= sy; iy++) for (let i = 0; i <= sz; i++) { const [z, y] = f(i / sz, 1 - iy / sy); vs.push(z, y, 0); }
    for (let iy = 0; iy < sy; iy++) for (let i = 0; i < sz; i++) {
      const a = i + (sz + 1) * iy, b = a + sz + 1, c = b + 1, d = a + 1;
      if (flip) ix.push(a, d, b, b, d, c); else ix.push(a, b, d, b, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vs, 3)); g.setIndex(ix); return g;
  };
  const rect = (z0: number, z1: number, y0: number, y1: number, sz = 6, sy = 3) => grid(sz, sy, (u, v) => [z0 + (z1 - z0) * u, y0 + (y1 - y0) * v]);
  const ellipse = (zc: number, yc: number, rz: number, ry = rz) => grid(20, 2, (u, v) => [zc + rz * v * Math.cos(u * 6.2832), yc + ry * v * Math.sin(u * 6.2832)]);
  const circle = ellipse;
  const pair = (fn: (sg: number) => void) => { fn(1); fn(-1); };

  // ── 차체 곡면 ──
  const pos: number[] = [], gs: number[] = [], yss: number[] = [], tops: number[] = [];
  for (let i = 0; i <= N; i++) {
    const { P, g, ys, T } = ring(xs[i]);
    for (let k = 0; k <= J; k++) pos.push(xs[i], P[k * 2], P[k * 2 + 1]);
    for (let k = J - 1; k >= 1; k--) pos.push(xs[i], P[k * 2], -P[k * 2 + 1]);
    gs.push(g); yss.push(ys); tops.push(T);
  }
  const vi = (i: number, r: number) => i * RN + (r % RN), idx: number[][] = [[], [], [], []], sill = p.clr + p.sill;
  for (let i = 0; i < N; i++) for (let r = 0; r < RN; r++) {
    const a = vi(i, r), b = vi(i + 1, r), c = vi(i + 1, r + 1), dd = vi(i, r + 1), k = r < J ? r : RN - 1 - r;
    const cx = (pos[a * 3] + pos[b * 3]) / 2, cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[dd * 3 + 1]) / 4;
    const gm = Math.min(gs[i], gs[i + 1]), ysm = Math.max(yss[i], yss[i + 1]), tlo = Math.min(tops[i], tops[i + 1]), thi = Math.max(tops[i], tops[i + 1]);
    const pd = Math.min(...pils.map(px => Math.abs(cx - px)));
    let m = 0;
    if (bedAt(cx) && k >= 19) m = 2; // 짐칸 안쪽 벽·바닥
    else if (k >= 18 && k <= 21 && gm > .22 && pd > .062) m = 1;
    // 앞·뒤 유리: 객실 앞뒤 경사면을 고리의 꼭대기 높이로 고른다(뒤가 곧게 선 SUV·해치백도 유리가 실처럼 얇아지지 않게).
    // 고리 단위로 고르면 유리 위아래 경계가 고리 선을 따라 곧다
    else if (k >= 25 && h - Math.abs(cx) > E.re * .7 && (cx < p.cR + .02 || cx > p.cF - .02) && tlo > ysm + .15 && thi < p.roof - .03 && !bedAt(cx)) m = 1;
    else if (sd.blackPillar && k >= 18 && k <= 24 && gm > .22 && cx < p.cR + .12 && cx > p.cR - p.rr * .8) m = 1; // 검은 뒤 필러(떠 있는 지붕)
    // 창틀: 옆 유리 위아래 한 줄(k17·k22)과 필러 양옆 가는 띠, 유리 앞뒤 끝은 검은 고무. 필러 가운데는 차체색으로 남는다
    else if (k >= 17 && k <= 22 && gm > .19 && (k === 17 || k === 22 || pd > .045 || gm <= .22) && !bedAt(cx)) m = 3;
    else if (h - Math.abs(cx) > E.re && (k <= 5 || (k <= 15 && cy < sill))) m = 2; // 둥근 앞뒤 끝은 범퍼라 차체 색(경계가 고리 선을 따라 매끈)
    idx[m].push(a, b, dd, b, c, dd);
  }
  // 앞뒤 끝 막기
  const c0 = pos.length / 3;
  pos.push(xs[0], ym, 0, xs[N], ym, 0);
  for (let r = 0; r < RN; r++) idx[0].push(c0, vi(0, r), vi(0, r + 1), c0 + 1, vi(N, r + 1), vi(N, r));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  let o = 0;
  idx.forEach((ix, m) => { geo.addGroup(o, ix.length, m); o += ix.length; });
  geo.setIndex(idx.flat());
  geo.computeVertexNormals();
  add(geo, [M.paint, M.glass, M.dark, M.trim]);

  // ── 띠 장식: 같은 개수의 점 줄 두 개(A·B)를 이은 얇은 면. 재질별로 한 메시에 모은다 ──
  const strips = new Map<THREE.Material, { pos: number[]; idx: number[] }>();
  const addStrip = (A: number[][], B: number[][], mat: THREE.Material = M.trim) => {
    let S = strips.get(mat); if (!S) strips.set(mat, S = { pos: [], idx: [] });
    const base = S.pos.length / 3;
    for (const q of [...A, ...B]) S.pos.push(q[0], q[1], q[2]);
    for (let j = 0; j < A.length - 1; j++) { const a = base + j, b = base + A.length + j; S.idx.push(a, b, a + 1, b, b + 1, a + 1); }
  };
  const archTop = (x: number) => { let y = 0; for (const xw of [-p.wb, p.wb]) { const dx = Math.abs(x - xw); if (dx < ar + p.archTrim) y = ay + Math.sqrt((ar + p.archTrim) ** 2 - dx * dx); } return y; };
  // 옆면을 따라가는 가로 띠(x0→x1, 높이 y(x)±hh). 휠 아치 테에 걸리는 구간은 끊는다
  const sideBand = (x0: number, x1: number, y: (x: number) => number, hh: number, mat: THREE.Material, lift = .003) => {
    let A: number[][] = [], B: number[][] = [];
    const flush = () => { if (A.length > 1) for (const sgn of [1, -1]) addStrip(A.map(q => [q[0], q[1], sgn * q[2]]), B.map(q => [q[0], q[1], sgn * q[2]]), mat); A = []; B = []; };
    for (let x = x0; x <= x1 + 1e-6; x += .04) {
      const yc = y(x);
      if (yc - hh < archTop(x) + .015 || bedAt(x)) { flush(); continue; }
      A.push([x, yc + hh, sideZ(x, yc + hh) + lift]); B.push([x, yc - hh, sideZ(x, yc - hh) + lift]);
    }
    flush();
  };
  for (const xd of p.doors) {
    const R0 = ring(xd).P, R1 = ring(xd - F.doorGap).P;
    for (const sg of [1, -1]) {
      const pts = (P: number[], x: number) => { const out: number[][] = []; for (let k = 6; k <= 17; k++) out.push([x, P[k * 2], sg * (P[k * 2 + 1] + F.doorLift)]); return out; };
      addStrip(pts(R0, xd), pts(R1, xd - F.doorGap));
    }
  }
  // ── 휠 아치 테: 아치 원을 따라 옆면에 붙는 반고리 ──
  for (const xw of [-p.wb, p.wb]) {
    const inner: number[][] = [], outer: number[][] = [];
    for (let i = 0; i <= 18; i++) {
      const t = Math.PI * i / 18, c = Math.cos(t), s = Math.sin(t);
      for (const [arr, r] of [[inner, ar + F.archLift], [outer, ar + p.archTrim]] as const) {
        const x = xw + c * r, y = ay + s * r;
        arr.push([x, y, sideZ(x, y) + F.archLift]); // 고리 사이 꺾인 면보다 바깥에 오게 더 띄운다
      }
    }
    for (const sg of [1, -1]) addStrip(inner.map(q => [q[0], q[1], sg * q[2]]), outer.map(q => [q[0], q[1], sg * q[2]]));
  }
  // ── 옆면 장식: 창 아래 크롬 띠, 문 가운데 몰딩, 두꺼운 문턱 몰딩 ──
  const xg0 = Math.max(p.cR - p.rr * .55, p.bed != null ? bedF + .03 : -h), xg1 = p.cF + p.rf * .55;
  if (sd.beltChrome) for (const sg of [1, -1]) {
    const A: number[][] = [], B: number[][] = [];
    for (let x = xg0; x <= xg1 + 1e-6; x += .04) { const { P, g } = ring(x); if (g < .22) continue; A.push([x, P[17 * 2], sg * (P[17 * 2 + 1] + .003)]); B.push([x, P[16 * 2], sg * (P[16 * 2 + 1] + .003)]); }
    addStrip(A, B, M.chrome);
  }
  if (sd.strip !== 'none') sideBand(-h + E.re + .05, h - E.re - .05, () => sill + (p.belt - sill) * .36, .018, sd.strip === 'chrome' ? M.chrome : M.trim);
  if (sd.clad) sideBand(-p.wb + ar, p.wb - ar, () => sill + .025, .05, M.trim);
  // ── 캐릭터 라인: 위는 빛을 받고 아래는 그늘지게 법선만 기울인 얇은 차체색 띠 2장(접힌 철판처럼 보인다) ──
  if (sd.crease.length) {
    const cp: number[] = [], cn: number[] = [], ci: number[] = [];
    for (const t of sd.crease) for (const sgn of [1, -1]) for (const [d0, d1, ny] of [[0, .012, .55], [-.012, 0, -.5]] as const) {
      let run: number[] = [];
      const flush = () => { for (let j = 0; j + 2 < run.length; j += 2) { const a = run[j], b = run[j + 1]; if (sgn > 0) ci.push(a, b, a + 2, b, b + 2, a + 2); else ci.push(a, a + 2, b, b, a + 2, b + 2); } run = []; };
      for (let x = -h + E.re + .12; x <= h - E.re - .12; x += .05) {
        const yc = sill + (p.belt - sill) * t + sd.kick * (h - x) / p.L;
        if (yc - .014 < archTop(x) + .02 || bedAt(x) || yc > p.belt - .03) { flush(); continue; }
        const nz = Math.sqrt(1 - ny * ny);
        for (const y of [yc + d1, yc + d0]) { run.push(cp.length / 3); cp.push(x, y, sgn * (sideZ(x, y) + .0025)); cn.push(0, ny, sgn * nz); }
      }
      flush();
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3)); cg.setIndex(ci);
    add(cg, M.crease).castShadow = false;
  }

  // ── 앞얼굴(faceOf) ── fw: 얼굴이 쓰는 반폭
  // 데칼 탐색이 시작되는 단면(바퀴 아치 바로 앞뒤)의 실제 옆면 폭을 넘지 않게 한다(앞뒤가 짧고 둥근 경차 등)
  const fw = Math.min(hw * E.faceW, ...([[1, p.belt - F.lampDrop + fc.lampDy], [1, p.clr + .15], [-1, p.belt - F.tailDrop + fc.tailDy], [-1, p.clr + .15]] as const)
    .map(([s, y]) => (sideZ(s * loOf(s), y) - .01) / .96));
  const L2 = F.lift * 2, L3 = F.lift * 3, plateTop = p.clr + F.plateY + F.plateH;
  const lampY = p.belt - F.lampDrop + fc.lampDy, lw = fc.lampW;
  let lampTop = lampY + F.lampH / 2, lampIn = fw * .5; // 라이트 바 높이, 그릴이 넘지 말아야 할 전조등 안쪽 끝
  // 윗면(지붕·보닛) 높이: 그 x 단면의 지붕 점 6개(k=27..32)를 |z|로 보간
  const topY = (x: number, z: number) => {
    const P = ring(x).P; z = Math.abs(z);
    for (let k = 32; k > 24; k--) { const z0 = P[k * 2 + 1], z1 = P[k * 2 - 1]; if (z <= z1) return P[k * 2] + (P[k * 2 - 2] - P[k * 2]) * (z - z0) / Math.max(1e-6, z1 - z0); }
    return P[24 * 2];
  };
  // 윗면에 붙는 데칼: 평면 도형(가로→x, 세로→z)을 위에서 투영
  const topDecal = (geo: THREE.BufferGeometry, mat: THREE.Material, lift = .004) => {
    const pa = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getY(i); pa.setXYZ(i, x, topY(x, z) + lift, z); }
    // grid는 정면에서 본 감김이라 위에서 보면 뒤집힌다: 인덱스를 돌려 위쪽이 앞면이 되게
    const ix = geo.getIndex()!; for (let i = 0; i < ix.count; i += 3) { const t = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, t); }
    geo.computeVertexNormals(); return add(geo, mat);
  };
  const ring2 = (zc: number, yc: number, r: number) => { decal(circle(zc, yc, r + F.roundRing), M.chrome, 1); decal(circle(zc, yc, r), M.lamp, 1, L2); };
  switch (fc.lamp) {
    case 'round': { const r = F.roundLampR * lw; pair(g => ring2(g * fw * F.roundLampZ, lampY, r)); lampIn = fw * F.roundLampZ - r - F.roundRing; break; }
    case 'twin': { const r = .062 * lw; pair(g => { ring2(g * fw * .58, lampY, r); ring2(g * fw * .82, lampY, r); }); lampIn = fw * .58 - r - F.roundRing; break; }
    case 'oval': { const rz = .12 * lw, ry = .055; pair(g => decal(ellipse(g * fw * .68, lampY, rz, ry), M.lamp, 1)); lampIn = fw * .68 - rz; break; }
    case 'vertical': { const z0 = fw * (.88 - .16 * lw); pair(g => decal(rect(g * z0, g * fw * .88, lampY - .1, lampY + .05, 3, 6), M.lamp, 1)); lampIn = z0; lampTop = lampY + .05; break; }
    case 'swept': { // 안쪽은 가늘고 낮게, 바깥으로 갈수록 두껍고 높게
      const z0 = fw * (.88 - .4 * lw);
      pair(g => decal(grid(8, 3, (u, v) => [g * (z0 + (fw * .88 - z0) * u), lampY - .01 + .05 * u + (v - .5) * (.03 + .05 * u)]), M.lamp, 1));
      lampIn = z0; lampTop = lampY + .055; break;
    }
    case 'slim': { const z0 = fw * (.88 - .38 * lw), y = lampY + F.lampH * .2, lh = F.lampH * .55; pair(g => decal(rect(g * z0, g * fw * .88, y - lh / 2, y + lh / 2), M.lamp, 1)); lampIn = z0; lampTop = y + lh / 2; break; }
    case 'popup': { // 닫힌 팝업 램프: 보닛 앞쪽 윗면의 덮개 선 + 범퍼 위 얇은 차폭등
      const x1 = h - E.re - .04, x0 = x1 - .26, z0 = fw * .42, z1 = fw * .84, t = .008;
      pair(g => { for (const [a, b, c, d] of [[x0, x1, z0, z0 + t], [x0, x1, z1 - t, z1], [x0, x0 + t, z0, z1], [x1 - t, x1, z0, z1]]) topDecal(rect(a, b, g * c, g * d, 4, 1), M.trim); });
      const y = lampY - .02; pair(g => decal(rect(g * fw * .55, g * fw * .86, y - .014, y + .014, 4, 1), M.lamp, 1)); lampIn = fw * .55; lampTop = y + .014; break;
    }
    case 'projector': { // 어두운 램프 칸 안에 둥근 렌즈 + 가는 주간등
      const z0 = fw * (F.lampZ1 - (F.lampZ1 - F.lampZ0) * lw), z1 = fw * F.lampZ1, r = Math.min(.045, (z1 - z0) * .22);
      pair(g => {
        decal(rect(g * z0, g * z1, lampY - F.lampH / 2, lampY + F.lampH / 2), M.trim, 1);
        for (const t of [.3, .7]) decal(circle(g * (z0 + (z1 - z0) * t), lampY + .004, r), M.lamp, 1, L2);
        decal(rect(g * z0, g * z1, lampY - F.lampH / 2, lampY - F.lampH / 2 + .012, 6, 1), M.lamp, 1, L2);
      });
      lampIn = z0; break;
    }
    default: { // rect
      const z0 = fw * (F.lampZ1 - (F.lampZ1 - F.lampZ0) * lw), lh = E.classic ? .1 : F.lampH;
      pair(g => { if (E.classic) decal(rect(g * (z0 - .015), g * (fw * F.lampZ1 + .015), lampY - lh / 2 - .015, lampY + lh / 2 + .015), M.chrome, 1); decal(rect(g * z0, g * fw * F.lampZ1, lampY - lh / 2, lampY + lh / 2), M.lamp, 1, L2); });
      lampIn = z0;
    }
  }
  if (fc.bar) decal(rect(-fw * F.barZ, fw * F.barZ, lampTop - F.barH, lampTop, 12, 1), M.lamp, 1, L2);
  if (fc.bumper === 'black' && !E.classic) for (const s of [1, -1] as const) decal(rect(-fw * .8, fw * .8, p.clr + .06, p.clr + .22, 24, 6), M.trim, s, F.lift * 1.5);
  if (!ev) {
    const gz = Math.min(fw * (E.classic ? F.classicGrilleZ : F.grilleZ) * fc.grilleW, lampIn - .04), fr = F.grilleFrame;
    const g1 = fc.bar ? Math.min(lampY + F.grilleUp, lampTop - F.barH - .015) : lampY + F.grilleUp, g0 = Math.max(lampY - F.grilleDown * fc.grilleH, plateTop + .03);
    const framed = (z0: number, z1: number, y0: number, y1: number) => { decal(rect(z0 - fr, z1 + fr, y0 - fr, y1 + fr, 8, 3), M.chrome, 1); decal(rect(z0, z1, y0, y1, 8, 3), M.trim, 1, L2); };
    switch (fc.grille) {
      case 'hex': { // 위는 좁고 가운데가 가장 넓고 아래로 범퍼까지 내려오는 육각
        const y0 = Math.max(lampY - .17 * fc.grilleH, plateTop + .03), hx = (e: number) => grid(8, 6, (u, v) => {
          const fwv = v > .6 ? gz - (gz * .2) * (v - .6) / .4 : gz * .72 + gz * .28 * v / .6;
          return [(2 * u - 1) * (fwv + e), y0 - e + (g1 - y0 + 2 * e) * v];
        });
        decal(hx(fr), M.chrome, 1); decal(hx(0), M.trim, 1, L2); break;
      }
      case 'twin': framed(-gz * .85, gz * .85, lampY - .01, g1); framed(-gz, gz, Math.max(lampY - .14, plateTop + .03), lampY - .05); break;
      case 'bars': decal(rect(-gz, gz, g0, g1, 8, 3), M.trim, 1);
        for (let i = 1; i <= 3; i++) { const y = g0 + (g1 - g0) * i / 4; decal(rect(-gz, gz, y - .007, y + .007, 8, 1), M.chrome, 1, L2); }
        break;
      case 'none': decal(rect(-gz * .8, gz * .8, lampY - .015, lampY + .01, 8, 1), M.trim, 1); break; // 얇은 틈만
      case 'mesh': framed(-gz, gz, g0, g1); // 가로·세로 가는 크롬 줄로 그물
        for (let i = 1; i <= 3; i++) { const y = g0 + (g1 - g0) * i / 4; decal(rect(-gz, gz, y - .0035, y + .0035, 8, 1), M.chrome, 1, L3); }
        for (let i = 1; i <= 7; i++) { const z = -gz + 2 * gz * i / 8; decal(rect(z - .0035, z + .0035, g0, g1, 1, 3), M.chrome, 1, L3); }
        break;
      case 'vertical': framed(-gz, gz, g0, g1);
        for (let i = 1; i <= 9; i++) { const z = -gz + 2 * gz * i / 10; decal(rect(z - .006, z + .006, g0, g1, 1, 3), M.chrome, 1, L3); }
        break;
      case 'kidney': { // 가운데가 갈라진 둥근 그릴 한 쌍
        const kz = Math.max(gz, .14), w2 = kz * .46, gap = .025;
        const blob = (zc: number, e: number) => grid(10, 6, (u, v) => { const a = (u - .5) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), sx = Math.sign(c) * Math.abs(c) ** .45, sy = Math.sign(sn) * Math.abs(sn) ** .45; return [zc + (w2 + e) * v * sx, (g0 + g1) / 2 + ((g1 - g0) / 2 + e) * v * sy]; });
        pair(g => { decal(blob(g * (gap + w2), F.grilleFrame), M.chrome, 1); decal(blob(g * (gap + w2), 0), M.trim, 1, L2); });
        break;
      }
      case 'wide': { // 전조등까지 이어진 넓은 그릴(70·80년대): 전조등이 그릴 위에 얹힌다
        decal(rect(-fw * .9, fw * .9, lampY - .06, lampY + .06, 16, 2), M.trim, 1);
        for (let i = 1; i <= 2; i++) { const y = lampY - .06 + .12 * i / 3; decal(rect(-lampIn + .02, lampIn - .02, y - .005, y + .005, 8, 1), M.chrome, 1, L2); }
        break;
      }
      default: framed(-gz, gz, g0, g1);
    }
  }
  const iy0 = p.clr + F.intakeY0, iy1 = p.clr + F.intakeY1;
  switch (fc.intake) {
    case 'wide': { const iz = fw * (ev ? F.evIntakeZ : F.intakeZ); decal(rect(-iz, iz, iy0, iy1, 8, 2), M.trim, 1, L2); break; }
    case 'slim': decal(rect(-fw * F.evIntakeZ, fw * F.evIntakeZ, iy0, iy1 - .02, 8, 2), M.trim, 1, L2); break;
    case 'three': decal(rect(-fw * .22, fw * .22, iy0, iy1, 6, 2), M.trim, 1, L2); pair(g => decal(rect(g * fw * .5, g * fw * .76, iy0 - .01, iy1 + .03, 4, 2), M.trim, 1, L2)); break;
    case 'fog': decal(rect(-fw * .3, fw * .3, iy0, iy1 - .01, 8, 2), M.trim, 1, L2); pair(g => { decal(circle(g * fw * .66, (iy0 + iy1) / 2 + .01, .05), M.trim, 1, L2); decal(circle(g * fw * .66, (iy0 + iy1) / 2 + .01, .034), M.lamp, 1, L3); }); break;
  }
  const pz = fc.plateF === 'offset' ? fw * .4 : 0;
  decal(rect(pz - F.plateW / 2, pz + F.plateW / 2, p.clr + F.plateY, plateTop, 4, 2), M.plate, 1, L3);

  // ── 뒷모습 ──
  const tailY = p.belt - F.tailDrop + fc.tailDy, tl = (z0: number, z1: number, y0: number, y1: number, sy = 3) => pair(g => decal(rect(g * fw * z0, g * fw * z1, y0, y1, 4, sy), M.tail, -1));
  let tailIn: number = F.tailZ0, tailTop = tailY + .05;
  switch (fc.tail) {
    case 'vertical': tl(.76, .9, tailY - .13, tailY + .05, 6); tailIn = .76; break;
    case 'L': tl(.5, .9, tailY, tailY + .05); tl(.8, .9, tailY - .12, tailY); tailIn = .5; break;
    case 'split':
      if (E.classic) pair(g => { for (const z of [.6, .8]) decal(circle(g * fw * z, tailY, .05), M.tail, -1); });
      else { tl(.48, .64, tailY - .035, tailY + .035); tl(.7, .9, tailY - .035, tailY + .035); }
      tailIn = .48; tailTop = tailY + .035; break;
    case 'full': tl(F.tailZ0, F.tailZ1, tailY - .03, tailY + .03); tailTop = tailY + .03; break;
    case 'round': pair(g => { for (const z of [.62, .82]) { decal(circle(g * fw * z, tailY, .058), M.chrome, -1); decal(circle(g * fw * z, tailY, .045), M.tail, -1, L2); } }); tailIn = .55; tailTop = tailY + .058; break;
    default: tailTop = tailY + (E.classic ? F.classicTailH : F.tailH) / 2;
      if (E.classic) tl(F.classicTailZ0, F.classicTailZ1, tailY - F.classicTailH / 2, tailY + F.classicTailH / 2); else tl(F.tailZ0, F.tailZ1, tailY - F.tailH / 2, tailY + F.tailH / 2);
  }
  if (ev || fc.tail === 'full') decal(rect(-fw * tailIn, fw * tailIn, tailTop - F.barH, tailTop, 8, 1), M.tail, -1);
  const ry = p.clr + (fc.plateR === 'high' ? F.rearPlateY : F.rearPlateLowY);
  decal(rect(-F.plateW / 2, F.plateW / 2, ry, ry + F.plateH, 4, 2), M.plate, -1, L3);
  decal(rect(-fw * F.diffZ, fw * F.diffZ, p.clr + F.diffY0, p.clr + F.diffY1, 8, 2), M.trim, -1, L2);

  // 1970 크롬 범퍼: 앞뒤 가로 막대
  if (E.classic) for (const s of [1, -1] as const) {
    const by = p.clr + F.bumperY, bx = surfX(by, 0, s) + s * (F.bumperD / 2 - .015);
    add(new THREE.BoxGeometry(F.bumperD, F.bumperH, 2 * (hw - F.bumperInset)), M.chrome, bx, by, 0);
  }

  // ── 작은 부품 ──
  const doors = p.doors;
  pair(sgn => {
    // 사이드 미러: 앞유리 아래 끝 뒤, 창틀 높이에서 짧은 다리로 붙는 납작한 하우징(공처럼 떠 보이지 않게)
    const mx = p.cF + p.rf - .1, my = p.belt + .05, mz = sideZ(mx, p.belt - .01);
    add(new THREE.BoxGeometry(.07, .035, .09), M.dark, mx, my - .015, sgn * (mz + .035));
    const mr = add(new THREE.SphereGeometry(.07, 10, 7), M.paint, mx + .005, my + .02, sgn * (mz + .12)); mr.scale.set(.62, .78, 1.3);
    add(new THREE.BoxGeometry(.006, .075, .15), M.glass, mx - .04, my + .02, sgn * (mz + .12));
    for (let i = 1; i < doors.length; i++) { // 손잡이: 각 문의 뒤 끝 근처
      const x = doors[i] + F.handleBack, y = p.belt - F.handleDrop;
      add(new THREE.BoxGeometry(F.handleW, .022, .02), M.chrome, x, y, sgn * (sideZ(x, y) + .006));
    }
  });
  // 휠하우스 안쪽(어두운 반원통): 위쪽 반만(바닥 아래로 뚫지 않게), 좌우 바퀴 안쪽에만(보닛 가운데로 솟지 않게)
  const well = new THREE.CylinderGeometry(ar - .02, ar - .02, .22, 16, 1, true, Math.PI / 2, Math.PI);
  for (const xw of [-p.wb, p.wb]) pair(sgn => { const wl = add(well, M.dark, xw, ay, sgn * (hw - .22)); wl.rotation.x = Math.PI / 2; wl.castShadow = false; });
  if (look.sporty || p.spoiler) {
    // 실제 윗면 높이(topY)에 맞춰 붙인다: 트렁크 날개는 다리가 덱에 닿고, 지붕 스포일러는 지붕 끝에 얹힌다
    const sx = p.deck ? -h + .2 : p.cR - .06, zl = hw - .42, sy = p.deck ? topY(sx, 0) + .08 : Math.max(topY(sx, 0), topY(sx, zl)); // 고리 사이 면은 곡선보다 조금 낮아 살짝 묻는다
    add(new THREE.BoxGeometry(.2, .028, p.W - .42), M.dark, sx, sy, 0);
    if (p.deck) pair(sgn => { const y0 = topY(sx + .03, zl) - .01; add(new THREE.BoxGeometry(.05, sy - y0, .04), M.dark, sx + .03, (sy + y0) / 2, sgn * zl); });
    if (!ev) pair(sgn => { const ex = add(new THREE.CylinderGeometry(.04, .04, .16, 16), M.chrome, -h + .1, p.clr + .03, sgn * .48); ex.rotation.z = Math.PI / 2; });
  }
  // ── 지붕: 선루프(유리 판), 루프랙(레일 2줄 + 다리) ──
  const rx0 = p.cR + .12, rx1 = p.cF - .1;
  if (sd.sunroof && p.bed == null && rx1 - rx0 > .5) {
    const len = Math.min(.8, (rx1 - rx0) * .7), x1 = rx1 - .08, sw = (hw - .1) * .55;
    topDecal(rect(x1 - len - .02, x1 + .02, -sw - .02, sw + .02, 6, 3), M.trim, .003);
    topDecal(rect(x1 - len, x1, -sw, sw, 6, 3), M.glass, .006);
  }
  if (sd.rack && rx1 - rx0 > .5) {
    const zr = (ring(mid).P[27 * 2 + 1]) * .82, lx = [rx0 + .06, rx1 - .06], ly = Math.max(...lx.map(x => topY(x, zr))) + .055;
    pair(sgn => {
      add(new THREE.BoxGeometry(rx1 - rx0, .025, .035), M.dark, (rx0 + rx1) / 2, ly, sgn * zr);
      for (const x of lx) { const y0 = topY(x, zr); add(new THREE.BoxGeometry(.06, ly - y0 + .01, .04), M.dark, x, (ly + y0) / 2, sgn * zr); }
    });
  }

  // ── 바퀴: 타이어(옆면을 둥글린 회전체) + 림 + 디자인별 스포크. 지오메트리는 4바퀴가 같이 쓴다 ──
  const rimR = p.wr * RIM_RATIO[look.wheel ?? 1], wk: WheelKind = fc.wheel;
  const tire = new THREE.LatheGeometry([[rimR, -.125], [p.wr - .035, -.125], [p.wr, -.085], [p.wr, .085], [p.wr - .035, .125], [rimR, .125]].map(q => new THREE.Vector2(q[0], q[1])), 32);
  const disc = new THREE.CylinderGeometry(rimR, rimR, .02, 32);
  const lip = new THREE.CylinderGeometry(rimR, rimR - .01, .035, 32, 1, true), hub = new THREE.CylinderGeometry(.055, .065, .035, 16);
  const rimMat = wk === 'steel' ? M.dark : M.rim;
  // 스포크 무늬: [개수, 길이 비율, 두께(접선), 겹(같은 각도에 나란히 둘 오프셋)]
  const SP: Record<WheelKind, [number, number, number, number[]]> = {
    twin5: [5, .92, .026, [-.028, .028]], spoke5: [5, .92, .07, [0]], multi: [10, .92, .022, [0]], mesh: [16, .92, .012, [0]],
    turbine: [9, .5, .03, [0]], steel: [0, 0, 0, []], aero: [5, .22, .05, [0]],
  };
  const [nSp, spL, spW, offs] = SP[wk], spoke = nSp ? new THREE.BoxGeometry(rimR * spL, .022, spW) : null;
  const plate = wk === 'aero' || wk === 'turbine' ? new THREE.CylinderGeometry(rimR * (wk === 'aero' ? .96 : .9), rimR * (wk === 'aero' ? .96 : .9), .015, 32)
    : wk === 'steel' ? new THREE.CylinderGeometry(rimR * .66, rimR * .7, .03, 24) : new THREE.CylinderGeometry(rimR * .72, rimR * .72, .015, 24);
  for (const x of [-p.wb, p.wb]) for (const sgn of [1, -1]) {
    const w = new THREE.Group(); w.position.set(x, p.wr, sgn * (hw - .15)); w.rotation.x = sgn * Math.PI / 2; carG.add(w);
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, y = 0) => { const mm = new THREE.Mesh(g, mat); mm.position.y = y; mm.castShadow = true; w.add(mm); return mm; };
    part(tire, M.tire); part(disc, wk === 'steel' ? rimMat : M.dark, .06); part(lip, rimMat, .1);
    part(plate, wk === 'steel' ? M.chrome : M.rim, wk === 'steel' ? .1 : .085);
    if (spoke) for (let i = 0; i < nSp; i++) {
      const pv = new THREE.Group(); pv.rotation.y = i / nSp * Math.PI * 2; pv.position.y = wk === 'aero' || wk === 'turbine' ? .095 : .105; w.add(pv);
      // 터빈·공력 휠은 둘레 가까이에 짧고 어두운 홈, 나머지는 가운데서 뻗는 림색 스포크
      const dark = wk === 'aero' || wk === 'turbine', r0 = dark ? rimR * (1 - spL / 2 - .08) : rimR * .5;
      for (const off of offs) { const sp = new THREE.Mesh(spoke, dark ? M.dark : M.rim); sp.position.set(r0, 0, off); if (wk === 'turbine') sp.rotation.y = .5; sp.castShadow = true; pv.add(sp); }
    }
    part(hub, M.chrome, .115);
  }
  for (const [mat, S] of strips) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3)); g.setIndex(S.idx); g.computeVertexNormals();
    add(g, mat).castShadow = false;
  }
  carG.userData.decalMiss = decalMiss;
  return carG;
}
