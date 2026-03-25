const express = require('express');
const cors = require('cors');
const path = require('path');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const friendsRouter = require('./routes/friends');
const groupsRouter = require('./routes/groups');
const uploadRouter = require('./routes/upload');
const messagesRouter = require('./routes/messages');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/friends', friendsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/messages', messagesRouter);

// Serve client build (for production)
app.use(express.static(path.join(__dirname, '../../client')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

module.exports = app;
