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
YOUR PURPOSE: Find relevant **issues and pull requests** that describe the problem being solved or related changes. The caller needs bug reports, fix proposals from comments, and code change patterns from related PRs.<br />
<br />
SEARCH STRATEGY:<br />
- **ALWAYS include `repo:owner/name`** in every search query.<br />
- **Search with MULTIPLE strategies in parallel:**<br />
  (a) The error message or exception text (if any in the task)<br />
  (b) Natural language description of the bug/feature<br />
  (c) The specific component or module name being changed<br />
- **Keep perPage: 3.** Use Elasticsearch `search_issues` if available, otherwise GitHub `search_issues`.<br />
<br />
WORKFLOW:<br />
1. **Round 1 — Search broadly:** 3+ parallel searches (issues AND PRs) with different phrasings.<br />
2. **Round 2 — Read top results AND their comments.** Call `issue_read(get)` AND `issue_read(get_comments)` in parallel for the top 2-3 hits. Comments often contain **specific fix proposals with code snippets** from maintainers — these are the most valuable context.<br />
3. **Round 3 — Get MERGED PR details.** For the most relevant **merged** PR, call `pull_request_read(get_diff)`. Skip closed/unmerged PRs — they may have incorrect approaches.<br />
4. **If nothing found after 2 rounds, STOP.** Return what you have. Do not spin searching — the main agent can proceed without context.<br />
<br />
IMPORTANT: Never conclude that a task is "impossible" or "should be done in a different repo." The task IS solvable in the current repository. Your job is to find helpful context, not to evaluate feasibility.<br />
<br />
Return a &lt;final_answer&gt; with:<br />
- Issue/PR numbers and key details (especially from comments)<br />
- Code patterns from merged PR diffs (verbatim if possible)<br />
- Files mentioned as needing modification<br />
- If nothing relevant found, say so briefly and let the main agent proceed.
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
