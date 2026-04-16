import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ApiCustomer } from "./types.ts";

export async function checkRateLimit(
  customer: ApiCustomer,
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = Date.now();
  const minuteAgo = new Date(now - 60_000).toISOString();
  const dayAgo = new Date(now - 86_400_000).toISOString();

  const [minuteRes, dayRes] = await Promise.all([
    supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .gte("created_at", minuteAgo),
    supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", customer.id)
      .gte("created_at", dayAgo),
  ]);

  if ((minuteRes.count ?? 0) >= customer.rateLimitPerMinute) {
    return { allowed: false, retryAfter: 60 };
  }
  if ((dayRes.count ?? 0) >= customer.rateLimitPerDay) {
    return { allowed: false, retryAfter: 86400 };
  }

  return { allowed: true };
}

export async function logUsage(
  customerId: string,
  endpoint: string,
  method: string,
  statusCode: number,
  requestId: string,
  responseTimeMs: number,
  ipAddress?: string,
): Promise<void> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  await supabase.from("api_usage").insert({
    customer_id: customerId,
    endpoint,
    method,
    status_code: statusCode,
    request_id: requestId,
    ip_address: ipAddress,
    response_time_ms: responseTimeMs,
  });
}
