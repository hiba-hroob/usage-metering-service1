
namespace UsageMetering.Web.Models;

public class ConsumptionViewModel
{
	public long UserId { get; set; }
	public long Units { get; set; } = 1;
	public string RequestId { get; set; } = Guid.NewGuid().ToString();

	public List<ConsumptionUserOption> Users { get; set; } = new();
	public ConsumptionResult? Result { get; set; }
	public string? Error { get; set; }
}

public class ConsumptionUserOption
{
	public long Id { get; set; }
	public string ExternalUserId { get; set; } = "";
	public string PlanName { get; set; } = "";
}

public class ConsumptionResult
{
	public string RequestId { get; set; } = "";
	public bool Accepted { get; set; }
	public string? Reason { get; set; }
	public long Units { get; set; }
	public string MonthStart { get; set; } = "";
	public UsageDetails? AccountUsage { get; set; }
	public UsageDetails? UserUsage { get; set; }
	public bool Replayed { get; set; }
}

public class UsageDetails
{
	public long Consumed { get; set; }
	public long Allowance { get; set; }
	public long MaxUnitsPerRequest { get; set; }
}
