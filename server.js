const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATABASE_URL = process.env.DATABASE_URL || '';
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
}) : null;

// ---- ???? ----
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---- ???? ----
const DEFAULT_DATA = {
  meta: { name: '??', createdAt: Date.now(), shareUrl: 'https://1f1484e89899432b898ee1b4f27da876.sh5.agentos-app.net' },
  adminToken: crypto.randomBytes(16).toString('hex'),
  story: { quick: { name: '?????', tag: '??' }, items: [] },
  outfit: { items: [] },
  shop: { tabs: ['????', '????', '????', '????'], hero: { title: '', image: '' }, items: [] }
};

// ---- ???? ----
function cloneDefaultData() {
  return JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function readLocalData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      writeLocalData(DEFAULT_DATA);
      return cloneDefaultData();
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Read data error:', e.message);
    return cloneDefaultData();
  }
}

function writeLocalData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

async function initDatabase() {
  if (!pool) {
    readLocalData();
    console.warn('DATABASE_URL ????????????????');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const seed = readLocalData();
  await pool.query(
    'INSERT INTO app_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(seed)]
  );
  console.log('PostgreSQL ??????');
}

async function readData() {
  if (!pool) return readLocalData();
  const result = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (!result.rows.length) {
    const data = cloneDefaultData();
    await writeData(data);
    return data;
  }
  return result.rows[0].data;
}

async function writeData(data) {
  if (!pool) {
    writeLocalData(data);
    return;
  }
  await pool.query(
    `INSERT INTO app_state (id, data, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)]
  );
}

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// ---- Multer ???? ----
const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// ---- ??? ----
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// ---- ????? ----
async function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const data = await readData();
  if (!token || token !== data.adminToken) {
    return res.status(401).json({ error: '???????????' });
  }
  req.data = data;
  next();
}

// ========== API ?? ==========

// ???????????? adminToken?
app.get('/api/data', asyncRoute(async (req, res) => {
  const data = await readData();
  const public = JSON.parse(JSON.stringify(data));
  delete public.adminToken;
  res.json(public);
}));

// ???????????/?? token?
app.post('/api/admin/login', asyncRoute(async (req, res) => {
  const { password } = req.body;
  const data = await readData();

  if (!password || password.length < 3) {
    return res.status(400).json({ error: '???? 3 ?' });
  }

  // ???????????? token
  if (!data.adminPassword) {
    data.adminPassword = password;
    data.adminToken = crypto.randomBytes(16).toString('hex');
    await writeData(data);
    return res.json({ token: data.adminToken, firstTime: true });
  }

  // ???????
  if (password !== data.adminPassword) {
    return res.status(403).json({ error: '????' });
  }

  // ????????? token???? token?
  if (!data.adminToken) {
    data.adminToken = crypto.randomBytes(16).toString('hex');
    await writeData(data);
  }

  res.json({ token: data.adminToken });
}));

// ??????????
app.post('/api/data', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const newData = req.body;
  // ?? adminToken ? adminPassword
  newData.adminToken = req.data.adminToken;
  newData.adminPassword = req.data.adminPassword;
  await writeData(newData);
  res.json({ ok: true });
}));

// ????????
app.post('/api/upload', asyncRoute(requireAdmin), upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '???????' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// ?????????????????????/?????
app.post('/api/upload/public', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '???????' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// ???????
app.post('/api/orders/outfit', asyncRoute(async (req, res) => {
  const { outfitId, name, time } = req.body;
  if (!outfitId || !name) return res.status(400).json({ error: '????' });

  const data = await readData();
  const outfit = (data.outfit.items || []).find(o => o.id === outfitId);
  if (!outfit) return res.status(404).json({ error: '?????' });

  outfit.orders = outfit.orders || [];
  outfit.orders.push({ name, time: time || Date.now() });
  await writeData(data);

  res.json({ ok: true });
}));

// ?????????
app.post('/api/orders/shop', asyncRoute(async (req, res) => {
  const { shopId, name, time } = req.body;
  if (!shopId || !name) return res.status(400).json({ error: '????' });

  const data = await readData();
  const item = (data.shop.items || []).find(s => s.id === shopId);
  if (!item) return res.status(404).json({ error: '?????' });

  item.orders = item.orders || [];
  item.orders.push({ name, time: time || Date.now() });
  await writeData(data);

  res.json({ ok: true });
}));

// ??????????
app.get('/api/orders', asyncRoute(requireAdmin), (req, res) => {
  const data = req.data;
  const outfitOrders = [];
  const shopOrders = [];

  (data.outfit.items || []).forEach(o => {
    (o.orders || []).forEach(ord => {
      outfitOrders.push({ type: '??', itemName: o.name, itemId: o.id, ...ord });
    });
  });

  (data.shop.items || []).forEach(s => {
    (s.orders || []).forEach(ord => {
      shopOrders.push({ type: '??', itemName: s.name, itemId: s.id, ...ord });
    });
  });

  res.json({
    outfitOrders,
    shopOrders,
    total: outfitOrders.length + shopOrders.length
  });
});

// ??????????????
app.get('/api/export', asyncRoute(requireAdmin), (req, res) => {
  const data = req.data;
  const exportData = JSON.parse(JSON.stringify(data));
  delete exportData.adminToken;
  res.setHeader('Content-Disposition', 'attachment; filename=qiao-day-backup.json');
  res.json(exportData);
});

// ????????
app.post('/api/import', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  try {
    const importData = req.body;
    importData.adminToken = req.data.adminToken;
    importData.adminPassword = req.data.adminPassword;
    await writeData(importData);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: '??????' });
  }
}));

// ???????
app.post('/api/admin/password', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 3) {
    return res.status(400).json({ error: '???? 3 ?' });
  }
  req.data.adminPassword = newPassword;
  req.data.adminToken = crypto.randomBytes(16).toString('hex');
  await writeData(req.data);
  res.json({ ok: true, token: req.data.adminToken });
}));

// ========== ?? ==========
app.use((err, req, res, next) => {
  console.error('Request error:', err);
  res.status(503).json({ error: '???????????????' });
});

async function start() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`???? ?????? http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('??????:', err);
  process.exit(1);
});
