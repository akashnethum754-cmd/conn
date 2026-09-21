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

      BOT_FOOTER: cfg.BOT_FOOTER || ''
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
      BOT_FOOTER
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
      update['config.BOT_NAME'] =
        BOT_NAME.trim();
    }

    if (typeof BOT_IMAGE === 'string') {
      update['config.BOT_IMAGE'] =
        BOT_IMAGE.trim();
    }

    if (typeof BOT_FOOTER === 'string') {
      update['config.BOT_FOOTER'] =
        BOT_FOOTER.trim();
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

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Bot Settings - Manage</title>

<style>

/* =========================================================
   GLOBAL
========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {

  font-family:
    'Segoe UI',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;

  background:
    radial-gradient(
      circle at top right,
      rgba(37,211,102,.12),
      transparent 30%
    ),

    linear-gradient(
      135deg,
      #07111f 0%,
      #111827 50%,
      #0f172a 100%
    );

  color: #e5e7eb;

  min-height: 100vh;

  padding: 25px 15px;
}

.wrap {

  max-width: 1050px;

  margin: auto;
}

.hidden {
  display: none !important;
}

/* =========================================================
   HEADER
========================================================= */

.header {
  margin-bottom: 22px;
}

h1 {

  font-size: 26px;

  font-weight: 800;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa
    );

  -webkit-background-clip: text;

  background-clip: text;

  color: transparent;
}

.sub {

  color: #94a3b8;

  font-size: 13px;

  margin-top: 5px;
}

/* =========================================================
   CARD
========================================================= */

.card {

  background:
    rgba(255,255,255,.055);

  border:
    1px solid rgba(255,255,255,.09);

  border-radius: 18px;

  padding: 20px;

  backdrop-filter: blur(14px);

  box-shadow:
    0 15px 40px rgba(0,0,0,.25);
}

/* =========================================================
   LOGIN
========================================================= */

.login-card {

  max-width: 500px;

  margin: 40px auto;
}

.card-title {

  font-size: 16px;

  font-weight: 700;

  margin-bottom: 5px;
}

.card-sub {

  color: #94a3b8;

  font-size: 12px;

  margin-bottom: 18px;
}

label {

  display: block;

  font-size: 12px;

  color: #94a3b8;

  margin-top: 15px;

  margin-bottom: 7px;
}

input {

  width: 100%;

  padding: 12px 13px;

  border-radius: 11px;

  border:
    1px solid rgba(255,255,255,.12);

  background:
    rgba(0,0,0,.30);

  color: #f8fafc;

  font-size: 14px;

  transition: .2s;
}

input:focus {

  outline: none;

  border-color: #25d366;

  box-shadow:
    0 0 0 3px
    rgba(37,211,102,.08);
}

button {

  width: 100%;

  margin-top: 18px;

  padding: 13px;

  border: none;

  border-radius: 11px;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa
    );

  color: #06111d;

  font-size: 14px;

  font-weight: 800;

  cursor: pointer;

  transition: .2s;
}

button:hover {

  transform: translateY(-1px);

  filter: brightness(1.05);
}

button:disabled {

  opacity: .55;

  cursor: not-allowed;

  transform: none;
}

/* =========================================================
   DASHBOARD
========================================================= */

.dashboard {

  display: grid;

  grid-template-columns:
    minmax(0, 1fr)
    minmax(0, 1fr);

  gap: 18px;
}

/* =========================================================
   BOT NUMBER
========================================================= */

.botnum {

  background:
    rgba(37,211,102,.08);

  border:
    1px solid rgba(37,211,102,.15);

  color: #34d399;

  padding: 9px 11px;

  border-radius: 9px;

  font-size: 12px;

  margin-bottom: 12px;
}

/* =========================================================
   MESSAGES
========================================================= */

.msg {

  display: none;

  margin-top: 12px;

  font-size: 13px;
}

.msg.ok {
  color: #34d399;
}

.msg.err {
  color: #f87171;
}

/* =========================================================
   PREVIEW
========================================================= */

.preview-card {

  padding: 0;

  overflow: hidden;
}

.preview-header {

  padding: 15px 17px;

  background:
    rgba(255,255,255,.055);

  border-bottom:
    1px solid rgba(255,255,255,.08);
}

.preview-title {

  font-size: 14px;

  font-weight: 700;
}

.preview-sub {

  font-size: 11px;

  color: #94a3b8;

  margin-top: 3px;
}

/* =========================================================
   PHONE
========================================================= */

.phone {

  width: 100%;

  min-height: 570px;

  background:
    radial-gradient(
      circle at 20% 10%,
      rgba(37,211,102,.06),
      transparent 25%
    ),

    #0b141a;

  position: relative;

  overflow: hidden;
}

/* =========================================================
   WHATSAPP TOP
========================================================= */

.wa-top {

  height: 65px;

  background: #202c33;

  display: flex;

  align-items: center;

  padding: 10px 14px;

  gap: 11px;
}

.wa-avatar {

  width: 43px;

  height: 43px;

  border-radius: 50%;

  overflow: hidden;

  background: #33434b;

  display: flex;

  align-items: center;

  justify-content: center;

  flex-shrink: 0;

  border:
    1px solid rgba(255,255,255,.08);
}

.wa-avatar img {

  width: 100%;

  height: 100%;

  object-fit: cover;
}

.avatar-placeholder {

  font-size: 20px;
}

.wa-info {

  min-width: 0;

  flex: 1;
}

.wa-name {

  font-size: 15px;

  font-weight: 600;

  color: #e9edef;

  white-space: nowrap;

  overflow: hidden;

  text-overflow: ellipsis;
}

.wa-status {

  color: #aebac1;

  font-size: 11px;

  margin-top: 2px;
}

.wa-icons {

  color: #aebac1;

  font-size: 18px;

  letter-spacing: 4px;
}

/* =========================================================
   CHAT AREA
========================================================= */

.chat-area {

  padding: 22px 13px;

  min-height: 505px;

  display: flex;

  align-items: flex-start;
}

.message {

  max-width: 90%;

  background: #202c33;

  border-radius: 8px;

  padding: 11px 12px 8px;

  box-shadow:
    0 1px 1px rgba(0,0,0,.2);

  position: relative;
}

.message:before {

  content: "";

  position: absolute;

  left: -7px;

  top: 0;

  border-top:
    9px solid #202c33;

  border-left:
    9px solid transparent;
}

.message-title {

  color: #25d366;

  font-weight: 700;

  font-size: 14px;

  margin-bottom: 7px;

  word-break: break-word;
}

.message-text {

  color: #e9edef;

  font-size: 13px;

  line-height: 1.5;

  word-break: break-word;
}

.message-footer {

  color: #8696a0;

  font-size: 11px;

  margin-top: 8px;

  padding-top: 7px;

  border-top:
    1px solid rgba(255,255,255,.05);

  word-break: break-word;
}

.message-time {

  color: #8696a0;

  font-size: 10px;

  text-align: right;

  margin-top: 4px;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media (max-width: 750px) {

  body {
    padding: 15px 10px;
  }

  .dashboard {

    grid-template-columns: 1fr;
  }

  .phone {

    min-height: 500px;
  }

  .chat-area {

    min-height: 435px;
  }

}

</style>

</head>

<body>

<div class="wrap">

  <div class="header">

    <h1>🤖 Bot Settings</h1>

    <div class="sub">
      Manage your WhatsApp bot settings with live preview
    </div>

  </div>


  <!-- =====================================================
       LOGIN CARD
  ====================================================== -->

  <div class="card login-card" id="loginCard">

    <div class="card-title">
      🔐 Access Key Login
    </div>

    <div class="card-sub">
      Access key eka use karala oyage bot settings manage karanna.
    </div>

    <label>
      Access Key
    </label>

    <input
      id="keyInput"
      placeholder="e.g. A1B2C3D4E5"
      autocomplete="off"
      autocapitalize="characters"
    >

    <button id="loginBtn">
      🔓 Login
    </button>

    <div
      class="msg err"
      id="loginMsg"
    ></div>

  </div>


  <!-- =====================================================
       DASHBOARD
  ====================================================== -->

  <div
    class="dashboard hidden"
    id="dashboard"
  >

    <!-- ===================================================
         EDIT SETTINGS
    ==================================================== -->

    <div class="card">

      <div class="card-title">
        ⚙️ Bot Settings
      </div>

      <div class="card-sub">
        Changes preview eke immediately pennanawa.
      </div>

      <div
        class="botnum"
        id="botNum"
      >
        Bot: N/A
      </div>


      <label>
        Bot Name
      </label>

      <input
        id="botName"
        placeholder="e.g. SHAGGY XMD"
        autocomplete="off"
      >


      <label>
        Bot Image URL
      </label>

      <input
        id="botImage"
        placeholder="https://example.com/bot.jpg"
        autocomplete="off"
      >


      <label>
        Bot Footer Text
      </label>

      <input
        id="botFooter"
        placeholder="e.g. POWERED BY LYNKO"
        autocomplete="off"
      >


      <button id="saveBtn">
        💾 Save Changes
      </button>

      <div
        class="msg"
        id="saveMsg"
      ></div>

    </div>


    <!-- ===================================================
         LIVE PREVIEW
    ==================================================== -->

    <div class="card preview-card">

      <div class="preview-header">

        <div class="preview-title">
          👀 Live Bot Preview
        </div>

        <div class="preview-sub">
          Type karana gaman preview eka update wenawa
        </div>

      </div>


      <div class="phone">

        <!-- WhatsApp Header -->

        <div class="wa-top">

          <div class="wa-avatar">

            <img
              id="previewImage"
              src=""
              alt="Bot"
              style="display:none;"
            >

            <div
              id="avatarPlaceholder"
              class="avatar-placeholder"
            >
              🤖
            </div>

          </div>


          <div class="wa-info">

            <div
              class="wa-name"
              id="previewName"
            >
              My Bot
            </div>

            <div class="wa-status">
              online
            </div>

          </div>


          <div class="wa-icons">
            ⋮
          </div>

        </div>


        <!-- Chat -->

        <div class="chat-area">

          <div class="message">

            <div
              class="message-title"
              id="previewMessageName"
            >
              🤖 My Bot
            </div>

            <div class="message-text">

              👋 Hello!

              <br><br>

              This is a preview of your
              WhatsApp bot message.

              <br><br>

              Your Bot Name, Image and
              Footer will appear here.

            </div>

            <div
              class="message-footer"
              id="previewFooter"
            >
              POWERED BY LYNKO
            </div>

            <div class="message-time">
              10:30 ✓✓
            </div>

          </div>

        </div>

      </div>

    </div>

  </div>

</div>


<script>

/* =========================================================
   VARIABLES
========================================================= */

let currentKey = null;

const loginCard =
  document.getElementById('loginCard');

const dashboard =
  document.getElementById('dashboard');

const loginMsg =
  document.getElementById('loginMsg');

const saveMsg =
  document.getElementById('saveMsg');

const keyInput =
  document.getElementById('keyInput');

const botName =
  document.getElementById('botName');

const botImage =
  document.getElementById('botImage');

const botFooter =
  document.getElementById('botFooter');

const previewName =
  document.getElementById('previewName');

const previewMessageName =
  document.getElementById(
    'previewMessageName'
  );

const previewFooter =
  document.getElementById('previewFooter');

const previewImage =
  document.getElementById(
    'previewImage'
  );

const avatarPlaceholder =
  document.getElementById(
    'avatarPlaceholder'
  );


/* =========================================================
   LIVE PREVIEW
========================================================= */

function updatePreview() {

  const name =
    botName.value.trim();

  const image =
    botImage.value.trim();

  const footer =
    botFooter.value.trim();


  /* BOT NAME */

  previewName.textContent =
    name || 'My Bot';

  previewMessageName.textContent =
    '🤖 ' + (name || 'My Bot');


  /* FOOTER */

  previewFooter.textContent =
    footer || 'POWERED BY LYNKO';


  /* IMAGE */

  if (image) {

    previewImage.src = image;

    previewImage.style.display =
      'block';

    avatarPlaceholder.style.display =
      'none';

  } else {

    previewImage.removeAttribute(
      'src'
    );

    previewImage.style.display =
      'none';

    avatarPlaceholder.style.display =
      'block';
  }
}


/* =========================================================
   INPUT EVENTS
========================================================= */

botName.addEventListener(
  'input',
  updatePreview
);

botImage.addEventListener(
  'input',
  updatePreview
);

botFooter.addEventListener(
  'input',
  updatePreview
);


/* =========================================================
   IMAGE ERROR
========================================================= */

previewImage.addEventListener(
  'error',
  function() {

    previewImage.style.display =
      'none';

    avatarPlaceholder.style.display =
      'block';

  }
);


/* =========================================================
   LOGIN
========================================================= */

async function login() {

  const key =
    keyInput.value.trim();

  if (!key) {

    loginMsg.textContent =
      '⚠ Access key eka enter karanna';

    loginMsg.style.display =
      'block';

    return;
  }


  loginMsg.style.display =
    'none';


  const loginBtn =
    document.getElementById(
      'loginBtn'
    );

  loginBtn.disabled = true;

  loginBtn.textContent =
    '⏳ Checking...';


  try {

    const res =
      await fetch(
        '/api/bot-settings/' +
        encodeURIComponent(key),
        {
          method: 'GET',
          cache: 'no-store'
        }
      );


    const data =
      await res.json();


    if (!res.ok) {

      throw new Error(
        data.error ||
        'Login failed'
      );

    }


    /* Save key */

    currentKey = key;


    /* Bot number */

    document.getElementById(
      'botNum'
    ).textContent =
      '📱 Bot: ' +
      (data.number || 'N/A');


    /* Settings */

    botName.value =
      data.BOT_NAME || '';

    botImage.value =
      data.BOT_IMAGE || '';

    botFooter.value =
      data.BOT_FOOTER || '';


    /* Preview */

    updatePreview();


    /* Show dashboard */

    loginCard.classList.add(
      'hidden'
    );

    dashboard.classList.remove(
      'hidden'
    );


  } catch (err) {

    loginMsg.textContent =
      '⚠ ' + err.message;

    loginMsg.style.display =
      'block';

  } finally {

    loginBtn.disabled =
      false;

    loginBtn.textContent =
      '🔓 Login';
  }
}


/* =========================================================
   LOGIN BUTTON
========================================================= */

document
  .getElementById('loginBtn')
  .addEventListener(
    'click',
    login
  );


/* ENTER KEY LOGIN */

keyInput.addEventListener(
  'keydown',
  function(e) {

    if (e.key === 'Enter') {

      login();

    }

  }
);


/* =========================================================
   SAVE SETTINGS
========================================================= */

async function saveSettings() {

  if (!currentKey) {

    return;

  }


  saveMsg.style.display =
    'none';


  const saveBtn =
    document.getElementById(
      'saveBtn'
    );


  saveBtn.disabled =
    true;

  saveBtn.textContent =
    '⏳ Saving...';


  try {

    const res =
      await fetch(
        '/api/bot-settings/' +
        encodeURIComponent(
          currentKey
        ),
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body: JSON.stringify({

            BOT_NAME:
              botName.value.trim(),

            BOT_IMAGE:
              botImage.value.trim(),

            BOT_FOOTER:
              botFooter.value.trim()

          })

        }
      );


    const data =
      await res.json();


    if (!res.ok) {

      throw new Error(
        data.error ||
        'Save failed'
      );

    }


    saveMsg.textContent =
      '✅ Settings successfully saved!';

    saveMsg.className =
      'msg ok';

    saveMsg.style.display =
      'block';


    /* Preview refresh */

    updatePreview();


  } catch (err) {

    saveMsg.textContent =
      '⚠ ' + err.message;

    saveMsg.className =
      'msg err';

    saveMsg.style.display =
      'block';

  } finally {

    saveBtn.disabled =
      false;

    saveBtn.textContent =
      '💾 Save Changes';

  }
}


/* =========================================================
   SAVE BUTTON
========================================================= */

document
  .getElementById('saveBtn')
  .addEventListener(
    'click',
    saveSettings
  );


/* =========================================================
   INITIAL PREVIEW
========================================================= */

updatePreview();

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

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Bot Online Monitor</title>

<script
  src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
></script>

<script>

/* Chart.js fallback */

window.addEventListener(
  'error',
  function(e) {

    if (
      e.target &&
      e.target.tagName === 'SCRIPT' &&
      e.target.src &&
      e.target.src.includes('chart.umd')
    ) {

      const fallback =
        document.createElement(
          'script'
        );

      fallback.src =
        'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';

      document.head.appendChild(
        fallback
      );

    }

  },
  true
);

</script>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {

  font-family:
    'Segoe UI',
    system-ui,
    sans-serif;

  background:
    linear-gradient(
      135deg,
      #0f172a 0%,
      #1e1b4b 100%
    );

  color: #e2e8f0;

  min-height: 100vh;

  padding: 24px 16px;
}

.wrap {

  max-width: 900px;

  margin: 0 auto;
}

h1 {

  font-size: 22px;

  font-weight: 700;

  background:
    linear-gradient(
      90deg,
      #34d399,
      #60a5fa
    );

  -webkit-background-clip: text;

  background-clip: text;

  color: transparent;

  margin-bottom: 4px;
}

.sub {

  color: #94a3b8;

  font-size: 13px;

  margin-bottom: 20px;
}

.stats {

  display: flex;

  gap: 12px;

  margin-bottom: 20px;

  flex-wrap: wrap;
}

.card {

  flex: 1;

  min-width: 130px;

  background:
    rgba(255,255,255,.05);

  border:
    1px solid rgba(255,255,255,.08);

  border-radius: 14px;

  padding: 16px;

  backdrop-filter: blur(8px);
}

.card .label {

  font-size: 12px;

  color: #94a3b8;

  margin-bottom: 6px;
}

.card .value {

  font-size: 26px;

  font-weight: 700;
}

.online .value {

  color: #34d399;
}

.total .value {

  color: #60a5fa;
}

.chart-box {

  background:
    rgba(255,255,255,.04);

  border:
    1px solid rgba(255,255,255,.08);

  border-radius: 16px;

  padding: 16px;

  height: 380px;
}

.status-dot {

  display: inline-block;

  width: 8px;

  height: 8px;

  border-radius: 50%;

  background: #34d399;

  margin-right: 6px;

  box-shadow:
    0 0 8px #34d399;

  animation:
    pulse 1.5s infinite;
}

@keyframes pulse {

  0%,100% {
    opacity: 1;
  }

  50% {
    opacity: .3;
  }

}

.err {

  color: #f87171;

  font-size: 13px;

  margin-top: 10px;

  display: none;
}

.manage-link {

  color: #60a5fa;

  text-decoration: none;

  margin-left: 5px;
}

</style>

</head>

<body>

<div class="wrap">

  <h1>
    🤖 Bot Online Monitor
  </h1>

  <div class="sub">

    <span class="status-dot"></span>

    Live - real-time update

    <a
      href="/manage"
      class="manage-link"
    >
      ⚙ Manage your bot
    </a>

  </div>


  <div class="stats">

    <div class="card online">

      <div class="label">
        Online Bots
      </div>

      <div
        class="value"
        id="onlineVal"
      >
        --
      </div>

    </div>


    <div class="card total">

      <div class="label">
        Total Bots
      </div>

      <div
        class="value"
        id="totalVal"
      >
        --
      </div>

    </div>

  </div>


  <div class="chart-box">

    <canvas
      id="botChart"
    ></canvas>

  </div>


  <div
    class="err"
    id="errBox"
  ></div>

</div>


<script>

const ctx =
  document
    .getElementById(
      'botChart'
    )
    .getContext('2d');

const errBox =
  document.getElementById(
    'errBox'
  );

const MAX_POINTS = 30;

let chart = null;


/* =========================================================
   CREATE CHART
========================================================= */

function createChart() {

  if (
    typeof Chart ===
    'undefined'
  ) {

    errBox.textContent =
      '⚠ Chart library load wenne na';

    errBox.style.display =
      'block';

    return;

  }


  try {

    chart = new Chart(
      ctx,
      {

        type: 'line',

        data: {

          labels: [],

          datasets: [

            {

              label:
                'Online Bots',

              data: [],

              borderColor:
                '#34d399',

              backgroundColor:
                'rgba(52,211,153,0.15)',

              pointBackgroundColor:
                '#34d399',

              pointBorderColor:
                '#0f172a',

              pointRadius: 5,

              pointHoverRadius: 7,

              borderWidth: 2,

              tension: .35,

              fill: true

            }

          ]

        },

        options: {

          responsive: true,

          maintainAspectRatio:
            false,

          animation: {
            duration: 400
          },

          scales: {

            x: {

              ticks: {
                color:
                  '#94a3b8'
              },

              grid: {
                color:
                  'rgba(255,255,255,.05)'
              }

            },

            y: {

              beginAtZero: true,

              ticks: {

                color:
                  '#94a3b8',

                stepSize: 1

              },

              grid: {

                color:
                  'rgba(255,255,255,.05)'

              }

            }

          },

          plugins: {

            legend: {

              labels: {

                color:
                  '#e2e8f0'

              }

            }

          }

        }

      }
    );

  } catch (err) {

    console.error(
      'Chart init failed:',
      err
    );

  }

}


/* =========================================================
   FETCH DATA
========================================================= */

async function fetchData() {

  try {

    const res =
      await fetch(
        '/api/online-count',
        {
          cache: 'no-store'
        }
      );


    if (!res.ok) {

      throw new Error(
        'Server error: ' +
        res.status
      );

    }


    const data =
      await res.json();


    document.getElementById(
      'onlineVal'
    ).textContent =
      data.online;


    document.getElementById(
      'totalVal'
    ).textContent =
      data.total;


    errBox.style.display =
      'none';


    if (!chart) {

      return;

    }


    const label =
      new Date(
        data.time
      ).toLocaleTimeString(
        'en-GB'
      );


    chart.data.labels.push(
      label
    );


    chart.data.datasets[0]
      .data.push(
        data.online
      );


    if (
      chart.data.labels.length >
      MAX_POINTS
    ) {

      chart.data.labels.shift();

      chart.data.datasets[0]
        .data.shift();

    }


    chart.update();

  } catch (err) {

    console.error(
      'fetchData failed:',
      err
    );

    errBox.textContent =
      '⚠ Data load karanna baruwa: ' +
      err.message;

    errBox.style.display =
      'block';

  }

}


/* =========================================================
   START
========================================================= */

createChart();

fetchData();

setInterval(
  fetchData,
  5000
);

</script>

</body>

</html>`);
});


/* =========================================================
   START SERVER
========================================================= */

connectDB()

  .then(() => {

    app.listen(
      PORT,
      () => {

        console.log(
          `🚀 Server running on port ${PORT}`
        );

        console.log(
          `⚙ Manage page: /manage`
        );

      }
    );

  })

  .catch(err => {

    console.error(
      '❌ MongoDB connection failed:',
      err.message
    );

    process.exit(1);

  });
