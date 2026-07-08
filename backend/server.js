require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const musicRoutes = require('./routes/music');
const neteaseRoutes = require('./routes/netease').router;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/music', musicRoutes);
app.use('/api/music', neteaseRoutes);

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Sonus API running on port ${PORT}`);
});
