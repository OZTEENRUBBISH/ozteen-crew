/* OzTeen Crew board — owners-only business tools: clients & leads, accounts, quotes.
   Uses helpers from app.js (sb, S, $, $$, el, toast, key, parse, addDays, today, show, confirmTwice …). */
"use strict";

(function(){
const B = {
  clients:[], accounts:[], quotes:[],
  clientKind:"client", clientEdit:null, clientPrefill:null,
  entryEdit:null, entryPrefill:null,
  q:null, qDirty:false,
};

/* ---------------- shared helpers ---------------- */
const num = v => { const n=parseFloat(String(v??"").replace(/[^0-9.\-]/g,"")); return isFinite(n)?n:0; };
const round2 = n => Math.round(n*100)/100;
const money = (n,dp=2) => (Number(n)||0).toLocaleString("en-AU",{style:"currency",currency:"AUD",minimumFractionDigits:dp,maximumFractionDigits:dp});
const longDate = k => k ? parse(k).toLocaleDateString("en-AU",{day:"numeric",month:"long",year:"numeric"}) : "";
const shortDate = k => k ? parse(k).toLocaleDateString("en-AU",{day:"numeric",month:"short",year:"numeric"}) : "";
const lc = s => String(s||"").toLowerCase();
const field = (labelText, input, extra) => el("label",{for:input.id, class:extra||""}, labelText, input);
const SERVICE_OPTS = [["","—"],["Rubbish","Rubbish removal"],["Gardens","Gardens & landscaping"],["Pressure","Pressure washing"],["Multiple","More than one"]];
const SOURCES = ["","Google","Website form","Airtasker","Facebook","Instagram","Referral","Repeat customer","Flyer / letterbox","Other"];
const STAGES = {new:"New",contacted:"Contacted",quoted:"Quoted",won:"Won",lost:"Lost"};
const sel = (id, opts, value, attrs={}) => el("select",{id,...attrs}, opts.map(o=>{ const [v,t]=Array.isArray(o)?o:[o,o||"—"]; return el("option",{value:v,selected:String(value??"")===String(v)},t); }));
const inp = (id, value, attrs={}) => el("input",{id, value:value??"", ...attrs});
const moneyIn = (id, value) => inp(id, value===0||value?String(value):"", {type:"number",step:"0.01",min:"0",inputmode:"decimal",placeholder:"0.00"});
function download(filename, text, type){
  const blob=new Blob([text],{type}); const a=el("a",{href:URL.createObjectURL(blob),download:filename});
  document.body.append(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}

/* ---------------- data ---------------- */
async function loadBiz(){
  const [c,a,q]=await Promise.all([
    sb.from("clients").select("*").order("name"),
    sb.from("accounts").select("*").order("job_date",{ascending:false}).order("job_no",{ascending:false}),
    sb.from("quotes").select("*").order("quote_no",{ascending:false}),
  ]);
  const bad=[c,a,q].find(r=>r.error);
  if(bad){
    console.error(bad.error);
    toast(/does not exist|schema cache/i.test(bad.error.message) ? "Business tables are missing. Run setup-business.sql in Supabase." : "Couldn't load business data: "+bad.error.message);
  }
  B.clients=c.data||[]; B.accounts=a.data||[]; B.quotes=q.data||[];
}
let bizT=null;
function bizReload(){ clearTimeout(bizT); bizT=setTimeout(async()=>{ await loadBiz(); renderClients(); renderAccounts(); renderQuoteBar(); refreshOpenQuote(); },400); }

/* =====================================================================
   CLIENTS & LEADS
   ===================================================================== */
function clientStats(c){
  const rows=B.accounts.filter(a=>a.client_id===c.id || (!a.client_id && a.client_name && lc(a.client_name)===lc(c.name)));
  const total=rows.reduce((s,a)=>s+num(a.quote),0);
  const last=rows.map(a=>a.job_date).sort().pop();
  return {count:rows.length,total,last};
}
function renderClients(){
  const kinds=[["client","Clients"],["lead","Leads"]];
  $("#clientKind").replaceChildren(...kinds.map(([v,t])=>el("button",{type:"button","aria-pressed":B.clientKind===v?"true":"false",
    text:t+" ("+B.clients.filter(c=>c.kind===v && (v!=="lead"||!["won","lost"].includes(c.stage))).length+")",
    onclick:()=>{ B.clientKind=v; renderClients(); }})));
  const st=$("#leadStage"); st.hidden=B.clientKind!=="lead";
  if(!st.options.length){ [["open","Open leads"],["new","New"],["contacted","Contacted"],["quoted","Quoted"],["lost","Lost"],["all","All leads"]].forEach(([v,t])=>st.append(el("option",{value:v},t))); }
  const q=lc($("#clientSearch").value), stage=st.value||"open", tk=key(today());
  let list=B.clients.filter(c=>c.kind===B.clientKind);
  if(B.clientKind==="lead") list=list.filter(c=> stage==="all"?true: stage==="open"? ["new","contacted","quoted"].includes(c.stage) : c.stage===stage);
  if(q) list=list.filter(c=>[c.name,c.phone,c.email,c.suburb,c.address,c.notes,c.source].some(v=>lc(v).includes(q)));
  if(B.clientKind==="lead") list.sort((a,b)=>(a.follow_up||"9999").localeCompare(b.follow_up||"9999")||b.created_at.localeCompare(a.created_at));

  renderClientForm();
  const box=$("#clientList"); box.replaceChildren();
  if(!list.length){
    box.append(el("div",{class:"empty",text: q?"No matches.": B.clientKind==="client"?"No clients yet. Tap “+ Add client” to add your first one.":"No open leads. Tap “+ Add lead” when someone enquires."}));
    return;
  }
  list.forEach(c=>{
    const s=B.clientKind==="client"?clientStats(c):null;
    const overdue=c.kind==="lead" && c.follow_up && c.follow_up<=tk && ["new","contacted","quoted"].includes(c.stage);
    box.append(el("div",{class:"crow"},
      el("div",{class:"cmain"},
        el("div",{class:"cname"}, el("b",{text:c.name}),
          c.kind==="lead"?el("span",{class:"pill st-"+c.stage,text:STAGES[c.stage]}):null,
          c.service?el("span",{class:"tag svc-"+c.service,text:(SERVICE_OPTS.find(o=>o[0]===c.service)||["",c.service])[1]}):null),
        el("div",{class:"cmeta"},
          c.phone?el("a",{href:"tel:"+c.phone.replace(/\s/g,""),text:c.phone}):null,
          c.email?el("a",{href:"mailto:"+c.email,text:c.email}):null,
          [c.address,c.suburb].filter(Boolean).length?el("span",{text:[c.address,c.suburb].filter(Boolean).join(", ")}):null,
          c.source?el("span",{text:"via "+c.source}):null),
        s&&s.count?el("div",{class:"cstat",text:s.count+" job"+(s.count===1?"":"s")+" · "+money(s.total,0)+" total · last "+shortDate(s.last)}):null,
        c.kind==="lead"&&c.follow_up?el("div",{class:"cstat"+(overdue?" due":""),text:(overdue?"Follow up due: ":"Follow up: ")+shortDate(c.follow_up)}):null,
        c.notes?el("div",{class:"cnotes",text:c.notes}):null),
      el("div",{class:"cacts"},
        el("button",{class:"btn ghost small",type:"button",text:"Edit",onclick:()=>{ B.clientEdit=c.id; renderClientForm(); scrollTo0("#clientForm"); }}),
        el("button",{class:"btn ghost small",type:"button",text:"Quote",onclick:()=>newQuoteFor(c)}),
        c.kind==="lead"?el("button",{class:"btn small",type:"button",text:"Won → client",onclick:()=>saveClient(c.id,{kind:"client",stage:"won"},"Moved to clients")}):null)));
  });
}
function scrollTo0(sel){ requestAnimationFrame(()=>{ const n=$(sel); if(n) n.scrollIntoView({behavior:"smooth",block:"start"}); }); }
function renderClientForm(){
  const box=$("#clientForm"); box.replaceChildren();
  if(B.clientEdit===null) return;
  const isNew=String(B.clientEdit).startsWith("new");
  const c = isNew ? {kind:B.clientEdit==="new-lead"?"lead":"client",stage:"new",name:"",phone:"",email:"",address:"",suburb:"",service:"",source:"",notes:"",follow_up:null,...(B.clientPrefill||{})}
                  : B.clients.find(x=>x.id===B.clientEdit);
  if(!c){ B.clientEdit=null; return; }
  const kindSel=sel("c-kind",[["client","Client"],["lead","Lead"]],c.kind,{onchange:e=>{ leadBits.hidden=e.target.value!=="lead"; }});
  const leadBits=el("div",{class:"row2"},
    field("Stage", sel("c-stage",Object.entries(STAGES),c.stage)),
    field("Follow up on", inp("c-follow",c.follow_up||"",{type:"date"})));
  leadBits.hidden=c.kind!=="lead";
  const f=el("form",{class:"card form"},
    el("div",{class:"formhead"}, el("h3",{text:isNew?(c.kind==="lead"?"New lead":"New client"):"Edit "+c.name})),
    el("div",{class:"grid3"},
      field("Name *", inp("c-name",c.name,{required:true,autocomplete:"off"})),
      field("Phone", inp("c-phone",c.phone,{type:"tel",autocomplete:"off"})),
      field("Email", inp("c-email",c.email,{type:"email",autocomplete:"off"})),
      field("Address", inp("c-address",c.address,{autocomplete:"off"})),
      field("Suburb", inp("c-suburb",c.suburb,{autocomplete:"off"})),
      field("Service", sel("c-service",SERVICE_OPTS,c.service)),
      field("Found us via", sel("c-source",SOURCES,c.source)),
      field("Type", kindSel)),
    leadBits,
    field("Notes", el("textarea",{id:"c-notes",rows:"2",placeholder:"What they need, access, best time to call…"},c.notes||"")),
    el("div",{class:"formacts"},
      el("button",{class:"btn",type:"submit",id:"c-save",text:"Save"}),
      el("button",{class:"btn ghost",type:"button",text:"Cancel",onclick:()=>{ B.clientEdit=null; B.clientPrefill=null; renderClientForm(); }}),
      !isNew?el("button",{class:"btn danger push",type:"button",text:"Delete",onclick:e=>confirmTwice(e.target,()=>deleteClient(c.id))}):null));
  f.addEventListener("submit",async e=>{
    e.preventDefault();
    const row={kind:$("#c-kind").value, stage:$("#c-stage").value, name:$("#c-name").value.trim(), phone:$("#c-phone").value.trim(),
      email:$("#c-email").value.trim(), address:$("#c-address").value.trim(), suburb:$("#c-suburb").value.trim(),
      service:$("#c-service").value, source:$("#c-source").value, notes:$("#c-notes").value.trim(),
      follow_up:$("#c-follow").value||null, updated_at:new Date().toISOString()};
    if(!row.name) return toast("Add a name first.");
    if(row.kind==="client" && ["new","contacted","quoted"].includes(row.stage)) row.stage="won";
    await saveClient(isNew?null:c.id,row, isNew?(row.kind==="lead"?"Lead added":"Client added"):"Saved");
  });
  box.append(f);
}
async function saveClient(id,row,msg){
  const btn=$("#c-save"); if(btn) busy(btn,true,"Saving…");
  const res = id ? await sb.from("clients").update(row).eq("id",id) : await sb.from("clients").insert({...row,created_by:S.uid});
  if(btn) busy(btn,false,"Save");
  if(res.error) return toast("Couldn't save: "+res.error.message);
  toast(msg); B.clientEdit=null; B.clientPrefill=null;
  if(row.kind) B.clientKind=row.kind;
  await loadBiz(); renderClients(); renderAccounts();
}
async function deleteClient(id){
  const {error}=await sb.from("clients").delete().eq("id",id);
  if(error) return toast("Couldn't delete: "+error.message);
  toast("Deleted"); B.clientEdit=null; await loadBiz(); renderClients();
}
$("#addClientBtn").addEventListener("click",()=>{ B.clientEdit="new-client"; B.clientPrefill=null; renderClientForm(); scrollTo0("#clientForm"); setTimeout(()=>$("#c-name")&&$("#c-name").focus(),50); });
$("#addLeadBtn").addEventListener("click",()=>{ B.clientEdit="new-lead"; B.clientPrefill=null; renderClientForm(); scrollTo0("#clientForm"); setTimeout(()=>$("#c-name")&&$("#c-name").focus(),50); });
$("#clientSearch").addEventListener("input",()=>renderClients());
$("#leadStage").addEventListener("change",()=>renderClients());

/* =====================================================================
   ACCOUNTS
   ===================================================================== */
function addMonths(d,n){ const x=new Date(d); x.setMonth(x.getMonth()+n); return x; }
function fyStart(d){ return new Date(d.getMonth()>=6?d.getFullYear():d.getFullYear()-1, 6, 1); }
function periodRange(p){
  const t=today(), tk=key(t);
  switch(p){
    case "week":  return [key(addDays(t,-6)),tk];
    case "month": return [key(addDays(addMonths(t,-1),1)),tk];
    case "3m":    return [key(addDays(addMonths(t,-3),1)),tk];
    case "year":  return [key(addDays(addMonths(t,-12),1)),tk];
    case "fy":    { const s=fyStart(t); return [key(s),key(addDays(addMonths(s,12),-1))]; }
    case "lfy":   { const s=addMonths(fyStart(t),-12); return [key(s),key(addDays(addMonths(s,12),-1))]; }
    case "tm":    return [key(new Date(t.getFullYear(),t.getMonth(),1)),key(new Date(t.getFullYear(),t.getMonth()+1,0))];
    case "lm":    return [key(new Date(t.getFullYear(),t.getMonth()-1,1)),key(new Date(t.getFullYear(),t.getMonth(),0))];
    default:      return ["0000-01-01","9999-12-31"];
  }
}
const fyLabel = off => { const s=addMonths(fyStart(today()),off*12); return "FY "+s.getFullYear()+"–"+String(s.getFullYear()+1).slice(2); };
function sumRows(rows){
  return rows.reduce((t,r)=>{ t.rev+=num(r.quote); t.tip+=num(r.tip_fees); t.oth+=num(r.other_costs); t.profit+=num(r.quote)-num(r.tip_fees)-num(r.other_costs); if(r.cash) t.cash+=num(r.quote); t.n++; return t; },{rev:0,tip:0,oth:0,profit:0,cash:0,n:0});
}
function renderTiles(){
  const tiles=[["week","Past week"],["month","Past month"],["3m","Past 3 months"],["year","Past year"],["all","All time"]];
  $("#profitTiles").replaceChildren(...tiles.map(([p,label])=>{
    const [a,b]=periodRange(p), t=sumRows(B.accounts.filter(r=>r.job_date>=a&&r.job_date<=b));
    return el("div",{class:"tile"+(p==="all"?" total":"")},
      el("span",{class:"tl",text:label}),
      el("b",{class:"tv"+(t.profit<0?" neg":""),text:money(t.profit,0)}),
      el("span",{class:"ts",text:"profit · "+t.n+" job"+(t.n===1?"":"s")}),
      el("span",{class:"ts",text:"Revenue "+money(t.rev,0)}),
      el("span",{class:"ts",text:"Cash "+money(t.cash,0)+" · Other "+money(t.rev-t.cash,0)}),
      p!=="all"?el("span",{class:"td",text:shortDate(a)+" – "+shortDate(b)}):el("span",{class:"td",text:B.accounts.length?"Since "+shortDate(B.accounts.map(r=>r.job_date).sort()[0]):"No jobs yet"}));
  }));
}
function nextJobNo(){ return B.accounts.reduce((m,r)=>Math.max(m,r.job_no||0),0)+1; }
function renderEntryForm(){
  const box=$("#entryForm"); box.replaceChildren();
  if(B.entryEdit===null) return;
  const isNew=B.entryEdit==="new";
  const r = isNew ? {job_no:"",job_date:key(today()),client_name:"",description:"",service:"Rubbish",quote:"",tip_fees:"",other_costs:"",cash:false,notes:"",...(B.entryPrefill||{})}
                  : B.accounts.find(x=>x.id===B.entryEdit);
  if(!r){ B.entryEdit=null; return; }
  const profitOut=el("output",{id:"e-profit",class:"profit"});
  const calc=()=>{ const p=num($("#e-quote").value)-num($("#e-tip").value)-num($("#e-other").value); profitOut.textContent=money(p); profitOut.classList.toggle("neg",p<0); };
  const dl=el("datalist",{id:"clientNames"}, B.clients.map(c=>el("option",{value:c.name})));
  const cashBox=el("input",{type:"checkbox",id:"e-cash",checked:!!r.cash});
  const f=el("form",{class:"card form"},
    el("div",{class:"formhead"}, el("h3",{text:isNew?"New job":"Edit job #"+r.job_no})),
    el("div",{class:"grid4"},
      field("Job number", inp("e-no",r.job_no,{type:"number",min:"1",step:"1",placeholder:String(nextJobNo())})),
      field("Date", inp("e-date",r.job_date,{type:"date",required:true})),
      field("Client", inp("e-client",r.client_name,{list:"clientNames",autocomplete:"off",placeholder:"Name"})),
      field("Service", sel("e-service",[["Rubbish","Rubbish removal"],["Gardens","Gardens & landscaping"],["Pressure","Pressure washing"],["Other","Other"]],r.service))),
    field("Job", inp("e-desc",r.description,{placeholder:"e.g. Garage clear-out, Dee Why (All in One Trip)",autocomplete:"off"})),
    el("div",{class:"grid4 money"},
      field("Quote ($)", moneyIn("e-quote",r.quote)),
      field("Tip fees ($)", moneyIn("e-tip",r.tip_fees)),
      field("Other costs ($)", moneyIn("e-other",r.other_costs)),
      el("div",{class:"profitbox"}, el("span",{text:"Profit"}), profitOut)),
    el("label",{for:"e-cash",class:"cashtoggle"}, cashBox, el("span",{text:"Paid in cash"})),
    field("Notes", el("textarea",{id:"e-notes",rows:"2",placeholder:"Fuel, dump receipt number, who did the job…"},r.notes||"")), dl,
    el("div",{class:"formacts"},
      el("button",{class:"btn",type:"submit",id:"e-save",text:isNew?"Add job":"Save changes"}),
      el("button",{class:"btn ghost",type:"button",text:"Cancel",onclick:()=>{ B.entryEdit=null; B.entryPrefill=null; renderEntryForm(); }}),
      !isNew?el("button",{class:"btn danger push",type:"button",text:"Delete",onclick:e=>confirmTwice(e.target,()=>deleteEntry(r.id))}):null));
  f.addEventListener("input",calc);
  f.addEventListener("submit",async e=>{
    e.preventDefault();
    const name=$("#e-client").value.trim();
    const match=B.clients.find(c=>lc(c.name)===lc(name));
    const row={ job_no: $("#e-no").value?parseInt($("#e-no").value,10):null, job_date:$("#e-date").value,
      client_name:name, client_id: match?match.id:null, description:$("#e-desc").value.trim(), service:$("#e-service").value,
      quote:round2(num($("#e-quote").value)), tip_fees:round2(num($("#e-tip").value)), other_costs:round2(num($("#e-other").value)),
      cash:$("#e-cash").checked, notes:$("#e-notes").value.trim(), updated_at:new Date().toISOString() };
    if(!isNew && row.job_no===null) row.job_no=r.job_no;
    busy($("#e-save"),true,"Saving…");
    const res = isNew ? await sb.from("accounts").insert({...row,created_by:S.uid}).select().single() : await sb.from("accounts").update(row).eq("id",r.id);
    busy($("#e-save"),false,isNew?"Add job":"Save changes");
    if(res.error) return toast(/duplicate|unique/i.test(res.error.message)?"Job number "+row.job_no+" is already used. Pick another or leave it blank.":"Couldn't save: "+res.error.message);
    toast(isNew?"Job #"+(res.data?res.data.job_no:row.job_no)+" added":"Saved");
    B.entryEdit=null; B.entryPrefill=null; await loadBiz(); renderAccounts(); renderClients();
  });
  box.append(f); calc();
}
async function deleteEntry(id){
  const {error}=await sb.from("accounts").delete().eq("id",id);
  if(error) return toast("Couldn't delete: "+error.message);
  toast("Job deleted"); B.entryEdit=null; await loadBiz(); renderAccounts();
}
async function toggleCash(r,box){
  box.disabled=true;
  const {error}=await sb.from("accounts").update({cash:box.checked,updated_at:new Date().toISOString()}).eq("id",r.id);
  box.disabled=false;
  if(error){ box.checked=!box.checked; return toast("Couldn't update: "+error.message); }
  r.cash=box.checked; renderTiles(); renderLedger();
}
function filteredLedger(){
  const q=lc($("#acctSearch").value), [a,b]=periodRange($("#acctPeriod").value||"all"), cash=$("#acctCash").value;
  return B.accounts.filter(r=>r.job_date>=a&&r.job_date<=b)
    .filter(r=>cash==="all"||(cash==="cash"?r.cash:!r.cash))
    .filter(r=>!q||[r.job_no,r.client_name,r.description,r.notes].some(v=>lc(v).includes(q)))
    .sort((x,y)=>y.job_date.localeCompare(x.job_date)||(y.job_no-x.job_no));
}
function renderLedger(){
  const rows=filteredLedger(), t=sumRows(rows), tbl=$("#ledger");
  const head=["Job #","Date","Client","Job","Quote","Tip fees","Other costs","Profit","Cash",""];
  tbl.replaceChildren(
    el("thead",{},el("tr",{},head.map((h,i)=>el("th",{class:i>=4&&i<=7?"r":(i===8?"c":""),text:h})))),
    el("tbody",{}, rows.length? rows.map(r=>{
      const p=num(r.quote)-num(r.tip_fees)-num(r.other_costs);
      const box=el("input",{type:"checkbox",checked:!!r.cash,"aria-label":"Paid in cash, job "+r.job_no,onchange:e=>toggleCash(r,e.target)});
      return el("tr",{},
        el("td",{class:"mono",text:"#"+r.job_no}), el("td",{class:"nowrap",text:shortDate(r.job_date)}),
        el("td",{text:r.client_name||"—"}), el("td",{class:"desc",title:r.notes||"",text:r.description||"—"}),
        el("td",{class:"r",text:money(r.quote)}), el("td",{class:"r",text:money(r.tip_fees)}), el("td",{class:"r",text:money(r.other_costs)}),
        el("td",{class:"r b"+(p<0?" neg":""),text:money(p)}),
        el("td",{class:"c"},box),
        el("td",{}, el("button",{class:"btn ghost small",type:"button",text:"Edit",onclick:()=>{ B.entryEdit=r.id; renderEntryForm(); scrollTo0("#entryForm"); }})));
    }) : el("tr",{},el("td",{colspan:"10",class:"empty",text:B.accounts.length?"No jobs match these filters.":"No jobs yet. Tap “+ New job” to add your first."}))),
    el("tfoot",{},el("tr",{},
      el("td",{colspan:"4",text:t.n+" job"+(t.n===1?"":"s")+" shown"}),
      el("td",{class:"r",text:money(t.rev)}), el("td",{class:"r",text:money(t.tip)}), el("td",{class:"r",text:money(t.oth)}),
      el("td",{class:"r b"+(t.profit<0?" neg":""),text:money(t.profit)}),
      el("td",{class:"c",text:money(t.cash,0)}), el("td",{}))));
}
function renderAccounts(){
  const ps=$("#acctPeriod");
  if(!ps.options.length){
    [["all","All time"],["fy","This financial year ("+fyLabel(0)+")"],["lfy","Last financial year ("+fyLabel(-1)+")"],["tm","This month"],["lm","Last month"],["3m","Past 3 months"],["year","Past 12 months"]]
      .forEach(([v,t])=>ps.append(el("option",{value:v},t)));
  }
  renderTiles(); renderEntryForm(); renderLedger();
}
$("#newEntryBtn").addEventListener("click",()=>{ B.entryEdit="new"; B.entryPrefill=null; renderEntryForm(); scrollTo0("#entryForm"); });
["#acctSearch","#acctPeriod","#acctCash"].forEach(s=>$(s).addEventListener(s==="#acctSearch"?"input":"change",renderLedger));
$("#exportCsv").addEventListener("click",()=>{
  const rows=filteredLedger();
  const esc=v=>{ const s=String(v??""); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const lines=[["Job number","Date","Client","Job","Service","Quote","Tip fees","Other costs","Profit","Paid in cash","Notes"].join(",")]
    .concat(rows.map(r=>[r.job_no,r.job_date,r.client_name,r.description,r.service,num(r.quote).toFixed(2),num(r.tip_fees).toFixed(2),num(r.other_costs).toFixed(2),
      (num(r.quote)-num(r.tip_fees)-num(r.other_costs)).toFixed(2),r.cash?"Yes":"No",r.notes].map(esc).join(",")));
  download("ozteen-accounts-"+key(today())+".csv","﻿"+lines.join("\r\n"),"text/csv;charset=utf-8");
});

/* =====================================================================
   QUOTES
   ===================================================================== */
// Quotes are only for OzTeen Gardens and Landscaping.
const BRAND = {titleLines:["Gardens and","Landscaping Quote"], line:"Gardens and Landscaping", site:"www.ozteengardens.com"};
const DEFAULT_FROM = {address:"Sydney & Northern Beaches, NSW", phone:"0438 619 660", email:"ozteengardens@gmail.com", abn:"91 841 260 305"};
// Swap out details from older versions (old ABN, blank or placeholder email).
function fixFrom(fd){
  const f={...DEFAULT_FROM,...(fd||{})};
  if(!f.abn || f.abn.replace(/\s/g,"")==="86866322827") f.abn=DEFAULT_FROM.abn;
  if(!f.email || f.email==="hello@ozteen.com") f.email=DEFAULT_FROM.email;
  return f;
}
const DEFAULT_NOTES = "Final price confirmed on-site before work starts.\nNo booking fee.\nPayment due on completion by cash or bank transfer.";
const qNo = n => n ? "Q-"+n : "Q-"+(B.quotes.reduce((m,q)=>Math.max(m,q.quote_no||1000),1000)+1);
const STATUS = {draft:"Draft",sent:"Sent",accepted:"Accepted",declined:"Declined"};

function blankQuote(prefill={}){
  const last=B.quotes[0];
  const d=key(today());
  return {
    id:null, quote_no:null, status:"draft", business:"Gardens", quote_date:d, valid_until:null,
    client_id:null, client_name:"", client_phone:"", client_email:"", client_address:"", job_address:"",
    items:[{desc:"",qty:1,unit:"",price:""}], gst_mode:"none",
    scope:"", comments:"", notes:last?last.notes:DEFAULT_NOTES,
    from_details:fixFrom(last?last.from_details:{}), ...prefill,
  };
}
function qTotals(q){
  const sub=round2(q.items.reduce((s,i)=>s+num(i.qty)*num(i.price),0));
  return {sub,gst:0,total:sub};   // no tax on OzTeen Gardens quotes
}
function openQuote(q){ B.q=JSON.parse(JSON.stringify(q)); B.q.business="Gardens"; if(!Array.isArray(B.q.items)||!B.q.items.length) B.q.items=[{desc:"",qty:1,unit:"",price:""}]; B.q.from_details=fixFrom(B.q.from_details); B.qDirty=false; renderQuoteForm(); renderPaper(); renderQuoteBar(); setQStatus(); }
function setQStatus(){ $("#qStatus").textContent = B.qDirty ? "Unsaved changes" : (B.q&&B.q.id ? "Saved · "+STATUS[B.q.status] : "New quote, not saved yet"); }
function guardDirty(){ return !B.qDirty || confirm("You have unsaved changes to this quote. Discard them?"); }
function newQuoteFor(c){
  if(!guardDirty()) return;
  openQuote(blankQuote({client_id:c.id, client_name:c.name, client_phone:c.phone||"", client_email:c.email||"",
    client_address:[c.address,c.suburb].filter(Boolean).join(", ")}));
  show("quotes"); window.scrollTo({top:0});
}
function refreshOpenQuote(){
  if(!B.q||!B.q.id||B.qDirty) return;
  const fresh=B.quotes.find(x=>x.id===B.q.id);
  if(fresh) openQuote(fresh); else openQuote(blankQuote());
}
function renderQuoteBar(){
  const p=$("#quotePick"); const cur=B.q&&B.q.id;
  p.replaceChildren(el("option",{value:""},B.quotes.length?"Saved quotes ("+B.quotes.length+")…":"No saved quotes yet"),
    ...B.quotes.map(q=>el("option",{value:q.id,selected:q.id===cur},qNo(q.quote_no)+" · "+(q.client_name||"No name")+" · "+money(q.total,0)+" · "+STATUS[q.status])));
}
$("#quotePick").addEventListener("change",e=>{
  const id=e.target.value; if(!id) return;
  if(!guardDirty()){ renderQuoteBar(); return; }
  const q=B.quotes.find(x=>x.id===id); if(q) openQuote(q);
});
$("#newQuoteBtn").addEventListener("click",()=>{ if(guardDirty()) openQuote(blankQuote()); });

function readQuoteForm(){
  const q=B.q, v=id=>{ const n=$("#"+id); return n?n.value:""; };
  q.business="Gardens"; q.status=v("q-status"); q.quote_date=v("q-date"); q.valid_until=null;
  q.client_name=v("q-cname"); q.client_phone=v("q-cphone"); q.client_email=v("q-cemail"); q.client_address=v("q-caddr"); q.job_address=v("q-jaddr");
  q.scope=v("q-scope"); q.comments=v("q-comments"); q.notes=v("q-notes"); q.gst_mode="none";
  q.from_details={address:v("q-faddr"),phone:v("q-fphone"),email:v("q-femail"),abn:v("q-fabn")};
  q.items=$$("#qitems .qitem").map(r=>({desc:r.querySelector(".i-desc").value, qty:r.querySelector(".i-qty").value, unit:r.querySelector(".i-unit").value, price:r.querySelector(".i-price").value}));
}
let paperT=null;
function onQuoteInput(){
  readQuoteForm(); B.qDirty=true; setQStatus();
  $$("#qitems .qitem").forEach((r,i)=>{ const it=B.q.items[i]; r.querySelector(".i-amt").textContent=money(num(it.qty)*num(it.price)); });
  const t=qTotals(B.q); $("#qTotalLine").textContent="Total "+money(t.total);
  clearTimeout(paperT); paperT=setTimeout(renderPaper,80);
}
function itemRow(it){
  const row=el("div",{class:"qitem"},
    el("input",{class:"i-desc",value:it.desc,placeholder:"Item or service","aria-label":"Item description"}),
    el("input",{class:"i-qty",value:it.qty,type:"number",step:"any",min:"0",inputmode:"decimal","aria-label":"Quantity"}),
    el("input",{class:"i-unit",value:it.unit||"",placeholder:"unit","aria-label":"Unit, e.g. hours or loads"}),
    el("input",{class:"i-price",value:it.price,type:"number",step:"0.01",min:"0",inputmode:"decimal",placeholder:"0.00","aria-label":"Unit cost"}),
    el("span",{class:"i-amt",text:money(num(it.qty)*num(it.price))}),
    el("button",{type:"button",class:"i-del","aria-label":"Remove line",text:"×",onclick:()=>{ row.remove(); if(!$$("#qitems .qitem").length) $("#qitems").append(itemRow({desc:"",qty:1,unit:"",price:""})); onQuoteInput(); }}));
  return row;
}
function renderQuoteForm(){
  const q=B.q, f=$("#qform"); f.replaceChildren();
  const pickClient=sel("q-pickclient",[["","Fill from a client or lead…"],...B.clients.map(c=>[c.id,c.name+(c.kind==="lead"?" (lead)":"")+(c.suburb?" · "+c.suburb:"")])],"",{"aria-label":"Fill from a client or lead"});
  pickClient.addEventListener("change",e=>{
    const c=B.clients.find(x=>x.id===e.target.value); if(!c) return;
    $("#q-cname").value=c.name; $("#q-cphone").value=c.phone||""; $("#q-cemail").value=c.email||""; $("#q-caddr").value=[c.address,c.suburb].filter(Boolean).join(", ");
    B.q.client_id=c.id; e.target.value=""; onQuoteInput();
  });
  const items=el("div",{id:"qitems"}, q.items.map(itemRow));
  f.append(
    el("div",{class:"qsec"}, el("h3",{text:"OzTeen Gardens and Landscaping quote"}),
      el("div",{class:"grid2"},
        field("Status", sel("q-status",Object.entries(STATUS),q.status)),
        el("label",{}, "Quote number", el("input",{value:qNo(q.quote_no)+(q.quote_no?"":" (on save)"),readonly:true,tabindex:"-1",class:"ro"})),
        field("Quote date", inp("q-date",q.quote_date,{type:"date"})))),
    el("div",{class:"qsec"}, el("h3",{text:"Customer"}), pickClient,
      el("div",{class:"grid2"},
        field("Customer name", inp("q-cname",q.client_name,{autocomplete:"off"})),
        field("Phone", inp("q-cphone",q.client_phone,{type:"tel",autocomplete:"off"})),
        field("Email", inp("q-cemail",q.client_email,{type:"email",autocomplete:"off"})),
        field("Address", inp("q-caddr",q.client_address,{autocomplete:"off"})))),
    el("div",{class:"qsec"}, el("h3",{text:"Job description"}),
      el("textarea",{id:"q-scope",rows:"3","aria-label":"Job description",placeholder:"e.g. Front yard tidy-up at 12 Pittwater Rd, Dee Why: hedge trimming, weeding, new mulch to garden beds, and removal of all green waste."},q.scope||""),
      field("Job address (if different)", inp("q-jaddr",q.job_address,{autocomplete:"off"}))),
    el("div",{class:"qsec"}, el("h3",{text:"Bill of material / service"}),
      el("div",{class:"qitemhead","aria-hidden":"true"}, el("span",{text:"Item"}),el("span",{text:"Qty"}),el("span",{text:"Unit"}),el("span",{text:"Unit cost"}),el("span",{text:"Amount"}),el("span")),
      items,
      el("div",{class:"qitemfoot"},
        el("button",{type:"button",class:"btn ghost small",text:"+ Add line",onclick:()=>{ items.append(itemRow({desc:"",qty:1,unit:"",price:""})); onQuoteInput(); items.lastChild.querySelector(".i-desc").focus(); }}),
        el("b",{id:"qTotalLine",text:"Total "+money(qTotals(q).total)}))),
    el("div",{class:"qsec"}, el("h3",{text:"Comments & notes"}),
      el("p",{class:"hint",text:"One bullet point per line."}),
      el("div",{class:"grid2"},
        field("Comments", el("textarea",{id:"q-comments",rows:"4",placeholder:"e.g. Includes all plants, mulch and green waste removal."},q.comments||"")),
        field("Notes", el("textarea",{id:"q-notes",rows:"4"},q.notes||"")))),
    el("details",{class:"qsec"}, el("summary",{text:"Your business details (shown in the header)"}),
      el("div",{class:"grid2"},
        field("Address / service area", inp("q-faddr",q.from_details.address)),
        field("Phone", inp("q-fphone",q.from_details.phone)),
        field("Email", inp("q-femail",q.from_details.email,{type:"email",placeholder:"ozteengardens@gmail.com"})),
        field("ABN", inp("q-fabn",q.from_details.abn)))));
  f.oninput=onQuoteInput; f.onchange=onQuoteInput;
  f.onsubmit=e=>{ e.preventDefault(); saveQuote(); };
}

/* ---------- the quote document (matches the OzTeen template) ---------- */
function bullets(text){
  const lines=String(text||"").split(/\n+/).map(s=>s.trim().replace(/^[-•*]\s*/,"")).filter(Boolean);
  return lines.length ? el("ul",{}, lines.map(l=>el("li",{text:l}))) : el("p",{class:"qp-empty",text:" "});
}
function buildPaper(q){
  const b=BRAND, fd=q.from_details||{}, t=qTotals(q);
  const items=q.items.filter(i=>i.desc||num(i.price));
  const qtyText=i=>{ const n=num(i.qty); const s=(Math.round(n*100)/100).toString(); return i.unit? s+" "+i.unit : s; };
  const titleLines=b.titleLines;
  return el("div",{class:"qp"},
    el("header",{class:"qp-head"},
      el("div",{class:"qp-hl"},
        el("h1",{}, titleLines[0], el("br"), titleLines[1]),
        el("dl",{},
          el("dt",{text:"Quote number"}), el("dd",{text:qNo(q.quote_no)}),
          el("dt",{text:"Quote Date"}), el("dd",{text:longDate(q.quote_date)}),
          )),
      el("div",{class:"qp-hr"},
        el("div",{class:"qp-brand"}, el("b",{text:"OZTEEN "}), el("i",{text:b.line.toUpperCase()})),
        el("div",{class:"qp-from"},
          fd.address?el("div",{text:fd.address}):null, fd.phone?el("div",{text:fd.phone}):null,
          fd.email?el("div",{text:fd.email}):null, el("div",{text:b.site}), fd.abn?el("div",{text:"ABN "+fd.abn}):null))),
    el("div",{class:"qp-rule"}),
    el("div",{class:"qp-row"},
      el("table",{class:"qp-cust"},
        el("thead",{},el("tr",{},el("th",{text:"CUSTOMER INFORMATION:"}),el("th"))),
        el("tbody",{},
          el("tr",{},el("td",{text:"Customer Name:"}),el("td",{class:"b",text:q.client_name})),
          el("tr",{},el("td",{text:"Address:"}),el("td",{class:"b",text:q.client_address})),
          q.job_address?el("tr",{},el("td",{text:"Job Address:"}),el("td",{class:"b",text:q.job_address})):null,
          el("tr",{},el("td",{text:"Phone:"}),el("td",{class:"b",text:q.client_phone})),
          el("tr",{},el("td",{text:"Email:"}),el("td",{class:"b",text:q.client_email})))),
      el("div",{class:"qp-box qp-job"}, el("div",{class:"qp-bh",text:"JOB DESCRIPTION:"}), el("div",{class:"qp-bb",text:q.scope||" "}))),
    el("table",{class:"qp-items"},
      el("thead",{},
        el("tr",{class:"g"},el("th",{text:"BILL OF MATERIAL/SERVICE:"}),el("th"),el("th"),el("th")),
        el("tr",{class:"h"},el("th",{class:"l",text:"ITEM DESCRIPTION"}),el("th",{text:"QUANTITY"}),el("th",{text:"UNIT COST"}),el("th",{text:"AMOUNT"}))),
      el("tbody",{},
        (items.length?items:[{desc:"",qty:"",price:""}]).map(i=>el("tr",{},
          el("td",{class:"l",text:i.desc}), el("td",{text:i.desc||num(i.price)?qtyText(i):""}),
          el("td",{text:i.desc||num(i.price)?money(i.price):""}), el("td",{text:i.desc||num(i.price)?money(num(i.qty)*num(i.price)):""}))),
        el("tr",{class:"tot"},el("td",{class:"l",text:"TOTAL AMOUNT"}),el("td"),el("td"),el("td",{text:money(t.total)})))),
    el("div",{class:"qp-row qp-two"},
      el("div",{class:"qp-box"}, el("div",{class:"qp-bh",text:"COMMENTS:"}), el("div",{class:"qp-bb"},bullets(q.comments))),
      el("div",{class:"qp-box"}, el("div",{class:"qp-bh",text:"NOTES:"}), el("div",{class:"qp-bb"},bullets(q.notes)))),
    el("p",{class:"qp-foot"}, el("b",{text:"*"}), "For any inquiries or to accept this quote, please contact us at "+(fd.phone||"0438 619 660")+(fd.email?", "+fd.email:"")+" or ozteenrubbish.com."),
    el("div",{class:"qp-rule end"}));
}
function renderPaper(){ if(!B.q) return; $("#qpaper").replaceChildren(buildPaper(B.q)); fitPaper(); }
function fitPaper(){
  const stage=$("#qstage"), paper=$("#qpaper"); if(!stage||!paper||stage.offsetParent===null) return;
  const s=Math.min(1, stage.clientWidth/794);
  paper.style.transform="scale("+s+")"; stage.style.height=Math.ceil(paper.offsetHeight*s)+"px";
}
window.addEventListener("resize",()=>fitPaper());

/* ---------- save / pdf / more ---------- */
async function saveQuote(){
  if(!B.q) return; readQuoteForm();
  const q=B.q, t=qTotals(q);
  const items=q.items.filter(i=>i.desc||num(i.price)).map(i=>({desc:i.desc.trim(),qty:num(i.qty),unit:(i.unit||"").trim(),price:round2(num(i.price))}));
  const match=q.client_id?null:B.clients.find(c=>lc(c.name)===lc(q.client_name));
  const row={status:q.status,business:q.business,quote_date:q.quote_date,valid_until:null,
    client_id:q.client_id||(match?match.id:null),client_name:q.client_name.trim(),client_phone:q.client_phone.trim(),client_email:q.client_email.trim(),
    client_address:q.client_address.trim(),job_address:q.job_address.trim(),items,gst_mode:q.gst_mode,scope:q.scope.trim(),
    comments:q.comments.trim(),notes:q.notes.trim(),from_details:q.from_details,total:t.total,updated_at:new Date().toISOString()};
  const btn=$("#qSave"); busy(btn,true,"Saving…");
  const res = q.id ? await sb.from("quotes").update(row).eq("id",q.id).select().single()
                   : await sb.from("quotes").insert({...row,created_by:S.uid}).select().single();
  busy(btn,false,"Save quote");
  if(res.error){ toast("Couldn't save: "+res.error.message); return false; }
  // a lead that gets quoted moves to the "Quoted" stage
  const cid=res.data.client_id, lead=B.clients.find(c=>c.id===cid&&c.kind==="lead"&&["new","contacted"].includes(c.stage));
  if(lead) await sb.from("clients").update({stage:"quoted"}).eq("id",lead.id);
  toast("Quote "+qNo(res.data.quote_no)+" saved");
  await loadBiz(); openQuote(res.data); renderClients();
  return true;
}
$("#qSave").addEventListener("click",saveQuote);

$("#qPdf").addEventListener("click",async()=>{
  if(!B.q) return; readQuoteForm();
  if(!B.q.id || B.qDirty){ const ok=await saveQuote(); if(!ok) return; }
  let root=$("#printRoot"); if(!root){ root=el("div",{id:"printRoot"}); document.body.append(root); }
  root.replaceChildren(buildPaper(B.q));
  const oldTitle=document.title;
  document.title="OzTeen Quote "+qNo(B.q.quote_no)+(B.q.client_name?" - "+B.q.client_name:"");
  document.body.classList.add("printq");
  const done=()=>{ document.body.classList.remove("printq"); document.title=oldTitle; window.removeEventListener("afterprint",done); };
  window.addEventListener("afterprint",done);
  setTimeout(()=>{ window.print(); setTimeout(done,1500); },50);
});

$("#qMore").addEventListener("click",e=>{
  const m=$("#qMoreMenu"); const open=m.hidden; m.hidden=!open; e.target.setAttribute("aria-expanded",open?"true":"false");
  if(!open) return;
  const q=B.q; readQuoteForm();
  m.replaceChildren(
    el("button",{type:"button",class:"btn ghost small",text:"Duplicate as new quote",onclick:()=>{ m.hidden=true; const c=JSON.parse(JSON.stringify(q)); Object.assign(c,{id:null,quote_no:null,status:"draft",quote_date:key(today()),valid_until:null}); openQuote(c); B.qDirty=true; setQStatus(); }}),
    el("button",{type:"button",class:"btn ghost small",text:"Add to accounts",onclick:()=>{ m.hidden=true; const t=qTotals(q);
      B.entryEdit="new"; B.entryPrefill={client_name:q.client_name,description:(q.scope||q.items.map(i=>i.desc).filter(Boolean).join(", ")).split("\n")[0].slice(0,140),
        service:"Gardens",quote:t.total,job_date:key(today()),notes:"From quote "+qNo(q.quote_no)};
      show("accounts"); renderAccounts(); scrollTo0("#entryForm"); }}),
    q.id?el("button",{type:"button",class:"btn danger small",text:"Delete quote",onclick:ev=>confirmTwice(ev.target,async()=>{
      const {error}=await sb.from("quotes").delete().eq("id",q.id);
      if(error) return toast("Couldn't delete: "+error.message);
      m.hidden=true; toast("Quote deleted"); await loadBiz(); openQuote(blankQuote()); })}):null);
});

/* =====================================================================
   wiring for app.js
   ===================================================================== */
window.BIZ = {
  async start(){
    await loadBiz();
    if(!B.q) openQuote(blankQuote());
    sb.channel("biz")
      .on("postgres_changes",{event:"*",schema:"public",table:"clients"},bizReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"accounts"},bizReload)
      .on("postgres_changes",{event:"*",schema:"public",table:"quotes"},bizReload)
      .subscribe();
    document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") bizReload(); });
    window.addEventListener("beforeunload",e=>{ if(B.qDirty){ e.preventDefault(); e.returnValue=""; } });
  },
  render(){ renderClients(); renderAccounts(); renderQuoteBar(); },
  onShow(v){ if(v==="quotes") requestAnimationFrame(fitPaper); if(v!=="quotes") $("#qMoreMenu").hidden=true; },
  fromCalendarJob(j){
    B.entryEdit="new";
    B.entryPrefill={job_date:endOf(j), description:j.title+(j.suburb?", "+j.suburb:""), service:j.service||"Rubbish", notes:j.address||""};
    show("accounts"); renderAccounts(); scrollTo0("#entryForm");
  },
};
})();
