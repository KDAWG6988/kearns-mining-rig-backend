require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
// CORS allowlist: the game frontend origins only. Override with CORS_ORIGINS (comma-separated).
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://kearns6988.com,https://www.kearns6988.com,https://kearns-mining-rig.vercel.app,capacitor://localhost,http://localhost').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

// Light rate limiting on auth endpoints (brute-force protection).
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth/', authLimiter);

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// Never run in production with the placeholder secret.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}
const DB_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// ---------- Tiny JSON-file data store ----------
// The original BACKEND_API.md spec used MongoDB. This implementation uses a
// JSON file so it runs anywhere with zero infrastructure. To migrate to Mongo,
// swap the load/save helpers below for Mongoose calls (schemas in BACKEND_API.md).
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { return { users: {}, withdrawals: [], referrals: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
const db = loadDB();

// ---------- Auth helpers ----------
function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ detail: 'Access denied', reason: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(403).json({ detail: 'Access denied', reason: 'Invalid or expired token' });
  }
}
function findUser(username) { return db.users[username]; }
function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

// ---------- Routes ----------
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), users: Object.keys(db.users).length });
});

app.post('/api/auth/register', async (req, res) => {
  const { username, password, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  if (findUser(username)) return res.status(409).json({ error: 'username already taken' });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    username, email: email || null, passwordHash,
    createdAt: new Date().toISOString(),
    progress: null, isPremium: false, premiumTier: null,
    referralCode: 'REF' + Math.random().toString(36).slice(2, 10).toUpperCase(),
    referredBy: req.body.referredBy || null,
    referralCount: 0, referralEarnings: 0
  };
  db.users[username] = user;
  if (user.referredBy && db.users[user.referredBy]) db.users[user.referredBy].referralCount += 1;
  saveDB(db);
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(username);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: publicUser(user) });
});

app.get('/api/user/profile', verifyToken, (req, res) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ user: publicUser(user) });
});

app.post('/api/user/progress', verifyToken, (req, res) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const progress = req.body || {};
  if (typeof progress !== 'object' || Array.isArray(progress)) return res.status(400).json({ error: 'progress must be an object' });
  for (const key of ['ore', 'level']) {
    if (progress[key] !== undefined && (typeof progress[key] !== 'number' || !Number.isFinite(progress[key]) || progress[key] < 0)) {
      return res.status(400).json({ error: `${key} must be a non-negative number` });
    }
  }
  user.progress = progress;
  user.progressSavedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true, savedAt: user.progressSavedAt });
});

app.get('/api/user/progress', verifyToken, (req, res) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  res.json({ progress: user.progress, savedAt: user.progressSavedAt || null });
});

app.post('/api/premium/subscribe', verifyToken, (req, res) => {
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const { tier } = req.body || {};
  if (!['bronze', 'silver', 'gold'].includes(tier)) return res.status(400).json({ error: 'tier must be bronze|silver|gold' });
  user.isPremium = true;
  user.premiumTier = tier;
  user.premiumSince = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true, isPremium: true, tier });
});

app.post('/api/withdraw', verifyToken, (req, res) => {
  const { amount, btcWallet } = req.body || {};
  const user = findUser(req.user.username);
  if (!user) return res.status(404).json({ error: 'user not found' });
  if (!amount || amount < 0.001) return res.status(400).json({ error: 'minimum withdrawal is 0.001 BTC' });
  if (!btcWallet || btcWallet.length < 20) return res.status(400).json({ error: 'valid btcWallet required' });
  const withdrawal = {
    id: 'WD' + Date.now(), username: user.username, amount, btcWallet,
    status: 'pending', requestedAt: new Date().toISOString()
  };
  db.withdrawals.push(withdrawal);
  saveDB(db);
  res.status(202).json({ ok: true, withdrawal });
});

app.get('/api/withdrawals/history', verifyToken, (req, res) => {
  res.json({ withdrawals: db.withdrawals.filter(w => w.username === req.user.username) });
});

app.get('/api/referral/link', verifyToken, (req, res) => {
  const user = findUser(req.user.username);
  res.json({ link: `https://kearns-mining-rig.vercel.app?ref=${user.referralCode}`, code: user.referralCode, count: user.referralCount });
});

app.get('/api/leaderboard', (req, res) => {
  const rows = Object.values(db.users)
    .map(u => ({ username: u.username, level: u.progress?.level || 1, ore: u.progress?.ore || 0 }))
    .sort((a, b) => b.ore - a.ore).slice(0, 25);
  res.json({ leaderboard: rows });
});

app.listen(PORT, () => console.log(`Kearns Mining Rig backend listening on http://localhost:${PORT}`));
