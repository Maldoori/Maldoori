import {test} from 'node:test';
import assert from 'node:assert/strict';
import {backupResults,backupTaskType} from '../lib/acronis-inventory.js';
test('backup results require an exact unique resource reference and confirmed successful completion',()=>{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 const resources=[{id:a},{id:b}];
 const task={uuid:'job',type:backupTaskType,state:'completed',result:{code:'ok'},context:{Specific:`<MachineId>${a}</MachineId>`},completedAt:'2026-10-10T20:00:00Z'};
 assert.equal(backupResults(resources,[task])[0].lastSuccessfulTaskAt,task.completedAt);
 assert.equal(backupResults(resources,[{...task,type:'plan-application'}])[0].latestTask,null);
 assert.equal(backupResults(resources,[{...task,context:{Specific:a+' '+b}}])[0].latestTask,null);
 assert.equal(backupResults(resources,[{...task,result:{code:'error'}}])[0].lastSuccessfulTaskAt,null);
 assert.equal(backupResults(resources,[{...task,context:{Specific:'same computer name'}}])[0].latestTask,null);
 assert.equal(backupResults(resources,[{...task,completedAt:'invalid'}])[0].lastSuccessfulTaskAt,null);
});
