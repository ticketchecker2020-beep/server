/**
 * Beitar Jerusalem Ticket Notification Server
 * Handles SMS and Email notifications for ticket availability
 * With usage tracking and admin dashboard
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Upstash Redis for persistent storage (survives deploys!)
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
  console.log('✅ Upstash Redis configured - data will persist!');
} else {
  console.log('⚠️ Upstash Redis not configured - using local file (data will be lost on deploy)');
}

const app = express();
const PORT = process.env.PORT || 3000;

// Server version - UPDATE THIS ON EACH DEPLOY!
const SERVER_VERSION = '2.9.0';
const VERSION_DATE = '2026-01-25';
const VERSION_NOTES = 'חדש: אתר עצמאי עם proxy למשחקים והרשמה';

// ============================================
// 📝 LOGGING SYSTEM
// ============================================
const MAX_LOGS = 500; // Keep last 500 logs in memory
const serverLogs = [];

function addLog(level, category, message, details = null) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level, // 'info', 'warn', 'error', 'success'
    category, // 'system', 'email', 'sms', 'tickets', 'license', 'subscriber', 'api'
    message,
    details
  };
  
  serverLogs.unshift(logEntry); // Add to beginning (newest first)
  
  // Keep only last MAX_LOGS
  if (serverLogs.length > MAX_LOGS) {
    serverLogs.length = MAX_LOGS;
  }
  
  // Also log to console with emoji
  const emoji = {
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
    success: '✅'
  }[level] || '📝';
  
  console.log(`${emoji} [${category.toUpperCase()}] ${message}`, details ? JSON.stringify(details).substring(0, 200) : '');
}

// Helper functions for different log levels
const log = {
  info: (category, message, details) => addLog('info', category, message, details),
  warn: (category, message, details) => addLog('warn', category, message, details),
  error: (category, message, details) => addLog('error', category, message, details),
  success: (category, message, details) => addLog('success', category, message, details)
};

// Data file for fallback storage
const DATA_FILE = path.join(__dirname, 'data.json');
const REDIS_KEY = 'beitar:data';

// Load data from Redis or local file
async function loadData() {
  // Try Redis first
  if (redis) {
    try {
      const redisData = await redis.get(REDIS_KEY);
      if (redisData) {
        console.log('📦 Data loaded from Redis');
        return typeof redisData === 'string' ? JSON.parse(redisData) : redisData;
      }
    } catch (e) {
      console.error('❌ Redis load error:', e.message);
    }
  }
  
  // Fallback to local file
  try {
    if (fs.existsSync(DATA_FILE)) {
      console.log('📦 Data loaded from local file');
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  
  // Return default data structure
  return {
    usage: {
      emailsSent: 0,
      smsSent: 0,
      emailsFailed: 0,
      smsFailed: 0,
      history: []
    },
    licenses: {},
    apiKeys: {},
    subscribers: {},
    lastTicketCheck: null,
    lastKnownGames: []
  };
}

// Save data to Redis and local file
async function saveData() {
  // Save to Redis
  if (redis) {
    try {
      await redis.set(REDIS_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('❌ Redis save error:', e.message);
    }
  }
  
  // Also save to local file as backup
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving data:', e.message);
  }
}

// Initialize data (will be loaded async)
let data = {
  usage: { emailsSent: 0, smsSent: 0, emailsFailed: 0, smsFailed: 0, history: [] },
  licenses: {},
  apiKeys: {},
  subscribers: {},
  lastTicketCheck: null,
  lastKnownGames: []
};

// Load data on startup
(async () => {
  data = await loadData();
  log.info('system', `שרת הופעל - נטענו ${Object.keys(data.licenses).length} רישיונות, ${Object.keys(data.subscribers).length} מנויים`);
})();

// Pricing configuration
// FREE = Email only (unlimited)
// PAID = Email + SMS
const PRICING = {
  free: { name: 'חינם', price: 0, smsLimit: 0, emailUnlimited: true },
  trial: { name: 'ניסיון', price: 0, smsLimit: 0, freeSms: 3, emailUnlimited: true },
  monthly: { name: 'SMS חודשי', days: 30, price: 29, smsLimit: 50 },
  yearly: { name: 'SMS שנתי', days: 365, price: 199, smsLimit: 500 }
};

// Fan chants - random slogans for messages 🎵
const FAN_CHANTS = [
  'שבחי ירושלים הלב שלי צועק צהוב שחור',
  'אוהב מכל הלב אוהב אותך כל כך שזה כואב',
  'ללב נכנסת התאהבתי בך',
  'עכשיו עומד כאן מאוהב אריה שואג על החולצה מניף את הצעיף',
  'לא תצעדי לבד אף פעם רק אותך אני אוהב',
  'אומרים לי שאני קצת משוגע ככה זה באהבה כשאת בתוך הנשמה',
  'איתך מהיציע ועד הנצח'
];

// Get random fan chant
function getRandomChant() {
  return FAN_CHANTS[Math.floor(Math.random() * FAN_CHANTS.length)];
}

// Coupon codes configuration
const COUPONS = {
  'BEITAR10': { discount: 10, type: 'percent', description: '10% הנחה', active: true },
  'BEITAR20': { discount: 20, type: 'percent', description: '20% הנחה', active: true },
  'WELCOME50': { discount: 50, type: 'fixed', description: '₪50 הנחה', active: true, minPlan: 'yearly' },
  'BEITARFOREVER': { discount: 100, type: 'percent', description: '🖤💛 חינם לאוהדים אמיתיים!', active: true, oneTimeUse: true },
  'FRIEND': { discount: 15, type: 'percent', description: '15% הנחה לחברים', active: true }
};

// Validate coupon code
function validateCoupon(code, plan) {
  const coupon = COUPONS[code?.toUpperCase()];
  if (!coupon) return { valid: false, reason: 'קוד קופון לא קיים' };
  if (!coupon.active) return { valid: false, reason: 'קוד קופון לא פעיל' };
  if (coupon.minPlan === 'yearly' && plan !== 'yearly') {
    return { valid: false, reason: 'קופון זה תקף רק למנוי שנתי' };
  }
  return { valid: true, coupon };
}

// Calculate discounted price
function calculateDiscount(originalPrice, coupon) {
  if (coupon.type === 'percent') {
    return Math.round(originalPrice * (1 - coupon.discount / 100));
  } else {
    return Math.max(0, originalPrice - coupon.discount);
  }
}

// Generate random license key
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = 'BEITAR-';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    if (i < 3) key += '-';
  }
  return key;
}

// Check if license is valid
function isLicenseValid(licenseKey) {
  const license = data.licenses[licenseKey];
  if (!license) return { valid: false, reason: 'רישיון לא קיים' };
  if (!license.active) return { valid: false, reason: 'רישיון מושבת' };
  
  // Free plan - always valid for email, no SMS
  if (license.plan === 'free') {
    return { 
      valid: true, 
      license, 
      isFree: true, 
      emailOnly: true,
      canSendSms: false
    };
  }
  
  // Paid plans - check expiry
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
    return { valid: false, reason: 'רישיון SMS פג תוקף - אימייל עדיין פעיל', emailStillWorks: true };
  }
  
  // Check SMS limit
  const smsLeft = license.smsLimit - (license.usage?.sms || 0);
  return { 
    valid: true, 
    license,
    canSendSms: smsLeft > 0,
    smsLeft
  };
}

// Send license expiry reminder email
async function sendExpiryReminder(license, daysLeft) {
  if (!license.userEmail || !emailTransporter) return;
  
  const renewUrl = process.env.PAYBOX_URL || 'https://paybox.me/YOUR_LINK';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #000; color: #fff; padding: 20px; }
        .container { max-width: 500px; margin: 0 auto; background: #111; border-radius: 12px; padding: 30px; border: 2px solid #ffd700; }
        h1 { color: #ffd700; text-align: center; }
        .warning { background: #ff4444; color: #fff; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0; }
        .info { background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 15px 0; }
        .btn { display: inline-block; background: #ffd700; color: #000; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; margin-top: 15px; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>⚠️ הרישיון שלך עומד לפוג!</h1>
        
        <div class="warning">
          <strong>נותרו ${daysLeft} ימים בלבד!</strong>
        </div>
        
        <div class="info">
          <p><strong>שם:</strong> ${license.userName}</p>
          <p><strong>תוכנית:</strong> ${license.plan}</p>
          <p><strong>תפוגה:</strong> ${new Date(license.expiresAt).toLocaleDateString('he-IL')}</p>
        </div>
        
        <p>כדי להמשיך לקבל התראות על כרטיסים לבית"ר ירושלים, חדש את הרישיון שלך:</p>
        
        <div style="text-align: center;">
          <a href="${renewUrl}" class="btn">🔄 חדש רישיון עכשיו</a>
        </div>
        
        <div class="footer">
          <p>Beitar Ticket Monitor</p>
        </div>
      </div>
    </body>
    </html>
  `;
  
  try {
    await emailTransporter.sendMail({
      from: `"Beitar Ticket Monitor 🎟️" <${process.env.EMAIL_USER}>`,
      to: license.userEmail,
      subject: `⚠️ הרישיון שלך יפוג בעוד ${daysLeft} ימים - בית"ר ירושלים`,
      html: htmlContent
    });
    console.log(`📧 Expiry reminder sent to ${license.userEmail} (${daysLeft} days left)`);
    return true;
  } catch (error) {
    console.error(`Failed to send expiry reminder:`, error.message);
    return false;
  }
}

// Check all licenses and send reminders
async function checkLicenseExpiry() {
  console.log('🔍 Checking license expiry...');
  
  const now = new Date();
  const reminderDays = [7, 3, 1]; // Send reminders at 7, 3, and 1 days before expiry
  
  for (const [key, license] of Object.entries(data.licenses)) {
    if (!license.active || !license.expiresAt) continue;
    
    const expiryDate = new Date(license.expiresAt);
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    
    // Check if we should send a reminder
    if (reminderDays.includes(daysLeft)) {
      // Check if we already sent a reminder for this day
      const lastReminder = license.lastReminderSent;
      const reminderKey = `${daysLeft}days`;
      
      if (!lastReminder || lastReminder !== reminderKey) {
        await sendExpiryReminder(license, daysLeft);
        
        // Mark reminder as sent
        data.licenses[key].lastReminderSent = reminderKey;
        saveData();
      }
    }
  }
}

// Schedule license expiry check (runs every 6 hours)
setInterval(checkLicenseExpiry, 6 * 60 * 60 * 1000);

// API Key authentication middleware
function authenticateApiKey(req, res, next) {
  // Skip auth for public endpoints and admin (admin has its own password check)
  // Note: req.path here is relative to /api, so /api/test-email becomes /test-email
  const publicPaths = ['/health', '/pricing', '/register', '/coupon/validate', '/coupon/activate', '/license/validate', '/license/by-email', '/admin', '/create-pending-order', '/webhook', '/add-game', '/remove-game', '/games', '/test-email', '/test-sms', '/activate-order', '/notify', '/subscriber'];
  if (publicPaths.some(p => req.path === p || req.path.startsWith(p))) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const licenseKey = req.headers['x-license-key'] || req.query.licenseKey;
  const masterKey = process.env.API_KEY || 'beitar2024';
  
  // Master key always works
  if (apiKey === masterKey) {
    req.userKey = 'master';
    return next();
  }
  
  // Free email access - allow email without license
  if (licenseKey === 'free-email') {
    req.userKey = 'free-email';
    req.isFreeEmail = true;
    return next();
  }
  
  // Check license key
  if (licenseKey) {
    const licenseCheck = isLicenseValid(licenseKey);
    if (licenseCheck.valid) {
      req.userKey = licenseKey;
      req.license = licenseCheck.license;
      
      // Track usage per license
      if (!data.licenses[licenseKey].usage) {
        data.licenses[licenseKey].usage = { emails: 0, sms: 0 };
      }
      
      return next();
    } else {
      return res.status(403).json({ 
        error: 'License invalid', 
        reason: licenseCheck.reason,
        renewUrl: 'https://paybox.me/YOUR_LINK' // Change to your PayBox link
      });
    }
  }
  
  res.status(401).json({ error: 'License key required' });
}

// Track usage
function trackUsage(type, success, details = {}) {
  const entry = {
    type,
    success,
    timestamp: new Date().toISOString(),
    to: details.to || null,
    message: details.message || null,
    subject: details.subject || null,
    provider: details.provider || null,
    error: details.error || null,
    ...details
  };
  
  if (type === 'email') {
    if (success) data.usage.emailsSent++;
    else data.usage.emailsFailed++;
  } else if (type === 'sms') {
    if (success) data.usage.smsSent++;
    else data.usage.smsFailed++;
  }
  
  // Notify admin on failures
  if (!success) {
    notifyAdminOnFailure(type, entry);
  }
  
  // Keep last 100 history entries
  data.usage.history.unshift(entry);
  if (data.usage.history.length > 100) {
    data.usage.history = data.usage.history.slice(0, 100);
  }
  
  saveData();
}

// Admin email for failure notifications
const ADMIN_EMAIL = 'ticketchecker2020@gmail.com';

// Notify admin on failures (rate limited to avoid spam)
let lastAdminNotification = 0;
async function notifyAdminOnFailure(type, entry) {
  // Rate limit: max 1 notification per 5 minutes
  const now = Date.now();
  if (now - lastAdminNotification < 5 * 60 * 1000) {
    console.log('⏳ Admin notification skipped (rate limited)');
    return;
  }
  
  try {
    if (!emailTransporter) return;
    
    const subject = `⚠️ כישלון שליחת ${type === 'sms' ? 'SMS' : 'אימייל'} - Beitar Ticket Monitor`;
    const html = `
      <div dir="rtl" style="font-family: Arial; padding: 20px; background: #1a1a1a; color: #fff; border-radius: 10px;">
        <h2 style="color: #ff6b6b;">⚠️ התראה על כישלון</h2>
        <p><strong>סוג:</strong> ${type === 'sms' ? '📱 SMS' : '📧 אימייל'}</p>
        <p><strong>זמן:</strong> ${new Date(entry.timestamp).toLocaleString('he-IL')}</p>
        <p><strong>נמען:</strong> ${entry.to || 'לא ידוע'}</p>
        <p><strong>שגיאה:</strong> <span style="color: #ff6b6b;">${entry.error || 'לא ידוע'}</span></p>
        ${entry.message ? `<p><strong>הודעה:</strong> ${entry.message.substring(0, 100)}...</p>` : ''}
        <hr style="border-color: #333;">
        <p style="color: #888; font-size: 0.9em;">התראה אוטומטית מהשרת. בדוק את הדשבורד לפרטים נוספים.</p>
      </div>
    `;
    
    await emailTransporter.sendMail({
      from: process.env.EMAIL_USER,
      to: ADMIN_EMAIL,
      subject: subject,
      html: html
    });
    
    lastAdminNotification = now;
    console.log('📧 Admin notified about failure');
  } catch (err) {
    console.error('❌ Failed to notify admin:', err.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', authenticateApiKey);

// Email transporter setup
let emailTransporter = null;

function setupEmailTransporter() {
  if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
    console.log('✉️ Email transporter configured');
  } else if (process.env.SMTP_HOST) {
    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log('✉️ SMTP Email transporter configured');
  } else {
    console.log('⚠️ Email not configured - check .env file');
  }
}

// 019SMS setup check
function setup019SMS() {
  if (process.env.SMS019_TOKEN && process.env.SMS019_USERNAME) {
    console.log('📱 019SMS configured (sender: ' + (process.env.SMS019_SENDER || 'TicketAlert') + ')');
    return true;
  } else {
    console.log('⚠️ 019SMS not configured - add SMS019_USERNAME and SMS019_TOKEN to environment');
    return false;
  }
}

// Send Email
async function sendEmail(to, subject, htmlContent) {
  if (!emailTransporter) {
    console.log('Email not configured, skipping...');
    return false;
  }

  try {
    await emailTransporter.sendMail({
      from: `"Beitar Ticket Alert 🎟️" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: htmlContent
    });
    console.log(`✅ Email sent to ${to}`);
    trackUsage('email', true, { to: to.substring(0, 3) + '***' });
    return true;
  } catch (error) {
    console.error(`❌ Email failed to ${to}:`, error.message);
    trackUsage('email', false, { error: error.message });
    return false;
  }
}

// Send SMS - supports 019SMS (cheapest), Inforu (cheap) and Twilio (fallback)
async function sendSMS(to, message) {
  // Format Israeli phone number - remove leading 0 for API (format: 5xxxxxxxx)
  let phone = to.replace(/[^\d+]/g, '');
  if (phone.startsWith('+972')) {
    phone = phone.substring(4); // Remove +972
  } else if (phone.startsWith('0')) {
    phone = phone.substring(1); // Remove leading 0
  }
  
  // 019SMS - Israeli SMS provider
  if (!process.env.SMS019_TOKEN || !process.env.SMS019_USERNAME) {
    console.log('⚠️ 019SMS not configured - missing SMS019_TOKEN or SMS019_USERNAME');
    return false;
  }
  
  try {
    const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<sms>
  <user>
    <username>${process.env.SMS019_USERNAME}</username>
  </user>
  <source>${process.env.SMS019_SENDER || 'TicketAlert'}</source>
  <destinations>
    <phone>${phone}</phone>
  </destinations>
  <message>${message}</message>
</sms>`;
    
    const response = await fetch('https://019sms.co.il/api', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/xml',
        'Authorization': `Bearer ${process.env.SMS019_TOKEN}`
      },
      body: xmlData
    });
    
    const result = await response.text();
    
    // Status 0 = success in 019SMS
    if (result.includes('<status>0</status>')) {
      console.log(`✅ SMS sent via 019SMS to 0${phone}`);
      trackUsage('sms', true, { provider: '019sms', to: '0' + phone.substring(0, 2) + '****' + phone.slice(-2), message: message });
      return true;
    } else {
      console.error(`❌ 019SMS failed:`, result);
      trackUsage('sms', false, { provider: '019sms', to: '0' + phone, error: result });
      return false;
    }
  } catch (error) {
    console.error(`❌ 019SMS error:`, error.message);
    trackUsage('sms', false, { error: error.message });
    return false;
  }
}

// Check 019SMS Status
function get019SMSStatus() {
  const configured = !!(process.env.SMS019_TOKEN && process.env.SMS019_USERNAME);
  
  return {
    provider: '019SMS',
    configured: configured,
    username: configured ? process.env.SMS019_USERNAME : null,
    sender: process.env.SMS019_SENDER || 'TicketAlert',
    smsCost: 0.05, // 50₪ per 1000 SMS = 0.05₪ per SMS
    currency: 'ILS',
    note: configured ? 'לבדיקת יתרה - היכנס לדשבורד של 019SMS' : 'SMS לא מוגדר'
  };
}

// Get 019SMS Balance from API
async function get019SMSBalance() {
  if (!process.env.SMS019_TOKEN || !process.env.SMS019_USERNAME) {
    return {
      balance: null,
      configured: false,
      error: 'SMS לא מוגדר',
      lowBalance: false
    };
  }
  
  try {
    const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<balance>
    <user>
        <username>${process.env.SMS019_USERNAME}</username>
    </user>
</balance>`;
    
    const response = await fetch('https://019sms.co.il/api', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/xml',
        'Authorization': `Bearer ${process.env.SMS019_TOKEN}`
      },
      body: xmlData
    });
    
    const result = await response.text();
    
    // Parse XML response
    const balanceMatch = result.match(/<balance>(\d+(?:\.\d+)?)<\/balance>/);
    const statusMatch = result.match(/<status>(\d+)<\/status>/);
    const messageMatch = result.match(/<message>(.*?)<\/message>/);
    
    if (statusMatch && statusMatch[1] === '0' && balanceMatch) {
      const balance = parseFloat(balanceMatch[1]);
      // Balance is already in SMS units (number of messages remaining)
      const estimatedSmsRemaining = Math.floor(balance);
      
      return {
        balance: balance,
        estimatedSmsRemaining: estimatedSmsRemaining,
        currency: 'SMS',
        configured: true,
        lowBalance: balance < 100, // Less than 100 SMS = low balance
        message: messageMatch ? messageMatch[1] : null
      };
    } else {
      console.error('❌ 019SMS balance check failed:', result);
      return {
        balance: null,
        configured: true,
        error: messageMatch ? messageMatch[1] : 'שגיאה בבדיקת יתרה',
        lowBalance: false
      };
    }
  } catch (error) {
    console.error('❌ 019SMS balance error:', error.message);
    return {
      balance: null,
      configured: true,
      error: error.message,
      lowBalance: false
    };
  }
}

// Check SMS status (for monitoring)
function checkSMSStatus() {
  return get019SMSStatus();
}

// API Routes

// Health check (public - no API key needed)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    email: !!emailTransporter,
    sms: !!(process.env.SMS019_TOKEN && process.env.SMS019_USERNAME),
    smsProvider: '019SMS',
    timestamp: new Date().toISOString()
  });
});

// Get SMS Status (admin only)
app.get('/api/sms/status', (req, res) => {
  const adminPassword = req.query.admin || req.headers['x-admin-password'];
  
  if (adminPassword !== process.env.ADMIN_PASSWORD && adminPassword !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Admin password required. Use ?admin=PASSWORD' });
  }
  
  const smsStatus = get019SMSStatus();
  res.json(smsStatus);
});

// Keep old endpoint for backwards compatibility
app.get('/api/twilio/balance', (req, res) => {
  res.json({ 
    note: 'Twilio removed. Using 019SMS now.',
    ...get019SMSStatus()
  });
});

// Get usage stats
app.get('/api/usage', (req, res) => {
  res.json({
    emailsSent: data.usage.emailsSent,
    smsSent: data.usage.smsSent,
    emailsFailed: data.usage.emailsFailed,
    smsFailed: data.usage.smsFailed,
    totalCost: '$' + (data.usage.smsSent * 0.05).toFixed(2),
    recentHistory: data.usage.history.slice(0, 20)
  });
});

// ============================================
// SUBSCRIBER MANAGEMENT (Server-Side Monitoring)
// ============================================

// Register for notifications (supports multiple emails)
app.post('/api/register', async (req, res) => {
  const { emails, phone, licenseKey } = req.body;

  // Support both single email and array
  const emailList = Array.isArray(emails) ? emails : (emails ? [emails] : []);
  
  if (emailList.length === 0) {
    return res.status(400).json({ error: 'At least one email is required' });
  }

  // Validate emails
  for (const email of emailList) {
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: `Invalid email: ${email}` });
    }
  }

  // Use first email as primary ID
  const subscriberId = emailList[0].toLowerCase();
  
  // Check SMS license if provided
  let smsEnabled = false;
  if (licenseKey && phone) {
    const licenseCheck = isLicenseValid(licenseKey);
    smsEnabled = licenseCheck.valid && licenseCheck.canSendSms;
  }

  // Store subscriber
  data.subscribers[subscriberId] = {
    emails: emailList.map(e => e.toLowerCase()),
    phone: phone || null,
    licenseKey: licenseKey || null,
    smsEnabled,
    active: true,
    registeredAt: new Date().toISOString(),
    lastNotified: null
  };

  await saveData();
  
  console.log(`📝 New subscriber: ${subscriberId} (${emailList.length} emails${smsEnabled ? ', SMS enabled' : ''})`);

  res.json({
    success: true,
    message: 'Registered successfully! You will receive alerts when tickets are available.',
    subscriberId,
    emailCount: emailList.length,
    smsEnabled
  });
});

// Unregister from notifications
app.post('/api/unregister', async (req, res) => {
  const { email } = req.body;
  const subscriberId = email?.toLowerCase();

  if (data.subscribers[subscriberId]) {
    delete data.subscribers[subscriberId];
    await saveData();
    res.json({ success: true, message: 'Unregistered successfully' });
  } else {
    res.status(404).json({ error: 'Subscriber not found' });
  }
});

// Get subscription status
app.get('/api/subscription-status', (req, res) => {
  const { email } = req.query;
  const subscriberId = email?.toLowerCase();
  
  if (!subscriberId) {
    return res.status(400).json({ error: 'Email required' });
  }

  const subscriber = data.subscribers[subscriberId];
  
  if (subscriber && subscriber.active) {
    res.json({
      registered: true,
      emails: subscriber.emails,
      smsEnabled: subscriber.smsEnabled,
      registeredAt: subscriber.registeredAt,
      lastNotified: subscriber.lastNotified
    });
  } else {
    res.json({ registered: false });
  }
});

// Update subscription (emails, phone, license)
app.post('/api/update-subscription', async (req, res) => {
  const { currentEmail, emails, phone, licenseKey } = req.body;
  const subscriberId = currentEmail?.toLowerCase();
  
  if (!data.subscribers[subscriberId]) {
    return res.status(404).json({ error: 'Subscriber not found' });
  }

  const emailList = Array.isArray(emails) ? emails : (emails ? [emails] : data.subscribers[subscriberId].emails);
  
  // Check SMS license if provided
  let smsEnabled = false;
  if (licenseKey && phone) {
    const licenseCheck = isLicenseValid(licenseKey);
    smsEnabled = licenseCheck.valid && licenseCheck.canSendSms;
  }

  data.subscribers[subscriberId].emails = emailList.map(e => e.toLowerCase());
  if (phone !== undefined) data.subscribers[subscriberId].phone = phone;
  if (licenseKey !== undefined) data.subscribers[subscriberId].licenseKey = licenseKey;
  data.subscribers[subscriberId].smsEnabled = smsEnabled;

  await saveData();
  
  res.json({
    success: true,
    message: 'Subscription updated',
    emailCount: emailList.length,
    smsEnabled
  });
});

// Legacy subscribe endpoint (for backward compatibility)
app.post('/api/subscribe', async (req, res) => {
  const { email, phone, games } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Email or phone required' });
  }

  const subscriberId = email?.toLowerCase() || phone;
  
  data.subscribers[subscriberId] = {
    emails: email ? [email.toLowerCase()] : [],
    phone: phone || null,
    licenseKey: null,
    smsEnabled: false,
    active: true,
    registeredAt: new Date().toISOString(),
    lastNotified: null
  };

  await saveData();
  console.log(`📝 New subscriber (legacy): ${subscriberId}`);

  res.json({
    success: true,
    message: 'Subscribed successfully',
    subscriberId
  });
});

// Legacy unsubscribe (POST)
app.post('/api/unsubscribe', async (req, res) => {
  const { email, phone } = req.body;
  const subscriberId = email?.toLowerCase() || phone;

  if (data.subscribers[subscriberId]) {
    delete data.subscribers[subscriberId];
    await saveData();
    res.json({ success: true, message: 'Unsubscribed' });
  } else {
    res.status(404).json({ error: 'Subscriber not found' });
  }
});

// Unsubscribe via GET (for email links)
app.get('/unsubscribe', async (req, res) => {
  const { email } = req.query;
  const subscriberId = email?.toLowerCase();
  
  if (!subscriberId) {
    return res.status(400).send(`
      <html dir="rtl"><body style="font-family:Arial;text-align:center;padding:50px;">
        <h1>❌ שגיאה</h1>
        <p>חסר פרמטר אימייל</p>
      </body></html>
    `);
  }

  if (data.subscribers[subscriberId]) {
    delete data.subscribers[subscriberId];
    await saveData();
    console.log(`📤 Unsubscribed via email link: ${subscriberId}`);
    res.send(`
      <html dir="rtl"><body style="font-family:Arial;text-align:center;padding:50px;background:#111;color:#fff;">
        <h1 style="color:#ffd700;">✅ הוסרת בהצלחה!</h1>
        <p>האימייל <strong>${email}</strong> הוסר מרשימת ההתראות.</p>
        <p style="margin-top:30px;color:#888;">💛🖤 מקווים לראותך שוב ביציעים!</p>
      </body></html>
    `);
  } else {
    res.status(404).send(`
      <html dir="rtl"><body style="font-family:Arial;text-align:center;padding:50px;background:#111;color:#fff;">
        <h1 style="color:#ff6b6b;">❓ לא נמצא</h1>
        <p>האימייל <strong>${email}</strong> לא נמצא ברשימת המנויים.</p>
        <p style="color:#888;">אולי כבר הוסרת?</p>
      </body></html>
    `);
  }
});

// Update games (legacy - now we monitor all Beitar games)
app.post('/api/update-games', (req, res) => {
  res.json({ success: true, message: 'Server now monitors all Beitar games automatically' });
});

// Add game to subscriber's monitored list
app.post('/api/add-game', async (req, res) => {
  const { subscriberId, game } = req.body;
  
  if (!subscriberId || !game) {
    return res.status(400).json({ error: 'subscriberId and game required' });
  }
  
  // Find or create subscriber
  let subscriber = data.subscribers[subscriberId];
  if (!subscriber) {
    // Auto-create subscriber if not exists
    subscriber = {
      emails: [subscriberId.toLowerCase()],
      phone: null,
      licenseKey: null,
      smsEnabled: false,
      active: true,
      registeredAt: new Date().toISOString(),
      lastNotified: null,
      monitoredGames: []
    };
    data.subscribers[subscriberId] = subscriber;
    console.log(`📝 Auto-created subscriber: ${subscriberId}`);
  }
  
  // Initialize games array if not exists
  if (!subscriber.monitoredGames) {
    subscriber.monitoredGames = [];
  }
  
  // Check if game already exists
  const existingGame = subscriber.monitoredGames.find(g => g.id === game.id);
  if (existingGame) {
    return res.json({ success: true, message: 'Game already monitored', gameId: game.id });
  }
  
  // Add game
  subscriber.monitoredGames.push({
    ...game,
    addedAt: new Date().toISOString(),
    hasTickets: false,
    notified: false
  });
  
  await saveData();
  console.log(`🎮 Game added to ${subscriberId}: ${game.name || game.opponent}`);
  
  res.json({ success: true, message: 'Game added to monitoring', gameId: game.id });
});

// Remove game from subscriber's monitored list
app.post('/api/remove-game', async (req, res) => {
  const { subscriberId, gameId } = req.body;
  
  if (!subscriberId || !gameId) {
    return res.status(400).json({ error: 'subscriberId and gameId required' });
  }
  
  const subscriber = data.subscribers[subscriberId];
  if (!subscriber || !subscriber.monitoredGames) {
    return res.status(404).json({ error: 'Subscriber or games not found' });
  }
  
  subscriber.monitoredGames = subscriber.monitoredGames.filter(g => g.id !== gameId);
  await saveData();
  
  console.log(`🎮 Game removed from ${subscriberId}: ${gameId}`);
  res.json({ success: true, message: 'Game removed' });
});

// ============================================
// 🌐 WEBSITE PROXY ENDPOINTS
// ============================================

// Proxy endpoint for website to fetch games (avoids CORS)
app.get('/api/games/proxy', async (req, res) => {
  try {
    log.info('proxy', 'Website requesting games proxy...');
    
    const response = await fetchWithRetry(LEAAN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8'
      }
    }, 3);
    
    if (!response.ok) {
      log.error('proxy', `Failed to fetch leaan.co.il: ${response.status}`);
      return res.status(502).json({ error: 'Failed to fetch games', events: [] });
    }
    
    const html = await response.text();
    const games = parseTicketsFromHtml(html);
    
    // Format for website consumption
    const formattedGames = games.map(game => ({
      id: game.id,
      name: game.name,
      opponent: extractOpponentFromName(game.name),
      date: game.eventDate || null,
      time: game.eventTime || null,
      venue: 'טדי',
      hasTickets: game.available,
      soldOut: game.soldOut,
      ticketUrl: game.ticketUrl,
      competition: 'ליגה'
    }));
    
    log.info('proxy', `Returning ${formattedGames.length} games to website`);
    res.json({ events: formattedGames, success: true });
  } catch (error) {
    log.error('proxy', `Games proxy error: ${error.message}`);
    res.status(500).json({ error: error.message, events: [] });
  }
});

// Helper to extract opponent from game name
function extractOpponentFromName(gameName) {
  if (!gameName) return 'יריב';
  
  // Remove Beitar Jerusalem from name to get opponent
  const cleaned = gameName
    .replace(/בית["\u0022\u05F4]ר\s*ירושלים/gi, '')
    .replace(/[-–]/g, '')
    .trim();
  
  return cleaned || gameName;
}

// Subscribe to game from website (email only, no license required)
app.post('/api/subscriber/add-game', async (req, res) => {
  const { email, gameId, gameName, source } = req.body;
  
  if (!email || !gameId) {
    return res.status(400).json({ error: 'Email and gameId required' });
  }
  
  try {
    // Find or create subscriber by email
    let subscriberId = Object.keys(data.subscribers || {}).find(
      id => data.subscribers[id].email?.toLowerCase() === email.toLowerCase()
    );
    
    if (!subscriberId) {
      // Create new subscriber
      subscriberId = `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      data.subscribers = data.subscribers || {};
      data.subscribers[subscriberId] = {
        email: email,
        createdAt: new Date().toISOString(),
        source: source || 'website',
        monitoredGames: []
      };
    }
    
    const subscriber = data.subscribers[subscriberId];
    subscriber.monitoredGames = subscriber.monitoredGames || [];
    
    // Check if game already monitored
    if (subscriber.monitoredGames.some(g => g.id === gameId)) {
      return res.json({ success: true, message: 'Game already monitored', subscriberId });
    }
    
    // Add game
    subscriber.monitoredGames.push({
      id: gameId,
      name: gameName,
      opponent: extractOpponentFromName(gameName),
      addedAt: new Date().toISOString(),
      hasTickets: false
    });
    
    await saveData();
    log.info('website', `New game subscription: ${email} -> ${gameName}`);
    
    res.json({ success: true, message: 'Subscribed to game', subscriberId });
  } catch (error) {
    log.error('website', `Add game error: ${error.message}`);
    res.status(500).json({ error: 'Failed to add game subscription' });
  }
});

// Get subscriber's monitored games
app.get('/api/games/:subscriberId', async (req, res) => {
  const { subscriberId } = req.params;
  
  const subscriber = data.subscribers[subscriberId];
  if (!subscriber) {
    return res.status(404).json({ error: 'Subscriber not found' });
  }
  
  res.json({ 
    success: true, 
    games: subscriber.monitoredGames || [] 
  });
});

// Update game ticket status (called when tickets become available)
app.post('/api/update-game-status', async (req, res) => {
  const { subscriberId, gameId, hasTickets } = req.body;
  
  if (!subscriberId || !gameId) {
    return res.status(400).json({ error: 'subscriberId and gameId required' });
  }
  
  const subscriber = data.subscribers[subscriberId];
  if (!subscriber || !subscriber.monitoredGames) {
    return res.status(404).json({ error: 'Subscriber not found' });
  }
  
  const game = subscriber.monitoredGames.find(g => g.id === gameId);
  if (game) {
    game.hasTickets = hasTickets;
    game.ticketsFoundAt = hasTickets ? new Date().toISOString() : null;
    await saveData();
    console.log(`🎫 Game ${gameId} status updated: hasTickets=${hasTickets}`);
  }
  
  res.json({ success: true });
});

// Send notification (called by extension)
app.post('/api/notify', async (req, res) => {
  const { email, phone, games } = req.body;
  // Support licenseKey from both body and header
  const licenseKey = req.body.licenseKey || req.headers['x-license-key'];

  if (!games || games.length === 0) {
    return res.status(400).json({ error: 'No games to notify about' });
  }
  
  // Validate license if provided
  let license = null;
  let canSendSms = false;
  let actualLicenseKey = licenseKey;
  
  console.log('📧 /api/notify called:', { email: email ? 'yes' : 'no', phone: phone ? 'yes' : 'no', licenseKey: licenseKey ? 'yes' : 'no', gamesCount: games.length });
  
  if (licenseKey) {
    let validation = isLicenseValid(licenseKey);
    
    // If licenseKey is actually a coupon code, try to find real license by email
    if (!validation.valid && COUPONS[licenseKey] && email) {
      console.log('🔄 licenseKey is a coupon code, searching for real license by email:', email);
      const realLicenseKey = Object.keys(data.licenses).find(key => {
        const lic = data.licenses[key];
        return lic.userEmail === email && lic.active;
      });
      
      if (realLicenseKey) {
        console.log('✅ Found real license:', realLicenseKey);
        actualLicenseKey = realLicenseKey;
        validation = isLicenseValid(realLicenseKey);
      } else {
        console.log('⚠️ No license found for email, coupon user without license');
      }
    }
    
    console.log('🔑 License validation:', { 
      valid: validation.valid, 
      canSendSms: validation.canSendSms, 
      plan: validation.license?.plan,
      smsLeft: validation.smsLeft,
      smsUsed: validation.license?.usage?.sms,
      smsLimit: validation.license?.smsLimit,
      actualLicenseKey: actualLicenseKey
    });
    
    // Even if SMS expired, email still works
    if (!validation.valid && !validation.emailStillWorks) {
      return res.status(403).json({ 
        error: validation.reason,
        upgradeUrl: process.env.PAYBOX_URL || '/pricing'
      });
    }
    
    license = validation.license || data.licenses[actualLicenseKey];
    canSendSms = validation.canSendSms || false;
  } else {
    console.log('⚠️ No licenseKey provided in /api/notify request');
  }

  const results = {
    email: false,
    sms: false
  };

  // Build notification content
  const gamesList = games.map(g => {
    const date = g.date ? new Date(g.date).toLocaleDateString('he-IL') : '';
    return `• ${g.name} ${date ? `(${date})` : ''} - ${g.price ? g.price + '₪' : 'מחיר לא ידוע'}`;
  }).join('\n');
  
  // Build SMS message with direct links (shorter format)
  const smsGamesList = games.map(g => {
    const shortName = g.name.replace(/בית"ר ירושלים[^-]*-\s*/i, 'VS ');
    const price = g.price ? ` (${g.price}₪)` : '';
    return `${shortName}${price}`;
  }).join('\n');
  
  // Get first game URL for SMS (SMS has length limit)
  const firstGameUrl = games[0]?.url || 'https://www.leaan.co.il';

  // Send Email
  if (email) {
    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; background: #000; color: #fff; padding: 15px; margin: 0; }
          .container { max-width: 400px; margin: 0 auto; background: #111; border-radius: 10px; padding: 20px; border: 2px solid #ffd700; }
          h1 { color: #ffd700; text-align: center; margin: 0 0 15px 0; font-size: 20px; }
          .game { background: #1a1a1a; padding: 12px; margin: 8px 0; border-radius: 8px; border-right: 3px solid #ffd700; }
          .name { font-weight: bold; }
          .details { color: #aaa; font-size: 13px; margin-top: 5px; }
          .btn { display: inline-block; background: #ffd700; color: #000; padding: 8px 16px; text-decoration: none; border-radius: 20px; font-weight: bold; font-size: 13px; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎟️ כרטיסים זמינים!</h1>
          ${games.map(g => `
            <div class="game">
              <div class="name">${g.name}</div>
              <div class="details">${g.price ? `${g.price}₪` : ''}</div>
              ${g.url ? `<a href="${g.url}" class="btn">לרכישה</a>` : ''}
            </div>
          `).join('')}
        </div>
      </body>
      </html>
    `;

    results.email = await sendEmail(email, '🎟️ כרטיסים - בית"ר!', htmlContent);
  }

  // Send SMS - ONLY for paid plans with SMS remaining
  if (phone && canSendSms) {
    // Build engaging SMS with full link (max 201 chars for 1 SMS segment in Hebrew)
    const firstGame = games[0];
    const opponent = firstGame.name.replace(/בית"ר ירושלים[^-]*-\s*/i, '').replace(/\s*\([^)]*\)/g, '').trim();
    const price = firstGame.price ? ` ${firstGame.price}₪` : '';
    const url = firstGame.url || 'https://www.leaan.co.il';
    const chant = getRandomChant();
    const smsMessage = `🔥 כרטיסים זמינים לבית"ר!\n⚽ VS ${opponent}${price}\n🎟️ היכנסו עכשיו: ${url}\n💛🖤 ${chant}`;
    
    console.log(`SMS (${smsMessage.length} chars): ${smsMessage}`);
    results.sms = await sendSMS(phone, smsMessage);
    
    // Update license usage if SMS was sent
    if (results.sms && license) {
      license.usage.sms++;
      license.lastUsed = new Date().toISOString();
      data.licenses[actualLicenseKey] = license;
      saveData();
    }
  } else if (phone && !canSendSms) {
    // User has phone but no SMS plan
    results.smsSkipped = true;
    results.smsReason = license?.plan === 'free' ? 'תוכנית חינם - אימייל בלבד' : 'מכסת SMS נגמרה';
    console.log('⏭️ SMS skipped:', { reason: results.smsReason, plan: license?.plan, smsLimit: license?.smsLimit, smsUsed: license?.usage?.sms });
  } else if (!phone) {
    console.log('⏭️ SMS skipped: No phone number provided');
  }

  // Calculate SMS info for response
  let smsInfo = null;
  if (license) {
    const smsUsed = license.usage?.sms || 0;
    const smsLimit = license.smsLimit || 0;
    smsInfo = {
      plan: license.plan,
      smsUsed,
      smsLimit,
      smsLeft: Math.max(0, smsLimit - smsUsed),
      canSendSms
    };
  }

  res.json({
    success: results.email || results.sms,
    results,
    smsInfo,
    usage: {
      emailsSent: data.usage.emailsSent,
      smsSent: data.usage.smsSent
    }
  });
});

// Test email endpoint (allows users to test their own email)
app.post('/api/test-email', async (req, res) => {
  const { email, emails } = req.body;
  
  // Support both single email and array of emails
  const emailList = emails || (email ? [email] : []);
  
  if (emailList.length === 0) {
    return res.status(400).json({ error: 'Email required' });
  }

  let successCount = 0;
  
  for (const emailAddr of emailList) {
    const success = await sendEmail(
      emailAddr,
      '✅ הודעת בדיקה בלבד - Beitar Ticket Monitor',
      `
        <div dir="rtl" style="font-family: Arial; padding: 20px; background: #f5f5f5; border-radius: 10px;">
          <h2 style="color: #28a745;">✅ הודעת בדיקה בלבד!</h2>
          <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 15px 0;">
            <strong>⚠️ שים לב:</strong> זו הודעת בדיקה בלבד - אין כרטיסים זמינים כרגע!
          </div>
          <p>אם אתה רואה הודעה זו, המערכת עובדת כראוי והתראות אימייל מוגדרות נכון. 🎉</p>
          <p style="margin-top: 20px; padding: 10px; background: #e8f5e9; border-radius: 5px;">
            📬 כשיהיו כרטיסים זמינים באמת - תקבל הודעה נפרדת עם קישור לרכישה.
          </p>
        </div>
      `
    );
    if (success) successCount++;
  }

  res.json({ 
    success: successCount > 0, 
    message: successCount > 0 
      ? `Test email sent to ${successCount}/${emailList.length} addresses!` 
      : 'Failed to send test email' 
  });
});

// Test SMS endpoint
app.post('/api/test-sms', async (req, res) => {
  // Check admin password
  const adminPassword = req.headers['x-admin-password'] || req.query.p;
  if (adminPassword !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone required' });
  }

  const success = await sendSMS(phone, '✅ הודעת בדיקה בלבד! המערכת פעילה ומנטרת. זו לא התראה על כרטיסים - כשיהיו כרטיסים תקבל הודעה נפרדת.');

  res.json({ success, message: success ? 'Test SMS sent!' : 'Failed to send test SMS' });
});

// Home page - simple landing page
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎟️ Beitar Ticket Monitor</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: #000000;
      min-height: 100vh; 
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { text-align: center; padding: 40px; }
    h1 { color: #ffd700; font-size: 2.5em; margin-bottom: 20px; }
    p { color: #aaa; font-size: 1.2em; margin-bottom: 30px; }
    .btn {
      display: inline-block;
      padding: 15px 30px;
      background: #ffd700;
      color: #000;
      text-decoration: none;
      border-radius: 10px;
      font-weight: bold;
      margin: 10px;
      transition: transform 0.2s;
    }
    .btn:hover { transform: scale(1.05); }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎟️ Beitar Ticket Monitor</h1>
    <p>מערכת מעקב כרטיסים לבית"ר ירושלים</p>
    <div>
      <a href="/pricing" class="btn">💰 מחירים</a>
    </div>
    <p style="margin-top: 40px; font-size: 0.9em;">💛🖤 צהוב זה הצבע!</p>
  </div>
</body>
</html>
  `);
});

// Admin API - Get all data for dashboard (used by new dashboard.html)
app.get('/api/admin/data', async (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  // Get SMS balance
  const smsBalance = await get019SMSBalance();
  
  res.json({
    usage: data.usage,
    history: data.usage.history || [],
    subscribers: data.subscribers || {},
    licenses: data.licenses || {},
    coupons: COUPONS,
    subscriberCount: Object.keys(data.subscribers || {}).filter(k => data.subscribers[k]?.active).length,
    licenseCount: Object.keys(data.licenses || {}).length,
    smsBalance: smsBalance,
    config: {
      emailConfigured: !!emailTransporter,
      smsConfigured: !!(process.env.SMS019_TOKEN && process.env.SMS019_USERNAME),
      smsProvider: '019SMS'
    },
    version: {
      server: SERVER_VERSION,
      date: VERSION_DATE,
      notes: VERSION_NOTES
    }
  });
});

// Admin API - Get full stats
app.get('/api/admin/stats', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  res.json({
    usage: data.usage,
    config: {
      emailConfigured: !!emailTransporter,
      smsConfigured: !!(process.env.SMS019_TOKEN && process.env.SMS019_USERNAME),
      smsProvider: '019SMS'
    }
  });
});

// Reset usage stats (admin only)
app.post('/api/admin/reset-stats', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  data.usage = {
    emailsSent: 0,
    smsSent: 0,
    emailsFailed: 0,
    smsFailed: 0,
    history: []
  };
  saveData();
  
  res.json({ success: true, message: 'Stats reset' });
});

// Admin: Create license manually (for when payment didn't trigger webhook)
app.post('/api/admin/create-license', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || req.body.adminPassword || req.query.p;
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { email, phone, name, plan } = req.body;
  
  if (!email || !phone) {
    return res.status(400).json({ error: 'email and phone required' });
  }
  
  const selectedPlan = plan === 'yearly' ? 'yearly' : 'monthly';
  const planConfig = PRICING[selectedPlan];
  
  const licenseKey = generateLicenseKey();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + planConfig.days);
  
  // Format phone
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+972' + formattedPhone.substring(1);
  } else if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+972' + formattedPhone;
  }
  
  data.licenses[licenseKey] = {
    key: licenseKey,
    userName: name || email.split('@')[0],
    plan: selectedPlan,
    userEmail: email,
    userPhone: formattedPhone,
    active: true,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    smsRemaining: planConfig.smsLimit,
    smsLimit: planConfig.smsLimit,
    usage: { emails: 0, sms: 0 },
    createdBy: 'admin-manual'
  };
  
  await saveData();
  
  // Send license by email
  const emailHtml = `
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
      <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
        <h1 style="color: #ffd700; text-align: center;">🎟️ ברוך הבא!</h1>
        <p style="text-align: center; color: #ccc;">תודה שנרשמת להתראות כרטיסים של בית"ר ירושלים!</p>
        
        <div style="background: #222; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <p style="margin: 0; color: #888;">מפתח הרשיון שלך:</p>
          <p style="font-size: 1.5em; color: #ffd700; font-family: monospace; margin: 10px 0; word-break: break-all;">
            ${licenseKey}
          </p>
        </div>
        
        <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0;">
          <p style="margin: 5px 0;">📅 תוקף: עד ${expiresAt.toLocaleDateString('he-IL')}</p>
          <p style="margin: 5px 0;">📱 SMS נותרו: ${planConfig.smsLimit}</p>
          <p style="margin: 5px 0;">📧 אימייל: ללא הגבלה</p>
        </div>
        
        <h3 style="color: #ffd700; margin-top: 30px;">איך להשתמש:</h3>
        <ol style="color: #ccc; line-height: 2;">
          <li>התקן את התוסף לכרום</li>
          <li>פתח את התוסף ולחץ על "SMS בתשלום"</li>
          <li>הכנס את מפתח הרשיון</li>
          <li>זהו! תקבל SMS כשיש כרטיסים</li>
        </ol>
        
        <p style="text-align: center; margin-top: 30px; color: #888;">
          💛🖤 בהצלחה במשחקים!
        </p>
      </div>
    </body>
    </html>
  `;
  
  await sendEmail(email, '🎟️ מפתח הרשיון שלך - בית"ר ירושלים', emailHtml);
  
  // Also send SMS
  await sendSMS(formattedPhone, `בית"ר: מפתח הרשיון שלך: ${licenseKey}`);
  
  console.log(`✅ Admin created license ${licenseKey} for ${email}`);
  
  res.json({ 
    success: true, 
    licenseKey,
    message: `License created and sent to ${email} and ${phone}` 
  });
});

// Admin: Enable SMS/VIP for subscriber
app.post('/api/admin/enable-sms', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || req.body.adminPassword;
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { subscriberId } = req.body;
  
  if (!subscriberId) {
    return res.status(400).json({ error: 'subscriberId required' });
  }
  
  const subscriber = data.subscribers[subscriberId];
  if (!subscriber) {
    return res.status(404).json({ error: 'Subscriber not found' });
  }
  
  subscriber.smsEnabled = true;
  subscriber.vip = true;
  await saveData();
  
  console.log(`✨ VIP enabled for ${subscriberId}`);
  res.json({ success: true, message: `SMS/VIP enabled for ${subscriberId}` });
});

// Admin: Delete subscriber
app.post('/api/admin/delete-subscriber', async (req, res) => {
  const adminPass = req.headers['x-admin-password'] || req.body.adminPassword;
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { subscriberId } = req.body;
  
  if (!subscriberId) {
    return res.status(400).json({ error: 'subscriberId required' });
  }
  
  if (data.subscribers[subscriberId]) {
    delete data.subscribers[subscriberId];
    await saveData();
    console.log(`🗑️ Subscriber deleted: ${subscriberId}`);
    res.json({ success: true, message: `Subscriber ${subscriberId} deleted` });
  } else {
    res.status(404).json({ error: 'Subscriber not found' });
  }
});

// ============ LICENSE MANAGEMENT ============

// Self-registration for FREE TRIAL (public endpoint)
// NOTE: Using /api/register-license to avoid conflict with /api/register for subscribers
app.post('/api/register-license', (req, res) => {
  const { phone, email, name, coupon } = req.body;
  
  // Phone is REQUIRED for trial (to send SMS)
  if (!phone) {
    return res.status(400).json({ error: 'מספר טלפון נדרש לקבלת התראות SMS' });
  }
  
  // Validate phone format
  let normalizedPhone = phone.replace(/[^\d+]/g, '');
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '+972' + normalizedPhone.substring(1);
  } else if (!normalizedPhone.startsWith('+')) {
    normalizedPhone = '+972' + normalizedPhone;
  }
  
  // Check if phone already registered
  const existingLicense = Object.values(data.licenses).find(l => l.userPhone === normalizedPhone);
  if (existingLicense) {
    return res.status(400).json({ 
      error: 'מספר הטלפון כבר רשום במערכת',
      licenseKey: existingLicense.key
    });
  }
  
  // Validate coupon if provided
  let savedCoupon = null;
  let isVipCoupon = false;
  if (coupon) {
    const couponValidation = validateCoupon(coupon.toUpperCase());
    if (couponValidation.valid) {
      savedCoupon = coupon.toUpperCase();
      // Check if 100% discount coupon - auto upgrade to VIP
      if (couponValidation.coupon.discount === 100 && couponValidation.coupon.type === 'percent') {
        isVipCoupon = true;
      }
    }
  }
  
  const licenseKey = generateLicenseKey();
  const now = new Date();
  
  // If VIP coupon (100% off), give yearly plan with unlimited SMS
  const plan = isVipCoupon ? 'yearly' : 'trial';
  const smsLimit = isVipCoupon ? 9999 : PRICING.trial.freeSms;
  const expiresAt = isVipCoupon ? new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString() : null;
  
  data.licenses[licenseKey] = {
    key: licenseKey,
    userName: name || 'אורח',
    userEmail: email || '',
    userPhone: normalizedPhone,
    plan: plan,
    active: true,
    createdAt: now.toISOString(),
    expiresAt: expiresAt,
    smsLimit: smsLimit,
    usage: { emails: 0, sms: 0 },
    lastUsed: null,
    couponCode: savedCoupon
  };
  
  saveData();
  
  // Send welcome SMS only for VIP (100% discount coupon) - don't waste money on free users
  if (isVipCoupon && process.env.SMS019_TOKEN) {
    const welcomeMsg = `🎟️ VIP! מפתח: ${licenseKey}\n🖤💛 SMS ללא הגבלה!`;
    sendSMS(normalizedPhone, welcomeMsg).catch(err => console.log('Welcome SMS failed:', err.message));
  }
  
  // Send welcome email if provided
  if (email) {
    sendWelcomeEmail(data.licenses[licenseKey]);
  }
  
  const responseMsg = isVipCoupon 
    ? `🖤💛 VIP! אימייל + SMS ללא הגבלה!`
    : `ברוכים הבאים! התראות אימייל ללא הגבלה - חינם! לקבלת SMS יש לשדרג.`;
  
  res.json({ 
    success: true, 
    licenseKey: licenseKey,
    plan: plan,
    smsLimit: smsLimit,
    couponSaved: savedCoupon,
    isVip: isVipCoupon,
    message: responseMsg
  });
});

// Landing page - Subscribe for alerts
app.get('/', (req, res) => {
  const subscriberCount = Object.keys(data.subscribers || {}).filter(e => data.subscribers[e]?.active).length;
  
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>התראות כרטיסים - בית"ר ירושלים 🎟️</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh; 
      color: #fff;
      padding: 20px;
    }
    .container { max-width: 500px; margin: 0 auto; }
    h1 { 
      text-align: center; 
      color: #ffd700; 
      font-size: 2em; 
      margin-bottom: 10px;
    }
    .subtitle { text-align: center; color: #aaa; margin-bottom: 30px; }
    .badge {
      text-align: center;
      background: rgba(74,222,128,0.2);
      color: #4ade80;
      padding: 10px;
      border-radius: 10px;
      margin-bottom: 30px;
    }
    .card { 
      background: rgba(255,255,255,0.05); 
      border-radius: 20px; 
      padding: 30px; 
      border: 2px solid rgba(255,215,0,0.3);
    }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; color: #ccc; }
    input { 
      width: 100%; 
      padding: 15px; 
      border: 2px solid rgba(255,215,0,0.3);
      border-radius: 10px; 
      background: rgba(0,0,0,0.3);
      color: #fff;
      font-size: 1.1em;
      direction: ltr;
    }
    input:focus { outline: none; border-color: #ffd700; }
    .btn { 
      width: 100%;
      padding: 18px; 
      border: none;
      border-radius: 30px; 
      background: linear-gradient(135deg, #ffd700, #ffaa00);
      color: #000;
      font-size: 1.2em;
      font-weight: bold;
      cursor: pointer;
    }
    .btn:hover { transform: scale(1.02); }
    .features { margin-top: 30px; }
    .feature { 
      display: flex; 
      align-items: center; 
      gap: 10px; 
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .feature:last-child { border-bottom: none; }
    .success { 
      background: rgba(74,222,128,0.2); 
      color: #4ade80; 
      padding: 20px; 
      border-radius: 10px; 
      text-align: center;
      display: none;
    }
    .error { 
      background: rgba(255,107,107,0.2); 
      color: #ff6b6b; 
      padding: 10px; 
      border-radius: 8px; 
      text-align: center;
      display: none;
      margin-top: 10px;
    }
    .stats { text-align: center; margin-top: 20px; color: #888; font-size: 0.9em; }
    .footer { text-align: center; margin-top: 30px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎟️ התראות כרטיסים</h1>
    <h2 style="text-align: center; color: #ffd700; margin-bottom: 20px;">בית"ר ירושלים</h2>
    
    <div class="badge">
      🔄 בדיקה אוטומטית 24/7 - כל 5 דקות!
    </div>
    
    <div class="card">
      <form id="subscribeForm">
        <div class="form-group">
          <label>📧 אימייל</label>
          <input type="email" name="email" placeholder="your@email.com" required>
        </div>
        
        <div class="form-group">
          <label>📱 טלפון (אופציונלי - ל-SMS בתשלום)</label>
          <input type="tel" name="phone" placeholder="0501234567">
        </div>
        
        <button type="submit" class="btn">🔔 הירשם להתראות - חינם!</button>
        <div class="error" id="errorMsg"></div>
      </form>
      
      <div class="success" id="successMsg">
        ✅ נרשמת בהצלחה!<br>
        תקבל אימייל ברגע שיהיו כרטיסים זמינים.
      </div>
      
      <div class="features">
        <div class="feature">✅ בדיקה אוטומטית כל 5 דקות</div>
        <div class="feature">✅ התראה מיידית באימייל - חינם!</div>
        <div class="feature">✅ עובד 24/7 - גם כשהמחשב סגור</div>
        <div class="feature">✅ לינק ישיר לרכישה</div>
      </div>
    </div>
    
    <div class="stats">
      👥 ${subscriberCount} אוהדים כבר נרשמו
    </div>
    
    <div class="footer">
      <p>💛🖤 צהוב זה הצבע!</p>
      <p style="margin-top: 10px;">
        <a href="/pricing" style="color: #ffd700;">מחירים</a> • 
        <a href="/privacy" style="color: #888;">פרטיות</a>
      </p>
    </div>
  </div>
  
  <script>
    document.getElementById('subscribeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button');
      const error = document.getElementById('errorMsg');
      const success = document.getElementById('successMsg');
      
      btn.disabled = true;
      btn.textContent = '⏳ נרשם...';
      error.style.display = 'none';
      
      try {
        const res = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email.value,
            phone: form.phone.value || null
          })
        });
        
        const data = await res.json();
        
        if (data.success) {
          form.style.display = 'none';
          success.style.display = 'block';
        } else {
          error.textContent = data.error || 'שגיאה בהרשמה';
          error.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '🔔 הירשם להתראות - חינם!';
        }
      } catch (e) {
        error.textContent = 'שגיאת תקשורת';
        error.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '🔔 הירשם להתראות - חינם!';
      }
    });
  </script>
</body>
</html>
  `);
});

// Privacy Policy page (required for Chrome Web Store)
app.get('/privacy', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>מדיניות פרטיות - התראות כרטיסים בית"ר ירושלים</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; line-height: 1.8; background: #1a1a2e; color: #fff; }
    h1 { color: #ffd700; }
    h2 { color: #ffd700; margin-top: 30px; }
    a { color: #ffd700; }
  </style>
</head>
<body>
  <h1>מדיניות פרטיות</h1>
  <p><strong>עדכון אחרון:</strong> ינואר 2026</p>
  
  <h2>מידע שאנחנו אוספים</h2>
  <p>התוסף "התראות כרטיסים - בית"ר ירושלים" אוסף את המידע הבא:</p>
  <ul>
    <li><strong>כתובת אימייל</strong> - לצורך שליחת התראות על כרטיסים זמינים</li>
    <li><strong>מספר טלפון</strong> - לצורך שליחת SMS (למנויים בתשלום בלבד)</li>
  </ul>
  
  <h2>איך אנחנו משתמשים במידע</h2>
  <p>המידע משמש אך ורק לצורך:</p>
  <ul>
    <li>שליחת התראות כאשר כרטיסים למשחקי בית"ר ירושלים זמינים</li>
    <li>ניהול המנוי שלך</li>
  </ul>
  
  <h2>שמירת מידע</h2>
  <p>המידע נשמר בצורה מאובטחת בשרתים שלנו. אנחנו לא מוכרים או משתפים את המידע עם צדדים שלישיים.</p>
  
  <h2>מחיקת מידע</h2>
  <p>ניתן לבקש מחיקת המידע בכל עת על ידי פנייה אלינו.</p>
  
  <h2>יצירת קשר</h2>
  <p>לשאלות בנושא פרטיות: ticketchecker2020@gmail.com</p>
  
  <p style="margin-top: 40px; color: #888;">💛🖤 בית"ר ירושלים</p>
</body>
</html>
  `);
});

// Redirect /pricing to pricing page
app.get('/pricing', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>מחירים - התראות כרטיסים בית"ר ירושלים</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: #000000;
      min-height: 100vh; 
      color: #fff;
      padding: 20px;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    h1 { 
      text-align: center; 
      color: #ffd700; 
      font-size: 2.5em; 
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
    }
    .subtitle { text-align: center; color: #aaa; margin-bottom: 40px; font-size: 1.1em; }
    .pricing-cards { 
      display: grid; 
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); 
      gap: 25px; 
      margin-bottom: 40px;
    }
    .card { 
      background: rgba(255,255,255,0.05); 
      border-radius: 20px; 
      padding: 30px; 
      text-align: center;
      border: 2px solid rgba(255,215,0,0.2);
      transition: transform 0.3s, box-shadow 0.3s;
    }
    .card:hover { 
      transform: translateY(-10px); 
      box-shadow: 0 20px 40px rgba(255,215,0,0.2);
    }
    .card.popular { 
      border-color: #ffd700; 
      position: relative;
    }
    .card.popular::before {
      content: '⭐ הכי פופולרי';
      position: absolute;
      top: -12px;
      left: 50%;
      transform: translateX(-50%);
      background: #ffd700;
      color: #000;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: bold;
    }
    .card-title { color: #ffd700; font-size: 1.5em; margin-bottom: 15px; }
    .card-price { font-size: 3em; font-weight: bold; margin: 20px 0; }
    .card-price span { font-size: 0.4em; color: #888; }
    .card-price.free { color: #4ade80; }
    .features { list-style: none; text-align: right; margin: 25px 0; }
    .features li { 
      padding: 10px 0; 
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .features li:last-child { border-bottom: none; }
    .btn { 
      display: inline-block; 
      padding: 15px 40px; 
      border-radius: 30px; 
      text-decoration: none; 
      font-weight: bold; 
      font-size: 1.1em;
      transition: all 0.3s;
      cursor: pointer;
      border: none;
    }
    .btn-free { 
      background: #4ade80; 
      color: #000; 
    }
    .btn-free:hover { background: #22c55e; }
    .btn-gold { 
      background: linear-gradient(135deg, #ffd700, #ffaa00); 
      color: #000; 
    }
    .btn-gold:hover { background: linear-gradient(135deg, #ffaa00, #ff8800); }
    .extension-link {
      text-align: center;
      margin-top: 40px;
      padding: 30px;
      background: rgba(255,215,0,0.1);
      border-radius: 15px;
    }
    .extension-link h3 { color: #ffd700; margin-bottom: 15px; }
    .extension-link p { color: #ccc; margin-bottom: 20px; }
    .footer { 
      text-align: center; 
      margin-top: 40px; 
      padding: 30px;
      background: rgba(255,215,0,0.1);
      border-radius: 15px;
      border: 2px solid rgba(255,215,0,0.3);
    }
    .footer p { 
      color: #ffd700; 
      font-size: 1.4em; 
      font-weight: bold;
      text-shadow: 0 0 10px rgba(255,215,0,0.5);
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎟️ התראות כרטיסים בית"ר ירושלים</h1>
    <p class="subtitle">קבל התראה מיידית כשכרטיסים למשחק שבחרת זמינים!</p>
    
    <div class="pricing-cards">
      <!-- Free Plan -->
      <div class="card">
        <div class="card-title">חינם לתמיד</div>
        <div class="card-price free">0₪</div>
        <ul class="features">
          <li>📧 התראות אימייל ללא הגבלה</li>
          <li>🔔 התראות בדפדפן</li>
          <li>⏰ בדיקה אוטומטית כל 5 דקות</li>
          <li>🎯 מעקב אחר כל המשחקים</li>
        </ul>
        <a href="#download" class="btn btn-free">התחל חינם!</a>
      </div>
      
      <!-- Monthly Plan -->
      <div class="card popular">
        <div class="card-title">SMS חודשי</div>
        <div class="card-price">29₪ <span>/חודש</span></div>
        <ul class="features">
          <li>📱 עד 50 SMS בחודש</li>
          <li>📧 + אימייל ללא הגבלה</li>
          <li>🔔 + התראות בדפדפן</li>
          <li>⚡ התראות מיידיות לנייד</li>
        </ul>
        <a href="/subscribe?plan=monthly" class="btn btn-gold">הרשמה עכשיו</a>
      </div>
      
      <!-- Yearly Plan -->
      <div class="card">
        <div class="card-title">SMS שנתי</div>
        <div class="card-price">199₪ <span>/שנה</span></div>
        <ul class="features">
          <li>📱 עד 500 SMS בשנה</li>
          <li>📧 + אימייל ללא הגבלה</li>
          <li>🎁 חיסכון של 30%!</li>
          <li>👑 עדיפות בתמיכה</li>
        </ul>
        <a href="/subscribe?plan=yearly" class="btn btn-gold">הרשמה עכשיו</a>
      </div>
    </div>
    
    <div class="extension-link" id="download">
      <h3>📥 הורד את התוסף לכרום</h3>
      <p>התקן את התוסף וקבל התראות ישירות לדפדפן!</p>
      <a href="/extension.zip" class="btn btn-gold">הורדת התוסף</a>
    </div>
    
    <div class="footer">
      <p id="randomPhrase">💛🖤</p>
    </div>
  </div>
  
  <script>
    const phrases = [
      "שבחי ירושלים הלב שלי צועק צהוב שחור",
      "אוהב מכל הלב אוהב אותך כל כך שזה כואב",
      "ללב נכנסת התאהבתי בך",
      "עכשיו עומד כאן מאוהב אריה שואג על החולצה מניף את הצעיף",
      "לא תצעדי לבד אף פעם רק אותך אני אוהב",
      "אומרים לי שאני קצת משוגע ככה זה באהבה כשאת בתוך הנשמה",
      "איתך מהיציע ועד הנצח"
    ];
    document.getElementById('randomPhrase').textContent = '💛🖤 ' + phrases[Math.floor(Math.random() * phrases.length)];
  </script>
</body>
</html>
  `);
});

// Admin Dashboard
app.get('/admin', async (req, res) => {
  const adminPassword = req.query.p || req.query.password;
  
  if (adminPassword !== process.env.ADMIN_PASSWORD && adminPassword !== 'BeitarAdmin123!') {
    return res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Login</title>
  <style>
    body { font-family: Arial; background: #1a1a2e; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .login { background: rgba(255,255,255,0.05); padding: 40px; border-radius: 20px; text-align: center; }
    input { padding: 15px; font-size: 1.1em; border-radius: 10px; border: 2px solid #ffd700; background: #222; color: #fff; margin: 10px 0; }
    button { padding: 15px 30px; font-size: 1.1em; border: none; border-radius: 10px; background: #ffd700; color: #000; cursor: pointer; font-weight: bold; }
  </style>
</head>
<body>
  <div class="login">
    <h2>🔐 Admin Login</h2>
    <form method="GET">
      <input type="password" name="p" placeholder="סיסמה" required><br>
      <button type="submit">כניסה</button>
    </form>
  </div>
</body>
</html>
    `);
  }
  
  // Serve the new dashboard HTML file
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Subscription page - collect user details before payment
app.get('/subscribe', (req, res) => {
  const plan = req.query.plan || 'monthly';
  const planInfo = plan === 'yearly' 
    ? { name: 'SMS שנתי', price: 199, period: 'שנה' }
    : { name: 'SMS חודשי', price: 29, period: 'חודש' };
  
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>הרשמה - ${planInfo.name}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh; 
      color: #fff;
      padding: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { 
      max-width: 450px; 
      width: 100%;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      padding: 40px;
      border: 2px solid rgba(255,215,0,0.3);
    }
    h1 { color: #ffd700; text-align: center; margin-bottom: 10px; }
    .plan-badge {
      text-align: center;
      background: rgba(255,215,0,0.2);
      padding: 10px 20px;
      border-radius: 10px;
      margin-bottom: 30px;
    }
    .plan-badge .price { font-size: 2em; color: #ffd700; font-weight: bold; }
    .plan-badge .period { color: #aaa; }
    .form-group { margin-bottom: 20px; }
    label { display: block; margin-bottom: 8px; color: #ccc; }
    input { 
      width: 100%; 
      padding: 15px; 
      border: 2px solid rgba(255,215,0,0.3);
      border-radius: 10px; 
      background: rgba(0,0,0,0.3);
      color: #fff;
      font-size: 1.1em;
      direction: ltr;
    }
    input:focus { outline: none; border-color: #ffd700; }
    input::placeholder { color: #666; }
    .btn { 
      width: 100%;
      padding: 18px; 
      border: none;
      border-radius: 30px; 
      background: linear-gradient(135deg, #ffd700, #ffaa00);
      color: #000;
      font-size: 1.2em;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.3s;
    }
    .btn:hover { transform: scale(1.02); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .error { color: #ff6b6b; margin-top: 10px; text-align: center; display: none; }
    .coupon-section { margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1); }
    .coupon-row { display: flex; gap: 10px; }
    .coupon-row input { flex: 1; }
    .coupon-row button { 
      padding: 15px 20px; 
      background: rgba(255,215,0,0.2);
      border: 2px solid rgba(255,215,0,0.3);
      border-radius: 10px;
      color: #ffd700;
      cursor: pointer;
    }
    .coupon-result { margin-top: 10px; padding: 10px; border-radius: 8px; display: none; }
    .coupon-result.success { background: rgba(74,222,128,0.2); color: #4ade80; }
    .coupon-result.error { background: rgba(255,107,107,0.2); color: #ff6b6b; display: block; }
    .back-link { display: block; text-align: center; margin-top: 20px; color: #888; text-decoration: none; }
    .back-link:hover { color: #ffd700; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎟️ הרשמה</h1>
    <div class="plan-badge">
      <div class="price">${planInfo.price}₪</div>
      <div class="period">${planInfo.name} - ל${planInfo.period}</div>
    </div>
    
    <form id="subscribeForm">
      <input type="hidden" name="plan" value="${plan}">
      
      <div class="form-group">
        <label>📧 אימייל</label>
        <input type="email" name="email" placeholder="your@email.com" required>
      </div>
      
      <div class="form-group">
        <label>📱 טלפון (לקבלת SMS)</label>
        <input type="tel" name="phone" placeholder="0501234567" required>
      </div>
      
      <div class="coupon-section">
        <label>🎁 קוד קופון (אופציונלי)</label>
        <div class="coupon-row">
          <input type="text" name="coupon" id="couponInput" placeholder="COUPON123">
          <button type="button" onclick="checkCoupon()">בדוק</button>
        </div>
        <div class="coupon-result" id="couponResult"></div>
      </div>
      
      <button type="submit" class="btn" style="margin-top: 30px;">
        💳 המשך לתשלום
      </button>
      <div class="error" id="errorMsg"></div>
    </form>
    
    <a href="/pricing" class="back-link">← חזרה למחירים</a>
  </div>
  
  <script>
    let appliedCoupon = null;
    let finalPrice = ${planInfo.price};
    
    async function checkCoupon() {
      const code = document.getElementById('couponInput').value.trim();
      const result = document.getElementById('couponResult');
      
      if (!code) {
        result.className = 'coupon-result error';
        result.textContent = 'הכנס קוד קופון';
        result.style.display = 'block';
        return;
      }
      
      try {
        const res = await fetch('/api/coupon/validate?code=' + code + '&plan=${plan}');
        const data = await res.json();
        
        if (data.valid) {
          appliedCoupon = code;
          finalPrice = data.finalPrice;
          result.className = 'coupon-result success';
          result.textContent = '✅ ' + data.message + ' - מחיר סופי: ' + finalPrice + '₪';
          result.style.display = 'block';
        } else {
          result.className = 'coupon-result error';
          result.textContent = '❌ ' + data.error;
          result.style.display = 'block';
        }
      } catch (e) {
        result.className = 'coupon-result error';
        result.textContent = '❌ שגיאה בבדיקת קופון';
        result.style.display = 'block';
      }
    }
    
    document.getElementById('subscribeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('button[type="submit"]');
      const error = document.getElementById('errorMsg');
      
      btn.disabled = true;
      btn.textContent = '⏳ מעבד...';
      error.style.display = 'none';
      
      const formData = {
        plan: form.plan.value,
        email: form.email.value,
        phone: form.phone.value,
        coupon: appliedCoupon
      };
      
      try {
        const res = await fetch('/api/create-pending-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        const data = await res.json();
        
        if (data.success) {
          if (data.free) {
            // Free license - show success page
            window.location.href = '/free-success?license=' + data.licenseKey;
          } else {
            // Redirect to PayBox for payment
            window.location.href = data.paymentUrl;
          }
        } else {
          error.textContent = data.error || 'שגיאה ביצירת הזמנה';
          error.style.display = 'block';
          btn.disabled = false;
          btn.textContent = '💳 המשך לתשלום';
        }
      } catch (e) {
        error.textContent = 'שגיאת תקשורת';
        error.style.display = 'block';
        btn.disabled = false;
        btn.textContent = '💳 המשך לתשלום';
      }
    });
  </script>
</body>
</html>
  `);
});

// Pending orders storage (in production, use database)
const pendingOrders = {};

// Create pending order before payment
app.post('/api/create-pending-order', async (req, res) => {
  const { plan, email, phone, coupon } = req.body;
  
  if (!email || !phone) {
    return res.status(400).json({ error: 'נדרש אימייל וטלפון' });
  }
  
  // Validate plan
  const planInfo = plan === 'yearly' ? PRICING.yearly : PRICING.monthly;
  let finalPrice = planInfo.price;
  
  // Apply coupon if provided
  if (coupon) {
    const validation = validateCoupon(coupon, plan);
    if (validation.valid) {
      finalPrice = calculateDiscount(planInfo.price, validation.coupon);
    }
  }
  
  // Generate order ID
  const orderId = 'ORD-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
  
  // Format phone number
  let formattedPhone = phone.replace(/\D/g, '');
  if (formattedPhone.startsWith('0')) {
    formattedPhone = '+972' + formattedPhone.substring(1);
  } else if (!formattedPhone.startsWith('+')) {
    formattedPhone = '+972' + formattedPhone;
  }
  
  // Store pending order
  pendingOrders[orderId] = {
    plan,
    email,
    phone: formattedPhone,
    coupon,
    originalPrice: planInfo.price,
    finalPrice,
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
  
  // Clean old pending orders (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, order] of Object.entries(pendingOrders)) {
    if (new Date(order.createdAt).getTime() < oneHourAgo) {
      delete pendingOrders[id];
    }
  }
  
  console.log(`📝 Created pending order ${orderId} for ${email}, plan: ${plan}, price: ${finalPrice}₪`);
  
  // If FREE (100% discount) - create license immediately without payment!
  if (finalPrice === 0) {
    const licenseKey = generateLicenseKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + planInfo.days);
    
    data.licenses[licenseKey] = {
      key: licenseKey,
      userName: name || email.split('@')[0],
      plan,
      userEmail: email,
      userPhone: formattedPhone,
      active: true,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      smsRemaining: planInfo.smsLimit,
      smsLimit: planInfo.smsLimit,
      usage: { emails: 0, sms: 0 },
      couponUsed: coupon,
      freeFromCoupon: true
    };
    
    saveData();
    
    // Mark coupon as used if it's one-time
    if (coupon && COUPONS[coupon.toUpperCase()]?.oneTimeUse) {
      COUPONS[coupon.toUpperCase()].active = false;
    }
    
    // Send license by email
    const emailHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
          <h1 style="color: #ffd700; text-align: center;">🎟️ ברוך הבא!</h1>
          <p style="text-align: center; color: #4ade80; font-size: 1.2em;">🎁 קיבלת מנוי חינם!</p>
          
          <div style="background: #222; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 0; color: #888;">מפתח הרשיון שלך:</p>
            <p style="font-size: 1.5em; color: #ffd700; font-family: monospace; margin: 10px 0; word-break: break-all;">
              ${licenseKey}
            </p>
          </div>
          
          <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0;">
            <p style="margin: 5px 0;">📅 תוקף: עד ${expiresAt.toLocaleDateString('he-IL')}</p>
            <p style="margin: 5px 0;">📱 SMS נותרו: ${planInfo.smsLimit}</p>
            <p style="margin: 5px 0;">📧 אימייל: ללא הגבלה</p>
          </div>
          
          <h3 style="color: #ffd700; margin-top: 30px;">איך להשתמש:</h3>
          <ol style="color: #ccc; line-height: 2;">
            <li>התקן את התוסף לכרום</li>
            <li>פתח את התוסף ולחץ על "SMS בתשלום"</li>
            <li>הכנס את מפתח הרשיון</li>
            <li>זהו! תקבל SMS כשיש כרטיסים</li>
          </ol>
          
          <p style="text-align: center; margin-top: 30px; color: #888;">
            💛🖤 בהצלחה במשחקים!
          </p>
        </div>
      </body>
      </html>
    `;
    
    await sendEmail(email, '🎟️ מפתח הרשיון שלך - בית"ר ירושלים (חינם!)', emailHtml);
    await sendSMS(formattedPhone, `בית"ר: קיבלת מנוי חינם! מפתח: ${licenseKey}`);
    
    console.log(`✅ FREE License ${licenseKey} created for ${email} with coupon ${coupon}`);
    
    return res.json({
      success: true,
      free: true,
      licenseKey,
      message: '🎉 מנוי חינם נוצר בהצלחה! בדוק את האימייל שלך.'
    });
  }
  
  // Build PayBox URL for paid orders with return URL that includes order ID
  const basePayboxUrl = process.env.PAYBOX_URL || 'https://links.payboxapp.com/IdiXnIQ13Zb';
  const returnUrl = encodeURIComponent(`https://server-tickets-l0rq.onrender.com/payment-complete?order=${orderId}`);
  // Some PayBox links support adding params
  const payboxUrl = basePayboxUrl.includes('?') 
    ? `${basePayboxUrl}&return_url=${returnUrl}&order_id=${orderId}` 
    : `${basePayboxUrl}?return_url=${returnUrl}&order_id=${orderId}`;
  
  res.json({
    success: true,
    orderId,
    finalPrice,
    paymentUrl: payboxUrl
  });
});

// PayBox Webhook - called after successful payment
app.post('/webhook/paybox', async (req, res) => {
  console.log('📥 PayBox Webhook received:', JSON.stringify(req.body));
  
  // PayBox sends payment info
  const { 
    transaction_id,
    order_id,      // Our order ID if passed
    customer_email,
    customer_phone,
    amount,
    status,
    custom_fields  // May contain our order ID
  } = req.body;
  
  // Try to find order ID
  let orderId = order_id || req.query.order || custom_fields?.order;
  
  // If no order ID, try to find by email from pending orders
  if (!orderId && customer_email) {
    for (const [id, order] of Object.entries(pendingOrders)) {
      if (order.email.toLowerCase() === customer_email.toLowerCase() && order.status === 'pending') {
        orderId = id;
        break;
      }
    }
  }
  
  // Find pending order
  const pendingOrder = pendingOrders[orderId];
  
  if (pendingOrder) {
    // Create license from pending order
    const plan = pendingOrder.plan;
    const planConfig = plan === 'yearly' ? PRICING.yearly : PRICING.monthly;
    
    const licenseKey = generateLicenseKey();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + planConfig.days);
    
    data.licenses[licenseKey] = {
      key: licenseKey,
      userName: pendingOrder.name || pendingOrder.email.split('@')[0],
      plan,
      userEmail: pendingOrder.email,
      userPhone: pendingOrder.phone,
      active: true,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      smsRemaining: planConfig.smsLimit,
      smsLimit: planConfig.smsLimit,
      usage: { emails: 0, sms: 0 },
      payboxTransactionId: transaction_id,
      orderId
    };
    
    saveData();
    
    // Mark order as completed
    pendingOrders[orderId].status = 'completed';
    pendingOrders[orderId].licenseKey = licenseKey;
    
    // Send license by email
    const emailHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
          <h1 style="color: #ffd700; text-align: center;">🎟️ ברוך הבא!</h1>
          <p style="text-align: center; color: #ccc;">תודה שנרשמת להתראות כרטיסים של בית"ר ירושלים!</p>
          
          <div style="background: #222; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 0; color: #888;">מפתח הרשיון שלך:</p>
            <p style="font-size: 1.5em; color: #ffd700; font-family: monospace; margin: 10px 0; word-break: break-all;">
              ${licenseKey}
            </p>
          </div>
          
          <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0;">
            <p style="margin: 5px 0;">📅 תוקף: עד ${expiresAt.toLocaleDateString('he-IL')}</p>
            <p style="margin: 5px 0;">📱 SMS נותרו: ${planConfig.smsLimit}</p>
            <p style="margin: 5px 0;">📧 אימייל: ללא הגבלה</p>
          </div>
          
          <h3 style="color: #ffd700; margin-top: 30px;">איך להשתמש:</h3>
          <ol style="color: #ccc; line-height: 2;">
            <li>התקן את התוסף לכרום</li>
            <li>פתח את התוסף ולחץ על "SMS בתשלום"</li>
            <li>הכנס את מפתח הרשיון</li>
            <li>זהו! תקבל SMS כשיש כרטיסים</li>
          </ol>
          
          <p style="text-align: center; margin-top: 30px; color: #888;">
            💛🖤 בהצלחה במשחקים!
          </p>
        </div>
      </body>
      </html>
    `;
    
    await sendEmail(pendingOrder.email, '🎟️ מפתח הרשיון שלך - בית"ר ירושלים', emailHtml);
    
    // Also send SMS with license key
    await sendSMS(pendingOrder.phone, `בית"ר: מפתח הרשיון שלך: ${licenseKey}`);
    
    console.log(`✅ License ${licenseKey} created for ${pendingOrder.email} via PayBox webhook`);
    
  } else {
    // No pending order - create license from PayBox data directly
    if (customer_email && (status === 'approved' || status === 'success')) {
      const plan = amount >= 150 ? 'yearly' : 'monthly';
      const planConfig = plan === 'yearly' ? PRICING.yearly : PRICING.monthly;
      
      const licenseKey = generateLicenseKey();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + planConfig.days);
      
      // Format phone if provided
      let phone = customer_phone || '';
      if (phone) {
        phone = phone.replace(/\D/g, '');
        if (phone.startsWith('0')) {
          phone = '+972' + phone.substring(1);
        } else if (!phone.startsWith('+')) {
          phone = '+972' + phone;
        }
      }
      
      data.licenses[licenseKey] = {
        key: licenseKey,
        userName: customer_email.split('@')[0],
        plan,
        userEmail: customer_email,
        userPhone: phone,
        active: true,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        smsRemaining: planConfig.smsLimit,
        smsLimit: planConfig.smsLimit,
        usage: { emails: 0, sms: 0 },
        payboxTransactionId: transaction_id
      };
      
      saveData();
      
      // Send email with license
      const emailHtml = `
        <div dir="rtl" style="font-family: Arial; padding: 20px;">
          <h1 style="color: #ffd700;">🎟️ מפתח הרשיון שלך</h1>
          <p style="font-size: 1.5em; background: #f5f5f5; padding: 15px; border-radius: 8px; font-family: monospace;">
            ${licenseKey}
          </p>
          <p>העתק את המפתח והכנס אותו בתוסף כדי לקבל SMS.</p>
        </div>
      `;
      
      await sendEmail(customer_email, '🎟️ מפתח הרשיון שלך - בית"ר', emailHtml);
      
      console.log(`✅ License ${licenseKey} created for ${customer_email} from PayBox direct`);
    }
  }
  
  res.json({ success: true });
});

// Also support GET for webhook (some providers use GET)
app.get('/webhook/paybox', (req, res) => {
  console.log('📥 PayBox Webhook GET:', req.query);
  // Process same as POST
  req.body = req.query;
  return app._router.handle(req, res, () => {});
});

// Payment complete page - shown after user returns from PayBox
app.get('/payment-complete', async (req, res) => {
  const orderId = req.query.order;
  
  // Find pending order
  const pendingOrder = pendingOrders[orderId];
  
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>אישור תשלום - בית"ר ירושלים</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: #000;
      min-height: 100vh; 
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container { 
      max-width: 500px; 
      text-align: center;
      background: rgba(255,255,255,0.05);
      padding: 40px;
      border-radius: 20px;
      border: 2px solid #ffd700;
    }
    h1 { color: #ffd700; margin-bottom: 20px; }
    p { color: #ccc; margin-bottom: 20px; line-height: 1.6; }
    .btn {
      display: inline-block;
      padding: 15px 40px;
      background: linear-gradient(135deg, #ffd700, #ffaa00);
      color: #000;
      text-decoration: none;
      border-radius: 30px;
      font-weight: bold;
      font-size: 1.1em;
      cursor: pointer;
      border: none;
      margin: 10px;
    }
    .btn:hover { transform: scale(1.05); }
    .btn-secondary { background: #333; color: #fff; }
    .status { margin: 20px 0; padding: 15px; border-radius: 10px; }
    .status.pending { background: rgba(251,191,36,0.2); border: 1px solid #fbbf24; }
    .status.completed { background: rgba(74,222,128,0.2); border: 1px solid #4ade80; }
    .status.not-found { background: rgba(255,107,107,0.2); border: 1px solid #ff6b6b; }
    .license-key { 
      font-family: monospace; 
      font-size: 1.3em; 
      color: #ffd700; 
      background: #222;
      padding: 15px;
      border-radius: 10px;
      margin: 15px 0;
      word-break: break-all;
    }
    #result { margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎟️ אישור תשלום</h1>
    
    ${pendingOrder ? `
      ${pendingOrder.status === 'completed' ? `
        <div class="status completed">
          <p>✅ התשלום אושר! הרישיון שלך:</p>
          <div class="license-key">${pendingOrder.licenseKey || 'בודק...'}</div>
          <p>נשלח גם לאימייל: ${pendingOrder.email}</p>
        </div>
      ` : `
        <div class="status pending">
          <p>⏳ ההזמנה שלך נמצאה!</p>
          <p><strong>אימייל:</strong> ${pendingOrder.email}</p>
          <p><strong>תוכנית:</strong> ${pendingOrder.plan === 'yearly' ? 'שנתי' : 'חודשי'}</p>
          <p><strong>מחיר:</strong> ₪${pendingOrder.finalPrice}</p>
        </div>
        
        <p>אם שילמת בהצלחה, לחץ על הכפתור להפעלת הרישיון:</p>
        <button class="btn" onclick="activateLicense()">🚀 הפעל את הרישיון שלי</button>
        <div id="result"></div>
        
        <p style="margin-top: 30px; font-size: 0.9em; color: #888;">
          לא שילמת עדיין? <a href="/pricing" style="color: #ffd700;">חזור לדף המחירים</a>
        </p>
      `}
    ` : `
      <div class="status not-found">
        <p>❌ לא נמצאה הזמנה</p>
        <p>אם שילמת ולא קיבלת רישיון, פנה אלינו.</p>
      </div>
      <a href="/pricing" class="btn">חזרה למחירים</a>
    `}
    
    <p style="margin-top: 30px; color: #666;">💛🖤 צהוב זה הצבע!</p>
  </div>
  
  <script>
    async function activateLicense() {
      const resultDiv = document.getElementById('result');
      resultDiv.innerHTML = '<p style="color: #fbbf24;">⏳ מפעיל רישיון...</p>';
      
      try {
        const res = await fetch('/api/activate-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: '${orderId}' })
        });
        const data = await res.json();
        
        if (data.success) {
          resultDiv.innerHTML = \`
            <div style="background: rgba(74,222,128,0.2); padding: 20px; border-radius: 10px; margin-top: 15px;">
              <p style="color: #4ade80; font-size: 1.2em;">✅ הרישיון הופעל בהצלחה!</p>
              <p style="margin-top: 10px;">מפתח הרישיון שלך:</p>
              <div class="license-key">\${data.licenseKey}</div>
              <p style="color: #888;">נשלח גם לאימייל ול-SMS</p>
            </div>
          \`;
        } else {
          resultDiv.innerHTML = '<p style="color: #ff6b6b;">❌ ' + (data.error || 'שגיאה') + '</p>';
        }
      } catch (e) {
        resultDiv.innerHTML = '<p style="color: #ff6b6b;">❌ שגיאה: ' + e.message + '</p>';
      }
    }
  </script>
</body>
</html>
  `);
});

// API to manually activate an order (after payment confirmed)
app.post('/api/activate-order', async (req, res) => {
  const { orderId } = req.body;
  
  const pendingOrder = pendingOrders[orderId];
  
  if (!pendingOrder) {
    return res.status(404).json({ error: 'הזמנה לא נמצאה' });
  }
  
  if (pendingOrder.status === 'completed') {
    return res.json({ success: true, licenseKey: pendingOrder.licenseKey, message: 'הרישיון כבר הופעל' });
  }
  
  // Create license
  const plan = pendingOrder.plan;
  const planConfig = plan === 'yearly' ? PRICING.yearly : PRICING.monthly;
  
  const licenseKey = generateLicenseKey();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + planConfig.days);
  
  data.licenses[licenseKey] = {
    key: licenseKey,
    userName: pendingOrder.name || pendingOrder.email.split('@')[0],
    plan,
    userEmail: pendingOrder.email,
    userPhone: pendingOrder.phone,
    active: true,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    smsRemaining: planConfig.smsLimit,
    smsLimit: planConfig.smsLimit,
    usage: { emails: 0, sms: 0 },
    orderId,
    activatedBy: 'user-confirm'
  };
  
  await saveData();
  
  // Mark order as completed
  pendingOrders[orderId].status = 'completed';
  pendingOrders[orderId].licenseKey = licenseKey;
  
  // Send license by email
  const emailHtml = `
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head><meta charset="UTF-8"></head>
    <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
      <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
        <h1 style="color: #ffd700; text-align: center;">🎟️ ברוך הבא!</h1>
        <p style="text-align: center; color: #ccc;">תודה שנרשמת להתראות כרטיסים של בית"ר ירושלים!</p>
        
        <div style="background: #222; padding: 20px; border-radius: 10px; margin: 20px 0;">
          <p style="margin: 0; color: #888;">מפתח הרשיון שלך:</p>
          <p style="font-size: 1.5em; color: #ffd700; font-family: monospace; margin: 10px 0; word-break: break-all;">
            ${licenseKey}
          </p>
        </div>
        
        <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0;">
          <p style="margin: 5px 0;">📅 תוקף: עד ${expiresAt.toLocaleDateString('he-IL')}</p>
          <p style="margin: 5px 0;">📱 SMS נותרו: ${planConfig.smsLimit}</p>
          <p style="margin: 5px 0;">📧 אימייל: ללא הגבלה</p>
        </div>
        
        <h3 style="color: #ffd700; margin-top: 30px;">איך להשתמש:</h3>
        <ol style="color: #ccc; line-height: 2;">
          <li>התקן את התוסף לכרום</li>
          <li>פתח את התוסף ולחץ על "SMS בתשלום"</li>
          <li>הכנס את מפתח הרשיון</li>
          <li>זהו! תקבל SMS כשיש כרטיסים</li>
        </ol>
        
        <p style="text-align: center; margin-top: 30px; color: #888;">
          💛🖤 בהצלחה במשחקים!
        </p>
      </div>
    </body>
    </html>
  `;
  
  await sendEmail(pendingOrder.email, '🎟️ מפתח הרשיון שלך - בית"ר ירושלים', emailHtml);
  await sendSMS(pendingOrder.phone, `בית"ר: מפתח הרשיון שלך: ${licenseKey}`);
  
  console.log(`✅ License ${licenseKey} activated by user for ${pendingOrder.email}`);
  
  res.json({ success: true, licenseKey });
});

// Free license success page
app.get('/free-success', (req, res) => {
  const licenseKey = req.query.license || '';
  
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎉 מנוי חינם נוצר!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh; 
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container { 
      max-width: 500px;
      text-align: center;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      padding: 50px;
      border: 2px solid #4ade80;
    }
    .success-icon { font-size: 5em; margin-bottom: 20px; }
    h1 { color: #4ade80; margin-bottom: 15px; }
    p { color: #ccc; margin-bottom: 20px; line-height: 1.6; }
    .license-box {
      background: rgba(255,215,0,0.1);
      border: 2px solid #ffd700;
      border-radius: 15px;
      padding: 20px;
      margin: 25px 0;
    }
    .license-box label { color: #888; display: block; margin-bottom: 10px; }
    .license-key {
      font-size: 1.2em;
      font-family: monospace;
      color: #ffd700;
      background: rgba(0,0,0,0.3);
      padding: 15px;
      border-radius: 8px;
      word-break: break-all;
      cursor: pointer;
    }
    .copy-btn {
      margin-top: 10px;
      padding: 10px 20px;
      background: #ffd700;
      color: #000;
      border: none;
      border-radius: 20px;
      cursor: pointer;
      font-weight: bold;
    }
    .btn {
      display: inline-block;
      padding: 15px 40px;
      background: linear-gradient(135deg, #ffd700, #ffaa00);
      color: #000;
      text-decoration: none;
      border-radius: 30px;
      font-weight: bold;
      margin-top: 20px;
    }
    .free-badge {
      background: #4ade80;
      color: #000;
      padding: 5px 15px;
      border-radius: 20px;
      font-weight: bold;
      display: inline-block;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">🎉</div>
    <div class="free-badge">חינם!</div>
    <h1>מנוי נוצר בהצלחה!</h1>
    <p>קיבלת מנוי חינם! מפתח הרשיון נשלח גם באימייל וגם ב-SMS.</p>
    
    <div class="license-box">
      <label>מפתח הרשיון שלך:</label>
      <div class="license-key" id="licenseKey" onclick="copyLicense()">${licenseKey}</div>
      <button class="copy-btn" onclick="copyLicense()">📋 העתק</button>
    </div>
    
    <p>💡 העתק את המפתח והכנס אותו בתוסף בכרום</p>
    
    <a href="/pricing#download" class="btn">📥 הורד את התוסף</a>
  </div>
  
  <script>
    function copyLicense() {
      const license = document.getElementById('licenseKey').textContent;
      navigator.clipboard.writeText(license);
      alert('מפתח הרשיון הועתק!');
    }
  </script>
</body>
</html>
  `);
});

// Payment success page
app.get('/payment/success', (req, res) => {
  const orderId = req.query.order;
  const order = pendingOrders[orderId];
  
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>תשלום הצליח!</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh; 
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container { 
      max-width: 500px;
      text-align: center;
      background: rgba(255,255,255,0.05);
      border-radius: 20px;
      padding: 50px;
      border: 2px solid #4ade80;
    }
    .success-icon { font-size: 5em; margin-bottom: 20px; }
    h1 { color: #4ade80; margin-bottom: 15px; }
    p { color: #ccc; margin-bottom: 20px; line-height: 1.6; }
    .license-box {
      background: rgba(255,215,0,0.1);
      border: 2px solid #ffd700;
      border-radius: 15px;
      padding: 20px;
      margin: 25px 0;
    }
    .license-box label { color: #888; display: block; margin-bottom: 10px; }
    .license-key {
      font-size: 1.3em;
      font-family: monospace;
      color: #ffd700;
      background: rgba(0,0,0,0.3);
      padding: 15px;
      border-radius: 8px;
      word-break: break-all;
    }
    .btn {
      display: inline-block;
      padding: 15px 40px;
      background: linear-gradient(135deg, #ffd700, #ffaa00);
      color: #000;
      text-decoration: none;
      border-radius: 30px;
      font-weight: bold;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">✅</div>
    <h1>התשלום הצליח!</h1>
    <p>תודה רבה! מפתח הרשיון נשלח אליך באימייל ו-SMS.</p>
    
    ${order && order.licenseKey ? `
    <div class="license-box">
      <label>מפתח הרשיון שלך:</label>
      <div class="license-key">${order.licenseKey}</div>
    </div>
    ` : `
    <p>⏳ מפתח הרשיון יגיע בדקות הקרובות...</p>
    `}
    
    <p>💡 העתק את המפתח והכנס אותו בתוסף בכרום</p>
    
    <a href="/pricing#download" class="btn">📥 הורד את התוסף</a>
  </div>
</body>
</html>
  `);
});

// Get pricing info (public)
app.get('/api/pricing', (req, res) => {
  const couponCode = req.query.coupon?.toUpperCase();
  let couponInfo = null;
  
  if (couponCode) {
    const validation = validateCoupon(couponCode);
    if (validation.valid) {
      couponInfo = {
        code: couponCode,
        description: validation.coupon.description,
        discount: validation.coupon.discount,
        type: validation.coupon.type
      };
    }
  }
  
  // Calculate prices with coupon if provided
  let monthlyPrice = PRICING.monthly.price;
  let yearlyPrice = PRICING.yearly.price;
  
  if (couponInfo) {
    const monthlyValidation = validateCoupon(couponCode, 'monthly');
    const yearlyValidation = validateCoupon(couponCode, 'yearly');
    
    if (monthlyValidation.valid) {
      monthlyPrice = calculateDiscount(PRICING.monthly.price, monthlyValidation.coupon);
    }
    if (yearlyValidation.valid) {
      yearlyPrice = calculateDiscount(PRICING.yearly.price, yearlyValidation.coupon);
    }
  }
  
  res.json({
    trial: {
      name: 'ניסיון חינם',
      price: 0,
      freeSms: PRICING.trial.freeSms,
      description: `התראות ל-${PRICING.trial.freeSms} משחקים חינם`
    },
    monthly: {
      name: 'מנוי חודשי',
      price: PRICING.monthly.price,
      discountedPrice: monthlyPrice !== PRICING.monthly.price ? monthlyPrice : null,
      smsLimit: PRICING.monthly.smsLimit,
      description: `₪${PRICING.monthly.price} לחודש - עד ${PRICING.monthly.smsLimit} התראות`
    },
    yearly: {
      name: 'מנוי שנתי',
      price: PRICING.yearly.price,
      discountedPrice: yearlyPrice !== PRICING.yearly.price ? yearlyPrice : null,
      smsLimit: PRICING.yearly.smsLimit,
      savings: PRICING.monthly.price * 12 - PRICING.yearly.price,
      description: `₪${PRICING.yearly.price} לשנה - חיסכון של ₪${PRICING.monthly.price * 12 - PRICING.yearly.price}!`
    },
    coupon: couponInfo
  });
});

// Activate coupon - creates a license automatically (public endpoint)
// This allows users to enter a coupon code and get a license without manual steps
app.post('/api/coupon/activate', async (req, res) => {
  const { code, email, phone, plan = 'yearly' } = req.body;
  
  if (!code) {
    return res.status(400).json({ success: false, reason: 'לא הוזן קוד קופון' });
  }
  if (!email) {
    return res.status(400).json({ success: false, reason: 'לא הוזן אימייל' });
  }
  
  const upperCode = code.toUpperCase();
  const coupon = COUPONS[upperCode];
  
  if (!coupon) {
    return res.status(404).json({ success: false, reason: 'קופון לא נמצא' });
  }
  
  if (!coupon.active) {
    return res.status(400).json({ success: false, reason: 'קופון לא פעיל' });
  }
  
  // Check if this is a 100% discount coupon (free license)
  if (coupon.discount !== 100 || coupon.type !== 'percent') {
    return res.status(400).json({ 
      success: false, 
      reason: 'קופון זה מעניק הנחה בלבד, לא רישיון חינם. יש להשלים תשלום.',
      isCoupon: true,
      discount: coupon.discount,
      type: coupon.type
    });
  }
  
  // Check if email already has a valid license
  for (const [key, license] of Object.entries(data.licenses)) {
    if (license.userEmail?.toLowerCase() === email.toLowerCase() && license.active) {
      const expiry = new Date(license.expiresAt);
      if (expiry > new Date()) {
        // Already has valid license - return it
        return res.json({
          success: true,
          licenseKey: key,
          existing: true,
          message: 'כבר יש לך רישיון פעיל!',
          plan: license.plan,
          expiresAt: license.expiresAt,
          smsLimit: license.smsLimit,
          smsRemaining: license.smsRemaining
        });
      }
    }
  }
  
  // Create new license
  const planConfig = PRICING[plan] || PRICING.yearly;
  const licenseKey = generateLicenseKey();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + planConfig.days);
  
  data.licenses[licenseKey] = {
    key: licenseKey,
    userName: email.split('@')[0],
    plan: plan,
    userEmail: email,
    userPhone: phone || null,
    active: true,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    smsRemaining: planConfig.smsLimit,
    smsLimit: planConfig.smsLimit,
    couponUsed: upperCode,
    freeFromCoupon: true,
    usage: { emails: 0, sms: 0 }
  };
  
  saveData();
  log.success('license', `רישיון ${licenseKey} נוצר עם קופון ${upperCode} עבור ${email}`);
  
  // Send welcome email with license key
  try {
    const emailHtml = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
        <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
          <h1 style="color: #ffd700; text-align: center;">🎟️ ברוך הבא!</h1>
          <p style="text-align: center; color: #ccc;">הרישיון שלך הופעל בהצלחה!</p>
          
          <div style="background: #222; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <p style="margin: 0; color: #888;">מפתח הרישיון שלך:</p>
            <p style="font-size: 1.3em; color: #ffd700; font-family: monospace; margin: 10px 0; word-break: break-all;">
              ${licenseKey}
            </p>
          </div>
          
          <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0;">
            <p style="margin: 5px 0;">📅 תוקף: עד ${expiresAt.toLocaleDateString('he-IL')}</p>
            <p style="margin: 5px 0;">📱 SMS נותרו: ${planConfig.smsLimit}</p>
            <p style="margin: 5px 0;">📧 אימייל: ללא הגבלה</p>
          </div>
          
          <p style="text-align: center; margin-top: 30px; color: #888;">💛🖤 בהצלחה!</p>
        </div>
      </body>
      </html>
    `;
    await sendEmail(email, '🎟️ הרישיון שלך הופעל - בית"ר ירושלים', emailHtml);
  } catch (e) {
    console.error('Failed to send welcome email:', e);
  }
  
  res.json({
    success: true,
    licenseKey: licenseKey,
    existing: false,
    message: 'רישיון נוצר בהצלחה!',
    plan: plan,
    expiresAt: expiresAt.toISOString(),
    smsLimit: planConfig.smsLimit,
    smsRemaining: planConfig.smsLimit
  });
});

// Get license by email (for auto-detection in extension)
app.get('/api/license/by-email', (req, res) => {
  const email = req.query.email?.toLowerCase();
  
  if (!email) {
    return res.status(400).json({ found: false, reason: 'לא הוזן אימייל' });
  }
  
  // Find active license for this email
  for (const [key, license] of Object.entries(data.licenses)) {
    if (license.userEmail?.toLowerCase() === email && license.active) {
      const expiry = new Date(license.expiresAt);
      if (expiry > new Date()) {
        return res.json({
          found: true,
          licenseKey: key,
          plan: license.plan,
          expiresAt: license.expiresAt,
          smsLimit: license.smsLimit,
          smsRemaining: license.smsRemaining,
          smsUsed: license.usage?.sms || 0
        });
      }
    }
  }
  
  res.json({ found: false, reason: 'לא נמצא רישיון פעיל לאימייל זה' });
});

// Validate coupon code (public endpoint)
app.get('/api/coupon/validate', (req, res) => {
  const code = req.query.code?.toUpperCase();
  const plan = req.query.plan || 'monthly';
  
  if (!code) {
    return res.status(400).json({ valid: false, reason: 'לא הוזן קוד קופון' });
  }
  
  const validation = validateCoupon(code, plan);
  
  if (validation.valid) {
    const coupon = validation.coupon;
    const originalPrice = PRICING[plan]?.price || PRICING.monthly.price;
    const discountedPrice = calculateDiscount(originalPrice, coupon);
    
    res.json({
      valid: true,
      code: code,
      description: coupon.description,
      discount: coupon.discount,
      type: coupon.type,
      originalPrice: originalPrice,
      discountedPrice: discountedPrice,
      finalPrice: discountedPrice,
      savings: originalPrice - discountedPrice,
      message: coupon.description || `הנחה של ${coupon.discount}${coupon.type === 'percent' ? '%' : '₪'}`
    });
  } else {
    res.json({
      valid: false,
      reason: validation.reason
    });
  }
});

// Get all coupons (admin only)
app.get('/api/admin/coupons', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  res.json(COUPONS);
});

// Toggle coupon status (admin only)
app.post('/api/admin/coupon/toggle', (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD && adminPass !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { code, active } = req.body;
  
  if (!code || !COUPONS[code.toUpperCase()]) {
    return res.status(404).json({ error: 'קופון לא נמצא' });
  }
  
  COUPONS[code.toUpperCase()].active = active;
  
  console.log(`🎁 Coupon ${code} ${active ? 'enabled' : 'disabled'} by admin`);
  
  res.json({ 
    success: true, 
    message: `קופון ${code} ${active ? 'הופעל' : 'נוטרל'} בהצלחה`,
    coupon: COUPONS[code.toUpperCase()]
  });
});

// Create coupon (admin only)
app.post('/api/admin/coupon/create', (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD && adminPass !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { code, discount, type, description, maxUses } = req.body;
  
  if (!code || !discount) {
    return res.status(400).json({ error: 'נא להזין קוד קופון ואחוז הנחה' });
  }
  
  const couponCode = code.toUpperCase();
  
  if (COUPONS[couponCode]) {
    return res.status(400).json({ error: 'קופון עם קוד זה כבר קיים' });
  }
  
  COUPONS[couponCode] = {
    discount: parseInt(discount),
    type: type || 'percent',
    description: description || `הנחה ${discount}%`,
    active: true,
    maxUses: maxUses ? parseInt(maxUses) : null,
    usedCount: 0,
    createdAt: new Date().toISOString()
  };
  
  console.log(`🎁 Coupon ${couponCode} created by admin: ${discount}% off`);
  
  res.json({ 
    success: true, 
    message: `קופון ${couponCode} נוצר בהצלחה`,
    coupon: COUPONS[couponCode]
  });
});

// Delete coupon (admin only)
app.delete('/api/admin/coupon/:code', (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD && adminPass !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { code } = req.params;
  const couponCode = code.toUpperCase();
  
  if (!COUPONS[couponCode]) {
    return res.status(404).json({ error: 'קופון לא נמצא' });
  }
  
  delete COUPONS[couponCode];
  
  console.log(`🗑️ Coupon ${couponCode} deleted by admin`);
  
  res.json({ 
    success: true, 
    message: `קופון ${couponCode} נמחק בהצלחה`
  });
});

// Update subscriber (admin only)
app.put('/api/admin/subscriber/:id', async (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD && adminPass !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { id } = req.params;
  const subscriberId = id.toLowerCase();
  const { phone, smsEnabled, vip, newEmail } = req.body;
  
  if (!data.subscribers[subscriberId]) {
    return res.status(404).json({ error: 'מנוי לא נמצא' });
  }
  
  // Update fields
  if (phone !== undefined) data.subscribers[subscriberId].phone = phone;
  if (smsEnabled !== undefined) data.subscribers[subscriberId].smsEnabled = smsEnabled;
  if (vip !== undefined) data.subscribers[subscriberId].vip = vip;
  
  // If changing email, move to new key
  if (newEmail && newEmail.toLowerCase() !== subscriberId) {
    const newId = newEmail.toLowerCase();
    if (data.subscribers[newId]) {
      return res.status(400).json({ error: 'אימייל זה כבר קיים במערכת' });
    }
    data.subscribers[newId] = { ...data.subscribers[subscriberId] };
    delete data.subscribers[subscriberId];
    console.log(`📝 Subscriber ${subscriberId} email changed to ${newId}`);
  }
  
  await saveData();
  
  console.log(`📝 Subscriber ${subscriberId} updated by admin`);
  
  res.json({ 
    success: true, 
    message: `מנוי עודכן בהצלחה`
  });
});

// Delete subscriber (admin only)
app.post('/api/admin/subscriber/delete', async (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD && adminPass !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { email } = req.body;
  const subscriberId = email?.toLowerCase();
  
  if (!subscriberId || !data.subscribers[subscriberId]) {
    return res.status(404).json({ error: 'מנוי לא נמצא' });
  }
  
  delete data.subscribers[subscriberId];
  await saveData();
  
  console.log(`🗑️ Subscriber ${subscriberId} deleted by admin`);
  
  res.json({ 
    success: true, 
    message: `מנוי ${subscriberId} נמחק בהצלחה`
  });
});

// Remove game from subscriber's monitored games (admin only)
app.post('/api/admin/subscriber/remove-game', async (req, res) => {
  const adminPass = req.query.p || req.query.password || req.headers['x-admin-password'];
  if (adminPass !== process.env.ADMIN_PASSWORD && adminPass !== 'BeitarAdmin123!') {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { subscriberEmail, gameId } = req.body;
  const subscriberId = subscriberEmail?.toLowerCase();
  
  if (!subscriberId || !data.subscribers[subscriberId]) {
    return res.status(404).json({ error: 'מנוי לא נמצא' });
  }
  
  if (!gameId) {
    return res.status(400).json({ error: 'מזהה משחק לא סופק' });
  }
  
  const subscriber = data.subscribers[subscriberId];
  if (!subscriber.monitoredGames || subscriber.monitoredGames.length === 0) {
    return res.status(404).json({ error: 'למנוי אין משחקים במעקב' });
  }
  
  const originalLength = subscriber.monitoredGames.length;
  subscriber.monitoredGames = subscriber.monitoredGames.filter(g => g.id !== gameId);
  
  if (subscriber.monitoredGames.length === originalLength) {
    return res.status(404).json({ error: 'משחק לא נמצא במעקב של המנוי' });
  }
  
  await saveData();
  
  log.info('admin', `משחק ${gameId} הוסר מהמעקב של ${subscriberId}`);
  
  res.json({ 
    success: true, 
    message: `משחק הוסר מהמעקב בהצלחה`
  });
});

// Create new license (admin only)
app.post('/api/admin/licenses', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { userName, userEmail, userPhone, plan } = req.body;
  
  // Phone is required
  if (!userPhone) {
    return res.status(400).json({ error: 'מספר טלפון נדרש' });
  }
  
  const licenseKey = generateLicenseKey();
  const now = new Date();
  
  // Set expiry and limits based on plan
  let expiresAt = null;
  let smsLimit = 0; // Free plan = no SMS
  
  if (plan === 'monthly') {
    expiresAt = new Date(now.getTime() + PRICING.monthly.days * 24 * 60 * 60 * 1000);
    smsLimit = PRICING.monthly.smsLimit;
  } else if (plan === 'yearly') {
    expiresAt = new Date(now.getTime() + PRICING.yearly.days * 24 * 60 * 60 * 1000);
    smsLimit = PRICING.yearly.smsLimit;
  }
  
  data.licenses[licenseKey] = {
    key: licenseKey,
    userName: userName || 'Unknown',
    userEmail: userEmail || '',
    userPhone: userPhone || '',
    plan: plan || 'free',
    active: true,
    createdAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    smsLimit: smsLimit,
    usage: { emails: 0, sms: 0 },
    lastUsed: null
  };
  
  saveData();
  
  // Send welcome email with license key
  if (userEmail) {
    sendWelcomeEmail(data.licenses[licenseKey]);
  }
  
  res.json({ 
    success: true, 
    license: data.licenses[licenseKey],
    message: `רישיון נוצר: ${licenseKey}`
  });
});

// Send welcome email with license key
async function sendWelcomeEmail(license) {
  if (!emailTransporter) return;
  
  const planName = license.plan === 'monthly' ? 'חודשי' : license.plan === 'yearly' ? 'שנתי VIP 🖤💛' : 'לצמיתות';
  
  const htmlContent = `
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; background: #000; color: #fff; padding: 20px; margin: 0; }
        .container { max-width: 400px; margin: 0 auto; background: #111; border-radius: 12px; padding: 25px; border: 2px solid #ffd700; }
        h1 { color: #ffd700; text-align: center; margin: 0 0 15px 0; font-size: 22px; }
        .key { background: #1a1a1a; padding: 15px; border-radius: 8px; text-align: center; border: 2px dashed #ffd700; margin: 15px 0; }
        .key span { font-family: monospace; font-size: 16px; color: #ffd700; }
        .info { color: #aaa; font-size: 14px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎟️ ברוכים הבאים!</h1>
        <div class="key">
          <span>${license.key}</span>
        </div>
        <p class="info">תוכנית: ${planName}<br>SMS: ${license.smsLimit} הודעות</p>
      </div>
    </body>
    </html>
  `;
  
  try {
    await emailTransporter.sendMail({
      from: `"Beitar Ticket Monitor 🎟️" <${process.env.EMAIL_USER}>`,
      to: license.userEmail,
      subject: `🎟️ מפתח הרישיון שלך - בית"ר`,
      html: htmlContent
    });
    console.log(`📧 Welcome email sent to ${license.userEmail}`);
  } catch (error) {
    console.error(`Failed to send welcome email:`, error.message);
  }
}

// ============================================
// 📝 LOGS API (Admin only)
// ============================================

// Get server logs
app.get('/api/admin/logs', (req, res) => {
  const adminPass = req.query.password || req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { level, category, limit = 100, search } = req.query;
  
  let filteredLogs = [...serverLogs];
  
  // Filter by level
  if (level && level !== 'all') {
    filteredLogs = filteredLogs.filter(l => l.level === level);
  }
  
  // Filter by category
  if (category && category !== 'all') {
    filteredLogs = filteredLogs.filter(l => l.category === category);
  }
  
  // Search in message
  if (search) {
    const searchLower = search.toLowerCase();
    filteredLogs = filteredLogs.filter(l => 
      l.message.toLowerCase().includes(searchLower) ||
      (l.details && JSON.stringify(l.details).toLowerCase().includes(searchLower))
    );
  }
  
  // Limit results
  filteredLogs = filteredLogs.slice(0, parseInt(limit));
  
  res.json({
    total: serverLogs.length,
    filtered: filteredLogs.length,
    logs: filteredLogs
  });
});

// Clear logs (admin only)
app.delete('/api/admin/logs', (req, res) => {
  const adminPass = req.query.password || req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  serverLogs.length = 0;
  log.info('system', 'Logs cleared by admin');
  
  res.json({ success: true, message: 'הלוגים נמחקו' });
});

// Get all licenses (admin only)
app.get('/api/admin/licenses', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const licenses = Object.values(data.licenses).map(lic => ({
    ...lic,
    isExpired: lic.expiresAt && new Date(lic.expiresAt) < new Date(),
    daysLeft: lic.expiresAt ? Math.ceil((new Date(lic.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)) : 'unlimited'
  }));
  
  res.json(licenses);
});

// Update license (admin only)
app.put('/api/admin/licenses/:key', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { key } = req.params;
  const { active, expiresAt, smsLimit, extendDays, upgradePlan } = req.body;
  
  if (!data.licenses[key]) {
    return res.status(404).json({ error: 'License not found' });
  }
  
  if (active !== undefined) data.licenses[key].active = active;
  if (expiresAt) data.licenses[key].expiresAt = expiresAt;
  if (smsLimit) data.licenses[key].smsLimit = smsLimit;
  
  // Upgrade trial to paid plan
  if (upgradePlan && (upgradePlan === 'monthly' || upgradePlan === 'yearly')) {
    const now = new Date();
    const planConfig = PRICING[upgradePlan];
    
    data.licenses[key].plan = upgradePlan;
    data.licenses[key].expiresAt = new Date(now.getTime() + planConfig.days * 24 * 60 * 60 * 1000).toISOString();
    data.licenses[key].smsLimit = planConfig.smsLimit;
    data.licenses[key].usage.sms = 0; // Reset SMS count for new plan
  }
  
  // Extend license
  if (extendDays) {
    const currentExpiry = data.licenses[key].expiresAt ? new Date(data.licenses[key].expiresAt) : new Date();
    const newExpiry = new Date(currentExpiry.getTime() + extendDays * 24 * 60 * 60 * 1000);
    data.licenses[key].expiresAt = newExpiry.toISOString();
  }
  
  saveData();
  
  res.json({ success: true, license: data.licenses[key] });
});

// Fix old licenses - add missing key and userName (admin only)
app.post('/api/admin/fix-licenses', async (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'BeitarAdmin123!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  let fixed = 0;
  
  for (const [licenseKey, license] of Object.entries(data.licenses)) {
    let needsSave = false;
    
    // Add missing key field
    if (!license.key) {
      license.key = licenseKey;
      needsSave = true;
    }
    
    // Add missing userName field
    if (!license.userName) {
      license.userName = license.userEmail ? license.userEmail.split('@')[0] : 'Unknown';
      needsSave = true;
    }
    
    // Add missing usage field
    if (!license.usage) {
      license.usage = { emails: 0, sms: 0 };
      needsSave = true;
    }
    
    if (needsSave) {
      fixed++;
    }
  }
  
  if (fixed > 0) {
    await saveData();
  }
  
  res.json({ success: true, message: `Fixed ${fixed} licenses`, total: Object.keys(data.licenses).length });
});

// Delete license (admin only)
app.delete('/api/admin/licenses/:key', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { key } = req.params;
  
  if (!data.licenses[key]) {
    return res.status(404).json({ error: 'License not found' });
  }
  
  delete data.licenses[key];
  saveData();
  
  res.json({ success: true, message: 'License deleted' });
});

// Validate license (public - used by extension)
app.get('/api/license/validate', (req, res) => {
  const licenseKey = req.headers['x-license-key'] || req.query.licenseKey;
  
  if (!licenseKey) {
    return res.status(400).json({ valid: false, reason: 'No license key provided' });
  }
  
  // Check if this is a coupon code (not a license)
  const upperKey = licenseKey.toUpperCase();
  if (COUPONS[upperKey]) {
    return res.status(403).json({
      valid: false,
      reason: 'זהו קוד קופון ולא מפתח רישיון. הכנס את הקוד בשלב הרישום.',
      isCoupon: true,
      couponCode: upperKey
    });
  }
  
  const result = isLicenseValid(licenseKey);
  
  if (result.valid) {
    const license = result.license;
    const isTrial = license.plan === 'trial';
    
    res.json({
      valid: true,
      userName: license.userName,
      userEmail: license.userEmail,
      userPhone: license.userPhone,
      plan: license.plan,
      planName: PRICING[license.plan]?.name || license.plan,
      expiresAt: license.expiresAt,
      isTrial: isTrial,
      daysLeft: isTrial ? null : (license.expiresAt ? 
        Math.ceil((new Date(license.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)) : 
        'unlimited'),
      smsUsed: license.usage?.sms || 0,
      smsLimit: license.smsLimit,
      smsLeft: isTrial ? (PRICING.trial.freeSms - (license.usage?.sms || 0)) : (license.smsLimit - (license.usage?.sms || 0))
    });
  } else {
    res.status(403).json({
      valid: false,
      reason: result.reason,
      trialEnded: result.trialEnded || false,
      renewUrl: process.env.PAYBOX_URL || 'https://paybox.me/YOUR_LINK'
    });
  }
});

// Send reminder email manually (admin only)
app.post('/api/admin/licenses/:key/remind', async (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { key } = req.params;
  const license = data.licenses[key];
  
  if (!license) {
    return res.status(404).json({ error: 'License not found' });
  }
  
  if (!license.userEmail) {
    return res.status(400).json({ error: 'License has no email' });
  }
  
  const daysLeft = license.expiresAt ? 
    Math.ceil((new Date(license.expiresAt) - new Date()) / (1000 * 60 * 60 * 24)) : 
    null;
  
  const success = await sendExpiryReminder(license, daysLeft || 'לא ידוע');
  
  res.json({ 
    success, 
    message: success ? 'תזכורת נשלחה בהצלחה' : 'שגיאה בשליחת תזכורת' 
  });
});

// Resend welcome email (admin only)
app.post('/api/admin/licenses/:key/welcome', async (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  const { key } = req.params;
  const license = data.licenses[key];
  
  if (!license) {
    return res.status(404).json({ error: 'License not found' });
  }
  
  if (!license.userEmail) {
    return res.status(400).json({ error: 'License has no email' });
  }
  
  await sendWelcomeEmail(license);
  
  res.json({ success: true, message: 'אימייל ברוכים הבאים נשלח' });
});

// Run initial license check on startup
setTimeout(checkLicenseExpiry, 5000);

// Initialize services and start server
setupEmailTransporter();
setup019SMS();

// ============================================
// 🔄 SERVER-SIDE TICKET MONITORING (24/7)
// ============================================

const LEAAN_URL = 'https://www.leaan.co.il/category/%D7%A1%D7%A4%D7%95%D7%A8%D7%98';
const CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

// Parse tickets from leaan.co.il HTML - looking for Beitar Jerusalem games
function parseTicketsFromHtml(html) {
  const games = [];
  
  // CRITICAL FIX: Convert HTML entities to actual characters
  // leaan.co.il uses &quot; in HTML elements (4 occurrences) and ״ (U+05F4 Hebrew Gershayim) in JSON data (9 occurrences)
  // Without this conversion, the regex won't find games like "בית"ר ירושלים - הפועל חיפה"
  html = html.replace(/&quot;/g, '"');
  
  // Look for Beitar Jerusalem games specifically
  // The HTML shows games like "בית"ר ירושלים - הפועל חיפה"
  const beitarPattern = /בית["\u0022\u05F4]ר\s*ירושלים/gi;
  
  // Find all game sections
  const gameSections = html.split(/####|<\/article>|<\/div>\s*<div[^>]*class="[^"]*game/i);
  
  for (const section of gameSections) {
    // Check if this section mentions Beitar Jerusalem
    if (beitarPattern.test(section)) {
      // Reset the regex
      beitarPattern.lastIndex = 0;
      
      // Check if NOT sold out
      const isSoldOut = /SOLD\s*OUT|אזל|נמכר/i.test(section);
      
      // Extract game name
      const nameMatch = section.match(/בית["\u0022\u05F4]ר\s*ירושלים\s*[-–]\s*([^\n<]+)/i) ||
                        section.match(/([^\n<]+)\s*[-–]\s*בית["\u0022\u05F4]ר\s*ירושלים/i);
      
      // Extract link
      const linkMatch = section.match(/href="([^"]*beitar[^"]*|[^"]*%D7%91%D7%99%D7%AA%D7%A8[^"]*)"/i) ||
                        section.match(/לפרטים נוספים[^<]*<.*?href="([^"]+)"/i);
      
      const gameName = nameMatch ? nameMatch[0].trim() : 'משחק בית"ר ירושלים';
      const gameUrl = linkMatch ? linkMatch[1] : null;
      
      // Create stable ID based on game name (not timestamp!)
      const stableId = gameUrl || `beitar-${gameName.replace(/[^א-תa-zA-Z0-9]/g, '-').toLowerCase()}`;
      
      games.push({
        id: stableId,
        name: gameName.replace(/<[^>]+>/g, '').trim(),
        ticketUrl: gameUrl ? (gameUrl.startsWith('http') ? gameUrl : `https://www.leaan.co.il${gameUrl}`) : 'https://www.leaan.co.il/category/%D7%A1%D7%A4%D7%95%D7%A8%D7%98',
        available: !isSoldOut,
        soldOut: isSoldOut
      });
    }
  }
  
  // Deduplicate by name
  const uniqueGames = [];
  const seenNames = new Set();
  for (const game of games) {
    if (!seenNames.has(game.name)) {
      seenNames.add(game.name);
      uniqueGames.push(game);
    }
  }
  
  return uniqueGames;
}

// Update hasTickets status for all subscribers' monitored games
async function updateHasTicketsStatus(availableGames) {
  const subscribers = data.subscribers || {};
  let updatedCount = 0;
  
  console.log(`🎫 Updating hasTickets status for ${availableGames.length} available games...`);
  
  for (const [subscriberId, subscriber] of Object.entries(subscribers)) {
    if (!subscriber.monitoredGames || subscriber.monitoredGames.length === 0) continue;
    
    for (const game of subscriber.monitoredGames) {
      if (game.hasTickets) continue; // Already marked as available
      
      // Check if this game matches any available game
      const isAvailable = availableGames.some(availableGame => {
        // Match by ID
        if (availableGame.id && game.id && availableGame.id === game.id) return true;
        
        // Match by event date (within same day)
        if (availableGame.eventDate && game.eventDate) {
          const availableDate = new Date(availableGame.eventDate).toDateString();
          const gameDate = new Date(game.eventDate).toDateString();
          if (availableDate === gameDate) return true;
        }
        
        // Match by opponent name (partial match)
        if (availableGame.name && game.opponent) {
          const availableName = availableGame.name.toLowerCase();
          const opponent = game.opponent.toLowerCase();
          if (availableName.includes(opponent) || opponent.includes(availableName.split(' ').pop())) return true;
        }
        
        // Match by game name similarity
        if (availableGame.name && game.name) {
          const availableName = availableGame.name.toLowerCase().replace(/[^א-תa-z0-9]/g, '');
          const gameName = game.name.toLowerCase().replace(/[^א-תa-z0-9]/g, '');
          if (availableName.includes(gameName) || gameName.includes(availableName)) return true;
        }
        
        return false;
      });
      
      if (isAvailable) {
        game.hasTickets = true;
        game.ticketsFoundAt = new Date().toISOString();
        updatedCount++;
        console.log(`  ✅ ${subscriberId}: ${game.name || game.opponent} -> hasTickets=true`);
      }
    }
  }
  
  if (updatedCount > 0) {
    await saveData();
    console.log(`🎫 Updated ${updatedCount} games with hasTickets=true`);
  }
}

// Fetch with retry logic
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      // If not OK but not a network error, return as-is
      if (attempt === maxRetries) {
        return response;
      }
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      log.warn('tickets', `ניסיון ${attempt}/${maxRetries} נכשל, מנסה שוב...`, { error: error.message });
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, attempt * 2000));
    }
  }
}

// Check for new tickets and notify subscribers
async function checkTicketsAndNotify() {
  log.info('tickets', 'בודק כרטיסים לבית"ר ירושלים...');
  
  try {
    const response = await fetchWithRetry(LEAAN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8'
      }
    });
    
    if (!response.ok) {
      log.error('tickets', `שגיאה בגישה לאתר leaan.co.il: ${response.status}`);
      return;
    }
    
    const html = await response.text();
    const allGames = parseTicketsFromHtml(html);
    
    // Filter only AVAILABLE games (not sold out)
    const availableGames = allGames.filter(g => g.available && !g.soldOut);
    
    data.lastTicketCheck = new Date().toISOString();
    
    log.info('tickets', `נמצאו ${allGames.length} משחקים, ${availableGames.length} עם כרטיסים זמינים`, 
      { total: allGames.length, available: availableGames.length });
    
    if (availableGames.length > 0) {
      // Update hasTickets for ALL subscribers' monitored games
      await updateHasTicketsStatus(availableGames);
      
      // Check for NEW games (not seen before)
      const lastKnownIds = new Set(data.lastKnownGames || []);
      const newGames = availableGames.filter(g => !lastKnownIds.has(g.id));
      
      if (newGames.length > 0) {
        log.success('tickets', `${newGames.length} משחקים חדשים עם כרטיסים!`, 
          { games: newGames.map(g => g.name) });
        
        // Notify all subscribers
        await notifyAllSubscribers(newGames);
      } else {
        log.info('tickets', 'אין משחקים חדשים (כבר נשלחו התראות)');
      }
      
      // Update known games - save full game objects for dashboard
      data.lastKnownGames = availableGames.map(g => g.id);
      data.availableGamesCache = availableGames; // Save full game data
      saveData();
    } else {
      console.log('😴 No tickets available for Beitar Jerusalem games');
      // DON'T reset lastKnownGames - keep history to avoid duplicate notifications
      // Only clear the cache since no tickets are currently available
      data.availableGamesCache = [];
      saveData();
    }
    
  } catch (error) {
    console.error('❌ Error checking tickets:', error.message);
  }
}

// Notify all registered subscribers
async function notifyAllSubscribers(games) {
  const subscribers = data.subscribers || {};
  const subscriberIds = Object.keys(subscribers).filter(id => subscribers[id].active);
  
  if (subscriberIds.length === 0) {
    console.log('📭 No active subscribers to notify');
    return;
  }
  
  log.info('email', `בודק ${subscriberIds.length} מנויים...`, { count: subscriberIds.length });
  
  let emailsSent = 0;
  let smsSent = 0;
  
  for (const subscriberId of subscriberIds) {
    const subscriber = subscribers[subscriberId];
    
    try {
      // Filter games based on subscriber's monitoredGames
      let gamesToNotify = games;
      
      if (subscriber.monitoredGames && subscriber.monitoredGames.length > 0) {
        // Subscriber has specific games - filter only those
        gamesToNotify = games.filter(game => {
          return subscriber.monitoredGames.some(monitored => {
            // Match by ID
            if (game.id && monitored.id && game.id === monitored.id) return true;
            
            // Match by name similarity
            if (game.name && monitored.name) {
              const gameName = game.name.toLowerCase().replace(/[^א-תa-z0-9]/g, '');
              const monitoredName = monitored.name.toLowerCase().replace(/[^א-תa-z0-9]/g, '');
              if (gameName.includes(monitoredName) || monitoredName.includes(gameName)) return true;
            }
            
            // Match by opponent
            if (game.name && monitored.opponent) {
              const gameName = game.name.toLowerCase();
              const opponent = monitored.opponent.toLowerCase();
              if (gameName.includes(opponent)) return true;
            }
            
            return false;
          });
        });
        
        log.info('email', `${subscriberId}: ${gamesToNotify.length}/${games.length} משחקים מתאימים למעקב`, 
          { subscriber: subscriberId, matched: gamesToNotify.length, total: games.length });
      } else {
        // No monitoredGames - subscriber hasn't selected any games, skip
        log.info('email', `${subscriberId}: אין משחקים במעקב - לא שולח התראה`, { subscriber: subscriberId });
        continue;
      }
      
      // Skip if no matching games
      if (gamesToNotify.length === 0) {
        log.info('email', `${subscriberId}: אין משחקים מתאימים - לא שולח התראה`, { subscriber: subscriberId });
        continue;
      }
      
      // Build email HTML
      const emailHtml = `
        <!DOCTYPE html>
        <html dir="rtl" lang="he">
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
          <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
            <h1 style="color: #ffd700; text-align: center;">🎟️ כרטיסים זמינים!</h1>
            <p style="text-align: center; color: #ccc;">נמצאו כרטיסים למשחקי בית"ר ירושלים!</p>
            
            ${gamesToNotify.map(g => `
              <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0; border-right: 3px solid #ffd700;">
                <div style="color: #fff; font-weight: bold;">${g.name}</div>
                ${g.ticketPrice ? `<div style="color: #ffd700;">מחיר: ${g.ticketPrice}₪</div>` : ''}
                <a href="${g.ticketUrl}" style="display: inline-block; margin-top: 10px; background: #ffd700; color: #000; padding: 8px 16px; text-decoration: none; border-radius: 20px; font-weight: bold;">לרכישה</a>
              </div>
            `).join('')}
            
            <p style="text-align: center; margin-top: 30px; color: #888;">
              💛🖤 צהוב זה הצבע!<br>
              <a href="https://server-tickets-l0rq.onrender.com/unsubscribe?email=${encodeURIComponent(subscriberId)}" style="color: #666; font-size: 12px;">להסרה מהרשימה</a>
            </p>
          </div>
        </body>
        </html>
      `;
      
      // Send to ALL emails in the subscriber's list
      const emailList = subscriber.emails || [subscriberId];
      for (const email of emailList) {
        const success = await sendEmail(email, '🎟️ כרטיסים זמינים לבית"ר ירושלים!', emailHtml);
        if (success) {
          emailsSent++;
          log.success('email', `מייל נשלח ל-${email}`);
        }
      }
      
      // Send SMS if enabled
      if (subscriber.smsEnabled && subscriber.phone && subscriber.licenseKey) {
        const licenseCheck = isLicenseValid(subscriber.licenseKey);
        if (licenseCheck.valid && licenseCheck.canSendSms) {
          // Build engaging SMS with full link (max 201 chars for 1 SMS segment in Hebrew)
          const opponent = gamesToNotify[0].name.replace(/בית"ר ירושלים[^-]*-\s*/i, '').replace(/\s*\([^)]*\)/g, '').trim();
          const price = gamesToNotify[0].ticketPrice ? ` ${gamesToNotify[0].ticketPrice}₪` : '';
          const url = gamesToNotify[0].ticketUrl || 'https://www.leaan.co.il';
          const chant = getRandomChant();
          const smsText = `🔥 כרטיסים זמינים לבית"ר!\n⚽ VS ${opponent}${price}\n🎟️ היכנסו עכשיו: ${url}\n💛🖤 ${chant}`;
          const smsSuccess = await sendSMS(subscriber.phone, smsText);
          
          if (smsSuccess) {
            smsSent++;
            // Update license usage
            if (data.licenses[subscriber.licenseKey]) {
              data.licenses[subscriber.licenseKey].usage = data.licenses[subscriber.licenseKey].usage || { sms: 0 };
              data.licenses[subscriber.licenseKey].usage.sms++;
            }
            log.success('sms', `SMS נשלח ל-${subscriber.phone}`);
          }
        }
      }
      
      // Update last notified
      data.subscribers[subscriberId].lastNotified = new Date().toISOString();
      
    } catch (error) {
      log.error('subscriber', `שגיאה בשליחת התראה ל-${subscriberId}`, { error: error.message });
    }
  }
  
  await saveData();
  log.success('email', `סיכום התראות: ${emailsSent} מיילים, ${smsSent} SMS`, { emails: emailsSent, sms: smsSent });
}

// Subscribe endpoint - register for email notifications
app.post('/api/subscribe', async (req, res) => {
  const { email, phone, licenseKey } = req.body;
  
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'אימייל לא תקין' });
  }
  
  // Format phone if provided
  let formattedPhone = null;
  if (phone) {
    formattedPhone = phone.replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '+972' + formattedPhone.substring(1);
    } else if (!formattedPhone.startsWith('+')) {
      formattedPhone = '+972' + formattedPhone;
    }
  }
  
  // Add/update subscriber
  if (!data.subscribers) data.subscribers = {};
  
  data.subscribers[email.toLowerCase()] = {
    email: email.toLowerCase(),
    phone: formattedPhone,
    licenseKey: licenseKey || null,
    active: true,
    subscribedAt: new Date().toISOString()
  };
  
  saveData();
  
  console.log(`✅ New subscriber: ${email}`);
  
  // Send confirmation email
  const confirmHtml = `
    <div dir="rtl" style="font-family: Arial; padding: 20px;">
      <h1 style="color: #ffd700;">🎟️ נרשמת בהצלחה!</h1>
      <p>תקבל התראה באימייל ברגע שיהיו כרטיסים זמינים למשחקי בית"ר ירושלים.</p>
      <p>הבדיקה מתבצעת אוטומטית כל 5 דקות, 24/7!</p>
      <p style="color: #888;">💛🖤 צהוב זה הצבע!</p>
    </div>
  `;
  
  await sendEmail(email, '✅ נרשמת להתראות כרטיסים - בית"ר ירושלים', confirmHtml);
  
  res.json({ 
    success: true, 
    message: 'נרשמת בהצלחה! תקבל התראה כשיהיו כרטיסים.' 
  });
});

// Unsubscribe endpoint
app.get('/unsubscribe', (req, res) => {
  const { email } = req.query;
  
  if (email && data.subscribers && data.subscribers[email.toLowerCase()]) {
    data.subscribers[email.toLowerCase()].active = false;
    saveData();
  }
  
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="he">
    <head><meta charset="UTF-8"><title>הסרה מהרשימה</title></head>
    <body style="font-family: Arial; text-align: center; padding: 50px; background: #1a1a2e; color: #fff;">
      <h1>✅ הוסרת מרשימת התפוצה</h1>
      <p>לא תקבל יותר התראות על כרטיסים.</p>
      <p style="margin-top: 30px;">💛🖤 להתראות!</p>
    </body>
    </html>
  `);
});

// Get monitoring status
app.get('/api/monitor/status', (req, res) => {
  res.json({
    lastCheck: data.lastTicketCheck,
    subscriberCount: Object.keys(data.subscribers || {}).filter(e => data.subscribers[e].active).length,
    lastKnownGames: data.lastKnownGames?.length || 0,
    nextCheck: 'Every 5 minutes'
  });
});

// Start the ticket monitoring interval
setInterval(checkTicketsAndNotify, CHECK_INTERVAL);

// Run first check after 10 seconds (let server start first)
setTimeout(checkTicketsAndNotify, 10000);

// Log SMS status on startup
setTimeout(() => {
  const smsStatus = checkSMSStatus();
  if (smsStatus.configured) {
    console.log(`📱 019SMS ready (sender: ${smsStatus.sender})`);
  } else {
    console.log('⚠️ 019SMS not configured');
  }
}, 5000);

console.log('🔄 Server-side ticket monitoring enabled (every 5 minutes)');

// ============================================

const licenseCount = Object.keys(data.licenses).length;
const activeLicenses = Object.values(data.licenses).filter(l => l.active).length;
const subscriberCount = Object.keys(data.subscribers || {}).length;

app.listen(PORT, () => {
  console.log(`
╔═════════════════════════════════════════════════════════╗
║     🎟️  Beitar Ticket Notification Server  🎟️           ║
╠═════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                 ║
║  Dashboard: http://localhost:${PORT}/                       ║
║                                                         ║
║  🔄 MONITORING ACTIVE - Checking every 5 minutes!       ║
║                                                         ║
║  API Endpoints:                                         ║
║  • POST /api/subscribe        - Subscribe to alerts     ║
║  • GET  /api/monitor/status   - Monitoring status       ║
║  • POST /api/notify           - Send notifications      ║
║                                                         ║
║  📊 Usage: ${String(data.usage.emailsSent).padEnd(3)} emails, ${String(data.usage.smsSent).padEnd(3)} SMS sent                ║
║  🔑 Licenses: ${String(activeLicenses).padEnd(2)}/${String(licenseCount).padEnd(2)} active                            ║
║  👥 Subscribers: ${String(subscriberCount).padEnd(3)}                                    ║
╚═════════════════════════════════════════════════════════╝
  `);
});

