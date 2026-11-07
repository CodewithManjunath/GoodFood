import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const rememberSessionKey = "goodfood-remember-session";
const authStorage = {
  getItem(key) {
    if (localStorage.getItem(rememberSessionKey) === "false") {
      const value = sessionStorage.getItem(key);
      localStorage.removeItem(key);
      return value;
    }
    const value = localStorage.getItem(key);
    if (value !== null) sessionStorage.removeItem(key);
    return value;
  },
  setItem(key, value) {
    if (localStorage.getItem(rememberSessionKey) === "false") {
      sessionStorage.setItem(key, value);
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
      sessionStorage.removeItem(key);
    }
  },
  removeItem(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  }
};
const supabase = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { flowType: "pkce", storage: authStorage } })
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
  needs: [],
  foodNeedsAvailable: false,
  moneyDonations: [],
  manualContributionsEnabled: false,
  manualPaymentInstructions: "",
  manualContributionError: "",
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
let pageMotionObserver = null;
const pageTitles = {
  discover: "Discover food",
  "food-needs": "Food needs",
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
  error.classList.remove("success");
}

function showAuthSuccess(message) {
  const notice = document.getElementById("auth-error");
  notice.textContent = message;
  notice.classList.remove("hidden");
  notice.classList.add("success");
}

function updateShell() {
  document.getElementById("profile-name").textContent = accountName();
  document.querySelector(".avatar").textContent = initials(accountName());
  document.getElementById("topbar-avatar").textContent = initials(accountName());
  document.getElementById("topbar-profile-name").textContent = accountName();
  document.querySelector(".profile-meta small").textContent = roles[state.role] || "Goodfood member";
  document.querySelector(".admin-only").classList.toggle("hidden", state.role !== "admin");
  const activityCount = state.role === "ngo"
    ? state.claims.length
    : state.role === "admin"
      ? state.claims.length
      : state.claims.filter((claim) => claim.donorId === state.user?.id).length;
  document.getElementById("activity-count").textContent = String(activityCount + state.moneyDonations.length);
  document.getElementById("page-label").textContent = pageTitles[state.view] || "Discover food";
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.view);
    const label = item.textContent.trim().replace(/\s+/g, " ");
    item.setAttribute("aria-label", label);
    item.title = label;
    if (item.dataset.view === state.view) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  document.getElementById("app-shell").dataset.role = state.role || "";
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
    needId: row.need_id || null,
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

function needFromRow(row) {
  const ngo = row.ngo || {};
  return {
    id: row.id,
    ngoId: row.ngo_id,
    title: row.title,
    category: row.category,
    quantity: row.quantity,
    description: row.description,
    neededBy: row.needed_by,
    status: row.status,
    createdAt: row.created_at,
    ngoName: ngo.display_name || "Community organization",
    city: ngo.city || "",
    country: ngo.country || ""
  };
}

function moneyDonationFromRow(row) {
  const statuses = {
    submitted: "Awaiting review",
    paid: "Paid — manually verified",
    rejected: "Rejected"
  };
  return {
    id: row.id,
    orderId: row.order_id,
    amountPaise: Number(row.amount_paise),
    verifiedAmountPaise: row.verified_amount_paise == null ? null : Number(row.verified_amount_paise),
    createdAt: row.created_at,
    donorReference: row.donor_reference,
    verifiedReference: row.verified_reference,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    donorName: row.donor?.display_name || null,
    status: statuses[row.status] || "Unknown",
    rawStatus: row.status
  };
}

function formatRupees(amountPaise) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })
    .format(amountPaise / 100);
}

async function loadWorkspaceData() {
  try {
    const configResponse = await fetch("/api/contributions/manual/config");
    if (!configResponse.ok) throw new Error("Manual contribution availability could not be checked.");
    const config = await configResponse.json();
    state.manualContributionsEnabled = config.enabled === true;
    state.manualPaymentInstructions = state.manualContributionsEnabled ? String(config.instructions || "") : "";
    state.manualContributionError = "";
  } catch (error) {
    console.error("Could not load manual contribution instructions.", error);
    state.manualContributionsEnabled = false;
    state.manualPaymentInstructions = "";
    state.manualContributionError = "Manual contributions are temporarily unavailable.";
  }

  const [donationsResult, claimsResult, statsResult, needsResult] = await Promise.all([
    loadDonationRows(),
    supabase.from("claims")
      .select("id,donation_id,donor_id,ngo_id,note,pickup_instructions,status,created_at,recipient:profiles!claims_ngo_id_fkey(display_name),donation:donations!claims_donation_id_fkey(title,quantity,pickup_starts_at,pickup_ends_at,donor:profiles!donations_donor_id_fkey(display_name,timezone))")
      .order("created_at", { ascending: false }),
    supabase.rpc("goodfood_impact_summary"),
    supabase.from("food_needs")
      .select("id,ngo_id,title,category,quantity,description,needed_by,status,created_at,ngo:profiles!food_needs_ngo_id_fkey(display_name,city,country)")
      .order("needed_by", { ascending: true })
  ]);
  if (donationsResult.error) throw donationsResult.error;
  if (claimsResult.error) throw claimsResult.error;
  if (statsResult.error) throw statsResult.error;
  if (needsResult.error && !["42P01", "PGRST205"].includes(needsResult.error.code)) throw needsResult.error;
  if (needsResult.error) {
    console.error("The NGO food-needs migration is not available.", needsResult.error);
  }
  state.donations = donationsResult.data.map(donationFromRow);
  state.claims = claimsResult.data.map(claimFromRow);
  state.needs = needsResult.data?.map(needFromRow) || [];
  state.foodNeedsAvailable = donationsResult.hasNeedId && !needsResult.error;
  state.stats = statsResult.data?.[0] || null;

  state.moneyDonations = [];
  const moneyDonationsResult = await supabase.from("money_donations")
    .select(state.role === "admin"
      ? "id,order_id,amount_paise,status,donor_reference,verified_reference,verified_amount_paise,review_note,reviewed_at,created_at,donor:profiles!money_donations_donor_id_fkey(display_name)"
      : "id,order_id,amount_paise,status,donor_reference,verified_reference,verified_amount_paise,review_note,reviewed_at,created_at")
    .order("created_at", { ascending: false });
  if (moneyDonationsResult.error) {
    if (["42P01", "PGRST205"].includes(moneyDonationsResult.error.code)) {
      console.error("The money donations migration is not available.", moneyDonationsResult.error);
      state.manualContributionsEnabled = false;
      state.manualContributionError = "Manual contributions are unavailable until the contribution database migration is applied.";
    } else {
      throw moneyDonationsResult.error;
    }
  } else {
    state.moneyDonations = moneyDonationsResult.data.map(moneyDonationFromRow);
  }

  if (state.role === "admin") {
    const membersResult = await supabase.from("profiles")
      .select("id,display_name,role,country,city,is_verified,is_suspended,created_at")
      .not("role", "is", null)
      .order("created_at", { ascending: false });
    if (membersResult.error) throw membersResult.error;
    state.members = membersResult.data;
  }
}

async function loadDonationRows() {
  const donationSelect = "id,donor_id,need_id,title,category,quantity,description,pickup_starts_at,pickup_ends_at,status,donor:profiles!donations_donor_id_fkey(display_name,city,country,timezone)";
  const result = await supabase.from("donations").select(donationSelect).order("created_at", { ascending: false });
  if (!result.error) return { ...result, hasNeedId: true };
  if (!["42703", "PGRST204"].includes(result.error.code)) return { ...result, hasNeedId: false };

  console.error("The NGO food-needs migration is not available; loading standard food listings only.", result.error);
  const fallback = await supabase.from("donations")
    .select("id,donor_id,title,category,quantity,description,pickup_starts_at,pickup_ends_at,status,donor:profiles!donations_donor_id_fkey(display_name,city,country,timezone)")
    .order("created_at", { ascending: false });
  return { ...fallback, hasNeedId: false };
}

async function postAuthenticatedJson(path, payload) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error("Your session has expired. Sign in again to continue.");

  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "The payment request could not be completed.");
  return result;
}

async function submitManualContribution(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  submit.disabled = true;
  try {
    await postAuthenticatedJson("/api/contributions/manual/submit", {
      amount: String(formData.get("amount")),
      donorReference: String(formData.get("donorReference"))
    });
    await loadWorkspaceData();
    render();
    setToast("Transfer submitted for manual review. It will show as paid only after an administrator checks the bank statement.");
  } catch (error) {
    console.error("Could not submit manual contribution.", error);
    setToast(error.message || "Could not submit the transfer for review.", true);
  } finally {
    submit.disabled = false;
  }
}

async function reviewManualContribution(id, status) {
  try {
    const form = document.getElementById("manual-review-form");
    const formData = new FormData(form);
    await postAuthenticatedJson("/api/contributions/manual/review", {
      id,
      status,
      verifiedReference: String(formData.get("verifiedReference") || ""),
      verifiedAmount: String(formData.get("verifiedAmount") || ""),
      reviewNote: String(formData.get("reviewNote") || "")
    });
    closeModal();
    await loadWorkspaceData();
    render();
    setToast(status === "paid" ? "Contribution marked paid after manual bank-statement review." : "Contribution marked rejected.");
    return true;
  } catch (error) {
    console.error("Could not save manual contribution review.", error);
    setToast(error.message || "Could not save the contribution review.", true);
    return false;
  }
}

function openManualContributionReview(id) {
  const contribution = state.moneyDonations.find((item) => item.id === id);
  if (!contribution || contribution.rawStatus !== "submitted" || state.role !== "admin") return;
  showModal(`<div class="eyebrow">MANUAL BANK REVIEW</div><h2 id="modal-title">Review contribution</h2>
    <p class="modal-intro">Compare the donor’s amount and transfer reference with the official bank statement outside GoodFood. A submitted reference is not proof of payment.</p>
    <div class="confirm-box"><strong>${escapeHtml(formatRupees(contribution.amountPaise))}</strong><br>Donor reference: ${escapeHtml(contribution.donorReference)}<br>Submission: ${escapeHtml(new Date(contribution.createdAt).toLocaleString())}</div>
    <form id="manual-review-form"><div class="form-field"><label for="verified-reference">Reference from bank statement (required to mark paid)</label><input id="verified-reference" name="verifiedReference" maxlength="120" value="${escapeHtml(contribution.donorReference)}" /></div>
      <div class="form-field"><label for="verified-amount">Amount shown in bank statement (INR)</label><input id="verified-amount" name="verifiedAmount" type="number" min="1.00" max="999999999.99" step="0.01" inputmode="decimal" /></div>
      <div class="form-field"><label for="review-note">Review note (required)</label><textarea id="review-note" name="reviewNote" required minlength="5" maxlength="1000" placeholder="Record what statement entry you checked, without adding sensitive account details."></textarea></div>
      <div class="modal-actions"><button type="button" class="secondary-button" id="cancel-modal">Cancel</button><button type="button" class="secondary-button" id="reject-contribution">Reject</button><button type="submit" class="primary-button">Mark paid</button></div></form>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("reject-contribution").addEventListener("click", async (event) => {
    const form = document.getElementById("manual-review-form");
    if (!form.reportValidity()) return;
    const button = event.currentTarget;
    button.disabled = true;
    if (!await reviewManualContribution(id, "rejected")) button.disabled = false;
  });
  document.getElementById("manual-review-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    document.getElementById("verified-reference").required = true;
    document.getElementById("verified-amount").required = true;
    if (!event.currentTarget.reportValidity()) return;
    const button = event.currentTarget.querySelector('[type="submit"]');
    button.disabled = true;
    if (!await reviewManualContribution(id, "paid")) button.disabled = false;
  });
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

function dashboardStatsMarkup() {
  if (state.role === "ngo") {
    const ownClaims = state.claims.filter((claim) => claim.ngoId === state.user.id);
    const openNeeds = state.needs.filter((need) =>
      need.ngoId === state.user.id && need.status === "open" && new Date(need.neededBy).getTime() > Date.now()
    ).length;
    const metrics = [
      ["Open food needs", openNeeds, "Requests shared with verified donors"],
      ["Pending requests", ownClaims.filter((claim) => claim.status === "Requested").length, "Waiting for donor response"],
      ["Confirmed pickups", ownClaims.filter((claim) => claim.status === "Confirmed").length, "Ready for collection"],
      ["Pickups completed", ownClaims.filter((claim) => claim.status === "Collected").length, "Successful food handoffs"]
    ];
    return `<section class="dashboard-stats" aria-label="Organization activity">${metrics.map(([label, count, note]) => `<article class="stat-card"><span>${label}</span><strong data-count-up="${count}">${count}</strong><small>${note}</small></article>`).join("")}</section>`;
  }
  if (state.role === "donor" || state.role === "individual") {
    const ownDonations = state.donations.filter((donation) => donation.donorId === state.user.id);
    const ownClaims = state.claims.filter((claim) => claim.donorId === state.user.id);
    const metrics = [
      ["Food listings", ownDonations.length, "Shared with the community"],
      ["Active listings", ownDonations.filter((donation) => donation.status === "Available").length, "Open for pickup requests"],
      ["Requests to review", ownClaims.filter((claim) => claim.status === "Requested").length, "Waiting for your response"],
      ["Pickups completed", ownClaims.filter((claim) => claim.status === "Collected").length, "Successful food handoffs"]
    ];
    return `<section class="dashboard-stats" aria-label="Your donation activity">${metrics.map(([label, count, note]) => `<article class="stat-card"><span>${label}</span><strong data-count-up="${count}">${count}</strong><small>${note}</small></article>`).join("")}</section>`;
  }
  return "";
}

function discoverView() {
  const isDonor = state.role === "donor" || state.role === "individual";
  const available = state.donations.filter((item) =>
    !item.needId && item.status === "Available" && new Date(item.pickupEndsAt).getTime() > Date.now()
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
      ${dashboardStatsMarkup()}
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

function foodNeedsView() {
  const isNGO = state.role === "ngo";
  const isDonor = ["donor", "individual"].includes(state.role);
  const now = Date.now();
  const needs = state.needs.filter((need) =>
    need.ngoId === state.user.id || (need.status === "open" && new Date(need.neededBy).getTime() > now)
  );
  const cards = needs.map((need) => {
    const ownNeed = isNGO && need.ngoId === state.user.id;
    const offers = ownNeed
      ? state.donations.filter((donation) => donation.needId === need.id)
      : [];
    const status = need.status === "open" && new Date(need.neededBy).getTime() <= now
      ? "Expired"
      : statusLabel(need.status);
    return `<article class="need-card">
      <div class="need-card-header"><span class="food-tag">${escapeHtml(need.category)}</span><span class="status-pill">${escapeHtml(status)}</span></div>
      <h2>${escapeHtml(need.title)}</h2>
      <p class="need-org">${escapeHtml(need.ngoName)} · ${escapeHtml(need.city || need.country || "Community")}</p>
      <div class="card-meta"><span>▣ Needs ${escapeHtml(need.quantity)}</span><span>◷ By ${escapeHtml(new Date(need.neededBy).toLocaleString())}</span></div>
      <p class="need-description">${escapeHtml(need.description)}</p>
      ${ownNeed ? `<div class="need-offers"><strong>Food offers (${offers.length})</strong>${offers.length ? offers.map((offer) => `<div class="need-offer-row"><span><strong>${escapeHtml(offer.title)}</strong><small>${escapeHtml(offer.quantity)} · ${escapeHtml(offer.donor)} · ${escapeHtml(offer.status)}</small></span>${state.foodNeedsAvailable && need.status === "open" && offer.status === "Available" ? `<button class="claim-button" data-need-claim="${escapeHtml(offer.id)}">Request pickup</button>` : ""}</div>`).join("") : `<p class="need-empty">No donors have offered food yet.</p>`}</div>
        ${need.status === "open" ? `<button class="secondary-button close-need-button" data-close-need="${escapeHtml(need.id)}">Close request</button>` : ""}`
        : isDonor && state.foodNeedsAvailable && state.profile?.is_verified && need.status === "open"
          ? `<button class="primary-button need-offer-button" data-need-offer="${escapeHtml(need.id)}">Offer food for this need</button>`
          : ""}
    </article>`;
  });

  root.innerHTML = `<div class="page-wrap">
    <div class="welcome-row"><div><div class="eyebrow">${isNGO ? "COMMUNITY FOOD REQUESTS" : "HELP FILL A COMMUNITY NEED"}</div><h1>Food needs</h1><p class="subtitle">${isNGO ? "Post what your organization needs and review offers from verified donors." : "Verified food donors can respond directly to an organization's current need."}</p></div>
      ${isNGO && state.profile?.is_verified && state.foodNeedsAvailable ? `<button class="primary-button" id="post-food-need"><span>＋</span> Post a food need</button>` : ""}
    </div>
    ${!state.foodNeedsAvailable ? `<div class="confirm-box verification-notice"><strong>Food-needs board not set up yet.</strong> The platform administrator must apply the NGO food-needs database migration before this feature can be used. Existing food listings remain available.</div>` : ""}
    ${isNGO && !state.profile?.is_verified ? `<div class="confirm-box verification-notice"><strong>Account verification required.</strong> An administrator must verify your organization before it can post a food need.</div>` : ""}
    ${isDonor && !state.profile?.is_verified ? `<div class="confirm-box verification-notice"><strong>Account verification required.</strong> An administrator must verify your donor account before it can offer food.</div>` : ""}
    <div class="hero-card"><div class="hero-symbol">✳</div><div class="hero-copy"><strong>Requests connect need with supply.</strong><p>Food offered for a request is shared only with that organization. The NGO reviews an offer and requests pickup; the donor still confirms the handoff.</p></div></div>
    <div class="need-grid">${cards.length ? cards.join("") : `<div class="empty-state"><span>＋</span><strong>${isNGO ? "No food needs posted yet" : "No open food needs right now"}</strong><p>${isNGO ? "Post a clear request so verified donors can respond." : "Check back soon for requests from local organizations."}</p></div>`}</div>
  </div>`;

  document.getElementById("post-food-need")?.addEventListener("click", openFoodNeedForm);
  root.querySelectorAll("[data-need-offer]").forEach((button) => {
    button.addEventListener("click", () => openDonationForm(button.dataset.needOffer));
  });
  root.querySelectorAll("[data-need-claim]").forEach((button) => {
    button.addEventListener("click", () => openClaim(button.dataset.needClaim));
  });
  root.querySelectorAll("[data-close-need]").forEach((button) => {
    button.addEventListener("click", () => closeFoodNeed(button.dataset.closeNeed));
  });
}

function openFoodNeedForm() {
  if (state.role !== "ngo" || !state.profile?.is_verified) {
    setToast("A verified NGO account is required to post a food need.", true);
    return;
  }
  const now = new Date();
  const min = new Date(now.getTime() + 60 * 60 * 1000);
  const max = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  showModal(`<div class="eyebrow">REQUEST FOOD</div><h2 id="modal-title">Post an organization need</h2><p class="modal-intro">Verified food donors can view this request and offer food. Keep addresses and personal contact details private.</p>
    <form id="food-need-form"><div class="form-grid">
      <div class="form-field full"><label for="need-title">What food does your organization need? *</label><input id="need-title" name="title" required minlength="3" maxlength="70" placeholder="e.g. Fresh vegetables for family meal kits" /></div>
      <div class="form-field"><label for="need-category">Category *</label><select id="need-category" name="category">${categories.map((category) => `<option>${escapeHtml(category)}</option>`).join("")}</select></div>
      <div class="form-field"><label for="need-quantity">Quantity needed *</label><input id="need-quantity" name="quantity" required maxlength="35" placeholder="e.g. 20 meal portions" /></div>
      <div class="form-field full"><label for="need-by">Needed by *</label><input id="need-by" name="neededBy" type="datetime-local" required min="${getLocalDateTimeValue(min)}" max="${getLocalDateTimeValue(max)}" value="${getLocalDateTimeValue(min)}" /></div>
      <div class="form-field full"><label for="need-description">Details and constraints *</label><textarea id="need-description" name="description" required maxlength="300" placeholder="Share relevant dietary, storage, or collection needs. Do not include private contact details."></textarea></div>
    </div><div class="modal-actions"><button type="button" class="secondary-button" id="cancel-modal">Cancel</button><button type="submit" class="primary-button">Post food need</button></div></form>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("food-need-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    const data = new FormData(form);
    const neededBy = new Date(String(data.get("neededBy")));
    if (!Number.isFinite(neededBy.getTime()) || neededBy <= new Date() || neededBy > new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)) {
      submit.disabled = false;
      setToast("Choose a need-by date within the next 30 days.", true);
      return;
    }
    try {
      const { error } = await supabase.rpc("create_goodfood_need", {
        need_title: String(data.get("title")).trim(),
        need_category: String(data.get("category")),
        need_quantity: String(data.get("quantity")).trim(),
        need_description: String(data.get("description")).trim(),
        need_by: neededBy.toISOString()
      });
      if (error) throw error;
      closeModal();
      await loadWorkspaceData();
      render();
      setToast("Your food need is now visible to verified donors.");
    } catch (error) {
      submit.disabled = false;
      setToast(error.message || "The food need could not be posted.", true);
    }
  });
}

function closeFoodNeed(id) {
  openConfirm(
    "Close this food request?",
    "Donors will no longer be able to offer food for this need. Resolve active pickup requests first.",
    "Close request",
    async () => {
      const { error } = await supabase.rpc("close_goodfood_need", { target_need_id: id });
      if (error) throw error;
      setToast("The food request was closed.");
    }
  );
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
  const moneyDonations = state.moneyDonations.map((item) => ({
    id: item.id,
    orderId: item.orderId,
    icon: "₹",
    title: formatRupees(item.amountPaise),
    subtitle: `Contribution to GoodFood operations · Reference ${item.donorReference} · ${new Date(item.createdAt).toLocaleString()}`,
    note: item.reviewNote,
    status: item.status,
    isMoneyDonation: true
  }));
  const items = state.role === "ngo"
    ? [...claims.map((claim) => ({ ...claim, icon: "🥬", subtitle: `Offered by ${claim.donor} · ${claim.pickup}`, isRequest: true })), ...moneyDonations]
    : [...claims.map((claim) => ({
      ...claim,
      icon: "↗",
      subtitle: `Requested by ${claim.recipient} · ${claim.pickup}`,
      isRequest: true
    })), ...donations, ...moneyDonations];
  root.innerHTML = `<div class="page-wrap"><div class="welcome-row"><div><div class="eyebrow">YOUR GOODFOOD</div><h1>My activity</h1><p class="subtitle">Keep track of your donations and pickup requests.</p></div>${["donor", "individual"].includes(state.role) && state.profile?.is_verified ? `<button class="primary-button" id="add-donation"><span>＋</span> Donate food</button>` : ""}</div>
    <div class="activity-list">${items.length ? items.map((item) => `<div class="activity-row"><span class="activity-icon">${escapeHtml(item.icon)}</span><span class="activity-text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subtitle)}${item.note ? `<br>Note: ${escapeHtml(item.note)}` : ""}${item.status === "Confirmed" && item.pickupInstructions ? `<br><strong>Private pickup instructions:</strong> ${escapeHtml(item.pickupInstructions)}` : ""}</small></span>${item.isMoneyDonation && item.status === "Awaiting review" && state.role === "admin" ? `<button class="table-action" data-review-contribution="${escapeHtml(item.id)}">Review</button>` : item.isDonation && item.status === "Available" ? `<button class="table-action" data-withdraw-donation="${escapeHtml(item.id)}">Withdraw</button>` : item.isRequest && item.status === "Requested" && state.role !== "ngo" ? `<button class="claim-button" data-confirm-request="${escapeHtml(item.id)}">Review request</button><button class="secondary-button" data-decline-request="${escapeHtml(item.id)}">Decline</button>` : item.isRequest && item.status === "Confirmed" && state.role === "ngo" ? `<button class="claim-button" data-complete-request="${escapeHtml(item.id)}">Mark collected</button>` : `<span class="status-pill">${escapeHtml(item.status)}</span>`}</div>`).join("") : `<div class="empty-state"><span>▤</span><strong>Nothing here just yet</strong><p>Your requests and donations will show up here.</p></div>`}</div></div>`;
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
  root.querySelectorAll("[data-review-contribution]").forEach((button) => {
    button.addEventListener("click", () => openManualContributionReview(button.dataset.reviewContribution));
  });
}

function impactView() {
  const stats = state.stats || { total_donations: 0, collected_pickups: 0, available_donations: 0 };
  root.innerHTML = `<div class="page-wrap"><div class="eyebrow">LOCAL GOOD, ADDED UP</div><h1>Community impact</h1><p class="subtitle">Live totals from confirmed activity on Goodfood.</p>
    <div class="stats-grid"><div class="stat-card"><span>Total listings</span><strong data-count-up="${Number(stats.total_donations)}">${Number(stats.total_donations)}</strong><small>Listings not withdrawn</small></div><div class="stat-card"><span>Pickups completed</span><strong data-count-up="${Number(stats.collected_pickups)}">${Number(stats.collected_pickups)}</strong><small>Confirmed handoffs</small></div><div class="stat-card"><span>Available now</span><strong data-count-up="${Number(stats.available_donations)}">${Number(stats.available_donations)}</strong><small>Current listings with open pickup windows</small></div></div>
    <div class="hero-card"><div class="hero-symbol">✳</div><div class="hero-copy"><strong>Small acts make a real difference.</strong><p>Impact numbers count listings and pickups; food quantities and environmental effects are not independently verified.</p></div></div>
    <section class="money-donation-card" aria-labelledby="money-donation-title"><div class="eyebrow">SUPPORT THE PLATFORM</div><h2 id="money-donation-title">Make a money contribution</h2><p class="subtitle">Contributions support GoodFood operations and are not directed to a specific NGO. Transfers are reviewed manually; there is no payment gateway or automatic settlement confirmation.</p>
      ${state.manualContributionsEnabled ? `<div class="confirm-box money-payment-instructions"><strong>Payment instructions</strong><br><span>${escapeHtml(state.manualPaymentInstructions)}</span></div><p class="money-donation-note">Transfer the amount using the instructions above, then submit the reference shown by your payment app. Do not submit until the transfer is complete. An administrator will compare the amount and reference against the bank statement. Only then can it be marked paid.</p>
      <form id="money-donation-form" class="money-donation-form manual-contribution-form"><div class="form-field"><label for="money-donation-amount">Amount (INR)</label><input id="money-donation-amount" name="amount" type="number" min="1.00" max="999999999.99" step="0.01" inputmode="decimal" placeholder="e.g. 250.00" required /></div><div class="form-field"><label for="donor-reference">UPI / bank transfer reference</label><input id="donor-reference" name="donorReference" type="text" minlength="3" maxlength="120" autocomplete="off" placeholder="Reference/UTR from your payment app" required /></div><button class="primary-button" type="submit">Submit for review</button></form><p class="money-donation-note">Do not enter passwords, PINs, account numbers, or card details. GoodFood does not currently issue tax-deductible receipts.</p>` : `<div class="confirm-box">${escapeHtml(state.manualContributionError || "Manual contributions are not configured yet. Please check back later.")}</div>`}
    </section></div>`;
  document.getElementById("money-donation-form")?.addEventListener("submit", submitManualContribution);
}

function adminView() {
  if (state.role !== "admin") {
    state.view = "discover";
    return discoverView();
  }
  root.innerHTML = `<div class="page-wrap"><div class="eyebrow">PLATFORM MANAGEMENT</div><h1>Admin console</h1><p class="subtitle">Review partner accounts and moderate food listings. Confirm verification using your organization’s documented checks before approving access.</p>
    <div class="stats-grid"><div class="stat-card"><span>Active listings</span><strong data-count-up="${state.donations.filter((item) => item.status === "Available").length}">${state.donations.filter((item) => item.status === "Available").length}</strong><small>Accepting requests</small></div><div class="stat-card"><span>Pending requests</span><strong data-count-up="${state.claims.filter((item) => item.status === "Requested").length}">${state.claims.filter((item) => item.status === "Requested").length}</strong><small>Awaiting donor decision</small></div><div class="stat-card"><span>Partners</span><strong data-count-up="${state.members.length}">${state.members.length}</strong><small>Registered accounts</small></div></div>
    <div class="section-heading"><div><h2>Partner verification</h2><p>Unverified accounts cannot publish or request food.</p></div></div>
    <div class="activity-list">${state.members.length ? state.members.map((member) => `<div class="activity-row"><span class="activity-text"><strong>${escapeHtml(member.display_name)}</strong><small>${escapeHtml(roles[member.role] || member.role)} · ${escapeHtml(member.city)}, ${escapeHtml(member.country)}${member.is_suspended ? " · Suspended" : ""}</small></span><span class="status-pill">${member.is_verified ? "Verified" : "Pending review"}</span><button class="table-action" data-review-profile="${escapeHtml(member.id)}" data-verified="${member.is_verified}" data-suspended="${member.is_suspended}">${member.is_verified ? "Revoke verification" : "Verify"}</button><button class="table-action" data-suspend-profile="${escapeHtml(member.id)}" data-suspended="${member.is_suspended}">${member.is_suspended ? "Restore" : "Suspend"}</button></div>`).join("") : `<div class="empty-state"><strong>No partner accounts yet</strong></div>`}</div>
    <div class="section-heading"><div><h2>Donation listings</h2><p>Remove unsafe, expired, or inappropriate offers.</p></div></div>
    <div class="activity-list">${state.donations.length ? state.donations.map((item) => `<div class="activity-row"><span class="activity-text"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.donor)} · ${escapeHtml(item.city)} · ${escapeHtml(item.quantity)} · ${escapeHtml(item.status)}</small></span>${item.status !== "Withdrawn" && item.status !== "Collected" ? `<button class="table-action" data-admin-remove="${escapeHtml(item.id)}">Remove listing</button>` : `<span class="status-pill">${escapeHtml(item.status)}</span>`}</div>`).join("") : `<div class="empty-state"><strong>No listings to review</strong></div>`}</div>
    <div class="section-heading"><div><h2>Manual money contributions</h2><p>Compare submitted amounts and references with the official bank statement before deciding. Never mark paid based only on the donor’s submission.</p></div></div>
    <div class="activity-list">${state.moneyDonations.length ? state.moneyDonations.map((item) => `<div class="activity-row"><span class="activity-text"><strong>${escapeHtml(formatRupees(item.amountPaise))} · ${escapeHtml(item.donorName || "GoodFood member")}</strong><small>Submitted ${escapeHtml(new Date(item.createdAt).toLocaleString())} · Donor reference: ${escapeHtml(item.donorReference)}${item.reviewNote ? `<br>Review note: ${escapeHtml(item.reviewNote)}` : ""}${item.verifiedReference ? `<br>Bank statement reference: ${escapeHtml(item.verifiedReference)}` : ""}${item.verifiedAmountPaise !== null && item.verifiedAmountPaise !== undefined ? `<br>Bank statement amount: ${escapeHtml(formatRupees(item.verifiedAmountPaise))}` : ""}</small></span>${item.rawStatus === "submitted" ? `<button class="table-action" data-review-contribution="${escapeHtml(item.id)}">Review</button>` : `<span class="status-pill">${escapeHtml(item.status)}</span>`}</div>`).join("") : `<div class="empty-state"><strong>No contributions submitted</strong></div>`}</div>
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
  root.querySelectorAll("[data-review-contribution]").forEach((button) => {
    button.addEventListener("click", () => openManualContributionReview(button.dataset.reviewContribution));
  });
}

function render() {
  updateShell();
  if (state.view === "food-needs") foodNeedsView();
  else if (state.view === "my-activity") activityView();
  else if (state.view === "impact") impactView();
  else if (state.view === "admin") adminView();
  else discoverView();
  initializePageMotion();
}

function initializePageMotion() {
  pageMotionObserver?.disconnect();
  const targets = root.querySelectorAll(".hero-card, .donation-card, .need-card, .stat-card, .activity-row, .money-donation-card");
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
    targets.forEach((element) => {
      element.classList.add("motion-reveal", "is-visible");
      const counter = element.querySelector("[data-count-up]");
      if (counter) counter.textContent = counter.dataset.countUp;
    });
    return;
  }

  pageMotionObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      const counter = entry.target.querySelector("[data-count-up]");
      if (counter) animateCountUp(counter);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  targets.forEach((element) => {
    element.classList.add("motion-reveal");
    pageMotionObserver.observe(element);
  });
}

function animateCountUp(element) {
  const target = Number(element.dataset.countUp);
  if (!Number.isFinite(target) || target <= 0) {
    element.textContent = "0";
    return;
  }
  const duration = 650;
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = String(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
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

function openDonationForm(needId = null) {
  if (!state.profile?.is_verified || !["donor", "individual"].includes(state.role)) {
    setToast("A verified donor account is required to publish food listings.", true);
    return;
  }
  const need = needId ? state.needs.find((item) => item.id === needId && item.status === "open") : null;
  if (needId && !need) {
    setToast("This food need is no longer open.", true);
    return;
  }
  const start = new Date(Date.now() + 60 * 60 * 1000);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const nowValue = getLocalDateTimeValue(new Date());
  showModal(`<div class="eyebrow">SHARE SURPLUS FOOD</div><h2 id="modal-title">${need ? `Offer food for ${escapeHtml(need.ngoName)}` : "Offer a donation"}</h2><p class="modal-intro">${need ? `This offer will be visible only to ${escapeHtml(need.ngoName)}. They can request pickup if the food meets their need.` : "Only your public display name and city are listed. Your exact pickup instructions stay private until you confirm a request."}</p>
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
        status: "available",
        need_id: need?.id || null
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
  showModal(`<div class="eyebrow">PRIVACY BY DESIGN</div><h2 id="modal-title">Connect without oversharing.</h2><p class="modal-intro">Only a public display name, account type, and city are shown to signed-in members. Email addresses and exact pickup details are never exposed in public listings.</p><div class="confirm-box"><strong>1.</strong> Browse available donations or open NGO food needs.<br><strong>2.</strong> Verified NGOs can request listed food or post a need for donors.<br><strong>3.</strong> Donors share exact pickup instructions only after confirming a request.</div><p class="modal-intro">Goodfood uses Supabase for sign-in and shared, policy-protected community data.</p><div class="modal-actions"><button class="primary-button" id="cancel-modal">Got it</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
});
document.getElementById("help-button").addEventListener("click", () => {
  showModal(`<div class="eyebrow">GOODFOOD SUPPORT</div><h2 id="modal-title">Need help?</h2><p class="modal-intro">For food-safety concerns or account support, contact the Goodfood platform administrator using the support contact provided for your community.</p><div class="modal-actions"><button class="primary-button" id="cancel-modal">Close</button></div>`);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
});
document.getElementById("profile-button").addEventListener("click", () => {
  setToast(`${accountName()} · ${state.profile?.city || ""}, ${state.profile?.country || ""}`);
});
document.getElementById("topbar-profile").addEventListener("click", () => {
  setToast(`${accountName()} · ${state.profile?.city || ""}, ${state.profile?.country || ""}`);
});

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  const isCompleteProfile = mode === "complete-profile";
  const isRecovery = mode === "recover-password";
  const isPasswordUpdate = mode === "update-password";
  const isRecoveryFlow = isRecovery || isPasswordUpdate;
  document.getElementById("auth-eyebrow").textContent = isCompleteProfile
    ? "ONE LAST STEP"
    : isRecoveryFlow
      ? "ACCOUNT RECOVERY"
      : isRegister
        ? "JOIN THE GOODFOOD COMMUNITY"
        : "YOUR COMMUNITY FOOD NETWORK";
  document.getElementById("auth-title").textContent = isCompleteProfile
    ? "Finish your profile"
    : isRegister
      ? "Create your account"
      : isRecovery
        ? "Reset your password"
        : isPasswordUpdate
          ? "Choose a new password"
          : "Welcome back";
  document.getElementById("auth-subtitle").textContent = isCompleteProfile
    ? "Choose your account type and community location to continue."
    : isRegister
      ? "Create a separate account for yourself or your organization."
      : isRecovery
        ? "We’ll email you a secure link to reset your password."
        : isPasswordUpdate
          ? "Choose a new password to secure your Goodfood account."
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
  document.getElementById("auth-email").readOnly = isCompleteProfile || isPasswordUpdate;
  if (isCompleteProfile) document.getElementById("auth-email").value = state.user?.email || "";
  document.getElementById("auth-email").closest(".form-field").classList.toggle("hidden", isCompleteProfile || isPasswordUpdate);
  document.getElementById("password-field").classList.toggle("hidden", isCompleteProfile || isRecovery);
  document.getElementById("auth-password").required = !isCompleteProfile && !isRecovery;
  document.getElementById("auth-password").autocomplete = isRegister || isPasswordUpdate ? "new-password" : "current-password";
  document.getElementById("auth-password").placeholder = isPasswordUpdate ? "Choose a new password" : "Enter your password";
  document.querySelector("#password-field > .label-row > label").textContent = isPasswordUpdate ? "New password" : "Password";
  document.getElementById("password-hint").classList.toggle("hidden", !isRegister);
  document.getElementById("auth-password").minLength = isRegister || isPasswordUpdate ? 10 : 1;
  document.getElementById("toggle-password").classList.toggle("hidden", isCompleteProfile || isRecovery);
  document.getElementById("forgot-password").classList.toggle("hidden", state.authMode !== "login");
  document.getElementById("auth-options").classList.toggle("hidden", isCompleteProfile || isRecoveryFlow);
  document.getElementById("remember-session").checked = localStorage.getItem(rememberSessionKey) !== "false";
  document.getElementById("auth-submit-label").textContent = isCompleteProfile
    ? "Save profile"
    : isRegister
      ? "Create account"
      : isRecovery
        ? "Send reset link"
        : isPasswordUpdate
          ? "Update password"
          : "Sign in";
  document.getElementById("auth-switch").closest(".auth-switch").classList.toggle("hidden", isCompleteProfile);
  document.getElementById("google-sign-in").classList.toggle("hidden", isCompleteProfile || isRecoveryFlow);
  document.querySelector(".auth-divider").classList.toggle("hidden", isCompleteProfile || isRecoveryFlow);
  document.querySelector(".auth-admin-note").classList.toggle("hidden", isCompleteProfile);
  document.getElementById("auth-switch-prompt").textContent = isRecoveryFlow
    ? "Remembered your password?"
    : isRegister
      ? "Already registered?"
      : "New to Goodfood?";
  document.getElementById("auth-switch").textContent = isRecoveryFlow || isRegister ? "Back to sign in" : "Create an account";
  document.getElementById("auth-error").classList.add("hidden");
  document.getElementById("auth-error").classList.remove("success");
  document.getElementById("auth-card").classList.remove("auth-card-enter");
  requestAnimationFrame(() => document.getElementById("auth-card").classList.add("auth-card-enter"));
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
  state.moneyDonations = [];
  state.manualContributionsEnabled = false;
  state.manualPaymentInstructions = "";
  state.manualContributionError = "";
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

document.getElementById("forgot-password").addEventListener("click", () => {
  setAuthMode("recover-password");
});

document.getElementById("remember-session").addEventListener("change", (event) => {
  localStorage.setItem(rememberSessionKey, event.currentTarget.checked ? "true" : "false");
});

document.getElementById("toggle-password").addEventListener("click", (event) => {
  const input = document.getElementById("auth-password");
  const button = event.currentTarget;
  const showPassword = input.type === "password";
  input.type = showPassword ? "text" : "password";
  button.textContent = showPassword ? "Hide" : "Show";
  button.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
  button.setAttribute("aria-pressed", String(showPassword));
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
    if (state.authMode === "recover-password") {
      const { error } = await supabase.auth.resetPasswordForEmail(String(form.get("email")).trim(), {
        redirectTo: window.location.origin
      });
      if (error) throw error;
      setAuthMode("login");
      showAuthSuccess("If an account exists for that email, a secure password reset link is on its way.");
    } else if (state.authMode === "update-password") {
      const { error } = await supabase.auth.updateUser({ password: String(form.get("password")) });
      if (error) throw error;
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      setAuthMode("login");
      showAuthSuccess("Password updated. Sign in with your new password.");
    } else if (state.authMode === "complete-profile") {
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
    if (event === "PASSWORD_RECOVERY" && session) {
      queueMicrotask(() => {
        document.getElementById("auth-screen").classList.remove("hidden");
        document.getElementById("app-shell").classList.add("hidden");
        setAuthMode("update-password");
      });
    } else if (event === "SIGNED_OUT" || !session) {
      showSignedOut();
    } else if (["INITIAL_SESSION", "SIGNED_IN", "USER_UPDATED", "TOKEN_REFRESHED"].includes(event)) {
      queueMicrotask(() => showAuthenticatedApp(session.user));
    }
  });
} else {
  showSignedOut();
  showAuthError("Supabase is not configured. Add the required VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY settings.");
}
