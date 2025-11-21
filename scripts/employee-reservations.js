import { db } from "./firebase.js";
import { 
    collection, 
    onSnapshot, 
    doc, 
    updateDoc, 
    deleteDoc,
    getDoc,
    addDoc,
    serverTimestamp,
    query,       // <-- NEW IMPORT
    where,       // <-- NEW IMPORT
    orderBy      // <-- NEW IMPORT
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Firestore collection reference
const reservationCollection = collection(db, "reservations");
const reservationTableBody = document.querySelector("#reservationTable tbody");

// --- Modal Elements ---
let imageModal, modalImage, closeImageModal;
let reservationMessageModal, confirmMessageBtn, cancelMessageBtn, notificationMessageTextarea, modalMessageTitle, reservationMessageForm;

// --- NEW: Filter & Dashboard Elements ---
let statusFilter, dateFilter, resetBtn;
let totalCard, pendingCard, approvedCard,todayCard;

// --- NEW: Listener Variables ---
let reservationListener = null; // For the dynamic table
let dashboardListener = null;  // For the persistent dashboard

// Global variable to store the pending action
let currentReservationAction = {
    id: null,
    newStatus: null,
    userId: null,
    date: null
};

// --- (Helper Functions are unchanged) ---
async function sendReservationNotification(userId, date, newStatus, customMessage = "") {
    if (!userId) return; 

    let message = "";
    if (newStatus === "approved") {
        message = `Your reservation for ${date} has been approved by the staff!`;
    } else if (newStatus === "completed") {
        message = `Your reservation for ${date} is complete. We hope you enjoyed your visit!`;
    } else if (newStatus === "canceled") {
        message = `Unfortunately, your reservation for ${date} has been canceled.`;
    } else {
        return; 
    }

    if (customMessage) {
        message += `<br><br><strong>Staff Message:</strong> "${customMessage}"`;
    }

    try {
        await addDoc(collection(db, "notifications"), {
            userId: userId,
            message: message,
            type: `reservation_${newStatus}`,
            link: "reservation.html",
            read: false,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Failed to send notification:", error);
    }
}

async function updateStatus(id, newStatus, message = "") {
  const docRef = doc(db, "reservations", id);
  try {
    await updateDoc(docRef, { status: newStatus });
    alert(`Reservation marked as ${newStatus}.`);

    const docSnap = await getDoc(docRef); 
    if (docSnap.exists()) {
        const data = docSnap.data();
        await sendReservationNotification(data.userId, data.date, newStatus, message);
    }
  } catch (error) {
    console.error("Error updating status:", error);
  }
}

async function deleteReservation(id) {
  if (!confirm("Are you sure you want to delete this reservation?")) return;
  const docRef = doc(db, "reservations", id);
  try {
    await updateDoc(docRef, { 
      status: "deleted",
      deletedAt: serverTimestamp()
    });
    alert("Reservation deleted successfully.");
  } catch (error) {
    console.error("Error deleting reservation:", error);
  }
}

function promptForMessage(id, newStatus, userId, date) {
    currentReservationAction = { id, newStatus, userId, date };
    if (newStatus === "approved") {
        modalMessageTitle.textContent = "Approve Reservation";
        notificationMessageTextarea.placeholder = "Optional: Add a welcome message...";
    } else if (newStatus === "completed") {
        modalMessageTitle.textContent = "Complete Reservation";
        notificationMessageTextarea.placeholder = "Optional: Add a 'thank you' message...";
    } else if (newStatus === "canceled") {
        modalMessageTitle.textContent = "Cancel Reservation";
        notificationMessageTextarea.placeholder = "Required: State a reason for cancellation...";
    }
    notificationMessageTextarea.value = "";
    reservationMessageModal.style.display = 'flex';
    notificationMessageTextarea.focus();
}
// --- MODIFIED: Function to load reservation history ---
// --- SIMPLIFIED: Function to load reservation history ---
function loadReservationHistory() {
    const historyTableBody = document.getElementById('reservation-history-table-body');
    if (!historyTableBody) {
        console.error("❌ History table body not found!");
        return;
    }

    console.log("📋 Loading reservation history...");

    // SIMPLIFIED: Just get all reservations without complex ordering
    const q = query(reservationCollection);

    onSnapshot(q, (snapshot) => {
        console.log(`✅ Found ${snapshot.size} reservations`);
        
        historyTableBody.innerHTML = "";

        if (snapshot.empty) {
            console.log("⚠️ No reservations found");
            historyTableBody.innerHTML = `
            <tr>
                <td colspan="10" style="text-align: center; padding: 20px; color: #999;">
                No reservation history found.
                </td>
            </tr>
            `;
            return;
        }

        // Convert to array and sort manually
        const reservations = [];
        snapshot.forEach((docSnap) => {
            reservations.push({ id: docSnap.id, ...docSnap.data() });
        });

        // Sort by date descending (most recent first)
        reservations.sort((a, b) => {
            if (a.date > b.date) return -1;
            if (a.date < b.date) return 1;
            if (a.time > b.time) return -1;
            if (a.time < b.time) return 1;
            return 0;
        });

        console.log("📊 Displaying reservations:", reservations.length);

        reservations.forEach((data) => {
            const row = document.createElement("tr");
            const status = data.status || "pending";

            // Build Pre-Order HTML
            let preOrderCell = "—";
            let preOrderModalHtml = '<p>No pre-order items.</p>';
            if (data.preOrder && data.preOrder.length > 0) {
                preOrderCell = `<ul class="pre-order-item-list">`;
                data.preOrder.forEach(item => {
                    preOrderCell += `<li>${item.quantity}x ${item.name}</li>`;
                });
                preOrderCell += `</ul>`;
                
                preOrderModalHtml = `<ul class="pre-order-item-list">`;
                data.preOrder.forEach(item => {
                    preOrderModalHtml += `<li><strong>${item.quantity}x</strong> ${item.name}</li>`;
                });
                preOrderModalHtml += `</ul>`;
            }

            let receiptCell = "—";
            if (data.paymentReceiptUrl) {
                receiptCell = `<button class="btn btn--secondary btn--sm view-receipt-btn" data-src="${data.paymentReceiptUrl}">View</button>`;
            }

            // Format date
            let formattedDate = data.date || "N/A";
            try {
                if (data.date) {
                    const parts = data.date.split('-');
                    if (parts.length === 3) {
                        formattedDate = `${parts[1]}/${parts[2]}/${parts[0].substring(2)}`;
                    }
                }
            } catch (e) { 
                console.warn("Could not format date:", data.date, e); 
            }

            // Format time
            let formattedTime = data.time || "N/A";
            if (data.time) {
                try {
                    const [hours, minutes] = data.time.split(':').map(Number);
                    const ampm = hours >= 12 ? 'PM' : 'AM';
                    let h = hours % 12;
                    if (h === 0) h = 12;
                    const m = String(minutes).padStart(2, '0');
                    formattedTime = `${h}:${m} ${ampm}`;
                } catch (e) { 
                    console.warn("Could not format time:", data.time, e); 
                }
            }

            // Display multiple tables correctly
            const tableDisplay = Array.isArray(data.tableNumbers) 
                ? data.tableNumbers.join(', ') 
                : (data.tableNumber || 'N/A');

            row.innerHTML = `
            <td>${data.name || 'N/A'}</td>
            <td>${data.contactNumber || 'N/A'}</td>
            <td>${tableDisplay}</td>
            <td>${formattedDate}</td>
            <td>${formattedTime}</td>
            <td>${data.numOfDiners || 'N/A'}</td>
            <td class="view-preorder" data-preorder-html="${encodeURIComponent(preOrderModalHtml)}">${preOrderCell}</td>
            <td>${receiptCell}</td>
            <td class="view-notes" data-notes="${data.notes || "No notes provided."}">${data.notes || "—"}</td>
            <td class="status ${status}">${status}</td>
            `;

            historyTableBody.appendChild(row);
        });

        console.log("✅ History table rendered successfully");

    }, (error) => {
        console.error("❌ Error loading reservation history:", error);
        historyTableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: red;">Error loading reservation history. Check console.</td></tr>`;
    });
}
// --- NEW: Function to load dashboard stats ---
// --- FIXED: Function to load dashboard stats ---
function loadReservationDashboard() {
    // Query to exclude deleted reservations from counts
    const q = query(
        reservationCollection,
        where("status", "!=", "deleted") // FIXED: Exclude deleted reservations
    );

    if (dashboardListener) dashboardListener(); // Detach old listener if it exists

    dashboardListener = onSnapshot(q, (snapshot) => {
        let totalCount = snapshot.size;
        let pendingCount = 0;
        let approvedCount = 0;
        let todayCount = 0;

        // Get today's date in "YYYY-MM-DD" format
        const today = new Date().toISOString().split('T')[0];

        snapshot.forEach(doc => {
            const data = doc.data();
            
            if (data.status === 'pending') {
                pendingCount++;
            }
            
            if (data.status === 'approved') {
                approvedCount++;
            }

            // Count any reservation for today (excluding deleted)
            if (data.date === today) {
                todayCount++;
            }
        });

        // Update the card text
        if (totalCard) totalCard.textContent = totalCount;
        if (pendingCard) pendingCard.textContent = pendingCount;
        if (approvedCard) approvedCard.textContent = approvedCount;
        if (todayCard) todayCard.textContent = todayCount;

        // Update sidebar alert dot
        const reservationsAlertDot = document.getElementById('reservations-alert-dot');
        if (reservationsAlertDot) {
            reservationsAlertDot.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }

    }, (error) => {
        console.error("Error loading reservation dashboard:", error);
        if (totalCard) totalCard.textContent = "E";
        if (pendingCard) pendingCard.textContent = "E";
        if (approvedCard) approvedCard.textContent = "E";
        if (todayCard) todayCard.textContent = "E";
    });
}



// --- MODIFIED: Function to load the FILTERED table ---
function loadReservationTable() {
    if (!reservationTableBody) return;

    if (reservationListener) {
        reservationListener();
    }

    const statusValue = statusFilter.value;
    const dateValue = dateFilter.value;

 let queryConstraints = [orderBy("date", "desc"), orderBy("time", "desc")];

// Always exclude deleted reservations from main table
queryConstraints.push(where("status", "!=", "deleted"));

if (statusValue && statusValue !== "all") {
    // This will be combined with the != "deleted" filter above
    queryConstraints.push(where("status", "==", statusValue));
}
    if (dateValue) {
        queryConstraints.push(where("date", "==", dateValue));
    }

    const q = query(reservationCollection, ...queryConstraints);

reservationListener = onSnapshot(q, (snapshot) => {
    reservationTableBody.innerHTML = ""; 

    if (snapshot.empty) {
        reservationTableBody.innerHTML = `
        <tr>
            <td colspan="11" style="text-align: center; padding: 20px; color: #999;">
            No reservations found matching your filters.
            </td>
        </tr>
        `;
        return;
    }

    // MODIFIED: Filter out deleted reservations manually
    let filteredDocs = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        // Skip deleted reservations in main table
        if (data.status !== "deleted") {
            filteredDocs.push(docSnap);
        }
    });

    if (filteredDocs.length === 0) {
        reservationTableBody.innerHTML = `
        <tr>
            <td colspan="11" style="text-align: center; padding: 20px; color: #999;">
            No reservations found matching your filters.
            </td>
        </tr>
        `;
        return;
    }

    filteredDocs.forEach((docSnap) => {
        const data = docSnap.data();
        const row = document.createElement("tr");
        const status = data.status || "pending";

        // --- NEW: Build Pre-Order HTML for modal and cell ---
        let preOrderCell = "—";
        let preOrderModalHtml = '<p>No pre-order items.</p>';
        if (data.preOrder && data.preOrder.length > 0) {
            // For the cell (truncated)
            preOrderCell = `<ul class="pre-order-item-list">`;
            data.preOrder.forEach(item => {
                preOrderCell += `<li>${item.quantity}x ${item.name}</li>`;
            });
            preOrderCell += `</ul>`;
            
            // For the modal (full list)
            preOrderModalHtml = `<ul class="pre-order-item-list">`;
            data.preOrder.forEach(item => {
                preOrderModalHtml += `<li><strong>${item.quantity}x</strong> ${item.name}</li>`;
            });
            preOrderModalHtml += `</ul>`;
        }

        let receiptCell = "—";
        if (data.paymentReceiptUrl) {
            receiptCell = `<button class="btn btn--secondary btn--sm view-receipt-btn" data-src="${data.paymentReceiptUrl}">View</button>`;
        }
        
        // --- (Date/Time formatting logic is unchanged) ---
        let formattedDate = data.date; 
        try {
            const parts = data.date.split('-');
            if (parts.length === 3) {
                formattedDate = `${parts[1]}/${parts[2]}/${parts[0].substring(2)}`; 
            }
        } catch (e) { console.warn("Could not format date:", data.date); }

        let formattedTime = data.time;
        if (data.time) {
            try {
                const [hours, minutes] = data.time.split(':').map(Number);
                const ampm = hours >= 12 ? 'PM' : 'AM';
                let h = hours % 12;
                if (h === 0) h = 12; 
                const m = String(minutes).padStart(2, '0');
                formattedTime = `${h}:${m} ${ampm}`;
            } catch (e) { console.warn("Could not format time:", data.time); }
        }

        // Display multiple tables correctly
        const tableDisplay = Array.isArray(data.tableNumbers) 
            ? data.tableNumbers.join(', ') 
            : (data.tableNumber || 'N/A');

        // --- (actionsHtml logic is unchanged) ---
        let actionsHtml = '';
        if (status === "pending") {
            actionsHtml = `<button class="btn-icon btn--icon-approve approve-btn" title="Approve Reservation" data-id="${docSnap.id}" data-user-id="${data.userId || ''}" data-date="${data.date}">✔️</button>`;
        } else if (status === "approved") {
            actionsHtml = `<button class="btn-icon btn--icon-complete complete-btn" title="Complete Reservation" data-id="${docSnap.id}" data-user-id="${data.userId || ''}" data-date="${data.date}">🏁</button>`;
        } else if (status === "completed") {
            actionsHtml = `<span class="status-text">Completed</span>`;
        } else if (status === "canceled") {
            actionsHtml = `<span class="status-text">Canceled</span>`;
        }
        if (status === "pending" || status === "approved") {
            actionsHtml += `<button class="btn-icon btn--icon-cancel cancel-btn" title="Cancel Reservation" data-id="${docSnap.id}" data-user-id="${data.userId || ''}" data-date="${data.date}">❌</button>`;
        }
        actionsHtml += `<button class="btn-icon btn--icon-delete delete-btn" title="Delete Reservation" data-id="${docSnap.id}">🗑️</button>`;

        row.innerHTML = `
        <td>${data.name}</td>
        <td>${data.contactNumber}</td>
        <td>${tableDisplay}</td>
        <td>${formattedDate}</td> 
        <td>${formattedTime}</td> 
        <td>${data.numOfDiners}</td>
        <td class="view-preorder" data-preorder-html="${encodeURIComponent(preOrderModalHtml)}">${preOrderCell}</td>
        <td>${receiptCell}</td>
        <td class="view-notes" data-notes="${data.notes || "No notes provided."}">${data.notes || "—"}</td>
        <td class="status ${status}">${status}</td>
        <td class="actions-cell">
            ${actionsHtml}
        </td>
        `;
        
        reservationTableBody.appendChild(row);
    });
}, (error) => {
    console.error("Error loading filtered reservations:", error);
    reservationTableBody.innerHTML = `<tr><td colspan="11">Error loading reservations.</td></tr>`;
    
    if (error.code === 'failed-precondition') {
        alert("A database query failed. This is likely because a required composite index is missing. Please check the browser console (F12) for a link to create the index in Firebase.");
    }
});
}

// --- MODIFIED: DOMContentLoaded listener ---
// --- MODIFIED: DOMContentLoaded listener ---
document.addEventListener('DOMContentLoaded', () => {
    // Get ALL elements
    imageModal = document.getElementById('image-view-modal');
    modalImage = document.getElementById('modal-image-src');
    closeImageModal = document.getElementById('close-image-modal');
    
    reservationMessageModal = document.getElementById('reservation-message-modal');
    reservationMessageForm = document.getElementById('reservation-message-form');
    modalMessageTitle = document.getElementById('modal-message-title');
    notificationMessageTextarea = document.getElementById('notification-message-textarea');
    confirmMessageBtn = document.getElementById('confirm-message-btn');
    cancelMessageBtn = document.getElementById('cancel-message-btn');

    // Get filter and card elements
    statusFilter = document.getElementById('reservation-filter-status');
    dateFilter = document.getElementById('reservation-filter-date');
    resetBtn = document.getElementById('reservation-reset-filters');
    totalCard = document.getElementById('analytics-total-res');
    pendingCard = document.getElementById('analytics-pending-res');
    
    // MODIFIED: Renamed and added card elements
    approvedCard = document.getElementById('analytics-approved-res'); // Renamed
    todayCard = document.getElementById('analytics-today-res');       // NEW

    // Load data on init
    loadReservationDashboard(); 
    loadReservationTable();    
    loadReservationHistory();
    
    // Add filter event listeners
    if (statusFilter) statusFilter.addEventListener('change', loadReservationTable);
    if (dateFilter) dateFilter.addEventListener('change', loadReservationTable);
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            statusFilter.value = 'all';
            dateFilter.value = '';
            loadReservationTable();
        });
    }

    // --- (Existing event listeners for table and modals are unchanged) ---
    if (reservationTableBody) {
        reservationTableBody.addEventListener('click', (e) => {
            const target = e.target;
            const button = target.closest('button');
            
            if (button) {
                const id = button.dataset.id;
                const userId = button.dataset.userId;
                const date = button.dataset.date;
                
                if (button.classList.contains('approve-btn')) {
                    promptForMessage(id, "approved", userId, date);
                } 
                else if (button.classList.contains('complete-btn')) {
                    promptForMessage(id, "completed", userId, date);
                } 
                else if (button.classList.contains('cancel-btn')) {
                    promptForMessage(id, "canceled", userId, date);
                } 
                else if (button.classList.contains('delete-btn')) {
                    deleteReservation(id);
                }
                else if (button.classList.contains('view-receipt-btn')) {
                    const imageUrl = button.dataset.src;
                    if (imageModal && modalImage && imageUrl) {
                        modalImage.src = imageUrl;
                        imageModal.style.display = 'flex';
                    }
                }
                return; 
            }

            const cell = target.closest('td');
            if (!cell) return; 

            if (cell.classList.contains('view-preorder')) {
                const preOrderHtml = cell.dataset.preorderHtml;
                const viewDetailsTitle = document.getElementById('view-details-title');
                const viewDetailsContent = document.getElementById('view-details-content');
                const viewDetailsModal = document.getElementById('view-details-modal');
                if (viewDetailsTitle) viewDetailsTitle.textContent = "Pre-Order Details";
                if (viewDetailsContent) viewDetailsContent.innerHTML = decodeURIComponent(preOrderHtml);
                if (viewDetailsModal) viewDetailsModal.style.display = 'flex';
            }
            else if (cell.classList.contains('view-notes')) {
                const notes = cell.dataset.notes;
                const viewDetailsTitle = document.getElementById('view-details-title');
                const viewDetailsContent = document.getElementById('view-details-content');
                const viewDetailsModal = document.getElementById('view-details-modal');
                if (viewDetailsTitle) viewDetailsTitle.textContent = "Reservation Notes";
                if (viewDetailsContent) viewDetailsContent.textContent = notes;
                if (viewDetailsModal) viewDetailsModal.style.display = 'flex';
            }
        });
    }
      const historyTableBody = document.getElementById('reservation-history-table-body');
    if (historyTableBody) {
        historyTableBody.addEventListener('click', (e) => {
            const target = e.target;
            const button = target.closest('button');
            
            // Handle receipt button clicks in history
            if (button && button.classList.contains('view-receipt-btn')) {
                const imageUrl = button.dataset.src;
                if (imageModal && modalImage && imageUrl) {
                    modalImage.src = imageUrl;
                    imageModal.style.display = 'flex';
                }
                return;
            }

            const cell = target.closest('td');
            if (!cell) return;

            // Handle pre-order cell clicks in history
            if (cell.classList.contains('view-preorder')) {
                const preOrderHtml = cell.dataset.preorderHtml;
                const viewDetailsTitle = document.getElementById('view-details-title');
                const viewDetailsContent = document.getElementById('view-details-content');
                const viewDetailsModal = document.getElementById('view-details-modal');
                if (viewDetailsTitle) viewDetailsTitle.textContent = "Pre-Order Details";
                if (viewDetailsContent) viewDetailsContent.innerHTML = decodeURIComponent(preOrderHtml);
                if (viewDetailsModal) viewDetailsModal.style.display = 'flex';
            }
            // Handle notes cell clicks in history
            else if (cell.classList.contains('view-notes')) {
                const notes = cell.dataset.notes;
                const viewDetailsTitle = document.getElementById('view-details-title');
                const viewDetailsContent = document.getElementById('view-details-content');
                const viewDetailsModal = document.getElementById('view-details-modal');
                if (viewDetailsTitle) viewDetailsTitle.textContent = "Reservation Notes";
                if (viewDetailsContent) viewDetailsContent.textContent = notes;
                if (viewDetailsModal) viewDetailsModal.style.display = 'flex';
            }
        });
    }
    const viewDetailsModal = document.getElementById('view-details-modal');
    const closeDetailsBtn = document.getElementById('close-details-btn');
    if (closeDetailsBtn) {
        closeDetailsBtn.addEventListener('click', () => {
            if (viewDetailsModal) viewDetailsModal.style.display = 'none';
        });
    }

    if (reservationMessageForm) {
        reservationMessageForm.addEventListener('submit', (e) => {
            e.preventDefault(); 
            const message = notificationMessageTextarea.value.trim();
            const { id, newStatus } = currentReservationAction;
            if (newStatus === 'canceled' && !message) {
                alert('Please provide a reason for cancellation.');
                return;
            }
            updateStatus(id, newStatus, message);
            reservationMessageModal.style.display = 'none';
        });
    }
    if (cancelMessageBtn) {
        cancelMessageBtn.addEventListener('click', () => {
            reservationMessageModal.style.display = 'none';
        });
    }
    if (closeImageModal) {
        closeImageModal.addEventListener('click', () => {
            if (imageModal) imageModal.style.display = 'none';
        });
    }
    if (imageModal) {
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal) {
                imageModal.style.display = 'none';
            }
        });
    }
});