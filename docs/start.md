# Finance bot — owner decisions & start balances (2026-11-25)
Decisions: USD rate = CBU auto (rate on op date); nested categories (Личное tree as proposed), taxi no limit; Google via Apps Script in sheet; code -> private repo ps-finance-bot (not created yet).
Balances:
- NBU 4408: 0
- VISA 0233: 40 540
- NBU 6440: 0.62 → set to 0 (owner 26.11: tiyins, show 0; Карты!D4 = 0)
- Ipak Yo'li 9783: 0
- PS Shop резерв = Uzum deposit "Вклад до 13,8%" (flexible, has Вывести): 500 000 (funded 25.11 from UZUM 9028; no card digits, name only; monthly ask balance -> interest income)
- UZUM 9028: 206 218.19 (screenshot 20:56)
- Kapitalbank 2660: 150 000 (screenshot)
- UZUM Bulka: 2 009 185.60
- UZUM Ars: POSTPONED by owner — ask again later (how to handle brother card/payouts)
- Карта Leadex: not opened; TEMP = Ipak Yo'li 9783 (balance 0). Direction chosen per record, so card can serve PS SHOP & Leadex
- Наличные сумы: 18 000 000
- Наличные доллары (неприкосновенный фонд): $325
- Kapitalbank 150 000 = ЗАЛОГ клиента аренды (will return consoles). NEW type not in TZ — clarifying
  Залог rules (owner): client gives deposit sometimes; recorded, not income. On console return: no extension -> full refund to client. Extension -> paid from залог (that part = rent income), rest refunded; part kept by owner decision = rent income. CONFIRMED by owner.
Total UZS (excl. Ars): 20 905 944.41; foreign (залог) 150 000
- Debts: brother $600 due end Jan 2027, aunt $300 no due date; nothing repaid (confirmed 25.11)
- Leadex investment: laptop 10 084 000, returned 0

## Infra (25.11)
- Bot: @finanstopbot. Server: Cloudflare Worker `psfinance` (account a514…33d5), https://psfinance.psshop.workers.dev, secret BOT_TOKEN.
- AI: owner chose Cloudflare Workers AI (free, fast) — NOT Claude API, NOT paid. Whisper for voice; llama for parsing; vision model for receipts. If receipt reading is poor -> photos only via Claude through GitHub Actions (owner subscription, like Postik).
- Code repo: naildominant/ps-finance-bot (private). Owner wants copyable things in code blocks; links as plain links.

## Google Sheet (stage 1, 25.11)
- «PS Финансы» id 1OXZEt2YRwHJmy8QZtCH3rZMNgaVyW5d5u7tsKONrmgU (owner's Drive), locale ru_RU (formula separator `;`), TZ Asia/Tashkent.
- Sheets: Главная (periods: today / week from Monday / last 14 days / month from 1st; balances), Журнал A–P (id, datetime, who, direction, type, group, category, UZS, USD, CBU rate, from, to, status[«удалено» excluded], source, comment, linked id), Карты (start balances col D; I = current = D + in(L) − out(K)), Категории (direction, kind, group, category), Лимиты (level группа/категория; units сум/$/% оборота), Долги и накопления, Доли (bot, stage 5), Залоги и предоплаты (status «открыт» = foreign money), Настройки (B2 CBU rate filled by bot; percentages; Telegram IDs B16:B19).
- Open: ad limit base «1% оборота» uses current-month PS SHOP income for now (question #3 pending). Apps Script not yet installed.

## Card names (owner 25.11) — sheet Карты col A, journal uses exactly these
Приёмка (NBU 4408) · Поставщик (VISA 0233) · Расходка (NBU 6440) · Ипак 9783 · UZUM вклад (reserve deposit) · Узум (UZUM 9028) · Капитал (Kapitalbank 2660) · Булка (UZUM Bulka) · Нал · Доллары.
Bot must match by short name, bank or last digits. Main sheet has 3 charts (month by direction, balances, personal by group); helper data Главная!H4:J21.

## Apps Script + worker (26.11 night)
- Apps Script is a STANDALONE project in account nail.gaynullin.official (owner's 2nd account); sheet shared to it as editor. setup() ran: daily backup 3:00 Tashkent to that account's Drive folder «PS Финансы — копии» (keeps 60).
- Web app deployed (Execute as me, Anyone). URL + key stored only as worker secrets GAS_URL, GAS_KEY. Test read OK via worker.
- Worker psfinance bindings: BOT_TOKEN, GAS_KEY, GAS_URL, KV (namespace «psfinance»), WH_SECRET. Webhook /tg set (secret header). Currently only logs senders to KV seen:<id> (for collecting Telegram IDs); /seen?k=GAS_KEY lists them.
- Owner on iPhone: Apps Script editor works only when opened from Claude app link; paste into EMPTY editor.

## Stage 2 (26.11): text dialog live
- worker/worker.js + worker/deploy.sh (keep_bindings; DO «State» migration v1 already applied — never resend).
- Dialog state + record counter (R1, R2…) in Durable Object ST (KV was stale up to 60s). KV only: cfg cache (10 min, /reload?k= forces), CBU rates, seen:<id>.
- Parse: Workers AI llama-3.3-70b → JSON; card prefilled if said, else buttons. Types now: Доход / Расход / Между своими (Предоплата/Вложение/Залог — stage 4–5).
- Delete = status «удалено» in Журнал col M; edit after save overwrites the row. CBU rate for today written to Настройки!B2 once a day on first save.
- Dry-run endpoint POST /test?k=GAS_KEY (no Telegram, no sheet writes); script in scratchpad t.py (UA must not be python-urllib — Cloudflare 403).

## TEST MODE (owner 26.11) — ACTIVE until owner says «тест окончен»
Everything writes normally. On «тест окончен»: clear Журнал rows 2+, reset DO counter `seq` to 0 and drafts, clear Залоги rows except Z1 (reset Z1 to 150 000 открыт). DO NOT restore sheet structure from the snapshot (structure changed during test: Карты K–L, new categories, formulas) — use the snapshot only to compare start values (Карты D, Долги) from snapshot «PS Финансы — эталон до теста (не трогать)» id 195unlZd8U0OZcl3hj2LO7If4z9qlUjmgOpks2AcI71I (keep Настройки!B16 owner ID; ask owner whether balances changed since 25.11 and update Карты D before restart). Then trash nothing without asking.
- Cards per direction (owner 26.11): Карты!K «Приход для направлений», L «Расход для направлений» (comma list). PS SHOP inc: Приёмка, Ипак, Нал, Доллары; exp: Расходка, Поставщик, Нал, Доллары. Аренда: Капитал, Нал, Доллары (both). Leadex inc: Ипак, Нал, Доллары; exp: Ипак, Нал. Личное: Узум, Булка, Нал, Доллары (both). Transfers: all cards. Summary shows date dd.mm.yyyy + time; Back button on every step (history stack st.hist).
- Stage 3 (26.11): voice/audio/video_note → Whisper large-v3-turbo (ru) → «🎤 text» → same parser (src голос). Photo/image doc → Mistral Small 3.1 vision (better than llama-3.2-vision; gemma not allowed on account) → JSON {incoming, own_transfer, total, date, merchant, card_last4, items} → text → parser (src фото). NEVER spread bytes into arrays (CPU limit → 1101); pass base64 data URL. /testai?k=&t=photo|voice[&m=model] for checks.
- Multi-record messages: AI splits, direction per record by meaning; queue shown «(n из N)». Single record without chosen direction → asks direction by button.
- Stage 4 (26.11): types Предоплата (asks booking date; Залоги sheet status открыт), Залог, Вложение (Leadex invest total = 10 084 000 + journal «Вложение» Leadex), Возврат залога (out, not expense), Корректировка (balance fix, dir «—», not income/expense). Menu: «📋 Залоги и брони» (return / extension / keep part / client came + доплата / burned) and «🧮 Остаток карты». Cron 0 4 * * * (9:00 Tashkent) → morning(): asks «Клиент приехал?» for bookings due. /morning?k= runs it manually.
- Monthly 1st 9:00: bot asks UZUM вклад balance; positive diff → Доход PS SHOP «Проценты по вкладу» (owner 26.11).
- UZUM Ars = card «Арс (UZUM 8350)», Карты row 12, start 3 316 200 (owner 26.11: «запиши только итоговую сумму… дальше сами»; number = incoming total on screenshot 25.10–25.11). Brother's money: shown separately on Главная A34, not in «Всего». Inc/exp lists empty → only in transfers.
- Stage 5 Leadex (26.11): payouts after EACH income (owner). After saving Leadex «Доход» bot sends split: 20% fund, 20% investment return (capped by Долги!F6), expenses since last split (DO lxLast), rest 50/50. Destination cards NOT chosen yet (owner: «пока виртуальная кнопка»). «✅ Перевёл» → journal «Возврат вложений» (cat «Возврат вложений Леадex») + Личное Доход «Доля из Leadex (50%)», row in Доли A6+. Expenses > pool: OPEN QUESTION (now: shares not accrued, warning). Предоплата/Залог types only for Аренда PS5; elsewhere → Доход.
- Stage 5 PS SHOP/rent (26.11): «закрыл оплату» (text or menu «🧾 Закрыл оплату поставщику») → asks balance left on Поставщик → Расход «Поставщик» = by-records − said → net = PS SHOP income (excl. interest) − supplier − transfers to Расходка since DO psLast → 80% Личное «Доля из PS SHOP (80%)» auto, 20% reserve reminder + «✅ Перевёл в резерв» (asks source card, records transfer → UZUM вклад). Log Доли K5:Q. Rent: after every rent income/expense (and залог/prepay outcomes) → all-time profit, brother 60% − transfers to Арс = due, «✅ Перевёл брату» (source card → Арс); Nail 40% accrued automatically as Личное «Доля из аренды (40%)». Rent category «Оплата аренды» added. Dry-run store keys auto-prefixed dry:.
- Leadex expenses > pool (owner 26.11): shortfall = exp − pool → bot says «Нужно вложить X», button «💰 Вложил X» → source card (or «без перевода, только записать») → journal Вложение Leadex (from src → Leadex card), adds to Долги C6 (investment to return). Shares 0 that time; fund 20% and return 20% still computed as before.
- Menu (owner 26.11): «📋 Залоги и брони» only after choosing Аренда PS5; «🧾 Закрыл оплату поставщику» only after choosing PS SHOP (removed from main menu). Text «закрыл оплату» still works anywhere.
- Premium emoji (owner 26.11): bot CAN send custom emoji (tg-emoji in text, icon_custom_emoji_id on buttons; empty text not allowed → ' '). Back button = red arrow 5215261582170278752 (ICON map in kb). Owner's custom emoji ids captured to KV ce:<id> (/ce?k=). /tgcall?k= POST {method,body} = direct Telegram call for experiments.
- Button colors (owner 26.11): STYLE map — PS SHOP primary (blue), Аренда success (green), Leadex danger (red), Личное primary (blue). Direction buttons have owner's premium emoji (ICON map).
- «💳 Баланс» (owner 26.11) = only shows all card balances (Карты A/I/J), total UZS excl. $ and Арс. Correction (Корректировка) no longer reachable from menu (code aj: kept) — ask owner where to put it.
- PS SHOP screen (owner 26.11): «PS SHOP ?» bold; row [+][−] (owner premium icons, text ' '), green «Закрыл оплату поставщику ✅», Back. + / − preset type Доход/Расход (st.ptype → ctx.ptype → recs[0].type).
- Done emoji (owner 26.11): after a record is saved, ONE premium emoji, then menu: Расход → 5319172285762919855 (DONE_EMO map); Доход → 5391292736647209211. Not on every action. Supplier button icon = owner checkmark 5465154027970908359. Menu centered with U+2800 pads on both sides (PAD).
- Direction (owner 26.11): if section not chosen, single record takes AI direction from words (was: always asked by button). Asks only if AI unsure.
- Clean chat (owner 26.11): pressed question messages deleted (gone); all bot sends + owner messages tracked in ctx.trail → DO 'trail'; dirMenu() purges trail before sending menu. Kept (noTrack/keep): saved «✅ Записано», done emoji, Leadex/rent/supplier/reserve results, залоги items, errors.
- Pressed button with premium icon → bot sends that emoji (from bot; sending as user impossible). Tracked (cleaned at menu).
- Категории: + Личное/Расход/Самокат (owner 26.11), no limit.
- PS SHOP income: category NOT asked (owner 26.11); default «Продажа» (Категории row added) or detected group. Filtering by category — later stage.
- Аренда screen (owner 26.11): «АРЕНДА ?» bold; [Предоплата (green)] [Залог (blue)]; Back. Preset type via pt:pre / pt:zal. «Залоги и брони» list button removed from this screen (asked owner where to put it).
- Предоплата аренды (owner 26.11): pt:pre → amount buttons 50/100/150/200 тыс (pa:N) → card → booking date buttons → summary. Typing still works.
- Booking date (owner 26.11): Сегодня/Завтра/Послезавтра/«Другая дата» all blue; «Другая дата» → month calendar (cl:YYYY-MM nav, cd:date pick); days with open bookings red with •, today blue, past days '·' (noop). kb() accepts 3rd elem = style. Calendar emoji 5413879192267805083 in date prompts.
- RENT ORDERS (owner 26.11, variant 1). Аренда screen: [Оплата green] [Предоплата blue][Залог red] [📋 Заказы] Back. Order A1, A2… in DO 'ords' {id, book, prepay[], zalog[], paid, closed}; order id written to Журнал!P and Залоги!J (header «Заказ»). First run migrated open items: Z1 → A1 (paid), R14 → A2.
  Предоплата (amount buttons) → new order. Поступление → pick open order or «Без предоплаты» → amount → card → save; first payment converts order's open prepayments to income (Доход/Аренда/Предоплата) and asks «Залог взяли?» (Нет/100/200/300 тыс/другая) unless order already has залог. Payment on already-paid order = Продление: «Новые деньги» (cat Продление, added to Категории) or «Из залога» (zp). Залог button → pick order or new. 📋 Заказы → per order: Вернул залог / Удержал часть / Бронь сгорела / Закрыть заказ. Order auto-closes when paid and no open items. Morning «Клиент приехал?» → «✅ Приехал — записать оплату» (ao:in|A#).
- Main menu row: [📈 Доходы][💳 Баланс][📉 Расходы] (owner 26.11). mr:in/out → month report from 1st: grouped by day (newest first, weekday), each record amount/dir/cat/card, day subtotal, month total + by direction. Excludes «Доля из …» accruals (double count). Split >3800 chars.
- 26.11: test rent order A2 (R14 prepay) deleted via /rm?k=&id= (admin: same as 🗑 + dropFromOrders). Deleting a record removes it from its order; empty unpaid order is deleted. Remaining order: A1 = real Z1 залог 150 000.
