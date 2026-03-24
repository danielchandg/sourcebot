import { PrismaClient } from '@sourcebot/db';
import { createLogger, getRepoPath } from '@sourcebot/shared';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { simpleGit } from 'simple-git';

const logger = createLogger('codeRank');

// ---- Language definitions ----

type Language = 'c-family' | 'js-family' | 'java' | 'python' | 'rust' | 'kotlin';

const EXTENSION_TO_LANGUAGE: Record<string, Language> = {
    // C-family: C, C++, Objective-C, Objective-C++
    '.c':   'c-family',
    '.cpp': 'c-family',
    '.cc':  'c-family',
    '.cxx': 'c-family',
    '.h':   'c-family',
    '.hpp': 'c-family',
    '.hxx': 'c-family',
    '.inl': 'c-family',
    '.m':   'c-family',
    '.mm':  'c-family',
    // JS-family: JavaScript, TypeScript, JSX, TSX
    '.js':  'js-family',
    '.mjs': 'js-family',
    '.cjs': 'js-family',
    '.jsx': 'js-family',
    '.ts':  'js-family',
    '.tsx': 'js-family',
    // Java
    '.java': 'java',
    // Python
    '.py': 'python',
    // Rust
    '.rs': 'rust',
    // Kotlin
    '.kt':  'kotlin',
    '.kts': 'kotlin',
};

// ---- Import extraction regexes ----

// #include "foo.h" or #import "foo.h" (quoted only — angle-bracket includes are system headers)
const C_INCLUDE_RE = /^\s*#\s*(?:include|import)\s+"([^"]+)"/gm;

// import ... from './foo'  or  import './foo'
const JS_FROM_RE = /\bfrom\s+['"](\.[^'"]+)['"]/gm;
// require('./foo')
const JS_REQUIRE_RE = /\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)/gm;
// import('./foo')
const JS_DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/gm;

// import com.example.Foo;
const JAVA_IMPORT_RE = /^\s*import\s+([\w.]+)\s*;/gm;

// from .foo import bar  /  from ..models import User
// Only relative imports; absolute imports require knowing the package root.
const PYTHON_RELATIVE_RE = /^\s*from\s+(\.+\w*(?:\.\w+)*)\s+import/gm;

// mod foo;  or  pub mod foo;
// 'use' statements reference module paths, not file paths, so we skip them.
const RUST_MOD_RE = /^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm;

// import com.example.Foo
const KOTLIN_IMPORT_RE = /^\s*import\s+([\w.]+)/gm;

function extractImports(content: string, language: Language): string[] {
    const results: string[] = [];

    const collect = (re: RegExp) => {
        // Reset lastIndex since regexes are module-level constants with the /g flag.
        re.lastIndex = 0;
        for (const match of content.matchAll(re)) {
            results.push(match[1]);
        }
    };

    switch (language) {
        case 'c-family':
            collect(C_INCLUDE_RE);
            break;
        case 'js-family':
            collect(JS_FROM_RE);
            collect(JS_REQUIRE_RE);
            collect(JS_DYNAMIC_IMPORT_RE);
            break;
        case 'java':
            collect(JAVA_IMPORT_RE);
            break;
        case 'python':
            collect(PYTHON_RELATIVE_RE);
            break;
        case 'rust':
            collect(RUST_MOD_RE);
            break;
        case 'kotlin':
            collect(KOTLIN_IMPORT_RE);
            break;
    }

    return results;
}

// ---- Path resolution ----

function resolveImport(
    importStr: string,
    sourceFile: string,
    language: Language,
    allFiles: Set<string>,
): string | null {
    switch (language) {
        case 'c-family':  return resolveCFamily(importStr, sourceFile, allFiles);
        case 'js-family': return resolveJsFamily(importStr, sourceFile, allFiles);
        case 'java':      return resolveJavaLike(importStr, '.java', allFiles);
        case 'python':    return resolvePython(importStr, sourceFile, allFiles);
        case 'rust':      return resolveRust(importStr, sourceFile, allFiles);
        case 'kotlin':    return resolveJavaLike(importStr, '.kt', allFiles);
    }
}

function resolveCFamily(importStr: string, sourceFile: string, allFiles: Set<string>): string | null {
    const sourceDir = path.dirname(sourceFile);

    // 1. Relative to the including file's directory
    const fromDir = path.join(sourceDir, importStr);
    if (allFiles.has(fromDir)) return fromDir;

    // 2. Relative to repo root
    if (allFiles.has(importStr)) return importStr;

    // 3. Suffix match — handles -I include paths unknown to us
    for (const f of allFiles) {
        if (f.endsWith('/' + importStr)) return f;
    }

    return null;
}

const JS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

function resolveJsFamily(importStr: string, sourceFile: string, allFiles: Set<string>): string | null {
    // Only relative imports are resolvable without a bundler/tsconfig
    if (!importStr.startsWith('.')) return null;

    const base = path.join(path.dirname(sourceFile), importStr);

    // 1. Exact match (e.g. already has extension)
    if (allFiles.has(base)) return base;

    // 2. Try appending each extension
    for (const ext of JS_EXTENSIONS) {
        const candidate = base + ext;
        if (allFiles.has(candidate)) return candidate;
    }

    // 3. Try index file inside a directory
    for (const ext of JS_EXTENSIONS) {
        const candidate = path.join(base, 'index') + ext;
        if (allFiles.has(candidate)) return candidate;
    }

    return null;
}

function resolveJavaLike(importStr: string, ext: string, allFiles: Set<string>): string | null {
    // com.example.Foo  →  com/example/Foo.java (or .kt)
    // We don't know the source root, so we do a suffix search.
    const suffix = importStr.replace(/\./g, '/') + ext;

    for (const f of allFiles) {
        if (f === suffix || f.endsWith('/' + suffix)) return f;
    }

    return null;
}

function resolvePython(importStr: string, sourceFile: string, allFiles: Set<string>): string | null {
    const dots = importStr.match(/^\.+/)?.[0] ?? '';
    const modulePart = importStr.slice(dots.length); // may be empty, e.g. "from . import foo"

    if (!modulePart) return null;

    let baseDir = path.dirname(sourceFile);
    // First dot means "current package"; each additional dot goes up one level
    for (let i = 1; i < dots.length; i++) {
        baseDir = path.dirname(baseDir);
    }

    // foo.bar  →  foo/bar.py  (handle dotted module paths too)
    const relPath = modulePart.replace(/\./g, '/');

    const fileCandiate = path.join(baseDir, relPath + '.py');
    if (allFiles.has(fileCandiate)) return fileCandiate;

    const packageCandidate = path.join(baseDir, relPath, '__init__.py');
    if (allFiles.has(packageCandidate)) return packageCandidate;

    return null;
}

function resolveRust(modName: string, sourceFile: string, allFiles: Set<string>): string | null {
    const sourceDir = path.dirname(sourceFile);

    // mod foo;  →  <dir>/foo.rs
    const sibling = path.join(sourceDir, modName + '.rs');
    if (allFiles.has(sibling)) return sibling;

    // mod foo;  →  <dir>/foo/mod.rs
    const modFile = path.join(sourceDir, modName, 'mod.rs');
    if (allFiles.has(modFile)) return modFile;

    return null;
}

// ---- CodeRank ----

const DAMPING_FACTOR = 0.85;
const MAX_ITERATIONS = 200;
const CONVERGENCE_EPSILON = 1e-6;

function computeCodeRank(edges: Map<string, string[]>): Map<string, number> {
    const nodes = new Set<string>([
        ...edges.keys(),
        ...[...edges.values()].flat(),
    ]);

    const N = nodes.size;
    if (N === 0) return new Map();

    let scores = new Map<string, number>([...nodes].map(n => [n, 1 / N]));

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const next = new Map<string, number>([...nodes].map(n => [n, (1 - DAMPING_FACTOR) / N]));
        for (const [src, targets] of edges) {
            if (targets.length === 0) continue;
            const share = DAMPING_FACTOR * (scores.get(src) ?? 0) / targets.length;
            for (const tgt of targets) {
                next.set(tgt, (next.get(tgt) ?? 0) + share);
            }
        }

        let delta = 0;
        for (const [node, score] of next) {
            delta += Math.abs(score - (scores.get(node) ?? 0));
        }
        scores = next;
        if (delta < CONVERGENCE_EPSILON) {
            logger.info(`CodeRank converged after ${i + 1} iterations.`);
            break;
        }
    }

    return scores;
}

// ---- Main entry point ----

export async function computeAndStoreCodeRank(prisma: PrismaClient): Promise<void> {
    const existingCount = await prisma.fileCodeRankScore.count();
    if (existingCount > 0) {
        logger.info('CodeRank scores already exist, skipping. Truncate the fileCodeRankScore table to recompute.');
        return;
    }

    const repos = await prisma.repo.findMany({
        where: { indexedAt: { not: null } },
    });

    if (repos.length === 0) {
        logger.info('No indexed repos found, skipping CodeRank computation.');
        return;
    }

    logger.info(`Computing CodeRank across ${repos.length} repos...`);

    // nodeId = `${repoId}:${filePath}` — unique across all repos
    const edges = new Map<string, string[]>();

    for (const repo of repos) {
        const { path: repoPath } = getRepoPath(repo);

        if (!existsSync(repoPath)) {
            logger.warn(`Repo path not found for "${repo.name}" (${repoPath}), skipping.`);
            continue;
        }

        const git = simpleGit(repoPath);

        let fileList: string[];
        try {
            const output = await git.raw(['ls-tree', '-r', '--name-only', 'HEAD']);
            fileList = output.trim().split('\n').filter(Boolean);
        } catch (err) {
            logger.warn(`Failed to list files for "${repo.name}": ${err}`);
            continue;
        }

        logger.info(`Processing "${repo.name}" — ${fileList.length} files`);

        const allFiles = new Set(fileList);

        // Register every supported file as a node, even those with no edges
        for (const file of fileList) {
            const lang = EXTENSION_TO_LANGUAGE[path.extname(file).toLowerCase()];
            if (lang) {
                edges.set(`${repo.id}:${file}`, []);
            }
        }

        for (const file of fileList) {
            const lang = EXTENSION_TO_LANGUAGE[path.extname(file).toLowerCase()];
            if (!lang) continue;

            let content: string;
            try {
                content = await git.raw(['show', `HEAD:${file}`]);
            } catch (err) {
                logger.warn(`Failed to read "${file}" in "${repo.name}": ${err}`);
                continue;
            }

            const resolved: string[] = [];
            for (const importStr of extractImports(content, lang)) {
                const target = resolveImport(importStr, file, lang, allFiles);
                if (target) {
                    resolved.push(`${repo.id}:${target}`);
                }
            }

            edges.set(`${repo.id}:${file}`, resolved);
        }
    }

    logger.info(`Graph built: ${edges.size} nodes. Running PageRank...`);

    const scores = computeCodeRank(edges);

    logger.info(`PageRank done. Storing ${scores.size} scores...`);

    const records = [...scores.entries()].map(([nodeId, score]) => {
        const sep = nodeId.indexOf(':');
        return {
            repoId: parseInt(nodeId.slice(0, sep), 10),
            filePath: nodeId.slice(sep + 1),
            score,
        };
    });

    const BATCH_SIZE = 1000;
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
        await prisma.fileCodeRankScore.createMany({ data: records.slice(i, i + BATCH_SIZE) });
    }

    logger.info('CodeRank computation complete.');
}
