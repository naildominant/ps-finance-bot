# Finance bot — owner decisions & start balances (2026-11-25)
Decisions: USD rate = CBU auto (rate on op date); nested categories (Личное tree as proposed), taxi no limit; Google via Apps Script in sheet; code -> private repo ps-finance-bot (not created yet).
Balances:
- NBU 4408: 0
- VISA 0233: 40 540
- NBU 6440: 0.62
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
Everything writes normally. On «тест окончен»: clear Журнал rows 2+, reset DO counter `seq` to 0 and drafts, clear Залоги rows except Z1, restore Карты/Категории/Лимиты/Настройки/Долги from snapshot «PS Финансы — эталон до теста (не трогать)» id 195unlZd8U0OZcl3hj2LO7If4z9qlUjmgOpks2AcI71I (keep Настройки!B16 owner ID; ask owner whether balances changed since 25.11 and update Карты D before restart). Then trash nothing without asking.
- Cards per direction (owner 26.11): Карты!K «Приход для направлений», L «Расход для направлений» (comma list). PS SHOP inc: Приёмка, Ипак, Нал, Доллары; exp: Расходка, Поставщик, Нал, Доллары. Аренда: Капитал, Нал, Доллары (both). Leadex inc: Ипак, Нал, Доллары; exp: Ипак, Нал. Личное: Узум, Булка, Нал, Доллары (both). Transfers: all cards. Summary shows date dd.mm.yyyy + time; Back button on every step (history stack st.hist).
- Stage 3 (26.11): voice/audio/video_note → Whisper large-v3-turbo (ru) → «🎤 text» → same parser (src голос). Photo/image doc → Mistral Small 3.1 vision (better than llama-3.2-vision; gemma not allowed on account) → JSON {incoming, own_transfer, total, date, merchant, card_last4, items} → text → parser (src фото). NEVER spread bytes into arrays (CPU limit → 1101); pass base64 data URL. /testai?k=&t=photo|voice[&m=model] for checks.
- Multi-record messages: AI splits, direction per record by meaning; queue shown «(n из N)». Single record without chosen direction → asks direction by button.
