export interface SessionInfo {
  sessionId: string;
  isDemo: boolean;
  expiresAt: string;
}

export interface PersonaPublic {
  id: string;
  name: string;
  mbti: string;
  tagline: string;
  materialHint: string;
  openingLine: string;
  featured?: boolean;
}

export interface AccessoryOption {
  id: string;
  label: string;
  material: string;
}

export interface FallbackTemplate {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  recommendedMbti: string[];
}

export interface DollSummary {
  id: string;
  kind: 'demo' | 'personal';
  name: string;
  avatarUrl: string;
  cardId: string | null;
  cardVersionId: string | null;
  dollUrl: string;
  createdAt: string;
  persona: PersonaPublic;
}

export interface DollDetail extends DollSummary {
  qrData: string;
  qrSvg: string;
  isOwner: boolean;
  cardUrl: string | null;
}

export interface ChatMessage {
  id: string;
  clientMessageId: string;
  replyAttempt: number;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'streaming' | 'completed' | 'failed' | 'incomplete';
  provider: string | null;
  firstTokenMs: number | null;
  totalMs: number | null;
  errorCode: string | null;
  createdAt: string;
}

export interface MemoryItem {
  id: string;
  type: 'user_nickname' | 'doll_name' | 'persona' | 'accessories' | 'fact' | string;
  value: string;
  source: string;
  createdAt: string;
}

export interface CardVersion {
  id: string;
  cardId: string;
  versionNumber: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  provider: string;
  providerRequestId: string | null;
  resultKind: 'generated' | 'template' | 'mock';
  resultUrl: string | null;
  suggestedName: string | null;
  keywords: string[];
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface CardSummary {
  id: string;
  userNickname: string;
  personaId: string;
  personaName: string;
  personaMbti: string;
  accessoryIds: string[];
  activeVersionId: string | null;
  boundDollId: string | null;
  generationAttempts: number;
  maxAttempts: number;
  remainingAttempts: number;
  cardUrl: string;
  dollUrl: string | null;
  createdAt: string;
  versions: CardVersion[];
}

export interface CardDetail {
  id: string;
  userNickname: string;
  personaId: string;
  persona: PersonaPublic;
  accessoryIds: string[];
  accessoryLabels: string[];
  activeVersionId: string | null;
  boundDollId: string | null;
  boundDoll: {
    id: string;
    name: string;
    avatarUrl: string;
    cardVersionId: string;
    dollUrl: string;
    qrSvg: string | null;
    createdAt: string;
  } | null;
  generationAttempts: number;
  maxAttempts: number;
  remainingAttempts: number;
  photoAvailable: boolean;
  photoUrl: string | null;
  photoExpiresAt: string;
  cardUrl: string;
  dollUrl: string | null;
  createdAt: string;
  versions: CardVersion[];
}

export interface OutputJob {
  jobId: string;
  cardId: string;
  cardVersionId: string;
  paperSize: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  mode: string;
  physicalExecuted: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DemoStatusPayload {
  providers: {
    chat: {
      mode: 'mock' | 'cloud';
      model: string;
      configured: boolean;
      viaOpenAICompatible: boolean;
      firstTokenTimeoutMs: number;
      firstTokenTargetMs: number;
      contextMaxMessages: number;
    };
    image: {
      mode: 'mock' | 'cloud';
      model: string;
      configured: boolean;
      viaOpenAICompatible: boolean;
      timeoutMs: number;
      performanceTargetMs: number;
      maxRegenerations: number;
    };
    output: {
      mode: string;
      physicalExecutedSupported: boolean;
    };
  };
  counts: {
    demoDolls: number;
    personalDolls: number;
    cards: number;
    personas: number;
  };
  metrics: {
    chat: Array<{
      provider: string;
      status: string;
      cnt: number;
      avg_ttft_ms: number | null;
      avg_total_ms: number | null;
    }>;
    image: Array<{
      provider: string;
      result_kind: string;
      status: string;
      cnt: number;
      avg_ms: number | null;
    }>;
    output: Array<{
      mode: string;
      status: string;
      cnt: number;
      physical_count: number | null;
    }>;
  };
  activeSessions: Array<{
    id: string;
    is_demo: number;
    created_at: string;
    expires_at: string;
    card_count: number;
    personal_doll_count: number;
    message_count: number;
    running_versions: number;
    running_jobs: number;
  }>;
  recentErrors: Array<{
    id: string;
    kind: string;
    provider: string;
    result_kind: string | null;
    error_code: string | null;
    detail: string | null;
    request_id: string | null;
    created_at: string;
  }>;
  recentRuns: Array<{
    id: string;
    kind: string;
    provider: string;
    result_kind: string | null;
    status: string;
    first_token_ms: number | null;
    total_ms: number | null;
    error_code: string | null;
    detail: string | null;
    created_at: string;
  }>;
}
