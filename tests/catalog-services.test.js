import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {initializeCatalog,catalog,addLocation} from '../lib/catalog.js';
import {serviceCommand,parseServiceOutput} from '../lib/services.js';

test('existing company IDs and group assignment survive repeatable catalog migration',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE companies(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL);INSERT INTO companies VALUES ('mesh//legacy','Existing customer');");
    initializeCatalog(db);let data=catalog(db);
    assert.equal(data.companies[0].id,'mesh//legacy');assert.equal(data.deviceGroups[0].id,'mesh//legacy');assert.equal(data.locations[0].name,'Main office');
    const location=addLocation(db,'mesh//legacy','Branch');
    db.prepare('UPDATE device_groups SET location_id=? WHERE id=?').run(location.id,'mesh//legacy');
    initializeCatalog(db);data=catalog(db);
    assert.equal(data.locations.length,2);assert.equal(data.deviceGroups.length,1);assert.equal(data.deviceGroups[0].location,'Branch');
  }finally{db.close();}
});
test('service commands reject injection and protected services and parse verified output only',()=>{
  for(const name of ["Spooler';evil",'Spooler*','[RpcSs]','name\nother']) assert.throws(()=>serviceCommand('stop',name),/Invalid/);
  for(const name of ['MeshAgent','RpcSs','WinDefend']) assert.throws(()=>serviceCommand('restart',name),/protected/);
  assert.throws(()=>serviceCommand('execute','Spooler'),/Unknown/);
  const command=serviceCommand('list');
  const output=command.script+'\n'+command.marker+JSON.stringify({ok:true,services:[{Name:'Spooler',DisplayName:'Print Spooler',State:'Running',StartMode:'Auto',ProcessId:1}]})+command.marker;
  assert.equal(parseServiceOutput(output,command.marker)[0].state,'Running');
  assert.throws(()=>parseServiceOutput('OK',command.marker),/completed/);
  assert.throws(()=>parseServiceOutput(command.marker+'{"ok":false}'+command.marker,command.marker),/could not complete/);
});
