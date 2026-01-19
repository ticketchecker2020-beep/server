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
    apiKeys: {}
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
const PRICING = {
  trial: { name: 'ניסיון', freeSms: 4, price: 0 },
  monthly: { name: 'חודשי', days: 30, price: 50, smsLimit: 100 },
  yearly: { name: 'שנתי', days: 365, price: 400, smsLimit: 1200 }
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
  
  // Trial mode - check if free SMS used up
  if (license.plan === 'trial') {
    if (license.usage.sms >= PRICING.trial.freeSms) {
      return { 
        valid: false, 
        reason: 'תקופת הניסיון הסתיימה - נוצלו 2 ה-SMS החינמיים',
        trialEnded: true
      };
    }
    return { valid: true, license, isTrial: true, smsLeft: PRICING.trial.freeSms - license.usage.sms };
  }
  
  // Paid plans - check expiry
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
    return { valid: false, reason: 'רישיון פג תוקף' };
  }
  return { valid: true, license };
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
  const publicPaths = ['/health', '/pricing', '/register', '/coupon/validate', '/license/validate', '/admin'];
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
  if (licenseKey) {
    const validation = isLicenseValid(licenseKey);
    if (!validation.valid) {
      return res.status(403).json({ 
        error: validation.reason,
        trialEnded: validation.trialEnded || false,
        upgradeUrl: process.env.PAYBOX_URL || '/pricing'
      });
    }
    license = validation.license;
    
    // Check SMS limit for paid plans
    if (license.plan !== 'trial' && license.usage.sms >= license.smsLimit) {
      return res.status(403).json({ 
        error: 'מכסת ה-SMS החודשית הגיעה למגבלה',
        smsUsed: license.usage.sms,
        smsLimit: license.smsLimit
      });
    }
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

  // Send SMS - keep it SHORT to minimize segments (Hebrew = 67 chars per segment after first)
  if (phone) {
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
  }

  // Calculate SMS left for trial users
  let smsInfo = null;
  if (license) {
    if (license.plan === 'trial') {
      smsInfo = {
        smsLeft: PRICING.trial.freeSms - license.usage.sms,
        isTrial: true
      };
    } else {
      smsInfo = {
        smsUsed: license.usage.sms,
        smsLimit: license.smsLimit,
        isTrial: false
      };
    }
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
      smsConfigured: !!twilioClient,
      twilioNumber: process.env.TWILIO_PHONE_NUMBER ? '***' + process.env.TWILIO_PHONE_NUMBER.slice(-4) : null
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
  
  // Send welcome SMS
  if (twilioClient) {
    const welcomeMsg = isVipCoupon 
      ? `🎟️ ברוכים הבאים ל-Beitar Ticket Monitor VIP!\nמפתח הרישיון שלך: ${licenseKey}\n🖤💛 מנוי שנתי ללא הגבלה!`
      : `🎟️ ברוכים הבאים ל-Beitar Ticket Monitor!\nמפתח הרישיון שלך: ${licenseKey}\nיש לך התראות ל-${PRICING.trial.freeSms} משחקים חינם!`;
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
    ? `🖤💛 ברוכים הבאים VIP! יש לך מנוי שנתי עם התראות ללא הגבלה!`
    : `ברוכים הבאים! יש לך התראות ל-${PRICING.trial.freeSms} משחקים חינם. לאחר מכן תצטרך לשדרג לתוכנית בתשלום.`;
  
  res.json({ 
    success: true, 
    licenseKey: licenseKey,
    plan: plan,
    freeSms: smsLimit,
    couponSaved: savedCoupon,
    isVip: isVipCoupon,
    message: responseMsg
  });
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
      savings: originalPrice - discountedPrice
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
  let smsLimit = PRICING.trial.freeSms;
  
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
    plan: plan || 'trial',
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

const licenseCount = Object.keys(data.licenses).length;
const activeLicenses = Object.values(data.licenses).filter(l => l.active).length;

app.listen(PORT, () => {
  console.log(`
╔═════════════════════════════════════════════════════════╗
║     🎟️  Beitar Ticket Notification Server  🎟️           ║
╠═════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                 ║
║  Dashboard: http://localhost:${PORT}/                       ║
║                                                         ║
║  API Endpoints:                                         ║
║  • GET  /api/health           - Server status           ║
║  • GET  /api/license/validate - Check license           ║
║  • POST /api/notify           - Send notifications      ║
║                                                         ║
║  Admin Endpoints (require password):                    ║
║  • GET/POST /api/admin/licenses - Manage licenses       ║
║  • GET /api/admin/stats         - Usage statistics      ║
║                                                         ║
║  📊 Usage: ${String(data.usage.emailsSent).padEnd(3)} emails, ${String(data.usage.smsSent).padEnd(3)} SMS sent                ║
║  🔑 Licenses: ${String(activeLicenses).padEnd(2)}/${String(licenseCount).padEnd(2)} active                            ║
╚═════════════════════════════════════════════════════════╝
  `);
});
