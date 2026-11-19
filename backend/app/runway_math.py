import math
from geographiclib.geodesic import Geodesic

def relative_position(observation, threshold):
    lon,lat=threshold['coordinate']
    g=Geodesic.WGS84.Inverse(lat,lon,observation.lat,observation.lon)
    angle=math.radians(g['azi1']-threshold['bearing'])
    return g['s12']*math.cos(angle), g['s12']*math.sin(angle)

def angle_difference(a,b): return abs((a-b+180)%360-180)
