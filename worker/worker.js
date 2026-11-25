// PS Финансы — Telegram-бот учёта финансов (Cloudflare Worker «psfinance»).
// Этап 2: текст → разбор (Workers AI) → переспрос → итог с кнопками ✅ ❌ ✏️ → запись в Google Таблицу.

const DIRS = ['PS SHOP', 'Аренда PS5', 'Leadex', 'Личное'];
const TYPES = ['Доход', 'Расход', 'Между своими', 'Предоплата', 'Залог', 'Вложение'];
const IN_T = ['Доход', 'Предоплата', 'Залог'], OUT_T = ['Расход', 'Вложение', 'Возврат залога'];
const isIn = t => IN_T.includes(t), isOut = t => OUT_T.includes(t), needsCat = t => t === 'Доход' || t === 'Расход';
const typeRows = () => chunk(TYPES.map((t, i) => [TLABEL(t), 'ty:' + i]), 3);
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
// премиум-эмодзи владельца на кнопках: подпись → [текст, id эмодзи] («Назад» — только красная стрелка)
const ICON = { 'Закрыл оплату поставщику ✅': ['Закрыл оплату поставщику', '5465154027970908359'], '+': [' ', '5442846010785151030'], '−': [' ', '5442918359509251481'], '↩️ Назад': [' ', '5215261582170278752'], '💳 Баланс': ['Баланс', '5472250091332993630'], '📄 Открыть таблицу': ['Открыть таблицу', '5319080489426887527'],
  'PS SHOP': ['PS SHOP', '5408830063074365909'], 'Аренда PS5': ['Аренда PS5', '5309830839268298113'], 'Leadex': ['Leadex', '4943195336911881191'], 'Личное': ['Личное', '5467814330714041218'] };
// цвета кнопок (владелец 26.11): primary синий, success зелёный, danger красный
const STYLE = { 'Закрыл оплату поставщику ✅': 'success', 'PS SHOP': 'primary', 'Аренда PS5': 'success', 'Leadex': 'danger', 'Личное': 'primary' };
const kb = rows => ({ inline_keyboard: rows.map(r => r.map(([text, data]) => {
  const b = ICON[text] ? { text: ICON[text][0], icon_custom_emoji_id: ICON[text][1] } : { text };
  if (STYLE[text]) b.style = STYLE[text];
  return /^https?:/.test(data) ? { ...b, url: data } : { ...b, callback_data: data }; })) });
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OXZEt2YRwHJmy8QZtCH3rZMNgaVyW5d5u7tsKONrmgU/edit';
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
"type": "Доход"|"Расход"|"Между своими"|"Предоплата"|"Залог"|"Вложение"|null, "amount": число|null, "currency": "сум"|"$"|null, "category": из списка направления или null,
"card_from": карта или null, "card_to": карта или null, "date": "YYYY-MM-DD"|null, "book": дата брони для предоплаты "YYYY-MM-DD"|null}]}
Правила: сумма числом ("50к"=50000, "1,5 млн"=1500000, "миллион 800"=1800000, "полтора миллиона"=1500000). "$", "долларов", "бакс" → currency "$".
Направление: личные траты (еда, кафе, плов, аптека, квартира, такси, одежда) — Личное; продажа игр, подписок, аккаунтов, поставщик, OLX — PS SHOP; аренда приставок PS5 — Аренда PS5; сайты, Leadex — Leadex. ${dir ? 'Если операция одна — направление ' + dir + '.' : ''} Не ясно — null.
"пришло", "получил", "заплатили мне", "взял за" — Доход. В направлении Аренда PS5 "аренда 300к", "за аренду", "клиент заплатил" — Доход (категория Аренда / Оплата аренды), а расход аренды — только если сказано "потратил", "купил", "расход", "доставка", "реклама". "потратил", "купил", "заплатил", "поели", "расход" — Расход. Перевод между своими картами, снял наличные — "Между своими". "предоплата", "бронь", "забронировал" — "Предоплата". "залог" — "Залог". "вложил", "вложение", "купил для Leadex технику в долг" — "Вложение". Не уверен — null.
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
// Категория считается названной, если в тексте есть слово, которое есть ТОЛЬКО у неё (не у соседних категорий),
// либо синоним из SYN. Группа — если есть слово, которого нет у других групп. Тогда спросим подкатегорию.
const SYN = {
  'Еда': ['продукт', 'еда', 'магазин', 'корзин', 'makro', 'макро', 'havas', 'хавас', 'молок', 'хлеб', 'сыр', 'яйц', 'мясо', 'овощ', 'фрукт'],
  'Бытовая химия': ['химия', 'порошок', 'мыло', 'шампун'],
  'Аптека': ['аптек', 'лекарств'], 'Лечение зубов': ['стомат', 'зуб'], 'Маникюр': ['маникюр', 'ногт'],
  'Такси': ['такси', 'яндекс'], 'Кафе': ['кафе', 'ресторан', 'плов', 'кофе', 'обед', 'ужин'],
  'Оплата аренды': ['аренд', 'клиент заплатил'], 'Коммунальные': ['коммун', 'свет', 'газ', 'вода'],
  'Домашний интернет': ['интернет'], 'Мобильная связь': ['связь', 'телефон', 'мобильн'],
};
const norm = t => ' ' + String(t).toLowerCase().replace(/ё/g, 'е') + ' ';
const words = x => String(x).toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(w => w.length >= 3 && w !== 'для');
const stem = w => w.slice(0, Math.min(5, Math.max(3, w.length - 2)));
function catSaid(text, c, pool) {
  const t = norm(text);
  if ((SYN[c.cat] || []).some(x => t.includes(x))) return true;
  const own = words(c.group === c.cat ? c.cat : c.group + ' ' + c.cat);
  const others = new Set(pool.filter(x => x !== c).flatMap(x => words(x.group + ' ' + x.cat)));
  const uniq = own.filter(w => !others.has(w));
  const full = ws => ws.length > 1 && ws.every(w => t.includes(stem(w)));
  if (full(own)) return !pool.some(x => x !== c && full(words(x.group === x.cat ? x.cat : x.group + ' ' + x.cat)));   // «игра на ps4»
  return uniq.some(w => t.includes(stem(w)));
}
function groupSaid(text, g, pool) {
  const t = norm(text);
  const others = new Set(pool.filter(x => x.group !== g).flatMap(x => words(x.group)));
  return words(g).filter(w => !others.has(w)).some(w => t.includes(stem(w)));
}
// подобрать категорию: сначала ответ ИИ (если подтверждён словами), потом поиск по словам
function detectCat(cfg, d, piece, aiCat) {
  const pool = cfg.cats.filter(x => x.dir === d.dir && x.kind === d.type);
  let c = aiCat ? matchCat(cfg, d, aiCat) : null; if (c && !catSaid(piece, c, pool)) c = null;
  if (!c) { const hits = pool.filter(x => catSaid(piece, x, pool)); if (hits.length === 1) c = hits[0];
    else if (new Set(hits.map(x => x.group)).size === 1 && hits.length) d.group = hits[0].group; }
  if (!c && !d.group) { const gs = [...new Set(pool.map(x => x.group))].filter(g => groupSaid(piece, g, pool));
    if (gs.length === 1) { const subs = pool.filter(x => x.group === gs[0]); if (subs.length === 1) c = subs[0]; else d.group = gs[0]; } }
  if (c) { d.group = c.group; d.cat = c.cat; }
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
  if (ctx.dry && body.k && !String(body.k).startsWith('dry:')) body = { ...body, k: 'dry:' + body.k };   // тест не трогает настоящие данные
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
  if (needsCat(d.type)) L.push(`🏷 ${d.cat ? (d.group === d.cat ? d.cat : d.group + ' / ' + d.cat) : '—'}`);
  if (d.type === 'Между своими') L.push(`💳 ${d.from || '—'} → ${d.to || '—'}`);
  else L.push(`💳 ${(isOut(d.type) ? d.from : d.to) || '—'}`);
  if (d.type === 'Предоплата') L.push(`🗓 Бронь на ${d.book ? human(d.book) : '—'}`);
  if (d.type === 'Предоплата' || d.type === 'Залог') L.push('ℹ️ Чужие деньги: в доход не идут, пока не закроете');
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
    return void await send(ctx, 'Это доход, расход или перевод между своими картами?', withBack(typeRows())); }
  if (d.amount == null) { st.await = 'amount'; await putSt(ctx, st);
    return void await send(ctx, '💰 Какая сумма? Напишите число, например <code>150000</code> или <code>$50</code>.', withBack()); }
  if (needsCat(d.type) && !d.cat && d.group) {
    const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === d.group);
    if (subs.length) { st.await = null; await putSt(ctx, st); return void await send(ctx, `🏷 ${d.group}: что именно?`, withBack(chunk(subs.map((c, i) => [c.cat, 's:' + i]), 2))); }
  }
  if (needsCat(d.type) && !d.cat) return void await askGroup(ctx, cfg, st);
  if (d.type === 'Между своими' && !d.from) return void await askCard(ctx, cfg, st, 'from', 'С какой карты?');
  if (d.type === 'Между своими' && !d.to) return void await askCard(ctx, cfg, st, 'to', 'На какую карту?');
  if (isOut(d.type) && !d.from) return void await askCard(ctx, cfg, st, 'from', '💳 С какой карты или наличными?');
  if (isIn(d.type) && !d.to) return void await askCard(ctx, cfg, st, 'to', '💳 На какую карту пришли деньги?');
  if (d.type === 'Предоплата' && !d.book) { st.await = 'book'; await putSt(ctx, st);
    return void await send(ctx, '📅 На какую дату бронь? Нажмите кнопку или напишите, например, <code>28.11</code>.',
      withBack([[['Сегодня', 'bd:0'], ['Завтра', 'bd:1'], ['Послезавтра', 'bd:2']]])); }
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
    isIn(d.type) ? c.inc.includes(d.dir) : isOut(d.type) ? c.exp.includes(d.dir) : true);
  await send(ctx, q, withBack(chunk((list.length ? list : cfg.cards.map((c, i) => ({ c, i }))).map(({ c, i }) => [c.name, 'k:' + i]), 2)));
}
const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);
const PAD = n => '\u2800'.repeat(n);                    // невидимые символы: Telegram не умеет центрировать текст
const dirMenu = ctx => send(ctx, PAD(3) + '<b><tg-emoji emoji-id="5409048419211682843">💵</tg-emoji> ГЛАВНОЕ МЕНЮ <tg-emoji emoji-id="5409048419211682843">💵</tg-emoji></b>' + PAD(3) + '\n' + PAD(5) + 'Выбери раздел' + PAD(5), [[[DIRS[0], 'd:0'], [DIRS[1], 'd:1']], [[DIRS[2], 'd:2'], [DIRS[3], 'd:3']], [['💳 Баланс', 'adj']], [['📄 Открыть таблицу', SHEET_URL]]]);

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
  const from = isIn(d.type) ? '' : d.from || '', to = isOut(d.type) ? '' : d.to || '';
  const row = (id) => [id, { d: when }, 'Наиль', d.dir, d.type, d.group || '', d.cat || '', uzs, usdAmt, rate, from, to, 'ок', d.src || 'текст', d.comment || '', ''];
  if (d.edit) {
    const [f] = await gas(ctx, [{ op: 'find', sheet: 'Журнал', col: 'A', value: d.edit }]);
    if (!f.row) throw new Error('не нашёл запись ' + d.edit);
    await gas(ctx, [{ op: 'set', sheet: 'Журнал', range: `A${f.row}:P${f.row}`, values: [row(d.edit)] }]);
    if (d.type === 'Предоплата' || d.type === 'Залог') {
      const [z] = await gas(ctx, [{ op: 'find', sheet: 'Залоги и предоплаты', col: 'A', value: d.edit }]);
      if (z.row) await gas(ctx, [{ op: 'set', sheet: 'Залоги и предоплаты', range: `B${z.row}:G${z.row}`, values: [[{ d: when }, d.type, d.dir, uzs, to, d.book ? { d: Date.parse(d.book) } : '']] }]);
    }
    return d.edit;
  }
  const n = await store(ctx, { op: 'inc', k: ctx.dry ? 'dry:seq' : 'seq' });
  const id = 'R' + n;
  const ops = [{ op: 'append', sheet: 'Журнал', row: row(id) }];
  if (d.type === 'Предоплата' || d.type === 'Залог')
    ops.push({ op: 'append', sheet: 'Залоги и предоплаты', row: [id, { d: when }, d.type, d.dir, uzs, to, d.book ? { d: Date.parse(d.book) } : '', 'открыт', d.comment || ''] });
  await gas(ctx, ops);
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


// ---------- Залоги, брони, сверка остатка ----------
const ZS = 'Залоги и предоплаты';
async function openItems(ctx) {
  const [g] = await gas(ctx, [{ op: 'get', sheet: ZS, range: 'A2:I300' }]);
  return g.values.map((r, i) => ({ row: i + 2, id: String(r[0]), date: r[1], type: r[2], dir: r[3], sum: Number(r[4]) || 0, card: r[5], book: r[6], status: r[7], comment: r[8] }))
    .filter(x => x.id && x.status === 'открыт');
}
const itemText = x => `${x.type === 'Залог' ? '🔐 Залог' : '🗓 Предоплата'} ${x.id} · ${fmt(x.sum)} сум · ${x.card || '—'}` +
  (x.book && x.book.d ? ` · бронь ${human(ymdT(new Date(x.book.d + TZ_MS)))}` : '') + (x.comment ? `\n💬 ${esc(x.comment)}` : '');
const itemButtons = x => x.type === 'Залог'
  ? [[['↩️ Вернул клиенту', 'zr:' + x.id]], [['➕ Продление из залога', 'zp:' + x.id], ['✋ Удержал часть', 'zk:' + x.id]]]
  : [[['✅ Клиент приехал', 'pc:' + x.id], ['🔥 Сгорела', 'pb:' + x.id]]];
// запись в журнал «от бота» (без черновика)
const botRec = (ctx, cfg, f) => save(ctx, cfg, { cur: 'сум', date: todayYmd(), src: 'бот', ...f });
async function setItem(ctx, x, sum, status) { await gas(ctx, [{ op: 'set', sheet: ZS, range: `E${x.row}:H${x.row}`, values: [[sum, x.card, x.book || '', status]] }]); }

async function onTool(ctx, q) {
  const cfg = await config(ctx);
  const [k, id] = q.data.split(':'); const mid = q.message.message_id;
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'zl') {
    const items = await openItems(ctx);
    await edit(ctx, mid, '📋 Залоги и брони');
    if (!items.length) return send(ctx, 'Открытых залогов и броней нет.');
    for (const x of items) await send(ctx, itemText(x), itemButtons(x));
    return;
  }
  if (k === 'adj') {
    await edit(ctx, mid, '<tg-emoji emoji-id="5472250091332993630">💳</tg-emoji> Баланс');
    await putSt(ctx, {});                                   // «Баланс» только показывает остатки (владелец 26.11); исправление — не здесь
    const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:J20' }]);
    const rows = g.values.filter(r => r[0] && r[2]);
    let tot = 0, alien = 0, n = 0; const L = ['<b>💳 Баланс по картам</b>', ''];
    for (const r of rows) {
      const v = Number(r[8]) || 0, j = Number(r[9]) || 0, usd = r[2] === '$', bro = /^Арс/.test(r[0]);
      L.push(`${++n}. ${r[0]}\n      <b>${usd ? '$' + fmt(v) : fmt(v) + ' сум'}</b>${j ? ` (из них чужие ${fmt(j)})` : ''}${bro ? ' — деньги брата' : ''}`, '');
      if (!usd && !bro) { tot += v; alien += j; }
    }
    L.push('━━━━━━━━━━', `Всего в сумах: <b>${fmt(tot)}</b>`); if (alien) L.push(`Из них мои: <b>${fmt(tot - alien)}</b>`);
    return send(ctx, L.join('\n'), [[BACK]]);
  }
  if (k === 'aj') {
    const c = cfg.cards[+id];
    await edit(ctx, mid, '💳 ' + c.name);
    await putSt(ctx, { tool: { kind: 'adj', card: c.name, cur: c.cur }, await: 'tool' });
    return send(ctx, `Сколько сейчас на самом деле на «${c.name}»? Напишите число${c.cur === '$' ? ' в долларах' : ''}.`, withBack());
  }
  const items = await openItems(ctx); const x = items.find(i => i.id === id);
  if (!x) return edit(ctx, mid, 'Эта запись уже закрыта.');
  if (k === 'zr') return edit(ctx, mid, `Вернуть клиенту ${fmt(x.sum)} сум с «${x.card}»?`, [[['✅ Да, вернул', 'zry:' + id], ['Нет', 'zl:']]]);
  if (k === 'zry') {
    const rid = await botRec(ctx, cfg, { dir: x.dir, type: 'Возврат залога', amount: x.sum, from: x.card, comment: 'Возврат залога ' + x.id });
    await setItem(ctx, x, 0, 'закрыт');
    return edit(ctx, mid, `↩️ Залог ${x.id} вернули клиенту: ${fmt(x.sum)} сум с «${x.card}» (${rid}). Это не расход.`);
  }
  if (k === 'zp' || k === 'zk') {
    await putSt(ctx, { tool: { kind: k, id }, await: 'tool' });
    return edit(ctx, mid, itemText(x) + `\n\n${k === 'zp' ? '➕ Сколько ушло на продление' : '✋ Сколько оставляете себе'}? Напишите число (не больше ${fmt(x.sum)}).`, withBack());
  }
  if (k === 'pb') {
    const rid = await botRec(ctx, cfg, { dir: x.dir, type: 'Доход', group: x.dir === 'Аренда PS5' ? 'Аренда' : '', cat: 'Сгоревшая предоплата', amount: x.sum, comment: 'Сгорела предоплата ' + x.id });
    await setItem(ctx, x, 0, 'сгорела');
    await edit(ctx, mid, `🔥 Предоплата ${x.id} сгорела: ${fmt(x.sum)} сум теперь доход (${rid}).`);
    return x.dir === 'Аренда PS5' ? rentShare(ctx, cfg) : null;
  }
  if (k === 'pc') {
    await putSt(ctx, { tool: { kind: 'pc', id }, await: 'tool' });
    return edit(ctx, mid, itemText(x) + '\n\n✅ Сколько клиент доплатил? Напишите число или нажмите «0».', withBack([[['0 — без доплаты', 'p0:' + id]]]));
  }
  if (k === 'p0') return finishPrepay(ctx, cfg, x, 0, null, mid);
  if (k === 'pk') {   // карта доплаты: id = itemId|cardIndex|amount
    const [iid, ci, amt] = q.data.slice(3).split('|'); const xi = items.find(i => i.id === iid);
    return finishPrepay(ctx, cfg, xi, Number(amt), cfg.cards[+ci].name, mid);
  }
}
async function finishPrepay(ctx, cfg, x, extra, card, mid) {
  const grp = x.dir === 'Аренда PS5' ? 'Аренда' : '';
  const a = await botRec(ctx, cfg, { dir: x.dir, type: 'Доход', group: grp, cat: 'Предоплата', amount: x.sum, comment: 'Подтверждена предоплата ' + x.id });
  let b = '';
  if (extra > 0) b = await botRec(ctx, cfg, { dir: x.dir, type: 'Доход', group: grp, cat: 'Доплата', amount: extra, to: card, comment: 'Доплата к ' + x.id });
  await setItem(ctx, x, 0, 'подтверждено');
  await putSt(ctx, {});
  const t = `✅ ${x.id} подтверждено: предоплата ${fmt(x.sum)}${extra ? ` + доплата ${fmt(extra)} на «${card}»` : ''} = доход ${fmt(x.sum + extra)} сум (${a}${b ? ', ' + b : ''}).`;
  await (mid ? edit(ctx, mid, t) : send(ctx, t));
  if (x.dir === 'Аренда PS5') await rentShare(ctx, cfg);
}
// ответы числом на вопросы инструментов
async function onToolText(ctx, cfg, st, text) {
  const a = parseAmount(text);
  if (!a) return send(ctx, 'Не понял число. Напишите, например, <code>150000</code>.');
  const t = st.tool;
  if (t.kind === 'sup') return supplierDone(ctx, cfg, t.card, a.amount);
  if (t.kind === 'interest') {          // 1-е число: проценты по UZUM вкладу → доход PS SHOP
    const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
    const r = g.values.find(r => String(r[0]) === t.card); const now = Number(r && r[8]) || 0;
    const diff = Math.round(a.amount - now);
    await putSt(ctx, {});
    if (diff <= 0) { st.tool = { kind: 'adj', card: t.card, cur: 'сум' }; return diff === 0 ? send(ctx, '✅ Совпадает, процентов не прибавилось.') : onToolText(ctx, cfg, st, text); }
    const rid = await botRec(ctx, cfg, { dir: 'PS SHOP', type: 'Доход', group: 'Проценты по вкладу', cat: 'Проценты по вкладу', amount: diff, to: t.card, comment: 'Проценты по вкладу за месяц' });
    return send(ctx, `💰 Проценты по «${t.card}»: +${fmt(diff)} сум — доход PS SHOP (${rid}). На вкладе теперь ${fmt(a.amount)}.`, [[['🗑 Отменить', 'rm:' + rid]]]);
  }
  if (t.kind === 'adj') {
    const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
    const r = g.values.find(r => String(r[0]) === t.card); const now = Number(r && r[8]) || 0;
    const diff = Math.round((a.amount - now) * 100) / 100;
    await putSt(ctx, {});
    if (!diff) return send(ctx, `✅ На «${t.card}» по записям уже ${fmt(now)} — совпадает, ничего не меняю.`);
    const f = { dir: '—', type: 'Корректировка', amount: Math.abs(diff), cur: t.cur === '$' ? '$' : 'сум', comment: `Сверка: было по записям ${fmt(now)}, на самом деле ${fmt(a.amount)}` };
    if (diff > 0) f.to = t.card; else f.from = t.card;
    if (f.cur === '$') { f.amount = Math.abs(diff); }
    const rid = await botRec(ctx, cfg, f);
    return send(ctx, `🧮 «${t.card}»: по записям было ${fmt(now)}, теперь ${fmt(a.amount)} (${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}). Записал как корректировку ${rid}, в доходы и расходы не идёт.`,
      [[['🗑 Отменить корректировку', 'rm:' + rid]]]);
  }
  const items = await openItems(ctx); const x = items.find(i => i.id === t.id);
  if (!x) { await putSt(ctx, {}); return send(ctx, 'Эта запись уже закрыта.'); }
  if (t.kind === 'zp' || t.kind === 'zk') {
    if (a.amount > x.sum) return send(ctx, `Больше залога (${fmt(x.sum)}). Напишите сумму не больше залога.`);
    const rid = await botRec(ctx, cfg, { dir: x.dir, type: 'Доход', group: x.dir === 'Аренда PS5' ? 'Аренда' : '', cat: t.kind === 'zp' ? 'Продление из залога' : 'Удержано из залога', amount: a.amount, comment: (t.kind === 'zp' ? 'Продление из залога ' : 'Удержано из залога ') + x.id });
    const left = x.sum - a.amount;
    await setItem(ctx, x, left, left > 0 ? 'открыт' : 'закрыт');
    await putSt(ctx, {});
    await send(ctx, `✅ ${fmt(a.amount)} сум из залога ${x.id} — доход аренды (${rid}). Осталось залога: ${fmt(left)}.`,
      left > 0 ? [[['↩️ Остаток вернул клиенту', 'zr:' + x.id]]] : null);
    return x.dir === 'Аренда PS5' ? rentShare(ctx, cfg) : null;
  }
  if (t.kind === 'pc') {
    if (!a.amount) return finishPrepay(ctx, cfg, x, 0, null);
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.inc.includes(x.dir));
    await putSt(ctx, {});
    return send(ctx, `💳 Куда пришла доплата ${fmt(a.amount)}?`, chunk(list.map(({ c, i }) => [c.name, `pk:${x.id}|${i}|${a.amount}`]), 2));
  }
}
// ежедневно в 9:00: брони, у которых наступила дата
async function morning(env) {
  const ctx = { env, out: [] }; const cfg = await config(ctx, true);
  ctx.chat = cfg.owners[0]; if (!ctx.chat) return;
  const today = todayYmd();
  if (today.endsWith('-01')) {
    const dep = cfg.cards.find(c => /вклад/i.test(c.name));
    if (dep) { await putSt(ctx, { tool: { kind: 'interest', card: dep.name }, await: 'tool' });
      await send(ctx, `📅 Начало месяца. Сколько сейчас на «${dep.name}»? Напишите сумму из приложения — разницу запишу как проценты (доход PS SHOP).`); }
  }
  for (const x of await openItems(ctx)) {
    if (x.type !== 'Предоплата' || !x.book || !x.book.d) continue;
    if (ymdT(new Date(x.book.d + TZ_MS)) > today) continue;
    await send(ctx, 'Клиент приехал?\n' + itemText(x), itemButtons(x));
  }
}


// ---------- Leadex: распределение каждого поступления ----------
// 20% фонд, 20% возврат вложений Наилю (пока не вернулись), из остального — расходы Leadex с прошлого поступления, остаток 50/50.
// Карты получателей пока не заданы (владелец 26.11: «сделай пока виртуальную кнопку»).
async function leadexSplit(ctx, cfg, id, amount) {
  const last = (await store(ctx, { op: 'get', k: 'lxLast' })) || 0;
  const [j, debt] = await gas(ctx, [{ op: 'get', sheet: 'Журнал', range: 'A2:M3000' }, { op: 'get', sheet: 'Долги и накопления', range: 'F6' }]);
  const exp = j.values.filter(r => r[3] === 'Leadex' && r[4] === 'Расход' && r[12] !== 'удалено' && r[1] && r[1].d > last).reduce((a, r) => a + (Number(r[7]) || 0), 0);
  const invLeft = Math.max(0, Number(debt.values[0][0]) || 0);
  const fund = Math.round(amount * 0.2);
  const ret = Math.min(Math.round(amount * 0.2), invLeft);
  const pool = amount - fund - ret;                       // 60% (или больше, если вложения уже вернулись)
  const over = exp > pool;
  const rest = over ? 0 : pool - exp;
  const half = Math.round(rest / 2);
  const x = { id, amount, exp, fund, ret, invLeft, rest, nail: half, rishat: rest - half, over, at: Date.now() };
  await store(ctx, { op: 'put', k: 'lx:' + id, v: x });
  const L = [`💼 <b>Leadex: пришло ${fmt(amount)} сум</b> (${id})`,
    `Расходы Leadex с прошлого поступления: ${fmt(exp)}`, '',
    `• Фонд Leadex 20%: <b>${fmt(fund)}</b> → карта фонда (не выбрана)`,
    ret ? `• Возврат вложений вам: <b>${fmt(ret)}</b> (останется вернуть ${fmt(invLeft - ret)})` : '• Вложения уже возвращены',
    over ? `⚠️ Расходы (${fmt(exp)}) больше, чем осталось на них (${fmt(pool)}). Долей в этот раз нет.\n💰 <b>Нужно вложить: ${fmt(exp - pool)}</b> — запишу как вложение, оно вернётся вам из следующих поступлений (20%).`
         : `• Расходы покрыты: ${fmt(exp)}\n• Вам 50%: <b>${fmt(half)}</b>\n• Ришату 50%: <b>${fmt(rest - half)}</b> → карта Ришата (не выбрана)`];
  x.short = over ? exp - pool : 0; await store(ctx, { op: 'put', k: 'lx:' + id, v: x });
  const kb = [[['✅ Перевёл', 'lxok:' + id], ['Позже', 'lxno:' + id]]];
  if (over) kb.push([['💰 Вложил ' + fmt(x.short), 'lxin:' + id]]);
  return send(ctx, L.join('\n'), kb);
}
async function onLeadex(ctx, q) {
  const cfg = await config(ctx); const [k, id] = q.data.split(':'); const mid = q.message.message_id;
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'lxif') {
    const [iid, ci] = id.split('|'); const y = await store(ctx, { op: 'get', k: 'lx:' + iid });
    if (!y || !y.short) return edit(ctx, mid, 'Вложение уже записано.');
    const src = ci === '-' ? null : cfg.cards[+ci];
    const lx = cfg.cards.find(c => c.inc.includes('Leadex') && c.name !== (src && src.name) && c.cur === 'сум');
    const rid = await botRec(ctx, cfg, { dir: 'Leadex', type: 'Вложение', cat: 'Вложение', amount: y.short, from: src ? src.name : '', to: src && lx ? lx.name : '',
      comment: 'Покрытие расходов Leadex сверх 60% (' + iid + ')' });
    const amt = y.short; y.short = 0; await store(ctx, { op: 'put', k: 'lx:' + iid, v: y });
    return edit(ctx, mid, `✅ Записал вложение ${fmt(amt)}${src ? `: «${src.name}»${lx ? ' → «' + lx.name + '»' : ''}` : ''} (${rid}). Оно добавлено к сумме, которую Leadex возвращает вам.`);
  }
  const x = await store(ctx, { op: 'get', k: 'lx:' + id });
  if (!x) return edit(ctx, mid, 'Расчёт не найден.');
  if (k === 'lxin') {                                     // вложение недостающей суммы: с какой карты
    if (!x.short) return edit(ctx, mid, 'Вложение уже записано.');
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.cur === 'сум');
    return send(ctx, `С какой карты вложили ${fmt(x.short)} в Leadex?`, [...chunk(list.map(({ c, i }) => [c.name, `lxif:${id}|${i}`]), 2), [['Без перевода, только записать', `lxif:${id}|-`]]]);
  }
  if (k === 'lxno') return edit(ctx, mid, 'Хорошо, напомню позже. Кнопка «✅ Перевёл» остаётся выше.', [[['✅ Перевёл', 'lxok:' + id]], ...(x.short ? [[['💰 Вложил ' + fmt(x.short), 'lxin:' + id]]] : [])]);
  if (x.done) return edit(ctx, mid, 'Уже отмечено.');
  const recs = [];
  if (x.ret) recs.push(await botRec(ctx, cfg, { dir: 'Leadex', type: 'Возврат вложений', cat: 'Возврат вложений Leadex', amount: x.ret, comment: 'Возврат вложений из ' + id }));
  if (x.nail) recs.push(await botRec(ctx, cfg, { dir: 'Личное', type: 'Доход', group: 'Доля из Leadex (50%)', cat: 'Доля из Leadex (50%)', amount: x.nail, comment: 'Доля из ' + id }));
  await gas(ctx, [{ op: 'append', sheet: 'Доли', row: [{ d: Date.now() }, id, x.amount, x.over ? 0 : x.exp, x.fund, x.ret, x.nail, x.rishat, x.over ? 'расходы > 60%, доли не начислены, нехватка → вложение' : 'отмечено'] }]);
  x.done = true; await store(ctx, { op: 'put', k: 'lx:' + id, v: x });
  if (!ctx.dry) await store(ctx, { op: 'put', k: 'lxLast', v: Date.now() });
  return edit(ctx, mid, `✅ Отмечено. ${recs.length ? 'Записал: ' + recs.join(', ') + '. ' : ''}Таблица «Доли» обновлена.`);
}


// ---------- Журнал целиком (для расчётов долей) ----------
async function journal(ctx) {
  const [j] = await gas(ctx, [{ op: 'get', sheet: 'Журнал', range: 'A2:P3000' }]);
  return j.values.filter(r => r[0] && r[12] !== 'удалено').map(r => ({ id: r[0], t: r[1] && r[1].d || 0, dir: r[3], type: r[4], group: r[5], cat: r[6], uzs: Number(r[7]) || 0, from: r[10], to: r[11] }));
}
const cardByWord = (cfg, w) => cfg.cards.find(c => c.name.toLowerCase().startsWith(w.toLowerCase()));

// ---------- PS SHOP: «закрыл оплату» → поставщик, чистая прибыль, 80/20 ----------
async function closeSupplier(ctx, cfg) {
  const sup = cardByWord(cfg, 'Поставщик');
  await putSt(ctx, { tool: { kind: 'sup', card: sup.name }, await: 'tool' });
  return send(ctx, `🧾 Закрыли оплату поставщику. Сколько <b>осталось</b> на «${sup.name}»? Напишите число из приложения банка.`, withBack());
}
async function supplierDone(ctx, cfg, card, left) {
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
  const r = g.values.find(r => String(r[0]) === card); const before = Number(r && r[8]) || 0;
  const paid = Math.round(before - left);
  await putSt(ctx, {});
  if (paid <= 0) return send(ctx, `По записям на «${card}» было ${fmt(before)}, вы пишете ${fmt(left)}. Оплаты не видно.`);
  const sid = await botRec(ctx, cfg, { dir: 'PS SHOP', type: 'Расход', group: 'Поставщик', cat: 'Поставщик', amount: paid, from: card, comment: `Оплата поставщику: было ${fmt(before)}, осталось ${fmt(left)}` });
  const last = (await store(ctx, { op: 'get', k: 'psLast' })) || 0;
  const J = (await journal(ctx)).filter(x => x.t > last || x.id === sid);
  const rasx = cardByWord(cfg, 'Расходка');
  const income = J.filter(x => x.dir === 'PS SHOP' && x.type === 'Доход' && x.cat !== 'Проценты по вкладу').reduce((a, x) => a + x.uzs, 0);
  const supPaid = J.filter(x => x.dir === 'PS SHOP' && x.type === 'Расход' && x.cat === 'Поставщик').reduce((a, x) => a + x.uzs, 0);
  const toExp = J.filter(x => x.type === 'Между своими' && rasx && x.to === rasx.name).reduce((a, x) => a + x.uzs, 0);
  const net = income - supPaid - toExp;
  const L = [`🧾 Записал расход «Поставщик»: <b>${fmt(paid)}</b> сум (${sid}).`, '',
    `<b>Чистая прибыль PS SHOP с прошлого расчёта:</b>`, `поступления ${fmt(income)} − поставщику ${fmt(supPaid)} − на Расходку ${fmt(toExp)} = <b>${fmt(net)}</b>`];
  if (!ctx.dry) await store(ctx, { op: 'put', k: 'psLast', v: Date.now() });
  if (net <= 0) { L.push('', 'Прибыли нет — доли не начисляю.');
    return send(ctx, L.join('\n')); }
  const mine = Math.round(net * 0.8), res = net - mine;
  const nid = await botRec(ctx, cfg, { dir: 'Личное', type: 'Доход', group: 'Доля из PS SHOP (80%)', cat: 'Доля из PS SHOP (80%)', amount: mine, comment: 'Доля 80% по расчёту ' + sid });
  await gas(ctx, [{ op: 'set', sheet: 'Доли', range: 'K5:Q5', values: [['PS SHOP: дата', 'Поступления', 'Поставщику', 'На Расходку', 'Чистая прибыль', 'Наилю 80%', 'Резерв 20%']] },
    { op: 'append', sheet: 'Доли', row: ['', '', '', '', '', '', '', '', '', '', { d: Date.now() }, income, supPaid, toExp, net, mine, res] }]);
  await store(ctx, { op: 'put', k: 'res:' + sid, v: { amount: res } });
  L.push('', `• Вам 80%: <b>${fmt(mine)}</b> — записал в «Личное» (${nid})`, `• В резерв 20%: <b>${fmt(res)}</b> → переведите на «UZUM вклад»`);
  return send(ctx, L.join('\n'), [[['✅ Перевёл в резерв', 'rsv:' + sid], ['Позже', 'rsvl:' + sid]]]);
}

// ---------- Аренда: доля брата 60% после каждой сделки ----------
async function rentShare(ctx, cfg) {
  const J = await journal(ctx);
  const ars = cardByWord(cfg, 'Арс');
  const inc = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Доход').reduce((a, x) => a + x.uzs, 0);
  const exp = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Расход').reduce((a, x) => a + x.uzs, 0);
  const profit = inc - exp;
  const paid = ars ? J.filter(x => x.type === 'Между своими' && x.to === ars.name).reduce((a, x) => a + x.uzs, 0) : 0;
  const mineDone = J.filter(x => x.dir === 'Личное' && x.cat === 'Доля из аренды (40%)').reduce((a, x) => a + x.uzs, 0);
  const mineAdd = Math.round(profit * 0.4 - mineDone);
  let nid = '';
  if (mineAdd > 0) nid = await botRec(ctx, cfg, { dir: 'Личное', type: 'Доход', group: 'Доля из аренды (40%)', cat: 'Доля из аренды (40%)', amount: mineAdd, comment: 'Доля 40% аренды' });
  const due = Math.round(profit * 0.6 - paid);
  const L = [`🎮 <b>Аренда PS5, за всё время:</b> доходы ${fmt(inc)} − расходы ${fmt(exp)} = прибыль <b>${fmt(profit)}</b>`,
    `Доля брата 60%: ${fmt(Math.round(profit * 0.6))}, уже переведено: ${fmt(paid)}`,
    `👉 <b>К переводу брату: ${fmt(Math.max(0, due))}</b>`];
  if (nid) L.push(`Ваша доля 40%: +${fmt(mineAdd)} записал в «Личное» (${nid})`);
  if (due <= 0) return send(ctx, L.join('\n'));
  await store(ctx, { op: 'put', k: 'bro', v: { amount: due } });
  return send(ctx, L.join('\n'), [[['✅ Перевёл брату', 'bro:'], ['Позже', 'brol:']]]);
}
// кнопки: перевёл в резерв / брату → с какой карты
async function onShares(ctx, q) {
  const cfg = await config(ctx); const [k, id] = q.data.split(':'); const mid = q.message.message_id;
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'rsvl' || k === 'brol') return edit(ctx, mid, 'Хорошо, позже. Кнопка остаётся.', [[['✅ Перевёл', k === 'rsvl' ? 'rsv:' + id : 'bro:']]]);
  if (k === 'rsv' || k === 'bro') {
    const tgt = k === 'rsv' ? cfg.cards.find(c => /вклад/i.test(c.name)) : cardByWord(cfg, 'Арс');
    const amt = k === 'rsv' ? ((await store(ctx, { op: 'get', k: 'res:' + id })) || {}).amount : ((await store(ctx, { op: 'get', k: 'bro' })) || {}).amount;
    if (!amt || !tgt) return edit(ctx, mid, 'Сумма не найдена или уже записана.');
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.name !== tgt.name && c.cur === 'сум');
    return edit(ctx, mid, `С какой карты перевели ${fmt(amt)} на «${tgt.name}»?`, chunk(list.map(({ c, i }) => [c.name, `${k}f:${id}|${i}`]), 2));
  }
  if (k === 'rsvf' || k === 'brof') {
    const [iid, ci] = id.split('|'); const src = cfg.cards[+ci];
    const tgt = k === 'rsvf' ? cfg.cards.find(c => /вклад/i.test(c.name)) : cardByWord(cfg, 'Арс');
    const key = k === 'rsvf' ? 'res:' + iid : 'bro'; const it = await store(ctx, { op: 'get', k: key });
    if (!it || !it.amount) return edit(ctx, mid, 'Уже записано.');
    const rid = await botRec(ctx, cfg, { dir: k === 'rsvf' ? 'PS SHOP' : 'Аренда PS5', type: 'Между своими', amount: it.amount, from: src.name, to: tgt.name,
      comment: k === 'rsvf' ? 'Резерв 20% PS SHOP' : 'Доля брата 60% аренды' });
    await store(ctx, { op: 'put', k: key, v: { amount: 0 } });
    return edit(ctx, mid, `✅ Записал перевод ${fmt(it.amount)}: «${src.name}» → «${tgt.name}» (${rid}).`);
  }
}

// ---------- Обработка ----------
async function onMessage(ctx, m) {
  const cfg = await config(ctx);
  const text = (m.text || '').trim();
  let st = await getSt(ctx);
  const ce = (m.entities || []).filter(e => e.type === 'custom_emoji');
  if (m.sticker && m.sticker.custom_emoji_id) ce.push({ custom_emoji_id: m.sticker.custom_emoji_id });   // id премиум-эмодзи владельца (для меню)
  if (ce.length && !ctx.dry) for (const e of ce) await ctx.env.KV.put('ce:' + e.custom_emoji_id, JSON.stringify({ text, at: Date.now() }));
  if (ce.length && !text.replace(/[\s\u{FE0F}\u{200D}\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{2B05}-\u{2B07}\u{2190}-\u{21FF}]/gu, '')) return send(ctx, 'Эмодзи запомнил 👌');
  if (text === '/start' || text === '/menu' || /^(отмена|стоп)$/i.test(text) || /главное\s*меню/i.test(text)) { await putSt(ctx, {}); return dirMenu(ctx); }
  if (m.voice || m.audio || m.video_note) {
    const f = m.voice || m.audio || m.video_note;
    const said = await transcribe(ctx, await tgFile(ctx, f.file_id));
    if (!said) return send(ctx, '🎤 Не расслышал. Попробуйте ещё раз или напишите текстом.');
    await send(ctx, '🎤 ' + esc(said));
    if (st.await && st.d) return onMessage(ctx, { ...m, voice: null, audio: null, video_note: null, text: said });
    ctx.ptype = st.ptype; return startDraft(ctx, cfg, st.dir || null, said, 'голос');
  }
  const img = m.photo ? m.photo[m.photo.length - 1] : (m.document && /^image\//.test(m.document.mime_type || '') ? m.document : null);
  if (img) {
    await send(ctx, '📷 Читаю фото…');
    const seen = await readReceipt(ctx, await tgFile(ctx, img.file_id));
    if (!seen) return send(ctx, '📷 Не смог прочитать. Пришлите фото чётче или напишите текстом.');
    const full = (m.caption ? m.caption + '. ' : '') + seen;
    await send(ctx, '📷 На фото: ' + esc(seen));
    ctx.ptype = st.ptype; return startDraft(ctx, cfg, st.dir || null, full, 'фото');
  }
  if (m.document) return send(ctx, 'Этот файл я не читаю. Пришлите фото, голосовое или текст.');
  if (!text) return;
  if (st.await === 'tool' && st.tool) return onToolText(ctx, cfg, st, text);
  if (/закрыл[а-я]*\s+(оплат|поставщ)/i.test(text)) return closeSupplier(ctx, cfg);
  if (st.await === 'amount' && st.d) {
    const a = parseAmount(text); if (a) remember(st);
    if (!a) return send(ctx, 'Не понял сумму. Напишите только число, например <code>150000</code> или <code>$50</code>.');
    st.d.amount = a.amount; if (a.cur) st.d.cur = a.cur; st.d.cur = st.d.cur || 'сум';
    return reshow(ctx, st);
  }
  if (st.await === 'book' && st.d) {
    const y = parseDate(text);
    if (!y) return send(ctx, 'Не понял дату. Напишите, например, <code>28.11</code>.');
    remember(st); st.d.book = y; return reshow(ctx, st);
  }
  if (st.await === 'date' && st.d) {
    const y = parseDate(text);
    if (!y) return send(ctx, 'Не понял дату. Напишите, например, <code>24.11</code> или «вчера».');
    remember(st); st.d.date = y; return reshow(ctx, st);
  }
  ctx.ptype = st.ptype; return startDraft(ctx, cfg, st.dir || null, text);   // без выбранного направления: одна запись — спросим кнопкой, несколько — направление по смыслу
}
const complete = d => d.dir && d.type && d.amount != null && (d.type === 'Между своими' ? d.from && d.to
  : (!needsCat(d.type) || d.cat) && (isOut(d.type) ? d.from : d.to) && (d.type !== 'Предоплата' || d.book));
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
  fixType(d);
  if (d.type === 'Предоплата' && p.book) { d.book = parseDate(p.book); if (d.date === d.book) d.date = todayYmd(); }  // дата операции ≠ дата брони
  if (d.amount == null && single) { const a = parseAmount((text.match(/\$?\d[\d\s.,]*\s*(к|тыс|млн|\$)?/i) || [''])[0]); if (a && a.amount) { d.amount = a.amount; if (a.cur) d.cur = a.cur; } }
  if (d.type && d.dir && needsCat(d.type)) detectCat(cfg, d, piece, p.category);
  const ok = c => c && (isIn(d.type) ? c.inc.includes(d.dir) : isOut(d.type) ? c.exp.includes(d.dir) : true) ? c.name : null;
  let cf = matchCard(cfg, p.card_from), ct = matchCard(cfg, p.card_to);
  if (!cf && !ct && d.type !== 'Между своими') cf = ct = cardInText(cfg, piece);
  if (d.type === 'Между своими') { if (cf) d.from = cf.name; if (ct) d.to = ct.name; }
  if (isIn(d.type)) d.to = ok(ct) || ok(cf);
  if (isOut(d.type)) d.from = ok(cf) || ok(ct);
  return d;
}
// направление выбрано позже — заново поискать категорию и карту по тексту записи
// «Предоплата» и «Залог» как чужие деньги — только в аренде; в других направлениях «предоплата за сайт» — обычный доход
function fixType(d) { if (d.dir && d.dir !== 'Аренда PS5' && (d.type === 'Предоплата' || d.type === 'Залог')) d.type = 'Доход'; }
function refill(cfg, d) {
  fixType(d);
  if (!d.type) return;
  if (!needsCat(d.type)) { const c = cardInText(cfg, d.comment); if (c && isOut(d.type) && !d.from) d.from = c.name; if (c && isIn(d.type) && !d.to) d.to = c.name; return; }
  if (!d.cat) detectCat(cfg, d, d.comment, null);
  const c = cardInText(cfg, d.comment);
  if (c && isOut(d.type) && !d.from && c.exp.includes(d.dir)) d.from = c.name;
  if (c && isIn(d.type) && !d.to && c.inc.includes(d.dir)) d.to = c.name;
}
async function startDraft(ctx, cfg, dir, text, src) {
  let recs = [];
  try { recs = await aiParse(ctx, cfg, dir, text); } catch (e) { recs = []; }
  if (!recs.length) recs = [{}];
  const single = recs.length === 1;
  if (ctx.ptype && single) recs[0].type = ctx.ptype;      // выбран ➕/➖ — тип не спрашиваем
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
  if (k === 'pt') {                                  // PS SHOP: ➕ доход / ➖ расход
    const type = v === '+' ? 'Доход' : 'Расход';
    await putSt(ctx, { dir: st.dir || 'PS SHOP', ptype: type });
    await edit(ctx, mid, `<b>PS SHOP ${v === '+' ? '➕ доход' : '➖ расход'}</b>`);
    return send(ctx, v === '+' ? 'Пишите доход. Например: «игра 450 000 на Приёмку».' : 'Пишите расход. Например: «OLX 50 000 с Расходки».', [[BACK]]);
  }
  if (k === 'd') {                                   // направление
    const dir = DIRS[+v];
    if (st.d && !st.d.dir) { remember(st); st.d.dir = dir; refill(cfg, st.d); await edit(ctx, mid, '🏢 ' + dir); return askNext(ctx, cfg, st); }
    if (st.d && st.editDir) { st.d.dir = dir; st.d.group = st.d.cat = null; st.editDir = false; await edit(ctx, mid, '🏢 ' + dir); return st.d.type === 'Между своими' ? reshow(ctx, st) : askGroup(ctx, cfg, st); }
    await edit(ctx, mid, '🏢 ' + dir);
    if (st.pending) return startDraft(ctx, cfg, dir, st.pending);
    await putSt(ctx, { dir });
    const extra = dir === 'PS SHOP' ? [[['Закрыл оплату поставщику ✅', 'sup']]] : dir === 'Аренда PS5' ? [[['📋 Залоги и брони', 'zl']]] : [];
    extra.push([BACK]);                                   // назад в главное меню
    if (dir === 'PS SHOP') return send(ctx, '<b>PS SHOP ?</b>', [extra[0], [['+', 'pt:+'], ['−', 'pt:-']], ...extra.slice(1)]);
    return send(ctx, `Пишите запись для <b>${dir}</b>. Например: «расход 85 000 продукты с Узума» или «пришло 450к за игру на Приёмку».`, extra);
  }
  if (k === 'bk' && st.tool) { await edit(ctx, mid, '<tg-emoji emoji-id="5215261582170278752">⬅️</tg-emoji>'); await putSt(ctx, {}); return dirMenu(ctx); }
  if (k === 'bk') {
    await edit(ctx, mid, '<tg-emoji emoji-id="5215261582170278752">⬅️</tg-emoji>');
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
  if (k === 'bd') { d.book = shiftYmd(todayYmd(), Number(v)); await edit(ctx, mid, '🗓 ' + human(d.book)); return reshow(ctx, st); }
  if (k === 'dt') { d.date = v === '0' ? todayYmd() : shiftYmd(todayYmd(), -Number(v)); await edit(ctx, mid, '📅 ' + human(d.date)); return reshow(ctx, st); }
  if (k === 'no') { await edit(ctx, mid, '❌ Отменено, эту запись не записал.'); return nextOrMenu(ctx, cfg, st); }
  if (k === 'ok') {
    if (!complete(d)) return askNext(ctx, cfg, st);
    await edit(ctx, mid, summary(d) + '\n\n⏳ Записываю…');
    try {
      const id = await save(ctx, cfg, d);
      await edit(ctx, mid, `✅ Записано · ${id}`, [[['✏️ Исправить', 'fx:' + id], ['🗑 Удалить', 'rm:' + id]]]);
      if (!d.edit && d.dir === 'Аренда PS5' && (d.type === 'Доход' || d.type === 'Расход')) await rentShare(ctx, cfg);
      if (!d.edit && d.dir === 'Leadex' && d.type === 'Доход') {
        const uzs = d.cur === '$' ? Math.round(d.amount * await cbuRate(ctx, d.date)) : d.amount;
        await leadexSplit(ctx, cfg, id, uzs);
      }
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
    if (v === 't') return send(ctx, 'Тип записи:', withBack(typeRows()));
    if (v === 'k') { const side = isIn(d.type) ? 'to' : 'from';
      if (d.type === 'Между своими') { d.from = d.to = null; return askNext(ctx, cfg, st); }
      return askCard(ctx, cfg, st, side, '💳 Какая карта?'); }
    return reshow(ctx, st);
  }
  return send(ctx, 'Не понял кнопку. Нажмите /menu.');
}
async function afterEdit(ctx, cfg, st) { // после правки: дозаполнить недостающее, потом итог
  const d = st.d;
  if (!complete(d)) return askNext(ctx, cfg, st);
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
    const [z] = await gas(ctx, [{ op: 'find', sheet: 'Залоги и предоплаты', col: 'A', value: id }]);
    if (z.row) await gas(ctx, [{ op: 'set', sheet: 'Залоги и предоплаты', range: `H${z.row}`, values: [['удалено']] }]);
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
  if (!ctx.dry && m) {                                   // последние 10 сообщений (для разбора: эмодзи, стикеры)
    const l = (await ctx.env.KV.get('last', 'json')) || []; l.unshift({ at: Date.now(), m }); await ctx.env.KV.put('last', JSON.stringify(l.slice(0, 10)));
  }
  const from = (m && m.from) || (q && q.from); if (!from) return;
  ctx.chat = (m && m.chat.id) || (q && q.message.chat.id);
  const cfg = await config(ctx);
  if (!cfg.owners.includes(String(from.id))) {          // незнакомым не отвечаем, но запоминаем
    await ctx.env.KV.put('seen:' + from.id, JSON.stringify({ id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' '), user: from.username || '', at: Date.now() }));
    return;
  }
  if (q && q.message) { ctx.orig = q.message.text || ''; ctx.origMid = q.message.message_id; }
  try {
    if (q && /^lx(ok|no|in|if):/.test(q.data)) return await onLeadex(ctx, q);
    if (q && /^(rsv|rsvl|bro|brol|rsvf|brof):/.test(q.data)) return await onShares(ctx, q);
    if (q && q.data === 'sup') { await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id }); await edit(ctx, q.message.message_id, '🧾 Закрыл оплату'); return await closeSupplier(ctx, await config(ctx)); }
    if (q && /^(zl|adj|aj|zr|zry|zp|zk|pc|pb|p0|pk)(:|$)/.test(q.data)) return await onTool(ctx, q);
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
  async scheduled(ev, env, ectx) { ectx.waitUntil(morning(env)); },
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
    if (u.pathname === '/tgcall' && req.method === 'POST') {  // служебное: прямой вызов Telegram (проверка эмодзи и т. п.)
      const b = await req.json(); return Response.json(await tg({ env }, b.method, b.body));
    }
    if (u.pathname === '/last') return new Response(await env.KV.get('last') || '[]', { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/ce') {
      const l = await env.KV.list({ prefix: 'ce:' }); const out = {};
      for (const k of l.keys) out[k.name.slice(3)] = JSON.parse(await env.KV.get(k.name));
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
    if (u.pathname === '/morning') { await morning(env); return new Response('done'); }
    if (u.pathname === '/reload') { await config({ env }, true); return new Response('reloaded'); }
    return new Response('ok');
  },
};
