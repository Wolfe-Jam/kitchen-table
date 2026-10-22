// All household time is America/New_York. Every function takes an explicit `nowMs`
// so the demo clock (state.now_override) can drive date resolution.

const TZ = "America/New_York";
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
});

export interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  wd: number;
}

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export function parts(ms: number): Parts {
  const o: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, wd: WD.indexOf(o.weekday) };
}

/** Local-minus-UTC offset in ms at the given instant (negative for New York). */
export function offsetMs(ms: number): number {
  const p = parts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(ms / 60000) * 60000;
}

/** Epoch ms for a New York wall-clock time. */
export function nyMs(y: number, m: number, d: number, h = 0, mi = 0): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess);
  return guess - offsetMs(first);
}

export function addDays(ymd: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function today(nowMs: number): Ymd {
  const p = parts(nowMs);
  return { y: p.y, m: p.m, d: p.d };
}

/** Next date falling on weekday `wd` (0=Sun..6=Sat). `includeToday` lets today count. */
export function dateOfNext(nowMs: number, wd: number, includeToday: boolean): Ymd {
  const p = parts(nowMs);
  let delta = (wd - p.wd + 7) % 7;
  if (delta === 0 && !includeToday) delta = 7;
  return addDays(today(nowMs), delta);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function isoNY(ms: number): string {
  const p = parts(ms);
  const off = offsetMs(ms) / 3600000;
  const sign = off < 0 ? "-" : "+";
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00${sign}${pad(Math.abs(off))}:00`;
}

export function weekdayName(ms: number): string {
  return WD_FULL[parts(ms).wd];
}

export function weekdayShort(ms: number): string {
  return WD[parts(ms).wd];
}

export function timeLabel(ms: number): string {
  const p = parts(ms);
  const h12 = p.h % 12 === 0 ? 12 : p.h % 12;
  const ampm = p.h < 12 ? "AM" : "PM";
  return p.mi === 0 ? `${h12} ${ampm}` : `${h12}:${pad(p.mi)} ${ampm}`;
}

function dayDiff(ms: number, nowMs: number): number {
  const a = today(ms);
  const b = today(nowMs);
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

/** "today", "tomorrow", or the weekday name ("Sunday"). */
export function dayLabel(ms: number, nowMs: number): string {
  const diff = dayDiff(ms, nowMs);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return weekdayName(ms);
}

export function sameDay(a: number, b: number): boolean {
  return dayDiff(a, b) === 0;
}

export { dayDiff };

const DAY_WORDS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

/** Parse a due phrase to epoch ms, or null when it isn't a date ("for the science fair"). */
export function parseDue(text: string, nowMs: number): number | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?/);
  if (iso) {
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text.trim()) && iso[4]) return Date.parse(text.trim());
    return nyMs(+iso[1], +iso[2], +iso[3], iso[4] ? +iso[4] : 12, iso[5] ? +iso[5] : 0);
  }
  const at = (ymd: Ymd) => nyMs(ymd.y, ymd.m, ymd.d, 12, 0);
  if (/\btoday\b|\btonight\b/.test(s)) return at(today(nowMs));
  if (/\btomorrow\b/.test(s)) return at(addDays(today(nowMs), 1));
  for (const [word, wd] of Object.entries(DAY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(s)) return at(dateOfNext(nowMs, wd, true));
  }
  if (/\bweekend\b/.test(s)) return at(dateOfNext(nowMs, 6, true));
  if (/end of (the )?week/.test(s)) return at(dateOfNext(nowMs, 5, true));
  if (/next week/.test(s)) return at(dateOfNext(nowMs, 1, false));
  return null;
}
