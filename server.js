require('dotenv').config();
const express = require('express');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'test';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'sessions';
const TIMESTAMP_FIELD = process.env.TIMESTAMP_FIELD || 'lastSeen';
const ONLINE_THRESHOLD_MINUTES = Number(process.env.ONLINE_THRESHOLD_MINUTES || 2);

if (!MONGODB_URI) {
  console.error('MONGODB_URI .env file eke danna one!');
  process.exit(1);
}

let collection;

async function connectDB() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(DB_NAME);
  collection = db.collection(COLLECTION_NAME);
  console.log(`✅ MongoDB connected -> ${DB_NAME}.${COLLECTION_NAME}`);
}

// Bot count eka gannawa - online / total
app.get('/api/online-count', async (req, res) => {
  try {
    const thresholdDate = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60 * 1000);
    const [onlineCount, totalCount] = await Promise.all([
      collection.countDocuments({ [TIMESTAMP_FIELD]: { $gte: thresholdDate } }),
      collection.countDocuments({})
    ]);
    res.json({ online: onlineCount, total: totalCount, time: new Date().toISOString() });
  } catch (err) {
    console.error('Query error:', err.message);
    res.status(500).json({ error: 'Data ganna bari una' });
  }
});

// Chart page eka (single file - inline HTML)
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html lang="si">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bot Online Monitor</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script>
  // cdn ekak fail unoth wenath cdn ekakin try karanawa (fallback)
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
    color: #e2e8f0;
    min-height: 100vh;
    padding: 24px 16px;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 {
    font-size: 22px;
    font-weight: 700;
    background: linear-gradient(90deg, #34d399, #60a5fa);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    margin-bottom: 4px;
  }
  .sub { color: #94a3b8; font-size: 13px; margin-bottom: 20px; }
  .stats {
    display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;
  }
  .card {
    flex: 1; min-width: 130px;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 16px;
    backdrop-filter: blur(8px);
  }
  .card .label { font-size: 12px; color: #94a3b8; margin-bottom: 6px; }
  .card .value { font-size: 26px; font-weight: 700; }
  .online .value { color: #34d399; }
  .total .value { color: #60a5fa; }
  .chart-box {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
    padding: 16px;
    height: 380px;
  }
  .status-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: #34d399; margin-right: 6px;
    box-shadow: 0 0 8px #34d399;
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .err { color: #f87171; font-size: 13px; margin-top: 10px; display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🤖 Bot Online Monitor</h1>
  <div class="sub"><span class="status-dot"></span>Live - real-time update</div>

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

  // Chart.js load wela nathnam mekata error ekak enawa,
  // eth eka baseline numbers update wena logic eka nawaththanna ba widihata try/catch ekak dala thiyenne
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
          tension: 0.35,
          fill: true,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: {
            beginAtZero: true,
            ticks: { color: '#94a3b8', stepSize: 1 },
            grid: { color: 'rgba(255,255,255,0.05)' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e2e8f0' } }
        }
      }
    });
  } catch (chartErr) {
    console.error('Chart.js init failed:', chartErr);
    errBox.textContent = '⚠ Chart library load wenne na, eth numbers update wenawa';
    errBox.style.display = 'block';
  }

  async function fetchData() {
    try {
      const res = await fetch('/api/online-count', { cache: 'no-store' });
      if (!res.ok) throw new Error('Server error: ' + res.status);
      const data = await res.json();

      document.getElementById('onlineVal').textContent = data.online;
      document.getElementById('totalVal').textContent = data.total;
      if (chart) errBox.style.display = 'none';

      if (chart) {
        const label = new Date(data.time).toLocaleTimeString('en-GB');
        chart.data.labels.push(label);
        chart.data.datasets[0].data.push(data.online);

        if (chart.data.labels.length > MAX_POINTS) {
          chart.data.labels.shift();
          chart.data.datasets[0].data.shift();
        }
        chart.update();
      }
    } catch (e) {
      console.error('fetchData failed:', e);
      errBox.textContent = '⚠ Data load karanna baruwa: ' + e.message;
      errBox.style.display = 'block';
    }
  }

  fetchData();
  setInterval(fetchData, 5000); // 5 seconds ekakata thawa point ekak
</script>
</body>
</html>`);
});

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 Server running: http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
