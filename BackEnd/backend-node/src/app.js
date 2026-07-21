'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth.routes');
const queryRoutes = require('./routes/query.routes');
const reportRoutes = require('./routes/report.routes');

// In-memory job worker — starts processing the queue as soon as the server boots
const { startWorker } = require('./workers/researchWorker');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'backend-node' }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/reports', reportRoutes);

// ── Centralised Error Handler (must be last) ──────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[backend-node] Server running on http://localhost:${PORT}`);
  // Start the in-memory research worker after the server is bound
  startWorker();
});

module.exports = app;
