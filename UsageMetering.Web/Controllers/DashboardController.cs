
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using UsageMetering.Web.Services;

namespace UsageMetering.Web.Controllers;

public class DashboardController : Controller
{
    private readonly UsageMeteringApiService _api;

    public DashboardController(UsageMeteringApiService api)
    {
        _api = api;
    }

    public async Task<IActionResult> Index()
    {
        var apiKey = HttpContext.Session.GetString("ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
            return View();

        try
        {
            var usage = await _api.GetAsync<JsonElement>(
                "usage", apiKey);

            ViewBag.Usage = usage;
            ViewBag.Connected = true;
        }
        catch
        {
            ViewBag.Error =
                "Could not load usage. Check that the API and database are running.";
        }

        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> CreateAccount(string name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            TempData["Error"] = "Please enter an account name.";
            return RedirectToAction(nameof(Index));
        }

        try
        {
            var result = await _api.PostAsync<
                object, JsonElement>(
                "accounts",
                new { name = name.Trim() });


            if (!result.TryGetProperty("apiKey", out var key) ||
                string.IsNullOrWhiteSpace(key.GetString()))
            {
                TempData["Error"] =
                    "The API response did not contain an account key.";
                return RedirectToAction(nameof(Index));
            }

            var apiKey = key.GetString()!;

            HttpContext.Session.SetString("ApiKey", apiKey);
            TempData["NewApiKey"] = apiKey;


            return RedirectToAction(nameof(Index));
        }
        catch
        {
            TempData["Error"] =
                "Could not create the account. Make sure the API and database are running.";
            return RedirectToAction(nameof(Index));
        }
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public IActionResult Disconnect()
    {
        HttpContext.Session.Remove("ApiKey");
        return RedirectToAction(nameof(Index));
    }
}
