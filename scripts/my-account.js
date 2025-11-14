// scripts/my-account.js
import { db, auth } from "./firebase.js";
import { doc, getDoc, updateDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { updateProfile, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { reservationsRef, formatTimeDisplay } from "./reservation.js";

// --- My Reservation Modal Logic ---
const myResModal = document.getElementById('my-reservation-modal');
const resDetailsContent = document.getElementById('reservation-details-content');
const noResContent = document.getElementById('no-reservation-content');
const resWarning = document.getElementById('my-res-warning');
const rescheduleBtn = document.getElementById('my-res-reschedule-btn');
const viewReceiptBtn = document.getElementById('my-res-view-receipt-btn');
const closeResModalBtn = document.getElementById('close-my-reservation-modal-btn');
const receiptModal = document.getElementById("reservation-receipt-modal");
const receiptModalImage = document.getElementById("receipt-modal-image");

export async function loadMyReservation() {
    if (!auth.currentUser) {
        noResContent.classList.remove('hidden');
        resDetailsContent.classList.add('hidden');
        return;
    }

    const userId = auth.currentUser.uid;
    const q = query(
        reservationsRef, 
        where("userId", "==", userId),
        where("status", "in", ["pending", "approved"])
    );

    try {
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            noResContent.classList.remove('hidden');
            resDetailsContent.classList.add('hidden');
            return;
        }

        // User has an active reservation
        noResContent.classList.add('hidden');
        resDetailsContent.classList.remove('hidden');

        const resDoc = snapshot.docs[0];
        const resData = resDoc.data();
        const resId = resDoc.id;

        // 1. Populate details
        document.getElementById('my-res-id').textContent = resId.substring(0, 8).toUpperCase();
        document.getElementById('my-res-date').textContent = resData.date;
        const timeIn = formatTimeDisplay(resData.timeIn);
        const timeOut = formatTimeDisplay(resData.timeOut);
        document.getElementById('my-res-time').textContent = `${timeIn} to ${timeOut}`;
        document.getElementById('my-res-table').textContent = resData.isVip ? "VIP Room" : resData.tableNumber;
        document.getElementById('my-res-diners').textContent = resData.numOfDiners;
        
        const statusEl = document.getElementById('my-res-status');
        statusEl.textContent = resData.status.charAt(0).toUpperCase() + resData.status.slice(1);
        statusEl.className = `status-${resData.status}`; // Uses status-pending, status-approved

        // 2. Populate pre-order items
        const itemsEl = document.getElementById('my-res-items');
        if (resData.preOrder && resData.preOrder.length > 0) {
            itemsEl.innerHTML = resData.preOrder.map(item => 
                `<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>${item.quantity}x ${item.name}</span>
                    <span style="font-weight: 600;">₱${(item.pricePerItem * item.quantity).toFixed(2)}</span>
                </div>`
            ).join('');
        } else {
            itemsEl.innerHTML = `<p style="color: #888;">No items were pre-ordered.</p>`;
        }

        // 3. Handle "View Receipt" button
        if (resData.paymentReceiptUrl && receiptModal && receiptModalImage) {
            viewReceiptBtn.classList.remove('hidden');
            viewReceiptBtn.onclick = () => {
                receiptModalImage.src = resData.paymentReceiptUrl;
                receiptModal.classList.remove('hidden');
            };
        } else {
            viewReceiptBtn.classList.add('hidden');
        }

        // 4. Handle "Reschedule" button and warnings
        let canReschedule = true;
        let warningMessage = "";

        if (resData.rescheduleCount && resData.rescheduleCount >= 1) {
            canReschedule = false;
            warningMessage = "This reservation has already been rescheduled once.";
        }

        try {
            const reservationDateTimeStr = `${resData.date}T${resData.timeIn || '00:00:00'}`;
            const reservationDate = new Date(reservationDateTimeStr);
            const now = new Date();
            const oneDayInMs = 24 * 60 * 60 * 1000;
            const threshold = now.getTime() + oneDayInMs;

            if (reservationDate.getTime() < threshold) {
                canReschedule = false;
                warningMessage = "Reservations cannot be rescheduled less than 24 hours in advance.";
            }
        } catch (e) {
            canReschedule = false;
            warningMessage = "Error checking reservation time.";
        }
        
        if (resData.status === 'pending') {
            canReschedule = false;
            warningMessage = "Cannot reschedule a reservation until it is approved by staff.";
        }

        if (canReschedule) {
            rescheduleBtn.disabled = false;
            rescheduleBtn.onclick = () => {
                window.location.href = 'reservation.html';
            };
            resWarning.classList.add('hidden');
        } else {
            rescheduleBtn.disabled = true;
            resWarning.textContent = warningMessage;
            resWarning.classList.remove('hidden');
        }

    } catch (error) {
        console.error("Error loading reservation details:", error);
        noResContent.classList.remove('hidden');
        resDetailsContent.classList.add('hidden');
    }
}

if (closeResModalBtn) {
    closeResModalBtn.addEventListener('click', () => myResModal.classList.add('hidden'));
}


// --- Account Settings Modal Logic ---
const settingsModal = document.getElementById('account-settings-modal');
const changeNameForm = document.getElementById('change-name-form');
const changePassForm = document.getElementById('change-password-form');
const nameInput = document.getElementById('account-full-name');
const closeSettingsModalBtn = document.getElementById('close-account-settings-modal-btn');

export async function loadAccountSettings() {
    if (!auth.currentUser) return;
    
    // Pre-fill the name input
    const name = auth.currentUser.displayName;
    if (nameInput && name) {
        nameInput.value = name;
    }
}

if (changeNameForm) {
    changeNameForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const newName = nameInput.value.trim();
        if (!newName || !auth.currentUser) return;
        
        const btn = changeNameForm.querySelector('button');
        btn.disabled = true;
        btn.textContent = "Saving...";

        try {
            // 1. Update Firebase Auth profile
            await updateProfile(auth.currentUser, {
                displayName: newName
            });
            
            // 2. Update Firestore 'users' document
            const userDocRef = doc(db, "users", auth.currentUser.uid);
            await updateDoc(userDocRef, {
                fullName: newName
            });
            
            alert("Name updated successfully!");
            // Update avatar initials
            const avatarInitials = document.getElementById('profile-initials');
            if (avatarInitials) {
                avatarInitials.textContent = newName.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
            }

        } catch (error) {
            console.error("Error updating name:", error);
            alert("Error updating name. Please try again.");
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Name";
        }
    });
}

if (changePassForm) {
    changePassForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user) return;
        
        const currentPass = document.getElementById('account-current-password').value;
        const newPass = document.getElementById('account-new-password').value;
        const confirmPass = document.getElementById('account-confirm-password').value;

        if (newPass.length < 6) {
            alert("New password must be at least 6 characters long.");
            return;
        }
        if (newPass !== confirmPass) {
            alert("New passwords do not match.");
            return;
        }

        const btn = changePassForm.querySelector('button');
        btn.disabled = true;
        btn.textContent = "Updating...";

        try {
            // 1. Re-authenticate the user
            const credential = EmailAuthProvider.credential(user.email, currentPass);
            await reauthenticateWithCredential(user, credential);
            
            // 2. User re-authenticated, now update the password
            await updatePassword(user, newPass);
            
            alert("Password updated successfully!");
            changePassForm.reset();

        } catch (error) {
            console.error("Error updating password:", error);
            if (error.code === 'auth/wrong-password') {
                alert("Incorrect current password. Please try again.");
            } else {
                alert("An error occurred. Please try again.");
            }
        } finally {
            btn.disabled = false;
            btn.textContent = "Change Password";
        }
    });
}

if (closeSettingsModalBtn) {
    closeSettingsModalBtn.addEventListener('click', () => settingsModal.classList.add('hidden'));
}