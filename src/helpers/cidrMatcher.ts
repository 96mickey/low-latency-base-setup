/**
 * IPv4-only CIDR membership using bitwise operations (no eval, no regex on IP).
 * IPv6 input returns false — documented limitation for v1.
 */

function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (let i = 0; i < 4; i += 1) {
    const oct = Number(parts[i]);
    if (!Number.isInteger(oct) || oct < 0 || oct > 255) return null;
    n = (n << 8) | oct;
  }
  return n >>> 0;
}

function parseCidrRule(cidr: string): { network: number; mask: number } | null {
  const trimmed = cidr.trim();
  const slash = trimmed.indexOf('/');
  if (slash === -1) {
    const ip = parseIpv4ToUint32(trimmed);
    if (ip === null) return null;
    return { network: ip, mask: 0xffffffff };
  }
  const ipPart = trimmed.slice(0, slash);
  const prefix = Number(trimmed.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const ip = parseIpv4ToUint32(ipPart);
  if (ip === null) return null;
  if (prefix === 0) {
    return { network: 0, mask: 0 };
  }
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  return { network, mask };
}

export function compileCidrs(list: string[]): (ip: string) => boolean {
  const rules: Array<{ network: number; mask: number }> = [];
  for (const raw of list) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const rule = parseCidrRule(part);
    if (rule !== null) {
      rules.push(rule);
    }
  }

  return (ip: string): boolean => {
    const addr = parseIpv4ToUint32(ip);
    if (addr === null) return false;
    for (const { network, mask } of rules) {
      if (((addr & mask) >>> 0) === (network >>> 0)) {
        return true;
      }
    }
    return false;
  };
}
