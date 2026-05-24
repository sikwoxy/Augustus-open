export type MemoryRawEventType =
  | "turn"
  | "agent_run"
  | "task"
  | "tool"
  | "file"
  | "system";

export type MemoryEventSource =
  | "task_orchestrator"
  | "agent_runner"
  | "memory_consolidator"
  | "manual";

export interface MemoryScope {
  userId?: string;
  channel?: string;
  conversationId?: string;
  sessionId?: string;
  taskId?: string;
  agentType?: string;
  projectRoot?: string;
}

export interface MemoryEvidenceRef {
  kind: "session" | "task" | "agent_run" | "file" | "raw_event";
  id: string;
  path?: string;
  note?: string;
}

export interface MemoryRawEvent {
  id: string;
  type: MemoryRawEventType;
  source: MemoryEventSource;
  timestamp: number;
  dateKey: string;
  scope: MemoryScope;
  title?: string;
  summary: string;
  contentPreview?: string;
  evidenceRefs?: MemoryEvidenceRef[];
  metadata?: Record<string, unknown>;
}

export interface DailyDigest {
  id: string;
  dateKey: string;
  timeZone: string;
  createdAt: number;
  eventCount: number;
  summary: string;
  highlights: string[];
  episodeIds?: string[];
  taskIds: string[];
  agentRuns: Array<{
    id: string;
    taskId: string;
    agentType: string;
    status: string;
  }>;
  sourceEventIds: string[];
}

export interface MemoryWorldDelta {
  subject: string;
  before?: string;
  after: string;
  confidence: number;
  evidenceRefs?: MemoryEvidenceRef[];
}

export interface MemoryEpisode {
  id: string;
  key?: string;
  dateKey: string;
  title: string;
  timeRange: {
    start: number;
    end: number;
  };
  summary: string;
  userGoal?: string;
  actions: string[];
  result?: string;
  worldDeltas: MemoryWorldDelta[];
  salience: number;
  scope: MemoryScope;
  taskIds: string[];
  agentRunIds: string[];
  sourceEventIds: string[];
  evidenceRefs: MemoryEvidenceRef[];
  createdAt: number;
  updatedAt: number;
}

export type MemoryAtomType =
  | "user_preference"
  | "project_fact"
  | "decision"
  | "constraint"
  | "routine"
  | "procedural"
  | "relationship";

export type MemoryAtomStatus = "active" | "superseded" | "uncertain" | "invalid" | "archived";

export type MemoryAtomScopeType = "global" | "user" | "project" | "task" | "agent";

export interface MemoryAtom {
  id: string;
  key?: string;
  type: MemoryAtomType;
  scopeType: MemoryAtomScopeType;
  scope: MemoryScope;
  subject: string;
  statement: string;
  confidence: number;
  salience: number;
  status: MemoryAtomStatus;
  isActivated: boolean;
  evidenceRefs: MemoryEvidenceRef[];
  createdAt: number;
  updatedAt: number;
  activatedAt?: number;
  lastAccessedAt?: number;
  lastActivatedAt?: number;
  deactivatedAt?: number;
  activationReason?: string;
  deactivationReason?: string;
  validFrom?: number;
  validUntil?: number;
  supersedes?: string[];
  supersededBy?: string;
  tags?: string[];
}

export interface MemoryAtomFilter {
  key?: string;
  status?: MemoryAtomStatus;
  type?: MemoryAtomType;
  scopeType?: MemoryAtomScopeType;
  isActivated?: boolean;
  limit?: number;
}

export interface MemoryStoreFilter {
  dateKey?: string;
  startAt?: number;
  endAt?: number;
  taskId?: string;
  sessionId?: string;
}

export type MemoryCandidateSource =
  | "explicit_user_request"
  | "task_completion"
  | "memory_consolidator"
  | "manual";

export type MemoryCandidateStatus = "pending" | "accepted" | "rejected" | "archived";

export interface MemoryCandidate {
  id: string;
  source: MemoryCandidateSource;
  status: MemoryCandidateStatus;
  content: string;
  proposedType?: MemoryAtomType;
  scopeType?: MemoryAtomScopeType;
  scope: MemoryScope;
  subject?: string;
  reason?: string;
  confidence: number;
  salience: number;
  requiresConsolidation: boolean;
  evidenceRefs: MemoryEvidenceRef[];
  createdAt: number;
  updatedAt: number;
  reviewedAt?: number;
  atomId?: string;
  tags?: string[];
}

export interface MemoryCandidateFilter {
  status?: MemoryCandidateStatus;
  source?: MemoryCandidateSource;
  limit?: number;
}
