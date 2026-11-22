"""Export only public source needed by the Vercel backend."""
from pathlib import Path
import shutil
import tempfile

source = Path(__file__).resolve().parent
root = source.parents[1]
target = Path(tempfile.mkdtemp(prefix='changi-vercel-cloud-'))
for name in ('app.py', 'vercel.json', 'pyproject.toml'):
    shutil.copy2(source / name, target / name)
for path in (root / 'backend/app').glob('*.py'):
    destination = target / 'backend/app' / path.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, destination)
destination = target / 'data/airport'
destination.mkdir(parents=True)
shutil.copy2(root / 'data/airport/runways.geojson', destination)
print(target)
