// PS Финансы — Telegram-бот учёта финансов (Cloudflare Worker «psfinance»).
// Этап 2: текст → разбор (Workers AI) → переспрос → итог с кнопками ✅ ❌ ✏️ → запись в Google Таблицу.

const DIRS = ['PS SHOP', 'Аренда PS5', 'Leadex', 'Личное'];
const TYPES = ['Доход', 'Расход', 'Между своими'];
const TLABEL = t => (t === 'Между своими' ? 'Между' : t);   // короткая подпись на кнопке
const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DAY = 86400000, TZ_MS = 5 * 3600000;

// ---------- Telegram ----------
async function tg(ctx, method, body) {
  if (ctx.dry) { ctx.out.push({ method, ...body }); return { ok: true, result: { message_id: 1 } }; }
  const r = await fetch(`https://api.telegram.org/bot${ctx.env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
const kb = rows => ({ inline_keyboard: rows.map(r => r.map(([text, data]) => ({ text, callback_data: data }))) });
const send = (ctx, text, rows) => tg(ctx, 'sendMessage', { chat_id: ctx.chat, text, parse_mode: 'HTML', ...(rows ? { reply_markup: kb(rows) } : {}) });
// История видна: при нажатии кнопки старый текст сообщения не стирается, ответ дописывается снизу («👉 …»)
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const edit = (ctx, mid, text, rows) => {
  if (ctx.orig && mid === ctx.origMid) text = esc(ctx.orig) + '\n\n👉 ' + text;
  return tg(ctx, 'editMessageText', { chat_id: ctx.chat, message_id: mid, text, parse_mode: 'HTML', ...(rows ? { reply_markup: kb(rows) } : {}) });
};

// ---------- Google Таблица (через Apps Script) ----------
async function gas(ctx, ops) {
  const write = ops.some(o => o.op !== 'get' && o.op !== 'find');
  if (ctx.dry && write) { ctx.out.push({ gas: ops }); return ops.map(() => ({ row: 999 })); }
  const r = await fetch(ctx.env.GAS_URL, { method: 'POST', body: JSON.stringify({ key: ctx.env.GAS_KEY, ops }) });
  const j = await r.json();
  if (!j.ok) throw new Error('Таблица: ' + j.error);
  return j.res;
}

// Справочники из таблицы (кэш 10 минут)
async function config(ctx, force) {
  if (!force) { const c = await ctx.env.KV.get('cfg', 'json'); if (c && Date.now() - c.at < 600000) return c; }
  const [cats, cards, sets] = await gas(ctx, [
    { op: 'get', sheet: 'Категории', range: 'A2:D300' },
    { op: 'get', sheet: 'Карты', range: 'A2:L20' },
    { op: 'get', sheet: 'Настройки', range: 'A2:B40' }]);
  const c = {
    at: Date.now(),
    cats: cats.values.filter(r => r[0]).map(r => ({ dir: r[0], kind: r[1], group: r[2], cat: r[3] })),
    cards: cards.values.filter(r => r[0] && r[2]).map(r => ({ name: String(r[0]), cur: r[2],
      inc: String(r[10] || '').split(',').map(x => x.trim()).filter(Boolean), exp: String(r[11] || '').split(',').map(x => x.trim()).filter(Boolean) })),
    owners: sets.values.filter(r => /Telegram ID: Наиль/.test(r[0])).map(r => String(r[1])).filter(Boolean),
  };
  await ctx.env.KV.put('cfg', JSON.stringify(c));
  return c;
}

// ---------- Курс ЦБ ----------
async function cbuRate(ctx, ymd) {
  const k = 'rate:' + ymd, have = await ctx.env.KV.get(k);
  if (have) return Number(have);
  const r = await fetch(`https://cbu.uz/ru/arkhiv-kursov-valyut/json/USD/${ymd}/`);
  const j = await r.json();
  const v = Number(String(j[0].Rate).replace(',', '.'));
  if (!v) throw new Error('нет курса ЦБ');
  await ctx.env.KV.put(k, String(v), { expirationTtl: 40 * 86400 });
  return v;
}

// ---------- Даты ----------
const nowT = () => new Date(Date.now() + TZ_MS);                       // «часы Ташкента» в UTC-полях
const ymdT = d => d.toISOString().slice(0, 10);
const todayYmd = () => ymdT(nowT());
const shiftYmd = (ymd, days) => ymdT(new Date(Date.parse(ymd) + days * DAY));
const human = ymd => { const [y, m, d] = ymd.split('-'); const t = todayYmd();
  return `${d}.${m}.${y}` + (ymd === t ? ' (сегодня)' : ymd === shiftYmd(t, -1) ? ' (вчера)' : ''); };
function parseDate(s) {
  s = String(s || '').trim().toLowerCase();
  if (!s || s === 'сегодня') return todayYmd();
  if (s === 'вчера') return shiftYmd(todayYmd(), -1);
  if (s === 'позавчера') return shiftYmd(todayYmd(), -2);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return s;
  m = s.match(/^(\d{1,2})[.\/](\d{1,2})(?:[.\/](\d{2,4}))?$/);
  if (m) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : todayYmd().slice(0, 4);
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}

// ---------- Числа ----------
const fmt = n => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
function parseAmount(s) {
  s = String(s).toLowerCase().replace(/\s/g, '').replace(',', '.');
  const m = s.match(/^(\d+(?:\.\d+)?)(к|k|тыс|тысяч|т|млн|м|mln)?(\$|сум|сумов|долл.*)?$/);
  if (!m) return null;
  let n = Number(m[1]); const mul = m[2] || '';
  if (/^(к|k|тыс|тысяч|т)$/.test(mul)) n *= 1e3; if (/^(млн|м|mln)$/.test(mul)) n *= 1e6;
  return { amount: n, cur: m[3] && /\$|долл/.test(m[3]) ? '$' : null };
}

// ---------- Голос и фото ----------
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
let VISION = '@cf/mistralai/mistral-small-3.1-24b-instruct';   // читает чеки точнее llama-3.2-vision (проверено 26.11)
async function tgFile(ctx, fileId) {
  const j = await (await fetch(`https://api.telegram.org/bot${ctx.env.BOT_TOKEN}/getFile?file_id=${fileId}`)).json();
  if (!j.ok) throw new Error('не смог скачать файл из Telegram');
  return new Uint8Array(await (await fetch(`https://api.telegram.org/file/bot${ctx.env.BOT_TOKEN}/${j.result.file_path}`)).arrayBuffer());
}
function b64(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
async function transcribe(ctx, bytes) {
  const r = await ctx.env.AI.run(WHISPER, { audio: b64(bytes), language: 'ru', vad_filter: true });
  return String(r.text || '').trim();
}
// Чек или скриншот перевода → короткий текст для обычного разбора
async function readReceipt(ctx, bytes) {
  const prompt = `Read this receipt or bank transfer screenshot (Uzbekistan, amounts in UZS "сум"). Return ONLY JSON:
{"incoming": true ONLY if the image explicitly says money was RECEIVED (зачисление, поступление, входящий, пополнение, "+" before amount), otherwise false,"own_transfer": true only if it is a transfer between the user's own cards,"total": number (the TOTAL / ИТОГО / amount paid, digits only),"date":"DD.MM.YYYY" or null,
"merchant": shop or recipient name or null,"card_last4": 4 digits of the PAYMENT CARD (often after * or ****) or null,"items": short list of goods or purpose in Russian or null}
A shop receipt is ALWAYS incoming=false. Receipt number, check number, terminal id are NOT card digits; the card is usually written like *1234 or **** 1234 near "карта/UZCARD/HUMO/VISA". Do not invent anything.`;
  const url = 'data:image/jpeg;base64,' + b64(bytes);
  const run = () => ctx.env.AI.run(VISION, { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }], max_tokens: 200, temperature: 0 });
  let r;
  try { r = await run(); }
  catch (e) { if (!/agree/i.test(String(e))) throw e; await ctx.env.AI.run(VISION, { prompt: 'agree' }); r = await run(); }
  let j = r.response;
  if (typeof j !== 'object' || !j) { const raw = String(j || r.description || ''); ctx.raw = raw;
    const m = raw.match(/\{[\s\S]*\}/); if (!m) return ''; try { j = JSON.parse(m[0]); } catch (e) { return ''; } }
  ctx.raw = j;
  if (!j.total) return '';
  const kind = j.own_transfer === true ? 'перевод между своими картами' : j.incoming === true ? 'пришло' : 'расход';
  const parts = [`${kind} ${String(j.total).replace(/[^\d.]/g, '')} сум`];
  if (j.items) parts.push([].concat(j.items).join(', '));
  if (j.merchant) parts.push((j.incoming === true ? 'от ' : '') + j.merchant);
  if (j.date) parts.push('дата ' + j.date);
  if (j.card_last4 && /^\d{4}$/.test(String(j.card_last4))) parts.push('карта ' + j.card_last4);
  return parts.join(', ');
}

// ---------- Разбор текста ИИ (одна или несколько записей) ----------
async function aiParse(ctx, cfg, dir, text) {
  const catList = (dd, k) => [...new Set(cfg.cats.filter(c => c.dir === dd && c.kind === k).map(c => c.group === c.cat ? c.cat : `${c.group} / ${c.cat}`))].join('; ');
  const dirs = DIRS.map(dd => `${dd}: доход — ${catList(dd, 'Доход')}; расход — ${catList(dd, 'Расход')}`).join('\n');
  const sys = `Ты разбираешь сообщение о деньгах для учёта. Сегодня ${todayYmd()} (Ташкент). ${dir ? 'Пользователь выбрал направление: ' + dir + '.' : ''}
В сообщении может быть ОДНА или НЕСКОЛЬКО операций. Раздели их.
Верни ТОЛЬКО JSON: {"records":[{"text": точный кусок сообщения про эту операцию, "direction": "PS SHOP"|"Аренда PS5"|"Leadex"|"Личное"|null,
"type": "Доход"|"Расход"|"Между своими"|null, "amount": число|null, "currency": "сум"|"$"|null, "category": из списка направления или null,
"card_from": карта или null, "card_to": карта или null, "date": "YYYY-MM-DD"|null}]}
Правила: сумма числом ("50к"=50000, "1,5 млн"=1500000, "миллион 800"=1800000, "полтора миллиона"=1500000). "$", "долларов", "бакс" → currency "$".
Направление: личные траты (еда, кафе, плов, аптека, квартира, такси, одежда) — Личное; продажа игр, подписок, аккаунтов, поставщик, OLX — PS SHOP; аренда приставок PS5 — Аренда PS5; сайты, Leadex — Leadex. ${dir ? 'Если операция одна — направление ' + dir + '.' : ''} Не ясно — null.
"пришло", "получил", "заплатили мне", "взял за" — Доход. "потратил", "купил", "заплатил", "поели", "расход" — Расход. Перевод между своими картами, снял наличные — "Между своими". Не уверен — null.
Нет суммы — amount null. Не уверен в категории — null, НЕ угадывай. Для расхода карта — card_from, для дохода — card_to.
Дата: "вчера", "позавчера", "25 ноября" → YYYY-MM-DD, не сказано → null.
Категории по направлениям:
${dirs}
Карты (пиши точно как здесь): ${cfg.cards.map(c => c.name).join('; ')}. "нал", "наличка", "кэш" = Нал. "доллары наличные" = Доллары.`;
  const r = await ctx.env.AI.run(MODEL, { messages: [{ role: 'system', content: sys }, { role: 'user', content: text }], max_tokens: 900, temperature: 0 });
  const raw = typeof r.response === 'string' ? r.response : JSON.stringify(r.response);
  const m = raw.match(/\{[\s\S]*\}/);
  const j = m ? JSON.parse(m[0]) : {};
  return Array.isArray(j.records) ? j.records : [j];
}

// сопоставить ответ ИИ со справочником
function matchCat(cfg, d, s) {
  if (!s) return null;
  s = String(s).toLowerCase();
  const pool = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type);
  return pool.find(c => `${c.group} / ${c.cat}`.toLowerCase() === s || c.cat.toLowerCase() === s)
      || pool.find(c => c.group === c.cat && c.group.toLowerCase() === s) || null;
}
// категория считается названной, если в тексте есть слово, похожее на слово из названия (первые 4 буквы)
const SYN = { 'Продукты': ['продукт', 'еда', 'магазин', 'корзин', 'makro', 'макро', 'havas', 'хавас', 'молок', 'хлеб', 'сыр', 'яйц', 'мясо', 'овощ', 'фрукт'],
  'Здоровье': ['аптек', 'лекарств', 'врач', 'стомат', 'зуб'], 'Красота': ['маникюр', 'ногт'], 'Квартира': ['квартир', 'аренд', 'коммун', 'свет', 'газ', 'интернет', 'связь'], 'Такси': ['такси', 'яндекс'] };
// слова, общие с соседними категориями (например «Игры» у «Игры PS5» и «Игры PS4»), не считаются — нужно отличающее слово
function said(text, c, pool) {
  const t = text.toLowerCase().replace(/ё/g, 'е');
  const W = x => (x.group + ' ' + x.cat).toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(w => w.length >= 3 && w !== 'для');
  const others = new Set((pool || []).filter(x => x.group !== c.group).flatMap(W));
  const stem = w => w.slice(0, Math.min(5, Math.max(3, w.length - 2)));
  if (W(c).every(w => t.includes(stem(w)))) return true;          // названы все слова категории («игра на ps4»)
  const words = W(c).filter(w => !others.has(w));
  const stems = words.map(w => w.slice(0, Math.min(5, Math.max(3, w.length - 2)))).concat(SYN[c.group] || []);
  return stems.some(st => t.includes(st));
}
// карта, названная прямо в тексте: короткое имя, «нал/наличка/кэш», «доллары», 4 цифры
function cardInText(cfg, text) {
  const t = ' ' + text.toLowerCase().replace(/ё/g, 'е') + ' ';
  if (/\s(доллар|бакс|\$)/.test(t) && /налич|нал\b|кэш/.test(t)) return cfg.cards.find(c => c.name === 'Доллары') || null;
  if (/налич|\sнал(ом)?[\s.,!]|кэш/.test(t)) return cfg.cards.find(c => c.name === 'Нал') || null;
  return cfg.cards.find(c => { const short = c.name.toLowerCase().split(' (')[0].replace(/ё/g, 'е'), dig = (c.name.match(/\d{4}/) || [])[0];
    return (short.length >= 3 && t.includes(short.slice(0, Math.max(3, short.length - 1)))) || (dig && t.includes(dig)); }) || null;
}
function matchCard(cfg, s) {
  if (!s) return null;
  s = String(s).toLowerCase();
  return cfg.cards.find(c => c.name.toLowerCase() === s)
      || cfg.cards.find(c => c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase().split(' (')[0]))
      || cfg.cards.find(c => (c.name.match(/\d{4}/) || [])[0] && s.includes(c.name.match(/\d{4}/)[0])) || null;
}

// ---------- Черновик ----------
const stKey = ctx => (ctx.dry ? 'dry:' : '') + 'st:' + ctx.chat;
// Состояние диалога — в Durable Object (сразу видно в следующем запросе, в отличие от KV)
async function store(ctx, body) {
  const stub = ctx.env.ST.get(ctx.env.ST.idFromName('main'));
  const r = await stub.fetch('https://st/', { method: 'POST', body: JSON.stringify(body) });
  return r.json();
}
const getSt = async ctx => (await store(ctx, { op: 'get', k: stKey(ctx) })) || {};
const BACK = ['↩️ Назад', 'bk'];
const withBack = rows => [...(rows || []), [BACK]];
function remember(st) { st.hist = (st.hist || []).slice(-15); st.hist.push(JSON.stringify(st.d)); }
const putSt = (ctx, st) => store(ctx, { op: 'put', k: stKey(ctx), v: st });

function summary(d) {
  const L = [];
  L.push(`<b>${d.edit ? '✏️ Исправление записи ' + d.edit : 'Проверьте запись'}</b>${d.of > 1 && !d.edit ? ` (${d.n} из ${d.of})` : ''}`);
  L.push(`🏢 ${d.dir}`);
  L.push(`🔄 ${d.type || '—'}`);
  L.push(`💰 ${d.amount != null ? (d.cur === '$' ? '$' + d.amount : fmt(d.amount) + ' сум') : '—'}`);
  if (d.type !== 'Между своими') L.push(`🏷 ${d.cat ? (d.group === d.cat ? d.cat : d.group + ' / ' + d.cat) : '—'}`);
  if (d.type === 'Между своими') L.push(`💳 ${d.from || '—'} → ${d.to || '—'}`);
  else L.push(`💳 ${(d.type === 'Расход' ? d.from : d.to) || '—'}`);
  L.push(`📅 ${human(d.date)}${d.time ? ', ' + d.time : ''}`);
  if (d.comment) L.push(`💬 ${d.comment}`);
  return L.join('\n');
}

// Чего не хватает → спросить. Возвращает true, если всё заполнено.
async function askNext(ctx, cfg, st) {
  const d = st.d;
  if (!d.dir) { st.await = null; await putSt(ctx, st);
    return void await send(ctx, `К какому направлению относится: «${esc(d.comment)}»?`, withBack([[[DIRS[0], 'd:0'], [DIRS[1], 'd:1']], [[DIRS[2], 'd:2'], [DIRS[3], 'd:3']]])); }
  if (!d.type) { st.await = null; await putSt(ctx, st);
    return void await send(ctx, 'Это доход, расход или перевод между своими картами?', withBack([TYPES.map((t, i) => [TLABEL(t), 'ty:' + i])])); }
  if (d.amount == null) { st.await = 'amount'; await putSt(ctx, st);
    return void await send(ctx, '💰 Какая сумма? Напишите число, например <code>150000</code> или <code>$50</code>.', withBack()); }
  if (d.type !== 'Между своими' && !d.cat && d.group) {
    const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === d.group);
    if (subs.length) { st.await = null; await putSt(ctx, st); return void await send(ctx, `🏷 ${d.group}: что именно?`, withBack(chunk(subs.map((c, i) => [c.cat, 's:' + i]), 2))); }
  }
  if (d.type !== 'Между своими' && !d.cat) return void await askGroup(ctx, cfg, st);
  if (d.type === 'Между своими' && !d.from) return void await askCard(ctx, cfg, st, 'from', 'С какой карты?');
  if (d.type === 'Между своими' && !d.to) return void await askCard(ctx, cfg, st, 'to', 'На какую карту?');
  if (d.type === 'Расход' && !d.from) return void await askCard(ctx, cfg, st, 'from', '💳 С какой карты или наличными?');
  if (d.type === 'Доход' && !d.to) return void await askCard(ctx, cfg, st, 'to', '💳 На какую карту пришли деньги?');
  st.await = null; await putSt(ctx, st);
  await send(ctx, summary(d), [[['✅ Записать', 'ok'], ['❌ Отменить', 'no'], ['✏️ Правка', 'ed']], [BACK]]);
  return true;
}
async function askGroup(ctx, cfg, st) {
  const groups = [...new Set(cfg.cats.filter(c => c.dir === st.d.dir && c.kind === st.d.type).map(c => c.group))];
  st.await = null; st.groups = groups; await putSt(ctx, st);
  await send(ctx, '🏷 Категория?', withBack(chunk(groups.map((g, i) => [g, 'g:' + i]), 2)));
}
async function askCard(ctx, cfg, st, side, q) {
  st.await = null; st.side = side; await putSt(ctx, st);
  const d = st.d, list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) =>
    d.type === 'Доход' ? c.inc.includes(d.dir) : d.type === 'Расход' ? c.exp.includes(d.dir) : true);
  await send(ctx, q, withBack(chunk((list.length ? list : cfg.cards.map((c, i) => ({ c, i }))).map(({ c, i }) => [c.name, 'k:' + i]), 2)));
}
const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);
const dirMenu = ctx => send(ctx, 'Выберите направление записи:', [[[DIRS[0], 'd:0'], [DIRS[1], 'd:1']], [[DIRS[2], 'd:2'], [DIRS[3], 'd:3']]]);

// ---------- Запись в таблицу ----------
async function save(ctx, cfg, d) {
  try {                                                   // раз в день — курс ЦБ на сегодня в Настройки!B2
    const t = todayYmd();
    if ((await store(ctx, { op: 'get', k: 'rateDay' })) !== t) {
      const r = await cbuRate(ctx, t);
      await gas(ctx, [{ op: 'set', sheet: 'Настройки', range: 'B2', values: [[r]] }]);
      if (!ctx.dry) await store(ctx, { op: 'put', k: 'rateDay', v: t });
    }
  } catch (e) {}
  const usd = d.cur === '$';
  let rate = '', uzs = d.amount, usdAmt = '';
  if (usd) { rate = await cbuRate(ctx, d.date); uzs = Math.round(d.amount * rate); usdAmt = d.amount; }
  const hhmm = d.time || nowT().toISOString().slice(11, 16);
  const when = Date.parse(d.date + 'T' + hhmm + ':00Z') - TZ_MS;
  const from = d.type === 'Доход' ? '' : d.from || '', to = d.type === 'Расход' ? '' : d.to || '';
  const row = (id) => [id, { d: when }, 'Наиль', d.dir, d.type, d.group || '', d.cat || '', uzs, usdAmt, rate, from, to, 'ок', d.src || 'текст', d.comment || '', ''];
  if (d.edit) {
    const [f] = await gas(ctx, [{ op: 'find', sheet: 'Журнал', col: 'A', value: d.edit }]);
    if (!f.row) throw new Error('не нашёл запись ' + d.edit);
    await gas(ctx, [{ op: 'set', sheet: 'Журнал', range: `A${f.row}:P${f.row}`, values: [row(d.edit)] }]);
    return d.edit;
  }
  const n = await store(ctx, { op: 'inc', k: ctx.dry ? 'dry:seq' : 'seq' });
  const id = 'R' + n;
  await gas(ctx, [{ op: 'append', sheet: 'Журнал', row: row(id) }]);
  return id;
}
async function loadRow(ctx, id) {
  const [f] = await gas(ctx, [{ op: 'find', sheet: 'Журнал', col: 'A', value: id }]);
  if (!f.row) return null;
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Журнал', range: `A${f.row}:P${f.row}` }]);
  const r = g.values[0];
  return { row: f.row, d: { edit: id, dir: r[3], type: r[4], group: r[5], cat: r[6], amount: r[8] ? r[8] : r[7], cur: r[8] ? '$' : 'сум',
    from: r[10], to: r[11], date: ymdT(new Date(r[1].d + TZ_MS)), time: new Date(r[1].d + TZ_MS).toISOString().slice(11, 16), src: r[13], comment: r[14] }, status: r[12] };
}

// ---------- Обработка ----------
async function onMessage(ctx, m) {
  const cfg = await config(ctx);
  const text = (m.text || '').trim();
  let st = await getSt(ctx);
  if (text === '/start' || text === '/menu' || /^(отмена|стоп)$/i.test(text)) { await putSt(ctx, {}); return dirMenu(ctx); }
  if (m.voice || m.audio || m.video_note) {
    const f = m.voice || m.audio || m.video_note;
    const said = await transcribe(ctx, await tgFile(ctx, f.file_id));
    if (!said) return send(ctx, '🎤 Не расслышал. Попробуйте ещё раз или напишите текстом.');
    await send(ctx, '🎤 ' + esc(said));
    if (st.await && st.d) return onMessage(ctx, { ...m, voice: null, audio: null, video_note: null, text: said });
    return startDraft(ctx, cfg, st.dir || null, said, 'голос');
  }
  const img = m.photo ? m.photo[m.photo.length - 1] : (m.document && /^image\//.test(m.document.mime_type || '') ? m.document : null);
  if (img) {
    await send(ctx, '📷 Читаю фото…');
    const seen = await readReceipt(ctx, await tgFile(ctx, img.file_id));
    if (!seen) return send(ctx, '📷 Не смог прочитать. Пришлите фото чётче или напишите текстом.');
    const full = (m.caption ? m.caption + '. ' : '') + seen;
    await send(ctx, '📷 На фото: ' + esc(seen));
    return startDraft(ctx, cfg, st.dir || null, full, 'фото');
  }
  if (m.document) return send(ctx, 'Этот файл я не читаю. Пришлите фото, голосовое или текст.');
  if (!text) return;
  if (st.await === 'amount' && st.d) {
    const a = parseAmount(text); if (a) remember(st);
    if (!a) return send(ctx, 'Не понял сумму. Напишите только число, например <code>150000</code> или <code>$50</code>.');
    st.d.amount = a.amount; if (a.cur) st.d.cur = a.cur; st.d.cur = st.d.cur || 'сум';
    return reshow(ctx, st);
  }
  if (st.await === 'date' && st.d) {
    const y = parseDate(text);
    if (!y) return send(ctx, 'Не понял дату. Напишите, например, <code>24.11</code> или «вчера».');
    remember(st); st.d.date = y; return reshow(ctx, st);
  }
  return startDraft(ctx, cfg, st.dir || null, text);   // без выбранного направления: одна запись — спросим кнопкой, несколько — направление по смыслу
}
const complete = d => d.type && d.amount != null && (d.type === 'Между своими' ? d.from && d.to : d.cat && (d.type === 'Расход' ? d.from : d.to));
async function reshow(ctx, st) {
  if (!complete(st.d)) return askNext(ctx, await config(ctx), st);
  st.await = null; await putSt(ctx, st);
  return send(ctx, summary(st.d), [[['✅ Записать', 'ok'], ['❌ Отменить', 'no'], ['✏️ Правка', 'ed']], [BACK]]); }

function draftFrom(cfg, dir, p, text, single) {
  const piece = single ? text : String(p.text || text);
  const d = { dir: single ? (dir || null) : (DIRS.includes(p.direction) ? p.direction : dir || null),
    type: TYPES.includes(p.type) ? p.type : null, amount: typeof p.amount === 'number' && p.amount > 0 ? p.amount : null,
    cur: p.currency === '$' ? '$' : 'сум', date: parseDate(p.date) || todayYmd(), comment: piece.slice(0, 200), src: 'текст',
    time: nowT().toISOString().slice(11, 16) };
  if (d.amount == null && single) { const a = parseAmount((text.match(/\$?\d[\d\s.,]*\s*(к|тыс|млн|\$)?/i) || [''])[0]); if (a && a.amount) { d.amount = a.amount; if (a.cur) d.cur = a.cur; } }
  if (d.type && d.dir) {
    const pool = cfg.cats.filter(x => x.dir === d.dir && x.kind === d.type);
    let c = matchCat(cfg, d, p.category); if (c && !said(piece, c, pool)) c = null;
    if (!c) { const hits = pool.filter(x => said(piece, x, pool)); if (hits.length === 1) c = hits[0];   // ИИ не назвал — ищем по словам
      else if (hits.length > 1 && new Set(hits.map(x => x.group)).size === 1) { d.group = hits[0].group; } }
    if (c) { d.group = c.group; d.cat = c.cat; }
  }
  const ok = (c, side) => c && (d.type === 'Доход' ? c.inc.includes(d.dir) : d.type === 'Расход' ? c.exp.includes(d.dir) : true) ? c.name : null;
  let cf = matchCard(cfg, p.card_from), ct = matchCard(cfg, p.card_to);
  if (!cf && !ct && d.type !== 'Между своими') cf = ct = cardInText(cfg, piece);
  if (d.type === 'Между своими') { if (cf) d.from = cf.name; if (ct) d.to = ct.name; }
  if (d.type === 'Доход') d.to = ok(ct) || ok(cf);
  if (d.type === 'Расход') d.from = ok(cf) || ok(ct);
  return d;
}
// направление выбрано позже — заново поискать категорию и карту по тексту записи
function refill(cfg, d) {
  if (!d.type) return;
  const pool = cfg.cats.filter(x => x.dir === d.dir && x.kind === d.type);
  if (!d.cat) { const hits = pool.filter(x => said(d.comment, x, pool));
    if (hits.length === 1) { d.group = hits[0].group; d.cat = hits[0].cat; }
    else if (hits.length > 1 && new Set(hits.map(x => x.group)).size === 1) d.group = hits[0].group; }
  const c = cardInText(cfg, d.comment);
  if (c && d.type === 'Расход' && !d.from && c.exp.includes(d.dir)) d.from = c.name;
  if (c && d.type === 'Доход' && !d.to && c.inc.includes(d.dir)) d.to = c.name;
}
async function startDraft(ctx, cfg, dir, text, src) {
  let recs = [];
  try { recs = await aiParse(ctx, cfg, dir, text); } catch (e) { recs = []; }
  if (!recs.length) recs = [{}];
  const single = recs.length === 1;
  const drafts = recs.map(p => draftFrom(cfg, dir, p, text, single));
  if (src) drafts.forEach(d => { d.src = src; });
  if (!single) await send(ctx, `Нашёл ${drafts.length} записи. Покажу по очереди, каждую подтвердите ✅.`);
  drafts.forEach((d, i) => { d.n = i + 1; d.of = drafts.length; });
  const st = { dir: null, d: drafts[0], queue: drafts.slice(1) };
  return askNext(ctx, cfg, st);
}
// следующая запись из очереди или меню направлений
async function nextOrMenu(ctx, cfg, st) {
  if (st.queue && st.queue.length) { const nst = { d: st.queue[0], queue: st.queue.slice(1) }; return askNext(ctx, cfg, nst); }
  await putSt(ctx, {}); return dirMenu(ctx);
}

async function onCallback(ctx, q) {
  const cfg = await config(ctx);
  const [k, v] = q.data.split(':');
  const mid = q.message.message_id;
  let st = await getSt(ctx);
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'd') {                                   // направление
    const dir = DIRS[+v];
    if (st.d && !st.d.dir) { remember(st); st.d.dir = dir; refill(cfg, st.d); await edit(ctx, mid, '🏢 ' + dir); return askNext(ctx, cfg, st); }
    if (st.d && st.editDir) { st.d.dir = dir; st.d.group = st.d.cat = null; st.editDir = false; await edit(ctx, mid, '🏢 ' + dir); return st.d.type === 'Между своими' ? reshow(ctx, st) : askGroup(ctx, cfg, st); }
    await edit(ctx, mid, '🏢 ' + dir);
    if (st.pending) return startDraft(ctx, cfg, dir, st.pending);
    await putSt(ctx, { dir });
    return send(ctx, `Пишите запись для <b>${dir}</b>. Например: «расход 85 000 продукты с Узума» или «пришло 450к за игру на Приёмку».`);
  }
  if (k === 'bk') {
    await edit(ctx, mid, '↩️ Назад');
    if (st.editDir) { st.editDir = false; return reshow(ctx, st); }
    if (st.hist && st.hist.length) { st.d = JSON.parse(st.hist.pop()); st.await = null; return complete(st.d) ? reshow(ctx, st) : askNext(ctx, cfg, st); }
    await putSt(ctx, {}); return dirMenu(ctx);
  }
  if (!st.d) return edit(ctx, mid, 'Эта запись уже закрыта. Нажмите /menu, чтобы начать новую.');
  if (['ty', 'g', 's', 'k', 'dt'].includes(k)) remember(st);
  const d = st.d;
  if (k === 'ty') { d.type = TYPES[+v]; d.group = d.cat = null; await edit(ctx, mid, '🔄 ' + d.type); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st); }
  if (k === 'g') {
    const g = st.groups[+v]; const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === g);
    if (subs.length === 1) { d.group = g; d.cat = subs[0].cat; await edit(ctx, mid, '🏷 ' + g); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st); }
    d.group = g; await putSt(ctx, st);
    return edit(ctx, mid, `🏷 ${g}: что именно?`, withBack(chunk(subs.map((c, i) => [c.cat, 's:' + i]), 2)));
  }
  if (k === 's') {
    const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === d.group);
    d.cat = subs[+v].cat; await edit(ctx, mid, `🏷 ${d.group} / ${d.cat}`); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st);
  }
  if (k === 'k') { const c = cfg.cards[+v]; d[st.side] = c.name; await edit(ctx, mid, '💳 ' + c.name); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st); }
  if (k === 'dt') { d.date = v === '0' ? todayYmd() : shiftYmd(todayYmd(), -Number(v)); await edit(ctx, mid, '📅 ' + human(d.date)); return reshow(ctx, st); }
  if (k === 'no') { await edit(ctx, mid, '❌ Отменено, эту запись не записал.'); return nextOrMenu(ctx, cfg, st); }
  if (k === 'ok') {
    if (!complete(d)) return askNext(ctx, cfg, st);
    await edit(ctx, mid, summary(d) + '\n\n⏳ Записываю…');
    try {
      const id = await save(ctx, cfg, d);
      await edit(ctx, mid, `✅ Записано · ${id}`, [[['✏️ Исправить', 'fx:' + id], ['🗑 Удалить', 'rm:' + id]]]);
      return nextOrMenu(ctx, cfg, st);
    } catch (e) { return edit(ctx, mid, summary(d) + '\n\n⚠️ Не получилось записать: ' + e.message, [[['✅ Ещё раз', 'ok'], ['❌ Отменить', 'no']]]); }
  }
  if (k === 'ed') {
    st.editing = true; await putSt(ctx, st);
    remember(st); await putSt(ctx, st);
    return edit(ctx, mid, summary(d) + '\n\nЧто исправить?', [[['💰 Сумма', 'e:a'], ['🏷 Категория', 'e:c']], [['🏢 Направление', 'e:n'], ['📅 Дата', 'e:d']], [['🔄 Тип', 'e:t'], ['💳 Карта', 'e:k']], [['↩️ Назад', 'e:b']]]);
  }
  if (k === 'e') {
    await edit(ctx, mid, summary(d));
    if (v === 'a') { st.await = 'amount'; await putSt(ctx, st); return send(ctx, '💰 Новая сумма? Например <code>150000</code> или <code>$50</code>.', withBack()); }
    if (v === 'c') return askGroup(ctx, cfg, st);
    if (v === 'n') { st.editDir = true; await putSt(ctx, st); return send(ctx, 'Новое направление:', withBack([[[DIRS[0], 'd:0'], [DIRS[1], 'd:1']], [[DIRS[2], 'd:2'], [DIRS[3], 'd:3']]])); }
    if (v === 'd') { st.await = 'date'; await putSt(ctx, st); return send(ctx, '📅 Дата? Нажмите кнопку или напишите, например, <code>24.11</code>.', withBack([[['Сегодня', 'dt:0'], ['Вчера', 'dt:1'], ['Позавчера', 'dt:2']]])); }
    if (v === 't') return send(ctx, 'Тип записи:', withBack([TYPES.map((t, i) => [TLABEL(t), 'ty:' + i])]));
    if (v === 'k') { const side = d.type === 'Доход' ? 'to' : 'from';
      if (d.type === 'Между своими') { d.from = d.to = null; return askNext(ctx, cfg, st); }
      return askCard(ctx, cfg, st, side, '💳 Какая карта?'); }
    return reshow(ctx, st);
  }
  return send(ctx, 'Не понял кнопку. Нажмите /menu.');
}
async function afterEdit(ctx, cfg, st) { // после правки: дозаполнить недостающее, потом итог
  const d = st.d;
  if ((d.type !== 'Между своими' && !d.cat) || (d.type === 'Расход' && !d.from) || (d.type === 'Доход' && !d.to) || (d.type === 'Между своими' && (!d.from || !d.to)))
    return askNext(ctx, cfg, st);
  return reshow(ctx, st);
}

// Кнопки под сохранённой записью
async function onSavedButton(ctx, q) {
  const [k, id] = q.data.split(':'); const mid = q.message.message_id;
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'rm') return tg(ctx, 'editMessageReplyMarkup', { chat_id: ctx.chat, message_id: mid, reply_markup: kb([[['🗑 Да, удалить ' + id, 'rmy:' + id], ['Нет', 'rmn:' + id]]]) });
  if (k === 'rmn') return tg(ctx, 'editMessageReplyMarkup', { chat_id: ctx.chat, message_id: mid, reply_markup: kb([[['✏️ Исправить', 'fx:' + id], ['🗑 Удалить', 'rm:' + id]]]) });
  if (k === 'rmy') {
    const [f] = await gas(ctx, [{ op: 'find', sheet: 'Журнал', col: 'A', value: id }]);
    if (f.row) await gas(ctx, [{ op: 'set', sheet: 'Журнал', range: `M${f.row}`, values: [['удалено']] }]);
    return edit(ctx, mid, `🗑 Запись ${id} удалена. Итоги в таблице пересчитаны.`);
  }
  if (k === 'fx') {
    const r = await loadRow(ctx, id);
    if (!r || r.status === 'удалено') return send(ctx, `Запись ${id} не найдена или удалена.`);
    await putSt(ctx, { d: r.d, editing: true });
    return send(ctx, summary(r.d) + '\n\nЧто исправить?', [[['💰 Сумма', 'e:a'], ['🏷 Категория', 'e:c']], [['🏢 Направление', 'e:n'], ['📅 Дата', 'e:d']], [['🔄 Тип', 'e:t'], ['💳 Карта', 'e:k']], [['↩️ Готово', 'e:b']]]);
  }
}

async function handle(ctx, upd) {
  const m = upd.message, q = upd.callback_query;
  const from = (m && m.from) || (q && q.from); if (!from) return;
  ctx.chat = (m && m.chat.id) || (q && q.message.chat.id);
  const cfg = await config(ctx);
  if (!cfg.owners.includes(String(from.id))) {          // незнакомым не отвечаем, но запоминаем
    await ctx.env.KV.put('seen:' + from.id, JSON.stringify({ id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' '), user: from.username || '', at: Date.now() }));
    return;
  }
  if (q && q.message) { ctx.orig = q.message.text || ''; ctx.origMid = q.message.message_id; }
  try {
    if (q) return /^(rm|rmy|rmn|fx):/.test(q.data) ? await onSavedButton(ctx, q) : await onCallback(ctx, q);
    return await onMessage(ctx, m);
  } catch (e) {
    await send(ctx, '⚠️ Ошибка: ' + e.message + '\nПопробуйте ещё раз или нажмите /menu.');
  }
}

export class State {
  constructor(state) { this.s = state.storage; }
  async fetch(req) {
    const { op, k, v } = await req.json();
    if (op === 'get') return Response.json((await this.s.get(k)) ?? null);
    if (op === 'put') { await this.s.put(k, v); return Response.json(true); }
    if (op === 'inc') { const n = ((await this.s.get(k)) || 0) + 1; await this.s.put(k, n); return Response.json(n); }
    return Response.json(null);
  }
}

export default {
  async fetch(req, env, ectx) {
    const u = new URL(req.url);
    if (u.pathname === '/tg' && req.method === 'POST') {
      if (req.headers.get('x-telegram-bot-api-secret-token') !== env.WH_SECRET) return new Response('no', { status: 403 });
      const upd = await req.json();
      ectx.waitUntil(handle({ env, out: [] }, upd));
      return new Response('ok');
    }
    if (u.searchParams.get('k') !== env.GAS_KEY) return new Response('ok');
    if (u.pathname === '/seen') {
      const l = await env.KV.list({ prefix: 'seen:' }); const out = [];
      for (const k of l.keys) out.push(JSON.parse(await env.KV.get(k.name)));
      return Response.json(out);
    }
    if (u.pathname === '/test' && req.method === 'POST') {   // прогон без отправки в Telegram и без записи в таблицу
      const ctx = { env, dry: true, out: [] };
      await handle(ctx, await req.json());
      return Response.json(ctx.out);
    }
    if (u.pathname === '/testai' && req.method === 'POST') {   // проверка распознавания: ?t=voice|photo, тело — файл
      const bytes = new Uint8Array(await req.arrayBuffer()), ctx = { env };
      if (u.searchParams.get('m')) VISION = u.searchParams.get('m');
      try { return Response.json({ text: u.searchParams.get('t') === 'photo' ? await readReceipt(ctx, bytes) : await transcribe(ctx, bytes), raw: ctx.raw }); }
      catch (e) { return Response.json({ error: String(e && e.stack || e) }); }
    }
    if (u.pathname === '/reload') { await config({ env }, true); return new Response('reloaded'); }
    return new Response('ok');
  },
};
