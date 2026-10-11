import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {networkRange,networkScanCommand,parseNetworkScan} from '../lib/network-scan.js';
test('network scans stay bounded to private IPv4 LANs and validate observed devices',()=>{
 const range=networkRange('192.168.1.37/24');assert.equal(range.cidr,'192.168.1.0/24');assert.equal(range.count,254);
 assert.equal(networkRange('10.1.2.3/32').count,1);assert.equal(networkRange('172.16.0.0/31').count,2);
 for(const bad of ['192.168.1.0/16','8.8.8.0/24','127.0.0.1/32','169.254.1.0/24','172.32.0.0/24','192.168.1.999/24','192.168.1.0/24;whoami','192.168.1.0/24/32'])assert.throws(()=>networkRange(bad));
 const command=networkScanCommand(range);assert.ok(command.command.length<8000);assert.match(command.script,/SkyBaseNetworkScan.*Local/s);assert.match(command.script,/MaxDegreeOfParallelism=16/);
 const launcher=Buffer.from(command.command.split(' ').at(-1),'base64').toString('utf16le');const payload=launcher.match(/FromBase64String\('([^']+)'\)/)[1];assert.equal(gunzipSync(Buffer.from(payload,'base64')).toString('utf8'),command.script);
 const device={ip:'192.168.1.10',ports:[443,443],ping:true,latency:3,mac:'02-11-22-33-44-55',hostname:'PC',scanner:false,responding:true};
 const output=v=>command.marker+JSON.stringify(v)+command.marker;
 const valid={ok:true,scanned:254,devices:[device]};const parsed=parseNetworkScan(output(valid),command.marker,range);assert.deepEqual(parsed[0].ports,[443]);assert.equal(parsed[0].mac,'02:11:22:33:44:55');
 for(const bad of [{...valid,devices:[{...device,ip:'192.168.2.1'}]},{...valid,devices:[{...device,ports:[12345]}]},{...valid,devices:[device,device]},{...valid,scanned:100},{ok:false,code:'not-local'}])assert.throws(()=>parseNetworkScan(output(bad),command.marker,range));
});
