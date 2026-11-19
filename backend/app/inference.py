from dataclasses import dataclass
from .contracts import PhaseEstimate
from .runway_math import relative_position, angle_difference

@dataclass(frozen=True)
class InferenceConfig:
    approach_distance_m: float = 8*1852
    cross_track_m: float = 300
    course_degrees: float = 15
    trend_seconds: float = 10
    gap_seconds: float = 20


def infer_phase(history, runways, now, previous=None, config=None):
    cfg=config or InferenceConfig(); previous=previous or PhaseEstimate()
    unknown=PhaseEstimate()
    if len(history)<4: return unknown
    times=[o.position_time for o in history]
    if any(t is None for t in times) or not 0<=now-times[-1]<=20: return PhaseEstimate(reasons=['Missing, future or stale position time'])
    if len({o.id for o in history})!=1 or len({o.session_id for o in history})!=1: return unknown
    if any(not 0<b-a<=cfg.gap_seconds for a,b in zip(times,times[1:])): return unknown

    context=previous._event_context
    identity,session=history[-1].id,history[-1].session_id
    if context and (context[1:3]!=(identity,session) or not 0<=now-context[3]<=60):
        context=None
    context_phase=context[0] if context else previous.phase
    # External/legacy previous estimates must also have recent evidence.
    if not context and previous.evidence_times and not 0<=now-max(previous.evidence_times)<=60:
        context_phase='unknown'

    def evaluate(h):
        o=h[-1]; recent=h[-3:]
        if len(h)<3 or h[-1].position_time-h[-3].position_time<cfg.trend_seconds: return 'unknown',[],['Trend needs three observations over ten seconds']
        runway=[]; approach=[]
        for f in runways:
            p=f['properties']
            for threshold in p['thresholds']:
                along,cross=relative_position(o,threshold)
                compatible=o.track_deg is not None and angle_difference(o.track_deg,threshold['bearing'])<=cfg.course_degrees
                if compatible and abs(cross)<=cfg.cross_track_m:
                    if -cfg.approach_distance_m<=along<0: approach.append(threshold['id'])
                    if -100<=along<=p['length_m'] and (o.speed_mps or 0)>2: runway.append(threshold['id'])
        rates=[x.vertical_rate_mps for x in recent]
        descent=all(v is not None and v<-.5 for v in rates)
        climb=all(v is not None and v>.5 for v in rates)
        speeds=[x.speed_mps for x in recent]
        decel=all(v is not None for v in speeds) and speeds[-1]<speeds[0]-2
        accel=all(v is not None for v in speeds) and all(b>a+1 for a,b in zip(speeds,speeds[1:]))
        approach_before=context_phase in ('final_approach_candidate','approach_candidate','landing_candidate','go_around_candidate')
        if o.ground is True:
            if runway and approach_before and any(x.ground is False for x in h[-8:]) and all(x.ground is True for x in h[-2:]) and decel:
                return 'landing_candidate',runway,['Continuous airborne-to-ground reports and deceleration near runway; event interval only']
            if all(x.ground is True for x in recent):
                if runway and accel: return 'takeoff_roll_candidate',runway,['Repeated acceleration on a runway corridor; takeoff not confirmed']
                if runway and context_phase in ('landing_candidate','rollout_candidate'):
                    return 'rollout_candidate',runway,['Repeated ground positions near the runway after a landing candidate']
                if runway:return 'runway_aligned_candidate',runway,['Fresh moving ground observations aligned with runway']
                if all((x.speed_mps or 0)>.5 for x in recent):return 'taxi_candidate',[],['Repeated moving ground reports outside runway-roll evidence']
            return 'ground',[],['Ground reported; movement classification uncertain']
        if o.ground is False:
            if climb:
                if approach_before and not any(x.ground is True for x in h[-8:]):return 'go_around_candidate',approach,['Prior approach followed by sustained climb without landing evidence']
                if any(x.ground is True for x in h[-8:]):return 'airborne_climb_candidate',runway,['Ground-to-air reports followed by sustained climb']
                return 'climbing_departure_candidate',[],['Sustained climb; ground departure not observed']
            if approach and descent:return 'final_approach_candidate',approach,['Aligned upstream of threshold with repeated descent reports']
            return 'airborne',[],['Airborne reported; no supported runway event']
        return 'unknown',[],['Ground/air state unknown; altitude alone is insufficient']
    phase,candidates,reasons=evaluate(history)
    prior,_,_=evaluate(history[:-1])
    if phase!=prior:
        result=PhaseEstimate(reasons=['Awaiting a second qualifying evaluation'])
        result._event_context=context
        return result
    if candidates: reasons.append('Runway geometry is provisional; assignment is a heuristic')
    result=PhaseEstimate(phase=phase,candidate_runways=candidates,confidence='medium' if phase!='unknown' and len(candidates)<=1 else 'low',reasons=reasons,evidence_times=times[-5:])
    if phase in ('final_approach_candidate','approach_candidate','landing_candidate'):
        context=(phase,identity,session,times[-1])
    result._event_context=context
    return result
