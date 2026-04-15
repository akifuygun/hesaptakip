// Cookie yardımcıları
function setCookie(name, value, days) {
  const d = new Date();
  d.setTime(d.getTime() + days * 86400000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
}
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}
function deleteCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
}

// Oturum bilgisini cookie + localStorage'dan oku
function getSavedSession() {
  try {
    const raw = getCookie('hesaptakip') || localStorage.getItem('hesaptakip');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function saveSession(data) {
  const json = JSON.stringify(data);
  localStorage.setItem('hesaptakip', json);
  setCookie('hesaptakip', json, 30);
}
function clearSession() {
  localStorage.removeItem('hesaptakip');
  deleteCookie('hesaptakip');
}

// Socket.io auth ile bağlan
const savedAuth = getSavedSession();
const socket = io({
  auth: savedAuth || {}
});

// DOM elementleri
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const userNameInput = document.getElementById('user-name');
const sessionCodeInput = document.getElementById('session-code');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const errorMsg = document.getElementById('error-msg');
const sessionIdSpan = document.getElementById('session-id');
const currentUserSpan = document.getElementById('current-user');
const btnCopyCode = document.getElementById('btn-copy-code');
const itemNameInput = document.getElementById('item-name');
const itemPriceInput = document.getElementById('item-price');
const btnAddItem = document.getElementById('btn-add-item');
const usersContainer = document.getElementById('users-container');
const grandTotalSpan = document.getElementById('grand-total');
const copyToast = document.getElementById('copy-toast');
const suggestionsList = document.getElementById('suggestions-list');
const targetUserSelect = document.getElementById('target-user');
const modeBadge = document.getElementById('mode-badge');
const modeGroup = document.getElementById('mode-group');

let myName = '';
let sessionMode = 'standard';
let sessionOwner = '';
const itemPriceMap = new Map();

const MODE_LABELS = {
  standard: 'Standart',
  admin: 'Yönetici',
  anonymous: 'Anonim',
  hybrid: 'Hibrit'
};

const MODE_DESCRIPTIONS = {
  standard: 'Herkes sadece kendi hesabını yönetir',
  admin: 'Sadece masa sahibi herkesin hesabını yönetir',
  anonymous: 'Herkes herkese ürün ekleyip çıkarabilir',
  hybrid: 'Masa sahibi herkese, diğerleri sadece kendine'
};

// Mod seçim kartları
document.querySelectorAll('.mode-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.mode-option').forEach((o) => o.classList.remove('selected'));
    opt.classList.add('selected');
    opt.querySelector('input').checked = true;
  });
});

// Otomatik yeniden katılma
const saved = getSavedSession();
const urlParams = new URLSearchParams(window.location.search);
const masaParam = urlParams.get('masa');

// Saved varsa auth middleware otomatik katılır
// Saved yoksa ve URL'de masa kodu varsa katılma formu göster
if (masaParam && (!saved || masaParam.toUpperCase() !== saved.sessionId)) {
  sessionCodeInput.value = masaParam.toUpperCase();
  document.getElementById('btn-create').classList.add('hidden');
  document.querySelector('.divider').classList.add('hidden');
  sessionCodeInput.parentElement.classList.add('hidden');
  modeGroup.classList.add('hidden');
  document.querySelector('.login-card .subtitle').textContent = 'Masaya katılmak için adını gir';
  btnJoin.classList.remove('btn-secondary');
  btnJoin.classList.add('btn-primary');
  userNameInput.addEventListener('keydown', function joinKey(e) {
    if (e.key === 'Enter') {
      e.stopImmediatePropagation();
      btnJoin.click();
    }
  });
}

// Yeni masa oluştur
btnCreate.addEventListener('click', () => {
  const name = userNameInput.value.trim();
  if (!name) {
    showError('Lütfen adını gir!');
    return;
  }
  const mode = document.querySelector('input[name="mode"]:checked').value;
  socket.emit('create-session', { userName: name, mode });
});

// Masaya katıl
btnJoin.addEventListener('click', () => {
  const name = userNameInput.value.trim();
  const code = sessionCodeInput.value.trim();
  if (!name) {
    showError('Lütfen adını gir!');
    return;
  }
  if (!code) {
    showError('Lütfen masa kodunu gir!');
    return;
  }
  socket.emit('join-session', { sessionId: code, userName: name });
});

// Enter ile giriş
userNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnCreate.click();
});

sessionCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnJoin.click();
});

// Reconnect olunca auth güncelle
socket.on('connect', () => {
  const s = getSavedSession();
  if (s) socket.auth = s;
});

// Session'a katılma başarılı
socket.on('session-joined', ({ sessionId, userName, token, session }) => {
  myName = userName;
  sessionMode = session.mode;
  sessionOwner = session.owner;
  sessionIdSpan.textContent = sessionId;
  currentUserSpan.textContent = userName;
  socket.auth = { sessionId, userName, token };
  modeBadge.textContent = MODE_LABELS[sessionMode];
  document.getElementById('mode-tooltip').textContent = MODE_DESCRIPTIONS[sessionMode];
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  history.replaceState(null, '', '?masa=' + sessionId);
  saveSession({ sessionId, userName, token });
  renderSession(session);
});

// Session güncellendi
socket.on('session-updated', (session) => {
  sessionMode = session.mode;
  sessionOwner = session.owner;
  renderSession(session);
});

// Hata mesajı
socket.on('error-msg', (msg) => {
  if (msg.includes('bulunamadı')) {
    clearSession();
  }
  showError(msg);
});

// Kişi ekleme
const addUserBar = document.getElementById('add-user-bar');
const newUserNameInput = document.getElementById('new-user-name');
const btnAddUser = document.getElementById('btn-add-user');
const btnToggleAddUser = document.getElementById('btn-toggle-add-user');

btnToggleAddUser.addEventListener('click', () => {
  addUserBar.classList.toggle('hidden');
  if (!addUserBar.classList.contains('hidden')) {
    newUserNameInput.focus();
  }
});

btnAddUser.addEventListener('click', () => {
  const name = newUserNameInput.value.trim();
  if (!name) return;
  socket.emit('add-user', name);
  newUserNameInput.value = '';
  addUserBar.classList.add('hidden');
});

newUserNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnAddUser.click();
});

// Fiyat alanında sadece rakam
itemPriceInput.addEventListener('input', () => {
  itemPriceInput.value = itemPriceInput.value.replace(/[^0-9]/g, '');
});

// Ürün ekle
btnAddItem.addEventListener('click', addItem);

itemNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem();
});

itemPriceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem();
});

// Önerileri göster/filtrele
itemNameInput.addEventListener('input', () => {
  showSuggestions();
});

itemNameInput.addEventListener('focus', () => {
  showSuggestions();
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.input-wrapper')) {
    suggestionsList.classList.add('hidden');
  }
});

function showSuggestions() {
  const val = itemNameInput.value.trim().toLowerCase();
  const items = Array.from(itemPriceMap.keys()).filter(
    (name) => !val || name.toLowerCase().includes(val)
  );

  if (items.length === 0) {
    suggestionsList.classList.add('hidden');
    return;
  }

  suggestionsList.innerHTML = '';
  for (const name of items) {
    const li = document.createElement('li');
    const price = itemPriceMap.get(name);
    li.textContent = price > 0 ? `${name} — ${price.toFixed(2)} TL` : name;
    li.addEventListener('click', () => {
      itemNameInput.value = name;
      if (price > 0) itemPriceInput.value = price;
      suggestionsList.classList.add('hidden');
      itemPriceInput.focus();
    });
    suggestionsList.appendChild(li);
  }
  suggestionsList.classList.remove('hidden');
}

function addItem() {
  const name = itemNameInput.value.trim();
  const price = itemPriceInput.value;

  if (!name) {
    itemNameInput.focus();
    return;
  }
  const parsedPrice = price ? parseFloat(price) : 0;
  const targetUser = targetUserSelect.classList.contains('hidden') ? undefined : targetUserSelect.value || undefined;

  socket.emit('add-item', { name, price: parsedPrice, targetUser });
  itemNameInput.value = '';
  itemPriceInput.value = '';
  itemNameInput.focus();
}

// Mevcut kullanıcı bu hedefe ürün yönetebilir mi?
function canManage(target) {
  switch (sessionMode) {
    case 'standard': return myName === target;
    case 'admin':    return myName === sessionOwner;
    case 'anonymous': return true;
    case 'hybrid':   return myName === sessionOwner || myName === target;
    default:         return myName === target;
  }
}

// Hedef kullanıcı seçicisini göstermeli mi?
function shouldShowTargetSelect() {
  if (sessionMode === 'admin' && myName === sessionOwner) return true;
  if (sessionMode === 'anonymous') return true;
  if (sessionMode === 'hybrid' && myName === sessionOwner) return true;
  return false;
}

// Mod badge tıklanınca açıklama göster
modeBadge.addEventListener('click', () => {
  const tooltip = document.getElementById('mode-tooltip');
  tooltip.classList.toggle('hidden');
  if (!tooltip.classList.contains('hidden')) {
    setTimeout(() => tooltip.classList.add('hidden'), 3000);
  }
});

// URL'yi paylaş
btnCopyCode.addEventListener('click', async () => {
  const code = sessionIdSpan.textContent;
  const url = window.location.origin + '?masa=' + code;

  if (navigator.share) {
    try {
      await navigator.share({ title: 'Hesap Takip', text: 'Masaya katıl!', url });
    } catch (e) { /* kullanıcı iptal etti */ }
  } else {
    navigator.clipboard.writeText(url).then(() => showToast());
  }
});

// Yeni masa
document.getElementById('btn-new-table').addEventListener('click', () => {
  clearSession();
  history.replaceState(null, '', window.location.pathname);
  location.reload();
});

// Session'ı render et
function renderSession(session) {
  usersContainer.innerHTML = '';
  let grandTotal = 0;

  // Masa sahibi + butonunu görsün
  if (myName === session.owner) {
    btnToggleAddUser.classList.remove('hidden');
  } else {
    btnToggleAddUser.classList.add('hidden');
    addUserBar.classList.add('hidden');
  }

  // Öneri listesini güncelle
  itemPriceMap.clear();
  for (const items of Object.values(session.users)) {
    for (const item of items) {
      if (!itemPriceMap.has(item.name) || item.price > 0) {
        itemPriceMap.set(item.name, item.price);
      }
    }
  }

  // Hedef kullanıcı seçicisini güncelle
  const userNames = Object.keys(session.users);
  if (shouldShowTargetSelect()) {
    targetUserSelect.classList.remove('hidden');
    const currentVal = targetUserSelect.value;
    targetUserSelect.innerHTML = '<option value="">Kime? (Opsiyonel)</option>';
    for (const name of userNames) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name === myName ? `${name} (Sen)` : name;
      targetUserSelect.appendChild(opt);
    }
    targetUserSelect.value = currentVal || '';
  } else {
    targetUserSelect.classList.add('hidden');
  }

  // Kendi kartımı en üste koy
  const sortedUsers = userNames.sort((a, b) => {
    if (a === myName) return -1;
    if (b === myName) return 1;
    return 0;
  });

  for (const userName of sortedUsers) {
    const items = session.users[userName];
    const userTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    grandTotal += userTotal;

    const card = document.createElement('div');
    card.className = 'user-card';

    const canEdit = canManage(userName);
    const isMe = userName === myName;
    const isOwner = userName === session.owner;

    let itemsHTML = '';
    if (items.length === 0) {
      itemsHTML = '<div class="empty-msg">Henüz bir şey eklenmedi</div>';
    } else {
      itemsHTML = '<ul class="user-items">';
      for (const item of items) {
        const qty = item.quantity || 1;
        const lineTotal = item.price * qty;
        const priceLabel = item.price > 0
          ? `<span class="item-price">${lineTotal.toFixed(2)} TL</span>`
          : '';
        const controls = canEdit
          ? `<div class="qty-controls">
               <button class="btn-qty btn-minus" data-id="${item.id}" data-user="${userName}">-</button>
               <span class="qty-value">${qty}</span>
               <button class="btn-qty btn-plus" data-id="${item.id}" data-user="${userName}">+</button>
             </div>`
          : (qty > 1 ? `<span class="item-qty">x${qty}</span>` : '');
        itemsHTML += `
          <li>
            <span class="item-name">${escapeHtml(item.name)}</span>
            ${priceLabel}
            ${controls}
          </li>`;
      }
      itemsHTML += '</ul>';
    }

    const ownerBadge = isOwner ? ' <span class="owner-badge">Y</span>' : '';

    card.innerHTML = `
      <div class="user-card-header">
        <span class="user-name ${isMe ? 'me' : ''}">${escapeHtml(userName)}${isMe ? ' (Sen)' : ''}${ownerBadge}</span>
        <span class="user-total">${userTotal.toFixed(2)} TL</span>
      </div>
      ${itemsHTML}
    `;

    // +/- butonlarına event ekle
    card.querySelectorAll('.btn-plus').forEach((btn) => {
      btn.addEventListener('click', () => {
        socket.emit('increment-item', { itemId: btn.dataset.id, targetUser: btn.dataset.user });
      });
    });
    card.querySelectorAll('.btn-minus').forEach((btn) => {
      btn.addEventListener('click', () => {
        socket.emit('remove-item', { itemId: btn.dataset.id, targetUser: btn.dataset.user });
      });
    });

    usersContainer.appendChild(card);
  }

  grandTotalSpan.textContent = grandTotal.toFixed(2) + ' TL';
}

function showError(msg) {
  errorMsg.textContent = msg;
  setTimeout(() => {
    errorMsg.textContent = '';
  }, 3000);
}

function showToast() {
  copyToast.classList.remove('hidden');
  setTimeout(() => {
    copyToast.classList.add('hidden');
  }, 2000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
