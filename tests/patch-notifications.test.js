import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchNotice,notificationCommand,notificationAccepted} from '../lib/patch-notifications.js';
test('patch notices report planning and declared restart requirements without executing message text',()=>{
 const title="KB123'; Remove-Item C:\\ -Recurse; '";
 const message=patchNotice({title,reboot_required:1},'Tomorrow 6 PM Central');
 assert.match(message,/restart is expected/);assert.match(message,/not confirmation that installation has started/);
 assert.match(patchNotice({title:'KB123',reboot_required:0},'Tomorrow 6 PM Central'),/No restart is planned/);
 assert.throws(()=>patchNotice({title},'bad\nwindow'));
 const command=notificationCommand(message);assert.equal(command.script.includes(title),false);
 assert.match(command.script,/WTSSendMessageW/);assert.doesNotMatch(command.script,/Restart-Computer|Install-WindowsUpdate/);
 assert.equal(Buffer.from(command.command.split(' ').at(-1),'base64').toString('utf16le'),command.script);
 assert.deepEqual(notificationAccepted(command.marker+'{"ok":true,"code":"accepted"}'+command.marker,command.marker),{accepted:true,partial:false});
 assert.deepEqual(notificationAccepted(command.marker+'{"ok":true,"code":"partial"}'+command.marker,command.marker),{accepted:true,partial:true});
 assert.throws(()=>notificationAccepted(command.marker+'{"ok":false,"code":"no-session"}'+command.marker,command.marker),/No active signed-in/);
 assert.throws(()=>notificationAccepted(command.marker+'{"ok":false,"code":"permissions"}'+command.marker,command.marker),/denied notification access/);
 assert.throws(()=>notificationAccepted(command.marker+'{"ok":false}'+command.marker,command.marker));
 assert.throws(()=>notificationAccepted('OK',command.marker));
});
