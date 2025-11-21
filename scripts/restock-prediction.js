// scripts/restock-prediction.js
import { db } from './firebase.js';
import {
    collection, getDocs, query, where, orderBy, doc, updateDoc, Timestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// --- References ---
const ingredientsRef = collection(db, "ingredients");
const usageLogsRef = collection(db, "ingredientUsageLogs");

// --- DOM Elements ---
let tableBody, recalculateBtn, lookbackSelect, leadTimeInput, filterSelect;
let criticalCount, warningCount, goodCount, nodataCount;
let restockAlertDot, exportPdfBtn;

// --- State ---
let allPredictions = [];
let isLoading = false;

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
    // Get DOM elements
    tableBody = document.getElementById('restock-prediction-table-body');
    recalculateBtn = document.getElementById('recalculate-predictions-btn');
    lookbackSelect = document.getElementById('restock-lookback-days');
    leadTimeInput = document.getElementById('restock-lead-time');
    filterSelect = document.getElementById('restock-filter-status');
    
    criticalCount = document.getElementById('restock-critical-count');
    warningCount = document.getElementById('restock-warning-count');
    goodCount = document.getElementById('restock-good-count');
    nodataCount = document.getElementById('restock-nodata-count');
    
    restockAlertDot = document.getElementById('restock-alert-dot');
    exportPdfBtn = document.getElementById('export-restock-pdf-btn');
    
    // Event Listeners
    if (recalculateBtn) {
        recalculateBtn.addEventListener('click', () => loadRestockPredictions());
    }
    
    if (lookbackSelect) {
        lookbackSelect.addEventListener('change', () => loadRestockPredictions());
    }
    
    if (filterSelect) {
        filterSelect.addEventListener('change', () => renderPredictionsTable());
    }
    
    if (exportPdfBtn) {
        exportPdfBtn.addEventListener('click', exportPredictionsToPDF);
    }
    
    // Modal handlers
    const cancelBtn = document.getElementById('cancel-lead-time-btn');
    const form = document.getElementById('edit-lead-time-form');
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            document.getElementById('edit-lead-time-modal').style.display = 'none';
        });
    }
    
    if (form) {
        form.addEventListener('submit', handleSaveLeadTime);
    }
    
    // Setup navigation listener to load data when section becomes active
    setupNavigationListener();
});

// --- Setup Navigation Listener ---
function setupNavigationListener() {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            const section = this.getAttribute('data-section');
            if (section === 'restock-prediction' && allPredictions.length === 0) {
                loadRestockPredictions();
            }
        });
    });
}

// --- Main Load Function ---
export async function loadRestockPredictions() {
    if (isLoading) return;
    isLoading = true;
    
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;">Loading predictions...</td></tr>`;
    }
    
    try {
        const lookbackDays = parseInt(lookbackSelect?.value) || 30;
        const defaultLeadTime = parseInt(leadTimeInput?.value) || 3;
        
        // 1. Get all ingredients
        const ingredientsSnapshot = await getDocs(ingredientsRef);
        const ingredients = ingredientsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // 2. Get usage logs for the lookback period
        const lookbackDate = new Date();
        lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
        const lookbackTimestamp = Timestamp.fromDate(lookbackDate);
        
        const usageQuery = query(
            usageLogsRef,
            where('timestamp', '>=', lookbackTimestamp),
            orderBy('timestamp', 'desc')
        );
        
        const usageSnapshot = await getDocs(usageQuery);
        const usageLogs = usageSnapshot.docs.map(doc => doc.data());
        
        // 3. Calculate predictions for each ingredient
        allPredictions = ingredients.map(ingredient => {
            return calculatePrediction(ingredient, usageLogs, lookbackDays, defaultLeadTime);
        });
        
        // 4. Sort by days remaining (critical first)
        allPredictions.sort((a, b) => {
            // Items with no data go to the end
            if (a.status === 'nodata' && b.status !== 'nodata') return 1;
            if (b.status === 'nodata' && a.status !== 'nodata') return -1;
            // Then sort by days remaining
            return a.daysRemaining - b.daysRemaining;
        });
        
        // 5. Update UI
        updateSummaryCards();
        renderPredictionsTable();
        updateAlertDot();
        
    } catch (error) {
        console.error("Error loading restock predictions:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center; color: var(--color-red-500);">Error loading predictions. Please try again.</td></tr>`;
        }
    } finally {
        isLoading = false;
    }
}

// --- Calculate Prediction for Single Ingredient ---
function calculatePrediction(ingredient, usageLogs, lookbackDays, defaultLeadTime) {
    const ingredientId = ingredient.ingredientId || ingredient.id;
    
    // Filter usage logs for this ingredient
    const ingredientUsage = usageLogs.filter(log => 
        log.ingredientId === ingredientId || 
        log.ingredientId === ingredient.id
    );
    
    // Calculate current stock in base units
    const currentStockBase = (ingredient.stockQuantity || 0) * (ingredient.conversionFactor || 1);
    
    // Calculate total usage in the period
    const totalUsage = ingredientUsage.reduce((sum, log) => sum + (log.quantityUsed || 0), 0);
    
    // Calculate average daily usage
    const avgDailyUsage = totalUsage / lookbackDays;
    
    // Get lead time (ingredient-specific or default)
    const leadTime = ingredient.leadTimeDays || defaultLeadTime;
    
    // Calculate days remaining
    let daysRemaining = Infinity;
    let status = 'good';
    let recommendedReorderDate = null;
    
    if (avgDailyUsage > 0) {
        daysRemaining = currentStockBase / avgDailyUsage;
        
        // Calculate recommended reorder date (account for lead time)
        const reorderInDays = Math.max(0, daysRemaining - leadTime);
        recommendedReorderDate = new Date();
        recommendedReorderDate.setDate(recommendedReorderDate.getDate() + Math.floor(reorderInDays));
        
        // Determine status
        if (daysRemaining <= 3) {
            status = 'critical';
        } else if (daysRemaining <= 7) {
            status = 'warning';
        } else {
            status = 'good';
        }
    } else {
        // No usage data - check manual reorder point
        if (ingredient.reorderPoint && currentStockBase <= ingredient.reorderPoint) {
            status = 'warning';
            daysRemaining = 0; // Mark as needing attention
        } else {
            status = 'nodata';
        }
    }
    
    return {
        id: ingredient.id,
        ingredientId: ingredientId,
        name: ingredient.name || 'Unknown',
        category: ingredient.category || '-',
        currentStock: ingredient.stockQuantity || 0,
        currentStockBase: currentStockBase,
        stockUnit: ingredient.stockUnit || 'units',
        baseUnit: ingredient.baseUnit || 'units',
        conversionFactor: ingredient.conversionFactor || 1,
        avgDailyUsage: avgDailyUsage,
        totalUsage: totalUsage,
        usageDataPoints: ingredientUsage.length,
        daysRemaining: daysRemaining,
        leadTime: leadTime,
        reorderPoint: ingredient.reorderPoint || null,
        recommendedReorderDate: recommendedReorderDate,
        status: status,
        minStockThreshold: ingredient.minStockThreshold || 0
    };
}

// --- Update Summary Cards ---
function updateSummaryCards() {
    const counts = {
        critical: 0,
        warning: 0,
        good: 0,
        nodata: 0
    };
    
    allPredictions.forEach(p => {
        counts[p.status]++;
    });
    
    if (criticalCount) criticalCount.textContent = counts.critical;
    if (warningCount) warningCount.textContent = counts.warning;
    if (goodCount) goodCount.textContent = counts.good;
    if (nodataCount) nodataCount.textContent = counts.nodata;
}

// --- Update Alert Dot ---
function updateAlertDot() {
    const hasCritical = allPredictions.some(p => p.status === 'critical');
    if (restockAlertDot) {
        restockAlertDot.style.display = hasCritical ? 'inline-block' : 'none';
    }
}

// --- Render Table ---
function renderPredictionsTable() {
    if (!tableBody) return;
    
    const filterValue = filterSelect?.value || 'all';
    
    let filteredPredictions = allPredictions;
    
    if (filterValue === 'critical') {
        filteredPredictions = allPredictions.filter(p => p.status === 'critical');
    } else if (filterValue === 'warning') {
        filteredPredictions = allPredictions.filter(p => p.status === 'critical' || p.status === 'warning');
    } else if (filterValue === 'nodata') {
        filteredPredictions = allPredictions.filter(p => p.status === 'nodata');
    }
    
    if (filteredPredictions.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;">No items match the selected filter.</td></tr>`;
        return;
    }
    
    tableBody.innerHTML = '';
    
    filteredPredictions.forEach(prediction => {
        const row = document.createElement('tr');
        row.className = `restock-row-${prediction.status}`;
        
        // Status badge
        const statusBadge = getStatusBadge(prediction.status);
        
        // Format days remaining
        const daysDisplay = formatDaysRemaining(prediction.daysRemaining, prediction.status);
        
        // Format average daily usage
        const usageDisplay = prediction.avgDailyUsage > 0 
            ? `<span class="usage-display">${prediction.avgDailyUsage.toFixed(2)} ${prediction.baseUnit}/day</span>`
            : `<span class="usage-none">No data</span>`;
        
        // Format recommended reorder date
        const reorderDisplay = prediction.recommendedReorderDate 
            ? prediction.recommendedReorderDate.toLocaleDateString()
            : '-';
        
        // Format current stock
        const stockDisplay = `${prediction.currentStock.toFixed(2)} ${prediction.stockUnit}`;
        
        row.innerHTML = `
            <td>${statusBadge}</td>
            <td>${prediction.ingredientId}</td>
            <td><strong>${prediction.name}</strong></td>
            <td>${prediction.category}</td>
            <td>${stockDisplay}</td>
            <td>${usageDisplay}</td>
            <td>${daysDisplay}</td>
            <td>${reorderDisplay}</td>
            <td>${prediction.leadTime} days</td>
            <td class="actions-cell">
                <button class="btn-icon btn--icon-edit edit-lead-time-btn" data-id="${prediction.id}" title="Edit Settings">⚙️</button>
            </td>
        `;
        
        // Add event listener for edit button
        row.querySelector('.edit-lead-time-btn').addEventListener('click', () => {
            openEditLeadTimeModal(prediction);
        });
        
        tableBody.appendChild(row);
    });
}

// --- Helper Functions ---
function getStatusBadge(status) {
    const labels = {
        critical: '🔴 Critical',
        warning: '🟡 Warning',
        good: '🟢 Good',
        nodata: '⚪ No Data'
    };
    return `<span class="restock-status ${status}">${labels[status]}</span>`;
}
function formatDaysRemaining(days, status) {
    if (status === 'nodata') {
        return `<span class="days-nodata">Unknown</span>`;
    }
    
    if (days === Infinity) {
        return `<span class="days-good">∞</span>`;
    }
    
    const daysRounded = Math.floor(days);
    const className = status === 'critical' ? 'days-critical' 
        : status === 'warning' ? 'days-warning' 
        : 'days-good';
    
    return `<span class="${className}">${daysRounded} days</span>`;
}

// --- Edit Lead Time Modal ---
function openEditLeadTimeModal(prediction) {
    const modal = document.getElementById('edit-lead-time-modal');
    const idField = document.getElementById('lead-time-ingredient-id');
    const nameField = document.getElementById('lead-time-ingredient-name');
    const leadTimeField = document.getElementById('ingredient-lead-time');
    const reorderPointField = document.getElementById('ingredient-reorder-point');
    
    if (!modal) return;
    
    idField.value = prediction.id;
    nameField.textContent = `${prediction.name} (${prediction.ingredientId})`;
    leadTimeField.value = prediction.leadTime || 3;
    reorderPointField.value = prediction.reorderPoint || '';
    
    modal.style.display = 'flex';
}

// --- Save Lead Time Settings ---
async function handleSaveLeadTime(e) {
    e.preventDefault();
    
    const id = document.getElementById('lead-time-ingredient-id').value;
    const leadTime = parseInt(document.getElementById('ingredient-lead-time').value) || 3;
    const reorderPoint = parseFloat(document.getElementById('ingredient-reorder-point').value) || null;
    
    try {
        const docRef = doc(db, "ingredients", id);
        await updateDoc(docRef, {
            leadTimeDays: leadTime,
            reorderPoint: reorderPoint
        });
        
        // Close modal
        document.getElementById('edit-lead-time-modal').style.display = 'none';
        
        // Refresh predictions
        await loadRestockPredictions();
        
        alert('Settings saved successfully!');
        
    } catch (error) {
        console.error("Error saving lead time settings:", error);
        alert('Error saving settings. Please try again.');
    }
}

// --- Export to PDF ---
async function exportPredictionsToPDF() {
    const { jsPDF } = window.jspdf;
    const pdfDoc = new jsPDF();
    
    const filterValue = filterSelect?.value || 'all';
    let filteredPredictions = allPredictions;
    
    if (filterValue === 'critical') {
        filteredPredictions = allPredictions.filter(p => p.status === 'critical');
    } else if (filterValue === 'warning') {
        filteredPredictions = allPredictions.filter(p => p.status === 'critical' || p.status === 'warning');
    } else if (filterValue === 'nodata') {
        filteredPredictions = allPredictions.filter(p => p.status === 'nodata');
    }
    
    if (filteredPredictions.length === 0) {
        alert('No data to export.');
        return;
    }
    
    // Get filter description
    const filterLabels = {
        'all': 'All Items',
        'critical': 'Critical Only',
        'warning': 'Warning & Critical',
        'nodata': 'No Usage Data'
    };
    const filterDesc = filterLabels[filterValue] || 'All Items';
    const lookbackDays = lookbackSelect?.value || 30;
    
    // Prepare table data
    const tableData = filteredPredictions.map(p => {
        const statusLabels = {
            critical: 'CRITICAL',
            warning: 'WARNING',
            good: 'GOOD',
            nodata: 'NO DATA'
        };
        
        const daysDisplay = p.status === 'nodata' ? 'Unknown' 
            : p.daysRemaining === Infinity ? '∞' 
            : Math.floor(p.daysRemaining);
        
        const usageDisplay = p.avgDailyUsage > 0 
            ? `${p.avgDailyUsage.toFixed(2)} ${p.baseUnit}/day`
            : 'No data';
        
        const reorderDisplay = p.recommendedReorderDate 
            ? p.recommendedReorderDate.toLocaleDateString()
            : '-';
        
        return [
            statusLabels[p.status],
            p.ingredientId,
            p.name,
            p.category,
            `${p.currentStock.toFixed(2)} ${p.stockUnit}`,
            usageDisplay,
            daysDisplay,
            reorderDisplay,
            `${p.leadTime} days`
        ];
    });
    
    // Add header
    pdfDoc.setFontSize(18);
    pdfDoc.text('Restock Prediction Report', 14, 20);
    pdfDoc.setFontSize(11);
    pdfDoc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
    pdfDoc.setFontSize(10);
    pdfDoc.text(`Filter: ${filterDesc} | Lookback Period: ${lookbackDays} days`, 14, 35);
    
    // Summary counts
    const counts = {
        critical: allPredictions.filter(p => p.status === 'critical').length,
        warning: allPredictions.filter(p => p.status === 'warning').length,
        good: allPredictions.filter(p => p.status === 'good').length,
        nodata: allPredictions.filter(p => p.status === 'nodata').length
    };
    pdfDoc.text(`Summary: ${counts.critical} Critical | ${counts.warning} Warning | ${counts.good} Good | ${counts.nodata} No Data`, 14, 42);
    
    // Add table
    pdfDoc.autoTable({
        startY: 50,
        head: [['Status', 'ID', 'Name', 'Category', 'Stock', 'Avg Usage', 'Days Left', 'Reorder By', 'Lead Time']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [139, 69, 19] },
        styles: { fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 18 },
            1: { cellWidth: 18 },
            2: { cellWidth: 30 },
            3: { cellWidth: 22 },
            4: { cellWidth: 22 },
            5: { cellWidth: 25 },
            6: { cellWidth: 18 },
            7: { cellWidth: 22 },
            8: { cellWidth: 18 }
        },
        didParseCell: function(data) {
            // Color code status column
            if (data.column.index === 0 && data.section === 'body') {
                const status = data.cell.raw;
                if (status === 'CRITICAL') {
                    data.cell.styles.textColor = [220, 38, 38];
                    data.cell.styles.fontStyle = 'bold';
                } else if (status === 'WARNING') {
                    data.cell.styles.textColor = [249, 115, 22];
                    data.cell.styles.fontStyle = 'bold';
                } else if (status === 'GOOD') {
                    data.cell.styles.textColor = [34, 139, 34];
                }
            }
        }
    });
    
    // Generate filename
    let filename = 'Restock_Prediction';
    if (filterValue !== 'all') {
        filename += `_${filterValue}`;
    }
    filename += `_${new Date().toISOString().split('T')[0]}.pdf`;
    
    pdfDoc.save(filename);
}
