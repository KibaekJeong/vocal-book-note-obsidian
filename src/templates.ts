import { BookMeta } from "./kyobo";
import { TranscriptionResult } from "./voice";
import { getCurrentDateFormatted } from "./util";

/**
 * Render the book note template with book metadata
 */
export function renderBookNoteTemplate(template: string, meta: BookMeta): string {
  return template
    .replace(/\{\{title\}\}/g, meta.title || "")
    .replace(/\{\{author\}\}/g, meta.author || "")
    .replace(/\{\{publisher\}\}/g, meta.publisher || "")
    .replace(/\{\{publishedDate\}\}/g, meta.publishedDate || "")
    .replace(/\{\{isbn\}\}/g, meta.isbn || "")
    .replace(/\{\{kyoboUrl\}\}/g, meta.kyoboUrl || "");
}

/**
 * Render the highlight block template with transcription data
 */
export function renderHighlightTemplate(
  template: string,
  transcription: TranscriptionResult
): string {
  const date = getCurrentDateFormatted();
  
  // Handle empty page - show "?" or skip the page line entirely
  const page = transcription.page || "?";
  const quote = transcription.quote || "(음성 인식 실패)";
  const note = transcription.note || "";

  return template
    .replace(/\{\{page\}\}/g, page)
    .replace(/\{\{quote\}\}/g, quote)
    .replace(/\{\{note\}\}/g, note)
    .replace(/\{\{date\}\}/g, date);
}

/**
 * Create a simple highlight block when no template is provided
 */
export function createDefaultHighlightBlock(transcription: TranscriptionResult): string {
  const date = getCurrentDateFormatted();
  const page = transcription.page || "?";
  
  let block = `### p.${page}\n\n`;
  
  if (transcription.quote) {
    block += `> ${transcription.quote}\n\n`;
  }
  
  if (transcription.note) {
    block += `- 메모: ${transcription.note}\n`;
  }
  
  block += `- 캡처일: ${date}\n\n`;
  
  return block;
}
