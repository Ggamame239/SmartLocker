// Owner panel frontend behavior
const panels = Array.from(document.querySelectorAll('.panel'));
const navLinks = document.querySelectorAll('.sidebar nav a');
const ownerNameEl = document.getElementById('ownerName');
let currentOwner = null;

function showPanel(id){
  panels.forEach(p=>p.classList.toggle('hidden', p.id!==id));
  navLinks.forEach(a=>a.classList.toggle('active', a.getAttribute('href')===(`#${id}`)));
}

navLinks.forEach(a=>a.addEventListener('click', (e)=>{
  e.preventDefault(); const id = a.getAttribute('href').slice(1); showPanel(id);
}));

// Login flow
const loginBtn = document.getElementById('loginBtn');
loginBtn.onclick = async ()=>{
  const deviceKey = document.getElementById('deviceKeyInput').value.trim();
  try{
    const res = await fetch('/owner/login', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({deviceKey})});
    const d = await res.json();
    if(!res.ok) throw new Error(d.message||'Login failed');
    currentOwner = d.username || 'owner'; ownerNameEl.textContent = currentOwner;
    document.getElementById('login').classList.add('hidden');
    showPanel('dashboard');
    await loadDashboard();
  }catch(e){ document.getElementById('loginError').textContent = e.message }
}

// logout
document.getElementById('logoutBtn').onclick = async ()=>{
  await fetch('/owner/logout',{method:'POST'});
  window.location.reload();
}

// Dashboard
async function loadDashboard(){
  try{
    const d = await ownerFetch('/dashboard');
    const cards = [
      ['Total Machines', d.totalMachines],
      ['Total Lockers', d.totalLockers],
      ['Available Lockers', d.availableLockers],
      ['Occupied Lockers', d.occupiedLockers],
      ['Pending Registration', d.pendingRegistration],
      ['Registered Users', d.registeredUsers],
      ['Online Devices', d.onlineDevices],
      ['Offline Devices', d.offlineDevices]
    ];
    const el = document.getElementById('dashboardCards'); el.innerHTML='';
    cards.forEach(([t,v])=>{ const c=document.createElement('div'); c.className='card'; c.innerHTML=`<strong>${v}</strong><div>${t}</div>`; el.appendChild(c) });
  }catch(e){ console.error(e) }
}

// Machines
document.getElementById('createMachine').onclick = async ()=>{
  const machineId = document.getElementById('machineId').value.trim();
  const name = document.getElementById('machineName').value.trim();
  const count = Number(document.getElementById('lockerCount').value)||0;
  try{ await postJSON('/machines',{machineId,name,lockerCount:count}); alert('Created'); await loadMachines(); }catch(e){ alert(e.message) }
}
async function loadMachines(){
  try{ const list = await ownerFetch('/machines'); const node = document.getElementById('machineList'); node.innerHTML=''; list.forEach(m=>{ const d=document.createElement('div'); d.className='card'; d.innerHTML=`<strong>${m.machineId}</strong><div>${m.name||''}</div><div>Lockers:${m.lockersCount||0}</div>`; node.appendChild(d) }) }catch(e){console.error(e)} }

// Lockers
async function loadLockers(){
  try{ const data = await ownerFetch('/lockers'); const tbody=document.querySelector('#lockersTable tbody'); tbody.innerHTML=''; data.forEach(l=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${l.lockerId}</td><td>${l.machineId||''}</td><td>${l.status||''}</td><td>${l.owner||''}</td><td>${l.rfidUid||''}</td><td>${l.registrationEnabled? 'Enabled':'Disabled'}</td><td><button data-id="${l.lockerId}" class="edit">Edit</button></td>`; tbody.appendChild(tr) }) }catch(e){console.error(e)} }

// Users
async function loadUsers(){
  try{ const data = await ownerFetch('/users'); const tbody=document.querySelector('#usersTable tbody'); tbody.innerHTML=''; data.forEach(u=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${u.username||u.uid}</td><td>${u.email||''}</td><td>${u.lockerQuota||0}</td><td>${(u.lockers||[]).length||0}</td><td><button data-uid="${u.uid}" class="editUser">Edit</button></td>`; tbody.appendChild(tr) }) }catch(e){console.error(e)} }

// Devices
async function loadDevices(){
  try{ const data = await ownerFetch('/devices'); const tbody=document.querySelector('#devicesTable tbody'); tbody.innerHTML=''; data.forEach(dv=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${dv.machineId}</td><td>${dv.online? 'Online':'Offline'}</td><td>${dv.firmware||''}</td><td>${dv.rssi||''}</td><td>${dv.lastSeen||''}</td><td>${dv.deviceKey||''}</td>`; tbody.appendChild(tr) }) }catch(e){console.error(e)} }

// Settings
document.getElementById('genDeviceKey').onclick = ()=>{ document.getElementById('serverDeviceKey').value = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,'0')).join('') }
document.getElementById('saveDeviceKey').onclick = async ()=>{
  const v = document.getElementById('serverDeviceKey').value.trim(); if(!v) return alert('Empty'); try{ await postJSON('/settings/deviceKey',{deviceKey:v}); alert('Saved') }catch(e){alert(e.message)} }

document.getElementById('exportDb').onclick = async ()=>{ try{ const data = await ownerFetch('/export'); const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='firebase-export.json'; a.click(); }catch(e){alert(e.message)} }

document.getElementById('importDb').onclick = async ()=>{
  const f = document.getElementById('importFile').files[0]; if(!f) return alert('Choose file'); const txt = await f.text(); try{ const json = JSON.parse(txt); await postJSON('/import', {data:json}); alert('Imported'); }catch(e){alert(e.message)} }

// initialize when owner authenticated
async function initIfAuth(){
  try{ await loadDashboard(); await loadMachines(); await loadLockers(); await loadUsers(); await loadDevices(); }catch(e){ console.warn('Not authenticated or load error',e) }
}

// Try to load dashboard on open (if session exists)
initIfAuth();

// simple hash navigation
window.addEventListener('hashchange', ()=>{ const id=location.hash.slice(1)||'dashboard'; showPanel(id) });
