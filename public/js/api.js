/**
 * Beitar Ticket Monitor - API Module
 * Handles all communication with the server and Leaan.co.il
 */

const API = {
    // Server URL - change this when deploying to production
    serverUrl: 'https://server-tickets-l0rq.onrender.com',
    
    // Leaan.co.il games API (using proxy to avoid CORS)
    gamesUrl: 'https://www.leaan.co.il/api/events/page/beitar-jerusalem',
    
    /**
     * Fetch upcoming games from Leaan.co.il
     * @returns {Promise<Array>} Array of game objects
     */
    async fetchGames() {
        try {
            // Try direct fetch first (may fail due to CORS)
            const response = await fetch(this.gamesUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to fetch games');
            }
            
            const data = await response.json();
            return this.parseGamesResponse(data);
        } catch (error) {
            console.error('Direct fetch failed, trying proxy:', error);
            
            // Try through our server proxy
            try {
                const proxyResponse = await fetch(`${this.serverUrl}/api/games/proxy`);
                if (proxyResponse.ok) {
                    const data = await proxyResponse.json();
                    return this.parseGamesResponse(data);
                }
            } catch (proxyError) {
                console.error('Proxy fetch also failed:', proxyError);
            }
            
            // Return mock data for testing
            return this.getMockGames();
        }
    },
    
    /**
     * Parse games response from Leaan.co.il
     * @param {Object} data - Raw API response
     * @returns {Array} Parsed games array
     */
    parseGamesResponse(data) {
        if (!data || !data.events) {
            return [];
        }
        
        return data.events.map(event => ({
            id: event.id || event.event_id,
            name: event.name || event.title || '',
            opponent: event.opponent || this.extractOpponent(event.name || event.title),
            date: event.date || event.event_date,
            time: event.time || this.extractTime(event.date),
            venue: event.venue || event.location || 'טדי',
            ticketStatus: event.ticketStatus || (event.soldOut ? 'soldOut' : (event.hasTickets ? 'available' : 'unknown')),
            hasTickets: event.ticketStatus === 'available' || event.hasTickets || false,
            soldOut: event.ticketStatus === 'soldOut' || event.soldOut || false,
            minPrice: event.startingPrice || event.min_price || event.price_from || null,
            maxPrice: event.max_price || event.price_to || null,
            ticketUrl: event.ticketUrl || event.url || event.ticket_url || `https://www.leaan.co.il/event/${event.id}`,
            imageUrl: event.image || event.image_url || null,
            competition: event.competition || event.category || 'ליגה'
        }));
    },
    
    /**
     * Extract opponent name from event title
     */
    extractOpponent(title) {
        if (!title) return 'משחק ביתר';
        
        // Common patterns: "Beitar Jerusalem vs TEAM" or "TEAM נגד ביתר"
        const vsPatterns = [
            /ביתר ירושלים\s+(?:נגד|vs\.?|מול)\s+(.+)/i,
            /(.+)\s+(?:נגד|vs\.?|מול)\s+ביתר ירושלים/i,
            /beitar jerusalem\s+(?:vs\.?|against)\s+(.+)/i
        ];
        
        for (const pattern of vsPatterns) {
            const match = title.match(pattern);
            if (match) {
                return match[1].trim();
            }
        }
        
        return title;
    },
    
    /**
     * Extract time from ISO date string
     */
    extractTime(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            return date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        } catch {
            return '';
        }
    },
    
    /**
     * Mock games for testing/fallback
     */
    getMockGames() {
        return [
            {
                id: 'mock-1',
                opponent: 'מכבי תל אביב',
                date: '2025-02-15',
                time: '20:30',
                venue: 'טדי',
                hasTickets: false,
                soldOut: false,
                minPrice: 80,
                maxPrice: 350,
                ticketUrl: '#',
                competition: 'ליגה'
            },
            {
                id: 'mock-2',
                opponent: 'הפועל באר שבע',
                date: '2025-02-22',
                time: '19:00',
                venue: 'טדי',
                hasTickets: true,
                soldOut: false,
                minPrice: 60,
                maxPrice: 250,
                ticketUrl: '#',
                competition: 'גביע'
            },
            {
                id: 'mock-3',
                opponent: 'מכבי חיפה',
                date: '2025-03-01',
                time: '21:00',
                venue: 'טדי',
                hasTickets: false,
                soldOut: true,
                minPrice: 100,
                maxPrice: 400,
                ticketUrl: '#',
                competition: 'ליגה'
            }
        ];
    },
    
    /**
     * Subscribe to game notifications (email)
     * @param {string} email - User email
     * @param {string} gameId - Game ID
     * @param {string} gameName - Game name for display
     */
    async subscribeToGame(email, gameId, gameName) {
        try {
            const response = await fetch(`${this.serverUrl}/api/subscriber/add-game`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    gameId: gameId,
                    gameName: gameName,
                    source: 'website'
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                return { success: false, error: data.error || 'שגיאה בהרשמה' };
            }
            
            return { success: true, data: data };
        } catch (error) {
            console.error('Subscribe error:', error);
            return { success: false, error: 'שגיאה בחיבור לשרת' };
        }
    },
    
    /**
     * Create payment session for SMS upgrade
     * @param {string} email - User email
     * @param {string} phone - User phone
     */
    async createPayment(email, phone) {
        try {
            const response = await fetch(`${this.serverUrl}/api/create-pending-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    phone: phone,
                    plan: 'monthly'
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                return { success: false, error: data.error || 'שגיאה ביצירת תשלום' };
            }
            
            return { 
                success: true, 
                paymentUrl: data.paymentUrl,
                orderId: data.orderId
            };
        } catch (error) {
            console.error('Payment creation error:', error);
            return { success: false, error: 'שגיאה בחיבור לשרת' };
        }
    },
    
    /**
     * Verify payment completion
     * @param {string} transactionId - Payment transaction ID
     */
    async verifyPayment(orderId) {
        try {
            const response = await fetch(`${this.serverUrl}/api/activate-order`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orderId: orderId
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                return { success: false, error: data.error || 'שגיאה באימות תשלום' };
            }
            
            return { 
                success: true, 
                email: data.email,
                phone: data.phone,
                licenseKey: data.licenseKey
            };
        } catch (error) {
            console.error('Payment verification error:', error);
            return { success: false, error: 'שגיאה בחיבור לשרת' };
        }
    },
    
    /**
     * Activate coupon code
     * @param {string} couponCode - Coupon code
     * @param {string} email - User email
     */
    async activateCoupon(couponCode, email) {
        try {
            const response = await fetch(`${this.serverUrl}/api/coupon/activate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    code: couponCode,
                    email: email
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                return { success: false, error: data.error || 'קופון לא תקין' };
            }
            
            return { success: true, licenseKey: data.licenseKey };
        } catch (error) {
            console.error('Coupon activation error:', error);
            return { success: false, error: 'שגיאה בחיבור לשרת' };
        }
    },
    
    /**
     * Get user's followed games
     * @param {string} email - User email
     */
    async getFollowedGames(email) {
        try {
            const response = await fetch(`${this.serverUrl}/api/subscriber/games?email=${encodeURIComponent(email)}`);
            
            if (!response.ok) {
                return { success: false, error: 'שגיאה בטעינת משחקים' };
            }
            
            const data = await response.json();
            return { success: true, games: data.games || [] };
        } catch (error) {
            console.error('Get followed games error:', error);
            return { success: false, error: 'שגיאה בחיבור לשרת' };
        }
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
}
