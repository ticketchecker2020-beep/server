// Onboarding page script

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

// Close button handler
document.getElementById('closeBtn').addEventListener('click', () => {
  window.close();
});
