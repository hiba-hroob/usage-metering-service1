const API_BASE = "http://localhost:3000";
const DASHBOARD_API = "http://127.0.0.1:3001/dashboard/usage";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let apiOnline = false;
let toastTimer;

function showToast(message, type = "success") {
    const container = $("#toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : ""}`;
    toast.textContent = message;
    container.appendChild(toast);

    window.setTimeout(() => toast.remove(), 3600);
}

function setApiStatus(online) {
    apiOnline = online;

    const statusText = $("#apiStatusText");
    const footerText = $("#footerApiStatus");
    const notice = $("#demoNotice");

    if (statusText) {
        statusText.textContent = online ? "API Connected" : "API Offline";
    }

    if (footerText) {
        footerText.textContent = online
            ? "Service reachable"
            : "Unable to reach service";
    }

    const dot = document.querySelector(".system-status .status-dot");
    if (dot) {
        dot.style.background = online ? "var(--green)" : "var(--orange)";
        dot.style.boxShadow = online
            ? "0 0 10px rgba(74,222,128,.4)"
            : "0 0 10px rgba(251,146,60,.35)";
    }

    if (notice) {
        notice.hidden = online;
    }
}

async function checkApiHealth() {
    try {
        const response = await fetch(`${API_BASE}/health`, {
            method: "GET",
            signal: AbortSignal.timeout(4000)
        });

        if (!response.ok) {
            throw new Error("Health check failed");
        }

        const result = await response.json();

        if (result.status !== "ok") {
            throw new Error("Unexpected health response");
        }

        setApiStatus(true);
        return true;
    } catch {
        setApiStatus(false);
        return false;
    }
}



async function loadUsageData() {
    const response = await fetch(DASHBOARD_API, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
        throw new Error("Could not load usage data");
    }

    const data = await response.json();
    console.log("Usage history response:", data);
    console.log("Usage history users:", data.users);
    window.dashboardUsers = data.users ?? [];
    const account = data.account;

    if (!account) {
        throw new Error("Usage response has no account");
    }

    const consumed = Number(account.consumed);
    const allowance = Number(account.allowance);
    const remaining = Number(account.remaining);
    const limit = Number(account.maxUnitsPerRequest);

    if (![consumed, allowance, remaining, limit].every(Number.isFinite)
        || consumed < 0 || allowance < 0 || remaining < 0 || limit < 0) {
        throw new Error("Invalid usage values");
    }

    const percent = allowance > 0
        ? Math.min(100, (consumed / allowance) * 100)
        : 0;

    const number = (value) => value.toLocaleString("en-US");

    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    };

    setText("totalRequests", "—");
    setText("acceptedRequests", "—");
    setText("rejectedRequests", "—");

    setText("quotaPercent", percent.toFixed(1));
    setText("quotaDetail", `${number(consumed)} of ${number(allowance)} units`);
    setText("quotaRemaining", `${number(remaining)} remaining`);

    setText("planQuota", `${number(allowance)} units`);
    setText("requestLimit", `${number(limit)} units`);
    setText("planUsageLabel", `${percent.toFixed(1)}%`);
    setText("planUsed", `${number(consumed)} units used`);
    setText("planLeft", `${number(remaining)} left`);

    const quotaProgress = document.getElementById("quotaProgress");
    if (quotaProgress) quotaProgress.style.width = `${percent}%`;

    const planProgress = document.getElementById("planUsageProgress");
    if (planProgress) planProgress.style.width = `${percent}%`;

    const workspaceName = document.querySelector(".workspace-copy strong");
    if (workspaceName) workspaceName.textContent = account.name;

    const planName = document.querySelector(".plan-highlight strong");
    if (planName) planName.textContent = account.name;

    const notice = document.getElementById("demoNotice");
    if (notice) {
        notice.hidden = true;
        notice.style.display = "none";
    }

    return data;
}


async function loadUsageHistory() {
    const response = await fetch("http://127.0.0.1:3001/dashboard/history", {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(6000)
    });

    if (!response.ok) {
        throw new Error("Could not load usage history");
    }

    const data = await response.json();
    console.log("Actual history response:", JSON.stringify(data, null, 2));
    console.log("History data:", data);
    console.log("History users:", data.users);
    console.log("History user details:", JSON.stringify(data.users, null, 2));
    console.log("History record details:", JSON.stringify(data.records?.[0], null, 2));
    const records = Array.isArray(data.records) ? data.records : [];
    const chartRange = document.getElementById("chartRange");
    const rangeDays = Number(chartRange?.value) || 7;
    updateUsageChart(records, rangeDays);
    const totalRequests = Number(data.total) || 0;
    const acceptedRequests = records.filter(
        (record) => record.accepted === true
    ).length;
    const rejectedRequests = records.filter(
        (record) => record.accepted === false
    ).length;

    const setText = (id, value) => {
        const element = document.getElementById(id);
        if (element) element.textContent = value.toLocaleString("en-US");
    };

    setText("totalRequests", totalRequests);
    setText("acceptedRequests", acceptedRequests);
    setText("rejectedRequests", rejectedRequests);
    const table = document.getElementById("activityTable");
    const count = document.getElementById("activityCount");

    if (!table) return;

    table.replaceChildren();

    if (records.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 5;
        cell.textContent = "No usage records yet.";
        row.appendChild(cell);
        table.appendChild(row);

        if (count) count.textContent = "0 real usage records";
        return;
    }

    const formatTime = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Unknown";

        return date.toLocaleString("en-GB", {
            timeZone: "UTC",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }) + " UTC";
    };

    for (const record of records) {
        const user = (window.dashboardUsers ?? []).find(
            (item) => Number(item.id) === Number(record.userId)
        );
        const row = document.createElement("tr");
        const requestCell = document.createElement("td");
        const userCell = document.createElement("td");
        const unitsCell = document.createElement("td");
        const statusCell = document.createElement("td");
        const timeCell = document.createElement("td");

        requestCell.textContent = `Usage record #${record.id}`;
        userCell.textContent = user?.externalUserId ?? `User ${record.userId}`;
        unitsCell.textContent = Number(record.units).toLocaleString("en-US");

        const accepted = record.accepted === true;

        statusCell.textContent = accepted ? "Accepted" : "Rejected";
        statusCell.classList.add("status-pill", accepted ? "accepted" : "rejected");
        row.dataset.requestId = String(record.id ?? "");
        row.dataset.userId = String(record.userId ?? "");
        row.dataset.status = accepted ? "accepted" : "rejected";

        timeCell.textContent = formatTime(record.createdAt);

        row.append(
            requestCell,
            userCell,
            unitsCell,
            statusCell,
            timeCell
        );

        table.appendChild(row);
    }

    if (count) {
        count.textContent = `${data.total} real usage records`;
    }
}


function updateUsageChart(records, rangeDays = 7) {
    const now = new Date();
    const today = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate()
    );

    const daily = Array(rangeDays).fill(0);

    for (const record of records) {
        const timestamp = new Date(record.createdAt).getTime();
        if (!Number.isFinite(timestamp)) continue;

        const day = Date.UTC(
            new Date(timestamp).getUTCFullYear(),
            new Date(timestamp).getUTCMonth(),
            new Date(timestamp).getUTCDate()
        );

        const daysAgo = Math.round((today - day) / 86400000);

        if (daysAgo >= 0 && daysAgo < rangeDays) {
            daily[rangeDays - 1 - daysAgo]++;
        }
    }

    const total = daily.reduce((sum, value) => sum + value, 0);
    const totalElement = document.getElementById("chartTotal");

    if (totalElement) {
        totalElement.textContent = total.toLocaleString("en-US");
    }

    const labels = document.getElementById("chartLabels");
    if (labels) {
        labels.replaceChildren();

        daily.forEach((_, index) => {
            const date = new Date(today - (rangeDays - 1 - index) * 86400000);
            const label = document.createElement("span");

            label.textContent = date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC"
            });

            labels.appendChild(label);
        });
    }

    const line = document.getElementById("chartLine");
    const area = document.getElementById("chartArea");

    if (!line || !area) return;

    const max = Math.max(1, ...daily);
    const points = daily.map((value, index) => ({
        x: rangeDays === 1 ? 350 : index * 700 / (rangeDays - 1),
        y: 200 - (value / max) * 170
    }));

    const path = points.map((point, index) =>
        `${index === 0 ? "M" : "L"}${point.x},${point.y}`
    ).join(" ");

    line.setAttribute("d", path);
    area.setAttribute("d", `${path} L700,220 L0,220 Z`);
}


function setActivePage(page) {
    const validPages = [
        "overview",
        "usage",
        "requests",
        "users",
        "plans",
        "api",
        "settings"
    ];

    const selected = validPages.includes(page) ? page : "overview";

    const labels = {
        overview: "Overview",
        usage: "Usage analytics",
        requests: "Request history",
        users: "Users & accounts",
        plans: "Plans & quotas",
        api: "API explorer",
        settings: "Settings"
    };

    $$(".nav-item").forEach((item) => {
        const active = item.dataset.page === selected;
        item.classList.toggle("active", active);

        if (active) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });

    const breadcrumb = $("#breadcrumbTitle");
    if (breadcrumb) breadcrumb.textContent = labels[selected];

    const overviewSections = [
        ".welcome-row",
        "#demoNotice",
        ".metrics-grid",
        ".dashboard-grid"
    ];

    const isHistory = selected === "requests";

    overviewSections.forEach((selector) => {
        document.querySelectorAll(selector).forEach((element) => {
            element.style.display = isHistory ? "none" : "";
        });
    });

    const activityPanel = $(".activity-panel");
    if (activityPanel) {
        activityPanel.style.display = "";

        const heading = activityPanel.querySelector("h2");
        const subtitle = activityPanel.querySelector(".panel-heading p");

        if (heading) {
            heading.textContent = isHistory
                ? "Request history"
                : "Recent activity";
        }

        if (subtitle) {
            subtitle.textContent = isHistory
                ? "Review usage records across your workspace"
                : "Latest requests across your workspace";
        }
    }

    const footer = $(".page-footer");
    if (footer) footer.style.display = "";

    $("#sidebar")?.classList.remove("open");
}




function handleNavigation(event) {
    const link = event.target.closest("[data-page]");
    if (!link) return;

    const page = link.dataset.page;
    if (!page) return;

    // Open standalone pages
    if (page === "users") {
        window.location.href = "./users.html";
        return;
    }

    if (page === "usage") {
        window.location.href = "./usage.html";
        return;
    }

    if (page === "plans") {
        window.location.href = "./plans.html";
        return;
    }

    if (page === "api") {
        window.location.href = "./api.html";
        return;
    }


    if (page === "settings") {
        window.location.href = "./settings.html";
        return;
    }


    // Keep the existing in-dashboard navigation for other pages
    event.preventDefault();
    setActivePage(page);

    if (link.matches("a")) {
        history.replaceState(null, "", `#${page}`);
    }
}





function filterActivity() {
    const filter = $("#statusFilter")?.value ?? "all";
    const search = ($("#requestSearch")?.value ?? "")
        .trim()
        .toLowerCase();

    const rows = $$("#activityTable tr");
    let visibleCount = 0;
    let recordCount = 0;

    rows.forEach((row) => {
        // Ignore the empty-state message; it is not a usage record.
        if (!row.dataset.status) {
            row.hidden = search.length > 0 || filter !== "all";
            return;
        }

        recordCount++;

        const matchesStatus =
            filter === "all" || row.dataset.status === filter;

        const searchableText = [
            row.dataset.requestId,
            row.dataset.userId,
            row.textContent
        ].join(" ").toLowerCase();

        const matchesSearch = searchableText.includes(search);
        const visible = matchesStatus && matchesSearch;

        row.hidden = !visible;
        if (visible) visibleCount++;
    });

    const count = $("#activityCount");

    if (count) {
        count.textContent = recordCount === 0
            ? "0 real usage records"
            : `Showing ${visibleCount} of ${recordCount} real usage records`;
    }
}




function updateChartLabels(range) {
    const days = Number(range) || 7;

    loadUsageHistory().catch((error) => {
        console.error("Could not refresh usage history:", error);
        showToast("Could not refresh usage chart.");
    });

    showToast(`Chart range set to the last ${days} days.`);
}



async function refreshDashboard() {
    const button = $("#refreshButton");
    if (button?.dataset.loading === "true") return;

    if (button) {
        button.dataset.loading = "true";
        button.disabled = true;
    }

    const originalText = button?.innerHTML;

    if (button) {
        button.textContent = "Loading usage...";
    }

    try {
        const online = await checkApiHealth();

        if (!online) {
            throw new Error("The API on port 3000 is offline.");
        }

        await loadUsageData();
        await loadUsageHistory();
        showToast("Usage data refreshed successfully.");
    } catch (error) {
        console.error("Dashboard refresh failed:", error);
        showToast(
            "Could not refresh usage data. Check that both servers are running.",
            "error"
        );
    } finally {
        if (button) {
            button.dataset.loading = "false";
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }
}


function setupWorkspaceActions() {
    $("#workspaceButton")?.addEventListener("click", () => {
        showToast("Workspace switching will be connected to account selection.");
    });

    $("#profileButton")?.addEventListener("click", () => {
        showToast("Profile settings are not connected yet.");
    });

    $("#notificationButton")?.addEventListener("click", () => {
        showToast("You are all caught up.");
    });

    $("#quickActionButton")?.addEventListener("click", () => {
        showToast("Choose a section from the sidebar to get started.");
    });

    $("#dismissNotice")?.addEventListener("click", () => {
        const notice = $("#demoNotice");
        if (notice) notice.hidden = true;
    });

    $("#menuButton")?.addEventListener("click", () => {
        $("#sidebar")?.classList.toggle("open");
    });

    $("#statusFilter")?.addEventListener("change", filterActivity);
    $("#requestSearch")?.addEventListener("input", filterActivity);

    $("#chartRange")?.addEventListener("change", (event) => {
        updateChartLabels(event.target.value);
    });

    $("#refreshButton")?.addEventListener("click", refreshDashboard);

    document.addEventListener("click", handleNavigation);

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            $("#sidebar")?.classList.remove("open");
        }
    });

    window.addEventListener("hashchange", () => {
        setActivePage(window.location.hash.slice(1));
    });
}


async function initDashboard() {
    setupWorkspaceActions();
    filterActivity();

    const initialPage = window.location.hash.slice(1);
    if (initialPage) setActivePage(initialPage);

    await refreshDashboard();

    window.setInterval(checkApiHealth, 30000);
}

document.addEventListener("DOMContentLoaded", initDashboard);


document.addEventListener("DOMContentLoaded", initDashboard);