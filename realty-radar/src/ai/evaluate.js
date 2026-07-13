// Оцінка угод через OpenAI gpt-4o-mini (текст + фото, low-detail).
// Легко для ШІ: викликаємо лише на попередньо відібраних оголошеннях (pre_score >= поріг),
// один компактний запит на оголошення, результат кешується в БД (ai_done=1).
import { buildMessages } from './prompt.js';
import { listForAi, setAiResult, medianPricePerSqm, getDb } from '../db/db.js';
import log from '../logger.js';

async function callOpenAI(cfg, messages) {
  const res = await fetch(`${cfg.secrets.openaiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.secrets.openaiKey}`,
    },
    body: JSON.stringify({
      model: cfg.ai.model || 'gpt-4o-mini',
      messages,
      temperature: 0.2,
      max_tokens: 350,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    const err = new Error(`OpenAI ${res.status}: ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '{}';
}

function parseResult(raw) {
  let obj;
  try { obj = JSON.parse(raw); }
  catch {
    const m = raw.match(/\{[\s\S]*\}/);
    obj = m ? JSON.parse(m[0]) : {};
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(obj.score) || 0)));
  const flags = [];
  if (Array.isArray(obj.flags)) flags.push(...obj.flags);
  const verdict = [obj.verdict, obj.priceAssessment ? `Ціна: ${obj.priceAssessment}.` : '', obj.condition ? `Стан: ${obj.condition}.` : '']
    .filter(Boolean).join(' ').slice(0, 500);
  return {
    score,
    verdict,
    flags,
    meta: { condition: obj.condition, priceAssessment: obj.priceAssessment, highlights: obj.highlights || [] },
  };
}

/** Прогін оцінки для всіх кандидатів у межах денного бюджету. */
export async function runEvaluation(cfg) {
  if (!cfg.ai?.enabled) { log.info('ai: вимкнено'); return { evaluated: 0 }; }
  if (!cfg.secrets.openaiKey) { log.warn('ai: нема OPENAI_API_KEY — пропускаю оцінку'); return { evaluated: 0 }; }

  const budget = cfg.ai.dailyBudgetCalls ?? 400;
  const used = getDb().prepare(`SELECT COUNT(*) n FROM listings WHERE ai_done=1 AND date(first_seen)=date('now')`).get().n;
  const remaining = Math.max(0, budget - used);
  if (remaining === 0) { log.warn(`ai: денний бюджет ${budget} вичерпано`); return { evaluated: 0 }; }

  const candidates = listForAi(cfg.ai.onlyEvaluateAbovePreScore ?? 40, remaining);
  log.info(`ai: кандидатів на оцінку ${candidates.length} (бюджет лишилось ${remaining})`);

  let evaluated = 0;
  for (const l of candidates) {
    const median = medianPricePerSqm(l.city, l.propertyType);
    try {
      const messages = buildMessages(l, median, cfg);
      const raw = await callOpenAI(cfg, messages);
      const result = parseResult(raw);
      setAiResult(l.uid, result);
      evaluated++;
      log.debug(`ai: ${l.source}/${l.sourceId} -> ${result.score} (${l.title?.slice(0, 40)})`);
    } catch (e) {
      log.warn(`ai eval ${l.uid}: ${e.message}`);
      if (e.status === 401) break; // невірний ключ — нема сенсу продовжувати
      if (e.status === 429) { await new Promise((r) => setTimeout(r, 8000)); }
    }
  }
  log.info(`ai: оцінено ${evaluated}`);
  return { evaluated };
}
