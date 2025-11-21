// scripts/account-management.js

import { db } from "./firebase.js";
import { 
    collection, 
    doc, 
    getDocs, 
    query, 
    where, 
    updateDoc, 
    deleteDoc 
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// --- Module-level variables ---
let hasLoaded = false;
let employeeModal;
let employeeForm;
let employeeModalTitle;
let cancelEmployeeBtn;

// --- Main Data Loading Function (Exported) ---
export async function loadAccounts() {
    // Only run this function once per page load
    if (hasLoaded) return;
    hasLoaded = true;

    const customerTableBody = document.getElementById("customer-accounts-table-body");
    const employeeTableBody = document.getElementById("employee-accounts-table-body");

    if (!customerTableBody || !employeeTableBody) return;

    customerTableBody.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";
    employeeTableBody.innerHTML = "<tr><td colspan='4'>Loading...</td></tr>";

    try {
        const usersRef = collection(db, "users");
        const snapshot = await getDocs(usersRef);

        customerTableBody.innerHTML = "";
        employeeTableBody.innerHTML = "";

        if (snapshot.empty) {
            customerTableBody.innerHTML = "<tr><td colspan='5'>No customers found.</td></tr>";
            employeeTableBody.innerHTML = "<tr><td colspan='4'>No employees found.</td></tr>";
            return;
        }

        snapshot.forEach(docSnap => {
            const user = { id: docSnap.id, ...docSnap.data() };
            if (user.role === "customer") {
                renderCustomerRow(user);
            } else if (user.role === "employee" || user.role === "admin") {
                renderEmployeeRow(user);
            }
        });

    } catch (error) {
        console.error("Error loading accounts:", error);
        customerTableBody.innerHTML = "<tr><td colspan='5'>Error loading accounts.</td></tr>";
        employeeTableBody.innerHTML = "<tr><td colspan='4'>Error loading accounts.</td></tr>";
    }
}

// --- Render Functions ---

function renderCustomerRow(user) {
    const row = document.createElement("tr");
    const isBlocked = user.status === "blocked";
    
    // UPDATED: Removed "Edit/Promote" button, kept only Block/Unblock and Delete
    row.innerHTML = `
        <td>${user.fullName}</td>
        <td>${user.email}</td>
        <td>${user.phone || "N/A"}</td>
        <td>
            <span class="status ${isBlocked ? 'status-blocked' : 'status-approved'}">
                ${isBlocked ? "Blocked" : "Active"}
            </span>
        </td>
        <td class="actions-cell">
            ${isBlocked 
                ? `<button class="btn-icon btn--icon-approve" data-id="${user.id}" data-blocked="${isBlocked}" title="Unblock">✓</button>`
                : `<button class="btn-icon btn--icon-cancel" data-id="${user.id}" data-blocked="${isBlocked}" title="Block">🚫</button>`
            }
            <button class="btn-icon btn--icon-delete" data-id="${user.id}" title="Delete">🗑️</button>
        </td>
    `;

    // Add event listeners for buttons
    const blockBtn = row.querySelector(isBlocked ? ".btn--icon-approve" : ".btn--icon-cancel");
    blockBtn.addEventListener("click", toggleBlockCustomer);
    
    row.querySelector(".btn--icon-delete").addEventListener("click", deleteCustomer);
    
    document.getElementById("customer-accounts-table-body").appendChild(row);
}

function renderEmployeeRow(user) {
    const row = document.createElement("tr");
    const permissions = user.permissions || {};
    
    const permList = Object.keys(permissions)
        .filter(key => permissions[key] === true)
        .map(key => `<li>${key.charAt(0).toUpperCase() + key.slice(1)}</li>`)
        .join("");

    row.innerHTML = `
        <td>${user.fullName}</td>
        <td>${user.email}</td>
        <td><ul class="permission-list">${permList || "<li>No permissions set</li>"}</ul></td>
        <td class="actions-cell">
            <button class="btn-icon btn--icon-edit" title="Edit">✏️</button>
        </td>
    `;

    row.querySelector(".btn--icon-edit").addEventListener("click", () => openEmployeeModal(user));
    
    document.getElementById("employee-accounts-table-body").appendChild(row);
}

// --- Action Functions ---

async function toggleBlockCustomer(e) {
    const userId = e.target.dataset.id;
    const isBlocked = e.target.dataset.blocked === "true";
    const newStatus = isBlocked ? "active" : "blocked";
    
    if (confirm(`Are you sure you want to ${newStatus === 'active' ? 'unblock' : 'block'} this customer?`)) {
        try {
            const userRef = doc(db, "users", userId);
            await updateDoc(userRef, { status: newStatus });
            alert(`Customer has been ${newStatus}.`);
            hasLoaded = false;
            loadAccounts();
        } catch (error) {
            console.error("Error updating customer status:", error);
            alert("Error updating customer status.");
        }
    }
}

async function deleteCustomer(e) {
    const userId = e.target.dataset.id;
    
    if (confirm("⚠️ Are you sure you want to DELETE this customer?\n\nThis action cannot be undone and will permanently delete:\n• Their account\n• All their reservations\n• All their feedback\n\nType 'DELETE' in the next prompt to confirm.")) {
        const confirmation = prompt("Type 'DELETE' to confirm:");
        if (confirmation === "DELETE") {
            try {
                const userRef = doc(db, "users", userId);
                await deleteDoc(userRef);
                alert("✅ Customer account has been permanently deleted.");
                hasLoaded = false;
                loadAccounts();
            } catch (error) {
                console.error("Error deleting customer:", error);
                alert("❌ Error deleting customer account: " + error.message);
            }
        } else {
            alert("Deletion cancelled.");
        }
    }
}

function openEmployeeModal(user) {
    if (!employeeForm) {
        console.error("Modal form is not ready. DOM may not be fully loaded.");
        return;
    }
    
    employeeForm.reset();
    
    document.getElementById("employee-id").value = user.id;
    document.getElementById("employee-name").value = user.fullName;
    document.getElementById("employee-email").value = user.email;
    document.getElementById("role-select").value = user.role || "employee";

    const permissions = user.permissions || {};
    employeeForm.querySelectorAll('.permission-item input[type="checkbox"]').forEach(checkbox => {
        const permKey = checkbox.dataset.permission;
        checkbox.checked = permissions[permKey] === true;
        
        // Disable all checkboxes if role is admin
        if (user.role === "admin") {
            checkbox.disabled = true;
        }
    });

    employeeModalTitle.textContent = "Edit Employee Permissions";
    employeeModal.style.display = "flex";
}

// --- Event Listeners for Modal ---
document.addEventListener("DOMContentLoaded", () => {
    
    // Assign values to the module-level variables
    employeeModal = document.getElementById("employee-modal");
    employeeForm = document.getElementById("employee-form");
    employeeModalTitle = document.getElementById("employee-modal-title");
    cancelEmployeeBtn = document.getElementById("cancel-employee-btn");

    // Close modal button
    if (cancelEmployeeBtn) {
        cancelEmployeeBtn.addEventListener("click", () => {
            employeeModal.style.display = "none";
        });
    }

    // Handle role change in modal (auto-check permissions for admin)
    const roleSelect = document.getElementById("role-select");
    if (roleSelect) {
        roleSelect.addEventListener("change", (e) => {
            const checkboxes = employeeForm.querySelectorAll('.permission-item input[type="checkbox"]');
            if (e.target.value === "admin") {
                checkboxes.forEach(cb => {
                    cb.checked = true;
                    cb.disabled = true;
                });
            } else {
                checkboxes.forEach(cb => {
                    cb.disabled = false;
                });
            }
        });
    }

    // Form submission
    if (employeeForm) {
        employeeForm.addEventListener("submit", async (e) => {
            e.preventDefault();
    
            const userId = document.getElementById("employee-id").value;
            if (!userId) {
                alert("Error: No user ID specified.");
                return;
            }
    
            const permissions = {};
            employeeForm.querySelectorAll('.permission-item input[type="checkbox"]').forEach(checkbox => {
                permissions[checkbox.dataset.permission] = checkbox.checked;
            });
            
            const newRole = document.getElementById("role-select").value;
            
            // Validate: Admin must have all permissions
            if (newRole === "admin") {
                const allChecked = Object.values(permissions).every(val => val === true);
                if (!allChecked) {
                    alert("Admin role requires all permissions to be enabled.");
                    return;
                }
            }
            
            const employeeData = {
                role: newRole,
                permissions: permissions
            };
    
            try {
                const docRef = doc(db, "users", userId);
                await updateDoc(docRef, employeeData);
                alert("✅ Employee permissions updated successfully!");
                
                employeeModal.style.display = "none";
                hasLoaded = false;
                loadAccounts();
            } catch (error) {
                console.error("Error updating employee:", error);
                alert("❌ Error updating employee: " + error.message);
            }
        });
    }

    // Tab switching logic
    const tabButtons = document.querySelectorAll(".account-tab-btn");
    const tabContainers = document.querySelectorAll(".account-table-container");

    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            tabButtons.forEach(btn => btn.classList.remove("active"));
            tabContainers.forEach(container => container.classList.remove("active"));

            button.classList.add("active");
            const targetId = button.dataset.target;
            document.getElementById(targetId).classList.add("active");
        });
    });

    // Close modal when clicking outside
    if (employeeModal) {
        employeeModal.addEventListener("click", (e) => {
            if (e.target === employeeModal) {
                employeeModal.style.display = "none";
            }
        });
    }
});