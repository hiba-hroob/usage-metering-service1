
using Microsoft.AspNetCore.Mvc;

namespace UsageMetering.Web.Controllers;

public class ApiExplorerController : Controller
{
    public IActionResult Index()
    {
        ViewBag.ApiBaseUrl = "http://localhost:3000";
        return View();
    }
}
