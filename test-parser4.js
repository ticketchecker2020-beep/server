const fs = require('fs');

const html = fs.readFileSync('C:/Users/nadavma/Downloads/cards_games/site with games.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

if (match) {
  const data = JSON.parse(match[1]);
  
  // Check initialState.pageData structure
  const pageData = data.props?.pageProps?.initialState?.pageData;
  
  console.log('pageData keys:', Object.keys(pageData || {}));
  
  if (pageData?.team) {
    console.log('team keys:', Object.keys(pageData.team));
  }
  
  // Check if upcoming_matches is directly in pageData
  if (pageData?.upcoming_matches) {
    console.log('\nDirect upcoming_matches:');
    console.log('Title:', pageData.upcoming_matches.title);
    console.log('Count:', pageData.upcoming_matches.matches?.length);
  }
  
  // Let's look for "matches" array anywhere in pageData
  const findArrays = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj) && obj.length > 0 && obj[0]?.event_id) {
      console.log(`\nFOUND matches array at: ${path} (${obj.length} items)`);
      console.log('First item name:', obj[0].name);
    }
    
    if (!Array.isArray(obj)) {
      for (const key of Object.keys(obj)) {
        findArrays(obj[key], `${path}.${key}`);
      }
    }
  };
  
  findArrays(pageData, 'pageData');
  
} else {
  console.log('No __NEXT_DATA__ found');
}
