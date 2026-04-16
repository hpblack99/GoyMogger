export interface Address {
  name?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
  isResidential?: boolean;
}

export interface FreightItem {
  pieces: number;
  weight: number;
  weightUom?: "LBS" | "KGS";
  length?: number;
  width?: number;
  height?: number;
  dimUom?: "IN" | "CM";
  freightClass?: string;
  nmfc?: string;
  description: string;
  hazmat?: boolean;
  stackable?: boolean;
}

export interface AccessorialCharge {
  code: string;
  description: string;
  amount: number;
}

export interface RateBreakdown {
  freightCharge: number;
  fuelSurcharge: number;
  accessorialCharges?: AccessorialCharge[];
  discount?: number;
  discountPercent?: number;
}

export interface CarrierRate {
  scac: string;
  carrierName: string;
  serviceLevel: string;
  transitDays: number;
  totalCharge: number;
  currency: string;
  effectiveDate: string;
  expiryDate?: string;
  quoteId?: string;
  breakdown?: RateBreakdown;
  guaranteedDelivery?: boolean;
}

export interface CarrierError {
  scac: string;
  carrierName: string;
  errorCode?: string;
  message: string;
}

export interface RateRequest {
  shipper: Address;
  consignee: Address;
  items: FreightItem[];
  pickupDate?: string;
  serviceTypes?: string[];
  accessorials?: string[];
  insuranceValue?: number;
  referenceNumber?: string;
  requestedCarriers?: string[];
}

export interface RateResponse {
  requestId: string;
  rates: CarrierRate[];
  errors: CarrierError[];
  processedAt: string;
  processingTimeMs: number;
}

export interface BookingRequest {
  rateRequestId?: string;
  quoteId?: string;
  scac: string;
  shipper: Address;
  consignee: Address;
  items: FreightItem[];
  pickupDate: string;
  pickupReady?: string;
  pickupClose?: string;
  deliveryDate?: string;
  accessorials?: string[];
  specialInstructions?: string;
  referenceNumber?: string;
  poNumber?: string;
  bolNumber?: string;
  insuranceValue?: number;
  paymentTerms?: "PREPAID" | "COLLECT" | "THIRD_PARTY";
}

export interface BookingResponse {
  bookingId: string;
  proNumber: string;
  bolNumber?: string;
  pickupConfirmation?: string;
  estimatedDelivery?: string;
  totalCharge?: number;
  labelUrl?: string;
  bolUrl?: string;
  status: string;
  carrier: string;
  scac: string;
}

export interface TrackingRequest {
  scac: string;
  proNumber?: string;
  bolNumber?: string;
  trackingNumber?: string;
}

export interface TrackingEvent {
  timestamp: string;
  code: string;
  description: string;
  city?: string;
  state?: string;
  zip?: string;
  location?: string;
}

export interface TrackingResponse {
  proNumber: string;
  scac: string;
  carrierName: string;
  status: string;
  estimatedDelivery?: string;
  actualDelivery?: string;
  events: TrackingEvent[];
  shipper?: Partial<Address>;
  consignee?: Partial<Address>;
}

export interface ApiCustomer {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  isActive: boolean;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  allowedEndpoints: string[];
}

export interface Carrier {
  id: string;
  scac: string;
  name: string;
  apiType: "rest" | "soap" | "edi";
  isActive: boolean;
  supportsRates: boolean;
  supportsBooking: boolean;
  supportsTracking: boolean;
  timeoutMs: number;
  config: Record<string, unknown>;
}

export interface CarrierCredential {
  carrierId: string;
  customerId: string;
  credentials: Record<string, string>;
  environment: "test" | "production";
}
