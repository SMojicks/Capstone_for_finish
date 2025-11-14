import { db } from "./firebase.js";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  orderBy,
  addDoc,         
  serverTimestamp, 
  getDoc
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// --- DOM Elements ---
const feedbackGrid = document.getElementById("feedback-grid-container");
const overallAverageRatingDisplay = document.getElementById("overall-average-rating");
const imageModal = document.getElementById('image-view-modal');
const modalImage = document.getElementById('modal-image-src');
const closeImageModal = document.getElementById('close-image-modal');
const feedbackCollection = collection(db, "customerFeedback");

/**
 * Creates the star rating HTML string (e.g., "★★★★☆")
 */
async function sendFeedbackNotification(userId, comment, newStatus) {
    if (!userId) return; // Can't send without a user ID

    let message = "";
    const snippet = comment.length > 30 ? comment.substring(0, 30) + "..." : comment;
    
    if (newStatus === "approved") {
        message = `Your feedback ("${snippet}") has been approved and posted to the bulletin board!`;
    } else if (newStatus === "rejected") {
        message = `Your feedback ("${snippet}") was reviewed but could not be posted.`;
    } else {
        return; // Don't send for other statuses
    }

    try {
        await addDoc(collection(db, "notifications"), {
            userId: userId,
            message: message,
            type: `feedback_${newStatus}`,
            link: "community-feedback.html",
            read: false,
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Failed to send notification:", error);
    }
}
function createStarRatingString(ratingValue) {
    const rating = parseInt(ratingValue, 10);
    if (isNaN(rating) || rating < 1) return "N/A";
    const star = '★';
    const emptyStar = '☆';
    return `${star.repeat(rating)}${emptyStar.repeat(5 - rating)}`;
}

/**
 * Calculates and displays the overall average rating from *approved* feedback
 */
async function calculateAndDisplayAverageRating() {
    if (!overallAverageRatingDisplay) return;

    let totalRatings = 0;
    let numberOfFeedbacks = 0;
    
    try {
        const q = query(feedbackCollection, where("status", "==", "approved"));
        const snapshot = await getDocs(q);

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Check for the new 'ratings' object and the 'overall' property
            if (data.ratings && data.ratings.overall) {
                totalRatings += parseInt(data.ratings.overall, 10);
                numberOfFeedbacks++;
            }
        });

        if (numberOfFeedbacks > 0) {
            const average = (totalRatings / numberOfFeedbacks).toFixed(1);
            overallAverageRatingDisplay.textContent = average;
        } else {
            overallAverageRatingDisplay.textContent = "N/A";
        }
    } catch (error) {
        console.error("Error calculating average rating:", error);
        overallAverageRatingDisplay.textContent = "Error";
    }
}

/**
 * Renders a single feedback card into the grid
 */
function renderFeedbackCard(docSnap) {
    if (!feedbackGrid) return;
    
    const data = docSnap.data();
    const id = docSnap.id;
    const isApproved = data.status === "approved";

    const card = document.createElement("div");
    card.className = `feedback-card ${isApproved ? "approved" : "pending"}`;
    card.dataset.id = id;

    // --- 1. Overall Rating ---
    let overallRatingHtml = '';
    if (data.ratings && data.ratings.overall) {
        overallRatingHtml = createStarRatingString(data.ratings.overall);
    } else if (data.rating) {
        overallRatingHtml = `<span class="feedback-rating-emoji">${data.rating}</span>`; // Fallback for old emoji
    }

    // --- 2. Detailed Ratings ---
    let detailedRatingsHtml = '';
    if (data.ratings) {
        detailedRatingsHtml = `
            <div class="detailed-ratings">
                <div class="rating-item">
                    <span>Quality:</span>
                    <span class="rating-display-stars">${createStarRatingString(data.ratings.quality)}</span>
                </div>
                <div class="rating-item">
                    <span>Service:</span>
                    <span class="rating-display-stars">${createStarRatingString(data.ratings.service)}</span>
                </div>
                <div class="rating-item">
                    <span>Ambience:</span>
                    <span class="rating-display-stars">${createStarRatingString(data.ratings.ambience)}</span>
                </div>
                <div class="rating-item">
                    <span>Value:</span>
                    <span class="rating-display-stars">${createStarRatingString(data.ratings.value)}</span>
                </div>
            </div>
        `;
    }

    // --- 3. Image ---
    let imageHtml = '';
    if (data.imageUrl) {
        imageHtml = `
            <div class="feedback-photo">
                <img src="${data.imageUrl}" alt="Customer Photo" class="feedback-image-thumb" data-src="${data.imageUrl}">
            </div>
        `;
    }

    // --- 4. Actions ---
 // --- 4. Actions ---
let actionsHtml = '';
if (!isApproved) {
    actionsHtml = `
        <div class="feedback-actions">
            <button class="btn btn--small btn--icon-approve approve-btn" data-id="${id}" title="Approve">✔️ Approve</button>
            <button class="btn btn--small btn--icon-reject reject-btn" data-id="${id}" title="Reject">❌ Reject</button>
        </div>
    `;
}
    
    // --- 5. Date ---
    let dateStr = "—";
    if (data.timestamp) {
        dateStr = data.timestamp.toDate().toLocaleDateString();
    }

    // --- Assemble Card ---
    card.innerHTML = `
        <div class="feedback-header">
            <h3>${data.name || "Anonymous"}</h3>
            <div class="overall-stars">${overallRatingHtml}</div>
        </div>
        <p class="feedback-comment">${data.comment || "—"}</p>
        ${detailedRatingsHtml}
        ${imageHtml}
        <div class="feedback-footer">
             <span class="feedback-date">${dateStr}</span>
             ${actionsHtml}
        </div>
    `;
    
    feedbackGrid.appendChild(card);
}

/**
 * Update feedback status in Firestore
 */
async function updateFeedbackStatus(id, newStatus) {
  const docRef = doc(db, "customerFeedback", id);
  try {
    // 1. Update the feedback
    await updateDoc(docRef, { status: newStatus });
    alert(`Feedback ${newStatus}.`);
    
    // 2. Send a notification
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        await sendFeedbackNotification(data.userId, data.comment, newStatus);
    }

    // Recalculate average
    calculateAndDisplayAverageRating(); 
  } catch (error) {
    console.error("Error updating feedback status:", error);
    alert("Error updating feedback status. Check console.");
  }
}

/**
 * Delete feedback from Firestore
 */
async function deleteFeedback(id) {
  if (!confirm("Are you sure you want to delete this feedback permanently?")) return;

  const docRef = doc(db, "customerFeedback", id);
  try {
    await deleteDoc(docRef);
    alert("Feedback deleted successfully.");
    // The onSnapshot listener will automatically refresh the UI
    calculateAndDisplayAverageRating(); // Recalculate average
  } catch (error) {
    console.error("Error deleting feedback:", error);
    alert("Error deleting feedback. Check console.");
  }
}

/**
 * Main function to load and listen for feedback
 */
function loadFeedback() {
    if (!feedbackGrid) return;
    
    // 1. Calculate average rating on first load
    calculateAndDisplayAverageRating();

    // 2. Set up real-time listener for all feedback
    const q = query(feedbackCollection, orderBy("timestamp", "desc"));
    onSnapshot(q, (snapshot) => {
        feedbackGrid.innerHTML = ""; // Clear old data

        if (snapshot.empty) {
            feedbackGrid.innerHTML = "<p>No customer feedback yet.</p>";
            return;
        }
        
        snapshot.forEach(renderFeedbackCard);

    }, (error) => {
        console.error("Error loading feedback: ", error);
        feedbackGrid.innerHTML = "<p>Error loading feedback.</p>";
    });
}

// --- Initialize All Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    
    // Initial load
    loadFeedback();

    // Event Delegation for action buttons and image clicks
    if (feedbackGrid) {
        feedbackGrid.addEventListener('click', (e) => {
            const target = e.target;
            
            if (target.closest('.approve-btn')) {
                const id = target.closest('.approve-btn').dataset.id;
                updateFeedbackStatus(id, "approved");
            } 
            else if (target.closest('.reject-btn')) {
                const id = target.closest('.reject-btn').dataset.id;
                updateFeedbackStatus(id, "rejected");
            }
            else if (target.closest('.delete-btn')) {
                const id = target.closest('.delete-btn').dataset.id;
                deleteFeedback(id);
            }
            else if (target.classList.contains('feedback-image-thumb')) {
                const fullImageUrl = target.dataset.src;
                if (modalImage) modalImage.src = fullImageUrl;
                if (imageModal) imageModal.style.display = 'flex';
            }
        });
    }

    // Modal close listeners (from original script)
    if (closeImageModal) {
        closeImageModal.addEventListener('click', () => {
            if (imageModal) imageModal.style.display = 'none';
        });
    }
    if (imageModal) {
        imageModal.addEventListener('click', (e) => {
            if (e.target === imageModal) {
                imageModal.style.display = 'none';
            }
        });
    }
});