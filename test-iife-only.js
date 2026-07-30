const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');

const vc = new VirtualConsole();
const logs = [];
vc.on('log', (...args) => logs.push(args.map(String).join(' ')));

// Extract just the IIFE from app.js
const js = fs.readFileSync('app.js', 'utf8');
const iifeStart = js.indexOf('(function () {');
const iifeEnd = js.lastIndexOf('})();') + 5;
const iifeOnly = js.substring(iifeStart, iifeEnd);

console.log('IIFE size:', iifeOnly.length, 'chars');
console.log('First 50:', iifeOnly.substring(0, 50));
console.log('Last 50:', iifeOnly.substring(iifeOnly.length - 50));

// Test in jsdom with MINIMAL HTML
const html = '<!DOCTYPE html><html><body><div id="loadingHint">加载中…</div><div id="main"></div><script>\n' + iifeOnly + '\n</script></body></html>';

try {
  const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc });

  setTimeout(() => {
    const hint = dom.window.document.getElementById('loadingHint');
    console.log('hint text:', hint ? hint.textContent : 'not found');
    console.log('qiaodayInited:', dom.window.qiaodayInited);
    console.log('logs (' + logs.length + '):');
    logs.forEach(l => console.log('  ', l.substring(0, 150)));
    process.exit(0);
  }, 3000);
} catch(e) {
  console.error('CRASH:', e.message.substring(0, 200));
  process.exit(1);
}
