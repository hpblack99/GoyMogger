import type {
  Carrier,
  CarrierCredential,
  CarrierRate,
  BookingRequest,
  BookingResponse,
  RateRequest,
  TrackingRequest,
  TrackingResponse,
} from "../types.ts";

export abstract class BaseCarrierAdapter {
  constructor(
    protected carrier: Carrier,
    protected credentials: CarrierCredential,
  ) {}

  abstract getRates(request: RateRequest): Promise<CarrierRate[]>;
  abstract book(request: BookingRequest): Promise<BookingResponse>;
  abstract track(request: TrackingRequest): Promise<TrackingResponse>;

  protected get scac(): string { return this.carrier.scac; }
  protected get name(): string { return this.carrier.name; }
  protected get config(): Record<string, unknown> { return this.carrier.config; }
  protected get creds(): Record<string, string> { return this.credentials.credentials; }
  protected get timeout(): number { return this.carrier.timeoutMs; }

  protected async fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeout);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(id);
    }
  }
}
