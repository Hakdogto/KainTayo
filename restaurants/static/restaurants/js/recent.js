const historyList = document.getElementById("historyList");

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

async function deleteHistoryItem(historyId) {
  const response = await fetch(`/api/history/${historyId}/`, {
    method: "DELETE",
    headers: {
      "X-CSRFToken": getCookie("csrftoken")
    }
  });
  if (!response.ok) {
    alert("Unable to delete this search item right now.");
    return false;
  }
  return true;
}

async function fetchHistory() {
  const response = await fetch("/api/history/");
  const data = await response.json();

  historyList.innerHTML = "";
  if (!data.length) {
    historyList.innerHTML = '<p class="empty-state">No searches yet.</p>';
    return;
  }

  data.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "result-item clickable";
    card.innerHTML = `
      <h3>${entry.raw_query}</h3>
      <p>${new Date(entry.searched_at).toLocaleString()}</p>
      <div class="actions">
        <span></span>
        <div class="action-group">
          <button class="delete-history-btn" data-id="${entry.id}">Delete</button>
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      window.location.href = `/search/?q=${encodeURIComponent(entry.raw_query || "")}`;
    });
    const deleteBtn = card.querySelector(".delete-history-btn");
    deleteBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await deleteHistoryItem(entry.id);
      if (ok) {
        await fetchHistory();
      }
      animateActionButton(deleteBtn, ok ? "success" : "error");
    });
    historyList.appendChild(card);
  });
}

fetchHistory();
