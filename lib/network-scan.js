import {randomBytes} from 'node:crypto';
import {gzipSync} from 'node:zlib';
export const scanPorts=[22,80,135,139,443,445,515,631,3389,5060,9100];
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
function number(ip){const a=ip.split('.');if(a.length!==4||a.some(v=>!/^\d{1,3}$/.test(v)||Number(v)>255))invalid('Enter a valid IPv4 subnet.');return a.reduce((n,v)=>n*256+Number(v),0);}
function address(n){return [24,16,8,0].map(b=>Math.floor(n/2**b)%256).join('.');}
export function networkRange(value){
 if(typeof value!=='string'||value.length>32)invalid('Enter an IPv4 CIDR, such as 192.168.1.0/24.');
 const [ip,prefix,...extra]=value.trim().split('/');if(extra.length||!/^\d{1,2}$/.test(prefix||''))invalid('Enter an IPv4 CIDR.');
 const p=Number(prefix);if(p<24||p>32)invalid('Use /24 through /32 (at most 254 usable addresses per scan).');
 const n=number(ip),size=2**(32-p),base=Math.floor(n/size)*size,last=base+size-1;
 const privateIp=x=>Math.floor(x/2**24)===10||(x>=number('172.16.0.0')&&x<=number('172.31.255.255'))||(x>=number('192.168.0.0')&&x<=number('192.168.255.255'));
 if(!privateIp(base)||!privateIp(last))invalid('Use a private customer LAN: 10.x.x.x, 172.16–31.x.x, or 192.168.x.x.');
 return {cidr:address(base)+'/'+p,start:p<=30?base+1:base,end:p<=30?last-1:last,count:p<=30?size-2:size,base,last};
}
export function networkScanCommand(range){
 const marker='MALDOORI_'+randomBytes(12).toString('hex');
 const script=`$ErrorActionPreference='Stop';try {
Add-Type -TypeDefinition @'
using System;using System.Linq;using System.Net;using System.Net.NetworkInformation;using System.Net.Sockets;using System.Collections.Generic;using System.Collections.Concurrent;using System.Threading.Tasks;
public class SkyBaseHost {public string ip;public int[] ports;public bool ping;public long? latency;public bool scanner;}
public static class SkyBaseNetworkScan {
 static uint Num(IPAddress ip){byte[] b=ip.GetAddressBytes();return ((uint)b[0]<<24)|((uint)b[1]<<16)|((uint)b[2]<<8)|b[3];}
 static string IP(uint n){return String.Format("{0}.{1}.{2}.{3}",(n>>24)&255,(n>>16)&255,(n>>8)&255,n&255);}
 public static bool Local(uint start,uint end){foreach(var nic in NetworkInterface.GetAllNetworkInterfaces()){if(nic.OperationalStatus!=OperationalStatus.Up)continue;foreach(var u in nic.GetIPProperties().UnicastAddresses){if(u.Address.AddressFamily!=AddressFamily.InterNetwork||u.IPv4Mask==null)continue;uint n=Num(u.Address),mask=Num(u.IPv4Mask);if(start>=(n&mask)&&end<=((n&mask)|~mask))return true;}}return false;}
 public static SkyBaseHost[] Scan(uint start,uint end){var found=new ConcurrentBag<SkyBaseHost>();var ips=new List<uint>();for(uint i=start;i<=end;i++)ips.Add(i);var local=new HashSet<string>(NetworkInterface.GetAllNetworkInterfaces().SelectMany(n=>n.GetIPProperties().UnicastAddresses).Where(u=>u.Address.AddressFamily==AddressFamily.InterNetwork).Select(u=>u.Address.ToString()));
 Parallel.ForEach(ips,new ParallelOptions{MaxDegreeOfParallelism=16},n=>{string ip=IP(n);bool alive=false;long? latency=null;try{using(var p=new Ping()){var r=p.Send(ip,180);alive=r.Status==IPStatus.Success;if(alive)latency=r.RoundtripTime;}}catch{}var ports=new List<int>();foreach(int port in new int[]{${scanPorts.join(',')}}){try{using(var c=new TcpClient()){var ar=c.BeginConnect(ip,port,null,null);try{if(ar.AsyncWaitHandle.WaitOne(150)){c.EndConnect(ar);if(c.Connected)ports.Add(port);}}finally{ar.AsyncWaitHandle.Close();}}}catch{}}
 if(alive||ports.Count>0)found.Add(new SkyBaseHost{ip=ip,ports=ports.ToArray(),ping=alive,latency=latency,scanner=local.Contains(ip)});});return found.ToArray();}
}
'@ -ReferencedAssemblies 'System.dll','System.Core.dll';
if(-not [SkyBaseNetworkScan]::Local([uint32]${range.base},[uint32]${range.last})){$result=@{ok=$false;code='not-local'}}else{
$hosts=@([SkyBaseNetworkScan]::Scan([uint32]${range.start},[uint32]${range.end}));
$neighbors=@(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue);$rows=@();
foreach($h in $hosts){$neighbor=$neighbors|Where-Object {$_.IPAddress -eq $h.ip -and $_.LinkLayerAddress -match '^[0-9A-Fa-f:-]{17}$'}|Select-Object -First 1;$mac=if($neighbor){$neighbor.LinkLayerAddress}else{''};$name=if($h.scanner){$env:COMPUTERNAME}else{''};$rows+=@{ip=$h.ip;ports=@($h.ports);ping=$h.ping;latency=$h.latency;mac=$mac;hostname=$name;scanner=$h.scanner;responding=$true}}
foreach($neighbor in $neighbors){try{$bytes=[Net.IPAddress]::Parse($neighbor.IPAddress).GetAddressBytes();$n=([uint64]$bytes[0]*16777216)+([uint64]$bytes[1]*65536)+([uint64]$bytes[2]*256)+$bytes[3];if($n -ge ${range.start} -and $n -le ${range.end} -and $neighbor.State -in @('Reachable','Stale') -and $neighbor.LinkLayerAddress -match '^[0-9A-Fa-f:-]{17}$' -and -not ($rows|Where-Object {$_.ip -eq $neighbor.IPAddress})){$rows+=@{ip=$neighbor.IPAddress;ports=@();ping=$false;latency=$null;mac=$neighbor.LinkLayerAddress;hostname='';scanner=$false;responding=$false}}}catch{}}
$result=@{ok=$true;devices=@($rows);scanned=${range.count}};
}}catch{$result=@{ok=$false;code='helper-failed'}};
Write-Output ('${marker}'+($result|ConvertTo-Json -Depth 5 -Compress)+'${marker}')`;
 const payload=gzipSync(Buffer.from(script,'utf8')).toString('base64');
 const launcher=`$m=[IO.MemoryStream]::new([Convert]::FromBase64String('${payload}'));$g=[IO.Compression.GZipStream]::new($m,[IO.Compression.CompressionMode]::Decompress);$r=[IO.StreamReader]::new($g);Invoke-Expression $r.ReadToEnd();$r.Dispose();$g.Dispose();$m.Dispose()`;
 const command='powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(launcher,'utf16le').toString('base64');
 if(command.length>8000)throw new Error('Network scan command exceeds the Windows command limit.');
 return {marker,script,command};
}
export function parseNetworkScan(output,marker,range){
 const fail=message=>{throw Object.assign(new Error(message),{status:502});};
 if(typeof output!=='string'||output.length>262144)fail('Windows returned an invalid network scan response.');
 const start=output.indexOf(marker+'{'),end=output.indexOf(marker,start+marker.length);let value;
 try{if(start<0||end<0)throw new Error();value=JSON.parse(output.slice(start+marker.length,end));}catch{fail('Windows network scan completion was not confirmed.');}
 if(!value.ok)fail(value.code==='not-local'?'The requested subnet is not on a connected adapter of the scan agent. Choose a computer on that network.':'Windows could not run the network scan. Check PowerShell restrictions, agent permissions, and security software alerts.');
 if(!Array.isArray(value.devices)||value.devices.length>range.count||value.scanned!==range.count)fail('Windows returned an incomplete network scan response.');
 const seen=new Set();return value.devices.map(d=>{let n;try{n=number(d.ip);}catch{fail('Invalid discovered IP address.');}
 if(n<range.start||n>range.end||seen.has(d.ip)||!Array.isArray(d.ports)||d.ports.some(p=>!scanPorts.includes(p))||typeof d.responding!=='boolean'||typeof d.scanner!=='boolean'||typeof d.ping!=='boolean'||(d.latency!==null&&(!Number.isFinite(d.latency)||d.latency<0||d.latency>60000)))fail('Invalid discovered device data.');seen.add(d.ip);
 return {ip:d.ip,ports:[...new Set(d.ports)].sort((a,b)=>a-b),ping:d.ping,latency:d.latency,mac:typeof d.mac==='string'&&/^(?!00[:-]00[:-]00[:-]00[:-]00[:-]00$)(?!FF[:-]FF[:-]FF[:-]FF[:-]FF[:-]FF$)[0-9a-f]{2}([:-][0-9a-f]{2}){5}$/i.test(d.mac)?d.mac.toUpperCase().replaceAll('-',':'):'',hostname:typeof d.hostname==='string'?d.hostname.slice(0,120):'',scanner:d.scanner,responding:d.responding};});
}
