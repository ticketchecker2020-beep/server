/**
 * Unit Tests for Helper Functions
 * Tests core utility functions in isolation
 */

// Mock the server's helper functions
// We'll extract these from server.js later, for now test inline implementations

describe('Helper Functions', () => {
  
  describe('extractOpponentFromName', () => {
    // Implementation to test
    function extractOpponentFromName(gameName) {
      if (!gameName) return '';
      
      // Remove extra spaces
      gameName = gameName.trim();
      
      // Try to extract opponent from game name
      // Format: "בית"ר ירושלים - מכבי תל אביב" or "הפועל חיפה - בית"ר ירושלים"
      
      // Normalize quotes
      const normalized = gameName
        .replace(/[״"''`]/g, '"')
        .replace(/בית"ר/g, 'ביתר');
      
      // Check if Beitar is first (home game)
      if (normalized.includes('ביתר ירושלים -') || normalized.includes('ביתר ירושלים נגד')) {
        // Opponent is after the dash/נגד
        const match = gameName.match(/[-–—]|נגד/);
        if (match) {
          return gameName.substring(gameName.indexOf(match[0]) + match[0].length).trim();
        }
      }
      
      // Check if Beitar is second (away game)  
      if (normalized.includes('- ביתר ירושלים') || normalized.includes('נגד ביתר ירושלים')) {
        // Opponent is before the dash/נגד
        const match = gameName.match(/[-–—]|נגד/);
        if (match) {
          return gameName.substring(0, gameName.indexOf(match[0])).trim();
        }
      }
      
      // Fallback: return the full name
      return gameName;
    }

    test('extracts opponent from home game (dash separator)', () => {
      expect(extractOpponentFromName('בית"ר ירושלים - מכבי תל אביב'))
        .toBe('מכבי תל אביב');
    });

    test('extracts opponent from away game (dash separator)', () => {
      expect(extractOpponentFromName('הפועל חיפה - בית"ר ירושלים'))
        .toBe('הפועל חיפה');
    });

    test('extracts opponent with נגד separator', () => {
      expect(extractOpponentFromName('בית"ר ירושלים נגד הפועל ירושלים'))
        .toBe('הפועל ירושלים');
    });

    test('handles empty input', () => {
      expect(extractOpponentFromName('')).toBe('');
      expect(extractOpponentFromName(null)).toBe('');
      expect(extractOpponentFromName(undefined)).toBe('');
    });

    test('handles different quote characters', () => {
      expect(extractOpponentFromName('בית״ר ירושלים - מכבי חיפה'))
        .toBe('מכבי חיפה');
    });
  });

  describe('normalizePhoneNumber', () => {
    function normalizePhoneNumber(phone) {
      if (!phone) return null;
      
      // Remove non-digits
      let normalized = phone.replace(/\D/g, '');
      
      // Handle Israeli format
      if (normalized.startsWith('0')) {
        normalized = '+972' + normalized.substring(1);
      } else if (normalized.startsWith('972')) {
        normalized = '+' + normalized;
      } else if (!normalized.startsWith('+')) {
        // Assume Israeli number without prefix
        if (normalized.length === 9) {
          normalized = '+972' + normalized;
        }
      }
      
      return normalized;
    }

    test('normalizes Israeli mobile number', () => {
      expect(normalizePhoneNumber('0508377201')).toBe('+972508377201');
    });

    test('normalizes number with country code', () => {
      expect(normalizePhoneNumber('972508377201')).toBe('+972508377201');
    });

    test('normalizes number with + prefix', () => {
      expect(normalizePhoneNumber('+972508377201')).toBe('+972508377201');
    });

    test('handles dashes and spaces', () => {
      expect(normalizePhoneNumber('050-837-7201')).toBe('+972508377201');
      expect(normalizePhoneNumber('050 837 7201')).toBe('+972508377201');
    });

    test('handles null/undefined', () => {
      expect(normalizePhoneNumber(null)).toBe(null);
      expect(normalizePhoneNumber(undefined)).toBe(null);
      expect(normalizePhoneNumber('')).toBe(null);
    });
  });

  describe('isValidEmail', () => {
    function isValidEmail(email) {
      if (!email) return false;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    }

    test('validates correct emails', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('gavriel.sade@gmail.com')).toBe(true);
      expect(isValidEmail('user+tag@domain.co.il')).toBe(true);
    });

    test('rejects invalid emails', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('missing@domain')).toBe(false);
      expect(isValidEmail('@no-local.com')).toBe(false);
      expect(isValidEmail('spaces in@email.com')).toBe(false);
    });

    test('handles null/undefined', () => {
      expect(isValidEmail(null)).toBe(false);
      expect(isValidEmail(undefined)).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('generateLicenseKey', () => {
    function generateLicenseKey() {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      const segments = [];
      for (let i = 0; i < 4; i++) {
        let segment = '';
        for (let j = 0; j < 4; j++) {
          segment += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        segments.push(segment);
      }
      return 'BEITAR-' + segments.join('-');
    }

    test('generates correct format', () => {
      const key = generateLicenseKey();
      expect(key).toMatch(/^BEITAR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    test('generates unique keys', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(generateLicenseKey());
      }
      expect(keys.size).toBe(100);
    });
  });
});
