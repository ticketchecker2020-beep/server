// Quick script to check extension storage values
// Run this in the extension popup DevTools console

const checkStorageValues = async () => {
  const keys = [
    'smsNotifications',
    'smsActive',  
    'userPhone',
    'licenseKey',
    'emailNotifications',
    'userEmail',
    'userEmails',
    'wizardComplete'
  ];
  
  const data = await chrome.storage.local.get(keys);
  
  console.log('=== Extension Storage Check ===');
  console.log('');
  
  // SMS-related values
  console.log('📱 SMS Settings:');
  console.log(`  smsNotifications: ${data.smsNotifications} (required for SMS)`);
  console.log(`  smsActive: ${data.smsActive}`);
  console.log(`  userPhone: ${data.userPhone || '❌ MISSING!'}`);
  console.log(`  licenseKey: ${data.licenseKey || '❌ MISSING!'}`);
  console.log('');
  
  // Email-related values
  console.log('📧 Email Settings:');
  console.log(`  emailNotifications: ${data.emailNotifications}`);
  console.log(`  userEmail: ${data.userEmail}`);
  console.log(`  userEmails: ${JSON.stringify(data.userEmails)}`);
  console.log('');
  
  // Diagnose SMS issue
  console.log('🔍 SMS Diagnosis:');
  const canSendSms = data.smsNotifications && data.licenseKey && data.userPhone;
  console.log(`  Can send SMS: ${canSendSms ? '✅ YES' : '❌ NO'}`);
  
  if (!canSendSms) {
    console.log('  Missing conditions:');
    if (!data.smsNotifications) console.log('    - smsNotifications is false/undefined');
    if (!data.licenseKey) console.log('    - licenseKey is missing');
    if (!data.userPhone) console.log('    - userPhone is missing');
  }
  
  return data;
};

// Copy this to console:
console.log(`
Copy and paste this in the popup DevTools console:

chrome.storage.local.get(['smsNotifications','smsActive','userPhone','licenseKey','emailNotifications','userEmail'], d => {
  console.log('SMS can send:', !!(d.smsNotifications && d.licenseKey && d.userPhone));
  console.log('smsNotifications:', d.smsNotifications);
  console.log('userPhone:', d.userPhone);
  console.log('licenseKey:', d.licenseKey);
});
`);
