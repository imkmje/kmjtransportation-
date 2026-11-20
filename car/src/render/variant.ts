import type { CarLook } from './look';
import { ARCH_GAP, BODY, ERA_FACE, VARY, eraOf, type BodyShape, type FaceSpec, type GrilleKind, type LampKind, type TailKind } from './shapes';

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
export interface Chassis extends BodyShape { archGap: number; dev: Record<DevKey, number> } // dev: 뽑힌 값(−1~+1), 설명용

/** 차체 기본값 + chassisSeed 변형. 시드가 없으면 BODY 그대로 */
export function chassisOf(look: CarLook): Chassis {
  const b = BODY[look.bodyId], keys = Object.keys(VARY) as DevKey[];
  const r = rng(look.chassisSeed ?? 0), has = look.chassisSeed != null;
  const dev = Object.fromEntries(keys.map(k => [k, has ? r() * 2 - 1 : 0])) as Record<DevKey, number>;
  if (!b.deck) dev.deck = 0;
  const s = 1 + VARY.len * dev.len, h = b.L * s / 2;
  const rf = b.rf * s * (1 + VARY.rake * dev.rake), rr = b.rr * s * (1 + VARY.rear * dev.rear);
  // 객실이 보닛 끝·차 꼬리를 넘지 않게 묶는다(옆선 꺾은선 점이 앞뒤 순서를 지키게)
  const cF = Math.min(b.cF * s + VARY.cab * dev.cab, h - .65 - rf);
  const cR = Math.max(b.cR * s + VARY.cab * dev.cab + VARY.deck * dev.deck, -h + rr + .2);
  const dm = (cR + cF) / 2 - (b.cR + b.cF) / 2 * s; // B필러(가운데 도어 선)가 객실을 따라간다
  const n = b.doors.length;
  return {
    ...b, dev, L: b.L * s, W: b.W + VARY.wid * dev.wid, roof: b.roof + VARY.roof * dev.roof, belt: b.belt + VARY.belt * dev.belt,
    cR, cF, rr, rf, wb: b.wb * s, archGap: ARCH_GAP + VARY.arch * dev.arch,
    doors: b.doors.map((d, i) => d * s + (i > 0 && (i < n - 1 || !b.deck) ? dm : 0)),
  };
}

/** 시대 + faceSeed로 얼굴 값. 시드가 없으면 시대 기본 얼굴(2020은 지금까지의 모습) */
export function faceOf(look: CarLook): FaceSpec {
  const era = eraOf(look), T = ERA_FACE[era], ev = look.powertrain === 'ev';
  let f: FaceSpec;
  if (look.faceSeed == null) {
    f = { ...T.def };
    if (ev && era === 2020) Object.assign(f, { lamp: 'slim', bar: true });
  } else {
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
    };
  }
  if (ev) f.grille = 'none'; // 전기차는 막힌 그릴
  return f;
}

const LAMP: Record<LampKind, string> = { round: '둥근 전조등', twin: '둥근 전조등 2쌍', rect: '네모난 전조등', oval: '타원형 전조등', vertical: '세로로 긴 전조등', swept: '위로 치켜 올라간 전조등', slim: '가늘고 긴 전조등' };
const GRILLE: Record<GrilleKind, string> = { rect: '사각 그릴', hex: '육각 그릴', twin: '위아래 2단 그릴', bars: '가로 줄무늬 그릴', none: '그릴 없는 얼굴' };
const TAIL: Record<TailKind, string> = { bar: '가로 후미등', vertical: '세로 후미등', L: 'L자 후미등', split: '나뉜 후미등', full: '좌우로 이어진 후미등' };

/** 후보 고르기 화면용 쉬운 한 줄 설명. 시드에서 실제로 뽑힌 값에서 만든다 */
export function describeLook(look: CarLook): { chassis: string; face: string } {
  const c = chassisOf(look), d = c.dev, deck = BODY[look.bodyId].deck;
  const words: [number, string][] = [
    [d.len, d.len > 0 ? '긴 차체' : '짧은 차체'],
    [d.roof, d.roof > 0 ? '높은 지붕' : '낮은 지붕'],
    [d.belt, d.belt > 0 ? '높은 허리선' : '낮은 허리선'],
    [d.rake, d.rake > 0 ? '누운 앞유리' : '곧게 선 앞유리'],
    [d.rear, d.rear > 0 ? '완만한 뒤 유리' : '가파른 뒤 유리'],
    [d.cab, d.cab > 0 ? '짧은 보닛' : '긴 보닛'],
    [deck ? d.deck : 0, d.deck > 0 ? '긴 트렁크' : '짧은 트렁크'],
    [d.arch, d.arch > 0 ? '큰 휠 아치' : '꽉 찬 휠 아치'],
  ];
  const top = words.filter(w => Math.abs(w[0]) > .45).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])).slice(0, 2).map(w => w[1]);
  const f = faceOf(look);
  const grille = look.powertrain === 'ev' ? '막힌 그릴' : GRILLE[f.grille];
  return {
    chassis: look.chassisSeed == null ? '기본 비율' : top.length ? top.join(', ') : '균형 잡힌 표준 비율',
    face: [LAMP[f.lamp] + (f.bar ? '과 가로 라이트 바' : ''), grille, TAIL[f.tail]].join(', '),
  };
}
