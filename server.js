const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// ---- 确保目录 ----
if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---- 默认数据 ----
const DEFAULT_DATA = {
  meta: { name: '瞧瞧', createdAt: Date.now(), shareUrl: 'https://1f1484e89899432b898ee1b4f27da876.sh5.agentos-app.net' },
  adminToken: crypto.randomBytes(16).toString('hex'),
  story: { quick: { name: '瞧瞧小档案', tag: '回归' }, items: [] },
  outfit: { items: [] },
  shop: { tabs: ['灵感上新', '联名周边', '主粮零食', '日用好物'], hero: { title: '', image: '' }, items: [] }
};

// ---- 读写数据 ----
function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      writeData(DEFAULT_DATA);
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Read data error:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- Multer 图片上传 ----
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

// ---- 中间件 ----
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(__dirname));

// ---- 管理员鉴权 ----
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  const data = readData();
  if (!token || token !== data.adminToken) {
    return res.status(401).json({ error: '未授权，需要管理员登录' });
  }
  req.data = data;
  next();
}

// ========== API 路由 ==========

// 公开：获取所有数据（不含 adminToken）
app.get('/api/data', (req, res) => {
  const data = readData();
  const public = JSON.parse(JSON.stringify(data));
  delete public.adminToken;
  res.json(public);
});

// 管理员登录（用密码生成/返回 token）
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const data = readData();

  if (!password || password.length < 3) {
    return res.status(400).json({ error: '密码至少 3 位' });
  }

  // 首次使用：设置密码，生成 token
  if (!data.adminPassword) {
    data.adminPassword = password;
    data.adminToken = crypto.randomBytes(16).toString('hex');
    writeData(data);
    return res.json({ token: data.adminToken, firstTime: true });
  }

  // 已有密码：校验
  if (password !== data.adminPassword) {
    return res.status(403).json({ error: '密码错误' });
  }

  // 密码正确，返回现有 token（或刷新 token）
  if (!data.adminToken) {
    data.adminToken = crypto.randomBytes(16).toString('hex');
    writeData(data);
  }

  res.json({ token: data.adminToken });
});

// 管理员：保存全量数据
app.post('/api/data', requireAdmin, (req, res) => {
  const newData = req.body;
  // 保留 adminToken 和 adminPassword
  newData.adminToken = req.data.adminToken;
  newData.adminPassword = req.data.adminPassword;
  writeData(newData);
  res.json({ ok: true });
});

// 管理员：上传图片
app.post('/api/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// 公开：上传图片（访客也可上传，比如提交故事/推荐穿搭）
app.post('/api/upload/public', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未收到图片文件' });
  const url = '/uploads/' + req.file.filename;
  res.json({ url });
});

// 公开：下单穿搭
app.post('/api/orders/outfit', (req, res) => {
  const { outfitId, name, time } = req.body;
  if (!outfitId || !name) return res.status(400).json({ error: '缺少参数' });

  const data = readData();
  const outfit = (data.outfit.items || []).find(o => o.id === outfitId);
  if (!outfit) return res.status(404).json({ error: '穿搭不存在' });

  outfit.orders = outfit.orders || [];
  outfit.orders.push({ name, time: time || Date.now() });
  writeData(data);

  res.json({ ok: true });
});

// 公开：下单周边商品
app.post('/api/orders/shop', (req, res) => {
  const { shopId, name, time } = req.body;
  if (!shopId || !name) return res.status(400).json({ error: '缺少参数' });

  const data = readData();
  const item = (data.shop.items || []).find(s => s.id === shopId);
  if (!item) return res.status(404).json({ error: '商品不存在' });

  item.orders = item.orders || [];
  item.orders.push({ name, time: time || Date.now() });
  writeData(data);

  res.json({ ok: true });
});

// 管理员：查看所有订单
app.get('/api/orders', requireAdmin, (req, res) => {
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
app.get('/api/export', requireAdmin, (req, res) => {
  const data = req.data;
  const exportData = JSON.parse(JSON.stringify(data));
  delete exportData.adminToken;
  res.setHeader('Content-Disposition', 'attachment; filename=qiao-day-backup.json');
  res.json(exportData);
});

// 管理员：导入数据
app.post('/api/import', requireAdmin, (req, res) => {
  try {
    const importData = req.body;
    importData.adminToken = req.data.adminToken;
    importData.adminPassword = req.data.adminPassword;
    writeData(importData);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: '数据格式错误' });
  }
});

// 修改管理员密码
app.post('/api/admin/password', requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 3) {
    return res.status(400).json({ error: '密码至少 3 位' });
  }
  req.data.adminPassword = newPassword;
  req.data.adminToken = crypto.randomBytes(16).toString('hex');
  writeData(req.data);
  res.json({ ok: true, token: req.data.adminToken });
});

// ========== 启动 ==========
app.listen(PORT, () => {
  console.log(`瞧的一天 服务端运行在 http://localhost:${PORT}`);
  // 初始化数据
  readData();
  console.log(`管理员 Token: ${readData().adminToken}`);
});
