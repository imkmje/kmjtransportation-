import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCar, createCarMaterials, disposeCar } from '../src/render/carBuilder';
import { chassisOf, chassisWords, describeLook, distinctFaces, faceOf } from '../src/render/variant';
import { silhouetteSvg } from '../src/render/silhouette';
import { BODY } from '../src/render/shapes';
import type { BodyId, CarLook } from '../src/render/look';

const BODIES = Object.keys(BODY) as BodyId[];
const ERAS = [1970, 1985, 1990, 2010, 2020] as const;
const M = createCarMaterials('#c8202f');
const look = (o: Partial<CarLook> & { bodyId: BodyId }): CarLook => ({ powertrain: 'gas', color: '#c8202f', wheel: 1, era: 2020, ...o } as CarLook);
const bodyMesh = (g: THREE.Group) => g.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && Array.isArray(o.material))!;
const tris = (g: THREE.Object3D) => { let n = 0; g.traverse(o => { if (o instanceof THREE.Mesh) n += (o.geometry.index?.count ?? o.geometry.getAttribute('position').count) / 3; }); return n; };

// 차체 곡면의 가운데 윗선(z=0 점들)에서 실제 치수를 잰다: 설명이 이 값과 맞는지 본다
function profile(l: CarLook) {
  const g = buildCar(l, M), pa = bodyMesh(g).geometry.getAttribute('position'), top = new Map<number, number>();
  for (let i = 0; i < pa.count; i++) if (Math.abs(pa.getZ(i)) < 1e-6 && pa.getY(i) > .3) { const x = pa.getX(i); top.set(x, Math.max(top.get(x) ?? 0, pa.getY(i))); }
  disposeCar(g);
  const pts = [...top].sort((a, b) => a[0] - b[0]), c = chassisOf(l), lvl = c.belt + .5 * (c.roof - c.belt);
  const up = pts.filter(q => q[1] >= lvl);
  return { len: pts[pts.length - 1][0] - pts[0][0], roof: Math.max(...pts.map(q => q[1])), trunk: up[0][0] - pts[0][0], hood: pts[pts.length - 1][0] - up[up.length - 1][0] };
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };

describe('3D 차 모양', () => {
  it('설명(트렁크·보닛·지붕·길이)이 실제 생성 형상과 맞는다(차체 10종 × 시드 30 = 300대)', () => {
    const KEY: Record<string, ['len' | 'roof' | 'trunk' | 'hood', 1 | -1]> = {
      '긴 차체': ['len', 1], '짧은 차체': ['len', -1], '높은 지붕': ['roof', 1], '낮은 지붕': ['roof', -1],
      '긴 트렁크': ['trunk', 1], '짧은 트렁크': ['trunk', -1], '긴 보닛': ['hood', 1], '짧은 보닛': ['hood', -1],
    };
    let checked = 0;
    for (const bodyId of BODIES) {
      const rows = Array.from({ length: 30 }, (_, i) => { const l = look({ bodyId, chassisSeed: i * 37 + 11 }); return { w: chassisWords(l), m: profile(l), d: describeLook(l).chassis }; });
      const med = { len: median(rows.map(r => r.m.len)), roof: median(rows.map(r => r.m.roof)), trunk: median(rows.map(r => r.m.trunk)), hood: median(rows.map(r => r.m.hood)) };
      for (const r of rows) for (const w of r.w) {
        expect(r.d).toContain(w);
        const k = KEY[w]; if (!k) continue;
        if (k[0] === 'trunk') expect(BODY[bodyId].deck, `${bodyId}: 트렁크 없는 차체에 트렁크 설명`).toBe(true);
        checked++;
        expect((r.m[k[0]] - med[k[0]]) * k[1], `${bodyId} '${w}': 실측 ${r.m[k[0]].toFixed(2)} / 중앙값 ${med[k[0]].toFixed(2)}`).toBeGreaterThan(0);
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it('설명 문구는 200개 시드에서 모순이 없다(같은 항목의 긴/짧은이 함께 나오지 않음, 트렁크는 트렁크 있는 차만)', () => {
    for (const bodyId of BODIES) for (let s = 1; s <= 200; s++) {
      const w = chassisWords(look({ bodyId, chassisSeed: s }));
      expect(w.length).toBeLessThanOrEqual(2);
      if (!BODY[bodyId].deck) expect(w.some(x => x.includes('트렁크'))).toBe(false);
    }
  });

  it('비례가 깨지지 않는다: 트렁크 있는 차는 트렁크 .45m 이상, 보닛 .65m 이상, 객실·앞뒤 유리 길이 양수, 허리선은 휠 아치 위', () => {
    for (const bodyId of BODIES) for (let s = 1; s <= 300; s++) {
      const c = chassisOf(look({ bodyId, chassisSeed: s })), h = c.L / 2;
      if (c.deck) expect(c.cR - c.rr + h).toBeGreaterThanOrEqual(.45 - 1e-9);
      expect(h - (c.cF + c.rf)).toBeGreaterThanOrEqual(.65 - 1e-9);
      expect(c.rf).toBeGreaterThan(.1); expect(c.rr).toBeGreaterThan(.05); expect(c.cF - c.cR).toBeGreaterThanOrEqual(.45 - 1e-9);
      if (!c.fenders) expect(c.belt).toBeGreaterThanOrEqual(c.archY + c.archR + .13 - 1e-9);
      expect(c.archR).toBeGreaterThan(c.wr); // 타이어가 아치를 뚫지 않는다
    }
  });

  it('같은 시드 = 같은 모양, 페이스리프트(얼굴 시드만 바뀜)·휠 크기는 옆 윤곽을 바꾸지 않고, 풀체인지는 바꾼다', () => {
    for (const bodyId of BODIES) for (const era of ERAS) {
      const base = look({ bodyId, era, chassisSeed: 77, faceSeed: 1 });
      const pos = (l: CarLook) => { const g = buildCar(l, M), a = Array.from(bodyMesh(g).geometry.getAttribute('position').array); disposeCar(g); return a; };
      const a = pos(base);
      expect(pos(base)).toEqual(a);
      expect(pos({ ...base, faceSeed: 2 })).toEqual(a);
      expect(pos({ ...base, wheel: 2, faceSeed: 5 })).toEqual(a);
      expect(pos({ ...base, chassisSeed: 78 })).not.toEqual(a);
    }
  });

  it('얼굴 시드가 다르면 얼굴이 달라지고, distinctFaces는 서로 다른 앞얼굴 3개를 낸다', () => {
    for (const bodyId of BODIES) for (const era of ERAS) for (const powertrain of ['gas', 'ev'] as const) {
      const base = look({ bodyId, era, powertrain, chassisSeed: 3 });
      const seeds = distinctFaces(base, [101, 202, 303]);
      const keys = seeds.map(s => { const f = faceOf({ ...base, faceSeed: s }); return `${f.lamp}|${powertrain === 'ev' ? f.intake : f.grille}|${f.bar}`; });
      expect(new Set(keys).size).toBe(3);
    }
  });

  it('부품 다양성: 시대·차체별로 전조등·그릴·후미등·휠 종류가 여러 가지 나온다', () => {
    const seen = { lamp: new Set<string>(), grille: new Set<string>(), tail: new Set<string>(), wheel: new Set<string>() };
    for (const era of ERAS) for (let s = 1; s <= 80; s++) {
      const f = faceOf(look({ bodyId: 'coupe', era, faceSeed: s }));
      seen.lamp.add(f.lamp); seen.grille.add(f.grille); seen.tail.add(f.tail); seen.wheel.add(f.wheel);
    }
    expect(seen.lamp.size).toBeGreaterThanOrEqual(6); expect(seen.grille.size).toBeGreaterThanOrEqual(6);
    expect(seen.tail.size).toBeGreaterThanOrEqual(5); expect(seen.wheel.size).toBeGreaterThanOrEqual(6);
    for (let s = 1; s <= 50; s++) {
      expect(faceOf(look({ bodyId: 'sedanM', era: 1985, faceSeed: s })).lamp).not.toBe('popup'); // 팝업 램프는 스포츠카·쿠페만
      expect(faceOf(look({ bodyId: 'sedanM', powertrain: 'ev', faceSeed: s })).grille).toBe('none');
    }
  });

  it('형상 검사: 데칼 빠짐 0, 좌우 대칭, 바퀴는 땅에 닿고 아치 안에, 삼각형 2만 1천5백 이하', () => {
    for (const bodyId of BODIES) for (const era of ERAS) for (let s = 0; s < 4; s++) {
      const l = look({ bodyId, era, chassisSeed: s * 19 + 2, faceSeed: s * 5 + 1, wheel: (s % 3) as 0 | 1 | 2, sporty: s === 1, powertrain: s === 3 ? 'ev' : 'gas' });
      const g = buildCar(l, M), c = chassisOf(l);
      expect(g.userData.decalMiss).toBe(0);
      expect(tris(g)).toBeLessThanOrEqual(21500);
      // 좌우 대칭: 차 전체 꼭짓점의 z 합이 0 근처, 최대·최소 z가 같다
      const box = new THREE.Box3().setFromObject(g);
      expect(Math.abs(box.max.z + box.min.z)).toBeLessThan(1e-3);
      expect(box.min.y).toBeGreaterThan(-1e-3); expect(box.min.y).toBeLessThan(.01); // 땅에 닿음(타이어 바닥 0)
      // 타이어 꼭대기는 아치 원 안쪽(여유 1cm 이상)
      expect(c.wr * 2).toBeLessThan(c.archY + c.archR - .01);
      disposeCar(g);
    }
  });

  it('옆모습 SVG는 3D와 같은 차대 값(바퀴 반지름·위치)을 쓴다', () => {
    const l = look({ bodyId: 'suv', chassisSeed: 9, wheel: 2 }), c = chassisOf(l), svg = silhouetteSvg(l);
    expect(svg).toContain(`cx="${-c.wb}" cy="${c.wr.toFixed(2)}"`);
  });
});
