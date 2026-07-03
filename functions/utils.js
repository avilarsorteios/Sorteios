const admin = require("firebase-admin");

/**
 * Generates an array of unique random 6-digit numbers (100000-999999).
 * @param {number} quantity - How many unique numbers to generate.
 * @returns {string[]} Array of 6-digit number strings.
 */
function generateUniqueNumbers(quantity) {
  if (quantity < 1 || quantity > 900000) {
    throw new Error("Quantity must be between 1 and 900000");
  }

  const numbers = new Set();
  while (numbers.size < quantity) {
    const num = Math.floor(Math.random() * 900000) + 100000;
    numbers.add(num.toString());
  }
  return Array.from(numbers);
}

/**
 * Calculates the meta (goal) value: cost * 2.
 * @param {number} cost - The prize cost.
 * @returns {number} The meta value.
 */
function calculateMeta(cost) {
  return cost * 2;
}

/**
 * Calculates the value per number: meta / quantity, rounded to 2 decimals.
 * @param {number} meta - The meta (goal) value.
 * @param {number} quantity - Total number of tickets.
 * @returns {number} Price per number.
 */
function calculateNumberValue(meta, quantity) {
  return parseFloat((meta / quantity).toFixed(2));
}

/**
 * Checks if a user has admin role in Firestore.
 * @param {string} uid - The user's UID.
 * @returns {Promise<boolean>} True if user is admin.
 */
async function isAdmin(uid) {
  if (!uid) return false;

  // Check config collection for adminUids array
  const configDoc = await admin.firestore().collection("config").doc("general").get();
  if (configDoc.exists) {
    const data = configDoc.data();
    if (data.adminUids && Array.isArray(data.adminUids) && data.adminUids.includes(uid)) {
      return true;
    }
  }

  // Also check the user document for role field
  const userDoc = await admin.firestore().collection("users").doc(uid).get();
  if (userDoc.exists && userDoc.data().role === "admin") {
    return true;
  }

  return false;
}

/**
 * Picks one random winner from an array of sold numbers.
 * @param {Array<{number: string, userId: string}>} soldNumbers - Array of sold number objects.
 * @returns {{number: string, userId: string}} The winning number object.
 */
function generateDrawWinner(soldNumbers) {
  if (!soldNumbers || soldNumbers.length === 0) {
    throw new Error("No sold numbers available for draw");
  }
  const winnerIndex = Math.floor(Math.random() * soldNumbers.length);
  return soldNumbers[winnerIndex];
}

module.exports = {
  generateUniqueNumbers,
  calculateMeta,
  calculateNumberValue,
  isAdmin,
  generateDrawWinner,
};
