const fs = require('fs');

// Test parsing Beitar official website
const html = fs.readFileSync('C:/Users/nadavma/Downloads/cards_games/beitar-official.html', 'utf8');

// Parse games from official Beitar FC website (beitarfc.co.il)
function parseGamesFromBeitarOfficial(html) {
  const games = [];
  
  try {
    // Parse all games using simple pattern
    const simplePattern = /<div class="teams_names[\s\S]*?<div class="home">\s*([^<]+)\s*<\/div>\s*<div class="away">\s*([^<]+)\s*<\/div>[\s\S]*?<div class="stadium">\s*([^<]+)\s*<\/div>\s*<div class="date">\s*([^<]+)\s*<\/div>/gi;
    
    let match;
    while ((match = simplePattern.exec(html)) !== null) {
      const homeTeam = match[1].trim();
      const awayTeam = match[2].trim();
      const stadium = match[3].trim();
      const dateStr = match[4].trim();
      
      const gameName = `${homeTeam} - ${awayTeam}`;
      const eventDate = parseBeitarDate(dateStr);
      const isHomeGame = homeTeam.includes('בית"ר') || homeTeam.includes('ביתר');
      
      // Skip duplicates
      if (games.some(g => g.name === gameName && g.eventDate === eventDate)) {
        continue;
      }
      
      games.push({
        id: `beitar-official-${eventDate}-${games.length}`,
        name: gameName,
        eventDate,
        eventTime: extractTimeFromDate(dateStr),
        venue: stadium,
        available: true,
        soldOut: false,
        isHomeGame
      });
    }
    
    console.log(`Parsed ${games.length} games from Beitar official website\n`);
    
  } catch (error) {
    console.error('Error parsing Beitar official website:', error.message);
  }
  
  return games;
}

// Helper: Parse date from "01/02/26 -> 01:59" format
function parseBeitarDate(dateStr) {
  try {
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{2})/);
    if (match) {
      const day = match[1];
      const month = match[2];
      const year = `20${match[3]}`;
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  return null;
}

// Helper: Extract time from date string
function extractTimeFromDate(dateStr) {
  try {
    const match = dateStr.match(/(\d{2}:\d{2})/);
    return match ? match[1] : null;
  } catch (e) {}
  return null;
}

const games = parseGamesFromBeitarOfficial(html);
console.log('=== GAMES ===');
for (const g of games) {
  console.log(`${g.name}`);
  console.log(`  Date: ${g.eventDate} ${g.eventTime || ''}`);
  console.log(`  Venue: ${g.venue}`);
  console.log(`  Home Game: ${g.isHomeGame}`);
  console.log('');
}
