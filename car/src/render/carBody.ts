import type { Chassis } from './variant';
import type { EraStyle } from './shapes';

/* 5.2.0 차체 생성기. 차를 세 덩어리로 나눠 만든다.
   1) 아래 몸통: 길이 방향 단면(정점 19개 반쪽 고리)을 이어 붙인 곡면. 단면은 옆모습 선(바닥·어깨·보닛/트렁크 윗면)·평면 폭·단면 모양(로커·옆판 배부름·꺾임·어깨)에서 나온다.
      휠 아치는 단면 안에 홈(휠하우스 벽·천장)으로 파서 바퀴 둘레가 실제로 비고, 앞뒤 끝은 단면이 코 높이로 모이며 평면에서 가운데가 앞으로 나오게 휜다(bow).
   2) 온실: 어깨선 안쪽에서 시작하는 별도 볼륨(유리·A/B/C 기둥·지붕). 옆 유리는 위로 갈수록 안으로 눕는다(텀블홈).
   3) 얼굴 부품은 carBuilder가 이 곡면 위에 광선으로 붙인다(hit). 순수 함수: 같은 차대 = 같은 정점. */

export const HALF = 19;
const CL_SAG = .022; // 5.5.1 부른 곳에서 캐릭터 라인까지 옆판이 안으로 드는 양(m) // 아래 몸통 단면 반쪽 점 수(바닥 가운데 0 → 지붕 가운데 18)
// 단면 점 번호: 0 바닥 가운데, 1·2 휠하우스 안벽 아래·위, 3~5 로커(아치 테두리), 6 문턱 띠 위, 7 아래 옆판, 8 옆판 꺾임(가장 넓은 곳), 9·10 위 옆판, 11~13 어깨, 13~18 보닛·트렁크 윗면
// 5.5.1 점 8은 옆판이 가장 부른 곳, 점 9는 어깨선 아래 캐릭터 라인(위는 안으로 눕고 아래는 서서 빛이 걸리는 꺾임)
export const KS = { lip: 5, sill: 6, feat: 9, sh0: 11, top: 13 } as const;
const GH = 12; // 온실 단면 반쪽 점 수: 0 바닥, 1 창 아래(창틀 위), 2·3 유리, 4 유리 위, 5 창틀 위, 6·7 지붕 모서리, 8~11 지붕
export const MAT = { paint: 0, glass: 1, dark: 2, gloss: 3, trim: 4, chrome: 5 } as const;

export interface Ring { P: number[]; ys: number; T: number; yb: number; w: number; arch: boolean; bed: boolean }
export interface Hit { p: [number, number, number]; n: [number, number, number] }

export interface BodyOpts { gt: boolean; era: number; tireW: number }

export function carBody(p: Chassis, E: EraStyle, o: BodyOpts) {
  const h = p.L / 2, hw = p.W / 2, ar = p.archR, ay = p.archY, sd = p.side;
  const ek = Math.max(.55, p.edge ?? 1);
  // 트렁크 없는 차(해치백·SUV·미니밴·경차)는 지붕·뒤 유리가 차 뒤 끝까지 온다(뒤에 턱이 남지 않게). 뒤 유리 기울기 길이는 차대 값(rr)을 따른다
  const hatchBack = !p.deck && p.bed == null;
  const xc = p.cF + p.rf, xd = hatchBack ? -h + .03 : p.cR - p.rr; // 앞유리 아래 끝(카울), 뒤 유리 아래 끝
  const cR = hatchBack ? Math.min(p.cF - .45, xd + Math.max(.1, Math.min(p.rr, .32))) : p.cR;
  const fenders = !!p.fenders || o.gt;
  // 끝 모양(앞 +1, 뒤 −1)
  const dArch = (s: number) => h - p.wb - ar * (s > 0 ? 1 : 1);
  const endT = (s: number) => Math.min(E.endT * ek * (s > 0 ? 1 : .85), dArch(s) * .7), endB = (s: number) => Math.min(E.endB * ek * (s > 0 ? 1 : .9), dArch(s) * .5);
  const zA = (s: number) => Math.max(endT(s), endB(s)) + .02, zB = (s: number) => Math.max(zA(s) + .05, dArch(s) - .03);
  const bow = (s: number) => Math.min(E.bow * (ek < 1 ? .6 : 1) * (s > 0 ? 1 : .7), (zB(s) - zA(s)) / 1.6);
  const sup = (t: number, q: number) => t >= 1 ? 1 : t <= 0 ? 0 : (1 - (1 - t) ** q) ** (1 / q);
  const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  const beltLine = (x: number) => p.belt + .02 + p.wedge * (.5 - (x + h) / p.L);
  const noseK = p.fenders ? .95 : (p.edge ?? 1) > .75 && (p.edge ?? 1) < .85 ? 1 : p.suv || p.bed != null ? .25 : .5, yHF = beltLine(h) - (p.nose ?? .2) * noseK, yDR = beltLine(-h) - (p.deck ? .02 : .03);
  const yN = (s: number) => s > 0 ? p.clr + (yHF - p.clr) * E.nose : p.clr + (yDR - p.clr) * .55;
  const crownTop = E.crown * hw / .9;
  const bedF = xd - .06, bedB = -h + .1, inBed = (x: number) => p.bed != null && x > bedB && x < bedF;
  const archAt = (x: number) => { for (const xw of [-p.wb, p.wb]) { const dx = Math.abs(x - xw); if (dx < ar) return ay + Math.sqrt(ar * ar - dx * dx); } return 0; };
  const fenderGuard = (x: number) => { let y = 0; for (const xw of [-p.wb, p.wb]) { const dx = Math.abs(x - xw), R = ar + .12; if (dx < R) y = Math.max(y, ay - .12 + Math.sqrt(R * R - dx * dx) + (fenders ? .03 : .05)); } return y; };
  // 윗선(어깨 높이): 보닛은 카울에서 앞 끝(yHF)으로 내려가고, 트렁크는 뒤 유리 아래에서 뒤 끝으로 조금 내려간다
  const upper = (x: number) => {
    if (x >= xc) { const u = (x - xc) / Math.max(.1, h - xc); return beltLine(xc) + (yHF - beltLine(xc)) * u ** (noseK < 1 ? 2.2 : 1.4); }
    if (x <= xd && p.deck) { const u = (xd - x) / Math.max(.1, xd + h); return beltLine(xd) + .01 + (yDR - beltLine(xd) - .01) * u ** 1.3; }
    return beltLine(x);
  };
  const wPlan = (x: number) => {
    const s = x >= 0 ? 1 : -1, d = Math.max(0, h - Math.abs(x)), rp = Math.min(E.corner * ek, zA(s) + .1);
    let w = hw * (1 - (x > 0 ? 1 : .8) * E.taper * (x / h) ** 4) + ((fenders ? .025 : 0) + (o.gt ? .03 : 0)) * Math.exp(-(((Math.abs(x) - p.wb) / .5) ** 2));
    if (d < rp) w -= rp - Math.sqrt(rp * rp - (rp - d) ** 2);
    return Math.max(.05, w);
  };
  const bendAmt = (x: number, z: number) => { const s = x >= 0 ? 1 : -1, d = Math.max(0, h - Math.abs(x)), g = 1 - smooth((d - zA(s)) / (zB(s) - zA(s))); return s * bow(s) * (z / hw) ** 2 * g; };
  const bent = (x: number, z: number) => x - bendAmt(x, z);
  /** 휜 좌표 x를 단면 위치로 되돌린다(고정점 반복) */
  const unbend = (x: number, z: number) => { let xs = x; for (let i = 0; i < 6; i++) xs = x + bendAmt(xs, z); return Math.max(-h, Math.min(h, xs)); };

  let wellIn = 9;
  const rk = E.p < 3 ? .045 : .03, rs = E.rs, side = E.side, tuck = E.tuck, sillH = p.sill * (o.era >= 2020 ? .55 : 1);
  const ring0 = (x: number): Ring => {
    const s = x >= 0 ? 1 : -1, d = Math.max(0, h - Math.abs(x)), n = yN(s);
    const tT = sup(d / endT(s), E.p), tB = sup(d / endB(s), E.p + .6);
    let U = upper(x), T = U + crownTop;
    const fg = fenderGuard(x);
    let ys = Math.max(U, fg);
    T = fenders ? Math.max(T, ys - .035) : Math.max(T, ys + crownTop * .5);
    ys = n + (ys - n) * tT; T = n + (T - n) * tT;
    const yb = n - (n - p.clr) * tB;
    const yA = archAt(x), arch = yA > 0, w = wPlan(x);
    const bed = inBed(x);
    const yf = yb + (ys - yb) * .46, ycl = yb + (ys - yb) * .76;
    // 5.5.1 옆판: 아래는 로커 쪽으로 말려 들어가고(tuck + 끝에서 더), 가운데는 위아래로 완만히 부르며, 캐릭터 라인(ycl) 위는 어깨까지 안으로 눕는다.
    // 휠 아치 둘레는 캐릭터 라인 아래만 펜더가 부푼다(어깨선은 곧게)
    const fl = (.016 + (fenders ? .006 : 0)) * Math.exp(-(((Math.abs(x) - p.wb) / (ar * 1.25)) ** 2));
    const zOf = (y: number) => {
      const fy = fl * (1 - smooth((y - (ycl - .1)) / .1));
      if (y <= yf) { const q = (yf - y) / Math.max(.05, yf - yb); return w + fy - tuck * q * q - E.tuck * .45 * q ** 6; }
      if (y <= ycl) { const q = (y - yf) / Math.max(.03, ycl - yf); return w + fy - CL_SAG * q * q; }
      return w - CL_SAG - side * ((y - ycl) / Math.max(.05, ys - ycl)) ** 1.25;
    };
    const P: number[] = [];
    let last = -1;
    const put = (y: number, z: number) => { y = Math.max(y, last); last = y; P.push(y, z); };
    const yLow = arch ? Math.max(yb, Math.min(yA, ys - rs - .02)) : yb;
    const w0 = zOf(yLow + rk), zIn = Math.min(wellIn, w0 - rk - .01);
    put(yb, 0); put(yb, zIn); put(yLow, zIn);
    put(yLow, w0 - rk); put(yLow + rk * .29, w0 - rk * .29); put(yLow + rk, w0);
    const ySill = yb + rk + sillH, yTop = ys - rs;
    for (const y of [ySill, (ySill + yf) / 2, yf, ycl, (ycl + yTop) / 2]) { const yy = Math.min(Math.max(y, yLow + rk), yTop); put(yy, zOf(yy)); }
    const zS = w - side - CL_SAG;
    put(yTop, zOf(yTop)); put(ys - rs * .29, zS - rs * .29); put(ys, zS - rs);
    const z1 = zS - rs;
    if (bed) { // 짐칸: 벽 윗면 → 안쪽 벽 → 바닥
      const yf2 = Math.min(Math.max(p.bed!, yb + .08), ys - .1), zi = z1 - .06;
      P.push(ys, zi + .01, ys - .015, zi, yf2 + .03, zi, yf2, zi - .04, yf2, 0);
    } else for (let k = 1; k <= 5; k++) { const z = z1 * (1 - k / 5); P.push(T + (ys - T) * (z / z1) ** 2, z); }
    return { P, ys, T, yb, w, arch, bed };
  };
  const memo = new Map<number, Ring>();
  const ring = (x: number) => { let r = memo.get(x); if (!r) memo.set(x, r = ring0(x)); return r; };

  /** 단면 위치 x에서 높이 y의 옆면 |z|(로커 위 ~ 어깨 사이) */
  const sideZ = (x: number, y: number) => {
    const P = ring(x).P;
    for (let k = KS.lip + 1; k <= KS.top; k++) if (P[k * 2] >= y) { const y0 = P[k * 2 - 2], y1 = P[k * 2]; return y1 - y0 < 1e-6 ? P[k * 2 + 1] : P[k * 2 - 1] + (P[k * 2 + 1] - P[k * 2 - 1]) * (y - y0) / (y1 - y0); }
    return P[KS.top * 2 + 1];
  };
  // 바퀴 위치: 아치 바로 앞뒤 옆면(바퀴 중심 높이)보다 타이어 바깥면이 조금 안쪽. 휠하우스 안벽은 타이어 안쪽면보다 더 안
  const tireZ = [-p.wb, p.wb].map(xw => Math.min(sideZ(xw - ar - .01, ay), sideZ(xw + ar + .01, ay)) - o.tireW / 2 - (o.gt ? .004 : .014));
  wellIn = Math.min(...tireZ) - o.tireW / 2 - .03;
  memo.clear();

  // ── 단면 위치(앞뒤 끝·아치 둘레는 촘촘하게) ──
  const xs: number[] = [];
  for (const s of [1, -1]) {
    const L = zB(s) + .02;
    for (let k = 0; k <= 16; k++) xs.push(s * (h - L * (k / 16) ** 1.6));
  }
  for (const xw of [-p.wb, p.wb]) {
    for (let k = 0; k <= 16; k++) xs.push(xw + (ar - 1e-4) * Math.cos(Math.PI * k / 16));
    xs.push(xw - ar - .002, xw + ar + .002);
  }
  if (p.bed != null) xs.push(bedF - .001, bedF + .001, bedB - .001, bedB + .001);
  xs.push(xc, xd);
  xs.sort((a, b) => a - b);
  const st: number[] = [];
  for (const x of xs) {
    if (x < -h || x > h) continue;
    const last = st[st.length - 1];
    if (last != null && x - last < 8e-5) continue;
    if (last != null) { const n = Math.ceil((x - last) / .09); for (let i = 1; i < n; i++) st.push(last + (x - last) * i / n); }
    st.push(x);
  }

  // ── 아래 몸통 메시 ──
  const pos: number[] = [], RN = 2 * HALF - 2;
  const rings = st.map(ring);
  for (let i = 0; i < st.length; i++) {
    const P = rings[i].P;
    for (let k = 0; k < HALF; k++) { const y = P[k * 2], z = P[k * 2 + 1]; pos.push(bent(st[i], z), y, z); }
    for (let k = HALF - 2; k >= 1; k--) { const y = P[k * 2], z = -P[k * 2 + 1]; pos.push(bent(st[i], z), y, z); }
  }
  // 재질·매끈 묶음별 삼각형. 묶음이 다르면 꼭짓점을 따로 두어 경계가 날 선 모서리가 된다
  const tri = new Map<number, number[]>(); // key = mat*16 + group
  const push = (mat: number, grp: number, ...v: number[]) => { const key = mat * 16 + grp; let a = tri.get(key); if (!a) tri.set(key, a = []); a.push(...v); };
  const V = (i: number, r: number) => i * RN + (r % RN);
  const nrmY = (a: number, b: number, c: number) => { // 삼각형 법선의 y 성분(아래를 보는 면은 어두운 바닥)
    const ax = pos[b * 3] - pos[a * 3], ay2 = pos[b * 3 + 1] - pos[a * 3 + 1], az = pos[b * 3 + 2] - pos[a * 3 + 2], bx = pos[c * 3] - pos[a * 3], by = pos[c * 3 + 1] - pos[a * 3 + 1], bz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const nx = ay2 * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay2 * bx, l = Math.hypot(nx, ny, nz);
    return l < 1e-12 ? 0 : ny / l;
  };
  const shSplit = E.sh > 0;
  for (let i = 0; i < st.length - 1; i++) {
    const xm = (st[i] + st[i + 1]) / 2, bedQ = rings[i].bed && rings[i + 1].bed;
    for (let r = 0; r < RN; r++) {
      const k = r < HALF - 1 ? r : RN - 1 - r; // 띠 번호(점 k → k+1)
      const a = V(i, r), b = V(i + 1, r), c = V(i + 1, r + 1), dd = V(i, r + 1);
      let m: number = MAT.paint;
      if (k === 1) m = MAT.dark;
      else if (bedQ && k >= 13) m = MAT.trim;
      else if (nrmY(a, b, dd) < -.55 && k < 12) m = MAT.dark;
      else if (k <= 5 && sd.clad && Math.abs(xm) < h - .25) m = MAT.trim;
      const g = k >= 13 ? 3 : k >= 11 && rs < .04 ? 2 : shSplit && k >= KS.feat ? 1 : 0;
      push(m, g, a, b, dd, b, c, dd);
    }
  }

  // ── 온실 ──
  const zIn0 = (x: number) => { const r = ring(x); return r.P[13 * 2 + 1] - .022; }; // 어깨 안쪽(유리 바닥 폭)
  const roofAt = (x: number) => {
    const yB = ring(x).ys + .004, mid = (cR + p.cF) / 2, half = Math.max(.2, (p.cF - cR) / 2);
    if (x >= p.cF) { const t = Math.min(1, (x - p.cF) / Math.max(.05, xc - p.cF)); return Math.max(yB, p.roof + (yB - p.roof) * t + .035 * Math.sin(Math.PI * t) * (1 - t * .3)); }
    if (x <= cR) { const t = Math.min(1, (cR - x) / Math.max(.05, cR - xd)), bulge = Math.min(.07, p.rr * .06); return Math.max(yB, p.roof + (yB - p.roof) * t ** 1.1 + bulge * Math.sin(Math.PI * t)); }
    const q = (x - mid) / half; return p.roof + .012 * (1 - q * q);
  };
  const gRing = (x: number) => {
    const r = ring(x), yB = r.ys + .004, G = roofAt(x), H = Math.max(0, G - yB), z0 = zIn0(x);
    // 5.5.1 앞유리 옆(A 기둥)은 지붕 모서리 반경을 줄여 기둥이 가늘게(긴 앞유리 차에서 넓은 차체색 면이 남던 것)
    const aT = Math.max(0, Math.min(1, (x - p.cF) / .25));
    const fr = Math.min(.022, H * .08), frT = Math.min(.018, H * .07), rc = Math.min(E.rc * (1 - .65 * aT), H * .28);
    const zt = (y: number) => z0 - E.tumble * (y - yB);
    const yW1 = Math.max(yB + fr, G - rc - frT), yW0 = Math.min(yB + fr, yW1), zA = zt(G - rc);
    const Q: number[] = [yB, z0, yW0, zt(yW0)];
    for (const t of [1 / 3, 2 / 3]) { const y = yW0 + (yW1 - yW0) * t; Q.push(y, zt(y)); }
    Q.push(yW1, zt(yW1), G - rc, zA);
    for (const a of [Math.PI / 4, Math.PI / 2]) Q.push(G - rc + rc * Math.sin(a), zA - rc + rc * Math.cos(a));
    const zr = Math.max(.05, zA - rc), cr = E.crown * .7;
    for (const f of [.88, .6, .3, 0]) Q.push(G + cr * (1 - f * f), zr * f);
    return { Q, H, G, yB };
  };
  const gx: number[] = [];
  {
    const n0 = Math.max(6, Math.ceil((cR - xd) / .05)), n1 = Math.max(6, Math.ceil((xc - p.cF) / .05));
    for (let k = 0; k <= n0; k++) gx.push(xd + (cR - xd) * (k / n0) ** .8);
    const pils = [...(p.pil ?? [.5]).map(t => cR + (p.cF - cR) * t), ...p.doors.filter(x => x > cR && x < p.cF)];
    const brk = pils.flatMap(x => [x - .045, x + .045]);
    const nm = Math.max(4, Math.ceil((p.cF - cR) / .12));
    for (let k = 1; k < nm; k++) gx.push(cR + (p.cF - cR) * k / nm);
    gx.push(...brk.filter(x => x > cR && x < p.cF));
    for (let k = 0; k <= n1; k++) gx.push(p.cF + (xc - p.cF) * (k / n1) ** 1.25);
    gx.sort((a, b) => a - b);
  }
  const G0 = pos.length / 3, GN = 2 * GH - 1;
  const gRings = gx.map(gRing);
  for (let i = 0; i < gx.length; i++) {
    const Q = gRings[i].Q;
    for (let k = 0; k < GH; k++) pos.push(gx[i], Q[k * 2], Q[k * 2 + 1]);
    for (let k = GH - 2; k >= 0; k--) pos.push(gx[i], Q[k * 2], -Q[k * 2 + 1]);
  }
  // 창 구간: 옆 유리가 있는 x 범위와 기둥(B·C) 위치
  const pilX = !p.pil && p.doors.length <= 2 ? [] : (p.pil ?? [.5]).map(t => cR + (p.cF - cR) * t); // 2도어(쿠페·스포츠카)는 옆 창 하나
  const fast = p.roofType === 'fast' ? .5 : p.roofType === 'semi' ? .28 : 0;
  const winX0 = p.deck ? cR - p.rr * fast + (fast ? 0 : .1) : p.bed != null ? cR + .05 : cR + .1;
  const pw = o.era >= 2010 ? .06 : o.era >= 1990 ? .075 : .055;
  const bBlack = o.era >= 1990, cBlack = sd.blackPillar;
  for (let i = 0; i < gx.length - 1; i++) {
    const xm = (gx[i] + gx[i + 1]) / 2, Hm = Math.min(gRings[i].H, gRings[i + 1].H);
    const inWin = xm > winX0 && Hm > .07 && xm < xc - .02, onPil = pilX.some(x => Math.abs(xm - x) < pw / 2);
    const ws = xm > p.cF + .005, rear = xm < cR - .005;
    for (let r = 0; r < GN - 1; r++) {
      const k = r < GH - 1 ? r : GN - 2 - r; // 띠 번호
      const a = G0 + i * GN + r, b = G0 + (i + 1) * GN + r, c = b + 1, dd = a + 1;
      let m: number = MAT.paint, g = k >= 7 ? 6 : k >= 5 ? 5 : 4;
      if (k <= 4) {
        if (inWin && !onPil) m = k === 0 ? (sd.beltChrome ? MAT.chrome : MAT.gloss) : k === 4 ? MAT.gloss : MAT.glass;
        else if (inWin && onPil) m = bBlack ? MAT.gloss : MAT.paint;
        else if (ws && xm < xc - .01 && Hm > .015 && k >= 1 && k <= 3 && o.era >= 1990) m = MAT.gloss; // 5.5.1 앞유리 옆 끝 삼각 창틀(검정)
        else if (rear && cBlack && xm > xd + .05) m = MAT.gloss;
      }
      if (k >= 7 && ws && Hm > .02) { m = MAT.glass; g = 7; }
      if (k >= 7 && rear && xm > xd + .03 && xm < cR - .02 && Hm > .03 && p.bed == null) { m = MAT.glass; g = 7; }
      if (k >= 8 && rear && p.bed != null && xm < cR - .02) { m = MAT.glass; g = 7; }
      if (k >= 8 && sd.sunroof && xm > cR + .2 && xm < p.cF - .12 && xm > p.cF - .9) { m = MAT.glass; g = 7; }
      push(m, g, a, b, dd, b, c, dd);
    }
  }

  // ── 하나의 BufferGeometry로: 묶음마다 꼭짓점을 따로 둔다 ──
  const nv = pos.length / 3, out: number[] = [], index: number[] = [], groups: { start: number; count: number; mat: number }[] = [];
  const keys = [...tri.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const mat = key >> 4, list = tri.get(key)!, remap = new Map<number, number>(), start = index.length;
    for (const v of list) { let j = remap.get(v); if (j == null) { j = out.length / 3; remap.set(v, j); out.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } index.push(j); }
    const lastG = groups[groups.length - 1];
    if (lastG && lastG.mat === mat) lastG.count += list.length; else groups.push({ start, count: list.length, mat });
  }
  void nv;

  // ── 표면 질의 ──
  /** 윗면(보닛·트렁크·지붕) 높이: 휜 좌표 (x, z) */
  const topY = (x: number, z: number) => {
    z = Math.abs(z);
    if (x > xd + .01 && x < xc - .01) { const g = gRing(x), Q = g.Q; for (let k = GH - 1; k > 6; k--) { const z0 = Q[k * 2 + 1], z1 = Q[k * 2 - 1]; if (z <= z1) return Q[k * 2] + (Q[k * 2 - 2] - Q[k * 2]) * (z - z0) / Math.max(1e-6, z1 - z0); } }
    const P = ring(unbend(x, z)).P;
    for (let k = HALF - 1; k > KS.top; k--) { const z0 = P[k * 2 + 1], z1 = P[k * 2 - 1]; if (z <= z1) return P[k * 2] + (P[k * 2 - 2] - P[k * 2]) * (z - z0) / Math.max(1e-6, z1 - z0); }
    return P[KS.top * 2];
  };
  // 앞뒤 끝 광선 질의: 끝 구역 삼각형을 높이 칸(2cm)으로 나눠 둔다
  const Rc = (s: number) => Math.min(hw * .95, h - p.wb - ar * .2) * (s > 0 ? 1 : 1);
  const cx = (s: number) => s * (h - Rc(s));
  const bins = new Map<string, number[]>();
  const BIN = .02;
  for (const key of keys) {
    if ((key & 15) >= 4) continue; // 온실 제외
    const list = tri.get(key)!;
    for (let t = 0; t < list.length; t += 3) {
      const a = list[t], b = list[t + 1], c = list[t + 2];
      const xmx = Math.max(pos[a * 3], pos[b * 3], pos[c * 3]), xmn = Math.min(pos[a * 3], pos[b * 3], pos[c * 3]);
      for (const s of [1, -1]) {
        if (s > 0 ? xmx < cx(1) - .12 : xmn > cx(-1) + .12) continue;
        const y0 = Math.min(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]), y1 = Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]);
        for (let j = Math.floor(y0 / BIN); j <= Math.floor(y1 / BIN); j++) { const kk = `${s}:${j}`; let arr = bins.get(kk); if (!arr) bins.set(kk, arr = []); arr.push(a, b, c); }
      }
    }
  }
  /** 앞(+1)·뒤(−1) 끝: 높이 y에서 가운데 축의 점(cx)에서 각도 th로 나가는 수평 광선이 차체 바깥면과 만나는 가장 먼 점과 법선 */
  const hit = (s: 1 | -1, th: number, y: number): Hit | null => {
    const arr = bins.get(`${s}:${Math.floor(y / BIN)}`); if (!arr) return null;
    const ox = cx(s), dx = s * Math.cos(th), dz = Math.sin(th);
    let best = -1, bn: [number, number, number] = [0, 0, 0];
    for (let t = 0; t < arr.length; t += 3) {
      const a = arr[t] * 3, b = arr[t + 1] * 3, c = arr[t + 2] * 3;
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2], e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
      // 광선 방향 (dx,0,dz)
      const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y; // dir × e2
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-12) continue;
      const tx = ox - pos[a], ty = y - pos[a + 1], tz = -pos[a + 2], u = (tx * px + ty * py + tz * pz) / det; if (u < -1e-6 || u > 1 + 1e-6) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dz * qz) / det; if (v < -1e-6 || u + v > 1 + 1e-6) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (tt > best) { best = tt; const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x, l = Math.hypot(nx, ny, nz) || 1, sg = nx * dx + nz * dz < 0 ? -1 : 1; bn = [sg * nx / l, sg * ny / l, sg * nz / l]; }
    }
    if (best < 0) return null;
    return { p: [ox + dx * best, y, dz * best], n: bn };
  };
  /** 얼굴 가로 위치(lat: 0 가운데, 1 ≈ 모서리, 1보다 크면 옆으로 감싼다) → 광선 각도 */
  const thOf = (s: number, lat: number) => Math.atan(lat * hw * .92 / Rc(s));

  return {
    position: out, index, groups, cR, ring, sideZ, tireZ, topY, hit, thOf, unbend, bent, gRing, roofAt,
    h, hw, xc, xd, yN, yHF, yDR, beltLine, upper, bedF, bedB, zIn0, archAt, wPlan, Rc,
  };
}
export type CarBodyT = ReturnType<typeof carBody>;
