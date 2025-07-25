// Lightweight helpers for performing HTTP requests from within the Codex-CLI
// runtime.  We rely on the global `fetch` that ships with modern versions of
// Node (v18+) instead of adding an external dependency like `node-fetch`.

/*
 * Fetch the textual contents of a URL.  Throws a descriptive error when the
 * request fails or the response status code is not within the 2xx range.
 */
export async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url);

    if (!res.ok) {
      throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
    }

    return res.text();
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "Network access may be restricted. Unable to fetch URL.\n" +
          "If using Azure, ensure your network security group allows outbound HTTPS traffic.",
      );
    }
    throw error;
  }
}

/*
 * Perform a web search using one of the supported third-party APIs.  The
 * implementation tries the providers in the following order until a matching
 * API key is found in the environment:
 *   1. Brave Search – `BRAVE_SEARCH_API_KEY` (Recommended)
 *   2. SerpAPI – `SERP_API_KEY`
 *   3. DuckDuckGo (Fallback - no API key required)
 */
export async function searchWeb(query: string): Promise<string> {
  const brave = process.env["BRAVE_SEARCH_API_KEY"];
  if (brave) {
    return searchWebBrave(query, brave);
  }

  const serp = process.env["SERP_API_KEY"];
  if (serp) {
    return searchWebSerp(query, serp);
  }

  // -----------------------------------------------------------------------
  // Fallback: DuckDuckGo Instant-Answer API (no key required)
  // -----------------------------------------------------------------------
  // The CLI might run in an environment where no paid search-API key is
  // configured.  Rather than failing outright we fall back to DuckDuckGo's
  // public JSON endpoint.  While the Instant-Answer API is not a full web
  // search it still provides useful snippets and links that unblock the
  // `web_search` tool for ad-hoc queries.

  // Warn when falling back to DuckDuckGo
  process.stderr.write(
    "Using DuckDuckGo fallback for web search (limited results).\n" +
      "For better results, set BRAVE_SEARCH_API_KEY (recommended) or SERP_API_KEY.\n" +
      "Get a free Brave Search API key at: https://brave.com/search/api/\n",
  );

  try {
    return await searchWebDuckDuckGo(query);
  } catch (error) {
    // Bubble up a descriptive message that also reminds users how to enable
    // higher-quality providers.
    const msg =
      error instanceof Error ? error.message : String(error ?? "unknown");

    throw new Error(
      `DuckDuckGo fallback failed (${msg}). ` +
        "Please set BRAVE_SEARCH_API_KEY (recommended) or SERP_API_KEY to enable full web search support.\n" +
        "Get a free Brave Search API key at: https://brave.com/search/api/",
    );
  }
}

// ---- Provider specific helpers -------------------------------------------

async function searchWebBrave(query: string, apiKey: string): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(
    query,
  )}`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        "Accept": "application/json",
      },
    });
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "Network access may be restricted. Unable to reach Brave Search API.",
      );
    }
    throw error;
  }

  if (!res.ok) {
    throw new Error(`Brave Search API error: ${res.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await res.json();
  } catch (error) {
    throw new Error(`Failed to parse JSON response from Brave Search API`);
  }

  let results = `Search results for: "${query}"\n\n`;

  if (data.web?.results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.web.results.slice(0, 5).forEach((result: any, i: number) => {
      results += `${i + 1}. **${result.title}**\n`;
      results += `   URL: ${result.url}\n`;
      results += `   ${result.description}\n\n`;
    });
  }

  return results || "No results found.";
}

// ---------------------------------------------------------------------------
// DuckDuckGo fallback (no API key required)
// ---------------------------------------------------------------------------

async function searchWebDuckDuckGo(query: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(
    query,
  )}&format=json&t=codex-cli`;

  let res;
  try {
    res = await fetch(url, {
      // A custom UA avoids generic bot blocking and makes debugging easier.
      headers: { "User-Agent": "codex-cli-web-search" },
    });
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "Network access may be restricted. Unable to reach DuckDuckGo API.",
      );
    }
    throw error;
  }

  if (!res.ok) {
    throw new Error(`DuckDuckGo API error: ${res.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await res.json();
  } catch (error) {
    throw new Error(`Failed to parse JSON response from DuckDuckGo API`);
  }

  let results = `Search results for: "${query}"\n\n`;

  if (
    typeof data.AbstractText === "string" &&
    data.AbstractText.trim() !== ""
  ) {
    results += `Answer: ${data.AbstractText.trim()}\n\n`;
  }

  // The API groups links inside RelatedTopics; flatten to get up to 5 entries.
  const collect: Array<{ text: string; url: string }> = [];

  const pushEntry = (text?: unknown, url?: unknown) => {
    if (
      collect.length < 5 &&
      typeof text === "string" &&
      typeof url === "string"
    ) {
      collect.push({ text, url });
    }
  };

  if (Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics) {
      if (collect.length >= 5) {
        break;
      }

      // Some entries are nested one level deeper under .Topics
      if (Array.isArray(topic.Topics)) {
        for (const sub of topic.Topics) {
          pushEntry(sub.Text, sub.FirstURL);
          if (collect.length >= 5) {
            break;
          }
        }
      } else {
        pushEntry(topic.Text, topic.FirstURL);
      }
    }
  }

  collect.forEach((entry, idx) => {
    results += `${idx + 1}. **${entry.text}**\n   URL: ${entry.url}\n\n`;
  });

  if (collect.length === 0 && !data.AbstractText) {
    results += "No results found.";
  }

  return results;
}

async function searchWebSerp(query: string, apiKey: string): Promise<string> {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(
    query,
  )}&api_key=${apiKey}`;

  let res;
  try {
    res = await fetch(url);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes("fetch")) {
      throw new Error(
        "Network access may be restricted. Unable to reach SerpAPI.",
      );
    }
    throw error;
  }

  if (!res.ok) {
    throw new Error(`SerpAPI error: ${res.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await res.json();
  } catch (error) {
    throw new Error(`Failed to parse JSON response from SerpAPI`);
  }

  let results = `Search results for: "${query}"\n\n`;

  if (data.organic_results) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data.organic_results.slice(0, 5).forEach((result: any, i: number) => {
      results += `${i + 1}. **${result.title}**\n`;
      results += `   URL: ${result.link}\n`;
      results += `   ${result.snippet}\n\n`;
    });
  }

  return results || "No results found.";
}
