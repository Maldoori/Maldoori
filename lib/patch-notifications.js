import {randomBytes} from 'node:crypto';
export function patchNotice(patch,windowText){
 if(typeof windowText!=='string'||windowText.trim().length<3||windowText.length>120||/[\x00-\x1f\x7f]/.test(windowText))throw Object.assign(new Error('Enter a maintenance window (3–120 characters).'),{status:400});
 return `SkyBase IT Solutions: Planned update: ${patch.title}. Maintenance window: ${windowText.trim()}. ${patch.reboot_required?'A restart is expected after installation (per the planned update). Please save your work.':'No restart is planned (per the update catalog); IT will advise if this changes.'} This is an advance notice, not confirmation that installation has started. Contact your IT support with questions.`;
}
export function notificationCommand(message){
 const marker='MALDOORI_'+randomBytes(12).toString('hex');
 const data=Buffer.from(message,'utf8').toString('base64');
 const script=`$ErrorActionPreference='Stop';try{$notice=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')); & "$env:SystemRoot\\System32\\msg.exe" '*' '/TIME:120' $notice; $result=@{ok=($LASTEXITCODE -eq 0)}}catch{$result=@{ok=$false}};Write-Output ('${marker}'+($result|ConvertTo-Json -Compress)+'${marker}')`;
 return {marker,script,command:'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')};
}
export function notificationAccepted(output,marker){
 if(typeof output!=='string'||output.length>65536)throw new Error('Invalid notification response.');
 const start=output.indexOf(marker+'{'),end=output.indexOf(marker,start+marker.length);let value;
 try{if(start<0||end<0)throw new Error();value=JSON.parse(output.slice(start+marker.length,end));}catch{throw new Error('Windows notification completion was not confirmed.');}
 if(value.ok!==true)throw new Error('Windows could not send the message. Check for a signed-in user and messaging permissions.');
 return true;
}
