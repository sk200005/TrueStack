'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorHandler');

// Routes
const authRoutes = require('./routes/auth.routes');
const queryRoutes = require('./routes/query.routes');
const reportRoutes = require('./routes/report.routes');

// @deprecated — In-memory job worker replaced by Python FastAPI service (backend-python).
// Retained for emergency rollback. To re-enable, uncomment and update query.controller.js.
// const { startWorker } = require('./workers/researchWorker');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());     //Converts incoming JSON into a JavaScript object.

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'backend-node' }));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/reports', reportRoutes);

// ── Centralised Error Handler (must be last) ──────────────────────────────────
app.use(errorHandler);

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {                                                      // Starts listening for incoming requests.
  console.log(`[backend-node] Server running on http://localhost:${PORT}`);
  console.log(`[backend-node] Jobs are now forwarded to Python service at ${process.env.PYTHON_SERVICE_URL || 'http://localhost:8000'}`);
  // @deprecated — startWorker() no longer called. See researchWorker.js.
});

module.exports = app;
