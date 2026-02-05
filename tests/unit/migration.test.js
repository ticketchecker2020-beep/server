/**
 * Migration Tests
 * Tests for migrating from licenses+subscribers to unified users
 */

describe('Data Migration: licenses+subscribers → users', () => {
  // Mock old data structure
  const oldData = {
    subscribers: {
      // Old extension format
      'gavriel.sade@gmail.com': {
        emails: ['gavriel.sade@gmail.com'],
        phone: '0508377201',
        licenseKey: 'BEITARFOREVER', // This is a coupon, not a real license!
        smsEnabled: true,
        active: true,
        registeredAt: '2026-01-25T11:02:51.417Z',
        vip: true,
        monitoredGames: []
      },
      // Duplicate web entry for same user
      'web-1769351716543-58daynkad': {
        email: 'gavriel.sade@gmail.com',
        phone: '0508377201',
        createdAt: '2026-01-25T14:35:16.543Z',
        source: 'website',
        smsEnabled: true,
        vip: true,
        monitoredGames: [
          { id: 'game1', name: 'בית"ר - מכבי', opponent: 'מכבי' }
        ]
      },
      // Another user
      'mcnmalka@gmail.com': {
        emails: ['mcnmalka@gmail.com'],
        phone: '0546540244',
        licenseKey: 'BEITARFOREVER',
        smsEnabled: false,
        active: true
      }
    },
    licenses: {
      'BEITAR-CPAA-0Y78-5KFP-91FD': {
        key: 'BEITAR-CPAA-0Y78-5KFP-91FD',
        userName: 'gavriel.sade',
        plan: 'yearly',
        userEmail: 'gavriel.sade@gmail.com',
        userPhone: '0508377201',
        active: true,
        createdAt: '2026-01-25T11:45:33.427Z',
        expiresAt: '2027-01-25T11:45:33.427Z',
        smsRemaining: 500,
        smsLimit: 500,
        couponUsed: 'BEITARFOREVER',
        freeFromCoupon: true,
        usage: { emails: 0, sms: 5 }
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

  /**
   * Migration function
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
          licenseKey: key // Keep reference to old license
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
          if (!existing.notificationEmails.includes(e.toLowerCase())) {
            existing.notificationEmails.push(e.toLowerCase());
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
          couponUsed: sub.licenseKey === 'BEITARFOREVER' ? 'BEITARFOREVER' : null,
          monitoredGames: sub.monitoredGames || [],
          createdAt: sub.registeredAt || sub.createdAt
        };
        migrationLog.push(`Created user ${primaryEmail} from subscriber ${id}`);
      }
    }

    return { users, migrationLog };
  }

  function normalizePhone(phone) {
    if (!phone) return null;
    let normalized = phone.replace(/\D/g, '');
    if (normalized.startsWith('0')) {
      normalized = '+972' + normalized.substring(1);
    } else if (normalized.startsWith('972')) {
      normalized = '+' + normalized;
    }
    return normalized || null;
  }

  describe('migrateToUsers', () => {
    let result;

    beforeAll(() => {
      result = migrateToUsers(oldData);
    });

    test('creates correct number of unique users', () => {
      // gavriel + mcnmalka = 2 unique users (duplicates merged)
      expect(Object.keys(result.users)).toHaveLength(2);
    });

    test('Gavriel exists as single user', () => {
      expect(result.users['gavriel.sade@gmail.com']).toBeDefined();
    });

    test('Gavriel has correct plan (VIP from coupon)', () => {
      expect(result.users['gavriel.sade@gmail.com'].plan).toBe('vip');
    });

    test('Gavriel has correct SMS usage from license', () => {
      expect(result.users['gavriel.sade@gmail.com'].smsUsed).toBe(5);
    });

    test('Gavriel has merged monitoredGames from web subscriber', () => {
      expect(result.users['gavriel.sade@gmail.com'].monitoredGames).toHaveLength(1);
      expect(result.users['gavriel.sade@gmail.com'].monitoredGames[0].id).toBe('game1');
    });

    test('Gavriel has normalized phone', () => {
      expect(result.users['gavriel.sade@gmail.com'].phone).toBe('+972508377201');
    });

    test('Gavriel has license key reference', () => {
      expect(result.users['gavriel.sade@gmail.com'].licenseKey).toBe('BEITAR-CPAA-0Y78-5KFP-91FD');
    });

    test('mcnmalka exists with correct data', () => {
      const user = result.users['mcnmalka@gmail.com'];
      expect(user).toBeDefined();
      expect(user.phone).toBe('+972546540244');
      expect(user.licenseKey).toBe('BEITAR-KRZ5-X1KI-NN1E-0WUB');
    });

    test('migration log has correct entries', () => {
      expect(result.migrationLog.length).toBeGreaterThan(0);
      expect(result.migrationLog.some(l => l.includes('Merged'))).toBe(true);
    });
  });

  describe('Edge cases', () => {
    test('handles empty data', () => {
      const result = migrateToUsers({ subscribers: {}, licenses: {} });
      expect(Object.keys(result.users)).toHaveLength(0);
    });

    test('handles subscriber without license', () => {
      const data = {
        subscribers: {
          'new@user.com': {
            email: 'new@user.com',
            monitoredGames: []
          }
        },
        licenses: {}
      };
      const result = migrateToUsers(data);
      expect(result.users['new@user.com']).toBeDefined();
      expect(result.users['new@user.com'].plan).toBe('free');
    });

    test('handles license without subscriber', () => {
      const data = {
        subscribers: {},
        licenses: {
          'BEITAR-TEST-1234': {
            userEmail: 'license.only@test.com',
            plan: 'yearly'
          }
        }
      };
      const result = migrateToUsers(data);
      expect(result.users['license.only@test.com']).toBeDefined();
    });
  });
});
