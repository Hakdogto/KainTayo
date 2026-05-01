const favoritesList = document.getElementById("favoritesList");

function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split(";") : [];
  for (let index = 0; index < cookies.length; index += 1) {
    const cookie = cookies[index].trim();
    if (cookie.startsWith(`${name}=`)) {
      return decodeURIComponent(cookie.slice(name.length + 1));
    }
  }
  return "";
}

function animateActionButton(button, state = "success") {
  if (!button) return;
  button.classList.remove("action-feedback-success", "action-feedback-error");
  void button.offsetWidth;
  button.classList.add(state === "error" ? "action-feedback-error" : "action-feedback-success");
}

async function deleteFavoriteItem(favoriteId, favoriteType) {
  const response = await fetch(`/api/favorites/${encodeURIComponent(favoriteType)}/${favoriteId}/`, {
    method: "DELETE",
    headers: {
      "X-CSRFToken": getCookie("csrftoken")
    }
  });
  if (!response.ok) {
    alert("Unable to delete this favorite right now.");
    return false;
  }
  return true;
}

async function fetchFavorites() {
  const response = await fetch("/api/favorites/");
  const data = await response.json();

  favoritesList.innerHTML = "";
  if (!data.length) {
    favoritesList.innerHTML = '<p class="empty-state">No favorites yet.</p>';
    return;
  }

  data.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "result-item clickable";
    card.innerHTML = `
      <h3>${entry.name}</h3>
      <p>${entry.cuisine || "restaurant"}</p>
      <div class="actions">
        <span></span>
        <div class="action-group">
          <button class="delete-favorite-btn" data-id="${entry.id}" data-type="${entry.type}">Delete</button>
        </div>
      </div>
    `;
    if (entry.detail_url) {
      card.addEventListener("click", () => {
        window.location.href = entry.detail_url;
      });
    }
    const deleteFavoriteBtn = card.querySelector(".delete-favorite-btn");
    if (deleteFavoriteBtn) {
      deleteFavoriteBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ok = await deleteFavoriteItem(entry.id, entry.type);
        if (ok) {
          await fetchFavorites();
        }
        animateActionButton(deleteFavoriteBtn, ok ? "success" : "error");
      });
    }
    favoritesList.appendChild(card);
  });
}

fetchFavorites();
