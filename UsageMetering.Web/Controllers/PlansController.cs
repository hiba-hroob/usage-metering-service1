
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using UsageMetering.Web.Services;

namespace UsageMetering.Web.Controllers;

public class PlansController : Controller
{
    private readonly UsageMeteringApiService _api;

    public PlansController(UsageMeteringApiService api)
    {
        _api = api;
    }

    [HttpGet]
    public async Task<IActionResult> Index()
    {
        await LoadPlans();
        return View();
    }

    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(
        string name,
        string scope,
        long monthlyAllowance,
        long maxUnitsPerRequest)
    {
        var apiKey = HttpContext.Session.GetString("ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            TempData["PlanError"] =
                "Connect an account from the Dashboard first.";

            return RedirectToAction(nameof(Index));
        }

        name = name?.Trim() ?? "";
        scope = scope?.Trim() ?? "";

        if (string.IsNullOrWhiteSpace(name) ||
            (scope != "account" && scope != "user") ||
            monthlyAllowance <= 0 ||
            maxUnitsPerRequest <= 0)
        {
            TempData["PlanError"] =
                "Enter a valid name and positive usage limits.";

            return RedirectToAction(nameof(Index));
        }

        try
        {
            await _api.PostAsync<object, JsonElement>(
                "plans",
                new
                {
                    name,
                    scope,
                    monthlyAllowance,
                    maxUnitsPerRequest
                },
                apiKey);

            TempData["PlanSuccess"] =
                "Custom plan created successfully.";
        }
        catch
        {
            TempData["PlanError"] =
                "Could not create the plan. Check the details and try again.";
        }

        return RedirectToAction(nameof(Index));
    }

    private async Task LoadPlans()
    {
        var apiKey = HttpContext.Session.GetString("ApiKey");

        try
        {
            ViewBag.Plans = await _api.GetAsync<JsonElement>(
                "plans",
                apiKey);
        }
        catch
        {
            ViewBag.Error =
                "Unable to load plans. Please check the API connection.";
        }
    }
}
