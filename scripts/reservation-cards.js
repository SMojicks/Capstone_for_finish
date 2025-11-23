// reservation-cards.js - Card-based UI for Reservations

import { db } from './firebase.js';
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    updateDoc, 
    doc, 
    orderBy,
    addDoc,
    serverTimestamp,
    getDoc
} from 'https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js';

let currentFilter = 'all';
let currentDateFilter = null;

// Initialize cards view
export function initReservationCards() {
    console.log('🎴 Initializing reservation cards...');
    setupFilterListeners();
    loadReservationCards();
}

// Setup filter listeners
function setupFilterListeners() {
    const statusFilter = document.getElementById('reservation-filter-status');
    const dateFilter = document.getElementById('reservation-filter-date');
    const resetBtn = document.getElementById('reservation-reset-filters');

    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            loadReservationCards();
        });
    }

    if (dateFilter) {
        dateFilter.addEventListener('change', (e) => {
            currentDateFilter = e.target.value;
            loadReservationCards();
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            currentFilter = 'all';
            currentDateFilter = null;
            if (statusFilter) statusFilter.value = 'all';
            if (dateFilter) dateFilter.value = '';
            loadReservationCards();
        });
    }
}

// Load and display reservation cards
function loadReservationCards() {
    const container = document.getElementById('reservations-cards-container');
    const emptyState = document.getElementById('reservations-empty-state');
    
    if (!container || !emptyState) {
        console.warn('⚠️ Reservation cards container not found');
        return;
    }

    console.log('📋 Loading reservation cards with filter:', currentFilter);

    // FIXED: Build query to show only ACTIVE reservations (pending & approved)
    let queryConstraints = [orderBy('date', 'desc')];

    if (currentFilter !== 'all') {
        // If specific status selected, show only that status
        queryConstraints.push(where('status', '==', currentFilter));
    } else {
        // Default: Show only pending and approved (ACTIVE reservations)
        queryConstraints.push(where('status', 'in', ['pending', 'approved']));
    }

    // Apply date filter if set
    if (currentDateFilter) {
        queryConstraints.push(where('date', '==', currentDateFilter));
    }

    const q = query(collection(db, 'reservations'), ...queryConstraints);

    onSnapshot(q, (snapshot) => {
        console.log(`✅ Found ${snapshot.size} active reservations`);
        container.innerHTML = '';
        let filteredReservations = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            filteredReservations.push({ id: docSnap.id, ...data });
        });

        // Show empty state or cards
        if (filteredReservations.length === 0) {
            emptyState.classList.remove('hidden');
            container.classList.add('hidden');
        } else {
            emptyState.classList.add('hidden');
            container.classList.remove('hidden');
            
            filteredReservations.forEach(reservation => {
                const card = createReservationCard(reservation);
                container.appendChild(card);
            });
        }

        // Update analytics
        updateReservationAnalytics(snapshot.docs);
    }, (error) => {
        console.error('❌ Error loading reservations:', error);
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: red;">Error loading reservations. Check console.</div>`;
    });
}

// Create a single reservation card
function createReservationCard(reservation) {
    const card = document.createElement('div');
    card.className = 'reservation-card';
    card.dataset.id = reservation.id;

    const statusClass = reservation.status || 'pending';
    const statusText = getStatusText(reservation.status);

    // Format date
    let formattedDate = reservation.date || 'N/A';
    try {
        if (reservation.date) {
            const parts = reservation.date.split('-');
            if (parts.length === 3) {
                formattedDate = `${parts[1]}/${parts[2]}/${parts[0]}`;
            }
        }
    } catch (e) {
        console.warn('Could not format date:', reservation.date);
    }

    // Format time
    let formattedTime = reservation.time || 'N/A';
    if (reservation.time) {
        try {
            const [hours, minutes] = reservation.time.split(':').map(Number);
            const ampm = hours >= 12 ? 'PM' : 'AM';
            let h = hours % 12;
            if (h === 0) h = 12;
            const m = String(minutes).padStart(2, '0');
            formattedTime = `${h}:${m} ${ampm}`;
        } catch (e) {
            console.warn('Could not format time:', reservation.time);
        }
    }

    // Display multiple tables correctly
    const tableDisplay = Array.isArray(reservation.tableNumbers) 
        ? reservation.tableNumbers.join(', ') 
        : (reservation.tableNumber || reservation.table || 'N/A');

    card.innerHTML = `
        <!-- Card Header -->
        <div class="reservation-card-header">
            <div class="reservation-card-info">
                <h3 class="reservation-customer-name">
                    <span class="material-icons">person</span>
                    ${reservation.name || reservation.customerName || 'Guest'}
                </h3>
                <div class="reservation-contact">
                    <span class="material-icons">phone</span>
                    ${reservation.contactNumber || 'N/A'}
                </div>
            </div>
            <span class="reservation-status-badge ${statusClass}">
                ${statusText}
            </span>
        </div>

        <!-- Card Body -->
        <div class="reservation-card-body">
            <div class="reservation-details-grid">
                <!-- Date -->
                <div class="reservation-detail-item">
                    <div class="reservation-detail-icon">
                        <span class="material-icons">event</span>
                    </div>
                    <div class="reservation-detail-content">
                        <div class="reservation-detail-label">Date</div>
                        <div class="reservation-detail-value">${formattedDate}</div>
                    </div>
                </div>

                <!-- Time -->
                <div class="reservation-detail-item">
                    <div class="reservation-detail-icon">
                        <span class="material-icons">schedule</span>
                    </div>
                    <div class="reservation-detail-content">
                        <div class="reservation-detail-label">Time</div>
                        <div class="reservation-detail-value">${formattedTime}</div>
                    </div>
                </div>

                <!-- Table -->
                <div class="reservation-detail-item">
                    <div class="reservation-detail-icon">
                        <span class="material-icons">table_restaurant</span>
                    </div>
                    <div class="reservation-detail-content">
                        <div class="reservation-detail-label">Table</div>
                        <div class="reservation-detail-value">${tableDisplay}</div>
                    </div>
                </div>

                <!-- Diners -->
                <div class="reservation-detail-item">
                    <div class="reservation-detail-icon">
                        <span class="material-icons">groups</span>
                    </div>
                    <div class="reservation-detail-content">
                        <div class="reservation-detail-label">Diners</div>
                        <div class="reservation-detail-value">${reservation.numOfDiners || reservation.numberOfDiners || 0} People</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Card Footer -->
        <div class="reservation-card-footer">
            <!-- Action Buttons -->
            <div class="reservation-actions-row">
                ${generateActionButtons(reservation)}
            </div>

            <!-- Secondary Actions -->
            <div class="reservation-secondary-actions">
                <button class="reservation-view-btn" onclick="window.viewReservationReceipt('${reservation.id}')">
                    <span class="material-icons">receipt</span>
                    Receipt
                </button>
                <button class="reservation-view-btn" onclick="window.viewPreOrder('${reservation.id}')">
                    <span class="material-icons">restaurant_menu</span>
                    Pre-Order
                </button>
                <button class="reservation-view-btn" onclick="window.viewReservationNotes('${reservation.id}')">
                    <span class="material-icons">notes</span>
                    Notes
                </button>
            </div>
        </div>
    `;

    return card;
}

// Generate action buttons based on status
function generateActionButtons(reservation) {
    const status = reservation.status || 'pending';
    
    if (status === 'pending') {
        return `
            <button class="btn-icon btn--icon-approve" onclick="window.approveReservation('${reservation.id}', '${reservation.userId || ''}', '${reservation.date}')" title="Approve">
                <span class="material-icons">check_circle</span>
            </button>
            <button class="btn-icon btn--icon-cancel" onclick="window.cancelReservation('${reservation.id}', '${reservation.userId || ''}', '${reservation.date}')" title="Cancel">
                <span class="material-icons">cancel</span>
            </button>
        `;
    } else if (status === 'approved') {
        return `
            <button class="btn-icon btn--icon-complete" onclick="window.completeReservation('${reservation.id}', '${reservation.userId || ''}', '${reservation.date}')" title="Complete">
                <span class="material-icons">done_all</span>
            </button>
            <button class="btn-icon btn--icon-cancel" onclick="window.cancelReservation('${reservation.id}', '${reservation.userId || ''}', '${reservation.date}')" title="Cancel">
                <span class="material-icons">cancel</span>
            </button>
        `;
    } else {
        return `<span class="status-text">${getStatusText(status)}</span>`;
    }
}

// Helper functions
function getStatusText(status) {
    const statusMap = {
        'pending': 'Pending',
        'approved': 'Approved',
        'completed': 'Completed',
        'canceled': 'Canceled'
    };
    return statusMap[status] || 'Unknown';
}

function updateReservationAnalytics(docs) {
    const stats = {
        total: 0,
        pending: 0,
        approved: 0,
        today: 0
    };

    const today = new Date().toISOString().split('T')[0];

    docs.forEach(doc => {
        const data = doc.data();
        stats.total++;
        if (data.status === 'pending') stats.pending++;
        if (data.status === 'approved') stats.approved++;
        if (data.date === today) stats.today++;
    });

    // Update analytics cards
    const totalEl = document.getElementById('analytics-total-res');
    const pendingEl = document.getElementById('analytics-pending-res');
    const approvedEl = document.getElementById('analytics-approved-res');
    const todayEl = document.getElementById('analytics-today-res');

    if (totalEl) totalEl.textContent = stats.total;
    if (pendingEl) pendingEl.textContent = stats.pending;
    if (approvedEl) approvedEl.textContent = stats.approved;
    if (todayEl) todayEl.textContent = stats.today;

    // Update sidebar alert dot
    const alertDot = document.getElementById('reservations-alert-dot');
    if (alertDot) {
        alertDot.style.display = stats.pending > 0 ? 'inline-block' : 'none';
    }
}

// Helper function to send notification
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

// Make functions globally available
window.viewReservationReceipt = async function(id) {
    const docRef = doc(db, 'reservations', id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.paymentReceiptUrl) {
            const imageModal = document.getElementById('image-view-modal');
            const modalImage = document.getElementById('modal-image-src');
            if (imageModal && modalImage) {
                modalImage.src = data.paymentReceiptUrl;
                imageModal.style.display = 'flex';
            }
        } else {
            alert('No receipt available for this reservation.');
        }
    }
};

window.viewPreOrder = async function(id) {
    const docRef = doc(db, 'reservations', id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
        const data = docSnap.data();
        const viewDetailsModal = document.getElementById('view-details-modal');
        const viewDetailsTitle = document.getElementById('view-details-title');
        const viewDetailsContent = document.getElementById('view-details-content');
        
        if (viewDetailsTitle) viewDetailsTitle.textContent = "Pre-Order Details";
        
        if (data.preOrder && data.preOrder.length > 0) {
            let preOrderHtml = '<ul class="pre-order-item-list">';
            data.preOrder.forEach(item => {
                preOrderHtml += `<li><strong>${item.quantity}x</strong> ${item.name}</li>`;
            });
            preOrderHtml += '</ul>';
            if (viewDetailsContent) viewDetailsContent.innerHTML = preOrderHtml;
        } else {
            if (viewDetailsContent) viewDetailsContent.innerHTML = '<p>No pre-order items.</p>';
        }
        
        if (viewDetailsModal) viewDetailsModal.style.display = 'flex';
    }
};

window.viewReservationNotes = async function(id) {
    const docRef = doc(db, 'reservations', id);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
        const data = docSnap.data();
        const viewDetailsModal = document.getElementById('view-details-modal');
        const viewDetailsTitle = document.getElementById('view-details-title');
        const viewDetailsContent = document.getElementById('view-details-content');
        
        if (viewDetailsTitle) viewDetailsTitle.textContent = "Reservation Notes";
        if (viewDetailsContent) viewDetailsContent.textContent = data.notes || "No notes provided.";
        if (viewDetailsModal) viewDetailsModal.style.display = 'flex';
    }
};

window.approveReservation = async function(id, userId, date) {
    const message = prompt("Optional: Add a welcome message for the customer:");
    
    try {
        await updateDoc(doc(db, 'reservations', id), { status: 'approved' });
        await sendReservationNotification(userId, date, 'approved', message || '');
        alert('Reservation approved successfully!');
    } catch (error) {
        console.error('Error approving reservation:', error);
        alert('Failed to approve reservation.');
    }
};

window.cancelReservation = async function(id, userId, date) {
    const reason = prompt("Please provide a reason for cancellation:");
    
    if (!reason || !reason.trim()) {
        alert('Cancellation reason is required.');
        return;
    }
    
    try {
        await updateDoc(doc(db, 'reservations', id), { status: 'canceled' });
        await sendReservationNotification(userId, date, 'canceled', reason);
        alert('Reservation canceled successfully!');
    } catch (error) {
        console.error('Error canceling reservation:', error);
        alert('Failed to cancel reservation.');
    }
};

window.completeReservation = async function(id, userId, date) {
    const message = prompt("Optional: Add a thank you message:");
    
    try {
        await updateDoc(doc(db, 'reservations', id), { status: 'completed' });
        await sendReservationNotification(userId, date, 'completed', message || '');
        alert('Reservation completed successfully!');
    } catch (error) {
        console.error('Error completing reservation:', error);
        alert('Failed to complete reservation.');
    }
};