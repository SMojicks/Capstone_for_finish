// transaction.js
import { db } from "./firebase.js"; // adjust path if needed
import { 
  collection, 
  onSnapshot, 
  query, 
  orderBy 
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Keep track of the listener so we don't attach multiple
let transactionsListener = null;
// --- NEW: Cache for filtered transactions ---
let currentFilteredTransactions = [];

export async function loadTransactions(filter = "all") {
  const transactionsList = document.getElementById("transactions-list");
  if (!transactionsList) return;

  if (transactionsListener) {
    transactionsListener();
  }

  transactionsList.innerHTML = `<tr><td colspan="10">Loading...</td></tr>`;

  try {
    const transactionsRef = collection(db, "sales"); 
    const q = query(transactionsRef, orderBy("timestamp", "desc"));

    transactionsListener = onSnapshot(q, (snapshot) => {
      transactionsList.innerHTML = ""; 
      currentFilteredTransactions = []; // <-- NEW: Clear cache on update

      if (snapshot.empty) {
        transactionsList.innerHTML = `<tr><td colspan="10">No transactions found.</td></tr>`;
        return;
      }

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      
      const weekDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(weekDate.setDate(weekDate.getDate() - weekDate.getDay()));
      weekStart.setHours(0, 0, 0, 0);

      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      let transactionsFound = 0; 

      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        const ts = data.timestamp?.toDate();
        if (!ts) return;

        let include = false;
        switch (filter) {
          case "today":
            include = ts >= todayStart;
            break;
          case "week":
            include = ts >= weekStart;
            break;
          case "month":
            include = ts >= monthStart;
            break;
          default:
            include = true;
        }
        if (!include) return;

        transactionsFound++;
        
        // --- NEW: Process data for cache AND render ---
        const date = ts.toLocaleString();
        const processedBy = data.processedBy || "Unknown";
        const items = data.items?.map(i => `${i.quantity || i.quantitySold}× ${i.name}`).join(", ") || "—"; // Use ", " for export
        const itemsHTML = items.replace(/, /g, "<br>"); // Use <br> for HTML
        
        const subtotal = data.subtotal || 0;
        const tax = data.tax || 0;
        const total = data.totalAmount || 0;
        const paymentMethod = data.paymentMethod || "N/A";
        const orderId = data.orderId || "N/A";
        const status = data.status || "Completed"; 
        const statusText = status === "Completed" ? "Successful" : status;
        const statusClass = status === "Completed" ? "status-approved" : "status-blocked";
        const discountAmount = data.discountAmount || 0;
        const discountType = data.discountType || "none";
        let discountDisplay = "₱0.00";
        let discountExport = "₱0.00";
        if (discountAmount > 0) {
            const typeLabel = (discountType === 'none' || discountType === 'Custom') ? '' : ` (${discountType})`;
            discountDisplay = `<span style="color:var(--color-red-600);">(₱${discountAmount.toFixed(2)})${typeLabel}</span>`;
            discountExport = `(₱${discountAmount.toFixed(2)})${typeLabel}`;
        }

        // --- NEW: Add processed data to cache ---
        currentFilteredTransactions.push({
            orderId: `#${orderId}`,
            date: date,
            processedBy: processedBy,
            items: items, // Plain text for export
            subtotal: `₱${subtotal.toFixed(2)}`,
            tax: `₱${tax.toFixed(2)}`,
            discount: discountExport,
            total: `₱${total.toFixed(2)}`,
            paymentMethod: paymentMethod,
            status: statusText
        });

        const row = `
          <tr>
            <td><strong>#${orderId}</strong></td>
            <td>${date}</td>
            <td>${processedBy}</td>
            <td>${itemsHTML}</td> <td>₱${subtotal.toFixed(2)}</td>
            <td>₱${tax.toFixed(2)}</td>
            <td>${discountDisplay}</td>
            <td><strong>₱${total.toFixed(2)}</strong></td>
            <td>${paymentMethod}</td>
            <td><span class="status ${statusClass}">${statusText}</span></td>
          </tr>
        `;
        transactionsList.insertAdjacentHTML("beforeend", row);
      });

      if (transactionsFound === 0 && !snapshot.empty) {
        transactionsList.innerHTML = `<tr><td colspan="10">No transactions found for filter: ${filter}.</td></tr>`;
      }

    });

  } catch (error) {
    console.error("❌ Error loading transactions:", error);
    transactionsList.innerHTML = `<tr><td colspan="10">Error loading transactions.</td></tr>`;
    if (transactionsListener) transactionsListener();
  }
}

// --- NEW: Export to PDF function ---
function exportToPDF() {
    if (currentFilteredTransactions.length === 0) {
        alert("No data to export.");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const filterSelect = document.getElementById("filterRange");
    const filterText = filterSelect.options[filterSelect.selectedIndex].text;
    const filename = `Acaccia_Transactions_${filterText}.pdf`;

    doc.setFont("helvetica", "bold");
    doc.text("Acaccia Bistro Cafe - Transaction History", 14, 15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Report Filter: ${filterText}`, 14, 22);

    // Define columns
    const headers = [
        "Order ID", "Date", "Processed By", "Items", "Subtotal", 
        "Tax", "Discount", "Total", "Payment", "Status"
    ];

    // Map data from our cache
    const body = currentFilteredTransactions.map(row => [
        row.orderId,
        row.date,
        row.processedBy,
        row.items,
        row.subtotal,
        row.tax,
        row.discount,
        row.total,
        row.paymentMethod,
        row.status
    ]);

    doc.autoTable({
        head: [headers],
        body: body,
        startY: 28,
        theme: 'striped',
        headStyles: { fillColor: [31, 125, 74] }, // Your theme's green
        styles: { fontSize: 8 },
        columnStyles: {
            3: { cellWidth: 40 } // Widen "Items" column
        }
    });

    doc.save(filename);
}

// --- NEW: Export to Excel function ---
function exportToExcel() {
    if (currentFilteredTransactions.length === 0) {
        alert("No data to export.");
        return;
    }

    const filterSelect = document.getElementById("filterRange");
    const filterText = filterSelect.options[filterSelect.selectedIndex].text;
    const filename = `Acaccia_Transactions_${filterText}.xlsx`;

    // Create a new worksheet
    const ws = XLSX.utils.json_to_sheet(currentFilteredTransactions);
    
    // Auto-fit columns (basic version)
    const colWidths = [
        { wch: 10 }, // Order ID
        { wch: 20 }, // Date
        { wch: 15 }, // Processed By
        { wch: 50 }, // Items
        { wch: 10 }, // Subtotal
        { wch: 10 }, // Tax
        { wch: 15 }, // Discount
        { wch: 10 }, // Total
        { wch: 15 }, // Payment
        { wch: 12 }  // Status
    ];
    ws["!cols"] = colWidths;

    // Create a new workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");

    // Write and download the file
    XLSX.writeFile(wb, filename);
}


// --- Event Listener for Sidebar Tab ---
document.addEventListener("DOMContentLoaded", () => {
  const transactionsTab = document.querySelector('[data-section="transactions"]');
  const filterRange = document.getElementById("filterRange");
  
  // --- NEW: Export Button Listeners ---
  const exportPdfBtn = document.getElementById("export-pdf-btn");
  const exportExcelBtn = document.getElementById("export-excel-btn");

  if (transactionsTab) {
    transactionsTab.addEventListener("click", () => loadTransactions(filterRange.value || "all"));
  }

  if (filterRange) {
    filterRange.addEventListener("change", (e) => {
      loadTransactions(e.target.value);
    });
  }

  // --- NEW: Attach export functions ---
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener("click", exportToPDF);
  }
  if (exportExcelBtn) {
    exportExcelBtn.addEventListener("click", exportToExcel);
  }
});