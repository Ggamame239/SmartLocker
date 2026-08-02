// API helper for owner panel
async function ownerFetch(path, opts={}){
  opts.headers = opts.headers || {};
  // include owner session cookie automatically
  opts.credentials = 'same-origin';
  const res = await fetch(`/api/owner${path}`, opts);
  const data = await res.json().catch(()=>null);
  if(!res.ok) throw new Error(data?.message || 'Request failed');
  return data;
}

async function postJSON(path, body){
  return ownerFetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
}
async function putJSON(path, body){
  return ownerFetch(path, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
}
async function del(path){
  return ownerFetch(path, { method:'DELETE'});
}
