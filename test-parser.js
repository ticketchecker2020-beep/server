const fs = require('fs');

const html = fs.readFileSync('../../site with games.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

if (match) {
  const data = JSON.parse(match[1]);
  const pageData = data?.props?.pageProps?.pageData;
  
  console.log('Keys in pageData:', Object.keys(pageData || {}));
  
  const team = pageData?.team;
  console.log('Keys in team:', Object.keys(team || {}));
  
  const upcoming = team?.upcoming_matches;
  console.log('upcoming_matches title:', upcoming?.title);
  console.log('matches count:', upcoming?.matches?.length);
  
  if (upcoming?.matches) {
    console.log('\n=== MATCHES ===');
    for (const m of upcoming.matches) {
      console.log(`- ${m.name} | ${new Date(m.event_start * 1000).toLocaleString('he-IL')} | soldout: ${m.is_soldout}`);
    }
  }
} else {
  console.log('No __NEXT_DATA__ found');
}
