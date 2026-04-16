import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticate, checkEndpointAccess } from "../_shared/auth.ts";
import { checkRateLimit, logUsage } from "../_shared/rate-limit.ts";
import { getActiveCarriers, getCarrierCredentials } from "../_shared/carrier-registry.ts";
import { corsHeaders, errorResponse } from "../_shared/response.ts";
import type { TrackingRequest, TrackingResponse } from "../_shared/types.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (!["GET", "POST"].includes(req.method)) return errorResponse("Method not allowed", 405);

  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { customer } = authResult;

  if (!checkEndpointAccess(customer, "track")) {
    return errorResponse("Access denied to track endpoint", 403, "FORBIDDEN");
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

  let trackReq: TrackingRequest;
  if (req.method === "GET") {
    const url = new URL(req.url);
    trackReq = {
      scac: url.searchParams.get("scac") ?? "",
      proNumber: url.searchParams.get("pro") ?? undefined,
      bolNumber: url.searchParams.get("bol") ?? undefined,
      trackingNumber: url.searchParams.get("tracking") ?? undefined,
    };
  } else {
    try {
      trackReq = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400, "BAD_REQUEST");
    }
  }

  if (!trackReq.scac || (!trackReq.proNumber && !trackReq.bolNumber && !trackReq.trackingNumber)) {
    return errorResponse(
      "scac and at least one of proNumber, bolNumber, or trackingNumber are required",
      400,
      "VALIDATION_ERROR",
    );
  }

  const carriers = await getActiveCarriers("tracking", [trackReq.scac]);
  if (!carriers.length) {
    return errorResponse(
      `Carrier ${trackReq.scac} not found or inactive`,
      404,
      "CARRIER_NOT_FOUND",
    );
  }

  const carrier = carriers[0];
  const credentials = await getCarrierCredentials(carrier.id, customer.id);
  if (!credentials) {
    return errorResponse(`No credentials configured for ${trackReq.scac}`, 422, "NO_CREDENTIALS");
  }

  let trackingResponse: TrackingResponse;
  try {
    const { default: Adapter } = await import(
      `../carriers/${trackReq.scac.toLowerCase()}/index.ts`
    );
    const adapter = new Adapter(carrier, credentials);
    trackingResponse = await adapter.track(trackReq);
  } catch (err) {
    const ms = Date.now() - startTime;
    await logUsage(customer.id, "track", req.method, 502, requestId, ms);
    return errorResponse(
      err instanceof Error ? err.message : "Carrier tracking failed",
      502,
      "CARRIER_ERROR",
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Persist tracking events, linked to booking if it exists
  if (trackingResponse.events.length) {
    const proNum = trackReq.proNumber ?? trackReq.bolNumber ?? trackReq.trackingNumber;

    const { data: booking } = await supabase
      .from("bookings")
      .select("id")
      .eq("scac", trackReq.scac)
      .or(`pro_number.eq.${proNum},bol_number.eq.${trackReq.bolNumber ?? ""}`)
      .maybeSingle();

    await supabase.from("tracking_events").upsert(
      trackingResponse.events.map((e) => ({
        booking_id: booking?.id ?? null,
        carrier_id: carrier.id,
        scac: trackReq.scac,
        pro_number: proNum,
        event_code: e.code,
        event_description: e.description,
        event_city: e.city ?? null,
        event_state: e.state ?? null,
        event_zip: e.zip ?? null,
        event_location: e.location ?? null,
        event_timestamp: e.timestamp,
        raw_event: e,
      })),
      { onConflict: "pro_number,event_code,event_timestamp", ignoreDuplicates: true },
    );
  }

  const ms = Date.now() - startTime;
  await logUsage(
    customer.id,
    "track",
    req.method,
    200,
    requestId,
    ms,
    req.headers.get("CF-Connecting-IP") ?? undefined,
  );

  return new Response(JSON.stringify(trackingResponse), {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
  });
});
