"""Bounded Vercel compatibility spike, not the production collector."""
import asyncio
from contextlib import asynccontextmanager
import os

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from backend.app.combined import CombinedProvider
from backend.app.config import Settings
from backend.app.provider import AdsbFiProvider, FlyItalyProvider
from backend.app.service import FeedService

ORIGINS = ('https://perryong.github.io', 'http://127.0.0.1:4177')
app = FastAPI(title='Changi Vercel compatibility test')
app.add_middleware(CORSMiddleware, allow_origins=list(ORIGINS), allow_methods=['GET'])


@asynccontextmanager
async def session():
    key = os.getenv('FLYITALYADSB_API_KEY', '').strip()
    async with httpx.AsyncClient(follow_redirects=False) as client:
        providers = CombinedProvider(AdsbFiProvider(client),
            regional=FlyItalyProvider(client, key) if key else None)
        feed = FeedService(Settings(live_enabled=True, movement_db=':memory:'), providers)
        try:
            yield feed
        finally:
            await providers.close()
            feed.movements.close()


def snapshot(feed):
    frame = feed.snapshot().model_dump(mode='json')
    # shortcut: this isolated spike has no shared cache or durable daily counts.
    # Add both before using it as the public tracker's backend.
    frame['status']['movements'] = None
    frame['status']['message'] = 'Vercel compatibility test; session-only observations'
    return frame


@app.get('/')
@app.get('/api/health')
def health():
    return {'ok': True, 'test_only': True, 'stream_seconds': 45,
            'continuous_collection': False, 'durable_counts': False}


@app.get('/api/aircraft')
async def aircraft():
    async with session() as feed:
        # CombinedProvider publishes sources independently; wait for both initial probes.
        await feed.poll_once()
        if feed.provider.pending:
            await feed.poll_once()
        return snapshot(feed)


@app.websocket('/ws/aircraft')
async def stream(ws: WebSocket):
    if ws.headers.get('origin') not in ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    try:
        async with session() as feed:
            async with asyncio.timeout(45):
                while True:
                    await feed.poll_once()
                    await asyncio.wait_for(ws.send_json(snapshot(feed)), timeout=5)
                    await asyncio.sleep(max(0.1, feed.provider.next_poll_delay()))
    except TimeoutError:
        await ws.close(code=1012, reason='Test session complete; reconnect supported')
    except WebSocketDisconnect:
        pass
