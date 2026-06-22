export function detectFirstCompleteSentence(text: string): string | null {
  const sentenceMatch = text.match(/^(.+?[.!?])(\s|$)/);
  return sentenceMatch ? sentenceMatch[1] : null;
}
