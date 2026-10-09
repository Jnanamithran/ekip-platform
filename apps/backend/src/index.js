require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('EKIP backend is alive!');
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ekip-backend' });
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});