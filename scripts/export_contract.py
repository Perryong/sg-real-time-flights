import json
from pathlib import Path
from backend.app.contracts import Snapshot
Path('data/contracts/snapshot.schema.json').write_text(json.dumps(Snapshot.model_json_schema(), indent=2) + '\n')
