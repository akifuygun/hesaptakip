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
const suggestionsList = document.getElementById('suggestions-list');

let myName = '';
// Ürün adı -> son fiyat eşleştirmesi
const itemPriceMap = new Map();

// Otomatik yeniden katılma (localStorage)
const saved = JSON.parse(localStorage.getItem('hesaptakip') || 'null');
const urlParams = new URLSearchParams(window.location.search);
const masaParam = urlParams.get('masa');

if (saved && saved.token && (!masaParam || masaParam.toUpperCase() === saved.sessionId)) {
  // Kayıtlı session varsa token ile otomatik katıl
  socket.emit('join-session', { sessionId: saved.sessionId, userName: saved.userName, token: saved.token });
} else if (masaParam) {
  // URL'den gelen yeni masa kodu
  sessionCodeInput.value = masaParam.toUpperCase();
  document.getElementById('btn-create').classList.add('hidden');
  document.querySelector('.divider').classList.add('hidden');
  sessionCodeInput.parentElement.classList.add('hidden');
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
socket.on('session-joined', ({ sessionId, userName, token, session }) => {
  myName = userName;
  sessionIdSpan.textContent = sessionId;
  currentUserSpan.textContent = userName;
  loginScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  history.replaceState(null, '', '?masa=' + sessionId);
  localStorage.setItem('hesaptakip', JSON.stringify({ sessionId, userName, token }));
  renderSession(session);
});

// Session güncellendi
socket.on('session-updated', (session) => {
  renderSession(session);
});

// Hata mesajı
socket.on('error-msg', (msg) => {
  localStorage.removeItem('hesaptakip');
  showError(msg);
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

  socket.emit('add-item', { name, price: parsedPrice });
  itemNameInput.value = '';
  itemPriceInput.value = '';
  itemNameInput.focus();
}

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
  localStorage.removeItem('hesaptakip');
  history.replaceState(null, '', window.location.pathname);
  location.reload();
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
  // Öneriler itemPriceMap'ten okunur, ayrı render gerekmez

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
        const qty = item.quantity || 1;
        const lineTotal = item.price * qty;
        const priceLabel = item.price > 0
          ? `<span class="item-price">${lineTotal.toFixed(2)} TL</span>`
          : '';
        const controls = isMe
          ? `<div class="qty-controls">
               <button class="btn-qty btn-minus" data-id="${item.id}">-</button>
               <span class="qty-value">${qty}</span>
               <button class="btn-qty btn-plus" data-id="${item.id}">+</button>
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

    card.innerHTML = `
      <div class="user-card-header">
        <span class="user-name ${isMe ? 'me' : ''}">${escapeHtml(userName)}${isMe ? ' (Sen)' : ''}</span>
        <span class="user-total">${userTotal.toFixed(2)} TL</span>
      </div>
      ${itemsHTML}
    `;

    // +/- butonlarına event ekle
    if (isMe) {
      card.querySelectorAll('.btn-plus').forEach((btn) => {
        btn.addEventListener('click', () => {
          socket.emit('increment-item', btn.dataset.id);
        });
      });
      card.querySelectorAll('.btn-minus').forEach((btn) => {
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
