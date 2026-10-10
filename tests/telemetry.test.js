import {test} from 'node:test';
import assert from 'node:assert/strict';
import {telemetryCommand,parseTelemetry} from '../lib/telemetry.js';
test('Windows telemetry parses measured usage and rejects missing or impossible readings',()=>{
 const {marker,script,command}=telemetryCommand();
 assert.match(command,/^powershell.exe -NoProfile -NonInteractive -EncodedCommand /);
 assert.equal(Buffer.from(command.split(' ').at(-1),'base64').toString('utf16le'),script);
 const reading={ok:true,cpu:42,memoryTotal:16000,memoryFree:4000,diskTotal:100000,diskFree:45000,diskName:'C:'};
 const output=value=>script+'\n'+marker+JSON.stringify(value)+marker;
 const result=parseTelemetry(output(reading),marker);assert.equal(result.cpu,42);assert.equal(result.memory,75);assert.equal(result.disk,55);
 for(const invalid of [{...reading,cpu:null},{...reading,cpu:101},{...reading,memoryFree:20000},{...reading,diskTotal:0},{ok:false}])assert.throws(()=>parseTelemetry(output(invalid),marker));
 assert.throws(()=>parseTelemetry('OK',marker));
});
