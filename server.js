require('dotenv').config();

const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();

const PORT = process.env.PORT || 3000;

const MONGODB_URI = process.env.MONGODB_URI;

const DB_NAME =
  process.env.DB_NAME || 'test';

const COLLECTION_NAME =
  process.env.COLLECTION_NAME || 'sessions';

const TIMESTAMP_FIELD =
  process.env.TIMESTAMP_FIELD || 'lastSeen';

const METRICS_COLLECTION_NAME =
  process.env.METRICS_COLLECTION_NAME || 'bot_metrics';

const ONLINE_THRESHOLD_MINUTES =
  Number(process.env.ONLINE_THRESHOLD_MINUTES || 2);

const PAIR_WEB_URL =
  process.env.PAIR_WEB_URL ||
  'https://www.shaggytech.online';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI .env file eke danna one!');
  process.exit(1);
}

let collection;
let autoRepliesCollection;
let metricsCollection;
let mongoClient;

/* =========================================================
   MONGODB CONNECTION
========================================================= */

async function connectDB() {
  mongoClient = new MongoClient(MONGODB_URI);

  await mongoClient.connect();

  const db = mongoClient.db(DB_NAME);

  collection = db.collection(COLLECTION_NAME);

  autoRepliesCollection =
    db.collection('autoreplies');

  metricsCollection =
    db.collection(METRICS_COLLECTION_NAME);

  // Analytics performance indexes
  try {
    await metricsCollection.createIndex({
      createdAt: -1
    });
  } catch (err) {
    console.log(
      '⚠️ Metrics index:',
      err.message
    );
  }

  try {
    await collection.createIndex({
      updatedAt: -1
    });
  } catch (err) {
    console.log(
      '⚠️ Session updatedAt index:',
      err.message
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
   HELPER: accessKey -> bot number
========================================================= */

async function resolveNumberByKey(key) {
  const doc = await collection.findOne(
    {
      'config.accessKey': key
    },
    {
      projection: {
        number: 1
      }
    }
  );

  return doc ? doc.number : null;
}

/* =========================================================
   HELPER: BOOLEAN CONFIG
========================================================= */

function configBoolean(value) {
  return (
    value === true ||
    value === 'true'
  );
}

/* =========================================================
   HELPER: MODE
========================================================= */

function normalizeMode(value) {
  const mode =
    String(value || '')
      .trim()
      .toUpperCase();

  return mode === 'PUBLIC'
    ? 'PUBLIC'
    : 'PRIVATE';
}

/* =========================================================
   HELPER: ONLINE + TOTAL COUNT
========================================================= */

async function getOnlineAndTotal() {
  if (!collection) {
    throw new Error(
      'Database not ready'
    );
  }

  const thresholdDate =
    new Date(
      Date.now() -
      ONLINE_THRESHOLD_MINUTES *
      60 *
      1000
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
          (
            (onlineCount / totalCount) *
            100
          ).toFixed(2)
        )
      : 0;

  return {
    online: onlineCount,
    total: totalCount,
    percentage
  };
}

/* =========================================================
   HELPER: SAVE ANALYTICS SNAPSHOT
========================================================= */

async function saveMetricsSnapshot() {
  try {
    if (!collection || !metricsCollection) {
      return;
    }

    const stats =
      await getOnlineAndTotal();

    await metricsCollection.insertOne({
      createdAt: new Date(),

      online: stats.online,

      total: stats.total,

      percentage: stats.percentage
    });

    console.log(
      `📊 Metrics saved -> ${stats.online}/${stats.total} (${stats.percentage}%)`
    );
  } catch (err) {
    console.error(
      '⚠️ Metrics snapshot error:',
      err.message
    );
  }
}

/* =========================================================
   HELPER: ANALYTICS HISTORY
========================================================= */

async function getAnalyticsHistory(hours = 24) {
  if (!metricsCollection) {
    throw new Error(
      'Metrics database not ready'
    );
  }

  hours = Number(hours);

  if (!Number.isFinite(hours)) {
    hours = 24;
  }

  hours = Math.min(
    Math.max(hours, 1),
    168
  );

  const since =
    new Date(
      Date.now() -
      hours * 60 * 60 * 1000
    );

  const docs =
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
    24h -> 5 minute buckets

    This prevents the chart from becoming
    too heavy while still keeping good detail.
  */

  const bucketSize =
    hours <= 24
      ? 5 * 60 * 1000
      : 15 * 60 * 1000;

  const buckets = new Map();

  for (const doc of docs) {
    const time =
      new Date(doc.createdAt)
        .getTime();

    if (!Number.isFinite(time)) {
      continue;
    }

    const bucket =
      Math.floor(
        time / bucketSize
      ) * bucketSize;

    if (!buckets.has(bucket)) {
      buckets.set(bucket, {
        time: new Date(bucket),

        onlineValues: [],

        totalValues: [],

        percentageValues: []
      });
    }

    const item =
      buckets.get(bucket);

    item.onlineValues.push(
      Number(doc.online || 0)
    );

    item.totalValues.push(
      Number(doc.total || 0)
    );

    item.percentageValues.push(
      Number(doc.percentage || 0)
    );
  }

  const points = [];

  for (const bucket of buckets.values()) {
    const avg = arr =>
      arr.length
        ? arr.reduce(
            (a, b) => a + b,
            0
          ) / arr.length
        : 0;

    points.push({
      time:
        bucket.time.toISOString(),

      online:
        Number(
          avg(bucket.onlineValues)
            .toFixed(2)
        ),

      total:
        Number(
          avg(bucket.totalValues)
            .toFixed(2)
        ),

      percentage:
        Number(
          avg(
            bucket.percentageValues
          ).toFixed(2)
        )
    });
  }

  return {
    hours,
    points
  };
}

/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
  express.json({
    limit: '1mb'
  })
);

/* =========================================================
   ONLINE COUNT API
========================================================= */

app.get(
  '/api/online-count',
  async (req, res) => {
    try {
      if (!collection) {
        return res.status(503).json({
          error:
            'Database ready naha'
        });
      }

      const stats =
        await getOnlineAndTotal();

      res.json({
        online: stats.online,

        total: stats.total,

        percentage:
          stats.percentage,

        time:
          new Date().toISOString()
      });

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
   ANALYTICS API
========================================================= */

app.get(
  '/api/analytics',
  async (req, res) => {
    try {
      if (
        !collection ||
        !metricsCollection
      ) {
        return res.status(503).json({
          error:
            'Database ready naha'
        });
      }

      const hours =
        Number(
          req.query.hours || 24
        );

      const history =
        await getAnalyticsHistory(
          hours
        );

      const current =
        await getOnlineAndTotal();

      const values =
        history.points;

      const onlineValues =
        values.map(
          x => Number(x.online || 0)
        );

      const totalValues =
        values.map(
          x => Number(x.total || 0)
        );

      const availabilityValues =
        values.map(
          x =>
            Number(
              x.percentage || 0
            )
        );

      const average = arr =>
        arr.length
          ? arr.reduce(
              (a, b) => a + b,
              0
            ) / arr.length
          : 0;

      const peakOnline =
        onlineValues.length
          ? Math.max(...onlineValues)
          : current.online;

      const minOnline =
        onlineValues.length
          ? Math.min(...onlineValues)
          : current.online;

      const maxTotal =
        totalValues.length
          ? Math.max(...totalValues)
          : current.total;

      const avgOnline =
        average(onlineValues);

      const avgTotal =
        average(totalValues);

      const avgAvailability =
        average(
          availabilityValues
        );

      res.json({
        hours,

        current: {
          online: current.online,
          total: current.total,
          percentage:
            current.percentage
        },

        summary: {
          peakOnline,
          minOnline,
          maxTotal,

          averageOnline:
            Number(
              avgOnline.toFixed(2)
            ),

          averageTotal:
            Number(
              avgTotal.toFixed(2)
            ),

          averageAvailability:
            Number(
              avgAvailability.toFixed(2)
            ),

          points:
            values.length
        },

        points:
          history.points,

        time:
          new Date().toISOString()
      });

    } catch (err) {
      console.error(
        '❌ Analytics error:',
        err.message
      );

      res.status(500).json({
        error:
          'Analytics ganna bari una'
      });
    }
  }
);

/* =========================================================
   GET BOT SETTINGS
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
        String(
          req.params.key || ''
        ).trim();

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

      /*
        MOVIE_CAPTION compatibility:
        New -> MOVIE_CAPTION
        Old -> MOVIE_FOOTER
      */

      const movieCaption =
        cfg.MOVIE_CAPTION ||
        cfg.MOVIE_FOOTER ||
        '';

      const movieFooter =
        cfg.MOVIE_FOOTER ||
        cfg.MOVIE_CAPTION ||
        '';

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
          movieFooter,

        MOVIE_CAPTION:
          movieCaption,

        MODE:
          normalizeMode(
            cfg.MODE
          ),

        ALWAYS_ONLINE:
          configBoolean(
            cfg.ALWAYS_ONLINE
          ),

        ALWAYS_MSG_SEEN:
          configBoolean(
            cfg.ALWAYS_MSG_SEEN
          ),

        STATUS_VIEW:
          configBoolean(
            cfg.STATUS_VIEW
          ),

        AUTO_LIKE:
          configBoolean(
            cfg.AUTO_LIKE
          ),

        ANTI_DELETE:
          configBoolean(
            cfg.ANTI_DELETE
          )
      });

    } catch (err) {
      console.error(
        '❌ bot-settings GET error:',
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
   SAVE BOT SETTINGS
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
        String(
          req.params.key || ''
        ).trim();

      if (!key) {
        return res.status(400).json({
          error:
            'Access key eka denna'
        });
      }

      const {
        BOT_NAME,
        BOT_IMAGE,
        BOT_FOOTER,
        MOVIE_FOOTER,
        MOVIE_CAPTION,
        MODE,

        ALWAYS_ONLINE,
        ALWAYS_MSG_SEEN,
        STATUS_VIEW,
        AUTO_LIKE,
        ANTI_DELETE
      } = req.body || {};

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

      const update = {};

      if (
        typeof BOT_NAME ===
        'string'
      ) {
        update[
          'config.BOT_NAME'
        ] =
          BOT_NAME.trim();
      }

      if (
        typeof BOT_IMAGE ===
        'string'
      ) {
        update[
          'config.BOT_IMAGE'
        ] =
          BOT_IMAGE.trim();
      }

      if (
        typeof BOT_FOOTER ===
        'string'
      ) {
        update[
          'config.BOT_FOOTER'
        ] =
          BOT_FOOTER.trim();
      }

      /*
        MOVIE CAPTION

        If MOVIE_CAPTION is supplied,
        save it to both fields for compatibility.

        If old frontend sends MOVIE_FOOTER,
        also save it to MOVIE_CAPTION.
      */

      if (
        typeof MOVIE_CAPTION ===
        'string'
      ) {
        const caption =
          MOVIE_CAPTION.trim();

        update[
          'config.MOVIE_CAPTION'
        ] = caption;

        update[
          'config.MOVIE_FOOTER'
        ] = caption;

      } else if (
        typeof MOVIE_FOOTER ===
        'string'
      ) {
        const footer =
          MOVIE_FOOTER.trim();

        update[
          'config.MOVIE_FOOTER'
        ] = footer;

        update[
          'config.MOVIE_CAPTION'
        ] = footer;
      }

      /* =====================================================
         MODE
      ===================================================== */

      if (
        typeof MODE ===
        'string'
      ) {
        update[
          'config.MODE'
        ] =
          normalizeMode(
            MODE
          );
      }

      /* =====================================================
         TOGGLES
      ===================================================== */

      if (
        typeof ALWAYS_ONLINE ===
        'boolean'
      ) {
        update[
          'config.ALWAYS_ONLINE'
        ] =
          ALWAYS_ONLINE
            ? 'true'
            : 'false';
      }

      if (
        typeof ALWAYS_MSG_SEEN ===
        'boolean'
      ) {
        update[
          'config.ALWAYS_MSG_SEEN'
        ] =
          ALWAYS_MSG_SEEN
            ? 'true'
            : 'false';
      }

      if (
        typeof STATUS_VIEW ===
        'boolean'
      ) {
        update[
          'config.STATUS_VIEW'
        ] =
          STATUS_VIEW
            ? 'true'
            : 'false';
      }

      if (
        typeof AUTO_LIKE ===
        'boolean'
      ) {
        update[
          'config.AUTO_LIKE'
        ] =
          AUTO_LIKE
            ? 'true'
            : 'false';
      }

      if (
        typeof ANTI_DELETE ===
        'boolean'
      ) {
        update[
          'config.ANTI_DELETE'
        ] =
          ANTI_DELETE
            ? 'true'
            : 'false';
      }

      /*
        IMPORTANT:
        pair.js optimized sync එකට
        මේ updatedAt value එක තමයි detect කරන්නේ.
      */

      update.updatedAt =
        new Date();

      await collection.updateOne(
        {
          'config.accessKey':
            key
        },
        {
          $set: update
        }
      );

      res.json({
        success: true,

        message:
          'Bot settings saved',

        mode:
          update[
            'config.MODE'
          ] || undefined,

        updatedAt:
          update.updatedAt
            .toISOString()
      });

    } catch (err) {
      console.error(
        '❌ bot-settings POST error:',
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
   AUTO-REPLY MANAGEMENT
========================================================= */

app.get(
  '/api/auto-replies/:key',
  async (req, res) => {
    try {
      if (
        !collection ||
        !autoRepliesCollection
      ) {
        return res.status(503).json({
          error:
            'Database ready naha'
        });
      }

      const key =
        String(
          req.params.key || ''
        ).trim();

      const number =
        await resolveNumberByKey(
          key
        );

      if (!number) {
        return res.status(404).json({
          error:
            'Invalid access key'
        });
      }

      const rules =
        await autoRepliesCollection
          .find({ number })
          .sort({
            createdAt: -1
          })
          .toArray();

      res.json({
        rules:
          rules.map(r => ({
            keyword:
              r.keyword,

            reply:
              r.reply || '',

            image:
              r.image || ''
          }))
      });

    } catch (err) {
      console.error(
        '❌ auto-replies GET error:',
        err.message
      );

      res.status(500).json({
        error:
          'Data ganna bari una'
      });
    }
  }
);

app.post(
  '/api/auto-replies/:key',
  async (req, res) => {
    try {
      if (
        !collection ||
        !autoRepliesCollection
      ) {
        return res.status(503).json({
          error:
            'Database ready naha'
        });
      }

      const key =
        String(
          req.params.key || ''
        ).trim();

      const number =
        await resolveNumberByKey(
          key
        );

      if (!number) {
        return res.status(404).json({
          error:
            'Invalid access key'
        });
      }

      const {
        keyword,
        reply,
        image
      } = req.body || {};

      const cleanKeyword =
        String(
          keyword || ''
        )
          .trim()
          .toLowerCase();

      if (!cleanKeyword) {
        return res.status(400).json({
          error:
            'Keyword eka danna'
        });
      }

      if (!reply && !image) {
        return res.status(400).json({
          error:
            'Reply text ekak nathnam image ekak witharath danna'
        });
      }

      await autoRepliesCollection.updateOne(
        {
          number,
          keyword:
            cleanKeyword
        },
        {
          $set: {
            number,

            keyword:
              cleanKeyword,

            reply:
              String(
                reply || ''
              ).trim(),

            image:
              String(
                image || ''
              ).trim(),

            createdAt:
              new Date()
          }
        },
        {
          upsert: true
        }
      );

      res.json({
        success: true,
        message:
          'Auto-reply saved'
      });

    } catch (err) {
      console.error(
        '❌ auto-replies POST error:',
        err.message
      );

      res.status(500).json({
        error:
          'Save karanna bari una'
      });
    }
  }
);

app.delete(
  '/api/auto-replies/:key/:keyword',
  async (req, res) => {
    try {
      if (
        !collection ||
        !autoRepliesCollection
      ) {
        return res.status(503).json({
          error:
            'Database ready naha'
        });
      }

      const key =
        String(
          req.params.key || ''
        ).trim();

      const number =
        await resolveNumberByKey(
          key
        );

      if (!number) {
        return res.status(404).json({
          error:
            'Invalid access key'
        });
      }

      const keyword =
        String(
          req.params.keyword || ''
        )
          .trim()
          .toLowerCase();

      const result =
        await autoRepliesCollection
          .deleteOne({
            number,
            keyword
          });

      res.json({
        success: true,

        deleted:
          result.deletedCount > 0
      });

    } catch (err) {
      console.error(
        '❌ auto-replies DELETE error:',
        err.message
      );

      res.status(500).json({
        error:
          'Delete karanna bari una'
      });
    }
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
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    res.send(`<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Bot Settings - Manage</title>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --green: #25d366;
  --blue: #60a5fa;
  --purple: #a78bfa;
  --red: #f87171;
  --bg: #050b14;
  --card: rgba(255,255,255,.055);
  --border: rgba(255,255,255,.09);
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
      circle at 10% 10%,
      rgba(37,211,102,.10),
      transparent 30%
    ),

    radial-gradient(
      circle at 90% 20%,
      rgba(96,165,250,.12),
      transparent 30%
    ),

    radial-gradient(
      circle at 50% 100%,
      rgba(167,139,250,.10),
      transparent 35%
    ),

    linear-gradient(
      135deg,
      #020617,
      #0b1120 50%,
      #111827
    );

  color: #e5e7eb;
  min-height: 100vh;
  padding: 25px 15px;

  overflow-x: hidden;
}

/* =========================================================
   INTRO LOADER
========================================================= */

#introLoader {

  position: fixed;
  inset: 0;

  z-index: 99999;

  display: flex;
  align-items: center;
  justify-content: center;

  background:
    radial-gradient(
      circle,
      #172554,
      #020617 70%
    );

  transition:
    opacity .7s ease,
    visibility .7s ease;
}

#introLoader.hide {

  opacity: 0;
  visibility: hidden;
}

.loaderBox {

  text-align: center;

  animation:
    loaderFloat 2s ease-in-out infinite;
}

.loaderLogo {

  width: 75px;
  height: 75px;

  border-radius: 24px;

  display: flex;
  align-items: center;
  justify-content: center;

  margin: auto;

  font-size: 38px;

  background:
    linear-gradient(
      135deg,
      #25d366,
      #60a5fa
    );

  box-shadow:
    0 0 50px
    rgba(37,211,102,.25);
}

.loaderText {

  margin-top: 16px;

  font-size: 15px;

  font-weight: 800;

  letter-spacing: 1px;

  color: #e2e8f0;
}

.loaderBar {

  width: 180px;
  height: 4px;

  margin: 16px auto 0;

  border-radius: 20px;

  overflow: hidden;

  background:
    rgba(255,255,255,.08);
}

.loaderBar span {

  display: block;

  width: 45%;

  height: 100%;

  border-radius: inherit;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa,
      #a78bfa
    );

  animation:
    loadingBar 1.2s infinite ease-in-out;
}

@keyframes loadingBar {

  0% {
    transform: translateX(-120%);
  }

  100% {
    transform: translateX(430%);
  }
}

@keyframes loaderFloat {

  0%,100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-8px);
  }
}

/* =========================================================
   MAIN
========================================================= */

.wrap {

  max-width: 1080px;

  margin: auto;

  position: relative;

  z-index: 2;
}

.hidden {
  display: none !important;
}

/* =========================================================
   HEADER
========================================================= */

.header {

  margin-bottom: 22px;

  animation:
    fadeUp .7s ease;
}

h1 {

  font-size: 28px;

  font-weight: 900;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa,
      #a78bfa
    );

  -webkit-background-clip: text;
  background-clip: text;

  color: transparent;
}

.sub {

  color: #94a3b8;

  font-size: 13px;

  margin-top: 6px;
}

/* =========================================================
   CARDS
========================================================= */

.card {

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.075),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    rgba(255,255,255,.09);

  border-radius: 20px;

  padding: 20px;

  backdrop-filter:
    blur(18px);

  -webkit-backdrop-filter:
    blur(18px);

  box-shadow:
    0 25px 70px
    rgba(0,0,0,.30);

  margin-bottom: 16px;

  animation:
    fadeUp .7s ease;
}

.card:hover {

  border-color:
    rgba(96,165,250,.18);
}

.card-title {

  font-size: 17px;

  font-weight: 800;

  margin-bottom: 5px;
}

.card-sub {

  color: #94a3b8;

  font-size: 12px;

  margin-bottom: 18px;
}

/* =========================================================
   LOGIN
========================================================= */

.login-card {

  max-width: 500px;

  margin:
    70px auto 20px;
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

  padding: 13px 14px;

  border-radius: 12px;

  border:
    1px solid
    rgba(255,255,255,.11);

  background:
    rgba(0,0,0,.28);

  color: #f8fafc;

  font-size: 14px;

  transition:
    .2s ease;
}

input:focus {

  outline: none;

  border-color:
    #25d366;

  box-shadow:
    0 0 0 4px
    rgba(37,211,102,.07);
}

button {

  width: 100%;

  margin-top: 18px;

  padding: 13px;

  border: none;

  border-radius: 12px;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa
    );

  color: #03110b;

  font-size: 14px;

  font-weight: 900;

  cursor: pointer;

  transition:
    .2s ease;
}

button:hover {

  transform:
    translateY(-2px);

  filter:
    brightness(1.08);

  box-shadow:
    0 12px 30px
    rgba(37,211,102,.12);
}

button:disabled {

  opacity: .55;

  cursor: not-allowed;

  transform: none;

  box-shadow: none;
}

/* =========================================================
   BOT NUMBER
========================================================= */

.botnum {

  background:
    rgba(37,211,102,.07);

  border:
    1px solid
    rgba(37,211,102,.15);

  color: #34d399;

  padding: 10px 12px;

  border-radius: 10px;

  font-size: 12px;

  margin-bottom: 16px;
}

/* =========================================================
   SECTIONS
========================================================= */

.section-title {

  font-size: 12px;

  font-weight: 900;

  color: #60a5fa;

  margin-top: 24px;

  margin-bottom: 5px;

  text-transform: uppercase;

  letter-spacing: 1px;
}

/* =========================================================
   MODE SELECTOR
========================================================= */

.mode-grid {

  display: grid;

  grid-template-columns:
    repeat(2, minmax(0, 1fr));

  gap: 12px;

  margin-top: 12px;
}

.mode-card {

  position: relative;

  padding: 17px;

  border-radius: 16px;

  border:
    1px solid
    rgba(255,255,255,.10);

  background:
    rgba(255,255,255,.035);

  cursor: pointer;

  transition:
    .25s ease;
}

.mode-card:hover {

  transform:
    translateY(-2px);

  background:
    rgba(255,255,255,.06);
}

.mode-card.active.public {

  border-color:
    rgba(37,211,102,.65);

  background:
    rgba(37,211,102,.08);

  box-shadow:
    0 0 35px
    rgba(37,211,102,.08);
}

.mode-card.active.private {

  border-color:
    rgba(167,139,250,.65);

  background:
    rgba(167,139,250,.08);

  box-shadow:
    0 0 35px
    rgba(167,139,250,.08);
}

.mode-icon {

  font-size: 28px;

  margin-bottom: 8px;
}

.mode-name {

  font-size: 14px;

  font-weight: 900;
}

.mode-description {

  color: #94a3b8;

  font-size: 11px;

  margin-top: 4px;

  line-height: 1.5;
}

.mode-check {

  position: absolute;

  top: 13px;

  right: 13px;

  width: 22px;

  height: 22px;

  border-radius: 50%;

  display: flex;

  align-items: center;

  justify-content: center;

  font-size: 11px;

  opacity: 0;

  background:
    #25d366;

  color: #02140a;
}

.mode-card.active .mode-check {

  opacity: 1;
}

/* =========================================================
   TOGGLES
========================================================= */

.toggle-row {

  display: flex;

  align-items: center;

  justify-content: space-between;

  gap: 15px;

  padding: 13px 14px;

  background:
    rgba(255,255,255,.035);

  border:
    1px solid
    rgba(255,255,255,.07);

  border-radius: 13px;

  margin-top: 10px;
}

.label-text {

  font-size: 13px;

  color: #e5e7eb;

  font-weight: 600;
}

.label-sub {

  font-size: 11px;

  color: #94a3b8;

  margin-top: 2px;
}

.switch {

  position: relative;

  width: 46px;

  height: 26px;

  flex-shrink: 0;
}

.switch input {

  opacity: 0;

  width: 0;

  height: 0;
}

.slider {

  position: absolute;

  cursor: pointer;

  inset: 0;

  background:
    rgba(255,255,255,.14);

  transition:
    .2s;

  border-radius: 26px;
}

.slider:before {

  position: absolute;

  content: "";

  height: 20px;

  width: 20px;

  left: 3px;

  bottom: 3px;

  background:
    white;

  transition:
    .2s;

  border-radius: 50%;
}

.switch input:checked + .slider {

  background:
    #25d366;
}

.switch input:checked + .slider:before {

  transform:
    translateX(20px);
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
   MODE STATUS
========================================================= */

.mode-status {

  margin-top: 14px;

  padding: 13px;

  border-radius: 13px;

  border:
    1px solid
    rgba(255,255,255,.08);

  font-size: 12px;

  transition:
    .3s ease;
}

.mode-status.public {

  background:
    rgba(37,211,102,.07);

  color: #34d399;

  border-color:
    rgba(37,211,102,.18);
}

.mode-status.private {

  background:
    rgba(167,139,250,.07);

  color: #c4b5fd;

  border-color:
    rgba(167,139,250,.18);
}

/* =========================================================
   AUTO REPLY
========================================================= */

.ar-item {

  display: flex;

  align-items: center;

  gap: 10px;

  background:
    rgba(255,255,255,.035);

  border:
    1px solid
    rgba(255,255,255,.08);

  border-radius: 12px;

  padding: 10px 12px;

  margin-top: 8px;
}

.ar-delete {

  width: auto;

  margin: 0;

  padding: 8px 12px;

  background:
    rgba(248,113,113,.12);

  color: #f87171;

  font-size: 12px;

  box-shadow: none;
}

/* =========================================================
   ANIMATION
========================================================= */

@keyframes fadeUp {

  from {

    opacity: 0;

    transform:
      translateY(14px);
  }

  to {

    opacity: 1;

    transform:
      translateY(0);
  }
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:650px) {

  body {
    padding: 18px 11px;
  }

  h1 {
    font-size: 23px;
  }

  .card {
    padding: 16px;
    border-radius: 17px;
  }

  .mode-grid {
    grid-template-columns: 1fr;
  }
}

</style>
</head>

<body>

<!-- INTRO -->
<div id="introLoader">
  <div class="loaderBox">
    <div class="loaderLogo">🤖</div>
    <div class="loaderText">
      SHAGGY BOT CONTROL
    </div>
    <div class="loaderBar">
      <span></span>
    </div>
  </div>
</div>

<div class="wrap">

  <div class="header">

    <h1>
      🤖 Bot Control Center
    </h1>

    <div class="sub">
      Access key eken login wela oyage bot settings manage karanna.
    </div>

  </div>

  <!-- LOGIN -->

  <div
    class="card login-card"
    id="loginCard"
  >

    <div class="card-title">
      🔐 Access Key Login
    </div>

    <div class="card-sub">
      Oyage bot access key eka enter karanna.
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

  <!-- DASHBOARD -->

  <div
    class="hidden"
    id="dashboard"
  >

    <!-- BOT INFO -->

    <div class="card">

      <div
        class="botnum"
        id="botNum"
      >
        Bot: N/A
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
        Movie Caption
      </label>

      <input
        id="movieCaption"
        placeholder="e.g. 🎬 SHAGGY XMD MOVIE"
        autocomplete="off"
      >

      <div class="section-title">
        🔐 Bot Mode
      </div>

      <div class="mode-grid">

        <div
          class="mode-card public"
          id="publicMode"
          data-mode="PUBLIC"
        >

          <div class="mode-icon">
            🌐
          </div>

          <div class="mode-name">
            PUBLIC MODE
          </div>

          <div class="mode-description">
            Public bot mode.
            Dashboard eke public state
            pennanawa.
          </div>

          <div class="mode-check">
            ✓
          </div>

        </div>

        <div
          class="mode-card private"
          id="privateMode"
          data-mode="PRIVATE"
        >

          <div class="mode-icon">
            🔒
          </div>

          <div class="mode-name">
            PRIVATE MODE
          </div>

          <div class="mode-description">
            Private bot mode.
            Dashboard eke private state
            pennanawa.
          </div>

          <div class="mode-check">
            ✓
          </div>

        </div>

      </div>

      <div
        id="modeStatus"
        class="mode-status private"
      >
        🔒 Private Mode selected
      </div>

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
            Messages auto seen karanawa
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
            Status updates auto balanawa
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
            Status updates auto react karanawa
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
            Delete karapu messages handle karanawa
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
        id="saveMsg"
      ></div>

    </div>

    <!-- AUTO REPLY -->

    <div class="card">

      <div class="card-title">
        💬 Auto Reply Manager
      </div>

      <div class="card-sub">
        Keyword ekakata text/image reply ekak set karanna.
      </div>

      <label>
        Keyword
      </label>

      <input
        id="arKeyword"
        placeholder="e.g. hi"
        autocomplete="off"
      >

      <label>
        Reply Text
      </label>

      <input
        id="arReply"
        placeholder="e.g. Hello! Welcome 👋"
        autocomplete="off"
      >

      <label>
        Image URL
      </label>

      <input
        id="arImage"
        placeholder="https://example.com/image.jpg"
        autocomplete="off"
      >

      <button id="arAddBtn">
        ➕ Add / Update Reply
      </button>

      <div
        class="msg"
        id="arMsg"
      ></div>

      <div
        id="arList"
        style="margin-top:18px;"
      ></div>

    </div>

  </div>

</div>

<script>

/* =========================================================
   INTRO
========================================================= */

window.addEventListener(
  'load',
  function() {

    setTimeout(
      function() {

        document
          .getElementById(
            'introLoader'
          )
          .classList
          .add('hide');

      },
      900
    );

  }
);

/* =========================================================
   ELEMENTS
========================================================= */

let currentKey = null;

let selectedMode =
  'PRIVATE';

const loginCard =
  document.getElementById(
    'loginCard'
  );

const dashboard =
  document.getElementById(
    'dashboard'
  );

const loginMsg =
  document.getElementById(
    'loginMsg'
  );

const saveMsg =
  document.getElementById(
    'saveMsg'
  );

const keyInput =
  document.getElementById(
    'keyInput'
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

const movieCaption =
  document.getElementById(
    'movieCaption'
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

const publicMode =
  document.getElementById(
    'publicMode'
  );

const privateMode =
  document.getElementById(
    'privateMode'
  );

const modeStatus =
  document.getElementById(
    'modeStatus'
  );

/* =========================================================
   MODE UI
========================================================= */

function selectMode(mode) {

  selectedMode =
    mode === 'PUBLIC'
      ? 'PUBLIC'
      : 'PRIVATE';

  publicMode.classList.remove(
    'active'
  );

  privateMode.classList.remove(
    'active'
  );

  modeStatus.classList.remove(
    'public',
    'private'
  );

  if (
    selectedMode ===
    'PUBLIC'
  ) {

    publicMode.classList.add(
      'active'
    );

    modeStatus.classList.add(
      'public'
    );

    modeStatus.textContent =
      '🌐 Public Mode selected';

  } else {

    privateMode.classList.add(
      'active'
    );

    modeStatus.classList.add(
      'private'
    );

    modeStatus.textContent =
      '🔒 Private Mode selected';
  }
}

publicMode.addEventListener(
  'click',
  function() {
    selectMode('PUBLIC');
  }
);

privateMode.addEventListener(
  'click',
  function() {
    selectMode('PRIVATE');
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

    currentKey =
      key;

    document
      .getElementById(
        'botNum'
      )
      .textContent =
        '📱 Bot: ' +
        (
          data.number ||
          'N/A'
        );

    botName.value =
      data.BOT_NAME || '';

    botImage.value =
      data.BOT_IMAGE || '';

    botFooter.value =
      data.BOT_FOOTER || '';

    movieCaption.value =
      data.MOVIE_CAPTION ||
      data.MOVIE_FOOTER ||
      '';

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

    selectMode(
      data.MODE || 'PRIVATE'
    );

    loginCard
      .classList
      .add('hidden');

    dashboard
      .classList
      .remove('hidden');

    loadAutoReplies();

  } catch (err) {

    loginMsg.textContent =
      '⚠ ' +
      err.message;

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
  .getElementById(
    'loginBtn'
  )
  .addEventListener(
    'click',
    login
  );

keyInput.addEventListener(
  'keydown',
  function(e) {

    if (
      e.key === 'Enter'
    ) {
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

          body:
            JSON.stringify({

              BOT_NAME:
                botName.value.trim(),

              BOT_IMAGE:
                botImage.value.trim(),

              BOT_FOOTER:
                botFooter.value.trim(),

              MOVIE_CAPTION:
                movieCaption.value.trim(),

              MODE:
                selectedMode,

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
      '✅ Settings saved! Bot ekata ~5 seconds athulata auto-apply wenawa.';

    saveMsg.className =
      'msg ok';

    saveMsg.style.display =
      'block';

  } catch (err) {

    saveMsg.textContent =
      '⚠ ' +
      err.message;

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
  .getElementById(
    'saveBtn'
  )
  .addEventListener(
    'click',
    saveSettings
  );

/* =========================================================
   AUTO REPLY
========================================================= */

const arKeyword =
  document.getElementById(
    'arKeyword'
  );

const arReply =
  document.getElementById(
    'arReply'
  );

const arImage =
  document.getElementById(
    'arImage'
  );

const arMsg =
  document.getElementById(
    'arMsg'
  );

const arList =
  document.getElementById(
    'arList'
  );

function escapeHtml(str) {

  const div =
    document.createElement(
      'div'
    );

  div.textContent =
    str;

  return div.innerHTML;
}

async function loadAutoReplies() {

  if (!currentKey) {
    return;
  }

  arList.innerHTML =
    '<div style="color:#94a3b8;font-size:13px;">⏳ Loading...</div>';

  try {

    const res =
      await fetch(
        '/api/auto-replies/' +
        encodeURIComponent(
          currentKey
        ),
        {
          cache: 'no-store'
        }
      );

    const data =
      await res.json();

    if (!res.ok) {
      throw new Error(
        data.error ||
        'Load failed'
      );
    }

    const rules =
      data.rules || [];

    if (
      rules.length === 0
    ) {

      arList.innerHTML =
        '<div style="color:#94a3b8;font-size:13px;">Auto-reply rules nathi.</div>';

      return;
    }

    arList.innerHTML =
      rules
        .map(
          function(r) {

            const imgTag =
              r.image

                ? '<img src="' +
                  escapeHtml(
                    r.image
                  ) +
                  '" style="width:38px;height:38px;border-radius:9px;object-fit:cover;flex-shrink:0;" onerror="this.style.display=\\'none\\'">'

                : '';

            return (

              '<div class="ar-item">' +

              imgTag +

              '<div style="flex:1;min-width:0;">' +

              '<div style="font-size:13px;font-weight:800;color:#34d399;">' +

              escapeHtml(
                r.keyword
              ) +

              '</div>' +

              '<div style="font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +

              escapeHtml(
                r.reply ||
                '(image only)'
              ) +

              '</div>' +

              '</div>' +

              '<button data-keyword="' +

              escapeHtml(
                r.keyword
              ) +

              '" class="ar-delete">🗑️</button>' +

              '</div>'
            );
          }
        )
        .join('');

    arList
      .querySelectorAll(
        '.ar-delete'
      )
      .forEach(
        function(btn) {

          btn.addEventListener(
            'click',
            function() {

              deleteAutoReply(
                btn.getAttribute(
                  'data-keyword'
                )
              );

            }
          );

        }
      );

  } catch (err) {

    arList.innerHTML =
      '<div style="color:#f87171;font-size:13px;">⚠ ' +
      escapeHtml(
        err.message
      ) +
      '</div>';
  }
}

async function addAutoReply() {

  if (!currentKey) {
    return;
  }

  const keyword =
    arKeyword.value.trim();

  const reply =
    arReply.value.trim();

  const image =
    arImage.value.trim();

  arMsg.style.display =
    'none';

  if (!keyword) {

    arMsg.textContent =
      '⚠ Keyword eka danna';

    arMsg.className =
      'msg err';

    arMsg.style.display =
      'block';

    return;
  }

  if (!reply && !image) {

    arMsg.textContent =
      '⚠ Reply text ekak nathnam image ekak danna';

    arMsg.className =
      'msg err';

    arMsg.style.display =
      'block';

    return;
  }

  const addBtn =
    document.getElementById(
      'arAddBtn'
    );

  addBtn.disabled =
    true;

  addBtn.textContent =
    '⏳ Saving...';

  try {

    const res =
      await fetch(
        '/api/auto-replies/' +
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
            JSON.stringify({
              keyword,
              reply,
              image
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

    arMsg.textContent =
      '✅ Auto-reply saved!';

    arMsg.className =
      'msg ok';

    arMsg.style.display =
      'block';

    arKeyword.value =
      '';

    arReply.value =
      '';

    arImage.value =
      '';

    loadAutoReplies();

  } catch (err) {

    arMsg.textContent =
      '⚠ ' +
      err.message;

    arMsg.className =
      'msg err';

    arMsg.style.display =
      'block';

  } finally {

    addBtn.disabled =
      false;

    addBtn.textContent =
      '➕ Add / Update Reply';
  }
}

async function deleteAutoReply(
  keyword
) {

  if (!currentKey) {
    return;
  }

  try {

    await fetch(
      '/api/auto-replies/' +
      encodeURIComponent(
        currentKey
      ) +
      '/' +
      encodeURIComponent(
        keyword
      ),
      {
        method: 'DELETE'
      }
    );

    loadAutoReplies();

  } catch (err) {

    console.error(
      'Delete failed:',
      err
    );
  }
}

document
  .getElementById(
    'arAddBtn'
  )
  .addEventListener(
    'click',
    addAutoReply
  );

</script>

</body>
</html>`);

  }
);

/* =========================================================
   HOME / ANALYTICS DASHBOARD
========================================================= */

app.get(
  '/',
  (req, res) => {

    res.set(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );

    res.send(`<!DOCTYPE html>
<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>
  Shaggy Bot Analytics
</title>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>

<style>

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {

  --green:
    #25d366;

  --green2:
    #34d399;

  --blue:
    #60a5fa;

  --purple:
    #a78bfa;

  --red:
    #f87171;

  --yellow:
    #fbbf24;

  --bg:
    #020617;

  --text:
    #e2e8f0;

  --muted:
    #94a3b8;

  --border:
    rgba(255,255,255,.08);

}

body {

  font-family:
    'Segoe UI',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;

  color:
    var(--text);

  min-height:
    100vh;

  padding:
    24px 15px;

  background:

    radial-gradient(
      circle at 5% 0%,
      rgba(37,211,102,.11),
      transparent 28%
    ),

    radial-gradient(
      circle at 95% 10%,
      rgba(96,165,250,.12),
      transparent 30%
    ),

    radial-gradient(
      circle at 50% 100%,
      rgba(167,139,250,.09),
      transparent 35%
    ),

    #020617;

  overflow-x:
    hidden;
}

/* =========================================================
   INTRO
========================================================= */

#intro {

  position:
    fixed;

  inset:
    0;

  z-index:
    99999;

  display:
    flex;

  align-items:
    center;

  justify-content:
    center;

  background:
    #020617;

  transition:
    opacity .8s ease,
    visibility .8s ease;
}

#intro.hide {

  opacity:
    0;

  visibility:
    hidden;
}

.introBox {

  text-align:
    center;

  animation:
    introFloat 2s infinite;
}

.introLogo {

  width:
    82px;

  height:
    82px;

  border-radius:
    25px;

  display:
    flex;

  align-items:
    center;

  justify-content:
    center;

  margin:
    auto;

  font-size:
    40px;

  background:
    linear-gradient(
      135deg,
      #25d366,
      #60a5fa,
      #a78bfa
    );

  box-shadow:
    0 0 70px
    rgba(37,211,102,.22);
}

.introTitle {

  margin-top:
    17px;

  font-weight:
    900;

  letter-spacing:
    1px;
}

.introSub {

  color:
    #64748b;

  font-size:
    11px;

  margin-top:
    5px;
}

.introLoader {

  width:
    180px;

  height:
    4px;

  margin:
    15px auto 0;

  border-radius:
    10px;

  background:
    rgba(255,255,255,.07);

  overflow:
    hidden;
}

.introLoader span {

  display:
    block;

  width:
    45%;

  height:
    100%;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa,
      #a78bfa
    );

  animation:
    loaderMove 1.2s infinite;
}

@keyframes loaderMove {

  0% {
    transform:
      translateX(-120%);
  }

  100% {
    transform:
      translateX(430%);
  }
}

@keyframes introFloat {

  0%,100% {
    transform:
      translateY(0);
  }

  50% {
    transform:
      translateY(-7px);
  }
}

/* =========================================================
   WRAPPER
========================================================= */

.wrap {

  max-width:
    1200px;

  margin:
    0 auto;
}

/* =========================================================
   HEADER
========================================================= */

.header {

  display:
    flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap:
    20px;

  margin-bottom:
    20px;
}

.title {

  font-size:
    26px;

  font-weight:
    900;

  background:
    linear-gradient(
      90deg,
      #25d366,
      #60a5fa,
      #a78bfa
    );

  -webkit-background-clip:
    text;

  background-clip:
    text;

  color:
    transparent;
}

.subtitle {

  color:
    var(--muted);

  font-size:
    12px;

  margin-top:
    5px;
}

.nav {

  display:
    flex;

  gap:
    8px;

  flex-wrap:
    wrap;
}

.nav a {

  color:
    #cbd5e1;

  text-decoration:
    none;

  font-size:
    12px;

  padding:
    9px 12px;

  border:
    1px solid
    var(--border);

  border-radius:
    10px;

  background:
    rgba(255,255,255,.04);

  transition:
    .2s;
}

.nav a:hover {

  background:
    rgba(255,255,255,.08);

  transform:
    translateY(-1px);
}

/* =========================================================
   LIVE STATUS
========================================================= */

.live {

  display:
    inline-flex;

  align-items:
    center;

  gap:
    7px;

  color:
    #34d399;

  font-size:
    11px;

  margin-top:
    8px;
}

.liveDot {

  width:
    8px;

  height:
    8px;

  border-radius:
    50%;

  background:
    #34d399;

  box-shadow:
    0 0 12px
    #34d399;

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

/* =========================================================
   STATS
========================================================= */

.stats {

  display:
    grid;

  grid-template-columns:
    repeat(4, minmax(0,1fr));

  gap:
    12px;

  margin-bottom:
    15px;
}

.stat {

  position:
    relative;

  overflow:
    hidden;

  padding:
    18px;

  border:
    1px solid
    var(--border);

  border-radius:
    17px;

  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.065),
      rgba(255,255,255,.025)
    );

  backdrop-filter:
    blur(14px);

  box-shadow:
    0 20px 50px
    rgba(0,0,0,.18);

  animation:
    cardIn .6s ease;
}

.stat:after {

  content:
    '';

  position:
    absolute;

  width:
    100px;

  height:
    100px;

  border-radius:
    50%;

  right:
    -50px;

  top:
    -50px;

  background:
    rgba(255,255,255,.04);
}

.statLabel {

  color:
    var(--muted);

  font-size:
    11px;

  margin-bottom:
    8px;
}

.statValue {

  font-size:
    29px;

  font-weight:
    900;
}

.green {
  color:
    var(--green2);
}

.blue {
  color:
    var(--blue);
}

.purple {
  color:
    var(--purple);
}

.yellow {
  color:
    var(--yellow);
}

.statSub {

  color:
    #64748b;

  font-size:
    10px;

  margin-top:
    5px;
}

@keyframes cardIn {

  from {
    opacity: 0;
    transform:
      translateY(10px);
  }

  to {
    opacity: 1;
    transform:
      translateY(0);
  }
}

/* =========================================================
   CHART GRID
========================================================= */

.chartGrid {

  display:
    grid;

  grid-template-columns:
    repeat(2, minmax(0,1fr));

  gap:
    15px;
}

.chartCard {

  padding:
    17px;

  min-height:
    370px;

  border:
    1px solid
    var(--border);

  border-radius:
    19px;

  background:
    rgba(255,255,255,.04);

  backdrop-filter:
    blur(15px);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.20);
}

.chartTitle {

  font-size:
    14px;

  font-weight:
    800;

  margin-bottom:
    3px;
}

.chartSub {

  color:
    var(--muted);

  font-size:
    10px;

  margin-bottom:
    12px;
}

.chartCanvas {

  height:
    290px;

  position:
    relative;
}

/* =========================================================
   ANALYTICS TABLE
========================================================= */

.analytics {

  margin-top:
    15px;

  display:
    grid;

  grid-template-columns:
    repeat(4, minmax(0,1fr));

  gap:
    10px;
}

.analyticsBox {

  padding:
    14px;

  border:
    1px solid
    var(--border);

  border-radius:
    14px;

  background:
    rgba(255,255,255,.035);
}

.analyticsLabel {

  font-size:
    10px;

  color:
    var(--muted);
}

.analyticsValue {

  font-size:
    18px;

  font-weight:
    800;

  margin-top:
    5px;
}

/* =========================================================
   FOOTER
========================================================= */

.footer {

  text-align:
    center;

  color:
    #475569;

  font-size:
    10px;

  margin-top:
    22px;
}

.error {

  display:
    none;

  margin-top:
    12px;

  color:
    #f87171;

  font-size:
    12px;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media(max-width:850px) {

  .stats {

    grid-template-columns:
      repeat(2,1fr);
  }

  .chartGrid {

    grid-template-columns:
      1fr;
  }

  .analytics {

    grid-template-columns:
      repeat(2,1fr);
  }

  .header {

    flex-direction:
      column;

    align-items:
      flex-start;
  }
}

@media(max-width:500px) {

  body {
    padding:
      17px 10px;
  }

  .title {
    font-size:
      22px;
  }

  .stats {

    grid-template-columns:
      1fr 1fr;

    gap:
      8px;
  }

  .stat {
    padding:
      14px;
  }

  .statValue {
    font-size:
      23px;
  }

  .analytics {

    grid-template-columns:
      1fr 1fr;
  }

  .chartCard {

    min-height:
      330px;

    padding:
      13px;
  }

  .chartCanvas {

    height:
      250px;
  }
}

</style>

</head>

<body>

<!-- INTRO -->

<div id="intro">

  <div class="introBox">

    <div class="introLogo">
      🤖
    </div>

    <div class="introTitle">
      SHAGGY BOT ANALYTICS
    </div>

    <div class="introSub">
      Initializing live monitoring...
    </div>

    <div class="introLoader">
      <span></span>
    </div>

  </div>

</div>

<div class="wrap">

  <div class="header">

    <div>

      <div class="title">
        🤖 Shaggy Bot Analytics
      </div>

      <div class="subtitle">
        Live bot monitoring & 24-hour performance analytics
      </div>

      <div class="live">
        <span class="liveDot"></span>
        LIVE MONITORING
        <span id="lastUpdate"></span>
      </div>

    </div>

    <div class="nav">

      <a href="/manage">
        ⚙ Manage
      </a>

      <a href="${PAIR_WEB_URL}" target="_blank">
        🔗 Pair Web
      </a>

    </div>

  </div>

  <!-- STATS -->

  <div class="stats">

    <div class="stat">

      <div class="statLabel">
        ONLINE BOTS
      </div>

      <div
        class="statValue green"
        id="onlineVal"
      >
        --
      </div>

      <div class="statSub">
        Currently active
      </div>

    </div>

    <div class="stat">

      <div class="statLabel">
        TOTAL BOTS
      </div>

      <div
        class="statValue blue"
        id="totalVal"
      >
        --
      </div>

      <div class="statSub">
        Registered bots
      </div>

    </div>

    <div class="stat">

      <div class="statLabel">
        AVAILABILITY
      </div>

      <div
        class="statValue purple"
        id="percentageVal"
      >
        --%
      </div>

      <div class="statSub">
        Online / Total
      </div>

    </div>

    <div class="stat">

      <div class="statLabel">
        PEAK ONLINE
      </div>

      <div
        class="statValue yellow"
        id="peakVal"
      >
        --
      </div>

      <div class="statSub">
        Last 24 hours
      </div>

    </div>

  </div>

  <!-- CHARTS -->

  <div class="chartGrid">

    <div class="chartCard">

      <div class="chartTitle">
        📈 Bot Count Trend
      </div>

      <div class="chartSub">
        Online vs Total bots — last 24 hours
      </div>

      <div class="chartCanvas">
        <canvas id="countChart"></canvas>
      </div>

    </div>

    <div class="chartCard">

      <div class="chartTitle">
        ⚡ Availability Trend
      </div>

      <div class="chartSub">
        Online availability percentage — last 24 hours
      </div>

      <div class="chartCanvas">
        <canvas id="availabilityChart"></canvas>
      </div>

    </div>

  </div>

  <!-- EXTRA ANALYTICS -->

  <div class="analytics">

    <div class="analyticsBox">

      <div class="analyticsLabel">
        AVG ONLINE
      </div>

      <div
        class="analyticsValue green"
        id="avgOnline"
      >
        --
      </div>

    </div>

    <div class="analyticsBox">

      <div class="analyticsLabel">
        AVG TOTAL
      </div>

      <div
        class="analyticsValue blue"
        id="avgTotal"
      >
        --
      </div>

    </div>

    <div class="analyticsBox">

      <div class="analyticsLabel">
        AVG AVAILABILITY
      </div>

      <div
        class="analyticsValue purple"
        id="avgAvailability"
      >
        --%
      </div>

    </div>

    <div class="analyticsBox">

      <div class="analyticsLabel">
        MIN ONLINE
      </div>

      <div
        class="analyticsValue yellow"
        id="minOnline"
      >
        --
      </div>

    </div>

  </div>

  <div
    class="error"
    id="errorBox"
  ></div>

  <div class="footer">
    Shaggy Bot Control Center • Live analytics
  </div>

</div>

<script>

/* =========================================================
   INTRO
========================================================= */

window.addEventListener(
  'load',
  function() {

    setTimeout(
      function() {

        document
          .getElementById(
            'intro'
          )
          .classList
          .add('hide');

      },
      1000
    );

  }
);

/* =========================================================
   CHARTS
========================================================= */

let countChart =
  null;

let availabilityChart =
  null;

const errorBox =
  document.getElementById(
    'errorBox'
  );

function chartCommonOptions(
  beginAtZero
) {

  return {

    responsive:
      true,

    maintainAspectRatio:
      false,

    interaction: {
      mode:
        'index',

      intersect:
        false
    },

    animation: {
      duration:
        350
    },

    scales: {

      x: {

        ticks: {
          color:
            '#94a3b8',

          maxTicksLimit:
            8,

          maxRotation:
            0
        },

        grid: {
          color:
            'rgba(255,255,255,.045)'
        }

      },

      y: {

        beginAtZero:
          beginAtZero,

        ticks: {
          color:
            '#94a3b8'
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
            15
        }

      }

    }

  };
}

function createCharts() {

  if (
    typeof Chart ===
    'undefined'
  ) {

    errorBox.textContent =
      '⚠ Chart library load wenne na.';

    errorBox.style.display =
      'block';

    return false;
  }

  const countCtx =
    document
      .getElementById(
        'countChart'
      )
      .getContext('2d');

  const availabilityCtx =
    document
      .getElementById(
        'availabilityChart'
      )
      .getContext('2d');

  countChart =
    new Chart(
      countCtx,
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
                '#34d399',

              backgroundColor:
                'rgba(52,211,153,.10)',

              borderWidth:
                2,

              pointRadius:
                1,

              pointHoverRadius:
                5,

              tension:
                .35,

              fill:
                true

            },

            {

              label:
                'Total Bots',

              data: [],

              borderColor:
                '#60a5fa',

              backgroundColor:
                'rgba(96,165,250,.05)',

              borderWidth:
                2,

              pointRadius:
                1,

              pointHoverRadius:
                5,

              tension:
                .35,

              fill:
                false

            }

          ]

        },

        options:
          chartCommonOptions(
            true
          )

      }
    );

  availabilityChart =
    new Chart(
      availabilityCtx,
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
                '#a78bfa',

              backgroundColor:
                'rgba(167,139,250,.12)',

              borderWidth:
                2,

              pointRadius:
                1,

              pointHoverRadius:
                5,

              tension:
                .35,

              fill:
                true

            }

          ]

        },

        options: {

          ...chartCommonOptions(
            true
          ),

          scales: {

            x: {

              ticks: {
                color:
                  '#94a3b8',

                maxTicksLimit:
                  8,

                maxRotation:
                  0
              },

              grid: {
                color:
                  'rgba(255,255,255,.045)'
              }

            },

            y: {

              beginAtZero:
                true,

              max:
                100,

              ticks: {

                color:
                  '#94a3b8',

                callback:
                  function(value) {
                    return value + '%';
                  }

              },

              grid: {
                color:
                  'rgba(255,255,255,.045)'
              }

            }

          }

        }

      }
    );

  return true;
}

/* =========================================================
   LIVE DATA
========================================================= */

async function updateLiveStats() {

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

    document
      .getElementById(
        'onlineVal'
      )
      .textContent =
        data.online;

    document
      .getElementById(
        'totalVal'
      )
      .textContent =
        data.total;

    document
      .getElementById(
        'percentageVal'
      )
      .textContent =
        Number(
          data.percentage || 0
        ).toFixed(1) +
        '%';

    document
      .getElementById(
        'lastUpdate'
      )
      .textContent =
        ' • ' +
        new Date(
          data.time
        ).toLocaleTimeString(
          'en-GB'
        );

    errorBox.style.display =
      'none';

  } catch (err) {

    console.error(
      'Live stats:',
      err
    );

    errorBox.textContent =
      '⚠ Live data load error: ' +
      err.message;

    errorBox.style.display =
      'block';
  }
}

/* =========================================================
   ANALYTICS
========================================================= */

async function updateAnalytics() {

  try {

    const res =
      await fetch(
        '/api/analytics?hours=24',
        {
          cache:
            'no-store'
        }
      );

    if (!res.ok) {
      throw new Error(
        'Analytics server error: ' +
        res.status
      );
    }

    const data =
      await res.json();

    const points =
      data.points || [];

    const labels =
      points.map(
        function(p) {

          return new Date(
            p.time
          ).toLocaleTimeString(
            'en-GB',
            {
              hour:
                '2-digit',

              minute:
                '2-digit'
            }
          );

        }
      );

    if (
      countChart
    ) {

      countChart.data.labels =
        labels;

      countChart
        .data
        .datasets[0]
        .data =
          points.map(
            p =>
              p.online
          );

      countChart
        .data
        .datasets[1]
        .data =
          points.map(
            p =>
              p.total
          );

      countChart.update(
        'none'
      );
    }

    if (
      availabilityChart
    ) {

      availabilityChart
        .data
        .labels =
          labels;

      availabilityChart
        .data
        .datasets[0]
        .data =
          points.map(
            p =>
              p.percentage
          );

      availabilityChart.update(
        'none'
      );
    }

    const summary =
      data.summary || {};

    document
      .getElementById(
        'peakVal'
      )
      .textContent =
        Number(
          summary.peakOnline ||
          0
        ).toFixed(0);

    document
      .getElementById(
        'avgOnline'
      )
      .textContent =
        Number(
          summary.averageOnline ||
          0
        ).toFixed(1);

    document
      .getElementById(
        'avgTotal'
      )
      .textContent =
        Number(
          summary.averageTotal ||
          0
        ).toFixed(1);

    document
      .getElementById(
        'avgAvailability'
      )
      .textContent =
        Number(
          summary.averageAvailability ||
          0
        ).toFixed(1) +
        '%';

    document
      .getElementById(
        'minOnline'
      )
      .textContent =
        Number(
          summary.minOnline ||
          0
        ).toFixed(0);

  } catch (err) {

    console.error(
      'Analytics:',
      err
    );

    errorBox.textContent =
      '⚠ Analytics load error: ' +
      err.message;

    errorBox.style.display =
      'block';
  }
}

/* =========================================================
   INIT
========================================================= */

const chartsReady =
  createCharts();

updateLiveStats();

updateAnalytics();

/*
  Live cards:
  every 5 seconds

  Historical charts:
  every 30 seconds

  This keeps the dashboard live
  without hammering MongoDB.
*/

setInterval(
  updateLiveStats,
  5000
);

setInterval(
  updateAnalytics,
  30000
);

</script>

</body>
</html>`);

  }
);

/* =========================================================
   START SERVER
========================================================= */

connectDB()

  .then(
    async () => {

      /*
        Save first analytics snapshot
        when server starts.
      */

      await saveMetricsSnapshot();

      /*
        Save one snapshot every 60 seconds.

        IMPORTANT:
        Dashboard refresh 5 sec කියලා
        MongoDB එකට 5 sec마다 metrics
        write කරන්නේ නැහැ.
      */

      setInterval(
        saveMetricsSnapshot,
        60 * 1000
      );

      app.listen(
        PORT,
        () => {

          console.log(
            `🚀 Server running on port ${PORT}`
          );

          console.log(
            `⚙ Manage page: /manage`
          );

          console.log(
            `📊 Analytics page: /`
          );

          console.log(
            `🔗 Pair Web: ${PAIR_WEB_URL}`
          );

          console.log(
            `⏱ Online threshold: ${ONLINE_THRESHOLD_MINUTES} minutes`
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
