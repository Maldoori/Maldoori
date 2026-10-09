import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { MeshClient } from '../lib/mesh.js';

test('authenticated enrollment, synchronization, remote links, stale data, and persistence', async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'maldoori-test-'));
  t.after(() => rm(dir, {recursive:true,force:true}));
  execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',resolve(dir,'key.pem'),'-out',resolve(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], {stdio:'ignore'});
  const upstream = https.createServer({key:await readFile(resolve(dir,'key.pem')),cert:await readFile(resolve(dir,'cert.pem'))}, (req,res)=>{res.writeHead(200,{'Content-Type':'text/plain'});res.end('MeshCentral test destination');});
  const wss = new WebSocketServer({server:upstream});
  const groups = [{_id:'mesh//existing-group',name:'Existing customer',mtype:2}];
  let devices = {'mesh//existing-group':[{_id:'node//original-device',name:'REAL-WINDOWS',conn:1,osdesc:'Windows 11'}]}, fail = false;
  wss.on('connection', (socket, req) => {
    assert.equal(req.headers['x-meshauth'], Buffer.from('test-integration').toString('base64')+','+Buffer.from('test-mesh-password').toString('base64'));
    socket.on('message', raw => {
      const input = JSON.parse(raw);
      if(fail) { socket.send(JSON.stringify({action:'close',cause:'noauth'})); return; }
      let output = {action:input.action,responseid:input.responseid};
      if(input.action==='meshes') output={action:'meshes',tag:input.tag,meshes:groups};
      if(input.action==='nodes') output.nodes=devices;
      if(input.action==='createmesh') { const id='mesh//new-'+groups.length; groups.push({_id:id,name:input.meshname,mtype:input.meshtype}); output={...output,result:'OK',meshid:id}; }
      if(input.action==='createInviteLink') output.url=`https://localhost:${upstream.address().port}/agentinvite?c=test-invitation`;
      socket.send(JSON.stringify(output));
    });
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  t.after(async()=>{for(const socket of wss.clients)socket.terminate();await new Promise(r=>upstream.close(r));});
  const meshUrl='https://localhost:'+upstream.address().port+'/';
  // A client with the default trust store must reject the private test certificate.
  await assert.rejects(new MeshClient({url:meshUrl,username:'test-integration',password:'test-mesh-password'}).request('meshes'), /securely/);
  let child;
  let backendPort = 0;
  // Choose an available port without fixed-port collisions.
  const probe=https.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));backendPort=probe.address().port;await new Promise(r=>probe.close(r));
  const origin='http://127.0.0.1:'+backendPort;
  const start=async(useFile=false)=>{
    const env={...process.env,PORT:String(backendPort),PUBLIC_URL:origin,BIND_ADDRESS:'127.0.0.1',RMM_USERNAME:'test-admin',RMM_PASSWORD:'test-rmm-password-long',MESH_URL:meshUrl,MESH_USERNAME:'test-integration',MESH_PASSWORD:'test-mesh-password',DATA_DIR:resolve(dir,'data'),NODE_EXTRA_CA_CERTS:resolve(dir,'cert.pem')};
    if(useFile){
      const config={};
      for(const key of ['RMM_USERNAME','RMM_PASSWORD','MESH_URL','MESH_USERNAME','MESH_PASSWORD']){config[key]=env[key];delete env[key];}
      const file=resolve(dir,'credentials.json');await writeFile(file,JSON.stringify(config),{mode:0o600});env.CREDENTIALS_FILE=file;
    }
    child=spawn(process.execPath,['rmm-server.js'],{cwd:resolve(import.meta.dirname,'..'),env,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Backend startup timed out')),20000);child.stdout.on('data',text=>{if(text.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Backend exited: '+code));});});
  };
  const stop=async()=>{if(child && child.exitCode===null){const exit=once(child,'exit');child.kill('SIGTERM');await exit;}};
  t.after(stop);
  await start();
  let cookie='';
  const api=async(path,input,customOrigin=origin)=>{
    const response=await fetch(origin+'/api/'+path,{method:input===undefined?'GET':'POST',headers:{Origin:customOrigin,Cookie:cookie,'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await api('inventory')).status,401);
  assert.equal((await api('login',{username:'test-admin',password:'test-rmm-password-long'},'https://evil.example')).status,403);
  assert.equal((await api('login',{username:'test-admin',password:'wrong'})).status,401);
  assert.equal((await api('login',{username:'test-admin',password:'test-rmm-password-long'})).status,200);
  let result=await api('inventory'); assert.equal(result.data.devices[0].name,'REAL-WINDOWS');
  assert.equal(new URL(result.data.devices[0].desktopUrl).searchParams.get('node'),'original-device');
  assert.equal(new URL(result.data.devices[0].desktopUrl).searchParams.get('viewmode'),'11');
  assert.equal(new URL(result.data.devices[0].desktopUrl).searchParams.has('gotonode'),false);
  assert.equal(new URL(result.data.devices[0].desktopUrl).searchParams.get('maldooriConnect'),'1');
  assert.equal(result.data.devices[0].mapped,false);
  assert.equal((await api('companies',{name:'Existing company',groupId:'mesh//existing-group'})).status,201);
  assert.equal((await api('companies',{name:'Other company',groupId:'mesh//existing-group'})).status,409);
  result=await api('companies',{name:'New company'});assert.equal(result.status,201);const companyId=result.data.id;
  assert.equal((await api('invitation',{groupId:'mesh//unknown'})).status,404);
  result=await api('invitation',{groupId:companyId});assert.equal(result.status,200);assert.equal(result.data.expiresInHours,24);
  devices[companyId]=[{_id:'node//new-enrolled-device',name:'NEW-PC',conn:1}];
  await api('sync',{});result=await api('inventory');
  assert.equal(result.data.devices.find(d=>d.name==='NEW-PC').company,'New company');
  assert.equal(result.data.devices.length,2);
  devices[companyId][0].conn=0;await api('sync',{});result=await api('inventory');assert.equal(result.data.devices.find(d=>d.name==='NEW-PC').online,false);
  fail=true;assert.equal((await api('sync',{})).status,502);result=await api('inventory');assert.ok(result.data.error);assert.equal(result.data.devices.length,2);fail=false;
  devices[companyId]=[];await api('sync',{});result=await api('inventory');assert.equal(result.data.devices.length,1);
  const raw=JSON.stringify(result.data);assert.ok(!raw.includes('test-mesh-password'));assert.ok(!raw.includes('test-rmm-password'));
  await stop();await start(true);cookie='';await api('login',{username:'test-admin',password:'test-rmm-password-long'});
  assert.equal((await api('inventory')).data.companies.length,2);
  if (process.env.BROWSER_TEST_MODULE) {
    const {chromium}=await import(process.env.BROWSER_TEST_MODULE);
    const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
    try {
      const page=await browser.newPage({viewport:{width:1440,height:1000}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin);
      await page.locator('[name="username"]').fill('test-admin');
      await page.locator('[name="password"]').fill('test-rmm-password-long');
      await page.locator('#login-form button').click();
      await page.getByText('REAL-WINDOWS',{exact:true}).waitFor();
      assert.equal(await page.locator('[data-remote]').count(),1);
      await page.locator('[data-invite]').first().click();
      await page.getByRole('heading',{name:'Enroll a Windows computer'}).waitFor();
      assert.match(await page.locator('.invite').getAttribute('href'),/agentinvite/);
      await page.locator('[data-close]').click();
      await page.locator('#add-company').click();
      await page.locator('[name="name"]').fill('Browser company');
      await page.locator('#company-form .primary').click();
      await page.locator('#companies').getByText('Browser company',{exact:true}).waitFor();
      await page.locator('#search').fill('no-such-device');
      assert.equal(await page.locator('[data-remote]').count(),0);
      await page.locator('#search').fill('');
      await page.screenshot({path:'/tmp/maldoori-live-dashboard.png',fullPage:true});
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
      await page.locator('#logout').click();
      await page.getByRole('heading',{name:'Sign in to Maldoori'}).waitFor();
      assert.deepEqual(errors,[]);
    } finally { await browser.close(); }
  }
  await api('logout',{});assert.equal((await api('inventory')).status,401);
});
