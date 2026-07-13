// Застосування користувацьких фільтрів інтересу до нормалізованого оголошення.
// Повертає { pass: bool, reasons: [..] } — reasons пояснюють чому відсіяно.

export function passesFilters(listing, cfg, cityOverride = null) {
  const f = cfg.filters;
  const price = { ...f.priceUSD, ...(cityOverride?.priceUSD || {}) };
  const reasons = [];

  // тип нерухомості
  if (f.propertyTypes?.length && !f.propertyTypes.includes(listing.propertyType)) {
    reasons.push(`тип ${listing.propertyType} не в списку`);
  }

  // призначення
  if (f.purpose?.length && listing.purpose && !f.purpose.includes(listing.purpose)) {
    reasons.push(`призначення ${listing.purpose} не в списку`);
  }

  // земля с/г — жорстко відсіюємо
  if (listing.propertyType === 'land') {
    const blob = `${listing.title} ${listing.description} ${listing.landUse || ''}`.toLowerCase();
    if (listing.landUse === 'agricultural') reasons.push('земля с/г призначення');
    for (const kw of f.excludeLandUse || []) {
      if (kw && blob.includes(kw.toLowerCase())) { reasons.push(`землекористування виключено: "${kw}"`); break; }
    }
  }

  // ціна
  if (listing.priceUSD != null) {
    if (price.min != null && listing.priceUSD < price.min) reasons.push(`ціна $${listing.priceUSD} < min $${price.min}`);
    if (price.max != null && listing.priceUSD > price.max) reasons.push(`ціна $${listing.priceUSD} > max $${price.max}`);
  }

  // площа
  if (f.areaSqm && listing.areaSqm != null) {
    if (f.areaSqm.min != null && listing.areaSqm < f.areaSqm.min) reasons.push(`площа ${listing.areaSqm}м² < min`);
    if (f.areaSqm.max != null && listing.areaSqm > f.areaSqm.max) reasons.push(`площа ${listing.areaSqm}м² > max`);
  }

  // сотки (для землі/будинку)
  if (f.landAreaSotka && listing.landSotka != null) {
    if (f.landAreaSotka.min != null && listing.landSotka < f.landAreaSotka.min) reasons.push(`ділянка ${listing.landSotka}сот < min`);
    if (f.landAreaSotka.max != null && listing.landSotka > f.landAreaSotka.max) reasons.push(`ділянка ${listing.landSotka}сот > max`);
  }

  // кімнати
  if (f.rooms && listing.rooms != null && listing.propertyType !== 'land' && listing.propertyType !== 'commercial') {
    if (f.rooms.min != null && listing.rooms < f.rooms.min) reasons.push(`кімнат ${listing.rooms} < min`);
    if (f.rooms.max != null && listing.rooms > f.rooms.max) reasons.push(`кімнат ${listing.rooms} > max`);
  }

  // рік
  if (f.yearBuilt && listing.yearBuilt != null) {
    if (f.yearBuilt.min != null && listing.yearBuilt < f.yearBuilt.min) reasons.push(`рік ${listing.yearBuilt} < min`);
    if (f.yearBuilt.max != null && listing.yearBuilt > f.yearBuilt.max) reasons.push(`рік ${listing.yearBuilt} > max`);
  }

  // ключові слова
  const blob = `${listing.title} ${listing.description}`.toLowerCase();
  for (const kw of f.excludeKeywords || []) {
    if (kw && blob.includes(kw.toLowerCase())) { reasons.push(`стоп-слово: "${kw}"`); break; }
  }
  for (const kw of f.requireKeywords || []) {
    if (kw && !blob.includes(kw.toLowerCase())) { reasons.push(`нема обовʼязкового слова: "${kw}"`); break; }
  }

  return { pass: reasons.length === 0, reasons };
}

/**
 * Дешевий алгоритмічний pre-score 0..100 (без ШІ).
 * Основа — наскільки ціна за м² нижча за медіану по цьому місту+типу.
 * medianPricePerSqm може бути null (тоді score базується лише на нижній частині діапазону).
 */
export function preScore(listing, cfg, medianPricePerSqm) {
  let score = 50;
  const price = cfg.filters.priceUSD || {};

  if (listing.pricePerSqmUSD && medianPricePerSqm) {
    const ratio = listing.pricePerSqmUSD / medianPricePerSqm; // <1 = дешевше за медіану
    // 0.6 медіани -> +40; 1.0 -> 0; 1.4 -> -30
    score += Math.max(-30, Math.min(45, Math.round((1 - ratio) * 90)));
  } else if (listing.priceUSD != null && price.min != null && price.max != null) {
    const pos = (listing.priceUSD - price.min) / Math.max(1, price.max - price.min);
    score += Math.round((0.5 - pos) * 40); // ближче до min -> вище
  }

  if (listing.isAuction) score += 8; // аукціони часто нижче ринку
  if ((listing.photos?.length || 0) >= 3) score += 4;
  if (listing.description && listing.description.length > 200) score += 3;
  // свіжість
  if (listing.publishedAt) {
    const ageH = (Date.now() - new Date(listing.publishedAt).getTime()) / 3.6e6;
    if (ageH < 24) score += 6; else if (ageH < 72) score += 3;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}
