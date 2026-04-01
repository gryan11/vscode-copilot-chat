/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import { ChatFetchResponseType } from '../../../platform/chat/common/commonTypes';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { CapturingToken } from '../../../platform/requestLogger/common/capturingToken';
import { getCurrentCapturingToken, IRequestLogger } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ChatResponseStreamImpl } from '../../../util/common/chatResponseStreamImpl';
import { generateUuid } from '../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatResponseNotebookEditPart, ChatResponseTextEditPart, ChatToolInvocationPart, ExtendedLanguageModelToolResult, LanguageModelTextPart, MarkdownString } from '../../../vscodeTypes';
import { Conversation, Turn } from '../../prompt/common/conversation';
import { IBuildPromptContext } from '../../prompt/common/intents';
import { GithubContextSubagentToolCallingLoop } from '../../prompt/node/githubContextSubagentToolCallingLoop';
import { ToolName } from '../common/toolNames';
import { CopilotToolMode, ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

export interface IGithubContextSubagentParams {
	/** Natural language query describing what GitHub context to retrieve */
	query: string;
	/** User-visible description shown while invoking */
	description: string;
	/** Optional repository owner to scope queries */
	repoOwner?: string;
	/** Optional repository name to scope queries */
	repoName?: string;
}

class GithubContextSubagentTool implements ICopilotTool<IGithubContextSubagentParams> {
	public static readonly toolName = ToolName.GithubContextSubagent;
	public static readonly nonDeferred = true;
	private _inputContext: IBuildPromptContext | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IRequestLogger private readonly requestLogger: IRequestLogger,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExperimentationService private readonly experimentationService: IExperimentationService
	) { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<IGithubContextSubagentParams>, token: vscode.CancellationToken) {
		const contextInstruction = [
			`Retrieve relevant GitHub artifacts for: ${options.input.query}`,
			'',
			...(options.input.repoOwner && options.input.repoName
				? [`Target repository: ${options.input.repoOwner}/${options.input.repoName}`, '']
				: []),
		].join('\n');

		if (!this._inputContext) {
			throw new Error('GithubContextSubagentTool: _inputContext is not set. Ensure resolveInput is called before invoke.');
		}

		const request = this._inputContext.request!;
		const parentSessionId = this._inputContext.conversation?.sessionId ?? generateUuid();
		const subAgentInvocationId = generateUuid();

		const toolCallLimit = this.configurationService.getExperimentBasedConfig(ConfigKey.Advanced.GithubContextSubagentToolCallLimit, this.experimentationService);

		const loop = this.instantiationService.createInstance(GithubContextSubagentToolCallingLoop, {
			toolCallLimit,
			conversation: new Conversation(parentSessionId, [new Turn(generateUuid(), { type: 'user', message: contextInstruction })]),
			request: request,
			location: request.location,
			promptText: options.input.query,
			subAgentInvocationId: subAgentInvocationId,
		});

		const stream = this._inputContext?.stream && ChatResponseStreamImpl.filter(
			this._inputContext.stream,
			part => part instanceof ChatToolInvocationPart || part instanceof ChatResponseTextEditPart || part instanceof ChatResponseNotebookEditPart
		);

		const parentChatSessionId = getCurrentCapturingToken()?.chatSessionId;
		const githubContextSubagentToken = new CapturingToken(
			`GitHub Context: ${options.input.query.substring(0, 50)}${options.input.query.length > 50 ? '...' : ''}`,
			'githubContext',
			subAgentInvocationId,
			'githubContext',
			subAgentInvocationId,
			parentChatSessionId,
			'githubContextSubagent',
		);

		const loopResult = await this.requestLogger.captureInvocation(githubContextSubagentToken, () => loop.run(stream, token));

		const toolMetadata = {
			query: options.input.query,
			description: options.input.description,
			repoOwner: options.input.repoOwner,
			repoName: options.input.repoName,
			subAgentInvocationId: subAgentInvocationId,
			agentName: 'githubContext'
		};

		let subagentResponse = '';
		if (loopResult.response.type === ChatFetchResponseType.Success) {
			subagentResponse = loopResult.toolCallRounds.at(-1)?.response ?? loopResult.round.response ?? '';
		} else {
			subagentResponse = `The GitHub context subagent request failed with this message:\n${loopResult.response.type}: ${loopResult.response.reason}`;
		}

		const result = new ExtendedLanguageModelToolResult([new LanguageModelTextPart(subagentResponse)]);
		result.toolMetadata = toolMetadata;
		result.toolResultMessage = new MarkdownString(l10n.t`GitHub context retrieved: ${options.input.description}`);
		return result;
	}

	prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<IGithubContextSubagentParams>, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedToolInvocation> {
		return {
			invocationMessage: options.input.description,
		};
	}

	async resolveInput(input: IGithubContextSubagentParams, promptContext: IBuildPromptContext, _mode: CopilotToolMode): Promise<IGithubContextSubagentParams> {
		this._inputContext = promptContext;
		return input;
	}
}

ToolRegistry.registerTool(GithubContextSubagentTool);
