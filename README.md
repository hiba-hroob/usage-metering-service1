## Performance test

A local performance test was executed using Grafana k6 in Docker.

The test measures the service's consumption endpoint under concurrent requests and checks the responses for correctness.

### Example recorded local run

| Metric | Result |
|---|---:|
| Test duration | 25.04 seconds |
| Maximum virtual users | 2 |
| HTTP requests | 5,110 |
| Completed consumption iterations | 5,108 |
| Average HTTP request duration | 8.12 ms |
| Median HTTP request duration | 7.88 ms |
| 95th percentile HTTP request duration | 12.64 ms |
| HTTP request failure rate | 0% |
| Checks passed | 100% (10,216 passed, 0 failed) |

These results describe a local development run and are not a production performance guarantee. Results may vary depending on the machine, database, and environment.

### Run the test

Run the performance test from the project root using Docker and Grafana k6:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/work" -w /work grafana/k6 run --summary-export=performance/results.json performance/usage-load-test.js
```

Review the generated report before committing it. Performance artifacts must not expose raw API keys or other secrets.

## Assumptions and limitations

- The service meters one resource type: units.
- Monthly periods use the UTC calendar month.
- Each request is accepted or rejected as a whole; partial consumption is not supported.
- The account API key authenticates the account, and consumption is restricted to users belonging to that account.
- Custom plans are private to their owning account.
- Historical summaries do not retain historical snapshots of plan definitions.
- The demo and seeded credentials are for local development only.
- Performance results should be rerun in the target environment and recorded with the test commands and load settings.