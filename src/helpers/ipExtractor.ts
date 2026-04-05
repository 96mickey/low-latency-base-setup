/**
 * Extract client IP from X-Forwarded-For with trusted proxy depth.
 */

export function extractClientIp(
  xff: string | undefined,
  requestIp: string,
  depth: number,
): string {
  if (xff === undefined || xff.trim().length === 0) {
    return requestIp;
  }
  const parts = xff.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) {
    return requestIp;
  }
  const idx = parts.length - 1 - depth;
  if (idx < 0 || idx >= parts.length) {
    return requestIp;
  }
  return parts[idx] ?? requestIp;
}
