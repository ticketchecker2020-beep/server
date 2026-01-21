// Onboarding page script

const BEITAR_SITE = 'https://www.beitarfc.co.il/%D7%9E%D7%A9%D7%97%D7%A7%D7%99%D7%9D/';

// Force GIF to loop by reloading it
const gif = document.getElementById('pinGif');
if (gif) {
  const gifSrc = gif.src;
  
  // Reload GIF every 9 seconds (adjust based on your GIF length)
  setInterval(() => {
    gif.src = '';
    gif.src = gifSrc + '?t=' + Date.now();
  }, 9000);
}

// Close button handler - go to Beitar site
document.getElementById('closeBtn').addEventListener('click', () => {
  // Open Beitar tickets page in new tab
  chrome.tabs.create({ url: BEITAR_SITE });
  window.close();
});
