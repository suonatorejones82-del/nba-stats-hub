"""Aggiorna NBA Stats Hub 2026-27 con i dati ESPN (endpoint pubblici non ufficiali).
Mantiene l'archivio precedente se il calendario non e' disponibile.
"""
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


def fetch(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=35) as response:
        return json.load(response)


def load():
    try:
        return json.loads(DEST.read_text(encoding='utf-8'))
    except (FileNotFoundError, ValueError):
        return {'season': '2026-27', 'games': [], 'players': [], 'boxscores': []}


def integer(value):
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return 0


def parse_date(value):
    return str(value or '')[:10]


def month_ranges(start, end):
    current = start
    while current <= end:
        next_month = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
        last = min(end, next_month - timedelta(days=1))
        yield current, last
        current = last + timedelta(days=1)


def parse_game(event):
    comp = (event.get('competitions') or [{}])[0]
    sides = {}
    for item in comp.get('competitors') or []:
        side = item.get('homeAway')
        if side in ('home', 'away'):
            sides[side] = item
    if 'home' not in sides or 'away' not in sides:
        return None
    status = (event.get('status') or {}).get('type') or {}
    name = str(status.get('name') or '').lower()
    state = str(status.get('state') or '').lower()
    if status.get('completed') or name in ('status_final', 'final'):
        game_status = 'Final'
    elif state == 'in':
        game_status = 'Live'
    else:
        game_status = 'Scheduled'
    home, away = sides['home'], sides['away']
    result = {
        'id': str(event.get('id') or ''),
        'date': parse_date(event.get('date')),
        'home': (home.get('team') or {}).get('abbreviation'),
        'away': (away.get('team') or {}).get('abbreviation'),
        'homeScore': integer(home.get('score')) if game_status == 'Final' else None,
        'awayScore': integer(away.get('score')) if game_status == 'Final' else None,
        'status': game_status,
    }
    return result if all(result[k] for k in ('id', 'date', 'home', 'away')) else None


def box_entries(event_id):
    url = BASE + '/summary?' + urllib.parse.urlencode({'event': event_id})
    data = fetch(url)
    result = []
    for group in ((data.get('boxscore') or {}).get('players') or []):
        team = (group.get('team') or {}).get('abbreviation') or ''
        for stat_group in group.get('statistics') or []:
            labels = [str(x).upper() for x in (stat_group.get('labels') or [])]
            for athlete in stat_group.get('athletes') or []:
                if athlete.get('didNotPlay') or athlete.get('inactive'):
                    continue
                values = athlete.get('stats') or []
                stats = dict(zip(labels, values))
                if not stats:
                    continue
                person = athlete.get('athlete') or {}
                pid = str(person.get('id') or '')
                if not pid:
                    continue
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
    return result


def main():
 
    old = load()
    indexed = {str(g['id']): g for g in old.get('games', []) if g.get('id') and START.isoformat() <= g.get('date', '') <= END.isoformat()
    boxes = {gid: entries for gid, entries in (old.get('boxscores') or {}).items() if gid in indexed}
    successes = 0
    # Non chiedere dati futuri troppo lontani: calendario fino a oggi + 7 giorni.
    today = datetime.now(timezone.utc).date()
    until = min(END, today + timedelta(days=7))
    # ESPN accetta date singole YYYYMMDD; gli intervalli mensili danno HTTP 400.
    # Dopo il primo import ricontrolla gli ultimi 10 giorni e i prossimi 7.
    first_day = max(START, today - timedelta(days=10)) if indexed else START
    current = first_day
    while current <= until:
        dates = current.strftime('%Y%m%d')
        url = BASE + '/scoreboard?' + urllib.parse.urlencode({'dates': dates, 'limit': 100})
        try:
            data = fetch(url)
            events = data.get('events') or []
            for event in events:
                game = parse_game(event)
                if game and START.isoformat() <= game['date'] <= END.isoformat():
                    indexed[game['id']] = game
            successes += 1
        except Exception as exc:
            errors.append(f'Calendario {dates}: {str(exc)[:140]}')
        current += timedelta(days=1)
        time.sleep(0.2)

    if successes == 0 or not indexed:
        raise RuntimeError('Calendario ESPN non disponibile: archivio originale conservato. ' + str(errors[:2]))

    pending = [g for g in indexed.values() if g['status'] == 'Final' and g['id'] not in boxes]
    for game in sorted(pending, key=lambda g: g['date'], reverse=True)[:35]:
        try:
            entries = box_entries(game['id'])
            if not entries:
                raise ValueError('Nessuna statistica individuale nel box score')
            boxes[game['id']] = entries
        except Exception as exc:
            errors.append(f"Box {game['id']}: {str(exc)[:110]}")
        time.sleep(0.2)

    players = {}
    for gid, entries in boxes.items():
        if gid not in indexed:
            continue
        for p in entries:
            key = p['id']
            if key not in players:
                players[key] = {'id': key, 'name': p['name'], 'team': p['team'],
                                'gp': 0, 'pts': 0, 'reb': 0, 'ast': 0, 'stl': 0, 'blk': 0}
            total = players[key]
            total['gp'] += 1
            for metric in ('pts', 'reb', 'ast', 'stl', 'blk'):
                total[metric] += integer(p.get(metric))
            total['team'] = p['team']

    result = {
        'season': '2026-27',
        'updated': datetime.now(timezone.utc).isoformat(),
        'games': sorted(indexed.values(), key=lambda g: (g['date'], g['id'])),
        'players': list(players.values()),
        'boxscores': boxes,
        'errors': errors[:25],
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temp = DEST.with_suffix('.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    os.replace(temp, DEST)
    print(f"ESPN: {len(indexed)} partite, {len(boxes)} box score, {len(players)} giocatori; errori {len(errors)}")


if __name__ == '__main__':
    main()
