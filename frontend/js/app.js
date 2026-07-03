/**
 * app.js - Shared Utility Functions
 * Common helpers used across all pages: loader, toasts, auth guards,
 * formatting, tabs, and navigation.
 */

// ============ Loader ============

/**
 * Show full-screen loading overlay
 */
function showLoader() {
  document.getElementById('loader')?.classList.add('active');
}

/**
 * Hide full-screen loading overlay
 */
function hideLoader() {
  document.getElementById('loader')?.classList.remove('active');
}

// ============ Toast Notifications ============

/**
 * Show a toast notification message
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - Auto-dismiss after ms (default 4000)
 */
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');

  // Create container if it doesn't exist
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);

  // Auto-dismiss
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============ Auth State Helpers ============

/**
 * Observe auth state changes with callbacks
 * @param {Function} onLoggedIn - Called with user object when authenticated
 * @param {Function} onLoggedOut - Called when not authenticated
 */
function observeAuthState(onLoggedIn, onLoggedOut) {
  auth.onAuthStateChanged(user => {
    if (user) {
      onLoggedIn(user);
    } else if (onLoggedOut) {
      onLoggedOut();
    }
  });
}

/**
 * Require authentication - redirect to login if not signed in
 */
function requireAuth() {
  auth.onAuthStateChanged(user => {
    if (!user) {
      const base = window.location.pathname.includes('/user/') || window.location.pathname.includes('/admin/') ? '../' : '';
      window.location.href = base + 'login.html';
    }
  });
}

/**
 * Require admin role - redirect if not admin
 */
function requireAdmin() {
  auth.onAuthStateChanged(async user => {
    if (!user) {
      const base = window.location.pathname.includes('/admin/') ? '../' : '';
      window.location.href = base + 'login.html';
      return;
    }
    const doc = await db.collection('users').doc(user.uid).get();
    if (!doc.exists || doc.data().role !== 'admin') {
      const base = window.location.pathname.includes('/admin/') ? '../' : '';
      window.location.href = base + 'user/dashboard.html';
    }
  });
}

// ============ Formatting ============

/**
 * Format a value as Brazilian Real currency
 * @param {number} value - Numeric value
 * @returns {string} Formatted string like "R$ 1.234,56"
 */
function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

/**
 * Format a number as a 6-digit string with leading zeros
 * @param {number|string} num - The number to format
 * @returns {string} 6-digit padded string
 */
function formatNumber(num) {
  return String(num).padStart(6, '0');
}

// ============ Tabs ============

/**
 * Initialize tab switching behavior for .tab-btn elements
 */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      // Deactivate all tabs and contents
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      // Activate selected tab and content
      btn.classList.add('active');
      document.getElementById(target)?.classList.add('active');
    });
  });
}

// ============ Navigation ============

/**
 * Logout the current user and redirect to home
 */
function logout() {
  auth.signOut().then(() => {
    const base = window.location.pathname.includes('/user/') || window.location.pathname.includes('/admin/') ? '../' : '';
    window.location.href = base + 'index.html';
  });
}

/**
 * Toggle sidebar visibility on mobile
 */
function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
}

// ============ Misc Utilities ============

/**
 * Copy text to clipboard with toast feedback
 * @param {string} text - Text to copy
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copiado!', 'success', 2000);
  } catch {
    showToast('Erro ao copiar.', 'error');
  }
}

/**
 * Format a Firestore timestamp or Date as localized date string
 * @param {Object|Date} timestamp - Firestore timestamp or JS Date
 * @returns {string} Formatted date string
 */
function formatDate(timestamp) {
  if (!timestamp) return '-';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString('pt-BR');
}

/**
 * Debounce utility - delays function execution until after wait ms
 * @param {Function} fn - Function to debounce
 * @param {number} wait - Delay in ms
 */
function debounce(fn, wait = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}
