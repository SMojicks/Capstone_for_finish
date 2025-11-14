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
// DECLARE variables here so all functions can access them
let employeeModal;
let employeeForm;
let employeeModalTitle;
let cancelEmployeeBtn;

// --- Main Data Loading Function (Exported) ---
export async function loadAccounts() {
    // Only run this function once per page load
    if (hasLoaded) return;
    hasLoaded = true; // Set flag

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
    row.innerHTML = `
        <td>${user.fullName}</td>
        <td>${user.email}</td>
        <td>${user.phone || "N/A"}</td>
        <td>
            <span class="status ${isBlocked ? 'status-blocked' : 'status-approved'}">
                ${isBlocked ? "Blocked" : "Active"}
            </span>
        </td>
        <td>
            <button class="btn btn--small edit-btn">Edit/Promote</button>
            <button class="btn btn--small block-btn" data-id="${user.id}" data-blocked="${isBlocked}">
                ${isBlocked ? "Unblock" : "Block"}
            </button>
            <button class="btn btn--small delete-btn" data-id="${user.id}">Delete</button>
        </td>
    `;

    // Add event listeners for buttons
    row.querySelector(".block-btn").addEventListener("click", toggleBlockCustomer);
    row.querySelector(".delete-btn").addEventListener("click", deleteCustomer);
    row.querySelector(".edit-btn").addEventListener("click", () => openEmployeeModal(user));
    
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
        <td>
            <button class="btn btn--small edit-btn">Edit</button>
        </td>
    `;

    row.querySelector(".edit-btn").addEventListener("click", () => openEmployeeModal(user));
    
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
            hasLoaded = false; // Reset flag to allow reload
            loadAccounts();
        } catch (error) {
            console.error("Error blocking customer:", error);
            alert("Error updating customer status.");
        }
    }
}

async function deleteCustomer(e) {
    const userId = e.target.dataset.id;
    
    if (confirm("Are you sure you want to DELETE this customer?\nThis action cannot be undone and will delete their data.")) {
        try {
            const userRef = doc(db, "users", userId);
            await deleteDoc(userRef);
            alert("Customer record deleted.");
            hasLoaded = false; // Reset flag to allow reload
            loadAccounts();
        } catch (error) {
            console.error("Error deleting customer:", error);
            alert("Error deleting customer record.");
        }
    }
}

function openEmployeeModal(user) {
    // Check if the form variable has been set by the DOM listener
    if (!employeeForm) {
        console.error("Modal form is not ready. DOM may not be fully loaded.");
        return;
    }
    
    employeeForm.reset();
    
    // This is where the error was happening
    document.getElementById("employee-id").value = user.id;
    document.getElementById("employee-name").value = user.fullName;
    document.getElementById("employee-email").value = user.email;
    document.getElementById("role-select").value = user.role || "customer";

    const permissions = user.permissions || {};
    employeeForm.querySelectorAll('.permission-item input[type="checkbox"]').forEach(checkbox => {
        const permKey = checkbox.dataset.permission;
        checkbox.checked = permissions[permKey] === true;
    });

    employeeModalTitle.textContent = "Edit User Permissions";
    employeeModal.style.display = "flex";
}

// --- Event Listeners for Modal (Need to be run once) ---
document.addEventListener("DOMContentLoaded", () => {
    
    // ASSIGN values to the module-level variables
    employeeModal = document.getElementById("employee-modal");
    employeeForm = document.getElementById("employee-form");
    employeeModalTitle = document.getElementById("employee-modal-title");
    cancelEmployeeBtn = document.getElementById("cancel-employee-btn");

    if (cancelEmployeeBtn) {
        cancelEmployeeBtn.addEventListener("click", () => {
            employeeModal.style.display = "none";
        });
    }

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
            
            const employeeData = {
                role: newRole,
                permissions: permissions
            };
    
            try {
                const docRef = doc(db, "users", userId);
                await updateDoc(docRef, employeeData);
                alert("User updated successfully!");
                
                employeeModal.style.display = "none";
                hasLoaded = false; // Reset flag to allow reload
                loadAccounts(); // Refresh the tables
            } catch (error) {
                console.error("Error updating user:", error);
                alert("Error updating user: " + error.message);
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
});