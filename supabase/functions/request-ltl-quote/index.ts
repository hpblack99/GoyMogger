import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const P44_API_URL =
  "https://na12.api.project44.com/api/v4/ltl/quotes/rates/query";
const P44_TOKEN_URL = "https://na12.api.project44.com/api/v4/oauth2/token";

// ─── Accessorial mappings ────────────────────────────────────────────────────

const accessorialCodeMap: Record<string, string> = {
  airportPickup: "AIRPU",
  groceryWarehousePickup: "GROPU",
  liftgatePickup: "LGPU",
  militaryInstallationPickup: "MILPU",
  residentialPickup: "RESPU",
  conventionTradeShowPickup: "CNVPU",
  insidePickup: "INPU",
  limitedAccessPickup: "LTDPU",
  pierPickup: "PIERPU",
  sortSegregatePickup: "SORTPU",
  airportDelivery: "AIRDEL",
  conventionTradeShowDelivery: "CNVDEL",
  fairAmusementParkDelivery: "PARKDEL",
  governmentSiteDelivery: "GOVDEL",
  hospitalDelivery: "HOSDEL",
  insideDelivery: "INDEL",
  limitedAccessDelivery: "LTDDEL",
  pierDelivery: "PIERDEL",
  residentialDelivery: "RESDEL",
  sortSegregateDelivery: "SORTDEL",
  constructionSiteDelivery: "CONDEL",
  deliveryAppointment: "APPTDEL",
  farmDelivery: "FARMDEL",
  holidayWeekendDelivery: "HDAYDEL",
  hotelDelivery: "HOTLDEL",
  liftgateDelivery: "LGDEL",
  militaryInstallationDelivery: "MILDEL",
  prisonDelivery: "PRISDEL",
  schoolDelivery: "EDUDEL",
  hazmat: "HAZM",
  protectFromFreezing: "PFZ",
  unloadAtDestination: "UNLOADDEL",
};

const ELS_CODES = Array.from({ length: 25 }, (_, i) => `ELS_${i + 6}`);

const VALID_P44_ACCESSORIAL_CODES = new Set([
  ...Object.values(accessorialCodeMap),
  ...ELS_CODES,
]);

const HAZMAT_CODES = new Set(["HAZM"]);

// ─── Package type helpers ─────────────────────────────────────────────────────

const VALID_PACKAGE_TYPES = new Set([
  "BAG","BALE","BOX","BUCKET","BUNDLE","CAN","CARTON","CASE","COIL",
  "CRATE","CYLINDER","DRUM","PAIL","PLT","PIECES","REEL","ROLL","SKID",
  "TOTE","TUBE","EACH","FLAT","LOOSE",
]);

const packageTypeMap: Record<string, string> = {
  pallet: "PLT", plt: "PLT", skid: "SKID", crate: "CRATE", box: "BOX",
  carton: "CARTON", drum: "DRUM", roll: "ROLL", bag: "BAG", bale: "BALE",
  bundle: "BUNDLE", bucket: "BUCKET", can: "CAN", case: "CASE", coil: "COIL",
  cylinder: "CYLINDER", pail: "PAIL", pieces: "PIECES", reel: "REEL",
  tote: "TOTE", tube: "TUBE", each: "EACH", flat: "FLAT", loose: "LOOSE",
  other: "PLT",
};

function resolvePackageType(input: string): string {
  const mapped = packageTypeMap[input.toLowerCase()];
  if (mapped) return mapped;
  const upper = input.toUpperCase();
  return VALID_PACKAGE_TYPES.has(upper) ? upper : "PLT";
}

// ─── ELS auto-detection ───────────────────────────────────────────────────────

function detectElsCode(lengthInches: number): string | null {
  if (lengthInches < 72) return null;
  const feet = Math.floor(lengthInches / 12);
  return feet >= 30 ? "ELS_30" : `ELS_${feet}`;
}

// ─── Country normalisation ────────────────────────────────────────────────────

const countryCodeMap: Record<string, string> = {
  USA: "US", "UNITED STATES": "US", "UNITED STATES OF AMERICA": "US",
  CAN: "CA", CANADA: "CA",
  MEX: "MX", MEXICO: "MX",
};

function normalizeCountry(country?: string): string {
  if (!country) return "US";
  const upper = country.trim().toUpperCase();
  return countryCodeMap[upper] ?? (upper.length === 2 ? upper : "US");
}

// ─── Address builder ──────────────────────────────────────────────────────────

interface AddressInput {
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zip: string;
  country?: string;
}

function buildAddress(addr: AddressInput): Record<string, unknown> {
  const result: Record<string, unknown> = {
    postalCode: addr.zip,
    country: normalizeCountry(addr.country),
  };
  const lines: string[] = [];
  if (addr.addressLine1 && addr.addressLine1 !== addr.zip) lines.push(addr.addressLine1);
  if (addr.addressLine2) lines.push(addr.addressLine2);
  if (lines.length) result.addressLines = lines;
  if (addr.city)  result.city  = addr.city;
  if (addr.state) result.state = addr.state;
  return result;
}

// ─── Token cache ──────────────────────────────────────────────────────────────

async function getP44AccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: cached } = await supabase
    .from("p44_token_cache")
    .select("access_token, expires_at")
    .single();

  if (cached?.access_token && cached?.expires_at) {
    const expiresAt = new Date(cached.expires_at);
    const fiveMin = new Date(Date.now() + 5 * 60 * 1000);
    if (expiresAt > fiveMin) {
      console.log("Using cached P44 token");
      return cached.access_token;
    }
  }

  const clientId     = Deno.env.get("P44_CLIENT_ID");
  const clientSecret = Deno.env.get("P44_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("P44_CLIENT_ID and P44_CLIENT_SECRET must be configured in Supabase secrets");
  }

  console.log("Fetching new P44 token");
  const tokenRes = await fetch(P44_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`P44 auth failed: ${tokenRes.status} - ${err}`);
  }

  const tokenData = await tokenRes.json();
  const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000);

  // Singleton replacement: delete all rows, insert new one
  await supabase.from("p44_token_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("p44_token_cache").insert({
    access_token: tokenData.access_token,
    expires_at: expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });

  return tokenData.access_token;
}

// ─── Request shape ─────────────────────────────────────────────────────────────

interface LineItemInput {
  description: string;
  weight: number;
  length: number;
  width: number;
  height: number;
  pieces: number;
  freightClass: string;
  packagingType: string;
  nmfc?: string;
  stackable?: boolean;
  commodityType?: string;
  harmonizedCode?: string;
}

interface QuoteRequest {
  quoteId: string;
  origin: AddressInput;
  destination: AddressInput;
  lineItems: LineItemInput[];
  pickupDate: string;
  pickupTimeStart?: string;
  pickupTimeEnd?: string;
  accessorials: Record<string, boolean>;
  isHazmat?: boolean;
  hazmatClass?: string;
  unNumber?: string;
  paymentTerms?: string;
  direction?: string;
  preferredCurrency?: string;
  totalLinearFeet?: number;
  carrierAccountGroup?: string;
  activeCarrierAccounts?: string[];
}

// ─── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let quoteDbId: string | null = null;

  try {
    const body: QuoteRequest = await req.json();

    if (!body.lineItems?.length) {
      throw new Error("At least one line item is required");
    }

    // ── Persist quote request ────────────────────────────────────────────────
    const totalWeight = body.lineItems.reduce((sum, li) => sum + li.weight, 0);

    const { data: quoteRow, error: quoteErr } = await supabase
      .from("quotes")
      .insert({
        quote_request_id: body.quoteId,
        origin_zip:          body.origin.zip,
        origin_city:         body.origin.city ?? null,
        origin_state:        body.origin.state ?? null,
        origin_country:      normalizeCountry(body.origin.country),
        destination_zip:     body.destination.zip,
        destination_city:    body.destination.city ?? null,
        destination_state:   body.destination.state ?? null,
        destination_country: normalizeCountry(body.destination.country),
        pickup_date:  body.pickupDate,
        accessorials: body.accessorials,
        payment_terms: body.paymentTerms ?? null,
        total_weight: totalWeight,
        status: "pending",
      })
      .select("id")
      .single();

    if (quoteErr) throw new Error(`DB insert error: ${quoteErr.message}`);
    quoteDbId = quoteRow.id;

    // Persist line items
    await supabase.from("quote_line_items").insert(
      body.lineItems.map((li) => ({
        quote_id:       quoteDbId,
        description:    li.description,
        weight_lbs:     li.weight,
        pieces:         li.pieces,
        freight_class:  li.freightClass,
        packaging_type: li.packagingType,
        length_in:  li.length  || null,
        width_in:   li.width   || null,
        height_in:  li.height  || null,
        nmfc:       li.nmfc    || null,
        stackable:  li.stackable ?? false,
      })),
    );

    // ── Build P44 payload ────────────────────────────────────────────────────
    const p44LineItems = body.lineItems.map((item) => {
      const lineItem: Record<string, unknown> = {
        description:   item.description || "Freight",
        totalWeight:   item.weight,
        freightClass:  item.freightClass,
        packageType:   resolvePackageType(item.packagingType),
        totalPackages: item.pieces,
        totalPieces:   item.pieces,
        stackable:     item.stackable === true,
      };

      if (item.length > 0 && item.width > 0 && item.height > 0) {
        lineItem.packageDimensions = {
          length: item.length,
          width:  item.width,
          height: item.height,
        };
      }

      if (item.nmfc) {
        const parts = item.nmfc.split("-");
        lineItem.nmfcItemCode = parts[0];
        if (parts[1]) lineItem.nmfcSubCode = parts[1];
      }

      if (item.commodityType)  lineItem.commodityType  = item.commodityType;
      if (item.harmonizedCode) lineItem.harmonizedCode = item.harmonizedCode;

      if (body.isHazmat && body.hazmatClass) {
        lineItem.hazmatDetail = {
          hazardClass:          body.hazmatClass,
          identificationNumber: body.unNumber,
          packingGroup:         "NONE",
        };
      }

      return lineItem;
    });

    // Build accessorial services list
    const accessorialServices = Object.entries(body.accessorials)
      .filter(([, enabled]) => enabled)
      .map(([key]) => ({ code: accessorialCodeMap[key] ?? key }))
      .filter((svc) => {
        if (!VALID_P44_ACCESSORIAL_CODES.has(svc.code)) {
          console.log(`Skipping unsupported accessorial: ${svc.code}`);
          return false;
        }
        if (HAZMAT_CODES.has(svc.code) && !(body.isHazmat && body.hazmatClass)) {
          console.log(`Skipping HAZM — missing hazmat details`);
          return false;
        }
        return true;
      });

    // Auto-detect excessive length surcharge
    const maxLength = Math.max(...body.lineItems.map((li) => li.length || 0));
    const elsCode = detectElsCode(maxLength);
    if (elsCode && !accessorialServices.some((s) => s.code.startsWith("ELS_"))) {
      accessorialServices.push({ code: elsCode });
      console.log(`Auto-added ${elsCode} for ${maxLength}" length`);
    }

    const p44Payload: Record<string, unknown> = {
      originAddress:      buildAddress(body.origin),
      destinationAddress: buildAddress(body.destination),
      pickupWindow: {
        date: body.pickupDate,
        ...(body.pickupTimeStart && { startTime: body.pickupTimeStart }),
        ...(body.pickupTimeEnd   && { endTime:   body.pickupTimeEnd }),
      },
      weightUnit: "LB",
      lengthUnit: "IN",
      lineItems:  p44LineItems,
      apiConfiguration: {
        timeout: 30,
        enableUnitConversion: true,
        fallBackToDefaultAccountGroup: true,
        accessorialServiceConfiguration: {
          allowUnacceptedAccessorials: false,
          fetchAllGuaranteed:     true,
          fetchAllServiceLevels:  true,
          fetchAllInsideDelivery: false,
        },
      },
    };

    if (accessorialServices.length) p44Payload.accessorialServices = accessorialServices;
    if (body.paymentTerms)          p44Payload.paymentTermsOverride = body.paymentTerms;
    if (body.direction)             p44Payload.directionOverride    = body.direction;
    if (body.preferredCurrency)     p44Payload.preferredCurrency    = body.preferredCurrency;
    if (body.totalLinearFeet)       p44Payload.totalLinearFeet      = body.totalLinearFeet;

    if (body.carrierAccountGroup || body.activeCarrierAccounts?.length) {
      const group: Record<string, unknown> = {};
      if (body.carrierAccountGroup) group.code = body.carrierAccountGroup;
      if (body.activeCarrierAccounts?.length) {
        group.accounts = body.activeCarrierAccounts.map((c) => ({ code: c }));
      }
      p44Payload.capacityProviderAccountGroup = group;
    }

    console.log("Sending P44 request:", JSON.stringify(p44Payload, null, 2));

    // ── Call Project44 ───────────────────────────────────────────────────────
    const p44Token = await getP44AccessToken(supabase);

    const p44Res = await fetch(P44_API_URL, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${p44Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(p44Payload),
    });

    if (!p44Res.ok) {
      const errText = await p44Res.text();
      throw new Error(`Project44 API error: ${p44Res.status} - ${errText}`);
    }

    const p44Data = await p44Res.json();
    const rateQuotes: Record<string, unknown>[] = p44Data.rateQuotes ?? [];

    // ── Persist results ──────────────────────────────────────────────────────
    if (rateQuotes.length) {
      await supabase.from("quote_results").insert(
        rateQuotes.map((rq) => {
          const totalCost = (rq.totalCost as Record<string, unknown>) ?? {};
          return {
            quote_id:      quoteDbId,
            carrier_name:  rq.capacityProviderName ?? null,
            carrier_scac:  rq.capacityProviderCode ?? null,
            service_level: rq.serviceLevel         ?? null,
            total_rate:    totalCost.amount         ?? null,
            currency:      totalCost.currency       ?? "USD",
            transit_days:  rq.transitDays           ?? null,
            estimated_delivery_date: rq.estimatedDeliveryDate ?? null,
            guaranteed:    rq.guaranteed            ?? false,
            raw_response:  rq,
          };
        }),
      );
    }

    // Mark quote complete
    await supabase
      .from("quotes")
      .update({ status: "completed" })
      .eq("id", quoteDbId);

    return new Response(
      JSON.stringify({
        success:   true,
        quoteId:   body.quoteId,
        quoteDbId,
        quotes:    rateQuotes,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("request-ltl-quote error:", error);

    if (quoteDbId) {
      await supabase
        .from("quotes")
        .update({ status: "error", error_message: error.message })
        .eq("id", quoteDbId)
        .catch(() => {});
    }

    return new Response(
      JSON.stringify({ success: false, error: error.message ?? "Failed to request quote" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
