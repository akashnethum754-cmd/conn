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
    console.error('❌ Query error:', err.message);

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

    if (typeof ALWAYS_ONLINE === 'boolean') {
      update['config.ALWAYS_ONLINE'] =
        ALWAYS_ONLINE ? 'true' : 'false';
    }

    if (typeof ALWAYS_MSG_SEEN === 'boolean') {
      update['config.ALWAYS_MSG_SEEN'] =
        ALWAYS_MSG_SEEN ? 'true' : 'false';
    }

    if (typeof STATUS_VIEW === 'boolean') {
      update['config.STATUS_VIEW'] =
        STATUS_VIEW ? 'true' : 'false';
    }

    if (typeof AUTO_LIKE === 'boolean') {
      update['config.AUTO_LIKE'] =
        AUTO_LIKE ? 'true' : 'false';
    }

    if (typeof ANTI_DELETE === 'boolean') {
      update['config.ANTI_DELETE'] =
        ANTI_DELETE ? 'true' : 'false';
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

<title>Bot Settings • Neon Control</title>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  scroll-behavior: smooth;
}

body {
  min-height: 100vh;
  overflow-x: hidden;

  font-family:
    "Segoe UI",
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;

  color: #f8fafc;

  background:
    radial-gradient(
      circle at 10% 10%,
      rgba(0,255,170,.12),
      transparent 28%
    ),
    radial-gradient(
      circle at 90% 20%,
      rgba(0,140,255,.14),
      transparent 30%
    ),
    radial-gradient(
      circle at 50% 100%,
      rgba(125,60,255,.12),
      transparent 35%
    ),
    linear-gradient(
      135deg,
      #020617 0%,
      #07111f 50%,
      #020617 100%
    );

  padding: 28px 15px;
}

/* =========================
   ANIMATED BACKGROUND
========================= */

body::before {
  content: "";
  position: fixed;
  inset: -50%;
  pointer-events: none;

  background-image:
    radial-gradient(
      rgba(0,255,170,.15) 1px,
      transparent 1px
    );

  background-size: 42px 42px;

  animation:
    gridMove 18s linear infinite;

  opacity: .35;

  z-index: -2;
}

body::after {
  content: "";

  position: fixed;

  width: 420px;
  height: 420px;

  right: -160px;
  top: -150px;

  border-radius: 50%;

  background:
    radial-gradient(
      circle,
      rgba(0,255,170,.14),
      transparent 65%
    );

  filter: blur(20px);

  animation:
    floatingGlow 7s ease-in-out infinite alternate;

  pointer-events: none;

  z-index: -1;
}

@keyframes gridMove {

  from {
    transform: translate(0,0);
  }

  to {
    transform: translate(42px,42px);
  }

}

@keyframes floatingGlow {

  from {
    transform:
      translate(0,0)
      scale(1);
  }

  to {
    transform:
      translate(-100px,100px)
      scale(1.3);
  }

}

/* =========================
   WRAPPER
========================= */

.wrap {
  width: 100%;
  max-width: 1050px;
  margin: auto;
  position: relative;
  z-index: 2;
}

.hidden {
  display: none !important;
}

/* =========================
   HEADER
========================= */

.header {
  margin-bottom: 25px;

  animation:
    fadeDown .7s ease both;
}

h1 {
  font-size: clamp(25px, 5vw, 36px);

  font-weight: 900;

  letter-spacing: -.8px;

  background:
    linear-gradient(
      90deg,
      #00ffa6,
      #25d366,
      #00b7ff,
      #7c3aed,
      #00ffa6
    );

  background-size: 300% auto;

  -webkit-background-clip: text;
  background-clip: text;

  color: transparent;

  animation:
    neonText 5s linear infinite;

  filter:
    drop-shadow(
      0 0 18px
      rgba(0,255,170,.25)
    );
}

.sub {
  color: #94a3b8;

  font-size: 13px;

  margin-top: 7px;

  letter-spacing: .2px;
}

/* =========================
   GLASS CARD
========================= */

.card {

  position: relative;

  overflow: hidden;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.075),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.10);

  border-radius: 22px;

  padding: 23px;

  backdrop-filter:
    blur(22px);

  -webkit-backdrop-filter:
    blur(22px);

  box-shadow:
    0 25px 70px
    rgba(0,0,0,.38),

    inset 0 1px 0
    rgba(255,255,255,.08);

  animation:
    cardIn .7s ease both;

  transition:
    transform .3s ease,
    border-color .3s ease,
    box-shadow .3s ease;
}

.card::before {

  content: "";

  position: absolute;

  width: 220px;
  height: 220px;

  right: -100px;
  top: -100px;

  border-radius: 50%;

  background:
    rgba(0,255,170,.10);

  filter: blur(60px);

  pointer-events: none;
}

.card:hover {

  transform:
    translateY(-3px);

  border-color:
    rgba(0,255,170,.25);

  box-shadow:
    0 30px 80px
    rgba(0,0,0,.45),

    0 0 35px
    rgba(0,255,170,.06),

    inset 0 1px 0
    rgba(255,255,255,.1);
}

.login-card {

  max-width: 500px;

  margin:
    50px auto;
}

/* =========================
   CARD TEXT
========================= */

.card-title {

  font-size: 17px;

  font-weight: 800;

  color: #f8fafc;
}

.card-sub {

  color: #94a3b8;

  font-size: 12px;

  margin-top: 5px;

  margin-bottom: 20px;
}

/* =========================
   LABELS
========================= */

label {

  display: block;

  font-size: 12px;

  color: #94a3b8;

  margin-top: 17px;

  margin-bottom: 7px;
}

/* =========================
   INPUT
========================= */

input {

  width: 100%;

  padding:
    13px 14px;

  border-radius: 12px;

  border:
    1px solid
    rgba(255,255,255,.11);

  background:
    rgba(0,0,0,.32);

  color: #f8fafc;

  font-size: 14px;

  outline: none;

  transition:
    .25s ease;

  box-shadow:
    inset 0 0 15px
    rgba(0,0,0,.15);
}

input::placeholder {
  color: #64748b;
}

input:focus {

  border-color:
    #00ffa6;

  background:
    rgba(0,20,25,.55);

  box-shadow:
    0 0 0 3px
    rgba(0,255,166,.08),

    0 0 22px
    rgba(0,255,166,.08),

    inset 0 0 15px
    rgba(0,0,0,.2);
}

/* =========================
   BUTTON
========================= */

button {

  width: 100%;

  margin-top: 20px;

  padding: 14px;

  border: none;

  border-radius: 13px;

  color: #00130d;

  font-size: 14px;

  font-weight: 900;

  cursor: pointer;

  position: relative;

  overflow: hidden;

  background:
    linear-gradient(
      100deg,
      #00ffa6,
      #25d366,
      #00b7ff
    );

  background-size: 200% auto;

  box-shadow:
    0 0 25px
    rgba(0,255,166,.18);

  transition:
    .25s ease;

  animation:
    buttonGradient 4s linear infinite;
}

button::before {

  content: "";

  position: absolute;

  top: 0;
  left: -120%;

  width: 80%;
  height: 100%;

  background:
    linear-gradient(
      90deg,
      transparent,
      rgba(255,255,255,.45),
      transparent
    );

  transform: skewX(-25deg);

  transition: .6s;
}

button:hover::before {
  left: 140%;
}

button:hover {

  transform:
    translateY(-2px);

  box-shadow:
    0 0 35px
    rgba(0,255,166,.30);
}

button:active {
  transform:
    scale(.98);
}

button:disabled {

  opacity: .55;

  cursor:
    not-allowed;

  transform:
    none;

  box-shadow:
    none;
}

/* =========================
   BOT NUMBER
========================= */

.botnum {

  display: flex;

  align-items: center;

  gap: 8px;

  background:
    linear-gradient(
      90deg,
      rgba(0,255,166,.08),
      rgba(0,183,255,.06)
    );

  border:
    1px solid
    rgba(0,255,166,.16);

  color:
    #34d399;

  padding:
    11px 13px;

  border-radius: 11px;

  font-size: 12px;

  box-shadow:
    0 0 20px
    rgba(0,255,166,.04);

  animation:
    softPulse 3s ease-in-out infinite;
}

/* =========================
   SECTION
========================= */

.section-title {

  font-size: 12px;

  font-weight: 800;

  color: #60a5fa;

  margin-top: 26px;

  margin-bottom: 5px;

  text-transform:
    uppercase;

  letter-spacing:
    1px;

  display: flex;

  align-items: center;

  gap: 8px;
}

.section-title::after {

  content: "";

  height: 1px;

  flex: 1;

  background:
    linear-gradient(
      90deg,
      rgba(96,165,250,.35),
      transparent
    );
}

/* =========================
   TOGGLE
========================= */

.toggle-row {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 15px;

  padding:
    14px 15px;

  margin-top: 10px;

  background:
    linear-gradient(
      135deg,
      rgba(255,255,255,.045),
      rgba(255,255,255,.018)
    );

  border:
    1px solid
    rgba(255,255,255,.07);

  border-radius: 14px;

  transition:
    .25s ease;
}

.toggle-row:hover {

  border-color:
    rgba(0,255,166,.18);

  background:
    rgba(0,255,166,.035);

  transform:
    translateX(3px);
}

.toggle-row .label-text {

  font-size: 13px;

  color:
    #e5e7eb;

  font-weight: 600;
}

.toggle-row .label-sub {

  font-size: 11px;

  color:
    #64748b;

  margin-top: 3px;
}

/* =========================
   SWITCH
========================= */

.switch {

  position: relative;

  width: 48px;
  height: 27px;

  flex-shrink: 0;

  margin: 0;
}

.switch input {

  opacity: 0;

  width: 0;
  height: 0;

  position: absolute;
}

.slider {

  position: absolute;

  inset: 0;

  cursor: pointer;

  border-radius: 30px;

  background:
    rgba(255,255,255,.13);

  border:
    1px solid
    rgba(255,255,255,.08);

  transition:
    .25s ease;
}

.slider:before {

  content: "";

  position: absolute;

  width: 19px;
  height: 19px;

  left: 3px;
  bottom: 3px;

  border-radius: 50%;

  background:
    #e5e7eb;

  box-shadow:
    0 2px 8px
    rgba(0,0,0,.4);

  transition:
    .25s cubic-bezier(.4,0,.2,1);
}

.switch input:checked + .slider {

  background:
    linear-gradient(
      90deg,
      #00d084,
      #25d366
    );

  border-color:
    #00ffa6;

  box-shadow:
    0 0 18px
    rgba(0,255,166,.28);
}

.switch input:checked + .slider:before {

  transform:
    translateX(21px);

  background:
    white;

  box-shadow:
    0 0 12px
    rgba(255,255,255,.65);
}

/* =========================
   MESSAGE
========================= */

.msg {

  display: none;

  margin-top: 13px;

  padding: 10px 12px;

  border-radius: 10px;

  font-size: 12px;
}

.msg.ok {

  color:
    #34d399;

  background:
    rgba(52,211,153,.07);

  border:
    1px solid
    rgba(52,211,153,.15);
}

.msg.err {

  color:
    #f87171;

  background:
    rgba(248,113,113,.07);

  border:
    1px solid
    rgba(248,113,113,.15);
}

/* =========================
   ANIMATIONS
========================= */

@keyframes fadeDown {

  from {
    opacity: 0;
    transform:
      translateY(-15px);
  }

  to {
    opacity: 1;
    transform:
      translateY(0);
  }

}

@keyframes cardIn {

  from {
    opacity: 0;
    transform:
      translateY(20px)
      scale(.98);
  }

  to {
    opacity: 1;
    transform:
      translateY(0)
      scale(1);
  }

}

@keyframes neonText {

  0% {
    background-position:
      0% 50%;
  }

  100% {
    background-position:
      300% 50%;
  }

}

@keyframes buttonGradient {

  0% {
    background-position:
      0% 50%;
  }

  100% {
    background-position:
      200% 50%;
  }

}

@keyframes softPulse {

  0%,100% {
    box-shadow:
      0 0 15px
      rgba(0,255,166,.03);
  }

  50% {
    box-shadow:
      0 0 25px
      rgba(0,255,166,.10);
  }

}

/* =========================
   MOBILE
========================= */

@media (max-width: 600px) {

  body {
    padding:
      18px 10px;
  }

  .card {
    padding:
      18px;

    border-radius:
      18px;
  }

  .login-card {
    margin:
      30px auto;
  }

  .toggle-row {
    padding:
      13px;
  }

  h1 {
    font-size:
      26px;
  }

}

/* =========================
   REDUCED MOTION
========================= */

@media (prefers-reduced-motion: reduce) {

  *,
  *::before,
  *::after {

    animation-duration:
      .01ms !important;

    animation-iteration-count:
      1 !important;

    scroll-behavior:
      auto !important;
  }

}

</style>

</head>

<body>

<div class="wrap">

  <div class="header">

    <h1>🤖 Bot Settings</h1>

    <div class="sub">
      Access key eken login wela oyage bot eke settings manage karanna
    </div>

  </div>


  <!-- LOGIN -->

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
      id="loginMsg">
    </div>

  </div>


  <!-- DASHBOARD -->

  <div
    class="hidden"
    id="dashboard">

    <div class="card">

      <div
        class="botnum"
        id="botNum">
        📱 Bot: N/A
      </div>


      <div class="section-title">
        🎨 Bot Identity
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
        placeholder="e.g. POWERED BY SHAGGY"
        autocomplete="off"
      >


      <label>
        Movie Footer Text
      </label>

      <input
        id="movieFooter"
        placeholder="e.g. SHAGGY XMD MOVIE"
        autocomplete="off"
      >


      <div class="section-title">
        ⚙️ Behaviour Toggles
      </div>


      <div class="toggle-row">

        <div>

          <div class="label-text">
            🟢 Always Online
          </div>

          <div class="label-sub">
            Bot ALWAYS online widihata pennanawa
          </div>

        </div>

        <label class="switch">

          <input
            type="checkbox"
            id="alwaysOnline"
          >

          <span class="slider"></span>

        </label>

      </div>


      <div class="toggle-row">

        <div>

          <div class="label-text">
            👁️ Auto Seen
          </div>

          <div class="label-sub">
            Messages auto widihata seen karanawa
          </div>

        </div>

        <label class="switch">

          <input
            type="checkbox"
            id="alwaysMsgSeen"
          >

          <span class="slider"></span>

        </label>

      </div>


      <div class="toggle-row">

        <div>

          <div class="label-text">
            📺 Auto Status View
          </div>

          <div class="label-sub">
            Status update okkoma auto balanawa
          </div>

        </div>

        <label class="switch">

          <input
            type="checkbox"
            id="statusView"
          >

          <span class="slider"></span>

        </label>

      </div>


      <div class="toggle-row">

        <div>

          <div class="label-text">
            ❤️ Auto Status Like
          </div>

          <div class="label-sub">
            Status update walata auto react karanawa
          </div>

        </div>

        <label class="switch">

          <input
            type="checkbox"
            id="autoLike"
          >

          <span class="slider"></span>

        </label>

      </div>


      <div class="toggle-row">

        <div>

          <div class="label-text">
            🗑️ Anti-Delete
          </div>

          <div class="label-sub">
            Delete karapu messages owner ta yawanawa
          </div>

        </div>

        <label class="switch">

          <input
            type="checkbox"
            id="antiDelete"
          >

          <span class="slider"></span>

        </label>

      </div>


      <button id="saveBtn">
        💾 Save Changes
      </button>

      <div
        class="msg"
        id="saveMsg">
      </div>

    </div>

  </div>

</div>


<script>

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

const movieFooter =
  document.getElementById('movieFooter');

const alwaysOnline =
  document.getElementById('alwaysOnline');

const alwaysMsgSeen =
  document.getElementById('alwaysMsgSeen');

const statusView =
  document.getElementById('statusView');

const autoLike =
  document.getElementById('autoLike');

const antiDelete =
  document.getElementById('antiDelete');


/* =========================
   LOGIN
========================= */

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
    document.getElementById('loginBtn');

  loginBtn.disabled =
    true;

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


    currentKey =
      key;


    document.getElementById(
      'botNum'
    ).textContent =
      '📱 Bot: ' +
      (data.number || 'N/A');


    botName.value =
      data.BOT_NAME || '';

    botImage.value =
      data.BOT_IMAGE || '';

    botFooter.value =
      data.BOT_FOOTER || '';

    movieFooter.value =
      data.MOVIE_FOOTER || '';


    alwaysOnline.checked =
      !!data.ALWAYS_ONLINE;

    alwaysMsgSeen.checked =
      !!data.ALWAYS_MSG_SEEN;

    statusView.checked =
      !!data.STATUS_VIEW;

    autoLike.checked =
      !!data.AUTO_LIKE;

    antiDelete.checked =
      !!data.ANTI_DELETE;


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


document
  .getElementById('loginBtn')
  .addEventListener(
    'click',
    login
  );


keyInput.addEventListener(
  'keydown',
  function(e) {

    if (e.key === 'Enter') {
      login();
    }

  }
);


/* =========================
   SAVE
========================= */

async function saveSettings() {

  if (!currentKey) return;

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
        encodeURIComponent(currentKey),
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
              botFooter.value.trim(),

            MOVIE_FOOTER:
              movieFooter.value.trim(),

            ALWAYS_ONLINE:
              alwaysOnline.checked,

            ALWAYS_MSG_SEEN:
              alwaysMsgSeen.checked,

            STATUS_VIEW:
              statusView.checked,

            AUTO_LIKE:
              autoLike.checked,

            ANTI_DELETE:
              antiDelete.checked

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
      '✅ Settings successfully saved! Bot eka reconnect wena wita apply wenawa.';

    saveMsg.className =
      'msg ok';

    saveMsg.style.display =
      'block';


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


document
  .getElementById('saveBtn')
  .addEventListener(
    'click',
    saveSettings
  );

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

<title>Bot Online Monitor • Neon</title>

<script
src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js">
</script>

<script>

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
        document.createElement('script');

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

html {
  scroll-behavior: smooth;
}

body {

  min-height: 100vh;

  overflow-x: hidden;

  font-family:
    "Segoe UI",
    system-ui,
    sans-serif;

  color: #e2e8f0;

  padding:
    25px 15px;

  background:

    radial-gradient(
      circle at 10% 10%,
      rgba(0,255,170,.12),
      transparent 28%
    ),

    radial-gradient(
      circle at 90% 20%,
      rgba(0,140,255,.15),
      transparent 30%
    ),

    radial-gradient(
      circle at 50% 100%,
      rgba(120,60,255,.12),
      transparent 35%
    ),

    linear-gradient(
      135deg,
      #020617,
      #07111f,
      #020617
    );
}


/* =========================
   ANIMATED BACKGROUND
========================= */

body::before {

  content: "";

  position: fixed;

  inset: -50%;

  pointer-events: none;

  background-image:
    radial-gradient(
      rgba(0,255,170,.16) 1px,
      transparent 1px
    );

  background-size:
    42px 42px;

  animation:
    gridMove 18s linear infinite;

  opacity: .32;

  z-index: -2;
}

body::after {

  content: "";

  position: fixed;

  width: 450px;
  height: 450px;

  top: -180px;
  right: -150px;

  border-radius: 50%;

  background:
    radial-gradient(
      circle,
      rgba(0,255,170,.14),
      transparent 65%
    );

  filter: blur(20px);

  animation:
    floatingGlow 7s ease-in-out infinite alternate;

  z-index: -1;
}

@keyframes gridMove {

  from {
    transform:
      translate(0,0);
  }

  to {
    transform:
      translate(42px,42px);
  }

}

@keyframes floatingGlow {

  from {
    transform:
      translate(0,0)
      scale(1);
  }

  to {
    transform:
      translate(-100px,100px)
      scale(1.3);
  }

}


/* =========================
   WRAP
========================= */

.wrap {

  width: 100%;

  max-width:
    950px;

  margin:
    0 auto;

  position:
    relative;

  z-index:
    2;
}


/* =========================
   TITLE
========================= */

h1 {

  font-size:
    clamp(24px,5vw,35px);

  font-weight:
    900;

  letter-spacing:
    -.8px;

  background:
    linear-gradient(
      90deg,
      #00ffa6,
      #25d366,
      #00b7ff,
      #7c3aed,
      #00ffa6
    );

  background-size:
    300% auto;

  -webkit-background-clip:
    text;

  background-clip:
    text;

  color:
    transparent;

  animation:
    neonText 5s linear infinite;

  filter:
    drop-shadow(
      0 0 18px
      rgba(0,255,170,.25)
    );

  margin-bottom:
    6px;
}

.sub {

  color:
    #94a3b8;

  font-size:
    13px;

  margin-bottom:
    22px;
}


/* =========================
   STATUS DOT
========================= */

.status-dot {

  display:
    inline-block;

  width:
    9px;

  height:
    9px;

  border-radius:
    50%;

  background:
    #00ffa6;

  margin-right:
    7px;

  box-shadow:
    0 0 8px
    #00ffa6,

    0 0 20px
    rgba(0,255,166,.7);

  animation:
    onlinePulse 1.5s infinite;
}

@keyframes onlinePulse {

  0%,100% {
    opacity: 1;
    transform:
      scale(1);
  }

  50% {
    opacity: .35;
    transform:
      scale(.75);
  }

}


/* =========================
   MANAGE LINK
========================= */

.manage-link {

  color:
    #60a5fa;

  text-decoration:
    none;

  margin-left:
    8px;

  padding:
    5px 9px;

  border-radius:
    7px;

  transition:
    .25s ease;
}

.manage-link:hover {

  color:
    #00ffa6;

  background:
    rgba(0,255,166,.06);

  box-shadow:
    0 0 15px
    rgba(0,255,166,.08);
}


/* =========================
   STATS
========================= */

.stats {

  display:
    flex;

  gap:
    15px;

  margin-bottom:
    20px;

  flex-wrap:
    wrap;
}

.card {

  flex:
    1;

  min-width:
    160px;

  padding:
    19px;

  border-radius:
    18px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.075),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.09);

  backdrop-filter:
    blur(20px);

  box-shadow:
    0 20px 55px
    rgba(0,0,0,.30),

    inset 0 1px 0
    rgba(255,255,255,.07);

  transition:
    .3s ease;

  position:
    relative;

  overflow:
    hidden;
}

.card::after {

  content: "";

  position: absolute;

  width:
    130px;

  height:
    130px;

  right:
    -70px;

  top:
    -70px;

  border-radius:
    50%;

  background:
    rgba(0,255,166,.09);

  filter:
    blur(25px);
}

.card:hover {

  transform:
    translateY(-4px);

  border-color:
    rgba(0,255,166,.22);

  box-shadow:
    0 25px 70px
    rgba(0,0,0,.4),

    0 0 30px
    rgba(0,255,166,.06);
}

.card .label {

  font-size:
    12px;

  color:
    #94a3b8;

  margin-bottom:
    7px;
}

.card .value {

  font-size:
    32px;

  font-weight:
    900;

  line-height:
    1;

  text-shadow:
    0 0 18px
    currentColor;
}

.online .value {

  color:
    #34d399;
}

.total .value {

  color:
    #60a5fa;
}


/* =========================
   CHART
========================= */

.chart-box {

  position:
    relative;

  height:
    400px;

  padding:
    18px;

  border-radius:
    20px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.055),
      rgba(255,255,255,.018)
    );

  border:
    1px solid
    rgba(255,255,255,.08);

  backdrop-filter:
    blur(20px);

  box-shadow:
    0 25px 70px
    rgba(0,0,0,.38),

    inset 0 1px 0
    rgba(255,255,255,.07);

  animation:
    chartIn .8s ease both;
}

.chart-box::before {

  content: "";

  position: absolute;

  left:
    10%;

  right:
    10%;

  top:
    -1px;

  height:
    1px;

  background:
    linear-gradient(
      90deg,
      transparent,
      #00ffa6,
      #00b7ff,
      transparent
    );

  opacity:
    .45;

  filter:
    blur(1px);
}


/* =========================
   ERROR
========================= */

.err {

  color:
    #f87171;

  font-size:
    13px;

  margin-top:
    12px;

  padding:
    10px 12px;

  border-radius:
    10px;

  background:
    rgba(248,113,113,.06);

  border:
    1px solid
    rgba(248,113,113,.12);

  display:
    none;
}


/* =========================
   ANIMATIONS
========================= */

@keyframes neonText {

  0% {
    background-position:
      0% 50%;
  }

  100% {
    background-position:
      300% 50%;
  }

}

@keyframes chartIn {

  from {
    opacity: 0;

    transform:
      translateY(20px)
      scale(.98);
  }

  to {
    opacity: 1;

    transform:
      translateY(0)
      scale(1);
  }

}


/* =========================
   MOBILE
========================= */

@media (max-width:600px) {

  body {
    padding:
      18px 10px;
  }

  .stats {
    gap:
      10px;
  }

  .card {
    min-width:
      calc(50% - 5px);

    padding:
      15px;
  }

  .card .value {
    font-size:
      27px;
  }

  .chart-box {
    height:
      330px;

    padding:
      12px;
  }

}

@media (max-width:420px) {

  .stats {
    flex-direction:
      column;
  }

  .card {
    width:
      100%;
  }

  .chart-box {
    height:
      300px;
  }

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

    Live • Real-time update

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
        🟢 Online Bots
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
        🌐 Total Bots
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


/* =========================
   CREATE CHART
========================= */

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

    chart =
      new Chart(
        ctx,
        {

          type:
            'line',

          data: {

            labels: [],

            datasets: [

              {

                label:
                  'Online Bots',

                data: [],

                borderColor:
                  '#00ffa6',

                backgroundColor:
                  'rgba(0,255,166,.12)',

                pointBackgroundColor:
                  '#00ffa6',

                pointBorderColor:
                  '#020617',

                pointRadius:
                  4,

                pointHoverRadius:
                  7,

                borderWidth:
                  2,

                tension:
                  .4,

                fill:
                  true

              }

            ]

          },


          options: {

            responsive:
              true,

            maintainAspectRatio:
              false,

            animation: {
              duration:
                450
            },

            interaction: {
              intersect:
                false,

              mode:
                'index'
            },


            scales: {

              x: {

                ticks: {
                  color:
                    '#64748b'
                },

                grid: {
                  color:
                    'rgba(255,255,255,.045)'
                }

              },

              y: {

                beginAtZero:
                  true,

                ticks: {

                  color:
                    '#64748b',

                  stepSize:
                    1

                },

                grid: {

                  color:
                    'rgba(255,255,255,.045)'
                }

              }

            },


            plugins: {

              legend: {

                labels: {

                  color:
                    '#e2e8f0',

                  usePointStyle:
                    true,

                  padding:
                    18

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


/* =========================
   FETCH DATA
========================= */

async function fetchData() {

  try {

    const res =
      await fetch(
        '/api/online-count',
        {
          cache:
            'no-store'
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


    if (!chart)
      return;


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


/* =========================
   START
========================= */

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
