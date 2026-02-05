/**
 * User Management Module
 * Unified user lookup and management functions
 * Replaces the split licenses/subscribers system
 */

/**
 * Normalize phone number to +972 format
 */
function normalizePhone(phone) {
  if (!phone) return null;
  let normalized = phone.toString().replace(/\D/g, '');
  if (normalized.startsWith('0')) {
    normalized = '+972' + normalized.substring(1);
  } else if (normalized.startsWith('972') && !normalized.startsWith('+972')) {
    normalized = '+' + normalized;
  }
  return normalized || null;
}

/**
 * Find user by email - checks both old and new formats
 * @param {Object} data - The data object with subscribers and licenses
 * @param {string} email - Email to search for
 * @returns {{ id: string, user: Object } | null}
 */
function findUserByEmail(data, email) {
  if (!email || !data.subscribers) return null;
  const emailLower = email.toLowerCase();
  
  for (const [id, subscriber] of Object.entries(data.subscribers)) {
    // Check 'email' field (string - new/web format)
    if (subscriber.email?.toLowerCase() === emailLower) {
      return { id, user: subscriber };
    }
    // Check 'emails' field (array - old/extension format)
    if (Array.isArray(subscriber.emails)) {
      if (subscriber.emails.some(e => e.toLowerCase() === emailLower)) {
        return { id, user: subscriber };
      }
    }
  }
  return null;
}

/**
 * Find user by phone number
 * @param {Object} data - The data object
 * @param {string} phone - Phone to search for
 * @returns {{ id: string, user: Object } | null}
 */
function findUserByPhone(data, phone) {
  if (!phone || !data.subscribers) return null;
  const normalizedPhone = normalizePhone(phone);
  
  for (const [id, subscriber] of Object.entries(data.subscribers)) {
    const subPhone = normalizePhone(subscriber.phone);
    if (subPhone && subPhone === normalizedPhone) {
      return { id, user: subscriber };
    }
  }
  return null;
}

/**
 * Find user by either email or phone
 * @param {Object} data - The data object
 * @param {string} email - Email to search for
 * @param {string} phone - Phone to search for  
 * @returns {{ id: string, user: Object } | null}
 */
function findExistingUser(data, email, phone) {
  // Try email first
  let existing = findUserByEmail(data, email);
  if (existing) return existing;
  
  // Try phone
  existing = findUserByPhone(data, phone);
  if (existing) return existing;
  
  return null;
}

/**
 * Find license by email
 * @param {Object} data - The data object
 * @param {string} email - Email to search for
 * @returns {{ key: string, license: Object } | null}
 */
function findLicenseByEmail(data, email) {
  if (!email || !data.licenses) return null;
  const emailLower = email.toLowerCase();
  
  for (const [key, license] of Object.entries(data.licenses)) {
    if (license.userEmail?.toLowerCase() === emailLower) {
      return { key, license };
    }
  }
  return null;
}

/**
 * Find license by phone
 * @param {Object} data - The data object
 * @param {string} phone - Phone to search for
 * @returns {{ key: string, license: Object } | null}
 */
function findLicenseByPhone(data, phone) {
  if (!phone || !data.licenses) return null;
  const normalizedPhone = normalizePhone(phone);
  
  for (const [key, license] of Object.entries(data.licenses)) {
    const licPhone = normalizePhone(license.userPhone);
    if (licPhone && licPhone === normalizedPhone) {
      return { key, license };
    }
  }
  return null;
}

/**
 * Get user's plan and SMS status based on subscriber + license data
 * @param {Object} data - The data object
 * @param {string} email - User's email
 * @param {string} phone - User's phone
 * @returns {{ plan: string, smsEnabled: boolean, smsLimit: number, smsUsed: number, isVip: boolean }}
 */
function getUserPlan(data, email, phone) {
  // Default free plan
  let result = {
    plan: 'free',
    smsEnabled: false,
    smsLimit: 0,
    smsUsed: 0,
    isVip: false,
    licenseKey: null
  };
  
  // Find license by email or phone
  let licenseResult = findLicenseByEmail(data, email);
  if (!licenseResult) {
    licenseResult = findLicenseByPhone(data, phone);
  }
  
  if (licenseResult) {
    const { key, license } = licenseResult;
    
    // Check if license is active and not expired
    const now = new Date();
    const expiresAt = license.expiresAt ? new Date(license.expiresAt) : null;
    const isExpired = expiresAt && expiresAt < now;
    
    if (license.active && !isExpired) {
      result.plan = license.freeFromCoupon ? 'vip' : (license.plan || 'yearly');
      result.smsEnabled = true;
      result.smsLimit = license.smsLimit || 500;
      result.smsUsed = license.usage?.sms || 0;
      result.isVip = license.freeFromCoupon === true;
      result.licenseKey = key;
    }
  }
  
  // Check subscriber VIP flag
  const user = findUserByEmail(data, email) || findUserByPhone(data, phone);
  if (user?.user?.vip) {
    result.isVip = true;
    result.plan = 'vip';
  }
  
  return result;
}

/**
 * Migrate old data format to unified users structure
 * @param {Object} oldData - Data with separate licenses and subscribers
 * @returns {{ users: Object, migrationLog: string[] }}
 */
function migrateToUsers(oldData) {
  const users = {};
  const migrationLog = [];

  // Step 1: Process all licenses first (they have the most accurate data)
  for (const [key, license] of Object.entries(oldData.licenses || {})) {
    const email = license.userEmail?.toLowerCase();
    if (!email) continue;

    if (!users[email]) {
      users[email] = {
        email: email,
        name: license.userName || email.split('@')[0],
        notificationEmails: [email],
        phone: normalizePhone(license.userPhone),
        plan: license.freeFromCoupon ? 'vip' : (license.plan || 'free'),
        smsEnabled: true,
        smsLimit: license.smsLimit || 500,
        smsUsed: license.usage?.sms || 0,
        couponUsed: license.couponUsed || null,
        monitoredGames: [],
        createdAt: license.createdAt,
        licenseKey: key,
        expiresAt: license.expiresAt
      };
      migrationLog.push(`Created user ${email} from license ${key}`);
    }
  }

  // Step 2: Process subscribers, merging with existing users
  for (const [id, sub] of Object.entries(oldData.subscribers || {})) {
    // Get email (handle both formats)
    const emails = sub.emails || (sub.email ? [sub.email] : []);
    const primaryEmail = emails[0]?.toLowerCase();
    
    if (!primaryEmail) {
      migrationLog.push(`Skipped subscriber ${id}: no email`);
      continue;
    }

    // Check if user already exists (from license)
    if (users[primaryEmail]) {
      // Merge data
      const existing = users[primaryEmail];
      
      // Add any notification emails
      emails.forEach(e => {
        const eLower = e.toLowerCase();
        if (!existing.notificationEmails.includes(eLower)) {
          existing.notificationEmails.push(eLower);
        }
      });
      
      // Merge monitored games
      if (sub.monitoredGames?.length) {
        const existingIds = new Set(existing.monitoredGames.map(g => g.id));
        sub.monitoredGames.forEach(g => {
          if (!existingIds.has(g.id)) {
            existing.monitoredGames.push(g);
          }
        });
      }
      
      // Update VIP flag if subscriber has it
      if (sub.vip) {
        existing.plan = 'vip';
      }
      
      migrationLog.push(`Merged subscriber ${id} into existing user ${primaryEmail}`);
    } else {
      // Create new user from subscriber
      users[primaryEmail] = {
        email: primaryEmail,
        name: primaryEmail.split('@')[0],
        notificationEmails: emails.map(e => e.toLowerCase()),
        phone: normalizePhone(sub.phone),
        plan: sub.vip ? 'vip' : 'free',
        smsEnabled: sub.smsEnabled || false,
        smsLimit: sub.vip ? 500 : 0,
        smsUsed: 0,
        couponUsed: (sub.licenseKey === 'BEITARFOREVER') ? 'BEITARFOREVER' : null,
        monitoredGames: sub.monitoredGames || [],
        createdAt: sub.registeredAt || sub.createdAt
      };
      migrationLog.push(`Created user ${primaryEmail} from subscriber ${id}`);
    }
  }

  return { users, migrationLog };
}

module.exports = {
  normalizePhone,
  findUserByEmail,
  findUserByPhone,
  findExistingUser,
  findLicenseByEmail,
  findLicenseByPhone,
  getUserPlan,
  migrateToUsers
};
