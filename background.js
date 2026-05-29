// Generates an ImageData icon using OffscreenCanvas.
// active = purple (#7C3AED), inactive = slate (#64748B)
function makeIconData(size, active) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  // Rounded square background
  const r = size * 0.18;
  ctx.fillStyle = active ? '#7C3AED' : '#64748B';
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // White "V" chevron
  const pad = size * 0.22;
  const top = size * 0.28;
  const bot = size * 0.72;
  const mid = size / 2;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = size * 0.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pad, top);
  ctx.lineTo(mid, bot);
  ctx.lineTo(size - pad, top);
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

function buildImageData(active) {
  const result = {};
  for (const size of [16, 32, 48, 128]) {
    result[size] = makeIconData(size, active);
  }
  return result;
}

function isCodeEditorUrl(url) {
  return typeof url === 'string' && url.includes('view=codeEditor');
}

async function updateIconForTab(tabId, url) {
  try {
    const active = isCodeEditorUrl(url);
    await chrome.action.setIcon({ tabId, imageData: buildImageData(active) });
    await chrome.action.setTitle({
      tabId,
      title: active
        ? 'VibeEscape Extractor — Click to extract & download files'
        : 'VibeEscape Extractor — Open GHL AI Studio code editor first'
    });
  } catch {
    // Tab may have been closed or navigated away
  }
}

// Tab URL changes (covers regular navigation and some SPA pushState)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url !== undefined || changeInfo.status === 'complete') {
    updateIconForTab(tabId, tab.url);
  }
});

// Switching between tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    updateIconForTab(tabId, tab.url);
  } catch {}
});

// SPA URL changes detected by content.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'URL_CHANGED' && sender.tab?.id) {
    updateIconForTab(sender.tab.id, msg.url);
  }
});

// Initialise icons for all already-open tabs when the service worker wakes
chrome.tabs.query({}, (tabs) => {
  for (const tab of tabs) {
    if (tab.id) updateIconForTab(tab.id, tab.url);
  }
});
