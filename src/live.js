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
  $('#groups-panel').hidden=page!=='groups';$('#services-panel').hidden=page!=='services';
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
  $('#devices').innerHTML=devicesFiltered().map(d=>`<tr><td><button class="text-button" data-manage="${escape(d.id)}">${escape(d.name)}</button></td><td>${escape(d.company)}<small>${escape(d.location)}${d.mapped?'':' · Group not linked to a company'}</small></td><td>${escape(d.groupName)}</td><td>${escape(d.os)}</td><td><span class="badge ${d.online?'':'offline'}">${d.online?'Online':'Offline'}</span></td><td><div class="toolbar"><button data-remote="${escape(d.id)}" ${!d.online||inventory.error?'disabled':''}>Remote Desktop ↗</button>${d.windows?`<button data-services="${escape(d.id)}" ${!d.online||inventory.error?'disabled':''}>Services</button>`:''}</div></td></tr>`).join('')||'<tr><td colspan="6" class="empty">No matching devices. Use Add device to generate an enrollment link.</td></tr>';
  $('#service-devices').innerHTML=inventory.devices.filter(d=>d.windows).map(d=>`<div class="company-row"><div><strong>${escape(d.name)}</strong><p class="muted">${escape(d.company)} / ${escape(d.location)} · ${d.online?'Online':'Offline'}</p></div><button data-services="${escape(d.id)}" ${!d.online||inventory.error?'disabled':''}>View services</button></div>`).join('')||'<p class="empty">No Windows devices reported yet.</p>';
  bind('[data-invite]',b=>enroll(b.dataset.invite));bind('[data-group-invite]',b=>{const g=inventory.deviceGroups.find(g=>g.id===b.dataset.groupInvite);enroll(g.company_id,g.location_id,g.id);});
  bind('[data-remote]',b=>openRemote(b.dataset.remote));bind('[data-services]',b=>viewServices(b.dataset.services));bind('[data-manage]',b=>manageDevice(b.dataset.manage));
  bind('[data-edit-company]',b=>renameCompany(b.dataset.editCompany));bind('[data-company-location]',b=>locationForm(b.dataset.companyLocation));bind('[data-link-group]',b=>groupForm('', '', b.dataset.linkGroup));changePage(page);
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
function manageDevice(id){const d=inventory.devices.find(d=>d.id===id);showDialog(`<h2>${escape(d.name)}</h2><p class="muted">${escape(d.company)} / ${escape(d.location)} / ${escape(d.groupName)}</p><div class="detail-grid"><div>Operating system<strong>${escape(d.os)}</strong></div><div>Connection<strong>${d.online?'Online':'Offline'}</strong></div></div><div class="actions"><button data-close>Close</button>${d.windows?`<button id="device-services" ${!d.online||inventory.error?'disabled':''}>Windows services</button>`:''}<button id="device-remote" class="primary" ${!d.online||inventory.error?'disabled':''}>Remote Desktop ↗</button></div>`);$('#device-remote').onclick=()=>openRemote(id);if($('#device-services'))$('#device-services').onclick=()=>viewServices(id);}
async function viewServices(nodeId){
  const d=inventory.devices.find(d=>d.id===nodeId);if(!d?.online||inventory.error)return;
  showDialog(`<h2>Windows services</h2><p class="muted">${escape(d.name)} · ${escape(d.company)}</p><div class="toolbar"><input id="service-search" aria-label="Search services" placeholder="Search services…"><button id="refresh-services">Refresh status</button></div><p id="service-status" role="status">Retrieving services from the Windows agent…</p><p id="service-error" role="alert"></p><div id="services-body" class="table-wrap"></div><div class="actions"><button data-close>Close</button></div>`);$('#modal').classList.add('wide');
  let services=[],busy=false;
  const panel=$('#services-body');
  function rows(){const query=$('#service-search').value.toLowerCase();$('#services-body').innerHTML=`<table><thead><tr><th>SERVICE</th><th>STATUS</th><th>STARTUP</th><th>ACTIONS</th></tr></thead><tbody>${services.filter(s=>`${s.name} ${s.displayName}`.toLowerCase().includes(query)).map(s=>`<tr><td>${escape(s.displayName)}<small>${escape(s.name)}${s.protected?' · Protected service':''}</small></td><td>${escape(s.state)}</td><td>${escape(s.startMode)}</td><td><div class="toolbar">${['start','stop','restart'].map(action=>`<button data-service="${escape(s.name)}" data-service-action="${action}" ${busy||s.protected||(action==='start'&&s.state==='Running')||(action!=='start'&&s.state!=='Running')?'disabled':''}>${action[0].toUpperCase()+action.slice(1)}</button>`).join('')}</div></td></tr>`).join('')||'<tr><td colspan="4" class="empty">No matching services.</td></tr>'}</tbody></table>`;$('#services-body').querySelectorAll('[data-service-action]').forEach(b=>b.onclick=()=>{const action=b.dataset.serviceAction;if(action!=='start'&&!window.confirm(`${action==='stop'?'Stop':'Restart'} ${b.dataset.service} on ${d.name}? Applications using this service may be interrupted.`))return;run(action,b.dataset.service);});}
  async function run(action='list',name=''){
    if(busy)return;busy=true;$('#service-error').textContent='';$('#service-status').textContent=action==='list'?'Retrieving services from the Windows agent…':`Waiting for Windows to ${action} ${name}…`;$('#refresh-services').disabled=true;rows();
    try{const result=await api(action==='list'?'services':'service-action',{nodeId,action,name});if($('#services-body')!==panel)return;services=result.services;$('#service-status').textContent='Verified on device at '+new Date(result.checkedAt).toLocaleString();}
    catch(error){if($('#services-body')===panel){$('#service-error').textContent=error.message;$('#service-status').textContent='Status not verified. Refresh before retrying a change.';services=[];}}
    finally{busy=false;if($('#services-body')===panel){$('#refresh-services').disabled=false;rows();}}
  }
  $('#service-search').oninput=rows;$('#refresh-services').onclick=()=>run();await run();
}
$('#modal').addEventListener('close',()=>$('#modal').classList.remove('wide'));
$('#login-form').onsubmit=async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('login',Object.fromEntries(new FormData(e.target)));e.target.reset();message('');await refresh();}catch(error){message(error.message);}finally{b.disabled=false;}};
$('#logout').onclick=async()=>{try{await api('logout',{});$('#modal').close();$('#workspace').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;}catch(error){message(error.message);}};
$('#sync').onclick=async()=>{$('#sync').disabled=true;try{await api('sync',{});message('');}catch(error){message(error.message);}finally{await refresh();$('#sync').disabled=false;}};
$('#search').oninput=render;['#company-filter','#location-filter','#group-filter','#status-filter'].forEach(id=>$(id).onchange=render);
$('#add-customer').onclick=()=>{showDialog(`<h2>Add customer</h2><form id="customer-form"><label>Customer name<input name="name" required maxlength="120" placeholder="Client or customer contact"></label>${actions('Save customer')}</form>`);submitForm('#customer-form','customers');};
$('#add-company').onclick=companyForm;$('#add-device').onclick=()=>enroll($('#company-filter').value,$('#location-filter').value,$('#group-filter').value);$('#add-location').onclick=()=>locationForm();$('#add-group').onclick=()=>groupForm();bind('[data-page]',b=>changePage(b.dataset.page));
await refresh();setInterval(()=>{if(!$('#workspace').hidden)refresh();},30000);
