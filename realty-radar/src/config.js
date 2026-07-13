// Завантаження та валідація конфігу + .env (без зовнішніх залежностей).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import log from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

// --- крихітний парсер .env ---
function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (over && typeof over === 'object' && base && typeof base === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

export function loadConfig() {
  loadDotEnv();
  const examplePath = path.join(ROOT, 'config', 'config.example.json');
  const userPath = path.join(ROOT, 'config', 'config.json');

  const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  let user = {};
  if (fs.existsSync(userPath)) {
    user = JSON.parse(fs.readFileSync(userPath, 'utf8'));
  } else {
    log.warn('config/config.json не знайдено — використовую config.example.json. Створи свій конфіг для реальних міст/фільтрів.');
  }
  const cfg = deepMerge(example, user);

  // секрети з env
  cfg.secrets = {
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiBase: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    domriaKey: process.env.DOMRIA_API_KEY || '',
    telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
    httpProxy: process.env.HTTP_PROXY || '',
  };

  validate(cfg);
  return cfg;
}

function validate(cfg) {
  const problems = [];
  if (cfg.ai?.enabled && !cfg.secrets.openaiKey) problems.push('ai.enabled=true, але OPENAI_API_KEY порожній — оцінка ШІ буде пропущена.');
  if (cfg.sources?.domria?.enabled && !cfg.secrets.domriaKey) problems.push('domria.enabled=true, але DOMRIA_API_KEY порожній — джерело DOM.RIA буде пропущено.');
  if (cfg.notify?.telegram?.enabled && (!cfg.secrets.telegramToken || !cfg.secrets.telegramChatId)) {
    problems.push('telegram.enabled=true, але TELEGRAM_BOT_TOKEN/CHAT_ID порожні — сповіщення не надсилатимуться.');
  }
  if (!Array.isArray(cfg.cities) || cfg.cities.length === 0) problems.push('cities порожній — нема що збирати.');
  for (const p of problems) log.warn('config: ' + p);
}

export default loadConfig;
