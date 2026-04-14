const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Bellekte session'ları tut
const sessions = new Map();

function generateSessionId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Token'ları client'a göndermemek için
function getPublicSession(session) {
  return { id: session.id, users: session.users, createdAt: session.createdAt };
}

io.on('connection', (socket) => {
  let currentSession = null;
  let currentUser = null;

  // Yeni session oluştur
  socket.on('create-session', (userName) => {
    const sessionId = generateSessionId();
    const token = crypto.randomBytes(16).toString('hex');
    const session = {
      id: sessionId,
      users: {},
      tokens: {},
      createdAt: Date.now()
    };
    session.users[userName] = [];
    session.tokens[userName] = token;
    sessions.set(sessionId, session);

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
      if (session.tokens[userName] !== token) {
        socket.emit('error-msg', 'Bu isim başka biri tarafından kullanılıyor!');
        return;
      }
      currentSession = session.id;
      currentUser = userName;
      socket.join(session.id);
      socket.emit('session-joined', { sessionId: session.id, userName, token, session: getPublicSession(session) });
      return;
    }

    const newToken = crypto.randomBytes(16).toString('hex');
    session.users[userName] = [];
    session.tokens[userName] = newToken;
    currentSession = session.id;
    currentUser = userName;
    socket.join(session.id);

    socket.emit('session-joined', { sessionId: session.id, userName, token: newToken, session: getPublicSession(session) });
    socket.to(session.id).emit('session-updated', getPublicSession(session));
  });

  // Yeni ürün ekle
  socket.on('add-item', ({ name, price }) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;

    const parsedPrice = price ? parseFloat(price) : 0;
    const existing = session.users[currentUser].find(
      (i) => i.name === name && i.price === parsedPrice
    );

    if (existing) {
      existing.quantity += 1;
    } else {
      session.users[currentUser].push({
        id: crypto.randomBytes(4).toString('hex'),
        name,
        price: parsedPrice,
        quantity: 1
      });
    }

    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Ürün adedi artır
  socket.on('increment-item', (itemId) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;

    const item = session.users[currentUser].find((i) => i.id === itemId);
    if (item) {
      item.quantity += 1;
      io.to(currentSession).emit('session-updated', getPublicSession(session));
    }
  });

  // Ürün sil
  socket.on('remove-item', (itemId) => {
    if (!currentSession || !currentUser) return;
    const session = sessions.get(currentSession);
    if (!session) return;

    const item = session.users[currentUser].find((i) => i.id === itemId);
    if (item) {
      item.quantity -= 1;
      if (item.quantity <= 0) {
        session.users[currentUser] = session.users[currentUser].filter(
          (i) => i.id !== itemId
        );
      }
    }

    io.to(currentSession).emit('session-updated', getPublicSession(session));
  });

  // Bağlantı koptuğunda
  socket.on('disconnect', () => {
    // Kullanıcıyı silmiyoruz, verileri korunur
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
