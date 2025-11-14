// EmployeeUI/app.js

import { loadTransactions } from "../scripts/transaction.js";
import { loadAnalytics } from "../scripts/analytics.js";
import { loadAccounts } from "../scripts/account-management.js";
import { auth, db } from "../scripts/firebase.js";
import { loadInventoryLog } from "../scripts/inventory-log.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// We no longer need to import functions from inventory.js or advanced-pos.js
// as they now listen for 'DOMContentLoaded' and manage themselves.

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // This function will handle auth and then load the UI
    initializeApp();
});

/**
 * Main app initializer. Checks for auth state and then builds the UI.
 */
function initializeApp() {
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is logged in, fetch their permissions
            const userProfile = await fetchUserProfile(user);
            
            if (!userProfile) {
                // This user is not an employee/admin or their doc is missing
                alert("Access Denied. You do not have permissions to view this page.");
                window.location.href = '../login.html';
                return;
            }
            
            // 1. Apply permissions to hide/show tabs
            const firstVisibleTab = applyPermissions(userProfile.permissions);
            
            // 2. Setup UI (navigation, logout, etc.)
            setupNavigation(firstVisibleTab); // Pass the first visible tab to set as default
            setupLogout();
            setupSidebarToggle();
            
            // --- ADDED THIS CALL ---
            setupInventoryToggle();
            setupReservationHistoryToggle();
            
            // 3. Update employee info in navbar
            document.querySelector(".employee-name").textContent = userProfile.fullName || "Employee";
            const avatar = document.querySelector(".employee-avatar");
            if (avatar && userProfile.fullName) {
                const initials = userProfile.fullName.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
                avatar.textContent = initials || "CA";
            }

        } else {
            // User is not logged in, redirect to login
            alert("You must be logged in to view this page.");
            window.location.href = '../login.html';
        }
    });
}

/**
 * Fetches the user's document from Firestore and checks their role.
 * @param {object} user - The Firebase Auth user object.
 * @returns {object|null} The user's profile data (including permissions) or null.
 */
async function fetchUserProfile(user) {
    const userDocRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userDocRef);

    if (userDoc.exists()) {
        const userData = userDoc.data();
        // Check if they are an employee or admin
        if (userData.role === 'employee' || userData.role === 'admin') {
            return {
                fullName: userData.fullName,
                permissions: userData.permissions || {} // Return permissions map or empty object
            };
        }
    }
    return null; // Not an employee/admin or no user doc
}

/**
 * Hides or shows sidebar items based on the user's permission map.
 * @param {object} permissions - The user's permissions map (e.g., {pos: true, inventory: false})
 * @returns {string} The 'data-section' of the first tab the user can see.
 */
function applyPermissions(permissions) {
    const navItems = document.querySelectorAll('.nav-item[data-permission]');
    let firstVisibleTab = null;

    navItems.forEach(item => {
        const permissionKey = item.dataset.permission;
        
        // Admins (with 'accounts' permission) see everything.
        // Otherwise, check the specific permission.
        const canSee = permissions['accounts'] === true || permissions[permissionKey] === true;

        if (canSee) {
            item.style.display = 'list-item'; // Show the tab
            if (!firstVisibleTab) {
                firstVisibleTab = permissionKey; // Store the first one we find
            }
        } else {
            item.style.display = 'none'; // Hide the tab
        }
    });

    // Fallback in case no permissions are set
    if (!firstVisibleTab && permissions['accounts'] !== true) {
         // If no tabs are visible and not admin, maybe default to POS if it exists
         const posTab = document.querySelector('.nav-item[data-permission="pos"]');
         if (posTab) {
             posTab.style.display = 'list-item';
             firstVisibleTab = 'pos';
         }
    }
    
    return firstVisibleTab || 'pos'; // Default to 'pos' if something goes wrong
}

/**
 * Sets up the sidebar navigation clicks and default active tab.
 * @param {string} defaultSection - The 'data-section' to show by default.
 */
function setupNavigation(defaultSection) {
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.content-section');
    
    // Deactivate all first
    navLinks.forEach(nav => nav.classList.remove('active'));
    sections.forEach(section => section.classList.remove('active'));

    // Activate default section based on permissions
    const defaultSectionEl = document.getElementById(`${defaultSection}-section`);
    const defaultLinkEl = document.querySelector(`.nav-link[data-section="${defaultSection}"]`);

    if (defaultSectionEl && defaultLinkEl) {
        defaultSectionEl.classList.add('active');
        defaultLinkEl.classList.add('active');
        
        // --- LAZY LOAD DEFAULT TAB DATA ---
        if (defaultSection === 'transactions') loadTransactions();
        if (defaultSection === 'analytics') loadAnalytics();
        if (defaultSection === 'accounts') loadAccounts();
        // --- REMOVED inventory-log load ---
    } else {
        // Fallback if the default doesn't exist (e.g., no permissions)
        document.getElementById('pos-section').classList.add('active');
        document.querySelector('.nav-link[data-section="pos"]').classList.add('active');
    }


    // Add nav link click listeners
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            const targetSectionId = this.getAttribute('data-section');
            
            navLinks.forEach(nav => nav.classList.remove('active'));
            sections.forEach(section => section.classList.remove('active'));
            
            this.classList.add('active');
            document.getElementById(`${targetSectionId}-section`).classList.add('active');

            if (targetSectionId === 'transactions') {
                loadTransactions();
            }
            if (targetSectionId === 'analytics') {
                loadAnalytics();
            }
            if (targetSectionId === 'accounts') { 
                loadAccounts();
            }
            // --- REMOVED inventory-log block ---
        });
    });
}

// Logout functionality
function setupLogout() {
    const logoutBtn = document.querySelector('.logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', function(event) {
            event.preventDefault();
            if (confirm('Are you sure you want to logout?')) {
                auth.signOut().then(() => {
                    alert('Logged out successfully!');
                    window.location.href = '../login.html';
                }).catch((error) => {
                    console.error("Logout error:", error);
                    window.location.href = '../login.html';
                });
            }
        });
    }
}

// New function for sidebar toggle
function setupSidebarToggle() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-collapsed');
    });
  }
}

// ---
// --- NEW FUNCTION TO TOGGLE INVENTORY/LOGS ---
// ---
/**
 * Sets up the toggle between Inventory and Inventory Log sections.
 */
function setupInventoryToggle() {
    const viewLogBtn = document.getElementById('view-inventory-log-btn');
    const backToInvBtn = document.getElementById('back-to-inventory-btn');
    const inventorySection = document.getElementById('inventory-section');
    const logSection = document.getElementById('inventory-log-section');

    if (viewLogBtn && backToInvBtn && inventorySection && logSection) {
        
        viewLogBtn.addEventListener('click', () => {
            // Hide inventory, show logs
            inventorySection.classList.remove('active');
            logSection.classList.add('active');
            
            // Manually load the log data *now*
            loadInventoryLog(); 
        });

        backToInvBtn.addEventListener('click', () => {
            // Hide logs, show inventory
            logSection.classList.remove('active');
            inventorySection.classList.add('active');
            // No need to reload inventory, it's already loaded
        });
    } else {
        console.warn("Could not find inventory toggle buttons or sections.");
    }
}
function setupReservationHistoryToggle() {
    const viewHistoryBtn = document.getElementById('view-reservation-history-btn');
    const backToResBtn = document.getElementById('back-to-reservations-btn');
    const reservationMainSection = document.querySelector('#reservations-section > .section-header').parentElement;
    const historySection = document.getElementById('reservation-history-section');

    if (viewHistoryBtn && backToResBtn && historySection) {
        viewHistoryBtn.addEventListener('click', () => {
            // Hide main reservation content, show history
            const mainContent = reservationMainSection.querySelectorAll('.inventory-filter-bar, .analytics-grid, .table-container');
            mainContent.forEach(el => el.style.display = 'none');
            reservationMainSection.querySelector('.section-header').style.display = 'none';
            historySection.classList.remove('hidden');
            historySection.style.display = 'block';
        });

        backToResBtn.addEventListener('click', () => {
            // Show main reservation content, hide history
            const mainContent = reservationMainSection.querySelectorAll('.inventory-filter-bar, .analytics-grid, .table-container');
            mainContent.forEach(el => el.style.display = '');
            reservationMainSection.querySelector('.section-header').style.display = '';
            historySection.classList.add('hidden');
            historySection.style.display = 'none';
        });
    } else {
        console.warn("Could not find reservation history toggle buttons or sections.");
    }
}