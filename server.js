const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Session dosyası
const DATA_FILE = path.join(__dirname, 'sessions.json');

// Session'ları dosyadan yükle
function loadSessions() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error('Session dosyası okunamadı:', e.message);
  }
  return new Map();
}

// Session'ları dosyaya kaydet
function saveSessions() {
  try {
    const obj = Object.fromEntries(sessions);
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj));
  } catch (e) {
    console.error('Session dosyası yazılamadı:', e.message);
  }
}

const sessions = loadSessions();

// Her değişiklikte kaydet (debounced)
let saveTimeout = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveSessions, 1000);
}

function generateSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Token'ları client'a göndermemek için
function getPublicSession(session) {
  return {
    id: session.id,
    users: session.users,
    mode: session.mode,
    owner: session.owner,
    createdAt: session.createdAt
  };
}

// Yetki kontrolü
function canManage(session, actor, target) {
  switch (session.mode) {
    case 'standard': return actor === target;
    case 'admin':    return actor === session.owner;
    case 'anonymous': return true;
    case 'hybrid':   return actor === session.owner || actor === target;
    default:         return actor === target;
  }
}

// Socket bağlantısında auth ile otomatik oturum kur
io.use((socket, next) => {
  const { sessionId, userName, token } = socket.handshake.auth || {};
  if (sessionId && userName && token) {
    const session = sessions.get(sessionId.toUpperCase());
    if (session && session.users[userName] !== undefined && session.tokens[userName] === token) {
      socket.sessionId = session.id;
      socket.userName = userName;
    }
  }
  next();
});

io.on('connection', (socket) => {
  let currentSession = socket.sessionId || null;
  let currentUser = socket.userName || null;

  // Auth ile gelen kullanıcıyı otomatik odaya al ve veriyi gönder
  if (currentSession && currentUser) {
    const session = sessions.get(currentSession);
    if (session) {
      socket.join(currentSession);
      socket.emit('session-joined', {
        sessionId: currentSession,
        userName: currentUser,
        token: session.tokens[currentUser],
        session: getPublicSession(session)
      });
    } else {
      currentSession = null;
      currentUser = null;
    }
  }

  // Yeni session oluştur
  socket.on('create-session', ({ userName, mode }) => {
    const sessionId = generateSessionId();
    const token = crypto.randomBytes(16).toString('hex');
    const session = {
      id: sessionId,
      users: {},
      tokens: {},
      mode: mode || 'standard',
      owner: userName,
      createdAt: Date.now()
    };
    session.users[userName] = [];
    session.tokens[userName] = token;
    sessions.set(sessionId, session);
    scheduleSave();

    currentSession = sessionId;
    currentUser = userName;
    socket.join(sessionId);

    socket.emit('session-joined', { sessionId, userName, token, session: getPublicSession(session) });
  });

  // Mevcut session'a katıl
  socket.on('join-session', ({ sessionId, userName, token }) => {
    const session = sessions.get(sessionId.toUpperCase());
    if (!session) {
      socket.emit('error-msg', 'Session bulunamadı!');
      return;
    }

    // Aynı isimle tekrar katılma (rejoin) — token kontrolü
    if (session.users[userName] !== undefined) {
      if (token && session.tokens[userName] !== token) {
        socket.emit('error-msg', 'Bu isim başka biri tarafından kullanılıyor!');
        return;
      }
      if (!token && session.tokens[userName]) {
        socket.emit('error-msg', 'Bu isim başka biri tarafından kullanılıyor!');
        return;
      }
      currentSession = session.id;
      currentUser = userName;
      socket.join(session.id);
      socket.emit('session-joined', { sessionId: session.id, userName, token: session.tokens[userName], session: getPublicSession(session) });
      return;
    }

    const newToken = crypto.randomBytes(16).toString('hex');
    session.users[userName] = [];
    session.tokens[userName] = newToken;
    currentSession = session.id;
    currentUser = userName;
    socket.join(session.id);
    scheduleSave();

    socket.emit('session-joined', { sessionId: session.id, userName, token: newToken, session: getPublicSession(session) });
    socket.to(session.id).emit('session-updated', getPublicSession(session));
  });

  // Masa sahibi yeni kişi ekler
  socket.on('add-user', (userName) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;
    if (currentUser !== session.owner) return;
    if (session.users[userName] !== undefined) {
      socket.emit('error-msg', 'Bu isim zaten var!');
      return;
    }

    session.users[userName] = [];
    scheduleSave();
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Yeni ürün ekle
  socket.on('add-item', ({ name, price, targetUser }) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;

    const target = targetUser || currentUser;
    if (!session.users[target]) return;
    if (!canManage(session, currentUser, target)) return;

    const parsedPrice = price ? parseFloat(price) : 0;
    const existing = session.users[target].find(
      (i) => i.name === name && i.price === parsedPrice
    );

    if (existing) {
      existing.quantity += 1;
    } else {
      session.users[target].push({
        id: crypto.randomBytes(4).toString('hex'),
        name,
        price: parsedPrice,
        quantity: 1
      });
    }

    scheduleSave();
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Ürün adedi artır
  socket.on('increment-item', ({ itemId, targetUser }) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;

    const target = targetUser || currentUser;
    if (!session.users[target]) return;
    if (!canManage(session, currentUser, target)) return;

    const item = session.users[target].find((i) => i.id === itemId);
    if (item) {
      item.quantity += 1;
      scheduleSave();
      io.to(currentSession).emit('session-updated', getPublicSession(session));
    }
  });

  // Ürün sil / azalt
  socket.on('remove-item', ({ itemId, targetUser }) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;

    const target = targetUser || currentUser;
    if (!session.users[target]) return;
    if (!canManage(session, currentUser, target)) return;

    const item = session.users[target].find((i) => i.id === itemId);
    if (item) {
      item.quantity -= 1;
      if (item.quantity <= 0) {
        session.users[target] = session.users[target].filter(
          (i) => i.id !== itemId
        );
      }
    }

    scheduleSave();
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  socket.on('disconnect', () => {
    // Kullanıcıyı silmiyoruz, verileri korunur
  });
});

// Kapatılırken kaydet
process.on('SIGTERM', () => { saveSessions(); process.exit(0); });
process.on('SIGINT', () => { saveSessions(); process.exit(0); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
