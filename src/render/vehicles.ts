import * as THREE from 'three';
import { config } from '../config';
import type { Traffic } from '../sim/traffic';
import { toThree } from './coords';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// 모든 차량을 상자 하나(InstancedMesh)로 한 번에 그린다. 움직이는 차는 파랑, 멈춘 차는 주황
export function createVehicleLayer(scene: THREE.Scene, traffic: Traffic) {
  const car = config.vehicles.car;
  const cap = config.driving.maxVehicles;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(car.length, 1.5, car.width), new THREE.MeshLambertMaterial({ color: 0xffffff }), cap);
  mesh.frustumCulled = false; // 인스턴스 위치가 원래 도형 밖이라 자동 가림 계산을 끈다
  mesh.count = 0;
  scene.add(mesh);
  const dummy = new THREE.Object3D();
  // 사고 표시: 사고 차량 위에 떠서 맥박처럼 커졌다 작아지는 빨간 원뿔(최대 40개)
  const mark = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 5, 4), new THREE.MeshBasicMaterial({ color: 0xff3b30 }), 40);
  mark.frustumCulled = false; mark.count = 0; scene.add(mark);
  let pulse = 0;
  const moving = new THREE.Color(0x3d7be0), stopped = new THREE.Color(0xe8893c);
  const crashedColor = new THREE.Color(0xd62828); // 사고로 멈춘 차량
  const tMoving = new THREE.Color(0x8a5a3c), tStopped = new THREE.Color(0xc0392b); // 트럭은 갈색(멈추면 붉은 갈색)

  return {
    /** alpha: 이전 tick과 현재 tick 사이 어디쯤인지(0~1). 움직임을 부드럽게 보이게 한다 */
    update(alpha: number) {
      let i = 0;
      for (const v of traffic.vehicles.values()) {
        if (i >= cap) break;
        const p = toThree(v.px + (v.x - v.px) * alpha, v.py + (v.y - v.py) * alpha, 0.2 + 0.75);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.y = v.ph + wrap(v.h - v.ph) * alpha;
        const truck = v.meta?.mode === 'truck';
        dummy.scale.set(truck ? v.length / car.length : 1, truck ? 1.5 : 1, truck ? config.demand.freight.width / car.width : 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, traffic.crashed.has(v.id) ? crashedColor : truck ? (v.v < 0.3 ? tStopped : tMoving) : v.v < 0.3 ? stopped : moving);
        i++;
      }
      mesh.count = i;
      pulse += 0.12;
      let mi = 0;
      for (const id of traffic.crashed.keys()) {
        const v = traffic.vehicles.get(id);
        if (!v || mi >= 40) continue;
        const p = toThree(v.x, v.y, 8 + Math.sin(pulse) * 1.2), k = 1 + 0.25 * Math.sin(pulse * 2);
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
