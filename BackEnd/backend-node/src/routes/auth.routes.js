'use strict';

const express = require('express');
const { signup, login } = require('../controllers/auth.controller');

const router = express.Router();

// POST /api/auth/signup
router.post('/signup', signup);

// POST /api/auth/login
router.post('/login', login);

module.exports = router;
