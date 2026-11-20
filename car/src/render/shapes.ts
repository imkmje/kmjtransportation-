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

// 시대 스타일: 끝 둥글림(re: 위아래, rpF/rpR: 평면 앞뒤), 지붕·바닥 모서리 반경, 앞뒤 좁아짐
export interface EraStyle { re: number; rpF: number; rpR: number; rc: number; rb: number; taper: number; classic: boolean }
const MODERN: EraStyle = { re: .2, rpF: .55, rpR: .42, rc: .11, rb: .07, taper: .05, classic: false };
const CLASSIC: EraStyle = { re: .09, rpF: .2, rpR: .16, rc: .045, rb: .03, taper: .02, classic: true };
export const eraStyle = (look: CarLook): EraStyle => (look.era && look.era < 1990 ? CLASSIC : MODERN);

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
  rearPlateY: .33, diffY0: .11, diffY1: .17, diffZ: .62,
  bumperY: .17, bumperH: .07, bumperD: .07, bumperInset: .12, // 1970 크롬 범퍼(지상고 위, 끝은 반폭에서 안쪽으로)
  doorGap: .012, doorLift: .002, archLift: .008,
  handleW: .14, handleBack: .12, handleDrop: .1,
} as const;
