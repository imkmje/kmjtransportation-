// 렌더가 받는 차 모양 값. sim을 모르게 하려고 렌더 쪽에 따로 둔다.
export type BodyId = 'sedanS' | 'hatch' | 'sedanM' | 'coupe' | 'suv';

export interface CarLook {
  bodyId: BodyId;
  powertrain: 'gas' | 'diesel' | 'hybrid' | 'ev';
  color: string; // '#rrggbb'
  wheel: 0 | 1 | 2; // 작게/표준/크게
  sporty?: boolean; // 스포일러·배기구
  era?: 1970 | 1990 | 2010 | 2020;
}
