
using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using UsageMetering.Web.Models;
using UsageMetering.Web.Services;

namespace UsageMetering.Web.Controllers;

public class ConsumptionController : Controller
{
    private readonly UsageMeteringApiService _api;

    public ConsumptionController(UsageMeteringApiService api)
    {
        _api = api;
    }

    [HttpGet]
    public async Task<IActionResult> Index()
    {
        var model = new ConsumptionViewModel();
        var apiKey = HttpContext.Session.GetString("ApiKey");

        Console.WriteLine(
    $"[Consumption] Session ID: {HttpContext.Session.Id}, " +
    $"Has API Key: {!string.IsNullOrWhiteSpace(apiKey)}");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            model.Error = "Connect an account from the Dashboard first.";
            return View(model);
        }

        await LoadUsers(model, apiKey);
        return View(model);
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Consume(ConsumptionViewModel model)
    {
        var apiKey = HttpContext.Session.GetString("ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            model.Error = "Connect an account from the Dashboard first.";
            return View("Index", model);
        }

        if (model.UserId <= 0 || model.Units <= 0 ||
            string.IsNullOrWhiteSpace(model.RequestId))
        {
            model.Error = "Select a user and enter valid units and request ID.";
            await LoadUsers(model, apiKey);
            return View("Index", model);
        }

        model.RequestId = model.RequestId.Trim();

        try
        {
            model.Result = await _api.PostAsync<object, ConsumptionResult>(
                "consumptions",
                new
                {
                    userId = model.UserId,
                    units = model.Units,
                    requestId = model.RequestId
                },
                apiKey);

            if (model.Result is null)
                model.Error = "The API returned an empty response.";
        }
        catch (Exception)
        {
            model.Error = "The request could not be completed. Check the API connection and try again.";
        }

        await LoadUsers(model, apiKey);
        return View("Index", model);
    }

    private async Task LoadUsers(
        ConsumptionViewModel model,
        string apiKey)
    {
        try
        {
            var response = await _api.GetAsync<JsonElement>(
                "accounts/me/users", apiKey);

            model.Users.Clear();

          JsonElement users = default;
bool foundUsers = false;

if (response.ValueKind == JsonValueKind.Array)
{
    users = response;
    foundUsers = true;
}
else if (response.ValueKind == JsonValueKind.Object)
{
    foreach (var propertyName in new[] { "users", "data" })
    {
        if (response.TryGetProperty(propertyName, out var value) &&
            value.ValueKind == JsonValueKind.Array)
        {
            users = value;
            foundUsers = true;
            break;
        }
    }
}

if (foundUsers)
{
    foreach (var user in users.EnumerateArray())
    {
        model.Users.Add(new ConsumptionUserOption
        {
            Id = ReadLong(user, "id"),
            ExternalUserId = ReadString(user, "external_user_id"),
            PlanName = ReadString(user, "plan_name")
        });

        if (string.IsNullOrWhiteSpace(model.Users[^1].ExternalUserId))
            model.Users[^1].ExternalUserId =
                ReadString(user, "externalUserId");

        if (string.IsNullOrWhiteSpace(model.Users[^1].PlanName))
            model.Users[^1].PlanName =
                ReadString(user, "planName");
    }
}
        }
        catch
        {
            model.Error ??= "Could not load users from the API.";
        }
    }

    private static long ReadLong(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
            return 0;

        if (value.ValueKind == JsonValueKind.Number &&
            value.TryGetInt64(out var number))
            return number;

        if (value.ValueKind == JsonValueKind.String &&
            long.TryParse(value.GetString(), out number))
            return number;

        return 0;
    }

    private static string ReadString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value))
            return "";

        return value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? ""
            : value.ToString();
    }
}
