"""Synchronize NBA 2026-27 schedule and completed-game box scores from public NBA CDN.
Fails safely: a failed request never erases existing archived data.
"""
import json, os, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent
DEST=ROOT/'data'/'season.json'
SEASON_START='2026-10-01'
SCHEDULE='https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json'
BOXSCORE='https://cdn.nba.com/static/json/liveData/boxscore/boxscore_{id}.json'
HEADERS={'User-Agent':'Mozilla/5.0 (compatible; NBAStatsHub/1.0)','Accept':'application/json'}
def fetch(url):
    req=urllib.request.Request(url,headers=HEADERS)
    with urllib.request.urlopen(req,timeout=25) as r:return json.load(r)
def load():
    try:return json.loads(DEST.read_text())
    except (FileNotFoundError,ValueError):return {'season':'2026-27','games':[],'players':[],'errors':[]}
def teamcode(t):return (t or {}).get('teamTricode') or (t or {}).get('teamCode')
def main():
    old=load(); indexed={str(g['id']):g for g in old.get('games',[]) if g.get('id')}; errors=[]
    try:
        schedule=fetch(SCHEDULE)
        dates=schedule.get('leagueSchedule',{}).get('gameDates',[])
        for day in dates:
            for g in day.get('games',[]):
                raw=str(g.get('gameDateEst') or g.get('gameDateTimeEst') or '')[:10]
                if not raw or raw<SEASON_START or raw>'2027-09-01':continue
                gid=str(g.get('gameId',''))
                if not gid:continue
                home=g.get('homeTeam') or {};away=g.get('awayTeam') or {}
                status='Final' if g.get('gameStatus')==3 else ('Live' if g.get('gameStatus')==2 else 'Scheduled')
                indexed[gid]={'id':gid,'date':raw,'home':teamcode(home),'away':teamcode(away),'homeScore':home.get('score') if status=='Final' else None,'awayScore':away.get('score') if status=='Final' else None,'status':status}
    except Exception as exc:
        errors.append('Calendario: '+str(exc)[:180])
    # Fetch box scores for completed games, preserving previously fetched records.
    old_boxes=old.get('boxscores',{})
    boxes=dict(old_boxes)
    pending=[g for g in indexed.values() if g['status']=='Final' and g['id'] not in boxes]
    # Limit per run to keep GitHub Actions predictable; subsequent runs catch up.
    for g in sorted(pending,key=lambda x:x['date'],reverse=True)[:35]:
        try:
            box=fetch(BOXSCORE.format(id=g['id'])).get('game',{})
            if not box:raise ValueError('Box score vuoto')
            entries=[]
            for side in ('homeTeam','awayTeam'):
                t=box.get(side) or {}
                for p in t.get('players',[]):
                    s=p.get('statistics') or {}
                    if not s or p.get('played')=='0':continue
                    entries.append({'id':str(p.get('personId') or p.get('playerId') or p.get('name')),'name':p.get('name') or (str(p.get('firstName',''))+' '+str(p.get('familyName',''))).strip(),'team':teamcode(t),'pts':int(s.get('points') or 0),'reb':int(s.get('reboundsTotal') or 0),'ast':int(s.get('assists') or 0),'stl':int(s.get('steals') or 0),'blk':int(s.get('blocks') or 0),'min':s.get('minutes') or ''})
            if entries:boxes[g['id']]=entries
            time.sleep(.25)
        except Exception as exc:errors.append(f"Box {g['id']}: {str(exc)[:100]}")
    players={}
    for gid,entries in boxes.items():
        if gid not in indexed:continue
        for p in entries:
            key=p['id']
            if key not in players:players[key]={'id':key,'name':p['name'],'team':p['team'],'gp':0,'pts':0,'reb':0,'ast':0,'stl':0,'blk':0}
            q=players[key];q['gp']+=1
            for k in ('pts','reb','ast','stl','blk'):q[k]+=p[k]
            q['team']=p['team']
    result={'season':'2026-27','updated':datetime.now(timezone.utc).isoformat() if indexed else old.get('updated'),'games':sorted(indexed.values(),key=lambda g:(g['date'],g['id'])),'players':list(players.values()),'boxscores':boxes,'errors':errors[:25]}
    if not indexed:raise RuntimeError('Nessuna partita acquisita: archivio originale preservato. '+str(errors[:2]))
    temp=DEST.with_suffix('.tmp');temp.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')));temp.replace(DEST)
    print(f"Sincronizzate {len(indexed)} partite, {len(boxes)} box score, {len(players)} giocatori; errori {len(errors)}")
if __name__=='__main__':main()
