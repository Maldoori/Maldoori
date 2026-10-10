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
