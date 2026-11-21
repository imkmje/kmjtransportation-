import type { BodyId, CarLook } from './look';

// 차대 값(단위 m, x+가 차 앞). 데모 BODY를 옮기고 소형 세단·대형 세단·미니밴·경차·픽업·스포츠카를 더했다.
export interface BodyShape {
  L: number; W: number; clr: number; belt: number; roof: number;
  cR: number; cF: number; rr: number; rf: number; // 객실 뒤·앞 끝, 뒤·앞 유리 기울기 길이
  wr: number; wb: number; // 바퀴 반지름, 축 위치(±wb)
  deck: boolean; // 트렁크가 따로 있는가(스포일러 위치)
  sill: number; // 옆 하단 어두운 띠 높이(지상고 위)
  doors: number[]; // 도어 컷 선 x 위치(앞→뒤)
  archTrim: number; // 휠 아치 테 두께
  pil?: number[]; // 옆 창을 나누는 필러 위치(객실 뒤 끝 0 → 앞 끝 1 비율). 없으면 [.5](창 2장)
  bed?: number; // 열린 짐칸 바닥 높이(땅에서 m). 있으면 객실 뒤부터 꼬리문 앞까지가 짐칸
  nose?: number; // 앞 끝이 벨트라인보다 내려가는 양(없으면 .2)
  edge?: number; // 앞뒤 끝 둥글림 배율(없으면 1, 작을수록 각진 앞뒤)
  spoiler?: boolean; // 뒤 스포일러 기본
  fenders?: boolean; // 휠 아치가 허리선 위로 솟아도 된다(쿠페·스포츠카의 부푼 펜더). 아니면 허리선을 아치 위로 올린다
  suv?: boolean; // SUV 계열(스키드 플레이트·클래딩·루프랙)
}

export const BODY: Record<BodyId, BodyShape> = {
  sedanS: { L: 4.1, W: 1.66, clr: .19, belt: .9, roof: 1.4, cR: -.9, cF: .48, rr: .5, rf: .65, wr: .3, wb: 1.22, deck: true, sill: .1, doors: [.8, -.21, -.8], archTrim: .03 },
  hatch: { L: 4.0, W: 1.72, clr: .2, belt: .92, roof: 1.46, cR: -1.4, cF: .45, rr: .3, rf: .6, wr: .31, wb: 1.25, deck: false, sill: .1, doors: [.82, -.47, -1.2], archTrim: .03 },
  sedanM: { L: 4.6, W: 1.78, clr: .2, belt: .92, roof: 1.42, cR: -1.05, cF: .55, rr: .55, rf: .7, wr: .33, wb: 1.4, deck: true, sill: .1, doors: [.95, -.25, -.95], archTrim: .03 },
  coupe: { L: 4.5, W: 1.82, clr: .15, belt: .84, roof: 1.26, cR: -.75, cF: .35, rr: .95, rf: .8, wr: .34, wb: 1.38, deck: true, sill: .1, doors: [.92, -.45], archTrim: .03, fenders: true },
  // SUV 3종: 소형은 짧고 높은 도시형(짧은 오버행), 중형은 기존 SUV, 대형은 길고 각진 3열(긴 휠베이스·높은 지붕·큰 휠, 뒤 쿼터 창 하나 더)
  suvS: { L: 4.2, W: 1.78, clr: .26, belt: 1.0, roof: 1.62, cR: -1.55, cF: .5, rr: .28, rf: .58, wr: .35, wb: 1.3, deck: false, sill: .16, doors: [.84, -.525, -1.2], archTrim: .05, nose: .17, suv: true },
  suv: { L: 4.6, W: 1.86, clr: .3, belt: 1.08, roof: 1.72, cR: -1.75, cF: .6, rr: .25, rf: .6, wr: .39, wb: 1.4, deck: false, sill: .2, doors: [.9, -.575, -1.28], archTrim: .07, suv: true },
  suvL: { L: 5.05, W: 1.96, clr: .32, belt: 1.14, roof: 1.86, cR: -2.05, cF: .66, rr: .18, rf: .62, wr: .42, wb: 1.62, deck: false, sill: .22, doors: [.98, -.29, -1.24], archTrim: .075, pil: [.3, .65], nose: .14, edge: .7, suv: true },
  sedanL: { L: 5.1, W: 1.88, clr: .18, belt: .9, roof: 1.44, cR: -1.22, cF: .58, rr: .58, rf: .78, wr: .35, wb: 1.5, deck: true, sill: .1, doors: [1.06, -.12, -1.12], archTrim: .03, nose: .17 },
  minivan: { L: 4.8, W: 1.9, clr: .19, belt: .98, roof: 1.72, cR: -2.0, cF: .5, rr: .22, rf: 1.08, wr: .34, wb: 1.5, deck: false, sill: .12, doors: [1.02, 0, -1.0], archTrim: .04, pil: [.4, .8], nose: .15 },
  kei: { L: 3.4, W: 1.48, clr: .15, belt: .86, roof: 1.52, cR: -1.36, cF: .44, rr: .16, rf: .56, wr: .27, wb: 1.14, deck: false, sill: .09, doors: [.76, -.32, -.78], archTrim: .03, pil: [.58], nose: .14, edge: .6 },
  pickup: { L: 5.2, W: 1.9, clr: .3, belt: 1.1, roof: 1.84, cR: -.6, cF: .7, rr: .2, rf: .55, wr: .4, wb: 1.6, deck: false, sill: .18, doors: [1.08, .05, -.66], archTrim: .07, bed: .72, nose: .1, edge: .55 },
  sports: { L: 4.4, W: 1.94, clr: .1, belt: .74, roof: 1.1, cR: -.95, cF: .06, rr: .78, rf: 1.0, wr: .3, wb: 1.32, deck: true, sill: .08, doors: [.86, -.72], archTrim: .03, nose: .26, spoiler: true, fenders: true },
};

// 휠 크기 단계별 타이어 반지름 증가와 림 비율(실제 차처럼 큰 휠은 타이어가 얇아져 바깥 지름은 조금만 는다).
// 휠 아치는 가장 큰 휠 기준으로 고정한다: 휠을 바꿔도 옆 윤곽이 그대로다(페이스리프트에서 휠만 바뀌는 경우)
export const WHEEL_GROW = [0, .02, .04] as const;
export const RIM_RATIO = [.6, .66, .73] as const;
export const BELT_OVER_ARCH = .13; // 허리선이 휠 아치 꼭대기보다 최소 이만큼 위(fenders 차체 제외)

// 시대 스타일: 끝 둥글림(re: 위아래, rpF/rpR: 평면 앞뒤), 지붕·바닥 모서리 반경, 앞뒤 좁아짐,
// smooth: 옆선 문지르기 횟수(많을수록 둥근 지붕선), wedge: 벨트라인이 뒤로 갈수록 올라가는 양(쐐기),
// faceW: 앞뒤 램프·범퍼 데칼이 쓰는 폭 비율(앞뒤가 많이 둥글면 모서리 밖으로 나가지 않게 좁힌다)
export type Era = 1970 | 1980 | 1990 | 2010 | 2020;
// 단면 모양: tumble 옆 유리가 위로 갈수록 안쪽으로 눕는 양(텀블홈), crown 보닛·지붕 가운데 볼록, bow 옆판 배부름,
// tuck 옆판 아래 말아 넣기, chin 앞뒤 끝 바닥 턱 말아 올림. 비례: len 전장 배율, roofD·beltD 지붕·허리선 ±m, wbK 휠베이스 배율, wrD 타이어 반지름 ±m
export interface EraStyle {
  re: number; rpF: number; rpR: number; rc: number; rb: number; taper: number; smooth: number; wedge: number; faceW: number; classic: boolean;
  tumble: number; crown: number; bow: number; tuck: number; chin: number;
  len: number; roofD: number; beltD: number; wbK: number; wrD: number;
}
export const ERA: Record<Era, EraStyle> = {
  // 길고 낮고 각진 3박스, 평평한 면, 긴 오버행·작은 바퀴, 크롬 범퍼
  1970: { re: .08, rpF: .14, rpR: .12, rc: .035, rb: .025, taper: .015, smooth: 1, wedge: .02, faceW: 1, classic: true, tumble: .1, crown: .01, bow: .004, tuck: .02, chin: .015, len: 1.05, roofD: -.06, beltD: -.04, wbK: .95, wrD: -.02 },
  // 쐐기형 직선: 앞이 낮고 뒤가 높은 허리선, 날 선 모서리, 검은 수지 범퍼
  1980: { re: .06, rpF: .22, rpR: .16, rc: .025, rb: .025, taper: .03, smooth: 1, wedge: .16, faceW: 1, classic: false, tumble: .16, crown: .012, bow: .004, tuck: .03, chin: .03, len: 1.01, roofD: -.03, beltD: -.03, wbK: .97, wrD: -.01 },
  // 모서리 둥근 비누형: 크게 둥근 끝, 배부른 옆판, 많이 누운 옆 유리
  1990: { re: .32, rpF: .66, rpR: .56, rc: .18, rb: .12, taper: .1, smooth: 4, wedge: .04, faceW: .86, classic: false, tumble: .34, crown: .055, bow: .04, tuck: .09, chin: .08, len: 1, roofD: 0, beltD: 0, wbK: 1, wrD: 0 },
  // 높은 허리선·짧은 오버행·큰 바퀴, 쐐기
  2010: { re: .16, rpF: .5, rpR: .38, rc: .09, rb: .06, taper: .06, smooth: 2, wedge: .12, faceW: 1, classic: false, tumble: .3, crown: .04, bow: .02, tuck: .065, chin: .06, len: 1, roofD: .02, beltD: .05, wbK: 1.04, wrD: .04 },
  // 매끈한 면, 짧은 앞 오버행(전기차는 휠베이스 더 길고 보닛 짧게: variant.chassisOf)
  2020: { re: .2, rpF: .58, rpR: .44, rc: .11, rb: .07, taper: .05, smooth: 3, wedge: .06, faceW: 1, classic: false, tumble: .32, crown: .05, bow: .032, tuck: .07, chin: .08, len: 1, roofD: 0, beltD: .08, wbK: 1.06, wrD: .03 },
};
export const eraOf = (look: CarLook): Era => { const e = look.era ?? 2020; return e < 1980 ? 1970 : e < 1990 ? 1980 : e < 2010 ? 1990 : e < 2020 ? 2010 : 2020; };
export const eraStyle = (look: CarLook): EraStyle => ERA[eraOf(look)];

// 차대 변형 범위(chassisSeed). 시드마다 각 값이 −1~+1 사이에서 뽑혀 이 폭을 곱한다.
// 풀체인지가 확 달라 보이게 지붕·벨트·유리·객실 위치를 넓게 잡았다(모양이 깨지지 않게 chassisOf에서 묶는다).
export const ARCH_GAP = .055; // 휠 아치와 타이어 사이 기본 여유
export const VARY = {
  len: .08, // 전체 길이 배율 ±8%(축·객실·도어 위치도 함께 늘어남)
  wid: .03, // 폭 ±m
  roof: .13, // 지붕 높이 ±m(벨트라인 위 최소 .36m는 지킨다)
  belt: .08, // 벨트라인 ±m
  rake: .45, // 앞유리 기울기 길이 배율 ±(유리 아래 끝은 그대로, 지붕 앞 끝이 움직인다)
  rear: .5, // 뒤유리 기울기 길이 배율 ±
  cab: .3, // 객실 앞뒤 이동 ±m(+면 앞으로)
  deck: .14, // 트렁크 길이 ±m(트렁크 있는 차만, +면 길어짐)
  arch: .02, // 휠 아치 여유 ±m
  wedge: .05, // 허리선 쐐기(뒤로 갈수록 올라감) ±m(시대 값에 더한다)
  wbr: .07, // 휠베이스 배율 ±(오버행 길이가 달라진다)
} as const;
export const MIN_ROOF_GAP = .36; // 지붕 − 벨트라인 최소(옆 창이 사라지지 않게)
export const MIN_CABIN = .45; // 지붕 길이(cF − cR) 최소
export const MIN_OVERHANG = .28; // 바퀴 아치 바깥 ~ 차 끝 최소(차체 기본값이 이보다 짧으면 그 값)
export const MIN_TRUNK = .45; // 트렁크 있는 차의 뒤 끝 ~ 뒤 유리 아래 끝 최소(이보다 짧으면 트렁크 없는 차처럼 보인다)

// 얼굴 선택지(faceSeed). 시대마다 고를 수 있는 모양이 다르다. 같은 항목을 두 번 넣으면 그만큼 자주 뽑힌다.
export type LampKind = 'round' | 'twin' | 'rect' | 'oval' | 'vertical' | 'swept' | 'slim' | 'popup' | 'projector';
export type GrilleKind = 'rect' | 'hex' | 'twin' | 'bars' | 'none' | 'mesh' | 'vertical' | 'kidney' | 'wide';
export type IntakeKind = 'wide' | 'three' | 'slim' | 'none' | 'fog';
export type TailKind = 'bar' | 'vertical' | 'L' | 'split' | 'full' | 'round';
export type WheelKind = 'twin5' | 'spoke5' | 'multi' | 'mesh' | 'turbine' | 'steel' | 'aero';
export interface FaceSpec {
  lamp: LampKind; lampW: number; lampDy: number; bar: boolean; // lampW: 크기 배율, lampDy: 높이 이동(m), bar: 앞 가로 라이트 바
  grille: GrilleKind; grilleW: number; grilleH: number;
  intake: IntakeKind; bumper: 'body' | 'black';
  tail: TailKind; tailDy: number;
  plateF: 'center' | 'offset'; plateR: 'low' | 'high';
  wheel: WheelKind; // 휠 디자인(페이스리프트 때 함께 바뀌는 게 보통이라 얼굴 쪽에 둔다)
}
type EraFace = { lamp: LampKind[]; grille: GrilleKind[]; intake: IntakeKind[]; bumper: FaceSpec['bumper'][]; tail: TailKind[]; wheel: WheelKind[]; bar: number; grilleW: [number, number]; def: FaceSpec };
// popup(팝업 램프)은 스포츠카·쿠페에서만 뽑히고 다른 차체는 네모난 전조등이 된다(variant.faceOf)
export const ERA_FACE: Record<Era, EraFace> = {
  1970: { lamp: ['round', 'twin', 'rect', 'oval', 'round'], grille: ['rect', 'bars', 'twin', 'wide', 'vertical', 'mesh'], intake: ['slim', 'none', 'wide', 'fog'], bumper: ['body'], tail: ['bar', 'vertical', 'split', 'round'], wheel: ['steel', 'steel', 'twin5', 'multi'], bar: 0, grilleW: [.85, 1.15],
    def: { lamp: 'round', lampW: 1, lampDy: 0, bar: false, grille: 'rect', grilleW: 1, grilleH: 1, intake: 'wide', bumper: 'body', tail: 'bar', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'steel' } },
  1980: { lamp: ['rect', 'rect', 'popup', 'popup', 'twin', 'projector'], grille: ['bars', 'wide', 'mesh', 'rect', 'vertical'], intake: ['slim', 'none', 'fog'], bumper: ['black', 'black', 'body'], tail: ['bar', 'full', 'vertical', 'round'], wheel: ['mesh', 'steel', 'turbine', 'spoke5'], bar: 0, grilleW: [.9, 1.2],
    def: { lamp: 'rect', lampW: 1, lampDy: 0, bar: false, grille: 'bars', grilleW: 1, grilleH: 1, intake: 'slim', bumper: 'black', tail: 'bar', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'mesh' } },
  1990: { lamp: ['oval', 'rect', 'vertical', 'oval', 'projector'], grille: ['rect', 'bars', 'none', 'mesh', 'kidney'], intake: ['wide', 'slim', 'three', 'fog'], bumper: ['body', 'black'], tail: ['bar', 'L', 'vertical', 'round'], wheel: ['spoke5', 'multi', 'twin5', 'turbine', 'mesh'], bar: 0, grilleW: [.8, 1.1],
    def: { lamp: 'oval', lampW: 1, lampDy: 0, bar: false, grille: 'rect', grilleW: 1, grilleH: 1, intake: 'wide', bumper: 'body', tail: 'bar', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'spoke5' } },
  // 2010: 큰 그릴 + 날카롭게 치켜 올라간 전조등, 라이트 바 없음 / 2020: 작거나 막힌 그릴 + 얇은 전조등과 가로 라이트 바
  2010: { lamp: ['swept', 'swept', 'rect', 'projector'], grille: ['hex', 'hex', 'twin', 'rect', 'mesh', 'kidney', 'vertical', 'hex'], intake: ['three', 'wide', 'slim', 'fog'], bumper: ['body', 'black'], tail: ['L', 'split', 'bar', 'vertical'], wheel: ['twin5', 'spoke5', 'multi', 'turbine', 'mesh'], bar: 0, grilleW: [1.2, 1.5],
    def: { lamp: 'swept', lampW: 1.1, lampDy: 0, bar: false, grille: 'hex', grilleW: 1.4, grilleH: 1.25, intake: 'three', bumper: 'body', tail: 'L', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'twin5' } },
  2020: { lamp: ['slim', 'slim', 'slim', 'vertical'], grille: ['none', 'none', 'rect', 'bars', 'mesh', 'kidney'], intake: ['slim', 'wide', 'slim'], bumper: ['body', 'body', 'black'], tail: ['full', 'full', 'full', 'L'], wheel: ['aero', 'aero', 'twin5', 'multi', 'turbine'], bar: .85, grilleW: [.45, .7],
    def: { lamp: 'slim', lampW: 1, lampDy: 0, bar: true, grille: 'none', grilleW: .6, grilleH: .8, intake: 'wide', bumper: 'black', tail: 'full', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'twin5' } },
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
