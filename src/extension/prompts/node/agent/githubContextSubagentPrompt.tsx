/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PromptElement, PromptSizing, SystemMessage, UserMessage } from '@vscode/prompt-tsx';
import { GenericBasePromptElementProps } from '../../../context/node/resolvers/genericPanelIntentInvocation';
import { CopilotToolMode } from '../../../tools/common/toolsRegistry';
import { ChatToolCalls } from '../panel/toolCalling';

export interface GithubContextSubagentPromptProps extends GenericBasePromptElementProps {
	readonly maxTurns: number;
}

/**
 * Prompt for the GitHub context subagent that retrieves relevant GitHub artifacts
 * (issues, PRs, commits, docs) using the GitHub MCP server tools.
 */
export class GithubContextSubagentPrompt extends PromptElement<GithubContextSubagentPromptProps> {
	async render(state: void, sizing: PromptSizing) {
		const { conversation, toolCallRounds, toolCallResults } = this.props.promptContext;

		const contextInstruction = conversation?.turns[0]?.request.message;

		const currentTurn = toolCallRounds?.length ?? 0;
		const isLastTurn = currentTurn >= this.props.maxTurns - 1;

		return (
			<>
				<SystemMessage priority={1000}>
					You are an AI assistant that retrieves relevant GitHub artifacts to provide context for a coding task. You have access to MCP tools to search issues, pull requests, and other repository metadata.<br />
					<br />
					YOUR PURPOSE: Find relevant **issues and pull requests** that describe the problem being solved or related changes. The caller needs prior discussions, bug reports, fix proposals, and code change patterns.<br />
					<br />
					SEARCH STRATEGY:<br />
					- **ALWAYS include `repo:owner/name` in every GitHub search query.** Without this, results come from all of GitHub and are useless.<br />
					- **Try MULTIPLE search strategies in parallel:**<br />
					  1. Natural language description of the problem (e.g., "fails to create chain", "login command deprecated")<br />
					  2. Key technical terms from the task (e.g., "chain_management parameter", "no_log sanitize keys")<br />
					  3. Error messages or symptoms mentioned in the task description<br />
					- **Keep perPage: 3** to avoid context overflow.<br />
					- If an Elasticsearch `search_issues` tool is available, prefer it for initial discovery.<br />
					<br />
					WORKFLOW (follow this order strictly):<br />
					1. **Round 1 — Broad Search:** In parallel, search issues AND pull requests with 3+ different query phrasings. Also search for related closed PRs.<br />
					2. **Round 2 — Read and Follow Links:** For the top results, call `issue_read` (method: "get") AND `issue_read` (method: "get_comments") in parallel. Issue comments often contain **specific fix proposals** with code snippets. If an issue mentions a PR number, note it.<br />
					3. **Round 3 — Get PR Details:** For any relevant MERGED PR, call `pull_request_read` (method: "get_diff") to get actual code changes. Also call `pull_request_read` (method: "get_files") to see which files changed.<br />
					4. **Rounds 4+ — Deepen.** If you found a related PR or issue, search for more context. Try searching with function names or file paths mentioned in the comments.<br />
					<br />
					KEY TIPS:<br />
					- Issue **comments** are often more valuable than issue bodies — reviewers and maintainers propose specific fixes there<br />
					- When you find a related PR, its diff shows exact code patterns to follow<br />
					- If a search returns no results, try different phrasings — don't give up after one try<br />
					- Cross-reference: if issue #X mentions PR #Y, go read PR #Y<br />
					<br />
					Once done, return ONLY a &lt;final_answer&gt; tag. Include:<br />
					- Issue/PR numbers, titles, and key details<br />
					- **Specific fix proposals from comments** (quote the commenter)<br />
					- **Code snippets from PR diffs** showing the implementation pattern<br />
					- Which files were modified and how<br />
					<br />
					Example:<br />
					&lt;final_answer&gt;<br />
					## Relevant Issues<br />
					- #123: "Auth token refresh fails" — refresh token expires silently causing 401.<br />
					  - Comment by @maintainer: "We should add an expiry check in refreshToken() before attempting the HTTP call"<br />
					## Related PRs<br />
					- PR #456 (merged): "Add token validation" — Similar pattern for a different auth flow<br />
					## Code Pattern (from PR #456 diff)<br />
					```diff<br />
					+func validateToken(token string) error {'{'}<br />
					+    if isExpired(token) {'{'}<br />
					+        return ErrTokenExpired<br />
					+    {'}'}<br />
					```<br />
					&lt;/final_answer&gt;
				</SystemMessage>
				<UserMessage priority={900}>{contextInstruction}</UserMessage>
				<ChatToolCalls
					priority={899}
					flexGrow={2}
					promptContext={this.props.promptContext}
					toolCallRounds={toolCallRounds}
					toolCallResults={toolCallResults}
					toolCallMode={CopilotToolMode.FullContext}
				/>
				{isLastTurn && (
					<UserMessage priority={900}>
						OK, your allotted iterations are finished — you must now produce a succinct summary of the most relevant GitHub artifacts as the final answer, starting and ending with &lt;final_answer&gt;. Only include artifacts that are clearly relevant. Omit sections with no relevant findings.
					</UserMessage>
				)}
			</>
		);
	}
}
