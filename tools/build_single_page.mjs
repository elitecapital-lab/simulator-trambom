// Đóng gói bản web thành MỘT file HTML (cấu hình nhúng sẵn) để gửi cho học viên hoặc đưa lên LMS.
// Cần esbuild:   npm install --no-save esbuild
// Dùng:          node tools/build_single_page.mjs dist/tram-bom-st01.html           (Three.js từ jsDelivr)
//                node tools/build_single_page.mjs dist/tram-bom-st01.html --local   (đường dẫn ./vendor/three, chép kèm thư mục vendor)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dist', 'tram-bom-st01.html');
const local = process.argv.includes('--local');
const res = await build({ entryPoints: [join(root, 'web/js/main.js')], bundle: true, format: 'esm', minify: true, target: 'es2021', write: false, external: ['three', 'three/addons/*'] });
const css = ['app.css', 'hmi.css', 'scene3d.css'].map((f) => readFileSync(join(root, 'web/css', f), 'utf8')).join('\n');
const html = readFileSync(join(root, 'web/index.html'), 'utf8');
const head = html.slice(0, html.indexOf('<link rel="stylesheet" href="css/app.css">'));
const body = html.slice(html.indexOf('<body>'), html.indexOf('<script type="module"'));
const data = {
  station: JSON.parse(readFileSync(join(root, 'config/station.json'), 'utf8')),
  scenarios: JSON.parse(readFileSync(join(root, 'config/scenarios.json'), 'utf8')).scenarios,
  components: JSON.parse(readFileSync(join(root, 'config/components.json'), 'utf8')).components,
};
const V = local ? './vendor/three' : 'https://cdn.jsdelivr.net/npm/three@0.160.0';
const map = local
  ? { three: `${V}/three.module.min.js`, 'three/addons/': `${V}/addons/` }
  : { three: `${V}/build/three.module.min.js`, 'three/addons/OrbitControls.js': `${V}/examples/jsm/controls/OrbitControls.js`, 'three/addons/CSS2DRenderer.js': `${V}/examples/jsm/renderers/CSS2DRenderer.js` };
const page = `${head.replace(/<script type="importmap">[\s\S]*?<\/script>/, '')}<style>${css}</style>
<script type="importmap">${JSON.stringify({ imports: map })}</script>
</head>
${body}<script>window.__TRAMBOM_DATA__ = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script type="module">${res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log('Đã ghi', out, Math.round(page.length / 1024) + ' KB');
