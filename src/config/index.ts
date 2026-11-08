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
  // 기하 제약 (rules.md 7항)
  geometry: { minSegmentLength: 20, mergeRadius: 8, minAngleDeg: 30, maxRoadsPerNode: 6 },
  // 건설 도구 (제안값)
  editor: { gridSnap: 20, angleSnapDeg: 15, lengthSnap: 10, historyLimit: 200 },
};
export type Config = typeof config;
