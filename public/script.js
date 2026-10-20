var CANCEL_MS=window.JOTO_CANCEL_MS||80000; /* the customer's cancel window; a demo can shorten it */
/* JOTO RAMEN: customer site (multi-branch, Supabase-backed) */
var DEFAULT_LOCATIONS = [
  {id:1,slug:'alchemist',name:'The Alchemist, Westlands',address:'The Alchemist, Parklands Road, Westlands, Nairobi',phone:'+254726652586',hours:'Mon-Thu & Sun: 12pm - 11:30pm\nFri & Sat: 12pm - 3:30am',note:'',map_query:'The Alchemist Parklands Road Nairobi',table_count:20},
  {id:2,slug:'lavington',name:'Lavington Mall',address:'1st Floor, Lavington Mall, James Gichuru Road, Lavington, Nairobi',phone:'',hours:'Mon-Thu & Sun: 12pm - 11:30pm\nFri & Sat: 12pm - 3:30am',note:'Pork dishes are available at this branch.',map_query:'Lavington Mall James Gichuru Road Nairobi',table_count:20},
  {id:3,slug:'kenrail',name:'Joto Ramen Premium (Kenrail Towers)',address:'M3 Floor, Kenrail Towers, Ring Road, Parklands, Nairobi',phone:'',hours:'Daily: 11am - 11pm',note:'No pork is served at this branch.',map_query:'Kenrail Towers Ring Road Parklands Nairobi',table_count:20}];
var FALLBACK_MENU = [
  {id:1,name:'Special Shoyu',name_jp:'特製醤油',description:'Clean soy-based broth with gentle smokiness, pulled chicken and seaweed.',price:1850,category:'ramen',tags:['signature'],spicy:0,image_url:'images/menu/ramen-shoyu.svg',unavailable_at:[]},
  {id:2,name:'Special Miso',name_jp:'特製味噌',description:'Rich and bold miso broth with corn, chicken mince and spring onions.',price:1850,category:'ramen',tags:['signature','popular'],spicy:0,image_url:'images/menu/ramen-miso.svg',unavailable_at:[]},
  {id:3,name:'Special Vegan Ramen',name_jp:'ビーガンラーメン',description:'Creamy mushroom and soy-milk broth with handmade noodles.',price:1650,category:'ramen',tags:['vegan'],spicy:0,image_url:'images/menu/ramen-vegan.svg',unavailable_at:[]},
  {id:4,name:'Karaage',name_jp:'唐揚げ',description:'Japanese-style fried chicken, crispy outside and juicy inside.',price:698,category:'starters',tags:[],spicy:0,image_url:'images/menu/starter-karaage.svg',unavailable_at:[]}];
var CFG = {min_order:1500, delivery_fee:200, mpesa:false};
var mainPhone='+254726652586', mainWa='254726652586';
var tableMode=false, tableCode='', mode=null;
var menuItems=[], galleryImages=[], customerReviews=[], locationsList=[], eventsList=[];
var branch=null, currentCat='all', cart={}, currentUser=null, currentProfile=null, currentRating=0, ordering=false;

/* ---------- images (all saved in /images, or uploaded in Admin) ---------- */
function imgFail(el){
  var fb=el.getAttribute('data-fb');
  if(fb&&!el.dataset.fbDone){ el.dataset.fbDone='1'; el.src=fb; return; }
  el.style.display='none';
}
function imgTag(url,alt,cls,fallback){
  return url?'<img src="'+esc(url)+'" alt="'+esc(alt)+'" loading="lazy" decoding="async" class="img-fade '+(cls||'w-full h-full object-cover')+'"'+(fallback?' data-fb="'+esc(fallback)+'"':'')+' onload="this.classList.add(\'loaded\')" onerror="imgFail(this)">':'';
}
function zoomImg(el){ var i=el.querySelector('img'); if(i&&i.getAttribute('src')&&i.style.display!=='none') openLightbox(i.getAttribute('src')); }
function openLightbox(src){ var l=document.getElementById('lightbox'), i=document.getElementById('lightbox-img'); if(l&&i){ i.src=src; l.classList.add('active'); } }
function closeLightbox(){ var l=document.getElementById('lightbox'); if(l) l.classList.remove('active'); }

/* ---------- navigation ---------- */
function goTo(u){ location.href=u; }
function scrollToSection(id){ var el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth'}); }
function openMore(){ var m=document.getElementById('more-modal'); if(m) m.classList.add('active'); }
function closeMore(){ var m=document.getElementById('more-modal'); if(m) m.classList.remove('active'); }
function moreGo(id){ closeMore(); scrollToSection(id); }
function updateBottomNav(){
  var order=['home','menu','gallery','reviews','events','locations','reservations'];
  var map={home:'home',menu:'menu',gallery:'more',reviews:'more',events:'more',locations:'more',reservations:'book'};
  var y=window.scrollY+Math.round(window.innerHeight*0.35), cur='home';
  order.forEach(function(id){ var el=document.getElementById(id); if(el&&!el.classList.contains('hidden')&&el.offsetTop<=y) cur=id; });
  document.querySelectorAll('.bn-item').forEach(function(b){ b.classList.toggle('active',b.dataset.bn===map[cur]); });
}

/* ---------- branches ---------- */
function shortName(n){ n=String(n||''); var m=n.match(/\(([^)]+)\)/); return (m?m[1]:n.split(',')[0]).trim(); }
function findBranch(v){ if(v==null||v==='') return null; return locationsList.find(function(l){ return String(l.id)===String(v)||l.slug===String(v); })||null; }
function branchPhone(){ return (branch&&branch.phone)||mainPhone; }
async function loadLocations(){
  locationsList=DEFAULT_LOCATIONS;
  if(!JOTO_READY) return;
  var r=await sb.from('locations').select('*').eq('is_active',true).order('sort_order').order('id');
  if(!r.error&&r.data&&r.data.length) locationsList=r.data;
}
function chooseBranch(id,silent){
  var b=findBranch(id); if(!b) return;
  var changed=!branch||branch.id!==b.id; branch=b;
  try{ localStorage.setItem('joto_branch',String(b.id)); }catch(e){}
  if(changed){
    var lost=0; Object.keys(cart).forEach(function(k){ var it=menuItems.find(function(m){return String(m.id)===k;}); if(it&&!servedHere(it)){ delete cart[k]; lost++; } });
    if(lost){ saveCart(); showToast(lost+' item'+(lost>1?'s are':' is')+' not served at '+shortName(b.name)+' and were removed from your order','info'); }
  }
  closeBranchModal(); renderBranchUI(); renderModeUI();
  if(!mode&&!tableMode&&!silent) openModeModal();
  else if(!silent&&changed) showToast('Ordering from '+shortName(b.name),'success');
}
function openBranchModal(){
  var m=document.getElementById('branch-modal'); if(!m) return; renderBranchModal();
  var forced=!branch, c=document.getElementById('branch-close'), t=document.getElementById('branch-title'), sub=document.getElementById('branch-sub');
  if(c) c.classList.toggle('hidden',forced); if(t) t.textContent=forced?'Welcome to Joto Ramen. Which restaurant are you at?':'Which restaurant?';
  if(sub) sub.textContent=forced?'Each restaurant has its own menu, team, orders and reservations. Choose yours to continue.':'Switching restaurant changes the menu, events and reviews you see.';
  document.body.style.overflow=forced?'hidden':''; m.classList.add('active');
}
function closeBranchModal(){ if(!branch) return; var m=document.getElementById('branch-modal'); if(m) m.classList.remove('active'); document.body.style.overflow=''; }
function renderBranchModal(){
  var box=document.getElementById('branch-list'); if(!box) return;
  box.innerHTML=locationsList.map(function(l){
    var sel=branch&&branch.id===l.id;
    return '<button type="button" class="branch-card'+(sel?' selected':'')+'" onclick="chooseBranch('+Number(l.id)+')"><span class="b-ico">📍</span><span class="b-txt"><b>'+esc(l.name)+'</b><small>'+esc(l.address)+'</small>'+(l.note?'<em>'+esc(l.note)+'</em>':'')+'</span>'+(sel?'<span class="b-tick">✓</span>':'')+'</button>';
  }).join('');
}
function renderBranchUI(){
  var t=document.getElementById('branch-pill-text'); if(t) t.textContent=branch?shortName(branch.name):'Choose restaurant';
  var hc=document.getElementById('hero-branch-chip'); if(hc) hc.textContent=branch?'📍 '+shortName(branch.name)+' · change':'📍 3 restaurants in Nairobi';
  document.title=branch?'Joto Ramen · '+shortName(branch.name):'Joto Ramen: Premium Ramen in Nairobi';
  var bn=document.getElementById('table-name'); if(bn&&tableMode) bn.textContent='Table '+tableCode+(branch?' · '+shortName(branch.name):'');
  var note=document.getElementById('menu-intro');
  if(note&&!tableMode) note.textContent='Order online for pickup or delivery from '+(branch?shortName(branch.name):'your branch')+'. Minimum order KSh '+CFG.min_order.toLocaleString()+'.'+(branch&&branch.note?' '+branch.note:'');
  fillOrderBranch(); renderMenuItems(); renderFeatured(); renderLocations(); renderGallery(); renderEvents(); renderCustomerReviews(); populateDishOptions(); renderCart();
  var sel=document.getElementById('res-location'); if(sel&&branch) sel.value=String(branch.id);
}
function fillOrderBranch(){
  var sel=document.getElementById('order-branch'); if(!sel) return;
  sel.innerHTML=(branch?'':'<option value="">Choose your branch</option>')+locationsList.map(function(l){return '<option value="'+Number(l.id)+'">'+esc(l.name)+'</option>';}).join('');
  if(branch) sel.value=String(branch.id);
  sel.disabled=tableMode;
  var lab=sel.parentNode.querySelector('label'); if(lab) lab.textContent=tableMode?'Branch (set by your table\'s QR code)':'Branch';
}
function servedHere(it){ return !branch||!(it.unavailable_at||[]).some(function(x){return Number(x)===Number(branch.id);}); }
function visibleMenu(){ return menuItems.filter(servedHere); }
function inBranch(row){ return !branch||!row.location_id||Number(row.location_id)===Number(branch.id); }

/* ---------- settings ---------- */
async function loadSettings(){
  if(!JOTO_READY) return;
  var r=await sb.from('settings').select('key,value');
  if(r.error||!r.data) return;
  var s={}; r.data.forEach(function(x){ s[x.key]=x.value; });
  if(s.min_order) CFG.min_order=parseInt(s.min_order,10)||CFG.min_order;
  if(s.delivery_fee) CFG.delivery_fee=parseInt(s.delivery_fee,10)||CFG.delivery_fee;
  CFG.mpesa=s.mpesa_enabled==='1';
  if(!window.JOTO_CANCEL_MS&&s.cancel_seconds) CANCEL_MS=Math.min(300,Math.max(15,parseInt(s.cancel_seconds,10)||80))*1000;
  if(s.phone) mainPhone=s.phone;
  if(s.whatsapp) mainWa=s.whatsapp.replace(/\D/g,'');
  var promo=document.getElementById('promo-text');
  if(promo&&s.promo_text!==undefined){ if(s.promo_text.trim()) promo.textContent=s.promo_text; else if(promo.parentElement) promo.parentElement.classList.add('hidden'); }
  document.querySelectorAll('[data-call]').forEach(function(a){ a.href='tel:'+String(mainPhone).replace(/[^+\d]/g,''); });
  document.querySelectorAll('[data-setting="phone"]').forEach(function(el){ el.textContent=mainPhone; });
  document.querySelectorAll('[data-wa]').forEach(function(a){ a.href='https://wa.me/'+mainWa; });
  if(s.instagram){ var h=s.instagram.indexOf('http')===0?s.instagram:'https://instagram.com/'+s.instagram.replace(/^@/,''); document.querySelectorAll('a[href*="instagram.com"]').forEach(function(a){ a.href=h; }); }
  var opt=document.querySelector('#order-type option[value="delivery"]'); if(opt) opt.textContent='Delivery (+KSh '+CFG.delivery_fee+')';
}

/* ---------- menu ---------- */
var CAT_ART={ramen:'ramen-shoyu',starters:'starter-karaage',sides:'side-rice',drinks:'drink-soda',desserts:'dessert-icecream',toppings:'topping-egg'};
var CAT_ORDER=['ramen','starters','sides','drinks','desserts','toppings'];
var CAT_META={ramen:{jp:'ラーメン',en:'Ramen',sub:'Slow-simmered broths, handmade noodles'},starters:{jp:'前菜',en:'Starters',sub:'Small plates, made to share'},sides:{jp:'サイド',en:'Rice & Sides',sub:'Hearty extras'},drinks:{jp:'飲み物',en:'Drinks',sub:'Cold and refreshing'},desserts:{jp:'デザート',en:'Desserts',sub:'A sweet finish'},toppings:{jp:'トッピング',en:'Extras',sub:'Make your bowl your own'}};
function sortMenu(list){ return list.slice().sort(function(a,b){ return (CAT_ORDER.indexOf(a.category)-CAT_ORDER.indexOf(b.category))||(a.id-b.id); }); }
async function loadMenu(){
  if(JOTO_READY){
    var r=await sb.from('menu_items').select('*').eq('is_available',true).order('category').order('price');
    if(!r.error&&r.data&&r.data.length){ menuItems=sortMenu(r.data); return; }
    if(r.error) console.warn('menu load failed',r.error.message);
  }
  menuItems=FALLBACK_MENU;
}
function tagHTML(tag){ return '<span class="tagchip tag-'+esc(tag)+'">'+esc(tag==='chef'?"Chef's pick":capitalize(tag))+'</span>'; }
function isRecommended(i){ return (i.tags||[]).some(function(t){return t==='signature'||t==='popular'||t==='chef';}); }
function dishHTML(item,n,feature){
  var rec=isRecommended(item), tags=(item.tags||[]).filter(function(t){return ['signature','popular','chef'].indexOf(t)===-1;}).map(tagHTML).join('');
  var spice=item.spicy>0?'<span class="dish-spice" aria-label="Spice level '+item.spicy+' of 5">'+'🌶️'.repeat(item.spicy)+'</span>':'';
  return '<article class="dish '+(feature?'dish--feature':'dish--plain')+(rec?' dish--rec':'')+'">'+
    (rec?'<span class="dish-ribbon">Recommended</span>':'')+
    '<div class="dish-photo skeleton'+(item.image_url?' zoomable':'')+'" onclick="zoomImg(this)">'+imgTag(item.image_url,item.name,null,'images/menu/'+(CAT_ART[item.category]||'ramen-shoyu')+'.svg')+'</div>'+
    '<div class="dish-body"><div class="dish-top"><span class="dish-no">No.'+String(n).padStart(2,'0')+'</span>'+spice+'</div>'+
    '<h4 class="dish-name">'+esc(item.name)+'</h4>'+(item.name_jp?'<p class="dish-jp japanese-font">'+esc(item.name_jp)+'</p>':'')+
    '<p class="dish-desc">'+esc(item.description||'')+'</p>'+(tags?'<div class="dish-tags">'+tags+'</div>':'')+
    '<div class="dish-foot"><span class="dish-price">'+money(item.price)+'</span>'+
    '<button type="button" class="dish-add" onclick="addToCart('+Number(item.id)+')" aria-label="Add '+esc(item.name)+' to order"><span aria-hidden="true">＋</span> Add</button></div></div></article>';
}
function renderMenuItems(category){
  if(category) currentCat=category;
  var grid=document.getElementById('menu-grid'); if(!grid) return;
  var list=visibleMenu();
  var cats=CAT_ORDER.filter(function(c){ return (currentCat==='all'||currentCat===c)&&list.some(function(i){return i.category===c;}); });
  grid.innerHTML=cats.length?cats.map(function(c){
    var m=CAT_META[c], items=list.filter(function(i){return i.category===c;});
    return '<section class="menu-cat"><header class="menu-cat-head"><span class="jp japanese-font" aria-hidden="true">'+m.jp+'</span><div><h3>'+m.en+'</h3><p>'+m.sub+'</p></div><span class="rule"></span></header>'+
      '<div class="menu-cards menu-cards--'+(c==='ramen'?'feature':'plain')+'">'+items.map(function(it,i){return dishHTML(it,i+1,c==='ramen');}).join('')+'</div></section>';
  }).join(''):'<p class="text-center text-parchment/60 py-12">Nothing here yet.</p>';
  document.querySelectorAll('.menu-filter-btn').forEach(function(btn){
    var t=btn.textContent.toLowerCase(); btn.classList.toggle('active',currentCat==='all'?t.indexOf('all')===0:t.indexOf(currentCat==='sides'?'sides':currentCat==='toppings'?'toppings':currentCat)!==-1);
  });
}
function filterMenu(category){ renderMenuItems(category); }
function featuredCardHTML(i){
  return '<div class="feat-card"><div class="aspect-square skeleton relative overflow-hidden zoomable" onclick="zoomImg(this)">'+imgTag(i.image_url,i.name,null,'images/menu/'+(CAT_ART[i.category]||'ramen-shoyu')+'.svg')+'</div>'+
    '<div class="p-2.5 md:p-3"><h3 class="text-sm font-bold text-parchment leading-snug line-clamp-2 min-h-[2.5rem]">'+esc(i.name)+'</h3>'+
    '<div class="flex items-center justify-between mt-1"><span class="text-sm font-bold text-lantern-red">'+money(i.price)+'</span>'+
    '<button type="button" onclick="addToCart('+Number(i.id)+')" aria-label="Add '+esc(i.name)+'" class="w-8 h-8 rounded-full bg-lantern-red text-white text-lg leading-none active:scale-90">＋</button></div></div></div>';
}
function renderFeatured(){
  var sec=document.getElementById('featured'), row=document.getElementById('featured-row'); if(!sec||!row) return;
  var list=visibleMenu(), pick=list.filter(isRecommended);
  if(pick.length<4) pick=pick.concat(list.filter(function(i){return i.category==='ramen'&&!isRecommended(i);}));
  pick=pick.slice(0,8);
  sec.classList.toggle('hidden',!pick.length); row.innerHTML=pick.map(featuredCardHTML).join('');
}
function populateDishOptions(){
  var sel=document.getElementById('review-dish'); if(!sel) return;
  sel.innerHTML='<option value="">Select your favorite dish (optional)</option>'+visibleMenu().map(function(m){return '<option value="'+esc(m.name)+'">'+esc(m.name)+'</option>';}).join('')+'<option value="Other">Other</option>';
}

/* ---------- cart (saved on this phone) ---------- */
function saveCart(){ try{ localStorage.setItem('joto_cart',JSON.stringify(cart)); }catch(e){} }
function loadCart(){ try{ cart=JSON.parse(localStorage.getItem('joto_cart')||'{}')||{}; }catch(e){ cart={}; } }
function cartLines(){ var out=[]; Object.keys(cart).forEach(function(id){ var it=menuItems.find(function(m){return String(m.id)===id;}); if(it&&servedHere(it)) out.push({item:it,qty:cart[id]}); }); return out; }
function cartTotals(){
  var type=mode||'pickup';
  var sub=cartLines().reduce(function(s,l){return s+l.item.price*l.qty;},0);
  var fee=(type==='delivery'&&sub>0)?CFG.delivery_fee:0;
  return {subtotal:sub,fee:fee,total:sub+fee,type:type};
}
function addToCart(id){
  var it=menuItems.find(function(m){return m.id===id;}); if(!it) return;
  if(!branch&&!tableMode){ openBranchModal(); showToast('Choose a restaurant first','info'); return; }
  if(!mode){ openModeModal(); showToast('Tell us how you want it first: dine in, pickup or delivery','info'); return; }
  cart[id]=Math.min((cart[id]||0)+1,50); saveCart(); renderCart(); showToast(it.name+' added to your order','success');
}
function updateQuantity(id,delta){ cart[id]=(cart[id]||0)+delta; if(cart[id]<=0) delete cart[id]; saveCart(); renderCart(); }
function removeFromCart(id){ delete cart[id]; saveCart(); renderCart(); }
function renderCart(){
  var lines=cartLines(), t=cartTotals();
  var count=lines.reduce(function(s,l){return s+l.qty;},0);
  var cc=document.getElementById('cart-count'), ct=document.getElementById('cart-total'), btn=document.getElementById('order-cart');
  if(cc) cc.textContent=count; if(ct) ct.textContent=t.subtotal.toLocaleString();
  var bb=document.getElementById('bn-badge'); if(bb){ bb.textContent=count>99?'99+':count; bb.classList.toggle('hidden',!count); }
  if(btn) btn.classList.toggle('hidden',count===0);
  var box=document.getElementById('cart-items');
  if(box){
    box.innerHTML=lines.length?lines.map(function(l){
      var id=Number(l.item.id);
      return '<div class="flex justify-between items-center bg-white/5 rounded-lg p-3"><div class="flex-1"><p class="text-parchment font-semibold">'+esc(l.item.name)+'</p><p class="text-muted-gold text-sm">'+money(l.item.price)+' × '+l.qty+'</p></div>'+
        '<div class="flex items-center gap-2"><button type="button" aria-label="Decrease" onclick="updateQuantity('+id+',-1)" class="w-8 h-8 bg-white/10 rounded-lg hover:bg-white/20">-</button><span class="text-parchment w-6 text-center">'+l.qty+'</span>'+
        '<button type="button" aria-label="Increase" onclick="updateQuantity('+id+',1)" class="w-8 h-8 bg-white/10 rounded-lg hover:bg-white/20">+</button>'+
        '<button type="button" aria-label="Remove" onclick="removeFromCart('+id+')" class="ml-2 text-red-400 hover:text-red-300">🗑️</button></div></div>';
    }).join(''):'<p class="text-parchment/60 text-center py-4">Your cart is empty</p>';
  }
  var sum=document.getElementById('order-summary'), tot=document.getElementById('order-total'), warn=document.getElementById('order-warning');
  if(sum) sum.innerHTML=(branch?'<div class="flex justify-between"><span>Branch</span><span>'+esc(shortName(branch.name))+'</span></div>':'')+'<div class="flex justify-between"><span>Subtotal</span><span>'+money(t.subtotal)+'</span></div>'+(t.fee?'<div class="flex justify-between"><span>Delivery</span><span>'+money(t.fee)+'</span></div>':'');
  if(tot) tot.textContent=t.total.toLocaleString();
  if(warn){ var below=mode!=='dine_in'&&t.subtotal>0&&t.subtotal<CFG.min_order; warn.classList.toggle('hidden',!below); if(below) warn.textContent='Minimum order is '+money(CFG.min_order)+'. Add '+money(CFG.min_order-t.subtotal)+' more.'; }
}
function toggleCart(){
  var m=document.getElementById('order-modal'); if(!m) return;
  if(m.classList.contains('active')) m.classList.remove('active');
  else { if(!branch){ openBranchModal(); return; } if(!mode){ openModeModal(); return; } prefillOrderForm(); applyModeToForm(); renderCart(); m.classList.add('active'); }
}
function closeOrderModal(){ var m=document.getElementById('order-modal'); if(m) m.classList.remove('active'); }
function loadMe(){ try{ return JSON.parse(localStorage.getItem('joto_me')||'{}')||{}; }catch(e){ return {}; } }
function saveMe(o){ try{ localStorage.setItem('joto_me',JSON.stringify(o)); }catch(e){} }
function prefillOrderForm(){
  var p=currentProfile||{}, u=currentUser||{}, me=loadMe();
  var set=function(id,v){ var el=document.getElementById(id); if(el&&v&&!el.value) el.value=v; };
  set('order-name',p.name||me.name); set('order-phone',p.phone||me.phone); set('order-email',u.email||me.email); set('order-address',me.address);
}
async function handleOrderSubmit(event){
  event.preventDefault();
  if(ordering) return;
  if(!JOTO_READY){ showToast('Online ordering is not available yet. Please call or WhatsApp us.','error'); return; }
  if(!branch){ openBranchModal(); return; }
  if(!mode){ openModeModal(); return; }
  var dine=mode==='dine_in', t=cartTotals();
  if(!t.subtotal){ showToast('Your cart is empty','error'); return; }
  if(!dine&&t.subtotal<CFG.min_order){ showToast('Minimum order is '+money(CFG.min_order),'error'); return; }
  var g=function(id){ var e=document.getElementById(id); return e?e.value:''; };
  var items=cartLines().map(function(l){return {id:Number(l.item.id),qty:l.qty};});
  var form=event.target, btn=form.querySelector?form.querySelector('button[type="submit"]'):null;
  if(mode==='delivery'&&!g('order-address').trim()){ showToast('Please enter a delivery address','error'); return; }
  if(dine&&!tableCode){ closeOrderModal(); openModeModal(); return; }
  ordering=true; if(btn){btn.disabled=true;btn.textContent='Sending…';}
  var r=dine
    ? await sb.rpc('place_table_order',{p_table:tableCode,p_name:g('order-name'),p_notes:g('order-notes'),p_items:items,p_location:branch.id})
    : await sb.rpc('place_order',{p_name:g('order-name'),p_phone:g('order-phone'),p_email:g('order-email'),p_type:mode,p_address:g('order-address').trim(),p_notes:g('order-notes'),p_items:items,p_location:branch.id});
  ordering=false; if(btn){btn.disabled=false;btn.textContent=dine?'Send to kitchen':'Place Order';}
  if(r.error){ showToast(friendlyError(r.error),'error'); return; }
  if(!dine) saveMe({name:g('order-name'),phone:g('order-phone'),email:g('order-email'),address:g('order-address').trim()});
  var snap=cartLines().map(function(l){return {id:Number(l.item.id),n:l.item.name,q:l.qty};});
  cart={}; saveCart(); renderCart(); closeOrderModal(); if(form.reset) form.reset(); applyModeToForm();
  putOrder({id:r.data.order_id,token:r.data.cancel_token,until:r.data.cancel_until||new Date(Date.now()+CANCEL_MS).toISOString(),total:r.data.total,mode:mode,table:dine?tableCode:null,branch:branch.id,items:snap,at:Date.now(),status:'pending',paid:false,claimed:false,cancelled:false,phone:g('order-phone')||''});
  renderOrdersFab(); openOrders(r.data.order_id);
}

/* ---------- my orders: floating button, cancel, pay (M-Pesa prompt or QR), live status, order again ---------- */
function mmss(n){ return Math.floor(n/60)+':'+String(n%60).padStart(2,'0'); }
function cancelText(){ var t=Math.round(CANCEL_MS/1000), m=Math.floor(t/60), r=t%60; return (m?m+' minute'+(m>1?'s':''):'')+(m&&r?' ':'')+(r?r+' seconds':''); }
function loadOrders(){ try{ var a=JSON.parse(localStorage.getItem('joto_orders')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function saveOrders(a){ try{ localStorage.setItem('joto_orders',JSON.stringify(a.slice(0,12))); }catch(e){} }
function recentOrders(){ var cut=Date.now()-86400000; return loadOrders().filter(function(o){return (o.at||0)>cut;}).sort(function(x,y){return (y.at||0)-(x.at||0);}); }
function getOrder(id){ return loadOrders().filter(function(o){return o.id===id;})[0]||null; }
function putOrder(o){ var a=loadOrders().filter(function(x){return x.id!==o.id;}); a.unshift(o); saveOrders(a); }
function leftSecs(o){ return Math.max(0,Math.round((Date.parse(o.until)-Date.now())/1000)); }
function orderOwes(o){ return !o.cancelled&&!o.paid; }
function orderActive(o){ return !o.cancelled&&o.status!=='completed'; }
var panelOpen={}, payMsg={}, ordersTimer=null, ordersPollTimer=null, payWatch={};
function statusText(st,o){
  var kind=o.mode||'pickup';
  return {pending:'⏳ Waiting for the restaurant to confirm',confirmed:'👩‍🍳 Being prepared',ready:kind==='dine_in'?'🍽️ Ready, coming to your table':kind==='delivery'?'🛵 Out for delivery':'🛍️ Ready for pickup',completed:'✅ Done. Enjoy!',cancelled:'🛑 Cancelled'}[st]||'';
}
function renderOrdersFab(){
  var f=document.getElementById('orders-fab'); if(!f) return; var list=recentOrders();
  if(!list.length){ f.classList.add('hidden'); return; }
  var owes=list.filter(orderOwes), active=list.filter(orderActive), n=owes.length||active.length;
  f.classList.remove('hidden'); f.classList.toggle('owes',owes.length>0);
  document.getElementById('orders-fab-text').textContent=owes.length?'Pay '+money(owes.reduce(function(s,o){return s+o.total;},0)):'My orders';
  var bd=document.getElementById('orders-fab-badge'); bd.textContent=n; bd.classList.toggle('hidden',!n);
}
function openOrders(focusId){
  var m=document.getElementById('orders-modal'); if(!m) return; renderOrders(); m.classList.add('active');
  clearInterval(ordersTimer); ordersTimer=setInterval(tickOrders,1000); clearInterval(ordersPollTimer); ordersPollTimer=setInterval(function(){ pollOrders(); },8000); pollOrders();
  if(focusId){ var el=m.querySelector('[data-id="'+focusId+'"]'); if(el&&el.scrollIntoView) el.scrollIntoView({block:'start'}); }
}
function closeOrders(){ var m=document.getElementById('orders-modal'); if(m) m.classList.remove('active'); clearInterval(ordersTimer); clearInterval(ordersPollTimer); }
function tickOrders(){
  var unlock=false; document.querySelectorAll('[data-left]').forEach(function(e){ var o=getOrder(Number(e.dataset.left)); if(!o) return; var l=leftSecs(o); if(l<=0) unlock=true; else e.textContent=mmss(l); });
  if(unlock) renderOrders();
}
function payAreaHTML(o,left,b){
  var locked=left>0&&o.status==='pending', hasQr=!!b.pay_qr_url;
  if(!CFG.mpesa&&!hasQr) return '<div class="mo-note">Pay at the restaurant or on delivery.</div>';
  var h='<div class="mo-pay"><div class="mo-pay-title">Pay '+money(o.total)+'</div>';
  if(locked) h+='<div class="mo-note">Payment opens in <b data-left="'+o.id+'">'+mmss(left)+'</b>, once the time to cancel is over.</div>';
  h+='<div class="mo-pay-btns">'+(CFG.mpesa?'<button type="button" class="'+(panelOpen[o.id]==='mpesa'?'on':'')+'" '+(locked?'disabled':'')+' onclick="payPanel('+o.id+',\'mpesa\')">📱 M-Pesa prompt</button>':'')+(hasQr?'<button type="button" class="'+(panelOpen[o.id]==='qr'?'on':'')+'" '+(locked?'disabled':'')+' onclick="payPanel('+o.id+',\'qr\')">🔳 Scan QR</button>':'')+'</div>';
  if(!locked&&panelOpen[o.id]==='mpesa'&&CFG.mpesa) h+='<div class="mo-panel"><label for="pp-'+o.id+'">M-Pesa number to charge</label><input id="pp-'+o.id+'" type="tel" inputmode="tel" value="'+esc(loadMe().phone||o.phone||'')+'" placeholder="0712 345 678"><button type="button" class="mo-go" onclick="payMpesa('+o.id+')">Send payment request</button>'+(b.pay_live?'':'<div class="mo-note">Demo mode: this is a test payment and no real money is taken.</div>')+'<div class="mo-msg" id="pm-'+o.id+'" aria-live="polite">'+esc(payMsg[o.id]||'')+'</div></div>';
  if(!locked&&panelOpen[o.id]==='qr'&&hasQr) h+='<div class="mo-panel mo-qr"><img src="'+esc(b.pay_qr_url)+'" alt="M-Pesa payment QR code"><p>Scan with the M-Pesa app and pay exactly <b>'+money(o.total)+'</b>.'+(b.pay_note?'<br>'+esc(b.pay_note):'')+'<br>Reference: <b>Order #'+o.id+'</b></p><label for="pc-'+o.id+'">M-Pesa confirmation code (optional)</label><input id="pc-'+o.id+'" type="text" maxlength="14" autocomplete="off" placeholder="e.g. QWE1R2T3Y4"><button type="button" class="mo-go" onclick="claimQr('+o.id+')">I have paid</button><div class="mo-msg" aria-live="polite">'+esc(payMsg[o.id]||'')+'</div></div>';
  return h+'</div>';
}
function orderCardHTML(o){
  var left=leftSecs(o), canCancel=!o.cancelled&&o.status==='pending'&&left>0, b=findBranch(o.branch)||{};
  var where=o.mode==='dine_in'?'🍽️ Table '+esc(o.table):o.mode==='delivery'?'🛵 Delivery':'🛍️ Pickup';
  var pill=o.paid?'<span class="mo-pill paid">Paid ✓'+(o.receipt?' · '+esc(o.receipt):'')+'</span>':o.claimed?'<span class="mo-pill claimed">Confirming payment…</span>':o.cancelled?'':'<span class="mo-pill unpaid">Not paid</span>';
  var h='<div class="myorder" data-id="'+o.id+'"><div class="mo-head"><b>Order #'+o.id+'</b>'+pill+'</div>'+
    '<div class="mo-sub">'+esc(shortName(b.name||'Joto Ramen'))+' · '+where+' · '+new Date(o.at).toLocaleTimeString('en-KE',{hour:'2-digit',minute:'2-digit'})+'</div>'+
    '<div class="mo-status">'+esc(o.cancelled?'🛑 Cancelled':statusText(o.status,o))+'</div>'+
    '<ul class="mo-items">'+(o.items||[]).map(function(i){return '<li>'+i.q+'× '+esc(i.n)+'</li>';}).join('')+'</ul><div class="mo-total"><span>Total</span><b>'+money(o.total)+'</b></div>';
  if(canCancel) h+='<div class="mo-cancel">You can cancel for <b data-left="'+o.id+'">'+mmss(left)+'</b><button type="button" onclick="cancelOrder('+o.id+')">Cancel order</button></div>';
  if(o.note&&orderOwes(o)&&!o.claimed) h+='<div class="mo-note warn">'+esc(o.note)+'</div>';
  if(orderOwes(o)&&!o.claimed) h+=payAreaHTML(o,left,b);
  if(o.claimed&&!o.paid) h+='<div class="mo-note">Thank you. The restaurant will confirm your payment in a moment.</div>';
  if(!orderActive(o)||o.paid) h+='<div class="mo-actions"><button type="button" onclick="reorder('+o.id+')">🔁 Order again</button></div>';
  return h+'</div>';
}
function renderOrders(){
  var box=document.getElementById('orders-body'); if(!box) return; var list=recentOrders();
  box.innerHTML=list.length?list.map(orderCardHTML).join(''):'<p class="text-center text-parchment/60 py-10">No orders yet. When you order, it shows up here so you can follow it and pay whenever you like.</p>';
  renderOrdersFab();
}
function applyStatus(o,d){
  var before=JSON.stringify([o.status,o.paid,o.claimed,o.cancelled,o.note,o.receipt]);
  if(d.status){ o.status=d.status; if(d.status==='cancelled') o.cancelled=true; }
  o.paid=d.payment_status==='paid'; o.claimed=d.payment_status==='claimed'; if(d.receipt) o.receipt=d.receipt; o.note=d.payment_status==='failed'?(d.note||'The payment was not completed.'):(d.payment_status==='unpaid'&&d.note?d.note:'');
  return before!==JSON.stringify([o.status,o.paid,o.claimed,o.cancelled,o.note,o.receipt]);
}
async function refreshOrder(o){ if(!JOTO_READY) return false; var r=await sb.rpc('order_payment_status',{p_order:o.id,p_token:o.token}); if(r.error||!r.data) return false; var changed=applyStatus(o,r.data); if(changed) putOrder(o); return changed; }
async function pollOrders(){
  if(!JOTO_READY) return; var changed=false, list=recentOrders().filter(function(o){return !(o.cancelled||(o.status==='completed'&&o.paid));});
  for(var i=0;i<list.length;i++){ if(await refreshOrder(list[i])) changed=true; }
  if(changed){ renderOrdersFab(); var m=document.getElementById('orders-modal'); if(m&&m.classList.contains('active')) renderOrders(); }
}
function payPanel(id,kind){ panelOpen[id]=panelOpen[id]===kind?'':kind; payMsg[id]=''; renderOrders(); }
async function fnError(err){ try{ var j=await err.context.json(); if(j&&j.error) return j.error; }catch(e){} return (err&&err.message)||'Something went wrong'; }
async function cancelOrder(id){
  var o=getOrder(id); if(!o||!JOTO_READY) return; if(!confirm('Cancel this order?')) return;
  var r=await sb.rpc('cancel_order',{p_order:o.id,p_token:o.token});
  if(r.error){ showToast(friendlyError(r.error),'error'); renderOrders(); return; }
  o.cancelled=true; o.status='cancelled'; putOrder(o); showToast('Order cancelled','success'); renderOrders();
}
async function payMpesa(id){
  var o=getOrder(id); if(!o||!JOTO_READY) return; var inp=document.getElementById('pp-'+id), phone=(inp?inp.value:'').trim();
  if(!phone){ showToast('Enter the Safaricom number to charge','error'); return; }
  var me=loadMe(); me.phone=phone; saveMe(me); payMsg[id]='Sending the request to your phone…'; var msg=document.getElementById('pm-'+id); if(msg) msg.textContent=payMsg[id];
  var r=await sb.functions.invoke('mpesa-stk-push',{body:{order_id:o.id,token:o.token,phone:phone}});
  if(r.error){ payMsg[id]=await fnError(r.error); renderOrders(); return; }
  if(r.data&&r.data.already){ o.paid=true; putOrder(o); renderOrders(); return; }
  payMsg[id]='Check your phone and enter your M-Pesa PIN to pay '+money(o.total)+'.'; renderOrders();
  clearInterval(payWatch[id]); var tries=0;
  payWatch[id]=setInterval(async function(){
    tries++; var cur=getOrder(id); if(!cur){ clearInterval(payWatch[id]); return; }
    await refreshOrder(cur); renderOrdersFab();
    if(cur.paid){ clearInterval(payWatch[id]); payMsg[id]=''; renderOrders(); showToast('Payment received. Thank you!','success'); }
    else if(cur.note&&!cur.claimed&&tries>1){ clearInterval(payWatch[id]); payMsg[id]=cur.note+' You can try again.'; renderOrders(); }
    else if(tries>=40){ clearInterval(payWatch[id]); payMsg[id]='We have not received the payment yet. If you paid, it will appear here shortly.'; renderOrders(); }
  },3000);
}
async function claimQr(id){
  var o=getOrder(id); if(!o||!JOTO_READY) return; var inp=document.getElementById('pc-'+id);
  var r=await sb.rpc('claim_payment',{p_order:o.id,p_token:o.token,p_code:inp?inp.value:''});
  if(r.error){ payMsg[id]=friendlyError(r.error); renderOrders(); return; }
  o.claimed=true; o.note=''; putOrder(o); panelOpen[id]=''; payMsg[id]=''; showToast('Thank you. The restaurant will confirm your payment.','success'); renderOrders();
}
function reorder(id){
  var o=getOrder(id); if(!o) return; var added=0, skipped=0;
  (o.items||[]).forEach(function(i){ var it=menuItems.find(function(m){return m.id===i.id;}); if(it&&servedHere(it)){ cart[it.id]=Math.min((cart[it.id]||0)+i.q,50); added++; } else skipped++; });
  saveCart(); renderCart(); closeOrders();
  if(!added){ showToast('Those dishes are not available right now','error'); return; }
  if(skipped) showToast(skipped+' dish'+(skipped>1?'es were':' was')+' not available and left out','info');
  toggleCart();
}

/* ---------- how the customer is served: dine in (table number), pickup or delivery ---------- */
var MODE_META={dine_in:{ico:'🍽️',name:'Dine in'},pickup:{ico:'🛍️',name:'Pickup'},delivery:{ico:'🛵',name:'Delivery'}};
function modeLabel(){ if(!mode) return 'Choose how you want it'; return MODE_META[mode].ico+' '+MODE_META[mode].name+(mode==='dine_in'&&tableCode?' · Table '+tableCode:''); }
function loadMode(){ try{ var m=localStorage.getItem('joto_mode'), t=sessionStorage.getItem('joto_table')||''; if(m&&MODE_META[m]){ mode=m; tableCode=t; if(mode==='dine_in'&&!tableCode) mode=null; } }catch(e){} }
function saveMode(){ try{ localStorage.setItem('joto_mode',mode||''); sessionStorage.setItem('joto_table',tableCode||''); }catch(e){} }
function openModeModal(){
  var m=document.getElementById('mode-modal'); if(!m) return;
  var forced=!mode; document.getElementById('mode-close').classList.toggle('hidden',forced);
  document.getElementById('mode-title').textContent=forced?'How would you like your order?':'Change how you are served';
  document.getElementById('mode-table-wrap').classList.add('hidden'); document.getElementById('mode-options').classList.remove('hidden');
  document.body.style.overflow=forced?'hidden':''; m.classList.add('active');
}
function closeModeModal(){ if(!mode) return; var m=document.getElementById('mode-modal'); if(m) m.classList.remove('active'); document.body.style.overflow=''; }
function chooseMode(m){
  if(m==='dine_in'){
    if(tableMode&&tableCode){ finishMode('dine_in'); return; }          // the table QR code already names the table
    document.getElementById('mode-options').classList.add('hidden'); document.getElementById('mode-table-wrap').classList.remove('hidden');
    var i=document.getElementById('mode-table'); if(i){ i.value=tableCode||''; setTimeout(function(){ try{i.focus();}catch(e){} },50); } return;
  }
  finishMode(m);
}
function confirmTable(){
  var i=document.getElementById('mode-table'), v=(i?i.value:'').replace(/[^A-Za-z0-9 _-]/g,'').trim().slice(0,20);
  if(!v){ showToast('Type the number on your table','error'); return; }
  tableCode=v; finishMode('dine_in');
}
function finishMode(m){
  var changed=m!==mode; mode=m; saveMode();
  var md=document.getElementById('mode-modal'); if(md) md.classList.remove('active'); document.body.style.overflow='';
  renderModeUI(); renderCart();
  if(changed) showToast(modeLabel().replace(/^\S+ /,''),'success');
}
function renderModeUI(){
  var ctx=document.getElementById('order-context');
  if(ctx) ctx.innerHTML='<button type="button" class="ctx-chip" onclick="openBranchModal()">📍 '+esc(branch?shortName(branch.name):'Choose restaurant')+' <u>change</u></button>'+
    '<button type="button" class="ctx-chip" onclick="openModeModal()">'+esc(modeLabel())+' <u>change</u></button>'+
    (mode==='dine_in'&&tableCode&&JOTO_READY?'<button type="button" class="ctx-chip ctx-act" onclick="callService(\'waiter\')">🙋 Call waiter</button><button type="button" class="ctx-chip ctx-act" onclick="callService(\'bill\')">🧾 Ask for the bill</button>':'');
  var line=document.getElementById('order-mode-line'); if(line) line.innerHTML='<span>'+esc(modeLabel())+'</span><button type="button" onclick="closeOrderModal();openModeModal()">Change</button>';
  applyModeToForm();
}
/* show only the fields this way of ordering needs */
function applyModeToForm(){
  var T=document.getElementById('order-title'); if(T) T.textContent=mode==='dine_in'?'🍽️ Order for table '+tableCode:'🛒 Your Order';
  var sbm=document.getElementById('order-submit'); if(sbm) sbm.textContent=mode==='dine_in'?'Send to kitchen':'Place Order';
  var dine=mode==='dine_in', del=mode==='delivery';
  var show=function(id,on,req){ var e=document.getElementById(id); if(!e) return; e.required=!!(on&&req); e.parentNode.classList.toggle('hidden',!on); };
  show('order-name',true,!dine); show('order-phone',!dine,true); show('order-email',!dine,true); show('order-address',del,true);
  var ot=document.getElementById('order-type'); if(ot){ ot.value=mode||'pickup'; ot.required=false; ot.parentNode.classList.add('hidden'); }
  var nm=document.getElementById('order-name'); if(nm){ nm.placeholder=dine?'Name (optional)':'Your name'; var l=nm.parentNode.querySelector('label'); if(l) l.textContent=dine?'Name (optional)':'Name *'; var grid=nm.parentNode.parentNode; if(grid) grid.classList.toggle('md:grid-cols-2',!dine); }
}
function initTableMode(){
  var q=''; try{ q=new URLSearchParams(window.JOTO_QS!==undefined?window.JOTO_QS:location.search).get('table')||''; }catch(e){}
  var saved=''; try{ saved=sessionStorage.getItem('joto_qr_table')||''; }catch(e){}
  var code=(q||saved).replace(/[^A-Za-z0-9 _-]/g,'').trim().slice(0,20);
  if(!code) return;
  try{ sessionStorage.setItem('joto_qr_table',code); }catch(e){}
  tableMode=true; tableCode=code; mode='dine_in'; saveMode(); document.body.classList.add('table-mode');
  var bn=document.getElementById('table-banner'); if(bn){ bn.classList.remove('hidden'); document.getElementById('table-name').textContent='Table '+code; }
  var mi=document.getElementById('menu-intro'); if(mi) mi.textContent='Pick what you like and send it to the kitchen. It will be brought to your table.';
  var nav=document.getElementById('bottom-nav');
  if(nav){ nav.classList.remove('lg:hidden');
    nav.innerHTML='<div class="grid grid-cols-4 h-16"><button class="bn-item active" onclick="scrollToSection(\'menu\')"><span style="font-size:22px">🍜</span><span>Menu</span></button>'+
      '<button class="bn-item" onclick="toggleCart()"><span style="font-size:22px">🛒</span><span>Order</span><span id="bn-badge" class="bn-badge hidden">0</span></button>'+
      '<button class="bn-item" onclick="callService(\'waiter\')"><span style="font-size:22px">🙋</span><span>Call waiter</span></button>'+
      '<button class="bn-item" onclick="callService(\'bill\')"><span style="font-size:22px">🧾</span><span>Bill</span></button></div>'; }
}
function leaveTable(){ try{ sessionStorage.removeItem('joto_qr_table'); sessionStorage.removeItem('joto_table'); localStorage.removeItem('joto_mode'); }catch(e){} goTo(location.pathname); }
var svcLock={};
async function callService(kind){
  if(!JOTO_READY||mode!=='dine_in'||!tableCode) return;
  if(!branch){ openBranchModal(); return; }
  if(svcLock[kind]){ showToast('We already got your request. Someone is on the way.','info'); return; }
  var r=await sb.rpc('request_service',{p_table:tableCode,p_kind:kind,p_location:branch.id});
  if(r.error){ showToast(friendlyError(r.error),'error'); return; }
  svcLock[kind]=true; setTimeout(function(){svcLock[kind]=false;},60000);
  showToast(kind==='bill'?'We are bringing your bill':'A waiter is on the way','success');
}

/* ---------- gallery, reviews, events, locations ---------- */
async function loadGallery(){ if(!JOTO_READY) return; var r=await sb.from('gallery').select('*').order('created_at',{ascending:false}); if(!r.error&&r.data) galleryImages=r.data; }
function renderGallery(){
  var grid=document.getElementById('gallery-grid'), sec=document.getElementById('gallery'); if(!grid) return;
  var imgs=galleryImages.filter(inBranch);
  if(!imgs.length){ if(sec) sec.classList.add('hidden'); return; }
  if(sec) sec.classList.remove('hidden');
  grid.innerHTML=imgs.map(function(im,i){
    return '<div class="gallery-item skeleton '+(i===0?'md:col-span-2 md:row-span-2':'')+' fade-in-section visible" data-src="'+esc(im.src)+'">'+imgTag(im.src,im.alt||'Joto Ramen','w-full h-full object-cover')+'<div class="overlay"><p>'+esc(im.alt||'')+'</p></div></div>';
  }).join('');
  grid.querySelectorAll('.gallery-item').forEach(function(el){ el.addEventListener('click',function(){ openLightbox(el.getAttribute('data-src')); }); });
}
function setRating(n){
  currentRating=n; var inp=document.getElementById('review-rating'); if(inp) inp.value=n;
  document.querySelectorAll('.star-btn').forEach(function(s,i){ s.textContent=i<n?'★':'☆'; s.classList.toggle('text-muted-gold',i<n); s.classList.toggle('text-parchment/40',i>=n); });
}
async function loadReviews(){
  if(!JOTO_READY) return;
  var r=await sb.from('reviews').select('name,rating,text,dish,created_at,location_id').eq('status','approved').order('created_at',{ascending:false}).limit(60);
  if(!r.error&&r.data) customerReviews=r.data;
}
function renderCustomerReviews(){
  var list=document.getElementById('customer-reviews-list'); if(!list) return;
  var rows=customerReviews.filter(inBranch);
  if(!rows.length){ list.innerHTML='<div class="text-center text-parchment/60 py-12">No reviews yet'+(branch?' for '+esc(shortName(branch.name)):'')+'. Be the first!</div>'; return; }
  list.innerHTML=rows.slice(0,30).map(function(r){
    var stars=Array(r.rating+1).join('★'), empty=Array(6-r.rating).join('☆');
    return '<div class="review-card fade-in-section visible"><div class="flex items-start justify-between mb-3"><div><h4 class="text-parchment font-semibold">'+esc(r.name)+'</h4>'+
      (r.dish?'<p class="text-muted-gold text-sm">Favorite: '+esc(r.dish)+'</p>':'')+'</div><div class="text-muted-gold" aria-label="'+r.rating+' out of 5">'+stars+'<span class="text-parchment/40">'+empty+'</span></div></div>'+
      '<p class="text-parchment/80 text-sm leading-relaxed">"'+esc(r.text)+'"</p><p class="text-parchment/40 text-xs mt-3">'+new Date(r.created_at).toLocaleDateString('en-KE',{year:'numeric',month:'long',day:'numeric'})+'</p></div>';
  }).join('');
}
async function handleReviewSubmit(event){
  event.preventDefault();
  if(currentRating===0){ showToast('Please select a rating','error'); return; }
  if(!JOTO_READY){ showToast('Reviews are unavailable right now','error'); return; }
  var g=function(id){var e=document.getElementById(id);return e?e.value.trim():'';};
  var r=await sb.from('reviews').insert({name:g('review-name'),email:g('review-email'),rating:currentRating,text:g('review-text'),dish:g('review-dish')||null,status:'pending',location_id:branch?branch.id:null});
  if(r.error){ showToast(friendlyError(r.error),'error'); return; }
  event.target.reset(); setRating(0); showToast('Thank you! Your review will appear once approved.','success');
}
function nairobiToday(){ return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi'}); }
async function loadEvents(){
  eventsList=[]; if(!JOTO_READY) return;
  var r=await sb.from('events').select('*').eq('is_published',true).gte('event_date',nairobiToday()).order('event_date').order('id').limit(24);
  if(!r.error&&r.data) eventsList=r.data;
}
function renderEvents(){
  var sec=document.getElementById('events'), grid=document.getElementById('events-grid'); if(!sec||!grid) return;
  var rows=eventsList.filter(inBranch).slice(0,12);
  if(!rows.length){
    grid.className='';
    grid.innerHTML='<div class="max-w-xl mx-auto text-center bg-white/5 border border-white/10 rounded-2xl p-8"><div class="text-4xl mb-2">🎉</div><h3 class="text-xl font-bold text-parchment mb-1">No upcoming events</h3><p class="text-parchment/70 text-sm">Nothing planned right now. Follow <a class="text-muted-gold hover:underline" href="https://instagram.com/joto_ramen_nairobi" target="_blank" rel="noopener">@joto_ramen_nairobi</a> to hear about the next one first.</p></div>';
    return;
  }
  grid.className='grid md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6';
  grid.innerHTML=rows.map(function(e){
    var d=new Date(e.event_date+'T00:00:00'), day=d.toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    return '<div class="bg-white/5 rounded-2xl overflow-hidden border border-white/10 fade-in-section visible">'+(e.image_url?'<div class="aspect-video skeleton">'+imgTag(e.image_url,e.title)+'</div>':'')+
      '<div class="p-4 md:p-6"><p class="text-muted-gold text-sm font-semibold mb-1">'+esc(day)+(e.event_time?' · '+esc(e.event_time):'')+'</p><h3 class="text-xl font-bold text-parchment mb-2">'+esc(e.title)+'</h3>'+
      (e.description?'<p class="text-parchment/70 text-sm leading-relaxed mb-3">'+esc(e.description)+'</p>':'')+(e.location_name?'<p class="text-parchment/60 text-sm">📍 '+esc(e.location_name)+'</p>':'')+'</div></div>';
  }).join('');
}
function renderLocations(){
  var grid=document.getElementById('locations-grid'); if(!grid) return;
  grid.className='grid gap-4 md:gap-8 '+(locationsList.length===1?'max-w-xl mx-auto':locationsList.length>=3?'md:grid-cols-2 lg:grid-cols-3':'md:grid-cols-2');
  grid.innerHTML=locationsList.map(function(l){
    var q=encodeURIComponent(l.map_query||l.address), phone=l.phone||mainPhone, mine=branch&&branch.id===l.id;
    var hours=String(l.hours||'').split('\n').filter(Boolean).map(esc).join('<br>');
    return '<div class="loc-card fade-in-section visible'+(mine?' mine':'')+'">'+
      '<div class="h-44 md:h-56 bg-gray-800"><iframe title="Map of '+esc(l.name)+'" src="https://maps.google.com/maps?q='+q+'&t=&z=15&ie=UTF8&iwloc=&output=embed" width="100%" height="100%" style="border:0" allowfullscreen loading="lazy"></iframe></div>'+
      '<div class="p-4 md:p-6"><div class="flex items-start justify-between gap-2"><h3 class="text-xl md:text-2xl font-bold text-parchment mb-1">'+esc(l.name)+'</h3>'+(mine?'<span class="loc-badge">Your branch</span>':'')+'</div>'+
      (l.note?'<p class="text-muted-gold text-sm mb-3">'+esc(l.note)+'</p>':'<div class="mb-3"></div>')+
      '<div class="space-y-3 text-parchment/80 text-sm"><p>📍 '+esc(l.address)+'</p><p>📞 <a class="hover:text-parchment" href="tel:'+esc(String(phone).replace(/[^+\d]/g,''))+'">'+esc(phone)+'</a></p>'+(hours?'<p>🕒 '+hours+'</p>':'')+'</div>'+
      '<div class="flex gap-2 mt-4 flex-wrap"><button type="button" onclick="chooseBranch('+Number(l.id)+');scrollToSection(\'menu\')" class="px-4 py-2 bg-lantern-red text-white rounded-lg text-sm font-semibold">Order from here</button>'+
      '<a href="https://www.google.com/maps/search/?api=1&query='+q+'" target="_blank" rel="noopener" class="px-4 py-2 bg-white/10 text-parchment rounded-lg text-sm font-semibold hover:bg-white/20">Directions</a></div></div></div>';
  }).join('');
  var sel=document.getElementById('res-location');
  if(sel){ sel.innerHTML=locationsList.map(function(l){return '<option value="'+Number(l.id)+'" class="bg-charcoal">'+esc(l.name)+'</option>';}).join(''); if(branch) sel.value=String(branch.id); }
}

/* ---------- account (customer and restaurant admin) ---------- */
function roleLabel(){ return currentProfile&&(currentProfile.is_admin||currentProfile.is_manager)?'admin':'customer'; }
function openLoginModal(){
  if(currentUser){
    var r=roleLabel();
    if(r==='admin'){ goTo('admin.html'); return; }
    if(confirm('Do you want to log out?')) doSignOut();
    return;
  }
  var m=document.getElementById('login-modal'); if(m) m.classList.add('active');
}
function closeLoginModal(){ var m=document.getElementById('login-modal'); if(m) m.classList.remove('active'); }
async function doSignOut(){ if(sb) await sb.auth.signOut(); closeMore(); showToast('Signed out','info'); }
function showSignupForm(){ document.getElementById('login-form').classList.add('hidden'); document.getElementById('signup-form').classList.remove('hidden'); document.getElementById('login-modal-title').textContent='Create Account'; }
function showLoginForm(){ document.getElementById('signup-form').classList.add('hidden'); document.getElementById('login-form').classList.remove('hidden'); document.getElementById('login-modal-title').textContent='Customer Login'; }
async function handleCustomerLogin(event){
  event.preventDefault();
  if(!JOTO_READY){ showToast('Accounts are unavailable right now','error'); return; }
  var r=await sb.auth.signInWithPassword({email:document.getElementById('customer-email').value.trim(),password:document.getElementById('customer-password').value});
  if(r.error){ showToast('Invalid email or password','error'); return; }
  closeLoginModal(); event.target.reset();
  await refreshUser({user:r.data.user});
  var role=roleLabel();
  if(role==='admin'){ showToast('Welcome back. Opening the admin panel…','success'); goTo('admin.html'); return; }
  showToast('Welcome back!','success');
}
async function handleCustomerSignup(event){
  event.preventDefault();
  if(!JOTO_READY){ showToast('Accounts are unavailable right now','error'); return; }
  var pw=document.getElementById('signup-password').value;
  if(pw.length<8){ showToast('Password must be at least 8 characters','error'); return; }
  var r=await sb.auth.signUp({email:document.getElementById('signup-email').value.trim(),password:pw,options:{data:{name:document.getElementById('signup-name').value.trim(),phone:document.getElementById('signup-phone').value.trim()}}});
  if(r.error){ showToast(friendlyError(r.error),'error'); return; }
  closeLoginModal(); event.target.reset();
  showToast(r.data.session?'Account created. Welcome!':'Account created. Check your email to confirm it.','success');
}
async function refreshUser(session){
  currentUser=session?session.user:null; currentProfile=null;
  if(currentUser){ var p=await sb.from('profiles').select('name,phone,is_admin,is_manager').eq('id',currentUser.id).maybeSingle(); if(p.data) currentProfile=p.data; }
  var role=currentUser?roleLabel():'', t=document.getElementById('login-btn-text'), ma=document.getElementById('more-account'), so=document.getElementById('more-signout');
  var first=currentUser?((currentProfile&&currentProfile.name||currentUser.email).split(' ')[0]):'';
  var label=!currentUser?'Login':(role==='customer'?first:currentUser.email);
  if(t) t.textContent=label;
  if(t&&t.parentNode){ t.parentNode.title=role==='admin'?'Open the admin panel':''; t.parentNode.classList.toggle('acct-staff',role==='admin'); }
  if(ma) ma.textContent=!currentUser?'Login':(role==='admin'?'Admin panel':'Hi, '+first);
  if(so) so.classList.toggle('hidden',!currentUser);
}

/* ---------- reservations + newsletter ---------- */
async function handleReservation(event){
  event.preventDefault();
  if(!JOTO_READY){ showToast('Booking is unavailable right now. Please DM or WhatsApp us.','error'); return; }
  var g=function(id){return document.getElementById(id).value.trim();};
  var b=findBranch(g('res-location'))||branch;
  var r=await sb.from('reservations').insert({name:g('res-name'),phone:g('res-phone'),email:g('res-email'),date:g('res-date'),time:g('res-time'),guests:parseInt(g('res-guests'),10)||2,location:b?b.name:'',location_id:b?b.id:null,requests:g('res-requests')||null,status:'pending'});
  if(r.error){ showToast(friendlyError(r.error),'error'); return; }
  event.target.reset(); if(b){ var sel=document.getElementById('res-location'); if(sel) sel.value=String(b.id); }
  showToast('Reservation request received! We will confirm within 24 hours.','success');
}
async function handleNewsletter(event){
  event.preventDefault();
  var el=document.getElementById('newsletter-email'); if(!el||!el.value) return;
  if(!JOTO_READY){ showToast('Subscriptions are unavailable right now','error'); return; }
  var r=await sb.from('newsletter_subscribers').insert({email:el.value.trim().toLowerCase()});
  if(r.error&&r.error.code!=='23505'){ showToast(friendlyError(r.error),'error'); return; }
  el.value=''; showToast(r.error?'You are already subscribed':'Thanks for subscribing!','success');
}

/* ---------- boot ---------- */
function initScrollAnimations(){
  if(!('IntersectionObserver' in window)){ document.querySelectorAll('.fade-in-section').forEach(function(s){s.classList.add('visible');}); return; }
  var obs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.classList.add('visible');});},{threshold:0.1});
  document.querySelectorAll('.fade-in-section').forEach(function(s){obs.observe(s);});
}
async function init(){
  var y=document.getElementById('current-year'); if(y) y.textContent=new Date().getFullYear();
  var d=document.getElementById('res-date'); if(d) d.min=new Date().toISOString().split('T')[0];
  loadMode(); initTableMode(); loadCart();
  var ot=document.getElementById('order-type'); if(ot) ot.addEventListener('change',renderCart);
  var ticking=false;
  window.addEventListener('scroll',function(){ if(ticking) return; ticking=true; requestAnimationFrame(function(){ var n=document.getElementById('navbar'); if(n) n.classList.toggle('scrolled',window.scrollY>50); updateBottomNav(); ticking=false; }); },{passive:true});
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ closeMore(); closeOrderModal(); closeLoginModal(); closeLightbox(); closeBranchModal(); closeModeModal(); closeOrders(); } });
  if(!JOTO_READY) console.warn('Supabase is not configured: edit public/config.js. Showing the built-in menu only.');
  await Promise.all([loadMenu(),loadGallery(),loadReviews(),loadSettings(),loadLocations(),loadEvents()]);
  var want=''; try{ want=new URLSearchParams(window.JOTO_QS!==undefined?window.JOTO_QS:location.search).get('b')||localStorage.getItem('joto_branch')||''; }catch(e){}
  var b=findBranch(want); if(b) branch=b;
  if(!branch&&locationsList.length===1) branch=locationsList[0];
  renderBranchUI(); renderModeUI(); initScrollAnimations();
  renderOrdersFab(); pollOrders();
  if(!branch) openBranchModal(); else if(!mode&&!tableMode) openModeModal();
  if(JOTO_READY){
    var s=await sb.auth.getSession(); await refreshUser(s.data.session);
    sb.auth.onAuthStateChange(function(_e,session){ refreshUser(session); });
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
