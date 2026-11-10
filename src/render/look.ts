import * as THREE from 'three';

/**
 * 화면의 "분위기"(조명·하늘·밤)를 한곳에서 정한다. 시뮬레이션 상태는 읽기만 하고 바꾸지 않는다.
 * hour(시계 시각, 0~24)와 비 여부로 햇빛 방향·색·세기, 하늘 색, 밤 정도(0 낮 ~ 1 한밤)를 계산한다.
 */
export const nightUniform = { value: 0 }; // 건물 창문·헤드라이트 셰이더가 같이 쓴다

const C = (hex: number) => new THREE.Color(hex);
const DAY = { top: C(0x5fa8e6), horizon: C(0xdcedf9), sun: C(0xfff3dc), hemiSky: C(0xffffff), hemiGround: C(0x9bb58a) };
const DUSK = { top: C(0x5a6fb0), horizon: C(0xf4b58a), sun: C(0xffb877), hemiSky: C(0xffd9b8), hemiGround: C(0x8a7f78) };
const NIGHT = { top: C(0x0a1230), horizon: C(0x27376a), sun: C(0xaab8e0), hemiSky: C(0x7a86b8), hemiGround: C(0x2f3858) };
const RAIN = { top: C(0x7a8794), horizon: C(0xaab4bd) };

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Look {
  sky: THREE.Mesh;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fog: THREE.Fog;
  /** 매 프레임: 시각·비·카메라 위치로 조명과 하늘을 갱신 */
  update(hour: number, rain: boolean, camera: THREE.Camera): void;
  night(): number;
}

export function createLook(scene: THREE.Scene): Look {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: DAY.top.clone() }, horizon: { value: DAY.horizon.clone() } },
    vertexShader: 'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying float vY; void main(){ float t = pow(clamp(vY, 0.0, 1.0), 0.55); gl_FragColor = vec4(mix(horizon, top, t), 1.0); }',
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 24, 12), skyMat);
  sky.frustumCulled = false; sky.renderOrder = -10;
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9bb58a, 1.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  scene.add(sun, sun.target);
  const fog = new THREE.Fog(0xdcedf9, 1500, 4200);
  scene.fog = fog;
  scene.background = new THREE.Color(0xdcedf9);
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  let night = 0;

  const mix = (k: 'top' | 'horizon' | 'sun' | 'hemiSky' | 'hemiGround', out: THREE.Color, dusk: number, nt: number) => {
    out.copy(DAY[k]).lerp(DUSK[k], dusk).lerp(NIGHT[k], nt);
  };

  return {
    sky, hemi, sun, fog,
    night: () => night,
    update(hour, rain, camera) {
      // 해: 4시 반 뜨고 18시 반 진다. elev = 고도(sin), 새벽·해질녘(고도가 낮을 때)은 노을색
      const ang = ((hour - 4.5) / 14) * Math.PI, elev = Math.sin(ang); // 4시 반에 동이 트고 18시 반에 진다(게임이 5시에 시작하므로 첫 화면이 어둡지 않게)
      const nt = 1 - smooth(-0.12, 0.2, elev), dusk = (1 - nt) * (1 - smooth(0.05, 0.5, Math.abs(elev)));
      night = nt;
      nightUniform.value = nt;
      const dayLight = 1 - nt;
      // 빛이 오는 방향: 낮에는 해(동 → 서로 지남), 밤에는 달이 비스듬히 위에서
      const az = ang, dir = new THREE.Vector3(Math.cos(az) * 0.8, Math.max(0.28, elev), 0.55).normalize();
      if (nt > 0.5) dir.set(-0.4, 0.8, 0.45).normalize();
      sun.userData.dir = dir;
      mix('sun', sun.color, dusk, nt);
      sun.intensity = (rain ? 0.7 : 2.2) * dayLight + 0.95 * nt;
      mix('hemiSky', hemi.color, dusk, nt); mix('hemiGround', hemi.groundColor, dusk, nt);
      hemi.intensity = (rain ? 1.1 : 1.5) * dayLight + 1.35 * nt;
      mix('top', tmpA, dusk, nt); mix('horizon', tmpB, dusk, nt);
      if (rain) { tmpA.lerp(RAIN.top, 0.8 * dayLight); tmpB.lerp(RAIN.horizon, 0.8 * dayLight); }
      (skyMat.uniforms.top.value as THREE.Color).copy(tmpA);
      (skyMat.uniforms.horizon.value as THREE.Color).copy(tmpB);
      (scene.background as THREE.Color).copy(tmpB);
      fog.color.copy(tmpB);
      sky.position.copy(camera.position);
    },
  };
}

/**
 * 건물 벽에 창문을 그리는 셰이더 조각(텍스처 없이 월드 좌표로 계산하므로 건물 크기가 달라도 창 크기가 같다).
 * 밤에는 일부 창이 노란 불빛으로 빛난다. 옆면(수직 면)에만 적용되고 지붕·바닥에는 적용되지 않는다
 */
export function addWindows(mat: THREE.MeshLambertMaterial, o: { glass?: number; spacing?: number; floor?: number } = {}): THREE.MeshLambertMaterial {
  const glass = new THREE.Color(o.glass ?? 0x32414f);
  const spacing = o.spacing ?? 3.6, floor = o.floor ?? 3.4;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = nightUniform;
    sh.uniforms.uGlass = { value: glass };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n mat4 wm = modelMatrix * instanceMatrix;\n#else\n mat4 wm = modelMatrix;\n#endif\n vWP = (wm * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(wm) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uNight; uniform vec3 uGlass;\nfloat hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
 float winMask = 0.0; float winLit = 0.0;
 if (abs(vWN.y) < 0.5 && vWP.y > 1.6) {
   float along = abs(vWN.x) > abs(vWN.z) ? vWP.z : vWP.x;
   vec2 cell = vec2(floor(along / ${spacing.toFixed(2)}), floor(vWP.y / ${floor.toFixed(2)}));
   vec2 f = vec2(fract(along / ${spacing.toFixed(2)}), fract(vWP.y / ${floor.toFixed(2)}));
   winMask = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.78);
   winLit = step(0.55, hash21(cell + floor(vWP.xz * 0.05)));
   diffuseColor.rgb = mix(diffuseColor.rgb, uGlass, winMask * 0.85);
 }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * winMask * winLit * uNight * 1.5;');
  };
  mat.customProgramCacheKey = () => `win-${spacing}-${floor}`;
  return mat;
}
