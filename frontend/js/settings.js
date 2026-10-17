
const API_BASE = "http://localhost:3000";

async function checkService(path, elementId) {
    const element = document.getElementById(elementId);

    try {
        const response = await fetch(`${API_BASE}${path}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        element.textContent = "Online";
        element.style.color = "#54f5d0";
    } catch (error) {
        element.textContent = "Unavailable";
        element.style.color = "#ff82d2";
        console.error(`Service check failed for ${path}:`, error);
    }
}

checkService("/health", "apiStatus");
checkService("/health/db", "dbStatus");
