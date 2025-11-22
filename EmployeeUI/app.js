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
    // Check if user should be redirected to employee dashboard
    checkEmployeeDashboardRedirect();
    
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // Store that user accessed employee dashboard
            storeEmployeeDashboardAccess(user.uid);
            
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
            setupNavigation(firstVisibleTab);
            setupLogout();
            setupSidebarToggle();
            setupInventoryToggle();
            setupReservationHistoryToggle();
            setupSidebarDropdowns();
            setupAddItemsTabs();
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
 * Stores the employee dashboard access in localStorage
 * @param {string} uid - The user's Firebase UID
 */
function storeEmployeeDashboardAccess(uid) {
    const accessData = {
        uid: uid,
        lastAccessed: new Date().toISOString(),
        page: 'employee-dashboard'
    };
    localStorage.setItem('lastDashboardAccess', JSON.stringify(accessData));
}

/**
 * Checks if user should be redirected to employee dashboard
 */
function checkEmployeeDashboardRedirect() {
    // Get the stored access data
    const storedData = localStorage.getItem('lastDashboardAccess');
    
    if (!storedData) return; // No previous access recorded
    
    try {
        const accessData = JSON.parse(storedData);
        
        // Check if the last accessed page was employee dashboard
        if (accessData.page === 'employee-dashboard') {
            // Optional: Check if access was recent (within last 7 days)
            const lastAccessDate = new Date(accessData.lastAccessed);
            const daysSinceAccess = (new Date() - lastAccessDate) / (1000 * 60 * 60 * 24);
            
            // If accessed within last 7 days and not already on employee dashboard
            if (daysSinceAccess <= 7 && !window.location.pathname.includes('EmployeeUI')) {
                console.log('Redirecting to employee dashboard (last accessed)');
                // Store the current page they were trying to access
                localStorage.setItem('redirectedFrom', window.location.href);
            }
        }
    } catch (error) {
        console.error('Error checking dashboard redirect:', error);
    }
}

/**
 * Clears employee dashboard access (call this on logout)
 */
function clearEmployeeDashboardAccess() {
    localStorage.removeItem('lastDashboardAccess');
    localStorage.removeItem('redirectedFrom');
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
            if (targetSectionId === 'add-items') {
                import('../scripts/inventory.js').then(module => {
                    module.loadRestockItems();
                });
            }
            // Inside the nav link click event listener, add this condition:
                if (targetSectionId === 'restock-prediction') {
                    import('../scripts/restock-prediction.js').then(module => {
                        module.loadRestockPredictions();
                    });
                }
        });
    });
}
/**
 * Sets up tab switching for Add Items section
 */
function setupAddItemsTabs() {
    const tabButtons = document.querySelectorAll('#add-items-section .account-tab-btn');
    const tabContainers = document.querySelectorAll('#add-items-section .account-table-container');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-target');
            
            // Remove active class from all tabs and containers
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContainers.forEach(container => container.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding container
            button.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
            
            // Load appropriate data when switching tabs
            if (targetTab === 'restock-items-tab') {
                import('../scripts/inventory.js').then(module => {
                    module.loadRestockItems();
                });
            } else if (targetTab === 'manage-categories-tab') {
                import('../scripts/inventory-categories.js').then(module => {
                    // Categories are already loaded, but you can refresh if needed
                });
            }
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
                // Clear employee dashboard access before logout
                clearEmployeeDashboardAccess();
                
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

/**
 * Sets up dropdown functionality for sidebar navigation
 */
function setupSidebarDropdowns() {
    // Find all nav links with dropdown arrows
    const dropdownToggles = document.querySelectorAll('.nav-link[data-section="inventory"]');
    
    dropdownToggles.forEach(toggle => {
        const parentItem = toggle.closest('.nav-item');
        const subsection = parentItem.querySelector('.nav-subsection');
        
        if (!subsection) return;
        
        toggle.addEventListener('click', (e) => {
            // If clicking to navigate to inventory main page, don't toggle dropdown
            // Instead, toggle the dropdown expansion
            const isExpanded = subsection.classList.contains('expanded');
            
            // Toggle the expanded state
            toggle.classList.toggle('expanded');
            subsection.classList.toggle('expanded');
            
            // Prevent default navigation when just toggling
            if (!isExpanded) {
                e.stopPropagation();
            }
        });
    });
    
    // Handle subsection item clicks
    const subItems = document.querySelectorAll('.nav-subitem .nav-link');
    subItems.forEach(subLink => {
        subLink.addEventListener('click', () => {
            // Remove active class from all nav links
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });
            
            // Add active class to clicked subitem
            subLink.classList.add('active');
            
            // Also highlight the parent inventory item
            const parentInventoryLink = document.querySelector('.nav-link[data-section="inventory"]');
            if (parentInventoryLink) {
                parentInventoryLink.classList.add('active');
            }
        });
    });
}


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
    const reservationsSection = document.getElementById('reservations-section');
    const historySection = document.getElementById('reservation-history-section');

    if (viewHistoryBtn && backToResBtn && reservationsSection && historySection) {
        viewHistoryBtn.addEventListener('click', () => {
            reservationsSection.classList.remove('active');
            reservationsSection.classList.add('hidden');
            
            historySection.classList.remove('hidden');
            historySection.classList.add('active');
        });

        backToResBtn.addEventListener('click', () => {
            historySection.classList.remove('active');
            historySection.classList.add('hidden');
            
            reservationsSection.classList.remove('hidden');
            reservationsSection.classList.add('active');
        });
    } else {
        console.warn("Could not find reservation history toggle buttons or sections.");
    }
}