// 시뮬 좌표 (x, y=지면, z=높이) → Three.js 좌표 (y가 위쪽). 변환은 여기서만 한다.
export function toThree(x: number, y: number, z: number): { x: number; y: number; z: number } {
  return { x, y: z, z: -y };
}
