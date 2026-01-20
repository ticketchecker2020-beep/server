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

const app = express();
const PORT = process.env.PORT || 3000;

// Data file for persistent storage
const DATA_FILE = path.join(__dirname, 'data.json');

// Load or initialize data
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading data:', e.message);
  }
  return {
    usage: {
      emailsSent: 0,
      smsSent: 0,
      emailsFailed: 0,
      smsFailed: 0,
      history: []
    },
    licenses: {},  // License management
    apiKeys: {},
    subscribers: {},  // Email subscribers for server-side monitoring
    lastTicketCheck: null,
    lastKnownGames: []
  };
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error saving data:', e.message);
  }
}

let data = loadData();

// Pricing configuration
// FREE = Email only (unlimited)
// PAID = Email + SMS
const PRICING = {
  free: { name: 'חינם', price: 0, smsLimit: 0, emailUnlimited: true },
  monthly: { name: 'SMS חודשי', days: 30, price: 29, smsLimit: 50 },
  yearly: { name: 'SMS שנתי', days: 365, price: 199, smsLimit: 500 }
};

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
  const publicPaths = ['/health', '/pricing', '/register', '/coupon/validate', '/license/validate', '/admin', '/create-pending-order', '/webhook'];
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
    ...details
  };
  
  if (type === 'email') {
    if (success) data.usage.emailsSent++;
    else data.usage.emailsFailed++;
  } else if (type === 'sms') {
    if (success) data.usage.smsSent++;
    else data.usage.smsFailed++;
  }
  
  // Keep last 100 history entries
  data.usage.history.unshift(entry);
  if (data.usage.history.length > 100) {
    data.usage.history = data.usage.history.slice(0, 100);
  }
  
  saveData();
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

// Twilio SMS setup
let twilioClient = null;

function setupTwilio() {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    try {
      const twilio = require('twilio');
      twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
      console.log('📱 Twilio SMS configured');
    } catch (error) {
      console.log('⚠️ Twilio setup failed:', error.message);
    }
  } else {
    console.log('⚠️ Twilio not configured - check .env file');
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

// Send SMS
async function sendSMS(to, message) {
  if (!twilioClient) {
    console.log('Twilio not configured, skipping SMS...');
    return false;
  }

  try {
    // Format Israeli phone number
    let phone = to.replace(/[^\d+]/g, '');
    if (phone.startsWith('0')) {
      phone = '+972' + phone.substring(1);
    } else if (!phone.startsWith('+')) {
      phone = '+972' + phone;
    }

    await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phone
    });
    console.log(`✅ SMS sent to ${phone}`);
    trackUsage('sms', true, { to: phone.substring(0, 6) + '***' });
    return true;
  } catch (error) {
    console.error(`❌ SMS failed to ${to}:`, error.message);
    trackUsage('sms', false, { error: error.message });
    return false;
  }
}

// API Routes

// Health check (public - no API key needed)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    email: !!emailTransporter,
    sms: !!twilioClient,
    timestamp: new Date().toISOString()
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

// Subscribe for notifications
app.post('/api/subscribe', (req, res) => {
  const { email, phone, games } = req.body;

  if (!email && !phone) {
    return res.status(400).json({ error: 'Email or phone required' });
  }

  const subscriberId = email || phone;
  
  subscribers.set(subscriberId, {
    email,
    phone,
    games: games || [],
    subscribedAt: new Date().toISOString()
  });

  console.log(`📝 New subscriber: ${subscriberId} (${games?.length || 0} games)`);

  res.json({
    success: true,
    message: 'Subscribed successfully',
    subscriberId
  });
});

// Unsubscribe
app.post('/api/unsubscribe', (req, res) => {
  const { email, phone } = req.body;
  const subscriberId = email || phone;

  if (subscribers.has(subscriberId)) {
    subscribers.delete(subscriberId);
    res.json({ success: true, message: 'Unsubscribed' });
  } else {
    res.status(404).json({ error: 'Subscriber not found' });
  }
});

// Update games
app.post('/api/update-games', (req, res) => {
  const { email, phone, games } = req.body;
  const subscriberId = email || phone;

  if (subscribers.has(subscriberId)) {
    const sub = subscribers.get(subscriberId);
    sub.games = games;
    subscribers.set(subscriberId, sub);
    res.json({ success: true, message: 'Games updated' });
  } else {
    res.status(404).json({ error: 'Subscriber not found' });
  }
});

// Send notification (called by extension)
app.post('/api/notify', async (req, res) => {
  const { email, phone, games, licenseKey } = req.body;

  if (!games || games.length === 0) {
    return res.status(400).json({ error: 'No games to notify about' });
  }
  
  // Validate license if provided
  let license = null;
  let canSendSms = false;
  
  if (licenseKey) {
    const validation = isLicenseValid(licenseKey);
    
    // Even if SMS expired, email still works
    if (!validation.valid && !validation.emailStillWorks) {
      return res.status(403).json({ 
        error: validation.reason,
        upgradeUrl: process.env.PAYBOX_URL || '/pricing'
      });
    }
    
    license = validation.license || data.licenses[licenseKey];
    canSendSms = validation.canSendSms || false;
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
    // Short format: "🎟️ בית"ר VS חיפה 95₪ leaan.co.il"
    const shortGames = games.slice(0, 2).map(g => {
      // Extract opponent name only
      const opponent = g.name.replace(/בית"ר ירושלים[^-]*-\s*/i, '').trim();
      const price = g.price ? ` ${g.price}₪` : '';
      return `${opponent}${price}`;
    }).join(', ');
    
    // Keep SMS under 70 chars if possible (1 segment), or under 134 (2 segments)
    const smsMessage = `🎟️ בית"ר: ${shortGames}\nleaan.co.il`;
    
    console.log(`SMS length: ${smsMessage.length} chars`);
    results.sms = await sendSMS(phone, smsMessage);
    
    // Update license usage if SMS was sent
    if (results.sms && license) {
      license.usage.sms++;
      license.lastUsed = new Date().toISOString();
      data.licenses[licenseKey] = license;
      saveData();
    }
  } else if (phone && !canSendSms) {
    // User has phone but no SMS plan
    results.smsSkipped = true;
    results.smsReason = license?.plan === 'free' ? 'תוכנית חינם - אימייל בלבד' : 'מכסת SMS נגמרה';
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

// Test email endpoint
app.post('/api/test-email', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  const success = await sendEmail(
    email,
    '🎟️ בדיקת התראות - Beitar Ticket Monitor',
    `
      <div dir="rtl" style="font-family: Arial; padding: 20px;">
        <h2 style="color: #ffd700;">בדיקת מערכת ההתראות</h2>
        <p>אם אתה רואה הודעה זו, התראות האימייל עובדות כראוי! 🎉</p>
        <p>תקבל התראה כשכרטיסים יהיו זמינים לרכישה.</p>
      </div>
    `
  );

  res.json({ success, message: success ? 'Test email sent!' : 'Failed to send test email' });
});

// Test SMS endpoint
app.post('/api/test-sms', async (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: 'Phone required' });
  }

  const success = await sendSMS(phone, '🎟️ בדיקה - Beitar Ticket Monitor פעיל! תקבל התראה כשכרטיסים יהיו זמינים.');

  res.json({ success, message: success ? 'Test SMS sent!' : 'Failed to send test SMS' });
});

// Admin Dashboard (served as static file)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Admin API - Get full stats
app.get('/api/admin/stats', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
    return res.status(401).json({ error: 'Invalid admin password' });
  }
  
  res.json({
    usage: data.usage,
    config: {
      emailConfigured: !!emailTransporter,
      smsConfigured: !!twilioClient
    }
  });
});

// Reset usage stats (admin only)
app.post('/api/admin/reset-stats', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'Beitar2024$ecure!')) {
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

// ============ LICENSE MANAGEMENT ============

// Self-registration for FREE TRIAL (public endpoint)
app.post('/api/register', (req, res) => {
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
  if (twilioClient && isVipCoupon) {
    const welcomeMsg = `🎟️ VIP! מפתח: ${licenseKey}\n🖤💛 SMS ללא הגבלה!`;
    twilioClient.messages.create({
      body: welcomeMsg,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: normalizedPhone
    }).catch(err => console.log('Welcome SMS failed:', err.message));
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
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
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
    .footer { text-align: center; margin-top: 40px; color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎟️ התראות כרטיסים בית"ר ירושלים</h1>
    <p class="subtitle">קבל התראה מיידית כשכרטיסים למשחק זמינים!</p>
    
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
      <p>💛🖤 בית"ר ירושלים - הקבוצה הכי גדולה בישראל!</p>
    </div>
  </div>
</body>
</html>
  `);
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
      plan,
      userEmail: email,
      userPhone: formattedPhone,
      active: true,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      smsRemaining: planInfo.smsLimit,
      smsLimit: planInfo.smsLimit,
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
  
  // Build PayBox URL for paid orders
  const payboxUrl = 'https://links.payboxapp.com/IdiXnIQ13Zb';
  
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
      plan,
      userEmail: pendingOrder.email,
      userPhone: pendingOrder.phone,
      active: true,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      smsRemaining: planConfig.smsLimit,
      smsLimit: planConfig.smsLimit,
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
        plan,
        userEmail: customer_email,
        userPhone: phone,
        active: true,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        smsRemaining: planConfig.smsLimit,
        smsLimit: planConfig.smsLimit,
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
setupTwilio();

// ============================================
// 🔄 SERVER-SIDE TICKET MONITORING (24/7)
// ============================================

const LEAAN_URL = 'https://www.leaan.co.il/he/org/%D7%91%D7%99%D7%AA%D7%A8-%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D';
const CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes

// Parse tickets from leaan.co.il HTML
function parseTicketsFromHtml(html) {
  const games = [];
  
  // Look for event cards with tickets available
  const eventPattern = /<a[^>]*href="([^"]*)"[^>]*class="[^"]*event-card[^"]*"[^>]*>[\s\S]*?<\/a>/gi;
  const matches = html.matchAll(eventPattern);
  
  for (const match of matches) {
    const cardHtml = match[0];
    const url = match[1];
    
    // Extract event name
    const nameMatch = cardHtml.match(/class="[^"]*event-name[^"]*"[^>]*>([^<]+)</i) ||
                      cardHtml.match(/<h[23][^>]*>([^<]+)</i);
    
    // Extract price
    const priceMatch = cardHtml.match(/(\d+)\s*₪/);
    
    // Check if tickets are available (not sold out)
    const isSoldOut = /sold.?out|אזל|נמכר/i.test(cardHtml);
    
    if (nameMatch && !isSoldOut) {
      games.push({
        id: url || `game-${Date.now()}-${games.length}`,
        name: nameMatch[1].trim(),
        ticketPrice: priceMatch ? priceMatch[1] : null,
        ticketUrl: url.startsWith('http') ? url : `https://www.leaan.co.il${url}`,
        available: true
      });
    }
  }
  
  // Fallback: look for any ticket links
  if (games.length === 0) {
    const ticketLinks = html.matchAll(/href="([^"]*ticket[^"]*)"[^>]*>([^<]*)/gi);
    for (const match of ticketLinks) {
      if (!/אזל|sold.?out/i.test(match[2])) {
        games.push({
          id: match[1],
          name: match[2].trim() || 'משחק בית"ר ירושלים',
          ticketUrl: match[1].startsWith('http') ? match[1] : `https://www.leaan.co.il${match[1]}`,
          available: true
        });
      }
    }
  }
  
  return games;
}

// Check for new tickets and notify subscribers
async function checkTicketsAndNotify() {
  console.log('🔍 [Server Monitor] Checking for tickets...');
  
  try {
    const response = await fetch(LEAAN_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'he-IL,he;q=0.9,en;q=0.8'
      }
    });
    
    if (!response.ok) {
      console.error(`❌ Failed to fetch leaan.co.il: ${response.status}`);
      return;
    }
    
    const html = await response.text();
    const games = parseTicketsFromHtml(html);
    
    data.lastTicketCheck = new Date().toISOString();
    
    if (games.length > 0) {
      console.log(`✅ Found ${games.length} games with tickets!`);
      
      // Check for NEW games (not seen before)
      const lastKnownIds = new Set(data.lastKnownGames || []);
      const newGames = games.filter(g => !lastKnownIds.has(g.id));
      
      if (newGames.length > 0) {
        console.log(`🆕 ${newGames.length} NEW games found!`);
        
        // Notify all subscribers
        await notifyAllSubscribers(newGames);
      }
      
      // Update known games
      data.lastKnownGames = games.map(g => g.id);
      saveData();
    } else {
      console.log('😴 No tickets available currently');
      data.lastKnownGames = [];
      saveData();
    }
    
  } catch (error) {
    console.error('❌ Error checking tickets:', error.message);
  }
}

// Notify all registered subscribers
async function notifyAllSubscribers(games) {
  const subscribers = data.subscribers || {};
  const subscriberCount = Object.keys(subscribers).length;
  
  if (subscriberCount === 0) {
    console.log('📭 No subscribers to notify');
    return;
  }
  
  console.log(`📧 Notifying ${subscriberCount} subscribers...`);
  
  for (const [email, subscriber] of Object.entries(subscribers)) {
    if (!subscriber.active) continue;
    
    try {
      // Send email (free for all)
      const emailHtml = `
        <!DOCTYPE html>
        <html dir="rtl" lang="he">
        <head><meta charset="UTF-8"></head>
        <body style="font-family: Arial; background: #111; color: #fff; padding: 20px;">
          <div style="max-width: 500px; margin: 0 auto; background: #1a1a1a; border-radius: 15px; padding: 30px; border: 2px solid #ffd700;">
            <h1 style="color: #ffd700; text-align: center;">🎟️ כרטיסים זמינים!</h1>
            <p style="text-align: center; color: #ccc;">נמצאו כרטיסים למשחקי בית"ר ירושלים!</p>
            
            ${games.map(g => `
              <div style="background: #222; padding: 15px; border-radius: 10px; margin: 10px 0; border-right: 3px solid #ffd700;">
                <div style="color: #fff; font-weight: bold;">${g.name}</div>
                ${g.ticketPrice ? `<div style="color: #ffd700;">מחיר: ${g.ticketPrice}₪</div>` : ''}
                <a href="${g.ticketUrl}" style="display: inline-block; margin-top: 10px; background: #ffd700; color: #000; padding: 8px 16px; text-decoration: none; border-radius: 20px; font-weight: bold;">לרכישה</a>
              </div>
            `).join('')}
            
            <p style="text-align: center; margin-top: 30px; color: #888;">
              💛🖤 צהוב זה הצבע!<br>
              <a href="https://server-tickets-l0rq.onrender.com/unsubscribe?email=${encodeURIComponent(email)}" style="color: #666; font-size: 12px;">להסרה מהרשימה</a>
            </p>
          </div>
        </body>
        </html>
      `;
      
      await sendEmail(email, '🎟️ כרטיסים זמינים לבית"ר ירושלים!', emailHtml);
      console.log(`  ✅ Email sent to ${email}`);
      
      // Send SMS if subscriber has phone AND license
      if (subscriber.phone && subscriber.licenseKey) {
        const license = data.licenses[subscriber.licenseKey];
        if (license && license.active && license.smsRemaining > 0) {
          const smsText = `בית"ר: כרטיסים זמינים! ${games[0].name} - ${games[0].ticketUrl}`;
          await sendSMS(subscriber.phone, smsText);
          
          // Decrease SMS count
          data.licenses[subscriber.licenseKey].smsRemaining--;
          saveData();
          console.log(`  ✅ SMS sent to ${subscriber.phone}`);
        }
      }
      
    } catch (error) {
      console.error(`  ❌ Failed to notify ${email}:`, error.message);
    }
  }
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

