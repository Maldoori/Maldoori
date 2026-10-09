import {randomBytes} from 'node:crypto';

const protectedNames = /^(mesh.*|rpcss|rpceptmapper|dcomlaunch|lsm|samss|winDefend|mpssvc|securityhealthservice|eventlog)$/i;
export function serviceCommand(action = 'list', name = '') {
  if (!['list','start','stop','restart'].includes(action)) throw Object.assign(new Error('Unknown service action.'),{status:400});
  if (action !== 'list' && !/^[A-Za-z0-9_.@$ -]{1,128}$/.test(name)) throw Object.assign(new Error('Invalid Windows service name.'),{status:400});
  if (action !== 'list' && protectedNames.test(name)) throw Object.assign(new Error('This management or core Windows service is protected from dashboard changes.'),{status:403});
  const marker = 'MALDOORI_' + randomBytes(12).toString('hex');
  const query = `@(Get-CimInstance Win32_Service -ErrorAction Stop | Sort-Object DisplayName | Select-Object Name,DisplayName,State,StartMode,ProcessId)`;
  const command = action === 'list' ? `$result=@{ok=$true;services=${query}}` : `
    $service=Get-Service -Name '${name}' -ErrorAction Stop;
    ${action === 'start' ? 'Start' : action === 'stop' ? 'Stop' : 'Restart'}-Service -InputObject $service -ErrorAction Stop;
    $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::${action === 'stop' ? 'Stopped' : 'Running'},[TimeSpan]::FromSeconds(15));
    $result=@{ok=$true;services=${query}};`;
  return {
    marker,
    script:`$ErrorActionPreference='Stop'; try { ${command} } catch { $result=@{ok=$false} }; Write-Output ('${marker}'+($result | ConvertTo-Json -Compress -Depth 4)+'${marker}')`
  };
}
export function parseServiceOutput(output, marker) {
  if (typeof output !== 'string' || output.length > 2 * 1024 * 1024) throw new Error('MeshCentral returned invalid Windows service output.');
  // Ignore an echoed PowerShell command containing quoted marker literals.
  const start = output.indexOf(marker + '{'), end = output.indexOf(marker, start + marker.length);
  if (start < 0 || end < 0) throw new Error('MeshCentral did not return a completed Windows service result.');
  let value;
  try { value = JSON.parse(output.slice(start + marker.length, end)); }
  catch { throw new Error('MeshCentral returned unreadable Windows service output.'); }
  if (!value.ok) throw Object.assign(new Error('Windows could not complete the service operation. Check service permissions, dependencies, or its startup configuration.'),{status:422});
  if (!Array.isArray(value.services)) throw new Error('MeshCentral returned an unexpected Windows service list.');
  return value.services.map(s=>({name:String(s.Name||''),displayName:String(s.DisplayName||s.Name||''),state:String(s.State||'Unknown'),startMode:String(s.StartMode||'Unknown'),processId:Number(s.ProcessId)||0,protected:protectedNames.test(String(s.Name||''))}));
}
