
# Build the Node.js API
FROM node:24-bookworm-slim AS api-build
WORKDIR /api
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# Build the ASP.NET Core MVC application
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS web-build
WORKDIR /source
COPY UsageMetering.Web/UsageMetering.Web.csproj UsageMetering.Web/
RUN dotnet restore UsageMetering.Web/UsageMetering.Web.csproj
COPY UsageMetering.Web/ UsageMetering.Web/
RUN dotnet publish UsageMetering.Web/UsageMetering.Web.csproj \
    -c Release -o /app/publish --no-restore

# Run both applications in one container
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Install Node.js 24
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV ApiSettings__BaseUrl=http://127.0.0.1:3000/
ENV ASPNETCORE_URLS=http://0.0.0.0:10000

# Copy the API runtime files
WORKDIR /api
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=api-build /api/dist ./dist
COPY --from=api-build /api/src/migrations ./src/migrations

# Copy the MVC application
WORKDIR /app
COPY --from=web-build /app/publish ./

# Start the API and MVC together
COPY <<'EOF' /app/start.sh
#!/bin/sh
set -eu

node /api/dist/index.js &
API_PID=$!

shutdown() {
    kill "$API_PID" 2>/dev/null || true
}
trap shutdown EXIT INT TERM

dotnet /app/UsageMetering.Web.dll &
WEB_PID=$!

while kill -0 "$API_PID" 2>/dev/null &&
      kill -0 "$WEB_PID" 2>/dev/null
do
    sleep 2
done

if ! kill -0 "$API_PID" 2>/dev/null; then
    wait "$API_PID" || true
    exit 1
fi

wait "$WEB_PID"
EOF

RUN chmod +x /app/start.sh

EXPOSE 10000
CMD ["/app/start.sh"]
