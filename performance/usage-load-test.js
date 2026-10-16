import http from "k6/http";
import { check } from "k6";

const baseUrl = __ENV.API_BASE_URL || "http://host.docker.internal:3000";

export const options = {
    stages: [
        { duration: "5s", target: 2 },
        { duration: "15s", target: 2 },
        { duration: "5s", target: 0 },
    ],
    thresholds: {
        http_req_failed: ["rate<0.01"],
        checks: ["rate>0.99"],
    },
};

export function setup() {
    const accountResponse = http.post(
        `${baseUrl}/accounts`,
        JSON.stringify({
            name: `performance-${Date.now()}`,
            planName: "Pro Account",
        }),
        {
            headers: { "Content-Type": "application/json" },
        },
    );

    if (accountResponse.status !== 201) {
        throw new Error(
            `Could not create performance account: HTTP ${accountResponse.status}`,
        );
    }

    const account = accountResponse.json();

    const userResponse = http.post(
        `${baseUrl}/accounts/me/users`,
        JSON.stringify({
            externalUserId: `performance-user-${Date.now()}`,
            planName: "Premium User",
        }),
        {
            headers: {
                "Content-Type": "application/json",
                "x-api-key": account.apiKey,
            },
        },
    );

    if (userResponse.status !== 201) {
        throw new Error(
            `Could not create performance user: HTTP ${userResponse.status}`,
        );
    }

    const user = userResponse.json();

    console.log("Performance test setup completed.");

    return {
        apiKey: account.apiKey,
        userId: Number(user.user.id),
    };
}

export default function(data) {
    const response = http.post(
        `${baseUrl}/consumptions`,
        JSON.stringify({
            userId: data.userId,
            units: 1,
            requestId: `perf-${__VU}-${__ITER}-${Date.now()}`,
        }),
        {
            headers: {
                "Content-Type": "application/json",
                "x-api-key": data.apiKey,
            },
        },
    );

    check(response, {
        "consumption returns HTTP 200": (r) => r.status === 200,
        "consumption is accepted": (r) =>
            r.status === 200 && r.json("accepted") === true,
    });
}