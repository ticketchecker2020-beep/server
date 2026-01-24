// Background Service Worker for Beitar Ticket Monitor

// Try the API directly - leaan.co.il has an API for matches
const LEAAN_API_URL = 'https://www.leaan.co.il/api/category/sport';
const LEAAN_PAGE_URL = 'https://www.leaan.co.il/category/%D7%A1%D7%A4%D7%95%D7%A8%D7%98';
const DEFAULT_CHECK_INTERVAL = 5; // minutes
const DEFAULT_SERVER_URL = 'https://server-tickets-l0rq.onrender.com';

class TicketMonitor {
  constructor() {
    this.setupAlarm();
    this.setupMessageListeners();
  }

  async setupAlarm() {
    const { checkInterval = DEFAULT_CHECK_INTERVAL } = await chrome.storage.local.get('checkInterval');
    
    // Clear existing alarm
    await chrome.alarms.clear('checkTickets');
    
    // Create new alarm
    chrome.alarms.create('checkTickets', {
      delayInMinutes: 1,
      periodInMinutes: checkInterval
    });

    console.log(`Ticket check alarm set for every ${checkInterval} minutes`);
  }

  setupMessageListeners() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.action) {
        case 'checkNow':
          // When manually checking, force send notifications even if already notified
          this.checkTickets(true).then(() => sendResponse({ success: true }));
          return true; // async response
        
        case 'updateInterval':
          this.updateCheckInterval(message.interval).then(() => sendResponse({ success: true }));
          return true;
        
        case 'addGame':
          this.addMonitoredGame(message.game).then(() => sendResponse({ success: true }));
          return true;
        
        case 'removeGame':
          this.removeMonitoredGame(message.gameId).then(() => sendResponse({ success: true }));
          return true;
      }
    });

    // Alarm listener
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'checkTickets') {
        this.checkTickets();
      }
    });
  }

  async updateCheckInterval(interval) {
    await chrome.storage.local.set({ checkInterval: interval });
    await chrome.alarms.clear('checkTickets');
    chrome.alarms.create('checkTickets', {
      delayInMinutes: interval,
      periodInMinutes: interval
    });
    console.log(`Check interval updated to ${interval} minutes`);
  }

  async addMonitoredGame(game) {
    console.log('🎮 addMonitoredGame called with:', game);
    
    const { monitoredGames = [] } = await chrome.storage.local.get('monitoredGames');
    console.log('🎮 Current monitored games:', monitoredGames.length);
    
    // Check if game already exists
    if (!monitoredGames.find(g => g.id === game.id)) {
      const newGame = {
        ...game,
        addedAt: Date.now(),
        hasTickets: false,
        isSoldOut: false,
        lastChecked: null
      };
      
      monitoredGames.push(newGame);
      await chrome.storage.local.set({ monitoredGames });
      console.log('✅ Game added to monitoring:', game.name);
      console.log('✅ Total monitored games now:', monitoredGames.length);
      
      // Also sync to server
      await this.syncGameToServer(newGame, 'add');
    } else {
      console.log('⚠️ Game already exists in monitoring:', game.id);
    }
  }
  
  async syncGameToServer(game, action = 'add') {
    try {
      // Get subscriber ID (email)
      const { userEmails, userEmail } = await chrome.storage.local.get(['userEmails', 'userEmail']);
      let subscriberId = userEmails?.[0] || userEmail;
      
      console.log('🔄 Server sync - subscriberId:', subscriberId);
      
      // If no subscriber ID, create a temporary one and prompt user
      if (!subscriberId) {
        console.log('⚠️ No subscriber ID found - game saved locally only');
        console.log('💡 User needs to open extension and enter email to sync to server');
        // Show notification to user
        chrome.notifications.create('need-setup', {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '⚙️ נדרשת הגדרה',
          message: 'פתח את התוסף והכנס אימייל כדי לקבל התראות',
          priority: 2
        });
        return { success: false, error: 'No subscriber ID - please open extension and enter email' };
      }
      
      const endpoint = action === 'add' ? '/api/add-game' : '/api/remove-game';
      const body = action === 'add' 
        ? { subscriberId, game }
        : { subscriberId, gameId: game.id };
      
      console.log(`🔄 Sending to ${endpoint}:`, JSON.stringify(body));
      
      const response = await fetch(`${DEFAULT_SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const result = await response.json();
      console.log(`✅ Server sync (${action}) response:`, JSON.stringify(result));
      return result;
    } catch (error) {
      console.error('❌ Failed to sync game to server:', error.message);
      return { success: false, error: error.message };
    }
  }

  async removeMonitoredGame(gameId) {
    const { monitoredGames = [] } = await chrome.storage.local.get('monitoredGames');
    const gameToRemove = monitoredGames.find(g => g.id === gameId);
    const updatedGames = monitoredGames.filter(g => g.id !== gameId);
    await chrome.storage.local.set({ monitoredGames: updatedGames });
    console.log('Game removed from monitoring:', gameId);
    
    // Sync to server
    if (gameToRemove) {
      await this.syncGameToServer(gameToRemove, 'remove');
    }
  }

  async checkTickets(forceNotify = false) {
    console.log('Checking tickets...', forceNotify ? '(FORCE NOTIFY)' : '');
    
    try {
      // Try multiple approaches to get match data
      let matches = [];
      
      // Approach 1: Try API endpoints
      const apiEndpoints = [
        'https://www.leaan.co.il/api/category/sport',
        'https://www.leaan.co.il/api/sports',
        'https://www.leaan.co.il/api/upcoming-matches',
        'https://www.leaan.co.il/_next/data/build-id/category/%D7%A1%D7%A4%D7%95%D7%A8%D7%98.json'
      ];
      
      for (const apiUrl of apiEndpoints) {
        try {
          console.log('Trying API:', apiUrl);
          const response = await fetch(apiUrl);
          if (response.ok) {
            const data = await response.json();
            console.log('API response keys:', Object.keys(data));
            matches = this.extractMatchesFromApiResponse(data);
            if (matches.length > 0) {
              console.log(`Found ${matches.length} matches from API`);
              break;
            }
          }
        } catch (e) {
          console.log('API failed:', apiUrl, e.message);
        }
      }
      
      // Approach 2: Fetch page and parse HTML
      if (matches.length === 0) {
        console.log('Trying to fetch and parse page...');
        const response = await fetch(LEAAN_PAGE_URL);
        const html = await response.text();
        matches = this.extractMatchesFromHtml(html);
      }
      
      console.log('Total matches found:', matches.length);
      
      // Get monitored games
      const { monitoredGames = [], userEmails, userEmail } = await chrome.storage.local.get(['monitoredGames', 'userEmails', 'userEmail']);
      
      console.log('📊 Storage state:');
      console.log('  - Monitored games:', monitoredGames.length);
      console.log('  - User emails:', userEmails || userEmail || 'NONE');
      
      if (monitoredGames.length === 0) {
        console.log('No games being monitored');
        return;
      }
      
      console.log('🎯 Monitored games:', monitoredGames.map(g => g.opponent || g.name).join(', '));
      // Check each monitored game
      const updatedGames = [];
      const availableGames = [];

      for (const game of monitoredGames) {
        // Try to find matching game on leaan.co.il
        const matchingGame = matches.find(m => {
          // Match by event ID
          if (game.eventId && m.event_id === game.eventId) return true;
          
          // Build searchable text from various fields
          const eventName = (m.event_name || m.name || m.title || '').toLowerCase();
          const homeTeam = (m.match_info?.host_team?.name || m.home_team || '').toLowerCase();
          const awayTeam = (m.match_info?.away_team?.name || m.away_team || '').toLowerCase();
          const allText = `${eventName} ${homeTeam} ${awayTeam}`;
          
          // Normalize text to handle different quote characters
          const normalizedText = allText
            .replace(/[״"''`]/g, '"')  // Normalize all quote types
            .replace(/בית"ר/g, 'ביתר')
            .replace(/בית\\"/g, 'ביתר');
          
          // IMPORTANT: Check if this is a Beitar Jerusalem game
          // Must contain "ביתר" or "בית" AND "ירושלים" to be a Beitar Jerusalem game
          const hasBeitarWord = normalizedText.includes('ביתר') || 
                                normalizedText.includes('בית') ||
                                allText.includes('ביתר') ||
                                allText.includes('בית');
          const hasJerusalem = normalizedText.includes('ירושלים') || allText.includes('ירושלים');
          const isBeitarGame = hasBeitarWord && hasJerusalem;
          
          // If this is not a Beitar Jerusalem game, skip it
          if (!isBeitarGame) {
            return false;
          }
          
          // Match by opponent name
          if (game.opponent) {
            const opponentLower = game.opponent.toLowerCase();
            
            // Normalize team names for better matching
            const normalizeTeamName = (name) => {
              return name
                .replace(/בית"ר|בית״ר|ביתר|בית\\"/gi, 'ביתר')
                .replace(/מ\.ס\.ע|מ\.ס\.|מס |מ\.ס /gi, 'מס ')  // Handle מ.ס.ע and מ.ס
                .replace(/הפועל/gi, 'הפועל')
                .replace(/מכבי/gi, 'מכבי')
                .replace(/\s+/g, ' ')
                .trim();
            };
            
            const normalizedOpponent = normalizeTeamName(opponentLower);
            const normalizedAllText = normalizeTeamName(allText);
            
            // Check if opponent appears anywhere (normalized)
            if (normalizedAllText.includes(normalizedOpponent)) return true;
            
            // Direct check without normalization
            if (allText.includes(opponentLower)) return true;
            
            // Special handling for teams with similar names
            // Extract just the city/identifier part
            const opponentParts = normalizedOpponent.split(' ').filter(p => p.length > 2);
            for (const part of opponentParts) {
              if (normalizedAllText.includes(part) && part !== 'הפועל' && part !== 'מכבי' && part !== 'מס') {
                return true;
              }
            }
          }
          
          return false;
        });

        console.log(`Looking for: ${game.opponent}, Found match: ${matchingGame?.event_name || matchingGame?.name || 'NOT FOUND'}`);
        if (!matchingGame) {
          // Debug: show why no match - list first 3 Beitar games found
          const beitarGames = matches.filter(m => {
            const name = (m.event_name || m.name || '').toLowerCase();
            return name.includes('ביתר') || name.includes('בית') || name.includes('ירושלים');
          }).slice(0, 3);
          console.log(`  → Available Beitar games: ${beitarGames.map(g => g.event_name || g.name).join(', ') || 'NONE'}`);
        }
        if (matchingGame) {
          console.log(`  → Price: ${matchingGame.starting_price || matchingGame.price || 'N/A'}₪`);
          console.log(`  → URL: ${matchingGame.url || 'N/A'}`);
          console.log(`  → Event ID: ${matchingGame.event_id || 'N/A'}`);
        }

        const wasAvailable = game.hasTickets;
        const neverChecked = game.lastChecked === null;
        console.log(`  → Previous state: wasAvailable=${wasAvailable}, neverChecked=${neverChecked}`);
        
        // Determine if tickets are available
        // Check multiple sold out indicators (JSON fields and text-based)
        const soldOutIndicators = [
          matchingGame?.is_soldout,
          matchingGame?.sold_out,
          matchingGame?.soldOut,
          (matchingGame?.event_name || '').includes('אזלו'),
          (matchingGame?.status || '').includes('אזלו'),
          (matchingGame?.availability || '').toLowerCase().includes('sold')
        ];
        const isSoldOut = soldOutIndicators.some(x => x === true);
        const isNowAvailable = matchingGame && !isSoldOut && !matchingGame.subscription;

        console.log(`Checking ${game.opponent}: found=${!!matchingGame}, soldOut=${isSoldOut}, available=${isNowAvailable}, wasAvailable=${wasAvailable}`);
        if (matchingGame) {
          console.log(`  → Event: ${matchingGame.event_name || matchingGame.name}`);
          console.log(`  → SoldOut indicators: is_soldout=${matchingGame.is_soldout}, sold_out=${matchingGame.sold_out}`);
        }

        // Build the ticket URL - prefer the direct event link
        const ticketUrl = matchingGame?.url || 
          (matchingGame?.event_id ? `https://www.leaan.co.il/event/${matchingGame.event_id}` : null) ||
          'https://www.leaan.co.il/category/%D7%A1%D7%A4%D7%95%D7%A8%D7%98/%D7%9B%D7%93%D7%95%D7%A8%D7%92%D7%9C/%D7%91%D7%99%D7%AA%D7%A8-%D7%99%D7%A8%D7%95%D7%A9%D7%9C%D7%99%D7%9D';

        const updatedGame = {
          ...game,
          hasTickets: isNowAvailable,
          isSoldOut: isSoldOut,
          lastChecked: Date.now(),
          ticketPrice: matchingGame?.starting_price || matchingGame?.price || null,
          ticketUrl: ticketUrl
        };
        
        console.log(`  → Final URL for notification: ${updatedGame.ticketUrl}`);
        console.log(`  → Final Price for notification: ${updatedGame.ticketPrice}₪`);

        updatedGames.push(updatedGame);

        // Notify if tickets are available AND (just became available OR first time checking OR force)
        console.log(`  → Should notify? available=${isNowAvailable}, wasAvailable=${wasAvailable}, neverChecked=${neverChecked}, forceNotify=${forceNotify}`);
        if (isNowAvailable && (forceNotify || !wasAvailable || neverChecked)) {
          console.log(`  → ✅ Adding to notification queue: ${game.opponent}`);
          availableGames.push(updatedGame);
        } else if (isNowAvailable) {
          console.log(`  → ⏭️ Skipping notification (already notified before)`);
        }
      }

      // Save updated games
      await chrome.storage.local.set({ 
        monitoredGames: updatedGames,
        lastCheck: Date.now()
      });

      // Send notifications for newly available tickets
      if (availableGames.length > 0) {
        await this.sendNotifications(availableGames);
      }

      console.log(`Check complete. ${availableGames.length} new tickets available.`);

    } catch (error) {
      console.error('Error checking tickets:', error);
    }
  }

  extractMatchesFromApiResponse(data) {
    let matches = [];
    
    // Try various paths where matches might be
    const paths = [
      data?.matches,
      data?.data?.matches,
      data?.upcoming_matches?.matches,
      data?.data?.upcoming_matches?.matches,
      data?.pageProps?.data?.category?.subcategories,
      data?.category?.subcategories,
      data?.events,
      data?.data?.events
    ];
    
    for (const path of paths) {
      if (Array.isArray(path) && path.length > 0) {
        // Check if it's subcategories or direct matches
        if (path[0]?.teams || path[0]?.upcoming_matches) {
          // It's subcategories, extract matches from them
          for (const subcat of path) {
            if (subcat.upcoming_matches?.matches) {
              matches = matches.concat(subcat.upcoming_matches.matches);
            }
            if (subcat.teams) {
              for (const team of subcat.teams) {
                if (team.upcoming_matches?.matches) {
                  matches = matches.concat(team.upcoming_matches.matches);
                }
              }
            }
          }
        } else {
          matches = path;
        }
        
        if (matches.length > 0) break;
      }
    }
    
    return matches;
  }

  extractMatchesFromHtml(html) {
    try {
      // leaan.co.il uses Next.js with __NEXT_DATA__ containing all the data
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextDataMatch) {
        const nextData = JSON.parse(nextDataMatch[1]);
        
        // Look for matches in different possible locations
        const pageProps = nextData?.props?.pageProps;
        const data = pageProps?.data;
        const category = data?.category;
        
        console.log('Exploring page data structure...');
        
        // Try to find matches/events in various locations
        let matches = [];
        
        // Check category structure (sport page)
        if (category) {
          console.log('category keys:', Object.keys(category));
          
          // Check category.upcoming_matches
          if (category.upcoming_matches?.matches) {
            matches = category.upcoming_matches.matches;
            console.log('Found in category.upcoming_matches.matches:', matches.length);
          }
          // Check category.matches
          else if (category.matches) {
            matches = category.matches;
            console.log('Found in category.matches:', matches.length);
          }
          // Check category.events
          else if (category.events) {
            matches = category.events;
            console.log('Found in category.events:', matches.length);
          }
          // Check subcategories (like כדורגל, כדורסל)
          else if (category.subcategories) {
            console.log('Found subcategories:', category.subcategories.length);
            for (const subcat of category.subcategories) {
              console.log(`  Subcategory: ${subcat.category_name || subcat.name}`);
              
              // Check for matches in subcategory
              if (subcat.upcoming_matches?.matches) {
                matches = matches.concat(subcat.upcoming_matches.matches);
              }
              if (subcat.matches) {
                matches = matches.concat(subcat.matches);
              }
              
              // Check teams in subcategory
              if (subcat.teams) {
                console.log(`    Teams: ${subcat.teams.length}`);
                for (const team of subcat.teams) {
                  if (team.upcoming_matches?.matches) {
                    matches = matches.concat(team.upcoming_matches.matches);
                  }
                }
              }
            }
            console.log('Total from subcategories:', matches.length);
          }
          
          // Deep explore category if still no matches
          if (matches.length === 0) {
            console.log('Deep exploring category...');
            for (const key of Object.keys(category)) {
              const val = category[key];
              const type = Array.isArray(val) ? `array(${val.length})` : typeof val;
              console.log(`  category.${key}: ${type}`);
              
              if (val && typeof val === 'object' && !Array.isArray(val)) {
                for (const subKey of Object.keys(val).slice(0, 10)) {
                  const subVal = val[subKey];
                  const subType = Array.isArray(subVal) ? `array(${subVal.length})` : typeof subVal;
                  console.log(`    category.${key}.${subKey}: ${subType}`);
                }
              }
            }
          }
        }
        
        // Check data.upcoming_matches directly
        if (matches.length === 0 && data?.upcoming_matches?.matches) {
          matches = data.upcoming_matches.matches;
          console.log('Found in data.upcoming_matches.matches:', matches.length);
        }
        
        if (matches.length > 0) {
          console.log(`Found ${matches.length} matches total`);
          if (matches[0]) {
            console.log('Sample match:', JSON.stringify(matches[0], null, 2).substring(0, 1000));
          }
          return matches.filter(m => !m.subscription);
        }
      }

      console.log('Could not find match data in __NEXT_DATA__, parsing HTML...');
      
      // Parse HTML directly - look for match cards
      const matches = [];
      
      // Pattern 1: Parse embedded JSON event objects
      // Look for: "event_id":"68a4a082d99ad189ee2b2958"..."event_name":"בית\"ר ירושלים - הפועל חיפה"..."starting_price":95
      // Also capture is_soldout if present
      const eventJsonPattern = /"event_id"\s*:\s*"([^"]+)"[^}]*?"event_name"\s*:\s*"([^"]+)"[^}]*?"starting_price"\s*:\s*(\d+)/gi;
      let match;
      
      while ((match = eventJsonPattern.exec(html)) !== null) {
        const eventId = match[1];
        const eventName = match[2].replace(/\\"/g, '"'); // Unescape quotes
        const price = parseInt(match[3]);
        
        // Check nearby text for soldout status
        const nearbyText = html.substring(Math.max(0, match.index - 200), match.index + 500);
        const isSoldOut = nearbyText.includes('"is_soldout":true') || 
                          nearbyText.includes('SOLD OUT') ||
                          nearbyText.includes('אזלו הכרטיסים') ||
                          nearbyText.includes('אזלו');
        
        if (!matches.find(m => m.event_id === eventId)) {
          matches.push({
            event_id: eventId,
            event_name: eventName,
            starting_price: price,
            is_soldout: isSoldOut,
            url: `https://www.leaan.co.il/event/${eventId}`
          });
        }
      }
      
      // Pattern 2: Also try reverse order (starting_price before event_name)
      const eventJsonPattern2 = /"event_id"\s*:\s*"([^"]+)"[^}]*?"starting_price"\s*:\s*(\d+)[^}]*?"event_name"\s*:\s*"([^"]+)"/gi;
      while ((match = eventJsonPattern2.exec(html)) !== null) {
        const eventId = match[1];
        const price = parseInt(match[2]);
        const eventName = match[3].replace(/\\"/g, '"');
        
        // Check nearby text for soldout status
        const nearbyText = html.substring(Math.max(0, match.index - 200), match.index + 500);
        const isSoldOut = nearbyText.includes('"is_soldout":true') || 
                          nearbyText.includes('SOLD OUT') ||
                          nearbyText.includes('אזלו הכרטיסים') ||
                          nearbyText.includes('אזלו');
        
        if (!matches.find(m => m.event_id === eventId)) {
          matches.push({
            event_id: eventId,
            event_name: eventName,
            starting_price: price,
            is_soldout: isSoldOut,
            url: `https://www.leaan.co.il/event/${eventId}`
          });
        }
      }
      
      // Pattern 3: Parse full JSON objects from script content
      // Try to find and parse any embedded event JSON arrays
      const scriptJsonPattern = /\[{"id":\d+,"event_id":"[^"]+[^]*?\}(?:,\{"id":\d+[^]*?\})*\]/g;
      const jsonMatches = html.match(scriptJsonPattern);
      if (jsonMatches) {
        for (const jsonStr of jsonMatches) {
          try {
            const events = JSON.parse(jsonStr);
            if (Array.isArray(events)) {
              for (const event of events) {
                if (event.event_id && event.event_name && !matches.find(m => m.event_id === event.event_id)) {
                  matches.push({
                    event_id: event.event_id,
                    event_name: event.event_name || event.name,
                    starting_price: event.starting_price,
                    is_soldout: event.is_soldout,
                    url: `https://www.leaan.co.il/event/${event.event_id}`
                  });
                }
              }
            }
          } catch (e) {
            // JSON parse failed, continue
          }
        }
      }
      
      // Pattern 4: Look for titles with h4/h3 tags as fallback (event titles on page)
      const titlePattern = /<h[34][^>]*>([^<]+)<\/h[34]>/gi;
      while ((match = titlePattern.exec(html)) !== null) {
        const title = match[1].trim();
        if (title.length > 3 && title.length < 100) {
          // Skip if already found via JSON
          if (matches.find(m => m.event_name === title)) continue;
          
          // Try to find a nearby price in surrounding text
          const nearbyText = html.substring(Math.max(0, match.index - 500), match.index + 500);
          const priceMatch = nearbyText.match(/(\d+)\s*₪/);
          
          matches.push({
            event_name: title,
            starting_price: priceMatch ? parseInt(priceMatch[1]) : null
          });
        }
      }
      
      if (matches.length > 0) {
        console.log('Found matches via HTML parsing:', matches.length);
        matches.slice(0, 30).forEach(m => console.log('  -', m.event_name, m.starting_price ? `(${m.starting_price}₪)` : '', m.url ? `[${m.event_id}]` : ''));
        return matches;
      }

      return [];

    } catch (error) {
      console.error('Error extracting matches:', error);
      return [];
    }
  }

  async sendNotifications(availableGames) {
    console.log(`📧 sendNotifications called with ${availableGames.length} games`);
    
    const settings = await chrome.storage.local.get([
      'browserNotifications',
      'emailNotifications',
      'smsNotifications',
      'licenseKey',
      'userEmail',
      'userPhone'
    ]);
    
    console.log('📧 Notification settings:', {
      browserNotifications: settings.browserNotifications,
      emailNotifications: settings.emailNotifications,
      smsNotifications: settings.smsNotifications,
      hasEmail: !!settings.userEmail,
      hasPhone: !!settings.userPhone,
      hasLicense: !!settings.licenseKey
    });

    // Browser notifications
    if (settings.browserNotifications !== false) {
      for (const game of availableGames) {
        await chrome.notifications.create(`ticket-${game.id}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: '🎟️ כרטיסים זמינים!',
          message: `${game.name}\nמחיר החל מ-${game.ticketPrice || '?'}₪`,
          priority: 2,
          buttons: [{ title: 'לרכישה' }]
        });
      }
    }

    // Email notifications (free for everyone!)
    console.log(`📧 Email check: emailNotifications=${settings.emailNotifications}, userEmail=${settings.userEmail}`);
    if (settings.emailNotifications && settings.userEmail) {
      console.log('📧 Sending email notification...');
      try {
        const response = await fetch(`${DEFAULT_SERVER_URL}/api/notify`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-license-key': settings.licenseKey || 'free-email' // Use license if available, otherwise free email
          },
          body: JSON.stringify({
            email: settings.userEmail,
            phone: null, // No SMS in this call - SMS sent separately
            licenseKey: settings.licenseKey || null, // Include license for tracking
            games: availableGames.map(g => ({
              name: g.name,
              date: g.eventDate,
              price: g.ticketPrice,
              url: g.ticketUrl
            }))
          })
        });
        
        const result = await response.json();
        console.log('📧 Email response:', result);
        if (result.results?.email) {
          console.log('✅ Email notification sent');
        }
      } catch (error) {
        console.error('Email notification failed:', error);
      }
    }

    // SMS notifications (requires paid license)
    if (settings.smsNotifications && settings.licenseKey && settings.userPhone) {
      try {
        const response = await fetch(`${DEFAULT_SERVER_URL}/api/notify`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-license-key': settings.licenseKey
          },
          body: JSON.stringify({
            email: null, // Already sent via email
            phone: settings.userPhone,
            licenseKey: settings.licenseKey, // Include in body for server validation
            games: availableGames.map(g => ({
              name: g.name,
              date: g.eventDate,
              price: g.ticketPrice,
              url: g.ticketUrl
            }))
          })
        });
        
        const result = await response.json();
        
        if (!response.ok && result.reason) {
          // License expired or invalid
          console.error('License error:', result.reason);
          chrome.notifications.create('license-error', {
            type: 'basic',
            iconUrl: 'icons/icon128.png',
            title: '⚠️ בעיה ברישיון',
            message: result.reason,
            priority: 2
          });
        } else {
          console.log('Server notification sent');
        }
      } catch (error) {
        console.error('Failed to send server notification:', error);
      }
    }
  }
}

// Initialize on install/update
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Beitar Ticket Monitor installed');
  new TicketMonitor();
  
  // Open onboarding page only on first install (not on update)
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
  }
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Beitar Ticket Monitor started');
  new TicketMonitor();
});

// Notification click handler
chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (notificationId.startsWith('ticket-') && buttonIndex === 0) {
    const gameId = notificationId.replace('ticket-', '');
    const { monitoredGames = [] } = await chrome.storage.local.get('monitoredGames');
    const game = monitoredGames.find(g => g.id === gameId);
    
    if (game?.ticketUrl) {
      chrome.tabs.create({ url: game.ticketUrl });
    }
  }
});

// Initialize
new TicketMonitor();
