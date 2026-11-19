import pytest
from backend.app.service import FeedService
from backend.app.config import Settings
from backend.app.provider import ProviderResult, ProviderError

class Fake:
    calls=0
    async def fetch(self):
        self.calls+=1
        return ProviderResult([],0)

@pytest.mark.asyncio
async def test_single_poll_serves_ten_clients_and_keeps_latest_only():
    f=Fake(); s=FeedService(Settings(),f,lambda:1700000000)
    qs=[s.subscribe() for _ in range(10)]
    await s.poll_once(); await s.poll_once()
    assert f.calls==2
    assert all(q.qsize()==1 for q in qs)
    assert len({(await q.get())['sequence'] for q in qs})==1
    assert s.status().upstream_state=='healthy'
    assert s.counters['dropped_updates']>=10
    assert s.snapshot().epoch!=FeedService(Settings(),f,lambda:1700000000).snapshot().epoch

@pytest.mark.asyncio
async def test_failure_does_not_renew_last_success_and_access_pauses():
    now=[1700000000]; f=Fake(); s=FeedService(Settings(),f,lambda:now[0])
    await s.poll_once()
    async def fail(): raise ProviderError('403',pause=True)
    f.fetch=fail; now[0]+=10
    await s.poll_once()
    assert s.paused
    assert s.status().last_success==1700000000
    assert s.status().upstream_state=='degraded'
    now[0]+=51
    assert s.status().upstream_state=='unavailable'
