import { RestCarrierAdapter } from "../../_shared/adapters/rest-adapter.ts";
import type {
  BookingRequest,
  BookingResponse,
  CarrierRate,
  RateRequest,
  TrackingRequest,
  TrackingResponse,
} from "../../_shared/types.ts";

// XPO Logistics REST adapter
// Docs: https://api.ltl.xpo.com/freight/1.0
export default class XPOAdapter extends RestCarrierAdapter {
  private get authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.creds.accessToken}`,
      "X-Account-Code": this.creds.accountCode ?? "",
    };
  }

  async getRates(req: RateRequest): Promise<CarrierRate[]> {
    const payload = {
      originPostalCd: req.shipper.zip,
      originCountryCd: req.shipper.country ?? "US",
      destinationPostalCd: req.consignee.zip,
      destinationCountryCd: req.consignee.country ?? "US",
      shipDate: req.pickupDate ?? new Date().toISOString().slice(0, 10),
      commodities: req.items.map((item) => ({
        pieces: item.pieces,
        grossWeight: item.weight,
        freightClass: item.freightClass,
        description: item.description,
        hazardousMtInd: item.hazmat ? "Y" : "N",
      })),
      accessorials: req.accessorials ?? [],
      accountNumber: this.creds.accountNumber,
    };

    const data = await this.post<{ rateQuotes?: unknown[] }>(
      "/shipment/ratequote",
      payload,
      this.authHeaders,
    );

    return (data.rateQuotes ?? []).map((q: Record<string, unknown>): CarrierRate => ({
      scac: "XPOF",
      carrierName: "XPO Logistics",
      serviceLevel: String(q.serviceType ?? "STD"),
      transitDays: Number(q.transitDays ?? 0),
      totalCharge: Number(q.totalCharge ?? 0),
      currency: "USD",
      effectiveDate: String(q.effectiveDate ?? new Date().toISOString().slice(0, 10)),
      expiryDate: q.expiryDate ? String(q.expiryDate) : undefined,
      quoteId: q.quoteId ? String(q.quoteId) : undefined,
      breakdown: {
        freightCharge: Number(q.freightCharge ?? 0),
        fuelSurcharge: Number(q.fuelSurcharge ?? 0),
      },
    }));
  }

  async book(req: BookingRequest): Promise<BookingResponse> {
    const payload = {
      quoteId: req.quoteId,
      shipperName: req.shipper.name,
      shipperAddress: req.shipper.address1,
      shipperCity: req.shipper.city,
      shipperStateCode: req.shipper.state,
      shipperPostalCd: req.shipper.zip,
      consigneeName: req.consignee.name,
      consigneeAddress: req.consignee.address1,
      consigneeCity: req.consignee.city,
      consigneeStateCode: req.consignee.state,
      consigneePostalCd: req.consignee.zip,
      pickupDate: req.pickupDate,
      pickupReadyTime: req.pickupReady ?? "08:00",
      pickupCloseTime: req.pickupClose ?? "17:00",
      commodities: req.items.map((item) => ({
        pieces: item.pieces,
        grossWeight: item.weight,
        freightClass: item.freightClass,
        description: item.description,
      })),
      referenceNumber: req.referenceNumber,
      poNumber: req.poNumber,
      accountNumber: this.creds.accountNumber,
      paymentTerms: req.paymentTerms ?? "PREPAID",
    };

    const data = await this.post<Record<string, unknown>>(
      "/shipment",
      payload,
      this.authHeaders,
    );

    return {
      bookingId: crypto.randomUUID(),
      proNumber: String(data.proNumber ?? ""),
      bolNumber: data.bolNumber ? String(data.bolNumber) : undefined,
      pickupConfirmation: data.pickupConfirmationNbr ? String(data.pickupConfirmationNbr) : undefined,
      estimatedDelivery: data.estimatedDeliveryDate ? String(data.estimatedDeliveryDate) : undefined,
      totalCharge: data.totalCharge ? Number(data.totalCharge) : undefined,
      status: "confirmed",
      carrier: "XPO Logistics",
      scac: "XPOF",
    };
  }

  async track(req: TrackingRequest): Promise<TrackingResponse> {
    const proNum = req.proNumber ?? req.trackingNumber ?? "";
    const data = await this.get<Record<string, unknown>>(
      `/shipment/tracking/${proNum}`,
      this.authHeaders,
    );

    const events = (data.trackingEvents as Record<string, unknown>[] ?? []).map((e) => ({
      timestamp: String(e.eventDateTime ?? ""),
      code: String(e.eventCode ?? ""),
      description: String(e.eventDescription ?? ""),
      city: e.eventCity ? String(e.eventCity) : undefined,
      state: e.eventState ? String(e.eventState) : undefined,
      zip: e.eventPostalCd ? String(e.eventPostalCd) : undefined,
      location: e.eventCity ? `${e.eventCity}, ${e.eventState}` : undefined,
    }));

    return {
      proNumber: proNum,
      scac: "XPOF",
      carrierName: "XPO Logistics",
      status: String(data.shipmentStatus ?? "UNKNOWN"),
      estimatedDelivery: data.estimatedDeliveryDate ? String(data.estimatedDeliveryDate) : undefined,
      actualDelivery: data.actualDeliveryDate ? String(data.actualDeliveryDate) : undefined,
      events,
    };
  }
}
