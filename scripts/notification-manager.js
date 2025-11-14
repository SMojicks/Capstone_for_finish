// scripts/notification-manager.js
import { db, auth } from "./firebase.js";
import { 
    collection, 
    query, 
    where, 
    onSnapshot, 
    orderBy,
    writeBatch,
    limit,
    getDocs
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

let notificationBell;
let notificationBadge;
let notificationPanel;
let notificationList;

let unreadListener = null;
let allListener = null;

// Main entry point
onAuthStateChanged(auth, (user) => {
    // Find elements
    notificationBell = document.getElementById("notification-bell");
    notificationBadge = document.getElementById("notification-badge");
    notificationPanel = document.getElementById("notification-panel");
    notificationList = document.getElementById("notification-list");

    if (user) {
        // User is logged in, show the bell and start listeners
        if (notificationBell) notificationBell.style.display = 'block';
        
        initNotificationListeners(user.uid);
        
        // Toggle panel on bell click
        notificationBell.addEventListener("click", (e) => {
            e.stopPropagation();
            const isHidden = notificationPanel.classList.toggle("hidden");
            if (!isHidden) {
                // If panel is opening, mark notifications as read
                markNotificationsAsRead(user.uid);
            }
        });
        
    } else {
        // User is logged out, hide everything and stop listeners
        if (notificationBell) notificationBell.style.display = 'none';
        if (notificationPanel) notificationPanel.classList.add("hidden");
        if (notificationBadge) notificationBadge.classList.add("hidden");
        
        if (unreadListener) unreadListener(); // Detach old listener
        if (allListener) allListener();     // Detach old listener
    }
});

function initNotificationListeners(userId) {
    const notificationsRef = collection(db, "notifications");

    // --- Listener 1: For Unread Badge Count ---
    const unreadQuery = query(
        notificationsRef, 
        where("userId", "==", userId), 
        where("read", "==", false)
    );
    
    if (unreadListener) unreadListener();
    unreadListener = onSnapshot(unreadQuery, (snapshot) => {
        if (snapshot.size > 0) {
            notificationBadge.textContent = snapshot.size;
            notificationBadge.classList.remove("hidden");
        } else {
            notificationBadge.classList.add("hidden");
        }
    });

    // --- Listener 2: For All Notifications in Panel ---
    const allQuery = query(
        notificationsRef, 
        where("userId", "==", userId), 
        orderBy("timestamp", "desc"),
        limit(10) // Get the 10 most recent
    );

    if (allListener) allListener();
    allListener = onSnapshot(allQuery, (snapshot) => {
        if (snapshot.empty) {
            notificationList.innerHTML = '<li class="notification-none">No notifications yet.</li>';
            return;
        }
        
        notificationList.innerHTML = ""; // Clear list
        snapshot.forEach(doc => {
            const notif = doc.data();
            renderNotification(notif);
        });
    });
}

function renderNotification(notif) {
    const li = document.createElement("li");
    li.className = `notification-item ${notif.read ? 'read' : 'unread'}`;
    
    // Set icon based on type
    let icon = "🔔";
    if (notif.type.includes("reservation")) icon = "📅";
    if (notif.type.includes("feedback")) icon = "⭐";

    // Format timestamp
    const date = notif.timestamp ? notif.timestamp.toDate().toLocaleDateString() : 'Just now';

    li.innerHTML = `
        <a href="${notif.link || '#'}">
            <span class="notification-icon">${icon}</span>
            <div class="notification-content">
                <p class="notification-message">${notif.message}</p>
                <span class="notification-date">${date}</span>
            </div>
        </a>
    `;
    notificationList.appendChild(li);
}

async function markNotificationsAsRead(userId) {
    const notificationsRef = collection(db, "notifications");
    const q = query(
        notificationsRef, 
        where("userId", "==", userId), 
        where("read", "==", false)
    );
    
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return; // Nothing to mark

    const batch = writeBatch(db);
    snapshot.forEach(doc => {
        batch.update(doc.ref, { read: true });
    });
    
    try {
        await batch.commit();
    } catch (error) {
        console.error("Error marking notifications as read: ", error);
    }
}

// Close panel if clicking outside
document.addEventListener("click", () => {
    if (notificationPanel && !notificationPanel.classList.contains("hidden")) {
        notificationPanel.classList.add("hidden");
    }
});