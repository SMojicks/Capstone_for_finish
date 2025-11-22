import { db } from './firebase.js';
import {
  collection, addDoc, getDocs, onSnapshot, doc,
  updateDoc, getDoc, setDoc, deleteDoc, serverTimestamp,
  query, where, writeBatch, runTransaction, orderBy
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { logIngredientUsage } from './ingredient-usage-logger.js';
// --- Collections ---
const productsRef = collection(db, "products");
const ingredientsRef = collection(db, "ingredients");
const recipesRef = collection(db, "recipes");
const salesRef = collection(db, "sales"); // For COMPLETED orders
const pendingOrdersRef = collection(db, "pending_orders"); // For KITCHEN QUEUE
const stockMovementsRef = collection(db, "stock_movements");
const categoriesRef = doc(db, "settings", "categories");
const invCategoriesRef = doc(db, "settings", "inventoryCategories");


// --- Page Elements (DECLARED here, ASSIGNED in DOMContentLoaded) ---
let productGrid, cartItemsContainer, subtotalEl, taxEl, totalEl, processPaymentBtn, clearCartBtn, editModeBtn, categoryTabsContainer, menuImageUpload, menuImagePreview;
let addMenuBtn, cancelMenuBtn, menuModal, menuForm, recipeList, addIngredientBtn, menuCategoryDropdown, newCategoryInput, menuWaitTimeSelect;
let variationToggle, singlePriceWrapper, variationsWrapper, addVariationBtn, variationListContainer;
let variationModal, variationModalTitle, variationOptionsContainer, cancelVariationBtn;
let customerInfoModal, customerInfoForm, cancelCustomerInfoBtn;
let orderDetailsModal, orderModalBackBtn, orderModalVoidBtn, orderModalProgressBtn, orderModalPrintBtn;
let ordersLine;
let discountTypeSelect, customDiscountWrapper, customDiscountAmount, applyDiscountBtn, cartDiscountEl;
let kitchenStubModal, kitchenStubContent, kitchenStubSendBtn, kitchenStubCancelBtn;
let mainRecipeContainer;
let secondaryStockToggle, secondaryStockWrapper, secondaryStockList;


// --- State Variables ---
let cart = [];
let allProducts = [];
let allIngredientsCache = []; // All raw ingredients
let allInventoryCategories = []; // All inventory categories
let allRecipesCache = [];
let productStockStatus = new Map();
let allCategories = []; // Menu categories
let currentCategory = "All";
let editMode = false;
let allPendingOrders = [];
let currentOrderDetails = null;
let currentImageFile = null;
let currentImageUrl = null; 
let currentDiscount = { type: "none", amount: 0 };


// --- CLOUDINARY UPLOAD FUNCTION ---
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

// --- Category Management ---
async function loadCategories() {
  try {
    const docSnap = await getDoc(categoriesRef);
    if (docSnap.exists()) {
      allCategories = docSnap.data().list || [];
    } else {
      await setDoc(categoriesRef, { list: [] });
      allCategories = [];
    }
    allCategories.sort();
    renderCategoryTabs();
    if (menuCategoryDropdown) {
        menuCategoryDropdown.innerHTML = `<option value="">Select category...</option>`;
        allCategories.forEach(cat => menuCategoryDropdown.add(new Option(cat, cat)));
        menuCategoryDropdown.add(new Option("+ Create New Category...", "__new__"));
    }
  } catch (error) {
    console.error("Error loading categories:", error);
  }
}

async function addCategoryIfNew(categoryName) {
  if (categoryName && !allCategories.includes(categoryName)) {
    allCategories.push(categoryName);
    allCategories.sort();
    await setDoc(categoriesRef, { list: allCategories });
    loadCategories();
  }
}

// --- Recipe & Ingredient Filtering ---
async function loadInventoryCategories() {
    try {
        const docSnap = await getDoc(invCategoriesRef);
        if (docSnap.exists()) {
            allInventoryCategories = docSnap.data().list.sort() || [];
        } else {
            allInventoryCategories = [];
        }
    } catch (error) {
        console.error("Error loading inventory categories:", error);
    }
}

async function loadAllIngredientsCache() {
  try {
    const snapshot = await getDocs(ingredientsRef);
    allIngredientsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error caching all ingredients:", error);
  }
}

/**
 * Adds an ingredient row to the *main* recipe list (for single-price items)
 * @param {object} ingredient - The ingredient data to pre-fill
 * @param {HTMLElement} container - The HTML element to append the row to (should be recipeList)
 */
function addIngredientRowUI(ingredient = {}, container) {
  if (!container) {
      console.error("No container specified for addIngredientRowUI");
      return;
  }
  const row = document.createElement("div");
  row.className = "ingredient-row";

  // 1. Create Category Dropdown
  const categorySelect = document.createElement("select");
  categorySelect.className = "inv-category-filter form-control";
  categorySelect.innerHTML = `<option value="">All Categories</option>`;
  allInventoryCategories.forEach(cat => {
      categorySelect.add(new Option(cat, cat));
  });

  // 2. Create Ingredient Dropdown
  const ingredientSelect = document.createElement("select");
  ingredientSelect.className = "ingredient-id form-control";
  ingredientSelect.required = true;
  
  // 3. Create Qty, Unit, and Delete Button
  const qtyInput = document.createElement("input");
  qtyInput.type = "number";
  qtyInput.className = "ingredient-qty form-control";
  qtyInput.placeholder = "Qty";
  qtyInput.step = "any";
  qtyInput.min = "0";
  qtyInput.required = true;

  const unitInput = document.createElement("input");
  unitInput.type = "text";
  unitInput.className = "ingredient-unit form-control";
  unitInput.placeholder = "Unit";
  unitInput.readOnly = true;
  unitInput.required = true;
  
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn btn--secondary remove-ingredient";
  deleteBtn.textContent = "X";
  deleteBtn.onclick = () => row.remove();

  // 4. Function to populate ingredients based on category
  const populateIngredients = (category) => {
      let filtered = (category)
          ? allIngredientsCache.filter(ing => ing.category === category)
          : allIngredientsCache; // "All Categories"
      
      ingredientSelect.innerHTML = `<option value="">Select Ingredient...</option>`;
      filtered.forEach(ing => {
          ingredientSelect.add(new Option(`${ing.name} (${ing.baseUnit})`, ing.id));
          ingredientSelect.options[ingredientSelect.options.length - 1].dataset.baseUnit = ing.baseUnit;
      });
  };

  // 5. Add Event Listeners
  categorySelect.addEventListener("change", () => {
      populateIngredients(categorySelect.value);
      unitInput.value = ""; // Clear unit when category changes
  });

  ingredientSelect.addEventListener("change", () => {
      const selectedOption = ingredientSelect.options[ingredientSelect.selectedIndex];
      unitInput.value = selectedOption.dataset.baseUnit || "";
  });

  // 6. Append all elements
  row.appendChild(categorySelect);
  row.appendChild(ingredientSelect);
  row.appendChild(qtyInput);
  row.appendChild(unitInput);
  row.appendChild(deleteBtn);
  container.appendChild(row); // Use the provided container

  // 7. Pre-fill logic (for editing)
  if (ingredient.ingredientId) {
      const fullIngredient = allIngredientsCache.find(ing => ing.id === ingredient.ingredientId);
      if (fullIngredient) {
          categorySelect.value = fullIngredient.category;
          populateIngredients(fullIngredient.category);
          ingredientSelect.value = ingredient.ingredientId;
          qtyInput.value = ingredient.qtyPerProduct;
          unitInput.value = ingredient.unitUsed;
      }
  } else {
      populateIngredients("");
  }
}

/**
 * Adds an all-in-one row (Variation + Recipe) to the variations list
 * @param {object} variation - The variation data (name, price) to pre-fill
 * @param {object} ingredient - The ingredient data to pre-fill
 */
/**
 * Creates a variation container with name, price, and its own recipe list
 * @param {object} variation - The variation data (name, price, recipe) to pre-fill
 */
function addVariationRowUI(variation = {}) {
    if (!variationListContainer) return;

    const variationIndex = variationListContainer.children.length;
    const container = document.createElement("div");
    container.className = "variation-container";
    container.dataset.variationIndex = variationIndex;

    container.innerHTML = `
        <div class="variation-header">
            <span class="variation-title">Variation ${variationIndex + 1}</span>
            <button type="button" class="remove-variation-btn">Remove Variation</button>
        </div>
        <div class="variation-name-price-row">
            <div class="form-group" style="margin-bottom: 0;">
                <label>Variation Name:</label>
                <input type="text" class="form-control variation-name" placeholder="e.g., 8oz, 12oz, Large" value="${variation.name || ''}" required>
            </div>
            <div class="form-group" style="margin-bottom: 0;">
                <label>Price (₱):</label>
                <input type="number" class="form-control variation-price" placeholder="0.00" value="${variation.price || ''}" step="0.01" min="0" required>
            </div>
        </div>
        <div class="variation-recipe-section">
            <label class="variation-recipe-label">Recipe for this Variation:</label>
            <div class="variation-recipe-list" data-variation-index="${variationIndex}"></div>
            <button type="button" class="btn btn--secondary btn--small add-ingredient-to-variation-btn" data-variation-index="${variationIndex}">+ Add Ingredient</button>
        </div>
    `;

    variationListContainer.appendChild(container);

    // Get the recipe list container for this specific variation
    const recipeListContainer = container.querySelector('.variation-recipe-list');

    // Add event listener for "Add Ingredient" button
    const addIngredientBtn = container.querySelector('.add-ingredient-to-variation-btn');
    addIngredientBtn.addEventListener('click', () => {
        addIngredientToVariationUI({}, recipeListContainer);
    });

    // Add event listener for "Remove Variation" button
    const removeBtn = container.querySelector('.remove-variation-btn');
    removeBtn.addEventListener('click', () => {
        if (confirm('Remove this variation and its recipe?')) {
            container.remove();
            updateVariationNumbers();
        }
    });

    // Pre-fill recipe if editing
    if (variation.recipe && variation.recipe.length > 0) {
        variation.recipe.forEach(ingredient => {
            addIngredientToVariationUI(ingredient, recipeListContainer);
        });
    }
}

/**
 * Updates the variation numbers after deletion
 */
function updateVariationNumbers() {
    const containers = variationListContainer.querySelectorAll('.variation-container');
    containers.forEach((container, index) => {
        container.dataset.variationIndex = index;
        container.querySelector('.variation-title').textContent = `Variation ${index + 1}`;
        
        const recipeList = container.querySelector('.variation-recipe-list');
        recipeList.dataset.variationIndex = index;
        
        const addBtn = container.querySelector('.add-ingredient-to-variation-btn');
        addBtn.dataset.variationIndex = index;
    });
}

/**
 * Adds an ingredient row to a specific variation's recipe list
 * @param {object} ingredient - The ingredient data to pre-fill
 * @param {HTMLElement} container - The variation's recipe list container
 */
function addIngredientToVariationUI(ingredient = {}, container) {
    if (!container) {
        console.error("No container specified for addIngredientToVariationUI");
        return;
    }

    const row = document.createElement("div");
    row.className = "ingredient-row";

    // Create Category Dropdown
    const categorySelect = document.createElement("select");
    categorySelect.className = "inv-category-filter form-control";
    categorySelect.innerHTML = `<option value="">All Categories</option>`;
    allInventoryCategories.forEach(cat => {
        categorySelect.add(new Option(cat, cat));
    });

    // Create Ingredient Dropdown
    const ingredientSelect = document.createElement("select");
    ingredientSelect.className = "ingredient-id form-control";
    ingredientSelect.required = true;
    
    // Create Qty, Unit, and Delete Button
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.className = "ingredient-qty form-control";
    qtyInput.placeholder = "Qty";
    qtyInput.step = "any";
    qtyInput.min = "0";
    qtyInput.required = true;

    const unitInput = document.createElement("input");
    unitInput.type = "text";
    unitInput.className = "ingredient-unit form-control";
    unitInput.placeholder = "Unit";
    unitInput.readOnly = true;
    unitInput.required = true;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn--secondary remove-ingredient";
    deleteBtn.textContent = "X";
    deleteBtn.onclick = () => row.remove();

    // Function to populate ingredients based on category
    const populateIngredients = (category) => {
        let filtered = (category)
            ? allIngredientsCache.filter(ing => ing.category === category)
            : allIngredientsCache;
        
        ingredientSelect.innerHTML = `<option value="">Select Ingredient...</option>`;
        filtered.forEach(ing => {
            ingredientSelect.add(new Option(`${ing.name} (${ing.baseUnit})`, ing.id));
            ingredientSelect.options[ingredientSelect.options.length - 1].dataset.baseUnit = ing.baseUnit;
        });
    };

    // Add Event Listeners
    categorySelect.addEventListener("change", () => {
        populateIngredients(categorySelect.value);
        unitInput.value = "";
    });

    ingredientSelect.addEventListener("change", () => {
        const selectedOption = ingredientSelect.options[ingredientSelect.selectedIndex];
        unitInput.value = selectedOption.dataset.baseUnit || "";
    });

    // Append all elements
    row.appendChild(categorySelect);
    row.appendChild(ingredientSelect);
    row.appendChild(qtyInput);
    row.appendChild(unitInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);

    // Pre-fill logic (for editing)
    if (ingredient.ingredientId) {
        const fullIngredient = allIngredientsCache.find(ing => ing.id === ingredient.ingredientId);
        if (fullIngredient) {
            categorySelect.value = fullIngredient.category;
            populateIngredients(fullIngredient.category);
            ingredientSelect.value = ingredient.ingredientId;
            qtyInput.value = ingredient.qtyPerProduct;
            unitInput.value = ingredient.unitUsed;
        }
    } else {
        populateIngredients("");
    }
}
/**
 * Creates secondary stock recipe containers (one per variation or one for single-price items)
 * @param {Array} variations - Array of variation objects (empty for single-price items)
 * @param {object} secondaryStock - Existing secondary stock data for editing
 */
function setupSecondaryStockUI(variations = [], secondaryStock = null) {
    if (!secondaryStockList) return;
    
    secondaryStockList.innerHTML = "";
    
    if (variations.length > 0) {
        // Create secondary stock for each variation
        variations.forEach((variation, index) => {
            const container = document.createElement("div");
            container.className = "secondary-stock-container";
            container.dataset.variationName = variation.name;
            
            container.innerHTML = `
                <div class="secondary-stock-header">
                    <span class="secondary-stock-title">
                        <span class="secondary-variation-name">${variation.name}</span>
                        <span class="secondary-stock-badge">BACKUP</span>
                    </span>
                </div>
                <div class="secondary-stock-recipe-section">
                    <label class="secondary-stock-recipe-label">Secondary Ingredients:</label>
                    <div class="secondary-stock-recipe-list" data-variation-name="${variation.name}"></div>
                    <button type="button" class="btn btn--secondary btn--small add-ingredient-to-secondary-btn" data-variation-name="${variation.name}">+ Add Ingredient</button>
                </div>
            `;
            
            secondaryStockList.appendChild(container);
            
            const recipeListContainer = container.querySelector('.secondary-stock-recipe-list');
            const addIngredientBtn = container.querySelector('.add-ingredient-to-secondary-btn');
            
            addIngredientBtn.addEventListener('click', () => {
                addIngredientToSecondaryUI({}, recipeListContainer);
            });
            
            // Pre-fill if editing
            if (secondaryStock && secondaryStock[variation.name]) {
                secondaryStock[variation.name].forEach(ingredient => {
                    addIngredientToSecondaryUI(ingredient, recipeListContainer);
                });
            }
        });
    } else {
        // Create single secondary stock for non-variation items
        const container = document.createElement("div");
        container.className = "secondary-stock-container";
        
        container.innerHTML = `
            <div class="secondary-stock-header">
                <span class="secondary-stock-title">
                    <span class="secondary-stock-badge">BACKUP RECIPE</span>
                </span>
            </div>
            <div class="secondary-stock-recipe-section">
                <label class="secondary-stock-recipe-label">Secondary Ingredients:</label>
                <div class="secondary-stock-recipe-list" data-variation-name="default"></div>
                <button type="button" class="btn btn--secondary btn--small add-ingredient-to-secondary-btn" data-variation-name="default">+ Add Ingredient</button>
            </div>
        `;
        
        secondaryStockList.appendChild(container);
        
        const recipeListContainer = container.querySelector('.secondary-stock-recipe-list');
        const addIngredientBtn = container.querySelector('.add-ingredient-to-secondary-btn');
        
        addIngredientBtn.addEventListener('click', () => {
            addIngredientToSecondaryUI({}, recipeListContainer);
        });
        
        // Pre-fill if editing
        if (secondaryStock && secondaryStock.default) {
            secondaryStock.default.forEach(ingredient => {
                addIngredientToSecondaryUI(ingredient, recipeListContainer);
            });
        }
    }
}

/**
 * Adds an ingredient row to a secondary stock recipe list
 * @param {object} ingredient - The ingredient data to pre-fill
 * @param {HTMLElement} container - The secondary stock recipe list container
 */
function addIngredientToSecondaryUI(ingredient = {}, container) {
    if (!container) {
        console.error("No container specified for addIngredientToSecondaryUI");
        return;
    }

    const row = document.createElement("div");
    row.className = "ingredient-row";

    const categorySelect = document.createElement("select");
    categorySelect.className = "inv-category-filter form-control";
    categorySelect.innerHTML = `<option value="">All Categories</option>`;
    allInventoryCategories.forEach(cat => {
        categorySelect.add(new Option(cat, cat));
    });

    const ingredientSelect = document.createElement("select");
    ingredientSelect.className = "ingredient-id form-control";
    ingredientSelect.required = true;
    
    const qtyInput = document.createElement("input");
    qtyInput.type = "number";
    qtyInput.className = "ingredient-qty form-control";
    qtyInput.placeholder = "Qty";
    qtyInput.step = "any";
    qtyInput.min = "0";
    qtyInput.required = true;

    const unitInput = document.createElement("input");
    unitInput.type = "text";
    unitInput.className = "ingredient-unit form-control";
    unitInput.placeholder = "Unit";
    unitInput.readOnly = true;
    unitInput.required = true;
    
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn--secondary remove-ingredient";
    deleteBtn.textContent = "X";
    deleteBtn.onclick = () => row.remove();

    const populateIngredients = (category) => {
        let filtered = (category)
            ? allIngredientsCache.filter(ing => ing.category === category)
            : allIngredientsCache;
        
        ingredientSelect.innerHTML = `<option value="">Select Ingredient...</option>`;
        filtered.forEach(ing => {
            ingredientSelect.add(new Option(`${ing.name} (${ing.baseUnit})`, ing.id));
            ingredientSelect.options[ingredientSelect.options.length - 1].dataset.baseUnit = ing.baseUnit;
        });
    };

    categorySelect.addEventListener("change", () => {
        populateIngredients(categorySelect.value);
        unitInput.value = "";
    });

    ingredientSelect.addEventListener("change", () => {
        const selectedOption = ingredientSelect.options[ingredientSelect.selectedIndex];
        unitInput.value = selectedOption.dataset.baseUnit || "";
    });

    row.appendChild(categorySelect);
    row.appendChild(ingredientSelect);
    row.appendChild(qtyInput);
    row.appendChild(unitInput);
    row.appendChild(deleteBtn);
    container.appendChild(row);

    if (ingredient.ingredientId) {
        const fullIngredient = allIngredientsCache.find(ing => ing.id === ingredient.ingredientId);
        if (fullIngredient) {
            categorySelect.value = fullIngredient.category;
            populateIngredients(fullIngredient.category);
            ingredientSelect.value = ingredient.ingredientId;
            qtyInput.value = ingredient.qtyPerProduct;
            unitInput.value = ingredient.unitUsed;
        }
    } else {
        populateIngredients("");
    }
}

// --- Save Product, Variations, and Recipe ---
// This function needs to be attached to the form,
// so we will move its attachment into DOMContentLoaded
async function handleMenuFormSubmit(e) {
  e.preventDefault();
  
  const productId = document.getElementById("menu-product-id").value || doc(productsRef).id;
  const isEditing = !!document.getElementById("menu-product-id").value;
  
  let productCategory = menuCategoryDropdown.value;
  if (productCategory === "__new__") {
      productCategory = newCategoryInput.value.trim();
      if (productCategory) await addCategoryIfNew(productCategory);
      else { alert("Please enter a name for the new category."); return; }
  }

const productData = {
    name: document.getElementById("menu-name").value,
    category: productCategory,
    waitingTime: menuWaitTimeSelect.value,
    isVisible: true,
    imageUrl: currentImageUrl || null,
    price: 0, 
    variations: [],
    hasSecondaryStock: secondaryStockToggle.checked,  // ADD THIS
    secondaryStock: null  // ADD THIS
};
  
  if (!productData.waitingTime) { alert("Please select an average waiting time."); return; }

  let mainRecipeData = [];
  let recipeError = false; 

if (variationToggle.checked) {
    const variationContainers = variationListContainer.querySelectorAll(".variation-container");
    if (variationContainers.length === 0) { 
        alert("Please add at least one variation."); 
        return; 
    }

    let variationError = false;
    const variations = [];

    variationContainers.forEach(container => {
        const varName = container.querySelector(".variation-name").value.trim();
        const varPrice = parseFloat(container.querySelector(".variation-price").value);

        if (!varName || isNaN(varPrice) || varPrice <= 0) {
            variationError = true;
            return;
        }

        const recipe = [];
        const ingredientRows = container.querySelectorAll(".ingredient-row");
        
        if (ingredientRows.length === 0) {
            alert(`Variation "${varName}" must have at least one ingredient.`);
            recipeError = true;
            return;
        }

        ingredientRows.forEach(row => {
            const ingredient = {
                ingredientId: row.querySelector(".ingredient-id").value,
                qtyPerProduct: parseFloat(row.querySelector(".ingredient-qty").value),
                unitUsed: row.querySelector(".ingredient-unit").value
            };

            if (!ingredient.ingredientId || isNaN(ingredient.qtyPerProduct) || !ingredient.unitUsed) {
                recipeError = true;
            }

            recipe.push(ingredient);
        });

        variations.push({
            name: varName,
            price: varPrice,
            recipe: recipe
        });
    });

    if (variationError) { 
        alert("Please ensure every variation has a valid Name and Price."); 
        return; 
    }
    if (recipeError) { 
        alert("Please ensure every ingredient row is completely filled out."); 
        return; 
    }

    productData.variations = variations;
    if (productData.variations.length > 0) {
        productData.price = productData.variations[0].price;
    }
}else {
      const singlePrice = parseFloat(document.getElementById("menu-price").value);
      if (isNaN(singlePrice) || singlePrice <= 0) { alert("Please enter a valid price for the product."); return; }
      productData.price = singlePrice;
      productData.variations = [];
      
      const ingredientRows = recipeList.querySelectorAll(".ingredient-row");
      if (ingredientRows.length === 0) { alert("A product must have at least one ingredient."); return; }
      
      ingredientRows.forEach(row => {
          const ingredientId = row.querySelector(".ingredient-id").value;
          const qty = parseFloat(row.querySelector(".ingredient-qty").value);
          const unit = row.querySelector(".ingredient-unit").value;
          if (!unit || qty <= 0 || !ingredientId) { recipeError = true; }
          mainRecipeData.push({ productId: productId, ingredientId: ingredientId, qtyPerProduct: qty, unitUsed: unit });
      });
      if (recipeError) { alert("Please check your recipe ingredients."); return; }
  }
  // --- Handle Secondary Stock ---
if (secondaryStockToggle.checked) {
    const secondaryStockData = {};
    
    if (productData.variations.length > 0) {
        // Secondary stock for variations
        const secondaryContainers = secondaryStockList.querySelectorAll(".secondary-stock-container");
        
        secondaryContainers.forEach(container => {
            const varName = container.dataset.variationName;
            const ingredientRows = container.querySelectorAll(".ingredient-row");
            const recipe = [];
            
            ingredientRows.forEach(row => {
                const ingredient = {
                    ingredientId: row.querySelector(".ingredient-id").value,
                    qtyPerProduct: parseFloat(row.querySelector(".ingredient-qty").value),
                    unitUsed: row.querySelector(".ingredient-unit").value
                };
                
                if (ingredient.ingredientId && !isNaN(ingredient.qtyPerProduct) && ingredient.unitUsed) {
                    recipe.push(ingredient);
                }
            });
            
            if (recipe.length > 0) {
                secondaryStockData[varName] = recipe;
            }
        });
    } else {
        // Secondary stock for single-price items
        const container = secondaryStockList.querySelector(".secondary-stock-container");
        if (container) {
            const ingredientRows = container.querySelectorAll(".ingredient-row");
            const recipe = [];
            
            ingredientRows.forEach(row => {
                const ingredient = {
                    ingredientId: row.querySelector(".ingredient-id").value,
                    qtyPerProduct: parseFloat(row.querySelector(".ingredient-qty").value),
                    unitUsed: row.querySelector(".ingredient-unit").value
                };
                
                if (ingredient.ingredientId && !isNaN(ingredient.qtyPerProduct) && ingredient.unitUsed) {
                    recipe.push(ingredient);
                }
            });
            
            if (recipe.length > 0) {
                secondaryStockData.default = recipe;
            }
        }
    }
    
    productData.secondaryStock = Object.keys(secondaryStockData).length > 0 ? secondaryStockData : null;
} else {
    productData.hasSecondaryStock = false;
    productData.secondaryStock = null;
}
  try {
      const saveBtn = menuForm.querySelector('button[type="submit"]');
      if (currentImageFile) {
          saveBtn.disabled = true;
          saveBtn.textContent = "Uploading Image...";
          const downloadURL = await uploadToCloudinary(currentImageFile);
          productData.imageUrl = downloadURL;
          saveBtn.textContent = "Saving Product...";
      }

      const batch = writeBatch(db);
      const productDocRef = doc(db, "products", productId);
      batch.set(productDocRef, productData, { merge: true });

      if (isEditing) {
          const q = query(recipesRef, where("productId", "==", productId));
          const oldRecipes = await getDocs(q);
          oldRecipes.forEach(recipeDoc => batch.delete(recipeDoc.ref));
      }
      
      if (mainRecipeData.length > 0) {
          mainRecipeData.forEach(recipeItem => {
              const recipeDocRef = doc(collection(db, "recipes"));
              batch.set(recipeDocRef, recipeItem);
          });
      }

      await batch.commit();
      alert(`Product ${isEditing ? 'updated' : 'saved'} successfully!`);
      closeMenuModal();
  
  } catch (error) {
      console.error("Error saving product:", error);
      alert(`Failed to save product: ${error.message}`);
  } finally {
      const saveBtn = menuForm.querySelector('button[type="submit"]');
      if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save Product & Recipe";
      }
  }
}

function closeMenuModal() {
  if (menuModal) {
    menuModal.style.display = "none";
    if (menuForm) menuForm.reset();
    if (recipeList) recipeList.innerHTML = "";
    if (variationListContainer) variationListContainer.innerHTML = "";
    if (document.getElementById("menu-product-id")) document.getElementById("menu-product-id").value = "";
    if (newCategoryInput) newCategoryInput.style.display = "none";
    if (addIngredientBtn) addIngredientBtn.disabled = true;

    if (variationToggle) variationToggle.checked = false;
    if (singlePriceWrapper) singlePriceWrapper.classList.remove("hidden");
    if (variationsWrapper) variationsWrapper.classList.add("hidden");
    if (mainRecipeContainer) mainRecipeContainer.classList.remove("disabled");

    if (menuImagePreview) {
        menuImagePreview.src = "";
        menuImagePreview.classList.add("hidden");
    }
    currentImageFile = null;
    currentImageUrl = null;
  }
  if (secondaryStockToggle) secondaryStockToggle.checked = false;
  if (secondaryStockWrapper) secondaryStockWrapper.classList.add("hidden");
  if (secondaryStockList) secondaryStockList.innerHTML = "";
    }

// --- Edit Mode Toggle ---
function handleToggleVisibility(productId, currentVisibility) {
  try {
    updateDoc(doc(db, "products", productId), { isVisible: !currentVisibility });
  } catch (error) {
    console.error("Error toggling visibility:", error);
  }
}

// --- POS Category Tabs ---
function renderCategoryTabs() {
  if (!categoryTabsContainer) return;
  categoryTabsContainer.innerHTML = "";
  
  const allTab = document.createElement("button");
  allTab.className = "category-tab" + (currentCategory === "All" ? " active" : "");
  allTab.textContent = "All";
  allTab.onclick = () => { currentCategory = "All"; renderCategoryTabs(); renderProducts(); };
  categoryTabsContainer.appendChild(allTab);
  
  allCategories.forEach(category => {
    const tab = document.createElement("button");
    tab.className = "category-tab" + (currentCategory === category ? " active" : "");
    tab.textContent = category;
    tab.onclick = () => { currentCategory = category; renderCategoryTabs(); renderProducts(); };
    categoryTabsContainer.appendChild(tab);
  });
}

// --- Data Listeners ---
function listenForProducts() {
  const q = query(productsRef, orderBy("category"), orderBy("name"));
  onSnapshot(q, (snapshot) => {
    allProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateAllProductStockStatusAndRender();
  }, (error) => console.error("Error listening to products:", error));
}
function listenForIngredients() {
  const qIngredients = query(ingredientsRef, orderBy("name"));
  onSnapshot(qIngredients, (snapshot) => {
    allIngredientsCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    updateAllProductStockStatusAndRender();
  }, (error) => console.error("Error listening to ingredients:", error));
}
function listenForRecipes() {
  const qRecipes = query(recipesRef);
  onSnapshot(qRecipes, (snapshot) => {
    allRecipesCache = snapshot.docs.map(doc => doc.data());
    updateAllProductStockStatusAndRender();
  }, (error) => console.error("Error listening to recipes:", error));
}

function updateAllProductStockStatusAndRender() {
    if (allIngredientsCache.length === 0 || allProducts.length === 0) {
    return;
  }

  const ingredientStockMap = new Map();
  allIngredientsCache.forEach(ing => {
    const currentStockInBase = (ing.stockQuantity || 0) * (ing.conversionFactor || 1);
    ingredientStockMap.set(ing.id, { stock: currentStockInBase, minStock: ing.minStockThreshold || 0 });
  });

  productStockStatus.clear();
  for (const product of allProducts) {
    let status = "in-stock";
    
    // Helper function to check if a recipe has stock
    const checkRecipeStock = (recipe) => {
        let recipeStatus = "in-stock";
        for (const recipeItem of recipe) {
            const ingredient = ingredientStockMap.get(recipeItem.ingredientId);
            const neededQty = parseFloat(recipeItem.qtyPerProduct);
            
            if (!ingredient) { 
                recipeStatus = "out-of-stock"; 
                break; 
            }
            
            if (ingredient.stock < neededQty) { 
                recipeStatus = "out-of-stock"; 
                break; 
            }
            
            if (ingredient.stock <= ingredient.minStock && recipeStatus !== "out-of-stock") { 
                recipeStatus = "low-stock"; 
            }
        }
        return recipeStatus;
    };
    
    if (product.variations && product.variations.length > 0) {
        let atLeastOneVariationInStock = false;
        let atLeastOneVariationLowStock = false;

        for (const variation of product.variations) {
            let varStatus = "in-stock";
            
            if (!variation.recipe || variation.recipe.length === 0) {
                varStatus = "out-of-stock";
            } else {
                // Check primary recipe
                varStatus = checkRecipeStock(variation.recipe);
                
                // If primary is out of stock, check secondary stock
                if (varStatus === "out-of-stock" && product.hasSecondaryStock && product.secondaryStock && product.secondaryStock[variation.name]) {
                    varStatus = checkRecipeStock(product.secondaryStock[variation.name]);
                }
            }
            
            if (varStatus === "in-stock" || varStatus === "low-stock") {
                atLeastOneVariationInStock = true;
            }
            if (varStatus === "low-stock") {
                atLeastOneVariationLowStock = true;
            }
        }
        
        if (!atLeastOneVariationInStock) {
            status = "out-of-stock";
        } else if (atLeastOneVariationLowStock) {
            status = "low-stock";
        }
        
    } else {
        const productRecipes = allRecipesCache.filter(r => r.productId === product.id);
        
        if (productRecipes.length === 0) {
            status = "out-of-stock";
        } else {
            // Check primary recipe
            status = checkRecipeStock(productRecipes);
            
            // If primary is out of stock, check secondary stock
            if (status === "out-of-stock" && product.hasSecondaryStock && product.secondaryStock && product.secondaryStock.default) {
                status = checkRecipeStock(product.secondaryStock.default);
            }
        }
    }
    
    productStockStatus.set(product.id, status);
  }
  renderProducts();
  loadCategories();
}

// --- Render Products to POS Grid ---
function renderProducts() {
  if (!productGrid) return;
  productGrid.innerHTML = "";
  let productsToRender = allProducts;
  if (!editMode) {
    productsToRender = allProducts.filter(p => p.isVisible === true);
  }
  if (currentCategory !== "All") {
    productsToRender = productsToRender.filter(p => p.category === currentCategory);
  }
  if (productsToRender.length === 0) {
    if (currentCategory === "All" && allProducts.length === 0) {
        productGrid.innerHTML = "<p>Loading products...</p>";
    } else {
        productGrid.innerHTML = `<p>No products found in "${currentCategory}".</p>`;
    }
    return;
  }
  let currentHeader = "";
  productsToRender.forEach(product => {
    if (currentCategory === "All" && product.category !== currentHeader) {
      currentHeader = product.category;
      const headerEl = document.createElement("div");
      headerEl.className = "product-category-header";
      headerEl.textContent = currentHeader;
      productGrid.appendChild(headerEl);
    }
    productGrid.appendChild(createProductCard(product));
  });
}

function createProductCard(product) {
  const card = document.createElement("div");
  card.className = "product-card";
  card.dataset.id = product.id;
  if (!product.isVisible) card.classList.add("is-hidden");
  
  if (product.imageUrl) {
    const img = document.createElement("img");
    img.src = product.imageUrl;
    img.alt = product.name;
    img.className = "product-card-image";
    card.appendChild(img);
  }
  
  const infoDiv = document.createElement("div");
  infoDiv.className = "product-card-info";

  let priceDisplay = "";
  if (product.variations && product.variations.length > 0) {
      const prices = product.variations.map(v => v.price);
      const minPrice = Math.min(...prices);
      const maxPrice = Math.max(...prices);
      if (minPrice === maxPrice) {
          priceDisplay = `₱${minPrice.toFixed(2)}`;
      } else {
          priceDisplay = `₱${minPrice.toFixed(2)} - ₱${maxPrice.toFixed(2)}`;
      }
  } else {
      priceDisplay = `₱${product.price.toFixed(2)}`;
  }

  infoDiv.innerHTML = `
    <div class="product-name">${product.name}</div>
    <div class="product-category">${product.category}</div>
    <div class="product-price">${priceDisplay}</div>
  `;
  card.appendChild(infoDiv);

  const stockStatus = productStockStatus.get(product.id);
  if (stockStatus === "low-stock" || stockStatus === "out-of-stock") {
    const label = document.createElement("div");
    label.className = `product-stock-label ${stockStatus}`;
    label.textContent = stockStatus === "low-stock" ? "Low Stock" : "Out of Stock";
    card.appendChild(label);
  }
  
  if (editMode) {
    const controlsDiv = document.createElement("div");
    controlsDiv.className = "product-card-edit-controls";
    const editBtn = document.createElement("button");
    editBtn.className = "product-edit-btn";
    editBtn.innerHTML = "&#9998;";
    editBtn.title = "Edit Item";
    editBtn.onclick = (e) => { e.stopPropagation(); openEditModal(product); };
    controlsDiv.appendChild(editBtn);
    const toggleBtn = document.createElement("button");
    toggleBtn.className = "product-toggle-btn" + (product.isVisible ? " is-visible" : "");
    toggleBtn.innerHTML = product.isVisible ? "✓" : "×";
    toggleBtn.title = product.isVisible ? "Click to Hide" : "Click to Show";
    toggleBtn.onclick = (e) => { e.stopPropagation(); handleToggleVisibility(product.id, product.isVisible); };
    controlsDiv.appendChild(toggleBtn);
    card.appendChild(controlsDiv);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "product-delete-btn";
    deleteBtn.innerHTML = "&#128465;";
    deleteBtn.title = "Delete Item Permanently";
    deleteBtn.onclick = (e) => { e.stopPropagation(); handleDeleteMenuItem(product); };
    controlsDiv.appendChild(deleteBtn);
  } else {
    if (stockStatus === "out-of-stock") {
      card.style.cursor = "not-allowed";
      card.style.opacity = "0.6";
    } else {
      card.onclick = () => handleProductClick(product);
    }
  }
  return card;
}

// --- MODIFIED: openEditModal ---
async function openEditModal(product) {
    if (menuModal) menuModal.style.display = "flex";
    document.getElementById("menu-modal-title").textContent = "Edit Menu Product";
    menuForm.querySelector('button[type="submit"]').textContent = "Update Product";

    await loadCategories();
    await loadInventoryCategories();
    await loadAllIngredientsCache();

    document.getElementById("menu-product-id").value = product.id;
    document.getElementById("menu-name").value = product.name;
    document.getElementById("menu-waiting-time").value = product.waitingTime;
    document.getElementById("menu-category").value = product.category;

if (product.variations && product.variations.length > 0) {
    variationToggle.checked = true;
    singlePriceWrapper.classList.add("hidden");
    variationsWrapper.classList.remove("hidden");
    variationListContainer.innerHTML = ""; 
    
    product.variations.forEach(variation => {
        addVariationRowUI(variation);
    });
    
    if (mainRecipeContainer) mainRecipeContainer.classList.add("disabled");
    if (recipeList) recipeList.innerHTML = "";
    if (addIngredientBtn) addIngredientBtn.disabled = true;
}else {
        variationToggle.checked = false;
        singlePriceWrapper.classList.remove("hidden");
        variationsWrapper.classList.add("hidden");
        document.getElementById("menu-price").value = product.price;
        variationListContainer.innerHTML = "";
        
        if (mainRecipeContainer) mainRecipeContainer.classList.remove("disabled");
        if (recipeList) recipeList.innerHTML = "";
        if (addIngredientBtn) addIngredientBtn.disabled = false;
        
        const productRecipes = allRecipesCache.filter(r => r.productId === product.id);
        for (const recipeItem of productRecipes) {
            addIngredientRowUI(recipeItem, recipeList); 
        }
    }

    currentImageFile = null; 
    currentImageUrl = product.imageUrl || null; 
    if (menuImagePreview) {
        if (product.imageUrl) {
            menuImagePreview.src = product.imageUrl;
            menuImagePreview.classList.remove("hidden");
        } else {
            menuImagePreview.classList.add("hidden");
            menuImagePreview.src = "";
        }
    }
    // Handle Secondary Stock
    if (product.hasSecondaryStock && product.secondaryStock) {
        secondaryStockToggle.checked = true;
        secondaryStockWrapper.classList.remove("hidden");
        
        const currentVariations = product.variations || [];
        setupSecondaryStockUI(currentVariations, product.secondaryStock);
    } else {
        secondaryStockToggle.checked = false;
        secondaryStockWrapper.classList.add("hidden");
        secondaryStockList.innerHTML = "";
    }
}


// --- Cart Functions ---
function handleProductClick(product) {
    if (product.variations && product.variations.length > 0) {
        openVariationModal(product);
    } else {
        addItemToCart(product);
    }
}

function openVariationModal(product) {
    if (!variationModal || !variationModalTitle || !variationOptionsContainer) return;
    variationModalTitle.textContent = `Select ${product.name} Size`;
    variationOptionsContainer.innerHTML = ""; 
    product.variations.forEach(variation => {
        const button = document.createElement("button");
        button.className = "variation-btn";
        button.innerHTML = `
            ${variation.name}
            <span class="variation-price">₱${variation.price.toFixed(2)}</span>
        `;
        button.onclick = () => addVariationToCart(product, variation);
        variationOptionsContainer.appendChild(button);
    });
    variationModal.style.display = "flex";
}

function addVariationToCart(product, variation) {
    const itemToAdd = {
        ...product,
        id: `${product.id}-${variation.name}`, 
        name: `${product.name} - ${variation.name}`,
        price: variation.price,
        variations: []
    };
    addItemToCart(itemToAdd);
    if (variationModal) variationModal.style.display = "none";
}
async function addItemToCart(item) {
  // Check if adding this item would exceed available stock
  const tempCart = [...cart];
  const existingItem = tempCart.find(i => i.id === item.id);
  
  if (existingItem) {
    existingItem.quantity += 1;
  } else {
    tempCart.push({ ...item, quantity: 1 });
  }
  
  // Validate the temporary cart
  const validation = await validateCartStock(tempCart);
  
  if (!validation.isValid) {
    // Find the specific item that failed
    const failedItem = validation.insufficientItems.find(i => 
      i.productName === item.name
    );
    
    if (failedItem) {
      let warningMsg = `⚠️ Cannot add "${item.name}"!\n\n`;
      warningMsg += `Maximum available: ${failedItem.maxAvailable} order(s)\n\n`;
      warningMsg += `Insufficient ingredients:\n`;
      
      failedItem.insufficientIngredients.forEach(ing => {
        warningMsg += `• ${ing.name}:\n`;
        warningMsg += `  This item needs: ${ing.needed.toFixed(2)} ${ing.unit}\n`;
        warningMsg += `  Total stock: ${ing.available.toFixed(2)} ${ing.unit}\n`;
        if (ing.alreadyReserved && ing.alreadyReserved > 0) {
          warningMsg += `  Already reserved: ${ing.alreadyReserved.toFixed(2)} ${ing.unit}\n`;
          warningMsg += `  Remaining: ${(ing.available - ing.alreadyReserved).toFixed(2)} ${ing.unit}\n`;
        }
      });
      
      alert(warningMsg);
      return; // Don't add to cart
    }
  }
  
  // If validation passes, add to actual cart
  const actualExistingItem = cart.find(i => i.id === item.id);
  if (actualExistingItem) {
    actualExistingItem.quantity += 1;
  } else {
    cart.push({ ...item, quantity: 1 });
  }
  
  updateCartDisplay();
}

function updateCartDisplay() {
  if (!cartItemsContainer) return;
  cartItemsContainer.innerHTML = "";
  if (cart.length === 0) {
    cartItemsContainer.innerHTML = '<p class="empty-cart">Cart is empty</p>';
  }
  cart.forEach(item => {
    const itemEl = document.createElement("div");
    itemEl.className = "cart-item";
    itemEl.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-price">₱${item.price.toFixed(2)}</div>
      </div>
      <div class="cart-item-quantity">
        <button class="qty-btn" data-id="${item.id}" data-change="-1">-</button>
        <span>${item.quantity}</span>
        <button class="qty-btn" data-id="${item.id}" data-change="1">+</button>
      </div>
    `;
    cartItemsContainer.appendChild(itemEl);
  });
  updateCartTotals();
}

async function updateCartQuantity(productId, change) {
  const item = cart.find(item => item.id === productId);
  if (!item) return;
  
  // If increasing quantity, validate first
  if (change > 0) {
    const tempCart = cart.map(cartItem => {
      if (cartItem.id === productId) {
        return { ...cartItem, quantity: cartItem.quantity + change };
      }
      return { ...cartItem };
    });
    
    const validation = await validateCartStock(tempCart);
    
    if (!validation.isValid) {
      const failedItem = validation.insufficientItems.find(i => 
        i.productName === item.name
      );
      
      if (failedItem) {
        let warningMsg = `⚠️ Cannot increase quantity!\n\n`;
        warningMsg += `"${item.name}"\n`;
        warningMsg += `Current: ${item.quantity} | Maximum: ${failedItem.maxAvailable}\n\n`;
        warningMsg += `Insufficient ingredients:\n`;
        
        failedItem.insufficientIngredients.forEach(ing => {
          warningMsg += `• ${ing.name}:\n`;
          warningMsg += `  Needs: ${ing.needed.toFixed(2)} ${ing.unit}\n`;
          warningMsg += `  Available: ${ing.available.toFixed(2)} ${ing.unit}\n`;
          if (ing.alreadyReserved && ing.alreadyReserved > 0) {
            warningMsg += `  Reserved: ${ing.alreadyReserved.toFixed(2)} ${ing.unit}\n`;
            warningMsg += `  Remaining: ${(ing.available - ing.alreadyReserved).toFixed(2)} ${ing.unit}\n`;
          }
        });
        
        alert(warningMsg);
        return; // Don't update
      }
    }
  }
  
  // If validation passes (or decreasing), update quantity
  item.quantity += change;
  if (item.quantity <= 0) {
    cart = cart.filter(cartItem => cartItem.id !== productId);
  }
  
  updateCartDisplay();
}

function updateCartTotals() {
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  let discountAmount = 0;
  if (currentDiscount.type === "PWD" || currentDiscount.type === "Senior") {
    discountAmount = subtotal * 0.20;
  } else if (currentDiscount.type === "Custom" && currentDiscount.percentage) {
    discountAmount = subtotal * (currentDiscount.percentage / 100);
  }
  if (discountAmount > subtotal) {
      discountAmount = subtotal;
  }
  
  // Calculate VAT-inclusive amounts
  const netSubtotal = subtotal - discountAmount;
  const vatable = netSubtotal / 1.12; // Remove VAT to get base amount
  const vatAmount = netSubtotal - vatable; // VAT is the difference
  const total = netSubtotal; // Total is already VAT-inclusive
  
  if (subtotalEl) subtotalEl.textContent = `₱${subtotal.toFixed(2)}`;
  if (cartDiscountEl) {
      let discountText = `(₱${discountAmount.toFixed(2)})`;
      if (currentDiscount.type === "Custom" && currentDiscount.percentage) {
          discountText = `(${currentDiscount.percentage}% - ₱${discountAmount.toFixed(2)})`;
      }
      cartDiscountEl.textContent = discountText;
  }
  if (taxEl) taxEl.textContent = `₱${vatAmount.toFixed(2)}`;
  if (totalEl) totalEl.textContent = `₱${total.toFixed(2)}`;
}
/**
 * Validates that there's enough stock to fulfill all items in the cart
 * Accounts for cumulative ingredient usage across all cart items
 * @param {Array} cart - The current shopping cart
 * @returns {Object} Validation result with isValid flag and details
 */
async function validateCartStock(cart) {
  const validationResult = {
    isValid: true,
    insufficientItems: []
  };
  
  try {
    // Get fresh ingredient data
    const ingredientsSnapshot = await getDocs(ingredientsRef);
    const currentIngredientStock = new Map();
    
    ingredientsSnapshot.forEach(doc => {
      const ingData = doc.data();
      const stockInBase = (ingData.stockQuantity || 0) * (ingData.conversionFactor || 1);
      currentIngredientStock.set(doc.id, {
        name: ingData.name,
        stock: stockInBase,
        unit: ingData.baseUnit
      });
    });
    
    // NEW: Track cumulative ingredient usage across all cart items
    const cumulativeIngredientUsage = new Map();
    
    // First pass: Calculate total ingredient usage for entire cart
    for (const cartItem of cart) {
      const productId = cartItem.id.split('-')[0];
      const productDoc = await getDoc(doc(db, "products", productId));
      
      if (!productDoc.exists()) continue;
      
      const product = productDoc.data();
      let recipeToCheck = [];
      
      // Get the appropriate recipe for this cart item
      if (product.variations && product.variations.length > 0) {
        const variationName = cartItem.name.split(' - ')[1];
        const variation = product.variations.find(v => v.name === variationName);
        
        if (variation && variation.recipe) {
          recipeToCheck = variation.recipe;
          
          // Check if primary recipe can be used
          let canUsePrimary = true;
          for (const recipeItem of recipeToCheck) {
            const ingredient = currentIngredientStock.get(recipeItem.ingredientId);
            const alreadyUsed = cumulativeIngredientUsage.get(recipeItem.ingredientId) || 0;
            const availableStock = ingredient ? (ingredient.stock - alreadyUsed) : 0;
            
            if (availableStock < (recipeItem.qtyPerProduct * cartItem.quantity)) {
              canUsePrimary = false;
              break;
            }
          }
          
          // Switch to secondary if primary doesn't have enough
          if (!canUsePrimary && product.hasSecondaryStock && product.secondaryStock && product.secondaryStock[variationName]) {
            recipeToCheck = product.secondaryStock[variationName];
          }
        }
      } else {
        // Non-variation product
        const productRecipes = allRecipesCache.filter(r => r.productId === productId);
        recipeToCheck = productRecipes;
        
        // Check if primary recipe can be used
        if (recipeToCheck.length > 0) {
          let canUsePrimary = true;
          for (const recipeItem of recipeToCheck) {
            const ingredient = currentIngredientStock.get(recipeItem.ingredientId);
            const alreadyUsed = cumulativeIngredientUsage.get(recipeItem.ingredientId) || 0;
            const availableStock = ingredient ? (ingredient.stock - alreadyUsed) : 0;
            
            if (availableStock < (recipeItem.qtyPerProduct * cartItem.quantity)) {
              canUsePrimary = false;
              break;
            }
          }
          
          // Switch to secondary if primary doesn't have enough
          if (!canUsePrimary && product.hasSecondaryStock && product.secondaryStock && product.secondaryStock.default) {
            recipeToCheck = product.secondaryStock.default;
          }
        }
      }
      
      // Add this item's ingredient usage to cumulative totals
      for (const recipeItem of recipeToCheck) {
        const neededQty = recipeItem.qtyPerProduct * cartItem.quantity;
        const currentUsage = cumulativeIngredientUsage.get(recipeItem.ingredientId) || 0;
        cumulativeIngredientUsage.set(recipeItem.ingredientId, currentUsage + neededQty);
      }
    }
    
    // Second pass: Validate each item and check if total usage exceeds stock
    const ingredientUsageByProduct = new Map(); // Track which products use which ingredients
    
    for (const cartItem of cart) {
      const productId = cartItem.id.split('-')[0];
      const productDoc = await getDoc(doc(db, "products", productId));
      
      if (!productDoc.exists()) continue;
      
      const product = productDoc.data();
      let recipeToCheck = [];
      
      // Get the appropriate recipe (same logic as first pass)
      if (product.variations && product.variations.length > 0) {
        const variationName = cartItem.name.split(' - ')[1];
        const variation = product.variations.find(v => v.name === variationName);
        
        if (variation && variation.recipe) {
          recipeToCheck = variation.recipe;
          
          let canUsePrimary = true;
          const tempUsage = new Map(cumulativeIngredientUsage);
          
          for (const recipeItem of recipeToCheck) {
            const ingredient = currentIngredientStock.get(recipeItem.ingredientId);
            const totalUsed = tempUsage.get(recipeItem.ingredientId) || 0;
            const availableStock = ingredient ? ingredient.stock : 0;
            
            if (availableStock < totalUsed) {
              canUsePrimary = false;
              break;
            }
          }
          
          if (!canUsePrimary && product.hasSecondaryStock && product.secondaryStock && product.secondaryStock[variationName]) {
            recipeToCheck = product.secondaryStock[variationName];
          }
        }
      } else {
        const productRecipes = allRecipesCache.filter(r => r.productId === productId);
        recipeToCheck = productRecipes;
        
        if (recipeToCheck.length > 0) {
          let canUsePrimary = true;
          const tempUsage = new Map(cumulativeIngredientUsage);
          
          for (const recipeItem of recipeToCheck) {
            const ingredient = currentIngredientStock.get(recipeItem.ingredientId);
            const totalUsed = tempUsage.get(recipeItem.ingredientId) || 0;
            const availableStock = ingredient ? ingredient.stock : 0;
            
            if (availableStock < totalUsed) {
              canUsePrimary = false;
              break;
            }
          }
          
          if (!canUsePrimary && product.hasSecondaryStock && product.secondaryStock && product.secondaryStock.default) {
            recipeToCheck = product.secondaryStock.default;
          }
        }
      }
      
      // Validate each ingredient considering cumulative usage
      const insufficientIngredients = [];
      let maxPossibleOrders = Infinity;
      
      for (const recipeItem of recipeToCheck) {
        const ingredient = currentIngredientStock.get(recipeItem.ingredientId);
        
        if (!ingredient) {
          insufficientIngredients.push({
            name: 'Unknown Ingredient',
            needed: recipeItem.qtyPerProduct * cartItem.quantity,
            available: 0,
            unit: recipeItem.unitUsed,
            totalCartUsage: cumulativeIngredientUsage.get(recipeItem.ingredientId) || 0
          });
          maxPossibleOrders = 0;
          continue;
        }
        
        const neededForThisItem = recipeItem.qtyPerProduct * cartItem.quantity;
        const totalNeededInCart = cumulativeIngredientUsage.get(recipeItem.ingredientId) || 0;
        const availableStock = ingredient.stock;
        
        // Check if TOTAL cart usage exceeds available stock
        if (availableStock < totalNeededInCart) {
          insufficientIngredients.push({
            name: ingredient.name,
            needed: neededForThisItem,
            available: availableStock,
            unit: ingredient.unit,
            totalCartUsage: totalNeededInCart,
            alreadyReserved: totalNeededInCart - neededForThisItem
          });
          
          // Calculate max possible orders considering what's already in cart
          const alreadyReserved = totalNeededInCart - neededForThisItem;
          const remainingStock = availableStock - alreadyReserved;
          const possibleOrders = Math.floor(Math.max(0, remainingStock) / recipeItem.qtyPerProduct);
          
          if (possibleOrders < maxPossibleOrders) {
            maxPossibleOrders = possibleOrders;
          }
        } else {
          // Even if sufficient, calculate max possible
          const alreadyReserved = totalNeededInCart - neededForThisItem;
          const remainingStock = availableStock - alreadyReserved;
          const possibleOrders = Math.floor(Math.max(0, remainingStock) / recipeItem.qtyPerProduct);
          
          if (possibleOrders < maxPossibleOrders) {
            maxPossibleOrders = possibleOrders;
          }
        }
      }
      
      if (insufficientIngredients.length > 0) {
        validationResult.isValid = false;
        validationResult.insufficientItems.push({
          productName: cartItem.name,
          requestedQty: cartItem.quantity,
          maxAvailable: Math.max(0, maxPossibleOrders),
          insufficientIngredients: insufficientIngredients
        });
      }
    }
    
  } catch (error) {
    console.error("Error validating cart stock:", error);
    validationResult.isValid = false;
    validationResult.error = error.message;
  }
  
  return validationResult;
}
async function processSale(customerName, orderType, totalAmount, subtotal, tax, paymentDetails, discountInfo) {
  if (processPaymentBtn) {
    processPaymentBtn.disabled = true;
    processPaymentBtn.textContent = "Processing...";
  }
  
  const getAvgWaitTime = (cart) => {
    let maxTime = 0;
    let waitCategory = "short";
    cart.forEach(item => {
        if (item.waitingTime === "medium" && maxTime < 1) maxTime = 1;
        if (item.waitingTime === "long" && maxTime < 2) maxTime = 2;
    });
    if (maxTime === 1) waitCategory = "medium";
    if (maxTime === 2) waitCategory = "long";
    return waitCategory;
  };
  const avgWaitTime = getAvgWaitTime(cart);
  
  try {
    // --- NEW: VALIDATE STOCK BEFORE PROCESSING ---
    const stockValidation = await validateCartStock(cart);
    
if (!stockValidation.isValid) {
      // Show detailed error message
      let errorMessage = "⚠️ Insufficient Stock:\n\n";
      
      stockValidation.insufficientItems.forEach(item => {
        errorMessage += `• ${item.productName}\n`;
        errorMessage += `  Requested: ${item.requestedQty} order(s)\n`;
        errorMessage += `  Maximum available: ${item.maxAvailable} order(s)\n`;
        
        if (item.insufficientIngredients.length > 0) {
          errorMessage += `  Missing ingredients:\n`;
          item.insufficientIngredients.forEach(ing => {
            errorMessage += `    - ${ing.name}:\n`;
            errorMessage += `      This item needs: ${ing.needed.toFixed(2)} ${ing.unit}\n`;
            errorMessage += `      Total stock: ${ing.available.toFixed(2)} ${ing.unit}\n`;
            if (ing.alreadyReserved > 0) {
              errorMessage += `      Already reserved by cart: ${ing.alreadyReserved.toFixed(2)} ${ing.unit}\n`;
              errorMessage += `      Remaining: ${(ing.available - ing.alreadyReserved).toFixed(2)} ${ing.unit}\n`;
            }
          });
        }
        errorMessage += "\n";
      });
      
      errorMessage += "Please adjust the cart quantities or restock ingredients before processing this order.";
      
      alert(errorMessage);
      
      if (processPaymentBtn) {
        processPaymentBtn.disabled = false;
        processPaymentBtn.textContent = "Process Payment";
      }
      return; // Stop processing
    }
    // --- END VALIDATION ---
    
    const orderRef = doc(collection(db, "pending_orders"));
    const orderId = orderRef.id.substring(0, 4).toUpperCase();
    await setDoc(orderRef, { 
      orderId: orderId,
      customerName: customerName,
      orderType: orderType,
      status: "Pending",
      avgWaitTime: avgWaitTime,
      createdAt: serverTimestamp(),
      totalAmount: totalAmount,
      subtotal: subtotal,
      tax: tax,
      discountType: discountInfo.type,
      discountAmount: discountInfo.amount,
      discountPercentage: discountInfo.percentage || null,
      ...paymentDetails,
      items: cart.map(item => ({
        productId: item.id.split('-')[0],
        name: item.name,
        quantity: item.quantity,
        pricePerItem: item.price,
        waitingTime: item.waitingTime,
        isDone: false
      }))
    });
    alert("Order created successfully! Sent to kitchen.");
    cart = [];
    currentDiscount = { type: "none", amount: 0 };
    if (discountTypeSelect) discountTypeSelect.value = "none";
    if (customDiscountWrapper) customDiscountWrapper.classList.add("hidden");
    if (customDiscountAmount) customDiscountAmount.value = "";
    updateCartDisplay();
  } catch (error) {
    console.error("Sale Failed:", error);
    alert(`Sale Failed: ${error.message}`);
  } finally {
    if (processPaymentBtn) {
        processPaymentBtn.disabled = false;
        processPaymentBtn.textContent = "Process Payment";
    }
  }
}

// --- Kitchen / Pending Order Logic ---
function listenForPendingOrders() {
  const q = query(pendingOrdersRef, orderBy("createdAt", "asc"));
  onSnapshot(q, (snapshot) => {
    if (!ordersLine) return;
    ordersLine.innerHTML = "";
    allPendingOrders = [];
    if (snapshot.empty) {
        ordersLine.innerHTML = "<p class='empty-cart'>No pending orders.</p>";
        return;
    }
    snapshot.forEach(doc => {
      const order = { id: doc.id, ...doc.data() };
      allPendingOrders.push(order);
      ordersLine.appendChild(createOrderCard(order));
    });
    checkOverdueStatus();
  }, (error) => {
    console.error("Error listening to pending orders:", error);
    if (ordersLine) ordersLine.innerHTML = "<p class='empty-cart'>Error loading orders.</p>";
  });
}
function checkOverdueStatus() {
  const waitTimes = { short: 5, medium: 10, long: 20 };
  const now = new Date();
  let hasOverdueOrders = false; // Track if any orders are overdue
  
  allPendingOrders.forEach(order => {
    if (order.status !== "Pending" && order.status !== "Preparing") {
        const card = document.querySelector(`.order-card[data-id="${order.id}"]`);
        const dot = card ? card.querySelector('.overdue-dot') : null;
        if (dot) dot.remove(); 
        return; 
    }
    const createdAt = order.createdAt?.toDate();
    if (!createdAt) return;
    const minutesPassed = (now - createdAt) / 60000;
    const isOverdue = order.items.some(item =>
        !item.isDone && minutesPassed > waitTimes[item.waitingTime]
    );
    
    // Update global flag
    if (isOverdue) {
        hasOverdueOrders = true;
    }
    
    const card = document.querySelector(`.order-card[data-id="${order.id}"]`);
    if (card) {
        const dot = card.querySelector('.overdue-dot');
        if (isOverdue && !dot) {
            const newDot = document.createElement('span');
            newDot.className = 'overdue-dot';
            card.appendChild(newDot);
        } else if (!isOverdue && dot) {
            dot.remove();
        }
    }
  });
  
  // Update sidebar alert dot
  const ordersAlertDot = document.getElementById('orders-alert-dot');
  if (ordersAlertDot) {
      ordersAlertDot.style.display = hasOverdueOrders ? 'inline-block' : 'none';
  }
}
function createOrderCard(order) {
  const card = document.createElement("div");
  card.className = "order-card";
  card.dataset.id = order.id;
  const orderStatus = order.status || "Pending";
  const avgTime = order.avgWaitTime || "short";
  const orderId = order.orderId || "----";
  const customerName = order.customerName || "Walk-in";
  let waitClass = "wait-short";
  if (avgTime === "medium") waitClass = "wait-medium";
  if (avgTime === "long") waitClass = "wait-long";
  const totalItems = order.items?.length || 0;
  const doneItems = order.items?.filter(i => i.isDone).length || 0;
  const progressPercent = totalItems > 0 ? (doneItems / totalItems) * 100 : 0;
  const progressWidth = `${Math.max(progressPercent, 5)}%`; 
  card.innerHTML = `
    <div class="order-card-header">
      <span class="order-card-id">#${orderId}</span>
      <span class="order-card-status status-${orderStatus.toLowerCase()}">${orderStatus}</span>
    </div>
    <p class="order-card-customer">${customerName}</p>
    <p class="order-card-wait-info">
      <span class="wait-text ${waitClass}">Wait: ${avgTime}</span>
    </p>
    <div class="progress-bar" title="${doneItems} / ${totalItems} items ready">
      <div class="progress-bar-inner" style="width: ${progressWidth}; background-color: var(--color-blue-500);"></div>
    </div>
  `;
  card.addEventListener("click", () => openOrderDetailsModal(order));
  return card;
}
function openOrderDetailsModal(order) {
  currentOrderDetails = order; 
  document.getElementById("order-modal-title").textContent = `Order #${order.orderId}`;
  document.getElementById("order-modal-customer").textContent = order.customerName;
  document.getElementById("order-modal-type").textContent = order.orderType;
  document.getElementById("order-modal-total").textContent = `₱${order.totalAmount.toFixed(2)}`;
  const waitText = { short: "< 5 min", medium: "5-10 min", long: "15-20 min" };
  const waitValues = { short: 5, medium: 10, long: 20 };
  document.getElementById("order-modal-wait-time").textContent = waitText[order.avgWaitTime] || "N/A";
  const itemList = document.getElementById("order-modal-item-list");
  if (!itemList) return;
  itemList.innerHTML = "";
  if (order.items && Array.isArray(order.items)) {
    order.items.forEach((item, index) => {
      const li = document.createElement("li");
      let itemWaitClass = "wait-short";
      if (item.waitingTime === "medium") itemWaitClass = "wait-medium";
      if (item.waitingTime === "long") itemWaitClass = "wait-long";
      const isPreparing = order.status === "Preparing";
      const isDone = item.isDone || false;
      li.innerHTML = `
        <button class="item-check-btn ${isDone ? 'done' : ''}" 
                data-item-index="${index}" ${!isPreparing || isDone ? 'disabled' : ''}>
            ${isDone ? '✓' : ''}
        </button>
        <span>${item.quantity} x ${item.name}</span>
        <span class="item-wait-time ${itemWaitClass}">${waitText[item.waitingTime]}</span>
      `;
      itemList.appendChild(li);
    });
  }
  const newItemList = itemList.cloneNode(true);
  itemList.parentNode.replaceChild(newItemList, itemList);
  newItemList.addEventListener("click", (e) => {
      if (e.target.classList.contains("item-check-btn")) {
          handleItemCheck(e.target);
      }
  });
  function recalculateProgress() {
    if (!currentOrderDetails || !currentOrderDetails.items || !Array.isArray(currentOrderDetails.items)) return;
    const totalItems = currentOrderDetails.items.length;
    const doneItems = currentOrderDetails.items.filter(i => i.isDone).length;
    const progressPercent = totalItems > 0 ? (doneItems / totalItems) * 100 : 0;
    const itemProgress = document.getElementById("order-modal-item-progress");
    if (itemProgress) itemProgress.style.width = `${progressPercent}%`;
    let maxRemainingTime = 0;
    currentOrderDetails.items.forEach(item => {
        if (!item.isDone) {
            const itemTime = waitValues[item.waitingTime] || 0;
            if (itemTime > maxRemainingTime) maxRemainingTime = itemTime;
        }
    });
    const estimatedEl = document.getElementById("order-modal-estimated-time");
    if (estimatedEl) {
        if (maxRemainingTime === 0 && doneItems === totalItems) {
            estimatedEl.textContent = "All items ready!";
        } else if (maxRemainingTime === 0) {
            estimatedEl.textContent = "N/A";
        } else {
            estimatedEl.textContent = `Est. ${maxRemainingTime} min remaining`;
        }
    }
    const progressBtn = document.getElementById("order-modal-progress-btn");
    if (progressBtn && currentOrderDetails.status === "Preparing") {
        const allDone = currentOrderDetails.items.every(i => i.isDone);
        if (allDone) {
            progressBtn.disabled = false;
            progressBtn.title = "Mark as Ready";
        } else {
            progressBtn.disabled = true;
            progressBtn.title = "Check off all items to mark as ready";
        }
    }
  }
  async function handleItemCheck(button) {
    if (!currentOrderDetails || currentOrderDetails.status !== "Preparing") {
        alert("Order must be marked as 'Preparing' before checking off items."); return;
    }
    if (button.classList.contains('done')) return;
    const itemIndex = parseInt(button.dataset.itemIndex);
    if (isNaN(itemIndex) || !currentOrderDetails.items[itemIndex]) return;
    const item = currentOrderDetails.items[itemIndex];
    item.isDone = true; 
    button.classList.add('done');
    button.innerHTML = '✓';
    button.disabled = true; 
    button.classList.add('disabled');
    try {
        const orderRef = doc(db, "pending_orders", currentOrderDetails.id);
        await updateDoc(orderRef, { items: currentOrderDetails.items });
        recalculateProgress(); 
        checkOverdueStatus(); 
    } catch (error) {
        console.error("Error updating item status:", error);
        item.isDone = false;
        button.classList.remove('done');
        button.innerHTML = '';
        button.disabled = false;
        button.classList.remove('disabled');
        alert("Failed to update item status. Please try again.");
    }
  }
  recalculateProgress(); 
  updateModalProgress(order.status);
  orderDetailsModal.style.display = "flex";
  const paymentMethodRadios = document.querySelectorAll('#order-details-modal input[name="paymentMethod"]');
  const cashDetails = document.getElementById("payment-cash-details");
  paymentMethodRadios.forEach(radio => {
    radio.onchange = () => {
      if (cashDetails) cashDetails.classList.toggle('hidden', radio.value !== 'Cash');
    };
  });
}
function updateModalProgress(status) {
  const statusText = document.getElementById("order-modal-status-text");
  const progressBtn = document.getElementById("order-modal-progress-btn");
  const voidBtn = document.getElementById("order-modal-void-btn");
  const printBtn = document.getElementById("order-modal-print-btn");
  const itemsContainer = document.getElementById("order-modal-items-container");
  if (!statusText || !progressBtn || !voidBtn || !itemsContainer || !printBtn) return;
  statusText.textContent = status;
  statusText.className = `status status-${status.toLowerCase()}`;
  printBtn.style.display = "none";
  if (status === "Pending") {
    progressBtn.textContent = "Mark as Preparing";
    progressBtn.disabled = false;
    voidBtn.disabled = false;
    itemsContainer.classList.remove('hidden'); 
  } else if (status === "Preparing") {
    progressBtn.textContent = "Mark as Ready";
    voidBtn.disabled = true;
    itemsContainer.classList.remove('hidden');
    if (currentOrderDetails && currentOrderDetails.items) {
        const allDone = currentOrderDetails.items.every(i => i.isDone);
        if (allDone) {
            progressBtn.disabled = false;
            progressBtn.title = "Mark as Ready";
        } else {
            progressBtn.disabled = true;
            progressBtn.title = "Check off all items to mark as ready";
        }
    }
} else if (status === "Ready") {
    progressBtn.textContent = "Complete Order";
    progressBtn.disabled = false;
    voidBtn.disabled = true;
    printBtn.style.display = "inline-flex";
    itemsContainer.classList.remove('hidden'); 
  }
}
function updateCheckButtonsState(status) {
    const isPreparing = (status === "Preparing");
    document.querySelectorAll("#order-modal-item-list .item-check-btn").forEach(btn => {
        const isDone = btn.classList.contains('done');
        if (isDone) {
            btn.disabled = true; 
            btn.classList.add('disabled');
        } else if (!isPreparing) {
            btn.disabled = true;
            btn.classList.add('disabled');
        } else {
            btn.disabled = false;
            btn.classList.remove('disabled');
        }
    });
}
/**
 * Prepares order items with their recipes for usage logging
 * @param {object} order - The order object
 * @returns {Array} Array of items with their recipes
 */
async function prepareOrderItemsForUsageLog(order) {
    const orderItemsWithRecipes = [];
    
    if (!order.items || !Array.isArray(order.items)) {
        return orderItemsWithRecipes;
    }
    
    for (const item of order.items) {
        const productDoc = await getDoc(doc(db, "products", item.productId));
        if (!productDoc.exists()) continue;
        
        const product = productDoc.data();
        let recipeToLog = [];
        
        if (product.variations && product.variations.length > 0) {
            // Handle variation products
            const variationName = item.name.split(' - ')[1];
            const variation = product.variations.find(v => v.name === variationName);
            
            if (variation && variation.recipe) {
                // Check if we need to use secondary stock
                let usePrimary = true;
                
                for (const recipeItem of variation.recipe) {
                    const ingDoc = await getDoc(doc(db, "ingredients", recipeItem.ingredientId));
                    if (ingDoc.exists()) {
                        const ingData = ingDoc.data();
                        const currentStock = (ingData.stockQuantity || 0) * (ingData.conversionFactor || 1);
                        const needed = recipeItem.qtyPerProduct * item.quantity;
                        if (currentStock < needed) {
                            usePrimary = false;
                            break;
                        }
                    }
                }
                
                if (usePrimary) {
                    recipeToLog = variation.recipe.map(r => ({
                        ingredientId: r.ingredientId,
                        name: allIngredientsCache.find(ing => ing.id === r.ingredientId)?.name || 'Unknown',
                        quantity: r.qtyPerProduct,
                        unit: r.unitUsed
                    }));
                } else if (product.hasSecondaryStock && product.secondaryStock && product.secondaryStock[variationName]) {
                    recipeToLog = product.secondaryStock[variationName].map(r => ({
                        ingredientId: r.ingredientId,
                        name: allIngredientsCache.find(ing => ing.id === r.ingredientId)?.name || 'Unknown',
                        quantity: r.qtyPerProduct,
                        unit: r.unitUsed
                    }));
                }
            }
        } else {
            // Handle non-variation products
            const productRecipes = allRecipesCache.filter(r => r.productId === item.productId);
            
            if (productRecipes.length > 0) {
                // Check if we need to use secondary stock
                let usePrimary = true;
                
                for (const recipeItem of productRecipes) {
                    const ingDoc = await getDoc(doc(db, "ingredients", recipeItem.ingredientId));
                    if (ingDoc.exists()) {
                        const ingData = ingDoc.data();
                        const currentStock = (ingData.stockQuantity || 0) * (ingData.conversionFactor || 1);
                        const needed = recipeItem.qtyPerProduct * item.quantity;
                        if (currentStock < needed) {
                            usePrimary = false;
                            break;
                        }
                    }
                }
                
                if (usePrimary) {
                    recipeToLog = productRecipes.map(r => ({
                        ingredientId: r.ingredientId,
                        name: allIngredientsCache.find(ing => ing.id === r.ingredientId)?.name || 'Unknown',
                        quantity: r.qtyPerProduct,
                        unit: r.unitUsed
                    }));
                } else if (product.hasSecondaryStock && product.secondaryStock && product.secondaryStock.default) {
                    recipeToLog = product.secondaryStock.default.map(r => ({
                        ingredientId: r.ingredientId,
                        name: allIngredientsCache.find(ing => ing.id === r.ingredientId)?.name || 'Unknown',
                        quantity: r.qtyPerProduct,
                        unit: r.unitUsed
                    }));
                }
            }
        }
        
        if (recipeToLog.length > 0) {
            orderItemsWithRecipes.push({
                name: item.name,
                quantity: item.quantity,
                recipe: recipeToLog
            });
        }
    }
    
    return orderItemsWithRecipes;
}
async function completeOrder(order, paymentDetails) {
  const stockMovements = []; 
  try {
    const allRecipes = []; 
    
if (order.items && Array.isArray(order.items)) {
    for (const item of order.items) { 
        const productDoc = await getDoc(doc(db, "products", item.productId));
        if (!productDoc.exists()) { throw new Error(`Product "${item.name}" not found.`); }
        
        const product = productDoc.data();
        
        // Helper function to check and get available recipe
        const getAvailableRecipe = (primaryRecipe, secondaryRecipe = null) => {
            // Check if primary recipe has stock
            let primaryHasStock = true;
            if (primaryRecipe && primaryRecipe.length > 0) {
                for (const recipeItem of primaryRecipe) {
                    const ingRef = doc(db, "ingredients", recipeItem.ingredientId);
                    const ingredientStockMap = new Map();
                    // We'll validate this during the transaction
                }
            }
            
            return { primaryRecipe, secondaryRecipe };
        };
        
        if (product.variations && product.variations.length > 0) {
            const variationName = item.name.split(' - ')[1];
            const variation = product.variations.find(v => v.name === variationName);
            
            if (!variation || !variation.recipe) { 
                throw new Error(`Recipe not found for variation "${item.name}".`); 
            }
            
            // Get primary recipe
            variation.recipe.forEach(recipeItem => {
                allRecipes.push({ 
                    ...recipeItem, 
                    cartQuantity: item.quantity,
                    isSecondary: false,
                    variationName: variationName
                });
            });
            
            // Store secondary recipe if available
            if (product.hasSecondaryStock && product.secondaryStock && product.secondaryStock[variationName]) {
                product.secondaryStock[variationName].forEach(recipeItem => {
                    allRecipes.push({ 
                        ...recipeItem, 
                        cartQuantity: item.quantity,
                        isSecondary: true,
                        variationName: variationName
                    });
                });
            }
            
        } else {
            const q = query(recipesRef, where("productId", "==", item.productId));
            const recipeSnapshot = await getDocs(q);
            if (recipeSnapshot.empty) { 
                throw new Error(`No recipe found for "${item.name}".`); 
            }
            
            // Get primary recipe
            recipeSnapshot.forEach(recipeDoc => {
                allRecipes.push({ 
                    ...recipeDoc.data(), 
                    cartQuantity: item.quantity,
                    isSecondary: false
                });
            });
            
            // Store secondary recipe if available
            if (product.hasSecondaryStock && product.secondaryStock && product.secondaryStock.default) {
                product.secondaryStock.default.forEach(recipeItem => {
                    allRecipes.push({ 
                        ...recipeItem, 
                        cartQuantity: item.quantity,
                        isSecondary: true
                    });
                });
            }
        }
    }
}

await runTransaction(db, async (transaction) => {
    const ingredientDeductions = new Map();
    const usedSecondaryStock = new Set(); // Track which items used secondary stock
    
    // Group recipes by variation/item
    const recipesByItem = new Map();
    for (const recipe of allRecipes) {
        const key = recipe.variationName || 'default';
        if (!recipesByItem.has(key)) {
            recipesByItem.set(key, { primary: [], secondary: [] });
        }
        if (recipe.isSecondary) {
            recipesByItem.get(key).secondary.push(recipe);
        } else {
            recipesByItem.get(key).primary.push(recipe);
        }
    }
    
    // For each item, try primary first, then secondary if needed
    for (const [itemKey, recipes] of recipesByItem.entries()) {
        let usePrimary = true;
        
        // Check if primary recipe has enough stock
        for (const recipe of recipes.primary) {
            if (recipe.ingredientId && recipe.ingredientId.trim() !== "") {
                const ingRef = doc(db, "ingredients", recipe.ingredientId);
                const ingDoc = await transaction.get(ingRef);
                
                if (ingDoc.exists()) {
                    const ingData = ingDoc.data();
                    const currentStockInBase = (ingData.stockQuantity || 0) * (ingData.conversionFactor || 1);
                    const qtyPer = parseFloat(recipe.qtyPerProduct);
                    const cartQty = parseFloat(recipe.cartQuantity);
                    const totalDeduction = qtyPer * cartQty;
                    
                    if (currentStockInBase < totalDeduction) {
                        usePrimary = false;
                        break;
                    }
                }
            }
        }
        
        // Use secondary if primary doesn't have stock
        const recipesToUse = usePrimary ? recipes.primary : recipes.secondary;
        
        if (!usePrimary && recipes.secondary.length > 0) {
            usedSecondaryStock.add(itemKey);
        }
        
        // Add to deduction map
        for (const recipe of recipesToUse) {
            if (recipe.ingredientId && recipe.ingredientId.trim() !== "") {
                const qtyPer = parseFloat(recipe.qtyPerProduct);
                const cartQty = parseFloat(recipe.cartQuantity);
                const totalDeduction = qtyPer * cartQty;
                const existing = ingredientDeductions.get(recipe.ingredientId) || { amountToDeduction: 0, unit: recipe.unitUsed };
                existing.amountToDeduction += totalDeduction;
                ingredientDeductions.set(recipe.ingredientId, existing);
            }
        }
    }
    
    // Validate and deduct stock
    const ingredientDataMap = new Map();
    for (const [ingId, deduction] of ingredientDeductions.entries()) {
        if (!ingId || typeof ingId !== 'string' || ingId.trim() === "") {
            console.warn("⚠️ Skipping ingredient with invalid ID:", ingId);
            continue;
        }
        const ingRef = doc(db, "ingredients", ingId);
        const ingDoc = await transaction.get(ingRef);
        if (!ingDoc.exists()) { throw new Error(`CRITICAL: Ingredient ${ingId} not found.`); }
        const ingData = ingDoc.data();
        const currentStockInBaseUnits = (ingData.stockQuantity || 0) * (ingData.conversionFactor || 1);
        if (deduction.unit !== ingData.baseUnit) { throw new Error(`Unit mismatch for ${ingData.name}.`); }
        if (currentStockInBaseUnits < deduction.amountToDeduction) { 
            throw new Error(`Not enough stock for ${ingData.name}. Order cannot be completed.`); 
        }
        ingredientDataMap.set(ingId, {
            ref: ingRef,
            data: ingData,
            currentStockInBaseUnits: currentStockInBaseUnits,
            deduction: deduction
        });
    }
    
    // Apply deductions
    for (const [ingId, info] of ingredientDataMap.entries()) {
        const newStockInBaseUnits = info.currentStockInBaseUnits - info.deduction.amountToDeduction;
        const newStockInStockUnits = newStockInBaseUnits / info.data.conversionFactor;
        transaction.update(info.ref, { stockQuantity: newStockInStockUnits });
        
        stockMovements.push({
            timestamp: serverTimestamp(),
            employeeName: order.processedBy || "System",
            actionType: "Sale Deduction",
            itemName: info.data.name,
            category: info.data.category,
            qtyChange: -info.deduction.amountToDeduction,
            unit: info.deduction.unit,
            prevQty: info.currentStockInBaseUnits,
            newQty: newStockInBaseUnits,
            reason: `Sale (Order #${order.orderId})${usedSecondaryStock.size > 0 ? ' [Secondary Stock Used]' : ''}`
        });
    }
    
    const saleRef = doc(db, "sales", order.id); 
    const pendingOrderRef = doc(db, "pending_orders", order.id);
    transaction.set(saleRef, { 
        ...order, 
        ...paymentDetails,
        status: "Completed", 
        completedAt: serverTimestamp(),
        timestamp: order.createdAt,
        usedSecondaryStock: usedSecondaryStock.size > 0 ? Array.from(usedSecondaryStock) : null
    });
    transaction.delete(pendingOrderRef);
});
const logBatch = writeBatch(db);
    stockMovements.forEach(log => logBatch.set(doc(collection(db, "inventoryLogs")), log));
    await logBatch.commit();
    
    // --- LOG INGREDIENT USAGE FOR RESTOCK PREDICTIONS ---
    try {
        const orderItemsWithRecipes = await prepareOrderItemsForUsageLog(order);
        const employeeName = order.processedBy || document.querySelector(".employee-name")?.textContent || "Employee";
        await logIngredientUsage(order.orderId, orderItemsWithRecipes, employeeName);
    } catch (logError) {
        console.error("Warning: Failed to log ingredient usage for predictions:", logError);
        // Don't block the order completion if logging fails
    }
    // --- END USAGE LOGGING ---
    
    alert(`Order #${order.orderId} completed! Stock updated and transaction saved.`);
    if (orderDetailsModal) orderDetailsModal.style.display = "none";
  } catch (error) {
    console.error("Error completing order:", error);
    alert(`Error: ${error.message}`);
  }
}

async function voidOrder(order) {
  const saleRef = doc(db, "sales", order.id);
  const pendingOrderRef = doc(db, "pending_orders", order.id);
  const batch = writeBatch(db);
  batch.set(saleRef, { 
    ...order, 
    status: "Voided", 
    voidedAt: serverTimestamp(),
    timestamp: order.createdAt
  });
  batch.delete(pendingOrderRef);
  try {
    await batch.commit();
    alert(`Order #${order.orderId} has been voided.`);
    if (orderDetailsModal) orderDetailsModal.style.display = "none";
  } catch (error) {
    console.error("Error voiding order:", error);
  }
}
function handleDeleteMenuItem(product) {
  const expectedName = product.name;
  const confirmation = prompt(`To delete this item, please type its exact name: "${expectedName}"`);
  if (confirmation === null) { alert("Deletion canceled."); return; }
  if (confirmation.trim() === expectedName) {
    deleteProductAndRecipe(product.id, product.name);
  } else {
    alert(`Name does not match. Deletion canceled.`);
  }
}
async function deleteProductAndRecipe(productId, productName) {
  if (!productId) { alert("Error: Product ID is missing. Cannot delete."); return; }
  try {
    const batch = writeBatch(db);
    const productRef = doc(db, "products", productId);
    batch.delete(productRef);
    
    const recipesQuery = query(recipesRef, where("productId", "==", productId));
    const recipeSnapshot = await getDocs(recipesQuery);
    if (!recipeSnapshot.empty) {
      recipeSnapshot.forEach(recipeDoc => { batch.delete(recipeDoc.ref); });
    }
    await batch.commit();
    alert(`Product "${productName}" and its recipe have been deleted successfully.`);
  } catch (error) {
    console.error("Error deleting product:", error);
    alert(`Failed to delete product: ${error.message}`);
  }
}
function printReceipt(order) {
    let itemRows = order.items.map(item => {
        const qty = String(item.quantity).padEnd(3);
        let name = item.name;
        if (name.length > 23) name = name.substring(0, 22) + ".";
        name = name.padEnd(23);
        const unitPrice = item.pricePerItem.toFixed(2).padStart(10);
        const amount = (item.quantity * item.pricePerItem).toFixed(2).padStart(10);
        return `${qty}  ${name} ${unitPrice} ${amount}`;
    }).join('\n');
    const netAmount = order.subtotal - (order.discountAmount || 0);
const vatable = netAmount / 1.12;
const vatAmount = netAmount - vatable;

const subtotal = `${'Subtotal:'.padEnd(30)}${order.subtotal.toFixed(2).padStart(10)}`;
const discount = (order.discountAmount && order.discountAmount > 0) ? 
    `${'Discount'.padEnd(20)}${(order.discountPercentage ? `(${order.discountPercentage}%)` : '').padEnd(10)}${('-' + order.discountAmount.toFixed(2)).padStart(10)}` : '';
const vatableSales = `${'Vatable Sales:'.padEnd(30)}${vatable.toFixed(2).padStart(10)}`;
const vat = `${'VAT (12%):'.padEnd(30)}${vatAmount.toFixed(2).padStart(10)}`;
const total = `${'Total Amount:'.padEnd(30)}${order.totalAmount.toFixed(2).padStart(10)}`;
    const dateTime = order.createdAt ? 
                   order.createdAt.toDate().toLocaleString('en-US', {
                       year: 'numeric', month: '2-digit', day: '2-digit', 
                       hour: '2-digit', minute: '2-digit', hour12: true 
                   }) : 
                   new Date().toLocaleString();
    const receiptHTML = `
      <html><head><title>Official Receipt #${order.orderId}</title>
          <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"><\/script>
          <style>
            .receipt-container { font-family: 'Courier New', Courier, monospace; font-size: 10pt; width: 80mm; padding: 5mm; margin: 0; color: #000; background: #fff; }
            body.receipt-body { margin: 0; padding: 0; background: #fff; }
            .center { text-align: center; }
            .line { padding: 0; margin: 5px 0; border-top: 1px dashed #000; }
            .header { font-weight: bold; font-size: 12pt; }
            .info { font-size: 10pt; }
            pre { font-family: 'Courier New', Courier, monospace; font-size: 10pt; margin: 0; padding: 0; white-space: pre-wrap; }
            .totals-line { font-weight: bold; }
            .footer { font-size: 9pt; margin-top: 5px; }
            .bir-info { font-size: 8pt; text-align: center; margin-top: 10px; }
            .button-bar { display: flex; gap: 10px; margin-top: 20px; }
            .print-receipt-btn { flex: 1; padding: 10px; background: #333; color: white; border: none; font-size: 14px; font-weight: bold; cursor: pointer; }
            .download-receipt-btn { flex: 1; padding: 10px; background: #007bff; color: white; border: none; font-size: 14px; font-weight: bold; cursor: pointer; }
            @media print {
              .button-bar { display: none !important; }
              @page { margin: 0; }
              body.receipt-body { background-color: #f0f0f0; display: flex; justify-content: center; align-items: flex-start; padding-top: 20px; }
              .receipt-container { box-shadow: 0 0 10px rgba(0,0,0,0.3); margin: 0; }
            }
          </style></head><body class="receipt-body">
          <div class="receipt-container" id="receipt-container">
            <div class="center"><div class="header">ACACCIA BISTRO CAFE</div><div class="info">Brgy. San Agustin, Alaminos, Laguna</div><div class="info">TIN: 123-456-789-00000</div><div class="info">BIR Permit to Use No: CAS-2025-001</div></div>
            <div class="line"></div><pre>Official Receipt No: ${order.orderId}</pre><pre>Date/Time: ${dateTime}</pre><pre>Cashier: ${order.processedBy || 'Cashier'}</pre><pre>Order Type: ${order.orderType}</pre>
            <div class="line"></div><pre>Qty  Description           Unit Price     Amount</pre><div class="line"></div><pre>${itemRows}</pre><div class="line"></div>
<pre>${subtotal}</pre>${discount ? `<pre>${discount}</pre>` : ''}<div class="line"></div><pre>${vatableSales}</pre><pre>${vat}</pre><div class="line"></div><pre class="totals-line">${total}</pre><div class="line"></div>            <pre>Payment Method: ${order.paymentMethod}</pre><pre>Customer Name:  ${order.customerName}</pre>
            <div class="center footer"><strong>This serves as your OFFICIAL RECEIPT</strong><br>Thank you for dining with us!</div>
            <div class="line"></div><div class="bir-info">POS Provider: CafeSync System v1.0<br>Accredited Developer: Team Cafesync<br>BIR Accreditation No.: CASDEV-2025-045</div><div class="line"></div>
            <br><div class="button-bar"><button class="print-receipt-btn" onclick="window.print()">Print Receipt</button><button class="download-receipt-btn" onclick="downloadAsJpg()">Download JPG</button></div>
          </div> <script>
            function downloadAsJpg() {
              const buttonBar = document.querySelector('.button-bar'); buttonBar.style.display = 'none';
              const receiptElement = document.getElementById('receipt-container');
              html2canvas(receiptElement, { scale: 2, useCORS: true, backgroundColor: '#ffffff' }).then(canvas => {
                const imgData = canvas.toDataURL('image/jpeg', 0.9);
                const link = document.createElement('a'); link.href = imgData;
                link.download = \`receipt-${order.orderId}.jpg\`;
                document.body.appendChild(link); link.click(); document.body.removeChild(link);
                buttonBar.style.display = 'flex';
              });
            } <\/script></body></html>
    `;
    const printWindow = window.open('', '_blank', 'width=350,height=650,resizable=yes,scrollbars=yes');
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(receiptHTML);
        printWindow.document.close();
        printWindow.focus();
    } else {
        alert("Popup blocked. Please allow popups to print the receipt.");
    }
}
function populateKitchenStub(order) {
    if (!kitchenStubContent) return;

    let itemsHTML = '';
    if (order.items && Array.isArray(order.items)) {
        order.items.forEach(item => {
            itemsHTML += `<li><strong>${item.quantity}x</strong> ${item.name}</li>`;
        });
    }

    const stubHTML = `
        <h3 class="stub-header">ORDER #${order.orderId}</h3>
        <p><strong>Customer:</strong> ${order.customerName}</p>
        <p><strong>Type:</strong> ${order.orderType}</p>
        <ul class="stub-item-list">
            ${itemsHTML}
        </ul>
        <p style="text-align: center; font-weight: bold;">${new Date().toLocaleTimeString()}</p>
    `;
    
    kitchenStubContent.innerHTML = stubHTML;
}

// --- Main DOMContentLoaded Listener ---
// This is the *only* DOMContentLoaded listener.
document.addEventListener("DOMContentLoaded", () => {
    // --- ASSIGN ALL ELEMENTS ---
    productGrid = document.getElementById("product-grid");
    cartItemsContainer = document.getElementById("cart-items");
    subtotalEl = document.getElementById("cart-subtotal");
    taxEl = document.getElementById("cart-tax");
    totalEl = document.getElementById("cart-total");
    processPaymentBtn = document.querySelector(".payment-buttons .btn--primary");
    clearCartBtn = document.querySelector(".payment-buttons .btn--secondary");
    editModeBtn = document.getElementById("edit-mode-btn");
    categoryTabsContainer = document.getElementById("category-tabs-container");
    menuImageUpload = document.getElementById("menu-image-upload");
    menuImagePreview = document.getElementById("menu-image-preview");

    addMenuBtn = document.getElementById("add-menu-item-btn");
    cancelMenuBtn = document.getElementById("cancel-menu-btn");
    menuModal = document.getElementById("menu-item-modal");
    menuForm = document.getElementById("menu-item-form");
    recipeList = document.getElementById("recipe-list");
    addIngredientBtn = document.getElementById("add-ingredient-btn");
    menuCategoryDropdown = document.getElementById("menu-category");
    newCategoryInput = document.getElementById("new-category-input");
    menuWaitTimeSelect = document.getElementById("menu-waiting-time");

    variationToggle = document.getElementById("product-variation-toggle");
    singlePriceWrapper = document.getElementById("single-price-wrapper");
    variationsWrapper = document.getElementById("variations-wrapper");
    addVariationBtn = document.getElementById("add-variation-btn");
    variationListContainer = document.getElementById("product-variations-list");

    variationModal = document.getElementById("variation-modal");
    variationModalTitle = document.getElementById("variation-modal-title");
    variationOptionsContainer = document.getElementById("variation-options-container");
    cancelVariationBtn = document.getElementById("cancel-variation-btn");

    customerInfoModal = document.getElementById("customer-info-modal");
    customerInfoForm = document.getElementById("customer-info-form");
    cancelCustomerInfoBtn = document.getElementById("cancel-customer-info-btn");

    orderDetailsModal = document.getElementById("order-details-modal");
    orderModalBackBtn = document.getElementById("order-modal-back-btn");
    orderModalVoidBtn = document.getElementById("order-modal-void-btn");
    orderModalProgressBtn = document.getElementById("order-modal-progress-btn");
    orderModalPrintBtn = document.getElementById("order-modal-print-btn");

    ordersLine = document.getElementById("orders-line");

    discountTypeSelect = document.getElementById("discount-type");
    customDiscountWrapper = document.getElementById("custom-discount-wrapper");
    customDiscountAmount = document.getElementById("custom-discount-amount");
    applyDiscountBtn = document.getElementById("apply-discount-btn");
    cartDiscountEl = document.getElementById("cart-discount");
    
    kitchenStubModal = document.getElementById("kitchen-stub-modal");
    kitchenStubContent = document.getElementById("kitchen-stub-content");
    kitchenStubSendBtn = document.getElementById("kitchen-stub-send-btn");
    kitchenStubCancelBtn = document.getElementById("kitchen-stub-cancel-btn");
    mainRecipeContainer = document.getElementById("main-recipe-container");
    secondaryStockToggle = document.getElementById("secondary-stock-toggle");
    secondaryStockWrapper = document.getElementById("secondary-stock-wrapper");
    secondaryStockList = document.getElementById("secondary-stock-list");
    // --- ATTACH ALL EVENT LISTENERS ---

    // --- Secondary Stock Toggle Listener ---
    if (secondaryStockToggle) {
        secondaryStockToggle.addEventListener("change", () => {
            if (secondaryStockToggle.checked) {
                secondaryStockWrapper.classList.remove("hidden");
                
                // Get current variations or empty array
                const variationContainers = variationListContainer.querySelectorAll(".variation-container");
                const currentVariations = [];
                
                variationContainers.forEach(container => {
                    const varName = container.querySelector(".variation-name").value.trim();
                    if (varName) {
                        currentVariations.push({ name: varName });
                    }
                });
                
                setupSecondaryStockUI(currentVariations);
            } else {
                secondaryStockWrapper.classList.add("hidden");
                secondaryStockList.innerHTML = "";
            }
        });
    }

    // --- Update secondary stock when variations change ---
    if (addVariationBtn) {
        const originalAddVariation = addVariationBtn.onclick;
        addVariationBtn.onclick = function() {
            if (originalAddVariation) originalAddVariation.call(this);
            
            // Update secondary stock UI if enabled
            if (secondaryStockToggle && secondaryStockToggle.checked) {
                setTimeout(() => {
                    const variationContainers = variationListContainer.querySelectorAll(".variation-container");
                    const currentVariations = [];
                    
                    variationContainers.forEach(container => {
                        const varName = container.querySelector(".variation-name").value.trim();
                        if (varName) {
                            currentVariations.push({ name: varName });
                        }
                    });
                    
                    // Preserve existing secondary stock data
                    const existingData = {};
                    const existingContainers = secondaryStockList.querySelectorAll(".secondary-stock-container");
                    existingContainers.forEach(container => {
                        const varName = container.dataset.variationName;
                        const rows = container.querySelectorAll(".ingredient-row");
                        const recipe = [];
                        rows.forEach(row => {
                            recipe.push({
                                ingredientId: row.querySelector(".ingredient-id").value,
                                qtyPerProduct: parseFloat(row.querySelector(".ingredient-qty").value),
                                unitUsed: row.querySelector(".ingredient-unit").value
                            });
                        });
                        if (recipe.length > 0) {
                            existingData[varName] = recipe;
                        }
                    });
                    
                    setupSecondaryStockUI(currentVariations, existingData);
                }, 100);
            }
        };
    }
    // --- Menu Form Submit ---
    if (menuForm) {
        menuForm.addEventListener("submit", handleMenuFormSubmit);
    }

    // --- Image Preview Handler ---
    if (menuImageUpload) {
        menuImageUpload.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (file) {
                currentImageFile = file; 
                const reader = new FileReader();
                reader.onload = (event) => {
                    if (menuImagePreview) {
                        menuImagePreview.src = event.target.result;
                        menuImagePreview.classList.remove("hidden");
                    }
                };
                reader.readAsDataURL(file);
            } else {
                currentImageFile = null;
                if (menuImagePreview) {
                    menuImagePreview.classList.add("hidden");
                    menuImagePreview.src = "";
                }
            }
        });
    }

    // --- Category Dropdown Listener ---
    if (menuCategoryDropdown) {
        menuCategoryDropdown.addEventListener("change", function() {
          if (this.value === "__new__") {
            newCategoryInput.style.display = "block";
            newCategoryInput.focus();
          } else {
            newCategoryInput.style.display = "none";
            newCategoryInput.value = "";
          }
        });
    }

    // --- Main Variation Toggle Listener ---
    if (variationToggle) {
      variationToggle.addEventListener("change", () => {
          const hasVariations = variationToggle.checked;
          if (hasVariations) {
              singlePriceWrapper.classList.add("hidden");
              variationsWrapper.classList.remove("hidden");
              if (variationListContainer.children.length === 0) {
                  addVariationRowUI({}, {}); 
              }
              mainRecipeContainer.classList.add("disabled");
              recipeList.innerHTML = "";
              addIngredientBtn.disabled = true;
          } else {
              singlePriceWrapper.classList.remove("hidden");
              variationsWrapper.classList.add("hidden");
              mainRecipeContainer.classList.remove("disabled");
              addIngredientBtn.disabled = false;
          }
      });
    }
  
    // --- 'addVariationBtn' Listener ---
    if (addVariationBtn) {
        addVariationBtn.addEventListener("click", () => {
            addVariationRowUI({}, {}); 
        });
    }

    // --- 'addIngredientBtn' Listener (for main recipe) ---
    if (addIngredientBtn) {
        addIngredientBtn.addEventListener("click", () => {
            addIngredientRowUI({}, recipeList); 
        });
    }

    // --- Kitchen Stub Modal Listeners ---
    if (kitchenStubCancelBtn) {
        kitchenStubCancelBtn.addEventListener("click", () => {
            if (kitchenStubModal) kitchenStubModal.style.display = "none";
        });
    }

    if (kitchenStubSendBtn) {
        kitchenStubSendBtn.addEventListener("click", async () => {
            if (!currentOrderDetails) return;

            const newStatus = "Preparing";
            kitchenStubSendBtn.disabled = true;
            kitchenStubSendBtn.textContent = "Sending...";

            try {
                const orderRef = doc(db, "pending_orders", currentOrderDetails.id);
                await updateDoc(orderRef, { status: newStatus });
                currentOrderDetails.status = newStatus;
                
                updateModalProgress(newStatus);
                updateCheckButtonsState(newStatus);
                
                kitchenStubModal.style.display = "none";
            } catch (error) {
                console.error("Error updating order status:", error);
                alert("Failed to send to kitchen. Please try again.");
            } finally {
                kitchenStubSendBtn.disabled = false;
                kitchenStubSendBtn.textContent = "Send to Kitchen";
            }
        });
    }
    
    // --- Print Button Listener ---
    if (orderModalPrintBtn) {
      orderModalPrintBtn.addEventListener("click", () => {
        if (currentOrderDetails) {
          printReceipt(currentOrderDetails);
        } else {
          alert("Error: No order details found to print.");
        }
      });
    }

    // --- Add Menu Button (main) ---
    if (addMenuBtn) {
        addMenuBtn.addEventListener("click", async () => {
            closeMenuModal(); // Resets form to default
            if (mainRecipeContainer) mainRecipeContainer.classList.remove("disabled");
            await loadCategories();
            await loadInventoryCategories();
            await loadAllIngredientsCache();
            if (addIngredientBtn) addIngredientBtn.disabled = false;
            if (menuModal) menuModal.style.display = "flex";
        });
    }

    // --- Cancel Menu Modal Button ---
    if (cancelMenuBtn) {
        cancelMenuBtn.addEventListener("click", closeMenuModal);
    }

    // --- Edit Mode Button ---
    if (editModeBtn) {
        editModeBtn.addEventListener("click", () => {
          editMode = !editMode;
          editModeBtn.textContent = editMode ? 'Exit Edit Mode' : 'Edit Menu';
          editModeBtn.classList.toggle('btn--danger', editMode);
          if (addMenuBtn) {
            addMenuBtn.style.display = editMode ? 'none' : 'block';
          }
          renderProducts();
        });
    }

    // --- Cart Listeners ---
    if (cartItemsContainer) {
        cartItemsContainer.addEventListener("click", (e) => {
          if (e.target.classList.contains("qty-btn")) {
            updateCartQuantity(e.target.dataset.id, parseInt(e.target.dataset.change));
          }
        });
    }
    
    if (clearCartBtn) {
        clearCartBtn.addEventListener("click", () => {
          if (cart.length > 0) {
            if (confirm("Clear all items from cart?")) {
              cart = [];
              currentDiscount = { type: "none", amount: 0 };
              if (discountTypeSelect) discountTypeSelect.value = "none";
              if (customDiscountWrapper) customDiscountWrapper.classList.add("hidden");
              if (customDiscountAmount) customDiscountAmount.value = "";
              updateCartDisplay();
            }
          }
        });
    }
    
    // --- Variation Modal (POS) ---
    if (cancelVariationBtn) {
        cancelVariationBtn.addEventListener("click", () => {
            if (variationModal) variationModal.style.display = "none";
        });
    }

    // --- Customer/Payment Modal ---
if (processPaymentBtn) {
    processPaymentBtn.addEventListener("click", () => { 
        if (cart.length === 0) {
            alert("Cart is empty."); 
            return;
        }
        
        // Calculate totals first
        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        let discountAmount = 0;
        if (currentDiscount.type === "PWD" || currentDiscount.type === "Senior") {
            discountAmount = subtotal * 0.20;
        } else if (currentDiscount.type === "Custom" && currentDiscount.percentage) {
            discountAmount = subtotal * (currentDiscount.percentage / 100);
        }
        if (discountAmount > subtotal) {
            discountAmount = subtotal;
        }
        
        const netSubtotal = subtotal - discountAmount;
        const vatable = netSubtotal / 1.12;
        const vatAmount = netSubtotal - vatable;
        const total = netSubtotal;
        
        // Update the modal with the calculated total
        const customerModalTotal = document.getElementById("customer-modal-total");
        if (customerModalTotal) {
            customerModalTotal.textContent = `₱${total.toFixed(2)}`;
        }
        
        // Setup payment method listeners
        const paymentMethodRadios = document.querySelectorAll('#customer-info-modal input[name="paymentMethod"]');
        const cashDetails = document.getElementById("payment-cash-details");
        const paymentAmountInput = document.getElementById("payment-amount");
        const changeDisplay = document.getElementById("payment-change-display");
        
        if (paymentAmountInput) {
            paymentAmountInput.oninput = () => {
                const paid = parseFloat(paymentAmountInput.value) || 0;
                const change = paid - total;
                if (changeDisplay) {
                    if (change >= 0) {
                        changeDisplay.textContent = `₱${change.toFixed(2)}`;
                        changeDisplay.style.color = "var(--color-green-700)";
                    } else {
                        changeDisplay.textContent = `₱${change.toFixed(2)} (Insufficient)`;
                        changeDisplay.style.color = "var(--color-red-500)";
                    }
                }
            };
        }
        
        paymentMethodRadios.forEach(radio => {
            radio.onchange = () => {
                if (cashDetails) {
                    cashDetails.classList.toggle('hidden', radio.value !== 'Cash');
                }
                if (radio.value === 'Cash') {
                    if (paymentAmountInput) {
                        paymentAmountInput.disabled = false;
                        paymentAmountInput.value = '';
                    }
                    if (changeDisplay) {
                        changeDisplay.textContent = '₱0.00';
                    }
                } else {
                    if (paymentAmountInput) {
                        paymentAmountInput.disabled = true;
                        paymentAmountInput.value = '';
                    }
                    if (changeDisplay) {
                        changeDisplay.textContent = '₱0.00';
                    }
                }
            };
        });
        
        // Set default payment method to Cash
        const payCashRadio = document.getElementById('pay-cash');
        if (payCashRadio) {
            payCashRadio.checked = true;
        }
        if (cashDetails) {
            cashDetails.classList.remove('hidden');
        }
        if (paymentAmountInput) {
            paymentAmountInput.disabled = false;
            paymentAmountInput.value = '';
        }
        if (changeDisplay) {
            changeDisplay.textContent = '₱0.00';
            changeDisplay.style.color = "var(--color-text)";
        }
        
        // Open the modal
        if (customerInfoModal) {
            customerInfoModal.style.display = "flex";
        }
        if (customerInfoForm) {
            customerInfoForm.reset();
        }
    });
}
    if (cancelCustomerInfoBtn) {
        cancelCustomerInfoBtn.addEventListener("click", () => {
            if (customerInfoModal) customerInfoModal.style.display = "none";
        });
    }

if (customerInfoForm) {
    customerInfoForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const customerName = document.getElementById("customer-name").value;
      const orderType = document.getElementById("order-type").value;
      const paymentMethodRadio = document.querySelector('#customer-info-modal input[name="paymentMethod"]:checked');
      if (!paymentMethodRadio) { alert("Please select a payment method."); return; }
      const paymentMethod = paymentMethodRadio.value;
      
      const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      let discountAmount = 0;
      if (currentDiscount.type === "PWD" || currentDiscount.type === "Senior") {
        discountAmount = subtotal * 0.20;
      } else if (currentDiscount.type === "Custom" && currentDiscount.percentage) {
        discountAmount = subtotal * (currentDiscount.percentage / 100);
      }
      if (discountAmount > subtotal) discountAmount = subtotal;

      // Calculate VAT-inclusive amounts
      const netSubtotal = subtotal - discountAmount;
      const vatable = netSubtotal / 1.12;
      const vatAmount = netSubtotal - vatable;
      const total = netSubtotal;
      
      let paymentAmount = 0;
      let change = 0;
      if (paymentMethod === 'Cash') {
        paymentAmount = parseFloat(document.getElementById('payment-amount').value);
        if (isNaN(paymentAmount) || paymentAmount < total) {
          alert("Payment amount is insufficient or invalid."); return;
        }
        change = paymentAmount - total;
      } else {
        paymentAmount = total;
        change = 0;
      }
      const paymentDetails = {
        paymentMethod,
        paymentAmount,
        change,
        processedBy: document.querySelector(".employee-name").textContent || "Cashier"
      };
      if (customerInfoModal) customerInfoModal.style.display = "none";
      
      // UPDATE THIS LINE to pass the full discount object
      processSale(customerName, orderType, total, subtotal, vatAmount, paymentDetails, { 
          type: currentDiscount.type, 
          amount: discountAmount,
          percentage: currentDiscount.percentage || null
      });
    });
}

    // --- Order Details Modal (Kitchen) ---
    if (orderModalBackBtn) {
        orderModalBackBtn.addEventListener("click", () => {
          if (orderDetailsModal) orderDetailsModal.style.display = "none";
          currentOrderDetails = null;
        });
    }
    
    if (orderModalProgressBtn) {
        orderModalProgressBtn.addEventListener("click", async () => {
          if (!currentOrderDetails) return;
    
          if (currentOrderDetails.status === "Pending") {
            populateKitchenStub(currentOrderDetails);
            kitchenStubModal.style.display = "flex";
          
          } else if (currentOrderDetails.status === "Preparing") {
            const allDone = currentOrderDetails.items.every(i => i.isDone);
            if (!allDone) { 
              alert("Please check off all items before marking the order as ready."); 
              return; 
            }
            
            const newStatus = "Ready";
            try {
                const orderRef = doc(db, "pending_orders", currentOrderDetails.id);
                await updateDoc(orderRef, { status: newStatus });
                currentOrderDetails.status = newStatus;
                updateModalProgress(newStatus);
                updateCheckButtonsState(newStatus);
            } catch (error) {
                console.error("Error updating order status:", error);
            }
    
          } else if (currentOrderDetails.status === "Ready") {
            await completeOrder(currentOrderDetails);
            return;
          }
        });
    }
    
    if (orderModalVoidBtn) {
        orderModalVoidBtn.addEventListener("click", async () => {
          if (!currentOrderDetails) return;
          if (!confirm(`Are you sure you want to void Order #${currentOrderDetails.orderId}? This cannot be undone.`)) return;
          await voidOrder(currentOrderDetails);
        });
    }

    // --- Discount Listeners (MERGED from the second listener) ---
if (discountTypeSelect) { 
    discountTypeSelect.addEventListener("change", () => {
        const selectedType = discountTypeSelect.value;
        if (selectedType === "Custom") {
            customDiscountWrapper.classList.remove("hidden");
            customDiscountAmount.value = "";
            customDiscountAmount.placeholder = "e.g., 15 (for 15%)";
            applyDiscountBtn.classList.remove("hidden");
        } else {
            customDiscountWrapper.classList.add("hidden");
            customDiscountAmount.value = "";
            if (selectedType === "PWD" || selectedType === "Senior") {
                currentDiscount = { type: selectedType, amount: 0 };
            } else {
                currentDiscount = { type: "none", amount: 0 };
            }
            updateCartTotals();
        }
    });
}

if (applyDiscountBtn) {
    applyDiscountBtn.addEventListener("click", () => {
        const percentage = parseFloat(customDiscountAmount.value);
        if (!isNaN(percentage) && percentage > 0 && percentage <= 100) {
            currentDiscount = { type: "Custom", percentage: percentage };
            updateCartTotals();
            alert(`${percentage}% discount applied successfully!`);
        } else {
            alert("Please enter a valid percentage between 1 and 100.");
        }
    });
}

    // --- Initial Data Loaders ---
    listenForProducts();
    listenForIngredients();
    listenForRecipes();
    listenForPendingOrders();
    setInterval(checkOverdueStatus, 30000); 

});