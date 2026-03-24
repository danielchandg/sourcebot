'use server';

import { apiHandler } from '@/lib/apiHandler';
import { requestBodySchemaValidationError, serviceErrorResponse } from '@/lib/serviceError';
import { isServiceError } from '@/lib/utils';
import { withOptionalAuthV2 } from '@/withAuthV2';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const requestBodySchema = z.object({
    files: z.array(z.object({
        repoId: z.number(),
        filePath: z.string(),
    })),
});

export const POST = apiHandler(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = requestBodySchema.safeParse(body);

    if (!parsed.success) {
        return serviceErrorResponse(requestBodySchemaValidationError(parsed.error));
    }

    const { files } = parsed.data;

    const result = await withOptionalAuthV2(async ({ prisma }) => {
        const rows = await prisma.fileCodeRankScore.findMany({
            where: {
                OR: files.map(f => ({ repoId: f.repoId, filePath: f.filePath })),
            },
            select: { repoId: true, filePath: true, score: true },
        });

        const scoreMap: Record<string, number> = {};
        for (const row of rows) {
            scoreMap[`${row.repoId}:${row.filePath}`] = row.score;
        }
        return scoreMap;
    });

    if (isServiceError(result)) {
        return serviceErrorResponse(result);
    }

    return Response.json(result);
});
