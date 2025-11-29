import { requestUrl, RequestUrlResponse } from "obsidian";
import { BookMeta } from "./kyobo";

/**
 * GPT Summary section markers for idempotency checks (both languages)
 */
export const GPT_SUMMARY_SECTION_EN = "## 🧭 Overview";
export const GPT_SUMMARY_SECTION_KO = "## 🧭 요약";

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
  const normalizedLanguage = (meta.language || "").toLowerCase();
  const isKorean = normalizedLanguage === "ko" || /[가-힣]/.test(meta.title || "");
  const languageName = isKorean ? "Korean" : "English";
  const summaryHeader = isKorean ? "🧭 요약" : "🧭 Overview";
  const keyPointsHeader = isKorean ? "🧩 핵심 포인트" : "🧩 Key Ideas";
  const quotesHeader = isKorean ? "💡 Quotes" : "💡 Quotes";
  
  const metaLines: string[] = [];
  
  if (meta.title) metaLines.push(`Title: ${meta.title}`);
  if (meta.author) metaLines.push(`Author: ${meta.author}`);
  if (meta.publisher) metaLines.push(`Publisher: ${meta.publisher}`);
  if (meta.publishedDate) metaLines.push(`Published: ${meta.publishedDate}`);
  if (meta.isbn) metaLines.push(`ISBN: ${meta.isbn}`);
  if (meta.kyoboUrl) metaLines.push(`Kyobo URL: ${meta.kyoboUrl}`);
  
  const metaBlock = metaLines.join("\n");
  
  return `You are a knowledgeable book expert. Given the following book information, provide a comprehensive overview that would help someone understand the book at a glance. Write your entire response in ${languageName} using natural, fluent phrasing.

BOOK INFORMATION:
${metaBlock}

Please provide:

1. **OVERVIEW** (6-10 sentences):
   - Capture the book's main premise, central themes, and narrative arc
   - Start with "**What this book is about:**" in bold, then the content on a new line in a blockquote
   - Be informative and substantive, not vague

2. **KEY IDEAS** (8-15 bullet points):
   - Cover major frameworks, insights, or mental models
   - Start with a blockquote line: "> Core frameworks, insights, or mental models that stand out."
   - Followed by bullet points

3. **QUOTES** (8-15 quotes):
   - Include well-known, impactful, or representative quotes
   - Start with a blockquote line: "> Popular quotes from the book."
   - Followed by bullet points containing the quotes

IMPORTANT:
- Be concise but substantive (no fluff or filler phrases)
- Provide enough detail to serve as a meaningful book review
- If you're not familiar with this specific book, provide a reasonable overview based on the author's known work and typical themes, noting any uncertainty
- Write the entire response in ${languageName}. Do not switch languages mid-section.

Format your response EXACTLY as follows (use these exact headers):

## ${summaryHeader}

> [Your summary paragraph here]

---

## ${keyPointsHeader}

- [Idea 1]
- [Idea 2]
- [Idea 3]

---

## ${quotesHeader}

- "[Quote 1]"
- "[Quote 2]"

---`;
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
  // The response should already be formatted with ## headers
  // Just return it directly as the section
  
  // Clean up the response - ensure proper spacing
  const cleanedResponse = gptResponse
    .replace(/\r\n/g, "\n")        // Normalize line endings
    .replace(/\n{3,}/g, "\n\n")    // Remove excessive blank lines
    .trim();
  
  return cleanedResponse + "\n\n";
}

/**
 * Create a GPT summary section with a failure/unavailable status.
 * This makes failures visible in the note itself for transparency.
 * Uses English header as default for error cases.
 */
export function formatGptSummaryUnavailable(reason: string): string {
  const timestamp = new Date().toISOString().split("T")[0];
  
  return `${GPT_SUMMARY_SECTION_EN}

> **What this book is about:**  
> ⚠️ **GPT summary unavailable** (${timestamp}) - ${reason}

---

## 🧩 Key Ideas

> Core frameworks, insights, or mental models that stand out.

- (Summary unavailable)

---

## 💡 Quotes

> Popular quotes from the book.

- (Quotes unavailable)

## Voice Notes

---

`;
}

/**
 * Check if a note already contains the GPT Summary section (either English or Korean)
 */
export function hasGptSummarySection(content: string): boolean {
  return content.includes(GPT_SUMMARY_SECTION_EN) || content.includes(GPT_SUMMARY_SECTION_KO);
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

