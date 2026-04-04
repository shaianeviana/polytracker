// ─── TYPES ───
interface ActivityEntry {
  conditionId?: string;
  title?: string;
  slug?: string;
  icon?: string;
  usdcSize?: string;
  size?: string;
  side?: string;
  outcome?: string;
  price?: string;
  type?: string;
}

interface TradeEntry {
  usdc: number;
  tokens: number;
  side: string;
  outcome: string;
  price: number;
}

interface MarketAccumulator {
  title: string;
  slug: string;
  icon: string;
  buys: TradeEntry[];
  sells: TradeEntry[];
  redeems: TradeEntry[];
}

type Outcome = "WIN" | "LOSS" | "OPEN";

interface Result {
  market: string;
  slug: string;
  icon: string;
  side: string;
  invested: number;
  sold: number;
  redeemed: number;
  pnl: number;
  outcome: Outcome;
}

interface CategoryData {
  emoji: string;
  wins: number;
  losses: number;
  pnl: number;
  invested: number;
  count: number;
}

interface CategoryInfo {
  cat: string;
  emoji: string;
}

interface ProfileData {
  volume?: number;
  [key: string]: unknown;
}

// ─── STATE ───
const PER_PAGE = 30;
let allResults: Result[] = [];
let profileData: ProfileData = {};
let rawVolume = 0;
let currentFilter = "all";
let currentSearch = "";
let sortKey = "pnl";
let sortDir = -1;
let currentPage = 1;
let currentWallet: string | null = null;

// ─── ROUTING ───
function getWalletFromURL(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("wallet") || params.get("w") || null;
}

function setWalletURL(wallet: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("wallet", wallet);
  window.history.pushState({}, "", url);
}

function goHome(): void {
  window.history.pushState({}, "", window.location.pathname);
  currentWallet = null;
  allResults = [];
  renderLanding();
  updateHeader();
  document.body.classList.add("on-landing");
}

window.addEventListener("popstate", () => {
  const w = getWalletFromURL();
  if (w && /^0x[a-fA-F0-9]{40}$/.test(w)) {
    loadWallet(w);
  } else {
    goHome();
  }
});

// ─── API ───
function apiUrl(wallet: string, type = "activity", offset = 0, limit = 500): string {
  const isVercel =
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";
  if (isVercel) return `/api/data?wallet=${wallet}&type=${type}&offset=${offset}&limit=${limit}`;
  return `https://data-api.polymarket.com/${
    type === "activity" ? "activity" : type === "profile" ? "profile" : "positions"
  }?user=${wallet}&limit=${limit}&offset=${offset}${type === "positions" ? "&sizeThreshold=0" : ""}`;
}

async function fetchAllActivity(wallet: string): Promise<ActivityEntry[]> {
  let all: ActivityEntry[] = [];
  let offset = 0;
  const limit = 500;
  while (true) {
    const res = await fetch(apiUrl(wallet, "activity", offset, limit));
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string; details?: string };
      const msg = body.error || `API returned ${res.status}`;
      throw new Error(msg);
    }
    const batch: ActivityEntry[] = await res.json();
    if (!batch || !Array.isArray(batch) || batch.length === 0) break;
    all = all.concat(batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

async function fetchProfile(wallet: string): Promise<ProfileData> {
  try {
    const res = await fetch(apiUrl(wallet, "profile"));
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

function calculateRawVolume(activities: ActivityEntry[]): number {
  // Polymarket leaderboard volume = sum of token quantities (size field),
  // not USDC paid. Each token has $1 face value, so at avg price ~$0.50
  // this is ~2x the USDC spent — matching what the leaderboard shows.
  return activities
    .filter(a => (a.type || "").toUpperCase() === "TRADE" && a.side === "BUY")
    .reduce((s, a) => s + (parseFloat(a.size || "0") || 0), 0);
}

// ─── PROCESS ───
function processActivity(activities: ActivityEntry[]): Result[] {
  const markets: Record<string, MarketAccumulator> = {};

  for (const a of activities) {
    const key = a.conditionId || a.title;
    if (!key) continue;
    if (!markets[key]) {
      markets[key] = {
        title: a.title || key,
        slug: a.slug || "",
        icon: a.icon || "",
        buys: [],
        sells: [],
        redeems: [],
      };
    }
    const entry: TradeEntry = {
      usdc: parseFloat(a.usdcSize || "0") || 0,
      tokens: parseFloat(a.size || "0") || 0,
      side: a.side || "",
      outcome: a.outcome || "",
      price: parseFloat(a.price || "0") || 0,
    };
    const type = (a.type || "").toUpperCase();
    if (type === "TRADE" && a.side === "BUY") markets[key].buys.push(entry);
    else if (type === "TRADE" && a.side === "SELL") markets[key].sells.push(entry);
    else if (["REDEEM", "SPLIT", "MERGE"].includes(type)) markets[key].redeems.push(entry);
  }

  const results: Result[] = [];
  for (const [, m] of Object.entries(markets)) {
    if (m.buys.length === 0) continue;
    const totalBought = m.buys.reduce((s, b) => s + b.usdc, 0);
    const totalSold = m.sells.reduce((s, b) => s + b.usdc, 0);
    const totalRedeemed = m.redeems.reduce((s, b) => s + b.usdc, 0);
    const sides = [...new Set(m.buys.map((b) => b.outcome))].filter(Boolean);
    const hasRedeems = m.redeems.length > 0;
    const pnl = totalSold + totalRedeemed - totalBought;
    let outcome: Outcome;
    if (!hasRedeems && totalSold < totalBought) outcome = "OPEN";
    else if (totalRedeemed > 0) outcome = "WIN";
    else if (hasRedeems && totalRedeemed === 0) outcome = "LOSS";
    else outcome = "OPEN";
    results.push({
      market: m.title,
      slug: m.slug,
      icon: m.icon,
      side: sides.join(", ") || "-",
      invested: Math.round(totalBought * 100) / 100,
      sold: Math.round(totalSold * 100) / 100,
      redeemed: Math.round(totalRedeemed * 100) / 100,
      pnl: Math.round(pnl * 100) / 100,
      outcome,
    });
  }
  return results;
}

function categorize(name: string): CategoryInfo {
  if (
    /vs\./.test(name) &&
    !/open|championship|qualification|:/i.test(name) &&
    !/^will /i.test(name)
  )
    return { cat: "NBA", emoji: "🏀" };
  if (
    /open|championship|qualification|atp|wta/i.test(name) ||
    (/:/.test(name) &&
      /vs/i.test(name) &&
      !/^will /i.test(name) &&
      !/bitcoin|temperature|chelsea|brazil|iran/i.test(name))
  )
    return { cat: "Tennis", emoji: "🎾" };
  if (/academy award|oscar|golden globe/i.test(name)) return { cat: "Awards", emoji: "🏆" };
  if (
    /will .*(fc |cf |united |win on)/i.test(name) ||
    /chelsea|napoli|bournemouth|brentford|villarreal|kilmarnock|valladolid|torino/i.test(name)
  )
    return { cat: "Football", emoji: "⚽" };
  if (/temperature|°[FC]/i.test(name)) return { cat: "Weather", emoji: "🌡️" };
  if (/bitcoin/i.test(name)) return { cat: "Bitcoin", emoji: "₿" };
  if (/iran|forces|strikes/i.test(name)) return { cat: "Geopolitics", emoji: "🌍" };
  if (/brazil|lula|bbb|big brother/i.test(name)) return { cat: "Brazil", emoji: "🇧🇷" };
  if (/nfl|nhl|mlb|nascar|f1\b|formula/i.test(name)) return { cat: "Sports", emoji: "🏈" };
  if (/trump|biden|election|congress|senate|president/i.test(name))
    return { cat: "Politics", emoji: "🗳️" };
  if (/crypto|eth |solana|doge/i.test(name)) return { cat: "Crypto", emoji: "🪙" };
  return { cat: "Other", emoji: "📊" };
}

// ─── HEADER ───
function updateHeader(): void {
  const el = document.getElementById("headerRight");
  if (!el) return;
  if (!currentWallet) {
    el.innerHTML = "";
    return;
  }
  const short = currentWallet.slice(0, 6) + "…" + currentWallet.slice(-4);
  const shareUrl = window.location.href;
  el.innerHTML = `
    <span style="font-size:13px;color:var(--text-secondary)"><span class="status-dot"></span> Live</span>
    <span class="wallet-pill">${short}</span>
    <button class="btn btn-outline" onclick="navigator.clipboard.writeText('${shareUrl}');this.textContent='Copied!';setTimeout(()=>this.textContent='Share',1500)">Share</button>
    <button class="btn btn-outline" onclick="goHome()">Change Wallet</button>
    <button class="btn btn-primary" onclick="loadWallet('${currentWallet}')">↻</button>
  `;
}

// ─── FOOTER ───
function footerHTML(): string {
  return `<footer class="site-footer">
    Created by <a href="https://x.com/shaianeviana" target="_blank" rel="noopener noreferrer">shaianeviana</a>
  </footer>`;
}

// ─── DARK MODE ───
function toggleDark(): void {
  const isDark = document.body.classList.toggle("dark");
  localStorage.setItem("theme", isDark ? "dark" : "light");
  updateThemeButton(isDark);
}

function updateThemeButton(isDark: boolean): void {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;
  const icon = isDark
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Light`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg> Dark`;
  btn.innerHTML = icon;
}

// ─── LANDING PAGE ───
function renderLanding(): void {
  document.getElementById("app")!.innerHTML = `
    <div class="landing">
      <div class="hero">
        <div class="hero-badge">Polymarket Dashboard · Free and Open Source</div>
        <h1><span>PolyTracker</span></h1>
        <p>Paste your wallet address and instantly see your full performance: wins, losses, profits, categories and more.</p>
        <div class="wallet-form" id="walletForm">
          <input type="text" class="wallet-input" id="walletInput" placeholder="0x... paste your wallet address" spellcheck="false" autocomplete="off">
          <button class="wallet-submit" onclick="submitWallet()">Analyze →</button>
        </div>
        <div class="wallet-error" id="walletError"></div>
        <div class="features">
          <div class="feature-card">
            <div class="feature-title">Real-time</div>
            <div class="feature-desc">Data pulled directly from Polymarket's public API, updated every 5 minutes.</div>
          </div>
          <div class="feature-card">
            <div class="feature-title">Shareable</div>
            <div class="feature-desc">Each dashboard generates a unique link you can share with anyone.</div>
          </div>
          <div class="feature-card">
            <div class="feature-title">No login required</div>
            <div class="feature-desc">No wallet connection or login needed. Just paste the address and go.</div>
          </div>
        </div>
      </div>
      ${footerHTML()}
    </div>
  `;
  document.getElementById("walletInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitWallet();
  });
  setTimeout(() => (document.getElementById("walletInput") as HTMLInputElement)?.focus(), 100);
}

function submitWallet(): void {
  const input = document.getElementById("walletInput") as HTMLInputElement;
  const error = document.getElementById("walletError")!;
  const val = (input?.value || "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(val)) {
    error.textContent = "Invalid address. Must start with 0x followed by 40 hexadecimal characters.";
    input?.classList.add("error");
    return;
  }
  error.textContent = "";
  setWalletURL(val);
  loadWallet(val);
}

// ─── LOAD WALLET ───
async function loadWallet(wallet: string): Promise<void> {
  currentWallet = wallet;
  currentFilter = "all";
  currentSearch = "";
  sortKey = "pnl";
  sortDir = -1;
  currentPage = 1;
  document.body.classList.remove("on-landing");
  updateHeader();

  document.getElementById("app")!.innerHTML = `
    <div class="container">
      <div class="loading-screen">
        <div class="spinner"></div>
        <div class="loading-text">Loading data for ${wallet.slice(0, 6)}…${wallet.slice(-4)}</div>
      </div>
    </div>
  `;

  try {
    const [activities, profile] = await Promise.all([
      fetchAllActivity(wallet),
      fetchProfile(wallet),
    ]);
    profileData = profile;
    rawVolume = calculateRawVolume(activities);
    if (!activities || activities.length === 0) {
      document.getElementById("app")!.innerHTML = `
        <div class="container">
          <div class="error-box">
            No activity found for this wallet.<br><br>
            <small style="color:var(--text-secondary)">Check if the address is correct or if the wallet has activity on Polymarket.</small><br><br>
            <button class="btn btn-primary" onclick="goHome()">Try another wallet</button>
          </div>
          ${footerHTML()}
        </div>`;
      return;
    }
    allResults = processActivity(activities);
    renderDashboard();
  } catch (err) {
    document.getElementById("app")!.innerHTML = `
      <div class="container">
        <div class="error-box">
          Error loading data: ${(err as Error).message}<br><br>
          <button class="btn btn-primary" onclick="loadWallet('${wallet}')">Try again</button>
          <button class="btn btn-outline" onclick="goHome()" style="margin-left:8px">Back</button>
        </div>
        ${footerHTML()}
      </div>`;
  }
}

// ─── DASHBOARD ───
function renderDashboard(): void {
  const app = document.getElementById("app")!;
  const wins = allResults.filter((d) => d.outcome === "WIN");
  const losses = allResults.filter((d) => d.outcome === "LOSS");
  const open = allResults.filter((d) => d.outcome === "OPEN");
  const resolved = wins.length + losses.length;
  const winRate = resolved > 0 ? (wins.length / resolved) * 100 : 0;
  const totalInvested = allResults.reduce((s, d) => s + d.invested, 0);
  const totalVolume = profileData.volume != null
    ? profileData.volume
    : rawVolume;
  const totalPnl = allResults.reduce((s, d) => s + d.pnl, 0);
  const best =
    allResults.length > 0
      ? allResults.reduce((b, d) => (d.pnl > b.pnl ? d : b), allResults[0])
      : null;
  const worst =
    allResults.length > 0
      ? allResults.reduce((w, d) => (d.pnl < w.pnl ? d : w), allResults[0])
      : null;

  const catMap: Record<string, CategoryData> = {};
  allResults.forEach((d) => {
    const { cat, emoji } = categorize(d.market);
    if (!catMap[cat]) catMap[cat] = { emoji, wins: 0, losses: 0, pnl: 0, invested: 0, count: 0 };
    catMap[cat].count++;
    catMap[cat].invested += d.invested;
    catMap[cat].pnl += d.pnl;
    if (d.outcome === "WIN") catMap[cat].wins++;
    if (d.outcome === "LOSS") catMap[cat].losses++;
  });

  app.innerHTML = `<div class="container">
    <div class="stats-grid">
      ${sc("Total Bets", String(allResults.length), `${wins.length} ✓  ${losses.length} ✗  ${open.length} ◷`, "blue", 0)}
      ${sc("Win Rate", winRate.toFixed(1) + "%", `${wins.length} of ${resolved} resolved`, "blue", 1)}
      ${sc("Total Volume", "$" + totalVolume.toFixed(2), "Total USDC traded", "", 2)}
      ${sc(
        "Profit / Loss",
        (totalPnl >= 0 ? "+" : "") + "$" + totalPnl.toFixed(2),
        totalPnl >= 0 ? "Overall profit" : "Overall loss",
        totalPnl >= 0 ? "positive" : "negative",
        3
      )}
      ${best ? sc("Best Win", "+$" + best.pnl.toFixed(2), best.market.substring(0, 34), "positive", 4) : ""}
      ${worst ? sc("Worst Loss", "-$" + Math.abs(worst.pnl).toFixed(2), worst.market.substring(0, 34), "negative", 5) : ""}
    </div>

    <div class="section">
      <div class="section-header"><div class="section-title">📊 Performance by Category</div></div>
      <div class="cat-grid">
        ${Object.entries(catMap)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([name, d]) => {
            const t = d.wins + d.losses;
            const pct = t > 0 ? (d.wins / t) * 100 : 0;
            return `<div class="cat-card"><div class="cat-name"><span>${d.emoji}</span> ${name}</div>
              <div class="cat-row">
                <div class="cat-metric">Bets<br><span class="cat-metric-val">${d.count}</span></div>
                <div class="cat-metric">Wins<br><span class="cat-metric-val pnl-pos">${d.wins}</span></div>
                <div class="cat-metric">Losses<br><span class="cat-metric-val pnl-neg">${d.losses}</span></div>
                <div class="cat-metric">Rate<br><span class="cat-metric-val">${pct.toFixed(0)}%</span></div>
                <div class="cat-metric">P&amp;L<br><span class="cat-metric-val ${d.pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${d.pnl >= 0 ? "+" : ""}$${d.pnl.toFixed(2)}</span></div>
              </div>
              <div class="progress-bar"><div class="progress-fill ${d.pnl >= 0 ? "green" : "red"}" style="width:${pct}%"></div></div>
            </div>`;
          })
          .join("")}
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <div class="section-title">📋 Betting History</div>
        <div class="controls">
          <input type="text" class="search-input" id="searchBox" placeholder="Search…" value="${currentSearch}">
          <div class="tabs" id="tabs">
            <button class="tab ${currentFilter === "all" ? "active" : ""}" data-f="all">All (${allResults.length})</button>
            <button class="tab ${currentFilter === "WIN" ? "active" : ""}" data-f="WIN">Wins (${wins.length})</button>
            <button class="tab ${currentFilter === "LOSS" ? "active" : ""}" data-f="LOSS">Losses (${losses.length})</button>
            <button class="tab ${currentFilter === "OPEN" ? "active" : ""}" data-f="OPEN">Open (${open.length})</button>
          </div>
        </div>
      </div>
      <div class="table-scroll"><table>
        <thead><tr>
          <th data-s="market" class="${sortKey === "market" ? "sorted" : ""}">Market</th>
          <th data-s="side">Bet</th>
          <th data-s="invested" class="${sortKey === "invested" ? "sorted" : ""}">Invested</th>
          <th data-s="redeemed">Redeemed</th>
          <th data-s="sold">Sold</th>
          <th data-s="pnl" class="${sortKey === "pnl" ? "sorted" : ""}">P&amp;L</th>
          <th data-s="outcome">Status</th>
        </tr></thead>
        <tbody>${tableRows()}</tbody>
      </table></div>
      <div class="pagination">${pagHTML()}</div>
    </div>

    <div class="footer-note">PolyTracker · Data via Polymarket Data API · 5 min cache · <a href="#" onclick="goHome();return false">Change wallet</a></div>
    ${footerHTML()}
  </div>`;

  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      currentFilter = (t as HTMLElement).dataset.f || "all";
      currentPage = 1;
      renderDashboard();
    })
  );
  document.getElementById("searchBox")?.addEventListener("input", (e) => {
    currentSearch = (e.target as HTMLInputElement).value.toLowerCase();
    currentPage = 1;
    renderDashboard();
  });
  document.querySelectorAll("th[data-s]").forEach((th) =>
    th.addEventListener("click", () => {
      const k = (th as HTMLElement).dataset.s || "";
      if (sortKey === k) sortDir *= -1;
      else {
        sortKey = k;
        sortDir = -1;
      }
      renderDashboard();
    })
  );
}

function sc(label: string, value: string, sub: string, cls: string, i: number): string {
  return `<div class="stat-card" style="animation-delay:${i * 0.06}s"><div class="stat-label">${label}</div><div class="stat-value ${cls}">${value}</div><div class="stat-sub">${sub}</div></div>`;
}

function getFiltered(): Result[] {
  let d = [...allResults];
  if (currentFilter !== "all") d = d.filter((x) => x.outcome === currentFilter);
  if (currentSearch)
    d = d.filter(
      (x) =>
        x.market.toLowerCase().includes(currentSearch) ||
        x.side.toLowerCase().includes(currentSearch)
    );
  d.sort((a, b) => {
    const va = a[sortKey as keyof Result];
    const vb = b[sortKey as keyof Result];
    if (typeof va === "string" && typeof vb === "string") return sortDir * va.localeCompare(vb);
    return sortDir * ((va as number) - (vb as number));
  });
  return d;
}

function tableRows(): string {
  const f = getFiltered();
  const tp = Math.ceil(f.length / PER_PAGE) || 1;
  if (currentPage > tp) currentPage = tp;
  const s = (currentPage - 1) * PER_PAGE;
  return f
    .slice(s, s + PER_PAGE)
    .map((d) => {
      const bc = d.outcome === "WIN" ? "win" : d.outcome === "LOSS" ? "loss" : "open";
      const bt = d.outcome === "WIN" ? "✓ Win" : d.outcome === "LOSS" ? "✗ Loss" : "◷ Open";
      const pc = d.pnl >= 0 ? "pnl-pos" : "pnl-neg";
      return `<tr><td class="market-name" title="${d.market}">${d.market}</td><td>${d.side}</td><td class="mono">$${d.invested.toFixed(2)}</td><td class="mono">$${d.redeemed.toFixed(2)}</td><td class="mono">$${d.sold.toFixed(2)}</td><td class="mono ${pc}">${d.pnl >= 0 ? "+" : ""}$${d.pnl.toFixed(2)}</td><td><span class="badge ${bc}">${bt}</span></td></tr>`;
    })
    .join("");
}

function pagHTML(): string {
  const f = getFiltered();
  const tp = Math.ceil(f.length / PER_PAGE) || 1;
  if (tp <= 1) return "";
  let h = "";
  const s = Math.max(1, currentPage - 3);
  const e = Math.min(tp, currentPage + 3);
  if (s > 1) h += `<button class="page-btn" onclick="gp(1)">1</button>`;
  if (s > 2) h += `<span style="padding:6px;color:var(--text-dim)">…</span>`;
  for (let i = s; i <= e; i++)
    h += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="gp(${i})">${i}</button>`;
  if (e < tp - 1) h += `<span style="padding:6px;color:var(--text-dim)">…</span>`;
  if (e < tp) h += `<button class="page-btn" onclick="gp(${tp})">${tp}</button>`;
  return h;
}

function gp(p: number): void {
  currentPage = p;
  renderDashboard();
}

// ─── INIT ───
const savedTheme = localStorage.getItem("theme");
if (savedTheme === "dark") {
  document.body.classList.add("dark");
  updateThemeButton(true);
}

const initWallet = getWalletFromURL();
if (initWallet && /^0x[a-fA-F0-9]{40}$/.test(initWallet)) {
  loadWallet(initWallet);
} else {
  document.body.classList.add("on-landing");
  renderLanding();
  updateHeader();
}
