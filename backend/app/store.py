from collections import OrderedDict
from geographiclib.geodesic import Geodesic
from .contracts import Track, PhaseEstimate

class TrackStore:
    def __init__(self, capacity=1000, history_seconds=300):
        self.tracks=OrderedDict()
        self.capacity, self.history_seconds = capacity, history_seconds
        self.evictions=0

    def ingest(self, observations, now):
        accepted=0
        for o in observations:
            old=self.tracks.get(o.id)
            if old:
                before, after=old.latest.position_time, o.position_time
                if before is not None and (after is None or after<=before): continue
                if before is None and after is None: continue
                gap=after-before if before is not None and after is not None else None
                distance=Geodesic.WGS84.Inverse(old.latest.lat,old.latest.lon,o.lat,o.lon)['s12']
                discontinuity=gap is None or gap>20 or distance > max(1000,(gap or 0)*400)
                if discontinuity:
                    o=o.model_copy(update={'session_id':str(after or o.receipt_time)})
                    history=[]
                else:
                    o=o.model_copy(update={'session_id':old.session_id})
                    history=old.history
            else: history=[]
            history=[p for p in history if p.position_time is not None and now-p.position_time<=self.history_seconds]
            history=(history+[o])[-301:]
            phase=old.phase if old and old.session_id==o.session_id else PhaseEstimate()
            self.tracks[o.id]=Track(id=o.id,session_id=o.session_id,latest=o,history=history,phase=phase)
            self.tracks.move_to_end(o.id)
            accepted+=1
        while len(self.tracks)>self.capacity:
            self.tracks.popitem(last=False); self.evictions+=1
        self.snapshot(now)
        return {'accepted':accepted,'evictions':self.evictions}

    def snapshot(self, now):
        for key,track in list(self.tracks.items()):
            anchor=track.latest.position_time if track.latest.position_time is not None else track.latest.receipt_time
            if now-anchor>120: del self.tracks[key]
        return list(self.tracks.values())

