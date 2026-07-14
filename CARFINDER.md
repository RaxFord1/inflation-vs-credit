# Модуль підбору й перевірки авто (`find`)

Пошук найкращих варіантів «ціна/якість» серед оголошень з України та Європи.
Кожне авто проходить конвеєр, у якому **кожен крок описується текстом** —
фільтри, правила, перевірки, ваги оцінки. Усе ядро — чисті функції в
`carfinder.js` (без DOM і залежностей); той самий код працює у вкладці UI, у
`cli.js` та через `LDM.run('find', …)`.

## Конвеєр

```
оголошення → cfNormalize → фільтри → правила (DSL) → перевірки → оцінка 0–100 → рейтинг
```

1. **Нормалізація** (`cfNormalize`) зводить будь-яке джерело до єдиної форми
   (ціна → USD, країна → регіон UA/EU/US/OTHER, тип пошкодження тощо). Відсутні
   поля допускаються — перевірки просто позначать те, що не змогли підтвердити.
2. **Фільтри** — жорсткі відсікання (марка, модель, рік, ціна, пробіг, регіон,
   паливо, КПП, кузов). Порожнє / `0` / `any` = «не фільтрувати».
3. **Правила** — ваша логіка текстом (див. нижче). Дії: `reject`, `warn`,
   `boost N`, `penalize N`.
4. **Перевірки** (`CF_CHECKS`) — VIN/реєстр, історія (ДТП, скрутка пробігу,
   власники), тип пошкоджень, AI-відповідність. Кожна повертає
   `{status, score, findings}`.
5. **Оцінка** — зважена сума: ціна-до-ринку, пробіг-за-вік, вік, стан, історія.
   Ваги `cf_w_*` нормалізуються автоматично.

Результат: `results` (топ-N з балами й прапорцями), `rejected` (з причинами),
`marketStats`, `kpis`, `ruleErrors`.

## Правила — логіка текстом

Один рядок = одне правило:

```
<дія>[ N]: <умова>            # причина
```

```text
reject: make = Tesla and region != EU        # Tesla — тільки європейка
reject: damaged and damageType not in [front, rear]   # лише легкий перед/зад
warn:   priceUSD < market * 0.6               # підозріло дешево
warn:   vin = "" and seller = dealer          # дилер без VIN — нічого перевірити
boost 12: fuel = EV                            # надаємо перевагу електро
penalize 8: titleStatus in [salvage, rebuilt] # відновлений тайтл
```

**Поля:** `make model year priceUSD mileageKm region country fuel gearbox
bodyType vin seller titleStatus damaged damageType ownersCount photos` та
похідні `market` (медіана ціни моделі), `kmPerYear`, `age`.
**Оператори:** `= != < > <= >=`, `and or not`, `in / not in [a, b]`,
арифметика `+ - * /`. Слова без лапок — це рядки (`region != EU`, `fuel = EV`).
Помилковий рядок потрапляє в `ruleErrors`, а не ламає підбір.

Вбудовані правила (вимикач `cf_useBuiltinRules`) лежать у `CF_BUILTIN_RULES` —
їх можна прочитати, скопіювати чи перевизначити своїми.

## Додати перевірку (check-модуль)

Кожна перевірка — маленький об'єкт у масиві `CF_CHECKS`:

```js
CF_CHECKS.push({
  id: 'service',
  label: 'Сервісна історія',
  desc: 'Наявність записів ТО. Провайдер: ctx.providers.service(vin).',
  run(listing, ctx) {
    const h = listing.history || {};
    if (h.serviceRecords == null) return { status: 'skip', score: 60, findings: ['немає даних ТО'] };
    return h.serviceRecords >= 3
      ? { status: 'ok',   score: 90, findings: [`записів ТО: ${h.serviceRecords}`] }
      : { status: 'warn', score: 55, findings: ['мало записів ТО'] };
  },
});
```

`status ∈ ok | warn | fail | skip`. Будь-яка перевірка зі `status: 'fail'`
додає прапорець до авто; `vin` і `history` також живлять оцінку історії.

## Реальні реєстри та ІІ — провайдери

Перевірки за замовчуванням працюють на прозорих евристиках. Реальні джерела
підключаються через `p.cf_providers` (у браузері / Node, не в CLI-формі
`key=value`):

```js
const p = {
  cf_make: 'Tesla', cf_source: 'autoria', cf_apiKey: 'KEY',
  cf_providers: {
    registry: async (vin) => fetch(`/registry?vin=${vin}`).then(r => r.json()),
    history:  async (vin) => carVertical(vin),        // ваш API історії
    ai:       async (prompt) => askLLM(prompt),        // {score, verdict, notes}
    mobilede: async (params) => searchMobileDe(params),// офіційний API mobile.de
  },
};
const res = await findCarsLive(p);   // фетч → (опц.) AI-збагачення → findCars
```

Провайдери викликаються у `findCarsLive` до оцінки, а їхні результати
кладуться в `listing.history` / `listing.aiVerdict`, які й читають перевірки.
Без AI-провайдера кожне авто все одно несе готовий `aiPrompt` — його можна
надіслати в LLM вручну.

## Додати джерело

`CF_SOURCES[id] = { id, label, fetchLive(p) → [raw…], normalize… }`. Уже є:

- **autoria** — офіційний API `developer.ria.com` (потрібен безкоштовний
  `cf_apiKey`): пошук → id → інфо по кожному.
- **mobilede** — офіційний API вимагає облікового запису продавця; підключіть
  `cf_providers.mobilede(params)`, адаптер лише нормалізує відповідь.

> У браузері живі запити часто блокує CORS. Тоді запускайте
> `node cli.js find --live …` або вставляйте оголошення JSON-ом у полі вкладки.

## Запуск

```bash
node cli.js find make=Tesla priceMaxUSD=30000 region=EU      # демо-набір, офлайн
node cli.js find make=any --listings=my.json                  # свій JSON
node cli.js find source=autoria apiKey=KEY make=Tesla --live  # живий пошук
```

Тести: `node test_carfinder.js` (ядро), `node test_dom.js` (вкладка у jsdom).
