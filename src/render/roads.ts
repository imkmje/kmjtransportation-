import * as THREE from 'three';
import { config } from '../config';
import type { Network, Pt, RoadKind } from '../sim/network';
import { toThree } from './coords';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitDisk = new THREE.CylinderGeometry(1, 1, 1, 24);
const octagon = new THREE.CylinderGeometry(1, 1, 0.12, 8);
const triangle = new THREE.CylinderGeometry(1, 1, 0.12, 3);
const poleGeo = new THREE.BoxGeometry(0.18, 2.4, 0.18);
const poleMat = new THREE.MeshLambertMaterial({ color: 0x8b8f96 });
const redMat = new THREE.MeshLambertMaterial({ color: 0xd63a31 });
const whiteMat = new THREE.MeshLambertMaterial({ color: 0xf6f6f6 });
const roadMat = new THREE.MeshLambertMaterial({ color: 0x585d66 });
const goodMat = new THREE.MeshBasicMaterial({ color: 0x3fae5a, transparent: true, opacity: 0.55, depthWrite: false });
const markMat = new THREE.MeshBasicMaterial({ color: 0x2f6fe0, transparent: true, opacity: 0.8, depthWrite: false });
const badMat = new THREE.MeshBasicMaterial({ color: 0xe0443c, transparent: true, opacity: 0.6, depthWrite: false });

const roadWidth = (kind: RoadKind, oneWay = false) => config.roads[kind].lanesPerDir * (oneWay ? 1 : 2) * config.roads[kind].laneWidth; // 일방통행은 한 방향 차선 폭만
const walkMat = new THREE.MeshLambertMaterial({ color: 0xb9bdc4 });
const whiteLine = new THREE.MeshBasicMaterial({ color: 0xf4f4f0 });
const yellowLine = new THREE.MeshBasicMaterial({ color: 0xe8b93c });

// 두 점 사이에 가로×세로×높이 상자를 놓는다(상자의 긴 쪽이 두 점 방향)
function place(m: THREE.Mesh, a: Pt, b: Pt, width: number, height: number, bottom: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const c = toThree((a.x + b.x) / 2, (a.y + b.y) / 2, bottom + height / 2);
  m.position.set(c.x, c.y, c.z);
  m.scale.set(len, height, width);
  m.rotation.y = Math.atan2(b.y - a.y, b.x - a.x);
}

// 속도 제한 표지판: 하얀 원에 빨간 테두리, 가운데 숫자. 같은 숫자는 한 번만 만든다
const limitMats = new Map<number, THREE.SpriteMaterial>();
function limitMaterial(kmh: number): THREE.SpriteMaterial {
  let m = limitMats.get(kmh);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#d63a31'; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#1d2630'; g.font = 'bold 56px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(kmh), 64, 68);
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false });
    limitMats.set(kmh, m);
  }
  return m;
}

// 통행 제한 표지판(스프라이트): 진입 금지 = 빨간 원에 흰 막대, 좌회전 금지 = 흰 원에 빨간 테두리·왼쪽 꺾는 화살표·빨간 사선
const restrictMats = new Map<string, THREE.SpriteMaterial>();
function restrictMaterial(kind: 'noEntry' | 'noLeft'): THREE.SpriteMaterial {
  let m = restrictMats.get(kind);
  if (!m) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    if (kind === 'noEntry') {
      g.fillStyle = '#d63a31'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.fillRect(24, 54, 80, 20);
    } else {
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d63a31'; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = '#1d2630'; g.lineWidth = 11; g.lineCap = 'round'; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(70, 98); g.lineTo(70, 56); g.lineTo(40, 56); g.stroke(); // 위로 가다 왼쪽으로 꺾는 선
      g.beginPath(); g.moveTo(54, 40); g.lineTo(38, 56); g.lineTo(54, 72); g.stroke(); // 화살촉
      g.strokeStyle = '#d63a31'; g.lineWidth = 12; g.beginPath(); g.moveTo(30, 98); g.lineTo(98, 30); g.stroke(); // 사선
    }
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false });
    restrictMats.set(kind, m);
  }
  return m;
}

export function createRoadLayer(scene: THREE.Scene, net: Network) {
  const group = new THREE.Group();
  scene.add(group);
  const ghost = new THREE.Mesh(unitBox, goodMat);
  const hover = new THREE.Mesh(unitBox, badMat);
  const selected = new THREE.Mesh(unitBox, markMat);
  const curveGhosts: THREE.Mesh[] = [];
  const cursor = new THREE.Mesh(unitDisk, goodMat);
  const mark = new THREE.Mesh(unitDisk, markMat);
  for (const m of [ghost, hover, selected, cursor, mark]) { m.visible = false; m.renderOrder = 1; scene.add(m); }
  let shown = -1;

  // 도로 몸체·인도·차선 표시·교차로 판은 종류별로 InstancedMesh 하나로 모아 그린다(도로가 수백 개여도 그리기 호출이 몇 번뿐이다)
  type Inst = { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number };
  function flush(geo: THREE.BufferGeometry, mat: THREE.Material, list: Inst[]) {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    m.frustumCulled = false;
    const d = new THREE.Object3D();
    list.forEach((it, i) => { d.position.set(it.x, it.y, it.z); d.scale.set(it.sx, it.sy, it.sz); d.rotation.set(0, it.ry, 0); d.updateMatrix(); m.setMatrixAt(i, d.matrix); });
    group.add(m);
  }

  function rebuild() {
    group.children.forEach((c) => (c as THREE.InstancedMesh).dispose?.());
    group.clear();
    const radius = new Map<number, number>();
    for (const s of net.segments.values()) for (const id of [s.a, s.b]) radius.set(id, Math.max(radius.get(id) ?? 0, config.roads[s.kind].lanesPerDir * config.roads[s.kind].laneWidth + 2));
    const bodies: Inst[] = [], walks: Inst[] = [], whites: Inst[] = [], yellows: Inst[] = [], discs: Inst[] = [];
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, ry = Math.atan2(b.y - a.y, b.x - a.x);
      const r = config.roads[s.kind], w = r.laneWidth, k = r.lanesPerDir, width = roadWidth(s.kind, !!s.oneWay);
      // 한 줄(선·띠): 구간 안에서 거리 t0~t1, 옆으로 off만큼 떨어진 곳(왼쪽 +). z는 바닥 높이
      const strip = (list: Inst[], t0: number, t1: number, off: number, wd: number, h: number, z0: number) => {
        if (t1 - t0 < 0.5) return;
        const t = (t0 + t1) / 2, p = toThree(a.x + ux * t - uy * off, a.y + uy * t + ux * off, z0 + h / 2);
        list.push({ x: p.x, y: p.y, z: p.z, sx: t1 - t0, sy: h, sz: wd, ry });
      };
      strip(bodies, 0, len, 0, width, 0.2, 0); // 아스팔트
      const t0 = Math.min(radius.get(s.a)!, len / 2), t1 = Math.max(len - radius.get(s.b)!, len / 2); // 교차로 판 사이 구간
      const half = width / 2;
      strip(walks, t0, t1, half + 1, 2, 0.32, 0); strip(walks, t0, t1, -(half + 1), 2, 0.32, 0); // 인도(양쪽)
      strip(whites, t0, t1, half - 0.25, 0.18, 0.02, 0.2); strip(whites, t0, t1, -(half - 0.25), 0.18, 0.02, 0.2); // 가장자리 실선
      if (!s.oneWay) { strip(yellows, t0, t1, 0.18, 0.14, 0.02, 0.2); strip(yellows, t0, t1, -0.18, 0.14, 0.02, 0.2); } // 중앙 이중 황색선
      // 차선 구분선(흰 점선): 같은 방향 차선 사이마다. 일방통행은 가운데를 기준으로 좌우에 k-1개
      const dividers = s.oneWay ? Array.from({ length: k - 1 }, (_, j) => (j + 1 - k / 2) * w) : Array.from({ length: k - 1 }, (_, j) => [(j + 1) * w, -(j + 1) * w]).flat();
      for (const off of dividers) for (let t = t0 + 1; t + 3 <= t1; t += 8) strip(whites, t, t + 3, off, 0.15, 0.02, 0.2);
    }
    for (const [id, rr] of radius) {
      const n = net.nodes.get(id)!, c = toThree(n.x, n.y, 0.15);
      discs.push({ x: c.x, y: c.y, z: c.z, sx: rr, sy: 0.3, sz: rr, ry: 0 }); // 교차로·끝점은 둥근 판으로 덮어 이음새를 가린다(조금 더 높게: 겹침 깜빡임 방지)
    }
    flush(unitBox, roadMat, bodies);
    flush(unitDisk, roadMat, discs);
    flush(unitBox, walkMat, walks);
    flush(unitBox, whiteLine, whites);
    flush(unitBox, yellowLine, yellows);
    // 정지·양보 표지: 교차로로 들어오는 방향의 오른쪽 길가, 노드에서 조금 떨어진 곳에 세운다
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (const [kind, node, dir] of [[s.signB, b, 1], [s.signA, a, -1]] as const) {
        if (!kind) continue;
        const hw = roadWidth(s.kind) / 2;
        // 들어오는 진행 방향(노드를 향함) = dir*(ux,uy). 오른쪽 = (uy, -ux) 방향
        const tx = dir * ux, ty = dir * uy;
        const x = node.x - tx * (hw + 3) + ty * (hw + 1.2), y = node.y - ty * (hw + 3) - tx * (hw + 1.2);
        const g = new THREE.Group();
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.2;
        g.add(pole);
        const head = new THREE.Group();
        head.position.y = 2.7;
        head.rotation.x = Math.PI / 2; // 원판이 진행 방향 쪽을 향하게 눕힌다
        if (kind === 'stop') {
          const m = new THREE.Mesh(octagon, redMat);
          m.scale.set(0.95, 1, 0.95);
          m.rotation.y = Math.PI / 8;
          head.add(m);
        } else {
          const outer = new THREE.Mesh(triangle, redMat);
          outer.scale.set(1.15, 1, 1.15);
          outer.rotation.y = 0; // 꼭짓점이 아래로(양보 표지)
          const inner = new THREE.Mesh(triangle, whiteMat);
          inner.scale.set(0.72, 1.4, 0.72);
          inner.rotation.y = 0;
          head.add(outer, inner);
        }
        g.add(head);
        const p = toThree(x, y, 0);
        g.position.set(p.x, p.y, p.z);
        g.rotation.y = Math.atan2(-tx, ty); // 표지 앞면이 달려오는 차량 쪽(-진행방향)을 향한다
        group.add(g);
      }
    }
    // 일방통행: 도로 위에 가는 방향을 가리키는 흰 화살표를 일정 간격으로 그린다
    for (const s of net.segments.values()) {
      if (!s.oneWay) continue;
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const sgn = s.oneWay === 'ab' ? 1 : -1;
      const dx = ((b.x - a.x) / len) * sgn, dy = ((b.y - a.y) / len) * sgn;
      const n = Math.max(1, Math.floor(len / 28));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        const p = toThree(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 0.26);
        const m = new THREE.Mesh(triangle, whiteMat);
        m.position.set(p.x, p.y, p.z);
        m.scale.set(2.2, 1, 2.2);
        m.rotation.y = Math.atan2(dx, -dy); // 삼각형 꼭짓점이 가는 방향을 향한다
        group.add(m);
      }
    }
    // 통행 제한 표지판: 도로 끝에서 조금 떨어진 오른쪽 길가에 기둥 위로(항상 카메라를 향한다)
    for (const s of net.segments.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      for (const [kind, node, dir] of [[s.restrictB, b, 1], [s.restrictA, a, -1]] as const) {
        if (!kind) continue;
        const hw = roadWidth(s.kind) / 2, tx = dir * ux, ty = dir * uy;
        const x = node.x - tx * (hw + 9) + ty * (hw + 1.2), y = node.y - ty * (hw + 9) - tx * (hw + 1.2);
        const pole = new THREE.Mesh(poleGeo, poleMat);
        const pp = toThree(x, y, 1.2);
        pole.position.set(pp.x, pp.y, pp.z);
        const sp = new THREE.Sprite(restrictMaterial(kind));
        const q = toThree(x, y, 3.6);
        sp.position.set(q.x, q.y, q.z);
        sp.scale.set(3.2, 3.2, 1);
        group.add(pole, sp);
      }
    }
    // 속도를 바꾼 도로: 도로 가운데 위에 제한속도 표지판
    for (const s of net.segments.values()) {
      if (s.playerSpeedKmh === null) continue;
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const sp = new THREE.Sprite(limitMaterial(s.playerSpeedKmh));
      const p = toThree((a.x + b.x) / 2, (a.y + b.y) / 2, 7);
      sp.position.set(p.x, p.y, p.z);
      sp.scale.set(9, 9, 1);
      group.add(sp);
    }
  }

  return {
    /** 도로망이 바뀌었으면 다시 그린다. 매 프레임 호출해도 싸다 */
    sync() {
      if (net.revision !== shown) { rebuild(); shown = net.revision; }
    },
    setGhost(a: Pt, b: Pt, kind: RoadKind, valid: boolean) {
      place(ghost, a, b, roadWidth(kind), 0.5, 0);
      ghost.material = valid ? goodMat : badMat;
      ghost.visible = true;
    },
    clearGhost() { ghost.visible = false; },
    /** 곡선 미리보기: 점 목록을 이은 직선 조각들을 초록(건설 가능)/빨강(불가)으로 보여 준다. null이면 지운다 */
    setCurve(pts: Pt[] | null, kind: RoadKind, ok: boolean) {
      const n = pts ? pts.length - 1 : 0;
      while (curveGhosts.length < n) { const m = new THREE.Mesh(unitBox, goodMat); m.renderOrder = 1; scene.add(m); curveGhosts.push(m); }
      curveGhosts.forEach((m, i) => {
        m.visible = i < n;
        if (i < n && pts) { m.material = ok ? goodMat : badMat; place(m, pts[i], pts[i + 1], roadWidth(kind), 0.5, 0); }
      });
    },
    /** 정보 창에서 보고 있는 도로를 파랗게 표시 */
    setSelect(segId: number | null) {
      const s = segId === null ? undefined : net.segments.get(segId);
      selected.visible = !!s;
      if (s) place(selected, net.nodes.get(s.a)!, net.nodes.get(s.b)!, roadWidth(s.kind) + 2.5, 0.7, 0);
    },
    setHover(segId: number | null) {
      const s = segId === null ? undefined : net.segments.get(segId);
      hover.visible = !!s;
      if (s) place(hover, net.nodes.get(s.a)!, net.nodes.get(s.b)!, roadWidth(s.kind) + 2, 0.6, 0);
    },
    /** 차량 투입 도구의 출발점 표시(파랑) */
    setMark(p: Pt | null) {
      mark.visible = !!p;
      if (!p) return;
      const c = toThree(p.x, p.y, 0.3);
      mark.position.set(c.x, c.y, c.z);
      mark.scale.set(5, 0.6, 5);
    },
    setCursor(p: Pt | null, valid: boolean) {
      cursor.visible = !!p;
      if (!p) return;
      const c = toThree(p.x, p.y, 0.25);
      cursor.position.set(c.x, c.y, c.z);
      cursor.scale.set(4, 0.5, 4);
      cursor.material = valid ? goodMat : badMat;
    },
  };
}
export type RoadLayer = ReturnType<typeof createRoadLayer>;
