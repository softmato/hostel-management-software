import { BANK_CSV_PARSER } from "@/modules/finance/statements/parsers/bank-csv";
import { ESEWA_PARSER } from "@/modules/finance/statements/parsers/esewa";
import { KHALTI_CSV_PARSER } from "@/modules/finance/statements/parsers/khalti-csv";
import {
  type StatementBytes,
  peekStatementHeaders,
} from "@/modules/finance/statements/parsers/source";
import {
  type StatementParser,
  type StatementProvider,
  StatementParseError,
} from "@/modules/finance/statements/parsers/types";

/**
 * Provider → parser, versioned (target §6.4).
 *
 * Two lookups, and the difference matters:
 *
 * - {@link resolveParser} picks the **current** parser for a fresh upload.
 * - {@link parserByVersion} finds the **exact** parser a past import used, by
 *   the version stored on that import. When `esewa-csv@2` lands, `@1` stays
 *   registered here — a statement imported last March must still be
 *   re-readable, otherwise a parser bug is unfixable for exactly the months
 *   somebody is disputing.
 *
 * Superseded parsers therefore stay in {@link PARSER_VERSIONS} but leave
 * {@link CURRENT_PARSERS}, so nothing new is ever routed to an old one.
 */

/** The parser each provider's new uploads go through. */
export const CURRENT_PARSERS: StatementParser[] = [
  ESEWA_PARSER,
  KHALTI_CSV_PARSER,
  BANK_CSV_PARSER,
];

/**
 * Every parser that has ever produced a stored import, current ones included.
 *
 * **The `@1` generation is deliberately absent rather than retained.** It was
 * written against assumed column shapes, and when the first real eSewa export
 * arrived it could not read it — wrong id column, `0.0` in the unused Dr/Cr
 * side, a totals row inside the table, and no notion of a cancelled
 * transaction. A parser that never successfully read a provider's file cannot
 * have produced a stored import, so there is nothing for it to keep re-readable
 * and keeping it would only offer a broken parser to a future re-parse.
 */
const PARSER_VERSIONS: StatementParser[] = [...CURRENT_PARSERS];

export function parserByVersion(version: string): StatementParser | null {
  return PARSER_VERSIONS.find((parser) => parser.version === version) ?? null;
}

export function currentParserFor(
  provider: StatementProvider,
): StatementParser | null {
  return CURRENT_PARSERS.find((parser) => parser.provider === provider) ?? null;
}

/**
 * Picks the parser for an uploaded file.
 *
 * The owner names the provider on the upload form, so `provider` is the primary
 * key and detection is a **guard, not a search**: if the chosen provider's
 * parser does not recognise the headers, the upload is refused with the reason,
 * rather than quietly handed to whichever other parser happens to match. An
 * eSewa export silently read by the bank parser is precisely the confidently
 * wrong outcome this whole module is built to avoid.
 */
export function resolveParser(
  provider: StatementProvider,
  source: StatementBytes,
): StatementParser {
  const parser = currentParserFor(provider);

  if (!parser) {
    throw new StatementParseError(
      `No statement parser is available for ${provider} yet.`,
    );
  }

  const headers = peekStatementHeaders(source);

  if (!parser.detect(headers)) {
    const recognisedBy = CURRENT_PARSERS.filter(
      (candidate) => candidate !== parser && candidate.detect(headers),
    );
    const hint = recognisedBy.length
      ? ` This file looks like a ${recognisedBy.map((one) => one.label).join(" or ")}.`
      : " The statement format may have changed.";

    throw new StatementParseError(
      `This file does not look like a ${parser.label}.${hint}`,
    );
  }

  return parser;
}
