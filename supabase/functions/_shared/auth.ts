import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ApiCustomer } from "./types.ts";
import { errorResponse } from "./response.ts";

export async function authenticate(
  req: Request,
): Promise<{ customer: ApiCustomer } | Response> {
  const apiKey =
    req.headers.get("X-API-Key") ??
    req.headers.get("Authorization")?.replace("Bearer ", "");

  if (!apiKey) return errorResponse("Missing API key", 401, "UNAUTHORIZED");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("api_customers")
    .select("*")
    .eq("api_key", apiKey)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    return errorResponse("Invalid or inactive API key", 401, "UNAUTHORIZED");
  }

  return {
    customer: {
      id: data.id,
      name: data.name,
      email: data.email,
      apiKey: data.api_key,
      isActive: data.is_active,
      rateLimitPerMinute: data.rate_limit_per_minute,
      rateLimitPerDay: data.rate_limit_per_day,
      allowedEndpoints: data.allowed_endpoints,
    },
  };
}

export function checkEndpointAccess(
  customer: ApiCustomer,
  endpoint: string,
): boolean {
  return customer.allowedEndpoints.includes(endpoint);
}
