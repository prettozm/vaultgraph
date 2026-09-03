// Display formatting. Deterministic: all dates are rendered in UTC so that the
// same graph reads identically for every viewer (and in tests).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Format an ISO-8601 timestamp as "02 Sep 2026 22:00 UTC".
 * @param {string|null|undefined|Date} value
 * @param {{empty?:string, invalid?:string}} [labels]
 */
export function formatDate(value, labels = {}) {
  const empty = labels.empty ?? 'not generated yet';
  const invalid = labels.invalid ?? 'unknown date';
  if (value === null || value === undefined || value === '') return empty;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return invalid;
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Short commit sha (7 chars) or a placeholder. */
export function shortSha(sha, fallback = 'unknown') {
  if (typeof sha !== 'string') return fallback;
  const s = sha.trim();
  if (!s) return fallback;
  return /^[0-9a-f]{7,40}$/i.test(s) ? s.slice(0, 7) : s.slice(0, 12);
}

/** Human-readable source location, e.g. "docs/a.md:14-22" or "docs/a.md". */
export function formatSourceRef(source) {
  if (!source || typeof source !== 'object' || !source.file) return '';
  const start = Number.isFinite(source.line_start) ? source.line_start : null;
  const end = Number.isFinite(source.line_end) ? source.line_end : null;
  if (start != null && end != null && end !== start) return `${source.file}:${start}-${end}`;
  if (start != null) return `${source.file}:${start}`;
  return String(source.file);
}

/** Thin-space grouped integer, e.g. 1234 -> "1 234". */
export function formatCount(n) {
  if (!Number.isFinite(n)) return '—';
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f'); // U+202F narrow no-break space (fr typography)
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Relative freshness, e.g. "12 min ago" (CDC §8). Deterministic: the caller
 * supplies `now`, so the same pair always renders the same string.
 * @param {string|Date|null|undefined} value
 * @param {number|Date} [now]
 * @param {{empty?:string, invalid?:string}} [labels]
 */
export function formatRelative(value, now = Date.now(), labels = {}) {
  const empty = labels.empty ?? 'not generated yet';
  const invalid = labels.invalid ?? 'unknown date';
  if (value === null || value === undefined || value === '') return empty;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return invalid;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return invalid;
  const delta = nowMs - d.getTime();
  const future = delta < 0;
  const abs = Math.abs(delta);
  const say = (text) => (future ? `in ${text}` : `${text} ago`);
  if (abs < 45_000) return 'just now';
  if (abs < HOUR) return say(`${Math.round(abs / MINUTE)} min`);
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return say(`${h} hour${h === 1 ? '' : 's'}`);
  }
  if (abs < 30 * DAY) {
    const days = Math.round(abs / DAY);
    return say(`${days} day${days === 1 ? '' : 's'}`);
  }
  if (abs < 365 * DAY) {
    const months = Math.round(abs / (30 * DAY));
    return say(`${months} month${months === 1 ? '' : 's'}`);
  }
  const years = Math.round(abs / (365 * DAY));
  return say(`${years} year${years === 1 ? '' : 's'}`);
}
