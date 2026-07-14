'use strict';
// Load the real index.html + all scripts in jsdom and exercise the find tab.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(__dirname + '/index.html', 'utf8');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: undefined,
  pretendToBeVisual: true,
  beforeParse(window) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    window.getComputedStyle = window.getComputedStyle || (() => ({ getPropertyValue: () => '#000' }));
  },
});
// jsdom won't fetch external <script src>; inline them manually in order.
const { window } = dom;
const files = ['engine.js', 'defaults.js', 'car.js', 'home.js', 'mort.js',
  'decisions.js', 'life.js', 'business.js', 'carfinder.js', 'app.js'];
// Concatenate so top-level const/function share one scope, as real <script>
// tags do (separate window.eval calls would each get their own scope).
const combined = files.map((f) => fs.readFileSync(__dirname + '/' + f, 'utf8')).join('\n;\n');
window.eval(combined);

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  FAIL:', m); } };
const $ = (id) => window.document.getElementById(id);

// switch to find tab
window.document.querySelector('.tab[data-mode="find"]').click();
ok($('results').classList.contains('finder-only'), 'results in finder-only mode');
ok(!$('finderCard').hidden, 'finderCard visible');
const html1 = $('finderCard').innerHTML;
ok(/Лідер|Нічого/.test(html1), 'verdict rendered');
ok($('finderCard').querySelectorAll('.cf-table .cf-trow').length >= 1, 'table rows rendered');
ok($('finderCard').querySelectorAll('th[data-sort]').length >= 5, 'sortable headers rendered');

// broaden (all makes) so the table has several rows to sort/filter
$('cf_make').value = '';
$('cf_make').dispatchEvent(new window.Event('input', { bubbles: true }));
ok($('finderCard').querySelectorAll('.cf-trow').length >= 3, 'broadened table has several rows');

// sort by price ascending: click price header twice → asc, verify order
// (re-query each time: the table re-renders and detaches the old header node)
$('finderCard').querySelector('th[data-sort="price"]').click(); // default desc for price
$('finderCard').querySelector('th[data-sort="price"]').click(); // toggle to asc
const prices = Array.from($('finderCard').querySelectorAll('.cf-trow')).map((r) =>
  parseInt((r.children[4].textContent.match(/\$([\d\s ]+)/) || [0, '0'])[1].replace(/\s/g, ''), 10));
ok(prices.length >= 2 && prices[0] <= prices[prices.length - 1], 'sort by price ascending works');

// expand a row → score breakdown + checks appear
$('finderCard').querySelector('.cf-exp').click();
ok($('finderCard').querySelectorAll('.cf-check').length >= 4, 'checks shown when row expanded');
ok($('finderCard').querySelector('.cf-explain'), 'score breakdown shown when expanded');
ok(/Підвищує|Знижує/.test($('finderCard').innerHTML), 'verbal score explanation present');

// filter box narrows the table
const before = $('finderCard').querySelectorAll('.cf-trow').length;
const q = $('finderCard').querySelector('.cf-q');
q.value = 'zzznotarealcity';
q.dispatchEvent(new window.Event('input', { bubbles: true }));
const after = $('finderCard').querySelectorAll('.cf-trow').length;
ok(after < before || after === 0, 'text filter narrows the table');
q.value = '';
q.dispatchEvent(new window.Event('input', { bubbles: true }));
ok(/cf-rejected/.test($('finderCard').innerHTML), 'rejected section present');
const items2 = $('finderCard').querySelectorAll('.cf-trow').length;
ok(items2 >= 1, 'table still renders rows after clearing filter (' + items2 + ')');

// switch away and back — financial cards restored
window.document.querySelector('.tab[data-mode="car"]').click();
ok(!$('results').classList.contains('finder-only'), 'left finder mode');
ok($('finderCard').hidden, 'finderCard hidden again');
ok($('verdict').innerHTML.length > 0, 'car verdict renders after leaving finder');

// LDM API
const sum = window.LDM.run('find', { cf_make: 'Tesla' });
ok(sum.mode === 'find' && Array.isArray(sum.results), 'LDM.run find works');
ok(window.LDM.modes.includes('find'), 'LDM.modes includes find');

console.log(fail ? `\nDOM test: ${fail} FAILED` : '\nDOM test: all passed');
process.exit(fail ? 1 : 0);
