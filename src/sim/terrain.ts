/**
 * 지형(2.0.0~2.1.0): 시드로 정해지는 순수 함수 하나. 렌더링과 시뮬레이션이 같은 값을 쓴다(난수 상태 없음 → 결정론).
 * 높이 = 구릉(값 잡음 두 겹) − 강 골짜기. 물 = 높이가 waterLevel 아래인 곳.
 */
export type Sea = 'n' | 's' | 'e' | 'w';
/** scale: 언덕 하나의 크기(m, 기본 260), lakes: 호수 수, sea: 바다가 있는 가장자리 */
export interface TerrainDef { seed: number; amp: number; waterLevel: number; river: boolean; scale?: number; lakes?: number; sea?: Sea | null }

/** 지형 유형(CS2의 맵 구성을 단순화: 평원·강 계곡·호수·해안·산악 등). 시작 시 시드를 바꿔 가며 외부 연결 도로가 놓이는 것을 고른다 */
export const TERRAIN_PRESETS = {
  plain: { name: '평원', def: { seed: 3, amp: 3, waterLevel: 0, river: false } },
  hills: { name: '구릉', def: { seed: 11, amp: 14, waterLevel: 0, river: true } },
  valley: { name: '강 계곡', def: { seed: 5, amp: 9, waterLevel: 0, river: true, scale: 340 } },
  lakes: { name: '호수 지대', def: { seed: 7, amp: 6, waterLevel: 0, river: false, lakes: 4 } },
  coast: { name: '해안', def: { seed: 2, amp: 14, waterLevel: 0, river: false, sea: 'e' as Sea } },
  mountain: { name: '산악', def: { seed: 9, amp: 55, waterLevel: 0, river: true, scale: 420 } },
} satisfies Record<string, { name: string; def: TerrainDef }>;
export type TerrainKind = keyof typeof TERRAIN_PRESETS;

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

/** 강 가운데 선의 x 좌표(y에 따라 굽이친다). 지도 가운데(외부 연결 도로)에서 동쪽으로 떨어져 흐른다 */
export const riverX = (t: TerrainDef, y: number): number => 260 + (hash(t.seed, 7, 7) - 0.5) * 120 + 70 * Math.sin(y / 170 + hash(t.seed, 3, 9) * 6);

const smooth = (f: number) => { const t = Math.min(1, Math.max(0, f)); return t * t * (3 - 2 * t); };

export function terrainHeight(t: TerrainDef | null, x: number, y: number): number {
  if (!t) return 0;
  const sc = t.scale ?? 260;
  let h = t.amp * (0.65 * noise(t.seed, x / sc, y / sc) + 0.35 * noise(t.seed + 1, x / (sc / 2.9), y / (sc / 2.9)));
  if (t.river) {
    const d = Math.abs(x - riverX(t, y));
    h -= (WATER_DEPTH + t.amp * 0.3) * Math.exp(-((d / 45) ** 2));
  }
  for (let k = 0; k < (t.lakes ?? 0); k++) { // 호수: 지도 안 임의의 자리에 둥근 웅덩이(가운데·외부 연결 도로 근처는 피한다)
    const cx = (hash(t.seed, 31 + k, 1) - 0.5) * 1100, cy = (hash(t.seed, 31 + k, 2) - 0.5) * 1100, r = 110 + hash(t.seed, 31 + k, 3) * 110;
    h -= (WATER_DEPTH + t.amp) * Math.exp(-((Math.hypot(x - cx, y - cy) / r) ** 2) * 1.4);
  }
  if (t.sea) { // 바다: 해당 가장자리 쪽으로 갈수록 가라앉는다(해변 → 바다)
    const e = t.sea === 'e' ? x : t.sea === 'w' ? -x : t.sea === 'n' ? y : -y;
    h -= (t.amp + 12) * smooth((e - 380) / 300);
  }
  return h;
}
export const isWater = (t: TerrainDef | null, x: number, y: number): boolean => !!t && terrainHeight(t, x, y) < t.waterLevel;
