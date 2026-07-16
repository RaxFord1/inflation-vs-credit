// Telegram-нотифаєр через Bot API (fetch, без залежностей).
// Надсилає гарні угоди з фото, оцінкою, вердиктом і порівнянням цін між сайтами.
// Плюс легкий обробник команд (long polling): /stats /deals /pause /resume /help.
import { listForNotify, markNotified, markGroupNotified, getDb } from '../db/db.js';
import { cheapestInGroup } from '../util/dedup.js';
import { stats } from '../db/queries.js';
import log from '../logger.js';

const API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

async function tg(cfg, method, payload) {
  const res = await fetch(API(cfg.secrets.telegramToken, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) log.warn(`telegram ${method}: ${data.description || res.status}`);
  return data;
}

function esc(s) { return String(s || '').replace(/[<&>]/g, (c) => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;' }[c])); }

function scoreEmoji(s) { return s >= 85 ? '🔥' : s >= 75 ? '⭐' : s >= 65 ? '👍' : '•'; }

function formatDeal(l) {
  const lines = [];
  const type = { apartment: 'Квартира', house: 'Будинок', commercial: 'Комерція', land: 'Земля', room: 'Кімната', garage: 'Гараж' }[l.propertyType] || l.propertyType;
  lines.push(`${scoreEmoji(l.aiScore)} <b>${esc(type)} — оцінка ${l.aiScore}/100</b>`);
  const priceStr = l.priceUSD ? `$${l.priceUSD.toLocaleString('uk-UA')}` : '—';
  const perSqm = l.pricePerSqmUSD ? ` (${l.pricePerSqmUSD}$/м²)` : '';
  lines.push(`💰 <b>${priceStr}</b>${perSqm}`);
  const specs = [];
  if (l.areaSqm) specs.push(`${l.areaSqm} м²`);
  if (l.landSotka) specs.push(`${l.landSotka} сот`);
  if (l.rooms) specs.push(`${l.rooms} кімн`);
  if (l.floor) specs.push(`пов. ${l.floor}${l.floors ? '/' + l.floors : ''}`);
  if (l.yearBuilt) specs.push(`${l.yearBuilt} р.`);
  if (specs.length) lines.push(`📐 ${specs.join(' · ')}`);
  const loc = [l.city, l.district].filter(Boolean).join(', ');
  if (loc) lines.push(`📍 ${esc(loc)}`);
  if (l.isAuction) lines.push(`🔨 <b>Аукціон Prozorro</b>${l.auctionEndsAt ? ` до ${esc(String(l.auctionEndsAt).slice(0, 16).replace('T', ' '))}` : ''}`);
  if (l.aiVerdict) lines.push(`\n🧠 ${esc(l.aiVerdict)}`);
  if (l.aiFlags?.length) lines.push(`⚠️ ${esc(l.aiFlags.join('; '))}`);

  // порівняння цін між сайтами
  if (l.groupId) {
    const cheapest = cheapestInGroup(l.groupId);
    const alts = getDb().prepare(`SELECT source, url, price_usd FROM listings WHERE group_id=? AND uid!=? AND status='active' ORDER BY price_usd`).all(l.groupId, l.uid);
    if (alts.length) {
      lines.push(`\n🔁 <b>Той самий обʼєкт на інших сайтах:</b>`);
      for (const a of alts.slice(0, 3)) {
        const tag = a.price_usd && cheapest && a.price_usd <= cheapest.priceUSD ? ' ✅ найдешевше' : '';
        lines.push(`   • ${esc(a.source)}: $${(a.price_usd || 0).toLocaleString('uk-UA')}${tag} — ${esc(a.url)}`);
      }
    }
  }
  lines.push(`\n🔗 ${esc(l.url)}`);
  lines.push(`<i>${esc(l.source)} · ${esc(l.title).slice(0, 80)}</i>`);
  return lines.join('\n');
}

function inQuietHours(cfg) {
  const q = cfg.notify?.telegram?.quietHours;
  if (!q) return false;
  const tz = cfg.schedule?.timezone || 'Europe/Kiev';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()));
  if (q.from === q.to) return false;
  if (q.from < q.to) return hour >= q.from && hour < q.to;
  return hour >= q.from || hour < q.to; // через північ
}

/** Надіслати всі нові гарні угоди. */
export async function notifyPending(cfg) {
  if (!cfg.notify?.telegram?.enabled) return { sent: 0 };
  if (!cfg.secrets.telegramToken || !cfg.secrets.telegramChatId) { log.warn('telegram: нема токена/chat_id'); return { sent: 0 }; }
  if (inQuietHours(cfg)) { log.info('telegram: тихі години — відкладаю сповіщення'); return { sent: 0, quiet: true }; }

  const minScore = cfg.ai?.minAiScoreToNotify ?? 65;
  const allDeals = listForNotify(minScore);
  if (!allDeals.length) return { sent: 0 };

  // одна угода на групу дублів (найкраща за ai_score — allDeals вже ORDER BY ai_score DESC,
  // тож перше входження групи — найкраще), інакше той самий об'єкт шле кілька повідомлень.
  const seenGroups = new Set();
  const deals = [];
  for (const l of allDeals) {
    if (l.groupId) {
      if (seenGroups.has(l.groupId)) continue;
      seenGroups.add(l.groupId);
    }
    deals.push(l);
  }
  if (!deals.length) return { sent: 0 };
  log.info(`telegram: надсилаю ${deals.length} угод`);

  let sent = 0;
  for (const l of deals) {
    const caption = formatDeal(l);
    try {
      if (cfg.notify.telegram.sendPhotos && l.photos?.length) {
        await tg(cfg, 'sendPhoto', {
          chat_id: cfg.secrets.telegramChatId,
          photo: l.photos[0],
          caption: caption.slice(0, 1024),
          parse_mode: 'HTML',
        });
        if (caption.length > 1024) {
          await tg(cfg, 'sendMessage', { chat_id: cfg.secrets.telegramChatId, text: caption, parse_mode: 'HTML', disable_web_page_preview: true });
        }
      } else {
        await tg(cfg, 'sendMessage', { chat_id: cfg.secrets.telegramChatId, text: caption, parse_mode: 'HTML', disable_web_page_preview: false });
      }
      if (l.groupId) markGroupNotified(l.groupId); else markNotified(l.uid);
      sent++;
      await new Promise((r) => setTimeout(r, 1200)); // ліміт 30 msg/sec, не поспішаємо
    } catch (e) { log.warn(`telegram send ${l.uid}: ${e.message}`); }
  }
  return { sent };
}

export async function sendText(cfg, text) {
  return tg(cfg, 'sendMessage', { chat_id: cfg.secrets.telegramChatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

/** Легкий long-polling для команд. controls = { pause(), resume(), isPaused(), runNow() } */
export function startBot(cfg, controls) {
  if (!cfg.secrets.telegramToken) return;
  let offset = 0;
  let stopped = false;

  async function poll() {
    while (!stopped) {
      try {
        const res = await fetch(API(cfg.secrets.telegramToken, 'getUpdates') + `?timeout=50&offset=${offset}`);
        const data = await res.json();
        for (const upd of data.result || []) {
          offset = upd.update_id + 1;
          const msg = upd.message;
          if (!msg?.text) continue;
          if (String(msg.chat.id) !== String(cfg.secrets.telegramChatId)) continue; // тільки власник
          await handleCommand(cfg, controls, msg.text.trim().toLowerCase());
        }
      } catch (e) {
        log.debug(`telegram poll: ${e.message}`);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
  poll();
  return () => { stopped = true; };
}

async function handleCommand(cfg, controls, text) {
  if (text.startsWith('/stats')) {
    const s = stats();
    const lines = [
      `📊 <b>Статистика</b>`,
      `Активних: ${s.total} · Угод(≥65): ${s.deals} · Груп-дублів: ${s.dupGroups}`,
      `По типах: ${s.byType.map((x) => `${x.t}:${x.n}`).join(', ')}`,
      `По джерелах: ${s.bySource.map((x) => `${x.s}:${x.n}`).join(', ')}`,
      `Топ міст: ${s.byCity.slice(0, 5).map((x) => `${x.c}:${x.n}`).join(', ')}`,
    ];
    await sendText(cfg, lines.join('\n'));
  } else if (text.startsWith('/deals')) {
    const rows = getDb().prepare(`SELECT title, price_usd, ai_score, url, city FROM listings WHERE status='active' AND ai_score>=? ORDER BY ai_score DESC LIMIT 10`).all(cfg.ai?.minAiScoreToNotify ?? 65);
    if (!rows.length) return sendText(cfg, 'Поки немає угод.');
    const lines = rows.map((r) => `${scoreEmoji(r.ai_score)} ${r.ai_score} · $${(r.price_usd || 0).toLocaleString('uk-UA')} · ${esc(r.city || '')} — ${esc(r.url)}`);
    await sendText(cfg, `<b>Топ угод:</b>\n` + lines.join('\n'));
  } else if (text.startsWith('/pause')) {
    controls.pause(); await sendText(cfg, '⏸ Збір призупинено.');
  } else if (text.startsWith('/resume')) {
    controls.resume(); await sendText(cfg, '▶️ Збір відновлено.');
  } else if (text.startsWith('/run') || text.startsWith('/scan')) {
    await sendText(cfg, '🔄 Запускаю позачерговий збір…');
    controls.runNow?.();
  } else {
    await sendText(cfg, [
      '🏠 <b>Realty Radar</b> — команди:',
      '/stats — статистика бази',
      '/deals — топ поточних угод',
      '/run — позачерговий збір зараз',
      '/pause /resume — пауза/відновлення',
    ].join('\n'));
  }
}
