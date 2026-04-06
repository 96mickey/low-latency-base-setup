import type { Config } from '../../types/index.js';

export type NewIpLimiter = {
  checkAndRecord: (ip: string, isReturningIp: boolean) => boolean;
};

/**
 * Caps how many *new* (never-seen) IPs can appear per rolling second.
 * Returning IPs (already in token bucket LRU) bypass via isReturningIp.
 *
 * With `rateLimit` hook order `hasIp → checkAndRecord → consumeToken` (all sync), a given IP
 * is only "new" once per window: after the first allowed pass, `consumeToken` records it and
 * later requests see `isReturningIp === true`. A per-window counter is enough; no Set needed.
 */
export function createNewIpLimiter(config: Config): NewIpLimiter {
  let windowStartSec = Math.floor(Date.now() / 1000);
  let newIpsThisWindow = 0;

  return {
    checkAndRecord(_ip: string, isReturningIp: boolean): boolean {
      if (isReturningIp) {
        return true;
      }
      const sec = Math.floor(Date.now() / 1000);
      if (sec !== windowStartSec) {
        windowStartSec = sec;
        newIpsThisWindow = 0;
      }
      if (newIpsThisWindow >= config.RL_NEW_IP_RATE_MAX) {
        return false;
      }
      newIpsThisWindow += 1;
      return true;
    },
  };
}
