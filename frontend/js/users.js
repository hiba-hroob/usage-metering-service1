
const USERS_API = "http://127.0.0.1:3001/dashboard/usage";

const usersTableBody = document.getElementById("usersTableBody");
const usersCount = document.getElementById("usersCount");
const userSearch = document.getElementById("userSearch");
const refreshUsers = document.getElementById("refreshUsers");

let allUsers = [];

function safeText(value) {
    return String(value ?? "—").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function pick(object, ...keys) {
    for (const key of keys) {
        if (object?.[key] !== undefined && object[key] !== null) {
            return object[key];
        }
    }
    return "—";
}

function renderUsers() {
    const search = userSearch.value.trim().toLowerCase();

    const filteredUsers = allUsers.filter((user) => {
        const id = String(pick(user, "id", "userId", "user_id"));
        const externalId = String(
            pick(user, "externalUserId", "external_user_id")
        );
        const name = String(pick(user, "name", "email"));

        return `${id} ${externalId} ${name}`.toLowerCase().includes(search);
    });

    usersCount.textContent =
        `Showing ${filteredUsers.length} of ${allUsers.length} users`;

    if (filteredUsers.length === 0) {
        usersTableBody.innerHTML =
            '<tr><td colspan="5">No users found.</td></tr>';
        return;
    }

    usersTableBody.innerHTML = filteredUsers.map((user) => `
    <tr>
      <td>${safeText(pick(user, "id", "userId", "user_id"))}</td>
      <td>${safeText(pick(user, "externalUserId", "external_user_id"))}</td>
      <td>${safeText(pick(user, "planName", "plan_name", "plan"))}</td>
      <td>${safeText(pick(user, "allowance", "quota", "monthlyAllowance"))}</td>
      <td>${safeText(pick(user, "consumed", "used", "totalConsumed"))}</td>
    </tr>
  `).join("");
}

async function loadUsers() {
    refreshUsers.disabled = true;
    usersCount.textContent = "Loading users...";

    try {
        const response = await fetch(USERS_API);

        if (!response.ok) {
            throw new Error(`Request failed: ${response.status}`);
        }

        const data = await response.json();

        allUsers = Array.isArray(data.users) ? data.users : [];
        renderUsers();
    } catch (error) {
        console.error("Failed to load users:", error);

        usersTableBody.innerHTML =
            '<tr><td colspan="5">Could not load users. Check that the backend and dashboard proxy are running.</td></tr>';

        usersCount.textContent = "Unable to load users";
    } finally {
        refreshUsers.disabled = false;
    }
}

userSearch.addEventListener("input", renderUsers);
refreshUsers.addEventListener("click", loadUsers);

loadUsers();
