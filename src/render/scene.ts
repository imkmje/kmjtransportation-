import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { toThree, fromThree } from './coords';
import type { Pt } from '../sim/network';

const WORLD = 2000; // 지면 한 변(m)

export function createScene(canvasParent: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasParent.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcfe8f7);
  scene.fog = new THREE.Fog(0xcfe8f7, 1500, 3500);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshLambertMaterial({ color: 0xb9dfa3 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const grid = new THREE.GridHelper(WORLD, WORLD / 20, 0x5f8f4c, 0x86b572); // 20m 칸
  grid.position.y = 0.05;
  scene.add(grid);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9bb58a, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(300, 500, 200);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(50, 1, 1, 6000);
  camera.position.set(250, 250, 250);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  controls.screenSpacePanning = false; // 지면 위에서 이동
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }; // 터치: 한 손가락 이동, 두 손가락 확대·이동. 회전(비틀기)은 아래에서 따로 처리
  controls.enableDamping = true;
  controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
  controls.minDistance = 30;
  controls.maxDistance = 1500;

  // 두 손가락을 비틀면 그 각도만큼 화면이 돈다(OrbitControls 기본 방식은 두 손가락 중간점을 위아래·좌우로 끌어야 돌아서 알아차리기 어렵다)
  const touches = new Map<number, { x: number; y: number }>();
  const twist = () => { const [a, b] = [...touches.values()]; return Math.atan2(b.y - a.y, b.x - a.x); };
  renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch' || !touches.has(e.pointerId)) return;
    if (touches.size !== 2) { touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); return; }
    const before = twist();
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    let d = twist() - before;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    const v = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), d);
    camera.position.copy(controls.target).add(v);
  });
  const lift = (e: PointerEvent) => touches.delete(e.pointerId);
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
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      const p = fromThree(hit.x, hit.y, hit.z);
      return Math.abs(p.x) > limit || Math.abs(p.y) > limit ? null : p;
    },
    /** 카메라 기울기(도): 0 = 바로 위에서 내려다봄, 80 = 거의 수평. 화면을 도는 각도와 거리는 그대로 */
    getTilt(): number { return THREE.MathUtils.radToDeg(controls.getPolarAngle()); },
    setTilt(deg: number) {
      const s = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      s.phi = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(deg), 0.05, controls.maxPolarAngle);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    },
    /** 카메라를 시뮬 좌표 p 위쪽으로 옮긴다 */
    focus(p: Pt) {
      const t = toThree(p.x, p.y, 0);
      controls.target.set(t.x, 0, t.z);
      camera.position.set(t.x + 250, 250, t.z + 250);
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
      controls.target.x = THREE.MathUtils.clamp(controls.target.x, -limit, limit);
      controls.target.z = THREE.MathUtils.clamp(controls.target.z, -limit, limit);
      renderer.render(scene, camera);
    },
  };
}
