export type MaterialCategory =
  | 'nut_body'
  | 'yarn_hair'
  | 'fabric_outfit'
  | 'hardware_charm'
  | 'dried_botanical';

export type ImageModelTier = 'fast' | 'hd';
export type ProviderMode = 'mock' | 'cloud';

export interface SessionInfo {
  sessionId: string;
  isDemo: boolean;
  expiresAt: string;
}

export interface PersonaPublic {
  id: string;
  name: string;
  mbti: string;
  mbtiGroup?: 'NF' | 'NT' | 'SJ' | 'SP' | string;
  cognitiveAxis?: string;
  tagline: string;
  materialHint: string;
  speechStyle?: string;
  visualTrait?: string;
  recommendedMaterials?: string[];
  openingLine: string;
  featured?: boolean;
}

export interface AccessoryOption {
  id: string;
  label: string;
  category?: MaterialCategory;
  categoryLabel?: string;
  material: string;
  visualHint?: string;
  inStock?: boolean;
}

export interface MaterialRecord {
  id: string;
  label: string;
  category: MaterialCategory;
  material: string;
  visualHint: string;
  inStock: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface MbtiQuizAnswers {
  energy?: 'E' | 'I';
  perception?: 'S' | 'N';
  judgment?: 'T' | 'F';
  lifestyle?: 'J' | 'P';
}

export interface MbtiRecommendation {
  primaryMbti: string;
  primaryPersonaId: string;
  alternateMbtis: string[];
  keywords: string[];
  reason: string;
  suggestedMaterialIds: string[];
  source: 'cloud_vision' | 'cloud_quiz' | 'quiz_rule';
}

export type CognitiveFunction = 'Ni' | 'Ne' | 'Si' | 'Se' | 'Ti' | 'Te' | 'Fi' | 'Fe';

export type CognitiveFunctionScores = Record<CognitiveFunction, number>;

export interface MbtiAxisPercentages {
  E: number;
  N: number;
  F: number;
  P: number;
}

export interface MbtiGuideOption {
  id: string;
  label: string;
  weights: Partial<CognitiveFunctionScores>;
}

export interface MbtiGuideQuestion {
  id: string;
  round: number;
  phaseLabel: string;
  targetAxes: string;
  reaction?: string;
  prompt: string;
  options: MbtiGuideOption[];
}

export interface MbtiGuideHistoryItem {
  questionId: string;
  questionPrompt: string;
  userAnswer: string;
  selectedOptionId?: string;
  optionWeights?: Partial<CognitiveFunctionScores>;
}

export interface MbtiGuideReport {
  primaryMbti: string;
  primaryPersonaId: string;
  personaName: string;
  confidence: number;
  dominantStack: [CognitiveFunction, CognitiveFunction, CognitiveFunction, CognitiveFunction];
  stackSummary: string;
  functionScores: CognitiveFunctionScores;
  axisPercentages: MbtiAxisPercentages;
  alternateMbtis: Array<{ mbti: string; probability: number; personaName: string }>;
  keywords: string[];
  evidenceSummary: string;
  disambiguationNote: string;
  suggestedMaterialIds: string[];
}

export interface MbtiGuideTurnResponse {
  status: 'questioning' | 'completed';
  engine: 'stepfun_adaptive' | 'cat_local';
  round: number;
  maxRounds: number;
  confidence: number;
  topCandidates: Array<{ mbti: string; probability: number }>;
  rawScores: CognitiveFunctionScores;
  normalizedScores: CognitiveFunctionScores;
  axisPercentages: MbtiAxisPercentages;
  nextQuestion?: MbtiGuideQuestion;
  report?: MbtiGuideReport;
}

export interface FallbackTemplate {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  recommendedMbti: string[];
}

export type NfcWriteScope = 'production' | 'test' | 'unavailable';
export type ImageVendor = 'openai' | 'gemini';

export interface DollSummary {
  id: string;
  kind: 'demo' | 'personal';
  name: string;
  avatarUrl: string;
  cardId: string | null;
  cardVersionId: string | null;
  dollUrl: string;
  nfcUrl?: string;
  nfcAlias?: string | null;
  nfcWriteScope?: NfcWriteScope;
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

export interface RuntimeSettings {
  nfcPublicBaseUrl: string;
  nfcWriteScope: NfcWriteScope;
  nfcBaseUrlEditable: boolean;
  imageGenerationEnabled: boolean;
  imageVendor: ImageVendor;
  effectiveBaseUrl: string;
  imageModelTier: ImageModelTier;
  imageModelTierLabel: string;
  imageModel: string;
  chatProviderMode: ProviderMode;
  imageProviderMode: ProviderMode;
  strictMaterialConstraint: boolean;
  availableImageModels?: Record<ImageModelTier, string>;
}

export interface NfcTagItem {
  alias: string;
  dollId: string;
  label: string;
  dollName: string;
  dollKind: string;
  personaMbti: string;
  personaName: string;
  nfcUrl: string;
  directUrl: string;
  lastWrittenAt: string | null;
  createdAt: string;
}

export interface DemoStatusPayload {
  settings: RuntimeSettings;
  providers: {
    chat: {
      mode: ProviderMode;
      model: string;
      configured: boolean;
      cloudKeyAvailable?: boolean;
      viaOpenAICompatible: boolean;
      firstTokenTimeoutMs: number;
      firstTokenTargetMs: number;
      contextMaxMessages: number;
    };
    image: {
      mode: ProviderMode;
      model: string;
      tier?: ImageModelTier;
      tierLabel?: string;
      configured: boolean;
      cloudKeyAvailable?: boolean;
      viaOpenAICompatible: boolean;
      timeoutMs: number;
      performanceTargetMs: number;
      maxRegenerations: number;
      strictMaterialConstraint?: boolean;
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
    materialsTotal?: number;
    materialsInStock?: number;
  };
  nfcTags: NfcTagItem[];
  dollsForNfc: Array<{
    id: string;
    name: string;
    kind: string;
    personaMbti: string;
    personaName: string;
    directUrl: string;
  }>;
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
