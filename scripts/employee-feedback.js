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
    if (!userId) return;

    let message = "";
    const snippet = comment.length > 30 ? comment.substring(0, 30) + "..." : comment;
    
    if (newStatus === "approved") {
        message = `Your feedback ("${snippet}") has been approved and posted to the bulletin board!`;
    } else if (newStatus === "rejected") {
        message = `Your feedback ("${snippet}") was reviewed but could not be posted.`;
    } else if (newStatus === "deleted") {
        message = `Your feedback ("${snippet}") has been removed from the bulletin board.`;
    } else {
        return;
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
    const status = data.status || "pending";
    const isApproved = status === "approved";
    const isRejected = status === "rejected";

    const card = document.createElement("div");
    card.className = `feedback-card ${isApproved ? "approved" : (isRejected ? "rejected" : "pending")}`;
    card.dataset.id = id;

    // --- 1. Overall Rating ---
    let overallRatingHtml = '';
    if (data.ratings && data.ratings.overall) {
        overallRatingHtml = createStarRatingString(data.ratings.overall);
    } else if (data.rating) {
        overallRatingHtml = `<span class="feedback-rating-emoji">${data.rating}</span>`;
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

    // --- 4. Actions based on status ---
    let actionsHtml = '';
    if (status === "pending") {
        actionsHtml = `
            <div class="feedback-actions">
                <button class="btn btn--small btn--icon-approve approve-btn" data-id="${id}" title="Approve">✔️ Approve</button>
                <button class="btn btn--small btn--icon-reject reject-btn" data-id="${id}" title="Reject">❌ Reject</button>
            </div>
        `;
    } else if (status === "approved" || status === "rejected") {
        actionsHtml = `
            <div class="feedback-actions">
                <button class="btn btn--small btn--icon-delete delete-btn" data-id="${id}" title="Delete">🗑️ Delete</button>
            </div>
        `;
    }
    
    // --- 5. Date ---
    let dateStr = "—";
    if (data.timestamp) {
        dateStr = data.timestamp.toDate().toLocaleDateString();
    }

    // --- 6. Status Badge ---
// --- 6. Status Badge ---
let statusBadgeHtml = '';
if (status === "approved") {
    statusBadgeHtml = `<span class="status status-approved">Approved</span>`;
} else if (status === "rejected") {
    statusBadgeHtml = `<span class="status status-blocked">Rejected</span>`;
}

// --- Assemble Card ---
card.innerHTML = `
    <div class="feedback-header">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
            <h3 style="margin: 0;">${data.name || "Anonymous"}</h3>
            ${statusBadgeHtml ? statusBadgeHtml : ''}
        </div>
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
    await updateDoc(docRef, { status: newStatus });
    alert(`Feedback ${newStatus}.`);
    
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        await sendFeedbackNotification(data.userId, data.comment, newStatus);
    }

    calculateAndDisplayAverageRating(); 
  } catch (error) {
    console.error("Error updating feedback status:", error);
    alert("Error updating feedback status. Check console.");
  }
}

/**
 * NEW: Move feedback to history (soft delete)
 */
async function deleteFeedback(id) {
  if (!confirm("Are you sure you want to delete this feedback? It will be moved to the feedback history.")) return;

  const docRef = doc(db, "customerFeedback", id);
  try {
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) {
      alert("Feedback not found.");
      return;
    }

    const data = docSnap.data();
    
    // 1. Update status to "deleted" instead of actually deleting
    await updateDoc(docRef, { 
      status: "deleted",
      deletedAt: serverTimestamp(),
      deletedBy: document.querySelector(".employee-name")?.textContent || "Employee"
    });

    // 2. Send notification to user
    await sendFeedbackNotification(data.userId, data.comment, "deleted");

    alert("Feedback moved to history successfully.");
    calculateAndDisplayAverageRating();
  } catch (error) {
    console.error("Error deleting feedback:", error);
    alert("Error deleting feedback. Check console.");
  }
}

/**
 * NEW: Load feedback history (deleted items)
 */
export function loadFeedbackHistory() {
    const historyTableBody = document.getElementById('feedback-history-table-body');
    if (!historyTableBody) {
        console.error("❌ Feedback history table body not found!");
        return;
    }

    console.log("📋 Loading feedback history...");

    const q = query(
        feedbackCollection,
        where("status", "==", "deleted"),
        orderBy("deletedAt", "desc")
    );

    onSnapshot(q, (snapshot) => {
        console.log(`✅ Found ${snapshot.size} deleted feedback items`);
        
        historyTableBody.innerHTML = "";

        if (snapshot.empty) {
            historyTableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 20px; color: #999;">
                No deleted feedback found.
                </td>
            </tr>
            `;
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const row = document.createElement("tr");

            // Overall rating
            let overallRating = "N/A";
            if (data.ratings && data.ratings.overall) {
                overallRating = createStarRatingString(data.ratings.overall);
            }

            // Date
            let dateStr = "—";
            if (data.timestamp) {
                dateStr = data.timestamp.toDate().toLocaleDateString();
            }

            // Deleted date
            let deletedDateStr = "—";
            if (data.deletedAt && data.deletedAt.toDate) {
                deletedDateStr = data.deletedAt.toDate().toLocaleDateString();
            }

            // Image
            let imageCell = "—";
            if (data.imageUrl) {
                imageCell = `<button class="btn btn--secondary btn--sm view-history-image-btn" data-src="${data.imageUrl}">View</button>`;
            }

            row.innerHTML = `
                <td>${data.name || "Anonymous"}</td>
                <td>${overallRating}</td>
                <td style="max-width: 300px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${data.comment || "—"}</td>
                <td>${imageCell}</td>
                <td>${dateStr}</td>
                <td>${deletedDateStr}</td>
                <td>${data.deletedBy || "—"}</td>
            `;

            historyTableBody.appendChild(row);
        });

        console.log("✅ Feedback history rendered successfully");

    }, (error) => {
        console.error("❌ Error loading feedback history:", error);
        historyTableBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: red;">Error loading feedback history. Check console.</td></tr>`;
    });
}

/**
 * Main function to load and listen for feedback
 */
function loadFeedback() {
    if (!feedbackGrid) return;
    
    calculateAndDisplayAverageRating();

    // Only show non-deleted feedback
    const q = query(
        feedbackCollection, 
        where("status", "!=", "deleted"),
        orderBy("status", "desc"),
        orderBy("timestamp", "desc")
    );

    onSnapshot(q, (snapshot) => {
        feedbackGrid.innerHTML = "";

        if (snapshot.empty) {
            feedbackGrid.innerHTML = "<p>No customer feedback yet.</p>";
            const feedbackAlertDot = document.getElementById('feedback-alert-dot');
            if (feedbackAlertDot) {
                feedbackAlertDot.style.display = 'none';
            }
            return;
        }
        
        let pendingCount = 0;
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.status === "pending") {
                pendingCount++;
            }
            renderFeedbackCard(docSnap);
        });

        const feedbackAlertDot = document.getElementById('feedback-alert-dot');
        if (feedbackAlertDot) {
            feedbackAlertDot.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        }

    }, (error) => {
        console.error("Error loading feedback: ", error);
        feedbackGrid.innerHTML = "<p>Error loading feedback.</p>";
    });
}

// --- Initialize All Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    
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

    // History table image clicks
    const historyTableBody = document.getElementById('feedback-history-table-body');
    if (historyTableBody) {
        historyTableBody.addEventListener('click', (e) => {
            const target = e.target;
            const button = target.closest('button');
            
            if (button && button.classList.contains('view-history-image-btn')) {
                const imageUrl = button.dataset.src;
                if (imageModal && modalImage && imageUrl) {
                    modalImage.src = imageUrl;
                    imageModal.style.display = 'flex';
                }
            }
        });
    }

    // Modal close listeners
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