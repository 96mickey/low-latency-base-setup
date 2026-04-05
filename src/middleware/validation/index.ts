import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodSchema } from 'zod';

import { sendStandardError } from '../../lib/httpError.js';

export function makeValidator<T>(schema: ZodSchema<T>) {
  return async function validateBody(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      sendStandardError(
        reply,
        400,
        'VALIDATION_ERROR',
        `Validation failed: ${msg}`,
        request.correlationId,
      );
      return;
    }
    (request as FastifyRequest & { validatedBody: T }).validatedBody = parsed.data;
  };
}
