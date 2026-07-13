// Мінімалістичний логер без залежностей.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const current = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? 2;

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function emit(level, args) {
  if (LEVELS[level] > current) return;
  const tag = level.toUpperCase().padEnd(5);
  const line = `[${ts()}] ${tag}`;
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](line, ...args);
}

export const log = {
  error: (...a) => emit('error', a),
  warn: (...a) => emit('warn', a),
  info: (...a) => emit('info', a),
  debug: (...a) => emit('debug', a),
  child: (scope) => ({
    error: (...a) => emit('error', [`(${scope})`, ...a]),
    warn: (...a) => emit('warn', [`(${scope})`, ...a]),
    info: (...a) => emit('info', [`(${scope})`, ...a]),
    debug: (...a) => emit('debug', [`(${scope})`, ...a]),
  }),
};

export default log;
