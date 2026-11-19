import asyncio
import contextlib
import json
import time
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .config import Settings, ROOT
from .provider import AirplanesProvider
from .service import FeedService

def load_airport():
    manifest=ROOT/'data/airport/manifest.json'
    if not manifest.exists():
        return {'name':'Singapore Changi','edition':'unverified','sources':[],'caveat':'Geometry sourcing in progress',**{k:{'type':'FeatureCollection','features':[]} for k in ('runways','taxiways','buildings')}}
    result=json.loads(manifest.read_text())
    for layer in ('runways','taxiways','buildings'):
        result[layer]=json.loads((manifest.parent/f'{layer}.geojson').read_text())
    return result

def create_app(settings=None, provider=None, clock=time.time):
    settings=settings or Settings.from_env()
    @asynccontextmanager
    async def lifespan(app):
        async with httpx.AsyncClient(follow_redirects=False) as client:
            feed=FeedService(settings,provider or AirplanesProvider(client,clock,settings.now_units,settings.token),clock)
            app.state.feed=feed
            task=asyncio.create_task(feed.run())
            try: yield
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError): await task
    app=FastAPI(title='Changi Observatory',lifespan=lifespan)
    app.add_middleware(CORSMiddleware,allow_origins=list(settings.origins),allow_methods=['GET'],allow_headers=['*'])
    @app.get('/api/health')
    def health(): return {'ok':True,'schema_version':1,'version':'0.1.0'}
    @app.get('/api/status')
    def status(): return app.state.feed.status()
    @app.get('/api/aircraft')
    def aircraft(): return app.state.feed.snapshot()
    @app.get('/api/airport')
    def airport(): return load_airport()
    @app.get('/api/fixtures/{name}')
    def fixture(name: str):
        if name not in ('changi-demo','recorded-test'): raise HTTPException(404)
        path=ROOT/'tests/fixtures/scenarios'/f'{name}.json'
        if not path.exists(): raise HTTPException(404,'Fixture unavailable')
        return json.loads(path.read_text())
    @app.websocket('/ws/aircraft')
    async def stream(ws:WebSocket):
        if ws.headers.get('origin') not in settings.origins:
            await ws.close(code=1008); return
        await ws.accept(); feed=app.state.feed; q=feed.subscribe()
        try:
            await asyncio.wait_for(ws.send_json(feed.snapshot().model_dump(mode='json')),timeout=5)
            while True:
                try: payload=await asyncio.wait_for(q.get(),timeout=10)
                except asyncio.TimeoutError:
                    payload={'type':'heartbeat','epoch':feed.epoch,'sequence':feed.sequence,'server_time':clock(),'status':feed.status().model_dump(mode='json')}
                await asyncio.wait_for(ws.send_json(payload),timeout=5)
        except (WebSocketDisconnect,RuntimeError,asyncio.TimeoutError): pass
        finally: feed.clients.discard(q)
    return app

app=create_app()
