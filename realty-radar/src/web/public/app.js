// Realty Radar UI
const $ = (s) => document.querySelector(s);
const state = { type: 'all', purpose: 'all' };

const TYPE_LABEL = { apartment: 'Квартира', house: 'Будинок', commercial: 'Комерція', land: 'Земля', room: 'Кімната', garage: 'Гараж', unknown: '—' };

function chipGroup(id, key) {
  document.querySelectorAll(`#${id} .chip`).forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${id} .chip`).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state[key] = btn.dataset.v;
      load();
    });
  });
}

function money(n) { return n == null ? '—' : '$' + Number(n).toLocaleString('uk-UA'); }
function scoreClass(s) { if (s == null) return 'slow'; if (s >= 85) return 's85'; if (s >= 75) return 's75'; if (s >= 65) return 's65'; return 'slow'; }

function card(l) {
  const el = document.createElement('div');
  el.className = 'card';
  const photo = l.photos && l.photos[0];
  const specs = [];
  if (l.areaSqm) specs.push(`${l.areaSqm} м²`);
  if (l.landSotka) specs.push(`${l.landSotka} сот`);
  if (l.rooms) specs.push(`${l.rooms} кімн`);
  if (l.floor) specs.push(`пов.${l.floor}${l.floors ? '/' + l.floors : ''}`);
  const sc = l.aiScore != null ? l.aiScore : '·';
  el.innerHTML = `
    <div class="photo" style="${photo ? `background-image:url('${photo}')` : ''}">
      ${photo ? '' : '<div class="noimg">без фото</div>'}
      <div class="badge ${scoreClass(l.aiScore)}">${sc}</div>
      ${l.isAuction ? '<div class="tag auc">🔨 аукціон</div>' : `<div class="tag">${l.source}</div>`}
      ${l.cheaperElsewhere ? `<div class="dup">🔁 є на ${(l.alternatives?.length||0)+1} сайтах</div>` : ''}
    </div>
    <div class="body">
      <div class="price">${money(l.priceUSD)}<span class="psqm">${l.pricePerSqmUSD ? l.pricePerSqmUSD + ' $/м²' : ''}</span></div>
      <div class="specs">${TYPE_LABEL[l.propertyType] || l.propertyType} · ${specs.join(' · ') || '—'}</div>
      <div class="loc">📍 ${[l.city, l.district].filter(Boolean).join(', ') || '—'}</div>
      ${l.aiVerdict ? `<div class="verdict">🧠 ${l.aiVerdict}</div>` : ''}
      ${l.aiFlags && l.aiFlags.length ? `<div class="flags">⚠️ ${l.aiFlags.join('; ')}</div>` : ''}
    </div>`;
  el.addEventListener('click', () => openModal(l.uid));
  return el;
}

async function load() {
  $('#loading').classList.add('on');
  const q = new URLSearchParams();
  if (state.type !== 'all') q.set('propertyType', state.type);
  if (state.purpose !== 'all') q.set('purpose', state.purpose);
  const city = $('#fCity').value; if (city !== 'all') q.set('city', city);
  const src = $('#fSource').value; if (src !== 'all') q.set('source', src);
  if ($('#fPriceMin').value) q.set('priceMin', $('#fPriceMin').value);
  if ($('#fPriceMax').value) q.set('priceMax', $('#fPriceMax').value);
  if (+$('#fScore').value > 0) q.set('minAiScore', $('#fScore').value);
  if ($('#fDeals').checked) q.set('onlyDeals', 'true');
  q.set('groupDuplicates', $('#fGroup').checked ? 'true' : 'false');
  q.set('sort', $('#fSort').value);

  const res = await fetch('/api/listings?' + q.toString());
  const data = await res.json();
  const cards = $('#cards'); cards.innerHTML = '';
  data.items.forEach((l) => cards.appendChild(card(l)));
  $('#count').textContent = `${data.count} обʼєктів`;
  $('#loading').classList.remove('on');
}

async function openModal(uid) {
  const res = await fetch('/api/listing/' + uid);
  const l = await res.json();
  const alts = (l.alternatives || []).map((a) => `<a href="${a.url}" target="_blank">${a.source}: ${money(a.priceUSD)}</a>`).join('');
  const gallery = (l.photos || []).map((p) => `<img src="${p}" loading="lazy">`).join('');
  $('#modalInner').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
      <h2 style="margin:0">${money(l.priceUSD)} — ${TYPE_LABEL[l.propertyType] || l.propertyType}</h2>
      <button class="btn" onclick="document.getElementById('modal').classList.add('hidden')">✕</button>
    </div>
    <p class="loc">📍 ${[l.city, l.district, l.street].filter(Boolean).join(', ') || '—'}</p>
    <p><b>${l.title || ''}</b></p>
    ${l.aiScore != null ? `<p>🧠 <b>Оцінка ШІ: ${l.aiScore}/100</b> — ${l.aiVerdict || ''}</p>` : ''}
    ${l.aiFlags && l.aiFlags.length ? `<p class="flags">⚠️ ${l.aiFlags.join('; ')}</p>` : ''}
    <p class="specs">${[l.areaSqm && l.areaSqm+' м²', l.landSotka && l.landSotka+' сот', l.rooms && l.rooms+' кімн', l.floor && 'поверх '+l.floor, l.yearBuilt && l.yearBuilt+' р.', l.wallType].filter(Boolean).join(' · ')}</p>
    ${alts ? `<div class="altlist"><b>🔁 Той самий обʼєкт дешевше/на інших сайтах:</b>${alts}</div>` : ''}
    <p><a class="btn primary" href="${l.url}" target="_blank">Відкрити оголошення ↗</a></p>
    <div class="gallery">${gallery}</div>
    <details style="margin-top:10px"><summary>Опис</summary><p style="white-space:pre-wrap;color:#c9d3df">${(l.description||'').slice(0,2000)}</p></details>`;
  $('#modal').classList.remove('hidden');
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') e.currentTarget.classList.add('hidden'); });

async function loadStats() {
  const s = await (await fetch('/api/stats')).json();
  $('#statbar').innerHTML = `Активних: <b>${s.total}</b> · Угод: <b>${s.deals}</b> · Дублі-групи: <b>${s.dupGroups}</b>`;
  const sel = $('#fCity');
  const cur = sel.value;
  sel.innerHTML = '<option value="all">Усі міста</option>' + s.byCity.map((c) => `<option value="${c.c}">${c.c} (${c.n})</option>`).join('');
  sel.value = cur;
}

async function saveFilters() {
  const body = {
    propertyTypes: state.type === 'all' ? ['apartment','house','commercial','land'] : [state.type],
    purpose: state.purpose === 'all' ? ['residential','commercial'] : [state.purpose],
    priceUSD: { min: $('#fPriceMin').value ? +$('#fPriceMin').value : null, max: $('#fPriceMax').value ? +$('#fPriceMax').value : null },
  };
  const res = await fetch('/api/config/filters', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await res.json();
  $('#runMsg').textContent = d.ok ? '✅ Пороги збережено' : '❌ ' + (d.error || '');
  setTimeout(() => ($('#runMsg').textContent = ''), 3000);
}

$('#fScore').addEventListener('input', (e) => ($('#scoreVal').textContent = e.target.value));
$('#applyBtn').addEventListener('click', load);
['fCity','fSource','fSort','fDeals','fGroup'].forEach((id) => $('#'+id).addEventListener('change', load));
$('#saveFiltersBtn').addEventListener('click', saveFilters);
$('#runBtn').addEventListener('click', async () => {
  $('#runMsg').textContent = 'Запуск…';
  const res = await fetch('/api/run', { method: 'POST' });
  const d = await res.json();
  $('#runMsg').textContent = d.ok ? '🔄 Збір запущено (оновиться за хвилину)' : '⚠️ ' + (d.error || '');
  setTimeout(loadStats, 8000);
});

chipGroup('fType', 'type');
chipGroup('fPurpose', 'purpose');
loadStats();
load();
setInterval(loadStats, 60000);
