// 시드 난수(mulberry32, 에어 게임과 같은 방식). sim 안에서는 이것만 쓴다. 상태는 숫자 하나라 저장에 그대로 넣는다.
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** a 이상 b 미만 실수 */
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  /** a 이상 b 이하 정수 */
  intIn(a: number, b: number): number { return a + Math.floor(this.next() * (b - a + 1)); }
  getState(): number { return this.s; }
  setState(s: number): void { this.s = s >>> 0; }
}

/** 순수 해시(게임 난수를 소비하지 않는다): 같은 정수 목록 = 같은 32비트 결과. 3D 모양 후보·경쟁 차 교체에 쓴다 */
export function hash32(...xs: number[]): number {
  let h = 0x811c9dc5;
  for (const x of xs) {
    h = Math.imul(h ^ (x >>> 0), 0x01000193) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297a2d39) >>> 0; h ^= h >>> 15;
  }
  return h >>> 0;
}
/** hash32를 0 이상 1 미만으로 */
export const hash01 = (...xs: number[]): number => hash32(...xs) / 4294967296;
