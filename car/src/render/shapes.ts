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
  sedanS: { L: 4.1, W: 1.66, clr: .19, belt: .9, roof: 1.4, cR: -.9, cF: .48, rr: .5, rf: .65, wr: .29, wb: 1.22, deck: true, sill: .1, doors: [.8, -.21, -.8], archTrim: .03 },
  hatch: { L: 4.0, W: 1.72, clr: .2, belt: .92, roof: 1.46, cR: -1.4, cF: .45, rr: .3, rf: .6, wr: .3, wb: 1.25, deck: false, sill: .1, doors: [.82, -.47, -1.2], archTrim: .03 },
  sedanM: { L: 4.6, W: 1.78, clr: .2, belt: .92, roof: 1.42, cR: -1.05, cF: .55, rr: .55, rf: .7, wr: .3, wb: 1.4, deck: true, sill: .1, doors: [.95, -.25, -.95], archTrim: .03 },
  coupe: { L: 4.5, W: 1.82, clr: .15, belt: .84, roof: 1.26, cR: -.75, cF: .35, rr: .95, rf: .8, wr: .29, wb: 1.38, deck: true, sill: .1, doors: [.92, -.45], archTrim: .03, fenders: true },
  // SUV 3종: 소형은 짧고 높은 도시형(짧은 오버행), 중형은 기존 SUV, 대형은 길고 각진 3열(긴 휠베이스·높은 지붕·큰 휠, 뒤 쿼터 창 하나 더)
  suvS: { L: 4.2, W: 1.78, clr: .26, belt: 1.0, roof: 1.66, cR: -1.55, cF: .5, rr: .28, rf: .58, wr: .345, wb: 1.3, deck: false, sill: .16, doors: [.84, -.525, -1.2], archTrim: .05, nose: .17, suv: true },
  suv: { L: 4.6, W: 1.86, clr: .3, belt: 1.08, roof: 1.72, cR: -1.75, cF: .6, rr: .25, rf: .6, wr: .365, wb: 1.4, deck: false, sill: .2, doors: [.9, -.575, -1.28], archTrim: .07, suv: true },
  suvL: { L: 5.05, W: 1.96, clr: .32, belt: 1.14, roof: 1.86, cR: -2.05, cF: .66, rr: .18, rf: .62, wr: .39, wb: 1.62, deck: false, sill: .22, doors: [.98, -.29, -1.24], archTrim: .075, pil: [.3, .65], nose: .14, edge: .7, suv: true },
  sedanL: { L: 5.1, W: 1.88, clr: .18, belt: .88, roof: 1.47, cR: -1.22, cF: .58, rr: .58, rf: .78, wr: .31, wb: 1.5, deck: true, sill: .1, doors: [1.06, -.12, -1.12], archTrim: .03, nose: .17 },
  minivan: { L: 4.8, W: 1.9, clr: .19, belt: .98, roof: 1.72, cR: -2.0, cF: .5, rr: .22, rf: .95, wr: .32, wb: 1.5, deck: false, sill: .12, doors: [1.02, 0, -1.0], archTrim: .04, pil: [.4, .8], nose: .07, edge: .8 },
  kei: { L: 3.4, W: 1.48, clr: .15, belt: .86, roof: 1.52, cR: -1.36, cF: .44, rr: .16, rf: .56, wr: .26, wb: 1.14, deck: false, sill: .09, doors: [.76, -.32, -.78], archTrim: .03, pil: [.58], nose: .14, edge: .6 },
  pickup: { L: 5.2, W: 1.9, clr: .3, belt: 1.1, roof: 1.84, cR: -.6, cF: .7, rr: .2, rf: .55, wr: .38, wb: 1.6, deck: false, sill: .18, doors: [1.08, .05, -.66], archTrim: .07, bed: .72, nose: .1, edge: .55 },
  sports: { L: 4.4, W: 1.94, clr: .1, belt: .68, roof: 1.06, cR: -.95, cF: .06, rr: .78, rf: 1.0, wr: .285, wb: 1.32, deck: true, sill: .08, doors: [.86, -.72], archTrim: .03, nose: .26, spoiler: true, fenders: true },
};

// 휠 크기 단계별 타이어 반지름 증가와 림 비율(실제 차처럼 큰 휠은 타이어가 얇아져 바깥 지름은 조금만 는다).
// 휠 아치는 가장 큰 휠 기준으로 고정한다: 휠을 바꿔도 옆 윤곽이 그대로다(페이스리프트에서 휠만 바뀌는 경우)
// 5.2.0 타이어가 차 높이에 비해 너무 컸다: 증가 폭을 줄이고 림 비율을 키웠다(얇은 타이어)
export const WHEEL_GROW = [0, .01, .02] as const;
export const RIM_RATIO = [.66, .71, .76] as const;
export const COWL_BEHIND_AXLE = .12; // 5.5.1 앞유리 아래 끝(카울)은 앞바퀴 축보다 최소 이만큼 뒤
export const BELT_OVER_ARCH = .07; // 허리선이 휠 아치 꼭대기보다 최소 이만큼 위(fenders 차체 제외)

export type Era = 1970 | 1980 | 1990 | 2000 | 2010 | 2020 | 2030;
/** 5.2.0 시대 스타일. 비례(chassisOf가 씀): len 전장 배율, roofD·beltD 지붕·허리선 ±m, wbK 휠베이스 배율, wrD 타이어 반지름 ±m, wedge 허리선 쐐기(m), rake 앞유리 기울기 배율.
    차체 면(carBody가 씀): p 앞뒤 끝 옆모습 곡선 지수(클수록 각진 끝), endT·endB 앞 끝 위·아래가 코 높이로 모이는 길이(m, 위가 길수록 얼굴이 눕는다), corner 평면 모서리 반경(m),
    bow 평면에서 얼굴 가운데가 앞으로 나오는 양(m), taper 앞뒤로 좁아짐, tuck 옆판 아래 말아 넣기, side 옆판 위쪽이 안으로 눕는 양, crown 보닛·지붕 볼록,
    tumble 옆 유리가 안으로 눕는 비율, sh 옆판 가운데 꺾임(1 날 선 선, 0 둥근 배부름), rs 어깨 반경, rc 지붕 모서리 반경, nose 코 높이(바닥~허리선 비율), classic 크롬 범퍼 시대 */
export interface EraStyle {
  len: number; roofD: number; beltD: number; wbK: number; wrD: number; wedge: number; rake: number;
  p: number; endT: number; endB: number; corner: number; bow: number; taper: number; tuck: number; side: number; crown: number;
  tumble: number; sh: number; rs: number; rc: number; nose: number; classic: boolean;
}
export const ERA: Record<Era, EraStyle> = {
  // 길고 낮고 각진 3박스, 평평한 면, 긴 오버행·작은 바퀴, 크롬 범퍼, 곧게 선 유리
  1970: { len: 1.05, roofD: -.06, beltD: -.04, wbK: .95, wrD: -.02, wedge: .02, rake: .85, p: 6, endT: .1, endB: .08, corner: .08, bow: .02, taper: .01, tuck: .02, side: .015, crown: .012, tumble: .14, sh: 1, rs: .012, rc: .025, nose: .5, classic: true },
  // 쐐기형 직선: 앞이 낮고 뒤가 높은 허리선, 날 선 모서리, 검은 수지 범퍼
  1980: { len: 1.01, roofD: -.03, beltD: -.03, wbK: .97, wrD: -.015, wedge: .14, rake: .9, p: 5, endT: .12, endB: .09, corner: .12, bow: .03, taper: .02, tuck: .025, side: .02, crown: .012, tumble: .18, sh: 1, rs: .01, rc: .025, nose: .5, classic: false },
  // 모서리 둥근 비누형: 크게 둥근 끝, 배부른 옆판, 많이 누운 유리
  1990: { len: 1, roofD: 0, beltD: 0, wbK: 1, wrD: 0, wedge: .04, rake: 1.08, p: 2.4, endT: .3, endB: .18, corner: .34, bow: .1, taper: .07, tuck: .07, side: .05, crown: .05, tumble: .3, sh: 0, rs: .06, rc: .12, nose: .46, classic: false },
  // 2000년대: 둥근 면에 선이 돌아오고 지붕이 높아진다(키 큰 실내), 큰 전조등
  2000: { len: 1, roofD: .03, beltD: .03, wbK: 1.02, wrD: .005, wedge: .07, rake: 1.05, p: 3, endT: .26, endB: .15, corner: .24, bow: .1, taper: .07, tuck: .06, side: .04, crown: .04, tumble: .26, sh: 1, rs: .035, rc: .09, nose: .48, classic: false },
  // 높은 허리선·짧은 오버행·큰 바퀴, 쐐기, 날 선 캐릭터 라인
  2010: { len: 1, roofD: .02, beltD: .05, wbK: 1.04, wrD: .01, wedge: .1, rake: 1.08, p: 3.6, endT: .22, endB: .14, corner: .13, bow: .1, taper: .08, tuck: .07, side: .04, crown: .03, tumble: .3, sh: 1, rs: .022, rc: .075, nose: .5, classic: false },
  // 매끈한 면, 짧은 앞 오버행(전기차는 휠베이스 더 길고 보닛 짧게: variant.chassisOf)
  2020: { len: 1, roofD: 0, beltD: .04, wbK: 1.06, wrD: .015, wedge: .06, rake: 1.1, p: 4, endT: .18, endB: .12, corner: .09, bow: .11, taper: .08, tuck: .1, side: .07, crown: .03, tumble: .3, sh: 1, rs: .018, rc: .07, nose: .52, classic: false },
  // 2030년대: 더 둥근 앞뒤(포드형), 높은 허리선·큰 휠, 긴 휠베이스
  2030: { len: 1.01, roofD: .02, beltD: .09, wbK: 1.08, wrD: .02, wedge: .04, rake: 1.14, p: 3.2, endT: .26, endB: .15, corner: .18, bow: .14, taper: .08, tuck: .06, side: .04, crown: .035, tumble: .32, sh: 1, rs: .03, rc: .09, nose: .52, classic: false },
};
export const eraOf = (look: CarLook): Era => { const e = look.era ?? 2020; return e < 1980 ? 1970 : e < 1990 ? 1980 : e < 2000 ? 1990 : e < 2010 ? 2000 : e < 2020 ? 2010 : e < 2030 ? 2020 : 2030; };
export const eraStyle = (look: CarLook): EraStyle => ERA[eraOf(look)];

// 차대 변형 범위(chassisSeed). 시드마다 각 값이 −1~+1 사이에서 뽑혀 이 폭을 곱한다.
// 풀체인지가 확 달라 보이게 지붕·벨트·유리·객실 위치를 넓게 잡았다(모양이 깨지지 않게 chassisOf에서 묶는다).
export const ARCH_GAP = .025; // 휠 아치와 타이어 사이 기본 여유
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
// 1.0.0 2030년대 부품: pixel(픽셀 램프), split(위 주간등 + 아래 본등 분리), panel(빛나는 그릴 패널), 후미등 pixel, 휠 cover(휠 커버)
export type LampKind = 'round' | 'twin' | 'rect' | 'oval' | 'vertical' | 'swept' | 'slim' | 'popup' | 'projector' | 'pixel' | 'split';
export type GrilleKind = 'rect' | 'hex' | 'twin' | 'bars' | 'none' | 'mesh' | 'vertical' | 'kidney' | 'wide' | 'panel';
export type IntakeKind = 'wide' | 'three' | 'slim' | 'none' | 'fog';
export type TailKind = 'bar' | 'vertical' | 'L' | 'split' | 'full' | 'round' | 'pixel';
export type WheelKind = 'twin5' | 'spoke5' | 'multi' | 'mesh' | 'turbine' | 'steel' | 'aero' | 'cover';
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
  // 2000: 크고 맑은 전조등(렌즈형·치켜 올라간), 크롬 테 그릴, 범퍼 일체형, 맑은 후미등
  2000: { lamp: ['projector', 'swept', 'oval', 'projector', 'rect'], grille: ['rect', 'mesh', 'bars', 'kidney', 'hex', 'twin'], intake: ['wide', 'fog', 'three', 'slim'], bumper: ['body'], tail: ['L', 'bar', 'split', 'round', 'vertical'], wheel: ['spoke5', 'twin5', 'multi', 'turbine', 'mesh'], bar: 0, grilleW: [.9, 1.25],
    def: { lamp: 'projector', lampW: 1.05, lampDy: 0, bar: false, grille: 'rect', grilleW: 1.1, grilleH: 1.1, intake: 'fog', bumper: 'body', tail: 'L', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'spoke5' } },
  // 2010: 큰 그릴 + 날카롭게 치켜 올라간 전조등, 라이트 바 없음 / 2020: 작거나 막힌 그릴 + 얇은 전조등과 가로 라이트 바
  2010: { lamp: ['swept', 'swept', 'rect', 'projector'], grille: ['hex', 'hex', 'twin', 'rect', 'mesh', 'kidney', 'vertical', 'hex'], intake: ['three', 'wide', 'slim', 'fog'], bumper: ['body', 'black'], tail: ['L', 'split', 'bar', 'vertical'], wheel: ['twin5', 'spoke5', 'multi', 'turbine', 'mesh'], bar: 0, grilleW: [1.2, 1.5],
    def: { lamp: 'swept', lampW: 1.1, lampDy: 0, bar: false, grille: 'hex', grilleW: 1.4, grilleH: 1.25, intake: 'three', bumper: 'body', tail: 'L', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'twin5' } },
  2020: { lamp: ['slim', 'slim', 'slim', 'vertical'], grille: ['mesh', 'hex', 'rect', 'bars', 'mesh', 'kidney'], intake: ['wide', 'three', 'slim'], bumper: ['body', 'body', 'black'], tail: ['full', 'full', 'full', 'L'], wheel: ['aero', 'aero', 'twin5', 'multi', 'turbine'], bar: .85, grilleW: [.7, 1.0],
    def: { lamp: 'slim', lampW: .75, lampDy: 0, bar: false, grille: 'mesh', grilleW: 1.4, grilleH: 1.5, intake: 'three', bumper: 'body', tail: 'full', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'twin5' } },
  // 2030: 분리형 주간등·픽셀 램프, 빛나는 그릴 패널, 픽셀·일자 후미등, 휠 커버. 2020보다 선택지를 넓혀 후보가 서로 달라 보이게
  2030: { lamp: ['split', 'pixel', 'slim', 'split', 'pixel', 'projector', 'vertical'], grille: ['panel', 'panel', 'none', 'mesh', 'bars', 'kidney'], intake: ['slim', 'wide', 'three', 'none'], bumper: ['body', 'black'], tail: ['pixel', 'full', 'bar', 'L', 'pixel', 'split'], wheel: ['cover', 'aero', 'turbine', 'twin5', 'cover', 'multi'], bar: .5, grilleW: [.8, 1.2],
    def: { lamp: 'split', lampW: 1, lampDy: 0, bar: false, grille: 'panel', grilleW: 1, grilleH: 1, intake: 'slim', bumper: 'body', tail: 'pixel', tailDy: 0, plateF: 'center', plateR: 'high', wheel: 'cover' } },
};
