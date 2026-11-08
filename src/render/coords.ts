// 시뮬 좌표 (x, y=지면, z=높이) ↔ Three.js 좌표 (y가 위쪽). 변환은 이 파일에서만 한다.
export function toThree(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y: z, z: -y };
}
export function fromThree(x: number, _y: number, z: number): { x: number; y: number } {
  return { x, y: -z };
}
