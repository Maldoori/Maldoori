import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AcronisClient} from '../lib/acronis.js';
const settings={url:'https://us15-cloud.acronis.com',clientId:'fixture-client',secret:'fixture-secret'};
test('Acronis exchanges credentials only at the TLS data center and keeps tokens server-side',async()=>{
  let calls=0;
  const client=new AcronisClient(settings,async(url,options)=>{
    calls++;assert.equal(url.href,'https://us15-cloud.acronis.com/api/2/idp/token');
    assert.equal(options.redirect,'error');assert.equal(options.body,'grant_type=client_credentials');
    assert.equal(options.headers.Authorization,'Basic '+Buffer.from('fixture-client:fixture-secret').toString('base64'));
    return {ok:true,json:async()=>({access_token:'fixture-access-token',expires_in:3600})};
  });
  const results=await Promise.all([client.testConnection(),client.testConnection()]);assert.equal(calls,1);
  assert.equal(results[0].authenticated,true);assert.equal(results[0].backupStatusVerified,false);
  assert.equal(JSON.stringify(results).includes('fixture-'),false);
  client.expires=0;await client.testConnection();assert.equal(calls,2);
});
test('Acronis handles missing credentials, untrusted URLs, and failed authentication without disclosing secrets',async()=>{
  await assert.rejects(new AcronisClient({}).testConnection(),/not configured/);
  for(const url of ['http://us15-cloud.acronis.com','https://acronis.com.evil.test','https://us15-cloud.acronis.com/?token=x','https://user:pass@us15-cloud.acronis.com'])assert.throws(()=>new AcronisClient({...settings,url}),/HTTPS/);
  const denied=new AcronisClient(settings,async()=>({ok:false,status:401,json:async()=>({secret:'must not be used'})}));
  await assert.rejects(denied.testConnection(),/authentication failed/);assert.equal(denied.token,null);
  const invalid=new AcronisClient(settings,async()=>({ok:true,json:async()=>({access_token:'secret-token',expires_in:'3600'})}));
  await assert.rejects(invalid.testConnection(),/Unexpected/);
  const failed=new AcronisClient(settings,async()=>{throw new Error('fixture-secret');});
  await assert.rejects(failed.testConnection(),/Cannot connect securely/);
});

test('Acronis imports sanitized resources and task history with safe pagination',async()=>{
 const client=new AcronisClient(settings,async(url,options)=>{
  if(url.pathname.endsWith('/token'))return {ok:true,json:async()=>({access_token:'private-token',expires_in:3600})};
  assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer private-token');
  if(url.pathname.includes('resource_management'))return {ok:true,json:async()=>url.search?{items:[{id:'r2',tenant_id:'t2',tenant_name:'Second company',name:'PC',type:'machine'}]}:{items:[{id:'r1',tenant_id:'t1',tenant_name:'First company',name:'PC',type:'machine',secret:'never-export'}],_links:[{rel:'next',href:'/api/resource_management/v4/resources?after=page2'}]}};
  return {ok:true,json:async()=>({items:[{uuid:'job',type:'backup',tenant:{id:'t1',name:'First company'},state:'completed',result:{code:'ok',payload:'private-payload'},context:{title:'Backup',Specific:'private-context'},completedAt:'2026-10-10T21:00:00Z'}]})};
 });
 const data=await client.inventory();assert.equal(data.resources.length,2);assert.equal(data.tasks[0].state,'completed');assert.equal(data.tasks[0].tenantId,'t1');assert.equal(data.complete,true);assert.equal(JSON.stringify(data).includes('private-'),false);assert.equal(JSON.stringify(data).includes('never-export'),false);
});
test('Acronis refuses external pagination destinations and marks incomplete lists',async()=>{
 let calls=0;
 const client=new AcronisClient(settings,async(url)=>{calls++;return {ok:true,json:async()=>url.pathname.endsWith('/token')?{access_token:'token',expires_in:3600}:{items:[],_links:[{rel:'next',href:'https://evil.test/api/steal'}]}};});
 await assert.rejects(client.collection('/api/resource_management/v4/resources'),/unsafe/);assert.equal(calls,2);
 const partial=new AcronisClient(settings,async(url)=>({ok:true,json:async()=>url.pathname.endsWith('/token')?{access_token:'token',expires_in:3600}:{items:[],paging:{cursors:{total:50}}}}));
 assert.equal((await partial.collection('/api/resource_management/v4/resources')).complete,false);
});
