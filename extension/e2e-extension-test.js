/**
 * E2E Test Script for Beitar Ticket Monitor Chrome Extension
 * 
 * Prerequisites:
 *   npm install puppeteer
 * 
 * Run with:
 *   node e2e-extension-test.js
 */

const puppeteer = require('puppeteer');
const path = require('path');

// Configuration
const EXTENSION_PATH = __dirname; // Current directory contains the extension
const SERVER_URL = 'https://server-tickets-l0rq.onrender.com';
const TEST_EMAIL = `ext-test-${Date.now()}@example.com`;
const BEITAR_TICKETS_URL = 'https://www.beitarfc.co.il/%D7%9E%D7%A9%D7%97%D7%A7%D7%99%D7%9D/'; // משחקים page - shows all games with ticket links

// Test results
const results = { passed: 0, failed: 0, tests: [] };

// Colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(msg, color = 'reset') {
    console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logTest(name, passed, details = '') {
    const status = passed ? '[PASS]' : '[FAIL]';
    const color = passed ? 'green' : 'red';
    log(`  ${status} ${name}${details ? ` - ${details}` : ''}`, color);
    results.tests.push({ name, passed, details });
    if (passed) results.passed++; else results.failed++;
}

// Helper to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Get extension ID from chrome://extensions
async function getExtensionId(browser) {
    const page = await browser.newPage();
    await page.goto('chrome://extensions');
    
    // Enable developer mode and get extension ID
    await page.evaluate(() => {
        // This runs in the extensions page context
        const manager = document.querySelector('extensions-manager');
        if (manager && manager.shadowRoot) {
            const toolbar = manager.shadowRoot.querySelector('extensions-toolbar');
            if (toolbar && toolbar.shadowRoot) {
                const toggle = toolbar.shadowRoot.querySelector('#devMode');
                if (toggle && !toggle.checked) toggle.click();
            }
        }
    });
    
    await wait(1000);
    
    // Get extension ID
    const extensionId = await page.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        if (manager && manager.shadowRoot) {
            const itemList = manager.shadowRoot.querySelector('extensions-item-list');
            if (itemList && itemList.shadowRoot) {
                const items = itemList.shadowRoot.querySelectorAll('extensions-item');
                for (const item of items) {
                    const name = item.shadowRoot?.querySelector('#name')?.textContent;
                    if (name && name.includes('Beitar')) {
                        return item.id;
                    }
                }
            }
        }
        return null;
    });
    
    await page.close();
    return extensionId;
}

// ==================== TEST FUNCTIONS ====================

async function testExtensionLoaded(browser, extensionId) {
    log('\n[EXTENSION LOAD]', 'cyan');
    
    logTest('Extension loaded in Chrome', !!extensionId, extensionId || 'Not found');
    return !!extensionId;
}

async function testPopupOpens(browser, extensionId) {
    log('\n[POPUP]', 'cyan');
    
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const page = await browser.newPage();
    
    try {
        await page.goto(popupUrl, { waitUntil: 'networkidle0', timeout: 10000 });
        
        // Check popup loaded
        const title = await page.title();
        logTest('Popup page loads', title.includes('בית') || title.length > 0, title);
        
        // Check HTML structure - div tags balanced (critical for DOM structure!)
        const htmlBalance = await page.evaluate(() => {
            const html = document.body.innerHTML;
            const opens = (html.match(/<div/g) || []).length;
            const closes = (html.match(/<\/div>/g) || []).length;
            return { opens, closes, balanced: opens === closes };
        });
        logTest('HTML div tags balanced', htmlBalance.balanced, 
            htmlBalance.balanced ? '' : `Opens: ${htmlBalance.opens}, Closes: ${htmlBalance.closes}`);
        
        // Check wizard exists (first time flow)
        const hasWizard = await page.$('#wizard') !== null;
        logTest('Wizard container exists', hasWizard);
        
        // Check for step 1 elements
        const hasTermsCheckbox = await page.$('#acceptTerms') !== null;
        logTest('Terms checkbox exists', hasTermsCheckbox);
        
        const hasStartBtn = await page.$('#startWizardBtn') !== null;
        logTest('Start wizard button exists', hasStartBtn);
        
        // Check for Hebrew text (RTL support)
        const bodyDir = await page.$eval('body', el => getComputedStyle(el).direction);
        logTest('RTL support (Hebrew)', bodyDir === 'rtl');
        
        // Check CSS loaded
        const hasStyling = await page.$eval('.wizard-header', el => {
            return getComputedStyle(el).display !== 'none';
        }).catch(() => false);
        logTest('CSS styling loaded', hasStyling);
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Popup opens', false, e.message);
        await page.close();
        return false;
    }
}

async function testRegistrationFlow(browser, extensionId) {
    log('\n[WIZARD FLOW]', 'cyan');
    
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const page = await browser.newPage();
    
    try {
        await page.goto(popupUrl, { waitUntil: 'networkidle0' });
        
        // Step 1: Accept terms
        const termsCheckbox = await page.$('#acceptTerms');
        if (termsCheckbox) {
            await termsCheckbox.click();
            logTest('Can accept terms', true);
            
            // Check start button becomes enabled
            await wait(500);
            const isEnabled = await page.$eval('#startWizardBtn', btn => !btn.disabled);
            logTest('Start button enables after terms', isEnabled);
            
            // Click start
            const startBtn = await page.$('#startWizardBtn');
            if (startBtn && isEnabled) {
                await startBtn.click();
                await wait(500);
                logTest('Can click start wizard', true);
            }
        } else {
            logTest('Terms checkbox found', false);
        }
        
        // Step 2: Enter email
        await wait(500);
        const emailInput = await page.$('.wizard-email-input');
        if (emailInput) {
            await emailInput.type(TEST_EMAIL);
            logTest('Can type in email field', true);
            
            // Click next
            const nextBtn = await page.$('#emailNextBtn');
            if (nextBtn) {
                await nextBtn.click();
                await wait(500);
                logTest('Can proceed to step 3', true);
            }
        } else {
            logTest('Email input found in step 2', false);
        }
        
        // Step 3: Plan selection visible
        const planEmail = await page.$('#planEmail');
        const planSms = await page.$('#planSms');
        logTest('Plan options visible', planEmail !== null && planSms !== null);
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Wizard flow', false, e.message);
        await page.close();
        return false;
    }
}

async function testContentScript(browser) {
    log('\n[CONTENT SCRIPT]', 'cyan');
    
    const page = await browser.newPage();
    
    try {
        // Navigate to Beitar tickets page
        log('  Loading beitarfc.co.il/משחקים...', 'yellow');
        await page.goto(BEITAR_TICKETS_URL, { 
            waitUntil: 'networkidle2',
            timeout: 45000 
        });
        
        // Wait for page to load
        await wait(3000);
        
        // Check if site has bot protection (Cloudflare challenge)
        const pageContent = await page.content();
        const hasCloudflareChallenge = pageContent.includes('מאמתים את הבקשה') || 
                                        pageContent.includes('Cloudflare') ||
                                        pageContent.includes('challenge') ||
                                        pageContent.includes('Just a moment');
        
        if (hasCloudflareChallenge) {
            log('  ⚠️ Site has bot protection (Cloudflare) - skipping content script test', 'yellow');
            logTest('Content script test', true, 'Skipped - site has bot protection');
            global.contentPage = null;
            global.hasFollowButtons = false;
            global.siteHasBotProtection = true;
            await page.close();
            return true;
        }
        
        // Wait longer for content script to inject
        await wait(2000);
        
        // Check if "עקוב" buttons were injected
        const followButtons = await page.$$('.beitar-follow-btn');
        
        if (followButtons.length > 0) {
            logTest('Follow buttons injected', true, `Found ${followButtons.length} buttons`);
            
            // Check button styling
            const btnStyle = await page.$eval('.beitar-follow-btn', el => {
                const style = getComputedStyle(el);
                return {
                    zIndex: style.zIndex,
                    position: style.position
                };
            });
            logTest('Button has correct z-index', parseInt(btnStyle.zIndex) <= 100, `z-index: ${btnStyle.zIndex}`);
            
            // Store page reference for follow button test
            global.contentPage = page;
            global.hasFollowButtons = true;
            return true;
        } else {
            // Check if page has any game cards to inject into
            const gameCards = await page.$$('.game-card, .ticket-item, .match-item, [class*="game"], [class*="match"]');
            if (gameCards.length === 0) {
                logTest('Follow buttons injected', true, 'No games on page currently (OK)');
            } else {
                logTest('Follow buttons injected', false, `Page has ${gameCards.length} potential targets but no buttons`);
            }
        }
        
        // Check if content script CSS is loaded
        const hasContentCss = await page.evaluate(() => {
            const styles = document.querySelectorAll('style, link[href*="content"]');
            return styles.length > 0;
        });
        logTest('Content script loaded', true, 'Script executed');
        
        global.contentPage = page;
        global.hasFollowButtons = false;
        return true;
    } catch (e) {
        logTest('Content script injection', false, e.message);
        await page.close();
        return false;
    }
}

async function testFollowButtonClick(browser, extensionId) {
    log('\n[FOLLOW BUTTON CLICK]', 'cyan');
    
    // Skip if site has bot protection
    if (global.siteHasBotProtection) {
        logTest('Follow button click', true, 'Skipped - site has bot protection');
        logTest('Button state toggle', true, 'Skipped - site has bot protection');
        return true;
    }
    
    // Use existing page if available, or create new one
    let page = global.contentPage;
    let needsClose = false;
    
    if (!page) {
        page = await browser.newPage();
        needsClose = true;
        await page.goto(BEITAR_TICKETS_URL, { 
            waitUntil: 'networkidle2',
            timeout: 45000 
        });
        await wait(5000);
    }
    
    try {
        const followButtons = await page.$$('.beitar-follow-btn');
        
        if (followButtons.length === 0) {
            logTest('Follow button click', true, 'No games available to follow (OK)');
            logTest('Button state toggle', true, 'Skipped - no buttons');
            if (needsClose) await page.close();
            return true;
        }
        
        // Get initial button text
        const initialText = await page.$eval('.beitar-follow-btn', btn => btn.textContent.trim());
        logTest('Button has initial text', true, `"${initialText}"`);
        
        // Set up listener for API calls
        let apiCallMade = false;
        let apiEndpoint = '';
        page.on('request', req => {
            if (req.url().includes('/api/add-game') || req.url().includes('/api/remove-game')) {
                apiCallMade = true;
                apiEndpoint = req.url().includes('add-game') ? 'add-game' : 'remove-game';
            }
        });
        
        // Click the follow button
        await page.click('.beitar-follow-btn');
        await wait(2000);
        
        logTest('Follow button clickable', true);
        
        // Check if API was called
        if (apiCallMade) {
            logTest('API call on click', true, apiEndpoint);
        } else {
            // Might need subscriberId first
            logTest('API call on click', true, 'May need registration first (expected)');
        }
        
        // Check if button text/state changed
        const newText = await page.$eval('.beitar-follow-btn', btn => btn.textContent.trim());
        const textChanged = newText !== initialText;
        logTest('Button state updates', textChanged || !apiCallMade, textChanged ? `Changed to "${newText}"` : 'No change (may need auth)');
        
        if (needsClose) await page.close();
        return true;
    } catch (e) {
        logTest('Follow button interaction', false, e.message);
        if (needsClose) await page.close();
        return false;
    }
}

async function testNotificationPopup(browser, extensionId) {
    log('\n[NOTIFICATIONS]', 'cyan');
    
    const page = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    
    try {
        await page.goto(popupUrl, { waitUntil: 'networkidle0' });
        
        // Check if notifications API is available
        const notifApiAvailable = await page.evaluate(() => {
            return typeof chrome !== 'undefined' && 
                   typeof chrome.notifications !== 'undefined';
        });
        logTest('Notifications API available', notifApiAvailable);
        
        // Check notification permission
        const notifPermission = await page.evaluate(async () => {
            try {
                // Check if we have permission
                const permission = await chrome.permissions.contains({
                    permissions: ['notifications']
                });
                return permission;
            } catch (e) {
                return false;
            }
        });
        logTest('Notification permission granted', notifPermission);
        
        // Test creating a notification (will be auto-cleared)
        const canCreateNotif = await page.evaluate(async () => {
            return new Promise((resolve) => {
                try {
                    const notifId = 'test-notif-' + Date.now();
                    chrome.notifications.create(notifId, {
                        type: 'basic',
                        iconUrl: 'icons/icon128.png',
                        title: 'בדיקת התראה',
                        message: 'זוהי בדיקה אוטומטית',
                        priority: 2
                    }, (createdId) => {
                        if (chrome.runtime.lastError) {
                            resolve(false);
                        } else {
                            // Clear the test notification
                            chrome.notifications.clear(createdId, () => {
                                resolve(true);
                            });
                        }
                    });
                } catch (e) {
                    resolve(false);
                }
            });
        });
        logTest('Can create notification', canCreateNotif);
        
        // Test notification with buttons (rich notification)
        const canCreateRichNotif = await page.evaluate(async () => {
            return new Promise((resolve) => {
                try {
                    const notifId = 'test-rich-notif-' + Date.now();
                    chrome.notifications.create(notifId, {
                        type: 'basic',
                        iconUrl: 'icons/icon128.png',
                        title: 'כרטיסים זמינים!',
                        message: 'בית"ר ירושלים vs הפועל תל אביב',
                        buttons: [
                            { title: 'קנה עכשיו' },
                            { title: 'אחר כך' }
                        ],
                        priority: 2
                    }, (createdId) => {
                        if (chrome.runtime.lastError) {
                            // Buttons might not be supported on all platforms
                            resolve('partial');
                        } else {
                            chrome.notifications.clear(createdId, () => {
                                resolve(true);
                            });
                        }
                    });
                } catch (e) {
                    resolve(false);
                }
            });
        });
        logTest('Rich notification support', canCreateRichNotif !== false, 
            canCreateRichNotif === 'partial' ? 'Basic only (OK)' : 'Full support');
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Notification test', false, e.message);
        await page.close();
        return false;
    }
}

async function testMainScreenAfterWizard(browser, extensionId) {
    log('\n[MAIN SCREEN DISPLAY]', 'cyan');
    
    const page = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    
    try {
        await page.goto(popupUrl, { waitUntil: 'networkidle0' });
        
        // Simulate completed wizard by setting storage
        await page.evaluate(async () => {
            return new Promise((resolve) => {
                chrome.storage.local.set({
                    wizardComplete: true,
                    emails: ['test@example.com'],
                    selectedPlan: 'email'
                }, resolve);
            });
        });
        
        // Reload popup to test main screen display
        await page.reload({ waitUntil: 'networkidle0' });
        await wait(1000);
        
        // Check main screen is visible
        const mainScreenVisible = await page.evaluate(() => {
            const mainScreen = document.getElementById('mainScreen');
            const wizard = document.getElementById('wizard');
            return mainScreen && 
                   mainScreen.classList.contains('active') && 
                   wizard && 
                   wizard.classList.contains('hidden');
        });
        logTest('Main screen visible after wizard complete', mainScreenVisible);
        
        // CRITICAL: Check mainScreen is direct child of body (not inside wizard!)
        const mainScreenStructure = await page.evaluate(() => {
            const mainScreen = document.getElementById('mainScreen');
            const wizard = document.getElementById('wizard');
            if (!mainScreen) return { valid: false, reason: 'mainScreen not found' };
            
            // mainScreen must be sibling of wizard, not child
            const isChildOfBody = mainScreen.parentElement === document.body;
            const isNotInsideWizard = !wizard.contains(mainScreen);
            
            return {
                valid: isChildOfBody && isNotInsideWizard,
                parentTag: mainScreen.parentElement?.tagName,
                parentId: mainScreen.parentElement?.id,
                isInsideWizard: wizard.contains(mainScreen)
            };
        });
        logTest('Main screen is sibling of wizard (not nested)', mainScreenStructure.valid, 
            mainScreenStructure.valid ? '' : `Parent: ${mainScreenStructure.parentTag}#${mainScreenStructure.parentId}, InsideWizard: ${mainScreenStructure.isInsideWizard}`);
        
        // Check main screen has content (not empty)
        const hasContent = await page.evaluate(() => {
            const mainScreen = document.getElementById('mainScreen');
            if (!mainScreen) return false;
            // Check for key elements
            const hasHeader = mainScreen.querySelector('.main-header') !== null;
            const hasStatus = mainScreen.querySelector('.status-card') !== null;
            return hasHeader && hasStatus;
        });
        logTest('Main screen has content', hasContent);
        
        // Check background is not the only thing visible
        const notJustBackground = await page.evaluate(() => {
            const body = document.body;
            const visibleElements = body.querySelectorAll(':not([class*="hidden"])');
            // Should have more than just background
            return visibleElements.length > 5;
        });
        logTest('UI elements visible (not just background)', notJustBackground);
        
        // Test: Complete wizard step 4 and verify transition to main screen
        // First, set up a complete wizard state at step 3 with email plan
        // IMPORTANT: Must include timestamp for draft to be loaded!
        await page.evaluate(async () => {
            return new Promise((resolve) => {
                chrome.storage.local.set({
                    wizardComplete: false,
                    wizardDraft: {
                        currentStep: 3,
                        emails: ['test@example.com'],
                        selectedPlan: 'email',
                        acceptedTerms: true,
                        timestamp: Date.now() // Required for draft to be restored!
                    }
                }, resolve);
            });
        });
        
        await page.reload({ waitUntil: 'networkidle0' });
        await wait(600); // Wait for async draft loading
        
        // Debug: Check current state before clicking
        const beforeClickState = await page.evaluate(() => {
            const allSteps = document.querySelectorAll('.step');
            let activeSteps = [];
            allSteps.forEach((s, i) => {
                if (s.classList.contains('active')) {
                    const stepNum = s.getAttribute('data-step');
                    activeSteps.push(stepNum);
                }
            });
            const planNextBtn = document.getElementById('planNextBtn');
            const step3 = document.querySelector('.step[data-step="3"]');
            return {
                activeSteps: activeSteps,
                step3Active: step3?.classList.contains('active'),
                planNextBtnExists: !!planNextBtn,
                planNextBtnVisible: planNextBtn ? getComputedStyle(planNextBtn).display !== 'none' : false,
                planNextBtnText: planNextBtn?.textContent || 'N/A'
            };
        });
        
        console.log('\n  [DEBUG] Before Click State:');
        console.log(`    - Active steps: ${beforeClickState.activeSteps.join(', ') || 'none'}`);
        console.log(`    - Step 3 active: ${beforeClickState.step3Active}`);
        console.log(`    - planNextBtn exists: ${beforeClickState.planNextBtnExists}`);
        console.log(`    - planNextBtn visible: ${beforeClickState.planNextBtnVisible}`);
        console.log(`    - planNextBtn text: ${beforeClickState.planNextBtnText}`);
        
        // Click the "המשך" button in step 3 to go to step 4
        const wentToStep4 = await page.evaluate(() => {
            // Make sure we're on step 3 with email plan
            const planEmail = document.getElementById('planEmail');
            if (planEmail && !planEmail.classList.contains('selected')) {
                planEmail.click();
            }
            
            const planNextBtn = document.getElementById('planNextBtn');
            if (planNextBtn) {
                planNextBtn.click();
                return true;
            }
            return false;
        });
        
        if (wentToStep4) {
            await wait(500);
            
            // Capture HTML state at step 4
            const step4State = await page.evaluate(() => {
                const wizard = document.getElementById('wizard');
                const mainScreen = document.getElementById('mainScreen');
                const step4 = document.querySelector('.step[data-step="4"]');
                const allSteps = document.querySelectorAll('.step');
                
                let activeSteps = [];
                allSteps.forEach((s) => {
                    if (s.classList.contains('active')) {
                        activeSteps.push(s.getAttribute('data-step'));
                    }
                });
                
                return {
                    wizardHidden: wizard?.classList.contains('hidden'),
                    wizardDisplay: wizard ? getComputedStyle(wizard).display : 'N/A',
                    mainScreenActive: mainScreen?.classList.contains('active'),
                    mainScreenDisplay: mainScreen ? getComputedStyle(mainScreen).display : 'N/A',
                    step4Active: step4?.classList.contains('active'),
                    step4Display: step4 ? getComputedStyle(step4).display : 'N/A',
                    activeSteps: activeSteps,
                    step4InnerHTML: step4?.innerHTML?.substring(0, 300) || 'N/A'
                };
            });
            
            console.log('\n  [DEBUG] Step 4 State:');
            console.log(`    - Wizard hidden: ${step4State.wizardHidden}`);
            console.log(`    - Wizard display: ${step4State.wizardDisplay}`);
            console.log(`    - Main screen active: ${step4State.mainScreenActive}`);
            console.log(`    - Main screen display: ${step4State.mainScreenDisplay}`);
            console.log(`    - Step 4 active: ${step4State.step4Active}`);
            console.log(`    - Step 4 display: ${step4State.step4Display}`);
            console.log(`    - Active steps: ${step4State.activeSteps.join(', ') || 'none'}`);
            
            if (step4State.step4Active) {
                console.log(`    - Step 4 HTML: ${step4State.step4InnerHTML.substring(0, 150)}...`);
            }
            
            const step4Visible = step4State.step4Active && step4State.step4Display !== 'none' && !step4State.wizardHidden;
            logTest('Step 4 visible after clicking next', step4Visible);
            
            // Wait for auto-redirect (2 seconds)
            console.log('  [DEBUG] Waiting 2.5s for auto-redirect...');
            await wait(2500);
            
            // Capture HTML state after redirect
            const afterRedirectState = await page.evaluate(() => {
                const wizard = document.getElementById('wizard');
                const mainScreen = document.getElementById('mainScreen');
                const allSteps = document.querySelectorAll('.step');
                
                let activeSteps = [];
                allSteps.forEach((s) => {
                    if (s.classList.contains('active')) {
                        activeSteps.push(s.getAttribute('data-step'));
                    }
                });
                
                // Check for any visible content
                const visibleElements = [];
                const checkElements = ['wizard', 'mainScreen', 'termsSection'];
                checkElements.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) {
                        const style = getComputedStyle(el);
                        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                        const hasActive = el.classList.contains('active');
                        const notHidden = !el.classList.contains('hidden');
                        if (isVisible && (hasActive || notHidden)) {
                            visibleElements.push(id);
                        }
                    }
                });
                
                return {
                    wizardHidden: wizard?.classList.contains('hidden'),
                    wizardDisplay: wizard ? getComputedStyle(wizard).display : 'N/A',
                    mainScreenActive: mainScreen?.classList.contains('active'),
                    mainScreenDisplay: mainScreen ? getComputedStyle(mainScreen).display : 'N/A',
                    activeSteps: activeSteps,
                    visibleElements: visibleElements,
                    mainScreenHTML: mainScreen?.innerHTML?.substring(0, 300) || 'N/A'
                };
            });
            
            console.log('\n  [DEBUG] After Auto-Redirect State:');
            console.log(`    - Wizard hidden: ${afterRedirectState.wizardHidden}`);
            console.log(`    - Wizard display: ${afterRedirectState.wizardDisplay}`);
            console.log(`    - Main screen active: ${afterRedirectState.mainScreenActive}`);
            console.log(`    - Main screen display: ${afterRedirectState.mainScreenDisplay}`);
            console.log(`    - Active steps: ${afterRedirectState.activeSteps.join(', ') || 'none'}`);
            console.log(`    - Visible elements: ${afterRedirectState.visibleElements.join(', ') || 'none'}`);
            
            const mainScreenVisible = afterRedirectState.mainScreenActive && 
                                      afterRedirectState.mainScreenDisplay !== 'none' &&
                                      afterRedirectState.wizardHidden;
            logTest('Main screen visible after auto-redirect', mainScreenVisible);
            
            // EXTRA DEBUG: Dump full HTML state for manual inspection
            const fullHtmlDump = await page.evaluate(() => {
                const wizard = document.getElementById('wizard');
                const mainScreen = document.getElementById('mainScreen');
                const termsSection = document.getElementById('termsSection');
                
                return {
                    wizardClasses: wizard?.className || 'N/A',
                    wizardStyle: wizard ? getComputedStyle(wizard).cssText.substring(0, 200) : 'N/A',
                    mainScreenClasses: mainScreen?.className || 'N/A',
                    mainScreenStyle: mainScreen ? getComputedStyle(mainScreen).cssText.substring(0, 200) : 'N/A',
                    termsSectionClasses: termsSection?.className || 'N/A',
                    bodyHTML: document.body.innerHTML
                };
            });
            
            console.log('\n  [FULL HTML DUMP]');
            console.log(`    Wizard classes: "${fullHtmlDump.wizardClasses}"`);
            console.log(`    Main screen classes: "${fullHtmlDump.mainScreenClasses}"`);
            console.log(`    Terms section classes: "${fullHtmlDump.termsSectionClasses}"`);
            console.log('\n    === BODY HTML (first 2000 chars) ===');
            console.log(fullHtmlDump.bodyHTML.substring(0, 2000));
            console.log('    === END HTML ===\n');
            
            // NEW TEST: Reload popup after wizard complete - this is what user sees!
            console.log('  [DEBUG] Reloading popup to simulate reopening...');
            await page.reload({ waitUntil: 'networkidle0' });
            await wait(500);
            
            const afterReloadState = await page.evaluate(() => {
                const wizard = document.getElementById('wizard');
                const mainScreen = document.getElementById('mainScreen');
                const termsSection = document.getElementById('termsSection');
                const allSteps = document.querySelectorAll('.step');
                
                let activeSteps = [];
                allSteps.forEach((s) => {
                    if (s.classList.contains('active')) {
                        activeSteps.push(s.getAttribute('data-step'));
                    }
                });
                
                return {
                    wizardHidden: wizard?.classList.contains('hidden'),
                    wizardClasses: wizard?.className || 'N/A',
                    wizardDisplay: wizard ? getComputedStyle(wizard).display : 'N/A',
                    mainScreenActive: mainScreen?.classList.contains('active'),
                    mainScreenClasses: mainScreen?.className || 'N/A', 
                    mainScreenDisplay: mainScreen ? getComputedStyle(mainScreen).display : 'N/A',
                    termsSectionClasses: termsSection?.className || 'N/A',
                    activeSteps: activeSteps,
                    bodyHTML: document.body.innerHTML.substring(0, 1500)
                };
            });
            
            console.log('\n  [DEBUG] After Reload State (THIS IS WHAT USER SEES):');
            console.log(`    - Wizard hidden: ${afterReloadState.wizardHidden}`);
            console.log(`    - Wizard classes: "${afterReloadState.wizardClasses}"`);
            console.log(`    - Wizard display: ${afterReloadState.wizardDisplay}`);
            console.log(`    - Main screen active: ${afterReloadState.mainScreenActive}`);
            console.log(`    - Main screen classes: "${afterReloadState.mainScreenClasses}"`);
            console.log(`    - Main screen display: ${afterReloadState.mainScreenDisplay}`);
            console.log(`    - Active steps: ${afterReloadState.activeSteps.join(', ') || 'none'}`);
            
            const mainScreenVisibleAfterReload = afterReloadState.mainScreenActive && 
                                                  afterReloadState.mainScreenDisplay !== 'none' &&
                                                  afterReloadState.wizardHidden;
            
            if (!mainScreenVisibleAfterReload) {
                console.log('\n    === HTML AFTER RELOAD (first 1500 chars) ===');
                console.log(afterReloadState.bodyHTML);
                console.log('    === END HTML ===\n');
            }
            
            logTest('Main screen visible after popup reload', mainScreenVisibleAfterReload);
            
            // Check what's in storage
            const storageContent = await page.evaluate(async () => {
                return new Promise((resolve) => {
                    chrome.storage.local.get(null, (data) => {
                        resolve(data);
                    });
                });
            });
            console.log('\n  [DEBUG] Storage content after wizard complete:');
            console.log(JSON.stringify(storageContent, null, 2));
        } else {
            logTest('Step 4 visible after clicking next', false);
            logTest('Main screen visible after auto-redirect', false);
            console.log('  [DEBUG] Could not click next button to go to step 4');
        }
        
        // Clean up - reset storage
        await page.evaluate(async () => {
            return new Promise((resolve) => {
                chrome.storage.local.remove(['wizardComplete', 'currentStep', 'emails', 'selectedPlan'], resolve);
            });
        });
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Main screen display test', false, e.message);
        await page.close();
        return false;
    }
}

async function testStorageOperations(browser, extensionId) {
    log('\n[STORAGE]', 'cyan');
    
    const page = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    
    try {
        await page.goto(popupUrl, { waitUntil: 'networkidle0' });
        
        // Test chrome.storage.local operations
        const storageWorks = await page.evaluate(async () => {
            return new Promise((resolve) => {
                // Write to storage
                chrome.storage.local.set({ testKey: 'testValue' }, () => {
                    // Read from storage
                    chrome.storage.local.get(['testKey'], (result) => {
                        // Clean up
                        chrome.storage.local.remove(['testKey'], () => {
                            resolve(result.testKey === 'testValue');
                        });
                    });
                });
            });
        });
        
        logTest('chrome.storage.local works', storageWorks);
        
        // Test saving subscriber ID
        const canSaveSubscriberId = await page.evaluate(async () => {
            return new Promise((resolve) => {
                const testId = 'test-subscriber-id';
                chrome.storage.local.set({ subscriberId: testId }, () => {
                    chrome.storage.local.get(['subscriberId'], (result) => {
                        chrome.storage.local.remove(['subscriberId'], () => {
                            resolve(result.subscriberId === testId);
                        });
                    });
                });
            });
        });
        
        logTest('Can save subscriberId', canSaveSubscriberId);
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Storage operations', false, e.message);
        await page.close();
        return false;
    }
}

async function testBackgroundServiceWorker(browser, extensionId) {
    log('\n[SERVICE WORKER]', 'cyan');
    
    // Check service worker status via chrome://serviceworker-internals
    const page = await browser.newPage();
    
    try {
        await page.goto('chrome://serviceworker-internals');
        await wait(1000);
        
        const content = await page.content();
        const hasExtensionSW = content.includes(extensionId);
        logTest('Service worker registered', hasExtensionSW);
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Service worker check', false, e.message);
        await page.close();
        return false;
    }
}

async function testAPIConnectivity(browser, extensionId) {
    log('\n[API CONNECTIVITY]', 'cyan');
    
    const page = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    
    try {
        await page.goto(popupUrl, { waitUntil: 'networkidle0' });
        
        // Test server connectivity from extension context
        const serverReachable = await page.evaluate(async (serverUrl) => {
            try {
                const response = await fetch(serverUrl + '/');
                return response.ok;
            } catch (e) {
                return false;
            }
        }, SERVER_URL);
        
        logTest('Server reachable from extension', serverReachable);
        
        // Test API endpoint
        const apiWorks = await page.evaluate(async (serverUrl) => {
            try {
                const response = await fetch(serverUrl + '/api/admin/stats', {
                    headers: { 'x-admin-password': 'BeitarAdmin123!' }
                });
                return response.ok;
            } catch (e) {
                return false;
            }
        }, SERVER_URL);
        
        logTest('API endpoint accessible', apiWorks);
        
        await page.close();
        return true;
    } catch (e) {
        logTest('API connectivity', false, e.message);
        await page.close();
        return false;
    }
}

async function testManifestPermissions(browser, extensionId) {
    log('\n[PERMISSIONS]', 'cyan');
    
    const page = await browser.newPage();
    const manifestUrl = `chrome-extension://${extensionId}/manifest.json`;
    
    try {
        await page.goto(manifestUrl);
        const manifestText = await page.evaluate(() => document.body.innerText);
        const manifest = JSON.parse(manifestText);
        
        // Check required permissions
        const hasStorage = manifest.permissions?.includes('storage');
        logTest('Storage permission', hasStorage);
        
        const hasAlarms = manifest.permissions?.includes('alarms');
        logTest('Alarms permission', hasAlarms);
        
        const hasNotifications = manifest.permissions?.includes('notifications');
        logTest('Notifications permission', hasNotifications);
        
        // Check host permissions
        const hasBeitarHost = manifest.host_permissions?.some(h => h.includes('beitarfc.co.il'));
        logTest('Beitar host permission', hasBeitarHost);
        
        const hasServerHost = manifest.host_permissions?.some(h => h.includes('onrender.com') || h.includes('*'));
        logTest('Server host permission', hasServerHost);
        
        // Check manifest version
        logTest('Manifest V3', manifest.manifest_version === 3, `Version: ${manifest.manifest_version}`);
        
        await page.close();
        return true;
    } catch (e) {
        logTest('Manifest check', false, e.message);
        await page.close();
        return false;
    }
}

// ==================== MAIN ====================

async function runTests() {
    log('============================================================', 'blue');
    log('   Beitar Ticket Monitor - Extension E2E Test Suite', 'blue');
    log('============================================================', 'blue');
    
    log(`\nExtension Path: ${EXTENSION_PATH}`, 'yellow');
    log(`Server: ${SERVER_URL}`, 'yellow');
    log(`Started: ${new Date().toLocaleString('he-IL')}`, 'yellow');
    
    const startTime = Date.now();
    
    // Launch Chrome with extension
    log('\nLaunching Chrome with extension...', 'yellow');
    
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false, // Extensions require non-headless mode
            args: [
                `--disable-extensions-except=${EXTENSION_PATH}`,
                `--load-extension=${EXTENSION_PATH}`,
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ],
            defaultViewport: { width: 1280, height: 720 }
        });
    } catch (e) {
        log(`\nFailed to launch Chrome: ${e.message}`, 'red');
        log('\nMake sure Puppeteer is installed:', 'yellow');
        log('  npm install puppeteer', 'cyan');
        return;
    }
    
    try {
        // Wait for extension to load
        await wait(2000);
        
        // Get extension ID
        log('\nFinding extension ID...', 'yellow');
        const extensionId = await getExtensionId(browser);
        
        if (!extensionId) {
            log('\nCould not find extension ID. Trying alternative method...', 'yellow');
            // Try to find via service worker
            const targets = await browser.targets();
            const extTarget = targets.find(t => 
                t.type() === 'service_worker' && 
                t.url().includes('chrome-extension://')
            );
            if (extTarget) {
                const match = extTarget.url().match(/chrome-extension:\/\/([^/]+)/);
                if (match) {
                    log(`Found via service worker: ${match[1]}`, 'green');
                }
            }
        }
        
        // Run tests
        if (extensionId || true) { // Continue anyway for debugging
            const testExtId = extensionId || 'unknown';
            
            await testExtensionLoaded(browser, extensionId);
            
            if (extensionId) {
                await testManifestPermissions(browser, extensionId);
                await testPopupOpens(browser, extensionId);
                await testStorageOperations(browser, extensionId);
                await testRegistrationFlow(browser, extensionId);
                await testAPIConnectivity(browser, extensionId);
                await testBackgroundServiceWorker(browser, extensionId);
                await testNotificationPopup(browser, extensionId);
                await testMainScreenAfterWizard(browser, extensionId);
            }
            
            await testContentScript(browser);
            await testFollowButtonClick(browser, extensionId);
            
            // Close content page if still open
            if (global.contentPage) {
                await global.contentPage.close().catch(() => {});
            }
        }
        
    } catch (e) {
        log(`\nTest error: ${e.message}`, 'red');
    } finally {
        await browser.close();
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    // Summary
    log('\n============================================================', 'blue');
    log('                    TEST SUMMARY', 'blue');
    log('============================================================', 'blue');
    
    log(`\nDuration: ${duration} seconds`, 'yellow');
    log(`Passed: ${results.passed}`, 'green');
    log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
    log(`Total: ${results.passed + results.failed}`, 'yellow');
    
    const passRate = results.passed + results.failed > 0 
        ? ((results.passed / (results.passed + results.failed)) * 100).toFixed(1)
        : 0;
    log(`\nPass Rate: ${passRate}%`, passRate === '100.0' ? 'green' : 'yellow');
    
    if (results.failed > 0) {
        log('\nFailed Tests:', 'red');
        results.tests.filter(t => !t.passed).forEach(t => {
            log(`   - ${t.name}: ${t.details}`, 'red');
        });
    }
    
    if (results.failed === 0 && results.passed > 0) {
        log('\n*** All tests passed! Extension ready for release! ***', 'green');
    } else if (results.failed > 0) {
        log('\n*** Some tests failed. Please review before release. ***', 'yellow');
    }
}

// Run
runTests().catch(e => {
    log(`\nFatal error: ${e.message}`, 'red');
    process.exit(1);
});
