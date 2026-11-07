import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { flowType: "pkce" } })
  : null;

const categories = ["Produce", "Bakery", "Prepared meals", "Dairy", "Other"];
const roles = {
  ngo: "NGO / recipient organization",
  donor: "Food donor",
  individual: "Individual donor",
  admin: "Platform administrator"
};
const state = {
  donations: [],
  claims: [],
  members: [],
  stats: null,
  user: null,
  profile: null,
  role: null,
  authMode: "login",
  view: "discover",
  search: "",
  category: "All categories",
  saved: [],
  toastTimer: null,
  loadingUserId: null
};

const root = document.getElementById("view-root");
const pageTitles = {
  discover: "Discover food",
  "my-activity": "My activity",
  impact: "Community impact",
  admin: "Admin console"
};

function accountName() {
  return state.profile?.display_name || state.user?.email || roles[state.role] || "Goodfood member";
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function statusLabel(status) {
  return status ? status[0].toUpperCase() + status.slice(1) : "Unknown";
}

function formatPickupWindow(start, end, timezone) {
  try {
    const format = new Intl.DateTimeFormat("en-IN", {
      timeZone: timezone || "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short"
    });
    return `${format.format(new Date(start))} – ${format.format(new Date(end))}`;
  } catch {
    return `${new Date(start).toLocaleString()} – ${new Date(end).toLocaleString()}`;
  }
}

function getLocalDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function setToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

function showAuthError(message) {
  const error = document.getElementById("auth-error");
  error.textContent = message;
  error.classList.remove("hidden");
}

function updateShell() {
  document.getElementById("profile-name").textContent = accountName();
  document.querySelector(".avatar").textContent = initials(accountName());
  document.querySelector(".profile-meta small").textContent = roles[state.role] || "Goodfood member";
  document.querySelector(".admin-only").classList.toggle("hidden", state.role !== "admin");
  const activityCount = state.role === "ngo"
    ? state.claims.length
    : state.role === "admin"
      ? state.claims.length
      : state.claims.filter((claim) => claim.donorId === state.user?.id).length;
  document.getElementById("activity-count").textContent = String(activityCount);
  document.getElementById("page-label").textContent = pageTitles[state.view] || "Discover food";
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.view);
  });
  const location = document.querySelector(".location-pill");
  location.innerHTML = `<span>⌖</span> ${escapeHtml(state.profile?.city || "Your city")}, ${escapeHtml(state.profile?.country || "India")}`;
}

function getSavedKey(userId = state.user?.id) {
  return userId ? `goodfood-saved:${userId}` : "goodfood-saved";
}

function readSavedItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getSavedKey()) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Could not read saved listings.", error);
    return [];
  }
}

function persistSavedItems() {
  localStorage.setItem(getSavedKey(), JSON.stringify(state.saved));
}

function donationFromRow(row) {
  const donor = row.donor || {};
  return {
    id: row.id,
    donorId: row.donor_id,
    title: row.title,
    donor: donor.display_name || "Community donor",
    category: row.category,
    quantity: row.quantity,
    city: donor.city || "",
    country: donor.country || "",
    timezone: donor.timezone || "Asia/Kolkata",
    pickup: formatPickupWindow(row.pickup_starts_at, row.pickup_ends_at, donor.timezone),
    pickupStartsAt: row.pickup_starts_at,
    pickupEndsAt: row.pickup_ends_at,
    pickupInstructions: row.pickup_instructions || null,
    emoji: row.category === "Bakery" ? "🥐" : row.category === "Dairy" ? "🥛" : row.category === "Prepared meals" ? "🍲" : "🥬",
    color: row.category === "Bakery" ? "peach" : "green",
    description: row.description,
    status: statusLabel(row.status)
  };
}

function claimFromRow(row) {
  const donation = row.donation || {};
  const donor = donation.donor || {};
  return {
    id: row.id,
    donationId: row.donation_id,
    donorId: row.donor_id,
    ngoId: row.ngo_id,
    title: donation.title || "Food donation",
    donor: donor.display_name || "Community donor",
    recipient: row.recipient?.display_name || "Community organization",
    quantity: donation.quantity || "",
    pickup: donation.pickup_starts_at
      ? formatPickupWindow(donation.pickup_starts_at, donation.pickup_ends_at, donor.timezone)
      : "",
    pickupInstructions: row.pickup_instructions || null,
    note: row.note || "",
    status: statusLabel(row.status)
  };
}

async function loadWorkspaceData() {
  const [donationsResult, claimsResult, statsResult] = await Promise.all([
    supabase.from("donations")
      .select("id,donor_id,title,category,quantity,description,pickup_starts_at,pickup_ends_at,status,donor:profiles!donations_donor_id_fkey(display_name,city,country,timezone)")
      .order("created_at", { ascending: false }),
    supabase.from("claims")
      .select("id,donation_id,donor_id,ngo_id,note,pickup_instructions,status,created_at,recipient:profiles!claims_ngo_id_fkey(display_name),donation:donations!claims_donation_id_fkey(title,quantity,pickup_starts_at,pickup_ends_at,donor:profiles!donations_donor_id_fkey(display_name,timezone))")
      .order("created_at", { ascending: false }),
    supabase.rpc("goodfood_impact_summary")
  ]);
  if (donationsResult.error) throw donationsResult.error;
  if (claimsResult.error) throw claimsResult.error;
  if (statsResult.error) throw statsResult.error;
  state.donations = donationsResult.data.map(donationFromRow);
  state.claims = claimsResult.data.map(claimFromRow);
  state.stats = statsResult.data?.[0] || null;

  if (state.role === "admin") {
    const membersResult = await supabase.from("profiles")
      .select("id,display_name,role,country,city,is_verified,is_suspended,created_at")
      .not("role", "is", null)
      .order("created_at", { ascending: false });
    if (membersResult.error) throw membersResult.error;
    state.members = membersResult.data;
  }
}

function showLoadError(error) {
  console.error("Could not load Goodfood data.", error);
  root.innerHTML = `<div class="page-wrap"><div class="empty-state"><strong>We could not load community data.</strong><p>${escapeHtml(error.message || "Check the connection and database setup, then try again.")}</p><button class="primary-button" id="retry-load">Try again</button></div></div>`;
  document.getElementById("retry-load").addEventListener("click", async () => {
    const button = document.getElementById("retry-load");
    button.disabled = true;
    try {
      await loadWorkspaceData();
      render();
    } catch (loadError) {
      showLoadError(loadError);
    }
  });
}

function donationCard(item) {
  const isSaved = state.saved.includes(item.id);
  const isVerifiedNGO = state.role === "ngo" && state.profile?.is_verified;
  const action = state.role === "ngo"
    ? isVerifiedNGO
      ? `<button class="claim-button" data-claim="${escapeHtml(item.id)}">Request pickup →</button>`
      : `<span class="status-pill">NGO verification required</span>`
    : `<button class="claim-button" data-view="my-activity">View details →</button>`;
  return `
    <article class="donation-card">
      <div class="food-art ${escapeHtml(item.color)}">
        <span class="food-tag">${escapeHtml(item.category)}</span>
        <button class="saved-button ${isSaved ? "saved" : ""}" data-save="${escapeHtml(item.id)}" aria-label="${isSaved ? "Remove saved donation" : "Save donation"}">${isSaved ? "♥" : "♡"}</button>
        <span class="food-emoji" aria-hidden="true">${escapeHtml(item.emoji)}</span>
      </div>
      <div class="card-body">
        <div class="card-title-row"><h3 class="card-title">${escapeHtml(item.title)}</h3><span class="distance">${escapeHtml(item.city || "Local")}</span></div>
        <div class="donor-name">Offered by <strong>${escapeHtml(item.donor)}</strong></div>
        <div class="card-meta"><span>▣ ${escapeHtml(item.quantity)}</span><span>◷ ${escapeHtml(item.pickup)}</span></div>
        <div class="card-footer"><span class="pickup-time">Private pickup details after confirmation</span>${action}</div>
      </div>
    </article>`;
}

function discoverView() {
  const isDonor = state.role === "donor" || state.role === "individual";
  const available = state.donations.filter((item) =>
    item.status === "Available" && new Date(item.pickupEndsAt).getTime() > Date.now()
  );
  const filtered = available.filter((item) => {
    const text = `${item.title} ${item.donor} ${item.category} ${item.description} ${item.city}`.toLowerCase();
    return text.includes(state.search.toLowerCase()) &&
      (state.category === "All categories" || item.category === state.category);
  });
  const ownGreeting = isDonor ? "Good food deserves a second home." : "A little good goes a long way.";
  root.innerHTML = `
    <div class="page-wrap">
      <div class="welcome-row">
        <div><div class="eyebrow">${isDonor ? "DONOR DASHBOARD" : "YOUR LOCAL FOOD NETWORK"}</div><h1>${ownGreeting}</h1>
          <p class="subtitle">${isDonor ? "Share your surplus with a community organization nearby." : "Find fresh, local donations ready to make a difference."}</p></div>
        ${isDonor && state.profile?.is_verified ? `<button class="primary-button" id="add-donation"><span>＋</span> Donate food</button>` : ""}
      </div>
      ${isDonor && !state.profile?.is_verified ? `<div class="confirm-box verification-notice"><strong>Account verification required.</strong> A platform administrator must verify this account before it can publish a food donation.</div>` : ""}
      ${state.role === "ngo" && !state.profile?.is_verified ? `<div class="confirm-box verification-notice"><strong>Account verification required.</strong> You can browse listings; an administrator must verify this organization before it can request food.</div>` : ""}
      <div class="hero-card">
        <div class="hero-symbol">✳</div>
        <div class="hero-copy"><strong>Good things happen when we share.</strong><p>Verified donors can post surplus food directly—no request needed to publish. NGOs can then request a handoff. Private pickup instructions are shared only after a donor confirms.</p></div>
        <div class="hero-stat"><strong>${available.length}</strong><span>available listings</span></div>
      </div>
      <div class="section-heading"><div><h2>${isDonor ? "Community listings" : "Available near you"}</h2><p>${isDonor ? "See what other neighbors are sharing." : "Current food offers from verified donors"}</p></div><span class="result-count">${filtered.length} available</span></div>
      <div class="toolbar">
        <label class="search-box"><span>⌕</span><input id="search-input" type="search" placeholder="Search food, organization, or city..." value="${escapeHtml(state.search)}" /></label>
        <select class="filter-select" id="category-filter" aria-label="Filter by food category">
          ${["All categories", ...categories].map((category) => `<option ${state.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}
        </select>
        <button class="secondary-button" id="refresh-listings">Refresh</button>
      </div>
      <div class="donation-grid">${filtered.length ? filtered.map(donationCard).join("") : `<div class="empty-state"><span>⌕</span><strong>No donations found</strong><p>Try a different search or category.</p></div>`}</div>
      <p class="privacy-note">◈ Personal contact details and exact pickup addresses are never shown on public listings.</p>
    </div>`;
  document.getElementById("search-input").addEventListener("input", (event) => {
    state.search = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const input = document.getElementById("search-input");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  });
  document.getElementById("category-filter").addEventListener("change", (event) => {
    state.category = event.target.value;
    render();
  });
  document.getElementById("refresh-listings").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      await loadWorkspaceData();
      render();
    } catch (error) {
      showLoadError(error);
    }
  });
  document.getElementById("add-donation")?.addEventListener("click", openDonationForm);
  root.querySelectorAll("[data-claim]").forEach((button) => {
    button.addEventListener("click", () => openClaim(button.dataset.claim));
  });
  root.querySelectorAll("[data-save]").forEach((button) => {
    button.addEventListener("click", () => toggleSaved(button.dataset.save));
  });
  root.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
}

function activityView() {
  const claims = state.role === "ngo"
    ? state.claims.filter((claim) => claim.ngoId === state.user.id)
    : state.role === "admin"
      ? state.claims
      : state.claims.filter((claim) => claim.donorId === state.user.id);
  const donations = state.donations
    .filter((donation) => state.role === "admin" || donation.donorId === state.user.id)
    .map((item) => ({
      id: item.id,
      icon: item.emoji,
      title: item.title,
      subtitle: `${item.quantity} · ${item.pickup}`,
      status: item.status,
      isDonation: true
    }));
  const items = state.role === "ngo"
    ? claims.map((claim) => ({ ...claim, icon: "🥬", subtitle: `Offered by ${claim.donor} · ${claim.pickup}`, isRequest: true }))
    : [...claims.map((claim) => ({
      ...claim,
      icon: "↗",
      subtitle: `Requested by ${claim.recipient} · ${claim.pickup}`,
      isRequest: true
    })), ...donations];
  root.innerHTML = `<div class="page-wrap"><div class="welcome-row"><div><div class="eyebrow">YOUR GOODFOOD</div><h1>My activity</h1><p class="subtitle">Keep track of your donations and pickup requests.</p></div>${["donor", "individual"].includes(state.role) && state.profile?.is_verified ? `<button class="primary-button" id="add-donation"><span>＋</span> Donate food</button>` : ""}</div>
    <div class="activity-list">${items.length ? items.map((item) => `<div class="activity-row"><span class="activity-icon">${escapeHtml(item.icon)}</span><span class="activity-text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle)}${item.note ? `<br>Note: ${escapeHtml(item.note)}` : ""}${item.status === "Confirmed" && item.pickupInstructions ? `<br><strong>Private pickup instructions:</strong> ${escapeHtml(item.pickupInstructions)}` : ""}</small></span>${item.isDonation && item.status === "Available" ? `<button class="table-action" data-withdraw-donation="${escapeHtml(item.id)}">Withdraw</button>` : item.isRequest && item.status === "Requested" && state.role !== "ngo" ? `<button class="claim-button" data-confirm-request="${escapeHtml(item.id)}">Review request</button><button class="secondary-button" data-decline-request="${escapeHtml(item.id)}">Decline</button>` : item.isRequest && item.status === "Confirmed" && state.role === "ngo" ? `<button class="claim-button" data-complete-request="${escapeHtml(item.id)}">Mark collected</button>` : `<span class="status-pill">${escapeHtml(item.status)}</span>`}</div>`).join("") : `<div class="empty-state"><span>▤</span><strong>Nothing here just yet</strong><p>Your requests and donations will show up here.</p></div>`}</div></div>`;
  document.getElementById("add-donation")?.addEventListener("click", openDonationForm);
  root.querySelectorAll("[data-confirm-request]").forEach((button) => {
    button.addEventListener("click", () => confirmRequest(button.dataset.confirmRequest));
  });
  root.querySelectorAll("[data-decline-request]").forEach((button) => {
    button.addEventListener("click", () => respondToClaim(button.dataset.declineRequest, "decline"));
  });
  root.querySelectorAll("[data-complete-request]").forEach((button) => {
    button.addEventListener("click", () => completePickup(button.dataset.completeRequest));
  });
  root.querySelectorAll("[data-withdraw-donation]").forEach((button) => {
    button.addEventListener("click", () => withdrawDonation(button.dataset.withdrawDonation));
  });
}

function impactView() {
  const stats = state.stats || { total_donations: 0, collected_pickups: 0, available_donations: 0 };
  root.innerHTML = `<div class="page-wrap"><div class="eyebrow">LOCAL GOOD, ADDED UP</div><h1>Community impact</h1><p class="subtitle">Live totals from confirmed activity on Goodfood.</p>
    <div class="stats-grid"><div class="stat-card"><span>Total listings</span><strong>${Number(stats.total_donations)}</strong><small>Listings not withdrawn</small></div><div class="stat-card"><span>Pickups completed</span><strong>${Number(stats.collected_pickups)}</strong><small>Confirmed handoffs</small></div><div class="stat-card"><span>Available now</span><strong>${Number(stats.available_donations)}</strong><small>Current listings with open pickup windows</small></div></div>
    <div class="hero-card"><div class="hero-symbol">✳</div><div class="hero-copy"><strong>Small acts make a real difference.</strong><p>Impact numbers count listings and pickups; food quantities and environmental effects are not independently verified.</p></div></div></div>`;
}

function adminView() {
  if (state.role !== "admin") {
    state.view = "discover";
    return discoverView();
  }
  root.innerHTML = `<div class="page-wrap"><div class="eyebrow">PLATFORM MANAGEMENT</div><h1>Admin console</h1><p class="subtitle">Review partner accounts and moderate food listings. Confirm verification using your organization’s documented checks before approving access.</p>
    <div class="stats-grid"><div class="stat-card"><span>Active listings</span><strong>${state.donations.filter((item) => item.status === "Available").length}</strong><small>Accepting requests</small></div><div class="stat-card"><span>Pending requests</span><strong>${state.claims.filter((item) => item.status === "Requested").length}</strong><small>Awaiting donor decision</small></div><div class="stat-card"><span>Partners</span><strong>${state.members.length}</strong><small>Registered accounts</small></div></div>
    <div class="section-heading"><div><h2>Partner verification</h2><p>Unverified accounts cannot publish or request food.</p></div></div>
    <div class="activity-list">${state.members.length ? state.members.map((member) => `<div class="activity-row"><span class="activity-text"><strong>${escapeHtml(member.display_name)}</strong><small>${escapeHtml(roles[member.role] || member.role)} · ${escapeHtml(member.city)}, ${escapeHtml(member.country)}${member.is_suspended ? " · Suspended" : ""}</small></span><span class="status-pill">${member.is_verified ? "Verified" : "Pending review"}</span><button class="table-action" data-review-profile="${escapeHtml(member.id)}" data-verified="${member.is_verified}" data-suspended="${member.is_suspended}">${member.is_verified ? "Revoke verification" : "Verify"}</button><button class="table-action" data-suspend-profile="${escapeHtml(member.id)}" data-suspended="${member.is_suspended}">${member.is_suspended ? "Restore" : "Suspend"}</button></div>`).join("") : `<div class="empty-state"><strong>No partner accounts yet</strong></div>`}</div>
    <div class="section-heading"><div><h2>Donation listings</h2><p>Remove unsafe, expired, or inappropriate offers.</p></div></div>
    <div class="activity-list">${state.donations.length ? state.donations.map((item) => `<div class="activity-row"><span class="activity-text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.donor)} · ${escapeHtml(item.city)} · ${escapeHtml(item.quantity)} · ${escapeHtml(item.status)}</small></span>${item.status !== "Withdrawn" && item.status !== "Collected" ? `<button class="table-action" data-admin-remove="${escapeHtml(item.id)}">Remove listing</button>` : `<span class="status-pill">${escapeHtml(item.status)}</span>`}</div>`).join("") : `<div class="empty-state"><strong>No listings to review</strong></div>`}</div>
    <p class="privacy-note">Admin access requires Supabase app metadata set by the project owner. Profile emails and private pickup instructions are not included in this review screen.</p></div>`;
  root.querySelectorAll("[data-review-profile]").forEach((button) => {
    button.addEventListener("click", () => reviewMember(
      button.dataset.reviewProfile,
      button.dataset.verified !== "true",
      button.dataset.suspended === "true"
    ));
  });
  root.querySelectorAll("[data-suspend-profile]").forEach((button) => {
    button.addEventListener("click", () => reviewMember(
      button.dataset.suspendProfile,
      state.members.find((member) => member.id === button.dataset.suspendProfile)?.is_verified || false,
      button.dataset.suspended !== "true"
    ));
  });
  root.querySelectorAll("[data-admin-remove]").forEach((button) => {
    button.addEventListener("click", () => moderateDonation(button.dataset.adminRemove));
  });
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
  if (!item || state.role !== "ngo" || !state.profile?.is_verified) return;
  showModal(`<div class="eyebrow">REQUEST A DONATION</div><h2 id="modal-title">${escapeHtml(item.title)}</h2>
    <p class="modal-intro">${escapeHtml(item.description)}</p>
    <div class="confirm-box"><strong>Privacy-first pickup</strong><br>Your organization name, ${escapeHtml(accountName())}, will be shown to ${escapeHtml(item.donor)}. The donor's private pickup instructions are shared only after confirmation.</div>
    <div class="form-field"><label for="request-note">Note to the donor (optional)</label><textarea id="request-note" maxlength="500" placeholder="For example: We can collect this within the pickup window."></textarea></div>
    <div class="modal-actions"><button class="secondary-button" id="cancel-modal">Go back</button><button class="primary-button" id="confirm-claim">Send request</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("confirm-claim").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { error } = await supabase.rpc("request_goodfood_donation", {
        requested_donation_id: id,
        request_note: document.getElementById("request-note").value.trim()
      });
      if (error) throw error;
      closeModal();
      await loadWorkspaceData();
      render();
      setToast("Request sent. The donor will review it.");
    } catch (error) {
      button.disabled = false;
      setToast(error.message || "The donation request could not be sent.", true);
    }
  });
}

function openDonationForm() {
  if (!state.profile?.is_verified || !["donor", "individual"].includes(state.role)) {
    setToast("A verified donor account is required to publish food listings.", true);
    return;
  }
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const nowValue = getLocalDateTimeValue(new Date());
  showModal(`<div class="eyebrow">SHARE SURPLUS FOOD</div><h2 id="modal-title">Offer a donation</h2><p class="modal-intro">Only your public display name and city are listed. Your exact pickup instructions stay private until you confirm a request.</p>
    <form id="donation-form"><div class="form-grid">
      <div class="form-field full"><label for="donation-title">What food are you offering? *</label><input id="donation-title" name="title" required maxlength="70" minlength="3" placeholder="e.g. Fresh seasonal produce boxes" /></div>
      <div class="form-field"><label for="donation-category">Category *</label><select id="donation-category" name="category">${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}</select></div>
      <div class="form-field"><label for="donation-quantity">Quantity *</label><input id="donation-quantity" name="quantity" required maxlength="35" placeholder="e.g. 10 boxes" /></div>
      <div class="form-field"><label for="pickup-start">Pickup starts *</label><input id="pickup-start" name="pickupStart" type="datetime-local" required min="${nowValue}" value="${getLocalDateTimeValue(start)}" /></div>
      <div class="form-field"><label for="pickup-end">Pickup ends *</label><input id="pickup-end" name="pickupEnd" type="datetime-local" required min="${getLocalDateTimeValue(start)}" value="${getLocalDateTimeValue(end)}" /></div>
      <div class="form-field full"><label for="donation-description">Food, allergen, and storage details *</label><textarea id="donation-description" name="description" required maxlength="300" placeholder="List ingredients, allergens, and how the food has been stored."></textarea></div>
      <div class="form-field full"><label class="safety-attestation"><input type="checkbox" name="foodSafety" required /> I confirm this food is safe to donate, stored appropriately, and accurately described, including known allergens.</label></div>
    </div><div class="confirm-box">Do not put a private phone number or exact address in the listing. Pickup details are shared with the requesting NGO only after you confirm.</div>
      <div class="modal-actions"><button type="button" class="secondary-button" id="cancel-modal">Cancel</button><button class="primary-button" type="submit">Publish listing</button></div></form>`);
  const startInput = document.getElementById("pickup-start");
  const endInput = document.getElementById("pickup-end");
  startInput.addEventListener("change", () => {
    endInput.min = startInput.value;
    if (endInput.value && endInput.value <= startInput.value) {
      endInput.value = getLocalDateTimeValue(new Date(new Date(startInput.value).getTime() + 60 * 60 * 1000));
    }
  });
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("donation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const submit = formElement.querySelector('[type="submit"]');
    submit.disabled = true;
    const form = new FormData(formElement);
    const pickupStartsAt = new Date(String(form.get("pickupStart"))).getTime();
    const pickupEndsAt = new Date(String(form.get("pickupEnd"))).getTime();
    if (!Number.isFinite(pickupStartsAt) || !Number.isFinite(pickupEndsAt)
        || pickupStartsAt <= Date.now() || pickupEndsAt <= pickupStartsAt
        || pickupEndsAt > pickupStartsAt + 7 * 24 * 60 * 60 * 1000) {
      submit.disabled = false;
      setToast("Choose a future pickup window no longer than seven days.", true);
      return;
    }
    try {
      const { error } = await supabase.from("donations").insert({
        donor_id: state.user.id,
        title: String(form.get("title")).trim(),
        category: String(form.get("category")),
        quantity: String(form.get("quantity")).trim(),
        description: String(form.get("description")).trim(),
        pickup_starts_at: new Date(pickupStartsAt).toISOString(),
        pickup_ends_at: new Date(pickupEndsAt).toISOString(),
        food_safety_confirmed: form.get("foodSafety") === "on",
        status: "available"
      });
      if (error) throw error;
      closeModal();
      await loadWorkspaceData();
      setView("discover");
      setToast("Your food listing is now available to verified local organizations.");
    } catch (error) {
      submit.disabled = false;
      setToast(error.message || "The listing could not be published.", true);
    }
  });
}

function openConfirm(title, message, actionLabel, onConfirm, extraFields = "") {
  showModal(`<div class="eyebrow">CONFIRM ACTION</div><h2 id="modal-title">${escapeHtml(title)}</h2><p class="modal-intro">${escapeHtml(message)}</p>${extraFields}<div class="modal-actions"><button class="secondary-button" id="cancel-modal">Cancel</button><button class="primary-button" id="confirm-action">${escapeHtml(actionLabel)}</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("confirm-action").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await onConfirm();
      closeModal();
      await loadWorkspaceData();
      render();
    } catch (error) {
      button.disabled = false;
      setToast(error.message || "The action could not be completed.", true);
    }
  });
}

function confirmRequest(id) {
  const claim = state.claims.find((request) => request.id === id);
  if (!claim || claim.status !== "Requested") return;
  openConfirm(
    `Confirm "${claim.title}" pickup?`,
    "Private pickup instructions will only be visible to you and the requesting organization.",
    "Confirm request",
    async () => {
      const instructions = document.getElementById("pickup-instructions").value.trim();
      const { error } = await supabase.rpc("respond_to_goodfood_claim", {
        target_claim_id: id,
        response_action: "confirm",
        private_pickup_instructions: instructions
      });
      if (error) throw error;
    },
    `<div class="form-field"><label for="pickup-instructions">Private pickup instructions *</label><textarea id="pickup-instructions" required minlength="5" maxlength="500" placeholder="Share the exact collection point, arrival instructions, and any safe handoff details."></textarea></div>`
  );
}

async function respondToClaim(id, action) {
  try {
    const { error } = await supabase.rpc("respond_to_goodfood_claim", {
      target_claim_id: id,
      response_action: action
    });
    if (error) throw error;
    await loadWorkspaceData();
    render();
    setToast("The request was declined.");
  } catch (error) {
    setToast(error.message || "The request could not be updated.", true);
  }
}

async function completePickup(id) {
  try {
    const { error } = await supabase.rpc("complete_goodfood_pickup", { target_claim_id: id });
    if (error) throw error;
    await loadWorkspaceData();
    render();
    setToast("Pickup marked as collected. Thank you for sharing.");
  } catch (error) {
    setToast(error.message || "The pickup could not be completed.", true);
  }
}

async function withdrawDonation(id) {
  try {
    const { error } = await supabase.rpc("withdraw_goodfood_donation", { target_donation_id: id });
    if (error) throw error;
    await loadWorkspaceData();
    render();
    setToast("The listing was withdrawn.");
  } catch (error) {
    setToast(error.message || "The listing could not be withdrawn.", true);
  }
}

async function reviewMember(id, verified, suspended) {
  try {
    const { error } = await supabase.rpc("review_goodfood_profile", {
      target_profile_id: id,
      profile_verified: verified,
      profile_suspended: suspended
    });
    if (error) throw error;
    await loadWorkspaceData();
    render();
    setToast("Partner account review updated.");
  } catch (error) {
    setToast(error.message || "The account review could not be updated.", true);
  }
}

function moderateDonation(id) {
  openConfirm(
    "Remove this listing?",
    "It will no longer appear in the community feed. Existing request history will be retained.",
    "Remove listing",
    async () => {
      const { error } = await supabase.rpc("moderate_goodfood_donation", { target_donation_id: id });
      if (error) throw error;
    }
  );
}

function toggleSaved(id) {
  state.saved = state.saved.includes(id)
    ? state.saved.filter((savedId) => savedId !== id)
    : [...state.saved, id];
  persistSavedItems();
  render();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("modal-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "modal-backdrop") closeModal();
});
document.getElementById("privacy-link").addEventListener("click", () => {
  showModal(`<div class="eyebrow">PRIVACY BY DESIGN</div><h2 id="modal-title">Connect without oversharing.</h2><p class="modal-intro">Only a public display name, account type, and city are shown to signed-in members. Email addresses and exact pickup details are never exposed in public listings.</p><div class="confirm-box"><strong>1.</strong> Browse available donations.<br><strong>2.</strong> Verified NGOs request food using their organization profile.<br><strong>3.</strong> Donors share exact pickup instructions only after confirming a request.</div><p class="modal-intro">Goodfood uses Supabase for sign-in and shared, policy-protected community data.</p><div class="modal-actions"><button class="primary-button" id="cancel-modal">Got it</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
});
document.getElementById("help-button").addEventListener("click", () => {
  showModal(`<div class="eyebrow">GOODFOOD SUPPORT</div><h2 id="modal-title">Need help?</h2><p class="modal-intro">For food-safety concerns or account support, contact the Goodfood platform administrator using the support contact provided for your community.</p><div class="modal-actions"><button class="primary-button" id="cancel-modal">Close</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
});
document.getElementById("profile-button").addEventListener("click", () => {
  setToast(`${accountName()} · ${state.profile?.city || ""}, ${state.profile?.country || ""}`);
});

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  const isCompleteProfile = mode === "complete-profile";
  document.getElementById("auth-title").textContent = isCompleteProfile ? "Finish your profile" : isRegister ? "Create your account" : "Welcome back";
  document.getElementById("auth-subtitle").textContent = isCompleteProfile
    ? "Choose your account type and community location to continue."
    : isRegister
      ? "Create a separate account for yourself or your organization."
      : "Sign in to your own Goodfood account.";
  document.getElementById("name-field").classList.toggle("hidden", !isRegister && !isCompleteProfile);
  document.getElementById("role-field").classList.toggle("hidden", !isRegister && !isCompleteProfile);
  document.getElementById("location-fields").classList.toggle("hidden", !isRegister && !isCompleteProfile);
  document.getElementById("auth-name").required = isRegister || isCompleteProfile;
  document.getElementById("auth-name").value = isCompleteProfile
    ? state.profile?.display_name || state.user?.user_metadata?.display_name || state.user?.user_metadata?.full_name || ""
    : "";
  document.getElementById("auth-country").required = isRegister || isCompleteProfile;
  document.getElementById("auth-country").value = isCompleteProfile ? state.profile?.country || "India" : "India";
  document.getElementById("auth-city").required = isRegister || isCompleteProfile;
  document.getElementById("auth-city").value = isCompleteProfile ? state.profile?.city || "" : "";
  document.getElementById("auth-email").readOnly = isCompleteProfile;
  document.getElementById("auth-email").value = isCompleteProfile ? state.user?.email || "" : "";
  document.getElementById("auth-email").closest(".form-field").classList.toggle("hidden", isCompleteProfile);
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

async function showAuthenticatedApp(user) {
  if (state.loadingUserId === user.id) return;
  state.loadingUserId = user.id;
  state.user = user;
  try {
    if (!supabase) throw new Error("Supabase is not configured. Add the required VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY settings.");
    const { data: profile, error } = await supabase.from("profiles")
      .select("id,display_name,role,country,city,timezone,is_verified,is_suspended")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile) {
      throw new Error("Goodfood's database is not ready. Apply the Supabase production migration before using the app.");
    }
    state.profile = profile;
    state.role = user.app_metadata?.role === "admin" ? "admin" : profile.role;
    if (profile.is_suspended && state.role !== "admin") {
      state.role = null;
      document.getElementById("app-shell").classList.add("hidden");
      document.getElementById("auth-screen").classList.remove("hidden");
      showAuthError("This account is currently suspended. Contact the platform administrator.");
      return;
    }
    if (!state.role) {
      document.getElementById("app-shell").classList.add("hidden");
      document.getElementById("auth-screen").classList.remove("hidden");
      setAuthMode("complete-profile");
      return;
    }
    state.saved = readSavedItems();
    await loadWorkspaceData();
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-shell").classList.remove("hidden");
    render();
  } catch (error) {
    document.getElementById("app-shell").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
    setAuthMode("login");
    showAuthError(error.message || "Unable to load your Goodfood account.");
  } finally {
    state.loadingUserId = null;
  }
}

function showSignedOut() {
  state.user = null;
  state.profile = null;
  state.role = null;
  state.donations = [];
  state.claims = [];
  state.members = [];
  state.stats = null;
  state.saved = [];
  state.loadingUserId = null;
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
    if (!supabase) throw new Error("Supabase is not configured. Add the required Supabase URL and publishable key.");
    if (state.authMode === "complete-profile") {
      const { data, error } = await supabase.rpc("complete_goodfood_profile", {
        profile_display_name: String(form.get("name")).trim(),
        profile_role: String(form.get("role")),
        profile_country: String(form.get("country")).trim(),
        profile_city: String(form.get("city")).trim(),
        profile_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"
      });
      if (error) throw error;
      state.profile = data;
      state.role = data.role;
      await loadWorkspaceData();
      document.getElementById("auth-screen").classList.add("hidden");
      document.getElementById("app-shell").classList.remove("hidden");
      render();
    } else if (state.authMode === "register") {
      const { data, error } = await supabase.auth.signUp({
        email: String(form.get("email")).trim(),
        password: String(form.get("password")),
        options: {
          data: {
            display_name: String(form.get("name")).trim(),
            role: String(form.get("role")),
            country: String(form.get("country")).trim(),
            city: String(form.get("city")).trim(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"
          },
          emailRedirectTo: window.location.origin
        }
      });
      if (error) throw error;
      formElement.reset();
      if (data.session) {
        await showAuthenticatedApp(data.user);
      } else {
        setAuthMode("login");
        const notice = document.getElementById("auth-error");
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
      await showAuthenticatedApp(data.user);
    }
  } catch (error) {
    showAuthError(error.message || "Unable to complete this account action.");
  } finally {
    submit.disabled = false;
  }
});

document.getElementById("google-sign-in").addEventListener("click", async () => {
  const button = document.getElementById("google-sign-in");
  button.disabled = true;
  try {
    if (!supabase) throw new Error("Supabase is not configured. Add the required Supabase URL and publishable key.");
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

async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) {
    setToast(error.message, true);
    return;
  }
  showSignedOut();
}

document.getElementById("topbar-sign-out").addEventListener("click", signOut);

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      showSignedOut();
    } else if (["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"].includes(event)) {
      queueMicrotask(() => showAuthenticatedApp(session.user));
    }
  });
} else {
  showSignedOut();
  showAuthError("Supabase is not configured. Add the required VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY settings.");
}
