import { db } from "./firebase.js";
import { 
  collection, 
  addDoc, 
  serverTimestamp,
  query,
  orderBy,
  onSnapshot,
  where, // Added where
  Timestamp // Added Timestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const inventoryLogsRef = collection(db, "inventoryLogs");

// --- ADDED: Listener variable to prevent memory leaks ---
let logListener = null;

/**
 * Creates a new inventory log entry.
 * This is the central function for all inventory tracking.
 * @param {string} employeeName - Name of the employee making the change.
 * @param {string} actionType - e.g., "Add Stock", "Wastage", "Sale Deduction", "Edit Category".
 * @param {string} itemName - The name of the item, category, or product.
 * @param {string} category - The category of the item.
 * @param {number} qtyChange - The amount changed (e.g., +10, -5). Use negative for deductions.
 * @param {string} unit - The unit of the quantity change (e.g., "g", "ml", "pcs").
 * @param {number} prevQty - The quantity before this action.
 * @param {number} newQty - The quantity after this action.
 * @param {string} reason - A brief reason for the change.
 */
export async function createLog(
  employeeName, 
  actionType, 
  itemName, 
  category, 
  qtyChange, 
  unit, 
  prevQty, 
  newQty, 
  reason
) {
  try {
    await addDoc(inventoryLogsRef, {
      timestamp: serverTimestamp(),
      employeeName: employeeName || "System",
      actionType: actionType,
      itemName: itemName,
      category: category || "N/A",
      qtyChange: qtyChange || 0,
      unit: unit || "N/A",
      prevQty: prevQty || 0,
      newQty: newQty || 0,
      reason: reason
    });
  } catch (error) {
    console.error("Failed to create inventory log:", error);
    // Don't block the main action, just log the error
  }
}

/**
 * Loads and displays the inventory log table
 * --- MODIFIED: Now reads from the date filter ---
 */
export function loadInventoryLog() {
  const logTableBody = document.getElementById("inventory-log-table-body");
  if (!logTableBody) return;

  // --- ADDED: Detach old listener ---
  if (logListener) {
    logListener(); // This stops the previous query
    logListener = null;
  }

  // --- ADDED: Get filter value ---
  const dateFilterSelect = document.getElementById("log-date-filter");
  const filterValue = dateFilterSelect ? dateFilterSelect.value : "all";
  let filterText = "All Time"; // For "no results" message

  let q; // Declare query variable
  let startTimestamp;
  const endTimestamp = Timestamp.now(); // We always query up to "now"

  // Use date-fns to get start dates
  const now = new Date();
  const { startOfDay, startOfWeek, startOfMonth } = dateFns;

  switch (filterValue) {
    case "today":
      startTimestamp = Timestamp.fromDate(startOfDay(now));
      filterText = "Today";
      q = query(inventoryLogsRef, 
            orderBy("timestamp", "desc"),
            where("timestamp", ">=", startTimestamp),
            where("timestamp", "<=", endTimestamp)
      );
      break;
    case "week":
      startTimestamp = Timestamp.fromDate(startOfWeek(now)); // Assumes week starts Sunday
      filterText = "This Week";
      q = query(inventoryLogsRef, 
            orderBy("timestamp", "desc"),
            where("timestamp", ">=", startTimestamp),
            where("timestamp", "<=", endTimestamp)
      );
      break;
    case "month":
      startTimestamp = Timestamp.fromDate(startOfMonth(now));
      filterText = "This Month";
      q = query(inventoryLogsRef, 
            orderBy("timestamp", "desc"),
            where("timestamp", ">=", startTimestamp),
            where("timestamp", "<=", endTimestamp)
      );
      break;
    case "all":
    default:
      // Default query (no date filter)
      q = query(inventoryLogsRef, orderBy("timestamp", "desc"));
  }
  
  // --- MODIFIED: Assign the listener to our variable ---
  logListener = onSnapshot(q, (snapshot) => {
    logTableBody.innerHTML = ""; // Clear old data

    if (snapshot.empty) {
      if (filterValue === "all") {
          logTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center;">No inventory logs found.</td></tr>`;
      } else {
          logTableBody.innerHTML = `<tr><td colspan="9" style="text-align: center;">No inventory logs found for ${filterText}.</td></tr>`;
      }
      return;
    }

    snapshot.forEach(doc => {
      const log = doc.data();
      const row = document.createElement("tr");

      // Format timestamp
      const date = log.timestamp ? log.timestamp.toDate().toLocaleString() : "---";
      
      // Format quantity change
      let qtyDisplay = "---";
      if (log.qtyChange !== 0 && log.qtyChange) { // Check for 0 or undefined/null
        const sign = log.qtyChange > 0 ? "+" : "";
        const color = log.qtyChange > 0 ? "var(--color-green-700)" : "var(--color-red-600)";
        qtyDisplay = `<strong style="color: ${color};">${sign}${log.qtyChange} ${log.unit || ''}</strong>`;
      }

      // Handle potential undefined values for prev/new Qty
      const prevQtyDisplay = (log.prevQty !== undefined) ? `${log.prevQty} ${log.unit || ''}` : "N/A";
      const newQtyDisplay = (log.newQty !== undefined) ? `${log.newQty} ${log.unit || ''}` : "N/A";

      row.innerHTML = `
        <td>${date}</td>
        <td>${log.employeeName || 'System'}</td>
        <td>${log.actionType || 'N/A'}</td>
        <td>${log.itemName || 'N/A'}</td>
        <td>${log.category || 'N/A'}</td>
        <td>${qtyDisplay}</td>
        <td>${prevQtyDisplay}</td>
        <td>${newQtyDisplay}</td>
        <td>${log.reason || 'N/A'}</td>
      `;
      logTableBody.appendChild(row);
    });

  }, (error) => {
    console.error("Error loading inventory logs:", error);
    logTableBody.innerHTML = `<tr><td colspan="9">Error loading logs.</td></tr>`;
  });
}

// --- ADDED: Event listeners for the new filter inputs ---
document.addEventListener('DOMContentLoaded', () => {
   const dateFilterSelect = document.getElementById("log-date-filter");

    if (dateFilterSelect) {
        dateFilterSelect.addEventListener('change', () => {
            // Re-load logs when the dropdown changes
            loadInventoryLog();
        });
    }
});