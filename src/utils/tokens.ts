import { encodingForModel, getEncoding, Tiktoken } from "js-tiktoken";

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken | null {
  if (encoder) {
    return encoder;
  }
  try {
    encoder = encodingForModel("gpt-4o-mini");
    return encoder;
  } catch {
    try {
      encoder = getEncoding("cl100k_base");
      return encoder;
    } catch {
      return null;
    }
  }
}

export function countTokens(text: string): number {
  const enc = getEncoder();
  if (!enc) {
    return Math.ceil(text.length / 4);
  }
  return enc.encode(text).length;
}
