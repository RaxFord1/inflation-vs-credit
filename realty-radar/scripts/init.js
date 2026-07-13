// Створює config/config.json з прикладу та .env з .env.example (якщо їх ще нема).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function copyIfMissing(from, to) {
  const src = path.join(root, from), dst = path.join(root, to);
  if (fs.existsSync(dst)) { console.log(`= ${to} вже існує — пропускаю`); return; }
  fs.copyFileSync(src, dst);
  console.log(`+ створено ${to}`);
}
copyIfMissing('config/config.example.json', 'config/config.json');
copyIfMissing('.env.example', '.env');
console.log('\nГотово. Тепер:\n 1) впиши ключі у .env (OPENAI_API_KEY, DOMRIA_API_KEY, TELEGRAM_*)\n 2) відредагуй config/config.json (міста, фільтри)\n 3) node src/index.js');
