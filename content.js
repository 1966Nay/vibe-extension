(function () {
  function notifyBackground() {
    chrome.runtime.sendMessage({ type: 'URL_CHANGED', url: location.href }).catch(() => {});
  }

  let lastUrl = location.href;
  notifyBackground();

  // Catch browser back/forward
  window.addEventListener('popstate', notifyBackground);

  // Catch SPA pushState navigation by watching DOM mutations
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      notifyBackground();
    }
  });

  const target = document.body || document.documentElement;
  observer.observe(target, { childList: true, subtree: true });
})();
