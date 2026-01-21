// Beitar Ticket Monitor - Popup with Wizard
const SERVER_URL = 'https://server-tickets-l0rq.onrender.com';

// Check if running as Chrome extension or standalone
const isExtension = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

// Fan chants - random slogans for UI 🎵
const FAN_CHANTS = [
  'שבחי ירושלים הלב שלי צועק צהוב שחור',
  'אוהב מכל הלב אוהב אותך כל כך שזה כואב',
  'ללב נכנסת התאהבתי בך',
  'עכשיו עומד כאן מאוהב אריה שואג על החולצה מניף את הצעיף',
  'לא תצעדי לבד אף פעם רק אותך אני אוהב',
  'אומרים לי שאני קצת משוגע ככה זה באהבה כשאת בתוך הנשמה',
  'איתך מהיציע ועד הנצח'
];

// Get random fan chant
function getRandomChant() {
  return FAN_CHANTS[Math.floor(Math.random() * FAN_CHANTS.length)];
}

class BeitarPopup {
  constructor() {
    this.state = {
      currentStep: 1,
      selectedPlan: 'email',
      smsOption: null,
      emails: [], // Changed from email to emails array
      phone: '',
      licenseKey: '',
      smsActive: false,
      wizardComplete: false,
      checkInterval: 5
    };
    
    this.init();
  }

  async init() {
    // Load saved state from storage
    await this.loadState();
    
    // Set random fan chants
    this.updateChants();
    
    // Decide whether to show wizard or main screen
    if (this.state.wizardComplete) {
      this.showMainScreen();
    } else {
      this.showWizard();
    }
    
    // Setup all event listeners
    this.setupWizardListeners();
    this.setupMainScreenListeners();
    this.setupModalListeners();
    
    // Update last check time
    this.updateLastCheckTime();
  }
  
  updateChants() {
    // Update wizard header chant
    const wizardChant = document.getElementById('wizardChant');
    if (wizardChant) {
      wizardChant.textContent = '🎵 ' + getRandomChant();
    }
    
    // Update main screen chant
    const mainChant = document.getElementById('mainChant');
    if (mainChant) {
      mainChant.textContent = '💛🖤 ' + getRandomChant();
    }
  }

  async loadState() {
    if (isExtension) {
      const data = await chrome.storage.local.get([
        'wizardComplete',
        'userEmails',
        'userEmail', // backward compatibility
        'userPhone',
        'licenseKey',
        'smsActive',
        'checkInterval',
        'lastCheck'
      ]);
      
      this.state.wizardComplete = data.wizardComplete || false;
      // Support both old single email and new emails array
      if (data.userEmails && data.userEmails.length > 0) {
        this.state.emails = data.userEmails;
      } else if (data.userEmail) {
        this.state.emails = [data.userEmail];
      } else {
        this.state.emails = [];
      }
      this.state.phone = data.userPhone || '';
      this.state.licenseKey = data.licenseKey || '';
      this.state.smsActive = data.smsActive || false;
      this.state.checkInterval = data.checkInterval || 5;
    } else {
      // Running standalone - use localStorage for demo
      const saved = localStorage.getItem('beitarPopupState');
      if (saved) {
        const data = JSON.parse(saved);
        Object.assign(this.state, data);
        // Ensure emails is array
        if (!Array.isArray(this.state.emails)) {
          this.state.emails = this.state.emails ? [this.state.emails] : [];
        }
      }
    }
  }

  async saveState() {
    if (isExtension) {
      await chrome.storage.local.set({
        wizardComplete: this.state.wizardComplete,
        userEmails: this.state.emails,
        userEmail: this.state.emails[0] || '', // backward compatibility
        userPhone: this.state.phone,
        licenseKey: this.state.licenseKey,
        smsActive: this.state.smsActive,
        checkInterval: this.state.checkInterval,
        // Keep compatibility with old extension
        emailNotifications: this.state.emails.length > 0,
        smsNotifications: this.state.smsActive
      });
    } else {
      // Running standalone - use localStorage for demo
      localStorage.setItem('beitarPopupState', JSON.stringify(this.state));
    }
  }

  // ========== WIZARD FUNCTIONS ==========
  
  showWizard() {
    document.getElementById('wizard').classList.remove('hidden');
    document.getElementById('mainScreen').classList.remove('active');
    this.updateWizardProgress();
  }

  updateWizardProgress() {
    // Update progress dots
    document.querySelectorAll('.progress-step').forEach(step => {
      const stepNum = parseFloat(step.dataset.step);
      step.classList.remove('active', 'done');
      
      if (stepNum < this.state.currentStep) {
        step.classList.add('done');
        step.textContent = '✓';
      } else if (stepNum === Math.floor(this.state.currentStep)) {
        step.classList.add('active');
        step.textContent = Math.floor(stepNum);
      } else {
        step.textContent = Math.floor(stepNum);
      }
    });
    
    // Show correct step content
    document.querySelectorAll('.step').forEach(step => {
      step.classList.remove('active');
      if (parseFloat(step.dataset.step) === this.state.currentStep) {
        step.classList.add('active');
      }
    });
  }

  nextStep() {
    // Validation based on current step
    if (this.state.currentStep === 2) {
      const emails = this.getWizardEmails();
      if (emails.length === 0) {
        alert('נא להזין לפחות כתובת אימייל אחת');
        return;
      }
      this.state.emails = emails;
    }
    
    if (this.state.currentStep === 3) {
      if (this.state.selectedPlan === 'sms') {
        this.state.currentStep = 3.5;
        this.updateWizardProgress();
        return;
      }
    }
    
    if (this.state.currentStep === 3.5) {
      if (this.state.smsOption === 'existing') {
        const licenseKey = document.getElementById('wizardLicenseKey').value.trim();
        const phone = document.getElementById('wizardPhone').value.trim();
        
        if (!licenseKey) {
          alert('נא להזין מפתח רישיון');
          return;
        }
        if (!phone) {
          alert('נא להזין מספר טלפון');
          return;
        }
        
        this.state.licenseKey = licenseKey;
        this.state.phone = phone;
        this.state.smsActive = true;
      }
    }
    
    this.state.currentStep = Math.floor(this.state.currentStep) + 1;
    this.updateWizardProgress();
  }

  // Get emails from wizard form
  getWizardEmails() {
    const inputs = document.querySelectorAll('#wizardEmailsContainer .wizard-email-input');
    const emails = [];
    inputs.forEach(input => {
      const email = input.value.trim();
      if (email && email.includes('@')) {
        emails.push(email);
      }
    });
    return emails;
  }

  // Add email row to container
  addEmailRow(container, email = '', showRemove = true) {
    const row = document.createElement('div');
    row.className = 'email-input-row';
    row.innerHTML = `
      <input type="email" class="${container.id === 'wizardEmailsContainer' ? 'wizard-email-input' : 'modal-email-input'}" 
             placeholder="your@email.com" dir="ltr" value="${email}">
      <button class="email-remove-btn ${showRemove ? '' : 'hidden'}">✕</button>
    `;
    
    row.querySelector('.email-remove-btn').addEventListener('click', () => {
      if (container.querySelectorAll('.email-input-row').length > 1) {
        row.remove();
        this.updateRemoveButtons(container);
      }
    });
    
    container.appendChild(row);
    this.updateRemoveButtons(container);
  }

  // Update visibility of remove buttons
  updateRemoveButtons(container) {
    const rows = container.querySelectorAll('.email-input-row');
    rows.forEach(row => {
      const btn = row.querySelector('.email-remove-btn');
      if (rows.length === 1) {
        btn.classList.add('hidden');
      } else {
        btn.classList.remove('hidden');
      }
    });
  }

  selectPlan(plan) {
    this.state.selectedPlan = plan;
    document.getElementById('planEmail').classList.toggle('selected', plan === 'email');
    document.getElementById('planSms').classList.toggle('selected', plan === 'sms');
  }

  selectSmsOption(option) {
    this.state.smsOption = option;
    document.getElementById('smsExisting').classList.toggle('selected', option === 'existing');
    document.getElementById('smsBuy').classList.toggle('selected', option === 'buy');
    
    document.getElementById('existingKeySection').classList.toggle('hidden', option !== 'existing');
    document.getElementById('buySection').classList.toggle('hidden', option !== 'buy');
  }

  skipSms() {
    this.state.selectedPlan = 'email';
    this.state.smsActive = false;
    this.state.currentStep = 4;
    this.updateWizardProgress();
  }

  async finishWizard() {
    // Register with server for centralized notifications
    try {
      const response = await fetch(`${SERVER_URL}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: this.state.emails,
          phone: this.state.phone || null,
          licenseKey: this.state.licenseKey || null
        })
      });
      
      const result = await response.json();
      console.log('Server registration:', result);
      
      if (!result.success) {
        console.error('Registration failed:', result.error);
      }
    } catch (error) {
      console.error('Failed to register with server:', error);
      // Continue anyway - extension will still work locally
    }
    
    this.state.wizardComplete = true;
    await this.saveState();
    this.showMainScreen();
  }

  // ========== MAIN SCREEN FUNCTIONS ==========
  
  showMainScreen() {
    document.getElementById('wizard').classList.add('hidden');
    document.getElementById('mainScreen').classList.add('active');
    this.updateMainScreenDisplay();
  }

  updateMainScreenDisplay() {
    // Update email display
    const emailValue = document.getElementById('mainEmailValue');
    if (this.state.emails && this.state.emails.length > 0) {
      if (this.state.emails.length === 1) {
        emailValue.textContent = this.state.emails[0];
      } else {
        emailValue.textContent = `${this.state.emails.length} כתובות`;
      }
      emailValue.className = 'setting-value active';
    } else {
      emailValue.textContent = 'לא הוגדר';
      emailValue.className = 'setting-value inactive';
    }
    
    // Update SMS display
    this.updateSmsDisplay();
    
    // Update check interval (if element exists)
    const checkIntervalEl = document.getElementById('checkInterval');
    if (checkIntervalEl) {
      checkIntervalEl.value = this.state.checkInterval;
    }
  }

  updateSmsDisplay() {
    const valueEl = document.getElementById('mainSmsValue');
    const btnEl = document.getElementById('smsActionBtn');
    
    if (this.state.smsActive && this.state.phone) {
      valueEl.textContent = this.state.phone;
      valueEl.className = 'setting-value active';
      btnEl.textContent = 'בטל';
      btnEl.className = 'setting-action cancel';
    } else {
      valueEl.textContent = 'לא פעיל';
      valueEl.className = 'setting-value inactive';
      btnEl.textContent = 'הוסף SMS';
      btnEl.className = 'setting-action upgrade';
    }
  }

  async checkNow() {
    const btn = document.getElementById('checkNowBtn');
    btn.classList.add('loading');
    
    try {
      if (isExtension) {
        await chrome.runtime.sendMessage({ action: 'checkNow' });
      } else {
        // Demo mode - simulate check
        await new Promise(resolve => setTimeout(resolve, 1500));
        console.log('Demo: simulated check');
      }
      this.showTestStatus('✅ הבדיקה הושלמה', 'success');
    } catch (error) {
      console.error('Check failed:', error);
      this.showTestStatus('❌ שגיאה בבדיקה', 'error');
    }
    
    btn.classList.remove('loading');
    this.updateLastCheckTime();
  }

  async testAlert() {
    const btn = document.getElementById('testAlertBtn');
    btn.classList.add('loading');
    
    this.showTestStatus('⏳ שולח הודעת בדיקה...', 'loading');
    
    try {
      let results = { email: false, sms: false };
      
      // Test email - send to all emails
      if (this.state.emails && this.state.emails.length > 0) {
        // Send test to first email (or all emails if server supports)
        const emailResponse = await fetch(`${SERVER_URL}/api/test-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: this.state.emails })
        });
        const emailResult = await emailResponse.json();
        results.email = emailResult.success;
      }
      
      // Test SMS
      if (this.state.smsActive && this.state.phone) {
        const smsResponse = await fetch(`${SERVER_URL}/api/test-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: this.state.phone })
        });
        const smsResult = await smsResponse.json();
        results.sms = smsResult.success;
      }
      
      if (results.email || results.sms) {
        let msg = '✅ נשלח בהצלחה!';
        if (results.email) msg += ' 📧';
        if (results.sms) msg += ' 📱';
        this.showTestStatus(msg, 'success');
      } else {
        this.showTestStatus('❌ לא הוגדרו התראות', 'error');
      }
    } catch (error) {
      this.showTestStatus('❌ שגיאה: ' + error.message, 'error');
    }
    
    btn.classList.remove('loading');
  }

  showTestStatus(message, type) {
    const statusEl = document.getElementById('testStatus');
    statusEl.textContent = message;
    statusEl.className = `test-status ${type}`;
    statusEl.classList.remove('hidden');
    
    // Hide after 5 seconds
    setTimeout(() => {
      statusEl.classList.add('hidden');
    }, 5000);
  }

  async updateLastCheckTime() {
    let lastCheck = null;
    if (isExtension) {
      const data = await chrome.storage.local.get('lastCheck');
      lastCheck = data.lastCheck;
    } else {
      lastCheck = localStorage.getItem('lastCheckTime');
    }
    const el = document.getElementById('lastCheckTime');
    
    if (lastCheck) {
      const date = new Date(lastCheck);
      el.textContent = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    } else {
      el.textContent = '--';
    }
  }

  async changeCheckInterval(interval) {
    this.state.checkInterval = parseInt(interval);
    await this.saveState();
    if (isExtension) {
      await chrome.runtime.sendMessage({ action: 'updateInterval', interval: this.state.checkInterval });
    } else {
      console.log('Demo: interval changed to', this.state.checkInterval);
    }
  }

  // ========== MODAL FUNCTIONS ==========
  
  openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    
    // If opening email modal, populate with current emails
    if (modalId === 'editEmailModal') {
      this.populateEmailModal();
    }
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  populateEmailModal() {
    const container = document.getElementById('modalEmailsContainer');
    container.innerHTML = '';
    
    if (this.state.emails && this.state.emails.length > 0) {
      this.state.emails.forEach((email, index) => {
        this.addEmailRow(container, email, index > 0);
      });
    } else {
      this.addEmailRow(container, '', false);
    }
  }

  async saveEmail() {
    const inputs = document.querySelectorAll('#modalEmailsContainer .modal-email-input');
    const emails = [];
    
    inputs.forEach(input => {
      const email = input.value.trim();
      if (email && email.includes('@')) {
        emails.push(email);
      }
    });
    
    if (emails.length === 0) {
      alert('נא להזין לפחות כתובת אימייל אחת תקינה');
      return;
    }
    
    const oldPrimaryEmail = this.state.emails?.[0];
    this.state.emails = emails;
    await this.saveState();
    
    // Update server subscription
    try {
      await fetch(`${SERVER_URL}/api/update-subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentEmail: oldPrimaryEmail || emails[0],
          emails: emails,
          phone: this.state.phone,
          licenseKey: this.state.licenseKey
        })
      });
    } catch (error) {
      console.error('Failed to update server:', error);
    }
    
    this.updateMainScreenDisplay();
    this.closeModal('editEmailModal');
    this.showTestStatus('✅ האימיילים עודכנו!', 'success');
  }

  selectModalSmsOption(option) {
    document.getElementById('modalSmsExisting').classList.toggle('selected', option === 'existing');
    document.getElementById('modalSmsBuy').classList.toggle('selected', option === 'buy');
    document.getElementById('modalExistingSection').classList.toggle('hidden', option !== 'existing');
    document.getElementById('modalBuySection').classList.toggle('hidden', option !== 'buy');
  }

  async activateSms() {
    const licenseKey = document.getElementById('modalLicenseKey').value.trim();
    const phone = document.getElementById('modalPhone').value.trim();
    
    if (!licenseKey) {
      alert('נא להזין מפתח רישיון');
      return;
    }
    if (!phone) {
      alert('נא להזין מספר טלפון');
      return;
    }
    
    // Validate license with server
    try {
      const response = await fetch(`${SERVER_URL}/api/license/validate?licenseKey=${licenseKey}`);
      const data = await response.json();
      
      if (!data.valid) {
        alert('❌ מפתח לא תקף: ' + (data.reason || 'לא נמצא'));
        return;
      }
    } catch (error) {
      console.log('Could not validate license:', error);
    }
    
    this.state.licenseKey = licenseKey;
    this.state.phone = phone;
    this.state.smsActive = true;
    
    await this.saveState();
    this.updateSmsDisplay();
    this.closeModal('addSmsModal');
    this.showTestStatus('✅ SMS הופעל בהצלחה!', 'success');
  }

  async cancelSms() {
    this.state.smsActive = false;
    // Keep phone and license for potential reactivation
    
    await this.saveState();
    this.updateSmsDisplay();
    this.closeModal('cancelSmsModal');
    this.showTestStatus('SMS בוטל. תמשיך לקבל התראות באימייל.', 'success');
  }

  // ========== EVENT LISTENERS SETUP ==========
  
  setupWizardListeners() {
    // Step 1: Terms checkbox and start button
    const termsCheckbox = document.getElementById('acceptTerms');
    const startBtn = document.getElementById('startWizardBtn');
    
    termsCheckbox?.addEventListener('change', () => {
      startBtn.disabled = !termsCheckbox.checked;
    });
    
    document.getElementById('showTermsLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal('termsModal');
    });
    
    startBtn?.addEventListener('click', () => {
      if (termsCheckbox?.checked) {
        this.nextStep();
      }
    });
    
    // Step 2: Email next button
    document.getElementById('emailNextBtn')?.addEventListener('click', () => this.nextStep());
    
    // Add email button in wizard
    document.getElementById('addWizardEmailBtn')?.addEventListener('click', () => {
      const container = document.getElementById('wizardEmailsContainer');
      this.addEmailRow(container, '', true);
    });
    
    // Setup remove button for initial email row
    const initialRemoveBtn = document.querySelector('#wizardEmailsContainer .email-remove-btn');
    if (initialRemoveBtn) {
      initialRemoveBtn.addEventListener('click', (e) => {
        const container = document.getElementById('wizardEmailsContainer');
        if (container.querySelectorAll('.email-input-row').length > 1) {
          e.target.closest('.email-input-row').remove();
          this.updateRemoveButtons(container);
        }
      });
    }
    
    // Step 3: Plan selection
    document.getElementById('planEmail')?.addEventListener('click', () => this.selectPlan('email'));
    document.getElementById('planSms')?.addEventListener('click', () => this.selectPlan('sms'));
    document.getElementById('planNextBtn')?.addEventListener('click', () => this.nextStep());
    
    // Step 3.5: SMS setup
    document.getElementById('smsExisting')?.addEventListener('click', () => this.selectSmsOption('existing'));
    document.getElementById('smsBuy')?.addEventListener('click', () => this.selectSmsOption('buy'));
    document.getElementById('smsNextBtn')?.addEventListener('click', () => this.nextStep());
    document.getElementById('buyBtn')?.addEventListener('click', () => {
      window.open('https://links.payboxapp.com/IdiXnIQ13Zb', '_blank');
    });
    document.getElementById('skipSmsBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.skipSms();
    });
    
    // Step 4: Finish and Donate
    document.getElementById('finishWizardBtn')?.addEventListener('click', () => this.finishWizard());
    document.getElementById('donateBtn')?.addEventListener('click', () => this.openDonation());
  }

  setupMainScreenListeners() {
    // Go to Site button
    document.getElementById('goToSiteBtn')?.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.beitarfc.co.il/%D7%9E%D7%A9%D7%97%D7%A7%D7%99%D7%9D/' });
    });
    
    // Quick actions
    document.getElementById('checkNowBtn')?.addEventListener('click', () => this.checkNow());
    document.getElementById('testAlertBtn')?.addEventListener('click', () => this.testAlert());
    
    // Edit email
    document.getElementById('editEmailBtn')?.addEventListener('click', () => {
      this.openModal('editEmailModal');
    });
    
    // Add email button in modal
    document.getElementById('addModalEmailBtn')?.addEventListener('click', () => {
      const container = document.getElementById('modalEmailsContainer');
      this.addEmailRow(container, '', true);
    });
    
    // SMS action (add or cancel)
    document.getElementById('smsActionBtn')?.addEventListener('click', () => {
      if (this.state.smsActive) {
        this.openModal('cancelSmsModal');
      } else {
        this.openModal('addSmsModal');
      }
    });
    
    // Donate and Terms links in main screen
    document.getElementById('mainDonateBtn')?.addEventListener('click', () => this.openDonation());
    document.getElementById('mainTermsLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal('termsModal');
    });
  }

  setupModalListeners() {
    // Edit Email Modal
    document.getElementById('closeEditEmailBtn')?.addEventListener('click', () => this.closeModal('editEmailModal'));
    document.getElementById('cancelEditEmailBtn')?.addEventListener('click', () => this.closeModal('editEmailModal'));
    document.getElementById('saveEmailBtn')?.addEventListener('click', () => this.saveEmail());
    
    // Add SMS Modal
    document.getElementById('closeAddSmsBtn')?.addEventListener('click', () => this.closeModal('addSmsModal'));
    document.getElementById('cancelAddSmsBtn')?.addEventListener('click', () => this.closeModal('addSmsModal'));
    document.getElementById('modalSmsExisting')?.addEventListener('click', () => this.selectModalSmsOption('existing'));
    document.getElementById('modalSmsBuy')?.addEventListener('click', () => this.selectModalSmsOption('buy'));
    document.getElementById('modalBuyBtn')?.addEventListener('click', () => {
      window.open('https://links.payboxapp.com/IdiXnIQ13Zb', '_blank');
    });
    document.getElementById('activateSmsBtn')?.addEventListener('click', () => this.activateSms());
    
    // Cancel SMS Modal
    document.getElementById('closeCancelSmsBtn')?.addEventListener('click', () => this.closeModal('cancelSmsModal'));
    document.getElementById('cancelCancelSmsBtn')?.addEventListener('click', () => this.closeModal('cancelSmsModal'));
    document.getElementById('confirmCancelSmsBtn')?.addEventListener('click', () => this.cancelSms());
    
    // Terms Modal
    document.getElementById('closeTermsBtn')?.addEventListener('click', () => this.closeModal('termsModal'));
    document.getElementById('acceptTermsBtn')?.addEventListener('click', () => {
      const checkbox = document.getElementById('acceptTerms');
      if (checkbox) checkbox.checked = true;
      const startBtn = document.getElementById('startWizardBtn');
      if (startBtn) startBtn.disabled = false;
      this.closeModal('termsModal');
    });
  }
  
  // Open donation page (PayBox or similar)
  openDonation() {
    // You can create a separate PayBox link for donations
    window.open('https://links.payboxapp.com/IdiXnIQ13Zb', '_blank');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new BeitarPopup();
});
