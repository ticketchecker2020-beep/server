// Beitar Ticket Monitor - Popup with Wizard
const SERVER_URL = 'https://server-tickets-l0rq.onrender.com';

class BeitarPopup {
  constructor() {
    this.state = {
      currentStep: 1,
      selectedPlan: 'email',
      smsOption: null,
      email: '',
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

  async loadState() {
    const data = await chrome.storage.local.get([
      'wizardComplete',
      'userEmail',
      'userPhone',
      'licenseKey',
      'smsActive',
      'checkInterval',
      'lastCheck'
    ]);
    
    this.state.wizardComplete = data.wizardComplete || false;
    this.state.email = data.userEmail || '';
    this.state.phone = data.userPhone || '';
    this.state.licenseKey = data.licenseKey || '';
    this.state.smsActive = data.smsActive || false;
    this.state.checkInterval = data.checkInterval || 5;
  }

  async saveState() {
    await chrome.storage.local.set({
      wizardComplete: this.state.wizardComplete,
      userEmail: this.state.email,
      userPhone: this.state.phone,
      licenseKey: this.state.licenseKey,
      smsActive: this.state.smsActive,
      checkInterval: this.state.checkInterval,
      // Keep compatibility with old extension
      emailNotifications: !!this.state.email,
      smsNotifications: this.state.smsActive
    });
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
      const email = document.getElementById('wizardEmail').value.trim();
      if (!email || !email.includes('@')) {
        alert('נא להזין כתובת אימייל תקינה');
        return;
      }
      this.state.email = email;
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
    if (this.state.email) {
      emailValue.textContent = this.state.email;
      emailValue.className = 'setting-value active';
    } else {
      emailValue.textContent = 'לא הוגדר';
      emailValue.className = 'setting-value inactive';
    }
    
    // Update SMS display
    this.updateSmsDisplay();
    
    // Update check interval
    document.getElementById('checkInterval').value = this.state.checkInterval;
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
      await chrome.runtime.sendMessage({ action: 'checkNow' });
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
      
      // Test email
      if (this.state.email) {
        const emailResponse = await fetch(`${SERVER_URL}/api/test-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: this.state.email })
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
    const { lastCheck } = await chrome.storage.local.get('lastCheck');
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
    await chrome.runtime.sendMessage({ action: 'updateInterval', interval: this.state.checkInterval });
  }

  // ========== MODAL FUNCTIONS ==========
  
  openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
  }

  closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  }

  async saveEmail() {
    const newEmail = document.getElementById('newEmail').value.trim();
    if (!newEmail || !newEmail.includes('@')) {
      alert('נא להזין כתובת אימייל תקינה');
      return;
    }
    
    this.state.email = newEmail;
    await this.saveState();
    this.updateMainScreenDisplay();
    this.closeModal('editEmailModal');
    this.showTestStatus('✅ האימייל עודכן!', 'success');
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
    // Step 1: Start button
    document.getElementById('startWizardBtn')?.addEventListener('click', () => this.nextStep());
    
    // Step 2: Email next button
    document.getElementById('emailNextBtn')?.addEventListener('click', () => this.nextStep());
    
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
    
    // Step 4: Finish
    document.getElementById('finishWizardBtn')?.addEventListener('click', () => this.finishWizard());
  }

  setupMainScreenListeners() {
    // Quick actions
    document.getElementById('checkNowBtn')?.addEventListener('click', () => this.checkNow());
    document.getElementById('testAlertBtn')?.addEventListener('click', () => this.testAlert());
    
    // Edit email
    document.getElementById('editEmailBtn')?.addEventListener('click', () => {
      document.getElementById('newEmail').value = this.state.email;
      this.openModal('editEmailModal');
    });
    
    // SMS action (add or cancel)
    document.getElementById('smsActionBtn')?.addEventListener('click', () => {
      if (this.state.smsActive) {
        this.openModal('cancelSmsModal');
      } else {
        this.openModal('addSmsModal');
      }
    });
    
    // Check interval
    document.getElementById('checkInterval')?.addEventListener('change', (e) => {
      this.changeCheckInterval(e.target.value);
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
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new BeitarPopup();
});
