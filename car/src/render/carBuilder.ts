import * as THREE from 'three';
import type { CarLook } from './look';
import { BODY, FACE, WHEEL_GROW, eraStyle } from './shapes';

export interface CarMaterials {
  paint: THREE.MeshPhysicalMaterial;
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
  const std = THREE.MeshStandardMaterial;
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(color), metalness: .3, roughness: .4, envMapIntensity: .75, clearcoat: 1, clearcoatRoughness: .06 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b1016, metalness: .9, roughness: .06 }),
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
  const p = { ...BODY[look.bodyId] };
  p.wr += WHEEL_GROW[look.wheel];
  const E = eraStyle(look), ev = look.powertrain === 'ev', F = FACE;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; carG.add(m); return m;
  };
  const h = p.L / 2, hw = p.W / 2, N = 184, J = 32, RN = 2 * J, ar = p.wr + .055, mid = (p.cR + p.cF) / 2;
  const ym = p.clr + (p.belt - p.clr) * .55;

  // 옆모습 윗선: 꺾은선을 찍고 두 번 문질러 둥글린다
  const ctl = [[-h, p.belt - .02], [p.cR - p.rr - .08, p.belt + .03], [p.cR, p.roof], [mid, p.roof + .025], [p.cF, p.roof], [p.cF + p.rf, p.belt + .04], [h - .55, p.belt - .05], [h, p.belt - .2]];
  const lin = (x: number) => {
    for (let i = 1; i < ctl.length; i++) if (x <= ctl[i][0]) { const [x0, y0] = ctl[i - 1], [x1, y1] = ctl[i]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
    return ctl[ctl.length - 1][1];
  };
  const xs: number[] = [];
  for (let i = 0; i <= N; i++) xs.push(Math.max(-h + .004, Math.min(h - .004, -h + p.L * i / N)));
  let Ts = xs.map(lin);
  for (let k = 0; k < 2; k++) Ts = Ts.map((_, i) => { let a = 0; for (let j = -4; j <= 4; j++) a += Ts[Math.max(0, Math.min(N, i + j))]; return a / 9; });
  const Tat = (x: number) => { const f = Math.max(0, Math.min(N, (x + h) / p.L * N)), i = Math.min(N - 1, Math.floor(f)); return Ts[i] + (Ts[i + 1] - Ts[i]) * (f - i); };

  // 단면 반쪽(z≥0): [y0,z0,y1,z1,…] 33점. 바닥 가운데 → 옆 → 지붕 가운데
  const ring = (x: number) => {
    const d = Math.min(x + h, h - x);
    let arch = 0;
    for (const xw of [-p.wb, p.wb]) { const dx = Math.abs(x - xw); if (dx < ar) arch = p.wr + Math.sqrt(ar * ar - dx * dx); }
    let yb = Math.max(p.clr, arch), ys = p.belt + .03 - .07 * (x + h) / p.L, T = Tat(x);
    if (arch) ys = Math.max(ys, arch + .08);
    T = Math.max(T, ys + .09);
    const e = d < E.re ? Math.sqrt(1 - (1 - d / E.re) ** 2) : 1;
    T = ym + (T - ym) * e; yb = ym - (ym - yb) * e;
    const y0 = ym - (ym - p.clr) * e; // 옆판 최소 높이는 아치가 아닌 차체 바닥 기준(아치 위 창틀이 솟지 않게)
    ys = Math.max(Math.min(ys, T - .09 * e), y0 + .35 * (T - y0));
    const rp = x > 0 ? E.rpF : E.rpR;
    let w = hw * (1 - E.taper * (x / h) ** 4) + .018 * Math.exp(-(((Math.abs(x) - p.wb) / .4) ** 2));
    if (d < rp) w -= rp - Math.sqrt(rp * rp - (rp - d) ** 2);
    w = Math.max(w, .05);
    const g = T - ys, ledge = Math.min(.035, g * .3), wroof = Math.max(.06, w - ledge - .24 * Math.max(0, g - .09));
    const rc = Math.min(E.rc, g * .6, wroof * .6), rb = Math.min(E.rb, (ys - yb) * .3), tuck = .045 * e, wB = w - tuck;
    const P: number[] = [];
    for (const f of [0, .33, .66, 1]) P.push(yb, (wB - rb) * f);
    for (const a of [Math.PI / 6, Math.PI / 3]) P.push(yb + rb - rb * Math.cos(a), wB - rb + rb * Math.sin(a));
    for (let k = 0; k <= 10; k++) { const u = k / 10; P.push(yb + rb + u * (ys - yb - rb), w - tuck * (1 - u) ** 2); }
    const b0 = ys + ledge * .8, b1 = Math.max(b0, T - rc);
    for (let k = 0; k <= 6; k++) { const u = k / 6; P.push(b0 + u * (b1 - b0), w - ledge + u * (wroof - w + ledge)); }
    for (const a of [Math.PI / 8, Math.PI / 4, Math.PI * 3 / 8]) P.push(b1 + rc * Math.sin(a), wroof - rc + rc * Math.cos(a));
    const wt = wroof - rc, crown = .03 * Math.min(1, g / .3);
    for (let k = 0; k <= 5; k++) { const z = wt * (1 - k / 5); P.push(T + crown * (1 - (z / wt) ** 2), z); }
    return { P, g };
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
  const surfX = (y: number, z: number, s: 1 | -1) => {
    let lo = p.wb + ar + .01, hi = h - .004;
    if (inside(ring(s * hi).P, y, z)) return s * hi;
    if (!inside(ring(s * lo).P, y, z)) return s * lo;
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
    for (let i = 0; i < pa.count; i++) { const gz = pa.getX(i), gy = pa.getY(i); pa.setXYZ(i, surfX(gy, gz, s) + s * lift, gy, -s * gz); }
    geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo.computeVertexNormals();
    return add(geo, mat);
  };
  const rect = (z0: number, z1: number, y0: number, y1: number, sz = 6, sy = 3) =>
    new THREE.PlaneGeometry(Math.abs(z1 - z0), y1 - y0, sz, sy).translate((z0 + z1) / 2, (y0 + y1) / 2, 0);
  const circle = (zc: number, yc: number, r: number) => new THREE.CircleGeometry(r, 20).translate(zc, yc, 0);
  const pair = (fn: (sg: number) => void) => { fn(1); fn(-1); };

  // ── 차체 곡면 ──
  const pos: number[] = [], gs: number[] = [];
  for (let i = 0; i <= N; i++) {
    const { P, g } = ring(xs[i]);
    for (let k = 0; k <= J; k++) pos.push(xs[i], P[k * 2], P[k * 2 + 1]);
    for (let k = J - 1; k >= 1; k--) pos.push(xs[i], P[k * 2], -P[k * 2 + 1]);
    gs.push(g);
  }
  const vi = (i: number, r: number) => i * RN + (r % RN), idx: number[][] = [[], [], []], sill = p.clr + p.sill;
  for (let i = 0; i < N; i++) for (let r = 0; r < RN; r++) {
    const a = vi(i, r), b = vi(i + 1, r), c = vi(i + 1, r + 1), dd = vi(i, r + 1), k = r < J ? r : RN - 1 - r;
    const cx = (pos[a * 3] + pos[b * 3]) / 2, cy = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[dd * 3 + 1]) / 4;
    const gm = Math.min(gs[i], gs[i + 1]);
    let m = 0;
    if (k >= 18 && k <= 21 && gm > .22 && Math.abs(cx - mid) > .045) m = 1;
    else if (k >= 27 && ((cx > p.cF + .1 && cx < p.cF + p.rf - .04) || (cx > p.cR - p.rr + .04 && cx < p.cR - .1))) m = 1;
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
  add(geo, [M.paint, M.glass, M.dark]);

  // ── 도어 컷 선: x 위치의 단면 고리 한 줄(옆면 구간만)을 어두운 띠로 ──
  const strip: number[] = [], sIdx: number[] = [];
  const addStrip = (A: number[][], B: number[][]) => { // A·B: 같은 개수의 점 줄 두 개를 띠로 잇는다
    const base = strip.length / 3;
    for (const q of [...A, ...B]) strip.push(q[0], q[1], q[2]);
    for (let j = 0; j < A.length - 1; j++) { const a = base + j, b = base + A.length + j; sIdx.push(a, b, a + 1, b, b + 1, a + 1); }
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
        const x = xw + c * r, y = p.wr + s * r;
        arr.push([x, y, sideZ(x, y) + F.archLift]); // 고리 사이 꺾인 면보다 바깥에 오게 더 띄운다
      }
    }
    for (const sg of [1, -1]) addStrip(inner.map(q => [q[0], q[1], sg * q[2]]), outer.map(q => [q[0], q[1], sg * q[2]]));
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(strip, 3));
  sg.setIndex(sIdx); sg.computeVertexNormals();
  add(sg, M.trim).castShadow = false;

  // ── 앞얼굴 ──
  const lampY = p.belt - F.lampDrop;
  if (E.classic) {
    pair(sgn => {
      decal(circle(sgn * hw * F.roundLampZ, lampY, F.roundLampR + F.roundRing), M.chrome, 1);
      decal(circle(sgn * hw * F.roundLampZ, lampY, F.roundLampR), M.lamp, 1, F.lift * 2);
    });
  } else {
    const lh = ev ? F.lampH * .55 : F.lampH, ly = ev ? lampY + F.lampH * .2 : lampY;
    pair(sgn => decal(rect(sgn * hw * F.lampZ0, sgn * hw * F.lampZ1, ly - lh / 2, ly + lh / 2), M.lamp, 1));
    if (ev) decal(rect(-hw * F.barZ, hw * F.barZ, ly + lh / 2 - F.barH, ly + lh / 2, 12, 1), M.lamp, 1, F.lift * 2);
  }
  if (!ev) {
    const gz = hw * (E.classic ? F.classicGrilleZ : F.grilleZ), g0 = lampY - F.grilleDown, g1 = lampY + F.grilleUp, fr = F.grilleFrame;
    decal(rect(-gz - fr, gz + fr, g0 - fr, g1 + fr, 8, 3), M.chrome, 1);
    decal(rect(-gz, gz, g0, g1, 8, 3), M.trim, 1, F.lift * 2);
  }
  const iz = hw * (ev ? F.evIntakeZ : F.intakeZ);
  decal(rect(-iz, iz, p.clr + F.intakeY0, p.clr + F.intakeY1, 8, 2), M.trim, 1);
  decal(rect(-F.plateW / 2, F.plateW / 2, p.clr + F.plateY, p.clr + F.plateY + F.plateH, 4, 2), M.plate, 1);

  // ── 뒷모습 ──
  const tailY = p.belt - F.tailDrop;
  if (E.classic) pair(sgn => decal(rect(sgn * hw * F.classicTailZ0, sgn * hw * F.classicTailZ1, tailY - F.classicTailH / 2, tailY + F.classicTailH / 2, 4, 3), M.tail, -1));
  else {
    pair(sgn => decal(rect(sgn * hw * F.tailZ0, sgn * hw * F.tailZ1, tailY - F.tailH / 2, tailY + F.tailH / 2), M.tail, -1));
    if (ev) decal(rect(-hw * F.tailZ0, hw * F.tailZ0, tailY + F.tailH / 2 - F.barH, tailY + F.tailH / 2, 8, 1), M.tail, -1);
  }
  decal(rect(-F.plateW / 2, F.plateW / 2, p.clr + F.rearPlateY, p.clr + F.rearPlateY + F.plateH, 4, 2), M.plate, -1);
  decal(rect(-hw * F.diffZ, hw * F.diffZ, p.clr + F.diffY0, p.clr + F.diffY1, 8, 2), M.trim, -1);

  // 1970 크롬 범퍼: 앞뒤 가로 막대
  if (E.classic) for (const s of [1, -1] as const) {
    const by = p.clr + F.bumperY, bx = surfX(by, 0, s) + s * (F.bumperD / 2 - .015);
    add(new THREE.BoxGeometry(F.bumperD, F.bumperH, 2 * (hw - F.bumperInset)), M.chrome, bx, by, 0);
  }

  // ── 작은 부품 ──
  const doors = p.doors;
  pair(sgn => {
    const mr = add(new THREE.SphereGeometry(.075, 16, 12), M.paint, p.cF + p.rf - .04, p.belt + .1, sgn * (hw + .05)); mr.scale.set(1.35, .8, .75);
    add(new THREE.BoxGeometry(.05, .03, .1), M.dark, p.cF + p.rf - .02, p.belt + .06, sgn * (hw - .02));
    for (let i = 1; i < doors.length; i++) { // 손잡이: 각 문의 뒤 끝 근처
      const x = doors[i] + F.handleBack, y = p.belt - F.handleDrop;
      add(new THREE.BoxGeometry(F.handleW, .022, .02), M.chrome, x, y, sgn * (sideZ(x, y) + .006));
    }
  });
  for (const xw of [-p.wb, p.wb]) { const wl = add(new THREE.CylinderGeometry(ar - .02, ar - .02, p.W - .42, 24), M.dark, xw, p.wr, 0); wl.rotation.x = Math.PI / 2; wl.castShadow = false; }
  if (look.sporty) {
    const sx = p.deck ? -h + .2 : p.cR - .06, sy = Tat(sx) + (p.deck ? .12 : .05);
    add(new THREE.BoxGeometry(.2, .028, p.W - .42), M.dark, sx, sy, 0);
    if (p.deck) pair(sgn => add(new THREE.BoxGeometry(.05, .1, .04), M.dark, sx + .03, sy - .05, sgn * (hw - .42)));
    if (!ev) pair(sgn => { const ex = add(new THREE.CylinderGeometry(.04, .04, .16, 16), M.chrome, -h + .1, p.clr + .03, sgn * .48); ex.rotation.z = Math.PI / 2; });
  }

  // ── 바퀴: 타이어(옆면을 둥글린 회전체) + 림 + 스포크. 지오메트리는 4바퀴가 같이 쓴다 ──
  const rimR = p.wr * .68;
  const tire = new THREE.LatheGeometry([[rimR, -.125], [p.wr - .035, -.125], [p.wr, -.085], [p.wr, .085], [p.wr - .035, .125], [rimR, .125]].map(q => new THREE.Vector2(q[0], q[1])), 48);
  const disc = new THREE.CylinderGeometry(rimR, rimR, .02, 40), face = new THREE.CylinderGeometry(rimR * .72, rimR * .72, .015, 32);
  const lip = new THREE.TorusGeometry(rimR - .012, .02, 10, 48), spoke = new THREE.BoxGeometry(rimR * .92, .022, .026), hub = new THREE.CylinderGeometry(.055, .065, .035, 20);
  for (const x of [-p.wb, p.wb]) for (const sgn of [1, -1]) {
    const w = new THREE.Group(); w.position.set(x, p.wr, sgn * (hw - .15)); w.rotation.x = sgn * Math.PI / 2; carG.add(w);
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, y = 0) => { const mm = new THREE.Mesh(g, mat); mm.position.y = y; mm.castShadow = true; w.add(mm); return mm; };
    part(tire, M.tire); part(disc, M.dark, .06); part(face, M.rim, .075);
    part(lip, M.rim, .115).rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) {
      const pv = new THREE.Group(); pv.rotation.y = i / 5 * Math.PI * 2; pv.position.y = .105; w.add(pv);
      for (const off of [-.028, .028]) { const sp = new THREE.Mesh(spoke, M.rim); sp.position.set(rimR * .5, 0, off); sp.castShadow = true; pv.add(sp); }
    }
    part(hub, M.chrome, .115);
  }
  return carG;
}
