import type { LoggerOptions } from 'pino';

import type { Config } from '../../types/index.js';

export function buildLogger(config: Config): LoggerOptions {
  const base: LoggerOptions = {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'password',
        'token',
        'secret',
        'authorization',
        'cookie',
        '*.password',
        '*.token',
        '*.secret',
        '*.authorization',
        '*.cookie',
      ],
      censor: '[Redacted]',
    },
  };

  if (config.NODE_ENV === 'development') {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    };
  }

  return base;
}
