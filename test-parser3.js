const fs = require('fs');

const html = fs.readFileSync('C:/Users/nadavma/Downloads/cards_games/site with games.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

if (match) {
  const data = JSON.parse(match[1]);
  
  // Correct path: initialState.pageData
  const pageData = data.props?.pageProps?.initialState?.pageData;
  const team = pageData?.team;
  const upcoming = team?.upcoming_matches;
  
  console.log('Team name:', team?.name);
  console.log('upcoming_matches title:', upcoming?.title);
  console.log('Matches count:', upcoming?.matches?.length);
  
  if (upcoming?.matches) {
    console.log('\n=== MATCHES ===');
    for (const m of upcoming.matches) {
      const date = new Date(m.event_start * 1000);
      console.log(`\n- Name: ${m.name}`);
      console.log(`  Event Name: ${m.event_name}`);
      console.log(`  Date: ${date.toLocaleDateString('he-IL')} ${date.toLocaleTimeString('he-IL')}`);
      console.log(`  Location: ${m.location?.name}`);
      console.log(`  Sold Out: ${m.is_soldout}`);
      console.log(`  Starting Price: ${m.starting_price}`);
      console.log(`  Event ID: ${m.event_id}`);
    }
  }
  
} else {
  console.log('No __NEXT_DATA__ found');
}
