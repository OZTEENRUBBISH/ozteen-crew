/* OzTeen Crew board — standalone version (Supabase + GitHub Pages) */
"use strict";

// Capture the link type (password reset) before Supabase reads and clears the URL.
const LINK_IS_RECOVERY = /type=recovery/.test(location.hash);

const CFG = window.OZ_CONFIG || {};
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("YOUR-PROJECT") || !CFG.SUPABASE_ANON_KEY || CFG.SUPABASE_ANON_KEY.includes("PASTE-")) {
  document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px">Setup isn\'t finished: paste your Supabase URL and anon key into <b>config.js</b>.</p>';
  throw new Error("Missing Supabase config");
}
// Tolerate a project URL pasted with /rest/v1/ on the end.
const PROJECT_URL = CFG.SUPABASE_URL.trim().replace(/\/(rest|auth)\/v1\/?$/,"").replace(/\/+$/,"");
const sb = supabase.createClient(PROJECT_URL, CFG.SUPABASE_ANON_KEY.trim());

const SERVICES = {Rubbish:"Rubbish removal", Gardens:"Gardens & landscaping", Pressure:"Pressure washing"};
const SC = {Rubbish:"var(--rub)", Gardens:"var(--gar)", Pressure:"var(--pw)"};
const AV = {all:"All day", am:"AM", pm:"PM", off:"Off"};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const S = {
  uid:null, me:null, started:false, recovery:LINK_IS_RECOVERY,
  profiles:{}, jobs:[], avail:{}, notes:{}, photos:{}, urlCache:{},
  myDays:{}, myNote:"", month:null, sel:null, teamStart:null, editing:null, openJob:null, filter:"all",
};

/* ---------------- helpers ---------------- */
const key = d => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const parse = k => { const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); };
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const monday = d => { const x=new Date(d.getFullYear(),d.getMonth(),d.getDate()); return addDays(x,-((x.getDay()+6)%7)); };
const today = () => { const n=new Date(); return new Date(n.getFullYear(),n.getMonth(),n.getDate()); };
const nice = k => { const d=parse(k); return DOW[d.getDay()]+" "+d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3); };
const fmtTime = t => { if(!t) return ""; const [h,m]=t.split(":").map(Number); return ((h%12)||12)+(m?":"+String(m).padStart(2,"0"):"")+(h>=12?"pm":"am"); };

function el(tag, attrs={}, ...kids){
  const e=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(v===false||v==null) continue;
    if(k==="class") e.className=v; else if(k==="text") e.textContent=v;
    else if(k.startsWith("on")) e.addEventListener(k.slice(2),v);
    else if(k==="style") e.style.cssText=v; else if(k==="value") e.value=v;
    else e.setAttribute(k,v===true?"":v);
  }
  for(const c of kids.flat()) if(c!=null&&c!==false) e.append(c.nodeType?c:document.createTextNode(c));
  return e;
}
function toast(msg){ const t=$("#toast"); t.textContent=msg; t.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>t.hidden=true,3000); }
function showErr(id,msg){ const e=$(id); e.textContent=msg||""; e.hidden=!msg; }
function busy(btn,on,label){ btn.disabled=on; if(label) btn.textContent=label; }

/* ---------------- auth screens ---------------- */
function authView(v){
  $("#app").hidden=true; $("#auth").hidden=false;
  $$("#auth [data-view]").forEach(x=>x.hidden = x.dataset.view!==v);
}
$$("[data-go]").forEach(b=>b.addEventListener("click",()=>{ authView(b.dataset.go); }));
$$("[data-signout]").forEach(b=>b.addEventListener("click",async()=>{ await sb.auth.signOut(); location.hash=""; location.reload(); }));

$("#signinForm").addEventListener("submit",async e=>{
  e.preventDefault(); showErr("#si-error");
  const btn=$("#si-btn"); busy(btn,true,"Signing in…");
  const {error}=await sb.auth.signInWithPassword({email:$("#si-email").value.trim(), password:$("#si-pass").value});
  busy(btn,false,"Sign in");
  if(error) showErr("#si-error", /invalid login credentials/i.test(error.message)?"That email and password don't match. Check for typos, or reset your password.":error.message);
});

$("#forgotForm").addEventListener("submit",async e=>{
  e.preventDefault(); showErr("#fp-error");
  const email=$("#fp-email").value.trim(), btn=$("#fp-btn"); busy(btn,true,"Sending…");
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo: location.origin+location.pathname});
  busy(btn,false,"Send reset link");
  if(error && !/not authorized|rate/i.test(error.message)) { showErr("#fp-error",error.message); return; }
  if(error) { showErr("#fp-error","Reset emails aren't switched on yet. Ask Max or Nick to reset your password."); return; }
  $("#sent-email").textContent=email; authView("sent");
});

$("#setpwForm").addEventListener("submit",async e=>{
  e.preventDefault(); showErr("#sp-error");
  const p1=$("#sp-pass").value, p2=$("#sp-pass2").value, name=$("#sp-name").value.trim();
  if(p1.length<8) return showErr("#sp-error","Use at least 8 characters.");
  if(p1!==p2) return showErr("#sp-error","The two passwords don't match.");
  const btn=$("#sp-btn"); busy(btn,true,"Saving…");
  const {error}=await sb.auth.updateUser({password:p1});
  if(error && !/same|different/i.test(error.message)){ busy(btn,false,"Save and continue"); return showErr("#sp-error",error.message); }
  await sb.from("profiles").update({name, must_change_password:false}).eq("id",S.uid);
  busy(btn,false,"Save and continue");
  S.recovery=false; history.replaceState(null,"",location.pathname);
  S.me.name=name; S.me.must_change_password=false;
  toast("Password saved"); startApp();
});

/* ---------------- session handling ---------------- */
let handling=null;
sb.auth.onAuthStateChange((event,session)=>{
  if(event==="PASSWORD_RECOVERY") S.recovery=true;
  if(event==="TOKEN_REFRESHED"||event==="USER_UPDATED") return;
  setTimeout(()=>handleSession(session),0);   // never await Supabase calls inside this callback
});

async function handleSession(session){
  if(!session){ S.uid=null; S.started=false; authView("signin"); return; }
  if(S.started && S.uid===session.user.id && !S.recovery) return;
  if(handling) return; handling=true;
  try{
    S.uid=session.user.id; authView("loading");
    const {data:me,error}=await sb.from("profiles").select("*").eq("id",S.uid).maybeSingle();
    if(error||!me){ $("#blocked-msg").textContent="Your account isn't set up on the crew board yet. Ask Max or Nick."; authView("blocked"); return; }
    S.me=me;
    if(!me.active){ authView("blocked"); return; }
    if(S.recovery||me.must_change_password){
      $("#setpw-title").textContent = S.recovery?"Choose a new password":"Welcome to the crew board";
      $("#setpw-sub").textContent = S.recovery?"Pick a new password for your crew account.":"First time here: add your name and swap the temporary password for one only you know.";
      $("#sp-name").value = me.name || "";
      authView("setpw"); return;
    }
    startApp();
  } finally { handling=false; }
}

/* ---------------- data ---------------- */
function toJob(r){
  return {id:r.id, title:r.title, service:r.service, date:r.start_date, endDate:r.end_date||"",
    time:(r.start_time||"").slice(0,5), endTime:(r.end_time||"").slice(0,5),
    address:r.address||"", suburb:r.suburb||"", notes:r.notes||"", crew:r.crew||[], createdBy:r.created_by};
}
async function loadAll(){
  const from=key(addDays(today(),-120)), aFrom=key(addDays(today(),-35)), aTo=key(addDays(today(),70));
  const [p,j,a,ph]=await Promise.all([
    sb.from("profiles").select("*").order("name"),
    sb.from("jobs").select("*").gte("start_date",from).order("start_date"),
    sb.from("availability").select("user_id,day,status").gte("day",aFrom).lte("day",aTo),
    sb.from("job_photos").select("*").order("created_at"),
  ]);
  const err=[p,j,a,ph].find(r=>r.error);
  if(err){ toast("Couldn't load everything. Check your connection."); console.error(err.error); }
  S.profiles={}; (p.data||[]).forEach(x=>S.profiles[x.id]=x);
  if(S.profiles[S.uid]) S.me=S.profiles[S.uid];
  S.jobs=(j.data||[]).map(toJob);
  S.avail={}; (a.data||[]).forEach(r=>{ (S.avail[r.user_id]=S.avail[r.user_id]||{})[r.day]=r.status; });
  if(!dirty && !saving){ S.myDays={...(S.avail[S.uid]||{})}; S.myNote=(S.me&&S.me.availability_note)||""; if(document.activeElement!==$("#availNote")) $("#availNote").value=S.myNote; }
  // photos: signed links (bucket is private)
  const rows=ph.data||[], need=rows.map(r=>r.path).filter(pth=>!S.urlCache[pth]);
  if(need.length){
    for(let i=0;i<need.length;i+=100){
      const {data}=await sb.storage.from("job-photos").createSignedUrls(need.slice(i,i+100), 60*60*12);
      (data||[]).forEach(d=>{ if(d.signedUrl) S.urlCache[d.path]=d.signedUrl; });
    }
  }
  S.photos={}; rows.forEach(r=>{ (S.photos[r.job_id]=S.photos[r.job_id]||[]).push({id:r.id,path:r.path,url:S.urlCache[r.path],by:r.uploaded_by,at:r.created_at}); });
}
let reloadT=null;
function scheduleReload(){ clearTimeout(reloadT); reloadT=setTimeout(async()=>{ await loadAll(); renderAll(); },400); }
const OWNER_TABS = ["admin","clients","accounts","quotes"];

async function startApp(){
  if(S.started) return; S.started=true;
  $("#auth").hidden=true; $("#app").hidden=false;
  $$("#tabs [data-owner]").forEach(b=>b.hidden = S.me.role!=="owner");
  const t=today(); S.month=new Date(t.getFullYear(),t.getMonth(),1); S.sel=key(t); S.teamStart=monday(t);
  try{ const v=localStorage.getItem("oz-tab"); if(v && $("#v-"+v) && (!OWNER_TABS.includes(v)||S.me.role==="owner")) show(v); }catch(e){}
  await loadAll();
  if(S.me.role==="owner" && window.BIZ) await BIZ.start();
  renderAll();
  sb.from("profiles").update({last_seen:new Date().toISOString()}).eq("id",S.uid).then(()=>{});
  sb.channel("crew-board")
    .on("postgres_changes",{event:"*",schema:"public",table:"jobs"},scheduleReload)
    .on("postgres_changes",{event:"*",schema:"public",table:"availability"},scheduleReload)
    .on("postgres_changes",{event:"*",schema:"public",table:"job_photos"},scheduleReload)
    .on("postgres_changes",{event:"*",schema:"public",table:"profiles"},scheduleReload)
    .subscribe();
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") scheduleReload(); });
}

/* ---------------- people ---------------- */
const isOwner = () => S.me && S.me.role==="owner";
const activeIds = () => Object.values(S.profiles).filter(p=>p.active).map(p=>p.id);
const pname = id => { const p=S.profiles[id]; if(!p) return "Former crew"; return p.name || p.email.split("@")[0]; };
const colorFor = id => { let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))%360; return "hsl("+h+" 45% 42%)"; };
const initials = id => pname(id).split(/\s+/).map(w=>w[0]).join("").slice(0,2).toUpperCase();
const avatar = id => el("span",{class:"av",style:"background:"+colorFor(id),"aria-hidden":"true",text:initials(id)});
const personChip = (id,extra) => el("span",{class:"pp"}, avatar(id), pname(id)+(id===S.uid?" (you)":""), extra||null);
const availOn = (id,k) => (S.avail[id]&&S.avail[id][k]) || null;
const tagFor = v => el("span",{class:"tag a-"+(v||"none"), text: v?AV[v]:"Not set"});
const isFree = (id,k) => ["all","am","pm"].includes(availOn(id,k));

/* ---------------- tabs ---------------- */
$$("#tabs button").forEach(b=>b.addEventListener("click",()=>{ show(b.dataset.v); if(b.dataset.v==="up") renderCards(); }));
function show(v){
  $$("#tabs button").forEach(b=>b.setAttribute("aria-selected",b.dataset.v===v));
  $$("#app section[id^='v-']").forEach(x=>x.hidden = x.id!=="v-"+v);
  try{ localStorage.setItem("oz-tab",v); }catch(e){}
  if(window.BIZ && BIZ.onShow) BIZ.onShow(v);
}

/* ---------------- jobs calendar ---------------- */
const endOf = j => (j.endDate && j.endDate>=j.date) ? j.endDate : j.date;
function jobsOn(k){ return S.jobs.filter(j=>j.date<=k && endOf(j)>=k).sort((a,b)=>(a.time||"").localeCompare(b.time||"")); }
function jobDays(j){ const out=[]; for(let d=parse(j.date); key(d)<=endOf(j) && out.length<60; d=addDays(d,1)) out.push(key(d)); return out; }
function hoursPerDay(j){ if(!j.time||!j.endTime) return null; const m=t=>{const [h,mm]=t.split(":").map(Number); return h*60+mm;}; const h=(m(j.endTime)-m(j.time))/60; return h>0?h:null; }
const fmtH = h => (Math.round(h*10)/10)+" hr"+(h===1?"":"s");
function whenText(j){
  const d = endOf(j)!==j.date ? nice(j.date)+" – "+nice(endOf(j)) : nice(j.date);
  const t = j.time ? fmtTime(j.time)+(j.endTime?"–"+fmtTime(j.endTime):"") : "Time TBC";
  return d+", "+t;
}
function renderCal(){
  const m=S.month; $("#monthLbl").textContent=MONTHS[m.getMonth()]+" "+m.getFullYear();
  const start=monday(new Date(m.getFullYear(),m.getMonth(),1));
  const end=addDays(monday(new Date(m.getFullYear(),m.getMonth()+1,0)),6);
  const g=$("#grid"); g.replaceChildren(); const tk=key(today()), ids=activeIds();
  for(let d=new Date(start); d<=end; d=addDays(d,1)){
    const k=key(d), js=jobsOn(k), free=ids.filter(id=>isFree(id,k)).length;
    g.append(el("button",{class:"day"+(d.getMonth()!==m.getMonth()?" other":"")+(k===tk?" today":"")+(k===S.sel?" sel":""),
      "aria-label":nice(k)+", "+js.length+" job"+(js.length===1?"":"s"), onclick:()=>{S.sel=k; S.editing=null; renderCal(); renderPanel();}},
      el("span",{class:"n"}, el("b",{text:d.getDate()}), free?el("i",{text:free+" free",title:free+" crew available"}):null),
      js.slice(0,3).map(j=>el("span",{class:"chip s-"+(j.service||"Rubbish"), text:(j.time&&j.date===k?fmtTime(j.time)+" ":"")+j.title})),
      js.length>3?el("span",{class:"more",text:"+"+(js.length-3)+" more"}):null));
  }
}
function jobCard(j, withDate){
  return el("div",{class:"job",style:"--c:"+SC[j.service||"Rubbish"]},
    el("span",{class:"t",text:j.title}),
    el("span",{class:"meta",text:[withDate?whenText(j):(j.time?fmtTime(j.time)+(j.endTime?"–"+fmtTime(j.endTime):""):"Time TBC"), j.suburb, SERVICES[j.service]].filter(Boolean).join(" · ")}),
    j.notes?el("span",{class:"meta",text:j.notes}):null,
    j.crew.length?el("div",{class:"people"}, j.crew.map(c=>personChip(c))):el("span",{class:"meta",text:"No crew assigned yet"}),
    el("div",{class:"acts"},
      el("button",{class:"btn ghost",text:"Details",onclick:()=>openDetails(j.id)}),
      isOwner()?el("button",{class:"btn ghost",text:"Edit",onclick:()=>editJob(j)}):null,
      isOwner()?el("button",{class:"btn danger",text:"Delete",onclick:e=>confirmTwice(e.target,()=>deleteJob(j.id))}):null));
}
function confirmTwice(btn,fn){
  if(btn.dataset.armed){ fn(); return; }
  const old=btn.textContent; btn.dataset.armed="1"; btn.textContent="Tap again to confirm";
  setTimeout(()=>{ if(btn.isConnected){ delete btn.dataset.armed; btn.textContent=old; } },3000);
}
function renderPanel(){
  const p=$("#panel"); p.replaceChildren(); const k=S.sel;
  if(S.editing!==null){ p.append(jobForm()); return; }
  const js=jobsOn(k);
  p.append(el("div",{class:"top"}, el("h2",{text:nice(k)}), isOwner()?el("button",{class:"btn",text:"+ Add job",onclick:()=>{S.editing="new"; renderPanel();}}):null));
  p.append(js.length? el("div",{class:"list"}, js.map(j=>jobCard(j))) : el("p",{class:"muted",style:"margin:0",text:"No jobs booked for this day."}));
  const free=activeIds().filter(id=>isFree(id,k));
  p.append(el("div",{}, el("h3",{text:"Available this day"}),
    free.length? el("div",{class:"people"}, free.map(id=>personChip(id, tagFor(availOn(id,k)))))
               : el("p",{class:"muted",style:"margin:0;font-size:14px",text:"Nobody has marked themselves available yet."})));
}
function jobForm(){
  const j = S.editing==="new" ? {date:S.sel,endDate:"",time:"08:00",endTime:"12:00",title:"",address:"",suburb:"",service:"Rubbish",crew:[],notes:""} : {...S.jobs.find(x=>x.id===S.editing)};
  const crewBox=el("div",{class:"crewpick"});
  const drawCrew=date=>{
    crewBox.replaceChildren();
    const ids=activeIds().sort((a,b)=>{const r=v=>({all:0,am:1,pm:1}[v]??2); return r(availOn(a,date))-r(availOn(b,date));});
    ids.forEach(id=>crewBox.append(el("label",{}, el("input",{type:"checkbox",value:id,id:"crew-"+id,checked:j.crew.includes(id)}), pname(id), tagFor(availOn(id,date)))));
  };
  const f=el("form",{class:"jobform"},
    el("h2",{text:S.editing==="new"?"New job":"Edit job"}),
    el("label",{for:"f-title"},"Job",el("input",{id:"f-title",required:true,value:j.title,placeholder:"e.g. Garage clear-out (All in One Trip)"})),
    el("div",{class:"row2"},
      el("label",{for:"f-date"},"Start date",el("input",{id:"f-date",type:"date",required:true,value:j.date,onchange:e=>drawCrew(e.target.value)})),
      el("label",{for:"f-end"},"End date (if multi-day)",el("input",{id:"f-end",type:"date",value:j.endDate}))),
    el("div",{class:"row2"},
      el("label",{for:"f-time"},"Start time",el("input",{id:"f-time",type:"time",value:j.time})),
      el("label",{for:"f-etime"},"Finish time",el("input",{id:"f-etime",type:"time",value:j.endTime}))),
    el("label",{for:"f-address"},"Address",el("input",{id:"f-address",value:j.address,placeholder:"e.g. 12 Pittwater Rd"})),
    el("div",{class:"row2"},
      el("label",{for:"f-suburb"},"Suburb",el("input",{id:"f-suburb",value:j.suburb,placeholder:"e.g. Dee Why"})),
      el("label",{for:"f-service"},"Service",el("select",{id:"f-service"}, Object.entries(SERVICES).map(([v,t])=>el("option",{value:v,selected:j.service===v},t))))),
    el("label",{},"Crew"), crewBox,
    el("label",{for:"f-notes"},"Notes",el("textarea",{id:"f-notes",rows:"2",placeholder:"Access, quote amount, customer phone…"},j.notes)),
    el("div",{class:"formacts"}, el("button",{class:"btn",type:"submit",id:"f-save",text:"Save job"}), el("button",{class:"btn ghost",type:"button",text:"Cancel",onclick:()=>{S.editing=null; renderPanel();}})));
  drawCrew(j.date);
  f.addEventListener("submit",async e=>{
    e.preventDefault();
    const sd=$("#f-date").value, ed=$("#f-end").value;
    const row={ title:$("#f-title").value.trim(), service:$("#f-service").value, start_date:sd, end_date:(ed&&ed>sd)?ed:null,
      start_time:$("#f-time").value||null, end_time:$("#f-etime").value||null,
      address:$("#f-address").value.trim(), suburb:$("#f-suburb").value.trim(), notes:$("#f-notes").value.trim(),
      crew:[...crewBox.querySelectorAll("input:checked")].map(i=>i.value), updated_at:new Date().toISOString() };
    busy($("#f-save"),true,"Saving…");
    const res = S.editing==="new" ? await sb.from("jobs").insert({...row, created_by:S.uid}) : await sb.from("jobs").update(row).eq("id",S.editing);
    if(res.error){ busy($("#f-save"),false,"Save job"); toast("Couldn't save the job: "+res.error.message); return; }
    toast(S.editing==="new"?"Job added":"Job updated"); S.sel=sd; S.editing=null;
    await loadAll(); renderAll();
  });
  return f;
}
async function deleteJob(id){
  const paths=(S.photos[id]||[]).map(p=>p.path);
  const {error}=await sb.from("jobs").delete().eq("id",id);
  if(error){ toast("Couldn't delete the job."); return; }
  if(paths.length) await sb.storage.from("job-photos").remove(paths);
  if(S.openJob===id) S.openJob=null;
  toast("Job deleted"); await loadAll(); renderAll();
}
function editJob(j){ S.sel=j.date; S.editing=j.id; S.month=new Date(parse(j.date).getFullYear(),parse(j.date).getMonth(),1); show("jobs"); renderCal(); renderPanel(); window.scrollTo({top:0}); }
function renderUpcoming(){
  const t=key(today()), e=key(addDays(today(),13));
  const js=S.jobs.filter(j=>endOf(j)>=t&&j.date<=e).sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||"")));
  const box=$("#upcoming"); box.replaceChildren();
  box.append(js.length? js.map(j=>jobCard(j,true)) : el("div",{class:"empty",text:isOwner()?"No jobs in the next two weeks. Pick a day on the calendar and tap “Add job”.":"No jobs booked in the next two weeks yet."}));
}

/* ---------------- my availability ---------------- */
let saveT=null, saving=false, dirty=false;
const pending={};   // day -> status or null (cleared)
function renderWeeks(){
  const box=$("#weeks"); box.replaceChildren();
  const m0=monday(today()), tk=key(today());
  for(let w=0; w<4; w++){
    const ws=addDays(m0,w*7), we=addDays(ws,6);
    const card=el("div",{class:"week"},
      el("div",{class:"wh"}, el("b",{text:(w===0?"This week · ":w===1?"Next week · ":"")+ws.getDate()+" "+MONTHS[ws.getMonth()].slice(0,3)+" – "+we.getDate()+" "+MONTHS[we.getMonth()].slice(0,3)}),
        el("button",{type:"button",text:"All free",onclick:()=>{ for(let i=0;i<7;i++){const k=key(addDays(ws,i)); if(k>=tk) setDay(k,"all");} renderWeeks(); }})));
    for(let i=0;i<7;i++){
      const d=addDays(ws,i), k=key(d), cur=S.myDays[k];
      card.append(el("div",{class:"drow"+(k<tk?" past":"")},
        el("span",{class:"dl"}, DOW[d.getDay()], el("small",{text:d.getDate()+" "+MONTHS[d.getMonth()].slice(0,3)})),
        el("div",{class:"seg",role:"group","aria-label":"Availability "+nice(k)},
          ["off","am","pm","all"].map(v=>el("button",{type:"button",class:"v-"+v,"aria-pressed":cur===v?"true":"false",disabled:k<tk,text:AV[v],
            onclick:()=>{ setDay(k, S.myDays[k]===v?null:v); renderWeeks(); }})))));
    }
    box.append(card);
  }
}
function setDay(k,v){ if(v) S.myDays[k]=v; else delete S.myDays[k]; pending[k]=v; queueSave(); }
function queueSave(){ dirty=true; $("#saveStatus").textContent="Saving…"; clearTimeout(saveT); saveT=setTimeout(flushSave,700); }
let noteDirty=false;
async function flushSave(){
  if(saving||!dirty) return; saving=true; dirty=false;
  const entries=Object.entries(pending); Object.keys(pending).forEach(k=>delete pending[k]);
  const ups=entries.filter(([,v])=>v).map(([day,status])=>({user_id:S.uid,day,status,updated_at:new Date().toISOString()}));
  const dels=entries.filter(([,v])=>!v).map(([day])=>day);
  let err=null;
  if(ups.length){ const r=await sb.from("availability").upsert(ups,{onConflict:"user_id,day"}); err=err||r.error; }
  if(dels.length){ const r=await sb.from("availability").delete().eq("user_id",S.uid).in("day",dels); err=err||r.error; }
  if(noteDirty){ noteDirty=false; const r=await sb.from("profiles").update({availability_note:S.myNote}).eq("id",S.uid); err=err||r.error; }
  $("#saveStatus").textContent = err ? "Couldn't save. Check your connection and try again." : "Saved";
  if(err) entries.forEach(([k,v])=>pending[k]=v);
  saving=false; if(dirty) flushSave();
}
$("#availNote").addEventListener("input",e=>{ S.myNote=e.target.value; noteDirty=true; queueSave(); });

/* ---------------- team grid ---------------- */
function renderTeam(){
  const s=S.teamStart, e=addDays(s,13);
  $("#teamLbl").textContent=s.getDate()+" "+MONTHS[s.getMonth()].slice(0,3)+" – "+e.getDate()+" "+MONTHS[e.getMonth()].slice(0,3);
  const ids=activeIds().sort((a,b)=>pname(a).localeCompare(pname(b)));
  const box=$("#teamGrid"); box.replaceChildren();
  if(!ids.length){ box.append(el("div",{class:"empty",text:"No crew accounts yet."})); return; }
  const days=[...Array(14)].map((_,i)=>addDays(s,i));
  const wk=d=>d.getDay()===0||d.getDay()===6?"wkend":"";
  box.append(el("table",{},
    el("thead",{},el("tr",{}, el("th",{text:"Crew"}), days.map(d=>el("th",{class:wk(d)}, DOW[d.getDay()], el("small",{text:d.getDate()+"/"+(d.getMonth()+1)}))))),
    el("tbody",{},
      ids.map(id=>el("tr",{}, el("td",{},personChip(id)), days.map(d=>el("td",{class:wk(d)},tagFor(availOn(id,key(d))))))),
      el("tr",{class:"cnt"}, el("td",{text:"Available"}), days.map(d=>el("td",{class:wk(d),text:ids.filter(id=>isFree(id,key(d))).length}))),
      el("tr",{class:"cnt"}, el("td",{text:"Jobs booked"}), days.map(d=>el("td",{class:wk(d),text:jobsOn(key(d)).length||"–"}))))));
  const notes=$("#teamNotes"); notes.replaceChildren();
  ids.filter(id=>S.profiles[id].availability_note).forEach(id=>notes.append(el("div",{class:"job",style:"--c:var(--navy)"}, el("span",{class:"t",text:pname(id)}), el("span",{class:"meta",text:S.profiles[id].availability_note}))));
}

/* ---------------- upcoming jobs: cards + details ---------------- */
function openDetails(id){ S.openJob=id; show("up"); renderCards(); scrollToDetail(); }
function scrollToDetail(){ requestAnimationFrame(()=>{ const d=$("#detail"); if(d) d.scrollIntoView({behavior:"smooth",block:"nearest"}); }); }
const FILTERS=[["all","All"],["mine","My jobs"],["Rubbish","Rubbish"],["Gardens","Gardens"],["Pressure","Pressure washing"]];
function renderFilters(){
  const f=$("#filters"); f.replaceChildren();
  FILTERS.forEach(([v,t])=>f.append(el("button",{type:"button","aria-pressed":S.filter===v?"true":"false",text:t,onclick:()=>{S.filter=v; renderFilters(); renderCards();}})));
}
function upcomingJobs(){
  const t=key(today());
  return S.jobs.filter(j=>endOf(j)>=t)
    .filter(j=>S.filter==="all"||(S.filter==="mine"?j.crew.includes(S.uid):j.service===S.filter))
    .sort((a,b)=>(a.date+(a.time||"")).localeCompare(b.date+(b.time||"")));
}
const photosFor = id => S.photos[id]||[];
function renderCards(){
  const box=$("#cards"); box.replaceChildren();
  const js=upcomingJobs();
  if(!js.length){ box.append(el("div",{class:"empty",style:"grid-column:1/-1",text:S.filter==="mine"?"You're not on any upcoming jobs yet.":"No upcoming jobs. Jobs added on the calendar show up here."})); return; }
  const cols=Math.max(1,Math.floor((box.clientWidth+18)/(230+18)));
  const openIdx=js.findIndex(x=>x.id===S.openJob);
  js.forEach((j,i)=>{
    const ph=photosFor(j.id), open=S.openJob===j.id;
    box.append(el("button",{class:"card"+(open?" open":""),type:"button","aria-expanded":open?"true":"false",
      onclick:()=>{ S.openJob=open?null:j.id; renderCards(); if(!open) scrollToDetail(); }},
      el("span",{class:"thumb",style:"--c:"+SC[j.service||"Rubbish"]},
        ph.length&&ph[0].url?el("img",{src:ph[0].url,alt:"",loading:"lazy"}):null,
        el("span",{class:"svc",text:SERVICES[j.service]||"Job"}),
        ph.length?el("span",{class:"count",text:ph.length+" photo"+(ph.length===1?"":"s")}):null),
      el("span",{class:"ct",text:j.title}),
      el("span",{class:"cd",text:whenText(j)+(j.suburb?" · "+j.suburb:"")})));
    if(openIdx>=0 && (i===js.length-1 || (i+1)%cols===0) && Math.floor(openIdx/cols)===Math.floor(i/cols)) box.append(detailView(js[openIdx]));
  });
}
function detailView(j){
  const days=jobDays(j), hpd=hoursPerDay(j), crew=j.crew;
  const loc=[j.address,j.suburb].filter(Boolean).join(", ");
  const mapUrl=loc?"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(loc+" NSW"):null;
  const crewList = crew.length ? el("div",{class:"people"}, crew.map(id=>{
      const free=days.filter(k=>isFree(id,k)).length;
      return personChip(id, days.length===1?tagFor(availOn(id,days[0])):el("span",{class:"tag "+(free===days.length?"a-all":free?"a-am":"a-off"),text:free+"/"+days.length+" days free"}));
    })) : el("span",{class:"muted",text:"No crew assigned yet"});
  const expected = hpd ? fmtH(hpd*days.length)+" per person"+(days.length>1?" over "+days.length+" days":"")+(crew.length>1?" · "+fmtH(hpd*days.length*crew.length)+" total crew time":"")
                       : days.length+" day"+(days.length===1?"":"s")+" · add a finish time to see hours";
  return el("div",{class:"detail",id:"detail"},
    el("div",{class:"dh"},
      el("div",{}, el("span",{class:"tag",style:"background:"+SC[j.service]+";color:#fff",text:SERVICES[j.service]||"Job"}), el("h2",{text:j.title})),
      el("div",{style:"display:flex;gap:6px"},
        isOwner()?el("button",{class:"btn ghost",text:"Edit",onclick:()=>editJob(j)}):null,
        isOwner()&&window.BIZ?el("button",{class:"btn ghost",text:"Add to accounts",onclick:()=>BIZ.fromCalendarJob(j)}):null,
        el("button",{class:"icon","aria-label":"Close details",text:"✕",onclick:()=>{S.openJob=null; renderCards();}}))),
    el("div",{class:"dcol"},
      el("dl",{class:"facts"},
        el("dt",{text:"When"}), el("dd",{text:whenText(j)}),
        el("dt",{text:"Location"}), el("dd",{}, loc||"Not set", mapUrl?el("div",{},el("a",{href:mapUrl,target:"_blank",rel:"noopener",text:"Open in Google Maps ↗"})):null),
        el("dt",{text:"Expected"}), el("dd",{text:expected}),
        el("dt",{text:"Crew"}), el("dd",{},crewList),
        j.notes?el("dt",{text:"Notes"}):null, j.notes?el("dd",{style:"font-weight:500;white-space:pre-wrap",text:j.notes}):null),
      el("div",{}, el("h3",{text:"Days on site"}),
        el("table",{class:"sched"}, el("tbody",{}, days.map(k=>el("tr",{},
          el("td",{text:nice(k)}), el("td",{text:j.time?fmtTime(j.time)+(j.endTime?" – "+fmtTime(j.endTime):""):"Time TBC"}), el("td",{text:hpd?fmtH(hpd):"–"}))))))),
    el("div",{class:"dcol"}, el("div",{}, el("h3",{text:"Photos"}), photoGrid(j))));
}
function photoGrid(j){
  const grid=el("div",{class:"photos"}), ph=photosFor(j.id);
  ph.forEach((p,i)=>grid.append(el("button",{class:"photo",type:"button","aria-label":"Open photo "+(i+1),onclick:()=>lightbox(j,i)}, p.url?el("img",{src:p.url,alt:"",loading:"lazy"}):null)));
  const input=el("input",{type:"file",accept:"image/*",multiple:true,id:"up-"+j.id,onchange:e=>uploadPhotos(j.id,[...e.target.files])});
  const lab=el("label",{class:"upload",for:"up-"+j.id}, el("b",{text:"+"}), "Add photos", input);
  lab.addEventListener("dragover",e=>{e.preventDefault(); lab.classList.add("drag");});
  lab.addEventListener("dragleave",()=>lab.classList.remove("drag"));
  lab.addEventListener("drop",e=>{e.preventDefault(); lab.classList.remove("drag"); uploadPhotos(j.id,[...e.dataTransfer.files].filter(f=>f.type.startsWith("image/")));});
  grid.append(lab);
  return grid;
}
function loadImg(file){ return new Promise((res,rej)=>{ const u=URL.createObjectURL(file); const i=new Image(); i.onload=()=>{res(i); URL.revokeObjectURL(u);}; i.onerror=()=>{rej(new Error("unreadable")); URL.revokeObjectURL(u);}; i.src=u; }); }
async function shrink(file){
  const img=await loadImg(file), max=2000, s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
  const c=document.createElement("canvas"); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
  c.getContext("2d").drawImage(img,0,0,c.width,c.height);
  return await new Promise(r=>c.toBlob(r,"image/jpeg",0.85));
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));
async function uploadPhotos(jobId, files){
  if(!files.length) return; let ok=0;
  for(let i=0;i<files.length;i++){
    toast("Uploading photo "+(i+1)+" of "+files.length+"…");
    try{
      const blob=await shrink(files[i]); if(!blob) throw new Error("unreadable");
      const path=S.uid+"/"+jobId+"/"+uuid()+".jpg";
      const up=await sb.storage.from("job-photos").upload(path,blob,{contentType:"image/jpeg"});
      if(up.error) throw up.error;
      const ins=await sb.from("job_photos").insert({job_id:jobId,path,uploaded_by:S.uid});
      if(ins.error){ await sb.storage.from("job-photos").remove([path]); throw ins.error; }
      ok++;
    }catch(e){ toast(e.message==="unreadable"?"Couldn't read that file. Try a JPG or PNG.":"Upload failed: "+(e.message||"try again")); }
  }
  if(ok){ toast(ok+" photo"+(ok===1?"":"s")+" added"); await loadAll(); renderCards(); }
}
function lightbox(j,i){
  const ph=photosFor(j.id); if(!ph[i]) return;
  const p=ph[i];
  const close=()=>{ lb.remove(); document.removeEventListener("keydown",onKey); };
  const go=n=>{ close(); lightbox(j,(i+n+ph.length)%ph.length); };
  const onKey=e=>{ if(e.key==="Escape") close(); if(e.key==="ArrowRight") go(1); if(e.key==="ArrowLeft") go(-1); };
  const canDel = p.by===S.uid || isOwner();
  const del=el("button",{class:"btn ghost",type:"button",text:"Delete photo",onclick:e=>confirmTwice(e.target,async()=>{
    const r=await sb.from("job_photos").delete().eq("id",p.id);
    if(r.error){ toast("Couldn't delete that photo."); return; }
    await sb.storage.from("job-photos").remove([p.path]);
    close(); toast("Photo deleted"); await loadAll(); renderCards();
  })});
  const lb=el("div",{class:"lightbox",role:"dialog","aria-label":"Photo viewer",onclick:e=>{ if(e.target===lb) close(); }},
    el("img",{src:p.url,alt:"Job photo"}),
    el("div",{class:"lb-bar"},
      ph.length>1?el("button",{class:"btn ghost",type:"button",text:"‹ Prev",onclick:()=>go(-1)}):null,
      el("span",{text:(i+1)+" / "+ph.length+" · added by "+pname(p.by)+" · "+new Date(p.at).toLocaleDateString("en-AU",{day:"numeric",month:"short"})}),
      ph.length>1?el("button",{class:"btn ghost",type:"button",text:"Next ›",onclick:()=>go(1)}):null,
      el("a",{class:"btn ghost",href:p.url,target:"_blank",rel:"noopener",text:"Full size",style:"text-decoration:none"}),
      canDel?del:null,
      el("button",{class:"btn",type:"button",text:"Close",onclick:close})));
  document.addEventListener("keydown",onKey);
  document.body.append(lb);
}
let rsT; window.addEventListener("resize",()=>{ clearTimeout(rsT); rsT=setTimeout(()=>{ if(S.openJob) renderCards(); },200); });

/* ---------------- team accounts (owners) ---------------- */
$("#addCrewBtn").addEventListener("click",()=>{
  const h=$("#addCrewHelp"); h.hidden=!h.hidden; if(h.hidden) return;
  h.replaceChildren(el("b",{text:"Add a crew member (takes 1 minute):"}), el("ol",{},
    el("li",{text:"Open Supabase → Authentication → Users."}),
    el("li",{text:"Click “Add user” → “Create new user”."}),
    el("li",{text:"Enter their email and a temporary password, tick “Auto Confirm User”, then Create."}),
    el("li",{text:"Text them the link to this site, their email and the temporary password."}),
    el("li",{text:"The first time they sign in, the site asks for their name and a new password. They'll then appear in this list."})));
});
async function adminUpdate(id,patch,okMsg){
  const {error}=await sb.from("profiles").update(patch).eq("id",id);
  if(error) toast("Couldn't save: "+error.message); else { if(okMsg) toast(okMsg); await loadAll(); renderAll(); }
}
function renderAdmin(){
  const box=$("#adminTable"); box.replaceChildren();
  if(!isOwner()) return;
  const ps=Object.values(S.profiles).sort((a,b)=>(b.active-a.active)||(a.role===b.role?pname(a.id).localeCompare(pname(b.id)):a.role==="owner"?-1:1));
  const last=t=>{ if(!t) return "Never"; const d=new Date(t); return d.toLocaleDateString("en-AU",{day:"numeric",month:"short"})+", "+d.toLocaleTimeString("en-AU",{hour:"numeric",minute:"2-digit"}); };
  box.append(el("table",{class:"admin"},
    el("thead",{},el("tr",{}, ["Name","Email","Role","Last signed in","Status","Actions"].map(t=>el("th",{text:t})))),
    el("tbody",{}, ps.map(p=>{
      const self=p.id===S.uid;
      const nameIn=el("input",{value:p.name,"aria-label":"Name for "+p.email,id:"nm-"+p.id,onchange:e=>adminUpdate(p.id,{name:e.target.value.trim()},"Name saved")});
      const roleSel=el("select",{"aria-label":"Role for "+p.email,id:"rl-"+p.id,disabled:self,onchange:e=>adminUpdate(p.id,{role:e.target.value},"Role updated")},
        el("option",{value:"crew",selected:p.role==="crew"},"Crew"), el("option",{value:"owner",selected:p.role==="owner"},"Owner"));
      return el("tr",{},
        el("td",{},nameIn), el("td",{text:p.email}), el("td",{},roleSel), el("td",{class:"muted",text:last(p.last_seen)}),
        el("td",{}, el("span",{class:"st "+(p.active?"on":"offd"),text:p.active?(p.must_change_password?"Not signed in yet":"Active"):"Removed"})),
        el("td",{}, self?el("span",{class:"muted",text:"You"}):el("div",{class:"acts"},
          el("button",{class:"btn ghost",type:"button",text:"Send reset link",onclick:async e=>{
            const {error}=await sb.auth.resetPasswordForEmail(p.email,{redirectTo:location.origin+location.pathname});
            toast(error?(/not authorized|rate/i.test(error.message)?"Reset emails aren't set up yet. See step 7 in the guide, or set a temporary password in Supabase.":error.message):"Reset link sent to "+p.email);
          }}),
          p.active ? el("button",{class:"btn danger",type:"button",text:"Remove access",onclick:e=>confirmTwice(e.target,()=>adminUpdate(p.id,{active:false},"Access removed"))})
                   : el("button",{class:"btn ghost",type:"button",text:"Restore access",onclick:()=>adminUpdate(p.id,{active:true},"Access restored")}))));
    }))));
}

/* ---------------- render all + buttons ---------------- */
function renderAll(){ renderCal(); if(S.editing===null) renderPanel(); renderUpcoming(); renderWeeks(); renderTeam(); renderFilters(); renderCards(); renderAdmin(); if(isOwner() && window.BIZ) BIZ.render(); }
$("#prevM").onclick=()=>{S.month=new Date(S.month.getFullYear(),S.month.getMonth()-1,1); renderCal();};
$("#nextM").onclick=()=>{S.month=new Date(S.month.getFullYear(),S.month.getMonth()+1,1); renderCal();};
$("#todayBtn").onclick=()=>{const t=today(); S.month=new Date(t.getFullYear(),t.getMonth(),1); S.sel=key(t); S.editing=null; renderCal(); renderPanel();};
$("#prevT").onclick=()=>{S.teamStart=addDays(S.teamStart,-14); renderTeam();};
$("#nextT").onclick=()=>{S.teamStart=addDays(S.teamStart,14); renderTeam();};
