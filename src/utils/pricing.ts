export const OPUS_46_INPUT_USD_PER_MTOKENS = 5;

export function estimateUsdFromTokens(savedTokens: number): number {
  return (Math.max(0, savedTokens) / 1_000_000) * OPUS_46_INPUT_USD_PER_MTOKENS;
}

export function formatUsd(value: number): string {
  const amount = Math.max(0, value);
  if (amount >= 1000) {
    return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (amount >= 1) {
    return `$${amount.toFixed(2)}`;
  }
  if (amount >= 0.01) {
    return `$${amount.toFixed(3)}`;
  }
  return `$${amount.toFixed(4)}`;
}
