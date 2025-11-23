// js/reservation.js
import { db, auth } from "./firebase.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  query,
  where,
  getDocs,
  updateDoc,
  runTransaction, // NEW: Import runTransaction
  Timestamp, // NEW: Import Timestamp
  deleteDoc // NEW: Import deleteDoc
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
// NEW: Import dev config
import { DEV_MODE } from "./dev-config.js";

let hasUnsavedChanges = false;

// --- NEW ---
let activeReservationId = null; 

async function checkAuthState() {
    // NEW: Check if dev mode is enabled
// NEW: Check if dev mode is enabled
if (DEV_MODE.enabled && DEV_MODE.skipAuth) {
    console.log("🔧 DEV MODE ENABLED - Skipping authentication");
    
    // Set mock user as current user
    currentUserId = DEV_MODE.mockUser.uid;
    
    // Fill in form with mock data
    const nameInput = document.querySelector('input[name="customerName"]');
    const contactInput = document.querySelector('input[name="contactNumber"]');
    if (nameInput) {
        nameInput.value = DEV_MODE.mockUser.fullName;
        nameInput.readOnly = true;
    }
    if (contactInput) contactInput.value = DEV_MODE.mockUser.phone;
    
    // Show dev mode banner
    const devBanner = document.getElementById('dev-mode-banner');
    if (devBanner) devBanner.style.display = 'block';
    
    // Hide auth modal
    const modal = document.getElementById('auth-validation-modal');
    if (modal) modal.classList.add('hidden');
    
    // Show profile avatar with dev indicator
    const loginBtn = document.getElementById('i1mew');
    const profileContainer = document.getElementById('profile-avatar-container');
    const profileInitials = document.getElementById('profile-initials');
    
    if (loginBtn) loginBtn.style.display = 'none';
    if (profileContainer) {
        profileContainer.style.display = 'block';
        profileContainer.style.border = '3px solid #ff6b6b'; // Red border for dev mode
    }
    if (profileInitials) profileInitials.textContent = '🔧'; // Wrench emoji for dev
    
    // Skip pending reservation check in dev mode
    const pendingModal = document.getElementById('pending-reservation-modal');
    const mainSection = document.getElementById('reservation-section-main');
    if (pendingModal) pendingModal.classList.add('hidden');
    if (mainSection) mainSection.classList.remove('blurred-section');
    if (confirmReservationBtn) confirmReservationBtn.textContent = "Confirm Reservation";
    
    // NEW: Remove blur overlay and enable all form fields in dev mode
    setFormStepsDisabled(false); // Enable all form fields
    const layoutBlurOverlay = document.getElementById('layout-blur-overlay');
    if (layoutBlurOverlay) {
        layoutBlurOverlay.classList.add('hidden'); // Hide the blur overlay
        layoutBlurOverlay.style.display = 'none'; // Extra safeguard
    }
    
    // NEW: Make all tables appear available for positioning
    updateTableVisuals();
    
    console.log("✅ Dev mode initialized with mock user:", DEV_MODE.mockUser);
    console.log("🎨 All form fields enabled and blur overlay removed for development");
    return;
}
    
    // ORIGINAL CODE: Normal authentication flow
    onAuthStateChanged(auth, async (user) => {
        const modal = document.getElementById('auth-validation-modal'); 

        if (user) {
            // User is LOGGED IN
            currentUserId = user.uid;
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                const userData = userDoc.data();
                const nameInput = document.querySelector('input[name="customerName"]');
                const contactInput = document.querySelector('input[name="contactNumber"]');
                if (nameInput) {
                    nameInput.value = userData.fullName || "";
                    nameInput.readOnly = true;
                }
                if (contactInput) contactInput.value = userData.phone || "";
            }
            
            if (modal) modal.classList.add('hidden');

            await checkForPendingReservation(user.uid);

        } else {
            // User is NOT logged in
            currentUserId = null;
            const nameInput = document.querySelector('input[name="customerName"]');
            const contactInput = document.querySelector('input[name="contactNumber"]');
            if (nameInput) nameInput.value = "";
            if (contactInput) contactInput.value = "";

            if (modal) modal.classList.remove('hidden');
            
            const mainSection = document.getElementById('reservation-section-main');
            if (mainSection) mainSection.classList.remove('blurred-section');
            if (confirmReservationBtn) confirmReservationBtn.textContent = "Confirm Reservation";
        }
    });
}

export const reservationsRef = collection(db, "reservations");
const productsRef = collection(db, "products"); 

let selectedTableId = null;
let occupiedTables = [];
let isVipSelected = false;
let vipPaymentCompleted = false;
let currentUserId = null;

// MODIFIED: Added new element variables
let reservationDateInput, checkAvailabilityBtn, availabilityLoader, availabilityMessage;
let reservationSectionMain, layoutBlurOverlay; // MOVE THIS HERE
let reservationTimeInInput, numberOfDinersInput, notesInput, agreeTermsCheckbox, confirmReservationBtn; 
let preOrderModal, preOrderCategories, preOrderGrid, preOrderCartItems, preOrderSubtotal, preOrderTax, preOrderTotal, preOrderCheckoutBtn, clearCartBtnMobile;
let preOrderVariationModal, preOrderVariationTitle, preOrderVariationOptions, cancelPreOrderVariationBtn;
let preOrderPaymentModal, cancelPaymentBtn, paymentTotalAmount, receiptFileInput, receiptPreview, uploadReceiptBtn, receiptPreviewLink;
let preorderBackBtn, cartIconContainer, cartBadge, preOrderCartItemsWrapper;
let paymentBackBtnMobile;
let preOrderSection, preOrderCategoriesDesktop, preOrderGridDesktop, preOrderCartItemsDesktop, preOrderSubtotalDesktop, preOrderTaxDesktop, preOrderTotalDesktop, preOrderCheckoutBtnDesktop, clearCartBtnDesktop;
let paymentSection, cancelPaymentBtnDesktop, paymentTotalAmountDesktop, receiptFileInputDesktop, receiptPreviewDesktop, uploadReceiptBtnDesktop, receiptPreviewLinkDesktop;
let preorderBackBtnDesktop, cartIconContainerDesktop, cartBadgeDesktop, preOrderCartItemsWrapperDesktop;

let allProductsCache = [];
let preOrderCart = [];
let currentReservationData = null; // This will hold all data before saving
let currentReservationId = null; // This is only set AFTER saving
let currentReceiptFile = null;

/**
 * Converts "HH:00" time to "H:00 AM/PM" format.
 * @param {string} time - The time in "HH:00" format.
 * @returns {string} - The formatted time.
 */
export function formatTimeDisplay(time) {
    if (!time) return "N/A";
    try {
        const [hourStr, minuteStr] = time.split(':');
        const hour = parseInt(hourStr, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        let displayHour = hour % 12;
        if (displayHour === 0) displayHour = 12; // 12 PM or 12 AM
        return `${displayHour}:${minuteStr} ${ampm}`;
    } catch (e) {
        console.error("Error formatting time:", e);
        return time;
    }
}

// ===================================
// CLOUDINARY UPLOAD (Unchanged)
// ===================================
async function uploadToCloudinary(file) {
    const CLOUD_NAME = "dofyjwhlu";
    const UPLOAD_PRESET = "cafesync";
    const URL = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", UPLOAD_PRESET);
    try {
        const response = await fetch(URL, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`Cloudinary upload failed`);
        const data = await response.json();
        return data.secure_url;
    } catch (error) {
        console.error("Error uploading to Cloudinary:", error);
        throw error;
    }
}

// ===================================
// RESERVATION CHECKING
// ===================================

async function checkForPendingReservation(userId) {
    const modal = document.getElementById('pending-reservation-modal');
    const mainSection = document.getElementById('reservation-section-main');
    
    const rescheduleBtn = document.getElementById('reschedule-btn');
    const rescheduleWarning = document.getElementById('reschedule-warning');
    
    if (!modal || !mainSection || !rescheduleBtn || !rescheduleWarning) return;

    // Query for pending reservations only (approved ones can have multiple)
    const q = query(
        reservationsRef, 
        where("userId", "==", userId),
        where("status", "==", "pending") // Only block if pending
    );
    
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        // User HAS a pending reservation
        // --- User HAS an active reservation ---
        const reservationDoc = snapshot.docs[0]; 
        activeReservationId = reservationDoc.id; 
        const data = reservationDoc.data();
        
        // 1. Populate and show the modal
        document.getElementById('pending-res-date').textContent = data.date;
        modal.classList.remove('hidden');
        
        // 2. "Blur" the main section
        mainSection.classList.add('blurred-section');

        // --- NEW: Check reschedule count and 24-hour rule ---
        let canReschedule = true;
        let warningMessage = "";

        // Check 1: Has it already been rescheduled?
        if (data.rescheduleCount && data.rescheduleCount >= 1) {
            canReschedule = false;
            warningMessage = "This reservation has already been rescheduled once.";
        }

        // Check 2: Is it less than 24h away?
        try {
            // MODIFIED: Use timeIn for accurate check
            const reservationDateTimeStr = `${data.date}T${data.timeIn || '00:00:00'}`;
            const reservationDate = new Date(reservationDateTimeStr);
            const now = new Date();
            
            // Calculate milliseconds 24 hours from now
            const oneDayInMs = 24 * 60 * 60 * 1000;
            const threshold = now.getTime() + oneDayInMs;

            if (reservationDate.getTime() < threshold) {
                canReschedule = false;
                // Give the more critical warning
                warningMessage = "Reservations cannot be rescheduled less than 24 hours in advance.";
            }
        } catch (e) {
            console.error("Error parsing reservation date:", e);
            // Fail-safe: disable reschedule if date is invalid
            canReschedule = false;
            warningMessage = "Error checking reservation time.";
        }
        
        // Apply findings to the UI
        if (canReschedule) {
            rescheduleBtn.disabled = false;
            rescheduleWarning.classList.add('hidden');
        } else {
            rescheduleBtn.disabled = true;
            rescheduleWarning.textContent = warningMessage; // Set the specific message
            rescheduleWarning.classList.remove('hidden');
        }
        
    } else {
        // --- User has NO active reservations ---
        activeReservationId = null;
        modal.classList.add('hidden');
        mainSection.classList.remove('blurred-section');
        if (confirmReservationBtn) {
            confirmReservationBtn.textContent = "Confirm Reservation";
        }
    }
}

// ===================================
// RESERVATION FORM LOGIC
// ===================================

function setDateRestrictions() {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const minDate = tomorrow.toISOString().split("T")[0];
  if (reservationDateInput) reservationDateInput.min = minDate;
  const max = new Date(today);
  max.setMonth(max.getMonth() + 1);
  const maxDate = max.toISOString().split("T")[0];
  if (reservationDateInput) reservationDateInput.max = maxDate;
}

// NEW: Function to populate time dropdowns
function populateTimeDropdowns() {
    if (!reservationTimeInInput) return;

    reservationTimeInInput.innerHTML = '<option value="">Select Time</option>';

    // Cafe hours from 11:00 (11 AM) to 23:00 (11 PM)
    for (let hour = 11; hour <= 23; hour++) {
        const timeValue = `${hour.toString().padStart(2, '0')}:00`;
        let timeDisplay;

        if (hour === 12) {
            timeDisplay = '12:00 PM';
        } else if (hour > 12) {
            timeDisplay = `${hour - 12}:00 PM`;
        } else {
            timeDisplay = `${hour}:00 AM`;
        }
        
        reservationTimeInInput.add(new Option(timeDisplay, timeValue));
    }
}

// NEW: Add listener to Time In to auto-suggest Time Out
// NEW: Add listener to Time In (simplified since timeOut is removed)
function setupTimeDropdownLogic() {
    // This function can be simplified or removed entirely
    // since you're no longer using timeOut
    // Keep it empty for now in case you need it later
    if (!reservationTimeInInput) return;
    
    // You can add any time-related validation here if needed
}


function updateTableVisuals() {
  document.querySelectorAll(".table-spot, .vip-room-btn").forEach((spot) => {
    const id = spot.getAttribute("data-id");
    spot.classList.remove("available", "occupied", "selected");
    if (occupiedTables.includes(String(id))) {
      spot.classList.add("occupied");
    } else {
      spot.classList.add("available");
    }
  });
  
  // Re-apply selections if they still exist
  if (selectedTableIds.length > 0) {
      let allValid = true;
      selectedTableIds.forEach(tableId => {
          if (occupiedTables.includes(String(tableId))) {
              allValid = false;
          } else {
              const spot = document.querySelector(`[data-id="${tableId}"]`);
              if (spot) {
                  spot.classList.remove("available", "occupied");
                  spot.classList.add("selected");
              }
          }
      });
      
      if (!allValid) {
          // Some selected tables became occupied, clear selection
          selectedTableIds = [];
          isVipSelected = false;
          document.getElementById("selectedTableInfo")?.classList.remove("show");
      } else {
          updateSelectedTableInfo();
      }
  }
}
let selectedTableIds = []; // Changed from single ID to array

function initializeTableClicks() {
  const tableSpots = document.querySelectorAll(".table-spot, .vip-room-btn");
  tableSpots.forEach((spot) => {
    const tableId = spot.getAttribute("data-id");
    spot.classList.add("available");
    spot.addEventListener("click", () => {
        // Check if steps are disabled
        if (numberOfDinersInput && numberOfDinersInput.disabled) {
            alert("Please select a date, time, and click 'Check Availability' first.");
            return;
        }
      if (occupiedTables.includes(String(tableId))) {
        alert("This table is already occupied for this time slot. Please select another table.");
        return;
      }
      
      // Check if this is VIP
      const isVip = spot.classList.contains("vip-room-btn");
      
      // FIXED: Check if VIP is already selected and trying to deselect it
      if (isVip && selectedTableIds.includes(String(tableId))) {
          // Deselect VIP room
          selectedTableIds = [];
          isVipSelected = false;
          spot.classList.remove("selected");
          spot.classList.add("available");
          updateSelectedTableInfo();
          return;
      }
      
      // If VIP is selected, clear all other selections
      if (isVip) {
          if (selectedTableIds.length > 0) {
              alert("VIP Room must be reserved alone. Please deselect other tables first.");
              return;
          }
          isVipSelected = true;
          selectedTableIds = [String(tableId)];
          document.querySelectorAll(".table-spot.selected, .vip-room-btn.selected").forEach((s) => {
              s.classList.remove("selected");
              s.classList.add("available");
          });
          spot.classList.remove("available");
          spot.classList.add("selected");
          updateSelectedTableInfo("VIP Room");
          return;
      }
      
      // If trying to select regular table but VIP is selected
      if (isVipSelected) {
          alert("Please deselect VIP Room before selecting regular tables.");
          return;
      }
      
      // Check if table is already selected (toggle off)
      if (selectedTableIds.includes(String(tableId))) {
          selectedTableIds = selectedTableIds.filter(id => id !== String(tableId));
          spot.classList.remove("selected");
          spot.classList.add("available");
          updateSelectedTableInfo();
          return;
      }
      
      // Check if already have 2 tables selected
      if (selectedTableIds.length >= 2) {
          alert("You can only reserve up to 2 tables at once. Please deselect a table first.");
          return;
      }
      
      // Add table to selection
      selectedTableIds.push(String(tableId));
      spot.classList.remove("available");
      spot.classList.add("selected");
      updateSelectedTableInfo();
    });
  });
}

function updateSelectedTableInfo(customText = null) {
  const selectedTableInfo = document.getElementById("selectedTableInfo");
  const selectedTableNumber = document.getElementById("selectedTableNumber");
  
  if (customText) {
      // For VIP Room
      if (selectedTableNumber) selectedTableNumber.textContent = customText;
      if (selectedTableInfo) selectedTableInfo.classList.add("show");
  } else if (selectedTableIds.length > 0) {
      // For regular tables
      const tableText = isVipSelected ? "VIP Room" : selectedTableIds.join(", ");
      if (selectedTableNumber) selectedTableNumber.textContent = `Table ${tableText}`;
      if (selectedTableInfo) selectedTableInfo.classList.add("show");
  } else {
      // No selection
      if (selectedTableInfo) selectedTableInfo.classList.remove("show");
  }
}

// MODIFIED: Renamed to setFormStepsDisabled and changed logic
function setFormStepsDisabled(disabled) {
    // These are the steps *after* checking availability
    if (numberOfDinersInput) numberOfDinersInput.disabled = disabled;
    if (notesInput) notesInput.disabled = disabled;
    if (agreeTermsCheckbox) agreeTermsCheckbox.disabled = disabled;
    if (confirmReservationBtn) confirmReservationBtn.disabled = disabled;
    
    // Show/Hide blur overlay
    if (layoutBlurOverlay) {
        layoutBlurOverlay.classList.toggle("hidden", !disabled);
    }
    
    if (disabled) {
        // Reset table selection if we are disabling the form
        selectedTableIds = []; // Changed to array
        isVipSelected = false;
        vipPaymentCompleted = false;
        document.getElementById("selectedTableInfo")?.classList.remove("show");
        
        // Clear occupied tables and reset visuals
        occupiedTables = [];
        updateTableVisuals(); // This will make all tables 'available' visually
        
        if (availabilityMessage) {
            availabilityMessage.textContent = "";
        }
        if (layoutBlurOverlay) { 
            layoutBlurOverlay.innerHTML = "Select a date and time range to check seat availability.";
        }
    }
}


// checkAvailability with daily limit
async function checkAvailability() {
    if (!currentUserId) {
        const modal = document.getElementById('auth-validation-modal');
        if (modal) modal.classList.remove('hidden');
        return; 
    }

    const selectedDate = reservationDateInput.value;
    const selectedTimeIn = reservationTimeInInput.value;

    if (!selectedDate || !selectedTimeIn) {
        alert("Please select a valid date and time.");
        return;
    }

    if (checkAvailabilityBtn) checkAvailabilityBtn.disabled = true;
    if (availabilityLoader) availabilityLoader.classList.remove("hidden");
    if (availabilityMessage) availabilityMessage.textContent = "Checking available tables...";
    
    occupiedTables = [];
    
    try {
        // NEW: Check if selected date is a weekend
        const selectedDateObj = new Date(selectedDate + 'T00:00:00');
        const dayOfWeek = selectedDateObj.getDay(); // 0 = Sunday, 6 = Saturday
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const maxReservations = isWeekend ? 3 : 6;
        
        // Query all reservations for the selected date
        const q = query(
            reservationsRef, 
            where("date", "==", selectedDate),
            where("status", "in", ["pending", "approved"]) 
        );
        const snapshot = await getDocs(q);
        
        // NEW: Count total reservations for the day
        let totalReservationsForDay = 0;
        snapshot.forEach(doc => {
            if (doc.id !== activeReservationId) {
                totalReservationsForDay++;
            }
        });
        
        // NEW: Check if daily limit is reached
        if (totalReservationsForDay >= maxReservations) {
            const dayType = isWeekend ? "weekend" : "weekday";
            alert(`Sorry, the maximum number of reservations (${maxReservations}) has been reached for this ${dayType}. Please select a different date.`);
            setFormStepsDisabled(true);
            if (availabilityMessage) {
                availabilityMessage.textContent = `⚠️ Fully booked for ${selectedDate}`;
            }
            return;
        }
        
        // Mark occupied tables
        snapshot.forEach(doc => {
            if (doc.id === activeReservationId) {
                return; // Skip user's own active reservation
            }
            
            const res = doc.data();
            
            // Add all tables from this reservation to occupied list
            if (Array.isArray(res.tableNumbers)) {
                res.tableNumbers.forEach(tableNum => {
                    if (!occupiedTables.includes(String(tableNum))) {
                        occupiedTables.push(String(tableNum));
                    }
                });
            } else if (res.tableNumber) {
                if (!occupiedTables.includes(String(res.tableNumber))) {
                    occupiedTables.push(String(res.tableNumber));
                }
            }
        });
        
        updateTableVisuals();
        setFormStepsDisabled(false);
        
        // NEW: Show reservation count in message
        const remainingSlots = maxReservations - totalReservationsForDay;
        const dayType = isWeekend ? "weekend" : "weekday";
        if (availabilityMessage) {
            availabilityMessage.textContent = `Showing availability for ${selectedDate}. ${remainingSlots} reservation slot(s) remaining for this ${dayType}.`;
        }
        
        if (activeReservationId) {
            if (confirmReservationBtn) confirmReservationBtn.textContent = "Update Reservation";
        } else {
            if (confirmReservationBtn) confirmReservationBtn.textContent = "Confirm Reservation";
        }
    } catch (err) {
        console.error("Error checking availability:", err);
        if (availabilityMessage) availabilityMessage.textContent = "Error loading tables. Please try again.";
        setFormStepsDisabled(true);
    } finally {
        if (checkAvailabilityBtn) checkAvailabilityBtn.disabled = false;
        if (availabilityLoader) availabilityLoader.classList.add("hidden");
    }
}

// --- MODIFIED ---
async function handleReservation(event) {
  event.preventDefault();
  if (selectedTableIds.length === 0) {
    alert("Please select at least one table from the map (up to 2 tables).");
    return;
  }
  // MODIFIED: Check timeIn input
  if (numberOfDinersInput && numberOfDinersInput.disabled) {
      alert("Please check for table availability on a specific date first.");
      return;
  }
  
  const formData = new FormData(event.target);

  // =======================================================
  // ==== ADD THIS VALIDATION BLOCK ====
  // =======================================================
  const contactNumber = formData.get("contactNumber").trim();
  const phoneRegex = /^09\d{9}$/; // Regex for "09" followed by 9 digits

  if (!phoneRegex.test(contactNumber)) {
      alert("Please enter a valid 11-digit phone number starting with 09.");
      return; // Stop the function
  }
  // =======================================================
  // ==== END OF VALIDATION BLOCK ====
  // =======================================================

  // MODIFIED: Get TimeIn and TimeOut
const timeIn = formData.get("reservationTimeIn");
  const timeOut = timeIn; // Set timeOut same as timeIn since we removed it
  
  // REMOVED: VIP modal popup logic (no longer needed)

  if(confirmReservationBtn) confirmReservationBtn.disabled = true;

  if (activeReservationId) {
      // --- This is an UPDATE (Reschedule) ---
      // We will run the *same logic* as a new reservation,
      // but will pass the ID to `saveReservation` to signal an update.
      // THIS IS A FIX: We were creating the update before payment.
      
      // 1. Store all form data in the global object
    currentReservationData = {
          name: formData.get("customerName"),
          contactNumber: contactNumber,
          numOfDiners: formData.get("numberOfDiners"),
          date: formData.get("reservationDate"),
          timeIn: timeIn,
          timeOut: timeIn,
          time: timeIn,
          notes: formData.get("notes") || "None",
          tableNumber: selectedTableIds[0], // Keep for backward compatibility
          tableNumbers: selectedTableIds, // New: array of selected tables
          isVip: isVipSelected,
          vipPaymentStatus: (isVipSelected && vipPaymentCompleted) ? "paid" : (isVipSelected ? "pending" : "n/a"),
          rescheduleCount: 1, // Mark as rescheduled
          // We also need to carry over old data
          userId: currentUserId,
          timestamp: Timestamp.now() // Use a new timestamp for the update
      };
      
      // 2. Set the global ID to update
      currentReservationId = activeReservationId;
      
      // 3. Go to pre-order/payment flow
      // This flow will call finalizePreOrder -> saveReservation
      // and saveReservation will see currentReservationId and perform an UPDATE.
      if (window.innerWidth <= 992) {
            openPreOrderModal();
      } else {
          if (reservationSectionMain) reservationSectionMain.style.display = 'none';
          if (preOrderSection) {
              preOrderSection.style.display = 'block';
              (async () => {
                  preOrderCart = [];
                  updatePreOrderCart();
                  if (allProductsCache.length === 0) {
                      await loadPreOrderMenu(true);
                  } else {
                      renderPreOrderMenu("All", true);
                  }
              })();
          }
      }

  } else {
      // --- This is a NEW reservation ---
      // 1. Store form data globally
 currentReservationData = {
        name: formData.get("customerName"),
        contactNumber: contactNumber,
        numOfDiners: formData.get("numberOfDiners"),
        date: formData.get("reservationDate"),
        timeIn: timeIn,
        timeOut: timeIn,
        time: timeIn,
        notes: formData.get("notes") || "None",
        tableNumber: selectedTableIds[0], // Keep for backward compatibility
        tableNumbers: selectedTableIds, // New: array of selected tables
        status: "pending",
        isVip: isVipSelected,
        vipPaymentStatus: vipPaymentCompleted ? "paid" : "n/a",
        timestamp: Timestamp.now(),
        userId: currentUserId,
        preOrder: [], 
        paymentReceiptUrl: null,
        rescheduleCount: 0 
      };
      
      if (!currentReservationData.name || !currentReservationData.contactNumber) {
          alert("Please enter your Full Name and Contact Number.");
          currentReservationData = null; 
          if(confirmReservationBtn) confirmReservationBtn.disabled = false;
          return;
      }
      
      // 2. Clear the global ID
      currentReservationId = null; 

      // 3. Go to pre-order/payment flow
      // This flow will call finalizePreOrder -> saveReservation
      // and saveReservation will see currentReservationId is NULL and perform a CREATE.
      if (window.innerWidth <= 992) {
            openPreOrderModal();
      } else {
          if (reservationSectionMain) reservationSectionMain.style.display = 'none';
          if (preOrderSection) {
              preOrderSection.style.display = 'block';
              (async () => {
                  preOrderCart = [];
                  updatePreOrderCart();
                  if (allProductsCache.length === 0) {
                      await loadPreOrderMenu(true);
                  } else {
                      renderPreOrderMenu("All", true);
                  }
              })();
          }
      }
  }
}

// ===================================
// PRE-ORDER LOGIC (Unchanged)
// ===================================
async function openPreOrderModal() {
    preOrderCart = [];
    updatePreOrderCart(); 
    if (allProductsCache.length === 0) {
        await loadPreOrderMenu(false); 
    } else {
        renderPreOrderMenu("All", false); 
    }
    if (preOrderModal) preOrderModal.style.display = "block";
}

async function loadPreOrderMenu(isDesktop = false) {
    try {
        const q = query(productsRef, where("isVisible", "==", true));
        const snapshot = await getDocs(q);
        allProductsCache = [];
        const categories = new Set();
        snapshot.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            allProductsCache.push(product);
            categories.add(product.category);
        });
        const categoriesList = isDesktop ? preOrderCategoriesDesktop : preOrderCategories;
        if (categoriesList) {
            categoriesList.innerHTML = '<li class="active" data-category="All">All</li>';
            Array.from(categories).sort().forEach(cat => {
                const li = document.createElement("li");
                li.dataset.category = cat;
                li.textContent = cat;
                categoriesList.appendChild(li);
            });
        }
        renderPreOrderMenu("All", isDesktop);
    } catch (err) {
        console.error("Error loading products:", err);
        const grid = isDesktop ? preOrderGridDesktop : preOrderGrid;
        if(grid) grid.innerHTML = "<p>Error loading menu.</p>";
    }
}

function renderPreOrderMenu(category, isDesktop = false) {
    const grid = isDesktop ? preOrderGridDesktop : preOrderGrid;
    if (!grid) return;
    grid.innerHTML = ""; 
    const productsToRender = (category === "All")
        ? allProductsCache
        : allProductsCache.filter(p => p.category === category);
    if (productsToRender.length === 0) {
        grid.innerHTML = "<p>No items in this category.</p>";
    }
    productsToRender.forEach(product => {
        const card = document.createElement("div");
        card.className = "preorder-product-card";
        let priceDisplay = "";
        if (product.variations && product.variations.length > 0) {
            const minPrice = Math.min(...product.variations.map(v => v.price));
            priceDisplay = `From ₱${minPrice.toFixed(2)}`;
        } else {
            priceDisplay = `₱${product.price.toFixed(2)}`;
        }
        card.innerHTML = `
            <img src="${product.imageUrl || 'assets/sandwich-1.jpg'}" alt="${product.name}">
            <div class="preorder-product-card-info">
                <h4>${product.name}</h4>
                <p>${priceDisplay}</p>
            </div>
        `;
        card.onclick = () => handlePreOrderProductClick(product);
        grid.appendChild(card);
    });
}

function handlePreOrderProductClick(product) {
    if (product.variations && product.variations.length > 0) {
        // Determine if we're on desktop or mobile
        const isDesktop = window.innerWidth > 992;
        
        if (preOrderVariationModal && preOrderVariationTitle && preOrderVariationOptions) {
            preOrderVariationTitle.textContent = `Select ${product.name} Size`;
            preOrderVariationOptions.innerHTML = ""; 
            
            product.variations.forEach(v => {
                const btn = document.createElement("button");
                btn.className = "variation-btn";
                btn.innerHTML = `${v.name} <span class="variation-price">₱${v.price.toFixed(2)}</span>`;
                btn.onclick = () => {
                    const item = { 
                        ...product, 
                        id: `${product.id}-${v.name}`, 
                        name: `${product.name} - ${v.name}`, 
                        price: v.price 
                    };
                    addItemToPreOrderCart(item);
                    preOrderVariationModal.style.display = "none";
                    preOrderVariationModal.classList.add("hidden"); // Add this line
                };
                preOrderVariationOptions.appendChild(btn);
            });
            
            // Show the modal with both methods for compatibility
            preOrderVariationModal.style.display = "flex";
            preOrderVariationModal.classList.remove("hidden");
        }
    } else {
        addItemToPreOrderCart(product);
    }
}

function addItemToPreOrderCart(item) {
    const existing = preOrderCart.find(i => i.id === item.id);
    if (existing) {
        existing.quantity++;
    } else {
        preOrderCart.push({ ...item, quantity: 1 });
    }
    updatePreOrderCart();
}

function adjustPreOrderItemQuantity(itemId, change) {
    const itemIndex = preOrderCart.findIndex(i => i.id === itemId);
    if (itemIndex === -1) return; 
    const item = preOrderCart[itemIndex];
    item.quantity += change;
    if (item.quantity <= 0) {
        preOrderCart.splice(itemIndex, 1);
    }
    updatePreOrderCart(); 
}

function updatePreOrderCart() {
    const isDesktop = window.innerWidth > 992;
    const itemsEl = isDesktop ? preOrderCartItemsDesktop : preOrderCartItems;
    const badgeEl = isDesktop ? cartBadgeDesktop : cartBadge;
    const wrapperEl = isDesktop ? preOrderCartItemsWrapperDesktop : preOrderCartItemsWrapper;
    const checkoutBtnEl = isDesktop ? preOrderCheckoutBtnDesktop : preOrderCheckoutBtn;
    const subtotalEl = isDesktop ? preOrderSubtotalDesktop : preOrderSubtotal;
    const taxEl = isDesktop ? preOrderTaxDesktop : preOrderTax;
    const totalEl = isDesktop ? preOrderTotalDesktop : preOrderTotal;
    const paymentTotalEl = isDesktop ? paymentTotalAmountDesktop : paymentTotalAmount;
    const clearCartBtn = isDesktop ? clearCartBtnDesktop : clearCartBtnMobile; 
    if (!itemsEl || !badgeEl) return;
    hasUnsavedChanges = preOrderCart.length > 0;
    const totalDistinctItems = preOrderCart.length; 
    badgeEl.textContent = totalDistinctItems.toString();
    badgeEl.style.display = totalDistinctItems > 0 ? 'block' : 'none';
    if (preOrderCart.length === 0) {
        itemsEl.innerHTML = `<p style="color: #888; text-align: center;">Your cart is empty.</p>`;
        checkoutBtnEl.disabled = true;
        if (clearCartBtn) clearCartBtn.disabled = true; 
        if (wrapperEl && !wrapperEl.classList.contains('collapsed')) {
             wrapperEl.classList.add('collapsed');
        }
    } else {
        itemsEl.innerHTML = "";
        preOrderCart.forEach(item => {
            const itemEl = document.createElement("div");
            itemEl.className = "preorder-cart-item";
            itemEl.innerHTML = `
                <span class="name">${item.name}</span>
                <div class="preorder-qty-controls">
                    <button class="preorder-qty-btn" data-id="${item.id}" data-change="-1">−</button>
                    <span class="qty-display">${item.quantity}</span>
                    <button class="preorder-qty-btn" data-id="${item.id}" data-change="1">+</button>
                </div>
                <span class="price">₱${(item.price * item.quantity).toFixed(2)}</span>
            `;
            itemsEl.appendChild(itemEl);
        });
        checkoutBtnEl.disabled = false;
        if (clearCartBtn) clearCartBtn.disabled = false; 
        if (wrapperEl && wrapperEl.classList.contains('collapsed')) {
             wrapperEl.classList.remove('collapsed');
        }
    }
 const subtotal = preOrderCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const tax = subtotal * 0.12;
    
    // NEW: Add VIP room fee if selected
    const vipFee = isVipSelected ? 3500 : 0;
    const total = subtotal + tax + vipFee;
    
    if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
    if (taxEl) taxEl.textContent = `₱${tax.toFixed(2)}`;
    if (totalEl) {
        if (vipFee > 0) {
            totalEl.innerHTML = `₱${total.toFixed(2)} <span style="font-size: 0.85rem; display: block; color: var(--color-text-light);">(includes ₱3,500 VIP fee)</span>`;
        } else {
            totalEl.textContent = `₱${total.toFixed(2)}`;
        }
    }
    if (paymentTotalEl) paymentTotalEl.textContent = `₱${total.toFixed(2)}`;
}

function openPaymentModal() {
    if (preOrderCart.length === 0 && !currentReservationData.isVip) {
        // If cart is empty AND it's not a VIP room, just save.
        // We add the check for !currentReservationData.isVip because
        // a VIP room might require payment even with no pre-order.
        // For simplicity, we'll assume non-VIP + no pre-order = free confirmation.
        // If you want to *force* payment for non-pre-order, remove this if-block.
        
        // Let's assume for now *all* reservations must go to payment page
        // even if cart is empty, in case of a reservation fee.
        // If cart is empty, we just skip to saveReservation.
        
        // NO, the user flow implies payment is for pre-order.
        // Let's stick to the prompt.
        // IF cart is empty, just call saveReservation.
        
        // --- DECISION ---
        // The user *might* want a "reservation fee" even if cart is empty.
        // The current flow *forces* them to the payment page.
        // Let's keep this, but change finalizePreOrder.
    }
    
    // This logic is from previous step, it's correct.
    const isDesktop = window.innerWidth > 992;
    
    // Find the right elements for mobile or desktop
    const receiptFile = isDesktop ? receiptFileInputDesktop : receiptFileInput;
    const uploadBtn = isDesktop ? uploadReceiptBtnDesktop : uploadReceiptBtn;
    const previewLink = isDesktop ? receiptPreviewLinkDesktop : receiptPreviewLink; 
    const summaryName = isDesktop ? document.getElementById('payment-summary-name-desktop') : document.getElementById('payment-summary-name-mobile');
    const summaryDate = isDesktop ? document.getElementById('payment-summary-date-desktop') : document.getElementById('payment-summary-date-mobile');
    const summaryTime = isDesktop ? document.getElementById('payment-summary-time-desktop') : document.getElementById('payment-summary-time-mobile');
    const summaryDiners = isDesktop ? document.getElementById('payment-summary-diners-desktop') : document.getElementById('payment-summary-diners-mobile');
    const summaryItems = isDesktop ? document.getElementById('payment-summary-items-desktop') : document.getElementById('payment-summary-items-mobile');

    currentReceiptFile = null;
    if (receiptFile) receiptFile.value = "";
    if (previewLink) previewLink.style.display = "none"; 
    
    // MODIFICATION: Enable upload button if cart is empty (for 0 peso reservation)
    if (uploadBtn) {
        if (preOrderCart.length === 0) {
            uploadBtn.disabled = false; // Allow "confirming" a 0-peso order
        } else {
            uploadBtn.disabled = true; // Force receipt upload if cart has items
        }
    }


    // --- POPULATE SUMMARY ---
    if (currentReservationData) {
        if (summaryName) summaryName.textContent = currentReservationData.name;
        if (summaryDate) summaryDate.textContent = currentReservationData.date;
        if (summaryTime) {
      const timeIn = formatTimeDisplay(currentReservationData.timeIn);
        summaryTime.textContent = timeIn;
        }
        if (summaryDiners) summaryDiners.textContent = currentReservationData.numOfDiners;
    }
    
if (summaryItems) {
        let itemsHTML = '';
        
        if (preOrderCart.length > 0) {
            itemsHTML = preOrderCart.map(item => 
                `<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>${item.quantity}x ${item.name}</span>
                    <span style="font-weight: 600;">₱${(item.price * item.quantity).toFixed(2)}</span>
                </div>`
            ).join('');
        } else {
            itemsHTML = `<p style="color: #888;">No items pre-ordered.</p>`;
        }
        
        // NEW: Add VIP room fee to summary
        if (isVipSelected) {
            itemsHTML += `<div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-border); font-weight: 600; color: var(--color-gold);">
                <span>VIP Room Fee</span>
                <span>₱3,500.00</span>
            </div>`;
        }
        
        summaryItems.innerHTML = itemsHTML;
    }
    // --- END OF SUMMARY POPULATE ---

    if (window.innerWidth <= 992) {
        if (preOrderPaymentModal) preOrderPaymentModal.style.display = "block";
    } else {
        if (preOrderSection) preOrderSection.style.display = 'none'; 
        if (paymentSection) paymentSection.style.display = 'block'; 
    }
}


function handleReceiptFileSelect(event, isDesktop = false) {
    const uploadBtn = isDesktop ? uploadReceiptBtnDesktop : uploadReceiptBtn;
    const previewLink = isDesktop ? receiptPreviewLinkDesktop : receiptPreviewLink; 
    const file = event.target.files[0];
    if (file) {
        if (file.size > 5 * 1024 * 1024) { 
            alert('File is too large (Max 5MB).');
            return;
        }
        currentReceiptFile = file;
        hasUnsavedChanges = true;
        const objectURL = URL.createObjectURL(file);
        if (previewLink) {
            previewLink.dataset.src = objectURL; 
            previewLink.style.display = "block"; 
        }
        if (uploadBtn) uploadBtn.disabled = false;
    } else {
        currentReceiptFile = null;
        if (previewLink) {
            previewLink.style.display = "none"; 
            previewLink.dataset.src = "";
        }
        // Only disable if cart has items
        if (uploadBtn && preOrderCart.length > 0) {
             uploadBtn.disabled = true;
        }
    }
}

// MODIFIED: finalizePreOrder
async function finalizePreOrder() {
    // MODIFICATION: Check for receipt only if cart is NOT empty
    if (preOrderCart.length > 0 && !currentReceiptFile) {
        alert("Please upload a receipt screenshot for your pre-order.");
        return;
    }
    if (!currentReservationData) {
        alert("Error: Reservation data is missing. Please go back.");
        return;
    }
    
    const isDesktop = window.innerWidth > 992;
    const uploadBtn = isDesktop ? uploadReceiptBtnDesktop : uploadReceiptBtn;
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = "Processing...";
    }
    
    try {
        let receiptUrl = null;
        // Only upload if a file was provided
        if (currentReceiptFile) {
            uploadBtn.textContent = "Uploading Image...";
            receiptUrl = await uploadToCloudinary(currentReceiptFile);
        }
        
        const preOrderData = preOrderCart.map(item => ({
            productId: item.id.split('-')[0],
            name: item.name,
            quantity: item.quantity,
            pricePerItem: item.price
        }));
        
        // Update currentReservationData with the final pre-order info
        currentReservationData.preOrder = preOrderData;
        currentReservationData.paymentReceiptUrl = receiptUrl; // Will be null if no file, which is correct
        
        if (uploadBtn) uploadBtn.textContent = "Saving...";
        
        // This is the function that now creates the doc
        await saveReservation(); 
        
    } catch (err) {
        console.error("Error finalizing pre-order:", err);
        alert("There was an error saving your pre-order. Please try again.");
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "Confirm Pre-Order";
        }
    } 
    // No finally block, saveReservation calls success modal
}


// MODIFIED: handleBackSkip
async function handleBackSkip() {
    hasUnsavedChanges = false;
    if (window.innerWidth <= 992) {
        if (preOrderModal) preOrderModal.style.display = 'none'; 
    } else {
        if (preOrderSection) preOrderSection.style.display = 'none';
        if (reservationSectionMain) reservationSectionMain.style.display = 'flex'; 
    }
    if(confirmReservationBtn) confirmReservationBtn.disabled = false;
    
    // MODIFICATION: No doc to delete, just clear the data
    currentReservationData = null; 
    currentReservationId = null; // This was already null, but good to ensure
    preOrderCart = [];
    updatePreOrderCart(); 
}

// MODIFIED: saveReservation
async function saveReservation() {
    if (!currentReservationData) {
        console.log("No reservation data to save.");
        // Re-enable button if something went wrong
        const isDesktop = window.innerWidth > 992;
        const uploadBtn = isDesktop ? uploadReceiptBtnDesktop : uploadReceiptBtn;
        if (uploadBtn) uploadBtn.disabled = false;
        return; 
    }
    
    try {
        let savedId;
        let finalData = { ...currentReservationData }; // Copy the data

        // We run the transaction to CREATE or UPDATE
        await runTransaction(db, async (transaction) => {
// 1. Check for conflicts - now checking entire date, not specific time and allow up to 2 reservations per table
            const q = query(
                reservationsRef, 
                where("date", "==", finalData.date),
                where("status", "in", ["pending", "approved"])
            );
            const snapshot = await getDocs(q); 
            
            let conflict = false;
            const conflictTables = [];
            
            snapshot.forEach(doc => {
                if (currentReservationId && doc.id === currentReservationId) {
                    return; 
                }
                const res = doc.data();
                
                // MODIFIED: Check for any table overlap on the same date (ignore time)
                const reservedTables = res.tableNumbers || [res.tableNumber];
                const myTables = finalData.tableNumbers || [finalData.tableNumber];
                
                // Check for any overlap in tables
                myTables.forEach(myTable => {
                    if (reservedTables.includes(myTable)) {
                        conflict = true;
                        if (!conflictTables.includes(myTable)) {
                            conflictTables.push(myTable);
                        }
                    }
                });
            });

            if (conflict) {
                throw new Error(`Sorry, the following table(s) are already booked at this time: ${conflictTables.join(", ")}. Please select different tables.`);
            }
            
            // 2. No conflict, so either CREATE or UPDATE
            if (currentReservationId) {
                // This is an UPDATE (reschedule)
                const resDocRef = doc(db, "reservations", currentReservationId);
                transaction.update(resDocRef, finalData);
                savedId = currentReservationId; // Use existing ID
            } else {
                // This is a CREATE (new reservation)
                const newResRef = doc(collection(db, "reservations"));
                transaction.set(newResRef, finalData);
                savedId = newResRef.id; // Get new ID
            }
        });

        // 3. Transaction was successful!
        console.log(`✅ Reservation ${currentReservationId ? 'updated' : 'created'} with ID:`, savedId);
        
        // Show the correct receipt modal
        if (currentReservationId) {
             // This was a reschedule, show reschedule success
            resetMainForm(); 
            const successModal = document.getElementById('reschedule-success-modal');
            if (successModal) successModal.classList.remove('hidden');
        } else {
            // This was a new reservation, show final receipt
            showFinalSuccessMessage(savedId, finalData, preOrderCart);
        }

    } catch (error) {
        // Catch errors (like the conflict)
        console.error("Final reservation save failed:", error);
        alert(error.message); // Show error to user
        
        // Re-enable the payment button
        const isDesktop = window.innerWidth > 992;
        const uploadBtn = isDesktop ? uploadReceiptBtnDesktop : uploadReceiptBtn;
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "Confirm Pre-Order";
        }
    } finally {
        // Clear global data *after* success or fail
        currentReservationData = null; 
        currentReservationId = null; // Clear ID after use
        preOrderCart = []; // Clear cart
    }
}


// ===================================
// --- NEW HELPER FUNCTION ---
// Extracted from showFinalSuccessMessage
// ===================================
function resetMainForm() {
    document.getElementById("reservationForm")?.reset();
    setFormStepsDisabled(true); // This will also show the blur overlay
    if (reservationDateInput) reservationDateInput.value = "";
   if (reservationTimeInInput) reservationTimeInInput.value = "";
    // if (reservationTimeOutInput) reservationTimeOutInput.value = ""; // NEW
    
    updateTableVisuals(); 
    
    if (confirmReservationBtn) {
        confirmReservationBtn.disabled = true; // Start disabled
        confirmReservationBtn.textContent = "Confirm Reservation";
    }
}

// --- MODIFIED ---
// This function is now ONLY for NEW reservations
function showFinalSuccessMessage(savedId, savedData, savedCart) {
        hasUnsavedChanges = false;
        
        // 1. Hide all other modals
        if (window.innerWidth <= 992) {
            if (preOrderModal) preOrderModal.style.display = "none";
            if (preOrderPaymentModal) preOrderPaymentModal.style.display = "none";
        } else {
            if (paymentSection) paymentSection.style.display = 'none';
            if (preOrderSection) preOrderSection.style.display = 'none'; 
            if (reservationSectionMain) reservationSectionMain.style.display = 'flex'; 
        }
        
        // 2. Find the new modal and its elements
        const modal = document.getElementById('final-reservation-summary-modal');
        const okBtn = document.getElementById('final-summary-ok-btn');
        if (!modal || !okBtn || !savedData) {
            console.error("Final summary modal not found or data missing!");
            resetMainForm();
            checkAuthState(); 
            return;
        }

        // 3. Populate the receipt modal
        document.getElementById('final-summary-id').textContent = savedId.substring(0, 8).toUpperCase();
        document.getElementById('final-summary-name').textContent = savedData.name;
        document.getElementById('final-summary-date').textContent = savedData.date;
        const timeIn = formatTimeDisplay(savedData.timeIn);
        const timeOut = formatTimeDisplay(savedData.timeOut);
        document.getElementById('final-summary-time').textContent = `${timeIn} to ${timeOut}`;
const tableDisplay = savedData.isVip 
            ? "VIP Room" 
            : (savedData.tableNumbers ? savedData.tableNumbers.join(", ") : savedData.tableNumber);
        document.getElementById('final-summary-table').textContent = tableDisplay;        document.getElementById('final-summary-diners').textContent = savedData.numOfDiners;

        const itemsEl = document.getElementById('final-summary-items');
        const totalEl = document.getElementById('final-summary-total');
        
let itemsHTML = '';
        const subtotal = savedCart && savedCart.length > 0 
            ? savedCart.reduce((sum, item) => sum + (item.price * item.quantity), 0) 
            : 0;
        const tax = subtotal * 0.12;
        const vipFee = savedData.isVip ? 3500 : 0;
        const total = subtotal + tax + vipFee;
        
        if (savedCart && savedCart.length > 0) {
            itemsHTML = savedCart.map(item => 
                `<div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>${item.quantity}x ${item.name}</span>
                    <span style="font-weight: 600;">₱${(item.price * item.quantity).toFixed(2)}</span>
                </div>`
            ).join('');
        } else {
            itemsHTML = `<p style="color: #888;">No items were pre-ordered.</p>`;
        }
        
        // NEW: Add VIP fee to final receipt
        if (vipFee > 0) {
            itemsHTML += `<div style="display: flex; justify-content: space-between; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--color-border); font-weight: 600; color: var(--color-gold);">
                <span>VIP Room Fee</span>
                <span>₱3,500.00</span>
            </div>`;
        }
        
        itemsEl.innerHTML = itemsHTML;
        
        totalEl.innerHTML = `
            <div style="font-weight: normal; font-size: 0.9rem;">Subtotal: ₱${subtotal.toFixed(2)}</div>
            <div style="font-weight: normal; font-size: 0.9rem;">Tax (12%): ₱${tax.toFixed(2)}</div>
            ${vipFee > 0 ? `<div style="font-weight: normal; font-size: 0.9rem;">VIP Room Fee: ₱${vipFee.toFixed(2)}</div>` : ''}
            <div style="margin-top: 5px;">Total: ₱${total.toFixed(2)}</div>
        `;

        // 4. Show the modal
        modal.classList.remove('hidden');

        // 5. Add listener to its OK button
        // Use .cloneNode to remove any old listeners
        const newOkBtn = okBtn.cloneNode(true);
        okBtn.parentNode.replaceChild(newOkBtn, okBtn);
        
        newOkBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
            resetMainForm();
            checkAuthState(); // Re-check to show the "pending reservation" modal
        });
    }


// ===================================
// INITIALIZE
// ===================================

document.addEventListener("DOMContentLoaded", () => {
  // --- Assign Reservation Form elements ---
  reservationDateInput = document.getElementById("reservationDate");
  checkAvailabilityBtn = document.getElementById("checkAvailabilityBtn");
  availabilityLoader = document.getElementById("availabilityLoader");
  availabilityMessage = document.getElementById("availability-message");
  
  // MODIFIED: Assign new time inputs
  reservationTimeInInput = document.getElementById("reservationTimeIn");
  
  numberOfDinersInput = document.getElementById("numberOfDiners");
  notesInput = document.getElementById("notes");
  agreeTermsCheckbox = document.getElementById("agreeTerms");
  confirmReservationBtn = document.getElementById("confirmReservationBtn");
  reservationSectionMain = document.getElementById("reservation-section-main"); 
  layoutBlurOverlay = document.getElementById("layout-blur-overlay"); // NEW
  
  // --- (All other element assignments remain the same) ---
  preOrderModal = document.getElementById("preorder-modal");
  preOrderCategories = document.getElementById("preorder-categories");
  preOrderGrid = document.getElementById("preorder-grid");
  preOrderCartItems = document.getElementById("preOrderCartItems");
  preOrderSubtotal = document.getElementById("preOrderSubtotal");
  preOrderTax = document.getElementById("preOrderTax");
  preOrderTotal = document.getElementById("preOrderTotal");
  preOrderCheckoutBtn = document.getElementById("preOrderCheckoutBtn");
  clearCartBtnMobile = document.getElementById("clear-cart-btn-mobile"); 
  preOrderVariationModal = document.getElementById("preorder-variation-modal");
  preOrderVariationTitle = document.getElementById("preorder-variation-title");
  preOrderVariationOptions = document.getElementById("preorder-variation-options");
  cancelPreOrderVariationBtn = document.getElementById("cancel-preorder-variation");
  preOrderPaymentModal = document.getElementById("preorder-payment-modal");
  cancelPaymentBtn = document.getElementById("cancel-payment-btn");
  paymentTotalAmount = document.getElementById("payment-total-amount");
  receiptFileInput = document.getElementById("receipt-file-input");
  receiptPreviewLink = document.getElementById("receipt-preview-link"); 
  uploadReceiptBtn = document.getElementById("upload-receipt-btn");
  paymentBackBtnMobile = document.getElementById("payment-back-btn-mobile"); 
  preorderBackBtn = document.querySelector("#preorder-modal .preorder-back-btn");
  cartIconContainer = document.getElementById("cartIconContainer");
  cartBadge = document.getElementById("cartBadge");
  preOrderCartItemsWrapper = document.getElementById("preOrderCartItemsWrapper");
  preOrderSection = document.getElementById("preorder-section");
  preOrderCategoriesDesktop = document.getElementById("preorder-categories-desktop");
  preOrderGridDesktop = document.getElementById("preorder-grid-desktop");
  preOrderCartItemsDesktop = document.getElementById("preOrderCartItems-desktop");
  preOrderSubtotalDesktop = document.getElementById("preOrderSubtotal-desktop");
  preOrderTaxDesktop = document.getElementById("preOrderTax-desktop");
  preOrderTotalDesktop = document.getElementById("preOrderTotal-desktop");
  preOrderCheckoutBtnDesktop = document.getElementById("preOrderCheckoutBtn-desktop");
  clearCartBtnDesktop = document.getElementById("clear-cart-btn-desktop"); 
  paymentSection = document.getElementById("payment-section");
  cancelPaymentBtnDesktop = document.getElementById("cancel-payment-btn-desktop");
  paymentTotalAmountDesktop = document.getElementById("payment-total-amount-desktop");
  receiptFileInputDesktop = document.getElementById("receipt-file-input-desktop");
  receiptPreviewLinkDesktop = document.getElementById("receipt-preview-link-desktop"); 
  uploadReceiptBtnDesktop = document.getElementById("upload-receipt-btn-desktop");
  preorderBackBtnDesktop = document.querySelector("#preorder-section .preorder-back-btn");
  cartIconContainerDesktop = document.getElementById("cartIconContainer-desktop");
  cartBadgeDesktop = document.getElementById("cartBadge-desktop");
  preOrderCartItemsWrapperDesktop = document.getElementById("preOrderCartItemsWrapper-desktop");
  const receiptModal = document.getElementById("reservation-receipt-modal");
  const receiptModalImage = document.getElementById("receipt-modal-image");
  const closeReceiptModalBtn = document.getElementById("close-receipt-modal");

  
  // --- Standard Init ---
  setDateRestrictions();
  populateTimeDropdowns(); // NEW: Populate time dropdowns
  setupTimeDropdownLogic(); // NEW: Add listener for Time In
  initializeTableClicks();
  checkAuthState();
  setFormStepsDisabled(true); // This will show the blur overlay by default

  // ... (your existing 'input' and 'beforeunload' listeners) ...
  const reservationFormInputs = document.querySelectorAll('#reservationForm input, #reservationForm select, #reservationForm textarea');
  reservationFormInputs.forEach(input => {
      input.addEventListener('input', () => {
          hasUnsavedChanges = true;
      });
  });
  window.addEventListener('beforeunload', (event) => {
      if (hasUnsavedChanges) {
          event.preventDefault();
          event.returnValue = ''; 
      }
  });

  // --- Reservation Form Listeners ---
  if (checkAvailabilityBtn) checkAvailabilityBtn.addEventListener("click", checkAvailability);
  
  // MODIFIED: Date/Time inputs should reset the form
// MODIFIED: Date/Time inputs should reset the form
  const resetInputs = [reservationDateInput, reservationTimeInInput];
    resetInputs.forEach(input => {
      if (input) {
          input.addEventListener("input", () => {
              setFormStepsDisabled(true); // Re-disable form steps and show blur
              if (availabilityMessage) availabilityMessage.textContent = "";
          });
      }
  });
  
  const form = document.getElementById("reservationForm");
  if (form) form.addEventListener("submit", handleReservation);

  // --- Auth Modal Close Button ---
  const authModal = document.getElementById('auth-validation-modal');
  if (authModal) {
      const authModalClose = authModal.querySelector('.auth-modal-close-btn');
      if (authModalClose) {
          authModalClose.addEventListener('click', () => {
              authModal.classList.add('hidden');
          });
      }
  }

  // --- Pending Reservation Modal Listener ---
  const pendingModal = document.getElementById('pending-reservation-modal');
  const rescheduleBtn = document.getElementById('reschedule-btn');
  const mainSection = document.getElementById('reservation-section-main');
  if (rescheduleBtn && pendingModal && mainSection) {
      rescheduleBtn.addEventListener('click', () => {
          pendingModal.classList.add('hidden');
          mainSection.classList.remove('blurred-section');
      });
  }

  // --- NEW: Reschedule Success Modal Listener ---
  const rescheduleSuccessModal = document.getElementById('reschedule-success-modal');
  const rescheduleOkBtn = document.getElementById('reschedule-ok-btn');

  if (rescheduleSuccessModal && rescheduleOkBtn) {
      rescheduleOkBtn.addEventListener('click', () => {
          rescheduleSuccessModal.classList.add('hidden');
          // NOW we re-check for the pending reservation, which will show the
          // "Active Reservation Found" modal with the new date.
          if (currentUserId) {
              checkForPendingReservation(currentUserId);
          }
      });
  }
  // --- END NEW ---

  // ... (all your existing listeners for pre-order, payment, cart, etc.) ...
  if (preOrderCategories) preOrderCategories.addEventListener("click", (e) => {
      if (e.target.tagName === "LI") {
          document.querySelectorAll("#preorder-categories li").forEach(li => li.classList.remove("active"));
          e.target.classList.add("active");
          renderPreOrderMenu(e.target.dataset.category, false); 
      }
  });
  if (preOrderCheckoutBtn) preOrderCheckoutBtn.addEventListener("click", openPaymentModal);
if (cancelPreOrderVariationBtn) cancelPreOrderVariationBtn.addEventListener("click", () => {
    if (preOrderVariationModal) {
        preOrderVariationModal.style.display = "none";
        preOrderVariationModal.classList.add("hidden");
    }
});
  if (cancelPaymentBtn) cancelPaymentBtn.addEventListener("click", () => {
      if (preOrderPaymentModal) preOrderPaymentModal.style.display = "none";
  });
  if (receiptFileInput) receiptFileInput.addEventListener("change", (e) => handleReceiptFileSelect(e, false)); 
  if (uploadReceiptBtn) uploadReceiptBtn.addEventListener("click", finalizePreOrder);
  if (preorderBackBtn && preOrderModal) {
      preorderBackBtn.addEventListener('click', handleBackSkip);
  }
  if (paymentBackBtnMobile) {
      paymentBackBtnMobile.addEventListener('click', () => {
          if (preOrderPaymentModal) preOrderPaymentModal.style.display = "none";
          if (preOrderModal) preOrderModal.style.display = "block";
      });
  }
  if (cartIconContainer && preOrderCartItemsWrapper) {
      cartIconContainer.addEventListener('click', () => {
          preOrderCartItemsWrapper.classList.toggle('collapsed');
      });
  }
  if (preOrderCartItems) {
      preOrderCartItems.addEventListener('click', (e) => {
          const button = e.target.closest('.preorder-qty-btn');
          if (button) {
              const itemId = button.dataset.id;
              const change = parseInt(button.dataset.change, 10);
              adjustPreOrderItemQuantity(itemId, change);
          }
      });
  }
  if (preOrderCategoriesDesktop) preOrderCategoriesDesktop.addEventListener("click", (e) => {
      if (e.target.tagName === "LI") {
          document.querySelectorAll("#preorder-categories-desktop li").forEach(li => li.classList.remove("active"));
          e.target.classList.add("active");
          renderPreOrderMenu(e.target.dataset.category, true); 
      }
  });
  if (preOrderCheckoutBtnDesktop) preOrderCheckoutBtnDesktop.addEventListener("click", openPaymentModal);
  if (cancelPaymentBtnDesktop) cancelPaymentBtnDesktop.addEventListener("click", () => {
      if (paymentSection) paymentSection.style.display = "none";
      if (preOrderSection) preOrderSection.style.display = "block"; 
  });
  if (receiptFileInputDesktop) receiptFileInputDesktop.addEventListener("change", (e) => handleReceiptFileSelect(e, true)); 
  if (uploadReceiptBtnDesktop) uploadReceiptBtnDesktop.addEventListener("click", finalizePreOrder);
 if (preorderBackBtnDesktop && preOrderSection && reservationSectionMain) {
      preorderBackBtnDesktop.addEventListener('click', handleBackSkip);
  }
  if (cartIconContainerDesktop && preOrderCartItemsWrapperDesktop) {
      cartIconContainerDesktop.addEventListener('click', () => {
          preOrderCartItemsWrapperDesktop.classList.toggle('collapsed');
      });
  }
  if (preOrderCartItemsDesktop) {
      preOrderCartItemsDesktop.addEventListener('click', (e) => {
          const button = e.target.closest('.preorder-qty-btn');
          if (button) {
              const itemId = button.dataset.id;
              const change = parseInt(button.dataset.change, 10);
              adjustPreOrderItemQuantity(itemId, change);
          }
      });
  }
  const clearCartAction = () => {
      if (preOrderCart.length > 0 && confirm("Are you sure you want to clear your cart?")) {
          preOrderCart = [];
          updatePreOrderCart();
      }
  };
  if (clearCartBtnMobile) clearCartBtnMobile.addEventListener('click', clearCartAction);
  if (clearCartBtnDesktop) clearCartBtnDesktop.addEventListener('click', clearCartAction);
  const openReceiptModal = (e) => {
      const src = e.target.dataset.src;
      if (src && receiptModal && receiptModalImage) {
          receiptModalImage.src = src;
          receiptModal.classList.remove("hidden");
      }
  };
  const closeReceiptModal = () => {
      if (receiptModal) receiptModal.classList.add("hidden");
      if (receiptModalImage) receiptModalImage.src = ""; 
  };
  if (receiptPreviewLink) receiptPreviewLink.addEventListener('click', openReceiptModal);
  if (receiptPreviewLinkDesktop) receiptPreviewLinkDesktop.addEventListener('click', openReceiptModal);
  if (closeReceiptModalBtn) closeReceiptModalBtn.addEventListener('click', closeReceiptModal);
  if (receiptModal) receiptModal.addEventListener('click', (e) => {
      if (e.target === receiptModal) closeReceiptModal(); 
  });
  if (cartBadge) cartBadge.style.display = 'none';
  if (cartBadgeDesktop) cartBadgeDesktop.style.display = 'none';
  const openTerms = document.getElementById("openTerms");
  const closeTerms = document.getElementById("closeTerms");
  const termsModal = document.getElementById("termsModal");
  if (openTerms && closeTerms && termsModal) {
    openTerms.addEventListener("click", (e) => { e.preventDefault(); termsModal.classList.remove("hidden"); });
    closeTerms.addEventListener("click", () => { termsModal.classList.add("hidden"); });
    window.addEventListener("click", (e) => { if (e.target === termsModal) termsModal.classList.add("hidden"); });
  }
  const floorToggle = document.getElementById("floorToggle");
  const firstFloor = document.getElementById("cafeImageContainer");
  const secondFloor = document.getElementById("secondFloorContainer");
  let isUpstairs = false;
  if (floorToggle && firstFloor && secondFloor) {
    floorToggle.addEventListener("click", () => {
      isUpstairs = !isUpstairs;
      firstFloor.classList.toggle("hidden", isUpstairs);
      secondFloor.classList.toggle("hidden", !isUpstairs);
      floorToggle.textContent = isUpstairs ? "See Downstairs" : "See Upstairs";
    });
  }
  const vipModal = document.getElementById("vipModal");
  const paymentModal = document.getElementById("paymentModal");
  const closeVip = document.getElementById("closeVip");
  const cancelVip = document.getElementById("cancelVip");
  const proceedPayment = document.getElementById("proceedPayment");
  const closePayment = document.getElementById("closePayment");
  const closePaymentBtn = document.getElementById("closePaymentBtn");
  if (closeVip) closeVip.addEventListener("click", () => vipModal.classList.add("hidden"));
  if (cancelVip) cancelVip.addEventListener("click", () => vipModal.classList.add("hidden"));
  if (proceedPayment) proceedPayment.addEventListener("click", () => {
      vipModal.classList.add("hidden");
      paymentModal.classList.remove("hidden");
  });
  function completeVipPayment() {
      paymentModal.classList.add("hidden");
      vipPaymentCompleted = true;
      if(confirmReservationBtn) confirmReservationBtn.click(); 
  }
  if (closePayment) closePayment.addEventListener("click", completeVipPayment);
  if (closePaymentBtn) closePaymentBtn.addEventListener("click", completeVipPayment);
  window.addEventListener("click", (e) => {
    if (e.target === vipModal) vipModal.classList.add("hidden");
    if (e.target === paymentModal) paymentModal.classList.add("hidden");
  });
});