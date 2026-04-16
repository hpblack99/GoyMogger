import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Carrier, CarrierCredential } from "./types.ts";

export async function getActiveCarriers(
  capability: "rates" | "booking" | "tracking",
  scacs?: string[],
): Promise<Carrier[]> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let query = supabase.from("carriers").select("*").eq("is_active", true);

  if (capability === "rates") query = query.eq("supports_rates", true);
  if (capability === "booking") query = query.eq("supports_booking", true);
  if (capability === "tracking") query = query.eq("supports_tracking", true);
  if (scacs?.length) query = query.in("scac", scacs);

  const { data } = await query;
  if (!data) return [];

  return data.map((row) => ({
    id: row.id,
    scac: row.scac,
    name: row.name,
    apiType: row.api_type,
    isActive: row.is_active,
    supportsRates: row.supports_rates,
    supportsBooking: row.supports_booking,
    supportsTracking: row.supports_tracking,
    timeoutMs: row.timeout_ms,
    config: row.config,
  }));
}

export async function getCarrierCredentials(
  carrierId: string,
  customerId: string,
): Promise<CarrierCredential | null> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const env = Deno.env.get("CARRIER_ENV") ?? "production";

  const { data } = await supabase
    .from("carrier_credentials")
    .select("*")
    .eq("carrier_id", carrierId)
    .eq("customer_id", customerId)
    .eq("environment", env)
    .eq("is_active", true)
    .single();

  if (!data) return null;

  return {
    carrierId: data.carrier_id,
    customerId: data.customer_id,
    credentials: data.credentials,
    environment: data.environment,
  };
}
