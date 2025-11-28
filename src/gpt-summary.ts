import { requestUrl, RequestUrlResponse } from "obsidian";
import { BookMeta } from "./kyobo";

/**
 * GPT Summary section marker for idempotency checks
 */
export const GPT_SUMMARY_SECTION = "## GPT Summary";

/**
 * Result from GPT summary generation
 */
export interface GptSummaryResult {
  summary: string;
  keyPoints: string[];
  quotes: string[];
}

/**
 * Build the prompt for GPT to generate book summary, key points, and quotes
 */
function buildGptPrompt(meta: BookMeta): string {
  const metaLines: string[] = [];
  
  if (meta.title) metaLines.push(`Title: ${meta.title}`);
  if (meta.author) metaLines.push(`Author: ${meta.author}`);
  if (meta.publisher) metaLines.push(`Publisher: ${meta.publisher}`);
  if (meta.publishedDate) metaLines.push(`Published: ${meta.publishedDate}`);
  if (meta.isbn) metaLines.push(`ISBN: ${meta.isbn}`);
  if (meta.kyoboUrl) metaLines.push(`Kyobo URL: ${meta.kyoboUrl}`);
  
  const metaBlock = metaLines.join("\n");
  
  return `You are a knowledgeable book expert. Given the following book information, provide a comprehensive overview that would help someone understand the book at a glance.

BOOK INFORMATION:
${metaBlock}

Please provide:

1. **SUMMARY** (6-10 sentences):
   - Capture the book's main premise, central themes, and narrative arc
   - Be informative and substantive, not vague
   - Write in a flowing paragraph style

2. **KEY POINTS** (8-15 bullet points):
   - Cover major arguments, frameworks, concepts, and takeaways
   - Make each point informative enough that someone could recall the book's content
   - Be specific rather than generic

3. **REPRESENTATIVE QUOTES** (8-15 quotes):
   - Include well-known, impactful, or representative quotes from the book
   - If you know the page number, include it in parentheses
   - If page number is unknown, write "(page unknown)"
   - Format each quote on its own line with proper quotation marks

IMPORTANT:
- Be concise but substantive (no fluff or filler phrases)
- Provide enough detail to serve as a meaningful book review
- If you're not familiar with this specific book, provide a reasonable overview based on the author's known work and typical themes, noting any uncertainty
- Write in a mix of Korean and English as appropriate for the content (Korean for Korean books, English for English books, or mixed if the book is commonly discussed in both)

Format your response EXACTLY as follows (use these exact headers):

### Summary
[Your 6-10 sentence summary paragraph here]

### Key Points
- [Point 1]
- [Point 2]
...

### Quotes
> "[Quote 1]" (page X or page unknown)
> "[Quote 2]" (page X or page unknown)
...`;
}

/**
 * Result from GPT API call, including error info for better user feedback
 */
export interface GptApiResult {
  success: boolean;
  content: string | null;
  errorMessage: string | null;
}

/**
 * Call OpenAI Chat Completions API to generate book summary.
 * Uses throw:false to handle errors gracefully and surface meaningful messages.
 */
export async function generateGptSummary(
  meta: BookMeta,
  apiKey: string,
  model: string,
  maxTokens: number,
  temperature: number
): Promise<GptApiResult> {
  if (!apiKey) {
    console.log("[Book Voice Capture] GPT Summary skipped: no API key");
    return { success: false, content: null, errorMessage: "No API key configured" };
  }
  
  const prompt = buildGptPrompt(meta);
  
  try {
    console.log(`[Book Voice Capture] Generating GPT summary for: ${meta.title}`);
    
    const response: RequestUrlResponse = await requestUrl({
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "system",
            content: "You are a helpful book expert assistant that provides accurate, substantive book summaries.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: maxTokens,
        temperature: temperature,
      }),
      throw: false, // Don't throw on non-200 responses - handle manually
    });
    
    // Handle non-200 responses with detailed error info
    if (response.status !== 200) {
      const errorBody = response.text || response.json;
      let errorMessage = `API error (${response.status})`;
      
      // Try to extract meaningful error from response
      if (typeof errorBody === "string") {
        try {
          const parsed = JSON.parse(errorBody);
          errorMessage = parsed?.error?.message || errorMessage;
        } catch {
          // Use raw text if not JSON
          if (errorBody.length < 200) {
            errorMessage = errorBody;
          }
        }
      } else if (errorBody?.error?.message) {
        errorMessage = errorBody.error.message;
      }
      
      console.error(`[Book Voice Capture] GPT API error: ${response.status}`, errorBody);
      return { success: false, content: null, errorMessage };
    }
    
    const data = response.json;
    const content = data?.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error("[Book Voice Capture] GPT response missing content");
      return { success: false, content: null, errorMessage: "Empty response from API" };
    }
    
    // Log only status and length, not full content
    console.log(`[Book Voice Capture] GPT summary generated: ${content.length} chars`);
    
    return { success: true, content, errorMessage: null };
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Book Voice Capture] GPT API call failed:", error);
    return { success: false, content: null, errorMessage: errorMsg };
  }
}

/**
 * Format the GPT summary response into a markdown section
 */
export function formatGptSummarySection(gptResponse: string): string {
  // The response should already be formatted with ### headers
  // Just wrap it in the main section header
  
  let section = `${GPT_SUMMARY_SECTION}\n\n`;
  
  // Clean up the response - ensure proper spacing
  const cleanedResponse = gptResponse
    .replace(/\r\n/g, "\n")        // Normalize line endings
    .replace(/\n{3,}/g, "\n\n")    // Remove excessive blank lines
    .trim();
  
  section += cleanedResponse;
  section += "\n\n";
  
  return section;
}

/**
 * Create a GPT summary section with a failure/unavailable status.
 * This makes failures visible in the note itself for transparency.
 */
export function formatGptSummaryUnavailable(reason: string): string {
  const timestamp = new Date().toISOString().split("T")[0];
  
  return `${GPT_SUMMARY_SECTION}

> ⚠️ **GPT summary unavailable** (${timestamp})
> ${reason}
> 
> You can regenerate this summary later by editing this section and using the plugin.

`;
}

/**
 * Check if a note already contains the GPT Summary section
 */
export function hasGptSummarySection(content: string): boolean {
  return content.includes(GPT_SUMMARY_SECTION);
}

/**
 * Find the insertion point for GPT Summary section.
 * Returns the line number after "## 기본 정보" section or after frontmatter.
 */
export function findGptSummaryInsertionPoint(content: string): number {
  const lines = content.split("\n");
  
  // Look for "## 기본 정보" section - insert after it
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "## 기본 정보" || line === "## Basic Info") {
      // Find the end of this section (next ## heading or end of list items)
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j].trim();
        // Found another ## heading - insert before it
        if (nextLine.startsWith("## ")) {
          return j;
        }
      }
      // No more ## headings found, go to end
      return lines.length;
    }
  }
  
  // Fallback: find end of frontmatter
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
      } else {
        // End of frontmatter, insert after any blank lines
        let insertPoint = i + 1;
        while (insertPoint < lines.length && lines[insertPoint].trim() === "") {
          insertPoint++;
        }
        // Skip the # title line if present
        if (insertPoint < lines.length && lines[insertPoint].trim().startsWith("# ")) {
          insertPoint++;
          while (insertPoint < lines.length && lines[insertPoint].trim() === "") {
            insertPoint++;
          }
        }
        return insertPoint;
      }
    }
  }
  
  // No frontmatter found, insert at beginning after any title
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith("# ")) {
      return i + 1;
    }
  }
  
  return 0;
}

/**
 * Insert GPT Summary section into note content at the appropriate location.
 * Returns the modified content.
 */
export function insertGptSummaryIntoContent(
  content: string,
  gptSection: string
): string {
  // Don't insert if already present
  if (hasGptSummarySection(content)) {
    console.log("[Book Voice Capture] GPT Summary section already exists, skipping");
    return content;
  }
  
  const lines = content.split("\n");
  const insertPoint = findGptSummaryInsertionPoint(content);
  
  // Ensure proper spacing
  const normalizedSection = gptSection.replace(/^\n+/, "").replace(/\n+$/, "\n");
  
  // Insert with proper blank line before
  const before = lines.slice(0, insertPoint);
  const after = lines.slice(insertPoint);
  
  // Add blank line before section if needed
  const needsBlankBefore = before.length > 0 && before[before.length - 1].trim() !== "";
  const prefix = needsBlankBefore ? "\n" : "";
  
  const newContent = [
    ...before,
    prefix + normalizedSection,
    ...after,
  ].join("\n");
  
  // Clean up any excessive blank lines
  return newContent.replace(/\n{3,}/g, "\n\n");
}

