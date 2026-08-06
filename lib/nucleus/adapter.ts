export type NucleusCredentials = { email: string; password: string };

export type NucleusAdapter = {
  authenticate(credentials: NucleusCredentials): Promise<void>;
  extractOrders(): Promise<unknown[]>;
  close(): Promise<void>;
};

/**
 * Integration boundary for the Playwright worker. The browser worker should implement
 * this contract and keep credentials/session state in memory only.
 */
export function createNucleusAdapter(): NucleusAdapter {
  throw new Error("Nucleus Playwright worker is not configured. Set NUCLEUS_WORKER_URL.");
}
