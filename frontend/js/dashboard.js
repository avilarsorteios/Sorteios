// Dashboard logic
requireAuth();
initTabs();

auth.onAuthStateChanged(async user => {
  if (!user) return;
  document.getElementById('user-name').textContent = user.displayName || 'Usuário';
  document.getElementById('user-email').textContent = user.email;
  document.getElementById('avatar-initials').textContent = (user.displayName || 'U')[0].toUpperCase();
  document.getElementById('profile-uid').value = user.uid;
  document.getElementById('profile-name').value = user.displayName || '';
  document.getElementById('profile-email').value = user.email;
  if (user.photoURL) document.getElementById('profile-photo').src = user.photoURL;

  loadActiveLotes();
  loadMyLotes(user.uid);
  loadHistory(user.uid);
  loadNotifications(user.uid);
});

async function loadActiveLotes() {
  const container = document.getElementById('active-lotes');
  const snap = await db.collection('lotes').where('status', '==', 'active').get();
  if (snap.empty) { container.innerHTML = '<p style="color:var(--text-secondary)">Nenhum sorteio ativo.</p>'; return; }
  container.innerHTML = '';
  snap.forEach(doc => {
    const l = doc.data();
    const sold = l.soldCount || 0;
    const pct = Math.round((sold / l.totalNumbers) * 100);
    container.innerHTML += `<div class="card"><h3>${l.prizeName}</h3><div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div><small>${pct}% vendido - ${formatBRL(l.numberValue)}/número</small><br><a href="compra.html?id=${doc.id}" class="btn btn-primary btn-sm" style="margin-top:0.5rem">Comprar</a></div>`;
  });
}

async function loadMyLotes(uid) {
  const container = document.getElementById('my-lotes');
  const snap = await db.collection('purchases').where('userId', '==', uid).get();
  if (snap.empty) { container.innerHTML = '<p style="color:var(--text-secondary)">Você ainda não participou de nenhum sorteio.</p>'; return; }
  container.innerHTML = '';
  snap.forEach(doc => {
    const p = doc.data();
    const statusLabel = p.paymentStatus === 'approved' ? 'Confirmado' : (p.paymentStatus === 'pending' ? 'Pendente' : p.paymentStatus);
    const badgeClass = p.paymentStatus === 'approved' ? 'success' : 'warning';
    container.innerHTML += `<div class="card" style="margin-bottom:1rem"><h4>Sorteio</h4><p>Números: ${(p.numbers || []).join(', ')}</p><p>Valor: ${formatBRL(p.amount || 0)}</p><span class="badge badge-${badgeClass}">${statusLabel}</span></div>`;
  });
}

async function loadHistory(uid) {
  const tbody = document.getElementById('history-body');
  const snap = await db.collection('purchases').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(50).get();
  if (snap.empty) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary)">Nenhum registro.</td></tr>'; return; }
  tbody.innerHTML = '';
  snap.forEach(doc => {
    const p = doc.data();
    const date = p.createdAt ? p.createdAt.toDate().toLocaleDateString('pt-BR') : '-';
    const statusLabel = p.paymentStatus === 'approved' ? 'Confirmado' : (p.paymentStatus === 'pending' ? 'Pendente' : (p.paymentStatus || '-'));
    const badgeClass = p.paymentStatus === 'approved' ? 'success' : 'warning';
    tbody.innerHTML += `<tr><td>${date}</td><td>${p.loteId || '-'}</td><td>${(p.numbers || []).length}</td><td>${formatBRL(p.amount || 0)}</td><td><span class="badge badge-${badgeClass}">${statusLabel}</span></td></tr>`;
  });
}

async function loadNotifications(uid) {
  const container = document.getElementById('notif-list');
  const snap = await db.collection('notifications').where('userId', '==', uid).orderBy('createdAt', 'desc').limit(20).get();
  if (snap.empty) return;
  container.innerHTML = '';
  snap.forEach(doc => {
    const n = doc.data();
    const date = n.createdAt ? n.createdAt.toDate().toLocaleDateString('pt-BR') : '';
    container.innerHTML += `<div class="notif-item"><p>${n.message}</p><span class="notif-date">${date}</span></div>`;
  });
}

// Profile form
document.getElementById('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const user = auth.currentUser;
  const name = document.getElementById('profile-name').value;
  const password = document.getElementById('profile-password').value;
  try {
    await user.updateProfile({ displayName: name });
    await db.collection('users').doc(user.uid).update({ name });
    if (password) await user.updatePassword(password);
    alert('Perfil atualizado!');
  } catch (err) {
    alert('Erro: ' + err.message);
  }
});
