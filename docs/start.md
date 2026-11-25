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
