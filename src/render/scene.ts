import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toThree, fromThree, setHeightField, groundHeight } from './coords';
import { terrainHeight } from '../sim/terrain';
import { roadSpan, type Network } from '../sim/network';
import { config } from '../config';
import { createLook } from './look';
import type { Pt } from '../sim/network';

const WORLD = 2000; // 지면 한 변(m)

export function createScene(canvasParent: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping; // 파스텔 색을 칙칙하게 만들지 않으면서 밝은 곳이 하얗게 날아가는 것을 막는다
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const look = createLook(scene);

  // 땅: 얇은 얼룩 무늬(잔디 느낌)를 반복해서 밋밋함을 줄인다
  const grassTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
    let r = 7; const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 420; i++) { const x = rnd() * 256, y = rnd() * 256, rad = 10 + rnd() * 34, v = rnd() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},${0.012 + rnd() * 0.022})`; for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill(); } }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(WORLD / 160, WORLD / 160); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  })();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshLambertMaterial({ color: 0xb2d99b, map: grassTex }),
  );
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // 지형: 평지면 위의 단순 평면, 지형이 있으면 높이에 맞춰 일그러뜨린 격자 면 + 강물 면
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD, WORLD), new THREE.MeshPhongMaterial({ color: 0x3f86c4, transparent: true, opacity: 0.82, shininess: 90, specular: 0x9fd0ff }));
  water.rotation.x = -Math.PI / 2; water.visible = false; scene.add(water);
  let curDef = '\u0000', curRev = -1, lastBuild = -1e9; // 처음에는 반드시 한 번 만든다
  const lowC = new THREE.Color(0xcdbd8e), deepC = new THREE.Color(0x9c9a78), grassA = new THREE.Color(0xc2e5a4), grassB = new THREE.Color(0x8fc47c), highC = new THREE.Color(0x8c9a6a), rockC = new THREE.Color(0x9a8f78), tmp = new THREE.Color();
  const N = 250, STEP = WORLD / N, W1 = N + 1;
  let H = new Float32Array(W1 * W1);
  // 등고선: 높이 4m마다 가는 선을 그려 높낮이가 한눈에 보이게 한다
  const contour = { value: 0 };
  (ground.material as THREE.MeshLambertMaterial).onBeforeCompile = (sh) => {
    sh.uniforms.uContour = contour;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;').replace('#include <begin_vertex>', '#include <begin_vertex>\n vH = position.y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH; uniform float uContour;').replace('#include <color_fragment>', '#include <color_fragment>\n float cu = vH / 4.0; float cd = abs(fract(cu - 0.5) - 0.5) / max(fwidth(cu), 1e-5); diffuseColor.rgb *= 1.0 - 0.2 * uContour * (1.0 - min(cd, 1.0));');
  };
  // 지도 가장자리 단면(디오라마): 땅 아래로 흙색 벽을 내려 "미니어처 도시 모형" 느낌을 준다
  const skirt = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  scene.add(skirt);
  function buildSkirt(edgeH: (x: number, y: number) => number) {
    const pos: number[] = [], col: number[] = [], idx: number[] = [], top = new THREE.Color(0x8d7a62), bot = new THREE.Color(0x4f4234), half = WORLD / 2, DEPTH = 60;
    const sides: [number, number, number, number][] = [[-half, -half, half, -half], [half, -half, half, half], [half, half, -half, half], [-half, half, -half, -half]];
    for (const [x0, y0, x1, y1] of sides) {
      const base = pos.length / 3;
      for (let k = 0; k <= 100; k++) {
        const t = k / 100, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, h = edgeH(x, y);
        pos.push(x, h, -y, x, -DEPTH, -y);
        col.push(top.r, top.g, top.b, bot.r, bot.g, bot.b);
        if (k < 100) { const a = base + k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
    skirt.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    skirt.geometry = g;
  }
  buildSkirt(() => 0);

  /** 지형 높이(도로가 깎고 메운 뒤)를 칸 사이로 보간해 돌려준다 */
  const sampleH = (x: number, y: number): number => {
    const fx = Math.min(N - 1e-6, Math.max(0, (x + WORLD / 2) / STEP)), fy = Math.min(N - 1e-6, Math.max(0, (WORLD / 2 - y) / STEP));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    return H[j * W1 + i] * (1 - u) * (1 - v) + H[j * W1 + i + 1] * u * (1 - v) + H[(j + 1) * W1 + i] * (1 - u) * v + H[(j + 1) * W1 + i + 1] * u * v;
  };
  const smooth = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  /** 지형 면을 다시 만든다: 지형 높이 + 지상 도로 아래를 도로 높이에 맞춰 깎고 메운 땅(도로가 언덕에 묻히거나 떠 보이지 않게) */
  function rebuildGround(net: Network) {
    const def = net.terrain!;
    const base = new Float32Array(W1 * W1);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) base[j * W1 + i] = terrainHeight(def, -WORLD / 2 + i * STEP, WORLD / 2 - j * STEP);
    const wgt = new Float32Array(W1 * W1), tgt = new Float32Array(W1 * W1), margin = 18;
    for (const sg of net.segments.values()) {
      if (sg.structure !== 'ground' || sg.over) continue; // 다리·터널·고가는 땅을 건드리지 않는다
      const a = net.nodes.get(sg.a)!, b = net.nodes.get(sg.b)!, r = config.roads[sg.kind], half = roadSpan(r, !!sg.oneWay).width / 2 + 3, reach = half + margin;
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, l2 = len * len;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach + WORLD / 2) / STEP)), i1 = Math.min(N, Math.ceil((Math.max(a.x, b.x) + reach + WORLD / 2) / STEP));
      const j0 = Math.max(0, Math.floor((WORLD / 2 - Math.max(a.y, b.y) - reach) / STEP)), j1 = Math.min(N, Math.ceil((WORLD / 2 - Math.min(a.y, b.y) + reach) / STEP));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = -WORLD / 2 + i * STEP, y = WORLD / 2 - j * STEP, u = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / l2)), d = Math.hypot(x - (a.x + dx * u), y - (a.y + dy * u));
        if (d >= reach) continue;
        const w = 1 - smooth(half, reach, d), k = j * W1 + i;
        if (w > wgt[k]) { wgt[k] = w; tgt[k] = net.segmentZ(sg, u * len) - 0.1; }
      }
    }
    for (let k = 0; k < base.length; k++) H[k] = base[k] * (1 - wgt[k]) + tgt[k] * wgt[k];
    const g = new THREE.PlaneGeometry(WORLD, WORLD, N, N);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const i = k % W1, j = (k / W1) | 0, h = H[k];
      pos.setY(k, h);
      const sx = (H[j * W1 + Math.min(N, i + 1)] - H[j * W1 + Math.max(0, i - 1)]) / (2 * STEP), sy = (H[Math.min(N, j + 1) * W1 + i] - H[Math.max(0, j - 1) * W1 + i]) / (2 * STEP), slope = Math.hypot(sx, sy);
      if (h < def.waterLevel - 0.3) tmp.copy(deepC);
      else if (h < def.waterLevel + 0.8) tmp.copy(lowC);
      else { const t = Math.min(1, Math.max(0, (h - def.waterLevel) / Math.max(8, def.amp * 0.8))); tmp.copy(grassA).lerp(grassB, Math.min(1, t * 1.6)).lerp(highC, smooth(0.55, 1, t)); }
      tmp.lerp(rockC, smooth(0.28, 0.6, slope) * 0.85); // 가파른 곳은 바위색
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    ground.geometry.dispose();
    ground.geometry = g;
    buildSkirt((x, y) => sampleH(x, y));
  }

  /** 지형·도로가 바뀌었으면 땅을 다시 만든다(도로만 바뀐 경우는 0.3초 간격으로 모아서) */
  function syncTerrain(net: Network, now: number, force = false) {
    const def = net.terrain, defKey = def ? JSON.stringify(def) : '', rev = def ? net.revision : 0;
    if (defKey === curDef && rev === curRev) return;
    if (!force && defKey === curDef && now - lastBuild < 300) return; // 도로만 바뀐 경우는 모아서
    curDef = defKey; curRev = rev; lastBuild = now;
    if (!def) {
      setHeightField(() => 0);
      ground.geometry.dispose(); ground.geometry = new THREE.PlaneGeometry(WORLD, WORLD);
      ground.rotation.x = -Math.PI / 2; ground.castShadow = false; contour.value = 0;
      (ground.material as THREE.MeshLambertMaterial).vertexColors = false; (ground.material as THREE.MeshLambertMaterial).needsUpdate = true;
      water.visible = false; grid.visible = true; buildSkirt(() => 0);
      return;
    }
    rebuildGround(net);
    setHeightField(sampleH);
    ground.rotation.x = 0; ground.castShadow = true; contour.value = 1;
    (ground.material as THREE.MeshLambertMaterial).vertexColors = true; (ground.material as THREE.MeshLambertMaterial).needsUpdate = true;
    water.position.y = def.waterLevel; water.visible = true;
    grid.visible = false;
  }

  const grid = new THREE.GridHelper(WORLD, WORLD / 20, 0x6f9f5c, 0x86b572); // 20m 칸(은은하게)
  for (const m of [grid.material].flat()) { m.transparent = true; m.opacity = 0.22; m.depthWrite = false; }
  grid.position.y = 0.05;
  scene.add(grid);

  const { sun } = look;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.5;
  let shadowsOn = true;

  // 비: 카메라가 보는 지점 주변에서 떨어지는 빗줄기(보기 전용 효과)
  const RAIN = 700, rainPos = new Float32Array(RAIN * 6), rainSeed = new Float32Array(RAIN * 3);
  let rs = 12345; const rnd = () => ((rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < RAIN; i++) { rainSeed[i * 3] = (rnd() - 0.5) * 360; rainSeed[i * 3 + 1] = rnd() * 160; rainSeed[i * 3 + 2] = (rnd() - 0.5) * 360; }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainLines = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.55 }));
  rainLines.frustumCulled = false; rainLines.visible = false;
  scene.add(rainLines);
  let rainT = 0, hour = 12, raining = false;
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  camera.position.set(250, 250, 250);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.screenSpacePanning = false; // 지면 위에서 이동
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: -1 as THREE.TOUCH }; // 터치: 한 손가락 이동. 두 손가락 제스처(확대·회전·기울기·이동)는 아래에서 직접 처리
  controls.enableDamping = true;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
  controls.minDistance = 30;
  controls.maxDistance = 1500;

  // 두 손가락 제스처(구글맵처럼): 벌리고 오므리기 = 확대·축소, 비틀기 = 회전, 두 손가락을 같이 위아래로 = 기울기, 좌우로 = 이동.
  // 위아래/좌우는 처음 움직인 방향으로 정해져 그 제스처가 끝날 때까지 유지된다(떨림으로 기울기와 이동이 섞이지 않게)
  const touches = new Map<number, { x: number; y: number }>();
  let g: { mid: { x: number; y: number }; dist: number; ang: number; sx: number; sy: number; mode: 'none' | 'tilt' | 'pan' } | null = null;
  const pair = () => { const [a, b] = [...touches.values()]; return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) }; };
  const up = new THREE.Vector3(0, 1, 0);
  function applyGesture() {
    const cur = pair();
    if (!g) { g = { ...cur, sx: 0, sy: 0, mode: 'none' }; return; }
    const off = camera.position.clone().sub(controls.target);
    // 확대·축소
    if (g.dist > 10 && cur.dist > 10) off.setLength(THREE.MathUtils.clamp(off.length() * (g.dist / cur.dist), controls.minDistance, controls.maxDistance));
    // 회전(비틀기)
    let d = cur.ang - g.ang;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    off.applyAxisAngle(up, d);
    // 기울기 / 이동
    const dx = cur.mid.x - g.mid.x, dy = cur.mid.y - g.mid.y;
    if (g.mode === 'none') {
      g.sx += dx; g.sy += dy;
      if (Math.hypot(g.sx, g.sy) > 12) g.mode = Math.abs(g.sy) > Math.abs(g.sx) ? 'tilt' : 'pan';
    } else if (g.mode === 'tilt') {
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.phi = THREE.MathUtils.clamp(sph.phi - dy * 0.004, 0.05, controls.maxPolarAngle); // 위로 밀면 눕고(수평에 가깝게), 아래로 밀면 일어선다
      off.setFromSpherical(sph);
    } else {
      const upp = (2 * off.length() * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / renderer.domElement.clientHeight; // 화면 1px = 지면 몇 m
      const fwd = off.clone().negate().setY(0).normalize();
      const right = new THREE.Vector3().crossVectors(fwd, up);
      controls.target.addScaledVector(right, -dx * upp).addScaledVector(fwd, dy * upp);
    }
    camera.position.copy(controls.target).add(off);
    g = { ...g, ...cur };
  }
  renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); g = null; } });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) applyGesture();
  });
  const lift = (e: PointerEvent) => { touches.delete(e.pointerId); g = null; };
  renderer.domElement.addEventListener('pointerup', lift);
  renderer.domElement.addEventListener('pointercancel', lift);

  function resize() {
    const w = canvasParent.clientWidth;
    const h = canvasParent.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const limit = WORLD / 2;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  return {
    scene,
    domElement: renderer.domElement,
    /** 도로를 그리는 중이면 true. 마우스 왼쪽 버튼·터치 한 손가락은 그리기에 쓰고 카메라는 움직이지 않는다.
     *  (가운데 버튼 드래그, 오른쪽 버튼 회전, 두 손가락 확대·이동은 그대로 쓸 수 있다) */
    setDrawMode(on: boolean) {
      controls.mouseButtons.LEFT = on ? (-1 as THREE.MOUSE) : THREE.MOUSE.PAN;
      controls.touches.ONE = on ? (-1 as THREE.TOUCH) : THREE.TOUCH.PAN;
    },
    /** 화면 좌표(client) → 지면 위 시뮬 좌표. 지면 밖이면 null */
    pickGround(clientX: number, clientY: number): Pt | null {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (curDef) { // 지형이 있으면 광선을 따라가며 지면과 만나는 곳을 찾는다
        const o = raycaster.ray.origin, d = raycaster.ray.direction;
        const f = (t: number) => o.y + d.y * t - groundHeight(o.x + d.x * t, -(o.z + d.z * t));
        let lo = 0, hi = -1;
        for (let t = 0; t < 8000; t += 6) { if (f(t) <= 0) { hi = t; break; } lo = t; }
        if (hi < 0) return null;
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (f(mid) <= 0) hi = mid; else lo = mid; }
        hit.copy(o).addScaledVector(d, hi);
      } else if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      const p = fromThree(hit.x, hit.y, hit.z);
      return Math.abs(p.x) > limit || Math.abs(p.y) > limit ? null : p;
    },
    /** 비 오는 날은 하늘·안개가 회색으로, 햇빛이 약해진다 */
    syncTerrain,
    setWeather(rain: boolean) { rainLines.visible = rain; raining = rain; },
    /** 시계 시각(0~24, 시간+분/60): 햇빛·하늘·밤 조명에 쓴다 */
    setHour(h: number) { hour = h; },
    /** 그림자를 켜고 끈다(느린 기기용) */
    setShadows(on: boolean) { shadowsOn = on; renderer.shadowMap.enabled = on; sun.castShadow = on; scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; }); },
    getShadows: () => shadowsOn,
    /** 카메라를 보는 방향·거리 그대로 시뮬 좌표 p 위로 옮긴다(차량 따라가기) */
    panTo(p: Pt) {
      const t = toThree(p.x, p.y, 0);
      const dx = t.x - controls.target.x, dz = t.z - controls.target.z;
      controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
    },
    /** 렌더러 통계(그리기 호출 수·삼각형 수). 성능 점검용 */
    info: renderer.info,
    /** 카메라 기울기(도): 0 = 바로 위에서 내려다봄, 80 = 거의 수평. 화면을 도는 각도와 거리는 그대로 */
    getTilt(): number { return THREE.MathUtils.radToDeg(controls.getPolarAngle()); },
    /** 카메라를 시뮬 좌표 p 위쪽으로 옮긴다 */
    focus(p: Pt) {
      const t = toThree(p.x, p.y, 0);
      controls.target.set(t.x, t.y, t.z);
      camera.position.set(t.x + 250, t.y + 250, t.z + 250);
    },
    /** 시뮬 좌표 → 화면 좌표(client). 테스트·디버깅용 */
    project(p: Pt): { x: number; y: number } {
      const t = toThree(p.x, p.y, 0);
      const v = new THREE.Vector3(t.x, t.y, t.z).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    render() {
      controls.update();
      look.update(hour, raining, camera);
      { // 그림자 범위는 카메라가 보는 곳 주변. 가까이 볼수록 촘촘하게, 가장자리 깜빡임을 막으려 격자에 맞춘다
        const dist = camera.position.distanceTo(controls.target), half = THREE.MathUtils.clamp(dist * 0.6, 110, 700), q = (half * 2) / 2048;
        const tx = Math.round(controls.target.x / q) * q, tz = Math.round(controls.target.z / q) * q;
        const d = (sun.userData.dir as THREE.Vector3 | undefined) ?? new THREE.Vector3(0.5, 1, 0.5).normalize();
        sun.target.position.set(tx, controls.target.y, tz);
        sun.position.set(tx + d.x * 900, controls.target.y + d.y * 900, tz + d.z * 900);
        const sc = sun.shadow.camera;
        if (sc.right !== half) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 50; sc.far = 2200; sc.updateProjectionMatrix(); }
      }
      if (rainLines.visible) { // 빗줄기를 아래로 흘리고, 바닥에 닿으면 위로 되돌린다
        rainT += 1;
        for (let i = 0; i < RAIN; i++) {
          const y = ((rainSeed[i * 3 + 1] - rainT * 2.2) % 160 + 160) % 160, x = controls.target.x + rainSeed[i * 3], z = controls.target.z + rainSeed[i * 3 + 2];
          rainPos.set([x, y, z, x - 0.6, y + 3.2, z], i * 6);
        }
        rainGeo.attributes.position.needsUpdate = true;
      }
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -limit, limit);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -limit, limit);
      renderer.render(scene, camera);
    },
  };
}
