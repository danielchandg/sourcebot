'use client';

import { CodeSnippet } from "@/app/components/codeSnippet";
import { KeyboardShortcutHint } from "@/app/components/keyboardShortcutHint";
import { useToast } from "@/components/hooks/use-toast";
import { AnimatedResizableHandle } from "@/components/ui/animatedResizableHandle";
import { Button } from "@/components/ui/button";
import {
    ResizablePanel,
    ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RepositoryInfo, SearchResultFile, SearchStats } from "@/features/search";
import { SortBy } from "@/features/search/types";
import useCaptureEvent from "@/hooks/useCaptureEvent";
import { useDomain } from "@/hooks/useDomain";
import { useNonEmptyQueryParam } from "@/hooks/useNonEmptyQueryParam";
import { useSearchHistory } from "@/hooks/useSearchHistory";
import { SearchQueryParams } from "@/lib/types";
import { createPathWithQueryParams } from "@/lib/utils";
import { InfoCircledIcon } from "@radix-ui/react-icons";
import { useLocalStorage } from "@uidotdev/usehooks";
import { AlertTriangleIcon, BugIcon, FilterIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { ImperativePanelHandle } from "react-resizable-panels";
import { CopyIconButton } from "../../components/copyIconButton";
import { SearchBar } from "../../components/searchBar";
import { TopBar } from "../../components/topBar";
import { useStreamedSearch } from "../useStreamedSearch";
import { CodePreviewPanel } from "./codePreviewPanel";
import { FilterPanel } from "./filterPanel";
import { useFilteredMatches } from "./filterPanel/useFilterMatches";
import { SearchResultsPanel, SearchResultsPanelHandle } from "./searchResultsPanel";
import { ServiceErrorException } from "@/lib/serviceError";
import { Session } from "next-auth";

interface SearchResultsPageProps {
    searchQuery: string;
    defaultMaxMatchCount: number;
    isRegexEnabled: boolean;
    isCaseSensitivityEnabled: boolean;
    sortBy: SortBy;
    session: Session | null;
    isSearchAssistSupported: boolean;
}

export const SearchResultsPage = ({
    searchQuery,
    defaultMaxMatchCount,
    isRegexEnabled,
    isCaseSensitivityEnabled,
    sortBy,
    session,
    isSearchAssistSupported,
}: SearchResultsPageProps) => {
    const router = useRouter();
    const { setSearchHistory } = useSearchHistory();
    const domain = useDomain();
    const { toast } = useToast();
    const captureEvent = useCaptureEvent();

    // Encodes the number of matches to return in the search response.
    const _maxMatchCount = parseInt(useNonEmptyQueryParam(SearchQueryParams.matches) ?? `${defaultMaxMatchCount}`);
    const maxMatchCount = isNaN(_maxMatchCount) ? defaultMaxMatchCount : _maxMatchCount;

    const {
        error,
        files,
        repoInfo,
        timeToSearchCompletionMs,
        timeToFirstSearchResultMs,
        isStreaming,
        numMatches,
        isExhaustive,
        stats,
    } = useStreamedSearch({
        query: searchQuery,
        matches: maxMatchCount,
        contextLines: 3,
        whole: false,
        isRegexEnabled,
        isCaseSensitivityEnabled,
        // BM25 is applied at the Zoekt level; other sorts are post-processed client-side
        sortBy: sortBy === 'bm25' ? 'bm25' : 'default',
    });

    useEffect(() => {
        if (error) {
            toast({
                description: `❌ Search failed. Reason: ${error instanceof ServiceErrorException ? error.serviceError.message : error.message}`,
            });
        }
    }, [error, toast]);


    // Write the query to the search history
    useEffect(() => {
        if (searchQuery.length === 0) {
            return;
        }

        const now = new Date().toUTCString();
        setSearchHistory((searchHistory) => [
            {
                query: searchQuery,
                date: now,
            },
            ...searchHistory.filter(search => search.query !== searchQuery),
        ])
    }, [searchQuery, setSearchHistory]);

    // Look for any files that are not on the default branch.
    const isBranchFilteringEnabled = useMemo(() => {
        return searchQuery.includes('rev:');
    }, [searchQuery]);

    useEffect(() => {
        if (isStreaming || !stats) {
            return;
        }

        const fileLanguages = files.map(file => file.language) || [];

        console.debug('timeToFirstSearchResultMs:', timeToFirstSearchResultMs);
        console.debug('timeToSearchCompletionMs:', timeToSearchCompletionMs);

        captureEvent("search_finished", {
            durationMs: timeToSearchCompletionMs,
            timeToSearchCompletionMs,
            timeToFirstSearchResultMs,
            fileCount: stats.fileCount,
            matchCount: stats.totalMatchCount,
            actualMatchCount: stats.actualMatchCount,
            filesSkipped: stats.filesSkipped,
            contentBytesLoaded: stats.contentBytesLoaded,
            indexBytesLoaded: stats.indexBytesLoaded,
            crashes: stats.crashes,
            shardFilesConsidered: stats.shardFilesConsidered,
            filesConsidered: stats.filesConsidered,
            filesLoaded: stats.filesLoaded,
            shardsScanned: stats.shardsScanned,
            shardsSkipped: stats.shardsSkipped,
            shardsSkippedFilter: stats.shardsSkippedFilter,
            ngramMatches: stats.ngramMatches,
            ngramLookups: stats.ngramLookups,
            wait: stats.wait,
            matchTreeConstruction: stats.matchTreeConstruction,
            matchTreeSearch: stats.matchTreeSearch,
            regexpsConsidered: stats.regexpsConsidered,
            flushReason: stats.flushReason,
            fileLanguages,
            isSearchExhaustive: isExhaustive,
            isBranchFilteringEnabled,
        });
    }, [
        captureEvent,
        files,
        isStreaming,
        isExhaustive,
        stats,
        timeToSearchCompletionMs,
        timeToFirstSearchResultMs,
        isBranchFilteringEnabled,
    ]);

    const onLoadMoreResults = useCallback(() => {
        const url = createPathWithQueryParams(`/${domain}/search`,
            [SearchQueryParams.query, searchQuery],
            [SearchQueryParams.matches, `${maxMatchCount * 2}`],
            [SearchQueryParams.isRegexEnabled, isRegexEnabled ? "true" : null],
            [SearchQueryParams.isCaseSensitivityEnabled, isCaseSensitivityEnabled ? "true" : null],
            [SearchQueryParams.sortBy, sortBy !== 'default' ? sortBy : null],
        )
        router.push(url);
    }, [maxMatchCount, router, searchQuery, domain, isRegexEnabled, isCaseSensitivityEnabled, sortBy]);

    const onSortByChange = useCallback((newSortBy: SortBy) => {
        const url = createPathWithQueryParams(`/${domain}/search`,
            [SearchQueryParams.query, searchQuery],
            [SearchQueryParams.matches, `${maxMatchCount}`],
            [SearchQueryParams.isRegexEnabled, isRegexEnabled ? "true" : null],
            [SearchQueryParams.isCaseSensitivityEnabled, isCaseSensitivityEnabled ? "true" : null],
            [SearchQueryParams.sortBy, newSortBy !== 'default' ? newSortBy : null],
        )
        router.push(url);
    }, [maxMatchCount, router, searchQuery, domain, isRegexEnabled, isCaseSensitivityEnabled]);

    return (
        <div className="flex flex-col h-screen overflow-clip">
            {/* TopBar */}
            <TopBar
                domain={domain}
                session={session}
            >
                <SearchBar
                    size="sm"
                    defaults={{
                        isRegexEnabled,
                        isCaseSensitivityEnabled,
                        query: searchQuery,
                    }}
                    className="w-full"
                    isSearchAssistSupported={isSearchAssistSupported}
                />
            </TopBar>

            {error ? (
                <div className="flex flex-col items-center justify-center h-full gap-2">
                    <AlertTriangleIcon className="h-6 w-6" />
                    <p className="font-semibold text-center">Failed to search</p>
                    <p className="text-sm text-center">{error instanceof ServiceErrorException ? error.serviceError.message : error.message}</p>
                </div>
            ) : (
                <PanelGroup
                    fileMatches={files}
                    onLoadMoreResults={onLoadMoreResults}
                    numMatches={numMatches}
                    repoInfo={repoInfo}
                    searchDurationMs={timeToSearchCompletionMs}
                    isStreaming={isStreaming}
                    searchStats={stats}
                    isMoreResultsButtonVisible={!isExhaustive}
                    isBranchFilteringEnabled={isBranchFilteringEnabled}
                    sortBy={sortBy}
                    onSortByChange={onSortByChange}
                    searchQuery={searchQuery}
                />
            )}
        </div>
    );
}


interface PanelGroupProps {
    fileMatches: SearchResultFile[];
    onLoadMoreResults: () => void;
    isStreaming: boolean;
    isMoreResultsButtonVisible?: boolean;
    isBranchFilteringEnabled: boolean;
    repoInfo: Record<number, RepositoryInfo>;
    searchDurationMs: number;
    numMatches: number;
    searchStats?: SearchStats;
    sortBy: SortBy;
    onSortByChange: (sortBy: SortBy) => void;
    searchQuery: string;
}

const SORT_BY_LABELS: Record<SortBy, string> = {
    'default': 'Default',
    'bm25': 'BM25',
    'github-popularity': 'GitHub Popularity',
    'pagerank': 'PageRank',
    'llm': 'LLM Reranking',
};

const PanelGroup = ({
    fileMatches,
    isMoreResultsButtonVisible,
    isStreaming,
    onLoadMoreResults,
    isBranchFilteringEnabled,
    repoInfo,
    searchDurationMs: _searchDurationMs,
    numMatches,
    searchStats,
    sortBy,
    onSortByChange,
    searchQuery,
}: PanelGroupProps) => {
    const [previewedFile, setPreviewedFile] = useState<SearchResultFile | undefined>(undefined);
    const filteredFileMatches = useFilteredMatches(fileMatches);
    const filterPanelRef = useRef<ImperativePanelHandle>(null);
    const searchResultsPanelRef = useRef<SearchResultsPanelHandle>(null);
    const [selectedMatchIndex, setSelectedMatchIndex] = useState(0);
    const [isFilterPanelCollapsed, setIsFilterPanelCollapsed] = useLocalStorage('isFilterPanelCollapsed', false);

    // State for post-processed (reranked) results
    const [rankedFiles, setRankedFiles] = useState<SearchResultFile[]>([]);
    const [isReranking, setIsReranking] = useState(false);

    // Ref so the reranking effect can read the latest filtered results
    // without depending on them (which would cause re-fire loops).
    const filteredFileMatchesRef = useRef<SearchResultFile[]>([]);
    filteredFileMatchesRef.current = filteredFileMatches;

    useHotkeys("mod+b", () => {
        if (isFilterPanelCollapsed) {
            filterPanelRef.current?.expand();
        } else {
            filterPanelRef.current?.collapse();
        }
    }, {
        enableOnFormTags: true,
        enableOnContentEditable: true,
        description: "Toggle filter panel",
    });

    const searchDurationMs = useMemo(() => {
        return Math.round(_searchDurationMs);
    }, [_searchDurationMs]);

    // Effect 1: During streaming (or on reset), mirror filtered results directly
    // into rankedFiles so the user sees results as they arrive.
    // Safe to re-run on every filteredFileMatches change because it never
    // triggers async work or additional state updates that feed back into
    // filteredFileMatches.
    useEffect(() => {
        if (isStreaming || filteredFileMatches.length === 0) {
            setRankedFiles(filteredFileMatches);
        }
    }, [filteredFileMatches, isStreaming]);

    // Effect 2: Once streaming finishes, apply the selected reranking method.
    // Intentionally does NOT depend on filteredFileMatches — it reads the
    // latest value via filteredFileMatchesRef instead. This prevents the
    // setIsReranking(true) / setRankedFiles(...) calls inside from creating
    // a re-render → new array reference → re-fire loop.
    useEffect(() => {
        if (isStreaming) return;

        const files = filteredFileMatchesRef.current;
        if (files.length === 0) return;

        if (sortBy === 'default' || sortBy === 'bm25') {
            setRankedFiles(files);
            return;
        }

        const abortController = new AbortController();

        if (sortBy === 'pagerank') {
            setIsReranking(true);

            fetch('/api/coderank_scores', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ files: files.map(f => ({ repoId: f.repositoryId, filePath: f.fileName.text })) }),
                signal: abortController.signal,
            })
                .then(r => r.json() as Promise<Record<string, number>>)
                .then(scoreMap => {
                    const sorted = [...files].sort((a, b) => {
                        const aScore = scoreMap[`${a.repositoryId}:${a.fileName.text}`] ?? 0;
                        const bScore = scoreMap[`${b.repositoryId}:${b.fileName.text}`] ?? 0;
                        return bScore - aScore;
                    });
                    setRankedFiles(sorted);
                })
                .catch((err) => { if (err.name !== 'AbortError') setRankedFiles(files); })
                .finally(() => setIsReranking(false));
        } else if (sortBy === 'github-popularity') {
            const uniqueRepos = [...new Set(files.map(f => f.repository))];
            setIsReranking(true);

            fetch('/api/repo_stars', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoNames: uniqueRepos }),
                signal: abortController.signal,
            })
                .then(r => r.json() as Promise<Record<string, { stars: number; forks: number }>>)
                .then(starMap => {
                    const sorted = [...files].sort((a, b) => {
                        const aStars = starMap[a.repository]?.stars ?? 0;
                        const bStars = starMap[b.repository]?.stars ?? 0;
                        if (bStars !== aStars) return bStars - aStars;
                        const aMatches = a.chunks.reduce((s, c) => s + c.matchRanges.length, 0);
                        const bMatches = b.chunks.reduce((s, c) => s + c.matchRanges.length, 0);
                        return bMatches - aMatches;
                    });
                    setRankedFiles(sorted);
                })
                .catch((err) => { if (err.name !== 'AbortError') setRankedFiles(files); })
                .finally(() => setIsReranking(false));
        } else if (sortBy === 'llm') {
            const TOP_K = 20;
            const topFiles = files.slice(0, TOP_K);
            const restFiles = files.slice(TOP_K);

            setIsReranking(true);

            const snippets = topFiles.map(f => ({
                repository: f.repository,
                fileName: f.fileName.text,
                language: f.language,
                snippet: f.chunks[0]?.content ?? '',
            }));

            fetch('/api/rerank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: searchQuery, files: snippets }),
                signal: abortController.signal,
            })
                .then(r => r.json() as Promise<{ rankedIndices: number[] }>)
                .then(({ rankedIndices }) => {
                    const reranked = rankedIndices.map(i => topFiles[i]);
                    setRankedFiles([...reranked, ...restFiles]);
                })
                .catch((err) => { if (err.name !== 'AbortError') setRankedFiles(files); })
                .finally(() => setIsReranking(false));
        } else {
            setRankedFiles(files);
        }

        return () => { abortController.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isStreaming, sortBy, searchQuery]);

    return (
        <ResizablePanelGroup
            direction="horizontal"
            className="h-full"
        >
            {/* ~~ Filter panel ~~ */}
            <ResizablePanel
                ref={filterPanelRef}
                minSize={20}
                maxSize={30}
                defaultSize={isFilterPanelCollapsed ? 0 : 20}
                collapsible={true}
                id={'filter-panel'}
                order={1}
                onCollapse={() => setIsFilterPanelCollapsed(true)}
                onExpand={() => setIsFilterPanelCollapsed(false)}
            >
                <FilterPanel
                    matches={fileMatches}
                    repoInfo={repoInfo}
                    isStreaming={isStreaming}
                    onFilterChange={() => {
                        searchResultsPanelRef.current?.resetScroll();
                    }}
                />
            </ResizablePanel>
            {isFilterPanelCollapsed && (
                <div className="flex flex-col items-center h-full p-2">
                    <Tooltip
                        delayDuration={100}
                    >
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => {
                                    filterPanelRef.current?.expand();
                                }}
                            >
                                <FilterIcon className="w-4 h-4" />
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="flex flex-row items-center gap-2">
                            <KeyboardShortcutHint shortcut="mod+b" />
                            <Separator orientation="vertical" className="h-4" />
                            <span>Open filter panel</span>
                        </TooltipContent>
                    </Tooltip>
                </div>
            )}
            <AnimatedResizableHandle />

            {/* ~~ Search results ~~ */}
            <ResizablePanel
                minSize={10}
                id={'search-results-panel'}
                order={2}
            >
                <div className="flex h-full flex-col">
                    <div className="py-1 px-2 flex flex-row items-center gap-2">
                        {isStreaming ? (
                            <>
                                <RefreshCwIcon className="h-4 w-4 animate-spin mr-2" />
                                <p className="text-sm font-medium mr-1">Searching...</p>
                                {numMatches > 0 && (
                                    <p className="text-sm font-medium">{`Found ${numMatches} matches in ${fileMatches.length} ${fileMatches.length > 1 ? 'files' : 'file'}`}</p>
                                )}
                            </>
                        ) : (
                            <>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <InfoCircledIcon className="w-4 h-4 mr-2" />
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="flex flex-col items-start gap-2 p-4">
                                        <div className="flex flex-row items-center w-full">
                                            <BugIcon className="w-4 h-4 mr-1.5" />
                                            <p className="text-md font-medium">Search stats for nerds</p>
                                            <CopyIconButton
                                                onCopy={() => {
                                                    navigator.clipboard.writeText(JSON.stringify(searchStats, null, 2));
                                                    return true;
                                                }}
                                                className="ml-auto"
                                            />
                                        </div>
                                        <CodeSnippet renderNewlines>
                                            {JSON.stringify(searchStats, null, 2)}
                                        </CodeSnippet>
                                    </TooltipContent>
                                </Tooltip>
                                {
                                    fileMatches.length > 0 ? (
                                        <p className="text-sm font-medium">{`[${searchDurationMs} ms] Found ${numMatches} matches in ${fileMatches.length} ${fileMatches.length > 1 ? 'files' : 'file'}`}</p>
                                    ) : (
                                        <p className="text-sm font-medium">No results</p>
                                    )
                                }
                                {isMoreResultsButtonVisible && (
                                    <div
                                        className="cursor-pointer text-blue-500 text-sm hover:underline ml-4"
                                        onClick={onLoadMoreResults}
                                    >
                                        (load more)
                                    </div>
                                )}
                            </>
                        )}

                        {/* Sort By dropdown */}
                        <div className="ml-auto flex items-center gap-1.5">
                            {isReranking && (
                                <RefreshCwIcon className="h-3 w-3 animate-spin text-muted-foreground" />
                            )}
                            <span className="text-xs text-muted-foreground whitespace-nowrap">Sort by:</span>
                            <Select
                                value={sortBy}
                                onValueChange={(v) => onSortByChange(v as SortBy)}
                            >
                                <SelectTrigger className="h-7 text-xs w-[145px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {(Object.entries(SORT_BY_LABELS) as [SortBy, string][]).map(([value, label]) => (
                                        <SelectItem key={value} value={value} className="text-xs">
                                            {label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0">
                        {rankedFiles.length > 0 ? (
                            <SearchResultsPanel
                                ref={searchResultsPanelRef}
                                fileMatches={rankedFiles}
                                onOpenFilePreview={(fileMatch, matchIndex) => {
                                    setSelectedMatchIndex(matchIndex ?? 0);
                                    setPreviewedFile(fileMatch);
                                }}
                                isLoadMoreButtonVisible={!!isMoreResultsButtonVisible}
                                onLoadMoreButtonClicked={onLoadMoreResults}
                                isBranchFilteringEnabled={isBranchFilteringEnabled}
                                repoInfo={repoInfo}
                            />
                        ) : isStreaming ? (
                            <div className="flex flex-col items-center justify-center h-full gap-2">
                                <RefreshCwIcon className="h-6 w-6 animate-spin" />
                                <p className="font-semibold text-center">Searching...</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full">
                                <p className="text-sm text-muted-foreground">No results found</p>
                            </div>
                        )}
                    </div>
                </div>
            </ResizablePanel>

            {previewedFile && (
                <>
                    <AnimatedResizableHandle />
                    {/* ~~ Code preview ~~ */}
                    <ResizablePanel
                        minSize={10}
                        collapsible={true}
                        id={'code-preview-panel'}
                        order={3}
                        onCollapse={() => setPreviewedFile(undefined)}
                    >
                        <CodePreviewPanel
                            previewedFile={previewedFile}
                            onClose={() => setPreviewedFile(undefined)}
                            selectedMatchIndex={selectedMatchIndex}
                            onSelectedMatchIndexChange={setSelectedMatchIndex}
                        />
                    </ResizablePanel>
                </>
            )}
        </ResizablePanelGroup>
    )
}
