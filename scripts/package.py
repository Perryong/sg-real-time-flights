"""Build an explicit source-only archive; never include runtime secrets or caches."""
from pathlib import Path
import zipfile
ROOT=Path(__file__).resolve().parents[1]
DIRECTORIES=('backend/app','backend/tests','frontend/src','frontend/public','frontend/e2e','frontend/scripts','data','tests/fixtures','scripts','assets','docs')
FILES=('README.md','goal.md','.gitignore','.env.example','.nvmrc','.python-version','pytest.ini','backend/pyproject.toml','backend/requirements.lock','frontend/package.json','frontend/package-lock.json','frontend/tsconfig.json','frontend/vite.config.ts','frontend/playwright.config.ts','frontend/index.html')
ALLOWED={'.py','.sh','.mjs','.ts','.tsx','.css','.html','.json','.geojson','.md','.png','.svg','.glb','.toml','.lock'}
def package(root=ROOT):
    paths={root/name for name in FILES}
    for directory in DIRECTORIES:
        paths.update(p for p in (root/directory).rglob('*') if p.is_file() and p.suffix in ALLOWED and not any(part in ('__pycache__','.pytest_cache','node_modules','.venv','.codex-attachments') for part in p.parts))
    out=root/'dist/changi-observatory-source.zip';out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for p in sorted(paths):
            assert p.exists(),f'Missing required source: {p}'
            relative=p.relative_to(root);assert '.env' not in relative.parts
            archive.write(p,'changi-observatory/'+str(relative))
    with zipfile.ZipFile(out) as archive:
        names=archive.namelist();assert 'changi-observatory/goal.md' in names
        assert not any(any(part in ('node_modules','.venv','.env','.codex-attachments','.git') for part in Path(name).parts) for name in names)
        assert archive.testzip() is None
    print(f'{out}: {len(paths)} files, {out.stat().st_size:,} bytes; contents/CRC verified')
    return out
if __name__=='__main__':package()
