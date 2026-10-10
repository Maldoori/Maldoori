import {randomBytes} from 'node:crypto';
export function telemetryCommand(){
  const marker='MALDOORI_'+randomBytes(12).toString('hex');
  return {marker,script:`$ErrorActionPreference='Stop';try {
    $cpu=Get-CimInstance Win32_Processor -ErrorAction Stop | Measure-Object LoadPercentage -Average;
    $os=Get-CimInstance Win32_OperatingSystem -ErrorAction Stop;
    $disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'" -ErrorAction Stop;
    $result=@{ok=$true;cpu=$cpu.Average;memoryTotal=[double]$os.TotalVisibleMemorySize*1024;memoryFree=[double]$os.FreePhysicalMemory*1024;diskTotal=[double]$disk.Size;diskFree=[double]$disk.FreeSpace;diskName=$env:SystemDrive};
  }catch{$result=@{ok=$false}};Write-Output ('${marker}'+($result | ConvertTo-Json -Compress)+'${marker}')`};
}
export function parseTelemetry(output,marker){
  if(typeof output!=='string'||output.length>65536)throw new Error('MeshCentral returned invalid computer metrics.');
  const start=output.indexOf(marker+'{'),end=output.indexOf(marker,start+marker.length);
  if(start<0||end<0)throw new Error('MeshCentral did not return completed computer metrics.');
  let value;try{value=JSON.parse(output.slice(start+marker.length,end));}catch{throw new Error('MeshCentral returned unreadable computer metrics.');}
  if(value.ok!==true)throw new Error('MeshCentral could not read Windows computer metrics.');
  const {cpu,memoryTotal,memoryFree,diskTotal,diskFree,diskName}=value;
  if(![cpu,memoryTotal,memoryFree,diskTotal,diskFree].every(Number.isFinite)||cpu<0||cpu>100||memoryTotal<=0||memoryFree<0||memoryFree>memoryTotal||diskTotal<=0||diskFree<0||diskFree>diskTotal||!/^\w:$/.test(diskName))throw new Error('MeshCentral returned incomplete computer metrics.');
  return {cpu:Math.round(cpu),memory:Math.round(100*(1-memoryFree/memoryTotal)),disk:Math.round(100*(1-diskFree/diskTotal)),memoryTotal,diskTotal,diskName};
}
