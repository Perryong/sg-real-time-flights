"""Conservative Changi movement estimates; no raw positions are persisted."""
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo
from .contracts import MovementSummary
from .runway_math import relative_position, angle_difference

SGT = ZoneInfo('Asia/Singapore')


def day_bounds(now):
    date = datetime.fromtimestamp(now, SGT).replace(hour=0, minute=0, second=0, microsecond=0)
    return date.date().isoformat(), date.timestamp(), (date + timedelta(days=1)).timestamp()


def detected_event(track, runways, now):
    h = track.history
    if len(h) < 4:
        return None
    # Only a new, repeated transition counts; later rollout/climb samples are not events.
    h = h[-4:]
    times = [o.position_time for o in h]
    if any(t is None for t in times) or not 0 <= now-times[-1] <= 20:
        return None
    if any(not 0 < b-a <= 20 for a,b in zip(times,times[1:])):
        return None
    if len({(o.id,o.session_id,o.provider,o.mode) for o in h}) != 1 or h[0].mode != 'live':
        return None
    states = [o.ground for o in h]
    if states == [False,False,True,True]:
        kind = 'landing'; ground = h[2]
        if any(o.speed_mps is None for o in h) or h[-1].speed_mps >= h[1].speed_mps-2:
            return None
    elif states == [True,True,False,False]:
        kind = 'takeoff'; ground = h[1]
        if any(o.vertical_rate_mps is None or o.vertical_rate_mps <= .5 for o in h[-2:]):
            return None
    else:
        return None
    if ground.speed_mps is None or ground.speed_mps < 30 or ground.track_deg is None:
        return None
    for f in runways:
        for threshold in f['properties']['thresholds']:
            along,cross = relative_position(ground,threshold)
            if (-100 <= along <= f['properties']['length_m']+100 and abs(cross) <= 150
                    and angle_difference(ground.track_deg,threshold['bearing']) <= 30):
                return kind, times[2]
    return None


class MovementLedger:
    def __init__(self, path, runways):
        self.runways = runways
        self.db = None
        self.failed = False
        self.last_success_seen = None
        self.previous_success = None  # Never bridge a process restart as observed coverage.
        try:
            if str(path) != ':memory:':
                Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            self.db = sqlite3.connect(str(path), timeout=1)
            if str(path) != ':memory:':
                Path(path).chmod(0o600)
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS events (
                    aircraft TEXT, kind TEXT, time REAL, day TEXT,
                    PRIMARY KEY (aircraft, kind, time));
                CREATE TABLE IF NOT EXISTS coverage (
                    day TEXT PRIMARY KEY, first REAL, last REAL, seconds REAL);
            ''')
        except (OSError, sqlite3.Error):
            self.failed = True

    def record(self, tracks, success_time, now):
        if self.failed:
            return
        if success_time is None:
            self.previous_success = None
        try:
            with self.db:
                for track in tracks:
                    event = detected_event(track,self.runways,now)
                    if event:
                        kind,when = event
                        # Suppress repeated provider evidence and brief air/ground bouncing.
                        duplicate = self.db.execute('SELECT 1 FROM events WHERE aircraft=? AND kind=? AND ABS(time-?)<120',
                            (track.id,kind,when)).fetchone()
                        if not duplicate:
                            self.db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,?)',
                                (track.id,kind,when,day_bounds(when)[0]))
                if success_time is not None and 0 <= now-success_time <= 60 and (
                        self.last_success_seen is None or success_time > self.last_success_seen):
                    start = success_time
                    if self.previous_success is not None and success_time-self.previous_success <= 20:
                        start = self.previous_success
                    day,_,end = day_bounds(start)
                    while start <= success_time:
                        stop = min(end,success_time)
                        self.db.execute('''INSERT INTO coverage VALUES (?,?,?,?) ON CONFLICT(day) DO UPDATE SET
                            first=MIN(first,excluded.first), last=MAX(last,excluded.last), seconds=seconds+excluded.seconds''',
                            (day,start,stop,stop-start))
                        if stop == success_time:
                            break
                        start = end; day,_,end = day_bounds(start)
                    self.previous_success = success_time
                    self.last_success_seen = success_time
                cutoff = day_bounds(now-6*86400)[0]
                self.db.execute('DELETE FROM events WHERE day<?',(cutoff,))
                self.db.execute('DELETE FROM coverage WHERE day<?',(cutoff,))
        except sqlite3.Error:
            self.failed = True

    def summary(self, now):
        day,start,_ = day_bounds(now)
        result = MovementSummary(day=day,available=not self.failed,unmonitored_seconds=max(0,now-start))
        if self.failed:
            return result
        try:
            for kind,count in self.db.execute('SELECT kind,COUNT(*) FROM events WHERE day=? GROUP BY kind',(day,)):
                if kind == 'landing':result.landings = count
                if kind == 'takeoff':result.takeoffs = count
            coverage = self.db.execute('SELECT first,last,seconds FROM coverage WHERE day=?',(day,)).fetchone()
            if coverage:
                result.first_observed_at,result.last_observed_at,result.observed_seconds = coverage
                result.unmonitored_seconds = max(0,now-start-result.observed_seconds)
        except sqlite3.Error:
            self.failed = True
            result.available = False
        return result

    def close(self):
        if self.db is not None:
            self.db.close()
