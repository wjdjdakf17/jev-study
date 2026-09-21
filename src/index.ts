/**
 * src/index.ts — 공개 API (엔트리포인트)
 *
 * 구성:
 *   types.ts       질문 3종 · 결정 · confidence 계산 (개념의 타입화)
 *   client.ts      DecisionClient 인터페이스 + 결정론적 목업
 *   calibration.ts Brier score · 신뢰도 버킷 (보정 측정)
 *   workflow.ts    confidence-gated 라우팅 예제 (스마트 if-statement)
 */
export type {
  ChoiceQuestion,
  ChoiceDecision,
  Decision,
  DecisionMap,
  DecisionState,
  NoulDecision,
  NoulQuestion,
  ProbabilityDistribution,
  Question,
  QuestionKey,
  RubricLevel,
  ScoreDecision,
  ScoreQuestion,
} from "./types.js";
export {
  clamp01,
  confidenceFromDistribution,
  normalize,
} from "./types.js";

export type { DecideRequest, DecisionClient } from "./client.js";
export { MockDecisionClient } from "./client.js";

export {
  brierScore,
  ece,
  reliabilityBuckets,
  type BinaryPrediction,
  type ReliabilityBucket,
} from "./calibration.js";

export {
  DEFAULT_POLICY,
  TICKET_QUESTIONS,
  routeTicket,
  type RoutingOutcome,
  type RoutingPolicy,
} from "./workflow.js";
