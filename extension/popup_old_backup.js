// Popup script for Beitar Ticket Monitor - Simplified

const SERVER_URL = 'https://server-tickets-l0rq.onrender.com';

class PopupManager {
  constructor() {
    this.init();
  }

  async init() {
    await this.loadSettings();
    await this.loadMonitoredGames();
    this.setupEventListeners();
    this.updateLastCheckTime();
  }

  async loadSettings() {
    const settings = await chrome.storage.local.get([
      'browserNotifications',
      'emailNotifications',
      'smsNotifications',
      'licenseKey',
      'userEmail',
      'userPhone',
      'checkInterval'
    ]);

    document.getElementById('browserNotifications').checked = settings.browserNotifications !== false;
    document.getElementById('emailNotifications').checked = settings.emailNotifications || false;
    document.getElementById('smsNotifications').checked = settings.smsNotifications || false;
    document.getElementById('licenseKey').value = settings.licenseKey || '';
    document.getElementById('userEmail').value = settings.userEmail || '';
    document.getElementById('userPhone').value = settings.userPhone || '';
    document.getElementById('checkInterval').value = settings.checkInterval || '5';

    // Show/hide email settings
    if (settings.emailNotifications) {
      document.getElementById('emailSettings').classList.remove('hidden');
    }
    
    // Show/hide SMS settings
    if (settings.smsNotifications) {
      document.getElementById('smsSettings').classList.remove('hidden');
    }
    
    // Check license status if exists
    if (settings.licenseKey) {
      this.checkLicenseStatus(settings.licenseKey);
    }
  }
  
  async checkLicenseStatus(licenseKey) {
    try {
      const response = await fetch(`${SERVER_URL}/api/license/validate?licenseKey=${licenseKey}`);
      const data = await response.json();
      
      const statusEl = document.getElementById('licenseStatus');
      if (data.valid) {
        const smsLeft = data.smsLimit - data.smsUsed;
        statusEl.innerHTML = `<span style="color: #4CAF50;">✓ נותרו ${smsLeft} SMS</span>`;
      } else {
        statusEl.innerHTML = `<span style="color: #f44336;">✗ ${data.reason}</span>`;
      }
    } catch (e) {
      console.log('Could not check license:', e);
    }
  }

  async loadMonitoredGames() {
    const { monitoredGames = [] } = await chrome.storage.local.get('monitoredGames');
    const gamesList = document.getElementById('gamesList');

    if (monitoredGames.length === 0) {
      gamesList.innerHTML = `
        <div class="empty-state">
          <p>אין משחקים במעקב</p>
          <p class="hint">גלוש ל-<a href="https://www.beitarfc.co.il/%D7%9E%D7%A9%D7%97%D7%A7%D7%99%D7%9D/" target="_blank">beitarfc.co.il</a> ובחר משחקים</p>
        </div>
      `;
      return;
    }

    gamesList.innerHTML = monitoredGames.map(game => this.renderGameItem(game)).join('');
  }

  renderGameItem(game) {
    const statusClass = game.hasTickets ? 'available' : (game.isSoldOut ? 'soldout' : 'unavailable');
    const statusText = game.hasTickets ? 'זמין!' : (game.isSoldOut ? 'אזל' : 'ממתין');
    
    const date = new Date(game.eventDate);
    const dateStr = date.toLocaleDateString('he-IL', { 
      day: 'numeric', 
      month: 'numeric',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    return `
      <div class="game-item" data-id="${game.id}">
        <div class="game-info">
          <div class="game-name">${game.name}</div>
          <div class="game-date">${dateStr} | ${game.location || 'אצטדיון טדי'}</div>
        </div>
        <span class="game-status ${statusClass}">${statusText}</span>
        <button class="remove-btn" data-id="${game.id}" title="הסר מעקב">✕</button>
      </div>
    `;
  }

  setupEventListeners() {
    // Check now button
    document.getElementById('checkNowBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.classList.add('loading');
      
      try {
        await chrome.runtime.sendMessage({ action: 'checkNow' });
        await this.loadMonitoredGames();
        this.updateLastCheckTime();
      } catch (error) {
        console.error('Check failed:', error);
      }
      
      btn.classList.remove('loading');
    });

    // Settings button - just scroll to settings
    document.getElementById('openSettingsBtn').addEventListener('click', () => {
      document.querySelector('.notification-settings').scrollIntoView({ behavior: 'smooth' });
    });

    // Browser notifications toggle
    document.getElementById('browserNotifications').addEventListener('change', async (e) => {
      await chrome.storage.local.set({ browserNotifications: e.target.checked });
    });

    // Email notifications toggle
    document.getElementById('emailNotifications').addEventListener('change', async (e) => {
      const emailSettings = document.getElementById('emailSettings');
      if (e.target.checked) {
        emailSettings.classList.remove('hidden');
      } else {
        emailSettings.classList.add('hidden');
      }
      await chrome.storage.local.set({ emailNotifications: e.target.checked });
    });

    // SMS notifications toggle
    document.getElementById('smsNotifications').addEventListener('change', async (e) => {
      const smsSettings = document.getElementById('smsSettings');
      if (e.target.checked) {
        smsSettings.classList.remove('hidden');
      } else {
        smsSettings.classList.add('hidden');
      }
      await chrome.storage.local.set({ smsNotifications: e.target.checked });
    });

    // Save email button
    document.getElementById('saveEmailBtn').addEventListener('click', async () => {
      const userEmail = document.getElementById('userEmail').value;
      if (!userEmail) {
        alert('נא להזין אימייל');
        return;
      }
      await chrome.storage.local.set({ userEmail });
      alert('✅ אימייל נשמר!');
    });

    // Save SMS settings button
    document.getElementById('saveSmsBtn').addEventListener('click', async () => {
      const licenseKey = document.getElementById('licenseKey').value;
      const userPhone = document.getElementById('userPhone').value;

      if (!licenseKey) {
        alert('נא להזין מפתח רישיון');
        return;
      }
      if (!userPhone) {
        alert('נא להזין מספר טלפון');
        return;
      }

      await chrome.storage.local.set({ licenseKey, userPhone });
      
      // Validate license
      try {
        const response = await fetch(`${SERVER_URL}/api/license/validate?licenseKey=${licenseKey}`);
        const data = await response.json();
        
        if (data.valid) {
          const smsLeft = data.smsLimit - data.smsUsed;
          alert(`✅ רישיון תקף!\nנותרו ${smsLeft} SMS`);
          this.checkLicenseStatus(licenseKey);
        } else {
          alert(`❌ ${data.reason}`);
        }
      } catch (error) {
        alert('שגיאה בבדיקת רישיון: ' + error.message);
      }
    });

    // Test notification button
    document.getElementById('testNotificationBtn').addEventListener('click', async () => {
      const userEmail = document.getElementById('userEmail').value;
      const userPhone = document.getElementById('userPhone').value;
      const licenseKey = document.getElementById('licenseKey').value;
      const testStatus = document.getElementById('testStatus');
      
      const emailEnabled = document.getElementById('emailNotifications').checked;
      const smsEnabled = document.getElementById('smsNotifications').checked;

      if (!emailEnabled && !smsEnabled) {
        testStatus.innerHTML = '<span style="color: #ff4444;">❌ הפעל לפחות סוג התראה אחד</span>';
        return;
      }

      if (emailEnabled && !userEmail) {
        testStatus.innerHTML = '<span style="color: #ff4444;">❌ נא להזין אימייל</span>';
        return;
      }

      if (smsEnabled && (!licenseKey || !userPhone)) {
        testStatus.innerHTML = '<span style="color: #ff4444;">❌ נדרש מפתח רישיון וטלפון ל-SMS</span>';
        return;
      }

      testStatus.innerHTML = '<span style="color: #ffd700;">⏳ שולח הודעת בדיקה...</span>';

      try {
        let results = { email: false, sms: false };
        
        // Send test email if enabled
        if (emailEnabled && userEmail) {
          const emailResponse = await fetch(`${SERVER_URL}/api/test-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: userEmail })
          });
          const emailResult = await emailResponse.json();
          results.email = emailResult.success;
        }
        
        // Send test SMS if enabled
        if (smsEnabled && userPhone) {
          const smsResponse = await fetch(`${SERVER_URL}/api/test-sms`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: userPhone })
          });
          const smsResult = await smsResponse.json();
          results.sms = smsResult.success;
        }

        if (results.email || results.sms) {
          let msg = '✅ נשלח!';
          if (results.email) msg += ' 📧';
          if (results.sms) msg += ' 📱';
          testStatus.innerHTML = `<span style="color: #44ff44;">${msg}</span>`;
        } else {
          testStatus.innerHTML = `<span style="color: #ff4444;">❌ שגיאה בשליחה</span>`;
        }
      } catch (error) {
        testStatus.innerHTML = `<span style="color: #ff4444;">❌ ${error.message}</span>`;
      }
    });

    // Check interval change
    document.getElementById('checkInterval').addEventListener('change', async (e) => {
      const interval = parseInt(e.target.value);
      await chrome.storage.local.set({ checkInterval: interval });
      await chrome.runtime.sendMessage({ action: 'updateInterval', interval });
    });

    // Remove game buttons (event delegation)
    document.getElementById('gamesList').addEventListener('click', async (e) => {
      if (e.target.classList.contains('remove-btn')) {
        const gameId = e.target.dataset.id;
        await this.removeGame(gameId);
      }
    });
  }

  async removeGame(gameId) {
    const { monitoredGames = [] } = await chrome.storage.local.get('monitoredGames');
    const updatedGames = monitoredGames.filter(g => g.id !== gameId);
    await chrome.storage.local.set({ monitoredGames: updatedGames });
    await this.loadMonitoredGames();
  }

  async updateLastCheckTime() {
    const { lastCheck } = await chrome.storage.local.get('lastCheck');
    const lastCheckEl = document.getElementById('lastCheck');
    
    if (lastCheck) {
      const date = new Date(lastCheck);
      const timeStr = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      lastCheckEl.textContent = `בדיקה אחרונה: ${timeStr}`;
    } else {
      lastCheckEl.textContent = 'בדיקה אחרונה: --';
    }
  }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
