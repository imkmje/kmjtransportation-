// 모든 튜닝 수치는 여기에. (rules.md의 수치는 초기 후보값)
export const config = {
  tickRate: 20, // tick/초 (고정 타임스텝)
  maxTicksPerFrame: 10, // 프레임당 처리 tick 상한
  speedSteps: [0, 1, 2, 4] as const, // 일시정지/1×/2×/4×
  dayLengthMinutes: 60, // 1× 기준 하루 길이(설정: 30/60/120)
  startClockHour: 5, // 1일차 월요일 05:00 시작
  dayBoundaryHour: 4, // 하루 경계 = 시계 04:00
  seed: 12345,
  speedChoicesKmh: [30, 40, 50, 60, 80, 100, 110], // 속도 제한 도구가 고를 수 있는 값(도로 종류의 상한 이하만)
  // 도로 종류 (rules.md 7항). 속도 단위 km/h, 폭 단위 m
  roads: {
    road2: { name: '왕복 2차로', lanesPerDir: 1, laneWidth: 3.5, defaultSpeedKmh: 50, maxSpeedKmh: 60, rank: 1 },
    road4: { name: '왕복 4차로', lanesPerDir: 2, laneWidth: 3.5, defaultSpeedKmh: 60, maxSpeedKmh: 80, rank: 2 }, // rank: 교차로 우선순위(큰 쪽이 먼저)
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
    arrivalTol: 1.0, // 도착 판정 거리(m)
    arrivalRadius: 8, // 목적지 이 거리 안에서 arrivalSpeed 이하로 줄었으면 도착(건물 진입로로 꺾어 들어간 것으로 보고, 길 위에서 완전히 서지 않는다)
    arrivalSpeed: 6.5, // m/s
    minGap: 0.5, // 안전망: 이보다 가까워지면 강제로 막는다(m)
    spawnIntervalSec: 1.5, // 연속 투입 간격(시뮬 초)
    spawnTimeoutSec: 300, // 출발 대기 한도(시뮬 초)
    spawnClear: 12, // 투입 위치 앞뒤로 비어 있어야 하는 거리(m)
    maxVehicles: 5000,
  },
  // 교차로 (rules.md 9항 + 제안값)
  intersection: {
    zone: 30, // 정지선 앞 이 거리(+제동거리) 안에 들어오면 통과 요청
    stopSec: 1.0, // 정지 표지: 완전 정지 후 대기
    stopLineTol: 1.2, // 정지선에서 이 거리 안이면 "정지선에 있다"
    stopLineS0: 0.3, // 정지선 앞 목표 간격(m)
    yieldKmh: 20, // 양보 표지: 정지선에서의 속도
    simultaneousSec: 1.0, // 이 시간 안에 도착하면 동시 도착으로 보고 좌회전이 양보
    straightDeg: 35, // 이 각도 안의 방향 전환은 직진
  },
  // 차선 변경 (rules.md 10항 MOBIL 단순화)
  laneChange: { politeness: 0.2, threshold: 0.2, rightBias: 0.1, safeDecel: 4.0, cooldownSec: 5, durationSec: 2, noChangeNearLine: 30, noChangeAfterEntry: 10, evalTicks: 10 }, // noChangeAfterEntry: 차선에 들어선 뒤 차 길이 + 이 거리(m)까지는 변경 금지(연결선에서 들어오는 차량을 아직 볼 수 없다)
  // 교착 (rules.md 6항)
  deadlock: { detectSec: 5, persistSec: 300, stage2Sec: 30 },
  // 건물 (rules.md 8항 + 제안값). footprint: 건물 한 변의 절반(m)
  buildings: {
    footprint: { small: 4, medium: 7, large: 11 },
    capacity: { small: 10, medium: 30, large: 100 }, // 주거는 거주 인원, 직장은 일자리 수
    height: { home: { small: 3, medium: 5, large: 9 }, office: { small: 6, medium: 12, large: 22 } }, // 화면 표시용
    connectRadius: 50, // 가장 가까운 도로 구간에 자동 연결되는 반경(m)
    gap: 2, // 건물 사이 최소 간격(m)
    worldHalf: 1000,
  },
  // 신호등(1.2.0): 초 단위(시뮬 시간). 녹색·황색·전적색. 기본 프로그램은 자동 생성
  signals: { greenSec: 15, yellowSec: 3, allRedSec: 1, minGreenSec: 7, maxGreenSec: 45, gapSec: 2.5, detectM: 30, greenChoices: [10, 15, 20, 30, 45] }, // 감응식: 감지 구간 detectM, 최소 녹색, 차가 없는 시간이 gapSec를 넘으면 전환, 최대 녹색
  // 구역(심시티식): 칸 하나 = 20m. 도로에서 이 거리(중심선 기준) 안의 칸만 칠할 수 있다
  zones: { cell: 20, maxDist: 45, maxRect: 60 },
  // 외부 연결: 지도 가장자리에서 들어오는 시작 도로. 직장인 수의 share만큼 외부 사람이 들어와 일하고(남은 일자리 안에서), 시민의 outShare는 외부로 출근한다
  external: { x: 0, y: -1000, roadEndY: -400, share: 0.15, outShare: 0.1 },
  // 건물 성장: stepSec(시뮬 초)마다 수요 막대만큼 자란다. base: 도시가 작을 때의 기본 수요(이주·사업 의욕)
  growth: { stepSec: 20, base: 25, scaleBase: 60, scaleDiv: 0.25, trafficPenalty: 0.5, trafficFull: 60, maxAccum: 3, sizeWeights: { small: 0.4, medium: 0.45, large: 0.15 } },
  // 수요 (rules.md 8항). 시간대는 시계 시각, 가중치 피크 = 100
  demand: {
    workerShare: 0.6, // 거주 인원 중 직장인 비율(1.0.0은 직장인의 출근·퇴근만)
    commuteWeights: [[6, 7, 30], [7, 8, 100], [8, 9, 60], [9, 10, 10]] as [number, number, number][],
    returnWeights: [[17, 18, 70], [18, 19, 100], [19, 20, 40], [20, 21, 10]] as [number, number, number][],
    lateStaySec: 3600, // 귀환 시간대가 끝난 뒤 도착한 인원은 시계 1시간 체류 후 귀환
    lambdaDiv: 4, // λ = 맵 대각선 ÷ 이 값
    worldSize: 2000,
  },
  // 통계 (rules.md 1항)
  metrics: { bucketSec: 10, windowSec: 150, minPasses: 5 }, // CI 롤링 윈도우 = 시뮬 2.5분. minPasses: 도로 한 곳의 통과 차량이 이보다 적으면 판정 없음(회색)
  // 기하 제약 (rules.md 7항)
  geometry: { minSegmentLength: 20, mergeRadius: 8, minAngleDeg: 30, maxRoadsPerNode: 6 },
  // 건설 도구 (제안값)
  editor: { gridSnap: 20, angleSnapDeg: 15, lengthSnap: 10, historyLimit: 200 },
};
export type Config = typeof config;
