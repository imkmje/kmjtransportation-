import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('car/src/sim 규칙', () => {
  it('Math.random, Date, performance, DOM, three, render·ui 의존 금지', () => {
    const banned = /Math\.random|\bDate\b|performance\.|document\.|window\.|from 'three|from '\.\.\/render|from '\.\.\/ui/;
    const files = readdirSync('car/src/sim').map((f) => join('car/src/sim', f));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(banned);
  });
});
