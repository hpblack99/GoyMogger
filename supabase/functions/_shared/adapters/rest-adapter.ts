import { BaseCarrierAdapter } from "./base.ts";

export abstract class RestCarrierAdapter extends BaseCarrierAdapter {
  protected get baseUrl(): string {
    return this.config.baseUrl as string;
  }

  protected async get<T>(path: string, headers?: Record<string, string>): Promise<T> {
    const resp = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "GET",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return resp.json() as Promise<T>;
  }

  protected async post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const resp = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return resp.json() as Promise<T>;
  }

  protected async put<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    const resp = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
    return resp.json() as Promise<T>;
  }
}
