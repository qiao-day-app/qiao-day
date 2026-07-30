/* =====================================================
   调试版 - 极简同步渲染，纯 localStorage
   每步都打印到#main，不做任何网络请求
===================================================== */

(function () {
  'use strict';

  // 页面调试日志
  function log(msg) {
    var el = document.querySelector('#debugLog');
    if (el) el.innerHTML += '<br>' + msg;
  }
  function initLog() {
    var main = document.querySelector('#main');
    if (main) {
      main.innerHTML = '<div id="debugLog" style="padding:20px;padding-top:60px;font-family:monospace;font-size:13px;line-height:1.8;">🐶 瞧的一天 · 调试模式</div>';
    }
  }

  initLog();

  // Step 1: 检查 DOM
  log('✅ Step 1: DOM 已就绪, readyState=' + document.readyState);

  // Step 2: 定义核心函数
  log('✅ Step 2: 定义核心函数开始');

  var STATE_KEY = 'qiaoday_debug_data';

  var DEFAULT = {
    story: {
      quick: { name: '瞧瞧小档案', tag: '回归' },
      items: [
        { id: '1', title: '今天的瞧宝', image: '', date: Date.now(), type: 'photo' },
        { id: '2', title: '散步归来', image: '', date: Date.now() - 86400000, type: 'comic' }
      ]
    },
    outfit: { items: [] },
    shop: { items: [], tabs: ['灵感上新', '联名周边', '主粮零食', '日用好物'] },
    visitor: { nickname: '', avatar: '' }
  };

  function loadData() {
    try {
      var raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        // 合并确保所有字段存在
        p.story = p.story || {};
        p.story.quick = p.story.quick || DEFAULT.story.quick;
        p.story.items = p.story.items || [];
        p.outfit = p.outfit || DEFAULT.outfit;
        p.shop = p.shop || DEFAULT.shop;
        p.visitor = p.visitor || DEFAULT.visitor;
        return p;
      }
    } catch(e) {
      log('⚠️ localStorage 读取失败: ' + e.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT));
  }

  log('✅ Step 3: DEFAULT_DATA 定义完成');

  // Step 3: 加载数据
  var state;
  try {
    state = loadData();
    log('✅ Step 4: 数据加载完成, story.items=' + state.story.items.length);
  } catch(e) {
    log('❌ 数据加载失败: ' + e.message);
    state = JSON.parse(JSON.stringify(DEFAULT));
  }

  // Step 4: 渲染函数（同步）
  function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); }

  function renderStory() {
    var items = state.story.items || [];
    var quick = state.story.quick;
    var html = '';

    // Hero
    html += '<div class="story-hero"><div class="story-hero-logo"><span>瞧瞧</span><span>小故事</span></div><div class="story-hero-illust">🐶</div></div>';

    // Quick
    html += '<div class="story-quick"><div class="story-quick-img">📖</div><div class="story-quick-info"><div class="story-quick-name">' + esc(quick.name) + '</div><div><span class="story-quick-tag">' + esc(quick.tag) + '</span><span class="story-quick-tag new">美照</span></div></div></div>';

    // Story section
    html += '<div class="story-section-title">最新故事<small>' + items.length + ' 个故事</small></div>';

    // Items grid
    html += '<div class="story-grid">';
    if (items.length === 0) {
      html += '<div class="order-empty" style="grid-column:1/-1;">还没有故事，去上传第一张瞧瞧吧 🐾</div>';
    } else {
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        html += '<div class="story-card"><div class="story-card-img">' + (it.image ? '<img src="' + it.image + '" alt="">' : '🐶') + '</div><div class="story-card-body"><div class="story-card-title">' + esc(it.title || '无题') + '</div><div class="story-card-date">' + (it.type === 'comic' ? '漫画' : '美照') + '</div></div></div>';
      }
    }
    html += '</div>';
    return html;
  }

  function renderOutfit() { return '<div style="padding:40px 20px;text-align:center;color:#999;"><div style="font-size:48px;">🛍️</div><p>穿搭页面</p></div>'; }
  function renderShop() { return '<div style="padding:40px 20px;text-align:center;color:#999;"><div style="font-size:48px;">🎁</div><p>周边页面</p></div>'; }
  function renderMe() { return '<div style="padding:40px 20px;text-align:center;color:#999;"><div style="font-size:48px;">🐾</div><p>我的页面</p></div>'; }

  log('✅ Step 5: 渲染函数定义完成');

  // Step 5: 渲染到页面
  try {
    var main = document.querySelector('#main');
    if (main) {
      main.innerHTML = renderStory();
      log('✅ Step 6: 页面渲染完成！');
    } else {
      log('❌ #main 不存在！');
    }
  } catch(e) {
    log('❌ 渲染失败: ' + e.message + ' stack:' + e.stack);
  }

  // Step 6: Tab 切换
  var tabs = document.querySelectorAll('.tab-item');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() {
      var tab = this.getAttribute('data-tab');
      var m = document.querySelector('#main');
      if (tab === 'story') m.innerHTML = renderStory();
      else if (tab === 'outfit') m.innerHTML = renderOutfit();
      else if (tab === 'shop') m.innerHTML = renderShop();
      else if (tab === 'me') m.innerHTML = renderMe();
      var allTabs = document.querySelectorAll('.tab-item');
      for (var j = 0; j < allTabs.length; j++) {
        allTabs[j].classList.toggle('active', allTabs[j].getAttribute('data-tab') === tab);
      }
      m.scrollTop = 0;
    });
  }

  // 管理员FAB
  window.qiaodayInited = true;
  log('✅ Step 7: 初始化全部完成, 版本: DEBUG-v1');

})();
