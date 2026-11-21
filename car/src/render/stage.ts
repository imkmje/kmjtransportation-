import * as THREE from 'three';
import type { CarLook } from './look';
import { chassisOf } from './variant';
import { buildCar, createCarMaterials, disposeCar, type CarMaterials } from './carBuilder';

// 회전 무대: 조명·원판·눈금·그림자·환경 반사는 데모(car-studio.html initThree)와 같다.
// 데모(r128, 구식 조명)의 세기를 지금 three의 물리 단위로 맞추려고 π를 곱한다.
const LEGACY = Math.PI;

export class Stage {
  private R: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(28, 2, .1, 100);
  private table = new THREE.Group();
  private carG = new THREE.Group();
  private blob: THREE.Mesh;
  private contact: THREE.Mesh;
  private M: CarMaterials;
  private target = new THREE.Color();
  private pop = 1;
  private auto = true;
  private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private raf = 0; // 0이면 그리기 멈춤
  private loop: (now: number) => void;
  private ro: ResizeObserver;
  private owned: { dispose(): void }[] = [];
  private canvas: HTMLCanvasElement;
  private host: HTMLElement;

  static supported(): boolean {
    try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
  }

  constructor(canvas: HTMLCanvasElement, host: HTMLElement) {
    this.canvas = canvas; this.host = host;
    const R = this.R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    R.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1;
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFShadowMap;
    const { scene, table, owned } = this;
    const keep = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);

    // 반사용 가상 스튜디오(조명 판 3장 + 바닥)
    const es = new THREE.Scene(); es.background = new THREE.Color(0x8e98a4);
    const board = (w: number, h: number, x: number, y: number, z: number, c: number) => {
      const m = new THREE.Mesh(keep(new THREE.PlaneGeometry(w, h)), keep(new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m);
    };
    board(12, 5, 0, 9, 0, 0xffffff); board(9, 4, -9, 3, 5, 0xffffff); board(9, 4, 9, 3, -5, 0xdfe9ff); board(40, 40, 0, -4, 0, 0x6a7078);
    const pm = keep(new THREE.PMREMGenerator(R));
    scene.environment = keep(pm.fromScene(es, .03).texture);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c2cc, .55 * LEGACY));
    const key = new THREE.DirectionalLight(0xffffff, 1.05 * LEGACY);
    key.position.set(4, 9, 5); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
    key.shadow.bias = -.0004; key.shadow.radius = 3; scene.add(key);
    // 림 라이트: 뒤 위에서 차 윤곽(지붕선·어깨)을 밝혀 바닥과 떨어져 보이게(그림자 없음, 비용 거의 없음)
    const rim = new THREE.DirectionalLight(0xdfe9ff, .55 * LEGACY); rim.position.set(-6, 5, -7); scene.add(rim);

    // 회전 무대
    scene.add(table);
    const disc = new THREE.Mesh(keep(new THREE.CylinderGeometry(3.05, 3.05, .08, 96)), keep(new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: .5, metalness: .05 })));
    disc.position.y = -.04; disc.receiveShadow = true; table.add(disc);
    const ring = new THREE.Mesh(keep(new THREE.RingGeometry(2.86, 2.89, 128)), keep(new THREE.MeshBasicMaterial({ color: 0x14171c })));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .002; table.add(ring);
    const tickMat = [keep(new THREE.MeshBasicMaterial({ color: 0x9aa3ae })), keep(new THREE.MeshBasicMaterial({ color: 0xff5a1f }))];
    const tickGeo = [keep(new THREE.PlaneGeometry(.05, .012)), keep(new THREE.PlaneGeometry(.12, .012))];
    for (let i = 0; i < 48; i++) {
      const t = new THREE.Mesh(tickGeo[i % 4 ? 0 : 1], tickMat[i % 12 ? 0 : 1]), a = i / 48 * Math.PI * 2;
      t.rotation.x = -Math.PI / 2; t.rotation.z = -a; t.position.set(Math.cos(a) * 2.74, .002, Math.sin(a) * 2.74); table.add(t);
    }
    const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(40, 40)), keep(new THREE.ShadowMaterial({ opacity: .16 })));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.08; floor.receiveShadow = true; scene.add(floor);
    // 바닥에 붙는 부드러운 그림자
    const c2 = document.createElement('canvas'); c2.width = c2.height = 128;
    const g = c2.getContext('2d')!, gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    gr.addColorStop(0, 'rgba(10,14,20,.55)'); gr.addColorStop(1, 'rgba(10,14,20,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    this.blob = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), keep(new THREE.MeshBasicMaterial({ map: keep(new THREE.CanvasTexture(c2)), transparent: true, depthWrite: false })));
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = .004; table.add(this.blob);
    // 접촉 그림자: 차 바로 밑의 좁고 진한 그림자(바퀴·차체가 바닥에 닿아 보이게)
    const c3 = document.createElement('canvas'); c3.width = c3.height = 128;
    const g3 = c3.getContext('2d')!, gr3 = g3.createRadialGradient(64, 64, 20, 64, 64, 64);
    gr3.addColorStop(0, 'rgba(6,8,12,.7)'); gr3.addColorStop(.6, 'rgba(6,8,12,.35)'); gr3.addColorStop(1, 'rgba(6,8,12,0)'); g3.fillStyle = gr3; g3.fillRect(0, 0, 128, 128);
    this.contact = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), keep(new THREE.MeshBasicMaterial({ map: keep(new THREE.CanvasTexture(c3)), transparent: true, depthWrite: false })));
    this.contact.rotation.x = -Math.PI / 2; this.contact.position.y = .005; this.blob.parent!.add(this.contact);
    table.add(this.carG);
    this.M = createCarMaterials('#ffffff');

    this.ro = new ResizeObserver(() => this.size()); this.ro.observe(host); this.size();

    // 끌어서 돌리기
    let drag = false, lx = 0, idle = 0;
    table.rotation.y = -.65;
    canvas.onpointerdown = e => { drag = true; lx = e.clientX; canvas.setPointerCapture(e.pointerId); };
    canvas.onpointermove = e => { if (drag) { table.rotation.y += (e.clientX - lx) * .008; lx = e.clientX; idle = 2.5; } };
    canvas.onpointerup = canvas.onpointercancel = () => { drag = false; };
    let last = performance.now();
    const loop = this.loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(.05, Math.max(0, now - last) / 1000); last = now; // 멈췄다 다시 그릴 때 한 번에 튀지 않게 0.05초로 자른다
      if (idle > 0) idle -= dt; else if (!drag && this.auto && !this.still) table.rotation.y += dt * .22;
      this.pop += (1 - this.pop) * Math.min(1, dt * 9);
      const k = .9 + .1 * this.pop; this.carG.scale.set(k, k, k);
      this.M.paint.color.lerp(this.target, Math.min(1, dt * 7));
      R.render(this.scene, this.cam);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private size() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    const cam = this.cam;
    this.R.setSize(w, h, false); cam.aspect = w / h;
    // 0.9.0 무대가 좁고 길어져(화면의 약 40%) 원판 전체 대신 차 길이(약 5m)에 맞춰 당긴다: 차가 폭의 약 85%를 채워 작아 보이지 않게(원판 가장자리는 잘려도 된다)
    const d = Math.max(7.8, 11.6 / cam.aspect);
    cam.position.set(0, d * .22 + .5, d); cam.lookAt(0, .5, 0); cam.updateProjectionMatrix();
  }

  /** 그리기 켜기/끄기: 무대가 안 보일 때(회사·기록 탭, 숨은 문서) 끈다 */
  setActive(on: boolean): void {
    if (on === this.active) return;
    if (on) this.raf = requestAnimationFrame(this.loop); else { cancelAnimationFrame(this.raf); this.raf = 0; }
  }
  get active(): boolean { return this.raf !== 0; }

  /** 차를 치우고 빈 원판만 남긴다 */
  clear(): void {
    while (this.carG.children.length) { const c = this.carG.children.pop()!; disposeCar(c); }
    this.blob.visible = this.contact.visible = false;
  }
  get empty(): boolean { return !this.carG.children.length; }

  setCar(look: CarLook): void {
    const first = !this.carG.children.length;
    this.clear(); this.blob.visible = true;
    this.carG.add(buildCar(look, this.M));
    const b = chassisOf(look);
    this.blob.scale.set(b.L * 1.25, b.W * 1.7, 1); this.contact.scale.set(b.L * 1.02, b.W * 1.08, 1); this.contact.visible = true;
    this.pop = this.still ? 1 : 0;
    this.setColor(look.color);
    if (first) this.M.paint.color.copy(this.target);
  }

  setColor(hex: string): void {
    this.target.set(hex);
    if (this.still) this.M.paint.color.copy(this.target);
  }

  setAutoRotate(on: boolean): void { this.auto = on; }
  /** 무대의 회전(기본 앞 3/4 = −0.65, 0=옆, −π/2=정면, π/2=뒷면)을 정한다. 이후 끌기·자동 회전은 여기서 이어진다 */
  setYaw(rad: number): void { this.table.rotation.y = rad; }

  /** 작은 PNG(data URL): 후보 썸네일·차종 계보 사진. 본 무대의 차·회전·크기를 잠시 바꿨다가 같은 틱 안에 되돌린다.
      yaw: 무대 회전(기본 앞 3/4, 0=옆, −π/2=정면, π/2=뒷면). fit: 보이는 폭(m)을 고정해 여러 차의 실제 크기를 비교할 때 */
  renderThumb(look: CarLook, w: number, h: number, yaw = -.65, fit?: number): string {
    const { R, table, carG, blob } = this, M = createCarMaterials(look.color), car = buildCar(look, M), c = chassisOf(look);
    const { contact } = this, old = { pr: R.getPixelRatio(), size: R.getSize(new THREE.Vector2()), yaw: table.rotation.y, vis: blob.visible, sc: blob.scale.clone(), cv: contact.visible, cs: contact.scale.clone() };
    carG.visible = false; table.add(car); table.rotation.y = yaw;
    blob.visible = true; blob.scale.set(c.L * 1.25, c.W * 1.7, 1); contact.visible = true; contact.scale.set(c.L * 1.02, c.W * 1.08, 1);
    // 보이는 폭(길이·폭을 각도로 섞음)에 맞춰 거리를 정한다: 정면 사진도 차가 작아지지 않게
    const ext = fit ?? Math.max(2.6, Math.abs(Math.cos(yaw)) * c.L + Math.abs(Math.sin(yaw)) * c.W);
    const cam = new THREE.PerspectiveCamera(28, w / h, .1, 100), d = Math.max(ext * 1.4, ext * 2 * h / w) + Math.abs(Math.sin(yaw)) * (c.L - c.W) / 2; // 정면·뒷면이면 가까운 끝까지의 거리를 더한다
    cam.position.set(0, d * .22 + .5, d); cam.lookAt(0, .62, 0);
    let url = '';
    try {
      R.setPixelRatio(1); R.setSize(w, h, false);
      R.render(this.scene, cam);
      url = this.canvas.toDataURL('image/png');
    } finally {
      table.remove(car); disposeCar(car); for (const m of Object.values(M)) m.dispose();
      carG.visible = true; table.rotation.y = old.yaw; blob.visible = old.vis; blob.scale.copy(old.sc); contact.visible = old.cv; contact.scale.copy(old.cs);
      R.setPixelRatio(old.pr); R.setSize(old.size.x, old.size.y, false);
      R.render(this.scene, this.cam); // 화면에 보이기 전에 본 장면으로 다시 그린다
    }
    return url;
  }

  snapshot(): string {
    this.R.render(this.scene, this.cam); // 버퍼가 지워지기 전에 같은 틱에서 읽는다
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const c = this.canvas;
    c.onpointerdown = c.onpointermove = c.onpointerup = c.onpointercancel = null;
    disposeCar(this.carG);
    for (const m of Object.values(this.M)) m.dispose();
    for (const x of this.owned) x.dispose();
    this.R.dispose();
  }
}
