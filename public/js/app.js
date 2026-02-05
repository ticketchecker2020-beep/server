/**
 * Beitar Ticket Monitor - Main App Module
 * Entry point and initialization
 */

(function() {
    'use strict';
    
    // App state
    const state = {
        games: [],
        followedGames: [],
        isLoading: false,
        userEmail: null
    };
    
    /**
     * Show beta notice (only once)
     */
    function showBetaNotice() {
        const betaShown = localStorage.getItem('betaNoticeShown');
        if (betaShown) return;
        
        const notice = document.createElement('div');
        notice.id = 'betaNotice';
        notice.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 20px;">
                <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); border: 2px solid #ffd700; border-radius: 20px; padding: 30px; max-width: 500px; text-align: center; color: white;">
                    <h2 style="color: #ffd700; margin-bottom: 20px;">🚧 האתר בהרצה!</h2>
                    <p style="font-size: 16px; line-height: 1.6; margin-bottom: 15px;">
                        שלום וברוכים הבאים! 👋
                    </p>
                    <p style="font-size: 14px; line-height: 1.6; margin-bottom: 15px; color: #ccc;">
                        האתר נמצא כרגע בשלב בדיקות (Beta).<br>
                        ייתכנו באגים או שינויים בתכונות.
                    </p>
                    <p style="font-size: 14px; line-height: 1.6; margin-bottom: 20px; color: #ccc;">
                        נשמח לקבל משוב! 💬
                    </p>
                    <button id="closeBetaNotice" style="background: #ffd700; color: #000; border: none; padding: 12px 30px; border-radius: 25px; font-size: 16px; font-weight: bold; cursor: pointer;">
                        הבנתי, בואו נתחיל! 🎟️
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(notice);
        
        document.getElementById('closeBetaNotice').addEventListener('click', () => {
            localStorage.setItem('betaNoticeShown', 'true');
            notice.remove();
        });
    }
    
    /**
     * Initialize the application
     */
    async function init() {
        console.log('🎫 Beitar Ticket Monitor - Website v1.0.0');
        
        // Show beta notice (only first time)
        showBetaNotice();
        
        // Load saved user email
        state.userEmail = localStorage.getItem('userEmail');
        
        // Setup event listeners
        setupEventListeners();
        
        // Load followed games if user is logged in
        if (state.userEmail) {
            await loadFollowedGames();
        }
        
        // Load games
        await loadGames();
    }
    
    /**
     * Load user's followed games from server
     */
    async function loadFollowedGames() {
        if (!state.userEmail) return;
        
        try {
            const result = await API.getFollowedGames(state.userEmail);
            if (result.success && result.games) {
                state.followedGames = result.games.map(g => g.gameId || g.id);
                console.log('📋 Loaded followed games:', state.followedGames);
            }
        } catch (error) {
            console.error('Failed to load followed games:', error);
        }
    }
    
    /**
     * Setup all event listeners
     */
    function setupEventListeners() {
        // Close modal button
        const closeModal = document.getElementById('closeModal');
        if (closeModal) {
            closeModal.addEventListener('click', () => UI.closeFollowModal());
        }
        
        // Modal overlay click to close
        const modalOverlay = document.getElementById('followModal');
        if (modalOverlay) {
            modalOverlay.addEventListener('click', (e) => {
                if (e.target === modalOverlay) {
                    UI.closeFollowModal();
                }
            });
        }
        
        // Submit follow form
        const submitBtn = document.getElementById('submitFollow');
        if (submitBtn) {
            submitBtn.addEventListener('click', handleFollowSubmit);
        }
        
        // Email input enter key
        const emailInput = document.getElementById('emailInput');
        if (emailInput) {
            emailInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleFollowSubmit();
                }
            });
        }
        
        // Escape key to close modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                UI.closeFollowModal();
            }
        });
        
        // Upgrade to SMS link - pass game info
        const upgradeLink = document.getElementById('upgradeToSms');
        if (upgradeLink) {
            upgradeLink.addEventListener('click', (e) => {
                const modal = document.getElementById('followModal');
                const gameId = modal.getAttribute('data-game-id');
                const gameName = modal.getAttribute('data-game-name');
                const email = document.getElementById('emailInput').value.trim();
                
                // Store info for pricing page
                if (email) {
                    localStorage.setItem('userEmail', email);
                }
                if (gameId) {
                    localStorage.setItem('pendingGameFollow', JSON.stringify({
                        gameId: gameId,
                        gameName: gameName
                    }));
                }
            });
        }
    }
    
    /**
     * Load games from API
     */
    async function loadGames() {
        if (state.isLoading) return;
        
        state.isLoading = true;
        UI.showGamesLoading();
        
        try {
            const games = await API.fetchGames();
            state.games = games;
            UI.renderGames(games, state.followedGames);
        } catch (error) {
            console.error('Failed to load games:', error);
            UI.showToast('שגיאה בטעינת המשחקים', 'error');
            UI.renderGames([], []);
        } finally {
            state.isLoading = false;
        }
    }
    
    /**
     * Handle follow form submission
     */
    async function handleFollowSubmit() {
        const modal = document.getElementById('followModal');
        const emailInput = document.getElementById('emailInput');
        const submitBtn = document.getElementById('submitFollow');
        
        const email = emailInput.value.trim();
        const gameId = modal.getAttribute('data-game-id');
        const gameName = modal.getAttribute('data-game-name');
        
        // Validate email
        if (!email) {
            UI.showFollowError('נא להזין כתובת אימייל');
            emailInput.focus();
            return;
        }
        
        if (!UI.isValidEmail(email)) {
            UI.showFollowError('כתובת אימייל לא תקינה');
            emailInput.focus();
            return;
        }
        
        // Hide error
        UI.hideFollowError();
        
        // Show loading
        UI.setButtonLoading(submitBtn, true);
        
        try {
            const result = await API.subscribeToGame(email, gameId, gameName);
            
            if (result.success) {
                // Save email for future use
                localStorage.setItem('userEmail', email);
                state.userEmail = email;
                
                // Add game to followed games
                if (!state.followedGames.includes(gameId)) {
                    state.followedGames.push(gameId);
                }
                
                // Close modal
                UI.closeFollowModal();
                
                // Show success toast
                UI.showToast(`נרשמתם לקבלת התראות על ${gameName}! 🎉`, 'success');
                
                // Update button state if game card exists
                const gameCard = document.querySelector(`[data-game-id="${gameId}"]`);
                if (gameCard) {
                    const followBtn = gameCard.querySelector('.follow-btn');
                    if (followBtn) {
                        followBtn.innerHTML = '<span>✅</span><span>עוקב</span>';
                        followBtn.classList.remove('btn-outline');
                        followBtn.classList.add('btn-success');
                        followBtn.classList.add('following-btn');
                        followBtn.disabled = true;
                    }
                }
            } else {
                UI.showFollowError(result.error || 'שגיאה בהרשמה');
            }
        } catch (error) {
            console.error('Follow submission error:', error);
            UI.showFollowError('שגיאה בחיבור לשרת');
        } finally {
            UI.setButtonLoading(submitBtn, false);
        }
    }
    
    /**
     * Refresh games (can be called externally)
     */
    window.refreshGames = async function() {
        await loadGames();
    };
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
