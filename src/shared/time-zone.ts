const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = formatters.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, cached);
  }
  return cached;
}

function wallClock(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function offsetMs(instant: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = wallClock(instant, timeZone);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Date.UTC(year, month - 1, day, hour, minute, second) - truncated;
}

function parseDate(date: string): [number, number, number] {
  const [year, month, day] = date.split('-').map(Number);
  return [year, month, day];
}

function formatDate(utcMidnight: Date): string {
  return utcMidnight.toISOString().slice(0, 10);
}

export function zonedTimeToInstant(date: string, minutesOfDay: number, timeZone: string): Date {
  const [year, month, day] = parseDate(date);
  const wall = Date.UTC(year, month - 1, day, 0, minutesOfDay);
  const firstGuess = wall - offsetMs(new Date(wall), timeZone);
  const offset = offsetMs(new Date(firstGuess), timeZone);
  return new Date(wall - offset);
}

export function startOfZonedDay(date: string, timeZone: string): Date {
  return zonedTimeToInstant(date, 0, timeZone);
}

export function toZonedDate(instant: Date, timeZone: string): string {
  const { year, month, day } = wallClock(instant, timeZone);
  return formatDate(new Date(Date.UTC(year, month - 1, day)));
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = parseDate(date);
  return formatDate(new Date(Date.UTC(year, month - 1, day + days)));
}

export function isoWeekday(date: string): number {
  const [year, month, day] = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7;
}
