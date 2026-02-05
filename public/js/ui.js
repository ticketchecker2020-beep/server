/**
 * Beitar Ticket Monitor - UI Module
 * Handles DOM manipulation, rendering, and user interactions
 */

const UI = {
    /**
     * Format date for display
     * @param {string} dateStr - Date string
     * @returns {string} Formatted date
     */
    formatDate(dateStr) {
        if (!dateStr) return '';
        
        try {
            const date = new Date(dateStr);
            const options = { 
                weekday: 'long', 
                day: 'numeric', 
                month: 'long',
                year: 'numeric'
            };
            return date.toLocaleDateString('he-IL', options);
        } catch {
            return dateStr;
        }
    },
    
    /**
     * Format price for display
     * @param {number} minPrice - Minimum price
     * @param {number} maxPrice - Maximum price
     * @returns {string} Formatted price range
     */
    formatPrice(minPrice, maxPrice) {
        if (!minPrice && !maxPrice) return '';
        
        if (minPrice && maxPrice && minPrice !== maxPrice) {
            return `₪${minPrice} - ₪${maxPrice}`;
        }
        
        return `₪${minPrice || maxPrice}`;
    },
    
    /**
     * Create game card HTML
     * @param {Object} game - Game data
     * @param {Array} followedGames - Array of followed game IDs (optional)
     * @returns {string} HTML string
     */
    createGameCard(game, followedGames = []) {
        const status = game.ticketStatus || (game.soldOut ? 'soldOut' : (game.hasTickets ? 'available' : 'unknown'));
        const statusClass = status === 'soldOut' ? 'sold-out' : (status === 'available' ? 'has-tickets' : '');
        const statusBadge = this.getStatusBadge(game);
        const priceDisplay = this.formatPrice(game.minPrice, game.maxPrice);
        const showBuyButton = status === 'available';
        
        // Check if user is following this game
        const isFollowing = followedGames && followedGames.includes(game.id);
        
        return `
            <div class="game-card ${statusClass}" data-game-id="${game.id}">
                <div class="game-header">
                    <span class="game-icon">⚽</span>
                    <div class="game-info">
                        <h3 class="game-opponent">${this.escapeHtml(game.opponent)}</h3>
                        <div class="game-details">
                            <span class="game-detail">
                                <span>📅</span>
                                <span>${this.formatDate(game.date)}</span>
                            </span>
                            ${game.time ? `
                            <span class="game-detail">
                                <span>🕐</span>
                                <span>${game.time}</span>
                            </span>
                            ` : ''}
                            <span class="game-detail">
                                <span>🏟️</span>
                                <span>${this.escapeHtml(game.venue)}</span>
                            </span>
                        </div>
                    </div>
                </div>
                
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 15px; flex-wrap: wrap;">
                    ${statusBadge}
                    ${priceDisplay ? `<span class="game-price">${priceDisplay}</span>` : ''}
                </div>
                
                <div class="game-actions">
                    ${showBuyButton ? `
                        <a href="${game.ticketUrl}" target="_blank" class="btn btn-primary btn-sm">
                            <span>🎫</span>
                            <span>קנה כרטיסים</span>
                        </a>
                    ` : ''}
                    ${status === 'unknown' ? (isFollowing ? `
                        <button class="btn btn-success btn-sm following-btn" disabled data-game-id="${this.escapeAttr(game.id)}">
                            <span>✅</span>
                            <span>עוקב</span>
                        </button>
                    ` : `
                        <button class="btn btn-outline btn-sm follow-btn" data-game-id="${this.escapeAttr(game.id)}" data-game-name="${this.escapeAttr(game.name || game.opponent)}">
                            <span>🔔</span>
                            <span>עקוב</span>
                        </button>
                    `) : ''}
                </div>
            </div>
        `;
    },
    
    /**
     * Get status badge HTML
     * @param {Object} game - Game data
     * @returns {string} HTML string
     */
    getStatusBadge(game) {
        const status = game.ticketStatus || (game.soldOut ? 'soldOut' : (game.hasTickets ? 'available' : 'unknown'));
        switch (status) {
            case 'soldOut':
                return '<span class="game-status status-soldout"><span>❌</span> אזל</span>';
            case 'available':
                return '<span class="game-status status-available"><span>✅</span> יש כרטיסים!</span>';
            default:
                return '<span class="game-status status-waiting"><span>⏳</span> טרם נפתחה מכירה</span>';
        }
    },
    
    /**
     * Render games grid
     * @param {Array} games - Array of game objects
     * @param {Array} followedGames - Array of followed game IDs (optional)
     * @param {string} containerId - Container element ID
     */
    renderGames(games, followedGames = [], containerId = 'gamesGrid') {
        const container = document.getElementById(containerId);
        const loadingEl = document.getElementById('gamesLoading');
        const emptyEl = document.getElementById('gamesEmpty');
        
        // Store followed games for later use
        this.currentFollowedGames = followedGames || [];
        
        // Hide loading
        if (loadingEl) loadingEl.classList.add('hidden');
        
        if (!games || games.length === 0) {
            if (emptyEl) emptyEl.classList.remove('hidden');
            container.innerHTML = '';
            return;
        }
        
        // Hide empty state
        if (emptyEl) emptyEl.classList.add('hidden');
        
        // Render game cards
        container.innerHTML = games.map(game => this.createGameCard(game, followedGames)).join('');
        
        // Add event listeners to follow buttons
        this.attachFollowButtonListeners();
    },
    
    /**
     * Attach click listeners to follow buttons
     */
    attachFollowButtonListeners() {
        // Follow buttons (not yet following)
        document.querySelectorAll('.follow-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const gameId = btn.getAttribute('data-game-id');
                const gameName = btn.getAttribute('data-game-name');
                
                // Check if email is already saved - auto-subscribe without modal
                const savedEmail = localStorage.getItem('userEmail');
                if (savedEmail) {
                    // Show loading on button
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = '<span>⏳</span><span>רושם...</span>';
                    btn.disabled = true;
                    
                    try {
                        const result = await API.subscribeToGame(savedEmail, gameId, gameName);
                        if (result.success) {
                            btn.innerHTML = '<span>✅</span><span>עוקב</span>';
                            btn.classList.remove('btn-outline', 'follow-btn');
                            btn.classList.add('btn-success', 'following-btn');
                            btn.disabled = false; // Re-enable for unfollow
                            this.showToast(`נרשמתם לקבלת התראות על ${gameName}! 🎉`, 'success');
                        } else {
                            btn.innerHTML = originalHtml;
                            btn.disabled = false;
                            this.showToast(result.error || 'שגיאה בהרשמה', 'error');
                        }
                    } catch (error) {
                        btn.innerHTML = originalHtml;
                        btn.disabled = false;
                        this.showToast('שגיאה בחיבור לשרת', 'error');
                    }
                } else {
                    // No saved email - show modal
                    this.openFollowModal(gameId, gameName);
                }
            });
        });
        
        // Following buttons (already following - click to unfollow)
        document.querySelectorAll('.following-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const gameId = btn.getAttribute('data-game-id');
                const savedEmail = localStorage.getItem('userEmail');
                
                if (!savedEmail) return;
                
                // Confirm unfollow
                if (!confirm('להפסיק לעקוב אחרי המשחק הזה?')) return;
                
                const originalHtml = btn.innerHTML;
                btn.innerHTML = '<span>⏳</span><span>מבטל...</span>';
                btn.disabled = true;
                
                try {
                    const result = await API.unsubscribeFromGame(savedEmail, gameId);
                    if (result.success) {
                        btn.innerHTML = '<span>🔔</span><span>עקוב</span>';
                        btn.classList.remove('btn-success', 'following-btn');
                        btn.classList.add('btn-outline', 'follow-btn');
                        btn.disabled = false;
                        this.showToast('הפסקתם לעקוב אחרי המשחק', 'info');
                        // Reload to rebind events
                        if (window.refreshGames) window.refreshGames();
                    } else {
                        btn.innerHTML = originalHtml;
                        btn.disabled = false;
                        this.showToast(result.error || 'שגיאה בביטול', 'error');
                    }
                } catch (error) {
                    btn.innerHTML = originalHtml;
                    btn.disabled = false;
                    this.showToast('שגיאה בחיבור לשרת', 'error');
                }
            });
        });
    },
    
    /**
     * Open follow modal
     * @param {string} gameId - Game ID
     * @param {string} gameName - Game name
     */
    openFollowModal(gameId, gameName) {
        const modal = document.getElementById('followModal');
        const modalGameInfo = document.getElementById('modalGameInfo');
        
        // Store game info for form submission
        modal.setAttribute('data-game-id', gameId);
        modal.setAttribute('data-game-name', gameName);
        
        // Update modal game info
        modalGameInfo.innerHTML = `
            <div class="game-header">
                <span class="game-icon">⚽</span>
                <div class="game-info">
                    <h3 class="game-opponent">${this.escapeHtml(gameName)}</h3>
                    <p class="text-muted">נודיע לכם כשיהיו כרטיסים</p>
                </div>
            </div>
        `;
        
        // Clear previous input
        document.getElementById('emailInput').value = '';
        document.getElementById('errorContainer').style.display = 'none';
        
        // Check for saved email
        const savedEmail = localStorage.getItem('userEmail');
        if (savedEmail) {
            document.getElementById('emailInput').value = savedEmail;
        }
        
        // Show modal
        modal.classList.add('active');
        
        // Focus email input
        setTimeout(() => {
            document.getElementById('emailInput').focus();
        }, 100);
    },
    
    /**
     * Close follow modal
     */
    closeFollowModal() {
        const modal = document.getElementById('followModal');
        modal.classList.remove('active');
    },
    
    /**
     * Show error in follow form
     * @param {string} message - Error message
     */
    showFollowError(message) {
        const container = document.getElementById('errorContainer');
        const messageEl = document.getElementById('errorMessage');
        container.style.display = 'block';
        messageEl.textContent = message;
    },
    
    /**
     * Hide error in follow form
     */
    hideFollowError() {
        document.getElementById('errorContainer').style.display = 'none';
    },
    
    /**
     * Show toast notification
     * @param {string} message - Toast message
     * @param {string} type - 'success', 'error', or 'warning'
     */
    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.style.borderRight = `4px solid var(--${type === 'success' ? 'success' : type === 'error' ? 'danger' : 'warning'})`;
        
        const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : '⚠️';
        toast.innerHTML = `<span>${icon}</span><span>${this.escapeHtml(message)}</span>`;
        
        container.appendChild(toast);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            toast.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 5000);
    },
    
    /**
     * Set loading state on button
     * @param {HTMLElement} button - Button element
     * @param {boolean} loading - Whether loading
     * @param {string} originalText - Original button text
     */
    setButtonLoading(button, loading, originalText = '') {
        if (loading) {
            button.disabled = true;
            button.setAttribute('data-original', button.innerHTML);
            button.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>';
        } else {
            button.disabled = false;
            button.innerHTML = button.getAttribute('data-original') || originalText;
        }
    },
    
    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    /**
     * Escape text for use in HTML attributes
     * @param {string} text - Text to escape
     * @returns {string} Escaped text safe for attributes
     */
    escapeAttr(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },
    
    /**
     * Validate email format
     * @param {string} email - Email to validate
     * @returns {boolean} Is valid
     */
    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    },
    
    /**
     * Show games loading state
     */
    showGamesLoading() {
        const loadingEl = document.getElementById('gamesLoading');
        const emptyEl = document.getElementById('gamesEmpty');
        const container = document.getElementById('gamesGrid');
        
        if (loadingEl) loadingEl.classList.remove('hidden');
        if (emptyEl) emptyEl.classList.add('hidden');
        container.innerHTML = '';
        container.appendChild(loadingEl);
    }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = UI;
}
