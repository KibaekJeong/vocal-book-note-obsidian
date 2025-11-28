import { App, Editor } from "obsidian";

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
 * Find the position in the content where highlights should be inserted
 * Returns the line number after the highlight section heading
 */
export function findHighlightSectionLine(content: string, headingText: string): number {
  const lines = content.split("\n");
  
  // Look for the heading
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.includes(headingText) || line.includes("인상 깊은 문장") || line.includes("Voice")) {
      // Found the heading, return the next line after any empty lines
      let targetLine = lineIndex + 1;
      while (targetLine < lines.length && lines[targetLine].trim() === "") {
        targetLine++;
      }
      // If we're at content, go back one line to insert before it
      // If we're at end or still empty, use that position
      return targetLine;
    }
  }
  
  // Heading not found, return end of file
  return lines.length;
}

/**
 * Check if a file has book frontmatter
 */
export function isBookNote(content: string): boolean {
  // Check for type: book in frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return false;
  }
  
  const frontmatter = frontmatterMatch[1];
  return /type:\s*["']?book["']?/i.test(frontmatter);
}

/**
 * Get the frontmatter value for a given key
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
 * Insert text at the end of a specific section or end of file
 */
export function insertAtHighlightSection(
  editor: Editor,
  content: string,
  textToInsert: string,
  headingText: string = "## 인상 깊은 문장 & 메모 (Voice)"
): void {
  const lastLine = editor.lastLine();
  
  // Ensure we have proper spacing
  const currentLastLineContent = editor.getLine(lastLine);
  const needsNewline = currentLastLineContent.trim() !== "";
  
  // Insert at end of file with proper spacing
  const prefix = needsNewline ? "\n\n" : "\n";
  const position = { line: lastLine, ch: editor.getLine(lastLine).length };
  
  editor.replaceRange(prefix + textToInsert, position);
}

/**
 * Ensure a folder exists, creating it if necessary
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (!folder) {
    await app.vault.createFolder(folderPath);
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
