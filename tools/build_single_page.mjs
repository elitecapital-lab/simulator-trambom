// Đóng gói bản web thành MỘT file HTML (cấu hình nhúng sẵn) để gửi cho học viên hoặc đưa lên LMS.
// Cần esbuild:   npm install --no-save esbuild
// Dùng:          node tools/build_single_page.mjs dist/tram-bom-st01.html           (Three.js từ jsDelivr)
//                node tools/build_single_page.mjs dist/tram-bom-st01.html --local   (đường dẫn ./vendor/three, chép kèm thư mục vendor)
//                node tools/build_single_page.mjs dist/tram-bom-st01.html --standalone   (nhúng luôn Three.js: một file duy nhất, không cần Internet hay thư mục vendor)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist', 'tram-bom-st01.html');
const local = process.argv.includes('--local'), standalone = process.argv.includes('--standalone');
// logo SYSTEM nhúng thẳng vào trang (data URI) để file HTML duy nhất vẫn đủ hình
const logo = 'data:image/png;base64,' + readFileSync(join(root, 'web/assets/system-logo.png')).toString('base64');
const fav = 'data:image/png;base64,' + readFileSync(join(root, 'web/assets/system-favicon.png')).toString('base64');
const inlineAssets = (t) => t.replaceAll('assets/system-logo.png', logo).replaceAll('assets/system-favicon.png', fav);
const res = await build({ entryPoints: [join(root, 'web/js/main.js')], bundle: true, format: 'esm', minify: true, target: 'es2021', write: false,
  external: standalone ? [] : ['three', 'three/addons/*'],
  alias: standalone ? { three: join(root, 'web/vendor/three/three.module.min.js'), 'three/addons': join(root, 'web/vendor/three/addons') } : undefined });
const css = ['app.css', 'hmi.css', 'fleet.css', 'scene3d.css'].map((f) => readFileSync(join(root, 'web/css', f), 'utf8')).join('\n');
const html = readFileSync(join(root, 'web/index.html'), 'utf8');
const head = inlineAssets(html.slice(0, html.indexOf('<link rel="stylesheet" href="css/app.css">')));
const body = inlineAssets(html.slice(html.indexOf('<body>'), html.indexOf('<script type="module"')));
const data = {
  station: JSON.parse(readFileSync(join(root, 'config/station.json'), 'utf8')),
  scenarios: JSON.parse(readFileSync(join(root, 'config/scenarios.json'), 'utf8')).scenarios,
  components: JSON.parse(readFileSync(join(root, 'config/components.json'), 'utf8')).components,
  hanoi: JSON.parse(readFileSync(join(root, 'config/hanoi.json'), 'utf8')), // mạng lưới Hà Nội (màn Mạng lưới)
};
const V = local ? './vendor/three' : 'https://cdn.jsdelivr.net/npm/three@0.160.0';
const map = local
  ? { three: `${V}/three.module.min.js`, 'three/addons/': `${V}/addons/` }
  : { three: `${V}/build/three.module.min.js`, 'three/addons/OrbitControls.js': `${V}/examples/jsm/controls/OrbitControls.js`, 'three/addons/CSS2DRenderer.js': `${V}/examples/jsm/renderers/CSS2DRenderer.js` };
const importmap = standalone ? '' : `<script type="importmap">${JSON.stringify({ imports: map })}</script>`;
const page = `${head.replace(/<script type="importmap">[\s\S]*?<\/script>/, '')}<style>${css}</style>
${importmap}
</head>
${body}<script>window.__TRAMBOM_DATA__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script type="module">${inlineAssets(res.outputFiles[0].text).replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log('Đã ghi', out, Math.round(page.length / 1024) + ' KB');
