import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const hook=readFileSync(new URL('../scripts/meshcentral-autoconnect.js',import.meta.url),'utf8');
function fixture(url='https://mesh.example/?node=target&viewmode=11&maldooriConnect=1'){
  let tick,clicks=0,cleared=false;
  const button={disabled:false,offsetParent:{},click:()=>clicks++};
  const context={URL,window:{location:{href:url},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>cleared=true},document:{getElementById:()=>button},currentNode:{_id:'node//target'},xxcurrentView:11,meshserver:{State:2},xxdialogMode:0,desktop:null};
  runInNewContext(hook,context);
  return {context,button,tick:()=>{if(!cleared&&tick)tick();},get clicks(){return clicks},get started(){return !!tick}};
}
test('desktop launch is opt-in and clicks once only after the target is ready',()=>{
  assert.equal(fixture('https://mesh.example/?node=target').started,false);
  const f=fixture();f.context.currentNode=null;f.tick();assert.equal(f.clicks,0);
  f.context.currentNode={_id:'node//other'};f.tick();assert.equal(f.clicks,0);
  f.context.currentNode={_id:'node//target'};f.button.disabled=true;f.tick();assert.equal(f.clicks,0);
  f.button.disabled=false;f.context.xxdialogMode=1;f.tick();assert.equal(f.clicks,0);
  f.context.xxdialogMode=0;f.context.xxcurrentView=10;f.tick();assert.equal(f.clicks,0);
  f.context.xxcurrentView=11;f.context.meshserver.State=0;f.tick();assert.equal(f.clicks,0);
  f.context.meshserver.State=2;f.tick();f.tick();assert.equal(f.clicks,1);
  const existing=fixture();existing.context.desktop={};existing.tick();assert.equal(existing.clicks,0);
});

test('desktop-only launch uses native layout once and leaves normal MeshCentral navigation alone',()=>{
  const f=fixture('https://mesh.example/?node=target&viewmode=11&maldooriConnect=1&maldooriDesktop=1');let toggles=0;
  f.context.fullscreen=false;f.context.deskToggleFull=e=>{assert.equal(e.shiftKey,false);toggles++;f.context.fullscreen=true;};
  f.tick();f.tick();assert.equal(toggles,1);assert.equal(f.clicks,1);
  const ordinary=fixture();ordinary.context.fullscreen=false;ordinary.context.deskToggleFull=()=>{throw new Error('Ordinary view must remain unchanged');};ordinary.tick();assert.equal(ordinary.clicks,1);
});
test('Request Control stays disabled until agent confirms view approval and Input waits for control approval',()=>{
 let intervals=[],clicks=0;const elements={};const parent={appendChild:element=>{elements[element.id]=element;}};
 elements.connectbutton1={disabled:false,offsetParent:{},parentNode:{parentNode:parent},click:()=>clicks++};elements.DeskControl={checked:true,disabled:false};
 const context={URL,window:{location:{href:'https://mesh.example/?node=target&viewmode=11&maldooriConnect=1&maldooriDesktop=1'},setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval:()=>{}},document:{createElement:()=>({style:{}}),getElementById:id=>elements[id]||null},currentNode:{_id:'node//target'},xxcurrentView:11,meshserver:{State:2},xxdialogMode:0,desktop:null};runInNewContext(hook,context);intervals[0]();const sent=[];context.desktop={m:{},metadata:null,sendCtrlMsg:message=>sent.push(JSON.parse(message))};intervals[0]();assert.equal(elements['skybase-request-control'].disabled,true);assert.equal(context.desktop.m.stopInput,true);assert.equal(elements.DeskControl.checked,false);context.desktop.onMetadataChange({skybasePrivacy:{version:1,phase:'view-only',canRequestControl:true}});assert.equal(elements['skybase-request-control'].disabled,false);elements['skybase-request-control'].onclick();assert.equal(sent[0].type,'skybase-request-control');assert.equal(context.desktop.m.stopInput,true);context.desktop.onMetadataChange({skybasePrivacy:{version:1,phase:'waiting-control',canRequestControl:true}});assert.equal(elements['skybase-request-control'].disabled,true);context.desktop.onMetadataChange({skybasePrivacy:{version:1,phase:'control',canRequestControl:true}});assert.equal(context.desktop.m.stopInput,false);assert.equal(elements.DeskControl.checked,true);assert.equal(elements.DeskControl.disabled,false);context.desktop.onMetadataChange({skybasePrivacy:{version:1,phase:'view-denied',canRequestControl:false,error:'Windows could not display the approval dialog.'}});context.desktop=null;intervals[0]();assert.match(elements['skybase-control-status'].textContent,/could not display/);
});
