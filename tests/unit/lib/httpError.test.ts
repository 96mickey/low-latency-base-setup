import {
  describe, it, expect, vi,
} from 'vitest';
import type { FastifyReply } from 'fastify';

import { sendStandardError } from '../../../src/lib/httpError.js';

describe('sendStandardError', () => {
  it('sends structured body with status', () => {
    const status = vi.fn().mockReturnThis();
    const send = vi.fn();
    const reply = { status, send } as unknown as FastifyReply;

    sendStandardError(reply, 400, 'BAD', 'msg', 'cid-1');

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith({
      error: {
        code: 'BAD',
        message: 'msg',
        statusCode: 400,
        correlationId: 'cid-1',
      },
    });
  });
});
