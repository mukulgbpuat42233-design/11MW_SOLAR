
const KEY = "thdc11mw_app_reports_v32_sheet1_master";
const OLD_KEYS = [
  "thdc11mw_app_reports_v32_sheet1_master",
  "thdc11mw_app_reports_v32",
  "thdc11mw_app_excel_v4"
];

// Keep only the compact data actually required by the app.
// Raw Sheet1/report blobs are NEVER persisted in localStorage.
function compactState(s){
  return {
    trades:(Array.isArray(s?.trades)?s.trades:[]).map(t=>({
      date:t.date, block:Number(t.block)||0, period:t.period||"",
      qty:Number(t.qty)||0, mcp:Number(t.mcp)||0,
      amount:Number.isFinite(Number(t.amount))?Number(t.amount):undefined,
      seg:t.seg||"G-DAM",
      txn:t.txn||"SELL"
    })),
    obligations:(Array.isArray(s?.obligations)?s.obligations:[]).map(o=>({
      date:o.date,
      nldcApp:Math.abs(Number(o.nldcApp)||0), nldcSched:Math.abs(Number(o.nldcSched)||0),
      nldcSchedBuy:Math.abs(Number(o.nldcSchedBuy)||0), nldcSchedSell:Math.abs(Number(o.nldcSchedSell)||0),
      ctu:Math.abs(Number(o.ctu)||0), stu:Math.abs(Number(o.stu)||0), sldc:Math.abs(Number(o.sldc)||0),
      distribution:Math.abs(Number(o.distribution)||0), other:Math.abs(Number(o.other)||0)
    }))
  };
}

function loadCompactState(){
  for(const k of OLD_KEYS){
    try{
      const raw=localStorage.getItem(k);
      if(!raw) continue;
      const parsed=JSON.parse(raw);
      if(parsed && (Array.isArray(parsed.trades)||Array.isArray(parsed.obligations)))
        return compactState(parsed);
    }catch(e){}
  }
  return {trades:[],obligations:[]};
}
let state = loadCompactState();

/* 60-MONTH STORAGE: IndexedDB replaces localStorage for the growing dataset.
   60 months × 96 blocks/day is comfortably within normal browser IndexedDB
   quotas; only small preferences remain in localStorage. */
const DB_NAME="THDCIL_11MW_SOLAR_DB";
const DB_VERSION=1;
const STORE_NAME="app_state";
let dbReady=null;

function openSolarDB(){
  if(dbReady)return dbReady;
  dbReady=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbReady;
}
async function loadStateFromIndexedDB(){
  try{
    const db=await openSolarDB();
    const data=await new Promise((resolve,reject)=>{
      const q=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).get("master");
      q.onsuccess=()=>resolve(q.result);
      q.onerror=()=>reject(q.error);
    });
    if(data && Array.isArray(data.trades)){
      state=compactState(data);
      return true;
    }
  }catch(e){console.warn("IndexedDB load failed",e);}
  return false;
}
async function saveStateToIndexedDB(){
  try{
    const db=await openSolarDB();
    const payload=compactState(state);
    await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,"readwrite");
      tx.objectStore(STORE_NAME).put(payload,"master");
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error);
    });
    return true;
  }catch(e){console.error("IndexedDB save failed",e);return false;}
}

/* Clear only old oversized application caches. */
try{
  localStorage.removeItem("thdc11mw_app_reports_v32");
  localStorage.removeItem("thdc11mw_app_excel_v4");
  localStorage.removeItem("thdc11mw_app_reports_v32_sheet1_master");
}catch(e){}
// STRICT EXCEL DEFAULT RATES
let nvvnRate = parseFloat(localStorage.getItem(KEY+"_nvrate")) || 0.0099; // ₹/kWh
let nvvnGst = parseFloat(localStorage.getItem(KEY+"_nvgst")) || 18.0;    // %
let pxRate = parseFloat(localStorage.getItem(KEY+"_pxrate")) || 0.02;     // ₹/kWh
let pxGst = parseFloat(localStorage.getItem(KEY+"_pxgst")) || 18.0;       // %

const months = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const mNames = {Apr:"Apr",May:"May",Jun:"Jun",Jul:"Jul",Aug:"Aug",Sep:"Sep",Oct:"Oct",Nov:"Nov",Dec:"Dec",Jan:"Jan",Feb:"Feb",Mar:"Mar"};

const $ = id => document.getElementById(id);

function save() {
  saveStateToIndexedDB();
  const payload=JSON.stringify(compactState(state));
  try{
    localStorage.setItem(KEY,payload);
    return true;
  }catch(e){
    // Quota-safe recovery: remove obsolete raw/master copies, then retry once.
    for(const k of OLD_KEYS){
      if(k!==KEY) { try{localStorage.removeItem(k);}catch(_){} }
    }
    try{
      localStorage.setItem(KEY,payload);
      return true;
    }catch(e2){
      return false;
    }
  }
}

// ==========================================
// UNDO & REDO STATE MANAGEMENT ENGINE
// ==========================================
let undoStack = [];
let redoStack = [];
const MAX_UNDO_DEPTH = 35;

function cloneCompactState(s) {
  if (!s) return { trades: [], obligations: [] };
  return {
    trades: Array.isArray(s.trades) ? s.trades.map(t => ({...t})) : [],
    obligations: Array.isArray(s.obligations) ? s.obligations.map(o => ({...o})) : []
  };
}

function pushUndoSnapshot(actionName = "Action") {
  try {
    const snap = {
      action: actionName,
      state: cloneCompactState(state),
      timestamp: Date.now()
    };
    undoStack.push(snap);
    if (undoStack.length > MAX_UNDO_DEPTH) undoStack.shift();
    redoStack = []; // Standard behavior: clear redo on new action
    updateUndoUI();
    try {
      sessionStorage.setItem("thdc_last_undo", JSON.stringify({
        action: actionName,
        state: snap.state,
        timestamp: snap.timestamp
      }));
    } catch(e){}
  } catch(err) {
    console.warn("Unable to capture undo snapshot:", err);
  }
}

function undoAction() {
  if (undoStack.length === 0) {
    try {
      const cached = sessionStorage.getItem("thdc_last_undo");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.state) {
          redoStack.push({
            action: parsed.action || "Current State",
            state: cloneCompactState(state),
            timestamp: Date.now()
          });
          state = cloneCompactState(parsed.state);
          save();
          sessionStorage.removeItem("thdc_last_undo");
          refreshAllPages();
          updateUndoUI();
          showUndoToast(`Restored: ${parsed.action}`, false);
          return;
        }
      }
    } catch(e){}
    showUndoToast("Nothing to undo.", false);
    return;
  }

  const snap = undoStack.pop();
  redoStack.push({
    action: snap.action,
    state: cloneCompactState(state),
    timestamp: Date.now()
  });

  state = cloneCompactState(snap.state);
  save();
  refreshAllPages();
  updateUndoUI();
  showUndoToast(`↩️ Undone: ${snap.action}`, false);
}

function redoAction() {
  if (redoStack.length === 0) {
    showUndoToast("Nothing to redo.", false);
    return;
  }
  const snap = redoStack.pop();
  undoStack.push({
    action: snap.action,
    state: cloneCompactState(state),
    timestamp: Date.now()
  });

  state = cloneCompactState(snap.state);
  save();
  refreshAllPages();
  updateUndoUI();
  showUndoToast(`↪️ Redone: ${snap.action}`, false);
}

function updateUndoUI() {
  const btnUndo = $("btnUndoAction");
  const btnRedo = $("btnRedoAction");
  const badge = $("undoCountBadge");
  const tradesUndo = $("tradesUndoBtn");
  const obUndo = $("obUndoBtn");
  const uploadUndo = $("uploadUndoBtn");

  const hasUndo = undoStack.length > 0;
  const hasRedo = redoStack.length > 0;
  const lastUndoAction = hasUndo ? undoStack[undoStack.length - 1].action : "";
  const lastRedoAction = hasRedo ? redoStack[redoStack.length - 1].action : "";

  if (btnUndo) {
    btnUndo.disabled = !hasUndo;
    btnUndo.title = hasUndo ? `Undo: ${lastUndoAction} (Ctrl+Z)` : "No actions to undo (Ctrl+Z)";
    if (hasUndo) {
      btnUndo.classList.remove("opacity-35", "cursor-not-allowed");
      btnUndo.classList.add("cursor-pointer", "text-amber-300");
    } else {
      btnUndo.classList.add("opacity-35", "cursor-not-allowed");
      btnUndo.classList.remove("cursor-pointer");
    }
  }

  if (badge) {
    if (hasUndo) {
      badge.textContent = undoStack.length;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  if (btnRedo) {
    btnRedo.disabled = !hasRedo;
    btnRedo.title = hasRedo ? `Redo: ${lastRedoAction} (Ctrl+Y)` : "No actions to redo (Ctrl+Y)";
    if (hasRedo) {
      btnRedo.classList.remove("opacity-25", "cursor-not-allowed");
      btnRedo.classList.add("cursor-pointer", "text-white");
    } else {
      btnRedo.classList.add("opacity-25", "cursor-not-allowed");
      btnRedo.classList.remove("cursor-pointer");
    }
  }

  [tradesUndo, obUndo, uploadUndo].forEach(btn => {
    if (!btn) return;
    btn.disabled = !hasUndo;
    if (hasUndo) {
      btn.classList.remove("opacity-40", "cursor-not-allowed");
      btn.title = `Undo: ${lastUndoAction} (Ctrl+Z)`;
    } else {
      btn.classList.add("opacity-40", "cursor-not-allowed");
      btn.title = "No actions to undo";
    }
  });
}

let undoToastTimeout = null;
function showUndoToast(msg, showUndoBtn = true) {
  const toast = $("undoToast");
  if (!toast) return;
  const title = $("undoToastTitle");
  const sub = $("undoToastMsg");
  const btn = $("undoToastBtn");

  if (title) title.innerText = msg;
  if (sub) {
    if (showUndoBtn && undoStack.length > 0) {
      const last = undoStack[undoStack.length - 1];
      sub.innerText = `Revert "${last.action}"? (or press Ctrl+Z)`;
    } else {
      sub.innerText = "State updated in portal.";
    }
  }
  if (btn) {
    if (showUndoBtn && undoStack.length > 0) {
      btn.classList.remove("hidden");
    } else {
      btn.classList.add("hidden");
    }
  }

  toast.classList.remove("translate-y-28", "opacity-0", "pointer-events-none");
  toast.classList.add("translate-y-0", "opacity-100", "pointer-events-auto");

  if (undoToastTimeout) clearTimeout(undoToastTimeout);
  undoToastTimeout = setTimeout(() => {
    hideUndoToast();
  }, 7000);
}

function hideUndoToast() {
  const toast = $("undoToast");
  if (!toast) return;
  toast.classList.remove("translate-y-0", "opacity-100", "pointer-events-auto");
  toast.classList.add("translate-y-28", "opacity-0", "pointer-events-none");
}

window.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : "";
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    if (e.shiftKey) {
      e.preventDefault();
      redoAction();
    } else {
      e.preventDefault();
      undoAction();
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redoAction();
  }
});

window.pushUndoSnapshot = pushUndoSnapshot;
window.undoAction = undoAction;
window.redoAction = redoAction;
window.updateUndoUI = updateUndoUI;
window.showUndoToast = showUndoToast;
window.hideUndoToast = hideUndoToast;
function money(n) { return "₹ " + Math.abs(Number(n||0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatIndianCurrency(n) { return Math.abs(Number(n||0)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function qtyMwh(t) { return Math.abs(t.qty) * 0.25; }

// CRITICAL FIX: Strict Block-level rounding matching Excel perfectly
function roundPrecise(num) { return Math.round((num + Number.EPSILON) * 100) / 100; }
function amount(t) {
  if(Number.isFinite(Number(t.amount))) return Math.abs(Number(t.amount));
  return Math.abs(t.qty) * t.mcp * 0.25;
} 

function period(b) { let s=(b-1)*15,e=b*15; const f=x=>String(Math.floor(x/60)).padStart(2,"0")+":"+String(x%60).padStart(2,"0"); return f(s)+"-"+(b===96?"24:00":f(e)); }
function monthKey(d) { return months[(+d.slice(5,7)-4+12)%12]; }
function sortedTrades() {
  return [...state.trades].map(t => ({
    ...t,
    seg: t.seg || "G-DAM",
    txn: t.txn || "SELL"
  })).sort((a,b) => a.date.localeCompare(b.date) || a.block - b.block);
}

function applyMarketConfigToTrades() {
  const seg = $("uploadMarketSeg")?.value || "G-DAM";
  const txn = $("uploadTxnType")?.value || "SELL";
  if (!state.trades || !state.trades.length) {
    alert("No trade records currently loaded in the database.");
    return;
  }
  pushUndoSnapshot(`Market Config (${seg}/${txn})`);
  state.trades.forEach(t => {
    t.seg = seg;
    t.txn = txn;
  });
  save();
  alert(`✅ Successfully updated ${state.trades.length} trade blocks with:\nMarket Segment: ${seg}\nTransaction Type: ${txn}`);
  refreshAllPages();
  showUndoToast(`Updated ${state.trades.length} trades to ${seg}/${txn}`);
}

function updateMarginRates() {
  nvvnRate = parseFloat($("nvvnRateInput").value) || 0;
  nvvnGst = parseFloat($("nvvnGstRateInput").value) || 0;
  pxRate = parseFloat($("pxRateInput").value) || 0;
  pxGst = parseFloat($("pxGstRateInput").value) || 0;

  localStorage.setItem(KEY+"_nvrate", nvvnRate);
  localStorage.setItem(KEY+"_nvgst", nvvnGst);
  localStorage.setItem(KEY+"_pxrate", pxRate);
  localStorage.setItem(KEY+"_pxgst", pxGst);

  renderBilling(); renderReports();
}

function clearDateData() {
  let d = $("clearDateInput").value;
  if (!d) {
    alert("Please select a date from the calendar icon to clear its data.");
    return;
  }
  let matchingTrades = state.trades.filter(x => x.date === d).length;
  let matchingObs = state.obligations.filter(x => x.date === d).length;
  if (matchingTrades === 0 && matchingObs === 0) {
    alert(`No data found in the system for ${d}.`);
    return;
  }
  if (confirm(`⚠️ Are you sure you want to delete ALL trades and obligations for ${d}?\n(${matchingTrades} blocks, ${matchingObs} obligations)\n\nYou can click Undo (Ctrl+Z) anytime to restore.`)) {
    pushUndoSnapshot(`Clear Day ${d}`);
    state.trades = state.trades.filter(x => x.date !== d);
    state.obligations = state.obligations.filter(x => x.date !== d);
    save();
    refreshAllPages();
    showUndoToast(`Cleared ${matchingTrades} blocks & ${matchingObs} obligations for ${d}.`, true);
  }
}

function clearAllData() {
  let trCount = state.trades.length;
  let obCount = state.obligations.length;
  if (trCount === 0 && obCount === 0) {
    alert("System has no trade or obligation data to wipe.");
    return;
  }
  if(confirm(`⚠️ Are you sure you want to permanently delete ALL trades and obligations data?\nTotal: ${trCount} trade blocks and ${obCount} daily obligations.\n\nYou can restore everything using the Undo button or Ctrl+Z.`)) {
    pushUndoSnapshot(`Wipe All Data (${trCount} blocks)`);
    state = { trades: [], obligations: [] };
    save();
    refreshAllPages();
    showUndoToast(`Wiped ${trCount} trade blocks & ${obCount} obligations.`, true);
  }
}

function downloadTemplate() {
  const headers = [
    ["Delivery Date", "Block", "Market Segment", "Transaction Type", "Scheduled Qty (MW)", "MCP (Rs/MWh)", "NLDC Application Fees", "Operating Charges - Sell", "CTU Transmission Charges", "STU Transmission Charges", "SLDC Scheduling"]
  ];
  const today = new Date().toISOString().slice(0, 10);
  headers.push([today, 27, "G-DAM", "SELL", -0.250, 3500.00, 4.83, 34.05, 0, 0, 1500]);
  headers.push([today, 28, "G-DAM", "SELL", -0.500, 3200.00, "", "", "", "", ""]);
  let wb = XLSX.utils.aoa_to_sheet(headers);
  let book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, wb, "Sheet1");
  XLSX.writeFile(book, "THDC_11MW_Upload_Template.xlsx");
}

document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => {
  document.querySelectorAll(".nav-btn").forEach(x => { x.classList.remove("active", "bg-white", "text-blue-900", "shadow-sm"); x.classList.add("text-blue-100"); });
  b.classList.add("active", "bg-white", "text-blue-900", "shadow-sm"); b.classList.remove("text-blue-100");
  document.querySelectorAll(".page-sec").forEach(x => x.classList.add("hidden"));
  $(b.dataset.target).classList.remove("hidden"); refreshPage(b.dataset.target);
});

function goToHomePage() {
  document.querySelectorAll(".nav-btn").forEach(x => {
    x.classList.remove("active", "bg-white", "text-blue-900", "shadow-sm");
    x.classList.add("text-blue-100");
    if (x.dataset.target === "dashboard") {
      x.classList.add("active", "bg-white", "text-blue-900", "shadow-sm");
      x.classList.remove("text-blue-100");
    }
  });
  document.querySelectorAll(".page-sec").forEach(x => x.classList.add("hidden"));
  const dash = $("dashboard");
  if (dash) dash.classList.remove("hidden");
  refreshPage("dashboard");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.goToHomePage = goToHomePage;

function goToWeatherCorrelation() {
  document.querySelectorAll(".nav-btn").forEach(x => {
    x.classList.remove("active", "bg-white", "text-blue-900", "shadow-sm");
    x.classList.add("text-blue-100");
    if (x.dataset.target === "weather") {
      x.classList.add("active", "bg-white", "text-blue-900", "shadow-sm");
      x.classList.remove("text-blue-100");
    }
  });
  document.querySelectorAll(".page-sec").forEach(x => x.classList.add("hidden"));
  const sec = $("weather");
  if (sec) sec.classList.remove("hidden");
  refreshPage("weather");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.goToWeatherCorrelation = goToWeatherCorrelation;

function goToYoyComparison() {
  document.querySelectorAll(".nav-btn").forEach(x => {
    x.classList.remove("active", "bg-white", "text-blue-900", "shadow-sm");
    x.classList.add("text-blue-100");
    if (x.dataset.target === "yoy") {
      x.classList.add("active", "bg-white", "text-blue-900", "shadow-sm");
      x.classList.remove("text-blue-100");
    }
  });
  document.querySelectorAll(".page-sec").forEach(x => x.classList.add("hidden"));
  const sec = $("yoy");
  if (sec) sec.classList.remove("hidden");
  refreshPage("yoy");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
window.goToYoyComparison = goToYoyComparison;

function openYoyForMonth(mKey) {
  if (!mKey) return;
  const parts = mKey.split("-");
  if (parts.length === 2) {
    const yr = parts[0];
    const mo = parseInt(parts[1], 10);
    const mSelect = $("yoyMonthSelect");
    const yrSelect = $("yoyCurYearSelect");
    const compSelect = $("yoyCompYearSelect");
    if (mSelect) mSelect.value = String(mo);
    if (yrSelect) yrSelect.value = yr;
    if (compSelect) compSelect.value = String(parseInt(yr, 10) - 1);
  }
  goToYoyComparison();
}
window.openYoyForMonth = openYoyForMonth;

function refreshPage(p) {
  if(p==="dashboard") renderDashboard();
  if(p==="trades") renderTrades();
  if(p==="reports") renderReports();
  if(p==="billing") renderBilling();
  if(p==="obligations") { loadObligation(); renderObligations(); }
  if(p==="weather") renderWeatherCorrelation();
  if(p==="yoy") renderYoyComparison();
}

function refreshAllPages() {
  const activeBtn = document.querySelector(".nav-btn.active");
  const target = activeBtn ? activeBtn.dataset.target : "dashboard";
  renderDashboard();
  renderTrades();
  renderBilling();
  renderReports();
  if (typeof renderObligations === "function") renderObligations();
  if (typeof renderWeatherCorrelation === "function") {
    try {
      if (typeof weatherMergedData !== "undefined" && weatherMergedData.length > 0) {
        renderWeatherCorrelationUI();
      }
    } catch(e){}
  }
  if (typeof renderYoyComparison === "function") {
    try {
      if (target === "yoy") renderYoyComparison();
    } catch(e){}
  }
  refreshPage(target);
  updateUndoUI();
}
window.refreshAllPages = refreshAllPages;

// UNIFIED UPLOADER

// ===== STRICT IEX SHEET1 UPLOADER =====
function normalizeDateValue(v, forcedDate=""){
  if(forcedDate) return forcedDate;
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);
  if(typeof v==="number"){
    const d=new Date((v-25569)*86400*1000);
    return isNaN(d)? "": d.toISOString().slice(0,10);
  }
  const s=String(v??"").trim();
  let m=s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if(m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if(m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  m=s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if(m){
    const mm={Jan:"01",Feb:"02",Mar:"03",Apr:"04",May:"05",Jun:"06",Jul:"07",Aug:"08",Sep:"09",Oct:"10",Nov:"11",Dec:"12"};
    const yy=m[3].length===2?"20"+m[3]:m[3];
    return mm[m[2]]?`${yy}-${mm[m[2]]}-${m[1].padStart(2,"0")}`:"";
  }
  return "";
}
function nval(v){
  const n=parseFloat(String(v??"").replace(/,/g,"").replace(/[₹]/g,"").trim());
  return Number.isFinite(n)?n:NaN;
}
function keyFor(row, aliases){
  const keys=Object.keys(row||{});
  const norm=s=>String(s??"").toLowerCase().replace(/[\s_\-().:/]+/g,"").replace(/₹/g,"rs");
  const ns=keys.map(k=>({raw:k,n:norm(k)}));
  for(const a of aliases){
    const na=norm(a);
    const hit=ns.find(x=>x.n===na);
    if(hit) return hit.raw;
  }
  for(const a of aliases){
    const na=norm(a);
    const hit=ns.find(x=>x.n.includes(na)||na.includes(x.n));
    if(hit) return hit.raw;
  }
  return undefined;
}
function blockValue(v){
  const n=nval(v);
  if(Number.isInteger(n)&&n>=1&&n<=96) return n;
  const s=String(v??"").trim();
  const m=s.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
  if(m){
    const h=+m[1], mi=+m[2];
    if(h>=0&&h<24&&[0,15,30,45].includes(mi)) return h*4+mi/15+1;
  }
  return null;
}
function validateDaily11MW(date){
  const a=state.trades.filter(x=>x.date===date);
  const blocks=new Set(a.map(x=>x.block));
  const missing=[];
  for(let b=1;b<=96;b++) if(!blocks.has(b)) missing.push(b);
  const energy=a.reduce((s,x)=>s+qtyMwh(x),0);
  return {blocks:a.length,missing,energy,physicalOK:energy<=264.000001};
}
function showUploadValidation(date, extra=""){
  const v=validateDaily11MW(date);
  const existing=$("uploadStatusMsg"), stats=$("uploadStats"), box=$("uploadStatus");
  if(!box||!existing||!stats)return;
  const level=!v.physicalOK?"ERROR":(v.missing.length?"WARNING":"VALID");
  existing.innerHTML=`<b>${level}</b> • ${date} • ${v.blocks}/96 blocks • ${v.energy.toFixed(3)} MWh${extra?` • ${extra}`:""}`;
  stats.innerHTML=`Missing: ${v.missing.length} ${v.missing.length?`(Blocks ${v.missing.slice(0,12).join(", ")}${v.missing.length>12?"…":""})`:""}<br>11 MW limit: ${v.physicalOK?"OK":"EXCEEDED"}`;
  box.classList.remove("hidden");
}
function importStrictSheet1(workbook, forcedDate=""){
  const ws=workbook.Sheets["Sheet1"];
  if(!ws) throw new Error("Sheet1 required. Sheet2/Sheet3 are ignored.");

  const matrix=XLSX.utils.sheet_to_json(ws,{header:1,defval:"",raw:true});
  if(!matrix.length) throw new Error("Sheet1 is empty.");

  let headerRow=-1;
  for(let r=0;r<Math.min(matrix.length,120);r++){
    const text=matrix[r].map(v=>String(v??"").toLowerCase()).join(" | ");
    if(text.includes("period") && text.includes("qty in mw") && text.includes("rate/mwh")){
      headerRow=r; break;
    }
  }
  if(headerRow<0) throw new Error("Actual IEX Sheet1 layout not found. Expected Period + Qty in MW + Rate/MWh.");

  let tradeDate=forcedDate||"";
  if(!tradeDate){
    for(let r=0;r<headerRow;r++){
      for(let c=0;c<matrix[r].length;c++){
        if(String(matrix[r][c]??"").toLowerCase().includes("delivery date")){
          for(let k=c+1;k<matrix[r].length;k++){
            const d=normalizeDateValue(matrix[r][k],"");
            if(d){tradeDate=d;break;}
          }
        }
      }
      if(tradeDate)break;
    }
  }
  if(!tradeDate) throw new Error("Delivery Date not found in Sheet1. Please select Trade Date Override.");

  // ---- IEX Sheet1 Charges section ----
  // IEX DOR Sheet1: charge labels are in column E (index 4),
  // corresponding charge amounts are in column N (index 13).
  const cleanText=v=>String(v??"").replace(/\s+/g," ").trim().toLowerCase();
  const parseCharge=v=>{
    if(typeof v==="number") return Number.isFinite(v)?Math.abs(v):0;
    const s=String(v??"").replace(/,/g,"").replace(/[₹`*()]/g,"").trim();
    if(!s || s==="-" || s==="—") return 0;
    const n=parseFloat(s);
    return Number.isFinite(n)?Math.abs(n):0;
  };
  const obligation={
    date:tradeDate,
    nldcApp:0,
    ctu:0,
    nldcSchedBuy:0,
    nldcSchedSell:0,
    stu:0,
    distribution:0,
    other:0,
    sldc:0
  };

  for(let r=0;r<matrix.length;r++){
    const label=cleanText(matrix[r]?.[4]);
    if(!label) continue;
    const value=parseCharge(matrix[r]?.[13]);

    if(label.includes("nldc application fees")){
      obligation.nldcApp=value;
    }else if(label.includes("ctu transmission charges")){
      obligation.ctu=value;
    }else if(label.includes("nldc scheduling") && label.includes("operating") && label.includes("buy")){
      obligation.nldcSchedBuy=value;
    }else if(label.includes("nldc scheduling") && label.includes("operating") && label.includes("sell")){
      obligation.nldcSchedSell=value;
    }else if(label.includes("stu transmission charges")){
      obligation.stu=value;
    }else if(label.includes("distribution charges")){
      obligation.distribution=value;
    }else if(label.includes("any other charges")){
      obligation.other=value;
    }else if(label.includes("sldc scheduling") && label.includes("operating")){
      obligation.sldc=value;
    }
  }

  // Fallback for shifted/merged IEX layouts: search the whole row only when
  // the exact Sheet1 label-column match was not found.
  const chargeFallback=(needle, current)=>{
    if(current!==0) return current;
    for(let r=0;r<matrix.length;r++){
      const row=matrix[r]||[];
      const txt=row.map(cleanText).join(" | ");
      if(!txt.includes(needle)) continue;
      for(let c=row.length-1;c>=0;c--){
        const n=parseCharge(row[c]);
        if(n!==0 || String(row[c]??"").trim()==="0" || String(row[c]??"").trim()==="0.00"){
          return n;
        }
      }
    }
    return current;
  };
  obligation.nldcApp=chargeFallback("nldc application fees",obligation.nldcApp);
  obligation.ctu=chargeFallback("ctu transmission charges",obligation.ctu);
  obligation.nldcSchedBuy=chargeFallback("nldc scheduling & operating charges - buy",obligation.nldcSchedBuy);
  obligation.nldcSchedSell=chargeFallback("nldc scheduling & operating charges - sell",obligation.nldcSchedSell);
  obligation.stu=chargeFallback("stu transmission charges",obligation.stu);
  obligation.distribution=chargeFallback("distribution charges",obligation.distribution);
  obligation.other=chargeFallback("any other charges",obligation.other);
  obligation.sldc=chargeFallback("sldc scheduling and operating charges",obligation.sldc);

  const selectedSeg = $("uploadMarketSeg")?.value || "G-DAM";
  const selectedTxn = $("uploadTxnType")?.value || "SELL";
  let detectedSeg = selectedSeg;
  let detectedTxn = selectedTxn;

  // Auto-detect Market Segment & Txn Type if explicitly labeled in file
  for(let r=0; r<Math.min(matrix.length, 30); r++){
    const rowStr = (matrix[r]||[]).map(v => String(v??"").toUpperCase()).join(" ");
    if(rowStr.includes("G-DAM") || rowStr.includes("GDAM") || rowStr.includes("GREEN DAY")) detectedSeg = "G-DAM";
    else if(rowStr.includes("DAM") && !rowStr.includes("G-DAM") && !rowStr.includes("GDAM")) detectedSeg = "DAM";
    else if(rowStr.includes("TAM") || rowStr.includes("TERM AHEAD")) detectedSeg = "TAM";
    else if(rowStr.includes("RTM") || rowStr.includes("REAL TIME")) detectedSeg = "RTM";

    if(rowStr.includes("SELL") || rowStr.includes("SALE") || rowStr.includes("INJECTION")) detectedTxn = "SELL";
    else if(rowStr.includes("BUY") || rowStr.includes("PURCHASE") || rowStr.includes("DRAWAL")) detectedTxn = "BUY";
  }

  const records=[], seen=new Set();
  const add=(period, qtyCell, rateCell, amountCell, block)=>{
    if(!period || !/^\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}$/.test(period)) return;
    const rawQ=nval(qtyCell), rate=nval(rateCell), amount=nval(amountCell);
    if(!Number.isFinite(rawQ)) return;
    const key=tradeDate+"|"+block;
    if(seen.has(key)) return;
    seen.add(key);
    records.push({
      date:tradeDate, block, period,
      qty:rawQ,
      mcp:Number.isFinite(rate)?rate:0,
      amount:Number.isFinite(amount)?Math.abs(amount):Math.abs(rawQ)*((Number.isFinite(rate)?rate:0))*0.25,
      seg: detectedSeg,
      txn: detectedTxn
    });
  };

  for(let r=headerRow+1;r<matrix.length;r++){
    add(String(matrix[r]?.[2]??"").trim(),matrix[r]?.[4],matrix[r]?.[8],matrix[r]?.[9],r-headerRow);
    add(String(matrix[r]?.[11]??"").trim(),matrix[r]?.[15],matrix[r]?.[19],matrix[r]?.[22],49+(r-(headerRow+1)));
  }

  if(!records.length) throw new Error("Sheet1 trade table found, but no valid block rows were found.");

  pushUndoSnapshot(`Upload Sheet1 (${tradeDate})`);

  let newN=0,updN=0,skipN=0;
  records.forEach(t=>{
    const idx=state.trades.findIndex(x=>x.date===t.date&&x.block===t.block);
    const obj={date:t.date,block:t.block,qty:t.qty,mcp:t.mcp,amount:t.amount,period:t.period,seg:t.seg,txn:t.txn};
    if(idx>=0){
      const old=state.trades[idx];
      if(old.qty===obj.qty && old.mcp===obj.mcp && Math.abs((old.amount??0)-obj.amount)<0.01 && (old.seg||"G-DAM")===obj.seg && (old.txn||"SELL")===obj.txn) skipN++;
      else {state.trades[idx]=Object.assign({},old,obj);updN++;}
    }else{state.trades.push(obj);newN++;}
  });

  // Replace the obligation for this date from the uploaded Sheet1, so a
  // re-uploaded file cannot leave stale/zero corridor charges behind.
  const oi=state.obligations.findIndex(x=>x.date===tradeDate);
  if(oi>=0) state.obligations[oi]=obligation; else state.obligations.push(obligation);

  save();
  updateUndoUI();
  showUndoToast(`Uploaded Sheet1: ${tradeDate} (${records.length} blocks)`, true);
  const v=validateDaily11MW(tradeDate);
  showUploadValidation(tradeDate,`New ${newN} • Updated ${updN} • Duplicate unchanged ${skipN}`);
  if($("uploadStatusMsg")) {
    const corridorTotal=Math.abs(obligation.nldcApp)+Math.abs(obligation.ctu)+
      Math.abs(obligation.nldcSchedBuy)+Math.abs(obligation.nldcSchedSell)+
      Math.abs(obligation.stu)+Math.abs(obligation.distribution)+
      Math.abs(obligation.other)+Math.abs(obligation.sldc);
    $("uploadStatusMsg").innerHTML=
      `<b>Sheet1 ✓</b> • Delivery Date: ${tradeDate} • Segment: <span class="px-1.5 py-0.5 rounded bg-teal-100 text-teal-800 font-bold text-[11px]">${detectedSeg}</span> • Txn: <span class="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold text-[11px]">${detectedTxn}</span> • 96-block layout detected • ${records.length} rows
       <br><b>Corridor Charges: ₹ ${corridorTotal.toFixed(2)}</b>
       <br><span class="text-[10px]">NLDC App ₹ ${Math.abs(obligation.nldcApp).toFixed(2)} • CTU ₹ ${Math.abs(obligation.ctu).toFixed(2)}
       • NLDC Buy ₹ ${Math.abs(obligation.nldcSchedBuy).toFixed(2)} • NLDC Sell ₹ ${Math.abs(obligation.nldcSchedSell).toFixed(2)}
       • STU ₹ ${Math.abs(obligation.stu).toFixed(2)} • Distribution ₹ ${Math.abs(obligation.distribution).toFixed(2)}
       • Other ₹ ${Math.abs(obligation.other).toFixed(2)} • SLDC ₹ ${Math.abs(obligation.sldc).toFixed(2)}</span>`;
  }
  if($("uploadStats")) $("uploadStats").innerHTML=
    `New: ${newN} | Updated: ${updN} | Duplicate unchanged: ${skipN} | ${v.blocks}/96 blocks | ${v.energy.toFixed(3)} MWh`;

  renderDashboard(); renderBilling(); renderReports(); renderTrades();
  if(typeof render96BlockStudy==="function") render96BlockStudy(tradeDate);
  return {newN,updN,skipN,dates:[tradeDate],records,obligation};
}
function handleFileUpload(evt) {
  const file=evt.target.files[0];
  if(!file)return;
  const ext=file.name.split(".").pop().toLowerCase();
  if(ext==="pdf"){
    // Keep the existing PDF pipeline, but do not let it affect Excel Sheet1 validation.
    const reader=new FileReader();
    reader.onload=async e=>{
      try{
        const pdf=await pdfjsLib.getDocument(new Uint8Array(e.target.result)).promise;
        let text="";
        for(let i=1;i<=pdf.numPages;i++){
          const page=await pdf.getPage(i), c=await page.getTextContent();
          text+=c.items.map(x=>x.str).join(" ")+" ";
        }
        processExtractedText(text,null);
      }catch(err){alert("Error reading PDF file: "+err.message);}
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(new Uint8Array(e.target.result),{type:"array",cellDates:true});
      const forced=$("manualTradeDate")?.value||"";
      const r=importStrictSheet1(wb,forced);
      const uploadedDate = (r.dates && r.dates[0]) || forced;
      $("uploadStatusMsg").innerText=`Sheet1 only • ${r.dates.join(", ")}`;
      $("uploadStats").innerHTML=`New: ${r.newN} | Updated: ${r.updN} | Skipped duplicate: ${r.skipN}`;
      if($("uploadStatusMsg")) $("uploadStatusMsg").innerHTML += `<br><span class="text-[10px] text-slate-500">Sheet1 parsed using header-based detection.</span>`;
      $("uploadStatus").classList.remove("hidden");
      $("uploadFile").value="";

      // Automatically generate and download the daily settlement PDF report for the latest available date
      const shouldAuto = $("autoDownloadDailyPdfToggle") ? $("autoDownloadDailyPdfToggle").checked : true;
      if (shouldAuto) {
        setTimeout(() => {
          autoDownloadDailySettlementPDF(uploadedDate);
        }, 120);
      }
    }catch(err){
      alert("Sheet1 validation failed: "+err.message);
      $("uploadFile").value="";
    }
  };
  reader.readAsArrayBuffer(file);
}


// PERIOD / DATE-WISE EXCEL UPLOAD
function localISODate(d){
  const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return x.toISOString().slice(0,10);
}
function enumerateDates(start,end){
  const out=[];
  let d=new Date(start+"T00:00:00");
  const e=new Date(end+"T00:00:00");
  while(d<=e){ out.push(localISODate(d)); d.setDate(d.getDate()+1); }
  return out;
}
function preparePeriodUpload(){
  const s=$("periodStartDate").value, e=$("periodEndDate").value;
  if(!s||!e){ alert("Please select both Start Date and End Date."); return; }
  if(s>e){ alert("End Date cannot be earlier than Start Date."); return; }

  const dates=enumerateDates(s,e);
  const panel=$("periodUploadPanel"), box=$("dateUploadRows");
  $("periodUploadHelp").innerText=`Selected period: ${formatInvoiceDate(s)} to ${formatInvoiceDate(e)}. Upload one Excel file for each date.`;
  $("periodUploadCount").innerText=`${dates.length} date${dates.length>1?"s":""} selected`;

  box.innerHTML=dates.map((d,i)=>`
    <div class="flex flex-wrap items-center gap-3 p-3 rounded-xl border bg-slate-50" id="dateRow_${d}">
      <div class="w-28 font-extrabold text-slate-700 text-xs">${formatInvoiceDate(d)}</div>
      <input type="file" accept=".xls,.xlsx,.xlsm,.csv" id="dateFile_${d}" class="hidden"
             onchange="uploadPeriodDateFile('${d}',this)">
      <button onclick="document.getElementById('dateFile_${d}').click()" class="bg-white border border-blue-300 text-blue-700 font-bold px-3 py-2 rounded-lg text-xs">
        <i class="fa-solid fa-file-excel mr-1"></i> Select Excel
      </button>
      <span id="dateFileName_${d}" class="text-[10px] text-slate-500">No file selected</span>
      <span id="dateFileStatus_${d}" class="ml-auto text-[10px] font-bold text-slate-400">Pending</span>
    </div>`).join("");
  panel.classList.remove("hidden");
}
async function uploadPeriodDateFile(date,fileInput){
  const file=fileInput.files && fileInput.files[0];
  if(!file) return;
  const status=$("dateFileStatus_"+date), name=$("dateFileName_"+date);
  name.innerText=file.name;
  status.innerText="Processing…";
  status.className="ml-auto text-[10px] font-bold text-blue-600";

  try{
    const ext=file.name.split(".").pop().toLowerCase();
    if(ext==="pdf"){
      // For PDF, reuse the existing pipeline with the selected date override.
      const override=$("manualTradeDate");
      const old=override ? override.value : "";
      if(override) override.value=date;
      const reader=new FileReader();
      await new Promise((resolve,reject)=>{
        reader.onload=async e=>{
          try{
            const typedarray=new Uint8Array(e.target.result);
            const pdf=await pdfjsLib.getDocument(typedarray).promise;
            let fullText="";
            for(let i=1;i<=pdf.numPages;i++){
              const page=await pdf.getPage(i);
              const content=await page.getTextContent();
              fullText+=content.items.map(item=>item.str).join(" ")+" ";
            }
            processExtractedText(fullText,null);
            resolve();
          }catch(err){reject(err);}
        };
        reader.onerror=reject;
        reader.readAsArrayBuffer(file);
      });
      if(override) override.value=old;
    }else{
      const reader=new FileReader();
      await new Promise((resolve,reject)=>{
        reader.onload=e=>{
          try{
            const data=new Uint8Array(e.target.result);
            const workbook=XLSX.read(data,{type:"array"});
            const firstSheet=workbook.Sheets[workbook.SheetNames[0]];
            const jsonFlat=XLSX.utils.sheet_to_json(firstSheet);
            const rows2D=XLSX.utils.sheet_to_json(firstSheet,{header:1});
            const ok=processFlatData(jsonFlat,date);
            if(!ok){
              // Fallback for non-standard Excel layouts.
              const override=$("manualTradeDate");
              const old=override ? override.value : "";
              if(override) override.value=date;
              processExtractedText(rows2D.map(row=>row.join(" ")).join(" "),rows2D);
              if(override) override.value=old;
            }
            resolve();
          }catch(err){reject(err);}
        };
        reader.onerror=reject;
        reader.readAsArrayBuffer(file);
      });
    }

    status.innerText="✓ Uploaded";
    status.className="ml-auto text-[10px] font-bold text-emerald-600";
    const shouldAuto = $("autoDownloadDailyPdfToggle") ? $("autoDownloadDailyPdfToggle").checked : true;
    if (shouldAuto && typeof autoDownloadDailySettlementPDF === "function") {
      setTimeout(() => { autoDownloadDailySettlementPDF(date); }, 120);
    }
  }catch(err){
    console.error(err);
    status.innerText="✕ Failed";
    status.className="ml-auto text-[10px] font-bold text-rose-600";
    alert(`Upload failed for ${formatInvoiceDate(date)}: ${err.message||err}`);
  }finally{
    renderDashboard();
    if(typeof renderBilling==="function") renderBilling();
    if(typeof renderReports==="function") renderReports();
  }
}


function uploadDateISOToDisplay(d){
  const p=d.split("-");
  return p.length===3 ? `${p[2]}-${p[1]}-${p[0]}` : d;
}
function uploadDateList(start,end){
  const out=[];
  let d=new Date(start+"T00:00:00"), e=new Date(end+"T00:00:00");
  while(d<=e){
    const x=new Date(d.getTime()-d.getTimezoneOffset()*60000);
    out.push(x.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return out;
}
function createDateWiseUploadSlots(){
  const s=$("uploadStartDate").value, e=$("uploadEndDate").value;
  if(!s||!e){ alert("Start Date aur End Date dono select kijiye."); return; }
  if(s>e){ alert("End Date, Start Date se pehle nahi ho sakti."); return; }

  const dates=uploadDateList(s,e);
  const box=$("dateWiseUploadSlots");
  box.classList.remove("hidden");
  box.innerHTML=`
    <div class="flex items-center justify-between mb-3">
      <div>
        <div class="text-sm font-extrabold text-slate-800">Date-wise Excel Upload</div>
        <div class="text-[10px] text-slate-500">${uploadDateISOToDisplay(s)} → ${uploadDateISOToDisplay(e)} • ${dates.length} Excel files required</div>
      </div>
      <span class="text-[10px] font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded-full">${dates.length} Dates</span>
    </div>
    <div class="grid gap-2">
      ${dates.map((d,i)=>`
        <div id="periodRow_${d}" class="flex flex-wrap items-center gap-3 bg-white border border-slate-200 rounded-lg p-2.5">
          <div class="w-28 text-xs font-extrabold text-slate-700">${uploadDateISOToDisplay(d)}</div>
          <input id="periodFile_${d}" type="file" accept=".xls,.xlsx,.xlsm,.csv" class="hidden"
                 onchange="uploadOnePeriodExcel('${d}', this)">
          <button onclick="document.getElementById('periodFile_${d}').click()"
                  class="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-2 rounded-lg text-xs">
            <i class="fa-solid fa-file-excel mr-1"></i> Upload Excel
          </button>
          <span id="periodName_${d}" class="text-[10px] text-slate-500 flex-1">No file selected</span>
          <span id="periodStatus_${d}" class="text-[10px] font-bold text-slate-400">Pending</span>
        </div>`).join("")}
    </div>`;
}

function uploadOnePeriodExcel(date,input){
  const file=input.files && input.files[0];
  if(!file) return;

  const oldDate=$("manualTradeDate").value;
  const name=$("periodName_"+date), status=$("periodStatus_"+date), row=$("periodRow_"+date);
  name.textContent=file.name;
  status.textContent="Processing...";
  status.className="text-[10px] font-bold text-blue-600";

  // Existing uploader is reused, but the selected row date is forced as the
  // Trade Date Override so each file lands on the correct date.
  $("manualTradeDate").value=date;

  try{
    const dt=new DataTransfer();
    dt.items.add(file);
    $("uploadFile").files=dt.files;
    handleFileUpload({target:$("uploadFile")});

    setTimeout(()=>{
      status.textContent="✓ Uploaded";
      status.className="text-[10px] font-bold text-emerald-600";
      row.classList.add("bg-emerald-50");
      $("manualTradeDate").value=oldDate;
    },500);
  }catch(err){
    console.error(err);
    status.textContent="✕ Failed";
    status.className="text-[10px] font-bold text-rose-600";
    $("manualTradeDate").value=oldDate;
  }
}

// DASHBOARD
let mChartInstance = null;
let showMonthlyRevenue = true;

function toggleMonthlyRevenueVisibility() {
  showMonthlyRevenue = !showMonthlyRevenue;
  if (mChartInstance) {
    if (showMonthlyRevenue) {
      mChartInstance.show(1);
      if (mChartInstance.options.scales.y1) {
        mChartInstance.options.scales.y1.display = true;
      }
    } else {
      mChartInstance.hide(1);
      if (mChartInstance.options.scales.y1) {
        mChartInstance.options.scales.y1.display = false;
      }
    }
    mChartInstance.update();
  }
  updateRevenueToggleUI(showMonthlyRevenue);
}
window.toggleMonthlyRevenueVisibility = toggleMonthlyRevenueVisibility;

function updateRevenueToggleUI(visible) {
  const btn = $("toggleMonthlyRevenueBtn");
  const icon = $("toggleMonthlyRevenueIcon");
  const text = $("toggleMonthlyRevenueText");
  if (!btn) return;
  if (visible) {
    btn.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border shadow-2xs cursor-pointer bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100";
    if (icon) icon.className = "fa-solid fa-eye text-emerald-600";
    if (text) text.innerText = "Revenue Visible";
    btn.title = "Revenue dataset is shown. Click to hide Revenue and simplify view to energy output only.";
  } else {
    btn.className = "px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1.5 border shadow-2xs cursor-pointer bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200";
    if (icon) icon.className = "fa-solid fa-eye-slash text-slate-400";
    if (text) text.innerText = "Revenue Hidden (Energy Only)";
    btn.title = "Revenue dataset is hidden. Click to show Revenue dataset alongside energy.";
  }
}
window.updateRevenueToggleUI = updateRevenueToggleUI;

window.dashSeg = "ALL";
window.dashTxn = "ALL";

const segColorMap = {
  'ALL': 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md ring-2 ring-blue-300/80 font-extrabold',
  'G-DAM': 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md ring-2 ring-emerald-300/80 font-extrabold',
  'DAM': 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md ring-2 ring-cyan-300/80 font-extrabold',
  'TAM': 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md ring-2 ring-purple-300/80 font-extrabold',
  'RTM': 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md ring-2 ring-amber-300/80 font-extrabold'
};

const txnColorMap = {
  'ALL': 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-md ring-2 ring-slate-300/80 font-extrabold',
  'SELL': 'bg-gradient-to-r from-emerald-600 to-green-600 text-white shadow-md ring-2 ring-emerald-300/80 font-extrabold',
  'BUY': 'bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-md ring-2 ring-rose-300/80 font-extrabold'
};

function applySegButtonStyles(activeSeg) {
  document.querySelectorAll(".dash-seg-btn").forEach(b => {
    const s = b.getAttribute("data-seg") || (b.innerText.trim().toUpperCase().includes("ALL") ? "ALL" : b.innerText.trim());
    b.className = "dash-seg-btn px-3 py-1.5 rounded-lg text-xs transition-all duration-150 cursor-pointer select-none ";
    if (s === activeSeg) {
      const activeCls = segColorMap[s] || segColorMap['ALL'];
      b.className += activeCls + " active scale-105";
    } else {
      b.className += "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 font-semibold";
    }
  });
}

function applyTxnButtonStyles(activeTxn) {
  document.querySelectorAll(".dash-txn-btn").forEach(b => {
    const t = b.getAttribute("data-txn") || (b.innerText.trim().toUpperCase().includes("ALL") ? "ALL" : b.innerText.trim());
    b.className = "dash-txn-btn px-3.5 py-1.5 rounded-lg text-xs transition-all duration-150 cursor-pointer select-none ";
    if (t === activeTxn) {
      const activeCls = txnColorMap[t] || txnColorMap['ALL'];
      b.className += activeCls + " active scale-105";
    } else {
      b.className += "text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 font-semibold";
    }
  });
}

function setDashboardSeg(seg) {
  window.dashSeg = seg;
  applySegButtonStyles(seg);
  renderDashboard();
}

function setDashboardTxn(txn) {
  window.dashTxn = txn;
  applyTxnButtonStyles(txn);
  renderDashboard();
}

function renderDashboard() {
  applySegButtonStyles(window.dashSeg || "ALL");
  applyTxnButtonStyles(window.dashTxn || "ALL");
  let ts = sortedTrades();
  if (window.dashSeg && window.dashSeg !== "ALL") ts = ts.filter(t => (t.seg || "G-DAM") === window.dashSeg);
  if (window.dashTxn && window.dashTxn !== "ALL") ts = ts.filter(t => (t.txn || "SELL") === window.dashTxn);

  let totalQty = ts.reduce((s,t)=>s+qtyMwh(t),0), rev = ts.reduce((s,t)=>s+amount(t),0), avg = totalQty ? rev/totalQty : 0;
  
  // Calculate total deductions across all active dates
  let totalDed = 0;
  const uniqueDates = [...new Set(ts.map(t=>t.date))];
  uniqueDates.forEach(d => {
    let dayQ = ts.filter(t=>t.date===d).reduce((s,t)=>s+qtyMwh(t),0);
    let o = obFor(d);
    let grid = (Number(o.nldcApp)||0)+(Number(o.nldcSched||((o.nldcSchedBuy||0)+(o.nldcSchedSell||0)))||0)+(Number(o.ctu)||0)+(Number(o.stu)||0)+(Number(o.sldc)||0);
    let px = roundPrecise(dayQ * 1000 * pxRate * (1 + pxGst / 100));
    let nvvn = roundPrecise(dayQ * 1000 * nvvnRate * (1 + nvvnGst / 100));
    totalDed += (grid + px + nvvn);
  });
  let netRev = Math.max(0, rev - totalDed);
  let netTariff = totalQty > 0 ? netRev / (totalQty * 1000) : 0;
  let maxPeak = ts.reduce((mx, t) => Math.max(mx, Math.abs(t.qty || 0)), 0);

  $("kpis").innerHTML = [
    { t: "Traded Quantum", v: (totalQty/1000).toFixed(3)+" MU", sub: totalQty.toFixed(1)+" MWh scheduled", c: "blue", i: "fa-bolt" },
    { t: "Gross Market Value", v: money(rev), sub: "IEX Traded Gross", c: "emerald", i: "fa-indian-rupee-sign" },
    { t: "Net Realized Revenue", v: money(netRev), sub: "After All Deductions", c: "teal", i: "fa-sack-dollar" },
    { t: "Weighted Avg MCP", v: "₹"+avg.toFixed(2)+"/MWh", sub: "Volume-weighted MCP", c: "amber", i: "fa-scale-balanced" },
    { t: "Total Commercial Ded.", v: money(totalDed), sub: "Grid + PX + NVVN Margin", c: "rose", i: "fa-money-bill-transfer" },
    { t: "Realized Net Tariff", v: "₹"+netTariff.toFixed(3)+"/kWh", sub: "Effective Unit Inflow", c: "indigo", i: "fa-chart-line" },
    { t: "Active Trading Days", v: uniqueDates.length+" Days", sub: "Reconciled Delivery Days", c: "sky", i: "fa-calendar-check" },
    { t: "Peak Scheduled Output", v: maxPeak.toFixed(2)+" MW", sub: "Plant Cap: 11 MW", c: "amber", i: "fa-solar-panel" }
  ].map(x => `
    <div class="bg-white p-4 rounded-2xl shadow-sm flex items-center justify-between border border-slate-200/90 hover:border-blue-400 hover:shadow transition">
      <div>
        <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${x.t}</p>
        <h3 class="text-xl font-black text-slate-800 mt-0.5">${x.v}</h3>
        <p class="text-[10px] font-semibold text-slate-400 mt-0.5">${x.sub}</p>
      </div>
      <div class="w-10 h-10 rounded-xl bg-${x.c}-50 text-${x.c}-600 flex items-center justify-center text-lg shrink-0 border border-${x.c}-100">
        <i class="fa-solid ${x.i}"></i>
      </div>
    </div>
  `).join("");
  
  let a = months.map(m => {
    let x = ts.filter(t => monthKey(t.date) === m);
    let q = x.reduce((s, t) => s + qtyMwh(t), 0);
    let r = x.reduce((s, t) => s + amount(t), 0);
    return { m, q: q / 1000, r: r, w: q ? x.reduce((s, t) => s + qtyMwh(t) * t.mcp, 0) / q : 0 };
  });

  $("monthRows").innerHTML = a.filter(x => x.q > 0).map(x => {
    // Determine prior year corresponding month
    let yoyPill = `<span class="text-[10px] text-slate-400">-</span>`;
    const parts = x.m.split("-");
    if (parts.length === 2) {
      const priorMonthKey = `${parseInt(parts[0], 10) - 1}-${parts[1]}`;
      const priorMonthData = a.find(item => item.m === priorMonthKey);
      if (priorMonthData && priorMonthData.q > 0) {
        const delta = x.q - priorMonthData.q;
        const pct = ((delta / priorMonthData.q) * 100);
        const sign = delta >= 0 ? "+" : "";
        yoyPill = `<span class="px-2 py-0.5 rounded-full text-[10px] font-black ${delta >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
          ${sign}${delta.toFixed(3)} MU (${sign}${pct.toFixed(1)}%)
        </span>`;
      }
    }

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-2.5 font-bold text-slate-800 text-left">${mNames[x.m] || x.m}</td>
        <td class="p-2.5 font-semibold text-blue-700 text-right tabular-nums">${x.q.toFixed(3)}</td>
        <td class="p-2.5 font-bold text-emerald-700 text-right tabular-nums">${money(x.r)}</td>
        <td class="p-2.5 text-slate-600 text-right tabular-nums">₹ ${x.w.toFixed(2)}</td>
        <td class="p-2.5 text-center">${yoyPill}</td>
        <td class="p-2.5 text-center">
          <button onclick="openYoyForMonth('${x.m}')" class="px-2.5 py-1 rounded-lg bg-teal-50 hover:bg-teal-100 text-teal-800 font-bold text-[10px] border border-teal-200 transition cursor-pointer flex items-center gap-1 mx-auto" title="Open detailed YoY seasonal analysis for this month">
            <i class="fa-solid fa-code-compare text-teal-600"></i> Compare YoY
          </button>
        </td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="6" class="p-4 text-center text-slate-400">No data found.</td></tr>';
  
  if(mChartInstance) mChartInstance.destroy();
  const isRevVisible = showMonthlyRevenue !== false;
  mChartInstance = new Chart($("monthlyChart").getContext("2d"), {
    type: 'bar',
    data: {
      labels: a.map(x=>x.m),
      datasets: [
        { 
          label:'Quantum (MU)', 
          data:a.map(x=>x.q), 
          backgroundColor:'#1d4ed8', 
          borderRadius: 4 
        },
        { 
          label:'Revenue (₹)', 
          data:a.map(x=>x.r), 
          backgroundColor:'#059669', 
          borderRadius: 4, 
          yAxisID:'y1',
          hidden: !isRevVisible
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: {
          title: { display: true, text: 'Energy (MU)', font: { size: 10, weight: 'bold' } }
        },
        y1: {
          position: 'right',
          display: isRevVisible,
          grid: { drawOnChartArea: false },
          title: { display: isRevVisible, text: 'Revenue (₹)', font: { size: 10, weight: 'bold' } },
          ticks: {
            callback: function(v) { return '₹' + Number(v).toLocaleString('en-IN'); }
          }
        }
      },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            boxWidth: 12,
            font: { size: 11, weight: 'bold' },
            padding: 12,
            usePointStyle: true,
            pointStyle: 'circle'
          },
          onClick: function(e, legendItem, legend) {
            const index = legendItem.datasetIndex;
            const ci = legend.chart;
            if (ci.isDatasetVisible(index)) {
              ci.hide(index);
              legendItem.hidden = true;
            } else {
              ci.show(index);
              legendItem.hidden = false;
            }
            if (index === 1) {
              const visible = ci.isDatasetVisible(1);
              showMonthlyRevenue = visible;
              if (ci.options.scales.y1) {
                ci.options.scales.y1.display = visible;
              }
              updateRevenueToggleUI(visible);
            }
            ci.update();
          }
        },
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.dataset.yAxisID === 'y1') {
                return 'Revenue: ' + money(ctx.raw);
              }
              return 'Energy: ' + Number(ctx.raw).toFixed(3) + ' MU';
            }
          }
        }
      }
    }
  });
  updateRevenueToggleUI(isRevVisible);
}

// TRADES
function renderTrades() {
  let f=$("tFrom")?.value||"", t=$("tTo")?.value||"";
  let seg=$("tSeg")?.value||"ALL";
  let txn=$("tTxn")?.value||"ALL";
  let filtered = sortedTrades().filter(x => {
    if (f && x.date < f) return false;
    if (t && x.date > t) return false;
    if (seg !== "ALL" && (x.seg || "G-DAM") !== seg) return false;
    if (txn !== "ALL" && (x.txn || "SELL") !== txn) return false;
    return true;
  });

  const getSegBadge = s => {
    const map = {
      'G-DAM': 'bg-teal-100 text-teal-800 border border-teal-300',
      'DAM': 'bg-blue-100 text-blue-800 border border-blue-300',
      'TAM': 'bg-purple-100 text-purple-800 border border-purple-300',
      'RTM': 'bg-amber-100 text-amber-800 border border-amber-300'
    };
    const cls = map[s] || 'bg-slate-100 text-slate-800 border border-slate-300';
    return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${cls}">${s}</span>`;
  };

  const getTxnBadge = tx => {
    const cls = tx === 'SELL' ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-rose-100 text-rose-800 border border-rose-300';
    return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold ${cls}">${tx}</span>`;
  };

  $("tradeRows").innerHTML = filtered.map(x=>`
    <tr class="hover:bg-slate-50 font-medium">
      <td class="p-3 font-semibold">${x.date}</td>
      <td class="p-3 text-center font-bold text-slate-600">${x.block}</td>
      <td class="p-3 font-mono text-slate-500">${period(x.block)}</td>
      <td class="p-3 text-center">${getSegBadge(x.seg || 'G-DAM')}</td>
      <td class="p-3 text-center">${getTxnBadge(x.txn || 'SELL')}</td>
      <td class="p-3 font-bold">${Math.abs(x.qty).toFixed(3)}</td>
      <td class="p-3 text-blue-700 font-bold">${qtyMwh(x).toFixed(3)}</td>
      <td class="p-3">₹${x.mcp.toFixed(2)}</td>
      <td class="p-3 text-emerald-700 font-bold">₹${amount(x).toFixed(2)}</td>
    </tr>
  `).join("") || '<tr><td colspan="9" class="p-8 text-center text-slate-400">No trade blocks found matching the selected filters.</td></tr>';
}

function exportTrades() {
  let f=$("tFrom")?.value||"", t=$("tTo")?.value||"";
  let seg=$("tSeg")?.value||"ALL";
  let txn=$("tTxn")?.value||"ALL";
  let filtered = sortedTrades().filter(x => {
    if (f && x.date < f) return false;
    if (t && x.date > t) return false;
    if (seg !== "ALL" && (x.seg || "G-DAM") !== seg) return false;
    if (txn !== "ALL" && (x.txn || "SELL") !== txn) return false;
    return true;
  });

  let rows = [["Delivery Date","Block","Time Period","Market Segment","Transaction Type","Scheduled Qty (MW)","Scheduled Qty (MWh)","MCP (₹/MWh)","Traded Value (₹)"]];
  filtered.forEach(x => rows.push([
    x.date, x.block, period(x.block), x.seg || "G-DAM", x.txn || "SELL",
    Math.abs(x.qty).toFixed(3), qtyMwh(x).toFixed(3), x.mcp, amount(x).toFixed(2)
  ]));
  let wb = XLSX.utils.aoa_to_sheet(rows);
  let book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, wb, "Trades");
  XLSX.writeFile(book, `THDC_11MW_Trades_${seg}_${txn}.xlsx`);
}

// BILLING ENGINE
function obFor(d) {
  const o = state.obligations.find(x=>x.date===d);
  if (!o) return {
    nldcApp:0,nldcSched:0,ctu:0,nldcSchedBuy:0,nldcSchedSell:0,stu:0,distribution:0,other:0,sldc:0
  };
  return {
    date: o.date,
    nldcApp: Math.abs(Number(o.nldcApp)||0),
    nldcSched: Math.abs(Number(o.nldcSched)||0),
    ctu: Math.abs(Number(o.ctu)||0),
    nldcSchedBuy: Math.abs(Number(o.nldcSchedBuy)||0),
    nldcSchedSell: Math.abs(Number(o.nldcSchedSell)||0),
    stu: Math.abs(Number(o.stu)||0),
    distribution: Math.abs(Number(o.distribution)||0),
    other: Math.abs(Number(o.other)||0),
    sldc: Math.abs(Number(o.sldc)||0)
  };
}

function buildBillingRows() {
  const allDates=[...new Set(sortedTrades().map(x=>x.date))].sort();
  const bs=$('billingStartDate')?.value||'';
  const be=$('billingEndDate')?.value||'';
  const seg=$('billingMarketSeg')?.value||$('billingSegFilter')?.value||'ALL';
  const txn=$('billingTxnType')?.value||$('billingTxnFilter')?.value||'ALL';
  const from=bs||allDates[0]||'';
  const to=be||allDates[allDates.length-1]||'';
  const dates=allDates.filter(d=>(!from||d>=from)&&(!to||d<=to));
  const rows=[];
  dates.forEach((d,idx)=>{
    let a=sortedTrades().filter(x=>x.date===d);
    if(seg !== 'ALL') a=a.filter(x=>(x.seg||'G-DAM')===seg);
    if(txn !== 'ALL') a=a.filter(x=>(x.txn||'SELL')===txn);
    if(!a.length) return;
    const q=roundPrecise(a.reduce((s,x)=>s+qtyMwh(x),0));
    const tradeValue=roundPrecise(a.reduce((s,x)=>s+amount(x),0));
    const o=obFor(d);
    const corridor=roundPrecise(
      (Math.abs(Number(o.nldcApp))||0)+(Math.abs(Number(o.ctu))||0)+
      (Math.abs(Number(o.nldcSchedBuy))||0)+(Math.abs(Number(o.nldcSchedSell))||0)+
      (Math.abs(Number(o.stu))||0)+(Math.abs(Number(o.distribution))||0)+
      (Math.abs(Number(o.other))||0)+(Math.abs(Number(o.sldc))||0)
    );
    const pxFee=roundPrecise(q*1000*pxRate);
    const pxGstAmt=roundPrecise(pxFee*(pxGst/100));
    const powerExchangeNet=roundPrecise(tradeValue-corridor-pxFee-pxGstAmt);
    const nvvnMargin=roundPrecise(q*1000*nvvnRate);
    const nvvnGstAmt=roundPrecise(nvvnMargin*(nvvnGst/100));
    const nvvnNet=roundPrecise(powerExchangeNet-nvvnMargin-nvvnGstAmt);
    const rowSeg = a[0]?.seg || (seg !== 'ALL' ? seg : 'G-DAM');
    const rowTxn = a[0]?.txn || (txn !== 'ALL' ? txn : 'SELL');
    rows.push({sl:901+idx,date:d,txn:rowTxn,seg:rowSeg,q,tradeValue,corridor,pxFee,pxGst:pxGstAmt,powerExchangeNet,nvvnMargin,nvvnGst:nvvnGstAmt,nvvnNet});
  });
  return rows;
}

function formatInvoiceDate(d) {
  const p=d.split("-");
  return p.length===3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
}

function applyBillingPeriod() {
  const bs=$("billingStartDate")?.value||"";
  const be=$("billingEndDate")?.value||"";
  if(bs && be && bs>be){ alert("Billing End Date cannot be before Start Date."); return; }
  window.billingPeriod={start:bs,end:be};
  const note=$("billingPeriodStatus");
  if(note) note.textContent=`Applied: ${bs||"All"} → ${be||"All"}`;
  renderBilling();
}

function resetBillingPeriod() {
  const dates=[...new Set(sortedTrades().map(x=>x.date))].sort();
  if($('billingStartDate')) $('billingStartDate').value=dates[0]||'';
  if($('billingEndDate')) $('billingEndDate').value=dates[dates.length-1]||'';
  if($('billingMarketSeg')) $('billingMarketSeg').value='ALL';
  if($('billingSegFilter')) $('billingSegFilter').value='ALL';
  if($('billingTxnType')) $('billingTxnType').value='ALL';
  if($('billingTxnFilter')) $('billingTxnFilter').value='ALL';
  renderBilling();
}

// MONTHLY BILLING SUMMARY AGGREGATOR
function buildBillingMonthlySummary() {
  const allTrades = sortedTrades();
  if (!allTrades || !allTrades.length) return [];

  const seg = $('billingMarketSeg')?.value || $('billingSegFilter')?.value || 'ALL';
  const txn = $('billingTxnType')?.value || $('billingTxnFilter')?.value || 'ALL';

  const allDates = [...new Set(allTrades.map(x => x.date))].sort();
  if (!allDates.length) return [];

  const dailyRecords = [];
  allDates.forEach(d => {
    let a = allTrades.filter(x => x.date === d);
    if (seg !== 'ALL') a = a.filter(x => (x.seg || 'G-DAM') === seg);
    if (txn !== 'ALL') a = a.filter(x => (x.txn || 'SELL') === txn);
    if (!a.length) return;

    const q = roundPrecise(a.reduce((s, x) => s + qtyMwh(x), 0));
    const tradeValue = roundPrecise(a.reduce((s, x) => s + amount(x), 0));
    const o = obFor(d);
    const corridor = roundPrecise(
      (Math.abs(Number(o.nldcApp)) || 0) + (Math.abs(Number(o.ctu)) || 0) +
      (Math.abs(Number(o.nldcSchedBuy)) || 0) + (Math.abs(Number(o.nldcSchedSell)) || 0) +
      (Math.abs(Number(o.stu)) || 0) + (Math.abs(Number(o.distribution)) || 0) +
      (Math.abs(Number(o.other)) || 0) + (Math.abs(Number(o.sldc)) || 0)
    );
    const pxFee = roundPrecise(q * 1000 * pxRate);
    const pxGstAmt = roundPrecise(pxFee * (pxGst / 100));
    const powerExchangeNet = roundPrecise(tradeValue - corridor - pxFee - pxGstAmt);
    const nvvnMargin = roundPrecise(q * 1000 * nvvnRate);
    const nvvnGstAmt = roundPrecise(nvvnMargin * (nvvnGst / 100));
    const nvvnNet = roundPrecise(powerExchangeNet - nvvnMargin - nvvnGstAmt);
    const deductions = roundPrecise(corridor + pxFee + pxGstAmt + nvvnMargin + nvvnGstAmt);

    dailyRecords.push({
      date: d,
      monthKey: d.slice(0, 7),
      q,
      tradeValue,
      corridor,
      pxFee,
      pxGst: pxGstAmt,
      powerExchangeNet,
      nvvnMargin,
      nvvnGst: nvvnGstAmt,
      nvvnNet,
      totalDeductions: deductions
    });
  });

  if (!dailyRecords.length) return [];

  const monthMap = {};
  const monthNamesFull = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthNamesShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  dailyRecords.forEach(r => {
    if (!monthMap[r.monthKey]) {
      const [yr, mo] = r.monthKey.split("-");
      const mIdx = parseInt(mo, 10) - 1;
      monthMap[r.monthKey] = {
        monthKey: r.monthKey,
        year: yr,
        monthIndex: mIdx,
        monthLabel: `${monthNamesFull[mIdx]} ${yr}`,
        shortLabel: `${monthNamesShort[mIdx]} ${yr}`,
        dates: [],
        days: 0,
        q: 0,
        tradeValue: 0,
        corridor: 0,
        pxFee: 0,
        pxGst: 0,
        powerExchangeNet: 0,
        nvvnMargin: 0,
        nvvnGst: 0,
        netRevenue: 0,
        totalDeductions: 0
      };
    }
    const m = monthMap[r.monthKey];
    m.dates.push(r.date);
    m.days += 1;
    m.q += r.q;
    m.tradeValue += r.tradeValue;
    m.corridor += r.corridor;
    m.pxFee += r.pxFee;
    m.pxGst += r.pxGst;
    m.powerExchangeNet += r.powerExchangeNet;
    m.nvvnMargin += r.nvvnMargin;
    m.nvvnGst += r.nvvnGst;
    m.netRevenue += r.nvvnNet;
    m.totalDeductions += r.totalDeductions;
  });

  const sortedMonths = Object.values(monthMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey));

  // Determine active month in current session
  const activeStart = $('billingStartDate')?.value || '';
  const activeEnd = $('billingEndDate')?.value || '';
  let activeMonthKey = '';
  if (activeEnd && monthMap[activeEnd.slice(0, 7)]) {
    activeMonthKey = activeEnd.slice(0, 7);
  } else if (activeStart && monthMap[activeStart.slice(0, 7)]) {
    activeMonthKey = activeStart.slice(0, 7);
  }
  if (!activeMonthKey || !monthMap[activeMonthKey]) {
    activeMonthKey = sortedMonths[sortedMonths.length - 1].monthKey;
  }

  const totalNetAll = sortedMonths.reduce((s, x) => s + x.netRevenue, 0);
  const meanMonthlyNet = sortedMonths.length ? (totalNetAll / sortedMonths.length) : 0;

  const getSeasonalInfo = (mIdx) => {
    // 0=Jan, 1=Feb, 2=Mar, 3=Apr, 4=May, 5=Jun, 6=Jul, 7=Aug, 8=Sep, 9=Oct, 10=Nov, 11=Dec
    if (mIdx >= 2 && mIdx <= 5) {
      return { category: "Summer Peak", color: "amber", icon: "fa-sun", badgeBg: "bg-amber-100 text-amber-900 border-amber-300" };
    } else if (mIdx >= 6 && mIdx <= 8) {
      return { category: "Monsoon Lean", color: "sky", icon: "fa-cloud-showers-heavy", badgeBg: "bg-sky-100 text-sky-900 border-sky-300" };
    } else if (mIdx >= 9 && mIdx <= 10) {
      return { category: "Post-Monsoon", color: "teal", icon: "fa-cloud-sun", badgeBg: "bg-teal-100 text-teal-900 border-teal-300" };
    } else {
      return { category: "Winter Lean", color: "indigo", icon: "fa-snowflake", badgeBg: "bg-indigo-100 text-indigo-900 border-indigo-300" };
    }
  };

  return sortedMonths.map((m, idx) => {
    const qRound = roundPrecise(m.q);
    const tradeRound = roundPrecise(m.tradeValue);
    const dedRound = roundPrecise(m.totalDeductions);
    const netRound = roundPrecise(m.netRevenue);
    const mu = qRound / 1000;
    const effectiveTariff = qRound > 0 ? (netRound / (qRound * 1000)) : 0;
    const avgDailyNet = m.days > 0 ? (netRound / m.days) : 0;

    let momDiff = null;
    let momPct = null;
    if (idx > 0) {
      const prev = sortedMonths[idx - 1];
      momDiff = roundPrecise(netRound - prev.netRevenue);
      momPct = prev.netRevenue !== 0 ? ((momDiff / Math.abs(prev.netRevenue)) * 100) : 0;
    }

    const seasonalVarPct = meanMonthlyNet > 0 ? (((netRound - meanMonthlyNet) / meanMonthlyNet) * 100) : 0;
    const seasonInfo = getSeasonalInfo(m.monthIndex);
    const isCurrent = m.monthKey === activeMonthKey;

    return {
      monthKey: m.monthKey,
      monthLabel: m.monthLabel,
      shortLabel: m.shortLabel,
      isCurrentMonth: isCurrent,
      dates: m.dates,
      days: m.days,
      q: qRound,
      mu,
      tradeValue: tradeRound,
      totalDeductions: dedRound,
      corridor: roundPrecise(m.corridor),
      pxFee: roundPrecise(m.pxFee),
      pxGst: roundPrecise(m.pxGst),
      nvvnMargin: roundPrecise(m.nvvnMargin),
      nvvnGst: roundPrecise(m.nvvnGst),
      powerExchangeNet: roundPrecise(m.powerExchangeNet),
      netRevenue: netRound,
      effectiveTariff,
      avgDailyNet: roundPrecise(avgDailyNet),
      momDiff,
      momPct,
      seasonalVarPct,
      seasonCategory: seasonInfo.category,
      seasonColor: seasonInfo.color,
      seasonIcon: seasonInfo.icon,
      badgeBg: seasonInfo.badgeBg
    };
  });
}

function filterBillingByMonth(mKey) {
  const summary = buildBillingMonthlySummary();
  const target = summary.find(x => x.monthKey === mKey);
  if (!target || !target.dates.length) return;
  const sortedDates = [...target.dates].sort();
  if ($('billingStartDate')) $('billingStartDate').value = sortedDates[0];
  if ($('billingEndDate')) $('billingEndDate').value = sortedDates[sortedDates.length - 1];
  renderBilling();
  const annexureEl = document.getElementById('billingTable');
  if (annexureEl) {
    annexureEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderBillingSummary() {
  const summaryRows = buildBillingMonthlySummary();
  const summaryTable = $("billingSummaryRows");
  const summaryFoot = $("billingSummaryFoot");
  const seasonalBanner = $("billingSeasonalBanner");

  if (!summaryRows.length) {
    if (summaryTable) {
      summaryTable.innerHTML = '<tr><td colspan="13" class="p-8 text-center text-slate-400 font-medium">No trade or billing data found. Upload trades in the Trade Entry tab to view the monthly billing comparison.</td></tr>';
    }
    if (summaryFoot) summaryFoot.innerHTML = '';
    if (seasonalBanner) {
      seasonalBanner.innerHTML = `
        <div class="p-4 text-center text-slate-500 text-xs font-medium">
          <i class="fa-solid fa-chart-line text-blue-500 mr-1.5"></i>
          Upload 96-block trade files or historical invoices to unlock Month-over-Month (MoM) Net Realized Revenue comparisons and seasonal solar performance tracking.
        </div>`;
    }
    return;
  }

  const currentMonth = summaryRows.find(x => x.isCurrentMonth) || summaryRows[summaryRows.length - 1];
  const currIdx = summaryRows.findIndex(x => x.monthKey === currentMonth.monthKey);
  const prevMonth = currIdx > 0 ? summaryRows[currIdx - 1] : null;

  if (seasonalBanner) {
    let varianceCardContent = '';
    let insightText = '';

    if (prevMonth) {
      const diff = currentMonth.netRevenue - prevMonth.netRevenue;
      const pct = prevMonth.netRevenue !== 0 ? ((diff / Math.abs(prevMonth.netRevenue)) * 100) : 0;
      const isUp = diff >= 0;
      const diffSign = isUp ? '+' : '';
      const colorCls = isUp ? 'text-emerald-700 bg-emerald-50 border-emerald-300' : 'text-rose-700 bg-rose-50 border-rose-300';
      const iconCls = isUp ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';

      varianceCardContent = `
        <div class="flex items-center gap-2 mt-1">
          <span class="px-2.5 py-1 rounded-lg border font-black text-xs flex items-center gap-1.5 ${colorCls}">
            <i class="fa-solid ${iconCls}"></i>
            ${isUp ? '+' : ''}${money(Math.abs(diff))} (${isUp ? '+' : ''}${pct.toFixed(1)}%)
          </span>
        </div>
        <div class="text-[10px] text-slate-500 mt-1.5">vs Preceding ${prevMonth.monthLabel}</div>
      `;

      if (isUp) {
        insightText = `Current month (<strong>${currentMonth.monthLabel}</strong>) Net Realized Revenue expanded by <strong class="text-emerald-700">${money(diff)} (+${pct.toFixed(1)}%)</strong> over ${prevMonth.monthLabel}. This upward swing aligns with favorable solar insolation, higher clear-sky irradiation, and improved market clearing prices on the power exchange.`;
      } else {
        insightText = `Current month (<strong>${currentMonth.monthLabel}</strong>) Net Realized Revenue reflects a seasonal moderation of <strong class="text-rose-700">${money(Math.abs(diff))} (${pct.toFixed(1)}%)</strong> compared to ${prevMonth.monthLabel}, typical of solar seasonality during cloud cover / monsoon attenuation or lower winter solar elevation.`;
      }
    } else {
      varianceCardContent = `
        <div class="mt-1">
          <span class="px-2.5 py-1 rounded-lg border font-bold text-xs bg-slate-100 text-slate-700 border-slate-300 inline-block">
            Initial Operational Baseline
          </span>
        </div>
        <div class="text-[10px] text-slate-500 mt-1.5">First recorded period in active ledger</div>
      `;
      insightText = `Current active period (<strong>${currentMonth.monthLabel}</strong>) represents the primary baseline in the ledger. When additional operating months are recorded, automatic Month-over-Month (MoM) variance and seasonal comparison curves will display here.`;
    }

    seasonalBanner.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div class="flex items-center justify-between text-[10px] uppercase font-bold text-slate-500">
            <span>Current Month</span>
            <span class="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 text-[9px] font-black">Active Focus</span>
          </div>
          <div class="text-sm font-black text-slate-900 mt-1">${currentMonth.monthLabel}</div>
          <div class="text-base font-black text-emerald-700 mt-0.5">${money(currentMonth.netRevenue)}</div>
          <div class="text-[10px] text-slate-500 mt-0.5 font-medium">${currentMonth.mu.toFixed(3)} MU • Tariff: ₹${currentMonth.effectiveTariff.toFixed(3)}/kWh</div>
        </div>

        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div class="flex items-center justify-between text-[10px] uppercase font-bold text-slate-500">
            <span>Preceding Month</span>
            <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-bold">Comparison</span>
          </div>
          <div class="text-sm font-black text-slate-800 mt-1">${prevMonth ? prevMonth.monthLabel : '— Baseline'}</div>
          <div class="text-base font-black text-slate-800 mt-0.5">${prevMonth ? money(prevMonth.netRevenue) : '—'}</div>
          <div class="text-[10px] text-slate-500 mt-0.5 font-medium">${prevMonth ? `${prevMonth.mu.toFixed(3)} MU • Tariff: ₹${prevMonth.effectiveTariff.toFixed(3)}/kWh` : 'No prior month loaded'}</div>
        </div>

        <div class="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
          <div class="text-[10px] uppercase font-bold text-slate-500">MoM Revenue Variance</div>
          ${varianceCardContent}
          <div class="text-[10px] text-slate-500 mt-1 font-medium">Daily Net Avg: <strong class="text-slate-800">${money(currentMonth.avgDailyNet)}/day</strong></div>
        </div>

        <div class="bg-blue-50/80 p-3.5 rounded-xl border border-blue-200 shadow-xs">
          <div class="flex items-center gap-1.5 text-[10px] uppercase font-bold text-blue-900">
            <i class="fa-solid fa-cloud-sun text-amber-600"></i> Seasonal Performance Note
          </div>
          <p class="text-xs text-slate-700 mt-1 leading-relaxed">${insightText}</p>
        </div>
      </div>
    `;
  }

  if (summaryTable) {
    summaryTable.innerHTML = summaryRows.map(x => {
      let momDisplay = '';
      if (x.momDiff === null) {
        momDisplay = '<span class="text-slate-400 font-medium text-[10px]">— Baseline</span>';
      } else {
        const isUp = x.momDiff >= 0;
        const sign = isUp ? '+' : '';
        const cls = isUp ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold';
        const icon = isUp ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
        momDisplay = `<span class="${cls}"><i class="fa-solid ${icon} text-[9px] mr-1"></i>${sign}${money(Math.abs(x.momDiff))} <span class="text-[10px] font-semibold">(${sign}${x.momPct.toFixed(1)}%)</span></span>`;
      }

      let seasonVarDisplay = '';
      if (x.seasonalVarPct > 0) {
        seasonVarDisplay = `<span class="text-emerald-700 font-bold">+${x.seasonalVarPct.toFixed(1)}% <span class="text-[9px] text-slate-500 font-normal">vs Avg</span></span>`;
      } else if (x.seasonalVarPct < 0) {
        seasonVarDisplay = `<span class="text-rose-700 font-bold">${x.seasonalVarPct.toFixed(1)}% <span class="text-[9px] text-slate-500 font-normal">vs Avg</span></span>`;
      } else {
        seasonVarDisplay = `<span class="text-slate-500 font-bold">Par Avg</span>`;
      }

      const rowHighlight = x.isCurrentMonth ? 'bg-blue-50/50 font-semibold' : 'hover:bg-slate-50';
      const timelineBadge = x.isCurrentMonth
        ? '<span class="px-2 py-0.5 rounded text-[10px] font-black bg-blue-700 text-white shadow-2xs">Current Month</span>'
        : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">Previous</span>';

      return `
        <tr class="${rowHighlight} border-b border-slate-100 transition">
          <td class="p-2.5 border text-left font-black text-slate-900">${x.monthLabel}</td>
          <td class="p-2.5 border text-center">${timelineBadge}</td>
          <td class="p-2.5 border text-center">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-extrabold border ${x.badgeBg}">
              <i class="fa-solid ${x.seasonIcon}"></i> ${x.seasonCategory}
            </span>
          </td>
          <td class="p-2.5 border text-center font-bold text-slate-700">${x.days}</td>
          <td class="p-2.5 border font-bold text-blue-700">${x.mu.toFixed(3)} MU <span class="text-[9px] text-slate-400 font-normal">(${x.q.toFixed(2)} MWh)</span></td>
          <td class="p-2.5 border text-slate-800">${money(x.tradeValue)}</td>
          <td class="p-2.5 border text-rose-700 font-medium">${money(x.totalDeductions)}</td>
          <td class="p-2.5 border font-black text-emerald-800 bg-emerald-50/70">${money(x.netRevenue)}</td>
          <td class="p-2.5 border font-bold text-indigo-700">₹${x.effectiveTariff.toFixed(3)}/kWh</td>
          <td class="p-2.5 border font-medium text-slate-700">${money(x.avgDailyNet)}</td>
          <td class="p-2.5 border text-center">${momDisplay}</td>
          <td class="p-2.5 border text-center">${seasonVarDisplay}</td>
          <td class="p-2.5 border text-center">
            <button onclick="filterBillingByMonth('${x.monthKey}')" class="bg-white hover:bg-blue-50 text-blue-700 border border-blue-300 px-2 py-1 rounded text-[10px] font-bold shadow-2xs transition inline-flex items-center gap-1">
              <i class="fa-solid fa-table-list"></i> Annexure 1
            </button>
          </td>
        </tr>
      `;
    }).join("");
  }

  if (summaryFoot) {
    const totDays = summaryRows.reduce((s, x) => s + x.days, 0);
    const totQ = summaryRows.reduce((s, x) => s + x.q, 0);
    const totMu = totQ / 1000;
    const totTrade = summaryRows.reduce((s, x) => s + x.tradeValue, 0);
    const totDeds = summaryRows.reduce((s, x) => s + x.totalDeductions, 0);
    const totNet = summaryRows.reduce((s, x) => s + x.netRevenue, 0);
    const avgMonthlyRev = totNet / summaryRows.length;
    const overallTariff = totQ > 0 ? (totNet / (totQ * 1000)) : 0;

    summaryFoot.innerHTML = `
      <tr class="bg-slate-100 font-black text-slate-900 border-t-2 border-slate-300">
        <td class="p-2.5 border text-left uppercase">Portfolio Total (${summaryRows.length} Operational Months)</td>
        <td class="p-2.5 border text-center text-[10px] text-slate-500">—</td>
        <td class="p-2.5 border text-center text-[10px] text-slate-500">All Seasons</td>
        <td class="p-2.5 border text-center">${totDays}</td>
        <td class="p-2.5 border text-blue-900 font-black">${totMu.toFixed(3)} MU</td>
        <td class="p-2.5 border">${money(totTrade)}</td>
        <td class="p-2.5 border text-rose-800">${money(totDeds)}</td>
        <td class="p-2.5 border bg-emerald-100 text-emerald-950 font-black">${money(totNet)}</td>
        <td class="p-2.5 border text-indigo-900 font-black">₹${overallTariff.toFixed(3)}/kWh</td>
        <td class="p-2.5 border text-[10px] text-slate-700 font-bold">Avg ${money(avgMonthlyRev)}/mo</td>
        <td class="p-2.5 border text-center text-[10px] text-slate-500">—</td>
        <td class="p-2.5 border text-center text-[10px] text-slate-500">100% Baseline</td>
        <td class="p-2.5 border text-center">
          <button onclick="resetBillingPeriod()" class="text-[10px] font-bold text-slate-600 hover:text-slate-900 underline">
            Reset All
          </button>
        </td>
      </tr>
    `;
  }
}

function exportBillingSummaryExcel() {
  const summaryRows = buildBillingMonthlySummary();
  if (!summaryRows.length) {
    alert("No monthly billing data available to export.");
    return;
  }
  const segVal = $('billingMarketSeg')?.value || $('billingSegFilter')?.value || 'ALL';
  const txnVal = $('billingTxnType')?.value || $('billingTxnFilter')?.value || 'ALL';

  const aoa = [
    ["THDC INDIA LIMITED — 11 MW Khurja Floating Solar Power Plant"],
    ["Billing Summary — Monthly Net Realized Revenue & Seasonal Performance Comparison"],
    [`Portfolio: N2UP0NVN0289`, `Market Segment: ${segVal}`, `Txn Type: ${txnVal}`, `Generated On: ${new Date().toLocaleString('en-IN')}`],
    [],
    [
      "Operational Month",
      "Timeline Role",
      "Seasonal Phase",
      "Active Days",
      "Energy Quantum (MU)",
      "Energy Quantum (MWh)",
      "Gross Trade Value (₹)",
      "Commercial Deductions (₹)",
      "Net Realized Revenue (₹)",
      "Effective Net Tariff (₹/kWh)",
      "Avg Daily Net Revenue (₹/day)",
      "MoM Difference (₹)",
      "MoM Growth (%)",
      "Seasonal Var vs Mean (%)"
    ],
    ...summaryRows.map(x => [
      x.monthLabel,
      x.isCurrentMonth ? "Current Month" : "Previous Month",
      x.seasonCategory,
      x.days,
      Number(x.mu.toFixed(4)),
      Number(x.q.toFixed(4)),
      x.tradeValue,
      x.totalDeductions,
      x.netRevenue,
      Number(x.effectiveTariff.toFixed(4)),
      x.avgDailyNet,
      x.momDiff !== null ? x.momDiff : 0,
      x.momPct !== null ? Number(x.momPct.toFixed(2)) : 0,
      Number(x.seasonalVarPct.toFixed(2))
    ])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 18 },
    { wch: 18 }, { wch: 22 }, { wch: 24 }, { wch: 24 }, { wch: 26 },
    { wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 22 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Billing_Summary");
  XLSX.writeFile(wb, `THDC_11MW_Billing_Summary_Monthly_Comparison_${segVal}_${txnVal}.xlsx`);
}

// THDCIL OFFICIAL LOGO CACHE FOR REPORTS & INVOICES
let thdcilLogoDataUrl = typeof window !== "undefined" && window.THDC_LOGO_BASE64 ? window.THDC_LOGO_BASE64 : null;
function initThdcilLogo() {
  if (typeof window !== "undefined" && window.THDC_LOGO_BASE64) {
    thdcilLogoDataUrl = window.THDC_LOGO_BASE64;
    return;
  }
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function() {
    try {
      const cv = document.createElement("canvas");
      cv.width = 1571;
      cv.height = 379;
      const ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0, 1571, 379);
      thdcilLogoDataUrl = cv.toDataURL("image/png");
    } catch(e) {
      console.warn("Logo canvas toDataURL error:", e);
    }
  };
  img.src = "thdc_logo.png";
}
initThdcilLogo();

function exportBillingSummaryPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("landscape", "mm", "a4");

  const summaryRows = typeof buildBillingMonthlySummary === "function" ? buildBillingMonthlySummary() : [];
  if (!summaryRows || !summaryRows.length) {
    alert("No monthly billing data available to export.");
    return;
  }

  const segVal = $('billingMarketSeg')?.value || $('billingSegFilter')?.value || 'ALL';
  const txnVal = $('billingTxnType')?.value || $('billingTxnFilter')?.value || 'ALL';

  // 1. Corporate Header with Official THDC India Limited Logo (True aspect ratio 4.145:1)
  const logo = (typeof window !== "undefined" && window.THDC_LOGO_BASE64) || thdcilLogoDataUrl;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", 12, 8, 53.9, 13);
    } catch (e) {
      console.warn("Logo render error in PDF:", e);
    }
  }

  doc.setFontSize(12);
  doc.setTextColor(15, 43, 92);
  doc.setFont('helvetica', 'bold');
  doc.text("THDC INDIA LIMITED", 70, 13);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text("A Schedule 'A' Mini Ratna CPSU • Govt. of India Enterprise | Portfolio: N2UP0NVN0289", 70, 17);
  doc.text("11 MW Khurja Floating Solar Power Plant • Monthly Billing Summary & Seasonal Comparison", 70, 21);

  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text("Ref: THDC/11MW/COMM/BILL-SUMM/" + new Date().getFullYear(), 285, 12, { align: "right" });
  doc.text("Date Generated: " + new Date().toLocaleDateString('en-IN'), 285, 16, { align: "right" });
  doc.text("Market Seg: " + segVal + " | Txn: " + txnVal, 285, 20, { align: "right" });
  doc.text("Tariff Benchmark: Rs. 3.150/kWh", 285, 24, { align: "right" });

  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(12, 26, 285, 26);

  // 2. Executive Stat Strip
  const totDays = summaryRows.reduce((s, x) => s + x.days, 0);
  const totMu = summaryRows.reduce((s, x) => s + x.mu, 0);
  const totQ = summaryRows.reduce((s, x) => s + x.q, 0);
  const totTrade = summaryRows.reduce((s, x) => s + x.tradeValue, 0);
  const totDeds = summaryRows.reduce((s, x) => s + x.totalDeductions, 0);
  const totNet = summaryRows.reduce((s, x) => s + x.netRevenue, 0);
  const overallTariff = totQ > 0 ? (totNet / (totQ * 1000)) : 0;
  const avgMonthlyRev = summaryRows.length > 0 ? (totNet / summaryRows.length) : 0;

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(12, 28, 273, 9.5, 1.5, 1.5, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(12, 28, 273, 9.5, 1.5, 1.5, 'S');

  doc.setFontSize(7.2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text("Operational Months: " + summaryRows.length + " (" + totDays + " Days)", 15, 34.2);
  doc.text("Delivered Energy: " + totMu.toFixed(3) + " MU (" + totQ.toLocaleString('en-IN', {maximumFractionDigits:1}) + " MWh)", 70, 34.2);
  doc.text("Gross Trade: Rs. " + formatIndianCurrency(totTrade) + " | Deductions: Rs. " + formatIndianCurrency(totDeds), 140, 34.2);
  doc.setTextColor(5, 120, 85);
  doc.text("Net Realized: Rs. " + formatIndianCurrency(totNet) + " (Tariff: Rs. " + overallTariff.toFixed(3) + "/kWh)", 216, 34.2);

  // 3. Clean Structured Table
  const head = [[
    "Operational Month",
    "Role",
    "Seasonal Profile",
    "Days",
    "Energy (MU)",
    "Energy (MWh)",
    "Gross Trade (Rs.)",
    "Deductions (Rs.)",
    "Net Realized Revenue (Rs.)",
    "Net Tariff (Rs./kWh)",
    "Avg Daily Net (Rs./d)",
    "MoM Growth",
    "Seasonal Var"
  ]];

  const body = summaryRows.map(x => [
    x.monthLabel,
    x.isCurrentMonth ? "Active Focus" : "Historical",
    x.seasonCategory,
    String(x.days),
    x.mu.toFixed(3),
    x.q.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    formatIndianCurrency(x.tradeValue),
    formatIndianCurrency(x.totalDeductions),
    formatIndianCurrency(x.netRevenue),
    x.effectiveTariff.toFixed(3),
    formatIndianCurrency(x.avgDailyNet),
    x.momPct !== null ? ((x.momPct >= 0 ? "+" : "") + x.momPct.toFixed(1) + "%") : "-",
    (x.seasonalVarPct >= 0 ? "+" : "") + x.seasonalVarPct.toFixed(1) + "% vs avg"
  ]);

  const foot = [[
    "Portfolio Total",
    "-",
    "All Seasons",
    String(totDays),
    totMu.toFixed(3),
    totQ.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    formatIndianCurrency(totTrade),
    formatIndianCurrency(totDeds),
    formatIndianCurrency(totNet),
    overallTariff.toFixed(3),
    formatIndianCurrency(avgMonthlyRev) + "/mo",
    "-",
    "100% Base"
  ]];

  doc.autoTable({
    head: head,
    body: body,
    foot: foot,
    startY: 40.5,
    theme: "grid",
    styles: { fontSize: 6.8, cellPadding: 2, halign: "right", textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 43, 92], textColor: 255, fontSize: 7, fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { halign: "left", fontStyle: "bold" },
      1: { halign: "center" },
      2: { halign: "left" },
      3: { halign: "center" },
      8: { halign: "right", fontStyle: "bold", textColor: [5, 120, 85] },
      9: { halign: "right", fontStyle: "bold" },
      11: { halign: "center" },
      12: { halign: "center" }
    },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 7 },
    didDrawPage: function(data) {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7);
      doc.setTextColor(148, 163, 184);
      doc.text("THDC India Limited • 11 MW Khurja Floating Solar Power Plant • Official Commercial Settlement Record", 12, 203);
      doc.text("Page " + data.pageNumber + " of " + pageCount, 285, 203, { align: "right" });
    }
  });

  // 4. Commercial Analysis & Sign-off Block (Mukul Singh)
  let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 160;
  if (finalY > 155) {
    doc.addPage();
    finalY = 20;
  }
  const sigY = finalY + 8;
  const boxW = 120;
  const boxH = 26;
  const boxX = 165;

  // Left Context Details
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("COMMERCIAL ANALYSIS & RECONCILIATION RECORD", 12, sigY + 5);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text("• Plant Facility: 11 MW Khurja Floating Solar Power Plant (Khurja STPP, UP)", 12, sigY + 10);
  doc.text("• Commercial Analysis: Reconciled for energy trading, billing, and settlement analysis.", 12, sigY + 14);
  doc.text("• Department: Commercial - Power Trading Department, THDCIL, Rishikesh", 12, sigY + 18);
  doc.text("• Source: Reconciled from IEX Daily Settlement & NVVN Obligation statements.", 12, sigY + 22);

  // Right Sign-off Box
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.rect(boxX, sigY, boxW, boxH, 'S');
  doc.setLineDashPattern([], 0);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text("COMMERCIAL ANALYSIS & RECONCILIATION", boxX + 4, sigY + 4.5);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, boxX + boxW - 4, sigY + 4.5, { align: 'right' });

  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(boxX + 4, sigY + 11.5, boxX + boxW - 4, sigY + 11.5);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text("(Physical Signature)", boxX + boxW - 4, sigY + 10.5, { align: 'right' });

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text("Mukul Singh", boxX + 4, sigY + 16);
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text("Assistant Manager (Commercial - Power Trading)", boxX + 4, sigY + 19.8);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("Commercial - Power Trading Department, THDCIL, Rishikesh", boxX + 4, sigY + 23.5);

  doc.save("THDC_11MW_Billing_Summary_Monthly_Comparison.pdf");
}

function renderBilling() {
  $("nvvnRateInput").value=nvvnRate;
  $("nvvnGstRateInput").value=nvvnGst;
  $("pxRateInput").value=pxRate;
  $("pxGstRateInput").value=pxGst;

  // Render Monthly Billing Summary & Seasonal Comparison
  renderBillingSummary();

  const allDates=[...new Set(sortedTrades().map(x=>x.date))].sort();
  const bs=$('billingStartDate'), be=$('billingEndDate');
  if(bs && !bs.value && allDates.length) bs.value=allDates[0];
  if(be && !be.value && allDates.length) be.value=allDates[allDates.length-1];

  const rows=buildBillingRows();
  const segVal=$('billingMarketSeg')?.value||$('billingSegFilter')?.value||'ALL';
  const txnVal=$('billingTxnType')?.value||$('billingTxnFilter')?.value||'ALL';
  const rangeMsg=$('billingRangeMsg');
  if(rangeMsg) {
    let msg = (bs?.value&&be?.value)?`Annexure period: ${formatInvoiceDate(bs.value)} to ${formatInvoiceDate(be.value)}`:'All loaded dates';
    if(segVal !== 'ALL') msg += ` • Segment: ${segVal}`;
    if(txnVal !== 'ALL') msg += ` • Txn: ${txnVal}`;
    rangeMsg.textContent = msg;
  }

  if(!rows.length){
    $("billRows").innerHTML='<tr><td colspan="13" class="p-8 text-center text-slate-400">No billing data found for selected period and filters.</td></tr>';
    $("billFoot").innerHTML="";
    $("billKpis").innerHTML="";
    return;
  }

  const totals=rows.reduce((s,x)=>({
    q:s.q+x.q,tradeValue:s.tradeValue+x.tradeValue,corridor:s.corridor+x.corridor,
    pxFee:s.pxFee+x.pxFee,pxGst:s.pxGst+x.pxGst,powerExchangeNet:s.powerExchangeNet+x.powerExchangeNet,
    nvvnMargin:s.nvvnMargin+x.nvvnMargin,nvvnGst:s.nvvnGst+x.nvvnGst,nvvnNet:s.nvvnNet+x.nvvnNet
  }),{q:0,tradeValue:0,corridor:0,pxFee:0,pxGst:0,powerExchangeNet:0,nvvnMargin:0,nvvnGst:0,nvvnNet:0});

  $("billKpis").innerHTML=[
    {t:"Traded Quantum",v:totals.q.toFixed(4)+" MWh"},
    {t:"Trade Value",v:money(totals.tradeValue)},
    {t:"Power Exchange Net",v:money(totals.powerExchangeNet)},
    {t:"Final NVVN Net",v:money(totals.nvvnNet)}
  ].map(k=>`<div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200"><p class="text-[10px] font-bold uppercase text-slate-500">${k.t}</p><h3 class="text-lg font-black text-slate-800 mt-1">${k.v}</h3></div>`).join("");

  const getSegBadge = s => {
    const map = {
      'G-DAM': 'bg-teal-100 text-teal-800 border-teal-300',
      'DAM': 'bg-blue-100 text-blue-800 border-blue-300',
      'TAM': 'bg-purple-100 text-purple-800 border-purple-300',
      'RTM': 'bg-amber-100 text-amber-800 border-amber-300'
    };
    const cls = map[s] || 'bg-slate-100 text-slate-800 border-slate-300';
    return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${cls}">${s}</span>`;
  };

  const getTxnBadge = tx => {
    const cls = tx === 'SELL' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300';
    return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${cls}">${tx}</span>`;
  };

  $("billRows").innerHTML=rows.map(x=>`
    <tr class="hover:bg-slate-50 font-medium">
      <td class="p-2 border text-center">${x.sl}</td>
      <td class="p-2 border text-left font-bold">${formatInvoiceDate(x.date)}</td>
      <td class="p-2 border text-center">${getTxnBadge(x.txn)}</td>
      <td class="p-2 border text-center">${getSegBadge(x.seg)}</td>
      <td class="p-2 border">${x.q.toFixed(4)}</td>
      <td class="p-2 border">${x.tradeValue.toFixed(4)}</td>
      <td class="p-2 border text-rose-600">${x.corridor.toFixed(4)}</td>
      <td class="p-2 border text-amber-700">${x.pxFee.toFixed(4)}</td>
      <td class="p-2 border text-amber-700">${x.pxGst.toFixed(4)}</td>
      <td class="p-2 border font-bold text-emerald-700">${x.powerExchangeNet.toFixed(4)}</td>
      <td class="p-2 border text-blue-700">${x.nvvnMargin.toFixed(4)}</td>
      <td class="p-2 border text-blue-700">${x.nvvnGst.toFixed(4)}</td>
      <td class="p-2 border font-black text-emerald-800 bg-emerald-50">${x.nvvnNet.toFixed(4)}</td>
    </tr>`).join("");

  const f=v=>Number(v||0).toFixed(4);
  const dominantTxn = rows[0]?.txn || "SALE";
  $("billFoot").innerHTML=`
    <tr class="bg-slate-100 font-extrabold">
      <td class="p-2 border" colspan="4">Sub Total (${dominantTxn})</td>
      <td class="p-2 border">${f(totals.q)}</td><td class="p-2 border">${f(totals.tradeValue)}</td>
      <td class="p-2 border">${f(totals.corridor)}</td><td class="p-2 border">${f(totals.pxFee)}</td>
      <td class="p-2 border">${f(totals.pxGst)}</td><td class="p-2 border">${f(totals.powerExchangeNet)}</td>
      <td class="p-2 border">${f(totals.nvvnMargin)}</td><td class="p-2 border">${f(totals.nvvnGst)}</td>
      <td class="p-2 border bg-emerald-100 text-emerald-800">${f(totals.nvvnNet)}</td>
    </tr>
    <tr class="bg-blue-50 font-black">
      <td class="p-2 border" colspan="4">Grand Total</td>
      <td class="p-2 border">${f(totals.q)}</td><td class="p-2 border">${f(totals.tradeValue)}</td>
      <td class="p-2 border">${f(totals.corridor)}</td><td class="p-2 border">${f(totals.pxFee)}</td>
      <td class="p-2 border">${f(totals.pxGst)}</td><td class="p-2 border">${f(totals.powerExchangeNet)}</td>
      <td class="p-2 border">${f(totals.nvvnMargin)}</td><td class="p-2 border">${f(totals.nvvnGst)}</td>
      <td class="p-2 border bg-emerald-100 text-emerald-900">${f(totals.nvvnNet)}</td>
    </tr>`;
}

function exportBillingExcel() {
  const rows=buildBillingRows();
  const segVal=$('billingMarketSeg')?.value||$('billingSegFilter')?.value||'ALL';
  const txnVal=$('billingTxnType')?.value||$('billingTxnFilter')?.value||'ALL';
  const aoa=[
    ["Annexure 1 to NVVN Reimbursement Invoice"],
    ["Client: THDC INDIA LIMITED","Portfolio: N2UP0NVN0289", `Segment Filter: ${segVal}`, `Txn Filter: ${txnVal}`],
    [],
    ["Sl.No.","Delivery (Schedule) Date","Txn Type (Sale/Buy)","Mkt Seg#","Traded Quantum","Trade Value","Corridor Charges","Power Exchange Fees","GST on Power Exchange Fees","Net receivable (+) / payable (-) Power Exchange","NVVN Margin","GST on NVVN Margin","Net receivable (+) / payable (-) NVVN"],
    ...rows.map(x=>[x.sl,formatInvoiceDate(x.date),x.txn,x.seg,x.q,x.tradeValue,x.corridor,x.pxFee,x.pxGst,x.powerExchangeNet,x.nvvnMargin,x.nvvnGst,x.nvvnNet])
  ];
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"]=[8,18,16,10,15,16,16,18,22,27,16,19,27].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb,ws,"Annexure");
  XLSX.writeFile(wb,`THDC_11MW_NVVN_Annexure_Billing_${segVal}_${txnVal}.xlsx`);
}

function exportBillingPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("landscape", "mm", "a4");

  const rows = typeof buildBillingRows === "function" ? buildBillingRows() : [];
  if (!rows || !rows.length) {
    alert("No billing records found for the selected period.");
    return;
  }

  const segVal = $('billingMarketSeg')?.value || $('billingSegFilter')?.value || 'ALL';
  const txnVal = $('billingTxnType')?.value || $('billingTxnFilter')?.value || 'ALL';
  const bs = $('billingStartDate')?.value || '';
  const be = $('billingEndDate')?.value || '';
  const sDate = bs ? formatInvoiceDate(bs) : 'Earliest';
  const eDate = be ? formatInvoiceDate(be) : 'Latest';

  // 1. Corporate Header with Official THDC India Limited Logo (True aspect ratio 4.145:1)
  const logo = (typeof window !== "undefined" && window.THDC_LOGO_BASE64) || thdcilLogoDataUrl;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", 10, 8, 53.9, 13);
    } catch (e) {
      console.warn("Logo render error in PDF:", e);
    }
  }

  doc.setFontSize(12);
  doc.setTextColor(15, 43, 92);
  doc.setFontSize(13);
  doc.setTextColor(15, 43, 92);
  doc.setFont('helvetica', 'bold');
  doc.text("THDC INDIA LIMITED", 68, 12);

  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text("A Schedule 'A' Mini Ratna CPSU • Govt. of India Enterprise | Portfolio: N2UP0NVN0289", 68, 16.2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("11 MW Khurja Floating Solar Power Plant • Commercial Statement & NVVN Billing", 68, 20.2);

  // Prominent High-Visibility Market Segment & Transaction Badges
  doc.setFillColor(13, 148, 136); // Teal
  doc.roundedRect(162, 8, 38, 7.5, 1.5, 1.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text("SEGMENT: " + segVal, 181, 13, { align: 'center' });

  doc.setFillColor(txnVal === 'BUY' ? 225 : 5, txnVal === 'BUY' ? 29 : 150, txnVal === 'BUY' ? 72 : 105);
  doc.roundedRect(202, 8, 34, 7.5, 1.5, 1.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text("TXN: " + txnVal, 219, 13, { align: 'center' });

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text("Ref: THDC/11MW/NVVN/BILL/" + new Date().getFullYear(), 287, 10.5, { align: "right" });
  doc.text("Date Generated: " + new Date().toLocaleDateString('en-IN'), 287, 14.5, { align: "right" });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("Period: " + sDate + " to " + eDate, 287, 19.5, { align: "right" });

  // Divider Line (Navy + Emerald)
  doc.setFillColor(15, 43, 92);
  doc.rect(10, 23.5, 277, 0.8, 'F');
  doc.setFillColor(5, 150, 105);
  doc.rect(10, 24.3, 277, 0.4, 'F');

  // 2. Executive Stat Strip
  const totals = rows.reduce((s, x) => ({
    q: s.q + x.q, tradeValue: s.tradeValue + x.tradeValue, corridor: s.corridor + x.corridor,
    pxFee: s.pxFee + x.pxFee, pxGst: s.pxGst + x.pxGst, powerExchangeNet: s.powerExchangeNet + x.powerExchangeNet,
    nvvnMargin: s.nvvnMargin + x.nvvnMargin, nvvnGst: s.nvvnGst + x.nvvnGst, nvvnNet: s.nvvnNet + x.nvvnNet
  }), { q: 0, tradeValue: 0, corridor: 0, pxFee: 0, pxGst: 0, powerExchangeNet: 0, nvvnMargin: 0, nvvnGst: 0, nvvnNet: 0 });

  doc.setFillColor(248, 250, 252);
  doc.roundedRect(10, 28, 277, 9, 1.5, 1.5, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(10, 28, 277, 9, 1.5, 1.5, 'S');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text("Settlement Records: " + rows.length, 14, 33.8);
  doc.text("Scheduled Energy: " + totals.q.toFixed(4) + " MWh", 56, 33.8);
  doc.text("Gross Trade: Rs. " + formatIndianCurrency(totals.tradeValue), 112, 33.8);
  doc.text("Corridor & Fees: Rs. " + formatIndianCurrency(totals.corridor + totals.pxFee + totals.pxGst), 170, 33.8);
  doc.setTextColor(5, 120, 85);
  doc.text("Final NVVN Net: Rs. " + formatIndianCurrency(totals.nvvnNet), 232, 33.8);

  // 3. Clean Table
  const head = [[
    "Sl", "Delivery Date", "Txn", "Seg", "Quantum (MWh)", "Trade Value (Rs.)",
    "Corridor (Rs.)", "PX Fee (Rs.)", "PX GST (Rs.)", "Net PX (Rs.)",
    "NVVN Fee (Rs.)", "NVVN GST (Rs.)", "Net NVVN (Rs.)"
  ]];

  const body = rows.map(x => [
    x.sl,
    formatInvoiceDate(x.date),
    x.txn,
    x.seg,
    x.q.toFixed(4),
    formatIndianCurrency(x.tradeValue),
    formatIndianCurrency(x.corridor),
    formatIndianCurrency(x.pxFee),
    formatIndianCurrency(x.pxGst),
    formatIndianCurrency(x.powerExchangeNet),
    formatIndianCurrency(x.nvvnMargin),
    formatIndianCurrency(x.nvvnGst),
    formatIndianCurrency(x.nvvnNet)
  ]);

  const dominantTxn = rows[0]?.txn || "SALE";
  const foot = [
    [
      "Sub Total (" + dominantTxn + ")", "", "", "",
      totals.q.toFixed(4),
      formatIndianCurrency(totals.tradeValue),
      formatIndianCurrency(totals.corridor),
      formatIndianCurrency(totals.pxFee),
      formatIndianCurrency(totals.pxGst),
      formatIndianCurrency(totals.powerExchangeNet),
      formatIndianCurrency(totals.nvvnMargin),
      formatIndianCurrency(totals.nvvnGst),
      formatIndianCurrency(totals.nvvnNet)
    ],
    [
      "Grand Total", "", "", "",
      totals.q.toFixed(4),
      formatIndianCurrency(totals.tradeValue),
      formatIndianCurrency(totals.corridor),
      formatIndianCurrency(totals.pxFee),
      formatIndianCurrency(totals.pxGst),
      formatIndianCurrency(totals.powerExchangeNet),
      formatIndianCurrency(totals.nvvnMargin),
      formatIndianCurrency(totals.nvvnGst),
      formatIndianCurrency(totals.nvvnNet)
    ]
  ];

  doc.autoTable({
    head: head,
    body: body,
    foot: foot,
    startY: 39.5,
    theme: "grid",
    styles: { fontSize: 6.2, cellPadding: 1.6, halign: "right", textColor: [30, 41, 59] },
    headStyles: { fillColor: [15, 43, 92], textColor: 255, fontSize: 6.5, fontStyle: 'bold', halign: 'right' },
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 20, halign: "left", fontStyle: "bold" },
      2: { cellWidth: 12, halign: "center" },
      3: { cellWidth: 16, halign: "center" },
      4: { cellWidth: 19, halign: "right" },
      5: { cellWidth: 23, halign: "right" },
      6: { cellWidth: 17, halign: "right" },
      7: { cellWidth: 16, halign: "right" },
      8: { cellWidth: 15, halign: "right" },
      9: { cellWidth: 24, halign: "right", fontStyle: "bold" },
      10: { cellWidth: 17, halign: "right" },
      11: { cellWidth: 15, halign: "right" },
      12: { cellWidth: 25, halign: "right", fontStyle: "bold", textColor: [5, 120, 85] }
    },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 6.5 },
    didDrawPage: function(data) {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text("THDC India Limited • 11 MW Khurja Floating Solar Power Plant • Commercial Analysis Record", 10, 203);
      if (pageCount > 1) {
        doc.text("Page " + data.pageNumber + " of " + pageCount, 287, 203, { align: "right" });
      } else {
        doc.text("Certified Official Commercial Record", 287, 203, { align: "right" });
      }
    }
  });

  // 4. Commercial Analysis & Sign-off Block (Mukul Singh)
  let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 160;
  if (finalY > 155) {
    doc.addPage();
    finalY = 20;
  }
  const sigY = finalY + 8;
  const boxW = 120;
  const boxH = 26;
  const boxX = 167;

  // Left Context Details
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("COMMERCIAL ANALYSIS & RECONCILIATION RECORD", 10, sigY + 5);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text("• Plant Facility: 11 MW Khurja Floating Solar Power Plant (Khurja STPP, UP)", 10, sigY + 10);
  doc.text("• Commercial Analysis: Reconciled for energy trading, billing, and settlement analysis.", 10, sigY + 14);
  doc.text("• Department: Commercial - Power Trading Department, THDCIL, Rishikesh", 10, sigY + 18);
  doc.text("• Source: Reconciled from IEX Daily Settlement & NVVN Obligation statements.", 10, sigY + 22);

  // Right Sign-off Box
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.rect(boxX, sigY, boxW, boxH, 'S');
  doc.setLineDashPattern([], 0);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text("COMMERCIAL ANALYSIS & RECONCILIATION", boxX + 4, sigY + 4.5);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, boxX + boxW - 4, sigY + 4.5, { align: 'right' });

  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(boxX + 4, sigY + 11.5, boxX + boxW - 4, sigY + 11.5);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text("(Physical Signature)", boxX + boxW - 4, sigY + 10.5, { align: 'right' });

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text("Mukul Singh", boxX + 4, sigY + 16);
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text("Assistant Manager (Commercial - Power Trading)", boxX + 4, sigY + 19.8);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("Commercial - Power Trading Department, THDCIL, Rishikesh", boxX + 4, sigY + 23.5);

  doc.save(`THDC_11MW_NVVN_Billing_${segVal}_${txnVal}.pdf`);
}

function getGroupingKey(dateStr, type) {
    let d = new Date(dateStr); let y = d.getFullYear(); let m = d.getMonth(); 
    if (type === 'day') return dateStr; 
    if (type === 'month') return `${mNames[months[(m-3+12)%12]]} ${y}`;
    let fyYr = m < 3 ? y - 1 : y; 
    let fy = `FY ${String(fyYr).slice(-2)}-${String(fyYr+1).slice(-2)}`;
    if (type === 'fy') return fy;
    let q = m < 3 ? 'Q4' : m < 6 ? 'Q1' : m < 9 ? 'Q2' : 'Q3';
    if (type === 'quarter') return `${fy} ${q}`;
}

function getReportDateFilteredTrades(){
  const s=$("reportStartDate")?.value || "";
  const e=$("reportEndDate")?.value || "";
  const seg=$("reportSeg")?.value || "ALL";
  const txn=$("reportTxn")?.value || "ALL";
  return sortedTrades().filter(t=>{
    if(s && t.date < s) return false;
    if(e && t.date > e) return false;
    if(seg !== "ALL" && (t.seg || "G-DAM") !== seg) return false;
    if(txn !== "ALL" && (t.txn || "SELL") !== txn) return false;
    return true;
  });
}

function setReportPreset(p) {
  document.querySelectorAll('.report-preset-btn').forEach(b => {
    b.classList.remove('active', 'bg-blue-50', 'text-blue-700', 'border-blue-200');
    b.classList.add('bg-slate-100', 'text-slate-700');
  });
  if (window.event && window.event.currentTarget) {
    window.event.currentTarget.classList.add('active', 'bg-blue-50', 'text-blue-700', 'border-blue-200');
    window.event.currentTarget.classList.remove('bg-slate-100', 'text-slate-700');
  }

  const all = sortedTrades();
  if (!all.length) {
    renderReports();
    return;
  }
  const dates = [...new Set(all.map(t => t.date))].sort();
  const latestDateStr = dates[dates.length - 1];
  const latestD = new Date(latestDateStr);

  if (p === 'all') {
    $("reportStartDate").value = "";
    $("reportEndDate").value = "";
  } else if (p === 'month') {
    const y = latestD.getFullYear();
    const m = String(latestD.getMonth() + 1).padStart(2, '0');
    $("reportStartDate").value = `${y}-${m}-01`;
    $("reportEndDate").value = latestDateStr;
  } else if (p === '30d') {
    const past = new Date(latestD.getTime() - 29 * 86400000);
    $("reportStartDate").value = past.toISOString().slice(0, 10);
    $("reportEndDate").value = latestDateStr;
  } else if (p === 'quarter') {
    const y = latestD.getFullYear();
    const q = Math.floor(latestD.getMonth() / 3);
    const startM = String(q * 3 + 1).padStart(2, '0');
    $("reportStartDate").value = `${y}-${startM}-01`;
    $("reportEndDate").value = latestDateStr;
  } else if (p === 'fy') {
    const y = latestD.getFullYear();
    const m = latestD.getMonth();
    const fyStart = m < 3 ? y - 1 : y;
    $("reportStartDate").value = `${fyStart}-04-01`;
    $("reportEndDate").value = latestDateStr;
  }
  renderReports();
}

function setReportPeriodFromData(){
  const a=sortedTrades();
  if(!a.length){ alert("No data available."); return; }
  $("reportStartDate").value=a[0].date;
  $("reportEndDate").value=a[a.length-1].date;
  renderReports();
}

function clearReportPeriod(){
  $("reportStartDate").value="";
  $("reportEndDate").value="";
  if($("reportSeg")) $("reportSeg").value="ALL";
  if($("reportTxn")) $("reportTxn").value="ALL";
  renderReports();
}

function renderReports() {
  let groupBy=$("reportGroup")?.value || "day";
  let map={};
  const trades=getReportDateFilteredTrades();
  const selectedSeg = $("reportSeg")?.value || "ALL";
  const selectedTxn = $("reportTxn")?.value || "ALL";

  let dailyMap={};
  trades.forEach(t=>{
    if(!dailyMap[t.date]) dailyMap[t.date]={q:0,r:0,segs:new Set(),txns:new Set()};
    dailyMap[t.date].q+=qtyMwh(t);
    dailyMap[t.date].r+=amount(t);
    dailyMap[t.date].segs.add(t.seg || "G-DAM");
    dailyMap[t.date].txns.add(t.txn || "SELL");
  });

  Object.keys(dailyMap).sort().forEach(d=>{
    let dayData=dailyMap[d];
    let o=obFor(d);
    let gridChg=(o.nldcApp||0)+(o.nldcSched||0)+(o.ctu||0)+(o.stu||0)+(o.sldc||0);
    let pxM=roundPrecise(dayData.q*1000*pxRate);
    let pxG=roundPrecise(pxM*(pxGst/100));
    let nvM=roundPrecise(dayData.q*1000*nvvnRate);
    let nvG=roundPrecise(nvM*(nvvnGst/100));
    let key=getGroupingKey(d,groupBy);
    if(!map[key]) map[key]={q:0,r:0,grid:0,px:0,nvvn:0,segs:new Set(),txns:new Set()};
    map[key].q+=dayData.q;
    map[key].r+=dayData.r;
    map[key].grid+=gridChg;
    map[key].px+=(pxM+pxG);
    map[key].nvvn+=(nvM+nvG);
    dayData.segs.forEach(s=>map[key].segs.add(s));
    dayData.txns.forEach(tx=>map[key].txns.add(tx));
  });

  let totQ=0, totR=0, totGrid=0, totPx=0, totNvvn=0, totDed=0, totNet=0;

  const getSegBadge = s => {
    const map = {
      'G-DAM': 'bg-teal-100 text-teal-800 border-teal-300',
      'DAM': 'bg-blue-100 text-blue-800 border-blue-300',
      'TAM': 'bg-purple-100 text-purple-800 border-purple-300',
      'RTM': 'bg-amber-100 text-amber-800 border-amber-300'
    };
    const cls = map[s] || 'bg-slate-100 text-slate-800 border-slate-300';
    return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${cls}">${s}</span>`;
  };

  const getTxnBadge = tx => {
    const cls = tx === 'SELL' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300';
    return `<span class="px-2 py-0.5 rounded text-[10px] font-extrabold border ${cls}">${tx}</span>`;
  };

  const rowKeys = Object.keys(map);
  const rowsHtml = rowKeys.map(k => {
    const x = map[k];
    let w = x.q ? x.r / x.q : 0;
    let rowDed = roundPrecise(x.grid + x.px + x.nvvn);
    let rowNet = roundPrecise(x.r - rowDed);
    let netTariff = x.q ? rowNet / (x.q * 1000) : 0;

    totQ += x.q;
    totR += x.r;
    totGrid += x.grid;
    totPx += x.px;
    totNvvn += x.nvvn;
    totDed += rowDed;
    totNet += rowNet;

    const segStr = selectedSeg !== "ALL" ? selectedSeg : (x.segs.size ? [...x.segs].join(",") : "G-DAM");
    const txnStr = selectedTxn !== "ALL" ? selectedTxn : (x.txns.size ? [...x.txns].join(",") : "SELL");

    return `<tr class="hover:bg-blue-50/40 transition font-medium border-b border-slate-100">
      <td class="p-3 text-left font-bold text-slate-800 whitespace-nowrap">${k}</td>
      <td class="p-3 text-center">${getSegBadge(segStr)}</td>
      <td class="p-3 text-center">${getTxnBadge(txnStr)}</td>
      <td class="p-3 text-right text-blue-700 font-bold tabular-nums">${x.q.toFixed(3)}</td>
      <td class="p-3 text-right text-slate-600 tabular-nums">₹ ${Math.abs(w).toFixed(2)}</td>
      <td class="p-3 text-right text-slate-900 font-bold tabular-nums">₹ ${formatIndianCurrency(Math.abs(x.r))}</td>
      <td class="p-3 text-right text-rose-600 font-semibold tabular-nums">₹ ${formatIndianCurrency(Math.abs(x.grid))}</td>
      <td class="p-3 text-right text-amber-700 font-semibold tabular-nums">₹ ${formatIndianCurrency(Math.abs(x.px))}</td>
      <td class="p-3 text-right text-blue-700 font-semibold tabular-nums">₹ ${formatIndianCurrency(Math.abs(x.nvvn))}</td>
      <td class="p-3 text-right text-rose-700 font-bold tabular-nums">₹ ${formatIndianCurrency(Math.abs(rowDed))}</td>
      <td class="p-3 text-right text-emerald-800 font-extrabold bg-emerald-50/80 tabular-nums">₹ ${formatIndianCurrency(Math.abs(rowNet))}</td>
      <td class="p-3 text-right text-indigo-700 font-bold bg-indigo-50/70 tabular-nums">₹ ${Math.abs(netTariff).toFixed(3)}</td>
    </tr>`;
  }).join("");

  $("reportRows").innerHTML = rowsHtml || '<tr><td colspan="12" class="p-8 text-center text-slate-400 font-medium">No settlement records found for selected period and filters.</td></tr>';

  let totAvgMcp = totQ ? totR / totQ : 0;
  let totTariff = totQ ? totNet / (totQ * 1000) : 0;

  // GRAND TOTAL IN FOOTER
  const foot = $("reportFoot");
  if (foot) {
    if (rowKeys.length > 0) {
      foot.innerHTML = `<tr>
        <td class="p-3 text-left font-black text-slate-900 uppercase whitespace-nowrap">Grand Total</td>
        <td class="p-3 text-center text-[10px] font-bold text-slate-500">${selectedSeg}</td>
        <td class="p-3 text-center text-[10px] font-bold text-slate-500">${selectedTxn}</td>
        <td class="p-3 text-right font-black text-blue-900 tabular-nums">${totQ.toFixed(3)}</td>
        <td class="p-3 text-right text-slate-700 font-bold tabular-nums">₹ ${Math.abs(totAvgMcp).toFixed(2)}</td>
        <td class="p-3 text-right font-black text-slate-950 tabular-nums">₹ ${formatIndianCurrency(Math.abs(totR))}</td>
        <td class="p-3 text-right font-bold text-rose-700 tabular-nums">₹ ${formatIndianCurrency(Math.abs(totGrid))}</td>
        <td class="p-3 text-right font-bold text-amber-800 tabular-nums">₹ ${formatIndianCurrency(Math.abs(totPx))}</td>
        <td class="p-3 text-right font-bold text-blue-800 tabular-nums">₹ ${formatIndianCurrency(Math.abs(totNvvn))}</td>
        <td class="p-3 text-right font-black text-rose-900 tabular-nums">₹ ${formatIndianCurrency(Math.abs(totDed))}</td>
        <td class="p-3 text-right font-black text-emerald-900 bg-emerald-100/80 tabular-nums">₹ ${formatIndianCurrency(Math.abs(totNet))}</td>
        <td class="p-3 text-right font-black text-indigo-900 bg-indigo-100/70 tabular-nums">₹ ${Math.abs(totTariff).toFixed(3)}</td>
      </tr>`;
    } else {
      foot.innerHTML = '';
    }
  }

  // SUMMARY CARDS RIBBON
  const summaryCards = $("reportSummaryCards");
  if (summaryCards) {
    const dedPercent = totR ? ((totDed / totR) * 100).toFixed(1) : "0.0";
    summaryCards.innerHTML = [
      {
        t: "Total Scheduled Energy",
        v: (totQ / 1000).toFixed(3) + " MU",
        sub: totQ.toFixed(2) + " MWh Delivered",
        c: "blue",
        i: "fa-bolt"
      },
      {
        t: "Gross Market Value",
        v: money(totR),
        sub: "IEX Gross Traded Value",
        c: "emerald",
        i: "fa-sack-dollar"
      },
      {
        t: "Commercial Deductions",
        v: money(totDed),
        sub: dedPercent + "% of Gross (Grid+PX+NVVN)",
        c: "rose",
        i: "fa-receipt"
      },
      {
        t: "Net Receivable to THDCIL",
        v: money(totNet),
        sub: "Effective Tariff: ₹" + totTariff.toFixed(3) + "/kWh",
        c: "indigo",
        i: "fa-scale-balanced"
      }
    ].map(card => `
      <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-200/90 flex items-center justify-between">
        <div>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">${card.t}</p>
          <h3 class="text-xl font-black text-slate-800 mt-0.5">${card.v}</h3>
          <p class="text-[10px] font-semibold text-slate-400 mt-0.5">${card.sub}</p>
        </div>
        <div class="w-11 h-11 rounded-xl bg-${card.c}-50 text-${card.c}-600 flex items-center justify-center text-xl shrink-0 border border-${card.c}-100">
          <i class="fa-solid ${card.i}"></i>
        </div>
      </div>
    `).join("");
  }

  const s=$("reportStartDate")?.value||"Start";
  const e=$("reportEndDate")?.value||"Present";
  const note=$("reportPeriodNote");
  if(note) {
    const daysCount = new Set(trades.map(t=>t.date)).size;
    note.innerHTML = `<span class="font-bold text-slate-700">Active Scope:</span> ${s} → ${e} • Segment: <span class="font-bold text-blue-700">${selectedSeg}</span> • Txn: <span class="font-bold text-emerald-700">${selectedTxn}</span> • <span class="font-bold text-blue-700">${trades.length}</span> trades across <span class="font-bold text-blue-700">${daysCount}</span> days • View: <span class="uppercase font-bold text-slate-700">${groupBy}</span>`;
  }
}

function exportReportExcel() {
  const groupBy = $("reportGroup")?.value || "day";
  const s = $("reportStartDate")?.value || "ALL";
  const e = $("reportEndDate")?.value || "ALL";
  const segVal = $("reportSeg")?.value || "ALL";
  const txnVal = $("reportTxn")?.value || "ALL";

  // Build clean AoA workbook
  const aoa = [
    ["THDC INDIA LIMITED (A Schedule 'A' Mini Ratna CPSU — Govt. of India Enterprise)"],
    ["11 MW Khurja Floating Solar Power Plant — Commercial Settlement & Reconciliation Statement"],
    [`Portfolio ID: N2UP0NVN0289`, `Trader: NVVN Limited`, `Report Period: ${s} to ${e}`, `Grouping View: ${groupBy.toUpperCase()}`],
    [`Market Segment Filter: ${segVal}`, `Transaction Type Filter: ${txnVal}`, `Rates Applied: PX Fee ₹${pxRate}/kWh (+${pxGst}% GST) | NVVN Margin ₹${nvvnRate}/kWh (+${nvvnGst}% GST)`],
    [`Generated On: ${new Date().toLocaleString('en-IN')}`],
    [],
    ["Period / Date", "Market Segment", "Transaction Type", "Traded Quantum (MWh)", "Avg MCP (₹/MWh)", "Gross Trade Value (₹)", "Grid Charges (₹)", "PX Fees + GST (₹)", "NVVN Margin + GST (₹)", "Total Deductions (₹)", "Net Receivable (₹)", "Effective Net Tariff (₹/kWh)"]
  ];

  // Populate data rows from DOM
  const rows = document.querySelectorAll("#reportRows tr");
  rows.forEach(r => {
    const cols = Array.from(r.querySelectorAll("td")).map(td => td.innerText.replace(/[₹,]/g, "").trim());
    if (cols.length === 12) {
      aoa.push([
        cols[0],
        cols[1],
        cols[2],
        parseFloat(cols[3]) || 0,
        parseFloat(cols[4]) || 0,
        parseFloat(cols[5]) || 0,
        parseFloat(cols[6]) || 0,
        parseFloat(cols[7]) || 0,
        parseFloat(cols[8]) || 0,
        parseFloat(cols[9]) || 0,
        parseFloat(cols[10]) || 0,
        parseFloat(cols[11]) || 0
      ]);
    }
  });

  // Footer Grand Total
  const footRow = document.querySelector("#reportFoot tr");
  if (footRow) {
    const footCols = Array.from(footRow.querySelectorAll("td")).map(td => td.innerText.replace(/[₹,]/g, "").trim());
    if (footCols.length === 12) {
      aoa.push([]);
      aoa.push([
        "GRAND TOTAL",
        footCols[1],
        footCols[2],
        parseFloat(footCols[3]) || 0,
        parseFloat(footCols[4]) || 0,
        parseFloat(footCols[5]) || 0,
        parseFloat(footCols[6]) || 0,
        parseFloat(footCols[7]) || 0,
        parseFloat(footCols[8]) || 0,
        parseFloat(footCols[9]) || 0,
        parseFloat(footCols[10]) || 0,
        parseFloat(footCols[11]) || 0
      ]);
    }
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 20 },
    { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    { wch: 20 }, { wch: 18 }
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Commercial Settlement");
  XLSX.writeFile(wb, `THDC_11MW_Settlement_${groupBy.toUpperCase()}_${segVal}_${txnVal}_${s}_TO_${e}.xlsx`);
}

function exportReportPDF() {
  const { jsPDF } = window.jspdf; 
  const doc = new jsPDF('landscape', 'mm', 'a4');
  const rs = $("reportStartDate")?.value || "ALL";
  const re = $("reportEndDate")?.value || "ALL";
  const segVal = $("reportSeg")?.value || "ALL";
  const txnVal = $("reportTxn")?.value || "ALL";
  const groupBy = ($("reportGroup")?.value || "day").toUpperCase();

  // 1. Corporate header with official THDC India Limited logo (Aspect ratio 4.145:1)
  const logo = (typeof window !== "undefined" && window.THDC_LOGO_BASE64) || thdcilLogoDataUrl;
  if (logo) {
    try { 
      doc.addImage(logo, 'PNG', 12, 8, 53.9, 13); 
    } catch(e) {
      console.warn("Logo render error in PDF:", e);
    }
  }

  doc.setFontSize(13); 
  doc.setTextColor(15, 43, 92); // Corporate Navy
  doc.setFont('helvetica', 'bold');
  doc.text("THDC INDIA LIMITED", 70, 12);

  doc.setFontSize(8); 
  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.text("A Schedule 'A' Mini Ratna CPSU — Govt. of India Enterprise | Portfolio: N2UP0NVN0289", 70, 16.2);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("11 MW Khurja Floating Solar Power Plant • Commercial Settlement & Reconciliation Report", 70, 20.2);

  // Prominent High-Visibility Market Segment & Transaction Badges
  doc.setFillColor(13, 148, 136); // Teal
  doc.roundedRect(162, 8, 38, 7.5, 1.5, 1.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text("SEGMENT: " + segVal, 181, 13, { align: 'center' });

  doc.setFillColor(txnVal === 'BUY' ? 225 : 5, txnVal === 'BUY' ? 29 : 150, txnVal === 'BUY' ? 72 : 105);
  doc.roundedRect(202, 8, 34, 7.5, 1.5, 1.5, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text("TXN: " + txnVal, 219, 13, { align: 'center' });

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`Ref: THDC/11MW/COMM/SETTL/${new Date().getFullYear()}`, 285, 10.5, { align: 'right' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, 285, 14.5, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text(`Period: ${rs} to ${re} | ${groupBy}`, 285, 19.5, { align: 'right' });

  // Divider Line (Navy + Emerald)
  doc.setFillColor(15, 43, 92);
  doc.rect(12, 23.5, 273, 0.8, 'F');
  doc.setFillColor(5, 150, 105);
  doc.rect(12, 24.3, 273, 0.4, 'F');

  // Executive Stat Box in PDF
  const footRow = document.querySelector("#reportFoot tr");
  if (footRow) {
    const footCols = Array.from(footRow.querySelectorAll("td")).map(td => td.innerText.trim());
    if (footCols.length >= 11) {
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(12, 28, 273, 9, 1.5, 1.5, 'F');
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(12, 28, 273, 9, 1.5, 1.5, 'S');

      doc.setFontSize(7.2);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Delivered: ${footCols[3] || '0.00'} MWh`, 16, 33.8);
      doc.text(`Gross Trade: ${footCols[5] || '0.00'}`, 75, 33.8);
      doc.text(`Deductions: ${footCols[9] || '0.00'}`, 142, 33.8);
      doc.setTextColor(5, 120, 85);
      doc.text(`Net Receivable: ${footCols[10] || '0.00'} (Tariff: ${footCols[11] || '0.00'}/u)`, 212, 33.8);
    }
  }

  // Extract clean structured table data for precision justification
  const head = [
    [
      { content: 'Period / Date', styles: { halign: 'left' } },
      { content: 'Segment', styles: { halign: 'center' } },
      { content: 'Type', styles: { halign: 'center' } },
      { content: 'Qty (MWh)', styles: { halign: 'right' } },
      { content: 'Avg MCP (₹/MWh)', styles: { halign: 'right' } },
      { content: 'Gross Value (₹)', styles: { halign: 'right' } },
      { content: 'Grid Charges (₹)', styles: { halign: 'right' } },
      { content: 'PX (Fee+GST) (₹)', styles: { halign: 'right' } },
      { content: 'NVVN (Mar+GST) (₹)', styles: { halign: 'right' } },
      { content: 'Total Ded. (₹)', styles: { halign: 'right' } },
      { content: 'Net Recv. (₹)', styles: { halign: 'right' } },
      { content: 'Net Tariff (₹/u)', styles: { halign: 'right' } }
    ]
  ];

  const bodyRows = [];
  document.querySelectorAll("#reportRows tr").forEach(tr => {
    const tds = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim());
    if (tds.length >= 12) {
      bodyRows.push(tds);
    }
  });

  const footRows = [];
  document.querySelectorAll("#reportFoot tr").forEach(tr => {
    const tds = Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim());
    if (tds.length >= 12) {
      footRows.push(tds);
    }
  });

  doc.autoTable({ 
    head: head,
    body: bodyRows,
    foot: footRows.length ? footRows : undefined,
    startY: 39.5, 
    theme: 'grid', 
    headStyles: { fillColor: [15, 43, 92], textColor: 255, fontSize: 6.6, fontStyle: 'bold' }, 
    styles: { fontSize: 6.0, cellPadding: 1.6, textColor: [30, 41, 59] },
    columnStyles: { 
      0: { halign: 'left', fontStyle: 'bold', cellWidth: 26 }, 
      1: { halign: 'center', cellWidth: 15 }, 
      2: { halign: 'center', cellWidth: 13 },
      3: { halign: 'right', cellWidth: 20 },
      4: { halign: 'right', cellWidth: 22 },
      5: { halign: 'right', cellWidth: 24 },
      6: { halign: 'right', cellWidth: 22 },
      7: { halign: 'right', cellWidth: 22 },
      8: { halign: 'right', cellWidth: 24 },
      9: { halign: 'right', cellWidth: 24 },
      10: { halign: 'right', fontStyle: 'bold', cellWidth: 26, textColor: [5, 120, 85] },
      11: { halign: 'right', fontStyle: 'bold', cellWidth: 19, textColor: [91, 33, 182] }
    },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 6.5 },
    didParseCell: function(data) {
      const c = data.column.index;
      if (c === 0) data.cell.styles.halign = 'left';
      else if (c === 1 || c === 2) data.cell.styles.halign = 'center';
      else data.cell.styles.halign = 'right';

      if (data.section === 'body') {
        if (c === 10) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.textColor = [5, 120, 85];
          data.cell.styles.fillColor = [240, 253, 244];
        } else if (c === 6 || c === 9) {
          data.cell.styles.textColor = [225, 29, 72];
        } else if (c === 3) {
          data.cell.styles.textColor = [29, 78, 216];
        }
      }
      if (data.section === 'foot') {
        data.cell.styles.fontStyle = 'bold';
        if (c === 10) data.cell.styles.textColor = [5, 120, 85];
      }
    },
    didDrawPage: function(data) {
      const pageCount = doc.internal.getNumberOfPages();
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.text("THDC India Limited • 11 MW Khurja Floating Solar Power Plant • Commercial Settlement Record", 12, 203);
      if (pageCount > 1) {
        doc.text("Page " + data.pageNumber + " of " + pageCount, 285, 203, { align: 'right' });
      } else {
        doc.text("Certified Commercial Settlement Record", 285, 203, { align: 'right' });
      }
    }
  });

  // Corporate Commercial Analysis & Sign-off Block on the last page
  let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 160;
  if (finalY > 155) {
    doc.addPage();
    finalY = 20;
  }
  const sigY = finalY + 8;
  const boxW = 120;
  const boxH = 26;
  const boxX = 165;

  // Left Context Details
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("COMMERCIAL ANALYSIS & RECONCILIATION RECORD", 12, sigY + 5);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text("• Plant Facility: 11 MW Khurja Floating Solar Power Plant (Khurja STPP, UP)", 12, sigY + 10);
  doc.text("• Commercial Analysis: Reconciled for energy trading, billing, and settlement analysis.", 12, sigY + 14);
  doc.text("• Department: Commercial - Power Trading Department, THDCIL, Rishikesh", 12, sigY + 18);
  doc.text("• Source: Reconciled from IEX Daily Settlement & NVVN Obligation statements.", 12, sigY + 22);

  // Right Sign-off Box
  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.rect(boxX, sigY, boxW, boxH, 'S');
  doc.setLineDashPattern([], 0);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text("COMMERCIAL ANALYSIS & RECONCILIATION", boxX + 4, sigY + 4.5);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(71, 85, 105);
  doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, boxX + boxW - 4, sigY + 4.5, { align: 'right' });

  doc.setDrawColor(203, 213, 225);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(boxX + 4, sigY + 11.5, boxX + boxW - 4, sigY + 11.5);
  doc.setLineDashPattern([], 0);
  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text("(Physical Signature)", boxX + boxW - 4, sigY + 10.5, { align: 'right' });

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text("Mukul Singh", boxX + 4, sigY + 16);
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text("Assistant Manager (Commercial - Power Trading)", boxX + 4, sigY + 19.8);
  doc.setFontSize(7.0);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 43, 92);
  doc.text("Commercial - Power Trading Department, THDCIL, Rishikesh", boxX + 4, sigY + 23.5);

  doc.save(`THDC_11MW_Settlement_${groupBy}_${segVal}_${txnVal}_${rs}_TO_${re}.pdf`);
}

// AUTOMATIC DAILY SETTLEMENT PDF GENERATION & DOWNLOAD ENGINE
function autoDownloadDailySettlementPDF(targetDate) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      console.warn("jsPDF library is not loaded.");
      return null;
    }
    const { jsPDF } = window.jspdf;

    const allTrades = sortedTrades();
    if (!allTrades || !allTrades.length) {
      console.warn("No trade records available to generate Daily Settlement PDF.");
      return null;
    }

    // Determine target date: passed targetDate or latest date in trade records
    const availableDates = [...new Set(allTrades.map(t => t.date))].sort();
    let dateToUse = targetDate;
    if (!dateToUse || !availableDates.includes(dateToUse)) {
      dateToUse = availableDates[availableDates.length - 1];
    }
    if (!dateToUse) {
      console.warn("No valid trade date found for Daily Settlement PDF.");
      return null;
    }

    // Pre-sync filters in the Export Reports tab to save user from manual navigation
    if ($("reportStartDate")) $("reportStartDate").value = dateToUse;
    if ($("reportEndDate")) $("reportEndDate").value = dateToUse;
    if ($("reportGroup")) $("reportGroup").value = "day";
    if (typeof renderReports === "function") renderReports();

    // Filter and sort trades for this specific date
    const dayTrades = allTrades.filter(t => t.date === dateToUse);
    if (!dayTrades.length) {
      console.warn(`No trades found for date: ${dateToUse}`);
      return null;
    }
    dayTrades.sort((a, b) => (Number(a.block) || 0) - (Number(b.block) || 0));

    // Calculate energy, gross revenue, and MCP
    const totalQ = roundPrecise(dayTrades.reduce((s, x) => s + qtyMwh(x), 0));
    const grossVal = roundPrecise(dayTrades.reduce((s, x) => s + amount(x), 0));
    const avgMcp = totalQ > 0 ? (grossVal / totalQ) : 0;

    // Corridor & Transmission obligations for this specific day
    const o = obFor(dateToUse);
    const nldcApp = Math.abs(Number(o.nldcApp) || 0);
    const ctu = Math.abs(Number(o.ctu) || 0);
    const nldcSchedBuy = Math.abs(Number(o.nldcSchedBuy) || 0);
    const nldcSchedSell = Math.abs(Number(o.nldcSchedSell) || 0);
    const stu = Math.abs(Number(o.stu) || 0);
    const dist = Math.abs(Number(o.distribution) || 0);
    const other = Math.abs(Number(o.other) || 0);
    const sldc = Math.abs(Number(o.sldc) || 0);
    const gridCharges = roundPrecise(nldcApp + ctu + nldcSchedBuy + nldcSchedSell + stu + dist + other + sldc);

    // PX Fees & NVVN Margins with statutory GST
    const pxFee = roundPrecise(totalQ * 1000 * pxRate);
    const pxGstAmt = roundPrecise(pxFee * (pxGst / 100));
    const pxTotal = roundPrecise(pxFee + pxGstAmt);

    const nvvnMargin = roundPrecise(totalQ * 1000 * nvvnRate);
    const nvvnGstAmt = roundPrecise(nvvnMargin * (nvvnGst / 100));
    const nvvnTotal = roundPrecise(nvvnMargin + nvvnGstAmt);

    const totalDed = roundPrecise(gridCharges + pxTotal + nvvnTotal);
    const netSettlement = roundPrecise(grossVal - totalDed);
    const netTariff = totalQ > 0 ? (netSettlement / (totalQ * 1000)) : 0;

    const segSet = new Set(dayTrades.map(t => t.seg || "G-DAM"));
    const txnSet = new Set(dayTrades.map(t => t.txn || "SELL"));
    const segStr = [...segSet].join(", ");
    const txnStr = [...txnSet].join(", ");

    // Initialize Landscape A4 PDF document
    const doc = new jsPDF('landscape', 'mm', 'a4');

    // Corporate Header with THDCIL emblem
    const logo = (typeof window !== "undefined" && window.THDC_LOGO_BASE64) || thdcilLogoDataUrl;
    if (logo) {
      try { 
        doc.addImage(logo, 'PNG', 12, 8, 53.9, 13); 
      } catch(e) {
        console.warn("Logo render error in daily PDF:", e);
      }
    }

    doc.setFontSize(13);
    doc.setTextColor(15, 43, 92); // Corporate Navy
    doc.setFont('helvetica', 'bold');
    doc.text("THDC INDIA LIMITED", 70, 12);

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.text("A Schedule 'A' Mini Ratna CPSU — Govt. of India Enterprise | Portfolio: N2UP0NVN0289", 70, 16.2);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("11 MW Khurja Floating Solar Power Plant • Daily Commercial Settlement & Reconciliation Report", 70, 20.2);

    // Prominent High-Visibility Market Segment & Transaction Badges
    doc.setFillColor(13, 148, 136); // Teal
    doc.roundedRect(162, 8, 38, 7.5, 1.5, 1.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text("SEGMENT: " + segStr, 181, 13, { align: 'center' });

    doc.setFillColor(txnStr === 'BUY' ? 225 : 5, txnStr === 'BUY' ? 29 : 150, txnStr === 'BUY' ? 72 : 105);
    doc.roundedRect(202, 8, 34, 7.5, 1.5, 1.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text("TXN: " + txnStr, 219, 13, { align: 'center' });

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Ref: THDC/11MW/COMM/DAILY/${dateToUse}`, 285, 10.5, { align: 'right' });
    doc.text(`Settlement Date: ${dateToUse}`, 285, 14.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text(`Trader: NVVN | IEX Spot`, 285, 19.5, { align: 'right' });

    // Divider Line (Navy + Emerald)
    doc.setFillColor(15, 43, 92);
    doc.rect(12, 23.5, 273, 0.8, 'F');
    doc.setFillColor(5, 150, 105);
    doc.rect(12, 24.3, 273, 0.4, 'F');

    // Executive Daily Highlights Box
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(12, 28, 273, 14, 1.5, 1.5, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(12, 28, 273, 14, 1.5, 1.5, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`Dispatched Energy: ${totalQ.toFixed(3)} MWh (${(totalQ/1000).toFixed(4)} MU)`, 16, 33.5);
    doc.text(`Avg Clearing Price: ₹ ${avgMcp.toFixed(2)}/MWh`, 95, 33.5);
    doc.text(`Gross Trade: ₹ ${formatIndianCurrency(grossVal)}`, 180, 33.5);

    doc.setTextColor(225, 29, 72);
    doc.text(`Corridor Charges: ₹ ${formatIndianCurrency(gridCharges)}`, 16, 39);
    doc.setTextColor(217, 119, 6);
    doc.text(`PX & Trading Fees: ₹ ${formatIndianCurrency(pxTotal + nvvnTotal)}`, 95, 39);
    doc.setTextColor(5, 120, 85);
    doc.text(`Net Realized: ₹ ${formatIndianCurrency(netSettlement)} (Tariff: ₹ ${netTariff.toFixed(3)}/kWh)`, 180, 39);

    // Table 1: Daily Commercial Settlement Breakdown
    doc.autoTable({
      startY: 45,
      head: [
        ['Date', 'Segment', 'Txn', 'Quantum (MWh)', 'Avg MCP (₹/MWh)', 'Gross Value (₹)', 'Grid Charges (₹)', 'PX Fee (₹)', 'NVVN Margin (₹)', 'Total Ded (₹)', 'Net Settlement (₹)', 'Net Tariff (₹/u)']
      ],
      body: [
        [
          dateToUse,
          segStr,
          txnStr,
          totalQ.toFixed(3),
          '₹ ' + avgMcp.toFixed(2),
          '₹ ' + formatIndianCurrency(grossVal),
          '₹ ' + formatIndianCurrency(gridCharges),
          '₹ ' + formatIndianCurrency(pxTotal),
          '₹ ' + formatIndianCurrency(nvvnTotal),
          '₹ ' + formatIndianCurrency(totalDed),
          '₹ ' + formatIndianCurrency(netSettlement),
          '₹ ' + netTariff.toFixed(3)
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [15, 43, 92], textColor: 255, fontSize: 6.6, fontStyle: 'bold' },
      styles: { fontSize: 6.2, cellPadding: 1.8, textColor: [30, 41, 59] },
      columnStyles: { 
        0: { halign: 'left', fontStyle: 'bold' }, 
        1: { halign: 'center' }, 
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
        9: { halign: 'right' },
        10: { halign: 'right', fontStyle: 'bold', textColor: [5, 120, 85] },
        11: { halign: 'right', fontStyle: 'bold', textColor: [91, 33, 182] }
      },
      didParseCell: function(data) {
        const c = data.column.index;
        if (c === 0) data.cell.styles.halign = 'left';
        else if (c === 1 || c === 2) data.cell.styles.halign = 'center';
        else data.cell.styles.halign = 'right';
      }
    });

    // Corridor charges itemized breakdown mini-table
    let nextY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 3.5 : 62;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text("ITEMIZED OPEN ACCESS & CORRIDOR TRANSMISSION CHARGES", 12, nextY);

    doc.autoTable({
      startY: nextY + 1.5,
      head: [
        ['NLDC App (₹)', 'CTU Trans (₹)', 'NLDC Sched Buy (₹)', 'NLDC Sched Sell (₹)', 'STU Trans (₹)', 'Distribution (₹)', 'SLDC Sched/Op (₹)', 'Other Charges (₹)', 'Total Corridor Deductions (₹)']
      ],
      body: [
        [
          '₹ ' + formatIndianCurrency(nldcApp),
          '₹ ' + formatIndianCurrency(ctu),
          '₹ ' + formatIndianCurrency(nldcSchedBuy),
          '₹ ' + formatIndianCurrency(nldcSchedSell),
          '₹ ' + formatIndianCurrency(stu),
          '₹ ' + formatIndianCurrency(dist),
          '₹ ' + formatIndianCurrency(sldc),
          '₹ ' + formatIndianCurrency(other),
          '₹ ' + formatIndianCurrency(gridCharges)
        ]
      ],
      theme: 'grid',
      headStyles: { fillColor: [71, 85, 105], textColor: 255, fontSize: 6.2, fontStyle: 'bold' },
      styles: { fontSize: 6.2, cellPadding: 1.6, halign: 'right', textColor: [30, 41, 59] },
      didParseCell: function(data) {
        data.cell.styles.halign = 'right';
      }
    });

    // Table 2: 96 Time-Block Generation & Settlement Schedule
    nextY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 4 : 80;
    if (nextY > 155) {
      doc.addPage();
      nextY = 15;
    }
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text(`96 TIME-BLOCK GENERATION, SCHEDULE & CLEARING BREAKDOWN (${dateToUse} • ${dayTrades.length} Blocks)`, 12, nextY);

    const blockRows = dayTrades.map(t => {
      const q = qtyMwh(t);
      const mcp = Number(t.mcp) || 0;
      const amt = amount(t);
      return [
        `Block ${t.block}`,
        t.period || '',
        t.seg || segStr,
        t.txn || txnStr,
        q.toFixed(3),
        '₹ ' + mcp.toFixed(2),
        '₹ ' + formatIndianCurrency(amt)
      ];
    });

    doc.autoTable({
      startY: nextY + 1.5,
      head: [
        ['Block', 'Time Period', 'Segment', 'Txn', 'Quantum (MWh)', 'MCP (₹/MWh)', 'Trade Value (₹)']
      ],
      body: blockRows,
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 6.2, fontStyle: 'bold' },
      styles: { fontSize: 5.8, cellPadding: 1.3, textColor: [30, 41, 59] },
      columnStyles: { 
        0: { halign: 'left', fontStyle: 'bold', cellWidth: 28 }, 
        1: { halign: 'center', cellWidth: 36 }, 
        2: { halign: 'center', cellWidth: 24 }, 
        3: { halign: 'center', cellWidth: 20 },
        4: { halign: 'right', cellWidth: 40 },
        5: { halign: 'right', cellWidth: 40 },
        6: { halign: 'right', fontStyle: 'bold', cellWidth: 48, textColor: [5, 120, 85] }
      },
      foot: [
        ['Total (Day)', `${dayTrades.length} Blocks`, segStr, txnStr, totalQ.toFixed(3), 'Avg ₹ ' + avgMcp.toFixed(2), '₹ ' + formatIndianCurrency(grossVal)]
      ],
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 6.2 },
      didParseCell: function(data) {
        const c = data.column.index;
        if (c === 0) data.cell.styles.halign = 'left';
        else if (c === 1 || c === 2 || c === 3) data.cell.styles.halign = 'center';
        else data.cell.styles.halign = 'right';
      },
      didDrawPage: function(data) {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text("THDC India Limited • 11 MW Khurja Floating Solar Power Plant • Commercial Settlement Certificate", 12, 203);
        if (pageCount > 1) {
          doc.text("Page " + data.pageNumber + " of " + pageCount, 285, 203, { align: 'right' });
        } else {
          doc.text("Certified Daily Settlement Record", 285, 203, { align: 'right' });
        }
      }
    });

    // Commercial Analysis & Sign-off Block on the final page
    let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 160;
    if (finalY > 155) {
      doc.addPage();
      finalY = 20;
    }
    const sigY = finalY + 8;
    const boxW = 120;
    const boxH = 26;
    const boxX = 165;

    // Left Context Details
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("COMMERCIAL ANALYSIS & RECONCILIATION RECORD", 12, sigY + 5);
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text("• Plant Facility: 11 MW Khurja Floating Solar Power Plant (Khurja STPP, UP)", 12, sigY + 10);
    doc.text("• Commercial Analysis: Daily 96-block trade dispatch and clearing reconciliation.", 12, sigY + 14);
    doc.text("• Department: Commercial - Power Trading Department, THDCIL, Rishikesh", 12, sigY + 18);
    doc.text("• Source: Reconciled from IEX Daily Settlement & NVVN Obligation statements.", 12, sigY + 22);

    // Right Sign-off Box
    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([1, 1], 0);
    doc.rect(boxX, sigY, boxW, boxH, 'S');
    doc.setLineDashPattern([], 0);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text("COMMERCIAL ANALYSIS & RECONCILIATION", boxX + 4, sigY + 4.5);
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, boxX + boxW - 4, sigY + 4.5, { align: 'right' });

    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(boxX + 4, sigY + 11.5, boxX + boxW - 4, sigY + 11.5);
    doc.setLineDashPattern([], 0);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text("(Physical Signature)", boxX + boxW - 4, sigY + 10.5, { align: 'right' });

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text("Mukul Singh", boxX + 4, sigY + 16);
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text("Assistant Manager (Commercial - Power Trading)", boxX + 4, sigY + 19.8);
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("Commercial - Power Trading Department, THDCIL, Rishikesh", boxX + 4, sigY + 23.5);

    // Save and download the file directly
    const filename = `THDC_11MW_Daily_Settlement_${dateToUse}.pdf`;
    doc.save(filename);

    // Provide user feedback
    showUndoToast(`✓ Auto-downloaded Daily Settlement PDF (${dateToUse})`, false);
    if ($("uploadStatusMsg")) {
      $("uploadStatusMsg").innerHTML += `<br><span class="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded bg-rose-100 text-rose-800 font-bold text-xs"><i class="fa-solid fa-file-pdf text-rose-600"></i> Daily Settlement PDF auto-downloaded (${filename})</span>`;
    }

    return filename;
  } catch (err) {
    console.error("Error generating daily settlement PDF:", err);
    return null;
  }
}
window.autoDownloadDailySettlementPDF = autoDownloadDailySettlementPDF;
window.downloadDailySettlementReport = autoDownloadDailySettlementPDF;

// ==========================================
// EXECUTIVE COLORFUL DASHBOARD PDF EXPORT ENGINE
// ==========================================
function downloadColorfulDashboardPDF() {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("PDF generation engine is initializing. Please try again in a moment.");
      return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('landscape', 'mm', 'a4');

    // Retrieve active filters
    const segVal = window.dashboardSegFilter || $('dashSegPills')?.querySelector('.active')?.getAttribute('data-seg') || 'ALL';
    const txnVal = window.dashboardTxnFilter || $('dashTxnPills')?.querySelector('.active')?.getAttribute('data-txn') || 'ALL';

    let trades = sortedTrades();
    if (segVal !== 'ALL') trades = trades.filter(t => (t.seg || 'G-DAM') === segVal);
    if (txnVal !== 'ALL') trades = trades.filter(t => (t.txn || 'SELL') === txnVal);

    if (!trades.length) {
      alert("No trade records available for the current dashboard filters.");
      return null;
    }

    const availableDates = [...new Set(trades.map(t => t.date))].sort();
    const startDate = availableDates[0] || 'N/A';
    const endDate = availableDates[availableDates.length - 1] || 'N/A';

    // Calculate executive KPIs
    const totalQ_MWh = roundPrecise(trades.reduce((s, x) => s + qtyMwh(x), 0));
    const totalQ_MU = totalQ_MWh / 1000;
    const totalGross = roundPrecise(trades.reduce((s, x) => s + amount(x), 0));
    const avgMcp = totalQ_MWh > 0 ? (totalGross / totalQ_MWh) : 0;

    // Deductions across active dates
    let totalGrid = 0;
    availableDates.forEach(d => {
      const o = obFor(d);
      totalGrid += (o.nldcApp || 0) + (o.nldcSched || 0) + (o.ctu || 0) + (o.stu || 0) + (o.sldc || 0) + (o.distribution || 0) + (o.other || 0);
    });
    totalGrid = roundPrecise(totalGrid);

    const pxFee = roundPrecise(totalQ_MWh * 1000 * pxRate);
    const pxGstAmt = roundPrecise(pxFee * (pxGst / 100));
    const totalPx = roundPrecise(pxFee + pxGstAmt);

    const nvvnMargin = roundPrecise(totalQ_MWh * 1000 * nvvnRate);
    const nvvnGstAmt = roundPrecise(nvvnMargin * (nvvnGst / 100));
    const totalNvvn = roundPrecise(nvvnMargin + nvvnGstAmt);

    const totalDeds = roundPrecise(totalGrid + totalPx + totalNvvn);
    const netRevenue = roundPrecise(totalGross - totalDeds);
    const effectiveTariff = totalQ_MWh > 0 ? (netRevenue / (totalQ_MWh * 1000)) : 0;

    // 1. Corporate Header with official emblem
    const logo = (typeof window !== "undefined" && window.THDC_LOGO_BASE64) || thdcilLogoDataUrl;
    if (logo) {
      try {
        doc.addImage(logo, 'PNG', 12, 7, 53.9, 13);
      } catch (e) {
        console.warn("Logo render error in dashboard PDF:", e);
      }
    }

    doc.setFontSize(13);
    doc.setTextColor(15, 43, 92); // Corporate Navy
    doc.setFont('helvetica', 'bold');
    doc.text("THDC INDIA LIMITED", 70, 11.5);

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'normal');
    doc.text("A Schedule 'A' Mini Ratna CPSU — Govt. of India Enterprise | Portfolio: N2UP0NVN0289", 70, 15.8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("11 MW Khurja Floating Solar Power Plant • Executive Commercial Dashboard & Settlement", 70, 19.8);

    // Prominent High-Visibility Market Segment & Transaction Badges
    doc.setFillColor(13, 148, 136); // Teal
    doc.roundedRect(158, 8, 38, 7.5, 1.5, 1.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text("SEGMENT: " + segVal, 177, 13, { align: 'center' });

    doc.setFillColor(txnVal === 'BUY' ? 225 : 5, txnVal === 'BUY' ? 29 : 150, txnVal === 'BUY' ? 72 : 105);
    doc.roundedRect(198, 8, 34, 7.5, 1.5, 1.5, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text("TXN: " + txnVal, 215, 13, { align: 'center' });

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Ref: THDC/11MW/COMM/DASH/${new Date().getFullYear()}`, 285, 10.5, { align: 'right' });
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 285, 14.5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text(`Period: ${startDate} to ${endDate}`, 285, 19.5, { align: 'right' });

    // Decorative Top Divider Bands (Corporate Navy & Emerald)
    doc.setFillColor(15, 43, 92);
    doc.rect(12, 23.5, 273, 1, 'F');
    doc.setFillColor(5, 150, 105);
    doc.rect(12, 24.5, 273, 0.4, 'F');

    // 2. Four Vibrant Colorful KPI Summary Cards (Larger Legible Typography)
    const cardY = 27.5;
    const cardH = 17.5;
    const cardW = 66;
    const gap = 3;

    // Card 1: Blue - Energy Output
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(12, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(191, 219, 254);
    doc.setLineWidth(0.3);
    doc.roundedRect(12, cardY, cardW, cardH, 2, 2, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text("TOTAL DISPATCHED ENERGY", 15, cardY + 4.8);
    doc.setFontSize(12.5);
    doc.setTextColor(29, 78, 216);
    doc.text(`${totalQ_MU.toFixed(3)} MU`, 15, cardY + 11.2);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`${formatIndianCurrency(totalQ_MWh)} MWh Injected (11 MW Khurja FSPP)`, 15, cardY + 15.2);

    // Card 2: Emerald - Gross Traded Proceeds
    const card2X = 12 + cardW + gap;
    doc.setFillColor(236, 253, 245);
    doc.roundedRect(card2X, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(167, 243, 208);
    doc.roundedRect(card2X, cardY, cardW, cardH, 2, 2, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(6, 95, 70);
    doc.text("GROSS TRADE VALUE", card2X + 3, cardY + 4.8);
    doc.setFontSize(12.5);
    doc.setTextColor(5, 120, 85);
    doc.text(`₹ ${formatIndianCurrency(totalGross)}`, card2X + 3, cardY + 11.2);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`IEX Spot Clearing Realization`, card2X + 3, cardY + 15.2);

    // Card 3: Amber - Weighted MCP
    const card3X = card2X + cardW + gap;
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(card3X, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(253, 230, 138);
    doc.roundedRect(card3X, cardY, cardW, cardH, 2, 2, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text("WEIGHTED AVERAGE MCP", card3X + 3, cardY + 4.8);
    doc.setFontSize(12.5);
    doc.setTextColor(180, 83, 9);
    doc.text(`₹ ${avgMcp.toFixed(2)} / MWh`, card3X + 3, cardY + 11.2);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`₹ ${(avgMcp / 1000).toFixed(2)} / kWh Average Clearing Price`, card3X + 3, cardY + 15.2);

    // Card 4: Violet - Net Settlement & Tariff
    const card4X = card3X + cardW + gap;
    doc.setFillColor(245, 243, 255);
    doc.roundedRect(card4X, cardY, cardW, cardH, 2, 2, 'F');
    doc.setDrawColor(221, 214, 254);
    doc.roundedRect(card4X, cardY, cardW, cardH, 2, 2, 'S');

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(91, 33, 182);
    doc.text("NET REALIZED REVENUE", card4X + 3, cardY + 4.8);
    doc.setFontSize(12.5);
    doc.setTextColor(109, 40, 217);
    doc.text(`₹ ${formatIndianCurrency(netRevenue)}`, card4X + 3, cardY + 11.2);
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Net Tariff: ₹ ${effectiveTariff.toFixed(3)} / unit (Post-Deds)`, card4X + 3, cardY + 15.2);

    // 3. Middle Section: Visual Chart (Left) + Monthly Summary Table (Right)
    const midY = 48;
    const chartW = 126;
    const chartH = 82;

    // Outer card for chart
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(12, midY, chartW, chartH, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(12, midY, chartW, chartH, 2, 2, 'S');

    // Chart header title banner
    doc.setFillColor(248, 250, 252);
    doc.rect(12, midY, chartW, 7, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.line(12, midY + 7, 12 + chartW, midY + 7);

    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("MONTHLY ENERGY & REVENUE PERFORMANCE TREND", 16, midY + 4.8);

    // Capture live Chart canvas
    const chartCanvas = document.getElementById("monthlyChart");
    let chartImg = null;
    if (chartCanvas) {
      try {
        chartImg = chartCanvas.toDataURL("image/png");
      } catch (err) {
        console.warn("Could not capture monthlyChart canvas data URL:", err);
      }
    }
    if (chartImg) {
      try {
        doc.addImage(chartImg, 'PNG', 13.5, midY + 8, chartW - 3, chartH - 9.5);
      } catch (e) {
        console.warn("Error drawing chart image in PDF:", e);
      }
    }

    // Monthly Data Aggregation for Table on the Right
    const monthlySummaryData = [];
    months.forEach(m => {
      const monthTrades = trades.filter(t => monthKey(t.date) === m);
      if (!monthTrades.length) return;
      const qMwh = roundPrecise(monthTrades.reduce((s, t) => s + qtyMwh(t), 0));
      const qMu = qMwh / 1000;
      const grossVal = roundPrecise(monthTrades.reduce((s, t) => s + amount(t), 0));
      const mMcp = qMwh > 0 ? (grossVal / qMwh) : 0;
      
      const mDates = [...new Set(monthTrades.map(t => t.date))];
      let mGrid = 0;
      mDates.forEach(d => {
        const o = obFor(d);
        mGrid += (o.nldcApp || 0) + (o.nldcSched || 0) + (o.ctu || 0) + (o.stu || 0) + (o.sldc || 0) + (o.distribution || 0) + (o.other || 0);
      });
      const mPx = roundPrecise(qMwh * 1000 * pxRate * (1 + pxGst / 100));
      const mNvvn = roundPrecise(qMwh * 1000 * nvvnRate * (1 + nvvnGst / 100));
      const mDed = roundPrecise(mGrid + mPx + mNvvn);
      const mNet = roundPrecise(grossVal - mDed);
      const mTariff = qMwh > 0 ? (mNet / (qMwh * 1000)) : 0;

      monthlySummaryData.push({
        label: mNames[m] || m,
        mu: qMu,
        mwh: qMwh,
        gross: grossVal,
        mcp: mMcp,
        ded: mDed,
        net: mNet,
        tariff: mTariff
      });
    });

    const tableX = 142;

    const mHead = [
      [
        { content: 'Month', styles: { halign: 'left' } },
        { content: 'Energy (MU)', styles: { halign: 'right' } },
        { content: 'Gross Value (₹)', styles: { halign: 'right' } },
        { content: 'Avg MCP (₹)', styles: { halign: 'right' } },
        { content: 'Deductions (₹)', styles: { halign: 'right' } },
        { content: 'Net Realized (₹)', styles: { halign: 'right' } },
        { content: 'Tariff (₹/u)', styles: { halign: 'right' } }
      ]
    ];

    const mBody = monthlySummaryData.map(x => [
      x.label,
      x.mu.toFixed(3),
      formatIndianCurrency(x.gross),
      x.mcp.toFixed(2),
      formatIndianCurrency(x.ded),
      formatIndianCurrency(x.net),
      x.tariff.toFixed(3)
    ]);

    const mFoot = [
      [
        'Total',
        totalQ_MU.toFixed(3),
        formatIndianCurrency(totalGross),
        avgMcp.toFixed(2),
        formatIndianCurrency(totalDeds),
        formatIndianCurrency(netRevenue),
        effectiveTariff.toFixed(3)
      ]
    ];

    doc.autoTable({
      head: mHead,
      body: mBody,
      foot: mFoot,
      startY: midY,
      margin: { left: tableX, right: 12 },
      theme: 'grid',
      headStyles: { fillColor: [15, 43, 92], textColor: 255, fontSize: 6.4, fontStyle: 'bold' },
      styles: { fontSize: 6.0, cellPadding: 1.6, halign: 'right', textColor: [30, 41, 59] },
      columnStyles: {
        0: { halign: 'left', fontStyle: 'bold', cellWidth: 20 },
        1: { halign: 'right', fontStyle: 'bold', textColor: [29, 78, 216], cellWidth: 19 },
        2: { halign: 'right', cellWidth: 23 },
        3: { halign: 'right', cellWidth: 18 },
        4: { halign: 'right', textColor: [225, 29, 72], cellWidth: 21 },
        5: { halign: 'right', fontStyle: 'bold', textColor: [5, 120, 85], cellWidth: 25 },
        6: { halign: 'right', fontStyle: 'bold', textColor: [91, 33, 182], cellWidth: 17 }
      },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 6.4 },
      didParseCell: function(data) {
        if (data.section === 'head') {
          if (data.column.index === 0) data.cell.styles.halign = 'left';
          else data.cell.styles.halign = 'right';
        }
        if (data.section === 'body') {
          if (data.column.index === 0) data.cell.styles.halign = 'left';
          else data.cell.styles.halign = 'right';
          if (data.column.index === 5) {
            data.cell.styles.fillColor = [240, 253, 244]; // Soft green tint
          }
        }
        if (data.section === 'foot') {
          if (data.column.index === 0) data.cell.styles.halign = 'left';
          else data.cell.styles.halign = 'right';
          if (data.column.index === 5) {
            data.cell.styles.textColor = [5, 120, 85];
          }
        }
      }
    });

    // 4. Operational Callout & Diurnal Dispatch Strip
    let nextY = Math.max(midY + chartH + 3.5, doc.lastAutoTable ? doc.lastAutoTable.finalY + 3.5 : 135);
    if (nextY > 162) {
      doc.addPage();
      nextY = 15;
    }

    // Callout box with colorful fill
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(12, nextY, 273, 15, 2, 2, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(12, nextY, 273, 15, 2, 2, 'S');

    doc.setFontSize(7.8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("COMMERCIAL DEDUCTIONS & DISPATCH RECONCILIATION SUMMARY", 16, nextY + 4.8);

    const dedPct = totalGross > 0 ? ((totalDeds / totalGross) * 100).toFixed(1) : "0.0";
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.text(`• Grid Corridor Transmission: ₹ ${formatIndianCurrency(totalGrid)} (STU/CTU/NLDC/SLDC charges applied as per CERC OA Regulations)`, 16, nextY + 9.2);
    doc.text(`• Power Exchange Fees (incl. 18% GST): ₹ ${formatIndianCurrency(totalPx)} (@ ₹ ${(pxRate * 1000).toFixed(2)}/MWh)  |  • NVVN Trader Margin (incl. 18% GST): ₹ ${formatIndianCurrency(totalNvvn)} (@ ₹ ${(nvvnRate * 1000).toFixed(2)}/MWh)`, 16, nextY + 13);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(225, 29, 72);
    doc.text(`Total Statutory Deductions: ₹ ${formatIndianCurrency(totalDeds)} (${dedPct}% of Gross)`, 281, nextY + 9.2, { align: 'right' });
    doc.setTextColor(5, 120, 85);
    doc.text(`Realized Settlement: ₹ ${formatIndianCurrency(netRevenue)} (Tariff: ₹ ${effectiveTariff.toFixed(3)}/u)`, 281, nextY + 13, { align: 'right' });

    // 5. Commercial Analysis & Sign-off Block (Mukul Singh)
    const sigY = nextY + 17.5;
    const boxW = 120;
    const boxH = 26;
    const boxX = 165;

    // Left Context Details
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("COMMERCIAL ANALYSIS & RECONCILIATION RECORD", 12, sigY + 5);
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text("• Plant Facility: 11 MW Khurja Floating Solar Power Plant (Khurja STPP, UP)", 12, sigY + 10);
    doc.text("• Commercial Analysis: Reconciled for energy trading, billing, and settlement analysis.", 12, sigY + 14);
    doc.text("• Department: Commercial - Power Trading Department, THDCIL, Rishikesh", 12, sigY + 18);
    doc.text("• Source: Reconciled from IEX Daily Settlement & NVVN Obligation statements.", 12, sigY + 22);

    // Right Sign-off Box
    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([1, 1], 0);
    doc.rect(boxX, sigY, boxW, boxH, 'S');
    doc.setLineDashPattern([], 0);

    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text("COMMERCIAL ANALYSIS & RECONCILIATION", boxX + 4, sigY + 4.5);
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, boxX + boxW - 4, sigY + 4.5, { align: 'right' });

    doc.setDrawColor(203, 213, 225);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(boxX + 4, sigY + 11.5, boxX + boxW - 4, sigY + 11.5);
    doc.setLineDashPattern([], 0);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text("(Physical Signature)", boxX + boxW - 4, sigY + 10.5, { align: 'right' });

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text("Mukul Singh", boxX + 4, sigY + 16);
    doc.setFontSize(7.5);
    doc.setTextColor(30, 41, 59);
    doc.text("Assistant Manager (Commercial - Power Trading)", boxX + 4, sigY + 19.8);
    doc.setFontSize(7.0);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 43, 92);
    doc.text("Commercial - Power Trading Department, THDCIL, Rishikesh", boxX + 4, sigY + 23.5);

    // Page footer (Clean, dignified, without stray "1" or "Page 1 of 1")
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text("THDC India Limited • 11 MW Khurja Floating Solar Power Plant • Commercial Analysis Record", 12, 203);
    doc.text("Certified Official Commercial Record", 285, 203, { align: 'right' });

    // Save and trigger browser download
    const filename = `THDC_11MW_Dashboard_Report_${segVal}_${txnVal}_${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(filename);
    showUndoToast(`✓ Downloaded Colorful Dashboard Report (${filename})`, false);

    return filename;
  } catch (err) {
    console.error("Error generating colorful dashboard PDF:", err);
    alert("Error generating Dashboard PDF. Please check console logs.");
    return null;
  }
}
window.downloadColorfulDashboardPDF = downloadColorfulDashboardPDF;
window.exportDashboardToPDF = downloadColorfulDashboardPDF;

// OFFICIAL MEMORANDUM PRINT & EXPORT ENGINE
function printOfficialMemo() {
  if (typeof renderReports === "function") {
    renderReports();
  }
  openOfficialMemoPrintModal();
}

function openOfficialMemoPrintModal() {
  const modal = document.getElementById("officialMemoPrintModal");
  if (!modal) return;

  // Retrieve filtered parameters
  const rs = $("reportStartDate")?.value || "ALL";
  const re = $("reportEndDate")?.value || "ALL";
  const segVal = $("reportSeg")?.value || "ALL";
  const txnVal = $("reportTxn")?.value || "ALL";
  const groupBy = ($("reportGroup")?.value || "day").toUpperCase();

  // Populate reference & dates
  const now = new Date();
  const year = now.getFullYear();
  const monthStr = String(now.getMonth() + 1).padStart(2, '0');
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const refElem = document.getElementById("memoDocRef");
  if (refElem) refElem.innerText = `Ref: THDC/11MW/COMM/MEMO/${year}/${monthStr}`;

  const dateElem = document.getElementById("memoDocDate");
  if (dateElem) dateElem.innerText = `Date: ${dateStr}`;

  document.querySelectorAll(".auto-report-date").forEach(el => {
    el.textContent = dateStr;
  });

  const scopeElem = document.getElementById("memoScopeText");
  if (scopeElem) {
    scopeElem.innerHTML = `Reconciliation Period: <strong>${rs}</strong> to <strong>${re}</strong> | Grouping: <strong>${groupBy}</strong> &nbsp;•&nbsp; <span class="px-2 py-0.5 rounded bg-teal-600 text-white font-extrabold text-[10px]">SEGMENT: ${segVal}</span> <span class="px-2 py-0.5 rounded ${txnVal === 'BUY' ? 'bg-rose-600' : 'bg-emerald-600'} text-white font-extrabold text-[10px]">TXN: ${txnVal}</span>`;
  }

  // Extract aggregated financial figures from report footer
  let totMwh = 0, avgMcp = 0, totGross = 0, totGrid = 0, totPx = 0, totNvvn = 0, totDed = 0, totNet = 0, netTariff = 0;
  const footRow = document.querySelector("#reportFoot tr");
  if (footRow) {
    const cols = Array.from(footRow.querySelectorAll("td")).map(td => td.innerText.replace(/[₹,]/g, '').trim());
    if (cols.length >= 11) {
      totMwh = parseFloat(cols[3]) || 0;
      avgMcp = parseFloat(cols[4]) || 0;
      totGross = parseFloat(cols[5]) || 0;
      totGrid = parseFloat(cols[6]) || 0;
      totPx = parseFloat(cols[7]) || 0;
      totNvvn = parseFloat(cols[8]) || 0;
      totDed = parseFloat(cols[9]) || 0;
      totNet = parseFloat(cols[10]) || 0;
      netTariff = parseFloat(cols[11]) || 0;
    }
  }

  // Helper formatting
  const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (document.getElementById("memoDeliveredEnergy")) {
    document.getElementById("memoDeliveredEnergy").innerText = `${totMwh.toFixed(3)} MWh`;
  }
  if (document.getElementById("memoDeliveredMu")) {
    document.getElementById("memoDeliveredMu").innerText = `(${(totMwh / 1000).toFixed(4)} MU)`;
  }
  if (document.getElementById("memoGrossValue")) {
    document.getElementById("memoGrossValue").innerText = `₹ ${fmt(totGross)}`;
  }
  if (document.getElementById("memoAvgMcp")) {
    document.getElementById("memoAvgMcp").innerText = `Avg MCP: ₹ ${fmt(avgMcp)}/MWh`;
  }
  if (document.getElementById("memoTotalDeductions")) {
    document.getElementById("memoTotalDeductions").innerText = `₹ ${fmt(totDed)}`;
  }
  if (document.getElementById("memoNetReceivable")) {
    document.getElementById("memoNetReceivable").innerText = `₹ ${fmt(totNet)}`;
  }
  if (document.getElementById("memoNetTariff")) {
    document.getElementById("memoNetTariff").innerText = `Net Realized: ₹ ${netTariff.toFixed(4)}/kWh`;
  }
  if (document.getElementById("memoRowGross")) {
    document.getElementById("memoRowGross").innerText = `₹ ${fmt(totGross)}`;
  }
  if (document.getElementById("memoRowGrid")) {
    document.getElementById("memoRowGrid").innerText = `₹ ${fmt(totGrid)}`;
  }
  if (document.getElementById("memoRowPx")) {
    document.getElementById("memoRowPx").innerText = `₹ ${fmt(totPx)}`;
  }
  if (document.getElementById("memoRowNvvn")) {
    document.getElementById("memoRowNvvn").innerText = `₹ ${fmt(totNvvn)}`;
  }
  if (document.getElementById("memoFootTariff")) {
    document.getElementById("memoFootTariff").innerText = `Effective Net Tariff: ₹ ${netTariff.toFixed(4)}/kWh`;
  }
  if (document.getElementById("memoFootNet")) {
    document.getElementById("memoFootNet").innerText = `₹ ${fmt(totNet)}`;
  }

  modal.classList.remove("hidden");
}

function closeOfficialMemoPrintModal() {
  const modal = document.getElementById("officialMemoPrintModal");
  if (modal) modal.classList.add("hidden");
}

function triggerBrowserPrint() {
  try {
    window.print();
  } catch (err) {
    console.warn("Direct window.print() failed, opening printable tab:", err);
    openPrintableMemoTab();
  }
}

function openPrintableMemoTab() {
  const rs = $("reportStartDate")?.value || "ALL";
  const re = $("reportEndDate")?.value || "ALL";
  const segVal = $("reportSeg")?.value || "ALL";
  const txnVal = $("reportTxn")?.value || "ALL";
  const groupBy = ($("reportGroup")?.value || "day").toUpperCase();

  let totMwh = 0, avgMcp = 0, totGross = 0, totGrid = 0, totPx = 0, totNvvn = 0, totDed = 0, totNet = 0, netTariff = 0;
  const footRow = document.querySelector("#reportFoot tr");
  if (footRow) {
    const cols = Array.from(footRow.querySelectorAll("td")).map(td => td.innerText.replace(/[₹,]/g, '').trim());
    if (cols.length >= 11) {
      totMwh = parseFloat(cols[3]) || 0;
      avgMcp = parseFloat(cols[4]) || 0;
      totGross = parseFloat(cols[5]) || 0;
      totGrid = parseFloat(cols[6]) || 0;
      totPx = parseFloat(cols[7]) || 0;
      totNvvn = parseFloat(cols[8]) || 0;
      totDed = parseFloat(cols[9]) || 0;
      totNet = parseFloat(cols[10]) || 0;
      netTariff = parseFloat(cols[11]) || 0;
    }
  }

  const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const refStr = `THDC/11MW/COMM/MEMO/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;

  const printableHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>THDCIL 11 MW Solar - Official Commercial Settlement Memorandum</title>
<style>
  @page { size: A4 portrait; margin: 15mm 12mm 15mm 12mm; }
  body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; color: #0f172a; margin: 0; padding: 20px; font-size: 13px; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #0f2b5c; padding-bottom: 12px; margin-bottom: 15px; }
  .title-block h1 { font-size: 18px; color: #0f2b5c; margin: 0 0 3px 0; font-weight: 800; }
  .title-block p { font-size: 11px; color: #475569; margin: 2px 0; }
  .ref-block { text-align: right; font-size: 11px; font-family: monospace; }
  .ref-block strong { color: #0f172a; }
  .subject-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; }
  .subject-box strong { color: #166534; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
  .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; text-align: left; }
  .kpi-card .lbl { font-size: 10px; text-transform: uppercase; color: #64748b; font-weight: 700; margin-bottom: 4px; }
  .kpi-card .val { font-size: 16px; font-weight: 800; color: #0f172a; }
  .kpi-card.highlight { background: #ecfdf5; border-color: #a7f3d0; }
  .kpi-card.highlight .val { color: #065f46; }
  .kpi-card.deduct .val { color: #b91c1c; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 12px; }
  th { background: #0f2b5c; color: #ffffff; font-weight: 700; text-align: right; padding: 8px 10px; }
  th:first-child { text-align: left; }
  td { padding: 7px 10px; border-bottom: 1px solid #e2e8f0; text-align: right; font-family: monospace; }
  td:first-child { text-align: left; font-family: inherit; font-weight: 500; }
  tfoot td { background: #f1f5f9; font-weight: 800; border-top: 2px solid #cbd5e1; }
  .sigs { display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; margin-top: 30px; }
  .sig-box { border: 1px dashed #94a3b8; border-radius: 6px; padding: 12px; min-height: 90px; display: flex; flex-direction: column; justify-content: space-between; }
  .sig-box .role-lbl { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .sig-box .desig { font-size: 11px; font-weight: 700; color: #0f172a; }
  .sig-box .dept { font-size: 10px; color: #64748b; }
  .footer-note { text-align: center; font-size: 10px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 8px; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div class="header">
    <div class="title-block">
      <h1>टीएचडीसी इंडिया लिमिटेड • THDC INDIA LIMITED</h1>
      <p><strong>A Schedule 'A' Mini Ratna CPSU — Govt. of India Enterprise</strong></p>
      <h2 style="font-size: 15px; font-weight: 800; color: #0f2b5c; margin-top: 2px;">11 MW Khurja Floating Solar Power Plant</h2>
      <p style="font-size: 11px; color: #475569;">Commercial - Power Trading Department, THDCIL, Rishikesh</p>
    </div>
    <div class="ref-block">
      <div><strong>${refStr}</strong></div>
      <div>Date: ${dateStr}</div>
      <div style="color: #1d4ed8; font-weight: bold;">Portfolio: N2UP0NVN0289</div>
      <div>Trader: NVVN Limited</div>
    </div>
  </div>

  <div class="subject-box" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
    <div>
      <div style="font-size: 14px; font-weight: 800; color: #166534;">SUBJECT: COMMERCIAL SETTLEMENT & REALIZATION MEMORANDUM</div>
      <div style="font-size: 11px; color: #334155; margin-top: 3px;">
        Reconciliation Period: <strong>${rs}</strong> to <strong>${re}</strong> | Aggregation: <strong>${groupBy}</strong>
      </div>
    </div>
    <div style="display: flex; gap: 8px; align-items: center;">
      <span style="background: #0d9488; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">MARKET SEGMENT: ${segVal}</span>
      <span style="background: ${txnVal === 'BUY' ? '#e11d48' : '#059669'}; color: #ffffff; padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">TXN TYPE: ${txnVal}</span>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="lbl">Delivered Energy</div>
      <div class="val">${totMwh.toFixed(3)} MWh</div>
      <div style="font-size: 10px; color: #64748b;">${(totMwh / 1000).toFixed(4)} MU</div>
    </div>
    <div class="kpi-card">
      <div class="lbl">Gross Trade Value</div>
      <div class="val">₹ ${fmt(totGross)}</div>
      <div style="font-size: 10px; color: #64748b;">Avg MCP: ₹ ${fmt(avgMcp)}/MWh</div>
    </div>
    <div class="kpi-card deduct">
      <div class="lbl">Total Deductions</div>
      <div class="val">₹ ${fmt(totDed)}</div>
      <div style="font-size: 10px; color: #64748b;">Grid + PX + NVVN</div>
    </div>
    <div class="kpi-card highlight">
      <div class="lbl">Net Realized to THDCIL</div>
      <div class="val">₹ ${fmt(totNet)}</div>
      <div style="font-size: 10px; font-weight: bold; color: #047857;">Tariff: ₹ ${netTariff.toFixed(4)}/kWh</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Commercial Reconciliation Item</th>
        <th>Applicable Tariff / Rate</th>
        <th>Statutory Amount (₹)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Gross Energy Traded Obligation (IEX)</td>
        <td>Market Clearing Price (MCP)</td>
        <td>₹ ${fmt(totGross)}</td>
      </tr>
      <tr>
        <td>Open Access & Grid Operational Charges</td>
        <td>NLDC / CTU / STU / SLDC</td>
        <td>₹ ${fmt(totGrid)}</td>
      </tr>
      <tr>
        <td>Power Exchange Transaction Fee + 18% GST</td>
        <td>₹ 0.0200 / kWh + GST</td>
        <td>₹ ${fmt(totPx)}</td>
      </tr>
      <tr>
        <td>NVVN Trading Margin + 18% GST</td>
        <td>₹ 0.0099 / kWh + GST</td>
        <td>₹ ${fmt(totNvvn)}</td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td>Net Settlement Amount Realized to THDCIL</td>
        <td>Effective Net Tariff: ₹ ${netTariff.toFixed(4)}/kWh</td>
        <td style="color: #065f46; font-size: 14px;">₹ ${fmt(totNet)}</td>
      </tr>
    </tfoot>
  </table>

  <div class="sigs">
    <div class="sig-box" style="background: #f8fafc;">
      <div style="font-size: 10px; font-weight: 800; color: #0f2b5c; text-transform: uppercase;">OFFICIAL COMMERCIAL RECORD</div>
      <div style="font-size: 11px; font-weight: 800; color: #0f172a; margin-top: 4px;">11 MW Khurja Floating Solar Power Plant</div>
      <div style="font-size: 10px; color: #475569; margin-top: 4px; line-height: 1.4;">
        Reconciled and certified energy injection, settlement prices, transmission open-access fees, and commercial receivables for official analysis.
      </div>
      <div style="font-size: 9.5px; color: #64748b; margin-top: 8px; font-weight: 600;">
        Commercial - Power Trading Department, THDCIL, Rishikesh
      </div>
    </div>
    <div class="sig-box">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="role-lbl">COMMERCIAL ANALYSIS BY</span>
        <span style="font-size: 8px; color: #047857; background: #ecfdf5; border: 1px solid #a7f3d0; padding: 1px 5px; border-radius: 3px; font-weight: 700;">Physical Sign / Stamp</span>
      </div>
      <div style="height: 38px; border-bottom: 1.5px dashed #cbd5e1; margin: 6px 0; display: flex; align-items: flex-end; justify-content: space-between;">
        <span style="font-size: 9px; color: #64748b; font-style: italic; font-weight: 500;">(Physical Signature)</span>
        <span style="font-size: 9px; color: #334155; font-weight: bold;">Date: ${dateStr}</span>
      </div>
      <div>
        <div class="desig" style="font-size: 12px; font-weight: 800; color: #0f172a;">Mukul Singh</div>
        <div style="font-size: 11px; font-weight: 700; color: #334155;">Assistant Manager (Commercial - Power Trading)</div>
        <div class="dept" style="font-size: 10px; font-weight: 800; color: #1e3a8a;">Commercial - Power Trading Department, THDCIL, Rishikesh</div>
        <div class="dept" style="font-size: 9.5px; color: #64748b; font-style: italic;">Using data for Commercial Analysis & Settlement</div>
      </div>
    </div>
  </div>

  <div class="footer-note">
    Certified true and verified extract of energy trading and commercial settlement records • 11 MW Khurja Floating Solar Power Plant
  </div>

  
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  <\/script>
</body>
</html>`;

  const blob = new Blob([printableHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  if (!win) {
    // Popup was blocked, trigger in-page print
    triggerBrowserPrint();
  }
}

window.printOfficialMemo = printOfficialMemo;
window.openOfficialMemoPrintModal = openOfficialMemoPrintModal;
window.closeOfficialMemoPrintModal = closeOfficialMemoPrintModal;
window.triggerBrowserPrint = triggerBrowserPrint;
window.openPrintableMemoTab = openPrintableMemoTab;


// OBLIGATIONS TAB
function loadObligation() {
  const d=$("oDate")?.value||"";
  const o=obFor(d);
  $("o_nldcApp").value=Number(o.nldcApp||0).toFixed(2);
  $("o_nldcSched").value=Number(
    o.nldcSched!==undefined ? o.nldcSched :
    ((o.nldcSchedBuy||0)+(o.nldcSchedSell||0))
  ).toFixed(2);
  $("o_ctu").value=Number(o.ctu||0).toFixed(2);
  $("o_stu").value=Number(o.stu||0).toFixed(2);
  $("o_sldc").value=Number(o.sldc||0).toFixed(2);
}

function saveObligation() {
  const d=$("oDate")?.value||"";
  if(!d){ alert("Please select Date."); return; }

  // These are the actual visible manual fields in this version.
  // NLDC Sched is a combined field, exactly as displayed in the table.
  const o={
    date:d,
    nldcApp:Math.abs(Number($("o_nldcApp")?.value)||0),
    nldcSched:Math.abs(Number($("o_nldcSched")?.value)||0),
    ctu:Math.abs(Number($("o_ctu")?.value)||0),
    stu:Math.abs(Number($("o_stu")?.value)||0),
    sldc:Math.abs(Number($("o_sldc")?.value)||0),
    // Keep the full eight-component model available; absent components are zero.
    nldcSchedBuy:0,
    nldcSchedSell:Math.abs(Number($("o_nldcSched")?.value)||0),
    distribution:0,
    other:0
  };

  pushUndoSnapshot(`Override Charges (${d})`);

  const i=state.obligations.findIndex(x=>x.date===d);
  if(i>=0) state.obligations[i]=o;
  else state.obligations.push(o);

  save();
  renderObligations();
  renderBilling();
  renderReports();
  updateUndoUI();

  const total=o.nldcApp+o.nldcSched+o.ctu+o.stu+o.sldc;
  showUndoToast(`Saved Charges for ${d} (₹${total.toFixed(2)})`, true);
  alert("Saved for "+d+" • Total Corridor Charges: ₹ "+total.toFixed(2));
}

function deleteObligation(date) {
  const o=state.obligations.find(x=>x.date===date);
  if(!o) return;
  const total=Math.abs(
    Number(o.nldcApp||0)+Number(o.nldcSched||0)+Number(o.ctu||0)+
    Number(o.stu||0)+Number(o.sldc||0)+Number(o.distribution||0)+Number(o.other||0));

  if(!confirm(`Delete corridor charges for ${date}?\nTotal: ₹${total.toFixed(2)}\n\nThis will remove only the corridor-charge record, not the 96-block trade data.`)) return;

  pushUndoSnapshot(`Delete Charges (${date})`);
  state.obligations=state.obligations.filter(x=>x.date!==date);
  save();
  renderObligations();
  renderBilling();
  renderReports();
  updateUndoUI();
  showUndoToast(`Deleted Charges for ${date} (₹${total.toFixed(2)})`, true);

  if($("oDate")?.value===date) loadObligation();
}

function applyObligationPeriod(){
  const s=$("obStartDate")?.value||"", e=$("obEndDate")?.value||"";
  if(s&&e&&s>e){alert("End Date cannot be before Start Date.");return;}
  window.obligationPeriod={start:s,end:e};
  if($("obPeriodStatus")) $("obPeriodStatus").textContent=`Applied: ${s||"All"} → ${e||"All"}`;
  renderObligations();
}
function clearObligationPeriod(){
  window.obligationPeriod={start:"",end:""};
  if($("obStartDate")) $("obStartDate").value="";
  if($("obEndDate")) $("obEndDate").value="";
  if($("obPeriodStatus")) $("obPeriodStatus").textContent="Showing all corridor-charge dates.";
  renderObligations();
}
function applyManualOverridePeriod(){
  const s=$("manualStartDate")?.value||"", e=$("manualEndDate")?.value||"";
  if(s&&e&&s>e){alert("End Date cannot be before Start Date.");return;}
  window.manualOverridePeriod={start:s,end:e};
  if($("manualPeriodStatus")) $("manualPeriodStatus").textContent=`Applied: ${s||"All"} → ${e||"All"}`;
  // Keep the existing obligation period in sync with the manual override period.
  window.obligationPeriod={start:s,end:e};
  if($("obStartDate")) $("obStartDate").value=s;
  if($("obEndDate")) $("obEndDate").value=e;
  renderObligations();
}
function clearManualOverridePeriod(){
  window.manualOverridePeriod={start:"",end:""};
  window.obligationPeriod={start:"",end:""};
  if($("manualStartDate")) $("manualStartDate").value="";
  if($("manualEndDate")) $("manualEndDate").value="";
  if($("obStartDate")) $("obStartDate").value="";
  if($("obEndDate")) $("obEndDate").value="";
  if($("manualPeriodStatus")) $("manualPeriodStatus").textContent="Showing all manual override dates.";
  renderObligations();
}
function renderObligations() {
  const bp=window.obligationPeriod||{start:"",end:""};
  const a=[...state.obligations]
    .filter(x=>(!bp.start||x.date>=bp.start)&&(!bp.end||x.date<=bp.end))
    .sort((x,y)=>x.date.localeCompare(y.date));
  $("obRows").innerHTML=a.map(o=>{
    const nldcApp = Math.abs(Number(o.nldcApp||0));
    const sched = Math.abs((Number(o.nldcSched)!==0 || o.nldcSched!==undefined)
      ? Number(o.nldcSched||0)
      : Number(o.nldcSchedBuy||0)+Number(o.nldcSchedSell||0));
    const ctu = Math.abs(Number(o.ctu||0));
    const stu = Math.abs(Number(o.stu||0));
    const sldc = Math.abs(Number(o.sldc||0));
    const dist = Math.abs(Number(o.distribution||0));
    const other = Math.abs(Number(o.other||0));
    const tot = nldcApp + sched + ctu + stu + sldc + dist + other;
    return `<tr class="hover:bg-slate-50 font-medium">
      <td class="p-3 text-left font-bold border-r">${o.date}</td>
      <td class="p-3">${nldcApp.toFixed(2)}</td>
      <td class="p-3">${sched.toFixed(2)}</td>
      <td class="p-3">${ctu.toFixed(2)}</td>
      <td class="p-3">${stu.toFixed(2)}</td>
      <td class="p-3 border-r">${sldc.toFixed(2)}</td>
      <td class="p-3 font-bold text-rose-600">₹ ${tot.toFixed(2)}</td>
        <td class="p-3 text-center">
          <button onclick="deleteObligation('${o.date}')"
            class="bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold px-3 py-1.5 rounded-lg text-[10px]"
            title="Delete this date's corridor charges">
            <i class="fa-solid fa-trash mr-1"></i>Delete
          </button>
        </td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="p-5 text-center text-slate-400">No corridor charge data saved.</td></tr>`;
}

window.obligationPeriod={start:"",end:""};
if(state.obligations.length){
  const oo=[...state.obligations].sort((a,b)=>a.date.localeCompare(b.date));
  if($("obStartDate")) $("obStartDate").value=oo[0].date;
  if($("obEndDate")) $("obEndDate").value=oo[oo.length-1].date;
  window.obligationPeriod={start:oo[0].date,end:oo[oo.length-1].date};
}
// Init — load the multi-month dataset from IndexedDB before rendering.
async function bootstrapSolarApp(){
  await loadStateFromIndexedDB();

  if (Array.isArray(state.obligations)) {
    state.obligations.forEach(o => {
      o.nldcApp = Math.abs(Number(o.nldcApp) || 0);
      o.nldcSched = Math.abs(Number(o.nldcSched) || 0);
      o.nldcSchedBuy = Math.abs(Number(o.nldcSchedBuy) || 0);
      o.nldcSchedSell = Math.abs(Number(o.nldcSchedSell) || 0);
      o.ctu = Math.abs(Number(o.ctu) || 0);
      o.stu = Math.abs(Number(o.stu) || 0);
      o.sldc = Math.abs(Number(o.sldc) || 0);
      o.distribution = Math.abs(Number(o.distribution) || 0);
      o.other = Math.abs(Number(o.other) || 0);
    });
  }

  let all=sortedTrades();
  if(all.length){
    let l=all[all.length-1].date;
    if($("tFrom"))$("tFrom").value=all[0].date;
    if($("tTo"))$("tTo").value=l;
    if($("oDate"))$("oDate").value=l;
    if($("clearDateInput"))$("clearDateInput").value=l;
    if($("heatmapDate"))$("heatmapDate").value=l;
  }
  renderDashboard();
  if(sortedTrades().length){
    if($("reportStartDate"))$("reportStartDate").value=sortedTrades()[0].date;
    if($("reportEndDate"))$("reportEndDate").value=sortedTrades()[sortedTrades().length-1].date;
  }
  renderReports();
  if(typeof renderObligations==="function")renderObligations();
  updateUndoUI();
}
bootstrapSolarApp();
