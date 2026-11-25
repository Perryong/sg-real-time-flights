"""Export only public source needed by the throwaway Vercel test."""
from pathlib import Path
import sys

source = Path(__file__).resolve().parent
sys.path.insert(0, str(source.parents[1]))
from deploy.vercel.package import export_public_source

if __name__ == '__main__':
    print(export_public_source(source, 'changi-vercel-feed-'))
