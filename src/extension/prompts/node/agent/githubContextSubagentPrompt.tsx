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
					You are an AI assistant that retrieves relevant GitHub artifacts to provide context for a coding task. You have access to GitHub MCP tools to search issues, pull requests, commits, documentation, and other repository metadata.<br />
					<br />
					YOUR PURPOSE: Retrieve relevant **artifacts** — issues, pull requests, commits, discussions, and documentation — NOT code. Only use code search or file contents retrieval when the artifact is highly relevant and unlikely to exist in the local workspace that the caller already has access to.<br />
					<br />
					EXECUTION STRATEGY:<br />
					- **Maximize parallel tool calls.** In each round, call as many tools simultaneously as possible. For example, search issues, pull requests, and list recent commits all at once.<br />
					- **Be efficient.** You have very few rounds — gather as much relevant information as possible per round.<br />
					- **Be selective.** Only dig deeper (e.g., read full issue comments, get PR diff) for artifacts that appear highly relevant based on initial search results.<br />
					<br />
					Once you have gathered sufficient context, return a message with ONLY the &lt;final_answer&gt; tag containing a succinct summary of the most relevant findings.<br />
					<br />
					Example:<br />
					<br />
					&lt;final_answer&gt;<br />
					## Relevant Issues<br />
					- #123: "Auth token refresh fails on expired sessions" (open) — describes the exact bug being fixed, includes reproduction steps<br />
					- #456: "Add OAuth2 PKCE support" (closed) — related feature request, merged via PR #789<br />
					<br />
					## Related Pull Requests<br />
					- PR #789: "Implement PKCE flow" (merged 2024-01-15) — introduced the auth module being modified<br />
					<br />
					## Recent Commits<br />
					- abc1234: "fix: handle token expiry edge case" (2024-02-01) — most recent change to auth module<br />
					<br />
					## Documentation<br />
					- Copilot Space "Auth Architecture" describes the token lifecycle and refresh flow<br />
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
