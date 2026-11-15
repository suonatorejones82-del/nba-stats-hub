import json, os, urllib.request, urllib.parse
from pathlib import Path
from datetime import datetime, timezone
key=os.environ.get('PROPLINE_API_KEY')
if not key: raise SystemExit('Secret PROPLINE_API_KEY mancante')
markets='h2h,spreads,totals,team_totals,h2h_q1,totals_q1,h2h_h1,totals_h1,player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists,player_points_rebounds,player_points_assists,player_rebounds_assists,player_steals,player_blocks,player_double_double,player_triple_double'
base='https://api.prop-line.com/v1/sports/basketball_nba/'
def get(path):
    req=urllib.request.Request(base+path,headers={'X-API-Key':key,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=60) as r:return json.load(r)
# Core request plus optional markets individually if provider rejects the combined request.
from urllib.error import HTTPError
try: events=get('odds?'+urllib.parse.urlencode({'markets':markets,'oddsFormat':'decimal'}))
except HTTPError as e:
    if e.code not in (400,422): raise
    events=get('odds?'+urllib.parse.urlencode({'markets':'h2h,spreads,totals,player_points,player_rebounds,player_assists,player_threes','oddsFormat':'decimal'}))
if not isinstance(events,list): raise SystemExit('Formato quote inatteso')
ids=get('ids'); cross={str(x['id']):x.get('espn_event_id') for x in ids if isinstance(x,dict) and 'id' in x} if isinstance(ids,list) else {}
rows=[]
for e in events:
    if not isinstance(e,dict) or e.get('live'):continue
    books=[]
    for b in e.get('bookmakers',[]):
        ms=[]
        for m in b.get('markets',[]):
            outcomes=[]
            for o in m.get('outcomes',[]):
                price=o.get('price')
                if not isinstance(price,(int,float)) or not 1<price<1000:continue
                outcomes.append({k:o[k] for k in ('name','description','point','price') if k in o})
            if outcomes:ms.append({'key':m.get('key'),'outcomes':outcomes,'updated':m.get('last_update')})
        if ms:books.append({'key':b.get('key'),'title':b.get('title'),'markets':ms,'updated':b.get('last_update')})
    rows.append({'id':str(e.get('id')),'espn':e.get('espn_event_id') or cross.get(str(e.get('id'))),'home':e.get('home_team'),'away':e.get('away_team'),'start':e.get('commence_time'),'books':books})
p=Path('data/odds.json');p.parent.mkdir(exist_ok=True);tmp=p.with_suffix('.tmp');tmp.write_text(json.dumps({'updated':datetime.now(timezone.utc).isoformat(),'events':rows},ensure_ascii=False),encoding='utf-8');tmp.replace(p)
print(f'Eventi: {len(rows)}; bookmaker: {sorted({str(b["key"]) for e in rows for b in e["books"]})}')
