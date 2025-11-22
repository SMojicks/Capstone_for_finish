// scripts/inventory.js
import { db } from './firebase.js';
import {
  collection, addDoc, updateDoc, deleteDoc, doc, getDoc,
  serverTimestamp, query, orderBy, onSnapshot, getDocs
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { createLog } from './inventory-log.js';

// --- Elements ---
const inventoryTableBody = document.getElementById('inventory-table');
const modal = document.getElementById('product-modal');
const addBtn = document.getElementById('add-product-btn');
const cancelBtn = document.getElementById('cancel-btn');
const form = document.getElementById('product-form');
const modalTitle = document.getElementById('modal-title');

// Form Fields
const idField = document.getElementById('product-id');
const nameField = document.getElementById('product-name');
const stockField = document.getElementById('product-stock');
const stockUnitField = document.getElementById('product-stock-unit');
const baseUnitField = document.getElementById('product-base-unit');
const conversionField = document.getElementById('product-conversion');
const minStockField = document.getElementById('product-min-stock');
const expiryField = document.getElementById('product-expiry');

const inventoryAlertDot = document.getElementById('inventory-alert-dot');
const productsRef = collection(db, "ingredients");

// --- NEW: Filter Elements ---
const inventorySearchName = document.getElementById('inventory-search-name');
const inventoryFilterCategory = document.getElementById('inventory-filter-category');
const inventoryFilterStatus = document.getElementById('inventory-filter-status');
const inventoryFilterExpiry = document.getElementById('inventory-filter-expiry');
const inventoryResetFilters = document.getElementById('inventory-reset-filters');

// --- NEW: Local Cache for all ingredients ---
let allIngredients = [];

/**
 * Generates the next sequential ID (e.g., ING-001, ING-002)
 */
async function getNextIngredientId() {
    const prefix = "ING-";
    let maxId = 0;
    try {
        // Use the cached list if available, otherwise fetch
        const listToScan = allIngredients.length > 0 ? allIngredients : (await getDocs(productsRef)).docs.map(d => d.data());
        
        listToScan.forEach(data => {
            if (data.ingredientId && data.ingredientId.startsWith(prefix)) {
                const numPart = data.ingredientId.substring(prefix.length);
                const num = parseInt(numPart, 10);
                if (!isNaN(num) && num > maxId) {
                    maxId = num;
                }
            }
        });
    } catch (error) {
        console.error("Error fetching max ingredient ID:", error);
        return `${prefix}${Math.floor(Math.random() * 1000)}`;
    }
    const nextIdNum = maxId + 1;
    return `${prefix}${String(nextIdNum).padStart(3, '0')}`;
}

// --- Modal Logic ---
function openModal(editMode = false, product = {}) {
  form.reset();
  modal.style.display = "flex";
  modalTitle.textContent = editMode ? "Edit Ingredient" : "Add Ingredient";
  
  idField.value = product.id || '';
  nameField.value = product.name || '';
  
  setTimeout(() => {
      const categoryDropdown = document.getElementById("product-category-dropdown");
      if (categoryDropdown) {
          categoryDropdown.value = product.category || '';
      }
  }, 100);
  
stockField.value = product.stockQuantity || '';
stockUnitField.value = product.stockUnit || '';

// Handle base unit - check if value exists in dropdown, if not add it temporarily
if (product.baseUnit) {
    const optionExists = Array.from(baseUnitField.options).some(opt => opt.value === product.baseUnit);
    if (!optionExists) {
        // Add custom unit as an option
        const customOption = document.createElement('option');
        customOption.value = product.baseUnit;
        customOption.textContent = `${product.baseUnit} (custom)`;
        baseUnitField.appendChild(customOption);
    }
    baseUnitField.value = product.baseUnit;
} else {
    baseUnitField.value = '';
}

conversionField.value = product.conversionFactor || '';
  minStockField.value = product.minStockThreshold || '';
  expiryField.value = product.expiryDate || '';
}

function closeModal() {
  modal.style.display = "none";
  form.reset();
  idField.value = '';
}

// --- NEW: Helper function to get status object ---
function getIngredientStatus(ing) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Set to start of today for expiry comparison

    let status = "in_stock"; // Default value
    let statusDisplay = "In Stock";
    let statusClass = "status-approved"; // Green
    let isExpired = false;

    // 1. Check expiry date
    if (ing.expiryDate) {
        try {
            const expiry = new Date(ing.expiryDate + 'T00:00:00');
            if (!isNaN(expiry) && expiry < today) {
                status = "expired";
                statusDisplay = "Expired";
                statusClass = "status-blocked"; // Red
                isExpired = true;
            }
        } catch (e) { /* ignore invalid date */ }
    }

    // 2. Check stock status (only if not expired)
    if (!isExpired) {
        const currentStockInBase = (ing.stockQuantity || 0) * (ing.conversionFactor || 1);
        const minStock = ing.minStockThreshold || 0;

        if (currentStockInBase <= 0) {
            status = "out_of_stock";
            statusDisplay = "Out of Stock";
            statusClass = "status-blocked"; // Red
        } else if (currentStockInBase <= minStock) {
            status = "low_stock";
            statusDisplay = "Low Stock";
            statusClass = "status-pending"; // Yellow
        }
    }
    
    return { status, statusDisplay, statusClass, isExpired };
}
// In scripts/inventory.js

// Add this new function after the getIngredientStatus function
/**
 * Calculates estimated servings remaining for an ingredient
 * @param {object} ingredient - The ingredient object
 * @param {Array} recipes - All recipes from the system
 * @param {Array} products - All products from the system
 * @returns {object} - { minServings, maxServings, usageDetails }
 */
function calculateEstimatedServings(ingredient, allRecipesData, allProductsData) {
    const currentStockInBase = (ingredient.stockQuantity || 0) * (ingredient.conversionFactor || 1);
    
    if (currentStockInBase <= 0) {
        return { minServings: 0, maxServings: 0, usageDetails: [] };
    }
    
    const usageDetails = [];
    let minUsage = Infinity; // Smallest amount used per serving (gives max servings)
    let maxUsage = 0; // Largest amount used per serving (gives min servings)
    
    // Check standalone recipes (non-variation products)
    allRecipesData.forEach(recipe => {
        if (recipe.ingredientId === ingredient.id) {
            const product = allProductsData.find(p => p.id === recipe.productId);
            const productName = product ? product.name : 'Unknown Product';
            const qtyPerServing = parseFloat(recipe.qtyPerProduct) || 0;
            
            if (qtyPerServing > 0) {
                usageDetails.push({
                    productName,
                    variationName: null,
                    qtyPerServing,
                    unit: recipe.unitUsed,
                    servingsFromStock: Math.floor(currentStockInBase / qtyPerServing)
                });
                
                if (qtyPerServing < minUsage) minUsage = qtyPerServing;
                if (qtyPerServing > maxUsage) maxUsage = qtyPerServing;
            }
        }
    });
    
    // Check variation products
    allProductsData.forEach(product => {
        if (product.variations && product.variations.length > 0) {
            product.variations.forEach(variation => {
                if (variation.recipe && variation.recipe.length > 0) {
                    variation.recipe.forEach(recipeItem => {
                        if (recipeItem.ingredientId === ingredient.id) {
                            const qtyPerServing = parseFloat(recipeItem.qtyPerProduct) || 0;
                            
                            if (qtyPerServing > 0) {
                                usageDetails.push({
                                    productName: product.name,
                                    variationName: variation.name,
                                    qtyPerServing,
                                    unit: recipeItem.unitUsed,
                                    servingsFromStock: Math.floor(currentStockInBase / qtyPerServing)
                                });
                                
                                if (qtyPerServing < minUsage) minUsage = qtyPerServing;
                                if (qtyPerServing > maxUsage) maxUsage = qtyPerServing;
                            }
                        }
                    });
                }
            });
        }
    });
    
    // Calculate min and max servings
    const minServings = maxUsage > 0 ? Math.floor(currentStockInBase / maxUsage) : 0;
    const maxServings = minUsage < Infinity ? Math.floor(currentStockInBase / minUsage) : 0;
    
    return {
        minServings,
        maxServings,
        usageDetails,
        hasUsage: usageDetails.length > 0
    };
}

// Function to format servings display
function formatServingsDisplay(servingsData) {
    if (!servingsData.hasUsage) {
        return `<span style="color: #999; font-style: italic;">No recipes</span>`;
    }
    
    if (servingsData.minServings === 0 && servingsData.maxServings === 0) {
        return `<span style="color: var(--color-red-600); font-weight: 600;">0 servings</span>`;
    }
    
    if (servingsData.minServings === servingsData.maxServings) {
        const color = servingsData.minServings <= 10 ? 'var(--color-red-600)' : 
                      servingsData.minServings <= 50 ? 'var(--color-yellow-600)' : 'var(--color-green-600)';
        return `<span style="color: ${color}; font-weight: 600;">${servingsData.minServings} servings</span>`;
    }
    
    const avgServings = Math.floor((servingsData.minServings + servingsData.maxServings) / 2);
    const color = avgServings <= 10 ? 'var(--color-red-600)' : 
                  avgServings <= 50 ? 'var(--color-yellow-600)' : 'var(--color-green-600)';
    
    return `<span style="color: ${color}; font-weight: 600;">${servingsData.minServings} - ${servingsData.maxServings}</span>`;
}

// Function to create tooltip content for servings
function createServingsTooltip(servingsData, ingredientName) {
    if (!servingsData.hasUsage || servingsData.usageDetails.length === 0) {
        return `No products use ${ingredientName}`;
    }
    
    let tooltip = `Estimated servings for ${ingredientName}:\n\n`;
    
    servingsData.usageDetails.forEach(detail => {
        const name = detail.variationName 
            ? `${detail.productName} (${detail.variationName})`
            : detail.productName;
        tooltip += `• ${name}: ${detail.servingsFromStock} servings\n`;
        tooltip += `  (uses ${detail.qtyPerServing} ${detail.unit}/serving)\n`;
    });
    
    return tooltip;
}

// --- NEW: Populate Category Filter Dropdown ---
function populateCategoryFilter() {
    if (!inventoryFilterCategory) return;
    
    const currentVal = inventoryFilterCategory.value; // Save current selection
    
    // Get unique categories from the cached list
    const categories = [...new Set(allIngredients.map(ing => ing.category).filter(Boolean))];
    categories.sort();
    
    inventoryFilterCategory.innerHTML = `<option value="">All Categories</option>`; // Reset
    
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        inventoryFilterCategory.appendChild(option);
    });
    
    inventoryFilterCategory.value = currentVal; // Restore selection
}


// --- NEW: Main Filter and Render Function ---
function filterAndRenderInventory() {
    const searchName = inventorySearchName.value.toLowerCase();
    const searchCategory = inventoryFilterCategory.value;
    const searchStatus = inventoryFilterStatus.value;
    const searchExpiry = inventoryFilterExpiry.value;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);

    let filteredList = allIngredients.filter(ing => {
        // 1. Filter by Name
        if (searchName && !ing.name.toLowerCase().includes(searchName)) {
            return false;
        }

        // 2. Filter by Category
        if (searchCategory && ing.category !== searchCategory) {
            return false;
        }

        // Get status for filters
        const { status } = getIngredientStatus(ing);

        // 3. Filter by Status
        if (searchStatus && status !== searchStatus) {
            return false;
        }
        
        // 4. Filter by Expiry
        if (searchExpiry) {
            if (!ing.expiryDate) return false; // Hide items with no expiry date
            
            try {
                const expiry = new Date(ing.expiryDate + 'T00:00:00');
                if (isNaN(expiry)) return false; // Hide invalid dates

                if (searchExpiry === 'expired' && expiry >= today) {
                    return false; // Not expired
                }
                
                if (searchExpiry === 'expiring_soon' && (expiry < today || expiry > sevenDaysFromNow)) {
                    return false; // Not in the "expiring soon" window
                }
            } catch (e) {
                return false; // Hide on error
            }
        }
        
        return true; // Item passes all filters
    });

    renderInventoryTable(filteredList);
}

// --- Add these variables at the top of the file, after the existing variable declarations ---
let allRecipesCache = [];
let allProductsCache = [];

// --- Add these listener functions after loadInventory function ---
function listenForRecipes() {
    const recipesRef = collection(db, "recipes");
    onSnapshot(recipesRef, (snapshot) => {
        allRecipesCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        filterAndRenderInventory(); // Re-render when recipes change
    });
}

function listenForProducts() {
    const productsRefCollection = collection(db, "products");
    const q = query(productsRefCollection, orderBy("name"));
    onSnapshot(q, (snapshot) => {
        allProductsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        filterAndRenderInventory(); // Re-render when products change
    });
}

// --- Replace the entire renderInventoryTable function ---
function renderInventoryTable(ingredientsToRender) {
  inventoryTableBody.innerHTML = '';
  let hasLowStock = false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (ingredientsToRender.length === 0) {
    inventoryTableBody.innerHTML = `<tr><td colspan="11" style="text-align:center;">No ingredients match your filters.</td></tr>`;
    updateInventoryNotification(false);
    return;
  }
  
  ingredientsToRender.forEach(ing => {
    const id = ing.id;
    
    // Get status from helper function
    const { statusDisplay, statusClass, isExpired } = getIngredientStatus(ing);
    
    if (statusDisplay === "Low Stock" || statusDisplay === "Out of Stock" || isExpired) {
        hasLowStock = true;
    }

    // Calculate estimated servings
    const servingsData = calculateEstimatedServings(ing, allRecipesCache, allProductsCache);
    const servingsDisplay = formatServingsDisplay(servingsData);
    const servingsTooltip = createServingsTooltip(servingsData, ing.name);

    // Format Expiry Date
    let expiryStr = "N/A";
    if (ing.expiryDate) {
        expiryStr = new Date(ing.expiryDate + 'T00:00:00').toLocaleDateString();
        if (isExpired) {
             expiryStr = `<span style="color:var(--color-red-600);font-weight:600;">${expiryStr}</span>`;
        }
    }

    // Format Last Updated Date
    let lastUpdatedStr = "N/A";
    if (ing.lastUpdated && ing.lastUpdated.toDate) {
        lastUpdatedStr = ing.lastUpdated.toDate().toLocaleDateString();
    }
    
    const displayStock = formatStockDisplay(ing.stockQuantity, ing.stockUnit, ing.baseUnit, ing.conversionFactor);

    const row = document.createElement('tr');
    if (statusClass === 'status-pending' || statusClass === 'status-blocked') {
         row.style.backgroundColor = (statusClass === 'status-pending') ? 'var(--color-brown-50)' : '#fee2e2';
    }

    row.innerHTML = `
      <td>${ing.ingredientId || id}</td>
      <td>${ing.name || '-'}</td>
      <td>${ing.category || '-'}</td>
      <td><span class="status ${statusClass}">${statusDisplay}</span></td>
      <td style="${(statusClass === 'status-blocked' || statusClass === 'status-pending') ? 'color:var(--color-red-600);font-weight:600;' : ''}">
        ${displayStock}
      </td>
      <td class="servings-cell" title="${servingsTooltip.replace(/"/g, '&quot;')}" style="cursor: help;">
        ${servingsDisplay}
        ${servingsData.hasUsage ? `<button class="btn-icon servings-info-btn" title="View details" style="margin-left: 4px; font-size: 12px;">ℹ️</button>` : ''}
      </td>
      <td>${(ing.minStockThreshold || 0)} ${ing.baseUnit}</td>
      <td>${expiryStr}</td>
      <td>${lastUpdatedStr}</td>
      <td>1 ${ing.stockUnit} = ${ing.conversionFactor} ${ing.baseUnit}</td>
      <td class="actions-cell">
        <button class="btn-icon btn--icon-edit edit-btn" title="Edit Ingredient">✎</button>
        <button class="btn-icon btn--icon-delete delete-btn" title="Delete Ingredient">🗑</button>
      </td>
      `;

    // Add servings info button click handler
    const servingsInfoBtn = row.querySelector('.servings-info-btn');
    if (servingsInfoBtn) {
        servingsInfoBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showServingsModal(ing, servingsData);
        });
    }

    row.querySelector('.edit-btn').addEventListener('click', () => {
      openModal(true, { id, ...ing });
    });

    row.querySelector('.delete-btn').addEventListener('click', async () => {
       if (confirm(`Delete "${ing.name}"? This is permanent.`)) {
        await deleteDoc(doc(db, "ingredients", id));
      }
    });

    inventoryTableBody.appendChild(row);
  });
  
  updateInventoryNotification(hasLowStock);
}

// --- Add this function for the servings detail modal ---
function showServingsModal(ingredient, servingsData) {
    // Remove existing modal if any
    const existingModal = document.getElementById('servings-detail-modal');
    if (existingModal) existingModal.remove();
    
    const currentStock = (ingredient.stockQuantity || 0) * (ingredient.conversionFactor || 1);
    
    let tableRows = '';
    if (servingsData.usageDetails.length > 0) {
        servingsData.usageDetails
            .sort((a, b) => a.servingsFromStock - b.servingsFromStock) // Sort by lowest servings first
            .forEach(detail => {
                const name = detail.variationName 
                    ? `${detail.productName} <span style="color: #666; font-size: 12px;">(${detail.variationName})</span>`
                    : detail.productName;
                
                const servingColor = detail.servingsFromStock <= 10 ? 'var(--color-red-600)' : 
                                    detail.servingsFromStock <= 50 ? 'var(--color-yellow-600)' : 'var(--color-green-600)';
                
                tableRows += `
                    <tr>
                        <td>${name}</td>
                        <td style="text-align: center;">${detail.qtyPerServing} ${detail.unit}</td>
                        <td style="text-align: center; color: ${servingColor}; font-weight: 600;">${detail.servingsFromStock}</td>
                    </tr>
                `;
            });
    } else {
        tableRows = `<tr><td colspan="3" style="text-align: center; color: #999; padding: 20px;">No products use this ingredient</td></tr>`;
    }
    
    const modalHTML = `
        <div id="servings-detail-modal" class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 600px;">
                <h2 style="display: flex; align-items: center; gap: 8px;">
                    <span>📊</span>
                    Estimated Servings: ${ingredient.name}
                </h2>
                
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div>
                            <strong style="color: #666; font-size: 12px;">CURRENT STOCK</strong>
                            <p style="font-size: 24px; font-weight: 700; margin: 4px 0; color: var(--color-primary);">
                                ${currentStock.toFixed(2)} ${ingredient.baseUnit}
                            </p>
                            <span style="color: #666; font-size: 12px;">(${ingredient.stockQuantity} ${ingredient.stockUnit})</span>
                        </div>
                        <div>
                            <strong style="color: #666; font-size: 12px;">SERVINGS RANGE</strong>
                            <p style="font-size: 24px; font-weight: 700; margin: 4px 0; color: ${servingsData.minServings <= 10 ? 'var(--color-red-600)' : 'var(--color-green-600)'};">
                                ${servingsData.minServings === servingsData.maxServings 
                                    ? servingsData.minServings 
                                    : `${servingsData.minServings} - ${servingsData.maxServings}`}
                            </p>
                            <span style="color: #666; font-size: 12px;">orders possible</span>
                        </div>
                    </div>
                </div>
                
                <div style="max-height: 300px; overflow-y: auto;">
                    <table class="data-table" style="width: 100%;">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th style="text-align: center;">Usage/Serving</th>
                                <th style="text-align: center;">Est. Servings</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                </div>
                
                <div class="modal-buttons" style="margin-top: 20px; justify-content: flex-end;">
                    <button type="button" id="close-servings-modal" class="btn btn--secondary">Close</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modal = document.getElementById('servings-detail-modal');
    const closeBtn = document.getElementById('close-servings-modal');
    
    closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// --- Stock Display Helper ---
function formatStockDisplay(stockQty, stockUnit, baseUnit, conversion) {
  const qty = stockQty || 0;
  if (stockUnit === baseUnit || !conversion) {
    return `${qty.toFixed(2)} ${baseUnit || stockUnit || 'units'}`;
  }
  return `${qty.toFixed(2)} ${stockUnit || 'units'}`;
}

// --- Update Sidebar Notification ---
function updateInventoryNotification(hasLowStock) {
  if (inventoryAlertDot) {
    inventoryAlertDot.style.display = hasLowStock ? 'inline-block' : 'none';
  }
}

// --- Replace the loadInventory function ---
function loadInventory() {
  const q = query(productsRef, orderBy("name"));
  onSnapshot(q, (snapshot) => {
    
    // 1. Update the cache
    allIngredients = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
    }));
    populateAddItemsCategory();
    
    // 2. (Re)populate the category filter dropdown
    populateCategoryFilter();

    // 3. Apply filters and render
    filterAndRenderInventory();

    // 4. Refresh restock items tab
    loadRestockItems();

  }, (error) => {
    console.error("❌ Error loading inventory:", error);
    inventoryTableBody.innerHTML = `<tr><td colspan="11">Error loading inventory.</td></tr>`;
  });
  
  // Also listen for recipes and products to calculate servings
  listenForRecipes();
  listenForProducts();
}

// --- Add or Update Ingredient ---
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = idField.value;
  const name = nameField.value.trim();
  
  // Check for duplicates
  const duplicateCheck = await isDuplicateIngredient(name, id);
  
  if (duplicateCheck.isDuplicate) {
      // Show warning and wait for confirmation
      showDuplicateWarning(duplicateCheck, name, async (confirmed) => {
          if (confirmed) {
              // User confirmed, proceed with saving
              await saveIngredient(id, name);
          } else {
              // User cancelled, focus back on name field
              nameField.focus();
              nameField.select();
          }
      });
      return; // Stop here and wait for user decision
  }
  
  // No duplicates, proceed normally
  await saveIngredient(id, name);
});
// Extract save logic into separate function
async function saveIngredient(id, name) {
    const newData = {
        name: name,
        category: document.getElementById("product-category-dropdown").value, 
        stockQuantity: parseFloat(stockField.value),
        stockUnit: stockUnitField.value.trim(),
        baseUnit: baseUnitField.value.trim(),
        conversionFactor: parseFloat(conversionField.value),
        minStockThreshold: parseInt(minStockField.value) || 0,
        expiryDate: expiryField.value || null,
        lastUpdated: serverTimestamp(),
    };

    // Validation
    if (newData.conversionFactor <= 0) {
        alert("Conversion factor must be greater than 0.");
        return;
    }
    
    if (newData.stockUnit === newData.baseUnit && newData.conversionFactor !== 1) {
        alert("If Stock Unit and Base Unit are the same, conversion factor must be 1.");
        return;
    }
    
    if (newData.expiryDate === "") {
        newData.expiryDate = null;
    }

    let prevQty = 0;
    const employeeName = document.querySelector(".employee-name")?.textContent || "Employee";
    const reason = id ? "Updated stock details" : "Added new stock";
    let actionType = "Add Stock";

    try {
        if (id) {
            actionType = "Update Stock";
            const docRef = doc(db, "ingredients", id);
            const oldDoc = await getDoc(docRef);
            if (oldDoc.exists()) {
                prevQty = oldDoc.data().stockQuantity || 0;
            }
            await updateDoc(docRef, newData);
        } else {
            newData.ingredientId = await getNextIngredientId();
            await addDoc(productsRef, newData);
        }

        const qtyChange = newData.stockQuantity - prevQty;
        createLog(
            employeeName,
            actionType,
            newData.name,
            newData.category,
            qtyChange,
            newData.stockUnit,
            prevQty,
            newData.stockQuantity,
            reason
        );

        closeModal();
        
        // Show success message
        const action = id ? 'updated' : 'added';
        const successDiv = document.createElement('div');
        successDiv.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; font-weight: 600;';
        successDiv.textContent = `✓ Ingredient "${newData.name}" ${action} successfully!`;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
        
    } catch (error) {
        console.error("❌ Error saving ingredient:", error);
        alert("Failed to save ingredient.");
    }
}
// --- Export Functions ---
async function exportInventoryToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Use filtered data instead of allIngredients
    const filteredData = getFilteredInventoryData();
    
    if (filteredData.length === 0) {
        alert('No data to export. Please adjust your filters.');
        return;
    }
    
    const tableData = filteredData.map(ing => {
        const { statusDisplay } = getIngredientStatus(ing);
        const displayStock = formatStockDisplay(ing.stockQuantity, ing.stockUnit, ing.baseUnit, ing.conversionFactor);
        
        return [
            ing.ingredientId || ing.id,
            ing.name || '-',
            ing.category || '-',
            statusDisplay,
            displayStock,
            `${ing.minStockThreshold || 0} ${ing.baseUnit}`,
            ing.expiryDate ? new Date(ing.expiryDate + 'T00:00:00').toLocaleDateString() : 'N/A',
            `1 ${ing.stockUnit} = ${ing.conversionFactor} ${ing.baseUnit}`
        ];
    });

    doc.setFontSize(18);
    doc.text('Inventory Report', 14, 20);
    doc.setFontSize(11);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);
    doc.setFontSize(10);
    doc.text(getFilterDescription(), 14, 35);
    doc.text(`Total Items: ${filteredData.length}`, 14, 42);

    doc.autoTable({
        startY: 48,
        head: [['ID', 'Name', 'Category', 'Status', 'Stock', 'Min Stock', 'Expiry', 'Conversion']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [139, 69, 19] },
        styles: { fontSize: 9 }
    });

    // Generate filename with filter info
    let filename = 'Inventory_Report';
    if (inventoryFilterStatus.value) {
        filename += `_${inventoryFilterStatus.value}`;
    }
    filename += `_${new Date().toISOString().split('T')[0]}.pdf`;
    
    doc.save(filename);
}

function exportInventoryToExcel() {
    // Use filtered data instead of allIngredients
    const filteredData = getFilteredInventoryData();
    
    if (filteredData.length === 0) {
        alert('No data to export. Please adjust your filters.');
        return;
    }
    
    const tableData = filteredData.map(ing => {
        const { statusDisplay } = getIngredientStatus(ing);
        const displayStock = formatStockDisplay(ing.stockQuantity, ing.stockUnit, ing.baseUnit, ing.conversionFactor);
        
        return {
            'Item ID': ing.ingredientId || ing.id,
            'Name': ing.name || '-',
            'Category': ing.category || '-',
            'Status': statusDisplay,
            'Stock': displayStock,
            'Min Stock': `${ing.minStockThreshold || 0} ${ing.baseUnit}`,
            'Expiry Date': ing.expiryDate ? new Date(ing.expiryDate + 'T00:00:00').toLocaleDateString() : 'N/A',
            'Last Updated': ing.lastUpdated && ing.lastUpdated.toDate ? ing.lastUpdated.toDate().toLocaleDateString() : 'N/A',
            'Conversion': `1 ${ing.stockUnit} = ${ing.conversionFactor} ${ing.baseUnit}`
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(tableData);
    
    // Add filter info as header rows
    XLSX.utils.sheet_add_aoa(worksheet, [
        ['Inventory Report'],
        [`Generated: ${new Date().toLocaleString()}`],
        [getFilterDescription()],
        [`Total Items: ${filteredData.length}`],
        [] // Empty row before data
    ], { origin: 'A1' });
    
    // Shift the data down to accommodate headers
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    range.e.r += 5; // Add 5 rows for headers
    worksheet['!ref'] = XLSX.utils.encode_range(range);
    
    // Re-create worksheet with headers
    const wsWithHeaders = XLSX.utils.aoa_to_sheet([
        ['Inventory Report'],
        [`Generated: ${new Date().toLocaleString()}`],
        [getFilterDescription()],
        [`Total Items: ${filteredData.length}`],
        [], // Empty row
        ['Item ID', 'Name', 'Category', 'Status', 'Stock', 'Min Stock', 'Expiry Date', 'Last Updated', 'Conversion']
    ]);
    
    // Add data rows
    XLSX.utils.sheet_add_json(wsWithHeaders, tableData, { origin: 'A7', skipHeader: true });
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, wsWithHeaders, 'Inventory');
    
    // Generate filename with filter info
    let filename = 'Inventory_Report';
    if (inventoryFilterStatus.value) {
        filename += `_${inventoryFilterStatus.value}`;
    }
    filename += `_${new Date().toISOString().split('T')[0]}.xlsx`;
    
    XLSX.writeFile(workbook, filename);
}

// Add event listeners for export buttons
const exportPdfBtn = document.getElementById('export-inventory-pdf-btn');
const exportExcelBtn = document.getElementById('export-inventory-excel-btn');

if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', exportInventoryToPDF);
}

if (exportExcelBtn) {
    exportExcelBtn.addEventListener('click', exportInventoryToExcel);
}

// NEW: Helper to get currently filtered data
function getFilteredInventoryData() {
    const searchName = inventorySearchName.value.toLowerCase();
    const searchCategory = inventoryFilterCategory.value;
    const searchStatus = inventoryFilterStatus.value;
    const searchExpiry = inventoryFilterExpiry.value;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);

    return allIngredients.filter(ing => {
        // 1. Filter by Name
        if (searchName && !ing.name.toLowerCase().includes(searchName)) {
            return false;
        }

        // 2. Filter by Category
        if (searchCategory && ing.category !== searchCategory) {
            return false;
        }

        // Get status for filters
        const { status } = getIngredientStatus(ing);

        // 3. Filter by Status
        if (searchStatus && status !== searchStatus) {
            return false;
        }
        
        // 4. Filter by Expiry
        if (searchExpiry) {
            if (!ing.expiryDate) return false;
            
            try {
                const expiry = new Date(ing.expiryDate + 'T00:00:00');
                if (isNaN(expiry)) return false;

                if (searchExpiry === 'expired' && expiry >= today) {
                    return false;
                }
                
                if (searchExpiry === 'expiring_soon' && (expiry < today || expiry > sevenDaysFromNow)) {
                    return false;
                }
            } catch (e) {
                return false;
            }
        }
        
        return true;
    });
}
// Helper to generate filter description for export
function getFilterDescription() {
    const filters = [];
    
    if (inventorySearchName.value) {
        filters.push(`Name: "${inventorySearchName.value}"`);
    }
    if (inventoryFilterCategory.value) {
        filters.push(`Category: ${inventoryFilterCategory.value}`);
    }
    if (inventoryFilterStatus.value) {
        const statusLabels = {
            'in_stock': 'In Stock',
            'low_stock': 'Low Stock',
            'out_of_stock': 'Out of Stock',
            'expired': 'Expired'
        };
        filters.push(`Status: ${statusLabels[inventoryFilterStatus.value] || inventoryFilterStatus.value}`);
    }
    if (inventoryFilterExpiry.value) {
        const expiryLabels = {
            'expired': 'Expired Items',
            'expiring_soon': 'Expiring in 7 Days'
        };
        filters.push(`Expiry: ${expiryLabels[inventoryFilterExpiry.value] || inventoryFilterExpiry.value}`);
    }
    
    return filters.length > 0 ? `Filters: ${filters.join(' | ')}` : 'All Items (No Filters Applied)';
}
const addItemsForm = document.getElementById('add-items-form');
const addItemCategory = document.getElementById('add-item-category');

// Populate category dropdown for add items form
export function populateAddItemsCategory() {
    if (!addItemCategory) return;
    
    const invCategoriesRef = doc(db, "settings", "inventoryCategories");
    getDoc(invCategoriesRef).then(docSnap => {
        if (docSnap.exists()) {
            const categories = docSnap.data().list || [];
            addItemCategory.innerHTML = '<option value="">Select category...</option>';
            categories.forEach(cat => {
                addItemCategory.add(new Option(cat, cat));
            });
        }
    });
}

// Enhanced duplicate detection with similarity checking
async function isDuplicateIngredient(name, currentId = null) {
    const normalizedName = name.trim().toLowerCase();
    
    // Remove common punctuation and extra spaces
    const cleanName = normalizedName.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '').replace(/\s+/g, ' ');
    
    // Check for exact matches (excluding current item if editing)
    const exactMatch = allIngredients.find(ing => 
        ing.id !== currentId && 
        ing.name.trim().toLowerCase() === normalizedName
    );
    
    if (exactMatch) {
        return {
            isDuplicate: true,
            type: 'exact',
            matchedItem: exactMatch
        };
    }
    
    // Check for very similar names (potential duplicates)
    const similarItems = allIngredients.filter(ing => {
        if (ing.id === currentId) return false;
        
        const existingClean = ing.name.trim().toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
            .replace(/\s+/g, ' ');
        
        // Check if one name contains the other
        if (existingClean.includes(cleanName) || cleanName.includes(existingClean)) {
            return true;
        }
        
        // Check for very similar words (singular/plural, minor variations)
        const newWords = cleanName.split(' ');
        const existingWords = existingClean.split(' ');
        
        // If they share most words, flag as similar
        const sharedWords = newWords.filter(word => 
            existingWords.some(existingWord => 
                word === existingWord || 
                word + 's' === existingWord || 
                word === existingWord + 's' ||
                word + 'es' === existingWord ||
                word === existingWord + 'es'
            )
        );
        
        // If more than 60% of words match, consider it similar
        const similarity = sharedWords.length / Math.max(newWords.length, existingWords.length);
        return similarity > 0.6;
    });
    
    if (similarItems.length > 0) {
        return {
            isDuplicate: true,
            type: 'similar',
            matchedItems: similarItems
        };
    }
    
    return {
        isDuplicate: false,
        type: 'unique',
        matchedItems: []
    };
}
// Show confirmation modal for duplicate warnings
function showDuplicateWarning(duplicateInfo, name, callback) {
    const { type, matchedItem, matchedItems } = duplicateInfo;
    
    let message = '';
    let itemsList = '';
    
    if (type === 'exact') {
        message = `⚠️ An ingredient with the exact name "${matchedItem.name}" already exists in the inventory.`;
        itemsList = `
            <div style="background: #fee2e2; padding: 12px; border-radius: 8px; margin: 16px 0;">
                <strong>Existing Item:</strong><br>
                • ${matchedItem.name} (${matchedItem.category || 'Uncategorized'}) - ID: ${matchedItem.ingredientId || matchedItem.id}
            </div>
        `;
    } else if (type === 'similar') {
        message = `⚠️ The following similar items already exist in the inventory:`;
        itemsList = `
            <div style="background: #fef3c7; padding: 12px; border-radius: 8px; margin: 16px 0;">
                <strong>Similar Items Found:</strong><br>
                ${matchedItems.map(item => 
                    `• ${item.name} (${item.category || 'Uncategorized'}) - ID: ${item.ingredientId || item.id}`
                ).join('<br>')}
            </div>
        `;
    }
    
    // Create custom confirmation modal
    const modalHTML = `
        <div id="duplicate-warning-modal" class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 500px;">
                <h2 style="color: #dc2626; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 28px;">⚠️</span>
                    Possible Duplicate Detected
                </h2>
                <p style="font-size: 14px; color: #666; margin-bottom: 16px;">
                    ${message}
                </p>
                ${itemsList}
                <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 16px 0;">
                    <strong>Item you're trying to add:</strong><br>
                    <span style="color: #059669; font-weight: 600;">"${name}"</span>
                </div>
                <p style="font-size: 13px; color: #666; margin-bottom: 16px;">
                    <strong>Are you sure this is a different item?</strong><br>
                    To proceed with adding this item, type <strong style="color: #dc2626;">CONFIRM</strong> below:
                </p>
                <div class="form-group">
                    <input type="text" id="duplicate-confirm-input" class="form-control" 
                           placeholder="Type CONFIRM to proceed" 
                           style="text-transform: uppercase; font-weight: 600;">
                    <p id="confirm-error" style="color: #dc2626; font-size: 12px; margin-top: 8px; display: none;">
                        Please type "CONFIRM" exactly to proceed.
                    </p>
                </div>
                <div class="modal-buttons" style="margin-top: 20px;">
                    <button type="button" id="cancel-duplicate-btn" class="btn btn--secondary">Cancel</button>
                    <button type="button" id="confirm-duplicate-btn" class="btn btn--primary" style="background: #dc2626;">
                        Add Anyway
                    </button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('duplicate-warning-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modal = document.getElementById('duplicate-warning-modal');
    const confirmInput = document.getElementById('duplicate-confirm-input');
    const confirmBtn = document.getElementById('confirm-duplicate-btn');
    const cancelBtn = document.getElementById('cancel-duplicate-btn');
    const errorMsg = document.getElementById('confirm-error');
    
    // Focus on input
    setTimeout(() => confirmInput.focus(), 100);
    
    // Handle confirmation
    confirmBtn.addEventListener('click', () => {
        const inputValue = confirmInput.value.trim().toUpperCase();
        
        if (inputValue === 'CONFIRM') {
            modal.remove();
            callback(true); // Proceed with adding
        } else {
            errorMsg.style.display = 'block';
            confirmInput.style.borderColor = '#dc2626';
            confirmInput.focus();
        }
    });
    
    // Handle cancel
    cancelBtn.addEventListener('click', () => {
        modal.remove();
        callback(false); // Don't proceed
    });
    
    // Handle Enter key
    confirmInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            confirmBtn.click();
        }
    });
    
    // Reset error on input
    confirmInput.addEventListener('input', () => {
        errorMsg.style.display = 'none';
        confirmInput.style.borderColor = '';
    });
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
            callback(false);
        }
    });
}

// Handle Add Items Form Submission
if (addItemsForm) {
    addItemsForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('add-item-name').value.trim();
        
        // Check for duplicates
        const duplicateCheck = await isDuplicateIngredient(name);
        
        if (duplicateCheck.isDuplicate) {
            // Show warning and wait for confirmation
            showDuplicateWarning(duplicateCheck, name, async (confirmed) => {
                if (confirmed) {
                    // User confirmed, proceed with saving
                    await saveNewIngredientFromAddForm(name);
                } else {
                    // User cancelled, focus back on name field
                    document.getElementById('add-item-name').focus();
                    document.getElementById('add-item-name').select();
                }
            });
            return; // Stop here and wait for user decision
        }
        
        // No duplicates, proceed normally
        await saveNewIngredientFromAddForm(name);
    });

    // Clear form button
    document.getElementById('cancel-add-item-btn')?.addEventListener('click', () => {
        addItemsForm.reset();
    });
}
// Extract save logic for add items form
async function saveNewIngredientFromAddForm(name) {
    const newData = {
        name: name,
        category: addItemCategory.value,
        stockQuantity: parseFloat(document.getElementById('add-item-stock').value),
        stockUnit: document.getElementById('add-item-stock-unit').value.trim(),
        baseUnit: document.getElementById('add-item-base-unit').value.trim(),
        conversionFactor: parseFloat(document.getElementById('add-item-conversion').value),
        minStockThreshold: parseInt(document.getElementById('add-item-min-stock').value) || 0,
        expiryDate: document.getElementById('add-item-expiry').value || null,
        lastUpdated: serverTimestamp(),
    };

    // Validation
    if (newData.conversionFactor <= 0) {
        alert("Conversion factor must be greater than 0.");
        return;
    }

    if (newData.stockUnit === newData.baseUnit && newData.conversionFactor !== 1) {
        alert("If Stock Unit and Base Unit are the same, conversion factor must be 1.");
        return;
    }

    try {
        newData.ingredientId = await getNextIngredientId();
        await addDoc(productsRef, newData);

        const employeeName = document.querySelector(".employee-name")?.textContent || "Employee";
        createLog(
            employeeName,
            "Add Stock",
            newData.name,
            newData.category,
            newData.stockQuantity,
            newData.stockUnit,
            0,
            newData.stockQuantity,
            "Added new stock"
        );

        // Show success message
        const successDiv = document.createElement('div');
        successDiv.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; font-weight: 600;';
        successDiv.textContent = `✓ Ingredient "${newData.name}" added successfully!`;
        document.body.appendChild(successDiv);
        setTimeout(() => successDiv.remove(), 3000);
        
        addItemsForm.reset();
    } catch (error) {
        console.error("❌ Error adding ingredient:", error);
        alert("Failed to add ingredient.");
    }
}
// --- Add these variables near the top of the file with other element declarations ---
let restockSearchInput;
let restockSearchCategory;
let restockShowAll;
let restockSearchReset;

// --- Replace the entire loadRestockItems function with this expanded version ---
export function loadRestockItems() {
    const restockTableBody = document.getElementById('restock-items-table-body');
    const outCountEl = document.getElementById('restock-out-count');
    const lowCountEl = document.getElementById('restock-low-count');
    const inStockCountEl = document.getElementById('restock-in-stock-count');
    const inStockCard = document.getElementById('restock-in-stock-card');
    const tabAlertDot = document.getElementById('restock-tab-alert-dot');
    
    // Get search elements
    restockSearchInput = document.getElementById('restock-search-input');
    restockSearchCategory = document.getElementById('restock-search-category');
    restockShowAll = document.getElementById('restock-show-all');
    restockSearchReset = document.getElementById('restock-search-reset');
    
    if (!restockTableBody) return;
    
    // Populate category dropdown
    populateRestockCategoryFilter();
    
    // Get filter values
    const searchTerm = restockSearchInput ? restockSearchInput.value.toLowerCase().trim() : '';
    const categoryFilter = restockSearchCategory ? restockSearchCategory.value : '';
    const showAllItems = restockShowAll ? restockShowAll.checked : false;
    
    // Determine which items to show
    let itemsToShow = [];
    let outOfStockCount = 0;
    let lowStockCount = 0;
    let inStockCount = 0;
    
    // Count all statuses first (for the cards)
    allIngredients.forEach(ing => {
        const { status } = getIngredientStatus(ing);
        if (status === 'out_of_stock') outOfStockCount++;
        else if (status === 'low_stock') lowStockCount++;
    });
    
    // Filter items based on search criteria
    if (showAllItems || searchTerm || categoryFilter) {
        // Show filtered items (can include any status)
        itemsToShow = allIngredients.filter(ing => {
            // Apply search term filter
            if (searchTerm) {
                const nameMatch = ing.name.toLowerCase().includes(searchTerm);
                const idMatch = (ing.ingredientId || ing.id).toLowerCase().includes(searchTerm);
                if (!nameMatch && !idMatch) return false;
            }
            
            // Apply category filter
            if (categoryFilter && ing.category !== categoryFilter) {
                return false;
            }
            
            return true;
        });
        
        // Count in-stock items being shown
        inStockCount = itemsToShow.filter(ing => {
            const { status } = getIngredientStatus(ing);
            return status === 'in_stock';
        }).length;
        
        // Show the in-stock card when showing all items
        if (inStockCard) {
            inStockCard.style.display = (showAllItems || searchTerm || categoryFilter) ? 'block' : 'none';
        }
    } else {
        // Default: Only show low stock and out of stock items
        itemsToShow = allIngredients.filter(ing => {
            const { status } = getIngredientStatus(ing);
            return status === 'low_stock' || status === 'out_of_stock';
        });
        
        if (inStockCard) {
            inStockCard.style.display = 'none';
        }
    }
    
    // Sort items: out of stock first, then low stock, then in stock
    itemsToShow.sort((a, b) => {
        const statusOrder = { 'out_of_stock': 0, 'low_stock': 1, 'expired': 2, 'in_stock': 3 };
        const statusA = getIngredientStatus(a).status;
        const statusB = getIngredientStatus(b).status;
        return (statusOrder[statusA] || 4) - (statusOrder[statusB] || 4);
    });
    
    restockTableBody.innerHTML = '';
    
    // Update counts
    if (outCountEl) outCountEl.textContent = outOfStockCount;
    if (lowCountEl) lowCountEl.textContent = lowStockCount;
    if (inStockCountEl) inStockCountEl.textContent = inStockCount;
    
    // Show alert dot if there are items needing restock
    if (tabAlertDot) {
        tabAlertDot.style.display = (outOfStockCount > 0 || lowStockCount > 0) ? 'inline-block' : 'none';
    }
    
    if (itemsToShow.length === 0) {
        let emptyMessage = '';
        
        if (searchTerm || categoryFilter) {
            emptyMessage = `
                <span style="font-size: 48px;">🔍</span><br>
                <strong>No items found</strong><br>
                Try adjusting your search or filters.
            `;
        } else if (showAllItems) {
            emptyMessage = `
                <span style="font-size: 48px;">📦</span><br>
                <strong>No ingredients in inventory</strong><br>
                Add ingredients to get started.
            `;
        } else {
            emptyMessage = `
                <span style="font-size: 48px;">✓</span><br>
                <strong>All items are well stocked!</strong><br>
                No items need restocking at this time.<br>
                <span style="font-size: 12px; color: #888;">Use search or check "Show all items" to restock any item.</span>
            `;
        }
        
        restockTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 40px; color: #666;">
            ${emptyMessage}
        </td></tr>`;
        return;
    }
    
    // Render items
    itemsToShow.forEach(ing => {
        const { status, statusDisplay, statusClass } = getIngredientStatus(ing);
        const displayStock = formatStockDisplay(ing.stockQuantity, ing.stockUnit, ing.baseUnit, ing.conversionFactor);
        
        const row = document.createElement('tr');
        
        // Set row background based on status
        if (status === 'out_of_stock') {
            row.style.backgroundColor = '#fee2e2';
        } else if (status === 'low_stock') {
            row.style.backgroundColor = 'var(--color-brown-50)';
        } else if (status === 'expired') {
            row.style.backgroundColor = '#fecaca';
        }
        
        // Highlight search term in name if searching
        let displayName = ing.name || '-';
        if (searchTerm && ing.name) {
            const regex = new RegExp(`(${searchTerm})`, 'gi');
            displayName = ing.name.replace(regex, '<mark style="background-color: #fef08a; padding: 0 2px;">$1</mark>');
        }
        
        row.innerHTML = `
            <td>${ing.ingredientId || ing.id}</td>
            <td style="font-weight: 600;">${displayName}</td>
            <td>${ing.category || '-'}</td>
            <td><span class="status ${statusClass}">${statusDisplay}</span></td>
            <td style="${(status === 'out_of_stock' || status === 'low_stock') ? 'color:var(--color-red-600);font-weight:600;' : ''}">
                ${displayStock}
            </td>
            <td>${(ing.minStockThreshold || 0)} ${ing.baseUnit}</td>
            <td class="actions-cell">
                <button class="btn btn--primary btn--small restock-btn" data-id="${ing.id}">
                    ${status === 'in_stock' ? 'Add Stock' : 'Restock'}
                </button>
            </td>
        `;
        
        // Add restock button functionality
        row.querySelector('.restock-btn').addEventListener('click', () => {
            openRestockModal(ing);
        });
        
        restockTableBody.appendChild(row);
    });
}

// --- Add this new function to populate the category filter ---
function populateRestockCategoryFilter() {
    if (!restockSearchCategory) return;
    
    const currentVal = restockSearchCategory.value;
    const categories = [...new Set(allIngredients.map(ing => ing.category).filter(Boolean))];
    categories.sort();
    
    restockSearchCategory.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        restockSearchCategory.appendChild(option);
    });
    
    restockSearchCategory.value = currentVal;
}

// --- Add this new function for the restock modal ---
function openRestockModal(ingredient) {
    // Remove existing modal if any
    const existingModal = document.getElementById('quick-restock-modal');
    if (existingModal) existingModal.remove();
    
    const currentStock = ingredient.stockQuantity || 0;
    const currentStockInBase = currentStock * (ingredient.conversionFactor || 1);
    const { statusDisplay, statusClass } = getIngredientStatus(ingredient);
    
    const modalHTML = `
        <div id="quick-restock-modal" class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 500px;">
                <h2 style="display: flex; align-items: center; gap: 8px;">
                    <span>📦</span>
                    Restock: ${ingredient.name}
                </h2>
                
                <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                        <div>
                            <strong style="color: #666; font-size: 12px;">CURRENT STOCK</strong>
                            <p style="font-size: 20px; font-weight: 700; margin: 4px 0; color: ${statusClass === 'status-blocked' ? 'var(--color-red-600)' : 'var(--color-primary)'};">
                                ${currentStock.toFixed(2)} ${ingredient.stockUnit}
                            </p>
                            <span style="color: #666; font-size: 12px;">(${currentStockInBase.toFixed(2)} ${ingredient.baseUnit})</span>
                        </div>
                        <div>
                            <strong style="color: #666; font-size: 12px;">STATUS</strong>
                            <p style="margin: 4px 0;">
                                <span class="status ${statusClass}">${statusDisplay}</span>
                            </p>
                            <span style="color: #666; font-size: 12px;">Min: ${ingredient.minStockThreshold || 0} ${ingredient.baseUnit}</span>
                        </div>
                    </div>
                </div>
                
                <form id="quick-restock-form">
                    <div class="form-group">
                        <label for="restock-qty">Add Stock Quantity (${ingredient.stockUnit}):</label>
                        <input type="number" id="restock-qty" class="form-control" 
                               placeholder="e.g., 5" step="any" min="0.01" required
                               style="font-size: 18px; padding: 12px;">
                        <p style="font-size: 12px; color: #666; margin-top: 4px;">
                            1 ${ingredient.stockUnit} = ${ingredient.conversionFactor} ${ingredient.baseUnit}
                        </p>
                    </div>
                    
                    <div id="restock-preview" style="background: #ecfdf5; padding: 12px; border-radius: 8px; margin-bottom: 16px; display: none;">
                        <strong style="color: #059669;">New Stock After Restock:</strong>
                        <span id="restock-new-total" style="font-size: 18px; font-weight: 700; margin-left: 8px;"></span>
                    </div>
                    
                    <div class="form-group">
                        <label for="restock-reason">Reason (Optional):</label>
                        <input type="text" id="restock-reason" class="form-control" 
                               placeholder="e.g., Weekly delivery, Emergency restock">
                    </div>
                    
                    <div class="form-group">
                        <label for="restock-expiry">Update Expiry Date (Optional):</label>
                        <input type="date" id="restock-expiry" class="form-control" 
                               value="${ingredient.expiryDate || ''}">
                    </div>
                    
                    <div class="modal-buttons" style="margin-top: 20px;">
                        <button type="button" id="cancel-quick-restock" class="btn btn--secondary">Cancel</button>
                        <button type="submit" class="btn btn--primary">
                            <span style="margin-right: 6px;">✓</span> Confirm Restock
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const modal = document.getElementById('quick-restock-modal');
    const form = document.getElementById('quick-restock-form');
    const cancelBtn = document.getElementById('cancel-quick-restock');
    const qtyInput = document.getElementById('restock-qty');
    const previewDiv = document.getElementById('restock-preview');
    const newTotalSpan = document.getElementById('restock-new-total');
    
    // Focus on quantity input
    setTimeout(() => qtyInput.focus(), 100);
    
    // Live preview of new stock
    qtyInput.addEventListener('input', () => {
        const addQty = parseFloat(qtyInput.value) || 0;
        if (addQty > 0) {
            const newTotal = currentStock + addQty;
            const newTotalInBase = newTotal * (ingredient.conversionFactor || 1);
            newTotalSpan.textContent = `${newTotal.toFixed(2)} ${ingredient.stockUnit} (${newTotalInBase.toFixed(2)} ${ingredient.baseUnit})`;
            previewDiv.style.display = 'block';
        } else {
            previewDiv.style.display = 'none';
        }
    });
    
    // Handle form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const addQty = parseFloat(qtyInput.value);
        const reason = document.getElementById('restock-reason').value.trim() || 'Manual restock';
        const newExpiry = document.getElementById('restock-expiry').value;
        
        if (!addQty || addQty <= 0) {
            alert('Please enter a valid quantity to add.');
            return;
        }
        
        const newStockQty = currentStock + addQty;
        
        try {
            const updateData = {
                stockQuantity: newStockQty,
                lastUpdated: serverTimestamp()
            };
            
            if (newExpiry) {
                updateData.expiryDate = newExpiry;
            }
            
            await updateDoc(doc(db, "ingredients", ingredient.id), updateData);
            
            // Create log entry
            const employeeName = document.querySelector(".employee-name")?.textContent || "Employee";
            createLog(
                employeeName,
                "Restock",
                ingredient.name,
                ingredient.category,
                addQty,
                ingredient.stockUnit,
                currentStock,
                newStockQty,
                reason
            );
            
            // Show success message
            const successDiv = document.createElement('div');
            successDiv.style.cssText = 'position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10001; font-weight: 600;';
            successDiv.textContent = `✓ ${ingredient.name} restocked successfully! Added ${addQty} ${ingredient.stockUnit}`;
            document.body.appendChild(successDiv);
            setTimeout(() => successDiv.remove(), 3000);
            
            modal.remove();
            
        } catch (error) {
            console.error("Error restocking:", error);
            alert("Failed to restock. Please try again.");
        }
    });
    
    // Handle cancel
    cancelBtn.addEventListener('click', () => modal.remove());
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    // Close on Escape key
    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });
}

// --- Add event listeners setup function ---
function setupRestockSearchListeners() {
    const searchInput = document.getElementById('restock-search-input');
    const searchCategory = document.getElementById('restock-search-category');
    const showAllCheckbox = document.getElementById('restock-show-all');
    const resetBtn = document.getElementById('restock-search-reset');
    
    if (searchInput) {
        // Debounce search input
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                loadRestockItems();
            }, 300);
        });
    }
    
    if (searchCategory) {
        searchCategory.addEventListener('change', () => {
            loadRestockItems();
        });
    }
    
    if (showAllCheckbox) {
        showAllCheckbox.addEventListener('change', () => {
            loadRestockItems();
        });
    }
    
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (searchCategory) searchCategory.value = '';
            if (showAllCheckbox) showAllCheckbox.checked = false;
            loadRestockItems();
        });
    }
}

// --- Initial Load & NEW Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    loadInventory(); // Main function to load data
    
    cancelBtn.addEventListener('click', closeModal);

    // --- NEW: Filter Listeners ---
    inventorySearchName.addEventListener('input', filterAndRenderInventory);
    inventoryFilterCategory.addEventListener('change', filterAndRenderInventory);
    inventoryFilterStatus.addEventListener('change', filterAndRenderInventory);
    inventoryFilterExpiry.addEventListener('change', filterAndRenderInventory);
    
    inventoryResetFilters.addEventListener('click', () => {
        inventorySearchName.value = '';
        inventoryFilterCategory.value = '';
        inventoryFilterStatus.value = '';
        inventoryFilterExpiry.value = '';
        filterAndRenderInventory(); // Re-run with cleared filters
    });
     setupRestockSearchListeners();
});
