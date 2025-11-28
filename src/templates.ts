import { BookMeta } from "./kyobo";
import { TranscriptionResult } from "./voice";
import { getCurrentDateFormatted } from "./util";

/**
 * Render the book note template with book metadata
 */
export function renderBookNoteTemplate(template: string, meta: BookMeta): string {
  const today = getCurrentDateFormatted();
  const replacements: Record<string, string> = {
    title: meta.title || "",
    author: meta.author || "",
    publisher: meta.publisher || "",
    publishedDate: meta.publishedDate || "",
    isbn: meta.isbn || "",
    kyoboUrl: meta.kyoboUrl || "",
    coverImage: meta.coverImage || "",
    image: meta.coverImage || "",
    description: meta.description || "",
    genre: meta.genre || "",
    topics: meta.topics || "",
    rating: meta.rating || "",
    date: today,
    currentDate: today,
  };

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = replacements[key];
    return value !== undefined ? value : "";
  });
}

/**
 * Render the highlight block template with transcription data.
 * SIMPLIFIED: Builds clean output directly by conditionally including lines.
 */
export function renderHighlightTemplate(
  template: string,
  transcription: TranscriptionResult
): string {
  const date = getCurrentDateFormatted();
  const page = transcription.page || "?";
  
  // Determine what content we have
  const hasQuote = Boolean(transcription.quote);
  const hasNote = Boolean(transcription.note);
  
  // Fallback: if neither quote nor note, use full text as note
  const quote = transcription.quote || "";
  const note = transcription.note || (hasQuote ? "" : transcription.text) || "";
  
  // Build the result by processing template line by line
  // This avoids post-render cleanup by skipping empty lines during rendering
  const lines = template.split("\n");
  const resultLines: string[] = [];
  
  for (const line of lines) {
    let processedLine = line
      .replace(/\{\{page\}\}/g, page)
      .replace(/\{\{date\}\}/g, date);
    
    // Handle quote line - skip if empty
    if (line.includes("{{quote}}")) {
      if (hasQuote) {
        processedLine = processedLine.replace(/\{\{quote\}\}/g, quote);
        resultLines.push(processedLine);
      }
      // Skip the line entirely if quote is empty (don't add empty "> " lines)
      continue;
    }
    
    // Handle note/memo line - skip if truly empty (but note has fallback)
    if (line.includes("{{note}}")) {
      if (note) {
        processedLine = processedLine.replace(/\{\{note\}\}/g, note);
        resultLines.push(processedLine);
      }
      // Skip the line entirely if note is empty
      continue;
    }
    
    // Regular line - just add it
    resultLines.push(processedLine);
  }
  
  // Join and clean up multiple blank lines
  let result = resultLines.join("\n");
  result = result.replace(/\n{3,}/g, "\n\n");
  
  // Ensure ends with single newline
  result = result.replace(/\s*$/, "\n");
  
  return result;
}

/**
 * Create a simple highlight block when no template is provided.
 * Builds output directly without cleanup steps.
 */
export function createDefaultHighlightBlock(transcription: TranscriptionResult): string {
  const date = getCurrentDateFormatted();
  const page = transcription.page || "?";
  
  let block = `### p.${page}\n\n`;
  
  // Only add quote block if there's actual content
  if (transcription.quote) {
    block += `> ${transcription.quote}\n\n`;
  }
  
  // Memo: use note if present, otherwise fall back to full text
  const memoContent = transcription.note || transcription.text || "";
  if (memoContent) {
    block += `- 메모: ${memoContent}\n`;
  }
  
  block += `- 캡처일: ${date}\n\n`;
  
  return block;
}

/**
 * Unique marker for the clipping placeholder to enable replacement after transcription.
 */
export const CLIPPING_PLACEHOLDER_MARKER = "<!-- book-voice-capture-placeholder -->";

/**
 * Create a clipping placeholder block that will be shown while recording.
 * This placeholder is inserted before voice recording starts and can be
 * replaced/appended when transcription completes.
 * NOTE: Ends with single newline; insertHighlightBlock handles spacing.
 */
export function createClippingPlaceholder(): string {
  const date = getCurrentDateFormatted();
  
  return `### p.? (클리핑 임시) ${CLIPPING_PLACEHOLDER_MARKER}

- 메모: (녹음 예정)
- 캡처일: ${date}
`;
}
