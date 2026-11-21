// 외관 후보 고르기(1.0.0): 시드만으로 모양이 정해지는 구조(chassisSeed·faceSeed)는 그대로 두고,
// 기준 시드에서 결정론적으로 이어지는 시드 줄을 훑어 '서로 충분히 다른' 후보와 '조건에 맞는' 시드를 찾는다. 순수 함수(DOM·three 없음).
import type { CarLook } from './look';
import { BODY, ERA_FACE, eraOf, type GrilleKind, type IntakeKind, type LampKind, type TailKind, type WheelKind } from './shapes';
import { GRILLE, LAMP, TAIL, WHEEL, chassisOf, faceOf } from './variant';

/** 기준 시드 s0의 k번째 이웃 시드(k=0이면 s0). 같은 입력 = 같은 줄 */
export function seedAt(s0: number, k: number): number {
  if (k === 0) return s0 >>> 0;
  let h = (s0 ^ Math.imul(k, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0; h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

// ---------- 얼굴 ----------
export interface FaceParts { lamp: LampKind; bar: 'on' | 'off'; grille: GrilleKind; intake: IntakeKind; bumper: 'body' | 'black'; tail: TailKind; wheel: WheelKind }
export type FacePart = keyof FaceParts;
export const FACE_PARTS: FacePart[] = ['lamp', 'bar', 'grille', 'intake', 'bumper', 'tail', 'wheel'];
export const PART_NAME: Record<FacePart | ChassisPart, string> = {
  lamp: '전조등', bar: '가로 라이트 바', grille: '그릴', intake: '아래 흡기구', bumper: '범퍼', tail: '후미등', wheel: '휠',
  roofType: '지붕선', persona: '차대 성격', crease: '캐릭터 라인', beltChrome: '크롬 창틀', clad: '검은 클래딩', rack: '루프랙', sunroof: '선루프',
};
const INTAKE: Record<IntakeKind, string> = { wide: '넓은 흡기구', three: '3분할 흡기구', slim: '얇은 흡기구', none: '흡기구 없음', fog: '안개등' };
const BUMPER: Record<'body' | 'black', string> = { body: '차체색 범퍼', black: '검은 범퍼' };
const short = (s: string) => s.replace(/ (전조등|그릴|후미등|휠)$/, '').replace(/^그릴 없는 얼굴$/, '막힘');

export function faceParts(look: CarLook): FaceParts {
  const f = faceOf(look);
  return { lamp: f.lamp, bar: f.bar ? 'on' : 'off', grille: f.grille, intake: f.intake, bumper: f.bumper, tail: f.tail, wheel: f.wheel };
}
const evNoGrille = (look: CarLook, p: FaceParts) => look.powertrain === 'ev' && p.grille === 'none';
/** 두 얼굴에서 다른 부품 수(전기차의 막힌 그릴은 같은 것으로 본다) */
export function faceDistance(a: FaceParts, b: FaceParts): number { return FACE_PARTS.filter((k) => a[k] !== b[k]).length; }
const partLabel = (k: FacePart, v: string): string => k === 'lamp' ? LAMP[v as LampKind] : k === 'grille' ? GRILLE[v as GrilleKind] : k === 'tail' ? TAIL[v as TailKind] : k === 'wheel' ? WHEEL[v as WheelKind] : k === 'intake' ? INTAKE[v as IntakeKind] : k === 'bar' ? (v === 'on' ? '있음' : '없음') : BUMPER[v as 'body' | 'black'];
/** 바뀐 부품 한 줄: "전조등: 네모난 → 가늘고 긴, 휠: 5스포크 → 터빈" */
export function faceChange(a: CarLook, b: CarLook): string {
  const pa = faceParts(a), pb = faceParts(b);
  const out = FACE_PARTS.filter((k) => pa[k] !== pb[k] && !(k === 'grille' && evNoGrille(a, pa) && evNoGrille(b, pb))).map((k) => `${PART_NAME[k]}: ${short(partLabel(k, pa[k]))} → ${short(partLabel(k, pb[k]))}`);
  return out.length ? out.join(', ') : '얼굴 부품은 같음(크기·위치만 조금 다름)';
}

/** 후보 n개: 서로(그리고 avoid와) 부품이 minDiff개 이상 다른 얼굴 시드. page는 다음 묶음(앞 묶음이 훑은 자리부터 이어서).
 *  shortcut: 한 쪽에 시드 3000개까지만 훑고, 모자라면 기준을 1씩 낮춘다(시대 선택지가 좁을 때) */
export function faceCandidates(base: CarLook, s0: number, page = 0, avoid: CarLook[] = [], n = 6, minDiff = 3): number[] {
  let k = 0, out: number[] = [];
  for (let pg = 0; pg <= page; pg++) {
    out = [];
    for (let need = minDiff; need >= 1 && out.length < n; need--) {
      const used = [...avoid.map(faceParts), ...out.map((s) => faceParts({ ...base, faceSeed: s }))];
      for (let tries = 0; tries < 3000 && out.length < n; tries++, k++) {
        const s = seedAt(s0, k), p = faceParts({ ...base, faceSeed: s });
        if (used.every((u) => faceDistance(u, p) >= need)) { out.push(s); used.push(p); }
      }
    }
  }
  return out;
}

// ---------- 차대(옆모습) ----------
export type RoofKind = 'notch' | 'semi' | 'fast';
export interface ChassisParts { roofType: RoofKind; persona: number; crease: 0 | 1 | 2; beltChrome: boolean; clad: boolean; rack: boolean; sunroof: boolean }
export type ChassisPart = keyof ChassisParts;
export const CHASSIS_PARTS: ChassisPart[] = ['roofType', 'persona', 'crease', 'beltChrome', 'clad', 'rack', 'sunroof'];
export const PERSONA_NAME = ['낮고 긴 차', '높고 짧은 차', '쐐기형', '객실이 앞으로 나온 차', '균형'];
export const ROOF_NAME: Record<RoofKind, string> = { notch: '노치백(트렁크 따로)', semi: '세미 패스트백', fast: '패스트백' };
export function chassisParts(look: CarLook): ChassisParts {
  const c = chassisOf(look), sd = c.side;
  return { roofType: c.roofType, persona: c.persona, crease: Math.min(2, sd.crease.length) as 0 | 1 | 2, beltChrome: sd.beltChrome, clad: sd.clad, rack: sd.rack, sunroof: sd.sunroof };
}
/** 차대 차이 점수: 지붕선·성격·장식 차이 + 비례(길이·지붕·보닛·객실)가 뚜렷이 다른 항목 */
export function chassisDistance(a: CarLook, b: CarLook): number {
  const pa = chassisParts(a), pb = chassisParts(b), ca = chassisOf(a), cb = chassisOf(b);
  let d = (pa.roofType !== pb.roofType ? 1 : 0) + (pa.persona !== pb.persona ? 1 : 0) + (pa.crease !== pb.crease ? .5 : 0);
  d += (['beltChrome', 'clad', 'rack', 'sunroof'] as const).filter((k) => pa[k] !== pb[k]).length * .5;
  const hood = (c: typeof ca) => c.L / 2 - (c.cF + c.rf * .5);
  d += (Math.abs(ca.L - cb.L) > .15 ? 1 : 0) + (Math.abs(ca.roof - cb.roof) > .07 ? 1 : 0) + (Math.abs(hood(ca) - hood(cb)) > .15 ? 1 : 0) + (Math.abs((ca.cF - ca.cR) - (cb.cF - cb.cR)) > .18 ? 1 : 0);
  return d;
}
/** 바뀐 옆모습 한 줄 */
export function chassisChange(a: CarLook, b: CarLook): string {
  const pa = chassisParts(a), pb = chassisParts(b), ca = chassisOf(a), cb = chassisOf(b), out: string[] = [];
  if (pa.roofType !== pb.roofType) out.push(`지붕선: ${ROOF_NAME[pa.roofType]} → ${ROOF_NAME[pb.roofType]}`);
  if (pa.persona !== pb.persona && pa.persona >= 0 && pb.persona >= 0) out.push(`차대 성격: ${PERSONA_NAME[pa.persona]} → ${PERSONA_NAME[pb.persona]}`);
  const cm = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}cm`;
  if (Math.abs(cb.L - ca.L) > .08) out.push(`길이 ${cm(cb.L - ca.L)}`);
  if (Math.abs(cb.roof - ca.roof) > .04) out.push(`지붕 높이 ${cm(cb.roof - ca.roof)}`);
  return out.length ? out.join(', ') : '옆모습 비례가 비슷함';
}
export function chassisCandidates(base: CarLook, s0: number, page = 0, avoid: CarLook[] = [], n = 6, minDist = 2.5): number[] {
  let k = 0, out: number[] = [];
  for (let pg = 0; pg <= page; pg++) {
    out = [];
    for (let need = minDist; need > 0 && out.length < n; need -= .5) {
      const used = [...avoid, ...out.map((s) => ({ ...base, chassisSeed: s }))];
      for (let tries = 0; tries < 400 && out.length < n; tries++, k++) {
        const s = seedAt(s0, k), l = { ...base, chassisSeed: s };
        if (used.every((u) => chassisDistance(u, l) >= need)) { out.push(s); used.push(l); }
      }
    }
  }
  return out;
}

// ---------- 직접 고르기 ----------
export interface Choice { v: string; label: string; ok: boolean } // ok=false: 이 시대·차체·동력에서 나올 수 없음(흐리게)
const ALL: Record<FacePart, string[]> = {
  lamp: Object.keys(LAMP), bar: ['on', 'off'], grille: Object.keys(GRILLE), intake: Object.keys(INTAKE), bumper: ['body', 'black'], tail: Object.keys(TAIL), wheel: Object.keys(WHEEL),
};
/** 얼굴 부품별 선택지. 시대 표에 없는 부품은 흐리게. 팝업은 스포츠·쿠페만, 전기차는 그릴 없음(2030 패널 제외) */
export function faceChoices(look: CarLook): Record<FacePart, Choice[]> {
  const T = ERA_FACE[eraOf(look)], ev = look.powertrain === 'ev', sporty = look.bodyId === 'sports' || look.bodyId === 'coupe';
  const can: Record<FacePart, Set<string>> = {
    lamp: new Set(T.lamp.filter((x) => x !== 'popup' || sporty).map((x) => look.bodyId === 'kei' && x === 'swept' ? 'oval' : x === 'popup' && !sporty ? 'rect' : x)),
    bar: new Set(T.bar > 0 || (ev && eraOf(look) >= 2010) ? ['on', 'off'] : ['off']),
    grille: new Set(ev ? ['none', ...T.grille.filter((x) => x === 'panel')] : T.grille), intake: new Set(T.intake), bumper: new Set(T.bumper), tail: new Set(T.tail), wheel: new Set([...T.wheel, ...(ev ? ['aero'] : [])]),
  };
  return Object.fromEntries(FACE_PARTS.map((k) => [k, ALL[k].map((v) => ({ v, label: short(partLabel(k, v)), ok: can[k].has(v) }))])) as Record<FacePart, Choice[]>;
}
export function chassisChoices(look: CarLook): Record<ChassisPart, Choice[]> {
  const b = BODY[look.bodyId], yes = (v: boolean) => ({ v: String(v), label: v ? '있음' : '없음', ok: true });
  return {
    roofType: (['notch', 'semi', 'fast'] as RoofKind[]).map((v) => ({ v, label: ROOF_NAME[v], ok: b.deck || v === 'notch' })),
    persona: PERSONA_NAME.map((label, i) => ({ v: String(i), label, ok: true })),
    crease: [0, 1, 2].map((n) => ({ v: String(n), label: n ? `${n}줄` : '없음', ok: true })),
    beltChrome: [yes(true), yes(false)], clad: [yes(true), yes(false)], rack: [yes(true), yes(false)], sunroof: [yes(true), yes(false)],
  };
}
export type Want = Partial<Record<FacePart | ChassisPart, string>>;
/** 조건(want)을 모두 만족하는 첫 시드. 못 찾으면 가장 많이 맞는 시드와 못 맞춘 부품 이름(miss).
 *  시드 줄을 limit개까지 훑는다(얼굴 하나 계산은 수 마이크로초라 4000개도 몇 ms) */
export function findSeed(kind: 'face' | 'chassis', base: CarLook, s0: number, want: Want, limit = 4000): { seed: number; miss: string[] } {
  const keys = Object.keys(want).filter((k) => want[k as keyof Want] != null) as (FacePart | ChassisPart)[];
  const val = (l: CarLook): Record<string, string> => kind === 'face' ? faceParts(l) as unknown as Record<string, string> : Object.fromEntries(Object.entries(chassisParts(l)).map(([k, v]) => [k, String(v)]));
  let best = { seed: s0 >>> 0, hit: -1, miss: [] as string[] };
  for (let k = 0; k < limit; k++) {
    const s = seedAt(s0, k), l = kind === 'face' ? { ...base, faceSeed: s } : { ...base, chassisSeed: s }, v = val(l);
    const miss = keys.filter((x) => v[x] !== want[x]);
    if (!miss.length) return { seed: s, miss: [] };
    if (keys.length - miss.length > best.hit) best = { seed: s, hit: keys.length - miss.length, miss: miss.map((x) => PART_NAME[x]) };
  }
  return { seed: best.seed, miss: best.miss };
}
