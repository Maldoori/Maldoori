import {randomBytes} from 'node:crypto';
export function patchNotice(patch,windowText){
 if(typeof windowText!=='string'||windowText.trim().length<3||windowText.length>120||/[\x00-\x1f\x7f]/.test(windowText))throw Object.assign(new Error('Enter a maintenance window (3–120 characters).'),{status:400});
 return `SkyBase IT Solutions: Planned update: ${patch.title}. Maintenance window: ${windowText.trim()}. ${patch.reboot_required?'A restart is expected after installation (per the planned update). Please save your work.':'No restart is planned (per the update catalog); IT will advise if this changes.'} This is an advance notice, not confirmation that installation has started. Contact your IT support with questions.`;
}
export function notificationCommand(message){
 const marker='MALDOORI_'+randomBytes(12).toString('hex');
 const data=Buffer.from(message,'utf8').toString('base64');
 const script=`$ErrorActionPreference='Stop';try{
$notice=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}'));
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SkyBaseNotice {
 [StructLayout(LayoutKind.Sequential)] public struct Session {public int Id;public IntPtr Name;public int State;}
 [DllImport("wtsapi32.dll", EntryPoint="WTSEnumerateSessionsW",SetLastError=true)] static extern bool Sessions(IntPtr server,int reserved,int version,out IntPtr list,out int count);
 [DllImport("wtsapi32.dll", EntryPoint="WTSQuerySessionInformationW",SetLastError=true)] static extern bool User(IntPtr server,int id,int kind,out IntPtr value,out int bytes);
 [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
 [DllImport("wtsapi32.dll",EntryPoint="WTSSendMessageW",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Send(IntPtr server,int id,string title,int titleBytes,string text,int textBytes,int style,int timeout,out int response,bool wait);
 public static string Notify(string text) {
  IntPtr list;int count;if(!Sessions(IntPtr.Zero,0,1,out list,out count))return Marshal.GetLastWin32Error()==5?"permissions":"session-query";
  int sent=0,failed=0,active=0;bool denied=false;
  try{int size=Marshal.SizeOf(typeof(Session));for(int i=0;i<count;i++){
   Session session=(Session)Marshal.PtrToStructure(IntPtr.Add(list,i*size),typeof(Session));if(session.Id==0||session.State!=0)continue;
   IntPtr user;int bytes;if(!User(IntPtr.Zero,session.Id,5,out user,out bytes)){failed++;continue;}
   bool signedIn;try{signedIn=!String.IsNullOrEmpty(Marshal.PtrToStringUni(user));}finally{WTSFreeMemory(user);}if(!signedIn)continue;
   active++;int response;string title="SkyBase IT Solutions - Planned maintenance";
   if(Send(IntPtr.Zero,session.Id,title,title.Length*2,text,text.Length*2,64,120,out response,false))sent++;else{failed++;if(Marshal.GetLastWin32Error()==5)denied=true;}
  }}finally{WTSFreeMemory(list);}
  if(sent>0)return failed>0?"partial":"accepted";
  return denied?"permissions":failed>0?"send-failed":active==0?"no-session":"send-failed";
 }
}
'@;
$code=[SkyBaseNotice]::Notify($notice);$result=@{ok=($code -eq 'accepted' -or $code -eq 'partial');code=$code};
}catch{$result=@{ok=$false;code='command-failed'}};
Write-Output ('${marker}'+($result|ConvertTo-Json -Compress)+'${marker}')`;

 return {marker,script,command:'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')};
}
export function notificationAccepted(output,marker){
 const fail=message=>{throw Object.assign(new Error(message),{status:502});};
 if(typeof output!=='string'||output.length>65536)fail('Windows returned an invalid notification response.');
 const start=output.indexOf(marker+'{'),end=output.indexOf(marker,start+marker.length);let value;
 try{if(start<0||end<0)throw new Error();value=JSON.parse(output.slice(start+marker.length,end));}catch{fail('Windows notification completion was not confirmed. Check the computer before retrying.');}
 const reasons={'no-session':'No active signed-in Windows user was found. Sign in locally or through Remote Desktop, then try again.',permissions:'Windows denied notification access. Check that Mesh Agent runs as Local System and has permission to message user sessions.','session-query':'Windows user sessions could not be read. Check the Mesh Agent service account.','send-failed':'Windows could not send the notification to the user session. Check the signed-in session and agent permissions.','command-failed':'Windows could not run the notification helper. Check PowerShell restrictions and security software alerts.'};
 if(value.ok!==true)fail(reasons[value.code]||'Windows could not send the message. Check for a signed-in user and messaging permissions.');
 return {accepted:true,partial:value.code==='partial'};
}
