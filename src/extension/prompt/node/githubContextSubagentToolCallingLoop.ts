/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import type { CancellationToken, ChatRequest, ChatResponseStream, LanguageModelToolInformation, Progress } from 'vscode';
import { IAuthenticationChatUpgradeService } from '../../../platform/authentication/common/authenticationUpgrade';
import { IChatHookService } from '../../../platform/chat/common/chatHookService';
import { ChatLocation, ChatResponse } from '../../../platform/chat/common/commonTypes';
import { ISessionTranscriptService } from '../../../platform/chat/common/sessionTranscriptService';
import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ChatEndpointFamily, IEndpointProvider } from '../../../platform/endpoint/common/endpointProvider';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { IGitService } from '../../../platform/git/common/gitService';
import { ILogService } from '../../../platform/log/common/logService';
import { IOTelService } from '../../../platform/otel/common/otelService';
import { IRequestLogger } from '../../../platform/requestLogger/node/requestLogger';
import { IExperimentationService } from '../../../platform/telemetry/common/nullExperimentationService';
import { ITelemetryService } from '../../../platform/telemetry/common/telemetry';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { ChatResponseProgressPart, ChatResponseReferencePart } from '../../../vscodeTypes';
import { IToolCallingLoopOptions, ToolCallingLoop, ToolCallingLoopFetchOptions } from '../../intents/node/toolCallingLoop';
import { GithubContextSubagentPrompt } from '../../prompts/node/agent/githubContextSubagentPrompt';
import { PromptRenderer } from '../../prompts/node/base/promptRenderer';
import { IToolsService } from '../../tools/common/toolsService';
import { IBuildPromptContext } from '../common/intents';
import { IBuildPromptResult } from './intents';

export interface IGithubContextSubagentToolCallingLoopOptions extends IToolCallingLoopOptions {
	request: ChatRequest;
	location: ChatLocation;
	promptText: string;
	/** Optional pre-generated subagent invocation ID. If not provided, a new UUID will be generated. */
	subAgentInvocationId?: string;
}

/**
 * Read-only GitHub MCP tool names that the GitHub context subagent is allowed to use.
 * These are dynamically registered by the GitHub MCP server definition provider
 * and use the `github/` prefix convention.
 */
const ALLOWED_GITHUB_MCP_TOOLS = new Set([
	// Elasticsearch semantic search (preferred for initial discovery)
	'mcp_elasticsearch-issues_search_issues',
	'mcp_elasticsearch-issues_get_issue',
	'mcp_elasticsearch_search_issues',
	'mcp_elasticsearch_get_issue',
	// GitHub Issues
	'mcp_github_search_issues',
	'mcp_github_issue_read',
	'mcp_github_list_issues',
	// GitHub Pull requests
	'mcp_github_search_pull_requests',
	'mcp_github_pull_request_read',
	'mcp_github_list_pull_requests',
	// GitHub Commits
	'mcp_github_list_commits',
	'mcp_github_get_commit',
	// GitHub Code (de-emphasized in prompt — only for artifacts not in local workspace)
	'mcp_github_search_code',
	'mcp_github_get_file_contents',
	// GitHub Context & documentation
	'mcp_github_list_branches',
	'mcp_github_get_copilot_space',
	'mcp_github_list_copilot_spaces',
]);

export class GithubContextSubagentToolCallingLoop extends ToolCallingLoop<IGithubContextSubagentToolCallingLoopOptions> {

	public static readonly ID = 'githubContextSubagentTool';

	constructor(
		options: IGithubContextSubagentToolCallingLoopOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService logService: ILogService,
		@IRequestLogger requestLogger: IRequestLogger,
		@IEndpointProvider private readonly endpointProvider: IEndpointProvider,
		@IToolsService private readonly toolsService: IToolsService,
		@IAuthenticationChatUpgradeService authenticationChatUpgradeService: IAuthenticationChatUpgradeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IExperimentationService experimentationService: IExperimentationService,
		@IChatHookService chatHookService: IChatHookService,
		@ISessionTranscriptService sessionTranscriptService: ISessionTranscriptService,
		@IFileSystemService fileSystemService: IFileSystemService,
		@IOTelService otelService: IOTelService,
		@IGitService gitService: IGitService,
	) {
		super(options, instantiationService, endpointProvider, logService, requestLogger, authenticationChatUpgradeService, telemetryService, configurationService, experimentationService, chatHookService, sessionTranscriptService, fileSystemService, otelService, gitService);
	}

	protected override createPromptContext(availableTools: LanguageModelToolInformation[], outputStream: ChatResponseStream | undefined): IBuildPromptContext {
		const context = super.createPromptContext(availableTools, outputStream);
		if (context.tools) {
			context.tools = {
				...context.tools,
				toolReferences: [],
				subAgentInvocationId: this.options.subAgentInvocationId ?? randomUUID(),
				subAgentName: 'githubContext'
			};
		}
		context.query = this.options.promptText;
		return context;
	}

	private async getEndpoint() {
		const modelName = this._configurationService.getConfig(ConfigKey.Advanced.GithubContextSubagentModel) as ChatEndpointFamily;
		if (modelName) {
			try {
				let endpoint = await this.endpointProvider.getChatEndpoint(modelName);
				if (!endpoint.supportsToolCalls) {
					this._logService.warn(`[GithubContextSubagentToolCallingLoop] Configured model ${modelName} does not support tool calls. Falling back to request's endpoint.`);
					endpoint = await this.endpointProvider.getChatEndpoint(this.options.request);
				}
				return endpoint;
			} catch (error) {
				this._logService.warn(`[GithubContextSubagentToolCallingLoop] Failed to get endpoint for model ${modelName}: ${error}. Falling back to request's endpoint.`);
				return await this.endpointProvider.getChatEndpoint(this.options.request);
			}
		} else {
			return await this.endpointProvider.getChatEndpoint(this.options.request);
		}
	}

	protected async buildPrompt(buildPromptContext: IBuildPromptContext, progress: Progress<ChatResponseReferencePart | ChatResponseProgressPart>, token: CancellationToken): Promise<IBuildPromptResult> {
		const endpoint = await this.getEndpoint();
		const maxTurns = this._configurationService.getExperimentBasedConfig(ConfigKey.Advanced.GithubContextSubagentToolCallLimit, this._experimentationService);
		const renderer = PromptRenderer.create(
			this.instantiationService,
			endpoint,
			GithubContextSubagentPrompt,
			{
				promptContext: buildPromptContext,
				maxTurns
			}
		);
		return await renderer.render(progress, token);
	}

	protected async getAvailableTools(): Promise<LanguageModelToolInformation[]> {
		const endpoint = await this.getEndpoint();
		const allTools = this.toolsService.getEnabledTools(this.options.request, endpoint);

		// Filter to only GitHub MCP tools that are in our allowed set
		return allTools.filter(tool => ALLOWED_GITHUB_MCP_TOOLS.has(tool.name));
	}

	protected async fetch({ messages, finishedCb, requestOptions, enableThinking, reasoningEffort }: ToolCallingLoopFetchOptions, token: CancellationToken): Promise<ChatResponse> {
		const endpoint = await this.getEndpoint();
		return endpoint.makeChatRequest2({
			debugName: GithubContextSubagentToolCallingLoop.ID,
			messages,
			finishedCb,
			location: this.options.location,
			enableThinking,
			reasoningEffort,
			requestOptions: {
				...(requestOptions ?? {}),
				temperature: 0
			},
			userInitiatedRequest: false,
			telemetryProperties: {
				messageId: randomUUID(),
				messageSource: 'chat.editAgent',
				subType: 'subagent/githubContext',
				conversationId: this.options.conversation.sessionId
			},
			requestKindOptions: { kind: 'subagent' }
		}, token);
	}
}
