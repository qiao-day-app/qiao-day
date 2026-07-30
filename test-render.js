const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const htmlPath = path.join(__dirname, 'dist-v2', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Capture ALL console output and errors
const logs = [];
const errors = [];
const vc = new VirtualConsole();
vc.on('log', (...args) => logs.push(['LOG', ...args]));
vc.on('error', (...args) => errors.push(['ERROR', ...args]));
vc.on('warn', (...args) => logs.push(['WARN', ...args]));
vc.on('jsdomError', (e) => errors.push(['JSDOM_ERROR', e]));

try {
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    resources: "usable",
    virtualConsole: vc,
    url: "http://localhost:8777/"
  });

  // Capture window errors
  dom.window.addEventListener('error', (e) => {
    errors.push(['WINDOW_ERROR', e.message, e.filename, e.lineno, e.colno]);
  });

  setTimeout(() => {
    const doc = dom.window.document;
    const hint = doc.getElementById('loadingHint');
    const main = doc.getElementById('main');
    
    console.log('=== RESULTS ===');
    console.log('loadingHint:', hint ? hint.textContent : 'NOT FOUND');
    console.log('main children count:', main ? main.children.length : 'N/A');
    console.log('qiaodayInited:', dom.window.qiaodayInited);
    
    console.log('\n=== CONSOLE LOGS ===');
    logs.forEach(l => console.log(l[0] + ':', ...l.slice(1)));
    
    console.log('\n=== ERRORS ===');
    if (errors.length === 0) console.log('(none)');
    else errors.forEach(e => console.log(e[0] + ':', ...e.slice(1)));
    
    console.log('\n=== CHECK KEY VARS ===');
    try {
      console.log('typeof init:', typeof dom.window.eval('typeof init'));
    } catch(e) {
      console.log('init check error:', e.message);
    }
    
    process.exit(0);
  }, 3000);
} catch (e) {
  console.error('FATAL:', e.message.substring(0, 200));
  process.exit(1);
}
