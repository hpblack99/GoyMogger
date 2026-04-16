import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticate, checkEndpointAccess } from "../_shared/auth.ts";
import { checkRateLimit, logUsage } from "../_shared/rate-limit.ts";
import { getActiveCarriers, getCarrierCredentials } from "../_shared/carrier-registry.ts";
import { sortRates } from "../_shared/normalizer.ts";
import { corsHeaders, errorResponse } from "../_shared/response.ts";
import type { CarrierError, CarrierRate, RateRequest, RateResponse } from "../_shared/types.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { customer } = authResult;

  if (!checkEndpointAccess(customer, "rates")) {
    return errorResponse("Access denied to rates endpoint", 403, "FORBIDDEN");
  }

  const limit = await checkRateLimit(customer);
  if (!limit.allowed) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json",
        "Retry-After": String(limit.retryAfter),
      },
    });
  }

  let body: RateRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400, "BAD_REQUEST");
  }

  if (!body.shipper?.zip || !body.consignee?.zip || !body.items?.length) {
    return errorResponse(
      "shipper.zip, consignee.zip, and items are required",
      400,
      "VALIDATION_ERROR",
    );
  }

  const carriers = await getActiveCarriers("rates", body.requestedCarriers);
  if (!carriers.length) {
    return errorResponse("No active carriers available", 503, "NO_CARRIERS");
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  await supabase.from("rate_requests").insert({
    id: requestId,
    customer_id: customer.id,
    request_payload: body,
    origin_zip: body.shipper.zip,
    dest_zip: body.consignee.zip,
    origin_country: body.shipper.country ?? "US",
    dest_country: body.consignee.country ?? "US",
    carriers_requested: body.requestedCarriers ?? null,
    status: "processing",
  });

  const rates: CarrierRate[] = [];
  const errors: CarrierError[] = [];

  // Fan-out to all carriers in parallel
  const results = await Promise.allSettled(
    carriers.map(async (carrier) => {
      const t0 = Date.now();
      const credentials = await getCarrierCredentials(carrier.id, customer.id);
      if (!credentials) throw new Error(`No credentials for ${carrier.scac}`);

      const { default: Adapter } = await import(
        `../carriers/${carrier.scac.toLowerCase()}/index.ts`
      );
      const adapter = new Adapter(carrier, credentials);
      const carrierRates: CarrierRate[] = await adapter.getRates(body);
      const ms = Date.now() - t0;

      await supabase.from("rate_responses").insert(
        carrierRates.map((r) => ({
          request_id: requestId,
          carrier_id: carrier.id,
          scac: carrier.scac,
          success: true,
          total_charge: r.totalCharge,
          transit_days: r.transitDays,
          service_level: r.serviceLevel,
          normalized_response: r,
          response_time_ms: ms,
        })),
      );

      return carrierRates;
    }),
  );

  const respondedScacs: string[] = [];

  results.forEach((result, i) => {
    const carrier = carriers[i];
    if (result.status === "fulfilled") {
      rates.push(...result.value);
      respondedScacs.push(carrier.scac);
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : "Unknown error";
      errors.push({ scac: carrier.scac, carrierName: carrier.name, message: msg });

      supabase.from("rate_responses").insert({
        request_id: requestId,
        carrier_id: carrier.id,
        scac: carrier.scac,
        success: false,
        error_message: msg,
      });
    }
  });

  const processingTimeMs = Date.now() - startTime;

  await supabase
    .from("rate_requests")
    .update({
      status: "completed",
      carriers_responded: respondedScacs,
      response_time_ms: processingTimeMs,
    })
    .eq("id", requestId);

  const response: RateResponse = {
    requestId,
    rates: sortRates(rates),
    errors,
    processedAt: new Date().toISOString(),
    processingTimeMs,
  };

  await logUsage(
    customer.id,
    "rates",
    "POST",
    200,
    requestId,
    processingTimeMs,
    req.headers.get("CF-Connecting-IP") ?? undefined,
  );

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
  });
});
