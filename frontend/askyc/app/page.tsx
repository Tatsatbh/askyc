'use client';

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Fragment, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { CopyIcon, GlobeIcon, RefreshCcwIcon } from 'lucide-react';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { Loader } from '@/components/ai-elements/loader';
import { TextStreamChatTransport } from 'ai';
import { AppSidebar } from "@/components/app-sidebar"
import { NavActions } from "@/components/nav-actions"
import localFont from 'next/font/local';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"

const models = [
  {
    name: 'GPT 4o',
    value: 'openai/gpt-4o',
  },
  {
    name: 'Deepseek R1',
    value: 'deepseek/deepseek-r1',
  },
];

const mf = localFont({
  src: './fonts/minecraft.otf'
})

type RenderableMessagePart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

type ExtractedDataPart = {
  type: string;
  data: unknown;
  [key: string]: unknown;
};

type SanitizedPartsResult = {
  sanitizedParts: RenderableMessagePart[];
  dataParts: Record<string, ExtractedDataPart>;
};

const dataChunkPattern = /(\d+):\s*(\{[\s\S]*\})\s*$/;

const isExtractedDataPart = (value: unknown): value is ExtractedDataPart => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith('data-') &&
    'data' in value
  );
};

const extractEmbeddedDataChunk = (text: string) => {
  const match = text.match(dataChunkPattern);

  if (!match || match.index === undefined) {
    return { cleanedText: text, dataPart: null as ExtractedDataPart | null };
  }

  const jsonCandidate = match[2];

  try {
    const parsedChunk = JSON.parse(jsonCandidate);

    if (isExtractedDataPart(parsedChunk)) {
      return {
        cleanedText: text.slice(0, match.index).trimEnd(),
        dataPart: parsedChunk,
      };
    }
  } catch {
  }

  return { cleanedText: text, dataPart: null as ExtractedDataPart | null };
};

const sanitizeAssistantMessageParts = (
  parts: RenderableMessagePart[],
): SanitizedPartsResult => {
  const dataParts: Record<string, ExtractedDataPart> = {};

  const sanitizedParts = parts.map((part) => {
    if (part.type === 'text' && typeof part.text === 'string') {
      const { cleanedText, dataPart } = extractEmbeddedDataChunk(part.text);

      if (dataPart) {
        dataParts[dataPart.type] = dataPart;
      }

      if (cleanedText !== part.text) {
        return {
          ...part,
          text: cleanedText,
        };
      }
    }

    return part;
  });

  return { sanitizedParts, dataParts };
};

const ChatBot = () => {
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(models[0].value);
  const [webSearch, setWebSearch] = useState(false);
  const { messages, sendMessage, status, regenerate } = useChat({
    transport: new TextStreamChatTransport({
      api: '/api/stream',
    }),
  });

  const isChatBusy = status === 'submitted' || status === 'streaming';

  const handleSubmit = (message: PromptInputMessage) => {
    if (isChatBusy) {
      return;
    }

    const hasText = Boolean(message.text);
    const hasAttachments = Boolean(message.files?.length);

    if (!(hasText || hasAttachments)) {
      return;
    }

    sendMessage(
      {
        text: message.text || 'Sent with attachments',
        files: message.files
      },
      {
        body: {
          model: model,
          webSearch: webSearch,
        },
      },
    );
    setInput('');
  };

  return (
    <SidebarProvider>
    <AppSidebar/>
    <div className="max-w-4xl mx-auto p-6 relative size-full h-screen">
      <div className="flex flex-col h-full min-h-0">
        <Conversation className="h-full">
          <ConversationContent>
            {messages.map((message) => {
              const messageParts = message.parts as RenderableMessagePart[];
              const { sanitizedParts, dataParts } =
                message.role === 'assistant'
                  ? sanitizeAssistantMessageParts(messageParts)
                  : {
                      sanitizedParts: messageParts,
                      dataParts: {} as Record<string, ExtractedDataPart>,
                    };

              const sourcesPart = dataParts['data-sources'] as
                | (ExtractedDataPart & {
                    data?: {
                      videos?: string[];
                      urls?: string[];
                    };
                  })
                | undefined;
              const videos = sourcesPart?.data?.videos ?? [];
              const urls = sourcesPart?.data?.urls ?? [];

              return (
                <div key={message.id}>
                  {videos.length > 0 && (
                    <Sources>
                      <SourcesTrigger count={videos.length} />
                      {videos.map((video: string, i: number) => (
                        <SourcesContent key={`${message.id}-source-${i}`}>
                          <Source
                            href={urls[i] || '#'}
                            title={video.replace('.txt', '')}
                          />
                        </SourcesContent>
                      ))}
                    </Sources>
                  )}
                  {sanitizedParts.map((part, i) => {
                    switch (part.type) {
                      case 'text':
                        return (
                          <Message key={`${message.id}-${i}`} from={message.role}>
                            <MessageContent>
                              <MessageResponse>
                                {part.text}
                              </MessageResponse>
                            </MessageContent>
                            {message.role === 'assistant' && (
                              <MessageActions>
                                <MessageAction onClick={() => regenerate()} label="Retry">
                                  <RefreshCcwIcon className="size-3" />
                                </MessageAction>
                                <MessageAction
                                  onClick={() => navigator.clipboard.writeText(part.text ?? "")}
                                  label="Copy"
                                >
                                  <CopyIcon className="size-3" />
                                </MessageAction>
                              </MessageActions>
                            )}
                          </Message>
                        );
                      case 'reasoning': {
                        const reasoningText =
                          typeof part.text === 'string' ? part.text : '';
                        return (
                          <Reasoning
                            key={`${message.id}-${i}`}
                            className="w-full"
                            isStreaming={status === 'streaming' && i === message.parts.length - 1 && message.id === messages.at(-1)?.id}
                          >
                            <ReasoningTrigger />
                            <ReasoningContent>{reasoningText}</ReasoningContent>
                          </Reasoning>
                        );
                      }
                      default:
                        return null;
                    }
                  })}
                </div>
              );
            })}
            {status === 'submitted' && <Loader />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        <div className="mt-2 bg-background pt-2">
          <PromptInput
            onSubmit={handleSubmit}
            className="border border-border rounded-2xl shadow-sm"
            globalDrop
            multiple
          >
          <PromptInputHeader>
            <PromptInputAttachments>
              {(attachment) => <PromptInputAttachment data={attachment} />}
            </PromptInputAttachments>
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              onChange={(e) => setInput(e.target.value)}
              value={input}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputActionMenu>
                <PromptInputActionMenuTrigger />
                <PromptInputActionMenuContent>
                  <PromptInputActionAddAttachments />
                </PromptInputActionMenuContent>
              </PromptInputActionMenu>
              <PromptInputButton
                variant={webSearch ? 'default' : 'ghost'}
                onClick={() => setWebSearch(!webSearch)}
              >
                <GlobeIcon size={16} />
                <span>Search</span>
              </PromptInputButton>
              <PromptInputSelect
                onValueChange={(value) => {
                  setModel(value);
                }}
                value={model}
              >
                <PromptInputSelectTrigger>
                  <PromptInputSelectValue />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {models.map((model) => (
                    <PromptInputSelectItem key={model.value} value={model.value}>
                      {model.name}
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
            </PromptInputTools>
            <PromptInputSubmit
              disabled={isChatBusy || input.trim().length === 0}
              status={status}
            />
          </PromptInputFooter>
        </PromptInput>
        </div>
      </div>
    </div>
    </SidebarProvider>
  );
};

export default ChatBot;
