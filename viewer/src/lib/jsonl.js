// Tolerant JSON Lines parsing. Pure function, never throws on bad input.

/**
 * Parse JSONL text.
 * Tolerates: blank lines, whitespace-only lines, trailing newline, CRLF,
 * a leading BOM, and `//` comment lines. Malformed lines are reported
 * instead of aborting the parse.
 * @returns {{records: object[], errors: {line:number, message:string, text:string}[]}}
 */
export function parseJsonl(text) {
  const records = [];
  const errors = [];
  if (typeof text !== 'string' || text.length === 0) return { records, errors };

  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r\n|\n|\r/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//')) continue;
    let value;
    try {
      value = JSON.parse(line);
    } catch (err) {
      errors.push({ line: i + 1, message: err.message, text: line.slice(0, 200) });
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ line: i + 1, message: 'record is not a JSON object', text: line.slice(0, 200) });
      continue;
    }
    records.push(value);
  }
  return { records, errors };
}
