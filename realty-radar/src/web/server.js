// Веб-UI: перегляд/фільтрація оголошень + редагування фільтрів + ручний запуск збору.
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../config.js';
import { queryListings, stats, getListing } from '../db/queries.js';
import log from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWeb(cfg, controls) {
  if (!cfg.web?.enabled) return null;
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/stats', (req, res) => res.json(stats()));

  app.get('/api/listings', (req, res) => {
    const q = req.query;
    const rows = queryListings({
      propertyType: q.propertyType,
      purpose: q.purpose,
      city: q.city,
      source: q.source,
      priceMin: q.priceMin ? Number(q.priceMin) : null,
      priceMax: q.priceMax ? Number(q.priceMax) : null,
      minAiScore: q.minAiScore ? Number(q.minAiScore) : null,
      onlyDeals: q.onlyDeals === 'true',
      groupDuplicates: q.groupDuplicates !== 'false',
      sort: q.sort || 'ai_score',
      limit: Math.min(500, Number(q.limit) || 200),
      offset: Number(q.offset) || 0,
    });
    res.json({ items: rows, count: rows.length });
  });

  app.get('/api/listing/:uid', (req, res) => {
    const l = getListing(req.params.uid);
    if (!l) return res.status(404).json({ error: 'not found' });
    res.json(l);
  });

  // читання/збереження конфігу фільтрів (без секретів)
  app.get('/api/config', (req, res) => {
    const safe = { ...cfg }; delete safe.secrets;
    res.json(safe);
  });

  app.post('/api/config/filters', (req, res) => {
    try {
      const userPath = path.join(ROOT, 'config', 'config.json');
      const current = fs.existsSync(userPath) ? JSON.parse(fs.readFileSync(userPath, 'utf8')) : {};
      current.filters = { ...(current.filters || {}), ...req.body };
      fs.writeFileSync(userPath, JSON.stringify(current, null, 2));
      cfg.filters = { ...cfg.filters, ...req.body };
      log.info('config: фільтри оновлено через UI');
      res.json({ ok: true, filters: cfg.filters });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/run', async (req, res) => {
    if (!controls?.runNow) return res.status(503).json({ error: 'збирач не активний (web-only режим)' });
    controls.runNow();
    res.json({ ok: true, message: 'збір запущено' });
  });

  app.get('/api/status', (req, res) => {
    res.json({ paused: controls?.isPaused?.() ?? null, mode: controls ? 'full' : 'web-only' });
  });

  const port = cfg.web.port || 8787;
  const host = cfg.web.host || '127.0.0.1';
  const server = app.listen(port, host, () => log.info(`Веб-UI: http://${host}:${port}`));
  return server;
}
