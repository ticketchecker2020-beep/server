/**
 * Debug script to understand why main screen doesn't show after step 4
 */

const puppeteer = require('puppeteer');
const path = require('path');

const EXTENSION_PATH = __dirname;

async function debugStep4() {
    console.log('=== DEBUG: Step 4 to Main Screen Transition ===\n');
    
    const browser = await puppeteer.launch({
        headless: false, // Show browser!
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox'
        ],
        slowMo: 100 // Slow down so we can see what happens
    });
    
    // Get extension ID - try multiple methods
    const extPage = await browser.newPage();
    await extPage.goto('chrome://extensions');
    await new Promise(r => setTimeout(r, 2000));
    
    let extensionId = await extPage.evaluate(() => {
        const manager = document.querySelector('extensions-manager');
        if (manager && manager.shadowRoot) {
            const itemList = manager.shadowRoot.querySelector('extensions-item-list');
            if (itemList && itemList.shadowRoot) {
                const items = itemList.shadowRoot.querySelectorAll('extensions-item');
                for (const item of items) {
                    if (item.shadowRoot) {
                        const name = item.shadowRoot.querySelector('#name');
                        if (name && (name.textContent.includes('בית') || name.textContent.includes('Beitar') || name.textContent.includes('Ticket'))) {
                            return item.id;
                        }
                    }
                }
            }
        }
        return null;
    });
    
    // Fallback: try to find any loaded extension
    if (!extensionId) {
        const targets = await browser.targets();
        for (const target of targets) {
            const url = target.url();
            if (url.includes('chrome-extension://') && !url.includes('pec')) {
                const match = url.match(/chrome-extension:\/\/([^/]+)/);
                if (match) {
                    extensionId = match[1];
                    break;
                }
            }
        }
    }
    
    await extPage.close();
    
    console.log(`Extension ID: ${extensionId}\n`);
    
    // Open popup
    const page = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    
    // Collect JS errors
    const errors = [];
    page.on('console', msg => {
        const text = msg.text();
        console.log(`[CONSOLE ${msg.type()}] ${text}`);
        if (msg.type() === 'error') errors.push(text);
    });
    page.on('pageerror', err => {
        console.log(`[PAGE ERROR] ${err.message}`);
        errors.push(err.message);
    });
    
    console.log('1. Loading popup with step 3 draft...\n');
    
    await page.goto(popupUrl, { waitUntil: 'networkidle0' });
    
    // Set up draft at step 3
    await page.evaluate(async () => {
        return new Promise((resolve) => {
            chrome.storage.local.set({
                wizardComplete: false,
                wizardDraft: {
                    currentStep: 3,
                    emails: ['test@example.com'],
                    selectedPlan: 'email',
                    acceptedTerms: true,
                    timestamp: Date.now()
                }
            }, resolve);
        });
    });
    
    console.log('2. Reloading to load draft...\n');
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));
    
    // Print current state
    await printState(page, 'After loading draft');
    
    console.log('\n3. Clicking "המשך" to go to step 4...\n');
    
    // Click next
    await page.evaluate(() => {
        const btn = document.getElementById('planNextBtn');
        if (btn) btn.click();
    });
    
    await new Promise(r => setTimeout(r, 500));
    await printState(page, 'After clicking next (should be step 4)');
    
    console.log('\n4. Waiting 3 seconds for auto-redirect...\n');
    await new Promise(r => setTimeout(r, 3000));
    
    await printState(page, 'After auto-redirect (should be main screen)');
    
    if (errors.length > 0) {
        console.log('\n=== JAVASCRIPT ERRORS ===');
        errors.forEach(e => console.log(`  - ${e}`));
    }
    
    console.log('\n=== Press Ctrl+C to close ===');
    
    // Keep browser open for manual inspection
    await new Promise(() => {});
}

async function printState(page, label) {
    const state = await page.evaluate(() => {
        const wizard = document.getElementById('wizard');
        const mainScreen = document.getElementById('mainScreen');
        
        const allSteps = document.querySelectorAll('.step');
        let activeSteps = [];
        allSteps.forEach(s => {
            if (s.classList.contains('active')) {
                activeSteps.push(s.getAttribute('data-step'));
            }
        });
        
        // Check computed styles
        const wizardStyle = wizard ? getComputedStyle(wizard) : null;
        const mainStyle = mainScreen ? getComputedStyle(mainScreen) : null;
        
        return {
            wizard: {
                classes: wizard?.className || 'N/A',
                display: wizardStyle?.display || 'N/A',
                visibility: wizardStyle?.visibility || 'N/A',
                opacity: wizardStyle?.opacity || 'N/A',
                height: wizardStyle?.height || 'N/A'
            },
            mainScreen: {
                classes: mainScreen?.className || 'N/A',
                display: mainStyle?.display || 'N/A',
                visibility: mainStyle?.visibility || 'N/A',
                opacity: mainStyle?.opacity || 'N/A',
                height: mainStyle?.height || 'N/A',
                innerHTML: mainScreen?.innerHTML?.substring(0, 500) || 'N/A'
            },
            activeSteps: activeSteps,
            visibleText: document.body.innerText.substring(0, 300)
        };
    });
    
    console.log(`=== ${label} ===`);
    console.log(`  Wizard: classes="${state.wizard.classes}"`);
    console.log(`          display=${state.wizard.display}, visibility=${state.wizard.visibility}`);
    console.log(`  Main:   classes="${state.mainScreen.classes}"`);
    console.log(`          display=${state.mainScreen.display}, visibility=${state.mainScreen.visibility}`);
    console.log(`          height=${state.mainScreen.height}`);
    console.log(`  Active steps: ${state.activeSteps.join(', ') || 'none'}`);
    console.log(`  Visible text: "${state.visibleText.replace(/\n/g, ' ').substring(0, 100)}..."`);
    
    // Check parent elements and popup size
    const moreInfo = await page.evaluate(() => {
        const body = document.body;
        
        // Get all direct children of body
        const bodyChildren = [];
        for (const child of body.children) {
            const style = getComputedStyle(child);
            bodyChildren.push({
                tag: child.tagName,
                id: child.id || 'no-id',
                class: child.className,
                display: style.display
            });
        }
        
        // Also check if mainScreen exists at all
        const mainScreen = document.getElementById('mainScreen');
        const mainScreenInfo = mainScreen ? {
            exists: true,
            parentId: mainScreen.parentElement?.id || 'no-id',
            parentTag: mainScreen.parentElement?.tagName,
            parentClass: mainScreen.parentElement?.className
        } : { exists: false };
        
        return {
            bodyChildren: bodyChildren,
            totalChildren: body.children.length,
            mainScreenInfo: mainScreenInfo
        };
    });
    
    console.log(`\n  Body children (${moreInfo.totalChildren} total):`);
    for (const child of moreInfo.bodyChildren) {
        console.log(`    - ${child.tag}#${child.id}.${child.class}: display=${child.display}`);
    }
    console.log(`  MainScreen: exists=${moreInfo.mainScreenInfo.exists}, parent=${moreInfo.mainScreenInfo.parentTag}#${moreInfo.mainScreenInfo.parentId}.${moreInfo.mainScreenInfo.parentClass}`);
}

debugStep4().catch(console.error);
