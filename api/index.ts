import express from 'express';

const app = express();
app.use(express.json({ limit: '64kb' }));

interface VisitRecord { id: number; timestamp: string; userAgent: string; referer: string; ip: string; path: string; }
const PRIVATE_HOST_CACHE = new Map<string, boolean>();
let serverViewCounter = 0;
const recentVisits: VisitRecord[] = [];

const recordVisit = (req: express.Request): VisitRecord => {
  serverViewCounter += 1;
  const visit: VisitRecord = {
    id: serverViewCounter,
    timestamp: new Date().toISOString(),
    userAgent: req.get('user-agent') || 'Unknown User-Agent',
    referer: req.get('referer') || 'Direct Visit (No Referer)',
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    path: req.originalUrl || req.url,
  };
  recentVisits.unshift(visit);
  if (recentVisits.length > 200) recentVisits.length = 200;
  return visit;
};

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '').toLowerCase();
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b, c, d] = ipv4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return true;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

async function isPublicHost(hostname: string): Promise<boolean> {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || isPrivateAddress(host)) return false;
  if (PRIVATE_HOST_CACHE.has(host)) return !PRIVATE_HOST_CACHE.get(host);
  try {
    const dns = await import('node:dns/promises');
    const addresses = await dns.lookup(host, { all: true });
    const blocked = !addresses.length || addresses.some((entry) => isPrivateAddress(entry.address));
    PRIVATE_HOST_CACHE.set(host, blocked);
    return !blocked;
  } catch {
    PRIVATE_HOST_CACHE.set(host, true);
    return false;
  }
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function jetpackRequest(url: string) {
  try {
    const u = new URL(url);
    return u.hostname === 'stats.wp.com' || u.hostname === 'pixel.wp.com' || (u.hostname.endsWith('.wordpress.com') && /\/stats\//i.test(u.pathname));
  } catch { return false; }
}
function jetpackScript(url: string) {
  try {
    const u = new URL(url);
    return u.hostname === 'stats.wp.com' && /\.(js|mjs)(\?|$)/i.test(u.pathname);
  } catch { return false; }
}
function googleRequest(url: string) {
  try {
    const u = new URL(url);
    return /(^|\.)google-analytics\.com$/i.test(u.hostname) || /(^|\.)analytics\.google\.com$/i.test(u.hostname);
  } catch { return false; }
}
function googleScript(url: string) {
  try {
    const u = new URL(url);
    return /(^|\.)googletagmanager\.com$/i.test(u.hostname) && /gtag|gtm|analytics/i.test(u.pathname + u.search);
  } catch { return false; }
}
function otherAnalytics(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes('plausible')) return 'Plausible';
    if (host.includes('matomo') || path.endsWith('/matomo.php')) return 'Matomo';
    if (host.includes('segment.io') || host.includes('segment.com')) return 'Segment';
    if (host.includes('mixpanel.com')) return 'Mixpanel';
    if (host.includes('amplitude.com')) return 'Amplitude';
    if (host.includes('clarity.ms')) return 'Microsoft Clarity';
    if (host.includes('hotjar.com')) return 'Hotjar';
    if (host.includes('heap.io') || host.includes('heapanalytics.com')) return 'Heap';
    return null;
  } catch { return null; }
}

async function createBrowserbaseSession(apiKey: string, projectId: string) {
  const response = await fetch('https://api.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'X-BB-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ projectId, timeout: 120 }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Browserbase session creation failed (${response.status})${body ? `: ${body.slice(0, 300)}` : '.'}`);
  }
  const data = await response.json() as { id?: string; connectUrl?: string };
  if (!data.id || !data.connectUrl) throw new Error('Browserbase returned an incomplete session.');
  return data;
}

async function releaseBrowserbaseSession(apiKey: string, sessionId: string) {
  await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: {
      'X-BB-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
  }).catch(() => undefined);
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.all(['/api/test/visit', '/api/test-counter', '/api/counter'], (req, res) => {
  const visit = recordVisit(req);
  if (req.accepts('html') && !req.accepts('json')) { res.redirect('/test-page'); return; }
  res.json({ success: true, totalViews: serverViewCounter, currentVisit: visit });
});
app.get('/api/test/stats', (_req, res) => res.json({ totalViews: serverViewCounter, recentVisits: recentVisits.slice(0, 50), lastVisit: recentVisits[0] || null }));
app.post('/api/test/reset', (_req, res) => { serverViewCounter = 0; recentVisits.length = 0; res.json({ success: true, totalViews: 0 }); });
app.post('/api/test/batch-visit', (req, res) => {
  const count = parseBoundedInt(req.body?.count ?? req.query.count, 50, 1, 500);
  const created: VisitRecord[] = [];
  for (let i = 0; i < count; i += 1) created.push(recordVisit(req));
  res.json({ success: true, added: count, totalViews: serverViewCounter, recentVisits: created.slice(0, 50) });
});

app.get('/test-page', (req, res) => {
  recordVisit(req);
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClickHead · Standalone View Counter Test</title><style>body{margin:0;min-height:100vh;background:#07110C;color:#E8EDE0;font-family:system-ui,sans-serif;display:grid;place-items:center;padding:24px}.card{width:min(720px,100%);background:#0C1A12;border:1px solid #1E3E2B;border-radius:24px;padding:32px;box-sizing:border-box}p{color:#9BB0A3;line-height:1.6}.count{text-align:center;padding:28px;margin:24px 0;background:#050C08;border-radius:18px}.count strong{display:block;font:900 80px/1 ui-monospace,monospace;color:#B4F82C;margin-top:8px}.actions{display:flex;gap:10px;flex-wrap:wrap}button,a{border:1px solid #1E3E2B;background:#112419;color:#E8EDE0;border-radius:12px;padding:12px 16px;font-weight:700;text-decoration:none;cursor:pointer}button.primary{background:#B4F82C;color:#000}</style></head><body><main class="card"><h1>Standalone View Counter</h1><p>This page verifies that HTTP requests reach a controlled ClickHead test endpoint. It does not emulate or disguise human traffic.</p><section class="count"><span>Recorded test hits</span><strong id="count">0</strong></section><div class="actions"><button class="primary" onclick="hit()">Record one test hit</button><button onclick="refresh()">Refresh</button><button onclick="resetCount()">Reset</button><a href="/">Open ClickHead</a></div></main><script>async function refresh(){try{const r=await fetch(\'/api/test/stats\');const d=await r.json();document.getElementById(\'count\').textContent=d.totalViews}catch(e){console.error(e)}}async function hit(){await fetch(\'/api/test/visit\',{method:\'POST\'});refresh()}async function resetCount(){await fetch(\'/api/test/reset\',{method:\'POST\'});refresh()}refresh();setInterval(refresh,1500)</script></body></html>';
  res.type('html').send(html);
});

app.get('/api/browser/stream', async (req, res) => {
  const rawTarget = String(req.query?.targetUrl || '').trim();
  if (!rawTarget) { res.status(400).json({ error: 'A target URL is required.' }); return; }
  let target: URL;
  try { target = new URL(rawTarget); } catch { res.status(400).json({ error: 'Invalid target URL.' }); return; }
  if (!['http:', 'https:'].includes(target.protocol)) { res.status(400).json({ error: 'Target must use HTTP or HTTPS.' }); return; }
  if (target.username || target.password) { res.status(400).json({ error: 'Credential-bearing target URLs are not supported.' }); return; }
  if (!(await isPublicHost(target.hostname))) { res.status(400).json({ error: 'Target must resolve to a public address.' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  let closed = false;
  req.on('close', () => { closed = true; });
  const send = (event: string, data: unknown) => { if (!closed && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) {
    send('error', { message: 'Browser verification needs Browserbase. Connect Browserbase to this Vercel project so BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID are available.' });
    res.end();
    return;
  }

  let sessionId = '';
  let browser: any;
  try {
    send('status', { type: 'status', message: 'Starting a cloud Chromium browser…' });
    const session = await createBrowserbaseSession(apiKey, projectId);
    sessionId = session.id;
    const { default: puppeteer } = await import('puppeteer-core');
    browser = await puppeteer.connect({ browserWSEndpoint: session.connectUrl });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);

    const requests = new Set<string>();
    const jetpack = new Set<string>();
    const jetpackJs = new Set<string>();
    const google = new Set<string>();
    const googleJs = new Set<string>();
    const others = new Set<string>();
    let blocked = 0;
    let consoleErrors = 0;
    const started = Date.now();

    page.on('request', async (request: any) => {
      const url = request.url();
      let allowed = true;
      try {
        const u = new URL(url);
        if (u.protocol === 'http:' || u.protocol === 'https:') allowed = await isPublicHost(u.hostname);
        else if (!['about:', 'data:', 'blob:'].includes(u.protocol)) allowed = false;
      } catch { allowed = false; }
      if (!allowed) { blocked += 1; request.abort().catch(() => undefined); return; }
      requests.add(url);
      const isJ = jetpackRequest(url); const isJs = jetpackScript(url); const isG = googleRequest(url); const isGJs = googleScript(url); const other = otherAnalytics(url);
      if (isJ) jetpack.add(url); if (isJs) jetpackJs.add(url); if (isG) google.add(url); if (isGJs) googleJs.add(url); if (other) others.add(other);
      if (isJ || isG || other) send('request', { type: 'request', message: `Analytics request: ${new URL(url).hostname}`, data: { url, provider: isJ ? 'Jetpack' : isG ? 'Google Analytics' : other } });
      request.continue().catch(() => undefined);
    });
    page.on('console', (message: any) => { if (message.type() === 'error') { consoleErrors += 1; send('console', { type: 'console', message: message.text() }); } });

    send('status', { type: 'status', message: 'Opening the target page…' });
    try {
      await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 6000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation failed';
      if (!/timeout/i.test(message)) throw error;
      send('status', { type: 'status', message: 'Page load is taking longer; checking the analytics window…' });
    }

    const finalUrl = page.url();
    const title = await page.title().catch(() => '');
    const wordpress = await page.evaluate(() => {
      const generator = document.querySelector('meta[name="generator"]')?.getAttribute('content') || '';
      const html = document.documentElement.innerHTML.slice(0, 250000);
      return /wordpress/i.test(generator) || /(?:wp-content|wp-includes|wp-json)/i.test(html);
    }).catch(() => false);

    send('status', { type: 'status', message: 'Waiting briefly for analytics beacons…' });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const installed = await page.evaluate(() => {
      const scripts = Array.from(document.scripts).map((script) => script.src).filter(Boolean);
      const html = document.documentElement.innerHTML.slice(0, 300000);
      return {
        jetpack: scripts.some((src) => /stats\.wp\.com|pixel\.wp\.com/i.test(src)) || /stats\.wp\.com|pixel\.wp\.com/i.test(html),
        google: scripts.some((src) => /googletagmanager\.com|google-analytics\.com|gtag\(/i.test(src)) || /googletagmanager\.com|google-analytics\.com|gtag\(/i.test(html),
      };
    }).catch(() => ({ jetpack: false, google: false }));

    const jetpackStatus = jetpack.size ? 'detected' : installed.jetpack ? 'installed-no-request' : 'not-detected';
    const googleStatus = google.size ? 'detected' : installed.google ? 'installed-no-request' : 'not-detected';
    const notes: string[] = [];
    if (jetpackStatus === 'detected') notes.push('Jetpack Stats sent a browser-side request.'); else if (jetpackStatus === 'installed-no-request') notes.push('Jetpack code was found, but no tracking request was observed during the test window.');
    if (googleStatus === 'detected') notes.push('Google Analytics sent a browser-side request.'); else if (googleStatus === 'installed-no-request') notes.push('Google Analytics code was found, but no collection request was observed during the test window.');
    if (!jetpack.size && !google.size && !others.size) notes.push('No supported analytics request was observed. Consent, blockers, configuration, or delayed tracking can cause this.');
    notes.push('This is analytics verification in a real Chromium session; it does not manufacture or guarantee an analytics view.');

    send('complete', {
      targetUrl: target.toString(), finalUrl, title, pageLoaded: true, loadTimeMs: Date.now() - started, wordpressDetected: wordpress,
      jetpack: { status: jetpackStatus, requests: jetpack.size, scriptRequests: jetpackJs.size },
      googleAnalytics: { status: googleStatus, requests: google.size, scriptRequests: googleJs.size },
      otherAnalytics: [...others], requestsObserved: requests.size, consoleErrors, blockedRequests: blocked, notes,
    });
  } catch (error) {
    send('error', { message: error instanceof Error ? error.message : 'Browser test failed.' });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (sessionId) await releaseBrowserbaseSession(apiKey, sessionId);
    if (!res.writableEnded) res.end();
  }
});

export default app;
