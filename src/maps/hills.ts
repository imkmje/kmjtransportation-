import type { Editor } from '../sim/editor';
import { addExternalGate } from './start';
import { EMPTY_NETWORK } from './sample';
import { riverX, TERRAIN_PRESETS, type TerrainDef, type TerrainKind } from '../sim/terrain';

/** 시드는 외부 연결 도로와 강이 겹치지 않고 큰길이 다리 하나로 강을 건너는 것으로 골랐다(tests/terrain.test.ts가 확인) */
export const HILLS_TERRAIN: TerrainDef = { seed: 11, amp: 24, waterLevel: 0, river: true };

/**
 * 구릉 도시: 강이 굽이쳐 흐르는 지형. 큰길(왕복 4차로)이 다리로 강을 건너고, 강 서쪽(도시 대부분)에는 주거, 동쪽 기슭에는 직장이 있다.
 * 도로는 지형을 따라 오르내리고(경사 15% 이하), 강 위는 다리가 된다. 구역을 칠하면 평평한 땅에만 건물이 자란다.
 */
export function buildHillMap(editor: Editor, terrain: TerrainDef = HILLS_TERRAIN): void {
  editor.loadData(EMPTY_NETWORK);
  editor.network.terrain = { ...terrain };
  const rx = riverX(terrain, 0);
  const road = (x1: number, y1: number, x2: number, y2: number, kind: 'road2' | 'road4') => {
    const r = editor.build({ x: x1, y: y1 }, { x: x2, y: y2 }, kind);
    if (!r.ok) throw new Error(`구릉 도시 도로 건설 실패(${r.error}): ${x1},${y1} → ${x2},${y2}`);
  };
  road(-400, 0, rx + 300, 0, 'road4'); // 큰길: 강을 다리로 건넌다
  for (const x of [-200, rx + 240]) road(x, -240, x, 240, 'road2'); // 양쪽 기슭의 세로 길
  addExternalGate(editor, -300);
  editor.resetHistory();
}

/**
 * 지형을 고른 새 도시: 외부 연결 도로만 있다. 외부 연결 도로가 물·급경사·너무 긴 다리에 걸리면 안 되므로,
 * 유형의 기본 시드부터 하나씩 올려 가며 처음으로 도로가 놓이는 시드를 쓴다(항상 같은 결과).
 */
export function buildTerrainStart(editor: Editor, kind: TerrainKind): TerrainDef {
  const base = TERRAIN_PRESETS[kind].def as TerrainDef;
  for (let k = 0; k < 60; k++) {
    const def: TerrainDef = { ...base, seed: base.seed + k };
    editor.loadData(EMPTY_NETWORK);
    editor.network.terrain = { ...def };
    try { addExternalGate(editor, -300); editor.resetHistory(); return def; } catch { /* 다음 시드 */ }
  }
  throw new Error(`${TERRAIN_PRESETS[kind].name} 지형에서 외부 연결 도로를 놓을 수 있는 시드를 찾지 못했습니다`);
}
