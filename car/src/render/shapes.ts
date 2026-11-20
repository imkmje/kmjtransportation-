import type { BodyId, CarLook } from './look';

// 차대 값(단위 m, x+가 차 앞). 데모 BODY를 옮기고 소형 세단을 더했다.
export interface BodyShape {
  L: number; W: number; clr: number; belt: number; roof: number;
  cR: number; cF: number; rr: number; rf: number; // 객실 뒤·앞 끝, 뒤·앞 유리 기울기 길이
  wr: number; wb: number; // 바퀴 반지름, 축 위치(±wb)
  deck: boolean; // 트렁크가 따로 있는가(스포일러 위치)
  sill: number; // 옆 하단 어두운 띠 높이(지상고 위)
  doors: number[]; // 도어 컷 선 x 위치(앞→뒤)
  archTrim: number; // 휠 아치 테 두께
}

export const BODY: Record<BodyId, BodyShape> = {
  sedanS: { L: 4.1, W: 1.66, clr: .19, belt: .9, roof: 1.4, cR: -.9, cF: .48, rr: .5, rf: .65, wr: .3, wb: 1.22, deck: true, sill: .1, doors: [.8, -.21, -.8], archTrim: .03 },
  hatch: { L: 4.0, W: 1.72, clr: .2, belt: .92, roof: 1.46, cR: -1.4, cF: .45, rr: .3, rf: .6, wr: .31, wb: 1.25, deck: false, sill: .1, doors: [.82, -.47, -1.2], archTrim: .03 },
  sedanM: { L: 4.6, W: 1.78, clr: .2, belt: .92, roof: 1.42, cR: -1.05, cF: .55, rr: .55, rf: .7, wr: .33, wb: 1.4, deck: true, sill: .1, doors: [.95, -.25, -.95], archTrim: .03 },
  coupe: { L: 4.5, W: 1.82, clr: .15, belt: .84, roof: 1.26, cR: -.75, cF: .35, rr: .95, rf: .8, wr: .34, wb: 1.38, deck: true, sill: .1, doors: [.92, -.45], archTrim: .03 },
  suv: { L: 4.6, W: 1.86, clr: .3, belt: 1.08, roof: 1.72, cR: -1.75, cF: .6, rr: .25, rf: .6, wr: .39, wb: 1.4, deck: false, sill: .2, doors: [.9, -.575, -1.28], archTrim: .07 },
};

// 휠 크기 단계별 반지름 증가(데모의 17/19/21인치)
export const WHEEL_GROW = [0, .03, .06] as const;

// 시대 스타일: 끝 둥글림(re: 위아래, rpF/rpR: 평면 앞뒤), 지붕·바닥 모서리 반경, 앞뒤 좁아짐,
// smooth: 옆선 문지르기 횟수(많을수록 둥근 지붕선), wedge: 벨트라인이 뒤로 갈수록 올라가는 양(쐐기),
// faceW: 앞뒤 램프·범퍼 데칼이 쓰는 폭 비율(앞뒤가 많이 둥글면 모서리 밖으로 나가지 않게 좁힌다)
export type Era = 1970 | 1990 | 2010 | 2020;
export interface EraStyle { re: number; rpF: number; rpR: number; rc: number; rb: number; taper: number; smooth: number; wedge: number; faceW: number; classic: boolean }
export const ERA: Record<Era, EraStyle> = {
  1970: { re: .09, rpF: .2, rpR: .16, rc: .045, rb: .03, taper: .02, smooth: 1, wedge: .07, faceW: 1, classic: true }, // 각진 상자, 크롬 범퍼
  1990: { re: .3, rpF: .62, rpR: .52, rc: .16, rb: .1, taper: .09, smooth: 4, wedge: .04, faceW: .88, classic: false }, // 둥근 비누
  2010: { re: .16, rpF: .5, rpR: .38, rc: .09, rb: .06, taper: .06, smooth: 2, wedge: .13, faceW: 1, classic: false }, // 쐐기
  2020: { re: .2, rpF: .55, rpR: .42, rc: .11, rb: .07, taper: .05, smooth: 2, wedge: .07, faceW: 1, classic: false }, // 매끈
};
export const eraOf = (look: CarLook): Era => { const e = look.era ?? 2020; return e < 1990 ? 1970 : e < 2010 ? 1990 : e < 2020 ? 2010 : 2020; };
export const eraStyle = (look: CarLook): EraStyle => ERA[eraOf(look)];

// 차대 변형 범위(chassisSeed). 시드마다 각 값이 −1~+1 사이에서 뽑혀 이 폭을 곱한다. 보수적으로 잡았다.
export const ARCH_GAP = .055; // 휠 아치와 타이어 사이 기본 여유
export const VARY = {
  len: .04, // 전체 길이 배율 ±4%(축·객실·도어 위치도 함께 늘어남)
  wid: .02, // 폭 ±m
  roof: .04, // 지붕 높이 ±m
  belt: .03, // 벨트라인 ±m
  rake: .2, // 앞유리 기울기 길이 배율 ±
  rear: .25, // 뒤유리 기울기 길이 배율 ±
  cab: .08, // 객실 앞뒤 이동 ±m(+면 앞으로)
  deck: .08, // 트렁크 길이 ±m(트렁크 있는 차만, +면 길어짐)
  arch: .015, // 휠 아치 여유 ±m
} as const;

// 얼굴 선택지(faceSeed). 시대마다 고를 수 있는 모양이 다르다. 같은 항목을 두 번 넣으면 그만큼 자주 뽑힌다.
export type LampKind = 'round' | 'twin' | 'rect' | 'oval' | 'vertical' | 'swept' | 'slim';
export type GrilleKind = 'rect' | 'hex' | 'twin' | 'bars' | 'none';
export type IntakeKind = 'wide' | 'three' | 'slim' | 'none';
export type TailKind = 'bar' | 'vertical' | 'L' | 'split' | 'full';
export interface FaceSpec {
  lamp: LampKind; lampW: number; lampDy: number; bar: boolean; // lampW: 크기 배율, lampDy: 높이 이동(m), bar: 앞 가로 라이트 바
  grille: GrilleKind; grilleW: number; grilleH: number;
  intake: IntakeKind; bumper: 'body' | 'black';
  tail: TailKind; tailDy: number;
  plateF: 'center' | 'offset'; plateR: 'low' | 'high';
}
export const ERA_FACE: Record<Era, { lamp: LampKind[]; grille: GrilleKind[]; intake: IntakeKind[]; bumper: FaceSpec['bumper'][]; tail: TailKind[]; bar: number; grilleW: [number, number]; def: FaceSpec }> = {
  1970: { lamp: ['round', 'twin', 'rect'], grille: ['rect', 'bars', 'twin'], intake: ['slim', 'none', 'wide'], bumper: ['body'], tail: ['bar', 'vertical', 'split'], bar: 0, grilleW: [.85, 1.15],
    def: { lamp: 'round', lampW: 1, lampDy: 0, bar: false, grille: 'rect', grilleW: 1, grilleH: 1, intake: 'wide', bumper: 'body', tail: 'bar', tailDy: 0, plateF: 'center', plateR: 'high' } },
  1990: { lamp: ['oval', 'rect', 'vertical', 'oval'], grille: ['rect', 'bars', 'none'], intake: ['wide', 'slim', 'three'], bumper: ['body', 'black'], tail: ['bar', 'L', 'vertical'], bar: 0, grilleW: [.8, 1.1],
    def: { lamp: 'oval', lampW: 1, lampDy: 0, bar: false, grille: 'rect', grilleW: 1, grilleH: 1, intake: 'wide', bumper: 'body', tail: 'bar', tailDy: 0, plateF: 'center', plateR: 'high' } },
  2010: { lamp: ['swept', 'swept', 'slim', 'rect'], grille: ['hex', 'twin', 'rect'], intake: ['three', 'wide', 'slim'], bumper: ['body', 'black'], tail: ['L', 'split', 'bar'], bar: .15, grilleW: [1.1, 1.4],
    def: { lamp: 'swept', lampW: 1, lampDy: 0, bar: false, grille: 'hex', grilleW: 1.2, grilleH: 1, intake: 'three', bumper: 'body', tail: 'L', tailDy: 0, plateF: 'center', plateR: 'high' } },
  2020: { lamp: ['slim', 'slim', 'vertical', 'rect'], grille: ['hex', 'none', 'twin', 'bars'], intake: ['wide', 'three', 'slim'], bumper: ['body', 'black'], tail: ['full', 'L', 'split'], bar: .5, grilleW: [.9, 1.3],
    def: { lamp: 'rect', lampW: 1, lampDy: 0, bar: false, grille: 'rect', grilleW: 1, grilleH: 1, intake: 'wide', bumper: 'body', tail: 'bar', tailDy: 0, plateF: 'center', plateR: 'high' } },
};

// 얼굴·뒷모습 부품 배치(높이는 벨트라인 아래 또는 지상고 위 거리, 폭은 반폭 hw의 비율)
export const FACE = {
  lift: .003, // 데칼을 표면에서 띄우는 거리
  lampDrop: .25, lampH: .085, lampZ0: .5, lampZ1: .86,
  roundLampR: .082, roundLampZ: .7, roundRing: .02,
  grilleZ: .36, grilleUp: .04, grilleDown: .1, grilleFrame: .015, classicGrilleZ: .44,
  barH: .03, barZ: .82, // 전기차 가로 라이트 바
  plateW: .52, plateH: .11, plateY: .2, // 번호판(52×11cm)
  intakeY0: .11, intakeY1: .17, intakeZ: .5, evIntakeZ: .32,
  tailDrop: .15, tailH: .09, tailZ0: .45, tailZ1: .9, classicTailZ0: .52, classicTailZ1: .82, classicTailH: .12,
  rearPlateY: .33, rearPlateLowY: .19, diffY0: .11, diffY1: .17, diffZ: .62,
  bumperY: .17, bumperH: .07, bumperD: .07, bumperInset: .12, // 1970 크롬 범퍼(지상고 위, 끝은 반폭에서 안쪽으로)
  doorGap: .012, doorLift: .002, archLift: .008,
  handleW: .14, handleBack: .12, handleDrop: .1,
} as const;
