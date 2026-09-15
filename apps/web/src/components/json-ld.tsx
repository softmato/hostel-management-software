import { serializeJsonLd } from "@/lib/json-ld";

type JsonLdData = Record<string, unknown>;

/**
 * Structured data for search engines. Server-rendered only — a record that
 * appears after hydration is one most crawlers never read. Null entries are
 * skipped so a page can pass a builder that had nothing to say (an empty FAQ).
 */
export function JsonLd({ data }: { data: JsonLdData | Array<JsonLdData | null> | null }) {
  const records = (Array.isArray(data) ? data : [data]).filter(
    (record): record is JsonLdData => record !== null,
  );

  if (records.length === 0) {
    return null;
  }

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: serializeJsonLd(records.length === 1 ? records[0] : records),
      }}
      type="application/ld+json"
    />
  );
}
