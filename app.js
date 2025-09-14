// ONECHAT — v31 base — Approval flow fixed (only this file changed)

/* ========= DOM helpers ========= */
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));

// Primary elements (with safe fallbacks)
const messagesEl   = $('#messages') || $('.messages');
const linkBtn      = $('#linkBtn') || $('#link') || $('a.link');
const qrCanvas     = $('#qrCanvas') || $('#qrTop') || $('#qr');
const codeText     = $('#codeText') || $('#codeTextTop') || $('#code');
const exitBtn      = $('#exitBtn') || $('#btnExit') || $('#closeBtn');
const homeBtn      = $('#homeBtn') || $('#brandLink') || $('.brand');

// Composer (top)
const msgInput     = $('#msgInput') || $('#messageInput') || $('textarea');
const sendBtn      = $('#sendBtn') || $('#send');
const attachBtn    = $('#attachBtn') || $('#attach');
const fileInput    = $('#fileInput') || $('#file');

// Composer (center helpers)
const msgCenter    = $('#msgCenter');
const sendCenter   = $('#sendCenter');
const attachCenter = $('#attachCenter');
const fileCenter   = $('#fileCenter');

function scrollBottom(){ try{ messagesEl.scrollTop = messagesEl.scrollHeight; }catch(_){} }

function toast(text, actions=[]){
  try{
    const wrap = $('#toasts') || document.body;
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    if(actions.length){
      const bar = document.createElement('div'); bar.className='toast-actions';
      actions.forEach(a=>{
        const b = document.createElement('button'); b.textContent = a.label || 'OK';
        b.onclick = ()=>{ try{ a.onClick?.(); }catch(e){ console.error(e);} t.remove(); };
        bar.appendChild(b);
      });
      t.appendChild(bar);
    }
    wrap.appendChild(t);
    setTimeout(()=>t.remove(), 5000);
  }catch(e){ console.log('[toast]', text); }
}

function addMsg(m, mine, open=true){
  try{ messagesEl.classList.remove('empty'); }catch(_){}

  const wrap = document.createElement('div');
  wrap.className = 'msg' + (mine ? ' mine' : '');

  const meta = document.createElement('div');
  meta.className = 'from';
  meta.textContent = `${m.from || 'FROM'} • ${new Date(m.ts || Date.now()).toLocaleString()}`;
  wrap.appendChild(meta);

  const body = document.createElement('div');
  if (m.type === 'file' && m.file) {
    body.className = 'file';
    const name = document.createElement('div'); name.className = 'name'; name.textContent = m.file.name || '(file)';
    body.appendChild(name);

    if (m.file.dataURL) {
      if ((m.file.mime||'').startsWith('image/')) {
        const img = document.createElement('img'); img.className='preview'; img.src = m.file.dataURL; img.alt = m.file.name||'image'; body.appendChild(img);
      } else if ((m.file.mime||'').startsWith('video/')) {
        const v = document.createElement('video'); v.className='preview'; v.controls=true; v.src=m.file.dataURL; body.appendChild(v);
      } else if ((m.file.mime||'').startsWith('audio/')) {
        const a = document.createElement('audio'); a.className='preview'; a.controls=true; a.src=m.file.dataURL; body.appendChild(a);
      }
    }
    const a = document.createElement('a'); a.href = m.file.dataURL || '#'; a.download = m.file.name || 'file'; a.textContent = 'Tải xuống'; body.appendChild(a);
  } else {
    body.className='text'; body.textContent = m.text || '';
  }
  wrap.appendChild(body);
  messagesEl.appendChild(wrap);
  scrollBottom();
}
const info = (text)=> addMsg({type:'system', from:'FROM', text, ts:Date.now()}, false, true);

/* ========= Firebase ========= */
if(!window.firebaseConfig) throw new Error('Thiếu config.js (firebaseConfig).');

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, child, set, get, push, onChildAdded, onValue, update, remove } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

const app = initializeApp(window.firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* ========= Identity & State ========= */
const qs = new URLSearchParams(location.search);
const roomParam = (qs.get('room') || '').toUpperCase();

const LOCAL_UID_KEY = 'onechat_uid';
let MY_UID = localStorage.getItem(LOCAL_UID_KEY);
if(!MY_UID){
  MY_UID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem(LOCAL_UID_KEY, MY_UID);
}

let roomCode = '', isOwner = false, myName = '';
let roomRef, msgsRef, membersRef, requestsRef;
let approved = false; // chỉ cho gửi khi true

const isCode  = s => /^[A-Z0-9]{5,7}$/i.test((s||'').trim());
function randCode(n=6){ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let r=''; for(let i=0;i<n;i++) r+=c[Math.floor(Math.random()*c.length)]; return r; }
const baseLink = ()=> `${location.origin}${location.pathname}`;
const roomLink = c  => `${baseLink()}?room=${c}`;

function qrDraw(text){
  try{ /* eslint-disable no-undef */ QRCode.toCanvas(qrCanvas, text, { width: 64, margin: 1 }); }catch(_){}
}
function setTopbar(code){
  const link = roomLink(code);
  if(codeText) codeText.textContent = code;
  if(linkBtn){
    linkBtn.onclick = ()=>{ navigator.clipboard?.writeText(link); info('Đã copy LINK: ' + link); };
    if(linkBtn.tagName==='A') linkBtn.href = link;
  }
  qrDraw(link);
}
function renderMembersToChat(members){
  const arr = Object.values(members||{}).map(x => x.name + (x.isOwner?' (chủ)':''));
  info('Thành viên: ' + (arr.join(', ') || '—'));
}

/* ========= Core Approval ========= */
async function ensureRoom(code){
  roomRef     = ref(db, `rooms/${code}`);
  msgsRef     = child(roomRef, 'messages');
  membersRef  = child(roomRef, 'members');
  requestsRef = child(roomRef, 'requests');

  // Claim owner if not exists
  const ownerSnap = await get(child(roomRef, 'ownerId'));
  let ownerId = ownerSnap.exists() ? ownerSnap.val() : null;
  if(!ownerId){
    await set(child(roomRef, 'ownerId'), MY_UID);
    ownerId = MY_UID;
  }
  isOwner = (ownerId === MY_UID);
  return ownerId;
}
async function nextGuestName(code){
  const snap = await get(child(ref(db), `rooms/${code}/members`));
  const members = snap.val() || {};
  const nums = Object.keys(members).filter(k=>/^chimse\d+$/i.test(k)).map(k=>parseInt(k.replace(/chimse/i,''),10));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `chimse${next}`;
}
async function ownerListenRequests(){
  onChildAdded(requestsRef, async (s) => {
    const req = s.val(); if(!req) return;
    if(req.status && req.status!=='pending') return;
    const name = req.name || await nextGuestName(roomCode);
    const ok = confirm(`Yêu cầu vào phòng: ${name}\n\nOK = CHẤP NHẬN, Cancel = TỪ CHỐI.`);
    if(ok){
      await update(membersRef, { [name]: { name, ts: Date.now() } });
      await update(child(requestsRef, s.key), { status: 'approved', name });
    }else{
      await update(child(requestsRef, s.key), { status: 'denied' });
    }
  });
}

/* ========= Flows ========= */
function bindMessages(){
  onChildAdded(msgsRef, snap => {
    const m = snap.val(); addMsg(m, m.from === myName);
  });
  onValue(membersRef, snap => {
    const v = snap.val() || {}; renderMembersToChat(v);
    if(v[myName]) approved = true; // approved once in members
  });
}
async function ownerFlow(){
  roomCode = roomParam || randCode();
  setTopbar(roomCode);
  await ensureRoom(roomCode);
  await update(membersRef, { 'Daibang': { name:'Daibang', isOwner:true, ts: Date.now() } });
  myName = 'Daibang'; approved = true;
  bindMessages();
  info('Bạn là chủ phòng. Người khác cần bạn duyệt để vào.');
  history.replaceState({},'', roomLink(roomCode));
  await ownerListenRequests();
}
async function guestFlow(code){
  roomCode = code.toUpperCase();
  setTopbar(roomCode);
  await ensureRoom(roomCode);

  // Nếu phòng chưa có chủ và mình vừa claim -> chuyển owner, không gửi request
  if(isOwner){
    await update(membersRef, { 'Daibang': { name:'Daibang', isOwner:true, ts: Date.now() } });
    myName = 'Daibang'; approved = true;
    bindMessages();
    info('Bạn là chủ phòng. Người khác cần bạn duyệt để vào.');
    await ownerListenRequests();
    return;
  }

  myName = await nextGuestName(roomCode);
  await set(child(requestsRef, MY_UID), { uid: MY_UID, name: myName, ts: Date.now(), status:'pending' });
  info('Đang chờ chủ phòng duyệt…');
  bindMessages();

  onValue(child(requestsRef, MY_UID), (s)=>{
    const v = s.val(); if(!v) return;
    if(v.status === 'approved'){
      if(v.name) myName = v.name; approved = true; info(`Bạn đã được duyệt (${myName}).`);
    }else if(v.status === 'denied'){
      approved = false; info('Yêu cầu bị từ chối.');
    }
  });
}

/* ========= Send / Upload (approval gate) ========= */
function mustApproved(){
  if(approved || isOwner) return true;
  alert('Chưa được duyệt/vào phòng.');
  return false;
}
function handleSend(textarea){
  const t = (textarea?.value||'').trim();
  if(!t) return;
  if(isCode(t)){
    if(roomCode && t.toUpperCase()!==roomCode){
      if(!confirm(`Vào phòng ${t.toUpperCase()}? Bạn sẽ rời phòng hiện tại.`)) return;
    }
    location.href = roomLink(t.toUpperCase());
    return;
  }
  if(!roomCode){ info('Chưa có phòng.'); return; }
  if(!mustApproved()) return;
  const id = push(msgsRef).key;
  const msg = { type:'text', from: myName||'FROM', ts: Date.now(), text: t };
  set(child(msgsRef, id), msg);
  textarea.value='';
}
sendBtn?.addEventListener('click', ()=>handleSend(msgInput));
msgInput?.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleSend(msgInput); }});
sendCenter?.addEventListener('click', ()=>handleSend(msgCenter));
msgCenter?.addEventListener('keydown', e=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); handleSend(msgCenter); }});

function chooseFile(){ (fileInput||fileCenter)?.click(); }
attachBtn?.addEventListener('click', chooseFile);
attachCenter?.addEventListener('click', chooseFile);

function onFiles(el){
  el?.addEventListener('change', ()=>{
    const f = el.files?.[0]; if(!f) return;
    if(!roomCode){ alert('Chưa ở trong phòng.'); el.value=''; return; }
    if(!mustApproved()){ el.value=''; return; }
    const r = new FileReader();
    r.onerror = ()=>alert('Không đọc được tệp: ' + (r.error?.message||''));
    r.onload = ()=>{
      const id = push(msgsRef).key;
      const msg = { type:'file', from: myName||'FROM', ts:Date.now(), file:{ name:f.name, mime:f.type, size:f.size, dataURL:r.result } };
      set(child(msgsRef, id), msg);
    };
    r.readAsDataURL(f);
    el.value='';
  });
}
onFiles(fileInput); onFiles(fileCenter);

/* ========= Exit / Home ========= */
async function exitAndRestart(){
  try{
    if(roomCode){
      await remove(child(ref(db), `rooms/${roomCode}/requests/${MY_UID}`));
      if(myName) await remove(child(ref(db), `rooms/${roomCode}/members/${myName}`));
    }
  }catch(e){ console.warn(e); }
  location.href = baseLink();
}
exitBtn?.addEventListener('click', (e)=>{ e.preventDefault(); exitAndRestart(); });
homeBtn?.addEventListener('click', (e)=>{ e.preventDefault(); exitAndRestart(); });

/* ========= Bootstrap ========= */
await signInAnonymously(auth).catch(e=>{ console.error(e); alert('Bật Anonymous trong Firebase Auth'); });
if(roomParam){ await guestFlow(roomParam); } else { await ownerFlow(); }
