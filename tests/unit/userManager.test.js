/**
 * Tests for userManager module
 */

const {
  normalizePhone,
  findUserByEmail,
  findUserByPhone,
  findExistingUser,
  findLicenseByEmail,
  findLicenseByPhone,
  getUserPlan,
  migrateToUsers
} = require('../../userManager');

// Mock data structure similar to production
const mockData = {
  subscribers: {
    // Old format from extension (emails array)
    'gavriel.sade@gmail.com': {
      emails: ['gavriel.sade@gmail.com'],
      phone: '0508377201',
      licenseKey: 'BEITARFOREVER',
      smsEnabled: true,
      active: true,
      vip: true
    },
    // New format from website (email string)
    'web-1769351716543-58daynkad': {
      email: 'other.user@gmail.com',
      phone: '0501234567',
      createdAt: '2026-01-25T14:35:16.543Z',
      source: 'website'
    },
    // Another old format with multiple emails
    'mcnmalka@gmail.com': {
      emails: ['mcnmalka@gmail.com', 'mcn.backup@gmail.com'],
      phone: '0546540244',
      smsEnabled: false
    }
  },
  licenses: {
    'BEITAR-CPAA-0Y78-5KFP-91FD': {
      key: 'BEITAR-CPAA-0Y78-5KFP-91FD',
      userEmail: 'gavriel.sade@gmail.com',
      userPhone: '0508377201',
      plan: 'yearly',
      active: true,
      freeFromCoupon: true,
      smsLimit: 500,
      usage: { sms: 5 },
      expiresAt: '2027-01-25T11:45:33.427Z'
    },
    'BEITAR-KRZ5-X1KI-NN1E-0WUB': {
      key: 'BEITAR-KRZ5-X1KI-NN1E-0WUB',
      userEmail: 'mcnmalka@gmail.com',
      userPhone: '+972546540244',
      plan: 'yearly',
      active: true,
      smsLimit: 500,
      usage: { sms: 3 }
    }
  }
};

describe('userManager module', () => {

  describe('normalizePhone', () => {
    test('normalizes Israeli mobile number', () => {
      expect(normalizePhone('0508377201')).toBe('+972508377201');
    });

    test('normalizes number with country code', () => {
      expect(normalizePhone('972508377201')).toBe('+972508377201');
    });

    test('normalizes number with + prefix', () => {
      expect(normalizePhone('+972508377201')).toBe('+972508377201');
    });

    test('handles dashes and spaces', () => {
      expect(normalizePhone('050-837-7201')).toBe('+972508377201');
    });

    test('handles null/undefined', () => {
      expect(normalizePhone(null)).toBe(null);
      expect(normalizePhone(undefined)).toBe(null);
    });
  });

  describe('findUserByEmail', () => {
    test('finds user with email string (new format)', () => {
      const result = findUserByEmail(mockData, 'other.user@gmail.com');
      expect(result).not.toBeNull();
      expect(result.id).toBe('web-1769351716543-58daynkad');
    });

    test('finds user with emails array (old format)', () => {
      const result = findUserByEmail(mockData, 'gavriel.sade@gmail.com');
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });

    test('finds user by secondary email in array', () => {
      const result = findUserByEmail(mockData, 'mcn.backup@gmail.com');
      expect(result).not.toBeNull();
      expect(result.id).toBe('mcnmalka@gmail.com');
    });

    test('case insensitive search', () => {
      const result = findUserByEmail(mockData, 'GAVRIEL.SADE@GMAIL.COM');
      expect(result).not.toBeNull();
    });

    test('returns null for non-existent email', () => {
      expect(findUserByEmail(mockData, 'nonexistent@example.com')).toBeNull();
    });

    test('handles null/undefined', () => {
      expect(findUserByEmail(mockData, null)).toBeNull();
      expect(findUserByEmail(mockData, undefined)).toBeNull();
    });
  });

  describe('findUserByPhone', () => {
    test('finds user by phone', () => {
      const result = findUserByPhone(mockData, '0508377201');
      expect(result).not.toBeNull();
    });

    test('normalizes phone format', () => {
      const result = findUserByPhone(mockData, '050-837-7201');
      expect(result).not.toBeNull();
    });

    test('returns null for non-existent phone', () => {
      expect(findUserByPhone(mockData, '0500000000')).toBeNull();
    });
  });

  describe('findExistingUser', () => {
    test('finds by email first', () => {
      const result = findExistingUser(mockData, 'gavriel.sade@gmail.com', null);
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });

    test('falls back to phone if email not found', () => {
      const result = findExistingUser(mockData, 'different@email.com', '0508377201');
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });

    test('returns null if neither found', () => {
      const result = findExistingUser(mockData, 'new@user.com', '0509999999');
      expect(result).toBeNull();
    });
  });

  describe('findLicenseByEmail', () => {
    test('finds license by email', () => {
      const result = findLicenseByEmail(mockData, 'gavriel.sade@gmail.com');
      expect(result).not.toBeNull();
      expect(result.key).toBe('BEITAR-CPAA-0Y78-5KFP-91FD');
    });

    test('case insensitive', () => {
      const result = findLicenseByEmail(mockData, 'GAVRIEL.SADE@GMAIL.COM');
      expect(result).not.toBeNull();
    });

    test('returns null for non-existent', () => {
      expect(findLicenseByEmail(mockData, 'no.license@gmail.com')).toBeNull();
    });
  });

  describe('getUserPlan', () => {
    test('returns VIP plan for user with free coupon', () => {
      const plan = getUserPlan(mockData, 'gavriel.sade@gmail.com', null);
      expect(plan.plan).toBe('vip');
      expect(plan.isVip).toBe(true);
      expect(plan.smsEnabled).toBe(true);
      expect(plan.smsUsed).toBe(5);
    });

    test('returns yearly plan for regular license holder', () => {
      const plan = getUserPlan(mockData, 'mcnmalka@gmail.com', null);
      expect(plan.plan).toBe('yearly');
      expect(plan.smsEnabled).toBe(true);
    });

    test('returns free plan for user without license', () => {
      const plan = getUserPlan(mockData, 'other.user@gmail.com', null);
      expect(plan.plan).toBe('free');
      expect(plan.smsEnabled).toBe(false);
    });

    test('finds by phone if email not found', () => {
      const plan = getUserPlan(mockData, null, '0508377201');
      expect(plan.plan).toBe('vip');
    });
  });

  describe('migrateToUsers', () => {
    let result;

    beforeAll(() => {
      result = migrateToUsers(mockData);
    });

    test('creates correct number of unique users', () => {
      // gavriel + mcnmalka + other.user = 3 unique users
      expect(Object.keys(result.users)).toHaveLength(3);
    });

    test('Gavriel has correct plan (VIP from coupon)', () => {
      expect(result.users['gavriel.sade@gmail.com'].plan).toBe('vip');
    });

    test('Gavriel has correct SMS usage from license', () => {
      expect(result.users['gavriel.sade@gmail.com'].smsUsed).toBe(5);
    });

    test('Gavriel has normalized phone', () => {
      expect(result.users['gavriel.sade@gmail.com'].phone).toBe('+972508377201');
    });

    test('migration log has entries', () => {
      expect(result.migrationLog.length).toBeGreaterThan(0);
    });
  });
});
