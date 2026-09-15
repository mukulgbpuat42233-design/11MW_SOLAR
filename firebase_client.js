// Firebase Client Integration for THDCIL 11 MW Solar Portal
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut 
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js';
import { 
  getFirestore, 
  doc, 
  getDocFromServer, 
  collection, 
  query, 
  where, 
  getDocs, 
  setDoc, 
  deleteDoc 
} from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

let firebaseConfig = null;
let app = null;
let db = null;
let auth = null;
let currentUser = null;
let isConnected = false;

// Load Config
async function initFirebase() {
  try {
    const resp = await fetch('/firebase-applet-config.json');
    if (!resp.ok) throw new Error("Config not found");
    firebaseConfig = await resp.json();

    app = initializeApp(firebaseConfig);
    // CRITICAL: Must use firestoreDatabaseId from config
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    auth = getAuth(app);

    // Track Authentication state
    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      updateFirebaseUI(user);
      if (user) {
        await syncTradesFromCloud();
      }
    });

    // Test Firestore connection as mandated by skill without blocking
    testConnection().then(() => {
      console.log("Firebase initialized successfully for project:", firebaseConfig.projectId);
      updateFirebaseStatusBadge(true, "Firebase Connected");
    }).catch(err => {
      console.warn("Firebase initialization or connection test note:", err.message);
      updateFirebaseStatusBadge(false, "Offline / Local Mode");
    });

  } catch (err) {
    console.warn("Firebase initialization failed:", err.message);
    updateFirebaseStatusBadge(false, "Offline / Local Mode");
  }
}

// Skill-Mandated Connection Test
async function testConnection() {
  if (!db) return;
  try {
    await Promise.race([
      getDocFromServer(doc(db, 'test', 'connection')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
    ]);
    isConnected = true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
    if (error.message === 'timeout') {
      console.warn("Firestore connection test timed out.");
      isConnected = false;
      throw error;
    }
    // Note: permission errors on unseeded test docs are normal and verify server reachability
    isConnected = true;
  }
}

// Skill-Mandated Firestore Error Handler
const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
};

function handleFirestoreError(error, operationType, path) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid || null,
      email: auth?.currentUser?.email || null,
      emailVerified: auth?.currentUser?.emailVerified || false,
      isAnonymous: auth?.currentUser?.isAnonymous || false,
      providerInfo: auth?.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Authentication Helpers
async function signInWithGoogle() {
  if (!auth) {
    alert("Firebase Auth is still initializing. Please try again in a moment.");
    return;
  }
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    currentUser = result.user;
    updateFirebaseUI(currentUser);
    showFirebaseToast(`Signed in as ${currentUser.displayName || currentUser.email}`, "success");
    // Optionally sync state
    await syncTradesFromCloud();
  } catch (err) {
    console.error("Google Sign-In failed:", err);
    showFirebaseToast(`Sign-in note: ${err.message}`, "error");
  }
}

async function signOutUser() {
  if (!auth) return;
  try {
    await signOut(auth);
    currentUser = null;
    updateFirebaseUI(null);
    showFirebaseToast("Signed out of Cloud Session", "info");
  } catch (err) {
    console.error("Sign-out error:", err);
  }
}

// Save / Sync Trades to Cloud Firestore
async function syncTradesToCloud() {
  if (!currentUser) {
    showFirebaseToast("Please sign in with Google to sync records to Firebase Firestore Cloud.", "warning");
    signInWithGoogle();
    return;
  }
  if (!db) {
    showFirebaseToast("Firestore database not initialized.", "error");
    return;
  }

  const trades = window.state?.trades || [];
  if (trades.length === 0) {
    showFirebaseToast("No local trade records to sync.", "info");
    return;
  }

  const btn = document.getElementById("firebaseSyncBtn");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-amber-300"></i> Syncing...`;
  }

  try {
    let syncedCount = 0;
    // Batch in groups or individual docs for exact schema matching
    // Keep to active date blocks or latest 300 to stay within quota
    const subset = trades.slice(-300);
    for (const t of subset) {
      const docId = `trade_${t.date}_${t.block}`;
      const payload = {
        date: t.date,
        block: Number(t.block),
        qty: Number(t.qty || 0),
        mcp: Number(t.mcp || 0),
        seg: t.seg || "G-DAM",
        txn: t.txn || "SELL",
        userId: currentUser.uid,
        createdAt: new Date().toISOString()
      };

      try {
        await setDoc(doc(db, "trades", docId), payload);
        syncedCount++;
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `trades/${docId}`);
      }
    }

    showFirebaseToast(`Successfully synced ${syncedCount} records to Firebase Firestore!`, "success");
  } catch (err) {
    console.error("Firestore sync error:", err);
    showFirebaseToast(`Sync error: ${err.message}`, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up text-amber-300"></i> Sync Cloud`;
    }
  }
}

// Fetch Trades from Cloud Firestore
async function syncTradesFromCloud() {
  if (!currentUser || !db) return;
  try {
    const q = query(collection(db, "trades"), where("userId", "==", currentUser.uid));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const cloudTrades = [];
      snapshot.forEach(docSnap => {
        const d = docSnap.data();
        cloudTrades.push({
          date: d.date,
          block: d.block,
          qty: d.qty,
          mcp: d.mcp,
          seg: d.seg,
          txn: d.txn
        });
      });

      if (cloudTrades.length > 0 && window.state) {
        // Merge cloud trades with existing state without duplicates
        const existingMap = new Map();
        (window.state.trades || []).forEach(t => existingMap.set(`${t.date}_${t.block}`, t));
        cloudTrades.forEach(t => existingMap.set(`${t.date}_${t.block}`, t));
        window.state.trades = Array.from(existingMap.values());
        if (typeof window.save === "function") window.save();
        if (typeof window.refreshAllPages === "function") window.refreshAllPages();
        showFirebaseToast(`Loaded ${cloudTrades.length} records from Firebase Cloud`, "success");
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, "trades");
  }
}

// UI Helpers
function updateFirebaseStatusBadge(connected, text) {
  const badge = document.getElementById("firebaseStatusBadge");
  if (!badge) return;
  if (connected) {
    badge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40";
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> ${text}`;
  } else {
    badge.className = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-700/50 text-slate-300 border border-slate-600";
    badge.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ${text}`;
  }
}

function updateFirebaseUI(user) {
  const authContainer = document.getElementById("firebaseAuthControls");
  if (!authContainer) return;

  if (user) {
    authContainer.innerHTML = `
      <div class="flex items-center gap-2">
        <button id="firebaseSyncBtn" onclick="window.firebaseClient.syncTradesToCloud()" class="bg-amber-400/20 hover:bg-amber-400/30 text-amber-300 border border-amber-400/40 font-bold px-2.5 py-1 rounded-lg text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs" title="Sync local trades to Firebase Firestore">
          <i class="fa-solid fa-cloud-arrow-up text-amber-300"></i> <span class="hidden sm:inline">Sync Cloud</span>
        </button>
        <div class="flex items-center gap-1.5 bg-white/10 px-2 py-0.5 rounded-lg border border-white/20 text-xs">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="font-medium text-blue-100 max-w-[90px] truncate" title="${user.email}">${user.displayName || user.email.split('@')[0]}</span>
          <button onclick="window.firebaseClient.signOutUser()" class="ml-1 text-slate-300 hover:text-rose-300 transition text-[11px]" title="Sign Out">
            <i class="fa-solid fa-right-from-bracket"></i>
          </button>
        </div>
      </div>
    `;
  } else {
    authContainer.innerHTML = `
      <button onclick="window.firebaseClient.signInWithGoogle()" class="bg-white/10 hover:bg-white/20 text-white border border-white/25 font-bold px-2.5 py-1 rounded-lg text-xs transition flex items-center gap-1.5 cursor-pointer shadow-xs" title="Sign in with Google to sync records to Firebase Firestore">
        <i class="fa-brands fa-google text-amber-300"></i> <span>Sign In Cloud</span>
      </button>
    `;
  }
}

function showFirebaseToast(msg, type = "info") {
  if (typeof window.showUndoToast === "function") {
    window.showUndoToast(msg, type === "success");
  } else {
    console.log(`[Firebase ${type}]`, msg);
  }
}

// Export to window
window.firebaseClient = {
  initFirebase,
  signInWithGoogle,
  signOutUser,
  syncTradesToCloud,
  syncTradesFromCloud,
  testConnection,
  handleFirestoreError
};

// Auto-boot on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFirebase);
} else {
  initFirebase();
}
