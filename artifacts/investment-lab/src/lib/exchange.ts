import { BaseCurrency, PreferredExchange } from "./types";

/**
 * Maps a base currency to its natural preferred exchange.
 * Used by Build/Compare forms to auto-sync the exchange when
 * the user switches base currency.
 *
 * USD → None (global), EUR → XETRA, CHF → SIX, GBP → LSE.
 */
export const DEFAULT_EXCHANGE_FOR_CURRENCY: Record<BaseCurrency, PreferredExchange> = {
  USD: "None",
  EUR: "XETRA",
  CHF: "SIX",
  GBP: "LSE",
};

export function defaultExchangeFor(ccy: BaseCurrency): PreferredExchange {
  return DEFAULT_EXCHANGE_FOR_CURRENCY[ccy];
}
