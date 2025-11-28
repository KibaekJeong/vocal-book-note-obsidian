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
    // Kyobo uses various URL patterns, try to find product detail links
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

    // Alternative: Try to find product IDs and construct URL
    if (!detailUrl) {
      const productIdMatch = searchHtml.match(/prod_id['":\s]+['"]?(\w+)['"]?/i) ||
                            searchHtml.match(/\/detail\/(\w+)/);
      if (productIdMatch) {
        detailUrl = `https://product.kyobobook.co.kr/detail/${productIdMatch[1]}`;
      }
    }

    if (!detailUrl) {
      console.log("[Book Voice Capture] No book detail URL found in search results");
      // Try to extract info directly from search results as fallback
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

    const detailHtml = detailResponse.text;

    // Step 4: Extract metadata from detail page
    return extractMetaFromDetailPage(detailHtml, detailUrl);

  } catch (error) {
    console.error("[Book Voice Capture] Error fetching Kyobo metadata:", error);
    return null;
  }
}

/**
 * Extract metadata from Kyobo detail page HTML
 */
function extractMetaFromDetailPage(html: string, pageUrl: string): BookMeta | null {
  const meta: BookMeta = {
    title: "",
    author: "",
    kyoboUrl: pageUrl,
  };

  try {
    // Title extraction - try multiple patterns
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

    // Author extraction
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

    // Publisher extraction
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

    // Published date extraction
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
          // Date components found
          meta.publishedDate = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
        } else if (match[1]) {
          meta.publishedDate = cleanText(match[1]);
        }
        break;
      }
    }

    // ISBN extraction
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

    // Validate we have at least a title
    if (!meta.title) {
      console.log("[Book Voice Capture] Could not extract title from detail page");
      return null;
    }

    console.log("[Book Voice Capture] Extracted metadata:", meta);
    return meta;

  } catch (error) {
    console.error("[Book Voice Capture] Error parsing detail page:", error);
    return null;
  }
}

/**
 * Fallback: Try to extract basic info from search results page
 */
function extractFromSearchResults(html: string, originalQuery: string): BookMeta | null {
  try {
    // Try to find any book info in search results
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

    // Last resort: just use the query as title
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
