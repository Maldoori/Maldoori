import {randomUUID} from 'node:crypto';

export function initializeCatalog(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS locations(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),name TEXT NOT NULL,UNIQUE(company_id,name));
    CREATE TABLE IF NOT EXISTS device_groups(id TEXT PRIMARY KEY,company_id TEXT NOT NULL REFERENCES companies(id),location_id TEXT NOT NULL REFERENCES locations(id),name TEXT NOT NULL);`);
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
    companies: db.prepare('SELECT * FROM companies ORDER BY name').all(),
    locations: db.prepare('SELECT * FROM locations ORDER BY name').all(),
    deviceGroups: db.prepare('SELECT g.*,c.name AS company,l.name AS location FROM device_groups g JOIN companies c ON c.id=g.company_id JOIN locations l ON l.id=g.location_id ORDER BY c.name,l.name,g.name').all()
  };
}
export function addLocation(db, companyId, name) {
  const id = randomUUID();
  db.prepare('INSERT INTO locations(id,company_id,name) VALUES (?,?,?)').run(id, companyId, name);
  return {id,company_id:companyId,name};
}
