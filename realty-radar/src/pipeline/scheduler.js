// Планувальник із людиноподібним розкидом (jitter) + керування паузою.
import cron from 'node-cron';
import { runCycle } from './orchestrator.js';
import log from '../logger.js';

export function startScheduler(cfg) {
  const state = { paused: false, running: false };

  const runGuarded = async (reason) => {
    if (state.paused) { log.info('Планувальник на паузі — пропускаю'); return; }
    if (state.running) { log.warn('Попередній цикл ще працює — пропускаю'); return; }
    state.running = true;
    try {
      const jitter = Math.floor(Math.random() * (cfg.schedule?.jitterMaxSec ?? 240) * 1000);
      if (reason === 'cron' && jitter > 0) {
        log.info(`Розкид перед збором: ${Math.round(jitter / 1000)}s`);
        await new Promise((r) => setTimeout(r, jitter));
      }
      await runCycle(cfg);
    } finally {
      state.running = false;
    }
  };

  const expr = cfg.schedule?.collectCron || '*/30 * * * *';
  const tz = cfg.schedule?.timezone || 'Europe/Kiev';
  if (!cron.validate(expr)) { log.error(`Невірний cron: ${expr}`); return { state }; }

  const task = cron.schedule(expr, () => runGuarded('cron'), { timezone: tz });
  log.info(`Планувальник запущено: "${expr}" (${tz})`);

  // перший прогін одразу (з невеликою затримкою)
  setTimeout(() => runGuarded('startup'), 3000);

  return {
    state,
    controls: {
      pause: () => { state.paused = true; },
      resume: () => { state.paused = false; },
      isPaused: () => state.paused,
      runNow: () => runGuarded('manual'),
    },
    stop: () => task.stop(),
  };
}
