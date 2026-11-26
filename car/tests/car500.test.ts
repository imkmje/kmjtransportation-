// 5.0.0 차 생성기: 같은 입력 = 같은 모양(순수 함수), 차급마다 뼈대(곡면 차체·유리·바퀴)가 생기고, 얼굴이 곧게 선 벽이 아니라 뒤로 눕는다
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCar, createCarMaterials, disposeCar } from '../src/render/carBuilder';
import { chassisOf } from '../src/render/variant';
import { BODY } from '../src/render/shapes';
import type { BodyId, CarLook } from '../src/render/look';

const M = createCarMaterials('#2f66f0');
const look = (bodyId: BodyId, era: CarLook['era']): CarLook => ({ bodyId, powertrain: 'gas', color: '#2f66f0', wheel: 1, era, chassisSeed: 7, faceSeed: 3 });
const body = (g: THREE.Group) => g.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && Array.isArray(o.material))!;
const digest = (g: THREE.Group) => { let h = 0; g.traverse((o) => { if (o instanceof THREE.Mesh) { const a = o.geometry.getAttribute('position').array; for (let i = 0; i < a.length; i += 7) h = (h * 31 + Math.round(a[i] * 1e4)) | 0; } }); return h; };

describe('5.0.0 차 생성기', { timeout: 60000 }, () => {
  it('차급 12종 × 1985·2020년: 같은 입력이면 같은 모양, 곡면 차체·유리·바퀴 4개가 있고 치수가 차대 값과 맞는다', () => {
    for (const id of Object.keys(BODY) as BodyId[]) for (const era of [1985, 2020] as const) {
      const l = look(id, era), a = buildCar(l, M), b = buildCar(l, M), c = chassisOf(l);
      expect(digest(a)).toBe(digest(b));
      const m = body(a), groups = new Set(m.geometry.groups.map((x) => x.materialIndex));
      expect(groups.has(0) && groups.has(1)).toBe(true); // 도장·유리
      expect(a.children.filter((o) => o instanceof THREE.Group).length).toBe(4); // 바퀴
      const box = new THREE.Box3().setFromObject(m);
      expect(Math.abs(box.max.x - box.min.x - c.L)).toBeLessThan(.02);
      expect(Math.abs(box.max.y - c.roof)).toBeLessThan(.08);
      // 얼굴이 눕는다: 차체 가운데 단면에서 범퍼 높이의 앞 끝이 보닛 높이의 앞 끝보다 앞에 있다
      const pa = m.geometry.getAttribute('position'), front = (y0: number, y1: number) => { let x = -9; for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); if (Math.abs(pa.getZ(i)) < .05 && y > y0 && y < y1) x = Math.max(x, pa.getX(i)); } return x; };
      const hood = c.belt - .12, bump = c.clr + .2;
      expect(front(bump - .05, bump + .05)).toBeGreaterThan(front(hood - .03, hood + .03));
      disposeCar(a); disposeCar(b);
    }
  });
});
