import { App, Editor, TFile } from "obsidian";
import { CLIPPING_PLACEHOLDER_MARKER } from "./templates";

/**
 * Represents the line range of a placeholder block in the editor
 */
export interface PlaceholderRange {
  startLine: number;
  endLine: number;
}

/**
 * Find the line range of a clipping placeholder block in the editor content.
 * Returns null if no placeholder is found.
 * 
 * @param editor - The editor to search in
 * @param includeTrailingBlanks - Whether to include trailing blank lines in the range
 */
export function findPlaceholderRange(
  editor: Editor,
  includeTrailingBlanks: boolean = true
): PlaceholderRange | null {
  const content = editor.getValue();
  
  // Quick check: is the marker present?
  if (!content.includes(CLIPPING_PLACEHOLDER_MARKER)) {
    return null;
  }
  
  const lines = content.split("\n");
  let placeholderStartLine = -1;
  let placeholderEndLine = -1;
  
  // Find the line containing the marker
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    if (lines[lineIndex].includes(CLIPPING_PLACEHOLDER_MARKER)) {
      placeholderStartLine = lineIndex;
      
      // Find the end of this block (next heading or block boundary)
      for (let endIndex = lineIndex + 1; endIndex < lines.length; endIndex++) {
        const line = lines[endIndex].trim();
        
        // End at next heading
        if (line.startsWith("###") || line.startsWith("##")) {
          placeholderEndLine = endIndex - 1;
          break;
        }
        
        // End at empty line followed by non-list content
        if (line === "" && endIndex + 1 < lines.length && !lines[endIndex + 1].trim().startsWith("-")) {
          placeholderEndLine = endIndex;
          break;
        }
      }
      
      // If no explicit end found, use end of file
      if (placeholderEndLine === -1) {
        placeholderEndLine = lines.length - 1;
      }
      break;
    }
  }
  
  if (placeholderStartLine === -1) {
    return null;
  }
  
  let startLine = placeholderStartLine;
  let endLine = Math.min(placeholderEndLine + 1, editor.lineCount() - 1);
  
  // Optionally include trailing blank lines to normalize spacing
  if (includeTrailingBlanks) {
    while (endLine < editor.lineCount() - 1 && editor.getLine(endLine + 1).trim() === "") {
      endLine++;
    }
  }
  
  return { startLine, endLine };
}

/**
 * Get current date in YYYY-MM-DD format
 */
export function getCurrentDateFormatted(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, "0");
  const day = now.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Convert a title to a safe filename
 * Removes or replaces characters that are invalid in filenames
 */
export function sanitizeFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "") // Remove invalid filename characters
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim()
    .substring(0, 200); // Limit length
}

/**
 * Known highlight section heading aliases.
 * Used to match the configured heading even with minor variations.
 * Keep this list minimal to avoid false positives.
 */
const HIGHLIGHT_HEADING_ALIASES = [
  "## 인상 깊은 문장 & 메모 (Voice)",
  "## 인상 깊은 문장 & 메모",
  "## Highlights",
  "## Voice Highlights",
  "## Book Highlights",
  "## 하이라이트",
  "## Voice Notes",
];

/**
 * Find the line number where highlights should be inserted.
 * Returns the line after the highlight section heading, or end of file if not found.
 * 
 * STRICT MATCHING: Only matches exact heading text or known aliases - NO substring matches.
 * This prevents inserting highlights into unrelated sections that happen to contain "Voice" etc.
 */
export function findHighlightSectionLine(content: string, headingText: string): number {
  const lines = content.split("\n");
  
  // Normalize the configured heading for comparison
  const normalizedHeading = headingText.trim();
  
  // Build the set of acceptable headings: configured + aliases
  // Case-insensitive matching via lowercase comparisons
  const acceptableHeadings = new Set<string>();
  
  // Add configured heading (both original and lowercase)
  acceptableHeadings.add(normalizedHeading);
  acceptableHeadings.add(normalizedHeading.toLowerCase());
  
  // Add aliases (both original and lowercase)
  for (const alias of HIGHLIGHT_HEADING_ALIASES) {
    const trimmed = alias.trim();
    acceptableHeadings.add(trimmed);
    acceptableHeadings.add(trimmed.toLowerCase());
  }
  
  // Look for the heading - STRICT exact match only (no substring/contains checks)
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    const lineLower = line.toLowerCase();
    
    // Check for exact match against configured heading or known aliases
    // NOTE: We explicitly do NOT use .includes() or regex partial matching
    if (acceptableHeadings.has(line) || acceptableHeadings.has(lineLower)) {
      // Found the heading, skip past any empty lines after it
      let targetLine = lineIndex + 1;
      while (targetLine < lines.length && lines[targetLine].trim() === "") {
        targetLine++;
      }
      return targetLine;
    }
  }
  
  // Heading not found, return end of file
  return lines.length;
}

/**
 * Check if a file has book frontmatter using regex (fallback for content-only checks).
 * Case-insensitive to handle "book", "Book", "BOOK", etc.
 */
export function isBookNote(content: string): boolean {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return false;
  }
  
  const frontmatter = frontmatterMatch[1];
  // Case-insensitive match for type: book (with optional quotes and whitespace)
  if (/type:\s*["']?\s*book\s*["']?/i.test(frontmatter)) {
    return true;
  }
  // Fallback heuristics for notes created before type was enforced
  return /\bkyobo\b/i.test(frontmatter) || /kyoboUrl\s*:/i.test(frontmatter);
}

/**
 * Check if a file is a book note using Obsidian's metadataCache (more reliable).
 * Normalizes type value (lowercase/trim) for case-insensitive matching.
 */
export function isBookNoteFromCache(app: App, file: TFile): boolean {
  const cache = app.metadataCache.getFileCache(file);
  
  // If cache has frontmatter, check the type field
  if (cache?.frontmatter) {
    const typeValue = cache.frontmatter.type ?? cache.frontmatter.Type;
    if (typeValue !== undefined) {
      const normalized = String(typeValue).toLowerCase().trim();
      if (normalized === "book") {
        return true;
      }
    }
    if (
      cache.frontmatter.kyobo !== undefined ||
      cache.frontmatter.kyoboUrl !== undefined ||
      cache.frontmatter.cover !== undefined ||
      cache.frontmatter.Cover !== undefined
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the frontmatter value for a given key using metadataCache
 */
export function getFrontmatterValueFromCache(app: App, file: TFile, key: string): string | null {
  const cache = app.metadataCache.getFileCache(file);
  if (!cache?.frontmatter) {
    return null;
  }
  const value = cache.frontmatter[key];
  return value !== undefined ? String(value) : null;
}

/**
 * Get the frontmatter value for a given key (string-based fallback)
 */
export function getFrontmatterValue(content: string, key: string): string | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }
  
  const frontmatter = frontmatterMatch[1];
  const keyMatch = frontmatter.match(new RegExp(`${key}:\\s*["']?([^"'\n]+)["']?`, "i"));
  return keyMatch ? keyMatch[1].trim() : null;
}

/**
 * Insert text at the highlight section, or at EOF if section not found.
 * Reads current editor content internally to avoid stale data.
 * Handles proper newline spacing for clean output.
 * SPACING FIX: Normalizes input text to end with exactly one newline to prevent double-blanks.
 */
export function insertHighlightBlock(
  editor: Editor,
  textToInsert: string,
  headingText: string = "## Voice Notes"
): void {
  // Normalize: ensure text ends with exactly one newline
  const normalizedText = textToInsert.replace(/\n*$/, "\n");
  
  // Read fresh content right before insertion to avoid stale data
  const content = editor.getValue();
  
  // Find the target line using the heading
  const targetLine = findHighlightSectionLine(content, headingText);
  const totalLines = editor.lineCount();
  
  // Determine if we're inserting at end of file or in the middle
  const isAtEndOfFile = targetLine >= totalLines;
  
  if (isAtEndOfFile) {
    // Inserting at end of file
    const lastLine = editor.lastLine();
    const lastLineContent = editor.getLine(lastLine);
    const needsNewline = lastLineContent.trim() !== "";
    const prefix = needsNewline ? "\n\n" : "\n";
    const position = { line: lastLine, ch: lastLineContent.length };
    editor.replaceRange(prefix + normalizedText, position);
  } else {
    // Insert at the target line (after the heading section)
    const lineContent = editor.getLine(targetLine);
    const prevLineContent = targetLine > 0 ? editor.getLine(targetLine - 1) : "";
    
    // Add blank line before if needed for readability
    const needsBlankLineBefore = lineContent.trim().length > 0 || 
      (prevLineContent.trim().startsWith("##"));
    
    const prefix = needsBlankLineBefore ? "\n" : "";
    const position = { line: targetLine, ch: 0 };
    editor.replaceRange(prefix + normalizedText, position);
  }
}

/**
 * Ensure a folder exists, creating it recursively if necessary.
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  // Normalize the path (remove trailing slashes, handle empty)
  const normalizedPath = folderPath.replace(/\/+$/, "").trim();
  if (!normalizedPath) {
    return;
  }

  // Check if folder already exists
  const existingFolder = app.vault.getAbstractFileByPath(normalizedPath);
  if (existingFolder) {
    return;
  }

  // Split path and create folders recursively
  const parts = normalizedPath.split("/");
  let currentPath = "";
  
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folder = app.vault.getAbstractFileByPath(currentPath);
    if (!folder) {
      try {
        await app.vault.createFolder(currentPath);
      } catch (error) {
        // Folder might have been created by another process, ignore if it exists now
        const checkAgain = app.vault.getAbstractFileByPath(currentPath);
        if (!checkAgain) {
          throw error;
        }
      }
    }
  }
}

/**
 * Get the full path for a book note
 */
export function getBookNotePath(booksFolder: string, title: string): string {
  const sanitizedTitle = sanitizeFilename(title);
  return `${booksFolder}/${sanitizedTitle}.md`;
}

/**
 * Parse template placeholders and return list of used placeholders
 */
export function getTemplatePlaceholders(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(match => match.replace(/\{\{|\}\}/g, "")))];
}

/**
 * Move cursor to the highlight section or end of file
 */
export function moveCursorToHighlightSection(
  editor: Editor,
  headingText: string = "## Voice Notes"
): void {
  const content = editor.getValue();
  const targetLine = findHighlightSectionLine(content, headingText);
  const totalLines = editor.lineCount();
  
  // If target is beyond file, go to last line
  const line = Math.min(targetLine, totalLines - 1);
  const lineContent = editor.getLine(line);
  
  editor.setCursor({ line, ch: lineContent.length });
}

/**
 * Replace the clipping placeholder with new content.
 * Normalizes surrounding blank lines to avoid double-spacing.
 * Handles edge cases where user may have edited near the placeholder during recording.
 * Returns true if placeholder was found and replaced, false otherwise.
 */
export function replacePlaceholder(
  editor: Editor,
  newContent: string,
  fallbackHeading: string = "## Voice Notes"
): boolean {
  const range = findPlaceholderRange(editor, true);
  
  if (!range) {
    // Placeholder not found, insert at highlight section as fallback
    insertHighlightBlock(editor, newContent, fallbackHeading);
    return false;
  }
  
  let { startLine, endLine } = range;
  
  // Normalize: ensure content ends with exactly one newline
  let normalizedContent = newContent.replace(/\n*$/, "\n");
  
  // Check for excess blank lines before the placeholder and adjust
  // This handles cases where user edited the file during recording
  let precedingBlankLines = 0;
  while (startLine > 0 && editor.getLine(startLine - 1).trim() === "") {
    precedingBlankLines++;
    if (precedingBlankLines > 2) {
      // Absorb excess blank lines into replacement range
      startLine--;
      precedingBlankLines = 0; // Reset counter
    } else {
      break;
    }
  }
  
  // Check for excess blank lines after and adjust
  const lineCount = editor.lineCount();
  while (endLine < lineCount - 1 && editor.getLine(endLine + 1).trim() === "") {
    const nextNextLine = endLine + 2 < lineCount ? editor.getLine(endLine + 2).trim() : "";
    // Only absorb if there are 2+ consecutive blank lines
    if (nextNextLine === "") {
      endLine++;
    } else {
      break;
    }
  }
  
  const startPos = { line: startLine, ch: 0 };
  const endPos = { line: endLine, ch: editor.getLine(endLine).length };
  
  editor.replaceRange(normalizedContent, startPos, endPos);
  return true;
}

/**
 * Remove the clipping placeholder from the editor.
 * Normalizes surrounding blank lines to avoid double-spacing.
 * Handles user edits during recording that may have added extra blank lines.
 * Returns true if placeholder was found and removed, false otherwise.
 */
export function removePlaceholderBlock(editor: Editor): boolean {
  const range = findPlaceholderRange(editor, true);
  
  if (!range) {
    return false;
  }
  
  let { startLine, endLine } = range;
  
  // Count and absorb excess preceding blank lines (normalize to max 1)
  let precedingBlanks = 0;
  while (startLine > 0 && editor.getLine(startLine - 1).trim() === "") {
    precedingBlanks++;
    startLine--;
  }
  
  // Count and absorb excess following blank lines (normalize to max 1)
  const lineCount = editor.lineCount();
  let followingBlanks = 0;
  while (endLine < lineCount - 1 && editor.getLine(endLine + 1).trim() === "") {
    followingBlanks++;
    endLine++;
  }
  
  const startPos = { line: startLine, ch: 0 };
  const endPos = { line: endLine, ch: editor.getLine(endLine).length };
  
  // Determine replacement: keep at most one blank line for section spacing
  // If there were blank lines before AND after, keep one; otherwise keep none
  const hadSurroundingBlanks = precedingBlanks > 0 || followingBlanks > 0;
  const replacement = hadSurroundingBlanks ? "\n" : "";
  
  editor.replaceRange(replacement, startPos, endPos);
  return true;
}
