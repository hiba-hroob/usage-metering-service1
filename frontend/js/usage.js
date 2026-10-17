
const USAGE_API = "http://127.0.0.1:3001/dashboard/usage";

const totalAllowanceElement = document.getElementById("totalAllowance");
const totalConsumedElement = document.getElementById("totalConsumed");
const remainingUnitsElement = document.getElementById("remainingUnits");
const progressElement = document.getElementById("usageProgress");
const percentageElement = document.getElementById("usagePercentage");
const captionElement = document.getElementById("usageCaption");
const rowsElement = document.getElementById("usageRows");
const messageElement = document.getElementById("usageMessage");
const refreshButton = document.getElementById("refreshUsage");

function readValue(object, ...keys) {
    for (const key of keys) {
        if (object?.[key] !== undefined && object[key] !== null) {
            return object[key];
        }
    }
    return null;
}

function escapeHTML(value) {
    return String(value ?? "—").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function formatNumber(value) {
    return Number(value).toLocaleString();
}

function renderUsage(data) {
    const account = data.account ?? data;
    const users = Array.isArray(data.users) ? data.users : [];

    const allowanceValue = readValue(
        account, "quota", "allowance", "monthlyAllowance"
    );
    const consumedValue = readValue(
        account, "consumed", "used", "totalConsumed"
    );

    const allowance = allowanceValue === null ? NaN : Number(allowanceValue);
    const consumed = consumedValue === null ? NaN : Number(consumedValue);

    totalAllowanceElement.textContent =
        Number.isFinite(allowance) ? formatNumber(allowance) : "—";

    totalConsumedElement.textContent =
        Number.isFinite(consumed) ? formatNumber(consumed) : "—";

    if (Number.isFinite(allowance) && Number.isFinite(consumed)) {
        const remaining = Math.max(0, allowance - consumed);
        const percentage = allowance > 0
            ? Math.min(100, consumed / allowance * 100)
            : 0;

        remainingUnitsElement.textContent = formatNumber(remaining);
        progressElement.style.width = `${percentage}%`;
        percentageElement.textContent = `${percentage.toFixed(1)}% used`;
        captionElement.textContent = "Account quota utilization";
    } else {
        remainingUnitsElement.textContent = "—";
        progressElement.style.width = "0%";
        percentageElement.textContent = "Usage percentage unavailable";
        captionElement.textContent = "Quota information was not provided by the API";
    }

    if (users.length === 0) {
        rowsElement.innerHTML =
            '<tr><td colspan="5">No user usage records available.</td></tr>';
    } else {
        rowsElement.innerHTML = users.map(user => {
            const id = readValue(user, "id", "userId", "user_id");
            const externalId = readValue(
                user, "externalUserId", "external_user_id"
            );
            const allowanceValue = readValue(
                user, "allowance", "quota", "monthlyAllowance"
            );
            const consumedValue = readValue(
                user, "consumed", "used", "totalConsumed"
            );

            const userAllowance = allowanceValue === null
                ? NaN : Number(allowanceValue);
            const userConsumed = consumedValue === null
                ? NaN : Number(consumedValue);

            const hasAllowance = Number.isFinite(userAllowance);
            const hasConsumed = Number.isFinite(userConsumed);

            const remaining = hasAllowance && hasConsumed
                ? Math.max(0, userAllowance - userConsumed)
                : null;

            return `
                <tr>
                    <td>${escapeHTML(id)}</td>
                    <td>${escapeHTML(externalId)}</td>
                    <td>${hasAllowance ? formatNumber(userAllowance) : "—"}</td>
                    <td>${hasConsumed ? formatNumber(userConsumed) : "—"}</td>
                    <td>${remaining === null ? "—" : formatNumber(remaining)}</td>
                </tr>
            `;
        }).join("");
    }
}

async function loadUsage() {
    if (!refreshButton || !messageElement) return;

    refreshButton.disabled = true;
    refreshButton.textContent = "Refreshing...";
    messageElement.textContent = "Loading usage data...";
    messageElement.style.color = "";

    try {
        const response = await fetch(USAGE_API, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        const data = await response.json();
        renderUsage(data);

        requestAnimationFrame(() => {
            messageElement.textContent = "✓ Usage refreshed successfully!";
            messageElement.style.color = "#54f5d0";
        });
    } catch (error) {
        console.error("Unable to refresh usage:", error);
        messageElement.textContent = `Refresh failed: ${error.message}`;
        messageElement.style.color = "#ff65c5";
    } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = "Refresh Usage";
    }
}


refreshButton.addEventListener("click", async () => {
    messageElement.textContent = "Refreshing usage...";
    messageElement.style.color = "#54f5d0";

    await loadUsage();
});

loadUsage();
