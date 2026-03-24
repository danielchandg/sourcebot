'use server';

import { apiHandler } from '@/lib/apiHandler';
import { requestBodySchemaValidationError, serviceErrorResponse } from '@/lib/serviceError';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const requestBodySchema = z.object({
    repoNames: z.array(z.string()),
});

interface GitHubRepoData {
    stargazers_count: number;
    forks_count: number;
    watchers_count: number;
}

// Cache GitHub API responses in memory to avoid rate limiting
const starsCache = new Map<string, { stars: number; forks: number; fetchedAt: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const fetchGitHubStars = async (repoName: string): Promise<{ stars: number; forks: number }> => {
    const cached = starsCache.get(repoName);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
        return { stars: cached.stars, forks: cached.forks };
    }

    // Extract owner/repo from names like "github.com/owner/repo"
    const match = repoName.match(/^github\.com\/([^/]+\/[^/]+)/);
    if (!match) {
        return { stars: 0, forks: 0 };
    }

    const ownerRepo = match[1];

    try {
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'sourcebot',
        };

        const token = process.env.GITHUB_TOKEN;
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`https://api.github.com/repos/${ownerRepo}`, {
            headers,
            signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
            return { stars: 0, forks: 0 };
        }

        const data = await response.json() as GitHubRepoData;
        const result = { stars: data.stargazers_count ?? 0, forks: data.forks_count ?? 0 };

        starsCache.set(repoName, { ...result, fetchedAt: Date.now() });
        return result;
    } catch {
        return { stars: 0, forks: 0 };
    }
};

export const POST = apiHandler(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = requestBodySchema.safeParse(body);

    if (!parsed.success) {
        return serviceErrorResponse(requestBodySchemaValidationError(parsed.error));
    }

    const { repoNames } = parsed.data;

    const results = await Promise.all(
        repoNames.map(async (name) => ({
            name,
            ...(await fetchGitHubStars(name)),
        }))
    );

    const starMap: Record<string, { stars: number; forks: number }> = {};
    for (const r of results) {
        starMap[r.name] = { stars: r.stars, forks: r.forks };
    }

    return Response.json(starMap);
});
