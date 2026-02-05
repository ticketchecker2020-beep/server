const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');
const agent = new HttpsProxyAgent('http://proxy-iil.intel.com:912');

function test(path, name) {
    return new Promise((resolve) => {
        https.get({
            hostname: 'server-tickets-l0rq.onrender.com',
            path: path,
            agent: agent
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`\n=== ${name} ===`);
                try {
                    const p = JSON.parse(data);
                    console.log(JSON.stringify(p, null, 2));
                    resolve(p);
                } catch {
                    console.log(data);
                    resolve(null);
                }
            });
        }).on('error', (e) => {
            console.log(`Error: ${e.message}`);
            resolve(null);
        });
    });
}

async function main() {
    console.log('🔍 Testing production...\n');
    
    // Test 1: Gavriel subscription status
    const gavriel = await test('/api/subscription-status?email=gavriel.sade@gmail.com', 'Gavriel Status');
    console.log(gavriel?.registered && gavriel?.isVip ? '✅ PASS: Gavriel is VIP' : '❌ FAIL');
    
    // Test 2: Health check
    const health = await test('/api/health', 'Health Check');
    console.log(health?.status === 'ok' ? '✅ PASS: Server healthy' : '❌ FAIL');
    
    // Test 3: mcnmalka status
    const mcn = await test('/api/subscription-status?email=mcnmalka@gmail.com', 'mcnmalka Status');
    console.log(mcn?.registered ? '✅ PASS: mcnmalka found' : '❌ FAIL');
    
    console.log('\n🏁 Done!');
}

main();
