import {randomBytes} from 'node:crypto';
export function directoryCommand(){
 const marker='MALDOORI_'+randomBytes(12).toString('hex');
 const script=`$ErrorActionPreference='Stop';try {
if(-not (Get-Module -ListAvailable ActiveDirectory)){$result=@{ok=$false;code='missing-tools'}}else{
Import-Module ActiveDirectory;
$domain=Get-ADDomain;$server=$domain.PDCEmulator;
$users=@(Get-ADUser -Server $server -Filter * -ResultSetSize 5001 -Properties DisplayName,mail,Department,Title,Enabled | ForEach-Object {@{id=$_.ObjectGUID.ToString();name=if($_.DisplayName){$_.DisplayName}else{$_.Name};username=$_.SamAccountName;email=[string]$_.mail;department=[string]$_.Department;title=[string]$_.Title;dn=$_.DistinguishedName;enabled=[bool]$_.Enabled}});
$groups=@(Get-ADGroup -Server $server -Filter * -ResultSetSize 2001 -Properties Description,member | ForEach-Object {@{id=$_.ObjectGUID.ToString();name=$_.Name;dn=$_.DistinguishedName;description=[string]$_.Description;scope=$_.GroupScope.ToString();category=$_.GroupCategory.ToString();members=@($_.member);memberCount=@($_.member).Count}});
$ous=@(Get-ADOrganizationalUnit -Server $server -Filter * -ResultSetSize 2001 -Properties Description | ForEach-Object {@{id=$_.ObjectGUID.ToString();name=$_.Name;dn=$_.DistinguishedName;description=[string]$_.Description}});
if($users.Count -gt 5000 -or $groups.Count -gt 2000 -or $ous.Count -gt 2000){$result=@{ok=$false;code='too-large'}}else{$result=@{ok=$true;domain=$domain.DNSRoot;server=$server;users=$users;groups=$groups;ous=$ous}}
}}catch{$result=@{ok=$false;code='query-failed'}};
Write-Output ('${marker}'+($result|ConvertTo-Json -Depth 6 -Compress)+'${marker}')`;
 return {marker,script,command:'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')};
}
export function parseDirectory(output,marker){
 const fail=message=>{throw Object.assign(new Error(message),{status:502});};
 if(typeof output!=='string'||output.length>6*1024*1024)fail('Active Directory returned an oversized or invalid response.');
 const start=output.indexOf(marker+'{'),end=output.indexOf(marker,start+marker.length);let value;try{if(start<0||end<0)throw Error();value=JSON.parse(output.slice(start+marker.length,end));}catch{fail('Active Directory sync completion was not confirmed.');}
 if(value.ok!==true)fail(({ 'missing-tools':'Install the Active Directory PowerShell tools (RSAT) on the selected agent, or choose your Domain Controller.', 'too-large':'This directory exceeds the supported limit of 5,000 users or 2,000 groups/OUs. No partial snapshot was saved.', 'query-failed':'Active Directory query failed. Check domain connectivity, AD Web Services, and the MeshCentral agent service account’s directory read permissions.' })[value.code]||'Active Directory sync failed. Check the agent and PowerShell permissions.');
 const string=(v,max=2048)=>{if(typeof v!=='string'||v.length>max)fail('Invalid Active Directory field.');return v;};
 const rows=(items,max,kind)=>{if(!Array.isArray(items)||items.length>max)fail('Invalid Active Directory collection.');const seen=new Set();return items.map(v=>{if(!v||typeof v!=='object')fail('Invalid Active Directory record.');const id=string(v.id,36);if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)||seen.has(id))fail('Invalid or duplicate Active Directory ID.');seen.add(id);const row={id,name:string(v.name,256),dn:string(v.dn)};
 if(kind==='users'){if(typeof v.enabled!=='boolean')fail('Invalid account state.');for(const k of ['username','email','department','title'])row[k]=string(v[k],512);row.enabled=v.enabled;}
 else{row.description=string(v.description);if(kind==='groups'){row.scope=string(v.scope,32);row.category=string(v.category,32);if(!Array.isArray(v.members)||v.members.length>50000||v.memberCount!==v.members.length)fail('Invalid group membership.');row.members=v.members.map(m=>string(m));row.memberCount=v.memberCount;}}return row;});};
 return {domain:string(value.domain,255),server:string(value.server,255),users:rows(value.users,5000,'users'),groups:rows(value.groups,2000,'groups'),ous:rows(value.ous,2000,'ous')};
}
