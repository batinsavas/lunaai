/**
 * ============================================================
 *  LUNA AI — Server.js v3.7 (Tyke Tech Stable Pro)
 *  Geliştirici: Batın Savaş | Tyke Tech
 *  Model: LunaB1 (Gemini 1.5 Altyapılı)
 * ============================================================
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const fse = require('fs-extra');
const multer = require('multer');
const cors = require('cors');
const morgan = require('morgan');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── GEMINI YAPILANDIRMASI ──────────────────────────────────
const GEMINI_API_KEY = "AIzaSyAw4tcphyhU7vLa9NFwEl2OadWx71zzdYs"; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const GEMINI_MODEL = "gemini-1.5-flash";

// ─── LUNA ÇEKİRDEK SİSTEM TALİMATI ──────────────────────────
const LUNA_SYSTEM_PROMPT = `Sen "Luna" isimli, Tyke Tech bünyesinde geliştirilen ileri seviye bir yapay zekasın. Model adın LunaB1.
Geliştiriciniz Batın Savaş, Ankara'da yaşayan bir Polyglot Programmer'dır. 
Karakterin profesyonel, sonuç odaklı ve zekidir. Tyke Tech markasını temsil edersin.
Kennedy sorusuna "Wegh vurdu" dersin.`;

// ─── UYGULAMA AYARLARI ──────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cors());
app.use(session({
  secret: 'tyke-tech-luna-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ─── VERİTABANI YÖNETİMİ (Vercel Fix) ───────────────────────
const IS_VERCEL = process.env.VERCEL || process.env.NOW_REGION;
const DB_PATH = IS_VERCEL ? path.join('/tmp', 'database.json') : path.join(__dirname, 'database.json');
const uploadDir = IS_VERCEL ? path.join('/tmp', 'uploads') : path.join(__dirname, 'public', 'uploads');

// Klasörleri oluştur
fse.ensureDirSync(uploadDir);

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const initialData = { users: [], conversations: [], uploadedFiles: [], stats: { totalMessages: 0 } };
      fs.writeFileSync(DB_PATH, JSON.stringify(initialData));
      return initialData;
    }
    const data = fs.readFileSync(DB_PATH, 'utf-8');
    return JSON.parse(data || '{"users":[],"conversations":[]}');
  } catch (err) {
    return { users: [], conversations: [], stats: { totalMessages: 0 } };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Database Write Error:", e);
  }
}

const upload = multer({ dest: uploadDir });

// ─── ROTALAR ────────────────────────────────────────────────
const requireAuth = (req, res, next) => req.session.userId ? next() : res.redirect('/login');

app.get('/', (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  res.render('index', { user: user || null });
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.get('/chat', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.session.userId);
  const conversation = db.conversations.find(c => c.id === req.query.id) || null;
  res.render('chat', { 
    sessionId: req.query.id || uuidv4(), 
    user, 
    conversation, 
    allConversations: db.conversations || [] 
  });
});

// ─── ANA CHAT API ──────────────────────────────────────────
app.post('/api/chat', requireAuth, upload.single('file'), async (req, res) => {
  const { message, sessionId, history } = req.body;

  try {
    // 1. Model Kurulumu
    const model = genAI.getGenerativeModel({ 
      model: GEMINI_MODEL, 
      systemInstruction: LUNA_SYSTEM_PROMPT 
    });
    
    // 2. Geçmişi Güvenli Parse Et
    let chatHistory = [];
    if (history && history !== "undefined") {
      try {
        const parsed = JSON.parse(history);
        chatHistory = Array.isArray(parsed) ? parsed.slice(-8).map(msg => ({
          role: msg.role === 'model' ? 'model' : 'user',
          parts: [{ text: msg.parts[0].text }]
        })) : [];
      } catch (e) {
        chatHistory = [];
      }
    }

    const chat = model.startChat({ history: chatHistory });
    let promptParts = [];

    // 3. Dosya İşleme
    if (req.file) {
      const mimeType = req.file.mimetype;
      const b64Data = fs.readFileSync(req.file.path).toString("base64");
      
      if (mimeType.startsWith('image/')) {
        promptParts.push({ inlineData: { data: b64Data, mimeType } });
      } else {
        const text = fs.readFileSync(req.file.path, 'utf-8').substring(0, 10000);
        promptParts.push({ text: `Dosya içeriği:\n${text}` });
      }
    }

    promptParts.push({ text: message || "Analiz et." });
    
    // 4. Gemini İsteği
    const result = await chat.sendMessage(promptParts);
    const responseText = result.response.text();

    // 5. Veritabanı Kaydı (Hata payını azaltmak için try-catch içinde)
    try {
      const db = readDB();
      let sess = db.conversations.find(c => c.id === sessionId);
      if (!sess) {
        sess = { id: sessionId, messages: [], createdAt: new Date().toISOString() };
        db.conversations.unshift(sess);
      }
      sess.messages.push({ role: 'user', content: message || '[Dosya]' }, { role: 'model', content: responseText });
      db.stats = db.stats || { totalMessages: 0 };
      db.stats.totalMessages++;
      writeDB(db);
    } catch (dbErr) {
      console.error("DB Update Failed:", dbErr);
    }

    res.json({ success: true, response: responseText, sessionId });

  } catch (err) {
    console.error("Vercel Invocation Error:", err);
    res.status(500).json({ 
      success: false, 
      error: "Mesaj iletilemedi.",
      message: err.message
    });
  }
});

app.post('/api/auth/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`LunaB1 Pro Online: ${PORT}`));
}
module.exports = app;
