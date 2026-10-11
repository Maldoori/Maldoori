const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let inventory = {groups:[],customers:[],companies:[],locations:[],deviceGroups:[],devices:[]}, refreshing = false, page = 'overview';
async function api(path, data) {
  const response = await fetch('/api/' + path, {method:data === undefined ? 'GET' : 'POST',headers:data === undefined ? {} : {'Content-Type':'application/json'},body:data === undefined ? undefined : JSON.stringify(data)});
  const value = await response.json();
  if (response.status === 401) { $('#modal').close(); $('#workspace').hidden = true; $('#logout').hidden = true; $('#login').hidden = false; }
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
function message(text) { $('#message').textContent = text; }
function options(items, selected, empty) { return (empty ? `<option value="">${empty}</option>` : '') + items.map(x => `<option value="${escape(x.id)}" ${x.id === selected ? 'selected' : ''}>${escape(x.name)}</option>`).join(''); }
function setFilter(id, items, empty) { const value=$(id).value; $(id).innerHTML=options(items,value,empty); }
function devicesFiltered() {
  const company=$('#company-filter').value,location=$('#location-filter').value,group=$('#group-filter').value,status=$('#status-filter').value,query=$('#search').value.toLowerCase();
  return inventory.devices.filter(d => (!company || d.companyId===company) && (!location || d.locationId===location) && (!group || d.groupId===group) && (!status || d.online===(status==='online')) && `${d.name} ${d.company} ${d.location} ${d.groupName} ${d.os}`.toLowerCase().includes(query));
}
function changePage(value) {
  page=value;
  document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false');});
  $('#companies-panel').hidden=!['overview','companies'].includes(page);
  $('#devices-panel').hidden=!['overview','devices'].includes(page);
  $('#backups-panel').hidden=page!=='backups';
  if(page==='backups')loadAcronis();
  $('#groups-panel').hidden=page!=='groups';
}
function render() {
  $('#company-count').textContent=inventory.companies.length;$('#location-count').textContent=inventory.locations.length;
  $('#device-count').textContent=inventory.devices.length;$('#online-count').textContent=inventory.devices.filter(d=>d.online).length;
  $('#connection').className='connection'+(inventory.error?' error':'');
  $('#connection').textContent=inventory.error?'Synchronization failed: '+inventory.error+(inventory.lastSync?' Showing last successful inventory from '+new Date(inventory.lastSync).toLocaleString()+'.':' No inventory verified yet.'):'Connected to MeshCentral · Last synchronized '+new Date(inventory.lastSync).toLocaleString()+' · Checks every 30 seconds';
  let lastCustomer;
  $('#companies').innerHTML=inventory.companies.map(c=>`${lastCustomer===c.customer_id?'':`<h3>${escape(c.customer||'Unassigned customer')}</h3>`}${(lastCustomer=c.customer_id,'')}<div class="company-row"><div><strong>${escape(c.name)}</strong><p class="muted">${inventory.locations.filter(l=>l.company_id===c.id).length} locations · ${inventory.deviceGroups.filter(g=>g.company_id===c.id).length} groups · ${inventory.devices.filter(d=>d.companyId===c.id).length} devices</p><div class="location-tags">${inventory.devices.filter(d=>d.companyId===c.id).map(d=>`<button class="text-button" data-manage="${escape(d.id)}">${escape(d.name)}</button>`).join('')||'No computers enrolled yet'}</div><details><summary>Locations</summary><div class="location-tags">${inventory.locations.filter(l=>l.company_id===c.id).map(l=>`<span>${escape(l.name)}</span>`).join('')}</div></details></div><div class="toolbar"><button data-edit-company="${escape(c.id)}">Edit company</button><button data-company-location="${escape(c.id)}">Add location</button><button data-invite="${escape(c.id)}">Add device</button></div></div>`).join('')||'<p class="empty">No companies linked. Add a company or link an existing MeshCentral group.</p>';
  const assigned=new Set(inventory.deviceGroups.map(g=>g.id));
  $('#groups').innerHTML=inventory.deviceGroups.map(g=>`<div class="company-row"><div><strong>${escape(g.name)}</strong><p class="muted">${escape(g.company)} / ${escape(g.location)} · ${inventory.devices.filter(d=>d.groupId===g.id).length} devices</p></div><button data-group-invite="${escape(g.id)}">Enroll device</button></div>`).join('')||'<p class="empty">No assigned device groups yet.</p>';
  const unassigned=inventory.groups.filter(g=>g.type===2&&!assigned.has(g.id));
  $('#unassigned-groups').innerHTML=unassigned.length?`<h3>Unassigned MeshCentral groups</h3><p class="muted">Link these groups to a company and location to organize existing devices.</p>${unassigned.map(g=>`<div class="company-row"><strong>${escape(g.name)}</strong><button data-link-group="${escape(g.id)}">Link group</button></div>`).join('')}`:'';
  setFilter('#company-filter',inventory.companies,'All companies');
  setFilter('#location-filter',inventory.locations.filter(l=>!$('#company-filter').value||l.company_id===$('#company-filter').value),'All locations');
  setFilter('#group-filter',inventory.deviceGroups.filter(g=>(!$('#company-filter').value||g.company_id===$('#company-filter').value)&&(!$('#location-filter').value||g.location_id===$('#location-filter').value)),'All groups');
  $('#devices').innerHTML=devicesFiltered().map(d=>`<article class="device-card" data-device-card="${escape(d.id)}"><div class="device-card-heading"><span class="computer-icon" aria-hidden="true">▣</span><div><button class="text-button device-name" data-manage="${escape(d.id)}">${escape(d.name)}</button><p>${escape(d.company)}</p></div><span class="badge ${d.online?'':'offline'}">${d.online?'Online':'Offline'}</span></div><div class="device-metrics">${['CPU','Memory','Disk'].map(label=>`<div class="metric"><div><span>${label}</span><span class="metric-value" data-metric-value="${label.toLowerCase()}">Not available</span></div><div class="metric-track"><div data-metric-bar="${label.toLowerCase()}"></div></div></div>`).join('')}<p class="metric-status" data-metric-status>Awaiting readings</p></div><div class="device-info"><p>▦ ${escape(d.company)}</p><p>⌖ ${escape(d.location)}</p><p>${escape(d.os)}</p><p>Group: <strong>${escape(d.groupName)}</strong></p>${d.mapped?'':'<p class="warning">Group not linked to a company</p>'}</div><button class="primary connect-device" data-remote="${escape(d.id)}" ${!d.online||inventory.error?'disabled':''}>Connect Now ↗</button><div class="device-card-actions"><button data-edit-device="${escape(d.id)}">Edit</button><button class="danger" data-delete-device="${escape(d.id)}">Delete</button>${d.mapped?`<button data-invite="${escape(d.companyId)}">Agent</button>`:''}</div></article>`).join('')||'<p class="empty">No matching computers. Use Add device to generate an enrollment link.</p>';

  bind('[data-invite]',b=>enroll(b.dataset.invite));bind('[data-group-invite]',b=>{const g=inventory.deviceGroups.find(g=>g.id===b.dataset.groupInvite);enroll(g.company_id,g.location_id,g.id);});
  bind('[data-edit-device]',b=>editDevice(b.dataset.editDevice));bind('[data-delete-device]',b=>deleteDevice(b.dataset.deleteDevice));
  bind('[data-remote]',b=>openRemote(b.dataset.remote));bind('[data-manage]',b=>manageDevice(b.dataset.manage));
  bind('[data-edit-company]',b=>renameCompany(b.dataset.editCompany));bind('[data-company-location]',b=>locationForm(b.dataset.companyLocation));bind('[data-link-group]',b=>groupForm('', '', b.dataset.linkGroup));changePage(page);loadMetrics();
}
const metrics=new Map(),metricsPending=new Set();
function paintMetrics(d){
  const card=[...document.querySelectorAll('[data-device-card]')].find(c=>c.dataset.deviceCard===d.id);if(!card)return;
  const reading=metrics.get(d.id),status=card.querySelector('[data-metric-status]');
  if(!d.online){status.textContent='Computer offline';return;}
  if(!d.windows){status.textContent='Windows metrics only';return;}
  if(!reading){status.textContent='Collecting live readings…';return;}
  if(reading.error){status.textContent=reading.error;return;}
  for(const key of ['cpu','memory','disk']){
    card.querySelector(`[data-metric-value="${key}"]`).textContent=reading[key]+'%';
    card.querySelector(`[data-metric-bar="${key}"]`).style.width=reading[key]+'%';
  }
  status.textContent='System drive '+reading.diskName+' · Read at '+new Date(reading.checkedAt).toLocaleTimeString();
}
async function loadMetrics(){
  const queue=devicesFiltered();queue.forEach(paintMetrics);
  async function worker(){for(let d;(d=queue.shift());){
    if(!d.online||!d.windows||inventory.error||metricsPending.has(d.id))continue;
    const prior=metrics.get(d.id);if(prior&&Date.now()-prior.at<30000)continue;
    metricsPending.add(d.id);
    try{metrics.set(d.id,{...await api('telemetry',{nodeId:d.id}),at:Date.now()});}
    catch(error){metrics.set(d.id,{error:error.message,at:Date.now()});}
    finally{metricsPending.delete(d.id);const current=inventory.devices.find(x=>x.id===d.id);if(current)paintMetrics(current);}
  }}
  await Promise.all([worker(),worker()]);
}
function bind(selector,handler){document.querySelectorAll(selector).forEach(b=>b.onclick=()=>handler(b));}
async function refresh() {
  if(refreshing)return;refreshing=true;
  try{inventory=await api('inventory');$('#login').hidden=true;$('#workspace').hidden=false;$('#logout').hidden=false;render();}
  catch(error){if(!$('#workspace').hidden)message(error.message);}finally{refreshing=false;}
}
function showDialog(html){$('#modal').innerHTML=html;$('#modal').showModal();$('#modal').querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#modal').close());}
function actions(label){return `<p id="form-error" role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button class="primary">${label}</button></div>`;}
function submitForm(id,route,onSuccess=refresh){$(id).onsubmit=async e=>{e.preventDefault();const button=e.target.querySelector('.primary');button.disabled=true;$('#form-error').textContent='';try{await api(route,Object.fromEntries(new FormData(e.target)));$('#modal').close();message('');await onSuccess();}catch(error){if($('#form-error'))$('#form-error').textContent=error.message;}finally{button.disabled=false;}};}
function setupRequired(){showDialog('<h2>Add device</h2><p class="muted">Set up your company once, or link an existing MeshCentral group. You can then add multiple locations, groups, and computers.</p><div class="actions"><button data-close>Cancel</button><button id="setup-company" class="primary">Set up company</button></div>');$('#setup-company').onclick=()=>{$('#modal').close();companyForm();};}
function enroll(companyId='',locationId='',groupId=''){
  if(!inventory.companies.length){setupRequired();return;}
  showDialog(`<h2>Add device</h2><p class="muted">Choose where this computer belongs. Existing computers and companies stay in place.</p><form id="add-device-form"><div class="steps"><span>1 Customer</span><span>2 Company</span><span>3 Install computer agent</span></div><label>Customer<select name="customerId"></select></label><label>Company<select name="companyId" required>${options(inventory.companies,companyId)}</select></label><details><summary>Advanced: location and device group</summary><label>Location<select name="locationId" required></select></label><label>Device group<select name="groupId" required></select></label></details><label>Operating system<input value="Windows — choose the matching installer on the enrollment page" readonly></label><p class="muted">The enrollment link is valid for 24 hours. The computer appears automatically once its agent is installed and connects.</p><p id="enrollment-error" role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button type="button" id="enrollment-add-group">New group</button><button class="primary">Generate enrollment link</button></div></form>`);
  const form=$('#add-device-form'),company=form.elements.companyId,location=form.elements.locationId,group=form.elements.groupId;
  function updateGroups(){group.innerHTML=options(inventory.deviceGroups.filter(g=>g.company_id===company.value&&g.location_id===location.value),groupId||company.value);form.querySelector('.primary').disabled=!group.options.length;$('#enrollment-error').textContent=group.options.length?'':'This location has no device groups yet. Create a group first.';}
  function updateLocations(){location.innerHTML=options(inventory.locations.filter(l=>l.company_id===company.value),locationId||'location:'+company.value);updateGroups();}
  const customer=form.elements.customerId;
  customer.innerHTML=options(inventory.customers,inventory.companies.find(c=>c.id===company.value)?.customer_id,'All customers');
  customer.onchange=()=>{company.innerHTML=options(inventory.companies.filter(c=>!customer.value||c.customer_id===customer.value));locationId='';groupId='';updateLocations();};
  company.onchange=()=>{locationId='';groupId='';updateLocations();};location.onchange=()=>{groupId='';updateGroups();};updateLocations();
  $('#enrollment-add-group').onclick=()=>groupForm(company.value,location.value);
  form.onsubmit=async e=>{e.preventDefault();const b=form.querySelector('.primary');b.disabled=true;$('#enrollment-error').textContent='';try{await createInvitation(group.value);}catch(error){if($('#enrollment-error'))$('#enrollment-error').textContent=error.message;}finally{b.disabled=false;}};
}
async function createInvitation(groupId){
  const group=inventory.deviceGroups.find(g=>g.id===groupId);if(!group)throw new Error('Choose an assigned device group.');
  const value=await api('invitation',{groupId});
  showDialog(`<h2>Enroll a Windows computer</h2><p class="muted"><strong>${escape(group.company)} / ${escape(group.location)} / ${escape(group.name)}</strong></p><a class="invite" href="${escape(value.url)}" target="_blank" rel="noopener noreferrer">${escape(value.url)}</a><div class="callout">Enrollment link expires in 24 hours. Installed agents remain enrolled.</div><ol class="muted"><li>Open this link on the authorized Windows computer.</li><li>Download its matching Windows agent installer.</li><li>Run as administrator, choose Install, and explain that ongoing remote management will be enabled.</li><li>Keep it online. It appears in this company, location, and group on the next synchronization.</li></ol><p class="muted">You can use the same valid link for multiple computers in this group.</p><div class="actions"><button id="copy-invite">Copy link</button><button data-close>Close</button></div>`);
  $('#copy-invite').onclick=async()=>{try{await navigator.clipboard.writeText(value.url);$('#copy-invite').textContent='Copied';}catch{$('#copy-invite').textContent='Select and copy the link above';}};
}
function companyForm(){
  const assigned=new Set(inventory.deviceGroups.map(g=>g.id)),groups=inventory.groups.filter(g=>g.type===2&&!assigned.has(g.id));
  showDialog(`<h2>Add company</h2><form id="company-form"><label>Customer<select name="customerId">${options(inventory.customers,'','Unassigned customer')}</select></label><label>Company name<input name="name" required maxlength="120" placeholder="Company name"></label><label>Initial device group<select name="groupId"><option value="">Create a new agent device group</option>${groups.map(g=>`<option value="${escape(g.id)}">Link existing: ${escape(g.name)}</option>`).join('')}</select></label><p class="muted">We create a Main office location and assign the initial group there. Linking an existing group preserves its enrolled computers.</p>${actions('Save company')}</form>`);submitForm('#company-form','companies');
}
function locationForm(companyId=''){
  if(!inventory.companies.length){setupRequired();return;}
  showDialog(`<h2>Add location</h2><form id="location-form"><label>Company<select name="companyId" required>${options(inventory.companies,companyId)}</select></label><label>Location name<input name="name" maxlength="120" required placeholder="Head office, branch, or remote staff"></label>${actions('Save location')}</form>`);submitForm('#location-form','locations');
}
function groupForm(companyId='',locationId='',groupId=''){
  if(!inventory.companies.length){setupRequired();return;}
  const assigned=new Set(inventory.deviceGroups.map(g=>g.id)),available=inventory.groups.filter(g=>g.type===2&&!assigned.has(g.id));
  showDialog(`<h2>Add device group</h2><form id="group-form"><label>Company<select name="companyId" required>${options(inventory.companies,companyId)}</select></label><label>Location<select name="locationId" required></select></label><label>Group name<input name="name" required maxlength="120" placeholder="Workstations, servers, or laptops"></label><label>MeshCentral group<select name="groupId">${options(available,groupId,'Create a new agent device group')}</select></label><p class="muted">Each group belongs to one company location. Linking an existing group preserves its computers.</p>${actions('Save group')}</form>`);
  const form=$('#group-form');const update=()=>{form.elements.locationId.innerHTML=options(inventory.locations.filter(l=>l.company_id===form.elements.companyId.value),locationId);};form.elements.companyId.onchange=()=>{locationId='';update();};update();
  if(groupId)form.elements.name.value=available.find(g=>g.id===groupId)?.name||'';submitForm('#group-form','groups');
}
function renameCompany(id){const company=inventory.companies.find(c=>c.id===id);showDialog(`<h2>Edit company</h2><form id="rename-company-form"><input type="hidden" name="id" value="${escape(id)}"><label>Customer<select name="customerId">${options(inventory.customers,company.customer_id,'Unassigned customer')}</select></label><label>Company name<input name="name" required maxlength="120" value="${escape(company.name)}"></label>${actions('Save company')}</form>`);submitForm('#rename-company-form','company-update');}
function openRemote(id){const d=inventory.devices.find(d=>d.id===id);if(d?.online&&!inventory.error)window.open(d.desktopUrl,'_blank','noopener,noreferrer');}
function editDevice(id){const d=inventory.devices.find(d=>d.id===id);showDialog(`<h2>Edit computer</h2><form id="edit-device-form"><input type="hidden" name="id" value="${escape(id)}"><label>Display name<input name="name" required maxlength="120" value="${escape(d.name)}"></label><p class="muted">Agent computer name: ${escape(d.agentName||d.name)}. This changes the name displayed in Maldoori.</p>${actions('Save computer')}</form>`);submitForm('#edit-device-form','device-update');}
function deleteDevice(id){const d=inventory.devices.find(d=>d.id===id);showDialog(`<h2>Delete computer</h2><p>Remove <strong>${escape(d.name)}</strong> from Maldoori?</p><p class="muted">It stays removed after synchronization. Its MeshCentral agent and Acronis backups remain installed and available in their consoles.</p><p id="form-error" role="alert"></p><div class="actions"><button data-close>Cancel</button><button class="danger" id="confirm-delete-device">Delete computer</button></div>`);$('#confirm-delete-device').onclick=async()=>{const b=$('#confirm-delete-device');b.disabled=true;try{await api('device-delete',{id,confirm:true});$('#modal').close();await refresh();}catch(error){$('#form-error').textContent=error.message;b.disabled=false;}};}
function manageDevice(id){const d=inventory.devices.find(d=>d.id===id);showDialog(`<h2>${escape(d.name)}</h2><p class="muted">${escape(d.company)} / ${escape(d.location)} / ${escape(d.groupName)}</p><div class="detail-grid"><div>Operating system<strong>${escape(d.os)}</strong></div><div>Connection<strong>${d.online?'Online':'Offline'}</strong></div></div><div class="actions"><button data-close>Close</button><button id="device-remote" class="primary" ${!d.online||inventory.error?'disabled':''}>Remote Desktop ↗</button></div>`);$('#device-remote').onclick=()=>openRemote(id);}
function renderAcronis(value){
  $('#acronis-status').textContent=value.error||(!value.configured?'Acronis credentials have not been configured on the server.':value.authenticated?'API authentication verified at '+new Date(value.checkedAt).toLocaleString()+'. Backup results are not yet verified.':'Credentials configured. Test the API connection.');
  $('#acronis-console').hidden=!value.authenticated;
  if(value.authenticated)$('#acronis-console').href=value.consoleUrl;
}
let acronisData={resources:[],tasks:[],links:[]},acronisLoading=false;
async function loadAcronis(){
  if(acronisLoading)return;acronisLoading=true;
  try{
    renderAcronis(await api('acronis'));acronisData=await api('acronis-inventory');
    if(acronisData.checkedAt&&!acronisData.error)renderAcronis({configured:true,authenticated:true,checkedAt:acronisData.checkedAt,consoleUrl:acronisData.consoleUrl});
    $('#acronis-inventory-status').textContent=acronisData.error||(acronisData.checkedAt?'Imported '+acronisData.resources.length+' resources · '+acronisData.tasks.length+' tasks · Checked '+new Date(acronisData.checkedAt).toLocaleString()+(acronisData.complete?'':'. Partial inventory; additional pages may be unavailable.'):'Waiting for Acronis credentials.');
    renderBackups();
  }catch(error){$('#acronis-inventory-status').textContent=error.message;}finally{acronisLoading=false;}
}
function backupDate(value){return value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not verified';}
function renderBackups(){
  const linked=inventory.devices.filter(d=>acronisData.links.some(l=>l.node_id===d.id)).length;
  $('#backup-summary').innerHTML=`<div><span>Computers</span><strong>${inventory.devices.length}</strong></div><div><span>Linked to Acronis</span><strong>${linked}</strong></div><div><span>Need linking</span><strong>${inventory.devices.length-linked}</strong></div>`;
  setFilter('#backup-company',inventory.companies,'All companies');
  const query=$('#backup-search').value.toLowerCase(),company=$('#backup-company').value;
  const devices=inventory.devices.filter(d=>(!company||d.companyId===company)&&`${d.name} ${d.company}`.toLowerCase().includes(query));
  $('#acronis-computers').innerHTML=devices.map(d=>{
    const link=acronisData.links.find(l=>l.node_id===d.id),resource=acronisData.resources.find(r=>r.id===link?.resource_id),backup=acronisData.backupResults?.find(b=>b.resourceId===resource?.id),task=backup?.latestTask;
    let label=!link?'Not linked':!resource?'Resource unavailable':!task?'No verified task':task.state==='completed'&&task.result==='ok'?'Last task succeeded':task.state==='completed'?'Last task needs attention':'Task: '+task.state;
    if(acronisData.error)label='Status unavailable';
    const success=!acronisData.error&&task?.state==='completed'&&task?.result==='ok';
    return `<article class="device-card backup-card"><div class="device-card-heading"><span class="computer-icon" aria-hidden="true">▣</span><div><strong class="device-name">${escape(d.name)}</strong><p>${escape(d.company)}</p></div></div><p><span class="backup-badge ${success?'success':''}">${escape(label)}</span></p><div class="backup-facts"><div><span>Last successful backup task</span><strong>${escape(backupDate(backup?.lastSuccessfulTaskAt))}</strong></div><div><span>Acronis customer</span><strong>${escape(resource?.tenant||'Not linked')}</strong></div></div><div class="backup-card-footer">${resource&&acronisData.consoleUrl?`<a class="button-link primary" href="${escape(acronisData.consoleUrl)}" target="_blank" rel="noopener noreferrer">Manage in Acronis ↗</a>`:''}<button data-acronis-link="${escape(d.id)}" ${acronisData.error||!acronisData.checkedAt?'disabled':''}>${link?'Change device link':'Link backup device'}</button><button data-backup-info="${escape(d.id)}">Details</button></div></article>`;
  }).join('')||'<p class="empty">No matching computers.</p>';
  const allowed=['D332948D-A7A9-4E07-B76C-253DCF6E17FB','1B6CB334-6CB5-4760-AE3C-B96A973D5A99'];
  const tasks=acronisData.tasks.filter(t=>$('#backup-history-filter').value==='all'||allowed.includes(t.type.toUpperCase())).sort((a,b)=>(Date.parse(b.completedAt||b.startedAt)||0)-(Date.parse(a.completedAt||a.startedAt)||0));
  $('#acronis-tasks').innerHTML='<table><thead><tr><th>CUSTOMER</th><th>ACTIVITY</th><th>RESULT</th><th>COMPLETED</th></tr></thead><tbody>'+tasks.map(t=>`<tr><td>${escape(t.tenant)}</td><td>${escape(t.title)}</td><td>${escape(t.state==='completed'&&t.result==='ok'?'Succeeded':t.state+' / '+t.result)}</td><td>${escape(backupDate(t.completedAt))}</td></tr>`).join('')+'</tbody></table>'+(tasks.length?'':'<p class="empty">No matching activities returned.</p>');
  bind('[data-acronis-link]',b=>linkAcronis(b.dataset.acronisLink));
  bind('[data-backup-info]',b=>{const d=inventory.devices.find(d=>d.id===b.dataset.backupInfo),link=acronisData.links.find(l=>l.node_id===d.id),backup=acronisData.backupResults?.find(r=>r.resourceId===link?.resource_id);showDialog(`<h2>${escape(d.name)} backup</h2><p class="muted">${escape(d.company)}</p><p>Last successful backup task: ${escape(backupDate(backup?.lastSuccessfulTaskAt))}</p><p class="muted">${backup?.latestTask?'Only tasks with a unique Acronis resource reference are shown.':'No uniquely matched backup task has been returned for this computer.'}</p><p class="muted">To run a backup, edit its schedule, or restore files, open the Acronis console and select this computer.</p><div class="actions"><button data-close>Close</button>${acronisData.consoleUrl?`<a class="button-link primary" href="${escape(acronisData.consoleUrl)}" target="_blank" rel="noopener noreferrer">Manage in Acronis ↗</a>`:''}</div>`);});
}
$('#backup-search').oninput=renderBackups;$('#backup-company').onchange=renderBackups;$('#backup-history-filter').onchange=renderBackups;
function linkAcronis(id){
  const d=inventory.devices.find(d=>d.id===id),link=acronisData.links.find(l=>l.node_id===id);
  showDialog(`<h2>Link Acronis device</h2><p class="muted">${escape(d.name)} · ${escape(d.company)}. Confirm the correct customer and computer before saving.</p><form id="acronis-link-form"><input type="hidden" name="nodeId" value="${escape(id)}"><label>Acronis resource<select name="resourceId">${options(acronisData.resources.map(r=>({id:r.id,name:r.tenant+' / '+r.name+' / '+r.type})),link?.resource_id,'Not linked')}</select></label><p class="muted">This links existing records; it does not create a backup plan or deploy an agent.</p>${actions('Save link')}</form>`);submitForm('#acronis-link-form','acronis-link',loadAcronis);
}
$('#acronis-connect').onclick=async()=>{const b=$('#acronis-connect');b.disabled=true;$('#acronis-status').textContent='Checking Acronis authentication…';try{renderAcronis(await api('acronis-connect',{}));}catch(error){$('#acronis-console').hidden=true;$('#acronis-status').textContent=error.message;}finally{b.disabled=false;}};
$('#modal').addEventListener('close',()=>$('#modal').classList.remove('wide'));
$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('login',Object.fromEntries(new FormData(e.target)));e.target.reset();message('');await refresh();}catch(error){message(error.message);}finally{b.disabled=false;}};
$('#logout').onclick=async()=>{try{await api('logout',{});$('#modal').close();$('#workspace').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;}catch(error){message(error.message);}};
$('#sync').onclick=async()=>{$('#sync').disabled=true;try{await api('sync',{});message('');}catch(error){message(error.message);}finally{await refresh();$('#sync').disabled=false;}};
$('#search').oninput=render;['#company-filter','#location-filter','#group-filter','#status-filter'].forEach(id=>$(id).onchange=render);
$('#add-customer').onclick=()=>{showDialog(`<h2>Add customer</h2><form id="customer-form"><label>Customer name<input name="name" required maxlength="120" placeholder="Client or customer contact"></label>${actions('Save customer')}</form>`);submitForm('#customer-form','customers');};
$('#add-company').onclick=companyForm;$('#add-device').onclick=()=>enroll($('#company-filter').value,$('#location-filter').value,$('#group-filter').value);$('#add-location').onclick=()=>locationForm();$('#add-group').onclick=()=>groupForm();bind('[data-page]',b=>changePage(b.dataset.page));
await refresh();setInterval(()=>{if(!$('#workspace').hidden)refresh();},30000);
