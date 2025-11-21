// scripts/ingredient-usage-logger.js
import { db } from './firebase.js';
import {
    collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const usageLogsRef = collection(db, "ingredientUsageLogs");

/**
 * Logs ingredient usage when an order is completed.
 * Call this function from your POS system when an order is marked as complete.
 * 
 * @param {string} orderId - The order ID
 * @param {Array} orderItems - Array of items in the order, each with recipe info
 * @param {string} employeeName - Name of the employee processing the order
 */
export async function logIngredientUsage(orderId, orderItems, employeeName) {
    try {
        const logsToCreate = [];
        
        for (const item of orderItems) {
            // item should have: name, quantity, recipe (array of ingredients)
            if (!item.recipe || !Array.isArray(item.recipe)) {
                continue; // Skip items without recipes
            }
            
            const itemQuantity = item.quantity || 1;
            
            for (const ingredient of item.recipe) {
                // ingredient should have: ingredientId, name, quantity, unit
                const usageQuantity = (ingredient.quantity || 0) * itemQuantity;
                
                if (usageQuantity <= 0) continue;
                
                logsToCreate.push({
                    ingredientId: ingredient.ingredientId || ingredient.id,
                    ingredientName: ingredient.name || 'Unknown',
                    quantityUsed: usageQuantity,
                    unit: ingredient.unit || 'units',
                    usedFor: item.name || 'Unknown Item',
                    orderId: orderId,
                    employeeName: employeeName || 'System',
                    timestamp: serverTimestamp(),
                    usageType: 'sale'
                });
            }
        }
        
        // Batch create all logs
        const promises = logsToCreate.map(log => addDoc(usageLogsRef, log));
        await Promise.all(promises);
        
        console.log(`✅ Logged ${logsToCreate.length} ingredient usage entries for order ${orderId}`);
        return true;
        
    } catch (error) {
        console.error("❌ Error logging ingredient usage:", error);
        return false;
    }
}

/**
 * Manually log ingredient usage (for waste, adjustments, etc.)
 * 
 * @param {Object} params - Usage parameters
 */
export async function logManualUsage({
    ingredientId,
    ingredientName,
    quantityUsed,
    unit,
    reason,
    employeeName,
    usageType = 'manual'
}) {
    try {
        await addDoc(usageLogsRef, {
            ingredientId,
            ingredientName,
            quantityUsed,
            unit,
            usedFor: reason || 'Manual adjustment',
            orderId: null,
            employeeName: employeeName || 'System',
            timestamp: serverTimestamp(),
            usageType
        });
        
        console.log(`✅ Logged manual usage for ${ingredientName}`);
        return true;
        
    } catch (error) {
        console.error("❌ Error logging manual usage:", error);
        return false;
    }
}