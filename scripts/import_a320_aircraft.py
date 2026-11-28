"""Rebuild the Airbus5717 A320-200 GLB for aircraft follow mode."""

import hashlib
import json
import struct
from pathlib import Path
from urllib.request import urlopen

SOURCE_URL = (
    'https://huggingface.co/datasets/allenai/objaverse/resolve/'
    '556637099bf4fa79ea7b239d0d9c328b8a2e9ac8/glbs/000-113/'
    '7b8910d3cf824e6399c4ca75a31130ed.glb'
)
SOURCE_SHA256 = '4d5f3ed9145f2c942e3ff38b9060c40656f06b1c414b5f9ab96c524ffe633c46'
OUTPUT = Path(__file__).resolve().parents[1] / 'frontend/public/models/airbus-a320-200.glb'


def main():
    with urlopen(SOURCE_URL, timeout=30) as response:
        source = response.read()
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError('The downloaded GLB does not match the Airbus5717 source checksum.')

    size = struct.unpack_from('<I', source, 12)[0]
    model = json.loads(source[20:20 + size])
    binary_chunk = source[20 + size:]
    positions = [
        model['accessors'][primitive['attributes']['POSITION']]
        for mesh in model['meshes'] for primitive in mesh['primitives']
    ]
    # The Sketchfab root maps source -Y to forward and source +Z to up.
    nose = min(position['min'][1] for position in positions)
    tail = max(position['max'][1] for position in positions)
    scale = 37.57 / (tail - nose)
    root = model['nodes'][model['scenes'][model['scene']]['nodes'][0]]
    root['matrix'] = [value * scale for value in root['matrix'][:12]] + [
        0, 0, (nose + tail) * scale / 2, 1,
    ]

    model['asset']['copyright'] = 'Airbus A320-200 by Airbus5717, CC BY-NC 4.0'
    model['asset']['extras'].update(
        licenseUrl='https://creativecommons.org/licenses/by-nc/4.0/',
        modifications='Uniformly scaled to 37.57 m and centered nose to tail for aircraft follow mode.',
    )
    document = json.dumps(model, separators=(',', ':')).encode()
    document += b' ' * (-len(document) % 4)
    header = struct.pack('<4sIII4s', b'glTF', 2, 20 + len(document) + len(binary_chunk), len(document), b'JSON')
    OUTPUT.write_bytes(header + document + binary_chunk)
    print(OUTPUT)


if __name__ == '__main__':
    main()
