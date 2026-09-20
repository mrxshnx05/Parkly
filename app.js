const spaces = [
  { id: 1, title: "Regal Parking Bay", area: "0.2 km · Connaught Place", rate: "₹60", tag: "COVERED", rating: "4.9 (128)", photo: "photo-one", filters: ["covered", "secure"] },
  { id: 2, title: "Central Plaza Space", area: "0.4 km · Block B", rate: "₹45", tag: "EV CHARGING", rating: "4.8 (86)", photo: "photo-two", filters: ["ev", "secure"] },
  { id: 3, title: "Janpath Private Lot", area: "0.6 km · Janpath Road", rate: "₹50", tag: "24/7 SECURITY", rating: "5.0 (42)", photo: "photo-three", filters: ["secure"] }
];

const grid = document.getElementById("parkingGrid");
const modalBackdrop = document.getElementById("modalBackdrop");
const modalTitle = document.getElementById("modalTitle");
const modalText = document.getElementById("modalText");
const modalEyebrow = document.getElementById("modalEyebrow");
const modalIcon = document.getElementById("modalIcon");
const toast = document.getElementById("toast");

function renderSpaces(filter = "all") {
  const visible = filter === "all" ? spaces : spaces.filter((space) => space.filters.includes(filter));
  grid.innerHTML = visible.map((space, index) => `
    <article class="space-card" style="animation-delay:${index * 80}ms">
      <div class="space-photo ${space.photo}">
        <span class="photo-tag">${space.tag}</span>
        <button class="heart" data-heart="${space.id}" aria-label="Save ${space.title}">♡</button>
      </div>
      <div class="space-info">
        <div class="space-title-row"><h3>${space.title}</h3><p>${space.rate}<small>/hr</small></p></div>
        <p class="space-meta">${space.area}</p>
        <div class="space-bottom"><span class="rating"><b>★</b>${space.rating}</span><button class="book-mini" data-book="${space.id}">Book now</button></div>
      </div>
    </article>`).join("");
}

function showModal({ eyebrow = "Ready when you are", title, text, icon = "✓", action = "Done" }) {
  modalEyebrow.innerHTML = `<span></span> ${eyebrow}`;
  modalTitle.innerHTML = title;
  modalText.textContent = text;
  modalIcon.textContent = icon;
  document.getElementById("modalAction").innerHTML = `${action} <span>→</span>`;
  modalBackdrop.classList.add("open");
  modalBackdrop.setAttribute("aria-hidden", "false");
}
function closeModal() { modalBackdrop.classList.remove("open"); modalBackdrop.setAttribute("aria-hidden", "true"); }
function showToast(message) { toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 2600); }

renderSpaces();

document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
  if (button.id === "filterMore") { showToast("More filters will be available in the full map view."); return; }
  document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
  renderSpaces(button.dataset.filter);
}));

grid.addEventListener("click", (event) => {
  const heart = event.target.closest("[data-heart]");
  const book = event.target.closest("[data-book]");
  if (heart) {
    heart.classList.toggle("saved");
    heart.textContent = heart.classList.contains("saved") ? "♥" : "♡";
    showToast(heart.classList.contains("saved") ? "Space saved to your favourites" : "Space removed from favourites");
  }
  if (book) {
    const space = spaces.find((item) => item.id === Number(book.dataset.book));
    showModal({ eyebrow: "Booking confirmed", title: `${space.title}<br>is yours.`, text: `Your spot is reserved today from 10:00 AM. We’ll send entry information before you arrive.`, icon: "✓", action: "View booking" });
  }
});

document.getElementById("parkingSearch").addEventListener("submit", (event) => {
  event.preventDefault();
  const location = document.getElementById("locationInput").value.trim() || "your destination";
  showModal({ eyebrow: "14 spaces found", title: `Great parking<br>near ${location}.`, text: "We’ve selected the closest verified spots with the best availability for your arrival time.", icon: "⌖", action: "Explore spaces" });
});

document.getElementById("locationInput").addEventListener("focus", () => {
  const suggestions = document.getElementById("suggestions");
  suggestions.innerHTML = ["Connaught Place, New Delhi", "Khan Market, New Delhi", "India Gate, New Delhi"].map((place) => `<div class="suggestion" data-place="${place}">⌖ &nbsp;${place}</div>`).join("");
  suggestions.classList.add("show");
});
document.getElementById("suggestions").addEventListener("click", (event) => {
  const choice = event.target.closest("[data-place]");
  if (!choice) return;
  document.getElementById("locationInput").value = choice.dataset.place;
  document.getElementById("suggestions").classList.remove("show");
});
document.addEventListener("click", (event) => { if (!event.target.closest(".search-card")) document.getElementById("suggestions").classList.remove("show"); });

document.getElementById("locateBtn").addEventListener("click", () => { document.getElementById("locationInput").value = "Near me · Connaught Place"; showToast("Location updated to your current area"); });
document.getElementById("viewAllBtn").addEventListener("click", (event) => { event.preventDefault(); showToast("Showing the closest verified spaces first"); });
document.getElementById("hostBtn").addEventListener("click", () => document.getElementById("hosts").scrollIntoView({ behavior: "smooth" }));
document.getElementById("startHosting").addEventListener("click", () => showModal({ eyebrow: "List in minutes", title: "Turn your space<br>into earnings.", text: "Create a host listing, decide when it is available, and start receiving protected payouts.", icon: "₹", action: "Create my listing" }));
document.getElementById("loginBtn").addEventListener("click", () => showModal({ eyebrow: "Welcome back", title: "Log in to<br>your Parkly.", text: "Your bookings, saved places, and parking history are waiting for you.", icon: "↗", action: "Continue" }));
document.getElementById("modalClose").addEventListener("click", closeModal);
document.getElementById("modalAction").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
