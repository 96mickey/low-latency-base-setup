import type { FastifyReply } from 'fastify';

import type { StandardErrorResponse } from '../types/index.js';

export function sendStandardError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  correlationId: string,
): void {
  const body: StandardErrorResponse = {
    error: {
      code,
      message,
      statusCode,
      correlationId,
    },
  };
  reply.status(statusCode).send(body);
}
