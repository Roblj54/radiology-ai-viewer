const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8787;

// Allow the Vite dev server origin. Add more origins if needed.
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];

// Enable CORS (handles preflight too)
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // allow tools like curl/postman
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS blocked for origin: ' + origin));
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.use(express.json({ limit: '50mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'radiology-ai-viewer-api', port: PORT });
});

// Accept several common paths so your UI will hit one of them
const handlers = ['/analyze','/api/analyze','/predict','/api/predict'];

app.post(handlers, (req, res) => {
  // Stub response that proves connectivity + CORS. Replace with real inference later.
  res.json({
    ok: true,
    note: 'Stub API response (replace with real model inference later)',
    receivedKeys: req.body ? Object.keys(req.body) : [],
    results: [
      { label: 'API connectivity', score: 1.0 }
    ]
  });
});

app.listen(PORT, () => {
  console.log('AI API listening on http://localhost:' + PORT);
  console.log('Health: http://localhost:' + PORT + '/health');
});
