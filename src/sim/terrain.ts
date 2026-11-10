/**
 * 지형(2.0.0~2.1.0): 시드로 정해지는 순수 함수 하나. 렌더링과 시뮬레이션이 같은 값을 쓴다(난수 상태 없음 → 결정론).
 * 높이 = 구릉(값 잡음 두 겹) − 강 골짜기. 물 = 높이가 waterLevel 아래인 곳.
 */
export interface TerrainDef { seed: number; amp: number; waterLevel: number; river: boolean }
export const WATER_DEPTH = 10; // 강 골짜기 깊이(m)

function hash(seed: number, i: number, j: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(seed: number, x: number, y: number): number {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(seed, i, j), b = hash(seed, i + 1, j), c = hash(seed, i, j + 1), d = hash(seed, i + 1, j + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** 강 가운데 선의 x 좌표(y에 따라 굽이친다) */
export const riverX = (t: TerrainDef, y: number): number => (hash(t.seed, 7, 7) - 0.5) * 200 + 70 * Math.sin(y / 170 + hash(t.seed, 3, 9) * 6);

export function terrainHeight(t: TerrainDef | null, x: number, y: number): number {
  if (!t) return 0;
  let h = t.amp * (0.65 * noise(t.seed, x / 260, y / 260) + 0.35 * noise(t.seed + 1, x / 90, y / 90));
  if (t.river) {
    const d = Math.abs(x - riverX(t, y));
    h -= (WATER_DEPTH + t.amp * 0.3) * Math.exp(-((d / 45) ** 2)) ;
  }
  return h;
}
export const isWater = (t: TerrainDef | null, x: number, y: number): boolean => !!t && terrainHeight(t, x, y) < t.waterLevel;
