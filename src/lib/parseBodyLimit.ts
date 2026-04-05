/**
 * Parse Fastify-style size strings (`100kb`, `1mb`, …) to a byte count for `bodyLimit`.
 * Unparseable input falls back to 100 KiB so the server still starts with a safe default.
 */
export function parseBodyLimitBytes(raw: string): number {
  const s = raw.trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/.exec(s);
  if (!m) {
    return 100 * 1024;
  }
  const n = Number(m[1]);
  const unit = m[2] ?? 'b';
  let mult = 1;
  if (unit === 'kb') mult = 1024;
  else if (unit === 'mb') mult = 1024 ** 2;
  else if (unit === 'gb') mult = 1024 ** 3;
  return Math.floor(n * mult);
}
