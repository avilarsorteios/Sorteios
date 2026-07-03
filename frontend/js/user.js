/**
 * user.js - User Panel Logic
 * Handles loading active lotes, user participations,
 * purchase history, notifications, and navigation.
 */

// ============ State ============
let currentUser = null;
let userProfile = null;

// ============ Initialization ============

document.addEventListener('DOMContentLoaded', () => {
  requireAuth();
  observeAuthState(onUserReady, () => {
    window.location.href = '/login.html';
  });
  initTabs();
});

/**
 * Called when user is authenticated and ready
 */
async function onUserReady(user) {
  currentUser = user;
  showLoader();

  try {
    // Load user profile from Firestore
    const profileDoc = await db.collection('users').doc(user.uid).get();
    userProfile = profileDoc.exists ? profileDoc.data() : {};

    // Update UI with user info
    displayUserInfo();

    // Load all dashboard data in parallel
    await Promise.all([
      loadActiveLotes(),
      loadMyParticipations(),
      loadPurchaseHistory(),
      loadNotifications()
    ]);
  } catch (error) {
    showToast('Erro ao carregar dados. Tente novamente.', 'error');
    console.error('User init error:', error);
  } finally {
    hideLoader();
  }
}

/**
 * Display user name and avatar in the sidebar/header
 */
function displayUserInfo() {
  const nameEl = document.getElementById('user-name');
  const emailEl = document.getElementById('user-email');

  if (nameEl) nameEl.textContent = userProfile.name || currentUser.displayName || 'Usuario';
  if (emailEl) emailEl.textContent = currentUser.email;
}

// ============ Active Lotes ============

/**
 * Load all active (open) lotes and render as cards
 */
async function loadActiveLotes() {
  const container = document.getElementById('lotes-container');
  if (!container) return;

  const snapshot = await db.collection('lotes')
    .where('status', '==', 'active')
    .orderBy('createdAt', 'desc')
    .get();

  if (snapshot.empty) {
    container.innerHTML = '<p class="text-muted text-center">Nenhum sorteio ativo no momento.</p>';
    return;
  }

  container.innerHTML = '';
  snapshot.forEach(doc => {
    const lote = { id: doc.id, ...doc.data() };
    container.innerHTML += renderLoteCard(lote);
  });
}

/**
 * Render a lote card with progress bar
 */
function renderLoteCard(lote) {
  const soldCount = lote.soldCount || 0;
  const totalCount = lote.totalNumbers || 0;
  const percentage = totalCount > 0 ? Math.round((soldCount / totalCount) * 100) : 0;

  return `
    <div class="card" onclick="navigateToLote('${lote.id}')">
      <div class="card-header">
        <h3 class="card-title">${lote.name}</h3>
        <span class="badge badge-success">${lote.status}</span>
      </div>
      <p class="text-muted mb-1">${lote.description || ''}</p>
      <p class="mb-1"><strong>Premio:</strong> ${formatBRL(lote.prize || 0)}</p>
      <p class="mb-1"><strong>Valor por numero:</strong> ${formatBRL(lote.numberValue || 0)}</p>
      <div class="progress-container progress-sm mt-2">
        <div class="progress-bar" style="width: ${percentage}%">${percentage}%</div>
      </div>
      <p class="text-muted mt-1" style="font-size:0.8rem">${soldCount}/${totalCount} numeros vendidos</p>
    </div>
  `;
}

/**
 * Navigate to the purchase page for a specific lote
 */
function navigateToLote(loteId) {
  window.location.href = `/compra.html?lote=${loteId}`;
}

// ============ My Participations (Meus Sorteios) ============

/**
 * Load lotes where the current user owns numbers
 */
async function loadMyParticipations() {
  const container = document.getElementById('participations-container');
  if (!container) return;

  const snapshot = await db.collection('purchases')
    .where('userId', '==', currentUser.uid)
    .where('status', '==', 'confirmed')
    .orderBy('createdAt', 'desc')
    .get();

  if (snapshot.empty) {
    container.innerHTML = '<p class="text-muted text-center">Voce ainda nao participa de nenhum sorteio.</p>';
    return;
  }

  // Group purchases by lote
  const loteMap = {};
  snapshot.forEach(doc => {
    const purchase = doc.data();
    if (!loteMap[purchase.loteId]) {
      loteMap[purchase.loteId] = { numbers: [], loteName: purchase.loteName || '' };
    }
    loteMap[purchase.loteId].numbers.push(...(purchase.numbers || []));
  });

  container.innerHTML = '';
  for (const [loteId, data] of Object.entries(loteMap)) {
    container.innerHTML += `
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">${data.loteName || loteId}</h3>
          <span class="badge badge-info">${data.numbers.length} numero(s)</span>
        </div>
        <p class="text-muted">Seus numeros:</p>
        <div class="flex gap-1" style="flex-wrap:wrap; margin-top:0.5rem">
          ${data.numbers.map(n => `<span class="badge badge-info">${n}</span>`).join('')}
        </div>
        <button class="btn btn-secondary btn-sm mt-2" onclick="navigateToLote('${loteId}')">
          Ver Sorteio
        </button>
      </div>
    `;
  }
}

// ============ Purchase History ============

/**
 * Load all purchases (confirmed and pending) for the current user
 */
async function loadPurchaseHistory() {
  const container = document.getElementById('history-container');
  if (!container) return;

  const snapshot = await db.collection('purchases')
    .where('userId', '==', currentUser.uid)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  if (snapshot.empty) {
    container.innerHTML = '<p class="text-muted text-center">Nenhuma compra realizada.</p>';
    return;
  }

  let html = `
    <div class="table-container">
      <table class="table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Sorteio</th>
            <th>Numeros</th>
            <th>Valor</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
  `;

  snapshot.forEach(doc => {
    const p = doc.data();
    const date = p.createdAt?.toDate?.()
      ? p.createdAt.toDate().toLocaleDateString('pt-BR')
      : '-';
    const statusClass = p.status === 'confirmed' ? 'badge-success'
      : p.status === 'pending' ? 'badge-warning' : 'badge-danger';

    html += `
      <tr>
        <td>${date}</td>
        <td>${p.loteName || p.loteId}</td>
        <td>${(p.numbers || []).length} numero(s)</td>
        <td>${formatBRL(p.totalValue || 0)}</td>
        <td><span class="badge ${statusClass}">${p.status}</span></td>
      </tr>
    `;
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
}

// ============ Notifications ============

/**
 * Load notifications for the current user
 */
async function loadNotifications() {
  const container = document.getElementById('notifications-container');
  const badgeEl = document.getElementById('notifications-badge');
  if (!container) return;

  const snapshot = await db.collection('notifications')
    .where('userId', '==', currentUser.uid)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  if (snapshot.empty) {
    container.innerHTML = '<p class="text-muted text-center">Nenhuma notificacao.</p>';
    if (badgeEl) badgeEl.setAttribute('data-count', '0');
    return;
  }

  // Count unread notifications
  let unreadCount = 0;
  let html = '';

  snapshot.forEach(doc => {
    const notif = doc.data();
    if (!notif.read) unreadCount++;
    const date = notif.createdAt?.toDate?.()
      ? notif.createdAt.toDate().toLocaleDateString('pt-BR')
      : '';

    html += `
      <div class="card mb-1" style="padding:1rem; opacity:${notif.read ? '0.7' : '1'}">
        <div class="flex justify-between items-center">
          <strong>${notif.title || 'Notificacao'}</strong>
          <small class="text-muted">${date}</small>
        </div>
        <p class="text-muted mt-1" style="font-size:0.9rem">${notif.message || ''}</p>
      </div>
    `;
  });

  container.innerHTML = html;
  if (badgeEl) badgeEl.setAttribute('data-count', String(unreadCount));
}
