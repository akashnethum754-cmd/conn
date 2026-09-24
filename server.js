require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'test';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'sessions';
const TIMESTAMP_FIELD = process.env.TIMESTAMP_FIELD || 'lastSeen';
const ONLINE_THRESHOLD_MINUTES =
  Number(process.env.ONLINE_THRESHOLD_MINUTES || 2);

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI .env file eke danna one!');
  process.exit(1);
}

let collection;

/* =========================================================
   MONGODB CONNECTION
========================================================= */

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);

  await client.connect();

  const db = client.db(DB_NAME);

  collection = db.collection(COLLECTION_NAME);

  console.log(
    `✅ MongoDB connected -> ${DB_NAME}.${COLLECTION_NAME}`
  );
}

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(express.json());

/* =========================================================
   ONLINE COUNT API
========================================================= */

app.get('/api/online-count', async (req, res) => {
  try {
    if (!collection) {
      return res.status(503).json({
        error: 'Database ready naha'
      });
    }

    const thresholdDate = new Date(
      Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000
    );

    const [onlineCount, totalCount] = await Promise.all([
      collection.countDocuments({
        [TIMESTAMP_FIELD]: {
          $gte: thresholdDate
        }
      }),

      collection.countDocuments({})
    ]);

    res.json({
      online: onlineCount,
      total: totalCount,
      time: new Date().toISOString()
    });

  } catch (err) {
    console.error(
      '❌ Query error:',
      err.message
    );

    res.status(500).json({
      error: 'Data ganna bari una'
    });
  }
});

/* =========================================================
   GET BOT SETTINGS
========================================================= */

app.get('/api/bot-settings/:key', async (req, res) => {
  try {
    if (!collection) {
      return res.status(503).json({
        error: 'Database ready naha'
      });
    }

    const key = String(req.params.key || '').trim();

    if (!key) {
      return res.status(400).json({
        error: 'Access key eka denna'
      });
    }

    const doc = await collection.findOne({
      'config.accessKey': key
    });

    if (!doc) {
      return res.status(404).json({
        error: 'Invalid access key'
      });
    }

    const cfg = doc.config || {};

    const number = String(doc.number || '');

    const maskedNumber =
      number.length > 6
        ? number.slice(0, 4) +
          '••••' +
          number.slice(-2)
        : 'N/A';

    res.json({
      number: maskedNumber,

      BOT_NAME: cfg.BOT_NAME || '',
      BOT_IMAGE: cfg.BOT_IMAGE || '',
      BOT_FOOTER: cfg.BOT_FOOTER || '',
      MOVIE_FOOTER: cfg.MOVIE_FOOTER || '',

      ALWAYS_ONLINE: cfg.ALWAYS_ONLINE === 'true',
      ALWAYS_MSG_SEEN: cfg.ALWAYS_MSG_SEEN === 'true',
      STATUS_VIEW: cfg.STATUS_VIEW === 'true',
      AUTO_LIKE: cfg.AUTO_LIKE === 'true',
      ANTI_DELETE: cfg.ANTI_DELETE === 'true'
    });

  } catch (err) {
    console.error(
      '❌ bot-settings GET error:',
      err.message
    );

    res.status(500).json({
      error: 'Data ganna bari una'
    });
  }
});

/* =========================================================
   SAVE BOT SETTINGS
========================================================= */

app.post('/api/bot-settings/:key', async (req, res) => {
  try {
    if (!collection) {
      return res.status(503).json({
        error: 'Database ready naha'
      });
    }

    const key = String(req.params.key || '').trim();

    if (!key) {
      return res.status(400).json({
        error: 'Access key eka denna'
      });
    }

    const {
      BOT_NAME,
      BOT_IMAGE,
      BOT_FOOTER,
      MOVIE_FOOTER,
      ALWAYS_ONLINE,
      ALWAYS_MSG_SEEN,
      STATUS_VIEW,
      AUTO_LIKE,
      ANTI_DELETE
    } = req.body || {};

    const doc = await collection.findOne({
      'config.accessKey': key
    });

    if (!doc) {
      return res.status(404).json({
        error: 'Invalid access key'
      });
    }

    const update = {};

    if (typeof BOT_NAME === 'string') {
      update['config.BOT_NAME'] = BOT_NAME.trim();
    }
    if (typeof BOT_IMAGE === 'string') {
      update['config.BOT_IMAGE'] = BOT_IMAGE.trim();
    }
    if (typeof BOT_FOOTER === 'string') {
      update['config.BOT_FOOTER'] = BOT_FOOTER.trim();
    }
    if (typeof MOVIE_FOOTER === 'string') {
      update['config.MOVIE_FOOTER'] = MOVIE_FOOTER.trim();
    }

    // Toggles - 'true' / 'false' string widihata save wenne bot eke .set command ekath ekka match wenna
    if (typeof ALWAYS_ONLINE === 'boolean') {
      update['config.ALWAYS_ONLINE'] = ALWAYS_ONLINE ? 'true' : 'false';
    }
    if (typeof ALWAYS_MSG_SEEN === 'boolean') {
      update['config.ALWAYS_MSG_SEEN'] = ALWAYS_MSG_SEEN ? 'true' : 'false';
    }
    if (typeof STATUS_VIEW === 'boolean') {
      update['config.STATUS_VIEW'] = STATUS_VIEW ? 'true' : 'false';
    }
    if (typeof AUTO_LIKE === 'boolean') {
      update['config.AUTO_LIKE'] = AUTO_LIKE ? 'true' : 'false';
    }
    if (typeof ANTI_DELETE === 'boolean') {
      update['config.ANTI_DELETE'] = ANTI_DELETE ? 'true' : 'false';
    }

    update['updatedAt'] = new Date();

    await collection.updateOne(
      {
        'config.accessKey': key
      },
      {
        $set: update
      }
    );

    res.json({
      success: true,
      message: 'Bot settings saved'
    });

  } catch (err) {
    console.error(
      '❌ bot-settings POST error:',
      err.message
    );

    res.status(500).json({
      error: 'Save karanna bari una'
    });
  }
});

/* =========================================================
   MANAGE PAGE
========================================================= */

app.get('/manage', (req, res) => {

  res.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.send(`<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bot Settings - Manage</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  background:
    radial-gradient(circle at top right, rgba(37,211,102,.12), transparent 30%),
    linear-gradient(135deg, #07111f 0%, #111827 50%, #0f172a 100%);
  color: #e5e7eb;
  min-height: 100vh;
  padding: 25px 15px;
}
.wrap { max-width: 1050px; margin: auto; }
.hidden { display: none !important; }
.header { margin-bottom: 22px; }
h1 {
  font-size: 26px; font-weight: 800;
  background: linear-gradient(90deg, #25d366, #60a5fa);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.sub { color: #94a3b8; font-size: 13px; margin-top: 5px; }
.card {
  background: rgba(255,255,255,.055);
  border: 1px solid rgba(255,255,255,.09);
  border-radius: 18px; padding: 20px;
  backdrop-filter: blur(14px);
  box-shadow: 0 15px 40px rgba(0,0,0,.25);
  margin-bottom: 16px;
}
.login-card { max-width: 500px; margin: 40px auto; }
.card-title { font-size: 16px; font-weight: 700; margin-bottom: 5px; }
.card-sub { color: #94a3b8; font-size: 12px; margin-bottom: 18px; }
label { display: block; font-size: 12px; color: #94a3b8; margin-top: 15px; margin-bottom: 7px; }
input {
  width: 100%; padding: 12px 13px; border-radius: 11px;
  border: 1px solid rgba(255,255,255,.12); background: rgba(0,0,0,.30);
  color: #f8fafc; font-size: 14px; transition: .2s;
}
input:focus { outline: none; border-color: #25d366; box-shadow: 0 0 0 3px rgba(37,211,102,.08); }
button {
  width: 100%; margin-top: 18px; padding: 13px; border: none; border-radius: 11px;
  background: linear-gradient(90deg, #25d366, #60a5fa); color: #06111d;
  font-size: 14px; font-weight: 800; cursor: pointer; transition: .2s;
}
button:hover { transform: translateY(-1px); filter: brightness(1.05); }
button:disabled { opacity: .55; cursor: not-allowed; transform: none; }
.botnum {
  background: rgba(37,211,102,.08); border: 1px solid rgba(37,211,102,.15);
  color: #34d399; padding: 9px 11px; border-radius: 9px; font-size: 12px; margin-bottom: 12px;
}
.msg { display: none; margin-top: 12px; font-size: 13px; }
.msg.ok { color: #34d399; }
.msg.err { color: #f87171; }
.section-title {
  font-size: 13px; font-weight: 700; color: #60a5fa; margin-top: 22px; margin-bottom: 4px;
  text-transform: uppercase; letter-spacing: .5px;
}
.toggle-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08); border-radius: 12px; margin-top: 10px;
}
.toggle-row .label-text { font-size: 13px; color: #e5e7eb; }
.toggle-row .label-sub { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.switch { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; cursor: pointer; inset: 0;
  background-color: rgba(255,255,255,.15); transition: .2s; border-radius: 26px;
}
.slider:before {
  position: absolute; content: ""; height: 20px; width: 20px; left: 3px; bottom: 3px;
  background-color: white; transition: .2s; border-radius: 50%;
}
input:checked + .slider { background-color: #25d366; }
input:checked + .slider:before { transform: translateX(20px); }
</style>
</head>
<body>
<div class="wrap">

  <div class="header">
    <h1>🤖 Bot Settings</h1>
    <div class="sub">Access key eken login wela oyage bot eke settings okkoma venas karanna</div>
  </div>

  <div class="card login-card" id="loginCard">
    <div class="card-title">🔐 Access Key Login</div>
    <div class="card-sub">Access key eka use karala oyage bot settings manage karanna.</div>
    <label>Access Key</label>
    <input id="keyInput" placeholder="e.g. A1B2C3D4E5" autocomplete="off" autocapitalize="characters">
    <button id="loginBtn">🔓 Login</button>
    <div class="msg err" id="loginMsg"></div>
  </div>

  <div class="hidden" id="dashboard">

    <div class="card">
      <div class="botnum" id="botNum">Bot: N/A</div>

      <div class="section-title">🎨 Bot Identity</div>
      <label>Bot Name</label>
      <input id="botName" placeholder="e.g. SHAGGY XMD" autocomplete="off">
      <label>Bot Image URL</label>
      <input id="botImage" placeholder="https://example.com/bot.jpg" autocomplete="off">
      <label>Bot Footer Text</label>
      <input id="botFooter" placeholder="e.g. POWERED BY SHAGGY" autocomplete="off">
      <label>Movie Footer Text</label>
      <input id="movieFooter" placeholder="e.g. SHAGGY XMD MOVIE" autocomplete="off">

      <div class="section-title">⚙️ Behaviour Toggles</div>

      <div class="toggle-row">
        <div>
          <div class="label-text">🟢 Always Online</div>
          <div class="label-sub">Bot ALWAYS online widihata pennanawa</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="alwaysOnline">
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <div>
          <div class="label-text">👁️ Auto Seen (Read Receipts)</div>
          <div class="label-sub">Messages auto widihata seen karanawa</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="alwaysMsgSeen">
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <div>
          <div class="label-text">📺 Auto Status View</div>
          <div class="label-sub">Status update okkoma auto balanawa</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="statusView">
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <div>
          <div class="label-text">❤️ Auto Status Like</div>
          <div class="label-sub">Status update walata auto react karanawa</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="autoLike">
          <span class="slider"></span>
        </label>
      </div>

      <div class="toggle-row">
        <div>
          <div class="label-text">🗑️ Anti-Delete</div>
          <div class="label-sub">Delete karapu messages owner ta yawanawa</div>
        </div>
        <label class="switch">
          <input type="checkbox" id="antiDelete">
          <span class="slider"></span>
        </label>
      </div>

      <button id="saveBtn">💾 Save Changes</button>
      <div class="msg" id="saveMsg"></div>
    </div>

  </div>
</div>

<script>
let currentKey = null;
const loginCard = document.getElementById('loginCard');
const dashboard = document.getElementById('dashboard');
const loginMsg = document.getElementById('loginMsg');
const saveMsg = document.getElementById('saveMsg');
const keyInput = document.getElementById('keyInput');

const botName = document.getElementById('botName');
const botImage = document.getElementById('botImage');
const botFooter = document.getElementById('botFooter');
const movieFooter = document.getElementById('movieFooter');
const alwaysOnline = document.getElementById('alwaysOnline');
const alwaysMsgSeen = document.getElementById('alwaysMsgSeen');
const statusView = document.getElementById('statusView');
const autoLike = document.getElementById('autoLike');
const antiDelete = document.getElementById('antiDelete');

async function login() {
  const key = keyInput.value.trim();
  if (!key) {
    loginMsg.textContent = '⚠ Access key eka enter karanna';
    loginMsg.style.display = 'block';
    return;
  }
  loginMsg.style.display = 'none';

  const loginBtn = document.getElementById('loginBtn');
  loginBtn.disabled = true;
  loginBtn.textContent = '⏳ Checking...';

  try {
    const res = await fetch('/api/bot-settings/' + encodeURIComponent(key), { method: 'GET', cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    currentKey = key;
    document.getElementById('botNum').textContent = '📱 Bot: ' + (data.number || 'N/A');

    botName.value = data.BOT_NAME || '';
    botImage.value = data.BOT_IMAGE || '';
    botFooter.value = data.BOT_FOOTER || '';
    movieFooter.value = data.MOVIE_FOOTER || '';
    alwaysOnline.checked = !!data.ALWAYS_ONLINE;
    alwaysMsgSeen.checked = !!data.ALWAYS_MSG_SEEN;
    statusView.checked = !!data.STATUS_VIEW;
    autoLike.checked = !!data.AUTO_LIKE;
    antiDelete.checked = !!data.ANTI_DELETE;

    loginCard.classList.add('hidden');
    dashboard.classList.remove('hidden');
  } catch (err) {
    loginMsg.textContent = '⚠ ' + err.message;
    loginMsg.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = '🔓 Login';
  }
}

document.getElementById('loginBtn').addEventListener('click', login);
keyInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') login(); });

async function saveSettings() {
  if (!currentKey) return;
  saveMsg.style.display = 'none';

  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Saving...';

  try {
    const res = await fetch('/api/bot-settings/' + encodeURIComponent(currentKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BOT_NAME: botName.value.trim(),
        BOT_IMAGE: botImage.value.trim(),
        BOT_FOOTER: botFooter.value.trim(),
        MOVIE_FOOTER: movieFooter.value.trim(),
        ALWAYS_ONLINE: alwaysOnline.checked,
        ALWAYS_MSG_SEEN: alwaysMsgSeen.checked,
        STATUS_VIEW: statusView.checked,
        AUTO_LIKE: autoLike.checked,
        ANTI_DELETE: antiDelete.checked
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    saveMsg.textContent = '✅ Settings successfully saved! Bot eka reconnect wena wita apply wenawa (toggle walata online widihata thiyenawanam waradi wenna puluwan).';
    saveMsg.className = 'msg ok';
    saveMsg.style.display = 'block';
  } catch (err) {
    saveMsg.textContent = '⚠ ' + err.message;
    saveMsg.className = 'msg err';
    saveMsg.style.display = 'block';
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save Changes';
  }
}

document.getElementById('saveBtn').addEventListener('click', saveSettings);
</script>
</body>
</html>`);
});

/* =========================================================
   HOME / ONLINE MONITOR
========================================================= */

app.get('/', (req, res) => {

  res.set(
    'Cache-Control',
    'no-store, no-cache, must-revalidate, proxy-revalidate'
  );

  res.send(`<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bot Online Monitor</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script>
window.addEventListener('error', function(e) {
  if (e.target && e.target.tagName === 'SCRIPT' && e.target.src && e.target.src.includes('chart.umd')) {
    const fallback = document.createElement('script');
    fallback.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';
    document.head.appendChild(fallback);
  }
}, true);
</script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', system-ui, sans-serif;
  background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
  color: #e2e8f0; min-height: 100vh; padding: 24px 16px;
}
.wrap { max-width: 900px; margin: 0 auto; }
h1 {
  font-size: 22px; font-weight: 700;
  background: linear-gradient(90deg, #34d399, #60a5fa);
  -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 4px;
}
.sub { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
.stats { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
.card {
  flex: 1; min-width: 130px; background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 16px; backdrop-filter: blur(8px);
}
.card .label { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
.card .value { font-size: 26px; font-weight: 700; }
.online .value { color: #34d399; }
.total .value { color: #60a5fa; }
.chart-box {
  background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  border-radius: 16px; padding: 16px; height: 380px;
}
.status-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  background: #34d399; margin-right: 6px; box-shadow: 0 0 8px #34d399; animation: pulse 1.5s infinite;
}
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.err { color: #f87171; font-size: 13px; margin-top: 10px; display: none; }
.manage-link { color: #60a5fa; text-decoration: none; margin-left: 5px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🤖 Bot Online Monitor</h1>
  <div class="sub">
    <span class="status-dot"></span>
    Live - real-time update
    <a href="/manage" class="manage-link">⚙ Manage your bot</a>
  </div>

  <div class="stats">
    <div class="card online">
      <div class="label">Online Bots</div>
      <div class="value" id="onlineVal">--</div>
    </div>
    <div class="card total">
      <div class="label">Total Bots</div>
      <div class="value" id="totalVal">--</div>
    </div>
  </div>

  <div class="chart-box">
    <canvas id="botChart"></canvas>
  </div>

  <div class="err" id="errBox"></div>
</div>

<script>
const ctx = document.getElementById('botChart').getContext('2d');
const errBox = document.getElementById('errBox');
const MAX_POINTS = 30;
let chart = null;

function createChart() {
  if (typeof Chart === 'undefined') {
    errBox.textContent = '⚠ Chart library load wenne na';
    errBox.style.display = 'block';
    return;
  }
  try {
    chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Online Bots',
          data: [],
          borderColor: '#34d399',
          backgroundColor: 'rgba(52,211,153,0.15)',
          pointBackgroundColor: '#34d399',
          pointBorderColor: '#0f172a',
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2,
          tension: .35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { beginAtZero: true, ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,.05)' } }
        },
        plugins: { legend: { labels: { color: '#e2e8f0' } } }
      }
    });
  } catch (err) {
    console.error('Chart init failed:', err);
  }
}

async function fetchData() {
  try {
    const res = await fetch('/api/online-count', { cache: 'no-store' });
    if (!res.ok) throw new Error('Server error: ' + res.status);
    const data = await res.json();

    document.getElementById('onlineVal').textContent = data.online;
    document.getElementById('totalVal').textContent = data.total;
    errBox.style.display = 'none';

    if (!chart) return;

    const label = new Date(data.time).toLocaleTimeString('en-GB');
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(data.online);

    if (chart.data.labels.length > MAX_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update();
  } catch (err) {
    console.error('fetchData failed:', err);
    errBox.textContent = '⚠ Data load karanna baruwa: ' + err.message;
    errBox.style.display = 'block';
  }
}

createChart();
fetchData();
setInterval(fetchData, 5000);
</script>
</body>
</html>`);
});

/* =========================================================
   START SERVER
========================================================= */

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`⚙ Manage page: /manage`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
