// @vitest-environment jsdom
import React from 'react';
import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import ObserverPanel from './ObserverPanel';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const props={pin:null,placing:false,sky:false,aim:{heading:0,pitch:15},tracks:[],now:1000,mode:'live' as const,mapReady:true,onPin:vi.fn(),onPlace:vi.fn(),onCancel:vi.fn(),onRemove:vi.fn(),onCenter:vi.fn(),onSky:vi.fn(),onLook:vi.fn(),onAim:vi.fn()};
it('preserves leading zeroes in postal lookup and sets the returned pin',async()=>{
 const fetcher=vi.fn(async(_url:string,_options:RequestInit)=>({ok:true,json:async()=>({results:[{lat:1.28,lon:103.85,label:'Example building',postal:'018956'}]})}));vi.stubGlobal('fetch',fetcher);
 const onPin=vi.fn();render(<ObserverPanel {...props} onPin={onPin}/>);
 fireEvent.change(screen.getByLabelText('Singapore postal code'),{target:{value:'018956'}});
 fireEvent.submit(screen.getByRole('form',{name:'Find postal code'}));
 await waitFor(()=>expect(onPin).toHaveBeenCalledWith({lat:1.28,lon:103.85,height:2,label:'Example building'}));
 expect(JSON.parse(String(fetcher.mock.calls[0][1].body)).postal).toBe('018956');
});
it('keeps a saved pin on search failure and can remove it',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:503,json:async()=>({detail:'Postal search unavailable. Use Drop pin.'})})));
 const onPin=vi.fn(),onRemove=vi.fn();render(<ObserverPanel {...props} pin={{lat:1.35,lon:103.85,height:2}} onPin={onPin} onRemove={onRemove}/>);
 fireEvent.change(screen.getByLabelText('Singapore postal code'),{target:{value:'123456'}});fireEvent.submit(screen.getByRole('form',{name:'Find postal code'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Drop pin'));
 expect(onPin).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Remove pin'}));expect(onRemove).toHaveBeenCalled();
});
it('does not let an old postal response replace a newly dropped pin',async()=>{
 let finish:(x:unknown)=>void=()=>{};vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>finish=r)));
 const onPin=vi.fn();const {rerender}=render(<ObserverPanel {...props} onPin={onPin}/>);
 fireEvent.change(screen.getByLabelText('Singapore postal code'),{target:{value:'123456'}});fireEvent.submit(screen.getByRole('form',{name:'Find postal code'}));
 rerender(<ObserverPanel {...props} onPin={onPin} pin={{lat:1.35,lon:103.85,height:2}}/>);
 finish({ok:true,json:async()=>({results:[{lat:1.28,lon:103.85,label:'old'}]})});
 await new Promise(r=>setTimeout(r,0));expect(onPin).not.toHaveBeenCalled();
});
