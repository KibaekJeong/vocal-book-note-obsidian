import { requestUrl, RequestUrlResponse } from "obsidian";

export interface BookMeta {
  title: string;
  author: string;
  publisher?: string;
  publishedDate?: string;
  isbn?: string;
  kyoboUrl?: string;
}

/**
 * Search result candidate from Kyobo search page
 */
export interface KyoboSearchCandidate {
  title: string;
  author: string;
  publisher: string;
  publishedYear: string;
  detailUrl: string;
  isbn?: string;
}

/**
 * Fetch multiple search candidates from Kyobo search results.
 * Returns an array of candidates for user selection with rich metadata.
 */
export async function fetchKyoboSearchCandidates(query: string): Promise<KyoboSearchCandidate[]> {
  const candidates: KyoboSearchCandidate[] = [];
  
  try {
    const searchUrl = `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(query)}&gbCode=TOT&target=total`;
    
    console.log(`[Book Voice Capture] Searching Kyobo for candidates: ${query}`);
    
    const searchResponse: RequestUrlResponse = await requestUrl({
      url: searchUrl,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (searchResponse.status !== 200) {
      console.error(`[Book Voice Capture] Kyobo search failed with status: ${searchResponse.status}`);
      return candidates;
    }

    const html = searchResponse.text;
    const seenUrls = new Set<string>();
    
    // Strategy 1: Parse JSON-LD structured data (most reliable when present)
    const jsonLdCandidates = parseJsonLdBooks(html, seenUrls);
    candidates.push(...jsonLdCandidates);
    
    // Strategy 2: Parse product list items with surrounding context
    const listCandidates = parseProductListItems(html, seenUrls);
    candidates.push(...listCandidates);
    
    // Strategy 3: Fallback - extract from detail URLs with enrichment
    if (candidates.length === 0) {
      const fallbackCandidates = parseDetailUrlsWithContext(html, seenUrls);
      candidates.push(...fallbackCandidates);
    }
    
    // De-duplicate by URL and score by relevance to query
    const uniqueCandidates = deduplicateAndScore(candidates, query);
    
    // Limit to 10 results
    const limitedCandidates = uniqueCandidates.slice(0, 10);
    
    console.log(`[Book Voice Capture] Found ${limitedCandidates.length} candidates`);
    return limitedCandidates;
    
  } catch (error) {
    console.error("[Book Voice Capture] Error fetching Kyobo candidates:", error);
    return candidates;
  }
}

/**
 * Parse JSON-LD structured data from the page (most reliable)
 * Handles ItemList, Book, and Product types commonly used by Kyobo
 */
function parseJsonLdBooks(html: string, seenUrls: Set<string>): KyoboSearchCandidate[] {
  const candidates: KyoboSearchCandidate[] = [];
  const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(match[1]);
      
      // Handle ItemList (common search result format)
      if (jsonData["@type"] === "ItemList" && Array.isArray(jsonData.itemListElement)) {
        for (const listItem of jsonData.itemListElement) {
          const item = listItem.item || listItem;
          const candidate = extractCandidateFromJsonLd(item, seenUrls);
          if (candidate) candidates.push(candidate);
        }
        continue;
      }
      
      // Handle array of items
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      
      for (const item of items) {
        const candidate = extractCandidateFromJsonLd(item, seenUrls);
        if (candidate) candidates.push(candidate);
      }
    } catch {
      // JSON parse failed, ignore
    }
  }
  
  return candidates;
}

/**
 * Extract candidate from a single JSON-LD item
 */
function extractCandidateFromJsonLd(
  item: Record<string, unknown>,
  seenUrls: Set<string>
): KyoboSearchCandidate | null {
  const itemType = item["@type"];
  if (itemType !== "Book" && itemType !== "Product" && itemType !== "CreativeWork") {
    return null;
  }
  
  const url = String(item.url || (item.offers as Record<string, unknown>)?.url || "");
  if (!url || seenUrls.has(url)) return null;
  
  const title = String(item.name || "");
  if (!title || title.length < 2) return null;
  
  seenUrls.add(url);
  
  return {
    title: cleanText(title),
    author: extractAuthor(item.author),
    publisher: extractPublisher(item.publisher),
    publishedYear: extractYear(item.datePublished),
    detailUrl: url,
    isbn: String(item.isbn || ""),
  };
}

/**
 * Parse product list items with surrounding metadata spans
 */
function parseProductListItems(html: string, seenUrls: Set<string>): KyoboSearchCandidate[] {
  const candidates: KyoboSearchCandidate[] = [];
  
  // Pattern to find product item blocks (Kyobo uses various class patterns)
  // Look for product containers that have title links and metadata
  const productBlockPatterns = [
    // Pattern 1: prod_info container with nested elements
    /<(?:div|li)[^>]*class="[^"]*(?:prod_info|product_item|search_result)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|li)>/gi,
    // Pattern 2: List items with detail links
    /<li[^>]*>([\s\S]*?href="(https?:\/\/product\.kyobobook\.co\.kr\/detail\/[^"]+)"[\s\S]*?)<\/li>/gi,
  ];
  
  for (const pattern of productBlockPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const block = match[1] || match[0];
      const candidate = extractCandidateFromBlock(block, seenUrls);
      if (candidate) {
        candidates.push(candidate);
      }
    }
  }
  
  return candidates;
}

/**
 * Extract candidate info from a product block.
 * Uses Kyobo-specific patterns for better metadata extraction.
 */
function extractCandidateFromBlock(block: string, seenUrls: Set<string>): KyoboSearchCandidate | null {
  // Extract detail URL
  const urlMatch = block.match(/href="(https?:\/\/product\.kyobobook\.co\.kr\/detail\/[^"]+)"/);
  if (!urlMatch) return null;
  
  const url = urlMatch[1];
  if (seenUrls.has(url)) return null;
  
  // Extract title - try Kyobo-specific patterns first
  let title = "";
  const titlePatterns = [
    // Kyobo specific: prod_name class
    /<[^>]*class="[^"]*prod_name[^"]*"[^>]*>([^<]+)</i,
    // Kyobo specific: prod_title class
    /<[^>]*class="[^"]*prod_title[^"]*"[^>]*>([^<]+)</i,
    // Microdata: itemprop="name"
    /itemprop="name"[^>]*>([^<]+)</i,
    // Heading with title class
    /<(?:h[1-6]|strong|span)[^>]*class="[^"]*(?:title|book_title)[^"]*"[^>]*>([^<]+)</i,
    // Link text from detail URL
    /<a[^>]*href="[^"]*\/detail\/[^"]*"[^>]*>([^<]{3,})</i,
  ];
  
  for (const pattern of titlePatterns) {
    const titleMatch = block.match(pattern);
    if (titleMatch && titleMatch[1]) {
      const extracted = cleanText(titleMatch[1]);
      // Filter out garbage: too short, placeholder patterns, or pure numbers
      if (
        extracted.length > 2 &&
        !extracted.match(/^Book\s+\w+$/i) &&
        !extracted.match(/^\d+$/) &&
        !extracted.match(/^[A-Z0-9]{6,}$/) && // Avoid product IDs
        !extracted.match(/^(이전|다음|더보기|상세|닫기)$/i) // Korean UI elements
      ) {
        title = extracted;
        break;
      }
    }
  }
  
  if (!title) return null;
  
  // Extract author - try Kyobo-specific patterns
  let author = "";
  const authorPatterns = [
    // Kyobo specific: author class variants
    /class="[^"]*(?:prod_author|author|info_auth)[^"]*"[^>]*>([^<]+)</i,
    // Microdata: itemprop="author"
    /itemprop="author"[^>]*>([^<]+)</i,
    // Korean labels with author name
    /(?:저자|지은이|글)\s*[:\s]*(?:<[^>]*>)*([가-힣a-zA-Z][가-힣a-zA-Z\s\.,·]+)/i,
    // Author name followed by "저" (author marker)
    /([가-힣a-zA-Z][가-힣a-zA-Z\s\.,·]+)\s*저(?:\s|<|$)/i,
  ];
  
  for (const pattern of authorPatterns) {
    const authorMatch = block.match(pattern);
    if (authorMatch && authorMatch[1]) {
      const extracted = cleanText(authorMatch[1]);
      // Filter out noise: too short or UI text
      if (extracted.length > 1 && !extracted.match(/^(저자|지은이|글|Author)$/i)) {
        author = extracted;
        break;
      }
    }
  }
  
  // Extract publisher - Kyobo-specific patterns
  let publisher = "";
  const publisherPatterns = [
    // Kyobo specific: publisher class
    /class="[^"]*(?:prod_publish|publisher|info_pub)[^"]*"[^>]*>([^<]+)</i,
    // Microdata: itemprop="publisher"
    /itemprop="publisher"[^>]*>([^<]+)</i,
    // Korean labels
    /(?:출판사|출판|발행처)\s*[:\s]*(?:<[^>]*>)*([가-힣a-zA-Z][가-힣a-zA-Z\s\.,&]+)/i,
  ];
  
  for (const pattern of publisherPatterns) {
    const publisherMatch = block.match(pattern);
    if (publisherMatch && publisherMatch[1]) {
      const extracted = cleanText(publisherMatch[1]);
      if (extracted.length > 1 && !extracted.match(/^(출판사|출판|발행처|Publisher)$/i)) {
        publisher = extracted;
        break;
      }
    }
  }
  
  // Extract year - look for 4-digit year patterns
  let year = "";
  const yearPatterns = [
    // Kyobo date format: 2023년 12월 or 2023.12
    /(\d{4})(?:년\s*\d{1,2}월?|[\.\-]\d{1,2})/,
    // Microdata: datePublished
    /itemprop="datePublished"[^>]*(?:content=")?(\d{4})/i,
    // General year pattern
    /(?:출간|발행|출판)\s*[:\s]*(?:<[^>]*>)*(\d{4})/i,
  ];
  
  for (const pattern of yearPatterns) {
    const yearMatch = block.match(pattern);
    if (yearMatch && yearMatch[1]) {
      const yearNum = parseInt(yearMatch[1], 10);
      // Sanity check: reasonable publication year (1900-2030)
      if (yearNum >= 1900 && yearNum <= 2030) {
        year = yearMatch[1];
        break;
      }
    }
  }
  
  // Extract ISBN if present
  let isbn = "";
  const isbnPatterns = [
    // Microdata: itemprop="isbn"
    /itemprop="isbn"[^>]*(?:content="|>)(\d{10,13})/i,
    // Explicit ISBN label
    /ISBN[:\s-]*(\d{10,13})/i,
    // 13-digit ISBN starting with 978/979
    /\b(97[89]\d{10})\b/,
  ];
  
  for (const pattern of isbnPatterns) {
    const isbnMatch = block.match(pattern);
    if (isbnMatch && isbnMatch[1]) {
      isbn = isbnMatch[1];
      break;
    }
  }
  
  seenUrls.add(url);
  
  return {
    title,
    author,
    publisher,
    publishedYear: year,
    detailUrl: url,
    isbn,
  };
}

/**
 * Fallback: extract detail URLs and try to enrich with surrounding text.
 * Uses a larger context window and more robust extraction patterns.
 */
function parseDetailUrlsWithContext(html: string, seenUrls: Set<string>): KyoboSearchCandidate[] {
  const candidates: KyoboSearchCandidate[] = [];
  
  // Find all detail URLs with surrounding context (800 chars before/after for better coverage)
  const urlPattern = /href="(https?:\/\/product\.kyobobook\.co\.kr\/detail\/(\w+))"/g;
  
  let match;
  while ((match = urlPattern.exec(html)) !== null) {
    const url = match[1];
    
    if (seenUrls.has(url)) continue;
    
    // Get larger context around the URL for better metadata extraction
    const start = Math.max(0, match.index - 800);
    const end = Math.min(html.length, match.index + 800);
    const context = html.substring(start, end);
    
    // Try to extract title from context
    let title = "";
    const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Pattern 1: Link text immediately after href (most common)
    const linkTextMatch = context.match(new RegExp(`href="${escapedUrl}"[^>]*>([^<]{3,})<`));
    if (linkTextMatch && linkTextMatch[1]) {
      const extracted = cleanText(linkTextMatch[1]);
      if (isValidTitle(extracted)) {
        title = extracted;
      }
    }
    
    // Pattern 2: prod_name or title class near the URL
    if (!title) {
      const nearbyTitleMatch = context.match(
        /<[^>]*class="[^"]*(?:prod_name|prod_title|title)[^"]*"[^>]*>([^<]{3,})</i
      );
      if (nearbyTitleMatch && nearbyTitleMatch[1]) {
        const extracted = cleanText(nearbyTitleMatch[1]);
        if (isValidTitle(extracted)) {
          title = extracted;
        }
      }
    }
    
    // Pattern 3: strong or h-tag in context
    if (!title) {
      const headingMatch = context.match(/<(?:strong|h[1-6])[^>]*>([^<]{3,100})<\/(?:strong|h[1-6])>/i);
      if (headingMatch && headingMatch[1]) {
        const extracted = cleanText(headingMatch[1]);
        if (isValidTitle(extracted)) {
          title = extracted;
        }
      }
    }
    
    // Skip if no meaningful title found
    if (!title) continue;
    
    // Extract author from context - multiple patterns
    let author = "";
    const authorPatterns = [
      /(?:저자|지은이|글)\s*[:\s]*(?:<[^>]*>)*([가-힣a-zA-Z][가-힣a-zA-Z\s\.,·]+)/i,
      /([가-힣a-zA-Z][가-힣a-zA-Z\s\.,·]+)\s*저(?:\s|<|$)/i,
      /class="[^"]*author[^"]*"[^>]*>([^<]+)</i,
    ];
    for (const pattern of authorPatterns) {
      const authorMatch = context.match(pattern);
      if (authorMatch && authorMatch[1]) {
        const extracted = cleanText(authorMatch[1]);
        if (extracted.length > 1 && !extracted.match(/^(저자|지은이|글)$/i)) {
          author = extracted;
          break;
        }
      }
    }
    
    // Extract publisher from context
    let publisher = "";
    const publisherPatterns = [
      /(?:출판사|출판|발행처)\s*[:\s]*(?:<[^>]*>)*([가-힣a-zA-Z][가-힣a-zA-Z\s\.,&]+)/i,
      /class="[^"]*publish[^"]*"[^>]*>([^<]+)</i,
    ];
    for (const pattern of publisherPatterns) {
      const publisherMatch = context.match(pattern);
      if (publisherMatch && publisherMatch[1]) {
        const extracted = cleanText(publisherMatch[1]);
        if (extracted.length > 1 && !extracted.match(/^(출판사|출판|발행처)$/i)) {
          publisher = extracted;
          break;
        }
      }
    }
    
    // Extract year from context
    let year = "";
    const yearMatch = context.match(/(\d{4})(?:년|[\.\-]\d{1,2})/);
    if (yearMatch) {
      const yearNum = parseInt(yearMatch[1], 10);
      if (yearNum >= 1900 && yearNum <= 2030) {
        year = yearMatch[1];
      }
    }
    
    // Extract ISBN from context
    let isbn = "";
    const isbnMatch = context.match(/(?:ISBN[:\s-]*)?(\d{13}|\d{10})/i);
    if (isbnMatch) {
      isbn = isbnMatch[1];
    }
    
    seenUrls.add(url);
    candidates.push({
      title,
      author,
      publisher,
      publishedYear: year,
      detailUrl: url,
      isbn,
    });
  }
  
  return candidates;
}

/**
 * Check if a string is a valid book title (not a placeholder or UI element)
 * Enhanced to filter out more placeholder patterns and edge cases
 */
function isValidTitle(text: string): boolean {
  if (text.length < 2) return false;
  
  // Reject patterns that look like placeholders or IDs
  if (/^Book\s+\w+$/i.test(text)) return false;
  if (/^[A-Z0-9]{6,}$/.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  // Reject ISBN-like patterns mistaken for titles
  if (/^97[89]\d{10}$/.test(text)) return false;
  // Reject product ID patterns (e.g., S000123456789)
  if (/^[A-Z]\d{12,}$/i.test(text)) return false;
  
  // Reject common Korean UI elements
  const koreanUiElements = [
    "이전", "다음", "더보기", "상세", "닫기", "목록", "검색", "장바구니",
    "정가", "판매가", "적립", "배송", "품절", "절판", "예약", "주문",
    "바로가기", "리뷰", "평점", "별점", "공유", "찜", "선물", "구매"
  ];
  const textLower = text.toLowerCase().trim();
  if (koreanUiElements.some(elem => textLower === elem)) return false;
  
  // Reject common English UI elements
  const englishUiElements = [
    "view", "more", "detail", "close", "search", "cart", "buy", "order",
    "price", "sale", "review", "share", "gift", "next", "prev", "back"
  ];
  if (englishUiElements.some(elem => textLower === elem)) return false;
  
  // Must contain some meaningful content (Korean or Latin letters)
  const hasKorean = /[가-힣]/.test(text);
  const hasLatin = /[a-zA-Z]{2,}/.test(text);
  
  return hasKorean || hasLatin;
}

/**
 * De-duplicate candidates, merge metadata, and score by relevance to query.
 * Also filters out low-quality candidates with insufficient metadata.
 * Enhanced with quality scoring to prefer candidates with richer metadata.
 */
function deduplicateAndScore(candidates: KyoboSearchCandidate[], query: string): KyoboSearchCandidate[] {
  // De-duplicate by URL (keep first occurrence which usually has best metadata)
  const urlMap = new Map<string, KyoboSearchCandidate>();
  
  for (const candidate of candidates) {
    const existingCandidate = urlMap.get(candidate.detailUrl);
    if (!existingCandidate) {
      urlMap.set(candidate.detailUrl, candidate);
    } else {
      // Merge metadata - prefer non-empty values (enrichment)
      if (!existingCandidate.author && candidate.author) {
        existingCandidate.author = candidate.author;
      }
      if (!existingCandidate.publisher && candidate.publisher) {
        existingCandidate.publisher = candidate.publisher;
      }
      if (!existingCandidate.publishedYear && candidate.publishedYear) {
        existingCandidate.publishedYear = candidate.publishedYear;
      }
      if (!existingCandidate.isbn && candidate.isbn) {
        existingCandidate.isbn = candidate.isbn;
      }
      // Prefer longer/better title (but not if current is clearly better quality)
      if (candidate.title.length > existingCandidate.title.length && isValidTitle(candidate.title)) {
        existingCandidate.title = candidate.title;
      }
    }
  }
  
  const unique = Array.from(urlMap.values());
  
  // Filter out low-quality candidates with enhanced validation
  const filtered = unique.filter(c => {
    // Must pass the enhanced title validation
    if (!isValidTitle(c.title)) return false;
    
    // Must have a meaningful title (at least 2 chars, not just numbers/IDs)
    if (c.title.length < 2) return false;
    if (/^[A-Z0-9]+$/.test(c.title)) return false;
    
    // At minimum, title should look like book content (some Korean, Latin, or mixed)
    const hasKorean = /[가-힣]/.test(c.title);
    const hasLatin = /[a-zA-Z]{2,}/.test(c.title);
    if (!hasKorean && !hasLatin) return false;
    
    return true;
  });
  
  // Score by relevance (title similarity to query)
  const queryLower = query.toLowerCase();
  const scored = filtered.map(c => ({
    candidate: c,
    score: calculateRelevanceScore(c, queryLower),
  }));
  
  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  
  return scored.map(s => s.candidate);
}

/**
 * Calculate relevance score for a candidate.
 * Enhanced scoring: prioritizes metadata quality to surface richer results.
 */
function calculateRelevanceScore(candidate: KyoboSearchCandidate, queryLower: string): number {
  let score = 0;
  const titleLower = candidate.title.toLowerCase();
  
  // Exact title match: highest score
  if (titleLower === queryLower) {
    score += 100;
  }
  // Title contains query
  else if (titleLower.includes(queryLower)) {
    score += 50;
  }
  // Query contains title (for short titles)
  else if (queryLower.includes(titleLower)) {
    score += 30;
  }
  // Word overlap
  else {
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 1);
    const overlap = queryWords.filter(w => titleWords.some(tw => tw.includes(w) || w.includes(tw)));
    score += overlap.length * 10;
  }
  
  // Enhanced bonus for rich metadata (higher weights to prioritize quality results)
  // Author is most important (real books have authors)
  if (candidate.author && candidate.author.length > 1) score += 15;
  // Publisher indicates verified book info
  if (candidate.publisher && candidate.publisher.length > 1) score += 10;
  // Year helps validate it's a real book
  if (candidate.publishedYear && /^\d{4}$/.test(candidate.publishedYear)) score += 8;
  // ISBN is strong validation
  if (candidate.isbn && candidate.isbn.length >= 10) score += 12;
  
  // Bonus for title length (longer titles are usually more descriptive/real)
  if (candidate.title.length >= 10) score += 3;
  if (candidate.title.length >= 20) score += 2;
  
  // Penalty for very short titles (often garbage)
  if (candidate.title.length < 5) score -= 10;
  
  return score;
}

/**
 * Extract author name from various formats
 */
function extractAuthor(author: unknown): string {
  if (!author) return "";
  if (typeof author === "string") return cleanText(author);
  if (typeof author === "object" && author !== null) {
    const obj = author as Record<string, unknown>;
    if (obj.name) return cleanText(String(obj.name));
    if (Array.isArray(author)) {
      return author.map(a => extractAuthor(a)).filter(Boolean).join(", ");
    }
  }
  return "";
}

/**
 * Extract publisher name from various formats
 */
function extractPublisher(publisher: unknown): string {
  if (!publisher) return "";
  if (typeof publisher === "string") return cleanText(publisher);
  if (typeof publisher === "object" && publisher !== null) {
    const obj = publisher as Record<string, unknown>;
    if (obj.name) return cleanText(String(obj.name));
  }
  return "";
}

/**
 * Extract year from date string
 */
function extractYear(dateStr: unknown): string {
  if (!dateStr) return "";
  const str = String(dateStr);
  const match = str.match(/(\d{4})/);
  return match ? match[1] : "";
}

/**
 * Fetch detailed metadata for a specific book from its detail page URL.
 */
export async function fetchKyoboDetailMeta(detailUrl: string): Promise<BookMeta | null> {
  try {
    console.log(`[Book Voice Capture] Fetching detail page: ${detailUrl}`);
    
    const detailResponse: RequestUrlResponse = await requestUrl({
      url: detailUrl,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (detailResponse.status !== 200) {
      console.error(`[Book Voice Capture] Kyobo detail page failed with status: ${detailResponse.status}`);
      return null;
    }

    return extractMetaFromDetailPage(detailResponse.text, detailUrl);
    
  } catch (error) {
    console.error("[Book Voice Capture] Error fetching Kyobo detail:", error);
    return null;
  }
}

/**
 * Fetches book metadata from Kyobo (교보문고) by searching for the given query.
 * Uses Obsidian's requestUrl API to avoid CORS issues.
 * 
 * @param query - The book title or search query
 * @returns BookMeta object if found, null otherwise
 */
export async function fetchKyoboMeta(query: string): Promise<BookMeta | null> {
  try {
    // Step 1: Search for the book
    const searchUrl = `https://search.kyobobook.co.kr/search?keyword=${encodeURIComponent(query)}&gbCode=TOT&target=total`;
    
    console.log(`[Book Voice Capture] Searching Kyobo for: ${query}`);
    
    const searchResponse: RequestUrlResponse = await requestUrl({
      url: searchUrl,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (searchResponse.status !== 200) {
      console.error(`[Book Voice Capture] Kyobo search failed with status: ${searchResponse.status}`);
      return null;
    }

    const searchHtml = searchResponse.text;

    // Step 2: Find the first book detail URL from search results
    const detailUrlPatterns = [
      /href="(https?:\/\/product\.kyobobook\.co\.kr\/detail\/[^"]+)"/,
      /href="(\/detail\/[^"]+)"/,
      /data-url="(https?:\/\/product\.kyobobook\.co\.kr\/detail\/[^"]+)"/,
    ];

    let detailUrl: string | null = null;
    
    for (const pattern of detailUrlPatterns) {
      const match = searchHtml.match(pattern);
      if (match) {
        detailUrl = match[1];
        if (detailUrl && detailUrl.startsWith("/")) {
          detailUrl = `https://product.kyobobook.co.kr${detailUrl}`;
        }
        break;
      }
    }

    if (!detailUrl) {
      const productIdMatch = searchHtml.match(/prod_id['":\s]+['"]?(\w+)['"]?/i) ||
                            searchHtml.match(/\/detail\/(\w+)/);
      if (productIdMatch) {
        detailUrl = `https://product.kyobobook.co.kr/detail/${productIdMatch[1]}`;
      }
    }

    if (!detailUrl) {
      console.log("[Book Voice Capture] No book detail URL found in search results");
      return extractFromSearchResults(searchHtml, query);
    }

    console.log(`[Book Voice Capture] Found detail URL: ${detailUrl}`);

    // Step 3: Fetch the detail page
    const detailResponse: RequestUrlResponse = await requestUrl({
      url: detailUrl,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });

    if (detailResponse.status !== 200) {
      console.error(`[Book Voice Capture] Kyobo detail page failed with status: ${detailResponse.status}`);
      return null;
    }

    return extractMetaFromDetailPage(detailResponse.text, detailUrl);

  } catch (error) {
    console.error("[Book Voice Capture] Error fetching Kyobo metadata:", error);
    return null;
  }
}

/**
 * Extract metadata from Kyobo detail page HTML.
 * Strategy: Try JSON-LD/microdata first (structured, reliable), then fall back to regex.
 */
function extractMetaFromDetailPage(html: string, pageUrl: string): BookMeta | null {
  const meta: BookMeta = {
    title: "",
    author: "",
    kyoboUrl: pageUrl,
  };

  try {
    // Strategy 1: Try JSON-LD structured data first (most reliable)
    const jsonLdMeta = extractMetaFromJsonLd(html);
    if (jsonLdMeta) {
      // Merge JSON-LD data
      if (jsonLdMeta.title) meta.title = jsonLdMeta.title;
      if (jsonLdMeta.author) meta.author = jsonLdMeta.author;
      if (jsonLdMeta.publisher) meta.publisher = jsonLdMeta.publisher;
      if (jsonLdMeta.publishedDate) meta.publishedDate = jsonLdMeta.publishedDate;
      if (jsonLdMeta.isbn) meta.isbn = jsonLdMeta.isbn;
      
      // If we got a good title from JSON-LD, we're done
      if (meta.title) {
        console.log("[Book Voice Capture] Extracted metadata from JSON-LD:", meta);
        return meta;
      }
    }
    
    // Strategy 2: Try microdata (itemprop attributes)
    const microdataMeta = extractMetaFromMicrodata(html);
    if (microdataMeta) {
      // Merge microdata (only fill missing fields)
      if (!meta.title && microdataMeta.title) meta.title = microdataMeta.title;
      if (!meta.author && microdataMeta.author) meta.author = microdataMeta.author;
      if (!meta.publisher && microdataMeta.publisher) meta.publisher = microdataMeta.publisher;
      if (!meta.publishedDate && microdataMeta.publishedDate) meta.publishedDate = microdataMeta.publishedDate;
      if (!meta.isbn && microdataMeta.isbn) meta.isbn = microdataMeta.isbn;
      
      if (meta.title) {
        console.log("[Book Voice Capture] Extracted metadata from microdata:", meta);
        return meta;
      }
    }
    
    // Strategy 3: Fallback to regex patterns (least reliable but catches edge cases)
    extractMetaFromRegex(html, meta);

    if (!meta.title) {
      console.log("[Book Voice Capture] Could not extract title from detail page");
      return null;
    }

    console.log("[Book Voice Capture] Extracted metadata (regex fallback):", meta);
    return meta;

  } catch (error) {
    console.error("[Book Voice Capture] Error parsing detail page:", error);
    return null;
  }
}

/**
 * Extract metadata from JSON-LD script tags on the detail page
 */
function extractMetaFromJsonLd(html: string): Partial<BookMeta> | null {
  const meta: Partial<BookMeta> = {};
  const jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  
  let match;
  while ((match = jsonLdPattern.exec(html)) !== null) {
    try {
      const jsonData = JSON.parse(match[1]);
      const items = Array.isArray(jsonData) ? jsonData : [jsonData];
      
      for (const item of items) {
        const itemType = item["@type"];
        
        // Only process Book or Product types
        if (itemType !== "Book" && itemType !== "Product" && itemType !== "CreativeWork") {
          continue;
        }
        
        // Title
        if (item.name && !meta.title) {
          meta.title = cleanText(String(item.name));
        }
        
        // Author
        if (item.author && !meta.author) {
          meta.author = extractAuthor(item.author);
        }
        
        // Publisher
        if (item.publisher && !meta.publisher) {
          meta.publisher = extractPublisher(item.publisher);
        }
        
        // Published date
        if (item.datePublished && !meta.publishedDate) {
          meta.publishedDate = String(item.datePublished);
        }
        
        // ISBN
        if (item.isbn && !meta.isbn) {
          meta.isbn = String(item.isbn);
        }
        
        // If we have a title, we found a good item
        if (meta.title) {
          return meta;
        }
      }
    } catch {
      // JSON parse failed, continue to next script tag
    }
  }
  
  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Extract metadata from microdata (itemprop attributes)
 */
function extractMetaFromMicrodata(html: string): Partial<BookMeta> | null {
  const meta: Partial<BookMeta> = {};
  
  // Title from itemprop="name"
  const nameMatch = html.match(/itemprop="name"[^>]*(?:content="([^"]+)"|>([^<]+)<)/i);
  if (nameMatch) {
    meta.title = cleanText(nameMatch[1] || nameMatch[2] || "");
  }
  
  // Author from itemprop="author"
  const authorMatch = html.match(/itemprop="author"[^>]*(?:content="([^"]+)"|>([^<]+)<)/i);
  if (authorMatch) {
    meta.author = cleanText(authorMatch[1] || authorMatch[2] || "");
  }
  
  // Publisher from itemprop="publisher"
  const publisherMatch = html.match(/itemprop="publisher"[^>]*(?:content="([^"]+)"|>([^<]+)<)/i);
  if (publisherMatch) {
    meta.publisher = cleanText(publisherMatch[1] || publisherMatch[2] || "");
  }
  
  // Date from itemprop="datePublished"
  const dateMatch = html.match(/itemprop="datePublished"[^>]*(?:content="([^"]+)"|>([^<]+)<)/i);
  if (dateMatch) {
    meta.publishedDate = cleanText(dateMatch[1] || dateMatch[2] || "");
  }
  
  // ISBN from itemprop="isbn"
  const isbnMatch = html.match(/itemprop="isbn"[^>]*(?:content="([^"]+)"|>([^<]+)<)/i);
  if (isbnMatch) {
    meta.isbn = cleanText(isbnMatch[1] || isbnMatch[2] || "");
  }
  
  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Extract metadata using regex patterns (fallback for pages without structured data)
 */
function extractMetaFromRegex(html: string, meta: BookMeta): void {
  // Title extraction - try multiple patterns
  if (!meta.title) {
    const titlePatterns = [
      /<meta\s+property="og:title"\s+content="([^"]+)"/i,
      /<h1[^>]*class="[^"]*prod_title[^"]*"[^>]*>([^<]+)</i,
      /<span[^>]*class="[^"]*prod_title[^"]*"[^>]*>([^<]+)</i,
      /<title>([^<|]+)/i,
    ];

    for (const pattern of titlePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        meta.title = cleanText(match[1]);
        break;
      }
    }
  }

  // Author extraction
  if (!meta.author) {
    const authorPatterns = [
      /저자[:\s]*<[^>]*>([^<]+)</i,
      /<meta\s+name="author"\s+content="([^"]+)"/i,
      /class="[^"]*author[^"]*"[^>]*>([^<]+)</i,
      /지은이[:\s]*<[^>]*>([^<]+)</i,
      /"author"[:\s]*"([^"]+)"/i,
    ];

    for (const pattern of authorPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        meta.author = cleanText(match[1]);
        break;
      }
    }
  }

  // Publisher extraction
  if (!meta.publisher) {
    const publisherPatterns = [
      /출판사[:\s]*<[^>]*>([^<]+)</i,
      /class="[^"]*publisher[^"]*"[^>]*>([^<]+)</i,
      /"publisher"[:\s]*"([^"]+)"/i,
      /발행처[:\s]*<[^>]*>([^<]+)</i,
    ];

    for (const pattern of publisherPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        meta.publisher = cleanText(match[1]);
        break;
      }
    }
  }

  // Published date extraction
  if (!meta.publishedDate) {
    const datePatterns = [
      /출간일[:\s]*<[^>]*>([^<]+)</i,
      /발행일[:\s]*<[^>]*>([^<]+)</i,
      /(\d{4})[.\-년]\s*(\d{1,2})[.\-월]\s*(\d{1,2})일?/,
      /"datePublished"[:\s]*"([^"]+)"/i,
    ];

    for (const pattern of datePatterns) {
      const match = html.match(pattern);
      if (match) {
        if (match[2] && match[3]) {
          meta.publishedDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
        } else if (match[1]) {
          meta.publishedDate = cleanText(match[1]);
        }
        break;
      }
    }
  }

  // ISBN extraction
  if (!meta.isbn) {
    const isbnPatterns = [
      /ISBN[:\s]*(\d{10,13})/i,
      /isbn[:\s]*"?(\d{10,13})"?/i,
      /"isbn"[:\s]*"(\d{10,13})"/i,
      /978\d{10}/,
    ];

    for (const pattern of isbnPatterns) {
      const match = html.match(pattern);
      if (match) {
        meta.isbn = match[1] || match[0];
        break;
      }
    }
  }
}

/**
 * Fallback: Try to extract basic info from search results page
 */
function extractFromSearchResults(html: string, originalQuery: string): BookMeta | null {
  try {
    const titleMatch = html.match(/class="[^"]*prod_info[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)</i) ||
                       html.match(/<strong[^>]*class="[^"]*title[^"]*"[^>]*>([^<]+)</i);
    
    const authorMatch = html.match(/class="[^"]*author[^"]*"[^>]*>([^<]+)</i);

    if (titleMatch) {
      const meta: BookMeta = {
        title: cleanText(titleMatch[1]),
        author: authorMatch ? cleanText(authorMatch[1]) : "",
      };
      console.log("[Book Voice Capture] Extracted from search results:", meta);
      return meta;
    }

    console.log("[Book Voice Capture] Using query as title fallback");
    return {
      title: originalQuery,
      author: "",
    };

  } catch (error) {
    console.error("[Book Voice Capture] Error extracting from search results:", error);
    return {
      title: originalQuery,
      author: "",
    };
  }
}

/**
 * Clean extracted text by removing excess whitespace and HTML entities
 */
function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
