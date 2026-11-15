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
            v=val(p,c['metric']) if p and (p.get('minutes') or 0)>0 else None
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
# Fixed, interpretable thresholds; no search for an arbitrarily easy line.
LINES={'Punti':[9.5,14.5,19.5,24.5,29.5], 'Rimbalzi':[3.5,5.5,7.5,9.5,11.5], 'Assist':[2.5,4.5,6.5,8.5,10.5], 'Triple':[0.5,1.5,2.5,3.5]}
def candidates(db,now,inj):
    finals=sorted((g for g in db['games'] if g['status']=='Final' and g.get('startTime') and datetime.fromisoformat(g['startTime'].replace('Z','+00:00'))<now),key=lambda g:g['startTime']); boxes=db['boxscores']; result=[]
    from collections import defaultdict
    histories=defaultdict(list); totals={}
    for f in finals:
        rows=boxes.get(str(f['id']),[])
        for r in rows:
            if (r.get('minutes') or 0)>0: histories[str(r['id'])].append((f,r))
        for t in (f['home'],f['away']):
            rs=[r for r in rows if r['team']==t and (r.get('minutes') or 0)>0]
            for m in LINES:
                vs=[val(r,m) for r in rs]
                if len(vs)>=5 and None not in vs: totals[(str(f['id']),t,m)]=sum(vs)
    for g in db['games']:
        if g['status']!='Scheduled' or not g.get('startTime'): continue
        start=datetime.fromisoformat(g['startTime'].replace('Z','+00:00'))
        if not now<start<=now+timedelta(hours=24): continue
        for team,opp in [(g['home'],g['away']),(g['away'],g['home'])]:
            flagged={str(r.get('athlete',{}).get('id')) for r in inj.get(team,[])}; names={r.get('athlete',{}).get('displayName') for r in inj.get(team,[])}
            teamgames=[f for f in finals if team in (f['home'],f['away'])]
            for p in db['players']:
                if p['team']!=team or str(p['id']) in flagged or p['name'] in names: continue
                hist=histories[str(p['id'])]; hist=[(f,r) for f,r in hist if r['team']==team]
                if len(hist)<10 or len(teamgames)<10: continue
                if str(hist[-1][0]['id'])!=str(teamgames[-1]['id']): continue
                if len({str(f['id']) for f,r in hist[-10:]} & {str(f['id']) for f in teamgames[-10:]})<8: continue
                mins=[r['minutes'] for f,r in hist[-10:]]; minutes=s.mean(mins[-5:]); spread=s.stdev(mins)
                if minutes<22 or spread>7: continue
                for metric,lines in LINES.items():
                    vals=[val(r,metric) for f,r in hist];
                    if any(v is None for v in vals): continue
                    avg=s.mean(vals); a10=s.mean(vals[-10:]); a5=s.mean(vals[-5:]); sd=max(s.stdev(vals),1)
                    # Nearest fixed reference to recent median, plus adjacent references within a bounded distance.
                    center=s.median(vals[-10:]); nearest=min(lines,key=lambda l:abs(l-center)); allowed_lines=[l for l in lines if abs(l-center)<=max(abs(nearest-center),.75*sd) and abs(l-center)<=max(2,sd)]
                    allowed=[totals.get((str(f['id']),f['away'] if f['home']==opp else f['home'],metric)) for f in finals if opp in (f['home'],f['away'])]; allowed=[v for v in allowed if v is not None]
                    baseline=[v for (gid,t,m),v in totals.items() if m==metric]
                    if len(allowed)<5 or not baseline: continue
                    ratio=s.mean(allowed)/max(s.mean(baseline),1)
                    for line in allowed_lines:
                        for side,sign in [('Over',1),('Under',-1)]:
                            hits=[sign*(v-line)>0 for v in vals]; rate=s.mean(hits); h10=sum(hits[-10:]); h5=sum(hits[-5:]);
                            if rate<.65 or h10<7 or h5<4 or sign*(a5-line)<=0 or sign*(a10-line)<=0: continue
                            if sign*(ratio-1)<-.15: continue
                            score=round(.35*100*rate+.30*10*h10+.20*20*h5+.10*(100-5*spread)+.05*max(0,min(100,50+sign*100*(ratio-1))))
                            result.append(dict(game=str(g['id']),start=g['startTime'],player=str(p['id']),name=p['name'],team=team,opponent=opp,metric=metric,line=line,side=side,score=score,avg=round(avg,2),avg10=round(a10,2),avg5=round(a5,2),hits10=h10,hits5=h5,hits=sum(hits),n=len(vals),minutes=round(minutes,1),matchup=round(ratio,2),availability='non segnalato nel report' if team in inj else 'da verificare',result='in attesa'))
    result.sort(key=lambda c:(c['score'],c['hits10'],c['hits5']),reverse=True)
    unique=[]; seen=set()
    for c in result:
        if c['player'] not in seen: seen.add(c['player']); unique.append(c)
    for i,c in enumerate(unique): c['id']=str(i+1)
    return unique

def combinations(cs):
    selected=[]; games=set()
    for c in cs:
        if c['availability']=='da verificare' or c['game'] in games: continue
        selected.append(c['id']); games.add(c['game'])
        if len(selected)==3: break
    return [selected] if selected else []

def main():
    import sys
    db=json.loads(D.read_text()); out=read(); settle(db,out); save(out)
    if '--settle' in sys.argv: return
    now=datetime.now(timezone.utc); day=now.astimezone(TZ).date().isoformat()
    if any(r['day']==day and r.get('version')==2 for r in out['runs']) and '--force' not in sys.argv: return
    run={'version':2,'day':day,'updated':now.isoformat(),'candidates':[],'combinations':[],'review':'','status':'Dati insufficienti'}
    try:
        stamp=datetime.fromisoformat(db['updated'].replace('Z','+00:00'))
        if now-stamp>timedelta(hours=36) or db.get('errors'): raise ValueError('Archivio obsoleto o incompleto')
        try: inj=injuries()
        except Exception: inj={}
        cs=candidates(db,now,inj); combos=combinations(cs)
        run.update(candidates=cs,combinations=combos,status='Analisi completata' if cs else 'Nessuna tendenza supera i filtri',review='Report assenze disponibile per '+str(len(inj))+' squadre; disponibilità non garantita.')
    except Exception as e: run.update(status='Analisi non completata',review=type(e).__name__)
    out['runs'].append(run); save(out)
if __name__=='__main__': main()
