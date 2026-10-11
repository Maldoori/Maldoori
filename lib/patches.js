import {randomUUID} from 'node:crypto';
export const patchCategories=['security','critical','feature','driver','other'];
export const patchSeverities=['critical','important','moderate','low'];
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function initializePatches(db){db.exec(`CREATE TABLE IF NOT EXISTS patches(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,vendor TEXT NOT NULL,category TEXT NOT NULL,severity TEXT NOT NULL,size_mb REAL,released_at TEXT,reboot_required INTEGER NOT NULL,source_url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS patch_rollouts(patch_id TEXT NOT NULL REFERENCES patches(id) ON DELETE CASCADE,node_id TEXT NOT NULL,planned_at TEXT NOT NULL,PRIMARY KEY(patch_id,node_id));`);
 if(!db.prepare('PRAGMA table_info(patches)').all().some(c=>c.name==='reference'))db.exec("ALTER TABLE patches ADD COLUMN reference TEXT NOT NULL DEFAULT ''");
}
export function patchInput(input){
 const text=(key,max,required=false)=>{if(input[key]!==undefined&&typeof input[key]!=='string')invalid('Invalid '+key+'.');const value=(input[key]||'').trim();if(value.length>max||(required&&!value))invalid('Check '+key+'.');return value;};
 const reference=text('reference',120),title=text('title',160,true),description=text('description',1000),vendor=text('vendor',120,true);
 if(!patchCategories.includes(input.category)||!patchSeverities.includes(input.severity))invalid('Choose a valid category and severity.');
 const size=text('sizeMb',30),sizeMb=size?Number(size):null;if(sizeMb!==null&&(!Number.isFinite(sizeMb)||sizeMb<0||sizeMb>1000000))invalid('Enter a valid size in MB.');
 const releasedAt=text('releasedAt',10);if(releasedAt&&(!/^\d{4}-\d{2}-\d{2}$/.test(releasedAt)||!Number.isFinite(Date.parse(releasedAt))||new Date(releasedAt).toISOString().slice(0,10)!==releasedAt))invalid('Enter a valid release date.');
 let sourceUrl=text('sourceUrl',1000);if(sourceUrl){try{const url=new URL(sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error();sourceUrl=url.href;}catch{invalid('Use an HTTPS vendor page URL without credentials, query parameters, or fragments.');}}
 if(!['yes','no'].includes(input.rebootRequired))invalid('Choose whether a reboot is required.');
 return {reference,title,description,vendor,category:input.category,severity:input.severity,sizeMb,releasedAt:releasedAt||null,rebootRequired:input.rebootRequired==='yes'?1:0,sourceUrl};
}
export function savePatch(db,input){const p=patchInput(input),id=input.id||randomUUID();if(input.id&&!db.prepare('SELECT id FROM patches WHERE id=?').get(input.id))throw Object.assign(new Error('Patch not found.'),{status:404});
 db.prepare('INSERT INTO patches(id,title,description,vendor,category,severity,size_mb,released_at,reboot_required,source_url,reference) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,vendor=excluded.vendor,category=excluded.category,severity=excluded.severity,size_mb=excluded.size_mb,released_at=excluded.released_at,reboot_required=excluded.reboot_required,source_url=excluded.source_url,reference=excluded.reference').run(id,p.title,p.description,p.vendor,p.category,p.severity,p.sizeMb,p.releasedAt,p.rebootRequired,p.sourceUrl,p.reference);return id;}
