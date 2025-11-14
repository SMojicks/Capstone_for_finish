import { db } from "./firebase.js";
import { collection, getDocs, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Use date-fns library (loaded from HTML)
if (typeof dateFns === 'undefined') {
  console.error("dateFns library is not loaded! Analytics will fail.");
}
const { 
    startOfDay, endOfDay, subDays, startOfWeek, endOfWeek, 
    startOfMonth, endOfMonth, parseISO, format, getDay, getHours, getDate 
} = dateFns;

// --- Cache for all sales data ---
let allSalesData = [];

// --- Chart instances (remain global) ---
let salesChart = null;
let topItemsChart = null;
let reservationChart = null;

// --- Element references ---
let salesChartFilterEl;
let salesChartTitleEl;
let salesCanvas;
let generateZReportBtn;

/**
 * Main function called by app.js when analytics tab is clicked
 */
export async function loadAnalytics() {
    console.log("Attempting to load analytics data...");

    // Find elements
    salesChartFilterEl = document.getElementById('sales-chart-filter');
    salesChartTitleEl = document.getElementById('sales-chart-title');
    salesCanvas = document.getElementById('analytics-sales-chart');
    generateZReportBtn = document.getElementById('generate-z-report-btn');
    
    try {
        // 1. Fetch all data
        if (allSalesData.length === 0) {
            await fetchAllSalesData();
        }

        // 2. Load stat cards
        loadStatCards();

        // 3. Load other charts
        loadTopItemsChart();
        loadReservationChart();
        
        // 4. Render the sales chart with default filter
        renderSalesChart('week'); // Default to 'This Week'

        // 5. Add event listener for the chart filter
        if (salesChartFilterEl) {
            salesChartFilterEl.replaceWith(salesChartFilterEl.cloneNode(true));
            salesChartFilterEl = document.getElementById('sales-chart-filter'); 
            salesChartFilterEl.addEventListener('change', (e) => {
                renderSalesChart(e.target.value);
            });
        }
        
        // 6. Add event listener for Z-Report button
        if (generateZReportBtn) {
            generateZReportBtn.replaceWith(generateZReportBtn.cloneNode(true));
            generateZReportBtn = document.getElementById('generate-z-report-btn');
            generateZReportBtn.addEventListener('click', generateZReport);
        }

    } catch (error) {
        console.error("Error loading analytics:", error);
    }
}

/**
 * Fetches all sales data from Firestore and populates the `allSalesData` cache.
 */
async function fetchAllSalesData() {
    const salesRef = collection(db, "sales");
    // Only fetch completed sales
    const q = query(salesRef, where("status", "==", "Completed")); 
    const snapshot = await getDocs(q);
    
    allSalesData = []; // Clear cache
    snapshot.forEach(doc => {
        const data = doc.data(); 
        const total = data.totalAmount || 0; 
        if (data.timestamp && typeof data.timestamp.toDate === 'function') {
            allSalesData.push({
                timestamp: data.timestamp.toDate(),
                total: total
            });
        }
    });
    console.log(`Fetched and cached ${allSalesData.length} sales records.`);
}

/**
 * Calculates and renders the top stat cards.
 */
async function loadStatCards() {
    const today = new Date();
    const todayStart = startOfDay(today);
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    
    let todaySales = 0;
    let thisWeekSales = 0;

    // Process from cache
    allSalesData.forEach(sale => {
        if (sale.timestamp >= todayStart) {
            todaySales += sale.total;
        }
        if (sale.timestamp >= weekStart) {
            thisWeekSales += sale.total;
        }
    });

    // Fetch other data
    const [reservationData, lowStock] = await Promise.all([
        getReservationData(),
        getLowStockCount()
    ]);

    // Render stats
    document.getElementById('analytics-today-sales').textContent = `₱${todaySales.toFixed(2)}`;
    document.getElementById('analytics-week-sales').textContent = `₱${thisWeekSales.toFixed(2)}`;
    document.getElementById('analytics-today-res').textContent = reservationData.today;
    document.getElementById('analytics-low-stock').textContent = lowStock;
}

/**
 * Renders the Sales Chart based on the selected filter.
 * @param {string} filter 'today', 'week', or 'month'
 */
function renderSalesChart(filter) {
    if (!salesCanvas || !salesChartTitleEl) return;

    const today = new Date();
    let labels = [];
    let data = [];
    let title = "Sales Overview";

    if (filter === 'today') {
        title = "Today's Sales (Hourly)";
        labels = Array.from({ length: 24 }, (_, i) => format(new Date(0, 0, 0, i), 'ha'));
        data = Array(24).fill(0);
        
        const todayStart = startOfDay(today);
        allSalesData
            .filter(sale => sale.timestamp >= todayStart)
            .forEach(sale => {
                const hour = getHours(sale.timestamp);
                data[hour] += sale.total;
            });

    } else if (filter === 'week') {
        title = "This Week's Sales";
        labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        data = Array(7).fill(0);
        
        const weekStart = startOfWeek(today, { weekStartsOn: 0 });
        allSalesData
            .filter(sale => sale.timestamp >= weekStart)
            .forEach(sale => {
                const dayIndex = getDay(sale.timestamp);
                data[dayIndex] += sale.total;
            });

    } else if (filter === 'month') {
        title = "This Month's Sales";
        const monthStart = startOfMonth(today);
        const daysInMonth = getDate(endOfMonth(today));
        
        labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
        data = Array(daysInMonth).fill(0);
        
        allSalesData
            .filter(sale => sale.timestamp >= monthStart)
            .forEach(sale => {
                const dayOfMonth = getDate(sale.timestamp) - 1;
                data[dayOfMonth] += sale.total;
            });
    }

    salesChartTitleEl.textContent = title;

    if (salesChart) {
        salesChart.data.labels = labels;
        salesChart.data.datasets[0].data = data;
        salesChart.update();
    } else {
        const salesCtx = salesCanvas.getContext('2d');
        salesChart = new Chart(salesCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Daily Sales',
                    data: data,
                    backgroundColor: 'rgba(28, 125, 74, 0.6)',
                    borderColor: 'rgba(28, 125, 74, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true } }
            }
        });
    }
}


/**
 * Fetches and renders the Top 5 Items chart.
 */
async function loadTopItemsChart() {
    const salesRef = collection(db, "sales");
    const snapshot = await getDocs(salesRef);
    let itemCounts = {};
    
    snapshot.forEach(doc => {
        (doc.data().items || []).forEach(item => {
            const name = item.name || "Unknown";
            const qty = item.quantity || 1;
            itemCounts[name] = (itemCounts[name] || 0) + qty;
        });
    });
    
    const top5 = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const labels = top5.map(item => item[0]);
    const data = top5.map(item => item[1]);

    const itemsCanvas = document.getElementById('analytics-top-items-chart');
    if (itemsCanvas) {
        const itemsCtx = itemsCanvas.getContext('2d');
        if (topItemsChart) topItemsChart.destroy();
        topItemsChart = new Chart(itemsCtx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Quantity Sold',
                    data: data,
                    backgroundColor: [
                        'rgba(101, 85, 4, 0.7)',
                        'rgba(28, 125, 74, 0.7)',
                        'rgba(212, 184, 96, 0.7)',
                        'rgba(75, 75, 75, 0.7)',
                        'rgba(158, 158, 158, 0.7)'
                    ],
                    hoverOffset: 4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    } else {
        console.error("Top items chart canvas not found!");
    }
}

/**
 * Fetches and renders the Reservation Status chart.
 */
async function loadReservationChart() {
    const reservationData = await getReservationData();
    
    const resCanvas = document.getElementById('analytics-reservation-chart');
    if (resCanvas) {
        const resCtx = resCanvas.getContext('2d');
        if (reservationChart) reservationChart.destroy();
        reservationChart = new Chart(resCtx, {
            type: 'pie',
            data: {
                labels: ['Pending', 'Completed', 'Canceled'],
                datasets: [{
                    data: [reservationData.pending, reservationData.completed, reservationData.canceled],
                    backgroundColor: [
                        'rgba(255, 159, 64, 0.7)',
                        'rgba(75, 192, 192, 0.7)',
                        'rgba(255, 99, 132, 0.7)'
                    ],
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, padding: 10 }
                    }
                }
            }
        });
    } else {
        console.error("Reservation chart canvas not found!");
    }
}

// --- Helper Data Fetchers ---

async function getReservationData() {
    const reservationsRef = collection(db, "reservations");
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayQuery = query(reservationsRef, where("date", "==", todayStr));
    const [snapshot, todaySnapshot] = await Promise.all([getDocs(reservationsRef), getDocs(todayQuery)]);
    let pending = 0, completed = 0, canceled = 0;
    
    snapshot.forEach(doc => {
        const status = doc.data().status;
        if (status === 'pending') pending++;
        else if (status === 'completed') completed++;
        else if (status === 'canceled') canceled++;
    });
    return { today: todaySnapshot.size, pending, completed, canceled };
}

async function getLowStockCount() {
    const ingredientsRef = collection(db, "ingredients");
    const snapshot = await getDocs(ingredientsRef);
    let lowStockCount = 0;
    
    snapshot.forEach(doc => {
        const ing = doc.data();
        const currentStockInBase = (ing.stockQuantity || 0) * (ing.conversionFactor || 1);
        const minStock = ing.minStockThreshold || 0;
        
        if (currentStockInBase <= minStock && currentStockInBase > 0) {
            lowStockCount++;
        }
    });
    return lowStockCount;
}

// ===================================================
// --- Z-REPORT GENERATION (FIXED PESO SYMBOL) ---
// ===================================================

async function generateZReport() {
    if (!generateZReportBtn) return;
    generateZReportBtn.disabled = true;
    generateZReportBtn.textContent = "Generating...";

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: [80, 200] // Standard 80mm thermal receipt paper width
        });
        
        const now = new Date();
        const todayStart = startOfDay(now);
        
        // --- 1. Fetch all of TODAY's sales (including voids) ---
        const salesRef = collection(db, "sales");
        const q = query(salesRef, where("timestamp", ">=", todayStart));
        const snapshot = await getDocs(q);

        // --- 2. Process Data ---
        let totalTransactions = 0;
        let grossSales = 0;
        let totalDiscounts = 0;
        let totalVoids = 0;
        let totalCollection = 0;
        let completedOrderIds = [];
        let paymentMethodStats = {
            'Cash': { count: 0, total: 0 },
            'Gcash': { count: 0, total: 0 },
            'Debit/Credit Card': { count: 0, total: 0 }
        };

        snapshot.forEach(doc => {
            const sale = doc.data();
            if (sale.status === "Voided") {
                totalVoids++;
            } else if (sale.status === "Completed") {
                totalTransactions++;
                grossSales += (sale.subtotal || 0);
                totalDiscounts += (sale.discountAmount || 0);
                totalCollection += (sale.totalAmount || 0);
                completedOrderIds.push(sale.orderId || "0000");
                
                const payment = sale.paymentMethod;
                if (paymentMethodStats[payment]) {
                    paymentMethodStats[payment].count++;
                    paymentMethodStats[payment].total += sale.totalAmount;
                }
            }
        });

        // --- 3. Calculations ---
        const netSales = grossSales - totalDiscounts;
        const vatableSales = netSales / 1.12;
        const vatAmount = netSales - vatableSales;
        const serviceCharges = 0.00;
        const nonVatSales = 0.00;

        completedOrderIds.sort();
        const beginningOR = completedOrderIds.length > 0 ? completedOrderIds[0] : "N/A";
        const endingOR = completedOrderIds.length > 0 ? completedOrderIds[completedOrderIds.length - 1] : "N/A";

        // --- 4. Get Static Info ---
        const cashierName = document.querySelector(".employee-name")?.textContent || "Employee";
        const reportDate = format(now, 'MMMM dd, yyyy');
        const reportTime = format(now, 'hh:mm a');

        const BUSINESS_NAME = "ACACCIA BISTRO CAFE";
        const ADDRESS = "Brgy. San Agustin, Alaminos, Laguna";
        const TIN = "123-456-789-00000";
        const BIR_PERMIT_NO = "CAS-2025-001";
        const POS_TERMINAL_ID = "01";
        
        const SYS_NAME = "CafeSync Web POS v1.0";
        const SYS_DEV = "Team CafeSync";
        const SYS_ACC_NO = "CASDEV-2025-045";
        const SYS_PTU_NO = "CAS-2025-001";
        const SYS_APPROVED = "January 10, 2025";
        
        const line = "---------------------------------------";
        let y = 10; // Vertical position in mm
        const margin = 5;
        const center = 40;

        // --- 5. Build PDF Document (Receipt Format) ---
        doc.setFont("courier", "bold");
        doc.setFontSize(10);
        doc.text(BUSINESS_NAME, center, y, { align: 'center' }); y += 4;
        doc.setFont("courier", "normal");
        doc.setFontSize(8);
        doc.text(ADDRESS, center, y, { align: 'center' }); y += 3;
        doc.text(`TIN: ${TIN}`, center, y, { align: 'center' }); y += 3;
        doc.text(`BIR Permit to Use No.: ${BIR_PERMIT_NO}`, center, y, { align: 'center' }); y += 3;
        doc.text(`POS Terminal ID: ${POS_TERMINAL_ID}`, center, y, { align: 'center' }); y += 4;
        
        doc.text(`Report Date: ${reportDate}`, margin, y); y += 4;
        doc.text(`Report Time: ${reportTime}`, margin, y); y += 4;
        doc.text(`Cashier: ${cashierName}`, margin, y); y += 4;
        
        doc.text(line, center, y, { align: 'center' }); y += 5;
        doc.setFont("courier", "bold");
        doc.text("Z-REPORT (End-of-Day Sales Summary)", center, y, { align: 'center' }); y += 5;
        doc.setFont("courier", "normal");

        // --- === FIXED FORMATTING WITH PHP INSTEAD OF ₱ === ---
        const lCol = margin;
        const rColNum = 75; // Right-edge for the numbers
        const rColPrefix = 57; // X-position for the 'PHP' prefix
        
        // Helper function to format numbers
        const formatCurrency = (num) => num.toFixed(2);
        
        doc.text(`Total No. of Transactions:`, lCol, y); doc.text(`${totalTransactions}`, rColNum, y, { align: 'right' }); y += 4;
        
        doc.text(`Gross Sales:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(grossSales), rColNum, y, { align: 'right' }); y += 4;
        doc.text(`Discounts:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(totalDiscounts), rColNum, y, { align: 'right' }); y += 4;
        doc.text(`Net Sales:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(netSales), rColNum, y, { align: 'right' }); y += 4;
        doc.text(`Service Charges:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(serviceCharges), rColNum, y, { align: 'right' }); y += 4;
        doc.text(`VATable Sales:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(vatableSales), rColNum, y, { align: 'right' }); y += 4;
        doc.text(`VAT Amount (12%):`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(vatAmount), rColNum, y, { align: 'right' }); y += 4;
        doc.text(`Non-VAT Sales:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(nonVatSales), rColNum, y, { align: 'right' }); y += 4;
        
        doc.text(line, center, y, { align: 'center' }); y += 4;
        doc.text(`Beginning OR No.:`, lCol, y); doc.text(`${beginningOR}`, rColNum, y, { align: 'right' }); y += 4;
        doc.text(`Ending OR No.:`, lCol, y); doc.text(`${endingOR}`, rColNum, y, { align: 'right' }); y += 4;
        doc.text(`Voided Transactions:`, lCol, y); doc.text(`${totalVoids}`, rColNum, y, { align: 'right' }); y += 4;
        
        doc.text(line, center, y, { align: 'center' }); y += 4;
        doc.setFont("courier", "bold");
        doc.text(`Total Collection:`, lCol, y); doc.text('PHP', rColPrefix, y); doc.text(formatCurrency(totalCollection), rColNum, y, { align: 'right' }); y += 5;
        doc.setFont("courier", "normal");
        // --- === END OF FIXED FORMATTING === ---
        
        doc.text(line, center, y, { align: 'center' }); y += 5;
        doc.setFont("courier", "bold");
        doc.text("SALES BY PAYMENT METHOD", center, y, { align: 'center' }); y += 5;
        
        // --- Payment Method Table (FIXED) ---
        const tableBody = [];
        for (const [method, data] of Object.entries(paymentMethodStats)) {
            tableBody.push([
                method,
                data.count.toString(),
                formatCurrency(data.total)
            ]);
        }
        
        doc.autoTable({
            head: [['Payment Method', 'Trans', 'Total (PHP)']], // Changed from ₱ to PHP
            body: tableBody,
            startY: y,
            theme: 'plain',
            margin: { left: margin, right: margin },
            headStyles: { font: 'courier', fontSize: 8, halign: 'center', lineWidth: 0.1, lineColor: 0 },
            bodyStyles: { font: 'courier', fontSize: 8, lineWidth: 0.1, lineColor: 0 },
            columnStyles: {
                0: { halign: 'left' },
                1: { halign: 'center' },
                2: { halign: 'right' },
            }
        });
        y = doc.lastAutoTable.finalY + 5;

        doc.text(line, center, y, { align: 'center' }); y += 5;
        doc.setFont("courier", "bold");
        doc.text("SYSTEM INFORMATION", center, y, { align: 'center' }); y += 5;
        doc.setFont("courier", "normal");
        
        doc.text(SYS_NAME, center, y, { align: 'center' }); y += 3;
        doc.text(`Developer: ${SYS_DEV}`, center, y, { align: 'center' }); y += 3;
        doc.text(`BIR Accreditation No.: ${SYS_ACC_NO}`, center, y, { align: 'center' }); y += 3;
        doc.text(`Permit to Use (PTU) No.: ${SYS_PTU_NO}`, center, y, { align: 'center' }); y += 3;
        doc.text(`Date Approved: ${SYS_APPROVED}`, center, y, { align: 'center' }); y += 4;

        doc.text(line, center, y, { align: 'center' }); y += 4;
        doc.setFontSize(7);
        doc.text("This Z-report is system-generated.", center, y, { align: 'center' }); y += 3;
        doc.text("All sales data are securely stored.", center, y, { align: 'center' }); y += 4;
        doc.setFont("courier", "bold");
        doc.text("End of Report", center, y, { align: 'center' });

        // --- 6. Save PDF ---
        doc.save(`Z-Report_${format(now, 'yyyyMMdd')}.pdf`);

    } catch (error) {
        console.error("Error generating Z-Report:", error);
        alert("Failed to generate Z-Report. See console for details.");
    } finally {
        if (generateZReportBtn) {
            generateZReportBtn.disabled = false;
            generateZReportBtn.textContent = "Generate Z-Report";
        }
    }
}