/* =====================================================
   瞧的一天 - 云端版
   4个Tab: 小故事 / 穿搭 / 周边 / 我的
   数据存服务器端，无 localStorage 容量限制
   管理员密码登录，游客可浏览/点单
   ===================================================== */
// ===== 全局错误捕获（调试用，确保任何错误都可见）=====
window.onerror = function(msg, url, line, col, err) {
  var hint = document.getElementById('loadingHint');
  if (hint) hint.textContent = 'JS错误: ' + String(msg).substring(0, 100) + ' (行' + line + ')';
  console.error('GLOBAL ERROR:', msg, line, col, err);
};
window.addEventListener('unhandledrejection', function(e) {
  var hint = document.getElementById('loadingHint');
  if (hint) hint.textContent = 'Promise错误: ' + String(e.reason).substring(0, 100);
  console.error('UNHANDLED REJECTION:', e.reason);
});
/* =====================================================
===================================================== */

(function () {
  'use strict';
  // 全局错误兜底：把错误直接显示在页面上，方便排查
  function showFatalError(title, detail) {
    try {
      const main = document.querySelector('#main');
      if (main) {
        main.innerHTML = '<div style="padding:60px 24px 40px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">🐶</div><p style="color:#333;font-size:16px;margin-bottom:8px;">' + String(title || '页面出错了') + '</p><p style="font-size:12px;line-height:1.6;word-break:break-all;">' + String(detail || '').replace(/</g, '&lt;') + '</p><button onclick="location.reload(true)" style="margin-top:20px;padding:10px 20px;border-radius:20px;border:none;background:#d4a574;color:#fff;font-size:14px;">刷新重试</button></div>';
      }
    } catch (e) {}
  }
  window.onerror = function (msg, url, line, col, err) {
    console.error('Global error:', msg, url, line, col, err);
    showFatalError('运行报错：' + String(msg), url + ':' + line + ':' + col);
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    console.error('Unhandled rejection:', e.reason);
    showFatalError('异步报错：' + String(e.reason && e.reason.message ? e.reason.message : e.reason), '');
  });

  // ========== API 配置 ==========
  const API_BASE = 'https://qiao-day.onrender.com';
  let adminToken = null; // 管理员登录后存内存

  // ========== 工具函数 ==========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const escape = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmtDate = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtDateShort = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  const uploadedImageUrls = new WeakMap();

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0KB';
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }

  function compressImageFile(file, maxSize = 1920, quality = 0.82) {
    if (!file || !file.type.startsWith('image/')) return Promise.reject(new Error('请选择图片文件'));
    if (file.type === 'image/gif') return Promise.resolve(file);
    if (file.size > 30 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 30MB'));
    if (file.size <= 900 * 1024) return Promise.resolve(file);

    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let width = img.naturalWidth || img.width;
        let height = img.naturalHeight || img.height;
        const scale = Math.min(1, maxSize / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('图片压缩失败'));
          if (blob.size >= file.size) return resolve(file);
          const baseName = (file.name || 'qiaoqiao').replace(/\.[^.]+$/, '');
          resolve(new File([blob], baseName + '.webp', { type: 'image/webp', lastModified: Date.now() }));
        }, 'image/webp', quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('无法读取这张图片'));
      };
      img.src = objectUrl;
    });
  }



  // 图片转 base64（压缩到适合 localStorage）
  function fileToCompressedDataURL(file, maxW = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let w = img.width, h = img.height;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Toast
  let toastTimer = null;
  function toast(msg, dur = 1800) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), dur);
  }

  // 弹窗
  function showModal(opts) {
    const { title = '提示', html = '', footer = '', closeOnMask = true } = opts || {};
    const mask = $('#modalMask');
    const modal = $('#modal');
    modal.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${title}</div>
        <button class="modal-close" id="modalClose">×</button>
      </div>
      <div class="modal-body">${html}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    `;
    mask.classList.add('show');
    modal.classList.add('show');
    $('#modalClose').onclick = closeModal;
    mask.onclick = (e) => { if (e.target === mask && closeOnMask) closeModal(); };
    return modal;
  }
  function closeModal() {
    $('#modalMask').classList.remove('show');
    $('#modal').classList.remove('show');
  }
  window.closeModal = closeModal;

  // ========== 状态管理 / API 交互 ==========
  let state = null;
  let isAdmin = false;
  let useServer = true;
  let currentTab = 'story';
  let isLoading = false;
  const INTERACTION_KEY = 'qiaoday_interactions_v1';
  const SCROLL_KEY = 'qiaoday_scroll_positions_v1';
  const UI_STATE_KEY = 'qiaoday_ui_state_v1';
  let interactions = loadInteractions();
  let scrollPositions = loadScrollPositions();

  const DEFAULT_DATA = {
    meta: { name: '瞧瞧', createdAt: Date.now(), shareUrl: window.location.origin + '/' },
    story: { avatar: 'assets/qiaoqiao-avatar.jpg', quick: { name: '瞧瞧小档案', tag: '回归' }, items: [] },
    outfit: { items: [] },
    shop: { tabs: ['灵感上新', '联名周边', '文创产品', '电子瞧瞧'], hero: { title: '', image: '' }, items: [] },
    comments: []
  };

  function loadInteractions() {
    try { return JSON.parse(localStorage.getItem(INTERACTION_KEY) || '{"liked":{},"favorites":{}}'); }
    catch (e) { return { liked: {}, favorites: {} }; }
  }
  function saveInteractions() {
    localStorage.setItem(INTERACTION_KEY, JSON.stringify(interactions));
  }
  function interactionId(type, id) { return type + ':' + id; }
  function isLiked(type, id) { return Boolean(interactions.liked[interactionId(type, id)]); }
  function isFavorite(type, id) { return Boolean(interactions.favorites[interactionId(type, id)]); }
  function loadScrollPositions() {
    try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveScrollPositions() {
    try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(scrollPositions)); } catch (e) {}
  }
  function loadUiState() {
    try { return JSON.parse(sessionStorage.getItem(UI_STATE_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveUiState() {
    try {
      sessionStorage.setItem(UI_STATE_KEY, JSON.stringify({
        tab: currentTab,
        shopTab: Number(state?.shop?.activeTab || 0)
      }));
    } catch (e) {}
  }

  // 带超时的 fetch
  function fetchWithTimeout(url, opts = {}, timeout = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  }

  async function apiCall(method, url, body = null, isFormData = false) {
    const opts = { method, headers: {} };
    if (adminToken) opts.headers['x-admin-token'] = adminToken;
    if (body && !isFormData) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (body && isFormData) {
      opts.body = body;
    }
    const res = await fetchWithTimeout(API_BASE + url, opts, isFormData ? 120000 : 10000);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '请求失败 (HTTP ' + res.status + ')' }));
      throw new Error(err.error || '请求失败');
    }
    return res.json();
  }

  // 从服务器加载数据（公开接口）
  async function checkServer() {
    try { const res = await fetchWithTimeout(API_BASE + '/api/data', {}, 3000); if (res.ok) return true; } catch (e) {}
    return false;
  }
  async function loadState() {
    if (isLoading) return;
    isLoading = true;
    // 先快速检测服务器（3 秒），不在线则直接用本地数据
    const online = await checkServer();
    if (!online) {
      useServer = false;
      state = loadLocalState();
      isLoading = false;
      return;
    }
    // 服务器在线，拉取最新数据
    try {
      const data = await apiCall('GET', '/api/data');
      state = { ...DEFAULT_DATA, ...data, meta: { ...DEFAULT_DATA.meta, ...(data.meta || {}) }, story: { ...DEFAULT_DATA.story, ...(data.story || {}) }, outfit: { ...DEFAULT_DATA.outfit, ...(data.outfit || {}) }, shop: { ...DEFAULT_DATA.shop, ...(data.shop || {}) } };
      if (!state.outfit.items) state.outfit.items = [];
      if (!state.shop.items) state.shop.items = [];
      if (!state.story.items) state.story.items = [];
      if (!state.story.quick) state.story.quick = DEFAULT_DATA.story.quick;
      state.visitor = loadLocalVisitor();
    } catch (e) {
      useServer = false;
      state = loadLocalState();
      console.error(e);
    }
    isLoading = false;
  }

  // 管理员保存数据到服务器
  async function saveState() {
    if (useServer) { try {
      await apiCall('POST', '/api/data', state);
      return true;
    } catch (e) {
      if (e.message && e.message.includes('未授权')) {
        showModal({ title: '权限过期', html: '<p style="text-align:center;">管理员登录已过期，请重新登录。</p>' });
        isAdmin = false;
        render();
      } else {
        showModal({ title: '保存失败', html: `<p style="text-align:center;">${escape(e.message)}</p>` });
      }
      return false;
    }
  }
    saveLocalState();
    return true;
  }

  // 上传图片到服务器
  async function uploadImage(file) {
    if (!file) return '';
    if (uploadedImageUrls.has(file)) return uploadedImageUrls.get(file);
    try {
      toast('正在压缩并上传图片…', 6000);
      const optimized = await compressImageFile(file);
      if (optimized !== file) toast(`图片已压缩：${formatBytes(file.size)} → ${formatBytes(optimized.size)}`, 3500);
      if (!useServer) throw new Error('云端尚未连接，请稍后重试');
      const form = new FormData(); form.append('image', optimized, optimized.name);
      const data = await apiCall('POST', isAdmin ? '/api/upload' : '/api/upload/public', form, true);
      const url = /^https?:\/\//.test(data.url) ? data.url : API_BASE + data.url;
      uploadedImageUrls.set(file, url);
      toast('图片已保存到云端');
      return url;
    } catch(e) {
      toast(e.message || '图片上传失败，请稍后重试', 4000);
      return '';
    }
  }
  function fileToBase64Local(file, maxW) {
    maxW = maxW || 800;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(e) {
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          var w = img.width, h = img.height;
          if (w > maxW) { h = h * maxW / w; w = maxW; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // 上传图片（公开接口，访客也可用）
  async function uploadImagePublicLegacy(file) {
    const optimized = await compressImageFile(file);
    const form = new FormData();
    form.append('image', optimized, optimized.name);
    // 不用 admin token
    const res = await fetch(API_BASE + '/api/upload/public', { method: 'POST', body: form });
    if (!res.ok) throw new Error('上传失败');
    const data = await res.json();
    return /^https?:\/\//.test(data.url) ? data.url : API_BASE + data.url;
  }

  async function uploadDownloadFile(file) {
    const form = new FormData();
    form.append('file', file);
    return apiCall('POST', '/api/upload/file', form, true);
  }

  // ---- localStorage 降级 ----
  const LS_KEY = 'qiaoday_data_v1';
  function loadLocalState() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const merged = { ...DEFAULT_DATA, ...p, meta: { ...DEFAULT_DATA.meta, ...(p.meta||{}) }, story: { ...DEFAULT_DATA.story, ...(p.story||{}) }, outfit: { ...DEFAULT_DATA.outfit, ...(p.outfit||{}) }, shop: { ...DEFAULT_DATA.shop, ...(p.shop||{}) } };
        // 确保所有嵌套字段都有默认值，防止旧数据/损坏数据导致渲染报错
        if (!merged.story || typeof merged.story !== 'object') merged.story = JSON.parse(JSON.stringify(DEFAULT_DATA.story));
        if (!merged.story.quick || !merged.story.quick.name) merged.story.quick = JSON.parse(JSON.stringify(DEFAULT_DATA.story.quick));
        if (!Array.isArray(merged.story.items)) merged.story.items = [];
        if (!merged.outfit || typeof merged.outfit !== 'object') merged.outfit = JSON.parse(JSON.stringify(DEFAULT_DATA.outfit));
        if (!Array.isArray(merged.outfit.items)) merged.outfit.items = [];
        if (!merged.shop || typeof merged.shop !== 'object') merged.shop = JSON.parse(JSON.stringify(DEFAULT_DATA.shop));
        if (!Array.isArray(merged.shop.items)) merged.shop.items = [];
        if (!Array.isArray(merged.shop.tabs) || !merged.shop.tabs.length) merged.shop.tabs = JSON.parse(JSON.stringify(DEFAULT_DATA.shop.tabs));
        if (!merged.visitor || typeof merged.visitor !== 'object') merged.visitor = { nickname: '', avatar: '' };
        return merged;
      }
    } catch(e) {}
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  function saveLocalState() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; }
    catch(e) {
      showModal({ title: '存储空间不足', html: '<div style="text-align:center;padding:10px 0;"><div style="font-size:48px;">💾</div><p>浏览器存储已满</p><p style="color:#999;font-size:12px;">请部署后端获得无限容量</p></div>' });
      return false;
    }
  }
  // ---- 本地保留访客信息 ----
  function loadLocalVisitor() {
    try {
      return JSON.parse(localStorage.getItem('qiaoday_visitor') || '{"nickname":"","avatar":""}');
    } catch (e) { return { nickname: '', avatar: '' }; }
  }
  function saveLocalVisitor() {
    localStorage.setItem('qiaoday_visitor', JSON.stringify(state.visitor));
  }

  // ========== 路由 ==========
  function switchTab(tab) {
    const validTabs = ['story', 'outfit', 'shop', 'me'];
    if (!validTabs.includes(tab)) tab = 'story';
    const main = $('#main');
    if (main && currentTab) {
      scrollPositions[currentTab] = main.scrollTop;
      saveScrollPositions();
    }
    const previousTab = currentTab;
    currentTab = tab;
    if (tab === 'shop' && previousTab !== 'shop' && state?.shop) state.shop.activeTab = 0;
    saveUiState();
    $$('.tab-item').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
    // 顶部黑条显示策略
    const topBar = $('#topBar');
    const topTitle = $('#topTitle');
    const topSub = $('#topSub');
    if (tab === 'story') {
      topBar.classList.remove('show');
    } else if (tab === 'outfit') {
      topBar.classList.add('show');
      topTitle.textContent = '日常穿搭 · 风格随意';
      topSub.textContent = '瞧瞧衣橱 ›';
    } else if (tab === 'shop') {
      topBar.classList.add('show');
      topTitle.textContent = '瞧的周边 · 慢慢逛';
      topSub.textContent = '瞧瞧商店 ›';
    } else if (tab === 'me') {
      topBar.classList.add('show');
      topTitle.textContent = isAdmin ? '管理员模式' : '个人中心';
      topSub.textContent = isAdmin ? '⚙️ 瞧瞧后厨' : '我的瞧瞧 ›';
    }
    render();
    requestAnimationFrame(() => {
      const nextMain = $('#main');
      if (nextMain) nextMain.scrollTop = Number(scrollPositions[tab] || 0);
    });
  }

  // ========== 渲染入口 ==========
  function render() {
    try {
      const main = $('#main');
      const restoreTop = Number(scrollPositions[currentTab] || 0);
      if (currentTab === 'story') main.innerHTML = renderStory();
      else if (currentTab === 'outfit') main.innerHTML = renderOutfit();
      else if (currentTab === 'shop') main.innerHTML = renderShop();
      else if (currentTab === 'me') main.innerHTML = renderMe();
      bindTabEvents();
      if (isAdmin) bindAdminFab();
      requestAnimationFrame(() => { if (main) main.scrollTop = restoreTop; });
    } catch (e) {
      console.error('render error', e);
      const main = $('#main');
      if (main) {
        main.innerHTML = '<div style="padding:60px 24px 40px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">🐶</div><p style="color:#333;font-size:16px;margin-bottom:8px;">页面渲染出错</p><p style="font-size:12px;line-height:1.6;word-break:break-all;">' + String(e && e.message ? e.message : e).replace(/</g, '&lt;') + '</p><button onclick="location.reload(true)" style="margin-top:20px;padding:10px 20px;border-radius:20px;border:none;background:#d4a574;color:#fff;font-size:14px;">刷新重试</button></div>';
      }
    }
    // 清理加载提示
    const hint = $('#loadingHint');
    if (hint) hint.remove();
  }

  function renderActionIcon(name, active) {
    if (name === 'like') return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
    if (name === 'favorite') return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11a1 1 0 0 1 1 1V21L12 17l-6.5 4V4.5a1 1 0 0 1 1-1Z" ${active ? 'fill="currentColor"' : 'fill="none"'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }

  function renderSocialActions(type, item) {
    const liked = isLiked(type, item.id);
    const favorite = isFavorite(type, item.id);
    return `<div class="social-actions">
      <button class="social-btn${liked ? ' active' : ''}" data-like-type="${type}" data-like-id="${item.id}" aria-label="喜欢" title="喜欢">${renderActionIcon('like', liked)}</button>
      <button class="social-btn${favorite ? ' active' : ''}" data-favorite-type="${type}" data-favorite-id="${item.id}" aria-label="收藏" title="收藏">${renderActionIcon('favorite', favorite)}</button>
      <button class="social-btn" data-share-type="${type}" data-share-id="${item.id}" aria-label="分享" title="分享">${renderActionIcon('share', false)}</button>
    </div>`;
  }

  function getHotContentKeys() {
    return new Set([
      ...(state.story.items || []).map(item => ({ key: interactionId('story', item.id), likes: Number(item.likes || 0) })),
      ...(state.outfit.items || []).map(item => ({ key: interactionId('outfit', item.id), likes: Number(item.likes || 0) })),
      ...(state.shop.items || []).map(item => ({ key: interactionId('shop', item.id), likes: Number(item.likes || 0) })),
    ].filter(entry => entry.likes > 0).sort((a, b) => b.likes - a.likes).slice(0, 3).map(entry => entry.key));
  }

  function renderHotBadge(type, item) {
    return getHotContentKeys().has(interactionId(type, item.id)) ? '<span class="hot-badge">🔥 热门</span>' : '';
  }

  function dailyIndex(length, salt) {
    if (!length) return -1;
    const day = new Date().toISOString().slice(0, 10) + salt;
    let hash = 0;
    for (let i = 0; i < day.length; i++) hash = ((hash << 5) - hash + day.charCodeAt(i)) | 0;
    return Math.abs(hash) % length;
  }

  function renderTodayQiaoqiao() {
    const stories = state.story.items || [];
    const outfits = state.outfit.items || [];
    const products = state.shop.items || [];
    const picks = [
      { label: '今日照片', type: 'story', item: stories[dailyIndex(stories.length, 'photo')] },
      { label: '今日故事', type: 'story', item: stories[dailyIndex(stories.length, 'story')] },
      { label: '今日穿搭', type: 'outfit', item: outfits[dailyIndex(outfits.length, 'outfit')] },
      { label: '今日好物', type: 'shop', item: products[dailyIndex(products.length, 'shop')] },
    ].filter(pick => pick.item);
    if (!picks.length) return '';
    return `<section class="today-section"><div class="story-section-title">今日瞧瞧 <small>每天更新</small></div>
      <div class="today-grid">${picks.map(pick => `<div class="today-card" data-detail-type="${pick.type}" data-detail-id="${pick.item.id}">
        <img src="${escape(pick.item.image || state.story.avatar || '')}" alt="" loading="lazy" decoding="async">
        <div class="today-card-info"><small>${pick.label}</small><strong>${escape(pick.item.title || pick.item.name || '瞧瞧')}</strong></div>
        ${renderSocialActions(pick.type, pick.item)}
      </div>`).join('')}</div></section>`;
  }

  function renderPopular() {
    const all = [
      ...(state.story.items || []).map(item => ({ type: 'story', item })),
      ...(state.outfit.items || []).map(item => ({ type: 'outfit', item })),
      ...(state.shop.items || []).map(item => ({ type: 'shop', item })),
    ].sort((a, b) => Number(b.item.likes || 0) - Number(a.item.likes || 0)).slice(0, 3);
    if (!all.some(entry => Number(entry.item.likes || 0) > 0)) return '';
    return `<section class="popular-section"><div class="story-section-title">大家都喜欢 <small>热门内容</small></div>
      <div class="popular-list">${all.map(entry => `<div class="popular-item" data-detail-type="${entry.type}" data-detail-id="${entry.item.id}">
        <img src="${escape(entry.item.image || state.story.avatar || '')}" alt="" loading="lazy" decoding="async">
        <span>${escape(entry.item.title || entry.item.name || '瞧瞧')}</span><b>♥ ${Number(entry.item.likes || 0)}</b>
      </div>`).join('')}</div></section>`;
  }

  function renderHomeCommentBoard() {
    const comments = Array.isArray(state.comments) ? state.comments : [];
    const nickname = state.visitor?.nickname || '';
    return `<section class="comment-board home-comment-board">
      <div class="story-section-title">留言板 <small>${comments.length} 条公开留言</small></div>
      <form class="comment-form" id="commentForm">
        <input class="form-input" id="commentName" maxlength="30" placeholder="你的昵称" value="${escape(nickname)}">
        <textarea class="form-textarea" id="commentContent" maxlength="300" placeholder="给瞧瞧留句话吧"></textarea>
        <button class="btn-primary" id="commentSubmit" type="submit">提交留言</button>
        <small>留言经管理员审核后公开显示</small>
      </form>
      <div class="comment-list">${comments.length ? comments.map(comment => `<div class="comment-item"><strong>${escape(comment.name)}</strong><p>${escape(comment.content)}</p><small>${fmtDate(comment.createdAt)}</small></div>`).join('') : '<div class="order-empty">还没有公开留言，来做第一个留言的人吧</div>'}</div>
    </section>`;
  }

  // ========== 小故事页 ==========
  function renderStory() {
    const items = state.story.items || [];
    const hasItems = items.length > 0;
    const quickImg = items[0]?.image;

    // 顶部 + 大图
    let heroHtml = '';
    if (hasItems) {
      heroHtml = `
        <div class="story-carousel" id="storyCarousel">
          <div class="story-carousel-track" id="storyTrack">
            ${items.slice(0, 6).map((it) => `
              <div class="story-carousel-item">
                ${it.image ? `<img src="${it.image}" alt="" loading="lazy" decoding="async">` : '<div style="font-size:80px;">🐶</div>'}
                <div class="story-caption">
                  ${escape(it.title || '')}
                  <small>${fmtDateShort(it.date || Date.now())}</small>
                </div>
              </div>
            `).join('')}
          </div>
          ${items.length > 1 ? `
            <button class="story-carousel-btn left" data-carousel-dir="-1">‹</button>
            <button class="story-carousel-btn right" data-carousel-dir="1">›</button>
            <div class="story-carousel-dots" id="storyDots">
              ${items.slice(0, 6).map((_, i) => `<span class="${i === 0 ? 'active' : ''}"></span>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }

    return `
      <div class="story-hero">
        <div class="story-hero-logo">
          <span>瞧瞧</span>
          <span>小故事</span>
        </div>
        <div class="story-hero-illust">
          <img src="${escape(state.story.avatar || 'assets/qiaoqiao-avatar.jpg')}" alt="瞧瞧头像" loading="eager" decoding="async" fetchpriority="high">
          ${isAdmin ? '<button class="avatar-edit-btn" data-action="edit-story-avatar">更换头像</button>' : ''}
        </div>
      </div>

      <div class="story-quick">
        <div class="story-quick-img">
          ${quickImg ? `<img src="${quickImg}" alt="" loading="eager" decoding="async">` : '📖'}
        </div>
        <div class="story-quick-info">
          <div class="story-quick-name">${escape(state.story.quick.name)}</div>
          <div>
            <span class="story-quick-tag">${escape(state.story.quick.tag)}</span>
            <span class="story-quick-tag new">美照</span>
          </div>
        </div>
      </div>

      ${renderTodayQiaoqiao()}
      ${renderPopular()}

      <div class="story-section-title">
        最新故事
        <small>${items.length} 个故事</small>
      </div>

      ${heroHtml}

      <div class="story-section-title" style="padding-top:8px;">
        全部故事
      </div>
      <div class="story-grid">
        ${items.length === 0 ? '<div class="order-empty" style="grid-column:1/-1;">还没有故事，去上传第一张瞧瞧吧 🐾</div>' : ''}
        ${items.map((it) => `
          <div class="story-card" data-story-id="${it.id}">
            ${renderHotBadge('story', it)}
            ${isAdmin ? `<button class="delete-btn" data-del-story="${it.id}">×</button>` : ''}
            <div class="story-card-img">
              ${it.image ? `<img src="${it.image}" alt="" loading="lazy" decoding="async">` : '🐶'}
            </div>
            <div class="story-card-body">
              <div class="story-card-title">${escape(it.title || '无题')}</div>
              <div class="story-card-date">${fmtDateShort(it.date || Date.now())}${it.type === 'comic' ? ' · 漫画' : ' · 美照'}</div>
              ${renderSocialActions('story', it)}
            </div>
          </div>
        `).join('')}
      </div>

      ${renderHomeCommentBoard()}

      <div class="btn-row">
        <button class="btn-primary" data-action="upload-story" style="flex:1;">${isAdmin ? '上传新故事' : '提交我的故事'}</button>
      </div>
    `;
  }

  // ========== 穿搭页 ==========
  function renderOutfit() {
    const items = state.outfit.items || [];
    const bannerHtml = `<div class="outfit-banner" id="outfitBanner">
        <div class="outfit-banner-img-wrap">
          <img class="outfit-banner-img" src="assets/banner.jpg" alt="狗澜之家" loading="eager" decoding="async" fetchpriority="high">
        </div>
        <div class="outfit-banner-text">狗澜之家，瞧儿的衣柜</div>
      </div>`;
    return `
      ${bannerHtml}

      <div class="story-section-title" style="padding:0 20px 12px;">
        瞧瞧穿搭
        <small>${items.length} 套造型</small>
      </div>

      <div class="outfit-grid">
        ${items.length === 0 ? '<div class="order-empty" style="grid-column:1/-1;">还没有穿搭，管理员快去添加吧 🐕</div>' : ''}
        ${items.map((it) => `
          <div class="outfit-card" data-outfit-id="${it.id}">
            ${renderHotBadge('outfit', it)}
            ${isAdmin ? `
              <button class="edit-btn" data-edit-outfit="${it.id}">✎</button>
              <button class="delete-btn" data-del-outfit="${it.id}">×</button>
            ` : ''}
            <div class="outfit-card-img">
              ${it.image ? `<img src="${it.image}" alt="" loading="lazy" decoding="async">` : '👕'}
            </div>
            <div class="outfit-card-body">
              <div class="outfit-card-name">${escape(it.name)}</div>
              <div class="outfit-card-desc">${escape(it.description || '一款超酷的造型~')}</div>
              <div class="outfit-card-bottom">
                <div class="outfit-card-price">${it.price ? '¥' + it.price : ''}</div>
                <button class="outfit-card-btn" data-order-outfit="${it.id}">点这款</button>
              </div>
              ${renderSocialActions('outfit', it)}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="btn-row">
        <button class="btn-primary" data-action="add-outfit" style="flex:1;">${isAdmin ? '+ 添加穿搭' : '+ 我想推荐穿搭'}</button>
      </div>
    `;
  }

  // ========== 周边页 ==========
  function renderShop() {
    const tabs = state.shop.tabs || [];
    const activeTab = state.shop.activeTab || 0;
    const allItems = state.shop.items || [];
    const items = allItems.filter((it) => (it.category || 0) === activeTab);
    const hero = state.shop.hero;

    return `
      <div class="shop-tabs">
        ${tabs.map((t, i) => `<div class="shop-tab ${i === activeTab ? 'active' : ''}" data-shop-tab="${i}">${escape(t)}</div>`).join('')}
      </div>

      <div class="shop-section">
        <div class="shop-section-title">${escape(tabs[activeTab] || '')}</div>
        ${hero && hero.image ? `
          <div class="shop-hero">
          <img src="${hero.image}" alt="" loading="eager" decoding="async" fetchpriority="high">
          </div>
        ` : `
          <div class="shop-hero" style="background:#f5ead2;">${isAdmin ? '点击添加主图' : '🛍️'}</div>
        `}
        ${isAdmin ? `
          <div style="text-align:center;margin-top:8px;">
            <button class="btn-secondary" data-action="edit-hero" style="font-size:12px;padding:6px 14px;">编辑主图</button>
          </div>
        ` : ''}
      </div>

      <div class="story-section-title" style="padding:0 20px 12px;">
        ${isAdmin ? '所有商品' : '瞧瞧想要'}
        <small>${items.length} 件</small>
      </div>

      <div class="shop-list">
        ${items.length === 0 ? '<div class="order-empty" style="grid-column:1/-1;">还没有商品上架</div>' : ''}
        ${items.map((it) => `
          <div class="shop-item" data-shop-id="${it.id}">
            ${renderHotBadge('shop', it)}
            ${isAdmin ? `
              <button class="edit-btn" data-edit-shop="${it.id}">✎</button>
              <button class="delete-btn" data-del-shop="${it.id}">×</button>
            ` : ''}
              ${it.image ? `<img src="${it.image}" alt="" loading="lazy" decoding="async">` : '🎁'}
            <div class="shop-item-info">
              <div class="shop-item-name">${escape(it.name)}</div>
              <div class="shop-item-price">${it.fileUrl ? '仅 PC Windows 版' : (it.price ? '¥' + it.price : '敬请期待')}</div>
              ${renderSocialActions('shop', it)}
              ${it.fileUrl ? `<a href="${escape(it.fileUrl)}" download="${escape(it.fileName || '电子瞧瞧.zip')}" target="_blank" rel="noopener" style="display:block;margin-top:8px;padding:7px 10px;border-radius:16px;background:#333;color:#fff;text-align:center;font-size:12px;text-decoration:none;">⬇ 下载桌宠</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <div class="btn-row">
        <button class="btn-secondary" data-action="order-shop" style="flex:1;">${isAdmin ? '+ 上架商品' : '我想要这个'}</button>
      </div>
    `;
  }

  // ========== 我的页 ==========
  function renderMe() {
    const v = state.visitor;
    const nickname = v.nickname || '瞧瞧的家人';
    const myOrders = v.orders || [];
    const allOutfitOrders = (state.outfit.items || []).flatMap((o) => (o.orders || []).map((ord) => ({ ...ord, outfitName: o.name, outfitImage: o.image })));
    const allShopOrders = (state.shop.items || []).flatMap((o) => (o.orders || []).map((ord) => ({ ...ord, shopName: o.name, shopImage: o.image })));
    const totalOrders = allOutfitOrders.length + allShopOrders.length;
    const myCount = myOrders.length;
    const favoriteCount = Object.keys(interactions.favorites || {}).length;
    const comments = Array.isArray(state.comments) ? state.comments : [];

    return `
      <div class="me-header">
        <div>
          <div class="me-name">${escape(nickname)}${isAdmin ? '<span class="admin-badge">管理员</span>' : ''}</div>
          <div class="me-sub">成为瞧瞧的家人 第 ${Math.max(1, Math.floor((Date.now() - (state.meta.createdAt || Date.now())) / 86400000))} 天</div>
        </div>
        <div class="me-qrcode" data-action="share">🔗</div>
      </div>

      <div class="me-card">
        <div class="me-card-title">${isAdmin ? '管理员中心' : '瞧瞧铁粉卡'}</div>
        <div class="me-card-sub">${isAdmin ? '管理所有内容与订单' : '陪瞧瞧一起慢慢长大 · 专属福利'}</div>
      </div>

      <div class="me-stats">
        <div class="me-stat">
          <div class="me-stat-num">${myCount}${myCount > 0 ? '<span class="red-dot"></span>' : ''}</div>
          <div class="me-stat-label">已点穿搭</div>
        </div>
        <div class="me-stat">
          <div class="me-stat-num">${favoriteCount}</div>
          <div class="me-stat-label">我的收藏</div>
        </div>
        <div class="me-stat">
          <div class="me-stat-num">0.00</div>
          <div class="me-stat-label">瞧瞧币</div>
        </div>
        <div class="me-stat">
          <div class="me-stat-num">${(state.shop.items || []).length}</div>
          <div class="me-stat-label">周边数</div>
        </div>
      </div>

      <div class="me-divider"></div>

      <div class="me-promo" data-action="upload-story">
        <div class="me-promo-info">
          <div class="me-promo-title">App 新人专享 「瞧瞧故事」</div>
          <div class="me-promo-sub">上传美照 记录每一天</div>
        </div>
        <div class="me-promo-illust">📷</div>
      </div>

      <section class="comment-board">
        <div class="story-section-title">留言板 <small>${comments.length} 条公开留言</small></div>
        <form class="comment-form" id="commentForm">
          <input class="form-input" id="commentName" maxlength="30" placeholder="你的昵称" value="${escape(nickname)}">
          <textarea class="form-textarea" id="commentContent" maxlength="300" placeholder="给瞧瞧留句话吧"></textarea>
          <button class="btn-primary" id="commentSubmit" type="submit">提交留言</button>
          <small>留言经管理员审核后公开显示</small>
        </form>
        <div class="comment-list">${comments.length ? comments.map(comment => `<div class="comment-item"><strong>${escape(comment.name)}</strong><p>${escape(comment.content)}</p><small>${fmtDate(comment.createdAt)}</small></div>`).join('') : '<div class="order-empty">还没有公开留言</div>'}</div>
      </section>

      <div class="me-list">
        <div class="me-list-item" data-action="my-favorites">
          <span>★</span> 我的收藏
          <span class="pill">${favoriteCount}</span>
        </div>
        <div class="me-list-item" data-action="my-orders">
          我的点单
          <span class="pill">${myCount}</span>
        </div>
        <div class="me-list-item no-arrow" style="flex-direction:column;align-items:flex-start;gap:8px;">
          <div>会员昵称 <span class="pill" style="margin-left:8px;">${escape(nickname)}</span></div>
          <input class="form-input" id="nicknameInput" placeholder="设置你的昵称" value="${escape(nickname)}" style="margin-top:4px;">
          <button class="btn-primary" id="saveNickname" style="font-size:12px;padding:6px 14px;">保存昵称</button>
        </div>
        ${isAdmin ? `
          <div class="me-list-item" data-action="admin-orders">
            <span style="color:#c93838;">📋</span> 所有访客的订单
            <span class="pill" style="background:#ffe8e8;color:#c93838;">${totalOrders}</span>
          </div>
          <div class="me-list-item no-arrow" style="flex-direction:column;align-items:flex-start;gap:8px;">
            <div><span>🔗</span> 固定分享链接 <span class="pill" style="margin-left:8px;">${state.meta.shareUrl ? '已设置' : '未设置'}</span></div>
            <input class="form-input" id="shareUrlInput" placeholder="粘贴 CloudStudio 公开链接" value="${escape(state.meta.shareUrl || '')}" style="margin-top:4px;">
            <button class="btn-primary" id="saveShareUrl" style="font-size:12px;padding:6px 14px;">保存链接</button>
            <div style="font-size:11px;color:#999;line-height:1.4;">设置后，分享的二维码将永远指向这个稳定链接，不受本地预览地址影响。</div>
          </div>
          <div class="me-list-item" data-action="export-data">
            <span>💾</span> 导出数据
          </div>
          <div class="me-list-item" data-action="admin-comments">
            <span>💬</span> 审核留言
          </div>
          <div class="me-list-item" data-action="backup-now">
            <span>☁️</span> 立即云端备份
            <span class="pill" style="background:#eaf7ed;color:#2e7d32;">每日自动备份已开启</span>
          </div>
          <div class="me-list-item" data-action="import-data">
            <span>📥</span> 导入数据
          </div>
          <div class="me-list-item" data-action="reset-data">
            <span>⚠️</span> 重置全部数据
          </div>
          <div class="me-list-item no-arrow" style="justify-content:space-between;color:#999;font-size:12px;">
            <span>☁️ 云端存储</span>
            <span style="color:#4CAF50;">无容量限制</span>
          </div>
          <div class="me-list-item" data-action="exit-admin" style="color:#c93838;">
            <span>🚪</span> 退出管理员
          </div>
        ` : `
          <div class="me-list-item" data-action="login-admin">
            <span>🔐</span> 切换为管理员
            <span class="tag" style="background:#1a1a1a;">ADMIN</span>
          </div>
          <div class="me-list-item" data-action="share">
            <span>📲</span> 分享给朋友
          </div>
          <div class="me-list-item" data-action="about">
            <span>ℹ️</span> 关于「瞧的一天」
          </div>
        `}
      </div>
    `;
  }

  // ========== 事件绑定 ==========
  function bindTabEvents() {
    // Tab 切换
    $$('.tab-item').forEach((el) => {
      el.onclick = () => switchTab(el.dataset.tab);
    });

    // 删除/编辑按钮（事件委托）
    const main = $('#main');
    main.onscroll = () => {
      scrollPositions[currentTab] = main.scrollTop;
      saveScrollPositions();
    };
    main.onsubmit = (e) => {
      if (e.target && e.target.id === 'commentForm') {
        e.preventDefault();
        submitComment(e);
      }
    };
    main.onclick = (e) => {
      const t = e.target;
      const likeButton = t.closest('[data-like-id]');
      if (likeButton) { toggleLike(likeButton.dataset.likeType, likeButton.dataset.likeId); return; }
      const favoriteButton = t.closest('[data-favorite-id]');
      if (favoriteButton) { toggleFavorite(favoriteButton.dataset.favoriteType, favoriteButton.dataset.favoriteId); return; }
      const shareButton = t.closest('[data-share-id]');
      if (shareButton) { createShareCard(shareButton.dataset.shareType, shareButton.dataset.shareId); return; }
      if (t.closest('a')) return;
      const detailTarget = t.closest('[data-detail-id]');
      if (detailTarget) {
        const type = detailTarget.dataset.detailType;
        const groups = { story: state.story.items || [], outfit: state.outfit.items || [], shop: state.shop.items || [] };
        const items = groups[type] || [];
        const index = items.findIndex(item => item.id === detailTarget.dataset.detailId);
        if (index !== -1) openContentViewer(type, items, index);
        return;
      }
      // 删除
      if (t.dataset.delStory) { handleDeleteStory(t.dataset.delStory); return; }
      if (t.dataset.delOutfit) { handleDeleteOutfit(t.dataset.delOutfit); return; }
      if (t.dataset.delShop) { handleDeleteShop(t.dataset.delShop); return; }
      // 编辑
      if (t.dataset.editOutfit) { handleEditOutfit(t.dataset.editOutfit); return; }
      if (t.dataset.editShop) { handleEditShop(t.dataset.editShop); return; }
      // 点单
      if (t.dataset.orderOutfit) { handleOrderOutfit(t.dataset.orderOutfit); return; }
      // 通用 action
      if (t.dataset.action) { handleAction(t.dataset.action); return; }
      // 轮播
      if (t.dataset.carouselDir) { handleCarousel(parseInt(t.dataset.carouselDir, 10)); return; }
      // 穿搭 Banner 滚动图点击 → 点这款
      const bannerItem = t.closest('.outfit-banner-item');
      if (bannerItem) {
        const oid = bannerItem.dataset.outfitId;
        if (oid) handleOrderOutfit(oid);
        return;
      }
      const outfitCard = t.closest('.outfit-card');
      if (outfitCard) {
        const items = state.outfit.items || [];
        const index = items.findIndex(item => item.id === outfitCard.dataset.outfitId);
        if (index !== -1) openContentViewer('outfit', items, index);
        return;
      }
      const shopCard = t.closest('.shop-item');
      if (shopCard) {
        const activeTab = state.shop.activeTab || 0;
        const items = (state.shop.items || []).filter(item => (item.category || 0) === activeTab);
        const index = items.findIndex(item => item.id === shopCard.dataset.shopId);
        if (index !== -1) openContentViewer('shop', items, index);
        return;
      }
      // 故事卡片 → 打开全屏查看器
      const storyCard = t.closest('.story-card');
      if (storyCard) {
        const sid = storyCard.dataset.storyId;
        if (sid) {
          const items = state.story.items || [];
          const idx = items.findIndex((s) => s.id === sid);
          if (idx !== -1) openImageViewer(items, idx);
        }
        return;
      }
      // 轮播图 → 打开全屏查看器
      const carouselItem = t.closest('.story-carousel-item');
      if (carouselItem) {
        const items = state.story.items || [];
        // 从当前位置开始
        openImageViewer(items.slice(0, 6), carouselIndex);
        return;
      }
    };

    // 商城 tab
    $$('.shop-tab').forEach((el) => {
      el.onclick = () => {
        state.shop.activeTab = parseInt(el.dataset.shopTab, 10);
        scrollPositions.shop = 0;
        saveUiState();
        render();
      };
    });

    // 昵称保存
    const saveBtn = $('#saveNickname');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const v = $('#nicknameInput').value.trim();
        if (!v) return toast('请输入昵称');
        state.visitor.nickname = v; saveLocalVisitor();
        toast('已保存');
        render();
      };
    }

    // 分享链接保存
    const saveShareBtn = $('#saveShareUrl');
    if (saveShareBtn) {
      saveShareBtn.onclick = async () => {
        const v = $('#shareUrlInput').value.trim();
        if (!v) return toast('请输入分享链接');
        if (!/^https?:\/\//i.test(v)) return toast('链接必须以 http:// 或 https:// 开头');
        state.meta.shareUrl = v;
        if (!await saveState()) return;
        toast('分享链接已保存，二维码将固定指向该链接');
        render();
      };
    }

    // 轮播逻辑
    initCarousel();
  }

  // ========== 轮播 ==========
  let carouselIndex = 0;
  function initCarousel() {
    const track = $('#storyTrack');
    if (!track) return;
    const dots = $$('#storyDots span');
    let autoTimer = null;
    const total = dots.length;
    const goTo = (i) => {
      carouselIndex = (i + total) % total;
      track.style.transform = `translateX(-${carouselIndex * 100}%)`;
      dots.forEach((d, idx) => d.classList.toggle('active', idx === carouselIndex));
    };
    // 暴露到全局供按钮用
    window.__carouselGoTo = goTo;
    if (total > 1) {
      autoTimer = setInterval(() => goTo(carouselIndex + 1), 4000);
      track.parentElement.onmouseenter = () => clearInterval(autoTimer);
    }
  }
  function handleCarousel(dir) {
    if (window.__carouselGoTo) window.__carouselGoTo(carouselIndex + dir);
  }

  // ========== 全屏图片查看器 ==========
  let viewerItems = [];
  let viewerIndex = 0;
  let viewerTouchStartX = 0;
  let viewerTouchStartY = 0;
  let viewerSwipeLocked = null; // 'h' | 'v' | null
  let viewerType = 'story';
  let viewerAnimating = false;

  function updateViewerCardStack() {
    const pages = Array.from($('#imgViewerSwipe')?.querySelectorAll('.img-viewer-page') || []);
    const nextIndex = viewerItems.length ? (viewerIndex + 1) % viewerItems.length : -1;
    pages.forEach((page, index) => {
      page.classList.toggle('is-current', index === viewerIndex);
      page.classList.toggle('is-next', index === nextIndex && index !== viewerIndex);
      page.classList.remove('is-flying');
      page.style.transform = '';
      page.style.opacity = '';
      if (index === viewerIndex) page.scrollTop = 0;
    });
  }

  function moveViewerCard(dx) {
    const current = $('#imgViewerSwipe')?.querySelector('.img-viewer-page.is-current');
    const nextCard = $('#imgViewerSwipe')?.querySelector('.img-viewer-page.is-next');
    if (!current) return;
    const rotation = Math.max(-8, Math.min(8, dx / 24));
    current.style.transform = `translate3d(${dx}px,0,0) rotate(${rotation}deg)`;
    if (nextCard) {
      const progress = Math.min(1, Math.abs(dx) / 180);
      nextCard.style.transform = `scale(${0.94 + progress * 0.06})`;
      nextCard.style.opacity = String(0.72 + progress * 0.28);
    }
  }

  function releaseViewerCard(dx, advance) {
    const current = $('#imgViewerSwipe')?.querySelector('.img-viewer-page.is-current');
    if (!current || viewerAnimating) return;
    if (!advance) {
      current.style.transform = '';
      const nextCard = $('#imgViewerSwipe')?.querySelector('.img-viewer-page.is-next');
      if (nextCard) { nextCard.style.transform = ''; nextCard.style.opacity = ''; }
      return;
    }
    viewerAnimating = true;
    const direction = dx < 0 ? -1 : 1;
    current.classList.add('is-flying');
    current.style.transform = `translate3d(${direction * Math.max(window.innerWidth, 720)}px,0,0) rotate(${direction * 14}deg)`;
    current.style.opacity = '0';
    setTimeout(() => {
      viewerIndex = (viewerIndex + 1) % viewerItems.length;
      updateViewerCardStack();
      updateViewerInfo($('#imgViewerInfo'), viewerItems.length);
      $('#viewerSwipeHint')?.classList.remove('show');
      viewerAnimating = false;
    }, 280);
  }

  function openContentViewer(type, items, startIndex) {
    if (!items || items.length === 0) return;
    viewerType = type;
    viewerItems = items;
    viewerIndex = startIndex || 0;

    const viewer = $('#imgViewer');
    const swipe = $('#imgViewerSwipe');
    const info = $('#imgViewerInfo');
    const prev = $('#viewerPrev');
    const next = $('#viewerNext');
    const hint = $('#viewerSwipeHint');

    const typeNames = { story: '瞧瞧故事', outfit: '瞧瞧穿搭', shop: '瞧瞧好物' };
    swipe.innerHTML = items.map((it, i) => {
      const isComic = it.type === 'comic';
      const title = it.title || it.name || '瞧瞧';
      const description = it.description || (type === 'story' ? (isComic ? '瞧瞧漫画' : '瞧瞧美照') : '和瞧瞧一起慢慢发现美好');
      return `<div class="img-viewer-page" data-viewer-idx="${i}">
        <article class="content-detail">
          <div class="content-detail-image ${isComic ? 'comic' : ''} ${type === 'story' ? 'story-long' : ''}">
            ${it.image ? `<img src="${it.image}" alt="${escape(title)}" draggable="false" loading="${i === viewerIndex ? 'eager' : 'lazy'}" decoding="async">` : '<div class="detail-image-empty">🐶</div>'}
          </div>
          <div class="content-detail-body">
            <div class="content-detail-type">${typeNames[type] || '瞧的一天'}</div>
            <h2>${escape(title)}</h2>
            <p>${escape(description)}</p>
            ${type === 'story' ? `<small>${fmtDate(it.date || Date.now())}</small>` : ''}
            ${type === 'outfit' && it.price ? `<div class="content-detail-price">参考价 ¥${it.price}</div>` : ''}
            ${type === 'shop' && it.fileUrl ? `<a class="content-detail-download" href="${escape(it.fileUrl)}" target="_blank" rel="noopener">下载 ${escape(it.fileName || '电子瞧瞧')}</a>` : ''}
            ${renderSocialActions(type, it)}
          </div>
        </article>
      </div>`;
    }).join('');

    // 更新指示器
    updateViewerInfo(info, items.length);

    // 显示（先显示才能获取正确的 clientWidth）
    viewer.classList.add('show');
    document.body.style.overflow = 'hidden';
    const canNavigate = items.length > 1;
    prev.classList.toggle('show', canNavigate);
    next.classList.toggle('show', canNavigate);
    let showGesture = canNavigate;
    try {
      showGesture = canNavigate && sessionStorage.getItem('qiao_viewer_gesture_seen') !== '1';
      if (showGesture) sessionStorage.setItem('qiao_viewer_gesture_seen', '1');
    } catch (_) {}
    hint.classList.toggle('show', showGesture);
    clearTimeout(window.__viewerHintTimer);
    if (showGesture) window.__viewerHintTimer = setTimeout(() => hint.classList.remove('show'), 3200);

    // 滚动到起始页
    updateViewerCardStack();
    prev.onclick = null;
    next.onclick = null;

    // 绑定事件
    swipe.onscroll = null;

    // 触摸滑动
    swipe.ontouchstart = (e) => {
      viewerTouchStartX = e.touches[0].clientX;
      viewerTouchStartY = e.touches[0].clientY;
      viewerSwipeLocked = null;
      swipe.classList.add('is-dragging');
    };
    swipe.ontouchmove = (e) => {
      if (viewerSwipeLocked === 'v') return;
      const dx = Math.abs(e.touches[0].clientX - viewerTouchStartX);
      const dy = Math.abs(e.touches[0].clientY - viewerTouchStartY);
      if (viewerSwipeLocked === null) {
        viewerSwipeLocked = dy > dx ? 'v' : 'h';
      }
      if (viewerSwipeLocked === 'h') {
        e.preventDefault();
        moveViewerCard(e.touches[0].clientX - viewerTouchStartX);
      }
    };
    swipe.ontouchend = (e) => {
      const touch = e.changedTouches && e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - viewerTouchStartX;
      const dy = touch.clientY - viewerTouchStartY;
      swipe.classList.remove('is-dragging');
      releaseViewerCard(dx, Math.abs(dx) >= 72 && Math.abs(dx) > Math.abs(dy));
    };
    let mouseStartX = null;
    swipe.onpointerdown = (e) => {
      if (e.pointerType !== 'mouse' || viewerAnimating) return;
      mouseStartX = e.clientX;
      swipe.classList.add('is-dragging');
    };
    swipe.onpointermove = (e) => {
      if (mouseStartX === null) return;
      moveViewerCard(e.clientX - mouseStartX);
    };
    swipe.onpointerup = (e) => {
      if (mouseStartX === null) return;
      const dx = e.clientX - mouseStartX; mouseStartX = null;
      swipe.classList.remove('is-dragging');
      releaseViewerCard(dx, Math.abs(dx) >= 90);
    };
    swipe.onpointerleave = (e) => {
      if (mouseStartX === null) return;
      const dx = e.clientX - mouseStartX; mouseStartX = null;
      swipe.classList.remove('is-dragging');
      releaseViewerCard(dx, Math.abs(dx) >= 90);
    };
    viewer.tabIndex = -1;
    viewer.focus({ preventScroll: true });
    viewer.onkeydown = (e) => {
      if (e.key === 'ArrowLeft') navigateViewer(-1);
      if (e.key === 'ArrowRight') navigateViewer(1);
      if (e.key === 'Escape') closeImageViewer();
    };
  }

  function navigateViewer(direction) {
    if (viewerItems.length < 2) return;
    viewerIndex = (viewerIndex + direction + viewerItems.length) % viewerItems.length;
    updateViewerCardStack();
    updateViewerInfo($('#imgViewerInfo'), viewerItems.length);
    $('#viewerSwipeHint')?.classList.remove('show');
  }

  function openImageViewer(items, startIndex) {
    openContentViewer('story', items, startIndex);
  }

  function updateViewerInfo(info, total) {
    info.innerHTML = `<span>${viewerIndex + 1}/${total}</span>`;
  }

  function closeImageViewer() {
    $('#imgViewer').classList.remove('show');
    document.body.style.overflow = '';
  }
  window.closeImageViewer = closeImageViewer;

  // 关闭按钮
  if ($('#imgViewerClose')) $('#imgViewerClose').onclick = closeImageViewer;
  if ($('#imgViewer')) $('#imgViewer').onclick = (e) => {
    const likeButton = e.target.closest('[data-like-id]');
    if (likeButton) { toggleLike(likeButton.dataset.likeType, likeButton.dataset.likeId); return; }
    const favoriteButton = e.target.closest('[data-favorite-id]');
    if (favoriteButton) { toggleFavorite(favoriteButton.dataset.favoriteType, favoriteButton.dataset.favoriteId); return; }
    const shareButton = e.target.closest('[data-share-id]');
    if (shareButton) { createShareCard(shareButton.dataset.shareType, shareButton.dataset.shareId); return; }
    if (e.target === $('#imgViewer')) closeImageViewer();
  };

  // ========== 通用 Action 处理 ==========
  function handleAction(action) {
    if (action === 'upload-story') return showUploadStory();
    if (action === 'add-outfit') return isAdmin ? showOutfitForm() : showVisitorUpload('outfit');
    if (action === 'order-shop') return isAdmin ? showShopForm() : showVisitorUpload('shop');
    if (action === 'edit-hero') return showHeroForm();
    if (action === 'edit-story-avatar') return showStoryAvatarForm();
    if (action === 'login-admin') return showAdminLogin();
    if (action === 'exit-admin') { isAdmin = false; toast('已退出管理员'); render(); return; }
    if (action === 'share') return showShare();
    if (action === 'admin-orders') return showAllOrders();
    if (action === 'admin-comments') return showAdminComments();
    if (action === 'my-orders') return showMyOrders();
    if (action === 'my-favorites') return showFavorites();
    if (action === 'export-data') return exportData();
    if (action === 'backup-now') return backupNow();
    if (action === 'import-data') return importData();
    if (action === 'reset-data') return confirmReset();
    if (action === 'about') return showAbout();
  }

  // ========== 上传/编辑表单 ==========
  function showUploadStory(editId) {
    const editing = editId ? state.story.items.find((s) => s.id === editId) : null;
    const html = `
      <div class="form-group">
        <label class="form-label">故事图片</label>
        <div class="upload-area" id="storyUpload">
          <div class="upload-icon">📷</div>
          <div>点击上传图片</div>
          <div class="upload-hint">支持 JPG / PNG，自动压缩</div>
          ${editing && editing.image ? `<img class="preview" src="${editing.image}"><div class="preview-mask">点击替换</div>` : ''}
        </div>
        <input type="file" accept="image/*" id="storyFile" class="file-hidden">
      </div>
      <div class="form-group">
        <label class="form-label">故事标题</label>
        <input class="form-input" id="storyTitle" placeholder="如：第一次吃西瓜" value="${editing ? escape(editing.title || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">类型</label>
        <select class="form-select" id="storyType">
          <option value="photo" ${editing && editing.type === 'photo' ? 'selected' : ''}>美照</option>
          <option value="comic" ${editing && editing.type === 'comic' ? 'selected' : ''}>漫画</option>
        </select>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="storySave">${editing ? '保存修改' : '发布'}</button>
    `;
    const modal = showModal({ title: editing ? '编辑故事' : '上传故事', html, footer });

    // 上传预览
    const uploadArea = $('#storyUpload');
    const fileInput = $('#storyFile');
    uploadArea.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await uploadImage(file);
      if (!dataUrl) return;
      const existing = uploadArea.querySelector('.preview');
      if (existing) existing.remove();
      const mask = uploadArea.querySelector('.upload-icon');
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = dataUrl;
      uploadArea.insertBefore(img, mask);
      const maskEl = uploadArea.querySelector('.preview-mask');
      if (!maskEl) {
        const m = document.createElement('div');
        m.className = 'preview-mask';
        m.textContent = '点击替换';
        uploadArea.appendChild(m);
      }
    };

    $('#storySave').onclick = async () => {
      const title = $('#storyTitle').value.trim();
      const type = $('#storyType').value;
      let image = editing ? editing.image : '';
      const file = fileInput.files[0];
      if (file) image = await uploadImage(file);
      if (!title) return toast('请填写标题');
      if (!image) return toast('请上传图片');
      if (editing) {
        editing.title = title;
        editing.type = type;
        editing.image = image;
      } else {
        state.story.items.unshift({ id: uid(), type, image, title, date: Date.now() });
      }
      if (!await saveState()) return;
      closeModal();
      toast(editing ? '已更新' : '已发布');
      render();
    };
  }

  function showOutfitForm(editId) {
    const editing = editId ? state.outfit.items.find((o) => o.id === editId) : null;
    const html = `
      <div class="form-group">
        <label class="form-label">穿搭大图</label>
        <div class="upload-area" id="outfitUpload">
          <div class="upload-icon">📸</div>
          <div>点击上传</div>
          ${editing && editing.image ? `<img class="preview" src="${editing.image}"><div class="preview-mask">点击替换</div>` : ''}
        </div>
        <input type="file" accept="image/*" id="outfitFile" class="file-hidden">
      </div>
      <div class="form-group">
        <label class="form-label">穿搭名字</label>
        <input class="form-input" id="outfitName" placeholder="如：夏日西瓜太郎" value="${editing ? escape(editing.name || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">穿搭描述</label>
        <textarea class="form-textarea" id="outfitDesc" placeholder="描述一下这个造型的灵感~">${editing ? escape(editing.description || '') : ''}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">参考价（可选）</label>
        <input class="form-input" id="outfitPrice" type="number" placeholder="可不填" value="${editing && editing.price ? editing.price : ''}">
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="outfitSave">${editing ? '保存修改' : '添加'}</button>
    `;
    showModal({ title: editing ? '编辑穿搭' : '添加穿搭', html, footer });

    const uploadArea = $('#outfitUpload');
    const fileInput = $('#outfitFile');
    uploadArea.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await uploadImage(file);
      if (!dataUrl) return;
      const existing = uploadArea.querySelector('.preview');
      if (existing) existing.remove();
      const mask = uploadArea.querySelector('.upload-icon');
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = dataUrl;
      uploadArea.insertBefore(img, mask);
      const maskEl = uploadArea.querySelector('.preview-mask');
      if (!maskEl) {
        const m = document.createElement('div');
        m.className = 'preview-mask';
        m.textContent = '点击替换';
        uploadArea.appendChild(m);
      }
    };

    $('#outfitSave').onclick = async () => {
      const name = $('#outfitName').value.trim();
      const description = $('#outfitDesc').value.trim();
      const price = parseFloat($('#outfitPrice').value) || 0;
      let image = editing ? editing.image : '';
      const file = fileInput.files[0];
      if (file) image = await uploadImage(file);
      if (!name) return toast('请填写穿搭名字');
      if (!image) return toast('请上传图片');
      if (editing) {
        editing.name = name;
        editing.description = description;
        editing.price = price;
        editing.image = image;
      } else {
        state.outfit.items.unshift({ id: uid(), name, description, price, image, orders: [] });
      }
      if (!await saveState()) return;
      closeModal();
      toast(editing ? '已更新' : '已添加');
      render();
    };
  }

  function showShopForm(editId) {
    const editing = editId ? state.shop.items.find((o) => o.id === editId) : null;
    const tabs = state.shop.tabs || [];
    const html = `
      <div class="form-group">
        <label class="form-label">商品图片</label>
        <div class="upload-area" id="shopUpload">
          <div class="upload-icon">🎁</div>
          <div>点击上传</div>
          ${editing && editing.image ? `<img class="preview" src="${editing.image}"><div class="preview-mask">点击替换</div>` : ''}
        </div>
        <input type="file" accept="image/*" id="shopFile" class="file-hidden">
      </div>
      <div class="form-group">
        <label class="form-label">商品名字</label>
        <input class="form-input" id="shopName" placeholder="如：瞧瞧同款小胸背" value="${editing ? escape(editing.name || '') : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">分类</label>
        <select class="form-select" id="shopCategory">
          ${tabs.map((t, i) => `<option value="${i}" ${editing && (editing.category || 0) === i ? 'selected' : ''}>${escape(t)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">价格（可选）</label>
        <input class="form-input" id="shopPrice" type="number" placeholder="可不填" value="${editing && editing.price ? editing.price : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">描述</label>
        <textarea class="form-textarea" id="shopDesc" placeholder="材质/尺寸/购买方式">${editing ? escape(editing.description || '') : ''}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">桌宠 ZIP 文件（电子瞧瞧）</label>
        <input class="form-input" id="shopZipFile" type="file" accept=".zip,application/zip,application/x-zip-compressed">
        <div id="shopZipHint" style="font-size:12px;color:#999;margin-top:6px;">${editing && editing.fileName ? '当前文件：' + escape(editing.fileName) : '仅选择“电子瞧瞧”分类时需要，最大 50MB'}</div>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="shopSave">${editing ? '保存' : '上架'}</button>
    `;
    showModal({ title: editing ? '编辑商品' : '上架商品', html, footer });

    const uploadArea = $('#shopUpload');
    const fileInput = $('#shopFile');
    const zipInput = $('#shopZipFile');
    zipInput.onchange = () => {
      const zip = zipInput.files[0];
      $('#shopZipHint').textContent = zip ? `已选择：${zip.name}（${Math.ceil(zip.size / 1024 / 1024)}MB）` : '未选择文件';
    };
    uploadArea.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await uploadImage(file);
      if (!dataUrl) return;
      const existing = uploadArea.querySelector('.preview');
      if (existing) existing.remove();
      const mask = uploadArea.querySelector('.upload-icon');
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = dataUrl;
      uploadArea.insertBefore(img, mask);
      const maskEl = uploadArea.querySelector('.preview-mask');
      if (!maskEl) {
        const m = document.createElement('div');
        m.className = 'preview-mask';
        m.textContent = '点击替换';
        uploadArea.appendChild(m);
      }
    };

    $('#shopSave').onclick = async () => {
      const name = $('#shopName').value.trim();
      const price = parseFloat($('#shopPrice').value) || 0;
      const description = $('#shopDesc').value.trim();
      const category = parseInt($('#shopCategory').value, 10);
      let image = editing ? editing.image : '';
      let fileUrl = editing ? (editing.fileUrl || '') : '';
      let fileName = editing ? (editing.fileName || '') : '';
      let fileSize = editing ? (editing.fileSize || 0) : 0;
      const file = fileInput.files[0];
      if (file) image = await uploadImage(file);
      if (!name) return toast('请填写商品名字');
      if (!image) return toast('请上传图片');
      const zip = zipInput.files[0];
      if (category === 3 && !zip && !fileUrl) return toast('电子瞧瞧需要上传 ZIP 文件');
      if (zip) {
        if (!/\.zip$/i.test(zip.name)) return toast('仅支持 ZIP 文件');
        toast('正在上传桌宠文件，请稍候…', 10000);
        const uploaded = await uploadDownloadFile(zip);
        fileUrl = uploaded.url;
        fileName = uploaded.name || zip.name;
        fileSize = uploaded.size || zip.size;
      }
      if (editing) {
        editing.name = name;
        editing.price = price;
        editing.description = description;
        editing.image = image;
        editing.category = category;
        editing.fileUrl = fileUrl;
        editing.fileName = fileName;
        editing.fileSize = fileSize;
      } else {
        state.shop.items.unshift({ id: uid(), name, image, price, description, category, fileUrl, fileName, fileSize, orders: [] });
      }
      if (!await saveState()) return;
      closeModal();
      toast(editing ? '已更新' : '已上架');
      render();
    };
  }

  function showStoryAvatarForm() {
    const currentAvatar = state.story.avatar || 'assets/qiaoqiao-avatar.jpg';
    const html = `
      <div class="form-group">
        <label class="form-label">小故事首页头像</label>
        <div class="upload-area" id="storyAvatarUpload">
          <div class="upload-icon">🐶</div>
          <div>点击选择新的头像</div>
          <div class="upload-hint">建议使用正方形图片，上传时会自动压缩</div>
          <img class="preview" src="${escape(currentAvatar)}" alt="当前头像">
          <div class="preview-mask">点击替换</div>
        </div>
        <input type="file" accept="image/*" id="storyAvatarFile" class="file-hidden">
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="storyAvatarSave">保存头像</button>
    `;
    showModal({ title: '更换瞧瞧头像', html, footer });

    const uploadArea = $('#storyAvatarUpload');
    const fileInput = $('#storyAvatarFile');
    uploadArea.onclick = () => fileInput.click();
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const image = await uploadImage(file);
      if (!image) return;
      const preview = uploadArea.querySelector('.preview');
      if (preview) preview.src = image;
    };

    $('#storyAvatarSave').onclick = async () => {
      const file = fileInput.files[0];
      if (!file) return toast('请先选择一张图片');
      const image = await uploadImage(file);
      if (!image) return;
      state.story.avatar = image;
      if (!await saveState()) return;
      closeModal();
      render();
      toast('首页头像已更新');
    };
  }

  function showHeroForm() {
    const hero = state.shop.hero || {};
    const html = `
      <div class="form-group">
        <label class="form-label">主图</label>
        <div class="upload-area" id="heroUpload">
          <div class="upload-icon">🖼️</div>
          <div>点击上传</div>
          ${hero.image ? `<img class="preview" src="${hero.image}"><div class="preview-mask">点击替换</div>` : ''}
        </div>
        <input type="file" accept="image/*" id="heroFile" class="file-hidden">
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="heroSave">保存</button>
    `;
    showModal({ title: '编辑主图', html, footer });
    const heroUpload = $('#heroUpload');
    const heroInput = $('#heroFile');
    heroUpload.onclick = () => heroInput.click();
    heroInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await uploadImage(file);
      if (!dataUrl) return;
      const existing = heroUpload.querySelector('.preview');
      if (existing) existing.remove();
      const mask = heroUpload.querySelector('.upload-icon');
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = dataUrl;
      heroUpload.insertBefore(img, mask);
      const maskEl = heroUpload.querySelector('.preview-mask');
      if (!maskEl) {
        const m = document.createElement('div');
        m.className = 'preview-mask';
        m.textContent = '点击替换';
        heroUpload.appendChild(m);
      }
    };
    $('#heroSave').onclick = async () => {
      let image = state.shop.hero ? state.shop.hero.image : '';
      const file = heroInput.files[0];
      if (file) image = await uploadImage(file);
      if (!image) return toast('请上传图片');
      state.shop.hero = { image };
      if (!await saveState()) return;
      closeModal();
      toast('已保存');
      render();
    };
  }

  // ========== 访客点单 / 推荐 ==========
  function handleOrderOutfit(id) {
    if (!state.visitor.nickname) {
      return showNicknameFirst(() => handleOrderOutfit(id));
    }
    const outfit = state.outfit.items.find((o) => o.id === id);
    if (!outfit) return;
    outfit.orders = outfit.orders || [];
    outfit.orders.push({ name: state.visitor.nickname, time: Date.now() });
    state.visitor.orders = state.visitor.orders || [];
    state.visitor.orders.push({ type: 'outfit', id, time: Date.now(), name: state.visitor.nickname });
    saveState();
    toast(`已为 ${state.visitor.nickname} 记下 ✨`);
    render();
  }

  function showVisitorUpload(type) {
    if (!state.visitor.nickname) {
      return showNicknameFirst(() => showVisitorUpload(type));
    }
    const html = `
      <div class="form-group">
        <label class="form-label">${type === 'outfit' ? '穿搭名字' : '想要的商品'}</label>
        <input class="form-input" id="visName" placeholder="${type === 'outfit' ? '给穿搭起个名字' : '商品名称'}">
      </div>
      <div class="form-group">
        <label class="form-label">备注</label>
        <textarea class="form-textarea" id="visDesc" placeholder="${type === 'outfit' ? '描述一下灵感' : '希望是什么材质/颜色'}"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">图片（可选）</label>
        <div class="upload-area" id="visUpload">
          <div class="upload-icon">🖼️</div>
          <div>点击上传</div>
        </div>
        <input type="file" accept="image/*" id="visFile" class="file-hidden">
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="visSave">提交</button>
    `;
    showModal({ title: type === 'outfit' ? '推荐穿搭' : '想要这个', html, footer });
    const visUpload = $('#visUpload');
    const visInput = $('#visFile');
    visUpload.onclick = () => visInput.click();
    visInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await uploadImage(file);
      if (!dataUrl) return;
      const existing = visUpload.querySelector('.preview');
      if (existing) existing.remove();
      const mask = visUpload.querySelector('.upload-icon');
      const img = document.createElement('img');
      img.className = 'preview';
      img.src = dataUrl;
      visUpload.insertBefore(img, mask);
      const maskEl = visUpload.querySelector('.preview-mask');
      if (!maskEl) {
        const m = document.createElement('div');
        m.className = 'preview-mask';
        m.textContent = '点击替换';
        visUpload.appendChild(m);
      }
    };
    $('#visSave').onclick = async () => {
      const name = $('#visName').value.trim();
      const description = $('#visDesc').value.trim();
      if (!name) return toast('请填写名称');
      let image = '';
      const file = visInput.files[0];
      if (file) image = await uploadImage(file);
      // 存到本地（访客推荐暂存本地）
      state.visitor.orders = state.visitor.orders || [];
      state.visitor.orders.push({
        type: type + '-request',
        name, description, image, time: Date.now(), from: state.visitor.nickname
      });
      saveLocalVisitor();
      closeModal();
      toast('已提交给管理员 👀');
    };
  }

  function showNicknameFirst(cb) {
    const html = `
      <div class="form-group">
        <label class="form-label">先给自己起个昵称吧</label>
        <input class="form-input" id="firstNickname" placeholder="如：小明的妈">
        <div style="font-size:11px;color:#999;margin-top:6px;">昵称会显示在你的点单记录里</div>
      </div>
    `;
    const footer = `
      <button class="btn-primary" id="firstSave" style="flex:1;">开始使用</button>
    `;
    const modal = showModal({ title: '欢迎来到「瞧的一天」', html, footer, closeOnMask: false });
    $('#firstSave').onclick = () => {
      const v = $('#firstNickname').value.trim();
      if (!v) return toast('请输入昵称');
      state.visitor.nickname = v; saveLocalVisitor();
      closeModal();
      if (cb) cb();
    };
  }

  function findLocalContent(type, id) {
    const groups = { story: state.story.items, outfit: state.outfit.items, shop: state.shop.items };
    return (groups[type] || []).find(item => item.id === id);
  }

  function showFavorites() {
    const entries = Object.keys(interactions.favorites || {}).map(key => {
      const split = key.indexOf(':');
      const type = key.slice(0, split); const id = key.slice(split + 1);
      return { type, item: findLocalContent(type, id) };
    }).filter(entry => entry.item);
    const html = `<div class="favorite-list">${entries.length ? entries.map(entry => `<div class="popular-item">
      <img src="${escape(entry.item.image || state.story.avatar || '')}" alt="" loading="lazy">
      <span>${escape(entry.item.title || entry.item.name || '瞧瞧')}</span>
      <button class="social-btn active" data-remove-favorite="${entry.type}:${entry.item.id}">★</button>
    </div>`).join('') : '<div class="order-empty">还没有收藏内容</div>'}</div>`;
    const modal = showModal({ title: '我的收藏', html });
    modal.onclick = event => {
      const button = event.target.closest('[data-remove-favorite]');
      if (!button) return;
      const key = button.dataset.removeFavorite;
      delete interactions.favorites[key]; saveInteractions(); closeModal(); render(); showFavorites();
    };
  }

  async function toggleLike(type, id) {
    const item = findLocalContent(type, id);
    if (!item) return;
    const key = interactionId(type, id);
    const wasLiked = Boolean(interactions.liked[key]);
    interactions.liked[key] = !wasLiked;
    item.likes = Math.max(0, Number(item.likes || 0) + (wasLiked ? -1 : 1));
    saveInteractions();
    render();
    if ($('#imgViewer')?.classList.contains('show')) openContentViewer(viewerType, viewerItems, viewerIndex);
    try {
      const result = await apiCall('POST', '/api/likes', { type, id, delta: wasLiked ? -1 : 1 });
      item.likes = result.likes;
    } catch (e) {
      interactions.liked[key] = wasLiked;
      item.likes = Math.max(0, Number(item.likes || 0) + (wasLiked ? 1 : -1));
      saveInteractions();
      toast('点赞失败，请稍后重试');
    }
    render();
    if ($('#imgViewer')?.classList.contains('show')) openContentViewer(viewerType, viewerItems, viewerIndex);
  }

  function toggleFavorite(type, id) {
    const key = interactionId(type, id);
    interactions.favorites[key] = !interactions.favorites[key];
    if (!interactions.favorites[key]) delete interactions.favorites[key];
    saveInteractions();
    toast(interactions.favorites[key] ? '已收藏到本机' : '已取消收藏');
    render();
    if ($('#imgViewer')?.classList.contains('show')) openContentViewer(viewerType, viewerItems, viewerIndex);
  }

  async function submitComment(event) {
    if (event) event.preventDefault();
    const name = ($('#commentName')?.value || '').trim();
    const content = ($('#commentContent')?.value || '').trim();
    if (!name || !content) return toast('请填写昵称和留言');
    const button = $('#commentSubmit');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = '提交中…'; }
    try {
      await apiCall('POST', '/api/comments', { name, content });
      state.visitor.nickname = name;
      saveLocalVisitor();
      $('#commentContent').value = '';
      toast('留言已提交，审核通过后显示', 3500);
    } catch (e) {
      toast(e.message || '留言提交失败');
    } finally {
      if (button) { button.disabled = false; button.textContent = '提交留言'; }
    }
  }

  async function showAdminComments() {
    try {
      const result = await apiCall('GET', '/api/comments/admin');
      const comments = result.comments || [];
      const html = `<div class="admin-comment-list">${comments.length ? comments.map(comment => `
        <div class="admin-comment-item">
          <div><strong>${escape(comment.name)}</strong><span class="comment-status ${comment.status}">${comment.status === 'approved' ? '已公开' : comment.status === 'rejected' ? '已拒绝' : '待审核'}</span></div>
          <p>${escape(comment.content)}</p><small>${fmtDate(comment.createdAt)}</small>
          <div class="admin-comment-actions">
            <button class="btn-primary" data-comment-approve="${comment.id}">通过</button>
            <button class="btn-secondary" data-comment-reject="${comment.id}">拒绝</button>
            <button class="btn-secondary" data-comment-delete="${comment.id}">删除</button>
          </div>
        </div>`).join('') : '<div class="order-empty">暂无留言</div>'}</div>`;
      const modal = showModal({ title: '留言审核', html });
      modal.onclick = async (event) => {
        const button = event.target.closest('[data-comment-approve],[data-comment-reject],[data-comment-delete]');
        if (!button) return;
        const id = button.dataset.commentApprove || button.dataset.commentReject || button.dataset.commentDelete;
        if (button.dataset.commentDelete) await apiCall('DELETE', '/api/comments/' + id);
        else await apiCall('PATCH', '/api/comments/' + id, { status: button.dataset.commentApprove ? 'approved' : 'rejected' });
        closeModal();
        await syncFromServer();
        showAdminComments();
      };
    } catch (e) { toast(e.message || '留言加载失败'); }
  }

  function loadCanvasImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
  }

  async function createShareCard(type, id) {
    const item = findLocalContent(type, id);
    if (!item) return;
    const title = item.title || item.name || '瞧的一天';
    const url = state.meta.shareUrl || 'https://qiao-day-app.github.io/qiao-day/';
    showModal({ title: '分享卡片', html: '<div class="share-card-wrap"><canvas id="shareCanvas" width="1080" height="1440"></canvas><button class="btn-primary" id="shareCardDownload">下载分享卡片</button><small>可发送到微信、朋友圈或小红书</small></div>' });
    const canvas = $('#shareCanvas');
    const context = canvas.getContext('2d');
    context.fillStyle = '#f5f1ea'; context.fillRect(0, 0, 1080, 1440);
    context.fillStyle = '#fff'; context.beginPath(); context.roundRect(70, 70, 940, 1300, 42); context.fill();
    try {
      const photo = await loadCanvasImage(item.image || state.story.avatar || 'assets/qiaoqiao-avatar.jpg');
      const ratio = Math.max(820 / photo.width, 780 / photo.height);
      const width = photo.width * ratio, height = photo.height * ratio;
      context.save(); context.beginPath(); context.roundRect(130, 130, 820, 780, 30); context.clip();
      context.drawImage(photo, 540 - width / 2, 520 - height / 2, width, height); context.restore();
    } catch (e) {}
    context.fillStyle = '#1a1a1a'; context.font = '700 58px DengXian, sans-serif'; context.fillText(title.slice(0, 16), 130, 1010);
    context.fillStyle = '#777'; context.font = '32px DengXian, sans-serif'; context.fillText('来自「瞧的一天」', 130, 1070);
    try {
      const qr = await loadCanvasImage('https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=8&data=' + encodeURIComponent(url));
      context.drawImage(qr, 690, 1040, 220, 220);
    } catch (e) {}
    context.fillStyle = '#999'; context.font = '26px DengXian, sans-serif'; context.fillText('扫码来看瞧瞧', 130, 1260);
    $('#shareCardDownload').onclick = () => {
      try {
        const link = document.createElement('a');
        link.download = '瞧的一天-' + title.replace(/[\\/:*?"<>|]/g, '') + '.png';
        link.href = canvas.toDataURL('image/png'); link.click();
      } catch (e) { toast('卡片生成失败，请稍后重试'); }
    };
  }

  // ========== 删除 ========== 
  async function handleDeleteStory(id) {
    if (!confirm('确认删除这个故事？')) return;
    state.story.items = state.story.items.filter((s) => s.id !== id);
    if (!await saveState()) return;
    render(); toast('已删除');
  }
  async function handleDeleteOutfit(id) {
    if (!confirm('确认删除这套穿搭？')) return;
    state.outfit.items = state.outfit.items.filter((o) => o.id !== id);
    if (!await saveState()) return;
    render(); toast('已删除');
  }
  async function handleDeleteShop(id) {
    if (!confirm('确认下架此商品？')) return;
    state.shop.items = state.shop.items.filter((s) => s.id !== id);
    if (!await saveState()) return;
    render(); toast('已下架');
  }
  function handleEditOutfit(id) { showOutfitForm(id); }
  function handleEditShop(id) { showShopForm(id); }

  // ========== 管理员登录 ==========
  async function showAdminLogin() {
    const html = `
      <div style="background:#fff5d9;padding:12px;border-radius:10px;margin-bottom:16px;font-size:12px;color:#6b4e1e;">
        🔐 首次进入请设置密码<br>（请牢记，之后凭此密码登录管理员）
      </div>
      <div class="form-group">
        <label class="form-label">管理员密码</label>
        <input class="form-input" id="loginPwd" type="password" placeholder="首次设置 / 再次验证" autofocus>
      </div>
    `;
    const footer = `
      <button class="btn-secondary" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="loginBtn">进入</button>
    `;
    showModal({ title: '管理员登录', html, footer, closeOnMask: false });
    const tryLogin = async () => {
      const p = $('#loginPwd').value;
      if (!p || p.length < 3) return toast('密码至少 3 位');
      try {
        const res = await fetch(API_BASE + '/api/admin/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: p })
        });
        const data = await res.json();
        if (!res.ok) return toast(data.error || '登录失败');
        adminToken = data.token;
        isAdmin = true;
        closeModal();
        if (data.firstTime) toast('管理员密码已设置 ✨');
        else toast('欢迎回来，管理员 ✨');
        await loadState();
        render();
      } catch (e) {
        toast('登录失败：' + e.message);
      }
    };
    $('#loginBtn').onclick = tryLogin;
    $('#loginPwd').onkeypress = (e) => { if (e.key === 'Enter') tryLogin(); };
  }

  // ========== 订单管理 ==========
  function showMyOrders() {
    const my = state.visitor.orders || [];
    const outfitMap = {}; const shopMap = {};
    (state.outfit.items || []).forEach((o) => outfitMap[o.id] = o);
    (state.shop.items || []).forEach((s) => shopMap[s.id] = s);
    const html = my.length === 0
      ? '<div class="order-empty">还没有点单记录</div>'
      : my.slice().reverse().map((ord) => {
        let itemName = '', itemImage = '';
        if (ord.type === 'outfit' && outfitMap[ord.id]) {
          itemName = outfitMap[ord.id].name; itemImage = outfitMap[ord.id].image;
        } else if (ord.type === 'shop' && shopMap[ord.id]) {
          itemName = shopMap[ord.id].name; itemImage = shopMap[ord.id].image;
        }
        return '<div class="order-item"><div class="order-item-img">' +
        (itemImage ? '<img src="' + itemImage + '" alt="" loading="lazy" decoding="async">' : '🛒') + '</div>' +
          '<div class="order-item-info"><div class="order-item-name">' + escape(itemName || '已下架') + '</div>' +
          '<div class="order-item-time">' + fmtDate(ord.time) + ' · ' + (ord.type === 'outfit' ? '穿搭' : '周边') + '</div></div></div>';
      }).filter(Boolean).join('');
    showModal({ title: '我的点单', html: html || '<div class="order-empty">还没有点单记录</div>' });
  }

  async function showAllOrders() {
    try {
      const data = await apiCall('GET', '/api/orders');
      const all = [...data.outfitOrders, ...data.shopOrders].sort((a, b) => b.time - a.time);
      const html = all.length === 0
        ? '<div class="order-empty">还没有任何订单</div>'
        : all.map((ord) => '<div class="order-item"><div class="order-item-info">' +
            '<div class="order-item-name"><b>' + escape(ord.name) + '</b> 点了 <span style="color:#c93838;">' + escape(ord.itemName) + '</span></div>' +
            '<div class="order-item-time">' + (ord.type || '') + ' · ' + fmtDate(ord.time) + '</div></div></div>').join('');
      showModal({ title: '所有订单 (' + all.length + ')', html });
    } catch (e) { toast('加载订单失败'); }
  }

  // ========== 分享 / 二维码 ==========
  function showShare() {
    const fallbackUrl = location.href.split('?')[0].split('#')[0];
    const url = (state.meta && state.meta.shareUrl) ? state.meta.shareUrl : fallbackUrl;
    const html = `
      <div class="qrcode-wrap">
        <div id="qrcode"></div>
        <div class="qrcode-url">${escape(url)}</div>
        <div class="qrcode-tip">长按二维码可保存图片，分享给家人朋友</div>
      </div>
    `;
    showModal({ title: '分享「瞧的一天」', html });
    // 生成二维码（使用图片 API，无外部 JS 依赖）
    setTimeout(() => {
      const target = $('#qrcode');
      if (!target) return;
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url);
      target.innerHTML = '<img src="' + qrUrl + '" width="200" height="200" style="display:block;margin:0 auto;" alt="二维码" onerror="this.parentElement.innerHTML=\'<div style=\\\'padding:20px;color:#999;\\\'>二维码加载失败<br><small>' + escape(url) + '</small></div>\'">';
    }, 200);
  }

  // ========== 数据导入导出 ==========
  async function exportData() {
    try {
      const data = await apiCall('GET', '/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'qiao-day-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); toast('备份已下载');
    } catch (e) { toast('导出失败'); }
  }

  async function backupNow() {
    try {
      toast('正在创建云端备份…', 5000);
      await apiCall('POST', '/api/backups', {});
      toast('云端备份已创建');
    } catch (e) {
      toast(e.message || '备份失败，请稍后重试', 4000);
    }

  }

  async function importData() {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const text = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsText(file); });
        await apiCall('POST', '/api/import', JSON.parse(text));
        await loadState(); render(); toast('数据已导入');
      } catch (err) { toast('导入失败，请检查文件格式'); }
    };
    input.click();
  }

  async function confirmReset() {
    if (!confirm('确认清空所有数据？此操作不可恢复。')) return;
    try {
      await apiCall('POST', '/api/data', DEFAULT_DATA);
      await loadState(); isAdmin = false; adminToken = null;
      render(); toast('数据已重置');
    } catch (e) { toast('重置失败'); }
  }

  function showAbout() {
    showModal({ title: '关于瞧的一天', html: '<div style="text-align:center;padding:16px 0;"><div style="font-size:48px;">🐶</div><p style="font-size:18px;font-weight:600;">瞧的一天 v2.0</p><p style="color:#999;">小狗瞧瞧的手机工作台 · 云端版</p><p style="color:#999;font-size:12px;">数据存储于云端，不占本地空间</p></div>' });
  }

  // ========== 管理员快捷浮动按钮 ==========
  function bindAdminFab() {
    if (!isAdmin) return;
    if ($('#adminFab')) return;
    const fab = document.createElement('button');
    fab.id = 'adminFab';
    fab.className = 'fab';
    fab.title = '快捷上传';
    fab.textContent = '＋';
    fab.onclick = () => {
      if (currentTab === 'story') showUploadStory();
      else if (currentTab === 'outfit') showOutfitForm();
      else if (currentTab === 'shop') showShopForm();
    };
    document.body.appendChild(fab);
  }

  // ========== 启动 ==========
  function updateClock() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const statusTime = $('#statusTime');
    if (statusTime) statusTime.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ========== 启动（纯同步，先本地渲染再后台同步） ==========
  function init() {
    if (window.qiaodayInited) return; // 防止重复初始化
    window.qiaodayInited = true;
    window._qiao_boot_ok = true; // 告知内联兜底脚本：app.js 已执行

    try {
      // 同步：加载本地数据 + 渲染（100ms 内完成，绝不卡）
      ensureState();
      ensureDefaults();
      updateClock();
      try { setInterval(updateClock, 30000); } catch (e) {}
      const savedUi = loadUiState();
      const savedTab = ['story', 'outfit', 'shop', 'me'].includes(savedUi.tab) ? savedUi.tab : 'story';
      currentTab = savedTab;
      if (savedTab === 'shop' && state?.shop) {
        const savedShopTab = Number(savedUi.shopTab);
        state.shop.activeTab = Number.isInteger(savedShopTab) && savedShopTab >= 0 && savedShopTab < (state.shop.tabs || []).length ? savedShopTab : 0;
      }
      switchTab(savedTab);

      // 异步：后台静默连服务器（不阻塞页面）
      setTimeout(function () { try { syncFromServer(); } catch (e) {} }, 2000);

      // 引导昵称
      try {
        if (state && state.visitor && !state.visitor.nickname) {
          setTimeout(function () { try { showNicknameFirst(); } catch (e) {} }, 1200);
        }
      } catch (e) {}
    } catch (e) {
      // 任何初始化错误都直接显示兜底内容，绝不再卡 loading
      console.error('init failed', e);
      renderFallback('初始化失败', String(e && e.message ? e.message : e));
    }
  }

  function ensureState() {
    try {
      if (state && state.story) return;
      state = loadLocalState();
    } catch (e) {
      state = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  function ensureDefaults() {
    try {
      if (!state || typeof state !== 'object') state = JSON.parse(JSON.stringify(DEFAULT_DATA));
      if (!state.story || typeof state.story !== 'object') state.story = JSON.parse(JSON.stringify(DEFAULT_DATA.story));
      if (!state.story.quick || typeof state.story.quick !== 'object' || !state.story.quick.name) state.story.quick = JSON.parse(JSON.stringify(DEFAULT_DATA.story.quick));
      if (!Array.isArray(state.story.items)) state.story.items = [];
      if (!state.outfit || typeof state.outfit !== 'object' || !Array.isArray(state.outfit.items)) state.outfit = JSON.parse(JSON.stringify(DEFAULT_DATA.outfit));
      if (!state.shop || typeof state.shop !== 'object' || !Array.isArray(state.shop.items)) state.shop = JSON.parse(JSON.stringify(DEFAULT_DATA.shop));
      if (!state.shop || typeof state.shop !== 'object') state.shop = JSON.parse(JSON.stringify(DEFAULT_DATA.shop));
      if (!Array.isArray(state.shop.tabs) || !state.shop.tabs.length) state.shop.tabs = JSON.parse(JSON.stringify(DEFAULT_DATA.shop.tabs));
      if (!state.visitor || typeof state.visitor !== 'object') state.visitor = { nickname: '', avatar: '' };
      if (!state.meta || typeof state.meta !== 'object') state.meta = { name: '瞧瞧', createdAt: Date.now(), shareUrl: window.location.origin + '/' };
    } catch (e) {
      // 兜底：完全重置为默认数据
      state = JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  function renderFallback(title, detail) {
    try {
      const main = document.querySelector('#main');
      if (main) {
        main.innerHTML = '<div style="padding:60px 24px 40px;text-align:center;color:#999;"><div style="font-size:48px;margin-bottom:12px;">🐶</div><p style="color:#333;font-size:16px;margin-bottom:8px;">' + escape(title) + '</p><p style="font-size:12px;line-height:1.6;word-break:break-all;">' + escape(detail) + '</p><button onclick="location.reload(true)" style="margin-top:20px;padding:10px 20px;border-radius:20px;border:none;background:#d4a574;color:#fff;font-size:14px;">刷新重试</button></div>';
      }
      const hint = document.querySelector('#loadingHint');
      if (hint) hint.remove();
    } catch (e) {}
  }

  let wakeNoticeTimer = null;
  function showWakeNotice(message, canRetry = false) {
    let notice = document.querySelector('#wakeNotice');
    if (!notice) {
      notice = document.createElement('button');
      notice.id = 'wakeNotice';
      notice.className = 'wake-notice';
      document.body.appendChild(notice);
    }
    notice.textContent = message;
    notice.classList.add('show');
    notice.classList.toggle('retry', canRetry);
    notice.onclick = canRetry ? () => syncFromServer() : null;
  }

  function hideWakeNotice(delay = 0) {
    clearTimeout(wakeNoticeTimer);
    wakeNoticeTimer = setTimeout(() => {
      const notice = document.querySelector('#wakeNotice');
      if (notice) notice.classList.remove('show');
    }, delay);
  }

  async function syncFromServer() {
    clearTimeout(wakeNoticeTimer);
    wakeNoticeTimer = setTimeout(() => {
      showWakeNotice('🐶 瞧瞧正在醒来，请稍等一下…');
    }, 800);
    try {
      const response = await fetchWithTimeout(API_BASE + '/api/data', {}, 75000);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      // 合并服务器数据
      state = { ...state, ...data,
        story: { ...state.story, ...(data.story||{}) },
        outfit: { ...state.outfit, ...(data.outfit||{}) },
        shop: { ...state.shop, ...(data.shop||{}) },
        meta: { ...state.meta, ...(data.meta||{}) }
      };
      // 保证字段完整
      if (!Array.isArray(state.story.items)) state.story.items = [];
      if (!state.story.quick || !state.story.quick.name) state.story.quick = JSON.parse(JSON.stringify(DEFAULT_DATA.story.quick));
      if (!Array.isArray(state.outfit.items)) state.outfit.items = [];
      if (!Array.isArray(state.shop.items)) state.shop.items = [];
      if (!Array.isArray(state.shop.tabs) || !state.shop.tabs.length) state.shop.tabs = JSON.parse(JSON.stringify(DEFAULT_DATA.shop.tabs));
      if (currentTab === 'shop') {
        const rememberedShopTab = Number(loadUiState().shopTab);
        state.shop.activeTab = Number.isInteger(rememberedShopTab) && rememberedShopTab >= 0 && rememberedShopTab < state.shop.tabs.length ? rememberedShopTab : 0;
      }
      useServer = true;
      render();
      clearTimeout(wakeNoticeTimer);
      showWakeNotice('✓ 云端内容已更新');
      hideWakeNotice(1600);
    } catch (e) {
      useServer = false;
      clearTimeout(wakeNoticeTimer);
      showWakeNotice('云端暂时没有响应，点击这里重试', true);
    }
  }

  // 直接执行（script 在 body 末尾，DOM 已就绪）
  try {
    init();
  } catch (e) {
    console.error('boot error', e);
    renderFallback('启动失败', String(e && e.message ? e.message : e));
  }

  // 终极兜底：无论如何 2 秒后如果 loadingHint 还在，强制清掉并显示刷新按钮
  setTimeout(function () {
    try {
      const hint = document.querySelector('#loadingHint');
      if (hint && hint.parentNode) {
        renderFallback('页面加载超时', '请检查网络后刷新重试');
      }
    } catch (e) {}
  }, 2200);
})();
