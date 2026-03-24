import { env } from "@sourcebot/shared";
import { SearchLandingPage } from "./components/searchLandingPage";
import { SearchResultsPage } from "./components/searchResultsPage";
import { auth } from "@/auth";
import { getConfiguredLanguageModelsInfo } from "@/features/chat/utils.server";
import { SORT_BY_VALUES, SortBy } from "@/features/search/types";

interface SearchPageProps {
    params: Promise<{ domain: string }>;
    searchParams: Promise<{
        query?: string;
        isRegexEnabled?: "true" | "false";
        isCaseSensitivityEnabled?: "true" | "false";
        sortBy?: string;
    }>;
}

export default async function SearchPage(props: SearchPageProps) {
    const { domain } = await props.params;
    const searchParams = await props.searchParams;
    const query = searchParams?.query;
    const isRegexEnabled = searchParams?.isRegexEnabled === "true";
    const isCaseSensitivityEnabled = searchParams?.isCaseSensitivityEnabled === "true";
    const sortByParam = searchParams?.sortBy;
    const sortBy: SortBy = (SORT_BY_VALUES as readonly string[]).includes(sortByParam ?? '') ? sortByParam as SortBy : 'default';

    const session = await auth();
    const languageModels = await getConfiguredLanguageModelsInfo();
    const isSearchAssistSupported = languageModels.length > 0;

    if (query === undefined || query.length === 0) {
        return <SearchLandingPage domain={domain} isSearchAssistSupported={isSearchAssistSupported} />
    }

    return (
        <SearchResultsPage
            searchQuery={query}
            defaultMaxMatchCount={env.DEFAULT_MAX_MATCH_COUNT}
            isRegexEnabled={isRegexEnabled}
            isCaseSensitivityEnabled={isCaseSensitivityEnabled}
            sortBy={sortBy}
            session={session}
            isSearchAssistSupported={isSearchAssistSupported}
        />
    )
}
