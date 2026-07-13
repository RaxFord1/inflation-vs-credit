// Інтерфейс джерела. Кожне джерело експортує:
//   name: string
//   enabled(cfg): bool
//   async collect(cfg, ctx): AsyncGenerator<listing> | listing[]
// listing — сирий об'єкт, який далі проходить enrich() + filters.
//
// ctx = { log, city?  }  (city передається коли ітеруємо по містах)

export function propertyTypeToDomriaCategory(pt) {
  // 1=квартири, 4=будинки, 13=офіси, 10=комерція, 24=земля, 30=гаражі
  return { apartment: 1, house: 4, commercial: 10, land: 24, garage: 30, room: 1 }[pt] || null;
}
