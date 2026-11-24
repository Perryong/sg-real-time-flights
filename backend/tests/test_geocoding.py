import httpx
import pytest
from backend.app.geocoding import OneMapGeocoder,LookupUnavailable

class Cache:
    def __init__(self):self.values={}
    async def command(self,cmd,key,*args):
        if cmd=='GET':return self.values.get(key)
        if cmd=='SET':
            if 'NX' in args and key in self.values:return None
            self.values[key]=args[0];return 'OK'
        if cmd=='DEL':return self.values.pop(key,None)

@pytest.mark.asyncio
async def test_exact_postal_search_keeps_leading_zeroes_and_reuses_private_token():
    seen=[]
    async def transport(request):
        seen.append(request)
        if request.method=='POST':return httpx.Response(200,json={'access_token':'private-token','expiry_timestamp':2000})
        assert request.headers['authorization']=='private-token'
        assert request.url.params['searchVal']=='018956'
        return httpx.Response(200,json={'results':[
            {'POSTAL':'018956','LATITUDE':'1.28','LONGITUDE':'103.85','ADDRESS':'Test building'},
            {'POSTAL':'018957','LATITUDE':'1.28','LONGITUDE':'103.85','ADDRESS':'Wrong code'},
            {'POSTAL':'018956','LATITUDE':'99','LONGITUDE':'103.85','ADDRESS':'Wrong country'}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service=OneMapGeocoder(client,Cache(),'account','password',clock=lambda:1000)
        assert await service.search('018956')==[{'lat':1.28,'lon':103.85,'label':'Test building','postal':'018956'}]
        await service.search('018956')
        assert len([r for r in seen if r.method=='POST'])==1

@pytest.mark.asyncio
@pytest.mark.parametrize('status',[401,429,500])
async def test_provider_failures_are_safe_and_never_leak_credentials(status):
    async def transport(request):return httpx.Response(status,json={'error':'secret-response'})
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service=OneMapGeocoder(client,Cache(),'account','private-password',clock=lambda:1000)
        with pytest.raises(LookupUnavailable) as error:await service.search('018956')
        assert 'password' not in str(error.value) and 'secret-response' not in str(error.value)

def test_postal_route_validation_and_missing_configuration(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.app.cloud import create_cloud_app
    monkeypatch.delenv('ONEMAP_EMAIL',raising=False);monkeypatch.delenv('ONEMAP_PASSWORD',raising=False)
    with TestClient(create_cloud_app()) as client:
        for postal in ('12345','1234567','abcdef',18956):
            assert client.post('/api/location/postal',json={'postal':postal}).status_code==422
        r=client.post('/api/location/postal',json={'postal':'018956'},headers={'Origin':'https://perryong.github.io'})
        assert r.status_code==503 and r.headers['access-control-allow-origin']=='https://perryong.github.io'
        preflight=client.options('/api/location/postal',headers={'Origin':'https://perryong.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'})
        assert preflight.status_code==200

@pytest.mark.asyncio
@pytest.mark.parametrize('body',[[],{'access_token':'','expiry_timestamp':2000},{'access_token':'token','expiry_timestamp':999}])
async def test_invalid_auth_response_is_unavailable(body):
    async def transport(request):return httpx.Response(200,json=body)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        with pytest.raises(LookupUnavailable):await OneMapGeocoder(client,Cache(),'account','password',clock=lambda:1000).search('018956')

@pytest.mark.asyncio
async def test_denied_search_stops_repeated_authentication():
    calls=[];cache=Cache()
    async def transport(request):
        calls.append(request.method)
        return httpx.Response(200,json={'access_token':'secret','expiry_timestamp':2000}) if request.method=='POST' else httpx.Response(401)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service=OneMapGeocoder(client,cache,'account','password',clock=lambda:1000)
        for _ in range(2):
            with pytest.raises(LookupUnavailable):await service.search('018956')
        assert calls==['POST','GET']

from backend.tests.test_cloud import redis_port,command

def test_geocoding_limits_share_budget_and_noisy_viewers_do_not_spend_global(command):
    import uuid
    from backend.app.geocoding import LIMIT
    for _ in range(3):
        minute=int(command('TIME')[0])//60;key='test-geocode:'+uuid.uuid4().hex
        results=[command('EVAL',LIMIT,1,key,'viewer') for _ in range(10)]
        others=[command('EVAL',LIMIT,1,key,str(i)) for i in range(16)]
        if int(command('TIME')[0])//60==minute:
            assert results==[1]*5+[0]*5
            assert others==[1]*15+[0]
            break
    else:pytest.fail('Redis minute changed on every attempt')

@pytest.mark.asyncio
async def test_onemap_http_200_auth_error_is_not_reported_as_no_matching_address():
    calls=[];cache=Cache()
    async def transport(request):
        calls.append(request.method)
        body={'access_token':'secret','expiry_timestamp':2000} if request.method=='POST' else {'error':'Authentication token expired','results':[]}
        return httpx.Response(200,json=body)
    async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as client:
        service=OneMapGeocoder(client,cache,'account','password',clock=lambda:1000)
        for _ in range(2):
            with pytest.raises(LookupUnavailable):await service.search('018956')
        assert calls==['POST','GET']
