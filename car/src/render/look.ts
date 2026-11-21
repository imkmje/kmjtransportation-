// 렌더가 받는 차 모양 값. sim을 모르게 하려고 렌더 쪽에 따로 둔다.
export type BodyId = 'sedanS' | 'hatch' | 'sedanM' | 'coupe' | 'suvS' | 'suv' | 'suvL' | 'sedanL' | 'minivan' | 'kei' | 'pickup' | 'sports';

export interface CarLook {
  bodyId: BodyId;
  powertrain: 'gas' | 'diesel' | 'hybrid' | 'ev';
  color: string; // '#rrggbb'
  wheel: 0 | 1 | 2; // 작게/표준/크게
  sporty?: boolean; // 스포일러·배기구
  era?: number; // 출시 연도(그대로 넘기면 render가 1970·1980·1990·2010·2020 다섯 시대로 나눈다)
  chassisSeed?: number; // 세대마다 1개: 길이·지붕·객실 위치 등 옆모습(없으면 차체 기본값)
  faceSeed?: number; // 판(초기형/페이스리프트)마다 1개: 전조등·그릴·범퍼·후미등(없으면 시대 기본 얼굴)
}
