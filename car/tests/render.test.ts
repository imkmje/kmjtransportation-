import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildCar, createCarMaterials, disposeCar } from '../src/render/carBuilder';
import { chassisOf, chassisWords, describeLook, distinctFaces, faceOf } from '../src/render/variant';
import { silhouetteSvg } from '../src/render/silhouette';
import { BODY } from '../src/render/shapes';
import type { BodyId, CarLook } from '../src/render/look';
import { roomFor, findPath, EXEC_SEATS, CAPACITY } from '../src/ui/office/layout';
import { decadeOf } from '../src/ui/era';
import { config } from '../src/config';

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

describe('3D 차 모양', { timeout: 60000 }, () => {
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

  it('형상 검사: 데칼 빠짐 0, 좌우 대칭, 바퀴는 땅에 닿고 아치 안에, 삼각형 2만 4천 이하', () => {
    for (const bodyId of BODIES) for (const era of ERAS) for (let s = 0; s < 4; s++) {
      const l = look({ bodyId, era, chassisSeed: s * 19 + 2, faceSeed: s * 5 + 1, wheel: (s % 3) as 0 | 1 | 2, sporty: s === 1, powertrain: s === 3 ? 'ev' : 'gas' });
      const g = buildCar(l, M), c = chassisOf(l);
      expect(g.userData.decalMiss).toBe(0);
      expect(tris(g)).toBeLessThanOrEqual(24000);
      // 좌우 대칭: 차 전체 꼭짓점의 z 합이 0 근처, 최대·최소 z가 같다
      const box = new THREE.Box3().setFromObject(g);
      expect(Math.abs(box.max.z + box.min.z)).toBeLessThan(1e-3);
      expect(box.min.y).toBeGreaterThan(-1e-3); expect(box.min.y).toBeLessThan(.01); // 땅에 닿음(타이어 바닥 0)
      // 타이어 꼭대기는 아치 원 안쪽(여유 1cm 이상)
      expect(c.wr * 2).toBeLessThan(c.archY + c.archR - .01);
      disposeCar(g);
    }
  });

  it('보닛·트렁크·지붕 윗면은 차체색이다(유리·검은 재질이 번지지 않음), 스포일러는 차체에 붙는다', () => {
    for (const bodyId of BODIES) for (const era of ERAS) for (let s = 0; s < 6; s++) {
      const l = look({ bodyId, era, chassisSeed: s * 23 + 4, faceSeed: s + 1, sporty: true, wheel: (s % 3) as 0 | 1 | 2 });
      const g = buildCar(l, M), c = chassisOf(l), h = c.L / 2, mesh = bodyMesh(g);
      g.updateMatrixWorld(true);
      // 위에서 내려다본 첫 면의 재질(0 = 차체색)
      const down = new THREE.Raycaster(); down.ray.direction.set(0, -1, 0);
      for (let x = -h + .2; x < h - .2; x += .1) for (const z of [0, .3]) {
        const hood = x > c.cF + c.rf + .08, deck = x < c.cR - c.rr - .08 && c.bed == null, roof = x > c.cR + .12 && x < c.cF - .12 && !c.side.sunroof;
        if (!hood && !deck && !roof) continue;
        down.ray.origin.set(x, 3, z);
        const hit = down.intersectObject(g, true)[0];
        if (hit?.object !== mesh) continue; // 루프랙·스포일러 등 부품이 먼저 맞으면 넘어간다
        expect(hit.face!.materialIndex, `${bodyId} ${era} 시드${s} x=${x.toFixed(2)} ${hood ? '보닛' : deck ? '트렁크' : '지붕'}`).toBe(0);
      }
      // 스포일러(차체 폭의 검은 상자)의 아래 끝이 바로 밑 차체 윗면에서 1cm 안
      const sp = g.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.material === M.dark && o.geometry instanceof THREE.BoxGeometry && o.geometry.parameters.depth > c.W - .5);
      if (sp) {
        const legs = g.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.BoxGeometry && o.material === M.dark && Math.abs(o.position.x - sp.position.x) < .1 && o !== sp && o.geometry.parameters.depth === .04);
        const bottom = Math.min(sp.position.y - .014, ...legs.map(o => o.position.y - (o.geometry as THREE.BoxGeometry).parameters.height / 2));
        const ray = new THREE.Raycaster(new THREE.Vector3(sp.position.x, 3, legs[0]?.position.z ?? 0), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(mesh)[0];
        expect(hit, `${bodyId} 스포일러 아래 차체 없음`).toBeTruthy();
        expect(bottom - hit.point.y, `${bodyId} ${era} 스포일러 뜸`).toBeLessThan(.01);
      }
      disposeCar(g);
    }
  }, 60000);

  it('옆모습 SVG는 3D와 같은 차대 값(바퀴 반지름·위치)을 쓴다', () => {
    const l = look({ bodyId: 'suv', chassisSeed: 9, wheel: 2 }), c = chassisOf(l), svg = silhouetteSvg(l);
    expect(svg).toContain(`cx="${-c.wb}" cy="${c.wr.toFixed(2)}"`);
  });
});

describe('사무실·시대 분위기(0.13.0)', () => {
  it('본사 등급마다 임원 자리 수는 설정과 같고, 방은 등급이 오를수록 넓어지며, 모든 책상·서는 곳에서 탕비 공간까지 걸어갈 수 있다', () => {
    let lastArea = 0;
    for (const lv of [1, 2, 3, 4, 5] as const) {
      const rm = roomFor(lv), coffee = rm.spots.find((q) => q.kind === 'coffee')!;
      expect(rm.execs.length).toBe(EXEC_SEATS[lv]);
      expect(EXEC_SEATS[lv]).toBe(config.exec.seats[lv - 1]);
      expect(rm.seats.length).toBe(CAPACITY[lv]);
      expect(rm.W * rm.D).toBeGreaterThan(lastArea); lastArea = rm.W * rm.D;
      for (const st of rm.seats) expect(findPath(rm.grid, st.access, [coffee.x, coffee.y]), `등급 ${lv} 자리 길 없음`).not.toBeNull();
      for (const sp of rm.spots) expect(findPath(rm.grid, [sp.x, sp.y], [coffee.x, coffee.y]), `등급 ${lv} ${sp.kind} 길 없음`).not.toBeNull();
      // 임원실은 사무 책상과 겹치지 않는다
      for (const e of rm.execs) for (const d of rm.furn.filter((f) => f.kind === 'desk')) expect(e.x > d.x && e.x < d.x + d.w && e.y > d.y && e.y < d.y + d.d).toBe(false);
    }
  });

  it('시대 분위기는 10년 단위(1970년 이전은 1970, 2020년 이후는 2020)', () => {
    expect([1965, 1970, 1979, 1980, 1999, 2004, 2015, 2020, 2031].map(decadeOf)).toEqual([1970, 1970, 1970, 1980, 1990, 2000, 2010, 2020, 2020]);
  });
});
