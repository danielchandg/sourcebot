'use server';

import { QueryIR } from "@/features/search/ir";
import { parseQuerySyntaxIntoIR } from "@/features/search/parser";
import { createZoektSearchRequest, zoektSearch } from "@/features/search/zoektSearcher";
import { apiHandler } from "@/lib/apiHandler";
import { requestBodySchemaValidationError, serviceErrorResponse, unexpectedError } from "@/lib/serviceError";
import { isServiceError } from "@/lib/utils";
import { withOptionalAuthV2 } from "@/withAuthV2";
import { NextRequest } from "next/server";
import { z } from "zod";

const requestBodySchema = z.object({
    query: z.string(),
    isRegexEnabled: z.boolean().optional(),
    isCaseSensitivityEnabled: z.boolean().optional(),
});

/**
 * Recursively wraps Regexp and Substring nodes in Symbol queries.
 * Substring nodes are converted to Regexp (same as the sym: query parser does).
 * Structural filters (lang, repo, branch, etc.) are preserved as-is.
 */
function wrapContentInSymbol(ir: QueryIR): QueryIR {
    if (ir.regexp != null) {
        return { symbol: { expr: ir }, query: "symbol" };
    }
    if (ir.substring != null) {
        // Convert substring to regexp (unescaped literal) — matches sym: parser behavior
        return {
            symbol: {
                expr: {
                    regexp: {
                        regexp: ir.substring.pattern ?? '',
                        case_sensitive: ir.substring.case_sensitive ?? false,
                        file_name: false,
                        content: true,
                    },
                    query: "regexp",
                }
            },
            query: "symbol",
        };
    }
    if (ir.symbol != null) {
        return ir;
    }
    if (ir.and?.children) {
        return { ...ir, and: { children: ir.and.children.map(wrapContentInSymbol) } };
    }
    if (ir.or?.children) {
        return { ...ir, or: { children: ir.or.children.map(wrapContentInSymbol) } };
    }
    if (ir.not?.child) {
        return { ...ir, not: { child: wrapContentInSymbol(ir.not.child) } };
    }
    return ir;
}

/**
 * Returns a list of files that have a ctags symbol definition matching the query.
 * Used by the FQN ranking modes to boost files where the query is a defined symbol name.
 */
export const POST = apiHandler(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = requestBodySchema.safeParse(body);
    if (!parsed.success) {
        return serviceErrorResponse(requestBodySchemaValidationError(parsed.error));
    }

    const { query, isRegexEnabled, isCaseSensitivityEnabled } = parsed.data;

    try {
        const result = await withOptionalAuthV2(async ({ prisma }) => {
            const queryIR = await parseQuerySyntaxIntoIR({
                query,
                options: { isRegexEnabled, isCaseSensitivityEnabled },
                prisma,
            });

            const symbolQueryIR = wrapContentInSymbol(queryIR);
            console.log('[symbol_search] symbolQueryIR:', JSON.stringify(symbolQueryIR, null, 2));

            const zoektRequest = await createZoektSearchRequest({
                query: symbolQueryIR,
                options: { matches: 200 },
            });

            const searchResult = await zoektSearch(zoektRequest, prisma);
            console.log('[symbol_search] result file count:', searchResult.files.length);
            return searchResult.files.map(f => ({
                repositoryId: f.repositoryId,
                fileName: f.fileName.text,
            }));
        });

        if (isServiceError(result)) {
            return serviceErrorResponse(result);
        }

        return Response.json(result);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[symbol_search] error:', msg, e);
        return serviceErrorResponse(unexpectedError(`symbol_search failed: ${msg}`));
    }
});
