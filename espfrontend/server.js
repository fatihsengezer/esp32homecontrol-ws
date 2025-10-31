const http = require("http");
const https = require("https");
const express = require("express");
const WebSocket = require("ws");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');
const { initDatabase, userDB, deviceDB, sessionDB, securityKeyDB, layoutDB, portDB, deviceConfigDB, configQueueDB, wolProfilesDB, deviceTokensDB, configHistoryDB } = require('./database');

const app = express();

// CORS ve parsers - credentials için özel ayarlar
app.use(cors({
  origin: ['https://fatihdev.xyz', 'https://fatihdev.xyz:5131', 'http://fatihdev.xyz', 'http://fatihdev.xyz:5131'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));
app.use(express.json());
app.use(cookieParser());

// HTTPS redirect (production için)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}

// Aktif session'lar (memory cache)
const activeSessions = new Map();

// WebSocket session tracking - device_id -> { ws, lastSeen, deviceInfo }
const wsSessions = new Map();

// Rate limiting için
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 dakika
const RATE_LIMIT_MAX_REQUESTS = 10; // Dakikada maksimum 10 istek

// Güvenlik anahtarı
function generateSecurityKey() {
  return crypto.randomBytes(32).toString('hex');
}

// Device token yönetimi
function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateShortLivedToken() {
  return crypto.randomBytes(16).toString('hex');
}

// Rate limiting kontrolü
function checkRateLimit(identifier) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitMap.has(identifier)) {
    rateLimitMap.set(identifier, []);
  }
  
  const requests = rateLimitMap.get(identifier);
  // Eski istekleri temizle
  const validRequests = requests.filter(timestamp => timestamp > windowStart);
  rateLimitMap.set(identifier, validRequests);
  
  if (validRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  validRequests.push(now);
  return true;
}

async function createUserSecurityKey(userIdOrUsername) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (!user) return null;
  const key = generateSecurityKey();
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await securityKeyDB.clearUserKeys(user.id);
  await securityKeyDB.createKey(user.id, key, expiresAt);
  return key;
}

async function validateSecurityKey(userIdOrUsername, key) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (!user) return false;
  const row = await securityKeyDB.validateKey(user.id, key);
  return !!row;
}

// Session
async function createSession(userId, rememberMe = false) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expires = rememberMe ? new Date(Date.now() + 30*24*60*60*1000) : new Date(Date.now() + 7*24*60*60*1000);
  await sessionDB.createSession(sessionId, userId, expires, rememberMe);
  activeSessions.set(sessionId, { userId, expires });
  return { sessionId, expires };
}

async function validateSession(sessionId) {
  if (!sessionId) return null;
  const m = activeSessions.get(sessionId);
  if (m && new Date() < m.expires) return m.userId;
  const dbRow = await sessionDB.getSession(sessionId);
  if (dbRow) {
    activeSessions.set(sessionId, { userId: dbRow.user_id, expires: new Date(dbRow.expires_at) });
    return dbRow.user_id;
  }
  return null;
}

async function requireAuth(req, res, next) {
  console.log('🔐 requireAuth çağrıldı - URL:', req.url);
  console.log('🔐 Request headers:', req.headers);
  console.log('🔐 Request cookies:', req.cookies);
  const sid = req.cookies.sessionId;
  console.log('🍪 Session ID from cookie:', sid ? sid.substring(0, 10) + '...' : 'YOK');
  const uid = await validateSession(sid);
  console.log('🔐 Validated user ID:', uid);
  if (!uid) {
    console.log('❌ Session geçersiz, 401 döndürülüyor');
    return res.status(401).json({ error: 'Session geçersiz', redirect: '/login' });
  }
  req.userId = uid;
  console.log('✅ Auth başarılı, userId:', uid);
  next();
}

// Sayfalar
app.get('/login', async (req, res) => {
  const sid = req.cookies.sessionId;
  const uid = await validateSession(sid);
  if (uid) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Statik dosyalar
app.use(express.static("public"));

// API endpoint'leri için özel CORS ayarları
app.use('/api', (req, res, next) => {
  // CORS headers - credentials için wildcard kullanma
  const origin = req.headers.origin;
  const allowedOrigins = ['https://fatihdev.xyz', 'https://fatihdev.xyz:5131', 'http://fatihdev.xyz', 'http://fatihdev.xyz:5131'];
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Test endpoint'i
app.get('/api/test', (req, res) => {
  console.log('🧪 Test API çağrıldı');
  res.json({ message: 'API çalışıyor!', timestamp: new Date().toISOString() });
});

// Basit user endpoint'i (auth olmadan)
app.get('/api/user-simple', (req, res) => {
  console.log('👤 User-simple API çağrıldı');
  res.json({ username: 'test', name: 'Test User', role: 'user' });
});

// API: Auth
app.post('/api/login', async (req, res) => {
  console.log('🔐 Login API çağrıldı:', req.body);
  try {
    const { username, password, rememberMe } = req.body;
    const user = await userDB.authenticate(username, password);
    if (!user) return res.status(401).json({ success:false, message:'Kullanıcı adı veya şifre hatalı!' });
    const sessionData = await createSession(user.id, !!rememberMe);
    console.log('🔐 Session oluşturuldu:', sessionData);
    
    const key = await createUserSecurityKey(user.username);
    console.log('🔐 Security key oluşturuldu:', key.substring(0, 8) + '...');
    
    const cookieOptions = { 
      httpOnly: true, 
      sameSite: 'lax', // Same-site için daha esnek
      path: '/' // Tüm path'lerde geçerli
    };
    if (rememberMe) cookieOptions.maxAge = 30*24*60*60*1000;
    
    res.cookie('sessionId', sessionData.sessionId, cookieOptions);
    console.log('🍪 Cookie ayarlandı:', sessionData.sessionId);
    console.log('🍪 Cookie options:', cookieOptions);
    
    res.json({ 
      success: true, 
      user: { username: user.username, name: user.name, role: user.role },
      sessionId: sessionData.sessionId // Debug için session ID'yi de döndür
    });
    console.log('✅ Login response gönderildi');
    console.log('🍪 Response headers:', res.getHeaders());
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ success:false, message:'Sunucu hatası!' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const sid = req.cookies.sessionId;
    if (sid) await sessionDB.deleteSession(sid);
    activeSessions.delete(sid);
    res.clearCookie('sessionId');
    res.json({ success:true });
  } catch (e) {
    res.clearCookie('sessionId');
    res.json({ success:true });
  }
});

app.get('/api/user', requireAuth, async (req, res) => {
  console.log('👤 User API çağrıldı, userId:', req.userId);
  console.log('👤 User API request headers:', req.headers);
  const u = await userDB.getUserById(req.userId);
  console.log('👤 User data from DB:', u);
  if (!u) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  res.json({ username:u.username, name:u.name, role:u.role });
  console.log('👤 User response gönderildi');
});

app.get('/api/security-key', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u) return res.status(404).json({ success:false, message:'Kullanıcı bulunamadı' });
  const key = await createUserSecurityKey(u.username);
  res.json({ success:true, securityKey:key });
});

app.get('/api/devices', requireAuth, async (req, res) => {
  console.log('📱 Devices API çağrıldı, userId:', req.userId);
  try {
    const devices = await deviceDB.getDevicesByOwner(req.userId);
    console.log('📱 Devices from DB:', devices);
    res.json(devices);
  } catch (error) {
    console.error('❌ Devices API error:', error);
    res.status(500).json({ error: 'Cihazlar yüklenemedi' });
  }
});

// Admin sayfası
app.get('/admin', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Admin: Users
app.get('/api/admin/users', requireAuth, async (req, res) => {
  const u = await userDB.getUserById(req.userId);
  if (!u || u.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const list = await userDB.getAllUsers();
  // map to expected fields
  const mapped = list.map(x => ({ id:x.id, username:x.username, full_name:x.name, email:x.email, role:x.role, is_active:x.is_active, created_at:x.created_at }));
  res.json(mapped);
});

app.get('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const u = await userDB.getUserById(req.params.userId);
  if (!u) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  res.json({ id:u.id, username:u.username, full_name:u.name, email:u.email||'', role:u.role, is_active:u.is_active, created_at:u.created_at });
});

app.post('/api/admin/users', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { username, full_name, email, password, role } = req.body;
  const created = await userDB.createUser({ username, password, name: full_name, email, role: role||'user' });
  res.json({ success:true, id:created.id });
});

app.put('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { username, full_name, name, email, role, is_active, password } = req.body;
  const update = {};
  if (typeof username === 'string' && username.trim().length) update.username = username.trim();
  const displayName = (typeof full_name === 'string' && full_name.trim().length) ? full_name.trim() : ((typeof name === 'string' && name.trim().length) ? name.trim() : undefined);
  if (displayName !== undefined) update.name = displayName;
  if (email !== undefined) update.email = email;
  if (role !== undefined) update.role = role;
  if (typeof is_active === 'boolean') update.is_active = is_active;
  // Şifre kontrolü - boş string değilse ve uzunluğu varsa güncelle
  if (password !== undefined && typeof password === 'string' && password.trim().length > 0) {
    update.password = password.trim();
    console.log(`🔐 Şifre güncelleme isteği: userId=${req.params.userId}, password length=${password.trim().length}`);
  } else {
    console.log(`⚠️ Şifre güncelleme yok: password=${password}, type=${typeof password}, length=${password ? password.length : 'N/A'}`);
  }
  try {
    console.log('📝 Update data:', JSON.stringify({ ...update, password: update.password ? '***' : undefined }));
    console.log('📝 Update keys:', Object.keys(update));
    const result = await userDB.updateUser(req.params.userId, update);
    console.log('✅ User update result:', result ? 'Success' : 'Failed');
    res.json({ success:true });
  } catch (e) {
    console.error('User update error:', e);
    res.status(500).json({ success:false, error:'Kullanıcı güncellenemedi: ' + (e.message || 'Bilinmeyen hata') });
  }
});

app.delete('/api/admin/users/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  if (String(req.params.userId) === String(req.userId)) return res.status(400).json({ error:'Kendi hesabınızı silemezsiniz!' });
  await userDB.deleteUser(req.params.userId);
  res.json({ success:true });
});

// Admin: Devices (DB tabanlı)
app.get('/api/admin/devices', requireAuth, async (req, res) => {
  console.log('GET /api/admin/devices çağrıldı');
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') {
    console.log('Admin erişimi reddedildi');
    return res.status(403).json({ error:'Admin erişimi gerekli!' });
  }
  console.log('Admin kullanıcı doğrulandı:', admin.username);
  try {
    const rows = await deviceDB.getAllDevices();
    console.log('Database\'den cihazlar alındı:', rows.length, 'cihaz');
    const mapped = rows.map(d => ({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_name:d.owner_name||'Sahipsiz', owner_id:d.owner_id||null, location:d.location||'Belirtilmemiş', description:d.description||'Açıklama yok' }));
    console.log('Mapped devices:', mapped);
    res.json(mapped);
  } catch (error) {
    console.error('Cihazlar alınırken hata:', error);
    res.status(500).json({ error:'Cihazlar alınamadı' });
  }
});

app.get('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const d = await deviceDB.getByDeviceId(req.params.deviceId);
  if (!d) return res.status(404).json({ error:'Cihaz bulunamadı!' });
  res.json({ device_id:d.device_id, device_name:d.device_name, ip_address:d.ip_address||'', mac_address:d.mac_address||'N/A', is_online:false, last_seen:null, owner_id:d.owner_id||'', owner_name:d.owner_name||'', location:d.location||'', description:d.description||'' });
});

app.post('/api/admin/devices', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { device_id, device_name, ip_address, mac_address, location, description } = req.body;
  let { owner_id, owner } = req.body;
  if (!device_id || !device_name) return res.status(400).json({ error:'Cihaz ID ve adı gerekli!' });
  if (!owner_id && owner) { const u = await userDB.getUserByUsername(owner); owner_id = u ? u.id : null; }
  const created = await deviceDB.createDevice({ device_id, device_name, ip_address, mac_address, location, description, owner_id: owner_id||null });
  res.json({ success:true, id:created.id });
});

app.put('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const { device_name, ip_address, mac_address, location, description, is_active } = req.body;
  let { owner_id, owner } = req.body;

  // Owner eşlemesi
  let ownerIdToSet;
  if (typeof owner === 'string') {
    if (owner.trim().length === 0) ownerIdToSet = null; else { const u = await userDB.getUserByUsername(owner); ownerIdToSet = u ? u.id : null; }
  } else if (owner_id !== undefined) {
    ownerIdToSet = owner_id;
  }

  // Sadece tanımlı alanları güncelle
  const update = {};
  if (device_name !== undefined) update.device_name = device_name;
  if (ip_address !== undefined) update.ip_address = ip_address;
  if (mac_address !== undefined) update.mac_address = mac_address;
  if (location !== undefined) update.location = location;
  if (description !== undefined) update.description = description;
  if (ownerIdToSet !== undefined) update.owner_id = ownerIdToSet;
  if (typeof is_active === 'boolean') update.is_active = is_active;

  try {
    console.log('📝 Device update request:', req.params.deviceId, JSON.stringify(update));
    await deviceDB.updateByDeviceId(req.params.deviceId, update);
    res.json({ success:true });
  } catch (e) {
    console.error('❌ Device update error:', e);
    res.status(500).json({ success:false, error:'Cihaz güncellenemedi: ' + (e.message || 'Bilinmeyen hata') });
  }
});

app.delete('/api/admin/devices/:deviceId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  await deviceDB.deleteByDeviceId(req.params.deviceId);
  res.json({ success:true });
});

// Kullanıcı layout API'leri
app.get('/api/admin/user-layouts', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const rows = await layoutDB.getAll();
  res.json(rows);
});

app.post('/api/admin/user-layouts/:userId', requireAuth, async (req, res) => {
  const admin = await userDB.getUserById(req.userId);
  if (!admin || admin.role !== 'admin') return res.status(403).json({ error:'Admin erişimi gerekli!' });
  const target = await userDB.getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error:'Kullanıcı bulunamadı!' });
  const layout = req.body?.layout; if (!layout || typeof layout !== 'object') return res.status(400).json({ error:'Geçersiz layout verisi' });
  await layoutDB.setForUser(target.id, JSON.stringify(layout));
  res.json({ success:true });
});

app.get('/api/user/layout', requireAuth, async (req, res) => {
  const json = await layoutDB.getForUser(req.userId);
  res.json({ layout: json ? JSON.parse(json) : null });
});

// ==================== PORT YÖNETİMİ API'LERİ ====================

// Kullanılan portları listele
app.get('/api/admin/ports', requireAuth, async (req, res) => {
  try {
    const usedPorts = await portDB.getUsedPorts();
    const availablePorts = [];
    
    // Kullanılabilir portları bul - sadece izin verilen portlar
    for (const port of portDB.ALLOWED_PORTS) {
      if (!usedPorts.some(p => p.websocket_port === port)) {
        availablePorts.push(port);
      }
    }
    
    res.json({
      usedPorts: usedPorts.map(p => ({
        userId: p.id,
        username: p.username,
        port: p.websocket_port
      })),
      availablePorts
    });
  } catch (error) {
    console.error('Port listesi hatası:', error);
    res.status(500).json({ error: 'Port listesi alınamadı' });
  }
});

// Kullanıcıya port ata
app.post('/api/admin/ports/assign', requireAuth, async (req, res) => {
  try {
    const { userId, port } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Kullanıcı ID gerekli' });
    }
    
    // Port belirtilmişse kontrol et
    if (port) {
      // Port izin verilen portlardan mı kontrol et
      if (!portDB.ALLOWED_PORTS.includes(port)) {
        return res.status(400).json({ error: 'Port izin verilen portlardan değil (5130, 5131, 5136)' });
      }
      
      const usedPorts = await portDB.getUsedPorts();
      if (usedPorts.some(p => p.websocket_port === port)) {
        return res.status(400).json({ error: 'Port zaten kullanımda' });
      }
      
      // Manuel port atama
      await userDB.updateUser(userId, { websocket_port: port });
      res.json({ success: true, port });
    } else {
      // Otomatik port atama
      const assignedPort = await portDB.assignPort(userId);
      res.json({ success: true, port: assignedPort });
    }
  } catch (error) {
    console.error('Port atama hatası:', error);
    res.status(500).json({ error: 'Port atanamadı' });
  }
});

// Kullanıcının portunu serbest bırak
app.delete('/api/admin/ports/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await userDB.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    }
    
    if (user.websocket_port) {
      await portDB.releasePort(user.websocket_port);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Port serbest bırakma hatası:', error);
    res.status(500).json({ error: 'Port serbest bırakılamadı' });
  }
});

// Kullanıcının portunu değiştir
app.put('/api/admin/ports/:userId', requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { port } = req.body;
    
    if (!port) {
      return res.status(400).json({ error: 'Port gerekli' });
    }
    
    // Port izin verilen portlardan mı kontrol et
    if (!portDB.ALLOWED_PORTS.includes(port)) {
      return res.status(400).json({ error: 'Port izin verilen portlardan değil (5130, 5131, 5136)' });
    }
    
    // Port kullanımda mı kontrol et
    const usedPorts = await portDB.getUsedPorts();
    if (usedPorts.some(p => p.websocket_port === port && p.id != userId)) {
      return res.status(400).json({ error: 'Port zaten kullanımda' });
    }
    
    // Eski portu serbest bırak
    const user = await userDB.getUserById(userId);
    if (user && user.websocket_port) {
      await portDB.releasePort(user.websocket_port);
    }
    
    // Yeni portu ata
    await userDB.updateUser(userId, { websocket_port: port });
    
    res.json({ success: true, port });
  } catch (error) {
    console.error('Port değiştirme hatası:', error);
    res.status(500).json({ error: 'Port değiştirilemedi' });
  }
});

// ==================== DEVICE CONFIG MANAGEMENT API ====================

// Cihaz konfigürasyonu gönder
app.post('/api/devices/:deviceId/config', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { config } = req.body;
    const userId = req.userId;
    
    // Rate limiting kontrolü
    if (!checkRateLimit(`config_${userId}`)) {
      return res.status(429).json({ error: 'Çok fazla istek, lütfen bekleyin' });
    }
    
    // Cihaz varlığını kontrol et
    const device = await deviceDB.getByDeviceId(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Cihaz bulunamadı' });
    }
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Config validasyonu
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: 'Geçersiz konfigürasyon verisi' });
    }
    
    // Payload oluştur
    const payload = {
      type: 'update_config',
      device_id: deviceId,
      token: generateShortLivedToken(),
      config: config,
      meta: {
        request_id: crypto.randomUUID(),
        timestamp: new Date().toISOString()
      }
    };
    
    // Konfigürasyonu gönder
    const result = await sendConfigToDevice(deviceId, payload, userId);
    
    res.json({
      success: true,
      ...result,
      device_id: deviceId
    });
    
  } catch (error) {
    console.error('Config gönderme hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon gönderilemedi: ' + error.message });
  }
});

// Cihazın mevcut konfigürasyonunu al
app.get('/api/devices/:deviceId/config', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const config = await deviceConfigDB.getLastConfig(deviceId);
    res.json({
      success: true,
      config: config ? config.config_json : null,
      applied: config ? config.applied : false,
      created_at: config ? config.created_at : null
    });
    
  } catch (error) {
    console.error('Config alma hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon alınamadı: ' + error.message });
  }
});

// WOL profilleri yönetimi
app.get('/api/devices/:deviceId/wol-profiles', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const profiles = await wolProfilesDB.getProfilesByDevice(deviceId);
    res.json({ success: true, profiles });
    
  } catch (error) {
    console.error('WOL profilleri alma hatası:', error);
    res.status(500).json({ error: 'WOL profilleri alınamadı: ' + error.message });
  }
});

app.post('/api/devices/:deviceId/wol-profiles', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { name, mac, broadcast_ip, port } = req.body;
    const userId = req.userId;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Validasyon
    if (!name || !mac || !broadcast_ip) {
      return res.status(400).json({ error: 'Name, MAC ve broadcast IP gerekli' });
    }
    
    const profile = await wolProfilesDB.addProfile(deviceId, name, mac, broadcast_ip, port || 9);
    res.json({ success: true, profile });
    
  } catch (error) {
    console.error('WOL profili ekleme hatası:', error);
    res.status(500).json({ error: 'WOL profili eklenemedi: ' + error.message });
  }
});

app.put('/api/devices/:deviceId/wol-profiles/:profileId', requireAuth, async (req, res) => {
  try {
    const { deviceId, profileId } = req.params;
    const { name, mac, broadcast_ip, port } = req.body;
    const userId = req.userId;
    
    console.log(`📝 WOL profili güncelleme isteği: deviceId=${deviceId}, profileId=${profileId}`);
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    // Profil var mı kontrol et
    const profiles = await wolProfilesDB.getProfilesByDevice(deviceId);
    const profile = profiles.find(p => p.id == profileId);
    if (!profile) {
      return res.status(404).json({ error: 'WOL profili bulunamadı' });
    }
    
    // Validasyon ve normalize
    const updateData = {};
    if (name !== undefined) {
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ error: 'Profil adı boş olamaz' });
      }
      updateData.name = name.trim();
    }
    if (mac !== undefined) {
      const normalizedMac = mac.trim().toUpperCase().replace(/[^0-9A-F:]/g, '');
      if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(normalizedMac)) {
        return res.status(400).json({ error: 'Geçersiz MAC adresi formatı' });
      }
      updateData.mac = normalizedMac;
    }
    if (broadcast_ip !== undefined) {
      const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipPattern.test(broadcast_ip)) {
        return res.status(400).json({ error: 'Geçersiz Broadcast IP formatı' });
      }
      updateData.broadcast_ip = broadcast_ip;
    }
    if (port !== undefined) {
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Geçersiz port numarası (1-65535)' });
      }
      updateData.port = portNum;
    }
    
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Güncellenecek alan belirtilmedi' });
    }
    
    const result = await wolProfilesDB.updateProfile(profileId, updateData);
    console.log(`✅ WOL profili güncellendi: ${profileId}`);
    
    // Cihaza senkronize et
    setTimeout(async () => {
      try {
        const allProfiles = await wolProfilesDB.getProfilesByDevice(deviceId);
        const syncProfiles = allProfiles.map(p => ({
          name: p.name,
          mac: p.mac,
          broadcast_ip: p.broadcast_ip,
          port: p.port || 9,
          ip: '0.0.0.0'
        }));
        
        await sendConfigToDevice(deviceId, {
          type: 'update_config',
          device_id: deviceId,
          // token otomatik olarak sendConfigToDevice içinde eklenecek
          config: { wol_profiles: syncProfiles },
          meta: {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString()
          }
        }, userId);
        
        console.log(`📤 Güncellenmiş WOL profilleri cihaza gönderildi: ${deviceId}`);
      } catch (err) {
        console.error('❌ WOL profilleri senkronizasyon hatası:', err);
      }
    }, 300);
    
    res.json({ success: true, profile: { id: profileId, ...updateData } });
    
  } catch (error) {
    console.error('❌ WOL profili güncelleme hatası:', error);
    res.status(500).json({ error: 'WOL profili güncellenemedi: ' + error.message });
  }
});

app.delete('/api/devices/:deviceId/wol-profiles/:profileId', requireAuth, async (req, res) => {
  try {
    const { deviceId, profileId } = req.params;
    const userId = req.userId;
    
    console.log(`🗑️ WOL profili silme isteği: deviceId=${deviceId}, profileId=${profileId}`);
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const result = await wolProfilesDB.deleteProfile(profileId);
    console.log(`✅ WOL profili silindi: ${profileId}`);
    
    // Cihaza senkronize et
    setTimeout(async () => {
      try {
        const allProfiles = await wolProfilesDB.getProfilesByDevice(deviceId);
        const syncProfiles = allProfiles.map(p => ({
          name: p.name,
          mac: p.mac,
          broadcast_ip: p.broadcast_ip,
          port: p.port || 9,
          ip: '0.0.0.0'
        }));
        
        await sendConfigToDevice(deviceId, {
          type: 'update_config',
          device_id: deviceId,
          // token otomatik olarak sendConfigToDevice içinde eklenecek
          config: { wol_profiles: syncProfiles },
          meta: {
            request_id: crypto.randomUUID(),
            timestamp: new Date().toISOString()
          }
        }, userId);
        
        console.log(`📤 Güncellenmiş WOL profilleri cihaza gönderildi: ${deviceId}`);
      } catch (err) {
        console.error('❌ WOL profilleri senkronizasyon hatası:', err);
      }
    }, 300);
    
    res.json({ success: true, deleted: result.deleted });
    
  } catch (error) {
    console.error('❌ WOL profili silme hatası:', error);
    res.status(500).json({ error: 'WOL profili silinemedi: ' + error.message });
  }
});

// Cihaz durumu ve kuyruk bilgisi
app.get('/api/devices/:deviceId/status', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    
    console.log(`🔧 Device status API çağrıldı - deviceId: ${deviceId}, userId: ${userId}`);
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      console.log(`❌ Yetki yok - deviceId: ${deviceId}, userId: ${userId}`);
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const device = await deviceDB.getByDeviceId(deviceId);
    const isOnline = wsSessions.has(deviceId);
    const session = wsSessions.get(deviceId);
    
    console.log(`🔧 Device: ${device ? device.device_name : 'Bilinmiyor'}, isOnline: ${isOnline}, session:`, session);
    console.log(`🔧 wsSessions keys:`, Array.from(wsSessions.keys()));
    
    // Kuyruk durumu
    const queueMessages = await configQueueDB.getPendingMessages();
    const deviceQueue = queueMessages.filter(msg => msg.device_id === deviceId);
    
    const response = {
      success: true,
      device: {
        device_id: deviceId,
        device_name: device ? device.device_name : 'Bilinmiyor',
        is_online: isOnline,
        last_seen: session ? new Date(session.lastSeen).toISOString() : null,
        firmware: session ? session.firmware : null,
        capabilities: session ? session.capabilities : [],
        queue_count: deviceQueue.length
      }
    };
    
    console.log(`🔧 Response gönderiliyor:`, response);
    res.json(response);
    
  } catch (error) {
    console.error('Cihaz durumu alma hatası:', error);
    res.status(500).json({ error: 'Cihaz durumu alınamadı: ' + error.message });
  }
});

// Konfigürasyon geçmişi
app.get('/api/devices/:deviceId/history', requireAuth, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.userId;
    const limit = parseInt(req.query.limit) || 50;
    
    // Yetki kontrolü
    const ownership = await checkDeviceOwnership(deviceId, userId);
    if (!ownership.allowed) {
      return res.status(403).json({ error: ownership.reason || 'Yetki yok' });
    }
    
    const history = await configHistoryDB.getHistoryByDevice(deviceId, limit);
    res.json({ success: true, history });
    
  } catch (error) {
    console.error('Konfigürasyon geçmişi alma hatası:', error);
    res.status(500).json({ error: 'Konfigürasyon geçmişi alınamadı: ' + error.message });
  }
});

// SSL sertifikalarını yükle
let sslOptions = null;
try {
  sslOptions = {
    key: fs.readFileSync('cert.key'),
    cert: fs.readFileSync('cert.pem')
  };
  console.log('✅ SSL sertifikaları yüklendi');
} catch (err) {
  console.error('❌ SSL sertifikaları yüklenemedi:', err.message);
  console.log('⚠️  HTTP server olarak çalışacak');
}

// HTTPS server ve WS (SSL varsa)
const server = sslOptions ? https.createServer(sslOptions, app) : http.createServer(app);
const wss = new WebSocket.Server({ server });

// API için ayrı server (default port)
const apiServer = sslOptions ? https.createServer(sslOptions, app) : http.createServer(app);
let connectedDevices = new Map(); // deviceId -> WebSocket mapping
let lastCommandsByDevice = new Map(); // deviceId -> { cmd:string, ts:number }

// WS: cihaz kayıtları ve güvenli komutlar
function addToHistory(_) {}

async function checkDeviceOwnership(deviceId, userIdOrUsername) {
  const user = typeof userIdOrUsername === 'number' ? await userDB.getUserById(userIdOrUsername) : await userDB.getUserByUsername(userIdOrUsername);
  if (user && user.role === 'admin') return { allowed:true };
  const dev = await deviceDB.getByDeviceId(deviceId);
  if (!dev) return { allowed:false, reason:'Cihaz bulunamadı' };
  if (!dev.owner_id) return { allowed:true };
  if (!user) return { allowed:false, reason:'Kullanıcı bulunamadı' };
  return { allowed: dev.owner_id === user.id, reason: dev.owner_id === user.id ? 'OK' : 'Yetki yok' };
}

// Konfigürasyon gönderme fonksiyonu
async function sendConfigToDevice(deviceId, payload, userId = null) {
  try {
    // Eğer payload'ta token yoksa, cihazın aktif token'ını al ve ekle
    if (!payload.token) {
      try {
        const tokenData = await deviceTokensDB.getActiveToken(deviceId);
        if (tokenData && tokenData.token) {
          payload.token = tokenData.token;
          console.log(`🔐 Cihazın aktif token'ı kullanılıyor: ${deviceId} (${tokenData.token.substring(0, 8)}...)`);
        } else {
          console.warn(`⚠️ Cihaz için aktif token bulunamadı: ${deviceId} - short-lived token kullanılacak`);
          payload.token = generateShortLivedToken();
        }
      } catch (tokenError) {
        console.error(`❌ Token alma hatası: ${tokenError.message}`);
        payload.token = generateShortLivedToken();
      }
    }
    
    const session = wsSessions.get(deviceId);
    
    if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
      // Cihaz online - doğrudan gönder
      try {
        session.ws.send(JSON.stringify(payload));
        console.log(`📤 Config gönderildi (online): ${deviceId}, token: ${payload.token.substring(0, 8)}...`);
        
        // Config'i veritabanına kaydet (applied=false)
        await deviceConfigDB.saveConfig(deviceId, payload.config, 1);
        
        // Geçmişe kaydet
        if (userId) {
          await configHistoryDB.addHistory(deviceId, userId, 'sent', payload.config);
        }
        
        return { sent: true, queued: false, message: 'Config cihaza gönderildi' };
      } catch (error) {
        console.error(`❌ Config gönderme hatası (online): ${error.message}`);
        // Hata durumunda kuyruğa ekle
        await configQueueDB.addToQueue(deviceId, payload);
        if (userId) {
          await configHistoryDB.addHistory(deviceId, userId, 'queued', payload.config, error.message);
        }
        return { sent: false, queued: true, message: 'Cihaz online ama gönderim başarısız, kuyruğa eklendi' };
      }
    } else {
      // Cihaz offline - kuyruğa ekle
      await configQueueDB.addToQueue(deviceId, payload);
      console.log(`📋 Config kuyruğa eklendi (offline): ${deviceId}, token: ${payload.token ? payload.token.substring(0, 8) + '...' : 'YOK'}`);
      
      if (userId) {
        await configHistoryDB.addHistory(deviceId, userId, 'queued', payload.config);
      }
      
      return { sent: false, queued: true, message: 'Cihaz offline, kuyruğa eklendi' };
    }
  } catch (error) {
    console.error(`❌ sendConfigToDevice hatası: ${error.message}`);
    if (userId) {
      await configHistoryDB.addHistory(deviceId, userId, 'failed', payload.config, error.message);
    }
    return { sent: false, queued: false, message: 'Hata: ' + error.message };
  }
}

// Frontend client'lara mesaj gönder (broadcast)
function broadcastToClients(message) {
  const msgStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.userId) {
      client.send(msgStr);
    }
  });
}

// WOL profillerini ESP32'den alıp veritabanıyla senkronize et
async function handleWOLProfilesFromDevice(ws, data) {
  try {
    const { deviceId, profiles } = data;
    
    if (!deviceId || !Array.isArray(profiles)) {
      console.log('⚠️ Geçersiz WOL profilleri mesajı:', data);
      return;
    }
    
    console.log(`📥 ESP32'den WOL profilleri alındı: ${deviceId} (${profiles.length} profil)`);
    
    // Veritabanındaki mevcut profilleri al
    const dbProfiles = await wolProfilesDB.getProfilesByDevice(deviceId);
    const dbProfilesMap = new Map(dbProfiles.map(p => [p.mac.toUpperCase().replace(/[^0-9A-F:]/g, ''), p]));
    
    // ESP32'den gelen profilleri işle
    for (const espProfile of profiles) {
      const { name, mac, ip, broadcast_ip, port } = espProfile;
      
      if (!name || !mac) {
        console.log(`⚠️ Geçersiz profil atlanıyor:`, espProfile);
        continue;
      }
      
      // MAC adresini normalize et
      const normalizedMac = mac.toUpperCase().replace(/[^0-9A-F:]/g, '');
      
      // Veritabanında bu MAC adresiyle profil var mı?
      const existingProfile = dbProfilesMap.get(normalizedMac);
      
      if (existingProfile) {
        // Profil var - güncelle (sadece farklıysa)
        const needsUpdate = 
          existingProfile.name !== name ||
          existingProfile.broadcast_ip !== (broadcast_ip || '192.168.1.255') ||
          existingProfile.port !== (port || 9);
        
        if (needsUpdate) {
          console.log(`🔄 Profil güncelleniyor: ${name} (${normalizedMac})`);
          await wolProfilesDB.updateProfile(existingProfile.id, {
            name,
            broadcast_ip: broadcast_ip || '192.168.1.255',
            port: port || 9
          });
        }
      } else {
        // Profil yok - ekle
        console.log(`➕ Yeni profil ekleniyor: ${name} (${normalizedMac})`);
        await wolProfilesDB.addProfile(
          deviceId,
          name,
          normalizedMac,
          broadcast_ip || '192.168.1.255',
          port || 9
        );
      }
    }
    
    console.log(`✅ WOL profilleri senkronizasyonu tamamlandı: ${deviceId}`);
    
    // Frontend'e bildir (broadcast)
    const updatedProfiles = await wolProfilesDB.getProfilesByDevice(deviceId);
    broadcastToClients({
      type: 'wol_profiles_updated',
      deviceId,
      profiles: updatedProfiles
    });
    
  } catch (error) {
    console.error('❌ WOL profilleri senkronizasyon hatası:', error);
  }
}

// Device identify handler
async function handleDeviceIdentify(ws, data) {
  try {
    const { device_id, firmware, token, capabilities } = data;
    console.log(`🔧 handleDeviceIdentify çağrıldı - device_id: ${device_id}, token: ${token ? 'var' : 'yok'}`);
    
    if (!device_id) {
      ws.send(JSON.stringify({ type: 'error', message: 'device_id gerekli' }));
      return;
    }
    
    // Token doğrulama
    let isValidToken = false;
    if (token) {
      const tokenData = await deviceTokensDB.validateToken(device_id, token);
      isValidToken = !!tokenData;
    }
    
    if (!isValidToken) {
      // Yeni cihaz veya geçersiz token - pairing token oluştur
      const pairingToken = generateShortLivedToken();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 dakika
      
      await deviceTokensDB.createToken(device_id, pairingToken, 'pairing', expiresAt.getTime());
      
      ws.send(JSON.stringify({
        type: 'pairing_required',
        device_id,
        pairing_token: pairingToken,
        expires_in: 600 // 10 dakika
      }));
      
      console.log(`🔐 Pairing token oluşturuldu: ${device_id} - ${pairingToken}`);
      return;
    }
    
    // Geçerli token - cihazı kaydet/güncelle
    const deviceInfo = {
      device_id,
      firmware: firmware || 'unknown',
      capabilities: capabilities || [],
      lastSeen: Date.now()
    };
    
    wsSessions.set(device_id, { ws, ...deviceInfo });
    ws.deviceId = device_id;
    ws.isDevice = true;
    
    console.log(`✅ Cihaz wsSessions'a eklendi: ${device_id}`);
    console.log(`🔧 wsSessions keys:`, Array.from(wsSessions.keys()));
    
    // Cihaz bilgilerini veritabanında güncelle (mevcut değerleri koru)
    const existingDevice = await deviceDB.getByDeviceId(device_id);
    await deviceDB.updateByDeviceId(device_id, {
      device_name: data.device_name || (existingDevice ? existingDevice.device_name : device_id),
      ip_address: (data.ip_address !== undefined && data.ip_address !== null && data.ip_address !== '') ? data.ip_address : (existingDevice ? existingDevice.ip_address : ''),
      mac_address: (data.mac_address !== undefined && data.mac_address !== null && data.mac_address !== '') ? data.mac_address : (existingDevice ? existingDevice.mac_address : ''),
      location: existingDevice ? (existingDevice.location || (data.location || 'Otomatik Eklenen')) : (data.location || 'Otomatik Eklenen'),
      description: existingDevice ? (existingDevice.description || (data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`)) : (data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`),
      owner_id: existingDevice ? existingDevice.owner_id || null : null,
      is_active: 1
    });
    
    // Bekleyen konfigürasyonları gönder
    const pendingConfigs = await deviceConfigDB.getPendingConfigs(device_id);
    for (const config of pendingConfigs) {
      // Cihazın aktif token'ını al
      let tokenToUse = null;
      try {
        const tokenData = await deviceTokensDB.getActiveToken(device_id);
        if (tokenData && tokenData.token) {
          tokenToUse = tokenData.token;
          console.log(`🔐 Bekleyen config için token kullanılıyor: ${device_id} (${tokenToUse.substring(0, 8)}...)`);
        }
      } catch (tokenError) {
        console.error(`❌ Token alma hatası: ${tokenError.message}`);
      }
      
      const payload = {
        type: 'update_config',
        device_id,
        token: tokenToUse || generateShortLivedToken(),
        config: config.config_json,
        meta: {
          request_id: crypto.randomUUID(),
          timestamp: new Date().toISOString()
        }
      };
      
      try {
        ws.send(JSON.stringify(payload));
        console.log(`📤 Bekleyen config gönderildi: ${device_id}`);
      } catch (error) {
        console.error(`❌ Bekleyen config gönderme hatası: ${error.message}`);
      }
    }
    
    // Kuyruktaki mesajları işle
    const queueMessages = await configQueueDB.getPendingMessages();
    const deviceMessages = queueMessages.filter(msg => msg.device_id === device_id);
    
    for (const message of deviceMessages) {
      try {
        ws.send(JSON.stringify(message.payload));
        await configQueueDB.updateMessageStatus(message.id, 'sent');
        console.log(`📤 Kuyruk mesajı gönderildi: ${device_id}`);
      } catch (error) {
        console.error(`❌ Kuyruk mesajı gönderme hatası: ${error.message}`);
        await configQueueDB.updateMessageStatus(message.id, 'failed', error.message);
      }
    }
    
    // Persistent token oluştur
    const persistentToken = generateShortLivedToken();
    const tokenExpires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 gün
    
    await deviceTokensDB.createToken(device_id, persistentToken, 'persistent', tokenExpires.getTime());
    
    ws.send(JSON.stringify({
      type: 'identify_success',
      device_id,
      message: 'Cihaz başarıyla tanımlandı',
      persistent_token: persistentToken
    }));
    
    console.log(`✅ Cihaz tanımlandı: ${device_id} (${firmware}) - Persistent token: ${persistentToken.substring(0, 8)}...`);
    
  } catch (error) {
    console.error(`❌ Device identify hatası: ${error.message}`);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Cihaz tanımlama hatası: ' + error.message
    }));
  }
}

wss.on("connection", (ws) => {
  console.log('🔌 WebSocket client connected');
  console.log('🔌 Current wsSessions:', Array.from(wsSessions.keys()));
  console.log('🔌 Current ESP32 status:', connectedDevices.size > 0 ? `${connectedDevices.size} cihaz bağlı` : 'Cihaz yok');
  ws.on('message', async (msg) => {
    msg = msg.toString();
    try {
      if (msg.startsWith('{')) {
        console.log('🔧 Raw message received:', msg);
        const data = JSON.parse(msg);
        if (data.type === 'userAuth') {
          ws.userId = data.userId; // username
        } else if (data.type === 'identify') {
          // ESP32 cihaz kimlik doğrulama
          console.log('🔧 ESP32 identify mesajı alındı:', data);
          await handleDeviceIdentify(ws, data);
        } else if (data.type === 'config_applied') {
          // ESP32'den config uygulandı onayı
          const { device_id, request_id, status, details } = data;
          if (device_id && status === 'ok') {
            await deviceConfigDB.markConfigApplied(device_id, request_id);
            console.log(`✅ Config uygulandı: ${device_id}`);
            
            // Cihaz IP/MAC bilgilerini güncelle
            if (details && (details.ip || details.mac)) {
              await deviceDB.updateByDeviceId(device_id, {
                ip_address: details.ip || '',
                mac_address: details.mac || ''
              });
            }
          }
        } else if (data.type === 'wol_profiles') {
          // ESP32'den WOL profilleri geldi - veritabanıyla senkronize et
          await handleWOLProfilesFromDevice(ws, data);
        } else if (data.type === 'deviceSelection') {
          // Client seçili cihazı değiştirdi
          ws.selectedDeviceId = data.deviceId;
          console.log(`Client seçili cihazı değiştirdi: ${data.deviceId}`);
        } else if (data.type === 'frontend' && data.request === 'getDeviceRegistry') {
          // Frontend'den cihaz kayıtları isteniyor
          console.log('getDeviceRegistry request from user:', ws.userId);
          try {
            if (!ws.userId) {
              console.log('No userId in WebSocket, sending error');
              ws.send(JSON.stringify({ type:'error', message:'Kullanıcı kimliği bulunamadı' }));
              return;
            }
            const user = await userDB.getUserByUsername(ws.userId);
            if (!user) {
              console.log('User not found in database:', ws.userId);
              ws.send(JSON.stringify({ type:'error', message:'Kullanıcı bulunamadı' }));
              return;
            }
            
            let devices;
            if (user.role === 'admin') {
              // Admin tüm cihazları görebilir
              devices = await deviceDB.getAllDevices();
            } else {
              // Normal kullanıcı sadece kendi cihazlarını görebilir
              devices = await deviceDB.getDevicesByOwner(user.id);
            }
            
            // Cihazları frontend formatına çevir
            const mappedDevices = devices.map(d => ({
              deviceId: d.device_id,
              deviceName: d.device_name,
              isOnline: connectedDevices.has(d.device_id), // Cihaz bağlı mı kontrolü
              ipAddress: d.ip_address || '',
              macAddress: d.mac_address || '',
              location: d.location || '',
              description: d.description || '',
              ownerName: d.owner_name || 'Sahipsiz'
            }));
            
            ws.send(JSON.stringify({
              type: 'deviceRegistry',
              devices: mappedDevices
            }));
            
            console.log(`Device registry sent to frontend (filtered for user ${user.username})`);
          } catch (error) {
            console.error('Device registry error:', error);
            ws.send(JSON.stringify({ type:'error', message:'Cihaz kayıtları alınamadı' }));
          }
        } else if (data.type === 'heartbeat' && data.deviceId) {
          // ESP32 heartbeat mesajı - ESP32'yi tanımla ve otomatik kaydet
          const deviceId = data.deviceId;
          connectedDevices.set(deviceId, ws);
          // Bu bağlantıyı cihaz olarak işaretle
          ws.isDevice = true;
          ws.deviceId = deviceId;
          console.log(`ESP32 kayıt edildi: ${data.deviceName || deviceId} (ID: ${deviceId})`);
          
          // Cihazı otomatik olarak database'e kaydet/güncelle
          try {
            const existingDevice = await deviceDB.getByDeviceId(data.deviceId);
            if (existingDevice) {
              // Mevcut cihazı güncelle (kalıcı alanları koruyarak)
              await deviceDB.updateByDeviceId(data.deviceId, {
                device_name: data.deviceName || existingDevice.device_name,
                ip_address: (data.ip_address !== undefined && data.ip_address !== null && data.ip_address !== '') ? data.ip_address : existingDevice.ip_address,
                mac_address: (data.mac_address !== undefined && data.mac_address !== null && data.mac_address !== '') ? data.mac_address : existingDevice.mac_address,
                location: existingDevice.location || data.location || existingDevice.location,
                description: existingDevice.description || data.description || existingDevice.description,
                owner_id: existingDevice.owner_id,
                is_active: 1
              });
              console.log(`Cihaz güncellendi: ${data.deviceId}`);
            } else {
              // Yeni cihaz oluştur
              await deviceDB.createDevice({
                device_id: data.deviceId,
                device_name: data.deviceName || data.deviceId,
                ip_address: data.ip_address || '',
                mac_address: data.mac_address || '',
                location: data.location || 'Otomatik Eklenen',
                description: data.description || `ESP32 cihazı - ${new Date().toLocaleString('tr-TR')}`,
                owner_id: null
              });
              console.log(`Yeni cihaz eklendi: ${data.deviceId} - ${data.deviceName || data.deviceId}`);
            }
            
            // Admin panelindeki cihaz listesini güncelle
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'deviceUpdated',
                  deviceId: data.deviceId,
                  action: existingDevice ? 'updated' : 'added'
                }));
              }
            });
          } catch (error) {
            console.error('Cihaz kayıt/güncelleme hatası:', error);
          }
          
          // Heartbeat'i tüm client'lara yayınla
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
          return;
        } else if (data.type === 'secureCommand') {
          const { userId, securityKey, deviceId, command } = data;
          const valid = await validateSecurityKey(userId, securityKey);
          if (!valid) {
            ws.send(JSON.stringify({ type:'error', message:'Geçersiz güvenlik anahtarı veya süresi dolmuş' }));
            return;
          }
          const own = await checkDeviceOwnership(deviceId, userId);
          if (!own.allowed) {
            ws.send(JSON.stringify({ type:'error', message: own.reason || 'Yetki yok' }));
            return;
          }
          // Aynı komutu kısa süre içinde tekrar göndermeyi engelle (debounce)
          try {
            const now = Date.now();
            const prev = lastCommandsByDevice.get(deviceId);
            const signature = `${deviceId}:${command}`;
            if (prev && prev.cmd === signature && (now - prev.ts) < 400) {
              console.log(`Debounced duplicate command to ${deviceId}: ${command}`);
              return;
            }
            lastCommandsByDevice.set(deviceId, { cmd: signature, ts: now });
          } catch (e) {
            // ignore debounce errors
          }
          // Komutu hedef cihaza ilet
          const targetDevice = connectedDevices.get(deviceId);
          if (targetDevice && targetDevice.readyState === WebSocket.OPEN) {
            targetDevice.send(command);
            console.log(`Komut gönderildi: ${command} -> ${deviceId}`);
          } else {
            ws.send(JSON.stringify({ type:'error', message:`Cihaz çevrimdışı: ${deviceId}` }));
            console.log(`Cihaz çevrimdışı: ${deviceId}`);
          }
        } else if (ws.isDevice) {
          // ESP32'den gelen diğer JSON mesajları (status, relay, wol vb.) client'lara yayınla
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
          return;
        }
      } else {
        // Legacy/düz metin mesajlar: getWolStatus, getRelayStatus vb.
        if (msg.includes('esp32:online') || msg.startsWith('status:') || msg.startsWith('relay:') || msg.startsWith('wol:')) {
          // ESP32'den gelen legacy mesajlar
          if (msg.startsWith('status:') || msg.startsWith('relay:') || msg.startsWith('wol:')) {
            wss.clients.forEach(client => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(msg);
              }
            });
            return;
          }
          return;
        }
        
        // Client -> ESP32 (getWolStatus, getRelayStatus vb.) - sadece seçili cihaza gönder
        if (ws.userId && !ws.isDevice) {
          // Bu bir client mesajı, seçili cihaza gönder
          const selectedDeviceId = ws.selectedDeviceId; // Varsayılan kaldırıldı
          if (!selectedDeviceId) {
            ws.send(JSON.stringify({ type:'error', message:'Önce cihaz seçin' }));
            return;
          }
          const targetDevice = connectedDevices.get(selectedDeviceId);
          if (targetDevice && targetDevice.readyState === WebSocket.OPEN) {
            // Aynı cihaz bağlantısına geri gönderimi engelle
            if (targetDevice !== ws) {
              targetDevice.send(msg);
            }
            console.log(`Client request forwarded to ESP32 (${selectedDeviceId}): ${msg}`);
          } else {
            console.log(`ESP32 not available for message: ${msg} (target: ${selectedDeviceId})`);
            ws.send(JSON.stringify({ type:'error', message:`Cihaz çevrimdışı: ${selectedDeviceId}` }));
          }
        }
        
        // ESP32 -> Clients
        if (ws.isDevice) {
          wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(msg);
            }
          });
        }
      }
    } catch (e) {
      console.error('WS error:', e);
    }
  });
  ws.on('close', () => {
    // Bağlantı kapanan cihazı listeden çıkar
    for (const [deviceId, deviceWs] of connectedDevices.entries()) {
      if (deviceWs === ws) {
        connectedDevices.delete(deviceId);
        console.log(`ESP32 bağlantısı kapandı: ${deviceId}`);
        break;
      }
    }
    
    // WebSocket session'ı temizle
    if (ws.deviceId) {
      wsSessions.delete(ws.deviceId);
      console.log(`WebSocket session temizlendi: ${ws.deviceId}`);
    }
  });
});

// Ana sayfa route'u
app.get('/', requireAuth, (req, res) => {
  console.log('🏠 Ana sayfa route çağrıldı, userId:', req.userId);
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Background queue worker
async function startQueueWorker() {
  console.log('🔄 Queue worker başlatılıyor...');
  
  setInterval(async () => {
    try {
      // Bekleyen mesajları al
      const pendingMessages = await configQueueDB.getPendingMessages();
      
      for (const message of pendingMessages) {
        const { id, device_id, payload, retries, max_retries } = message;
        
        // Maksimum deneme sayısını kontrol et
        if (retries >= max_retries) {
          await configQueueDB.updateMessageStatus(id, 'failed', 'Maksimum deneme sayısı aşıldı');
          console.log(`❌ Mesaj başarısız (max retries): ${device_id}`);
          continue;
        }
        
        // Cihaz online mı kontrol et
        const session = wsSessions.get(device_id);
        if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
          try {
            // Mesajı gönder
            session.ws.send(JSON.stringify(payload));
            await configQueueDB.updateMessageStatus(id, 'sent');
            console.log(`📤 Kuyruk mesajı gönderildi: ${device_id}`);
          } catch (error) {
            console.error(`❌ Kuyruk mesajı gönderme hatası: ${error.message}`);
            await configQueueDB.updateMessageStatus(id, 'failed', error.message);
          }
        } else {
          // Cihaz hala offline, bir sonraki döngüde tekrar dene
          console.log(`⏳ Cihaz offline, mesaj bekletiliyor: ${device_id}`);
        }
      }
      
      // Başarısız mesajları temizle (24 saatten eski)
      const cleaned = await configQueueDB.cleanupFailedMessages();
      if (cleaned.cleaned > 0) {
        console.log(`🧹 ${cleaned.cleaned} başarısız mesaj temizlendi`);
      }
      
    } catch (error) {
      console.error('❌ Queue worker hatası:', error);
    }
  }, 30000); // 30 saniyede bir çalış
  
  console.log('✅ Queue worker başlatıldı');
}

// Server başlatma
(async () => {
  try {
    await initDatabase();
    console.log('✅ Veritabanı başlatıldı');
    await sessionDB.cleanExpiredSessions();
    console.log('✅ Süresi dolmuş session\'lar temizlendi');
    
    // Queue worker'ı başlat
    await startQueueWorker();
    // WebSocket server (port 5131)
    server.listen(5131, '0.0.0.0', () => {
      const protocol = sslOptions ? 'WSS (HTTPS)' : 'WS (HTTP)';
      console.log(`WebSocket server running on port 5131 - ${protocol}`);
      console.log(`WebSocket URL: ${sslOptions ? 'wss://' : 'ws://'}fatihdev.xyz:5131/`);
    });
    
    // API server (port 5130)
    apiServer.listen(5130, '0.0.0.0', () => {
      const protocol = sslOptions ? 'HTTPS' : 'HTTP';
      console.log(`API server running on port 5130 - ${protocol}`);
      console.log(`API URL: ${sslOptions ? 'https://' : 'http://'}fatihdev.xyz:5130/api/`);
      console.log(`Test API: ${sslOptions ? 'https://' : 'http://'}fatihdev.xyz:5130/api/test`);
    });
  } catch (e) {
    console.error('❌ Server init error:', e);
    process.exit(1);
  }
})();
