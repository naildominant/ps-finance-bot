import json,sys,urllib.request,os
K=os.environ.get('GAS_KEY') or open(os.path.expanduser('~/.psfinance_key')).read().strip()   # ключ не хранить в репозитории
ID=5562428297
def call(upd):
    r=urllib.request.Request(f"https://psfinance.psshop.workers.dev/test?k={K}",data=json.dumps(upd).encode(),headers={'content-type':'application/json','user-agent':'curl/8'})
    out=json.load(urllib.request.urlopen(r,timeout=60))
    for o in out:
        if 'gas' in o: print('  GAS', json.dumps(o['gas'],ensure_ascii=False)[:400]); continue
        if o['method']=='answerCallbackQuery': continue
        btn=[b['text']+'='+b.get('callback_data',b.get('url','')) for row in o.get('reply_markup',{}).get('inline_keyboard',[]) for b in row]
        print('  ',o['method'],'|',(o.get('text') or '').replace('\n',' / ')[:300], '|', ' '.join(btn)[:300])
def msg(t): print('>',t); call({'message':{'message_id':1,'from':{'id':ID},'chat':{'id':ID},'text':t}})
def cb(d): print('[',d,']'); call({'callback_query':{'id':'1','from':{'id':ID},'data':d,'message':{'message_id':5,'chat':{'id':ID}}}})
for a in sys.argv[1:]:
    (cb(a[1:]) if a.startswith('@') else msg(a))
