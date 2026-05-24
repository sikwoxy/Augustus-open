export type ExperienceKind =
  | "tool_behavior"
  | "tool_failure_pattern"
  | "verification_pattern"
  | "workflow_pattern";

export type ExperienceApprovalStatus =
  | "candidate"
  | "approved"
  | "rejected"
  | "superseded";

export interface ExperienceScope {
  hostId?: string;
  projectRoot?: string;
  capabilityName?: string;
  toolName?: string;
  skillName?: string;
  agentType?: string;
}

export interface ExperienceCandidate {
  id: string;
  kind: ExperienceKind;
  scope: ExperienceScope;
  claim: string;
  evidenceRefs: string[];
  confidence: number;
  approvalStatus: ExperienceApprovalStatus;
  createdAt: number;
  updatedAt: number;
  lastVerifiedAt?: number;
  expiresAt?: number;
  reviewNote?: string;
  reviewedAt?: number;
  supersededBy?: string;
  metadata?: Record<string, unknown>;
}

export interface ExperienceCandidateFilter {
  kind?: ExperienceKind;
  approvalStatus?: ExperienceApprovalStatus;
  toolName?: string;
  projectRoot?: string;
  limit?: number;
}
