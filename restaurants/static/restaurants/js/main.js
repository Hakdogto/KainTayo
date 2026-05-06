const nav = document.getElementById("mainNav");
const hamburgerBtn = document.getElementById("hamburgerBtn");
const pwaInstallBar = document.getElementById("pwaInstallBar");
const pwaInstallBtn = document.getElementById("pwaInstallBtn");

let deferredInstallPrompt = null;

function isMobileOrTablet() {
  return window.matchMedia("(max-width: 980px)").matches;
}

function isIosSafari() {
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);
  return isIos && isSafari;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function toggleInstallBar() {
  if (!pwaInstallBar) return;
  const canUseNativePrompt = Boolean(deferredInstallPrompt);
  const canUseIosFallback = isIosSafari();
  const shouldShow = Boolean((canUseNativePrompt || canUseIosFallback) && isMobileOrTablet() && !isStandalone());
  pwaInstallBar.hidden = !shouldShow;

  if (pwaInstallBtn) {
    pwaInstallBtn.textContent = canUseNativePrompt ? "Download App" : "Add to Home Screen";
  }

  document.body.classList.toggle("has-pwa-install-bar", shouldShow);
}

if (hamburgerBtn && nav) {
  hamburgerBtn.addEventListener("click", () => {
    nav.classList.toggle("open");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  toggleInstallBar();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  toggleInstallBar();
});

if (pwaInstallBtn) {
  pwaInstallBtn.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      toggleInstallBar();
      return;
    }

    if (isIosSafari() && !isStandalone()) {
      window.alert("To install this app on iPhone/iPad:\n1) Tap the Share button\n2) Select 'Add to Home Screen'\n3) Tap Add");
    }

    toggleInstallBar();
  });
}

window.addEventListener("resize", toggleInstallBar);
window.addEventListener("load", toggleInstallBar);

window.pushAssistantInsights = () => {};
