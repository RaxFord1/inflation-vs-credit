// Промпти для оцінки угоди. ШІ отримує ВЖЕ зібрані алгоритмом дані — сам нічого не скрапить.
export const SYSTEM = `Ти — досвідчений експерт з нерухомості в Україні та інвестор-оцінювач.
Тобі дають ОДНЕ оголошення (дані вже зібрані та нормалізовані) і, за наявності, фото.
Твоя задача — оцінити, наскільки це ВИГІДНА пропозиція для покупця/інвестора відносно ринку,
і чи варто звернути на неї увагу зараз.

Критерії:
- ціна за м² відносно медіани по місту/району (тобі дають медіану, якщо відома);
- співвідношення ціни й характеристик (площа, кімнати, стан за фото, поверх, рік);
- стан обʼєкта за фотографіями (ремонт, зношеність, будматеріали, планування, вид);
- локація/район (якщо видно з даних);
- ризики та червоні прапорці (замало інфо, підозріло низька ціна = можливий підвох,
  проблемна документація для аукціонів, аварійний стан, застава тощо).

Оцінюй тверезо: занижена ціна без причини — це РИЗИК, а не одразу подарунок.
Відповідай СТИСЛО й лише валідним JSON.`;

export function buildUserContent(listing, medianPricePerSqm, cfg) {
  const facts = {
    тип: listing.propertyType,
    призначення: listing.purpose,
    ціна_USD: listing.priceUSD,
    ціна_за_м2_USD: listing.pricePerSqmUSD,
    медіана_за_м2_USD_по_місту: medianPricePerSqm || 'невідома',
    площа_м2: listing.areaSqm,
    ділянка_сотки: listing.landSotka,
    кімнат: listing.rooms,
    поверх: listing.floor,
    поверхів: listing.floors,
    рік: listing.yearBuilt,
    матеріал_стін: listing.wallType,
    місто: listing.city,
    район: listing.district,
    аукціон: listing.isAuction,
    джерело: listing.source,
    заголовок: listing.title,
    опис: (listing.description || '').slice(0, 900),
  };
  const budget = cfg.filters?.priceUSD || {};
  const text =
`Оціни цю пропозицію. Бюджет інтересу користувача: $${budget.min ?? '?'}–$${budget.max ?? '?'}.

ДАНІ (JSON):
${JSON.stringify(facts, null, 1)}

Поверни СТРОГО такий JSON без пояснень навколо:
{
  "score": <ціле 0-100, наскільки варта уваги угода>,
  "verdict": "<1-2 речення українською: чому саме така оцінка>",
  "condition": "<стан за фото: новий/добрий/потребує ремонту/поганий/невідомо>",
  "priceAssessment": "<нижче ринку | ринкова | завищена | підозріло низька>",
  "flags": ["<короткі червоні прапорці, якщо є>"],
  "highlights": ["<сильні сторони, якщо є>"]
}`;
  return text;
}

export function buildMessages(listing, medianPricePerSqm, cfg) {
  const content = [{ type: 'text', text: buildUserContent(listing, medianPricePerSqm, cfg) }];
  if (cfg.ai?.analyzePhotos && listing.photos?.length) {
    for (const url of listing.photos.slice(0, cfg.ai.maxPhotosPerListing || 4)) {
      content.push({ type: 'image_url', image_url: { url, detail: 'low' } }); // low = дешево, легко
    }
  }
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content },
  ];
}
