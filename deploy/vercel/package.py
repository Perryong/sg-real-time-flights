"""Export only public source needed by a Vercel deployment."""
from pathlib import Path
import shutil
import tempfile


def export_public_source(source: Path, prefix: str) -> Path:
    root = Path(__file__).resolve().parents[2]
    target = Path(tempfile.mkdtemp(prefix=prefix))
    for name in ('app.py', 'vercel.json', 'pyproject.toml'):
        shutil.copy2(source / name, target / name)

    backend = target / 'backend/app'
    backend.mkdir(parents=True)
    for path in (root / 'backend/app').glob('*.py'):
        shutil.copy2(path, backend)

    airport = target / 'data/airport'
    airport.mkdir(parents=True)
    shutil.copy2(root / 'data/airport/runways.geojson', airport)
    return target


if __name__ == '__main__':
    print(export_public_source(Path(__file__).resolve().parent, 'changi-vercel-cloud-'))
