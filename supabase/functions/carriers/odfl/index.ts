import { SoapCarrierAdapter } from "../../_shared/adapters/soap-adapter.ts";
import type {
  BookingRequest,
  BookingResponse,
  CarrierRate,
  RateRequest,
  TrackingRequest,
  TrackingResponse,
} from "../../_shared/types.ts";

// Old Dominion Freight Line SOAP adapter
// Docs: https://www.odfl.com/us/en/tools-resources/odfl4me/api-reference.html
export default class ODFLAdapter extends SoapCarrierAdapter {
  private get rateEndpoint(): string {
    return String(this.config.rateUrl ?? "https://www.odfl.com/ws/soap/rate/v4/OdflRateService");
  }

  private get trackEndpoint(): string {
    return String(
      this.config.trackUrl ?? "https://www.odfl.com/ws/soap/track/v4/OdflTrackService",
    );
  }

  private get bookEndpoint(): string {
    return String(this.config.bookUrl ?? "https://www.odfl.com/ws/soap/pickup/v1/OdflPickupService");
  }

  async getRates(req: RateRequest): Promise<CarrierRate[]> {
    const itemsXml = req.items
      .map(
        (item) => `
        <ns:freightItems>
          <ns:pieces>${item.pieces}</ns:pieces>
          <ns:weight>${item.weight}</ns:weight>
          <ns:freightClass>${item.freightClass ?? "70"}</ns:freightClass>
          <ns:description>${item.description}</ns:description>
          ${item.hazmat ? "<ns:hazmat>true</ns:hazmat>" : ""}
        </ns:freightItems>`,
      )
      .join("");

    const body = `
      <ns:getRateEstimate>
        <ns:rateRequest>
          <ns:originCity>${req.shipper.city}</ns:originCity>
          <ns:originStateCode>${req.shipper.state}</ns:originStateCode>
          <ns:originPostalCode>${req.shipper.zip}</ns:originPostalCode>
          <ns:destinationCity>${req.consignee.city}</ns:destinationCity>
          <ns:destinationStateCode>${req.consignee.state}</ns:destinationStateCode>
          <ns:destinationPostalCode>${req.consignee.zip}</ns:destinationPostalCode>
          <ns:shipDate>${req.pickupDate ?? new Date().toISOString().slice(0, 10)}</ns:shipDate>
          <ns:tariffType>CWZONE</ns:tariffType>
          ${itemsXml}
          <ns:userName>${this.creds.username}</ns:userName>
          <ns:password>${this.creds.password}</ns:password>
          <ns:accountNumber>${this.creds.accountNumber}</ns:accountNumber>
        </ns:rateRequest>
      </ns:getRateEstimate>`;

    const xml = await this.soapRequest(
      this.rateEndpoint,
      "getRateEstimate",
      body,
      "http://www.odfl.com/RateQuote_v4",
    );

    const doc = this.parseXml(xml);

    return [
      {
        scac: "ODFL",
        carrierName: "Old Dominion Freight Line",
        serviceLevel: "LTL",
        transitDays: this.xmlInt(doc, "transitDays"),
        totalCharge: this.xmlFloat(doc, "totalCharge"),
        currency: "USD",
        effectiveDate: this.xmlValue(doc, "effectiveDate") ?? new Date().toISOString().slice(0, 10),
        breakdown: {
          freightCharge: this.xmlFloat(doc, "freightCharge"),
          fuelSurcharge: this.xmlFloat(doc, "fuelSurcharge"),
        },
      },
    ];
  }

  async book(req: BookingRequest): Promise<BookingResponse> {
    const itemsXml = req.items
      .map(
        (item) => `
        <ns:commodity>
          <ns:pieces>${item.pieces}</ns:pieces>
          <ns:weight>${item.weight}</ns:weight>
          <ns:freightClass>${item.freightClass ?? "70"}</ns:freightClass>
          <ns:description>${item.description}</ns:description>
        </ns:commodity>`,
      )
      .join("");

    const body = `
      <ns:createPickup>
        <ns:pickupRequest>
          <ns:shipperName>${req.shipper.name ?? ""}</ns:shipperName>
          <ns:shipperAddress>${req.shipper.address1}</ns:shipperAddress>
          <ns:shipperCity>${req.shipper.city}</ns:shipperCity>
          <ns:shipperState>${req.shipper.state}</ns:shipperState>
          <ns:shipperZip>${req.shipper.zip}</ns:shipperZip>
          <ns:shipperPhone>${req.shipper.phone ?? ""}</ns:shipperPhone>
          <ns:consigneeName>${req.consignee.name ?? ""}</ns:consigneeName>
          <ns:consigneeCity>${req.consignee.city}</ns:consigneeCity>
          <ns:consigneeState>${req.consignee.state}</ns:consigneeState>
          <ns:consigneeZip>${req.consignee.zip}</ns:consigneeZip>
          <ns:pickupDate>${req.pickupDate}</ns:pickupDate>
          <ns:pickupReadyTime>${req.pickupReady ?? "0800"}</ns:pickupReadyTime>
          <ns:pickupCloseTime>${req.pickupClose ?? "1700"}</ns:pickupCloseTime>
          <ns:referenceNumber>${req.referenceNumber ?? ""}</ns:referenceNumber>
          ${itemsXml}
          <ns:userName>${this.creds.username}</ns:userName>
          <ns:password>${this.creds.password}</ns:password>
          <ns:accountNumber>${this.creds.accountNumber}</ns:accountNumber>
        </ns:pickupRequest>
      </ns:createPickup>`;

    const xml = await this.soapRequest(
      this.bookEndpoint,
      "createPickup",
      body,
      "http://www.odfl.com/Pickup_v1",
    );

    const doc = this.parseXml(xml);

    return {
      bookingId: crypto.randomUUID(),
      proNumber: this.xmlValue(doc, "proNumber") ?? "",
      bolNumber: this.xmlValue(doc, "bolNumber") ?? undefined,
      pickupConfirmation: this.xmlValue(doc, "confirmationNumber") ?? undefined,
      estimatedDelivery: this.xmlValue(doc, "estimatedDelivery") ?? undefined,
      status: "confirmed",
      carrier: "Old Dominion Freight Line",
      scac: "ODFL",
    };
  }

  async track(req: TrackingRequest): Promise<TrackingResponse> {
    const proNum = req.proNumber ?? req.trackingNumber ?? "";

    const body = `
      <ns:getTrackingInfo>
        <ns:trackingRequest>
          <ns:proNumber>${proNum}</ns:proNumber>
          <ns:userName>${this.creds.username}</ns:userName>
          <ns:password>${this.creds.password}</ns:password>
        </ns:trackingRequest>
      </ns:getTrackingInfo>`;

    const xml = await this.soapRequest(
      this.trackEndpoint,
      "getTrackingInfo",
      body,
      "http://www.odfl.com/TrackingService_v4",
    );

    const doc = this.parseXml(xml);
    const eventEls = doc.getElementsByTagName("trackingEvent");

    const events = Array.from(eventEls).map((el) => ({
      timestamp: el.getElementsByTagName("eventDateTime")[0]?.textContent ?? "",
      code: el.getElementsByTagName("eventCode")[0]?.textContent ?? "",
      description: el.getElementsByTagName("eventDescription")[0]?.textContent ?? "",
      city: el.getElementsByTagName("eventCity")[0]?.textContent ?? undefined,
      state: el.getElementsByTagName("eventState")[0]?.textContent ?? undefined,
      zip: el.getElementsByTagName("eventPostalCode")[0]?.textContent ?? undefined,
    }));

    return {
      proNumber: proNum,
      scac: "ODFL",
      carrierName: "Old Dominion Freight Line",
      status: this.xmlValue(doc, "shipmentStatus") ?? "UNKNOWN",
      estimatedDelivery: this.xmlValue(doc, "estimatedDelivery") ?? undefined,
      actualDelivery: this.xmlValue(doc, "deliveredDate") ?? undefined,
      events,
    };
  }
}
