"""Aggiorna NBA Stats Hub 2026-27 da ESPN (API pubbliche non ufficiali).

Uso: python sync.py
Per ricostruire tutti i box score: python sync.py --rebuild
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEST = ROOT / 'data' / 'season.json'
BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba'
START = date(2026, 10, 20)
END = date(2027, 6, 30)
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'}
METRICS = ('pts', 'reb', 'ast', 'stl', 'blk')


def fetch(url):
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=35) as response:
                return json.load(response)
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1.5 * (attempt + 1))


def load():
    try:
        data = json.loads(DEST.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, ValueError):
        return {}


def integer(value):
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return 0


def normalize_team(team):
    return {'GS': 'GSW', 'SA': 'SAS', 'NY': 'NYK'}.get(team, team)

def parse_game(event):
    comp = (event.get('competitions') or [{}])[0]
    sides = {c.get('homeAway'): c for c in comp.get('competitors') or []}
    if not sides.get('home') or not sides.get('away'):
        return None
    status = (event.get('status') or {}).get('type') or {}
    name = str(status.get('name') or '').lower()
    state = str(status.get('state') or '').lower()
    game_status = ('Final' if status.get('completed') or name in ('status_final', 'final')
                   else 'Live' if state == 'in' else 'Scheduled')
    home, away = sides['home'], sides['away']
    result = {
        'id': str(event.get('id') or ''),
        'date': str(event.get('date') or '')[:10],
        'home': normalize_team((home.get('team') or {}).get('abbreviation')),
        'away': normalize_team((away.get('team') or {}).get('abbreviation')),
        'homeScore': integer(home.get('score')) if game_status == 'Final' else None,
        'awayScore': integer(away.get('score')) if game_status == 'Final' else None,
        'status': game_status,
    }
    return result if all(result[k] for k in ('id', 'date', 'home', 'away')) else None


def box_entries(game):
    data = fetch(BASE + '/summary?' + urllib.parse.urlencode({'event': game['id']}))
    result, seen = [], set()
    for group in (data.get('boxscore') or {}).get('players') or []:
        team = normalize_team((group.get('team') or {}).get('abbreviation') or '')
        if team not in (game['home'], game['away']):
            continue
        for stat_group in group.get('statistics') or []:
            labels = [str(x).upper() for x in stat_group.get('labels') or []]
            for athlete in stat_group.get('athletes') or []:
                if athlete.get('didNotPlay') or athlete.get('inactive'):
                    continue
                stats = dict(zip(labels, athlete.get('stats') or []))
                person = athlete.get('athlete') or {}
                pid = str(person.get('id') or '')
                if not pid or pid in seen or 'PTS' not in stats:
                    continue
                seen.add(pid)
                result.append({
                    'id': pid,
                    'name': person.get('displayName') or person.get('fullName') or pid,
                    'team': team,
                    'pts': integer(stats.get('PTS')),
                    'reb': integer(stats.get('REB')),
                    'ast': integer(stats.get('AST')),
                    'stl': integer(stats.get('STL')),
                    'blk': integer(stats.get('BLK')),
                    'min': stats.get('MIN') or '',
                })
    if len(result) < 10:
        raise ValueError(f'Box score incompleto: {len(result)} giocatori')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--rebuild', action='store_true', help='Riscarica tutti i box score')
    args = parser.parse_args()
    old = load()
    indexed = {str(g['id']): {**g, 'home': normalize_team(g.get('home')), 'away': normalize_team(g.get('away'))} for g in old.get('games', [])
               if isinstance(g, dict) and g.get('id')
               and START.isoformat() <= str(g.get('date', '')) <= END.isoformat()}
    raw_boxes = old.get('boxscores') or {}
    if not isinstance(raw_boxes, dict):
        raw_boxes = {}
    boxes = {} if args.rebuild else {str(k): [{**p, 'team': normalize_team(p.get('team'))} for p in v if isinstance(p, dict)] for k, v in raw_boxes.items()
                                     if k in indexed and isinstance(v, list)}
    errors = []
    today = datetime.now(timezone.utc).date()
    until = min(END, today + timedelta(days=7))
    first = START if args.rebuild or not indexed else max(START, today - timedelta(days=10))
    successes = 0
    current = first
    while current <= until:
        dates = current.strftime('%Y%m%d')
        url = BASE + '/scoreboard?' + urllib.parse.urlencode({'dates': dates, 'limit': 100})
        try:
            events = fetch(url).get('events') or []
            for event in events:
                game = parse_game(event)
                if game and START.isoformat() <= game['date'] <= END.isoformat():
                    indexed[game['id']] = game
            successes += 1
        except Exception as exc:
            errors.append(f'Calendario {dates}: {str(exc)[:140]}')
        current += timedelta(days=1)
        time.sleep(0.15)
    if not indexed or not successes:
        raise RuntimeError('Calendario ESPN non disponibile: file precedente conservato. ' + str(errors[:2]))

    final_ids = {gid for gid, g in indexed.items() if g['status'] == 'Final'}
    boxes = {gid: entries for gid, entries in boxes.items() if gid in final_ids}
    pending = [g for gid, g in indexed.items() if gid in final_ids and gid not in boxes]
    pending.sort(key=lambda g: (g['date'], g['id']))
    for game in pending:
        try:
            boxes[game['id']] = box_entries(game)
        except Exception as exc:
            errors.append(f"Box {game['id']}: {str(exc)[:110]}")
        time.sleep(0.15)

    players = {}
    for gid in sorted(boxes, key=lambda k: (indexed[k]['date'], k)):
        for p in boxes[gid]:
            pid = str(p.get('id') or '')
            if not pid:
                continue
            if pid not in players:
                players[pid] = {'id': pid, 'name': p.get('name') or pid,
                                'team': p.get('team') or '', 'gp': 0,
                                **{m: 0 for m in METRICS}}
            total = players[pid]
            total['gp'] += 1
            for metric in METRICS:
                total[metric] += integer(p.get(metric))
            total['team'] = p.get('team') or total['team']
            total['name'] = p.get('name') or total['name']

    if args.rebuild and errors:
        raise RuntimeError(f'Ricostruzione incompleta ({len(errors)} errori): archivio precedente conservato. Esempi: {errors[:3]}')

    result = {'season': '2026-27', 'updated': datetime.now(timezone.utc).isoformat(),
              'games': sorted(indexed.values(), key=lambda g: (g['date'], g['id'])),
              'players': list(players.values()), 'boxscores': boxes, 'errors': errors[:25]}
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temp = DEST.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    os.replace(temp, DEST)
    print(f"ESPN: {len(indexed)} partite, {len(boxes)} box score, "
          f"{len(players)} giocatori; errori {len(errors)}")
    if errors:
        print('Primi errori:', *errors[:3], sep='\n- ')


if __name__ == '__main__':
    main()
