// Тонкий адаптер над вбудованим node:sqlite (Node >= 22.5) з інтерфейсом
// у стилі better-sqlite3 (prepare/run/get/all/exec/pragma/transaction).
// Жодних нативних збірок — працює "з коробки" на Windows/Linux/macOS.
import { DatabaseSync } from 'node:sqlite';

function isNamed(args) {
  return args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0]);
}

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  const api = {
    _db: db,
    exec: (sql) => db.exec(sql),
    pragma: (p) => db.exec('PRAGMA ' + p),
    prepare: (sql) => {
      const st = db.prepare(sql);
      return {
        run: (...a) => (isNamed(a) ? st.run(a[0]) : st.run(...a)),
        get: (...a) => (isNamed(a) ? st.get(a[0]) : st.get(...a)),
        all: (...a) => (isNamed(a) ? st.all(a[0]) : st.all(...a)),
      };
    },
    // повертає функцію, що виконує fn у транзакції
    transaction: (fn) => (...a) => {
      db.exec('BEGIN');
      try { const r = fn(...a); db.exec('COMMIT'); return r; }
      catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    },
  };
  return api;
}
