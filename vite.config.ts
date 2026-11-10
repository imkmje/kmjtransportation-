import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

export default defineConfig({
  // 상대 경로: GitHub Pages의 하위 주소(/저장소이름/)에서도 동작
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: { include: ['tests/**/*.test.ts', 'airline/tests/**/*.test.ts'] },
});
