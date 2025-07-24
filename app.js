// BTSA Stall Booking – app.js (ES6 Module)
// IMPORTANT: Insert your Firebase config below to enable real-time sync.
// The application falls back to an in-memory mock database when config
// still contains the placeholder values (YOUR_KEY, YOUR_PID, etc.).

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collection as fsCollection,
  doc as fsDoc,
  onSnapshot as fsOnSnapshot,
  runTransaction as fsRunTransaction,
  serverTimestamp as fsServerTimestamp,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/*************************************
 * 1. Firebase configuration
 *************************************/
// ======= FIREBASE CONFIG PLACEHOLDER =======
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_AUTH",
  projectId: "YOUR_PID",
};

/*************************************
 * 2. Utility — Detect placeholder cfg
 *************************************/
function isPlaceholder(cfg) {
  return (
    !cfg ||
    cfg.apiKey?.startsWith("YOUR_") ||
    cfg.projectId === "YOUR_PID" ||
    cfg.apiKey === "" ||
    cfg.projectId === ""
  );
}
const USE_FAKE_DB = isPlaceholder(firebaseConfig);

/*************************************
 * 3. Lightweight Fake Firestore
 *************************************/
function createFakeFirestore() {
  const data = {}; // { id: { company, timestamp } }
  const listeners = [];
  const bc = self.BroadcastChannel ? new BroadcastChannel("btsa-stalls") : null;

  function emit() {
    const snap = {
      docs: Object.keys(data).map((id) => ({ id, data: () => data[id] })),
    };
    listeners.forEach((cb) => cb(snap));
  }

  if (bc) {
    bc.onmessage = (e) => {
      if (e.data?.type === "sync") {
        Object.assign(data, e.data.payload);
        emit();
      }
    };
  }

  return {
    collection: (name) => name,
    doc: (col, id) => id.toString(),
    onSnapshot: (col, cb) => {
      listeners.push(cb);
      emit(); // initial
      return () => {
        const idx = listeners.indexOf(cb);
        if (idx > -1) listeners.splice(idx, 1);
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(id) {
          const exists = Object.prototype.hasOwnProperty.call(data, id);
          return { exists: () => exists, data: () => data[id] };
        },
        set(id, value) {
          data[id] = value;
        },
      };
      await fn(tx);
      emit();
      if (bc) bc.postMessage({ type: "sync", payload: structuredClone(data) });
    },
    serverTimestamp: () => Date.now(),
  };
}

/*************************************
 * 4. Database facade selection
 *************************************/
let db;
let _collection,
  _doc,
  _onSnapshot,
  _runTransaction,
  _serverTimestamp;

if (USE_FAKE_DB) {
  console.warn("[BTSA] Running with mock DB – real-time sync via BroadcastChannel only.");
  db = createFakeFirestore();
  _collection = db.collection;
  _doc = db.doc;
  _onSnapshot = db.onSnapshot;
  _runTransaction = db.runTransaction;
  _serverTimestamp = db.serverTimestamp;
} else {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  _collection = fsCollection;
  _doc = fsDoc;
  _onSnapshot = fsOnSnapshot;
  _runTransaction = fsRunTransaction.bind(null, db);
  _serverTimestamp = fsServerTimestamp;
}

/*************************************
 * 5. DOM references & constants
 *************************************/
const TOTAL_STALLS = 38;
const form = document.getElementById("bookingForm");
const companyInput = document.getElementById("company");
const stallSelect = document.getElementById("stallSelect");
const bookBtn = document.getElementById("bookBtn");
const grid = document.getElementById("grid");
const statusMsg = document.getElementById("statusMsg");

/*************************************
 * 6. UI helpers
 *************************************/
function setStatus(message, type = "info") {
  statusMsg.textContent = message;
  statusMsg.style.color =
    type === "error"
      ? "var(--color-error)"
      : type === "success"
      ? "var(--color-success)"
      : "var(--color-text)";
}
function toggleForm(disabled) {
  [companyInput, stallSelect, bookBtn].forEach((el) => (el.disabled = disabled));
}

/*************************************
 * 7. Rendering functions
 *************************************/
function renderGrid(bookedSet) {
  grid.innerHTML = "";

  const avail = [];
  for (let i = 1; i <= TOTAL_STALLS; i++) {
    const idStr = i.toString();
    const booked = bookedSet.has(idStr);
    if (!booked) avail.push(i);

    const cell = document.createElement("div");
    cell.className = `stall ${booked ? "booked" : "available"}`;
    cell.setAttribute("role", "gridcell");
    cell.dataset.id = idStr;
    cell.textContent = i;
    grid.appendChild(cell);
  }

  // Dropdown population
  stallSelect.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Select stall";
  ph.selected = true;
  ph.disabled = true; // still allows opening in all browsers
  stallSelect.appendChild(ph);

  avail.forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = `Stall ${n}`;
    stallSelect.appendChild(o);
  });

  if (avail.length === 0) {
    toggleForm(true);
    setStatus("All stalls are booked.", "info");
  } else {
    toggleForm(false);
  }
}

/*************************************
 * 8. Real-time snapshot listener
 *************************************/
(function initRealtime() {
  const col = _collection(db, "stalls");
  _onSnapshot(col, (snap) => {
    const bookedSet = new Set(snap.docs.map((d) => d.id));
    renderGrid(bookedSet);
  });
})();

/*************************************
 * 9. Click-to-select on grid (bonus UX)
 *************************************/
grid.addEventListener("click", (e) => {
  const cell = e.target.closest(".stall.available");
  if (!cell) return;
  // Remove existing highlight
  grid.querySelectorAll(".stall").forEach((c) => c.classList.remove("selected"));
  cell.classList.add("selected");

  stallSelect.value = cell.dataset.id;
  // Ensure dropdown reflects selection
  stallSelect.dispatchEvent(new Event("change"));
});

/*************************************
 * 10. Booking submission handler
 *************************************/
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  const company = companyInput.value.trim();
  const stallNo = stallSelect.value;
  if (!company) {
    setStatus("Company name is required.", "error");
    return;
  }
  if (!stallNo) {
    setStatus("Please select a stall.", "error");
    return;
  }

  toggleForm(true);
  setStatus("Booking…");

  try {
    const ref = _doc(db, "stalls", stallNo);
    await _runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error("taken");
      tx.set(ref, { company, timestamp: _serverTimestamp() });
    });

    setStatus(`Stall ${stallNo} booked for ${company}.`, "success");
    form.reset();
    // Remove grid selection highlight
    grid.querySelectorAll(".stall").forEach((c) => c.classList.remove("selected"));
  } catch (err) {
    if (err.message === "taken") {
      setStatus("Stall already taken. Please choose another.", "error");
    } else {
      setStatus("Booking failed – please retry.", "error");
      console.error(err);
    }
  } finally {
    toggleForm(false);
  }
});

/*************************************
 * 11. Global error handler – user-friendly
 *************************************/
window.addEventListener("error", (e) => {
  console.error("[BTSA] Uncaught error:", e.error);
  setStatus("Unexpected error occurred. Check console.", "error");
});
