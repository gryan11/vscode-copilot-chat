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
					YOUR PURPOSE: Find relevant **issues and pull requests** that describe the problem being solved or related changes. The caller needs prior discussions, bug reports, and fix guidance.<br />
					<br />
					SEARCH STRATEGY:<br />
					- **ALWAYS include `repo:owner/name` in every GitHub search query.** Without this, results come from all of GitHub and are useless.<br />
					- **Use short natural language phrases**, NOT code identifiers. Issues use words like "fails", "crash", "add support for", not function names. Try 2-3 different phrasings per concept.<br />
					- **Keep perPage small (3).** Search results include full issue bodies. Use perPage: 3 to avoid context overflow.<br />
					- If an Elasticsearch `search_issues` tool is available, prefer it for initial discovery — it does semantic search and is automatically scoped to the repo. Otherwise use GitHub `search_issues`.<br />
					<br />
					WORKFLOW (follow this order strictly):<br />
					1. **Round 1 — Search:** Search issues AND pull requests with 2-3 different query phrasings. Use perPage: 3. Run searches in parallel.<br />
					2. **Round 2 — MANDATORY: Read top results.** For the top 2-3 results, call GitHub `issue_read` (method: "get") in parallel. You MUST do this — search titles alone are insufficient. The issue BODY contains reproduction steps, error messages, and fix suggestions.<br />
					3. **Round 3 — Get PR diffs and comments.** For the most relevant PR, call `pull_request_read` (method: "get_diff") to get ACTUAL code changes. Also call `issue_read` (method: "get_comments") for discussion.<br />
					4. **Rounds 4+ — Follow up.** Try different query phrasings if initial searches missed. Search for error messages, function names from issues, or related feature names.<br />
					<br />
					Once done, return ONLY a &lt;final_answer&gt; tag with a succinct summary including:<br />
					- Issue/PR numbers, titles, and key details (error messages, reproduction steps, proposed fixes)<br />
					- **Include the actual diff verbatim** from `pull_request_read(get_diff)`. Copy the most relevant parts of the diff (new functions, parameter additions, logic changes) as-is. The caller needs the exact code, not a summary.<br />
					<br />
					Example:<br />
					&lt;final_answer&gt;<br />
					## Relevant Issues<br />
					- #123: "Auth token refresh fails" — refresh token expires silently causing 401. Suggests checking expiry before refresh.<br />
					## Related PRs<br />
					- PR #789: "Fix token refresh" (merged)<br />
					## PR #789 Diff (key changes)<br />
					```diff<br />
					+def isTokenExpired(token):<br />
					+    return token.expiry &lt; datetime.now()<br />
					<br />
					-def refreshToken(token):<br />
					+def refreshToken(token, expiryBufferMs=30000):<br />
					+    if isTokenExpired(token):<br />
					+        raise TokenExpiredError()<br />
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
