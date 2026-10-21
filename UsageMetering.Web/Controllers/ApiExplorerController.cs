
using Microsoft.AspNetCore.Mvc;

namespace UsageMetering.Web.Controllers;

public class ApiExplorerController : Controller
{
    public IActionResult Index()
    {
        ViewBag.ApiBaseUrl = "/api-explorer/proxy";
        return View();
    }
}
