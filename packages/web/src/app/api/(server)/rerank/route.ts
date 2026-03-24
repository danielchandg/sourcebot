'use server';

import { apiHandler } from '@/lib/apiHandler';
import { requestBodySchemaValidationError, serviceErrorResponse } from '@/lib/serviceError';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const fileSnippetSchema = z.object({
    repository: z.string(),
    fileName: z.string(),
    language: z.string(),
    snippet: z.string(), // First chunk content
});

const requestBodySchema = z.object({
    query: z.string(),
    files: z.array(fileSnippetSchema),
});

export const POST = apiHandler(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = requestBodySchema.safeParse(body);

    if (!parsed.success) {
        return serviceErrorResponse(requestBodySchemaValidationError(parsed.error));
    }

    const { query, files } = parsed.data;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        // If no API key, return original order
        return Response.json({ rankedIndices: files.map((_, i) => i) });
    }

    const fileList = files.map((f, i) =>
        `[${i}] ${f.repository}/${f.fileName} (${f.language})\n${f.snippet.slice(0, 300)}`
    ).join('\n\n---\n\n');

    const prompt = `You are a code search ranking expert. Given a search query and a list of code snippets, rerank them from most to least relevant.

Search query: "${query}"

Code snippets (each prefixed with its index):
${fileList}

Return ONLY a JSON array of indices in order from most to least relevant, e.g. [2, 0, 3, 1].
Do not include any explanation, just the JSON array.`;

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 256,
                messages: [{ role: 'user', content: prompt }],
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            return Response.json({ rankedIndices: files.map((_, i) => i) });
        }

        const data = await response.json() as { content: Array<{ type: string; text: string }> };
        const text = data.content?.[0]?.text ?? '';

        const match = text.match(/\[[\d,\s]+\]/);
        if (!match) {
            return Response.json({ rankedIndices: files.map((_, i) => i) });
        }

        const rankedIndices: number[] = JSON.parse(match[0]);

        // Validate the indices are a permutation of 0..n-1
        const validSet = new Set(files.map((_, i) => i));
        const isValid = rankedIndices.length === files.length &&
            rankedIndices.every(i => validSet.has(i)) &&
            new Set(rankedIndices).size === rankedIndices.length;

        if (!isValid) {
            return Response.json({ rankedIndices: files.map((_, i) => i) });
        }

        return Response.json({ rankedIndices });
    } catch {
        return Response.json({ rankedIndices: files.map((_, i) => i) });
    }
});
