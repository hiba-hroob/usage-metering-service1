
const PLANS_API = "http://localhost:3000";

const plansGrid = document.getElementById("plansGrid");
const plansMessage = document.getElementById("plansMessage");
const refreshPlansButton = document.getElementById("refreshPlans");

function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString() : "Not specified";
}

function renderPlans(plans) {
    plansGrid.replaceChildren();

    if (!Array.isArray(plans) || plans.length === 0) {
        plansMessage.textContent = "No plans found.";
        return;
    }

    plansMessage.textContent = `Showing ${plans.length} plans.`;

    plans.forEach((plan) => {
        const card = document.createElement("article");
        card.className = "plan-card";

        const name = document.createElement("h2");
        name.textContent = plan.name ?? "Unnamed plan";

        const tag = document.createElement("span");
        tag.className = "plan-tag";
        tag.textContent = plan.scope === "account" ? "Account Plan" : "User Plan";

        const description = document.createElement("p");
        description.className = "plan-description";
        description.textContent = plan.predefined
            ? "Predefined usage plan"
            : "Custom usage plan";

        const allowance = document.createElement("div");
        allowance.className = "plan-limit";
        allowance.textContent = formatNumber(plan.monthlyAllowance);

        const allowanceLabel = document.createElement("div");
        allowanceLabel.className = "plan-unit";
        allowanceLabel.textContent = "Monthly allowance (units)";

        const requestLimit = document.createElement("p");
        requestLimit.className = "plan-description";
        requestLimit.textContent =
            `Maximum units per request: ${formatNumber(plan.maxUnitsPerRequest)}`;

        card.append(name, tag, description, allowance, allowanceLabel, requestLimit);
        plansGrid.appendChild(card);
    });
}

async function loadPlans() {
    refreshPlansButton.disabled = true;
    plansMessage.textContent = "Loading plans...";
    plansGrid.replaceChildren();

    try {
        const response = await fetch(`${PLANS_API}/plans`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        const data = await response.json();
        renderPlans(data.plans);
    } catch (error) {
        console.error("Failed to load plans:", error);
        plansMessage.textContent =
            `Could not load plans: ${error.message}. Check the browser console for details.`;
    } finally {
        refreshPlansButton.disabled = false;
    }
}

refreshPlansButton.addEventListener("click", loadPlans);
loadPlans();

plansGrid.addEventListener("click", (event) => {
    const card = event.target.closest(".plan-card");
    if (!card) return;

    plansGrid.querySelectorAll(".plan-card").forEach((item) => {
        item.classList.remove("is-selected");
        item.setAttribute("aria-pressed", "false");
    });

    card.classList.add("is-selected");
    card.setAttribute("aria-pressed", "true");
});
