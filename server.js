const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const DATABASE_URL = process.env.DATABASE_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'qiao-day-images';
const FILES_BUCKET = process.env.SUPABASE_FILES_BUCKET || 'qiao-day-files';
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(DATABASE_URL) ? false : { rejectUnauthorized: false }
}) : null;
const supabase = SUPABASE_URL && SUPABASE_SECRET_KEY ? createClient(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
) : null;

// ---- 确保目录 ----
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

// ---- 默认数据 ----
const DEFAULT_DATA = {
  meta: { name: '瞧瞧', createdAt: Date.now(), shareUrl: 'https://1f1484e89899432b898ee1b4f27da876.sh5.agentos-app.net' },
  adminToken: crypto.randomBytes(16).toString('hex'),
  story: { avatar: 'assets/qiaoqiao-avatar.jpg', quick: { name: '瞧瞧小档案', tag: '回归' }, items: [] },
  outfit: { items: [] },
  shop: { tabs: ['灵感上新', '联名周边', '文创产品', '电子瞧瞧'], hero: { title: '', image: '' }, items: [] }
};

// ---- 读写数据 ----
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
    console.warn('DATABASE_URL 未配置，当前使用本地临时文件存储');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_backups (
      id BIGSERIAL PRIMARY KEY,
      data JSONB NOT NULL,
      reason TEXT NOT NULL DEFAULT 'daily',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const seed = readLocalData();
  await pool.query(
    'INSERT INTO app_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
    [JSON.stringify(seed)]
  );
  await ensureDailyBackup('startup');
  console.log('PostgreSQL 数据库已连接');
}

async function ensureDailyBackup(reason = 'daily') {
  if (!pool) return null;
  const result = await pool.query(`
    INSERT INTO app_backups (data, reason)
    SELECT data, $1 FROM app_state
    WHERE id = 1
      AND NOT EXISTS (
        SELECT 1 FROM app_backups
        WHERE created_at >= DATE_TRUNC('day', NOW())
      )
    RETURNING id, created_at
  `, [reason]);
  return result.rows[0] || null;
}

async function createBackup(reason = 'manual') {
  if (!pool) {
    const err = new Error('云数据库未配置，无法创建云端备份');
    err.status = 503;
    throw err;
  }
  const result = await pool.query(`
    INSERT INTO app_backups (data, reason)
    SELECT data, $1 FROM app_state WHERE id = 1
    RETURNING id, reason, created_at
  `, [reason]);
  return result.rows[0];
}

async function trimOldBackups() {
  if (!pool) return;
  await pool.query(`
    DELETE FROM app_backups
    WHERE id NOT IN (
      SELECT id FROM app_backups ORDER BY created_at DESC LIMIT 30
    )
  `);
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
  await ensureDailyBackup('before-change');
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

// ---- Supabase Storage 图片上传 ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // Supabase Free 上限 50MB
  fileFilter: (req, file, cb) => {
    const isZipName = /\.zip$/i.test(file.originalname || '');
    const allowedTypes = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    cb(null, isZipName && allowedTypes.includes(file.mimetype));
  }
});

async function ensurePublicBucket(name, options) {
  const { data, error } = await supabase.storage.getBucket(name);
  if (!error && data) {
    console.log(`Supabase Storage 已连接: ${name}`);
    return;
  }
  const { error: createError } = await supabase.storage.createBucket(name, {
    public: true,
    ...options
  });
  if (createError) throw createError;
  console.log(`Supabase Storage 存储桶已创建: ${name}`);
}

async function initStorage() {
  if (!supabase) {
    console.warn('Supabase Storage 未配置，图片上传已禁用以防止数据丢失');
    return;
  }
  await ensurePublicBucket(STORAGE_BUCKET, {
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
  });
  try {
    await ensurePublicBucket(FILES_BUCKET, {
      fileSizeLimit: 50 * 1024 * 1024,
      allowedMimeTypes: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream']
    });
  } catch (error) {
    console.error(`Supabase 文件存储桶不可用: ${error.message}`);
  }
}

async function uploadImageToCloud(file) {
  if (!supabase) {
    const err = new Error('图片云存储尚未配置，请联系管理员');
    err.status = 503;
    throw err;
  }
  const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
  const objectPath = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

async function uploadZipToCloud(file) {
  if (!supabase) {
    const err = new Error('文件云存储尚未配置，请联系管理员');
    err.status = 503;
    throw err;
  }
  const objectPath = `downloads/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.zip`;
  const { error } = await supabase.storage.from(FILES_BUCKET).upload(objectPath, file.buffer, {
    contentType: 'application/zip',
    cacheControl: '3600',
    upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from(FILES_BUCKET).getPublicUrl(objectPath);
  return data.publicUrl;
}

// ---- 中间件 ----
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ---- 管理员鉴权 ----
async function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const data = await readData();
  if (!token || token !== data.adminToken) {
    return res.status(401).json({ error: '未授权，需要管理员登录' });
  }
  req.data = data;
  next();
}

// ========== API 路由 ==========

app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: Date.now(), database: Boolean(pool), storage: Boolean(supabase) });
});

// 公开：获取所有数据（不含 adminToken）
app.get('/api/data', asyncRoute(async (req, res) => {
  const data = await readData();
  const public = JSON.parse(JSON.stringify(data));
  delete public.adminToken;
  res.json(public);
}));

// 管理员登录（用密码生成/返回 token）
app.post('/api/admin/login', asyncRoute(async (req, res) => {
  const { password } = req.body;
  const data = await readData();

  if (!password || password.length < 3) {
    return res.status(400).json({ error: '密码至少 3 位' });
  }

  // 首次使用：设置密码，生成 token
  if (!data.adminPassword) {
    data.adminPassword = password;
    data.adminToken = crypto.randomBytes(16).toString('hex');
    await writeData(data);
    return res.json({ token: data.adminToken, firstTime: true });
  }

  // 已有密码：校验
  if (password !== data.adminPassword) {
    return res.status(403).json({ error: '密码错误' });
  }

  // 密码正确，返回现有 token（或刷新 token）
  if (!data.adminToken) {
    data.adminToken = crypto.randomBytes(16).toString('hex');
    await writeData(data);
  }

  res.json({ token: data.adminToken });
}));

// 管理员：保存全量数据
app.post('/api/data', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const newData = req.body;
  // 保留 adminToken 和 adminPassword
  newData.adminToken = req.data.adminToken;
  newData.adminPassword = req.data.adminPassword;
  await writeData(newData);
  res.json({ ok: true });
}));

// 管理员：上传图片
app.post('/api/upload', asyncRoute(requireAdmin), upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
  const url = await uploadImageToCloud(req.file);
  res.json({ url });
}));

// 公开：上传图片（访客也可上传，比如提交故事/推荐穿搭）
app.post('/api/upload/public', upload.single('image'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
  const url = await uploadImageToCloud(req.file);
  res.json({ url });
}));

// 管理员：上传可下载的 ZIP 文件（桌宠等电子产品）
app.post('/api/upload/file', asyncRoute(requireAdmin), zipUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请上传有效的 ZIP 文件' });
  const url = await uploadZipToCloud(req.file);
  res.json({ url, name: req.file.originalname, size: req.file.size });
}));

// 公开：下单穿搭
app.post('/api/orders/outfit', asyncRoute(async (req, res) => {
  const { outfitId, name, time } = req.body;
  if (!outfitId || !name) return res.status(400).json({ error: '缺少参数' });

  const data = await readData();
  const outfit = (data.outfit.items || []).find(o => o.id === outfitId);
  if (!outfit) return res.status(404).json({ error: '穿搭不存在' });

  outfit.orders = outfit.orders || [];
  outfit.orders.push({ name, time: time || Date.now() });
  await writeData(data);

  res.json({ ok: true });
}));

// 公开：下单周边商品
app.post('/api/orders/shop', asyncRoute(async (req, res) => {
  const { shopId, name, time } = req.body;
  if (!shopId || !name) return res.status(400).json({ error: '缺少参数' });

  const data = await readData();
  const item = (data.shop.items || []).find(s => s.id === shopId);
  if (!item) return res.status(404).json({ error: '商品不存在' });

  item.orders = item.orders || [];
  item.orders.push({ name, time: time || Date.now() });
  await writeData(data);

  res.json({ ok: true });
}));

// 管理员：查看所有订单
app.get('/api/orders', asyncRoute(requireAdmin), (req, res) => {
  const data = req.data;
  const outfitOrders = [];
  const shopOrders = [];

  (data.outfit.items || []).forEach(o => {
    (o.orders || []).forEach(ord => {
      outfitOrders.push({ type: '穿搭', itemName: o.name, itemId: o.id, ...ord });
    });
  });

  (data.shop.items || []).forEach(s => {
    (s.orders || []).forEach(ord => {
      shopOrders.push({ type: '周边', itemName: s.name, itemId: s.id, ...ord });
    });
  });

  res.json({
    outfitOrders,
    shopOrders,
    total: outfitOrders.length + shopOrders.length
  });
});

// 导出全部数据（管理员备份用）
app.get('/api/export', asyncRoute(requireAdmin), (req, res) => {
  const data = req.data;
  const exportData = JSON.parse(JSON.stringify(data));
  delete exportData.adminToken;
  res.setHeader('Content-Disposition', 'attachment; filename=qiao-day-backup.json');
  res.json(exportData);
});

// 管理员：导入数据
app.post('/api/import', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  try {
    const importData = req.body;
    importData.adminToken = req.data.adminToken;
    importData.adminPassword = req.data.adminPassword;
    await writeData(importData);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: '数据格式错误' });
  }
}));

// 管理员：查看最近备份状态
app.get('/api/backups', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  if (!pool) return res.json({ enabled: false, backups: [] });
  const result = await pool.query(`
    SELECT id, reason, created_at
    FROM app_backups
    ORDER BY created_at DESC
    LIMIT 30
  `);
  res.json({ enabled: true, backups: result.rows });
}));

// 管理员：立即创建一份云端备份
app.post('/api/backups', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const backup = await createBackup('manual');
  await trimOldBackups();
  res.json({ ok: true, backup });
}));

// 修改管理员密码
app.post('/api/admin/password', asyncRoute(requireAdmin), asyncRoute(async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 3) {
    return res.status(400).json({ error: '密码至少 3 位' });
  }
  req.data.adminPassword = newPassword;
  req.data.adminToken = crypto.randomBytes(16).toString('hex');
  await writeData(req.data);
  res.json({ ok: true, token: req.data.adminToken });
}));

// ========== 启动 ==========
app.use((err, req, res, next) => {
  console.error('Request error:', err);
  res.status(err.status || 503).json({ error: err.message || '数据服务暂时不可用，请稍后重试' });
});

async function start() {
  await initDatabase();
  await initStorage();
  if (pool) {
    const backupTimer = setInterval(async () => {
      try {
        await ensureDailyBackup('daily');
        await trimOldBackups();
      } catch (error) {
        console.error('自动备份失败:', error.message);
      }
    }, 6 * 60 * 60 * 1000);
    if (backupTimer.unref) backupTimer.unref();
  }
  app.listen(PORT, () => {
    console.log(`瞧的一天 服务端运行在 http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('服务启动失败:', err);
  process.exit(1);
});
