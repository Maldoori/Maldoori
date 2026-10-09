const $ = s => document.querySelector(s);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let inventory = { groups:[], companies:[], devices:[] }, refreshing = false;
async function api(path, data) {
  const response = await fetch('/api/' + path, { method:data === undefined ? 'GET' : 'POST', headers:data === undefined ? {} : {'Content-Type':'application/json'}, body:data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (response.status === 401) { $('#workspace').hidden = true; $('#logout').hidden = true; $('#login').hidden = false; }
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
function message(text) { $('#message').textContent = text; }
function render() {
  $('#company-count').textContent = inventory.companies.length;
  $('#device-count').textContent = inventory.devices.length;
  $('#online-count').textContent = inventory.devices.filter(d => d.online).length;
  $('#connection').className = 'connection' + (inventory.error ? ' error' : '');
  $('#connection').textContent = inventory.error ? 'Synchronization failed: ' + inventory.error + (inventory.lastSync ? ' Showing the last successful snapshot from ' + new Date(inventory.lastSync).toLocaleString() + '.' : ' No inventory verified yet.') : 'Connected to MeshCentral · Last synchronized ' + new Date(inventory.lastSync).toLocaleString() + ' · Checks every 30 seconds';
  $('#companies').innerHTML = inventory.companies.map(c => `<div class="company-row"><div><strong>${escape(c.name)}</strong><p class="muted">${inventory.devices.filter(d => d.groupId === c.id).length} enrolled devices</p></div><button data-invite="${escape(c.id)}">Get enrollment link</button></div>`).join('') || '<p class="empty">No companies linked. Add a company or link an existing MeshCentral group.</p>';
  const selected = $('#company-filter').value;
  $('#company-filter').innerHTML = '<option value="">All groups</option>' + inventory.groups.map(g => `<option value="${escape(g.id)}">${escape(g.name)}</option>`).join('');
  if (inventory.groups.some(g => g.id === selected)) $('#company-filter').value = selected;
  const query = $('#search').value.toLowerCase();
  const devices = inventory.devices.filter(d => (!selected || d.groupId === selected) && `${d.name} ${d.company} ${d.os}`.toLowerCase().includes(query));
  $('#devices').innerHTML = devices.map(d => `<tr><td><strong>${escape(d.name)}</strong></td><td>${escape(d.company)}${d.mapped ? '' : '<small class="warning">Group not linked to a company</small>'}</td><td>${escape(d.os)}</td><td><span class="badge ${d.online ? '' : 'offline'}">${d.online ? 'Online' : 'Offline'}</span></td><td><button data-remote="${escape(d.id)}" ${!d.online || inventory.error ? 'disabled' : ''}>Remote Desktop ↗</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No devices match. Install a company agent to enroll a computer.</td></tr>';
  document.querySelectorAll('[data-invite]').forEach(button => button.onclick = async () => {
    button.disabled = true; message('');
    try {
      await createInvitation(button.dataset.invite);
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  });
  document.querySelectorAll('[data-remote]').forEach(button => button.onclick = () => {
    const device = inventory.devices.find(d => d.id === button.dataset.remote);
    if (device?.online && !inventory.error) window.open(device.desktopUrl, '_blank', 'noopener,noreferrer');
  });
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { inventory = await api('inventory'); $('#login').hidden = true; $('#workspace').hidden = false; $('#logout').hidden = false; render(); }
  catch (error) { if (!$('#workspace').hidden) message(error.message); }
  finally { refreshing = false; }
}
function showDialog(html) { $('#modal').innerHTML = html; $('#modal').showModal(); $('#modal').querySelectorAll('[data-close]').forEach(button => button.onclick = () => $('#modal').close()); }
async function createInvitation(groupId) {
  const company = inventory.companies.find(c => c.id === groupId);
  if (!company) throw new Error('Choose an existing company.');
  const value = await api('invitation', {groupId});
  showDialog(`<h2>Enroll a Windows computer</h2><p class="muted">Company: <strong>${escape(company.name)}</strong>. Share this enrollment link privately with the authorized customer. It expires in 24 hours.</p><a class="invite" href="${escape(value.url)}" target="_blank" rel="noopener noreferrer">${escape(value.url)}</a><ol class="muted"><li>Open the link on the Windows computer.</li><li>Download the matching Windows agent.</li><li>Run the installer with administrator permission and choose Install.</li><li>Leave the computer connected to the internet. It appears under ${escape(company.name)} after registration and the next synchronization.</li></ol><p class="muted">You can enroll multiple computers using this link while it is valid. Agent installation enables ongoing remote management. Explain this to the customer before installation.</p><div class="actions"><button id="copy-invite">Copy link</button><button data-close>Close</button></div>`);
  $('#copy-invite').onclick = async () => { try { await navigator.clipboard.writeText(value.url); $('#copy-invite').textContent = 'Copied'; } catch { $('#copy-invite').textContent = 'Select and copy link above'; } };
}
$('#add-device').onclick = () => {
  if (!inventory.companies.length) {
    showDialog('<h2>Add device</h2><p class="muted">First create a company or link your existing MeshCentral group. Once linked, you can add any number of computers to that company.</p><div class="actions"><button data-close>Cancel</button><button id="setup-company" class="primary">Set up company</button></div>');
    $('#setup-company').onclick = () => { $('#modal').close(); $('#add-company').click(); };
    return;
  }
  const selected = $('#company-filter').value;
  showDialog(`<h2>Add device</h2><p class="muted">Choose an existing company and generate its agent enrollment link. The computer appears automatically after the agent is installed and connects.</p><form id="add-device-form"><label>Company<select name="groupId" required>${inventory.companies.map(c => `<option value="${escape(c.id)}" ${c.id === selected ? 'selected' : ''}>${escape(c.name)}</option>`).join('')}</select></label><p id="enrollment-error" role="alert"></p><div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Generate enrollment link</button></div></form>`);
  $('#add-device-form').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('.primary'); button.disabled = true;
    $('#enrollment-error').textContent = '';
    try { await createInvitation(new FormData(event.target).get('groupId')); }
    catch (error) { if ($('#enrollment-error')) $('#enrollment-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
};
$('#login-form').onsubmit = async event => {
  event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
  try { await api('login', Object.fromEntries(new FormData(event.target))); event.target.reset(); message(''); await refresh(); } catch (error) { message(error.message); } finally { button.disabled = false; }
};
$('#logout').onclick = async () => { try { await api('logout', {}); $('#modal').close(); $('#workspace').hidden = true; $('#logout').hidden = true; $('#login').hidden = false; inventory = {groups:[],companies:[],devices:[]}; } catch (error) { message(error.message); } };
$('#sync').onclick = async () => { $('#sync').disabled = true; try { await api('sync', {}); message(''); } catch (error) { message(error.message); } finally { await refresh(); $('#sync').disabled = false; } };
$('#search').oninput = render;
$('#company-filter').onchange = render;
$('#add-company').onclick = () => {
  const linked = new Set(inventory.companies.map(c => c.id));
  const groups = inventory.groups.filter(g => g.type === 2 && !linked.has(g.id));
  showDialog(`<h2>Add company</h2><form id="company-form"><label>Company name<input name="name" required maxlength="120" placeholder="Company name"></label><label>MeshCentral group<select name="groupId"><option value="">Create a new agent device group</option>${groups.map(g => `<option value="${escape(g.id)}">Link existing: ${escape(g.name)}</option>`).join('')}</select></label><p class="muted">Existing group links preserve enrolled devices. A new group starts empty.</p><div class="actions"><button type="button" data-close>Cancel</button><button class="primary">Save company</button></div></form>`);
  $('#company-form').onsubmit = async event => {
    event.preventDefault(); const button = event.target.querySelector('.primary'); button.disabled = true;
    try { await api('companies', Object.fromEntries(new FormData(event.target))); $('#modal').close(); message(''); await refresh(); } catch (error) { message(error.message); } finally { button.disabled = false; }
  };
};
await refresh();
setInterval(() => { if (!$('#workspace').hidden) refresh(); }, 30000);
