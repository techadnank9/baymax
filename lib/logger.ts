type Level = 'info' | 'warn' | 'error';

function emit(level: Level, scope: string, message: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${scope}] ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (data !== undefined) {
    fn(line, data);
  } else {
    fn(line);
  }
}

export function createLogger(scope: string) {
  return {
    info: (message: string, data?: unknown) => emit('info', scope, message, data),
    warn: (message: string, data?: unknown) => emit('warn', scope, message, data),
    error: (message: string, data?: unknown) => emit('error', scope, message, data),
  };
}
