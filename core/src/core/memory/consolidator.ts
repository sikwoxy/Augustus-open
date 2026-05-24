import { formatDateKey, getConfiguredTimeZone } from "../../utils/time-zone";
import type { FileSystemMemoryAtomStore } from "./atom-store";
import type { FileSystemMemoryCandidateStore } from "./candidate-store";
import type { FileSystemMemoryDigestStore } from "./digest-store";
import type { FileSystemMemoryEpisodeStore } from "./episode-store";
import type { FileSystemMemoryEventStore } from "./event-store";
import type {
  DailyDigest,
  MemoryAtomType,
  MemoryCandidate,
  MemoryEpisode,
  MemoryEvidenceRef,
  MemoryRawEvent,
  MemoryScope,
} from "./types";

export class MemoryConsolidator {
  constructor(
    private eventStore: FileSystemMemoryEventStore,
    private digestStore: FileSystemMemoryDigestStore,
    private episodeStore?: FileSystemMemoryEpisodeStore,
    private candidateStore?: FileSystemMemoryCandidateStore,
    private atomStore?: FileSystemMemoryAtomStore,
  ) {}

  async consolidateDay(dateKey: string): Promise<DailyDigest> {
    const events = (await this.eventStore.list({ dateKey }))
      .filter((event) => event.source !== "memory_consolidator");
    const episodes = this.episodeStore
      ? await this.buildAndSaveEpisodes(dateKey, events)
      : [];
    const taskIds = unique(events.map((event) => event.scope.taskId).filter(isString));
    const agentRuns = events
      .filter((event) => event.type === "agent_run")
      .map((event) => ({
        id: String(event.metadata?.runId ?? event.id),
        taskId: event.scope.taskId ?? "unknown",
        agentType: event.scope.agentType ?? String(event.metadata?.agentType ?? "unknown"),
        status: String(event.metadata?.status ?? "unknown"),
      }));

    const highlights = this.buildHighlights(events);
    const digest: DailyDigest = {
      id: `mem_digest_${dateKey}`,
      dateKey,
      timeZone: getConfiguredTimeZone(),
      createdAt: Date.now(),
      eventCount: events.length,
      summary: this.buildSummary(events, taskIds, agentRuns.length, episodes.length),
      highlights,
      episodeIds: episodes.map((episode) => episode.id),
      taskIds,
      agentRuns,
      sourceEventIds: events.map((event) => event.id),
    };

    await this.digestStore.save(digest);
    const candidateResult = await this.processPendingCandidates(dateKey);
    const deactivationResult = await this.applyDeactivationPolicy();
    await this.eventStore.append({
      type: "system",
      source: "memory_consolidator",
      timestamp: Date.now(),
      scope: {},
      title: "memory sleep completed",
      summary: `已为 ${dateKey} 生成 daily digest，包含 ${events.length} 条原始事件。`,
      metadata: {
        dateKey,
        eventCount: events.length,
        digestId: digest.id,
        acceptedCandidates: candidateResult.accepted,
        rejectedCandidates: candidateResult.rejected,
        deactivatedAtoms: deactivationResult.deactivated,
      },
    });

    return digest;
  }

  private async processPendingCandidates(dateKey: string): Promise<{ accepted: number; rejected: number }> {
    if (!this.candidateStore || !this.atomStore) return { accepted: 0, rejected: 0 };

    const candidates = await this.candidateStore.list({ status: "pending" });
    let accepted = 0;
    let rejected = 0;

    for (const candidate of candidates) {
      if (formatDateKey(new Date(candidate.createdAt)) > dateKey) continue;

      const rejectionReason = this.getCandidateRejectionReason(candidate);
      if (rejectionReason) {
        await this.candidateStore.save({
          ...candidate,
          status: "rejected",
          reviewedAt: Date.now(),
          reason: appendReason(candidate.reason, rejectionReason),
        });
        rejected += 1;
        continue;
      }

      const key = this.buildAtomKey(candidate);
      const previous = await this.atomStore.list({ key, status: "active" });
      const now = Date.now();
      const isActivated = this.shouldActivateCandidate(candidate);
      const atom = await this.atomStore.create({
        key,
        type: candidate.proposedType ?? this.inferAtomType(candidate),
        scopeType: candidate.scopeType ?? "project",
        scope: candidate.scope,
        subject: candidate.subject?.trim() || this.buildSubject(candidate),
        statement: candidate.content.trim(),
        confidence: clamp(candidate.confidence, 0, 1),
        salience: clamp(candidate.salience, 0, 1),
        status: "active",
        isActivated,
        activatedAt: isActivated ? now : undefined,
        lastActivatedAt: isActivated ? now : undefined,
        deactivatedAt: isActivated ? undefined : now,
        activationReason: isActivated ? this.buildActivationReason(candidate) : undefined,
        deactivationReason: isActivated ? undefined : "memory preserved but not selected for default wake",
        evidenceRefs: candidate.evidenceRefs,
        supersedes: previous.map((item) => item.id),
        tags: Array.from(new Set([...(candidate.tags ?? []), "from_candidate"])),
      });

      for (const oldAtom of previous) {
        await this.atomStore.markSuperseded(oldAtom.id, atom.id);
      }

      await this.candidateStore.updateStatus(candidate.id, "accepted", { atomId: atom.id });
      accepted += 1;
    }

    return { accepted, rejected };
  }

  private getCandidateRejectionReason(candidate: MemoryCandidate): string | null {
    const content = candidate.content.trim();
    if (content.length < 8) return "content too short to become long-term memory";
    if (candidate.confidence < 0.5) return "confidence below memory threshold";
    if (candidate.salience < 0.35) return "salience below memory threshold";
    return null;
  }

  private shouldActivateCandidate(candidate: MemoryCandidate): boolean {
    const type = candidate.proposedType ?? this.inferAtomType(candidate);
    if (candidate.source === "explicit_user_request") return candidate.confidence >= 0.6;
    if (type === "user_preference" || type === "decision" || type === "constraint") {
      return candidate.confidence >= 0.6 && candidate.salience >= 0.45;
    }
    if (type === "routine" || type === "procedural") {
      return candidate.confidence >= 0.6 && candidate.salience >= 0.55;
    }
    if (type === "project_fact") {
      return candidate.confidence >= 0.65 && candidate.salience >= 0.65;
    }
    return candidate.confidence >= 0.75 && candidate.salience >= 0.75;
  }

  private inferAtomType(candidate: MemoryCandidate): MemoryAtomType {
    if (candidate.source === "task_completion") return "project_fact";
    return "project_fact";
  }

  private buildActivationReason(candidate: MemoryCandidate): string {
    if (candidate.source === "explicit_user_request") return "explicit user memory request";
    if (candidate.source === "task_completion") return "high-value task completion memory";
    return "selected by memory sleep";
  }

  private buildSubject(candidate: MemoryCandidate): string {
    const content = candidate.content.replace(/\s+/g, " ").trim();
    return content.length > 60 ? content.slice(0, 60) : content;
  }

  private buildAtomKey(candidate: MemoryCandidate): string {
    const type = candidate.proposedType ?? this.inferAtomType(candidate);
    const scopeType = candidate.scopeType ?? "project";
    const scopeKey = [
      candidate.scope.projectRoot ? `project:${candidate.scope.projectRoot}` : "",
      candidate.scope.userId ? `user:${candidate.scope.userId}` : "",
      candidate.scope.agentType ? `agent:${candidate.scope.agentType}` : "",
    ].filter(Boolean).join("|") || "global";
    const subject = candidate.subject?.trim() || candidate.content.trim();
    return `${scopeType}:${type}:${normalizeKeyPart(scopeKey)}:${normalizeKeyPart(subject)}`;
  }

  private async applyDeactivationPolicy(): Promise<{ deactivated: number }> {
    if (!this.atomStore) return { deactivated: 0 };

    const atoms = await this.atomStore.list({ status: "active", isActivated: true });
    const now = Date.now();
    const halfYearMs = 180 * 24 * 60 * 60 * 1000;
    const oneYearMs = 365 * 24 * 60 * 60 * 1000;
    let deactivated = 0;

    for (const atom of atoms) {
      if (this.isDurableAtomType(atom.type)) continue;
      const lastSignal = atom.lastAccessedAt ?? atom.lastActivatedAt ?? atom.createdAt;
      const ageMs = now - lastSignal;
      const shouldDeactivate =
        (ageMs > halfYearMs && atom.salience < 0.55) ||
        (ageMs > oneYearMs && atom.salience < 0.8);

      if (!shouldDeactivate) continue;
      await this.atomStore.setActivated(atom.id, false, "memory sleep deactivated stale low-salience memory");
      deactivated += 1;
    }

    return { deactivated };
  }

  private isDurableAtomType(type: MemoryAtomType): boolean {
    return type === "user_preference" || type === "decision" || type === "constraint" || type === "routine";
  }

  private async buildAndSaveEpisodes(dateKey: string, events: MemoryRawEvent[]): Promise<MemoryEpisode[]> {
    if (!this.episodeStore || events.length === 0) return [];

    const groups = new Map<string, MemoryRawEvent[]>();
    for (const event of events) {
      const groupKey = this.buildEpisodeGroupKey(event);
      const group = groups.get(groupKey) ?? [];
      group.push(event);
      groups.set(groupKey, group);
    }

    const episodes: MemoryEpisode[] = [];
    for (const [groupKey, groupEvents] of groups) {
      const sorted = [...groupEvents].sort((a, b) => a.timestamp - b.timestamp);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      if (!first || !last) continue;

      const taskIds = unique(sorted.map((event) => event.scope.taskId).filter(isString));
      const agentRunIds = sorted
        .filter((event) => event.type === "agent_run")
        .map((event) => String(event.metadata?.runId ?? event.id));
      const toolNames = unique(sorted.flatMap((event) =>
        Array.isArray(event.metadata?.toolNames)
          ? event.metadata.toolNames.filter(isString)
          : [],
      ));
      const evidenceRefs = this.buildEpisodeEvidenceRefs(sorted);

      const episode = await this.episodeStore.upsertByKey({
        key: `${dateKey}:${groupKey}`,
        dateKey,
        title: this.buildEpisodeTitle(sorted),
        timeRange: { start: first.timestamp, end: last.timestamp },
        summary: this.buildEpisodeSummary(sorted, toolNames),
        userGoal: this.extractUserGoal(sorted),
        actions: this.buildEpisodeActions(sorted, toolNames),
        result: this.extractResult(sorted),
        worldDeltas: [],
        salience: this.scoreEpisodeSalience(sorted),
        scope: this.mergeScope(sorted),
        taskIds,
        agentRunIds,
        sourceEventIds: sorted.map((event) => event.id),
        evidenceRefs,
      });
      episodes.push(episode);
    }

    return episodes.sort((a, b) => a.timeRange.start - b.timeRange.start);
  }

  private buildSummary(events: MemoryRawEvent[], taskIds: string[], agentRunCount: number, episodeCount: number): string {
    if (events.length === 0) {
      return "这一天没有可整理的 Augustus 事件。";
    }

    const turnCount = events.filter((event) => event.type === "turn").length;
    const taskPart = taskIds.length > 0 ? `，涉及 ${taskIds.length} 个任务` : "";
    const agentPart = agentRunCount > 0 ? `，包含 ${agentRunCount} 次 subagent 执行` : "";
    const episodePart = episodeCount > 0 ? `，整理为 ${episodeCount} 个 episode` : "";
    return `这一天记录了 ${events.length} 条事件，其中 ${turnCount} 轮对话${taskPart}${agentPart}${episodePart}。`;
  }

  private buildHighlights(events: MemoryRawEvent[]): string[] {
    const highlightEvents = events
      .filter((event) => event.type === "turn" || event.type === "agent_run" || event.type === "task")
      .map((event, index) => ({ event, index, score: this.scoreHighlightEvent(event, index, events.length) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.event.timestamp - a.event.timestamp;
      })
      .slice(0, 20);

    const highlights = highlightEvents.map(({ event }) => {
      const prefix = event.title ? `${event.title}: ` : "";
      return `${prefix}${event.summary}`;
    });

    if (highlights.length === 0 && events.length > 0) {
      highlights.push(...events.slice(-10).map((event) => event.summary));
    }

    return highlights;
  }

  private scoreHighlightEvent(event: MemoryRawEvent, index: number, eventCount: number): number {
    let score = 0;
    const toolNames = Array.isArray(event.metadata?.toolNames)
      ? event.metadata.toolNames.filter(isString)
      : [];

    if (event.type === "task") score += 40;
    if (event.type === "agent_run") {
      score += 35;
      const status = String(event.metadata?.status ?? "");
      if (status === "failed") score += 10;
      if (status === "done") score += 8;
    }
    if (event.scope.taskId) score += 20;
    if (toolNames.includes("complete_current_task")) score += 35;
    if (toolNames.includes("delegate_to_agent")) score += 25;
    if (toolNames.includes("create_task")) score += 20;
    if (toolNames.includes("create_memory_candidate")) score += 18;
    if (toolNames.includes("send_file") || toolNames.includes("write_file")) score += 12;
    if (event.source === "task_orchestrator") score += 5;

    // Prefer newer events slightly so the final outcome of a task is retained.
    score += eventCount > 0 ? index / eventCount : 0;
    return score;
  }

  private buildEpisodeGroupKey(event: MemoryRawEvent): string {
    if (event.scope.taskId) return `task:${event.scope.taskId}`;
    if (event.scope.sessionId) return `session:${event.scope.sessionId}`;
    if (event.scope.conversationId) return `conversation:${event.scope.conversationId}`;
    return `misc:${event.type}`;
  }

  private buildEpisodeTitle(events: MemoryRawEvent[]): string {
    const taskEvent = events.find((event) => event.scope.taskId && event.title);
    if (taskEvent?.title) return taskEvent.title;

    const first = events[0];
    if (!first) return "未命名 episode";
    if (first.scope.taskId) return `任务 ${first.scope.taskId.slice(-4)} 的记忆片段`;
    if (first.scope.conversationId) return `会话 ${first.scope.conversationId.slice(-6)} 的记忆片段`;
    return first.title ?? "未分组记忆片段";
  }

  private buildEpisodeSummary(events: MemoryRawEvent[], toolNames: string[]): string {
    const parts: string[] = [];
    const turns = events.filter((event) => event.type === "turn").length;
    const agentRuns = events.filter((event) => event.type === "agent_run").length;
    if (turns > 0) parts.push(`${turns} 轮对话`);
    if (agentRuns > 0) parts.push(`${agentRuns} 次 subagent 执行`);
    if (toolNames.length > 0) parts.push(`使用工具 ${toolNames.join(", ")}`);

    const lastMeaningful = [...events].reverse().find((event) => event.summary);
    const suffix = lastMeaningful ? `。关键记录：${lastMeaningful.summary}` : "";
    return `${parts.length > 0 ? parts.join("，") : "记录了一组相关事件"}${suffix}`;
  }

  private extractUserGoal(events: MemoryRawEvent[]): string | undefined {
    const firstTurn = events.find((event) => event.type === "turn" && event.contentPreview);
    return firstTurn?.contentPreview;
  }

  private buildEpisodeActions(events: MemoryRawEvent[], toolNames: string[]): string[] {
    const actions: string[] = [];
    if (toolNames.length > 0) actions.push(`调用工具：${toolNames.join(", ")}`);

    for (const event of events) {
      if (event.type === "agent_run") {
        actions.push(event.summary);
      }
      if (actions.length >= 8) break;
    }

    if (actions.length === 0) {
      actions.push(...events.slice(0, 5).map((event) => event.summary));
    }
    return actions;
  }

  private extractResult(events: MemoryRawEvent[]): string | undefined {
    const lastTurn = [...events].reverse().find((event) => event.type === "turn");
    return lastTurn?.summary;
  }

  private scoreEpisodeSalience(events: MemoryRawEvent[]): number {
    let score = 0.35;
    if (events.some((event) => event.scope.taskId)) score += 0.2;
    if (events.some((event) => event.type === "agent_run")) score += 0.15;
    if (events.some((event) => event.type === "task")) score += 0.1;
    if (events.some((event) => {
      const names = event.metadata?.toolNames;
      return Array.isArray(names) && names.length > 0;
    })) score += 0.1;
    return Math.min(1, score);
  }

  private mergeScope(events: MemoryRawEvent[]): MemoryScope {
    const first = events[0]?.scope ?? {};
    return {
      userId: first.userId,
      channel: first.channel,
      conversationId: first.conversationId,
      sessionId: first.sessionId,
      taskId: first.taskId,
      agentType: first.agentType,
      projectRoot: first.projectRoot,
    };
  }

  private buildEpisodeEvidenceRefs(events: MemoryRawEvent[]): MemoryEvidenceRef[] {
    const refs: MemoryEvidenceRef[] = [];
    const seen = new Set<string>();

    for (const event of events) {
      const rawKey = `raw_event:${event.id}`;
      if (!seen.has(rawKey)) {
        refs.push({ kind: "raw_event", id: event.id });
        seen.add(rawKey);
      }

      for (const ref of event.evidenceRefs ?? []) {
        const key = `${ref.kind}:${ref.id}:${ref.path ?? ""}`;
        if (!seen.has(key)) {
          refs.push(ref);
          seen.add(key);
        }
      }
    }

    return refs.slice(0, 40);
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeKeyPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function appendReason(existing: string | undefined, addition: string): string {
  return existing ? `${existing}; ${addition}` : addition;
}
