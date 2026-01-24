// Content script for beitarfc.co.il - Game selection interface

class GameSelector {
  constructor() {
    this.init();
  }

  init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.injectUI());
    } else {
      this.injectUI();
    }
  }

  injectUI() {
    // Find all game cards/items on the page
    const gameElements = this.findGameElements();
    
    if (gameElements.length === 0) {
      console.log('Beitar Monitor: No games found on page');
      return;
    }

    console.log(`Beitar Monitor: Found ${gameElements.length} games`);

    // Add monitor button to each game
    gameElements.forEach((el, index) => {
      this.addMonitorButton(el, index);
    });

    // Add floating status indicator
    this.addStatusIndicator();
  }

  findGameElements() {
    // Look for game_list_item elements on beitarfc.co.il/משחקים page
    // IMPORTANT: Only select elements with EXACTLY the game_list_item class pattern
    // to avoid matching nested elements
    const gameItems = document.querySelectorAll('.games_list > .game_list_item');
    if (gameItems.length > 0) {
      console.log('Beitar Monitor: Found games using .games_list > .game_list_item');
      return Array.from(gameItems);
    }

    // Fallback: direct .game_list_item but filter to only top-level ones
    const allGameItems = document.querySelectorAll('.game_list_item');
    if (allGameItems.length > 0) {
      // Filter to only include items that are direct children of games_list
      const filtered = Array.from(allGameItems).filter(el => {
        // Check if this element has the main game structure (teams_logos, game_info)
        return el.querySelector('.teams_logos') && el.querySelector('.game_info');
      });
      if (filtered.length > 0) {
        console.log(`Beitar Monitor: Found ${filtered.length} games after filtering`);
        return filtered;
      }
    }

    return [];
  }

  addMonitorButton(gameElement, index) {
    // Check if button already exists
    if (gameElement.querySelector('.beitar-monitor-btn')) {
      return;
    }

    // Extract game info
    const gameInfo = this.extractGameInfo(gameElement);
    
    if (!gameInfo.opponent) {
      console.log(`Beitar Monitor: Game ${index} - no opponent found, skipping`);
      return;
    }

    console.log(`Beitar Monitor: Adding button for game ${index}: ${gameInfo.name}`);

    // Create monitor button
    const btn = document.createElement('button');
    btn.className = 'beitar-monitor-btn';
    btn.innerHTML = '🔔 עקוב';
    btn.title = 'קבל התראה כשכרטיסים יהיו זמינים';
    
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      console.log('🔔 Monitor button clicked for game:', gameInfo);
      
      // Check if already monitored - TOGGLE behavior
      const isCurrentlyMonitored = btn.classList.contains('monitoring');
      
      btn.disabled = true;
      btn.innerHTML = '⏳';
      
      try {
        // Check if extension context is valid BEFORE sending message
        if (!chrome.runtime?.id) {
          throw new Error('Extension context invalidated - please refresh the page');
        }
        
        if (isCurrentlyMonitored) {
          // REMOVE from monitoring
          console.log('🔔 Removing game from monitoring...');
          const response = await this.removeGameFromMonitor(gameInfo.id);
          console.log('🔔 Remove response:', response);
          btn.innerHTML = '🔔 עקוב';
          btn.classList.remove('monitoring');
          this.showNotification('המשחק הוסר מהמעקב', 'info');
        } else {
          // ADD to monitoring
          console.log('🔔 Sending addGame message to background...');
          const response = await this.addGameToMonitor(gameInfo);
          console.log('🔔 Response from background:', response);
          btn.innerHTML = '✅ במעקב';
          btn.classList.add('monitoring');
          this.showNotification('המשחק נוסף למעקב!', 'success');
        }
        btn.disabled = false;
      } catch (error) {
        console.error('❌ Error:', error);
        btn.innerHTML = isCurrentlyMonitored ? '✅ במעקב' : '🔔 עקוב';
        btn.disabled = false;
        // Check if it's a context invalidated error
        if (error.message && error.message.includes('refresh')) {
          this.showNotification('רענן את הדף ונסה שוב', 'error');
        } else {
          this.showNotification('שגיאה - נסה שוב', 'error');
        }
      }
    });

    // Add button to the RIGHT side of the game element
    gameElement.style.position = 'relative';
    gameElement.appendChild(btn);

    // Check if already monitored
    this.checkIfMonitored(gameInfo, btn);
  }

  extractGameInfo(element) {
    // Extract from beitarfc.co.il structure
    
    // Get both teams
    const homeTeamEl = element.querySelector('.teams_names .home');
    const awayTeamEl = element.querySelector('.teams_names .away');
    const homeTeam = homeTeamEl?.textContent?.trim() || '';
    const awayTeam = awayTeamEl?.textContent?.trim() || '';
    
    // Find opponent (the team that is NOT Beitar)
    const isBeitarHome = homeTeam.includes('בית"ר') || homeTeam.includes('ביתר');
    const opponent = isBeitarHome ? awayTeam : homeTeam;
    const isHomeGame = isBeitarHome;

    // Get date from .date element
    let eventDate = null;
    const dateEl = element.querySelector('.game_info .date');
    const dateText = dateEl?.textContent?.trim() || '';
    // Format: "25/01/26 -> 01:59"
    const dateMatch = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*->\s*(\d{1,2}):(\d{2})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[1]);
      const month = parseInt(dateMatch[2]) - 1;
      let year = parseInt(dateMatch[3]);
      if (year < 100) year += 2000;
      const hour = parseInt(dateMatch[4]);
      const minute = parseInt(dateMatch[5]);
      eventDate = new Date(year, month, day, hour, minute).getTime();
    }

    // Get stadium
    const stadiumEl = element.querySelector('.stadium');
    const location = stadiumEl?.textContent?.trim() || 'אצטדיון טדי';

    // Get round number
    const roundEl = element.querySelector('.round');
    const round = roundEl?.textContent?.trim() || '';

    // Try to find any leaan ticket link
    let ticketUrl = '';
    let eventId = '';
    const links = element.querySelectorAll('a');
    for (const link of links) {
      const href = link.href || '';
      if (href.includes('leaan.co.il/event/')) {
        ticketUrl = href;
        const idMatch = href.match(/event\/(\d+)/);
        if (idMatch) {
          eventId = idMatch[1];
        }
        break;
      }
    }

    // Generate unique ID based on opponent and date
    const id = eventId || `beitar-vs-${opponent.replace(/\s+/g, '-')}-${eventDate || Date.now()}`;

    return {
      id,
      eventId,
      name: `בית"ר ירושלים נגד ${opponent}`,
      opponent,
      eventDate,
      location,
      round,
      isHomeGame,
      ticketUrl,
      source: 'beitarfc.co.il'
    };
  }

  async addGameToMonitor(gameInfo) {
    return new Promise((resolve, reject) => {
      // Check if extension context is still valid
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Extension context invalidated. Please refresh the page.'));
        return;
      }
      
      chrome.runtime.sendMessage(
        { action: 'addGame', game: gameInfo },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  async removeGameFromMonitor(gameId) {
    return new Promise((resolve, reject) => {
      // Check if extension context is still valid
      if (!chrome.runtime || !chrome.runtime.sendMessage) {
        reject(new Error('Extension context invalidated. Please refresh the page.'));
        return;
      }
      
      chrome.runtime.sendMessage(
        { action: 'removeGame', gameId: gameId },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(response);
          }
        }
      );
    });
  }

  async checkIfMonitored(gameInfo, btn) {
    try {
      const { monitoredGames = [] } = await chrome.storage.local.get('monitoredGames');
      
      console.log('Beitar Monitor: Checking if monitored:', gameInfo.opponent, '| Stored games:', monitoredGames.length);
      
      if (monitoredGames.length === 0) {
        console.log('Beitar Monitor: No games in storage');
        return;
      }

      const isMonitored = monitoredGames.some(g => {
        // Check by opponent + date (most reliable)
        if (g.opponent && gameInfo.opponent && g.opponent === gameInfo.opponent) {
          console.log('Beitar Monitor: Found match by opponent:', g.opponent);
          return true;
        }
        return false;
      });

      if (isMonitored) {
        btn.innerHTML = '✅ במעקב';
        btn.classList.add('monitoring');
      }
    } catch (error) {
      console.log('Beitar Monitor: Could not check monitoring status', error);
    }
  }

  addStatusIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'beitar-monitor-indicator';
    indicator.innerHTML = `
      <div class="indicator-content">
        <span class="indicator-icon">🎟️</span>
        <span class="indicator-text">Beitar Ticket Monitor פעיל</span>
      </div>
    `;
    document.body.appendChild(indicator);

    // Auto-hide after 3 seconds
    setTimeout(() => {
      indicator.classList.add('hidden');
    }, 3000);
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `beitar-notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.classList.add('show');
    }, 100);

    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Initialize
new GameSelector();
