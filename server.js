const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// --- SQLite ---
const db = new Database(path.join(__dirname, 'hesaptakip.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

const TTL = 24 * 60 * 60 * 1000; // 1 gün

// Süresi dolan session'ları temizle
function cleanExpired() {
  const cutoff = Date.now() - TTL;
  const deleted = db.prepare('DELETE FROM sessions WHERE created_at < ?').run(cutoff);
  if (deleted.changes > 0) {
    console.log(`${deleted.changes} süresi dolmuş session temizlendi`);
  }
}

// Başlangıçta ve her 10 dakikada temizle
cleanExpired();
setInterval(cleanExpired, 10 * 60 * 1000);

// DB yardımcıları
const stmtGet = db.prepare('SELECT data FROM sessions WHERE id = ?');
const stmtUpsert = db.prepare('INSERT OR REPLACE INTO sessions (id, data, created_at) VALUES (?, ?, ?)');
const stmtDelete = db.prepare('DELETE FROM sessions WHERE id = ?');

function getSession(id) {
  const row = stmtGet.get(id);
  if (!row) return null;
  try {
    const session = JSON.parse(row.data);
    if (Date.now() - session.createdAt > TTL) {
      stmtDelete.run(id);
      return null;
    }
    return session;
  } catch { return null; }
}

function saveSession(session) {
  stmtUpsert.run(session.id, JSON.stringify(session), session.createdAt);
}

// --- Uygulama ---

function generateSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function getPublicSession(session) {
  return {
    id: session.id,
    alias: session.alias || '',
    users: session.users,
    mode: session.mode,
    owner: session.owner,
    createdAt: session.createdAt
  };
}

function canManage(session, actor, target) {
  switch (session.mode) {
    case 'standard': return actor === target;
    case 'admin':    return actor === session.owner;
    case 'anonymous': return true;
    case 'hybrid':   return actor === session.owner || actor === target;
    default:         return actor === target;
  }
}

// Socket auth middleware
io.use((socket, next) => {
  const { sessionId, userName, token } = socket.handshake.auth || {};
  if (sessionId && userName && token) {
    const session = getSession(sessionId.toUpperCase());
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

  // Auth ile gelen kullanıcıyı otomatik odaya al
  if (currentSession && currentUser) {
    const session = getSession(currentSession);
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
    saveSession(session);

    currentSession = sessionId;
    currentUser = userName;
    socket.join(sessionId);

    socket.emit('session-joined', { sessionId, userName, token, session: getPublicSession(session) });
  });

  // Mevcut session'a katıl
  socket.on('join-session', ({ sessionId, userName, token }) => {
    const session = getSession(sessionId.toUpperCase());
    if (!session) {
      socket.emit('error-msg', 'Session bulunamadı!');
      return;
    }

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
    saveSession(session);

    socket.emit('session-joined', { sessionId: session.id, userName, token: newToken, session: getPublicSession(session) });
    socket.to(session.id).emit('session-updated', getPublicSession(session));
  });

  // Masa sahibi yeni kişi ekler
  socket.on('add-user', (userName) => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
    if (!session) return;
    if (currentUser !== session.owner) return;
    if (session.users[userName] !== undefined) {
      socket.emit('error-msg', 'Bu isim zaten var!');
      return;
    }

    session.users[userName] = [];
    saveSession(session);
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Kişiyi masadan çıkar (sadece masa sahibi)
  socket.on('remove-user', (userName) => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
    if (!session) return;
    if (currentUser !== session.owner) return;
    if (userName === session.owner) return;
    if (session.users[userName] === undefined) return;

    delete session.users[userName];
    delete session.tokens[userName];
    saveSession(session);
    io.to(currentSession).emit('session-updated', getPublicSession(session));
    io.to(currentSession).emit('user-removed', userName);
  });

  // Yeni ürün ekle
  socket.on('add-item', ({ name, price, targetUser }) => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
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

    saveSession(session);
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Ürün adedi artır
  socket.on('increment-item', ({ itemId, targetUser }) => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
    if (!session) return;

    const target = targetUser || currentUser;
    if (!session.users[target]) return;
    if (!canManage(session, currentUser, target)) return;

    const item = session.users[target].find((i) => i.id === itemId);
    if (item) {
      item.quantity += 1;
      saveSession(session);
      io.to(currentSession).emit('session-updated', getPublicSession(session));
    }
  });

  // Ürün sil / azalt
  socket.on('remove-item', ({ itemId, targetUser }) => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
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

    saveSession(session);
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Masa takma adı
  socket.on('set-alias', (alias) => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
    if (!session) return;

    session.alias = (alias || '').trim().substring(0, 20);
    saveSession(session);
    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Oturumu sonlandır (sadece masa sahibi)
  socket.on('end-session', () => {
    if (!currentSession || !currentUser) return;
    const session = getSession(currentSession);
    if (!session) return;
    if (currentUser !== session.owner) return;

    stmtDelete.run(currentSession);
    io.to(currentSession).emit('session-ended');
  });

  socket.on('disconnect', () => {
    // Kullanıcıyı silmiyoruz, verileri korunur
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
