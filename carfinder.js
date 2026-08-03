/*
 * Module: car finder & vetting — Ukraine / Europe.
 *
 * A pure, data-driven pipeline that turns a pile of raw listings into a ranked
 * short-list of the best price/quality options, after running each candidate
 * through configurable filters, a *text-describable* rule engine, a value/quality
 * score, and a pipeline of vetting checks (VIN & registry, accident history,
 * damage-type analysis, AI suitability). Every stage is declarative so the
 * user can bend the logic without touching code:
 *
 *   filters   — hard cut-offs (make, model, year, price, mileage, region, …)
 *   rules     — one line of text each, e.g. `reject: make = Tesla and region != EU`
 *   checks    — pluggable "providers" (registry / history / AI) with heuristics
 *   scoring   — weighted price/mileage/age/condition/history → 0–100
 *
 * The core (`findCars`) is synchronous and works offline on a supplied array of
 * listings — so it is testable and drops straight into the app's render loop.
 * Live sourcing (`findCarsLive`) fetches from AutoRia / mobile.de first, then
 * calls the same core. Nothing here needs a DOM or a build step.
 */

/* ---------- local formatting (no dependency on engine.js when required alone) ---------- */
const _nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cfUsd = (v) => '$' + _nf0.format(Math.round(v || 0));
const cfNum = (v) => _nf0.format(Math.round(v || 0));
const cfClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Region groups. EU here means "European market car" — EEA + UK + EFTA, the
 * cars a Ukrainian buyer treats as "європейка" (euro-spec, not a US/Canada
 * import or a Gulf/China-spec car). */
const CF_EU_COUNTRIES = [
  'DE', 'PL', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH', 'CZ', 'SK', 'SE', 'NO',
  'DK', 'FI', 'PT', 'IE', 'GB', 'UK', 'LU', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI',
  'EE', 'LV', 'LT', 'IS', 'LI',
];
/* Canonical damage types. Synonyms (пороги/стойки → structural, удар в
 * батарею → battery, утоплен → flood) map onto a fixed vocabulary so rules and
 * checks reason over stable values. Hard types are always a full reject. */
const CF_HARD_DAMAGE = ['flood', 'fire', 'battery', 'structural', 'airbag'];
function cfCanonDamage(v) {
  v = String(v || 'none').toLowerCase().trim();
  const map = {
    water: 'flood', flooded: 'flood', утоплен: 'flood', утопленник: 'flood',
    burn: 'fire', burnt: 'fire', пожар: 'fire', горел: 'fire',
    'battery-pack': 'battery', акб: 'battery', 'battery pack': 'battery', батарея: 'battery',
    sill: 'structural', sills: 'structural', pillar: 'structural', pillars: 'structural',
    threshold: 'structural', порог: 'structural', пороги: 'structural', стойка: 'structural',
    стойки: 'structural', лонжерон: 'structural', frame: 'structural', chassis: 'structural',
    airbags: 'airbag', подушки: 'airbag',
  };
  return map[v] || v;
}

const CF_REGION_OF = (c) => {
  if (!c) return 'UNKNOWN';
  c = String(c).toUpperCase();
  if (c === 'UA' || c === 'UKR' || c === 'UKRAINE') return 'UA';
  if (c === 'US' || c === 'USA' || c === 'CA' || c === 'CAN') return 'US';
  if (CF_EU_COUNTRIES.includes(c)) return 'EU';
  if (['AE', 'SA', 'QA', 'KW', 'GEO', 'GE'].includes(c)) return 'OTHER';
  return c.length === 2 ? 'OTHER' : 'UNKNOWN';
};

/* ---------- listing normalization ----------
 * Every source adapter maps its raw payload onto this shape; the rest of the
 * pipeline only ever sees normalized listings. Missing fields are tolerated
 * (checks flag what they can't verify rather than crashing). */
function cfNormalize(raw, fx0) {
  fx0 = fx0 || 45;
  const num = (v) => (v === '' || v == null ? null : +String(v).replace(/[^\d.\-]/g, '') || 0);
  const cur = (raw.currency || 'USD').toUpperCase();
  let priceUSD = num(raw.priceUSD);
  if (priceUSD == null) {
    const p = num(raw.price);
    priceUSD = p == null ? null : cur === 'UAH' ? p / fx0 : cur === 'EUR' ? p * 1.08 : p;
  }
  const country = raw.country || raw.originCountry || null;
  const region = raw.region || CF_REGION_OF(country || (raw.imported ? null : 'UA'));
  const damageType = cfCanonDamage(raw.damageType || (raw.damaged ? 'unknown' : 'none'));
  const damaged = raw.damaged != null ? !!raw.damaged : damageType !== 'none';
  // "фото до ремонта": yes | no | unknown (absence is treated as a red flag)
  const beforeRepairPhotos = raw.beforeRepairPhotos === true || raw.beforeRepairPhotos === 'yes' ? 'yes'
    : raw.beforeRepairPhotos === false || raw.beforeRepairPhotos === 'no' ? 'no'
    : (raw.beforeRepairPhotos || 'unknown');
  return {
    id: raw.id != null ? String(raw.id) : (raw.url || raw.title || Math.round((raw.year || 0) + (priceUSD || 0))).toString(),
    source: raw.source || 'manual',
    url: raw.url || null,
    title: raw.title || [raw.make, raw.model, raw.year].filter(Boolean).join(' '),
    make: (raw.make || '').trim(),
    model: (raw.model || '').trim(),
    year: num(raw.year) || 0,
    priceUSD: priceUSD == null ? 0 : Math.round(priceUSD),
    currency: cur,
    priceRaw: num(raw.price),
    mileageKm: num(raw.mileageKm) != null ? num(raw.mileageKm) : (num(raw.mileage) || 0),
    country,
    region,
    fuel: (raw.fuel || 'unknown').toLowerCase(),
    gearbox: (raw.gearbox || raw.transmission || 'unknown').toLowerCase(),
    bodyType: (raw.bodyType || raw.body || 'unknown').toLowerCase(),
    vin: raw.vin ? String(raw.vin).toUpperCase().trim() : '',
    seller: (raw.seller || raw.sellerType || 'unknown').toLowerCase(),
    damaged,
    damageType,
    titleStatus: (raw.titleStatus || (damaged ? 'unknown' : 'clean')).toLowerCase(),
    ownersCount: num(raw.ownersCount),
    beforeRepairPhotos,
    imported: raw.imported != null ? !!raw.imported : (region !== 'UA' && region !== 'UNKNOWN'),
    photos: num(raw.photos) || 0,
    options: Array.isArray(raw.options) ? raw.options : [],
    // history is what a report/registry would return; may be partially known
    history: Object.assign(
      { accidents: null, odometerRollback: null, registeredInRegistry: null,
        stolen: null, liens: null, lastKnownKm: null, importedFrom: country },
      raw.history || {}
    ),
    aiVerdict: raw.aiVerdict || null, // filled by the AI provider if run
    _raw: raw,
  };
}

/* ---------- tiny expression language for the rule engine ----------
 * Powers user-written rules like:
 *   reject: make = Tesla and region != EU
 *   warn:   priceUSD < market * 0.6
 *   reject: damaged and damageType not in [front, rear]
 *   boost 12: fuel = EV
 * Grammar (lowest→highest precedence): or · and · not · comparison ·
 * add/sub · mul/div · primary. Identifiers resolve to a context value when the
 * context defines one (numbers, booleans, the listing's fields, `market`,
 * `kmPerYear`, `age`), otherwise to their own name as a string — so bare words
 * like EU / Tesla / front act as string literals with no quoting needed. */
function cfTokenize(s) {
  const toks = [];
  const re = /\s*(<=|>=|!=|==|=|<|>|\(|\)|\[|\]|,|\+|\-|\*|\/|"[^"]*"|'[^']*'|[A-Za-z_][\w.]*|\d+(?:\.\d+)?)/y;
  let m;
  while ((m = re.exec(s))) {
    if (re.lastIndex === 0) break;
    toks.push(m[1]);
    if (re.lastIndex >= s.length) break;
  }
  return toks;
}

function cfParse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t) => { if (t && tokens[i] !== t) throw new Error(`expected "${t}" but got "${tokens[i] || '<end>'}"`); return tokens[i++]; };
  const low = (t) => (t || '').toLowerCase();

  function parseOr() {
    let node = parseAnd();
    while (low(peek()) === 'or') { eat(); node = { op: 'or', l: node, r: parseAnd() }; }
    return node;
  }
  function parseAnd() {
    let node = parseNot();
    while (low(peek()) === 'and') { eat(); node = { op: 'and', l: node, r: parseNot() }; }
    return node;
  }
  function parseNot() {
    if (low(peek()) === 'not' && low(tokens[i + 1]) !== 'in') { eat(); return { op: 'not', v: parseNot() }; }
    return parseCmp();
  }
  function parseCmp() {
    const l = parseAdd();
    let t = low(peek());
    if (t === 'not' && low(tokens[i + 1]) === 'in') { eat(); eat(); return { op: 'nin', l, r: parseList() }; }
    if (t === 'in') { eat(); return { op: 'in', l, r: parseList() }; }
    if (['=', '==', '!=', '<', '>', '<=', '>='].includes(peek())) {
      const op = eat();
      return { op: op === '==' ? '=' : op, l, r: parseAdd() };
    }
    return l; // bare truthy term
  }
  function parseList() {
    eat('[');
    const items = [];
    if (peek() !== ']') { items.push(parseAdd()); while (peek() === ',') { eat(','); items.push(parseAdd()); } }
    eat(']');
    return { op: 'list', items };
  }
  function parseAdd() {
    let node = parseMul();
    while (peek() === '+' || peek() === '-') { const op = eat(); node = { op, l: node, r: parseMul() }; }
    return node;
  }
  function parseMul() {
    let node = parsePrimary();
    while (peek() === '*' || peek() === '/') { const op = eat(); node = { op, l: node, r: parsePrimary() }; }
    return node;
  }
  function parsePrimary() {
    const t = peek();
    if (t === '(') { eat('('); const n = parseOr(); eat(')'); return n; }
    if (t === undefined) throw new Error('unexpected end of rule');
    eat();
    if (/^["']/.test(t)) return { op: 'lit', v: t.slice(1, -1) };
    if (/^\d/.test(t)) return { op: 'lit', v: +t };
    return { op: 'ident', name: t };
  }
  const ast = parseOr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}" in rule`);
  return ast;
}

function cfEval(node, ctx) {
  const asStr = (v) => (v == null ? '' : String(v)).toLowerCase();
  const num = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : +v);
  const cmp = (l, r) => {
    if (typeof l === 'number' || typeof r === 'number') {
      const a = num(l), b = num(r);
      if (!isNaN(a) && !isNaN(b)) return a - b;
    }
    return asStr(l) < asStr(r) ? -1 : asStr(l) > asStr(r) ? 1 : 0;
  };
  switch (node.op) {
    case 'lit': return node.v;
    case 'ident': {
      const k = node.name;
      if (k in ctx) return ctx[k];
      const lk = Object.keys(ctx).find((x) => x.toLowerCase() === k.toLowerCase());
      if (lk) return ctx[lk];
      return node.name; // bare word → string literal
    }
    case 'list': return node.items.map((n) => cfEval(n, ctx));
    case 'or': return cfEval(node.l, ctx) || cfEval(node.r, ctx);
    case 'and': return cfEval(node.l, ctx) && cfEval(node.r, ctx);
    case 'not': return !cfEval(node.v, ctx);
    case '+': return num(cfEval(node.l, ctx)) + num(cfEval(node.r, ctx));
    case '-': return num(cfEval(node.l, ctx)) - num(cfEval(node.r, ctx));
    case '*': return num(cfEval(node.l, ctx)) * num(cfEval(node.r, ctx));
    case '/': return num(cfEval(node.l, ctx)) / num(cfEval(node.r, ctx));
    case '=': return cmp(cfEval(node.l, ctx), cfEval(node.r, ctx)) === 0;
    case '!=': return cmp(cfEval(node.l, ctx), cfEval(node.r, ctx)) !== 0;
    case '<': return cmp(cfEval(node.l, ctx), cfEval(node.r, ctx)) < 0;
    case '>': return cmp(cfEval(node.l, ctx), cfEval(node.r, ctx)) > 0;
    case '<=': return cmp(cfEval(node.l, ctx), cfEval(node.r, ctx)) <= 0;
    case '>=': return cmp(cfEval(node.l, ctx), cfEval(node.r, ctx)) >= 0;
    case 'in': { const r = cfEval(node.r, ctx); return r.some((x) => cmp(cfEval(node.l, ctx), x) === 0); }
    case 'nin': { const r = cfEval(node.r, ctx); return !r.some((x) => cmp(cfEval(node.l, ctx), x) === 0); }
    default: throw new Error('bad node ' + node.op);
  }
}

/* Parse a block of rule text into executable rule objects. One rule per line:
 *   <action>[ N]: <condition>            [# reason]
 * action ∈ reject | warn | boost | penalize (boost/penalize take a points N,
 * default 10). Lines starting with // or # are comments; blank lines ignored.
 * A malformed line becomes an `error` rule (surfaced in the UI, never thrown). */
function cfParseRules(text) {
  const out = [];
  (text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) return;
    const colon = line.indexOf(':');
    if (colon < 0) { out.push({ error: `line ${idx + 1}: missing ":" — write "reject: <condition>"`, src: line }); return; }
    const head = line.slice(0, colon).trim();
    let body = line.slice(colon + 1).trim();
    let reason = '';
    const hash = body.search(/\s#|\s\/\//);
    if (hash >= 0) { reason = body.slice(hash).replace(/^\s*(#|\/\/)\s*/, '').trim(); body = body.slice(0, hash).trim(); }
    const hm = head.match(/^(reject|warn|boost|penalize)\s*(-?\d+)?$/i);
    if (!hm) { out.push({ error: `line ${idx + 1}: unknown action "${head}" (use reject/warn/boost/penalize)`, src: line }); return; }
    const action = hm[1].toLowerCase();
    const points = hm[2] != null ? Math.abs(+hm[2]) : 10;
    try {
      const ast = cfParse(cfTokenize(body));
      out.push({ action, points, reason: reason || body, cond: body, ast });
    } catch (e) {
      out.push({ error: `line ${idx + 1}: ${e.message}`, src: line });
    }
  });
  return out;
}

/* Built-in rules always evaluated in addition to the user's text rules. They
 * encode the "sane defaults" a Ukrainian buyer wants; each is expressible in
 * the same text DSL, so users can see, copy or override them. */
const CF_BUILTIN_RULES = [
  'reject: make = Tesla and region != EU  # Tesla — беру только европейку (батарея/подготовка, гарантия ЕС)',
  'reject: damaged and damageType in [flood, fire, battery, structural, airbag]  # утопленник / пожар / удар в батарею / силовые (пороги-стойки) / подушки — полный отказ',
  'warn: damaged and beforeRepairPhotos != yes  # фото ДО ремонта нет в объявлении — не отказ, а проверить историю аукциона по VIN (Copart/IAAI/bidfax/autoastat)',
  'warn: priceUSD < market * 0.6  # подозрительно дёшево — вероятна скрытая проблема',
  'warn: kmPerYear > 30000  # очень большой ежегодный пробег',
  'warn: vin = "" and seller = dealer  # дилер без VIN — нечего проверить',
  'penalize 8: titleStatus in [salvage, rebuilt]  # восстановленный тайтл',
];

/* ---------- vetting checks (pluggable providers) ----------
 * Each check is a small text-described module: { id, label, desc, run(listing,
 * ctx) → { status, score, findings[] } }. status ∈ ok|warn|fail|skip. Real
 * external sources plug in through ctx.providers.{registry,history,ai}
 * (async, called ahead of time in the live path and their results attached to
 * the listing); when absent, each check falls back to a transparent heuristic
 * over the data already in the listing. Add a check by pushing to this array. */
const CF_CHECKS = [
  {
    id: 'vin',
    label: 'VIN & реестр',
    desc: 'Проверка VIN и наличия авто в государственном реестре (МВС/сервисные центры). ' +
      'Провайдер: ctx.providers.registry(vin) → { found, plate, firstReg, liens, stolen }.',
    run(l) {
      if (!l.vin) return { status: 'warn', score: 55, findings: ['VIN не указан — историю не проверить'] };
      if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(l.vin)) return { status: 'warn', score: 50, findings: ['VIN не 17-значный / некорректный формат'] };
      const h = l.history || {};
      const f = [];
      let status = 'ok', score = 90;
      if (h.stolen === true) { status = 'fail'; score = 0; f.push('числится в угоне / розыске'); }
      if (h.liens === true) { status = 'fail'; score = 10; f.push('обременение (залог/арест)'); }
      if (h.registeredInRegistry === false) { status = status === 'ok' ? 'warn' : status; score = Math.min(score, 45); f.push('не найдено в реестре — уточнить растаможку/учёт'); }
      if (!f.length) f.push('VIN валиден' + (h.registeredInRegistry ? ', есть в реестре' : ''));
      return { status, score, findings: f };
    },
  },
  {
    id: 'history',
    label: 'История (ДТП, пробег, владельцы)',
    desc: 'История эксплуатации: аварии, скрутка пробега, число владельцев, страна ввоза. ' +
      'Провайдер: ctx.providers.history(vin) → { accidents, odometerRollback, lastKnownKm, owners }.',
    run(l) {
      const h = l.history || {};
      const f = [];
      let status = 'ok', score = 90;
      if (h.odometerRollback === true) { status = 'fail'; score = 10; f.push('признаки скрутки пробега'); }
      else if (h.lastKnownKm != null && l.mileageKm && h.lastKnownKm > l.mileageKm + 5000) {
        status = 'fail'; score = 15; f.push(`пробег в объявлении (${cfNum(l.mileageKm)} км) меньше ранее зафиксированного (${cfNum(h.lastKnownKm)} км)`);
      }
      if (typeof h.accidents === 'number' && h.accidents > 0) {
        status = status === 'fail' ? status : 'warn'; score = Math.min(score, h.accidents > 1 ? 45 : 65);
        f.push(`ДТП в истории: ${h.accidents}`);
      }
      if (typeof l.ownersCount === 'number' && l.ownersCount >= 4) { status = status === 'ok' ? 'warn' : status; score = Math.min(score, 60); f.push(`много владельцев: ${l.ownersCount}`); }
      if (h.accidents == null && h.odometerRollback == null) { status = status === 'ok' ? 'skip' : status; if (!f.length) f.push('нет данных истории — заказать отчёт (Carfax/CarVertical/AUTO.RIA перевірка)'); }
      if (!f.length) f.push('история чистая по доступным данным');
      return { status, score, findings: f };
    },
  },
  {
    id: 'damage',
    label: 'Тип повреждений',
    desc: 'Классификация повреждений и допустимость. Допустимые типы задаёт cf_allowDamageTypes; ' +
      'по умолчанию — только косметика/лёгкий перёд-зад. Структурные, залив, огонь — стоп.',
    run(l, ctx) {
      if (!l.damaged) return { status: 'ok', score: 100, findings: ['без повреждений'] };
      // hard types are an unconditional reject regardless of photos
      if (CF_HARD_DAMAGE.includes(l.damageType)) {
        const nm = { flood: 'утопленник', fire: 'после пожара', battery: 'удар в батарею', structural: 'силовые/пороги-стойки', airbag: 'сработали подушки' };
        return { status: 'fail', score: 0, findings: [`тяжёлое повреждение: ${nm[l.damageType] || l.damageType} — полный отказ`] };
      }
      const allowed = ctx.allowDamageTypes;
      // "нет фото ДО ремонта" в объявлении НЕ отказ: продавец показывает уже
      // отремонтированную машину, а фото с аукциона (Copart/IAAI) находятся по
      // VIN на bidfax / autoastat. Если история по VIN ещё не подтягивалась —
      // помечаем "нужна проверка VIN", а не выкидываем.
      const noBefore = l.beforeRepairPhotos !== 'yes';
      const auctionKnown = l.beforeRepairPhotos === 'yes' ||
        (l.history && (l.history.auctionFound === true || l.history.severity));
      if (l.damageType === 'unknown') {
        return auctionKnown
          ? { status: 'warn', score: 55, findings: ['тип по истории аукциона — оценить объём'] }
          : { status: 'warn', score: 50, needsVin: true, findings: ['тип не указан — искать историю аукциона по VIN (Copart/IAAI/bidfax/autoastat)'] };
      }
      if (allowed.length && !allowed.includes(l.damageType)) return { status: 'fail', score: 20, findings: [`тип "${l.damageType}" вне разрешённого (лёгкий перёд/зад)`] };
      if (noBefore && !auctionKnown) {
        return { status: 'warn', score: 55, needsVin: true, findings: [`повреждение "${l.damageType}"; фото ДО в объявлении нет — проверить историю аукциона по VIN (объём мог быть больше)`] };
      }
      return { status: 'warn', score: 68, findings: [`повреждение "${l.damageType}" — лёгкое, есть фото/история до ремонта; торг и осмотр`] };
    },
  },
  {
    id: 'ai',
    label: 'AI-анализ соответствия',
    desc: 'Оценка ИИ «подходит ли нам эта машина» по всем критериям сразу. ' +
      'Провайдер: ctx.providers.ai(prompt) → { score 0..100, verdict, notes }. ' +
      'Без провайдера — прозрачная эвристика + готовый промпт (listing.aiPrompt).',
    run(l, ctx) {
      if (l.aiVerdict && typeof l.aiVerdict.score === 'number') {
        return { status: l.aiVerdict.score >= 60 ? 'ok' : l.aiVerdict.score >= 40 ? 'warn' : 'fail',
          score: l.aiVerdict.score, findings: [l.aiVerdict.verdict || l.aiVerdict.notes || 'AI-оценка получена'] };
      }
      // heuristic stand-in: rewards clean, euro-spec, well-photographed, fair-priced cars
      let s = 60;
      if (l.region === 'EU') s += 10;
      if (l.region === 'US') s -= 8;
      if (!l.damaged) s += 12; else s -= 12;
      if (l.photos >= 8) s += 6; else if (l.photos && l.photos < 3) s -= 6;
      if (ctx.marketMedian && l.priceUSD) { const r = l.priceUSD / ctx.marketMedian; if (r < 0.9) s += 8; if (r > 1.15) s -= 8; }
      if (l.vin) s += 4;
      s = Math.round(cfClamp(s, 0, 100));
      return { status: s >= 60 ? 'ok' : s >= 40 ? 'warn' : 'fail', score: s, heuristic: true,
        findings: ['эвристическая оценка (подключите AI-провайдера для реального анализа)'] };
    },
  },
];

function cfAiPrompt(l, p) {
  return [
    'Ты — эксперт по подбору б/у авто в Украине. Оцени, подходит ли эта машина покупателю, по шкале 0–100.',
    `Критерии покупателя: марка ${p.cf_make || 'любая'}, модель ${p.cf_model || 'любая'}, ` +
    `бюджет до $${p.cf_priceMaxUSD}, год от ${p.cf_yearMin}, пробег до ${cfNum(p.cf_mileageMaxKm)} км, ` +
    `регион ${p.cf_region}. Допустимые повреждения: ${p.cf_allowDamageTypes || 'нет'}.`,
    `Объявление: ${l.title}, ${l.year} г., $${cfNum(l.priceUSD)}, ${cfNum(l.mileageKm)} км, ` +
    `топливo ${l.fuel}, КПП ${l.gearbox}, регион ${l.region}${l.country ? ' (' + l.country + ')' : ''}, ` +
    `${l.damaged ? 'повреждения: ' + l.damageType : 'без повреждений'}, VIN ${l.vin || 'нет'}.`,
    'Верни JSON: {"score":0-100,"verdict":"кратко","notes":"риски и плюсы"}.',
  ].join('\n');
}

/* ---------- scoring ----------
 * value/quality 0–100 = weighted mix of price-vs-market, mileage-for-age, age,
 * condition and history. Weights come from cf_w_* (normalized). */
function cfScore(l, ctx, checkScores) {
  const age = Math.max(0, ctx.thisYear - (l.year || ctx.thisYear));
  const r = ctx.marketMedian ? l.priceUSD / ctx.marketMedian : 1;
  const priceScore = cfClamp(60 + (1 - r) * 150, 0, 100);
  const expKm = Math.max(15000, age * 15000);
  const mRatio = l.mileageKm ? l.mileageKm / expKm : 1;
  const mileageScore = cfClamp(60 + (1 - mRatio) * 60, 0, 100);
  const ageScore = cfClamp(100 - age * 6, 0, 100);
  const auctionKnown = l.beforeRepairPhotos === 'yes' || (l.history && (l.history.auctionFound === true || l.history.severity));
  const condScore = !l.damaged ? 100
    : CF_HARD_DAMAGE.includes(l.damageType) ? 10
    : !auctionKnown ? 52   // damaged, auction record not looked up yet — neutral, pending VIN check
    : l.damageType === 'unknown' ? 55 : 70;
  const histScore = Math.round((checkScores.vin + checkScores.history) / 2);

  const w = ctx.weights;
  const parts = {
    price: priceScore, mileage: mileageScore, age: ageScore,
    condition: condScore, history: histScore,
  };
  const wsum = w.price + w.mileage + w.age + w.condition + w.history || 1;
  const score = (priceScore * w.price + mileageScore * w.mileage + ageScore * w.age +
    condScore * w.condition + histScore * w.history) / wsum;
  return { score: Math.round(score), parts, age, priceRatio: r };
}

/* ---------- filters ---------- */
function cfMatchFilters(l, p) {
  const reasons = [];
  const eq = (a, b) => a && b && String(a).toLowerCase() === String(b).toLowerCase();
  const has = (v) => v != null && v !== '' && v !== 'any';
  if (has(p.cf_make) && !eq(l.make, p.cf_make)) reasons.push(`марка ≠ ${p.cf_make}`);
  if (has(p.cf_model) && !(l.model || '').toLowerCase().includes(String(p.cf_model).toLowerCase())) reasons.push(`модель ≠ ${p.cf_model}`);
  if (p.cf_yearMin && l.year && l.year < p.cf_yearMin) reasons.push(`год < ${p.cf_yearMin}`);
  if (p.cf_yearMax && l.year && l.year > p.cf_yearMax) reasons.push(`год > ${p.cf_yearMax}`);
  if (p.cf_priceMaxUSD && l.priceUSD > p.cf_priceMaxUSD) reasons.push(`цена > $${p.cf_priceMaxUSD}`);
  if (p.cf_priceMinUSD && l.priceUSD < p.cf_priceMinUSD) reasons.push(`цена < $${p.cf_priceMinUSD}`);
  if (p.cf_mileageMaxKm && l.mileageKm && l.mileageKm > p.cf_mileageMaxKm) reasons.push(`пробег > ${cfNum(p.cf_mileageMaxKm)} км`);
  if (has(p.cf_region) && p.cf_region !== 'any' && l.region !== p.cf_region) reasons.push(`регион ≠ ${p.cf_region}`);
  if (has(p.cf_fuel) && !eq(l.fuel, p.cf_fuel)) reasons.push(`топливо ≠ ${p.cf_fuel}`);
  if (has(p.cf_gearbox) && !eq(l.gearbox, p.cf_gearbox)) reasons.push(`КПП ≠ ${p.cf_gearbox}`);
  if (has(p.cf_bodyType) && !eq(l.bodyType, p.cf_bodyType)) reasons.push(`кузов ≠ ${p.cf_bodyType}`);
  if (!p.cf_allowDamaged && l.damaged) reasons.push('повреждённые исключены');
  return reasons;
}

/* Median price per make+model (fallback: whole set) — anchors "vs market". */
function cfMarketStats(listings) {
  const median = (arr) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const byModel = {};
  for (const l of listings) {
    const k = (l.make + '|' + l.model).toLowerCase();
    (byModel[k] = byModel[k] || []).push(l.priceUSD);
  }
  const overall = median(listings.map((l) => l.priceUSD));
  const modelMedian = {};
  for (const k in byModel) modelMedian[k] = median(byModel[k]);
  return { overall, modelMedian, medianFor: (l) => modelMedian[(l.make + '|' + l.model).toLowerCase()] || overall };
}

/* ---------- orchestrator (pure, synchronous) ---------- */
function findCars(p, listings) {
  const thisYear = p.cf_thisYear || 2026;
  const fx0 = p.fx0 || 45;
  const norm = (listings || []).map((raw) => (raw && raw._raw ? raw : cfNormalize(raw, fx0)));
  const allowDamageTypes = String(p.cf_allowDamageTypes || '')
    .split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const weights = {
    price: p.cf_w_price != null ? p.cf_w_price : 30,
    mileage: p.cf_w_mileage != null ? p.cf_w_mileage : 20,
    age: p.cf_w_age != null ? p.cf_w_age : 15,
    condition: p.cf_w_condition != null ? p.cf_w_condition : 20,
    history: p.cf_w_history != null ? p.cf_w_history : 15,
  };
  const rules = cfParseRules(
    (p.cf_useBuiltinRules === false ? '' : CF_BUILTIN_RULES.join('\n') + '\n') + (p.cf_rulesText || '')
  );
  const ruleErrors = rules.filter((r) => r.error).map((r) => r.error);
  const goodRules = rules.filter((r) => r.ast);

  const stats = cfMarketStats(norm);
  const rejected = [];
  const evaluated = [];

  for (const l of norm) {
    const filterReasons = cfMatchFilters(l, p);
    if (filterReasons.length) { rejected.push({ listing: l, stage: 'filter', reasons: filterReasons }); continue; }

    const marketMedian = stats.medianFor(l);
    const age = Math.max(0, thisYear - (l.year || thisYear));
    const ruleCtx = Object.assign({}, l, {
      market: marketMedian, marketMedian, kmPerYear: l.mileageKm && age ? Math.round(l.mileageKm / age) : (l.mileageKm || 0),
      age, priceUSD: l.priceUSD, thisYear,
    });

    // rules
    const flags = [], boosts = [];
    let killed = null;
    for (const r of goodRules) {
      let hit = false;
      try { hit = !!cfEval(r.ast, ruleCtx); } catch (e) { continue; }
      if (!hit) continue;
      if (r.action === 'reject') { killed = r.reason; break; }
      if (r.action === 'warn') flags.push(r.reason);
      if (r.action === 'boost') boosts.push({ pts: r.points, why: r.reason });
      if (r.action === 'penalize') boosts.push({ pts: -r.points, why: r.reason });
    }
    if (killed) { rejected.push({ listing: l, stage: 'rule', reasons: [killed] }); continue; }

    // checks
    const checkCtx = { allowDamageTypes, marketMedian, weights, thisYear, providers: p.cf_providers || {} };
    const checks = {};
    for (const c of CF_CHECKS) { try { checks[c.id] = Object.assign({ id: c.id, label: c.label }, c.run(l, checkCtx)); } catch (e) { checks[c.id] = { id: c.id, label: c.label, status: 'skip', score: 60, findings: ['ошибка проверки: ' + e.message] }; } }
    const checkScores = { vin: checks.vin.score, history: checks.history.score, damage: checks.damage.score, ai: checks.ai.score };

    const sc = cfScore(l, { thisYear, marketMedian, weights }, checkScores);
    let score = sc.score;
    const boostTotal = boosts.reduce((a, b) => a + b.pts, 0);
    // fold the AI verdict and boosts/penalties gently into the final score
    score = Math.round(cfClamp(score * 0.85 + checkScores.ai * 0.15 + boostTotal, 0, 100));
    if (Object.values(checks).some((c) => c.status === 'fail')) flags.unshift('есть проверка со статусом FAIL');

    evaluated.push({
      listing: l, score, base: sc.score, parts: sc.parts, priceRatio: sc.priceRatio,
      marketMedian, age, kmPerYear: ruleCtx.kmPerYear, flags, boosts, checks,
      aiPrompt: cfAiPrompt(l, p),
      verdict: killed ? 'rejected' : flags.length ? 'caution' : 'ok',
    });
  }

  evaluated.sort((a, b) => b.score - a.score || a.listing.priceUSD - b.listing.priceUSD);
  const topN = p.cf_topN || 10;
  const results = evaluated.slice(0, topN);

  const best = evaluated[0] || null;
  const bestValue = evaluated.slice().sort((a, b) =>
    (b.parts.price - a.parts.price) || (b.score - a.score))[0] || null;

  const kpis = [
    { label: 'Отобрано / всего', value: `${evaluated.length} / ${norm.length}`, delta: `${rejected.length} отсеяно (фильтры и правила)` },
    { label: 'Лучший балл', value: best ? String(best.score) + ' / 100' : '—', delta: best ? best.listing.title : '' },
    { label: 'Медиана рынка (в выборке)', value: cfUsd(stats.overall), delta: 'по всем объявлениям в выдаче' },
    { label: 'Лучшая цена/качество', value: bestValue ? cfUsd(bestValue.listing.priceUSD) : '—', delta: bestValue ? `${Math.round((1 - bestValue.priceRatio) * 100)}% к медиане модели` : '' },
  ];

  return {
    mode: 'find', results, evaluated, rejected, marketStats: stats,
    ruleErrors, ruleCount: goodRules.length, checksMeta: CF_CHECKS.map((c) => ({ id: c.id, label: c.label, desc: c.desc })),
    kpis, scanned: norm.length, passed: evaluated.length, params: p,
    ctx: { thisYear, fxEnd: fx0, horizonYears: 0, inflPct: p.inflPct || 0, usdInflPct: p.usdInflPct || 0 },
  };
}

/* Machine-readable summary for CLI / LLM agents. */
function cfSummarize(res) {
  const one = (e) => ({
    title: e.listing.title, url: e.listing.url, source: e.listing.source,
    year: e.listing.year, priceUSD: e.listing.priceUSD, mileageKm: e.listing.mileageKm,
    region: e.listing.region, fuel: e.listing.fuel, gearbox: e.listing.gearbox,
    vin: e.listing.vin || null, score: e.score, verdict: e.verdict,
    priceVsMarketPct: Math.round((e.priceRatio - 1) * 100),
    flags: e.flags, scoreParts: e.parts,
    checks: Object.fromEntries(Object.values(e.checks).map((c) => [c.id, { status: c.status, score: c.score, findings: c.findings }])),
  });
  return {
    mode: 'find',
    scanned: res.scanned, passed: res.passed, rejected: res.rejected.length,
    ruleCount: res.ruleCount, ruleErrors: res.ruleErrors,
    marketMedianUSD: Math.round(res.marketStats.overall),
    kpis: res.kpis.map((k) => ({ label: k.label, value: k.value, note: k.delta || null })),
    results: res.results.map(one),
    rejectedSample: res.rejected.slice(0, 20).map((r) => ({ title: r.listing.title, stage: r.stage, reasons: r.reasons })),
    checks: res.checksMeta,
    assumptions: res.params,
  };
}

/* ---------- source adapters (live sourcing) ----------
 * Each adapter maps a provider's raw payload to the normalized shape and knows
 * how to fetch a page of results. fetchLive is async and uses global fetch
 * (Node 18+ / browsers). In the browser some endpoints will be blocked by
 * CORS — run the CLI (`node cli.js find --live`) or a small proxy for those. */
const CF_SOURCES = {
  /* AutoRia — official developer API (https://developer.ria.com). Needs a free
   * api_key. Two calls: /auto/search → ids, then /auto/info per id. */
  autoria: {
    id: 'autoria', label: 'AUTO.RIA (Україна)',
    buildSearchUrl(p) {
      const q = new URLSearchParams({ api_key: p.cf_apiKey || '', category_id: '1', countpage: String(p.cf_topN || 20) });
      if (p.cf_priceMaxUSD) q.set('price_ot', '0'), q.set('price_do', String(p.cf_priceMaxUSD));
      if (p.cf_yearMin) q.set('s_yers', String(p.cf_yearMin));
      return `https://developer.ria.com/auto/search?${q}`;
    },
    normalizeInfo(info) {
      return cfNormalize({
        id: info.autoData && info.autoData.autoId, source: 'autoria',
        url: info.linkToView ? 'https://auto.ria.com' + info.linkToView : null,
        title: [info.markName, info.modelName, info.autoData && info.autoData.year].filter(Boolean).join(' '),
        make: info.markName, model: info.modelName, year: info.autoData && info.autoData.year,
        price: info.USD || info.priceUSD || (info.autoData && info.autoData.price), currency: 'USD',
        mileage: info.autoData && info.autoData.race && info.autoData.race * 1000,
        country: 'UA', region: 'UA',
        fuel: info.fuelName, gearbox: info.gearBoxName, bodyType: info.bodyName,
        vin: info.VIN || info.vin, seller: info.dealer && info.dealer.name ? 'dealer' : 'private',
        damaged: false, photos: info.photoData && info.photoData.count,
      });
    },
    async fetchLive(p) {
      if (!p.cf_apiKey) throw new Error('AUTO.RIA потребує api_key (безкоштовний ключ: developer.ria.com)');
      const sres = await fetch(this.buildSearchUrl(p)).then((r) => r.json());
      const ids = (sres.result && sres.result.search_result && sres.result.search_result.ids) || [];
      const out = [];
      for (const id of ids.slice(0, p.cf_topN || 20)) {
        const info = await fetch(`https://developer.ria.com/auto/info?api_key=${p.cf_apiKey}&auto_id=${id}`).then((r) => r.json());
        out.push(this.normalizeInfo(info));
      }
      return out;
    },
  },
  /* mobile.de — the official API needs seller credentials (Basic auth); public
   * scraping is blocked and against ToS. Wire real access through a provider
   * function p.cf_providers.mobilede(params) → array of raw listings; this
   * adapter just normalizes whatever it returns. */
  mobilede: {
    id: 'mobilede', label: 'mobile.de (Europe)',
    normalizeAd(ad) { return cfNormalize(Object.assign({ source: 'mobilede', region: 'EU', imported: true }, ad)); },
    async fetchLive(p) {
      const prov = p.cf_providers && p.cf_providers.mobilede;
      if (!prov) throw new Error('mobile.de: підключіть p.cf_providers.mobilede(params) (офіційний API з обліковим записом продавця) або вставте лістинги вручну');
      const ads = await prov(p);
      return ads.map((a) => this.normalizeAd(a));
    },
  },
};

async function findCarsLive(p) {
  const src = CF_SOURCES[p.cf_source] || CF_SOURCES.autoria;
  let listings = await src.fetchLive(p);
  // optional AI enrichment before scoring
  if (p.cf_providers && p.cf_providers.ai) {
    for (const l of listings) {
      try { l.aiVerdict = await p.cf_providers.ai(cfAiPrompt(l, p)); } catch (e) { /* leave heuristic */ }
    }
  }
  return findCars(p, listings);
}

/* ---------- a small offline sample so the tab works with no network ----------
 * Realistic-ish mid-2026 listings across UA and EU sources. */
const CF_SAMPLE_LISTINGS = [
  { source: 'autoria', title: 'Tesla Model 3 2020', make: 'Tesla', model: 'Model 3', year: 2020, price: 20500, currency: 'USD', mileage: 78000, country: 'US', region: 'US', fuel: 'EV', gearbox: 'auto', bodyType: 'sedan', vin: '5YJ3E1EA5LF000111', seller: 'dealer', damaged: false, photos: 12, url: 'https://auto.ria.com/uk/auto_tesla_model_3_1.html', history: { accidents: 1, registeredInRegistry: true } },
  { source: 'mobilede', title: 'Tesla Model 3 2021 (DE)', make: 'Tesla', model: 'Model 3', year: 2021, price: 24500, currency: 'USD', mileage: 61000, country: 'DE', region: 'EU', fuel: 'EV', gearbox: 'auto', bodyType: 'sedan', vin: 'LRW3E7EK5MC000222', seller: 'dealer', damaged: false, photos: 15, url: 'https://www.mobile.de/1', history: { accidents: 0, registeredInRegistry: true } },
  { source: 'autoria', title: 'Tesla Model 3 2019 (битая)', make: 'Tesla', model: 'Model 3', year: 2019, price: 12500, currency: 'USD', mileage: 95000, country: 'US', region: 'US', fuel: 'EV', gearbox: 'auto', bodyType: 'sedan', vin: '', seller: 'private', damaged: true, damageType: 'front', photos: 6, url: 'https://auto.ria.com/uk/auto_tesla_model_3_2.html', history: { accidents: 2 } },
  { source: 'mobilede', title: 'VW Golf 7 2018 (DE)', make: 'Volkswagen', model: 'Golf', year: 2018, price: 11500, currency: 'USD', mileage: 120000, country: 'DE', region: 'EU', fuel: 'diesel', gearbox: 'manual', bodyType: 'hatchback', vin: 'WVWZZZAUZJW000333', seller: 'private', damaged: false, photos: 9, url: 'https://www.mobile.de/2', history: { accidents: 0, registeredInRegistry: true } },
  { source: 'autoria', title: 'VW Golf 7 2017', make: 'Volkswagen', model: 'Golf', year: 2017, price: 10200, currency: 'USD', mileage: 145000, country: 'UA', region: 'UA', fuel: 'petrol', gearbox: 'auto', bodyType: 'hatchback', vin: 'WVWZZZAUZHW000444', seller: 'dealer', damaged: false, photos: 11, url: 'https://auto.ria.com/uk/auto_vw_golf_1.html', history: { accidents: 0, odometerRollback: true, lastKnownKm: 190000 } },
  { source: 'autoria', title: 'Skoda Octavia A7 2019', make: 'Skoda', model: 'Octavia', year: 2019, price: 13900, currency: 'USD', mileage: 98000, country: 'UA', region: 'UA', fuel: 'diesel', gearbox: 'auto', bodyType: 'liftback', vin: 'TMBAG7NE0K0000555', seller: 'private', damaged: false, photos: 14, url: 'https://auto.ria.com/uk/auto_skoda_octavia_1.html', history: { accidents: 0, registeredInRegistry: true } },
  { source: 'mobilede', title: 'Skoda Octavia 2020 (PL)', make: 'Skoda', model: 'Octavia', year: 2020, price: 15200, currency: 'USD', mileage: 85000, country: 'PL', region: 'EU', fuel: 'diesel', gearbox: 'auto', bodyType: 'liftback', vin: 'TMBAG7NE0L0000666', seller: 'dealer', damaged: false, photos: 10, url: 'https://www.mobile.de/3', history: { accidents: 0 } },
  { source: 'autoria', title: 'Skoda Octavia 2018 (подозрительно дёшево)', make: 'Skoda', model: 'Octavia', year: 2018, price: 6800, currency: 'USD', mileage: 210000, country: 'UA', region: 'UA', fuel: 'diesel', gearbox: 'manual', bodyType: 'liftback', vin: '', seller: 'private', damaged: false, photos: 3, url: 'https://auto.ria.com/uk/auto_skoda_octavia_2.html', history: {} },
  { source: 'mobilede', title: 'BMW 320d 2019 (DE)', make: 'BMW', model: '320', year: 2019, price: 21000, currency: 'USD', mileage: 105000, country: 'DE', region: 'EU', fuel: 'diesel', gearbox: 'auto', bodyType: 'sedan', vin: 'WBA5E70000K000777', seller: 'dealer', damaged: false, photos: 16, url: 'https://www.mobile.de/4', history: { accidents: 0, registeredInRegistry: true } },
  { source: 'autoria', title: 'BMW 320i 2018 (залив)', make: 'BMW', model: '320', year: 2018, price: 13000, currency: 'USD', mileage: 130000, country: 'US', region: 'US', fuel: 'petrol', gearbox: 'auto', bodyType: 'sedan', vin: 'WBA8E90000K000888', seller: 'private', damaged: true, damageType: 'flood', photos: 8, url: 'https://auto.ria.com/uk/auto_bmw_320_1.html', history: { accidents: 1 } },
];

/* Node export (cli.js uses the browser-style global binding via vm instead). */
if (typeof module !== 'undefined') {
  module.exports = {
    findCars, findCarsLive, cfSummarize, cfNormalize, cfParseRules, cfEval, cfParse,
    cfTokenize, cfMarketStats, CF_CHECKS, CF_SOURCES, CF_BUILTIN_RULES, CF_SAMPLE_LISTINGS,
    CF_REGION_OF, cfAiPrompt,
  };
}
