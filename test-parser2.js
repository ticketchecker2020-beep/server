const fs = require('fs');

const html = fs.readFileSync('C:/Users/nadavma/Downloads/cards_games/site with games.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);

if (match) {
  const data = JSON.parse(match[1]);
  
  console.log('Top keys:', Object.keys(data));
  console.log('props keys:', Object.keys(data.props || {}));
  console.log('pageProps keys:', Object.keys(data.props?.pageProps || {}));
  
  // Check all possible paths
  const pageProps = data.props?.pageProps;
  if (pageProps) {
    for (const key of Object.keys(pageProps)) {
      const val = pageProps[key];
      if (val && typeof val === 'object') {
        console.log(`pageProps.${key} keys:`, Object.keys(val).slice(0, 10));
      }
    }
  }
  
  // Look for upcoming_matches in nested objects
  const findMatches = (obj, path = '') => {
    if (!obj || typeof obj !== 'object') return;
    if (obj.upcoming_matches) {
      console.log(`\nFOUND upcoming_matches at: ${path}`);
      console.log('Title:', obj.upcoming_matches.title);
      console.log('Matches count:', obj.upcoming_matches.matches?.length);
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
        findMatches(obj[key], `${path}.${key}`);
      }
    }
  };
  
  findMatches(data, 'data');
  
} else {
  console.log('No __NEXT_DATA__ found');
}
