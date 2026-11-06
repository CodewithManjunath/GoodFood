import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { flowType: "pkce" } })
  : null;

const initialDonations = [
  { id: 1, title: "Fresh market produce boxes", donor: "Willow & Rye Restaurant", category: "Produce", quantity: "12 boxes", distance: "0.8 mi", pickup: "Today, 3:00–5:00 PM", emoji: "🥬", color: "green", status: "Available", description: "Seasonal greens, tomatoes, and root vegetables from today's prep." },
  { id: 2, title: "Artisan bread & pastries", donor: "Juniper Street Bakery", category: "Bakery", quantity: "24 items", distance: "1.2 mi", pickup: "Today, 4:30–6:00 PM", emoji: "🥐", color: "peach", status: "Available", description: "Freshly baked sourdough loaves and assorted pastries." },
  { id: 3, title: "Warm family meal trays", donor: "The Fern Hotel", category: "Prepared meals", quantity: "18 servings", distance: "2.1 mi", pickup: "Today, 5:00–6:30 PM", emoji: "🍲", color: "yellow", status: "Available", description: "Vegetable stew and rice, prepared today and kept chilled." },
  { id: 4, title: "Dairy & pantry essentials", donor: "Harvest Corner Market", category: "Dairy", quantity: "10 grocery bags", distance: "2.6 mi", pickup: "Tomorrow, 9:00–11:00 AM", emoji: "🥛", color: "lavender", status: "Available", description: "Milk, yogurt, and shelf-stable pantry items, all in date." },
  { id: 5, title: "Seasonal fruit selection", donor: "Riverbend Community Garden", category: "Produce", quantity: "8 crates", distance: "3.4 mi", pickup: "Tomorrow, 10:00 AM–1:00 PM", emoji: "🍎", color: "blue", status: "Available", description: "A mix of apples, pears, and other locally grown fruit." }
];

const state = {
  donations: JSON.parse(localStorage.getItem("goodfood-donations") || "null") || initialDonations,
  claims: JSON.parse(localStorage.getItem("goodfood-claims") || "[]"),
  saved: JSON.parse(localStorage.getItem("goodfood-saved") || "[]"),
  user: null,
  role: null,
  authMode: "login",
  view: "discover",
  search: "",
  category: "All categories",
  toastTimer: null
};

const root = document.getElementById("view-root");
const labels = {
  ngo: "Community Table",
  donor: "Willow & Rye Restaurant",
  individual: "Individual donor",
  admin: "Platform admin"
};
function accountName() {
  return state.user?.user_metadata?.display_name ||
    state.user?.user_metadata?.full_name ||
    state.user?.email ||
    labels[state.role] ||
    "Goodfood member";
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

const pageTitles = {
  discover: "Discover food",
  "my-activity": "My activity",
  impact: "Community impact",
  admin: "Admin console"
};

function persist() {
  localStorage.setItem("goodfood-donations", JSON.stringify(state.donations));
  localStorage.setItem("goodfood-claims", JSON.stringify(state.claims));
  localStorage.setItem("goodfood-saved", JSON.stringify(state.saved));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function updateShell() {
  document.getElementById("profile-name").textContent = accountName();
  document.querySelector(".avatar").textContent = initials(accountName());
  document.querySelector(".profile-meta small").textContent =
    state.role === "admin" ? "Platform administrator" : state.role === "individual" ? "Individual donor" : state.role === "donor" ? "Food donor" : "NGO recipient";
  document.querySelector(".admin-only").classList.toggle("hidden", state.role !== "admin");
  document.getElementById("activity-count").textContent =
    state.role === "ngo" ? state.claims.length : state.donations.filter((item) => item.status !== "Available").length;
  document.getElementById("page-label").textContent = pageTitles[state.view] || "Discover food";
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === state.view));
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function donationCard(item) {
  const isSaved = state.saved.includes(item.id);
  const action = state.role === "ngo"
    ? `<button class="claim-button" data-claim="${item.id}">Request pickup →</button>`
    : `<button class="claim-button" data-view="my-activity">View details →</button>`;
  return `
    <article class="donation-card">
      <div class="food-art ${escapeHtml(item.color)}">
        <span class="food-tag">${escapeHtml(item.category)}</span>
        <button class="saved-button ${isSaved ? "saved" : ""}" data-save="${item.id}" aria-label="${isSaved ? "Remove saved donation" : "Save donation"}">${isSaved ? "♥" : "♡"}</button>
        <span class="food-emoji" aria-hidden="true">${escapeHtml(item.emoji)}</span>
      </div>
      <div class="card-body">
        <div class="card-title-row"><h3 class="card-title">${escapeHtml(item.title)}</h3><span class="distance">${escapeHtml(item.distance || "Local")}</span></div>
        <div class="donor-name">Offered by <strong>${escapeHtml(item.donor)}</strong></div>
        <div class="card-meta"><span>▣ ${escapeHtml(item.quantity)}</span><span>◷ ${escapeHtml(item.pickup)}</span></div>
        <div class="card-footer"><span class="pickup-time">Pickup details after confirmation</span>${action}</div>
      </div>
    </article>`;
}

function discoverView() {
  const isDonor = state.role === "donor" || state.role === "individual";
  const available = state.donations.filter((item) => item.status === "Available");
  const filtered = available.filter((item) => {
    const text = `${item.title} ${item.donor} ${item.category} ${item.description}`.toLowerCase();
    return text.includes(state.search.toLowerCase()) &&
      (state.category === "All categories" || item.category === state.category);
  });
  const ownGreeting = isDonor ? "Good food deserves a second home." : "A little good goes a long way.";
  root.innerHTML = `
    <div class="page-wrap">
      <div class="welcome-row">
        <div><div class="eyebrow">${isDonor ? "DONOR DASHBOARD" : "YOUR LOCAL FOOD NETWORK"}</div><h1>${ownGreeting}</h1>
          <p class="subtitle">${isDonor ? "Share your surplus with a community organization nearby." : "Find fresh, local donations ready to make a difference."}</p></div>
        ${isDonor ? `<button class="primary-button" id="add-donation"><span>＋</span> Offer food</button>` : ""}
      </div>
      <div class="hero-card">
        <div class="hero-symbol">✳</div>
        <div class="hero-copy"><strong>Good things happen when we share.</strong><p>Every donation connects local food with neighbors who need it. We keep personal contact details private, so you can coordinate safely through Goodfood.</p></div>
        <div class="hero-stat"><strong>${state.donations.filter((item) => item.status === "Available").length}</strong><span>donations nearby today</span></div>
      </div>
      <div class="section-heading"><div><h2>${isDonor ? "Community listings" : "Available near you"}</h2><p>${isDonor ? "See what other neighbors are sharing." : "Fresh donations from trusted local providers"}</p></div><span class="result-count">${filtered.length} available</span></div>
      <div class="toolbar">
        <label class="search-box"><span>⌕</span><input id="search-input" type="search" placeholder="Search food, organization, or category..." value="${escapeHtml(state.search)}" /></label>
        <select class="filter-select" id="category-filter" aria-label="Filter by food category">
          ${["All categories", "Produce", "Bakery", "Prepared meals", "Dairy", "Other"].map((category) => `<option ${state.category === category ? "selected" : ""}>${category}</option>`).join("")}
        </select>
        <select class="filter-select" aria-label="Sort donations"><option>Nearest first</option><option>Pickup time</option></select>
      </div>
      <div class="donation-grid">${filtered.length ? filtered.map(donationCard).join("") : `<div class="empty-state"><span>⌕</span><strong>No donations found</strong><p>Try a different search or category.</p></div>`}</div>
      <p class="privacy-note">◈ Personal contact details are never shown. Pickup information is shared only after a request is confirmed.</p>
    </div>`;
  document.getElementById("search-input").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
    const input = document.getElementById("search-input");
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  document.getElementById("category-filter").addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });
  document.getElementById("add-donation")?.addEventListener("click", openDonationForm);
  root.querySelectorAll("[data-claim]").forEach((button) => button.addEventListener("click", () => openClaim(Number(button.dataset.claim))));
  root.querySelectorAll("[data-save]").forEach((button) => button.addEventListener("click", () => toggleSaved(Number(button.dataset.save))));
  root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
}

function activityView() {
  let items = [];
  if (state.role === "ngo") {
    items = state.claims.map((claim) => ({ ...claim, icon: "🥬", subtitle: `Offered by ${claim.donor} · ${claim.pickup}`, isRequest: true }));
  } else {
    const ownDonations = state.donations.filter((item) => item.donor === accountName() || state.role === "admin")
      .map((item) => ({ icon: item.emoji, title: item.title, subtitle: `${item.quantity} · ${item.pickup}`, status: item.status }));
    const requests = state.claims.filter((claim) => claim.donor === accountName() || state.role === "admin")
      .map((claim) => ({ ...claim, icon: "↗", subtitle: `Requested by ${claim.recipient || "a community organization"} · ${claim.pickup}`, isRequest: true }));
    items = [...requests, ...ownDonations];
  }
  root.innerHTML = `<div class="page-wrap"><div class="welcome-row"><div><div class="eyebrow">YOUR GOODFOOD</div><h1>My activity</h1><p class="subtitle">Keep track of your donations and pickup requests.</p></div>${state.role === "donor" || state.role === "individual" ? `<button class="primary-button" id="add-donation"><span>＋</span> Offer food</button>` : ""}</div>
    <div class="activity-list">${items.length ? items.map((item) => `<div class="activity-row"><span class="activity-icon">${escapeHtml(item.icon)}</span><span class="activity-text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle)}</small></span>${item.isRequest && item.status === "Requested" && state.role !== "ngo" ? `<button class="claim-button" data-confirm-request="${item.id}">Confirm request</button>` : item.isRequest && item.status === "Confirmed" ? `<button class="claim-button" data-complete-request="${item.id}">Mark collected</button>` : `<span class="status-pill">${escapeHtml(item.status)}</span>`}</div>`).join("") : `<div class="empty-state"><span>▤</span><strong>Nothing here just yet</strong><p>Your requests and donations will show up here.</p></div>`}</div></div>`;
  document.getElementById("add-donation")?.addEventListener("click", openDonationForm);
  root.querySelectorAll("[data-confirm-request]").forEach((button) => button.addEventListener("click", () => {
    const claim = state.claims.find((request) => request.id === Number(button.dataset.confirmRequest));
    if (!claim) return;
    claim.status = "Confirmed";
    const donation = state.donations.find((item) => item.id === claim.donationId);
    if (donation) donation.status = "Confirmed";
    persist();
    render();
    showToast("Request confirmed. Coordinate pickup through Goodfood.");
  }));
  root.querySelectorAll("[data-complete-request]").forEach((button) => button.addEventListener("click", () => {
    const claim = state.claims.find((request) => request.id === Number(button.dataset.completeRequest));
    if (!claim) return;
    claim.status = "Collected";
    const donation = state.donations.find((item) => item.id === claim.donationId);
    if (donation) donation.status = "Collected";
    persist();
    render();
    showToast("Pickup marked as collected. Thank you for sharing.");
  }));
}

function impactView() {
  const completed = state.claims.filter((claim) => claim.status === "Collected").length;
  const available = state.donations.filter((item) => item.status === "Available").length;
  root.innerHTML = `<div class="page-wrap"><div class="eyebrow">LOCAL GOOD, ADDED UP</div><h1>Community impact</h1><p class="subtitle">Every shared meal is a step toward a more connected, less wasteful community.</p>
    <div class="stats-grid"><div class="stat-card"><span>Donations shared</span><strong>${state.donations.length}</strong><small>Food listings on Goodfood</small></div><div class="stat-card"><span>Pickups completed</span><strong>${completed}</strong><small>Confirmed handoffs</small></div><div class="stat-card"><span>Available now</span><strong>${available}</strong><small>Ready for a new home</small></div></div>
    <div class="hero-card"><div class="hero-symbol">✳</div><div class="hero-copy"><strong>Small acts make a real difference.</strong><p>Impact numbers are based on activity recorded on this demo platform. Food quantities and environmental impact are not independently verified.</p></div></div></div>`;
}

function adminView() {
  if (state.role !== "admin") {
    state.view = "discover";
    return discoverView();
  }
  root.innerHTML = `<div class="page-wrap"><div class="eyebrow">PLATFORM MANAGEMENT</div><h1>Admin console</h1><p class="subtitle">A clear view of community activity. Admin actions are recorded for accountability.</p>
    <div class="stats-grid"><div class="stat-card"><span>Active listings</span><strong>${state.donations.filter((item) => item.status === "Available").length}</strong><small>Currently accepting requests</small></div><div class="stat-card"><span>Pending requests</span><strong>${state.claims.filter((item) => item.status === "Requested").length}</strong><small>Awaiting donor confirmation</small></div><div class="stat-card"><span>Registered organizations</span><strong>12</strong><small>Demo data</small></div></div>
    <div class="section-heading"><div><h2>Donation listings</h2><p>Review and manage current community offers</p></div></div>
    <table class="admin-table"><thead><tr><th>Donation</th><th>Donor organization</th><th>Quantity</th><th>Status</th><th>Action</th></tr></thead><tbody>${state.donations.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.donor)}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.status)}</td><td><button class="table-action" data-admin-remove="${item.id}">Remove</button></td></tr>`).join("")}</tbody></table>
    <p class="privacy-note">Admin account access is restricted. Donation management is still demo data stored in this browser.</p></div>`;
  root.querySelectorAll("[data-admin-remove]").forEach((button) => button.addEventListener("click", () => {
    const item = state.donations.find((donation) => donation.id === Number(button.dataset.adminRemove));
    if (!item) return;
    openConfirm(`Remove "${item.title}" from listings?`, "This listing will no longer appear in the community marketplace.", () => {
      state.donations = state.donations.filter((donation) => donation.id !== item.id);
      persist();
      render();
      showToast("Listing removed.");
    });
  }));
}

function render() {
  updateShell();
  if (state.view === "my-activity") activityView();
  else if (state.view === "impact") impactView();
  else if (state.view === "admin") adminView();
  else discoverView();
}

function setView(view) {
  state.view = view;
  render();
}

function showModal(content) {
  document.getElementById("modal-content").innerHTML = content;
  document.getElementById("modal-backdrop").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-backdrop").classList.add("hidden");
}

function openClaim(id) {
  const item = state.donations.find((donation) => donation.id === id);
  if (!item) return;
  showModal(`<div class="eyebrow">REQUEST A DONATION</div><h2 id="modal-title">${escapeHtml(item.title)}</h2>
    <p class="modal-intro">${escapeHtml(item.description)}</p>
    <div class="confirm-box"><strong>Privacy-first pickup</strong><br>Your account name, ${escapeHtml(accountName())}, will be shown to ${escapeHtml(item.donor)}. Personal contact information stays private. Pickup details are shared after the donor confirms.</div>
    <div class="form-field"><label for="request-note">Note to the donor (optional)</label><textarea id="request-note" placeholder="For example: We can collect this within the pickup window."></textarea></div>
    <div class="modal-actions"><button class="secondary-button" id="cancel-modal">Go back</button><button class="primary-button" id="confirm-claim">Send request</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("confirm-claim").addEventListener("click", () => {
    state.claims.unshift({
      id: Date.now(),
      donationId: id,
      title: item.title,
      donor: item.donor,
      recipient: accountName(),
      pickup: item.pickup,
      status: "Requested"
    });
    item.status = "Requested";
    persist();
    closeModal();
    render();
    showToast("Request sent. The donor can confirm it here.");
  });
}

function openDonationForm() {
  showModal(`<div class="eyebrow">SHARE SURPLUS FOOD</div><h2 id="modal-title">Offer a donation</h2><p class="modal-intro">Tell local organizations what is available. Your personal contact details will not be shown.</p>
    <form id="donation-form"><div class="form-grid">
      <div class="form-field full"><label for="donation-title">What food are you offering? *</label><input id="donation-title" name="title" required maxlength="70" placeholder="e.g. Fresh seasonal produce boxes" /></div>
      <div class="form-field"><label for="donation-category">Category *</label><select id="donation-category" name="category"><option>Produce</option><option>Bakery</option><option>Prepared meals</option><option>Dairy</option><option>Other</option></select></div>
      <div class="form-field"><label for="donation-quantity">Quantity *</label><input id="donation-quantity" name="quantity" required maxlength="35" placeholder="e.g. 10 boxes" /></div>
      <div class="form-field full"><label for="donation-description">Food and storage details *</label><textarea id="donation-description" name="description" required maxlength="300" placeholder="Include ingredients, allergens, and storage conditions."></textarea></div>
      <div class="form-field full"><label for="donation-pickup">Pickup window *</label><input id="donation-pickup" name="pickup" required maxlength="55" placeholder="e.g. Today, 3:00–5:00 PM" /></div>
    </div><div class="confirm-box">You will coordinate through Goodfood. Avoid including private phone numbers or personal addresses in the listing.</div>
      <div class="modal-actions"><button type="button" class="secondary-button" id="cancel-modal">Cancel</button><button class="primary-button" type="submit">Publish listing</button></div></form>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("donation-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    state.donations.unshift({
      id: Date.now(),
      title: formData.get("title").trim(),
      donor: accountName(),
      category: formData.get("category"),
      quantity: formData.get("quantity").trim(),
      distance: "Local",
      pickup: formData.get("pickup").trim(),
      emoji: "🥗",
      color: "green",
      description: formData.get("description").trim(),
      status: "Available"
    });
    persist();
    state.view = "discover";
    closeModal();
    render();
    showToast("Your donation is now listed.");
  });
}

function openConfirm(title, message, onConfirm) {
  showModal(`<div class="eyebrow">ADMIN ACTION</div><h2 id="modal-title">${escapeHtml(title)}</h2><p class="modal-intro">${escapeHtml(message)}</p><div class="modal-actions"><button class="secondary-button" id="cancel-modal">Cancel</button><button class="primary-button" id="confirm-action">Confirm</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("confirm-action").addEventListener("click", () => {
    closeModal();
    onConfirm();
  });
}

function toggleSaved(id) {
  state.saved = state.saved.includes(id) ? state.saved.filter((savedId) => savedId !== id) : [...state.saved, id];
  persist();
  render();
}

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "modal-backdrop") closeModal();
});
document.getElementById("privacy-link").addEventListener("click", () => {
  showModal(`<div class="eyebrow">PRIVACY BY DESIGN</div><h2 id="modal-title">Connect without sharing too much.</h2><p class="modal-intro">Goodfood helps organizations coordinate donations even when they have never met. Organization names are visible so partners can make informed requests, but personal contact details are not shown on public listings.</p><div class="confirm-box"><strong>1.</strong> Browse donations without exposing your personal details.<br><strong>2.</strong> Send a request using your own account.<br><strong>3.</strong> Once confirmed, coordinate pickup through the platform. Only necessary handoff details are shared.</div><p class="modal-intro">Sign-in credentials are stored by the local server as salted password hashes, not in browser storage. Donations and requests remain demo data in this prototype.</p><div class="modal-actions"><button class="primary-button" id="cancel-modal">Got it</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
});
document.getElementById("help-button").addEventListener("click", () => showToast("Support center coming soon."));
document.getElementById("profile-button").addEventListener("click", () => showToast(state.user.email));

function showAuthError(message) {
  const error = document.getElementById("auth-error");
  error.textContent = message;
  error.classList.remove("hidden");
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  const isCompleteProfile = mode === "complete-profile";
  document.getElementById("auth-title").textContent = isRegister ? "Create your account" : "Welcome back";
  if (isCompleteProfile) document.getElementById("auth-title").textContent = "Finish your profile";
  document.getElementById("auth-subtitle").textContent = isCompleteProfile
    ? "Choose your account type to continue."
    : isRegister
    ? "Create a separate account for yourself or your organization."
    : "Sign in to your own Goodfood account.";
  document.getElementById("name-field").classList.toggle("hidden", !isRegister && !isCompleteProfile);
  document.getElementById("role-field").classList.toggle("hidden", !isRegister && !isCompleteProfile);
  document.getElementById("auth-name").required = isRegister || isCompleteProfile;
  document.getElementById("auth-name").value = isCompleteProfile
    ? state.user?.user_metadata?.display_name || state.user?.user_metadata?.full_name || ""
    : "";
  document.getElementById("auth-email").readOnly = isCompleteProfile;
  document.getElementById("auth-email").value = isCompleteProfile ? state.user?.email || "" : "";
  document.getElementById("auth-password").closest(".form-field").classList.toggle("hidden", isCompleteProfile);
  document.getElementById("auth-password").required = !isCompleteProfile;
  document.getElementById("auth-password").autocomplete = isRegister ? "new-password" : "current-password";
  document.getElementById("password-hint").classList.toggle("hidden", !isRegister);
  document.getElementById("auth-password").minLength = isRegister ? 10 : 1;
  document.getElementById("auth-submit").textContent = isCompleteProfile ? "Save profile" : isRegister ? "Create account" : "Sign in";
  document.getElementById("auth-switch").closest(".auth-switch").classList.toggle("hidden", isCompleteProfile);
  document.getElementById("google-sign-in").classList.toggle("hidden", isCompleteProfile);
  document.querySelector(".auth-divider").classList.toggle("hidden", isCompleteProfile);
  document.querySelector(".auth-admin-note").classList.toggle("hidden", isCompleteProfile);
  document.getElementById("auth-switch-prompt").textContent = isRegister ? "Already registered?" : "New to Goodfood?";
  document.getElementById("auth-switch").textContent = isRegister ? "Sign in" : "Create an account";
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-error").classList.remove("success");
}

function showAuthenticatedApp(user) {
  state.user = user;
  state.role = user.app_metadata?.role === "admin"
    ? "admin"
    : ["ngo", "donor", "individual"].includes(user.user_metadata?.role)
      ? user.user_metadata.role
      : null;
  if (!state.role) {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
    setAuthMode("complete-profile");
    return;
  }
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  render();
}

function showSignedOut() {
  state.user = null;
  state.role = null;
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
  setAuthMode("login");
}

document.getElementById("auth-switch").addEventListener("click", () => {
  setAuthMode(state.authMode === "login" ? "register" : "login");
});

document.getElementById("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const submit = document.getElementById("auth-submit");
  const form = new FormData(formElement);
  submit.disabled = true;
  document.getElementById("auth-error").classList.add("hidden");
  try {
    if (!supabase) throw new Error("Supabase is not configured. Copy .env.example to .env.local and add your project URL and publishable key.");
    if (state.authMode === "complete-profile") {
      const { data, error } = await supabase.auth.updateUser({
        data: {
          display_name: String(form.get("name")).trim(),
          role: form.get("role")
        }
      });
      if (error) throw error;
      showAuthenticatedApp(data.user);
    } else if (state.authMode === "register") {
      const { data, error } = await supabase.auth.signUp({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
        options: {
          data: {
            display_name: String(form.get("name")).trim(),
            role: form.get("role")
          },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) throw error;
      if (data.session) {
        formElement.reset();
        showAuthenticatedApp(data.user);
      } else {
        const notice = document.getElementById("auth-error");
        notice.textContent = "Account created. Check your email to confirm your address, then sign in.";
        notice.classList.remove("hidden");
        notice.classList.add("success");
        setAuthMode("login");
        notice.textContent = "Account created. Check your email to confirm your address, then sign in.";
        notice.classList.remove("hidden");
        notice.classList.add("success");
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: String(form.get("email")).trim(),
        password: String(form.get("password"))
      });
      if (error) throw error;
      formElement.reset();
      showAuthenticatedApp(data.user);
    }
  } catch (error) {
    showAuthError(error.message || "Unable to authenticate this account.");
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("google-sign-in").addEventListener("click", async () => {
  const button = document.getElementById("google-sign-in");
  button.disabled = true;
  try {
    if (!supabase) throw new Error("Supabase is not configured. Copy .env.example to .env.local and add your project URL and publishable key.");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin }
    });
    if (error) throw error;
  } catch (error) {
    showAuthError(error.message || "Unable to start Google sign-in.");
    button.disabled = false;
  }
});

document.getElementById("sign-out").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) {
    showToast(error.message);
    return;
  }
  showSignedOut();
});

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      showSignedOut();
      return;
    }
    if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") {
      showAuthenticatedApp(session.user);
    }
  });
} else {
  showSignedOut();
  showAuthError("Supabase is not configured. Copy .env.example to .env.local and add your project URL and anon key.");
}
