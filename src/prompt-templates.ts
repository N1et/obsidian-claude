export type TransformType =
  | 'improve'
  | 'grammar'
  | 'shorter'
  | 'longer'
  | 'summarize'
  | 'explain'
  | 'continue'
  | 'translate'
  | 'custom';

const TRANSFORM_INSTRUCTIONS: Record<string, string> = {
  improve: 'Improve the clarity, grammar, and readability of the following text. Return ONLY the improved text, nothing else.',
  grammar: 'Fix all grammar, spelling, and punctuation errors in the following text. Return ONLY the corrected text, nothing else.',
  shorter: 'Make the following text more concise while preserving all key information. Return ONLY the shortened text, nothing else.',
  longer: 'Expand the following text with more detail and explanation. Return ONLY the expanded text, nothing else.',
  summarize: 'Summarize the following text in a concise paragraph. Return ONLY the summary, nothing else.',
  explain: 'Explain the following text in simple, easy-to-understand terms. Return ONLY the explanation, nothing else.',
  continue: 'Continue writing from where the following text ends. Match the existing style and tone. Return ONLY the continuation text, nothing else.',
};

export function buildTransformPrompt(type: TransformType, selectedText: string, extra?: string): string {
  if (type === 'translate') {
    const lang = extra || 'English';
    return `Translate the following text to ${lang}. Return ONLY the translated text, nothing else.\n\n${selectedText}`;
  }

  if (type === 'custom') {
    const instruction = extra || 'Improve this text';
    return `${instruction}\n\nReturn ONLY the result, nothing else.\n\n${selectedText}`;
  }

  const instruction = TRANSFORM_INSTRUCTIONS[type];
  return `${instruction}\n\n${selectedText}`;
}

export function buildInlinePrompt(action: string, noteContent: string, precedingText?: string): string {
  if (action === 'continue') {
    const context = precedingText || noteContent;
    return `Continue writing from where this text ends. Match the existing style, tone, and format. Return ONLY the continuation, nothing else.\n\n${context}`;
  }

  if (action === 'summarize') {
    return `Summarize the following note in a concise paragraph. Return ONLY the summary in Markdown, nothing else.\n\n${noteContent}`;
  }

  if (action === 'outline') {
    return `Generate a structured outline for the following note content. Return ONLY the outline in Markdown format, nothing else.\n\n${noteContent}`;
  }

  // Custom prompt
  return `${action}\n\nNote content for context:\n${noteContent}\n\nReturn ONLY the result in Markdown, nothing else.`;
}
