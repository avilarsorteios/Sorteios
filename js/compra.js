/**
 * compra.js - Purchase Page Logic
 * Handles number grid display, manual and random selection ("Escolha Aleatoria"),
 * PIX payment flow via Mercado Pago, and real-time payment confirmation.
 *
 * Key rules:
 * - Numbers are 6-digit random codes (e.g., "482916", "730251") - NOT sequential
 * - Users pick quantity + click "Escolha Aleatoria" to auto-select available numbers
 * - Users can also manually click individual numbers to select/deselect
 * - Both methods can be combined freely
 * - Payment is via Mercado Pago PIX with 10-minute reservation
 */

// ============ State ============
const params = new URLSearchParams(window.location.search);
const loteId = params.get('id') || params.get('lote');
let loteData = null;
let allNumbers = [];         // { code: string, status: 'available'|'sold'|'owned' }
let selectedNumbers = [];    // Array of selected 6-digit code strings
let countdownInterval = null;
let paymentUnsubscribe = null;

// ============ Initialization ============

requireAuth();

if (!loteId) {
  showToast('Sorteio nao encontrado.', 'error');
  window.location.href = 'dashboard.html';
}

auth.onAuthStateChanged(async user => {
  if (!user) return;
  showLoader();
  try {
    await loadLoteDetails(user.uid);
    renderNumberGrid();
    bindEvents();
  } catch (error) {
    showToast('Erro ao carregar sorteio.', 'error');
    console.error('Load error:', error);
  } finally {
    hideLoader();
  }
});

// ============ Load Lote Details & Numbers ============

/**
 * Fetch lote document and its numbers subcollection.
 * Determines each number's status relative to the current user.
 */
async function loadLoteDetails(userId) {
  const loteDoc = await db.collection('lotes').doc(loteId).get();
  if (!loteDoc.exists) throw new Error('Lote not found');
  loteData = { id: loteDoc.id, ...loteDoc.data() };

  // Update page header
  const titleEl = document.getElementById('prize-name');
  const priceEl = document.getElementById('prize-price');
  const statsEl = document.getElementById('prize-stats');
  const progressEl = document.getElementById('prize-progress');
  const imgEl = document.getElementById('prize-img');

  if (titleEl) titleEl.textContent = loteData.prizeName || loteData.name || '';
  if (priceEl) priceEl.textContent = `${formatBRL(loteData.numberPrice || loteData.numberValue || 0)} por numero`;
  if (imgEl && loteData.prizeImage) imgEl.src = loteData.prizeImage;

  // Load numbers from subcollection
  allNumbers = [];
  const numbersSnap = await db.collection('lotes').doc(loteId).collection('numbers').get();

  numbersSnap.forEach(doc => {
    const data = doc.data();
    let status = 'available';
    if (data.status === 'sold' && data.userId === userId) status = 'owned';
    else if (data.status === 'sold') status = 'sold';
    else if (data.status === 'reserved' && data.userId === userId) status = 'owned';
    else if (data.status === 'reserved') status = 'sold';
    allNumbers.push({ code: doc.id, status });
  });

  // Update progress display
  const soldCount = allNumbers.filter(n => n.status === 'sold' || n.status === 'owned').length;
  const totalCount = allNumbers.length;
  const pct = totalCount > 0 ? Math.round((soldCount / totalCount) * 100) : 0;

  if (statsEl) statsEl.textContent = `${totalCount} numeros | ${soldCount} vendidos | ${totalCount - soldCount} disponiveis`;
  if (progressEl) progressEl.style.width = `${pct}%`;
}

// ============ Render Number Grid ============

/**
 * Render all numbers as clickable cells showing 6-digit codes
 */
function renderNumberGrid() {
  const grid = document.getElementById('numbers-grid');
  if (!grid) return;

  grid.innerHTML = '';
  allNumbers.forEach(num => {
    const isSelected = selectedNumbers.includes(num.code);
    const cellClass = num.status !== 'available' ? num.status : (isSelected ? 'selected' : '');

    const cell = document.createElement('div');
    cell.className = `number-cell ${cellClass}`;
    cell.textContent = num.code;
    cell.dataset.code = num.code;

    // Only available numbers can be toggled
    if (num.status === 'available') {
      cell.addEventListener('click', () => toggleNumber(num.code, cell));
    }

    grid.appendChild(cell);
  });

  updateSummary();
}

// ============ Manual Number Selection (click to select/deselect) ============

/**
 * Toggle a single number's selection state
 */
function toggleNumber(code, cell) {
  const index = selectedNumbers.indexOf(code);

  if (index === -1) {
    selectedNumbers.push(code);
    cell.classList.add('selected');
  } else {
    selectedNumbers.splice(index, 1);
    cell.classList.remove('selected');
  }

  updateSummary();
}

// ============ Random Selection (Escolha Aleatoria) ============

/**
 * Randomly pick N numbers from available (not sold, not already selected).
 * Combines with any manually-selected numbers.
 * Uses Fisher-Yates shuffle for unbiased randomness.
 */
function handleRandomSelection() {
  const qtyInput = document.getElementById('qty-input');
  const quantity = parseInt(qtyInput?.value, 10);

  if (!quantity || quantity < 1) {
    showToast('Informe uma quantidade valida.', 'warning');
    return;
  }

  // Filter available numbers NOT already in selection
  const available = allNumbers.filter(
    n => n.status === 'available' && !selectedNumbers.includes(n.code)
  );

  if (quantity > available.length) {
    showToast(`Apenas ${available.length} numero(s) disponivel(is) para selecao.`, 'warning');
    return;
  }

  // Fisher-Yates shuffle for unbiased random selection
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Pick first N from shuffled array
  const picked = shuffled.slice(0, quantity).map(n => n.code);

  // Add to selection and update grid
  selectedNumbers.push(...picked);
  picked.forEach(code => {
    const cell = document.querySelector(`.number-cell[data-code="${code}"]`);
    if (cell) cell.classList.add('selected');
  });

  updateSummary();
  showToast(`${quantity} numero(s) selecionado(s) aleatoriamente!`, 'success');
}

/**
 * Clear all current selections
 */
function clearSelection() {
  selectedNumbers.forEach(code => {
    const cell = document.querySelector(`.number-cell[data-code="${code}"]`);
    if (cell) cell.classList.remove('selected');
  });
  selectedNumbers = [];
  updateSummary();
}

// ============ Summary / Total Price ============

/**
 * Update selection count and calculated total price dynamically
 */
function updateSummary() {
  const countEl = document.getElementById('selected-count');
  const totalEl = document.getElementById('total-price');
  const buyBtn = document.getElementById('btn-pagar');
  const termsCheck = document.getElementById('accept-terms');

  const count = selectedNumbers.length;
  const unitPrice = loteData?.numberPrice || loteData?.numberValue || 0;
  const total = count * unitPrice;

  if (countEl) countEl.textContent = count;
  if (totalEl) totalEl.textContent = formatBRL(total);
  if (buyBtn) {
    buyBtn.disabled = count === 0 || (termsCheck && !termsCheck.checked);
  }
}

// ============ Purchase Flow (Mercado Pago PIX) ============

/**
 * Initiate purchase: validate inputs, call Cloud Function for PIX payment,
 * then display QR code modal with 10-minute countdown.
 */
async function initiatePurchase() {
  // Validate disclaimer/terms acceptance
  const termsCheck = document.getElementById('accept-terms');
  if (termsCheck && !termsCheck.checked) {
    showToast('Voce deve aceitar os termos para continuar.', 'warning');
    return;
  }

  if (selectedNumbers.length === 0) {
    showToast('Selecione pelo menos um numero.', 'warning');
    return;
  }

  showLoader();
  try {
    // Call Firebase Cloud Function to reserve numbers and create PIX payment
    const reserveNumbers = functions.httpsCallable('reserveNumbers');
    const result = await reserveNumbers({
      loteId,
      numbers: selectedNumbers
    });

    const { qrCode, pixCopiaECola, paymentId, expiresAt, purchaseId } = result.data;

    // Show PIX QR code modal with countdown
    showPixModal(qrCode, pixCopiaECola, paymentId, expiresAt);
  } catch (error) {
    showToast(error.message || 'Erro ao gerar pagamento. Tente novamente.', 'error');
    console.error('Payment error:', error);
  } finally {
    hideLoader();
  }
}

// ============ PIX Modal with Countdown Timer ============

/**
 * Display the PIX payment modal with QR code and 10-minute countdown
 */
function showPixModal(qrCodeBase64, pixCode, paymentId, expiresAt) {
  const modal = document.getElementById('pix-modal');
  const qrImg = document.getElementById('pix-qr-img') || document.querySelector('.pix-qr-container img');
  const codeEl = document.getElementById('pix-code') || document.querySelector('.pix-code');
  const timerEl = document.getElementById('timer') || document.getElementById('pix-timer');

  if (!modal) return;

  // Set QR image (base64 or URL)
  if (qrImg && qrCodeBase64) {
    qrImg.src = qrCodeBase64.startsWith('data:') ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`;
  }

  // Set PIX copy-paste code
  if (codeEl) {
    codeEl.textContent = pixCode || '';
    codeEl.onclick = () => {
      navigator.clipboard.writeText(pixCode).then(() => {
        showToast('Codigo PIX copiado!', 'success');
      });
    };
  }

  // Show modal
  modal.classList.add('active');

  // Start 10-minute countdown
  const expiry = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 10 * 60 * 1000);
  startCountdown(expiry, timerEl);

  // Listen for payment confirmation in real-time
  pollPaymentStatus(paymentId);
}

/**
 * Countdown timer - shows MM:SS and alerts when expired
 */
function startCountdown(expiry, timerEl) {
  if (countdownInterval) clearInterval(countdownInterval);

  countdownInterval = setInterval(() => {
    const remaining = expiry - Date.now();

    if (remaining <= 0) {
      clearInterval(countdownInterval);
      if (timerEl) {
        timerEl.textContent = 'EXPIRADO';
        timerEl.style.color = 'var(--danger)';
      }
      showToast('Tempo esgotado! O pagamento expirou.', 'error');
      closePixModal();
      return;
    }

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    if (timerEl) {
      timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      // Visual warning when less than 2 minutes remain
      if (remaining < 120000) {
        timerEl.style.color = 'var(--danger)';
        timerEl.classList?.add('expiring');
      }
    }
  }, 1000);
}

/**
 * Listen to Firestore payment document for real-time status updates
 */
function pollPaymentStatus(paymentId) {
  if (!paymentId) return;

  // Poll using purchases collection where paymentId matches
  const purchasesQuery = db.collection('purchases').where('paymentId', '==', paymentId).limit(1);

  paymentUnsubscribe = purchasesQuery.onSnapshot(snapshot => {
    if (snapshot.empty) return;
    const data = snapshot.docs[0].data();

    if (data.paymentStatus === 'approved') {
      cleanup();
      closePixModal();
      showToast('Pagamento confirmado! Seus numeros foram reservados.', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } else if (data.paymentStatus === 'expired' || data.paymentStatus === 'failed') {
      cleanup();
      closePixModal();
      showToast('Pagamento nao confirmado. Tente novamente.', 'error');
    }
  });
}

/**
 * Close the PIX modal and clean up timers/listeners
 */
function closePixModal() {
  const modal = document.getElementById('pix-modal');
  if (modal) modal.classList.remove('active');
  cleanup();
}

function cleanup() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  if (paymentUnsubscribe) { paymentUnsubscribe(); paymentUnsubscribe = null; }
}

// ============ Event Bindings ============

function bindEvents() {
  // "Escolha Aleatoria" button
  const randomBtn = document.getElementById('btn-random');
  if (randomBtn) randomBtn.addEventListener('click', handleRandomSelection);

  // Clear selection button
  const clearBtn = document.getElementById('btn-clear');
  if (clearBtn) clearBtn.addEventListener('click', clearSelection);

  // Buy / Pay button
  const buyBtn = document.getElementById('btn-pagar');
  if (buyBtn) buyBtn.addEventListener('click', initiatePurchase);

  // Terms checkbox toggles buy button state
  const termsCheck = document.getElementById('accept-terms');
  if (termsCheck) termsCheck.addEventListener('change', updateSummary);

  // Close modal
  const closeBtn = document.getElementById('pix-modal-close') || document.querySelector('.modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closePixModal);

  // Close modal on overlay click
  const modal = document.getElementById('pix-modal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) closePixModal();
    });
  }
}
