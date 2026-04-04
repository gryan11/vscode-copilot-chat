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
					You are an AI assistant that retrieves relevant GitHub context for a coding task. Your goal is to find issues, PRs, and discussions that describe the problem, proposed solutions, and implementation patterns.<br />
					<br />
					SEARCH RULES:<br />
					- **ALWAYS include `repo:owner/name`** in every search query.<br />
					- Use **natural language phrases** (not code identifiers). Try 3+ different phrasings.<br />
					- **perPage: 3** to avoid context overflow.<br />
					- If Elasticsearch `search_issues` is available, prefer it for discovery.<br />
					<br />
					WORKFLOW:<br />
					1. **Search broadly:** Issues AND PRs with multiple phrasings. Also try the error message from the task.<br />
					2. **Read promising results:** `issue_read(get)` for full bodies. `issue_read(get_comments)` for fix proposals — **comments are the most valuable**, they often contain specific code suggestions from maintainers.<br />
					3. **Get PR context:** For any related MERGED PR, call `pull_request_read(get_files)` to see files changed, and `pull_request_read(get_diff)` for the actual changes.<br />
					4. **Follow cross-references:** If issue #X mentions PR #Y, go read it.<br />
					<br />
					OUTPUT FORMAT — return a &lt;final_answer&gt; with:<br />
					<br />
					**1. Problem Summary:** What is the bug/feature? What is the root cause?<br />
					**2. Fix Specification:** Based on issues and comments, what EXACTLY needs to change? Which files, which functions, what new parameters?<br />
					**3. Implementation Hints:** Relevant code patterns from related PRs. Quote specific code if available.<br />
					**4. Files to Modify:** List specific file paths mentioned in issues/PRs.<br />
					**5. Testing Notes:** What should be tested? Any edge cases mentioned in discussions?<br />
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
