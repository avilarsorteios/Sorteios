/**
 * admin.js - Admin Panel Logic
 * Dashboard stats, CRUD for lotes, financial view, user management,
 * draw execution (only at 100% sold), winner history, and prize delivery.
 *
 * Key rules:
 * - Numbers are random 6-digit codes generated when admin creates a lote
 * - Meta (goal) = cost * 2; number value = meta / quantity
 * - Draw only happens when 100% of numbers are sold
 */

// ============ Initialization ============
requireAdmin();
initTabs();

// ============ Dashboard Stats ============

async function loadDashboard() {
  const lotesSnap = await db.collection('lotes').get();
  let revenue = 0, profit = 0, active = 0, closed = 0, totalSold = 0;

  lotesSnap.forEach(doc => {
    const l = doc.data();
    const sold = l.soldCount || 0;
    const price = l.numberValue || 0;
    const loteRevenue = sold * price;
    revenue += loteRevenue;
    profit += loteRevenue - (l.prizeCost || 0);
    totalSold += sold;
    if (l.status === 'active') active++;
    else closed++;
  });

  setTextById('stat-revenue', formatBRL(revenue));
  setTextById('stat-profit', formatBRL(profit));
  setTextById('stat-active', active);
  setTextById('stat-closed', closed);
  setTextById('stat-sold', totalSold);

  // Total users
  const usersSnap = await db.collection('users').get();
  setTextById('stat-users', usersSnap.size);

  // Recent purchases
  const purchSnap = await db.collection('purchases')
    .where('paymentStatus', '==', 'approved')
    .orderBy('createdAt', 'desc').limit(5).get();
  const rp = document.getElementById('recent-purchases');
  if (rp) {
    rp.innerHTML = '';
    if (purchSnap.empty) {
      rp.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem">Nenhuma compra recente.</p>';
    }
    purchSnap.forEach(doc => {
      const p = doc.data();
      rp.innerHTML += `
        <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
          ${(p.numbers || []).length} números -
          ${formatBRL(p.amount || 0)}
          <span class="badge badge-success">Confirmado</span>
        </div>`;
    });
  }

  // Recent winners (lotes with status finished)
  const winSnap = await db.collection('lotes')
    .where('status', '==', 'finished')
    .orderBy('drawDate', 'desc').limit(5).get();
  const rw = document.getElementById('recent-winners');
  if (rw) {
    rw.innerHTML = winSnap.empty
      ? '<p style="color:var(--text-secondary);font-size:0.85rem">Nenhum sorteio realizado.</p>'
      : '';
    winSnap.forEach(doc => {
      const d = doc.data();
      rw.innerHTML += `
        <div style="padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
          ${d.prizeName} - Número: ${d.winnerNumber || '-'}
          ${d.prizeDelivered ? '<span class="badge badge-success">Entregue</span>' : '<span class="badge badge-warning">Pendente</span>'}
        </div>`;
    });
  }
}

// ============ Lotes CRUD ============

function showLoteForm(editId) {
  document.getElementById('lote-form').style.display = 'block';
  document.getElementById('form-title').textContent = editId ? 'Editar Lote' : 'Criar Novo Lote';
  document.getElementById('lote-edit-id').value = editId || '';
  if (!editId) {
    document.getElementById('lote-form-el').reset();
    updateCalculation();
  }
}

function hideLoteForm() {
  document.getElementById('lote-form').style.display = 'none';
}

/**
 * Auto-calculate meta and number value when cost or quantity changes.
 * Formula: meta = cost * 2; numberValue = meta / quantity
 */
function updateCalculation() {
  const cost = parseFloat(document.getElementById('f-cost').value) || 0;
  const qty = parseInt(document.getElementById('f-qty').value) || 0;

  const meta = cost * 2;
  const numberValue = qty > 0 ? parseFloat((meta / qty).toFixed(2)) : 0;

  setTextById('calc-meta', formatBRL(meta));
  setTextById('calc-number-value', formatBRL(numberValue));
}

/**
 * Generate N unique random 6-digit numbers (100000-999999)
 */
function generateRandomNumbers(quantity) {
  const usedSet = new Set();
  while (usedSet.size < quantity) {
    usedSet.add(Math.floor(Math.random() * 900000) + 100000);
  }
  return Array.from(usedSet).map(String);
}

/**
 * Handle lote form submission (create or update)
 */
document.getElementById('lote-form-el')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showLoader();

  try {
    const editId = document.getElementById('lote-edit-id').value;
    const qty = parseInt(document.getElementById('f-qty').value);
    const prizeCost = parseFloat(document.getElementById('f-cost').value);
    const meta = prizeCost * 2;
    const numberValue = parseFloat((meta / qty).toFixed(2));

    if (!editId) {
      // CREATE new lote
      const numbers = generateRandomNumbers(qty);

      const loteData = {
        prizeName: document.getElementById('f-prize').value,
        prizeImage: document.getElementById('f-image').value || '',
        prizeCost,
        totalNumbers: qty,
        meta,
        numberValue,
        status: document.getElementById('f-status').value || 'active',
        endDate: document.getElementById('f-date').value || null,
        soldCount: 0,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        winnerId: null,
        winnerNumber: null,
        drawDate: null,
        prizeDelivered: false
      };

      const docRef = await db.collection('lotes').add(loteData);

      // Store numbers in subcollection (batch writes, max 450 per batch)
      const BATCH_SIZE = 450;
      for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
        const batch = db.batch();
        const chunk = numbers.slice(i, i + BATCH_SIZE);
        chunk.forEach(num => {
          const numRef = db.collection('lotes').doc(docRef.id)
            .collection('numbers').doc(num);
          batch.set(numRef, {
            number: num,
            status: 'available',
            userId: null,
            reservedAt: null,
            soldAt: null
          });
        });
        await batch.commit();
      }

      showToast('Lote criado com sucesso!', 'success');
    } else {
      // UPDATE existing lote
      const updateData = {
        prizeName: document.getElementById('f-prize').value,
        prizeImage: document.getElementById('f-image').value || '',
        prizeCost,
        meta,
        numberValue,
        status: document.getElementById('f-status').value || 'active',
        endDate: document.getElementById('f-date').value || null,
      };

      await db.collection('lotes').doc(editId).update(updateData);
      showToast('Lote atualizado com sucesso!', 'success');
    }

    hideLoteForm();
    loadLotes();
    loadFinancial();
    loadDashboard();
  } catch (error) {
    showToast('Erro ao salvar lote: ' + error.message, 'error');
    console.error('Save lote error:', error);
  } finally {
    hideLoader();
  }
});

/**
 * Load and display all lotes in the management list
 */
async function loadLotes() {
  const container = document.getElementById('lotes-list');
  if (!container) return;

  const snap = await db.collection('lotes').orderBy('createdAt', 'desc').get();
  container.innerHTML = '';

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--text-secondary)">Nenhum lote cadastrado.</p>';
    return;
  }

  snap.forEach(doc => {
    const l = doc.data();
    const sold = l.soldCount || 0;
    const pct = l.totalNumbers ? Math.round((sold / l.totalNumbers) * 100) : 0;
    const statusBadge = l.status === 'active' ? 'badge-success'
      : l.status === 'finished' ? 'badge-info' : 'badge-danger';

    container.innerHTML += `
      <div class="card" style="margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <strong>${l.prizeName}</strong><br>
          <small style="color:var(--text-secondary)">
            ${l.totalNumbers} números | ${sold} vendidos | ${pct}% |
            ${formatBRL(l.numberValue)}/número |
            <span class="badge ${statusBadge}">${l.status}</span>
          </small>
        </div>
        <div style="display:flex; gap:0.5rem;">
          <button class="btn btn-secondary btn-sm" onclick="editLote('${doc.id}')">Editar</button>
          ${l.status === 'active' ? `<button class="btn btn-danger btn-sm" onclick="cancelLote('${doc.id}')">Cancelar</button>` : ''}
        </div>
      </div>`;
  });
}

async function editLote(id) {
  const doc = await db.collection('lotes').doc(id).get();
  const l = doc.data();
  showLoteForm(id);
  document.getElementById('f-prize').value = l.prizeName || '';
  document.getElementById('f-image').value = l.prizeImage || '';
  document.getElementById('f-cost').value = l.prizeCost || '';
  document.getElementById('f-qty').value = l.totalNumbers || '';
  document.getElementById('f-date').value = l.endDate || '';
  document.getElementById('f-status').value = l.status || 'active';
  updateCalculation();
}

async function cancelLote(id) {
  if (!confirm('Deseja cancelar este lote? Esta ação não pode ser desfeita.')) return;
  await db.collection('lotes').doc(id).update({ status: 'cancelled' });
  showToast('Lote cancelado.', 'warning');
  loadLotes();
  loadDashboard();
}

// ============ Financial View ============

async function loadFinancial() {
  const container = document.getElementById('financial-list');
  if (!container) return;

  const snap = await db.collection('lotes').get();
  container.innerHTML = '';

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--text-secondary)">Nenhum lote cadastrado.</p>';
    return;
  }

  snap.forEach(doc => {
    const l = doc.data();
    const sold = l.soldCount || 0;
    const price = l.numberValue || 0;
    const collected = sold * price;
    const profit = collected - (l.prizeCost || 0);
    const pct = l.totalNumbers ? Math.round((sold / l.totalNumbers) * 100) : 0;

    container.innerHTML += `
      <div class="card" style="margin-bottom:1rem;">
        <h4>${l.prizeName}
          <span class="badge badge-${l.status === 'active' ? 'success' : (l.status === 'finished' ? 'info' : 'danger')}">${l.status}</span>
        </h4>
        <div class="grid grid-3" style="margin-top:0.75rem;">
          <div><small style="color:var(--text-secondary)">Custo do Prêmio</small><br><strong>${formatBRL(l.prizeCost || 0)}</strong></div>
          <div><small style="color:var(--text-secondary)">Meta</small><br><strong>${formatBRL(l.meta || 0)}</strong></div>
          <div><small style="color:var(--text-secondary)">Arrecadado</small><br><strong>${formatBRL(collected)}</strong></div>
          <div><small style="color:var(--text-secondary)">Lucro</small><br><strong style="color:${profit >= 0 ? 'var(--accent)' : 'var(--danger)'}">${formatBRL(profit)}</strong></div>
          <div><small style="color:var(--text-secondary)">Vendidos/Total</small><br><strong>${sold}/${l.totalNumbers}</strong></div>
          <div><small style="color:var(--text-secondary)">Valor/Número</small><br><strong>${formatBRL(price)}</strong></div>
        </div>
        <div class="progress" style="margin-top:0.75rem;"><div class="progress-bar" style="width:${pct}%"></div></div>
        <small style="color:var(--text-secondary)">${pct}% vendido</small>
      </div>`;
  });
}

// ============ User Management ============

async function loadUsers() {
  const tbody = document.getElementById('users-body');
  if (!tbody) return;

  const snap = await db.collection('users').get();
  tbody.innerHTML = '';

  if (snap.empty) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-secondary)">Nenhum usuário.</td></tr>';
    return;
  }

  for (const doc of snap.docs) {
    const u = doc.data();
    const purchSnap = await db.collection('purchases')
      .where('userId', '==', doc.id).get();
    const date = u.createdAt?.toDate?.()
      ? u.createdAt.toDate().toLocaleDateString('pt-BR')
      : '-';

    tbody.innerHTML += `
      <tr>
        <td>${u.name || '-'}</td>
        <td>${u.email || '-'}</td>
        <td>${purchSnap.size}</td>
        <td>${date}</td>
      </tr>`;
  }
}

// ============ Draw Execution ============

async function loadDraws() {
  const container = document.getElementById('draw-eligible');
  if (!container) return;

  const snap = await db.collection('lotes').where('status', '==', 'active').get();
  container.innerHTML = '';

  if (snap.empty) {
    container.innerHTML = '<p style="color:var(--text-secondary)">Nenhum lote ativo.</p>';
  }

  snap.forEach(doc => {
    const l = doc.data();
    const sold = l.soldCount || 0;
    const total = l.totalNumbers || 0;
    const isEligible = sold >= total && total > 0;

    container.innerHTML += `
      <div class="card" style="margin-bottom:0.75rem; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
        <div>
          <strong>${l.prizeName}</strong><br>
          <small style="color:var(--text-secondary)">${sold}/${total} vendidos (${total > 0 ? Math.round((sold / total) * 100) : 0}%)</small>
        </div>
        ${isEligible
          ? `<button class="btn btn-primary btn-sm" onclick="performDraw('${doc.id}')">Realizar Sorteio</button>`
          : `<span class="badge badge-warning">Aguardando 100%</span>`
        }
      </div>`;
  });

  await loadWinnerHistory();
}

async function performDraw(loteId) {
  if (!confirm('Realizar sorteio agora? Esta ação é irreversível.')) return;

  showLoader();
  try {
    // Try Cloud Function first
    const executeDraw = functions.httpsCallable('performDraw');
    const result = await executeDraw({ loteId });

    showToast(`Sorteio realizado! Número vencedor: ${result.data.winnerNumber}`, 'success');
    loadDraws();
    loadDashboard();
    loadLotes();
  } catch (fnError) {
    // Fallback: client-side draw
    console.warn('Cloud Function unavailable, performing client-side draw:', fnError);
    await performDrawClientSide(loteId);
  } finally {
    hideLoader();
  }
}

async function performDrawClientSide(loteId) {
  const loteRef = db.collection('lotes').doc(loteId);
  const loteDoc = await loteRef.get();
  const lote = loteDoc.data();

  if ((lote.soldCount || 0) < (lote.totalNumbers || 0)) {
    showToast('Sorteio só pode ser realizado com 100% dos números vendidos.', 'error');
    return;
  }

  // Get all sold numbers
  const numbersSnap = await loteRef.collection('numbers')
    .where('status', '==', 'sold').get();

  if (numbersSnap.empty) {
    showToast('Nenhum número vendido encontrado.', 'error');
    return;
  }

  const soldNumbers = numbersSnap.docs.map(doc => ({
    number: doc.id,
    userId: doc.data().userId
  }));

  // Random pick
  const winner = soldNumbers[Math.floor(Math.random() * soldNumbers.length)];

  // Update lote
  await loteRef.update({
    status: 'finished',
    winnerId: winner.userId,
    winnerNumber: winner.number,
    drawDate: firebase.firestore.FieldValue.serverTimestamp(),
  });

  // Notify winner
  if (winner.userId) {
    await db.collection('notifications').add({
      userId: winner.userId,
      type: 'winner',
      title: 'Parabéns! Você ganhou!',
      message: `Seu número ${winner.number} foi sorteado no lote "${lote.prizeName}". Entre em contato para retirar seu prêmio!`,
      read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }

  showToast(`Sorteio realizado! Número vencedor: ${winner.number}`, 'success');
  loadDraws();
  loadDashboard();
  loadLotes();
}

// ============ Winner History & Delivery ============

async function loadWinnerHistory() {
  const wh = document.getElementById('winners-history');
  if (!wh) return;

  const wSnap = await db.collection('lotes')
    .where('status', '==', 'finished')
    .get();

  wh.innerHTML = wSnap.empty
    ? '<p style="color:var(--text-secondary)">Nenhum sorteio realizado ainda.</p>'
    : '';

  wSnap.forEach(doc => {
    const d = doc.data();
    const date = d.drawDate?.toDate?.()
      ? d.drawDate.toDate().toLocaleDateString('pt-BR')
      : '-';
    const deliveryBadge = d.prizeDelivered ? 'badge-success' : 'badge-warning';
    const deliveryText = d.prizeDelivered ? 'Entregue' : 'Pendente';

    wh.innerHTML += `
      <div class="card" style="margin-bottom:0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
          <div>
            <strong>${d.prizeName}</strong><br>
            <small style="color:var(--text-secondary)">
              Número vencedor: ${d.winnerNumber || '-'} |
              Data: ${date}
            </small>
          </div>
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <span class="badge ${deliveryBadge}">${deliveryText}</span>
            ${!d.prizeDelivered ? `<button class="btn btn-sm btn-primary" onclick="confirmDelivery('${doc.id}')">Confirmar Entrega</button>` : ''}
          </div>
        </div>
      </div>`;
  });
}

async function confirmDelivery(loteId) {
  if (!confirm('Confirmar que o prêmio foi entregue?')) return;

  try {
    // Try Cloud Function
    const confirm_fn = functions.httpsCallable('confirmDelivery');
    await confirm_fn({ loteId });
  } catch (e) {
    // Fallback: direct update
    await db.collection('lotes').doc(loteId).update({ prizeDelivered: true });
  }

  showToast('Entrega confirmada!', 'success');
  loadDraws();
}

// ============ Helpers ============

function setTextById(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ============ Initial Load ============

auth.onAuthStateChanged(async user => {
  if (!user) return;
  loadDashboard();
  loadLotes();
  loadFinancial();
  loadUsers();
  loadDraws();
});
