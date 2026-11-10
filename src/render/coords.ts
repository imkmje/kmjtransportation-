// 시뮬 좌표 (x, y=지면, z=높이) ↔ Three.js 좌표 (y가 위쪽). 변환은 이 파일에서만 한다.
let heightField: (x: number, y: number) => number = () => 0;
/** 지형 높이 함수를 등록한다. toThree는 이 높이를 자동으로 더해 건물·표지·표시 등이 언덕 위에 놓이게 한다 */
export function setHeightField(f: (x: number, y: number) => number): void { heightField = f; }
export const groundHeight = (x: number, y: number): number => heightField(x, y);

/** 지형 위의 점(z는 지면 위 높이) */
export function toThree(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y: z + heightField(x, y), z: -y };
}
/** 지형을 더하지 않는 변환: z가 이미 절대 높이일 때(도로·다리·차량) */
export function toThreeAbs(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y: z, z: -y };
}
export function fromThree(x: number, _y: number, z: number): { x: number; y: number } {
  return { x, y: -z };
}
