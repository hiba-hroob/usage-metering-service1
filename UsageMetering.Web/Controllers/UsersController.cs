
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using UsageMetering.Web.Services;

namespace UsageMetering.Web.Controllers;

public class UsersController : Controller
{
    private readonly UsageMeteringApiService _api;

    public UsersController(UsageMeteringApiService api)
    {
        _api = api;
    }

    public async Task<IActionResult> Index()
    {
        var apiKey = HttpContext.Session.GetString("ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            ViewBag.Users = null;
            ViewBag.Message = "Create or connect an account from the Dashboard first.";
            return View();
        }

        try
        {
            var result = await _api.GetAsync<JsonElement>("accounts/me/users", apiKey);
            ViewBag.Users = result;
        }


        catch (Exception ex)
        {
            ViewBag.Message = $"Could not load users: {ex.Message}";
        }



        return View();
    }


    [HttpPost]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> Create(string externalUserId, string planName)
    {
        var apiKey = HttpContext.Session.GetString("ApiKey");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            TempData["Error"] = "Connect an account first.";
            return RedirectToAction(nameof(Index));
        }

        if (string.IsNullOrWhiteSpace(externalUserId))
        {
            TempData["Error"] = "Enter an external user ID.";
            return RedirectToAction(nameof(Index));
        }

        try
        {
            await _api.PostAsync<object, JsonElement>(
                "accounts/me/users",
                new
                {
                    externalUserId = externalUserId.Trim(),
                    planName = string.IsNullOrWhiteSpace(planName)
                        ? "Basic User"
                        : planName.Trim()
                },
                apiKey);

            TempData["Success"] = "User created successfully.";
        }
        catch (Exception ex)
        {
            TempData["Error"] = $"Could not create user: {ex.Message}";
        }

        return RedirectToAction(nameof(Index));
    }

}
