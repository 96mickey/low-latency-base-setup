/** v4 UUID wrapper — used for correlation ids when the client omits or sends an invalid header. */

import { randomUUID } from 'node:crypto';

export function generateUuid(): string {
  return randomUUID();
}
