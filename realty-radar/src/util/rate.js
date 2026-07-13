// Актуальний курс USD/UAH з відкритого API НБУ (без ключа).
let cache = { rate: null, at: 0 };

export async function fetchNbuRate() {
  if (cache.rate && Date.now() - cache.at < 6 * 3600 * 1000) return cache.rate;
  const url = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json';
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`НБУ ${res.status}`);
  const data = await res.json();
  const rate = data?.[0]?.rate;
  if (rate) { cache = { rate, at: Date.now() }; return rate; }
  throw new Error('НБУ: нема курсу');
}
