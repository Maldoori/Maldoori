import {randomUUID} from 'node:crypto';
export const ticketStatuses=['open','in_progress','resolved'];
export const ticketPriorities=['low','medium','high','urgent'];
export const ticketCategories=['hardware','software','network','security','other'];
const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
const field=(v,name,max,required=false)=>{if(typeof v!=='string'||v.length>max||/[\x00]/.test(v)||required&&!v.trim())invalid('Enter a valid '+name+'.');return v.trim();};
export function initializeTickets(db){db.exec(`CREATE TABLE IF NOT EXISTS tickets(id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,title TEXT NOT NULL,description TEXT NOT NULL,customer_id TEXT REFERENCES customers(id),node_id TEXT NOT NULL DEFAULT '',requester_email TEXT NOT NULL DEFAULT '',priority TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,assignee TEXT NOT NULL DEFAULT '',source TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,ai TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS ticket_messages(id TEXT PRIMARY KEY,ticket_id TEXT NOT NULL REFERENCES tickets(id),body TEXT NOT NULL,author TEXT NOT NULL,source TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ticket_email_receipts(provider TEXT NOT NULL,message_id TEXT NOT NULL,thread_id TEXT NOT NULL,sender TEXT NOT NULL,ticket_id TEXT NOT NULL REFERENCES tickets(id),PRIMARY KEY(provider,message_id));
CREATE TABLE IF NOT EXISTS ticket_ai_jobs(ticket_id TEXT PRIMARY KEY REFERENCES tickets(id),status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS ticket_settings(id TEXT PRIMARY KEY,value TEXT NOT NULL);`);db.exec("UPDATE ticket_ai_jobs SET status='queued' WHERE status='running'");}
export function ticketInput(input,previous={}){const result={};for(const [key,max,required] of [['title',180,true],['description',10000,true],['assignee',120,false],['nodeId',256,false],['customerId',120,false],['requesterEmail',254,false]])result[key]=field(input[key]??previous[key]??'',key,max,required);
 for(const [key,values,fallback] of [['priority',ticketPriorities,'medium'],['category',ticketCategories,'other'],['status',ticketStatuses,'open']]){result[key]=input[key]??previous[key]??fallback;if(!values.includes(result[key]))invalid('Choose a valid '+key+'.');}
 if(result.requesterEmail&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.requesterEmail))invalid('Enter a valid requester email.');return result;}
export function createTicket(db,input,source='manual'){const v=ticketInput(input),at=new Date().toISOString(),id=randomUUID(),number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS n FROM tickets').get().n;
 db.prepare('INSERT INTO tickets(id,number,title,description,customer_id,node_id,requester_email,priority,category,status,assignee,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,number,v.title,v.description,v.customerId||null,v.nodeId,v.requesterEmail,v.priority,v.category,v.status,v.assignee,source,at,at);return {id,number};}
export function importTicketEmail(db,email,provider){
 const id=field(email.id,'message ID',512,true),thread=field(email.threadId||id,'thread ID',512,true),sender=field(email.sender,'sender',254,true).toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender))invalid('Email sender is invalid.');
 if(db.prepare('SELECT ticket_id FROM ticket_email_receipts WHERE provider=? AND message_id=?').get(provider,id))return {duplicate:true};
 const existing=db.prepare('SELECT t.* FROM ticket_email_receipts r JOIN tickets t ON t.id=r.ticket_id WHERE r.provider=? AND r.thread_id=? AND r.sender=? ORDER BY t.created_at LIMIT 1').get(provider,thread,sender);
 db.exec('BEGIN');try{let ticketId=existing?.id,created=false;
 if(!existing){const matches=db.prepare('SELECT id FROM customers WHERE lower(email)=?').all(sender);const companyMatches=db.prepare('SELECT DISTINCT customer_id AS id FROM companies WHERE lower(email)=? AND customer_id IS NOT NULL').all(sender);const ids=[...new Set([...matches,...companyMatches].map(v=>v.id))];const ticket=createTicket(db,{title:(email.subject||'(No subject)').slice(0,180),description:(email.body||'(No plain-text content. Check the mailbox for attachments.)').slice(0,10000),customerId:ids.length===1?ids[0]:'',requesterEmail:sender},'email');ticketId=ticket.id;created=true;
 }else if(!existing.deleted_at){const at=new Date().toISOString();db.prepare('INSERT INTO ticket_messages VALUES (?,?,?,?,?,?)').run(randomUUID(),ticketId,(email.body||'(No plain-text content.)').slice(0,10000),sender,'email',at);db.prepare("UPDATE tickets SET updated_at=?,status=CASE WHEN status='resolved' THEN 'open' ELSE status END,ai='{}' WHERE id=?").run(at,ticketId);}
 db.prepare('INSERT INTO ticket_email_receipts VALUES (?,?,?,?,?)').run(provider,id,thread,sender,ticketId);db.exec('COMMIT');return {id:ticketId,created,ignored:!!existing?.deleted_at};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
