
using Microsoft.AspNetCore.Mvc;
using System.Net.Http;

namespace UsageMetering.Web.Controllers;

[Route("api-explorer/proxy")]
public class ApiExplorerProxyController : Controller
{
    private readonly HttpClient _http;

    public ApiExplorerProxyController(IHttpClientFactory factory)
    {
        _http = factory.CreateClient("UsageMeteringApi");
    }

    [HttpGet("{**path}")]
    public Task<IActionResult> Get(string path)
    {
        return ForwardAsync(HttpMethod.Get, path, false);
    }

    [HttpPost("{**path}")]
    public Task<IActionResult> Post(string path)
    {
        return ForwardAsync(HttpMethod.Post, path, true);
    }

    private async Task<IActionResult> ForwardAsync(
        HttpMethod method,
        string path,
        bool hasBody)
    {
        var allowedPaths = new[]
        {
            "health",
            "health/db",
            "plans",
            "accounts",
            "usage",
            "usage/history",
            "accounts/me/users",
            "consumptions"
        };

        if (!allowedPaths.Contains(path))
        {
            return NotFound(new { error = "Endpoint not allowed." });
        }

        var target = path + Request.QueryString;

        using var request = new HttpRequestMessage(method, target);

        if (Request.Headers.TryGetValue("x-api-key", out var apiKey))
        {
            request.Headers.TryAddWithoutValidation(
                "x-api-key", apiKey.ToString());
        }

        if (hasBody)
        {
            request.Content = new StreamContent(Request.Body);

            if (!string.IsNullOrWhiteSpace(Request.ContentType))
            {
                request.Content.Headers.TryAddWithoutValidation(
                    "Content-Type", Request.ContentType);
            }
        }

        using var response = await _http.SendAsync(request);
        var content = await response.Content.ReadAsStringAsync();

        return new ContentResult
        {
            StatusCode = (int)response.StatusCode,
            Content = content,
            ContentType = response.Content.Headers.ContentType?.ToString()
                ?? "application/json"
        };
    }
}
