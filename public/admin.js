/* JOTO RAMEN: admin panel (multi-branch). Supabase Auth + Row Level Security; no passwords in this file. */
(function(){
'use strict';
var CANCEL_MS=window.JOTO_CANCEL_MS||120000; /* the customer's cancel window; a demo can shorten it */
var S={me:null,menu:[],orders:[],res:[],events:[],locs:[],reviews:[],gallery:[],settings:{},reqs:[],pays:[],activity:[],team:[],users:[],
  branch:'all',view:'dashboard',f:{order:'all',res:'all',rev:'all',otype:'all'},timer:null,tick:null,seen:null,seenReq:null,seenPay:null,silenced:false};
var $=function(id){return document.getElementById(id);};
var val=function(id){var e=$(id);return e?e.value.trim():'';};
var CATS={ramen:'Ramen',starters:'Starters',sides:'Sides',drinks:'Drinks',desserts:'Desserts',toppings:'Toppings'};
var TITLES={dashboard:'Dashboard',orders:'Orders',payments:'Payments',menu:'Menu & Prices',reservations:'Reservations',events:'Events',locations:'Locations',tables:'Tables & QR',reviews:'Reviews',gallery:'Gallery',staff:'Staff',settings:'Settings'};
var BADGE={pending:'warning',confirmed:'info',completed:'success',approved:'success',cancelled:'danger'};
var TYPE_LABEL={dine_in:'Dine-in',delivery:'Delivery',pickup:'Pickup'};
var _UNUSED_ACT_LABEL={login:['🔑','Signed in'],shift_start:['🟢','Started shift'],shift_end:['⚪','Ended shift'],order_placed:['🧾','Took an order'],order_accepted:['👍','Accepted order'],order_ready:['🍜','Order ready'],order_served:['✅','Served'],order_cancelled:['✖','Cancelled order'],payment:['💵','Recorded payment'],table_paid:['💳','Closed a table'],request_done:['🙋','Answered a request']};

function fail(err){ showToast(friendlyError(err),'error'); }
async function run(q,okMsg){ var r; try{ r=await q; }catch(e){ fail(e); return null; } if(r.error){ fail(r.error); return null; } if(okMsg) showToast(okMsg,'success'); return r.data===undefined?true:(r.data||true); }
async function fnError(err){ try{ var j=await err.context.json(); if(j&&j.error) return j.error; }catch(e){} return (err&&err.message)||'Something went wrong'; }
function pill(s,cls){ return '<span class="pill '+esc(cls||s)+'">'+esc(capitalize(s))+'</span>'; }
function fmtDate(d){ if(!d) return ''; var x=new Date(String(d).length===10?d+'T00:00:00':d); return isNaN(x)?esc(d):x.toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short',year:'numeric'}); }
function today(){ return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi'}); }
function dayOf(ts){ return new Date(ts).toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi'}); }
function byId(l,id){ return l.find(function(x){return String(x.id)===String(id);}); }
function locName(id){ var l=byId(S.locs,id); return l?l.name:'No branch'; }
function shortLoc(id){ var n=locName(id), m=n.match(/\(([^)]+)\)/); return (m?m[1]:n.split(',')[0]).trim(); }
function inBr(row){ return S.branch==='all'||String(row.location_id)===String(S.branch); }
function inBrShared(row){ return S.branch==='all'||!row.location_id||String(row.location_id)===String(S.branch); }
function ago(ts){ if(!ts) return 'never'; var m=Math.round((Date.now()-Date.parse(ts))/60000); if(m<1) return 'just now'; if(m<60) return m+' min ago'; var h=Math.round(m/60); if(h<24) return h+' h ago'; return Math.round(h/24)+' d ago'; }
function digits(p){ var d=String(p||'').replace(/\D/g,''); if(/^0\d{9}$/.test(d)) return '254'+d.slice(1); if(/^[17]\d{8}$/.test(d)) return '254'+d; return d; }
function mmss(n){ return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); }
function isMgr(){ return S.me&&S.me.role==='manager'; }
function canEdit(row){ return !isMgr()||String(row.location_id)===String(S.me.loc); }
function branchOptions(sel,withAll,allLabel){ return (withAll&&!isMgr()?'<option value="">'+esc(allLabel||'All branches')+'</option>':'')+S.locs.map(function(l){return '<option value="'+l.id+'"'+(String(sel)===String(l.id)?' selected':'')+'>'+esc(l.name)+'</option>';}).join(''); }

/* ---------- auth ---------- */
async function boot(){
  if(!JOTO_READY){ $('login-msg').textContent='Backend not configured: edit public/config.js'; return; }
  sb.auth.onAuthStateChange(function(ev){ if(ev==='SIGNED_OUT') showLogin(); });
  var s=await sb.auth.getSession();
  if(s.data&&s.data.session&&await verifyAdmin(s.data.session.user)) start(); else showLogin();
}
async function verifyAdmin(user){
  var p=await sb.from('profiles').select('name,is_admin,is_manager,is_active,location_id').eq('id',user.id).maybeSingle(), d=p.data;
  if(d&&d.is_admin){ S.me={id:user.id,email:user.email,name:d.name,role:'owner',loc:null}; return true; }
  if(d&&d.is_manager&&d.is_active&&d.location_id){ S.me={id:user.id,email:user.email,name:d.name,role:'manager',loc:d.location_id}; return true; }
  return false;
}
function showLogin(){ clearInterval(S.timer); clearInterval(S.tick); Alerts.stopReminder(); $('app').classList.add('hidden'); $('login-screen').classList.remove('hidden'); }
function start(){
  $('login-screen').classList.add('hidden'); $('app').classList.remove('hidden'); document.body.classList.toggle('role-manager',S.me.role==='manager'); if(S.me.role==='manager'){ var nm=document.querySelector('.nav[data-view="menu"]'), nl=document.querySelector('.nav[data-view="locations"]'); if(nm) nm.textContent='🍜 Dishes served here'; if(nl) nl.textContent='📍 My restaurant'; TITLES.menu='Dishes served here'; TITLES.locations='My restaurant'; } $('who').textContent=S.me.email; go(S.me.role==='manager'?'orders':'dashboard'); refresh();
  clearInterval(S.timer); S.timer=setInterval(function(){ refresh(true); },window.JOTO_POLL_MS||15000);
  clearInterval(S.tick); S.tick=setInterval(tickCountdowns,1000);
  Alerts.startReminder(function(){ return !S.silenced&&S.orders.some(function(o){return o.status==='pending';}); },'order',30000);
  alertBtn(); Alerts.askPermission().then(notifState);
  try{ sb.channel('admin-live').on('postgres_changes',{event:'*',schema:'public',table:'orders'},function(){refresh(true);}).on('postgres_changes',{event:'*',schema:'public',table:'service_requests'},function(){refresh(true);}).on('postgres_changes',{event:'*',schema:'public',table:'payments'},function(){refresh(true);}).subscribe(); }catch(e){}
}
async function login(e){
  e.preventDefault(); if(!JOTO_READY){ showToast('Backend not configured','error'); return; }
  var b=$('login-btn'); b.disabled=true; b.textContent='Signing in…';
  var r=await sb.auth.signInWithPassword({email:val('login-email'),password:$('login-password').value});
  b.disabled=false; b.textContent='Sign in';
  if(r.error){ $('login-msg').textContent='Wrong email or password.'; return; }
  if(!(await verifyAdmin(r.data.user))){ await sb.auth.signOut(); $('login-msg').textContent='This account does not have admin access.'; return; }
  $('login-password').value=''; $('login-msg').textContent=''; start();
}
async function logout(){ if(sb) await sb.auth.signOut(); S.me=null; document.body.classList.remove('role-manager'); showLogin(); }
async function savePassword(){
  var cur=$('p-cur').value, nw=$('p-new').value;
  if(nw.length<10){ showToast('New password needs 10 or more characters','error'); return; }
  var re=await sb.auth.signInWithPassword({email:S.me.email,password:cur});
  if(re.error){ showToast('Current password is wrong','error'); return; }
  if(await run(sb.auth.updateUser({password:nw}),'Password changed')){ $('p-cur').value=''; $('p-new').value=''; }
}

/* ---------- data ---------- */
async function refresh(quiet){
  var q=await Promise.all([
    sb.from('menu_items').select('*').order('category').order('name'),
    sb.from('orders').select('*, order_items(name,quantity)').order('created_at',{ascending:false}).limit(400),
    sb.from('reservations').select('*').order('created_at',{ascending:false}).limit(300),
    sb.from('events').select('*').order('event_date',{ascending:false}),
    sb.from('locations').select('*').order('sort_order').order('id'),
    sb.from('reviews').select('*').order('created_at',{ascending:false}).limit(300),
    sb.from('gallery').select('*').order('created_at',{ascending:false}),
    sb.from('settings').select('key,value'),
    sb.from('service_requests').select('*').eq('status','open').order('created_at'),
    sb.from('payments').select('*').order('created_at',{ascending:false}).limit(500)
  ]);
  var bad=q.find(function(x){return x.error;}); if(bad&&!quiet) fail(bad.error);
  S.menu=q[0].data||S.menu; S.orders=q[1].data||S.orders; S.res=q[2].data||S.res; S.events=q[3].data||S.events; S.locs=q[4].data||S.locs;
  S.reviews=q[5].data||S.reviews; S.gallery=q[6].data||S.gallery;
  if(S.me.role==='manager'){ S.locs=S.locs.filter(function(l){return String(l.id)===String(S.me.loc);}); S.branch=String(S.me.loc); var mine=S.locs[0]; $('rolebar').textContent='You are the manager of '+(mine?mine.name:'your restaurant')+'. You only see this restaurant: its orders, reviews, reservations, payments and staff.'; }
  if(q[7].data){ S.settings={}; q[7].data.forEach(function(x){S.settings[x.key]=x.value;}); }
  if(q[8]&&q[8].data) S.reqs=q[8].data; if(q[9]&&q[9].data) S.pays=q[9].data;
  fillBranchSelects(); detect();
  render();
}
function fillBranchSelects(){
  var bf=$('branch-filter'), cur=S.branch;
  bf.innerHTML='<option value="all">All branches</option>'+S.locs.map(function(l){return '<option value="'+l.id+'">'+esc(shortLoc(l.id))+'</option>';}).join(''); bf.value=String(cur);
  if(bf.value!==String(cur)){ S.branch='all'; bf.value='all'; }
  [['t-branch'],['mg-branch']].forEach(function(x){ var e=$(x[0]); if(!e) return; var keep=e.value; e.innerHTML=branchOptions(keep||(S.branch!=='all'?S.branch:''),false); if(keep) e.value=keep; });
}

/* ---------- navigation ---------- */
function go(v){
  S.view=v; document.querySelectorAll('.view').forEach(function(s){s.classList.add('hidden');});
  $('v-'+v).classList.remove('hidden');
  document.querySelectorAll('.nav[data-view]').forEach(function(n){n.classList.toggle('active',n.dataset.view===v);});
  $('title').textContent=TITLES[v]; $('side').classList.remove('open');
  if(v==='staff'&&S.me.role==='owner') loadUsers();
  if(v==='orders') Alerts.stopFlash();
  render();
}
function render(){
  var br=function(l){return l.filter(inBr);};
  var po=br(S.orders).filter(function(o){return o.status==='pending';}).length, pr=br(S.res).filter(function(r){return r.status==='pending';}).length, pv=br(S.reviews).filter(function(r){return r.status==='pending';}).length;
  [['b-orders',po],['b-res',pr],['b-rev',pv]].forEach(function(b){ var e=$(b[0]); e.textContent=b[1]; e.classList.toggle('hidden',!b[1]); });
  document.title=(po?'('+po+') ':'')+'Joto Ramen: Admin'; Alerts.setBaseTitle(document.title);
  ({dashboard:rDash,orders:rOrders,payments:rPayments,menu:rMenu,reservations:rRes,events:rEvents,locations:rLocs,tables:rTables,reviews:rRev,gallery:rGal,staff:rStaff,settings:rSettings})[S.view]();
}
function chips(el,list,cur,key,counts){ el.innerHTML=list.map(function(c){ return '<button class="chip'+(cur===c?' active':'')+'" data-act="chip" data-key="'+key+'" data-id="'+c+'">'+esc(capitalize(c))+(counts?' ('+counts(c)+')':'')+'</button>'; }).join(''); }

/* ---------- dashboard ---------- */
function paidToday(){ return S.pays.filter(function(p){return p.status==='success'&&inBr(p)&&dayOf(p.paid_at||p.created_at)===today();}).reduce(function(s,p){return s+p.amount;},0); }
function rDash(){
  var t=today(), orders=S.orders.filter(inBr);
  var todays=orders.filter(function(o){return dayOf(o.created_at)===t&&o.status!=='cancelled';}), sales=todays.reduce(function(s,o){return s+o.total;},0);
  var po=orders.filter(function(o){return o.status==='pending';}), pr=S.res.filter(inBr).filter(function(r){return r.status==='pending';}), pv=S.reviews.filter(inBr).filter(function(r){return r.status==='pending';});
  var reqs=S.reqs.filter(inBr);
  var h='<div class="grid g4" style="margin-bottom:16px">'+
   '<div class="stat" data-act="view" data-id="orders"><b>'+po.length+'</b><span>New orders to confirm</span></div>'+
   '<div class="stat" data-act="view" data-id="orders"><b>'+todays.length+'</b><span>Orders today ('+money(sales)+')</span></div>'+
   '<div class="stat" data-act="view" data-id="payments"><b>'+money(paidToday())+'</b><span>Payments received today</span></div>'+
   '<div class="stat" data-act="view" data-id="reservations"><b>'+pr.length+'</b><span>Reservations waiting</span></div></div>';
  h+='<div class="card"><h3>Quick actions</h3><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'+(isMgr()?
   '<button class="btn primary" data-act="view" data-id="orders">View orders</button><button class="btn primary" data-act="event-new">+ Post event</button><button class="btn" data-act="view" data-id="tables">Table QR codes</button><button class="btn" data-act="view" data-id="menu">Dishes served here</button>':
   '<button class="btn primary" data-act="menu-new">+ Add dish</button><button class="btn primary" data-act="event-new">+ Post event</button><button class="btn" data-act="loc-new">+ Add branch</button>'+
   '<button class="btn" data-act="view" data-id="staff">Restaurant admins</button><button class="btn" data-act="view" data-id="menu">Change prices</button><button class="btn" data-act="view" data-id="settings">Change phone number</button>')+'</div></div>';
  if(S.branch==='all'&&S.locs.length>1) h+='<div class="card"><h3>Branches today</h3>'+S.locs.map(function(l){
    var os=S.orders.filter(function(o){return String(o.location_id)===String(l.id)&&dayOf(o.created_at)===t&&o.status!=='cancelled';});
    var pend=S.orders.filter(function(o){return String(o.location_id)===String(l.id)&&o.status==='pending';}).length;
    var paid=S.pays.filter(function(p){return String(p.location_id)===String(l.id)&&p.status==='success'&&dayOf(p.paid_at||p.created_at)===t;}).reduce(function(s,p){return s+p.amount;},0);
    return '<div class="row"><div class="grow"><div class="name">'+esc(l.name)+(l.is_active?'':' <span class="pill pending">Hidden</span>')+'</div><div class="meta">'+os.length+' orders · '+money(os.reduce(function(s,o){return s+o.total;},0))+' sales · '+money(paid)+' received</div></div>'+(pend?'<span class="pill pending">'+pend+' waiting</span>':'')+'<button class="btn sm" data-act="pick-branch" data-id="'+l.id+'">Open</button></div>';}).join('')+'</div>';
  if(reqs.length) h+='<div class="card"><h3>Table requests</h3>'+reqs.map(function(r){
    return '<div class="row"><div class="grow"><div class="name">'+(r.kind==='bill'?'🧾 Bill':'🙋 Waiter')+' · Table '+esc(r.table_label)+'</div><div class="meta">'+esc(shortLoc(r.location_id))+' · '+new Date(r.created_at).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})+'</div></div><button class="btn sm good" data-act="req-done" data-id="'+r.id+'">Done</button></div>';}).join('')+'</div>';
  h+='<div class="card"><h3>Orders waiting for you</h3>'+(po.length?po.slice(0,6).map(function(o){
    var left=winLeft(o);
    return '<div class="row"><div class="grow"><div class="name">#'+o.id+' · '+esc(o.name)+' <span class="tag">'+esc(shortLoc(o.location_id))+'</span></div><div class="meta">'+(o.phone?esc(o.phone)+' · ':'')+money(o.total)+' · '+esc(TYPE_LABEL[o.order_type]||o.order_type)+'</div></div>'+
     (left>0?'<button class="btn sm" disabled data-until="'+esc(o.created_at)+'">Customer can still cancel: '+mmss(left)+'</button>':'<button class="btn sm good" data-act="order-status" data-id="'+o.id+'" data-s="confirmed">Confirm</button>')+'<button class="btn sm danger" data-act="order-status" data-id="'+o.id+'" data-s="cancelled">Cancel</button></div>';}).join(''):'<div class="empty">Nothing waiting. 🎉</div>')+'</div>';
  var open={}; orders.filter(function(o){return o.order_type==='dine_in'&&o.status!=='cancelled'&&o.payment_status!=='paid'&&Date.now()-Date.parse(o.created_at)<86400000;}).forEach(function(o){ var k=o.location_id+'|'+o.table_label; (open[k]=open[k]||{loc:o.location_id,table:o.table_label,n:0,total:0,status:[]}); open[k].n++; open[k].total+=o.total; open[k].status.push(o.status); });
  var tabs=Object.keys(open).map(function(k){return open[k];});
  h+='<div class="card"><h3>Open tables</h3>'+(tabs.length?tabs.map(function(t){ var rdy=t.status.indexOf('ready')!==-1;
    return '<div class="row"><div class="grow"><div class="name">Table '+esc(t.table)+(S.branch==='all'?' <span class="tag">'+esc(shortLoc(t.loc))+'</span>':'')+(rdy?' <span class="pill online">ready to serve</span>':'')+'</div><div class="meta">'+t.n+' order'+(t.n===1?'':'s')+' · bill '+money(t.total)+'</div></div><button class="btn sm good" data-act="pay-table" data-table="'+esc(t.table)+'" data-loc="'+t.loc+'">Mark table paid</button></div>';}).join(''):'<div class="empty">No open tables.</div>')+'</div>';
  h+='<div class="grid g2"><div class="card"><h3>Reservations waiting</h3>'+(pr.length?pr.slice(0,5).map(function(r){
    return '<div class="row"><div class="grow"><div class="name">'+esc(r.name)+' · '+r.guests+' guests</div><div class="meta">'+fmtDate(r.date)+' '+esc(String(r.time).slice(0,5))+' · '+esc(r.location_id?shortLoc(r.location_id):r.location)+'</div></div><button class="btn sm good" data-act="res-status" data-id="'+r.id+'" data-s="confirmed">Confirm</button></div>';}).join(''):'<div class="empty">None</div>')+'</div>'+
   '<div class="card"><h3>Reviews to approve</h3>'+(pv.length?pv.slice(0,5).map(function(r){
    return '<div class="row"><div class="grow"><div class="name">'+esc(r.name)+' · '+r.rating+'★</div><div class="meta">'+esc(r.text.slice(0,70))+'</div></div><button class="btn sm good" data-act="rev-approve" data-id="'+r.id+'">Approve</button></div>';}).join(''):'<div class="empty">None</div>')+'</div></div>';
  $('v-dashboard').innerHTML=h;
}

/* ---------- orders ---------- */
function winLeft(o){ return (o.status==='pending'&&(o.source==='web'||o.source==='qr'))?Math.max(0,Math.ceil((Date.parse(o.created_at)+CANCEL_MS-Date.now())/1000)):0; }
function payOf(o){ var p=S.pays.filter(function(x){return x.order_id===o.id&&x.status==='success';})[0]; return p?(p.method==='mpesa'?'M-Pesa':capitalize(p.method))+(p.mpesa_receipt?' · '+p.mpesa_receipt:''):''; }
function waLink(o){
  var msg=o.status==='ready'?('Hi '+o.name+', your Joto Ramen order #'+o.id+' is ready. Thank you!'):('Hi '+o.name+', this is Joto Ramen. We have received your order #'+o.id+' (KSh '+o.total+') and it is '+(o.status==='confirmed'?'being prepared':'being confirmed')+'.');
  return 'https://wa.me/'+digits(o.phone)+'?text='+encodeURIComponent(msg);
}
function rOrders(){
  var f=S.f.order, t=S.f.otype, inb=S.orders.filter(inBr);
  $('otype-chips').innerHTML=[['all','All'],['dine_in','🍽️ Dine in'],['pickup','🛍️ Pickup'],['delivery','🛵 Delivery']].map(function(x){ var n=x[0]==='all'?inb.length:inb.filter(function(o){return o.order_type===x[0];}).length;
    return '<button class="chip'+(t===x[0]?' active':'')+'" data-act="otype" data-id="'+x[0]+'">'+x[1]+' ('+n+')</button>'; }).join('');
  var base=inb; if(t!=='all') base=base.filter(function(o){return o.order_type===t;});
  chips($('order-chips'),['all','pending','confirmed','ready','completed','cancelled'],f,'order',function(c){return c==='all'?base.length:base.filter(function(o){return o.status===c;}).length;});
  var rows=f==='all'?base:base.filter(function(o){return o.status===f;});
  $('orders-list').innerHTML=rows.length?rows.map(function(o){
    var items=(o.order_items||[]).map(function(i){return i.quantity+'× '+esc(i.name);}).join(', '), left=winLeft(o), dine=o.order_type==='dine_in';
    var next=o.status==='pending'?[['confirmed','Confirm','good']]:o.status==='confirmed'?[['ready',dine?'Ready to serve':(o.order_type==='delivery'?'Out for delivery':'Ready for pickup'),'good']]:o.status==='ready'?[['completed',dine?'Served':'Completed','good']]:[];
    var canCancel=o.status==='pending'||o.status==='confirmed'||o.status==='ready';
    var btns=next.map(function(n){ return left>0?'<button class="btn sm" disabled data-until="'+esc(o.created_at)+'">Customer can still cancel: '+mmss(left)+'</button>':'<button class="btn sm '+n[2]+'" data-act="order-status" data-id="'+o.id+'" data-s="'+n[0]+'">'+n[1]+'</button>'; }).join('');
    var pay=payOf(o);
    return '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><b>Order #'+o.id+'</b> '+pill(o.status)+' '+pill(o.payment_status)+
      '<span class="tag">'+esc(shortLoc(o.location_id))+'</span><span class="tag">'+(dine?'Dine-in · Table '+esc(o.table_label):esc(TYPE_LABEL[o.order_type]||o.order_type))+'</span>'+(o.source==='qr'?'<span class="tag">QR</span>':o.source==='waiter'?'<span class="tag">Waiter</span>':'')+
      '<div class="meta" style="color:var(--muted)">'+new Date(o.created_at).toLocaleString('en-KE')+'</div></div><div style="text-align:right"><div style="font-size:1.3rem;font-weight:700">'+money(o.total)+'</div>'+(pay?'<div class="meta" style="color:var(--green)">'+esc(pay)+'</div>':'')+'</div></div>'+
      '<p style="margin:10px 0 4px"><b>'+esc(o.name)+'</b>'+(o.phone?' · <a href="tel:'+esc(String(o.phone).replace(/[^+\d]/g,''))+'">'+esc(o.phone)+'</a>':'')+(o.email?' · '+esc(o.email):'')+'</p>'+
      '<p class="items" style="margin:0">'+items+'</p>'+(dine?'':'<p class="items" style="margin:4px 0">'+esc(capitalize(o.order_type))+(o.address?' to '+esc(o.address):'')+' · subtotal '+money(o.subtotal)+(o.delivery_fee?' + delivery '+money(o.delivery_fee):'')+'</p>')+
      (o.notes?'<p class="items" style="margin:4px 0">Note: '+esc(o.notes)+'</p>':'')+(o.payment_note?'<p class="items" style="margin:4px 0;color:#ff9a90">Payment: '+esc(o.payment_note)+'</p>':'')+(o.status==='cancelled'&&o.cancelled_by?'<p class="items" style="margin:4px 0">Cancelled by '+esc(o.cancelled_by)+'</p>':'')+
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'+btns+(canCancel?'<button class="btn sm danger" data-act="order-status" data-id="'+o.id+'" data-s="cancelled">Cancel order</button>':'')+
      (o.payment_status!=='paid'&&o.status!=='cancelled'?'<button class="btn sm" data-act="order-paid" data-id="'+o.id+'">Mark as paid</button>':'')+
      (o.phone&&o.order_type!=='dine_in'?'<a class="btn sm" href="'+esc(waLink(o))+'" target="_blank" rel="noopener" data-act="wa">💬 WhatsApp</a>':'')+
      '<button class="btn sm" data-act="print-order" data-id="'+o.id+'">🖨 Print</button>'+(S.me.role==='owner'?'<button class="btn sm danger" data-act="order-del" data-id="'+o.id+'">Delete</button>':'')+'</div></div>';}).join(''):'<div class="card empty">No orders here yet.</div>';
}
function tickCountdowns(){
  var els=document.querySelectorAll('[data-until]'), done=false;
  els.forEach(function(e){ var left=Math.ceil((Date.parse(e.dataset.until)+CANCEL_MS-Date.now())/1000); if(left<=0) done=true; else e.textContent='Customer can still cancel: '+mmss(left); });
  if(done&&S.view==='orders') rOrders(); else if(done&&S.view==='dashboard') rDash();
}
async function orderStatus(id,s){ if(s==='cancelled'&&!confirm('Cancel this order?')) return; var r=await run(sb.from('orders').update({status:s,cancelled_by:s==='cancelled'?'admin':null}).eq('id',id),'Order '+(s==='ready'?'marked ready':s)); if(r) refresh(true); }
function openPay(id){ var o=byId(S.orders,id); if(!o) return; $('pm-order').dataset.table=''; $('pm-order').value=o.id; $('pm-info').textContent='Order #'+o.id+' · '+o.name+' · '+money(o.total); $('pm-method').value='cash'; $('pm-note').value=''; open('m-pay'); }
async function savePay(e){
  e.preventDefault(); var po=$('pm-order'), method=$('pm-method').value, r;
  if(po.dataset.table){ var tb=po.dataset.table, lc=Number(po.dataset.loc); po.dataset.table=''; r=await run(sb.rpc('pay_table',{p_table:tb,p_method:method,p_location:lc}),'Table '+tb+' marked as paid'); }
  else r=await run(sb.rpc('record_payment',{p_order:Number(po.value),p_method:method,p_note:val('pm-note')||null}),'Payment recorded');
  if(r){ closeAll(); refresh(true); }
}
function payTable(table,loc){ $('pm-order').value=''; $('pm-order').dataset.table=table; $('pm-order').dataset.loc=loc; $('pm-info').textContent='Table '+table+(S.branch==='all'?' · '+shortLoc(loc):'')+': all open orders'; $('pm-method').value='cash'; $('pm-note').value=''; open('m-pay'); }
function printOrder(id){
  var o=byId(S.orders,id); if(!o) return; var items=(o.order_items||[]).map(function(i){return '<div>'+i.quantity+' x '+esc(i.name)+'</div>';}).join('');
  $('print-slip').innerHTML='<div style="text-align:center;font-weight:700;font-size:16px">JOTO RAMEN</div><div style="text-align:center">'+esc(locName(o.location_id))+'</div><hr>'+
    '<div><b>ORDER #'+o.id+'</b> · '+new Date(o.created_at).toLocaleString('en-KE')+'</div>'+
    '<div style="font-size:18px;font-weight:700;margin:4px 0">'+(o.order_type==='dine_in'?'DINE IN · TABLE '+esc(o.table_label):esc((TYPE_LABEL[o.order_type]||o.order_type).toUpperCase()))+'</div>'+
    (o.name&&o.order_type!=='dine_in'?'<div>'+esc(o.name)+(o.phone?' · '+esc(o.phone):'')+'</div>':'')+(o.address?'<div>'+esc(o.address)+'</div>':'')+'<hr>'+items+(o.notes?'<hr><div><b>NOTE:</b> '+esc(o.notes)+'</div>':'')+
    '<hr><div style="display:flex;justify-content:space-between"><b>TOTAL</b><b>KSh '+Number(o.total).toLocaleString()+'</b></div><div>'+(o.payment_status==='paid'?'PAID':'NOT PAID')+'</div>';
  document.body.classList.add('printing-slip'); setTimeout(function(){ window.print(); setTimeout(function(){ document.body.classList.remove('printing-slip'); },500); },50);
}
async function orderDel(id){ if(!confirm('Delete this order permanently?')) return; if(await run(sb.from('orders').delete().eq('id',id),'Order deleted')) refresh(true); }

/* ---------- payments ---------- */
function payRows(){
  var days=parseInt($('pay-days').value,10), m=$('pay-method').value, st=$('pay-status').value, since=days>0?Date.now()-(days===1?0:days*86400000):0;
  return S.pays.filter(function(p){
    if(!inBr(p)) return false;
    if(days===1&&dayOf(p.created_at)!==today()) return false;
    if(days>1&&Date.parse(p.created_at)<since) return false;
    return (m==='all'||p.method===m)&&(st==='all'||p.status===st);
  });
}
function rPayments(){
  var rows=payRows(), ok=rows.filter(function(p){return p.status==='success';});
  var tot=function(l){return l.reduce(function(s,p){return s+p.amount;},0);};
  var by=function(m){return tot(ok.filter(function(p){return p.method===m;}));};
  $('pay-summary').innerHTML='<div class="stat"><b>'+money(tot(ok))+'</b><span>Received ('+ok.length+' payments)</span></div><div class="stat"><b>'+money(by('mpesa'))+'</b><span>M-Pesa</span></div><div class="stat"><b>'+money(by('cash'))+'</b><span>Cash</span></div><div class="stat"><b>'+money(by('card')+by('other'))+'</b><span>Card and other</span></div>'+
    '<div class="stat"><b>'+rows.filter(function(p){return p.status==='pending';}).length+'</b><span>Waiting for customer PIN</span></div><div class="stat"><b>'+rows.filter(function(p){return p.status==='failed';}).length+'</b><span>Failed or cancelled</span></div>';
  $('pay-list').innerHTML=rows.length?'<table><thead><tr><th>When</th><th>Order</th><th>Branch</th><th>Method</th><th>Amount</th><th>Status</th><th>Reference</th></tr></thead><tbody>'+rows.map(function(p){
    var o=byId(S.orders,p.order_id);
    return '<tr><td>'+new Date(p.created_at).toLocaleString('en-KE')+'</td><td>'+(o?'#'+o.id+' '+esc(o.name):(p.order_id?'#'+p.order_id:'-'))+'</td><td>'+esc(shortLoc(p.location_id))+'</td><td>'+esc(p.method==='mpesa'?'M-Pesa':capitalize(p.method))+(p.phone?'<br><span class="meta" style="color:var(--muted)">'+esc(p.phone)+'</span>':'')+'</td><td><b>'+money(p.amount)+'</b></td><td>'+pill(p.status==='success'?'received':p.status,p.status==='success'?'paid':p.status==='pending'?'pending':'failed')+'</td><td>'+esc(p.mpesa_receipt||p.note||'')+'</td></tr>';}).join('')+'</tbody></table>':'<div class="empty">No payments for these filters.</div>';
}
function exportPayments(){
  var rows=payRows(); var esc2=function(v){ v=String(v==null?'':v); return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v; };
  var csv=['When,Order,Branch,Method,Amount,Status,Phone,Receipt,Note'].concat(rows.map(function(p){ return [new Date(p.created_at).toISOString(),p.order_id||'',shortLoc(p.location_id),p.method,p.amount,p.status,p.phone||'',p.mpesa_receipt||'',p.note||''].map(esc2).join(','); })).join('\n');
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='joto-payments-'+today()+'.csv'; document.body.appendChild(a); a.click(); a.remove();
}

/* ---------- menu ---------- */
function rMenu(){
  var q=val('m-search').toLowerCase(), c=$('m-cat').value, st=$('m-status').value, mgr=isMgr();
  var servedHere=function(i){ return (i.unavailable_at||[]).map(String).indexOf(String(mgr?S.me.loc:S.branch))===-1; };
  var rows=S.menu.filter(function(i){
    var here=mgr||S.branch==='all'||servedHere(i), shown=mgr?(i.is_available&&servedHere(i)):i.is_available;
    return here&&(c==='all'||i.category===c)&&(st==='all'||(st==='shown'?shown:!shown))&&(!q||(i.name+' '+(i.name_jp||'')).toLowerCase().indexOf(q)!==-1);});
  var hidden=S.menu.filter(function(i){return mgr?!(i.is_available&&servedHere(i)):!i.is_available;}).length;
  $('m-count').textContent=rows.length+' of '+S.menu.length+' dishes · '+hidden+' hidden'+(mgr?' here':'');
  $('menu-list').innerHTML=rows.length?rows.map(function(i){
    var off=(i.unavailable_at||[]).map(function(id){return shortLoc(id);}), here=servedHere(i);
    var sw=mgr?'<label class="switch" title="Served at your restaurant" style="margin:0"><input type="checkbox" data-act="bdish" data-id="'+i.id+'"'+(here&&i.is_available?' checked':'')+(i.is_available?'':' disabled')+' aria-label="Served here"><i></i></label>'
      :'<label class="switch" title="Visible to customers" style="margin:0"><input type="checkbox" data-act="avail" data-id="'+i.id+'"'+(i.is_available?' checked':'')+' aria-label="Visible"><i></i></label>';
    return '<div class="row" style="'+((mgr?(here&&i.is_available):i.is_available)?'':'opacity:.65')+'">'+
      (i.image_url?'<img class="thumb" loading="lazy" alt="" src="'+esc(i.image_url)+'" onerror="this.style.visibility=\'hidden\'">':'<div class="thumb"></div>')+
      '<div class="grow"><div class="name">'+esc(i.name)+'</div><div class="meta">'+esc(CATS[i.category]||i.category)+((i.tags||[]).length?' · '+(i.tags||[]).map(esc).join(', '):'')+(!mgr&&off.length?' · <span style="color:var(--warn)">not at '+esc(off.join(', '))+'</span>':'')+(mgr&&!i.is_available?' · <span style="color:var(--warn)">switched off by the owner</span>':'')+'</div></div>'+
      (mgr?'<span class="meta" style="min-width:90px;text-align:right">'+money(i.price)+'</span>':'<label style="margin:0;display:flex;align-items:center;gap:6px">KSh <input class="price-in" type="number" min="0" step="10" data-act="price" data-id="'+i.id+'" value="'+i.price+'" aria-label="Price of '+esc(i.name)+'"></label>')+sw+
      (mgr?'':'<button class="btn sm" data-act="menu-edit" data-id="'+i.id+'">Edit</button><button class="btn sm danger" data-act="menu-del" data-id="'+i.id+'">Delete</button>')+'</div>';}).join(''):'<div class="empty">No dishes match.</div>';
}
async function savePrice(id,el){
  var v=parseInt(el.value,10), it=byId(S.menu,id); if(!it) return;
  if(!(v>=0)){ showToast('Enter a valid price','error'); el.value=it.price; return; }
  if(v===it.price) return;
  if(await run(sb.from('menu_items').update({price:v}).eq('id',id),it.name+' is now '+money(v))) it.price=v; else el.value=it.price;
}
async function toggleAvail(id,el){ var it=byId(S.menu,id); if(!it) return; if(await run(sb.from('menu_items').update({is_available:el.checked}).eq('id',id))){ it.is_available=el.checked; rMenu(); } else el.checked=!el.checked; }
async function branchDish(id,el){
  var it=byId(S.menu,id); if(!it) return;
  var r=await sb.rpc('set_branch_dish',{p_item:Number(id),p_available:el.checked}); if(r.error){ fail(r.error); el.checked=!el.checked; return; }
  var loc=Number(S.me.loc), off=(it.unavailable_at||[]).filter(function(x){return Number(x)!==loc;}); if(!el.checked) off.push(loc); it.unavailable_at=off;
  showToast(it.name+(el.checked?' is now served here':' is switched off here'),'success'); rMenu();
}
async function showAll(){ if(!confirm('Show every dish to customers?')) return; if(await run(sb.from('menu_items').update({is_available:true}).eq('is_available',false),'All dishes visible')) refresh(true); }
async function menuDel(id){ var it=byId(S.menu,id); if(!it||!confirm('Delete "'+it.name+'"?')) return; if(await run(sb.from('menu_items').delete().eq('id',id),'Dish deleted')) refresh(true); }
function open(id){ $(id).classList.add('open'); } function closeAll(){ document.querySelectorAll('.modal').forEach(function(m){m.classList.remove('open');}); }
function prev(imgId,url){ var p=$(imgId); if(url){ p.src=url; p.classList.remove('hidden'); } else { p.removeAttribute('src'); p.classList.add('hidden'); } }
function menuForm(it){
  it=it||{}; $('dish-title').textContent=it.id?'Edit dish':'Add dish'; $('d-id').value=it.id||'';
  $('d-name').value=it.name||''; $('d-jp').value=it.name_jp||''; $('d-price').value=it.price===undefined?'':it.price; $('d-desc').value=it.description||'';
  $('d-cat').value=it.category||'ramen'; $('d-spicy').value=it.spicy||0; $('d-url').value=it.image_url||''; $('d-file').value=''; prev('d-prev',it.image_url); $('d-avail').checked=it.is_available!==false;
  document.querySelectorAll('#d-tags input').forEach(function(c){c.checked=(it.tags||[]).indexOf(c.value)!==-1;});
  var off=(it.unavailable_at||[]).map(String);
  $('d-branches').innerHTML=S.locs.map(function(l){ return '<label><input type="checkbox" data-branch="'+l.id+'"'+(off.indexOf(String(l.id))===-1?' checked':'')+'> '+esc(shortLoc(l.id))+'</label>'; }).join('');
  open('m-dish');
}
async function uploadImage(file,folder){
  if(file.size>5*1024*1024) throw new Error('Image must be under 5 MB');
  var ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';
  var path=folder+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,8)+'.'+ext;
  var r=await sb.storage.from('media').upload(path,file,{cacheControl:'31536000',upsert:false}); if(r.error) throw r.error;
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}
async function imageFrom(fileId,urlId,folder){ var f=$(fileId).files[0]; if(f) return await uploadImage(f,folder); return val(urlId)||null; }
async function saveDish(e){
  e.preventDefault(); var url; try{ url=await imageFrom('d-file','d-url','menu'); }catch(err){ fail(err); return; }
  var price=parseInt($('d-price').value,10); if(!(price>=0)){ showToast('Enter a valid price','error'); return; }
  var off=Array.prototype.filter.call(document.querySelectorAll('#d-branches input'),function(c){return !c.checked;}).map(function(c){return Number(c.dataset.branch);});
  var row={name:val('d-name'),name_jp:val('d-jp')||null,description:val('d-desc')||null,price:price,category:$('d-cat').value,spicy:parseInt($('d-spicy').value,10)||0,image_url:url,is_available:$('d-avail').checked,unavailable_at:off,
    tags:Array.prototype.filter.call(document.querySelectorAll('#d-tags input'),function(c){return c.checked;}).map(function(c){return c.value;})};
  var id=$('d-id').value;
  if(await run(id?sb.from('menu_items').update(row).eq('id',id):sb.from('menu_items').insert(row),id?'Dish saved':'Dish added')){ closeAll(); refresh(true); }
}

/* ---------- reservations ---------- */
function rRes(){
  var base=S.res.filter(inBr), f=S.f.res; chips($('res-chips'),['all','pending','confirmed','completed','cancelled'],f,'res',function(c){return c==='all'?base.length:base.filter(function(r){return r.status===c;}).length;});
  var rows=f==='all'?base:base.filter(function(r){return r.status===f;});
  $('res-list').innerHTML=rows.length?'<table><thead><tr><th>Guest</th><th>When</th><th>Guests</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>'+rows.map(function(r){
    var a=r.status==='pending'?[['confirmed','Confirm','good'],['cancelled','Cancel','danger']]:r.status==='confirmed'?[['completed','Done','good'],['cancelled','Cancel','danger']]:[];
    return '<tr><td><b>'+esc(r.name)+'</b><br><a href="tel:'+esc(String(r.phone).replace(/[^+\d]/g,''))+'">'+esc(r.phone)+'</a><br><span class="meta" style="color:var(--muted)">'+esc(r.email)+'</span>'+(r.requests?'<br><span class="items">'+esc(r.requests)+'</span>':'')+'</td>'+
     '<td>'+fmtDate(r.date)+'<br>'+esc(String(r.time).slice(0,5))+'</td><td>'+r.guests+'</td><td>'+esc(r.location_id?shortLoc(r.location_id):r.location)+'</td><td>'+pill(r.status)+'</td>'+
     '<td style="white-space:nowrap">'+a.map(function(x){return '<button class="btn sm '+x[2]+'" data-act="res-status" data-id="'+r.id+'" data-s="'+x[0]+'">'+x[1]+'</button> ';}).join('')+'</td></tr>';}).join('')+'</tbody></table>':'<div class="empty">No reservations here.</div>';
}
async function resStatus(id,s){ if(await run(sb.from('reservations').update({status:s}).eq('id',id),'Reservation '+s)) refresh(true); }

/* ---------- events ---------- */
function rEvents(){
  var t=today(), rows=S.events.filter(inBrShared);
  $('events-list').innerHTML=rows.length?rows.map(function(e){
    var past=e.event_date<t;
    return '<div class="row" style="'+(past||!e.is_published?'opacity:.6':'')+'">'+(e.image_url?'<img class="thumb" alt="" loading="lazy" src="'+esc(e.image_url)+'" onerror="this.style.visibility=\'hidden\'">':'<div class="thumb"></div>')+
     '<div class="grow"><div class="name">'+esc(e.title)+(canEdit(e)?'':' <span class="tag">shared</span>')+'</div><div class="meta">'+fmtDate(e.event_date)+(e.event_time?' · '+esc(e.event_time):'')+' · '+(e.location_id?esc(shortLoc(e.location_id)):'All branches')+(past?' · past':'')+'</div></div>'+
     (canEdit(e)?'<label class="switch" title="Show on website" style="margin:0"><input type="checkbox" data-act="event-pub" data-id="'+e.id+'"'+(e.is_published?' checked':'')+' aria-label="Published"><i></i></label>'+
     '<button class="btn sm" data-act="event-edit" data-id="'+e.id+'">Edit</button><button class="btn sm danger" data-act="event-del" data-id="'+e.id+'">Delete</button>':'')+'</div>';}).join(''):'<div class="empty">No events yet. Click "Post event" to add one.</div>';
}
function eventForm(it){
  it=it||{}; $('event-title').textContent=it.id?'Edit event':'Post event'; $('e-id').value=it.id||'';
  $('e-title').value=it.title||''; $('e-date').value=it.event_date||''; $('e-time').value=it.event_time||''; $('e-loc').value=it.location_name||''; $('e-desc').value=it.description||'';
  $('e-url').value=it.image_url||''; $('e-file').value=''; prev('e-prev',it.image_url); $('e-pub').checked=it.is_published!==false;
  $('e-branch').innerHTML=branchOptions(isMgr()?S.me.loc:(it.id?it.location_id:(S.branch!=='all'?S.branch:'')),true,'All branches');
  $('loc-names').innerHTML=['All branches'].concat(S.locs.map(function(l){return l.name;})).map(function(n){return '<option value="'+esc(n)+'">';}).join('');
  open('m-event');
}
async function saveEvent(e){
  e.preventDefault(); var url; try{ url=await imageFrom('e-file','e-url','events'); }catch(err){ fail(err); return; }
  var row={title:val('e-title'),event_date:$('e-date').value,event_time:val('e-time')||null,location_name:val('e-loc')||null,description:val('e-desc')||null,image_url:url,is_published:$('e-pub').checked,location_id:$('e-branch').value?Number($('e-branch').value):null};
  if(!row.event_date){ showToast('Pick a date','error'); return; }
  var id=$('e-id').value;
  if(await run(id?sb.from('events').update(row).eq('id',id):sb.from('events').insert(row),id?'Event saved':'Event posted')){ closeAll(); refresh(true); }
}
async function eventPub(id,el){ var it=byId(S.events,id); if(await run(sb.from('events').update({is_published:el.checked}).eq('id',id))){ if(it) it.is_published=el.checked; } else el.checked=!el.checked; }
async function eventDel(id){ var it=byId(S.events,id); if(!it||!confirm('Delete "'+it.title+'"?')) return; if(await run(sb.from('events').delete().eq('id',id),'Event deleted')) refresh(true); }

/* ---------- locations ---------- */
function rLocs(){
  var mgr=isMgr();
  $('loc-list').innerHTML=S.locs.length?S.locs.map(function(l){
    return '<div class="row" style="'+(l.is_active?'':'opacity:.65')+'"><div class="grow"><div class="name">'+esc(l.name)+(l.is_active?'':' <span class="pill pending">Hidden</span>')+'</div>'+
     '<div class="meta">'+esc(l.address)+(l.phone?' · '+esc(l.phone):'')+' · '+(l.table_count||0)+' tables</div>'+(l.note?'<div class="meta">'+esc(l.note)+'</div>':'')+'</div>'+
     (mgr?'':'<label class="switch" title="Show on website" style="margin:0"><input type="checkbox" data-act="loc-active" data-id="'+l.id+'"'+(l.is_active?' checked':'')+' aria-label="Active"><i></i></label>')+
     '<button class="btn sm" data-act="loc-edit" data-id="'+l.id+'">Edit</button>'+(mgr?'':'<button class="btn sm danger" data-act="loc-del" data-id="'+l.id+'">Delete</button>')+'</div>';}).join(''):'<div class="empty">No locations yet.</div>';
}
function locForm(it){
  it=it||{}; $('loc-title').textContent=it.id?'Edit branch':'Add branch'; $('l-id').value=it.id||'';
  $('l-name').value=it.name||''; $('l-addr').value=it.address||''; $('l-phone').value=it.phone||''; $('l-order').value=it.sort_order===undefined?(S.locs.length+1):it.sort_order; $('l-tables').value=it.table_count===undefined?20:it.table_count;
  $('l-hours').value=it.hours||''; $('l-note').value=it.note||''; $('l-map').value=it.map_query||''; $('l-active').checked=it.is_active!==false; $('l-name').readOnly=isMgr()&&!!it.id; open('m-loc');
}
async function saveLoc(e){
  e.preventDefault(); if(isMgr()&&!$('l-id').value){ showToast('Only the owner can add a restaurant','error'); return; }
  var name=val('l-name'), row={name:name,address:val('l-addr'),phone:val('l-phone')||null,sort_order:parseInt($('l-order').value,10)||0,table_count:Math.min(60,Math.max(0,parseInt($('l-tables').value,10)||0)),hours:$('l-hours').value.trim()||null,note:val('l-note')||null,map_query:val('l-map')||null,is_active:$('l-active').checked};
  var id=$('l-id').value; if(!id) row.slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,30)||('branch-'+Date.now());
  if(await run(id?sb.from('locations').update(row).eq('id',id):sb.from('locations').insert(row),id?'Branch saved':'Branch added')){ closeAll(); refresh(true); }
}
async function locActive(id,el){ var it=byId(S.locs,id); if(await run(sb.from('locations').update({is_active:el.checked}).eq('id',id))){ if(it) it.is_active=el.checked; rLocs(); } else el.checked=!el.checked; }
async function locDel(id){ var it=byId(S.locs,id); if(!it||!confirm('Delete "'+it.name+'"? Its orders and staff stay but lose their branch.')) return; if(await run(sb.from('locations').delete().eq('id',id),'Branch deleted')) refresh(true); }

/* ---------- reviews, gallery ---------- */
function rRev(){
  var base=S.reviews.filter(inBr), f=S.f.rev; chips($('rev-chips'),['all','pending','approved'],f,'rev',function(c){return c==='all'?base.length:base.filter(function(r){return r.status===c;}).length;});
  var rows=f==='all'?base:base.filter(function(r){return r.status===f;});
  $('rev-list').innerHTML=rows.length?rows.map(function(r){
    return '<div class="card"><div style="display:flex;justify-content:space-between;gap:10px"><div><b>'+esc(r.name)+'</b> '+pill(r.status)+(r.location_id?'<span class="tag">'+esc(shortLoc(r.location_id))+'</span>':'')+'<div class="meta" style="color:var(--muted)">'+esc(r.email)+(r.dish?' · '+esc(r.dish):'')+'</div></div><div style="color:var(--gold)">'+Array(r.rating+1).join('★')+'</div></div>'+
     '<p style="margin:10px 0">“'+esc(r.text)+'”</p><div style="display:flex;gap:8px">'+(r.status==='pending'?'<button class="btn sm good" data-act="rev-approve" data-id="'+r.id+'">Approve</button>':'')+'<button class="btn sm danger" data-act="rev-del" data-id="'+r.id+'">Delete</button></div></div>';}).join(''):'<div class="card empty">No reviews here.</div>';
}
async function revApprove(id){ if(await run(sb.from('reviews').update({status:'approved'}).eq('id',id),'Review approved')) refresh(true); }
async function revDel(id){ if(!confirm('Delete this review?')) return; if(await run(sb.from('reviews').delete().eq('id',id),'Review deleted')) refresh(true); }
function rGal(){
  var rows=S.gallery.filter(inBrShared);
  $('gal-list').innerHTML=rows.length?rows.map(function(g){
    return '<div><img loading="lazy" alt="'+esc(g.alt||'')+'" src="'+esc(g.src)+'" onerror="this.style.opacity=.3">'+(canEdit(g)?'<button class="btn sm danger" data-act="gal-del" data-id="'+g.id+'" aria-label="Delete photo">✕</button>':'')+'<p>'+esc(g.alt||'')+' <span class="tag">'+(g.location_id?esc(shortLoc(g.location_id)):'All')+'</span></p></div>';}).join(''):'<div class="empty" style="grid-column:1/-1">No photos yet.</div>';
}
function previewImage(){}
async function saveGal(e){
  e.preventDefault(); var src; try{ src=await imageFrom('g-file','g-url','gallery'); }catch(err){ fail(err); return; }
  if(!src){ showToast('Choose a photo or paste a link','error'); return; }
  if(await run(sb.from('gallery').insert({src:src,alt:val('g-alt')||null,location_id:$('g-branch').value?Number($('g-branch').value):null}),'Photo added')){ closeAll(); refresh(true); }
}
async function galDel(id){ if(!confirm('Remove this photo?')) return; if(await run(sb.from('gallery').delete().eq('id',id),'Photo removed')) refresh(true); }

/* ---------- tables + QR ---------- */
function curTableBranch(){ return byId(S.locs,$('t-branch').value)||S.locs[0]; }
function rTables(){
  var b=curTableBranch(); if(!b) return;
  if(document.activeElement!==$('t-base')&&!$('t-base').value) $('t-base').value=(location.protocol.indexOf('http')===0?location.origin:'https://joto-ramen.vercel.app')+'/';
  if(document.activeElement!==$('t-count')) $('t-count').value=b.table_count||20;
}
function tableUrl(b,n){ var base=($('t-base').value.trim()||'/').replace(/\/?$/,'/'); return base+'?b='+encodeURIComponent(b.slug||b.id)+'&table='+encodeURIComponent(n); }
function genQR(){
  var b=curTableBranch(); if(!b){ showToast('Add a branch first','error'); return; }
  var n=Math.min(60,Math.max(1,parseInt($('t-count').value,10)||0)); if(!n){ showToast('Enter the number of tables','error'); return; }
  var grid=$('qr-grid'); grid.innerHTML='';
  for(var i=1;i<=n;i++){ (function(i){
    var card=document.createElement('div'); card.className='qr-card'; var url=tableUrl(b,i);
    card.innerHTML='<small>'+esc(shortLoc(b.id))+'</small><b>Table '+i+'</b><small>Scan to see the menu and order</small><img alt="QR code for table '+i+'" hidden><small>'+esc(url)+'</small>';
    grid.appendChild(card);
    if(window.qrcode){ try{ var q=qrcode(0,'M'); q.addData(url); q.make(); var im=card.querySelector('img'); im.src=q.createDataURL(6,2); im.hidden=false; }catch(e){} }
  })(i); }
}
async function saveTables(){
  var b=curTableBranch(), n=Math.min(60,Math.max(1,parseInt($('t-count').value,10)||0)); if(!b||!n){ showToast('Enter the number of tables','error'); return; }
  if(await run(sb.from('locations').update({table_count:n}).eq('id',b.id),shortLoc(b.id)+' now has '+n+' tables')) b.table_count=n;
}

/* ---------- staff: add, monitor, activity ---------- */
async function loadUsers(){ var r=await sb.rpc('list_users'); if(r.error){ fail(r.error); return; } S.users=r.data||[]; if(S.view==='staff') rStaff(); }
function rStaff(){
  var mgrs=S.users.filter(function(u){return u.is_manager;});
  $('mg-list').innerHTML=mgrs.length?'<div style="padding:16px 18px 6px"><h3>Current restaurant admins</h3></div>'+mgrs.map(function(u){ var on=u.is_active!==false;
    return '<div class="row"><div class="grow"><div class="name">'+esc(u.name||u.email)+' '+pill(on?'active':'inactive',on?'online':'inactive')+'</div><div class="meta">'+esc(u.email)+' · runs '+esc(u.location_id?locName(u.location_id):'no restaurant')+(u.last_seen_at?'':'')+'</div></div>'+
      '<button class="btn sm" data-act="staff-reset" data-id="'+esc(u.id)+'">Reset password</button><button class="btn sm '+(on?'danger':'good')+'" data-act="staff-active" data-id="'+esc(u.id)+'" data-on="'+(on?'0':'1')+'">'+(on?'Deactivate':'Activate')+'</button></div>';}).join(''):'<div class="empty">No restaurant admins yet.</div>';
}
function genPassword(target){ var a='abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', s=''; var r=new Uint32Array(10); (window.crypto||{getRandomValues:function(x){for(var i=0;i<x.length;i++)x[i]=Math.floor(Math.random()*4e9);}}).getRandomValues(r); for(var i=0;i<10;i++) s+=a[r[i]%a.length]; $(target||'st-pass').value=s; }
async function managerAdd(){
  var body={action:'create',role:'manager',name:val('mg-name'),email:val('mg-email'),password:$('mg-pass').value,location_id:Number($('mg-branch').value)||null};
  if(!body.name||!body.email||!body.password||!body.location_id){ showToast('Fill in name, email, password and restaurant','error'); return; }
  var r=await sb.functions.invoke('staff-admin',{body:body});
  if(r.error){ showToast(await fnError(r.error),'error'); return; }
  showToast('Manager account created. Give them: '+body.email+' / '+body.password,'success'); ['mg-name','mg-email','mg-pass'].forEach(function(x){$(x).value='';}); await loadUsers(); rStaff();
}
async function staffCall(body,okMsg){ var r=await sb.functions.invoke('staff-admin',{body:body}); if(r.error){ showToast(await fnError(r.error),'error'); return false; } showToast(okMsg,'success'); if(!isMgr()) await loadUsers(); rStaff(); return true; }
/* ---------- order alerts ---------- */
function describe(o){ return (o.order_type==='dine_in'?'Table '+o.table_label:capitalize(o.order_type))+' · '+shortLoc(o.location_id)+' · '+money(o.total); }
function detect(){
  if(S.seen===null){ S.seen=new Set(S.orders.map(function(o){return o.id;})); S.seenReq=new Set(S.reqs.map(function(r){return r.id;})); S.seenPay=new Set(S.pays.filter(function(p){return p.status==='success';}).map(function(p){return p.id;})); alertBar(); return; }
  var fresh=S.orders.filter(function(o){return !S.seen.has(o.id)&&o.status==='pending';}); S.orders.forEach(function(o){S.seen.add(o.id);});
  if(fresh.length){ S.silenced=false; var o=fresh[0];
    Alerts.alert({kind:'order',title:fresh.length>1?fresh.length+' new orders':'New order #'+o.id,body:describe(o),tag:'o'+o.id,url:'admin.html'});
    showToast('🔔 '+(fresh.length>1?fresh.length+' new orders':'New order #'+o.id+': '+describe(o)),'info'); }
  var fr=S.reqs.filter(function(r){return !S.seenReq.has(r.id);}); S.reqs.forEach(function(r){S.seenReq.add(r.id);});
  if(fr.length) Alerts.alert({kind:'request',title:fr[0].kind==='bill'?'Bill requested':'Table needs a waiter',body:'Table '+fr[0].table_label+' · '+shortLoc(fr[0].location_id),tag:'s'+fr[0].id,url:'admin.html'});
  var fp=S.pays.filter(function(p){return p.status==='success'&&!S.seenPay.has(p.id);}); S.pays.forEach(function(p){ if(p.status==='success') S.seenPay.add(p.id); });
  if(fp.length&&fp[0].method==='mpesa') { Alerts.chime('ready'); showToast('💳 M-Pesa payment received: '+money(fp[0].amount)+(fp[0].mpesa_receipt?' ('+fp[0].mpesa_receipt+')':''),'success'); }
  alertBar();
}
function alertBar(){
  var pend=S.orders.filter(inBr).filter(function(o){return o.status==='pending';}).length, bar=$('alert-bar'); if(!bar) return;
  var parts=[]; if(pend) parts.push('🔔 '+pend+' order'+(pend===1?'':'s')+' waiting'); var rq=S.reqs.filter(inBr).length; if(rq) parts.push('🙋 '+rq+' table request'+(rq===1?'':'s'));
  bar.classList.toggle('hidden',!parts.length); $('alert-text').textContent=parts.join('   ·   ');
}
function alertBtn(){ var b=$('alerts-btn'); if(b) b.textContent=Alerts.soundOn?'🔔 Alerts on':'🔕 Alerts off'; }
function notifState(){ var e=$('notif-state'); if(!e) return; var p=Alerts.permission(); e.textContent=p==='granted'?'Notifications are allowed on this device.':p==='denied'?'Notifications are blocked. Allow them in your browser or phone settings for this site.':p==='unsupported'?'This browser does not support notifications. The sound and the alert bar still work.':'Notifications are not allowed yet. Tap "Allow notifications".'; }

/* ---------- reviews/reservations/others helpers + settings ---------- */
var SMAP={'s-name':'restaurant_name','s-phone':'phone','s-whatsapp':'whatsapp','s-email':'email','s-instagram':'instagram','s-facebook':'facebook','s-min':'min_order','s-fee':'delivery_fee','s-promo':'promo_text'};
function rSettings(){ notifState(); Object.keys(SMAP).forEach(function(id){ var e=$(id); if(e&&document.activeElement!==e) e.value=S.settings[SMAP[id]]||''; }); $('s-mpesa').checked=S.settings.mpesa_enabled==='1'; }
async function saveSettings(ids,msg){
  var rows=ids.map(function(id){ return {key:SMAP[id],value:$(id).value.trim()}; });
  var bad=rows.find(function(r){return (r.key==='min_order'||r.key==='delivery_fee')&&!(parseInt(r.value,10)>=0);});
  if(bad){ showToast('Enter a number for '+bad.key.replace('_',' '),'error'); return; }
  if(ids.indexOf('s-phone')!==-1&&!$('s-whatsapp').value.trim()){ var w=$('s-phone').value.replace(/\D/g,''); rows.forEach(function(r){ if(r.key==='whatsapp') r.value=w; }); }
  if(await run(sb.from('settings').upsert(rows,{onConflict:'key'}),msg)){ rows.forEach(function(r){S.settings[r.key]=r.value;}); }
}
async function saveMpesa(){ var v=$('s-mpesa').checked?'1':'0'; if(await run(sb.from('settings').upsert([{key:'mpesa_enabled',value:v}],{onConflict:'key'}),v==='1'?'M-Pesa payments are on':'M-Pesa payments are off')) S.settings.mpesa_enabled=v; }

/* ---------- events wiring (one delegate, no inline handlers) ---------- */
var ACT={
  logout:logout, refresh:function(){refresh();}, close:closeAll, view:function(id){go(id);}, chip:function(id,el){S.f[el.dataset.key]=id; render();},
  'pick-branch':function(id){ S.branch=id; $('branch-filter').value=id; go('orders'); },
  'menu-new':function(){menuForm();}, 'menu-edit':function(id){menuForm(byId(S.menu,id));}, 'menu-del':menuDel, 'menu-show-all':showAll,
  'order-status':function(id,el){orderStatus(id,el.dataset.s);}, 'order-paid':openPay, 'order-del':orderDel,
  'res-status':function(id,el){resStatus(id,el.dataset.s);},
  'event-new':function(){eventForm();}, 'event-edit':function(id){eventForm(byId(S.events,id));}, 'event-del':eventDel,
  'loc-new':function(){locForm();}, 'loc-edit':function(id){locForm(byId(S.locs,id));}, 'loc-del':locDel,
  'rev-approve':revApprove, 'rev-del':revDel, 'gal-new':function(){ $('g-file').value=''; $('g-url').value=''; $('g-alt').value=''; prev('g-prev',null); $('g-branch').innerHTML=branchOptions(isMgr()?S.me.loc:(S.branch!=='all'?S.branch:''),true,'All branches'); open('m-gal'); }, 'gal-del':galDel,
  'save-contact':function(){saveSettings(['s-name','s-phone','s-whatsapp','s-email','s-instagram','s-facebook'],'Contact details saved');},
  'save-order':function(){saveSettings(['s-min','s-fee','s-promo'],'Ordering settings saved');}, 'save-mpesa':saveMpesa, 'save-password':savePassword,
  alerts:function(){ Alerts.setSound(!Alerts.soundOn); alertBtn(); Alerts.askPermission().then(notifState); if(Alerts.soundOn) Alerts.chime('ready'); },
  silence:function(){ S.silenced=true; Alerts.stopFlash(); showToast('Silenced until the next new order','info'); },
  'test-alert':function(){ Alerts.alert({kind:'order',title:'Test alert',body:'This is how a new order will sound',tag:'test'}); },
  'enable-notif':function(){ Alerts.askPermission().then(notifState); },
  'req-done':async function(id){ var r=await sb.rpc('resolve_service',{p_id:Number(id)}); if(r.error){ fail(r.error); return; } refresh(true); },
  'qr-gen':genQR, 'qr-print':function(){ if(!$('qr-grid').children.length) genQR(); setTimeout(function(){ window.print(); },400); }, 'save-tables':saveTables,
  'mg-gen':function(){genPassword('mg-pass');}, 'mg-add':managerAdd, 'print-order':function(id){ printOrder(id); }, 'pay-table':function(id,el){ payTable(el.dataset.table,el.dataset.loc); }, 'otype':function(id){ S.f.otype=id; rOrders(); },
  'staff-active':function(id,el){ var on=el.dataset.on==='1'; if(!on&&!confirm('Deactivate this restaurant admin? They cannot sign in until you activate them again.')) return; staffCall({action:'set_active',user_id:id,active:on},on?'Admin activated':'Admin deactivated'); },
  'staff-reset':function(id){ var pw=prompt('Type a new password for this restaurant admin (8+ characters):'); if(!pw) return; staffCall({action:'reset_password',user_id:id,password:pw},'Password changed. Tell the restaurant admin.'); },
  'pay-export':exportPayments
};
document.addEventListener('click',function(e){
  if(e.target.classList&&e.target.classList.contains('modal')){ closeAll(); return; }
  var b=e.target.closest&&e.target.closest('[data-act]'); if(!b) return;
  var a=b.dataset.act; if(['price','avail','bdish','event-pub','loc-active','wa'].indexOf(a)!==-1) return;
  if(ACT[a]){ if(b.tagName==='A') return; ACT[a](b.dataset.id,b); }
});
document.addEventListener('change',function(e){
  var b=e.target.closest&&e.target.closest('[data-act]'); if(!b) return;
  var a=b.dataset.act, id=b.dataset.id;
  if(a==='bdish') branchDish(id,b); else if(a==='price') savePrice(id,b); else if(a==='avail') toggleAvail(id,b); else if(a==='event-pub') eventPub(id,b); else if(a==='loc-active') locActive(id,b);
});
document.addEventListener('keydown',function(e){ if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.act==='price'){ e.preventDefault(); e.target.blur(); } if(e.key==='Escape') closeAll(); });
document.querySelectorAll('.nav[data-view]').forEach(function(n){ n.addEventListener('click',function(){ go(n.dataset.view); }); });
$('menu-toggle').addEventListener('click',function(){ $('side').classList.toggle('open'); });
$('login-form').addEventListener('submit',login);
['f-dish','f-event','f-loc','f-gal','f-pay'].forEach(function(id){ var fn={'f-dish':saveDish,'f-event':saveEvent,'f-loc':saveLoc,'f-gal':saveGal,'f-pay':savePay}[id]; $(id).addEventListener('submit',fn); });
['m-search','m-cat','m-status'].forEach(function(id){ $(id).addEventListener('input',rMenu); $(id).addEventListener('change',rMenu); });
['pay-days','pay-method','pay-status'].forEach(function(id){ $(id).addEventListener('change',rPayments); });
$('branch-filter').addEventListener('change',function(){ S.branch=this.value; render(); });
$('t-branch').addEventListener('change',function(){ $('t-count').value=(curTableBranch()||{}).table_count||20; $('qr-grid').innerHTML=''; });
[['d-file','d-prev'],['e-file','e-prev'],['g-file','g-prev']].forEach(function(p){ $(p[0]).addEventListener('change',function(){ var f=this.files[0]; prev(p[1],f?URL.createObjectURL(f):null); }); });
boot();
})();
