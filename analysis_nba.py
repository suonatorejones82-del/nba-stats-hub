"""Daily statistical analysis; one optional OpenAI review, no odds."""
import json, os, statistics as s, urllib.request, math
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path
P=Path('data/predictions.json'); D=Path('data/season.json'); TZ=ZoneInfo('Europe/Rome')
MET={'Punti':('pts',),'Rimbalzi':('reb',),'Assist':('ast',),'Triple':('tpm',),'PRA':('pts','reb','ast'),'PA':('pts','ast'),'PR':('pts','reb'),'RA':('reb','ast'),'Doppia doppia':('pts','reb','ast','stl','blk')}
def val(p,m):
    keys=MET[m]
    if any(p.get(k) is None for k in keys): return None
    return int(sum(p[k]>=10 for k in keys)>=2) if m=='Doppia doppia' else sum(p[k] for k in keys)
def read():
    return json.loads(P.read_text()) if P.exists() else {'runs':[]}
def save(x):
    tmp=P.with_suffix('.tmp'); tmp.write_text(json.dumps(x,ensure_ascii=False,indent=2)); tmp.replace(P)
def settle(db,out):
    games={str(g['id']):g for g in db['games']}
    for run in out['runs']:
        for c in run['candidates']:
            g=games.get(c['game']); rows=db['boxscores'].get(c['game'],[])
            if not g or g['status']!='Final' or not rows: continue
            p=next((p for p in rows if str(p['id'])==c['player']),None)
            v=val(p,c['metric']) if p and p.get('minutes',0)>0 else None
            c['actual']=v; c['result']='non valutabile' if v is None else ('corretto' if (v>c['line'])==(c['side']=='Over') else 'errato')
def request(url,body=None,key=None):
    headers={'User-Agent':'NBA Stats Hub','Accept':'application/json'}
    if key: headers.update({'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    with urllib.request.urlopen(urllib.request.Request(url,data=json.dumps(body).encode() if body else None,headers=headers),timeout=90) as r: return json.load(r)
def injuries():
    data=request('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries'); result={}
    aliases={'GS':'GSW','SA':'SAS','NY':'NYK','WSH':'WAS','UTAH':'UTA','NO':'NOP'}
    for group in data.get('injuries',[]):
        code=group.get('team',{}).get('abbreviation') or group.get('abbreviation'); code=aliases.get(code,code)
        if code and isinstance(group.get('injuries'),list): result[code]=group['injuries']
    return result
def candidates(db,now,inj):
    finals=sorted((g for g in db['games'] if g['status']=='Final' and g.get('startTime') and datetime.fromisoformat(g['startTime'].replace('Z','+00:00'))<now),key=lambda g:g['startTime']); boxes=db['boxscores']; result=[]
    for g in db['games']:
        if g['status']!='Scheduled' or not g.get('startTime'): continue
        start=datetime.fromisoformat(g['startTime'].replace('Z','+00:00'))
        if not now<start<=now+timedelta(hours=24): continue
        for team,opp in [(g['home'],g['away']),(g['away'],g['home'])]:
            if team not in inj or opp not in inj: continue
            flagged={str(r.get('athlete',{}).get('id')) for r in inj[team]}; names={r.get('athlete',{}).get('displayName') for r in inj[team]}
            for p in db['players']:
                if p['team']!=team or str(p['id']) in flagged or p['name'] in names: continue
                hist=[r for f in finals for r in boxes.get(str(f['id']),[]) if str(r['id'])==str(p['id']) and r.get('minutes',0)>0]
                if len(hist)<10 or any(r['team']!=team for r in hist[-5:]): continue
                mins=[r['minutes'] for r in hist[-10:]]; minutes=s.mean(mins[-5:]);
                if minutes<20 or s.stdev(mins)>7: continue
                for metric in MET:
                    vals=[val(r,metric) for r in hist];
                    if any(v is None for v in vals): continue
                    avg=s.mean(vals); a10=s.mean(vals[-10:]); a5=s.mean(vals[-5:]); sd=max(s.stdev(vals),1)
                    # Fixed central reference, never lowered to fill a combination.
                    line=0.5 if metric=='Doppia doppia' else math.floor(avg)+0.5
                    for side in ['Over','Under']:
                        sign=1 if side=='Over' else -1; hits=[(v>line) if sign==1 else (v<line) for v in vals]; rate=s.mean(hits); h10=sum(hits[-10:]); h5=sum(hits[-5:]);
                        if rate<.65 or h10<7 or h5<3: continue
                        # Opponent allowance: team totals proxy, not positional defense.
                        def totals(f,t):
                            rows=[r for r in boxes.get(str(f['id']),[]) if r['team']==t and r.get('minutes',0)>0]; vs=[val(r,metric) for r in rows]; return sum(vs) if vs and None not in vs else None
                        allowed=[totals(f,f['away'] if f['home']==opp else f['home']) for f in finals if opp in (f['home'],f['away'])]; allowed=[v for v in allowed if v is not None]
                        baseline=[totals(f,t) for f in finals for t in (f['home'],f['away'])]; baseline=[v for v in baseline if v is not None]
                        if len(allowed)<5 or not baseline: continue
                        clamp=lambda x:max(0,min(100,x)); margin=lambda x:clamp(50+25*sign*(x-line)/sd)
                        matchup=clamp(50+sign*100*(s.mean(allowed)/max(s.mean(baseline),1)-1)); role=clamp(80-3*s.stdev(mins)); minute=clamp(50+sign*4*(minutes-s.mean([r['minutes'] for r in hist])))
                        score=round(.15*margin(avg)+.20*margin(a10)+.15*margin(a5)+.20*(100*rate)+.10*minute+.10*matchup+.10*role)
                        if score<65: continue
                        result.append(dict(game=str(g['id']),start=g['startTime'],player=str(p['id']),name=p['name'],team=team,opponent=opp,metric=metric,line=line,side=side,score=score,avg=round(avg,2),avg10=round(a10,2),avg5=round(a5,2),hits10=h10,hits5=h5,hits=sum(hits),n=len(vals),minutes=round(minutes,1),matchup=round(matchup),result='in attesa'))
    result.sort(key=lambda c:c['score'],reverse=True)
    # One candidate per player, capped for API cost.
    unique=[]; seen=set()
    for c in result:
        if c['player'] not in seen: seen.add(c['player']); unique.append(c)
    for i,c in enumerate(unique[:40]): c['id']=str(i+1)
    return unique[:40]
def combinations(cs):
    out=[]
    for offset in range(min(4,len(cs))):
        selected=[]; games=set()
        for c in cs[offset:]+cs[:offset]:
            if c['game'] in games: continue
            selected.append(c['id']); games.add(c['game'])
            if len(selected)==4: break
        if len(selected)>=3 and set(selected) not in [set(x) for x in out]: out.append(selected)
    return out

def main():
    import sys
    db=json.loads(D.read_text()); out=read(); settle(db,out); save(out)
    if '--settle' in sys.argv: return
    now=datetime.now(timezone.utc); day=now.astimezone(TZ).date().isoformat()
    if any(r['day']==day for r in out['runs']): return
    run={'day':day,'updated':now.isoformat(),'candidates':[],'combinations':[],'review':'','status':'Dati insufficienti'}
    try:
        stamp=datetime.fromisoformat(db['updated'].replace('Z','+00:00'))
        if now-stamp>timedelta(hours=36) or db.get('errors'): raise ValueError('Archivio obsoleto o incompleto')
        inj=injuries(); cs=candidates(db,now,inj); combos=combinations(cs); run.update(candidates=cs)
        key=os.getenv('OPENAI_API_KEY'); model=(os.getenv('OPENAI_MODEL') or 'gpt-4.1-mini')
        if combos and key:
            prompt='Sei un revisore statistico NBA. Usa solo i dati forniti, nessuna quota. Le soglie sono riferimenti statistici, non linee di mercato. Valuta limiti del campione, minuti, assenze ESPN e matchup proxy. Non inventare dati. Scegli al massimo due combinazioni tra quelle numerate, oppure nessuna. Rispondi JSON con selected (array di indici da 0) e review (testo italiano breve). Non modificare soglie o punteggi.\n'+json.dumps({'candidates':cs,'combinations':combos},ensure_ascii=False)
            resp=request('https://api.openai.com/v1/chat/completions',{'model':model,'messages':[{'role':'user','content':prompt}],'response_format':{'type':'json_object'},'max_completion_tokens':600},key)
            review=json.loads(resp['choices'][0]['message']['content']); ids=review.get('selected',[])
            if not isinstance(ids,list) or any(type(i)!=int or not 0<=i<len(combos) for i in ids): raise ValueError('Risposta AI non valida')
            run.update(combinations=[combos[i] for i in dict.fromkeys(ids)][:2],review=str(review.get('review',''))[:1800],status='Revisione AI completata')
        elif combos: run.update(status='Chiave API non configurata: revisione non eseguita')
    except Exception as e: run.update(status='Analisi non completata',review=type(e).__name__)
    out['runs'].append(run); save(out)
if __name__=='__main__': main()
