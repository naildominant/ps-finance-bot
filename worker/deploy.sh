#!/bin/bash
# Выкладка воркера psfinance. Секреты (BOT_TOKEN, GAS_URL, GAS_KEY, WH_SECRET) и KV сохраняются (keep_bindings).
# Durable Object State создан миграцией v1 (25.11); повторно миграцию не передавать.
set -e
A=a51493433b045523c71350b2c0dd33d5; B=https://api.cloudflare.com/client/v4/accounts/$A
cd "$(dirname "$0")"
META='{"main_module":"worker.js","compatibility_date":"2024-09-23","keep_bindings":["secret_text","kv_namespace"],"bindings":[{"type":"ai","name":"AI"},{"type":"durable_object_namespace","name":"ST","class_name":"State"}]}'
curl -s -X PUT "$B/workers/scripts/psfinance" -H "Authorization: Bearer x" -F "metadata=$META;type=application/json" -F "worker.js=@worker.js;type=application/javascript+module" | python3 -c "import sys,json;d=json.load(sys.stdin);print('deploy',d['success'],d.get('errors'))"
curl -s "$B/workers/scripts/psfinance/settings" -H "Authorization: Bearer x" | python3 -c "import sys,json;print('bindings',sorted(b['name'] for b in json.load(sys.stdin)['result']['bindings']))"
