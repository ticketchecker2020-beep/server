/**
 * User Lookup Tests
 * Tests the find-existing-user logic to prevent duplicates
 */

describe('User Lookup', () => {
  // Mock data structure similar to production
  const mockData = {
    subscribers: {
      // Old format from extension (emails array)
      'gavriel.sade@gmail.com': {
        emails: ['gavriel.sade@gmail.com'],
        phone: '0508377201',
        licenseKey: 'BEITARFOREVER',
        smsEnabled: true,
        active: true
      },
      // New format from website (email string)
      'web-1769351716543-58daynkad': {
        email: 'other.user@gmail.com',
        phone: '0501234567',
        createdAt: '2026-01-25T14:35:16.543Z',
        source: 'website'
      },
      // Another old format
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
        active: true
      }
    }
  };

  /**
   * Find user by email - checks both email formats
   */
  function findUserByEmail(email) {
    if (!email) return null;
    const emailLower = email.toLowerCase();
    
    for (const [id, subscriber] of Object.entries(mockData.subscribers)) {
      // Check 'email' field (string - new format)
      if (subscriber.email?.toLowerCase() === emailLower) {
        return { id, subscriber };
      }
      // Check 'emails' field (array - old format)
      if (Array.isArray(subscriber.emails)) {
        if (subscriber.emails.some(e => e.toLowerCase() === emailLower)) {
          return { id, subscriber };
        }
      }
    }
    return null;
  }

  /**
   * Find user by phone
   */
  function findUserByPhone(phone) {
    if (!phone) return null;
    const normalizedPhone = phone.replace(/\D/g, '');
    
    for (const [id, subscriber] of Object.entries(mockData.subscribers)) {
      const subPhone = (subscriber.phone || '').replace(/\D/g, '');
      if (subPhone && subPhone === normalizedPhone) {
        return { id, subscriber };
      }
    }
    return null;
  }

  /**
   * Find license by email
   */
  function findLicenseByEmail(email) {
    if (!email) return null;
    const emailLower = email.toLowerCase();
    
    for (const [key, license] of Object.entries(mockData.licenses)) {
      if (license.userEmail?.toLowerCase() === emailLower) {
        return { key, license };
      }
    }
    return null;
  }

  describe('findUserByEmail', () => {
    test('finds user with email string (new format)', () => {
      const result = findUserByEmail('other.user@gmail.com');
      expect(result).not.toBeNull();
      expect(result.id).toBe('web-1769351716543-58daynkad');
    });

    test('finds user with emails array (old format)', () => {
      const result = findUserByEmail('gavriel.sade@gmail.com');
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });

    test('finds user in emails array (secondary email)', () => {
      const result = findUserByEmail('mcn.backup@gmail.com');
      expect(result).not.toBeNull();
      expect(result.id).toBe('mcnmalka@gmail.com');
    });

    test('case insensitive search', () => {
      const result = findUserByEmail('GAVRIEL.SADE@GMAIL.COM');
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });

    test('returns null for non-existent email', () => {
      const result = findUserByEmail('nonexistent@example.com');
      expect(result).toBeNull();
    });

    test('handles null/undefined', () => {
      expect(findUserByEmail(null)).toBeNull();
      expect(findUserByEmail(undefined)).toBeNull();
      expect(findUserByEmail('')).toBeNull();
    });
  });

  describe('findUserByPhone', () => {
    test('finds user by phone', () => {
      const result = findUserByPhone('0508377201');
      expect(result).not.toBeNull();
      expect(result.subscriber.emails).toContain('gavriel.sade@gmail.com');
    });

    test('normalizes phone format', () => {
      const result = findUserByPhone('050-837-7201');
      expect(result).not.toBeNull();
    });

    test('returns null for non-existent phone', () => {
      const result = findUserByPhone('0500000000');
      expect(result).toBeNull();
    });
  });

  describe('findLicenseByEmail', () => {
    test('finds license by email', () => {
      const result = findLicenseByEmail('gavriel.sade@gmail.com');
      expect(result).not.toBeNull();
      expect(result.key).toBe('BEITAR-CPAA-0Y78-5KFP-91FD');
    });

    test('case insensitive', () => {
      const result = findLicenseByEmail('GAVRIEL.SADE@GMAIL.COM');
      expect(result).not.toBeNull();
    });

    test('returns null for non-existent', () => {
      const result = findLicenseByEmail('no.license@gmail.com');
      expect(result).toBeNull();
    });
  });

  describe('Integration: Find existing user when registering', () => {
    function findExistingUser(email, phone) {
      // Try email first
      let existing = findUserByEmail(email);
      if (existing) return existing;
      
      // Try phone
      existing = findUserByPhone(phone);
      if (existing) return existing;
      
      return null;
    }

    test('finds Gavriel by email (should not create duplicate)', () => {
      const existing = findExistingUser('gavriel.sade@gmail.com', null);
      expect(existing).not.toBeNull();
      expect(existing.id).toBe('gavriel.sade@gmail.com');
    });

    test('finds Gavriel by phone (should not create duplicate)', () => {
      const existing = findExistingUser('different@email.com', '0508377201');
      expect(existing).not.toBeNull();
      expect(existing.id).toBe('gavriel.sade@gmail.com');
    });

    test('creates new user when not found', () => {
      const existing = findExistingUser('new.user@gmail.com', '0509999999');
      expect(existing).toBeNull();
      // In real code, we'd create a new user here
    });
  });
});
