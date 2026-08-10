import { BANK_CSV_PARSER } from "@/modules/finance/statements/parsers/bank-csv";
import { peekHeaders } from "@/modules/finance/statements/parsers/csv";
import { ESEWA_CSV_PARSER } from "@/modules/finance/statements/parsers/esewa-csv";
import { KHALTI_CSV_PARSER } from "@/modules/finance/statements/parsers/khalti-csv";
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
  ESEWA_CSV_PARSER,
  KHALTI_CSV_PARSER,
  BANK_CSV_PARSER,
];

/** Every parser that has ever produced a stored import, current ones included. */
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
  text: string,
): StatementParser {
  const parser = currentParserFor(provider);

  if (!parser) {
    throw new StatementParseError(
      `No statement parser is available for ${provider} yet.`,
    );
  }

  const headers = peekHeaders(text);

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
