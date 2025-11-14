// scripts/auth-manager.js

import { auth } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { loadMyReservation, loadAccountSettings } from "./my-account.js";

onAuthStateChanged(auth, (user) => {
    
    // Get all the new UI elements
    const loginButton = document.getElementById('i1mew');
    const avatarContainer = document.getElementById('profile-avatar-container');
    const avatarDropdown = document.getElementById('profile-dropdown');
    const avatarInitials = document.getElementById('profile-initials');

    if (user) {
        // --- User is LOGGED IN ---
        
        // 1. Show avatar, hide login button
        if (loginButton) loginButton.style.display = 'none';
        if (avatarContainer) avatarContainer.style.display = 'block';

        // 2. Set avatar initials (from email or display name)
        const name = user.displayName;
        const email = user.email;
        if (avatarInitials) {
            if (name) {
                avatarInitials.textContent = name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
            } else if (email) {
                avatarInitials.textContent = email.substring(0, 2).toUpperCase();
            } else {
                avatarInitials.textContent = '...';
            }
        }

        // 3. Add click listener to avatar to toggle dropdown
        if (avatarContainer) {
            avatarContainer.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent document click from firing
                avatarContainer.classList.toggle('open');
            });
        }

        // 4. Add listeners to dropdown items
        const logoutBtn = document.getElementById('profile-logout-btn');
        const myReservationBtn = document.getElementById('open-my-reservation-btn');
        const accountSettingsBtn = document.getElementById('open-account-settings-btn');

        if (logoutBtn) {
            logoutBtn.onclick = () => {
                if (confirm('Are you sure you want to log out?')) {
                    signOut(auth).then(() => {
                        alert('You have been logged out.');
                        window.location.href = 'index.html'; // Redirect to home
                    }).catch((error) => {
                        alert(`Logout failed: ${error.message}`);
                    });
                }
            };
        }
        
        if (myReservationBtn) {
            myReservationBtn.onclick = () => {
                loadMyReservation(); // This function is in my-account.js
                document.getElementById('my-reservation-modal').classList.remove('hidden');
                avatarContainer.classList.remove('open');
            };
        }
        
        if (accountSettingsBtn) {
            accountSettingsBtn.onclick = () => {
                loadAccountSettings(); // This function is in my-account.js
                document.getElementById('account-settings-modal').classList.remove('hidden');
                avatarContainer.classList.remove('open');
            };
        }

    } else {
        // --- User is LOGGED OUT ---
        
        // 1. Show login button, hide avatar
        if (loginButton) loginButton.style.display = 'inline-block';
        if (avatarContainer) avatarContainer.style.display = 'none';
    }
});

// Add a global click listener to close the dropdown when clicking anywhere else
document.addEventListener('click', () => {
    const avatarContainer = document.getElementById('profile-avatar-container');
    if (avatarContainer) {
        avatarContainer.classList.remove('open');
    }
});