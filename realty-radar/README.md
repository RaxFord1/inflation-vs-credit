# 🏠 Realty Radar

Збирач нових оголошень про нерухомість в Україні по обраних містах з **DOM.RIA**,
**Prozorro.Sale** (аукціони), **OLX** та **LUN/Rieltor**, з:

- **дедуплікацією** одного й того самого обʼєкта між сайтами (і показом, де дешевше);
- **оцінкою угоди нейромережею** (OpenAI `gpt-4o-mini`, аналіз тексту **і фотографій**);
- **нотифаєром у Telegram** — тільки про справді цікаві пропозиції;
- **веб-інтерфейсом** з фільтрами (тип / призначення / місто / джерело / ціна / оцінка).

ШІ **легкий**: алгоритм сам збирає й нормалізує дані, рахує дешевий `pre-score`, і лише
відібрані оголошення передає нейромережі на оцінку — щоб економити токени.

Землю **сільськогосподарського** призначення (ферма/аграрка/город/ОСГ/пай) відсіяно за замовчуванням.

---

## Що всередині (архітектура)

```
збір (по джерелах × містах)
  DOM.RIA (офіц. API)  Prozorro (відкрите API)  OLX (JSON фронтенду)  LUN (HTML/JSON-LD)
        │
   нормалізація до єдиної схеми  → фільтри інтересу → pre-score (ціна/м² vs медіана міста)
        │
   SQLite (node:sqlite, без нативних збірок)
        │
   дедуплікація між джерелами (площа ± / ціна ±% / адреса / геокоордината)
        │
   оцінка ШІ (gpt-4o-mini: текст + до 4 фото, low-detail) — тільки для pre-score ≥ порогу
        │
   ┌─────────────┬──────────────────────┐
   Telegram-нотифаєр      Веб-UI з фільтрами
```

Модулі: `src/sources/*` — джерела; `src/util/*` — http (анти-блок), нормалізація,
фільтри, дедуп, курс НБУ; `src/db/*` — сховище й запити; `src/ai/*` — оцінка;
`src/notify/telegram.js` — сповіщення + бот-команди; `src/pipeline/*` — оркестратор і планувальник;
`src/web/*` — API та UI.

---

## Швидкий старт

Потрібен **Node.js ≥ 22.5** (використовується вбудований `node:sqlite`, тож нічого компілювати не треба).

```bash
cd realty-radar
npm install            # ставить express, node-cron, cheerio (нативних збірок нема)
npm run init           # створить config/config.json і .env з прикладів
```

Далі заповни **`.env`** (ключі):

| Змінна | Навіщо | Де взяти |
|---|---|---|
| `OPENAI_API_KEY` | оцінка угод + фото (`gpt-4o-mini`) | platform.openai.com |
| `DOMRIA_API_KEY` | офіційне API DOM.RIA | https://developers.ria.com/ (реєстрація → кабінет → API key, безкоштовно) |
| `TELEGRAM_BOT_TOKEN` | бот-нотифаєр | @BotFather у Telegram |
| `TELEGRAM_CHAT_ID` | куди слати | напиши боту, відкрий `https://api.telegram.org/bot<TOKEN>/getUpdates` → `chat.id` |

І відредагуй **`config/config.json`** (міста, ціни, фільтри — див. нижче). Запуск:

```bash
npm start           # повний режим: планувальник + веб-UI + телеграм-бот
# або:
npm run collect     # один прогін (збір+оцінка+сповіщення) і вихід — зручно для перевірки
npm run web         # лише веб-UI (перегляд бази), без збору
```

Веб-інтерфейс: **http://127.0.0.1:8787**

---

## Налаштування міст

Кожне місто в `config.json → cities[]`:

```json
{
  "name": "Львів",
  "domria": { "state_id": 5, "city_id": 10 },
  "prozorroRegion": "Львівська область",
  "olxSearchUrls": [
    "https://www.olx.ua/uk/nedvizhimost/kvartiry/prodazha-kvartir/lvov/",
    "https://www.olx.ua/uk/nedvizhimost/doma/prodazha-domov/lvov/"
  ],
  "lunUrls": [],
  "priceUSD": { "min": 20000, "max": 150000 }
}
```

Як дізнатись ID/URL:

- **DOM.RIA** `state_id` / `city_id`:
  ```bash
  npm run discover:domria            # список областей (state_id)
  npm run discover:domria -- 5       # міста області 5 (city_id)
  ```
- **OLX** — просто відкрий сайт, обери місто/розділ/фільтри, і встав URL зі стрічки браузера
  у `olxSearchUrls`. Перевірити, що резолвиться:
  ```bash
  npm run discover:olx -- "https://www.olx.ua/uk/nedvizhimost/kvartiry/prodazha-kvartir/lvov/"
  ```
- **Prozorro** — досить назви області в `prozorroRegion` (стрічка тягнеться цілком і фільтрується локально).
- **LUN** — встав URL сторінки пошуку у `lunUrls` (джерело вимкнене за замовчуванням).

---

## Фільтри інтересу (`config.json → filters`)

- `propertyTypes`: `apartment`, `house`, `commercial`, `land` (+`room`, `garage`)
- `purpose`: `residential` (житлове) / `commercial` (комерційне)
- `priceUSD.min/max`, `areaSqm`, `landAreaSotka`, `rooms`, `yearBuilt`
- `excludeKeywords` / `requireKeywords`
- `excludeLandUse` — фрази, що відсіюють с/г землю (вже заповнено)

Фільтри можна змінювати **прямо у веб-UI** і зберегти кнопкою «💾 Зберегти як пороги інтересу» —
вони запишуться у `config.json` і збирач використає їх для відбору й сповіщень.

---

## Оцінка ШІ (`config.json → ai`)

- `onlyEvaluateAbovePreScore` — ШІ викликається лише коли алгоритмічний pre-score ≥ цього (економія).
- `analyzePhotos` + `maxPhotosPerListing` — скільки фото віддавати (детал `low` = дешево).
- `minAiScoreToNotify` — від якої оцінки слати в Telegram.
- `dailyBudgetCalls` — стеля викликів ШІ на добу.

ШІ повертає: `score` (0–100), короткий вердикт, оцінку ціни (нижче ринку / ринкова / завищена /
підозріло низька), стан за фото та червоні прапорці.

---

## Telegram

Команди боту (пише лише власнику з `TELEGRAM_CHAT_ID`):

- `/stats` — статистика бази
- `/deals` — топ поточних угод
- `/run` — позачерговий збір зараз
- `/pause` / `/resume` — пауза/відновлення
- «тихі години» (`notify.telegram.quietHours`) відкладають сповіщення на ніч.

---

## Щоб не заблокували за скрапінг

Реалізовано у `src/util/http.js` та `config.json → politeness`:

- **ротація User-Agent** і Accept-Language;
- **послідовна черга на домен** (1 запит за раз) + **людиноподібні паузи** 2.5–7 с (налаштовується);
- **jitter** перед кожним плановим збором (випадкова затримка до кількох хвилин);
- **експоненційний backoff** при `429/403`, повага до `Retry-After`;
- підтримка **проксі** через `HTTP_PROXY` у `.env`;
- помірна частота збору (`schedule.collectCron`, за замовчуванням раз на 30 хв — не став частіше без потреби).

> DOM.RIA і Prozorro мають **офіційні/відкриті API** — це найбезпечніший шлях, для них скрапінг не потрібен.
> OLX/LUN — акуратний доступ до їхніх же JSON/HTML; тримай ввічливі паузи.
> За потреби для OLX/LUN можна увімкнути браузерний фолбек на Playwright:
> `npm install playwright && npx playwright install chromium`, потім `sources.olx.useBrowserFallback=true`.

---

## Розгортання на сервері (пізніше)

```bash
docker compose up -d --build      # веб-UI на 127.0.0.1:8787, БД у ./data, конфіг у ./config
docker compose logs -f
```

`config/` і `data/` змонтовані томами — зміни конфіг без перезбірки. Для доступу до UI ззовні
прибери `127.0.0.1` у `docker-compose.yml` і постав реверс-проксі з паролем.

---

## Важливі зауваги

- **Ключі DOM.RIA/OpenAI/Telegram** тримаються у `.env` (у git не потрапляють).
- Структура відповідей **OLX/DOM.RIA/Prozorro** може змінюватись. Парсери написані захищено
  (не падають, лише лог-ворнінг), але якщо якесь поле раптом порожнє — перевір `discover`-скрипти
  й за потреби підправ відповідний файл у `src/sources/`. Базові URL Prozorro можна перевизначити
  у `config.sources.prozorro.baseUrl`.
- Це інструмент моніторингу для особистого використання. Дотримуйся Terms of Service сайтів
  і розумного навантаження.

---

MIT.
