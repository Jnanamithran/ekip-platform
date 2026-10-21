require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const frontendOrigins = (
  process.env.FRONTEND_ORIGINS ||
  process.env.FRONTEND_ORIGIN ||
  'http://localhost:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(express.json());
app.use(cors({ origin: frontendOrigins }));

// Authentication and RBAC routes
app.use('/auth', require('./routes/auth.routes'));
app.use('/admin', require('./routes/admin.routes'));
app.use('/roles', require('./routes/roles.routes'));
app.use('/organizations', require('./routes/organization.routes'));
app.use('/integrations', require('./routes/integrations.routes'));
// AI service proxy routes (query, ingest, health)
app.use('/ai', require('./routes/ai.routes'));

app.get('/', (req, res) => {
  res.send('EKIP backend is alive!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ekip-backend' });
});

// Exported without listening so tests can load the app directly (e.g. with supertest)
module.exports = app;
