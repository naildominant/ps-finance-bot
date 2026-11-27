// PS Финансы — Telegram-бот учёта финансов (Cloudflare Worker «psfinance»).
// Этап 2: текст → разбор (Workers AI) → переспрос → итог с кнопками ✅ ❌ ✏️ → запись в Google Таблицу.

const DIRS = ['PS SHOP', 'Аренда PS5', 'Leadex', 'Личное'];
const TYPES = ['Доход', 'Расход', 'Между своими', 'Предоплата', 'Залог', 'Вложение', 'Дал в долг', 'Возврат долга'];
const IN_T = ['Доход', 'Предоплата', 'Залог', 'Возврат долга'], OUT_T = ['Расход', 'Вложение', 'Возврат залога', 'Дал в долг'];   // «Дал в долг» — не расход (владелец 27.11)
const isIn = t => IN_T.includes(t), isOut = t => OUT_T.includes(t), needsCat = t => t === 'Доход' || t === 'Расход';
// типы на кнопках — только нужные направлению (владелец 27.11: перевод — отдельной кнопкой в меню)
const TYPES_BY_DIR = { 'Аренда PS5': ['Доход', 'Расход', 'Предоплата', 'Залог'], 'PS SHOP': ['Доход', 'Расход'], 'Leadex': ['Доход', 'Расход'], 'Личное': ['Доход', 'Расход'] };   // долг, вложения, перевод — свои кнопки
const typeRows = dir => chunk(TYPES.map((t, i) => [TLABEL(t), 'ty:' + i, t === 'Доход' ? 'success' : t === 'Расход' ? 'danger' : undefined]).filter(b => (TYPES_BY_DIR[dir] || ['Доход', 'Расход', 'Предоплата', 'Залог']).includes(TYPES[+b[1].slice(3)])), 2);
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
const ICON = { '📄 Таблица': ['Таблица', '5319080489426887527'], 'Подписка': ['Подписка', '4900380749263275153'], 'СТАРТ': ['СТАРТ', '5409048419211682843'], 'Закрыл оплату поставщику ✅': ['Закрыл оплату поставщику', '5465154027970908359'], '+': ['Доход', '5253652327734192243'], '−': ['Расход', '5255775038010829248'], '↩️ Назад': [' ', '5215261582170278752'], '💳 Баланс': ['Баланс', '5472250091332993630'], '📄 Открыть таблицу': ['Открыть таблицу', '5319080489426887527'],
  'PS SHOP': ['PS SHOP', '5408830063074365909'], 'Аренда PS5': ['Аренда PS5', '5309830839268298113'], 'Leadex': ['LEADEX', '4943195336911881191'], 'Личное': ['Личное', '5467814330714041218'] };
// цвета кнопок (владелец 26.11): primary синий, success зелёный, danger красный
const STYLE = { '+': 'success', '−': 'danger', 'СТАРТ': 'success', 'Оплата': 'success', 'Сегодня': 'primary', 'Завтра': 'primary', 'Послезавтра': 'primary', 'Другая дата': 'primary', 'Предоплата': 'primary', 'Залог': 'danger', 'Закрыл оплату поставщику ✅': 'primary', 'PS SHOP': 'primary', 'Аренда PS5': 'success', 'Leadex': 'danger', 'Личное': 'primary' };
// премиум-эмодзи (владелец 27.11): обычные эмодзи в тексте и в начале кнопки заменяются на анимированные из наборов владельца
const PE = {"✅": "5465154027970908359", "↩️": "5215261582170278752", "💳": "5472250091332993630", "🧾": "5204242830687494041", "💰": "5417924076503062111", "📄": "5319080489426887527", "🏷": "5298877105000439431", "🤝": "5402457289384809602", "🗑": "5445267414562389170", "✏️": "5395444784611480792", "📅": "5413879192267805083", "📉": "5246762912428603768", "➕": "5253652327734192243", "🔥": "5424972470023104089", "⚠️": "5447644880824181073", "📷": "5463397592505274619", "❌": "5210952531676504517", "🔐": "5296369303661067030", "✋": "5406610501285204375", "🏁": "5204415960819181173", "🏢": "5309903664733759148", "🔄": "5375338737028841420", "🗓": "5413879192267805083", "💸": "5319172285762919855", "👤": "5312412634304226296", "💵": "5409048419211682843", "📋": "5402108679774282930", "👉": "5416117059207572332", "ℹ️": "5334544901428229844", "💬": "5443038326535759644", "✍️": "5406922599378736770", "🎮": "5408830063074365909", "🤑": "5391292736647209211", "📈": "5244837092042750681", "🎤": "5224736245665511429", "➖": "5255775038010829248", "🏠": "5416041192905265756", "⭐": "5438496463044752972", "🎯": "5461009483314517035", "🧮": "5231200819986047254", "💼": "5215420556089776398", "🧡": "5467814330714041218", "👌": "5402481568834935235", "👇": "5406745015365943482", "🛠": "5341715473882955310", "⏳": "5447497297157970203", "🆕": "5382357040008021292", "📊": "5231200819986047254", "🔒": "5296369303661067030"};
const PE_KEYS = Object.keys(PE).sort((a, b) => b.length - a.length);
const PE_RE = new RegExp('(' + PE_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\ufe0f?', 'g');
function premium(text) {                                  // не трогаем уже готовые <tg-emoji> и <code>
  return String(text).split(/(<tg-emoji[^>]*>[\s\S]*?<\/tg-emoji>|<code>[\s\S]*?<\/code>)/).map((part, i) => i % 2 ? part
    : part.replace(PE_RE, e => { const k = e.replace(/\ufe0f$/, ''); const id = PE[k] || PE[e]; return id ? `<tg-emoji emoji-id="${id}">${e}</tg-emoji>` : e; })).join('');
}
function btnIcon(text) {                                  // «📉 Расходы» → иконка + «Расходы»
  for (const k of PE_KEYS) if (text.startsWith(k)) { const rest = text.slice(k.length).replace(/^\ufe0f/, '').trim(); if (rest) return [rest, PE[k]]; }
  return null;
}
const kb = rows => ({ inline_keyboard: rows.map(r => r.map(([text, data, style]) => {
  const ic = ICON[text] || btnIcon(text);
  const b = ic ? { text: ic[0], icon_custom_emoji_id: ic[1] } : { text };
  if (style || STYLE[text]) b.style = style || STYLE[text];
  return /^https?:/.test(data) ? { ...b, url: data } : { ...b, callback_data: data }; })) });
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OXZEt2YRwHJmy8QZtCH3rZMNgaVyW5d5u7tsKONrmgU/edit';
const RENT_URL = 'https://docs.google.com/spreadsheets/d/1G9NgWFPksCyinTU7_QARySUJwyEFzW6cJdNRxb3xIKo/edit';   // «PS Аренда» — только аренда, брату (владелец 27.11)
const send = async (ctx, text, rows) => {
  if (ctx.wife && rows) rows = rows.map(r => r.filter(([t, d]) => !/^(ed|fx:|rm:)/.test(d || '')).map(([t, d, st]) => [t, /^(d:\d|st0|menu)$/.test(d || '') ? 'wm' : d, st])).filter(r => r.length);   // жене: без правки/удаления   // жена: «Назад» → её меню
  if (ctx.viewer && rows) rows = rows.map(r => r.map(([t, d, st]) => [t, /^(d:\d|bk|st0|menu)$/.test(d || '') ? 'vm' : d, st]));   // брат: назад → меню аренды
  if (ctx.editMid) {                                       // «Назад»: экран меняется на месте, без анимации удаления (владелец 26.11)
    const mid = ctx.editMid; ctx.editMid = null;
    const e = await tg(ctx, 'editMessageText', { chat_id: ctx.chat, message_id: mid, text: premium(text), parse_mode: 'HTML', reply_markup: kb(rows || []) });
    if (e && e.ok) { if (ctx.trail && !ctx.noTrack) ctx.trail.push(mid); return e; }
  }
  const r = await tg(ctx, 'sendMessage', { chat_id: ctx.chat, text: premium(text), parse_mode: 'HTML', ...(rows ? { reply_markup: kb(rows) } : {}) });
  if (ctx.trail && !ctx.noTrack && r && r.ok) ctx.trail.push(r.result.message_id);   // «лишнее» — сотрём при возврате в меню
  return r;
};
// чистый чат (владелец 26.11): нажатая кнопка-вопрос удаляется; подсказки и сообщения владельца стираются при возврате в меню.
// Остаются: «✅ Записано», расчёты долей, эмодзи дохода/расхода.
const unkb = (ctx, mid) => tg(ctx, 'editMessageReplyMarkup', { chat_id: ctx.chat, message_id: mid, reply_markup: { inline_keyboard: [] } }).catch(() => {});   // убрать кнопки, сообщение оставить
const gone = (ctx, mid) => tg(ctx, 'deleteMessage', { chat_id: ctx.chat, message_id: mid }).catch(() => {});
async function purge(ctx) {
  if (ctx.wife) return;                                   // у жены свой чат — общий «след» владельца не трогаем
  const ids = [...((await store(ctx, { op: 'get', k: 'trail' })) || []), ...(ctx.trail || [])].filter(i => !(ctx.keep || []).includes(i) && i !== ctx.editMid);
  if (ctx.trail) ctx.trail.length = 0;
  await store(ctx, { op: 'put', k: 'trail', v: [] });
  for (const i of [...new Set(ids)]) await gone(ctx, i);
}
// История видна: при нажатии кнопки старый текст сообщения не стирается, ответ дописывается снизу («👉 …»)
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const edit = (ctx, mid, text, rows) => {
  if (ctx.wife && rows) rows = rows.map(r => r.filter(([t, d]) => !/^(ed|fx:|rm:)/.test(d || ''))).filter(r => r.length);   // жене: без правки/удаления
  if (ctx.orig && mid === ctx.origMid) text = esc(ctx.orig) + '\n\n👉 ' + text;
  return tg(ctx, 'editMessageText', { chat_id: ctx.chat, message_id: mid, text: premium(text), parse_mode: 'HTML', ...(rows ? { reply_markup: kb(rows) } : {}) });
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
    viewers: sets.values.filter(r => /Telegram ID: брат/i.test(r[0])).map(r => String(r[1])).filter(Boolean),   // брат: только смотрит аренду (27.11)
    wife: sets.values.filter(r => /Telegram ID: жена/i.test(r[0])).map(r => String(r[1])).filter(Boolean),   // жена: личные расходы, цели без «Сюрприза», BULKA (задача 25)
    viewersTest: sets.values.filter(r => /Telegram ID: брат \(тест\)/i.test(r[0])).map(r => String(r[1])).filter(Boolean),   // пока есть тестовый — лично пишем только ему
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
  let pre = false; if (s.startsWith('$')) { pre = true; s = s.slice(1); }   // «$50»
  const m = s.match(/^(\d+(?:\.\d+)?)(к|k|тыс[а-я]*|т|косар[а-я]*|млн|миллион[а-я]*|лям[а-я]*|лимон[а-я]*|м|mln)?(\$|сум|сумов|сумм|долл.*|бакс.*)?$/);
  if (!m) return null;
  if (pre) m[3] = '$';
  let n = Number(m[1]); const mul = m[2] || '';
  if (/^(к|k|тыс|т|косар)/.test(mul)) n *= 1e3; if (/^(млн|миллион|лям|лимон|м$|mln)/.test(mul)) n *= 1e6;
  return { amount: n, cur: m[3] && /\$|долл|бакс/.test(m[3]) ? '$' : null };
}
// несколько сумм в одном ответе: «100$ и 500к», «$100 + 500000» → [{amount, cur}, …]
function parseAmounts(s) {
  const parts = String(s).split(/\s+и\s+|\+|;|,\s+/).map(x => x.trim()).filter(Boolean);
  const out = parts.map(parseAmount);
  return out.length > 1 && out.every(Boolean) ? out : null;
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

// скриншот отчёта HPS: «Долг: 52,42 USDT | ≈ 4 607.72 RUB» → { usdt, rub }
async function readHps(ctx, bytes) {
  const prompt = 'This is a screenshot of a supplier debt report in Telegram. Find the line like "Долг: 52,42 USDT | ≈ 4 607.72 RUB". Return ONLY JSON {"usdt": number or null, "rub": number or null}. Use dot as decimal separator, no spaces in numbers. Do not invent.';
  const url = 'data:image/jpeg;base64,' + b64(bytes);
  const r = await ctx.env.AI.run(VISION, { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url } }] }], max_tokens: 80, temperature: 0 });
  let j = r.response;
  if (typeof j !== 'object' || !j) { const m = String(j || '').match(/\{[\s\S]*\}/); if (!m) return null; try { j = JSON.parse(m[0]); } catch (e) { return null; } }
  const rub = num(j.rub), usdt = num(j.usdt);
  return rub > 0 ? { rub, usdt: usdt > 0 ? usdt : null } : null;
}
const OLD_ZALOG = 150000;   // залог прошлого клиента на Капитале, не записан (до бота) — пока висит пометкой в Балансе (владелец 27.11, /claude №7)
const supRound = n => Math.ceil(n / 10000) * 10000;   // долг поставщику — всегда вверх до 10 000 (владелец 27.11: «закидываю ровную сумму»)
// рубли за одну заявку PS SHOP → прибавить к долгу поставщику
// рубли × 202 → ВВЕРХ до 10 000 за каждую заявку; долг = сумма таких ровных чисел (владелец 27.11)
async function addSupRub(ctx, rub) {
  const x = (await store(ctx, { op: 'get', k: 'supDebt' })) || { rub: 0, uzs: 0 };
  const add = supRound(rub * RUB_TO_UZS);
  const v = { rub: Math.round(((x.rub || 0) + rub) * 100) / 100, usdt: null, uzs: (x.uzs || 0) + add, at: Date.now() };
  if (!ctx.dry) { await store(ctx, { op: 'put', k: 'supDebt', v }); await store(ctx, { op: 'put', k: 'supUnknown', v: false }); }
  await putSt(ctx, {});
  ctx.noTrack = true;
  await send(ctx, `🧾 <b>Поставщику скинуть: +${fmt(add)} сум</b>\n(${String(rub).replace('.', ',')} RUB × ${RUB_TO_UZS} = ${fmt(Math.round(rub * RUB_TO_UZS))}, округлил вверх)\n<b>Долг поставщику всего: ${fmt(v.uzs)} сум</b>`);
  await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx);
}
// сохранить долг поставщику и показать СТАРТ
async function setSupDebt(ctx, h) {
  const uzs = supRound(h.rub * RUB_TO_UZS);
  if (!ctx.dry) { await store(ctx, { op: 'put', k: 'supDebt', v: { ...h, uzs, at: Date.now() } }); await store(ctx, { op: 'put', k: 'supUnknown', v: false }); }
  await putSt(ctx, {});
  ctx.noTrack = true;
  await send(ctx, `🧾 <b>Долг поставщику: ${fmt(uzs)} сум</b>\n${h.usdt ? String(h.usdt).replace('.', ',') + ' USDT ≈ ' : ''}${String(h.rub).replace('.', ',')} RUB × ${RUB_TO_UZS}, округлил вверх` +
    '\nОбщий долг обновлён, кнопка висит на СТАРТ.');
  ctx.noTrack = false; return startScreen(ctx);
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
"пришло", "получил", "заплатили мне", "взял за" — Доход. В направлении Аренда PS5 "аренда 300к", "за аренду", "клиент заплатил" — Доход (категория Аренда / Оплата аренды), а расход аренды — только если сказано "потратил", "купил", "расход", "доставка", "реклама". "потратил", "купил", "заплатил", "поели", "расход" — Расход. Перевод между своими картами, снял наличные — "Между своими". "перевёл брату", "брату", "на Арс", "доля брата" — "Между своими" (это перевод на карту брата Арс, НЕ расход). "предоплата", "бронь", "забронировал" — "Предоплата". "залог" — "Залог". "вложил", "вложение", "купил для Leadex технику в долг" — "Вложение". Не уверен — null.
Нет суммы — amount null. Не уверен в категории — null, НЕ угадывай. Для расхода карта — card_from, для дохода — card_to.
Дата: "вчера", "позавчера", "25 ноября" → YYYY-MM-DD, не сказано → null.
Категории по направлениям:
${dirs}
Карты (пиши точно как здесь): ${cfg.cards.map(c => c.name).join('; ')}. "нал", "наличка", "кэш" = Нал. "доллары наличные" = Доллары. "узум", "эпл пей", "apple pay" = Apple Pay (а "вклад" = UZUM вклад, "булка" = Булка).`;
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
  'Продукты': ['продукт', 'еда', 'магазин', 'корзин', 'makro', 'макро', 'havas', 'хавас', 'молок', 'хлеб', 'сыр', 'яйц', 'мясо', 'овощ', 'фрукт'],
  'Бытовая химия': ['химия', 'порошок', 'мыло', 'моющ'], 'Гигиена': ['гигиен', 'шампун', 'зубная паст', 'дезодор', 'бритв'],
  'Одежда': ['одежд', 'кроссов', 'обув', 'футбол', 'куртк'], 'Товары для дома': ['для дома', 'посуд', 'полотен'], 'Вкусняшки': ['вкусн', 'сладк', 'шоколад', 'конфет', 'чипс'],
  'Аренда': ['квартир'], 'Коммунальные услуги': ['коммун', 'свет', 'газ', 'вода'], 'Интернет': ['интернет'], 'Телефония': ['связь', 'телефон', 'мобильн'],
  'Такси': ['такси', 'яндекс'], 'Общественный транспорт': ['автобус', 'метро'], 'Кафе': ['кафе', 'кофе', 'обед', 'ужин', 'плов', 'шаурм'], 'Рестораны': ['ресторан'],
  'Аптека': ['аптек', 'лекарств'], 'Врачи': ['врач', 'доктор', 'клиник', 'анализ'], 'Спортзал': ['спортзал', 'фитнес', 'трениров'], 'Лечение зубов': ['стомат', 'зуб'],
  'Встречи с друзьями': ['друз', 'встреч'], 'Самокат': ['самокат'], 'Подарки': ['подар'], 'Родители': ['родител', 'маме', 'папе', 'маме'], 'Помощь друзьям': ['другу', 'друзьям', 'подруг'], 'Благотворительность': ['благотвор', 'садака', 'пожертв', 'фонд'],
  'Долги': ['долг'], 'Маникюр': ['маникюр', 'ногт'], 'Цветы': ['цвет', 'букет'], 'Развитие': ['курс', 'книг', 'обучен'],
  'Оплата аренды': ['аренд', 'клиент заплатил'],
  'OLX': ['olx', 'олх', 'олкс'], 'Instagram': ['instagram', 'инстаграм', 'инста', 'insta'], 'Telegram': ['telegram', 'телеграм', 'телега', ' тг '],
  'Claude': ['claude', 'клод'], 'Непредвиденные': ['непредвиден'], 'GTA 6': ['gta', 'гта'], 'Подписка': ['подписк', 'plus', 'плюс', 'ea play'], 'Аксессуары': ['аксессуар', 'джойстик', 'геймпад', 'наушник'],
  'Консоль': ['консол', 'приставк'], 'Чистка PlayStation': ['чистк'],
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
  if (/вклад/.test(t)) { const v = cfg.cards.find(c => /вклад/i.test(c.name)); if (v) return v; }
  { const A = [[/главн/, 'Приёмка'], [/арендн/, 'Капитал'], [/ps\s*расход|пс\s*расход/, 'Расходка'], [/\sарс(у|а|е)?[\s.,!]/, 'Арс']];   // названия как в «Балансе» (владелец 27.11)
    for (const [re, w] of A) if (re.test(t)) { const v = cfg.cards.find(c => c.name.startsWith(w)); if (v) return v; } }
  if (/булк/.test(t)) { const v = cfg.cards.find(c => /^Булка/.test(c.name)); if (v) return v; }
  if (/(apple|эпл|эппл|эйпл)|\sузум/.test(t)) return cfg.cards.find(c => c.name === 'Apple Pay') || null;   // карта «Узум 9028» = Apple Pay (владелец 27.11)
  return cfg.cards.find(c => { const short = c.name.toLowerCase().split(' (')[0].replace(/ё/g, 'е'), dig = (c.name.match(/\d{4}/) || [])[0];
    return (short.length >= 3 && t.includes(short.slice(0, Math.max(3, short.length - 1)))) || (dig && t.includes(dig)); }) || null;
}
function matchCard(cfg, s) {
  if (!s) return null;
  s = String(s).toLowerCase();
  if (/apple|эпл|эппл|эйпл|^узум$|узум \(|9028/.test(s) && !/вклад|булк/.test(s)) { const ap = cfg.cards.find(c => c.name === 'Apple Pay'); if (ap) return ap; }   // «узум» = Apple Pay
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
  L.push(`🏢 ${d.dir === 'Leadex' ? 'LEADEX' : d.dir}`);
  L.push(`🔄 ${d.type || '—'}`);
  L.push(`💰 ${d.amount != null ? (d.cur === '$' ? '$' + d.amount : fmt(d.amount) + ' сум') : '—'}`);
  if (needsCat(d.type)) L.push(`🏷 ${d.cat ? (d.group === d.cat || String(d.cat).startsWith(d.group) ? d.cat : d.group + ' / ' + d.cat) : '—'}`);
  const cl = n => n ? cardLabel({ name: n }) : '—';   // показываем как в «Балансе», в таблицу пишется прежнее имя
  if (d.type === 'Между своими') L.push(`💳 ${cl(d.from)} → ${cl(d.to)}`);
  else L.push(`💳 ${cl(isOut(d.type) ? d.from : d.to)}`);
  if (d.until) L.push(`🗓 Срок: ${dm(d.since || d.date)}–${dm(d.until)}`);
  if (d.type === 'Предоплата') L.push(d.dir === 'Leadex' ? `🤝 Сделка: ${esc(d.dealName || '—')}` : `🗓 Бронь на ${d.book ? human(d.book) : '—'}`);
  if (d.type === 'Предоплата' || d.type === 'Залог') L.push('ℹ️ Чужие деньги: в доход не идут, пока не закроете');
  if (d.type === 'Дал в долг') L.push(`🤝 Кому: ${esc(d.whom || '—')}`, `🗓 Вернут: ${d.due ? human(d.due) : '—'}`, 'ℹ️ Не расход: деньги вернутся');
  L.push(`📅 ${human(d.date)}${d.time ? ', ' + d.time : ''}`);
  if (d.comment) L.push(`💬 ${d.comment}`);
  return L.join('\n');
}

// Чего не хватает → спросить. Возвращает true, если всё заполнено.
async function askNext(ctx, cfg, st) {
  if (ctx.wife && st.d) { const d = st.d, b = cardByWord(cfg, 'Булка'); d.dir = 'Личное'; if (d.type !== 'Расход') { d.type = 'Расход'; } d.from = b ? b.name : d.from; d.to = null; d.edit = null; }   // жена: только траты с BULKA
  const d = st.d;
  if (!d.dir) { st.await = null; await putSt(ctx, st);
    return void await send(ctx, `К какому направлению относится: «${esc(d.comment)}»?`, withBack([[[DIRS[0], 'd:0'], [DIRS[1], 'd:1']], [[DIRS[2], 'd:2'], [DIRS[3], 'd:3']]])); }
  if (!d.type) { st.await = null; await putSt(ctx, st);
    return void await send(ctx, 'Это доход или расход?', withBack(typeRows(d.dir))); }
  if (d.amount == null) { st.await = 'amount'; await putSt(ctx, st);
    return void await send(ctx, '💰 Какая сумма? Напишите число, например <code>150000</code> или <code>$50</code>.', withBack()); }
  if (d.dir === 'PS SHOP' && d.type === 'Доход' && !d.cat) {   // категорию дохода PS SHOP не спрашиваем (владелец 26.11); фильтры — позже
    if (d.group) d.cat = d.group; else d.group = d.cat = 'Продажа';
  }
  if (needsCat(d.type) && !d.cat && d.group) {
    const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === d.group);
    if (subs.length) { st.await = null; await putSt(ctx, st); return void await send(ctx, `🏷 ${d.group}: что именно?`, withBack(chunk(subs.map((c, i) => [c.cat, 's:' + i]), 2))); }
  }
  if (needsCat(d.type) && !d.cat) return void await askGroup(ctx, cfg, st);
  if (d.group === 'Непредвиденные' && !/\(.+\)/.test(d.cat || '')) {   // пометка обязательна (владелец 27.11)
    st.await = 'note'; await putSt(ctx, st);
    return void await send(ctx, '✍️ <b>Непредвиденные — что именно?</b> Напишите коротко, например <code>ремонт приставки</code>.', withBack());
  }
  if (d.type === 'Между своими' && d.from && d.from === d.to) d.from = null;   // «с Арс на Арс» — ошибка разбора фото
  if (d.type === 'Между своими' && /^Арс/.test(d.to || '') && !d.from) { const c = cardByWord(cfg, 'Капитал'); if (c) d.from = c.name; }   // брату — всегда с АРЕНДНОЙ (владелец 27.11, /claude №10)
  if (d.type === 'Между своими' && !d.from) return void await askCard(ctx, cfg, st, 'from', '💳 <b>С какой карты?</b>');
  if (d.type === 'Между своими' && !d.to) return void await askCard(ctx, cfg, st, 'to', '💳 <b>На какую карту?</b>');
  if (isOut(d.type) && !d.from) return void await askCard(ctx, cfg, st, 'from', '💳 С какой карты или наличными?');
  if (d.dir === 'Аренда PS5' && !d.edit && ['Предоплата', 'Залог', 'Доход'].includes(d.type) && (!d.ord || (d.ord === 'new' && !d.ps))) {
    // аренда всегда привязана к клиенту = приставке △ ✕ □ (владелец 26.11); занятые приставки (открытые заказы) нового клиента не получают
    const m = await getOrds(ctx), items = await openItems(ctx), os = ordList(m);
    const busy = os.map(o => o.ps).filter(Boolean), free = PS_MARKS.filter(p => !busy.includes(p));
    const rows = [];
    if (!d.ord) for (const o of os) rows.push([[ordInfo(o, items).label, 'cord:' + o.id]]);
    if (free.length) rows.push(free.map(p => [`🆕 ${p}`, 'cps:' + p]));
    st.await = null; await putSt(ctx, st);
    return void await send(ctx, d.ord ? '🎮 <b>Новый клиент: какая приставка?</b>' : '🎮 <b>Какой клиент (приставка)?</b>' + (free.length ? '' : '\nСвободных приставок нет.'), withBack(rows));
  }
  if (d.type === 'Предоплата' && d.dir === 'Аренда PS5' && !d.to) { const c = cardByWord(cfg, 'Капитал'); if (c) d.to = c.name; }   // предоплата аренды всегда на Капитал (владелец 26.11)
  if (isIn(d.type) && !d.to) return void await askCard(ctx, cfg, st, 'to', '💳 На какую карту пришли деньги?');
  if (d.dir === 'Аренда PS5' && d.type === 'Доход' && d.ord && !d.edit && !d.until) {   // срок аренды (владелец 27.11): с какого — по какое
    const o = d.ord !== 'new' ? (await getOrds(ctx))[d.ord] : null;
    d.since = o && o.until && /Продлен/.test(d.cat || '') ? o.until : d.date;
    st.await = 'until'; await putSt(ctx, st);
    const b = [1, 2, 3, 7].map(n => { const y = shiftYmd(d.since, n); return [`${dm(y)} (${n} ${n === 1 ? 'сутки' : n < 5 ? 'суток' : 'суток'})`, 'un:' + y]; });
    return void await send(ctx, `🗓 <b>Аренда с ${dm(d.since)} — до какого числа?</b>\nНажмите или напишите дату, например <code>${dm(shiftYmd(d.since, 1))}</code>.`, withBack(chunk(b, 2)));
  }
  if (d.type === 'Дал в долг' && !d.whom) { st.await = 'whom'; await putSt(ctx, st);
    return void await send(ctx, '🤝 <b>Кому дали в долг?</b> Напишите имя.', withBack()); }
  if (d.type === 'Дал в долг' && !d.due) { st.await = null; await putSt(ctx, st);
    return void await send(ctx, '<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>Когда вернут долг?</b> Выберите дату.', [...await calendar(ctx, todayYmd().slice(0, 7), true)]); }
  if (d.type === 'Предоплата' && d.dir === 'Leadex' && !d.deal) { st.await = 'deal'; await putSt(ctx, st);   // предоплата LEADEX = сделка
    return void await send(ctx, '🤝 <b>Название сделки?</b> Например <code>сайт для Азиза</code>.', withBack()); }
  if (d.type === 'Предоплата' && d.dir !== 'Leadex' && !d.book) { st.await = 'book'; await putSt(ctx, st);
    return void await send(ctx, '<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>На какую дату бронь?</b>\nНажмите кнопку или напишите, например, <code>28.11</code>.',
      withBack([[['Сегодня', 'bd:0'], ['Завтра', 'bd:1'], ['Послезавтра', 'bd:2']], [['Другая дата', 'cl:' + todayYmd().slice(0, 7)]]])); }
  st.await = null; await putSt(ctx, st);
  await send(ctx, summary(d), [[['✅ Записать', 'ok'], ['❌ Отменить', 'no'], ['✏️ Правка', 'ed']], [BACK]]);
  return true;
}
async function askGroup(ctx, cfg, st) {
  const groups = [...new Set(cfg.cats.filter(c => c.dir === st.d.dir && c.kind === st.d.type && !HIDDEN_GROUPS.includes(c.group)).map(c => c.group))];   // «Поставщик» — только бот (владелец 27.11)
  st.await = null; st.groups = groups; await putSt(ctx, st);
  await send(ctx, '🏷 Категория?', withBack(chunk(groups.map((g, i) => [g, 'g:' + i]), 2)));
}
async function askCard(ctx, cfg, st, side, q) {
  st.await = null; st.side = side; await putSt(ctx, st);
  const d = st.d, list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) =>
    isIn(d.type) ? c.inc.includes(d.dir) : isOut(d.type) ? c.exp.includes(d.dir) : true);
  const L = cardSort(list.length ? list : cfg.cards.map((c, i) => ({ c, i })));   // названия как в «Балансе» и тот же порядок — везде (владелец 27.11)
  await send(ctx, q, withBack(chunk(L.map(({ c, i }) => [cardLabel(c), 'k:' + i]), 2)));
}
const cardPos = c => TR_NAMES.findIndex(([k]) => String(c.name).startsWith(k));
const cardLabel = c => (TR_NAMES[cardPos(c)] || [])[1] || c.name;
const cardSort = L => L.slice().sort((a, b) => ((cardPos(a.c) + 1) || 99) - ((cardPos(b.c) + 1) || 99));
const TR_NAMES = [['Приёмка', '⭐ ГЛАВНАЯ'], ['Apple Pay', '🍏 APPLE PAY'], ['Поставщик', '📦 ПОСТАВЩИК'], ['Капитал', '🎮 АРЕНДНАЯ'], ['Нал', '💵 НАЛ'],
  ['Расходка', '🧾 PSРАСХОДЫ'], ['Ипак', '💳 ИПАК'], ['Доллары', '💲 ДОЛЛАРЫ'], ['UZUM вклад', '🏦 ВКЛАД'], ['Булка', '🥖 BULKA CARD'], ['Арс', '💪 АРС (карта брата)']];
const chunk = (a, n) => a.reduce((r, x, i) => (i % n ? r[r.length - 1].push(x) : r.push([x]), r), []);
// эмодзи владельца после записи (владелец 26.11): расход — 💸; доход — 🤑
const DONE_EMO = { 'Расход': '5319172285762919855', 'Дал в долг': '5319172285762919855', 'Вложение': '5319172285762919855', 'Доход': '5391292736647209211' };
// доход — стикер владельца (мишка 🤑, 26.11); расход — премиум-эмодзи 💸
const DONE_STICKER = { 'Доход': 'CAACAgIAAxkBAAICTWsHvj9ZVbXwLGJB0WpnrKZMTRiYAAIEAQAC9wLIDyAPdzvpq8hJPQQ', 'Возврат долга': 'CAACAgIAAxkBAAICTWsHvj9ZVbXwLGJB0WpnrKZMTRiYAAIEAQAC9wLIDyAPdzvpq8hJPQQ' };
async function doneMark(ctx, type) {
  if (DONE_STICKER[type]) return tg(ctx, 'sendSticker', { chat_id: ctx.chat, sticker: DONE_STICKER[type] });
  if (DONE_EMO[type]) return send(ctx, `<tg-emoji emoji-id="${DONE_EMO[type]}">💸</tg-emoji>`);
}
const TEST_WIPE = true;                                   // /start стирает чат — только на время теста (выключить на запуске)
// накопление (владелец 26.11): ВКЛАД = копилка на 14 000 000 сум к 06.01.2027 (вклад больше не резерв PS SHOP)
const GOAL_SUM = 14000000, GOAL_DATE = '05.01.2027';
const PS_RESERVE = 0;                                      // резерв PS SHOP: пока 0% — вся прибыль владельцу (26.11; было 20%)
// служебные категории — не на кнопках (бот ставит их сам): оплата поставщику, доход по умолчанию, проценты
const HIDDEN_GROUPS = ['Поставщик', 'Продажа', 'Проценты по вкладу', 'Доля из PS SHOP (80%)', 'Доля из аренды (40%)', 'Доля из Leadex (50%)'];
// цвета кнопок категорий (владелец 27.11: «чтобы не смешивались») — соседние разные
const CAT_STYLE = { 'Игры PS5': 'success', 'Игры PS4': 'primary', 'GTA 6': 'primary', 'Чистка PlayStation': 'success', 'Аксессуары': 'danger', 'Консоль': 'danger', 'Подписка': 'success',
  'Такси (рабочее)': 'primary', 'Подписки и сервисы': 'success', 'Реклама': 'danger', 'Техника и ремонт': 'primary', 'Прочее': 'success',
  'Игры': 'success', 'Подписки': 'primary', 'Доставка': 'danger',
  'Покупки': 'success', 'Жильё': 'primary', 'Связь': 'danger', 'Транспорт': 'primary', 'Питание': 'danger', 'Здоровье': 'success', 'Развлечения': 'primary', 'Развитие': 'success', 'Подарки': 'danger', 'Помощь': 'success', 'Финансы': 'primary', 'Любовь': 'danger',
  'OLX': 'success', 'Instagram': 'danger', 'Telegram': 'primary', 'Непредвиденные': 'danger' };
const LOGO_STICKER = 'CAACAgEAAxkBAAIDUGsIoKXIO1jH-DR_xAZ2lhxDC9CUAAJ9AgAC3xnYRkWrScNxc61zPQQ';   // 💰 анимированный (27.11); прежнее лого: CAACAgIAAxkBAAIDPGsIn6xPb-Yt094Hbyt2vygJSQOXAAJNrAACXoTAS9-7y8vi2swfPQQ   // лого на экране СТАРТ
const PAD = n => '\u2800'.repeat(n);                    // невидимые символы: Telegram не умеет центрировать текст
const dirMenu = async ctx => { if (ctx.wife) return wifeMenu(ctx); await purge(ctx); return send(ctx, PAD(5) + '<b><tg-emoji emoji-id="5409048419211682843">💵</tg-emoji> ГЛАВНОЕ МЕНЮ <tg-emoji emoji-id="5409048419211682843">💵</tg-emoji></b>' + PAD(3) + '\n' + PAD(8) + 'Выбери раздел' + PAD(5), [[[DIRS[0], 'd:0'], [DIRS[1], 'd:1']], [[DIRS[2], 'd:2'], [DIRS[3], 'd:3']], [['📈 Доходы', 'mr:in'], ['💳 Баланс', 'adj'], ['📉 Расходы', 'mr:out']], [['🎯 Цели', 'gl:', 'primary'], ['🔄 Перевод', 'tr', 'primary']], [['📄 Открыть таблицу', SHEET_URL]], ...await debtRows(ctx), [['↩️ Назад', 'st0']]]); };   // долги и «Назад» → СТАРТ (владелец 26.11)

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
  const row = (id) => [id, { d: when }, ctx.wife ? 'Жена' : 'Наиль', d.dir, d.type, d.group || '', d.cat || '', uzs, usdAmt, rate, from, to, 'ок', d.src || 'текст', d.comment || '', d.ord && d.ord !== 'new' ? d.ord : ''];
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
    ops.push({ op: 'append', sheet: 'Залоги и предоплаты', row: [id, { d: when }, d.type, d.dir, uzs, to, d.book ? { d: Date.parse(d.book) } : '', 'открыт', d.comment || '', d.ord && d.ord !== 'new' ? d.ord : ''] });
  await gas(ctx, ops);
  if (d.dir === 'Аренда PS5' || (d.type === 'Между своими' && /^Арс/.test(d.to || ''))) await rentEvent(ctx, d, id).catch(() => {});   // → рабочая группа
  await wifeEvent(ctx, d, id).catch(() => {});   // жена: её трата → владельцу; перевод на BULKA → жене
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

// ---------- /newschet: выравнивание остатков по всем картам (владелец 27.11, задача 19; временная команда) ----------
const NS_ORDER = TR_NAMES.filter(([k]) => k !== 'Арс');   // 4 главные первыми, потом остальные; карту брата не спрашиваем
async function nsStart(ctx) {
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
  const all = g.values.filter(r => r[0] && r[2]);
  const cards = NS_ORDER.map(([w, t]) => { const r = all.find(r => String(r[0]).startsWith(w)); return r && { card: r[0], t: t.replace(/^\S+\s/, ''), usd: r[2] === '$' }; }).filter(Boolean);
  const ns = { cards, i: 0, res: [] };
  await putSt(ctx, { await: 'ns', ns });
  await send(ctx, '🧮 <b>Сверка остатков</b>\nПо очереди спрошу, сколько сейчас на каждой карте в банке. Пишите сумму числом.\nЕсли не сошлось — запишу поправку (в доходы и расходы она не идёт).');
  return nsAsk(ctx, ns);
}
const nsAmt = (c, v) => c.usd ? '$' + fmt(v) : fmt(v) + ' сум';
async function nsAsk(ctx, ns) {
  if (ns.i >= ns.cards.length) return nsFinish(ctx, ns);
  const c = ns.cards[ns.i];
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
  const r = g.values.find(r => String(r[0]) === c.card); c.now = Number(r && r[8]) || 0;
  await putSt(ctx, { await: 'ns', ns });
  return send(ctx, `🧮 <b>${ns.i + 1}/${ns.cards.length}. ${esc(c.t)}</b>\nПо записям: <b>${nsAmt(c, c.now)}</b>\nСколько сейчас в банке?`,
    [[['✅ Совпадает', 'ns:ok', 'success'], ['Пропустить', 'ns:skip']], [['⛔ Закончить сверку', 'ns:end']]]);
}
async function nsText(ctx, cfg, st, text) {
  const ns = st.ns, c = ns.cards[ns.i];
  if (ns.wait === 'note') return nsSave(ctx, cfg, ns, text.trim().slice(0, 200));
  const a = parseAmount(text);
  if (!a) return send(ctx, `Не понял число. Напишите, сколько на «${esc(c.t)}», например <code>1250000</code>.`);
  const diff = c.usd ? Math.round((a.amount - c.now) * 100) / 100 : Math.round(a.amount - c.now);   // сумы — без копеек
  if (!diff) return onNs(ctx, cfg, st, 'ok');
  ns.bank = a.amount; ns.wait = 'note'; await putSt(ctx, { await: 'ns', ns });
  return send(ctx, `❗ <b>${esc(c.t)}</b>: по записям ${nsAmt(c, c.now)}, в банке ${nsAmt(c, a.amount)} — разница <b>${diff > 0 ? '+' : '−'}${nsAmt(c, Math.abs(diff))}</b>.\n<b>Что это было?</b> Напишите пару слов (например «комиссия», «забыл записать такси»).`,
    [[['🤷 Не знаю', 'ns:idk']]]);
}
async function nsSave(ctx, cfg, ns, note) {
  const c = ns.cards[ns.i], diff = c.usd ? Math.round((ns.bank - c.now) * 100) / 100 : Math.round(ns.bank - c.now);
  const f = { dir: '—', type: 'Корректировка', amount: Math.abs(diff), cur: c.usd ? '$' : 'сум', comment: `Сверка /newschet: по записям ${fmt(c.now)}, в банке ${fmt(ns.bank)}` + (note ? ` (${note})` : '') };
  if (diff > 0) f.to = c.card; else f.from = c.card;
  const rid = await botRec(ctx, cfg, f);
  ns.res.push({ t: c.t, usd: c.usd, now: c.now, bank: ns.bank, diff, note: note || 'Не знаю', rid });
  await send(ctx, `🧮 Записал поправку ${rid}: «${esc(c.t)}» теперь ${nsAmt(c, ns.bank)}.`);
  delete ns.wait; delete ns.bank; ns.i++;
  return nsAsk(ctx, ns);
}
async function onNs(ctx, cfg, st, v) {
  const ns = st.ns; if (!ns) return startScreen(ctx);
  if (v === 'idk') return nsSave(ctx, cfg, ns, '');
  if (v === 'end') return nsFinish(ctx, ns);
  if (v === 'ok') ns.res.push({ t: ns.cards[ns.i].t, ok: true });
  delete ns.wait; delete ns.bank; ns.i++;
  return nsAsk(ctx, ns);
}
async function nsFinish(ctx, ns) {
  await putSt(ctx, {});
  const bad = ns.res.filter(x => !x.ok), ok = ns.res.filter(x => x.ok);
  if (bad.length) {
    const d = todayYmd(), dd = d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4);
    try { await gas(ctx, bad.map(x => ({ op: 'append', sheet: 'Сверки', row: [dd, x.t, x.now, x.bank, x.diff, x.usd ? '$' : 'сум', x.note, x.rid] }))); } catch (e) {}
  }
  const L = ['🧮 <b>Сверка закончена</b>', ''];
  if (bad.length) { L.push(`<b>Недочёты (${bad.length}):</b>`); bad.forEach((x, n) => L.push(`${n + 1}. <b>${esc(x.t)}</b>: ${x.diff > 0 ? '+' : '−'}${nsAmt(x, Math.abs(x.diff))} — ${esc(x.note)}`)); L.push('', 'Записал в лист «Сверки».'); }
  else L.push('✅ Недочётов нет.');
  if (ok.length) L.push('', '✅ Совпало: ' + ok.map(x => esc(x.t)).join(', '));
  ctx.noTrack = true; await send(ctx, L.join('\n')); ctx.noTrack = false;
  return startScreen(ctx);
}

// ---------- Жена (задача 25, владелец 28.11) ----------
// видит: все личные расходы, цели (кроме «Сюрприза»), остаток BULKA CARD; записывает свои траты (с BULKA CARD);
// «💸 Дай денюжку»: сумма → на что → запрос владельцу (✅ Перевёл → с какой карты → перевод на BULKA / ❌ Нет);
// голосовые — сразу пересылаются владельцу; переводы владельца на BULKA — сообщение жене.
const WIFE_OK = ['ok', 'no', 'g', 's', 'dt', 'bk', 'cd', 'noop'];   // кнопки записи, которые ей можно
async function wifeMenu(ctx) {
  await putSt(ctx, {});
  return send(ctx, '👋 <b>Привет!</b> Что делаем?', [[['➖ Записать трату', 'wx', 'danger']], [['💳 BULKA CARD', 'wb'], ['📉 Расходы', 'we']], [['🎯 Цели', 'wg'], ['💸 Дай денюжку', 'wd', 'success']]]);
}
async function wifeBulka(ctx) {
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
  const r = g.values.find(r => /^Булка/.test(String(r[0] || ''))), v = r ? Number(r[8]) || 0 : 0;
  return send(ctx, `💳 <b>BULKA CARD</b>\n\nСейчас на карте: <b>${fmt(v)} сум</b>`, [[['↩️ Меню', 'wm']]]);
}
async function wifeGoals(ctx) {
  const g = await getGoals(ctx); try { await goalProg(ctx, g); } catch (e) {}
  const L = ['🎯 <b>Наши цели</b>', ''];
  for (const id of goalOrder(g)) {
    const x = g.list[id]; if (!x || /сюрприз/i.test(x.name || '')) continue;   // «Сюрприз» — жене не показывать
    const prog = x.prog || x.saved || 0, cur = x.cur === '$' ? '$' : '';
    const money = v => cur ? '$' + fmt(v) : fmt(v);
    L.push(`${x.done ? '✅' : prog >= x.sum ? '🟢' : prog > 0 ? '🔵' : '⚪️'} <b>${esc(x.name)}</b> — ${money(Math.min(prog, x.sum))} из ${money(x.sum)}${x.due ? ' · до ' + dm(x.due) : ''}`);
  }
  if (L.length === 2) L.push('Целей пока нет.');
  return send(ctx, L.join('\n'), [[['↩️ Меню', 'wm']]]);
}
async function onWife(ctx, m, q, cfg) {
  ctx.trail = []; ctx.noTrack = true;
  if (q) {
    await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
    const [k, v] = q.data.split(':'); const mid = q.message.message_id;
    if (k === 'wm') { await gone(ctx, mid); return wifeMenu(ctx); }
    if (k === 'wb') { await gone(ctx, mid); return wifeBulka(ctx); }
    if (k === 'we') { await gone(ctx, mid); return monthReport(ctx, 'out', 3); }
    if (k === 'wg') { await gone(ctx, mid); return wifeGoals(ctx); }
    if (k === 'wx') { await gone(ctx, mid); await putSt(ctx, { dir: 'Личное', ptype: 'Расход' });
      return send(ctx, '➖ <b>Пишите трату</b> — текстом или фото чека. Например: <code>продукты 150000</code>', [[['↩️ Меню', 'wm']]]); }
    if (k === 'wd') { await gone(ctx, mid); await putSt(ctx, { await: 'wsum' });
      return send(ctx, '💸 <b>Сколько нужно?</b> Напишите сумму, например <code>300000</code>.', [[['↩️ Меню', 'wm']]]); }
    if (k === 'wc') {                                   // на что → запрос владельцу
      const st = await getSt(ctx); if (!st.wreq) return wifeMenu(ctx);
      const groups = [...new Set(cfg.cats.filter(c => c.dir === 'Личное' && c.kind === 'Расход').map(c => c.group))];
      const what = v === 'x' ? 'другое' : groups[+v] || 'другое';
      const R = (await store(ctx, { op: 'get', k: 'wreq' })) || { _n: 0 }; const rid = 'W' + (++R._n);
      R[rid] = { id: rid, amount: st.wreq, what, chat: ctx.chat, at: Date.now(), done: false };
      await store(ctx, { op: 'put', k: 'wreq', v: R }); await putSt(ctx, {});
      for (const o of cfg.owners) await tg(ctx, 'sendMessage', { chat_id: o, parse_mode: 'HTML', text: premium(`👩 <b>Дай денюжку: ${fmt(st.wreq)} сум</b>\nНа что: ${esc(what)}`),
        reply_markup: kb([[['✅ Перевёл', 'wp:' + rid, 'success'], ['❌ Нет', 'wn:' + rid, 'danger']]]) }).catch(() => {});
      await edit(ctx, mid, `💸 Попросила ${fmt(st.wreq)} сум — ${esc(what)}.\nНаиль получил запрос, ответ придёт сюда.`);
      return wifeMenu(ctx);
    }
    if (!WIFE_OK.includes(k)) return;                   // остальные кнопки — не для неё
    return onCallback(ctx, q, true);
  }
  const text = (m.text || '').trim();
  if (/^\/(start|menu)(@\w+)?$/i.test(text) || /^(отмена|стоп|меню)$/i.test(text)) return wifeMenu(ctx);
  if (m.voice || m.audio || m.video_note) {             // голосовое — сразу владельцу (владелец 28.11)
    for (const o of cfg.owners) await tg(ctx, 'forwardMessage', { chat_id: o, from_chat_id: ctx.chat, message_id: m.message_id }).catch(() => {});
    const f = m.voice || m.audio || m.video_note;
    const said = await transcribe(ctx, await tgFile(ctx, f.file_id)).catch(() => '');
    const st = await getSt(ctx);
    if (said && (st.d || st.await === 'wsum' || st.ptype)) return onWife(ctx, { ...m, voice: null, audio: null, video_note: null, text: said }, null, cfg);
    return send(ctx, '🎤 Переслала Наилю' + (said ? ': «' + esc(said) + '»' : '.') + (said && /\d/.test(said) ? '\nЕсли это трата — нажмите «➖ Записать трату» и повторите.' : ''), [[['↩️ Меню', 'wm']]]);
  }
  const st = await getSt(ctx);
  if (st.await === 'wsum') {                            // «Дай денюжку»: сумма → на что
    const a = parseAmount(text); if (!a) return send(ctx, 'Напишите сумму числом, например <code>300000</code>.');
    await putSt(ctx, { wreq: a.amount });
    const groups = [...new Set(cfg.cats.filter(c => c.dir === 'Личное' && c.kind === 'Расход').map(c => c.group))];
    return send(ctx, `💸 <b>${fmt(a.amount)} сум — на что?</b>`, [...chunk(groups.map((g, i) => [g, 'wc:' + i]), 2), [['Другое', 'wc:x']], [['↩️ Меню', 'wm']]]);
  }
  const img = m.photo ? m.photo[m.photo.length - 1] : null;
  if (img) {
    await send(ctx, '📷 Читаю фото…');
    const seen = await readReceipt(ctx, await tgFile(ctx, img.file_id));
    if (!seen) return send(ctx, '📷 Не смогла прочитать. Напишите текстом, например <code>продукты 150000</code>.');
    ctx.ptype = 'Расход'; return startDraft(ctx, cfg, 'Личное', (m.caption ? m.caption + '. ' : '') + seen, 'фото');
  }
  if (!text) return;
  if (st.d && st.await) return onMessage(ctx, m);       // ответ на вопрос записи (пометка, дата)
  ctx.ptype = 'Расход'; return startDraft(ctx, cfg, 'Личное', text, 'текст');
}
async function wifeText(ctx, cfg, st, m, text) {
  if (!text) return;
  if (/^\//.test(text)) return wifeMenu(ctx);          // чужие команды — просто её меню
  if (st.d && st.await) return draftText(ctx, cfg, st, m, text);
  ctx.ptype = 'Расход'; return startDraft(ctx, cfg, 'Личное', text, 'текст');
}
async function wifeEvent(ctx, d, id) {
  const cfg = await config(ctx), money = d.cur === '$' ? '$' + fmt(d.amount) : fmt(d.amount) + ' сум';
  if (ctx.wife) { for (const o of cfg.owners) await tg(ctx, 'sendMessage', { chat_id: o, parse_mode: 'HTML', text: premium(`👩 <b>Жена записала:</b> ${esc(d.cat || d.group || d.type)} — ${money} (BULKA, ${id})`) }).catch(() => {}); return; }
  if (d.type === 'Между своими' && /^Булка/.test(d.to || '') && !/^Жене:/.test(d.comment || '')) {   // перевод на BULKA → жене (владелец 28.11); по «Дай денюжку» — своё сообщение
    if (ctx.dry) { ctx.out.push({ method: 'WIFE', text: `💸 На BULKA CARD: +${money}` }); return; }
    for (const w of cfg.wife || []) await tg(ctx, 'sendMessage', { chat_id: w, parse_mode: 'HTML', text: premium(`💸 <b>На BULKA CARD: +${money}</b>`) }).catch(() => {});
  }
}
async function onWifeReq(ctx, cfg, k, v, mid) {          // владелец отвечает на «Дай денюжку»
  const R = (await store(ctx, { op: 'get', k: 'wreq' })) || {}; const [rid, ci] = v.split('|'); const x = R[rid];
  if (!x || x.done) return edit(ctx, mid, 'Этот запрос уже закрыт.');
  if (k === 'wn') { x.done = 'нет'; await store(ctx, { op: 'put', k: 'wreq', v: R });
    await tg(ctx, 'sendMessage', { chat_id: x.chat, parse_mode: 'HTML', text: premium(`❌ Наиль: сейчас не получится (${fmt(x.amount)} — ${esc(x.what)}).`) }).catch(() => {});
    return edit(ctx, mid, `❌ Отказ: ${fmt(x.amount)} сум — ${esc(x.what)}. Жене сообщил.`); }
  const b = cardByWord(cfg, 'Булка');
  if (k === 'wp') {
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.cur === 'сум' && c !== b && !/^Арс/.test(c.name));
    return edit(ctx, mid, `👩 ${fmt(x.amount)} сум — ${esc(x.what)}\n<b>С какой карты перевели на BULKA CARD?</b>`, chunk(cardSort(list).map(({ c, i }) => [cardLabel(c), `wpf:${rid}|${i}`]), 2));
  }
  const src = cfg.cards[+ci]; if (!src || !b) return edit(ctx, mid, 'Карта не найдена.');
  const id = await botRec(ctx, cfg, { dir: 'Личное', type: 'Между своими', amount: x.amount, from: src.name, to: b.name, comment: `Жене: ${x.what}` });
  x.done = id; await store(ctx, { op: 'put', k: 'wreq', v: R });
  await tg(ctx, 'sendMessage', { chat_id: x.chat, parse_mode: 'HTML', text: premium(`✅ <b>Наиль перевёл ${fmt(x.amount)} сум</b> на BULKA CARD — ${esc(x.what)}.`) }).catch(() => {});
  return edit(ctx, mid, `✅ Записал перевод ${fmt(x.amount)}: ${cardLabel(src)} → 🥖 BULKA CARD (${id}). Жене сообщил.`, [[['🗑 Отменить', 'rm:' + id]]]);
}
async function onTool(ctx, q) {
  const cfg = await config(ctx);
  const [k, id] = q.data.split(':'); const mid = q.message.message_id;
  if (k !== 'adj') ctx.noTrack = true;                  // залоги/брони — результаты остаются
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'zl') { await gone(ctx, mid); return rentOrders(ctx); }
  if (k === 'zl_old') {
    const items = await openItems(ctx);
    await gone(ctx, mid);
    if (!items.length) return send(ctx, 'Открытых залогов и броней нет.');
    for (const x of items) await send(ctx, itemText(x), itemButtons(x));
    return;
  }
  if (k === 'adj') {
    await gone(ctx, mid);
    await putSt(ctx, {});                                   // «Баланс» только показывает остатки (владелец 26.11); исправление — не здесь
    const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:J20' }]);
    // порядок и подписи (владелец 26.11); карту брата не показываем — её смотрит брат
    const ORDER = [['Приёмка', 'ГЛАВНАЯ', '⭐ <b>Основные</b>'], ['Apple Pay', 'APPLE PAY'], ['Поставщик', 'ПОСТАВЩИК', '—'], ['Капитал', 'АРЕНДНАЯ'], ['Нал', 'НАЛ', '—'],
      ['Расходка', 'PSРАСХОДЫ'], ['Ипак', 'ИПАК'], ['Доллары', 'ДОЛЛАРЫ', '—'], ['UZUM вклад', 'ВКЛАД'], ['Булка', 'BULKA CARD']];   // Булка — накопительная, в конце (владелец 27.11, /claude №5)
    const all = g.values.filter(r => r[0] && r[2] && !/^Арс/.test(r[0]));
    const rows = [...ORDER.map(([w, t, h]) => { const r = all.find(r => String(r[0]).startsWith(w)); return r && { r, t, h }; }).filter(Boolean),
      ...all.filter(r => !ORDER.some(([w]) => String(r[0]).startsWith(w))).map(r => ({ r, t: r[0] }))];
    let tot = 0, alien = 0, n = 0; const L = ['<b>💳 Баланс по картам</b>', ''];
    const fond = ((await getGoals(ctx)).cush || {}).total || 0;   // доллары: 🔒 ФОНД (подушка) + отложено (владелец 27.11)
    let broDue = 0; try { broDue = Math.max(0, (await rentOwe(ctx, cfg)).due); } catch (e) {}   // АРЕНДНАЯ: залог / брата / ваше (/claude №6)
    for (const { r, t, h } of rows) {
      if (h) L.push(h === '—' ? '┈┈┈┈┈┈┈┈┈┈' : h, '');
      const v = Number(r[8]) || 0, j = Number(r[9]) || 0, usd = r[2] === '$';
      const rent = t === 'АРЕНДНАЯ', bro = rent ? Math.min(broDue, Math.max(0, v - j)) : 0, mine = rent ? Math.max(0, v - j - bro) : 0;
      L.push(`${++n}. <b>${esc(t)}</b>\n      <b>${usd ? '$' + fmt(v) : fmt(v) + ' сум'}</b>${j && !rent ? ` (из них чужие ${fmt(j)})` : ''}`
        + (rent && v ? (j ? `\n      🔐 Залог: <b>${fmt(j)}</b>` : '') + (bro ? `\n      💪 Брата: <b>${fmt(bro)}</b>` : '') + (mine ? `\n      🧡 Ваше: <b>${fmt(mine)}</b>` + (mine <= OLD_ZALOG ? ' (залог от прошлого клиента)' : ` (из них ${fmt(OLD_ZALOG)} — залог от прошлого клиента) — можно перевести себе ${fmt(mine - OLD_ZALOG)}`) : '') : '')
        + (t === 'ДОЛЛАРЫ' ? `\n      🔒 ФОНД: <b>$${fmt(Math.min(fond, v))}</b>\n      💼 Отложено: <b>$${fmt(Math.max(0, v - fond))}</b>` : '') , '');
      if (!usd) { tot += v; alien += j + bro; }   // доля брата — тоже не ваша
    }
    L.push('━━━━━━━━━━', `Всего в сумах: <b>${fmt(tot)}</b>`); if (alien) L.push(`Из них мои: <b>${fmt(tot - alien)}</b>`);
    return send(ctx, L.join('\n'), [[BACK]]);
  }
  if (k === 'aj') {
    const c = cfg.cards[+id];
    await gone(ctx, mid);
    await putSt(ctx, { tool: { kind: 'adj', card: c.name, cur: c.cur }, await: 'tool' });
    return send(ctx, `Сколько сейчас на самом деле на «${c.name}»? Напишите число${c.cur === '$' ? ' в долларах' : ''}.`, withBack());
  }
  const items = await openItems(ctx); const x = items.find(i => i.id === id);
  if (!x) return edit(ctx, mid, 'Эта запись уже закрыта.');
  if (k === 'zr') return edit(ctx, mid, `Вернуть клиенту ${fmt(x.sum)} сум с «${x.card}»?`, [[['✅ Да, вернул', 'zry:' + id], ['Нет', 'ar:list']]]);
  if (k === 'zry') {
    const rid = await botRec(ctx, cfg, { dir: x.dir, type: 'Возврат залога', amount: x.sum, from: x.card, comment: 'Возврат залога ' + x.id });
    await setItem(ctx, x, 0, 'закрыт');
    return edit(ctx, mid, `↩️ Залог ${x.id} вернули клиенту: ${fmt(x.sum)} сум с «${x.card}» (${rid}). Это не расход.` + await closeOrdIfDone(ctx, x.id));
  }
  if (k === 'zp' || k === 'zk') {
    await putSt(ctx, { tool: { kind: k, id }, await: 'tool' });
    return edit(ctx, mid, itemText(x) + `\n\n${k === 'zp' ? '➕ Сколько ушло на продление' : '✋ Сколько оставляете себе'}? Напишите число (не больше ${fmt(x.sum)}).`, withBack());
  }
  if (k === 'pb') {
    const rid = await botRec(ctx, cfg, { dir: x.dir, type: 'Доход', group: x.dir === 'Аренда PS5' ? 'Аренда' : '', cat: 'Сгоревшая предоплата', amount: x.sum, comment: 'Сгорела предоплата ' + x.id });
    await setItem(ctx, x, 0, 'сгорела');
    { const m = await getOrds(ctx); const o = ordOf(m, x.id); if (o) { o.paid = true; await putOrds(ctx, m); } }
    await edit(ctx, mid, `🔥 Предоплата ${x.id} сгорела: ${fmt(x.sum)} сум теперь доход (${rid}).` + await closeOrdIfDone(ctx, x.id));
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
  if (t.kind === 'sut') { await putSt(ctx, {}); return supTopUp(ctx, cfg, a.amount); }
  if (t.kind === 'interest') {          // 1-е число: проценты по UZUM вкладу → доход PS SHOP
    const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
    const r = g.values.find(r => String(r[0]) === t.card); const now = Number(r && r[8]) || 0;
    const diff = Math.round(a.amount - now);
    await putSt(ctx, {});
    if (diff <= 0) { st.tool = { kind: 'adj', card: t.card, cur: 'сум' }; return diff === 0 ? send(ctx, '✅ Совпадает, процентов не прибавилось.') : onToolText(ctx, cfg, st, text); }
    // вклад = копилка владельца (26.11): проценты банка не доход PS SHOP, просто прибавляем к вкладу
    const rid = await botRec(ctx, cfg, { dir: '—', type: 'Корректировка', amount: diff, to: t.card, comment: 'Проценты банка по вкладу за месяц' });
    return send(ctx, `💰 Банк добавил на «${t.card}»: +${fmt(diff)} сум (${rid}). На вкладе теперь ${fmt(a.amount)}.`, [[['🗑 Отменить', 'rm:' + rid]]]);
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
      [[['🗑 Отменить', 'rm:' + rid]]]);
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
      left > 0 ? [[['↩️ Вернул остаток', 'zr:' + x.id]]] : null);
    if (x.dir !== 'Аренда PS5') return;
    ctx.noTrack = true; if (await rentShare(ctx, cfg)) return;   // ждём ответ про брата
    await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx);
  }
  if (t.kind === 'pc') {
    if (!a.amount) return finishPrepay(ctx, cfg, x, 0, null);
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.inc.includes(x.dir));
    await putSt(ctx, {});
    return send(ctx, `💳 Куда пришла доплата ${fmt(a.amount)}?`, chunk(cardSort(list).map(({ c, i }) => [cardLabel(c), `pk:${x.id}|${i}|${a.amount}`]), 2));
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
      await send(ctx, `📅 Начало месяца. Сколько сейчас на «${dep.name}»? Напишите сумму из приложения — разницу (проценты банка) прибавлю к вкладу.`); }
  }
  try { const p = await fmToday(ctx); ctx.noTrack = true; await send(ctx, '☀️ <b>Доброе утро!</b>\n' + fmLine(p), [[['📊 План', 'fp', 'primary']]]); ctx.noTrack = false; } catch (e) {}   // дневной план каждое утро
  for (const x of Object.values((await store(ctx, { op: 'get', k: 'loans' })) || {})) {   // долги мне: в день возврата
    if (x.done || !x.due || x.due > today) continue;
    await send(ctx, `🤝 <b>Сегодня должны вернуть долг</b>\n${esc(x.whom)}: ${fmt(x.sum)} сум`, [[['✅ Вернули', 'ln:' + x.id]]]);
  }
  for (const x of await openItems(ctx)) {
    if (x.type !== 'Предоплата' || !x.book || !x.book.d) continue;
    if (ymdT(new Date(x.book.d + TZ_MS)) > today) continue;
    const o = ordOf(await getOrds(ctx), x.id);
    await send(ctx, 'Клиент приехал?\n' + itemText(x) + (o ? `\nЗаказ ${o.id}` : ''), o ? [[['✅ Приехал', `ao:in|${o.id}`], ['🔥 Сгорела', 'pb:' + x.id]]] : itemButtons(x));
  }
}


// ---------- Leadex: распределение каждого поступления ----------
// 20% фонд, 20% возврат вложений Наилю (пока не вернулись), из остального — расходы Leadex с прошлого поступления, остаток 50/50.
// Карты получателей пока не заданы (владелец 26.11: «сделай пока виртуальную кнопку»).
async function leadexSplit(ctx, cfg, id, amount) {
  ctx.noTrack = true;
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
  const L = [`💼 <b>LEADEX: пришло ${fmt(amount)} сум</b> (${id})`,
    `Расходы LEADEX с прошлого поступления: ${fmt(exp)}`, '',
    `• Фонд LEADEX 20%: <b>${fmt(fund)}</b> → карта фонда (не выбрана)`,
    ret ? `• Возврат вложений вам: <b>${fmt(ret)}</b> (останется вернуть ${fmt(invLeft - ret)})` : '• Вложения уже возвращены',
    over ? `⚠️ Расходы (${fmt(exp)}) больше, чем осталось на них (${fmt(pool)}). Долей в этот раз нет.\n💰 <b>Нужно вложить: ${fmt(exp - pool)}</b> — запишу как вложение, оно вернётся вам из следующих поступлений (20%).`
         : `• Расходы покрыты: ${fmt(exp)}\n• Вам 50%: <b>${fmt(half)}</b>\n• Ришату 50%: <b>${fmt(rest - half)}</b> → карта Ришата (не выбрана)`];
  x.short = over ? exp - pool : 0; await store(ctx, { op: 'put', k: 'lx:' + id, v: x });
  const kb = [[['✅ Перевёл', 'lxok:' + id], ['Позже', 'lxno:' + id]]];
  if (over) kb.push([['💰 Вложил ' + fmt(x.short), 'lxin:' + id]]);
  await send(ctx, L.join('\n'), kb); return true;              // ждём ответ: дальше ничего не шлём
}
async function onLeadex(ctx, q) {
  ctx.noTrack = true;
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
    return edit(ctx, mid, `✅ Записал вложение ${fmt(amt)}${src ? `: «${src.name}»${lx ? ' → «' + lx.name + '»' : ''}` : ''} (${rid}). Оно добавлено к сумме, которую LEADEX возвращает вам.`);
  }
  const x = await store(ctx, { op: 'get', k: 'lx:' + id });
  if (!x) return edit(ctx, mid, 'Расчёт не найден.');
  if (k === 'lxin') {                                     // вложение недостающей суммы: с какой карты
    if (!x.short) return edit(ctx, mid, 'Вложение уже записано.');
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.cur === 'сум');
    return send(ctx, `С какой карты вложили ${fmt(x.short)} в LEADEX?`, [...chunk(cardSort(list).map(({ c, i }) => [cardLabel(c), `lxif:${id}|${i}`]), 2), [['Только записать', `lxif:${id}|-`]]]);
  }
  if (k === 'lxno') { await unkb(ctx, mid); await send(ctx, 'Хорошо, позже. Расчёт остаётся выше.', [[['✅ Перевёл', 'lxok:' + id]]]); await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx); }
  if (x.done) return edit(ctx, mid, 'Уже отмечено.');
  const recs = [];
  if (x.ret) recs.push(await botRec(ctx, cfg, { dir: 'Leadex', type: 'Возврат вложений', cat: 'Возврат вложений Leadex', amount: x.ret, comment: 'Возврат вложений из ' + id }));
  if (x.nail) recs.push(await botRec(ctx, cfg, { dir: 'Личное', type: 'Доход', group: 'Доля из Leadex (50%)', cat: 'Доля из Leadex (50%)', amount: x.nail, comment: 'Доля из ' + id }));
  await gas(ctx, [{ op: 'append', sheet: 'Доли', row: [{ d: Date.now() }, id, x.amount, x.over ? 0 : x.exp, x.fund, x.ret, x.nail, x.rishat, x.over ? 'расходы > 60%, доли не начислены, нехватка → вложение' : 'отмечено'] }]);
  x.done = true; await store(ctx, { op: 'put', k: 'lx:' + id, v: x });
  if (!ctx.dry) await store(ctx, { op: 'put', k: 'lxLast', v: Date.now() });
  await edit(ctx, mid, `✅ Отмечено. ${recs.length ? 'Записал: ' + recs.join(', ') + '. ' : ''}Таблица «Доли» обновлена.`);
  await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx);
}


// ---------- Журнал целиком (для расчётов долей) ----------
async function journal(ctx) {
  const [j] = await gas(ctx, [{ op: 'get', sheet: 'Журнал', range: 'A2:P3000' }]);
  return j.values.filter(r => r[0] && r[12] !== 'удалено').map(r => ({ id: r[0], t: r[1] && r[1].d || 0, dir: r[3], type: r[4], group: r[5], cat: r[6], uzs: Number(r[7]) || 0, from: r[10], to: r[11], ord: r[15] || '' }));
}
const cardByWord = (cfg, w) => cfg.cards.find(c => c.name.toLowerCase().startsWith(w.toLowerCase()));

// ---------- PS SHOP: «закрыл оплату» → поставщик, чистая прибыль, 80/20 ----------
// экран долга поставщику (владелец 27.11, /claude №8): долг, остаток на карте ПОСТАВЩИК, сколько докинуть с ГЛАВНОЙ (вверх до 10 000)
async function supNums(ctx) {
  const due = (await store(ctx, { op: 'get', k: 'supUnknown' })) ? 0 : await supDue(ctx);
  let card = 0; try { const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]); const r = g.values.find(r => String(r[0]).startsWith('Поставщик')); card = Math.round(Number(r && r[8]) || 0); } catch (e) {}
  return { due, card, top: due > card ? supRound(due - card) : 0 };
}
async function supScreen(ctx) {
  const { due, card, top } = await supNums(ctx);
  const t = due > 0 ? `🧾 <b>Поставщику: ${fmt(due)} сум</b>\n💳 На карте ПОСТАВЩИК: <b>${fmt(card)} сум</b>\n` +
    (top ? `👉 <b>Докинуть с основной карты: ${fmt(top)} сум</b>` : '✅ <b>На карте хватает, докидывать не нужно</b>')
    : `🧾 <b>Поставщику есть долг</b>, сумма не записана.\n💳 На карте ПОСТАВЩИК: <b>${fmt(card)} сум</b>`;
  return send(ctx, t, [[['💸 Перевёл на карту поставщика', 'sut', 'primary']], [['✍️ Добавить рубли', 'sp:rub']], [['✅ Поставщик списал (оплатил)', 'supd']], [['↩️ Назад', 'st0']]]);
}
async function supTopUp(ctx, cfg, amount) {
  const from = cardByWord(cfg, 'Приёмка'), to = cardByWord(cfg, 'Поставщик');
  const rid = await botRec(ctx, cfg, { dir: 'Личное', type: 'Между своими', amount, from: from.name, to: to.name, comment: 'Пополнение карты поставщика' });
  await send(ctx, `✅ Записал перевод ${fmt(amount)}: ГЛАВНАЯ → ПОСТАВЩИК (${rid}).`, [[['🗑 Отменить', 'rm:' + rid]]]);
  return supScreen(ctx);
}
async function closeSupplier(ctx, cfg) {
  const sup = cardByWord(cfg, 'Поставщик');
  await putSt(ctx, { tool: { kind: 'sup', card: sup.name }, await: 'tool' });
  return send(ctx, `🧾 Закрыли оплату поставщику. Сколько <b>осталось</b> на «ПОСТАВЩИК»? Напишите число из приложения банка.`, [[['↩️ Назад', 'dsup']]]);   // долг стирается только после ответа
}
async function supplierDone(ctx, cfg, card, left) {
  ctx.noTrack = true;
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:I20' }]);
  const r = g.values.find(r => String(r[0]) === card); const before = Number(r && r[8]) || 0;
  const paid = Math.round(before - left);
  await putSt(ctx, {});
  if (paid <= 0) return send(ctx, `По записям на «ПОСТАВЩИК» было ${fmt(before)}, вы пишете ${fmt(left)}. Оплаты не видно, долг не трогаю.`);
  if (!ctx.dry) { await store(ctx, { op: 'put', k: 'supDebt', v: null }); await store(ctx, { op: 'put', k: 'supUnknown', v: false }); }   // долг погашен — только теперь (владелец 27.11)
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
    await send(ctx, L.join('\n')); await doneMark(ctx, 'Расход'); return startScreen(ctx); }   // оплата поставщику = расход → 💸
  const mine = Math.round(net * (1 - PS_RESERVE)), res = net - mine;
  const nid = await botRec(ctx, cfg, { dir: 'Личное', type: 'Доход', group: 'Доля из PS SHOP (80%)', cat: 'Доля из PS SHOP (80%)', amount: mine, comment: `Прибыль PS SHOP ${Math.round((1 - PS_RESERVE) * 100)}% по расчёту ` + sid });
  await gas(ctx, [{ op: 'set', sheet: 'Доли', range: 'K5:Q5', values: [['PS SHOP: дата', 'Поступления', 'Поставщику', 'На Расходку', 'Чистая прибыль', 'Наилю 80%', 'Резерв 20%']] },
    { op: 'append', sheet: 'Доли', row: ['', '', '', '', '', '', '', '', '', '', { d: Date.now() }, income, supPaid, toExp, net, mine, res] }]);
  if (!res) { L.push('', `• Вся прибыль вам: <b>${fmt(mine)}</b> — записал в «Личное» (${nid})`); await send(ctx, L.join('\n')); await doneMark(ctx, 'Расход'); return startScreen(ctx); }
  await store(ctx, { op: 'put', k: 'res:' + sid, v: { amount: res } });
  L.push('', `• Вам ${Math.round((1 - PS_RESERVE) * 100)}%: <b>${fmt(mine)}</b> — записал в «Личное» (${nid})`, `• В резерв ${Math.round(PS_RESERVE * 100)}%: <b>${fmt(res)}</b>`);
  return send(ctx, L.join('\n'), [[['✅ Перевёл в резерв', 'rsv:' + sid], ['Позже', 'rsvl:' + sid]]]);
}

// ---------- Аренда: доля брата 60% после каждой сделки ----------
// ---------- Аренда: вложения брата (задача 18, владелец 27.11) ----------
// Брат вложил сумму в $ (DO rentInv.usd, ставится /rentinv — сумма не в коде). Пока не вернулась: брату 60%, Наилю 40%;
// вернулось = остаток карты Арс (по курсу ЦБ). Доли НЕ меняются автоматически (владелец 27.11: «сначала закроем долг, там решим») — всегда брату 60%, Наилю 40%.
async function rentInvState(ctx, cfg, profit) {
  const inv = (await store(ctx, { op: 'get', k: 'rentInv' })) || null;
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:J20' }]);
  const r = g.values.find(r => /^Арс/.test(String(r[0] || ''))), ars = r ? Number(r[8]) || 0 : 0, rate = await cbuRate(ctx, todayYmd());
  const back = Math.round(ars / rate), left = inv ? Math.max(0, inv.usd - back) : 0;
  return { inv, ars, back, left, rate };
}
function rentSplit(inv, profit) {                       // сколько всего положено брату и Наилю с начала учёта
  return { bro: profit * 0.6, mine: profit * 0.4, pb: 60, pm: 40 };   // смены долей нет (владелец 27.11)
}
async function rentInvScreen(ctx, cfg) {
  const s = await rentInvState(ctx, cfg, null);
  if (!s.inv) return send(ctx, '💼 Вложения в аренду не заданы.', [[['↩️ Назад', 'd:1']]]);
  const L = ['💼 <b>Вложения брата в аренду</b>', '',
    `💰 Вложено: <b>$${fmt(s.inv.usd)}</b>`, `✅ Вернулось: <b>$${fmt(Math.min(s.back, s.inv.usd))}</b> (${fmt(s.ars)} сум на Арс)`,
    s.left > 0 ? `⏳ Осталось: <b>$${fmt(s.left)}</b> (${Math.round((s.inv.usd - s.left) / s.inv.usd * 100)}%)` : '🎉 Вернулось полностью', '',
    ctx.viewer ? 'Доли: <b>вам 60%</b>, Наилю 40%.' : 'Доли: брату 60%, вам 40%.'];
  { const J = await journal(ctx), ars = cardByWord(cfg, 'Арс');
    const inc = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Доход').reduce((a, x) => a + x.uzs, 0), exp = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Расход').reduce((a, x) => a + x.uzs, 0);
    const paid = ars ? J.filter(x => x.type === 'Между своими' && x.to === ars.name).reduce((a, x) => a + x.uzs, 0) : 0, owe = Math.round(rentSplit(s.inv, inc - exp).bro);
    L.push('', ctx.viewer ? '💪 <b>Ваша доля по аренде</b> (с 26.11)' : '👤 <b>Брату по аренде</b> (с 26.11)', `Прибыль: ${fmt(inc - exp)}`, `${ctx.viewer ? 'Положено вам' : 'Положено брату'}: ${fmt(owe)}`, `${ctx.viewer ? 'Переведено вам' : 'Отдано'}: ${fmt(paid)}`,
      owe - paid > 0 ? (ctx.viewer ? `⏳ К переводу вам: <b>${fmt(owe - paid)}</b>` : `❗ Должен брату: <b>${fmt(owe - paid)}</b>`) : (ctx.viewer ? '✅ Всё переведено' : '✅ Брату ничего не должен')); }
  return send(ctx, L.join('\n'), [[['↩️ Назад', 'd:1']]]);
}
// ---------- Брат и рабочая группа (задача по аренде, владелец 27.11) ----------
async function rentOwe(ctx, cfg) {                     // сколько брату положено / отдано / должен
  const J = await journal(ctx), ars = cardByWord(cfg, 'Арс');
  const inc = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Доход').reduce((a, x) => a + x.uzs, 0), exp = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Расход').reduce((a, x) => a + x.uzs, 0);
  const paid = ars ? J.filter(x => x.type === 'Между своими' && x.to === ars.name).reduce((a, x) => a + x.uzs, 0) : 0;
  const inv = await store(ctx, { op: 'get', k: 'rentInv' }), owe = Math.round(rentSplit(inv, inc - exp).bro);
  return { inc, exp, profit: inc - exp, owe, paid, due: owe - paid };
}
async function rentNotify(ctx, text, broText) {        // событие аренды → рабочая группа + лично брату (владелец 27.11, ответ 15); без карт
  const cfg = await config(ctx);
  const bros = (cfg.viewersTest && cfg.viewersTest.length) ? cfg.viewersTest : (cfg.viewers || []);   // пока проверяем — только тестовому
  let tail = ''; try { const o = await rentOwe(ctx, cfg); tail = `\n\n💪 Брату: ${o.due > 0 ? 'к переводу <b>' + fmt(o.due) + '</b>' : 'всё переведено ✅'}`; } catch (e) {}
  const forBro = (broText || text) + (broText ? '' : tail.replace('💪 Брату: к переводу', '💪 К переводу вам:').replace('💪 Брату: всё переведено', '💪 Вам всё переведено'));
  if (ctx.dry) { ctx.out.push({ method: 'GROUP', text: text + tail }); for (const b of bros) ctx.out.push({ method: 'BRO ' + b, text: forBro }); return; }
  const gid = await store(ctx, { op: 'get', k: 'rentGroup' });
  if (gid) await tg(ctx, 'sendMessage', { chat_id: gid, text: premium(text + tail), parse_mode: 'HTML' }).catch(() => {});
  for (const b of bros) await tg(ctx, 'sendMessage', { chat_id: b, text: premium(forBro), parse_mode: 'HTML' }).catch(() => {});
}
async function rentEvent(ctx, d, id) {                 // запись по аренде → в группу
  const money = d.cur === '$' ? '$' + fmt(d.amount) : fmt(d.amount) + ' сум', ord = d.ord && d.ord !== 'new' ? ' · заказ ' + d.ord : '';
  const ps = d.ps ? ' ' + d.ps : '';
  const per = d.until ? ` · ${dm(d.since || d.date)}–${dm(d.until)}` : '';
  const t = d.type === 'Доход' ? `💵 <b>${/Продлен/.test(d.cat || '') ? 'Продление' : 'Оплата аренды'}${ps}: ${money}</b>${per}${ord}`
    : d.type === 'Предоплата' ? `🆕 <b>Бронь${ps}: предоплата ${money}</b>${ord}${d.book ? ' · на ' + human(d.book) : ''}`
    : d.type === 'Залог' ? `🔐 <b>Залог взят: ${money}</b>${ord}`
    : d.type === 'Возврат залога' ? `↩️ <b>Залог возвращён: ${money}</b>${ord}`
    : d.type === 'Расход' ? `💸 <b>Расход аренды: ${esc(d.cat || d.group || '')} ${money}</b>`
    : d.type === 'Между своими' && /^Арс/.test(d.to || '') ? `💪 <b>Брату переведено: ${money}</b>` : null;
  if (t) await rentNotify(ctx, t, d.type === 'Между своими' ? `💪 <b>Перевод: ${money}</b>` : null);   // без комментариев: там бывают карты (ответы 16, 18, 19)
}
// брату: каждая оплата аренды строкой со сроком (дд.мм–дд.мм), расходы — дата, на что, сумма; без карт (владелец 27.11)
async function rentList(ctx, T, back) {
  const [j] = await gas(ctx, [{ op: 'get', sheet: 'Журнал', range: 'A2:P3000' }]);
  const ym = todayYmd().slice(0, 7), [y, mo] = ym.split('-').map(Number), m = await getOrds(ctx);
  const recs = j.values.filter(r => r[0] && r[12] !== 'удалено' && r[3] === 'Аренда PS5' && r[4] === T && r[1] && r[1].d)
    .map(r => ({ id: r[0], day: ymdT(new Date(r[1].d + TZ_MS)), cat: r[6] || r[5] || '', uzs: Number(r[7]) || 0, ord: r[15] || '' }))
    .filter(x => x.day.startsWith(ym)).sort((a, b) => b.day.localeCompare(a.day));
  const L = [`${T === 'Доход' ? '📈 <b>Доходы' : '📉 <b>Расходы'} аренды за ${MONTHS[mo - 1].toLowerCase()} ${y}</b>`, ''];
  let tot = 0;
  for (const x of recs) {
    tot += x.uzs; const o = m[x.ord], per = o && o.per && o.per[x.id];
    if (T === 'Доход') L.push(`${per ? dm(per[0]) + '–' + dm(per[1]) : dm(x.day)} · ${o && o.ps ? o.ps + ' ' : ''}${x.ord || ''}${/Продлен/.test(x.cat) ? ' (продление)' : /Предоплата/.test(x.cat) ? ' (бронь)' : ''} — <b>${fmt(x.uzs)}</b>`);
    else L.push(`${dm(x.day)} · ${esc(x.cat)} — <b>${fmt(x.uzs)}</b>`);
  }
  if (!recs.length) L.push('Записей пока нет.');
  L.push('━━━━━━━━━━', `<b>Всего: ${fmt(tot)} сум</b>`);
  return send(ctx, L.join('\n'), [back]);
}
async function viewerScreen(ctx, data, cfg) {          // меню брата: только смотреть
  const back = [['↩️ Меню аренды', 'vm']];
  if (data === 'vo') {
    const m = await getOrds(ctx), items = await openItems(ctx), os = ordList(m);
    const L = ['📋 <b>Текущие сделки</b>', ''];
    if (!os.length) L.push('Открытых заказов нет.'); else for (const o of os) L.push('• ' + ordInfo(o, items).label);
    const closed = Object.values(m).filter(o => o && o.closed && o.at >= Date.parse(fmBounds().start)).length;
    L.push('', `✅ Сделок закрыто с ${dm(fmBounds().start)}: <b>${closed}</b>`);   // с начала финмесяца (владелец 27.11)
    return send(ctx, L.join('\n'), [back]);
  }
  if (data === 'vi' || data === 've') return rentList(ctx, data === 'vi' ? 'Доход' : 'Расход', back);
  if (data === 'vv') return rentInvScreen(ctx, cfg);
  const o = await rentOwe(ctx, cfg);
  return send(ctx, ['🎮 <b>АРЕНДА PS5</b>', '', `💵 Доходы: <b>${fmt(o.inc)}</b>`, `💸 Расходы: <b>${fmt(o.exp)}</b>`, `📈 Прибыль: <b>${fmt(o.profit)}</b>`, '',
    `💪 Ваша доля: ${fmt(o.owe)}`, `Переведено вам: ${fmt(o.paid)}`, o.due > 0 ? `К переводу вам: <b>${fmt(o.due)}</b>` : '✅ Всё переведено'].join('\n'),
    [[['📋 Сделки', 'vo', 'primary']], [['📈 Доходы', 'vi'], ['📉 Расходы', 've']], [['💼 Вложения', 'vv'], ['📄 Таблица', RENT_URL]]]);
}
async function rentShare(ctx, cfg) {
  ctx.noTrack = true;
  const J = await journal(ctx);
  const ars = cardByWord(cfg, 'Арс');
  const inc = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Доход').reduce((a, x) => a + x.uzs, 0);
  const exp = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Расход').reduce((a, x) => a + x.uzs, 0);
  const profit = inc - exp;
  const paid = ars ? J.filter(x => x.type === 'Между своими' && x.to === ars.name).reduce((a, x) => a + x.uzs, 0) : 0;
  const mineDone = J.filter(x => x.dir === 'Личное' && x.cat === 'Доля из аренды (40%)').reduce((a, x) => a + x.uzs, 0);
  const { inv } = await rentInvState(ctx, cfg, profit), sp = rentSplit(inv, profit);
  const mineAdd = Math.round(sp.mine - mineDone);
  let nid = '';
  if (mineAdd > 0) nid = await botRec(ctx, cfg, { dir: 'Личное', type: 'Доход', group: 'Доля из аренды (40%)', cat: 'Доля из аренды (40%)', amount: mineAdd, comment: `Доля ${sp.pm}% аренды` });
  const due = Math.round(sp.bro - paid);
  const L = [`👤 <b>Брату перевести: ${fmt(Math.max(0, due))} сум</b>`,     // коротко (владелец 26.11); подробности — в таблице «Доли»
    `<i>${sp.pb}% прибыли аренды, уже отдано ${fmt(paid)}</i>`];
  if (nid) L.push('', `🧡 Ваши ${sp.pm}%: +${fmt(mineAdd)} сум → Личное`);
  if (due <= 0) { await send(ctx, L.join('\n')); return false; }
  await store(ctx, { op: 'put', k: 'bro', v: { amount: due } });
  await send(ctx, L.join('\n'), [[['✅ Перевёл брату', 'bro:'], ['Позже', 'brol:']]]);
  return true;                                            // ждём ответ: дальше ничего не шлём (владелец 26.11)
}
// кнопки: перевёл в резерв / брату → с какой карты
async function broPaid(ctx, cfg, mid, src, tgt) {          // перевод доли брату записан: АРЕНДНАЯ → Арс
  const it = await store(ctx, { op: 'get', k: 'bro' });
  if (!it || !it.amount) return edit(ctx, mid, 'Уже записано.');
  const rid = await botRec(ctx, cfg, { dir: 'Аренда PS5', type: 'Между своими', amount: it.amount, from: src.name, to: tgt.name, comment: 'Доля брата 60% аренды' });
  await store(ctx, { op: 'put', k: 'bro', v: { amount: 0 } });
  await edit(ctx, mid, `✅ Записал перевод брату ${fmt(it.amount)}: АРЕНДНАЯ → 💪 АРС (${rid}).`, [[['🗑 Отменить', 'rm:' + rid]]]);
  await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx);
}
async function onShares(ctx, q) {
  ctx.noTrack = true;
  const cfg = await config(ctx); const [k, id] = q.data.split(':'); const mid = q.message.message_id;
  await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'brol') { await tg(ctx, 'editMessageReplyMarkup', { chat_id: ctx.chat, message_id: mid, reply_markup: { inline_keyboard: [] } }); ctx.noTrack = false; return startScreen(ctx); }   // долг повиснет на СТАРТ
  if (k === 'rsvl') return edit(ctx, mid, 'Хорошо, позже. Кнопка остаётся.', [[['✅ Перевёл', 'rsv:' + id]]]);
  if (k === 'rsv' || k === 'bro') {
    const tgt = k === 'rsv' ? cfg.cards.find(c => /вклад/i.test(c.name)) : cardByWord(cfg, 'Арс');
    const amt = k === 'rsv' ? ((await store(ctx, { op: 'get', k: 'res:' + id })) || {}).amount : ((await store(ctx, { op: 'get', k: 'bro' })) || {}).amount;
    if (!amt || !tgt) return edit(ctx, mid, 'Сумма не найдена или уже записана.');
    if (k === 'bro') { const src = cardByWord(cfg, 'Капитал'); if (src) return broPaid(ctx, cfg, mid, src, tgt); }   // брату — всегда с АРЕНДНОЙ (владелец 27.11, /claude №10)
    const list = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.name !== tgt.name && c.cur === 'сум');
    return edit(ctx, mid, `С какой карты перевели ${fmt(amt)} на «${tgt.name}»?`, chunk(cardSort(list).map(({ c, i }) => [cardLabel(c), `${k}f:${id}|${i}`]), 2));
  }
  if (k === 'rsvf' || k === 'brof') {
    const [iid, ci] = id.split('|'); const src = cfg.cards[+ci];
    const tgt = k === 'rsvf' ? cfg.cards.find(c => /вклад/i.test(c.name)) : cardByWord(cfg, 'Арс');
    const key = k === 'rsvf' ? 'res:' + iid : 'bro'; const it = await store(ctx, { op: 'get', k: key });
    if (!it || !it.amount) return edit(ctx, mid, 'Уже записано.');
    const rid = await botRec(ctx, cfg, { dir: k === 'rsvf' ? 'PS SHOP' : 'Аренда PS5', type: 'Между своими', amount: it.amount, from: src.name, to: tgt.name,
      comment: k === 'rsvf' ? 'Резерв 20% PS SHOP' : 'Доля брата 60% аренды' });
    await store(ctx, { op: 'put', k: key, v: { amount: 0 } });
    await edit(ctx, mid, `✅ Записал перевод ${fmt(it.amount)}: «${src.name}» → «${tgt.name}» (${rid}).`);
    if (k === 'brof') { await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx); }   // перевёл брату → мишка и СТАРТ
  }
}

// ---------- Обработка ----------
async function claudeAdd(ctx, text) {                 // /claude: записать правку владельца в очередь
  const q = (await store(ctx, { op: 'get', k: 'claudeQ' })) || [];
  q.push({ id: q.length + 1, at: Date.now(), text: String(text).slice(0, 3000), done: false });
  if (!ctx.dry) await store(ctx, { op: 'put', k: 'claudeQ', v: q });
  await putSt(ctx, {});
  return send(ctx, `📝 <b>Правка №${q.length} записана.</b>`);   // только записать (владелец 27.11)
}
async function onMessage(ctx, m) {
  const cfg = await config(ctx);
  const text = (m.text || '').trim();
  let st = await getSt(ctx);
  const ce = (m.entities || []).filter(e => e.type === 'custom_emoji');
  if (m.sticker && m.sticker.custom_emoji_id) ce.push({ custom_emoji_id: m.sticker.custom_emoji_id });   // id премиум-эмодзи владельца (для меню)
  if (ce.length && !ctx.dry) for (const e of ce) await ctx.env.KV.put('ce:' + e.custom_emoji_id, JSON.stringify({ text, at: Date.now() }));
  if (ce.length && !text.replace(/[\s\u{FE0F}\u{200D}\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{2B05}-\u{2B07}\u{2190}-\u{21FF}]/gu, '')) return send(ctx, 'Эмодзи запомнил 👌');
  if (/^\/start$/i.test(text)) {                           // /start: стереть всё выше и показать СТАРТ (владелец 26.11, на время теста)
    await putSt(ctx, {});
    if (TEST_WIPE && !ctx.dry) {
      const from = Math.max(1, ((await store(ctx, { op: 'get', k: 'wipeFrom' })) || m.message_id - 1000));
      for (let hi = m.message_id; hi >= from; hi -= 100) {
        const ids = []; for (let i = hi; i > Math.max(from - 1, hi - 100); i--) ids.push(i);
        await tg(ctx, 'deleteMessages', { chat_id: ctx.chat, message_ids: ids }).catch(() => {});
      }
      await store(ctx, { op: 'put', k: 'wipeFrom', v: m.message_id });
      await store(ctx, { op: 'put', k: 'trail', v: [] }); ctx.trail = [];
    }
    return startScreen(ctx);
  }
  if (ctx.wife) return wifeText(ctx, cfg, st, m, text);   // жена: только ответы по своей записи
  if (st.await === 'claude' && text && !/^\/(start|menu)$/i.test(text)) return claudeAdd(ctx, text);   // правка — раньше всех проверок («главное меню» в тексте правки не уводит в меню)
  if (/^\/menu$/i.test(text) || /^(отмена|стоп)$/i.test(text) || /главное\s*меню/i.test(text)) { await putSt(ctx, {}); return dirMenu(ctx); }
  if (/^\/newschet(@\w+)?$/i.test(text)) return nsStart(ctx);
  if (/^\/(claude|clone|клод)(@\w+)?$/i.test(text)) { await putSt(ctx, { await: 'claude', g: {} });
    return send(ctx, '🎧 <b>Слушаю.</b> Напишите или скажите голосом правку — я её запишу.'); }
  if (m.voice || m.audio || m.video_note) {
    const f = m.voice || m.audio || m.video_note;
    const said = await transcribe(ctx, await tgFile(ctx, f.file_id));
    if (!said) return send(ctx, '🎤 Не расслышал. Попробуйте ещё раз или напишите текстом.');
    await send(ctx, '🎤 ' + esc(said));
    if (st.await && (st.d || st.g || st.ns)) return onMessage(ctx, { ...m, voice: null, audio: null, video_note: null, text: said });
    ctx.ptype = st.ptype; ctx.ord = st.ord; ctx.ps = st.ps; return startDraft(ctx, cfg, st.dir || null, said, 'голос');
  }
  const img = m.photo ? m.photo[m.photo.length - 1] : (m.document && /^image\//.test(m.document.mime_type || '') ? m.document : null);
  if (img && st.tool && st.tool.kind === 'hps') {        // скрин отчёта HPS после напоминания
    await send(ctx, '📷 Читаю отчёт поставщика…');
    const h = await readHps(ctx, await tgFile(ctx, img.file_id)).catch(() => null);
    return h ? setSupDebt(ctx, h) : send(ctx, '📷 Не нашёл на скрине «Долг … RUB». Напишите сумму в рублях, например <code>4607</code>.');
  }
  if (img) {
    await send(ctx, '📷 Читаю фото…');
    const seen = await readReceipt(ctx, await tgFile(ctx, img.file_id));
    if (!seen) return send(ctx, '📷 Не смог прочитать. Пришлите фото чётче или напишите текстом.');
    const full = (m.caption ? m.caption + '. ' : '') + seen;
    await send(ctx, '📷 На фото: ' + esc(seen));
    ctx.ptype = st.ptype; ctx.ord = st.ord; ctx.ps = st.ps; return startDraft(ctx, cfg, st.dir || null, full, 'фото');
  }
  if (m.document) return send(ctx, 'Этот файл я не читаю. Пришлите фото, голосовое или текст.');
  if (!text) return;
  if (st.await === 'ns' && st.ns) return nsText(ctx, cfg, st, text);   // /newschet: сумма в банке или пометка
  if (st.await === 'tool' && st.tool && st.tool.kind === 'hpsadd') {   // рубли за заявку
    const r = num(text.replace(/руб[а-я.]*|₽|rub/ig, ''));
    return r > 0 ? addSupRub(ctx, r) : send(ctx, 'Напишите рубли числом, например <code>400</code>, или нажмите «Позже».', [[['Позже', 'sp:later']]]);
  }
  { const h = parseHps(text); if (h) return setSupDebt(ctx, h); }   // пересланный ответ HPS на /report
  { const r = text.match(/^(?:долг\s*(?:поставщику)?\s*)?([\d\s.,]+)\s*(?:руб[а-я.]*|₽|rub)$/i);   // «4607 руб», «долг 4 607,72 ₽»
    if (r || (st.await === 'tool' && st.tool && st.tool.kind === 'hps' && num(text) > 0)) return setSupDebt(ctx, { rub: num(r ? r[1] : text), usdt: null }); }
  if (st.await === 'tool' && st.tool) return onToolText(ctx, cfg, st, text);
  if (st.g && st.await === 'fmsum') return fmSetPlan(ctx, text);
  if (st.g && ['gsum', 'gname', 'gamt', 'gdate'].includes(st.await)) return onGoalText(ctx, cfg, st, text);
  if (/закрыл[а-я]*\s+(оплат|поставщ)/i.test(text)) return closeSupplier(ctx, cfg);
  return draftText(ctx, cfg, st, m, text);
}
// ответы на вопросы черновика (общие для владельца и жены)
async function draftText(ctx, cfg, st, m, text) {
  if (st.await === 'amount' && st.d) {
    const many = parseAmounts(text);
    if (many) {                                            // оплата частями: доллары и сумы → отдельные записи по очереди
      remember(st);
      const base = JSON.parse(JSON.stringify(st.d)), of = many.length;
      const mk = (a, i) => { const d = JSON.parse(JSON.stringify(base)); d.amount = a.amount; d.cur = a.cur || 'сум'; d.n = i + 1; d.of = of;
        if (d.cur === '$' && isIn(d.type)) { const c = cardByWord(cfg, 'Доллары'); if (c) d.to = c.name; } return d; };
      st.d = mk(many[0], 0); st.queue = [...many.slice(1).map((a, i) => mk(a, i + 1)), ...(st.queue || [])];
      await send(ctx, `Записываю ${of} части по очереди: ${many.map(a => a.cur === '$' ? '$' + fmt(a.amount) : fmt(a.amount) + ' сум').join(' и ')}.`);
      return askNext(ctx, cfg, st);
    }
    let a = parseAmount(text);
    if (!a) try { const r = await aiParse(ctx, cfg, st.d.dir, text); if (r[0] && r[0].amount > 0) a = { amount: r[0].amount, cur: r[0].currency === '$' ? '$' : null }; } catch (e) {}   // «пятьсот тысяч», «полтора ляма»
    if (a) remember(st);
    if (!a) return send(ctx, 'Не понял сумму. Напишите только число, например <code>150000</code> или <code>$50</code>.');
    st.d.amount = a.amount; if (a.cur) st.d.cur = a.cur; st.d.cur = st.d.cur || 'сум';
    if (st.d.cur === '$' && isIn(st.d.type) && !st.d.to) { const c = cardByWord(cfg, 'Доллары'); if (c) st.d.to = c.name; }
    return reshow(ctx, st);
  }
  if (st.await === 'deal' && st.d) { remember(st); st.d.deal = 'new'; st.d.dealName = text.slice(0, 60); st.d.comment = 'Предоплата: ' + st.d.dealName; st.await = null; return reshow(ctx, st); }
  if (st.await === 'whom' && st.d) { remember(st); st.d.whom = text.slice(0, 40); st.d.comment = 'Дал в долг: ' + st.d.whom; st.await = null; return reshow(ctx, st); }
  if (st.await === 'note' && st.d) {
    remember(st); st.d.cat = `Непредвиденные (${text.slice(0, 60)})`; st.await = null;
    return reshow(ctx, st);
  }
  if (st.await === 'until' && st.d) {
    const y = parseDate(text);
    if (!y) return send(ctx, 'Не понял дату. Напишите, например, <code>28.11</code>.');
    remember(st); st.d.until = y; return reshow(ctx, st);
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
  ctx.ptype = st.ptype; ctx.ord = st.ord; ctx.ps = st.ps; return startDraft(ctx, cfg, st.dir || null, text);   // без выбранного направления: одна запись — спросим кнопкой, несколько — направление по смыслу
}
const complete = d => d.dir && d.type && d.amount != null && (d.type === 'Между своими' ? d.from && d.to
  : (!needsCat(d.type) || d.cat) && (isOut(d.type) ? d.from : d.to) && (d.type !== 'Предоплата' || (d.dir === 'Leadex' ? d.deal : d.book)) && (d.type !== 'Дал в долг' || (d.whom && d.due)));
async function reshow(ctx, st) {
  if (!complete(st.d)) return askNext(ctx, await config(ctx), st);
  st.await = null; await putSt(ctx, st);
  return send(ctx, summary(st.d), [[['✅ Записать', 'ok'], ['❌ Отменить', 'no'], ['✏️ Правка', 'ed']], [BACK]]); }

function draftFrom(cfg, dir, p, text, single) {
  const piece = single ? text : String(p.text || text);
  const d = { dir: dir || (DIRS.includes(p.direction) ? p.direction : null),   // направление из слов, если раздел не выбран
    type: TYPES.includes(p.type) ? p.type : null, amount: typeof p.amount === 'number' && p.amount > 0 ? p.amount : null,
    cur: p.currency === '$' ? '$' : 'сум', date: parseDate(p.date) || todayYmd(), comment: piece.slice(0, 200), src: 'текст',
    time: nowT().toISOString().slice(11, 16) };
  fixType(d);
  if (d.type === 'Предоплата' && p.book) { d.book = parseDate(p.book); if (d.date === d.book) d.date = todayYmd(); }  // дата операции ≠ дата брони
  if (d.amount == null && single) { const a = parseAmount((text.match(/\$?\d[\d\s.,]*\s*(к|тыс|млн|\$)?/i) || [''])[0]); if (a && a.amount) { d.amount = a.amount; if (a.cur) d.cur = a.cur; } }
  {   // ИИ иногда ошибается в сумме («-400 к» → 40 000): если в куске одно число — верим ему (владелец 27.11)
    const nums = piece.match(/\d[\d\s.,]*\s*(к|k|тыс[а-я]*|млн|лям[а-я]*|\$)?/gi) || [];
    if (nums.length === 1) { const a = parseAmount(nums[0].trim()); if (a && a.amount && a.amount !== d.amount && !/^\d{1,2}[.\/]\d{1,2}/.test(nums[0])) { d.amount = a.amount; if (a.cur) d.cur = a.cur; } }
  }
  if (d.type && d.dir && needsCat(d.type)) detectCat(cfg, d, piece, p.category);
  const ok = c => c && (isIn(d.type) ? c.inc.includes(d.dir) : isOut(d.type) ? c.exp.includes(d.dir) : true) ? c.name : null;
  let cf = matchCard(cfg, p.card_from), ct = matchCard(cfg, p.card_to);
  const lowp = piece.toLowerCase();                       // ИИ путает «узум» с «UZUM вклад»: вклад — только если сказано «вклад»
  if (cf && /вклад/i.test(cf.name) && !/вклад/.test(lowp)) cf = null;
  if (ct && /вклад/i.test(ct.name) && !/вклад/.test(lowp)) ct = null;
  if (d.type === 'Между своими' && !d.dir) d.dir = 'Личное';   // перевод между своими — направление не важно
  { const m = lowp.match(/(?:^|\s)с\s+(.+?)\s+на\s+(.+)$/);   // «с X на Y» — карты по местам
    if (m && (d.type === 'Между своими' || !d.type)) { const a = cardInText(cfg, m[1]), b = cardInText(cfg, m[2]); if (a && b && a !== b) { d.type = 'Между своими'; d.dir = d.dir || 'Личное'; cf = a; ct = b; } } }
  if (!cf && !ct && d.type !== 'Между своими') cf = ct = cardInText(cfg, piece);
  if (/(перев[её]л|скинул|отправил|кинул)[а-я]*\s+(брату|арсу|на\s+арс)|доля\s+брата/.test(lowp)) {   // брату: АРЕНДНАЯ → Арс (владелец 27.11, /claude №10)
    d.type = 'Между своими'; d.dir = 'Аренда PS5'; cf = cardByWord(cfg, 'Капитал'); ct = cardByWord(cfg, 'Арс'); d.group = d.cat = null; }
  if (d.type === 'Между своими' && ct && /^Арс/.test(ct.name) && (!cf || cf === ct)) cf = cardByWord(cfg, 'Капитал');   // фото «карта 8350» → с АРЕНДНОЙ
  if (d.type === 'Между своими') { if (cf) d.from = cf.name; if (ct) d.to = ct.name; }
  if (isIn(d.type)) d.to = ok(ct) || ok(cf);
  if (isOut(d.type)) d.from = ok(cf) || ok(ct);
  return d;
}
// направление выбрано позже — заново поискать категорию и карту по тексту записи
// «Предоплата» и «Залог» как чужие деньги — только в аренде; в других направлениях «предоплата за сайт» — обычный доход
function fixType(d) { if (d.dir && d.dir !== 'Аренда PS5' && (d.type === 'Залог' || (d.type === 'Предоплата' && d.dir !== 'Leadex'))) d.type = 'Доход'; }   // предоплата — аренда и LEADEX (сделки)
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
  if (ctx.ord && single && drafts[0].dir === 'Аренда PS5') { drafts[0].ord = ctx.ord; drafts[0].ps = ctx.ps || ''; }   // выбранный клиент аренды
  if (!single) await send(ctx, `Нашёл ${drafts.length} записи. Покажу по очереди, каждую подтвердите ✅.`);
  drafts.forEach((d, i) => { d.n = i + 1; d.of = drafts.length; });
  const st = { dir: null, d: drafts[0], queue: drafts.slice(1) };
  return askNext(ctx, cfg, st);
}
// следующая запись из очереди или меню направлений
async function nextOrMenu(ctx, cfg, st) {
  if (st.queue && st.queue.length) { const nst = { d: st.queue[0], queue: st.queue.slice(1) }; return askNext(ctx, cfg, nst); }
  await putSt(ctx, {}); return startScreen(ctx);
}


// календарь брони: дни с открытыми бронями — красные, сегодня — синий, прошедшие — недоступны
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
async function calendar(ctx, ym, loan) {
  const booked = {};
  if (!loan) for (const x of await openItems(ctx)) if (x.type === 'Предоплата' && x.book && x.book.d) { const k = ymdT(new Date(x.book.d + TZ_MS)); booked[k] = (booked[k] || 0) + 1; }
  const [y, m] = ym.split('-').map(Number), today = todayYmd();
  const first = new Date(Date.UTC(y, m - 1, 1)), days = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = (first.getUTCDay() + 6) % 7;
  const rows = [[[`${MONTHS[m - 1]} ${y}`, 'noop']], ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(w => [w, 'noop'])];
  let row = Array.from({ length: lead }, () => ['⠀', 'noop']);
  for (let dd = 1; dd <= days; dd++) {
    const k = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    row.push(k < today ? ['·', 'noop'] : [String(dd) + (booked[k] ? '•' : ''), 'cd:' + k, booked[k] ? 'danger' : k === today ? 'primary' : null]);
    if (row.length === 7) { rows.push(row); row = []; }
  }
  if (row.length) { while (row.length < 7) row.push(['⠀', 'noop']); rows.push(row); }
  const sh = n => { const t = new Date(Date.UTC(y, m - 1 + n, 1)); return ymdT(t).slice(0, 7); };
  rows.push([['◀️', 'cl:' + sh(-1)], ['▶️', 'cl:' + sh(1)]], [BACK]);
  return rows;
}

// ---------- Аренда: заказы (владелец 26.11, вариант 1) ----------
// Заказ A1, A2… объединяет предоплату, оплату, залог и продления одного клиента. Хранится в DO 'ords'.
// { id, book, prepay:[id записей], zalog:[id], paid, closed, at }. Номер заказа пишется в Журнал!P и «Залоги»!J.
async function getOrds(ctx) {
  let m = await store(ctx, { op: 'get', k: 'ords' });
  if (!m) {                                               // первый запуск: открытые залоги/предоплаты → отдельные заказы
    m = { _n: 0 };
    for (const x of await openItems(ctx)) {
      if (x.dir !== 'Аренда PS5') continue;
      const id = 'A' + (++m._n);
      m[id] = { id, book: x.book && x.book.d ? ymdT(new Date(x.book.d + TZ_MS)) : '', prepay: x.type === 'Предоплата' ? [x.id] : [], zalog: x.type === 'Залог' ? [x.id] : [], paid: x.type === 'Залог', closed: false, at: Date.now() };
    }
    await store(ctx, { op: 'put', k: 'ords', v: m });
  }
  return m;
}
const putOrds = async (ctx, m) => { const r = await store(ctx, { op: 'put', k: 'ords', v: m }); await rentSync(ctx, m).catch(() => {}); return r; };
// лист «Аренда сделки» в главной таблице — его показывает таблица «PS Аренда» (IMPORTRANGE) брату (владелец 27.11)
async function rentSync(ctx, m) {
  if (ctx.dry) return;
  const items = await openItems(ctx), J = await journal(ctx);
  const d = t => t ? { d: t } : '';
  const os = Object.keys(m).filter(k => k !== '_n').map(k => m[k]).sort((a, b) => (a.closed - b.closed) || (b.at - a.at));
  const rows = os.slice(0, 299).map(o => {
    const i = ordInfo(o, items), paid = J.filter(x => x.ord === o.id && x.dir === 'Аренда PS5' && x.type === 'Доход').reduce((a, x) => a + x.uzs, 0);
    const st = o.closed ? 'закрыт' : o.paid ? 'идёт' : o.book ? 'бронь' : 'новый';
    return [o.id, o.ps || '', st, d(o.at), o.book ? d(Date.parse(o.book)) : '', o.until ? d(Date.parse(o.until)) : '', paid, i.sp, i.sz];
  });
  while (rows.length < 299) rows.push(['', '', '', '', '', '', '', '', '']);
  await gas(ctx, [{ op: 'set', sheet: 'Аренда сделки', range: 'A2:I300', values: rows }]);
}
const ordList = m => Object.keys(m).filter(k => k !== '_n' && !m[k].closed).map(k => m[k]);
const ordOf = (m, itemId) => ordList(m).find(o => o.prepay.includes(itemId) || o.zalog.includes(itemId));
function ordInfo(o, items) {
  const pre = items.filter(x => o.prepay.includes(x.id)), zal = items.filter(x => o.zalog.includes(x.id));
  const sp = pre.reduce((a, x) => a + x.sum, 0), sz = zal.reduce((a, x) => a + x.sum, 0);
  return { pre, zal, sp, sz, label: [(o.ps ? o.ps + ' ' : '') + o.id, o.book ? 'бронь ' + o.book.slice(8, 10) + '.' + o.book.slice(5, 7) : '', sp ? 'предоплата ' + fmt(sp) : '', o.paid ? 'идёт' : '', sz ? 'залог ' + fmt(sz) : ''].filter(Boolean).join(' · ') };
}
function rentDraft(cfg, type, f) {                        // черновик аренды кнопками (текст пустой — чтобы цифры из «A1» не стали суммой)
  const d = draftFrom(cfg, 'Аренда PS5', { type, amount: f.amount || null }, '', true);
  Object.assign(d, f); d.src = 'кнопка'; d.n = 1; d.of = 1; return d;
}
// после сохранения записи с заказом: связать, при оплате — перевести предоплату в доход и спросить про залог
async function afterOrder(ctx, cfg, d, id) {
  const m = await getOrds(ctx); const o = m[d.ord]; if (!o) return false;
  if (d.type === 'Предоплата') { o.prepay.push(id); if (d.book) o.book = d.book; }
  if (d.type === 'Залог') o.zalog.push(id);
  let ask = false;
  if (d.type === 'Доход') (o.pay = o.pay || []).push(id);
  if (d.type === 'Доход' && d.until) { o.until = d.until; (o.per = o.per || {})[id] = [d.since || d.date, d.until]; o.warned = false; }   // срок аренды
  if (d.type === 'Доход' && !o.paid) {
    o.paid = true; ask = !o.zalog.length;                // залог уже есть — не спрашиваем
    const items = await openItems(ctx);
    for (const x of items.filter(x => o.prepay.includes(x.id))) {
      const rid = await botRec(ctx, cfg, { dir: 'Аренда PS5', type: 'Доход', group: 'Аренда', cat: 'Предоплата', amount: x.sum, ord: o.id, comment: `Предоплата ${x.id} заказа ${o.id} — клиент приехал` });
      await setItem(ctx, x, 0, 'подтверждено'); (o.conv = o.conv || []).push([rid, x.id, x.sum]);
      await send(ctx, `✅ Предоплата ${fmt(x.sum)} по заказу ${o.id} теперь доход (${rid}).`);
    }
  }
  await putOrds(ctx, m);
  if (ask) { await send(ctx, `🔐 <b>Залог по заказу ${o.id} взяли?</b>`, [[['Да', `zg:${o.id}|x`], ['Нет', `zg:${o.id}|0`]]]); }
  return ask;
}
async function closeOrdIfDone(ctx, itemId) {               // заказ закрывается, когда нет открытых предоплат/залогов и он оплачен
  const m = await getOrds(ctx); const o = ordOf(m, itemId); if (!o) return '';
  const open = (await openItems(ctx)).filter(x => o.prepay.includes(x.id) || o.zalog.includes(x.id));
  if (open.length || !o.paid) return '';
  o.closed = true; await putOrds(ctx, m); await rentNotify(ctx, `🏁 <b>Заказ ${o.ps ? o.ps + ' ' : ''}${o.id} закрыт</b> — приставку вернули.`); return `\n🏁 Заказ ${o.id} закрыт.`;
}
async function rentPick(ctx, kind) {                        // список открытых заказов кнопками
  const m = await getOrds(ctx), items = await openItems(ctx);
  const os = ordList(m).filter(o => kind === 'zl' || kind === 'in' ? true : true);
  const rows = os.map(o => [[ordInfo(o, items).label, `ao:${kind}|${o.id}`]]);
  const title = kind === 'in' ? '💵 <b>Оплата: какой заказ?</b>' : '🔐 <b>Залог: какой заказ?</b>';
  rows.push([[kind === 'in' ? '🆕 Без предоплаты' : '🆕 Новый заказ', `ao:${kind}|new`]], [BACK]);
  return send(ctx, title + (os.length ? '' : '\nОткрытых заказов нет.'), rows);
}
async function rentOrders(ctx) {                            // «📋 Заказы»: открытые заказы; «Назад» — под последним
  const m = await getOrds(ctx), items = await openItems(ctx), os = ordList(m);
  if (!os.length) return send(ctx, '📋 Открытых заказов нет.', [[BACK]]);
  await send(ctx, '📋 <b>Открытые заказы</b>');
  for (let n = 0; n < os.length; n++) {
    const o = os[n], i = ordInfo(o, items), rows = [];
    for (const x of i.zal) rows.push([['↩️ Вернул залог', 'zr:' + x.id], ['✋ Удержал часть', 'zk:' + x.id]]);
    if (!o.paid) for (const x of i.pre) rows.push([['🔥 Бронь сгорела', 'pb:' + x.id]]);
    rows.push([['🏁 Закрыть заказ', 'ac:' + o.id]]);
    if (n === os.length - 1) rows.push([BACK]);
    await send(ctx, i.label, rows);
  }
}

// ---------- Доходы / расходы за месяц (кнопки по бокам от «Баланс», владелец 26.11) ----------
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
async function monthReport(ctx, kind, only) {   // only — индекс направления (кнопка в разделе)
  const [j] = await gas(ctx, [{ op: 'get', sheet: 'Журнал', range: 'A2:P3000' }]);
  const ym = todayYmd().slice(0, 7), T = kind === 'in' ? 'Доход' : 'Расход';
  const recs = j.values.filter(r => r[0] && r[12] !== 'удалено' && r[4] === T && r[1] && r[1].d)
    .map(r => ({ id: r[0], day: ymdT(new Date(r[1].d + TZ_MS)), dir: r[3], cat: r[6] || r[5] || '', uzs: Number(r[7]) || 0, usd: Number(r[8]) || 0, card: kind === 'in' ? r[11] : r[10] }))
    .filter(x => x.day.startsWith(ym) && !/^Доля из/.test(x.cat) && (only == null || x.dir === DIRS[only]));      // доли — внутренние начисления, не двойной счёт
  const [y, m] = ym.split('-').map(Number);
  const head = `${kind === 'in' ? '📈 <b>Доходы' : '📉 <b>Расходы'}${only != null ? ' ' + (DIRS[only] === 'Leadex' ? 'LEADEX' : DIRS[only]) : ''} за ${MONTHS[m - 1].toLowerCase()} ${y}</b>`;
  const back = only != null ? [['↩️ Назад', 'd:' + only]] : [BACK];   // «Назад» — в свой раздел
  if (!recs.length) return send(ctx, head + '\n\nЗаписей пока нет.', [back]);
  // сводка (владелец 27.11, вариант 1): по направлениям, внутри — категории от большей суммы к меньшей, без списка записей
  const byDir = {}; let tot = 0;
  for (const x of recs) {
    const key = /^Непредвиденные/.test(x.cat) ? 'Непредвиденные' : x.cat || 'Без категории';
    const D = byDir[x.dir] = byDir[x.dir] || { sum: 0, cats: {} };
    D.sum += x.uzs; D.cats[key] = (D.cats[key] || 0) + x.uzs; tot += x.uzs;
  }
  const L = [head, ''];
  const name = d => d === 'Leadex' ? 'LEADEX' : d;
  for (const d of [...DIRS, ...Object.keys(byDir).filter(k => !DIRS.includes(k))]) {
    const D = byDir[d]; if (!D) continue;
    if (only == null) L.push(`<b>${esc(name(d))}: ${fmt(D.sum)}</b>`);   // в разделе — без лишнего заголовка
    for (const [c, v] of Object.entries(D.cats).sort((a, b) => b[1] - a[1])) L.push(`   ${esc(c)} — ${fmt(v)}`);
    L.push('');
  }
  L.push('━━━━━━━━━━', `<b>Всего: ${fmt(tot)} сум</b>`);
  const parts = []; let cur = '';                         // Telegram: не больше 4096 знаков — режем
  for (const line of L) { if ((cur + line).length > 3800) { parts.push(cur); cur = ''; } cur += line + '\n'; }
  parts.push(cur);
  for (let i = 0; i < parts.length; i++) await send(ctx, parts[i], i === parts.length - 1 ? [back] : null);
}
// удалённую запись убрать из заказа; пустой неоплаченный заказ — удалить
async function dropFromOrders(ctx, id) {
  const m = await getOrds(ctx); let ch = false;
  for (const k of Object.keys(m)) { if (k === '_n') continue; const o = m[k];
    if (o.prepay.includes(id) || o.zalog.includes(id)) { o.prepay = o.prepay.filter(i => i !== id); o.zalog = o.zalog.filter(i => i !== id); ch = true;
      if (!o.prepay.length && !o.zalog.length && !o.paid) delete m[k]; }
    if ((o.pay || []).includes(id)) { o.pay = o.pay.filter(i => i !== id); ch = true;
      if (!o.pay.length) {                                  // удалили единственную оплату → клиент снова «не приехал»
        o.paid = false; o.closed = false;
        for (const [rid, iid, sum] of o.conv || []) {
          const [f] = await gas(ctx, [{ op: 'find', sheet: 'Журнал', col: 'A', value: rid }]);
          if (f.row) await gas(ctx, [{ op: 'set', sheet: 'Журнал', range: `M${f.row}`, values: [['удалено']] }]);
          const [z] = await gas(ctx, [{ op: 'find', sheet: 'Залоги и предоплаты', col: 'A', value: iid }]);
          if (z.row) await gas(ctx, [{ op: 'set', sheet: 'Залоги и предоплаты', range: `E${z.row}`, values: [[sum]] }, { op: 'set', sheet: 'Залоги и предоплаты', range: `H${z.row}`, values: [['открыт']] }]);
        }
        o.conv = [];
      } }
  }
  if (ch) await putOrds(ctx, m);
}

// Аренда (владелец 26.11): сначала выбор клиента (заказа), новый клиент — с отметкой приставки △ ✕ □
const PS_MARKS = ['△', '✕', '□'];
async function rentStart(ctx) {
  const m = await getOrds(ctx), items = await openItems(ctx), os = ordList(m);
  const rows = os.map(o => [[ordInfo(o, items).label, 'ro:' + o.id]]);
  rows.push([['🆕 Новый клиент', 'ro:new', 'success']]);
  rows.push([['−', 'ra:exp', 'danger']], [['📉 Расходы', 'mr:out|1', 'primary']], [['💼 Вложения', 'ra:inv'], ['📄 Таблица', RENT_URL]], [BACK]);   // цвета — владелец 27.11 (/claude №2)   // расход аренды, сводка, таблица (владелец 27.11)
  return send(ctx, '<b>АРЕНДА: какой клиент?</b>', rows);
}
async function rentConsole(ctx) {                          // занятые приставки (у открытых заказов) не предлагаем
  const busy = ordList(await getOrds(ctx)).map(o => o.ps).filter(Boolean);
  const free = PS_MARKS.filter(p => !busy.includes(p));
  if (!free.length) return send(ctx, '⚠️ Все приставки заняты: △ ✕ □ уже у клиентов. Закройте заказ, чтобы освободить приставку.', [[BACK]]);
  return send(ctx, '<b>Новый клиент: какая приставка?</b>' + (busy.length ? `\nЗаняты: ${busy.join(' ')}` : ''), [free.map(p => [p, 'rp:' + p]), [BACK]]);
}
async function rentScreen(ctx, st) {                        // экран клиента: оплата (она же продление) / предоплата / залог
  const m = await getOrds(ctx), items = await openItems(ctx), o = st.ord !== 'new' ? m[st.ord] : null;
  const title = o ? ordInfo(o, items).label : `${st.ps || ''} новый клиент`;
  const rows = [[[o && o.paid ? 'Оплата' : 'Оплата', 'ar:in']], [['Предоплата', 'pt:pre'], ['Залог', 'ar:zl']]];
  if (o) {
    const i = ordInfo(o, items);
    for (const x of i.zal) rows.push([['↩️ Вернул залог', 'zr:' + x.id], ['✋ Удержал часть', 'zk:' + x.id]]);
    if (!o.paid) for (const x of i.pre) rows.push([['🔥 Бронь сгорела', 'pb:' + x.id]]);
    if (!i.zal.length && !i.pre.length) rows.push([['🏁 Закрыть заказ', 'ac:' + o.id]]);
    if (!o.ps) {                                          // заказ без значка приставки (старый) — можно проставить
      const busy = ordList(m).map(x => x.ps).filter(Boolean), free = PS_MARKS.filter(p => !busy.includes(p));
      if (free.length) rows.push(free.map(p => [`Приставка ${p}`, `rs:${o.id}|${p}`]));
    }
  }
  rows.push([BACK]);
  return send(ctx, `<b>АРЕНДА ${esc(title)}</b>` + (o && o.paid ? '\nКлиент уже взял приставку — «Оплата» запишется как продление.' : ''), rows);
}

// ---------- СТАРТ (владелец 26.11): зелёная кнопка → главное меню; под ней висят долги, пока не оплачены ----------
async function rentDue(ctx, cfg) {
  const J = await journal(ctx), ars = cardByWord(cfg, 'Арс');
  const inc = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Доход').reduce((a, x) => a + x.uzs, 0);
  const exp = J.filter(x => x.dir === 'Аренда PS5' && x.type === 'Расход').reduce((a, x) => a + x.uzs, 0);
  const paid = ars ? J.filter(x => x.type === 'Между своими' && x.to === ars.name).reduce((a, x) => a + x.uzs, 0) : 0;
  const inv = await store(ctx, { op: 'get', k: 'rentInv' });
  return Math.round(rentSplit(inv, inc - exp).bro - paid);
}
// долг поставщику (владелец 26.11): из ответа бота HPS на /report — «Долг: 52,42 USDT | ≈ 4 607.72 RUB» → рубли × 202 = сумы.
// Владелец пересылает этот ответ боту; в 23:03 бот напоминает. Кнопка долга на СТАРТ — если долг больше $120 (USDT).
const RUB_TO_UZS = 202, SUP_LIMIT_USD = 120;
const num = t => Number(String(t).replace(/\s/g, '').replace(',', '.'));
function parseHps(text) {
  const m = String(text).match(/Долг:\s*([\d\s.,]+)\s*USDT[^\d≈]*≈\s*([\d\s.,]+)\s*RUB/i);
  return m ? { usdt: num(m[1]), rub: num(m[2]) } : null;
}
async function supDue(ctx) {
  const x = await store(ctx, { op: 'get', k: 'supDebt' });
  return x && x.uzs > 0 ? x.uzs : 0;                                // лимит $120 убран (владелец 26.11) — долг виден всегда
}
// квартира $400, 26-го (владелец 26.11): напоминание 25-го вечером (23:03) и 26-го в 12:31
const FLAT_USD = 400, FLAT_DAY = 26;
async function flatReminder(env, when) {
  const d = Number(todayYmd().slice(8, 10));
  if (when === 'eve' ? d !== FLAT_DAY - 1 : d !== FLAT_DAY) return;
  const ctx = { env, out: [] }; const cfg = await config(ctx, true);
  ctx.chat = cfg.owners[0]; if (!ctx.chat) return;
  ctx.noTrack = true;
  await send(ctx, when === 'eve' ? `🏠 <b>Завтра, ${FLAT_DAY}-го — оплата квартиры $${FLAT_USD}</b>\n\n📊 <b>Завтра итог месяца</b>: закройте все оплаты и запишите траты.` : `🏠 <b>Сегодня ${FLAT_DAY}-е — оплата квартиры $${FLAT_USD}</b>\nОплатили?`,
    when === 'eve' ? [[['✅ Оплатил', 'flat']]] : [[['✅ Оплатил', 'flat']], [['📊 Начать разбор месяца', 'fmr:1', 'primary']]]);
}
async function supReminder(env) {
  const ctx = { env, out: [] }; const cfg = await config(ctx, true);
  ctx.chat = cfg.owners[0]; if (!ctx.chat) return;
  const st = await getSt(ctx); if (!st.d) await putSt(ctx, { tool: { kind: 'hps' }, await: 'tool' });   // ждём рубли, скрин или пересылку
  await send(ctx, '🧾 <b>23:03 — проверим долг поставщику</b>\nНапишите <code>/report</code> в группе «PSSHOP x HPS», потом пришлите сюда:\n• сумму в рублях, например <code>4607</code>\n• или скрин ответа\n• или перешлите ответ.\nЯ умножу рубли на 202.', [[['Позже', 'st0']]]);
}
async function debtRows(ctx, cfg) {                         // кнопки долгов — на СТАРТ и в главном меню
  cfg = cfg || await config(ctx); const rows = [];
  const b = await rentDue(ctx, cfg); if (b > 0) rows.push([[`💪 Брат: ${fmt(b)}`, 'dbro']]);   // 💪 — выбор владельца (27.11)
  const p = await supDue(ctx);   // «Позже» — только «есть долг», без суммы, пока рубли не вписаны (владелец 27.11)
  if (await store(ctx, { op: 'get', k: 'supUnknown' })) rows.push([['🧾 Поставщик: есть долг', 'dsup']]);
  else if (p > 0) { const { top } = await supNums(ctx); rows.push([[top ? `🧾 Поставщику: ${fmt(p)}` : '🧾 Поставщику: ✅', 'dsup']]); }   // /claude №8; на карте хватает → ✅ (владелец 27.11)
  return rows;
}
async function startScreen(ctx) {
  if (ctx.wife) return wifeMenu(ctx);
  await purge(ctx); await putSt(ctx, {});
  const cfg = await config(ctx);
  const rows = [[['СТАРТ', 'menu']]];
  rows.push(...await debtRows(ctx, cfg));
  const lg = await tg(ctx, 'sendSticker', { chat_id: ctx.chat, sticker: LOGO_STICKER });   // лого владельца сверху (27.11)
  if (lg && lg.ok && ctx.trail) ctx.trail.push(lg.result.message_id);
  let plan = ''; try { plan = fmLine(await fmToday(ctx)) + '\n\n'; } catch (e) {}   // дневной план всегда на СТАРТ (задача 17)
  return send(ctx, plan + PAD(9) + '👇' + PAD(9), rows);
}

// ---------- LEADEX (владелец 27.11): сделки. Предоплата — «облако» (чужие деньги), Поступление закрывает сделку и делит всё ----------
async function getDeals(ctx) { return (await store(ctx, { op: 'get', k: 'deals' })) || { _n: 0 }; }
const putDeals = (ctx, m) => store(ctx, { op: 'put', k: 'deals', v: m });
const dealList = m => Object.keys(m).filter(k => k !== '_n' && !m[k].closed).map(k => m[k]);
async function leadexScreen(ctx) {
  return send(ctx, '<b>LEADEX</b>', [[['➕ Поступление', 'lq:in', 'success']], [['🔄 Предоплата', 'lq:pre', 'primary'], ['➖ Расходы', 'lq:exp', 'danger']], [['💼 Вложения', 'lq:inv']], [['📄 Таблица', 'lq:tab']], [BACK]]);
}
// при поступлении по сделке: предоплаты этой сделки → доход (без карты: деньги уже на карте), сделка закрыта; вернуть сумму для дележа
async function releaseDeal(ctx, cfg, d) {
  if (!d.deal || d.deal === 'new') return 0;
  const m = await getDeals(ctx), o = m[d.deal]; if (!o) return 0;
  let sum = 0;
  for (const x of (await openItems(ctx)).filter(x => o.prepay.includes(x.id))) {
    await botRec(ctx, cfg, { dir: 'Leadex', type: 'Доход', group: 'Предоплата за сайт', cat: 'Предоплата за сайт', amount: x.sum, comment: `Предоплата сделки «${o.name}» — сделка закрыта` });
    await setItem(ctx, x, 0, 'подтверждено'); sum += x.sum;
  }
  o.closed = true; await putDeals(ctx, m);
  return sum;
}
// ---------- Цели (задача 13, владелец 27.11) ----------
// кнопка-цель: серая — не начата, синяя — копим, зелёная ✅ зачёркнутая — накоплено и потрачено (записан расход)
// пополнение: цель → «Отложил» → сумма → куда положил; накоплено → «Готово» → расход Личное с карты, где копил
const CUSH_USD = 200, CUSH_DAY = 20;                       // подушка: +$200 в месяц, напоминание 20-го в 23:03 (лимит 5 таймеров на аккаунт — 23:50 отдельно нельзя)
const GOALS_SEED = [];                                   // стартовые цели владельца уже в памяти бота (DO goals); суммы в репозитории не храним
async function getGoals(ctx) {
  let g = await store(ctx, { op: 'get', k: 'goals' });
  if (!g) { g = { _n: 0, list: {}, cush: { total: 0, m: {} } };
    for (const [name, sum, cur, due, group, cat] of GOALS_SEED) { const id = 'G' + (++g._n); g.list[id] = { id, name, sum, cur, due, group: group || null, cat: cat || null, saved: 0, card: null, done: false }; }
    await store(ctx, { op: 'put', k: 'goals', v: g }); }
  return g;
}
const putGoals = (ctx, g) => store(ctx, { op: 'put', k: 'goals', v: g });
// приоритет целей (владелец 27.11): порядок задаёт владелец (⬆️⬇️), «Нал» сам раскладывается по целям сверху вниз
// (цель на вкладе — из остатка вклада). Ручное «Отложил» — только для денег не на Нале/вкладе.
function goalOrder(g) {
  const ids = (g.order || []).filter(id => g.list[id]);
  const rest = Object.values(g.list).filter(x => !ids.includes(x.id)).sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9'))).map(x => x.id);
  return [...ids, ...rest];
}
const autoCard = c => /^Нал/.test(c || '') || /вклад/i.test(c || '');
async function goalProg(ctx, g) {                      // x.prog — накоплено (ручное + доля Нала/вклада по приоритету)
  const [k] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:J20' }]);
  const bal = re => { const r = k.values.find(r => re.test(String(r[0] || ''))); return r ? Math.max(0, Number(r[8]) || 0) : 0; };
  let nal = Math.max(0, await nalBalance(ctx)), vk = bal(/вклад/i); const rate = await cbuRate(ctx, todayYmd());
  for (const id of goalOrder(g)) {
    const x = g.list[id]; if (x.done) { x.prog = x.sum; x.auto = 0; continue; }
    const k1 = x.cur === '$' ? rate : 1, base = autoCard(x.card) ? 0 : x.saved || 0;
    const need = Math.max(0, (x.sum - base) * k1), take = Math.min(inVklad(x) ? vk : nal, need);
    if (inVklad(x)) vk -= take; else nal -= take;
    x.auto = Math.round(take / k1); x.prog = Math.min(x.sum, base + x.auto);
  }
  return g;
}
const gMoney = (n, cur) => cur === '$' ? '$' + fmt(n) : fmt(n) + ' сум';
function gShort(n, cur) {
  if (cur === '$') return '$' + fmt(n);
  if (n >= 1e6) return String(Math.round(n / 1e5) / 10).replace('.', ',') + ' млн';
  if (n >= 1e3) return Math.round(n / 1e3) + ' тыс';
  return fmt(n);
}
const strike = s => [...s].map(c => c + '̶').join('');
const ymNow = () => fmBounds().start;   // «месяц» подушки = финмесяц 26 → 25 (задача 17)
async function goalsScreen(ctx) {
  const g = await goalProg(ctx, await getGoals(ctx)), c = g.cush, mon = c.m[ymNow()] || 0;
  const all = goalOrder(g).map(id => g.list[id]).sort((a, b) => a.done - b.done);
  const rows = [];
  try { const p = await fmToday(ctx); rows.push([[p.over ? '📊 Разбор месяца ⏳' : `📊 План до ${dm(p.fm.due)} · ${p.rem ? gShort(p.nal) + ' из ' + gShort(p.fm.plan) : 'закрыт ✅'}`, 'fp', p.rem && !p.over ? 'primary' : 'success']]); } catch (e) {}
  rows.push([[`🔒 ФОНД: $${fmt(c.total)}`, 'gl:cush', mon >= CUSH_USD ? 'success' : mon > 0 ? 'primary' : undefined]]);   // $200 за месяц — зелёная
  for (const x of all) {
    if (x.done) { rows.push([[`✅ ${strike(x.name)}`, 'gl:' + x.id, 'success']]); continue; }
    const full = x.prog >= x.sum;
    rows.push([[`${x.name} · ${full ? 'накоплено' : gShort(x.prog, x.cur) + ' из ' + gShort(x.sum, x.cur)}`, 'gl:' + x.id, x.prog > 0 ? 'primary' : undefined]]);
  }
  rows.push([['➕ Новая цель', 'gn']], [['↩️ Назад', 'menu']]);
  return send(ctx, '🎯 <b>ЦЕЛИ</b>', rows);
}
async function goalScreen(ctx, id) {
  const g = await goalProg(ctx, await getGoals(ctx));
  if (id === 'cush') {
    const c = g.cush, mon = c.m[ymNow()] || 0;
    return send(ctx, `🔒 <b>ФОНД</b> (подушка безопасности)\nВсего: <b>$${fmt(c.total)}</b>\nВ этом месяце: $${fmt(mon)} из $${CUSH_USD}${mon >= CUSH_USD ? ' ✅' : ''}` + (c.card ? `\n💳 Лежит: ${esc(c.card)}` : ''),
      [[['💰 Отложил', 'gs:cush', 'primary']], [['↩️ Назад', 'gl:']]]);
  }
  const x = g.list[id]; if (!x) return goalsScreen(ctx);
  const L = [`🎯 <b>${esc(x.name)}</b>`];
  if (x.done) L.push(`✅ Выполнена${x.rec ? ' · ' + x.rec : ''}`, `💰 ${gMoney(x.sum, x.cur)}`);
  else {
    const p = Math.min(100, Math.round(x.prog / x.sum * 100));
    L.push(`💰 Накоплено: <b>${gMoney(x.prog, x.cur)}</b> из ${gMoney(x.sum, x.cur)} (${p}%)`);
    if (x.prog < x.sum) L.push(`Осталось: ${gMoney(x.sum - x.prog, x.cur)}`);
    if (x.due) { const days = Math.round((Date.parse(x.due) - Date.parse(todayYmd())) / DAY); L.push(`🗓 До ${human(x.due)}` + (days >= 0 ? ` (${days} дн.)` : ' — срок прошёл')); }
    const pos = goalOrder(g).filter(i => !g.list[i].done).indexOf(id) + 1;
    if (x.auto) L.push(`Из них ${inVklad(x) ? 'на вкладе' : 'в Нале'}: ${gMoney(x.auto, x.cur)}`);
    if (x.saved && !autoCard(x.card)) L.push(`💳 Отложено вручную: ${gMoney(x.saved, x.cur)} (${esc(x.card)})`);
    L.push(`🔢 Приоритет: ${pos}`);
  }
  const rows = [];
  if (!x.done) { rows.push([['💰 Отложил', 'gs:' + id, 'primary']]); if (x.prog >= x.sum) rows.push([['✅ Готово — записать расход', 'gd:' + id, 'success']]); }
  if (!x.done) rows.push([['⬆️ Выше', 'gu:' + id], ['⬇️ Ниже', 'gdn:' + id]]);
  rows.push([['🗑 Удалить цель', 'gx:' + id]], [['↩️ Назад', 'gl:']]);
  return send(ctx, L.join('\n'), rows);
}
async function goalAdd(ctx, cfg, id, amt, card) {          // отложил на цель / подушку
  const g = await getGoals(ctx);
  if (id === 'cush') { const c = g.cush, ym = ymNow(); c.total += amt; c.m[ym] = (c.m[ym] || 0) + amt; c.card = card; }
  else { const x = g.list[id]; if (!x) return goalsScreen(ctx);
    if (autoCard(card)) { await putSt(ctx, {}); await send(ctx, `ℹ️ ${/вклад/i.test(card) ? 'Вклад' : 'Нал'} бот считает сам: цели получают деньги по приоритету. Запишите перевод на «${esc(card)}» в боте (Между своими) — цель заполнится.`); return goalsScreen(ctx); }
    x.saved += amt; x.card = card; }
  await putGoals(ctx, g); await putSt(ctx, {});
  const x = id === 'cush' ? null : g.list[id];
  await send(ctx, `✅ Отложено ${gMoney(amt, x ? x.cur : '$')} → ${x ? esc(x.name) : '🔒 ФОНД'}` + (x && (await goalProg(ctx, g)).list[id].prog >= x.sum ? '\n🎉 Цель накоплена! Нажмите её и «Готово», когда потратите.' : ''));
  return goalsScreen(ctx);
}
async function onGoal(ctx, cfg, k, v, mid, st) {
  await gone(ctx, mid);
  if (k === 'gl') { await putSt(ctx, {}); return v ? goalScreen(ctx, v) : goalsScreen(ctx); }
  if (k === 'gs') {
    const g = await getGoals(ctx), cur = v === 'cush' ? '$' : (g.list[v] || {}).cur;
    await putSt(ctx, { g: { id: v }, await: 'gsum' });
    return send(ctx, `💰 Сколько отложили? Напишите число, например ${cur === '$' ? '<code>50</code> (доллары)' : '<code>500000</code>'}.`, [[['↩️ Назад', 'gl:' + v]]]);
  }
  if (k === 'gk') {
    if (!st.g || st.g.amt == null) return goalsScreen(ctx);
    return goalAdd(ctx, cfg, st.g.id, st.g.amt, cfg.cards[+v] ? cfg.cards[+v].name : 'Наличные');
  }
  if (k === 'gd') {                                        // накоплено и потрачено → расход Личное
    const x = (await goalProg(ctx, await getGoals(ctx))).list[v]; if (!x || x.done) return goalsScreen(ctx);
    const src = x.saved && !autoCard(x.card) ? x.card : inVklad(x) ? (cfg.cards.find(c => /вклад/i.test(c.name)) || {}).name : (cfg.cards.find(c => /^Нал/.test(c.name)) || {}).name;
    const d = Object.assign(draftFrom(cfg, 'Личное', { type: 'Расход', amount: x.sum }, '', true),
      { cur: x.cur, group: x.group, cat: x.cat, from: src || null, comment: 'Цель: ' + x.name, goal: v, src: 'кнопка', n: 1, of: 1 });
    return askNext(ctx, cfg, { d, queue: [], dir: 'Личное' });
  }
  if (k === 'gu' || k === 'gdn') {                       // ⬆️⬇️ приоритет
    const g = await getGoals(ctx), o = goalOrder(g), i = o.indexOf(v), j = k === 'gu' ? i - 1 : i + 1;
    if (i >= 0 && j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; g.order = o; await putGoals(ctx, g); }
    return goalScreen(ctx, v);
  }
  if (k === 'gx') { const x = (await getGoals(ctx)).list[v]; if (!x) return goalsScreen(ctx);
    return send(ctx, `🗑 Удалить цель «${esc(x.name)}»?`, [[['Да, удалить', 'gy:' + v], ['Нет', 'gl:' + v]]]); }
  if (k === 'gy') { const g = await getGoals(ctx); delete g.list[v]; await putGoals(ctx, g); return goalsScreen(ctx); }
  if (k === 'gn') { await putSt(ctx, { g: { nw: {} }, await: 'gname' }); return send(ctx, '🎯 <b>Новая цель.</b> Как назвать? Например <code>Отпуск</code>.', [[['↩️ Назад', 'gl:']]]); }
  if (k === 'gw') { if (!st.g || !st.g.nw) return goalsScreen(ctx); return goalCreate(ctx, st.g.nw, null); }
}
async function goalCreate(ctx, nw, due) {
  const g = await getGoals(ctx), id = 'G' + (++g._n);
  g.list[id] = { id, name: nw.name, sum: nw.sum, cur: nw.cur, due, group: null, cat: null, saved: 0, card: null, done: false };
  await putGoals(ctx, g); await putSt(ctx, {});
  await send(ctx, `✅ Цель «${esc(nw.name)}» создана: ${gMoney(nw.sum, nw.cur)}${due ? ' к ' + human(due) : ''}.`);
  return goalsScreen(ctx);
}
async function onGoalText(ctx, cfg, st, text) {           // ответы текстом/голосом в диалогах целей
  if (st.await === 'gsum') {
    const g = await getGoals(ctx), cur = st.g.id === 'cush' ? '$' : (g.list[st.g.id] || {}).cur || 'сум';
    const a = parseAmount(text.replace(/сум[а-я]*/i, ''));
    if (!a || !(a.amount > 0)) return send(ctx, 'Не понял сумму. Напишите только число, например <code>500000</code>.');
    let amt = a.amount;
    if (a.cur === '$' && cur !== '$') amt = Math.round(amt * await cbuRate(ctx, todayYmd()));   // $ на цель в сумах — по курсу ЦБ
    st.g.amt = amt; st.await = null; await putSt(ctx, st);
    const own = cfg.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.exp.includes('Личное') || c.inc.includes('Личное') || /вклад/i.test(c.name));   // карты Личного + вклад
    return send(ctx, '💳 Куда положили?', [...chunk(cardSort(own.length ? own : cfg.cards.map((c, i) => ({ c, i }))).map(({ c, i }) => [cardLabel(c), 'gk:' + i]), 2), [['↩️ Назад', 'gl:' + st.g.id]]]);
  }
  if (st.await === 'gname') {
    st.g.nw.name = text.slice(0, 30); st.await = 'gamt'; await putSt(ctx, st);
    return send(ctx, `💰 Сколько нужно на «${esc(st.g.nw.name)}»? Например <code>5000000</code> или <code>$200</code>.`, [[['↩️ Назад', 'gl:']]]);
  }
  if (st.await === 'gamt') {
    const a = parseAmount(text.replace(/сум[а-я]*/i, ''));
    if (!a || !(a.amount > 0)) return send(ctx, 'Не понял сумму. Например <code>5000000</code> или <code>$200</code>.');
    st.g.nw.sum = a.amount; st.g.nw.cur = a.cur === '$' ? '$' : 'сум'; st.await = 'gdate'; await putSt(ctx, st);
    return send(ctx, '🗓 К какой дате? Напишите, например, <code>31.12</code>.', [[['Без даты', 'gw']], [['↩️ Назад', 'gl:']]]);
  }
  if (st.await === 'gdate') {
    const y = parseDate(text); if (!y) return send(ctx, 'Не понял дату. Напишите, например, <code>31.12</code>.', [[['Без даты', 'gw']]]);
    return goalCreate(ctx, st.g.nw, y);
  }
}
async function cushionReminder(env) {                      // 20-го в 23:50: если в этом месяце не отложено $200
  if (Number(todayYmd().slice(8, 10)) !== CUSH_DAY) return;
  const ctx = { env, out: [] }; const cfg = await config(ctx, true);
  ctx.chat = cfg.owners[0]; if (!ctx.chat) return;
  const mon = (await getGoals(ctx)).cush.m[ymNow()] || 0; if (mon >= CUSH_USD) return;
  ctx.noTrack = true;
  await send(ctx, `🔒 <b>ФОНД: в этом месяце отложено $${fmt(mon)} из $${CUSH_USD}</b>\nОтложите ещё $${fmt(CUSH_USD - mon)}.`, [[['💰 Отложил', 'gs:cush', 'primary']]]);
}

// ---------- Финмесяц 26 → 25 и дневной план (задача 17, владелец 27.11) ----------
// план = расходы на месяц (1-й месяц — список из опроса в DO fmBase, дальше — реальные траты Личного прошлого финмесяца) + подушка + цели со сроком
// до конца следующего календарного месяца; всё ×1,2 (запас). Прогресс = остаток «Нал» (сумы). День: веса 1–9 и 26–31 ×1, 10–19 ×1,5, 20–25 ×2.
const FM_DAY = 26, FM_BUF = 1.2, FM_SHEET = 'Финмесяцы';
const fmW = ymd => { const d = +ymd.slice(8, 10); return d >= 20 && d <= 25 ? 2 : d >= 10 && d < 20 ? 1.5 : 1; };
const p2 = n => String(n).padStart(2, '0');
function fmBounds(ymd) {
  let [y, m, d] = (ymd || todayYmd()).split('-').map(Number);
  if (d < FM_DAY) { m--; if (m < 1) { m = 12; y--; } }
  let y2 = y, m2 = m + 1; if (m2 > 12) { m2 = 1; y2++; }
  const last = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  return { start: `${y}-${p2(m)}-${FM_DAY}`, end: `${y2}-${p2(m2)}-25`, due: `${y2}-${p2(m2)}-${FM_DAY}`, horizon: `${y2}-${p2(m2)}-${last}` };
}
const dm = ymd => ymd.slice(8, 10) + '.' + ymd.slice(5, 7);
const inVklad = x => /вклад/i.test(x.card || '') || x.name === 'Сюрприз';   // копится на вкладе — не в план по Налу
async function cashPool(ctx) {
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Карты', range: 'A2:J20' }]);
  const bal = re => { const r = g.values.find(r => re.test(String(r[0] || ''))); return r ? Number(r[8]) || 0 : 0; };
  const cush = ((await getGoals(ctx)).cush || {}).total || 0, rate = await cbuRate(ctx, todayYmd());
  const sum = bal(/^Нал/), usd = Math.max(0, bal(/^Доллары/) - cush);
  return { sum, usd, rate, total: Math.round(sum + usd * rate) };
}
async function nalBalance(ctx) { return (await cashPool(ctx)).total; }
async function fmStats(ctx, start, end) {             // доходы и расходы за финмесяц из Журнала
  const recs = (await journal(ctx)).filter(x => { const d = ymdT(new Date(x.t + TZ_MS)); return x.t && d >= start && d <= end && !/^Доля из/.test(x.cat || ''); });
  const s = { inc: {}, exp: {}, lexp: {}, incT: 0, expT: 0, lexpT: 0 };
  for (const x of recs) {
    if (x.type === 'Доход') { s.inc[x.dir] = (s.inc[x.dir] || 0) + x.uzs; s.incT += x.uzs; }
    if (x.type === 'Расход') { s.exp[x.dir] = (s.exp[x.dir] || 0) + x.uzs; s.expT += x.uzs;
      if (x.dir === 'Личное') { const g = x.group || x.cat || 'Прочее'; s.lexp[g] = (s.lexp[g] || 0) + x.uzs; s.lexpT += x.uzs; } }
  }
  return s;
}
async function fmMake(ctx, b, prev) {                 // новый план финмесяца
  const rate = await cbuRate(ctx, todayYmd());
  let exp;
  if (prev && prev.lexpT > 0) exp = Object.entries(prev.lexp).sort((a, c) => c[1] - a[1]).map(([n, v]) => [n, Math.round(v)]);
  else exp = ((await store(ctx, { op: 'get', k: 'fmBase' })) || []).map(([n, a, cur]) => [n, Math.round(cur === '$' ? a * rate : a)]);
  const cush = Math.round(CUSH_USD * rate);
  const g = await getGoals(ctx), goals = [], far = [];
  for (const x of Object.values(g.list)) {
    if (x.done) continue;
    const left = Math.max(0, Math.round((x.cur === '$' ? rate : 1) * (x.sum - (x.card && !/^Нал/.test(x.card) ? x.saved : 0))));
    if (!inVklad(x) && (!x.due || x.due <= b.horizon)) goals.push([x.id, x.name, left, x.due]); else far.push([x.id, x.name, left, x.due]);
  }
  const base = exp.reduce((s, e) => s + e[1], 0) + cush + goals.reduce((s, e) => s + e[2], 0);
  return { ...b, exp, cush, goals, far, base, plan: Math.round(base * FM_BUF / 1000) * 1000, src: prev && prev.lexpT > 0 ? 'факт' : 'опрос', at: Date.now() };
}
async function getFm(ctx) {                            // текущий план; первый раз — создаётся сам
  const b = fmBounds(); let fm = await store(ctx, { op: 'get', k: 'fm' });
  if (!fm) { fm = await fmMake(ctx, b, null); await store(ctx, { op: 'put', k: 'fm', v: fm }); }
  return { fm, over: fm.start < b.start };           // over — месяц закончился, ждём разбор
}
async function fmToday(ctx) {
  const { fm, over } = await getFm(ctx), nal = await nalBalance(ctx), t = todayYmd();
  const rem = Math.max(0, fm.plan - nal); let W = 0;
  for (let d = t; d <= fm.end; d = shiftYmd(d, 1)) W += fmW(d);
  let day = await store(ctx, { op: 'get', k: 'fmDay' });
  if (!day || day.d !== t || day.start !== fm.start) {     // норма дня — по остатку на утро, весь день не меняется
    day = { d: t, start: fm.start, nal0: nal, need: rem && W ? Math.ceil(rem * fmW(t) / W / 1000) * 1000 : 0 };
    await store(ctx, { op: 'put', k: 'fmDay', v: day });
  }
  const done = Math.max(0, nal - day.nal0), dayNeed = day.need, need = rem && W ? Math.ceil(rem * fmW(t) / W / 1000) * 1000 : 0;
  return { fm, over, nal, rem, need, done, dayNeed, pct: fm.plan ? Math.max(0, Math.min(100, Math.round(nal / fm.plan * 100))) : 0 };
}
const fmLine = s => {                                 // строка плана на СТАРТ и утром (вид — владелец 27.11)
  if (s.over) return '📊 <b>Финмесяц закончился</b> — нажмите «Разбор месяца»';
  const L = [`📊 <b>План до ${dm(s.fm.due)}:</b>`, '', `💵 Нал: <b>${gShort(s.nal)}</b> (${s.pct}%)`, `📈 План: <b>${gShort(s.fm.plan)}</b>`];
  if (!s.rem) return [...L, '', '✅ <b>План закрыт!</b>'].join('\n');
  L.push(`⏳ Не хватает: <b>${gShort(s.rem)}</b>`, '');
  L.push(`🎯 Сегодня отложить: <b>${gShort(s.need)}</b>`);
  return L.join('\n');
};
async function fmScreen(ctx) {
  const s = await fmToday(ctx), f = s.fm, L = [];
  L.push(`📊 <b>План до ${human(f.due)}</b>`, `Финмесяц ${dm(f.start)} → ${dm(f.end)}`, '');
  { const c = await cashPool(ctx); L.push(`💰 Собрано: <b>${fmt(s.nal)}</b> из ${fmt(f.plan)} (${s.pct}%)`, `   💵 Нал ${fmt(c.sum)}` + (c.usd ? ` + $${fmt(c.usd)} свободных (кроме подушки)` : '')); }
  if (s.over) L.push('⏳ Месяц закончился — пора на разбор.');
  else if (s.rem) { const days = Math.round((Date.parse(f.end) - Date.parse(todayYmd())) / DAY) + 1;
    L.push(`Осталось: ${fmt(s.rem)} · дней: ${days}`, `🎯 <b>Сегодня отложить в Нал: ${fmt(s.need)}</b> (день ×${String(fmW(todayYmd())).replace('.', ',')})` ,
      'Не отложили — остаток сам разложится на следующие дни.', 'Доллары сверх подушки считаются как нал.'); }
  else L.push('✅ <b>План закрыт!</b>');
  L.push('', `<b>Расходы на месяц</b> (${f.src === 'факт' ? 'по факту прошлого месяца' : 'по опросу'}): ${fmt(f.exp.reduce((a, e) => a + e[1], 0))}`);
  for (const [n, v] of f.exp) L.push(`   ${esc(n)} — ${fmt(v)}`);
  L.push(`🔒 ФОНД $${CUSH_USD} — ${fmt(f.cush)}`);
  if (f.goals.length) { L.push('', '<b>Цели</b>'); for (const [, n, v, d] of f.goals) L.push(`   ${esc(n)} — ${fmt(v)}${d ? ' · до ' + dm(d) : ''}`); }
  L.push('', `Запас +${Math.round((FM_BUF - 1) * 100)}%: ${fmt(f.plan - f.base)}`, '━━━━━━━━━━', `<b>План: ${fmt(f.plan)}</b>`);
  if (f.far.length) { L.push('', '🔮 <b>Дальше</b>'); for (const [, n, v, d] of f.far) L.push(`   ${esc(n)} — ${fmt(v)}${d ? ' · до ' + human(d) : ''}`); }
  return send(ctx, L.join('\n'), [[['📊 Разбор месяца', 'fmr:1', 'primary']], [['↩️ Назад', 'gl:']]]);
}
async function aiNote(ctx, facts) {                    // короткий вывод ИИ (может ошибаться; цифры — из таблицы)
  try {
    const r = await ctx.env.AI.run(MODEL, { messages: [{ role: 'system', content: 'Ты финансовый помощник. По цифрам дай 2–3 коротких вывода по-русски простыми словами: что выросло, что упало, на что обратить внимание в следующем месяце. Без вступлений, без markdown, только факты из цифр.' }, { role: 'user', content: facts }], max_tokens: 300, temperature: 0.2 });
    return String(typeof r.response === 'string' ? r.response : '').trim().slice(0, 700);
  } catch (e) { return ''; }
}
async function fmReview(ctx, step) {                   // разбор месяца: 5 шагов
  const { fm, over } = await getFm(ctx);
  const s = await fmStats(ctx, fm.start, fm.end), hist = (await store(ctx, { op: 'get', k: 'fmHist' })) || {};
  const prevKey = Object.keys(hist).filter(k => k < fm.start).sort().pop(), pv = prevKey ? hist[prevKey] : null;
  const cmp = (v, p) => p == null ? '' : p ? ` (${v >= p ? '+' : ''}${Math.round((v - p) / p * 100)}%)` : '';
  const name = d => d === 'Leadex' ? 'LEADEX' : d;
  const L = [`📊 <b>Разбор месяца ${dm(fm.start)} → ${dm(fm.end)}</b> · шаг ${step} из 5`, ''];
  if (step === 1) { const nal = await nalBalance(ctx);
    L.push('<b>1. План и факт</b>', `План: ${fmt(fm.plan)}`, `Собрано (Нал): ${fmt(nal)} (${fm.plan ? Math.round(nal / fm.plan * 100) : 0}%)`,
      nal >= fm.plan ? '✅ План закрыт' : `❌ Не хватило: ${fmt(fm.plan - nal)}`); }
  if (step === 2) { L.push('<b>2. Доходы по бизнесам</b>');
    for (const d of DIRS) if (s.inc[d] || (pv && pv.inc[d])) L.push(`   ${name(d)} — ${fmt(s.inc[d] || 0)}${cmp(s.inc[d] || 0, pv ? pv.inc[d] || 0 : null)}`);
    L.push('━━━━━━━━━━', `<b>Всего: ${fmt(s.incT)}</b>${cmp(s.incT, pv ? pv.incT : null)}`); }
  if (step === 3) { L.push('<b>3. Расходы</b>');
    for (const d of DIRS) if (s.exp[d]) L.push(`   ${name(d)} — ${fmt(s.exp[d])}${cmp(s.exp[d], pv ? pv.exp[d] || 0 : null)}`);
    if (s.lexpT) { L.push('', '<b>Личное по группам</b>'); for (const [g, v] of Object.entries(s.lexp).sort((a, b) => b[1] - a[1])) L.push(`   ${esc(g)} — ${fmt(v)}${cmp(v, pv ? pv.lexp[g] || 0 : null)}`); }
    L.push('━━━━━━━━━━', `<b>Всего: ${fmt(s.expT)}</b>${cmp(s.expT, pv ? pv.expT : null)}`);
    if (!pv) L.push('', 'Сравнение с прошлым месяцем появится со следующего разбора.'); }
  if (step === 4) { L.push('<b>4. Цели</b> (по приоритету)'); const g = await goalProg(ctx, await getGoals(ctx));
    for (const x of goalOrder(g).map(id => g.list[id])) {
      if (x.done) { L.push(`   ✅ ${esc(x.name)} — выполнена`); continue; }
      const p = Math.round(x.prog / x.sum * 100), late = x.due && x.due < todayYmd() && x.prog < x.sum;
      L.push(`   ${late ? '⚠️' : x.prog >= x.sum ? '✅' : '▫️'} ${esc(x.name)} — ${gShort(x.prog, x.cur)} из ${gShort(x.sum, x.cur)} (${p}%)${x.due ? ' · до ' + dm(x.due) : ''}`); }
    const c = g.cush; L.push(`   🔒 ФОНД — $${fmt(c.total)}, за этот месяц $${fmt(c.m[fm.start] || 0)} из $${CUSH_USD}`); }
  if (step === 5) {
    const ks = [...Object.keys(hist).filter(k => k < fm.start)], n = ks.length + 1;
    const avg = f => Math.round((ks.reduce((a, k) => a + f(hist[k]), 0) + f(s)) / n);
    const nb = fmBounds(fm.due), next = await fmMake(ctx, nb, s);
    L.push('<b>5. Прогноз на следующий месяц</b>', `(по ${n} мес.)`);
    for (const d of DIRS) { const v = avg(h => h.inc[d] || 0); if (v) L.push(`   Доход ${name(d)} — ~${fmt(v)}`); }
    L.push(`   Расходы всего — ~${fmt(avg(h => h.expT))}`, `   Личные расходы — ~${fmt(avg(h => h.lexpT))}`, `   План до ${dm(nb.due)} — ~${fmt(next.plan)}`);
    const note = await aiNote(ctx, `Финмесяц ${fm.start}..${fm.end}. Доходы: ${JSON.stringify(s.inc)}, всего ${s.incT}. Расходы: ${JSON.stringify(s.exp)}, всего ${s.expT}. Личные по группам: ${JSON.stringify(s.lexp)}.` + (pv ? ` Прошлый месяц: доходы ${JSON.stringify(pv.inc)}, расходы ${JSON.stringify(pv.exp)}, личные ${JSON.stringify(pv.lexp)}.` : ' Прошлого месяца нет.') + ` План был ${fm.plan}. Следующий план ${next.plan}.`);
    if (note) L.push('', '💬 <b>Вывод ИИ</b> (может ошибаться):', esc(note));
    await store(ctx, { op: 'put', k: 'fmNote', v: note });
  }
  const nav = [];
  if (step > 1) nav.push(['◀️', 'fmr:' + (step - 1)]);
  if (step < 5) nav.push(['Дальше ▶️', 'fmr:' + (step + 1), 'primary']);
  const rows = [nav];
  if (step === 5 && over) rows.push([['✅ Начать новый месяц', 'fmn', 'success']]);
  if (step === 5 && !over) L.push('', `ℹ️ Месяц ещё идёт — «Начать новый месяц» появится ${human(fm.due)}.`);
  rows.push([['↩️ Назад', 'fp']]);
  return send(ctx, L.join('\n'), rows);
}
async function fmClose(ctx) {                          // 26-е: итог в таблицу + новый план на подтверждение
  const { fm, over } = await getFm(ctx); if (!over) return fmScreen(ctx);
  const s = await fmStats(ctx, fm.start, fm.end), nal = await nalBalance(ctx), g = await getGoals(ctx);
  const hist = (await store(ctx, { op: 'get', k: 'fmHist' })) || {};
  const ks = Object.keys(hist), n = ks.length + 1, avg = f => Math.round((ks.reduce((a, k) => a + f(hist[k]), 0) + f(s)) / n);
  hist[fm.start] = { ...s, plan: fm.plan, nal }; await store(ctx, { op: 'put', k: 'fmHist', v: hist });
  const next = await fmMake(ctx, fmBounds(), s);
  const goalsTxt = Object.values(g.list).map(x => `${x.name}: ${x.done ? 'выполнена' : Math.round(x.saved / x.sum * 100) + '%'}`).join('; ');
  await gas(ctx, [{ op: 'append', sheet: FM_SHEET, row: [`${dm(fm.start)}.${fm.start.slice(0, 4)} – ${dm(fm.end)}.${fm.end.slice(0, 4)}`, fm.plan, nal, nal >= fm.plan ? 'да' : 'нет',
    s.inc['PS SHOP'] || 0, s.inc['Аренда PS5'] || 0, s.inc['Leadex'] || 0, s.inc['Личное'] || 0, s.incT, s.expT, s.lexpT, goalsTxt,
    avg(h => h.incT), avg(h => h.expT), next.plan, (await store(ctx, { op: 'get', k: 'fmNote' })) || ''] }]);
  await store(ctx, { op: 'put', k: 'fm', v: { ...next, draft: true } });
  await send(ctx, `✅ Итог месяца ${dm(fm.start)} → ${dm(fm.end)} записан в таблицу (лист «${FM_SHEET}»).`);
  return fmScreen(ctx).then(() => send(ctx, `📊 <b>Новый план до ${human(next.due)}: ${fmt(next.plan)}</b>\nПринять или поставить свою сумму?`, [[['✅ Принять', 'fma', 'success'], ['✏️ Своя сумма', 'fme']]]));
}
async function fmEvening(env) {                       // 23:03: норма дня не набрана — напомнить (владелец 27.11)
  const ctx = { env, out: [] }; const cfg = await config(ctx, true);
  ctx.chat = cfg.owners[0]; if (!ctx.chat) return;
  const s = await fmToday(ctx); if (s.over || !s.rem || !s.dayNeed || s.done >= s.dayNeed) return;
  ctx.noTrack = true;
  await send(ctx, `📊 <b>Сегодня норма не набрана</b>\nОтложено в Нал: ${fmt(s.done)} из ${fmt(s.dayNeed)}, осталось ${fmt(s.dayNeed - s.done)}.\nНе успели — остаток разложится на следующие дни.`, [[['📊 План', 'fp', 'primary']]]);
}
// ---------- Лимиты (задача 11, владелец 27.11): после расхода — предупредить на 70% и 100% лимита финмесяца ----------
async function limitCheck(ctx, d) {
  const [g] = await gas(ctx, [{ op: 'get', sheet: 'Лимиты', range: 'A2:H40' }]);
  const warn = (await store(ctx, { op: 'get', k: 'limWarn' })) || {}, fs = fmBounds().start; let changed = false;
  for (const r of g.values || []) {
    if (r[0] !== d.dir || !(r[2] === 'группа' ? r[1] === d.group : r[1] === d.cat)) continue;
    const lim = num(r[5]), spent = num(r[6]); if (!(lim > 0)) continue;
    const pct = Math.round(spent / lim * 100), lvl = pct >= 100 ? 100 : pct >= 70 ? 70 : 0, key = fs + '|' + r[0] + '|' + r[1];
    if (!lvl || (warn[key] || 0) >= lvl) continue;
    warn[key] = lvl; changed = true;
    await send(ctx, lvl === 100
      ? `🔴 <b>Лимит «${esc(r[1])}» исчерпан</b>\nПотрачено ${fmt(spent)} из ${fmt(lim)} (${pct}%) — до 26-го.`
      : `⚠️ <b>«${esc(r[1])}»: ${pct}% лимита</b>\nПотрачено ${fmt(spent)} из ${fmt(lim)}, осталось ${fmt(lim - spent)} до 26-го.`);
  }
  if (changed && !ctx.dry) await store(ctx, { op: 'put', k: 'limWarn', v: warn });
}
async function onFm(ctx, cfg, k, v, mid, st) {
  await gone(ctx, mid); await putSt(ctx, {});
  if (k === 'fp') return fmScreen(ctx);
  if (k === 'fmr') return fmReview(ctx, Math.min(5, Math.max(1, +v || 1)));
  if (k === 'fmn') return fmClose(ctx);
  if (k === 'fma') { const fm = await store(ctx, { op: 'get', k: 'fm' }); if (fm) { fm.draft = false; await store(ctx, { op: 'put', k: 'fm', v: fm }); } await send(ctx, '✅ План принят. Удачного месяца!'); return goalsScreen(ctx); }
  if (k === 'fme') { await putSt(ctx, { g: {}, await: 'fmsum' }); return send(ctx, '✏️ Какой план на месяц? Напишите сумму, например <code>40000000</code>.', [[['↩️ Назад', 'fp']]]); }
}
async function fmSetPlan(ctx, text) {
  const a = parseAmount(text.replace(/сум[а-я]*/i, '')); if (!a || !(a.amount > 0)) return send(ctx, 'Не понял сумму. Например <code>40000000</code>.');
  const fm = await store(ctx, { op: 'get', k: 'fm' }); fm.plan = Math.round(a.amount); fm.draft = false; fm.manual = true;
  await store(ctx, { op: 'put', k: 'fm', v: fm }); await putSt(ctx, {});
  await send(ctx, `✅ План на месяц: ${fmt(fm.plan)}.`); return fmScreen(ctx);
}

async function onCallback(ctx, q, again) {
  const cfg = await config(ctx);
  const [k, v] = q.data.split(':');
  const mid = q.message.message_id;
  let st = await getSt(ctx);
  if (!again) await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (k === 'pt') {                                  // готовый тип записи: PS SHOP ➕/➖, Аренда — предоплата/залог
    const T = { '+': 'Доход', '-': 'Расход', pre: 'Предоплата', zal: 'Залог' }[v];
    const dir = st.dir || (v === 'pre' || v === 'zal' ? 'Аренда PS5' : 'PS SHOP');
    await putSt(ctx, { dir, ptype: T, ord: st.ord, ps: st.ps });
    await gone(ctx, mid);
    const hint = { '+': 'Пишите доход. Например: «игра 450 000 на Приёмку».', '-': 'Пишите расход. Например: «OLX 50 000 с Расходки».',
      pre: 'Пишите предоплату: сумму, карту и дату брони. Например: «50 000 на Капитал, бронь 28.11».', zal: 'Пишите залог: сумму и карту. Например: «залог 300 000 на Капитал».' }[v];
    if (v === 'pre') return send(ctx, '<b>Сколько предоплата?</b>', [[['50 000', 'pa:50000'], ['100 000', 'pa:100000']], [['150 000', 'pa:150000'], ['200 000', 'pa:200000']], [BACK]]);
    if (T === 'Доход' || T === 'Расход') {               // сразу кнопки категорий: можно нажать или сказать голосом (владелец 27.11)
      const gs = [...new Set(cfg.cats.filter(c => c.dir === dir && c.kind === T && !HIDDEN_GROUPS.includes(c.group)).map(c => c.group))];
      const btn = (g, i) => [g, 'pg:' + i, CAT_STYLE[g]];
      // порядок кнопок дохода PS SHOP (владелец 27.11): главная — «Подписка», большая внизу
      const ORDER = ['Игры PS5', 'Игры PS4', 'GTA 6', 'Чистка PlayStation', 'Аксессуары', 'Консоль'], MAIN = 'Подписка';
      const list = gs.map(btn).sort((a, b) => (ORDER.indexOf(a[0]) + 1 || 99) - (ORDER.indexOf(b[0]) + 1 || 99));
      const rows = chunk(list.filter(b => b[0] !== MAIN), 2);
      const mi = gs.indexOf(MAIN); if (mi >= 0) rows.push([btn(MAIN, mi)]);
      const sign = T === 'Доход' ? '<tg-emoji emoji-id="5253652327734192243">➕</tg-emoji>' : '<tg-emoji emoji-id="5255775038010829248">➖</tg-emoji>';
      return send(ctx, `${sign} <b>${T}</b>`, [...rows, [['↩️ Назад', 'd:' + DIRS.indexOf(dir)]]]);   // «Назад» — в свой раздел (владелец 27.11)
    }
    return send(ctx, hint, [[BACK]]);
  }
  if (k === 'pg') {                                  // категория нажата кнопкой → дальше сумма (текстом или голосом)
    const gs = [...new Set(cfg.cats.filter(c => c.dir === st.dir && c.kind === st.ptype && !HIDDEN_GROUPS.includes(c.group)).map(c => c.group))];
    const g = gs[+v]; if (!g || !st.dir) return dirMenu(ctx);
    await gone(ctx, mid);
    const d = draftFrom(cfg, st.dir, { type: st.ptype }, '', true);
    const subs = cfg.cats.filter(c => c.dir === st.dir && c.kind === st.ptype && c.group === g);
    Object.assign(d, { group: g, cat: subs.length === 1 ? subs[0].cat : null, comment: g, src: 'кнопка', n: 1, of: 1 });
    const nst = { d, queue: [], dir: st.dir, ptype: st.ptype };
    if (subs.length > 1) {                                // сразу разделы группы (владелец 27.11)
      await putSt(ctx, nst);
      return send(ctx, `🏷 <b>${esc(g)}</b>: что именно?`, [...chunk(subs.map((c, i) => [c.cat, 's:' + i, CAT_STYLE[g]]), 2), [['↩️ Назад', 'pt:' + (st.ptype === 'Доход' ? '+' : '-')]]]);
    }
    return askNext(ctx, cfg, nst);
  }
  if (k === 'menu') { await gone(ctx, mid); return dirMenu(ctx); }
  if (k === 'ns') { await gone(ctx, mid); return onNs(ctx, cfg, st, v); }
  if (k === 'wp' || k === 'wn' || k === 'wpf') return onWifeReq(ctx, cfg, k, v, mid);   // ответ на «Дай денюжку»
  if (k === 'supd') { await gone(ctx, mid); return closeSupplier(ctx, cfg); }   // долг стирается в supplierDone, после ответа   // долг погашен до следующего /report
  if (k === 'sp') {                                  // после заявки PS SHOP: сколько рублей ушло поставщику
    await tg(ctx, 'editMessageReplyMarkup', { chat_id: ctx.chat, message_id: mid, reply_markup: { inline_keyboard: [] } });
    if (v === 'later') { await store(ctx, { op: 'put', k: 'supUnknown', v: true }); await putSt(ctx, {}); ctx.noTrack = true; await doneMark(ctx, 'Доход'); ctx.noTrack = false; return startScreen(ctx); }   // «Позже» → тоже мишка
    await putSt(ctx, { tool: { kind: 'hpsadd' }, await: 'tool' });
    return send(ctx, '🧾 Сколько <b>рублей</b> ушло поставщику на эту заявку? Например <code>1929</code>.', [[BACK]]);
  }
  if (k === 'flat') {                                // оплата квартиры → расход Личное / Квартира / Аренда квартиры $400, дальше карта
    await unkb(ctx, mid);
    const d = draftFrom(cfg, 'Личное', { type: 'Расход', amount: FLAT_USD, currency: '$' }, '', true);
    Object.assign(d, { group: 'Жильё', cat: 'Аренда', cur: '$', comment: 'Оплата квартиры', src: 'кнопка', n: 1, of: 1 });
    return askNext(ctx, cfg, { d, queue: [] });
  }
  if (k === 'st0') { ctx.editMid = mid; return startScreen(ctx); }
  if (k === 'dbro') {
    await gone(ctx, mid); const due = await rentDue(ctx, cfg);
    if (due <= 0) return startScreen(ctx);
    await store(ctx, { op: 'put', k: 'bro', v: { amount: due } });
    return send(ctx, `👤 <b>Брату перевести: ${fmt(due)} сум</b>\nПеревели?`, [[['✅ Перевёл брату', 'bro:'], ['Позже', 'brol:']]]);
  }
  if (k === 'dsup') { await gone(ctx, mid); await putSt(ctx, {}); return supScreen(ctx); }
  if (k === 'sut') {                                 // «Перевёл на карту поставщика» (владелец 27.11): сумма кнопкой или числом
    await gone(ctx, mid); const { top } = await supNums(ctx);
    await putSt(ctx, { tool: { kind: 'sut' }, await: 'tool' });
    return send(ctx, '💸 <b>Сколько перевели с ГЛАВНОЙ на ПОСТАВЩИК?</b>' + (top ? '' : '\nНапишите сумму числом.'),
      [...(top ? [[[`✅ ${fmt(top)}`, 'sutv:' + top]]] : []), [['↩️ Назад', 'dsup']]]);
  }
  if (k === 'sutv') { await gone(ctx, mid); await putSt(ctx, {}); return supTopUp(ctx, cfg, +v); }
  if (k === 'mr') { await gone(ctx, mid); await putSt(ctx, {}); const [kind, di] = v.split('|'); return monthReport(ctx, kind, di === undefined ? null : +di); }
  if (k === 'rs') {                                  // проставить значок приставки существующему заказу
    const [oid, p] = v.split('|'); const m = await getOrds(ctx);
    if (m[oid] && !ordList(m).some(o => o.ps === p)) { m[oid].ps = p; await putOrds(ctx, m); }
    ctx.editMid = mid; const nst = { dir: 'Аренда PS5', ord: oid }; await putSt(ctx, nst); return rentScreen(ctx, nst);
  }
  if (k === 'ro' || k === 'rp') {                    // выбран клиент / приставка нового клиента
    await gone(ctx, mid);
    if (k === 'ro' && v === 'new') return rentConsole(ctx);
    if (k === 'rp' && ordList(await getOrds(ctx)).some(o => o.ps === v)) return rentConsole(ctx);   // уже занята
    const nst = k === 'ro' ? { dir: 'Аренда PS5', ord: v } : { dir: 'Аренда PS5', ord: 'new', ps: v };
    await putSt(ctx, nst); return rentScreen(ctx, nst);
  }
  if (k === 'ra') {                                  // Аренда: записать расход / таблица
    await gone(ctx, mid); await putSt(ctx, { dir: 'Аренда PS5' });
    if (v === 'tab') return send(ctx, '📄 Таблицы аренды ещё нет. Привяжем позже.', [[['↩️ Назад', 'd:1']]]);
    if (v === 'inv') return rentInvScreen(ctx, cfg);
    return onCallback(ctx, { ...q, data: 'pt:-' }, true);
  }
  if (['gl', 'gs', 'gk', 'gd', 'gx', 'gy', 'gn', 'gw', 'gu', 'gdn'].includes(k)) return onGoal(ctx, cfg, k, v, mid, st);
  if (['fp', 'fmr', 'fmn', 'fma', 'fme'].includes(k)) return onFm(ctx, cfg, k, v, mid, st);   // 📊 план финмесяца   // 🎯 Цели
  if (k === 'tr') {                                  // 🔄 перевод между своими картами (владелец 27.11): сумма → откуда → куда
    await gone(ctx, mid);
    return askNext(ctx, cfg, { d: Object.assign(draftFrom(cfg, 'Личное', { type: 'Между своими' }, '', true), { src: 'кнопка', n: 1, of: 1, comment: 'Перевод между своими' }), queue: [], dir: 'Личное' });
  }
  if (k === 'ln') {                                  // «Дал в долг» (владелец 27.11)
    await gone(ctx, mid);
    if (v === 'new') return askNext(ctx, cfg, { d: Object.assign(draftFrom(cfg, 'Личное', { type: 'Дал в долг' }, '', true), { src: 'кнопка', n: 1, of: 1, comment: 'Дал в долг' }), queue: [], dir: 'Личное' });
    const L = (await store(ctx, { op: 'get', k: 'loans' })) || {}, x = L[v];
    if (!x || x.done) return send(ctx, 'Этот долг уже закрыт.');
    const d = Object.assign(draftFrom(cfg, 'Личное', { type: 'Возврат долга', amount: x.sum }, '', true), { src: 'кнопка', n: 1, of: 1, loan: v, comment: `Вернул долг: ${x.whom}` });
    return askNext(ctx, cfg, { d, queue: [], dir: 'Личное' });
  }
  if (k === 'lq') {                                  // экран LEADEX
    await gone(ctx, mid); await putSt(ctx, { dir: 'Leadex' });
    if (v === 'tab') return send(ctx, '📄 Таблицы LEADEX ещё нет. Привяжем позже.', [[['↩️ Назад', 'd:2']]]);
    if (v === 'exp') return onCallback(ctx, { ...q, data: 'pt:-' }, true);
    if (v === 'pre') return askNext(ctx, cfg, { d: Object.assign(draftFrom(cfg, 'Leadex', { type: 'Предоплата' }, '', true), { src: 'кнопка', n: 1, of: 1, comment: 'Предоплата' }), queue: [], dir: 'Leadex' });
    if (v === 'inv') return askNext(ctx, cfg, { d: Object.assign(draftFrom(cfg, 'Leadex', { type: 'Вложение' }, '', true), { src: 'кнопка', n: 1, of: 1, comment: 'Вложение в LEADEX' }), queue: [], dir: 'Leadex' });
    const ds = dealList(await getDeals(ctx));                // Поступление: какая сделка
    return send(ctx, '💵 <b>Поступление: какая сделка?</b>', [...ds.map(o => [[`🤝 ${o.name}`, 'lqd:' + o.id]]), [['🆕 Без предоплаты', 'lqd:new']], [['🛠 Поддержка', 'lqd:sup']], [BACK]]);
  }
  if (k === 'lqd') {
    await gone(ctx, mid);
    const m = await getDeals(ctx), o = m[v];
    const cat = v === 'sup' ? 'Поддержка (ежемесячная)' : 'Доплата за сайт';
    const d = Object.assign(draftFrom(cfg, 'Leadex', { type: 'Доход' }, '', true), { group: cat, cat, deal: o ? o.id : null, src: 'кнопка', n: 1, of: 1,
      comment: o ? `Поступление по сделке «${o.name}»` : v === 'sup' ? 'Поддержка сайта' : 'Поступление без предоплаты' });
    return askNext(ctx, cfg, { d, queue: [], dir: 'Leadex' });
  }
  if (k === 'ar') {                                  // оплата (или продление) / залог для выбранного клиента
    await gone(ctx, mid);
    if (v === 'list') { await putSt(ctx, { dir: 'Аренда PS5' }); return rentOrders(ctx); }
    if (!st.ord) { await putSt(ctx, { dir: 'Аренда PS5' }); return rentPick(ctx, v); }
    return onCallback(ctx, { ...q, data: `ao:${v}|${st.ord}` }, true);
  }
  if (k === 'ao') {                                  // выбран заказ (или новый)
    const [kind, oid] = v.split('|'); await gone(ctx, mid);
    const m = await getOrds(ctx), o = m[oid], ps = oid === 'new' ? st.ps || '' : undefined;
    if (kind === 'zl') return askNext(ctx, cfg, { d: rentDraft(cfg, 'Залог', { ord: oid, ps, comment: 'Залог ' + (o ? o.id : 'нового клиента ' + (ps || '')) }), queue: [] });
    if (o && o.paid) {                                // заказ уже идёт → продление
      const z = (await openItems(ctx)).filter(x => o.zalog.includes(x.id));
      if (!z.length) return askNext(ctx, cfg, { d: rentDraft(cfg, 'Доход', { ord: oid, group: 'Аренда', cat: 'Продление', comment: 'Продление ' + oid }), queue: [] });
      return send(ctx, `➕ <b>Продление ${o.id}: с залога или поступление?</b>`, [[['💵 Поступление', `ap:${oid}`]], ...z.map(x => [[`🔐 Из залога (${fmt(x.sum)})`, 'zp:' + x.id]]), [BACK]]);
    }
    return askNext(ctx, cfg, { d: rentDraft(cfg, 'Доход', { ord: oid, ps, group: 'Аренда', cat: 'Оплата аренды', comment: 'Оплата аренды ' + (o ? o.id : 'нового клиента ' + (ps || '')) }), queue: [] });
  }
  if (k === 'ap') { await gone(ctx, mid); return askNext(ctx, cfg, { d: rentDraft(cfg, 'Доход', { ord: v, group: 'Аренда', cat: 'Продление', comment: 'Продление ' + v }), queue: [] }); }
  if (k === 'zg') {                                  // залог после оплаты
    const [oid, a] = v.split('|'); await gone(ctx, mid);
    if (a === '0') {
      if (await store(ctx, { op: 'get', k: 'pendShare' })) {   // залога нет → расчёт с братом и итоговый стикер
        await store(ctx, { op: 'put', k: 'pendShare', v: false }); await store(ctx, { op: 'put', k: 'pendDone', v: null }); ctx.noTrack = true;
        if (await rentShare(ctx, cfg)) { await putSt(ctx, {}); return; }
        await doneMark(ctx, 'Доход'); ctx.noTrack = false;
      }
      return nextOrMenu(ctx, cfg, {});
    }
    return askNext(ctx, cfg, { d: rentDraft(cfg, 'Залог', { ord: oid, amount: a === 'x' ? null : Number(a), comment: 'Залог ' + oid }), queue: [] });
  }
  if (k === 'ac') {                                  // закрыть заказ можно только когда нет открытых залогов/предоплат
    const m = await getOrds(ctx), o = m[v]; if (!o) { await gone(ctx, mid); return send(ctx, 'Заказ не найден.', [[BACK]]); }
    const open = (await openItems(ctx)).filter(x => o.prepay.includes(x.id) || o.zalog.includes(x.id));
    if (open.length) return send(ctx, `⚠️ В заказе ${o.id} ещё ${open.map(x => `${x.type.toLowerCase()} ${fmt(x.sum)}`).join(' и ')}. Сначала отметьте, что с ними: вернули клиенту, удержали или бронь сгорела. Тогда заказ закроется сам.`, [[BACK]]);
    o.closed = true; await putOrds(ctx, m); await rentNotify(ctx, `🏁 <b>Заказ ${o.ps ? o.ps + ' ' : ''}${o.id} закрыт</b> — приставку вернули.`);
    await gone(ctx, mid); return send(ctx, `🏁 Заказ ${o.id} закрыт.`);
  }
  if (k === 'pa') {                                  // предоплата аренды кнопкой суммы → дальше карта и дата брони кнопками
    await gone(ctx, mid);
    const d = rentDraft(cfg, 'Предоплата', { amount: Number(v), ord: st.ord || 'new', ps: st.ps || '', comment: 'Предоплата ' + fmt(Number(v)) });
    return askNext(ctx, cfg, { d, queue: [] });
  }
  if (k === 'd') {                                   // направление
    const dir = DIRS[+v];
    if (st.d && !st.d.dir) { remember(st); st.d.dir = dir; refill(cfg, st.d); await gone(ctx, mid); return askNext(ctx, cfg, st); }
    if (st.d && st.editDir) { st.d.dir = dir; st.d.group = st.d.cat = null; st.editDir = false; await gone(ctx, mid); return st.d.type === 'Между своими' ? reshow(ctx, st) : askGroup(ctx, cfg, st); }
    await gone(ctx, mid);
    if (st.pending) return startDraft(ctx, cfg, dir, st.pending);
    await putSt(ctx, { dir });
    const extra = [];                                       // «Закрыл оплату» убран (владелец 26.11): оплата — через «Долг поставщику» на СТАРТ
    extra.push([BACK]);                                   // назад в главное меню
    if (dir === 'PS SHOP') return send(ctx, '<b>PS SHOP</b>', [[['+', 'pt:+']], [['−', 'pt:-']], [['📉 Расходы', 'mr:out|0']], ...extra]);   // на всю ширину, с подписью (владелец 27.11)
    if (dir === 'Аренда PS5') return rentStart(ctx);
    if (dir === 'Leadex') return leadexScreen(ctx);
    if (dir === 'Личное') return send(ctx, '<b>ЛИЧНОЕ</b>', [[['−', 'pt:-']], [['+', 'pt:+']], [['🤝 Дал в долг', 'ln:new', 'primary']], [['📉 Расходы', 'mr:out|3']], ...extra]);   // владелец 27.11
    return send(ctx, `Пишите запись для <b>${dir}</b>. Например: «расход 85 000 продукты с Apple Pay» или «пришло 450к за игру на Приёмку».`, extra);
  }
  if (k === 'bk' && st.tool) { ctx.editMid = mid; await putSt(ctx, {}); return dirMenu(ctx); }
  if (k === 'bk') {
    ctx.editMid = mid;
    if (st.editDir) { st.editDir = false; return reshow(ctx, st); }
    if (st.hist && st.hist.length) { st.d = JSON.parse(st.hist.pop()); st.await = null; return complete(st.d) ? reshow(ctx, st) : askNext(ctx, cfg, st); }
    await putSt(ctx, {}); return dirMenu(ctx);
  }
  if (!st.d) return edit(ctx, mid, 'Эта запись уже закрыта. Нажмите /menu, чтобы начать новую.');
  if (['ty', 'g', 's', 'k', 'dt'].includes(k)) remember(st);
  const d = st.d;
  if (k === 'un') { remember(st); d.until = v; st.await = null; await gone(ctx, mid); return askNext(ctx, cfg, st); }   // срок аренды
  if (k === 'ty') { d.type = TYPES[+v]; d.group = d.cat = null; await gone(ctx, mid); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st); }
  if (k === 'g') {
    const g = st.groups[+v]; const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === g);
    if (subs.length === 1) { d.group = g; d.cat = subs[0].cat; await gone(ctx, mid); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st); }
    d.group = g; await putSt(ctx, st);
    return edit(ctx, mid, `🏷 ${g}: что именно?`, withBack(chunk(subs.map((c, i) => [c.cat, 's:' + i]), 2)));
  }
  if (k === 's') {
    const subs = cfg.cats.filter(c => c.dir === d.dir && c.kind === d.type && c.group === d.group);
    d.cat = subs[+v].cat; await gone(ctx, mid); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st);
  }
  if (k === 'k') { const c = cfg.cards[+v]; d[st.side] = c.name; await gone(ctx, mid); return st.editing ? afterEdit(ctx, cfg, st) : askNext(ctx, cfg, st); }
  if (k === 'cl' && d) {                            // календарь: открыть / листать месяц
    const loan = d.type === 'Дал в долг';
    const txt = loan ? '<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>Когда вернут долг?</b> Выберите дату.' : '<tg-emoji emoji-id="5413879192267805083">🗓</tg-emoji> <b>Выберите дату брони</b>\nКрасные дни • — уже есть бронь.';
    return edit(ctx, mid, txt, await calendar(ctx, v, loan));
  }
  if (k === 'cd' && d) { if (d.type === 'Дал в долг') d.due = v; else d.book = v; await gone(ctx, mid); return reshow(ctx, st); }
  if (k === 'cord' && d) { d.ord = v; await gone(ctx, mid); return askNext(ctx, cfg, st); }
  if (k === 'cps' && d) { d.ord = 'new'; d.ps = v; await gone(ctx, mid); return askNext(ctx, cfg, st); }
  if (k === 'bd') { d.book = shiftYmd(todayYmd(), Number(v)); await gone(ctx, mid); return reshow(ctx, st); }
  if (k === 'dt') { d.date = v === '0' ? todayYmd() : shiftYmd(todayYmd(), -Number(v)); await gone(ctx, mid); return reshow(ctx, st); }
  if (k === 'no') { await gone(ctx, mid); return nextOrMenu(ctx, cfg, st); }
  if (k === 'ok') {
    if (!complete(d)) return askNext(ctx, cfg, st);
    await edit(ctx, mid, summary(d) + '\n\n⏳ Записываю…');
    try {
      if (!d.edit && d.dir === 'Аренда PS5' && (d.type === 'Предоплата' || d.type === 'Залог') && !d.ord) d.ord = 'new';
      if (!d.edit && d.ord === 'new') {                   // новый заказ аренды
        const m = await getOrds(ctx); const oid = 'A' + (++m._n);
        m[oid] = { id: oid, ps: d.ps || '', book: '', prepay: [], zalog: [], paid: false, closed: false, at: Date.now() }; await putOrds(ctx, m); d.ord = oid;
        for (const qd of st.queue || []) if (qd.ord === 'new') qd.ord = oid;   // остальные части той же оплаты — в этот же заказ
      }
      const id = await save(ctx, cfg, d);
      if (!d.edit && d.type === 'Дал в долг') {              // долг мне: в DO и строкой в «Долги и накопления»
        const L = (await store(ctx, { op: 'get', k: 'loans' })) || {};
        L[id] = { id, whom: d.whom, sum: d.cur === '$' ? Math.round(d.amount * await cbuRate(ctx, d.date)) : d.amount, due: d.due, card: d.from, done: false };
        await store(ctx, { op: 'put', k: 'loans', v: L });
        await gas(ctx, [{ op: 'append', sheet: 'Долги и накопления', row: [`Мне должен: ${d.whom} (${id})`, 'мне должны', L[id].sum, d.due.split('-').reverse().join('.'), 0, L[id].sum] }]);
      }
      if (!d.edit && d.type === 'Возврат долга' && d.loan) {
        const L = (await store(ctx, { op: 'get', k: 'loans' })) || {}; if (L[d.loan]) { L[d.loan].done = true; await store(ctx, { op: 'put', k: 'loans', v: L }); }
        const [f] = await gas(ctx, [{ op: 'find', sheet: 'Долги и накопления', col: 'A', value: `Мне должен: ${L[d.loan] ? L[d.loan].whom : ''} (${d.loan})` }]);
        if (f.row) await gas(ctx, [{ op: 'set', sheet: 'Долги и накопления', range: `E${f.row}:F${f.row}`, values: [[L[d.loan].sum, 0]] }]);
      }
      if (!d.edit && d.goal) { const g = await getGoals(ctx); if (g.list[d.goal]) { g.list[d.goal].done = true; g.list[d.goal].rec = id; await putGoals(ctx, g); } }   // цель выполнена
      if (!d.edit && d.dir === 'Leadex' && d.type === 'Предоплата') {   // новая сделка LEADEX
        const m = await getDeals(ctx); const did = 'D' + (++m._n);
        m[did] = { id: did, name: d.dealName || 'сделка ' + did, prepay: [id], closed: false, at: Date.now() }; await putDeals(ctx, m);
      }
      await edit(ctx, mid, `✅ Записано · ${id}${d.ord && !d.edit ? ' · заказ ' + d.ord : ''}`, [[['✏️ Исправить', 'fx:' + id], ['🗑 Удалить', 'rm:' + id]]]);
      if (d.type === 'Расход') { ctx.noTrack = true; await limitCheck(ctx, d).catch(() => {}); }   // лимиты 70% / 100%
      ctx.keep = [mid]; ctx.noTrack = true;            // запись и расчёты после неё остаются в чате
      { const t = (await store(ctx, { op: 'get', k: 'trail' })) || []; await store(ctx, { op: 'put', k: 'trail', v: t.filter(i => i !== mid) }); ctx.trail = ctx.trail.filter(i => i !== mid); }
      // Аренда (владелец 26.11): пока не ответили «Залог взяли?» — ни расчёта с братом, ни стикера, ни меню
      const waitZ = !d.edit && d.ord ? await afterOrder(ctx, cfg, d, id) : false;
      const pend = !d.edit && (waitZ || (d.ord && (await store(ctx, { op: 'get', k: 'pendShare' })) === d.ord));   // ждём ответ по этому же заказу
      const rentMoney = !d.edit && d.dir === 'Аренда PS5' && (d.type === 'Доход' || d.type === 'Расход');
      if (rentMoney && pend && d.type !== 'Залог') {
        await store(ctx, { op: 'put', k: 'pendShare', v: d.ord }); await store(ctx, { op: 'put', k: 'pendDone', v: d.type });
        ctx.noTrack = false;
        if (st.queue && st.queue.length) return nextOrMenu(ctx, cfg, st);   // следующая часть той же оплаты
        await putSt(ctx, {}); return;                                     // ждём ответ про залог
      }
      if (rentMoney && await rentShare(ctx, cfg)) { ctx.noTrack = false; await putSt(ctx, {}); return; }
      let mark = d.type;
      if (!d.edit && d.type === 'Залог' && d.ord && (await store(ctx, { op: 'get', k: 'pendShare' })) === d.ord) {   // залог записан → теперь расчёт и итог
        await store(ctx, { op: 'put', k: 'pendShare', v: false }); await store(ctx, { op: 'put', k: 'pendDone', v: null });
        if (await rentShare(ctx, cfg)) { ctx.noTrack = false; await putSt(ctx, {}); return; }
        mark = 'Доход';
      }
      if (!d.edit && d.dir === 'PS SHOP' && d.type === 'Доход' && d.cat !== 'Проценты по вкладу' && !(st.queue && st.queue.length)) {
        await send(ctx, '🧾 <b>Поставщику?</b> Напишите, сколько <b>рублей</b> ушло на эту заявку, например <code>400</code>. Или нажмите «Позже».', [[['Позже', 'sp:later']]]);
        ctx.noTrack = false; await putSt(ctx, { tool: { kind: 'hpsadd' }, await: 'tool' }); return;     // ждём рубли или «Позже»
      }
      if (!d.edit && d.dir === 'Leadex' && d.type === 'Доход') {
        const uzs = (d.cur === '$' ? Math.round(d.amount * await cbuRate(ctx, d.date)) : d.amount) + await releaseDeal(ctx, cfg, d);   // + предоплата сделки
        if (await leadexSplit(ctx, cfg, id, uzs)) { ctx.noTrack = false; await putSt(ctx, {}); return; }
      }
      if (!d.edit) await doneMark(ctx, mark);           // один раз в самом конце
      ctx.noTrack = false; return nextOrMenu(ctx, cfg, st);
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
    if (v === 't') return send(ctx, 'Тип записи:', withBack(typeRows(d.dir)));
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
    await dropFromOrders(ctx, id);
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
  if (m && /group/.test(m.chat.type || '')) {             // рабочая группа с братом: бот только пишет туда; привязка — /group от владельца
    if (cfg.owners.includes(String(from.id)) && /^\/(leadex|лидекс)(@\w+)?$/i.test(m.text || '')) {   // рабочая группа с Ришатом (владелец 28.11)
      await store(ctx, { op: 'put', k: 'leadexGroup', v: m.chat.id });
      return tg(ctx, 'sendMessage', { chat_id: m.chat.id, text: premium('✅ <b>Группа LEADEX подключена.</b>\nСюда буду писать события LEADEX.'), parse_mode: 'HTML' });
    }
    if (cfg.owners.includes(String(from.id)) && /^\/(group|группа)(@\w+)?$/i.test(m.text || '')) {
      await store(ctx, { op: 'put', k: 'rentGroup', v: m.chat.id });
      return tg(ctx, 'sendMessage', { chat_id: m.chat.id, text: premium('✅ <b>Группа аренды подключена.</b>\nСюда буду писать: новые клиенты, оплаты, залоги, возвраты, расходы и долю брата.'), parse_mode: 'HTML' });
    }
    return;
  }
  if ((cfg.viewers || []).includes(String(from.id)) && !cfg.owners.includes(String(from.id))) {   // брат: только просмотр аренды
    ctx.viewer = true; ctx.noTrack = true;
    if (q) { await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id }); await gone(ctx, q.message.message_id); }
    return viewerScreen(ctx, q ? q.data : 'vm', cfg).catch(e => send(ctx, '⚠️ Ошибка: ' + e.message));
  }
  if ((cfg.wife || []).includes(String(from.id)) && !cfg.owners.includes(String(from.id))) {   // жена (задача 25)
    ctx.wife = true;
    try { return await onWife(ctx, m, q, cfg); } catch (e) { if (ctx.dry) ctx.out.push({ method: 'ERR', text: e.stack }); return send(ctx, '⚠️ Ошибка: ' + e.message); }
  }
  if (!cfg.owners.includes(String(from.id))) {          // незнакомым не отвечаем, но запоминаем
    await ctx.env.KV.put('seen:' + from.id, JSON.stringify({ id: from.id, name: [from.first_name, from.last_name].filter(Boolean).join(' '), user: from.username || '', at: Date.now() }));
    return;
  }
  if (q && q.data === 'noop') return tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id });
  if (q && q.message) { ctx.orig = q.message.text || ''; ctx.origMid = q.message.message_id; }
  ctx.trail = m ? [m.message_id] : [];
  if (q && q.message && q.message.reply_markup) {        // нажата кнопка с премиум-эмодзи → бот присылает этот эмодзи (владелец 26.11)
    const b = q.message.reply_markup.inline_keyboard.flat().find(b => b.callback_data === q.data);
    if (b && b.icon_custom_emoji_id) await send(ctx, `<tg-emoji emoji-id="${b.icon_custom_emoji_id}">⭐</tg-emoji>`);
  }
  try {
    if (q && /^lx(ok|no|in|if):/.test(q.data)) return await onLeadex(ctx, q);
    if (q && /^(rsv|rsvl|bro|brol|rsvf|brof):/.test(q.data)) return await onShares(ctx, q);
    if (q && q.data === 'sup') { await tg(ctx, 'answerCallbackQuery', { callback_query_id: q.id }); await gone(ctx, q.message.message_id); return await closeSupplier(ctx, await config(ctx)); }
    if (q && /^(zl|adj|aj|zr|zry|zp|zk|pc|pb|p0|pk)(:|$)/.test(q.data)) return await onTool(ctx, q);
    if (q) return /^(rm|rmy|rmn|fx):/.test(q.data) ? await onSavedButton(ctx, q) : await onCallback(ctx, q);
    return await onMessage(ctx, m);
  } catch (e) {
    ctx.noTrack = true; await send(ctx, '⚠️ Ошибка: ' + e.message + '\nПопробуйте ещё раз или нажмите /menu.');
  } finally {
    if (ctx.trail && ctx.trail.length) { const t = (await store(ctx, { op: 'get', k: 'trail' })) || []; await store(ctx, { op: 'put', k: 'trail', v: [...t, ...ctx.trail].slice(-200) }); }
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
  async scheduled(ev, env, ectx) { ectx.waitUntil(ev.cron === '3 18 * * *' ? supReminder(env).then(() => flatReminder(env, 'eve')).then(() => cushionReminder(env)).then(() => fmEvening(env)) : ev.cron === '31 7 * * *' ? flatReminder(env, 'day') : morning(env)); },
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
    if (u.pathname === '/rm') {                               // служебное: удалить запись как кнопкой 🗑
      const ctx = { env, out: [] }; const id = u.searchParams.get('id');
      const [f] = await gas(ctx, [{ op: 'find', sheet: 'Журнал', col: 'A', value: id }]);
      if (f.row) await gas(ctx, [{ op: 'set', sheet: 'Журнал', range: `M${f.row}`, values: [['удалено']] }]);
      const [z] = await gas(ctx, [{ op: 'find', sheet: 'Залоги и предоплаты', col: 'A', value: id }]);
      if (z.row) await gas(ctx, [{ op: 'set', sheet: 'Залоги и предоплаты', range: `H${z.row}`, values: [['удалено']] }]);
      await dropFromOrders(ctx, id);
      return Response.json({ journal: f.row || null, items: z.row || null, ords: await getOrds(ctx) });
    }
    if (u.pathname === '/wipe') {                             // служебное: обнулить память бота (номера R, заказы, долги, черновики)
      const ctx = { env, out: [] };
      for (const k of ['seq', 'trail', 'ords', 'pendShare', 'pendDone', 'supDebt', 'supUnknown', 'bro', 'lxLast', 'psLast', 'rateDay', 'deals', 'fm', 'fmHist', 'fmNote']) await store(ctx, { op: 'put', k, v: null });
      { const g = await getGoals(ctx); for (const x of Object.values(g.list)) { x.saved = 0; x.card = null; x.done = false; x.rec = null; } g.cush = { total: 0, m: {} }; await putGoals(ctx, g); }   // цели остаются, накопленное — 0; долги (loans) не трогаем
      await putSt(ctx, {}); return Response.json({ ok: true, ords: await getOrds(ctx) });
    }
    if (u.pathname === '/ordreset') {                         // служебное: пересобрать заказы из открытых залогов/предоплат
      const ctx = { env, out: [] }; await store(ctx, { op: 'put', k: 'ords', v: null });
      await store(ctx, { op: 'put', k: 'pendShare', v: false }); await store(ctx, { op: 'put', k: 'pendDone', v: null });
      return Response.json(await getOrds(ctx));
    }
    if (u.pathname === '/ord') {                              // служебное: открыть/закрыть заказ ?id=A1&closed=0|1
      const ctx = { env, out: [] }; const m = await getOrds(ctx), o = m[u.searchParams.get('id')];
      if (o) { o.closed = u.searchParams.get('closed') === '1'; await putOrds(ctx, m); }
      return Response.json(m);
    }
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
      if (u.searchParams.get('t') === 'hps') return Response.json({ hps: await readHps(ctx, bytes).catch(e => String(e)) });
      try { return Response.json({ text: u.searchParams.get('t') === 'photo' ? await readReceipt(ctx, bytes) : await transcribe(ctx, bytes), raw: ctx.raw }); }
      catch (e) { return Response.json({ error: String(e && e.stack || e) }); }
    }
    if (u.pathname === '/flat') { await flatReminder(env, u.searchParams.get('w') || 'day'); return new Response('done'); }
    if (u.pathname === '/morning') { await morning(env); return new Response('done'); }
    if (u.pathname === '/fmbase' && req.method === 'POST') { const c = { env, dry: !!u.searchParams.get('dry') }; await store(c, { op: 'put', k: 'fmBase', v: await req.json() }); return new Response('saved'); }   // расходы из опроса (суммы не в коде)
    if (u.pathname === '/loanset') {                          // служебное: поправить долг мне (сумма / срок): ?id=R#&sum=&due=YYYY-MM-DD
      const ctx = { env, out: [] }, L = (await store(ctx, { op: 'get', k: 'loans' })) || {}, x = L[u.searchParams.get('id')];
      if (!x) return Response.json({ error: 'нет такого долга', ids: Object.keys(L) });
      if (u.searchParams.get('sum')) x.sum = Number(u.searchParams.get('sum'));
      if (u.searchParams.get('due')) x.due = u.searchParams.get('due');
      await store(ctx, { op: 'put', k: 'loans', v: L }); return Response.json(x);
    }
    if (u.pathname === '/rec' && req.method === 'POST') {     // служебное: записать готовые записи по просьбе владельца из чата (как кнопкой «Записать»)
      const ctx = { env, out: [] }, cfg = await config(ctx), ids = [];
      for (const d of await req.json()) {
        d.date = d.date || todayYmd(); d.src = d.src || 'чат';
        if (d.ord === 'new') { const m = await getOrds(ctx); const oid = 'A' + (++m._n); m[oid] = { id: oid, ps: d.ps || '', book: '', prepay: [], zalog: [], paid: true, closed: true, at: Date.now() }; await putOrds(ctx, m); d.ord = oid; }
        const id = await save(ctx, cfg, d); ids.push(id);
        if (d.type === 'Возврат долга' && d.loan) {
          const L = (await store(ctx, { op: 'get', k: 'loans' })) || {}, x = L[d.loan];
          if (x) { x.done = true; await store(ctx, { op: 'put', k: 'loans', v: L });
            const [f] = await gas(ctx, [{ op: 'find', sheet: 'Долги и накопления', col: 'A', value: `Мне должен: ${x.whom} (${d.loan})` }]);
            if (f.row) await gas(ctx, [{ op: 'set', sheet: 'Долги и накопления', range: `E${f.row}:F${f.row}`, values: [[x.sum, 0]] }]); }
        }
      }
      return Response.json(ids);
    }
    if (u.pathname === '/cushset') {                         // служебное: подушка ?total=$&month=$ (за текущий финмесяц)
      const ctx = { env, out: [] }, g = await getGoals(ctx);
      if (u.searchParams.get('total')) g.cush.total = Number(u.searchParams.get('total'));
      if (u.searchParams.get('month')) g.cush.m[fmBounds().start] = Number(u.searchParams.get('month'));
      g.cush.card = 'Доллары'; await putGoals(ctx, g); return Response.json(g.cush);
    }
    if (u.pathname === '/rentinv') { const c = { env, dry: !!u.searchParams.get('dry') }; const v = { usd: Number(u.searchParams.get('usd')), switched: false }; await store(c, { op: 'put', k: 'rentInv', v }); return Response.json(v); }   // вложения брата в аренду, $
    if (u.pathname === '/claudeq') {                         // служебное: очередь правок владельца (?done=N — отметить сделанной, ?msg=текст — написать владельцу)
      const ctx = { env, out: [] }, q = (await store(ctx, { op: 'get', k: 'claudeQ' })) || [];
      const dn = Number(u.searchParams.get('done')); if (dn) { const x = q.find(x => x.id === dn); if (x) x.done = true; await store(ctx, { op: 'put', k: 'claudeQ', v: q }); }
      const msg = u.searchParams.get('msg'); if (msg) { const cfg = await config(ctx); ctx.chat = cfg.owners[0]; ctx.noTrack = true; await send(ctx, msg); }
      return Response.json(q);
    }
    if (u.pathname === '/ordper') { const c = { env, out: [] }, m = await getOrds(c), o = m[u.searchParams.get('id')]; if (!o) return new Response('no order');   // служебное: срок оплаты ?id=A1&r=R6&from=YYYY-MM-DD&to=YYYY-MM-DD
      (o.per = o.per || {})[u.searchParams.get('r')] = [u.searchParams.get('from'), u.searchParams.get('to')]; if (!o.closed) o.until = u.searchParams.get('to'); await putOrds(c, m); return Response.json(o); }
    if (u.pathname === '/rentsync') { const c = { env, out: [] }; await rentSync(c, await getOrds(c)); return new Response('synced'); }   // служебное: перезаписать лист «Аренда сделки»
    if (u.pathname === '/supget') { const c = { env, out: [] }; return Response.json({ debt: await store(c, { op: 'get', k: 'supDebt' }), unknown: await store(c, { op: 'get', k: 'supUnknown' }) }); }   // служебное: посмотреть долг поставщику
    if (u.pathname === '/supset') { const c = { env, out: [] }, rub = Number(u.searchParams.get('rub')), uz = Number(u.searchParams.get('uzs')); const v = { rub, usdt: null, uzs: uz > 0 ? uz : supRound(rub * RUB_TO_UZS), at: Date.now() }; await store(c, { op: 'put', k: 'supDebt', v }); await store(c, { op: 'put', k: 'supUnknown', v: false }); return Response.json(v); }   // служебное: долг поставщику в рублях
    if (u.pathname === '/claudevoice') { const c = { env, out: [] }; const said = await transcribe(c, await tgFile(c, u.searchParams.get('fid'))); const q = (await store(c, { op: 'get', k: 'claudeQ' })) || []; if (said) { q.push({ id: q.length + 1, at: Date.now(), text: said, done: false }); await store(c, { op: 'put', k: 'claudeQ', v: q }); } return Response.json({ said }); }
    if (u.pathname === '/reload') { await config({ env }, true); return new Response('reloaded'); }
    return new Response('ok');
  },
};
