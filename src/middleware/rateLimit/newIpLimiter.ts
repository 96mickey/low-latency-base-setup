import type { Config } from '../../types/index.js';

export type NewIpLimiter = {
  checkAndRecord: (ip: string, isReturningIp: boolean) => boolean;
};

/**
 * Caps how many *new* (never-seen) IPs can appear per rolling second.
 * Returning IPs (already in token bucket LRU) bypass via isReturningIp.
 */
export function createNewIpLimiter(config: Config): NewIpLimiter {
  let windowStartSec = Math.floor(Date.now() / 1000);
  let newIpsThisWindow = 0;
  const seenNew = new Set<string>();

  return {
    checkAndRecord(ip: string, isReturningIp: boolean): boolean {
      if (isReturningIp) {
        return true;
      }
      const sec = Math.floor(Date.now() / 1000);
      if (sec !== windowStartSec) {
        windowStartSec = sec;
        newIpsThisWindow = 0;
        seenNew.clear();
      }
      if (seenNew.has(ip)) {
        return true;
      }
      if (newIpsThisWindow >= config.RL_NEW_IP_RATE_MAX) {
        return false;
      }
      seenNew.add(ip);
      newIpsThisWindow += 1;
      return true;
    },
  };
}
