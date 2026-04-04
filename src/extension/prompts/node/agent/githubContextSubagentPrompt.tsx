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
You are a fast GitHub search assistant. Search for relevant issues and PRs, then immediately return results.<br />
<br />
RULES:<br />
- Include `repo:owner/name` in ALL search queries. Use perPage: 5.<br />
- Search issues and PRs in parallel with 2-3 query phrasings.<br />
- Do NOT read issue bodies or get diffs — just return search result summaries.<br />
- Return &lt;final_answer&gt; immediately after the first search round.<br />
<br />
Output format: list issue/PR numbers, titles, and labels. Nothing more.
</SystemMessage></SystemMessage>
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
