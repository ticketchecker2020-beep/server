const fs = require('fs');

// Copy the parseTicketsFromHtml logic to test
const html = fs.readFileSync('C:/Users/nadavma/Downloads/cards_games/site with games.html', 'utf8');

const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

if (nextDataMatch) {
  const jsonData = JSON.parse(nextDataMatch[1]);
  const pageData = jsonData?.props?.pageProps?.initialState?.pageData 
                || jsonData?.props?.pageProps?.pageData;
  
  if (pageData) {
    let matches = [];
    
    if (pageData.upcoming_matches?.matches && Array.isArray(pageData.upcoming_matches.matches)) {
      matches = pageData.upcoming_matches.matches;
      console.log(`Found ${matches.length} matches in upcoming_matches.matches`);
    } else if (pageData.team?.upcoming_matches?.matches) {
      matches = pageData.team.upcoming_matches.matches;
      console.log(`Found ${matches.length} matches in team.upcoming_matches.matches`);
    }
    
    console.log('\n=== PARSED GAMES ===');
    for (const match of matches) {
      const eventId = match.event_id || match.id || String(match.event_start);
      const isSoldOut = match.is_soldout === true;
      
      let gameName = match.name || match.event_name || '';
      
      let eventDate = null;
      let eventTime = null;
      if (match.event_start) {
        const date = new Date(match.event_start * 1000);
        eventDate = date.toISOString().split('T')[0];
        eventTime = date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      }
      
      const venue = match.location?.name || 'אצטדיון טדי';
      
      console.log(`\n${gameName}`);
      console.log(`  Date: ${eventDate} ${eventTime}`);
      console.log(`  Venue: ${venue}`);
      console.log(`  Sold Out: ${isSoldOut}`);
      console.log(`  Price: ${match.starting_price}`);
      console.log(`  Event ID: ${eventId}`);
    }
  }
}
