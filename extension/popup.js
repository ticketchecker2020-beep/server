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
    
    // Load monitored games
    this.loadMonitoredGames();
    
    // Check if user is on Beitar site - hide site button if so
    this.checkCurrentTab();
  }
  
  async checkCurrentTab() {
    if (!isExtension) return;
    
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url) {
        const url = tab.url.toLowerCase();
        // Check if on Beitar/Leaan ticket site
        if (url.includes('leaan.co.il') || url.includes('beitar') || url.includes('בית')) {
          const siteBtn = document.getElementById('siteButtonContainer');
          if (siteBtn) {
            siteBtn.style.display = 'none';
          }
        }
      }
    } catch (error) {
      console.log('Could not check current tab:', error);
    }
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

  // Auto-save wizard progress (draft) so data isn't lost if user leaves
  async saveWizardDraft() {
    const draft = {
      currentStep: this.state.currentStep,
      selectedPlan: this.state.selectedPlan,
      smsOption: this.state.smsOption,
      emails: this.getWizardEmails(),
      phone: document.getElementById('wizardPhone')?.value || this.state.phone,
      licenseKey: document.getElementById('wizardLicenseKey')?.value || this.state.licenseKey,
      acceptedTerms: document.getElementById('acceptTerms')?.checked || false,
      timestamp: Date.now()
    };
    
    if (isExtension) {
      await chrome.storage.local.set({ wizardDraft: draft });
    } else {
      localStorage.setItem('beitarWizardDraft', JSON.stringify(draft));
    }
    // Debug only - uncomment if needed: console.log('📝 Wizard draft saved:', draft);
  }

  // Load wizard draft if exists (for recovering interrupted wizard)
  async loadWizardDraft() {
    let draft = null;
    
    if (isExtension) {
      const data = await chrome.storage.local.get('wizardDraft');
      draft = data.wizardDraft;
    } else {
      const saved = localStorage.getItem('beitarWizardDraft');
      draft = saved ? JSON.parse(saved) : null;
    }
    
    // Only restore if draft is less than 24 hours old
    if (draft && draft.timestamp && (Date.now() - draft.timestamp) < 24 * 60 * 60 * 1000) {
      console.log('📥 Restoring wizard draft:', draft);
      return draft;
    }
    
    return null;
  }

  // Clear wizard draft after completion
  async clearWizardDraft() {
    if (isExtension) {
      await chrome.storage.local.remove('wizardDraft');
    } else {
      localStorage.removeItem('beitarWizardDraft');
    }
    console.log('🗑️ Wizard draft cleared');
  }

  // ========== WIZARD FUNCTIONS ==========
  
  async showWizard() {
    document.getElementById('wizard').classList.remove('hidden');
    document.getElementById('mainScreen').classList.remove('active');
    
    // Try to restore wizard draft
    const draft = await this.loadWizardDraft();
    if (draft) {
      // Restore step - but if step 4, go back to step 3 (user didn't finish)
      let restoredStep = draft.currentStep || 1;
      if (restoredStep === 4) {
        restoredStep = 3; // Don't restore to step 4, user should complete again
      }
      this.state.currentStep = restoredStep;
      this.state.selectedPlan = draft.selectedPlan || 'email';
      this.state.smsOption = draft.smsOption || null;
      
      // Restore emails to state (important for finishWizard!)
      if (draft.emails && draft.emails.length > 0) {
        this.state.emails = draft.emails;
      }
      
      // Restore phone and license to state
      if (draft.phone) {
        this.state.phone = draft.phone;
      }
      if (draft.licenseKey) {
        this.state.licenseKey = draft.licenseKey;
      }
      
      // Restore terms checkbox
      const termsCheckbox = document.getElementById('acceptTerms');
      const startBtn = document.getElementById('startWizardBtn');
      if (termsCheckbox && draft.acceptedTerms) {
        termsCheckbox.checked = true;
        if (startBtn) startBtn.disabled = false;
      }
      
      // Restore emails in wizard (after a small delay to ensure DOM is ready)
      setTimeout(() => {
        if (draft.emails && draft.emails.length > 0) {
          const container = document.getElementById('wizardEmailsContainer');
          if (container) {
            // Clear existing and add saved emails
            container.innerHTML = '';
            draft.emails.forEach((email, index) => {
              this.addEmailRow(container, email, index > 0);
            });
          }
        }
        
        // Restore phone and license
        if (draft.phone) {
          const phoneInput = document.getElementById('wizardPhone');
          if (phoneInput) phoneInput.value = draft.phone;
        }
        if (draft.licenseKey) {
          const licenseInput = document.getElementById('wizardLicenseKey');
          if (licenseInput) licenseInput.value = draft.licenseKey;
        }
        
        // Update plan selection UI
        if (draft.selectedPlan) {
          this.selectPlan(draft.selectedPlan);
        }
        if (draft.smsOption) {
          this.selectSmsOption(draft.smsOption);
        }
      }, 100);
      
      console.log('✅ Wizard draft restored! Step:', this.state.currentStep);
    }
    
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
    
    // Auto-transition from step 4 to main screen after 2 seconds
    // Only if explicitly triggered (not on page load)
    if (this.state.currentStep === 4 && this.autoRedirectEnabled) {
      // Start countdown
      let seconds = 2;
      const countdownEl = document.getElementById('countdownSeconds');
      
      const countdownInterval = setInterval(() => {
        seconds--;
        if (countdownEl) countdownEl.textContent = seconds;
        
        if (seconds <= 0) {
          clearInterval(countdownInterval);
          this.finishWizard();
        }
      }, 1000);
      
      // Store interval so manual skip can clear it
      this.autoRedirectInterval = countdownInterval;
    }
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
      // Also capture emails here in case we restored to step 3 from draft
      const emails = this.getWizardEmails();
      if (emails.length > 0) {
        this.state.emails = emails;
      }
      
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
    
    // Enable auto-redirect when reaching step 4
    if (this.state.currentStep === 4) {
      this.autoRedirectEnabled = true;
    }
    
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
    this.autoRedirectEnabled = true; // Enable auto-redirect to main screen
    this.updateWizardProgress();
  }

  async finishWizard() {
    // Clear auto-redirect interval if exists
    if (this.autoRedirectInterval) {
      clearInterval(this.autoRedirectInterval);
      this.autoRedirectInterval = null;
    }
    
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
    await this.clearWizardDraft(); // Clear draft after successful completion
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
      let errors = [];
      
      // Test email - send to all emails
      if (this.state.emails && this.state.emails.length > 0) {
        // Send test to first email (or all emails if server supports)
        const emailResponse = await fetch(`${SERVER_URL}/api/test-email`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ emails: this.state.emails })
        });
        const emailResult = await emailResponse.json();
        results.email = emailResult.success;
        if (!emailResult.success && emailResult.error) {
          errors.push('📧 ' + emailResult.error);
        }
      }
      
      // Test SMS
      if (this.state.smsActive && this.state.phone) {
        const smsResponse = await fetch(`${SERVER_URL}/api/test-sms`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ phone: this.state.phone })
        });
        const smsResult = await smsResponse.json();
        results.sms = smsResult.success;
        if (!smsResult.success && smsResult.error) {
          errors.push('📱 ' + smsResult.error);
        }
      }
      
      if (results.email || results.sms) {
        let msg = '✅ נשלח בהצלחה!';
        if (results.email) msg += ' 📧';
        if (results.sms) msg += ' 📱';
        this.showTestStatus(msg, 'success');
      } else if (errors.length > 0) {
        this.showTestStatus('❌ ' + errors.join(', '), 'error');
      } else if (!this.state.emails || this.state.emails.length === 0) {
        this.showTestStatus('❌ לא הוגדר אימייל', 'error');
      } else {
        this.showTestStatus('❌ שליחה נכשלה', 'error');
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

  // ========== MONITORED GAMES ==========
  
  async loadMonitoredGames() {
    const listEl = document.getElementById('monitoredGamesList');
    if (!listEl) return;
    
    try {
      // Get games from local storage
      let games = [];
      
      if (isExtension) {
        const data = await chrome.storage.local.get('monitoredGames');
        games = data.monitoredGames || [];
      }
      
      this.renderMonitoredGames(games);
    } catch (error) {
      console.error('Failed to load monitored games:', error);
      listEl.innerHTML = '<div class="games-empty">❌ שגיאה בטעינת משחקים</div>';
    }
  }
  
  renderMonitoredGames(games) {
    const listEl = document.getElementById('monitoredGamesList');
    const hintEl = document.getElementById('gamesHint');
    if (!listEl) return;
    
    if (!games || games.length === 0) {
      listEl.innerHTML = '<div class="games-empty">אין משחקים במעקב<br>היכנס לאתר בית"ר ולחץ "עקוב" ליד משחק</div>';
      if (hintEl) hintEl.style.display = 'block';
      return;
    }
    
    // Hide hint when there are games
    if (hintEl) hintEl.style.display = 'none';
    
    listEl.innerHTML = games.map(game => {
      const date = game.eventDate ? new Date(game.eventDate).toLocaleDateString('he-IL') : '';
      const gameName = game.name || `VS ${game.opponent}`;
      const hasTickets = game.hasTickets || false;
      
      // Status indicator
      const statusClass = hasTickets ? 'status-available' : 'status-waiting';
      const statusIcon = hasTickets ? '🎟️' : '⏳';
      const statusText = hasTickets ? 'כרטיסים זמינים!' : 'ממתין';
      
      return `
        <div class="game-item ${hasTickets ? 'has-tickets' : ''}" data-game-id="${game.id}">
          <div class="game-status ${statusClass}" title="${statusText}">
            ${statusIcon}
          </div>
          <div class="game-info">
            <div class="game-name">${gameName}</div>
            <div class="game-date">${date} ${game.location ? '| ' + game.location : ''}</div>
            <div class="game-status-text ${statusClass}">${statusText}</div>
          </div>
          <button class="game-remove" title="הסר מהמעקב" data-game-id="${game.id}">🗑️</button>
        </div>
      `;
    }).join('');
    
    // Add event listeners to remove buttons
    listEl.querySelectorAll('.game-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const gameId = btn.dataset.gameId;
        this.removeMonitoredGame(gameId);
      });
    });
    
    // Add click event to game items - open ticket URL
    listEl.querySelectorAll('.game-item').forEach(item => {
      item.style.cursor = 'pointer';
      item.addEventListener('click', (e) => {
        // Don't trigger if clicking on remove button
        if (e.target.closest('.game-remove')) return;
        
        const gameId = item.dataset.gameId;
        const game = games.find(g => g.id === gameId);
        
        if (game?.ticketUrl) {
          // Open the ticket URL
          chrome.tabs.create({ url: game.ticketUrl });
        } else {
          // Fallback to general Beitar page on leaan
          chrome.tabs.create({ url: 'https://www.leaan.co.il/category/%D7%A1%D7%A4%D7%95%D7%A8%D7%98/%D7%9B%D7%93%D7%95%D7%A8%D7%92%D7%9C/%D7%91%D7%99%D7%AA%D7%A8-%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D' });
        }
      });
    });
  }
  
  async removeMonitoredGame(gameId) {
    if (!confirm('להסיר את המשחק מהמעקב?')) return;
    
    try {
      if (isExtension) {
        // Send message to background to remove game
        await chrome.runtime.sendMessage({ action: 'removeGame', gameId });
      }
      
      // Refresh the list
      await this.loadMonitoredGames();
      this.showTestStatus('✅ המשחק הוסר מהמעקב', 'success');
    } catch (error) {
      console.error('Failed to remove game:', error);
      this.showTestStatus('❌ שגיאה בהסרת המשחק', 'error');
    }
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
    const codeOrKey = document.getElementById('modalLicenseKey').value.trim();
    const phone = document.getElementById('modalPhone').value.trim();
    
    if (!codeOrKey) {
      alert('נא להזין מפתח רישיון או קוד קופון');
      return;
    }
    if (!phone) {
      alert('נא להזין מספר טלפון');
      return;
    }
    
    let finalLicenseKey = codeOrKey;
    
    // First try to validate as license key
    try {
      const response = await fetch(`${SERVER_URL}/api/license/validate?licenseKey=${codeOrKey}`);
      const data = await response.json();
      
      if (data.valid) {
        // It's a valid license key
        finalLicenseKey = codeOrKey;
      } else if (data.isCoupon) {
        // It's a coupon - try to activate it
        const email = this.state.emails[0] || '';
        if (!email) {
          alert('נא להזין אימייל קודם (בשלב 3)');
          return;
        }
        
        const activateResponse = await fetch(`${SERVER_URL}/api/coupon/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: codeOrKey,
            email: email,
            phone: phone,
            plan: 'yearly'
          })
        });
        const activateData = await activateResponse.json();
        
        if (activateData.success) {
          finalLicenseKey = activateData.licenseKey;
          if (activateData.existing) {
            this.showTestStatus('✅ נמצא רישיון קיים!', 'success');
          } else {
            this.showTestStatus('✅ רישיון נוצר בהצלחה!', 'success');
          }
        } else {
          alert('❌ ' + (activateData.reason || 'שגיאה בהפעלת קופון'));
          return;
        }
      } else {
        alert('❌ מפתח לא תקף: ' + (data.reason || 'לא נמצא'));
        return;
      }
    } catch (error) {
      console.log('Could not validate:', error);
      alert('❌ שגיאה בבדיקת המפתח');
      return;
    }
    
    this.state.licenseKey = finalLicenseKey;
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
      this.saveWizardDraft(); // Auto-save when terms checkbox changes
    });
    
    document.getElementById('showTermsLink')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openModal('termsModal');
    });
    
    startBtn?.addEventListener('click', () => {
      if (termsCheckbox?.checked) {
        this.nextStep();
        this.saveWizardDraft(); // Auto-save on step change
      }
    });
    
    // Step 2: Email next button
    document.getElementById('emailNextBtn')?.addEventListener('click', () => {
      this.nextStep();
      this.saveWizardDraft(); // Auto-save on step change
    });
    
    // Add email button in wizard
    document.getElementById('addWizardEmailBtn')?.addEventListener('click', () => {
      const container = document.getElementById('wizardEmailsContainer');
      this.addEmailRow(container, '', true);
      this.saveWizardDraft(); // Auto-save when adding email field
    });
    
    // Auto-save when typing in wizard email inputs (with debounce)
    const wizardEmailsContainer = document.getElementById('wizardEmailsContainer');
    let emailSaveTimeout;
    wizardEmailsContainer?.addEventListener('input', () => {
      clearTimeout(emailSaveTimeout);
      emailSaveTimeout = setTimeout(() => this.saveWizardDraft(), 500);
    });
    
    // Setup remove button for initial email row
    const initialRemoveBtn = document.querySelector('#wizardEmailsContainer .email-remove-btn');
    if (initialRemoveBtn) {
      initialRemoveBtn.addEventListener('click', (e) => {
        const container = document.getElementById('wizardEmailsContainer');
        if (container.querySelectorAll('.email-input-row').length > 1) {
          e.target.closest('.email-input-row').remove();
          this.updateRemoveButtons(container);
          this.saveWizardDraft(); // Auto-save when removing email
        }
      });
    }
    
    // Step 3: Plan selection
    document.getElementById('planEmail')?.addEventListener('click', () => {
      this.selectPlan('email');
      this.saveWizardDraft(); // Auto-save on plan selection
    });
    document.getElementById('planSms')?.addEventListener('click', () => {
      this.selectPlan('sms');
      this.saveWizardDraft(); // Auto-save on plan selection
    });
    document.getElementById('planNextBtn')?.addEventListener('click', () => {
      this.nextStep();
      this.saveWizardDraft(); // Auto-save on step change
    });
    
    // Step 3.5: SMS setup
    document.getElementById('smsExisting')?.addEventListener('click', () => {
      this.selectSmsOption('existing');
      this.saveWizardDraft();
    });
    document.getElementById('smsBuy')?.addEventListener('click', () => {
      this.selectSmsOption('buy');
      this.saveWizardDraft();
    });
    document.getElementById('smsNextBtn')?.addEventListener('click', () => {
      this.nextStep();
      this.saveWizardDraft();
    });
    document.getElementById('buyBtn')?.addEventListener('click', () => {
      window.open('https://links.payboxapp.com/IdiXnIQ13Zb', '_blank');
    });
    document.getElementById('skipSmsBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.skipSms();
    });
    
    // Auto-save phone and license inputs (with debounce)
    let smsSaveTimeout;
    document.getElementById('wizardPhone')?.addEventListener('input', () => {
      clearTimeout(smsSaveTimeout);
      smsSaveTimeout = setTimeout(() => this.saveWizardDraft(), 500);
    });
    document.getElementById('wizardLicenseKey')?.addEventListener('input', () => {
      clearTimeout(smsSaveTimeout);
      smsSaveTimeout = setTimeout(() => this.saveWizardDraft(), 500);
    });
    
    // Step 4: Finish and Donate
    document.getElementById('finishWizardBtn')?.addEventListener('click', () => this.finishWizard());
    document.getElementById('donateBtn')?.addEventListener('click', () => this.openDonation());
  }

  setupMainScreenListeners() {
    // Go to Site button - beitarfc.co.il shows all games, each has a link to buy tickets
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
