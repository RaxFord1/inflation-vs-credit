// Ввічливий HTTP-клієнт: ротація User-Agent, людиноподібні паузи,
// послідовна черга на домен, експоненційний backoff при 429/403.
import log from '../logger.js';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

const ACCEPT_LANG = ['uk-UA,uk;q=0.9,ru;q=0.7,en;q=0.5', 'uk,en-US;q=0.8,en;q=0.6'];

function rnd(min, max) { return Math.floor(min + Math.random() * (max - min)); }
function pick(arr) { return arr[rnd(0, arr.length)]; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Черга запитів на домен (per-domain concurrency = 1 за замовчуванням) + пауза між запитами.
class DomainQueue {
  constructor(politeness) {
    this.p = politeness;
    this.queues = new Map(); // host -> Promise chain tail
    this.lastAt = new Map();
  }
  domainDelay() { return rnd(this.p.minDelayMsBetweenRequests, this.p.maxDelayMsBetweenRequests); }
  run(host, task) {
    const prev = this.queues.get(host) || Promise.resolve();
    const next = prev.then(async () => {
      const last = this.lastAt.get(host) || 0;
      const wait = Math.max(0, last + this.domainDelay() - Date.now());
      if (wait > 0) await sleep(wait);
      try { return await task(); }
      finally { this.lastAt.set(host, Date.now()); }
    });
    // не даємо ланцюгу впасти через reject
    this.queues.set(host, next.catch(() => {}));
    return next;
  }
}

let queue = null;
export function initHttp(politeness) { queue = new DomainQueue(politeness); return queue; }

function proxyDispatcher() {
  const proxy = process.env.HTTP_PROXY;
  if (!proxy) return undefined;
  try {
    // undici вбудований у Node — ProxyAgent доступний динамічно
    // eslint-disable-next-line import/no-unresolved
    return import('undici').then((u) => new u.ProxyAgent(proxy)).catch(() => undefined);
  } catch { return undefined; }
}

/**
 * Ввічливий fetch із ретраями.
 * @param {string} url
 * @param {object} opts { headers, method, body, timeoutMs, expect: 'json'|'text', referer }
 */
export async function politeFetch(url, opts = {}) {
  const p = queue?.p || {
    minDelayMsBetweenRequests: 2000, maxDelayMsBetweenRequests: 5000,
    maxRetries: 3, backoffBaseMs: 4000, rotateUserAgents: true,
  };
  const host = new URL(url).host;
  const timeoutMs = opts.timeoutMs || 25000;

  const doOnce = async (attempt) => {
    const headers = {
      'User-Agent': p.rotateUserAgents ? pick(USER_AGENTS) : USER_AGENTS[0],
      'Accept': opts.expect === 'json' ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': pick(ACCEPT_LANG),
      'Cache-Control': 'no-cache',
      ...(opts.referer ? { Referer: opts.referer } : {}),
      ...(opts.headers || {}),
    };
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const dispatcher = await proxyDispatcher();
      const res = await fetch(url, {
        method: opts.method || 'GET',
        headers,
        body: opts.body,
        redirect: 'follow',
        signal: controller.signal,
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const err = new Error(`HTTP ${res.status} ${url}`);
        err.status = res.status;
        err.retryAfterMs = retryAfter ? retryAfter * 1000 : null;
        throw err;
      }
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${url}`);
        err.status = res.status;
        err.fatal = true;
        throw err;
      }
      return opts.expect === 'json' ? await res.json() : await res.text();
    } finally {
      clearTimeout(t);
    }
  };

  let lastErr;
  for (let attempt = 0; attempt <= (p.maxRetries || 3); attempt++) {
    try {
      return await queue.run(host, () => doOnce(attempt));
    } catch (e) {
      lastErr = e;
      if (e.fatal) throw e;
      if (attempt === (p.maxRetries || 3)) break;
      const backoff = e.retryAfterMs || (p.backoffBaseMs || 4000) * Math.pow(2, attempt) + rnd(0, 1500);
      log.warn(`http: ${e.message} — ретрай ${attempt + 1} через ${Math.round(backoff / 1000)}s`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

export async function fetchBinary(url, opts = {}) {
  const host = new URL(url).host;
  return queue.run(host, async () => {
    const res = await fetch(url, {
      headers: { 'User-Agent': pick(USER_AGENTS), 'Accept-Language': pick(ACCEPT_LANG), ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, contentType: res.headers.get('content-type') || 'image/jpeg' };
  });
}
