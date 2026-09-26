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

const PAIR_WEB_URL =
  process.env.PAIR_WEB_URL || 'https://www.shaggytech.online';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI .env file eke danna one!');
  process.exit(1);
}

let collection;

/* =========================================================
   DATABASE
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

app.use(express.json({ limit: '1mb' }));

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
      Date.now() -
        ONLINE_THRESHOLD_MINUTES * 60 * 1000
    );

    const [onlineCount, totalCount] =
      await Promise.all([
        collection.countDocuments({
          [TIMESTAMP_FIELD]: {
            $gte: thresholdDate
          }
        }),

        collection.countDocuments({})
      ]);

    const percentage =
      totalCount > 0
        ? Number(
            ((onlineCount / totalCount) * 100).toFixed(1)
          )
        : 0;

    res.json({
      online: onlineCount,
      total: totalCount,
      percentage,
      thresholdMinutes:
        ONLINE_THRESHOLD_MINUTES,
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
   BOT SETTINGS GET
========================================================= */

app.get('/api/bot-settings/:key', async (req, res) => {
  try {
    if (!collection) {
      return res.status(503).json({
        error: 'Database ready naha'
      });
    }

    const key =
      String(req.params.key || '').trim();

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

    const number =
      String(doc.number || '');

    const maskedNumber =
      number.length > 6
        ? number.slice(0, 4) +
          '••••' +
          number.slice(-2)
        : 'N/A';

    res.json({
      number: maskedNumber,

      BOT_NAME:
        cfg.BOT_NAME || '',

      BOT_IMAGE:
        cfg.BOT_IMAGE || '',

      BOT_FOOTER:
        cfg.BOT_FOOTER || '',

      MOVIE_FOOTER:
        cfg.MOVIE_FOOTER || '',

      ALWAYS_ONLINE:
        cfg.ALWAYS_ONLINE === 'true',

      ALWAYS_MSG_SEEN:
        cfg.ALWAYS_MSG_SEEN === 'true',

      STATUS_VIEW:
        cfg.STATUS_VIEW === 'true',

      AUTO_LIKE:
        cfg.AUTO_LIKE === 'true',

      ANTI_DELETE:
        cfg.ANTI_DELETE === 'true'
    });

  } catch (err) {
    console.error(
      '❌ settings GET:',
      err.message
    );

    res.status(500).json({
      error: 'Data ganna bari una'
    });
  }
});

/* =========================================================
   BOT SETTINGS SAVE
========================================================= */

app.post('/api/bot-settings/:key', async (req, res) => {
  try {
    if (!collection) {
      return res.status(503).json({
        error: 'Database ready naha'
      });
    }

    const key =
      String(req.params.key || '').trim();

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

    if (typeof MOVIE_FOOTER === 'string') {
      update['config.MOVIE_FOOTER'] =
        MOVIE_FOOTER.trim();
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

    update.updatedAt = new Date();

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
      '❌ settings POST:',
      err.message
    );

    res.status(500).json({
      error: 'Save karanna bari una'
    });
  }
});

/* =========================================================
   GLOBAL CSS
========================================================= */

const CSS = `
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #03050a;
  --card: rgba(12,17,29,.72);
  --line: rgba(255,255,255,.09);
  --text: #f5f8ff;
  --muted: #8792a8;
  --cyan: #00eaff;
  --blue: #5865ff;
  --purple: #a855f7;
  --green: #21f39a;
  --red: #ff5577;
}

html {
  scroll-behavior: smooth;
}

body {
  min-height: 100vh;
  color: var(--text);
  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background:
    radial-gradient(
      circle at 10% 10%,
      rgba(0,234,255,.13),
      transparent 28%
    ),
    radial-gradient(
      circle at 90% 15%,
      rgba(168,85,247,.14),
      transparent 30%
    ),
    radial-gradient(
      circle at 50% 100%,
      rgba(88,101,255,.13),
      transparent 35%
    ),
    var(--bg);

  overflow-x: hidden;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  pointer-events: none;
  opacity: .35;

  background-image:
    linear-gradient(
      rgba(255,255,255,.025) 1px,
      transparent 1px
    ),
    linear-gradient(
      90deg,
      rgba(255,255,255,.025) 1px,
      transparent 1px
    );

  background-size: 55px 55px;

  animation:
    gridMove 18s linear infinite;
}

body::after {
  content: "";
  position: fixed;

  width: 500px;
  height: 500px;

  left: -260px;
  bottom: -260px;

  border-radius: 50%;

  background:
    rgba(0,234,255,.08);

  filter: blur(90px);

  pointer-events: none;

  animation:
    orb 9s ease-in-out infinite;
}

a {
  color: inherit;
  text-decoration: none;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

.wrap {
  width: min(
    1180px,
    calc(100% - 30px)
  );

  margin: auto;

  padding:
    24px
    0
    70px;

  position: relative;
  z-index: 2;
}

/* HEADER */

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;

  gap: 15px;

  margin-bottom: 28px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-icon {
  width: 48px;
  height: 48px;

  display: grid;
  place-items: center;

  border-radius: 16px;

  background:
    linear-gradient(
      135deg,
      rgba(0,234,255,.18),
      rgba(168,85,247,.18)
    );

  border:
    1px solid
    rgba(0,234,255,.25);

  box-shadow:
    0 0 35px
    rgba(0,234,255,.12);

  font-size: 23px;
}

.brand strong {
  display: block;
  font-size: 15px;
  letter-spacing: .12em;
}

.brand span {
  display: block;
  color: var(--muted);
  font-size: 10px;
  margin-top: 3px;
  letter-spacing: .14em;
  text-transform: uppercase;
}

.nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nav a {
  padding: 10px 14px;

  border:
    1px solid
    var(--line);

  border-radius: 12px;

  background:
    rgba(255,255,255,.035);

  color: #dce4f3;

  font-size: 12px;

  transition: .25s;
}

.nav a:hover {
  transform: translateY(-2px);

  border-color:
    rgba(0,234,255,.35);

  background:
    rgba(0,234,255,.07);

  box-shadow:
    0 10px 30px
    rgba(0,234,255,.08);
}

/* HERO */

.hero {
  position: relative;
  overflow: hidden;

  padding: 75px 42px;

  border:
    1px solid
    var(--line);

  border-radius: 30px;

  background:
    rgba(7,10,18,.72);

  box-shadow:
    0 30px 90px
    rgba(0,0,0,.45);

  backdrop-filter:
    blur(25px);
}

.hero::before {
  content: "";

  position: absolute;

  width: 450px;
  height: 450px;

  right: -180px;
  top: -200px;

  border-radius: 50%;

  background:
    radial-gradient(
      circle,
      rgba(0,234,255,.22),
      transparent 68%
    );

  animation:
    heroOrb 8s ease-in-out infinite;
}

.eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;

  padding: 7px 11px;

  border-radius: 999px;

  color: #8cf8ff;

  background:
    rgba(0,234,255,.05);

  border:
    1px solid
    rgba(0,234,255,.17);

  font-size: 10px;
  font-weight: 800;

  letter-spacing: .13em;
  text-transform: uppercase;
}

.dot {
  width: 7px;
  height: 7px;

  border-radius: 50%;

  background:
    var(--green);

  box-shadow:
    0 0 15px
    var(--green);

  animation:
    pulse 1.6s infinite;
}

.hero h1 {
  position: relative;

  max-width: 850px;

  margin-top: 20px;

  font-size:
    clamp(
      43px,
      7vw,
      80px
    );

  line-height: .98;

  letter-spacing: -.055em;

  background:
    linear-gradient(
      100deg,
      #fff,
      #80f8ff 45%,
      #a677ff
    );

  -webkit-background-clip: text;
  background-clip: text;

  color: transparent;
}

.hero p {
  max-width: 690px;

  margin-top: 22px;

  color: #99a5ba;

  line-height: 1.8;

  font-size: 15px;
}

.actions {
  display: flex;
  flex-wrap: wrap;

  gap: 11px;

  margin-top: 30px;
}

.btn {
  min-height: 47px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  gap: 8px;

  padding: 0 19px;

  border-radius: 13px;

  color: white;

  border:
    1px solid
    rgba(255,255,255,.1);

  background:
    rgba(255,255,255,.04);

  font-size: 12px;
  font-weight: 750;

  transition: .25s;

  position: relative;
  overflow: hidden;
}

.btn:hover {
  transform:
    translateY(-3px);

  box-shadow:
    0 15px 40px
    rgba(0,0,0,.3);
}

.btn-primary {
  background:
    linear-gradient(
      135deg,
      #00bcd4,
      #5865ff
    );

  border-color:
    rgba(0,234,255,.3);

  box-shadow:
    0 12px 35px
    rgba(0,190,255,.17);
}

.btn-purple {
  background:
    linear-gradient(
      135deg,
      rgba(168,85,247,.2),
      rgba(88,101,255,.2)
    );
}

/* SECTION */

.section {
  margin-top: 30px;
}

.section-title {
  margin-bottom: 14px;
}

.section-title small {
  color: #72f6ff;

  font-size: 10px;

  font-weight: 800;

  letter-spacing: .17em;

  text-transform: uppercase;
}

.section-title h2 {
  margin-top: 6px;

  font-size: 24px;

  letter-spacing: -.03em;
}

.section-title p {
  color: var(--muted);

  margin-top: 7px;

  font-size: 12px;
}

/* STATS */

.stats {
  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 14px;
}

.card {
  border:
    1px solid
    var(--line);

  border-radius: 21px;

  background:
    var(--card);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.25);

  backdrop-filter:
    blur(22px);
}

.stat {
  padding: 23px;

  transition: .3s;
}

.stat:hover {
  transform:
    translateY(-4px);

  border-color:
    rgba(0,234,255,.17);
}

.stat-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-icon {
  width: 40px;
  height: 40px;

  display: grid;
  place-items: center;

  border-radius: 12px;

  background:
    rgba(0,234,255,.07);

  border:
    1px solid
    rgba(0,234,255,.13);
}

.label {
  color: var(--muted);
  font-size: 11px;
}

.value {
  margin-top: 16px;

  font-size: 38px;
  font-weight: 850;

  letter-spacing: -.04em;
}

.note {
  margin-top: 8px;

  color: #647188;

  font-size: 10px;
}

/* FEATURES */

.features {
  display: grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap: 14px;
}

.feature {
  padding: 22px;

  transition: .3s;
}

.feature:hover {
  transform:
    translateY(-4px);

  border-color:
    rgba(0,234,255,.17);
}

.feature-icon {
  width: 42px;
  height: 42px;

  display: grid;
  place-items: center;

  border-radius: 13px;

  background:
    linear-gradient(
      135deg,
      rgba(0,234,255,.1),
      rgba(168,85,247,.1)
    );

  margin-bottom: 15px;
}

.feature h3 {
  font-size: 14px;
}

.feature p {
  color: var(--muted);

  margin-top: 8px;

  font-size: 11px;

  line-height: 1.7;
}

/* PANEL */

.panel {
  padding: 22px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;

  gap: 15px;

  margin-bottom: 18px;
}

.panel-title {
  font-size: 14px;
  font-weight: 800;
}

.panel-sub {
  color: var(--muted);

  font-size: 10px;

  margin-top: 4px;
}

.chart {
  height: 310px;
}

/* LIVE */

.live {
  display: inline-flex;

  align-items: center;

  gap: 7px;

  padding: 7px 11px;

  border-radius: 999px;

  color: #9fffd9;

  background:
    rgba(33,243,154,.05);

  border:
    1px solid
    rgba(33,243,154,.16);

  font-size: 10px;
}

/* LOGIN */

.login {
  min-height: 75vh;

  display: grid;
  place-items: center;
}

.login-box {
  width:
    min(500px, 100%);

  padding: 30px;
}

.login-icon {
  width: 62px;
  height: 62px;

  display: grid;
  place-items: center;

  border-radius: 19px;

  background:
    linear-gradient(
      135deg,
      rgba(0,234,255,.14),
      rgba(168,85,247,.14)
    );

  font-size: 27px;

  margin-bottom: 18px;
}

.login-box h1 {
  font-size: 27px;
}

.login-box p {
  color: var(--muted);

  font-size: 12px;

  line-height: 1.7;

  margin-top: 7px;
}

.field {
  margin-top: 18px;
}

label {
  display: block;

  color: #aeb9cc;

  font-size: 10px;

  font-weight: 750;

  text-transform: uppercase;

  margin-bottom: 7px;
}

input {
  width: 100%;
  height: 47px;

  outline: none;

  border:
    1px solid
    rgba(255,255,255,.09);

  border-radius: 12px;

  background:
    rgba(0,0,0,.25);

  color: white;

  padding: 0 13px;

  transition: .25s;
}

input:focus {
  border-color:
    rgba(0,234,255,.45);

  box-shadow:
    0 0 0 4px
    rgba(0,234,255,.05);
}

.full {
  width: 100%;
  margin-top: 15px;
}

.msg {
  min-height: 20px;

  margin-top: 12px;

  font-size: 11px;
}

.error {
  color: #ff7893;
}

.success {
  color: #5df2b0;
}

/* MANAGE */

.manage {
  display: grid;

  grid-template-columns:
    1.5fr .8fr;

  gap: 17px;
}

.settings {
  padding: 24px;
}

.settings-head {
  display: flex;

  justify-content: space-between;

  gap: 15px;

  padding-bottom: 18px;

  border-bottom:
    1px solid
    var(--line);
}

.settings-head h1 {
  font-size: 22px;
}

.settings-head p {
  color: var(--muted);

  margin-top: 5px;

  font-size: 11px;
}

.bot-number {
  height: fit-content;

  padding: 8px 11px;

  border-radius: 999px;

  color: #80f8ff;

  background:
    rgba(0,234,255,.05);

  border:
    1px solid
    rgba(0,234,255,.16);

  font-size: 10px;
}

.form-grid {
  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 13px;
}

.wide {
  grid-column:
    1 / -1;
}

.group {
  margin-top: 22px;
}

.group-title {
  display: flex;

  align-items: center;

  gap: 8px;

  margin-bottom: 12px;

  font-size: 13px;

  font-weight: 800;
}

.group-title span {
  width: 29px;
  height: 29px;

  display: grid;
  place-items: center;

  border-radius: 9px;

  background:
    rgba(0,234,255,.07);
}

.toggles {
  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 9px;
}

.toggle {
  display: flex;

  justify-content: space-between;
  align-items: center;

  gap: 10px;

  padding: 13px;

  border:
    1px solid
    rgba(255,255,255,.06);

  border-radius: 14px;

  background:
    rgba(255,255,255,.025);
}

.toggle strong {
  display: block;
  font-size: 11px;
}

.toggle small {
  display: block;

  color: #66738a;

  margin-top: 4px;

  font-size: 9px;
}

.switch {
  width: 44px;
  height: 24px;

  position: relative;

  flex-shrink: 0;
}

.switch input {
  display: none;
}

.slider {
  position: absolute;
  inset: 0;

  border-radius: 999px;

  background: #19202e;

  border:
    1px solid
    rgba(255,255,255,.08);

  transition: .25s;
}

.slider::before {
  content: "";

  position: absolute;

  width: 16px;
  height: 16px;

  left: 3px;
  top: 3px;

  border-radius: 50%;

  background: #718097;

  transition: .25s;
}

.switch input:checked + .slider {
  background:
    rgba(0,234,255,.16);

  border-color:
    rgba(0,234,255,.4);
}

.switch input:checked +
.slider::before {
  transform:
    translateX(20px);

  background:
    var(--cyan);

  box-shadow:
    0 0 15px
    var(--cyan);
}

.preview {
  padding: 24px;

  height: fit-content;

  position: sticky;

  top: 15px;
}

.preview-label {
  color: #718097;

  font-size: 9px;

  font-weight: 800;

  letter-spacing: .15em;

  text-transform: uppercase;
}

.avatar {
  width: 130px;
  height: 130px;

  margin: 20px auto;

  display: grid;
  place-items: center;

  overflow: hidden;

  border-radius: 34px;

  border:
    1px solid
    rgba(0,234,255,.2);

  background:
    #0b101a;

  box-shadow:
    0 0 45px
    rgba(0,234,255,.1);

  font-size: 45px;
}

.avatar img {
  width: 100%;
  height: 100%;

  object-fit: cover;
}

.preview-name {
  text-align: center;

  font-size: 18px;

  font-weight: 850;
}

.preview-footer {
  color: var(--muted);

  text-align: center;

  font-size: 10px;

  line-height: 1.6;

  margin-top: 7px;
}

.save-row {
  display: flex;

  gap: 10px;

  margin-top: 23px;
}

.save-row .btn {
  flex: 1;
}

/* STATUS */

.status-hero {
  margin:
    20px
    0;

  display: flex;

  justify-content: space-between;

  align-items: flex-end;

  gap: 20px;
}

.status-hero h1 {
  margin-top: 17px;

  font-size:
    clamp(32px, 5vw, 52px);

  letter-spacing: -.05em;
}

.status-hero p {
  color: var(--muted);

  max-width: 650px;

  margin-top: 8px;

  line-height: 1.7;

  font-size: 12px;
}

.status-grid {
  display: grid;

  grid-template-columns:
    1.7fr 1fr;

  gap: 15px;
}

.system-list {
  display: grid;
  gap: 9px;
}

.system-row {
  display: flex;

  justify-content: space-between;

  gap: 10px;

  padding: 12px;

  border-radius: 12px;

  background:
    rgba(255,255,255,.025);

  border:
    1px solid
    rgba(255,255,255,.05);

  font-size: 10px;
}

.system-row span:first-child {
  color: #77849a;
}

.system-row span:last-child {
  color: #dce5f5;
  font-weight: 750;
}

/* FOOTER */

.footer {
  text-align: center;

  color: #657188;

  font-size: 10px;

  margin-top: 30px;
}

.footer a {
  color: #7ff8ff;
}

/* ANIMATION */

@keyframes gridMove {
  from {
    background-position:
      0 0,
      0 0;
  }

  to {
    background-position:
      0 55px,
      55px 0;
  }
}

@keyframes orb {
  50% {
    transform:
      translate(80px,-50px)
      scale(1.1);
  }
}

@keyframes heroOrb {
  50% {
    transform:
      translate(-35px,35px)
      scale(1.12);
  }
}

@keyframes pulse {
  50% {
    transform: scale(1.5);
    opacity: .55;
  }
}

/* MOBILE */

@media(max-width:850px) {

  .hero {
    padding: 55px 25px;
  }

  .stats,
  .features {
    grid-template-columns: 1fr;
  }

  .manage,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .preview {
    position: static;
  }
}

@media(max-width:620px) {

  .wrap {
    width:
      calc(100% - 18px);

    padding-top: 14px;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .nav {
    width: 100%;
  }

  .nav a {
    flex: 1;
    text-align: center;
  }

  .hero {
    padding: 43px 20px;
    border-radius: 22px;
  }

  .hero h1 {
    font-size: 45px;
  }

  .hero p {
    font-size: 13px;
  }

  .actions .btn {
    width: 100%;
  }

  .form-grid,
  .toggles {
    grid-template-columns: 1fr;
  }

  .wide {
    grid-column: auto;
  }

  .settings,
  .preview,
  .login-box,
  .panel {
    padding: 18px;
  }

  .settings-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .status-hero {
    flex-direction: column;
    align-items: flex-start;
  }

  .chart {
    height: 260px;
  }
}

@media(prefers-reduced-motion:reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
`;

/* =========================================================
   HOME PAGE /
========================================================= */

app.get('/', (req, res) => {

  res.set(
    'Cache-Control',
    'no-store'
  );

  res.send(`<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1.0"
>

<meta
  name="theme-color"
  content="#03050a"
>

<title>SHAGGY XMD • Home</title>

<style>${CSS}</style>

</head>

<body>

<div class="wrap">

<header class="topbar">

<a href="/" class="brand">

<div class="brand-icon">
🤖
</div>

<div>
<strong>SHAGGY XMD</strong>
<span>Bot Control Center</span>
</div>

</a>

<nav class="nav">

<a href="/status">
📡 Status
</a>

<a href="/manage">
⚙ Manage
</a>

<a
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
🔗 Pair Web
</a>

</nav>

</header>


<section class="hero">

<div class="eyebrow">

<span class="dot"></span>

SHAGGY XMD • ONLINE SYSTEM

</div>

<h1>
Your Bot.<br>
Your Control.<br>
Your Power.
</h1>

<p>
Welcome to the SHAGGY XMD control center.
Pair your WhatsApp bot, monitor connected sessions
in real time and manage your bot configuration
from one beautiful futuristic dashboard.
</p>

<div class="actions">

<a
class="btn btn-primary"
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
🚀 Pair Your Bot
</a>

<a
class="btn btn-purple"
href="/status"
>
📡 Live Status
</a>

<a
class="btn"
href="/manage"
>
⚙ Manage Bot
</a>

</div>

</section>


<section class="section">

<div class="section-title">

<small>LIVE NETWORK</small>

<h2>Bot Network Overview</h2>

<p>
Real-time information from your MongoDB session store.
</p>

</div>


<div class="stats">

<div class="card stat">

<div class="stat-top">

<div class="label">
🟢 Online Bots
</div>

<div class="stat-icon">
🟢
</div>

</div>

<div
class="value"
id="online"
>
--
</div>

<div class="note">
Currently active sessions
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
🌐 Total Bots
</div>

<div class="stat-icon">
🌐
</div>

</div>

<div
class="value"
id="total"
>
--
</div>

<div class="note">
All stored bot sessions
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
⚡ Availability
</div>

<div class="stat-icon">
⚡
</div>

</div>

<div
class="value"
id="percentage"
>
--%
</div>

<div class="note">
Online / total percentage
</div>

</div>

</div>

</section>


<section class="section">

<div class="features">

<div class="card feature">

<div class="feature-icon">
📡
</div>

<h3>
Real-Time Monitoring
</h3>

<p>
Monitor active WhatsApp bot sessions
with automatic live updates.
</p>

</div>


<div class="card feature">

<div class="feature-icon">
⚙️
</div>

<h3>
Easy Bot Management
</h3>

<p>
Change your bot identity and behaviour
settings directly from the web panel.
</p>

</div>


<div class="card feature">

<div class="feature-icon">
🔗
</div>

<h3>
Fast Pairing
</h3>

<p>
Open the official ShaggyTech pairing
website and connect your bot quickly.
</p>

</div>

</div>

</section>


<footer class="footer">

SHAGGY XMD Control Center •

<a
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
www.shaggytech.online
</a>

</footer>

</div>


<script>

async function loadStats() {

try {

const response =
await fetch(
'/api/online-count',
{
cache: 'no-store'
}
);

const data =
await response.json();

if (!response.ok) {
throw new Error();
}

document.getElementById(
'online'
).textContent =
data.online;

document.getElementById(
'total'
).textContent =
data.total;

document.getElementById(
'percentage'
).textContent =
Number(
data.percentage || 0
).toFixed(1) + '%';

} catch (error) {

document.getElementById(
'online'
).textContent = '--';

document.getElementById(
'total'
).textContent = '--';

document.getElementById(
'percentage'
).textContent = '--%';

}

}

loadStats();

setInterval(
loadStats,
5000
);

</script>

</body>
</html>`);

});


/* =========================================================
   /status PAGE
========================================================= */

app.get('/status', (req, res) => {

res.set(
'Cache-Control',
'no-store'
);

res.send(`<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>
SHAGGY XMD • Live Status
</title>

<script
src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
></script>

<style>${CSS}</style>

</head>

<body>

<div class="wrap">

<header class="topbar">

<a href="/" class="brand">

<div class="brand-icon">
📡
</div>

<div>
<strong>SHAGGY XMD</strong>
<span>Live Status Monitor</span>
</div>

</a>

<nav class="nav">

<a href="/">
🏠 Home
</a>

<a href="/manage">
⚙ Manage
</a>

<a
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
🔗 Pair Web
</a>

</nav>

</header>


<section class="status-hero">

<div>

<div class="eyebrow">

<span class="dot"></span>

REAL-TIME MONITORING

</div>

<h1>
Bot Network Status
</h1>

<p>
This page automatically refreshes every five seconds
and displays the latest bot session information.
</p>

</div>

<div
class="live"
id="connection"
>
<span class="dot"></span>
Connecting...
</div>

</section>


<section class="stats">

<div class="card stat">

<div class="stat-top">

<div class="label">
🟢 Online Bots
</div>

<div class="stat-icon">
🟢
</div>

</div>

<div
class="value"
id="online"
>
--
</div>

<div class="note">
Currently active
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
🌐 Total Bots
</div>

<div class="stat-icon">
🌐
</div>

</div>

<div
class="value"
id="total"
>
--
</div>

<div class="note">
Stored sessions
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
⚡ Availability
</div>

<div class="stat-icon">
⚡
</div>

</div>

<div
class="value"
id="percentage"
>
--%
</div>

<div class="note">
Network availability
</div>

</div>

</section>


<section class="section status-grid">

<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
Live Bot Activity
</div>

<div class="panel-sub">
Last 30 monitoring updates
</div>

</div>

<div class="live">
<span class="dot"></span>
LIVE
</div>

</div>

<div class="chart">
<canvas id="chart"></canvas>
</div>

</div>


<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
System Information
</div>

<div class="panel-sub">
Current monitor configuration
</div>

</div>

</div>


<div class="system-list">

<div class="system-row">
<span>Refresh</span>
<span>5 seconds</span>
</div>

<div class="system-row">
<span>Threshold</span>
<span id="threshold">--</span>
</div>

<div class="system-row">
<span>Database</span>
<span>MongoDB</span>
</div>

<div class="system-row">
<span>Endpoint</span>
<span>/api/online-count</span>
</div>

<div class="system-row">
<span>Last Update</span>
<span id="updated">--</span>
</div>

</div>

</div>

</section>


<footer class="footer">

SHAGGY XMD Live Status •

<a
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
www.shaggytech.online
</a>

</footer>

</div>


<script>

const online =
document.getElementById(
'online'
);

const total =
document.getElementById(
'total'
);

const percentage =
document.getElementById(
'percentage'
);

const connection =
document.getElementById(
'connection'
);

const threshold =
document.getElementById(
'threshold'
);

const updated =
document.getElementById(
'updated'
);


const labels = [];
const onlineData = [];
const totalData = [];


const chart =
new Chart(
document
.getElementById('chart')
.getContext('2d'),
{
type: 'line',

data: {

labels: labels,

datasets: [

{
label: 'Online Bots',

data: onlineData,

borderColor: '#00eaff',

backgroundColor:
'rgba(0,234,255,.08)',

fill: true,

tension: .4,

pointRadius: 2,

borderWidth: 2
},

{
label: 'Total Bots',

data: totalData,

borderColor: '#a855f7',

backgroundColor:
'rgba(168,85,247,.04)',

fill: false,

tension: .4,

pointRadius: 2,

borderWidth: 2
}

]

},

options: {

responsive: true,

maintainAspectRatio: false,

interaction: {
intersect: false,
mode: 'index'
},

plugins: {

legend: {

labels: {

color: '#9aa7bd',

font: {
size: 10
}

}

}

},

scales: {

x: {

grid: {
color:
'rgba(255,255,255,.035)'
},

ticks: {
color: '#59667b',
maxTicksLimit: 8
}

},

y: {

beginAtZero: true,

grid: {
color:
'rgba(255,255,255,.035)'
},

ticks: {
color: '#59667b',
precision: 0
}

}

}

}

}
);


async function updateStatus() {

try {

const response =
await fetch(
'/api/online-count',
{
cache: 'no-store'
}
);

const data =
await response.json();

if (!response.ok) {
throw new Error(
data.error ||
'Connection failed'
);
}


online.textContent =
data.online;

total.textContent =
data.total;

percentage.textContent =
Number(
data.percentage || 0
).toFixed(1) + '%';


threshold.textContent =
(data.thresholdMinutes || 0) +
' minutes';


updated.textContent =
new Date(
data.time
).toLocaleTimeString();


connection.innerHTML =
'<span class="dot"></span> System Online';


labels.push(
new Date(
data.time
).toLocaleTimeString()
);

onlineData.push(
Number(data.online || 0)
);

totalData.push(
Number(data.total || 0)
);


while (
labels.length > 30
) {

labels.shift();
onlineData.shift();
totalData.shift();

}


chart.update();

} catch (error) {

connection.innerHTML =
'<span class="dot"></span> Connection Error';

}

}


updateStatus();

setInterval(
updateStatus,
5000
);

</script>

</body>
</html>`);

});


/* =========================================================
   /manage PAGE
========================================================= */

app.get('/manage', (req, res) => {

res.set(
'Cache-Control',
'no-store'
);

res.send(`<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>
SHAGGY XMD • Bot Management
</title>

<style>${CSS}</style>

</head>

<body>

<div class="wrap">

<header class="topbar">

<a href="/" class="brand">

<div class="brand-icon">
⚙️
</div>

<div>
<strong>SHAGGY XMD</strong>
<span>Bot Management</span>
</div>

</a>

<nav class="nav">

<a href="/">
🏠 Home
</a>

<a href="/status">
📡 Status
</a>

<a
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
🔗 Pair Web
</a>

</nav>

</header>


<div
id="login"
class="login"
>

<div class="card login-box">

<div class="login-icon">
🔐
</div>

<h1>
Secure Bot Access
</h1>

<p>
Enter the access key assigned to your bot
to open the management dashboard.
</p>


<div class="field">

<label>
Access Key
</label>

<input
id="key"
placeholder="Enter your access key"
autocomplete="off"
spellcheck="false"
>

</div>


<button
id="loginBtn"
class="btn btn-primary full"
>
🔓 Open Dashboard
</button>


<div
id="loginMsg"
class="msg error"
></div>

</div>

</div>


<div
id="dashboard"
style="display:none"
>

<div class="manage">


<div class="card settings">

<div class="settings-head">

<div>

<h1>
Bot Configuration
</h1>

<p>
Customize your SHAGGY XMD bot.
</p>

</div>

<div
id="botNumber"
class="bot-number"
>
📱 Bot: N/A
</div>

</div>


<div class="group">

<div class="group-title">

<span>
🎨
</span>

Bot Identity

</div>


<div class="form-grid">


<div class="field">

<label>
Bot Name
</label>

<input
id="botName"
placeholder="SHAGGY XMD"
>

</div>


<div class="field">

<label>
Bot Footer
</label>

<input
id="botFooter"
placeholder="POWERED BY SHAGGY"
>

</div>


<div class="field wide">

<label>
Bot Image URL
</label>

<input
id="botImage"
placeholder="https://example.com/bot.jpg"
>

</div>


<div class="field wide">

<label>
Movie Footer
</label>

<input
id="movieFooter"
placeholder="SHAGGY XMD MOVIE"
>

</div>

</div>

</div>


<div class="group">

<div class="group-title">

<span>
⚡
</span>

Behaviour Settings

</div>


<div class="toggles">


<div class="toggle">

<div>
<strong>
⚡ Always Online
</strong>

<small>
Keep bot presence online
</small>
</div>

<label class="switch">

<input
id="alwaysOnline"
type="checkbox"
>

<span class="slider"></span>

</label>

</div>


<div class="toggle">

<div>
<strong>
👁️ Message Seen
</strong>

<small>
Mark messages as seen
</small>
</div>

<label class="switch">

<input
id="alwaysMsgSeen"
type="checkbox"
>

<span class="slider"></span>

</label>

</div>


<div class="toggle">

<div>
<strong>
📱 Status View
</strong>

<small>
View status updates
</small>
</div>

<label class="switch">

<input
id="statusView"
type="checkbox"
>

<span class="slider"></span>

</label>

</div>


<div class="toggle">

<div>
<strong>
❤️ Auto Like
</strong>

<small>
Automatically like statuses
</small>
</div>

<label class="switch">

<input
id="autoLike"
type="checkbox"
>

<span class="slider"></span>

</label>

</div>


<div class="toggle">

<div>
<strong>
🛡️ Anti Delete
</strong>

<small>
Enable anti-delete
</small>
</div>

<label class="switch">

<input
id="antiDelete"
type="checkbox"
>

<span class="slider"></span>

</label>

</div>


</div>

</div>


<div class="save-row">

<button
id="saveBtn"
class="btn btn-primary"
>
💾 Save Changes
</button>

<a
href="/status"
class="btn"
>
📡 Status
</a>

</div>


<div
id="saveMsg"
class="msg"
></div>

</div>


<div class="card preview">

<div class="preview-label">
LIVE BOT PREVIEW
</div>


<div
id="avatar"
class="avatar"
>
🤖
</div>


<div
id="previewName"
class="preview-name"
>
SHAGGY XMD
</div>


<div
id="previewFooter"
class="preview-footer"
>
POWERED BY SHAGGY
</div>

</div>


</div>

</div>


<footer class="footer">

SHAGGY XMD Bot Management •

<a
href="${PAIR_WEB_URL}"
target="_blank"
rel="noopener"
>
www.shaggytech.online
</a>

</footer>

</div>


<script>

let currentKey = null;


const login =
document.getElementById(
'login'
);

const dashboard =
document.getElementById(
'dashboard'
);

const key =
document.getElementById(
'key'
);

const loginBtn =
document.getElementById(
'loginBtn'
);

const loginMsg =
document.getElementById(
'loginMsg'
);


const botName =
document.getElementById(
'botName'
);

const botImage =
document.getElementById(
'botImage'
);

const botFooter =
document.getElementById(
'botFooter'
);

const movieFooter =
document.getElementById(
'movieFooter'
);


const alwaysOnline =
document.getElementById(
'alwaysOnline'
);

const alwaysMsgSeen =
document.getElementById(
'alwaysMsgSeen'
);

const statusView =
document.getElementById(
'statusView'
);

const autoLike =
document.getElementById(
'autoLike'
);

const antiDelete =
document.getElementById(
'antiDelete'
);


const avatar =
document.getElementById(
'avatar'
);

const previewName =
document.getElementById(
'previewName'
);

const previewFooter =
document.getElementById(
'previewFooter'
);


function preview() {

previewName.textContent =
botName.value.trim() ||
'SHAGGY XMD';

previewFooter.textContent =
botFooter.value.trim() ||
'POWERED BY SHAGGY';


const image =
botImage.value.trim();


if (!image) {

avatar.innerHTML =
'🤖';

return;

}


avatar.innerHTML = '';

const img =
document.createElement(
'img'
);

img.src = image;

img.alt =
'Bot Image';

img.onerror =
function() {

avatar.innerHTML =
'🤖';

};

avatar.appendChild(img);

}


async function doLogin() {

const accessKey =
key.value.trim();


if (!accessKey) {

loginMsg.textContent =
'Please enter your access key.';

return;

}


loginBtn.textContent =
'⏳ Checking...';

loginBtn.style.opacity =
'.6';


try {

const response =
await fetch(
'/api/bot-settings/' +
encodeURIComponent(
accessKey
),
{
cache: 'no-store'
}
);


const data =
await response.json();


if (!response.ok) {

throw new Error(
data.error ||
'Invalid access key'
);

}


currentKey =
accessKey;


document.getElementById(
'botNumber'
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


preview();


login.style.display =
'none';

dashboard.style.display =
'block';


} catch (error) {

loginMsg.textContent =
error.message;

} finally {

loginBtn.textContent =
'🔓 Open Dashboard';

loginBtn.style.opacity =
'1';

}

}


async function saveSettings() {

if (!currentKey) {
return;
}


const saveBtn =
document.getElementById(
'saveBtn'
);

const saveMsg =
document.getElementById(
'saveMsg'
);


saveBtn.textContent =
'⏳ Saving...';


try {

const payload = {

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

};


const response =
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

body:
JSON.stringify(
payload
)

}
);


const data =
await response.json();


if (!response.ok) {

throw new Error(
data.error ||
'Save failed'
);

}


saveMsg.className =
'msg success';

saveMsg.textContent =
'✓ Bot settings saved successfully.';

preview();


} catch (error) {

saveMsg.className =
'msg error';

saveMsg.textContent =
error.message;

} finally {

saveBtn.textContent =
'💾 Save Changes';

}

}


loginBtn.addEventListener(
'click',
doLogin
);


key.addEventListener(
'keydown',
function(event) {

if (
event.key === 'Enter'
) {
doLogin();
}

}
);


[
botName,
botImage,
botFooter
].forEach(
function(input) {

input.addEventListener(
'input',
preview
);

}
);


document
.getElementById(
'saveBtn'
)
.addEventListener(
'click',
saveSettings
);


preview();

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
`🏠 Home: /`
);

console.log(
`📡 Status: /status`
);

console.log(
`⚙️ Manage: /manage`
);

console.log(
`🔗 Pair Web: ${PAIR_WEB_URL}`
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
