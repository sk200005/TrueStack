'use strict';

const express = require('express');
const { authenticate } = require('../middleware/authenticate');
const { listReports, getReport, deleteReport } = require('../controllers/report.controller');

const router = express.Router();

// All report routes require authentication
router.use(authenticate);

// GET /api/reports — list all reports for the authenticated user
router.get('/', listReports);

// GET /api/reports/:reportId — get one full report
router.get('/:reportId', getReport);

// DELETE /api/reports/:reportId — delete a report
router.delete('/:reportId', deleteReport);

module.exports = router;
