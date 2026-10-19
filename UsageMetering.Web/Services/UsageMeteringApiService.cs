
using System.Net.Http.Json;

namespace UsageMetering.Web.Services;

public class UsageMeteringApiService
{
    private readonly HttpClient _http;

    public UsageMeteringApiService(IHttpClientFactory factory)
    {
        _http = factory.CreateClient("UsageMeteringApi");
    }

    public async Task<T?> GetAsync<T>(
        string path,
        string? apiKey = null)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Get, path);

        AddApiKey(request, apiKey);

        using var response = await _http.SendAsync(request);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<T>();
    }

    public async Task<TResponse?> PostAsync<TRequest, TResponse>(
        string path,
        TRequest body,
        string? apiKey = null)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body)
        };

        AddApiKey(request, apiKey);

        using var response = await _http.SendAsync(request);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<TResponse>();
    }

    public async Task<TResponse?> PatchAsync<TRequest, TResponse>(
        string path,
        TRequest body,
        string? apiKey = null)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Patch, path)
        {
            Content = JsonContent.Create(body)
        };

        AddApiKey(request, apiKey);

        using var response = await _http.SendAsync(request);

        response.EnsureSuccessStatusCode();

        return await response.Content.ReadFromJsonAsync<TResponse>();
    }

    private static void AddApiKey(
        HttpRequestMessage request,
        string? apiKey)
    {
        if (!string.IsNullOrWhiteSpace(apiKey))
        {
            request.Headers.TryAddWithoutValidation(
                "x-api-key", apiKey);
        }
    }
}
