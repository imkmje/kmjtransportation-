import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Sim } from '../src/sim/sim';
import { Network } from '../src/sim/network';
import { config } from '../src/config';
import { toThree } from '../src/render/coords';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('src/sim 규칙', () => {
  it('Math.random, Date.now, performance.now, DOM, three 사용 금지', () => {
    const banned = /Math\.random|Date\.now|performance\.now|document\.|window\.|from 'three/;
    for (const f of files('src/sim')) expect(readFileSync(f, 'utf8'), f).not.toMatch(banned);
  });
  it('같은 시드로 같은 tick 수를 돌리면 결과가 같다', () => {
    const a = new Sim(config, new Network(config)), b = new Sim(config, new Network(config));
    for (let i = 0; i < 500; i++) { a.step(); b.step(); }
    expect(a.tickCount).toBe(b.tickCount);
    expect(a.rng.next()).toBe(b.rng.next());
  });
});

describe('좌표 변환', () => {
  it('시뮬 (x,y,z) → Three (x, z, -y)', () => {
    expect(toThree(1, 2, 3)).toEqual({ x: 1, y: 3, z: -2 });
  });
});
