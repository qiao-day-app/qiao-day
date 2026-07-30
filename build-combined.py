import os

base = os.path.join(os.path.dirname(os.path.abspath(__file__)))

with open(os.path.join(base, 'styles.css'), 'r', encoding='utf-8') as f:
    css = f.read()

with open(os.path.join(base, 'app.js'), 'r', encoding='utf-8') as f:
    js = f.read()

# Remove the IIFE wrapper - extract body between '(function () {' and '})();'
js_start = js.index('(function () {')
js_end = js.rindex('})();')
js_body = js[js_start + len('(function () {'):js_end].strip()

html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#1a1a1a">
  <title>瞧的一天</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E🐶%3C/text%3E%3C/svg%3E">
  <style>
""" + css + """
  </style>
</head>
<body>
  <div id="app">
    <div class="status-bar">
      <span class="time" id="statusTime">13:19</span>
      <span class="indicators">
        <span class="signal">●●●○</span>
        <span class="wifi">📡</span>
        <span class="battery">🔋<em>38</em></span>
      </span>
    </div>
    <header class="top-bar" id="topBar">
      <div class="top-bar-left">
        <span class="top-title" id="topTitle">到店取 · 喜外送</span>
        <span class="top-sub" id="topSub">瞧的一天 ›</span>
      </div>
      <div class="top-bar-right">
        <span class="top-rating" id="topRating">⭐ 5.0 <i class="dot"></i></span>
      </div>
    </header>
    <main id="main">
      <div class="loading-hint" id="loadingHint">加载中…</div>
    </main>
    <nav class="bottom-tab" id="bottomTab">
      <a class="tab-item active" data-tab="story">
        <span class="tab-icon">🏠</span>
        <span class="tab-label">小故事</span>
      </a>
      <a class="tab-item" data-tab="outfit">
        <span class="tab-icon">🛍️</span>
        <span class="tab-label">穿搭</span>
      </a>
      <a class="tab-item" data-tab="shop">
        <span class="tab-icon">🎁</span>
        <span class="tab-label">周边</span>
      </a>
      <a class="tab-item" data-tab="me">
        <span class="tab-icon">🐾</span>
        <span class="tab-label">我的</span>
      </a>
    </nav>
    <div class="modal-mask" id="modalMask"></div>
    <div class="modal" id="modal"></div>
    <div class="toast" id="toast"></div>
    <div class="img-viewer" id="imgViewer">
      <button class="img-viewer-close" id="imgViewerClose">×</button>
      <div class="img-viewer-swipe" id="imgViewerSwipe"></div>
      <div class="img-viewer-info" id="imgViewerInfo"></div>
    </div>
  </div>
  <script>
'use strict';
""" + js_body + """
  </script>
</body>
</html>"""

out_dir = os.path.join(base, 'combined')
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, 'index.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)

print(f"Combined file created: {out_path}")
print(f"Size: {len(html.encode('utf-8'))} bytes")
