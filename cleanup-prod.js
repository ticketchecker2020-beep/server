// Cleanup script - delete junk subscribers and licenses
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const PROXY = 'http://proxy-iil.intel.com:912';
const SERVER = 'server-tickets-l0rq.onrender.com';
const PASSWORD = 'BeitarAdmin123!';

const agent = new HttpsProxyAgent(PROXY);

const junkSubscribers = [
    'test-register-check@example.com',
    'test@example.com',
    'web-1769351716543-58daynkad',
    'web-1769503975008-6x6nv6xmv',
    'web-1769504590986-f5hl5lp1g',
    'web-1769505531821-lzc1gyrcl',
    'web-1769506003051-3uc5lhrpm',
    'web-1769527240492-ut6251o5o'
];

const junkLicenses = [
    'BEITAR-VXMH-OGLO-NNWQ-SJ6H'
];

async function apiCall(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const options = {
            hostname: SERVER,
            path: path,
            method: 'POST',
            agent: agent,
            headers: { 
                'Content-Type': 'application/json', 
                'Content-Length': Buffer.byteLength(data) 
            }
        };
        const req = https.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: responseBody }));
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function main() {
    console.log('🧹 Cleaning up production data...\n');
    
    // Delete junk subscribers
    console.log('=== Deleting Junk Subscribers ===');
    for (const id of junkSubscribers) {
        try {
            const result = await apiCall('/api/admin/delete-subscriber', { adminPassword: PASSWORD, subscriberId: id });
            console.log(result.status === 200 ? '✅ Deleted:' : '❌ Failed:', id, result.body);
        } catch (err) {
            console.log('❌ Error:', id, err.message);
        }
    }
    
    // Reset stats (clears history)
    console.log('\n=== Resetting Stats ===');
    try {
        const result = await apiCall('/api/admin/reset-stats', { adminPassword: PASSWORD });
        console.log(result.status === 200 ? '✅ Stats reset' : '❌ Failed to reset stats', result.body);
    } catch (err) {
        console.log('❌ Error resetting stats:', err.message);
    }
    
    console.log('\n🎉 Cleanup complete!');
    console.log('\nRemaining real users:');
    console.log('  - gavriel.sade@gmail.com (VIP + SMS)');
    console.log('  - mcnmalka@gmail.com (VIP + SMS)');
    console.log('  - liam.nesimyan@gmail.com (Email only)');
}

main().catch(console.error);
