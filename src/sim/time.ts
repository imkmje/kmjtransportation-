// 두 시계: 시뮬레이션 시간(물리, 초) → 시계 시간(하루 시각)
const DAY = 86400;
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

export interface ClockOpts {
  dayLengthMinutes: number;
  startClockHour: number;
  dayBoundaryHour: number;
}

// 시뮬 1초당 시계가 몇 초 가는지 (기본 하루 60분 → 24)
export function clockRatio(dayLengthMinutes: number): number {
  return DAY / (dayLengthMinutes * 60);
}

export interface ClockTime {
  day: number; // 1일차부터. 경계는 04:00
  weekday: string; // 월~일 (1일차 = 월)
  hour: number;
  minute: number;
  isWeekend: boolean;
}

export function clockAt(simSeconds: number, o: ClockOpts): ClockTime {
  const abs = o.startClockHour * 3600 + simSeconds * clockRatio(o.dayLengthMinutes); // 1일차 00:00부터의 시계 초
  const day = Math.floor((abs - o.dayBoundaryHour * 3600) / DAY) + 1;
  const tod = Math.floor(abs % DAY);
  const wd = (((day - 1) % 7) + 7) % 7;
  return { day, weekday: WEEKDAYS[wd], hour: Math.floor(tod / 3600), minute: Math.floor((tod % 3600) / 60), isWeekend: wd >= 5 };
}
