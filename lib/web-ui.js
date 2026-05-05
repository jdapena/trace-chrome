'use strict';

const http = require('node:http');
const url = require('node:url');
const traceChrome = require('./trace-chrome');

const MAX_BODY = 64 * 1024;

let activeHandle = null;
let lastError = null;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function timestampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function applyConnection(host, port) {
  if (host || port) {
    traceChrome.setCriOptions(host || '', port || '');
  }
}

async function handleStart(req, res) {
  if (activeHandle) {
    sendJson(res, 409, {error: 'recording'});
    return;
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, {error: 'invalid body: ' + err.message});
    return;
  }
  applyConnection(payload.host, payload.port);
  const traceConfig = traceChrome.buildTraceConfig(payload, {log: false});
  traceConfig.output_file = '';
  try {
    const handle = await traceChrome.startCapture(traceConfig);
    activeHandle = handle;
    lastError = null;
    sendJson(res, 200, {ok: true, startedAt: handle.startedAt});
  } catch (err) {
    lastError = (err && err.message) || String(err);
    sendJson(res, 502, {error: lastError});
  }
}

async function handleStop(req, res) {
  if (!activeHandle) {
    sendJson(res, 409, {error: 'idle'});
    return;
  }
  const handle = activeHandle;
  try {
    const data = await handle.stop();
    activeHandle = null;
    const body = JSON.stringify(data);
    const fname = 'trace-' + timestampName() + '.json';
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Content-Disposition': 'attachment; filename="' + fname + '"',
    });
    res.end(body);
  } catch (err) {
    activeHandle = null;
    lastError = (err && err.message) || String(err);
    sendJson(res, 500, {error: lastError});
  }
}

async function handleCategories(req, res, parsed) {
  const q = parsed.query || {};
  applyConnection(q.host, q.port);
  try {
    const cats = await traceChrome.getCategories();
    sendJson(res, 200, cats);
  } catch (err) {
    sendJson(res, 502, {error: (err && err.message) || String(err)});
  }
}

function handleConfig(req, res) {
  sendJson(res, 200, traceChrome.getCriOptions());
}

function handleState(req, res) {
  const body = {state: activeHandle ? 'recording' : 'idle'};
  if (activeHandle) body.startedAt = activeHandle.startedAt;
  if (lastError) body.lastError = lastError;
  sendJson(res, 200, body);
}

function handleIndex(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(PAGE);
}

function dispatch(req, res) {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  console.error(req.method + ' ' + path);
  if (req.method === 'GET' && path === '/') {
    return handleIndex(req, res);
  }
  if (req.method === 'GET' && path === '/api/state') {
    return handleState(req, res);
  }
  if (req.method === 'GET' && path === '/api/config') {
    return handleConfig(req, res);
  }
  if (req.method === 'GET' && path === '/api/categories') {
    return handleCategories(req, res, parsed);
  }
  if (req.method === 'POST' && path === '/api/start') {
    return handleStart(req, res);
  }
  if (req.method === 'POST' && path === '/api/stop') {
    return handleStop(req, res);
  }
  sendJson(res, 404, {error: 'not found'});
}

exports.startWebUi = function({host, port}) {
  const server = http.createServer((req, res) => {
    Promise.resolve()
        .then(() => dispatch(req, res))
        .catch((err) => {
          console.error(err);
          if (!res.headersSent) {
            sendJson(res, 500,
                {error: (err && err.message) || String(err)});
          }
        });
  });
  server.listen(port, host, () => {
    console.error('Web UI listening on http://' + host + ':' + port + '/');
    if (host === '0.0.0.0') {
      console.error('WARNING: --ui-host 0.0.0.0 exposes start/stop ' +
          'control to the network.');
    }
  });
  process.on('SIGINT', async () => {
    console.error('Shutting down web UI...');
    if (activeHandle) {
      try {
        await activeHandle.stop();
      } catch (err) {
        // ignore
      }
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
  return server;
};

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>trace-chrome</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 1rem;
    max-width: 60rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem 0; }
  .header { display: flex; align-items: center; gap: 0.75rem;
    margin-bottom: 1rem; }
  .pill { padding: 0.15rem 0.6rem; border-radius: 999px;
    font-size: 0.85rem; font-weight: 600; }
  .pill.idle { background: #eee; color: #333; }
  .pill.recording { background: #c0392b; color: #fff; }
  .row { margin: 0.5rem 0; display: flex; flex-wrap: wrap;
    gap: 0.5rem; align-items: center; }
  .row label { min-width: 9rem; }
  input[type=text], input[type=number] { padding: 0.3rem;
    font: inherit; flex: 1; min-width: 12rem; }
  button { padding: 0.4rem 0.8rem; font: inherit; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .presets button { background: #f4f4f4; border: 1px solid #ccc; }
  .actions button.primary { background: #2980b9; color: #fff;
    border: 1px solid #1f6391; }
  .actions button.danger { background: #c0392b; color: #fff;
    border: 1px solid #962d22; }
  .cats { display: grid; grid-template-columns: 1fr 1fr;
    gap: 1rem; margin: 0.5rem 0; }
  .cats h3 { font-size: 0.95rem; margin: 0 0 0.3rem 0; }
  .cats ul { list-style: none; padding: 0; margin: 0;
    max-height: 18rem; overflow: auto; border: 1px solid #ddd; }
  .cats li { padding: 0.15rem 0.4rem; cursor: pointer;
    font-family: ui-monospace, monospace; font-size: 12px; }
  .cats li:hover { background: #f0f0f0; }
  .cats li.selected { background: #d6eaf8; }
  pre#log { background: #111; color: #eee; padding: 0.5rem;
    max-height: 12rem; overflow: auto; font-size: 12px; }
  fieldset { border: 1px solid #ddd; padding: 0.5rem 0.75rem;
    margin: 0.5rem 0; }
  legend { font-weight: 600; padding: 0 0.3rem; }
</style>
</head>
<body>
<div class="header">
  <h1>trace-chrome</h1>
  <span id="status" class="pill idle">Idle</span>
  <span id="elapsed"></span>
</div>

<fieldset>
<legend>Connection</legend>
<div class="row">
  <label for="conn-host">Chrome host:</label>
  <input id="conn-host" type="text" placeholder="localhost"
      style="max-width:14rem">
  <label for="conn-port">Port:</label>
  <input id="conn-port" type="text" placeholder="9222"
      style="max-width:6rem">
</div>
</fieldset>

<fieldset>
<legend>Presets</legend>
<div class="row presets" id="presets"></div>
</fieldset>

<fieldset>
<legend>Categories</legend>
<div class="row">
  <label for="include">Include:</label>
  <input id="include" type="text"
      placeholder="comma-separated, or * for all">
</div>
<div class="row">
  <label for="exclude">Exclude:</label>
  <input id="exclude" type="text" placeholder="comma-separated">
</div>
<div class="row">
  <button id="show-cats">Show available</button>
</div>
<div class="cats" id="cats" hidden>
  <div class="col">
    <h3>Categories</h3><ul id="cats-regular"></ul>
  </div>
  <div class="col">
    <h3>Disabled by default</h3><ul id="cats-dbd"></ul>
  </div>
</div>
</fieldset>

<fieldset>
<legend>Options</legend>
<div class="row">
  <label><input type="checkbox" id="systrace"> Enable systrace</label>
</div>
<div class="row">
  <label for="memory_dump_mode">Memory dump:</label>
  <select id="memory_dump_mode">
    <option value="">none</option>
    <option value="light">light</option>
    <option value="detailed">detailed</option>
  </select>
  <label for="memory_dump_interval">Interval (ms):</label>
  <input id="memory_dump_interval" type="number" value="2000"
      style="max-width:6rem">
  <label>
    <input type="checkbox" id="dump_memory_at_stop"> Dump at stop
  </label>
</div>
</fieldset>

<div class="row actions">
  <button id="start" class="primary">Start</button>
  <button id="stop" class="danger" disabled>Stop &amp; Download</button>
  <button id="stop-perfetto-only" class="danger" disabled>
    Stop &amp; Open in Perfetto
  </button>
  <button id="stop-perfetto" class="danger" disabled>
    Stop, Download &amp; Open in Perfetto
  </button>
</div>

<pre id="log"></pre>

<script>
'use strict';
// Preset configurations inspired by Chromium about://tracing presets.
// Each preset's 'vals' is applied field-by-field; any field not listed is
// left untouched.
var PRESETS = [
  {label: 'Web developer', vals: {
    include: 'blink,cc,netlog,renderer,toplevel,v8',
  }},
  {label: 'Rendering', vals: {
    include: 'blink,cc,gpu,viz,toplevel,disabled-by-default-cc.debug',
  }},
  {label: 'Input latency', vals: {
    include: 'benchmark,input,evdev,renderer.scheduler,toplevel,' +
        'disabled-by-default-toplevel.flow',
  }},
  {label: 'JS & rendering', vals: {
    include: 'blink,cc,gpu,renderer,toplevel,v8,' +
        'disabled-by-default-v8.cpu_profiler',
  }},
  {label: 'Memory-infra', vals: {
    include: '',
    memory_dump_mode: 'light',
    dump_memory_at_stop: true,
  }},
];

function $(id) { return document.getElementById(id); }

function log(msg) {
  var t = new Date().toTimeString().slice(0, 8);
  $('log').textContent += '[' + t + '] ' + msg + '\\n';
  $('log').scrollTop = $('log').scrollHeight;
}

function tokens(str) {
  return str.split(',').map(function(s) {
    return s.trim();
  }).filter(Boolean);
}

function refreshCatSelected() {
  var set = {};
  tokens($('include').value).forEach(function(t) { set[t] = true; });
  document.querySelectorAll('#cats li').forEach(function(li) {
    li.classList.toggle('selected', !!set[li.dataset.name]);
  });
}

function setIncludeFromList(arr) {
  $('include').value = arr.join(',');
  refreshCatSelected();
}

function toggleCatInInclude(name) {
  var cur = tokens($('include').value);
  var idx = cur.indexOf(name);
  if (idx >= 0) cur.splice(idx, 1);
  else cur.push(name);
  setIncludeFromList(cur);
}

function applyPreset(p) {
  var v = p.vals;
  if ('include' in v) $('include').value = v.include;
  if ('exclude' in v) $('exclude').value = v.exclude;
  if ('systrace' in v) $('systrace').checked = !!v.systrace;
  if ('memory_dump_mode' in v) {
    $('memory_dump_mode').value = v.memory_dump_mode;
  }
  if ('memory_dump_interval' in v) {
    $('memory_dump_interval').value = v.memory_dump_interval;
  }
  if ('dump_memory_at_stop' in v) {
    $('dump_memory_at_stop').checked = !!v.dump_memory_at_stop;
  }
  refreshCatSelected();
  log('preset: ' + p.label);
}

function renderPresets() {
  var div = $('presets');
  PRESETS.forEach(function(p) {
    var b = document.createElement('button');
    b.textContent = p.label;
    b.addEventListener('click', function() { applyPreset(p); });
    div.appendChild(b);
  });
}

function populate(id, list) {
  var ul = $(id);
  ul.innerHTML = '';
  list.forEach(function(name) {
    var li = document.createElement('li');
    li.textContent = name;
    li.dataset.name = name;
    li.addEventListener('click', function() {
      toggleCatInInclude(name);
    });
    ul.appendChild(li);
  });
}

async function fetchCats() {
  log('fetching categories...');
  try {
    var qs = '?host=' + encodeURIComponent($('conn-host').value.trim()) +
        '&port=' + encodeURIComponent($('conn-port').value.trim());
    var res = await fetch('/api/categories' + qs);
    if (!res.ok) {
      var j = await res.json().catch(function() { return {}; });
      throw new Error(j.error || ('HTTP ' + res.status));
    }
    var body = await res.json();
    populate('cats-regular', body.regular || []);
    populate('cats-dbd', body.disabledByDefault || []);
    $('cats').hidden = false;
    refreshCatSelected();
    log('categories loaded (' +
        (body.regular || []).length + ' regular, ' +
        (body.disabledByDefault || []).length + ' disabled-by-default)');
  } catch (err) {
    log('failed to fetch categories: ' + err.message);
  }
}

function buildPayload() {
  return {
    host: $('conn-host').value.trim(),
    port: $('conn-port').value.trim(),
    categories: $('include').value.trim(),
    excludecategories: $('exclude').value.trim(),
    systrace: $('systrace').checked,
    memory_dump_mode: $('memory_dump_mode').value,
    memory_dump_interval: Number($('memory_dump_interval').value) || 2000,
    dump_memory_at_stop: $('dump_memory_at_stop').checked,
  };
}

async function loadConnConfig() {
  try {
    var r = await fetch('/api/config');
    var c = await r.json();
    if (c.host) $('conn-host').value = c.host;
    if (c.port) $('conn-port').value = c.port;
  } catch (err) {
    log('config fetch failed: ' + err.message);
  }
}

var elapsedTimer = null;
var startedAt = null;
var lastSeenState = 'unknown';

function updateElapsed() {
  if (!startedAt) return;
  var s = Math.floor((Date.now() - startedAt) / 1000);
  var mm = String(Math.floor(s / 60)).padStart(2, '0');
  var ss = String(s % 60).padStart(2, '0');
  $('elapsed').textContent = mm + ':' + ss;
}

function setRecording(on, started) {
  startedAt = started || null;
  lastSeenState = on ? 'recording' : 'idle';
  $('status').className = 'pill ' + (on ? 'recording' : 'idle');
  $('status').textContent = on ? 'Recording' : 'Idle';
  $('start').disabled = on;
  $('stop').disabled = !on;
  $('stop-perfetto-only').disabled = !on;
  $('stop-perfetto').disabled = !on;
  if (elapsedTimer) clearInterval(elapsedTimer);
  if (on) {
    elapsedTimer = setInterval(updateElapsed, 1000);
    updateElapsed();
  } else {
    elapsedTimer = null;
    $('elapsed').textContent = '';
  }
}

async function refreshState() {
  try {
    var r = await fetch('/api/state');
    var s = await r.json();
    if (s.state !== lastSeenState) {
      setRecording(s.state === 'recording', s.startedAt);
    }
  } catch (err) {
    // silent: poll failures are non-fatal
  }
}

function tsName() {
  var d = new Date();
  function p(n) { return String(n).padStart(2, '0'); }
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function download(buf, fname) {
  var blob = new Blob([buf], {type: 'application/json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(function() {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 5000);
}

// Spam 'PING' to the opened Perfetto window every 50ms; on 'PONG' send the
// trace once. Matches the protocol documented at
// https://perfetto.dev/docs/visualization/deep-linking-to-perfetto-ui
// Note: Perfetto silently drops messages until document.readyState ===
// 'complete', so we keep retrying until we get a PONG or hit the timeout.
async function openInPerfetto(arrayBuffer, fileName, win) {
  var ORIGIN = 'https://ui.perfetto.dev';
  await new Promise(function(resolve, reject) {
    var timer = null;
    var timeout = setTimeout(function() {
      cleanup();
      reject(new Error('Perfetto did not respond within 60s'));
    }, 60000);
    function cleanup() {
      if (timer) clearInterval(timer);
      clearTimeout(timeout);
      window.removeEventListener('message', onMsg);
    }
    function onMsg(ev) {
      if (ev.origin !== ORIGIN || ev.data !== 'PONG') return;
      cleanup();
      try {
        // localOnly defaults to true in Perfetto's sanitizer, which disables
        // download/share for "external" traces. Opt out so the user can save
        // or share from Perfetto's UI.
        win.postMessage({
          perfetto: {
            buffer: arrayBuffer,
            title: fileName,
            localOnly: false,
          },
        }, ORIGIN);
        resolve();
      } catch (err) {
        reject(err);
      }
    }
    window.addEventListener('message', onMsg);
    timer = setInterval(function() {
      try {
        win.postMessage('PING', ORIGIN);
      } catch (err) {
        // window may not be ready yet; retry
      }
    }, 50);
  });
}

async function startTrace() {
  log('starting...');
  try {
    var res = await fetch('/api/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(buildPayload()),
    });
    var j = await res.json();
    if (!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
    setRecording(true, j.startedAt);
    log('recording started');
  } catch (err) {
    log('start failed: ' + err.message);
  }
}

async function stopTrace(opts) {
  // Open Perfetto directly (synchronously, before any await) so the click's
  // user-activation is still in effect. Loading Perfetto early gives it time
  // to reach document.readyState === 'complete' before we start spamming
  // PING — Perfetto silently drops messages until then.
  var perfettoWin = null;
  if (opts.perfetto) {
    perfettoWin = window.open('https://ui.perfetto.dev', '_blank');
    if (!perfettoWin) {
      log('popup blocked - cannot open Perfetto');
    }
  }
  log('stopping...');
  try {
    var res = await fetch('/api/stop', {method: 'POST'});
    if (!res.ok) {
      var j = await res.json().catch(function() { return {}; });
      throw new Error(j.error || ('HTTP ' + res.status));
    }
    var buf = await res.arrayBuffer();
    setRecording(false);
    var fname = 'trace-' + tsName() + '.json';
    if (opts.download) {
      download(buf, fname);
      log('downloaded ' + fname + ' (' + buf.byteLength + ' bytes)');
    }
    if (perfettoWin) {
      log('opening Perfetto (' + buf.byteLength + ' bytes)...');
      try {
        await openInPerfetto(buf, fname, perfettoWin);
        log('handed off to Perfetto');
      } catch (err) {
        log('perfetto handoff failed: ' + err.message);
      }
    }
  } catch (err) {
    if (perfettoWin) {
      try {
        perfettoWin.close();
      } catch (e) {
        // ignore
      }
    }
    log('stop failed: ' + err.message);
    refreshState();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  renderPresets();
  $('include').addEventListener('input', refreshCatSelected);
  $('show-cats').addEventListener('click', fetchCats);
  $('start').addEventListener('click', startTrace);
  $('stop').addEventListener('click', function() {
    stopTrace({download: true, perfetto: false});
  });
  $('stop-perfetto-only').addEventListener('click', function() {
    stopTrace({download: false, perfetto: true});
  });
  $('stop-perfetto').addEventListener('click', function() {
    stopTrace({download: true, perfetto: true});
  });
  loadConnConfig();
  refreshState();
  setInterval(refreshState, 5000);
});
</script>
</body>
</html>
`;
