import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT || 8787);
const HOST = '127.0.0.1';

app.use(cors({ origin: true, credentials: true }));
app.options('*', cors());

app.use(express.json({ limit: '50mb' }));

// Simple request log (helps confirm the UI is hitting the API)
app.use((req, res, next) => {
  console.log('[' + new Date().toISOString() + '] ' + req.method + ' ' + req.url);
  next();
});

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'radiology-ai-viewer-api', host: HOST, port: PORT });
});

// Common endpoints
const paths = ['/analyze','/api/analyze','/predict','/api/predict'];
app.post(paths, (req, res) => {
  res.json({
    ok: true,
    note: 'Stub API response (replace with real inference later)',
    path: req.path,
    receivedKeys: req.body ? Object.keys(req.body) : [],
    results: [{ label: 'API connectivity', score: 1.0 }]
  });
});

// Catch-all POST (if the UI calls a different route)
app.post('*', (req, res) => {
  res.json({
    ok: true,
    note: 'Catch-all stub (UI called an unexpected path)',
    path: req.path,
    receivedKeys: req.body ? Object.keys(req.body) : [],
    results: [{ label: 'API connectivity', score: 1.0 }]
  });
});

app.listen(PORT, HOST, () => {
  console.log('AI API listening on http://' + HOST + ':' + PORT);
  console.log('Health: http://' + HOST + ':' + PORT + '/health');
});
