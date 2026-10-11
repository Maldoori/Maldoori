import {randomUUID} from 'node:crypto';

export function initializeCatalog(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),name TEXT NOT NULL,UNIQUE(company_id,name));
    CREATE TABLE IF NOT EXISTS device_groups(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),location_id TEXT NOT NULL REFERENCES locations(id),name TEXT NOT NULL);`);
  db.exec('CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE)');
  if (!db.prepare('PRAGMA table_info(companies)').all().some(c=>c.name==='customer_id')) db.exec('ALTER TABLE companies ADD COLUMN customer_id TEXT REFERENCES customers(id)');
  for(const table of ['customers','companies'])for(const column of ['contact','email','phone','plan'])if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===column))db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+" TEXT NOT NULL DEFAULT ''");
  // Preserve existing company IDs and enrolled MeshCentral groups.
  db.exec('BEGIN');
  try {
    for (const company of db.prepare('SELECT * FROM companies').all()) ensureDefaultGroup(db, company);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function ensureDefaultGroup(db, company) {
  const id = 'location:' + company.id;
  db.prepare('INSERT OR IGNORE INTO locations(id,company_id,name) VALUES (?,?,?)').run(id, company.id, 'Main office');
  db.prepare('INSERT OR IGNORE INTO device_groups(id,company_id,location_id,name) VALUES (?,?,?,?)').run(company.id, company.id, id, 'Default devices');
}
export function catalog(db) {
  return {
    customers: db.prepare('SELECT * FROM customers ORDER BY name').all(),
    companies: db.prepare('SELECT c.*,u.name AS customer FROM companies c LEFT JOIN customers u ON u.id=c.customer_id ORDER BY u.name,c.name').all(),
    locations: db.prepare('SELECT * FROM locations ORDER BY name').all(),
    deviceGroups: db.prepare('SELECT g.*,c.name AS company,l.name AS location FROM device_groups g JOIN companies c ON c.id=g.company_id JOIN locations l ON l.id=g.location_id ORDER BY c.name,l.name,g.name').all()
  };
}
export function addLocation(db, companyId, name) {
  const id = randomUUID();
  db.prepare('INSERT INTO locations(id,company_id,name) VALUES (?,?,?)').run(id, companyId, name);
  return {id,company_id:companyId,name};
}

export function contactDetails(input,previous={}){
 const result={};for(const key of ['contact','email','phone','plan']){const value=input[key]===undefined?(previous[key]||''):input[key];if(typeof value!=='string'||value.length>(key==='email'?254:120)||/[\x00-\x1f]/.test(value))throw Object.assign(new Error('Enter valid contact details.'),{status:400});result[key]=value.trim();}
 if(result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))throw Object.assign(new Error('Enter a valid email address.'),{status:400});
 if(!['','basic','professional','enterprise'].includes(result.plan))throw Object.assign(new Error('Choose a valid service plan.'),{status:400});return result;
}
