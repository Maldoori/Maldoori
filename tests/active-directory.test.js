import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directoryCommand,parseDirectory} from '../lib/active-directory.js';
import {directoryFixture} from './fixtures/directory.js';

test('directory sync validates real records and returns useful prerequisite errors',()=>{const c=directoryCommand();assert.ok(c.command.length<8000);assert.match(c.script,/Get-ADUser/);assert.doesNotMatch(c.script,/Set-AD|New-AD|Remove-AD/);const output=v=>c.marker+JSON.stringify(v)+c.marker;assert.equal(parseDirectory(output(directoryFixture),c.marker).users.length,2);assert.throws(()=>parseDirectory(output({ok:false,code:'missing-tools'}),c.marker),/RSAT/);assert.throws(()=>parseDirectory(output({...directoryFixture,users:[directoryFixture.users[0],directoryFixture.users[0]]}),c.marker),/duplicate/);assert.throws(()=>parseDirectory(output({...directoryFixture,users:[{...directoryFixture.users[0],enabled:'true'}]}),c.marker),/account state/);assert.throws(()=>parseDirectory(output({...directoryFixture,groups:[{...directoryFixture.groups[0],memberCount:4}]}),c.marker),/membership/);assert.throws(()=>parseDirectory('not-json',c.marker),/not confirmed/);});
