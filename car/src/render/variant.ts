import type { CarLook } from './look';
import type { BodyId } from './look';
import { ARCH_GAP, BELT_OVER_ARCH, BODY, ERA, ERA_FACE, MIN_CABIN, MIN_OVERHANG, MIN_ROOF_GAP, MIN_TRUNK, VARY, WHEEL_GROW, eraOf, type BodyShape, type FaceSpec, type GrilleKind, type LampKind, type TailKind, type WheelKind } from './shapes';

// 시드 → 값. 같은 시드면 항상 같은 수열(mulberry32). Math.random은 쓰지 않는다.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DevKey = keyof typeof VARY;
/** 옆면·지붕 장식(chassisSeed와 시대로 정한다. 같은 차대면 페이스리프트해도 그대로) */
export interface SideSpec {
  crease: number[]; // 캐릭터 라인 높이(문턱 0 → 허리선 1 비율). 0~2개
  kick: number; // 캐릭터 라인이 뒤로 갈수록 올라가는 양(m)
  beltChrome: boolean; // 옆 창 아래 크롬 띠
  strip: 'none' | 'dark' | 'chrome'; // 문 가운데 가로 몰딩
  sunroof: boolean; rack: boolean; // 선루프, 루프랙
  clad: boolean; // 휠 아치·문턱 검은 몰딩(두껍게)
  blackPillar: boolean; // 뒤 필러를 검게 칠해 지붕이 떠 보이게
}
export interface Chassis extends BodyShape {
  archGap: number; archY: number; archR: number; // 휠 아치 여유, 아치 원 중심 높이·반지름(휠 크기와 무관하게 고정)
  side: SideSpec;
  roofType: RoofType; // 노치백(트렁크 따로)·세미 패스트백·패스트백
  wedge: number; // 허리선이 뒤로 갈수록 올라가는 양(m, 시대 + 시드)
  dev: Record<DevKey, number>; // 뽑힌 값(−1~+1)
}

const warned = new Set<string>();
/** 차체 기본값. 모르는 id면 중형 세단으로 그리고 콘솔에 한 번만 경고 */
export function bodyOf(id: string): BodyShape {
  const b = BODY[id as BodyId];
  if (b) return b;
  if (!warned.has(id)) { warned.add(id); console.warn(`알 수 없는 차체 '${id}': 중형 세단으로 그린다`); }
  return BODY.sedanM;
}

function sideOf(look: CarLook, b: BodyShape): SideSpec {
  const id = look.bodyId, era = eraOf(look);
  if (look.chassisSeed == null) return { crease: [.62], kick: 0, beltChrome: era === 1970, strip: 'none', sunroof: false, rack: false, clad: !!b.bed || !!b.suv, blackPillar: false };
  const q = rng(Math.imul(look.chassisSeed, 0x85ebca6b) ^ 0x2c1b3c6d), x = () => q();
  const old = era <= 1980, nc = x(), c1 = .45 + .3 * x(), c2 = .15 + .15 * x(), kick = x(), bc = x(), st = x(), sr = x(), rk = x(), cl = x(), bp = x();
  return {
    // 2010은 날 선 캐릭터 라인(늘 1~2줄, 뒤로 치켜 오름), 2020은 매끈한 면(없거나 1줄)
    crease: era === 2010 ? (nc < .45 ? [c1] : [c1, c2]) : era === 2020 ? (nc < .5 ? [] : [c1]) : nc < (old ? .35 : .15) ? [] : nc < (old ? .9 : .7) ? [c1] : [c1, c2],
    kick: era === 2010 ? .05 + .07 * kick : era === 2020 ? .02 * kick : era === 1990 ? .02 * kick : 0,
    beltChrome: id === 'sedanL' || bc < { 1970: .85, 1980: .45, 1990: .3, 2010: .5, 2020: .12 }[era], // 대형 세단은 늘 크롬 띠. 2010은 크롬 창틀이 흔하고 2020은 드물다
    strip: old ? (st < .45 ? (era === 1970 ? 'chrome' : 'dark') : st < .65 ? 'dark' : 'none') : era === 1990 && st < .4 ? 'dark' : 'none',
    sunroof: sr < (id === 'pickup' || id === 'kei' ? .15 : .35),
    rack: rk < (({ suvS: .6, suv: .85, suvL: .9, minivan: .45, hatch: .2, kei: .2 } as Partial<Record<BodyId, number>>)[id] ?? 0),
    clad: b.suv ? cl < (era === 2020 ? .45 : .85) : b.bed ? true : (id === 'hatch' || id === 'kei') && cl < (era === 2020 ? .1 : .3), // 2020은 검은 클래딩이 줄어든다
    blackPillar: era >= 2010 && !b.bed && bp < (era === 2020 ? .55 : .2), // 떠 있는 지붕은 2020년대 유행
  };
}

const PERSONA: Partial<Record<DevKey, number>>[] = [
  { len: .7, roof: -.8, belt: -.5, wbr: .6, rake: .6, rear: .3 }, // 낮고 긴 차
  { len: -.7, roof: .8, belt: .5, wbr: -.5, rake: -.6, rear: -.4 }, // 높고 짧은 차
  { wedge: .9, belt: .4, rake: .7, cab: -.4, roof: -.3 }, // 쐐기형(긴 보닛)
  { cab: .8, rake: .5, deck: .5, wbr: .5, roof: .3 }, // 객실이 앞으로 나온 차(짧은 보닛)
  {}, // 균형
];
export type RoofType = 'notch' | 'semi' | 'fast';
// 뒤 유리 길이(m): 노치백은 .6 이하, 세미 .8~1.0, 패스트백 1.1~1.3(지붕선이 트렁크 끝 가까이 흐른다)
const REAR: Record<RoofType, (rr: number) => number> = { notch: rr => Math.min(rr, .6), semi: rr => Math.min(1, Math.max(.8, rr * 1.5)), fast: rr => Math.min(1.3, Math.max(1.1, rr * 2.2)) };

/** 차체 기본값 + 시대 비례 + chassisSeed 변형. 시드가 없으면 BODY(시대 비례만 반영) */
export function chassisOf(look: CarLook): Chassis {
  const b = bodyOf(look.bodyId), keys = Object.keys(VARY) as DevKey[], E = ERA[eraOf(look)], ev = look.powertrain === 'ev';
  const r = rng(look.chassisSeed ?? 0), has = look.chassisSeed != null;
  const dev = Object.fromEntries(keys.map(k => [k, has ? r() * 2 - 1 : 0])) as Record<DevKey, number>;
  // 성격: 변이 축끼리 함께 움직여 한눈에 다른 차가 되게(낮고 긴 / 높고 짧은 / 쐐기 / 객실 앞쪽 / 균형)
  const pc = has ? Math.floor(r() * PERSONA.length) : -1;
  if (pc >= 0) for (const k of keys) dev[k] = Math.max(-1.4, Math.min(1.4, dev[k] * .65 + (PERSONA[pc][k] ?? 0)));
  if (!b.deck) dev.deck = 0;
  if (b.suv && dev.roof < 0) dev.roof *= .45; // SUV는 지붕이 많이 낮아지면 왜건처럼 보인다
  // 지붕선 유형: 트렁크 있는 차만(쿠페·스포츠카는 패스트백이 더 흔하다)
  const rt = has ? r() : 0, sporty = look.bodyId === 'coupe' || look.bodyId === 'sports';
  const roofType: RoofType = !b.deck ? 'notch' : rt < (sporty ? .3 : .5) ? 'notch' : rt < (sporty ? .6 : .8) ? 'semi' : 'fast';
  const s = E.len * (1 + VARY.len * dev.len), h = b.L * s / 2, tmin = b.deck ? MIN_TRUNK : .2;
  let rf = b.rf * s * (1 + VARY.rake * dev.rake), rr = b.rr * s * (1 + VARY.rear * dev.rear);
  if (b.deck) rr = REAR[roofType](rr);
  // 전기차는 보닛이 짧다(객실을 앞으로)
  const cab = VARY.cab * dev.cab + (ev && eraOf(look) >= 2010 ? .22 : 0);
  const minCab = roofType === 'notch' ? MIN_CABIN : .8; // 패스트백은 지붕이 짧으면 혹처럼 솟는다
  // 앞유리 아래 끝(보닛 길이)은 객실 이동만 따르고, 기울기는 지붕 앞 끝을 옮긴다. 보닛 .65m·트렁크 최소는 남긴다
  const base = Math.min((b.cF + b.rf) * s + cab, h - .65);
  const room = base - (-h + tmin) - minCab; // 앞뒤 유리가 쓸 수 있는 길이(극단 시드에서 객실이 찌그러지지 않게 유리를 줄인다)
  if (rr + rf > room) { const k = room / (rr + rf); rr *= k; rf *= k; }
  const cR = Math.max(b.cR * s + cab + VARY.deck * dev.deck, -h + rr + tmin);
  const cF = Math.max(base - rf, cR + minCab);
  const side = sideOf(look, b);
  // 휠 아치: 가장 큰 휠 기준 원(중심 높이 archY). 허리선은 아치 꼭대기보다 BELT_OVER_ARCH 위(부푼 펜더 차체 제외)
  const wr0 = b.wr + E.wrD, archGap = ARCH_GAP + VARY.arch * dev.arch, archY = wr0 + WHEEL_GROW[2], archR = archY + archGap;
  // 휠베이스: 시대·시드 배율, 아치 바깥 오버행은 MIN_OVERHANG(차체 기본이 더 짧으면 그 값) 이상
  const oh = Math.min(MIN_OVERHANG, b.L / 2 - b.wb - (b.wr + WHEEL_GROW[2] + ARCH_GAP));
  const wb = Math.min(b.wb * s * E.wbK * (1 + VARY.wbr * dev.wbr) * (ev ? 1.03 : 1), h - archR - oh);
  // 쐐기가 크면 앞바퀴 위 옆선이 내려가므로 허리선을 그만큼 올린다(아치가 보닛 위로 솟지 않게)
  const wedge = Math.max(0, E.wedge + VARY.wedge * dev.wedge), wedgeAtFront = wedge * (h + wb) / (2 * h);
  const belt = Math.max(b.belt + E.beltD + VARY.belt * dev.belt, b.fenders ? 0 : archY + archR + Math.max(BELT_OVER_ARCH, .05 + wedgeAtFront));
  // 가운데 도어 선은 객실 안 같은 비율 자리를 따라간다(필러와 어긋나지 않게)
  const n = b.doors.length, at = (d: number) => cR + (cF - cR) * (d * s - b.cR * s) / ((b.cF - b.cR) * s);
  const doors = b.doors.map((d, i) => i > 0 && (i < n - 1 || !b.deck) ? at(d) : d * s);
  return {
    ...b, dev, side, roofType, L: b.L * s, W: b.W + VARY.wid * dev.wid, belt, roof: Math.max(b.roof + E.roofD + VARY.roof * dev.roof, belt + MIN_ROOF_GAP),
    cR, cF, rr, rf: base - cF, wb, archGap, archY, archR, archTrim: side.clad ? Math.max(b.archTrim, .065) : b.archTrim,
    wr: wr0 + WHEEL_GROW[look.wheel ?? 1], doors, wedge,
  };
}

/** 옆모습 치수(설명용). 눈에 보이는 길이: 보닛은 앞 끝 ~ 앞유리 높이 절반, 트렁크는 뒤 끝 ~ 뒤 유리 높이 절반 */
export function measureChassis(c: Chassis): Record<'len' | 'roof' | 'belt' | 'hood' | 'trunk' | 'rake' | 'rear' | 'cabin' | 'arch', number> {
  const h = c.L / 2, g = c.roof - c.belt;
  return { len: c.L, roof: c.roof, belt: c.belt, hood: h - (c.cF + c.rf * .5), trunk: c.deck ? c.cR - c.rr * .5 + h : NaN, rake: c.rf / g, rear: c.rr / g, cabin: c.cF - c.cR, arch: c.archGap };
}
type MKey = keyof ReturnType<typeof measureChassis>;
const stats = new Map<string, Record<MKey, [number, number]>>();
/** 차체 종류·시대·전기차 여부별 치수 평균·표준편차(시드 1~300). 설명 문턱값의 기준(같은 시대 같은 차체끼리 비교) */
export function chassisStats(look: CarLook): Record<MKey, [number, number]> {
  const era = eraOf(look), ev = look.powertrain === 'ev', key = `${look.bodyId}|${era}|${ev}`;
  let st = stats.get(key);
  if (!st) {
    const ms = Array.from({ length: 300 }, (_, i) => measureChassis(chassisOf({ bodyId: look.bodyId, powertrain: ev ? 'ev' : 'gas', color: '#000', wheel: 1, era, chassisSeed: i + 1 })));
    st = Object.fromEntries((Object.keys(ms[0]) as MKey[]).map(k => {
      const v = ms.map(m => m[k]), mu = v.reduce((a, b) => a + b, 0) / v.length;
      return [k, [mu, Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length)]];
    })) as Record<MKey, [number, number]>;
    stats.set(key, st);
  }
  return st;
}
export const DESC_Z = 1; // 평균에서 표준편차 이만큼 벗어나야 특징으로 말한다
const WORDS: Record<MKey, [string, string]> = {
  len: ['긴 차체', '짧은 차체'], roof: ['높은 지붕', '낮은 지붕'], belt: ['높은 허리선', '낮은 허리선'], hood: ['긴 보닛', '짧은 보닛'],
  trunk: ['긴 트렁크', '짧은 트렁크'], rake: ['누운 앞유리', '곧게 선 앞유리'], rear: ['완만한 뒤 유리', '가파른 뒤 유리'],
  cabin: ['긴 객실', '짧은 객실'], arch: ['큰 휠 아치', '꽉 찬 휠 아치'],
};
/** 실제 치수가 차체 평균에서 가장 많이 벗어난 특징 2개(설명·테스트 공용) */
export function chassisWords(look: CarLook): string[] {
  const m = measureChassis(chassisOf(look)), st = chassisStats(look);
  return (Object.keys(WORDS) as MKey[]).map(k => [k, st[k][1] > 1e-6 ? (m[k] - st[k][0]) / st[k][1] : 0] as const)
    .filter(([, z]) => Math.abs(z) > DESC_Z).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 2)
    .map(([k, z]) => WORDS[k][z > 0 ? 0 : 1]);
}

/** 시대 + faceSeed로 얼굴 값. 시드가 없으면 시대 기본 얼굴(2020은 지금까지의 모습) */
export function faceOf(look: CarLook): FaceSpec {
  const era = eraOf(look), T = ERA_FACE[era], ev = look.powertrain === 'ev';
  let f: FaceSpec;
  if (look.faceSeed == null) f = { ...T.def };
  else {
    const r = rng(Math.imul(look.faceSeed, 0x9e3779b1) ^ 0x5bd1e995);
    const pick = <K>(a: K[]) => a[Math.floor(r() * a.length)];
    const range = (lo: number, hi: number) => lo + (hi - lo) * r();
    const lamp = pick(T.lamp), barOk = lamp === 'slim' || lamp === 'rect' || lamp === 'swept', rb = r(); // rb는 늘 뽑아 동력과 상관없이 수열이 같게
    f = {
      lamp, lampW: range(.85, 1.15), lampDy: range(-.02, .02), bar: barOk && (rb < T.bar || (ev && era >= 2010)),
      grille: pick(T.grille), grilleW: range(...T.grilleW), grilleH: range(.8, 1.3),
      intake: pick(T.intake), bumper: pick(T.bumper),
      tail: pick(T.tail), tailDy: range(-.02, .02),
      plateF: r() < .2 ? 'offset' : 'center', plateR: era === 1970 || r() < .5 ? 'high' : 'low', // 1970은 크롬 범퍼가 아래 번호판을 가린다
      wheel: pick(T.wheel),
    };
    if (ev && r() < .5) f.wheel = 'aero';
  }
  if (f.lamp === 'popup' && look.bodyId !== 'sports' && look.bodyId !== 'coupe') f.lamp = 'rect'; // 팝업 램프는 스포츠카·쿠페만
  if (ev) f.grille = 'none'; // 전기차는 막힌 그릴
  return f;
}

/** 앞얼굴을 한눈에 가르는 값(전조등·그릴, 전기차는 그릴 대신 흡기구·라이트 바) */
const frontKey = (look: CarLook): string => { const f = faceOf(look); return `${f.lamp}|${look.powertrain === 'ev' ? f.intake : f.grille}|${f.bar}`; };
/** 얼굴 후보 시드를 서로(그리고 avoid와) 앞얼굴이 겹치지 않게 고친다. 겹치면 시드를 1씩 올려 다음 값을 본다(같은 입력 = 같은 결과).
    shortcut: 64번 안에 못 찾으면 원래 시드를 그대로 쓴다(시대 선택지가 아주 좁을 때), 선택지를 넓히면 줄어든다 */
export function distinctFaces(base: CarLook, seeds: number[], avoid?: CarLook): number[] {
  const used = new Set(avoid ? [frontKey(avoid)] : []);
  return seeds.map((s0) => {
    for (let k = 0; k < 64; k++) {
      const s = (s0 + k) >>> 0, key = frontKey({ ...base, faceSeed: s });
      if (!used.has(key)) { used.add(key); return s; }
    }
    return s0;
  });
}

const LAMP: Record<LampKind, string> = { round: '둥근 전조등', twin: '둥근 전조등 2쌍', rect: '네모난 전조등', oval: '타원형 전조등', vertical: '세로로 긴 전조등', swept: '위로 치켜 올라간 전조등', slim: '가늘고 긴 전조등', popup: '팝업 전조등', projector: '렌즈형 전조등' };
const GRILLE: Record<GrilleKind, string> = { rect: '사각 그릴', hex: '육각 그릴', twin: '위아래 2단 그릴', bars: '가로 줄무늬 그릴', none: '그릴 없는 얼굴', mesh: '그물 그릴', vertical: '세로 줄무늬 그릴', kidney: '좌우로 나뉜 그릴', wide: '전조등까지 이어진 넓은 그릴' };
const TAIL: Record<TailKind, string> = { bar: '가로 후미등', vertical: '세로 후미등', L: 'L자 후미등', split: '나뉜 후미등', full: '좌우로 이어진 후미등', round: '둥근 후미등' };
const WHEEL: Record<WheelKind, string> = { twin5: '더블 5스포크 휠', spoke5: '5스포크 휠', multi: '멀티 스포크 휠', mesh: '그물 휠', turbine: '터빈 휠', steel: '철제 휠과 휠캡', aero: '막힌 공력 휠' };

/** 후보 고르기 화면용 쉬운 한 줄 설명. 차대는 실제 치수를 차체 평균과 비교해서, 얼굴은 뽑힌 부품에서 만든다 */
export function describeLook(look: CarLook): { chassis: string; face: string } {
  const c = chassisOf(look), top = chassisWords(look), sd = c.side;
  const extra = c.roofType === 'fast' ? '패스트백' : c.roofType === 'semi' ? '세미 패스트백' : sd.sunroof ? '선루프' : sd.rack ? '루프랙' : sd.blackPillar ? '떠 있는 지붕' : sd.beltChrome ? '크롬 창틀' : '';
  const f = faceOf(look);
  const grille = look.powertrain === 'ev' ? '막힌 그릴' : GRILLE[f.grille];
  return {
    chassis: look.chassisSeed == null ? '기본 비율' : (top.length ? top.join(', ') : '균형 잡힌 표준 비율') + (extra ? ` · ${extra}` : ''),
    face: [LAMP[f.lamp] + (f.bar ? '과 가로 라이트 바' : ''), grille, TAIL[f.tail], WHEEL[f.wheel]].join(', '),
  };
}
