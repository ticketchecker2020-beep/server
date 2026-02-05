/**
 * Jest Setup File
 * Runs before all tests
 */

// Set test timeout
jest.setTimeout(30000);

// Silence console.log during tests (optional)
// global.console.log = jest.fn();

// Add custom matchers if needed
expect.extend({
  toBeValidEmail(received) {
    const pass = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(received);
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid email`,
      pass
    };
  },
  
  toBeValidIsraeliPhone(received) {
    const normalized = (received || '').replace(/\D/g, '');
    const pass = /^(0|972|\+972)?5\d{8}$/.test(normalized);
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid Israeli phone`,
      pass
    };
  },
  
  toBeValidLicenseKey(received) {
    const pass = /^BEITAR-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(received);
    return {
      message: () => `expected ${received} ${pass ? 'not ' : ''}to be a valid license key`,
      pass
    };
  }
});

// Global test utilities
global.testUtils = {
  // Generate unique test email
  generateTestEmail: () => `test-${Date.now()}-${Math.random().toString(36).substr(2, 5)}@example.com`,
  
  // Generate unique test phone
  generateTestPhone: () => `050${Math.floor(1000000 + Math.random() * 9000000)}`,
  
  // Wait helper
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms))
};

// Cleanup after all tests
afterAll(async () => {
  // Add any global cleanup here
});
