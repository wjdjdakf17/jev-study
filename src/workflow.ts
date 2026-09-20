/**
 * src/workflow.ts
 * ---------------
 * "confidence-gated routing" — TypeSafe가 패턴으로 문서화해 둔,
 * Jev류 모델의 가장 전형적인 쓰임새를 구현한 예제.
 *
 * 아이디어: 모델의 판단을 "그대로 실행"하는 게 아니라,
 * confidence라는 게이트를 통과할 때만 자동화하고,
 * 통과 못 하면 사람 검토로 넘긴다.
 *
 *   confidence 0.95 (분포가 확실) → 자동 라우팅
 *   confidence 0.10 (두 팀이 비등) → 사람에게 에스컬레이션
 *
 * 이 경계를 "명시적인 임계값"으로 코드에 박아두는 게 핵심이다.
 * 프롬프트 속에 정책을 숨기지 않고, 평범한 if문으로 꺼내 놓는다.
 * 공식 문서의 표현대로 — 모델은 "좁은 판단"만 담당하고
 * 정책과 실행은 코드가 소유한다.
 */

import type { ChoiceDecision, DecisionMap, NoulDecision, ScoreDecision } from "./types.js";

/* -------------------------------------------------------------------------- */
/* 질문 정의 — 티켓 하나에 대해 세 가지를 "독립적으로" 묻는다                   */
/* -------------------------------------------------------------------------- */

export const TICKET_QUESTIONS = [
  {
    kind: "choice",
    key: "route",
    question: "이 티켓을 처리할 팀은?",
    options: ["billing", "technical", "account"],
  },
  {
    kind: "score",
    key: "severity",
    question: "보고된 문제의 심각도는?",
    levels: [
      { label: "cosmetic", description: "치장 수준의 문제. 기능 영향 없음." },
      { label: "degraded", description: "기능이 망가졌지만 우회로가 있음." },
      { label: "blocking", description: "업무가 완전히 막힘. 즉시 대응." },
    ],
  },
  {
    kind: "noul",
    key: "wantsRefund",
    proposition: "사용자가 환불을 요청하고 있다",
  },
] as const;

/* -------------------------------------------------------------------------- */
/* 라우팅 정책 — 숫자와 if문으로 된 "스마트 if-statement"                       */
/* -------------------------------------------------------------------------- */

/**
 * 정책 객체. 임계값을 코드로 들어내 둔다.
 *
 * minRouteConfidence를 0.5로 두면 "반반이면 사람에게"가 되고,
 * 0.2로 낮추면 대부분 자동화된다. 이 숫자 하나가
 * "자동화율 vs 실수율"의 트레이드오프를 통제한다.
 * 실무에서는 자기 트래픽의 라벨링 데이터로 이 숫자를 튜닝한다.
 */
export interface RoutingPolicy {
  /** 라우팅 confidence가 이 값 미만이면 사람 검토로. */
  readonly minRouteConfidence: number;
  /** 심각도가 blocking이면 무조건 긴급 큐로. */
  readonly escalateBlocking: boolean;
  /** 환불 요청으로 판단되는 확률이 이 값 이상이면 billing 우선. */
  readonly refundThreshold: number;
}

export const DEFAULT_POLICY: RoutingPolicy = {
  minRouteConfidence: 0.5,
  escalateBlocking: true,
  refundThreshold: 0.8,
};

export type RoutingOutcome =
  | {
      readonly action: "route";
      readonly team: string;
      readonly urgent: boolean;
      readonly reason: string;
    }
  | {
      readonly action: "escalate";
      readonly reason: string;
    };

/**
 * 결정 묶음을 정책에 통과시켜 최종 행동을 낸다.
 *
 * 주목할 점: 이 함수 안에 AI가 없다. 모델의 불확실성(확률)을
 * 소비하는 건 평범한 코드고, 그래서 테스트가 쉽고 감사도 가능하다.
 */
export function routeTicket(
  decisions: DecisionMap,
  policy: RoutingPolicy = DEFAULT_POLICY,
): RoutingOutcome {
  const route = decisions["route"] as ChoiceDecision | undefined;
  const severity = decisions["severity"] as ScoreDecision | undefined;
  const refund = decisions["wantsRefund"] as NoulDecision | undefined;

  if (!route || route.kind !== "choice") {
    return { action: "escalate", reason: "라우팅 결정이 없거나 형식이 틀림" };
  }

  // 게이트 1: confidence 부족 → 사람 검토. 이게 이 패턴의 심장.
  if (route.confidence < policy.minRouteConfidence) {
    return {
      action: "escalate",
      reason: `라우팅 confidence ${route.confidence.toFixed(2)}가 ` +
        `임계값 ${policy.minRouteConfidence} 미만 (분포가 애매함)`,
    };
  }

  // 게이트 2: 환불 요청 가능성이 높으면 결제 팀으로 우선 분류.
  // Noul은 confidence가 없다 — 확률 그 자체를 임계값과 비교한다.
  let team = route.selected;
  const refundLikely =
    refund !== undefined &&
    refund.kind === "noul" &&
    refund.probabilityOfYes >= policy.refundThreshold;

  if (refundLikely && team !== "billing") {
    team = "billing";
  }

  // 게이트 3: 심각도가 최상이면 긴급 큐.
  const urgent =
    policy.escalateBlocking &&
    severity !== undefined &&
    severity.kind === "score" &&
    severity.selected === "blocking";

  return {
    action: "route",
    team,
    urgent,
    reason: refundLikely
      ? "환불 가능성 높음 → billing 우선"
      : "confidence 통과",
  };
}
