// scripts/menu.js
import { db } from "./firebase.js";
import {
  collection,
  query,
  where,
  getDocs,
  orderBy
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Global cache
let allProducts = [];
let allCategories = new Set();
let currentActiveTab = null;

// DOM Elements
let sidebar, contentArea;

/**
 * Main function to load and render the entire menu
 */
async function loadDynamicMenu() {
    sidebar = document.getElementById('menu-categories-sidebar');
    contentArea = document.getElementById('menu-content-area');

    if (!sidebar || !contentArea) {
        console.error("Menu components not found on page.");
        return;
    }

    try {
        // 1. Fetch all visible products from Firestore
        const productsRef = collection(db, "products");
        const q = query(productsRef, where("isVisible", "==", true), orderBy("category"), orderBy("name"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            contentArea.innerHTML = "<h2 class='content-title'>Menu</h2><p>Our menu is currently being updated. Please check back soon!</p>";
            return;
        }

        allProducts = [];
        allCategories.clear();
        
        snapshot.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            allProducts.push(product);
            allCategories.add(product.category);
        });

        // 2. Render the category tabs
        renderCategoryTabs();

        // 3. Render the menu items for "All" by default
        renderMenuItems('All');

    } catch (error) {
        console.error("Error loading dynamic menu:", error);
        contentArea.innerHTML = "<h2 class='content-title'>Error</h2><p>Could not load the menu. Please try again later.</p>";
    }
}

/**
 * Populates the sidebar with category tabs
 */
function renderCategoryTabs() {
    // Clear old tabs, keep the <h2>Menu</h2> title
    const existingTabs = sidebar.querySelectorAll('.tab');
    existingTabs.forEach(tab => tab.remove());

    // Add "All" tab
    const allTab = createTab("All");
    allTab.classList.add('active');
    currentActiveTab = allTab;
    sidebar.appendChild(allTab);

    // Add tabs for each unique category
    Array.from(allCategories).sort().forEach(category => {
        sidebar.appendChild(createTab(category));
    });
}

/**
 * Helper to create a single category tab
 */
function createTab(categoryName) {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.textContent = categoryName;
    tab.dataset.category = categoryName;

    tab.addEventListener('click', () => {
        if (currentActiveTab) {
            currentActiveTab.classList.remove('active');
        }
        tab.classList.add('active');
        currentActiveTab = tab;
        renderMenuItems(categoryName);
    });
    return tab;
}

/**
 * Renders the food items for the selected category
 */
function renderMenuItems(categoryName) {
    contentArea.innerHTML = ""; // Clear content area

    const categoriesToRender = (categoryName === 'All')
        ? Array.from(allCategories).sort()
        : [categoryName];
    
    if (categoriesToRender.length === 0) {
        contentArea.innerHTML = "<h2 class='content-title'>Menu</h2><p>No items found in this category.</p>";
        return;
    }

    // Loop through each category and create a section for it
    categoriesToRender.forEach(category => {
        const productsInCategory = allProducts.filter(p => p.category === category);
        
        if (productsInCategory.length > 0) {
            // Create title
            const title = document.createElement('h2');
            title.className = 'content-title';
            title.textContent = category;
            contentArea.appendChild(title);

            // Create grid
            const grid = document.createElement('div');
            grid.className = 'food-grid';
            
            // Create and add food items
            productsInCategory.forEach(product => {
                grid.appendChild(createFoodItemCard(product));
            });
            
            contentArea.appendChild(grid);
        }
    });
}

/**
 * Creates the HTML for a single food item card
 */
function createFoodItemCard(product) {
    const item = document.createElement('div');
    item.className = 'food-item';

    // 1. Image
    const img = document.createElement('img');
    img.src = product.imageUrl || 'assets/sandwich-1.jpg'; // Use a default image
    img.alt = product.name;
    item.appendChild(img);

    // 2. Info container
    const info = document.createElement('div');
    info.className = 'food-info';

    // 3. Name
    const name = document.createElement('h3');
    name.textContent = product.name;
    info.appendChild(name);

    // 4. Price/Variations
    const priceContainer = document.createElement('div');
    priceContainer.className = 'price-container'; // Use this for styling

    if (product.variations && product.variations.length > 0) {
        // It has variations, list them
        const priceList = document.createElement('div');
        priceList.className = 'price-list';
        
        product.variations.forEach(v => {
            const variationEl = document.createElement('div');
            variationEl.className = 'price-list-item';
            variationEl.innerHTML = `
                <span>${v.name}</span>
                <strong>₱${v.price.toFixed(2)}</strong>
            `;
            priceList.appendChild(variationEl);
        });
        priceContainer.appendChild(priceList);

    } else {
        // No variations, show single price
        const price = document.createElement('div');
        price.className = 'price';
        price.textContent = `₱${product.price.toFixed(2)}`;
        priceContainer.appendChild(price);
    }
    
    info.appendChild(priceContainer);
    item.appendChild(info);
    
    return item;
}


// --- Run the script on page load ---
document.addEventListener("DOMContentLoaded", loadDynamicMenu);