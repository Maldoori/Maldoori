import http from 'node:http';
import {directoryCommand,parseDirectory} from './lib/active-directory.js';
import {networkRange,networkScanCommand,parseNetworkScan} from './lib/network-scan.js';
import {patchNotice,notificationCommand,notificationAccepted} from './lib/patch-notifications.js';
import {initializePatches,savePatch} from './lib/patches.js';
import { readFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {telemetryCommand,parseTelemetry} from './lib/telemetry.js';
import {AcronisClient} from './lib/acronis.js';
import { MeshClient } from './lib/mesh.js';
import {initializeCatalog,ensureDefaultGroup,catalog,addLocation,contactDetails} from './lib/catalog.js';
import {serviceCommand,parseServiceOutput} from './lib/services.js';

const root = import.meta.dirname;
let credentials = {};
if (process.env.CREDENTIALS_FILE) {
  const metadata = await stat(process.env.CREDENTIALS_FILE);
  if (!metadata.isFile() || (metadata.mode & 0o077)) throw new Error('Credentials file must be a regular file with owner-only permissions (chmod 600).');
  try { credentials = JSON.parse(await readFile(process.env.CREDENTIALS_FILE, 'utf8')); }
  catch { throw new Error('Cannot read credentials file as JSON.'); }
  if (!credentials || typeof credentials !== 'object' || Array.isArray(credentials)) throw new Error('Invalid credentials file format.');
}
const setting = name => process.env[name] ?? credentials[name];
const publicUrl = new URL(setting('PUBLIC_URL') || 'http://127.0.0.1:3001');
if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && ['localhost','127.0.0.1'].includes(publicUrl.hostname))) throw new Error('PUBLIC_URL must use HTTPS except for local development.');
const username = setting('RMM_USERNAME') || 'admin';
if (typeof setting('RMM_PASSWORD') !== 'string' || setting('RMM_PASSWORD').length < 16) throw new Error('Set RMM_PASSWORD to a unique password of at least 16 characters.');
const salt = randomBytes(32), passwordHash = scryptSync(setting('RMM_PASSWORD'), salt, 64);
const mesh = new MeshClient({ url: setting('MESH_URL'), username: setting('MESH_USERNAME'), password: setting('MESH_PASSWORD') });
const acronis=new AcronisClient({url:setting('ACRONIS_URL'),clientId:setting('ACRONIS_CLIENT_ID'),secret:setting('ACRONIS_CLIENT_SECRET')});
let acronisConnection={configured:acronis.configured,authenticated:false,backupStatusVerified:false};
const dataDir = resolve(process.env.DATA_DIR || resolve(root, 'data'));
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(resolve(dataDir, 'rmm.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL);');
initializeCatalog(db);
db.exec('CREATE TABLE IF NOT EXISTS known_devices(id TEXT PRIMARY KEY, group_id TEXT NOT NULL, details TEXT NOT NULL)');
db.exec('CREATE TABLE IF NOT EXISTS device_preferences(id TEXT PRIMARY KEY,name TEXT,hidden INTEGER NOT NULL DEFAULT 0)');
const telemetryCache=new Map(),telemetryBusy=new Map();
db.exec('CREATE TABLE IF NOT EXISTS acronis_links(node_id TEXT PRIMARY KEY,resource_id TEXT NOT NULL UNIQUE,tenant_id TEXT NOT NULL)');
db.exec("CREATE TABLE IF NOT EXISTS backup_preferences(company_id TEXT PRIMARY KEY REFERENCES companies(id),provider TEXT NOT NULL CHECK(provider IN ('acronis','comet','msp360'))); CREATE TABLE IF NOT EXISTS backup_settings(id TEXT PRIMARY KEY,value TEXT NOT NULL)");
// Extend the provider constraint without losing saved company selections.
if(!db.prepare("SELECT sql FROM sqlite_master WHERE name='backup_preferences'").get().sql.includes("'msp360'")){
  db.exec("BEGIN; CREATE TABLE backup_preferences_next(company_id TEXT PRIMARY KEY REFERENCES companies(id),provider TEXT NOT NULL CHECK(provider IN ('acronis','comet','msp360'))); INSERT INTO backup_preferences_next SELECT * FROM backup_preferences; DROP TABLE backup_preferences; ALTER TABLE backup_preferences_next RENAME TO backup_preferences; COMMIT;");
}
db.exec("CREATE TABLE IF NOT EXISTS security_preferences(company_id TEXT PRIMARY KEY REFERENCES companies(id),provider TEXT NOT NULL CHECK(provider IN ('bitdefender','defender','acronis'))); CREATE TABLE IF NOT EXISTS security_settings(provider TEXT PRIMARY KEY CHECK(provider IN ('bitdefender','defender','acronis')),console_url TEXT NOT NULL)");
initializePatches(db);
db.exec("CREATE TABLE IF NOT EXISTS patch_notifications(id INTEGER PRIMARY KEY,patch_id TEXT NOT NULL REFERENCES patches(id) ON DELETE CASCADE,node_id TEXT NOT NULL,message TEXT NOT NULL,at TEXT NOT NULL)");
const notificationBusy=new Set();
const networkBusy=new Set();
const directoryBusy=new Set();
db.exec("CREATE TABLE IF NOT EXISTS directory_syncs(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),node_id TEXT NOT NULL,source_name TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL,error TEXT NOT NULL)");
db.exec("UPDATE directory_syncs SET status='failed',error='Server restarted before sync completion. Sync again to retrieve a fresh snapshot.' WHERE status='running'");
db.exec("CREATE TABLE IF NOT EXISTS network_scans(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),location_id TEXT NOT NULL REFERENCES locations(id),node_id TEXT NOT NULL,source_name TEXT NOT NULL,source_os TEXT NOT NULL,cidr TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,result TEXT NOT NULL,error TEXT NOT NULL); CREATE TABLE IF NOT EXISTS network_labels(scan_id TEXT NOT NULL REFERENCES network_scans(id) ON DELETE CASCADE,ip TEXT NOT NULL,type TEXT NOT NULL,hostname TEXT NOT NULL,PRIMARY KEY(scan_id,ip))");
db.exec("UPDATE network_scans SET status='failed',error='Server restarted before scan completion. Check the agent before retrying.' WHERE status='running'");

db.exec("CREATE TABLE IF NOT EXISTS patch_notice_jobs(id TEXT PRIMARY KEY,patch_id TEXT NOT NULL REFERENCES patches(id) ON DELETE CASCADE,company_id TEXT NOT NULL REFERENCES companies(id),at TEXT NOT NULL,status TEXT NOT NULL); CREATE TABLE IF NOT EXISTS patch_notice_targets(job_id TEXT NOT NULL REFERENCES patch_notice_jobs(id) ON DELETE CASCADE,node_id TEXT NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL,PRIMARY KEY(job_id,node_id))");
// Do not resend notices after a restart: a previous delivery may have succeeded.
db.exec("UPDATE patch_notice_targets SET status='uncertain',detail='Server restarted before completion. Check delivery before retrying.' WHERE status IN ('queued','sending'); UPDATE patch_notice_jobs SET status='completed' WHERE status='running'");

let acronisInventory={resources:[],tasks:[],backupResults:[],checkedAt:null,error:null},acronisSync;
function syncAcronis(){
  if(acronisSync)return acronisSync;
  acronisSync=acronis.inventory().then(value=>{acronisInventory={...value,error:null};}).catch(error=>{acronisInventory.error=error.message;}).finally(()=>acronisSync=null);
  return acronisSync;
}
const serviceBusy = new Set();
async function sendPatchNotice(device,patch,notice){
 if(directoryBusy.has(device.id)||networkBusy.has(device.id)||notificationBusy.has(device.id)||telemetryBusy.has(device.id)||serviceBusy.has(device.id))throw Object.assign(new Error('A command is running on this computer. Wait before retrying.'),{status:409});
 notificationBusy.add(device.id);const command=notificationCommand(notice);audit('patch-notification-requested',device.id);
 try{const output=await mesh.request('runcommands',{nodeids:[device.id],type:1,cmds:command.command,reply:true,runAsUser:0},{output:true,notification:true});const acceptance=notificationAccepted(output.result,command.marker);
  const at=new Date().toISOString();db.prepare('INSERT INTO patch_notifications(patch_id,node_id,message,at) VALUES (?,?,?,?)').run(patch.id,device.id,notice,at);audit('patch-notification-accepted',device.id);return {...acceptance,userReadVerified:false,at};
 }finally{notificationBusy.delete(device.id);}
}
function startCompanyNotice(id,devices,patch,notice){
 const queue=devices.filter(d=>d.online);
 const worker=async()=>{while(queue.length){const device=queue.shift();db.prepare("UPDATE patch_notice_targets SET status='sending' WHERE job_id=? AND node_id=?").run(id,device.id);
  try{if(telemetryBusy.has(device.id))await telemetryBusy.get(device.id).catch(()=>{});const result=await sendPatchNotice(device,patch,notice);db.prepare('UPDATE patch_notice_targets SET status=?,detail=? WHERE job_id=? AND node_id=?').run(result.partial?'partial':'accepted',result.partial?'Windows accepted some sessions; other sessions failed.':'Windows accepted the notice; user reading is not verified.',id,device.id);}
  catch(error){const safe=error.status||error.message.startsWith('MeshCentral')||error.message.startsWith('Windows');db.prepare('UPDATE patch_notice_targets SET status=?,detail=? WHERE job_id=? AND node_id=?').run(error.message.includes('timed out')?'uncertain':'failed',safe?error.message:'Notification failed. Check agent permissions and security software.',id,device.id);}
 }};
 void Promise.all(Array.from({length:Math.min(3,queue.length)},worker)).then(()=>{db.prepare("UPDATE patch_notice_jobs SET status='completed' WHERE id=?").run(id);}).catch(()=>{db.prepare("UPDATE patch_notice_targets SET status='uncertain',detail='Notification job interrupted. Check delivery before retrying.' WHERE job_id=? AND status IN ('queued','sending')").run(id);db.prepare("UPDATE patch_notice_jobs SET status='completed' WHERE id=?").run(id);});
}
let companyBusy = false;
const sessions = new Map(), attempts = new Map();
const lifetime = 8 * 60 * 60 * 1000;
let snapshot = { groups: [], devices: [], lastSync: null, error: 'Waiting for first MeshCentral synchronization.' };
let syncing;
const audit = (action, target) => db.prepare('INSERT INTO audit(at,action,target) VALUES (?,?,?)').run(new Date().toISOString(), action, target);
function synchronize() {
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const [groups, nodes] = await Promise.all([mesh.request('meshes'), mesh.request('nodes')]);
      if (!Array.isArray(groups.meshes) || !nodes.nodes || typeof nodes.nodes !== 'object') throw new Error('Unexpected MeshCentral inventory response.');
      const mapped = catalog(db).deviceGroups;
      const groupMap = new Map(groups.meshes.map(g => [g._id, g]));
      const companyMap = new Map(mapped.map(g => [g.id, g]));
      const devices = Object.entries(nodes.nodes).flatMap(([groupId, items]) => {
        if (!Array.isArray(items)) throw new Error('Unexpected MeshCentral device list.');
        return items.filter(n => typeof n._id === 'string').map(n => ({
          id: n._id, name: n.name || 'Unnamed device', groupId,
          company: companyMap.get(groupId)?.company || groupMap.get(groupId)?.name || 'Unmapped group',
          companyId: companyMap.get(groupId)?.company_id || null,
          locationId: companyMap.get(groupId)?.location_id || null,
          location: companyMap.get(groupId)?.location || 'Unassigned',
          groupName: companyMap.get(groupId)?.name || groupMap.get(groupId)?.name || 'Unknown group',
          mapped: companyMap.has(groupId), os: n.osdesc || 'Not reported',
          windows: [1,2,3,4,42,43].includes(n.agent?.id) || /windows/i.test(n.osdesc || ''),
          online: Boolean((n.conn || 0) & 1), desktopUrl: mesh.desktopUrl(n._id)
        }));
      });
      // Keep discovered computers even when a successful inventory omits them.
      // Only expose retained records from groups the integration can still access.
      const seen=new Set(devices.map(d=>d.id));
      db.exec('BEGIN');
      try{
        const save=db.prepare('INSERT INTO known_devices(id,group_id,details) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET group_id=excluded.group_id,details=excluded.details');
        for(const device of devices)save.run(device.id,device.groupId,JSON.stringify(device));
        db.exec('COMMIT');
      }catch(error){db.exec('ROLLBACK');throw error;}
      for(const record of db.prepare('SELECT * FROM known_devices').all()){
        if(seen.has(record.id)||!groupMap.has(record.group_id))continue;
        const previous=JSON.parse(record.details),assignment=companyMap.get(record.group_id);
        devices.push({...previous,online:false,retained:true,
          company:assignment?.company||groupMap.get(record.group_id).name||'Unmapped group',
          companyId:assignment?.company_id||null,locationId:assignment?.location_id||null,
          location:assignment?.location||'Unassigned',groupName:assignment?.name||groupMap.get(record.group_id).name,
          mapped:Boolean(assignment)});
      }
      snapshot = { groups: groups.meshes.map(g => ({ id: g._id, name: g.name, type: g.mtype })), devices:devices.flatMap(device=>{const preference=db.prepare('SELECT * FROM device_preferences WHERE id=?').get(device.id);return preference?.hidden?[]:[{...device,agentName:device.name,name:preference?.name||device.name}];}), lastSync: new Date().toISOString(), error: null };
    } catch (error) { snapshot.error = error.message; }
  })().finally(() => syncing = null);
  return syncing;
}
await synchronize();
const poll = setInterval(synchronize, 30000); poll.unref();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) if (session.expires < now) sessions.delete(id);
  for (const [ip, entry] of attempts) if (entry.until < now) attempts.delete(ip);
}, 60000); cleanup.unref();
function session(req) {
  const id = /(?:^|;\s*)maldoori_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const value = sessions.get(id);
  return value && value.expires > Date.now() ? { id, ...value } : null;
}
function reply(res, status, value) { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw Object.assign(new Error('Use JSON request bodies.'), { status: 415 });
  let content = '';
  for await (const part of req) { content += part; if (Buffer.byteLength(content) > 16384) throw Object.assign(new Error('Request too large.'), { status: 413 }); }
  try { return JSON.parse(content); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
const cookie = (value, age) => `maldoori_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${publicUrl.protocol === 'https:' ? '; Secure' : ''}`;
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, publicUrl);
    if (req.method === 'POST' && req.headers.origin !== publicUrl.origin) return reply(res, 403, { error: 'Request origin rejected.' });
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress;
      const entry = attempts.get(ip);
      if (entry && entry.until > Date.now() && entry.count >= 5) return reply(res, 429, { error: 'Too many login attempts. Try again in 15 minutes.' });
      const input = await body(req);
      const supplied = scryptSync(typeof input.password === 'string' ? input.password : '', salt, 64);
      if (input.username !== username || !timingSafeEqual(supplied, passwordHash)) {
        attempts.set(ip, { count: (entry && entry.until > Date.now() ? entry.count : 0) + 1, until: entry && entry.until > Date.now() ? entry.until : Date.now() + 900000 });
        return reply(res, 401, { error: 'Invalid username or password.' });
      }
      attempts.delete(ip);
      const id = randomBytes(32).toString('hex'); sessions.set(id, { expires: Date.now() + lifetime });
      res.setHeader('Set-Cookie', cookie(id, lifetime / 1000));
      audit('login', username); return reply(res, 200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      const current = session(req);
      if (!current) return reply(res, 401, { error: 'Sign in to continue.' });
      if (req.method === 'POST' && url.pathname === '/api/logout') { sessions.delete(current.id); res.setHeader('Set-Cookie', cookie('', 0)); return reply(res, 200, { ok: true }); }
      if (req.method === 'GET' && url.pathname === '/api/inventory') return reply(res, 200, { ...snapshot, ...catalog(db) });
      if (req.method === 'POST' && url.pathname === '/api/sync') { await synchronize(); return reply(res, snapshot.error ? 502 : 200, snapshot.error ? { error: snapshot.error } : { ok:true }); }
      if(req.method==='POST' && url.pathname==='/api/telemetry'){
        const input=await body(req);await synchronize();
        if(snapshot.error)return reply(res,502,{error:snapshot.error});
        const device=snapshot.devices.find(d=>d.id===input.nodeId);
        if(!device)return reply(res,404,{error:'Computer not found.'});
        if(!device.online)return reply(res,409,{error:'Computer is offline.'});
        if(!device.windows)return reply(res,400,{error:'Metrics currently support Windows computers.'});
        if(directoryBusy.has(device.id)||networkBusy.has(device.id)||notificationBusy.has(device.id))return reply(res,409,{error:'A directory sync, network scan, or user notification is running on this computer.'});
        const cached=telemetryCache.get(device.id);
        if(cached&&Date.now()-Date.parse(cached.checkedAt)<30000)return reply(res,200,cached);
        if(!telemetryBusy.has(device.id)){
          if(telemetryBusy.size>=4)return reply(res,429,{error:'Metrics collection is busy. Try again shortly.'});
          const command=telemetryCommand();
          telemetryBusy.set(device.id,(async()=>{
            const output=await mesh.request('runcommands',{nodeids:[device.id],type:1,cmds:command.command,reply:true,runAsUser:0},{output:true,telemetry:true});
            const result={...parseTelemetry(output.result,command.marker),nodeId:device.id,checkedAt:new Date().toISOString()};telemetryCache.set(device.id,result);return result;
          })().finally(()=>telemetryBusy.delete(device.id)));
        }
        return reply(res,200,await telemetryBusy.get(device.id));
      }
      if(req.method==='POST' && ['/api/device-update','/api/device-delete'].includes(url.pathname)){
        const input=await body(req);await synchronize();
        if(snapshot.error)return reply(res,502,{error:snapshot.error});
        const device=snapshot.devices.find(d=>d.id===input.id);
        if(!device)return reply(res,404,{error:'Computer not found in your accessible inventory.'});
        if(url.pathname==='/api/device-update'){
          const name=typeof input.name==='string'?input.name.trim():'';
          if(!name||name.length>120)return reply(res,400,{error:'Enter a computer display name of 1–120 characters.'});
          db.prepare('INSERT INTO device_preferences(id,name,hidden) VALUES (?,?,0) ON CONFLICT(id) DO UPDATE SET name=excluded.name').run(device.id,name);
          audit('computer-renamed',device.id);
        }else{
          if(input.confirm!==true)return reply(res,400,{error:'Confirm removal of this computer from Maldoori.'});
          db.prepare('INSERT INTO device_preferences(id,hidden) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET hidden=1').run(device.id);
          audit('computer-removed',device.id);
        }
        await synchronize();return reply(res,200,{ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/active-directory'){
        const id=url.searchParams.get('id'),company=url.searchParams.get('companyId');
        const sync=id?db.prepare('SELECT * FROM directory_syncs WHERE id=?').get(id):db.prepare('SELECT * FROM directory_syncs WHERE company_id=? ORDER BY at DESC LIMIT 1').get(company||'');
        if(id&&!sync)return reply(res,404,{error:'Directory sync not found.'});
        return reply(res,200,sync?{...sync,result:JSON.parse(sync.result)}:{status:'empty',result:{users:[],groups:[],ous:[]}});
      }
      if(req.method==='POST' && url.pathname==='/api/active-directory-sync'){
        const input=await body(req);if(typeof input.companyId!=='string'||typeof input.nodeId!=='string')return reply(res,400,{error:'Choose a company and directory agent.'});
        if(db.prepare("SELECT id FROM directory_syncs WHERE status='running'").get())return reply(res,409,{error:'An Active Directory sync is already running.'});
        await synchronize();if(snapshot.error)return reply(res,502,{error:snapshot.error});
        const device=snapshot.devices.find(d=>d.id===input.nodeId&&d.companyId===input.companyId);
        if(!device)return reply(res,404,{error:'Choose an agent belonging to this company.'});
        if(!device.online||!device.windows)return reply(res,409,{error:'The directory agent must be an online Windows computer.'});
        if(directoryBusy.has(device.id)||networkBusy.has(device.id)||notificationBusy.has(device.id)||serviceBusy.has(device.id))return reply(res,409,{error:'A command is already running on this agent.'});
        const id=randomBytes(16).toString('hex'),command=directoryCommand();directoryBusy.add(device.id);
        db.prepare("INSERT INTO directory_syncs VALUES (?,?,?,?,?,'running','{}','')").run(id,input.companyId,device.id,device.name,new Date().toISOString());audit('active-directory-sync-started',input.companyId);
        void (async()=>{try{if(telemetryBusy.has(device.id))await telemetryBusy.get(device.id).catch(()=>{});const output=await mesh.request('runcommands',{nodeids:[device.id],type:1,cmds:command.command,reply:true,runAsUser:0},{output:true,directory:true});const result=parseDirectory(output.result,command.marker);db.prepare("UPDATE directory_syncs SET status='completed',result=? WHERE id=?").run(JSON.stringify(result),id);audit('active-directory-sync-completed',id);}catch(error){db.prepare("UPDATE directory_syncs SET status='failed',error=? WHERE id=?").run(error.status||error.message.startsWith('MeshCentral')||error.message.startsWith('Active Directory')?error.message:'Active Directory sync failed. Check the agent and security software alerts.',id);}finally{directoryBusy.delete(device.id);}})();
        return reply(res,202,{id,status:'running'});
      }
      if(req.method==='GET' && url.pathname==='/api/network-scans'){
        const requested=url.searchParams.get('id'),site=url.searchParams.get('locationId');
        const scan=requested?db.prepare('SELECT * FROM network_scans WHERE id=?').get(requested):site?db.prepare('SELECT * FROM network_scans WHERE location_id=? ORDER BY at DESC LIMIT 1').get(site):db.prepare('SELECT * FROM network_scans ORDER BY at DESC LIMIT 1').get();
        if(requested&&!scan)return reply(res,404,{error:'Network scan not found.'});
        return reply(res,200,scan?{...scan,result:JSON.parse(scan.result),labels:db.prepare('SELECT ip,type,hostname FROM network_labels WHERE scan_id=?').all(scan.id)}:{status:'empty',result:[],labels:[]});
      }
      if(req.method==='POST' && url.pathname==='/api/network-scan'){
        const input=await body(req),range=networkRange(input.cidr);if(typeof input.locationId!=='string'||typeof input.nodeId!=='string')return reply(res,400,{error:'Choose a customer site and scan agent.'});
        const site=db.prepare('SELECT * FROM locations WHERE id=?').get(input.locationId);if(!site)return reply(res,404,{error:'Site not found.'});
        if(db.prepare("SELECT id FROM network_scans WHERE status='running'").get())return reply(res,409,{error:'A network scan is already running. Wait for it to finish.'});
        await synchronize();if(snapshot.error)return reply(res,502,{error:snapshot.error});
        const device=snapshot.devices.find(d=>d.id===input.nodeId&&d.companyId===site.company_id&&d.locationId===site.id);if(!device)return reply(res,404,{error:'Choose an agent belonging to this customer site.'});
        if(!device.online||!device.windows)return reply(res,409,{error:'The scan agent must be an online Windows computer.'});
        if(directoryBusy.has(device.id)||networkBusy.has(device.id)||notificationBusy.has(device.id)||serviceBusy.has(device.id))return reply(res,409,{error:'A command is already running on the scan agent.'});
        const command=networkScanCommand(range),id=randomBytes(16).toString('hex');networkBusy.add(device.id);
        db.prepare("INSERT INTO network_scans VALUES (?,?,?,?,?,?,?,?, 'running','[]','')").run(id,site.company_id,site.id,device.id,device.name,device.os,range.cidr,new Date().toISOString());audit('network-scan-started',site.company_id+':'+range.cidr);
        void (async()=>{try{if(telemetryBusy.has(device.id))await telemetryBusy.get(device.id).catch(()=>{});const output=await mesh.request('runcommands',{nodeids:[device.id],type:1,cmds:command.command,reply:true,runAsUser:0},{output:true,scan:true});const devices=parseNetworkScan(output.result,command.marker,range);db.prepare("UPDATE network_scans SET status='completed',result=? WHERE id=?").run(JSON.stringify(devices),id);audit('network-scan-completed',id);}catch(error){const safe=error.status||error.message.startsWith('MeshCentral')||error.message.startsWith('Network scan');db.prepare("UPDATE network_scans SET status='failed',error=? WHERE id=?").run(safe?error.message:'Network scan failed. Check the Windows agent, permissions, and security software alerts.',id);}finally{networkBusy.delete(device.id);}})();
        return reply(res,202,{ok:true,id,cidr:range.cidr});
      }
      if(req.method==='POST' && url.pathname==='/api/network-label'){
        const input=await body(req);if(typeof input.scanId!=='string'||typeof input.ip!=='string')return reply(res,400,{error:'Choose a discovered device.'});const scan=db.prepare('SELECT * FROM network_scans WHERE id=?').get(input.scanId);if(!scan||scan.status!=='completed'||!JSON.parse(scan.result).some(d=>d.ip===input.ip))return reply(res,404,{error:'Discovered device not found.'});
        if(!['unknown','workstation','server','printer','phone','network'].includes(input.type)||typeof input.hostname!=='string'||input.hostname.length>120||/[\x00-\x1f]/.test(input.hostname))return reply(res,400,{error:'Enter a valid device label and type.'});
        db.prepare('INSERT INTO network_labels VALUES (?,?,?,?) ON CONFLICT(scan_id,ip) DO UPDATE SET type=excluded.type,hostname=excluded.hostname').run(scan.id,input.ip,input.type,input.hostname.trim());audit('network-device-labeled',scan.id+':'+input.ip);return reply(res,200,{ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/patches')return reply(res,200,{patches:db.prepare('SELECT * FROM patches ORDER BY title').all(),rollouts:db.prepare('SELECT * FROM patch_rollouts').all().filter(r=>snapshot.devices.some(d=>d.id===r.node_id)),deploymentConnected:false,jobs:db.prepare('SELECT * FROM patch_notice_jobs ORDER BY at DESC LIMIT 100').all(),notifications:db.prepare('SELECT patch_id,node_id,at FROM patch_notifications ORDER BY at DESC LIMIT 1000').all().filter(n=>snapshot.devices.some(d=>d.id===n.node_id))});
      if(req.method==='POST' && url.pathname==='/api/patch-save'){const input=await body(req);const id=savePatch(db,input);audit('patch-catalog-saved',id);return reply(res,200,{ok:true,id});}
      if(req.method==='POST' && url.pathname==='/api/patch-delete'){
        const input=await body(req);if(input.confirm!==true)return reply(res,400,{error:'Confirm removing this patch from the catalog.'});
        if(typeof input.id!=='string'||!db.prepare('SELECT id FROM patches WHERE id=?').get(input.id))return reply(res,404,{error:'Patch not found.'});
        if(db.prepare("SELECT id FROM patch_notice_jobs WHERE patch_id=? AND status='running'").get(input.id))return reply(res,409,{error:'Wait for the notification job to finish before deleting this patch.'});
        db.prepare('DELETE FROM patches WHERE id=?').run(input.id);audit('patch-catalog-deleted',input.id);return reply(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/patch-notify'){
        const input=await body(req);if(input.confirm!==true)return reply(res,400,{error:'Review the notice and confirm sending it.'});
        if(typeof input.patchId!=='string'||typeof input.nodeId!=='string')return reply(res,400,{error:'Choose a patch and computer.'});
        const patch=db.prepare('SELECT * FROM patches WHERE id=?').get(input.patchId);if(!patch)return reply(res,404,{error:'Patch not found.'});
        if(!db.prepare('SELECT 1 FROM patch_rollouts WHERE patch_id=? AND node_id=?').get(input.patchId,input.nodeId))return reply(res,400,{error:'Save a rollout plan for this computer first.'});
        const notice=patchNotice(patch,input.windowText);await synchronize();if(snapshot.error)return reply(res,502,{error:snapshot.error});
        const device=snapshot.devices.find(d=>d.id===input.nodeId);if(!device)return reply(res,404,{error:'Computer not found.'});
        if(!device.online)return reply(res,409,{error:'Computer is offline. No notification was sent.'});
        if(!device.windows)return reply(res,400,{error:'Notifications currently support Windows computers.'});
        return reply(res,200,{ok:true,...await sendPatchNotice(device,patch,notice)});
      }
      if(req.method==='GET' && url.pathname==='/api/patch-notice-job'){
        const job=db.prepare('SELECT * FROM patch_notice_jobs WHERE id=?').get(url.searchParams.get('id')||'');if(!job)return reply(res,404,{error:'Notification job not found.'});
        return reply(res,200,{...job,targets:db.prepare('SELECT node_id,name,status,detail FROM patch_notice_targets WHERE job_id=? ORDER BY name').all(job.id)});
      }
      if(req.method==='POST' && url.pathname==='/api/patch-plan'){
        const input=await body(req);if(typeof input.patchId!=='string')return reply(res,400,{error:'Choose a patch.'});const patch=db.prepare('SELECT * FROM patches WHERE id=?').get(input.patchId);if(!patch)return reply(res,404,{error:'Patch not found.'});
        if(typeof input.companyId!=='string'||!db.prepare('SELECT id FROM companies WHERE id=?').get(input.companyId))return reply(res,404,{error:'Company not found.'});
        let notice;if(input.notify===true){if(input.confirm!==true)return reply(res,400,{error:'Confirm sending notices to the company computers.'});notice=patchNotice(patch,input.windowText);if(db.prepare("SELECT id FROM patch_notice_jobs WHERE status='running'").get())return reply(res,409,{error:'A company notification job is already running. Wait for it to finish.'});await synchronize();if(snapshot.error)return reply(res,502,{error:snapshot.error});}
        const devices=snapshot.devices.filter(d=>d.companyId===input.companyId&&d.windows);if(!devices.length)return reply(res,400,{error:'No Windows computers found in this company.'});
        const at=new Date().toISOString(),jobId=input.notify===true?randomBytes(16).toString('hex'):null;db.exec('BEGIN');try{for(const d of devices)db.prepare('INSERT INTO patch_rollouts VALUES (?,?,?) ON CONFLICT(patch_id,node_id) DO NOTHING').run(input.patchId,d.id,at);
          if(jobId){db.prepare("INSERT INTO patch_notice_jobs VALUES (?,?,?,?, 'running')").run(jobId,patch.id,input.companyId,at);for(const d of devices)db.prepare('INSERT INTO patch_notice_targets VALUES (?,?,?,?,?)').run(jobId,d.id,d.name,d.online?'queued':'offline',d.online?'Waiting to send.':'Computer is offline. No notice is queued for later delivery.');}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
        audit('patch-rollout-planned',input.patchId);if(jobId)startCompanyNotice(jobId,devices,patch,notice);return reply(res,200,{ok:true,planned:devices.length,executed:false,jobId});
      }
      if(req.method==='GET' && url.pathname==='/api/security')return reply(res,200,{preferences:db.prepare('SELECT * FROM security_preferences').all(),providers:['bitdefender','defender','acronis'].map(id=>({id,consoleUrl:db.prepare('SELECT console_url FROM security_settings WHERE provider=?').get(id)?.console_url||(id==='acronis'&&acronis.configured?acronis.url.href:null),protectionVerified:false,apiConnected:false}))});
      if(req.method==='POST' && url.pathname==='/api/security-provider'){
        const input=await body(req);
        if(typeof input.companyId!=='string'||!db.prepare('SELECT id FROM companies WHERE id=?').get(input.companyId))return reply(res,404,{error:'Company not found.'});
        if(!['bitdefender','defender','acronis',''].includes(input.provider))return reply(res,400,{error:'Choose a supported security provider.'});
        if(input.provider)db.prepare('INSERT INTO security_preferences(company_id,provider) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET provider=excluded.provider').run(input.companyId,input.provider);
        else db.prepare('DELETE FROM security_preferences WHERE company_id=?').run(input.companyId);
        audit('security-provider-selected',input.companyId);return reply(res,200,{ok:true});
      }
      if(req.method==='POST' && url.pathname==='/api/security-settings'){
        const input=await body(req);if(!['bitdefender','defender','acronis'].includes(input.provider))return reply(res,400,{error:'Choose a supported security provider.'});
        if(typeof input.consoleUrl!=='string'||input.consoleUrl.length>1000)return reply(res,400,{error:'Enter a valid console URL.'});
        let consoleUrl='';if(input.consoleUrl){try{const value=new URL(input.consoleUrl);if(value.protocol!=='https:'||value.username||value.password||value.search||value.hash)throw new Error();consoleUrl=value.href;}catch{return reply(res,400,{error:'Use an HTTPS console URL without credentials, query parameters, or fragments.'});}}
        db.prepare('INSERT INTO security_settings(provider,console_url) VALUES (?,?) ON CONFLICT(provider) DO UPDATE SET console_url=excluded.console_url').run(input.provider,consoleUrl);
        audit('security-console-configured',input.provider);return reply(res,200,{ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/backup-providers')return reply(res,200,{preferences:db.prepare('SELECT * FROM backup_preferences').all(),comet:{consoleUrl:db.prepare("SELECT value FROM backup_settings WHERE id='comet_console'").get()?.value||null,apiConnected:false},msp360:{consoleUrl:db.prepare("SELECT value FROM backup_settings WHERE id='msp360_console'").get()?.value||null,apiConnected:false}});
      if(req.method==='POST' && url.pathname==='/api/backup-provider'){
        const input=await body(req);
        if(!db.prepare('SELECT id FROM companies WHERE id=?').get(input.companyId||''))return reply(res,404,{error:'Company not found.'});
        if(!['acronis','comet','msp360'].includes(input.provider))return reply(res,400,{error:'Choose Acronis, Comet Backup, or MSP360.'});
        db.prepare('INSERT INTO backup_preferences(company_id,provider) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET provider=excluded.provider').run(input.companyId,input.provider);
        audit('backup-provider-selected',input.companyId);return reply(res,200,{ok:true});
      }
      if(req.method==='POST' && ['/api/comet-settings','/api/msp360-settings'].includes(url.pathname)){
        const input=await body(req);const provider=url.pathname==='/api/comet-settings'?'comet':'msp360';let consoleUrl='';
        if(input.consoleUrl){try{const value=new URL(input.consoleUrl);if(value.protocol!=='https:'||value.username||value.password||value.search||value.hash)throw new Error();consoleUrl=value.href;}catch{return reply(res,400,{error:'Enter an HTTPS backup console URL without credentials, query parameters, or fragments.'});}}
        db.prepare("INSERT INTO backup_settings(id,value) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(provider+'_console',consoleUrl);
        audit(provider+'-console-configured',provider);return reply(res,200,{ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/acronis-inventory'){
        if(acronis.configured&&(!acronisInventory.checkedAt||Date.now()-Date.parse(acronisInventory.checkedAt)>60000))await syncAcronis();
        return reply(res,200,{...acronisInventory,configured:acronis.configured,links:db.prepare('SELECT * FROM acronis_links').all().filter(l=>snapshot.devices.some(d=>d.id===l.node_id))});
      }
      if(req.method==='POST' && url.pathname==='/api/acronis-link'){
        const input=await body(req);await synchronize();if(snapshot.error)return reply(res,502,{error:snapshot.error});
        if(!snapshot.devices.some(d=>d.id===input.nodeId))return reply(res,404,{error:'Computer not found.'});
        if(!input.resourceId){db.prepare('DELETE FROM acronis_links WHERE node_id=?').run(input.nodeId);audit('acronis-unlinked',input.nodeId);return reply(res,200,{ok:true});}
        await syncAcronis();if(acronisInventory.error)return reply(res,502,{error:acronisInventory.error});
        const resource=acronisInventory.resources.find(r=>r.id===input.resourceId);
        if(!resource)return reply(res,400,{error:'Choose an accessible Acronis resource.'});
        const assigned=db.prepare('SELECT node_id FROM acronis_links WHERE resource_id=? AND node_id<>?').get(resource.id,input.nodeId);
        if(assigned)return reply(res,409,{error:'This Acronis resource is already linked to another computer.'});
        db.prepare('INSERT INTO acronis_links(node_id,resource_id,tenant_id) VALUES (?,?,?) ON CONFLICT(node_id) DO UPDATE SET resource_id=excluded.resource_id,tenant_id=excluded.tenant_id').run(input.nodeId,resource.id,resource.tenantId);
        audit('acronis-linked',input.nodeId);return reply(res,200,{ok:true});
      }
      if(req.method==='GET' && url.pathname==='/api/acronis')return reply(res,200,acronisConnection);
      if(req.method==='POST' && url.pathname==='/api/acronis-connect'){
        try{acronisConnection=await acronis.testConnection();audit('acronis-connection-tested','acronis');return reply(res,200,acronisConnection);}
        catch(error){acronisConnection={configured:acronis.configured,authenticated:false,backupStatusVerified:false,error:error.message};return reply(res,502,acronisConnection);}
      }
      if(req.method==='POST' && url.pathname==='/api/customer-update'){
        const input=await body(req),customer=db.prepare('SELECT * FROM customers WHERE id=?').get(input.id||'');if(!customer)return reply(res,404,{error:'Customer not found.'});
        const name=typeof input.name==='string'?input.name.trim():'';if(!name||name.length>120)return reply(res,400,{error:'Enter a customer name of 1–120 characters.'});
        if(db.prepare('SELECT id FROM customers WHERE name=? AND id<>?').get(name,input.id))return reply(res,409,{error:'Customer name is already in use.'});
        const details=contactDetails(input,customer);db.prepare('UPDATE customers SET name=?,contact=?,email=?,phone=?,plan=? WHERE id=?').run(name,details.contact,details.email,details.phone,details.plan,input.id);audit('customer-updated',input.id);return reply(res,200,{ok:true});
      }
      if(req.method==='POST' && ['/api/customer-delete','/api/company-delete'].includes(url.pathname)){
        const input=await body(req);if(input.confirm!==true||typeof input.id!=='string')return reply(res,400,{error:'Confirm deletion of this empty record.'});
        if(url.pathname==='/api/customer-delete'){
          if(!db.prepare('SELECT id FROM customers WHERE id=?').get(input.id))return reply(res,404,{error:'Customer not found.'});
          if(db.prepare('SELECT id FROM companies WHERE customer_id=?').get(input.id))return reply(res,409,{error:'This customer has linked companies. Reassign those companies before deleting the customer.'});
          db.prepare('DELETE FROM customers WHERE id=?').run(input.id);audit('customer-deleted',input.id);return reply(res,200,{ok:true});
        }
        if(companyBusy)return reply(res,409,{error:'Another company update is in progress.'});
        companyBusy=true;try{
          if(!db.prepare('SELECT id FROM companies WHERE id=?').get(input.id))return reply(res,404,{error:'Company not found.'});
          await synchronize();if(snapshot.error)return reply(res,502,{error:snapshot.error});
          const groups=db.prepare('SELECT id FROM device_groups WHERE company_id=?').all(input.id);
          if(groups.some(g=>db.prepare('SELECT id FROM known_devices WHERE group_id=?').get(g.id)))return reply(res,409,{error:'This company has computer records. Companies with computers cannot be deleted.'});
          db.exec('BEGIN');try{db.prepare('DELETE FROM device_groups WHERE company_id=?').run(input.id);db.prepare('DELETE FROM locations WHERE company_id=?').run(input.id);db.prepare('DELETE FROM companies WHERE id=?').run(input.id);db.exec('COMMIT');}catch{db.exec('ROLLBACK');return reply(res,409,{error:'This company has saved settings or history. Keep this company to preserve those records.'});}
          audit('company-deleted',input.id);await synchronize();return reply(res,200,{ok:true});
        }finally{companyBusy=false;}
      }
      if(req.method==='POST' && url.pathname==='/api/customers'){
        const input=await body(req),name=typeof input.name==='string'?input.name.trim():'';
        if(!name||name.length>120)return reply(res,400,{error:'Enter a customer name of 1–120 characters.'});
        if(db.prepare('SELECT id FROM customers WHERE name=?').get(name))return reply(res,409,{error:'That customer already exists.'});
        const details=contactDetails(input),id=randomBytes(16).toString('hex');db.prepare('INSERT INTO customers(id,name,contact,email,phone,plan) VALUES (?,?,?,?,?,?)').run(id,name,details.contact,details.email,details.phone,details.plan);
        audit('customer-created',id);return reply(res,201,{id,name});
      }
      if (req.method === 'POST' && url.pathname === '/api/companies') {
        const input = await body(req);
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name || name.length > 120) return reply(res, 400, { error: 'Enter a company name of 1–120 characters.' });
        if (companyBusy) return reply(res,409,{error:'Another company update is in progress. Try again after it completes.'});
        const details=contactDetails(input);companyBusy = true;
        try {
        if (db.prepare('SELECT id FROM companies WHERE name=?').get(name)) return reply(res, 409, { error: 'That company already exists.' });
        if(input.customerId&&!db.prepare('SELECT id FROM customers WHERE id=?').get(input.customerId))return reply(res,400,{error:'Customer not found.'});
        let id = input.groupId;
        if (id) {
          const result = await mesh.request('meshes');
          if (!result.meshes?.some(g => g._id === id && g.mtype === 2)) return reply(res, 400, { error: 'Select an accessible agent device group.' });
          if (db.prepare('SELECT id FROM device_groups WHERE id=?').get(id)) return reply(res, 409, { error: 'That device group already belongs to a company.' });
        } else {
          const result = await mesh.request('createmesh', { meshname: name, meshtype: 2, desc: 'Managed through Maldoori RMM' });
          id = result.meshid;
          if (typeof id !== 'string' || !id.startsWith('mesh/')) throw new Error('MeshCentral did not return a group ID. Synchronize before retrying; the group may have been created.');
        }
        db.prepare('INSERT INTO companies(id,name,customer_id,contact,email,phone,plan) VALUES (?,?,?,?,?,?,?)').run(id,name,input.customerId||null,details.contact,details.email,details.phone,details.plan);
        ensureDefaultGroup(db,{id,name});
        audit('company-linked', id); await synchronize(); return reply(res, 201, { id, name });
        } finally { companyBusy=false; }
      }
      if (req.method === 'POST' && url.pathname === '/api/locations') {
        const input = await body(req), name = typeof input.name==='string' ? input.name.trim() : '';
        if (!db.prepare('SELECT id FROM companies WHERE id=?').get(input.companyId || '')) return reply(res,404,{error:'Company not found.'});
        if (!name || name.length>120) return reply(res,400,{error:'Enter a location name of 1–120 characters.'});
        if (db.prepare('SELECT id FROM locations WHERE company_id=? AND name=?').get(input.companyId,name)) return reply(res,409,{error:'That location already exists in this company.'});
        const location=addLocation(db,input.companyId,name); audit('location-created',location.id); return reply(res,201,location);
      }
      if (req.method === 'POST' && url.pathname === '/api/groups') {
        const input=await body(req),name=typeof input.name==='string'?input.name.trim():'';
        const location=db.prepare('SELECT l.*,c.name AS company FROM locations l JOIN companies c ON c.id=l.company_id WHERE l.id=? AND l.company_id=?').get(input.locationId||'',input.companyId||'');
        if(!location) return reply(res,400,{error:'Choose a location belonging to this company.'});
        if(!name||name.length>120) return reply(res,400,{error:'Enter a group name of 1–120 characters.'});
        if(companyBusy) return reply(res,409,{error:'Another company or group update is in progress.'});
        companyBusy=true;
        try {
          if(db.prepare('SELECT id FROM device_groups WHERE company_id=? AND location_id=? AND name=?').get(input.companyId,input.locationId,name)) return reply(res,409,{error:'That device group already exists at this location.'});
          let id=input.groupId;
          if(id){
            if(db.prepare('SELECT id FROM device_groups WHERE id=?').get(id)) return reply(res,409,{error:'This MeshCentral group is already assigned.'});
            const available=await mesh.request('meshes');
            if(!available.meshes?.some(g=>g._id===id&&g.mtype===2)) return reply(res,400,{error:'Select an accessible agent group.'});
          }else{
            const created=await mesh.request('createmesh',{meshname:`${location.company} / ${location.name} / ${name}`,meshtype:2,desc:'Maldoori company location group'});id=created.meshid;
            if(typeof id!=='string'||!id.startsWith('mesh/')) throw new Error('MeshCentral did not return the new group ID. Synchronize before retrying.');
          }
          db.prepare('INSERT INTO device_groups(id,company_id,location_id,name) VALUES (?,?,?,?)').run(id,input.companyId,input.locationId,name);
          audit('device-group-linked',id);await synchronize();return reply(res,201,{id,name});
        }finally{companyBusy=false;}
      }
      if(req.method==='POST' && url.pathname==='/api/company-update'){
        const input=await body(req),name=typeof input.name==='string'?input.name.trim():'';
        if(!db.prepare('SELECT id FROM companies WHERE id=?').get(input.id||'')) return reply(res,404,{error:'Company not found.'});
        if(!name||name.length>120) return reply(res,400,{error:'Enter a company name of 1–120 characters.'});
        if(db.prepare('SELECT id FROM companies WHERE name=? AND id<>?').get(name,input.id)) return reply(res,409,{error:'Company name is already in use.'});
        if(input.customerId&&!db.prepare('SELECT id FROM customers WHERE id=?').get(input.customerId))return reply(res,400,{error:'Customer not found.'});
        const details=contactDetails(input,db.prepare('SELECT * FROM companies WHERE id=?').get(input.id));db.prepare('UPDATE companies SET contact=?,email=?,phone=?,plan=? WHERE id=?').run(details.contact,details.email,details.phone,details.plan,input.id);
        db.prepare('UPDATE companies SET name=?,customer_id=? WHERE id=?').run(name,input.customerId===undefined?db.prepare('SELECT customer_id FROM companies WHERE id=?').get(input.id).customer_id:input.customerId||null,input.id);audit('company-renamed',input.id);await synchronize();return reply(res,200,{ok:true});
      }
      if(req.method==='POST' && ['/api/services','/api/service-action'].includes(url.pathname)){
        const input=await body(req);await synchronize();
        if(snapshot.error) return reply(res,502,{error:snapshot.error});
        const device=snapshot.devices.find(d=>d.id===input.nodeId);
        if(!device) return reply(res,404,{error:'Device is not accessible to this integration account.'});
        if(!device.online) return reply(res,409,{error:'Device is offline.'});
        if(!device.windows) return reply(res,400,{error:'Windows service management requires a Windows agent.'});
        if(directoryBusy.has(device.id)||networkBusy.has(device.id)||notificationBusy.has(device.id))return reply(res,409,{error:'A directory sync, network scan, or user notification is running on this device.'});
        if(serviceBusy.has(device.id)) return reply(res,409,{error:'A service request is already running on this device.'});
        const action=url.pathname==='/api/services'?'list':input.action;
        if(url.pathname==='/api/service-action' && !['start','stop','restart'].includes(action)) return reply(res,400,{error:'Choose start, stop, or restart.'});
        const command=serviceCommand(action,input.name||'');serviceBusy.add(device.id);
        audit('windows-services-'+action+'-requested',device.id+(action==='list'?'':':'+input.name));
        try{
          const output=await mesh.request('runcommands',{nodeids:[device.id],type:2,cmds:command.script,reply:true,runAsUser:0},{output:true});
          const services=parseServiceOutput(output.result,command.marker);
          audit('windows-services-'+action+'-completed',device.id);
          return reply(res,200,{nodeId:device.id,services,checkedAt:new Date().toISOString()});
        }finally{serviceBusy.delete(device.id);}
      }
      if (req.method === 'POST' && url.pathname === '/api/invitation') {
        const input = await body(req);
        if (!db.prepare('SELECT id FROM device_groups WHERE id=?').get(input.groupId || '')) return reply(res, 404, { error: 'Company device group not found.' });
        const invite = await mesh.invitation(input.groupId);
        audit('enrollment-invitation-created', input.groupId);
        return reply(res, 200, { url: invite, expiresInHours: 24 });
      }
      return reply(res, 404, { error:'Not found.' });
    }
    const files = { '/src/script-library.js':['src/script-library.js','text/javascript'], '/src/assets/skybase-logo.svg':['src/assets/skybase-logo.svg','image/svg+xml'], '/':['src/live.html','text/html'], '/src/live.js':['src/live.js','text/javascript'], '/src/live.css':['src/live.css','text/css'] };
    const file = files[url.pathname];
    if (!file || req.method !== 'GET') return reply(res, 404, { error:'Not found.' });
    const content = await readFile(resolve(root, file[0]));
    res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8' }); res.end(content);
  } catch (error) {
    // Return only known, credential-free error messages.
    const safe = error.status || error.message.startsWith('MeshCentral') || error.message.startsWith('Cannot connect') || error.message.startsWith('Unexpected MeshCentral');
    reply(res, error.status || 502, { error: safe ? error.message : 'Operation failed. Check the integration configuration and account permissions.' });
  }
});
server.listen(Number(process.env.PORT || 3001), process.env.BIND_ADDRESS || '127.0.0.1', () => console.log('Maldoori live backend listening on port ' + (process.env.PORT || 3001)));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => { clearInterval(poll); clearInterval(cleanup); server.close(() => { db.close(); process.exit(0); }); });
