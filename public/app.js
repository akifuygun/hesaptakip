const socket = io();

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
const itemSuggestions = document.getElementById('item-suggestions');

let myName = '';
// Ürün adı -> son fiyat eşleştirmesi
const itemPriceMap = new Map();

// URL'den masa kodu kontrolü
const urlParams = new URLSearchParams(window.location.search);
const masaParam = urlParams.get('masa');
if (masaParam) {
  sessionCodeInput.value = masaParam.toUpperCase();
  document.getElementById('btn-create').classList.add('hidden');
  document.querySelector('.divider').classList.add('hidden');
  sessionCodeInput.parentElement.classList.add('hidden');
  document.querySelector('.login-card .subtitle').textContent = 'Masaya katılmak için adını gir';
  btnJoin.classList.remove('btn-secondary');
  btnJoin.classList.add('btn-primary');
  // Enter ile direkt katıl
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
  socket.emit('create-session', name);
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

// Session'a katılma başarılı
socket.on('session-joined', ({ sessionId, userName, session }) => {
  myName = userName;
  sessionIdSpan.textContent = sessionId;
  currentUserSpan.textContent = userName;
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  history.replaceState(null, '', '?masa=' + sessionId);
  renderSession(session);
});

// Session güncellendi
socket.on('session-updated', (session) => {
  renderSession(session);
});

// Hata mesajı
socket.on('error-msg', (msg) => {
  showError(msg);
});

// Ürün ekle
btnAddItem.addEventListener('click', addItem);

itemNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem();
});

itemPriceInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addItem();
});

// Öneri seçilince fiyatı otomatik doldur
itemNameInput.addEventListener('input', () => {
  const saved = itemPriceMap.get(itemNameInput.value.trim());
  if (saved && !itemPriceInput.value) {
    itemPriceInput.value = saved;
  }
});

function addItem() {
  const name = itemNameInput.value.trim();
  const price = itemPriceInput.value;

  if (!name) {
    itemNameInput.focus();
    return;
  }
  const parsedPrice = price ? parseFloat(price) : 0;

  socket.emit('add-item', { name, price: parsedPrice });
  itemNameInput.value = '';
  itemPriceInput.value = '';
  itemNameInput.focus();
}

// URL'yi paylaş
btnCopyCode.addEventListener('click', () => {
  const code = sessionIdSpan.textContent;
  const url = window.location.origin + '?masa=' + code;
  navigator.clipboard.writeText(url).then(() => {
    showToast();
  });
});

// Session'ı render et
function renderSession(session) {
  usersContainer.innerHTML = '';
  let grandTotal = 0;

  // Öneri listesini güncelle
  itemPriceMap.clear();
  for (const items of Object.values(session.users)) {
    for (const item of items) {
      if (!itemPriceMap.has(item.name) || item.price > 0) {
        itemPriceMap.set(item.name, item.price);
      }
    }
  }
  itemSuggestions.innerHTML = '';
  for (const name of itemPriceMap.keys()) {
    const opt = document.createElement('option');
    opt.value = name;
    itemSuggestions.appendChild(opt);
  }

  // Kendi kartımı en üste koy
  const sortedUsers = Object.keys(session.users).sort((a, b) => {
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

    const isMe = userName === myName;

    let itemsHTML = '';
    if (items.length === 0) {
      itemsHTML = '<div class="empty-msg">Henüz bir şey eklenmedi</div>';
    } else {
      itemsHTML = '<ul class="user-items">';
      for (const item of items) {
        const removeBtn = isMe
          ? `<button class="btn-remove" data-id="${item.id}" title="Sil">&times;</button>`
          : '';
        const qty = item.quantity || 1;
        const lineTotal = item.price * qty;
        const qtyLabel = qty > 1 ? `<span class="item-qty">x${qty}</span>` : '';
        const priceLabel = item.price > 0
          ? `<span class="item-price">${qty > 1 ? lineTotal.toFixed(2) : item.price.toFixed(2)} TL</span>`
          : '';
        itemsHTML += `
          <li>
            <span class="item-name">${escapeHtml(item.name)} ${qtyLabel}</span>
            ${priceLabel}
            ${removeBtn}
          </li>`;
      }
      itemsHTML += '</ul>';
    }

    card.innerHTML = `
      <div class="user-card-header">
        <span class="user-name ${isMe ? 'me' : ''}">${escapeHtml(userName)}${isMe ? ' (Sen)' : ''}</span>
        <span class="user-total">${userTotal.toFixed(2)} TL</span>
      </div>
      ${itemsHTML}
    `;

    // Silme butonlarına event ekle
    if (isMe) {
      card.querySelectorAll('.btn-remove').forEach((btn) => {
        btn.addEventListener('click', () => {
          socket.emit('remove-item', btn.dataset.id);
        });
      });
    }

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
