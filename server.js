require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();

const PORT =
  process.env.PORT || 3000;

const MONGODB_URI =
  process.env.MONGODB_URI;

const DB_NAME =
  process.env.DB_NAME || 'test';

const COLLECTION_NAME =
  process.env.COLLECTION_NAME || 'sessions';

const METRICS_COLLECTION_NAME =
  process.env.METRICS_COLLECTION_NAME ||
  'bot_metrics';

const TIMESTAMP_FIELD =
  process.env.TIMESTAMP_FIELD ||
  'lastSeen';

const ONLINE_THRESHOLD_MINUTES =
  Number(
    process.env.ONLINE_THRESHOLD_MINUTES || 2
  );

const PAIR_WEB_URL =
  process.env.PAIR_WEB_URL ||
  'https://www.shaggytech.online';

const DEFAULT_MODE =
  String(
    process.env.MODE || 'PUBLIC'
  ).toUpperCase();

if (!MONGODB_URI) {
  console.error(
    '❌ MONGODB_URI .env file eke danna one!'
  );

  process.exit(1);
}

let collection;
let metricsCollection;


/* =========================================================
   DATABASE
========================================================= */

async function connectDB() {

  const client =
    new MongoClient(
      MONGODB_URI
    );

  await client.connect();

  const db =
    client.db(DB_NAME);

  collection =
    db.collection(
      COLLECTION_NAME
    );

  metricsCollection =
    db.collection(
      METRICS_COLLECTION_NAME
    );

  /*
   * Metrics indexes.
   */
  try {

    await metricsCollection.createIndex({
      createdAt: 1
    });

    await metricsCollection.createIndex({
      createdAt: -1
    });

  } catch (error) {

    console.log(
      '⚠️ Metrics index warning:',
      error.message
    );

  }

  console.log(
    `✅ MongoDB connected -> ${DB_NAME}.${COLLECTION_NAME}`
  );

  console.log(
    `📊 Metrics collection -> ${DB_NAME}.${METRICS_COLLECTION_NAME}`
  );
}


/* =========================================================
   EXPRESS
========================================================= */

app.use(
  express.json({
    limit: '1mb'
  })
);


/* =========================================================
   HELPERS
========================================================= */

function cleanString(
  value,
  fallback = ''
) {

  if (
    typeof value !== 'string'
  ) {
    return fallback;
  }

  return value.trim();
}


function boolValue(
  value
) {

  return (
    value === true ||
    value === 'true' ||
    value === 1 ||
    value === '1'
  );

}


function normalizeMode(
  value
) {

  const mode =
    String(
      value || DEFAULT_MODE
    )
      .trim()
      .toUpperCase();

  return mode === 'PRIVATE'
    ? 'PRIVATE'
    : 'PUBLIC';

}


function getOnlineDate() {

  return new Date(
    Date.now() -
    ONLINE_THRESHOLD_MINUTES *
    60 *
    1000
  );

}


/* =========================================================
   ONLINE STATS
========================================================= */

async function getStats() {

  if (!collection) {
    throw new Error(
      'Database ready naha'
    );
  }

  const thresholdDate =
    getOnlineDate();

  const [
    onlineCount,
    totalCount
  ] =
    await Promise.all([

      collection.countDocuments({

        [TIMESTAMP_FIELD]: {
          $gte: thresholdDate
        }

      }),

      collection.countDocuments({})

    ]);

  const offlineCount =
    Math.max(
      totalCount -
      onlineCount,
      0
    );

  const percentage =
    totalCount > 0

      ? Number(
          (
            (
              onlineCount /
              totalCount
            ) * 100
          ).toFixed(1)
        )

      : 0;

  return {

    online:
      onlineCount,

    total:
      totalCount,

    offline:
      offlineCount,

    percentage,

    thresholdMinutes:
      ONLINE_THRESHOLD_MINUTES,

    time:
      new Date().toISOString()

  };

}


/* =========================================================
   LIVE STATS API
========================================================= */

app.get(
  '/api/online-count',
  async (req, res) => {

    try {

      const stats =
        await getStats();

      res.set(
        'Cache-Control',
        'no-store'
      );

      res.json(
        stats
      );

    } catch (err) {

      console.error(
        '❌ Query error:',
        err.message
      );

      res.status(500).json({

        error:
          'Data ganna bari una'

      });

    }

  }
);


/* =========================================================
   BOT SETTINGS GET
========================================================= */

app.get(
  '/api/bot-settings/:key',
  async (req, res) => {

    try {

      if (!collection) {

        return res.status(503).json({
          error:
            'Database ready naha'
        });

      }

      const key =
        cleanString(
          req.params.key
        );

      if (!key) {

        return res.status(400).json({
          error:
            'Access key eka denna'
        });

      }

      const doc =
        await collection.findOne({
          'config.accessKey': key
        });

      if (!doc) {

        return res.status(404).json({
          error:
            'Invalid access key'
        });

      }

      const cfg =
        doc.config || {};

      const number =
        String(
          doc.number || ''
        );

      const maskedNumber =
        number.length > 6

          ? number.slice(0, 4) +
            '••••' +
            number.slice(-2)

          : 'N/A';


      res.json({

        number:
          maskedNumber,

        BOT_NAME:
          cfg.BOT_NAME || '',

        BOT_IMAGE:
          cfg.BOT_IMAGE || '',

        BOT_FOOTER:
          cfg.BOT_FOOTER || '',

        MOVIE_FOOTER:
          cfg.MOVIE_FOOTER || '',

        MOVIE_CAPTION:
          cfg.MOVIE_CAPTION || '',

        MODE:
          normalizeMode(
            cfg.MODE
          ),

        ALWAYS_ONLINE:
          boolValue(
            cfg.ALWAYS_ONLINE
          ),

        ALWAYS_MSG_SEEN:
          boolValue(
            cfg.ALWAYS_MSG_SEEN
          ),

        STATUS_VIEW:
          boolValue(
            cfg.STATUS_VIEW
          ),

        AUTO_LIKE:
          boolValue(
            cfg.AUTO_LIKE
          ),

        ANTI_DELETE:
          boolValue(
            cfg.ANTI_DELETE
          )

      });

    } catch (err) {

      console.error(
        '❌ settings GET:',
        err.message
      );

      res.status(500).json({
        error:
          'Data ganna bari una'
      });

    }

  }
);


/* =========================================================
   BOT SETTINGS SAVE
========================================================= */

app.post(
  '/api/bot-settings/:key',
  async (req, res) => {

    try {

      if (!collection) {

        return res.status(503).json({
          error:
            'Database ready naha'
        });

      }

      const key =
        cleanString(
          req.params.key
        );

      if (!key) {

        return res.status(400).json({
          error:
            'Access key eka denna'
        });

      }

      const doc =
        await collection.findOne({
          'config.accessKey': key
        });

      if (!doc) {

        return res.status(404).json({
          error:
            'Invalid access key'
        });

      }

      const body =
        req.body || {};

      const update = {};


      if (
        typeof body.BOT_NAME ===
        'string'
      ) {

        update[
          'config.BOT_NAME'
        ] =
          body.BOT_NAME.trim();

      }


      if (
        typeof body.BOT_IMAGE ===
        'string'
      ) {

        update[
          'config.BOT_IMAGE'
        ] =
          body.BOT_IMAGE.trim();

      }


      if (
        typeof body.BOT_FOOTER ===
        'string'
      ) {

        update[
          'config.BOT_FOOTER'
        ] =
          body.BOT_FOOTER.trim();

      }


      if (
        typeof body.MOVIE_FOOTER ===
        'string'
      ) {

        update[
          'config.MOVIE_FOOTER'
        ] =
          body.MOVIE_FOOTER.trim();

      }


      if (
        typeof body.MOVIE_CAPTION ===
        'string'
      ) {

        update[
          'config.MOVIE_CAPTION'
        ] =
          body.MOVIE_CAPTION.trim();

      }


      if (
        typeof body.MODE ===
        'string'
      ) {

        update[
          'config.MODE'
        ] =
          normalizeMode(
            body.MODE
          );

      }


      if (
        typeof body.ALWAYS_ONLINE ===
        'boolean'
      ) {

        update[
          'config.ALWAYS_ONLINE'
        ] =
          body.ALWAYS_ONLINE
            ? 'true'
            : 'false';

      }


      if (
        typeof body.ALWAYS_MSG_SEEN ===
        'boolean'
      ) {

        update[
          'config.ALWAYS_MSG_SEEN'
        ] =
          body.ALWAYS_MSG_SEEN
            ? 'true'
            : 'false';

      }


      if (
        typeof body.STATUS_VIEW ===
        'boolean'
      ) {

        update[
          'config.STATUS_VIEW'
        ] =
          body.STATUS_VIEW
            ? 'true'
            : 'false';

      }


      if (
        typeof body.AUTO_LIKE ===
        'boolean'
      ) {

        update[
          'config.AUTO_LIKE'
        ] =
          body.AUTO_LIKE
            ? 'true'
            : 'false';

      }


      if (
        typeof body.ANTI_DELETE ===
        'boolean'
      ) {

        update[
          'config.ANTI_DELETE'
        ] =
          body.ANTI_DELETE
            ? 'true'
            : 'false';

      }


      update.updatedAt =
        new Date();


      await collection.updateOne(

        {
          'config.accessKey':
            key
        },

        {
          $set:
            update
        }

      );


      res.json({

        success:
          true,

        message:
          'Bot settings saved'

      });

    } catch (err) {

      console.error(
        '❌ settings POST:',
        err.message
      );

      res.status(500).json({
        error:
          'Save karanna bari una'
      });

    }

  }
);


/* =========================================================
   ANALYTICS SNAPSHOT
========================================================= */

async function saveMetricsSnapshot() {

  try {

    if (
      !collection ||
      !metricsCollection
    ) {
      return;
    }

    const stats =
      await getStats();

    await metricsCollection.insertOne({

      createdAt:
        new Date(),

      online:
        stats.online,

      total:
        stats.total,

      offline:
        stats.offline,

      percentage:
        stats.percentage

    });

  } catch (error) {

    console.error(
      '⚠️ Metrics snapshot:',
      error.message
    );

  }

}


/* =========================================================
   ANALYTICS API
========================================================= */

app.get(
  '/api/analytics',
  async (req, res) => {

    try {

      if (!metricsCollection) {

        return res.status(503).json({
          error:
            'Metrics database ready naha'
        });

      }

      const hours =
        Math.min(
          Math.max(
            Number(
              req.query.hours || 24
            ),
            1
          ),
          168
        );

      const since =
        new Date(
          Date.now() -
          hours *
          60 *
          60 *
          1000
        );


      const rows =
        await metricsCollection
          .find({
            createdAt: {
              $gte: since
            }
          })
          .sort({
            createdAt: 1
          })
          .toArray();


      /*
       * Group data by minute.
       * This keeps chart clean even if
       * more snapshots are stored.
       */

      const grouped =
        new Map();


      for (
        const row of rows
      ) {

        const date =
          new Date(
            row.createdAt
          );

        date.setSeconds(
          0,
          0
        );

        const key =
          date.toISOString();


        grouped.set(
          key,
          {

            time:
              key,

            online:
              Number(
                row.online || 0
              ),

            total:
              Number(
                row.total || 0
              ),

            offline:
              Number(
                row.offline || 0
              ),

            percentage:
              Number(
                row.percentage || 0
              )

          }
        );

      }


      const data =
        Array.from(
          grouped.values()
        );


      res.set(
        'Cache-Control',
        'no-store'
      );


      res.json({

        hours,

        count:
          data.length,

        data

      });

    } catch (error) {

      console.error(
        '❌ Analytics error:',
        error.message
      );

      res.status(500).json({
        error:
          'Analytics ganna bari una'
      });

    }

  }
);


/* =========================================================
   CLEAN OLD METRICS
========================================================= */

async function cleanOldMetrics() {

  try {

    if (!metricsCollection) {
      return;
    }

    const oldDate =
      new Date(
        Date.now() -
        7 *
        24 *
        60 *
        60 *
        1000
      );

    const result =
      await metricsCollection.deleteMany({
        createdAt: {
          $lt: oldDate
        }
      });

    if (
      result.deletedCount > 0
    ) {

      console.log(
        `🧹 Removed ${result.deletedCount} old metric records`
      );

    }

  } catch (error) {

    console.error(
      '⚠️ Metrics cleanup:',
      error.message
    );

  }

}


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

  --bg: #02040a;

  --card:
    rgba(10,15,27,.72);

  --line:
    rgba(255,255,255,.08);

  --text:
    #f5f8ff;

  --muted:
    #8792a8;

  --cyan:
    #00eaff;

  --blue:
    #5865ff;

  --purple:
    #a855f7;

  --green:
    #21f39a;

  --red:
    #ff5577;

  --orange:
    #ffad42;

}

html {
  scroll-behavior: smooth;
}

body {

  min-height: 100vh;

  color:
    var(--text);

  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;

  background:

    radial-gradient(
      circle at 8% 5%,
      rgba(0,234,255,.14),
      transparent 28%
    ),

    radial-gradient(
      circle at 92% 8%,
      rgba(168,85,247,.15),
      transparent 30%
    ),

    radial-gradient(
      circle at 50% 100%,
      rgba(88,101,255,.13),
      transparent 36%
    ),

    var(--bg);

  overflow-x:
    hidden;

}

body::before {

  content:
    "";

  position:
    fixed;

  inset:
    0;

  pointer-events:
    none;

  opacity:
    .32;

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

  background-size:
    55px 55px;

  animation:
    gridMove 18s linear infinite;

}

body::after {

  content:
    "";

  position:
    fixed;

  width:
    520px;

  height:
    520px;

  left:
    -280px;

  bottom:
    -280px;

  border-radius:
    50%;

  background:
    rgba(0,234,255,.08);

  filter:
    blur(95px);

  pointer-events:
    none;

  animation:
    orb 9s ease-in-out infinite;

}

a {
  color: inherit;
  text-decoration: none;
}

button,
input,
select,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

.wrap {

  width:
    min(
      1200px,
      calc(100% - 30px)
    );

  margin:
    auto;

  padding:
    22px
    0
    70px;

  position:
    relative;

  z-index:
    2;

}


/* =========================================================
   LOADING
========================================================= */

.loader {

  position:
    fixed;

  inset:
    0;

  z-index:
    9999;

  display:
    grid;

  place-items:
    center;

  background:
    #02040a;

  transition:
    opacity .6s ease,
    visibility .6s ease;

}

.loader.hide {

  opacity:
    0;

  visibility:
    hidden;

  pointer-events:
    none;

}

.loader-box {
  text-align:
    center;
}

.loader-logo {

  width:
    78px;

  height:
    78px;

  display:
    grid;

  place-items:
    center;

  margin:
    auto;

  border-radius:
    24px;

  font-size:
    35px;

  background:

    linear-gradient(
      135deg,
      rgba(0,234,255,.15),
      rgba(168,85,247,.15)
    );

  border:
    1px solid
    rgba(0,234,255,.25);

  box-shadow:

    0 0 60px
    rgba(0,234,255,.15);

  animation:
    loaderPulse 1.5s ease-in-out infinite;

}

.loader-title {

  margin-top:
    20px;

  font-weight:
    850;

  letter-spacing:
    .15em;

  font-size:
    16px;

}

.loader-text {

  margin-top:
    8px;

  color:
    #68758b;

  font-size:
    10px;

  letter-spacing:
    .12em;

  text-transform:
    uppercase;

}

.loader-bar {

  width:
    180px;

  height:
    3px;

  margin:
    18px auto 0;

  overflow:
    hidden;

  border-radius:
    999px;

  background:
    rgba(255,255,255,.06);

}

.loader-bar::after {

  content:
    "";

  display:
    block;

  width:
    55%;

  height:
    100%;

  border-radius:
    inherit;

  background:
    linear-gradient(
      90deg,
      var(--cyan),
      var(--purple)
    );

  animation:
    loaderBar 1.1s ease-in-out infinite;

}


/* =========================================================
   TOPBAR
========================================================= */

.topbar {

  display:
    flex;

  align-items:
    center;

  justify-content:
    space-between;

  gap:
    15px;

  margin-bottom:
    26px;

}

.brand {

  display:
    flex;

  align-items:
    center;

  gap:
    12px;

}

.brand-icon {

  width:
    48px;

  height:
    48px;

  display:
    grid;

  place-items:
    center;

  border-radius:
    16px;

  background:

    linear-gradient(
      135deg,
      rgba(0,234,255,.17),
      rgba(168,85,247,.17)
    );

  border:
    1px solid
    rgba(0,234,255,.25);

  box-shadow:
    0 0 35px
    rgba(0,234,255,.12);

  font-size:
    22px;

}

.brand strong {

  display:
    block;

  font-size:
    15px;

  letter-spacing:
    .12em;

}

.brand span {

  display:
    block;

  color:
    var(--muted);

  font-size:
    9px;

  margin-top:
    3px;

  letter-spacing:
    .14em;

  text-transform:
    uppercase;

}

.nav {

  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    8px;

}

.nav a {

  padding:
    10px 14px;

  border:
    1px solid
    var(--line);

  border-radius:
    12px;

  background:
    rgba(255,255,255,.035);

  color:
    #dce4f3;

  font-size:
    11px;

  transition:
    .25s;

}

.nav a:hover {

  transform:
    translateY(-2px);

  border-color:
    rgba(0,234,255,.35);

  background:
    rgba(0,234,255,.07);

  box-shadow:
    0 10px 30px
    rgba(0,234,255,.08);

}


/* =========================================================
   MODE BADGE
========================================================= */

.mode-badge {

  display:
    inline-flex;

  align-items:
    center;

  gap:
    7px;

  padding:
    7px 11px;

  border-radius:
    999px;

  font-size:
    9px;

  font-weight:
    850;

  letter-spacing:
    .1em;

  text-transform:
    uppercase;

}

.mode-public {

  color:
    #70f7ff;

  background:
    rgba(0,234,255,.06);

  border:
    1px solid
    rgba(0,234,255,.18);

}

.mode-private {

  color:
    #ffc77a;

  background:
    rgba(255,173,66,.07);

  border:
    1px solid
    rgba(255,173,66,.2);

}


/* =========================================================
   HERO
========================================================= */

.hero {

  position:
    relative;

  overflow:
    hidden;

  padding:
    75px 42px;

  border:
    1px solid
    var(--line);

  border-radius:
    30px;

  background:
    rgba(7,10,18,.72);

  box-shadow:
    0 30px 90px
    rgba(0,0,0,.45);

  backdrop-filter:
    blur(25px);

}

.hero::before {

  content:
    "";

  position:
    absolute;

  width:
    480px;

  height:
    480px;

  right:
    -200px;

  top:
    -220px;

  border-radius:
    50%;

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

  display:
    inline-flex;

  align-items:
    center;

  gap:
    8px;

  padding:
    7px 11px;

  border-radius:
    999px;

  color:
    #8cf8ff;

  background:
    rgba(0,234,255,.05);

  border:
    1px solid
    rgba(0,234,255,.17);

  font-size:
    9px;

  font-weight:
    800;

  letter-spacing:
    .13em;

  text-transform:
    uppercase;

}

.dot {

  width:
    7px;

  height:
    7px;

  flex-shrink:
    0;

  border-radius:
    50%;

  background:
    var(--green);

  box-shadow:
    0 0 15px
    var(--green);

  animation:
    pulse 1.6s infinite;

}

.hero h1 {

  position:
    relative;

  max-width:
    850px;

  margin-top:
    20px;

  font-size:
    clamp(
      43px,
      7vw,
      80px
    );

  line-height:
    .98;

  letter-spacing:
    -.055em;

  background:
    linear-gradient(
      100deg,
      #fff,
      #80f8ff 45%,
      #a677ff
    );

  -webkit-background-clip:
    text;

  background-clip:
    text;

  color:
    transparent;

}

.hero p {

  max-width:
    700px;

  margin-top:
    22px;

  color:
    #99a5ba;

  line-height:
    1.8;

  font-size:
    14px;

}

.actions {

  display:
    flex;

  flex-wrap:
    wrap;

  gap:
    10px;

  margin-top:
    30px;

}

.btn {

  min-height:
    47px;

  display:
    inline-flex;

  align-items:
    center;

  justify-content:
    center;

  gap:
    8px;

  padding:
    0 18px;

  border-radius:
    13px;

  color:
    white;

  border:
    1px solid
    rgba(255,255,255,.1);

  background:
    rgba(255,255,255,.04);

  font-size:
    11px;

  font-weight:
    750;

  transition:
    .25s;

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

.btn-private {

  background:
    linear-gradient(
      135deg,
      #b76e00,
      #a855f7
    );

}

.btn-danger {

  background:
    rgba(255,85,119,.08);

  color:
    #ff8ca4;

  border-color:
    rgba(255,85,119,.18);

}


/* =========================================================
   SECTION
========================================================= */

.section {
  margin-top: 30px;
}

.section-title {
  margin-bottom: 14px;
}

.section-title small {

  color:
    #72f6ff;

  font-size:
    9px;

  font-weight:
    800;

  letter-spacing:
    .17em;

  text-transform:
    uppercase;

}

.section-title h2 {

  margin-top:
    6px;

  font-size:
    24px;

  letter-spacing:
    -.03em;

}

.section-title p {

  color:
    var(--muted);

  margin-top:
    7px;

  font-size:
    11px;

}


/* =========================================================
   CARDS
========================================================= */

.card {

  border:
    1px solid
    var(--line);

  border-radius:
    21px;

  background:
    var(--card);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.25);

  backdrop-filter:
    blur(22px);

}


/* =========================================================
   STATS
========================================================= */

.stats {

  display:
    grid;

  grid-template-columns:
    repeat(4, 1fr);

  gap:
    13px;

}

.stat {

  padding:
    21px;

  transition:
    .3s;

}

.stat:hover {

  transform:
    translateY(-4px);

  border-color:
    rgba(0,234,255,.17);

}

.stat-top {

  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

}

.stat-icon {

  width:
    40px;

  height:
    40px;

  display:
    grid;

  place-items:
    center;

  border-radius:
    12px;

  background:
    rgba(0,234,255,.07);

  border:
    1px solid
    rgba(0,234,255,.13);

}

.label {

  color:
    var(--muted);

  font-size:
    10px;

}

.value {

  margin-top:
    15px;

  font-size:
    36px;

  font-weight:
    850;

  letter-spacing:
    -.04em;

}

.note {

  margin-top:
    7px;

  color:
    #647188;

  font-size:
    9px;

}


/* =========================================================
   ANALYTICS
========================================================= */

.analytics-grid {

  display:
    grid;

  grid-template-columns:
    1.7fr .8fr;

  gap:
    14px;

}

.panel {

  padding:
    21px;

}

.panel-head {

  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap:
    15px;

  margin-bottom:
    18px;

}

.panel-title {

  font-size:
    14px;

  font-weight:
    800;

}

.panel-sub {

  color:
    var(--muted);

  font-size:
    9px;

  margin-top:
    4px;

}

.chart {

  height:
    320px;

}

.chart-small {

  height:
    230px;

}

.live {

  display:
    inline-flex;

  align-items:
    center;

  gap:
    7px;

  padding:
    7px 11px;

  border-radius:
    999px;

  color:
    #9fffd9;

  background:
    rgba(33,243,154,.05);

  border:
    1px solid
    rgba(33,243,154,.16);

  font-size:
    9px;

}


/* =========================================================
   FEATURES
========================================================= */

.features {

  display:
    grid;

  grid-template-columns:
    repeat(3, 1fr);

  gap:
    13px;

}

.feature {

  padding:
    21px;

  transition:
    .3s;

}

.feature:hover {

  transform:
    translateY(-4px);

  border-color:
    rgba(0,234,255,.17);

}

.feature-icon {

  width:
    42px;

  height:
    42px;

  display:
    grid;

  place-items:
    center;

  border-radius:
    13px;

  background:
    linear-gradient(
      135deg,
      rgba(0,234,255,.1),
      rgba(168,85,247,.1)
    );

  margin-bottom:
    15px;

}

.feature h3 {

  font-size:
    13px;

}

.feature p {

  color:
    var(--muted);

  margin-top:
    8px;

  font-size:
    10px;

  line-height:
    1.7;

}


/* =========================================================
   SYSTEM LIST
========================================================= */

.system-list {

  display:
    grid;

  gap:
    8px;

}

.system-row {

  display:
    flex;

  justify-content:
    space-between;

  gap:
    10px;

  padding:
    12px;

  border-radius:
    12px;

  background:
    rgba(255,255,255,.025);

  border:
    1px solid
    rgba(255,255,255,.05);

  font-size:
    9px;

}

.system-row span:first-child {
  color:
    #77849a;
}

.system-row span:last-child {

  color:
    #dce5f5;

  font-weight:
    750;

}


/* =========================================================
   LOGIN
========================================================= */

.login {

  min-height:
    75vh;

  display:
    grid;

  place-items:
    center;

}

.login-box {

  width:
    min(
      500px,
      100%
    );

  padding:
    30px;

}

.login-icon {

  width:
    62px;

  height:
    62px;

  display:
    grid;

  place-items:
    center;

  border-radius:
    19px;

  background:
    linear-gradient(
      135deg,
      rgba(0,234,255,.14),
      rgba(168,85,247,.14)
    );

  font-size:
    27px;

  margin-bottom:
    18px;

}

.login-box h1 {

  font-size:
    27px;

}

.login-box p {

  color:
    var(--muted);

  font-size:
    11px;

  line-height:
    1.7;

  margin-top:
    7px;

}

.field {
  margin-top:
    17px;
}

label {

  display:
    block;

  color:
    #aeb9cc;

  font-size:
    9px;

  font-weight:
    750;

  text-transform:
    uppercase;

  margin-bottom:
    7px;

}

input,
select,
textarea {

  width:
    100%;

  outline:
    none;

  border:
    1px solid
    rgba(255,255,255,.09);

  border-radius:
    12px;

  background:
    rgba(0,0,0,.25);

  color:
    white;

  padding:
    12px 13px;

  transition:
    .25s;

}

input,
select {
  height:
    47px;
}

textarea {

  min-height:
    95px;

  resize:
    vertical;

  line-height:
    1.6;

}

select option {

  background:
    #101521;

  color:
    white;

}

input:focus,
select:focus,
textarea:focus {

  border-color:
    rgba(0,234,255,.45);

  box-shadow:
    0 0 0 4px
    rgba(0,234,255,.05);

}

.full {

  width:
    100%;

  margin-top:
    15px;

}

.msg {

  min-height:
    20px;

  margin-top:
    11px;

  font-size:
    10px;

}

.error {
  color:
    #ff7893;
}

.success {
  color:
    #5df2b0;
}


/* =========================================================
   MANAGE
========================================================= */

.manage {

  display:
    grid;

  grid-template-columns:
    1.5fr .8fr;

  gap:
    16px;

}

.settings {

  padding:
    23px;

}

.settings-head {

  display:
    flex;

  justify-content:
    space-between;

  gap:
    15px;

  padding-bottom:
    18px;

  border-bottom:
    1px solid
    var(--line);

}

.settings-head h1 {

  font-size:
    22px;

}

.settings-head p {

  color:
    var(--muted);

  margin-top:
    5px;

  font-size:
    10px;

}

.bot-number {

  height:
    fit-content;

  padding:
    8px 11px;

  border-radius:
    999px;

  color:
    #80f8ff;

  background:
    rgba(0,234,255,.05);

  border:
    1px solid
    rgba(0,234,255,.16);

  font-size:
    9px;

}

.form-grid {

  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    12px;

}

.wide {
  grid-column:
    1 / -1;
}

.group {
  margin-top:
    22px;
}

.group-title {

  display:
    flex;

  align-items:
    center;

  gap:
    8px;

  margin-bottom:
    12px;

  font-size:
    13px;

  font-weight:
    800;

}

.group-title span {

  width:
    29px;

  height:
    29px;

  display:
    grid;

  place-items:
    center;

  border-radius:
    9px;

  background:
    rgba(0,234,255,.07);

}

.mode-selector {

  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    10px;

}

.mode-option {

  position:
    relative;

}

.mode-option input {

  position:
    absolute;

  opacity:
    0;

  pointer-events:
    none;

}

.mode-card {

  display:
    block;

  padding:
    17px;

  border:
    1px solid
    rgba(255,255,255,.07);

  border-radius:
    16px;

  background:
    rgba(255,255,255,.025);

  transition:
    .25s;

}

.mode-card:hover {

  transform:
    translateY(-2px);

}

.mode-option input:checked +
.mode-card.public {

  border-color:
    rgba(0,234,255,.45);

  background:
    rgba(0,234,255,.07);

  box-shadow:
    0 0 30px
    rgba(0,234,255,.06);

}

.mode-option input:checked +
.mode-card.private {

  border-color:
    rgba(255,173,66,.45);

  background:
    rgba(255,173,66,.07);

  box-shadow:
    0 0 30px
    rgba(255,173,66,.06);

}

.mode-card strong {

  display:
    block;

  font-size:
    12px;

}

.mode-card small {

  display:
    block;

  color:
    #66738a;

  margin-top:
    6px;

  font-size:
    9px;

  line-height:
    1.5;

}

.toggles {

  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    9px;

}

.toggle {

  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap:
    10px;

  padding:
    13px;

  border:
    1px solid
    rgba(255,255,255,.06);

  border-radius:
    14px;

  background:
    rgba(255,255,255,.025);

}

.toggle strong {

  display:
    block;

  font-size:
    10px;

}

.toggle small {

  display:
    block;

  color:
    #66738a;

  margin-top:
    4px;

  font-size:
    8px;

}

.switch {

  width:
    44px;

  height:
    24px;

  position:
    relative;

  flex-shrink:
    0;

}

.switch input {
  display:
    none;
}

.slider {

  position:
    absolute;

  inset:
    0;

  border-radius:
    999px;

  background:
    #19202e;

  border:
    1px solid
    rgba(255,255,255,.08);

  transition:
    .25s;

}

.slider::before {

  content:
    "";

  position:
    absolute;

  width:
    16px;

  height:
    16px;

  left:
    3px;

  top:
    3px;

  border-radius:
    50%;

  background:
    #718097;

  transition:
    .25s;

}

.switch input:checked +
.slider {

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

  padding:
    23px;

  height:
    fit-content;

  position:
    sticky;

  top:
    15px;

}

.preview-label {

  color:
    #718097;

  font-size:
    8px;

  font-weight:
    800;

  letter-spacing:
    .15em;

  text-transform:
    uppercase;

}

.avatar {

  width:
    130px;

  height:
    130px;

  margin:
    20px auto;

  display:
    grid;

  place-items:
    center;

  overflow:
    hidden;

  border-radius:
    34px;

  border:
    1px solid
    rgba(0,234,255,.2);

  background:
    #0b101a;

  box-shadow:
    0 0 45px
    rgba(0,234,255,.1);

  font-size:
    45px;

}

.avatar img {

  width:
    100%;

  height:
    100%;

  object-fit:
    cover;

}

.preview-name {

  text-align:
    center;

  font-size:
    18px;

  font-weight:
    850;

}

.preview-footer {

  color:
    var(--muted);

  text-align:
    center;

  font-size:
    9px;

  line-height:
    1.6;

  margin-top:
    7px;

}

.movie-preview {

  margin-top:
    18px;

  padding:
    15px;

  border:
    1px solid
    rgba(168,85,247,.14);

  border-radius:
    14px;

  background:
    rgba(168,85,247,.04);

}

.movie-preview-title {

  color:
    #aeb8cb;

  font-size:
    8px;

  letter-spacing:
    .13em;

  text-transform:
    uppercase;

}

.movie-preview-text {

  margin-top:
    8px;

  color:
    #e8ecf5;

  font-size:
    10px;

  line-height:
    1.6;

}

.save-row {

  display:
    flex;

  gap:
    10px;

  margin-top:
    23px;

}

.save-row .btn {
  flex: 1;
}


/* =========================================================
   FOOTER
========================================================= */

.footer {

  text-align:
    center;

  color:
    #657188;

  font-size:
    9px;

  margin-top:
    30px;

}

.footer a {
  color:
    #7ff8ff;
}


/* =========================================================
   ANIMATIONS
========================================================= */

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
      translate(
        80px,
        -50px
      )
      scale(1.1);

  }

}

@keyframes heroOrb {

  50% {

    transform:
      translate(
        -35px,
        35px
      )
      scale(1.12);

  }

}

@keyframes pulse {

  50% {

    transform:
      scale(1.5);

    opacity:
      .55;

  }

}

@keyframes loaderPulse {

  50% {

    transform:
      scale(1.08);

    box-shadow:
      0 0 80px
      rgba(0,234,255,.25);

  }

}

@keyframes loaderBar {

  0% {
    transform:
      translateX(-150%);
  }

  100% {
    transform:
      translateX(300%);
  }

}


/* =========================================================
   MOBILE
========================================================= */

@media(max-width:950px) {

  .stats {

    grid-template-columns:
      repeat(2, 1fr);

  }

  .analytics-grid,
  .manage {

    grid-template-columns:
      1fr;

  }

  .preview {

    position:
      static;

  }

}

@media(max-width:700px) {

  .features {

    grid-template-columns:
      1fr;

  }

  .hero {

    padding:
      55px 25px;

  }

}

@media(max-width:620px) {

  .wrap {

    width:
      calc(100% - 18px);

    padding-top:
      14px;

  }

  .topbar {

    flex-direction:
      column;

    align-items:
      flex-start;

  }

  .nav {

    width:
      100%;

  }

  .nav a {

    flex:
      1;

    text-align:
      center;

  }

  .hero {

    padding:
      43px 20px;

    border-radius:
      22px;

  }

  .hero h1 {

    font-size:
      45px;

  }

  .hero p {

    font-size:
      13px;

  }

  .actions .btn {

    width:
      100%;

  }

  .stats {

    grid-template-columns:
      1fr;

  }

  .form-grid,
  .toggles,
  .mode-selector {

    grid-template-columns:
      1fr;

  }

  .wide {

    grid-column:
      auto;

  }

  .settings,
  .preview,
  .login-box,
  .panel {

    padding:
      18px;

  }

  .settings-head {

    flex-direction:
      column;

    align-items:
      flex-start;

  }

  .chart {

    height:
      260px;

  }

}

@media(prefers-reduced-motion:reduce) {

  *,
  *::before,
  *::after {

    animation:
      none !important;

    transition:
      none !important;

  }

}

`;


/* =========================================================
   PAGE LOADER
========================================================= */

function loaderHTML() {

  return `

<div
class="loader"
id="pageLoader"
>

<div class="loader-box">

<div class="loader-logo">
🤖
</div>

<div class="loader-title">
SHAGGY XMD
</div>

<div class="loader-text">
Initializing control center...
</div>

<div class="loader-bar"></div>

</div>

</div>

<script>

window.addEventListener(
'load',
function() {

setTimeout(
function() {

const loader =
document.getElementById(
'pageLoader'
);

if (loader) {

loader.classList.add(
'hide'
);

}

},
450
);

});

</script>

`;

}


/* =========================================================
   HOME PAGE
========================================================= */

app.get(
  '/',
  async (req, res) => {

    res.set(
      'Cache-Control',
      'no-store'
    );

    res.send(`

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<meta
name="theme-color"
content="#02040a"
>

<title>
SHAGGY XMD • Control Center
</title>

<style>
${CSS}
</style>

</head>

<body>

${loaderHTML()}

<div class="wrap">

<header class="topbar">

<a
href="/"
class="brand"
>

<div class="brand-icon">
🤖
</div>

<div>

<strong>
SHAGGY XMD
</strong>

<span>
Bot Control Center
</span>

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

SHAGGY XMD • LIVE CONTROL CENTER

</div>


<h1>
Your Bot.<br>
Your Control.<br>
Your Power.
</h1>


<p>

Welcome to the SHAGGY XMD control center.
Monitor your bot network in real time,
manage bot configuration and control
your public/private operating mode.

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
class="btn"
href="/status"
>
📊 Analytics
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

<small>
LIVE NETWORK
</small>

<h2>
Bot Network Overview
</h2>

<p>
Live statistics automatically refresh every 5 seconds.
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
All stored sessions
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
🔴 Offline
</div>

<div class="stat-icon">
🔴
</div>

</div>

<div
class="value"
id="offline"
>
--
</div>

<div class="note">
Inactive sessions
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
Online / total
</div>

</div>

</div>

</section>


<section class="section">

<div class="analytics-grid">

<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
24 Hour Bot Analytics
</div>

<div class="panel-sub">
Online and total bot activity
</div>

</div>

<div class="live">
<span class="dot"></span>
LIVE
</div>

</div>

<div class="chart">

<canvas
id="homeChart"
></canvas>

</div>

</div>


<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
Network Health
</div>

<div class="panel-sub">
Current system information
</div>

</div>

</div>


<div class="system-list">

<div class="system-row">

<span>
Refresh
</span>

<span>
5 seconds
</span>

</div>


<div class="system-row">

<span>
Analytics
</span>

<span>
24 hours
</span>

</div>


<div class="system-row">

<span>
Metrics
</span>

<span>
MongoDB
</span>

</div>


<div class="system-row">

<span>
Threshold
</span>

<span
id="threshold"
>
--
</span>

</div>


<div class="system-row">

<span>
Last update
</span>

<span
id="updated"
>
--
</span>

</div>

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
Live bot counts refresh every five seconds
without manually reloading the page.
</p>

</div>


<div class="card feature">

<div class="feature-icon">
📈
</div>

<h3>
24H Analytics
</h3>

<p>
Historical MongoDB snapshots are displayed
as a smooth activity line chart.
</p>

</div>


<div class="card feature">

<div class="feature-icon">
🔐
</div>

<h3>
Public / Private Mode
</h3>

<p>
Switch your bot operating mode directly
from the secure management panel.
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


<script
src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
></script>


<script>

const homeChart =
new Chart(
document
.getElementById(
'homeChart'
)
.getContext('2d'),
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
'#00eaff',

backgroundColor:
'rgba(0,234,255,.07)',

fill:
true,

tension:
.42,

pointRadius:
1.5,

borderWidth:
2

},

{

label:
'Total Bots',

data: [],

borderColor:
'#a855f7',

backgroundColor:
'rgba(168,85,247,.03)',

fill:
false,

tension:
.42,

pointRadius:
1.5,

borderWidth:
2

}

]

},

options: {

responsive:
true,

maintainAspectRatio:
false,

interaction: {

intersect:
false,

mode:
'index'

},

plugins: {

legend: {

labels: {

color:
'#9aa7bd',

font: {
size: 9
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

color:
'#59667b',

maxTicksLimit:
7

}

},

y: {

beginAtZero:
true,

grid: {

color:
'rgba(255,255,255,.035)'

},

ticks: {

color:
'#59667b',

precision:
0

}

}

}

}

}
);


async function loadHome() {

try {

const statsResponse =
await fetch(
'/api/online-count',
{
cache:
'no-store'
}
);

const stats =
await statsResponse.json();


document.getElementById(
'online'
).textContent =
stats.online;

document.getElementById(
'total'
).textContent =
stats.total;

document.getElementById(
'offline'
).textContent =
stats.offline;

document.getElementById(
'percentage'
).textContent =
Number(
stats.percentage || 0
).toFixed(1) + '%';

document.getElementById(
'threshold'
).textContent =
(stats.thresholdMinutes || 0)
+ ' min';

document.getElementById(
'updated'
).textContent =
new Date(
stats.time
).toLocaleTimeString();


const analyticsResponse =
await fetch(
'/api/analytics?hours=24',
{
cache:
'no-store'
}
);

const analytics =
await analyticsResponse.json();


if (
analytics &&
Array.isArray(
analytics.data
)
) {

homeChart.data.labels =
analytics.data.map(
row =>
new Date(
row.time
).toLocaleTimeString(
[],
{
hour:
'2-digit',
minute:
'2-digit'
}
)
);

homeChart.data.datasets[0]
.data =
analytics.data.map(
row =>
row.online
);

homeChart.data.datasets[1]
.data =
analytics.data.map(
row =>
row.total
);

homeChart.update();

}

} catch (error) {

console.error(
'Dashboard refresh:',
error
);

}

}


loadHome();

setInterval(
loadHome,
5000
);

</script>

</body>

</html>

`);

  }
);


/* =========================================================
   STATUS PAGE
========================================================= */

app.get(
  '/status',
  (req, res) => {

    res.set(
      'Cache-Control',
      'no-store'
    );

    res.send(`

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>
SHAGGY XMD • Analytics
</title>

<script
src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"
></script>

<style>
${CSS}
</style>

</head>

<body>

${loaderHTML()}

<div class="wrap">

<header class="topbar">

<a
href="/"
class="brand"
>

<div class="brand-icon">
📊
</div>

<div>

<strong>
SHAGGY XMD
</strong>

<span>
Analytics Center
</span>

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


<section class="hero">

<div class="eyebrow">

<span class="dot"></span>

LIVE ANALYTICS

</div>


<h1>
Bot Network<br>
Analytics.
</h1>


<p>
Real-time monitoring combined with historical
24-hour activity data stored in MongoDB.
The dashboard refreshes every five seconds.
</p>

</section>


<section class="section">

<div class="stats">


<div class="card stat">

<div class="stat-top">

<div class="label">
🟢 Online
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
Active now
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
🌐 Total
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
All sessions
</div>

</div>


<div class="card stat">

<div class="stat-top">

<div class="label">
🔴 Offline
</div>

<div class="stat-icon">
🔴
</div>

</div>

<div
class="value"
id="offline"
>
--
</div>

<div class="note">
Inactive
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
Network health
</div>

</div>

</div>

</section>


<section class="section">

<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
24 Hour Activity Line
</div>

<div class="panel-sub">
Bot network activity by minute
</div>

</div>

<div
class="live"
id="connection"
>

<span class="dot"></span>

LIVE

</div>

</div>


<div class="chart">

<canvas
id="chart"
></canvas>

</div>

</div>

</section>


<section class="section">

<div class="analytics-grid">


<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
Availability Percentage
</div>

<div class="panel-sub">
24 hour availability trend
</div>

</div>

</div>


<div class="chart chart-small">

<canvas
id="availabilityChart"
></canvas>

</div>

</div>


<div class="card panel">

<div class="panel-head">

<div>

<div class="panel-title">
System Information
</div>

<div class="panel-sub">
Live monitor configuration
</div>

</div>

</div>


<div class="system-list">


<div class="system-row">

<span>
Refresh
</span>

<span>
5 seconds
</span>

</div>


<div class="system-row">

<span>
Chart period
</span>

<span>
24 hours
</span>

</div>


<div class="system-row">

<span>
Threshold
</span>

<span
id="threshold"
>
--
</span>

</div>


<div class="system-row">

<span>
Metrics
</span>

<span>
MongoDB
</span>

</div>


<div class="system-row">

<span>
Last update
</span>

<span
id="updated"
>
--
</span>

</div>

</div>

</div>

</div>

</section>


<footer class="footer">

SHAGGY XMD Analytics •

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

const chart =
new Chart(

document
.getElementById(
'chart'
)
.getContext('2d'),

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
'#00eaff',

backgroundColor:
'rgba(0,234,255,.08)',

fill:
true,

tension:
.42,

pointRadius:
1.5,

borderWidth:
2

},

{

label:
'Total Bots',

data: [],

borderColor:
'#a855f7',

backgroundColor:
'rgba(168,85,247,.025)',

fill:
false,

tension:
.42,

pointRadius:
1.5,

borderWidth:
2

},

{

label:
'Offline Bots',

data: [],

borderColor:
'#ff5577',

backgroundColor:
'transparent',

fill:
false,

tension:
.42,

pointRadius:
1.2,

borderWidth:
1.5

}

]

},

options: {

responsive:
true,

maintainAspectRatio:
false,

interaction: {

intersect:
false,

mode:
'index'

},

plugins: {

legend: {

labels: {

color:
'#9aa7bd',

font:
{
size: 9
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

color:
'#59667b',

maxTicksLimit:
12

}

},

y: {

beginAtZero:
true,

grid: {

color:
'rgba(255,255,255,.035)'

},

ticks: {

color:
'#59667b',

precision:
0

}

}

}

}

}

);


const availabilityChart =
new Chart(

document
.getElementById(
'availabilityChart'
)
.getContext('2d'),

{

type:
'line',

data: {

labels: [],

datasets: [

{

label:
'Availability %',

data: [],

borderColor:
'#21f39a',

backgroundColor:
'rgba(33,243,154,.07)',

fill:
true,

tension:
.42,

pointRadius:
1.2,

borderWidth:
2

}

]

},

options: {

responsive:
true,

maintainAspectRatio:
false,

plugins: {

legend: {

labels: {

color:
'#9aa7bd',

font:
{
size: 9
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

color:
'#59667b',

maxTicksLimit:
8

}

},

y: {

beginAtZero:
true,

max:
100,

grid: {

color:
'rgba(255,255,255,.035)'

},

ticks: {

color:
'#59667b',

callback:
value =>
value + '%'

}

}

}

}

}

);


async function updateStatus() {

try {

const statsResponse =
await fetch(
'/api/online-count',
{
cache:
'no-store'
}
);

const stats =
await statsResponse.json();


document.getElementById(
'online'
).textContent =
stats.online;

document.getElementById(
'total'
).textContent =
stats.total;

document.getElementById(
'offline'
).textContent =
stats.offline;

document.getElementById(
'percentage'
).textContent =
Number(
stats.percentage || 0
).toFixed(1) + '%';

document.getElementById(
'threshold'
).textContent =
(stats.thresholdMinutes || 0)
+ ' minutes';

document.getElementById(
'updated'
).textContent =
new Date(
stats.time
).toLocaleTimeString();


const analyticsResponse =
await fetch(
'/api/analytics?hours=24',
{
cache:
'no-store'
}
);

const analytics =
await analyticsResponse.json();


if (
analytics &&
Array.isArray(
analytics.data
)
) {

const rows =
analytics.data;


const labels =
rows.map(
row =>
new Date(
row.time
).toLocaleTimeString(
[],
{
hour:
'2-digit',
minute:
'2-digit'
}
)
);


chart.data.labels =
labels;

chart.data.datasets[0]
.data =
rows.map(
row =>
row.online
);

chart.data.datasets[1]
.data =
rows.map(
row =>
row.total
);

chart.data.datasets[2]
.data =
rows.map(
row =>
row.offline
);


availabilityChart
.data.labels =
labels;

availabilityChart
.data.datasets[0]
.data =
rows.map(
row =>
row.percentage
);


chart.update();

availabilityChart.update();

}


document.getElementById(
'connection'
).innerHTML =
'<span class="dot"></span> LIVE';

} catch (error) {

document.getElementById(
'connection'
).innerHTML =
'<span class="dot" style="background:#ff5577"></span> ERROR';

}

}


updateStatus();

setInterval(
updateStatus,
5000
);

</script>

</body>

</html>

`);

  }
);


/* =========================================================
   MANAGE PAGE
========================================================= */

app.get(
  '/manage',
  (req, res) => {

    res.set(
      'Cache-Control',
      'no-store'
    );

    res.send(`

<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
name="viewport"
content="width=device-width,initial-scale=1.0"
>

<title>
SHAGGY XMD • Manage
</title>

<style>
${CSS}
</style>

</head>

<body>

${loaderHTML()}

<div class="wrap">

<header class="topbar">

<a
href="/"
class="brand"
>

<div class="brand-icon">
⚙️
</div>

<div>

<strong>
SHAGGY XMD
</strong>

<span>
Bot Management
</span>

</div>

</a>


<nav class="nav">

<a href="/">
🏠 Home
</a>

<a href="/status">
📊 Analytics
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
Customize your bot from the web panel.
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


<div class="field">

<label>
Movie Footer
</label>

<input
id="movieFooter"
placeholder="SHAGGY XMD MOVIE"
>

</div>


<div class="field">

<label>
MOVIE_CAPTION
</label>

<input
id="movieCaption"
placeholder="🎬 ${'${'}title${'}'}"
>

</div>

</div>

</div>


<div class="group">

<div class="group-title">

<span>
🌐
</span>

Bot Mode

</div>


<div class="mode-selector">


<label class="mode-option">

<input
type="radio"
name="mode"
value="PUBLIC"
id="modePublic"
>

<span
class="mode-card public"
>

<strong>
🌐 PUBLIC MODE
</strong>

<small>
Normal public bot mode.
Use when your bot should operate publicly.
</small>

</span>

</label>


<label class="mode-option">

<input
type="radio"
name="mode"
value="PRIVATE"
id="modePrivate"
>

<span
class="mode-card private"
>

<strong>
🔐 PRIVATE MODE
</strong>

<small>
Private/restricted bot mode.
UI will show private status.
</small>

</span>

</label>


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
📊 Analytics
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
id="previewMode"
class="mode-badge mode-public"
style="display:flex;width:max-content;margin:0 auto 12px"
>
🌐 PUBLIC
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


<div class="movie-preview">

<div class="movie-preview-title">
MOVIE CAPTION
</div>

<div
id="previewMovie"
class="movie-preview-text"
>
Movie caption preview...
</div>

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

const movieCaption =
document.getElementById(
'movieCaption'
);


const modePublic =
document.getElementById(
'modePublic'
);

const modePrivate =
document.getElementById(
'modePrivate'
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

const previewMovie =
document.getElementById(
'previewMovie'
);

const previewMode =
document.getElementById(
'previewMode'
);


function getMode() {

return modePrivate.checked
  ? 'PRIVATE'
  : 'PUBLIC';

}


function preview() {

previewName.textContent =
botName.value.trim() ||
'SHAGGY XMD';

previewFooter.textContent =
botFooter.value.trim() ||
'POWERED BY SHAGGY';


previewMovie.textContent =
movieCaption.value.trim() ||
'Movie caption preview...';


const mode =
getMode();


if (
mode === 'PRIVATE'
) {

previewMode.className =
'mode-badge mode-private';

previewMode.textContent =
'🔐 PRIVATE';

} else {

previewMode.className =
'mode-badge mode-public';

previewMode.textContent =
'🌐 PUBLIC';

}


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

img.src =
image;

img.alt =
'Bot Image';

img.onerror =
function() {

avatar.innerHTML =
'🤖';

};

avatar.appendChild(
img
);

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
cache:
'no-store'
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

movieCaption.value =
data.MOVIE_CAPTION || '';


if (
data.MODE ===
'PRIVATE'
) {

modePrivate.checked =
true;

} else {

modePublic.checked =
true;

}


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

MOVIE_CAPTION:
movieCaption.value.trim(),

MODE:
getMode(),

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

method:
'POST',

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
'✓ Settings saved successfully.';

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
event.key ===
'Enter'
) {

doLogin();

}

}
);


[
botName,
botImage,
botFooter,
movieFooter,
movieCaption
].forEach(
function(input) {

input.addEventListener(
'input',
preview
);

}
);


[
modePublic,
modePrivate
].forEach(
function(input) {

input.addEventListener(
'change',
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

</html>

`);

  }
);


/* =========================================================
   START
========================================================= */

connectDB()

.then(
  async () => {

    /*
     * Create initial snapshot.
     */
    await saveMetricsSnapshot();

    /*
     * Save one analytics snapshot
     * every 60 seconds.
     */
    setInterval(
      saveMetricsSnapshot,
      60 * 1000
    );

    /*
     * Clean metrics every hour.
     */
    setInterval(
      cleanOldMetrics,
      60 * 60 * 1000
    );


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
          `📊 Analytics: /status`
        );

        console.log(
          `⚙️ Manage: /manage`
        );

        console.log(
          `📈 Analytics API: /api/analytics`
        );

        console.log(
          `🔗 Pair Web: ${PAIR_WEB_URL}`
        );

        console.log(
          `🌐 Default Mode: ${DEFAULT_MODE}`
        );

      }
    );

  }
)

.catch(
  err => {

    console.error(
      '❌ MongoDB connection failed:',
      err.message
    );

    process.exit(1);

  }
);
