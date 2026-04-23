const RF_KEY = "idl.riskFreeRate";
const RF_EVENT = "idl-rf-changed";
const RF_DEFAULT = 0.025;

export function getRiskFreeRate(): number {
  if (typeof window === "undefined") return RF_DEFAULT;
  const raw = window.localStorage.getItem(RF_KEY);
  if (raw === null) return RF_DEFAULT;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0 || v > 0.2) return RF_DEFAULT;
  return v;
}

export function setRiskFreeRate(rate: number) {
  if (typeof window === "undefined") return;
  const clamped = Math.max(0, Math.min(0.2, rate));
  window.localStorage.setItem(RF_KEY, String(clamped));
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: clamped }));
}

export function resetRiskFreeRate() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(RF_KEY);
  window.dispatchEvent(new CustomEvent(RF_EVENT, { detail: RF_DEFAULT }));
}

export function subscribeRiskFreeRate(cb: (rate: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (typeof detail === "number") cb(detail);
  };
  window.addEventListener(RF_EVENT, handler);
  return () => window.removeEventListener(RF_EVENT, handler);
}

export const RF_DEFAULT_RATE = RF_DEFAULT;
