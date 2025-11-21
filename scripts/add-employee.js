// scripts/add-employee.js

import { auth, db } from "./firebase.js";
import { 
    createUserWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    const addEmployeeBtn = document.getElementById('add-employee-btn');
    const addEmployeeModal = document.getElementById('add-employee-modal');
    const cancelAddEmployeeBtn = document.getElementById('cancel-add-employee-btn');
    const addEmployeeForm = document.getElementById('add-employee-form');
    const roleSelect = document.getElementById('new-employee-role');

    if (!addEmployeeBtn || !addEmployeeModal || !addEmployeeForm) {
        console.warn("Add employee elements not found");
        return;
    }

    // Open modal
    addEmployeeBtn.addEventListener('click', () => {
        addEmployeeForm.reset();
        addEmployeeModal.style.display = 'flex';
    });

    // Close modal
    cancelAddEmployeeBtn.addEventListener('click', () => {
        addEmployeeModal.style.display = 'none';
    });

    // Auto-check all permissions if Admin is selected
    roleSelect.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('#add-employee-modal .permissions-grid input[type="checkbox"]');
        if (roleSelect.value === 'admin') {
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

    // Handle form submission
    addEmployeeForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const fullName = document.getElementById('new-employee-name').value.trim();
        const email = document.getElementById('new-employee-email').value.trim();
        const password = document.getElementById('new-employee-password').value;
        const role = document.getElementById('new-employee-role').value;

        if (!fullName || !email || !password || !role) {
            alert('Please fill out all required fields.');
            return;
        }

        // Collect permissions
        const permissions = {};
        document.querySelectorAll('#add-employee-modal .permissions-grid input[type="checkbox"]').forEach(cb => {
            permissions[cb.dataset.permission] = cb.checked;
        });

        // Disable submit button
        const submitBtn = addEmployeeForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating Account...';

        try {
            console.log("🔧 Creating new employee account...");
            
            // Step 1: Create the Auth account
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const newEmployeeUser = userCredential.user;
            console.log("✅ Auth account created:", newEmployeeUser.uid);

            // Step 2: Create the Firestore document
            // The new employee is now authenticated, so they can create their own doc
            const userDocRef = doc(db, "users", newEmployeeUser.uid);
            await setDoc(userDocRef, {
                fullName: fullName,
                email: email,
                userId: newEmployeeUser.uid,
                role: role,
                permissions: permissions,
                phone: ""
            });
            console.log("✅ Firestore document created");

            // Step 3: Sign out the employee
            await signOut(auth);
            console.log("✅ Employee signed out");

            // Step 4: Show success and wait for admin to re-authenticate
            alert(`✅ Employee account created successfully!\n\n📧 Email: ${email}\n🔑 Temporary Password: ${password}\n\n⚠️ You will be redirected to login. Please log in with your admin credentials to continue.\n\nShare the employee credentials securely.`);
            
            addEmployeeModal.style.display = 'none';
            
            // Redirect to login page for admin to re-authenticate
            window.location.href = '../login.html?role=employee&returnTo=EmployeeUI/index.html';

        } catch (error) {
            console.error("❌ Error creating employee account:", error);
            
            let userMessage = "An error occurred while creating the account.";
            switch (error.code) {
                case "auth/email-already-in-use":
                    userMessage = "This email address is already in use by another account.";
                    break;
                case "auth/invalid-email":
                    userMessage = "The email address is not valid.";
                    break;
                case "auth/weak-password":
                    userMessage = "The password is too weak. It must be at least 6 characters.";
                    break;
                default:
                    userMessage = `Error: ${error.message}`;
            }
            alert(userMessage);

        } finally {
            // Re-enable submit button
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Employee Account';
        }
    });

    // Close modal when clicking outside
    addEmployeeModal.addEventListener('click', (e) => {
        if (e.target === addEmployeeModal) {
            addEmployeeModal.style.display = 'none';
        }
    });
});