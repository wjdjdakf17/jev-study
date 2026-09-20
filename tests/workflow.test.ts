/**
 * tests/workflow.test.ts — confidence-gated 라우팅 정책 테스트.
 *
 * 여기서 검증하는 건 AI가 아니라 "정책 코드"다.
 * 모델이 불확실성을 보고하면, 그 다음은 전부 결정론적 if문 —
 * 그래서 테스트가 가능하다는 게 이 아키텍처의 판매점.
 */
import { describe, expect, it } from "vitest";

import { MockDecisionClient } from "../src/client.js";
import {
  DEFAULT_POLICY,
  TICKET_QUESTIONS,
  routeTicket,
} from "../src/workflow.js";

async function decideFor(state: Record<string, unknown>) {
  const client = new MockDecisionClient();
  return client.decide({ state, questions: [...TICKET_QUESTIONS] });
}

describe("routeTicket", () => {
  it("명확한 결제 티켓은 자동으로 billing에 라우팅", async () => {
    const decisions = await decideFor({
      subject: "이중 결제 환불 요청",
      body: "카드로 구독 결제가 두 번 청구됐습니다. 환불 부탁드립니다.",
    });

    const outcome = routeTicket(decisions, DEFAULT_POLICY);
    expect(outcome.action).toBe("route");
    if (outcome.action === "route") {
      expect(outcome.team).toBe("billing");
      expect(outcome.urgent).toBe(false);
    }
  });

  it("애매한 티켓은 confidence 게이트에서 걸려 사람 검토로", async () => {
    const decisions = await decideFor({
      subject: "로그인도 안 되고 결제도 안 돼요",
      body: "로그인 에러가 나는데 비밀번호를 바꿔도 결제 페이지에서 에러가 나고 계정도 이상해요",
    });

    const outcome = routeTicket(decisions, DEFAULT_POLICY);
    expect(outcome.action).toBe("escalate");
    if (outcome.action === "escalate") {
      expect(outcome.reason).toContain("confidence");
    }
  });

  it("환불 의사가 높으면 다른 팀으로 결정돼도 billing로 우선분류", async () => {
    // 기술 문제가 명확히 우세(라우팅은 technical)지만 환불 요청이 섞인 티켓.
    // 라우팅 confidence 게이트는 통과하고, 환불 확률이 정책 임계값을 넘어
    // billing로 우선분류되는지를 본다.
    const decisions = await decideFor({
      subject: "앱이 실행되자마자 에러로 죽습니다",
      body: "앱이 실행되자마자 에러가 나고 로그인도 실패합니다. 재시작해도 계속 같은 증상이에요. 그리고 환불해 주시고 이번 달 것 취소도 부탁드립니다.",
    });

    const outcome = routeTicket(decisions, DEFAULT_POLICY);
    expect(outcome.action).toBe("route");
    if (outcome.action === "route") {
      expect(outcome.team).toBe("billing");
    }
  });

  it("전면 장애 티켓은 긴급 플래그가 붙는다", async () => {
    const decisions = await decideFor({
      subject: "서비스 전체가 다운됐습니다",
      body: "결제 시스템 포함 전체가 응답 없음. 장애 상황입니다.",
    });

    const outcome = routeTicket(decisions, DEFAULT_POLICY);
    expect(outcome.action).toBe("route");
    if (outcome.action === "route") {
      expect(outcome.urgent).toBe(true);
    }
  });

  it("임계값을 0으로 낮추면 애매한 티켓도 자동화된다 — 정책이 자동화율을 통제", async () => {
    const decisions = await decideFor({
      subject: "로그인도 안 되고 결제도 안 돼요",
      body: "로그인 에러가 나는데 비밀번호를 바꿔도 결제 페이지에서 에러가 나고 계정도 이상해요",
    });

    const permissive = { ...DEFAULT_POLICY, minRouteConfidence: 0 };
    const outcome = routeTicket(decisions, permissive);
    expect(outcome.action).toBe("route");
  });

  it("라우팅 결정이 없으면 안전하게 에스컬레이션", () => {
    const outcome = routeTicket({});
    expect(outcome.action).toBe("escalate");
  });
});
