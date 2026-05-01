const nav = document.getElementById("mainNav");
const hamburgerBtn = document.getElementById("hamburgerBtn");

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

window.pushAssistantInsights = () => {};
