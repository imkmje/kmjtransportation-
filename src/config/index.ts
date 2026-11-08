// 모든 튜닝 수치는 여기에. (rules.md의 수치는 초기 후보값)
export const config = {
  tickRate: 20, // tick/초 (고정 타임스텝)
  maxTicksPerFrame: 10, // 프레임당 처리 tick 상한
  speedSteps: [0, 1, 2, 4] as const, // 일시정지/1×/2×/4×
  dayLengthMinutes: 60, // 1× 기준 하루 길이(설정: 30/60/120)
  startClockHour: 5, // 1일차 월요일 05:00 시작
  dayBoundaryHour: 4, // 하루 경계 = 시계 04:00
  seed: 12345,
  // 도로 종류 (rules.md 7항). 속도 단위 km/h, 폭 단위 m
  roads: {
    road2: { name: '왕복 2차로', lanesPerDir: 1, laneWidth: 3.5, defaultSpeedKmh: 50, maxSpeedKmh: 60 },
    road4: { name: '왕복 4차로', lanesPerDir: 2, laneWidth: 3.5, defaultSpeedKmh: 60, maxSpeedKmh: 80 },
  },
  // 차종 (rules.md 10항). 단위: m, m/s², s, km/h
  vehicles: { car: { length: 4.5, width: 1.8, a: 1.5, b: 2.0, T: 1.5, s0: 2.0, vmaxKmh: 120 } },
  // 주행 (3단계 임시 단순화 포함. rules.md 10항 값 + 제안값)
  driving: {
    brakeMax: 6, // 최대 제동(m/s²). 계획용 편안한 감속 b와 별개
    lookahead: 100, // 앞을 내다보는 거리(m)
    uturnWaitSec: 1.0, // 막다른 끝 회차 전 정지 시간(시뮬 초)
    curveLatAccel: 2.0, // 곡선 횡가속 한계(m/s²)
    minTurnKmh: 15, // 교차로 안 최저 속도
    arrivalTol: 0.3, // 도착 판정 거리(m)
    minGap: 0.5, // 안전망: 이보다 가까워지면 강제로 막는다(m)
    spawnIntervalSec: 1.5, // 연속 투입 간격(시뮬 초)
    spawnTimeoutSec: 300, // 출발 대기 한도(시뮬 초)
    spawnClear: 12, // 투입 위치 앞뒤로 비어 있어야 하는 거리(m)
    maxVehicles: 5000,
  },
  // 기하 제약 (rules.md 7항)
  geometry: { minSegmentLength: 20, mergeRadius: 8, minAngleDeg: 30, maxRoadsPerNode: 6 },
  // 건설 도구 (제안값)
  editor: { gridSnap: 20, angleSnapDeg: 15, lengthSnap: 10, historyLimit: 200 },
};
export type Config = typeof config;
