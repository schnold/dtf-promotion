/* Login for the DTF Transferprint admin: first-run setup, password, then (only for accounts that switched
   two-factor login on in "Konto") the TOTP or backup code. Sign-in and code checks go to Better Auth
   (/api/auth/*), the first-run setup to /admin/api/setup. */
const $ = (s) => document.querySelector(s);
const STEPS = ['setup', 'setup-locked', 'password', 'totp'];

const AUTH_MESSAGES = {
  INVALID_EMAIL_OR_PASSWORD: 'E-Mail oder Passwort sind falsch.',
  INVALID_CODE: 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.',
  INVALID_TWO_FACTOR_COOKIE: 'Die Anmeldung ist abgelaufen. Bitte erneut mit E-Mail und Passwort anmelden.',
  INVALID_BACKUP_CODE: 'Der Backup-Code stimmt nicht oder wurde schon benutzt.',
  INVALID_PASSWORD: 'Das Passwort stimmt nicht.',
};

async function call(url, body) {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin': '1', ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) throw new Error('Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.');
    throw new Error(data.error || AUTH_MESSAGES[data.code] || data.message || 'Unbekannter Fehler');
  }
  return data;
}

let useBackup = false;

function show(step) {
  for (const id of STEPS) $(`#step-${id}`).hidden = id !== step;
  const input = $(`#step-${step} input:not([hidden] input)`);
  if (input) input.focus();
}

function showError(form, message) {
  const box = $(`${form} .login-error`);
  box.textContent = message;
  box.hidden = !message;
}

function bind(form, handler) {
  $(form).addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $(`${form} button`);
    button.disabled = true;
    showError(form, '');
    try {
      await handler(new FormData(event.target));
    } catch (error) {
      showError(form, error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function signIn(email, password) {
  const res = await call('/api/auth/sign-in/email', { email, password });
  if (res.twoFactorRedirect) return show('totp');
  location.replace('/admin');
}

bind('#form-setup', async (fd) => {
  if (fd.get('password') !== fd.get('password2')) throw new Error('Die Passwörter stimmen nicht überein.');
  const email = String(fd.get('email')).trim();
  const password = String(fd.get('password'));
  await call('/admin/api/setup', { token: fd.get('token'), name: fd.get('name'), email, password });
  $('#form-setup').reset();
  await signIn(email, password);
});

bind('#form-password', async (fd) => {
  await signIn(String(fd.get('email')).trim(), String(fd.get('password')));
  $('#form-password').reset();
});

bind('#form-totp', async (fd) => {
  const code = String(fd.get('code')).replace(/\s/g, '');
  await call(useBackup ? '/api/auth/two-factor/verify-backup-code' : '/api/auth/two-factor/verify-totp', { code });
  location.replace('/admin');
});

$('#toggle-backup').addEventListener('click', () => {
  useBackup = !useBackup;
  $('#totp-label').textContent = useBackup ? 'Backup-Code' : 'Code';
  $('#totp-help').textContent = useBackup ? 'Geben Sie einen Ihrer Backup-Codes ein. Jeder Code funktioniert nur einmal.' : 'Geben Sie den 6-stelligen Code aus Ihrer Authenticator-App ein.';
  $('#toggle-backup').textContent = useBackup ? 'Code aus der App verwenden' : 'Stattdessen einen Backup-Code verwenden';
  $('#form-totp input').value = '';
  $('#form-totp input').focus();
});

call('/admin/api/auth-state')
  .then((state) => {
    if (state.signedIn) location.replace('/admin');
    else if (state.setupNeeded) show(state.setupAllowed ? 'setup' : 'setup-locked');
    else show('password');
  })
  .catch((error) => {
    show('password');
    showError('#form-password', error.message);
  });
