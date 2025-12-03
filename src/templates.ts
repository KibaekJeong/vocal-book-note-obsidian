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
    language: meta.language || "",
    date: today,
    currentDate: today,
  };

  // Aliases that match Obsidian clipper placeholders
  replacements["meta:property:eg:category2_name"] = meta.genre || "";
  replacements["schema:@Book:description"] = meta.description || "";
  replacements["schema:@Book:workExample[0].datePublished"] = meta.publishedDate || "";
  replacements["schema:@Book:aggregateRating.ratingValue"] = meta.rating || "";
  replacements["schema:@Book:keywords"] = meta.topics || "";

  let rendered = template.replace(/\{\{([^}]+)\}\}/g, (_, rawKey: string) => {
    const key = rawKey.trim();
    const value = replacements[key];
    return value !== undefined ? value : "";
  });

  rendered = ensureBookFrontmatter(rendered);

  return rendered;
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
 * Single line format: note (page, date)
 */
export function createDefaultHighlightBlock(transcription: TranscriptionResult): string {
  const date = getCurrentDateFormatted();
  const page = transcription.page || "?";
  
  // Use note if present, otherwise fall back to full text
  const content = transcription.note || transcription.text || "";
  
  return `- ${content} (p.${page}, ${date})\n`;
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
  
  return `- (녹음 중...) (p.?, ${date}) ${CLIPPING_PLACEHOLDER_MARKER}
`;
}

function ensureBookFrontmatter(content: string): string {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

  if (!frontmatterMatch) {
    return `---\ntype: book\n---\n${content}`.trimStart();
  }

  const body = frontmatterMatch[1];
  if (/^\s*type\s*:\s*["']?\s*book\s*["']?/im.test(body)) {
    return content;
  }

  const updatedFrontmatter = `---\ntype: book\n${body.trim() ? `${body.trim()}\n` : ""}---`;
  return content.replace(frontmatterMatch[0], `${updatedFrontmatter}`);
}
