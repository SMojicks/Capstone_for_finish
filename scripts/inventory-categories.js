// scripts/inventory-categories.js
import { db } from './firebase.js';
import { 
    doc, getDoc, setDoc, arrayUnion, arrayRemove, 
    collection, query, where, getDocs, writeBatch 
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Reference to the Firestore document that stores the category list
const invCategoriesRef = doc(db, "settings", "inventoryCategories");
// Reference to the ingredients collection
const ingredientsRef = collection(db, "ingredients");

// --- DOM Elements ---
let manageBtn, modal, closeBtn, addBtn, newCategoryInput, categoryListTbody, ingredientCategoryDropdown, posIngredientFilterDropdown, addCategoryForm;

let allInvCategories = [];

// --- Load categories from Firestore ---
async function loadCategories() {
    try {
        const docSnap = await getDoc(invCategoriesRef);
        if (docSnap.exists()) {
            allInvCategories = docSnap.data().list.sort() || [];
        } else {
            // If it doesn't exist, create it
            await setDoc(invCategoriesRef, { list: [] });
            allInvCategories = [];
        }
    } catch (error) {
        console.error("Error loading inventory categories:", error);
    }
    
    populateCategoryTable();
    populateDropdowns();
}

// --- Populate the table in the "Manage" modal ---
function populateCategoryTable() {
    if (!categoryListTbody) return;
    categoryListTbody.innerHTML = "";
    if (allInvCategories.length === 0) {
        categoryListTbody.innerHTML = "<tr><td colspan='2' style='text-align: center;'>No categories created yet.</td></tr>";
        return;
    }
    
    allInvCategories.forEach(category => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${category}</td>
            <td class="actions-cell" style="text-align: right;">
                <button class="btn-icon btn--icon-edit edit-cat-btn" data-category="${category}" title="Edit Category">✎</button>
                <button class="btn-icon btn--icon-delete delete-cat-btn" data-category="${category}" title="Delete Category">🗑</button>
            </td>
        `;
        categoryListTbody.appendChild(row);
    });
}

// --- Populate dropdowns in other modals ---
function populateDropdowns() {
    // 1. For the "Add Ingredient" modal
    ingredientCategoryDropdown = document.getElementById("product-category-dropdown");
    if (ingredientCategoryDropdown) {
        ingredientCategoryDropdown.innerHTML = `<option value="">Select category...</option>`;
        allInvCategories.forEach(category => {
            ingredientCategoryDropdown.add(new Option(category, category));
        });
    }
    
    // 2. For the "Add Menu Item" (POS) recipe filter
    posIngredientFilterDropdown = document.getElementById("ingredient-category-filter");
    if (posIngredientFilterDropdown) {
        posIngredientFilterDropdown.innerHTML = `<option value="">All Inventory Categories</option>`;
        allInvCategories.forEach(category => {
            posIngredientFilterDropdown.add(new Option(category, category));
        });
    }
}

// --- Add a new category ---
async function addCategory(event) {
    if(event) event.preventDefault(); // Prevent form submission
    
    const newCategory = newCategoryInput.value.trim();
    if (!newCategory) {
        alert("Please enter a category name.");
        return;
    }
    if (allInvCategories.includes(newCategory)) {
        alert("This category already exists.");
        return;
    }

    try {
        await setDoc(invCategoriesRef, { list: arrayUnion(newCategory) }, { merge: true });
        newCategoryInput.value = "";
        await loadCategories(); // Reload
    } catch (error) {
        console.error("Error adding category:", error);
    }
}

// --- Delete a category (and update ingredients) ---
async function deleteCategory(categoryName) {
    if (!confirm(`Are you sure you want to delete "${categoryName}"? This will remove the category from all ingredients using it. This cannot be undone.`)) {
        return;
    }
    
    try {
        // 1. Remove category from the settings list
        await setDoc(invCategoriesRef, { list: arrayRemove(categoryName) }, { merge: true });
        
        // 2. Batch update all ingredients using this category
        const batch = writeBatch(db);
        const q = query(ingredientsRef, where("category", "==", categoryName));
        const snapshot = await getDocs(q);
        
        snapshot.forEach(doc => {
            batch.update(doc.ref, { category: "" }); // Set to uncategorized
        });
        
        await batch.commit();
        
        // 3. Reload everything
        await loadCategories(); 
        alert(`Category "${categoryName}" deleted and ingredients updated.`);
    } catch (error) {
        console.error("Error deleting category:", error);
        alert(`Error deleting category: ${error.message}`);
    }
}

// --- NEW: Edit a category (and update ingredients) ---
async function editCategory(oldName) {
    const newName = prompt(`Enter a new name for "${oldName}":`, oldName);
    
    if (!newName || newName.trim() === "") {
        alert("Edit canceled: Name cannot be empty.");
        return;
    }
    
    const trimmedNewName = newName.trim();
    
    if (trimmedNewName === oldName) {
        return; // No change
    }
    
    if (allInvCategories.includes(trimmedNewName)) {
        alert(`Error: The category "${trimmedNewName}" already exists.`);
        return;
    }
    
    if (!confirm(`This will rename "${oldName}" to "${trimmedNewName}" and update all associated ingredients. Continue?`)) {
        return;
    }
    
    try {
        // 1. Update the category list in settings
        const docSnap = await getDoc(invCategoriesRef);
        let currentList = docSnap.data().list || [];
        const index = currentList.indexOf(oldName);
        
        if (index > -1) {
            currentList[index] = trimmedNewName; // Replace old name with new
            await setDoc(invCategoriesRef, { list: currentList });
        } else {
            throw new Error("Category not found in list.");
        }
        
        // 2. Batch update all ingredients using the old category
        const batch = writeBatch(db);
        const q = query(ingredientsRef, where("category", "==", oldName));
        const snapshot = await getDocs(q);
        
        snapshot.forEach(doc => {
            batch.update(doc.ref, { category: trimmedNewName }); // Set to new name
        });
        
        await batch.commit();
        
        // 3. Reload everything
        await loadCategories();
        alert(`Category "${oldName}" successfully renamed to "${trimmedNewName}".`);
        
    } catch (error) {
        console.error("Error editing category:", error);
        alert(`Error editing category: ${error.message}`);
    }
}


// --- Event Listeners ---
document.addEventListener("DOMContentLoaded", () => {
    // Assign elements
    manageBtn = document.getElementById("manage-categories-btn");
    modal = document.getElementById("inventory-category-modal");
    closeBtn = document.getElementById("close-inv-category-btn");
    addBtn = document.getElementById("add-inv-category-btn");
    addCategoryForm = document.getElementById("add-inv-category-form");
    newCategoryInput = document.getElementById("new-inv-category-name");
    categoryListTbody = document.getElementById("existing-inv-categories-tbody"); // <-- Changed ID

    if (manageBtn) {
        manageBtn.addEventListener("click", () => {
            loadCategories(); // Always get fresh data
            if(modal) modal.style.display = "flex";
        });
    }
    
    if (closeBtn) closeBtn.addEventListener("click", () => modal.style.display = "none");
    
    // Listen to form submit event
    if (addCategoryForm) addCategoryForm.addEventListener("submit", addCategory);
    
    if (categoryListTbody) {
        categoryListTbody.addEventListener("click", (e) => {
            const targetButton = e.target.closest('button');
            if (!targetButton) return; // Click wasn't on a button

            if (targetButton.classList.contains("delete-cat-btn")) {
                deleteCategory(targetButton.dataset.category);
            }
            if (targetButton.classList.contains("edit-cat-btn")) {
                editCategory(targetButton.dataset.category);
            }
        });
    }
    
    // Load once on page load to populate dropdowns
    loadCategories();
});