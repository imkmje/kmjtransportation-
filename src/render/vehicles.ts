import * as THREE from 'three';
import { config } from '../config';
import type { Traffic } from '../sim/traffic';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toThreeAbs } from './coords';
import { nightUniform } from './look';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// 모든 차량을 InstancedMesh 세 개(차체·유리 캐빈·헤드라이트)로 한 번에 그린다. 움직이는 차는 푸른 계열, 멈춘 차는 주황 계열(막힘이 한눈에 보이게)
export function createVehicleLayer(scene: THREE.Scene, traffic: Traffic) {
  const car = config.vehicles.car;
  const cap = config.driving.maxVehicles;
  const L = car.length, W = car.width;
  const bodyGeo = new THREE.BoxGeometry(L, 0.9, W).translate(0, 0.65, 0); // 차체(도로 면 위 0.2m에서 시작)
  const cabinGeo = new THREE.BoxGeometry(L, 0.6, W).translate(0, 1.4, 0);
  const lightGeo = mergeGeometries([1, -1].map((sgn) => new THREE.BoxGeometry(0.14, 0.22, 0.3).translate(L / 2 + 0.02, 0.7, sgn * W * 0.32)))!;
  const mesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
  const cabin = new THREE.InstancedMesh(cabinGeo, new THREE.MeshLambertMaterial({ color: 0x27323f }), cap);
  const lights = new THREE.InstancedMesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c0 }), cap);
  for (const m of [mesh, cabin, lights]) { m.frustumCulled = false; m.count = 0; scene.add(m); }
  mesh.castShadow = true; cabin.castShadow = true;
  const dummy = new THREE.Object3D();
  // 사고 표시: 사고 차량 위에 떠서 맥박처럼 커졌다 작아지는 빨간 원뿔(최대 40개)
  const mark = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 5, 4), new THREE.MeshBasicMaterial({ color: 0xff3b30 }), 40);
  mark.frustumCulled = false; mark.count = 0; scene.add(mark);
  let pulse = 0;
  const MOVING = [0x3d7be0, 0x2f9bd6, 0x4a64c9, 0x5b8fd6, 0x37a39a, 0x6a7fd0].map((c) => new THREE.Color(c)); // 움직이는 차: 푸른 계열 6색
  const STOPPED = [0xe8893c, 0xf0a030, 0xe0663c, 0xd9752f].map((c) => new THREE.Color(c)); // 멈춘 차: 주황 계열
  const crashedColor = new THREE.Color(0xd62828); // 사고로 멈춘 차량
  const tMoving = new THREE.Color(0x8a5a3c), tStopped = new THREE.Color(0xc0392b); // 트럭은 갈색(멈추면 붉은 갈색)

  return {
    /** alpha: 이전 tick과 현재 tick 사이 어디쯤인지(0~1). 움직임을 부드럽게 보이게 한다 */
    update(alpha: number) {
      let i = 0;
      for (const v of traffic.vehicles.values()) {
        if (i >= cap) break;
        const p = toThreeAbs(v.px + (v.x - v.px) * alpha, v.py + (v.y - v.py) * alpha, traffic.vehicleZ(v) + 0.2);
        const yaw = v.ph + wrap(v.h - v.ph) * alpha, truck = v.meta?.mode === 'truck';
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.set(truck ? v.length / car.length : 1, truck ? 1.5 : 1, truck ? config.demand.freight.width / car.width : 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        lights.setMatrixAt(i, dummy.matrix);
        // 캐빈(유리): 승용차는 차체 가운데 약간 뒤, 트럭은 맨 앞(짐칸이 뒤쪽)
        dummy.scale.set(truck ? 2.2 / car.length : 0.52, truck ? 1.25 : 1, truck ? config.demand.freight.width / car.width * 0.9 : 0.84);
        dummy.translateX(truck ? v.length / 2 - 1.3 : -0.05 * L);
        if (truck) dummy.position.y -= 0.35; // 트럭은 차체가 높아서 캐빈을 낮춰 앞머리에 붙인다
        dummy.updateMatrix();
        cabin.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, traffic.crashed.has(v.id) ? crashedColor : truck ? (v.v < 0.3 ? tStopped : tMoving) : v.v < 0.3 ? STOPPED[v.id % STOPPED.length] : MOVING[v.id % MOVING.length]);
        i++;
      }
      cabin.count = lights.count = i;
      lights.visible = nightUniform.value > 0.15; // 밤에만 헤드라이트
      cabin.instanceMatrix.needsUpdate = true; lights.instanceMatrix.needsUpdate = true;
      mesh.count = i;
      pulse += 0.12;
      let mi = 0;
      for (const id of traffic.crashed.keys()) {
        const v = traffic.vehicles.get(id);
        if (!v || mi >= 40) continue;
        const p = toThreeAbs(v.x, v.y, traffic.vehicleZ(v) + 8 + Math.sin(pulse) * 1.2), k = 1 + 0.25 * Math.sin(pulse * 2);
        dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(Math.PI, 0, 0); dummy.scale.set(k, k, k); dummy.updateMatrix();
        mark.setMatrixAt(mi++, dummy.matrix);
      }
      mark.count = mi;
      mark.instanceMatrix.needsUpdate = true;
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
  };
}
