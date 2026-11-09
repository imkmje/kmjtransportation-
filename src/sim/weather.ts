import type { Config } from '../config';

/** 작은 정수 해시(결정론): 같은 날·같은 시드면 같은 값(0~1) */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 이 날(day, 1일차부터) 이 시각(hour, 0~24)에 비가 오는가. 날마다 확률(rainDayChance)로 비 오는 날이 정해지고, 그날 낮 몇 시간 동안 온다. 저장할 상태 없음 */
export function isRaining(day: number, hour: number, seed: number, cfg: Config): boolean {
  const e = cfg.events;
  if (hash01(day, seed) >= e.rainDayChance) return false;
  const start = 8 + Math.floor(hash01(day, seed + 1) * 8); // 8~15시에 시작
  const len = 3 + Math.floor(hash01(day, seed + 2) * 4); // 3~6시간
  return hour >= start && hour < start + len;
}
