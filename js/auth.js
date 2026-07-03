/**
 * auth.js - Authentication Logic
 * Handles registration, login, logout, password reset,
 * auth state observation, and profile management.
 */

// ============ Registration ============

/**
 * Register a new user with email/password and create a Firestore profile
 * @param {string} name - User's display name
 * @param {string} email - User's email
 * @param {string} password - User's password
 * @param {string} cpf - User's CPF (optional, for prize validation)
 */
async function registerUser(name, email, password, cpf = '') {
  try {
    showLoader();
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    const user = credential.user;

    // Update display name in Firebase Auth
    await user.updateProfile({ displayName: name });

    // Create user profile document in Firestore
    await db.collection('users').doc(user.uid).set({
      name,
      email,
      cpf,
      role: 'user', // default role; admin set manually in Firestore
      photoURL: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      notifications: []
    });

    showToast('Conta criada com sucesso!', 'success');
    await redirectByRole(user.uid);
  } catch (error) {
    showToast(getAuthErrorMessage(error.code), 'error');
  } finally {
    hideLoader();
  }
}

// ============ Role-based Redirect ============

/**
 * Look up the user's role in Firestore and send them to the right page.
 * Admins go to /admin/, everyone else goes to /user/dashboard.html.
 */
async function redirectByRole(uid) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    const role = doc.exists ? doc.data().role : 'user';
    if (role === 'admin') {
      window.location.href = 'admin/index.html';
    } else {
      window.location.href = 'user/dashboard.html';
    }
  } catch (e) {
    window.location.href = 'user/dashboard.html';
  }
}

// ============ Login ============

/**
 * Login with email and password
 */
async function loginUser(email, password) {
  try {
    showLoader();
    const credential = await auth.signInWithEmailAndPassword(email, password);
    showToast('Login realizado com sucesso!', 'success');
    await redirectByRole(credential.user.uid);
  } catch (error) {
    showToast(getAuthErrorMessage(error.code), 'error');
  } finally {
    hideLoader();
  }
}

// ============ Logout ============

/**
 * Sign out the current user and redirect to home
 */
async function logoutUser() {
  try {
    await auth.signOut();
    window.location.href = '/';
  } catch (error) {
    showToast('Erro ao sair. Tente novamente.', 'error');
  }
}

// ============ Password Reset ============

/**
 * Send password reset email
 * @param {string} email - User's email address
 */
async function resetPassword(email) {
  try {
    showLoader();
    await auth.sendPasswordResetEmail(email);
    showToast('Email de recuperacao enviado! Verifique sua caixa de entrada.', 'success');
  } catch (error) {
    showToast(getAuthErrorMessage(error.code), 'error');
  } finally {
    hideLoader();
  }
}

// ============ Auth State Observer ============

/**
 * Observe auth state changes and call the appropriate handler
 * @param {Function} onLoggedIn - Called when user is authenticated
 * @param {Function} onLoggedOut - Called when user is not authenticated
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

// ============ Redirect Logic ============

/**
 * Redirect to dashboard if already logged in (for login/register pages)
 */
function redirectIfLoggedIn() {
  auth.onAuthStateChanged(user => {
    if (user) redirectByRole(user.uid);
  });
}

/**
 * Redirect to login if not authenticated (for protected pages)
 */
function requireAuth() {
  auth.onAuthStateChanged(user => {
    if (!user) window.location.href = '/login.html';
  });
}

// ============ Profile Update ============

/**
 * Update user profile information
 * @param {Object} updates - Fields to update (name, email, photoURL)
 */
async function updateUserProfile(updates) {
  try {
    showLoader();
    const user = auth.currentUser;
    if (!user) throw new Error('Nao autenticado');

    const profileUpdates = {};
    const firestoreUpdates = {};

    // Update display name
    if (updates.name) {
      profileUpdates.displayName = updates.name;
      firestoreUpdates.name = updates.name;
    }

    // Update photo URL
    if (updates.photoURL) {
      profileUpdates.photoURL = updates.photoURL;
      firestoreUpdates.photoURL = updates.photoURL;
    }

    // Apply Firebase Auth profile updates
    if (Object.keys(profileUpdates).length > 0) {
      await user.updateProfile(profileUpdates);
    }

    // Update email (requires recent login)
    if (updates.email && updates.email !== user.email) {
      await user.updateEmail(updates.email);
      firestoreUpdates.email = updates.email;
    }

    // Update Firestore profile document
    if (Object.keys(firestoreUpdates).length > 0) {
      await db.collection('users').doc(user.uid).update(firestoreUpdates);
    }

    showToast('Perfil atualizado com sucesso!', 'success');
  } catch (error) {
    showToast(getAuthErrorMessage(error.code) || error.message, 'error');
  } finally {
    hideLoader();
  }
}

/**
 * Change user password (requires recent login)
 * @param {string} newPassword - The new password
 */
async function updateUserPassword(newPassword) {
  try {
    showLoader();
    const user = auth.currentUser;
    if (!user) throw new Error('Nao autenticado');

    await user.updatePassword(newPassword);
    showToast('Senha alterada com sucesso!', 'success');
  } catch (error) {
    showToast(getAuthErrorMessage(error.code), 'error');
  } finally {
    hideLoader();
  }
}

// ============ Helper: Translate Auth Errors ============

/**
 * Convert Firebase auth error codes to user-friendly Portuguese messages
 */
function getAuthErrorMessage(code) {
  const messages = {
    'auth/email-already-in-use': 'Este email ja esta em uso.',
    'auth/invalid-email': 'Email invalido.',
    'auth/operation-not-allowed': 'Operacao nao permitida.',
    'auth/weak-password': 'A senha deve ter pelo menos 6 caracteres.',
    'auth/user-disabled': 'Esta conta foi desativada.',
    'auth/user-not-found': 'Nenhuma conta encontrada com este email.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'auth/requires-recent-login': 'Faca login novamente para esta operacao.'
  };
  return messages[code] || 'Ocorreu um erro. Tente novamente.';
}

// ============ Form Event Bindings ============

document.addEventListener('DOMContentLoaded', () => {
  // Register form
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    redirectIfLoggedIn();
    registerForm.addEventListener('submit', e => {
      e.preventDefault();
      const name = registerForm.querySelector('[name="name"]').value.trim();
      const email = registerForm.querySelector('[name="email"]').value.trim();
      const password = registerForm.querySelector('[name="password"]').value;
      const cpf = registerForm.querySelector('[name="cpf"]')?.value.trim() || '';
      registerUser(name, email, password, cpf);
    });
  }

  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    redirectIfLoggedIn();
    loginForm.addEventListener('submit', e => {
      e.preventDefault();
      const email = loginForm.querySelector('[name="email"]').value.trim();
      const password = loginForm.querySelector('[name="password"]').value;
      loginUser(email, password);
    });
  }

  // Password reset form
  const resetForm = document.getElementById('reset-form');
  if (resetForm) {
    resetForm.addEventListener('submit', e => {
      e.preventDefault();
      const email = resetForm.querySelector('[name="email"]').value.trim();
      resetPassword(email);
    });
  }

  // Profile form
  const profileForm = document.getElementById('profile-form');
  if (profileForm) {
    profileForm.addEventListener('submit', e => {
      e.preventDefault();
      const name = profileForm.querySelector('[name="name"]').value.trim();
      const email = profileForm.querySelector('[name="email"]').value.trim();
      updateUserProfile({ name, email });
    });
  }

  // Change password form
  const passwordForm = document.getElementById('password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', e => {
      e.preventDefault();
      const newPassword = passwordForm.querySelector('[name="new-password"]').value;
      updateUserPassword(newPassword);
    });
  }
});
