// 5.2.0 새 차 생성기(carBody: 단면 로프트 아래 몸통 + 별도 온실 + 곡면에 붙인 입체 부품): 결정론, 치수, 바퀴, 타이어 비례, 삼각형 한도
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCar, createCarMaterials, disposeCar } from '../src/render/carBuilder';
import { chassisOf } from '../src/render/variant';
import { BODY } from '../src/render/shapes';
import type { BodyId, CarLook } from '../src/render/look';

const M = createCarMaterials('#2f66f0');
const BODIES = Object.keys(BODY) as BodyId[];
const look = (bodyId: BodyId, era: number, o: Partial<CarLook> = {}): CarLook => ({ bodyId, powertrain: 'gas', color: '#2f66f0', wheel: 1, era, ...o });
const body = (g: THREE.Group) => g.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && Array.isArray(o.material))!;
const tris = (g: THREE.Object3D) => { let n = 0; g.traverse(o => { if (o instanceof THREE.Mesh) n += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; }); return n; };
const digest = (g: THREE.Group) => { let h = 0; g.traverse((o) => { if (o instanceof THREE.Mesh) { const a = o.geometry.getAttribute('position').array; for (let i = 0; i < a.length; i += 5) h = (h * 31 + Math.round(a[i] * 1e4)) | 0; } }); return h; };

describe('5.2.0 차 생성기', { timeout: 60000 }, () => {
  it('차급 12종 × 시대 6개(1985·1995·2005·2015·2025·2035): 같은 입력 = 같은 모양, 길이·높이·휠베이스가 차대 값과 맞고, 바퀴 4개가 아치 안·땅 위, 부품 빠짐 0, 삼각형 6만 이하', () => {
    for (const id of BODIES) for (const era of [1985, 1995, 2005, 2015, 2025, 2035]) {
      const l = look(id, era, { chassisSeed: era % 7 + 1, faceSeed: era % 5 + 1 }), a = buildCar(l, M), b = buildCar(l, M), c = chassisOf(l);
      expect(digest(a)).toBe(digest(b));
      expect(a.userData.decalMiss, `${id} ${era} 부품 빠짐`).toBe(0);
      expect(tris(a), `${id} ${era} 삼각형`).toBeLessThanOrEqual(60000);
      const box = new THREE.Box3().setFromObject(body(a));
      expect(Math.abs(box.max.x - box.min.x - c.L)).toBeLessThan(.02);
      expect(Math.abs(box.max.y - c.roof)).toBeLessThan(.06);
      const wheels = a.children.filter((o): o is THREE.Group => o instanceof THREE.Group);
      expect(wheels.length).toBe(4);
      expect(new Set(wheels.map(w => w.position.x.toFixed(4)))).toEqual(new Set([(-c.wb).toFixed(4), c.wb.toFixed(4)])); // 휠베이스
      for (const w of wheels) {
        expect(w.position.y).toBeCloseTo(c.wr, 6); // 타이어 바닥이 땅(0)
        expect(c.wr * 2).toBeLessThan(c.archY + c.archR - .01); // 타이어 꼭대기가 아치 안
        // 타이어 바깥면이 차체 옆면(가장 넓은 곳)보다 안쪽: 바퀴가 밖으로 튀어나오지 않는다
        const tb = new THREE.Box3().setFromObject(w.children[0]);
        expect(Math.max(Math.abs(tb.max.z), Math.abs(tb.min.z)), `${id} ${era} 바퀴 돌출`).toBeLessThanOrEqual(box.max.z + 1e-3);
      }
      disposeCar(a); disposeCar(b);
    }
  });

  it('타이어 지름 비례(표준 휠, 2010년대 이후 기본 차대): 승용 차 높이의 43~48%, SUV·픽업 43~50%, 경차·미니밴은 작게, 스포츠카는 낮은 지붕이라 크게', () => {
    const range: Partial<Record<BodyId, [number, number]>> = { kei: [.34, .42], minivan: [.37, .45], sports: [.5, .62], coupe: [.46, .53], suvS: [.43, .5], suv: [.43, .5], suvL: [.43, .5], pickup: [.43, .5] };
    for (const id of BODIES) for (const era of [2015, 2025, 2035]) {
      const c = chassisOf(look(id, era)), r = 2 * c.wr / c.roof, [lo, hi] = range[id] ?? [.43, .48];
      expect(r, `${id} ${era} 타이어/높이 ${r.toFixed(3)}`).toBeGreaterThanOrEqual(lo);
      expect(r, `${id} ${era} 타이어/높이 ${r.toFixed(3)}`).toBeLessThanOrEqual(hi);
    }
  });

  it('차체 윤곽은 얼굴 시드·휠 크기와 무관하고, 2000년대는 1990년대와 다른 시대 모양이다', () => {
    for (const id of BODIES) {
      const pos = (l: CarLook) => { const g = buildCar(l, M), a = Array.from(body(g).geometry.getAttribute('position').array); disposeCar(g); return a; };
      const base = look(id, 2005, { chassisSeed: 4, faceSeed: 1 });
      expect(pos({ ...base, faceSeed: 9, wheel: 2 })).toEqual(pos(base));
      expect(pos({ ...base, era: 1995 })).not.toEqual(pos(base));
    }
  });
});
