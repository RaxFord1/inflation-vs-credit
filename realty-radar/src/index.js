// Точка входу. Режими:
//   node src/index.js            — повний: планувальник + веб + телеграм-бот
//   node src/index.js --once     — один прогін збору+оцінки+сповіщень і вихід
//   node src/index.js --web-only — лише веб-UI (перегляд бази)
//   node src/index.js --eval-only— лише оцінка ШІ по вже зібраному
import { loadConfig } from './config.js';
import { getDb } from './db/db.js';
import { startScheduler } from './pipeline/scheduler.js';
import { runCycle } from './pipeline/orchestrator.js';
import { runEvaluation } from './ai/evaluate.js';
import { startWeb } from './web/server.js';
import { startBot, sendText } from './notify/telegram.js';
import { initHttp } from './util/http.js';
import log from './logger.js';

const args = new Set(process.argv.slice(2));

async function main() {
  const cfg = loadConfig();
  getDb();
  initHttp(cfg.politeness);

  if (args.has('--once')) {
    log.info('Режим: одноразовий прогін');
    await runCycle(cfg);
    process.exit(0);
  }

  if (args.has('--eval-only')) {
    log.info('Режим: лише оцінка ШІ');
    await runEvaluation(cfg);
    process.exit(0);
  }

  if (args.has('--web-only')) {
    log.info('Режим: лише веб-UI');
    startWeb(cfg, null);
    return;
  }

  // повний режим
  const scheduler = startScheduler(cfg);
  startWeb(cfg, scheduler.controls);
  startBot(cfg, scheduler.controls);

  if (cfg.notify?.telegram?.enabled && cfg.secrets.telegramToken && cfg.secrets.telegramChatId) {
    sendText(cfg, '🏠 <b>Realty Radar</b> запущено. /help — команди.').catch(() => {});
  }

  process.on('SIGINT', () => { log.info('Зупинка…'); scheduler.stop(); process.exit(0); });
  process.on('SIGTERM', () => { scheduler.stop(); process.exit(0); });
}

main().catch((e) => { log.error(e.stack || e.message); process.exit(1); });
