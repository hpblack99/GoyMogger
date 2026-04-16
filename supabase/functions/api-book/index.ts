import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticate, checkEndpointAccess } from "../_shared/auth.ts";
import { checkRateLimit, logUsage } from "../_shared/rate-limit.ts";
import { getActiveCarriers, getCarrierCredentials } from "../_shared/carrier-registry.ts";
import { corsHeaders, errorResponse } from "../_shared/response.ts";
import type { BookingRequest, BookingResponse } from "../_shared/types.ts";

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

  if (!checkEndpointAccess(customer, "book")) {
    return errorResponse("Access denied to book endpoint", 403, "FORBIDDEN");
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

  let body: BookingRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400, "BAD_REQUEST");
  }

  if (!body.scac || !body.shipper?.zip || !body.consignee?.zip || !body.pickupDate) {
    return errorResponse(
      "scac, shipper.zip, consignee.zip, and pickupDate are required",
      400,
      "VALIDATION_ERROR",
    );
  }

  const carriers = await getActiveCarriers("booking", [body.scac]);
  if (!carriers.length) {
    return errorResponse(`Carrier ${body.scac} not found or inactive`, 404, "CARRIER_NOT_FOUND");
  }

  const carrier = carriers[0];
  const credentials = await getCarrierCredentials(carrier.id, customer.id);
  if (!credentials) {
    return errorResponse(
      `No credentials configured for ${body.scac}`,
      422,
      "NO_CREDENTIALS",
    );
  }

  let bookingResponse: BookingResponse;
  try {
    const { default: Adapter } = await import(
      `../carriers/${body.scac.toLowerCase()}/index.ts`
    );
    const adapter = new Adapter(carrier, credentials);
    bookingResponse = await adapter.book(body);
  } catch (err) {
    const ms = Date.now() - startTime;
    await logUsage(customer.id, "book", "POST", 502, requestId, ms);
    return errorResponse(
      err instanceof Error ? err.message : "Carrier booking failed",
      502,
      "CARRIER_ERROR",
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  await supabase.from("bookings").insert({
    id: bookingResponse.bookingId,
    customer_id: customer.id,
    carrier_id: carrier.id,
    scac: body.scac,
    pro_number: bookingResponse.proNumber,
    bol_number: bookingResponse.bolNumber,
    pickup_confirmation: bookingResponse.pickupConfirmation,
    rate_request_id: body.rateRequestId ?? null,
    booking_payload: body,
    carrier_response: bookingResponse,
    status: "confirmed",
    pickup_date: body.pickupDate,
    estimated_delivery: bookingResponse.estimatedDelivery ?? null,
  });

  const ms = Date.now() - startTime;
  await logUsage(
    customer.id,
    "book",
    "POST",
    200,
    requestId,
    ms,
    req.headers.get("CF-Connecting-IP") ?? undefined,
  );

  return new Response(JSON.stringify(bookingResponse), {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "X-Request-ID": requestId,
    },
  });
});
