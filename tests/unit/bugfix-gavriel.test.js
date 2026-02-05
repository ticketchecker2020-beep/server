/**
 * Test that reproduces and verifies fix for Gavriel duplicate issue
 * 
 * Bug: User registered via Extension (.emails array format)
 *      Then tried to register via Website (.email string format)
 *      OLD code only checked .email → didn't find user → created duplicate
 * 
 * Fix: findExistingUser() checks BOTH .email and .emails
 */

const userManager = require('../../userManager');

// Real production data structure (anonymized)
const realProdData = {
  subscribers: {
    // Original subscriber - created via Extension (has .emails array)
    "gavriel.sade@gmail.com": {
      "emails": ["gavriel.sade@gmail.com"],
      "phone": "0508377201",
      "licenseKey": "BEITARFOREVER",
      "smsEnabled": true,
      "active": true,
      "registeredAt": "2026-01-25T11:02:51.417Z",
      "vip": true
    },
    // THE DUPLICATE - created via Website (has .email string)
    "web-1769351716543-58daynkad": {
      "email": "gavriel.sade@gmail.com",  // Same email!
      "createdAt": "2026-01-25T14:35:16.543Z",
      "source": "website",
      "monitoredGames": [
        { "id": "game-1", "name": "ביתר - מכבי" }
      ],
      "phone": "0508377201",
      "smsEnabled": true,
      "vip": true
    }
  },
  licenses: {
    "BEITAR-CPAA-0Y78-5KFP-91FD": {
      "userEmail": "gavriel.sade@gmail.com",
      "active": true
    }
  }
};

describe('Gavriel Duplicate Bug Fix', () => {
  
  describe('findExistingUser with mixed data formats', () => {
    
    test('finds user with .emails array (old Extension format)', () => {
      const result = userManager.findExistingUser(realProdData, 'gavriel.sade@gmail.com', null);
      
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });
    
    test('finds user with .email string (new Website format)', () => {
      // Create data with ONLY the web subscriber
      const webOnlyData = {
        subscribers: {
          "web-1769351716543-58daynkad": realProdData.subscribers["web-1769351716543-58daynkad"]
        }
      };
      
      const result = userManager.findExistingUser(webOnlyData, 'gavriel.sade@gmail.com', null);
      
      expect(result).not.toBeNull();
      expect(result.id).toBe('web-1769351716543-58daynkad');
    });
    
    test('finds user by phone when email not found directly', () => {
      const result = userManager.findExistingUser(realProdData, null, '0508377201');
      
      expect(result).not.toBeNull();
      // Should find one of them
      expect(['gavriel.sade@gmail.com', 'web-1769351716543-58daynkad']).toContain(result.id);
    });
    
  });
  
  describe('The actual bug scenario', () => {
    
    test('BEFORE FIX: old code would NOT find user with .emails array', () => {
      const email = 'gavriel.sade@gmail.com';
      const subscriberId = email.toLowerCase();
      
      // This is how OLD code searched:
      const subscriber = realProdData.subscribers[subscriberId];
      const oldCodeWouldFind = subscriber?.email === email;
      
      // OLD code would NOT find him because he has .emails not .email
      expect(oldCodeWouldFind).toBe(false);
    });
    
    test('AFTER FIX: new code DOES find user with .emails array', () => {
      const email = 'gavriel.sade@gmail.com';
      
      // NEW code uses findExistingUser
      const result = userManager.findExistingUser(realProdData, email, null);
      
      // NEW code finds him
      expect(result).not.toBeNull();
      expect(result.id).toBe('gavriel.sade@gmail.com');
    });
    
    test('prevents duplicate creation', () => {
      const email = 'gavriel.sade@gmail.com';
      
      // When website tries to register, findExistingUser should find existing user
      const existing = userManager.findExistingUser(realProdData, email, null);
      
      // If found, we should NOT create a new subscriber
      expect(existing).not.toBeNull();
      
      // The returned ID should be the original subscriber, not a new "web-xxx" ID
      expect(existing.id).not.toMatch(/^web-/);
      expect(existing.id).toBe(email);
    });
    
  });
  
  describe('Data cleanup verification', () => {
    
    test('identifies duplicate subscribers by email', () => {
      // Count subscribers with same email
      const emailCount = {};
      Object.entries(realProdData.subscribers).forEach(([id, sub]) => {
        const email = sub.email || (sub.emails && sub.emails[0]);
        if (email) {
          emailCount[email] = (emailCount[email] || 0) + 1;
        }
      });
      
      // Gavriel appears twice - this is the bug we're fixing
      expect(emailCount['gavriel.sade@gmail.com']).toBe(2);
    });
    
  });
  
});
