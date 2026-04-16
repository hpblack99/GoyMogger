import { BaseCarrierAdapter } from "./base.ts";

export abstract class SoapCarrierAdapter extends BaseCarrierAdapter {
  protected buildEnvelope(body: string, namespace?: string): string {
    const ns = namespace ? ` xmlns:ns="${namespace}"` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"${ns}>
  <soap:Header/>
  <soap:Body>${body}</soap:Body>
</soap:Envelope>`;
  }

  protected async soapRequest(
    endpoint: string,
    action: string,
    body: string,
    namespace?: string,
  ): Promise<string> {
    const resp = await this.fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        SOAPAction: action,
      },
      body: this.buildEnvelope(body, namespace),
    });
    if (!resp.ok) throw new Error(`SOAP ${resp.status}: ${await resp.text()}`);
    return resp.text();
  }

  protected parseXml(xml: string): Document {
    return new DOMParser().parseFromString(xml, "text/xml");
  }

  protected xmlValue(doc: Document, tag: string): string | null {
    return doc.getElementsByTagName(tag)[0]?.textContent ?? null;
  }

  protected xmlValues(doc: Document, tag: string): string[] {
    return Array.from(doc.getElementsByTagName(tag)).map((el) => el.textContent ?? "");
  }

  protected xmlFloat(doc: Document, tag: string, fallback = 0): number {
    return parseFloat(this.xmlValue(doc, tag) ?? String(fallback)) || fallback;
  }

  protected xmlInt(doc: Document, tag: string, fallback = 0): number {
    return parseInt(this.xmlValue(doc, tag) ?? String(fallback)) || fallback;
  }
}
